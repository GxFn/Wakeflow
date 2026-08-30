import type {
  WakeflowDemandCancelledEventDataV1,
} from "../../../contracts/generated/governance/demand/demand-cancelled-event-data-v1.generated.js";
import {
  WAKEFLOW_DEMAND_CANCELLED_EVENT_DATA_V1_SCHEMA,
} from "../../../contracts/generated/governance/demand/demand-cancelled-event-data-v1.generated.js";
import type {
  WakeflowDemandPublishedEventDataV1,
} from "../../../contracts/generated/governance/demand/demand-published-event-data-v1.generated.js";
import {
  WAKEFLOW_DEMAND_PUBLISHED_EVENT_DATA_V1_SCHEMA,
} from "../../../contracts/generated/governance/demand/demand-published-event-data-v1.generated.js";
import type {
  WakeflowTargetTaskPlannedEventDataV1,
} from "../../../contracts/generated/governance/demand/target-task-planned-event-data-v1.generated.js";
import {
  WAKEFLOW_TARGET_TASK_PLANNED_EVENT_DATA_V1_SCHEMA,
} from "../../../contracts/generated/governance/demand/target-task-planned-event-data-v1.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
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
import type {
  DemandEventSourcingPersistedEventEnvelope,
} from "./demand-event-sourcing-persisted-event-envelope.js";

/** Demand 事件溯源各事件家族的持久化版本编解码器和当前版本写入器。 */

export const DEMAND_EVENT_SOURCING_EVENT_TYPES = Object.freeze([
  "lifecycle.demand-cancelled",
  "publication.demand-published",
  "tasking.target-task-planned",
] as const);

type DemandEventSourcingCurrentEventType =
  (typeof DEMAND_EVENT_SOURCING_EVENT_TYPES)[number];

export const DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS = Object.freeze({
  "lifecycle.demand-cancelled": 1,
  "publication.demand-published": 1,
  "tasking.target-task-planned": 1,
} as const satisfies Readonly<Record<
  DemandEventSourcingCurrentEventType,
  number
>>);

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

function parseTargetTaskPlannedV1(
  value: Readonly<JsonValue>,
): Readonly<JsonValue> {
  const result = validateTargetTaskPlannedV1(value);
  if (!result.ok) throw new TypeError("Target task planned v1 data is invalid.");
  return parseJsonValue(result.value, "$data");
}

const PUBLISHED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion: DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
    "publication.demand-published"
  ],
  codecs: [{ version: 1, parse: parsePublishedV1 }],
  steps: [],
});

const CANCELLED_REGISTRY = new EventSourcingVersionEvolutionRegistry({
  currentVersion: DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
    "lifecycle.demand-cancelled"
  ],
  codecs: [{ version: 1, parse: parseCancelledV1 }],
  steps: [],
});

const TARGET_TASK_PLANNED_REGISTRY =
  new EventSourcingVersionEvolutionRegistry({
    currentVersion: DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
      "tasking.target-task-planned"
    ],
    codecs: [{ version: 1, parse: parseTargetTaskPlannedV1 }],
    steps: [],
  });

const EVENT_VERSION_REGISTRIES = Object.freeze({
  "lifecycle.demand-cancelled": CANCELLED_REGISTRY,
  "publication.demand-published": PUBLISHED_REGISTRY,
  "tasking.target-task-planned": TARGET_TASK_PLANNED_REGISTRY,
} as const satisfies Readonly<Record<
  DemandEventSourcingCurrentEventType,
  EventSourcingVersionEvolutionRegistry
>>);

export const DEMAND_EVENT_SOURCING_SUPPORTED_EVENT_VERSIONS = Object.freeze({
  "lifecycle.demand-cancelled": CANCELLED_REGISTRY.supportedVersions,
  "publication.demand-published": PUBLISHED_REGISTRY.supportedVersions,
  "tasking.target-task-planned":
    TARGET_TASK_PLANNED_REGISTRY.supportedVersions,
} as const satisfies Readonly<Record<
  DemandEventSourcingCurrentEventType,
  readonly number[]
>>);

function isDemandEventSourcingCurrentEventType(
  value: unknown,
): value is DemandEventSourcingCurrentEventType {
  return typeof value === "string"
    && Object.hasOwn(DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS, value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value);
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
