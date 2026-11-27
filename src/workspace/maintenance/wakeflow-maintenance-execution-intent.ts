import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
  WakeflowConfigError,
  type WakeflowConfigModel,
} from "../../configuration/wakeflow-config.js";
import { createWakeflowConfigDocumentValue } from "../../configuration/wakeflow-config-document.js";
import { WAKEFLOW_CONFIG_SCHEMA } from "../../contracts/generated/configuration/wakeflow-config.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import {
  WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA,
  type WakeflowMaintenanceExecutionIntent as WakeflowMaintenanceExecutionIntentWire,
} from "../../contracts/generated/workspace/maintenance-execution-intent.generated.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { renderDeterministicJsonDocument } from "../../foundation/data/deterministic-json-document.js";
import {
  type JsonValue,
  JsonValueError,
  parseJsonValue,
} from "../../foundation/data/json-value.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../../kernel/workspace-resource-declaration.js";
import {
  parseWakeflowHostMaintenanceContribution,
  type WakeflowHostMaintenanceContribution,
  WakeflowHostMaintenanceContributionError,
} from "./wakeflow-host-maintenance-contribution.js";
import {
  createWakeflowMaintenanceExecutionPlan,
  type WakeflowMaintenanceExecutionPlan,
  WakeflowMaintenanceExecutionPlanError,
} from "./wakeflow-maintenance-execution-plan.js";
import {
  parseWakeflowMaintenanceOperationId,
  type WakeflowMaintenanceOperationId,
  WakeflowMaintenanceOperationIdError,
  wakeflowMaintenanceIntentRef,
} from "./wakeflow-maintenance-operation-id.js";
import {
  parseWakeflowMaintenanceWriter,
  type WakeflowMaintenanceWriter,
  WakeflowMaintenanceWriterError,
} from "./wakeflow-maintenance-writer.js";
import {
  parseWakeflowStaticMaterializationHostProfiles,
  parseWakeflowStaticMaterializationPreview,
  type WakeflowStaticMaterializationPreview,
  WakeflowStaticMaterializationPreviewError,
  type WakeflowStaticMaterializationPreviewRequest,
  wakeflowStaticMaterializationActionUsesCurrentConfig,
} from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：可在进程重启后重建 exact execution 的意图，一次维护唯一落盘的记录。
 *
 * Intent 保存规范化 desired Config、完整 Host Profile 集合、shared preview 与宿主
 * contribution；聚合 steps 始终重新推导，不重复持久化。它不保存源文件正文、绝对
 * 路径、凭据、PID、锁 token 或时间戳。可选的 `writer` 是写出意图的构建的写者戳（C11）；
 * 盖戳之前的意图没有它。
 *
 * 唯一会变的成员是 `completedSteps`：计划里已经做完的前几步。它不进意图摘要——摘要认的是
 * "这次要做成什么样"，计数说的是"做到哪了"。此前计数在另一个文件（检查点日志）里，两个文件
 * 互相印证；1.4 第 5 段把它并进来（ADR-0031，5a 的 C 行）。
 */

export const WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_ARTIFACT_KIND =
  "wakeflow-maintenance-execution-intent" as const;
export const WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA_VERSION = 1 as const;

export interface WakeflowMaintenanceExecutionIntent {
  readonly artifactKind: typeof WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_ARTIFACT_KIND;
  readonly schemaVersion: typeof WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA_VERSION;
  readonly operationId: WakeflowMaintenanceOperationId;
  readonly desiredConfig: WakeflowConfigModel;
  readonly currentHostProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly hostProfiles: readonly [
    Readonly<WakeflowWorkspaceHostResourceProfile>,
    Readonly<WakeflowWorkspaceHostResourceProfile>,
  ];
  readonly sharedPreview: Readonly<WakeflowStaticMaterializationPreview>;
  readonly hostContribution: Readonly<WakeflowHostMaintenanceContribution> | null;
  readonly planDigest: Sha256Digest;
  /** 计划里已经做完的前几步；下标等于它的那一步可能已经开始。 */
  readonly completedSteps: number;
  readonly writer?: Readonly<WakeflowMaintenanceWriter>;
}

export type WakeflowMaintenanceExecutionIntentErrorReason =
  | "json"
  | "schema"
  | "operation"
  | "config"
  | "request"
  | "plan"
  | "relation";

