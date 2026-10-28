import { types } from "node:util";
import { DeterministicJsonDocumentError } from "../foundation/data/deterministic-json-document.js";
import { PassiveOwnDataError, parsePlainRecord } from "../foundation/data/passive-own-data.js";
import { readDeterministicJsonFile } from "../foundation/filesystem/deterministic-json-file.js";
import { parsePortableResourcePath, } from "../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { buildWakeflowConfigIndexes, computeWakeflowConfigDigest, parseWakeflowConfig, WakeflowConfigError, } from "./wakeflow-config.js";
import { renderWakeflowConfig } from "./wakeflow-config-document.js";
import { validateWakeflowConfigRootPlacements, WakeflowConfigRootPlacementError, } from "./wakeflow-config-root-placement.js";
/**
 * Wakeflow Configuration：单次操作范围内的 配置权威快照。
 *
 * 本文件从调用方已经打开的 RootedDirectory 固定读取 `wakeflow.config.json`，绑定
 * 同一次稳定读取的节点、字节数和源摘要，再完成严格 UTF-8/JSON、公开 Schema、
 * 类型化引用、根目录位置和常用索引校验。源摘要证明文件表示字节，配置摘要证明
 * 规范化 JSON 语义；两者不能互相替代。
 *
 * 快照不缓存“当前 Workspace”，也不保证返回后文件继续不变。任何写入职责所有者
 * 必须在自己的互斥锁或比较并交换边界内重新加载，并核对源快照和配置摘要。
 */
export const WAKEFLOW_CONFIG_FILE_REF = parsePortableResourcePath("wakeflow.config.json");
/**
 * detach-workspace 的终态（ADR-0024）：`wakeflow.config.json` 原样改名到这里，字节、权限与摘要不变。
 * 它是有意留下的证据——status / verify 以它为只读来源报 detached；重新启用要用户显式移走它。
 */
