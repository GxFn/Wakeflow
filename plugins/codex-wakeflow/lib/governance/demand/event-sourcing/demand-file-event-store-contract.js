import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../../../foundation/data/passive-own-data.js";
import { parseByteCount } from "../../../foundation/numeric/byte-count.js";
import { renderDemandEventStreamCommit, } from "./demand-event-stream-commit.js";
/** Demand 文件事件存储的容量、回执和稳定错误合同。 */
export const DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE = 0o700;
export const DEMAND_FILE_EVENT_STORE_FILE_MODE = 0o600;
export const DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS = 10_000;
export const DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES = parseByteCount(16 * 1024 * 1024, "$demandFileEventStore.maximumCommitBytes");
export const DEMAND_FILE_EVENT_STORE_MAXIMUM_TOTAL_BYTES = parseByteCount(64 * 1024 * 1024, "$demandFileEventStore.maximumTotalBytes");
const ERROR_MESSAGES = {
    "input": "Demand File Event Store input is invalid.",
    "root-scope": "Demand File Event Store root changed during the operation.",
    "not-initialized": "Demand File Event Store directories are not initialized.",
    "node-policy": "Demand File Event Store resource violates its private node policy.",
    "capacity": "Demand File Event Store exceeds its bounded capacity.",
    "stream-invalid": "Demand File Event Store commit stream is invalid.",
    "stream-changed": "Demand File Event Store commit stream changed during observation.",
    "candidate-conflict": "Demand File Event Store append candidate differs from the requested commit.",
    "candidate-busy": "Demand File Event Store append candidate is already in progress.",
    "concurrency-conflict": "Demand File Event Store expected stream cursor is stale.",
    "append-identity-conflict": "Demand File Event Store append reuses an immutable commit or event identity.",
    "append-provenance-conflict": "Demand File Event Store prepared aggregate does not match the persisted stream tail.",
    "commit-uncertain": "Demand File Event Store commit point cannot be proven exact.",
    "cleanup-required": "Demand File Event Store committed but candidate retirement requires recovery.",
    "aborted": "Demand File Event Store operation was aborted before its next commit point.",
    "operation-failure": "Demand File Event Store operation failed.",
};
export class DemandFileEventStoreError extends Error {
    name = "DemandFileEventStoreError";
    code = "wakeflow-demand-file-event-store";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function currentUserId() {
    return typeof process.geteuid === "function"
        ? BigInt(process.geteuid())
        : null;
}
export function failDemandFileEventStore(reason, path) {
    throw new DemandFileEventStoreError(reason, path);
}
export function parseDemandFileEventStoreOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            failDemandFileEventStore("input", "$options");
        }
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal")
        || (record.signal !== undefined
            && (typeof record.signal !== "object"
                || record.signal === null
                || types.isProxy(record.signal)
                || !(record.signal instanceof AbortSignal)))) {
        failDemandFileEventStore("input", "$options");
    }
    return Object.freeze({ signal: record.signal });
}
export function assertDemandFileEventStoreDirectory(node, path) {
    if (node.kind !== "directory"
        || node.permissionBits !== DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE
        || (currentUserId() !== null && node.userId !== currentUserId())) {
        failDemandFileEventStore("node-policy", path);
    }
}
export function assertDemandFileEventStoreFile(node, path, admittedLinkCounts = [1n]) {
    if (node.kind !== "file"
        || node.permissionBits !== DEMAND_FILE_EVENT_STORE_FILE_MODE
        || !admittedLinkCounts.includes(node.linkCount)
        || (currentUserId() !== null && node.userId !== currentUserId())) {
        failDemandFileEventStore("node-policy", path);
    }
}
export function sameDemandEventStreamCommit(left, right) {
    return renderDemandEventStreamCommit(left)
        === renderDemandEventStreamCommit(right);
}
