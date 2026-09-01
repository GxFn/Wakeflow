import type { WakeflowDemandCancelledEventDataV1 } from "../../../contracts/generated/governance/demand/demand-cancelled-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_CANCELLED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/demand-cancelled-event-data-v1.generated.js";
import type { WakeflowDemandCompletedEventDataV1 } from "../../../contracts/generated/governance/demand/demand-completed-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_COMPLETED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/demand-completed-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_COMPLETION_SCHEMA } from "../../../contracts/generated/governance/lifecycle/demand-completion.generated.js";
import type { WakeflowDemandPublishedEventDataV1 } from "../../../contracts/generated/governance/demand/demand-published-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_PUBLISHED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/demand-published-event-data-v1.generated.js";
import type { WakeflowTargetTaskPlannedEventDataV1 } from "../../../contracts/generated/governance/demand/target-task-planned-event-data-v1.generated.js";
import { WAKEFLOW_TARGET_TASK_PLANNED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/target-task-planned-event-data-v1.generated.js";
import type { WakeflowTestCardCreatedEventDataV1 } from "../../../contracts/generated/governance/demand/test-card-created-event-data-v1.generated.js";
import { WAKEFLOW_TEST_CARD_CREATED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/test-card-created-event-data-v1.generated.js";
import type { WakeflowTestCardCreatedEventDataV2 } from "../../../contracts/generated/governance/demand/test-card-created-event-data-v2.generated.js";
import { WAKEFLOW_TEST_CARD_CREATED_EVENT_DATA_V2_SCHEMA } from "../../../contracts/generated/governance/demand/test-card-created-event-data-v2.generated.js";
import { WAKEFLOW_TEST_CARD_SCHEMA } from "../../../contracts/generated/governance/testing/test-card.generated.js";
import { WAKEFLOW_TEST_CARD_GENERATION_SOURCE_SCHEMA } from "../../../contracts/generated/governance/testing/test-card-generation-source.generated.js";
import type { WakeflowTestDeliveryPreparedEventDataV1 } from "../../../contracts/generated/governance/demand/test-delivery-prepared-event-data-v1.generated.js";
import { WAKEFLOW_TEST_DELIVERY_PREPARED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/test-delivery-prepared-event-data-v1.generated.js";
import { WAKEFLOW_TEST_DELIVERY_INTENT_SCHEMA } from "../../../contracts/generated/governance/testing/test-delivery-intent.generated.js";
import { WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA } from "../../../contracts/generated/governance/testing/test-execution-attempt.generated.js";
import type { WakeflowTargetDeliveryPreparedEventDataV1 } from "../../../contracts/generated/governance/demand/target-delivery-prepared-event-data-v1.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_PREPARED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/target-delivery-prepared-event-data-v1.generated.js";
import type { WakeflowTargetDeliveryPreparedEventDataV2 } from "../../../contracts/generated/governance/demand/target-delivery-prepared-event-data-v2.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_PREPARED_EVENT_DATA_V2_SCHEMA } from "../../../contracts/generated/governance/demand/target-delivery-prepared-event-data-v2.generated.js";
import type { WakeflowTargetDeliveryPreparedEventDataV3 } from "../../../contracts/generated/governance/demand/target-delivery-prepared-event-data-v3.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_PREPARED_EVENT_DATA_V3_SCHEMA } from "../../../contracts/generated/governance/demand/target-delivery-prepared-event-data-v3.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA } from "../../../contracts/generated/governance/delivery/target-delivery-intent.generated.js";
import type { WakeflowTargetHostEffectClaimedEventDataV1 } from "../../../contracts/generated/governance/demand/target-host-effect-claimed-event-data-v1.generated.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_CLAIMED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/target-host-effect-claimed-event-data-v1.generated.js";
import { WAKEFLOW_WINDOW_WORK_CLAIM_SCHEMA } from "../../../contracts/generated/governance/delivery/window-work-claim.generated.js";
import type { WakeflowTargetHostEffectObservedEventDataV1 } from "../../../contracts/generated/governance/demand/target-host-effect-observed-event-data-v1.generated.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_OBSERVED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/target-host-effect-observed-event-data-v1.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_HOST_EFFECT_OBSERVATION_SCHEMA } from "../../../contracts/generated/governance/delivery/target-delivery-host-effect-observation.generated.js";
import type { WakeflowTargetHostEffectRearmedEventDataV1 } from "../../../contracts/generated/governance/demand/target-host-effect-rearmed-event-data-v1.generated.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_REARMED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/target-host-effect-rearmed-event-data-v1.generated.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_REARM_SCHEMA } from "../../../contracts/generated/governance/delivery/target-host-effect-rearm.generated.js";
import type { WakeflowTargetResultRecordedEventDataV1 } from "../../../contracts/generated/governance/demand/target-result-recorded-event-data-v1.generated.js";
import { WAKEFLOW_TARGET_RESULT_RECORDED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/target-result-recorded-event-data-v1.generated.js";
import type { WakeflowControllerTargetReviewDecidedEventDataV1 } from "../../../contracts/generated/governance/demand/controller-target-review-decided-event-data-v1.generated.js";
import { WAKEFLOW_CONTROLLER_TARGET_REVIEW_DECIDED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/controller-target-review-decided-event-data-v1.generated.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_SCHEMA } from "../../../contracts/generated/governance/review/controller-implementation-review-decision.generated.js";
import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_SCHEMA } from "../../../contracts/generated/governance/review/controller-test-review-decision.generated.js";
import type { WakeflowControllerTargetReviewResumedEventDataV1 } from "../../../contracts/generated/governance/demand/controller-target-review-resumed-event-data-v1.generated.js";
import { WAKEFLOW_CONTROLLER_TARGET_REVIEW_RESUMED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/controller-target-review-resumed-event-data-v1.generated.js";
import { WAKEFLOW_CONTROLLER_TARGET_REVIEW_RESUME_SCHEMA } from "../../../contracts/generated/governance/review/controller-target-review-resume.generated.js";
import type { WakeflowProductDefectRemediationAuthorizedEventDataV1 } from "../../../contracts/generated/governance/demand/product-defect-remediation-authorized-event-data-v1.generated.js";
import { WAKEFLOW_PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/product-defect-remediation-authorized-event-data-v1.generated.js";
import { WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_AUTHORIZATION_SCHEMA } from "../../../contracts/generated/governance/review/controller-product-defect-remediation-authorization.generated.js";
import { WAKEFLOW_TARGET_RESULT_SCHEMA } from "../../../contracts/generated/governance/result/target-result.generated.js";
import { WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA } from "../../../contracts/generated/governance/result/implementation-target-result-report.generated.js";
import { WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA } from "../../../contracts/generated/governance/result/test-target-result-report.generated.js";
import { WAKEFLOW_GIT_OBJECT_ID_SCHEMA } from "../../../contracts/generated/foundation/git-object-id.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_TODO_ITEM_ID_SCHEMA } from "../../../contracts/generated/governance/todo/todo-item-id.generated.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA } from "../../../contracts/generated/workspace/window-host-binding.generated.js";
import {
  parseJsonValue,
  type JsonObject,
  type JsonValue,
} from "../../../foundation/data/json-value.js";
import {
  EventSourcingVersionEvolutionRegistry,
  EventSourcingVersionEvolutionError,
} from "../../../foundation/event-sourcing/event-sourcing-version-evolution.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import {
  parseDemandUncommittedEvent,
  type DemandUncommittedEvent,
} from "./demand-event-sourcing-event.js";
import type { DemandEventSourcingPersistedEventEnvelope } from "./demand-event-sourcing-persisted-event-envelope.js";

/** Demand 事件溯源各事件家族的持久化版本编解码器和当前版本写入器。 */

export const DEMAND_EVENT_SOURCING_EVENT_TYPES = Object.freeze([
  "delivery.target-delivery-prepared",
  "delivery.target-host-effect-claimed",
  "delivery.target-host-effect-observed",
  "delivery.target-host-effect-rearmed",
  "lifecycle.demand-cancelled",
  "lifecycle.demand-completed",
  "publication.demand-published",
  "result.target-result-recorded",
  "review.product-defect-remediation-authorized",
  "review.target-result-decided",
  "review.target-result-resumed",
  "tasking.target-task-planned",
  "testing.test-card-created",
  "testing.test-delivery-prepared",
] as const);

type DemandEventSourcingCurrentEventType =
  (typeof DEMAND_EVENT_SOURCING_EVENT_TYPES)[number];

export const DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS = Object.freeze({
  "delivery.target-delivery-prepared": 3,
  "delivery.target-host-effect-claimed": 1,
  "delivery.target-host-effect-observed": 1,
  "delivery.target-host-effect-rearmed": 1,
  "lifecycle.demand-cancelled": 1,
  "lifecycle.demand-completed": 1,
  "publication.demand-published": 1,
  "result.target-result-recorded": 1,
  "review.product-defect-remediation-authorized": 1,
  "review.target-result-decided": 1,
  "review.target-result-resumed": 1,
  "tasking.target-task-planned": 1,
  "testing.test-card-created": 2,
  "testing.test-delivery-prepared": 1,
} as const satisfies Readonly<
  Record<DemandEventSourcingCurrentEventType, number>
>);

interface EncodedCurrentDemandEventVersion {
  readonly eventType: DemandEventSourcingCurrentEventType;
  readonly eventVersion: number;
  readonly data: Readonly<JsonObject>;
}

const validatePublishedV1 =
  createRuntimeJsonSchemaValidator<WakeflowDemandPublishedEventDataV1>(
    WAKEFLOW_DEMAND_PUBLISHED_EVENT_DATA_V1_SCHEMA,
    [WAKEFLOW_SHA256_DIGEST_SCHEMA],
  );
const validateCancelledV1 =
  createRuntimeJsonSchemaValidator<WakeflowDemandCancelledEventDataV1>(
    WAKEFLOW_DEMAND_CANCELLED_EVENT_DATA_V1_SCHEMA,
  );
const validateCompletedV1 =
  createRuntimeJsonSchemaValidator<WakeflowDemandCompletedEventDataV1>(
    WAKEFLOW_DEMAND_COMPLETED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_DEMAND_COMPLETION_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_TODO_ITEM_ID_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
    ],
  );
const validateTargetTaskPlannedV1 =
  createRuntimeJsonSchemaValidator<WakeflowTargetTaskPlannedEventDataV1>(
    WAKEFLOW_TARGET_TASK_PLANNED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
    ],
  );
