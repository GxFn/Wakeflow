import { computeCanonicalJsonSha256Digest, } from "../../foundation/crypto/canonical-json-sha256.js";
import { createWakeflowWorkspaceHostResourceCatalog, hostProfileHasOperationSurface, } from "../workspace-host-resource-catalog.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../workspace-host-resource-profile.js";
const ERROR_MESSAGES = {
    profile: "Host capability layout profile is invalid.",
    catalog: "Host capability layout catalog is incomplete.",
};
/** Host capability layout authority 编译失败的稳定、脱敏错误。 */
export class WakeflowHostCapabilityLayoutAuthorityError extends Error {
    name = "WakeflowHostCapabilityLayoutAuthorityError";
    code = "wakeflow-host-capability-layout-authority";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowHostCapabilityLayoutAuthorityError(reason, path);
}
/** 仅按 Profile capability 编译父目录声明；不按 hostId 分支。 */
export function compileWakeflowHostCapabilityLayoutAuthority(profileValue) {
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
    const prefix = `host-runtime.${profile.hostId}`;
    const declarationIds = [];
    if (profile.surfaces.podReceipts) {
        declarationIds.push(`${prefix}.pod-receipts-root`);
    }
    if (hostProfileHasOperationSurface(profile)) {
        declarationIds.push(`${prefix}.operations-root`);
    }
    if (profile.surfaces.keepLive) {
        declarationIds.push(`${prefix}.keep-live-root`, `${prefix}.keep-live-leases-root`);
    }
    if (profile.surfaces.windowLocator) {
        declarationIds.push(`${prefix}.window-locators-root`);
    }
    if (profile.surfaces.statuslineAsset !== null
        || profile.surfaces.tmuxAsset !== null) {
        declarationIds.push(`${prefix}.statusline-assets-root`);
    }
    if (profile.surfaces.activityMonitor) {
        declarationIds.push(`${prefix}.activity-monitor-root`);
    }
    if (profile.surfaces.temporaryPrompts) {
        declarationIds.push(`${prefix}.temporary-root`, `${prefix}.temporary-prompts-root`);
    }
    const catalog = createWakeflowWorkspaceHostResourceCatalog(profile);
    const declarations = Object.freeze(declarationIds.map((declarationId) => {
        const declaration = catalog.find((entry) => (entry.declarationId === declarationId));
        if (declaration === undefined
            || declaration.nodePolicy.kind !== "directory"
            || declaration.processing.kind !== "directory-container") {
            fail("catalog", "$declarations");
        }
        return declaration;
    }));
    const basis = {
        kind: "WakeflowHostCapabilityLayoutAuthority",
        schemaVersion: 1,
        hostId: profile.hostId,
        declarations,
    };
    return Object.freeze({
        ...basis,
        authorityDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
