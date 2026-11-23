import { computeDurableAtomicFileStageTargetDigest, DurableAtomicFileStageAddressError, hasDurableAtomicFileStagePrefix, parseDurableAtomicFileStageFileName, readDurableAtomicFileStageOwnerState, } from "../../../foundation/filesystem/durable-atomic-file-stage-address.js";
import { DurableAtomicFileStageRecoveryError, recoverDurableAtomicFileStagesInDirectory, } from "../../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { DURABLE_ATOMIC_FILE_MAXIMUM_BYTES } from "../../../foundation/filesystem/durable-atomic-file-write-contract.js";
import { ExactRegularFileUnlinkError, unlinkRegularFileExactly, } from "../../../foundation/filesystem/exact-regular-file-unlink.js";
import { sameFileNodeIdentity, } from "../../../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectoryError, } from "../../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../../foundation/filesystem/stable-directory-read.js";
import { readStableFileDigest, StableFileReadError, } from "../../../foundation/filesystem/stable-file-read.js";
import { ownedByAnotherUser } from "../../../foundation/node/current-user.js";
import { TASK_PACKAGE_PROJECTIONS_ROOT_REF } from "../../tasking/task-package-projection-paths.js";
import { DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF, DEMAND_EVENT_STREAM_INDEX_ROOT_REF, } from "./demand-event-sourcing-paths.js";
/** 分类失败：`index` 是出问题的那一条在目录读取结果里的位置。 */
export class DemandStageDirectoryError extends Error {
    name = "DemandStageDirectoryError";
    reason;
    index;
    constructor(reason, index, cause) {
        super("Demand stage directory holds an entry that is not a member or provable stage residue.", cause === undefined ? undefined : { cause });
        this.reason = reason;
        this.index = index;
    }
}
function refuse(reason, index, cause) {
    throw new DemandStageDirectoryError(reason, index, cause);
}
function privateFile(node, fileMode) {
    return (node.kind === "file" && node.permissionBits === fileMode && !ownedByAnotherUser(node.userId));
}
function classifyStage(entry, index, fileMode) {
    let address;
    try {
        address = parseDurableAtomicFileStageFileName(entry.name);
    }
    catch (error) {
        if (error instanceof DurableAtomicFileStageAddressError)
            refuse("tree-shape", index, error);
        throw error;
    }
    const links = entry.node.linkCount;
    const linksAllowed = links === 1n || (links === 2n && address.operation === "create");
    if (!privateFile(entry.node, fileMode) || !linksAllowed)
        refuse("node-policy", index);
    const owner = readDurableAtomicFileStageOwnerState(address, entry.node);
    // 写者还活着：一次写入正在落盘，稍后重来；所有者判断不出来的不放行。
    if (owner === "active")
        refuse("source-changed", index);
    if (owner === "unknown")
        refuse("tree-shape", index);
    return { entry, index, address, member: null };
}
/** 这个两链接的成员是哪一个死暂存的目标：同一个节点、暂存名里记的就是这条路径与这个模式。 */
function pairedStage(member, residue) {
    const targetDigest = computeDurableAtomicFileStageTargetDigest(member.resourcePath);
    const matches = residue.filter((stage) => stage.address.operation === "create" &&
        stage.entry.node.linkCount === 2n &&
        sameFileNodeIdentity(stage.entry.node, member.node) &&
        stage.address.targetResourcePathDigest === targetDigest &&
        stage.address.mode === member.node.permissionBits);
    const [only] = matches;
    return matches.length === 1 && only !== undefined ? only : null;
}
/**
 * 把一个目录的条目分成成员与死暂存；不认识的形状抛 `DemandStageDirectoryError`。规则：
 * - 暂存文件：名字要解析得出；节点是本用户的私有普通文件，一个链接，`create` 的可以是两个；写者活着
 *   是 `source-changed`，判断不出是 `tree-shape`。
 * - 成员：一个链接的照旧；两个链接的只在恰好有一个死的 `create` 暂存与它同节点、暂存名里的目标摘要
 *   与模式都对得上时放行。
 * - 两个链接的暂存在本目录里找不到它的成员，是 `node-policy`。
 * `entries` 的路径相对 Demand 根：写者与清点用的是同一个根，暂存名里的目标摘要才对得上。
 */
