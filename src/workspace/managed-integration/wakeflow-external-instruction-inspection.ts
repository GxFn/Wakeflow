import type { WakeflowConfigModel } from "../../configuration/wakeflow-config.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { StableFileSource } from "../../foundation/filesystem/stable-file-read.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";
import {
  createWakeflowExternalInstructionBodyAuthority,
  listWakeflowExternalInstructionTargets,
  type WakeflowExternalInstructionBodyAuthority,
  WakeflowExternalInstructionBodyAuthorityError,
  type WakeflowExternalInstructionTarget,
  wakeflowExternalInstructionTargetKey,
} from "./wakeflow-external-instruction-body-authority.js";
import {
  inspectWakeflowManagedBlockFile,
  WakeflowManagedBlockFileError,
  type WakeflowManagedBlockFileInspection,
  type WakeflowManagedBlockFileRequest,
} from "./wakeflow-managed-block-file.js";
import type { WakeflowManagedTextAuthorityTransition } from "./wakeflow-managed-text-authority-transition.js";
import {
  historicalWakeflowManagedTextTargets,
  WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_HISTORY,
} from "./wakeflow-managed-text-history.js";

/**
 * Wakeflow Workspace / Managed Integration：外部根托管块的只读文件检查。
 *
 * 根是产品仓库或 external-owned 支撑面的根目录，由调用方按 Config placement 打开；
 * 本模块只推导 current/desired Config 各自的正文权威，把文件的机械部分（当前用户拥有的
 * 单链接普通文件、权限位不限、current→desired 转换、合法 marker 但正文未知即拒绝）交给
 * 通用托管块文件 owner `wakeflow-managed-block-file.ts`（§13.114 D1）。current Config 里
 * 该 target 不是 managed-block 时没有可准入的前序正文，等价于 fresh 的空 current。
 * 本模块不取得锁、不发布，也不把传入 Config 证明成已提交的 workspace authority。
 */

const WAKEFLOW_EXTERNAL_INSTRUCTION_MAXIMUM_BYTES = parseByteCount(
  2 * 1024 * 1024,
  "$externalInstruction.maximumBytes",
);
export const WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE = 0o644;

export interface WakeflowExternalInstructionInspection {
  readonly status: "managed-current" | "recompose-required";
  readonly target: Readonly<WakeflowExternalInstructionTarget>;
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfigDigest: Sha256Digest;
  readonly currentAuthority: Readonly<WakeflowExternalInstructionBodyAuthority> | null;
  readonly desiredAuthority: Readonly<WakeflowExternalInstructionBodyAuthority>;
  readonly source: Readonly<StableFileSource> | null;
  readonly transition: Readonly<WakeflowManagedTextAuthorityTransition>;
}

