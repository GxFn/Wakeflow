import { constants as fileSystemConstants } from "node:fs";
import { lstat, opendir, open as openFileHandle, realpath, } from "node:fs/promises";
import nodePath from "node:path";
import { decodeUtf8, encodeUtf8 } from "../foundation/text/utf8.js";
import { hostRuntimeRootRef, WAKEFLOW_CONFIG_KIND, WAKEFLOW_CONFIG_SCHEMA_VERSION, } from "../kernel/layout.js";
const WAKEFLOW_CONFIG_FILE_NAME = "wakeflow.config.json";
const GIT_ENTRY_NAME = ".git";
const GITDIR_POINTER_PREFIX = "gitdir: ";
const CONFIG_MAXIMUM_BYTES = 1024 * 1024;
const BINDING_MAXIMUM_BYTES = 64 * 1024;
const GITDIR_POINTER_MAXIMUM_BYTES = 4096;
const ANCESTOR_LEVELS = 8;
const GIT_WALK_MAXIMUM_LEVELS = 64;
/**
 * 列举的上限约束的是列举之后要做的事：每个候选子目录一次 stat、每条绑定一次有界读取。上限只
 * 截断收集，不作废已经收集到的名字——一个大目录里的工作区必须仍然可见（D2 b 的"每目录至多列
 * 1,024 项"取的是这份有界代价，不是"超限即全部丢弃"）。`LISTING_MAXIMUM_ENTRIES` 再给条目流
 * 本身一个硬顶，让病态目录（十万个文件、没有子目录）也不能把单次 hook 拖出 D4 的时间预算。
 */
const CHILD_LISTING_MAXIMUM_NAMES = 1024;
const BINDINGS_LISTING_MAXIMUM_NAMES = 4096;
const LISTING_MAXIMUM_ENTRIES = 65_536;
const BINDINGS_DIRECTORY_SEGMENTS = ["identity", "window-bindings"];
const READ_FLAGS = fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW;
export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stdinBytes(stdin) {
    if (stdin instanceof Uint8Array)
        return stdin;
    if (typeof stdin !== "string")
        return null;
    try {
        return encodeUtf8(stdin, "$stdin");
    }
    catch {
        return null;
    }
}
/** stdin 是一个宿主 hook JSON 对象：超限先于解析判定，不是合法 UTF-8、不是 JSON 或不是对象即 stdin-invalid。 */
export function parseHookStdinObject(stdin, maximumBytes) {
    const bytes = stdinBytes(stdin);
    if (bytes === null)
        return Object.freeze({ ok: false, code: "stdin-invalid" });
    if (bytes.byteLength > maximumBytes) {
        return Object.freeze({ ok: false, code: "stdin-too-large" });
    }
    try {
        const value = JSON.parse(decodeUtf8(bytes, "$stdin"));
        if (isRecord(value))
            return Object.freeze({ ok: true, value });
    }
    catch {
        // 落到下面的 stdin-invalid。
    }
    return Object.freeze({ ok: false, code: "stdin-invalid" });
}
async function nodeKind(target) {
    try {
        const stats = await lstat(target);
        if (stats.isDirectory())
            return "directory";
        return stats.isFile() ? "file" : "other";
    }
    catch {
        return null;
    }
}
export async function realpathOrNull(target) {
    try {
        return await realpath(target);
    }
    catch {
        return null;
    }
}
async function closeQuietly(handle) {
    if (handle === null)
        return;
    try {
        await handle.close();
    }
    catch {
        // 诊断读取已经结束；关闭失败不改变结果。
    }
}
/** 读满 `size` 字节；提前 EOF 时交回实际读到的字节数，调用方据此判定文件是否变了。 */
async function readExactly(handle, size) {
    const bytes = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
        const { bytesRead } = await handle.read(bytes, offset, size - offset, null);
        if (bytesRead === 0)
            break;
        offset += bytesRead;
    }
    return [bytes, offset];
}
/**
 * 与状态栏资产（`claude-code-statusline-asset.ts` 的 `readBoundedJson`）同一做法：O_NOFOLLOW 打开、
 * 按打开时的大小预分配并恰好读这么多字节（上限在分配之前判定，不读到 EOF）、事后 lstat 复核
 * inode 与大小。
 */
