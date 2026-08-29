import {
  WAKEFLOW_LOCAL_ROOT,
} from "../../configuration/wakeflow-config-v3.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../workspace-resource-declaration.js";
/**
 * Wakeflow Workspace / Maintenance：Workspace 核心私有根与维护协议静态资源目录。
 *
 * 本目录只声明 `.wakeflow-local`、maintenance bootstrap 目录链和唯一 maintenance
 * gate。Active 两级共享容器由相邻 Active Layout Catalog 独立声明；具体 transaction
 * intent/journal 由operationId factory生成，不作为全局路径模式注册。
 *
 * 目录声明只允许逐级 materialize 且观察已有 mode；fresh strict-absent、bootstrap-prefix
 * 分类、journal 准入和物理效果由相邻 inspection/owner 负责。
 */

export const WAKEFLOW_LOCAL_ROOT_REF =
  parsePortableResourcePath(WAKEFLOW_LOCAL_ROOT);
export const WAKEFLOW_RUNTIME_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_LOCAL_ROOT}/runtime`,
);
export const WAKEFLOW_MAINTENANCE_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_RUNTIME_ROOT_REF}/maintenance`,
);
export const WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF =
  parsePortableResourcePath(
    `${WAKEFLOW_MAINTENANCE_ROOT_REF}/transactions`,
  );
export const WAKEFLOW_MAINTENANCE_GATE_REF = parsePortableResourcePath(
  `${WAKEFLOW_RUNTIME_ROOT_REF}/maintenance.lock`,
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

export const WAKEFLOW_LOCAL_ROOT_RESOURCE_DECLARATION = directoryDeclaration(
  "local.root",
  "local-core",
  "maintenance-bootstrap",
  WAKEFLOW_LOCAL_ROOT_REF,
);

export const WAKEFLOW_RUNTIME_ROOT_RESOURCE_DECLARATION = directoryDeclaration(
  "local.runtime-root",
  "local-core",
  "maintenance-bootstrap",
  WAKEFLOW_RUNTIME_ROOT_REF,
);

export const WAKEFLOW_MAINTENANCE_ROOT_RESOURCE_DECLARATION =
  directoryDeclaration(
    "maintenance.root",
    "maintenance",
    "workspace-maintenance",
    WAKEFLOW_MAINTENANCE_ROOT_REF,
  );

export const WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_RESOURCE_DECLARATION =
  directoryDeclaration(
    "maintenance.transactions-root",
    "maintenance",
    "workspace-maintenance",
    WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
  );

export const WAKEFLOW_MAINTENANCE_GATE_RESOURCE_DECLARATION =
  parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "maintenance.gate",
    family: "maintenance",
    ownerId: "workspace-maintenance",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: WAKEFLOW_MAINTENANCE_GATE_REF,
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

/** Workspace Maintenance 的确定性静态资源目录。 */
export const WAKEFLOW_MAINTENANCE_STATIC_RESOURCE_CATALOG = Object.freeze([
  WAKEFLOW_LOCAL_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_RUNTIME_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_MAINTENANCE_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_MAINTENANCE_GATE_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
