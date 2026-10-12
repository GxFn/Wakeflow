import path from "node:path";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../contracts/identity/wakeflow-durable-id.js";
import { WAKEFLOW_HOST_IDS, } from "../contracts/vocabulary/wakeflow-host-id.js";
import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error } from "../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../foundation/data/deterministic-json-document.js";
import { parseJsonValue } from "../foundation/data/json-value.js";
import { AbsoluteNodeObservationError, observeAbsoluteNode, readAbsoluteRegularFileText, } from "../foundation/filesystem/absolute-node-observation.js";
import { readDeterministicJsonFile } from "../foundation/filesystem/deterministic-json-file.js";
import { createFileAtomically, DurableAtomicFileWriteError, replaceFileAtomically, } from "../foundation/filesystem/durable-atomic-file-write.js";
import { DurableDirectoryMaterializationError, materializeDirectoryPath, } from "../foundation/filesystem/durable-directory-materialization.js";
import { ExactRegularFileUnlinkError, unlinkRegularFileExactly, } from "../foundation/filesystem/exact-regular-file-unlink.js";
import { parsePortableResourcePath, } from "../foundation/filesystem/portable-resource-path.js";
import { RootedDirectoryTreeRemovalError, removeRootedDirectoryTree, } from "../foundation/filesystem/rooted-directory-tree-removal.js";
import { RootedDirectoryError, } from "../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import { parseUtcInstant, UtcInstantError, } from "../foundation/time/utc-instant.js";
import { fail } from "./error.js";
import { hostPodReceiptsRootRef, parseWakeflowHostId, podReceiptRootRef, podWorktreeReceiptRef, } from "./layout.js";
const RECEIPT_KIND = "WakeflowPodWorktreeReceipt";
const RECEIPT_SCHEMA_VERSION = 1;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const RECEIPT_MAXIMUM_BYTES = parseByteCount(16 * 1024, "$receipt.maximumBytes");
const PORCELAIN_MAXIMUM_CHARACTERS = 64 * 1024;
const PORCELAIN_MAXIMUM_ENTRIES = 256;
const POINTER_FILE_MAXIMUM_BYTES = 16 * 1024;
const DIRECTORY_MAXIMUM_ENTRIES = 512;
const GIT_OBJECT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u;
const BINDING_ID_PATTERN = /^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECEIPT_FIELDS = Object.freeze([
    "bindingId",
    "branch",
    "head",
    "hostId",
    "kind",
    "locked",
    "observedAt",
    "path",
    "podId",
    "receiptDigest",
    "repositoryId",
    "schemaVersion",
    "windowId",
]);
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
/** `key` 为 `line`（1 起的行号）或 `entry`（0 起的条目序号）。 */
function porcelainFail(reason, value, key = "line") {
    fail("invalid-request", "worktree-porcelain", "$request.observation.worktree.porcelain", {
        details: { check: reason, [key]: String(value) },
    });
}
function applyPorcelainLine(entry, line, index) {
    if (line.startsWith("HEAD ")) {
        const head = line.slice("HEAD ".length);
        if (!GIT_OBJECT_PATTERN.test(head))
            porcelainFail("head", index);
        entry.head = head;
        return;
    }
    if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length);
        if (!ref.startsWith("refs/heads/"))
            porcelainFail("branch", index);
        const branch = ref.slice("refs/heads/".length);
        if (!BRANCH_PATTERN.test(branch))
            porcelainFail("branch", index);
        entry.branch = branch;
        return;
    }
    if (line === "detached") {
        entry.detached = true;
        return;
    }
    if (line === "bare") {
        entry.bare = true;
        return;
    }
    if (line === "locked" || line.startsWith("locked ")) {
        entry.locked = true;
        return;
    }
    if (line === "prunable" || line.startsWith("prunable ")) {
        entry.prunable = true;
        return;
    }
    porcelainFail("unknown-line", index);
}
function startPorcelainEntry(entries, line, index) {
    const worktreePath = line.slice("worktree ".length);
    if (!path.isAbsolute(worktreePath))
        porcelainFail("path", index);
    if (entries.length >= PORCELAIN_MAXIMUM_ENTRIES)
        porcelainFail("entries", index);
    const entry = {
        path: worktreePath,
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
    };
    entries.push(entry);
    return entry;
}
function assertPorcelainEntries(entries) {
    for (const [index, entry] of entries.entries()) {
        if (entry.branch !== null && entry.detached)
            porcelainFail("branch-and-detached", index, "entry");
        if (!entry.bare && entry.head === null)
            porcelainFail("head-missing", index, "entry");
    }
}
/** 解析 `git worktree list --porcelain` 的原文；未知行、非绝对路径或超量条目即拒绝。 */
export function parseGitWorktreePorcelain(text) {
    if (text.length > PORCELAIN_MAXIMUM_CHARACTERS)
        porcelainFail("size", 0);
    const entries = [];
    let current = null;
    for (const [index, raw] of text.split(/\r?\n/u).entries()) {
        const line = raw.trimEnd();
        if (line.length === 0) {
            current = null;
        }
        else if (line.startsWith("worktree ")) {
            current = startPorcelainEntry(entries, line, index + 1);
        }
        else if (current === null) {
            porcelainFail("orphan-line", index + 1);
        }
        else {
            applyPorcelainLine(current, line, index + 1);
        }
    }
    assertPorcelainEntries(entries);
    return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}
