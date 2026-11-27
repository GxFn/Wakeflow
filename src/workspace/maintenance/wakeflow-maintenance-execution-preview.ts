import type { WakeflowConfigModel } from "../../configuration/wakeflow-config.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import {
  assertWakeflowHostMaintenanceContributionCapability,
  type WakeflowHostMaintenanceCapability,
  WakeflowHostMaintenanceCapabilityError,
} from "./wakeflow-host-maintenance-capability.js";
import {
  parseWakeflowHostMaintenanceContribution,
  WakeflowHostMaintenanceContributionError,
} from "./wakeflow-host-maintenance-contribution.js";
import {
  createWakeflowMaintenanceExecutionPlan,
  type WakeflowMaintenanceExecutionPlan,
} from "./wakeflow-maintenance-execution-plan.js";
import type { WakeflowMaintenanceGateContext } from "./wakeflow-maintenance-gate.js";
import { previewWakeflowStaticMaterialization } from "./wakeflow-static-materialization-preview.js";
import {
  isWakeflowDetachAction,
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
  | "shared-preview"
  | "source-config"
  | "contribution";

/** 聚合维护 preview 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionPreviewError extends ModuleError<WakeflowMaintenanceExecutionPreviewErrorReason> {
  static override readonly code = "wakeflow-maintenance-execution-preview";
}

const fail: Fail<WakeflowMaintenanceExecutionPreviewErrorReason> = failWith(
  WakeflowMaintenanceExecutionPreviewError,
);

/**
 * 宿主贡献拿到的 Config：退出路径一律是当前 Config——要清理的就是它声明的托管面（ADR-0024），
 * detach-repository 的宿主也看去掉仓库之前的配置；其余动作是期望 Config（reconcile 从快照读当前）。
 */
async function resolveHostConfig(
  root: RootedDirectory,
  request: Readonly<WakeflowStaticMaterializationPreviewRequest>,
  sharedPreview: Readonly<{
    readonly currentConfigDigest: Sha256Digest | null;
    readonly desiredConfigDigest: Sha256Digest | null;
  }>,
): Promise<WakeflowConfigModel | null> {
  if (isWakeflowDetachAction(request.action)) {
    return resolveSnapshotConfig(root, request, sharedPreview.currentConfigDigest);
  }
  if (request.desiredConfig !== null) return request.desiredConfig;
  return resolveSnapshotConfig(root, request, sharedPreview.desiredConfigDigest);
}

/** 当前 Config 的稳定快照，摘要必须等于共享预览记下的那一个；预览没记（null）时快照也必须不在。 */
async function resolveSnapshotConfig(
  root: RootedDirectory,
  request: Readonly<WakeflowStaticMaterializationPreviewRequest>,
  expectedDigest: Sha256Digest | null,
): Promise<WakeflowConfigModel | null> {
  throwIfAborted(request.signal);
  let snapshot: Awaited<ReturnType<typeof readWakeflowConfigAuthoritySnapshot>>;
  try {
    snapshot = await readWakeflowConfigAuthoritySnapshot(
      root,
      request.signal === undefined ? undefined : { signal: request.signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (expectedDigest !== null) fail("source-config", "$config", error);
      return null;
    }
    throw error;
  }
  throwIfAborted(request.signal);
  if (snapshot.configDigest !== expectedDigest) {
    fail("source-config", "$config");
  }
  return snapshot.model;
}

/**
 * 构建共享静态步骤与当前宿主操作合并后的唯一 preview-only 计划。请求是类型化的；聚合事务在门前与
 * 门内各重推一次计划，用的是同一个请求。
 */
export async function previewWakeflowMaintenanceExecution(
  root: RootedDirectory,
  request: Readonly<WakeflowStaticMaterializationPreviewRequest>,
  capability?: Readonly<WakeflowHostMaintenanceCapability>,
  gateContext?: Readonly<WakeflowMaintenanceGateContext>,
): Promise<Readonly<WakeflowMaintenanceExecutionPlan>> {
  throwIfAborted(request.signal);
  let sharedPreview: Awaited<ReturnType<typeof previewWakeflowStaticMaterialization>>;
  try {
    sharedPreview = await previewWakeflowStaticMaterialization(
      root,
      request,
      gateContext === undefined ? {} : { gateContext },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
      fail("shared-preview", error.path, error);
    }
    throw error;
  }
  let hostConfig = request.desiredConfig;
  if (capability !== undefined) {
    hostConfig = await resolveHostConfig(root, request, sharedPreview);
  }
  let contribution = null;
  if (capability !== undefined && hostConfig === null) {
    if (sharedPreview.status === "ready") fail("source-config", "$config");
  } else if (capability !== undefined && hostConfig !== null) {
    try {
      contribution = parseWakeflowHostMaintenanceContribution(
        await capability.planContribution(root, {
          action: request.action,
          config: hostConfig,
          profile: request.currentHostProfile,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        }),
      );
      assertWakeflowHostMaintenanceContributionCapability(capability, contribution);
    } catch (error: unknown) {
      throwIfAborted(request.signal);
      if (
        error instanceof WakeflowHostMaintenanceContributionError ||
        error instanceof WakeflowHostMaintenanceCapabilityError
      ) {
        fail("contribution", error.path, error);
      }
      throw error;
    }
  }
  throwIfAborted(request.signal);
  return createWakeflowMaintenanceExecutionPlan(
    sharedPreview,
    request.currentHostProfile,
    contribution,
  );
}
