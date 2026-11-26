import { types } from "node:util";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { isAbortSignal } from "../../foundation/node/abort-signal.js";
import { requireCurrentUserId } from "../../foundation/node/current-user.js";
import { parseWakeflowProgramInstructionInspectionRequest, WakeflowProgramInstructionInspectionError, } from "./wakeflow-program-instruction-inspection.js";
/**
 * Program Instruction 锁内重组和显式恢复共享的机械合同。
 *
 * 本模块只准入 current/desired Config 请求、根目录、短锁 recipe 与有界选项；不读取
 * 指令文件、不生成正文、不取得锁，也不发布或恢复任何资源。
 */
const WAKEFLOW_PROGRAM_INSTRUCTION_RECOMPOSITION_LOCK_TIMEOUT_MILLISECONDS = 10_000;
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
    constructor(reason, path, options) {
        super(ERROR_MESSAGES[reason], options);
        this.reason = reason;
        this.path = path;
    }
}
export function failWakeflowProgramInstructionRecomposition(reason, path, cause) {
    throw new WakeflowProgramInstructionRecompositionError(reason, path, cause === undefined ? undefined : { cause });
}
export function assertWakeflowProgramInstructionRecompositionRoot(value) {
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !(value instanceof RootedDirectory)) {
        failWakeflowProgramInstructionRecomposition("input", "$root");
    }
}
function plainRecord(value, path) {
    try {
        return parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            failWakeflowProgramInstructionRecomposition("input", path, error);
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
            failWakeflowProgramInstructionRecomposition("input", error.path, error);
        }
        throw error;
    }
}
function positiveMilliseconds(value, path) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 300_000) {
        failWakeflowProgramInstructionRecomposition("input", path);
    }
    return value;
}
export function parseWakeflowProgramInstructionRecompositionOptions(value) {
    const record = plainRecord(value === undefined ? {} : value, "$options");
    const allowed = new Set(["acquireTimeoutMilliseconds", "retryDelayMilliseconds", "signal"]);
    if (Object.keys(record).some((key) => !allowed.has(key)) ||
        (record.signal !== undefined && !isAbortSignal(record.signal))) {
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
export function assertWakeflowProgramInstructionRecompositionNotAborted(signal) {
    if (signal?.aborted === true) {
        failWakeflowProgramInstructionRecomposition("aborted", "$signal");
    }
}
export function currentWakeflowProgramInstructionRecompositionUserId() {
    return requireCurrentUserId(() => failWakeflowProgramInstructionRecomposition("unsupported-platform", "$root"));
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
            failWakeflowProgramInstructionRecomposition("root-scope", "$root", error);
        }
        throw error;
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
export function wakeflowProgramInstructionLockOptions(options) {
    return {
        acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds,
        ...(options.retryDelayMilliseconds === undefined
            ? {}
            : { retryDelayMilliseconds: options.retryDelayMilliseconds }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
}
/** 程序指令重组锁（ADR-0033）的失败：已经提交之后的任何失败都是提交结果不确定。 */
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
    failWakeflowProgramInstructionRecomposition("lock-unsafe", "$lock");
}
