import type { WakeflowConfigModel } from "../../configuration/wakeflow-config.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  readStableFileOrNull,
  StableFileReadError,
  type StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import { requireCurrentUserId } from "../../foundation/node/current-user.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import type { WakeflowWorkspaceStaticResourceMatrix } from "../wakeflow-workspace-static-resource-matrix.js";
import {
  createWakeflowWorkspaceStaticResourceOperationContext,
  type WakeflowWorkspaceStaticResourceOperationContext,
  WakeflowWorkspaceStaticResourceOperationContextError,
} from "../wakeflow-workspace-static-resource-operation-context.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";
import {
  planWakeflowManagedTextAuthorityTransition,
  type WakeflowManagedTextAuthorityTransition,
  WakeflowManagedTextAuthorityTransitionError,
} from "./wakeflow-managed-text-authority-transition.js";
import {
  historicalWakeflowManagedTextTargets,
  WAKEFLOW_PROGRAM_INSTRUCTION_BODY_HISTORY,
} from "./wakeflow-managed-text-history.js";
import {
  createWakeflowProgramInstructionBodyAuthority,
  type WakeflowProgramInstructionBodyAuthority,
  WakeflowProgramInstructionBodyAuthorityError,
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

const WAKEFLOW_PROGRAM_INSTRUCTION_MAXIMUM_BYTES = parseByteCount(
  2 * 1024 * 1024,
  "$programInstruction.maximumBytes",
);
export const WAKEFLOW_PROGRAM_INSTRUCTION_FILE_MODE = 0o644;

type WakeflowProgramInstructionInspectionStatus = "managed-current" | "recompose-required";

export interface WakeflowProgramInstructionInspection {
  readonly status: WakeflowProgramInstructionInspectionStatus;
  readonly context: Readonly<WakeflowWorkspaceStaticResourceOperationContext>;
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfigDigest: Sha256Digest;
  readonly currentAuthority: Readonly<WakeflowProgramInstructionBodyAuthority> | null;
  readonly desiredAuthority: Readonly<WakeflowProgramInstructionBodyAuthority>;
  readonly source: Readonly<StableFileSource> | null;
  readonly transition: Readonly<WakeflowManagedTextAuthorityTransition>;
}

export interface WakeflowProgramInstructionInspectionRequest {
  readonly matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  readonly expectedMatrixDigest: Sha256Digest;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly currentConfig: WakeflowConfigModel | null;
  readonly expectedCurrentConfigDigest: Sha256Digest | null;
  readonly desiredConfig: WakeflowConfigModel;
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
  | "target-capacity";

/** Program Instruction 只读检查失败的稳定、脱敏错误。 */
export class WakeflowProgramInstructionInspectionError extends ModuleError<WakeflowProgramInstructionInspectionErrorReason> {
  static override readonly code = "wakeflow-program-instruction-inspection";
}

const fail: Fail<WakeflowProgramInstructionInspectionErrorReason> = failWith(
  WakeflowProgramInstructionInspectionError,
);

export interface ParsedWakeflowProgramInstructionInspectionRequest {
  readonly matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  readonly expectedMatrixDigest: Sha256Digest;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly currentConfig: WakeflowConfigModel | null;
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfig: WakeflowConfigModel;
  readonly desiredConfigDigest: Sha256Digest;
  readonly signal: AbortSignal | undefined;
}

/**
 * 把调用方已类型化的请求换成执行用的形状。唯一保留的检查是 current 与 desired 是同一个 program：
 * reconfigure 的 desired Config 来自公共请求，current 来自盘上，这是两者第一次相遇的地方（A-spec R10）；
 * 改了 programId 的 reconfigure 由此在预览时以 `program-instruction-input` 阻塞。
 */
export function wakeflowProgramInstructionRequestModel(
  request: Omit<WakeflowProgramInstructionInspectionRequest, "signal">,
  signal: AbortSignal | undefined,
): Readonly<ParsedWakeflowProgramInstructionInspectionRequest> {
  if (
    request.currentConfig !== null &&
    request.currentConfig.program.programId !== request.desiredConfig.program.programId
  ) {
    fail("input", "$request.desiredConfig.program.programId");
  }
  return Object.freeze({
    matrix: request.matrix,
    expectedMatrixDigest: request.expectedMatrixDigest,
    profile: request.profile,
    currentConfig: request.currentConfig,
    currentConfigDigest: request.expectedCurrentConfigDigest,
    desiredConfig: request.desiredConfig,
    desiredConfigDigest: request.expectedDesiredConfigDigest,
    signal,
  });
}

function currentUserId(): bigint {
  return requireCurrentUserId(() => fail("unsupported-platform", "$root"));
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
    const read = await readStableFileOrNull(root, request.profile.instructionFileName, {
      maximumBytes: WAKEFLOW_PROGRAM_INSTRUCTION_MAXIMUM_BYTES,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (read === null) return null;
    if (
      read.node.kind !== "file" ||
      read.node.permissionBits !== WAKEFLOW_PROGRAM_INSTRUCTION_FILE_MODE ||
      read.node.linkCount !== 1n ||
      read.node.userId !== expectedUserId
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
      if (error.reason === "symlink" || error.reason === "not-file") {
        fail("source-policy", "$source", error);
      }
      if (error.reason === "too-large") fail("source-capacity", "$source", error);
      fail("source", "$source", error);
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
    const current = await readStableFile(root, request.profile.instructionFileName, {
      maximumBytes: WAKEFLOW_PROGRAM_INSTRUCTION_MAXIMUM_BYTES,
      ...(initial === null ? {} : { expectedNode: initial.facts.node }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (
      initial === null ||
      current.digest !== initial.facts.digest ||
      current.byteCount !== initial.facts.byteCount
    ) {
      fail("source", "$source");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowProgramInstructionInspectionError) {
      throw error;
    }
    if (error instanceof StableFileReadError) {
      if (initial === null && error.reason === "not-found") return;
      fail("source", "$source", error);
    }
    throw error;
  }
}

function createAuthority(
  config: WakeflowConfigModel,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): Readonly<WakeflowProgramInstructionBodyAuthority> {
  try {
    return createWakeflowProgramInstructionBodyAuthority(config, profile);
  } catch (error: unknown) {
    if (error instanceof WakeflowProgramInstructionBodyAuthorityError) {
      fail("authority", error.path, error);
    }
    throw error;
  }
}

/** 稳定检查当前宿主指令文件并生成零写入的 current 或重组候选。 */
export async function inspectWakeflowProgramInstruction(
  rootValue: RootedDirectory,
  { signal, ...requestValue }: WakeflowProgramInstructionInspectionRequest,
): Promise<Readonly<WakeflowProgramInstructionInspection>> {
  const request = wakeflowProgramInstructionRequestModel(requestValue, signal);
  throwIfAborted(request.signal);
  let context: Readonly<WakeflowWorkspaceStaticResourceOperationContext>;
  try {
    context = createWakeflowWorkspaceStaticResourceOperationContext(request.matrix, {
      expectedMatrixDigest: request.expectedMatrixDigest,
      declarationId: `host-runtime.${request.profile.hostId}.instruction`,
      recipe: "exact-source-recompose",
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceStaticResourceOperationContextError) {
      fail("context", "$context", error);
    }
    throw error;
  }
  const currentAuthority =
    request.currentConfig === null ? null : createAuthority(request.currentConfig, request.profile);
  const desiredAuthority = createAuthority(request.desiredConfig, request.profile);
  const read = await readSource(rootValue, request, currentUserId());
  let transition: Readonly<WakeflowManagedTextAuthorityTransition>;
  try {
    transition = planWakeflowManagedTextAuthorityTransition(read?.bytes ?? new Uint8Array(), {
      // C5（§13.167）：前序渲染作为额外 current 目标准入，旧正文被重组为当前渲染而不是阻塞。
      currentTargets:
        currentAuthority === null
          ? []
          : [
              currentAuthority.envelopeTarget,
              ...historicalWakeflowManagedTextTargets(
                WAKEFLOW_PROGRAM_INSTRUCTION_BODY_HISTORY,
                currentAuthority.envelopeTarget,
                request.currentConfig,
                request.profile,
              ),
            ],
      desiredTarget: desiredAuthority.envelopeTarget,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowManagedTextAuthorityTransitionError) {
      if (error.reason === "unadmitted-source") {
        fail("unknown-managed-body", "$source", error);
      }
      if (error.reason === "relation") fail("envelope", "$source", error);
      if (error.reason === "envelope") fail("envelope", "$source", error);
      fail("authority", error.path, error);
    }
    throw error;
  }
  if (
    transition.target !== null &&
    transition.target.byteCount > WAKEFLOW_PROGRAM_INSTRUCTION_MAXIMUM_BYTES
  ) {
    fail("target-capacity", "$target");
  }
  await revalidateSource(rootValue, request, read);
  return Object.freeze({
    status: transition.disposition === "current" ? "managed-current" : "recompose-required",
    context,
    currentConfigDigest: request.currentConfigDigest,
    desiredConfigDigest: request.desiredConfigDigest,
    currentAuthority,
    desiredAuthority,
    source: read?.facts ?? null,
    transition,
  });
}
