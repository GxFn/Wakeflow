import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parseJsonValue,
  JsonValueError,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostId,
} from "../workspace-host-resource-profile.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../wakeflow-workspace-static-resource-matrix.js";
import {
  parseWakeflowHostMaintenanceContribution,
  WakeflowHostMaintenanceContributionError,
  type WakeflowHostMaintenanceContribution,
  type WakeflowHostMaintenanceOperation,
} from "./wakeflow-host-maintenance-contribution.js";
import {
  parseWakeflowStaticMaterializationPreview,
  WakeflowStaticMaterializationPreviewError,
  type WakeflowStaticMaterializationPreview,
  type WakeflowStaticMaterializationStep,
  type WakeflowStaticMaterializationStepKind,
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
  readonly hostContribution:
    Readonly<WakeflowHostMaintenanceContribution> | null;
  readonly steps: readonly Readonly<WakeflowMaintenanceExecutionStep>[];
  readonly planDigest: Sha256Digest;
}

export type WakeflowMaintenanceExecutionPlanErrorReason =
  | "input"
  | "host"
  | "shared-preview"
  | "host-contribution"
  | "matrix"
  | "order"
  | "digest";

const ERROR_MESSAGES = {
  input: "Wakeflow maintenance execution plan input is invalid.",
  host: "Wakeflow maintenance execution plan host identity is invalid.",
  "shared-preview": "Wakeflow maintenance execution plan shared preview is invalid.",
  "host-contribution": "Wakeflow maintenance execution plan host contribution is invalid.",
  matrix: "Wakeflow maintenance execution plan host profile does not match its matrix.",
  order: "Wakeflow maintenance execution plan step order is invalid.",
  digest: "Wakeflow maintenance execution plan digest is invalid.",
} as const satisfies Readonly<Record<
  WakeflowMaintenanceExecutionPlanErrorReason,
  string
>>;

/** 聚合维护执行计划准入失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionPlanError extends Error {
  override readonly name = "WakeflowMaintenanceExecutionPlanError";
  readonly code = "wakeflow-maintenance-execution-plan" as const;
  readonly reason: WakeflowMaintenanceExecutionPlanErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowMaintenanceExecutionPlanErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const HOST_ID_SET = new Set<string>(WAKEFLOW_WORKSPACE_HOST_IDS);
const JOURNAL_MAXIMUM_STEPS = 256;

function fail(
  reason: WakeflowMaintenanceExecutionPlanErrorReason,
  path: string,
): never {
  throw new WakeflowMaintenanceExecutionPlanError(reason, path);
}

function parseHostId(value: unknown, path: string): WakeflowWorkspaceHostId {
  if (typeof value !== "string" || !HOST_ID_SET.has(value)) {
    fail("host", path);
  }
  return value as WakeflowWorkspaceHostId;
}

function parseSharedPreview(
  value: unknown,
): Readonly<WakeflowStaticMaterializationPreview> {
  try {
    return parseWakeflowStaticMaterializationPreview(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
      fail("shared-preview", error.path);
    }
    throw error;
  }
}

function parseContribution(
  value: unknown,
): Readonly<WakeflowHostMaintenanceContribution> | null {
  if (value === null) return null;
  try {
    return parseWakeflowHostMaintenanceContribution(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowHostMaintenanceContributionError) {
      fail("host-contribution", error.path);
    }
    throw error;
  }
}

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
  const config = preview.steps.find((entry) => entry.kind === "publish-config");
  const steps: Readonly<WakeflowMaintenanceExecutionStep>[] = preview.steps
    .filter((entry) => entry.kind !== "publish-config")
    .map((entry) => sharedStep(entry));
  if (contribution !== null) {
    for (const operation of contribution.operations) {
      const predecessor = steps.at(-1);
      const dependencies = predecessor === undefined
        ? []
        : [predecessor.stepId];
      steps.push(hostStep(
        contribution.hostId,
        contribution.capabilityId,
        operation,
        dependencies,
      ));
    }
  }
  if (config !== undefined) {
    steps.push(sharedStep(config, steps.map((entry) => entry.stepId)));
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
      blockers.add(
        `host:${contribution.hostId}:${contribution.capabilityId}:${code}`,
      );
    }
  }
  if (stepCount > JOURNAL_MAXIMUM_STEPS) {
    blockers.add("maintenance-step-budget-exceeded");
  }
  return Object.freeze([...blockers].sort());
}

function planDigestBasis(
  value: Omit<WakeflowMaintenanceExecutionPlan, "planDigest">,
) {
  return {
    ...value,
    kind: "WakeflowMaintenanceExecutionPlanDigestBasis" as const,
  };
}

/** 计算不包含自身摘要字段的聚合执行计划语义摘要。 */
export function computeWakeflowMaintenanceExecutionPlanDigest(
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
  const basis: Omit<WakeflowMaintenanceExecutionPlan, "planDigest"> =
    Object.freeze({
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
  previewValue: unknown,
  currentHostProfileValue: unknown,
  contributionValue: unknown | null,
): Readonly<WakeflowMaintenanceExecutionPlan> {
  const preview = parseSharedPreview(previewValue);
  let profile;
  try {
    profile = parseWakeflowWorkspaceHostResourceProfile(
      currentHostProfileValue,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("host", error.path);
    }
    throw error;
  }
  if (
    createWakeflowWorkspaceStaticResourceMatrix(profile).matrixDigest
      !== preview.matrixDigest
  ) {
    fail("matrix", "$profile");
  }
  return buildPlan(profile.hostId, preview, parseContribution(contributionValue));
}

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function equivalentJson(left: unknown, right: unknown, path: string): boolean {
  let leftJson: JsonValue;
  try {
    leftJson = parseJsonValue(left, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", error.path);
    throw error;
  }
  return computeCanonicalJsonSha256Digest(leftJson)
    === computeCanonicalJsonSha256Digest(right);
}

/** 把任意输入重验为可由两类已知来源唯一推导的聚合执行计划。 */
export function parseWakeflowMaintenanceExecutionPlan(
  value: unknown,
): Readonly<WakeflowMaintenanceExecutionPlan> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$plan");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
  if (
    Object.keys(record).sort().join("\u0000")
      !== "blockerCodes\u0000executionBoundary\u0000hostContribution\u0000hostId\u0000kind\u0000planDigest\u0000schemaVersion\u0000sharedPreview\u0000status\u0000steps"
    || record.kind !== "WakeflowMaintenanceExecutionPlan"
    || record.schemaVersion !== 1
    || record.executionBoundary !== "preview-only"
    || (record.status !== "ready" && record.status !== "blocked")
  ) {
    fail("input", "$plan");
  }
  const expected = buildPlan(
    parseHostId(record.hostId, "$plan.hostId"),
    parseSharedPreview(record.sharedPreview),
    parseContribution(record.hostContribution),
  );
  if (
    record.status !== expected.status
    || !equivalentJson(
      record.blockerCodes,
      expected.blockerCodes,
      "$plan.blockerCodes",
    )
    || !equivalentJson(record.steps, expected.steps, "$plan.steps")
  ) {
    fail("order", "$plan");
  }
  if (digest(record.planDigest, "$plan.planDigest") !== expected.planDigest) {
    fail("digest", "$plan.planDigest");
  }
  return expected;
}
