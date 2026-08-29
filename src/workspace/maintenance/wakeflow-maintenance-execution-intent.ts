import {
  WAKEFLOW_CONFIG_V3_SCHEMA,
} from "../../contracts/generated/configuration/wakeflow-config-v3.generated.js";
import {
  WAKEFLOW_SHA256_DIGEST_SCHEMA,
} from "../../contracts/generated/foundation/sha256-digest.generated.js";
import {
  WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA,
  type WakeflowMaintenanceExecutionIntent as WakeflowMaintenanceExecutionIntentWire,
} from "../../contracts/generated/workspace/maintenance-execution-intent.generated.js";
import {
  createWakeflowConfigV3DocumentValue,
} from "../../configuration/wakeflow-config-v3-document.js";
import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../foundation/schema/runtime-json-schema.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../workspace-resource-declaration.js";
import type {
  WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  parseWakeflowHostMaintenanceContribution,
  WakeflowHostMaintenanceContributionError,
  type WakeflowHostMaintenanceContribution,
} from "./wakeflow-host-maintenance-contribution.js";
import {
  createWakeflowMaintenanceExecutionPlan,
  parseWakeflowMaintenanceExecutionPlan,
  WakeflowMaintenanceExecutionPlanError,
  type WakeflowMaintenanceExecutionPlan,
} from "./wakeflow-maintenance-execution-plan.js";
import {
  parseWakeflowMaintenanceOperationId,
  WakeflowMaintenanceOperationIdError,
  wakeflowMaintenanceIntentRef,
  type WakeflowMaintenanceOperationId,
} from "./wakeflow-maintenance-operation-id.js";
import {
  parseWakeflowStaticMaterializationPreview,
  parseWakeflowStaticMaterializationPreviewRequest,
  WakeflowStaticMaterializationPreviewError,
  type WakeflowStaticMaterializationPreview,
  type WakeflowStaticMaterializationPreviewRequest,
} from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：可在进程重启后重建 exact execution 的不可变意图。
 *
 * Intent 保存规范化 desired Config、完整 Host Profile 集合、shared preview 与宿主
 * contribution；聚合 steps 始终重新推导，不重复持久化。它不保存源文件正文、绝对
 * 路径、凭据、PID、锁 token、时间戳或可变 checkpoint。
 */

export const WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_ARTIFACT_KIND =
  "wakeflow-maintenance-execution-intent" as const;
export const WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA_VERSION = 1 as const;

export interface WakeflowMaintenanceExecutionIntent {
  readonly artifactKind:
    typeof WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_ARTIFACT_KIND;
  readonly schemaVersion:
    typeof WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA_VERSION;
  readonly operationId: WakeflowMaintenanceOperationId;
  readonly desiredConfig: WakeflowConfigV3Model;
  readonly currentHostProfile:
    Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly hostProfiles: readonly [
    Readonly<WakeflowWorkspaceHostResourceProfile>,
    Readonly<WakeflowWorkspaceHostResourceProfile>,
  ];
  readonly sharedPreview: Readonly<WakeflowStaticMaterializationPreview>;
  readonly hostContribution:
    Readonly<WakeflowHostMaintenanceContribution> | null;
  readonly planDigest: Sha256Digest;
}

export type WakeflowMaintenanceExecutionIntentErrorReason =
  | "input"
  | "json"
  | "schema"
  | "operation"
  | "config"
  | "request"
  | "plan"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  input: "Wakeflow maintenance execution intent input is invalid.",
  json: "Wakeflow maintenance execution intent is not passive JSON data.",
  schema: "Wakeflow maintenance execution intent does not satisfy its Schema.",
  operation: "Wakeflow maintenance execution intent operation identity is invalid.",
  config: "Wakeflow maintenance execution intent desired Config is invalid.",
  request: "Wakeflow maintenance execution intent Host Profile request is invalid.",
  plan: "Wakeflow maintenance execution intent plan sources are invalid.",
  relation: "Wakeflow maintenance execution intent fields are inconsistent.",
  representation: "Wakeflow maintenance execution intent representation is invalid.",
} as const satisfies Readonly<Record<
  WakeflowMaintenanceExecutionIntentErrorReason,
  string
>>;