async function readBoundedBytes(file, maximumBytes) {
    let handle = null;
    try {
        handle = await openFileHandle(file, READ_FLAGS);
        const opened = await handle.stat();
        if (!opened.isFile() || opened.size > maximumBytes)
            return null;
        const [bytes, read] = await readExactly(handle, opened.size);
        const after = await lstat(file);
        if (read !== opened.size || after.ino !== opened.ino || after.size !== opened.size) {
            return null;
        }
        return bytes;
    }
    catch {
        return null;
    }
    finally {
        await closeQuietly(handle);
    }
}
async function readBoundedJson(file, maximumBytes) {
    const bytes = await readBoundedBytes(file, maximumBytes);
    if (bytes === null)
        return null;
    try {
        return JSON.parse(decodeUtf8(bytes, "$file"));
    }
    catch {
        return null;
    }
}
/** 到上限就停止收集并交回已有的名字；目录不可读或中途失败同样只交回已经收到的部分。 */
async function listEntryNames(directory, maximumNames, accept) {
    const names = [];
    try {
        let observed = 0;
        for await (const entry of await opendir(directory)) {
            observed += 1;
            if (accept(entry))
                names.push(entry.name);
            if (names.length >= maximumNames || observed >= LISTING_MAXIMUM_ENTRIES)
                break;
        }
    }
    catch {
        // 打开失败、条目流中途出错或目录被换掉：已经收到的名字仍然是有效候选。
    }
    return names.sort();
}
// ---- 工作区定位（D2）------------------------------------------------------------
/** 只读 `gitdir: <主仓库>/.git/worktrees/<name>` 指针文件，不 spawn git；相对指针按检出目录解析。 */
async function mainRepositoryFromPointer(checkout) {
    const bytes = await readBoundedBytes(nodePath.join(checkout, GIT_ENTRY_NAME), GITDIR_POINTER_MAXIMUM_BYTES);
    if (bytes === null)
        return null;
    let text;
    try {
        text = decodeUtf8(bytes, "$gitdir");
    }
    catch {
        return null;
    }
    if (!text.startsWith(GITDIR_POINTER_PREFIX))
        return null;
    const target = (text.slice(GITDIR_POINTER_PREFIX.length).split("\n", 1)[0] ?? "").trim();
    if (target.length === 0)
        return null;
    const pointer = nodePath.resolve(checkout, target);
    const worktrees = nodePath.dirname(pointer);
    const gitDirectory = nodePath.dirname(worktrees);
    if (nodePath.basename(worktrees) !== "worktrees" ||
        nodePath.basename(gitDirectory) !== GIT_ENTRY_NAME) {
        return null;
    }
    return realpathOrNull(nodePath.dirname(gitDirectory));
}
/** 从主体向上找最近的 `.git`：是指针文件才产生主仓库锚点，是目录或其他节点即结束。 */
async function worktreeMainRepository(start) {
    let directory = start;
    for (let level = 0; level < GIT_WALK_MAXIMUM_LEVELS; level += 1) {
        const kind = await nodeKind(nodePath.join(directory, GIT_ENTRY_NAME));
        if (kind === "file")
            return mainRepositoryFromPointer(directory);
        if (kind !== null)
            return null;
        const parent = nodePath.dirname(directory);
        if (parent === directory)
            return null;
        directory = parent;
    }
    return null;
}
export async function resolveSubject(cwd, env) {
    const projectDirectory = env.CLAUDE_PROJECT_DIR;
    const fallback = typeof projectDirectory === "string" && nodePath.isAbsolute(projectDirectory)
        ? projectDirectory
        : null;
    const path = (await realpathOrNull(cwd)) ?? (fallback === null ? null : await realpathOrNull(fallback));
    if (path === null)
        return null;
    return Object.freeze({ path, worktreeMain: await worktreeMainRepository(path) });
}
async function holdsWakeflowConfig(directory) {
    return (await nodeKind(nodePath.join(directory, WAKEFLOW_CONFIG_FILE_NAME))) === "file";
}
async function collectCandidates(directory, listChildren, roots) {
    if (await holdsWakeflowConfig(directory))
        roots.add(directory);
    if (!listChildren)
        return;
    const children = await listEntryNames(directory, CHILD_LISTING_MAXIMUM_NAMES, (entry) => entry.isDirectory());
    for (const child of children) {
        const candidate = nodePath.join(directory, child);
        if (await holdsWakeflowConfig(candidate))
            roots.add(candidate);
    }
}
/**
 * 候选根：每个锚点及其至多 8 级祖先里含配置的目录，加上每个祖先的直接子目录里含配置的目录。
 * 锚点自己的子目录从不列举：位于锚点之下的工作区不可能包含锚点。
 */
