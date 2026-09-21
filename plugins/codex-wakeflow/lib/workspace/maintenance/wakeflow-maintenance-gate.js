import { types } from "node:util";
import { threadId } from "node:worker_threads";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord, } from "../../foundation/data/passive-own-data.js";
import { DurableDirectoryMaterializationError, materializeDirectoryPath, } from "../../foundation/filesystem/durable-directory-materialization.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { inspectRootedExclusiveFileLock, RootedExclusiveFileLockError, withRootedExclusiveFileLock, } from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import { createWakeflowMaintenanceOperationId, parseWakeflowMaintenanceOperationId, WakeflowMaintenanceOperationIdError, wakeflowMaintenanceOperationUuid, } from "./wakeflow-maintenance-operation-id.js";
import { WAKEFLOW_MAINTENANCE_GATE_REF, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, WAKEFLOW_RUNTIME_ROOT_REF, } from "./wakeflow-maintenance-resource-catalog.js";
import { inspectWakeflowWorkspaceCoreLayout, WakeflowWorkspaceCoreLayoutInspectionError, } from "./wakeflow-workspace-core-layout-inspection.js";
const ERROR_MESSAGES = {
    input: "Wakeflow maintenance gate input is invalid.",
    "stale-preview": "Wakeflow maintenance core layout differs from preview.",
    "bootstrap-conflict": "Wakeflow maintenance bootstrap prefix is unsafe.",
    busy: "Another Wakeflow maintenance operation holds the gate.",
    "recovery-required": "Wakeflow maintenance gate requires explicit recovery.",
    aborted: "Wakeflow maintenance gate acquisition was aborted.",
    "effect-failure": "Wakeflow maintenance gate could not be established safely.",
};
/** Maintenance gate/bootstrap 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceGateError extends Error {
    name = "WakeflowMaintenanceGateError";
    code = "wakeflow-maintenance-gate";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const ACTIVE_CONTEXTS = new WeakSet();
const CONTEXT_ROOTS = new WeakMap();
const CONTEXT_CORE_INSPECTIONS = new WeakMap();
function fail(reason, path) {
    throw new WakeflowMaintenanceGateError(reason, path);
}
function admittedOperationId(value, path) {
    try {
        return parseWakeflowMaintenanceOperationId(value, path);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceOperationIdError) {
            fail("input", path);
        }
        throw error;
    }
}
function createOperationId(factory) {
    try {
        return factory === undefined
            ? createWakeflowMaintenanceOperationId()
            : createWakeflowMaintenanceOperationId(factory);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceOperationIdError) {
            fail("input", "$options.uuidFactory");
        }
        throw error;
    }
}
function positiveMilliseconds(value, path) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "number"
        || !Number.isSafeInteger(value)
        || value <= 0
        || value > 300_000) {
        fail("input", path);
    }
    return value;
}
function parseOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    const allowed = new Set([
        "acquireTimeoutMilliseconds",
        "bootstrap",
        "expectedCoreLayoutInspectionDigest",
        "operationId",
        "retryDelayMilliseconds",
        "signal",
        "uuidFactory",
    ]);
    if (!Object.hasOwn(record, "expectedCoreLayoutInspectionDigest")
        || Object.keys(record).some((key) => !allowed.has(key))
        || (record.signal !== undefined
            && (typeof record.signal !== "object"
                || record.signal === null
                || types.isProxy(record.signal)
                || !(record.signal instanceof AbortSignal)))
        || (record.uuidFactory !== undefined
            && (typeof record.uuidFactory !== "function"
                || types.isProxy(record.uuidFactory)))
        || (record.operationId !== undefined && record.uuidFactory !== undefined)) {
        fail("input", "$options");
    }
    if (record.bootstrap !== undefined
        && record.bootstrap !== "fresh"
        && record.bootstrap !== "repair") {
        fail("input", "$options.bootstrap");
    }
    let expectedCoreLayoutInspectionDigest;
    try {
        expectedCoreLayoutInspectionDigest = parseSha256Digest(record.expectedCoreLayoutInspectionDigest, "$options.expectedCoreLayoutInspectionDigest");
    }
    catch (error) {
        if (error instanceof Sha256Error) {
            fail("input", "$options.expectedCoreLayoutInspectionDigest");
        }
        throw error;
    }
    return Object.freeze({
        expectedCoreLayoutInspectionDigest,
        bootstrap: record.bootstrap === "repair" ? "repair" : "fresh",
        acquireTimeoutMilliseconds: positiveMilliseconds(record.acquireTimeoutMilliseconds, "$options.acquireTimeoutMilliseconds"),
        retryDelayMilliseconds: positiveMilliseconds(record.retryDelayMilliseconds, "$options.retryDelayMilliseconds"),
        signal: record.signal,
        uuidFactory: record.uuidFactory,
        operationId: record.operationId === undefined
            ? undefined
            : admittedOperationId(record.operationId, "$options.operationId"),
    });
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function assertOperation(value) {
    if (typeof value !== "function" || types.isProxy(value)) {
        fail("input", "$operation");
    }
}
async function materialize(root, resourcePath, signal) {
    try {
        await materializeDirectoryPath(root, resourcePath, {
            mode: 0o700,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryMaterializationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("effect-failure", "$bootstrap");
        }
        throw error;
    }
}
function mapLockError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "timeout")
        fail("busy", "$gate");
    if (error.reason === "owner-active"
        || error.reason === "residue-changed"
        || error.reason === "release-failure") {
        fail("recovery-required", "$gate");
    }
    if (error.reason === "input")
        fail("input", error.path);
    fail("bootstrap-conflict", "$gate");
}
/**
 * 解析一个仍在当前 gate callback 内有效的 context，并验证它属于指定 Workspace 根。
 */