export interface WakeflowExternalInstructionInspectionRequest {
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly target: Readonly<WakeflowExternalInstructionTarget>;
  readonly currentConfig: WakeflowConfigModel | null;
  readonly expectedCurrentConfigDigest: Sha256Digest | null;
  readonly desiredConfig: WakeflowConfigModel;
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
  | "target-capacity";

/** 外部指令只读检查失败的稳定、脱敏错误。 */
export class WakeflowExternalInstructionInspectionError extends ModuleError<WakeflowExternalInstructionInspectionErrorReason> {
  static override readonly code = "wakeflow-external-instruction-inspection";
}

const fail: Fail<WakeflowExternalInstructionInspectionErrorReason> = failWith(
  WakeflowExternalInstructionInspectionError,
);

export interface ParsedWakeflowExternalInstructionInspectionRequest {
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly target: Readonly<WakeflowExternalInstructionTarget>;
  readonly currentConfig: WakeflowConfigModel | null;
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfig: WakeflowConfigModel;
  readonly desiredConfigDigest: Sha256Digest;
  readonly signal: AbortSignal | undefined;
}

/** 从 current / desired Config 推导出的两份正文权威；current 里没有该 target 时为 null。 */
export interface WakeflowExternalInstructionAuthorities {
  readonly currentAuthority: Readonly<WakeflowExternalInstructionBodyAuthority> | null;
  readonly desiredAuthority: Readonly<WakeflowExternalInstructionBodyAuthority>;
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

/**
 * 把调用方已类型化的请求换成执行用的形状。唯一保留的检查是 current 与 desired 是同一个 program：
 * reconfigure 的 desired Config 来自公共请求，current 来自盘上，这是两者第一次相遇的地方（A-spec R10）；
 * 改了 programId 的 reconfigure 由此在预览时被阻塞，而不是在发布配置那一步才失败。
 */
export function wakeflowExternalInstructionRequestModel(
  request: Omit<WakeflowExternalInstructionInspectionRequest, "signal">,
  signal: AbortSignal | undefined,
): Readonly<ParsedWakeflowExternalInstructionInspectionRequest> {
  if (
    request.currentConfig !== null &&
    request.currentConfig.program.programId !== request.desiredConfig.program.programId
  ) {
    fail("input", "$request.desiredConfig.program.programId");
  }
  return Object.freeze({
    profile: request.profile,
    target: request.target,
    currentConfig: request.currentConfig,
    currentConfigDigest: request.expectedCurrentConfigDigest,
    desiredConfig: request.desiredConfig,
    desiredConfigDigest: request.expectedDesiredConfigDigest,
    signal,
  });
}

function createAuthority(
  config: WakeflowConfigModel,
  request: Readonly<ParsedWakeflowExternalInstructionInspectionRequest>,
): Readonly<WakeflowExternalInstructionBodyAuthority> {
  try {
    return createWakeflowExternalInstructionBodyAuthority(config, request.profile, request.target);
  } catch (error: unknown) {
    if (error instanceof WakeflowExternalInstructionBodyAuthorityError) {
      fail("authority", error.path, error);
    }
    throw error;
  }
}

/** 推导两份正文权威：current Config 里该 target 不是 managed-block 时没有前序正文。 */
export function deriveWakeflowExternalInstructionAuthorities(
  request: Readonly<ParsedWakeflowExternalInstructionInspectionRequest>,
): Readonly<WakeflowExternalInstructionAuthorities> {
  return Object.freeze({
    currentAuthority:
      request.currentConfig !== null && hasTarget(request.currentConfig, request.target)
        ? createAuthority(request.currentConfig, request)
        : null,
    desiredAuthority: createAuthority(request.desiredConfig, request),
  });
}

/** 通用托管块文件 owner 的请求：当前宿主的指令文件、两份 envelope target、2 MiB 上限。 */
export function wakeflowExternalInstructionManagedBlockFileRequest(
  request: Readonly<ParsedWakeflowExternalInstructionInspectionRequest>,
  authorities: Readonly<WakeflowExternalInstructionAuthorities>,
  signal: AbortSignal | undefined,
): WakeflowManagedBlockFileRequest {
  return {
    resourcePath: request.profile.instructionFileName,
    // C5（§13.167）：前序渲染作为额外 current 目标准入。
    currentTargets:
      authorities.currentAuthority === null
        ? []
        : [
            authorities.currentAuthority.envelopeTarget,
            ...historicalWakeflowManagedTextTargets(
              WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_HISTORY,
              authorities.currentAuthority.envelopeTarget,
              request.currentConfig,
              request.profile,
              request.target,
            ),
          ],
    desiredTarget: authorities.desiredAuthority.envelopeTarget,
    maximumBytes: WAKEFLOW_EXTERNAL_INSTRUCTION_MAXIMUM_BYTES,
    ...(signal === undefined ? {} : { signal }),
  };
}

/** 把通用 owner 的检查结果套回外部指令的合同：加 target、Config 摘要与两份权威。 */
export function wakeflowExternalInstructionInspectionOf(
  request: Readonly<ParsedWakeflowExternalInstructionInspectionRequest>,
  authorities: Readonly<WakeflowExternalInstructionAuthorities>,
  inspection: Readonly<WakeflowManagedBlockFileInspection>,
): Readonly<WakeflowExternalInstructionInspection> {
  return Object.freeze({
    status: inspection.status,
    target: request.target,
    currentConfigDigest: request.currentConfigDigest,
    desiredConfigDigest: request.desiredConfigDigest,
    currentAuthority: authorities.currentAuthority,
    desiredAuthority: authorities.desiredAuthority,
    source: inspection.source,
    transition: inspection.transition,
  });
}

/** 通用 owner 的只读失败映射回外部指令检查的词汇；写入类原因在只读路径上不会出现。 */
function mapManagedBlockFileError(error: WakeflowManagedBlockFileError): never {
  switch (error.reason) {
    case "input":
      return fail("input", error.path);
    case "unsupported-platform":
    case "source":
    case "source-capacity":
    case "source-policy":
    case "envelope":
    case "unknown-managed-body":
    case "target-capacity":
      return fail(error.reason, error.path);
    default:
      return fail("source", "$source");
  }
}

/** 稳定检查一个外部根里当前宿主的指令文件并生成零写入的 current 或重组候选。 */
export async function inspectWakeflowExternalInstruction(
  root: RootedDirectory,
  { signal, ...requestValue }: WakeflowExternalInstructionInspectionRequest,
): Promise<Readonly<WakeflowExternalInstructionInspection>> {
  const request = wakeflowExternalInstructionRequestModel(requestValue, signal);
  throwIfAborted(request.signal);
  const authorities = deriveWakeflowExternalInstructionAuthorities(request);
  let inspection: Readonly<WakeflowManagedBlockFileInspection>;
  try {
    inspection = await inspectWakeflowManagedBlockFile(
      root,
      wakeflowExternalInstructionManagedBlockFileRequest(request, authorities, request.signal),
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowManagedBlockFileError) mapManagedBlockFileError(error);
    throw error;
  }
  return wakeflowExternalInstructionInspectionOf(request, authorities, inspection);
}
