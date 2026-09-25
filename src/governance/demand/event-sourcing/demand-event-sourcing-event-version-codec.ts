import type { WakeflowDemandCancelledEventDataV1 } from "../../../contracts/generated/governance/demand/demand-cancelled-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_CANCELLED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/demand-cancelled-event-data-v1.generated.js";
import type { WakeflowDemandCompletedEventDataV1 } from "../../../contracts/generated/governance/demand/demand-completed-event-data-v1.generated.js";
import type { WakeflowDecisionRecordedEventDataV1 } from "../../../contracts/generated/governance/demand/decision-recorded-event-data-v1.generated.js";
import { WAKEFLOW_DECISION_RECORDED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/decision-recorded-event-data-v1.generated.js";
import type { WakeflowDemandContinuedEventDataV1 } from "../../../contracts/generated/governance/demand/demand-continued-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_CONTINUED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/demand-continued-event-data-v1.generated.js";
import type { WakeflowDemandEscalatedEventDataV1 } from "../../../contracts/generated/governance/demand/demand-escalated-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_ESCALATED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/demand-escalated-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_COMPLETED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/demand-completed-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_COMPLETION_SCHEMA } from "../../../contracts/generated/governance/lifecycle/demand-completion.generated.js";
import type { WakeflowDemandPublishedEventDataV1 } from "../../../contracts/generated/governance/demand/demand-published-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_PUBLISHED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/demand-published-event-data-v1.generated.js";
import type { WakeflowManagedEvidenceRecordedEventDataV1 } from "../../../contracts/generated/governance/demand/managed-evidence-recorded-event-data-v1.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_RECORDED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/managed-evidence-recorded-event-data-v1.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_MANIFEST_SCHEMA } from "../../../contracts/generated/governance/evidence/managed-evidence-manifest.generated.js";
import type { WakeflowTargetTaskPlannedEventDataV1 } from "../../../contracts/generated/governance/demand/target-task-planned-event-data-v1.generated.js";
import { WAKEFLOW_TARGET_TASK_PLANNED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/target-task-planned-event-data-v1.generated.js";
import { WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA } from "../../../contracts/generated/governance/testing/test-execution-attempt.generated.js";
import type { WakeflowTargetResultRecordedEventDataV1 } from "../../../contracts/generated/governance/demand/target-result-recorded-event-data-v1.generated.js";
import { WAKEFLOW_TARGET_RESULT_RECORDED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/target-result-recorded-event-data-v1.generated.js";
import type { WakeflowControllerTargetReviewDecidedEventDataV1 } from "../../../contracts/generated/governance/demand/controller-target-review-decided-event-data-v1.generated.js";
import { WAKEFLOW_CONTROLLER_TARGET_REVIEW_DECIDED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/controller-target-review-decided-event-data-v1.generated.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_SCHEMA } from "../../../contracts/generated/governance/review/controller-implementation-review-decision.generated.js";
import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_SCHEMA } from "../../../contracts/generated/governance/review/controller-test-review-decision.generated.js";
import type { WakeflowCallbackReissuedEventDataV1 } from "../../../contracts/generated/governance/demand/callback-reissued-event-data-v1.generated.js";
import { WAKEFLOW_CALLBACK_REISSUED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/callback-reissued-event-data-v1.generated.js";
import type { WakeflowProductDefectRemediationAuthorizedEventDataV1 } from "../../../contracts/generated/governance/demand/product-defect-remediation-authorized-event-data-v1.generated.js";
import { WAKEFLOW_PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/product-defect-remediation-authorized-event-data-v1.generated.js";
import { WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_AUTHORIZATION_SCHEMA } from "../../../contracts/generated/governance/review/controller-product-defect-remediation-authorization.generated.js";
import { WAKEFLOW_TARGET_RESULT_SCHEMA } from "../../../contracts/generated/governance/result/target-result.generated.js";
import { WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA } from "../../../contracts/generated/governance/result/implementation-target-result-report.generated.js";
import { WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA } from "../../../contracts/generated/governance/result/test-target-result-report.generated.js";
import type { WakeflowDeliveryPreparedEventDataV1 } from "../../../contracts/generated/governance/demand/delivery-prepared-event-data-v1.generated.js";
import { WAKEFLOW_DELIVERY_PREPARED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/delivery-prepared-event-data-v1.generated.js";
import type { WakeflowDeliveryOutcomeRecordedEventDataV1 } from "../../../contracts/generated/governance/demand/delivery-outcome-recorded-event-data-v1.generated.js";
import { WAKEFLOW_DELIVERY_OUTCOME_RECORDED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/delivery-outcome-recorded-event-data-v1.generated.js";
import type { WakeflowDeliveryRearmedEventDataV1 } from "../../../contracts/generated/governance/demand/delivery-rearmed-event-data-v1.generated.js";
import { WAKEFLOW_DELIVERY_REARMED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/delivery-rearmed-event-data-v1.generated.js";
import { WAKEFLOW_DELIVERY_ENVELOPE_SCHEMA } from "../../../contracts/generated/governance/delivery/delivery-envelope.generated.js";
import { WAKEFLOW_DELIVERY_OUTCOME_SCHEMA } from "../../../contracts/generated/governance/delivery/delivery-outcome.generated.js";
import { WAKEFLOW_DELIVERY_REARM_SCHEMA } from "../../../contracts/generated/governance/delivery/delivery-rearm.generated.js";
import { WAKEFLOW_GIT_OBJECT_ID_SCHEMA } from "../../../contracts/generated/foundation/git-object-id.generated.js";
import { WAKEFLOW_LOADED_ARTIFACT_TREE_MANIFEST_SCHEMA } from "../../../contracts/generated/foundation/loaded-artifact-tree-manifest.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
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
  "delivery.delivery-outcome-recorded",
  "delivery.delivery-prepared",
  "delivery.delivery-rearmed",
  "evidence.managed-evidence-recorded",
  "lifecycle.decision-recorded",
  "lifecycle.demand-cancelled",
  "lifecycle.demand-completed",
  "lifecycle.demand-continued",
  "lifecycle.demand-escalated",
  "publication.demand-published",
  "result.callback-reissued",
  "result.target-result-recorded",
  "review.product-defect-remediation-authorized",
  "review.target-result-decided",
  "tasking.target-task-planned",
] as const satisfies readonly DemandEventSourcingCurrentEventType[]);

/**
 * 当前事件类型就是归约器事件联合的类型标签：版本表与注册表以它为编译期穷尽性来源；
 * 类型数组只保证是其子集，缺项由 state-version 快照测试发现。
 */
type DemandEventSourcingCurrentEventType = DemandUncommittedEvent["eventType"];

export const DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS = Object.freeze({
  "delivery.delivery-outcome-recorded": 1,
  "delivery.delivery-prepared": 1,
  "delivery.delivery-rearmed": 1,
  "evidence.managed-evidence-recorded": 1,
  "lifecycle.decision-recorded": 1,
  "lifecycle.demand-cancelled": 1,
  "lifecycle.demand-completed": 1,
  "lifecycle.demand-continued": 1,
  "lifecycle.demand-escalated": 1,
  "publication.demand-published": 1,
  "result.callback-reissued": 1,
  "result.target-result-recorded": 1,
  "review.product-defect-remediation-authorized": 1,
  "review.target-result-decided": 1,
  "tasking.target-task-planned": 1,
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
const validateManagedEvidenceRecordedV1 =
  createRuntimeJsonSchemaValidator<WakeflowManagedEvidenceRecordedEventDataV1>(
    WAKEFLOW_MANAGED_EVIDENCE_RECORDED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_MANAGED_EVIDENCE_MANIFEST_SCHEMA,
      WAKEFLOW_LOADED_ARTIFACT_TREE_MANIFEST_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
    ],
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
      WAKEFLOW_UTC_INSTANT_SCHEMA,
    ],
  );
const LIFECYCLE_REFERENCES = [
  WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
  WAKEFLOW_SHA256_DIGEST_SCHEMA,
  WAKEFLOW_UTC_INSTANT_SCHEMA,
];
const validateEscalatedV1 =
  createRuntimeJsonSchemaValidator<WakeflowDemandEscalatedEventDataV1>(
    WAKEFLOW_DEMAND_ESCALATED_EVENT_DATA_V1_SCHEMA,
    LIFECYCLE_REFERENCES,
  );
const validateDecisionRecordedV1 =
  createRuntimeJsonSchemaValidator<WakeflowDecisionRecordedEventDataV1>(
    WAKEFLOW_DECISION_RECORDED_EVENT_DATA_V1_SCHEMA,
    LIFECYCLE_REFERENCES,
  );
const validateContinuedV1 =
  createRuntimeJsonSchemaValidator<WakeflowDemandContinuedEventDataV1>(
    WAKEFLOW_DEMAND_CONTINUED_EVENT_DATA_V1_SCHEMA,
    LIFECYCLE_REFERENCES,
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
const validateDeliveryPreparedV1 =
  createRuntimeJsonSchemaValidator<WakeflowDeliveryPreparedEventDataV1>(
    WAKEFLOW_DELIVERY_PREPARED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_DELIVERY_ENVELOPE_SCHEMA,
      WAKEFLOW_DELIVERY_OUTCOME_SCHEMA,
      WAKEFLOW_DELIVERY_REARM_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
      WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
    ],
  );
const validateDeliveryOutcomeRecordedV1 =
  createRuntimeJsonSchemaValidator<WakeflowDeliveryOutcomeRecordedEventDataV1>(
    WAKEFLOW_DELIVERY_OUTCOME_RECORDED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_DELIVERY_ENVELOPE_SCHEMA,
      WAKEFLOW_DELIVERY_OUTCOME_SCHEMA,
      WAKEFLOW_DELIVERY_REARM_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
      WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
      WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
    ],
  );
const validateDeliveryRearmedV1 =
  createRuntimeJsonSchemaValidator<WakeflowDeliveryRearmedEventDataV1>(
    WAKEFLOW_DELIVERY_REARMED_EVENT_DATA_V1_SCHEMA,
    [
      WAKEFLOW_DELIVERY_ENVELOPE_SCHEMA,
      WAKEFLOW_DELIVERY_OUTCOME_SCHEMA,
      WAKEFLOW_DELIVERY_REARM_SCHEMA,
      WAKEFLOW_TASK_PACKAGE_SCHEMA,
      WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
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
const validateCallbackReissuedV1 =
  createRuntimeJsonSchemaValidator<WakeflowCallbackReissuedEventDataV1>(
    WAKEFLOW_CALLBACK_REISSUED_EVENT_DATA_V1_SCHEMA,
    [WAKEFLOW_SHA256_DIGEST_SCHEMA, WAKEFLOW_UTC_INSTANT_SCHEMA],
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

function parseManagedEvidenceRecordedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateManagedEvidenceRecordedV1(value);
  if (!result.ok) {
    throw new TypeError("Managed evidence recorded v1 data is invalid.");
  }
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

function parseEscalatedV1(value: Readonly<JsonValue>): Readonly<JsonValue> {
  const result = validateEscalatedV1(value);
  if (!result.ok) throw new TypeError("Demand escalated v1 data is invalid.");
  return parseJsonValue(result.value, "$data");
}

function parseDecisionRecordedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateDecisionRecordedV1(value);
  if (!result.ok) throw new TypeError("Decision recorded v1 data is invalid.");
  return parseJsonValue(result.value, "$data");
}

function parseContinuedV1(value: Readonly<JsonValue>): Readonly<JsonValue> {
  const result = validateContinuedV1(value);
  if (!result.ok) throw new TypeError("Demand continued v1 data is invalid.");
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

function parseDeliveryPreparedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateDeliveryPreparedV1(value);
  if (!result.ok) throw new TypeError("Delivery prepared v1 data is invalid.");
  return parseJsonValue(result.value, "$data");
}

function parseDeliveryOutcomeRecordedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateDeliveryOutcomeRecordedV1(value);
  if (!result.ok) {
    throw new TypeError("Delivery outcome recorded v1 data is invalid.");
  }
  return parseJsonValue(result.value, "$data");
}

function parseDeliveryRearmedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateDeliveryRearmedV1(value);
  if (!result.ok) throw new TypeError("Delivery rearmed v1 data is invalid.");
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

function parseCallbackReissuedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateCallbackReissuedV1(value);
  if (!result.ok) {
    throw new TypeError("Callback reissued v1 data is invalid.");
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

const MANAGED_EVIDENCE_RECORDED_REGISTRY =
  new EventSourcingVersionEvolutionRegistry({
    currentVersion:
      DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
        "evidence.managed-evidence-recorded"
      ],
    codecs: [{ version: 1, parse: parseManagedEvidenceRecordedV1 }],
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

const ESCALATED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion:
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS["lifecycle.demand-escalated"],
  codecs: [{ version: 1, parse: parseEscalatedV1 }],
  steps: [],
});

const DECISION_RECORDED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion:
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS["lifecycle.decision-recorded"],
  codecs: [{ version: 1, parse: parseDecisionRecordedV1 }],
  steps: [],
});

const CONTINUED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion:
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS["lifecycle.demand-continued"],
  codecs: [{ version: 1, parse: parseContinuedV1 }],
  steps: [],
});

const TARGET_TASK_PLANNED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion:
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS["tasking.target-task-planned"],
  codecs: [{ version: 1, parse: parseTargetTaskPlannedV1 }],
  steps: [],
});

