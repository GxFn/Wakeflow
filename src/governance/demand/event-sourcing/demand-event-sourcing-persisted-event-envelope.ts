import type {
  WakeflowDemandEventSourcingStoredEvent as PersistedEventWire,
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
  type JsonObject,
  type JsonValue,
} from "../../../foundation/data/json-value.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../foundation/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../../foundation/time/utc-instant.js";
import {
  parseDemandEventSourcingStateModelVersion,
  DemandEventSourcingStateVersionError,
  type DemandEventSourcingStateModelVersion,
} from "./demand-event-sourcing-state-version.js";
import {
  parseDemandEventStreamRevision,
  type DemandEventStreamRevision,
} from "./demand-event-stream-position.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：跨事件版本稳定的 persisted envelope。
 *
 * 本层只解析 identity、position、type/version 路由、原始 JSON data 与历史 state-digest
 * metadata；它不决定 eventType 是否受支持，也不把 data 解释成 current domain event。
 */

export const DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND =
  "wakeflow-demand-event-sourcing-event" as const;
export const DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION = 1 as const;

export interface DemandEventSourcingPersistedEventEnvelope {
  readonly artifactKind:
    typeof DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND;
  readonly schemaVersion:
    typeof DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly streamRevision: DemandEventStreamRevision;
  readonly recordedAt: UtcInstant;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly data: Readonly<JsonObject>;
  readonly resultingStateModelVersion: DemandEventSourcingStateModelVersion;
  readonly resultingStateDigest: Sha256Digest;
}

export type DemandEventSourcingPersistedEventEnvelopeErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "time"
  | "revision"
  | "digest"
  | "state-version"
  | "representation";

const ERROR_MESSAGES = {
  "json": "Demand Event Sourcing persisted event is not passive JSON data.",
  "schema": "Demand Event Sourcing persisted event envelope does not satisfy its Schema.",
  "identifier": "Demand Event Sourcing persisted event identity is invalid.",
  "time": "Demand Event Sourcing persisted event time is invalid.",
  "revision": "Demand Event Sourcing persisted event revision is invalid.",
  "digest": "Demand Event Sourcing persisted event state digest is invalid.",
  "state-version": "Demand Event Sourcing persisted event state-model version is invalid.",
  "representation": "Demand Event Sourcing persisted event bytes are not deterministic.",
} as const satisfies Readonly<Record<
  DemandEventSourcingPersistedEventEnvelopeErrorReason,
  string
>>;

export class DemandEventSourcingPersistedEventEnvelopeError extends Error {
  override readonly name = "DemandEventSourcingPersistedEventEnvelopeError";
  readonly code = "wakeflow-demand-event-sourcing-persisted-event-envelope" as const;
  readonly reason: DemandEventSourcingPersistedEventEnvelopeErrorReason;
  readonly path: string;

  constructor(
    reason: DemandEventSourcingPersistedEventEnvelopeErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<PersistedEventWire>(
  WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA,
  [WAKEFLOW_SHA256_DIGEST_SCHEMA, WAKEFLOW_UTC_INSTANT_SCHEMA],
);

function fail(
  reason: DemandEventSourcingPersistedEventEnvelopeErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingPersistedEventEnvelopeError(reason, path);
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

/** 解析 envelope；未知 eventType/eventVersion 在本层仍是有效路由事实。 */
export function parseDemandEventSourcingPersistedEventEnvelope(
  value: unknown,
): Readonly<DemandEventSourcingPersistedEventEnvelope> {
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
  let recordedAt: UtcInstant;
  try {
    recordedAt = parseUtcInstant(wire.recordedAt, "$/recordedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/recordedAt");
    throw error;
  }
  let data: JsonValue;
  try {
    data = parseJsonValue(wire.data, "$/data");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", "$/data");
    throw error;
  }
  if (data === null || Array.isArray(data) || typeof data !== "object") {
    fail("schema", "$/data");
  }
  let resultingStateDigest: Sha256Digest;
  try {
    resultingStateDigest = parseSha256Digest(
      wire.resultingStateDigest,
      "$/resultingStateDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", "$/resultingStateDigest");
    throw error;
  }
  let resultingStateModelVersion: DemandEventSourcingStateModelVersion;
  try {
    resultingStateModelVersion = parseDemandEventSourcingStateModelVersion(
      wire.resultingStateModelVersion,
      "$/resultingStateModelVersion",
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingStateVersionError) {
      fail("state-version", "$/resultingStateModelVersion");
    }
    throw error;
  }
  let streamRevision: DemandEventStreamRevision;
  try {
    streamRevision = parseDemandEventStreamRevision(
      wire.streamRevision,
      "$/streamRevision",
    );
  } catch {
    fail("revision", "$/streamRevision");
  }
  return Object.freeze({
    artifactKind: DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND,
    schemaVersion: DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION,
    eventId: parseId(wire.eventId, "demand-event", "$/eventId"),
    demandId: parseId(wire.demandId, "demand", "$/demandId"),
    streamRevision,
    recordedAt,
    eventType: wire.eventType,
    eventVersion: wire.eventVersion,
    data: data as Readonly<JsonObject>,
    resultingStateModelVersion,
    resultingStateDigest,
  });
}

export function renderDemandEventSourcingPersistedEventEnvelope(
  value: unknown,
): string {
  return renderDeterministicJsonDocument(
    parseDemandEventSourcingPersistedEventEnvelope(value) as unknown as JsonValue,
    "$event",
  );
}

export function parseDemandEventSourcingPersistedEventEnvelopeDocument(
  text: unknown,
): Readonly<DemandEventSourcingPersistedEventEnvelope> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$event");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$event");
    }
    throw error;
  }
  const event = parseDemandEventSourcingPersistedEventEnvelope(json);
  if (renderDemandEventSourcingPersistedEventEnvelope(event) !== text) {
    fail("representation", "$event");
  }
  return event;
}

export function computeDemandEventSourcingPersistedEventEnvelopeDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseDemandEventSourcingPersistedEventEnvelope(value) as unknown as JsonValue,
  );
}
