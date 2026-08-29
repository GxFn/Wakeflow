import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../workspace-resource-declaration.js";
import {
  compileWakeflowWindowRuntimeUnregisteredProjectionSet,
} from "./wakeflow-window-runtime-unregistered-projection.js";

/**
 * Wakeflow Workspace / Window Runtime：Config 中每个静态窗口的动态投影资源目录。
 *
 * 静态 Host Catalog 只登记 projection 根；本工厂按稳定 windowId 为真实文件补齐独立
 * 声明。它不登记 Binding、Foundation stage 或动态 Pod window。
 */

export function createWakeflowWindowRuntimeProjectionResourceCatalog(
  configValue: unknown,
  profileValue: unknown,
): readonly Readonly<WakeflowWorkspaceResourceDeclaration>[] {
  const set = compileWakeflowWindowRuntimeUnregisteredProjectionSet(
    configValue,
    profileValue,
  );
  return Object.freeze(set.entries.map((entry) => (
    parseWakeflowWorkspaceResourceDeclaration({
      kind: "WakeflowWorkspaceResourceDeclaration",
      declarationId:
        `host-runtime.${set.hostId}.window-runtime.${entry.windowId}`,
      family: "host-runtime",
      ownerId: "window-runtime-projection",
      scope: "current-host",
      placement: {
        root: { kind: "workspace" },
        relativePath: entry.resourceRef,
      },
      tracking: { disposition: "ignored", privacy: "runtime-private" },
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
    })
  )));
}
