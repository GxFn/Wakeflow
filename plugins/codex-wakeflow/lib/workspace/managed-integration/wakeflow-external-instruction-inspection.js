import { types } from "node:util";
import { computeWakeflowConfigDigest, parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord, } from "../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../workspace-host-resource-profile.js";
import { createWakeflowExternalInstructionBodyAuthority, listWakeflowExternalInstructionTargets, parseWakeflowExternalInstructionTarget, WakeflowExternalInstructionBodyAuthorityError, wakeflowExternalInstructionTargetKey, } from "./wakeflow-external-instruction-body-authority.js";
import { inspectWakeflowManagedBlockFile, WakeflowManagedBlockFileError, } from "./wakeflow-managed-block-file.js";
/**
 * Wakeflow Workspace / Managed Integration：外部根托管块的只读文件检查。
 *
 * 根是产品仓库或 external-owned 支撑面的根目录，由调用方按 Config placement 打开；
 * 本模块只推导 current/desired Config 各自的正文权威，把文件的机械部分（当前用户拥有的
 * 单链接普通文件、权限位不限、current→desired 转换、合法 marker 但正文未知即拒绝）交给
 * 通用托管块文件 owner `wakeflow-managed-block-file.ts`（§13.114 D1）。current Config 里
 * 该 target 不是 managed-block 时没有可准入的前序正文，等价于 fresh 的空 current。
 * 本模块不取得锁、不发布，也不把传入 Config 证明成已提交的 workspace authority。
 */
