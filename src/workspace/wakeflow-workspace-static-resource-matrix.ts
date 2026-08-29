import { types } from "node:util";

import {
  WAKEFLOW_CONFIG_RESOURCE_CATALOG,
} from "../configuration/wakeflow-config-resource-catalog.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../foundation/crypto/sha256.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../foundation/crypto/canonical-json-sha256.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import {
  WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG,
} from "../governance/demand/demand-resource-catalog.js";
import {
  WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG,
} from "../governance/ledger/ledger-resource-catalog.js";
import {
  WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG,
} from "../governance/todo/todo-resource-catalog.js";
import {
  WAKEFLOW_ACTIVE_STATIC_RESOURCE_CATALOG,
} from "./active/wakeflow-active-resource-catalog.js";
import {
  WAKEFLOW_MANAGED_INTEGRATION_STATIC_RESOURCE_CATALOG,
} from "./managed-integration/wakeflow-managed-integration-resource-catalog.js";
import {
  WAKEFLOW_MAINTENANCE_STATIC_RESOURCE_CATALOG,
} from "./maintenance/wakeflow-maintenance-resource-catalog.js";
import {
  createWakeflowWorkspaceHostResourceCatalog,
} from "./workspace-host-resource-catalog.js";
import {
  WAKEFLOW_HOST_RUNTIME_STATIC_RESOURCE_CATALOG,
} from "./workspace-host-runtime-resource-catalog.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostId,
} from "./workspace-host-resource-profile.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  WakeflowWorkspaceResourceDeclarationError,
  WAKEFLOW_WORKSPACE_RESOURCE_FAMILIES,
  type WakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceFamily,
  type WakeflowWorkspaceResourcePlacement,
} from "./workspace-resource-declaration.js";

/**
 * Wakeflow Workspace：静态资源矩阵。
 *
 * 本模块显式组合领域静态 Catalog 与一个 Host Profile 对应的 Host Catalog，并只负责
 * 全局准入、排序、摘要和只读查询。具体领域实例、当前文件系统状态、操作方案选择与
 * 副作用均不属于静态矩阵。声明继续保留逻辑根；Config Snapshot 与物理根解析属于
 * 后续布局上下文，不会成为本静态矩阵的隐式输入。
 */

export const WAKEFLOW_WORKSPACE_STATIC_RESOURCE_MATRIX_KIND =
  "WakeflowWorkspaceStaticResourceMatrix" as const;

export interface WakeflowWorkspaceStaticResourceMatrix {
  readonly kind: typeof WAKEFLOW_WORKSPACE_STATIC_RESOURCE_MATRIX_KIND;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly sharedDigest: Sha256Digest;
  readonly matrixDigest: Sha256Digest;
  readonly declarations:
    readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
}

export type WakeflowWorkspaceStaticResourceMatrixErrorReason =
  | "input"
  | "scope"
  | "declaration-id-collision"
  | "placement-collision"
  | "digest"
  | "query";

const ERROR_MESSAGES = {
  input: "Wakeflow static resource matrix input is invalid.",
  scope: "Wakeflow static resource declaration has an invalid scope.",
  "declaration-id-collision":
    "Wakeflow static resource declaration identity is duplicated.",
  "placement-collision":
    "Wakeflow static resources occupy the same logical placement.",
  digest: "Wakeflow static resource matrix digest is invalid.",
  query: "Wakeflow static resource matrix query is invalid.",
} as const satisfies Readonly<Record<
  WakeflowWorkspaceStaticResourceMatrixErrorReason,
  string
>>;

