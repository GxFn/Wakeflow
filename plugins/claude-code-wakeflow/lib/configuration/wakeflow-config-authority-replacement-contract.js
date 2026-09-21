import { types } from "node:util";
import { computeSha256Digest, parseSha256Digest, Sha256Error, } from "../foundation/crypto/sha256.js";
import { parsePlainRecord, pickOwnDataProperties, PassiveOwnDataError, } from "../foundation/data/passive-own-data.js";
import { DurableAtomicFileWriteError, } from "../foundation/filesystem/durable-atomic-file-write.js";
import { parseDurableAtomicFileReplaceOptions, } from "../foundation/filesystem/durable-atomic-file-write-contract.js";
import { FileNodeSnapshotError, sameFileNodeSnapshot, } from "../foundation/filesystem/file-node-snapshot.js";
import { parsePortableResourcePath } from "../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../foundation/filesystem/rooted-directory.js";
import { RootedExclusiveFileLockError, } from "../foundation/filesystem/rooted-exclusive-file-lock.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../contracts/identity/wakeflow-durable-id.js";
import { encodeUtf8, Utf8Error } from "../foundation/text/utf8.js";
import { readWakeflowConfigAuthoritySnapshot, WakeflowConfigAuthoritySnapshotError, WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE, WAKEFLOW_CONFIG_FILE_REF, WAKEFLOW_CONFIG_MAXIMUM_BYTES, } from "./wakeflow-config-authority-snapshot.js";
import { validateWakeflowConfigRootPlacements, WakeflowConfigRootPlacementError, } from "./wakeflow-config-root-placement.js";
import { computeWakeflowConfigDigest, parseWakeflowConfig, WakeflowConfigError, } from "./wakeflow-config.js";
import { renderWakeflowConfig } from "./wakeflow-config-document.js";
/**
 * Config 替换流程的领域合同、无副作用输入准入，以及共享的源资源和目标事实。
 *
 * 本模块由正常替换和显式恢复共同使用，不执行文件替换、暂存文件清理或锁残留退休。
 * 错误、P1 所有者与权限策略、调用方预期和目标字节在此保持唯一解释，避免两条路径
 * 形成不同的 Config 权威记录准入规则。
 */
