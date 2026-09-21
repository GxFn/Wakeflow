import { types } from "node:util";

import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
  WakeflowConfigError,
  type WakeflowConfigModel,
} from "../../configuration/wakeflow-config.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
  type StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  createWakeflowExternalInstructionBodyAuthority,
  listWakeflowExternalInstructionTargets,
  parseWakeflowExternalInstructionTarget,
  wakeflowExternalInstructionTargetKey,
  WakeflowExternalInstructionBodyAuthorityError,
  type WakeflowExternalInstructionBodyAuthority,
  type WakeflowExternalInstructionTarget,
} from "./wakeflow-external-instruction-body-authority.js";
import {
  planWakeflowManagedTextAuthorityTransition,
  WakeflowManagedTextAuthorityTransitionError,
  type WakeflowManagedTextAuthorityTransition,
} from "./wakeflow-managed-text-authority-transition.js";

/**
 * Wakeflow Workspace / Managed Integration：外部根托管块的只读文件检查。
 *
 * 根是产品仓库或 external-owned 支撑面的根目录，由调用方按 Config placement 打开；
 * 本模块只读取其中当前宿主的指令文件，把 current/desired Config 各自推导出的正文权威
 * 与 Managed Text current→desired 转换组合为零写入候选。current Config 里该 target
 * 不是 managed-block 时没有可准入的前序正文，等价于 fresh 的空 current。
 *
 * 文件由外部所有者拥有：权限位不做要求，但必须是当前用户拥有的单链接普通文件。合法
 * marker 但正文未知时拒绝，绝不覆盖用户在受管区域内的改动。本模块不取得锁、不发布，
 * 也不把传入 Config 证明成已提交的 workspace authority。
 */

export const WAKEFLOW_EXTERNAL_INSTRUCTION_MAXIMUM_BYTES = parseByteCount(
  2 * 1024 * 1024,
  "$externalInstruction.maximumBytes",
);
export const WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE = 0o644;

export interface WakeflowExternalInstructionInspection {
  readonly status: "managed-current" | "recompose-required";
  readonly target: Readonly<WakeflowExternalInstructionTarget>;
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfigDigest: Sha256Digest;
  readonly currentAuthority:
    Readonly<WakeflowExternalInstructionBodyAuthority> | null;
  readonly desiredAuthority: Readonly<WakeflowExternalInstructionBodyAuthority>;
  readonly source: Readonly<StableFileSource> | null;
  readonly transition: Readonly<WakeflowManagedTextAuthorityTransition>;
}

export interface WakeflowExternalInstructionInspectionRequest {
  readonly profile: unknown;
  readonly target: unknown;
  readonly currentConfig: unknown | null;
  readonly expectedCurrentConfigDigest: Sha256Digest | null;
  readonly desiredConfig: unknown;
  readonly expectedDesiredConfigDigest: Sha256Digest;
  readonly signal?: AbortSignal;
}

export type WakeflowExternalInstructionInspectionErrorReason =
  | "input"
  | "unsupported-platform"
  | "authority"
  | "source"
  | "source-capacity"
  | "source-policy"
  | "envelope"
  | "unknown-managed-body"
  | "target-capacity"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Wakeflow external instruction inspection input is invalid.",
  "unsupported-platform":
    "Wakeflow external instruction inspection requires POSIX ownership facts.",
  authority: "Wakeflow external instruction content authority is invalid.",
  source: "Wakeflow external instruction source cannot be read stably.",
  "source-capacity":
    "Wakeflow external instruction source exceeds its byte budget.",
  "source-policy":
    "Wakeflow external instruction source violates its node policy.",
  envelope: "Wakeflow external instruction managed envelope is invalid.",
  "unknown-managed-body":
    "Wakeflow external instruction managed body is not an admitted render.",
  "target-capacity":
    "Wakeflow external instruction candidate exceeds its byte budget.",
  aborted: "Wakeflow external instruction inspection was aborted.",
} as const satisfies Readonly<Record<
  WakeflowExternalInstructionInspectionErrorReason,
  string
>>;