const validateTestCardCreatedV1 =
  createRuntimeJsonSchemaValidator<WakeflowTestCardCreatedEventDataV1>(
    WAKEFLOW_TEST_CARD_CREATED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_TEST_CARD_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
    ],
  );
const validateTestCardCreatedV2 =
  createRuntimeJsonSchemaValidator<WakeflowTestCardCreatedEventDataV2>(
    WAKEFLOW_TEST_CARD_CREATED_EVENT_DATA_V2_SCHEMA,
    [
      WAKEFLOW_TEST_CARD_SCHEMA,
      WAKEFLOW_TEST_CARD_GENERATION_SOURCE_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
    ],
  );
const validateTestDeliveryPreparedV1 =
  createRuntimeJsonSchemaValidator<WakeflowTestDeliveryPreparedEventDataV1>(
    WAKEFLOW_TEST_DELIVERY_PREPARED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_TEST_DELIVERY_INTENT_SCHEMA,
      WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
      WAKEFLOW_TEST_CARD_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
      WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
    ],
  );
const validateTargetDeliveryPreparedV1 =
  createRuntimeJsonSchemaValidator<WakeflowTargetDeliveryPreparedEventDataV1>(
    WAKEFLOW_TARGET_DELIVERY_PREPARED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
      WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
    ],
  );
