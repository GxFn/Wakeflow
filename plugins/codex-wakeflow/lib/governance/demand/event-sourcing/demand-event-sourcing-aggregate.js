import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest, Sha256Error, } from "../../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord, } from "../../../foundation/data/passive-own-data.js";
import { computeDemandAggregateStateDigest, DemandAggregateStateError, parseDemandAggregateState, } from "../model/demand-aggregate-state.js";
import { assertSupportedDemandEventSourcingStateModelVersion, DemandEventSourcingStateVersionError, } from "./demand-event-sourcing-state-version.js";
import { computeDemandEventSourcingStoredEventDigest, DemandEventSourcingStoredEventError, parseDemandEventSourcingStoredEvent, } from "./demand-event-sourcing-stored-event.js";
import { DemandEventSourcingUpcasterError, upcastDemandEventSourcingStoredEvent, } from "./demand-event-sourcing-upcaster.js";
import { DemandEventStreamPositionError, parseDemandEventCommitSequence, parseDemandEventStreamRevision, } from "./demand-event-stream-position.js";
const ERROR_MESSAGES = {
    input: "Demand Event Sourcing aggregate input is invalid.",
    identifier: "Demand Event Sourcing aggregate contains an invalid identity.",
    position: "Demand Event Sourcing aggregate contains an invalid cursor.",
    digest: "Demand Event Sourcing aggregate contains an invalid digest.",
    event: "Demand Event Sourcing aggregate contains an invalid tail event.",
    version: "Demand Event Sourcing aggregate tail version is unsupported.",
    state: "Demand Event Sourcing aggregate contains an invalid state.",
    relation: "Demand Event Sourcing aggregate cursor, tail and state do not close.",
};
export class DemandEventSourcingAggregateError extends Error {
    name = "DemandEventSourcingAggregateError";
    code = "wakeflow-demand-event-sourcing-aggregate";
    reason;
    path;
    constructor(reason, path, options) {
        super(ERROR_MESSAGES[reason], options);
        this.reason = reason;
        this.path = path;
    }
}
const FIELDS = Object.freeze([
    "commitSequence",
    "demandId",
    "lastCommitDigest",
    "lastEvent",
    "lastEventDigest",
    "state",
    "stateDigest",
    "streamRevision",
]);
function fail(reason, path, cause) {
    throw new DemandEventSourcingAggregateError(reason, path, cause === undefined ? undefined : { cause });
}
function parseDigest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", path, error);
        throw error;
    }
}
function parseAggregateDemandId(value) {
    try {
        return parseWakeflowDurableIdOfKind(value, "demand", "$/demandId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError) {
            fail("identifier", "$/demandId", error);
        }
        throw error;
    }
}
/** 聚合的最后一个事件：先按存储形状解析，再确认它的状态模型版本受支持、事件本身升级得上来。 */
function parseAggregateLastEvent(value) {
    let lastEvent;
    try {
        lastEvent = parseDemandEventSourcingStoredEvent(value);
    }
    catch (error) {
        if (error instanceof DemandEventSourcingStoredEventError) {
            fail("event", "$/lastEvent", error);
        }
        throw error;
    }
    try {
        assertSupportedDemandEventSourcingStateModelVersion(lastEvent.resultingStateModelVersion, "$/lastEvent/resultingStateModelVersion");
        upcastDemandEventSourcingStoredEvent(lastEvent);
    }
    catch (error) {
        if (error instanceof DemandEventSourcingStateVersionError ||
            error instanceof DemandEventSourcingUpcasterError) {
            fail("version", "$/lastEvent", error);
        }
        throw error;
    }
    return lastEvent;
}
function parseAggregateState(value) {
    try {
        return parseDemandAggregateState(value);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError)
            fail("state", "$/state", error);
        throw error;
    }
}
function parseAggregatePosition(record) {
    try {
        const streamRevision = parseDemandEventStreamRevision(record.streamRevision, "$/streamRevision");
        const commitSequence = parseDemandEventCommitSequence(record.commitSequence, "$/commitSequence");
        return { streamRevision, commitSequence };
    }
    catch (error) {
        if (error instanceof DemandEventStreamPositionError) {
            fail("position", error.path, error);
        }
        throw error;
    }
}
/** 对进程内聚合游标和状态事实执行完整的防御性复验。 */
export function parseDemandEventSourcingAggregate(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$aggregate");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$aggregate", error);
        throw error;
    }
    const keys = Object.keys(record).sort();
    if (keys.length !== FIELDS.length || keys.some((key, index) => key !== FIELDS[index])) {
        fail("input", "$aggregate");
    }
    const demandId = parseAggregateDemandId(record.demandId);
    const lastEvent = parseAggregateLastEvent(record.lastEvent);
    const state = parseAggregateState(record.state);
    const { streamRevision, commitSequence } = parseAggregatePosition(record);
    const lastEventDigest = parseDigest(record.lastEventDigest, "$/lastEventDigest");
    const stateDigest = parseDigest(record.stateDigest, "$/stateDigest");
    if (commitSequence > streamRevision ||
        lastEvent.demandId !== demandId ||
        lastEvent.streamRevision !== streamRevision ||
        state.demandId !== demandId ||
        computeDemandEventSourcingStoredEventDigest(lastEvent) !== lastEventDigest ||
        computeDemandAggregateStateDigest(state) !== stateDigest ||
        lastEvent.resultingStateDigest !== stateDigest) {
        fail("relation", "$aggregate");
    }
    return Object.freeze({
        demandId,
        commitSequence,
        streamRevision,
        lastCommitDigest: parseDigest(record.lastCommitDigest, "$/lastCommitDigest"),
        lastEvent,
        lastEventDigest,
        state,
        stateDigest,
    });
}
