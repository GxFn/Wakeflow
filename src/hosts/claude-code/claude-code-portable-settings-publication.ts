import { types } from "node:util";

import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
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
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
  type StableFileReadResult,
} from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { decodeUtf8, encodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import {
  type ClaudeCodePortableSettingsTransition,
  type ClaudeCodePortableSettingsTransitionReason,
  planClaudeCodePortableSettingsTransition,
} from "./claude-code-portable-settings-transition.js";

/**
 * Wakeflow Host / Claude Code：单个已授权根的 portable settings CAS owner。
 *
 * 本 owner 只创建或精确替换 `.claude/settings.json`，写入内容完全来自 portable
 * transition。它不处理 local settings、statusline、Git ignore、Repository 授权或多根
 * transaction；这些仍由上层 maintenance participant 排序和授权。
 */

export const CLAUDE_CODE_SETTINGS_DIRECTORY_REF = parsePortableResourcePath(".claude");
export const CLAUDE_CODE_PORTABLE_SETTINGS_REF = parsePortableResourcePath(".claude/settings.json");

export interface ClaudeCodePortableSettingsPublicationOptions {
  readonly signal?: AbortSignal;
  /** 这个根拥有的托管 allow 规则；缺省是 transition 的默认（只有 MCP 一条）。 */
  readonly rules?: readonly string[];
  /** 这个根上曾拥有、现在要精确删除的规则（§13.168）。 */
  readonly retiredRules?: readonly string[];
}

export interface ClaudeCodePortableSettingsPublishOptions
  extends ClaudeCodePortableSettingsPublicationOptions {
  /**
   * 调用方已确认的 source 摘要，`null` 表示期望文件不存在（open-items W6 / CR-H7）。
   * 发布器自己读到的 `before` 与之不同就以 `source-changed` 拒绝、不建目录也不写：CAS 基底是
   * 调用方确认过的 source，而不是发布器的二次读。缺省不校验。只有发布接受这个选项。
   */
  readonly expectedSourceDigest?: Sha256Digest | null;
}

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
  | "input"
  | "directory-policy"
  | "source-policy"
  | "transition-blocked"
  | "source-changed"
  | "root-scope"
  | "aborted"
  | "recovery-required"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Claude Code portable settings publication input is invalid.",
  "directory-policy": "Claude Code settings directory violates its node policy.",
  "source-policy": "Claude Code portable settings source violates its node policy.",
  "transition-blocked": "Claude Code portable settings transition is blocked.",
  "source-changed": "Claude Code portable settings source changed before publication.",
  "root-scope": "Claude Code portable settings publication lost root scope.",
  aborted: "Claude Code portable settings publication was aborted.",
  "recovery-required": "Claude Code portable settings publication requires recovery.",
  "operation-failure": "Claude Code portable settings publication failed.",
} as const satisfies Readonly<Record<ClaudeCodePortableSettingsPublicationErrorReason, string>>;

/** Claude Code portable settings 发布失败的稳定、脱敏错误。 */
export class ClaudeCodePortableSettingsPublicationError extends Error {
  override readonly name = "ClaudeCodePortableSettingsPublicationError";
  readonly code = "wakeflow-claude-code-portable-settings-publication" as const;
  readonly reason: ClaudeCodePortableSettingsPublicationErrorReason;
  readonly path: string;
  readonly transitionReason: ClaudeCodePortableSettingsTransitionReason | null;

  constructor(
    reason: ClaudeCodePortableSettingsPublicationErrorReason,
    path: string,
    transitionReason: ClaudeCodePortableSettingsTransitionReason | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
    this.transitionReason = transitionReason;
  }
}

const MAXIMUM_SETTINGS_BYTES = parseByteCount(1024 * 1024);

interface ParsedOptions {
  readonly signal: AbortSignal | undefined;
  readonly rules: readonly string[] | undefined;
  readonly retiredRules: readonly string[] | undefined;
  readonly expectedSourceDigest: Sha256Digest | null | undefined;
}

const PUBLICATION_OPTION_KEYS: readonly string[] = Object.freeze([
  "signal",
  "rules",
  "retiredRules",
]);
const PUBLISH_OPTION_KEYS: readonly string[] = Object.freeze([
  ...PUBLICATION_OPTION_KEYS,
  "expectedSourceDigest",
]);

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
): never {
  throw new ClaudeCodePortableSettingsPublicationError(reason, path, transitionReason);
}

function parseExpectedSourceDigest(value: unknown): Sha256Digest | null | undefined {
  if (value === undefined || value === null) return value;
  try {
    return parseSha256Digest(value, "$options.expectedSourceDigest");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", "$options.expectedSourceDigest");
    throw error;
  }
}

function parseOptions(value: unknown, allowedKeys: readonly string[]): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    Object.keys(record).some((key) => !allowedKeys.includes(key)) ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal))) ||
    (record.rules !== undefined &&
      (!Array.isArray(record.rules) || record.rules.some((entry) => typeof entry !== "string"))) ||
    (record.retiredRules !== undefined &&
      (!Array.isArray(record.retiredRules) ||
        record.retiredRules.some((entry) => typeof entry !== "string")))
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    signal: record.signal as AbortSignal | undefined,
    rules:
      record.rules === undefined
        ? undefined
        : Object.freeze([...(record.rules as readonly string[])]),
    retiredRules:
      record.retiredRules === undefined
        ? undefined
        : Object.freeze([...(record.retiredRules as readonly string[])]),
    expectedSourceDigest: parseExpectedSourceDigest(record.expectedSourceDigest),
  });
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
}

