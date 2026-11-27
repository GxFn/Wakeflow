import type { WakeflowConfigModel } from "../../configuration/wakeflow-config.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type {
  WakeflowWorkspaceHostId,
  WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import type {
  WakeflowHostMaintenanceContribution,
  WakeflowHostMaintenanceOperation,
} from "./wakeflow-host-maintenance-contribution.js";
import type { WakeflowMaintenanceGateContext } from "./wakeflow-maintenance-gate.js";
import type { WakeflowStaticMaterializationAction } from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：当前宿主维护能力的依赖反转端口。
 *
 * 一次执行最多接收一个与 Host Profile 精确匹配的 capability。该端口不是 registry；
 * 宿主实现内部仍需使用闭合 dispatcher，并在每个真实效果前重新验证自身操作合同。
 */

export interface PlanWakeflowHostMaintenanceContributionRequest {
  readonly action: WakeflowStaticMaterializationAction;
  readonly config: WakeflowConfigModel;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly signal?: AbortSignal;
}

export interface ExecuteWakeflowHostMaintenanceOperationRequest {
  readonly config: WakeflowConfigModel;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly operation: Readonly<WakeflowHostMaintenanceOperation>;
  readonly recoveringAffectedOperation: boolean;
  readonly signal?: AbortSignal;
}

export interface WakeflowHostMaintenanceOperationReceipt {
  readonly operationId: string;
  readonly disposition: "current" | "created" | "updated";
  readonly observationDigest: Sha256Digest;
}

export interface WakeflowHostMaintenanceCapability {
  readonly kind: "WakeflowHostMaintenanceCapability";
  readonly hostId: WakeflowWorkspaceHostId;
  readonly capabilityId: string;
  readonly planContribution: (
    root: RootedDirectory,
    request: PlanWakeflowHostMaintenanceContributionRequest,
  ) => Promise<Readonly<WakeflowHostMaintenanceContribution>>;
  readonly executeOperation: (
    root: RootedDirectory,
    context: Readonly<WakeflowMaintenanceGateContext>,
    request: ExecuteWakeflowHostMaintenanceOperationRequest,
  ) => Promise<Readonly<WakeflowHostMaintenanceOperationReceipt>>;
}

export type WakeflowHostMaintenanceCapabilityErrorReason = "contribution";

/** 当前宿主 capability 准入失败的稳定、脱敏错误。 */
export class WakeflowHostMaintenanceCapabilityError extends ModuleError<WakeflowHostMaintenanceCapabilityErrorReason> {
  static override readonly code = "wakeflow-host-maintenance-capability";
}

const fail: Fail<WakeflowHostMaintenanceCapabilityErrorReason> = failWith(
  WakeflowHostMaintenanceCapabilityError,
);

/** 验证 contribution 确由当前 capability 的公开身份命名。 */
export function assertWakeflowHostMaintenanceContributionCapability(
  capability: Readonly<WakeflowHostMaintenanceCapability>,
  contribution: Readonly<WakeflowHostMaintenanceContribution>,
): void {
  if (
    contribution.hostId !== capability.hostId ||
    contribution.capabilityId !== capability.capabilityId
  ) {
    fail("contribution", "$contribution");
  }
}
