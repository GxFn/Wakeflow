import {
  privateWorkspaceDirectoryDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "./workspace-resource-declaration.js";
import {
  WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_REF,
} from "./workspace-host-runtime-paths.js";

/**
 * Wakeflow Workspace：所有宿主本地运行目录共同使用的 host profiles 父容器。
 *
 * 本目录只声明共享 `.wakeflow-local/runtime/hosts` 根。每个当前宿主的子目录和其
 * identity/projection/operation 表面仍由 Host Profile Catalog 单独声明。
 */

export const WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_RESOURCE_DECLARATION =
  privateWorkspaceDirectoryDeclaration({
    declarationId: "host-runtime.profiles-root",
    family: "host-runtime",
    ownerId: "host-runtime-layout",
    scope: "host-neutral",
    relativePath: WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_REF,
  });

export const WAKEFLOW_HOST_RUNTIME_STATIC_RESOURCE_CATALOG = Object.freeze([
  WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
