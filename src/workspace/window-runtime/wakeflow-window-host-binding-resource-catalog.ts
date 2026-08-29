import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../workspace-resource-declaration.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  compileWakeflowWindowRuntimeDesiredTopology,
} from "./wakeflow-window-runtime-desired-topology.js";
import {
  wakeflowWindowBindingRef,
} from "./wakeflow-window-runtime-paths.js";

/**
 * Wakeflow Workspace / Window Runtime：Config 静态窗口对应的私有 Binding 资源目录。
 *
 * 每个 windowId 只有一份当前宿主 Binding authority 文件。当前技术骨干只允许首次
 * exclusive create；replace、decommission、Lease 与 Pod 动态窗口不会提前进入配方。
 */
export function createWakeflowWindowHostBindingResourceCatalog(
  configValue: unknown,
  profileValue: unknown,
): readonly Readonly<WakeflowWorkspaceResourceDeclaration>[] {
  const profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
  const topology = compileWakeflowWindowRuntimeDesiredTopology(
    configValue,
    profile,
  );
  if (!profile.surfaces.windowIdentity) return Object.freeze([]);
  return Object.freeze(topology.windows.map((window) => (
    parseWakeflowWorkspaceResourceDeclaration({
      kind: "WakeflowWorkspaceResourceDeclaration",
      declarationId:
        `host-runtime.${profile.hostId}.window-host-binding.${window.windowId}`,
      family: "host-runtime",
      ownerId: "window-host-binding",
      scope: "current-host",
      placement: {
        root: { kind: "workspace" },
        relativePath: wakeflowWindowBindingRef(profile, window.windowId),
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
    })
  )));
}
