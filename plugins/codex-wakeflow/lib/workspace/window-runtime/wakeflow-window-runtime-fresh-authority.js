import { computeCanonicalJsonSha256Digest, } from "../../foundation/crypto/canonical-json-sha256.js";
import { createWakeflowWorkspaceHostResourceCatalog, } from "../workspace-host-resource-catalog.js";
import { WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_RESOURCE_DECLARATION, } from "../workspace-host-runtime-resource-catalog.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../workspace-host-resource-profile.js";
import { createWakeflowWindowRuntimeProjectionResourceCatalog, } from "./wakeflow-window-runtime-resource-catalog.js";
import { compileWakeflowWindowRuntimeUnregisteredProjectionSet, WakeflowWindowRuntimeUnregisteredProjectionError, } from "./wakeflow-window-runtime-unregistered-projection.js";
const ERROR_MESSAGES = {
    profile: "Fresh Window Runtime requires a host with window identity support.",
    projection: "Fresh Window Runtime projection authority is invalid.",
    catalog: "Fresh Window Runtime resource catalog is incomplete.",
};
/** Fresh Window Runtime authority 编译失败的稳定、脱敏错误。 */
export class WakeflowFreshWindowRuntimeAuthorityError extends Error {
    name = "WakeflowFreshWindowRuntimeAuthorityError";
    code = "wakeflow-fresh-window-runtime-authority";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowFreshWindowRuntimeAuthorityError(reason, path);
}
/** 为同一 strict Config/Host 编译 Fresh Window Runtime 的完整纯目标。 */
export function compileWakeflowFreshWindowRuntimeAuthority(configValue, profileValue) {
    let profile;
    try {
        profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
            fail("profile", error.path);
        }
        throw error;
    }
    if (!profile.surfaces.windowIdentity)
        fail("profile", "$/surfaces/windowIdentity");
    const hostCatalog = createWakeflowWorkspaceHostResourceCatalog(profile);
    const requiredIds = [
        `host-runtime.${profile.hostId}.root`,
        `host-runtime.${profile.hostId}.identity-root`,
        `host-runtime.${profile.hostId}.projections-root`,
        `host-runtime.${profile.hostId}.window-identity-root`,
        `host-runtime.${profile.hostId}.window-runtime-projections-root`,
    ];
    const hostDeclarations = requiredIds.map((declarationId) => {
        const declaration = hostCatalog.find((entry) => (entry.declarationId === declarationId));
        if (declaration === undefined)
            fail("catalog", "$layoutDeclarations");
        return declaration;
    });
    const layoutDeclarations = Object.freeze([
        WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_RESOURCE_DECLARATION,
        ...hostDeclarations,
    ]);
    let projectionSet;
    let projectionDeclarations;
    try {
        projectionSet = compileWakeflowWindowRuntimeUnregisteredProjectionSet(configValue, profile);
        projectionDeclarations =
            createWakeflowWindowRuntimeProjectionResourceCatalog(configValue, profile);
    }
    catch (error) {
        if (error instanceof WakeflowWindowRuntimeUnregisteredProjectionError) {
            fail("projection", error.path);
        }
        throw error;
    }
    if (projectionDeclarations.length !== projectionSet.entries.length
        || projectionDeclarations.some((declaration, index) => {
            const entry = projectionSet.entries[index];
            return entry === undefined
                || declaration.declarationId
                    !== `host-runtime.${projectionSet.hostId}.window-runtime.${entry.windowId}`
                || declaration.placement.relativePath !== entry.resourceRef;
        })) {
        fail("catalog", "$projectionDeclarations");
    }
    const basis = {
        kind: "WakeflowFreshWindowRuntimeAuthority",
        schemaVersion: 1,
        layoutDeclarations,
        projectionDeclarations,
        projectionSetDigest: projectionSet.projectionSetDigest,
    };
    return Object.freeze({
        kind: basis.kind,
        schemaVersion: basis.schemaVersion,
        layoutDeclarations,
        projectionDeclarations,
        projectionSet,
        authorityDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
