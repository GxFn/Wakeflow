import { stat } from "node:fs/promises";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { readStrictTextFile, StrictTextFileError, } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { fail } from "../../kernel/error.js";
/**
 * 分支清单是否读全。只有仓库观察成功且没有 issue，`branches` 里的缺席才等于"分支不在仓库
 * 里"；否则缺席只说明这一轮没看见，不能据此判定分支已删除或已合并。
 */
export function repositoryBranchesComplete(observation) {
    return observation.status === "observed" && observation.issue === null;
}
const POINTER_MAXIMUM_BYTES = parseByteCount(4 * 1024, "$pointer.maximumBytes");
const PACKED_REFS_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$packedRefs.maximumBytes");
const DIRECTORY_MAXIMUM_ENTRIES = 4096;
const REFS_MAXIMUM_DEPTH = 8;
const OBJECT_ID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const SYMBOLIC_HEAD_PATTERN = /^ref: refs\/heads\/(\S+)$/u;
const PACKED_REF_PATTERN = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) refs\/heads\/(\S+)$/u;
/** 观察成功但分支清单没读全时的稳定 issue 码。 */
const BRANCHES_INCOMPLETE_ISSUE = "branches-incomplete";
const GIT_DIRECTORY_REF = parsePortableResourcePath(".git", "$repository");
const HEAD_REF = parsePortableResourcePath(".git/HEAD", "$repository");
const PACKED_REFS_REF = parsePortableResourcePath(".git/packed-refs", "$repository");
const HEADS_REF = parsePortableResourcePath(".git/refs/heads", "$repository");
const WORKTREES_REF = parsePortableResourcePath(".git/worktrees", "$repository");
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
function unavailable(repositoryId, issue) {
    return Object.freeze({
        repositoryId,
        status: "unavailable",
        issue,
        head: null,
        branch: null,
        detached: false,
        branches: Object.freeze([]),
        worktrees: Object.freeze([]),
    });
}
function rethrowAbort(error) {
    if ((error instanceof StableFileReadError || error instanceof StableDirectoryReadError) &&
        error.reason === "aborted") {
        fail("io-failure", "aborted", "$signal");
    }
}
/** 读一个指针文件的正文（去掉末尾换行），并区分"不存在"与"读不出"。 */
async function readPointer(root, ref, maximumBytes, signal) {
    try {
        const read = await readStrictTextFile(root, ref, { maximumBytes, ...signalOptions(signal) });
        return Object.freeze({ text: read.text.replace(/\n$/u, ""), outcome: "read" });
    }
    catch (error) {
        rethrowAbort(error);
        if (error instanceof StableFileReadError) {
            const outcome = error.reason === "not-found" ? "missing" : "unreadable";
            return Object.freeze({ text: null, outcome });
        }
        if (error instanceof StrictTextFileError) {
            return Object.freeze({ text: null, outcome: "malformed" });
        }
        throw error;
    }
}
/** 读一个指针文件的正文；读不出返回 null（不关心是不存在还是读不出的调用方用这个）。 */
async function pointerText(root, ref, maximumBytes, signal) {
    return (await readPointer(root, ref, maximumBytes, signal)).text;
}
async function directoryEntries(root, ref, signal) {
    try {
        const listing = await readStableResourceDirectory(root, ref, {
            maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
            ...signalOptions(signal),
        });
        return Object.freeze({
            entries: listing.entries.map((entry) => Object.freeze({ name: entry.name, resourcePath: entry.resourcePath, kind: entry.node.kind })),
            unreadable: false,
        });
    }
    catch (error) {
        rethrowAbort(error);
        if (error instanceof StableDirectoryReadError) {
            return Object.freeze({ entries: null, unreadable: error.reason !== "not-found" });
        }
        throw error;
    }
}
/**
 * 一个松散引用文件：读得出且正文是对象 id 才记为分支尖端。正文不是对象 id（符号引用、锁文件
 * 之外的杂项文件）与严格文本失败一样只是"不是引用文件"，跳过即可；真正打不开才让清单不全。
 */