/** 静态资源矩阵组合或唯一性准入失败的稳定、脱敏错误。 */
export class WakeflowWorkspaceStaticResourceMatrixError extends Error {
  override readonly name = "WakeflowWorkspaceStaticResourceMatrixError";
  readonly code = "wakeflow-workspace-static-resource-matrix" as const;
  readonly reason: WakeflowWorkspaceStaticResourceMatrixErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWorkspaceStaticResourceMatrixErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const SHARED_STATIC_RESOURCE_CATALOG = Object.freeze([
  ...WAKEFLOW_CONFIG_RESOURCE_CATALOG,
  ...WAKEFLOW_ACTIVE_STATIC_RESOURCE_CATALOG,
  ...WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG,
  ...WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG,
  ...WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG,
  ...WAKEFLOW_MANAGED_INTEGRATION_STATIC_RESOURCE_CATALOG,
  ...WAKEFLOW_MAINTENANCE_STATIC_RESOURCE_CATALOG,
  ...WAKEFLOW_HOST_RUNTIME_STATIC_RESOURCE_CATALOG,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];

const RESOURCE_FAMILY_SET = new Set<string>(
  WAKEFLOW_WORKSPACE_RESOURCE_FAMILIES,
);
const HOST_ID_SET = new Set<string>(WAKEFLOW_WORKSPACE_HOST_IDS);

function compareDeclarationIds(
  left: Readonly<WakeflowWorkspaceResourceDeclaration>,
  right: Readonly<WakeflowWorkspaceResourceDeclaration>,
): number {
  return left.declarationId < right.declarationId
    ? -1
    : left.declarationId > right.declarationId
      ? 1
      : 0;
}

function sortedDeclarations(
  declarations: readonly Readonly<WakeflowWorkspaceResourceDeclaration>[],
): readonly Readonly<WakeflowWorkspaceResourceDeclaration>[] {
  return Object.freeze([...declarations].sort(compareDeclarationIds));
}

function fail(
  reason: WakeflowWorkspaceStaticResourceMatrixErrorReason,
  path: string,
): never {
  throw new WakeflowWorkspaceStaticResourceMatrixError(reason, path);
}

function placementKey(
  placement: Readonly<WakeflowWorkspaceResourcePlacement>,
): string {
  const root = placement.root;
  const rootIdentity = root.kind === "support-surface"
    ? root.surfaceId
    : root.kind === "repository"
      ? root.repositoryId
      : "";
  return `${root.kind}\u0000${rootIdentity}\u0000${placement.relativePath ?? ""}`;
}

function admitDeclarations(
  sharedValues: readonly Readonly<WakeflowWorkspaceResourceDeclaration>[],
  hostValues: readonly Readonly<WakeflowWorkspaceResourceDeclaration>[],
): Readonly<{
  readonly shared: readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
  readonly all: readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
}> {
  const shared = sharedValues.map((value, index) => {
    const declaration = parseWakeflowWorkspaceResourceDeclaration(value);
    if (declaration.scope !== "host-neutral") {
      fail("scope", `$/declarations/${index}/scope`);
    }
    return declaration;
  });
  const host = hostValues.map((value, index) => {
    const declaration = parseWakeflowWorkspaceResourceDeclaration(value);
    if (declaration.scope !== "current-host") {
      fail("scope", `$/declarations/${shared.length + index}/scope`);
    }
    return declaration;
  });
  const all = [...shared, ...host];
  const declarationIds = new Set<string>();
  const placements = new Set<string>();
  for (const declaration of all) {
    if (declarationIds.has(declaration.declarationId)) {
      fail("declaration-id-collision", "$/declarations");
    }
    declarationIds.add(declaration.declarationId);
    const key = placementKey(declaration.placement);
    if (placements.has(key)) {
      fail("placement-collision", "$/declarations");
    }
    placements.add(key);
  }
  return Object.freeze({
    shared: sortedDeclarations(shared),
    all: sortedDeclarations(all),
  });
}

function sharedDigest(
  declarations: readonly Readonly<WakeflowWorkspaceResourceDeclaration>[],
): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    kind: "WakeflowWorkspaceSharedStaticResourceDigestBasis",
    declarations,
  });
}

function matrixDigest(
  hostId: WakeflowWorkspaceHostId,
  declarations: readonly Readonly<WakeflowWorkspaceResourceDeclaration>[],
): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    kind: "WakeflowWorkspaceStaticResourceMatrixDigestBasis",
    hostId,
    declarations,
  });
}

/** 为一个严格 Host Profile 编译纯只读的静态 Workspace 资源矩阵。 */
export function createWakeflowWorkspaceStaticResourceMatrix(
  profileValue: unknown,
): Readonly<WakeflowWorkspaceStaticResourceMatrix> {
  const profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
  const admitted = admitDeclarations(
    SHARED_STATIC_RESOURCE_CATALOG,
    createWakeflowWorkspaceHostResourceCatalog(profile),
  );
  return Object.freeze({
    kind: WAKEFLOW_WORKSPACE_STATIC_RESOURCE_MATRIX_KIND,
    hostId: profile.hostId,
    sharedDigest: sharedDigest(admitted.shared),
    matrixDigest: matrixDigest(profile.hostId, admitted.all),
    declarations: admitted.all,
  });
}

