import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../workspace-resource-declaration.js";
import {
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
  WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
  WAKEFLOW_ACTIVE_ROOT_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
} from "./wakeflow-active-paths.js";

/**
 * Wakeflow Workspace / Active：共享 Active 根容器的静态资源目录。
 *
 * `.wakeflow-active/current` 是 TODO 与 Demand 聚合的共同父目录，只由 Active Layout
 * owner 创建。各领域仍分别声明并管理自己的后代，不得依靠逐级 mkdir 隐式取得该
 * 共享容器的 ownership。
 */

function declaration(
  declarationId: string,
  relativePath: typeof WAKEFLOW_ACTIVE_ROOT_REF,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "active",
    ownerId: "active-layout",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath,
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
}

export const WAKEFLOW_ACTIVE_ROOT_RESOURCE_DECLARATION = declaration(
  "active.root",
  WAKEFLOW_ACTIVE_ROOT_REF,
);

export const WAKEFLOW_ACTIVE_CURRENT_ROOT_RESOURCE_DECLARATION = declaration(
  "active.current-root",
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
);

export const WAKEFLOW_ACTIVE_LAYOUT_RESOURCE_CATALOG = Object.freeze([
  WAKEFLOW_ACTIVE_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_ACTIVE_CURRENT_ROOT_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];

function projectionDeclaration(
  declarationId: string,
  relativePath:
    | typeof WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF
    | typeof WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "active",
    ownerId: "active-workspace-projection",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath,
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
  });
}

export const WAKEFLOW_ACTIVE_WORKSPACE_INDEX_RESOURCE_DECLARATION =
  projectionDeclaration(
    "active.workspace-index",
    WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  );

export const WAKEFLOW_ACTIVE_WORKSPACE_STATUS_RESOURCE_DECLARATION =
  projectionDeclaration(
    "active.workspace-status",
    WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
  );

export const WAKEFLOW_ACTIVE_PROJECTION_LOCK_RESOURCE_DECLARATION =
  parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "active.workspace-projection-lock",
    family: "active",
    ownerId: "active-workspace-projection",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
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

export const WAKEFLOW_ACTIVE_STATIC_RESOURCE_CATALOG = Object.freeze([
  ...WAKEFLOW_ACTIVE_LAYOUT_RESOURCE_CATALOG,
  WAKEFLOW_ACTIVE_WORKSPACE_INDEX_RESOURCE_DECLARATION,
  WAKEFLOW_ACTIVE_WORKSPACE_STATUS_RESOURCE_DECLARATION,
  WAKEFLOW_ACTIVE_PROJECTION_LOCK_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];

/** Active Layout 两级容器策略的语义摘要。 */
export const WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST: Sha256Digest =
  computeCanonicalJsonSha256Digest({
    kind: "WakeflowActiveLayoutAuthority",
    schemaVersion: 1,
    declarations: WAKEFLOW_ACTIVE_LAYOUT_RESOURCE_CATALOG,
  } as unknown as JsonValue);