const validateTargetDeliveryPreparedV2 =
  createRuntimeJsonSchemaValidator<WakeflowTargetDeliveryPreparedEventDataV2>(
    WAKEFLOW_TARGET_DELIVERY_PREPARED_EVENT_DATA_V2_SCHEMA,
    [
      WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
      WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
    ],
  );
const validateTargetDeliveryPreparedV3 =
  createRuntimeJsonSchemaValidator<WakeflowTargetDeliveryPreparedEventDataV3>(
    WAKEFLOW_TARGET_DELIVERY_PREPARED_EVENT_DATA_V3_SCHEMA,
    [
      WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
      WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
    ],
  );
const validateTargetHostEffectClaimedV1 =
  createRuntimeJsonSchemaValidator<WakeflowTargetHostEffectClaimedEventDataV1>(
    WAKEFLOW_TARGET_HOST_EFFECT_CLAIMED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_WINDOW_WORK_CLAIM_SCHEMA,
      WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
      WAKEFLOW_TEST_CARD_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
      WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
    ],
  );
const validateTargetHostEffectObservedV1 =
  createRuntimeJsonSchemaValidator<WakeflowTargetHostEffectObservedEventDataV1>(
    WAKEFLOW_TARGET_HOST_EFFECT_OBSERVED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_TARGET_DELIVERY_HOST_EFFECT_OBSERVATION_SCHEMA,
      WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
      WAKEFLOW_TEST_CARD_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
      WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
    ],
  );
