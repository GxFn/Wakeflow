import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../foundation/data/passive-own-data.js";
import { createFileAtomically, DurableAtomicFileWriteError, } from "../foundation/filesystem/durable-atomic-file-write.js";
import { sameFileNodeSnapshot, } from "../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory, } from "../foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import { readWakeflowConfigAuthoritySnapshot, WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE, WAKEFLOW_CONFIG_FILE_REF, WAKEFLOW_CONFIG_MAXIMUM_BYTES, } from "./wakeflow-config-authority-snapshot.js";
import { validateWakeflowConfigRootPlacements, WakeflowConfigRootPlacementError, } from "./wakeflow-config-root-placement.js";
import { computeWakeflowConfigDigest, parseWakeflowConfig, WakeflowConfigError, } from "./wakeflow-config.js";
import { renderWakeflowConfig } from "./wakeflow-config-document.js";
const ERROR_MESSAGES = {
    "input": "Wakeflow config authority publication input is invalid.",
    "unsupported-platform": "Wakeflow config authority publication requires reliable local POSIX ownership semantics.",
    "root-scope": "Wakeflow config authority publication lost its workspace root scope.",
    "root-policy": "Wakeflow config authority publication requires a current-user workspace root.",
    "config": "Wakeflow config authority publication requires one strict model.",
    "capacity": "Wakeflow config authority publication exceeds its recoverable byte limit.",
    "placement": "Wakeflow config authority publication declares an unsafe root placement.",
    "target-exists": "Wakeflow config authority already exists.",
    "aborted": "Wakeflow config authority publication was aborted before commit.",
    "publication-failure": "Wakeflow config authority could not be published safely.",
    "commit-uncertain": "Published Wakeflow config authority could not be proven exact.",
};
/** Config 首次发布失败时返回的稳定、脱敏错误。 */
export class WakeflowConfigAuthorityPublicationError extends Error {
    name = "WakeflowConfigAuthorityPublicationError";
    code = "wakeflow-config-authority-publication";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowConfigAuthorityPublicationError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function isAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
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
        || (record.signal !== undefined && !isAbortSignal(record.signal))) {
        fail("input", "$options");
    }
    return Object.freeze({
        signal: record.signal,
    });
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function currentEffectiveUserId() {
    if (process.platform === "win32" || typeof process.geteuid !== "function") {
        fail("unsupported-platform", "$root");
    }
    return BigInt(process.geteuid());
}
async function assertCurrentUserRoot(root, expectedUserId) {
    try {
        const node = await root.assertCurrent("$root");
        if (node.userId !== expectedUserId)
            fail("root-policy", "$root");
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthorityPublicationError)
            throw error;
        fail("root-scope", "$root");
    }
}
function parseModel(value) {
    try {
        return parseWakeflowConfig(value);
    }
    catch (error) {
        if (error instanceof WakeflowConfigError)
            fail("config", error.path);
        fail("config", "$config");
    }
}
function renderModelBytes(model) {
    let bytes;
    try {
        bytes = encodeUtf8(renderWakeflowConfig(model), "$config");
    }
    catch {
        fail("config", "$config");
    }
    if (bytes.byteLength > WAKEFLOW_CONFIG_MAXIMUM_BYTES) {
        fail("capacity", "$config");
    }
    return bytes;
}
async function assertPlacements(root, model) {
    try {
        await validateWakeflowConfigRootPlacements(root, model);
    }
    catch (error) {
        if (error instanceof WakeflowConfigRootPlacementError) {
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            if (error.reason === "input")
                fail("input", error.path);
            fail("placement", error.path);
        }
        fail("placement", "$placements");
    }
}
function computeModelDigest(model) {
    try {
        return computeWakeflowConfigDigest(model);
    }
    catch {
        fail("config", "$config");
    }
}
function mapAtomicWriteError(error) {
    if (error.reason === "target-exists") {
        fail("target-exists", "$resourcePath");
    }
    if (error.reason === "input")
        fail("input", error.path);
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "capacity")
        fail("capacity", "$config");
    if (error.reason === "root-scope"
        || error.reason === "parent-changed") {
        fail("root-scope", "$root");
    }
    if (error.reason === "commit-uncertain"
        || error.reason === "durability-failure"
        || error.reason === "stage-cleanup-failure"
        || error.reason === "close-failure") {
        fail("commit-uncertain", "$resourcePath");
    }
    fail("publication-failure", "$resourcePath");
}
async function publishBytes(root, bytes, signal) {
    try {
        return await createFileAtomically(root, WAKEFLOW_CONFIG_FILE_REF, bytes, {
            mode: WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError) {
            mapAtomicWriteError(error);
        }
        fail("publication-failure", "$resourcePath");
    }
}
async function readBackCommittedAuthority(root) {
    try {
        return await readWakeflowConfigAuthoritySnapshot(root);
    }
    catch {
        fail("commit-uncertain", "$resourcePath");
    }
}
function assertReadback(publication, authority, expectedConfigDigest, expectedUserId) {
    if (publication.resourcePath !== WAKEFLOW_CONFIG_FILE_REF
        || publication.node.kind !== "file"
        || publication.node.permissionBits !== WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE
        || publication.node.linkCount !== 1n
        || publication.node.userId !== expectedUserId
        || authority.source.resourcePath !== publication.resourcePath
        || authority.source.byteCount !== publication.byteCount
        || authority.source.digest !== publication.digest
        || !sameFileNodeSnapshot(authority.source.node, publication.node)
        || authority.configDigest !== expectedConfigDigest) {
        fail("commit-uncertain", "$resourcePath");
    }
}
/**
 * 从严格模型持久创建此前不存在的 `wakeflow.config.json`。
 *
 * 只有 Foundation 已同步文件与父目录，且 Config Snapshot 回读同一物理节点和语义
 * 权威事实后，函数才返回成功。任意现存目标一律拒绝；本入口不提供确保存在、替换
 * 或隐式修复语义。
 */
export async function publishWakeflowConfigAuthority(root, modelValue, options) {
    assertRoot(root);
    const parsed = parseOptions(options);
    assertNotAborted(parsed.signal);
    const expectedUserId = currentEffectiveUserId();
    const model = parseModel(modelValue);
    const bytes = renderModelBytes(model);
    const expectedConfigDigest = computeModelDigest(model);
    await assertCurrentUserRoot(root, expectedUserId);
    await assertPlacements(root, model);
    // 位置检查可能触及多个同级根目录；提交前再次确认 Workspace 根目录所有者和当前状态。
    await assertCurrentUserRoot(root, expectedUserId);
    assertNotAborted(parsed.signal);
    const publication = await publishBytes(root, bytes, parsed.signal);
    // 发布已经跨过不替换目标的提交点；此后的失败不能再表述为“提交前已取消”。
    const authority = await readBackCommittedAuthority(root);
    assertReadback(publication, authority, expectedConfigDigest, expectedUserId);
    return Object.freeze({
        publication,
        authority,
    });
}
