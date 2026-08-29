import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import {
  createWakeflowWorkspaceHostResourceCatalog,
} from "../workspace-host-resource-catalog.js";
import {
  WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_RESOURCE_DECLARATION,
} from "../workspace-host-runtime-resource-catalog.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
} from "../workspace-host-resource-profile.js";
import type { WakeflowWorkspaceResourceDeclaration } from "../workspace-resource-declaration.js";
import {
  createWakeflowWindowRuntimeProjectionResourceCatalog,
} from "./wakeflow-window-runtime-resource-catalog.js";
import {
  compileWakeflowWindowRuntimeUnregisteredProjectionSet,
  type WakeflowWindowRuntimeUnregisteredProjectionSet,
} from "./wakeflow-window-runtime-unregistered-projection.js";

/**
 * Wakeflow Workspace / Window Runtime：Fresh 布局与未注册投影的完整目标权威。
 *
 * 该纯 authority 同时绑定共享/当前宿主父容器、空 Binding namespace、projection 根、
 * 每窗口文件声明和确定性投影集合。它不观察文件系统，也不授权注册真实 handle。
 */

export interface WakeflowFreshWindowRuntimeAuthority {
  readonly kind: "WakeflowFreshWindowRuntimeAuthority";
  readonly schemaVersion: 1;
  readonly layoutDeclarations:
    readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
  readonly projectionDeclarations:
    readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
  readonly projectionSet:
    Readonly<WakeflowWindowRuntimeUnregisteredProjectionSet>;
  readonly authorityDigest: Sha256Digest;
}

export type WakeflowFreshWindowRuntimeAuthorityErrorReason =
  | "profile"
  | "catalog";

const ERROR_MESSAGES = {
  profile: "Fresh Window Runtime requires a host with window identity support.",
  catalog: "Fresh Window Runtime resource catalog is incomplete.",
} as const satisfies Readonly<Record<
  WakeflowFreshWindowRuntimeAuthorityErrorReason,
  string
>>;

/** Fresh Window Runtime authority 编译失败的稳定、脱敏错误。 */
export class WakeflowFreshWindowRuntimeAuthorityError extends Error {
  override readonly name = "WakeflowFreshWindowRuntimeAuthorityError";
  readonly code = "wakeflow-fresh-window-runtime-authority" as const;
  readonly reason: WakeflowFreshWindowRuntimeAuthorityErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowFreshWindowRuntimeAuthorityErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowFreshWindowRuntimeAuthorityErrorReason,
  path: string,
): never {
  throw new WakeflowFreshWindowRuntimeAuthorityError(reason, path);
}

/** 为同一 strict Config/Host 编译 Fresh Window Runtime 的完整纯目标。 */
export function compileWakeflowFreshWindowRuntimeAuthority(
  configValue: unknown,
  profileValue: unknown,
): Readonly<WakeflowFreshWindowRuntimeAuthority> {
  let profile;
  try {
    profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("profile", error.path);
    }
    throw error;
  }
  if (!profile.surfaces.windowIdentity) fail("profile", "$/surfaces/windowIdentity");
  const hostCatalog = createWakeflowWorkspaceHostResourceCatalog(profile);
  const requiredIds = [
    `host-runtime.${profile.hostId}.root`,
    `host-runtime.${profile.hostId}.identity-root`,
    `host-runtime.${profile.hostId}.projections-root`,
    `host-runtime.${profile.hostId}.window-identity-root`,
    `host-runtime.${profile.hostId}.window-runtime-projections-root`,
  ];
  const hostDeclarations = requiredIds.map((declarationId) => {
    const declaration = hostCatalog.find((entry) => (
      entry.declarationId === declarationId
    ));
    if (declaration === undefined) fail("catalog", "$layoutDeclarations");
    return declaration;
  });
  const layoutDeclarations = Object.freeze([
    WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_RESOURCE_DECLARATION,
    ...hostDeclarations,
  ]);
  const projectionSet = compileWakeflowWindowRuntimeUnregisteredProjectionSet(
    configValue,
    profile,
  );
  const projectionDeclarations =
    createWakeflowWindowRuntimeProjectionResourceCatalog(configValue, profile);
  if (projectionDeclarations.length !== projectionSet.entries.length) {
    fail("catalog", "$projectionDeclarations");
  }
  const basis = {
    kind: "WakeflowFreshWindowRuntimeAuthority" as const,
    schemaVersion: 1 as const,
    layoutDeclarations,
    projectionDeclarations,
    projectionSetDigest: projectionSet.projectionSetDigest,
  };
  return Object.freeze({
    kind: basis.kind,
    schemaVersion: basis.schemaVersion,
    layoutDeclarations,
    projectionDeclarations,
    projectionSet,
    authorityDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}
