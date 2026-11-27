import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import type { WakeflowDemandEventSourcingStoredEvent as PersistedEventWire } from "../../../contracts/generated/governance/demand/demand-event-sourcing-stored-event.generated.js";
import { WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA } from "../../../contracts/generated/governance/demand/demand-event-sourcing-stored-event.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../../foundation/crypto/sha256.js";
import {
  type JsonObject,
  type JsonValue,
  JsonValueError,
  parseJsonValue,
} from "../../../foundation/data/json-value.js";
import { type Fail, failWith, ModuleError } from "../../../foundation/error/module-error.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  type UtcInstant,
  UtcInstantError,
} from "../../../foundation/time/utc-instant.js";
import {
  type DemandEventSourcingStateModelVersion,
  DemandEventSourcingStateVersionError,
  parseDemandEventSourcingStateModelVersion,
} from "./demand-event-sourcing-state-version.js";
import {
  DemandEventStreamPositionError,
  type DemandEventStreamRevision,
  parseDemandEventStreamRevision,
} from "./demand-event-stream-position.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：跨事件版本稳定的持久化事件封装。
 *
 * 本层只解析事件标识、位置、类型与版本路由、原始 JSON 数据和历史状态摘要元数据。
 * 它不决定 `eventType` 是否受支持，也不把数据解释为当前版本的领域事件。
 */

export const DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND =
  "wakeflow-demand-event-sourcing-event" as const;
export const DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION = 1 as const;

export interface DemandEventSourcingPersistedEventEnvelope {
  readonly artifactKind: typeof DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND;
  readonly schemaVersion: typeof DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION;
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
  | "state-version";

export class DemandEventSourcingPersistedEventEnvelopeError extends ModuleError<DemandEventSourcingPersistedEventEnvelopeErrorReason> {
  static override readonly code = "wakeflow-demand-event-sourcing-persisted-event-envelope";
}

const fail: Fail<DemandEventSourcingPersistedEventEnvelopeErrorReason> = failWith(
  DemandEventSourcingPersistedEventEnvelopeError,
);

const validateWire = createRuntimeJsonSchemaValidator<PersistedEventWire>(
  WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA,
  [WAKEFLOW_SHA256_DIGEST_SCHEMA, WAKEFLOW_UTC_INSTANT_SCHEMA],
);

function parseId<Kind extends "demand" | "demand-event">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path, error);
    throw error;
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRecordedAt(value: unknown): UtcInstant {
  try {
    return parseUtcInstant(value, "$/recordedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/recordedAt", error);
    throw error;
  }
}

/** 事件数据是一个 JSON 对象：不是合法 JSON 是 json，不是对象是 schema。 */
function parseEventData(value: unknown) {
  let data: JsonValue;
  try {
    data = parseJsonValue(value, "$/data");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", "$/data", error);
    throw error;
  }
  if (!isJsonObject(data)) {
    fail("schema", "$/data");
  }
  return data;
}

function parseResultingStateDigest(value: unknown): Sha256Digest {
  try {
    return parseSha256Digest(value, "$/resultingStateDigest");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", "$/resultingStateDigest", error);
    throw error;
  }
}

function parseResultingStateModelVersion(value: unknown): DemandEventSourcingStateModelVersion {
  try {
    return parseDemandEventSourcingStateModelVersion(value, "$/resultingStateModelVersion");
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingStateVersionError) {
      fail("state-version", "$/resultingStateModelVersion", error);
    }
    throw error;
  }
}

function parseStreamRevision(value: unknown): DemandEventStreamRevision {
  try {
    return parseDemandEventStreamRevision(value, "$/streamRevision");
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) {
      fail("revision", "$/streamRevision", error);
    }
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
    if (error instanceof JsonValueError) fail("json", error.path, error);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  const wire = result.value;
  const recordedAt = parseRecordedAt(wire.recordedAt);
  const data = parseEventData(wire.data);
  const resultingStateDigest = parseResultingStateDigest(wire.resultingStateDigest);
  const resultingStateModelVersion = parseResultingStateModelVersion(
    wire.resultingStateModelVersion,
  );
  const streamRevision = parseStreamRevision(wire.streamRevision);
  return Object.freeze({
    artifactKind: DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND,
    schemaVersion: DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION,
    eventId: parseId(wire.eventId, "demand-event", "$/eventId"),
    demandId: parseId(wire.demandId, "demand", "$/demandId"),
    streamRevision,
    recordedAt,
    eventType: wire.eventType,
    eventVersion: wire.eventVersion,
    data,
    resultingStateModelVersion,
    resultingStateDigest,
  });
}

export function computeDemandEventSourcingPersistedEventEnvelopeDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseDemandEventSourcingPersistedEventEnvelope(value));
}
