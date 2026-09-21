import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { LEDGER_DURABLE_DIRECTORY_MODE, LEDGER_DURABLE_FILE_MODE, } from "./ledger-authority-storage-policy.js";
const ERROR_MESSAGES = {
    input: "Ledger authority store input is invalid.",
    "root-scope": "Ledger authority root changed during the operation.",
    "not-found": "Ledger authority record does not exist.",
    "recovery-required": "Ledger authority record has an unresolved publication residue.",
    "recovery-input-required": "Ledger publication stage is incomplete and requires exact caller bytes.",
    conflict: "Ledger authority bytes conflict with an immutable identity.",
    record: "Ledger authority record is invalid.",
    member: "Ledger authority member inventory or bytes are invalid.",
    "node-policy": "Ledger authority resource violates its durable node policy.",
    capacity: "Ledger authority resource exceeds its bounded capacity.",
    "lock-timeout": "Ledger record publication lock could not be acquired before its deadline.",
    "lock-unsafe": "Ledger record publication lock resource is unsafe.",
    aborted: "Ledger authority operation was aborted.",
    "operation-failure": "Ledger authority operation failed.",
};
/** Ledger Store 操作失败时返回的稳定、脱敏错误。 */
export class LedgerAuthorityStoreError extends Error {
    name = "LedgerAuthorityStoreError";
    code = "wakeflow-ledger-authority-store";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
export function throwLedgerAuthorityStoreError(reason, path) {
    throw new LedgerAuthorityStoreError(reason, path);
}
export function isLedgerAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
}
export function parseLedgerAuthorityStoreOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            throwLedgerAuthorityStoreError("input", "$options");
        }
        throw error;
    }
    const unexpected = Object.keys(record).find((key) => key !== "signal");
    if (unexpected !== undefined) {
        throwLedgerAuthorityStoreError("input", `$options/${unexpected}`);
    }
    if (record.signal !== undefined && !isLedgerAbortSignal(record.signal)) {
        throwLedgerAuthorityStoreError("input", "$options/signal");
    }
    return Object.freeze({ signal: record.signal });
}
export function assertLedgerAuthorityNode(node, kind, path) {
    if (node.kind !== kind
        || node.permissionBits !== (kind === "file"
            ? LEDGER_DURABLE_FILE_MODE
            : LEDGER_DURABLE_DIRECTORY_MODE)
        || (kind === "file" && node.linkCount !== 1n)) {
        throwLedgerAuthorityStoreError("node-policy", path);
    }
}
