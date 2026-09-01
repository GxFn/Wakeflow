import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "./workspace-resource-declaration.js";
import { WAKEFLOW_RUNTIME_ROOT_REF } from "./maintenance/wakeflow-maintenance-resource-catalog.js";

/** Wakeflow Workspace：宿主中立共享运行时与协调根的静态资源目录。 */

export const WAKEFLOW_SHARED_RUNTIME_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_RUNTIME_ROOT_REF}/shared`,
);
export const WAKEFLOW_SHARED_COORDINATION_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_SHARED_RUNTIME_ROOT_REF}/coordination`,
);

function directory(
  declarationId: string,
  family: "local-core" | "coordination",
  ownerId: string,
  relativePath: PortableResourcePath,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family,
    ownerId,
    scope: "host-neutral",
    placement: { root: { kind: "workspace" }, relativePath },
    tracking: { disposition: "ignored", privacy: "runtime-private" },
    nodePolicy: {
      kind: "directory",
      mode: "0700",
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    },
    processing: {
      kind: "directory-container",
      materializationRecipe: "materialize-directory",
      existingDirectoryPolicy: "observe-without-mode-change",
      collisionPolicy: "reject-non-directory",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "report-only",
    },
  });
}

export const WAKEFLOW_SHARED_RUNTIME_ROOT_RESOURCE_DECLARATION = directory(
  "local.shared-runtime-root",
  "local-core",
  "shared-runtime-layout",
  WAKEFLOW_SHARED_RUNTIME_ROOT_REF,
);

export const WAKEFLOW_SHARED_COORDINATION_ROOT_RESOURCE_DECLARATION = directory(
  "coordination.root",
  "coordination",
  "shared-runtime-layout",
  WAKEFLOW_SHARED_COORDINATION_ROOT_REF,
);

export const WAKEFLOW_SHARED_RUNTIME_STATIC_RESOURCE_CATALOG = Object.freeze([
  WAKEFLOW_SHARED_RUNTIME_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_SHARED_COORDINATION_ROOT_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
