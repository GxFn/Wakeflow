import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../../foundation/data/deterministic-json-document.js";
import type { JsonValue } from "../../../foundation/data/json-value.js";
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
  encodeCurrentDemandEventVersion,
} from "./demand-event-sourcing-event-version-codec.js";
import {
  computeDemandEventSourcingPersistedEventEnvelopeDigest,
  parseDemandEventSourcingPersistedEventEnvelope,
  DemandEventSourcingPersistedEventEnvelopeError,
  DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND,
  DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION,
  type DemandEventSourcingPersistedEventEnvelope,
} from "./demand-event-sourcing-persisted-event-envelope.js";
import {
  DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION,
} from "./demand-event-sourcing-state-version.js";
import {
  parseDemandEventStreamRevision,
} from "./demand-event-stream-position.js";
import {
  upcastDemandEventSourcingStoredEvent,
} from "./demand-event-sourcing-upcaster.js";

/**
 * Demand Event Sourcing persisted event 的兼容 facade 与 current writer。
 *
 * Envelope admission、版本 codec/upcaster 与 current event 分属相邻模块；本文件保留
 * Store/Commit 使用的稳定名称，并保证 writer 只产生各事件家族 latest version。
 */

export const DEMAND_EVENT_SOURCING_STORED_EVENT_ARTIFACT_KIND =
  DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND;
export const DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA_VERSION =
  DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION;

export type DemandEventSourcingStoredEvent =
  DemandEventSourcingPersistedEventEnvelope;

export type DemandEventSourcingStoredEventErrorReason =
  | "json"
  | "schema"
  | "event"
  | "revision"
  | "digest"
  | "state-version"
  | "state"
  | "representation";

const ERROR_MESSAGES = {
  "json": "Demand Event Sourcing stored event is not passive JSON data.",
  "schema": "Demand Event Sourcing stored event envelope is invalid.",
  "event": "Demand Event Sourcing current event is invalid.",
  "revision": "Demand Event Sourcing stored event revision is invalid.",
  "digest": "Demand Event Sourcing stored event digest is invalid.",
  "state-version": "Demand Event Sourcing stored event state-model version is invalid.",
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

  constructor(reason: DemandEventSourcingStoredEventErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: DemandEventSourcingStoredEventErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingStoredEventError(reason, path);
}

function mapEnvelopeError(
  error: DemandEventSourcingPersistedEventEnvelopeError,
): never {
  if (error.reason === "json") fail("json", error.path);
  if (error.reason === "revision") fail("revision", error.path);
  if (error.reason === "digest") fail("digest", error.path);
  if (error.reason === "state-version") fail("state-version", error.path);
  if (error.reason === "representation") fail("representation", error.path);
  fail("schema", error.path);
}

/** 只解析跨版本稳定 envelope；payload 由 upcaster Registry 延迟解释。 */
export function parseDemandEventSourcingStoredEvent(
  value: unknown,
): Readonly<DemandEventSourcingStoredEvent> {
  try {
    return parseDemandEventSourcingPersistedEventEnvelope(value);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingPersistedEventEnvelopeError) {
      mapEnvelopeError(error);
    }
    throw error;
  }
}

/** 从 current event 与已 evolve state 编码 latest persisted envelope。 */
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
  const encoded = encodeCurrentDemandEventVersion(event);
  let streamRevision;
  try {
    streamRevision = parseDemandEventStreamRevision(streamRevisionValue);
  } catch {
    fail("revision", "$streamRevision");
  }
  return parseDemandEventSourcingStoredEvent({
    artifactKind: DEMAND_EVENT_SOURCING_STORED_EVENT_ARTIFACT_KIND,
    schemaVersion: DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA_VERSION,
    eventId: event.eventId,
    demandId: event.demandId,
    streamRevision,
    recordedAt: event.recordedAt,
    eventType: encoded.eventType,
    eventVersion: encoded.eventVersion,
    data: encoded.data,
    resultingStateModelVersion:
      DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION,
    resultingStateDigest: computeDemandAggregateStateDigest(state),
  });
}

/** 从 persisted envelope 取得 reducer 接受的 current event。 */
export function toDemandUncommittedEvent(
  value: unknown,
): Readonly<DemandUncommittedEvent> {
  return upcastDemandEventSourcingStoredEvent(value);
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
  // Facade 先维持自己的稳定错误面，再委托 envelope digest。
  const event = parseDemandEventSourcingStoredEvent(value);
  return computeDemandEventSourcingPersistedEventEnvelopeDigest(event);
}