export const WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF = parsePortableResourcePath(".wakeflow-config-authority.lock");
export const WAKEFLOW_CONFIG_AUTHORITY_LOCK_TIMEOUT_MILLISECONDS = 10_000;
const ERROR_MESSAGES = {
    "input": "Wakeflow config authority replacement input is invalid.",
    "unsupported-platform": "Wakeflow config authority replacement requires reliable local POSIX ownership semantics.",
    "root-scope": "Wakeflow config authority replacement lost its workspace root scope.",
    "root-policy": "Wakeflow config authority replacement requires a current-user workspace root.",
    "config": "Wakeflow config authority replacement requires one strict desired model.",
    "capacity": "Wakeflow config authority replacement exceeds its recoverable byte limit.",
    "placement": "Wakeflow config authority replacement declares an unsafe root placement.",
    "source-invalid": "Current Wakeflow config authority cannot be loaded strictly.",
    "source-policy": "Current Wakeflow config authority violates replacement source policy.",
    "program-identity": "Wakeflow config authority replacement cannot change program identity.",
    "conflict": "Wakeflow config authority no longer matches its expected source.",
    "lock-timeout": "Wakeflow config authority replacement lock acquisition timed out.",
    "lock-unsafe": "Wakeflow config authority replacement lock is unsafe.",
    "recovery-not-required": "Wakeflow config authority replacement has no lock residue to recover.",
    "recovery-required": "Wakeflow config authority replacement residue cannot be recovered automatically.",
    "aborted": "Wakeflow config authority replacement was aborted before commit.",
    "replacement-failure": "Wakeflow config authority could not be replaced safely.",
    "commit-uncertain": "Replaced Wakeflow config authority could not be proven exact.",
};
/** Config replacement 与显式恢复的稳定、脱敏错误。 */
export class WakeflowConfigAuthorityReplacementError extends Error {
    name = "WakeflowConfigAuthorityReplacementError";
    code = "wakeflow-config-authority-replacement";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
export function failWakeflowConfigAuthorityReplacement(reason, path) {
    throw new WakeflowConfigAuthorityReplacementError(reason, path);
}
export function assertWakeflowConfigAuthorityRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        failWakeflowConfigAuthorityReplacement("input", "$root");
    }
}
function isAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
}
function optionRecord(value) {
    try {
        return parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch {
        failWakeflowConfigAuthorityReplacement("input", "$options");
    }
}
function parsePositiveMilliseconds(value, path) {
    if (typeof value !== "number"
        || !Number.isSafeInteger(value)
        || value <= 0
        || value > 300_000) {
        failWakeflowConfigAuthorityReplacement("input", path);
    }
    return value;
}
function parseSignal(value) {
    if (value === undefined)
        return undefined;
    if (!isAbortSignal(value)) {
        failWakeflowConfigAuthorityReplacement("input", "$options.signal");
    }
    return value;
}
export function parseWakeflowConfigAuthorityReplacementOptions(value) {
    const record = optionRecord(value);
    const allowed = new Set([
        "acquireTimeoutMilliseconds",
        "retryDelayMilliseconds",
        "signal",
    ]);
    if (Object.keys(record).some((key) => !allowed.has(key))) {
        failWakeflowConfigAuthorityReplacement("input", "$options");
    }
    return Object.freeze({
        acquireTimeoutMilliseconds: record.acquireTimeoutMilliseconds === undefined
            ? WAKEFLOW_CONFIG_AUTHORITY_LOCK_TIMEOUT_MILLISECONDS
            : parsePositiveMilliseconds(record.acquireTimeoutMilliseconds, "$options.acquireTimeoutMilliseconds"),
        retryDelayMilliseconds: record.retryDelayMilliseconds === undefined
            ? undefined
            : parsePositiveMilliseconds(record.retryDelayMilliseconds, "$options.retryDelayMilliseconds"),
        signal: parseSignal(record.signal),
    });
}
export function parseWakeflowConfigAuthorityRecoveryOptions(value) {
    const record = optionRecord(value);
    if (Object.keys(record).some((key) => key !== "signal")) {
        failWakeflowConfigAuthorityReplacement("input", "$options");
    }
    return Object.freeze({ signal: parseSignal(record.signal) });
}
export function assertWakeflowConfigAuthorityNotAborted(signal) {
    if (signal?.aborted === true) {
        failWakeflowConfigAuthorityReplacement("aborted", "$signal");
    }
}
export function currentWakeflowConfigAuthorityUserId() {
    if (process.platform === "win32" || typeof process.geteuid !== "function") {
        failWakeflowConfigAuthorityReplacement("unsupported-platform", "$root");
    }
    return BigInt(process.geteuid());
}
export async function assertCurrentUserWakeflowConfigAuthorityRoot(root, expectedUserId) {
    try {
        const node = await root.assertCurrent("$root");
        if (node.userId !== expectedUserId) {
            failWakeflowConfigAuthorityReplacement("root-policy", "$root");
        }
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthorityReplacementError)
            throw error;
        if (error instanceof RootedDirectoryError) {
            failWakeflowConfigAuthorityReplacement("root-scope", "$root");
        }
        failWakeflowConfigAuthorityReplacement("root-scope", "$root");
    }
}
export function parseWakeflowConfigAuthorityExpectation(value, expectedUserId) {
    let projected;
    let modelProjected;
    let programProjected;
    let sourceProjected;
    try {
        projected = pickOwnDataProperties(value, ["configDigest", "model", "source", "workspaceRoot"], "$expected");
        modelProjected = pickOwnDataProperties(projected.model, ["program"], "$/expected/model");
        programProjected = pickOwnDataProperties(modelProjected.program, ["programId"], "$/expected/model/program");
        sourceProjected = pickOwnDataProperties(projected.source, ["byteCount", "digest", "node", "resourcePath"], "$/expected/source");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            failWakeflowConfigAuthorityReplacement("input", "$expected");
        }
        failWakeflowConfigAuthorityReplacement("input", "$expected");
    }
    if (typeof projected.workspaceRoot !== "string"
        || projected.configDigest === undefined
        || programProjected.programId === undefined
        || sourceProjected.byteCount === undefined
        || sourceProjected.digest === undefined
        || sourceProjected.node === undefined
        || sourceProjected.resourcePath === undefined) {
        failWakeflowConfigAuthorityReplacement("input", "$expected");
    }
    let configDigest;
    try {
        configDigest = parseSha256Digest(projected.configDigest, "$/expected/configDigest");
    }
    catch (error) {
        if (error instanceof Sha256Error) {
            failWakeflowConfigAuthorityReplacement("input", "$/expected/configDigest");
        }
        failWakeflowConfigAuthorityReplacement("input", "$/expected/configDigest");
    }
    let programId;
    try {
        programId = parseWakeflowDurableIdOfKind(programProjected.programId, "program", "$/expected/model/program/programId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError) {
            failWakeflowConfigAuthorityReplacement("input", "$/expected/model/program/programId");
        }
        failWakeflowConfigAuthorityReplacement("input", "$/expected/model/program/programId");
    }
    let source;
    try {
        source = parseDurableAtomicFileReplaceOptions({
            mode: WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE,
            expected: {
                byteCount: sourceProjected.byteCount,
                digest: sourceProjected.digest,
                node: sourceProjected.node,
                resourcePath: sourceProjected.resourcePath,
            },
        }).expected;
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError) {
            failWakeflowConfigAuthorityReplacement("input", "$expected");
        }
        failWakeflowConfigAuthorityReplacement("input", "$expected");
    }
    if (source.resourcePath !== WAKEFLOW_CONFIG_FILE_REF
        || source.node.linkCount !== 1n
        || source.node.permissionBits !== WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE
        || source.node.userId !== expectedUserId) {
        failWakeflowConfigAuthorityReplacement("source-policy", "$/expected/source");
    }
    return Object.freeze({
        workspaceRoot: projected.workspaceRoot,
        source,
        configDigest,
        programId,
    });
}
export function prepareWakeflowConfigAuthorityDesired(value) {
    let model;
    try {
        model = parseWakeflowConfig(value);
    }
    catch (error) {
        if (error instanceof WakeflowConfigError) {
            failWakeflowConfigAuthorityReplacement("config", error.path);
        }
        failWakeflowConfigAuthorityReplacement("config", "$config");
    }
    let bytes;
    try {
        bytes = encodeUtf8(renderWakeflowConfig(model), "$config");
    }
    catch (error) {
        if (error instanceof WakeflowConfigError || error instanceof Utf8Error) {
            failWakeflowConfigAuthorityReplacement("config", "$config");
        }
        failWakeflowConfigAuthorityReplacement("config", "$config");
    }
    if (bytes.byteLength > WAKEFLOW_CONFIG_MAXIMUM_BYTES) {
        failWakeflowConfigAuthorityReplacement("capacity", "$config");
    }
    try {
        return Object.freeze({
            model,
            bytes,
            sourceDigest: computeSha256Digest(bytes, "$config"),
            configDigest: computeWakeflowConfigDigest(model),
        });
    }
    catch {
        failWakeflowConfigAuthorityReplacement("config", "$config");
    }
}
export async function assertWakeflowConfigAuthorityDesiredPlacements(root, model) {
    try {
        await validateWakeflowConfigRootPlacements(root, model);
    }
    catch (error) {
        if (error instanceof WakeflowConfigRootPlacementError) {
            if (error.reason === "root-scope") {
                failWakeflowConfigAuthorityReplacement("root-scope", "$root");
            }
            if (error.reason === "input") {
                failWakeflowConfigAuthorityReplacement("input", error.path);
            }
            failWakeflowConfigAuthorityReplacement("placement", error.path);
        }
        failWakeflowConfigAuthorityReplacement("placement", "$placements");
    }
}
export async function readCurrentWakeflowConfigAuthority(root, signal, afterCommit) {
    try {
        return await readWakeflowConfigAuthoritySnapshot(root, afterCommit || signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (afterCommit) {
            failWakeflowConfigAuthorityReplacement("commit-uncertain", "$resourcePath");
        }
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted") {
                failWakeflowConfigAuthorityReplacement("aborted", "$signal");
            }
            if (error.reason === "root-scope") {
                failWakeflowConfigAuthorityReplacement("root-scope", "$root");
            }
            if (error.reason === "source-policy") {
                failWakeflowConfigAuthorityReplacement("source-policy", "$source");
            }
            failWakeflowConfigAuthorityReplacement("source-invalid", "$source");
        }
        failWakeflowConfigAuthorityReplacement("source-invalid", "$source");
    }
}
export function assertWakeflowConfigAuthoritySourcePolicy(snapshot, expectedUserId) {
    const node = snapshot.source.node;
    if (node.kind !== "file"
        || node.linkCount !== 1n
        || node.permissionBits !== WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE
        || node.userId !== expectedUserId) {
        failWakeflowConfigAuthorityReplacement("source-policy", "$source");
    }
}
export function sameWakeflowConfigAuthoritySource(left, right) {
    try {
        return left.resourcePath === right.resourcePath
            && left.byteCount === right.byteCount
            && left.digest === right.digest
            && sameFileNodeSnapshot(left.node, right.node);
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError) {
            failWakeflowConfigAuthorityReplacement("input", "$expected");
        }
        failWakeflowConfigAuthorityReplacement("input", "$expected");
    }
}
export function matchesWakeflowConfigAuthorityExpectation(root, current, expected) {
    return expected.workspaceRoot === root.absolutePath
        && current.workspaceRoot === root.absolutePath
        && current.configDigest === expected.configDigest
        && current.model.program.programId === expected.programId
        && sameWakeflowConfigAuthoritySource(current.source, expected.source);
}
export function wakeflowConfigAuthorityLockOptions(options) {
    return {
        acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds,
        ...(options.retryDelayMilliseconds === undefined
            ? {}
            : { retryDelayMilliseconds: options.retryDelayMilliseconds }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
}
export function mapWakeflowConfigAuthorityLockError(error, committed) {
    if (committed) {
        failWakeflowConfigAuthorityReplacement("commit-uncertain", "$resourcePath");
    }
    if (error.reason === "input") {
        failWakeflowConfigAuthorityReplacement("input", error.path);
    }
    if (error.reason === "aborted") {
        failWakeflowConfigAuthorityReplacement("aborted", "$signal");
    }
    if (error.reason === "timeout") {
        failWakeflowConfigAuthorityReplacement("lock-timeout", "$lock");
    }
    if (error.reason === "root-scope" || error.reason === "parent") {
        failWakeflowConfigAuthorityReplacement("root-scope", "$root");
    }
    if (error.reason === "owner-active" || error.reason === "residue-changed") {
        failWakeflowConfigAuthorityReplacement("recovery-required", "$lock");
    }
    failWakeflowConfigAuthorityReplacement("lock-unsafe", "$lock");
}
