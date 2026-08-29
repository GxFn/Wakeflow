import {
  WAKEFLOW_MAINTENANCE_JOURNAL_SCHEMA,
  type WakeflowMaintenanceJournal as WakeflowMaintenanceJournalWire,
} from "../../contracts/generated/workspace/maintenance-journal.generated.js";
import {
  WAKEFLOW_SHA256_DIGEST_SCHEMA,
} from "../../contracts/generated/foundation/sha256-digest.generated.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
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
import {
  parseWakeflowMaintenanceOperationId,
  WakeflowMaintenanceOperationIdError,
  wakeflowMaintenanceJournalRef,
  type WakeflowMaintenanceOperationId,
} from "./wakeflow-maintenance-operation-id.js";
import {
  parseWakeflowMaintenanceExecutionPlan,
  WakeflowMaintenanceExecutionPlanError,
} from "./wakeflow-maintenance-execution-plan.js";
import type {
  WakeflowStaticMaterializationAction,
} from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：maintenance transaction checkpoint journal领域模型。
 *
 * Journal 保存 operation identity、immutable intent摘要、计划/Config/Matrix摘要、按序
 * step ID和checkpoint。恢复事实位于同operation的0600 intent sidecar；journal不复制
 * Config或host payload。执行只允许prepared → affected step → checkpoint → terminal。
 */

export interface WakeflowMaintenanceJournal {
  readonly kind: "WakeflowMaintenanceJournal";
  readonly schemaVersion: 1;
  readonly operationId: WakeflowMaintenanceOperationId;
  readonly intentDigest: Sha256Digest;
  readonly action: WakeflowStaticMaterializationAction;
  readonly planDigest: Sha256Digest;
  readonly matrixDigest: Sha256Digest;
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfigDigest: Sha256Digest | null;
  readonly stepIds: readonly [string, ...string[]];
  readonly checkpoint: number;
  readonly affectedStepId: string | null;
  readonly state: "prepared" | "executing" | "terminal";
}

export type WakeflowMaintenanceJournalErrorReason =
  | "input"
  | "schema"
  | "operation"
  | "plan"
  | "digest";

const ERROR_MESSAGES = {
  input: "Wakeflow maintenance journal input is invalid.",
  schema: "Wakeflow maintenance journal does not satisfy its Schema.",
  operation: "Wakeflow maintenance journal operation identity is invalid.",
  plan: "Wakeflow maintenance journal requires one ready non-empty execution plan.",
  digest: "Wakeflow maintenance journal contains an invalid digest.",
} as const satisfies Readonly<Record<
  WakeflowMaintenanceJournalErrorReason,
  string
>>;

/** Maintenance journal 领域准入失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceJournalError extends Error {
  override readonly name = "WakeflowMaintenanceJournalError";
  readonly code = "wakeflow-maintenance-journal" as const;
  readonly reason: WakeflowMaintenanceJournalErrorReason;
  readonly path: string;

  constructor(reason: WakeflowMaintenanceJournalErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: WakeflowMaintenanceJournalErrorReason, path: string): never {
  throw new WakeflowMaintenanceJournalError(reason, path);
}

const validateWireJournal =
  createRuntimeJsonSchemaValidator<WakeflowMaintenanceJournalWire>(
    WAKEFLOW_MAINTENANCE_JOURNAL_SCHEMA,
    [WAKEFLOW_SHA256_DIGEST_SCHEMA],
  );

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function nullableDigest(value: unknown, path: string): Sha256Digest | null {
  return value === null ? null : digest(value, path);
}

/** 从 ready 且非空的 exact execution plan 创建初始 prepared journal。 */
export function createPreparedWakeflowMaintenanceJournal(
  operationIdValue: unknown,
  intentDigestValue: unknown,
  planValue: unknown,
): Readonly<WakeflowMaintenanceJournal> {
  let operationId: WakeflowMaintenanceOperationId;
  try {
    operationId = parseWakeflowMaintenanceOperationId(operationIdValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceOperationIdError) {
      fail("operation", "$operationId");
    }
    throw error;
  }
  let plan;
  try {
    plan = parseWakeflowMaintenanceExecutionPlan(planValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionPlanError) {
      fail("plan", "$plan");
    }
    throw error;
  }
  if (
    plan.status !== "ready"
    || plan.steps.length === 0
    || plan.sharedPreview.desiredConfigDigest === null
  ) {
    fail("plan", "$plan");
  }
  const stepIds = Object.freeze(
    plan.steps.map((entry) => entry.stepId),
  ) as readonly [string, ...string[]];
  return Object.freeze({
    kind: "WakeflowMaintenanceJournal",
    schemaVersion: 1,
    operationId,
    intentDigest: digest(intentDigestValue, "$intentDigest"),
    action: plan.sharedPreview.action,
    planDigest: plan.planDigest,
    matrixDigest: plan.sharedPreview.matrixDigest,
    currentConfigDigest: plan.sharedPreview.currentConfigDigest,
    desiredConfigDigest: plan.sharedPreview.desiredConfigDigest,
    stepIds,
    checkpoint: 0,
    affectedStepId: null,
    state: "prepared",
  });
}

