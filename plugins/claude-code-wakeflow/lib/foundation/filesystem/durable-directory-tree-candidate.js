import { constants as fileSystemConstants } from "node:fs";
import { open as openFileHandle } from "node:fs/promises";
import { types } from "node:util";
import { inspectCreatedDirectoryTreeCandidate, inspectDirectoryTreeCandidate, inspectPartialDirectoryTreeCandidate, } from "./directory-tree-candidate-inspection.js";
import { assertDirectoryTreeCandidateNotAborted, DurableDirectoryTreeCandidateError, throwDirectoryTreeCandidateError as fail, joinDirectoryTreeCandidatePath, parseDirectoryTreeCandidatePath, prepareDirectoryTreeCandidate, } from "./directory-tree-candidate-plan.js";
import { createTreeCandidateDirectoryAtomically, DurableDirectoryMaterializationError, } from "./durable-directory-materialization.js";
import { createDirectoryTreeMemberFileDurably, DurableFileCandidateError, } from "./durable-file-candidate.js";
import { createFileNodeSnapshot, sameFileNodeIdentity, } from "./file-node-snapshot.js";
import { RootedDirectory } from "./rooted-directory.js";
import { RootedResourceParentHandle, RootedResourceParentHandleError, } from "./rooted-resource-parent-handle.js";
/**
 * Wakeflow Foundation / Filesystem：目录树候选的持久化创建与精确补齐入口。
 *
 * 本模块只创建尚不存在的候选目录，或补齐已由调用方证明归属的部分候选目录。
 * 相邻模块分别负责精确清单计划与稳定验证。候选目录不是权威事实；本模块不选择
 * 暂存路径或最终路径、不获取领域锁、不执行重命名，也不删除崩溃残留。
 *
 * 同步协议（根为 `fsync` 时；根为 `none` 时一次都不发出）：目录在创建时一次都不
 * 同步；每个成员文件只同步一次内容，不同步父目录、不回读字节；全部成员写完之后，
 * 树内每个目录（子目录由深到浅，候选根最后）恰好同步一次。F 个文件、D 个子目录的
 * 候选因此花 F + D + 1 次，发布的重命名再同步暂存与目标的父目录（同一个父目录时
 * 1 次，不同时 2 次）。新建的候选最后只按元数据核对清单闭合，不回读成员内容。
 *
 * 补齐路径照旧先按字节检查已有成员（恢复检查），补上缺失项之后，对已有的成员文件
 * 同步一次内容、对树内每个目录同步一次——上次中断时它们可能都还没落盘——最后再按
 * 字节做一次完整的闭合验证。
 */
function mapDirectoryError(error, target) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "target-exists") {
        fail(target === "candidate-root" ? "target-exists" : "tree-conflict", "$candidateRootPath");
    }
    if (error.reason === "target-symlink" ||
        error.reason === "target-not-directory" ||
        error.reason === "parent-symlink" ||
        error.reason === "parent-not-directory") {
        fail("tree-conflict", "$candidateRootPath");
    }
    fail("operation-failure", "$candidateRootPath", error);
}
function mapFileError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "target-exists") {
        fail("tree-conflict", "$candidateRootPath");
    }
    fail("operation-failure", "$candidateRootPath", error);
}
function mapParentHandleError(error) {
    if (error.reason === "sync-failure" || error.reason === "close-failure") {
        fail("operation-failure", "$candidate", error);
    }
    fail("source-changed", "$candidate", error);
}
/**
 * 树内每个目录与它的一个成员（相对候选根）。计划至少有一个文件，目录都由文件路径
 * 推出，所以每个目录都有成员。顺序是子目录由深到浅、候选根最后。
 */
