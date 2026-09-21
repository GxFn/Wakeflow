import { WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA, } from "../../../contracts/generated/governance/demand/demand-event-sourcing-stored-event.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import { computeCanonicalJsonSha256Digest, } from "../../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../../foundation/data/json-value.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import { parseUtcInstant, UtcInstantError, } from "../../../foundation/time/utc-instant.js";
import { parseDemandEventSourcingStateModelVersion, DemandEventSourcingStateVersionError, } from "./demand-event-sourcing-state-version.js";
import { parseDemandEventStreamRevision, DemandEventStreamPositionError, } from "./demand-event-stream-position.js";
/**
 * Wakeflow Governance / Demand Event Sourcing：跨事件版本稳定的持久化事件封装。
 *
 * 本层只解析事件标识、位置、类型与版本路由、原始 JSON 数据和历史状态摘要元数据。
 * 它不决定 `eventType` 是否受支持，也不把数据解释为当前版本的领域事件。
 */
export const DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND = "wakeflow-demand-event-sourcing-event";
export const DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION = 1;
const ERROR_MESSAGES = {
    "json": "Demand Event Sourcing persisted event is not passive JSON data.",
    "schema": "Demand Event Sourcing persisted event envelope does not satisfy its Schema.",
    "identifier": "Demand Event Sourcing persisted event identity is invalid.",
    "time": "Demand Event Sourcing persisted event time is invalid.",
    "revision": "Demand Event Sourcing persisted event revision is invalid.",
    "digest": "Demand Event Sourcing persisted event state digest is invalid.",
    "state-version": "Demand Event Sourcing persisted event state-model version is invalid.",
    "representation": "Demand Event Sourcing persisted event bytes are not deterministic.",
};
export class DemandEventSourcingPersistedEventEnvelopeError extends Error {
    name = "DemandEventSourcingPersistedEventEnvelopeError";
    code = "wakeflow-demand-event-sourcing-persisted-event-envelope";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA, [WAKEFLOW_SHA256_DIGEST_SCHEMA, WAKEFLOW_UTC_INSTANT_SCHEMA]);
function fail(reason, path) {
    throw new DemandEventSourcingPersistedEventEnvelopeError(reason, path);
}
function parseId(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
function isJsonObject(value) {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value);
}
/** 解析 envelope；未知 eventType/eventVersion 在本层仍是有效路由事实。 */
export function parseDemandEventSourcingPersistedEventEnvelope(value) {
    let json;
    try {
        json = parseJsonValue(value, "$event");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json", error.path);
        throw error;
    }
    const result = validateWire(json);
    if (!result.ok)
        fail("schema", result.path);
    const wire = result.value;
    let recordedAt;
    try {
        recordedAt = parseUtcInstant(wire.recordedAt, "$/recordedAt");
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", "$/recordedAt");
        throw error;
    }
    let data;
    try {
        data = parseJsonValue(wire.data, "$/data");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json", "$/data");
        throw error;
    }
    if (!isJsonObject(data)) {
        fail("schema", "$/data");
    }
    let resultingStateDigest;
    try {
        resultingStateDigest = parseSha256Digest(wire.resultingStateDigest, "$/resultingStateDigest");
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", "$/resultingStateDigest");
        throw error;
    }
    let resultingStateModelVersion;
    try {
        resultingStateModelVersion = parseDemandEventSourcingStateModelVersion(wire.resultingStateModelVersion, "$/resultingStateModelVersion");
    }
    catch (error) {
        if (error instanceof DemandEventSourcingStateVersionError) {
            fail("state-version", "$/resultingStateModelVersion");
        }
        throw error;
    }
    let streamRevision;
    try {
        streamRevision = parseDemandEventStreamRevision(wire.streamRevision, "$/streamRevision");
    }
    catch (error) {
        if (error instanceof DemandEventStreamPositionError) {
            fail("revision", "$/streamRevision");
        }
        throw error;
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
        data,
        resultingStateModelVersion,
        resultingStateDigest,
    });
}
export function renderDemandEventSourcingPersistedEventEnvelope(value) {
    return renderDeterministicJsonDocument(parseDemandEventSourcingPersistedEventEnvelope(value), "$event");
}
export function parseDemandEventSourcingPersistedEventEnvelopeDocument(text) {
    let json;
    try {
        json = parseDeterministicJsonDocument(text, "$event");
    }
    catch (error) {
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
export function computeDemandEventSourcingPersistedEventEnvelopeDigest(value) {
    return computeCanonicalJsonSha256Digest(parseDemandEventSourcingPersistedEventEnvelope(value));
}