const DELIVERY_PREPARED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion:
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS["delivery.delivery-prepared"],
  codecs: [{ version: 1, parse: parseDeliveryPreparedV1 }],
  steps: [],
});
const DELIVERY_OUTCOME_RECORDED_REGISTRY =
  new EventSourcingVersionEvolutionRegistry({
    currentVersion:
      DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
        "delivery.delivery-outcome-recorded"
      ],
    codecs: [{ version: 1, parse: parseDeliveryOutcomeRecordedV1 }],
    steps: [],
  });
const DELIVERY_REARMED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion:
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS["delivery.delivery-rearmed"],
  codecs: [{ version: 1, parse: parseDeliveryRearmedV1 }],
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
const CALLBACK_REISSUED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion:
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS["result.callback-reissued"],
  codecs: [{ version: 1, parse: parseCallbackReissuedV1 }],
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
  "delivery.delivery-outcome-recorded": DELIVERY_OUTCOME_RECORDED_REGISTRY,
  "delivery.delivery-prepared": DELIVERY_PREPARED_REGISTRY,
  "delivery.delivery-rearmed": DELIVERY_REARMED_REGISTRY,
  "evidence.managed-evidence-recorded": MANAGED_EVIDENCE_RECORDED_REGISTRY,
  "lifecycle.decision-recorded": DECISION_RECORDED_REGISTRY,
  "lifecycle.demand-cancelled": CANCELLED_REGISTRY,
  "lifecycle.demand-completed": COMPLETED_REGISTRY,
  "lifecycle.demand-continued": CONTINUED_REGISTRY,
  "lifecycle.demand-escalated": ESCALATED_REGISTRY,
  "publication.demand-published": PUBLISHED_REGISTRY,
  "result.callback-reissued": CALLBACK_REISSUED_REGISTRY,
  "result.target-result-recorded": TARGET_RESULT_RECORDED_REGISTRY,
  "review.product-defect-remediation-authorized":
    PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_REGISTRY,
  "review.target-result-decided": CONTROLLER_TARGET_REVIEW_DECIDED_REGISTRY,
  "tasking.target-task-planned": TARGET_TASK_PLANNED_REGISTRY,
} as const satisfies Readonly<
  Record<
    DemandEventSourcingCurrentEventType,
    EventSourcingVersionEvolutionRegistry
  >