function directoriesWithMember(plan) {
    const memberOf = (directory) => {
        const prefix = directory === "" ? "" : `${directory}/`;
        const file = plan.files.find((candidate) => candidate.path.startsWith(prefix));
        const segment = file?.path.slice(prefix.length).split("/")[0];
        if (segment === undefined || segment.length === 0)
            fail("tree-conflict", "$candidate");
        return parseDirectoryTreeCandidatePath(`${prefix}${segment}`, "$candidate/member");
    };
    const depth = (directory) => directory.split("/").length;
    const directories = [...plan.directories].sort((left, right) => depth(right) - depth(left));
    return Object.freeze([
        ...directories.map((directory) => Object.freeze([directory, memberOf(directory)])),
        Object.freeze(["", memberOf("")]),
    ]);
}
/**
 * 在全部成员写完之后，把树内每个目录同步一次。
 *
 * 目录经由它一个成员的父目录句柄同步：句柄在同步前后复验目录身份，并遵守根的
 * 持久化级别。`expected` 给出创建时记下的目录节点时，同步的必须仍是那个节点。
 */
async function syncCandidateDirectories(root, candidateRootPath, plan, expected, signal) {
    for (const [directory, member] of directoriesWithMember(plan)) {
        assertDirectoryTreeCandidateNotAborted(signal);
        let parent;
        let primaryError;
        try {
            parent = await RootedResourceParentHandle.open(root, joinDirectoryTreeCandidatePath(candidateRootPath, member), "$candidate");
            const synced = await parent.sync();
            const created = expected.get(directory);
            if (synced.kind !== "directory" ||
                (created !== undefined && !sameFileNodeIdentity(created, synced))) {
                fail("source-changed", "$candidate");
            }
        }
        catch (error) {
            primaryError = error;
        }
        if (parent !== undefined) {
            try {
                await parent.close();
            }
            catch (error) {
                primaryError ??= error;
            }
        }
        if (primaryError instanceof RootedResourceParentHandleError) {
            mapParentHandleError(primaryError);
        }
        if (primaryError !== undefined)
            throw primaryError;
    }
}
function readOnlyFileFlags() {
    const noFollow = fileSystemConstants.O_NOFOLLOW;
    if (typeof noFollow !== "number")
        fail("operation-failure", "$candidate");
    return fileSystemConstants.O_RDONLY | noFollow;
}
/**
 * 补齐时对上次已经写下的一个成员文件同步一次内容：中断可能发生在写完之后、内容
 * 同步之前，而这次补齐不会再写它。只同步，不读内容（字节已由补齐前的恢复检查核对）。
 */
async function syncExistingMemberFile(root, resourcePath) {
    let parent;
    let handle;
    let primaryError;
    try {
        parent = await RootedResourceParentHandle.open(root, resourcePath, "$candidate");
        const before = await parent.inspectTarget();
        try {
            handle = await openFileHandle(parent.resourceAbsolutePath, readOnlyFileFlags());
        }
        catch (cause) {
            fail("source-changed", "$candidate", cause);
        }
        let opened;
        try {
            opened = createFileNodeSnapshot(await handle.stat({ bigint: true }), "$candidate");
        }
        catch (cause) {
            fail("source-changed", "$candidate", cause);
        }
        if (before === null ||
            before.kind !== "file" ||
            opened.kind !== "file" ||
            !sameFileNodeIdentity(before, opened)) {
            fail("source-changed", "$candidate");
        }
        if (root.durability === "fsync") {
            try {
                await handle.sync();
            }
            catch (cause) {
                fail("operation-failure", "$candidate", cause);
            }
        }
    }
    catch (error) {
        primaryError = error;
    }
    if (handle !== undefined) {
        try {
            await handle.close();
        }
        catch (cause) {
            primaryError ??= cause;
        }
    }
    if (parent !== undefined) {
        try {
            await parent.close();
        }
        catch (error) {
            primaryError ??= error;
        }
    }
    if (primaryError === undefined)
        return;
    if (primaryError instanceof RootedResourceParentHandleError) {
        mapParentHandleError(primaryError);
    }
    if (primaryError instanceof DurableDirectoryTreeCandidateError)
        throw primaryError;
    fail("operation-failure", "$candidate", primaryError);
}
/** 在尚不存在的候选路径创建目录树，并验证其清单闭合且已采用最终权限位。 */
export async function createDirectoryTreeCandidateDurably(root, candidateRootPathValue, filesValue, optionsValue) {
    if (!(root instanceof RootedDirectory) || types.isProxy(root)) {
        fail("input", "$root");
    }
    const candidateRootPath = parseDirectoryTreeCandidatePath(candidateRootPathValue, "$candidateRootPath");
    const prepared = prepareDirectoryTreeCandidate(filesValue, optionsValue);
    const signal = prepared.options.signal;
    const signalOption = signal === undefined ? {} : { signal };
    const directoryNodes = new Map();
    try {
        const created = await createTreeCandidateDirectoryAtomically(root, candidateRootPath, {
            mode: prepared.options.directoryMode,
            ...signalOption,
        });
        directoryNodes.set("", created.node);
    }
    catch (error) {
        if (error instanceof DurableDirectoryMaterializationError) {
            mapDirectoryError(error, "candidate-root");
        }
        throw error;
    }
    const createdFiles = new Map();
    try {
        for (const directory of prepared.plan.directories) {
            const created = await createTreeCandidateDirectoryAtomically(root, joinDirectoryTreeCandidatePath(candidateRootPath, directory), { mode: prepared.options.directoryMode, ...signalOption });
            directoryNodes.set(directory, created.node);
        }
        for (const file of prepared.files) {
            const created = await createDirectoryTreeMemberFileDurably(root, joinDirectoryTreeCandidatePath(candidateRootPath, file.path), file.bytes, { mode: file.mode, ...signalOption });
            createdFiles.set(file.path, created.node);
        }
    }
    catch (error) {
        if (error instanceof DurableDirectoryMaterializationError) {
            mapDirectoryError(error, "candidate-member");
        }
        if (error instanceof DurableFileCandidateError)
            mapFileError(error);
        throw error;
    }
    await syncCandidateDirectories(root, candidateRootPath, prepared.plan, directoryNodes, signal);
    return inspectCreatedDirectoryTreeCandidate(root, candidateRootPath, prepared.plan, createdFiles, signal);
}
/**
 * 仅在归属已确认的候选根目录中补齐缺失项，随后重新验证清单闭合状态。
 * 如果存在未知节点、错误权限位、不同字节或观察漂移，函数会在新增写入前拒绝操作。
 */
