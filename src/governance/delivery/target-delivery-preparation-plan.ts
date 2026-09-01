import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parseTargetDeliveryIntent,
  TargetDeliveryIntentError,
  type TargetDeliveryIntent,
} from "./target-delivery-intent.js";

/**
 * Wakeflow Governance / Delivery：Target Delivery Preparation的不可变preview/apply计划。
 *
 * 计划只冻结一次事件追加所需的Intent、Event/Commit身份和预期stream revision。完整
 * TaskPackage由Apply从原始Tasking事件恢复；plan digest不是授权，Apply仍会重验当前
 * Config、Demand、TaskPackage投影和私有Binding，或证明同一Commit已经存在。
 */

const PLAN_KIND = "WakeflowTargetDeliveryPreparationPlan" as const;
const PLAN_SCHEMA_VERSION = 1 as const;

export interface TargetDeliveryPreparationPlan {
  readonly kind: typeof PLAN_KIND;
  readonly schemaVersion: typeof PLAN_SCHEMA_VERSION;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly expectedStreamRevision: number;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly intent: Readonly<TargetDeliveryIntent>;
}

export type TargetDeliveryPreparationPlanErrorReason =
  "input" | "identifier" | "position" | "intent" | "relation";

const ERROR_MESSAGES = {
  input: "Target Delivery Preparation plan input is invalid.",
  identifier: "Target Delivery Preparation plan contains an invalid identity.",
  position:
    "Target Delivery Preparation plan contains an invalid stream position.",
  intent: "Target Delivery Preparation plan contains an invalid Intent.",
  relation: "Target Delivery Preparation plan fields do not close.",
} as const satisfies Readonly<
  Record<TargetDeliveryPreparationPlanErrorReason, string>
>;

/** Preparation plan准入失败时返回的稳定、脱敏错误。 */
export class TargetDeliveryPreparationPlanError extends Error {
  override readonly name = "TargetDeliveryPreparationPlanError";
  readonly code = "wakeflow-target-delivery-preparation-plan" as const;
  readonly reason: TargetDeliveryPreparationPlanErrorReason;
  readonly path: string;

  constructor(reason: TargetDeliveryPreparationPlanErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const PLAN_FIELDS = Object.freeze([
  "commitId",
  "demandId",
  "eventId",
  "expectedStreamRevision",
  "intent",
  "kind",
  "schemaVersion",
  "targetTaskId",
] as const);
const DRAFT_FIELDS = Object.freeze([
  "commitId",
  "demandId",
  "eventId",
  "expectedStreamRevision",
  "intent",
  "targetTaskId",
] as const);

function fail(
  reason: TargetDeliveryPreparationPlanErrorReason,
  path: string,
): never {
  throw new TargetDeliveryPreparationPlanError(reason, path);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length ||
    keys.some((key, index) => key !== fields[index])
  ) {
    fail("input", path);
  }
  return record;
}

function id<
  Kind extends
    "demand" | "target-task" | "demand-event" | "demand-event-commit",
>(value: unknown, kind: Kind, path: string): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

/** 解析并冻结字段集合关闭、内部关系一致的Preparation plan。 */
export function parseTargetDeliveryPreparationPlan(
  value: unknown,
): Readonly<TargetDeliveryPreparationPlan> {
  const record = exactRecord(value, PLAN_FIELDS, "$plan");
  if (
    record.kind !== PLAN_KIND ||
    record.schemaVersion !== PLAN_SCHEMA_VERSION
  ) {
    fail("input", "$plan");
  }
  if (
    !Number.isSafeInteger(record.expectedStreamRevision) ||
    (record.expectedStreamRevision as number) < 2
  ) {
    fail("position", "$/expectedStreamRevision");
  }
  let intent: Readonly<TargetDeliveryIntent>;
  try {
    intent = parseTargetDeliveryIntent(record.intent);
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryIntentError) fail("intent", "$/intent");
    throw error;
  }
  const demandId = id(record.demandId, "demand", "$/demandId");
  const targetTaskId = id(record.targetTaskId, "target-task", "$/targetTaskId");
  if (
    intent.demandId !== demandId ||
    intent.target.targetTaskId !== targetTaskId
  ) {
    fail("relation", "$plan");
  }
  return Object.freeze({
    kind: PLAN_KIND,
    schemaVersion: PLAN_SCHEMA_VERSION,
    demandId,
    targetTaskId,
    expectedStreamRevision: record.expectedStreamRevision as number,
    commitId: id(record.commitId, "demand-event-commit", "$/commitId"),
    eventId: id(record.eventId, "demand-event", "$/eventId"),
    intent,
  });
}

/** 从已准入字段创建计划；仍统一经过严格plan parser。 */
export function createTargetDeliveryPreparationPlan(
  value: unknown,
): Readonly<TargetDeliveryPreparationPlan> {
  const record = exactRecord(value, DRAFT_FIELDS, "$draft");
  return parseTargetDeliveryPreparationPlan({
    kind: PLAN_KIND,
    schemaVersion: PLAN_SCHEMA_VERSION,
    demandId: record.demandId,
    targetTaskId: record.targetTaskId,
    expectedStreamRevision: record.expectedStreamRevision,
    commitId: record.commitId,
    eventId: record.eventId,
    intent: record.intent,
  });
}

/** 计算preview/apply使用的Canonical plan digest。 */
export function computeTargetDeliveryPreparationPlanDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseTargetDeliveryPreparationPlan(value),
  );
}
