import { WAKEFLOW_LOCAL_ROOT } from "../configuration/wakeflow-config.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import { WORKSPACE_LOCKS_ROOT_REF } from "../kernel/workspace-locks.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../kernel/workspace-resource-declaration.js";
/**
 * Wakeflow Workspace：Workspace 核心私有根与维护协议静态资源目录。
 *
 * 本目录只声明 `.wakeflow-local`、maintenance bootstrap 目录链和锁目录。
 * Active 两级共享容器由相邻 Active Layout Catalog 独立声明；具体 transaction
 * intent 由operationId factory生成，不作为全局路径模式注册。
 *
 * 目录声明只允许逐级 materialize 且观察已有 mode；fresh strict-absent、bootstrap-prefix
 * 分类、intent 准入和物理效果由相邻 inspection/owner 负责。
 */

export const WAKEFLOW_LOCAL_ROOT_REF = parsePortableResourcePath(WAKEFLOW_LOCAL_ROOT);
export const WAKEFLOW_RUNTIME_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_LOCAL_ROOT}/runtime`,
);
export const WAKEFLOW_MAINTENANCE_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_RUNTIME_ROOT_REF}/maintenance`,
);
export const WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_MAINTENANCE_ROOT_REF}/transactions`,
);

function directoryDeclaration(
  declarationId: string,
  family: "local-core" | "maintenance",
  ownerId: string,
  relativePath: PortableResourcePath,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family,
    ownerId,
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

const WAKEFLOW_LOCAL_ROOT_RESOURCE_DECLARATION = directoryDeclaration(
  "local.root",
  "local-core",
  "maintenance-bootstrap",
  WAKEFLOW_LOCAL_ROOT_REF,
);

const WAKEFLOW_RUNTIME_ROOT_RESOURCE_DECLARATION = directoryDeclaration(
  "local.runtime-root",
  "local-core",
  "maintenance-bootstrap",
  WAKEFLOW_RUNTIME_ROOT_REF,
);

const WAKEFLOW_MAINTENANCE_ROOT_RESOURCE_DECLARATION = directoryDeclaration(
  "maintenance.root",
  "maintenance",
  "workspace-maintenance",
  WAKEFLOW_MAINTENANCE_ROOT_REF,
);

const WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_RESOURCE_DECLARATION = directoryDeclaration(
  "maintenance.transactions-root",
  "maintenance",
  "workspace-maintenance",
  WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
);

/**
 * 锁目录（ADR-0033）：工作区里全部的锁文件都在这里，名字是内核层的一张封闭的表。锁文件不带状态——互斥
 * 由内核咨询锁提供，文件只建不删——所以它们不各自声明为资源。
 */
const WAKEFLOW_LOCKS_ROOT_RESOURCE_DECLARATION = directoryDeclaration(
  "local.locks-root",
  "local-core",
  "maintenance-bootstrap",
  WORKSPACE_LOCKS_ROOT_REF,
);

/** Workspace Maintenance 的确定性静态资源目录。 */
export const WAKEFLOW_MAINTENANCE_STATIC_RESOURCE_CATALOG = Object.freeze([
  WAKEFLOW_LOCAL_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_RUNTIME_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_LOCKS_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_MAINTENANCE_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
