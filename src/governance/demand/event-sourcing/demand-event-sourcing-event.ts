import type { WakeflowDecisionRecordedEventDataV1 } from "../../../contracts/generated/governance/demand/decision-recorded-event-data-v1.generated.js";
import { WAKEFLOW_DECISION_RECORDED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/decision-recorded-event-data-v1.generated.js";
import type { WakeflowDemandContinuedEventDataV1 } from "../../../contracts/generated/governance/demand/demand-continued-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_CONTINUED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/demand-continued-event-data-v1.generated.js";
import type { WakeflowDemandEscalatedEventDataV1 } from "../../../contracts/generated/governance/demand/demand-escalated-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_ESCALATED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/demand-escalated-event-data-v1.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import {
  parseJsonValue,
  JsonValueError,
  type JsonValue,
} from "../../../foundation/data/json-value.js";
import {
  createRuntimeJsonSchemaValidator,
  type RuntimeJsonSchemaValidator,
} from "../../../foundation/schema/runtime-json-schema.js";
import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
} from "../../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../../foundation/time/utc-instant.js";
import {
  parseManagedEvidenceManifest,
  ManagedEvidenceManifestError,
  type ManagedEvidenceManifest,
} from "../../evidence/managed-evidence-manifest.js";
import {
  parseTaskPackage,
  TaskPackageError,
  type TaskPackage,
} from "../../tasking/task-package.js";
import {
  parseTargetResult,
  targetResultRecordedEventIdFromResult,
  TargetResultError,
  type TargetResult,
} from "../../result/target-result.js";
import {
  controllerReviewDecisionEventId,
  parseControllerReviewDecision,
  ControllerReviewDecisionError,
  type ControllerReviewDecision,
} from "../../review/controller-review-decision.js";
import {
  controllerTargetReviewResumeEventId,
  parseControllerTargetReviewResume,
  ControllerTargetReviewResumeError,
  type ControllerTargetReviewResume,
} from "../../review/controller-target-review-resume.js";
import {
  parseControllerProductDefectRemediationAuthorization,
  productDefectRemediationAuthorizedEventId,
  ControllerProductDefectRemediationAuthorizationError,
  type ControllerProductDefectRemediationAuthorization,
} from "../../review/controller-product-defect-remediation-authorization.js";
import {
  parseDemandCompletion,
  DemandCompletionError,
  type DemandCompletion,
} from "../../lifecycle/demand-completion.js";
import {
  parseTestCard,
  TestCardError,
  type TestCard,
} from "../../testing/test-card.js";
import {
  parseTestCardGenerationSource,
  TestCardGenerationSourceError,
  type TestCardGenerationSource,
} from "../../testing/test-card-generation-source.js";

import {
  DeliveryEnvelopeError,
  parseDeliveryEnvelope,
  type DeliveryEnvelope,
} from "../../delivery/delivery-envelope.js";
import {
  DeliveryOutcomeError,
  parseDeliveryOutcome,
  type DeliveryOutcome,
} from "../../delivery/delivery-outcome.js";
import {
  DeliveryRearmError,
  parseDeliveryRearm,
  type DeliveryRearm,
} from "../../delivery/delivery-rearm.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：尚未进入事件存储的领域事件。
 *
 * 当前未提交事件只描述已经发生的业务事实、稳定身份和记录时间。它不携带持久化
 * `eventVersion`、事件流修订号、提交序号、前序提交或结果状态摘要。版本编解码器
 * 负责当前内存模型与磁盘版本之间的转换。
 */

export interface DemandPublishedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "publication.demand-published";
  readonly data: Readonly<{
    readonly identityRef: "identity.json";
    readonly identityDigest: Sha256Digest;
    readonly authorityRef: "authority.json";
    readonly authorityDigest: Sha256Digest;
  }>;
}

export interface DemandCancelledUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "lifecycle.demand-cancelled";
  readonly data: Readonly<{
    readonly reason: string;
  }>;
}

export interface DemandCompletedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "lifecycle.demand-completed";
  readonly data: Readonly<{
    readonly completion: Readonly<DemandCompletion>;
  }>;
}

