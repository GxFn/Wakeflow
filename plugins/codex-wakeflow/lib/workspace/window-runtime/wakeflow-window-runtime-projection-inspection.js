import { types } from "node:util";
import { parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { isWakeflowError } from "../../kernel/error.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../workspace-host-resource-profile.js";
import { inspectWakeflowWindowHostBindingInventory, WakeflowWindowHostBindingStoreError, } from "./wakeflow-window-host-binding-store.js";
import { compileWakeflowWindowHostBindingStoreAuthority, WakeflowWindowHostBindingStoreAuthorityError, } from "./wakeflow-window-host-binding-store-authority.js";
import { parseWakeflowWindowHostIdentityProfile, WakeflowWindowHostIdentityProfileError, } from "./wakeflow-window-host-identity-profile.js";
import { inspectWakeflowWindowRuntimeProjectionDocument, } from "./wakeflow-window-runtime-projection-document.js";
import { compileWakeflowWindowRuntimeRegisteredProjectionEntry } from "./wakeflow-window-runtime-registered-projection.js";
import { compileWakeflowWindowRuntimeUnregisteredProjectionSet, WakeflowWindowRuntimeUnregisteredProjectionError, } from "./wakeflow-window-runtime-unregistered-projection.js";
const ERROR_MESSAGES = {
    input: "Wakeflow window runtime projection input is invalid.",
    profile: "Wakeflow window runtime projection host profile is invalid.",
    topology: "Wakeflow window runtime projection topology is invalid.",
    plan: "Wakeflow window runtime projection operation no longer matches the current authority.",
    aborted: "Wakeflow window runtime projection work was aborted.",
    effect: "Wakeflow window runtime projection could not be published safely.",
};
/** 窗口运行投影观察与维护失败的稳定、脱敏错误。 */
export class WakeflowWindowRuntimeProjectionError extends Error {
    name = "WakeflowWindowRuntimeProjectionError";
    code = "wakeflow-window-runtime-projection";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
export function failWindowRuntimeProjection(reason, path) {
    throw new WakeflowWindowRuntimeProjectionError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        failWindowRuntimeProjection("input", "$root");
    }
}
/** 准入根与三份输入：Config 与两份宿主 profile 都重新解析，且两份 profile 必须是同一宿主。 */
export function admitWakeflowWindowRuntimeProjectionInputs(rootValue, configValue, resourceProfileValue, identityProfileValue) {
    assertRoot(rootValue);
    let config;
    try {
        config = parseWakeflowConfig(configValue);
    }
    catch (error) {
        if (error instanceof WakeflowConfigError)
            failWindowRuntimeProjection("input", error.path);
        throw error;
    }
    try {
        const resourceProfile = parseWakeflowWorkspaceHostResourceProfile(resourceProfileValue);
        const identityProfile = parseWakeflowWindowHostIdentityProfile(identityProfileValue);
        if (resourceProfile.hostId !== identityProfile.hostId) {
            failWindowRuntimeProjection("profile", "$profiles");
        }
        return Object.freeze({ config, resourceProfile, identityProfile });
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError
            || error instanceof WakeflowWindowHostIdentityProfileError) {
            failWindowRuntimeProjection("profile", error.path);
        }
        throw error;
    }
}
async function resourcePresent(root, resourceRef, path) {
    try {
        await root.inspectExistingResource(resourceRef, path);
        return true;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            if (error.reason === "resource-not-found")
                return false;
            failWindowRuntimeProjection("input", "$root");
        }
        throw error;
    }
}
/** 每个配置窗口的期望文档：有 Binding 即 registered，否则 unregistered；尚无 Binding 目录的宿主只有未登记投影。 */
export async function resolveWakeflowWindowRuntimeProjectionExpectedEntries(root, inputs, signal, options = {}) {
    const { config, resourceProfile, identityProfile } = inputs;
    let unregistered;
    let authority;
    try {
        unregistered = compileWakeflowWindowRuntimeUnregisteredProjectionSet(config, resourceProfile);
        authority = compileWakeflowWindowHostBindingStoreAuthority(config, resourceProfile, identityProfile);
    }
    catch (error) {
        if (error instanceof WakeflowWindowRuntimeUnregisteredProjectionError
            || error instanceof WakeflowWindowHostBindingStoreAuthorityError) {
            failWindowRuntimeProjection("topology", error.path);
        }
        throw error;
    }
    if (options.projectionRootRequired !== false
        && !(await resourcePresent(root, unregistered.projectionRootRef, "$projectionRoot"))) {
        return Object.freeze({ kind: "runtime-missing" });
    }
    let inventory;
    try {
        inventory = (await resourcePresent(root, authority.bindingRootRef, "$bindingRoot"))
            ? await inspectWakeflowWindowHostBindingInventory(root, authority, signal === undefined ? {} : { signal })
            : Object.freeze({ bindings: Object.freeze([]) });
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingStoreError) {
            if (error.reason === "aborted")
                failWindowRuntimeProjection("aborted", "$signal");
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
/** 逐窗口比对磁盘文档与期望：current / stale / missing / unsafe，并带回当前文档摘要。 */
export async function inspectWakeflowWindowRuntimeProjectionEntries(root, entries, signal) {
    const inspected = [];
    for (const entry of entries) {
        let inspection;
        try {
            inspection = await inspectWakeflowWindowRuntimeProjectionDocument(root, entry.target, signal);
        }
        catch (error) {
            if (isWakeflowError(error) && error.reason === "aborted") {
                failWindowRuntimeProjection("aborted", "$signal");
            }
            throw error;
        }
        inspected.push(Object.freeze({ entry, status: inspection.status, currentDigest: inspection.currentDigest }));
    }
    return Object.freeze(inspected);
}
/** 零写入观察：每个配置窗口的投影与当前 Config 加 Binding 的重算比对（G6，§13.111）。 */
export async function inspectWakeflowWindowRuntimeProjectionSet(rootValue, request) {
    if (request.signal?.aborted === true)
        failWindowRuntimeProjection("aborted", "$signal");
    const inputs = admitWakeflowWindowRuntimeProjectionInputs(rootValue, request.config, request.resourceProfile, request.identityProfile);
    const expected = await resolveWakeflowWindowRuntimeProjectionExpectedEntries(rootValue, inputs, request.signal);
    if (expected.kind !== "entries")
        return Object.freeze({ status: expected.kind });
    const inspected = await inspectWakeflowWindowRuntimeProjectionEntries(rootValue, expected.entries, request.signal);
    return Object.freeze({
        status: "observed",
        windows: Object.freeze(inspected.map((item) => Object.freeze({
            windowId: item.entry.windowId,
            registered: item.entry.registered,
            resourceRef: item.entry.target.resourceRef,
            status: item.status,
        }))),
    });
}