/** 把任意内存值解析为严格、冻结的 prepared journal。 */
export function parseWakeflowMaintenanceJournal(
  value: unknown,
): Readonly<WakeflowMaintenanceJournal> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$journal");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", error.path);
    throw error;
  }
  const validated = validateWireJournal(json);
  if (!validated.ok) fail("schema", validated.path);
  let operationId: WakeflowMaintenanceOperationId;
  try {
    operationId = parseWakeflowMaintenanceOperationId(
      validated.value.operationId,
      "$journal.operationId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceOperationIdError) {
      fail("operation", "$journal.operationId");
    }
    throw error;
  }
  const stepIds = Object.freeze([...validated.value.stepIds]) as readonly [
    string,
    ...string[],
  ];
  const checkpoint = validated.value.checkpoint;
  const affectedStepId = validated.value.affectedStepId;
  const state = validated.value.state;
  if (
    checkpoint > stepIds.length
    || (state === "prepared" && (checkpoint !== 0 || affectedStepId !== null))
    || (
      state === "executing"
      && affectedStepId !== null
      && (
        checkpoint >= stepIds.length
        || stepIds[checkpoint] !== affectedStepId
      )
    )
    || (
      state === "terminal"
      && (checkpoint !== stepIds.length || affectedStepId !== null)
    )
  ) {
    fail("schema", "$journal");
  }
  return Object.freeze({
    kind: "WakeflowMaintenanceJournal",
    schemaVersion: 1,
    operationId,
    intentDigest: digest(validated.value.intentDigest, "$journal.intentDigest"),
    action: validated.value.action,
    planDigest: digest(validated.value.planDigest, "$journal.planDigest"),
    matrixDigest: digest(validated.value.matrixDigest, "$journal.matrixDigest"),
    currentConfigDigest: nullableDigest(
      validated.value.currentConfigDigest,
      "$journal.currentConfigDigest",
    ),
    desiredConfigDigest: nullableDigest(
      validated.value.desiredConfigDigest,
      "$journal.desiredConfigDigest",
    ),
    stepIds,
    checkpoint,
    affectedStepId,
    state,
  });
}

function journalRepresentation(journal: Readonly<WakeflowMaintenanceJournal>) {
  return {
    kind: journal.kind,
    schemaVersion: journal.schemaVersion,
    operationId: journal.operationId,
    intentDigest: journal.intentDigest,
    action: journal.action,
    planDigest: journal.planDigest,
    matrixDigest: journal.matrixDigest,
    currentConfigDigest: journal.currentConfigDigest,
    desiredConfigDigest: journal.desiredConfigDigest,
    stepIds: journal.stepIds,
    checkpoint: journal.checkpoint,
    affectedStepId: journal.affectedStepId,
    state: journal.state,
  };
}

function sameImmutableJournal(
  left: Readonly<WakeflowMaintenanceJournal>,
  right: Readonly<WakeflowMaintenanceJournal>,
): boolean {
  return left.operationId === right.operationId
    && left.intentDigest === right.intentDigest
    && left.action === right.action
    && left.planDigest === right.planDigest
    && left.matrixDigest === right.matrixDigest
    && left.currentConfigDigest === right.currentConfigDigest
    && left.desiredConfigDigest === right.desiredConfigDigest
    && left.stepIds.length === right.stepIds.length
    && left.stepIds.every((stepId, index) => right.stepIds[index] === stepId);
}

