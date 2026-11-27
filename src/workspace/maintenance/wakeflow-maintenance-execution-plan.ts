import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../wakeflow-workspace-static-resource-matrix.js";
import type {
  WakeflowWorkspaceHostId,
  WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import type {
  WakeflowHostMaintenanceContribution,
  WakeflowHostMaintenanceOperation,
} from "./wakeflow-host-maintenance-contribution.js";
import type {
  WakeflowStaticMaterializationPreview,
  WakeflowStaticMaterializationStep,
  WakeflowStaticMaterializationStepKind,
} from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：共享静态步骤与当前宿主操作的唯一执行计划。
 *
 * 计划保留完整 shared preview 与可移植的宿主 contribution，但只产生一条有序 step
 * 序列。宿主操作固定插入 Config 激活前；共享层不解释宿主 payload，也不提供动态
 * handler registry。journal 只绑定本计划摘要与 step IDs。
 */

export interface WakeflowSharedMaintenanceExecutionStep {
  readonly boundary: "shared-static";
  readonly stepId: string;
  readonly stepKind: WakeflowStaticMaterializationStepKind;
  readonly ownerId: string;
  readonly targetKey: string;
  readonly sourceDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
  readonly dependsOn: readonly string[];
}

export interface WakeflowHostMaintenanceExecutionStep {
  readonly boundary: "host-capability";
  readonly stepId: string;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly capabilityId: string;
  readonly operationId: string;
  readonly operationKind: string;
  readonly ownerId: string;
  readonly targetKey: string;
  readonly sourceDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
  readonly payloadDigest: Sha256Digest;
  readonly dependsOn: readonly string[];
}

export type WakeflowMaintenanceExecutionStep =
  | WakeflowSharedMaintenanceExecutionStep
  | WakeflowHostMaintenanceExecutionStep;

export interface WakeflowMaintenanceExecutionPlan {
  readonly kind: "WakeflowMaintenanceExecutionPlan";
  readonly schemaVersion: 1;
  readonly executionBoundary: "preview-only";
  readonly hostId: WakeflowWorkspaceHostId;
  readonly status: "ready" | "blocked";
  readonly blockerCodes: readonly string[];
  readonly sharedPreview: Readonly<WakeflowStaticMaterializationPreview>;
  readonly hostContribution: Readonly<WakeflowHostMaintenanceContribution> | null;
  readonly steps: readonly Readonly<WakeflowMaintenanceExecutionStep>[];
  readonly planDigest: Sha256Digest;
}

export type WakeflowMaintenanceExecutionPlanErrorReason = "host-contribution" | "matrix" | "order";

/** 聚合维护执行计划准入失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionPlanError extends ModuleError<WakeflowMaintenanceExecutionPlanErrorReason> {
  static override readonly code = "wakeflow-maintenance-execution-plan";
}

const fail: Fail<WakeflowMaintenanceExecutionPlanErrorReason> = failWith(
  WakeflowMaintenanceExecutionPlanError,
);

const JOURNAL_MAXIMUM_STEPS = 256;

function sharedStep(
  value: Readonly<WakeflowStaticMaterializationStep>,
  dependencies: readonly string[] = value.dependsOn,
): Readonly<WakeflowSharedMaintenanceExecutionStep> {
  return Object.freeze({
    boundary: "shared-static",
    stepId: value.stepId,
    stepKind: value.kind,
    ownerId: value.ownerId,
    targetKey: value.targetKey,
    sourceDigest: value.sourceDigest,
    targetDigest: value.targetDigest,
    dependsOn: Object.freeze([...dependencies]),
  });
}

function hostStep(
  hostId: WakeflowWorkspaceHostId,
  capabilityId: string,
  operation: Readonly<WakeflowHostMaintenanceOperation>,
  dependencies: readonly string[],
): Readonly<WakeflowHostMaintenanceExecutionStep> {
  return Object.freeze({
    boundary: "host-capability",
    stepId: `host-effect:${operation.operationId}`,
    hostId,
    capabilityId,
    operationId: operation.operationId,
    operationKind: operation.operationKind,
    ownerId: operation.ownerId,
    targetKey: operation.targetKey,
    sourceDigest: operation.sourceDigest,
    targetDigest: operation.targetDigest,
    payloadDigest: operation.payloadDigest,
    dependsOn: Object.freeze([...dependencies]),
  });
}

function orderedSteps(
  preview: Readonly<WakeflowStaticMaterializationPreview>,
  contribution: Readonly<WakeflowHostMaintenanceContribution> | null,
): readonly Readonly<WakeflowMaintenanceExecutionStep>[] {
  // Config 权威步收尾：publish-config，或 detach-workspace 的 retire-config（ADR-0024）；宿主操作在它之前。
  const config = preview.steps.find(
    (entry) => entry.kind === "publish-config" || entry.kind === "retire-config",
  );
  const steps: Readonly<WakeflowMaintenanceExecutionStep>[] = preview.steps
    .filter((entry) => entry.kind !== "publish-config" && entry.kind !== "retire-config")
    .map((entry) => sharedStep(entry));
  if (contribution !== null) {
    for (const operation of contribution.operations) {
      const predecessor = steps.at(-1);
      const dependencies = predecessor === undefined ? [] : [predecessor.stepId];
      steps.push(hostStep(contribution.hostId, contribution.capabilityId, operation, dependencies));
    }
  }
  if (config !== undefined) {
    steps.push(
      sharedStep(
        config,
        steps.map((entry) => entry.stepId),
      ),
    );
  }
  return Object.freeze(steps);
}

function combinedBlockers(
  preview: Readonly<WakeflowStaticMaterializationPreview>,
  contribution: Readonly<WakeflowHostMaintenanceContribution> | null,
  stepCount: number,
): readonly string[] {
  const blockers = new Set<string>(preview.blockerCodes);
  if (contribution !== null) {
    for (const code of contribution.blockerCodes) {
      blockers.add(`host:${contribution.hostId}:${contribution.capabilityId}:${code}`);
    }
  }
  if (stepCount > JOURNAL_MAXIMUM_STEPS) {
    blockers.add("maintenance-step-budget-exceeded");
  }
  return Object.freeze([...blockers].sort());
}

function planDigestBasis(value: Omit<WakeflowMaintenanceExecutionPlan, "planDigest">) {
  return {
    ...value,
    kind: "WakeflowMaintenanceExecutionPlanDigestBasis" as const,
  };
}

/** 计算不包含自身摘要字段的聚合执行计划语义摘要。 */
function computeWakeflowMaintenanceExecutionPlanDigest(
  value: Omit<WakeflowMaintenanceExecutionPlan, "planDigest">,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(planDigestBasis(value));
}

function buildPlan(
  hostId: WakeflowWorkspaceHostId,
  preview: Readonly<WakeflowStaticMaterializationPreview>,
  contribution: Readonly<WakeflowHostMaintenanceContribution> | null,
): Readonly<WakeflowMaintenanceExecutionPlan> {
  if (contribution !== null && contribution.hostId !== hostId) {
    fail("host-contribution", "$plan.hostContribution.hostId");
  }
  const steps = orderedSteps(preview, contribution);
  if (new Set(steps.map((entry) => entry.stepId)).size !== steps.length) {
    fail("order", "$plan.steps");
  }
  const blockerCodes = combinedBlockers(preview, contribution, steps.length);
  const basis: Omit<WakeflowMaintenanceExecutionPlan, "planDigest"> = Object.freeze({
    kind: "WakeflowMaintenanceExecutionPlan",
    schemaVersion: 1,
    executionBoundary: "preview-only",
    hostId,
    status: blockerCodes.length === 0 ? "ready" : "blocked",
    blockerCodes,
    sharedPreview: preview,
    hostContribution: contribution,
    steps,
  });
  return Object.freeze({
    ...basis,
    planDigest: computeWakeflowMaintenanceExecutionPlanDigest(basis),
  });
}

/**
 * 依据已确认 Host Profile 组合 shared preview 与当前宿主 contribution。
 */
export function createWakeflowMaintenanceExecutionPlan(
  preview: Readonly<WakeflowStaticMaterializationPreview>,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  contribution: Readonly<WakeflowHostMaintenanceContribution> | null,
): Readonly<WakeflowMaintenanceExecutionPlan> {
  if (createWakeflowWorkspaceStaticResourceMatrix(profile).matrixDigest !== preview.matrixDigest) {
    fail("matrix", "$profile");
  }
  return buildPlan(profile.hostId, preview, contribution);
}