async function collectLooseRef(root, entry, name, into, signal) {
    const read = await readPointer(root, entry.resourcePath, POINTER_MAXIMUM_BYTES, signal);
    if (read.outcome === "unreadable")
        return false;
    if (read.text !== null && OBJECT_ID_PATTERN.test(read.text))
        into.set(name, read.text);
    return true;
}
/** 收集松散分支；返回这棵子树是否读全（目录列不出、深度截断、引用文件读不出都算没读全）。 */
async function collectLooseBranches(root, directory, prefix, depth, into, signal) {
    if (depth > REFS_MAXIMUM_DEPTH)
        return false;
    const listing = await directoryEntries(root, directory, signal);
    if (listing.entries === null)
        return !listing.unreadable;
    let complete = true;
    for (const entry of listing.entries) {
        const name = `${prefix}${entry.name}`;
        if (entry.kind === "directory") {
            const subtree = await collectLooseBranches(root, entry.resourcePath, `${name}/`, depth + 1, into, signal);
            if (!subtree)
                complete = false;
            continue;
        }
        if (entry.kind !== "file")
            continue;
        if (!(await collectLooseRef(root, entry, name, into, signal)))
            complete = false;
    }
    return complete;
}
/** 收集打包分支；返回是否读全。packed-refs 是唯一来源，不存在才算读全，读不出与不是严格文本都不算。 */
async function collectPackedBranches(root, into, signal) {
    const read = await readPointer(root, PACKED_REFS_REF, PACKED_REFS_MAXIMUM_BYTES, signal);
    if (read.text === null)
        return read.outcome === "missing";
    for (const line of read.text.split("\n")) {
        const match = PACKED_REF_PATTERN.exec(line);
        if (match?.[1] !== undefined && match[2] !== undefined && !into.has(match[2])) {
            into.set(match[2], match[1]);
        }
    }
    return true;
}
function resolveHead(text, branches) {
    const symbolic = SYMBOLIC_HEAD_PATTERN.exec(text);
    if (symbolic?.[1] !== undefined) {
        return Object.freeze({
            head: branches.get(symbolic[1]) ?? null,
            branch: symbolic[1],
            detached: false,
        });
    }
    return Object.freeze({
        head: OBJECT_ID_PATTERN.test(text) ? text : null,
        branch: null,
        detached: true,
    });
}
async function checkoutPresent(gitdirText) {
    if (gitdirText === null)
        return false;
    try {
        return (await stat(gitdirText)).isFile();
    }
    catch {
        return false;
    }
}
async function collectWorktrees(root, branches, signal) {
    const listing = await directoryEntries(root, WORKTREES_REF, signal);
    if (listing.entries === null)
        return Object.freeze([]);
    const worktrees = [];
    for (const entry of listing.entries) {
        if (entry.kind !== "directory")
            continue;
        const gitdir = await pointerText(root, parsePortableResourcePath(`${entry.resourcePath}/gitdir`, "$repository"), POINTER_MAXIMUM_BYTES, signal);
        const head = await pointerText(root, parsePortableResourcePath(`${entry.resourcePath}/HEAD`, "$repository"), POINTER_MAXIMUM_BYTES, signal);
        const resolved = head === null ? null : resolveHead(head, branches);
        worktrees.push(Object.freeze({
            name: entry.name,
            head: resolved?.head ?? null,
            branch: resolved?.branch ?? null,
            prunable: !(await checkoutPresent(gitdir)),
        }));
    }
    return Object.freeze(worktrees.sort((left, right) => left.name.localeCompare(right.name)));
}
async function observeOpened(repositoryId, root, signal) {
    try {
        const git = await root.inspectExistingResource(GIT_DIRECTORY_REF, "$repository");
        if (git.node.kind !== "directory")
            return unavailable(repositoryId, "root-is-worktree");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            return unavailable(repositoryId, "git-directory-missing");
        throw error;
    }
    const headText = await pointerText(root, HEAD_REF, POINTER_MAXIMUM_BYTES, signal);
    if (headText === null)
        return unavailable(repositoryId, "head-unreadable");
    const branchTips = new Map();
    const looseComplete = await collectLooseBranches(root, HEADS_REF, "", 0, branchTips, signal);
    const packedComplete = await collectPackedBranches(root, branchTips, signal);
    const head = resolveHead(headText, branchTips);
    const branches = Object.freeze([...branchTips.entries()]
        .map(([name, tip]) => Object.freeze({ name, tip }))
        .sort((left, right) => left.name.localeCompare(right.name)));
    return Object.freeze({
        repositoryId,
        status: "observed",
        // 读不全的分支清单必须说出来：否则"分支不在 branches 里"会被下游当成分支已删除。
        issue: looseComplete && packedComplete ? null : BRANCHES_INCOMPLETE_ISSUE,
        ...head,
        branches,
        worktrees: await collectWorktrees(root, branchTips, signal),
    });
}
/** 观察一个配置仓库的主检出指针文件；打开失败即 `unavailable`。 */
export async function observeRepositoryPointers(input) {
    let root;
    try {
        root = await RootedDirectory.open(input.absolutePath, "$repository");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            return unavailable(input.repositoryId, "root-open");
        throw error;
    }
    try {
        return await observeOpened(input.repositoryId, root, input.signal);
    }
    finally {
        await root.close();
    }
}
