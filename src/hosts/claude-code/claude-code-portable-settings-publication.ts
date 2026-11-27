import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { ModuleError } from "../../foundation/error/module-error.js";
import {
  DurableAtomicFileStageRecoveryError,
  recoverDurableAtomicFileStagesForTargets,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  replaceFileAtomically,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  createDirectoryAtomically,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import { parsePortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
  type StableFileReadResult,
} from "../../foundation/filesystem/stable-file-read.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import { currentUserIdOrNull } from "../../foundation/node/current-user.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { decodeUtf8, encodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import {
  type ClaudeCodePortableSettingsTransition,
  type ClaudeCodePortableSettingsTransitionReason,
  planClaudeCodePortableSettingsRemovalTransition,
  planClaudeCodePortableSettingsTransition,
} from "./claude-code-portable-settings-transition.js";

/**
 * Wakeflow Host / Claude Code：单个已授权根的 portable settings CAS owner。
 *
 * 本 owner 只创建或精确替换 `.claude/settings.json`，写入内容完全来自 portable
 * transition。它不处理 local settings、statusline、Git ignore、Repository 授权或多根
 * transaction；这些仍由上层 maintenance participant 排序和授权。退出路径（ADR-0024）
 * 用同一个 CAS 精确删除 Wakeflow 的条目：`removedRules` 选项换掉 transition 的规划器，
 * 读取、期望源核对、替换与读回不变。
 */

export const CLAUDE_CODE_SETTINGS_DIRECTORY_REF = parsePortableResourcePath(".claude");
export const CLAUDE_CODE_PORTABLE_SETTINGS_REF = parsePortableResourcePath(".claude/settings.json");

/** 写入路径的规则表。 */
interface ClaudeCodePortableSettingsWriteRules {
  /** 这个根拥有的托管 allow 规则；缺省是 transition 的默认（只有 MCP 一条）。 */
  readonly rules?: readonly string[];
  /** 这个根上曾拥有、现在要精确删除的规则（§13.168）。 */
  readonly retiredRules?: readonly string[];
  readonly removedRules?: undefined;
}

/**
 * 退出路径（ADR-0024）：给出即只精确删除这些条目、不再写入任何规则；与 `rules`/`retiredRules`
 * 互斥（由类型表达）。文件不存在或没有这些条目是 current，发布器不会为删除建目录或建文件。
 */
interface ClaudeCodePortableSettingsRemovalRules {
  readonly removedRules: readonly string[];
  readonly rules?: undefined;
  readonly retiredRules?: undefined;
}

/** 一次发布要么写规则，要么删条目（ADR-0024）。 */
export type ClaudeCodePortableSettingsRuleSelection =
  | ClaudeCodePortableSettingsWriteRules
  | ClaudeCodePortableSettingsRemovalRules;

export type ClaudeCodePortableSettingsPublicationOptions = {
  readonly signal?: AbortSignal;
} & ClaudeCodePortableSettingsRuleSelection;

export type ClaudeCodePortableSettingsPublishOptions =
  ClaudeCodePortableSettingsPublicationOptions & {
    /**
     * 调用方已确认的 source 摘要，`null` 表示期望文件不存在（open-items W6 / CR-H7）。
     * 发布器自己读到的 `before` 与之不同就以 `source-changed` 拒绝、不建目录也不写：CAS 基底是
     * 调用方确认过的 source，而不是发布器的二次读。缺省不校验。只有发布接受这个选项。
     */
    readonly expectedSourceDigest?: Sha256Digest | null;
  };

export interface ClaudeCodePortableSettingsPublicationResult {
  readonly disposition: "current" | "created" | "updated";
  readonly sourceDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
  readonly transition: Readonly<ClaudeCodePortableSettingsTransition>;
}

export interface ClaudeCodePortableSettingsInspection {
  readonly kind: "ClaudeCodePortableSettingsInspection";
  readonly directoryStatus: "absent" | "present";
  readonly sourceDigest: Sha256Digest | null;
  readonly transition: Readonly<ClaudeCodePortableSettingsTransition>;
}

export type ClaudeCodePortableSettingsPublicationErrorReason =
  | "directory-policy"
  | "source-policy"
  | "transition-blocked"
  | "source-changed"
  | "root-scope"
  | "recovery-required"
  | "operation-failure";

/** Claude Code portable settings 发布失败的稳定、脱敏错误。 */
export class ClaudeCodePortableSettingsPublicationError extends ModuleError<ClaudeCodePortableSettingsPublicationErrorReason> {
  static override readonly code = "wakeflow-claude-code-portable-settings-publication";
  readonly transitionReason: ClaudeCodePortableSettingsTransitionReason | null;

  constructor(
    reason: ClaudeCodePortableSettingsPublicationErrorReason,
    path: string,
    transitionReason: ClaudeCodePortableSettingsTransitionReason | null = null,
    options?: ErrorOptions,
  ) {
    super(reason, path, options);
    this.transitionReason = transitionReason;
  }
}

const MAXIMUM_SETTINGS_BYTES = parseByteCount(1024 * 1024);

interface SettingsSourceInspection {
  readonly directoryNode: Readonly<FileNodeSnapshot> | null;
  readonly source: Readonly<StableFileReadResult> | null;
  readonly sourceText: string | null;
  readonly transition: Readonly<ClaudeCodePortableSettingsTransition>;
}

function fail(
  reason: ClaudeCodePortableSettingsPublicationErrorReason,
  path: string,
  transitionReason: ClaudeCodePortableSettingsTransitionReason | null = null,
  cause?: unknown,
): never {
  throw new ClaudeCodePortableSettingsPublicationError(
    reason,
    path,
    transitionReason,
    cause === undefined ? undefined : { cause },
  );
}

function assertDirectoryNode(node: Readonly<FileNodeSnapshot>): void {
  if (
    node.kind !== "directory" ||
    (node.permissionBits !== 0o700 && node.permissionBits !== 0o755) ||
    (currentUserIdOrNull() !== null && node.userId !== currentUserIdOrNull())
  ) {
    fail("directory-policy", "$settingsDirectory");
  }
}

function assertSourceNode(node: Readonly<FileNodeSnapshot>): void {
  if (
    node.kind !== "file" ||
    node.permissionBits !== 0o644 ||
    node.linkCount !== 1n ||
    (currentUserIdOrNull() !== null && node.userId !== currentUserIdOrNull())
  ) {
    fail("source-policy", "$settings");
  }
}

async function directoryNodeOrNull(
  root: RootedDirectory,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    const resource = await root.inspectResourceOrNull(CLAUDE_CODE_SETTINGS_DIRECTORY_REF);
    if (resource === null) return null;
    assertDirectoryNode(resource.node);
    return resource.node;
  } catch (error: unknown) {
    if (error instanceof ClaudeCodePortableSettingsPublicationError) throw error;
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

async function sourceOrNull(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<StableFileReadResult> | null> {
  let resource: Awaited<ReturnType<RootedDirectory["inspectResourceOrNull"]>>;
  try {
    resource = await root.inspectResourceOrNull(CLAUDE_CODE_PORTABLE_SETTINGS_REF);
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
  if (resource === null) return null;
  assertSourceNode(resource.node);
  try {
    return await readStableFile(root, CLAUDE_CODE_PORTABLE_SETTINGS_REF, {
      maximumBytes: MAXIMUM_SETTINGS_BYTES,
      expectedNode: resource.node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "root-scope") fail("root-scope", "$root");
      if (
        error.reason === "expectation-changed" ||
        error.reason === "source-changed" ||
        error.reason === "not-found"
      ) {
        fail("source-changed", "$settings");
      }
      fail("source-policy", "$settings");
    }
    throw error;
  }
}

/** 写入路径按托管规则表规划，退出路径只按删除表规划（ADR-0024）；两者互斥由选项类型保证。 */
function planTransition(
  sourceText: string | null,
  options: ClaudeCodePortableSettingsPublicationOptions,
): Readonly<ClaudeCodePortableSettingsTransition> {
  return options.removedRules === undefined
    ? planClaudeCodePortableSettingsTransition(sourceText, options.rules, options.retiredRules)
    : planClaudeCodePortableSettingsRemovalTransition(sourceText, options.removedRules);
}

async function inspectSource(
  root: RootedDirectory,
  options: ClaudeCodePortableSettingsPublicationOptions,
): Promise<Readonly<SettingsSourceInspection>> {
  const directoryNode = await directoryNodeOrNull(root);
  const source = directoryNode === null ? null : await sourceOrNull(root, options.signal);
  let sourceText: string | null = null;
  if (source !== null) {
    try {
      sourceText = decodeUtf8(source.bytes, "$settings");
    } catch (error: unknown) {
      if (error instanceof Utf8Error) fail("source-policy", "$settings");
      throw error;
    }
  }
  const transition = planTransition(sourceText, options);
  return Object.freeze({ directoryNode, source, sourceText, transition });
}

/** 只读检查一个已授权根的 portable settings，不返回用户源文本或节点身份。 */
export async function inspectClaudeCodePortableSettings(
  root: RootedDirectory,
  options: ClaudeCodePortableSettingsPublicationOptions = {},
): Promise<Readonly<ClaudeCodePortableSettingsInspection>> {
  throwIfAborted(options.signal);
  const inspection = await inspectSource(root, options);
  return Object.freeze({
    kind: "ClaudeCodePortableSettingsInspection",
    directoryStatus: inspection.directoryNode === null ? "absent" : "present",
    sourceDigest: inspection.source?.digest ?? null,
    transition: inspection.transition,
  });
}

async function ensureSettingsDirectory(
  root: RootedDirectory,
  inspection: Readonly<SettingsSourceInspection>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (inspection.directoryNode !== null) return;
  try {
    const created = await createDirectoryAtomically(root, CLAUDE_CODE_SETTINGS_DIRECTORY_REF, {
      mode: 0o755,
      ...(signal === undefined ? {} : { signal }),
    });
    assertDirectoryNode(created.node);
  } catch (error: unknown) {
    if (error instanceof ClaudeCodePortableSettingsPublicationError) throw error;
    if (error instanceof DurableDirectoryMaterializationError) {
      fail("operation-failure", "$settingsDirectory", null, error);
    }
    throw error;
  }
}

function assertTransitionReady(
  transition: Readonly<ClaudeCodePortableSettingsTransition>,
): asserts transition is Readonly<ClaudeCodePortableSettingsTransition> & {
  readonly status: "create" | "update";
  readonly desiredText: string;
  readonly desiredDigest: Sha256Digest;
} {
  if (
    (transition.status !== "create" && transition.status !== "update") ||
    transition.desiredText === null ||
    transition.desiredDigest === null
  ) {
    fail("transition-blocked", "$transition", transition.reason);
  }
}

/** 发布器的 CAS 基底是调用方确认过的 source：自己读到的 before 不是它就拒绝，目录和文件都不动（W6）。 */
function assertExpectedSource(
  before: Readonly<SettingsSourceInspection>,
  expectedSourceDigest: Sha256Digest | null | undefined,
): void {
  if (expectedSourceDigest === undefined) return;
  if ((before.source?.digest ?? null) !== expectedSourceDigest) {
    fail("source-changed", "$settings");
  }
}

async function publishTransition(
  root: RootedDirectory,
  inspection: Readonly<SettingsSourceInspection>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const { transition } = inspection;
  assertTransitionReady(transition);
  const bytes = encodeUtf8(transition.desiredText, "$settings");
  try {
    if (transition.status === "create") {
      if (inspection.source !== null) fail("source-changed", "$settings");
      await createFileAtomically(root, CLAUDE_CODE_PORTABLE_SETTINGS_REF, bytes, {
        mode: 0o644,
        ...(signal === undefined ? {} : { signal }),
      });
      return;
    }
    if (inspection.source === null) fail("source-changed", "$settings");
    await replaceFileAtomically(root, CLAUDE_CODE_PORTABLE_SETTINGS_REF, bytes, {
      mode: 0o644,
      expected: Object.freeze({
        resourcePath: inspection.source.resourcePath,
        node: inspection.source.node,
        byteCount: inspection.source.byteCount,
        digest: inspection.source.digest,
      }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ClaudeCodePortableSettingsPublicationError) throw error;
    if (error instanceof DurableAtomicFileWriteError) {
      if (
        error.reason === "target-exists" ||
        error.reason === "expectation-changed" ||
        error.reason === "expectation-read-failure"
      ) {
        fail("source-changed", "$settings");
      }
      if (error.reason === "stage-recovery-required") {
        fail("recovery-required", "$settingsStage");
      }
      fail("operation-failure", "$settings", null, error);
    }
    throw error;
  }
}

/**
 * 创建、最小更新或幂等复用一个已授权根的 portable settings。
 * 带 `expectedSourceDigest` 时，发布器读到的 before 必须就是它，否则在建目录和写入之前以
 * `source-changed` 拒绝（W6）。
 */
export async function publishClaudeCodePortableSettings(
  root: RootedDirectory,
  options: ClaudeCodePortableSettingsPublishOptions = {},
): Promise<Readonly<ClaudeCodePortableSettingsPublicationResult>> {
  throwIfAborted(options.signal);
  const before = await inspectSource(root, options);
  assertExpectedSource(before, options.expectedSourceDigest);
  if (before.transition.status === "blocked") {
    fail("transition-blocked", "$transition", before.transition.reason);
  }
  if (before.transition.status === "current") {
    if (before.transition.desiredDigest === null) {
      fail("operation-failure", "$transition");
    }
    return Object.freeze({
      disposition: "current",
      sourceDigest: before.source?.digest ?? null,
      targetDigest: before.transition.desiredDigest,
      transition: before.transition,
    });
  }
  await ensureSettingsDirectory(root, before, options.signal);
  if (before.directoryNode === null) {
    const afterDirectory = await inspectSource(root, options);
    if (afterDirectory.source !== null || afterDirectory.transition.status !== "create") {
      fail("source-changed", "$settings");
    }
  }
  await publishTransition(root, before, options.signal);
  const after = await inspectSource(root, options);
  if (
    after.transition.status !== "current" ||
    before.transition.desiredDigest === null ||
    after.source?.digest !== before.transition.desiredDigest
  ) {
    fail("operation-failure", "$readback");
  }
  return Object.freeze({
    disposition: before.transition.status === "create" ? "created" : "updated",
    sourceDigest: before.source?.digest ?? null,
    targetDigest: before.transition.desiredDigest,
    transition: before.transition,
  });
}

/** 只结算目标同父目录内属于 portable settings 的 inactive Foundation stage。 */
export async function settleClaudeCodePortableSettingsPublicationStages(
  root: RootedDirectory,
  { signal }: { readonly signal?: AbortSignal } = {},
): Promise<void> {
  const directory = await directoryNodeOrNull(root);
  if (directory !== null) {
    try {
      const recovery = await recoverDurableAtomicFileStagesForTargets(
        root,
        [CLAUDE_CODE_PORTABLE_SETTINGS_REF],
        signal === undefined ? undefined : { signal },
      );
      if (recovery.activeStageCount !== 0 || recovery.unknownStageCount !== 0) {
        fail("recovery-required", "$settingsStage");
      }
    } catch (error: unknown) {
      if (error instanceof ClaudeCodePortableSettingsPublicationError) throw error;
      if (error instanceof DurableAtomicFileStageRecoveryError) {
        if (error.reason === "root-scope") fail("root-scope", "$root");
        fail("recovery-required", "$settingsStage");
      }
      throw error;
    }
  }
}
