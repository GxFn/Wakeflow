import {
  buildWakeflowConfigV3Indexes,
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigV3Model,
  type WakeflowManagedSupportSurface,
} from "../../configuration/wakeflow-config-v3.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostId,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  WakeflowWorkspaceResourceDeclarationError,
  type WakeflowWorkspaceResourceDeclaration,
} from "../workspace-resource-declaration.js";

/**
 * Wakeflow Workspace / Support：Config topology 驱动的受管 Support 资源目录。
 *
 * 本目录只为 `ownership: wakeflow-managed` 的 Design/Test surface 生成两个长期声明：
 * host-neutral surface 根目录与当前宿主的 whole-file instruction memory。external-owned
 * surface 不进入本目录；它的 owner-managed 或 managed-block 政策由独立 consumer 处理。
 *
 * 声明以 Config 语义摘要和 Host Profile 绑定，不读取物理目录、不创建 scaffold、不生成
 * memory 字节，也不把动态实例注册进全局静态 Matrix。
 */

export const WAKEFLOW_MANAGED_SUPPORT_RESOURCE_CATALOG_KIND =
  "WakeflowManagedSupportResourceCatalog" as const;

export interface WakeflowManagedSupportResourceCatalog {
  readonly kind: typeof WAKEFLOW_MANAGED_SUPPORT_RESOURCE_CATALOG_KIND;
  readonly configDigest: Sha256Digest;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly catalogDigest: Sha256Digest;
  readonly declarations:
    readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
}

export type WakeflowManagedSupportResourceCatalogErrorReason =
  | "config"
  | "profile"
  | "topology"
  | "declaration";

const ERROR_MESSAGES = {
  config: "Wakeflow managed support resource catalog config is invalid.",
  profile: "Wakeflow managed support resource catalog host profile is invalid.",
  topology: "Wakeflow managed support resource catalog topology is inconsistent.",
  declaration: "Wakeflow managed support resource declaration is invalid.",
} as const satisfies Readonly<Record<
  WakeflowManagedSupportResourceCatalogErrorReason,
  string
>>;

/** 受管 Support 动态资源目录构建失败的稳定、脱敏错误。 */
export class WakeflowManagedSupportResourceCatalogError extends Error {
  override readonly name = "WakeflowManagedSupportResourceCatalogError";
  readonly code = "wakeflow-managed-support-resource-catalog" as const;
  readonly reason: WakeflowManagedSupportResourceCatalogErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowManagedSupportResourceCatalogErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowManagedSupportResourceCatalogErrorReason,
  path: string,
): never {
  throw new WakeflowManagedSupportResourceCatalogError(reason, path);
}

function parseConfig(value: unknown): WakeflowConfigV3Model {
  try {
    return parseWakeflowConfigV3(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("config", error.path);
    throw error;
  }
}

function parseProfile(
  value: unknown,
): Readonly<WakeflowWorkspaceHostResourceProfile> {
  try {
    return parseWakeflowWorkspaceHostResourceProfile(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("profile", error.path);
    }
    throw error;
  }
}

function declaration(
  value: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  try {
    return parseWakeflowWorkspaceResourceDeclaration(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceResourceDeclarationError) {
      fail("declaration", error.path);
    }
    throw error;
  }
}

function rootDeclaration(
  surface: WakeflowManagedSupportSurface,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return declaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: `support.${surface.surfaceId}.root`,
    family: "support",
    ownerId: "support-surface-layout",
    scope: "host-neutral",
    placement: {
      root: { kind: "support-surface", surfaceId: surface.surfaceId },
      relativePath: null,
    },
    tracking: { disposition: "tracked", privacy: "shareable" },
    nodePolicy: {
      kind: "directory",
      mode: "0755",
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

function memoryDeclaration(
  surface: WakeflowManagedSupportSurface,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return declaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId:
      `support.${surface.surfaceId}.instruction.${profile.hostId}`,
    family: "support",
    ownerId: "support-memory",
    scope: "current-host",
    placement: {
      root: { kind: "support-surface", surfaceId: surface.surfaceId },
      relativePath: profile.instructionFileName,
    },
    tracking: { disposition: "tracked", privacy: "shareable" },
    nodePolicy: {
      kind: "file",
      mode: "0644",
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

function compareDeclarations(
  left: Readonly<WakeflowWorkspaceResourceDeclaration>,
  right: Readonly<WakeflowWorkspaceResourceDeclaration>,
): number {
  return left.declarationId < right.declarationId
    ? -1
    : left.declarationId > right.declarationId
      ? 1
      : 0;
}

/** 从严格 Config 与当前 Host Profile 生成受管 Design/Test 动态资源目录。 */
export function createWakeflowManagedSupportResourceCatalog(
  configValue: unknown,
  profileValue: unknown,
): Readonly<WakeflowManagedSupportResourceCatalog> {
  const config = parseConfig(configValue);
  const profile = parseProfile(profileValue);
  const indexes = buildWakeflowConfigV3Indexes(config);
  const declarations: Readonly<WakeflowWorkspaceResourceDeclaration>[] = [];
  for (const surface of config.topology.supportSurfaces) {
    if (surface.ownership !== "wakeflow-managed") continue;
    const window = surface.capability === "design"
      ? indexes.designWindow
      : indexes.testWindow;
    if (window.root.surfaceId !== surface.surfaceId) {
      fail("topology", `$/topology/supportSurfaces/${surface.surfaceId}`);
    }
    declarations.push(
      rootDeclaration(surface),
      memoryDeclaration(surface, profile),
    );
  }
  const sorted = Object.freeze([...declarations].sort(compareDeclarations));
  const configDigest = computeWakeflowConfigV3Digest(config);
  const catalogDigest = computeCanonicalJsonSha256Digest({
    kind: "WakeflowManagedSupportResourceCatalogDigestBasis",
    configDigest,
    hostId: profile.hostId,
    declarations: sorted,
  });
  return Object.freeze({
    kind: WAKEFLOW_MANAGED_SUPPORT_RESOURCE_CATALOG_KIND,
    configDigest,
    hostId: profile.hostId,
    catalogDigest,
    declarations: sorted,
  });
}