function assertDirectoryNode(node: Readonly<FileNodeSnapshot>): void {
  if (
    node.kind !== "directory" ||
    (node.permissionBits !== 0o700 && node.permissionBits !== 0o755) ||
    (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    fail("directory-policy", "$settingsDirectory");
  }
}

function assertSourceNode(node: Readonly<FileNodeSnapshot>): void {
  if (
    node.kind !== "file" ||
    node.permissionBits !== 0o644 ||
    node.linkCount !== 1n ||
    (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    fail("source-policy", "$settings");
  }
}

async function directoryNodeOrNull(
  root: RootedDirectory,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    const resource = await root.inspectExistingResource(CLAUDE_CODE_SETTINGS_DIRECTORY_REF);
    assertDirectoryNode(resource.node);
    return resource.node;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") return null;
    if (error instanceof ClaudeCodePortableSettingsPublicationError) throw error;
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

async function sourceOrNull(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<StableFileReadResult> | null> {
  let resource: Awaited<ReturnType<RootedDirectory["inspectExistingResource"]>>;
  try {
    resource = await root.inspectExistingResource(CLAUDE_CODE_PORTABLE_SETTINGS_REF);
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") return null;
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
  assertSourceNode(resource.node);
  try {
    return await readStableFile(root, CLAUDE_CODE_PORTABLE_SETTINGS_REF, {
      maximumBytes: MAXIMUM_SETTINGS_BYTES,
      expectedNode: resource.node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
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

async function inspectSource(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  rules: readonly string[] | undefined,
  retiredRules: readonly string[] | undefined,
): Promise<Readonly<SettingsSourceInspection>> {
  const directoryNode = await directoryNodeOrNull(root);
  const source = directoryNode === null ? null : await sourceOrNull(root, signal);
  let sourceText: string | null = null;
  if (source !== null) {
    try {
      sourceText = decodeUtf8(source.bytes, "$settings");
    } catch (error: unknown) {
      if (error instanceof Utf8Error) fail("source-policy", "$settings");
      throw error;
    }
  }
  const transition = planClaudeCodePortableSettingsTransition(sourceText, rules, retiredRules);
  return Object.freeze({ directoryNode, source, sourceText, transition });
}

/** 只读检查一个已授权根的 portable settings，不返回用户源文本或节点身份。 */
export async function inspectClaudeCodePortableSettings(
  rootValue: RootedDirectory,
  optionsValue: ClaudeCodePortableSettingsPublicationOptions = {},
): Promise<Readonly<ClaudeCodePortableSettingsInspection>> {
  if (
    typeof rootValue !== "object" ||
    rootValue === null ||
    types.isProxy(rootValue) ||
    !(rootValue instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  const options = parseOptions(optionsValue, PUBLICATION_OPTION_KEYS);
  if (options.signal?.aborted === true) fail("aborted", "$signal");
  const inspection = await inspectSource(
    rootValue,
    options.signal,
    options.rules,
    options.retiredRules,
  );
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
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("operation-failure", "$settingsDirectory");
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
      if (error.reason === "aborted") fail("aborted", "$signal");
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
      fail("operation-failure", "$settings");
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
  rootValue: RootedDirectory,
  optionsValue: ClaudeCodePortableSettingsPublishOptions = {},
): Promise<Readonly<ClaudeCodePortableSettingsPublicationResult>> {
  if (
    typeof rootValue !== "object" ||
    rootValue === null ||
    types.isProxy(rootValue) ||
    !(rootValue instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  const options = parseOptions(optionsValue, PUBLISH_OPTION_KEYS);
  if (options.signal?.aborted === true) fail("aborted", "$signal");
  const before = await inspectSource(
    rootValue,
    options.signal,
    options.rules,
    options.retiredRules,
  );
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
  await ensureSettingsDirectory(rootValue, before, options.signal);
  if (before.directoryNode === null) {
    const afterDirectory = await inspectSource(
      rootValue,
      options.signal,
      options.rules,
      options.retiredRules,
    );
    if (afterDirectory.source !== null || afterDirectory.transition.status !== "create") {
      fail("source-changed", "$settings");
    }
  }
  await publishTransition(rootValue, before, options.signal);
  const after = await inspectSource(rootValue, options.signal, options.rules, options.retiredRules);
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
  rootValue: RootedDirectory,
  optionsValue: ClaudeCodePortableSettingsPublicationOptions = {},
): Promise<void> {
  if (
    typeof rootValue !== "object" ||
    rootValue === null ||
    types.isProxy(rootValue) ||
    !(rootValue instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  const options = parseOptions(optionsValue, PUBLICATION_OPTION_KEYS);
  const directory = await directoryNodeOrNull(rootValue);
  if (directory !== null) {
    try {
      const recovery = await recoverDurableAtomicFileStagesForTargets(
        rootValue,
        [CLAUDE_CODE_PORTABLE_SETTINGS_REF],
        options.signal === undefined ? undefined : { signal: options.signal },
      );
      if (recovery.activeStageCount !== 0 || recovery.unknownStageCount !== 0) {
        fail("recovery-required", "$settingsStage");
      }
    } catch (error: unknown) {
      if (error instanceof ClaudeCodePortableSettingsPublicationError) throw error;
      if (error instanceof DurableAtomicFileStageRecoveryError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        if (error.reason === "root-scope") fail("root-scope", "$root");
        fail("recovery-required", "$settingsStage");
      }
      throw error;
    }
  }
}