const validateTargetHostEffectRearmedV1 =
  createRuntimeJsonSchemaValidator<WakeflowTargetHostEffectRearmedEventDataV1>(
    WAKEFLOW_TARGET_HOST_EFFECT_REARMED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_TARGET_HOST_EFFECT_REARM_SCHEMA,
      WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
      WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
    ],
  );
const validateTargetResultRecordedV1 =
  createRuntimeJsonSchemaValidator<WakeflowTargetResultRecordedEventDataV1>(
    WAKEFLOW_TARGET_RESULT_RECORDED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_TARGET_RESULT_SCHEMA,
      WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA,
      WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA,
      WAKEFLOW_GIT_OBJECT_ID_SCHEMA,
      WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
      WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
    ],
  );
const validateControllerTargetReviewDecidedV1 =
  createRuntimeJsonSchemaValidator<WakeflowControllerTargetReviewDecidedEventDataV1>(
    WAKEFLOW_CONTROLLER_TARGET_REVIEW_DECIDED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_SCHEMA,
      WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
    ],
  );
const validateControllerTargetReviewResumedV1 =
  createRuntimeJsonSchemaValidator<WakeflowControllerTargetReviewResumedEventDataV1>(
    WAKEFLOW_CONTROLLER_TARGET_REVIEW_RESUMED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_CONTROLLER_TARGET_REVIEW_RESUME_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
    ],
  );
const validateProductDefectRemediationAuthorizedV1 =
  createRuntimeJsonSchemaValidator<WakeflowProductDefectRemediationAuthorizedEventDataV1>(
    WAKEFLOW_PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_AUTHORIZATION_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
    ],
  );

function parsePublishedV1(value: Readonly<JsonValue>): Readonly<JsonValue> {
  const result = validatePublishedV1(value);
  if (!result.ok) throw new TypeError("Demand published v1 data is invalid.");
  return parseJsonValue(result.value, "$data");
}

function parseCancelledV1(value: Readonly<JsonValue>): Readonly<JsonValue> {
  const result = validateCancelledV1(value);
  if (!result.ok) throw new TypeError("Demand cancelled v1 data is invalid.");
  return parseJsonValue(result.value, "$data");
}

function parseCompletedV1(value: Readonly<JsonValue>): Readonly<JsonValue> {
  const result = validateCompletedV1(value);
  if (!result.ok) throw new TypeError("Demand completed v1 data is invalid.");
  return parseJsonValue(result.value, "$data");
}

function parseTargetTaskPlannedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateTargetTaskPlannedV1(value);
  if (!result.ok)
    throw new TypeError("Target task planned v1 data is invalid.");
  return parseJsonValue(result.value, "$data");
}

function parseTestCardCreatedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateTestCardCreatedV1(value);
  if (!result.ok) throw new TypeError("TestCard created v1 data is invalid.");
  return parseJsonValue(result.value, "$data");
}

function parseTestCardCreatedV2(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateTestCardCreatedV2(value);
  if (!result.ok) throw new TypeError("TestCard created v2 data is invalid.");
  return parseJsonValue(result.value, "$data");
}

/** v1只支持首份Card；升版显式补充initial代际原因。 */
function upcastTestCardCreatedV1ToV2(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("TestCard created v1 data is invalid.");
  }
  return parseJsonValue(
    {
      ...value,
      generationSource: { kind: "initial" },
    },
    "$data",
  );
}

function parseTestDeliveryPreparedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateTestDeliveryPreparedV1(value);
  if (!result.ok)
    throw new TypeError("Test delivery prepared v1 data is invalid.");
  return parseJsonValue(result.value, "$data");
}

function parseTargetDeliveryPreparedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateTargetDeliveryPreparedV1(value);
  if (!result.ok) {
    throw new TypeError("Target delivery prepared v1 data is invalid.");
  }
  return parseJsonValue(result.value, "$data");
}

function parseTargetDeliveryPreparedV2(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateTargetDeliveryPreparedV2(value);
  if (!result.ok) {
    throw new TypeError("Target delivery prepared v2 data is invalid.");
  }
  return parseJsonValue(result.value, "$data");
}

function parseTargetDeliveryPreparedV3(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateTargetDeliveryPreparedV3(value);
  if (!result.ok) {
    throw new TypeError("Target delivery prepared v3 data is invalid.");
  }
  return parseJsonValue(result.value, "$data");
}

/** v1初次投递数据已经是当前内存形状；升版只开放受约束的rework变体。 */
function upcastTargetDeliveryPreparedV1ToV2(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  return value;
}

/** v2 Intent也是v3当前形状；v3只开放新的产品缺陷remediation变体。 */
function upcastTargetDeliveryPreparedV2ToV3(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  return value;
}

function parseTargetHostEffectClaimedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateTargetHostEffectClaimedV1(value);
  if (!result.ok) {
    throw new TypeError("Target host effect claimed v1 data is invalid.");
  }
  return parseJsonValue(result.value, "$data");
}

function parseTargetHostEffectObservedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateTargetHostEffectObservedV1(value);
  if (!result.ok) {
    throw new TypeError("Target host effect observed v1 data is invalid.");
  }
  return parseJsonValue(result.value, "$data");
}

function parseTargetHostEffectRearmedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateTargetHostEffectRearmedV1(value);
  if (!result.ok) {
    throw new TypeError("Target host effect rearmed v1 data is invalid.");
  }
  return parseJsonValue(result.value, "$data");
}

function parseTargetResultRecordedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateTargetResultRecordedV1(value);
  if (!result.ok) {
    throw new TypeError("Target result recorded v1 data is invalid.");
  }
  return parseJsonValue(result.value, "$data");
}

function parseControllerTargetReviewDecidedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateControllerTargetReviewDecidedV1(value);
  if (!result.ok) {
    throw new TypeError("Controller target review decided v1 data is invalid.");
  }
  return parseJsonValue(result.value, "$data");
}

function parseControllerTargetReviewResumedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateControllerTargetReviewResumedV1(value);
  if (!result.ok) {
    throw new TypeError("Controller target review resumed v1 data is invalid.");
  }
  return parseJsonValue(result.value, "$data");
}

function parseProductDefectRemediationAuthorizedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateProductDefectRemediationAuthorizedV1(value);
  if (!result.ok) {
    throw new TypeError(
      "Product defect remediation authorized v1 data is invalid.",
    );
  }
  return parseJsonValue(result.value, "$data");
}

const PUBLISHED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion:
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
      "publication.demand-published"
    ],
  codecs: [{ version: 1, parse: parsePublishedV1 }],
  steps: [],
});

const CANCELLED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion:
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS["lifecycle.demand-cancelled"],
  codecs: [{ version: 1, parse: parseCancelledV1 }],
  steps: [],
});

const COMPLETED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion:
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS["lifecycle.demand-completed"],
  codecs: [{ version: 1, parse: parseCompletedV1 }],
  steps: [],
});

const TARGET_TASK_PLANNED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion:
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS["tasking.target-task-planned"],
  codecs: [{ version: 1, parse: parseTargetTaskPlannedV1 }],
  steps: [],
});

const TEST_CARD_CREATED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion:
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS["testing.test-card-created"],
  codecs: [
    { version: 1, parse: parseTestCardCreatedV1 },
    { version: 2, parse: parseTestCardCreatedV2 },
  ],
  steps: [
    {
      fromVersion: 1,
      toVersion: 2,
      upcast: upcastTestCardCreatedV1ToV2,
    },
  ],
});

const TEST_DELIVERY_PREPARED_REGISTRY =
  new EventSourcingVersionEvolutionRegistry({
    currentVersion:
      DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
        "testing.test-delivery-prepared"
      ],
    codecs: [{ version: 1, parse: parseTestDeliveryPreparedV1 }],
    steps: [],
  });