/** 升级：问题、需求章节引用、证据、备选方案、建议与来源（ADR-0012 D5）。 */
export type DemandEscalation = Readonly<WakeflowDemandEscalatedEventDataV1["escalation"]>;
export type DemandDecisionRecord = Readonly<WakeflowDecisionRecordedEventDataV1["decision"]>;
export type DemandContinuation = Readonly<WakeflowDemandContinuedEventDataV1["continuation"]>;

export interface DemandEscalatedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "lifecycle.demand-escalated";
  readonly data: Readonly<{
    readonly escalation: DemandEscalation;
  }>;
}

export interface DecisionRecordedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "lifecycle.decision-recorded";
  readonly data: Readonly<{
    readonly decision: DemandDecisionRecord;
  }>;
}

export interface DemandContinuedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "lifecycle.demand-continued";
  readonly data: Readonly<{
    readonly continuation: DemandContinuation;
  }>;
}

export interface ManagedEvidenceRecordedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "evidence.managed-evidence-recorded";
  readonly data: Readonly<{
    readonly manifest: Readonly<ManagedEvidenceManifest>;
  }>;
}

export interface TargetTaskPlannedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "tasking.target-task-planned";
  readonly data: Readonly<{
    readonly taskPackage: Readonly<TaskPackage>;
  }>;
}

export interface TestCardCreatedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "testing.test-card-created";
  readonly data: Readonly<{
    readonly testCard: Readonly<TestCard>;
    readonly generationSource: Readonly<TestCardGenerationSource>;
  }>;
}

export interface DeliveryPreparedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "delivery.delivery-prepared";
  readonly data: Readonly<{
    readonly envelope: Readonly<DeliveryEnvelope>;
  }>;
}

export interface DeliveryOutcomeRecordedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "delivery.delivery-outcome-recorded";
  readonly data: Readonly<{
    readonly outcome: Readonly<DeliveryOutcome>;
  }>;
}

export interface DeliveryRearmedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "delivery.delivery-rearmed";
  readonly data: Readonly<{
    readonly rearm: Readonly<DeliveryRearm>;
  }>;
}

export interface TargetResultRecordedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "result.target-result-recorded";
  readonly data: Readonly<{
    readonly result: Readonly<TargetResult>;
  }>;
}

export interface ControllerTargetReviewDecidedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "review.target-result-decided";
  readonly data: Readonly<{
    readonly decision: Readonly<ControllerReviewDecision>;
  }>;
}

export interface ControllerTargetReviewResumedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "review.target-result-resumed";
  readonly data: Readonly<{
    readonly resume: Readonly<ControllerTargetReviewResume>;
  }>;
}

export interface ProductDefectRemediationAuthorizedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "review.product-defect-remediation-authorized";
  readonly data: Readonly<{
    readonly authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
  }>;
}

export type DemandUncommittedEvent =
  | DemandPublishedUncommittedEvent
  | DemandCancelledUncommittedEvent
  | DemandCompletedUncommittedEvent
  | DemandEscalatedUncommittedEvent
  | DecisionRecordedUncommittedEvent
  | DemandContinuedUncommittedEvent
  | ManagedEvidenceRecordedUncommittedEvent
  | TestCardCreatedUncommittedEvent
  | TargetTaskPlannedUncommittedEvent
  | DeliveryPreparedUncommittedEvent
  | DeliveryOutcomeRecordedUncommittedEvent
  | DeliveryRearmedUncommittedEvent
  | TargetResultRecordedUncommittedEvent
  | ControllerTargetReviewDecidedUncommittedEvent
  | ControllerTargetReviewResumedUncommittedEvent
  | ProductDefectRemediationAuthorizedUncommittedEvent;

export type DemandEventSourcingEventErrorReason =
  | "input"
  | "identifier"
  | "time"
  | "digest"
  | "event-type"
  | "text"
  | "task-package"
  | "delivery-envelope"
  | "delivery-outcome"
  | "delivery-rearm"
  | "target-result"
  | "controller-review-decision"
  | "controller-product-defect-remediation-authorization"
  | "controller-target-review-resume"
  | "demand-completion"
  | "lifecycle-data"
  | "managed-evidence-manifest"
  | "test-card"
  | "test-card-generation-source"
  | "relation";

