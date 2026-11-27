import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../foundation/error/module-error.js";
import {
  admitWakeflowResourceOperation,
  type WakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../foundation/resource/resource-processing-contract.js";
import {
  findWakeflowWorkspaceStaticResourceByDeclarationId,
  type WakeflowWorkspaceStaticResourceMatrix,
} from "./wakeflow-workspace-static-resource-matrix.js";
import type { WakeflowWorkspaceHostId } from "./workspace-host-resource-profile.js";
import type { WakeflowWorkspaceResourceDeclaration } from "./workspace-resource-declaration.js";

/**
 * Wakeflow Workspace：静态资源的一次机械操作上下文。
 *
 * 本模块只把调用方选定的静态声明和一项允许的 recipe 绑定到当前矩阵摘要。它不自动
 * 选择资源或 recipe，不持有根目录、锁、字节、来源预期或 effect，也不能用于具体领域
 * 实例。领域 owner 仍须在自己的 I/O 边界重新验证 authority 与 source expectation。
 */

export const WAKEFLOW_WORKSPACE_STATIC_RESOURCE_OPERATION_CONTEXT_KIND =
  "WakeflowWorkspaceStaticResourceOperationContext" as const;

export interface WakeflowWorkspaceStaticResourceOperationContext {
  readonly kind: typeof WAKEFLOW_WORKSPACE_STATIC_RESOURCE_OPERATION_CONTEXT_KIND;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly matrixDigest: Sha256Digest;
  readonly declaration: Readonly<WakeflowWorkspaceResourceDeclaration>;
  readonly operation: Readonly<WakeflowResourceOperation>;
}

export type WakeflowWorkspaceStaticResourceOperationContextErrorReason =
  | "input"
  | "matrix"
  | "matrix-changed"
  | "declaration-not-found"
  | "operation";

/** 静态资源操作上下文准入失败的稳定、脱敏错误。 */
export class WakeflowWorkspaceStaticResourceOperationContextError extends ModuleError<WakeflowWorkspaceStaticResourceOperationContextErrorReason> {
  static override readonly code = "wakeflow-workspace-static-resource-operation-context";
}

const fail: Fail<WakeflowWorkspaceStaticResourceOperationContextErrorReason> = failWith(
  WakeflowWorkspaceStaticResourceOperationContextError,
);

export interface WakeflowWorkspaceStaticResourceOperationRequest {
  readonly expectedMatrixDigest: Sha256Digest;
  readonly declarationId: string;
  readonly recipe: string;
}

/** 把一个静态矩阵声明与调用方选择的唯一 recipe 绑定为冻结上下文。 */
export function createWakeflowWorkspaceStaticResourceOperationContext(
  matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>,
  request: Readonly<WakeflowWorkspaceStaticResourceOperationRequest>,
): Readonly<WakeflowWorkspaceStaticResourceOperationContext> {
  if (request.expectedMatrixDigest !== matrix.matrixDigest) {
    fail("matrix-changed", "$request.expectedMatrixDigest");
  }
  const selected = findWakeflowWorkspaceStaticResourceByDeclarationId(
    matrix,
    request.declarationId,
  );
  if (selected === null) {
    fail("declaration-not-found", "$request.declarationId");
  }
  let operation: Readonly<WakeflowResourceOperation>;
  try {
    operation = admitWakeflowResourceOperation(selected.processing, request.recipe);
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("operation", "$request.recipe", error);
    }
    throw error;
  }
  return Object.freeze({
    kind: WAKEFLOW_WORKSPACE_STATIC_RESOURCE_OPERATION_CONTEXT_KIND,
    hostId: matrix.hostId,
    matrixDigest: matrix.matrixDigest,
    declaration: selected,
    operation,
  });
}