/**
 * 严格重验静态矩阵的声明、排序、唯一性和两个摘要，并返回解除别名的冻结副本。
 */
export function parseWakeflowWorkspaceStaticResourceMatrix(
  value: unknown,
): Readonly<WakeflowWorkspaceStaticResourceMatrix> {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
  ) {
    fail("input", "$matrix");
  }
  let record: Readonly<Record<string, unknown>>;
  let declarationValues: readonly unknown[];
  try {
    record = parsePlainRecord(value, "$matrix");
    declarationValues = parseDenseArray(
      record.declarations,
      10_000,
      "$matrix.declarations",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$matrix");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 5
    || keys[0] !== "declarations"
    || keys[1] !== "hostId"
    || keys[2] !== "kind"
    || keys[3] !== "matrixDigest"
    || keys[4] !== "sharedDigest"
    || record.kind !== WAKEFLOW_WORKSPACE_STATIC_RESOURCE_MATRIX_KIND
    || typeof record.hostId !== "string"
    || !HOST_ID_SET.has(record.hostId)
  ) {
    fail("input", "$matrix");
  }
  let suppliedSharedDigest: Sha256Digest;
  let suppliedMatrixDigest: Sha256Digest;
  try {
    suppliedSharedDigest = parseSha256Digest(
      record.sharedDigest,
      "$matrix.sharedDigest",
    );
    suppliedMatrixDigest = parseSha256Digest(
      record.matrixDigest,
      "$matrix.matrixDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", error.path);
    throw error;
  }
  const parsedDeclarations = declarationValues.map((declaration, index) => {
    try {
      return parseWakeflowWorkspaceResourceDeclaration(declaration);
    } catch (error: unknown) {
      if (error instanceof WakeflowWorkspaceResourceDeclarationError) {
        fail("input", `$/declarations/${index}`);
      }
      throw error;
    }
  });
  const admitted = admitDeclarations(
    parsedDeclarations.filter((entry) => entry.scope === "host-neutral"),
    parsedDeclarations.filter((entry) => entry.scope === "current-host"),
  );
  if (
    parsedDeclarations.length !== admitted.all.length
    || parsedDeclarations.some((entry, index) => (
      entry.declarationId !== admitted.all[index]?.declarationId
    ))
  ) {
    fail("input", "$matrix.declarations");
  }
  const hostId = record.hostId as WakeflowWorkspaceHostId;
  if (
    sharedDigest(admitted.shared) !== suppliedSharedDigest
    || matrixDigest(hostId, admitted.all) !== suppliedMatrixDigest
  ) {
    fail("digest", "$matrix");
  }
  return Object.freeze({
    kind: WAKEFLOW_WORKSPACE_STATIC_RESOURCE_MATRIX_KIND,
    hostId,
    sharedDigest: suppliedSharedDigest,
    matrixDigest: suppliedMatrixDigest,
    declarations: admitted.all,
  });
}

function queryText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("query", path);
  }
  return value;
}

/** 按全局声明 ID 查找一个静态资源；不存在时返回 `null`。 */
export function findWakeflowWorkspaceStaticResourceByDeclarationId(
  matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>,
  declarationIdValue: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> | null {
  const declarationId = queryText(declarationIdValue, "$/declarationId");
  return matrix.declarations.find((entry) => (
    entry.declarationId === declarationId
  )) ?? null;
}

/** 按资源 family 返回保持矩阵顺序的新冻结数组。 */
export function selectWakeflowWorkspaceStaticResourcesByFamily(
  matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>,
  familyValue: unknown,
): readonly Readonly<WakeflowWorkspaceResourceDeclaration>[] {
  const family = queryText(familyValue, "$/family");
  if (!RESOURCE_FAMILY_SET.has(family)) fail("query", "$/family");
  return Object.freeze(matrix.declarations.filter((entry) => (
    entry.family === (family as WakeflowWorkspaceResourceFamily)
  )));
}

/** 按职责所有者 ID 返回保持矩阵顺序的新冻结数组。 */
export function selectWakeflowWorkspaceStaticResourcesByOwner(
  matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>,
  ownerIdValue: unknown,
): readonly Readonly<WakeflowWorkspaceResourceDeclaration>[] {
  const ownerId = queryText(ownerIdValue, "$/ownerId");
  return Object.freeze(matrix.declarations.filter((entry) => (
    entry.ownerId === ownerId
  )));
}