const ERROR_MESSAGES = {
  input: "Demand Event Sourcing event input is invalid.",
  identifier: "Demand Event Sourcing event contains an invalid identity.",
  time: "Demand Event Sourcing event contains an invalid recorded time.",
  digest: "Demand Event Sourcing event contains an invalid digest.",
  "event-type":
    "Demand Event Sourcing event type and data do not form one closed variant.",
  text: "Demand Event Sourcing event contains non-canonical text.",
  "task-package":
    "Demand Event Sourcing event contains an invalid TaskPackage.",
  "delivery-envelope":
    "Demand Event Sourcing event contains an invalid Delivery Envelope.",
  "delivery-outcome":
    "Demand Event Sourcing event contains an invalid Delivery Outcome.",
  "delivery-rearm":
    "Demand Event Sourcing event contains an invalid Delivery Rearm.",
  "target-result":
    "Demand Event Sourcing event contains an invalid TargetResult.",
  "controller-review-decision":
    "Demand Event Sourcing event contains an invalid Controller Review Decision.",
  "controller-product-defect-remediation-authorization":
    "Demand Event Sourcing event contains an invalid Controller Product Defect Remediation Authorization.",
  "controller-target-review-resume":
    "Demand Event Sourcing event contains an invalid Controller Target Review Resume.",
  "demand-completion":
    "Demand Event Sourcing event contains an invalid Demand Completion.",
  "lifecycle-data":
    "Demand Event Sourcing event carries invalid lifecycle data.",
  "managed-evidence-manifest":
    "Demand Event Sourcing event contains an invalid Managed Evidence Manifest.",
  "test-card": "Demand Event Sourcing event contains an invalid TestCard.",
  "test-card-generation-source":
    "Demand Event Sourcing event contains an invalid TestCard Generation Source.",
  relation: "Demand Event Sourcing event identity and payload do not close.",
} as const satisfies Readonly<
  Record<DemandEventSourcingEventErrorReason, string>
>;

export class DemandEventSourcingEventError extends Error {
  override readonly name = "DemandEventSourcingEventError";
  readonly code = "wakeflow-demand-event-sourcing-event" as const;
  readonly reason: DemandEventSourcingEventErrorReason;
  readonly path: string;

