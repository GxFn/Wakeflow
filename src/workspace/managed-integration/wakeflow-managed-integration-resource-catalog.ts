import {
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../workspace-resource-declaration.js";

/**
 * Wakeflow Workspace / Managed Integration：宿主无关的混合所有权资源目录。
 *
 * 本目录只声明 Workspace 根 `.gitignore` 的资源政策。具体忽略规则、现有用户规则
 * 分类、文件读取、Git 语义检查和重组 effect 由后续职责所有者完成。
 * 该资源是 host-neutral；正文 owner 必须从所有准入宿主的私有路径形成确定性并集，
 * 不能根据当前执行宿主生成互相覆盖的不同 block。
 */

export const WAKEFLOW_GITIGNORE_REF = parsePortableResourcePath(".gitignore");
export const WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF =
  parsePortableResourcePath(".wakeflow-gitignore-recomposition.lock");

export const WAKEFLOW_WORKSPACE_IGNORE_RESOURCE_DECLARATION =
  parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "workspace.ignore-integration",
    family: "workspace",
    ownerId: "workspace-ignore-integration",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: WAKEFLOW_GITIGNORE_REF,
    },
    tracking: {
      disposition: "tracked",
      privacy: "shareable",
    },
    nodePolicy: {
      kind: "file",
      mode: "0644",
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

export const WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_RESOURCE_DECLARATION =
  parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "workspace.ignore-integration-lock",
    family: "workspace",
    ownerId: "workspace-ignore-integration",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF,
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
      allowedMutationRecipes: [
        "exclusive-create",
        "exact-retire",
      ],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });

/** Managed Integration 职责所有者的确定性静态资源目录。 */
export const WAKEFLOW_MANAGED_INTEGRATION_STATIC_RESOURCE_CATALOG =
  Object.freeze([
    WAKEFLOW_WORKSPACE_IGNORE_RESOURCE_DECLARATION,
    WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_RESOURCE_DECLARATION,
  ]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