const TARGET_DELIVERY_PREPARED_REGISTRY =
  new EventSourcingVersionEvolutionRegistry({
    currentVersion:
      DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
        "delivery.target-delivery-prepared"
      ],
    codecs: [
      { version: 1, parse: parseTargetDeliveryPreparedV1 },
      { version: 2, parse: parseTargetDeliveryPreparedV2 },
      { version: 3, parse: parseTargetDeliveryPreparedV3 },
    ],
    steps: [
      {
        fromVersion: 1,
        toVersion: 2,
        upcast: upcastTargetDeliveryPreparedV1ToV2,
      },
      {
        fromVersion: 2,
        toVersion: 3,
        upcast: upcastTargetDeliveryPreparedV2ToV3,
      },
    ],
  });
const TARGET_HOST_EFFECT_CLAIMED_REGISTRY =
  new EventSourcingVersionEvolutionRegistry({
    currentVersion:
      DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
        "delivery.target-host-effect-claimed"
      ],
    codecs: [{ version: 1, parse: parseTargetHostEffectClaimedV1 }],
    steps: [],
  });
const TARGET_HOST_EFFECT_OBSERVED_REGISTRY =
  new EventSourcingVersionEvolutionRegistry({
    currentVersion:
      DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
        "delivery.target-host-effect-observed"
      ],
    codecs: [{ version: 1, parse: parseTargetHostEffectObservedV1 }],
    steps: [],
  });
const TARGET_HOST_EFFECT_REARMED_REGISTRY =
  new EventSourcingVersionEvolutionRegistry({
    currentVersion:
      DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
        "delivery.target-host-effect-rearmed"
      ],
    codecs: [{ version: 1, parse: parseTargetHostEffectRearmedV1 }],
    steps: [],
  });
const TARGET_RESULT_RECORDED_REGISTRY =
  new EventSourcingVersionEvolutionRegistry({
    currentVersion:
      DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
        "result.target-result-recorded"
      ],
    codecs: [{ version: 1, parse: parseTargetResultRecordedV1 }],
    steps: [],
  });
const CONTROLLER_TARGET_REVIEW_DECIDED_REGISTRY =
  new EventSourcingVersionEvolutionRegistry({
    currentVersion:
      DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
        "review.target-result-decided"
      ],
    codecs: [{ version: 1, parse: parseControllerTargetReviewDecidedV1 }],
    steps: [],
  });
const CONTROLLER_TARGET_REVIEW_RESUMED_REGISTRY =
  new EventSourcingVersionEvolutionRegistry({
    currentVersion:
      DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
        "review.target-result-resumed"
      ],
    codecs: [{ version: 1, parse: parseControllerTargetReviewResumedV1 }],
    steps: [],
  });
const PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_REGISTRY =
  new EventSourcingVersionEvolutionRegistry({
    currentVersion:
      DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
        "review.product-defect-remediation-authorized"
      ],
    codecs: [
      {
        version: 1,
        parse: parseProductDefectRemediationAuthorizedV1,
      },
    ],
    steps: [],
  });

const EVENT_VERSION_REGISTRIES = Object.freeze({
  "delivery.target-delivery-prepared": TARGET_DELIVERY_PREPARED_REGISTRY,
  "delivery.target-host-effect-claimed": TARGET_HOST_EFFECT_CLAIMED_REGISTRY,
  "delivery.target-host-effect-observed": TARGET_HOST_EFFECT_OBSERVED_REGISTRY,
  "delivery.target-host-effect-rearmed": TARGET_HOST_EFFECT_REARMED_REGISTRY,
  "lifecycle.demand-cancelled": CANCELLED_REGISTRY,
  "lifecycle.demand-completed": COMPLETED_REGISTRY,
  "publication.demand-published": PUBLISHED_REGISTRY,
  "result.target-result-recorded": TARGET_RESULT_RECORDED_REGISTRY,
  "review.product-defect-remediation-authorized":
    PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_REGISTRY,
  "review.target-result-decided": CONTROLLER_TARGET_REVIEW_DECIDED_REGISTRY,
  "review.target-result-resumed": CONTROLLER_TARGET_REVIEW_RESUMED_REGISTRY,
  "tasking.target-task-planned": TARGET_TASK_PLANNED_REGISTRY,
  "testing.test-card-created": TEST_CARD_CREATED_REGISTRY,
  "testing.test-delivery-prepared": TEST_DELIVERY_PREPARED_REGISTRY,
} as const satisfies Readonly<
  Record<
    DemandEventSourcingCurrentEventType,
    EventSourcingVersionEvolutionRegistry
  >
>);

