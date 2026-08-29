import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
  type WakeflowResourceOperation,
} from "../foundation/resource/resource-processing-contract.js";
import {
  findWakeflowWorkspaceStaticResourceByDeclarationId,
  parseWakeflowWorkspaceStaticResourceMatrix,
  WakeflowWorkspaceStaticResourceMatrixError,
  type WakeflowWorkspaceStaticResourceMatrix,
} from "./wakeflow-workspace-static-resource-matrix.js";
import type {
  WakeflowWorkspaceHostId,
} from "./workspace-host-resource-profile.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "./workspace-resource-declaration.js";

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
  readonly kind:
    typeof WAKEFLOW_WORKSPACE_STATIC_RESOURCE_OPERATION_CONTEXT_KIND;
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

const ERROR_MESSAGES = {
  input: "Wakeflow static resource operation context input is invalid.",
  matrix: "Wakeflow static resource operation context matrix is invalid.",
  "matrix-changed":
    "Wakeflow static resource matrix differs from its expectation.",
  "declaration-not-found":
    "Wakeflow static resource declaration does not exist.",
  operation: "Wakeflow static resource operation is not admitted.",
} as const satisfies Readonly<Record<
  WakeflowWorkspaceStaticResourceOperationContextErrorReason,
  string
>>;

/** 静态资源操作上下文准入失败的稳定、脱敏错误。 */
export class WakeflowWorkspaceStaticResourceOperationContextError
  extends Error {
  override readonly name =
    "WakeflowWorkspaceStaticResourceOperationContextError";
  readonly code =
    "wakeflow-workspace-static-resource-operation-context" as const;
  readonly reason: WakeflowWorkspaceStaticResourceOperationContextErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWorkspaceStaticResourceOperationContextErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedRequest {
  readonly expectedMatrixDigest: Sha256Digest;
  readonly declarationId: string;
  readonly recipe: unknown;
}

function fail(
  reason: WakeflowWorkspaceStaticResourceOperationContextErrorReason,
  path: string,
): never {
  throw new WakeflowWorkspaceStaticResourceOperationContextError(reason, path);
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
}

function parseRequest(value: unknown): Readonly<ParsedRequest> {
  const record = plainRecord(value, "$request");
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3
    || keys[0] !== "declarationId"
    || keys[1] !== "expectedMatrixDigest"
    || keys[2] !== "recipe"
    || typeof record.declarationId !== "string"
    || record.declarationId.length === 0
  ) {
    fail("input", "$request");
  }
  let expectedMatrixDigest: Sha256Digest;
  try {
    expectedMatrixDigest = parseSha256Digest(
      record.expectedMatrixDigest,
      "$request.expectedMatrixDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      fail("input", "$request.expectedMatrixDigest");
    }
    throw error;
  }
  return Object.freeze({
    expectedMatrixDigest,
    declarationId: record.declarationId,
    recipe: record.recipe,
  });
}

/** 把一个静态矩阵声明与调用方选择的唯一 recipe 绑定为冻结上下文。 */
export function createWakeflowWorkspaceStaticResourceOperationContext(
  matrixValue: unknown,
  requestValue: unknown,
): Readonly<WakeflowWorkspaceStaticResourceOperationContext> {
  let matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  try {
    matrix = parseWakeflowWorkspaceStaticResourceMatrix(matrixValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceStaticResourceMatrixError) {
      fail("matrix", "$matrix");
    }
    throw error;
  }
  const request = parseRequest(requestValue);
  if (request.expectedMatrixDigest !== matrix.matrixDigest) {
    fail("matrix-changed", "$request.expectedMatrixDigest");
  }
  let selected;
  try {
    selected = findWakeflowWorkspaceStaticResourceByDeclarationId(
      matrix,
      request.declarationId,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceStaticResourceMatrixError) {
      fail("input", "$request.declarationId");
    }
    throw error;
  }
  if (selected === null) {
    fail("declaration-not-found", "$request.declarationId");
  }
  const declaration = parseWakeflowWorkspaceResourceDeclaration(selected);
  let operation: Readonly<WakeflowResourceOperation>;
  try {
    operation = admitWakeflowResourceOperation(
      declaration.processing,
      request.recipe,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("operation", "$request.recipe");
    }
    throw error;
  }
  return Object.freeze({
    kind: WAKEFLOW_WORKSPACE_STATIC_RESOURCE_OPERATION_CONTEXT_KIND,
    hostId: matrix.hostId,
    matrixDigest: matrix.matrixDigest,
    declaration,
    operation,
  });
}
