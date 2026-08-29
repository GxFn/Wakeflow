import { types } from "node:util";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  RootedDirectory,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
  type StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import {
  createWakeflowWorkspaceStaticResourceOperationContext,
  WakeflowWorkspaceStaticResourceOperationContextError,
  type WakeflowWorkspaceStaticResourceOperationContext,
} from "../wakeflow-workspace-static-resource-operation-context.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
  parseWakeflowWorkspaceStaticResourceMatrix,
  WakeflowWorkspaceStaticResourceMatrixError,
  type WakeflowWorkspaceStaticResourceMatrix,
} from "../wakeflow-workspace-static-resource-matrix.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  planWakeflowManagedTextAuthorityTransition,
  WakeflowManagedTextAuthorityTransitionError,
  type WakeflowManagedTextAuthorityTransition,
} from "./wakeflow-managed-text-authority-transition.js";
import {
  createWakeflowProgramInstructionBodyAuthority,
  WakeflowProgramInstructionBodyAuthorityError,
  type WakeflowProgramInstructionBodyAuthority,
} from "./wakeflow-program-instruction-body-authority.js";

/**
 * Wakeflow Workspace / Managed Integration：Program Instruction 的只读文件检查。
 *
 * 本模块把当前/目标 Config 摘要、Host Profile、Static Resource Matrix、稳定文件读取
 * 与 Managed Text current→desired 转换组合为一个零写入候选。fresh 使用空 current，
 * reconcile 使用相同 current/desired，reconfigure 使用变更前后两个严格 Config。
 *
 * 检查只准入当前正文、目标正文或未受管 outside；合法 marker 但正文未知时拒绝。
 * 本模块不取得锁、不发布文件，也不把传入 Config 证明成已提交的 workspace authority；
 * 后续 maintenance confirmed plan 仍须绑定这些语义摘要与执行顺序。
 */

export const WAKEFLOW_PROGRAM_INSTRUCTION_MAXIMUM_BYTES = parseByteCount(
  2 * 1024 * 1024,
  "$programInstruction.maximumBytes",
);
export const WAKEFLOW_PROGRAM_INSTRUCTION_FILE_MODE = 0o644;

type WakeflowProgramInstructionInspectionStatus =
  | "managed-current"
  | "recompose-required";

export interface WakeflowProgramInstructionInspection {
  readonly status: WakeflowProgramInstructionInspectionStatus;
  readonly context: Readonly<WakeflowWorkspaceStaticResourceOperationContext>;
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfigDigest: Sha256Digest;
  readonly currentAuthority:
    Readonly<WakeflowProgramInstructionBodyAuthority> | null;
  readonly desiredAuthority:
    Readonly<WakeflowProgramInstructionBodyAuthority>;
  readonly source: Readonly<StableFileSource> | null;
  readonly transition: Readonly<WakeflowManagedTextAuthorityTransition>;
}

export interface WakeflowProgramInstructionInspectionRequest {
  readonly matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  readonly expectedMatrixDigest: Sha256Digest;
  readonly profile: unknown;
  readonly currentConfig: unknown | null;
  readonly expectedCurrentConfigDigest: Sha256Digest | null;
  readonly desiredConfig: unknown;
  readonly expectedDesiredConfigDigest: Sha256Digest;
  readonly signal?: AbortSignal;
}

export type WakeflowProgramInstructionInspectionErrorReason =
  | "input"
  | "unsupported-platform"
  | "context"
  | "authority"
  | "source"
  | "source-capacity"
  | "source-policy"
  | "envelope"
  | "unknown-managed-body"
  | "target-capacity"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Wakeflow Program Instruction inspection input is invalid.",
  "unsupported-platform":
    "Wakeflow Program Instruction inspection requires POSIX ownership facts.",
  context: "Wakeflow Program Instruction operation context is invalid.",
  authority: "Wakeflow Program Instruction content authority is invalid.",
  source: "Wakeflow Program Instruction source cannot be read stably.",
  "source-capacity":
    "Wakeflow Program Instruction source exceeds its byte budget.",
  "source-policy":
    "Wakeflow Program Instruction source violates its node policy.",
  envelope: "Wakeflow Program Instruction managed envelope is invalid.",
  "unknown-managed-body":
    "Wakeflow Program Instruction managed body is not an admitted render.",
  "target-capacity":
    "Wakeflow Program Instruction candidate exceeds its byte budget.",
  aborted: "Wakeflow Program Instruction inspection was aborted.",
} as const satisfies Readonly<Record<
  WakeflowProgramInstructionInspectionErrorReason,
  string