/** 外部指令只读检查失败的稳定、脱敏错误。 */
export class WakeflowExternalInstructionInspectionError extends Error {
  override readonly name = "WakeflowExternalInstructionInspectionError";
  readonly code = "wakeflow-external-instruction-inspection" as const;
  readonly reason: WakeflowExternalInstructionInspectionErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowExternalInstructionInspectionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

export interface ParsedWakeflowExternalInstructionInspectionRequest {
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly target: Readonly<WakeflowExternalInstructionTarget>;
  readonly currentConfig: WakeflowConfigModel | null;
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfig: WakeflowConfigModel;
  readonly desiredConfigDigest: Sha256Digest;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: WakeflowExternalInstructionInspectionErrorReason,
  path: string,
): never {
  throw new WakeflowExternalInstructionInspectionError(reason, path);
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", path);
    throw error;
  }
}

function parseConfig(value: unknown, path: string): WakeflowConfigModel {
  try {
    return parseWakeflowConfig(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigError) fail("input", path);
    throw error;
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function hasTarget(
  config: WakeflowConfigModel,
  target: Readonly<WakeflowExternalInstructionTarget>,
): boolean {
  const key = wakeflowExternalInstructionTargetKey(target);
  return listWakeflowExternalInstructionTargets(config).some(
    (candidate) => wakeflowExternalInstructionTargetKey(candidate) === key,
  );
}

/** 快照并绑定 Host Profile、target 与 current/desired Config 摘要。 */
export function parseWakeflowExternalInstructionInspectionRequest(
  value: unknown,
): Readonly<ParsedWakeflowExternalInstructionInspectionRequest> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$request");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$request");
    throw error;
  }
  const keys = Object.keys(record).sort();
  const requiredKeys = [
    "currentConfig",
    "desiredConfig",
    "expectedCurrentConfigDigest",
    "expectedDesiredConfigDigest",
    "profile",
    "target",
  ];
  const validKeys = record.signal === undefined
    ? requiredKeys
    : [...requiredKeys, "signal"].sort();
  if (
    keys.length !== validKeys.length
    || keys.some((key, index) => key !== validKeys[index])
    || (record.signal !== undefined && !isAbortSignal(record.signal))
  ) {
    fail("input", "$request");
  }
  let profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  try {
    profile = parseWakeflowWorkspaceHostResourceProfile(record.profile);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("input", "$request.profile");
    }
    throw error;
  }
  let target: Readonly<WakeflowExternalInstructionTarget>;
  try {
    target = parseWakeflowExternalInstructionTarget(
      record.target,
      "$request.target",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowExternalInstructionBodyAuthorityError) {
      fail("input", error.path);
    }
    throw error;
  }
  const desiredConfig = parseConfig(
    record.desiredConfig,
    "$request.desiredConfig",
  );
  const desiredConfigDigest = parseDigest(
    record.expectedDesiredConfigDigest,
    "$request.expectedDesiredConfigDigest",
  );
  if (computeWakeflowConfigDigest(desiredConfig) !== desiredConfigDigest) {
    fail("input", "$request.expectedDesiredConfigDigest");
  }
  if (!hasTarget(desiredConfig, target)) fail("input", "$request.target");
  let currentConfig: WakeflowConfigModel | null;
  let currentConfigDigest: Sha256Digest | null;
  if (record.currentConfig === null) {
    if (record.expectedCurrentConfigDigest !== null) {
      fail("input", "$request.expectedCurrentConfigDigest");
    }
    currentConfig = null;
    currentConfigDigest = null;
  } else {
    currentConfig = parseConfig(record.currentConfig, "$request.currentConfig");
    currentConfigDigest = parseDigest(
      record.expectedCurrentConfigDigest,
      "$request.expectedCurrentConfigDigest",
    );
    if (computeWakeflowConfigDigest(currentConfig) !== currentConfigDigest) {
      fail("input", "$request.expectedCurrentConfigDigest");
    }
    if (currentConfig.program.programId !== desiredConfig.program.programId) {
      fail("input", "$request.desiredConfig.program.programId");
    }
  }
  return Object.freeze({
    profile,
    target,
    currentConfig,
    currentConfigDigest,
    desiredConfig,
    desiredConfigDigest,
    signal: record.signal as AbortSignal | undefined,
  });
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function currentUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail("unsupported-platform", "$root");
  }
  return BigInt(process.geteuid());
}

