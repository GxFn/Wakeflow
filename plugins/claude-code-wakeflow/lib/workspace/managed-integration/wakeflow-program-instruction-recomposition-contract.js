import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { createWakeflowWorkspaceStaticResourceOperationContext, WakeflowWorkspaceStaticResourceOperationContextError, } from "../wakeflow-workspace-static-resource-operation-context.js";
import { wakeflowProgramInstructionRecompositionLockRef, } from "../workspace-host-resource-catalog.js";
import { parseWakeflowProgramInstructionInspectionRequest, WakeflowProgramInstructionInspectionError, } from "./wakeflow-program-instruction-inspection.js";
/**
 * Program Instruction 锁内重组和显式恢复共享的机械合同。
 *
 * 本模块只准入 current/desired Config 请求、根目录、短锁 recipe 与有界选项；不读取
 * 指令文件、不生成正文、不取得锁，也不发布或恢复任何资源。
 */
export const WAKEFLOW_PROGRAM_INSTRUCTION_RECOMPOSITION_LOCK_TIMEOUT_MILLISECONDS = 10_000;
const ERROR_MESSAGES = {
    input: "Wakeflow Program Instruction recomposition input is invalid.",
    "unsupported-platform": "Wakeflow Program Instruction recomposition requires POSIX ownership facts.",
    "root-scope": "Wakeflow Program Instruction recomposition lost its workspace root scope.",
    "root-policy": "Wakeflow Program Instruction recomposition requires a current-user workspace root.",
    "source-invalid": "Wakeflow Program Instruction source cannot be recomposed safely.",
    capacity: "Wakeflow Program Instruction recomposition exceeds its byte budget.",
    conflict: "Wakeflow Program Instruction source changed before atomic publication.",
    "lock-timeout": "Wakeflow Program Instruction recomposition lock acquisition timed out.",
    "lock-unsafe": "Wakeflow Program Instruction recomposition lock is unsafe.",
    "recovery-not-required": "Wakeflow Program Instruction recomposition has no lock residue to recover.",
    "recovery-required": "Wakeflow Program Instruction recomposition requires explicit recovery.",
    aborted: "Wakeflow Program Instruction recomposition was aborted before commit.",
    "effect-failure": "Wakeflow Program Instruction candidate could not be published safely.",
    "commit-uncertain": "Published Wakeflow Program Instruction could not be proven exact.",
};
/** Program Instruction 重组与恢复失败的稳定、脱敏错误。 */
export class WakeflowProgramInstructionRecompositionError extends Error {
    name = "WakeflowProgramInstructionRecompositionError";
    code = "wakeflow-program-instruction-recomposition";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
export function failWakeflowProgramInstructionRecomposition(reason, path) {
    throw new WakeflowProgramInstructionRecompositionError(reason, path);
}
export function assertWakeflowProgramInstructionRecompositionRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        failWakeflowProgramInstructionRecomposition("input", "$root");
    }
}
function plainRecord(value, path) {
    try {
        return parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            failWakeflowProgramInstructionRecomposition("input", path);
        }
        throw error;
    }
}
export function parseWakeflowProgramInstructionRecompositionRequest(value) {
    try {
        const parsed = parseWakeflowProgramInstructionInspectionRequest(value);
        if (parsed.signal !== undefined) {
            failWakeflowProgramInstructionRecomposition("input", "$request.signal");
        }
        return parsed;
    }
    catch (error) {
        if (error instanceof WakeflowProgramInstructionInspectionError) {
            failWakeflowProgramInstructionRecomposition("input", error.path);
        }
        throw error;
    }
}
function isAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
}
function positiveMilliseconds(value, path) {
    if (typeof value !== "number"
        || !Number.isSafeInteger(value)
        || value <= 0
        || value > 300_000) {
        failWakeflowProgramInstructionRecomposition("input", path);
    }
    return value;
}
export function parseWakeflowProgramInstructionRecompositionOptions(value) {
    const record = plainRecord(value === undefined ? {} : value, "$options");
    const allowed = new Set([
        "acquireTimeoutMilliseconds",
        "retryDelayMilliseconds",
        "signal",
    ]);
    if (Object.keys(record).some((key) => !allowed.has(key))
        || (record.signal !== undefined && !isAbortSignal(record.signal))) {
        failWakeflowProgramInstructionRecomposition("input", "$options");
    }
    return Object.freeze({
        acquireTimeoutMilliseconds: record.acquireTimeoutMilliseconds === undefined
            ? WAKEFLOW_PROGRAM_INSTRUCTION_RECOMPOSITION_LOCK_TIMEOUT_MILLISECONDS
            : positiveMilliseconds(record.acquireTimeoutMilliseconds, "$options.acquireTimeoutMilliseconds"),
        retryDelayMilliseconds: record.retryDelayMilliseconds === undefined
            ? undefined
            : positiveMilliseconds(record.retryDelayMilliseconds, "$options.retryDelayMilliseconds"),
        signal: record.signal,
    });
}
export function parseWakeflowProgramInstructionRecompositionRecoveryOptions(value) {
    const record = plainRecord(value === undefined ? {} : value, "$options");
    if (Object.keys(record).some((key) => key !== "signal")
        || (record.signal !== undefined && !isAbortSignal(record.signal))) {
        failWakeflowProgramInstructionRecomposition("input", "$options");
    }
    return Object.freeze({ signal: record.signal });
}
export function assertWakeflowProgramInstructionRecompositionNotAborted(signal) {
    if (signal?.aborted === true) {
        failWakeflowProgramInstructionRecomposition("aborted", "$signal");
    }
}
export function currentWakeflowProgramInstructionRecompositionUserId() {
    if (process.platform === "win32" || typeof process.geteuid !== "function") {
        failWakeflowProgramInstructionRecomposition("unsupported-platform", "$root");
    }
    return BigInt(process.geteuid());
}
export async function assertCurrentUserWakeflowProgramInstructionRoot(root, expectedUserId) {
    try {
        const node = await root.assertCurrent("$root");
        if (node.userId !== expectedUserId) {
            failWakeflowProgramInstructionRecomposition("root-policy", "$root");
        }
    }
    catch (error) {
        if (error instanceof WakeflowProgramInstructionRecompositionError) {
            throw error;
        }
        if (error instanceof RootedDirectoryError) {
            failWakeflowProgramInstructionRecomposition("root-scope", "$root");
        }
        failWakeflowProgramInstructionRecomposition("root-scope", "$root");
    }
}
export function admitWakeflowProgramInstructionLockOperations(request) {
    for (const recipe of ["exclusive-create", "exact-retire"]) {
        try {
            createWakeflowWorkspaceStaticResourceOperationContext(request.matrix, {
                expectedMatrixDigest: request.expectedMatrixDigest,
                declarationId: `host-runtime.${request.profile.hostId}.instruction-lock`,
                recipe,
            });
        }
        catch (error) {
            if (error instanceof WakeflowWorkspaceStaticResourceOperationContextError) {
                failWakeflowProgramInstructionRecomposition("input", "$request.matrix");
            }
            throw error;
        }
    }
}
export function wakeflowProgramInstructionInspectionRequest(request, signal) {
    return Object.freeze({
        matrix: request.matrix,
        expectedMatrixDigest: request.expectedMatrixDigest,
        profile: request.profile,
        currentConfig: request.currentConfig,
        expectedCurrentConfigDigest: request.currentConfigDigest,
        desiredConfig: request.desiredConfig,
        expectedDesiredConfigDigest: request.desiredConfigDigest,
        ...(signal === undefined ? {} : { signal }),
    });
}
export function wakeflowProgramInstructionTargetRef(request) {
    return request.profile.instructionFileName;
}
export function wakeflowProgramInstructionLockRef(request) {
    return wakeflowProgramInstructionRecompositionLockRef(request.profile);
}
export function wakeflowProgramInstructionLockOptions(options) {
    return {
        acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds,
        ...(options.retryDelayMilliseconds === undefined
            ? {}
            : { retryDelayMilliseconds: options.retryDelayMilliseconds }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
}
export function mapWakeflowProgramInstructionLockError(error, committed) {
    if (committed) {
        failWakeflowProgramInstructionRecomposition("commit-uncertain", "$resourcePath");
    }
    if (error.reason === "input") {
        failWakeflowProgramInstructionRecomposition("input", error.path);
    }
    if (error.reason === "aborted") {
        failWakeflowProgramInstructionRecomposition("aborted", "$signal");
    }
    if (error.reason === "timeout") {
        failWakeflowProgramInstructionRecomposition("lock-timeout", "$lock");
    }
    if (error.reason === "root-scope" || error.reason === "parent") {
        failWakeflowProgramInstructionRecomposition("root-scope", "$root");
    }
    if (error.reason === "owner-active"
        || error.reason === "residue-changed"
        || error.reason === "release-failure") {
        failWakeflowProgramInstructionRecomposition("recovery-required", "$lock");
    }
    failWakeflowProgramInstructionRecomposition("lock-unsafe", "$lock");
}
