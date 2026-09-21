import { types } from "node:util";
import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { unlinkRegularFileExactly, ExactRegularFileUnlinkError, } from "./exact-regular-file-unlink.js";
import { sameFileNodeIdentity, sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { computeDurableAtomicFileStageTargetDigest, hasDurableAtomicFileStagePrefix, parseDurableAtomicFileStageFileName, readDurableAtomicFileStageOwnerState, DurableAtomicFileStageAddressError, } from "./durable-atomic-file-stage-address.js";
import { settleRegularFileDurability, DurableRegularFileSettlementError, } from "./durable-regular-file-settlement.js";
import { parsePortableResourcePath, PortableResourcePathError, splitPortableResourcePath, } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
import { readStableResourceDirectory, readStableRootDirectory, StableDirectoryReadError, } from "./stable-directory-read.js";
import { readStableFileDigest, StableFileReadError, } from "./stable-file-read.js";
import { DURABLE_ATOMIC_FILE_MAXIMUM_BYTES, } from "./durable-atomic-file-write-contract.js";
/**
 * Wakeflow Foundation / Filesystem：自描述原子暂存文件的有界崩溃恢复。
 *
 * 恢复流程只退休职责所有者已经确认不再活动的保留暂存文件。单链接暂存文件始终是
 * 非权威候选资源，可以精确回滚；创建操作留下的双链接暂存文件必须与名称绑定的同级
 * 目标构成同一 inode、同一快照、同一摘要和权限位的完整发布结果。恢复流程先确认
 * 目标持久性，再退休暂存文件。职责所有者仍在活动或状态未知时，只报告而不删除。
 */
export const DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_ENTRIES = 100_000;
export const DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_TARGET_SCOPE = 1_024;
const ERROR_MESSAGES = {
    "input": "Durable atomic file stage recovery input is invalid.",
    "root-scope": "Atomic file stage recovery lost its rooted scope.",
    "directory": "Atomic file stage recovery parent directory is unavailable.",
    "capacity": "Atomic file stage recovery inventory exceeds its bounded capacity.",
    "inventory": "Atomic file stage recovery found an invalid reserved stage name.",
    "node-policy": "Atomic file stage recovery found an unsafe stage node.",
    "target-scope": "Atomic file stage recovery found a stage outside its admitted targets.",
    "target-conflict": "Atomic file stage recovery cannot prove its published target.",
    "busy": "Atomic file stage recovery inventory changed during observation.",
    "cleanup-required": "Atomic file stage recovery could not retire an exact stage.",
    "aborted": "Atomic file stage recovery was aborted before its next mutation.",
    "operation-failure": "Atomic file stage recovery failed.",
};
export class DurableAtomicFileStageRecoveryError extends Error {
    name = "DurableAtomicFileStageRecoveryError";
    code = "wakeflow-durable-atomic-file-stage-recovery";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new DurableAtomicFileStageRecoveryError(reason, path);
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
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal")
        || (record.signal !== undefined
            && (typeof record.signal !== "object"
                || record.signal === null
                || types.isProxy(record.signal)
                || !(record.signal instanceof AbortSignal)))) {
        fail("input", "$options");
    }
    return Object.freeze({ signal: record.signal });
}
function assertCurrentOwner(node, path) {
    if (typeof process.geteuid === "function"
        && node.userId !== BigInt(process.geteuid())) {
        fail("node-policy", path);
    }
}
function assertStageNode(stage, index) {
    const { address, entry } = stage;
    if (entry.node.kind !== "file"
        || entry.node.byteCount > DURABLE_ATOMIC_FILE_MAXIMUM_BYTES
        || (entry.node.permissionBits !== 0o600
            && entry.node.permissionBits !== address.mode)
        || (entry.node.linkCount !== 1n && entry.node.linkCount !== 2n)
        || (address.operation === "replace" && entry.node.linkCount !== 1n)) {
        fail("node-policy", `$stages/${index}`);
    }
    assertCurrentOwner(entry.node, `$stages/${index}`);
}
function parseDirectoryRef(value) {
    if (value === null)
        return null;
    try {
        return parsePortableResourcePath(value, "$directoryResourcePath");
    }
    catch (error) {
        if (error instanceof PortableResourcePathError) {
            fail("input", "$directoryResourcePath");
        }
        throw error;
    }
}
function parentDirectoryRef(resourcePath) {
    const segments = splitPortableResourcePath(resourcePath);
    return segments.length === 1
        ? null
        : parsePortableResourcePath(segments.slice(0, -1).join("/"));
}
function parseTargetScope(value) {
    let values;
    try {
        values = parseDenseArray(value, DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_TARGET_SCOPE, "$targetResourcePaths");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            fail("input", "$targetResourcePaths");
        }
        throw error;
    }
    if (values.length === 0)
        fail("input", "$targetResourcePaths");
    const paths = [];
    const seen = new Set();
    const targetDigests = new Set();
    for (const [index, value] of values.entries()) {
        let resourcePath;
        try {
            resourcePath = parsePortableResourcePath(value, `$targetResourcePaths/${index}`);
        }
        catch (error) {
            if (error instanceof PortableResourcePathError) {
                fail("input", `$targetResourcePaths/${index}`);
            }
            throw error;
        }
        if (seen.has(resourcePath)) {
            fail("input", `$targetResourcePaths/${index}`);
        }
        seen.add(resourcePath);
        paths.push(resourcePath);
        try {
            targetDigests.add(computeDurableAtomicFileStageTargetDigest(resourcePath));
        }
        catch (error) {
            if (error instanceof DurableAtomicFileStageAddressError) {
                fail("input", `$targetResourcePaths/${index}`);
            }
            throw error;
        }
    }
    const directoryResourcePath = parentDirectoryRef(paths[0]);
    if (paths.some((path) => parentDirectoryRef(path) !== directoryResourcePath)) {
        fail("input", "$targetResourcePaths");
    }
    return Object.freeze({
        directoryResourcePath,
        targetDigests,
    });
}
async function readDirectory(root, directoryResourcePath, signal) {
    try {
        const options = {
            maximumEntries: DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_ENTRIES,
            ...(signal === undefined ? {} : { signal }),
        };
        return directoryResourcePath === null
            ? await readStableRootDirectory(root, options)
            : await readStableResourceDirectory(root, directoryResourcePath, options);
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "too-many-entries")
                fail("capacity", "$directory");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            if (error.reason === "source-changed")
                fail("busy", "$directory");
            if (error.reason === "not-found"
                || error.reason === "symlink"
                || error.reason === "not-directory") {
                fail("directory", "$directory");
            }
            fail("operation-failure", "$directory");
        }
        throw error;
    }
}
function collectStages(directory) {
    const stages = [];
    for (const [index, entry] of directory.entries.entries()) {
        if (!hasDurableAtomicFileStagePrefix(entry.name))
            continue;
        let address;
        try {
            address = parseDurableAtomicFileStageFileName(entry.name);
        }
        catch (error) {
            if (error instanceof DurableAtomicFileStageAddressError) {
                fail("inventory", `$stages/${index}`);
            }
            throw error;
        }
        const stage = Object.freeze({ address, entry });
        assertStageNode(stage, index);
        stages.push(stage);
    }
    return Object.freeze(stages);
}
function indexTargetsByDigest(directory) {
    const targets = new Map();
    for (const entry of directory.entries) {
        if (hasDurableAtomicFileStagePrefix(entry.name))
            continue;
        const digest = computeDurableAtomicFileStageTargetDigest(entry.resourcePath);
        const matches = targets.get(digest);
        if (matches === undefined)
            targets.set(digest, [entry]);
        else
            matches.push(entry);
    }
    return targets;
}
function targetForStage(targetsByDigest, stage) {
    const matches = targetsByDigest.get(stage.address.targetResourcePathDigest);
    const target = matches?.[0];
    if (matches?.length !== 1 || target === undefined) {
        fail("target-conflict", "$target");
    }
    return target;
}
async function assertPublishedTarget(root, stage, target, signal) {
    if (target.node.kind !== "file"
        || target.node.permissionBits !== stage.address.mode
        || target.node.linkCount !== 2n
        || !sameFileNodeIdentity(stage.entry.node, target.node)
        || !sameFileNodeSnapshot(stage.entry.node, target.node)) {
        fail("target-conflict", "$target");
    }
    assertCurrentOwner(target.node, "$target");
    let read;
    try {
        read = await readStableFileDigest(root, target.resourcePath, {
            maximumBytes: DURABLE_ATOMIC_FILE_MAXIMUM_BYTES,
            expectedNode: target.node,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("target-conflict", "$target");
        }
        throw error;
    }
    if (read.digest !== stage.address.inputDigest) {
        fail("target-conflict", "$target");
    }
    try {
        await settleRegularFileDurability(root, target.resourcePath, {
            expectedNode: read.node,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableRegularFileSettlementError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("target-conflict", "$target");
        }
        throw error;
    }
}
async function retireStage(root, stage, signal) {
    try {
        await unlinkRegularFileExactly(root, stage.entry.resourcePath, {
            expectedNode: stage.entry.node,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof ExactRegularFileUnlinkError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("cleanup-required", "$stage");
        }
        throw error;
    }
}
async function recoverDirectoryStages(root, directoryResourcePath, signal, targetDigests, foreignStagePolicy) {
    const directory = await readDirectory(root, directoryResourcePath, signal);
    const observedStages = collectStages(directory);
    if (targetDigests !== null
        && foreignStagePolicy === "reject"
        && observedStages.some((stage) => (!targetDigests.has(stage.address.targetResourcePathDigest)))) {
        fail("target-scope", "$stages");
    }
    const stages = targetDigests === null
        ? observedStages
        : observedStages.filter((stage) => (targetDigests.has(stage.address.targetResourcePathDigest)));
    const targetsByDigest = stages.some((stage) => (stage.entry.node.linkCount === 2n))
        ? indexTargetsByDigest(directory)
        : null;
    let retiredStageCount = 0;
    let settledTargetCount = 0;
    let activeStageCount = 0;
    let unknownStageCount = 0;
    for (const stage of stages) {
        const ownerState = readDurableAtomicFileStageOwnerState(stage.address);
        if (ownerState === "active") {
            activeStageCount += 1;
            continue;
        }
        if (ownerState === "unknown") {
            unknownStageCount += 1;
            continue;
        }
        if (stage.entry.node.linkCount === 2n) {
            if (targetsByDigest === null)
                fail("operation-failure", "$target");
            const target = targetForStage(targetsByDigest, stage);
            await assertPublishedTarget(root, stage, target, signal);
            settledTargetCount += 1;
        }
        await retireStage(root, stage, signal);
        retiredStageCount += 1;
    }
    return Object.freeze({
        observedStageCount: stages.length,
        retiredStageCount,
        settledTargetCount,
        activeStageCount,
        unknownStageCount,
    });
}
/** 清理指定父目录内所有安全且不再活动的自描述原子暂存文件。 */
export async function recoverDurableAtomicFileStagesInDirectory(root, directoryResourcePathValue, options) {
    assertRoot(root);
    const directoryResourcePath = parseDirectoryRef(directoryResourcePathValue);
    const { signal } = parseOptions(options);
    return recoverDirectoryStages(root, directoryResourcePath, signal, null, "ignore");
}
/**
 * 只在一组同父目录目标的闭合集合内恢复 stage；发现其他目标 stage 时不执行任何退休。
 */
export async function recoverDurableAtomicFileStagesForTargets(root, targetResourcePathValues, options) {
    assertRoot(root);
    const scope = parseTargetScope(targetResourcePathValues);
    const { signal } = parseOptions(options);
    return recoverDirectoryStages(root, scope.directoryResourcePath, signal, scope.targetDigests, "reject");
}
/**
 * 只恢复与目标集合匹配的 stage；同目录其他安全 stage 保持不变且不进入回执计数。
 */
export async function recoverDurableAtomicFileStagesMatchingTargets(root, targetResourcePathValues, options) {
    assertRoot(root);
    const scope = parseTargetScope(targetResourcePathValues);
    const { signal } = parseOptions(options);
    return recoverDirectoryStages(root, scope.directoryResourcePath, signal, scope.targetDigests, "ignore");
}