/** Maintenance execution intent 准入失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionIntentError extends ModuleError<WakeflowMaintenanceExecutionIntentErrorReason> {
  static override readonly code = "wakeflow-maintenance-execution-intent";
}

const fail: Fail<WakeflowMaintenanceExecutionIntentErrorReason> = failWith(
  WakeflowMaintenanceExecutionIntentError,
);

const validateWire = createRuntimeJsonSchemaValidator<WakeflowMaintenanceExecutionIntentWire>(
  WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA,
  [WAKEFLOW_CONFIG_SCHEMA, WAKEFLOW_SHA256_DIGEST_SCHEMA],
);

function normalizeConfig(value: unknown): WakeflowConfigModel {
  try {
    return parseWakeflowConfig(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigError) fail("config", error.path, error);
    throw error;
  }
}

function normalizeOperationId(value: unknown): WakeflowMaintenanceOperationId {
  try {
    return parseWakeflowMaintenanceOperationId(value, "$/operationId");
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceOperationIdError) {
      fail("operation", "$/operationId", error);
    }
    throw error;
  }
}

function normalizePreview(value: unknown): Readonly<WakeflowStaticMaterializationPreview> {
  try {
    return parseWakeflowStaticMaterializationPreview(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
      fail("plan", error.path, error);
    }
    throw error;
  }
}

function normalizeWriter(
  value: unknown,
  path: string,
  reason: WakeflowMaintenanceExecutionIntentErrorReason,
): Readonly<WakeflowMaintenanceWriter> | null {
  try {
    return parseWakeflowMaintenanceWriter(value, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceWriterError) fail(reason, error.path, error);
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
      fail("plan", "$/hostContribution", error);
    }
    throw error;
  }
}

/** 盘上读回的 profile 集合：逐个解析并核对集合关系（A-spec R9a：读盘边界保留的那一半）。 */
function normalizedHostProfiles(
  currentHostProfileValue: unknown,
  hostProfileValues: readonly unknown[],
) {
  try {
    return parseWakeflowStaticMaterializationHostProfiles(
      currentHostProfileValue,
      hostProfileValues,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
      fail("request", "$/hostProfiles", error);
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
  const sorted = [...values].sort((left, right) =>
    left.hostId < right.hostId ? -1 : left.hostId > right.hostId ? 1 : 0,
  );
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
  const writer = normalizeWriter(wire.writer, "$/writer", "schema");
  const desiredConfig = normalizeConfig(wire.desiredConfig);
  const sharedPreview = normalizePreview(wire.sharedPreview);
  const hostContribution = normalizeContribution(wire.hostContribution);
  const profiles = normalizedHostProfiles(wire.currentHostProfile, wire.hostProfiles);
  const hostProfiles = sortedProfiles(profiles.hostProfiles);
  const currentHostProfile = profiles.currentHostProfile;
  let plan: Readonly<WakeflowMaintenanceExecutionPlan>;
  try {
    plan = createWakeflowMaintenanceExecutionPlan(
      sharedPreview,
      currentHostProfile,
      hostContribution,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionPlanError) {
      fail("plan", error.path, error);
    }
    throw error;
  }
  if (
    plan.status !== "ready" ||
    plan.steps.length === 0 ||
    plan.planDigest !== wire.planDigest ||
    sharedPreview.desiredConfigDigest !== computeWakeflowConfigDigest(desiredConfig) ||
    wire.completedSteps > plan.steps.length
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
    completedSteps: wire.completedSteps,
    ...(writer === null ? {} : { writer }),
  });
  return Object.freeze({ intent, plan });
}

/** 文件里的表示：不变的部分加上计数。 */
function intentRepresentation(intent: Readonly<WakeflowMaintenanceExecutionIntent>): JsonValue {
  return parseJsonValue(
    {
      artifactKind: intent.artifactKind,
      schemaVersion: intent.schemaVersion,
      operationId: intent.operationId,
      desiredConfig: createWakeflowConfigDocumentValue(intent.desiredConfig),
      currentHostProfile: intent.currentHostProfile,
      hostProfiles: intent.hostProfiles,
      sharedPreview: intent.sharedPreview,
      hostContribution: intent.hostContribution,
      planDigest: intent.planDigest,
      completedSteps: intent.completedSteps,
      ...(intent.writer === undefined ? {} : { writer: intent.writer }),
    },
    "$intent",
  );
}

function parseWakeflowMaintenanceExecutionIntentWithPlan(
  value: unknown,
): Readonly<NormalizedWakeflowMaintenanceExecutionIntent> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$intent");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path, error);
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
 * 从已确认计划、原preview请求与resolved desired Config创建恢复意图；`writer` 是可选写者戳。参数都是
 * 类型化的；三者的关系在这里核对，组好的记录再经本编解码的读取解析一次（构造即读回）。
 */
export function createWakeflowMaintenanceExecutionIntent(
  operationId: WakeflowMaintenanceOperationId,
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  request: Readonly<WakeflowStaticMaterializationPreviewRequest>,
  desiredConfig: WakeflowConfigModel,
  writer: Readonly<WakeflowMaintenanceWriter> | null = null,
): Readonly<WakeflowMaintenanceExecutionIntent> {
  if (
    request.action !== plan.sharedPreview.action ||
    request.currentHostProfile.hostId !== plan.hostId ||
    (request.action !== "reconcile" &&
      request.desiredConfig !== null &&
      computeWakeflowConfigDigest(request.desiredConfig) !==
        computeWakeflowConfigDigest(desiredConfig))
  ) {
    fail("relation", "$request");
  }
  return parseWakeflowMaintenanceExecutionIntent({
    artifactKind: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_ARTIFACT_KIND,
    schemaVersion: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA_VERSION,
    operationId,
    desiredConfig: createWakeflowConfigDocumentValue(desiredConfig),
    currentHostProfile: request.currentHostProfile,
    hostProfiles: sortedProfiles(request.hostProfiles),
    sharedPreview: plan.sharedPreview,
    hostContribution: plan.hostContribution,
    planDigest: plan.planDigest,
    completedSteps: 0,
    ...(writer === null ? {} : { writer }),
  });
}

/** 已准入意图的计划：由意图里的计划来源重算（意图读入时已核对过它的摘要）。 */
function planOf(
  intent: Readonly<WakeflowMaintenanceExecutionIntent>,
): Readonly<WakeflowMaintenanceExecutionPlan> {
  try {
    return createWakeflowMaintenanceExecutionPlan(
      intent.sharedPreview,
      intent.currentHostProfile,
      intent.hostContribution,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionPlanError) {
      fail("plan", error.path, error);
    }
    throw error;
  }
}

/**
 * 做完一步之后的意图：计数加一，其余一字不动。全部做完的意图没有后继。
 */
export function advanceWakeflowMaintenanceExecutionIntent(
  intent: Readonly<WakeflowMaintenanceExecutionIntent>,
): Readonly<WakeflowMaintenanceExecutionIntent> {
  if (intent.completedSteps >= planOf(intent).steps.length) fail("relation", "$/completedSteps");
  return Object.freeze({ ...intent, completedSteps: intent.completedSteps + 1 });
}

/** 从一份已准入的意图重建恢复执行所需的exact plan、无signal request与做到第几步。 */
export function reconstructWakeflowMaintenanceExecutionFromIntent(
  intent: Readonly<WakeflowMaintenanceExecutionIntent>,
): Readonly<{
  readonly plan: Readonly<WakeflowMaintenanceExecutionPlan>;
  readonly request: Readonly<WakeflowStaticMaterializationPreviewRequest>;
  readonly completedSteps: number;
}> {
  return Object.freeze({
    plan: planOf(intent),
    completedSteps: intent.completedSteps,
    request: Object.freeze({
      action: intent.sharedPreview.action,
      // reconcile 与 detach-workspace 的请求不带期望 Config；意图里存的是当前 Config。
      desiredConfig: wakeflowStaticMaterializationActionUsesCurrentConfig(
        intent.sharedPreview.action,
      )
        ? null
        : intent.desiredConfig,
      currentHostProfile: intent.currentHostProfile,
      hostProfiles: intent.hostProfiles,
      signal: undefined,
    }),
  });
}

/** 意图里不变部分的语义摘要：计数不进摘要，所以一次维护从头到尾是同一个值。 */
export function computeWakeflowMaintenanceExecutionIntentDigest(
  intent: Readonly<WakeflowMaintenanceExecutionIntent>,
): Sha256Digest {
  const { completedSteps: _completedSteps, ...immutable } = intentRepresentation(intent) as Record<
    string,
    JsonValue
  >;
  return computeCanonicalJsonSha256Digest(immutable);
}

/** 渲染唯一确定性格式化JSON表示。 */
export function renderWakeflowMaintenanceExecutionIntent(
  intent: Readonly<WakeflowMaintenanceExecutionIntent>,
): string {
  return renderDeterministicJsonDocument(intentRepresentation(intent), "$intent");
}

/** 为一个operation生成exact intent动态资源声明。 */
export function createWakeflowMaintenanceIntentResourceDeclaration(
  operationId: WakeflowMaintenanceOperationId,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
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
      allowedMutationRecipes: ["exclusive-create", "exact-source-replace", "exact-retire"],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });
}
