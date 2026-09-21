import { types } from "node:util";
import { PassiveOwnDataError, parsePlainRecord, } from "../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { deriveWakeflowExternalInstructionAuthorities, parseWakeflowExternalInstructionInspectionRequest, WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE, WakeflowExternalInstructionInspectionError, wakeflowExternalInstructionInspectionOf, wakeflowExternalInstructionManagedBlockFileRequest, } from "./wakeflow-external-instruction-inspection.js";
import { recomposeWakeflowManagedBlockFile, WakeflowManagedBlockFileError, } from "./wakeflow-managed-block-file.js";
const ERROR_MESSAGES = {
    input: "Wakeflow external instruction recomposition input is invalid.",
    "unsupported-platform": "Wakeflow external instruction recomposition requires POSIX ownership facts.",
    "root-scope": "Wakeflow external instruction recomposition lost its root scope.",
    "root-policy": "Wakeflow external instruction recomposition requires a current-user root.",
    "source-invalid": "Wakeflow external instruction source cannot be recomposed safely.",
    capacity: "Wakeflow external instruction recomposition exceeds its byte budget.",
    conflict: "Wakeflow external instruction source changed before atomic publication.",
    "recovery-required": "Wakeflow external instruction target has stage residue that requires explicit recovery.",
    aborted: "Wakeflow external instruction recomposition was aborted.",
    "effect-failure": "Wakeflow external instruction recomposition effect failed.",
    "commit-uncertain": "Wakeflow external instruction recomposition commit outcome is uncertain.",
};
/** 外部指令重组失败的稳定、脱敏错误。 */
export class WakeflowExternalInstructionRecompositionError extends Error {
    name = "WakeflowExternalInstructionRecompositionError";
    code = "wakeflow-external-instruction-recomposition";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowExternalInstructionRecompositionError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function parseOptions(value) {
    if (value === undefined)
        return undefined;
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal")) {
        fail("input", "$options");
    }
    if (record.signal === undefined)
        return undefined;
    if (typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)) {
        fail("input", "$options.signal");
    }
    return record.signal;
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function parseRequest(value, signal) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || Object.hasOwn(value, "signal")) {
        fail("input", "$request");
    }
    try {
        return parseWakeflowExternalInstructionInspectionRequest({
            ...value,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof WakeflowExternalInstructionInspectionError) {
            fail("input", error.path);
        }
        throw error;
    }
}
function deriveAuthorities(request) {
    try {
        return deriveWakeflowExternalInstructionAuthorities(request);
    }
    catch (error) {
        if (error instanceof WakeflowExternalInstructionInspectionError) {
            fail("input", error.path);
        }
        throw error;
    }
}
/** 通用 owner 的失败映射回外部指令重组的词汇：读取类问题统一为 source-invalid，容量统一为 capacity。 */
function mapManagedBlockFileError(error) {
    switch (error.reason) {
        case "input":
            return fail("input", error.path);
        case "unsupported-platform":
        case "root-scope":
        case "root-policy":
        case "conflict":
        case "recovery-required":
        case "aborted":
        case "effect-failure":
        case "commit-uncertain":
            return fail(error.reason, error.path);
        case "source-capacity":
            return fail("capacity", "$source");
        case "target-capacity":
            return fail("capacity", "$target");
        default:
            return fail("source-invalid", "$source");
    }
}
/**
 * 在调用方持有的维护事务内重推导并幂等创建或 CAS 替换外部根里的 Wakeflow 托管块。
 */
export async function recomposeWakeflowExternalInstruction(rootValue, requestValue, optionsValue) {
    assertRoot(rootValue);
    const signal = parseOptions(optionsValue);
    assertNotAborted(signal);
    const request = parseRequest(requestValue, signal);
    const authorities = deriveAuthorities(request);
    let receipt;
    try {
        receipt = await recomposeWakeflowManagedBlockFile(rootValue, wakeflowExternalInstructionManagedBlockFileRequest(request, authorities, signal), { createMode: WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE });
    }
    catch (error) {
        if (error instanceof WakeflowManagedBlockFileError)
            mapManagedBlockFileError(error);
        throw error;
    }
    return Object.freeze({
        disposition: receipt.disposition,
        effect: receipt.effect,
        inspection: wakeflowExternalInstructionInspectionOf(request, authorities, receipt.inspection),
    });
}