  constructor(reason: DemandEventSourcingEventErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const BASE_FIELDS = Object.freeze([
  "data",
  "demandId",
  "eventId",
  "eventType",
  "recordedAt",
] as const);
const PUBLISHED_DATA_FIELDS = Object.freeze([
  "authorityDigest",
  "authorityRef",
  "identityDigest",
  "identityRef",
] as const);
const CANCELLED_DATA_FIELDS = Object.freeze(["reason"] as const);
const COMPLETED_DATA_FIELDS = Object.freeze(["completion"] as const);
const ESCALATED_DATA_FIELDS = Object.freeze(["escalation"] as const);
const DECISION_RECORDED_DATA_FIELDS = Object.freeze(["decision"] as const);
const CONTINUED_DATA_FIELDS = Object.freeze(["continuation"] as const);
const LIFECYCLE_DATA_REFERENCES = Object.freeze([
  WAKEFLOW_SHA256_DIGEST_SCHEMA,
  WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
  WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
const validateEscalatedData =
  createRuntimeJsonSchemaValidator<WakeflowDemandEscalatedEventDataV1>(
    WAKEFLOW_DEMAND_ESCALATED_EVENT_DATA_V1_SCHEMA,
    LIFECYCLE_DATA_REFERENCES,
  );
const validateDecisionRecordedData =
  createRuntimeJsonSchemaValidator<WakeflowDecisionRecordedEventDataV1>(
    WAKEFLOW_DECISION_RECORDED_EVENT_DATA_V1_SCHEMA,
    LIFECYCLE_DATA_REFERENCES,
  );
const validateContinuedData =
  createRuntimeJsonSchemaValidator<WakeflowDemandContinuedEventDataV1>(
    WAKEFLOW_DEMAND_CONTINUED_EVENT_DATA_V1_SCHEMA,
    LIFECYCLE_DATA_REFERENCES,
  );

/** 生命周期事件的数据只有 Schema 形状，没有独立领域编解码器；这里按 Schema 严格准入。 */
function lifecycleData<Data>(
  validate: RuntimeJsonSchemaValidator<Data>,
  value: unknown,
  path: string,
): Readonly<Data> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("lifecycle-data", path);
    throw error;
  }
  const result = validate(json);
  if (!result.ok) fail("lifecycle-data", path);
  return Object.freeze(result.value);
}
const MANAGED_EVIDENCE_RECORDED_DATA_FIELDS = Object.freeze([
  "manifest",
] as const);
const TARGET_TASK_PLANNED_DATA_FIELDS = Object.freeze(["taskPackage"] as const);
const TEST_CARD_CREATED_DATA_FIELDS = Object.freeze([
  "generationSource",
  "testCard",
] as const);
const DELIVERY_PREPARED_DATA_FIELDS = Object.freeze(["envelope"] as const);
const DELIVERY_OUTCOME_RECORDED_DATA_FIELDS = Object.freeze(["outcome"] as const);
const DELIVERY_REARMED_DATA_FIELDS = Object.freeze(["rearm"] as const);
const TARGET_RESULT_RECORDED_DATA_FIELDS = Object.freeze(["result"] as const);
const CONTROLLER_TARGET_REVIEW_DECIDED_DATA_FIELDS = Object.freeze([
  "decision",
] as const);
const CONTROLLER_TARGET_REVIEW_RESUMED_DATA_FIELDS = Object.freeze([
  "resume",
] as const);
const PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_DATA_FIELDS = Object.freeze([
  "authorization",
] as const);
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

function fail(
  reason: DemandEventSourcingEventErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingEventError(reason, path);
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

function parseId<Kind extends "demand" | "demand-event">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function parseTime(value: unknown): UtcInstant {
  try {
    return parseUtcInstant(value, "$/recordedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/recordedAt");
    throw error;
  }
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function parseCanonicalReason(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8192 ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", "$/data/reason");
  }
  return value;
}

/** 解析字段集合严格受限，且不含任何持久化位置字段的未提交事件。 */
export function parseDemandUncommittedEvent(
  value: unknown,
): Readonly<DemandUncommittedEvent> {
  const record = exactRecord(value, BASE_FIELDS, "$event");
  const eventId = parseId(record.eventId, "demand-event", "$/eventId");
  const demandId = parseId(record.demandId, "demand", "$/demandId");
  const recordedAt = parseTime(record.recordedAt);

  if (record.eventType === "publication.demand-published") {
    const data = exactRecord(record.data, PUBLISHED_DATA_FIELDS, "$/data");
    if (
      data.identityRef !== "identity.json" ||
      data.authorityRef !== "authority.json"
    ) {
      fail("event-type", "$/data");
    }
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "publication.demand-published",
      data: Object.freeze({
        identityRef: "identity.json",
        identityDigest: parseDigest(
          data.identityDigest,
          "$/data/identityDigest",
        ),
        authorityRef: "authority.json",
        authorityDigest: parseDigest(
          data.authorityDigest,
          "$/data/authorityDigest",
        ),
      }),
    });
  }

  if (record.eventType === "lifecycle.demand-cancelled") {
    const data = exactRecord(record.data, CANCELLED_DATA_FIELDS, "$/data");
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "lifecycle.demand-cancelled",
      data: Object.freeze({ reason: parseCanonicalReason(data.reason) }),
    });
  }

  if (record.eventType === "lifecycle.demand-completed") {
    const data = exactRecord(record.data, COMPLETED_DATA_FIELDS, "$/data");
    let completion: Readonly<DemandCompletion>;
    try {
      completion = parseDemandCompletion(data.completion);
    } catch (error: unknown) {
      if (error instanceof DemandCompletionError) {
        fail("demand-completion", "$/data/completion");
      }
      throw error;
    }
    if (
      completion.demandId !== demandId ||
      completion.completedAt !== recordedAt
    ) {
      fail("relation", "$event");
    }
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "lifecycle.demand-completed",
      data: Object.freeze({ completion }),
    });
  }

  if (record.eventType === "lifecycle.demand-escalated") {
    const data = exactRecord(record.data, ESCALATED_DATA_FIELDS, "$/data");
    const escalation = lifecycleData(validateEscalatedData, data, "$/data").escalation;
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "lifecycle.demand-escalated",
      data: Object.freeze({ escalation: Object.freeze(escalation) }),
    });
  }

  if (record.eventType === "lifecycle.decision-recorded") {
    const data = exactRecord(record.data, DECISION_RECORDED_DATA_FIELDS, "$/data");
    const decision = lifecycleData(validateDecisionRecordedData, data, "$/data").decision;
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "lifecycle.decision-recorded",
      data: Object.freeze({ decision: Object.freeze(decision) }),
    });
  }

  if (record.eventType === "lifecycle.demand-continued") {
    const data = exactRecord(record.data, CONTINUED_DATA_FIELDS, "$/data");
    const continuation = lifecycleData(validateContinuedData, data, "$/data").continuation;
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "lifecycle.demand-continued",
      data: Object.freeze({ continuation: Object.freeze(continuation) }),
    });
  }

  if (record.eventType === "evidence.managed-evidence-recorded") {
    const data = exactRecord(
      record.data,
      MANAGED_EVIDENCE_RECORDED_DATA_FIELDS,
      "$/data",
    );
    let manifest: Readonly<ManagedEvidenceManifest>;
    try {
      manifest = parseManagedEvidenceManifest(data.manifest);
    } catch (error: unknown) {
      if (error instanceof ManagedEvidenceManifestError) {
        fail("managed-evidence-manifest", "$/data/manifest");
      }
      throw error;
    }
    if (manifest.demandId !== demandId || manifest.capturedAt !== recordedAt) {
      fail("relation", "$event");
    }
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "evidence.managed-evidence-recorded",
      data: Object.freeze({ manifest }),
    });
  }

  if (record.eventType === "testing.test-card-created") {
    const data = exactRecord(
      record.data,
      TEST_CARD_CREATED_DATA_FIELDS,
      "$/data",
    );
    let testCard: Readonly<TestCard>;
    let generationSource: Readonly<TestCardGenerationSource>;
    try {
      testCard = parseTestCard(data.testCard);
    } catch (error: unknown) {
      if (error instanceof TestCardError) {
        fail("test-card", "$/data/testCard");
      }
      throw error;
    }
    try {
      generationSource = parseTestCardGenerationSource(data.generationSource);
    } catch (error: unknown) {
      if (error instanceof TestCardGenerationSourceError) {
        fail("test-card-generation-source", "$/data/generationSource");
      }
      throw error;
    }
    if (testCard.demandId !== demandId || testCard.createdAt !== recordedAt) {
      fail("relation", "$event");
    }
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "testing.test-card-created",
      data: Object.freeze({ testCard, generationSource }),
    });
  }

  if (record.eventType === "tasking.target-task-planned") {
    const data = exactRecord(
      record.data,
      TARGET_TASK_PLANNED_DATA_FIELDS,
      "$/data",
    );
    let taskPackage: Readonly<TaskPackage>;
    try {
      taskPackage = parseTaskPackage(data.taskPackage);
    } catch (error: unknown) {
      if (error instanceof TaskPackageError) {
        fail("task-package", "$/data/taskPackage");
      }
      throw error;
    }
    if (
      taskPackage.demandId !== demandId ||
      taskPackage.createdAt !== recordedAt
    ) {
      fail("relation", "$event");
    }
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "tasking.target-task-planned",
      data: Object.freeze({ taskPackage }),
    });
  }

  if (record.eventType === "delivery.delivery-prepared") {
    const data = exactRecord(record.data, DELIVERY_PREPARED_DATA_FIELDS, "$/data");
    let envelope: Readonly<DeliveryEnvelope>;
    try {
      envelope = parseDeliveryEnvelope(data.envelope);
    } catch (error: unknown) {
      if (error instanceof DeliveryEnvelopeError) {
        fail("delivery-envelope", "$/data/envelope");
      }
      throw error;
    }
    if (envelope.demandId !== demandId || envelope.preparedAt !== recordedAt) {
      fail("relation", "$event");
    }
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "delivery.delivery-prepared",
      data: Object.freeze({ envelope }),
    });
  }

  if (record.eventType === "delivery.delivery-outcome-recorded") {
    const data = exactRecord(record.data, DELIVERY_OUTCOME_RECORDED_DATA_FIELDS, "$/data");
    let outcome: Readonly<DeliveryOutcome>;
    try {
      outcome = parseDeliveryOutcome(data.outcome);
    } catch (error: unknown) {
      if (error instanceof DeliveryOutcomeError) {
        fail("delivery-outcome", "$/data/outcome");
      }
      throw error;
    }
    if (outcome.observedAt !== recordedAt) fail("relation", "$event");
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "delivery.delivery-outcome-recorded",
      data: Object.freeze({ outcome }),
    });
  }

  if (record.eventType === "delivery.delivery-rearmed") {
    const data = exactRecord(record.data, DELIVERY_REARMED_DATA_FIELDS, "$/data");
    let rearm: Readonly<DeliveryRearm>;
    try {
      rearm = parseDeliveryRearm(data.rearm);
    } catch (error: unknown) {
      if (error instanceof DeliveryRearmError) fail("delivery-rearm", "$/data/rearm");
      throw error;
    }
    if (rearm.rearmedAt !== recordedAt) fail("relation", "$event");
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "delivery.delivery-rearmed",
      data: Object.freeze({ rearm }),
    });
  }

  if (record.eventType === "result.target-result-recorded") {
    const data = exactRecord(
      record.data,
      TARGET_RESULT_RECORDED_DATA_FIELDS,
      "$/data",
    );
    let result: Readonly<TargetResult>;
    try {
      result = parseTargetResult(data.result);
    } catch (error: unknown) {
      if (error instanceof TargetResultError) {
        fail("target-result", "$/data/result");
      }
      throw error;
    }
    if (
      result.demandId !== demandId ||
      result.report.reportedAt !== recordedAt ||
      targetResultRecordedEventIdFromResult(result) !== eventId
    ) {
      fail("relation", "$event");
    }
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "result.target-result-recorded",
      data: Object.freeze({ result }),
    });
  }

  if (record.eventType === "review.target-result-decided") {
    const data = exactRecord(
      record.data,
      CONTROLLER_TARGET_REVIEW_DECIDED_DATA_FIELDS,
      "$/data",
    );
    let decision: Readonly<ControllerReviewDecision>;
    try {
      decision = parseControllerReviewDecision(data.decision);
    } catch (error: unknown) {
      if (error instanceof ControllerReviewDecisionError) {
        fail("controller-review-decision", "$/data/decision");
      }
      throw error;
    }
    if (
      decision.demandId !== demandId ||
      decision.decidedAt !== recordedAt ||
      controllerReviewDecisionEventId(decision) !== eventId
    ) {
      fail("relation", "$event");
    }
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "review.target-result-decided",
      data: Object.freeze({ decision }),
    });
  }

  if (record.eventType === "review.product-defect-remediation-authorized") {
    const data = exactRecord(
      record.data,
      PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_DATA_FIELDS,
      "$/data",
    );
    let authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
    try {
      authorization = parseControllerProductDefectRemediationAuthorization(
        data.authorization,
      );
    } catch (error: unknown) {
      if (
        error instanceof ControllerProductDefectRemediationAuthorizationError
      ) {
        fail(
          "controller-product-defect-remediation-authorization",
          "$/data/authorization",
        );
      }
      throw error;
    }
    if (
      authorization.demandId !== demandId ||
      authorization.authorizedAt !== recordedAt ||
      productDefectRemediationAuthorizedEventId(authorization) !== eventId
    ) {
      fail("relation", "$event");
    }
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "review.product-defect-remediation-authorized",
      data: Object.freeze({ authorization }),
    });
  }

  if (record.eventType === "review.target-result-resumed") {
    const data = exactRecord(
      record.data,
      CONTROLLER_TARGET_REVIEW_RESUMED_DATA_FIELDS,
      "$/data",
    );
    let resume: Readonly<ControllerTargetReviewResume>;
    try {
      resume = parseControllerTargetReviewResume(data.resume);
    } catch (error: unknown) {
      if (error instanceof ControllerTargetReviewResumeError) {
        fail("controller-target-review-resume", "$/data/resume");
      }
      throw error;
    }
    if (
      resume.demandId !== demandId ||
      resume.resumedAt !== recordedAt ||
      controllerTargetReviewResumeEventId(resume) !== eventId
    ) {
      fail("relation", "$event");
    }
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "review.target-result-resumed",
      data: Object.freeze({ resume }),
    });
  }

  fail("event-type", "$/eventType");
}