>>;

/** Program Instruction 只读检查失败的稳定、脱敏错误。 */
export class WakeflowProgramInstructionInspectionError extends Error {
  override readonly name = "WakeflowProgramInstructionInspectionError";
  readonly code = "wakeflow-program-instruction-inspection" as const;
  readonly reason: WakeflowProgramInstructionInspectionErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowProgramInstructionInspectionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

export interface ParsedWakeflowProgramInstructionInspectionRequest {
  readonly matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  readonly expectedMatrixDigest: Sha256Digest;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly currentConfig: WakeflowConfigV3Model | null;
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfig: WakeflowConfigV3Model;
  readonly desiredConfigDigest: Sha256Digest;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: WakeflowProgramInstructionInspectionErrorReason,
  path: string,
): never {
  throw new WakeflowProgramInstructionInspectionError(reason, path);
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", path);
    throw error;
  }
}

function parseConfig(value: unknown, path: string): WakeflowConfigV3Model {
  try {
    return parseWakeflowConfigV3(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("input", path);
    throw error;
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

/** 快照并绑定 Matrix、Host Profile 与 current/desired Config 摘要。 */
export function parseWakeflowProgramInstructionInspectionRequest(
  value: unknown,
): Readonly<ParsedWakeflowProgramInstructionInspectionRequest> {
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
    "expectedMatrixDigest",
    "matrix",
    "profile",
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
  let matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  try {
    matrix = parseWakeflowWorkspaceStaticResourceMatrix(record.matrix);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceStaticResourceMatrixError) {
      fail("input", "$request.matrix");
    }
    throw error;
  }
  const expectedMatrixDigest = parseDigest(
    record.expectedMatrixDigest,
    "$request.expectedMatrixDigest",
  );
  if (expectedMatrixDigest !== matrix.matrixDigest) {
    fail("input", "$request.expectedMatrixDigest");
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
  if (
    profile.hostId !== matrix.hostId
    || createWakeflowWorkspaceStaticResourceMatrix(profile).matrixDigest
      !== matrix.matrixDigest
  ) {
    fail("input", "$request.matrix");
  }

  const desiredConfig = parseConfig(
    record.desiredConfig,
    "$request.desiredConfig",
  );
  const desiredConfigDigest = parseDigest(
    record.expectedDesiredConfigDigest,
    "$request.expectedDesiredConfigDigest",
  );
  if (computeWakeflowConfigV3Digest(desiredConfig) !== desiredConfigDigest) {
    fail("input", "$request.expectedDesiredConfigDigest");
  }
  let currentConfig: WakeflowConfigV3Model | null;
  let currentConfigDigest: Sha256Digest | null;
  if (record.currentConfig === null) {
    if (record.expectedCurrentConfigDigest !== null) {
      fail("input", "$request.expectedCurrentConfigDigest");
    }
    currentConfig = null;
    currentConfigDigest = null;
  } else {
    currentConfig = parseConfig(
      record.currentConfig,
      "$request.currentConfig",
    );
    currentConfigDigest = parseDigest(
      record.expectedCurrentConfigDigest,
      "$request.expectedCurrentConfigDigest",
    );
    if (
      computeWakeflowConfigV3Digest(currentConfig) !== currentConfigDigest
    ) {
      fail("input", "$request.expectedCurrentConfigDigest");
    }
    if (currentConfig.program.programId !== desiredConfig.program.programId) {
      fail("input", "$request.desiredConfig.program.programId");
    }
  }
  return Object.freeze({
    matrix,
    expectedMatrixDigest,
    profile,
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
  request: Readonly<ParsedWakeflowProgramInstructionInspectionRequest>,
  expectedUserId: bigint,
): Promise<Readonly<{
  readonly facts: Readonly<StableFileSource>;
  readonly bytes: Uint8Array;
}> | null> {
  try {
    const read = await readStableFile(
      root,
      request.profile.instructionFileName,
      {
        maximumBytes: WAKEFLOW_PROGRAM_INSTRUCTION_MAXIMUM_BYTES,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    if (
      read.node.kind !== "file"
      || read.node.permissionBits !== WAKEFLOW_PROGRAM_INSTRUCTION_FILE_MODE
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
    if (error instanceof WakeflowProgramInstructionInspectionError) {
      throw error;
    }
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
  request: Readonly<ParsedWakeflowProgramInstructionInspectionRequest>,
  initial: Awaited<ReturnType<typeof readSource>>,
): Promise<void> {
  try {
    const current = await readStableFile(
      root,
      request.profile.instructionFileName,
      {
        maximumBytes: WAKEFLOW_PROGRAM_INSTRUCTION_MAXIMUM_BYTES,
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
    if (error instanceof WakeflowProgramInstructionInspectionError) {
      throw error;
    }
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (initial === null && error.reason === "not-found") return;
      fail("source", "$source");
    }
    throw error;
  }
}

function createAuthority(
  config: WakeflowConfigV3Model,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): Readonly<WakeflowProgramInstructionBodyAuthority> {
  try {
    return createWakeflowProgramInstructionBodyAuthority(config, profile);
  } catch (error: unknown) {
    if (error instanceof WakeflowProgramInstructionBodyAuthorityError) {
      fail("authority", error.path);
    }
    throw error;
  }
}

/** 稳定检查当前宿主指令文件并生成零写入的 current 或重组候选。 */
export async function inspectWakeflowProgramInstruction(
  rootValue: unknown,
  requestValue: WakeflowProgramInstructionInspectionRequest,
): Promise<Readonly<WakeflowProgramInstructionInspection>> {
  assertRoot(rootValue);
  const request = parseWakeflowProgramInstructionInspectionRequest(
    requestValue,
  );
  if (request.signal?.aborted === true) fail("aborted", "$signal");
  let context: Readonly<WakeflowWorkspaceStaticResourceOperationContext>;
  try {
    context = createWakeflowWorkspaceStaticResourceOperationContext(
      request.matrix,
      {
        expectedMatrixDigest: request.expectedMatrixDigest,
        declarationId: `host-runtime.${request.profile.hostId}.instruction`,
        recipe: "exact-source-recompose",
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceStaticResourceOperationContextError) {
      fail("context", "$context");
    }
    throw error;
  }
  const currentAuthority = request.currentConfig === null
    ? null
    : createAuthority(request.currentConfig, request.profile);
  const desiredAuthority = createAuthority(
    request.desiredConfig,
    request.profile,
  );
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
      if (error.reason === "relation") fail("envelope", "$source");
      if (error.reason === "envelope") fail("envelope", "$source");
      fail("authority", error.path);
    }
    throw error;
  }
  if (
    transition.target !== null
    && transition.target.byteCount > WAKEFLOW_PROGRAM_INSTRUCTION_MAXIMUM_BYTES
  ) {
    fail("target-capacity", "$target");
  }
  await revalidateSource(rootValue, request, read);
  return Object.freeze({
    status: transition.disposition === "current"
      ? "managed-current"
      : "recompose-required",
    context,
    currentConfigDigest: request.currentConfigDigest,
    desiredConfigDigest: request.desiredConfigDigest,
    currentAuthority,
    desiredAuthority,
    source: read?.facts ?? null,
    transition,
  });
}