async function readSource(
  root: RootedDirectory,
  request: Readonly<ParsedWakeflowExternalInstructionInspectionRequest>,
  expectedUserId: bigint,
): Promise<Readonly<{
  readonly facts: Readonly<StableFileSource>;
  readonly bytes: Uint8Array;
}> | null> {
  try {
    const read = await readStableFile(root, request.profile.instructionFileName, {
      maximumBytes: WAKEFLOW_EXTERNAL_INSTRUCTION_MAXIMUM_BYTES,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (
      read.node.kind !== "file"
      || read.node.linkCount !== 1n
      || read.node.userId !== expectedUserId
    ) {
      fail("source-policy", "$source");
    }
    return Object.freeze({
      facts: Object.freeze({
        resourcePath: read.resourcePath,
        node: read.node,
        byteCount: read.byteCount,
        digest: read.digest,
      }),
      bytes: read.bytes,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowExternalInstructionInspectionError) throw error;
    if (error instanceof StableFileReadError) {
      if (error.reason === "not-found") return null;
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "symlink" || error.reason === "not-file") {
        fail("source-policy", "$source");
      }
      if (error.reason === "too-large") fail("source-capacity", "$source");
      fail("source", "$source");
    }
    throw error;
  }
}

async function revalidateSource(
  root: RootedDirectory,
  request: Readonly<ParsedWakeflowExternalInstructionInspectionRequest>,
  initial: Awaited<ReturnType<typeof readSource>>,
): Promise<void> {
  try {
    const current = await readStableFile(
      root,
      request.profile.instructionFileName,
      {
        maximumBytes: WAKEFLOW_EXTERNAL_INSTRUCTION_MAXIMUM_BYTES,
        ...(initial === null ? {} : { expectedNode: initial.facts.node }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    if (
      initial === null
      || current.digest !== initial.facts.digest
      || current.byteCount !== initial.facts.byteCount
    ) {
      fail("source", "$source");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowExternalInstructionInspectionError) throw error;
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (initial === null && error.reason === "not-found") return;
      fail("source", "$source");
    }
    throw error;
  }
}

function createAuthority(
  config: WakeflowConfigModel,
  request: Readonly<ParsedWakeflowExternalInstructionInspectionRequest>,
): Readonly<WakeflowExternalInstructionBodyAuthority> {
  try {
    return createWakeflowExternalInstructionBodyAuthority(
      config,
      request.profile,
      request.target,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowExternalInstructionBodyAuthorityError) {
      fail("authority", error.path);
    }
    throw error;
  }
}

/** 稳定检查一个外部根里当前宿主的指令文件并生成零写入的 current 或重组候选。 */
export async function inspectWakeflowExternalInstruction(
  rootValue: unknown,
  requestValue: WakeflowExternalInstructionInspectionRequest,
): Promise<Readonly<WakeflowExternalInstructionInspection>> {
  assertRoot(rootValue);
  const request = parseWakeflowExternalInstructionInspectionRequest(requestValue);
  if (request.signal?.aborted === true) fail("aborted", "$signal");
  const currentAuthority =
    request.currentConfig !== null && hasTarget(request.currentConfig, request.target)
      ? createAuthority(request.currentConfig, request)
      : null;
  const desiredAuthority = createAuthority(request.desiredConfig, request);
  const read = await readSource(rootValue, request, currentUserId());
  let transition: Readonly<WakeflowManagedTextAuthorityTransition>;
  try {
    transition = planWakeflowManagedTextAuthorityTransition(
      read?.bytes ?? new Uint8Array(),
      {
        currentTargets: currentAuthority === null
          ? []
          : [currentAuthority.envelopeTarget],
        desiredTarget: desiredAuthority.envelopeTarget,
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowManagedTextAuthorityTransitionError) {
      if (error.reason === "unadmitted-source") {
        fail("unknown-managed-body", "$source");
      }
      if (error.reason === "relation" || error.reason === "envelope") {
        fail("envelope", "$source");
      }
      fail("authority", error.path);
    }
    throw error;
  }
  if (
    transition.target !== null
    && transition.target.byteCount > WAKEFLOW_EXTERNAL_INSTRUCTION_MAXIMUM_BYTES
  ) {
    fail("target-capacity", "$target");
  }
  await revalidateSource(rootValue, request, read);
  return Object.freeze({
    status: transition.disposition === "current"
      ? "managed-current"
      : "recompose-required",
    target: request.target,
    currentConfigDigest: request.currentConfigDigest,
    desiredConfigDigest: request.desiredConfigDigest,
    currentAuthority,
    desiredAuthority,
    source: read?.facts ?? null,
    transition,
  });
}
