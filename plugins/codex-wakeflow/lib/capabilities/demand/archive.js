import { randomUUID } from "node:crypto";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_DEMAND_ARCHIVE_MANIFEST_SCHEMA, } from "../../contracts/generated/governance/archive/demand-archive-manifest.generated.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest } from "../../foundation/crypto/sha256.js";
import { renderDeterministicJsonDocument } from "../../foundation/data/deterministic-json-document.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import { materializeDirectoryPath } from "../../foundation/filesystem/durable-directory-materialization.js";
import { createDirectoryTreeCandidateDurably } from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import { retireDirectoryTreeCandidateDurably } from "../../foundation/filesystem/durable-directory-tree-candidate-retirement.js";
import { publishDirectoryTreeCandidateDurably } from "../../foundation/filesystem/durable-directory-tree-publication.js";
import { settleObservedResourceEntry } from "../../foundation/filesystem/durable-resource-entry-settlement.js";
import { renameResourceDurably } from "../../foundation/filesystem/durable-resource-rename.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { removeRootedDirectoryTree } from "../../foundation/filesystem/rooted-directory-tree-removal.js";
import { readStableResourceDirectory } from "../../foundation/filesystem/stable-directory-read.js";
import { readStableFile } from "../../foundation/filesystem/stable-file-read.js";
import { readStableResourceTree, readStableRootResourceTree, } from "../../foundation/filesystem/stable-resource-tree-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { decodeUtf8, encodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import { DEMAND_REBUILDABLE_DIRECTORY_REFS } from "../../governance/demand/demand-interruption.js";
import { demandFinalRootRef } from "../../governance/demand/publication/demand-publication-paths.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import { demandArchiveRef, demandArchivesRootRef, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, } from "../../kernel/layout.js";
import { WAKEFLOW_DEMAND_TREE_CAPACITY } from "../../kernel/limits.js";
import { ARCHIVE_EXCLUDED_PREFIXES, computePayloadTreeDigest, isArchivePayloadPath, } from "./decide.js";
const ARCHIVE_DIRECTORY_MODE = 0o755;
const ARCHIVE_FILE_MODE = 0o644;
const ACTIVE_DIRECTORY_MODE = 0o700;
const ACTIVE_FILE_MODE = 0o600;
const MANIFEST_FILE_NAME = "manifest.json";
const VERIFY_REPORT_FILE_NAME = "verify-report.json";
const PAYLOAD_DIRECTORY_NAME = "payload";
const ARCHIVE_NAME_PATTERN = /^[0-9]{10}$/u;
const MAXIMUM_ARCHIVES_PER_DEMAND = 4096;
const MANIFEST_MAXIMUM_BYTES = parseByteCount(256 * 1024, "$manifest.maximumBytes");
/** Demand 根与归档负载共用的树容量（kernel 常量，证据上限由它推导，复审 G12）；超出即拒绝归档，不做部分归档。 */
const DEMAND_TREE_CAPACITY = Object.freeze({
    maximumEntries: WAKEFLOW_DEMAND_TREE_CAPACITY.maximumEntries,
    maximumDepth: WAKEFLOW_DEMAND_TREE_CAPACITY.maximumDepth,
    maximumFiles: WAKEFLOW_DEMAND_TREE_CAPACITY.maximumFiles,
    maximumFileBytes: parseByteCount(WAKEFLOW_DEMAND_TREE_CAPACITY.maximumFileBytes, "$tree.maximumFileBytes"),
    maximumTotalBytes: parseByteCount(WAKEFLOW_DEMAND_TREE_CAPACITY.maximumTotalBytes, "$tree.maximumTotalBytes"),
});
const validateManifest = createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_ARCHIVE_MANIFEST_SCHEMA, [
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
function reasonOf(error) {
    return typeof error === "object" &&
        error !== null &&
        "reason" in error &&
        typeof error.reason === "string"
        ? error.reason
        : null;
}
/**
 * 基础层错误统一收敛：中止、来源变化与其余 I/O 失败各归一类。`observation-changed` 来自“沿用之前先落盘”
 * （`settleObservedResourceEntry`）：调用方看到的目录项在两次核对之间变了，与来源变化同类，重试即可。
 */
export function mapFoundationError(error, label, path) {
    if (error instanceof WakeflowError)
        throw error;
    const reason = reasonOf(error);
    if (reason === null)
        throw error;
    if (reason === "aborted")
        fail("io-failure", "aborted", "$signal", { cause: error });
    if (reason === "source-changed" ||
        reason === "stream-changed" ||
        reason === "observation-changed") {
        fail("concurrency-conflict", `${label}-${reason}`, path, { cause: error, retryable: true });
    }
    fail("io-failure", `${label}-${reason}`, path, { cause: error });
}
export function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
function isNotFound(error) {
    return ((error instanceof RootedDirectoryError && error.reason === "resource-not-found") ||
        reasonOf(error) === "not-found");
}
/** 稳定读取 Demand 根的完整树；只允许普通文件与目录，负载排除可重建检查点。 */
export async function readDemandRootSnapshot(demandRoot, signal) {
    let tree;
    try {
        tree = await readStableRootResourceTree(demandRoot, {
            ...DEMAND_TREE_CAPACITY,
            ...signalOptions(signal),
        });
    }
    catch (error) {
        mapFoundationError(error, "demand-root-read", "$demandRoot");
    }
    for (const entry of tree.entries) {
        if (entry.node.kind !== "file" && entry.node.kind !== "directory") {
            fail("precondition-failed", "demand-root-special-node", `$demandRoot/${entry.resourcePath}`);
        }
    }
    const payload = tree.files.filter((file) => isArchivePayloadPath(file.resourcePath));
    return Object.freeze({
        files: tree.files,
        payload,
        payloadTreeDigest: computePayloadTreeDigest(payload),
        payloadTotalBytes: payload.reduce((total, file) => total + Number(file.byteCount), 0),
    });
}
/** 按稳定读取的节点预期逐个读回负载字节；任何文件变化都让整次读取失败。 */
export async function readPayloadFiles(demandRoot, payload, signal) {
    const files = [];
    for (const file of payload) {
        try {
            const read = await readStableFile(demandRoot, file.resourcePath, {
                maximumBytes: DEMAND_TREE_CAPACITY.maximumFileBytes,
                expectedNode: file.node,
                ...signalOptions(signal),
            });
            if (read.digest !== file.digest) {
                fail("concurrency-conflict", "payload-changed", `$demandRoot/${file.resourcePath}`, {
                    retryable: true,
                });
            }
            files.push(Object.freeze({ resourcePath: file.resourcePath, bytes: read.bytes, digest: read.digest }));
        }
        catch (error) {
            mapFoundationError(error, "payload-read", `$demandRoot/${file.resourcePath}`);
        }
    }
    return Object.freeze(files);
}
/** 负载文件文本，供凭证扫描；非 UTF-8 文件按宽松解码给出，凭证类命中不因夹着二进制字节而漏掉（§13.161 B9-3）。 */
export function payloadTexts(files) {
    const texts = [];
    for (const file of files) {
        try {
            texts.push(Object.freeze({
                resourcePath: file.resourcePath,
                text: decodeUtf8(file.bytes, "$payload"),
            }));
        }
        catch (error) {
            if (!(error instanceof Utf8Error))
                throw error;
            texts.push(Object.freeze({
                resourcePath: file.resourcePath,
                text: new TextDecoder("utf-8", { fatal: false }).decode(file.bytes),
            }));
        }
    }
    return Object.freeze(texts);
}
function parseArchiveManifest(value, path = "$manifest") {
    const result = validateManifest(parseJsonValue(value, path));
    if (!result.ok)
        fail("precondition-failed", "archive-manifest-schema", `${path}${result.path.slice(1)}`);
    const { manifestDigest, ...basis } = result.value;
    if (computeCanonicalJsonSha256Digest(parseJsonValue(basis, path)) !== manifestDigest) {
        fail("precondition-failed", "archive-manifest-digest", `${path}.manifestDigest`);
    }
    return Object.freeze(result.value);
}
/** 清单里的摘要与路径回到品牌类型，供计划与回执使用。 */
export function manifestDigest(value, path = "$manifest") {
    return parseSha256Digest(value, path);
}
export function manifestPath(value, path = "$manifest") {
    return parsePortableResourcePath(value, path);
}
export function createArchiveManifest(basis) {
    const body = {
        kind: "WakeflowDemandArchiveManifest",
        schemaVersion: 1,
        ...basis,
    };
    return parseArchiveManifest({
        ...body,
        manifestDigest: computeCanonicalJsonSha256Digest(parseJsonValue(body, "$manifest")),
    });
}
function renderJson(value, path) {
    return encodeUtf8(renderDeterministicJsonDocument(parseJsonValue(value, path), path), path);
}
/** 读取一个归档包的清单；目录或清单缺失为 `null`。 */
async function readArchiveManifest(ledgerRoot, archiveRef, signal) {
    const ref = parsePortableResourcePath(`${archiveRef}/${MANIFEST_FILE_NAME}`, "$archive");
    try {
        const read = await readDeterministicJsonFile(ledgerRoot, ref, {
            maximumBytes: MANIFEST_MAXIMUM_BYTES,
            ...signalOptions(signal),
        });
        return parseArchiveManifest(read.value, `$archive/${MANIFEST_FILE_NAME}`);
    }
    catch (error) {
        if (isNotFound(error))
            return null;
        mapFoundationError(error, "archive-manifest-read", "$archive");
    }
}
/** 目录树候选要求成员按路径字节序排列。 */
function sortedByPath(files) {
    return [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
function archiveFiles(input, manifest) {
    return sortedByPath([
        { path: MANIFEST_FILE_NAME, bytes: renderJson(manifest, "$manifest"), mode: ARCHIVE_FILE_MODE },
        {
            path: VERIFY_REPORT_FILE_NAME,
            bytes: renderJson(input.verifyReport, "$verify"),
            mode: ARCHIVE_FILE_MODE,
        },
        ...input.payload.map((file) => ({
            path: `${PAYLOAD_DIRECTORY_NAME}/${file.resourcePath}`,
            bytes: file.bytes,
            mode: ARCHIVE_FILE_MODE,
        })),
    ]);
}
/**
 * 沿用一个已经在盘面上的归档包之前，把它的两级名字落盘（1.4.1 段 1b，“沿用之前先落盘”）：先是
 * `archives/<demandId>`（同步 `archives/`），再是修订号目录（同步 `archives/<demandId>/`）。封档的那一次
 * 可能死在发布改名之后、同步之前，或者死在建 `archives/<demandId>` 之后、同步之前，两处都不留别的痕迹；
 * 沿用者接着就删活动根、删日志，不补这两次同步，掉电之后归档可以消失而根已经不在。归档包里的内容在
 * 发布改名之前已经同步过，这里只管名字。
 */
export async function settleSealedArchive(ledgerRoot, demandId, archiveRef, signal) {
    try {
        await settleObservedResourceEntry(ledgerRoot, demandArchivesRootRef(demandId), "present", {
            ...signalOptions(signal),
            errorPath: "$archive",
        });
        await settleObservedResourceEntry(ledgerRoot, archiveRef, "present", {
            ...signalOptions(signal),
            errorPath: "$archive",
        });
    }
    catch (error) {
        mapFoundationError(error, "archive-settle", "$archive");
    }
}
/** 同修订号的归档已在：负载一致即沿用（先把它的名字落盘），不一致拒绝。 */
async function existingArchive(ledgerRoot, demandId, archiveRef, payloadTreeDigest, signal) {
    const existing = await readArchiveManifest(ledgerRoot, archiveRef, signal);
    if (existing === null)
        return null;
    if (existing.payload.treeDigest !== payloadTreeDigest) {
        fail("precondition-failed", "archive-conflict", "$archive");
    }
    await settleSealedArchive(ledgerRoot, demandId, archiveRef, signal);
    return Object.freeze({ disposition: "current", archiveRef, manifest: existing });
}
/**
 * 封归档包：候选目录整树落盘再重命名到最终位置；同负载重放为 `current`。`archives/<demandId>` 不是这一次
 * 建的（continue 之后再次完成，或上一次封档死在建目录之后）时，先把它的名字落盘再往里放归档。
 */
export async function sealDemandArchive(ledgerRoot, input, signal) {
    const archiveRef = demandArchiveRef(input.demandId, input.streamRevision);
    const payloadDigest = computePayloadTreeDigest(input.payload.map((file) => ({
        resourcePath: file.resourcePath,
        byteCount: file.bytes.byteLength,
        digest: file.digest,
    })));
    const current = await existingArchive(ledgerRoot, input.demandId, archiveRef, payloadDigest, signal);
    if (current !== null)
        return current;
    const manifest = input.manifest(Object.freeze({
        treeDigest: payloadDigest,
        fileCount: input.payload.length,
        totalBytes: input.payload.reduce((total, file) => total + file.bytes.byteLength, 0),
        excluded: [...ARCHIVE_EXCLUDED_PREFIXES],
    }), computeCanonicalJsonSha256Digest(parseJsonValue(input.verifyReport, "$verify")));
    const parent = demandArchivesRootRef(input.demandId);
    const candidateRef = parsePortableResourcePath(`${parent}/.candidate-${String(input.streamRevision).padStart(10, "0")}-${randomUUID()}`, "$archive");
    try {
        const materialized = await materializeDirectoryPath(ledgerRoot, parent, {
            mode: ARCHIVE_DIRECTORY_MODE,
            ...signalOptions(signal),
        });
        if (materialized.segments.at(-1)?.disposition === "existing") {
            await settleObservedResourceEntry(ledgerRoot, parent, "present", {
                ...signalOptions(signal),
                errorPath: "$archive",
            });
        }
        const candidate = await createDirectoryTreeCandidateDurably(ledgerRoot, candidateRef, archiveFiles(input, manifest), {
            ...DEMAND_TREE_CAPACITY,
            directoryMode: ARCHIVE_DIRECTORY_MODE,
            ...signalOptions(signal),
        });
        try {
            await publishDirectoryTreeCandidateDurably(ledgerRoot, candidate, archiveRef, signalOptions(signal));
        }
        catch (error) {
            if (reasonOf(error) !== "destination-exists") {
                await retireCandidateQuietly(ledgerRoot, candidate, signal);
                throw error;
            }
            await retireDirectoryTreeCandidateDurably(ledgerRoot, candidate, signalOptions(signal));
            const raced = await existingArchive(ledgerRoot, input.demandId, archiveRef, payloadDigest, signal);
            if (raced === null)
                fail("concurrency-conflict", "archive-raced", "$archive", { retryable: true });
            return raced;
        }
    }
    catch (error) {
        mapFoundationError(error, "archive-seal", "$archive");
    }
    return Object.freeze({ disposition: "sealed", archiveRef, manifest });
}
/** 一个 Demand 最近的归档包（修订号最大者）；没有归档为 `null`。 */
export async function findLatestDemandArchive(ledgerRoot, demandId, signal) {
    let listing;
    try {
        listing = await readStableResourceDirectory(ledgerRoot, demandArchivesRootRef(demandId), {
            maximumEntries: MAXIMUM_ARCHIVES_PER_DEMAND,
            ...signalOptions(signal),
        });
    }
    catch (error) {
        if (isNotFound(error))
            return null;
        mapFoundationError(error, "archive-list", "$archive");
    }
    const names = listing.entries
        .filter((entry) => entry.node.kind === "directory" && ARCHIVE_NAME_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    const latest = names.at(-1);
    if (latest === undefined)
        return null;
    const archiveRef = demandArchiveRef(demandId, Number(latest));
    const manifest = await readArchiveManifest(ledgerRoot, archiveRef, signal);
    if (manifest === null)
        fail("precondition-failed", "archive-manifest-missing", "$archive");
    return Object.freeze({ archiveRef, manifest });
}
/** 读回归档负载：路径相对负载根，每个文件带摘要。 */
export async function readArchivePayload(ledgerRoot, archiveRef, signal) {
    const payloadRef = parsePortableResourcePath(`${archiveRef}/${PAYLOAD_DIRECTORY_NAME}`, "$archive");
    const prefix = `${payloadRef}/`;
    const files = [];
    try {
        const tree = await readStableResourceTree(ledgerRoot, payloadRef, {
            ...DEMAND_TREE_CAPACITY,
            ...signalOptions(signal),
        });
        for (const file of tree.files) {
            const read = await readStableFile(ledgerRoot, file.resourcePath, {
                maximumBytes: DEMAND_TREE_CAPACITY.maximumFileBytes,
                expectedNode: file.node,
                ...signalOptions(signal),
            });
            if (!file.resourcePath.startsWith(prefix))
                fail("unexpected", "payload-path", "$archive");
            files.push(Object.freeze({
                resourcePath: parsePortableResourcePath(file.resourcePath.slice(prefix.length), "$archive"),
                bytes: read.bytes,
                digest: read.digest,
            }));
        }
    }
    catch (error) {
        mapFoundationError(error, "archive-payload-read", "$archive");
    }
    return Object.freeze(files);
}
async function demandRootExists(workspaceRoot, demandId) {
    try {
        await workspaceRoot.inspectExistingResource(demandFinalRootRef(demandId), "$demandRoot");
        return true;
    }
    catch (error) {
        if (isNotFound(error))
            return false;
        mapFoundationError(error, "demand-root-inspect", "$demandRoot");
    }
}
/** 发布失败后清理本进程自建的候选目录；清理本身失败不遮盖原错误。 */
async function retireCandidateQuietly(root, candidate, signal) {
    try {
        await retireDirectoryTreeCandidateDurably(root, candidate, signalOptions(signal));
    }
    catch {
        // 第一个错误优先；残留候选由下一次维护识别。
    }
}
/**
 * 补齐可重建的空目录；幂等，所以根已存在（含发布后中断的恢复）时同样执行。`reused` 是根不由这一次
 * 放回的两条路径：已经在的那几个目录可能是上一次被杀的恢复刚建的、名字还没有落盘，而调用方接着就删
 * 日志，所以把每一个已经在的名字落盘（1.4.1 段 1b）。这一次新建的目录，建的时候已经同步过。
 */
async function materializeRebuildableDirectories(workspaceRoot, destination, signal, reused) {
    try {
        for (const directory of DEMAND_REBUILDABLE_DIRECTORY_REFS) {
            const directoryRef = parsePortableResourcePath(`${destination}/${directory}`, "$demandRoot");
            const materialized = await materializeDirectoryPath(workspaceRoot, directoryRef, {
                mode: ACTIVE_DIRECTORY_MODE,
                ...signalOptions(signal),
            });
            if (reused && materialized.segments.at(-1)?.disposition === "existing") {
                await settleObservedResourceEntry(workspaceRoot, directoryRef, "present", {
                    ...signalOptions(signal),
                    errorPath: "$demandRoot",
                });
            }
        }
    }
    catch (error) {
        mapFoundationError(error, "demand-root-restore", "$demandRoot");
    }
}
/**
 * 从归档负载恢复活动根（0700/0600），再补齐可重建的空目录；根已存在为 `current`。
 *
 * 根已存在时先把它的名字落盘（1.4.1 段 1b）：上一次恢复可能死在发布改名之后、同步 `current/` 之前，
 * 调用方接着追加事件、删日志；不补这一次同步，掉电之后根的名字可以退回成 `.restore-…`，而日志已经没有了。
 * 根不在时先清掉这个 Demand 的退役根：continue 可以接手“根已退役、终态日志还在”的状态并改写日志，
 * 之后再没有日志指着那棵退役根。同时清掉上一次被杀的放回留下的候选树（`.restore-<demandId>-…`）：
 * 每一棵都是整份负载的一个副本，不清就一直留在 `current/` 里。两样都以调用方持有 pod 变更锁为前提。
 */
export async function restoreDemandRoot(workspaceRoot, demandId, payload, signal) {
    const destination = demandFinalRootRef(demandId);
    if (await demandRootExists(workspaceRoot, demandId)) {
        try {
            await settleObservedResourceEntry(workspaceRoot, destination, "present", {
                ...signalOptions(signal),
                errorPath: "$demandRoot",
            });
        }
        catch (error) {
            mapFoundationError(error, "demand-root-restore", "$demandRoot");
        }
        await materializeRebuildableDirectories(workspaceRoot, destination, signal, true);
        return "current";
    }
    // 调用方持有这个 Demand 所属 pod 的变更锁：此刻 `current/` 里它名下的退役根与恢复候选树都没有活着的
    // 写者，是上一次被杀的退役或放回留下的。
    await removeRetiredDemandRoots(workspaceRoot, demandId, signal, (name) => retiredDemandRootOwner(name) ?? restoreCandidateOwner(name));
    const candidateRef = parsePortableResourcePath(`${WAKEFLOW_ACTIVE_CURRENT_ROOT_REF}/.restore-${demandId}-${randomUUID()}`, "$demandRoot");
    try {
        const candidate = await createDirectoryTreeCandidateDurably(workspaceRoot, candidateRef, sortedByPath(payload.map((file) => ({
            path: file.resourcePath,
            bytes: file.bytes,
            mode: ACTIVE_FILE_MODE,
        }))), { ...DEMAND_TREE_CAPACITY, directoryMode: ACTIVE_DIRECTORY_MODE, ...signalOptions(signal) });
        try {
            await publishDirectoryTreeCandidateDurably(workspaceRoot, candidate, destination, signalOptions(signal));
        }
        catch (error) {
            if (reasonOf(error) !== "destination-exists") {
                await retireCandidateQuietly(workspaceRoot, candidate, signal);
                throw error;
            }
            await retireDirectoryTreeCandidateDurably(workspaceRoot, candidate, signalOptions(signal));
            await materializeRebuildableDirectories(workspaceRoot, destination, signal, true);
            return "current";
        }
    }
    catch (error) {
        mapFoundationError(error, "demand-root-restore", "$demandRoot");
    }
    await materializeRebuildableDirectories(workspaceRoot, destination, signal, false);
    return "restored";
}
/** 打开待退役的活动根并稳定读取整棵树；关闭失败不遮盖读取错误。 */
async function readRetiringRootSnapshot(physicalPath, signal) {
    let demandRoot;
    try {
        demandRoot = await RootedDirectory.open(physicalPath, "$demandRoot");
    }
    catch (error) {
        mapFoundationError(error, "demand-root-open", "$demandRoot");
    }
    let snapshot;
    let failure;
    try {
        snapshot = await readDemandRootSnapshot(demandRoot, signal);
    }
    catch (error) {
        failure = error;
    }
    try {
        await demandRoot.close();
    }
    catch (error) {
        if (failure === undefined)
            failure = error;
    }
    if (failure !== undefined)
        throw failure;
    if (snapshot === undefined)
        fail("unexpected", "demand-root-snapshot", "$demandRoot");
    return snapshot;
}
/**
 * 退役中的 Demand 根在 `current/` 里的名字：`.retire-<demandId>-<uuid>`（1.4.1 段 1b）。它只由
 * `retireDemandRoot` 在摘要比对（或日志授权）通过之后改名得到，所以带这个名字的目录里只剩已经归档过的
 * 字节，清掉它不需要再比对。`current/` 的每个读者都只认 `demand_` 开头的名字，看不见它。
 */
const RETIRED_ROOT_NAME = /^\.retire-(demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RETIRED_ROOT_SCAN_MAXIMUM_ENTRIES = 4096;
const CURRENT_DIRECTORY_READ_ATTEMPTS = 3;
/** `name` 是哪个 Demand 的退役根；不是退役根的名字返回 null。 */
export function retiredDemandRootOwner(name) {
    return RETIRED_ROOT_NAME.exec(name)?.[1] ?? null;
}
/**
 * 放回活动根用的候选树在 `current/` 里的名字：`.restore-<demandId>-<uuid>`（`restoreDemandRoot` 自己起的）。
 * 候选树建到一半进程死了，它就留在那里；下一次放回另建一棵。
 */
const RESTORE_CANDIDATE_NAME = /^\.restore-(demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
/** `name` 是哪个 Demand 的恢复候选树；不是的名字返回 null。 */
export function restoreCandidateOwner(name) {
    return RESTORE_CANDIDATE_NAME.exec(name)?.[1] ?? null;
}
/**
 * 稳定读取 `current/` 的直属条目。这个目录里还有每次变更之后都重写的状态页、看板与日志目录、别的 pod 的
 * Demand 根，所以别的窗口正好在写时读取会以“读的时候变了”结束；那不是这个 Demand 的问题，重读几次，
 * 仍然读不稳就让调用方重试，不报成删根失败。
 */
async function listCurrentDirectory(workspaceRoot, signal) {
    for (let attempt = 1;; attempt += 1) {
        try {
            return await readStableResourceDirectory(workspaceRoot, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, {
                maximumEntries: RETIRED_ROOT_SCAN_MAXIMUM_ENTRIES,
                ...signalOptions(signal),
            });
        }
        catch (error) {
            const reason = reasonOf(error);
            if (reason === "source-changed" && attempt < CURRENT_DIRECTORY_READ_ATTEMPTS)
                continue;
            if (reason === "source-changed" || reason === "aborted") {
                mapFoundationError(error, "demand-root-remove", "$demandRoot");
            }
            fail("io-failure", "demand-root-remove", "$demandRoot", { cause: error });
        }
    }
}
/**
 * 清掉这个 Demand 留在 `current/` 里的退役根，返回清掉的个数。每一棵各自删除并同步 `current/` 一次；
 * 同名的非目录节点不是本模块造的，原样留着。任何失败都报 io-failure `demand-root-remove`（中止除外）。
 * `ownerOf` 决定认哪些名字：缺省只认退役根；放回根的路径另认上一次被杀的放回留下的候选树。
 */
async function removeRetiredDemandRoots(workspaceRoot, demandId, signal, ownerOf = retiredDemandRootOwner) {
    let removed = 0;
    const listing = await listCurrentDirectory(workspaceRoot, signal);
    try {
        for (const entry of listing.entries) {
            if (entry.node.kind !== "directory")
                continue;
            if (ownerOf(entry.name) !== demandId)
                continue;
            const outcome = await removeRootedDirectoryTree(workspaceRoot, entry.resourcePath, { missing: "ignore", ...signalOptions(signal) }, "$demandRoot");
            if (outcome === "removed")
                removed += 1;
        }
    }
    catch (error) {
        if (reasonOf(error) === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        fail("io-failure", "demand-root-remove", "$demandRoot", { cause: error });
    }
    return removed;
}
/**
 * 根已不在时的收尾：清掉退役根，再把“根的名字不在”落盘。只有 recover 与并发删除者走到这里，上一次
 * 退役可能死在三处而不留别的痕迹：改名之后、同步 `current/` 之前；删退役根的中途；删完之后、同步之前
 * （1.4.0 直接删根时是最后一种）。不补这一次同步，随后持久删除日志就回到“日志没了、根掉电后回来”的顺序。
 */
async function settleRetiredDemandRoot(workspaceRoot, demandId, signal) {
    await removeRetiredDemandRoots(workspaceRoot, demandId, signal);
    try {
        await settleObservedResourceEntry(workspaceRoot, demandFinalRootRef(demandId), "absent", {
            ...signalOptions(signal),
            errorPath: "$demandRoot",
        });
    }
    catch (error) {
        const reason = reasonOf(error);
        if (reason === "observation-changed" || reason === "aborted") {
            mapFoundationError(error, "demand-root-remove", "$demandRoot");
        }
        fail("io-failure", "demand-root-remove", "$demandRoot", { cause: error });
    }
}
/** 把活动根改名为退役根并同步 `current/` 一次；根的顶层在快照之后变过就按漂移拒绝。 */
async function renameToRetiredDemandRoot(workspaceRoot, demandId, expectedSourceNode, signal) {
    const retired = parsePortableResourcePath(`${WAKEFLOW_ACTIVE_CURRENT_ROOT_REF}/.retire-${demandId}-${randomUUID()}`, "$demandRoot");
    try {
        await renameResourceDurably(workspaceRoot, demandFinalRootRef(demandId), retired, {
            expectedSourceNode,
            ...signalOptions(signal),
        });
    }
    catch (error) {
        const reason = reasonOf(error);
        if (reason === "source-changed") {
            fail("precondition-failed", "demand-root-drift", "$demandRoot", {
                cause: error,
                retryable: true,
            });
        }
        if (reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        fail("io-failure", "demand-root-remove", "$demandRoot", { cause: error });
    }
    return retired;
}
/**
 * 删除活动根：只在根内负载摘要等于已封归档的负载摘要、且树里只有普通文件与目录时执行；
 * `residual` 由日志与已封归档授权，跳过摘要比对。
 * 这是本仓库唯一一处递归删除用户内容的地方（其余递归删除只清理本进程自建的候选目录与回执）；
 * 归档已经是这些字节的权威副本。
 *
 * 先改名、再删（1.4.1 段 1b）：根先原子地改名为 `current/.retire-<demandId>-<uuid>` 并同步 `current/`，
 * 再删掉改名后的树并再同步一次。Demand 自己的名字下因此只有两种状态，完整的根或者没有根；进程死在
 * 删除中途留下的半棵树在退役根的名字下，不再被当成一个打不开的 Demand。终态应用随后持久删除生命周期
 * 日志，三次同步（改名、删除、删日志）按这个顺序发生，掉电之后不会出现日志已消失而根又回来的状态。
 * 改名失败而根的顶层在快照之后变过，报可重试的 `demand-root-drift`；改名与删除的其余失败（含同步
 * 失败与提交结果不确定）都报 io-failure `demand-root-remove`，日志留着，recover 接着做。
 *
 * 根已不在（`absent`）时先清掉这个 Demand 的退役根，再把“根的名字不在”落盘，见
 * `settleRetiredDemandRoot`；核对期间根又出现报可重试的 `demand-root-remove-observation-changed`。
 */
export async function retireDemandRoot(workspaceRoot, demandId, expectedPayloadTreeDigest, signal, options = {}) {
    let observation;
    try {
        observation = await workspaceRoot.inspectExistingResource(demandFinalRootRef(demandId), "$demandRoot");
    }
    catch (error) {
        if (!isNotFound(error))
            mapFoundationError(error, "demand-root-inspect", "$demandRoot");
        await settleRetiredDemandRoot(workspaceRoot, demandId, signal);
        return "absent";
    }
    if (observation.node.kind !== "directory") {
        fail("precondition-failed", "demand-root-not-directory", "$demandRoot");
    }
    const snapshot = await readRetiringRootSnapshot(observation.physicalPath, signal);
    if (options.residual !== true && snapshot.payloadTreeDigest !== expectedPayloadTreeDigest) {
        fail("precondition-failed", "demand-root-drift", "$demandRoot", { retryable: true });
    }
    const retired = await renameToRetiredDemandRoot(workspaceRoot, demandId, observation.node, signal);
    try {
        await removeRootedDirectoryTree(workspaceRoot, retired, signalOptions(signal), "$demandRoot");
    }
    catch (error) {
        fail("io-failure", "demand-root-remove", "$demandRoot", { cause: error });
    }
    if (await demandRootExists(workspaceRoot, demandId)) {
        fail("io-failure", "demand-root-remove-incomplete", "$demandRoot");
    }
    return "retired";
}
