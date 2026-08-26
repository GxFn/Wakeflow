import type {
  WakeflowDemandEventSourcingStoredEvent as StoredEventWire,
} from "../../../contracts/generated/governance/demand/demand-event-sourcing-stored-event.generated.js";
import {
  WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA,
} from "../../../contracts/generated/governance/demand/demand-event-sourcing-stored-event.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../../foundation/data/json-value.js";
import type { WakeflowDurableId } from "../../../foundation/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import type { UtcInstant } from "../../../foundation/time/utc-instant.js";
import {
  computeDemandAggregateStateDigest,
  parseDemandAggregateState,
  DemandAggregateStateError,
  type DemandAggregateState,
} from "../model/demand-aggregate-state.js";
import {
  parseDemandUncommittedEvent,
  DemandEventSourcingEventError,
  type DemandUncommittedEvent,
} from "./demand-event-sourcing-event.js";
import {
  parseDemandEventStreamRevision,
  type DemandEventStreamRevision,
} from "./demand-event-stream-position.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：Event Store 内的持久化事件 envelope。
 *
 * 本记录只由 append-commit preparation 创建。Domain Decider 不能直接提供 revision
 * 或 resultingStateDigest；读取时 reducer 必须重新 evolve 并核对该 digest。
 */

export const DEMAND_EVENT_SOURCING_STORED_EVENT_ARTIFACT_KIND =
  "wakeflow-demand-event-sourcing-event" as const;
export const DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA_VERSION = 1 as const;

interface StoredEventBase {
  readonly artifactKind:
    typeof DEMAND_EVENT_SOURCING_STORED_EVENT_ARTIFACT_KIND;
  readonly schemaVersion:
    typeof DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA_VERSION;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly streamRevision: DemandEventStreamRevision;
  readonly recordedAt: UtcInstant;
  readonly eventVersion: 1;
  readonly resultingStateDigest: Sha256Digest;
}

export interface DemandPublishedStoredEvent extends StoredEventBase {
  readonly eventType: "publication.demand-published";
  readonly data: Readonly<{
    readonly identityRef: "identity.json";
    readonly identityDigest: Sha256Digest;
    readonly authorityRef: "authority.json";
    readonly authorityDigest: Sha256Digest;
  }>;
}

export interface DemandCancelledStoredEvent extends StoredEventBase {
  readonly eventType: "lifecycle.demand-cancelled";
  readonly data: Readonly<{ readonly reason: string }>;
}

export type DemandEventSourcingStoredEvent =
  | DemandPublishedStoredEvent
  | DemandCancelledStoredEvent;

export type DemandEventSourcingStoredEventErrorReason =
  | "json"
  | "schema"
  | "event"
  | "revision"
  | "digest"
  | "state"
  | "representation";

const ERROR_MESSAGES = {
  "json": "Demand Event Sourcing stored event is not passive JSON data.",
  "schema": "Demand Event Sourcing stored event does not satisfy its Schema.",
  "event": "Demand Event Sourcing stored event contains an invalid domain event.",
  "revision": "Demand Event Sourcing stored event contains an invalid stream revision.",
  "digest": "Demand Event Sourcing stored event contains an invalid state digest.",
  "state": "Demand Event Sourcing stored event requires a valid resulting state.",
  "representation": "Demand Event Sourcing stored event bytes are not deterministic.",
} as const satisfies Readonly<Record<
  DemandEventSourcingStoredEventErrorReason,
  string
>>;

export class DemandEventSourcingStoredEventError extends Error {
  override readonly name = "DemandEventSourcingStoredEventError";
  readonly code = "wakeflow-demand-event-sourcing-stored-event" as const;
  readonly reason: DemandEventSourcingStoredEventErrorReason;
  readonly path: string;