/** 把稳定 checkpoint 推进为“即将尝试当前 step”的 affected 状态。 */
export function beginWakeflowMaintenanceJournalStep(
  value: unknown,
): Readonly<WakeflowMaintenanceJournal> {
  const journal = parseWakeflowMaintenanceJournal(value);
  if (
    journal.state === "terminal"
    || journal.affectedStepId !== null
    || journal.checkpoint >= journal.stepIds.length
  ) {
    fail("plan", "$journal");
  }
  return Object.freeze({
    ...journal,
    state: "executing" as const,
    affectedStepId: journal.stepIds[journal.checkpoint] ?? null,
  });
}

/** 在领域 owner 已完成并读回后，把 affected step 收敛为下一个稳定 checkpoint。 */
export function completeWakeflowMaintenanceJournalStep(
  value: unknown,
): Readonly<WakeflowMaintenanceJournal> {
  const journal = parseWakeflowMaintenanceJournal(value);
  if (
    journal.state !== "executing"
    || journal.affectedStepId === null
    || journal.stepIds[journal.checkpoint] !== journal.affectedStepId
  ) {
    fail("plan", "$journal");
  }
  return Object.freeze({
    ...journal,
    checkpoint: journal.checkpoint + 1,
    affectedStepId: null,
  });
}

/** 当全部 step 已有稳定 checkpoint 时，把 journal 标记为 terminal。 */
export function terminalizeWakeflowMaintenanceJournal(
  value: unknown,
): Readonly<WakeflowMaintenanceJournal> {
  const journal = parseWakeflowMaintenanceJournal(value);
  if (
    journal.state !== "executing"
    || journal.affectedStepId !== null
    || journal.checkpoint !== journal.stepIds.length
  ) {
    fail("plan", "$journal");
  }
  return Object.freeze({ ...journal, state: "terminal" as const });
}

/** 判断 proposed 是否恰好是 current 允许的一个单调 journal 后继。 */
export function isWakeflowMaintenanceJournalSuccessor(
  currentValue: unknown,
  proposedValue: unknown,
): boolean {
  const current = parseWakeflowMaintenanceJournal(currentValue);
  const proposed = parseWakeflowMaintenanceJournal(proposedValue);
  if (!sameImmutableJournal(current, proposed)) return false;
  if (
    current.state !== "terminal"
    && current.affectedStepId === null
    && current.checkpoint < current.stepIds.length
  ) {
    return proposed.state === "executing"
      && proposed.checkpoint === current.checkpoint
      && proposed.affectedStepId === current.stepIds[current.checkpoint];
  }
  if (
    current.state === "executing"
    && current.affectedStepId === current.stepIds[current.checkpoint]
  ) {
    return proposed.state === "executing"
      && proposed.checkpoint === current.checkpoint + 1
      && proposed.affectedStepId === null;
  }
  return current.state === "executing"
    && current.affectedStepId === null
    && current.checkpoint === current.stepIds.length
    && proposed.state === "terminal"
    && proposed.checkpoint === current.checkpoint
    && proposed.affectedStepId === null;
}

/** 生成 prepared journal 的唯一 deterministic pretty JSON 表示。 */
export function renderWakeflowMaintenanceJournal(value: unknown): string {
  return renderDeterministicJsonDocument(
    journalRepresentation(parseWakeflowMaintenanceJournal(value)),
    "$journal",
  );
}

/** 计算 journal 语义摘要；它不是签名或执行授权。 */
export function computeWakeflowMaintenanceJournalDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    journalRepresentation(parseWakeflowMaintenanceJournal(value)),
  );
}

/** 为一个 operation 生成精确 journal 动态资源声明。 */
export function createWakeflowMaintenanceJournalResourceDeclaration(
  operationIdValue: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  const operationId = parseWakeflowMaintenanceOperationId(operationIdValue);
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: `maintenance.transaction.${operationId}`,
    family: "maintenance",
    ownerId: "workspace-maintenance",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: wakeflowMaintenanceJournalRef(operationId),
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
      allowedMutationRecipes: [
        "exclusive-create",
        "exact-source-replace",
        "exact-retire"
      ],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });
}
