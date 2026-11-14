import { EventSourcingVersionEvolutionError } from "../../../foundation/event-sourcing/event-sourcing-version-evolution.js";
import { DemandEventSourcingEventError, } from "./demand-event-sourcing-event.js";
import { decodeDemandEventSourcingPersistedEvent } from "./demand-event-sourcing-event-version-codec.js";
import { DemandEventSourcingPersistedEventEnvelopeError, parseDemandEventSourcingPersistedEventEnvelope, } from "./demand-event-sourcing-persisted-event-envelope.js";
const ERROR_MESSAGES = {
    input: "Demand Event Sourcing upcaster input is invalid.",
    "unsupported-event-type": "Demand Event Sourcing event type is unsupported.",
    "unsupported-version": "Demand Event Sourcing event version is unsupported.",
    codec: "Demand Event Sourcing persisted event payload is invalid.",
    upcast: "Demand Event Sourcing event version evolution failed.",
    event: "Demand Event Sourcing persisted event cannot become a current event.",
};
export class DemandEventSourcingUpcasterError extends Error {
    name = "DemandEventSourcingUpcasterError";
    code = "wakeflow-demand-event-sourcing-upcaster";
    reason;
    path;
    constructor(reason, path, options) {
        super(ERROR_MESSAGES[reason], options);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path, cause) {
    throw new DemandEventSourcingUpcasterError(reason, path, cause === undefined ? undefined : { cause });
}
/** 把任一受支持的持久化版本转换为当前归约器事件。 */
export function upcastDemandEventSourcingStoredEvent(value) {
    let envelope;
    try {
        envelope = parseDemandEventSourcingPersistedEventEnvelope(value);
    }
    catch (error) {
        if (error instanceof DemandEventSourcingPersistedEventEnvelopeError) {
            fail("input", error.path, error);
        }
        throw error;
    }
    try {
        return decodeDemandEventSourcingPersistedEvent(envelope);
    }
    catch (error) {
        if (error instanceof EventSourcingVersionEvolutionError) {
            if (error.path === "$/eventType") {
                fail("unsupported-event-type", "$/eventType", error);
            }
            if (error.reason === "unsupported-version") {
                fail("unsupported-version", "$/eventVersion", error);
            }
            if (error.reason === "codec")
                fail("codec", "$/data", error);
            fail("upcast", "$/data", error);
        }
        if (error instanceof DemandEventSourcingEventError) {
            fail("event", "$event", error);
        }
        throw error;
    }
}