export async function settleDirectoryTreeCandidateDurably(root, candidateRootPathValue, filesValue, optionsValue) {
    if (!(root instanceof RootedDirectory) || types.isProxy(root)) {
        fail("input", "$root");
    }
    const candidateRootPath = parseDirectoryTreeCandidatePath(candidateRootPathValue, "$candidateRootPath");
    const prepared = prepareDirectoryTreeCandidate(filesValue, optionsValue);
    const signal = prepared.options.signal;
    const signalOption = signal === undefined ? {} : { signal };
    const partial = await inspectPartialDirectoryTreeCandidate(root, candidateRootPath, prepared);
    try {
        for (const directory of prepared.plan.directories) {
            if (partial.existingDirectories.has(directory))
                continue;
            await createTreeCandidateDirectoryAtomically(root, joinDirectoryTreeCandidatePath(candidateRootPath, directory), { mode: prepared.options.directoryMode, ...signalOption });
        }
        for (const file of prepared.files) {
            const memberPath = joinDirectoryTreeCandidatePath(candidateRootPath, file.path);
            if (partial.existingFiles.has(file.path)) {
                assertDirectoryTreeCandidateNotAborted(signal);
                await syncExistingMemberFile(root, memberPath);
                continue;
            }
            await createDirectoryTreeMemberFileDurably(root, memberPath, file.bytes, {
                mode: file.mode,
                ...signalOption,
            });
        }
    }
    catch (error) {
        if (error instanceof DurableDirectoryMaterializationError) {
            mapDirectoryError(error, "candidate-member");
        }
        if (error instanceof DurableFileCandidateError)
            mapFileError(error);
        throw error;
    }
    await syncCandidateDirectories(root, candidateRootPath, prepared.plan, new Map(), signal);
    return inspectDirectoryTreeCandidate(root, candidateRootPath, prepared.plan, signalOption);
}
export { inspectDirectoryTreeCandidate, inspectDirectoryTreeCandidateProgress, } from "./directory-tree-candidate-inspection.js";
export { DurableDirectoryTreeCandidateError, parseDirectoryTreeCandidatePlan, planDirectoryTreeCandidate, planDirectoryTreeCandidateFromFileDescriptors, } from "./directory-tree-candidate-plan.js";
