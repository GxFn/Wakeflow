import { types } from "node:util";

import type { WakeflowConfigV3Model } from "../../configuration/wakeflow-config-v3.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type {
  WakeflowWorkspaceHostId,
  WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import type { WakeflowMaintenanceGateContext } from "./wakeflow-maintenance-gate.js";
import type {
  WakeflowHostMaintenanceContribution,
  WakeflowHostMaintenanceOperation,
} from "./wakeflow-host-maintenance-contribution.js";
import type {
  WakeflowStaticMaterializationAction,
} from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：当前宿主维护能力的依赖反转端口。
 *
 * 一次执行最多接收一个与 Host Profile 精确匹配的 capability。该端口不是 registry；
 * 宿主实现内部仍需使用闭合 dispatcher，并在每个真实效果前重新验证自身操作合同。
 */

export interface PlanWakeflowHostMaintenanceContributionRequest {
  readonly action: WakeflowStaticMaterializationAction;
  readonly config: WakeflowConfigV3Model;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly signal?: AbortSignal;
}

export interface ExecuteWakeflowHostMaintenanceOperationRequest {
  readonly config: WakeflowConfigV3Model;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly operation: Readonly<WakeflowHostMaintenanceOperation>;
  readonly recoveringAffectedOperation: boolean;
  readonly signal?: AbortSignal;
}

export interface WakeflowHostMaintenanceOperationReceipt {
  readonly kind: "WakeflowHostMaintenanceOperationReceipt";
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

export type WakeflowHostMaintenanceCapabilityErrorReason =
  | "input"
  | "host"
  | "identity"
  | "contribution";

const ERROR_MESSAGES = {
  input: "Wakeflow host maintenance capability input is invalid.",
  host: "Wakeflow host maintenance capability does not match the current host.",
  identity: "Wakeflow host maintenance capability identity is invalid.",
  contribution: "Wakeflow host maintenance contribution does not match its capability.",
} as const satisfies Readonly<Record<
  WakeflowHostMaintenanceCapabilityErrorReason,
  string
>>;

/** 当前宿主 capability 准入失败的稳定、脱敏错误。 */
export class WakeflowHostMaintenanceCapabilityError extends Error {
  override readonly name = "WakeflowHostMaintenanceCapabilityError";
  readonly code = "wakeflow-host-maintenance-capability" as const;
  readonly reason: WakeflowHostMaintenanceCapabilityErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowHostMaintenanceCapabilityErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function fail(
  reason: WakeflowHostMaintenanceCapabilityErrorReason,
  path: string,
): never {
  throw new WakeflowHostMaintenanceCapabilityError(reason, path);
}

/** 验证一次执行所提供的唯一 capability 与当前宿主精确对应。 */
export function assertWakeflowHostMaintenanceCapability(
  value: unknown,
  expectedHostId: WakeflowWorkspaceHostId,
): asserts value is Readonly<WakeflowHostMaintenanceCapability> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$capability");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
  if (
    !Object.isFrozen(value)
    ||
    Object.keys(record).sort().join("\u0000")
      !== "capabilityId\u0000executeOperation\u0000hostId\u0000kind\u0000planContribution"
    || record.kind !== "WakeflowHostMaintenanceCapability"
    || record.hostId !== expectedHostId
    || typeof record.capabilityId !== "string"
    || !CAPABILITY_ID_PATTERN.test(record.capabilityId)
    || typeof record.planContribution !== "function"
    || types.isProxy(record.planContribution)
    || typeof record.executeOperation !== "function"
    || types.isProxy(record.executeOperation)
  ) {
    fail(record.hostId === expectedHostId ? "identity" : "host", "$capability");
  }
}

/** 验证 contribution 确由当前 capability 的公开身份命名。 */
export function assertWakeflowHostMaintenanceContributionCapability(
  capability: Readonly<WakeflowHostMaintenanceCapability>,
  contribution: Readonly<WakeflowHostMaintenanceContribution>,
): void {
  if (
    contribution.hostId !== capability.hostId
    || contribution.capabilityId !== capability.capabilityId
  ) {
    fail("contribution", "$contribution");
  }
}
