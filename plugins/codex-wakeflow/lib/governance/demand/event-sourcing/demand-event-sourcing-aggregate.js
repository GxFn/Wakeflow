import { parseSha256Digest, Sha256Error, } from "../../../foundation/crypto/sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../../foundation/data/passive-own-data.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { computeDemandAggregateStateDigest, parseDemandAggregateState, DemandAggregateStateError, } from "../model/demand-aggregate-state.js";
import { computeDemandEventSourcingStoredEventDigest, parseDemandEventSourcingStoredEvent, DemandEventSourcingStoredEventError, } from "./demand-event-sourcing-stored-event.js";
import { parseDemandEventCommitSequence, parseDemandEventStreamRevision, DemandEventStreamPositionError, } from "./demand-event-stream-position.js";
import { upcastDemandEventSourcingStoredEvent, DemandEventSourcingUpcasterError, } from "./demand-event-sourcing-upcaster.js";
import { assertSupportedDemandEventSourcingStateModelVersion, DemandEventSourcingStateVersionError, } from "./demand-event-sourcing-state-version.js";
const ERROR_MESSAGES = {
    "input": "Demand Event Sourcing aggregate input is invalid.",
    "identifier": "Demand Event Sourcing aggregate contains an invalid identity.",
    "position": "Demand Event Sourcing aggregate contains an invalid cursor.",
    "digest": "Demand Event Sourcing aggregate contains an invalid digest.",
    "event": "Demand Event Sourcing aggregate contains an invalid tail event.",
    "version": "Demand Event Sourcing aggregate tail version is unsupported.",
    "state": "Demand Event Sourcing aggregate contains an invalid state.",
    "relation": "Demand Event Sourcing aggregate cursor, tail and state do not close.",
};
export class DemandEventSourcingAggregateError extends Error {
    name = "DemandEventSourcingAggregateError";
    code = "wakeflow-demand-event-sourcing-aggregate";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
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
function fail(reason, path) {
    throw new DemandEventSourcingAggregateError(reason, path);
}
function parseDigest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", path);
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
            fail("input", "$aggregate");
        throw error;
    }
    const keys = Object.keys(record).sort();
    if (keys.length !== FIELDS.length
        || keys.some((key, index) => key !== FIELDS[index])) {
        fail("input", "$aggregate");
    }
    let demandId;
    try {
        demandId = parseWakeflowDurableIdOfKind(record.demandId, "demand", "$/demandId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError) {
            fail("identifier", "$/demandId");
        }
        throw error;
    }
    let lastEvent;
    try {
        lastEvent = parseDemandEventSourcingStoredEvent(record.lastEvent);
    }
    catch (error) {
        if (error instanceof DemandEventSourcingStoredEventError) {
            fail("event", "$/lastEvent");
        }
        throw error;
    }
    try {
        assertSupportedDemandEventSourcingStateModelVersion(lastEvent.resultingStateModelVersion, "$/lastEvent/resultingStateModelVersion");
        upcastDemandEventSourcingStoredEvent(lastEvent);
    }
    catch (error) {
        if (error instanceof DemandEventSourcingStateVersionError
            || error instanceof DemandEventSourcingUpcasterError) {
            fail("version", "$/lastEvent");
        }
        throw error;
    }
    let state;
    try {
        state = parseDemandAggregateState(record.state);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError)
            fail("state", "$/state");
        throw error;
    }
    let streamRevision;
    let commitSequence;
    try {
        streamRevision = parseDemandEventStreamRevision(record.streamRevision, "$/streamRevision");
        commitSequence = parseDemandEventCommitSequence(record.commitSequence, "$/commitSequence");
    }
    catch (error) {
        if (error instanceof DemandEventStreamPositionError) {
            fail("position", error.path);
        }
        throw error;
    }
    const lastEventDigest = parseDigest(record.lastEventDigest, "$/lastEventDigest");
    const stateDigest = parseDigest(record.stateDigest, "$/stateDigest");
    if (commitSequence > streamRevision
        ||
            lastEvent.demandId !== demandId
        || lastEvent.streamRevision !== streamRevision
        || state.demandId !== demandId
        || computeDemandEventSourcingStoredEventDigest(lastEvent) !== lastEventDigest
        || computeDemandAggregateStateDigest(state) !== stateDigest
        || lastEvent.resultingStateDigest !== stateDigest) {
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
