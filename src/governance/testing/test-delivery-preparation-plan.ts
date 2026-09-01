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
  parseTestDeliveryIntent,
  TestDeliveryIntentError,
  type TestDeliveryIntent,
} from "./test-delivery-intent.js";

/** Test Delivery Preparation preview/apply使用的不可变Event计划。 */

const PLAN_KIND = "WakeflowTestDeliveryPreparationPlan" as const;
const PLAN_SCHEMA_VERSION = 1 as const;

export interface TestDeliveryPreparationPlan {
  readonly kind: typeof PLAN_KIND;
  readonly schemaVersion: typeof PLAN_SCHEMA_VERSION;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly expectedStreamRevision: number;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly intent: Readonly<TestDeliveryIntent>;
}

export type TestDeliveryPreparationPlanErrorReason =
  "input" | "identifier" | "position" | "intent" | "relation";

const ERROR_MESSAGES = {
  input: "Test Delivery Preparation plan input is invalid.",
  identifier: "Test Delivery Preparation plan contains an invalid identity.",
  position:
    "Test Delivery Preparation plan contains an invalid stream position.",
  intent: "Test Delivery Preparation plan contains an invalid Intent.",
  relation: "Test Delivery Preparation plan fields do not close.",
} as const satisfies Readonly<
  Record<TestDeliveryPreparationPlanErrorReason, string>
>;

export class TestDeliveryPreparationPlanError extends Error {
  override readonly name = "TestDeliveryPreparationPlanError";
  readonly code = "wakeflow-test-delivery-preparation-plan" as const;
  readonly reason: TestDeliveryPreparationPlanErrorReason;
  readonly path: string;

  constructor(reason: TestDeliveryPreparationPlanErrorReason, path: string) {
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
  reason: TestDeliveryPreparationPlanErrorReason,
  path: string,
): never {
  throw new TestDeliveryPreparationPlanError(reason, path);
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

export function parseTestDeliveryPreparationPlan(
  value: unknown,
): Readonly<TestDeliveryPreparationPlan> {
  const record = exactRecord(value, PLAN_FIELDS, "$plan");
  if (
    record.kind !== PLAN_KIND ||
    record.schemaVersion !== PLAN_SCHEMA_VERSION
  ) {
    fail("input", "$plan");
  }
  if (
    !Number.isSafeInteger(record.expectedStreamRevision) ||
    (record.expectedStreamRevision as number) < 1
  ) {
    fail("position", "$/expectedStreamRevision");
  }
  let intent: Readonly<TestDeliveryIntent>;
  try {
    intent = parseTestDeliveryIntent(record.intent);
  } catch (error: unknown) {
    if (error instanceof TestDeliveryIntentError) fail("intent", "$/intent");
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

export function createTestDeliveryPreparationPlan(
  value: unknown,
): Readonly<TestDeliveryPreparationPlan> {
  const record = exactRecord(value, DRAFT_FIELDS, "$draft");
  return parseTestDeliveryPreparationPlan({
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

export function computeTestDeliveryPreparationPlanDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseTestDeliveryPreparationPlan(value),
  );
}
