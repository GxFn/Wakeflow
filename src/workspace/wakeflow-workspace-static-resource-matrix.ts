import { WAKEFLOW_CONFIG_RESOURCE_CATALOG } from "../configuration/wakeflow-config-resource-catalog.js";
import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../foundation/error/module-error.js";
import { WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG } from "../governance/demand/demand-resource-catalog.js";
import { WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG } from "../governance/ledger/ledger-resource-catalog.js";
import { WAKEFLOW_MAINTENANCE_STATIC_RESOURCE_CATALOG } from "./wakeflow-maintenance-resource-catalog.js";
import { WAKEFLOW_MANAGED_INTEGRATION_STATIC_RESOURCE_CATALOG } from "./wakeflow-managed-integration-resource-catalog.js";
import {
  WAKEFLOW_ACTIVE_STATIC_RESOURCE_CATALOG,
  WAKEFLOW_REQUIREMENT_BOARD_STATIC_RESOURCE_CATALOG,
} from "./wakeflow-active-static-resource-catalog.js";
import { WORK_CLAIMS_ROOT_RESOURCE_DECLARATION } from "./wakeflow-shared-coordination-layout.js";
import { createWakeflowWorkspaceHostResourceCatalog } from "./workspace-host-resource-catalog.js";
import type { WakeflowHostId } from "../contracts/vocabulary/wakeflow-host-id.js";
import type { WakeflowWorkspaceHostResourceProfile } from "./workspace-host-resource-profile.js";
import { WAKEFLOW_HOST_RUNTIME_STATIC_RESOURCE_CATALOG } from "./workspace-host-runtime-resource-catalog.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourcePlacement,
} from "../kernel/workspace-resource-declaration.js";
import { WAKEFLOW_SHARED_RUNTIME_STATIC_RESOURCE_CATALOG } from "./workspace-shared-runtime-resource-catalog.js";

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
  readonly hostId: WakeflowHostId;
  readonly sharedDigest: Sha256Digest;
  readonly matrixDigest: Sha256Digest;
  readonly declarations: readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
}

export type WakeflowWorkspaceStaticResourceMatrixErrorReason =
  | "scope"
  | "declaration-id-collision"
  | "placement-collision";

/** 静态资源矩阵组合或唯一性准入失败的稳定、脱敏错误。 */
export class WakeflowWorkspaceStaticResourceMatrixError extends ModuleError<WakeflowWorkspaceStaticResourceMatrixErrorReason> {
  static override readonly code = "wakeflow-workspace-static-resource-matrix";
}

const fail: Fail<WakeflowWorkspaceStaticResourceMatrixErrorReason> = failWith(
  WakeflowWorkspaceStaticResourceMatrixError,
);

const SHARED_STATIC_RESOURCE_CATALOG = Object.freeze([
  ...WAKEFLOW_CONFIG_RESOURCE_CATALOG,
  ...WAKEFLOW_ACTIVE_STATIC_RESOURCE_CATALOG,
  ...WAKEFLOW_REQUIREMENT_BOARD_STATIC_RESOURCE_CATALOG,
  ...WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG,
  ...WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG,
  WORK_CLAIMS_ROOT_RESOURCE_DECLARATION,
  ...WAKEFLOW_MANAGED_INTEGRATION_STATIC_RESOURCE_CATALOG,
  ...WAKEFLOW_MAINTENANCE_STATIC_RESOURCE_CATALOG,
  ...WAKEFLOW_HOST_RUNTIME_STATIC_RESOURCE_CATALOG,
  ...WAKEFLOW_SHARED_RUNTIME_STATIC_RESOURCE_CATALOG,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];

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

function logicalRootKey(placement: Readonly<WakeflowWorkspaceResourcePlacement>): string {
  const root = placement.root;
  const rootIdentity =
    root.kind === "support-surface"
      ? root.surfaceId
      : root.kind === "repository"
        ? root.repositoryId
        : "";
  return `${root.kind}\u0000${rootIdentity}`;
}

function assertPlacementTopology(
  declarations: readonly Readonly<WakeflowWorkspaceResourceDeclaration>[],
): void {
  const groups = new Map<
    string,
    {
      readonly declarationByPath: Map<string, Readonly<WakeflowWorkspaceResourceDeclaration>>;
      readonly spellingByPrefix: Map<string, string>;
    }
  >();
  for (const declaration of declarations) {
    const rootKey = logicalRootKey(declaration.placement);
    let group = groups.get(rootKey);
    if (group === undefined) {
      group = {
        declarationByPath: new Map(),
        spellingByPrefix: new Map(),
      };
      groups.set(rootKey, group);
    }
    const path = declaration.placement.relativePath ?? "";
    const segments = path.length === 0 ? [] : path.split("/");
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix.length === 0 ? segment : `${prefix}/${segment}`;
      const folded = prefix.toLowerCase();
      const existingSpelling = group.spellingByPrefix.get(folded);
      if (existingSpelling !== undefined && existingSpelling !== prefix) {
        fail("placement-collision", "$/declarations");
      }
      group.spellingByPrefix.set(folded, prefix);
    }
    const foldedPath = path.toLowerCase();
    if (group.declarationByPath.has(foldedPath)) {
      fail("placement-collision", "$/declarations");
    }
    group.declarationByPath.set(foldedPath, declaration);
  }

  for (const group of groups.values()) {
    for (const path of group.declarationByPath.keys()) {
      const segments = path.length === 0 ? [] : path.split("/");
      const ancestorPaths = [""];
      let ancestorPath = "";
      for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (segment === undefined) {
          fail("placement-collision", "$/declarations");
        }
        ancestorPath = ancestorPath.length === 0 ? segment : `${ancestorPath}/${segment}`;
        ancestorPaths.push(ancestorPath);
      }
      for (const ancestorPath of ancestorPaths) {
        if (ancestorPath === path) continue;
        const ancestor = group.declarationByPath.get(ancestorPath);
        if (ancestor === undefined) continue;
        if (
          ancestor.nodePolicy.kind !== "directory" ||
          ancestor.processing.kind !== "directory-container"
        ) {
          fail("placement-collision", "$/declarations");
        }
      }
    }
  }
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
  for (const declaration of all) {
    if (declarationIds.has(declaration.declarationId)) {
      fail("declaration-id-collision", "$/declarations");
    }
    declarationIds.add(declaration.declarationId);
  }
  assertPlacementTopology(all);
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
  hostId: WakeflowHostId,
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
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): Readonly<WakeflowWorkspaceStaticResourceMatrix> {
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

/** 按全局声明 ID 查找一个静态资源；不存在时返回 `null`。 */
export function findWakeflowWorkspaceStaticResourceByDeclarationId(
  matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>,
  declarationId: string,
): Readonly<WakeflowWorkspaceResourceDeclaration> | null {
  return matrix.declarations.find((entry) => entry.declarationId === declarationId) ?? null;
}