export const DEMAND_EVENT_SOURCING_SUPPORTED_EVENT_VERSIONS = Object.freeze({
  "delivery.target-delivery-prepared":
    TARGET_DELIVERY_PREPARED_REGISTRY.supportedVersions,
  "delivery.target-host-effect-claimed":
    TARGET_HOST_EFFECT_CLAIMED_REGISTRY.supportedVersions,
  "delivery.target-host-effect-observed":
    TARGET_HOST_EFFECT_OBSERVED_REGISTRY.supportedVersions,
  "delivery.target-host-effect-rearmed":
    TARGET_HOST_EFFECT_REARMED_REGISTRY.supportedVersions,
  "lifecycle.demand-cancelled": CANCELLED_REGISTRY.supportedVersions,
  "lifecycle.demand-completed": COMPLETED_REGISTRY.supportedVersions,
  "publication.demand-published": PUBLISHED_REGISTRY.supportedVersions,
  "result.target-result-recorded":
    TARGET_RESULT_RECORDED_REGISTRY.supportedVersions,
  "review.product-defect-remediation-authorized":
    PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_REGISTRY.supportedVersions,
  "review.target-result-decided":
    CONTROLLER_TARGET_REVIEW_DECIDED_REGISTRY.supportedVersions,
  "review.target-result-resumed":
    CONTROLLER_TARGET_REVIEW_RESUMED_REGISTRY.supportedVersions,
  "tasking.target-task-planned": TARGET_TASK_PLANNED_REGISTRY.supportedVersions,
  "testing.test-card-created": TEST_CARD_CREATED_REGISTRY.supportedVersions,
  "testing.test-delivery-prepared":
    TEST_DELIVERY_PREPARED_REGISTRY.supportedVersions,
} as const satisfies Readonly<
  Record<DemandEventSourcingCurrentEventType, readonly number[]>
>);

function isDemandEventSourcingCurrentEventType(
  value: unknown,
): value is DemandEventSourcingCurrentEventType {
  return (
    typeof value === "string" &&
    Object.hasOwn(DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS, value)
  );
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseEventDataObject(
  value: unknown,
  path: string,
): Readonly<JsonObject> {
  const parsed = parseJsonValue(value, path);
  if (!isJsonObject(parsed)) {
    throw new TypeError("Demand event data must be a JSON object.");
  }
  return parsed;
}

/** 把持久化事件封装中的数据演进并投影为归约器接受的当前事件。 */
export function decodeDemandEventSourcingPersistedEvent(
  envelope: Readonly<DemandEventSourcingPersistedEventEnvelope>,
): Readonly<DemandUncommittedEvent> {
  if (!isDemandEventSourcingCurrentEventType(envelope.eventType)) {
    throw new EventSourcingVersionEvolutionError(
      "unsupported-version",
      "$/eventType",
    );
  }
  const registry = EVENT_VERSION_REGISTRIES[envelope.eventType];
  const evolved = registry.evolve(envelope.eventVersion, envelope.data);
  return parseDemandUncommittedEvent({
    eventId: envelope.eventId,
    demandId: envelope.demandId,
    recordedAt: envelope.recordedAt,
    eventType: envelope.eventType,
    data: evolved.data,
  });
}

/** 当前版本写入器永远只编码事件家族登记的最新持久化版本。 */
export function encodeCurrentDemandEventVersion(
  value: unknown,
): Readonly<EncodedCurrentDemandEventVersion> {
  const event = parseDemandUncommittedEvent(value);
  const registry = EVENT_VERSION_REGISTRIES[event.eventType];
  const encoded = registry.evolve(
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[event.eventType],
    event.data,
  );
  return Object.freeze({
    eventType: event.eventType,
    eventVersion: DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[event.eventType],
    data: parseEventDataObject(encoded.data, "$data"),
  });
}
