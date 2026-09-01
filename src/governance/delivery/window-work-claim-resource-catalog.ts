import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { WAKEFLOW_SHARED_COORDINATION_ROOT_REF } from "../../workspace/workspace-shared-runtime-resource-catalog.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../../workspace/workspace-resource-declaration.js";

/** Wakeflow Governance / Delivery：WindowWorkClaim 目录与逐窗口资源声明。 */

export const WINDOW_WORK_CLAIMS_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_SHARED_COORDINATION_ROOT_REF}/window-work-claims`,
);

export const WINDOW_WORK_CLAIMS_ROOT_RESOURCE_DECLARATION =
  parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "coordination.window-work-claims-root",
    family: "coordination",
    ownerId: "shared-runtime-layout",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: WINDOW_WORK_CLAIMS_ROOT_REF,
    },
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

function windowId(value: unknown): WakeflowDurableId<"window"> {
  return parseWakeflowDurableIdOfKind(value, "window", "$windowId");
}

/** 每个稳定窗口至多存在一份当前 WorkClaim，因此路径只由 `windowId` 决定。 */
export function windowWorkClaimRef(value: unknown): PortableResourcePath {
  return parsePortableResourcePath(
    `${WINDOW_WORK_CLAIMS_ROOT_REF}/${windowId(value)}.json`,
  );
}

/** 为一份具体的 WindowWorkClaim 生成完整动态资源声明。 */
export function createWindowWorkClaimResourceDeclaration(
  value: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  const id = windowId(value);
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: `coordination.window-work-claim.${id}`,
    family: "coordination",
    ownerId: "window-work-claim",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: windowWorkClaimRef(id),
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
      role: "transaction-artifact",
      allowedMutationRecipes: ["exclusive-create", "exact-retire"],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });
}

export const WINDOW_WORK_CLAIM_STATIC_RESOURCE_CATALOG = Object.freeze([
  WINDOW_WORK_CLAIMS_ROOT_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