export function classifyDemandStageDirectory(entries, fileMode) {
    const residue = [];
    const members = [];
    entries.forEach((entry, index) => {
        if (hasDurableAtomicFileStagePrefix(entry.name)) {
            residue.push(classifyStage(entry, index, fileMode));
        }
        else {
            members.push({ entry, index });
        }
    });
    for (const { entry, index } of members) {
        if (!privateFile(entry.node, fileMode))
            refuse("node-policy", index);
        if (entry.node.linkCount === 1n)
            continue;
        const stage = entry.node.linkCount === 2n ? pairedStage(entry, residue) : null;
        if (stage === null || stage.member !== null)
            refuse("node-policy", index);
        stage.member = entry;
    }
    for (const stage of residue) {
        if (stage.entry.node.linkCount === 2n && stage.member === null) {
            refuse("node-policy", stage.index);
        }
    }
    return Object.freeze({
        members: Object.freeze(members.map(({ entry }) => entry)),
        residue: Object.freeze(residue.map(({ entry, address, member }) => Object.freeze({ entry, address, member }))),
    });
}
// ---- reconcile：盘点与清除 ----------------------------------------------------
const CACHE_DIRECTORY_REFS = Object.freeze([
    DEMAND_EVENT_STREAM_INDEX_ROOT_REF,
    DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
]);
const STAGE_DIRECTORY_REFS = Object.freeze([
    ...CACHE_DIRECTORY_REFS,
    TASK_PACKAGE_PROJECTIONS_ROOT_REF,
]);
const DIRECTORY_MAXIMUM_ENTRIES = 16_384;
export class DemandStageResidueError extends Error {
    name = "DemandStageResidueError";
    reason;
    constructor(reason, cause) {
        super("Demand stage residue could not be inspected or retired.", cause === undefined ? undefined : { cause });
        this.reason = reason;
    }
}
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
/** 目录的条目；目录不在是空。 */
async function entriesOf(root, directory, signal) {
    try {
        const listing = await readStableResourceDirectory(root, directory, {
            maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
            ...signalOptions(signal),
        });
        return listing.entries;
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError) {
            if (error.reason === "not-found")
                return [];
            if (error.reason === "aborted")
                throw new DemandStageResidueError("aborted", error);
            throw new DemandStageResidueError(error.reason === "source-changed" ? "busy" : "directory", error);
        }
        throw error;
    }
}
function ownerOf(entry) {
    try {
        return readDurableAtomicFileStageOwnerState(parseDurableAtomicFileStageFileName(entry.name), entry.node);
    }
    catch (error) {
        if (error instanceof DurableAtomicFileStageAddressError)
            return "unknown";
        throw error;
    }
}
/** `task-packages/` 里成对的目标：内容的摘要就是暂存名里记的那一个（目录级恢复清它之前核对的同一件事）。 */
async function pairedTargetsPublished(root, residue, signal) {
    for (const stage of residue) {
        if (stage.member === null)
            continue;
        try {
            const read = await readStableFileDigest(root, stage.member.resourcePath, {
                maximumBytes: DURABLE_ATOMIC_FILE_MAXIMUM_BYTES,
                expectedNode: stage.member.node,
                ...signalOptions(signal),
            });
            if (read.digest !== stage.address.inputDigest)
                return false;
        }
        catch (error) {
            if (!(error instanceof StableFileReadError))
                throw error;
            if (error.reason === "aborted")
                throw new DemandStageResidueError("aborted", error);
            return false;
        }
    }
    return true;
}
const NOTHING_TO_RETIRE = Object.freeze({
    entries: Object.freeze([]),
    busy: false,
    retirable: true,
});
/** 一个目录里带暂存前缀的文件、各自写者的死活，以及这个目录的残留清不清得掉。 */
async function inspectDirectoryResidue(root, directory, fileMode, signal) {
    let listed;
    try {
        listed = await entriesOf(root, directory, signal);
    }
    catch (error) {
        if (!(error instanceof DemandStageResidueError) || error.reason === "aborted")
            throw error;
        // 读的时候目录正在变：稍后再看。目录自己不对（符号链接、不是目录、条目太多）：不归这里清。
        return { ...NOTHING_TO_RETIRE, busy: error.reason === "busy", retirable: false };
    }
    const entries = listed
        .filter((entry) => hasDurableAtomicFileStagePrefix(entry.name))
        .map((entry) => Object.freeze({ ref: entry.resourcePath, node: entry.node, owner: ownerOf(entry) }));
    if (entries.some((entry) => entry.owner !== "inactive")) {
        return { entries, busy: false, retirable: false };
    }
    // 没有暂存的目录也照分类规则过一遍：清除那一半对三个目录都这样做，成员自己不对（比如多出一个
    // 链接）它就不动手。
    let classified;
    try {
        classified = classifyDemandStageDirectory(listed, fileMode);
    }
    catch (error) {
        if (!(error instanceof DemandStageDirectoryError))
            throw error;
        return { entries, busy: error.reason === "source-changed", retirable: false };
    }
    const published = directory !== TASK_PACKAGE_PROJECTIONS_ROOT_REF ||
        (await pairedTargetsPublished(root, classified.residue, signal));
    return { entries, busy: false, retirable: published };
}
/**
 * 三个目录里带暂存前缀的文件、各自写者的死活，以及清除那一半做不做得成；只读。`fileMode` 是这些目录
 * 里私有文件的权限位。
 */
