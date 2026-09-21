import { types } from "node:util";
import { computeCanonicalJsonSha256Digest, } from "../../foundation/crypto/canonical-json-sha256.js";
import { hasDurableAtomicFileStagePrefix, } from "../../foundation/filesystem/durable-atomic-file-stage-address.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { inspectRootedExclusiveFileLock, RootedExclusiveFileLockError, } from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../foundation/filesystem/stable-directory-read.js";
import { inspectActiveLayout } from "../../kernel/active-projection.js";
import { WakeflowError } from "../../kernel/error.js";
import { WAKEFLOW_LOCAL_ROOT_REF, WAKEFLOW_MAINTENANCE_GATE_REF, WAKEFLOW_MAINTENANCE_ROOT_REF, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, WAKEFLOW_RUNTIME_ROOT_REF, } from "./wakeflow-maintenance-resource-catalog.js";
const ERROR_MESSAGES = {
    input: "Wakeflow workspace core layout inspection input is invalid.",
    "root-scope": "Wakeflow workspace root changed during layout inspection.",
    capacity: "Wakeflow workspace core layout exceeds its inspection budget.",
    "source-changed": "Wakeflow workspace core layout changed during inspection.",
    inspection: "Wakeflow workspace core layout could not be inspected safely.",
    aborted: "Wakeflow workspace core layout inspection was aborted.",
};
/** 核心私有布局检查失败的稳定、脱敏错误。 */
export class WakeflowWorkspaceCoreLayoutInspectionError extends Error {
    name = "WakeflowWorkspaceCoreLayoutInspectionError";
    code = "wakeflow-workspace-core-layout-inspection";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const MAXIMUM_PROTOCOL_ENTRIES = 4_096;
function fail(reason, path) {
    throw new WakeflowWorkspaceCoreLayoutInspectionError(reason, path);
}
function parseSignal(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof AbortSignal)) {
        fail("input", "$options.signal");
    }
    return value;
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function currentUserId() {
    if (process.platform === "win32" || typeof process.geteuid !== "function") {
        fail("inspection", "$root");
    }
    return BigInt(process.geteuid());
}
function nodeDigest(node) {
    return computeCanonicalJsonSha256Digest({
        kind: node.kind,
        deviceId: node.deviceId.toString(),
        inodeId: node.inodeId.toString(),
        rawMode: node.rawMode.toString(),
        permissionBits: node.permissionBits,
        linkCount: node.linkCount.toString(),
        userId: node.userId.toString(),
        groupId: node.groupId.toString(),
        specialDeviceId: node.specialDeviceId.toString(),
        byteCount: node.byteCount,
        modifiedAtNanoseconds: node.modifiedAtNanoseconds.toString(),
        changedAtNanoseconds: node.changedAtNanoseconds.toString(),
    });
}
function directoryDigest(read) {
    return computeCanonicalJsonSha256Digest({
        nodeDigest: nodeDigest(read.directoryNode),
        entries: read.entries.map((entry) => ({
            name: entry.name,
            nodeDigest: nodeDigest(entry.node),
        })),
    });
}
function validPrivateDirectory(node) {
    return node.kind === "directory"
        && node.permissionBits === 0o700
        && node.userId === currentUserId();
}
async function optionalResource(root, resourcePath) {
    try {
        return await root.inspectExistingResource(resourcePath, "$resourcePath");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError
            && error.reason === "resource-not-found") {
            return null;
        }
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root");
        throw error;
    }
}
async function readDirectory(root, resourcePath, signal) {
    try {
        return await readStableResourceDirectory(root, resourcePath, {
            maximumEntries: MAXIMUM_PROTOCOL_ENTRIES,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "too-many-entries")
                fail("capacity", "$entries");
            if (error.reason === "source-changed") {
                fail("source-changed", "$resourcePath");
            }
            if (error.reason === "root-scope"
                || error.reason === "expectation-changed") {
                fail("root-scope", "$root");
            }
            fail("inspection", "$resourcePath");
        }
        throw error;
    }
}
async function inspectActive(root, signal) {
    try {
        const inspection = await inspectActiveLayout(root, signal === undefined ? {} : { signal });
        return Object.freeze({
            status: inspection.status === "absent"
                ? "absent"
                : inspection.status === "current"
                    ? "present"
                    : inspection.status === "incomplete"
                        ? "incomplete"
                        : "conflict",
            nodeDigest: inspection.status === "absent"
                ? null
                : inspection.observationDigest,
        });
    }
    catch (error) {
        if (error instanceof WakeflowError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "active-layout-root-scope")
                fail("root-scope", "$root");
            fail("inspection", "$activeLayout");
        }
        throw error;
    }
}
function entryNamed(read, name) {
    return read.entries.find((entry) => entry.name === name) ?? null;
}
async function inspectLocal(root, signal, issueCodes) {
    const localResource = await optionalResource(root, WAKEFLOW_LOCAL_ROOT_REF);
    if (localResource === null) {
        return Object.freeze({
            status: "absent",
            freshCompatible: true,
            protocolComplete: false,
            nodeDigest: null,
            protocolDigest: null,
        });
    }
    const localNodeDigest = nodeDigest(localResource.node);
    if (!validPrivateDirectory(localResource.node)) {
        issueCodes.push("local-root-node-policy");
        return Object.freeze({
            status: "conflict",
            freshCompatible: false,
            protocolComplete: false,
            nodeDigest: localNodeDigest,
            protocolDigest: null,
        });
    }
    const local = await readDirectory(root, WAKEFLOW_LOCAL_ROOT_REF, signal);
    let freshCompatible = local.entries.every((entry) => entry.name === "runtime");
    const runtimeEntry = entryNamed(local, "runtime");
    if (runtimeEntry === null) {
        return Object.freeze({
            status: local.entries.length === 0 ? "bootstrap-prefix" : "conflict",
            freshCompatible: local.entries.length === 0,
            protocolComplete: false,
            nodeDigest: localNodeDigest,
            protocolDigest: directoryDigest(local),
        });
    }
    if (!validPrivateDirectory(runtimeEntry.node)) {
        issueCodes.push("runtime-root-node-policy");
        return Object.freeze({
            status: "conflict",
            freshCompatible: false,
            protocolComplete: false,
            nodeDigest: localNodeDigest,
            protocolDigest: directoryDigest(local),
        });
    }
    const runtime = await readDirectory(root, WAKEFLOW_RUNTIME_ROOT_REF, signal);
    if (runtime.entries.some((entry) => entry.name !== "maintenance")) {
        freshCompatible = false;
    }
    const stagePresent = runtime.entries.some((entry) => (hasDurableAtomicFileStagePrefix(entry.name)));
    if (stagePresent)
        issueCodes.push("maintenance-gate-stage-residue");
    const maintenanceEntry = entryNamed(runtime, "maintenance");
    let lockState = "absent";
    try {
        const lock = await inspectRootedExclusiveFileLock(root, WAKEFLOW_MAINTENANCE_GATE_REF);
        if (lock.status === "held") {
            lockState = lock.ownerState === "active"
                ? "active"
                : "inactive-or-unknown";
            freshCompatible = false;
        }
    }
    catch (error) {
        if (!(error instanceof RootedExclusiveFileLockError))
            throw error;
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        if (error.reason === "root-scope")
            fail("root-scope", "$root");
        if (error.reason === "unsafe-lock") {
            lockState = "unsafe";
            freshCompatible = false;
        }
        else if (error.reason === "residue-changed") {
            lockState = "inactive-or-unknown";
            freshCompatible = false;
        }
        else {
            fail("inspection", "$gate");
        }
    }
    if (lockState === "unsafe")
        issueCodes.push("maintenance-gate-unsafe");
    if (maintenanceEntry === null) {
        const status = lockState === "active"
            ? "busy"
            : lockState !== "absent" || stagePresent
                ? "recovery-required"
                : "bootstrap-prefix";
        return Object.freeze({
            status,
            freshCompatible: freshCompatible && status === "bootstrap-prefix",
            protocolComplete: false,
            nodeDigest: localNodeDigest,
            protocolDigest: computeCanonicalJsonSha256Digest({
                local: directoryDigest(local),
                runtime: directoryDigest(runtime),
                lockState,
            }),
        });
    }
    if (!validPrivateDirectory(maintenanceEntry.node)) {
        issueCodes.push("maintenance-root-node-policy");
        return Object.freeze({
            status: "conflict",
            freshCompatible: false,
            protocolComplete: false,
            nodeDigest: localNodeDigest,
            protocolDigest: directoryDigest(runtime),
        });
    }
    const maintenance = await readDirectory(root, WAKEFLOW_MAINTENANCE_ROOT_REF, signal);
    if (maintenance.entries.some((entry) => entry.name !== "transactions")) {
        issueCodes.push("maintenance-root-unknown-entry");
        return Object.freeze({
            status: "conflict",
            freshCompatible: false,
            protocolComplete: false,
            nodeDigest: localNodeDigest,
            protocolDigest: directoryDigest(maintenance),
        });
    }
    const transactionsEntry = entryNamed(maintenance, "transactions");
    if (transactionsEntry === null) {
        const status = lockState === "active"
            ? "busy"
            : lockState !== "absent" || stagePresent
                ? "recovery-required"
                : "bootstrap-prefix";
        return Object.freeze({
            status,
            freshCompatible: freshCompatible && status === "bootstrap-prefix",
            protocolComplete: false,
            nodeDigest: localNodeDigest,
            protocolDigest: computeCanonicalJsonSha256Digest({
                local: directoryDigest(local),
                runtime: directoryDigest(runtime),
                maintenance: directoryDigest(maintenance),
                lockState,
            }),
        });
    }
    if (!validPrivateDirectory(transactionsEntry.node)) {
        issueCodes.push("maintenance-transactions-node-policy");
        return Object.freeze({
            status: "conflict",
            freshCompatible: false,
            protocolComplete: false,
            nodeDigest: localNodeDigest,
            protocolDigest: directoryDigest(maintenance),
        });
    }
    const transactions = await readDirectory(root, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, signal);
    const residuePresent = transactions.entries.length > 0 || stagePresent;
    if (transactions.entries.length > 0) {
        issueCodes.push("maintenance-transaction-residue");
        freshCompatible = false;
    }
    const status = lockState === "unsafe"
        ? "conflict"
        : lockState === "active"
            ? "busy"
            : lockState === "inactive-or-unknown" || residuePresent
                ? "recovery-required"
                : "idle";
    return Object.freeze({
        status,
        freshCompatible: freshCompatible && status === "idle",
        protocolComplete: true,
        nodeDigest: localNodeDigest,
        protocolDigest: computeCanonicalJsonSha256Digest({
            local: directoryDigest(local),
            runtime: directoryDigest(runtime),
            maintenance: directoryDigest(maintenance),
            transactions: directoryDigest(transactions),
            lockState,
        }),
    });
}
/** 稳定分类 Workspace 核心私有布局；不执行任何写入或恢复。 */
export async function inspectWakeflowWorkspaceCoreLayout(rootValue, optionsValue = {}) {
    assertRoot(rootValue);
    if (typeof optionsValue !== "object"
        || optionsValue === null
        || types.isProxy(optionsValue)
        || Object.keys(optionsValue).some((key) => key !== "signal")) {
        fail("input", "$options");
    }
    const signal = parseSignal(optionsValue.signal);
    assertNotAborted(signal);
    const issueCodes = [];
    const active = await inspectActive(rootValue, signal);
    // `incomplete` 是维护可补齐的状态，不是 issue：gate 要求 issueCodes 为空才放行修复。
    if (active.status === "conflict")
        issueCodes.push("active-layout-node-policy");
    const local = await inspectLocal(rootValue, signal, issueCodes);
    assertNotAborted(signal);
    const sortedIssues = Object.freeze([...new Set(issueCodes)].sort());
    const inspectionDigest = computeCanonicalJsonSha256Digest({
        kind: "WakeflowWorkspaceCoreLayoutInspectionDigestBasis",
        active,
        local,
        issueCodes: sortedIssues,
    });
    return Object.freeze({
        active,
        local,
        issueCodes: sortedIssues,
        inspectionDigest,
    });
}
