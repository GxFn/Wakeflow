import { types } from "node:util";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { createFileAtomically, DurableAtomicFileWriteError, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { materializeDirectoryPath, DurableDirectoryMaterializationError, } from "../../foundation/filesystem/durable-directory-materialization.js";
import { readDeterministicJsonFile, } from "../../foundation/filesystem/deterministic-json-file.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { admitWakeflowResourceOperation, WakeflowResourceProcessingContractError, } from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { createDemandEventSourcingResourceCatalog, createTaskPackageProjectionResourceDeclaration, } from "../demand/demand-resource-catalog.js";
import { DemandEventSourcingRepository, DemandEventSourcingRepositoryError, } from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import { computeTaskPackageDigest, parseTaskPackageDocument, renderTaskPackage, TaskPackageError, } from "./task-package.js";
import { taskPackageProjectionRef, TASK_PACKAGE_PROJECTIONS_ROOT_REF, } from "./task-package-projection-paths.js";
/**
 * Wakeflow Governance / Tasking：事件权威 TaskPackage 的根作用域文件投影存储。
 *
 * `materialize` 先完整审计 Demand 事件流并定位唯一
 * `tasking.target-task-planned`，随后才在固定 ID 路径执行不替换的原子创建。相同请求
 * 可以幂等修复缺失投影；已有字节若与事件不同则直接冲突，绝不覆盖或反向修改事件。
 *
 * `load` 是带事件派生摘要预期的快速读取入口。投影文件始终是 disposable read model，
 * 不是第二份 TaskPackage 权威，也不证明任务已经 Delivery、Claim 或完成。
 */
export const TASK_PACKAGE_PROJECTION_DIRECTORY_MODE = 0o700;
export const TASK_PACKAGE_PROJECTION_FILE_MODE = 0o600;
export const TASK_PACKAGE_PROJECTION_MAXIMUM_BYTES = parseByteCount(16 * 1024 * 1024, "$taskPackageProjection.maximumBytes");
const ERROR_MESSAGES = {
    input: "TaskPackage projection store input is invalid.",
    "projection-not-found": "TaskPackage projection does not exist.",
    "authority-not-found": "TaskPackage planning event does not exist.",
    authority: "TaskPackage projection source event stream is invalid.",
    conflict: "TaskPackage projection conflicts with its source event.",
    "node-policy": "TaskPackage projection resource violates private node policy.",
    capacity: "TaskPackage projection exceeds its capacity.",
    "recovery-required": "TaskPackage projection publication requires recovery.",
    "commit-uncertain": "TaskPackage projection publication cannot prove its commit.",
    "root-scope": "TaskPackage projection store lost its rooted scope.",
    aborted: "TaskPackage projection operation was aborted.",
    "operation-failure": "TaskPackage projection operation failed.",
};
/** 并发 create 的胜者在 stage 退休前让目标短暂拥有两个硬链接；败者有界重读而不是失败。 */
const CONCURRENT_PUBLICATION_RETRY_DELAYS_MS = Object.freeze([
    1, 2, 4, 8, 16, 32, 64, 128, 256,
]);
async function loadCurrentProjection(root, taskPackageId, taskPackageDigest, disposition, signal) {
    for (const [attempt, delay] of CONCURRENT_PUBLICATION_RETRY_DELAYS_MS.entries()) {
        try {
            return await loadProjection(root, taskPackageId, taskPackageDigest, signal);
        }
        catch (error) {
            if (disposition !== "current"
                || !(error instanceof TaskPackageProjectionStoreError)
                || error.reason !== "recovery-required"
                || attempt === CONCURRENT_PUBLICATION_RETRY_DELAYS_MS.length - 1) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    return loadProjection(root, taskPackageId, taskPackageDigest, signal);
}
export class TaskPackageProjectionStoreError extends Error {
    name = "TaskPackageProjectionStoreError";
    code = "wakeflow-task-package-projection-store";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new TaskPackageProjectionStoreError(reason, path);
}
function parseTaskPackageId(value) {
    try {
        return parseWakeflowDurableIdOfKind(value, "task-package", "$taskPackageId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError) {
            fail("input", "$taskPackageId");
        }
        throw error;
    }
}
function parseSignal(value, allowed) {
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => !allowed.has(key))
        || (record.signal !== undefined
            && (typeof record.signal !== "object"
                || record.signal === null
                || types.isProxy(record.signal)
                || !(record.signal instanceof AbortSignal)))) {
        fail("input", "$options");
    }
    return Object.freeze({
        record,
        signal: record.signal,
    });
}
function parseLoadOptions(value) {
    const parsed = parseSignal(value, new Set(["expectedTaskPackageDigest", "signal"]));
    if (!Object.hasOwn(parsed.record, "expectedTaskPackageDigest")) {
        fail("input", "$options/expectedTaskPackageDigest");
    }
    let expectedTaskPackageDigest;
    try {
        expectedTaskPackageDigest = parseSha256Digest(parsed.record.expectedTaskPackageDigest, "$options/expectedTaskPackageDigest");
    }
    catch (error) {
        if (error instanceof Sha256Error) {
            fail("input", "$options/expectedTaskPackageDigest");
        }
        throw error;
    }
    return Object.freeze({
        expectedTaskPackageDigest,
        signal: parsed.signal,
    });
}
function parseMaterializeOptions(value) {
    const parsed = parseSignal(value, new Set(["signal"]));
    return Object.freeze({ signal: parsed.signal });
}
function currentUserId() {
    return typeof process.geteuid === "function"
        ? BigInt(process.geteuid())
        : null;
}
function assertPrivateNode(node, kind, path) {
    if (kind === "file"
        && node.kind === "file"
        && node.permissionBits === TASK_PACKAGE_PROJECTION_FILE_MODE
        && node.linkCount === 2n
        && (currentUserId() === null || node.userId === currentUserId())) {
        // 原子 create 的已发布目标在 stage 退休前短暂拥有两个硬链接；调用方必须重试，
        // 不能在提交者尚未完成耐久结算时把它宣布为 current。
        fail("recovery-required", path);
    }
    if (node.kind !== kind
        || node.permissionBits !== (kind === "file"
            ? TASK_PACKAGE_PROJECTION_FILE_MODE
            : TASK_PACKAGE_PROJECTION_DIRECTORY_MODE)
        || (kind === "file" && node.linkCount !== 1n)
        || (currentUserId() !== null && node.userId !== currentUserId())) {
        fail("node-policy", path);
    }
}
async function projectionNodeOrNull(root, taskPackageId) {
    try {
        return (await root.inspectExistingResource(taskPackageProjectionRef(taskPackageId))).node;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError
            && error.reason === "resource-not-found") {
            return null;
        }
        if (error instanceof RootedDirectoryError) {
            if (error.reason === "ancestor-symlink"
                || error.reason === "ancestor-type"
                || error.reason === "resource-alias") {
                fail("node-policy", "$projection");
            }
            // 并发发布者退休 stage 时目标的链接数在观察中途变化；这是要重试的瞬态，不是根失效。
            if (error.reason === "resource-changed") {
                fail("recovery-required", "$projection");
            }
            fail("root-scope", "$root");
        }
        throw error;
    }
}
function mapProjectionReadError(error) {
    if (error instanceof StableFileReadError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        if (error.reason === "not-found") {
            fail("projection-not-found", "$projection");
        }
        if (error.reason === "root-scope"
            || error.reason === "unsupported-platform") {
            fail("root-scope", "$root");
        }
        if (error.reason === "expectation-changed"
            || error.reason === "source-changed") {
            fail("conflict", "$projection");
        }
        if (error.reason === "too-large")
            fail("capacity", "$projection");
        if (error.reason === "symlink" || error.reason === "not-file") {
            fail("node-policy", "$projection");
        }
        fail("operation-failure", "$projection");
    }
    if (error instanceof StrictTextFileError
        || error instanceof DeterministicJsonDocumentError
        || error instanceof TaskPackageError) {
        fail("conflict", "$projection");
    }
    throw error;
}
async function loadProjection(root, taskPackageId, expectedTaskPackageDigest, signal) {
    const resourcePath = taskPackageProjectionRef(taskPackageId);
    const node = await projectionNodeOrNull(root, taskPackageId);
    if (node === null)
        fail("projection-not-found", "$projection");
    assertPrivateNode(node, "file", "$projection");
    let source;
    try {
        source = await readDeterministicJsonFile(root, resourcePath, {
            maximumBytes: TASK_PACKAGE_PROJECTION_MAXIMUM_BYTES,
            expectedNode: node,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        mapProjectionReadError(error);
    }
    let taskPackage;
    try {
        taskPackage = parseTaskPackageDocument(source.text);
    }
    catch (error) {
        mapProjectionReadError(error);
    }
    const taskPackageDigest = computeTaskPackageDigest(taskPackage);
    if (taskPackage.taskPackageId !== taskPackageId
        || taskPackageDigest !== expectedTaskPackageDigest) {
        fail("conflict", "$projection");
    }
    return Object.freeze({ taskPackage, taskPackageDigest, source });
}
function mapRepositoryError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "input")
        fail("input", "$taskPackageId");
    fail("authority", "$events");
}
function admitProjectionOperations(taskPackage) {
    try {
        const rootDeclaration = createDemandEventSourcingResourceCatalog(taskPackage.demandId).find((entry) => (entry.declarationId
            === `demand.event-sourcing.${taskPackage.demandId}.task-packages-root`));
        if (rootDeclaration === undefined)
            fail("operation-failure", "$catalog");
        admitWakeflowResourceOperation(rootDeclaration.processing, "materialize-directory");
        admitWakeflowResourceOperation(createTaskPackageProjectionResourceDeclaration(taskPackage.demandId, taskPackage.taskPackageId).processing, "exclusive-create");
    }
    catch (error) {
        if (error instanceof TaskPackageProjectionStoreError)
            throw error;
        if (error instanceof WakeflowResourceProcessingContractError) {
            fail("operation-failure", "$catalog");
        }
        throw error;
    }
}
function mapDirectoryError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "root-scope"
        || error.reason === "parent-changed"
        || error.reason === "path-changed") {
        fail("root-scope", "$root");
    }
    if (error.reason === "target-symlink"
        || error.reason === "target-not-directory") {
        fail("node-policy", "$projectionRoot");
    }
    if (error.reason === "commit-uncertain"
        || error.reason === "durability-failure"
        || error.reason === "close-failure") {
        fail("commit-uncertain", "$projectionRoot");
    }
    fail("operation-failure", "$projectionRoot");
}
function mapAtomicWriteError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "root-scope"
        || error.reason === "parent-changed") {
        fail("root-scope", "$root");
    }
    if (error.reason === "capacity")
        fail("capacity", "$projection");
    if (error.reason === "stage-recovery-required") {
        fail("recovery-required", "$projection");
    }
    if (error.reason === "commit-uncertain"
        || error.reason === "durability-failure"
        || error.reason === "stage-cleanup-failure"
        || error.reason === "close-failure") {
        fail("commit-uncertain", "$projection");
    }
    fail("operation-failure", "$projection");
}
export class TaskPackageProjectionStore {
    #root;
    #repository;
    constructor(root) {
        if (typeof root !== "object"
            || root === null
            || types.isProxy(root)
            || !(root instanceof RootedDirectory)) {
            fail("input", "$root");
        }
        this.#root = root;
        this.#repository = new DemandEventSourcingRepository(root);
    }
    /** 按事件派生摘要预期快速读取一份已有 TaskPackage 投影。 */
    async load(taskPackageIdValue, optionsValue) {
        const taskPackageId = parseTaskPackageId(taskPackageIdValue);
        const options = parseLoadOptions(optionsValue);
        return loadProjection(this.#root, taskPackageId, options.expectedTaskPackageDigest, options.signal);
    }
    /**
     * 从唯一规划事件幂等创建或复验 TaskPackage 投影；缺失事件时没有任何写入副作用。
     */
    async materialize(taskPackageIdValue, optionsValue = {}) {
        const taskPackageId = parseTaskPackageId(taskPackageIdValue);
        const { signal } = parseMaterializeOptions(optionsValue);
        let located;
        try {
            located = await this.#repository.findTargetTaskPlannedEvent(taskPackageId, signal === undefined ? undefined : { signal });
        }
        catch (error) {
            if (error instanceof DemandEventSourcingRepositoryError) {
                mapRepositoryError(error);
            }
            throw error;
        }
        if (located === null)
            fail("authority-not-found", "$events");
        const taskPackage = located.event.data.taskPackage;
        const taskPackageDigest = computeTaskPackageDigest(taskPackage);
        const desiredText = renderTaskPackage(taskPackage);
        const desiredBytes = encodeUtf8(desiredText, "$projection");
        if (desiredBytes.byteLength > TASK_PACKAGE_PROJECTION_MAXIMUM_BYTES) {
            fail("capacity", "$projection");
        }
        admitProjectionOperations(taskPackage);
        let projectionRoot;
        try {
            projectionRoot = await materializeDirectoryPath(this.#root, TASK_PACKAGE_PROJECTIONS_ROOT_REF, {
                mode: TASK_PACKAGE_PROJECTION_DIRECTORY_MODE,
                ...(signal === undefined ? {} : { signal }),
            });
        }
        catch (error) {
            if (error instanceof DurableDirectoryMaterializationError) {
                mapDirectoryError(error);
            }
            throw error;
        }
        assertPrivateNode(projectionRoot.node, "directory", "$projectionRoot");
        const resourcePath = taskPackageProjectionRef(taskPackageId);
        let disposition = "created";
        try {
            await createFileAtomically(this.#root, resourcePath, desiredBytes, {
                mode: TASK_PACKAGE_PROJECTION_FILE_MODE,
                ...(signal === undefined ? {} : { signal }),
            });
        }
        catch (error) {
            if (error instanceof DurableAtomicFileWriteError
                && error.reason === "target-exists") {
                disposition = "current";
            }
            else if (error instanceof DurableAtomicFileWriteError) {
                mapAtomicWriteError(error);
            }
            else {
                throw error;
            }
        }
        let projection;
        try {
            projection = await loadCurrentProjection(this.#root, taskPackageId, taskPackageDigest, disposition, signal);
        }
        catch (error) {
            if (disposition === "created"
                && error instanceof TaskPackageProjectionStoreError) {
                fail("commit-uncertain", "$projection");
            }
            throw error;
        }
        if (projection.source.text !== desiredText) {
            fail(disposition === "created" ? "commit-uncertain" : "conflict", "$projection");
        }
        return Object.freeze({
            disposition,
            sourceEvent: Object.freeze({
                eventId: located.storedEvent.eventId,
                streamRevision: located.storedEvent.streamRevision,
            }),
            projection,
        });
    }
}