export const WAKEFLOW_EXTERNAL_INSTRUCTION_MAXIMUM_BYTES = parseByteCount(2 * 1024 * 1024, "$externalInstruction.maximumBytes");
export const WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE = 0o644;
const ERROR_MESSAGES = {
    input: "Wakeflow external instruction inspection input is invalid.",
    "unsupported-platform": "Wakeflow external instruction inspection requires POSIX ownership facts.",
    authority: "Wakeflow external instruction content authority is invalid.",
    source: "Wakeflow external instruction source cannot be read stably.",
    "source-capacity": "Wakeflow external instruction source exceeds its byte budget.",
    "source-policy": "Wakeflow external instruction source violates its node policy.",
    envelope: "Wakeflow external instruction managed envelope is invalid.",
    "unknown-managed-body": "Wakeflow external instruction managed body is not an admitted render.",
    "target-capacity": "Wakeflow external instruction candidate exceeds its byte budget.",
    aborted: "Wakeflow external instruction inspection was aborted.",
};
/** 外部指令只读检查失败的稳定、脱敏错误。 */
export class WakeflowExternalInstructionInspectionError extends Error {
    name = "WakeflowExternalInstructionInspectionError";
    code = "wakeflow-external-instruction-inspection";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowExternalInstructionInspectionError(reason, path);
}
function parseDigest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("input", path);
        throw error;
    }
}
function parseConfig(value, path) {
    try {
        return parseWakeflowConfig(value);
    }
    catch (error) {
        if (error instanceof WakeflowConfigError)
            fail("input", path);
        throw error;
    }
}
function isAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
}
function hasTarget(config, target) {
    const key = wakeflowExternalInstructionTargetKey(target);
    return listWakeflowExternalInstructionTargets(config).some((candidate) => wakeflowExternalInstructionTargetKey(candidate) === key);
}
/** 快照并绑定 Host Profile、target 与 current/desired Config 摘要。 */
export function parseWakeflowExternalInstructionInspectionRequest(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$request");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$request");
        throw error;
    }
    const keys = Object.keys(record).sort();
    const requiredKeys = [
        "currentConfig",
        "desiredConfig",
        "expectedCurrentConfigDigest",
        "expectedDesiredConfigDigest",
        "profile",
        "target",
    ];
    const validKeys = record.signal === undefined
        ? requiredKeys
        : [...requiredKeys, "signal"].sort();
    if (keys.length !== validKeys.length
        || keys.some((key, index) => key !== validKeys[index])
        || (record.signal !== undefined && !isAbortSignal(record.signal))) {
        fail("input", "$request");
    }
    let profile;
    try {
        profile = parseWakeflowWorkspaceHostResourceProfile(record.profile);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
            fail("input", "$request.profile");
        }
        throw error;
    }
    let target;
    try {
        target = parseWakeflowExternalInstructionTarget(record.target, "$request.target");
    }
    catch (error) {
        if (error instanceof WakeflowExternalInstructionBodyAuthorityError) {
            fail("input", error.path);
        }
        throw error;
    }
    const desiredConfig = parseConfig(record.desiredConfig, "$request.desiredConfig");
    const desiredConfigDigest = parseDigest(record.expectedDesiredConfigDigest, "$request.expectedDesiredConfigDigest");
    if (computeWakeflowConfigDigest(desiredConfig) !== desiredConfigDigest) {
        fail("input", "$request.expectedDesiredConfigDigest");
    }
    if (!hasTarget(desiredConfig, target))
        fail("input", "$request.target");
    let currentConfig;
    let currentConfigDigest;
    if (record.currentConfig === null) {
        if (record.expectedCurrentConfigDigest !== null) {
            fail("input", "$request.expectedCurrentConfigDigest");
        }
        currentConfig = null;
        currentConfigDigest = null;
    }
    else {
        currentConfig = parseConfig(record.currentConfig, "$request.currentConfig");
        currentConfigDigest = parseDigest(record.expectedCurrentConfigDigest, "$request.expectedCurrentConfigDigest");
        if (computeWakeflowConfigDigest(currentConfig) !== currentConfigDigest) {
            fail("input", "$request.expectedCurrentConfigDigest");
        }
        if (currentConfig.program.programId !== desiredConfig.program.programId) {
            fail("input", "$request.desiredConfig.program.programId");
        }
    }
    return Object.freeze({
        profile,
        target,
        currentConfig,
        currentConfigDigest,
        desiredConfig,
        desiredConfigDigest,
        signal: record.signal,
    });
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function createAuthority(config, request) {
    try {
        return createWakeflowExternalInstructionBodyAuthority(config, request.profile, request.target);
    }
    catch (error) {
        if (error instanceof WakeflowExternalInstructionBodyAuthorityError) {
            fail("authority", error.path);
        }
        throw error;
    }
}
/** 推导两份正文权威：current Config 里该 target 不是 managed-block 时没有前序正文。 */
export function deriveWakeflowExternalInstructionAuthorities(request) {
    return Object.freeze({
        currentAuthority: request.currentConfig !== null && hasTarget(request.currentConfig, request.target)
            ? createAuthority(request.currentConfig, request)
            : null,
        desiredAuthority: createAuthority(request.desiredConfig, request),
    });
}
/** 通用托管块文件 owner 的请求：当前宿主的指令文件、两份 envelope target、2 MiB 上限。 */
export function wakeflowExternalInstructionManagedBlockFileRequest(request, authorities, signal) {
    return {
        resourcePath: request.profile.instructionFileName,
        currentTargets: authorities.currentAuthority === null
            ? []
            : [authorities.currentAuthority.envelopeTarget],
        desiredTarget: authorities.desiredAuthority.envelopeTarget,
        maximumBytes: WAKEFLOW_EXTERNAL_INSTRUCTION_MAXIMUM_BYTES,
        ...(signal === undefined ? {} : { signal }),
    };
}
/** 把通用 owner 的检查结果套回外部指令的合同：加 target、Config 摘要与两份权威。 */
export function wakeflowExternalInstructionInspectionOf(request, authorities, inspection) {
    return Object.freeze({
        status: inspection.status,
        target: request.target,
        currentConfigDigest: request.currentConfigDigest,
        desiredConfigDigest: request.desiredConfigDigest,
        currentAuthority: authorities.currentAuthority,
        desiredAuthority: authorities.desiredAuthority,
        source: inspection.source,
        transition: inspection.transition,
    });
}
/** 通用 owner 的只读失败映射回外部指令检查的词汇；写入类原因在只读路径上不会出现。 */
function mapManagedBlockFileError(error) {
    switch (error.reason) {
        case "input":
            return fail("input", error.path);
        case "unsupported-platform":
        case "source":
        case "source-capacity":
        case "source-policy":
        case "envelope":
        case "unknown-managed-body":
        case "target-capacity":
        case "aborted":
            return fail(error.reason, error.path);
        default:
            return fail("source", "$source");
    }
}
/** 稳定检查一个外部根里当前宿主的指令文件并生成零写入的 current 或重组候选。 */
export async function inspectWakeflowExternalInstruction(rootValue, requestValue) {
    assertRoot(rootValue);
    const request = parseWakeflowExternalInstructionInspectionRequest(requestValue);
    if (request.signal?.aborted === true)
        fail("aborted", "$signal");
    const authorities = deriveWakeflowExternalInstructionAuthorities(request);
    let inspection;
    try {
        inspection = await inspectWakeflowManagedBlockFile(rootValue, wakeflowExternalInstructionManagedBlockFileRequest(request, authorities, request.signal));
    }
    catch (error) {
        if (error instanceof WakeflowManagedBlockFileError)
            mapManagedBlockFileError(error);
        throw error;
    }
    return wakeflowExternalInstructionInspectionOf(request, authorities, inspection);
}