export const WAKEFLOW_DETACHED_CONFIG_FILE_REF = parsePortableResourcePath("wakeflow.detached.json");
export const WAKEFLOW_CONFIG_MAXIMUM_BYTES = parseByteCount(1024 * 1024);
export const WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE = 0o644;
const ERROR_MESSAGES = {
    input: "Wakeflow config authority snapshot input is invalid.",
    "root-scope": "Wakeflow config workspace root could not be held stable.",
    source: "Wakeflow canonical config source is unavailable or unsafe.",
    "source-policy": "Wakeflow canonical config source violates its node policy.",
    "source-changed": "Wakeflow canonical config changed during snapshot loading.",
    encoding: "Wakeflow canonical config is not strict UTF-8 text.",
    json: "Wakeflow canonical config is not valid JSON.",
    representation: "Wakeflow canonical config does not use its deterministic domain representation.",
    config: "Wakeflow canonical config is not the strict public authority.",
    placement: "Wakeflow canonical config declares unsafe root placements.",
    aborted: "Wakeflow config authority snapshot loading was aborted.",
    "load-failure": "Wakeflow config authority snapshot failed closed.",
};
/** 配置权威快照失败时返回的稳定、脱敏错误。 */
export class WakeflowConfigAuthoritySnapshotError extends Error {
    name = "WakeflowConfigAuthoritySnapshotError";
    code = "wakeflow-config-authority-snapshot";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowConfigAuthoritySnapshotError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function isAbortSignal(value) {
    return (typeof value === "object" &&
        value !== null &&
        !types.isProxy(value) &&
        value instanceof AbortSignal);
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
    if (Object.keys(record).some((key) => key !== "signal")) {
        fail("input", "$options");
    }
    if (record.signal !== undefined && !isAbortSignal(record.signal)) {
        fail("input", "$options.signal");
    }
    return Object.freeze({ signal: record.signal });
}
function mapStableReadError(error) {
    if (error.reason === "input")
        fail("input", error.path);
    if (error.reason === "root-scope")
        fail("root-scope", "$root");
    if (error.reason === "source-changed")
        fail("source-changed", "$source");
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    fail("source", "$source");
}
function mapStrictTextError(error) {
    if (error.reason === "utf8" || error.reason === "bom") {
        fail("encoding", "$source");
    }
    fail("representation", "$source");
}
function mapDeterministicJsonError(error) {
    if (error.reason === "json-syntax")
        fail("json", "$document");
    if (error.reason === "non-deterministic") {
        fail("representation", "$document");
    }
    fail("config", error.path);
}
async function readConfigSource(root, resourcePath, signal) {
    const options = {
        maximumBytes: WAKEFLOW_CONFIG_MAXIMUM_BYTES,
        ...(signal === undefined ? {} : { signal }),
    };
    try {
        return await readDeterministicJsonFile(root, resourcePath, options);
    }
    catch (error) {
        if (error instanceof StableFileReadError)
            mapStableReadError(error);
        if (error instanceof StrictTextFileError)
            mapStrictTextError(error);
        if (error instanceof DeterministicJsonDocumentError) {
            mapDeterministicJsonError(error);
        }
        throw error;
    }
}
/** 同 readConfigSource，但文件不在时返回 null 而不是 `source` 错误。 */
async function readConfigSourceOrNull(root, resourcePath, signal) {
    try {
        return await readConfigSource(root, resourcePath, signal);
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError &&
            error.reason === "source" &&
            !(await resourceExists(root, resourcePath))) {
            return null;
        }
        throw error;
    }
}
async function resourceExists(root, resourcePath) {
    try {
        await root.inspectExistingResource(resourcePath, "$source");
        return true;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
            return false;
        }
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root");
        throw error;
    }
}
function assertSourcePolicy(node) {
    let currentUserId = null;
    if (typeof process.geteuid === "function") {
        try {
            currentUserId = BigInt(process.geteuid());
        }
        catch {
            fail("source-policy", "$source");
        }
    }
    if (node.linkCount !== 1n ||
        node.permissionBits !== WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE ||
        (currentUserId !== null && node.userId !== currentUserId)) {
        fail("source-policy", "$source");
    }
}
function parseConfigModel(value) {
    try {
        return parseWakeflowConfig(value);
    }
    catch (error) {
        if (error instanceof WakeflowConfigError)
            fail("config", error.path);
        throw error;
    }
}
async function validatePlacements(root, model) {
    try {
        return await validateWakeflowConfigRootPlacements(root, model);
    }
    catch (error) {
        if (error instanceof WakeflowConfigRootPlacementError) {
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            fail("placement", error.path);
        }
        throw error;
    }
}
function requiredLedgerRoot(placements) {
    const ledger = placements.roots.find((entry) => entry.key === "ledger.root");
    if (ledger === undefined)
        fail("placement", "$placements");
    return ledger.absolutePath;
}
/** 源字节到模型与摘要：节点政策、严格表示与配置文法三道准入，配置文件与退役文件相同。 */
function admitConfigRecord(read) {
    assertSourcePolicy(read.node);
    const model = parseConfigModel(read.value);
    if (renderWakeflowConfig(model) !== read.text) {
        fail("representation", "$document");
    }
    return Object.freeze({
        source: Object.freeze({
            resourcePath: read.resourcePath,
            node: read.node,
            byteCount: read.byteCount,
            digest: read.digest,
        }),
        model,
        configDigest: computeWakeflowConfigDigest(model),
    });
}
async function loadSnapshot(root, options, resourcePath) {
    const record = admitConfigRecord(await readConfigSource(root, resourcePath, options.signal));
    const placements = await validatePlacements(root, record.model);
    return Object.freeze({
        workspaceRoot: root.absolutePath,
        source: record.source,
        model: record.model,
        indexes: buildWakeflowConfigIndexes(record.model),
        configDigest: record.configDigest,
        placements,
        ledgerRoot: requiredLedgerRoot(placements),
    });
}
function mapLoadFailure(error) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError)
        throw error;
    throw new WakeflowConfigAuthoritySnapshotError("load-failure", "$snapshot");
}
/** 从已经打开的 Workspace 根目录读取并构造完整的 配置权威快照。 */
export async function readWakeflowConfigAuthoritySnapshot(root, options) {
    try {
        assertRoot(root);
        const parsed = parseOptions(options);
        if (parsed.signal?.aborted === true)
            fail("aborted", "$signal");
        return await loadSnapshot(root, parsed, WAKEFLOW_CONFIG_FILE_REF);
    }
    catch (error) {
        mapLoadFailure(error);
    }
}
/**
 * 以 `wakeflow.detached.json` 为只读来源构造完整快照（ADR-0024 终态）：status / verify 用它说
 * "这里曾是 Wakeflow 工作区"；文件不在即 `source`，与配置文件缺失同一准入。
 */
export async function readWakeflowDetachedConfigSnapshot(root, options) {
    try {
        assertRoot(root);
        const parsed = parseOptions(options);
        if (parsed.signal?.aborted === true)
            fail("aborted", "$signal");
        return await loadSnapshot(root, parsed, WAKEFLOW_DETACHED_CONFIG_FILE_REF);
    }
    catch (error) {
        mapLoadFailure(error);
    }
}
/**
 * 读退役配置记录：不在即 null；在但读不出、不是当前用户的 0644 单链接文件或不是严格 Config 表示即抛。
 * 维护事务的终态核对与恢复用它——它不验证根放置，所以用户清走账本或支撑面之后仍能读出摘要。
 */
export async function readWakeflowDetachedConfigRecord(root, options) {
    try {
        assertRoot(root);
        const parsed = parseOptions(options);
        if (parsed.signal?.aborted === true)
            fail("aborted", "$signal");
        const read = await readConfigSourceOrNull(root, WAKEFLOW_DETACHED_CONFIG_FILE_REF, parsed.signal);
        return read === null ? null : admitConfigRecord(read);
    }
    catch (error) {
        mapLoadFailure(error);
    }
}
