import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
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
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory } from "../../foundation/filesystem/stable-directory-read.js";
import { readStableFile } from "../../foundation/filesystem/stable-file-read.js";
import { readStableResourceTree, readStableRootResourceTree, } from "../../foundation/filesystem/stable-resource-tree-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { decodeUtf8, encodeUtf8 } from "../../foundation/text/utf8.js";
import { DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF, DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF, DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF, DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF, DEMAND_EVENT_STREAM_COMMITS_ROOT_REF, DEMAND_EVENT_STREAM_INDEX_ROOT_REF, } from "../../governance/demand/event-sourcing/demand-event-sourcing-paths.js";
import { demandFinalRootRef } from "../../governance/demand/publication/demand-publication-paths.js";
import { TASK_PACKAGE_PROJECTIONS_ROOT_REF } from "../../governance/tasking/task-package-projection-paths.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import { demandArchiveRef, demandArchivesRootRef, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, } from "../../kernel/layout.js";
import { computePayloadTreeDigest, isArchivePayloadPath } from "./decide.js";
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
/** Demand 根与归档负载共用的树容量；超出即拒绝归档，不做部分归档。 */
const DEMAND_TREE_CAPACITY = Object.freeze({
    maximumEntries: 8192,
    maximumDepth: 24,
    maximumFiles: 4096,
    maximumFileBytes: parseByteCount(16 * 1024 * 1024, "$tree.maximumFileBytes"),
    maximumTotalBytes: parseByteCount(256 * 1024 * 1024, "$tree.maximumTotalBytes"),
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
/** 基础层错误统一收敛：中止、来源变化与其余 I/O 失败各归一类。 */
export function mapFoundationError(error, label, path) {
    if (error instanceof WakeflowError)
        throw error;
    const reason = reasonOf(error);
    if (reason === null)
        throw error;
    if (reason === "aborted")
        fail("io-failure", "aborted", "$signal", { cause: error });
    if (reason === "source-changed" || reason === "stream-changed") {
        fail("concurrency-conflict", `${label}-${reason}`, path, { cause: error, retryable: true });
    }
    fail("io-failure", `${label}-${reason}`, path, { cause: error });
}
function signalOptions(signal) {
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
/** 能解码为 UTF-8 的负载文件文本，供凭证扫描；二进制文件跳过。 */
export function payloadTexts(files) {
    const texts = [];
    for (const file of files) {
        try {
            texts.push(Object.freeze({
                resourcePath: file.resourcePath,
                text: decodeUtf8(file.bytes, "$payload"),
            }));
        }
        catch {
            // 非 UTF-8 内容不是文本，凭证扫描不适用。
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
async function existingArchive(ledgerRoot, archiveRef, payloadTreeDigest, signal) {
    const existing = await readArchiveManifest(ledgerRoot, archiveRef, signal);
    if (existing === null)
        return null;
    if (existing.payload.treeDigest !== payloadTreeDigest) {
        fail("precondition-failed", "archive-conflict", "$archive");
    }
    return Object.freeze({ disposition: "current", archiveRef, manifest: existing });
}
/** 封归档包：候选目录整树落盘再重命名到最终位置；同负载重放为 `current`。 */
export async function sealDemandArchive(ledgerRoot, input, signal) {
    const archiveRef = demandArchiveRef(input.demandId, input.streamRevision);
    const payloadDigest = computePayloadTreeDigest(input.payload.map((file) => ({
        resourcePath: file.resourcePath,
        byteCount: file.bytes.byteLength,
        digest: file.digest,
    })));
    const current = await existingArchive(ledgerRoot, archiveRef, payloadDigest, signal);
    if (current !== null)
        return current;
    const reportBytes = renderJson(input.verifyReport, "$verify");
    const manifest = input.manifest(Object.freeze({
        treeDigest: payloadDigest,
        fileCount: input.payload.length,
        totalBytes: input.payload.reduce((total, file) => total + file.bytes.byteLength, 0),
        excluded: [
            "event-sourcing/snapshots",
            "event-sourcing/index",
            "event-sourcing/append-candidates",
        ],
    }), computeCanonicalJsonSha256Digest(parseJsonValue(input.verifyReport, "$verify")));
    if (reportBytes.byteLength === 0)
        fail("unexpected", "verify-report-empty", "$verify");
    const parent = demandArchivesRootRef(input.demandId);
    const candidateRef = parsePortableResourcePath(`${parent}/.candidate-${String(input.streamRevision).padStart(10, "0")}-${randomUUID()}`, "$archive");
    try {
        await materializeDirectoryPath(ledgerRoot, parent, {
            mode: ARCHIVE_DIRECTORY_MODE,
            ...signalOptions(signal),
        });
        const candidate = await createDirectoryTreeCandidateDurably(ledgerRoot, candidateRef, archiveFiles(input, manifest), {
            ...DEMAND_TREE_CAPACITY,
            directoryMode: ARCHIVE_DIRECTORY_MODE,
            ...signalOptions(signal),
        });
        try {
            await publishDirectoryTreeCandidateDurably(ledgerRoot, candidate, archiveRef, signalOptions(signal));
        }
        catch (error) {
            if (reasonOf(error) !== "destination-exists")
                throw error;
            await retireDirectoryTreeCandidateDurably(ledgerRoot, candidate, signalOptions(signal));
            const raced = await existingArchive(ledgerRoot, archiveRef, payloadDigest, signal);
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
const REBUILDABLE_DIRECTORIES = Object.freeze([
    DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
    DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
    DEMAND_EVENT_STREAM_INDEX_ROOT_REF,
    DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF,
    DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF,
    TASK_PACKAGE_PROJECTIONS_ROOT_REF,
    DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
]);
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
/** 从归档负载恢复活动根（0700/0600），再补齐可重建的空目录；根已存在为 `current`。 */
export async function restoreDemandRoot(workspaceRoot, demandId, payload, signal) {
    if (await demandRootExists(workspaceRoot, demandId))
        return "current";
    const destination = demandFinalRootRef(demandId);
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
            if (reasonOf(error) !== "destination-exists")
                throw error;
            await retireDirectoryTreeCandidateDurably(workspaceRoot, candidate, signalOptions(signal));
            return "current";
        }
        for (const directory of REBUILDABLE_DIRECTORIES) {
            await materializeDirectoryPath(workspaceRoot, parsePortableResourcePath(`${destination}/${directory}`, "$demandRoot"), { mode: ACTIVE_DIRECTORY_MODE, ...signalOptions(signal) });
        }
    }
    catch (error) {
        mapFoundationError(error, "demand-root-restore", "$demandRoot");
    }
    return "restored";
}
/**
 * 删除活动根：只在根内负载摘要等于已封归档的负载摘要、且树里只有普通文件与目录时执行。
 * 这是本仓库唯一一处递归删除用户内容的地方（其余递归删除只清理本进程自建的候选目录与回执）；
 * 归档已经是这些字节的权威副本。
 */
export async function retireDemandRoot(workspaceRoot, demandId, expectedPayloadTreeDigest, signal) {
    let observation;
    try {
        observation = await workspaceRoot.inspectExistingResource(demandFinalRootRef(demandId), "$demandRoot");
    }
    catch (error) {
        if (isNotFound(error))
            return "absent";
        mapFoundationError(error, "demand-root-inspect", "$demandRoot");
    }
    if (observation.node.kind !== "directory") {
        fail("precondition-failed", "demand-root-not-directory", "$demandRoot");
    }
    let demandRoot;
    try {
        demandRoot = await RootedDirectory.open(observation.physicalPath, "$demandRoot");
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
    if (snapshot === undefined || snapshot.payloadTreeDigest !== expectedPayloadTreeDigest) {
        fail("precondition-failed", "demand-root-drift", "$demandRoot", { retryable: true });
    }
    try {
        await rm(observation.physicalPath, { recursive: true, force: false });
    }
    catch (error) {
        fail("io-failure", "demand-root-remove", "$demandRoot", { cause: error });
    }
    if (await demandRootExists(workspaceRoot, demandId)) {
        fail("io-failure", "demand-root-remove-incomplete", "$demandRoot");
    }
    return "retired";
}