  constructor(
    reason: DemandEventSourcingStoredEventErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<StoredEventWire>(
  WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA,
  [WAKEFLOW_SHA256_DIGEST_SCHEMA, WAKEFLOW_UTC_INSTANT_SCHEMA],
);

function fail(
  reason: DemandEventSourcingStoredEventErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingStoredEventError(reason, path);
}

/** 解析 Event Store 已分配位置的不可变事件 envelope。 */
export function parseDemandEventSourcingStoredEvent(
  value: unknown,
): Readonly<DemandEventSourcingStoredEvent> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$event");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  const wire = result.value;
  let uncommitted: Readonly<DemandUncommittedEvent>;
  try {
    uncommitted = parseDemandUncommittedEvent({
      eventId: wire.eventId,
      demandId: wire.demandId,
      recordedAt: wire.recordedAt,
      eventType: wire.eventType,
      eventVersion: wire.eventVersion,
      data: wire.data,
    });
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingEventError) fail("event", "$event");
    throw error;
  }
  let resultingStateDigest: Sha256Digest;
  try {
    resultingStateDigest = parseSha256Digest(
      wire.resultingStateDigest,
      "$/resultingStateDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      fail("digest", "$/resultingStateDigest");
    }
    throw error;
  }
  const base = {
    artifactKind: DEMAND_EVENT_SOURCING_STORED_EVENT_ARTIFACT_KIND,
    schemaVersion: DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA_VERSION,
    eventId: uncommitted.eventId,
    demandId: uncommitted.demandId,
    streamRevision: parseDemandEventStreamRevision(wire.streamRevision),
    recordedAt: uncommitted.recordedAt,
    eventVersion: 1 as const,
    resultingStateDigest,
  };
  return uncommitted.eventType === "publication.demand-published"
    ? Object.freeze({
        ...base,
        eventType: "publication.demand-published" as const,
        data: uncommitted.data,
      })
    : Object.freeze({
        ...base,
        eventType: "lifecycle.demand-cancelled" as const,
        data: uncommitted.data,
      });
}

/** 从纯事件与已 evolve 的 resulting state 构造持久化 envelope。 */
export function createDemandEventSourcingStoredEvent(
  eventValue: unknown,
  streamRevisionValue: unknown,
  resultingStateValue: unknown,
): Readonly<DemandEventSourcingStoredEvent> {
  let event: Readonly<DemandUncommittedEvent>;
  try {
    event = parseDemandUncommittedEvent(eventValue);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingEventError) fail("event", "$event");
    throw error;
  }
  let state: Readonly<DemandAggregateState>;
  try {
    state = parseDemandAggregateState(resultingStateValue);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) fail("state", "$state");
    throw error;
  }
  if (state.demandId !== event.demandId) fail("state", "$state/demandId");
  return parseDemandEventSourcingStoredEvent({
    artifactKind: DEMAND_EVENT_SOURCING_STORED_EVENT_ARTIFACT_KIND,
    schemaVersion: DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA_VERSION,
    ...event,
    streamRevision: parseDemandEventStreamRevision(streamRevisionValue),
    resultingStateDigest: computeDemandAggregateStateDigest(state),
  });
}

/** 从 stored envelope 取回 reducer 接受的纯业务事件。 */
export function toDemandUncommittedEvent(
  value: unknown,
): Readonly<DemandUncommittedEvent> {
  const event = parseDemandEventSourcingStoredEvent(value);
  return parseDemandUncommittedEvent({
    eventId: event.eventId,
    demandId: event.demandId,
    recordedAt: event.recordedAt,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    data: event.data,
  });
}

export function renderDemandEventSourcingStoredEvent(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseDemandEventSourcingStoredEvent(value) as unknown as JsonValue,
    "$event",
  );
}

export function parseDemandEventSourcingStoredEventDocument(
  text: unknown,
): Readonly<DemandEventSourcingStoredEvent> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$event");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$event");
    }
    throw error;
  }
  const event = parseDemandEventSourcingStoredEvent(json);
  if (renderDemandEventSourcingStoredEvent(event) !== text) {
    fail("representation", "$event");
  }
  return event;
}

export function computeDemandEventSourcingStoredEventDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseDemandEventSourcingStoredEvent(value) as unknown as JsonValue,
  );
}
