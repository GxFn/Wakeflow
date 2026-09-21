import { types } from "node:util";
import { parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { isWakeflowError } from "../../kernel/error.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../workspace-host-resource-profile.js";
import { inspectWakeflowWindowHostBindingInventory, WakeflowWindowHostBindingStoreError, } from "./wakeflow-window-host-binding-store.js";
import { compileWakeflowWindowHostBindingStoreAuthority, WakeflowWindowHostBindingStoreAuthorityError, } from "./wakeflow-window-host-binding-store-authority.js";
import { parseWakeflowWindowHostIdentityProfile, WakeflowWindowHostIdentityProfileError, } from "./wakeflow-window-host-identity-profile.js";
import { inspectWakeflowWindowRuntimeProjectionDocument, publishWakeflowWindowRuntimeProjectionDocument, } from "./wakeflow-window-runtime-projection-document.js";
import { compileWakeflowWindowRuntimeRegisteredProjectionEntry } from "./wakeflow-window-runtime-registered-projection.js";
import { compileWakeflowWindowRuntimeUnregisteredProjectionSet, WakeflowWindowRuntimeUnregisteredProjectionError, } from "./wakeflow-window-runtime-unregistered-projection.js";
/**
 * Wakeflow Workspace / Window Runtime：对账时窗口运行投影的重建（能力卡 1 §1.4 自动修复）。
 *
 * 每个窗口的目标文档由当前 Config 与当前 Binding inventory 重算：有 Binding 的窗口是
 * registered 投影，否则是 unregistered 投影。磁盘文档缺失或过期（合法但内容不同）出一条
 * 宿主维护操作，由宿主 capability 在维护事务内执行；读不出或不是确定性 JSON 的文档只报告
 * `window-runtime-projection-unsafe`，不覆盖。宿主运行时根尚未发布时本模块不出操作：
 * 共享预览已用 `window-runtime-missing` 报告它。fresh 由共享步骤发布全部未登记投影。
 *
 * 目标文档需要宿主的 identity profile，所以本模块经宿主 capability 端口进入维护事务，
 * 而不是静态预览：共享层不能选择宿主身份。
 */
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OPERATION_KIND = "window-runtime-projection";
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OWNER_ID = "window-runtime-projection";
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_UNSAFE_BLOCKER = "window-runtime-projection-unsafe";
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_UNAVAILABLE_BLOCKER = "window-runtime-projection-unavailable";
const ERROR_MESSAGES = {
    input: "Wakeflow window runtime projection maintenance input is invalid.",
    profile: "Wakeflow window runtime projection maintenance host profile is invalid.",
    topology: "Wakeflow window runtime projection maintenance topology is invalid.",
    plan: "Wakeflow window runtime projection operation no longer matches the current authority.",
    aborted: "Wakeflow window runtime projection maintenance was aborted.",
    effect: "Wakeflow window runtime projection could not be published safely.",
};
/** 窗口运行投影维护失败的稳定、脱敏错误。 */
export class WakeflowWindowRuntimeProjectionMaintenanceError extends Error {
    name = "WakeflowWindowRuntimeProjectionMaintenanceError";
    code = "wakeflow-window-runtime-projection-maintenance";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowWindowRuntimeProjectionMaintenanceError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function parseInputs(configValue, resourceProfileValue, identityProfileValue) {
    let config;
    try {
        config = parseWakeflowConfig(configValue);
    }
    catch (error) {
        if (error instanceof WakeflowConfigError)
            fail("input", error.path);
        throw error;
    }
    try {
        const resourceProfile = parseWakeflowWorkspaceHostResourceProfile(resourceProfileValue);
        const identityProfile = parseWakeflowWindowHostIdentityProfile(identityProfileValue);
        if (resourceProfile.hostId !== identityProfile.hostId)
            fail("profile", "$profiles");
        return Object.freeze({ config, resourceProfile, identityProfile });
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError
            || error instanceof WakeflowWindowHostIdentityProfileError) {
            fail("profile", error.path);
        }
        throw error;
    }
}
async function projectionRootPresent(root, resourceRef) {
    try {
        await root.inspectExistingResource(resourceRef, "$projectionRoot");
        return true;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            if (error.reason === "resource-not-found")
                return false;
            fail("input", "$root");
        }
        throw error;
    }
}
async function expectedEntries(root, config, resourceProfile, identityProfile, signal) {
    let unregistered;
    let authority;
    try {
        unregistered = compileWakeflowWindowRuntimeUnregisteredProjectionSet(config, resourceProfile);
        authority = compileWakeflowWindowHostBindingStoreAuthority(config, resourceProfile, identityProfile);
    }
    catch (error) {
        if (error instanceof WakeflowWindowRuntimeUnregisteredProjectionError
            || error instanceof WakeflowWindowHostBindingStoreAuthorityError) {
            fail("topology", error.path);
        }
        throw error;
    }
    if (!(await projectionRootPresent(root, unregistered.projectionRootRef))) {
        return Object.freeze({ kind: "runtime-missing" });
    }
    let inventory;
    try {
        inventory = await inspectWakeflowWindowHostBindingInventory(root, authority, signal === undefined ? {} : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingStoreError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            return Object.freeze({ kind: "inventory-unavailable" });
        }
        throw error;
    }
    const entries = unregistered.entries.map((entry) => {
        const binding = inventory.bindings.find((candidate) => candidate.windowId === entry.windowId);
        const compiled = binding === undefined
            ? entry
            : compileWakeflowWindowRuntimeRegisteredProjectionEntry(resourceProfile, identityProfile, entry.projection, binding);
        return Object.freeze({
            windowId: entry.windowId,
            registered: binding !== undefined,
            target: Object.freeze({
                resourceRef: compiled.resourceRef,
                document: compiled.document,
                documentDigest: compiled.documentDigest,
                projectionDigest: compiled.projection.projectionDigest,
            }),
        });
    });
    return Object.freeze({ kind: "entries", entries: Object.freeze(entries) });
}
function operationFor(entry, sourceDigest) {
    return {
        operationId: `window-runtime-projection:${entry.windowId}`,
        operationKind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OPERATION_KIND,
        ownerId: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_OWNER_ID,
        targetKey: entry.windowId,
        sourceDigest,
        targetDigest: entry.target.documentDigest,
        payload: {
            windowId: entry.windowId,
            resourceRef: entry.target.resourceRef,
            registered: entry.registered,
            projectionDigest: entry.target.projectionDigest,
        },
    };
}
/** 零写入规划：缺失或过期的投影各出一条操作；读不稳的投影与读不出的 inventory 只报告。 */
export async function planWakeflowWindowRuntimeProjectionMaintenance(rootValue, request) {
    assertRoot(rootValue);
    if (request.signal?.aborted === true)
        fail("aborted", "$signal");
    const { config, resourceProfile, identityProfile } = parseInputs(request.config, request.resourceProfile, request.identityProfile);
    if (request.action === "fresh-initialize") {
        return Object.freeze({ operations: Object.freeze([]), blockerCodes: Object.freeze([]) });
    }
    const expected = await expectedEntries(rootValue, config, resourceProfile, identityProfile, request.signal);
    if (expected.kind === "runtime-missing") {
        return Object.freeze({ operations: Object.freeze([]), blockerCodes: Object.freeze([]) });
    }
    if (expected.kind === "inventory-unavailable") {
        return Object.freeze({
            operations: Object.freeze([]),
            blockerCodes: Object.freeze([WAKEFLOW_WINDOW_RUNTIME_PROJECTION_UNAVAILABLE_BLOCKER]),
        });
    }
    const operations = [];
    let unsafe = false;
    for (const entry of expected.entries) {
        let inspection;
        try {
            inspection = await inspectWakeflowWindowRuntimeProjectionDocument(rootValue, entry.target, request.signal);
        }
        catch (error) {
            if (isWakeflowError(error) && error.reason === "aborted")
                fail("aborted", "$signal");
            throw error;
        }
        if (inspection.status === "current")
            continue;
        if (inspection.status === "unsafe") {
            unsafe = true;
            continue;
        }
        operations.push(operationFor(entry, inspection.currentDigest));
    }
    return Object.freeze({
        operations: Object.freeze(operations),
        blockerCodes: Object.freeze(unsafe ? [WAKEFLOW_WINDOW_RUNTIME_PROJECTION_UNSAFE_BLOCKER] : []),
    });
}
/** 在维护事务内重算同一窗口的目标文档，核对与计划一致后发布；目标已相同即 current。 */
export async function executeWakeflowWindowRuntimeProjectionOperation(rootValue, request) {
    assertRoot(rootValue);
    if (request.signal?.aborted === true)
        fail("aborted", "$signal");
    const { config, resourceProfile, identityProfile } = parseInputs(request.config, request.resourceProfile, request.identityProfile);
    const expected = await expectedEntries(rootValue, config, resourceProfile, identityProfile, request.signal);
    if (expected.kind !== "entries")
        fail("plan", "$operation");
    const entry = expected.entries.find((candidate) => candidate.windowId === request.targetKey);
    if (entry === undefined
        || request.operationId !== `window-runtime-projection:${entry.windowId}`
        || entry.target.documentDigest !== request.targetDigest) {
        fail("plan", "$operation");
    }
    let receipt;
    try {
        receipt = await publishWakeflowWindowRuntimeProjectionDocument(rootValue, entry.target, request.signal);
    }
    catch (error) {
        if (isWakeflowError(error)) {
            fail(error.reason === "aborted" ? "aborted" : "effect", "$projection");
        }
        throw error;
    }
    return Object.freeze({
        operationId: request.operationId,
        disposition: receipt.disposition === "current"
            ? "current"
            : receipt.disposition === "created"
                ? "created"
                : "updated",
        observationDigest: receipt.documentDigest,
    });
}
