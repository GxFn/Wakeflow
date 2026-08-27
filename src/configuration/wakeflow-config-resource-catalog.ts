import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../workspace/workspace-resource-declaration.js";
import {
  WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
} from "./wakeflow-config-authority-replacement-contract.js";
import {
  WAKEFLOW_CONFIG_FILE_REF,
} from "./wakeflow-config-authority-snapshot.js";

/**
 * Wakeflow Configuration：Config 职责所有者的稳定资源目录。
 *
 * 资源目录只登记可以通过稳定逻辑路径寻址的 Config 权威记录和领域短锁。Config v3
 * 的持久化表示继续由相邻文档与模型编解码器负责；读写与恢复仍由既有发布、替换职责
 * 所有者执行。本模块不产生任何副作用。
 *
 * 持久化原子暂存文件是某次创建或替换方案产生的自描述非权威资源，其目标摘要、输入
 * 摘要和职责所有者身份已经由 Foundation 暂存地址绑定。因此，暂存文件不会重复登记
 * 为全局工作区资源声明，也不会形成第二套路径模式权威。
 */

export const WAKEFLOW_CONFIG_AUTHORITY_RESOURCE_DECLARATION =
  parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "workspace.config-authority",
    family: "workspace",
    ownerId: "config-authority",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: WAKEFLOW_CONFIG_FILE_REF,
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
      role: "mutable-snapshot",
      allowedMutationRecipes: [
        "exclusive-create",
        "exact-source-replace",
      ],
      recoveryStrategy: "owner-forward-recovery",
    },
  });

export const WAKEFLOW_CONFIG_AUTHORITY_LOCK_RESOURCE_DECLARATION =
  parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "workspace.config-authority-lock",
    family: "workspace",
    ownerId: "config-authority",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
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

/** Config Owner 的确定性、只读资源目录。 */
export const WAKEFLOW_CONFIG_RESOURCE_CATALOG = Object.freeze([
  WAKEFLOW_CONFIG_AUTHORITY_RESOURCE_DECLARATION,
  WAKEFLOW_CONFIG_AUTHORITY_LOCK_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
