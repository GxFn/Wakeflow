import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../../foundation/data/deterministic-json-document.js";
import { computeDemandAggregateStateDigest, parseDemandAggregateState, DemandAggregateStateError, } from "../model/demand-aggregate-state.js";
import { parseDemandUncommittedEvent, DemandEventSourcingEventError, } from "./demand-event-sourcing-event.js";
import { encodeCurrentDemandEventVersion, } from "./demand-event-sourcing-event-version-codec.js";
import { computeDemandEventSourcingPersistedEventEnvelopeDigest, parseDemandEventSourcingPersistedEventEnvelope, DemandEventSourcingPersistedEventEnvelopeError, DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND, DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION, } from "./demand-event-sourcing-persisted-event-envelope.js";
import { DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION, } from "./demand-event-sourcing-state-version.js";
import { parseDemandEventStreamRevision, DemandEventStreamPositionError, } from "./demand-event-stream-position.js";
/**
 * Demand 事件溯源持久化事件的兼容门面和当前版本写入器。
 *
 * 事件封装准入、版本编解码器、事件升版转换器和当前事件模型分别属于相邻模块。
 * 本模块保留 Event Store 与 Commit 使用的稳定名称，并保证写入器只产生各事件家族
 * 的最新版本。
 */
const DEMAND_EVENT_SOURCING_STORED_EVENT_ARTIFACT_KIND = DEMAND_EVENT_SOURCING_PERSISTED_EVENT_ARTIFACT_KIND;
const DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA_VERSION = DEMAND_EVENT_SOURCING_PERSISTED_EVENT_SCHEMA_VERSION;
const ERROR_MESSAGES = {
    "json": "Demand Event Sourcing stored event is not passive JSON data.",
    "schema": "Demand Event Sourcing stored event envelope is invalid.",
    "event": "Demand Event Sourcing current event is invalid.",
    "revision": "Demand Event Sourcing stored event revision is invalid.",
    "digest": "Demand Event Sourcing stored event digest is invalid.",
    "state-version": "Demand Event Sourcing stored event state-model version is invalid.",
    "state": "Demand Event Sourcing stored event requires a valid resulting state.",
    "representation": "Demand Event Sourcing stored event bytes are not deterministic.",
};
export class DemandEventSourcingStoredEventError extends Error {
    name = "DemandEventSourcingStoredEventError";
    code = "wakeflow-demand-event-sourcing-stored-event";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new DemandEventSourcingStoredEventError(reason, path);
}
function mapEnvelopeError(error) {
    if (error.reason === "json")
        fail("json", error.path);
    if (error.reason === "revision")
        fail("revision", error.path);
    if (error.reason === "digest")
        fail("digest", error.path);
    if (error.reason === "state-version")
        fail("state-version", error.path);
    if (error.reason === "representation")
        fail("representation", error.path);
    fail("schema", error.path);
}
/** 只解析跨版本稳定的事件封装；载荷由事件升版注册表延迟解释。 */
export function parseDemandEventSourcingStoredEvent(value) {
    try {
        return parseDemandEventSourcingPersistedEventEnvelope(value);
    }
    catch (error) {
        if (error instanceof DemandEventSourcingPersistedEventEnvelopeError) {
            mapEnvelopeError(error);
        }
        throw error;
    }
}
/** 根据当前事件和已经演进的状态编码最新持久化事件封装。 */
export function createDemandEventSourcingStoredEvent(eventValue, streamRevisionValue, resultingStateValue) {
    let event;
    try {
        event = parseDemandUncommittedEvent(eventValue);
    }
    catch (error) {
        if (error instanceof DemandEventSourcingEventError)
            fail("event", "$event");
        throw error;
    }
    let state;
    try {
        state = parseDemandAggregateState(resultingStateValue);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError)
            fail("state", "$state");
        throw error;
    }
    if (state.demandId !== event.demandId)
        fail("state", "$state/demandId");
    const encoded = encodeCurrentDemandEventVersion(event);
    let streamRevision;
    try {
        streamRevision = parseDemandEventStreamRevision(streamRevisionValue);
    }
    catch (error) {
        if (error instanceof DemandEventStreamPositionError) {
            fail("revision", "$streamRevision");
        }
        throw error;
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
        resultingStateModelVersion: DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION,
        resultingStateDigest: computeDemandAggregateStateDigest(state),
    });
}
export function renderDemandEventSourcingStoredEvent(value) {
    return renderDeterministicJsonDocument(parseDemandEventSourcingStoredEvent(value), "$event");
}
export function parseDemandEventSourcingStoredEventDocument(text) {
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
    const event = parseDemandEventSourcingStoredEvent(json);
    if (renderDemandEventSourcingStoredEvent(event) !== text) {
        fail("representation", "$event");
    }
    return event;
}
export function computeDemandEventSourcingStoredEventDigest(value) {
    // 门面先维持自己的稳定错误合同，再委托事件封装摘要计算。
    const event = parseDemandEventSourcingStoredEvent(value);
    return computeDemandEventSourcingPersistedEventEnvelopeDigest(event);
}
