import { parsePortableResourcePath, } from "../foundation/filesystem/portable-resource-path.js";
import { hostPodReceiptsRootRef } from "../kernel/layout.js";
import { parseWakeflowWorkspaceHostResourceProfile, } from "./workspace-host-resource-profile.js";
import { parseWakeflowWorkspaceResourceDeclaration, privateWorkspaceDirectoryDeclaration, } from "./workspace-resource-declaration.js";
import { wakeflowWindowHostBindingMutationLockRef, wakeflowWindowHostBindingRootRef, wakeflowWindowRuntimeProjectionRootRef, } from "./window-runtime/wakeflow-window-runtime-paths.js";
import { wakeflowHostIdentityRootRef, wakeflowHostProjectionsRootRef, wakeflowHostRuntimeRootRef, } from "./workspace-host-runtime-paths.js";
function hostRuntimeRef(profile, suffix) {
    return parsePortableResourcePath(suffix === undefined
        ? wakeflowHostRuntimeRootRef(profile)
        : `${wakeflowHostRuntimeRootRef(profile)}/${suffix}`);
}
function privateDirectoryDeclaration(declarationId, ownerId, relativePath) {
    return privateWorkspaceDirectoryDeclaration({
        declarationId,
        family: "host-runtime",
        ownerId,
        scope: "current-host",
        relativePath,
    });
}
function integrationFileDeclaration(declarationId, ownerId, relativePath, tracking) {
    const privateResource = tracking === "ignored-private";
    return parseWakeflowWorkspaceResourceDeclaration({
        kind: "WakeflowWorkspaceResourceDeclaration",
        declarationId,
        family: "host-runtime",
        ownerId,
        scope: "current-host",
        placement: {
            root: { kind: "workspace" },
            relativePath,
        },
        tracking: {
            disposition: privateResource ? "ignored" : "tracked",
            privacy: privateResource ? "runtime-private" : "shareable",
        },
        nodePolicy: {
            kind: "file",
            mode: privateResource ? "0600" : "0644",
            linkPolicy: "single-link",
            executablePolicy: "forbidden",
        },
        processing: {
            kind: "resource",
            role: "managed-integration-text",
            allowedMutationRecipes: ["exact-source-recompose"],
            recoveryStrategy: "recompose-owned-content",
        },
    });
}
function transactionFileDeclaration(declarationId, ownerId, relativePath) {
    return parseWakeflowWorkspaceResourceDeclaration({
        kind: "WakeflowWorkspaceResourceDeclaration",
        declarationId,
        family: "host-runtime",
        ownerId,
        scope: "current-host",
        placement: {
            root: { kind: "workspace" },
            relativePath,
        },
        tracking: {
            disposition: "ignored",
            privacy: "runtime-private",
        },
        nodePolicy: {
            kind: "file",
            mode: "0600",
            linkPolicy: "single-link",
            executablePolicy: "forbidden",
        },
        processing: {
            kind: "resource",
            role: "transaction-artifact",
            allowedMutationRecipes: ["exclusive-create", "exact-retire"],
            recoveryStrategy: "owner-transaction-recovery",
        },
    });
}
/** 为一个严格 Host Profile 返回其 Program Instruction 专属短锁路径。 */
export function wakeflowProgramInstructionRecompositionLockRef(profileValue) {
    const profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
    return parsePortableResourcePath(`.wakeflow-program-instruction-${profile.hostId}.lock`);
}
function privateProjectionFileDeclaration(declarationId, ownerId, relativePath) {
    return parseWakeflowWorkspaceResourceDeclaration({
        kind: "WakeflowWorkspaceResourceDeclaration",
        declarationId,
        family: "host-runtime",
        ownerId,
        scope: "current-host",
        placement: {
            root: { kind: "workspace" },
            relativePath,
        },
        tracking: {
            disposition: "ignored",
            privacy: "runtime-private",
        },
        nodePolicy: {
            kind: "file",
            mode: "0600",
            linkPolicy: "single-link",
            executablePolicy: "forbidden",
        },
        processing: {
            kind: "resource",
            role: "derived-projection",
            allowedMutationRecipes: ["deterministic-rewrite"],
            recoveryStrategy: "rebuild-from-authority",
        },
    });
}
/** Profile 是否声明任一 `operations/` 下的表面；目录与布局 authority 共用此判定。 */
export function hostProfileHasOperationSurface(profile) {
    return profile.surfaces.keepLive
        || profile.surfaces.windowLocator
        || profile.surfaces.statuslineAsset !== null
        || profile.surfaces.tmuxAsset !== null
        || profile.surfaces.activityMonitor
        || profile.surfaces.temporaryPrompts;
}
/** 把一个严格 Host Profile 编译为确定性、冻结的静态资源目录。 */
export function createWakeflowWorkspaceHostResourceCatalog(profileValue) {
    const profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
    const prefix = `host-runtime.${profile.hostId}`;
    const declarations = [
        privateDirectoryDeclaration(`${prefix}.root`, "host-runtime-layout", hostRuntimeRef(profile)),
        privateDirectoryDeclaration(`${prefix}.identity-root`, "host-runtime-layout", wakeflowHostIdentityRootRef(profile)),
        privateDirectoryDeclaration(`${prefix}.projections-root`, "host-runtime-layout", wakeflowHostProjectionsRootRef(profile)),
        integrationFileDeclaration(`${prefix}.instruction`, "host-instruction-integration", profile.instructionFileName, "tracked-shareable"),
        transactionFileDeclaration(`${prefix}.instruction-lock`, "host-instruction-integration", wakeflowProgramInstructionRecompositionLockRef(profile)),
        privateDirectoryDeclaration(`${prefix}.window-runtime-projections-root`, "window-runtime-projection", wakeflowWindowRuntimeProjectionRootRef(profile)),
    ];
    if (profile.surfaces.windowIdentity) {
        declarations.push(privateDirectoryDeclaration(`${prefix}.window-identity-root`, "window-host-binding", wakeflowWindowHostBindingRootRef(profile)), transactionFileDeclaration(`${prefix}.window-identity-lock`, "window-host-binding", wakeflowWindowHostBindingMutationLockRef(profile)));
    }
    if (profile.surfaces.podReceipts) {
        declarations.push(privateDirectoryDeclaration(`${prefix}.pod-receipts-root`, "pod-receipts", hostPodReceiptsRootRef(profile.hostId)));
    }
    if (hostProfileHasOperationSurface(profile)) {
        declarations.push(privateDirectoryDeclaration(`${prefix}.operations-root`, "host-runtime-layout", hostRuntimeRef(profile, "operations")));
    }
    if (profile.surfaces.keepLive) {
        declarations.push(privateDirectoryDeclaration(`${prefix}.keep-live-root`, "keep-live", hostRuntimeRef(profile, "operations/keep-live")), privateDirectoryDeclaration(`${prefix}.keep-live-leases-root`, "keep-live", hostRuntimeRef(profile, "operations/keep-live/leases")));
    }
    if (profile.surfaces.windowLocator) {
        declarations.push(privateDirectoryDeclaration(`${prefix}.window-locators-root`, "window-locator", hostRuntimeRef(profile, "operations/window-locators")));
    }
    if (profile.surfaces.settingsIntegration !== null) {
        declarations.push(integrationFileDeclaration(`${prefix}.settings-portable`, "host-settings-integration", profile.surfaces.settingsIntegration.portablePath, "tracked-shareable"), integrationFileDeclaration(`${prefix}.settings-local`, "host-settings-integration", profile.surfaces.settingsIntegration.localPath, "ignored-private"));
    }
    const { statuslineAsset, tmuxAsset } = profile.surfaces;
    if (statuslineAsset !== null || tmuxAsset !== null) {
        declarations.push(privateDirectoryDeclaration(`${prefix}.statusline-assets-root`, "host-statusline", hostRuntimeRef(profile, "operations/assets")));
    }
    if (statuslineAsset !== null) {
        declarations.push(privateProjectionFileDeclaration(`${prefix}.statusline-asset`, "host-statusline", hostRuntimeRef(profile, `operations/assets/${statuslineAsset.fileName}`)));
    }
    if (tmuxAsset !== null) {
        declarations.push(privateProjectionFileDeclaration(`${prefix}.tmux-asset`, "host-tmux", hostRuntimeRef(profile, `operations/assets/${tmuxAsset.fileName}`)));
    }
    if (profile.surfaces.activityMonitor) {
        declarations.push(privateDirectoryDeclaration(`${prefix}.activity-monitor-root`, "activity-monitor", hostRuntimeRef(profile, "operations/activity-monitor")));
    }
    if (profile.surfaces.temporaryPrompts) {
        declarations.push(privateDirectoryDeclaration(`${prefix}.temporary-root`, "host-runtime-layout", hostRuntimeRef(profile, "operations/temp")), privateDirectoryDeclaration(`${prefix}.temporary-prompts-root`, "temporary-prompt", hostRuntimeRef(profile, "operations/temp/prompts")));
    }
    return Object.freeze(declarations);
}