async function candidateRoots(subject) {
    const anchors = subject.worktreeMain === null ? [subject.path] : [subject.path, subject.worktreeMain];
    const listed = new Set();
    const checked = new Set();
    const roots = new Set();
    for (const anchor of anchors) {
        let directory = anchor;
        for (let level = 0; level <= ANCESTOR_LEVELS; level += 1) {
            const listChildren = level > 0 && !listed.has(directory);
            if (listChildren)
                listed.add(directory);
            if (listChildren || !checked.has(directory)) {
                checked.add(directory);
                await collectCandidates(directory, listChildren, roots);
            }
            const parent = nodePath.dirname(directory);
            if (parent === directory)
                break;
            directory = parent;
        }
    }
    return [...roots].sort();
}
function declaredPaths(topology, key) {
    const entries = topology[key];
    if (!Array.isArray(entries))
        return null;
    const paths = [];
    for (const entry of entries) {
        if (!isRecord(entry) || typeof entry.path !== "string")
            return null;
        paths.push(entry.path);
    }
    return paths;
}
/**
 * 一个候选根的配置文档：只核对种类、版本与 `topology` 是对象，不加载校验器；读不出或对不上即 null。
 * 交回的是结构化读取用的原始记录，调用方自己逐字段判形状。
 */
export async function readWakeflowConfigRecord(root) {
    const config = await readBoundedJson(nodePath.join(root, WAKEFLOW_CONFIG_FILE_NAME), CONFIG_MAXIMUM_BYTES);
    if (!isRecord(config) ||
        config.kind !== WAKEFLOW_CONFIG_KIND ||
        typeof config.schemaVersion !== "number" ||
        config.schemaVersion !== WAKEFLOW_CONFIG_SCHEMA_VERSION ||
        !isRecord(config.topology)) {
        return null;
    }
    return { ...config, topology: config.topology };
}
/** 结构化读取两个 placement 数组；形状不对就跳过该候选，不加载校验器。 */
async function readWorkspaceDeclaration(root) {
    const config = await readWakeflowConfigRecord(root);
    if (config === null)
        return null;
    const repositories = declaredPaths(config.topology, "repositories");
    const supportSurfaces = declaredPaths(config.topology, "supportSurfaces");
    if (repositories === null || supportSurfaces === null)
        return null;
    return Object.freeze({ root, repositories, supportSurfaces });
}
export function isEqualOrUnder(subject, target) {
    if (subject === target)
        return true;
    const prefix = target.endsWith(nodePath.sep) ? target : `${target}${nodePath.sep}`;
    return subject.startsWith(prefix);
}
async function declaredPathMatches(root, declared, subject, repository) {
    const real = await realpathOrNull(nodePath.resolve(root, declared));
    if (real === null)
        return false;
    return isEqualOrUnder(subject.path, real) || (repository && real === subject.worktreeMain);
}
async function workspaceMatches(declaration, subject) {
    if (isEqualOrUnder(subject.path, declaration.root))
        return true;
    for (const surface of declaration.supportSurfaces) {
        if (await declaredPathMatches(declaration.root, surface, subject, false))
            return true;
    }
    for (const repository of declaration.repositories) {
        if (await declaredPathMatches(declaration.root, repository, subject, true))
            return true;
    }
    return false;
}
export async function matchingWorkspaces(subject) {
    const matched = [];
    for (const candidate of await candidateRoots(subject)) {
        const root = await realpathOrNull(candidate);
        if (root === null || matched.includes(root))
            continue;
        const declaration = await readWorkspaceDeclaration(root);
        if (declaration !== null && (await workspaceMatches(declaration, subject)))
            matched.push(root);
    }
    return matched.sort();
}
// ---- 绑定门（D2 d）------------------------------------------------------------
function bindingsDirectory(root, hostId) {
    return nodePath.join(root, ...hostRuntimeRootRef(hostId).split("/"), ...BINDINGS_DIRECTORY_SEGMENTS);
}
/**
 * 结构化读取绑定记录的 `handle.value`：交回这个工作区里绑定着该 session_id 句柄的窗口。每条命中的记录一项，
 * 取它的 `windowId`（不是字符串时为 null）。观察器只问有没有（持有句柄的工作区才接收后几类事件），写守卫
 * 还要拿窗口去配置里查角色。
 */
export async function sessionBoundWindowIds(root, hostId, sessionId) {
    const directory = bindingsDirectory(root, hostId);
    const names = await listEntryNames(directory, BINDINGS_LISTING_MAXIMUM_NAMES, (entry) => entry.isFile() && entry.name.endsWith(".json"));
    const windowIds = [];
    for (const name of names) {
        const record = await readBoundedJson(nodePath.join(directory, name), BINDING_MAXIMUM_BYTES);
        if (isRecord(record) && isRecord(record.handle) && record.handle.value === sessionId) {
            windowIds.push(typeof record.windowId === "string" ? record.windowId : null);
        }
    }
    return windowIds;
}
