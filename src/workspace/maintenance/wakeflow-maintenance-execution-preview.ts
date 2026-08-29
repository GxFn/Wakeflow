import { types } from "node:util";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { WakeflowConfigV3Model } from "../../configuration/wakeflow-config-v3.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  RootedDirectory,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  assertWakeflowHostMaintenanceCapability,
  assertWakeflowHostMaintenanceContributionCapability,
  WakeflowHostMaintenanceCapabilityError,
  type WakeflowHostMaintenanceCapability,
} from "./wakeflow-host-maintenance-capability.js";
import {
  parseWakeflowHostMaintenanceContribution,
  WakeflowHostMaintenanceContributionError,
} from "./wakeflow-host-maintenance-contribution.js";
import {
  createWakeflowMaintenanceExecutionPlan,
  type WakeflowMaintenanceExecutionPlan,
} from "./wakeflow-maintenance-execution-plan.js";
import type {
  WakeflowMaintenanceGateContext,
} from "./wakeflow-maintenance-gate.js";
import {
  previewWakeflowStaticMaterialization,
} from "./wakeflow-static-materialization-preview.js";
import {
  parseWakeflowStaticMaterializationPreviewRequest,
  WakeflowStaticMaterializationPreviewError,
  type WakeflowStaticMaterializationPreviewRequest,
} from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：唯一执行计划的零写入 preview 组合器。
 *
 * 组合器先建立共享静态 preview，再让至多一个当前宿主 capability 贡献被动操作数据。
 * capability 不能取得 gate 或执行副作用；reconcile 使用当前 Config 的稳定快照。
 */

export type WakeflowMaintenanceExecutionPreviewErrorReason =
  | "input"
  | "shared-preview"
  | "source-config"
  | "capability"
  | "contribution"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Wakeflow maintenance execution preview input is invalid.",
  "shared-preview": "Wakeflow maintenance shared preview is unavailable.",
  "source-config": "Wakeflow maintenance execution preview source Config is unavailable.",
  capability: "Wakeflow maintenance execution preview host capability is invalid.",
  contribution: "Wakeflow maintenance execution preview host contribution is invalid.",
  aborted: "Wakeflow maintenance execution preview was aborted.",
} as const satisfies Readonly<Record<
  WakeflowMaintenanceExecutionPreviewErrorReason,
  string
>>;

/** 聚合维护 preview 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionPreviewError extends Error {
  override readonly name = "WakeflowMaintenanceExecutionPreviewError";
  readonly code = "wakeflow-maintenance-execution-preview" as const;
  readonly reason: WakeflowMaintenanceExecutionPreviewErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowMaintenanceExecutionPreviewErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowMaintenanceExecutionPreviewErrorReason,
  path: string,
): never {
  throw new WakeflowMaintenanceExecutionPreviewError(reason, path);
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

async function resolveDesiredConfig(
  root: RootedDirectory,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  expectedDigest: Sha256Digest | null,
): Promise<WakeflowConfigV3Model | null> {
  if (request.desiredConfig !== null) return request.desiredConfig;
  assertNotAborted(request.signal);
  let snapshot;
  try {
    snapshot = await readWakeflowConfigAuthoritySnapshot(
      root,
      request.signal === undefined ? undefined : { signal: request.signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (expectedDigest !== null) fail("source-config", "$config");
      return null;
    }
    throw error;
  }
  assertNotAborted(request.signal);
  if (snapshot.configDigest !== expectedDigest) {
    fail("source-config", "$config");
  }
  return snapshot.model;
}

/** 构建共享静态步骤与当前宿主操作合并后的唯一 preview-only 计划。 */
export async function previewWakeflowMaintenanceExecution(
  rootValue: RootedDirectory,
  requestValue: WakeflowStaticMaterializationPreviewRequest,
  capabilityValue?: Readonly<WakeflowHostMaintenanceCapability>,
  gateContextValue?: Readonly<WakeflowMaintenanceGateContext>,
): Promise<Readonly<WakeflowMaintenanceExecutionPlan>> {
  if (
    typeof rootValue !== "object"
    || rootValue === null
    || types.isProxy(rootValue)
    || !(rootValue instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  let request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>;
  try {
    request = parseWakeflowStaticMaterializationPreviewRequest(requestValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
      fail("input", error.path);
    }
    throw error;
  }
  assertNotAborted(request.signal);
  let capability: Readonly<WakeflowHostMaintenanceCapability> | undefined;
  if (capabilityValue !== undefined) {
    try {
      assertWakeflowHostMaintenanceCapability(
        capabilityValue,
        request.currentHostProfile.hostId,
      );
      capability = capabilityValue;
    } catch (error: unknown) {
      if (error instanceof WakeflowHostMaintenanceCapabilityError) {
        fail("capability", error.path);
      }
      throw error;
    }
  }
  let sharedPreview: Awaited<ReturnType<
    typeof previewWakeflowStaticMaterialization
  >>;
  try {
    sharedPreview = await previewWakeflowStaticMaterialization(
      rootValue,
      requestValue,
      gateContextValue === undefined
        ? {}
        : { gateContext: gateContextValue },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("shared-preview", error.path);
    }
    throw error;
  }
  let desiredConfig = request.desiredConfig;
  if (capability !== undefined) {
    desiredConfig = await resolveDesiredConfig(
      rootValue,
      request,
      sharedPreview.desiredConfigDigest,
    );
  }
  let contribution = null;
  if (capability !== undefined && desiredConfig === null) {
    if (sharedPreview.status === "ready") fail("source-config", "$config");
  } else if (capability !== undefined && desiredConfig !== null) {
    try {
      contribution = parseWakeflowHostMaintenanceContribution(
        await capability.planContribution(rootValue, {
          action: request.action,
          config: desiredConfig,
          profile: request.currentHostProfile,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        }),
      );
      assertWakeflowHostMaintenanceContributionCapability(
        capability,
        contribution,
      );
    } catch (error: unknown) {
      assertNotAborted(request.signal);
      if (
        error instanceof WakeflowHostMaintenanceContributionError
        || error instanceof WakeflowHostMaintenanceCapabilityError
      ) {
        fail("contribution", error.path);
      }
      throw error;
    }
  }
  assertNotAborted(request.signal);
  return createWakeflowMaintenanceExecutionPlan(
    sharedPreview,
    request.currentHostProfile,
    contribution,
  );
}
