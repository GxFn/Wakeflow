import { parseWakeflowWorkspaceResourceDeclaration, } from "../workspace-resource-declaration.js";
import { parseWakeflowWorkspaceHostResourceProfile, } from "../workspace-host-resource-profile.js";
import { compileWakeflowWindowRuntimeDesiredTopology, } from "./wakeflow-window-runtime-desired-topology.js";
import { wakeflowWindowHostBindingRef, } from "./wakeflow-window-runtime-paths.js";
/**
 * Wakeflow Workspace / Window Runtime：Config 静态窗口对应的私有 Binding 资源目录。
 *
 * 每个 windowId 只有一份当前宿主 Binding authority 文件。本声明只覆盖首次
 * exclusive create；replace / relocate（精确源替换）与 decommission（精确 unlink）由
 * endpoint 服务在 Binding 存储锁内直接执行，不经本声明的配方准入。
 */
export function createWakeflowWindowHostBindingResourceCatalog(configValue, profileValue) {
    const profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
    const topology = compileWakeflowWindowRuntimeDesiredTopology(configValue, profile);
    if (!profile.surfaces.windowIdentity)
        return Object.freeze([]);
    return Object.freeze(topology.windows.map((window) => (parseWakeflowWorkspaceResourceDeclaration({
        kind: "WakeflowWorkspaceResourceDeclaration",
        declarationId: `host-runtime.${profile.hostId}.window-host-binding.${window.windowId}`,
        family: "host-runtime",
        ownerId: "window-host-binding",
        scope: "current-host",
        placement: {
            root: { kind: "workspace" },
            relativePath: wakeflowWindowHostBindingRef(profile, window.windowId),
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
            role: "immutable-fact",
            allowedMutationRecipes: ["exclusive-create"],
            recoveryStrategy: "exact-idempotent-retry",
        },
    }))));
}