>);

export const DEMAND_EVENT_SOURCING_SUPPORTED_EVENT_VERSIONS = Object.freeze({
  "delivery.delivery-outcome-recorded":
    DELIVERY_OUTCOME_RECORDED_REGISTRY.supportedVersions,
  "delivery.delivery-prepared": DELIVERY_PREPARED_REGISTRY.supportedVersions,
  "delivery.delivery-rearmed": DELIVERY_REARMED_REGISTRY.supportedVersions,
  "evidence.managed-evidence-recorded":
    MANAGED_EVIDENCE_RECORDED_REGISTRY.supportedVersions,
  "lifecycle.decision-recorded": DECISION_RECORDED_REGISTRY.supportedVersions,
  "lifecycle.demand-cancelled": CANCELLED_REGISTRY.supportedVersions,
  "lifecycle.demand-completed": COMPLETED_REGISTRY.supportedVersions,
  "lifecycle.demand-continued": CONTINUED_REGISTRY.supportedVersions,
  "lifecycle.demand-escalated": ESCALATED_REGISTRY.supportedVersions,
  "publication.demand-published": PUBLISHED_REGISTRY.supportedVersions,
  "result.callback-reissued": CALLBACK_REISSUED_REGISTRY.supportedVersions,
  "result.target-result-recorded":
    TARGET_RESULT_RECORDED_REGISTRY.supportedVersions,
  "review.product-defect-remediation-authorized":
    PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_REGISTRY.supportedVersions,
  "review.target-result-decided":
    CONTROLLER_TARGET_REVIEW_DECIDED_REGISTRY.supportedVersions,
  "tasking.target-task-planned": TARGET_TASK_PLANNED_REGISTRY.supportedVersions,
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