/** Maintenance execution intent 准入失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionIntentError extends Error {
  override readonly name = "WakeflowMaintenanceExecutionIntentError";
  readonly code = "wakeflow-maintenance-execution-intent" as const;
  readonly reason: WakeflowMaintenanceExecutionIntentErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowMaintenanceExecutionIntentErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire =
  createRuntimeJsonSchemaValidator<WakeflowMaintenanceExecutionIntentWire>(
    WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA,
    [WAKEFLOW_CONFIG_V3_SCHEMA, WAKEFLOW_SHA256_DIGEST_SCHEMA],
  );

function fail(
  reason: WakeflowMaintenanceExecutionIntentErrorReason,
  path: string,
): never {
  throw new WakeflowMaintenanceExecutionIntentError(reason, path);
}

function normalizeConfig(value: unknown): WakeflowConfigV3Model {
  try {
    return parseWakeflowConfigV3(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("config", error.path);
    throw error;
  }
}

function normalizeOperationId(value: unknown): WakeflowMaintenanceOperationId {
  try {
    return parseWakeflowMaintenanceOperationId(value, "$/operationId");
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceOperationIdError) {
      fail("operation", "$/operationId");
    }
    throw error;
  }
}

function normalizePreview(
  value: unknown,
): Readonly<WakeflowStaticMaterializationPreview> {
  try {
    return parseWakeflowStaticMaterializationPreview(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
      fail("plan", error.path);
    }
    throw error;
  }
}

function normalizeContribution(
  value: unknown,
): Readonly<WakeflowHostMaintenanceContribution> | null {
  if (value === null) return null;
  try {
    return parseWakeflowHostMaintenanceContribution(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowHostMaintenanceContributionError) {
      fail("plan", "$/hostContribution");
    }
    throw error;
  }
}

function normalizedRequest(
  preview: Readonly<WakeflowStaticMaterializationPreview>,
  desiredConfig: WakeflowConfigV3Model,
  currentHostProfileValue: unknown,
  hostProfileValues: readonly unknown[],
) {
  try {
    return parseWakeflowStaticMaterializationPreviewRequest({
      action: preview.action,
      desiredConfig: preview.action === "reconcile" ? null : desiredConfig,
      currentHostProfile: currentHostProfileValue,
      hostProfiles: hostProfileValues,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
      fail("request", "$/hostProfiles");
    }
    throw error;
  }
}

function sortedProfiles(
  values: readonly Readonly<WakeflowWorkspaceHostResourceProfile>[],
): readonly [
  Readonly<WakeflowWorkspaceHostResourceProfile>,
  Readonly<WakeflowWorkspaceHostResourceProfile>,
] {
  // Intent v1把当时完整的两宿主集合写入恢复格式；扩展集合必须新建版本并迁移。
  const sorted = [...values].sort((left, right) => (
    left.hostId < right.hostId ? -1 : left.hostId > right.hostId ? 1 : 0
  ));
  if (sorted.length !== 2 || sorted[0] === undefined || sorted[1] === undefined) {
    fail("request", "$/hostProfiles");
  }
  return Object.freeze([sorted[0], sorted[1]]);
}

interface NormalizedWakeflowMaintenanceExecutionIntent {
  readonly intent: Readonly<WakeflowMaintenanceExecutionIntent>;
  readonly plan: Readonly<WakeflowMaintenanceExecutionPlan>;
}

function normalize(
  wire: Readonly<WakeflowMaintenanceExecutionIntentWire>,
): Readonly<NormalizedWakeflowMaintenanceExecutionIntent> {
  const operationId = normalizeOperationId(wire.operationId);
  const desiredConfig = normalizeConfig(wire.desiredConfig);
  const sharedPreview = normalizePreview(wire.sharedPreview);
  const hostContribution = normalizeContribution(wire.hostContribution);
  const request = normalizedRequest(
    sharedPreview,
    desiredConfig,
    wire.currentHostProfile,
    wire.hostProfiles,
  );
  const hostProfiles = sortedProfiles(request.hostProfiles);
  const currentHostProfile = request.currentHostProfile;
  let plan: Readonly<WakeflowMaintenanceExecutionPlan>;
  try {
    plan = createWakeflowMaintenanceExecutionPlan(
      sharedPreview,
      currentHostProfile,
      hostContribution,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionPlanError) {
      fail("plan", error.path);
    }
    throw error;
  }
  if (
    plan.status !== "ready"
    || plan.steps.length === 0
    || plan.planDigest !== wire.planDigest
    || sharedPreview.desiredConfigDigest
      !== computeWakeflowConfigV3Digest(desiredConfig)
  ) {
    fail("relation", "$intent");
  }
  const intent = Object.freeze({
    artifactKind: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_ARTIFACT_KIND,
    schemaVersion: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA_VERSION,
    operationId,
    desiredConfig,
    currentHostProfile,
    hostProfiles,
    sharedPreview,
    hostContribution,
    planDigest: plan.planDigest,
  });
  return Object.freeze({ intent, plan });
}

function intentRepresentation(
  intent: Readonly<WakeflowMaintenanceExecutionIntent>,
): JsonValue {
  return parseJsonValue({
    artifactKind: intent.artifactKind,
    schemaVersion: intent.schemaVersion,
    operationId: intent.operationId,
    desiredConfig: createWakeflowConfigV3DocumentValue(intent.desiredConfig),
    currentHostProfile: intent.currentHostProfile,
    hostProfiles: intent.hostProfiles,
    sharedPreview: intent.sharedPreview,
    hostContribution: intent.hostContribution,
    planDigest: intent.planDigest,
  }, "$intent");
}

function parseWakeflowMaintenanceExecutionIntentWithPlan(
  value: unknown,
): Readonly<NormalizedWakeflowMaintenanceExecutionIntent> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$intent");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  return normalize(validated.value);
}

/** 将任意 JSON 值准入为字段关系已经闭合的 immutable execution intent。 */
export function parseWakeflowMaintenanceExecutionIntent(
  value: unknown,
): Readonly<WakeflowMaintenanceExecutionIntent> {
  return parseWakeflowMaintenanceExecutionIntentWithPlan(value).intent;
}