export async function inspectDemandStageResidue(root, fileMode, options = {}) {
    const entries = [];
    let busyDirectories = 0;
    let retirable = true;
    for (const directory of STAGE_DIRECTORY_REFS) {
        const inspected = await inspectDirectoryResidue(root, directory, fileMode, options.signal);
        entries.push(...inspected.entries);
        if (inspected.busy)
            busyDirectories += 1;
        if (!inspected.retirable)
            retirable = false;
    }
    return Object.freeze({
        entries: Object.freeze(entries),
        activeCount: entries.filter((entry) => entry.owner === "active").length + busyDirectories,
        unknownCount: entries.filter((entry) => entry.owner === "unknown").length,
        retirable,
    });
}
async function unlinkExactly(root, ref, expectedNode, signal) {
    try {
        await unlinkRegularFileExactly(root, ref, { expectedNode, ...signalOptions(signal) });
    }
    catch (error) {
        if (error instanceof ExactRegularFileUnlinkError) {
            throw new DemandStageResidueError(error.reason === "aborted" ? "aborted" : "cleanup-required", error);
        }
        throw error;
    }
}
/** 成对的目标先删；它删掉之后暂存只剩一个链接，节点要重新看一次才对得上。 */
async function stageNodeAfterMemberUnlink(root, stage) {
    try {
        const current = (await root.inspectExistingResource(stage.entry.resourcePath, "$stage")).node;
        if (!sameFileNodeIdentity(current, stage.entry.node) || current.linkCount !== 1n) {
            throw new DemandStageResidueError("cleanup-required");
        }
        return current;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            throw new DemandStageResidueError("cleanup-required", error);
        }
        throw error;
    }
}
/**
 * 清掉一个缓存目录里的死暂存：成对的连目标一起删，不读内容。每一次删除都照常同步目录（这条路只在
 * reconcile 与创建的重入上走，不为它另开一档）；中途被杀留下的仍是这里认得的形状。写者活着或形状不
 * 认识时抛 `cleanup-required`，什么都不删。
 */
async function retireCacheStageResidue(root, directory, fileMode, signal) {
    let classified;
    try {
        classified = classifyDemandStageDirectory(await entriesOf(root, directory, signal), fileMode);
    }
    catch (error) {
        if (error instanceof DemandStageDirectoryError) {
            throw new DemandStageResidueError("cleanup-required", error);
        }
        throw error;
    }
    for (const stage of classified.residue) {
        let stageNode = stage.entry.node;
        if (stage.member !== null) {
            await unlinkExactly(root, stage.member.resourcePath, stage.member.node, signal);
            stageNode = await stageNodeAfterMemberUnlink(root, stage);
        }
        await unlinkExactly(root, stage.entry.resourcePath, stageNode, signal);
    }
    return classified.residue.length;
}
/** `task-packages/` 的文件进归档：走目录级恢复，核对成对的目标确实是发布出去的那一份，再退役暂存。 */
async function retireTaskPackageStageResidue(root, signal) {
    if ((await entriesOf(root, TASK_PACKAGE_PROJECTIONS_ROOT_REF, signal)).length === 0)
        return 0;
    try {
        const receipt = await recoverDurableAtomicFileStagesInDirectory(root, TASK_PACKAGE_PROJECTIONS_ROOT_REF, signalOptions(signal));
        if (receipt.activeStageCount > 0 || receipt.unknownStageCount > 0) {
            throw new DemandStageResidueError("cleanup-required");
        }
        return receipt.retiredStageCount;
    }
    catch (error) {
        if (error instanceof DurableAtomicFileStageRecoveryError) {
            throw new DemandStageResidueError(error.reason === "aborted" ? "aborted" : "cleanup-required", error);
        }
        throw error;
    }
}
/**
 * 只清两个缓存目录（`index/`、`snapshots/`）里的死暂存，返回清掉的个数。发布一个新 Demand 的暂存根在
 * 重入时用它：上一次被杀的创建留在这两个目录里的残留连目标一起丢掉，后面的步骤会重新写出来。
 */
export async function retireDemandCacheStageResidue(root, fileMode, options = {}) {
    let retired = 0;
    for (const directory of CACHE_DIRECTORY_REFS) {
        retired += await retireCacheStageResidue(root, directory, fileMode, options.signal);
    }
    return retired;
}
/** 清掉三个目录里的死暂存，返回清掉的暂存个数。调用方持有这个 Demand 的发布锁。 */
export async function retireDemandStageResidue(root, fileMode, options = {}) {
    const retired = await retireDemandCacheStageResidue(root, fileMode, options);
    return retired + (await retireTaskPackageStageResidue(root, options.signal));
}