export function assertWakeflowMaintenanceGateContext(value, root) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !ACTIVE_CONTEXTS.has(value)
        || CONTEXT_ROOTS.get(value) !== root) {
        fail("input", "$context");
    }
}
/** 返回normal gate在取得exact lock后重验过的pre-gate Core Layout观察。 */
export function wakeflowMaintenanceCoreInspectionForGateContext(value, root) {
    assertWakeflowMaintenanceGateContext(value, root);
    const inspection = CONTEXT_CORE_INSPECTIONS.get(value);
    if (inspection === undefined)
        fail("input", "$context");
    return inspection;
}
async function runCorrelatedGate(root, operationId, options, operation, prepare) {
    const operationUuid = wakeflowMaintenanceOperationUuid(operationId);
    const expectedLockToken = `${process.pid}-${threadId}-${operationUuid}`;
    try {
        return await withRootedExclusiveFileLock(root, WAKEFLOW_MAINTENANCE_GATE_REF, async () => {
            const admittedCoreInspection = await prepare?.(expectedLockToken);
            const context = Object.freeze({
                operationId,
            });
            ACTIVE_CONTEXTS.add(context);
            CONTEXT_ROOTS.set(context, root);
            if (admittedCoreInspection !== undefined) {
                CONTEXT_CORE_INSPECTIONS.set(context, admittedCoreInspection);
            }
            try {
                return await operation(context);
            }
            finally {
                ACTIVE_CONTEXTS.delete(context);
                CONTEXT_ROOTS.delete(context);
                CONTEXT_CORE_INSPECTIONS.delete(context);
            }
        }, {
            ...(options.acquireTimeoutMilliseconds === undefined
                ? {}
                : { acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds }),
            ...(options.retryDelayMilliseconds === undefined
                ? {}
                : { retryDelayMilliseconds: options.retryDelayMilliseconds }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            tokenUuidFactory: () => operationUuid,
        });
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceGateError)
            throw error;
        if (error instanceof RootedExclusiveFileLockError)
            mapLockError(error);
        throw error;
    }
}
/**
 * 在调用方已经验证 prepared journal / recovery evidence 后，以原 operation ID 取得 gate。
 */
export function parseWakeflowExistingMaintenanceGateOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => (key !== "acquireTimeoutMilliseconds"
        && key !== "retryDelayMilliseconds"
        && key !== "signal"))) {
        fail("input", "$options");
    }
    const signal = record.signal;
    if (signal !== undefined
        && (typeof signal !== "object"
            || signal === null
            || types.isProxy(signal)
            || !(signal instanceof AbortSignal))) {
        fail("input", "$options.signal");
    }
    const acquireTimeoutMilliseconds = positiveMilliseconds(record.acquireTimeoutMilliseconds, "$options.acquireTimeoutMilliseconds");
    const retryDelayMilliseconds = positiveMilliseconds(record.retryDelayMilliseconds, "$options.retryDelayMilliseconds");
    return Object.freeze({
        ...(acquireTimeoutMilliseconds === undefined
            ? {}
            : { acquireTimeoutMilliseconds }),
        ...(retryDelayMilliseconds === undefined
            ? {}
            : { retryDelayMilliseconds }),
        ...(signal === undefined ? {} : { signal: signal }),
    });
}
export async function withExistingWakeflowMaintenanceGate(rootValue, operationIdValue, operationValue, optionsValue = {}) {
    assertRoot(rootValue);
    assertOperation(operationValue);
    const operationId = admittedOperationId(operationIdValue, "$operationId");
    const options = parseWakeflowExistingMaintenanceGateOptions(optionsValue);
    return runCorrelatedGate(rootValue, operationId, {
        acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds,
        retryDelayMilliseconds: options.retryDelayMilliseconds,
        signal: options.signal,
    }, operationValue);
}
async function admitLockedCoreInspection(root, before, expectedLockToken, signal) {
    let lock;
    try {
        lock = await inspectRootedExclusiveFileLock(root, WAKEFLOW_MAINTENANCE_GATE_REF);
    }
    catch (error) {
        if (error instanceof RootedExclusiveFileLockError)
            mapLockError(error);
        throw error;
    }
    if (lock.status !== "held"
        || lock.ownerState !== "active"
        || lock.record.token !== expectedLockToken) {
        fail("recovery-required", "$gate");
    }
    let after;
    try {
        after = await inspectWakeflowWorkspaceCoreLayout(root, signal === undefined ? {} : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceCoreLayoutInspectionError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("bootstrap-conflict", "$bootstrap");
        }
        throw error;
    }
    if (after.active.status !== before.active.status
        || after.active.nodeDigest !== before.active.nodeDigest) {
        fail("stale-preview", "$activeLayout");
    }
    if (after.local.status !== "busy"
        || !after.local.protocolComplete
        || after.issueCodes.length !== 0) {
        fail(after.issueCodes.some((code) => (code === "maintenance-transaction-residue"
            || code === "maintenance-gate-stage-residue"))
            ? "recovery-required"
            : "bootstrap-conflict", "$bootstrap");
    }
    return before;
}
/** 在关联 operation ID 的唯一 maintenance gate 内执行一个有界临界区。 */
export async function withWakeflowMaintenanceGate(rootValue, optionsValue, operationValue) {
    assertRoot(rootValue);
    assertOperation(operationValue);
    const options = parseOptions(optionsValue);
    if (options.signal?.aborted === true)
        fail("aborted", "$signal");
    const operationId = options.operationId
        ?? createOperationId(options.uuidFactory);
    let inspection;
    try {
        inspection = await inspectWakeflowWorkspaceCoreLayout(rootValue, options.signal === undefined ? {} : { signal: options.signal });
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceCoreLayoutInspectionError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("bootstrap-conflict", "$bootstrap");
        }
        throw error;
    }
    if (inspection.inspectionDigest !== options.expectedCoreLayoutInspectionDigest) {
        fail("stale-preview", "$options.expectedCoreLayoutInspectionDigest");
    }
    if (inspection.local.status !== "absent"
        && inspection.local.status !== "bootstrap-prefix"
        && inspection.local.status !== "idle") {
        fail(inspection.local.status === "busy"
            ? "busy"
            : inspection.local.status === "recovery-required"
                ? "recovery-required"
                : "bootstrap-conflict", "$bootstrap");
    }
    if (inspection.local.status !== "idle"
        && !inspection.local.freshCompatible
        && options.bootstrap !== "repair") {
        fail("bootstrap-conflict", "$bootstrap");
    }
    await materialize(rootValue, WAKEFLOW_RUNTIME_ROOT_REF, options.signal);
    return runCorrelatedGate(rootValue, operationId, options, operationValue, async (expectedLockToken) => {
        await materialize(rootValue, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, options.signal);
        return admitLockedCoreInspection(rootValue, inspection, expectedLockToken, options.signal);
    });
}