function receiptFail(check) {
    fail("precondition-failed", "worktree-receipt", "$request.observation.worktree", {
        details: { check },
    });
}
async function realpathOrNull(candidate) {
    try {
        const observed = await observeAbsoluteNode(path.resolve(candidate), { follow: true });
        return observed.state === "present" ? observed.realPath : null;
    }
    catch {
        return null;
    }
}
async function readPointerFile(candidate) {
    try {
        const text = await readAbsoluteRegularFileText(path.resolve(candidate), POINTER_FILE_MAXIMUM_BYTES);
        return text === null ? null : text.trim();
    }
    catch {
        return null;
    }
}
/** 从 `git rev-parse --git-common-dir` 的原文得到 common dir 的 realpath；相对值按执行根解析。 */
async function resolveCommonDir(commonDir, executionReal) {
    const trimmed = commonDir.trim();
    if (trimmed.length === 0 || trimmed.includes("\n"))
        receiptFail("common-dir");
    const resolved = await realpathOrNull(path.resolve(executionReal, trimmed));
    if (resolved === null)
        receiptFail("common-dir");
    return resolved;
}
/** 候选检出的 realpath 等于执行根的那一条；主检出、bare 与 prunable 都不是执行位置。 */
async function selectExecutionEntry(entries, executionReal, repositoryReal) {
    for (const entry of entries) {
        if (entry.bare || entry.prunable)
            continue;
        const entryReal = await realpathOrNull(entry.path);
        if (entryReal !== executionReal)
            continue;
        if (entryReal === repositoryReal)
            receiptFail("main-checkout");
        if (entry.head === null)
            receiptFail("head");
        return entry;
    }
    receiptFail("execution-worktree");
}
/** `<path>/.git` 指针、admin 目录回指针与 HEAD 三处必须与回执互相印证。 */
async function verifyLinkedWorktree(checkoutReal, commonReal, entry) {
    const pointer = await readPointerFile(path.join(checkoutReal, ".git"));
    if (pointer === null || !pointer.startsWith("gitdir: "))
        receiptFail("gitdir-pointer");
    const adminReal = await realpathOrNull(path.resolve(checkoutReal, pointer.slice("gitdir: ".length)));
    const worktreesRoot = path.join(commonReal, "worktrees");
    if (adminReal === null ||
        path.dirname(adminReal) !== worktreesRoot ||
        !adminReal.startsWith(`${worktreesRoot}${path.sep}`)) {
        receiptFail("gitdir-pointer");
    }
    const back = await readPointerFile(path.join(adminReal, "gitdir"));
    if (back === null)
        receiptFail("gitdir-backpointer");
    const backReal = await realpathOrNull(path.resolve(adminReal, back));
    if (backReal !== path.join(checkoutReal, ".git"))
        receiptFail("gitdir-backpointer");
    const head = await readPointerFile(path.join(adminReal, "HEAD"));
    if (head === null)
        receiptFail("head-mismatch");
    if (entry.branch !== null) {
        if (head !== `ref: refs/heads/${entry.branch}`)
            receiptFail("head-mismatch");
    }
    else if (head !== entry.head) {
        receiptFail("head-mismatch");
    }
}
/** 准入一份 worktree 观察；成功返回 realpath、HEAD、分支与锁定状态。 */
export async function admitPodWorktreeObservation(input) {
    const entries = parseGitWorktreePorcelain(input.observation.porcelain);
    const repositoryReal = await realpathOrNull(input.repositoryRoot);
    if (repositoryReal === null)
        receiptFail("repository-root");
    const executionReal = await realpathOrNull(input.executionRoot);
    if (executionReal === null)
        receiptFail("execution-root");
    const commonReal = await resolveCommonDir(input.observation.commonDir, executionReal);
    const expectedCommon = await realpathOrNull(path.join(repositoryReal, ".git"));
    if (expectedCommon === null || commonReal !== expectedCommon)
        receiptFail("common-dir");
    const entry = await selectExecutionEntry(entries, executionReal, repositoryReal);
    await verifyLinkedWorktree(executionReal, commonReal, entry);
    return Object.freeze({
        path: executionReal,
        head: entry.head,
        branch: entry.branch,
        locked: entry.locked,
    });
}
/** porcelain 里除主检出外的检出 realpath 集合：登记前用它匹配 `session-start` 的 cwd。 */
export async function candidateWorktreePaths(porcelain, repositoryRoot) {
    const repositoryReal = await realpathOrNull(repositoryRoot);
    const paths = new Set();
    for (const entry of parseGitWorktreePorcelain(porcelain)) {
        if (entry.bare || entry.prunable)
            continue;
        const entryReal = await realpathOrNull(entry.path);
        if (entryReal !== null && entryReal !== repositoryReal)
            paths.add(entryReal);
    }
    return paths;
}
// ---- receipt record -----------------------------------------------------------------
function parseId(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError) {
            fail("invalid-request", "receipt-identity", path, { cause: error });
        }
        throw error;
    }
}
/** 目录项名是否为该种类的持久标识；杂散项（`notes.json`、`pod_old`）跳过而不是抛出。 */
function isDurableIdOfKind(value, kind) {
    try {
        parseWakeflowDurableIdOfKind(value, kind, "$receipt");
        return true;
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            return false;
        throw error;
    }
}
function receiptBasis(draft) {
    if (!BINDING_ID_PATTERN.test(draft.bindingId)) {
        fail("invalid-request", "receipt-binding", "$receipt/bindingId");
    }
    if (!path.isAbsolute(draft.worktree.path))
        fail("invalid-request", "receipt-path", "$receipt/path");
    if (!GIT_OBJECT_PATTERN.test(draft.worktree.head)) {
        fail("invalid-request", "receipt-head", "$receipt/head");
    }
    if (draft.worktree.branch !== null && !BRANCH_PATTERN.test(draft.worktree.branch)) {
        fail("invalid-request", "receipt-branch", "$receipt/branch");
    }
    return Object.freeze({
        kind: RECEIPT_KIND,
        schemaVersion: RECEIPT_SCHEMA_VERSION,
        hostId: parseWakeflowHostId(draft.hostId, "$receipt/hostId"),
        podId: parseId(draft.podId, "pod", "$receipt/podId"),
        windowId: parseId(draft.windowId, "window", "$receipt/windowId"),
        repositoryId: parseId(draft.repositoryId, "repository", "$receipt/repositoryId"),
        bindingId: draft.bindingId,
        path: draft.worktree.path,
        head: draft.worktree.head,
        branch: draft.worktree.branch,
        locked: draft.worktree.locked,
        observedAt: draft.observedAt,
    });
}
function exactRecord(value, path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        fail("invalid-request", "receipt-shape", path);
    }
    const record = value;
    const keys = Object.keys(record).sort();
    if (keys.length !== RECEIPT_FIELDS.length ||
        keys.some((key, index) => key !== RECEIPT_FIELDS[index])) {
        fail("invalid-request", "receipt-shape", path);
    }
    return record;
}
function text(value, path) {
    if (typeof value !== "string")
        fail("invalid-request", "receipt-shape", path);
    return value;
}
/** 严格解析一份回执；摘要必须等于其规范 JSON 摘要。 */
function parsePodWorktreeReceipt(value, path = "$receipt") {
    const record = exactRecord(parseJsonValue(value, path), path);
    if (record.kind !== RECEIPT_KIND || record.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
        fail("invalid-request", "receipt-kind", `${path}/kind`);
    }
    if (typeof record.locked !== "boolean")
        fail("invalid-request", "receipt-shape", `${path}/locked`);
    if (record.branch !== null && typeof record.branch !== "string") {
        fail("invalid-request", "receipt-shape", `${path}/branch`);
    }
    let observedAt;
    try {
        observedAt = parseUtcInstant(record.observedAt, `${path}/observedAt`);
    }
    catch (error) {
        if (error instanceof UtcInstantError) {
            fail("invalid-request", "receipt-time", `${path}/observedAt`);
        }
        throw error;
    }
    let receiptDigest;
    try {
        receiptDigest = parseSha256Digest(record.receiptDigest, `${path}/receiptDigest`);
    }
    catch (error) {
        if (error instanceof Sha256Error) {
            fail("invalid-request", "receipt-digest", `${path}/receiptDigest`);
        }
        throw error;
    }
    const basis = receiptBasis({
        hostId: text(record.hostId, `${path}/hostId`),
        podId: text(record.podId, `${path}/podId`),
        windowId: text(record.windowId, `${path}/windowId`),
        repositoryId: text(record.repositoryId, `${path}/repositoryId`),
        bindingId: text(record.bindingId, `${path}/bindingId`),
        worktree: {
            path: text(record.path, `${path}/path`),
            head: text(record.head, `${path}/head`),
            branch: record.branch,
            locked: record.locked,
        },
        observedAt,
    });
    if (computeCanonicalJsonSha256Digest(basis) !== receiptDigest) {
        fail("invalid-request", "receipt-digest", `${path}/receiptDigest`);
    }
    return Object.freeze({ ...basis, receiptDigest });
}
/** 从草稿创建回执并封摘要。 */
export function createPodWorktreeReceipt(draft) {
    const basis = receiptBasis(draft);
    return parsePodWorktreeReceipt({
        ...basis,
        receiptDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
function renderPodWorktreeReceipt(receipt) {
    return renderDeterministicJsonDocument(parseJsonValue(parsePodWorktreeReceipt(receipt), "$receipt"), "$receipt");
}
// ---- store ------------------------------------------------------------------------------
function mapWriteError(error, what) {
    if (error instanceof DurableAtomicFileWriteError ||
        error instanceof DurableDirectoryMaterializationError) {
        fail("io-failure", `${what}-${error.reason}`, "$receipt", { cause: error });
    }
    throw error;
}
/** 写入或换代一份回执：同仓库的旧回执被整文件替换。 */
export async function writePodWorktreeReceipt(root, receiptValue, options = {}) {
    const receipt = parsePodWorktreeReceipt(receiptValue);
    const signal = signalOptions(options.signal);
    const ref = podWorktreeReceiptRef(receipt.hostId, receipt.podId, receipt.repositoryId);
    const directory = parsePortableResourcePath(`${podReceiptRootRef(receipt.hostId, receipt.podId)}/worktrees`, "$receipt");
    const bytes = encodeUtf8(renderPodWorktreeReceipt(receipt), "$receipt");
    try {
        await materializeDirectoryPath(root, directory, { mode: DIRECTORY_MODE, ...signal });
        const existing = await readReceiptSource(root, ref, signal);
        if (existing === null) {
            await createFileAtomically(root, ref, bytes, { mode: FILE_MODE, ...signal });
        }
        else {
            await replaceFileAtomically(root, ref, bytes, {
                mode: FILE_MODE,
                expected: {
                    resourcePath: existing.resourcePath,
                    node: existing.node,
                    byteCount: existing.byteCount,
                    digest: existing.digest,
                },
                ...signal,
            });
        }
    }
    catch (error) {
        mapWriteError(error, "receipt-write");
    }
}
async function readReceiptSource(root, ref, signal) {
    try {
        const read = await readDeterministicJsonFile(root, ref, {
            maximumBytes: RECEIPT_MAXIMUM_BYTES,
            ...signal,
        });
        return Object.freeze({
            resourcePath: read.resourcePath,
            node: read.node,
            byteCount: read.byteCount,
            digest: read.digest,
            text: read.text,
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError && error.reason === "not-found")
            return null;
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found")
            return null;
        if (error instanceof StableFileReadError && error.reason === "aborted") {
            fail("io-failure", "aborted", "$signal", { cause: error });
        }
        if (error instanceof StableFileReadError ||
            error instanceof DeterministicJsonDocumentError ||
            error instanceof StrictTextFileError) {
            fail("io-failure", "receipt-read", "$receipt", { cause: error });
        }
        if (error instanceof RootedDirectoryError) {
            fail("io-failure", "receipt-read", "$receipt", { cause: error });
        }
        throw error;
    }
}
/** 读一份回执；不存在返回 null，损坏即 `io-failure`。 */
export async function readPodWorktreeReceipt(root, hostId, podId, repositoryId, options = {}) {
    const ref = podWorktreeReceiptRef(hostId, podId, repositoryId);
    const source = await readReceiptSource(root, ref, signalOptions(options.signal));
    if (source === null)
        return null;
    const receipt = parsePodWorktreeReceipt(parseDeterministicJsonDocument(source.text, "$receipt"));
    if (receipt.hostId !== hostId ||
        receipt.podId !== podId ||
        receipt.repositoryId !== repositoryId ||
        renderPodWorktreeReceipt(receipt) !== source.text) {
        fail("io-failure", "receipt-representation", "$receipt");
    }
    return receipt;
}
/** 列出一个 pod 的全部 worktree 回执（按仓库标识排序）；目录不存在即空。 */
export async function listPodWorktreeReceipts(root, hostId, podId, options = {}) {
    const directory = parsePortableResourcePath(`${podReceiptRootRef(hostId, podId)}/worktrees`, "$receipt");
    let listing;
    try {
        listing = await readStableResourceDirectory(root, directory, {
            maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
            ...signalOptions(options.signal),
        });
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError && error.reason === "not-found") {
            return Object.freeze([]);
        }
        if (error instanceof StableDirectoryReadError) {
            fail("io-failure", `receipt-listing-${error.reason}`, "$receipt", { cause: error });
        }
        throw error;
    }
    const receipts = [];
    for (const entry of listing.entries) {
        if (!entry.name.endsWith(".json"))
            continue;
        const repositoryId = entry.name.slice(0, -".json".length);
        if (!isDurableIdOfKind(repositoryId, "repository"))
            continue;
        const receipt = await readPodWorktreeReceipt(root, hostId, podId, repositoryId, options);
        if (receipt !== null)
            receipts.push(receipt);
    }
    return Object.freeze(receipts.sort((left, right) => left.repositoryId < right.repositoryId ? -1 : left.repositoryId > right.repositoryId ? 1 : 0));
}
/**
 * 不带宿主身份的消费者（demand 生命周期、证据）按 podId 在两个宿主目录里找回执：
 * 一个 pod 的窗口只在一个宿主上登记，取第一个有回执的宿主。
 */
export async function listPodWorktreeReceiptsAnyHost(root, podId, options = {}) {
    for (const hostId of WAKEFLOW_HOST_IDS) {
        const receipts = await listPodWorktreeReceipts(root, hostId, podId, options);
        if (receipts.length > 0)
            return receipts;
    }
    return Object.freeze([]);
}
/**
 * 本宿主上除 `excludePodId` 之外、回执路径等于该检出的第一份回执（§13.128，旧实现 T03
 * "rejects a worktree occupied by another current Pod"）：一个检出同一时刻只属于一个 pod。
 */
export async function findPodWorktreeReceiptByPath(root, hostId, checkoutPath, excludePodId, options = {}) {
    const target = (await realpathOrNull(checkoutPath)) ?? checkoutPath;
    for (const podId of await listPodReceiptDirectories(root, hostId, options)) {
        if (podId === excludePodId)
            continue;
        for (const receipt of await listPodWorktreeReceipts(root, hostId, podId, options)) {
            if (receipt.path === target)
                return receipt;
        }
    }
    return null;
}
/** 列出本宿主有回执目录的 pod 标识；recover 用它发现配置里已不存在的孤儿目录。 */
export async function listPodReceiptDirectories(root, hostId, options = {}) {
    try {
        const listing = await readStableResourceDirectory(root, hostPodReceiptsRootRef(hostId), {
            maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
            ...signalOptions(options.signal),
        });
        return Object.freeze(listing.entries
            .filter((entry) => entry.node.kind === "directory" && isDurableIdOfKind(entry.name, "pod"))
            .map((entry) => entry.name)
            .sort());
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError && error.reason === "not-found") {
            return Object.freeze([]);
        }
        if (error instanceof StableDirectoryReadError) {
            fail("io-failure", `receipt-listing-${error.reason}`, "$receipt", { cause: error });
        }
        throw error;
    }
}
/** 退休一份回执；不存在返回 false。 */
export async function retirePodWorktreeReceipt(root, hostId, podId, repositoryId, options = {}) {
    const ref = podWorktreeReceiptRef(hostId, podId, repositoryId);
    const source = await readReceiptSource(root, ref, signalOptions(options.signal));
    if (source === null)
        return false;
    try {
        await unlinkRegularFileExactly(root, ref, {
            expectedNode: source.node,
            ...signalOptions(options.signal),
        });
        return true;
    }
    catch (error) {
        if (error instanceof ExactRegularFileUnlinkError) {
            fail("io-failure", `receipt-retire-${error.reason}`, "$receipt", { cause: error });
        }
        throw error;
    }
}
/** 删除一个 pod 的整个回执目录（Wakeflow 自己的私有文件）；不存在即 false。 */
export async function retirePodReceipts(root, hostId, podId) {
    const ref = podReceiptRootRef(hostId, podId);
    try {
        return ((await removeRootedDirectoryTree(root, ref, { missing: "ignore" }, "$receipt")) === "removed");
    }
    catch (error) {
        // 不是目录或无法观察：与之前 `stat` 失败即 false 一致（§13.166；open-items G7 留给批次 2）。
        if (error instanceof RootedDirectoryTreeRemovalError &&
            (error.reason === "not-directory" || error.reason === "inspection-failure")) {
            return false;
        }
        fail("io-failure", "receipt-retire-directory", "$receipt", { cause: error });
    }
}
/**
 * 检出是否仍在（open-items G7，§13.167）：目录在且带 `.git` 指针文件为 `present`；目录或指针不在、
 * 或不是对应的节点种类为 `absent`；无法观察（EACCES、EIO、ELOOP……）为 `unknown`——"没能检查"
 * 不冒充"不在"，pod 关闭对 unknown 阻塞而不是退役回执。
 */
export async function observeWorktreeCheckout(receipt) {
    try {
        const checkout = await observeAbsoluteNode(receipt.path, { follow: true });
        if (checkout.state === "missing" || checkout.node.kind !== "directory")
            return "absent";
        const pointer = await observeAbsoluteNode(path.join(receipt.path, ".git"), { follow: true });
        if (pointer.state === "missing")
            return "absent";
        return pointer.node.kind === "file" ? "present" : "absent";
    }
    catch (error) {
        if (error instanceof AbsoluteNodeObservationError && error.reason === "input")
            return "absent";
        return "unknown";
    }
}
