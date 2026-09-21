import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { parseWakeflowSupportMemoryInspectionRequest, WakeflowSupportMemoryInspectionError, } from "./wakeflow-support-memory-inspection.js";
const ERROR_MESSAGES = {
    input: "Wakeflow support memory publication input is invalid.",
    "source-invalid": "Wakeflow support memory source cannot be published safely.",
    capacity: "Wakeflow support memory publication exceeds its byte budget.",
    conflict: "Wakeflow support memory source changed before atomic publication.",
    "recovery-required": "Wakeflow support memory publication requires explicit recovery.",
    aborted: "Wakeflow support memory publication was aborted before commit.",
    "effect-failure": "Wakeflow support memory could not be published safely.",
    "commit-uncertain": "Published Wakeflow support memory could not be proven exact.",
};
/** Support memory 发布与恢复失败的稳定、脱敏错误。 */
export class WakeflowSupportMemoryPublicationError extends Error {
    name = "WakeflowSupportMemoryPublicationError";
    code = "wakeflow-support-memory-publication";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
export function failWakeflowSupportMemoryPublication(reason, path) {
    throw new WakeflowSupportMemoryPublicationError(reason, path);
}
export function parseWakeflowSupportMemoryPublicationRequest(value) {
    try {
        const parsed = parseWakeflowSupportMemoryInspectionRequest(value);
        if (parsed.signal !== undefined) {
            failWakeflowSupportMemoryPublication("input", "$request.signal");
        }
        return parsed;
    }
    catch (error) {
        if (error instanceof WakeflowSupportMemoryInspectionError) {
            failWakeflowSupportMemoryPublication("input", error.path);
        }
        throw error;
    }
}
export function parseWakeflowSupportMemoryPublicationOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            failWakeflowSupportMemoryPublication("input", "$options");
        }
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal")
        || (record.signal !== undefined
            && (typeof record.signal !== "object"
                || record.signal === null
                || types.isProxy(record.signal)
                || !(record.signal instanceof AbortSignal)))) {
        failWakeflowSupportMemoryPublication("input", "$options");
    }
    return Object.freeze({ signal: record.signal });
}
export function assertWakeflowSupportMemoryPublicationNotAborted(signal) {
    if (signal?.aborted === true) {
        failWakeflowSupportMemoryPublication("aborted", "$signal");
    }
}
export function wakeflowSupportMemoryInspectionRequest(request, signal) {
    return Object.freeze({
        currentConfig: request.currentConfig,
        expectedCurrentConfigDigest: request.currentConfigDigest,
        desiredConfig: request.desiredConfig,
        expectedDesiredConfigDigest: request.desiredConfigDigest,
        profile: request.profile,
        expectedCatalogDigest: request.catalog.catalogDigest,
        surfaceId: request.surfaceId,
        ...(signal === undefined ? {} : { signal }),
    });
}