/**
 * 从已确认计划、原preview请求与resolved desired Config创建恢复意图。
 */
export function createWakeflowMaintenanceExecutionIntent(
  operationIdValue: unknown,
  planValue: unknown,
  requestValue: WakeflowStaticMaterializationPreviewRequest,
  desiredConfigValue: unknown,
): Readonly<WakeflowMaintenanceExecutionIntent> {
  let plan: Readonly<WakeflowMaintenanceExecutionPlan>;
  try {
    plan = parseWakeflowMaintenanceExecutionPlan(planValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionPlanError) {
      fail("plan", error.path);
    }
    throw error;
  }
  let request;
  try {
    request = parseWakeflowStaticMaterializationPreviewRequest(requestValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
      fail("request", "$request");
    }
    throw error;
  }
  const desiredConfig = normalizeConfig(desiredConfigValue);
  if (
    request.action !== plan.sharedPreview.action
    || request.currentHostProfile.hostId !== plan.hostId
    || (
      request.action !== "reconcile"
      && request.desiredConfig !== null
      && computeWakeflowConfigV3Digest(request.desiredConfig)
        !== computeWakeflowConfigV3Digest(desiredConfig)
    )
  ) {
    fail("relation", "$request");
  }
  return parseWakeflowMaintenanceExecutionIntent({
    artifactKind: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_ARTIFACT_KIND,
    schemaVersion: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA_VERSION,
    operationId: operationIdValue,
    desiredConfig: createWakeflowConfigV3DocumentValue(desiredConfig),
    currentHostProfile: request.currentHostProfile,
    hostProfiles: sortedProfiles(request.hostProfiles),
    sharedPreview: plan.sharedPreview,
    hostContribution: plan.hostContribution,
    planDigest: plan.planDigest,
  });
}

/** 一次准入并重建恢复执行所需的exact plan与无signal request。 */
export function reconstructWakeflowMaintenanceExecutionFromIntent(
  value: unknown,
): Readonly<{
  readonly plan: Readonly<WakeflowMaintenanceExecutionPlan>;
  readonly request: Readonly<WakeflowStaticMaterializationPreviewRequest>;
}> {
  const normalized = parseWakeflowMaintenanceExecutionIntentWithPlan(value);
  const intent = normalized.intent;
  return Object.freeze({
    plan: normalized.plan,
    request: Object.freeze({
      action: intent.sharedPreview.action,
      desiredConfig: intent.sharedPreview.action === "reconcile"
        ? null
        : intent.desiredConfig,
      currentHostProfile: intent.currentHostProfile,
      hostProfiles: intent.hostProfiles,
    }),
  });
}

/** 计算immutable intent的语义摘要，供mutable journal绑定。 */
export function computeWakeflowMaintenanceExecutionIntentDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    intentRepresentation(parseWakeflowMaintenanceExecutionIntent(value)),
  );
}

/** 渲染唯一确定性格式化JSON表示。 */
export function renderWakeflowMaintenanceExecutionIntent(
  value: unknown,
): string {
  return renderDeterministicJsonDocument(
    intentRepresentation(parseWakeflowMaintenanceExecutionIntent(value)),
    "$intent",
  );
}

/** 解析磁盘intent并拒绝任何表示漂移。 */
export function parseWakeflowMaintenanceExecutionIntentDocument(
  text: unknown,
): Readonly<WakeflowMaintenanceExecutionIntent> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$intent");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path);
    }
    throw error;
  }
  const intent = parseWakeflowMaintenanceExecutionIntent(json);
  if (renderWakeflowMaintenanceExecutionIntent(intent) !== text) {
    fail("representation", "$intent");
  }
  return intent;
}

/** 为一个operation生成exact intent动态资源声明。 */
export function createWakeflowMaintenanceIntentResourceDeclaration(
  operationIdValue: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  const operationId = parseWakeflowMaintenanceOperationId(operationIdValue);
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: `maintenance.transaction-intent.${operationId}`,
    family: "maintenance",
    ownerId: "workspace-maintenance",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: wakeflowMaintenanceIntentRef(operationId),
    },
    tracking: { disposition: "ignored", privacy: "runtime-private" },
    nodePolicy: {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing: {
      kind: "resource",
      role: "transaction-artifact",
      allowedMutationRecipes: ["exclusive-create", "exact-retire"],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });
}
