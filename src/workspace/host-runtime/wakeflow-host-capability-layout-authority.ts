import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import {
  createWakeflowWorkspaceHostResourceCatalog,
} from "../workspace-host-resource-catalog.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostId,
} from "../workspace-host-resource-profile.js";
import type { WakeflowWorkspaceResourceDeclaration } from "../workspace-resource-declaration.js";

/**
 * Wakeflow Workspace / Host Runtime：当前宿主 capability 父目录的纯目标权威。
 *
 * 本 authority 只选择 Profile 声明适用的目录型资源，不包含 instruction/settings 文件、
 * statusline asset、Binding、Window Runtime projection 或任何事件产生的子资源。
 */

export interface WakeflowHostCapabilityLayoutAuthority {
  readonly kind: "WakeflowHostCapabilityLayoutAuthority";
  readonly schemaVersion: 1;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly declarations:
    readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
  readonly authorityDigest: Sha256Digest;
}

export type WakeflowHostCapabilityLayoutAuthorityErrorReason =
  | "profile"
  | "catalog";

const ERROR_MESSAGES = {
  profile: "Host capability layout profile is invalid.",
  catalog: "Host capability layout catalog is incomplete.",
} as const satisfies Readonly<Record<
  WakeflowHostCapabilityLayoutAuthorityErrorReason,
  string
>>;

/** Host capability layout authority 编译失败的稳定、脱敏错误。 */
export class WakeflowHostCapabilityLayoutAuthorityError extends Error {
  override readonly name = "WakeflowHostCapabilityLayoutAuthorityError";
  readonly code = "wakeflow-host-capability-layout-authority" as const;
  readonly reason: WakeflowHostCapabilityLayoutAuthorityErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowHostCapabilityLayoutAuthorityErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowHostCapabilityLayoutAuthorityErrorReason,
  path: string,
): never {
  throw new WakeflowHostCapabilityLayoutAuthorityError(reason, path);
}

function operationSurfaceIsPresent(
  profile: ReturnType<typeof parseWakeflowWorkspaceHostResourceProfile>,
): boolean {
  return profile.surfaces.keepLive
    || profile.surfaces.windowLocator
    || profile.surfaces.statuslineAsset !== null
    || profile.surfaces.activityMonitor
    || profile.surfaces.temporaryPrompts;
}

/** 仅按 Profile capability 编译父目录声明；不按 hostId 分支。 */
export function compileWakeflowHostCapabilityLayoutAuthority(
  profileValue: unknown,
): Readonly<WakeflowHostCapabilityLayoutAuthority> {
  let profile;
  try {
    profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("profile", error.path);
    }
    throw error;
  }
  const prefix = `host-runtime.${profile.hostId}`;
  const declarationIds: string[] = [];
  if (profile.surfaces.podEvidence) {
    declarationIds.push(
      `${prefix}.evidence-root`,
      `${prefix}.pod-evidence-root`,
    );
  }
  if (operationSurfaceIsPresent(profile)) {
    declarationIds.push(`${prefix}.operations-root`);
  }
  if (profile.surfaces.keepLive) {
    declarationIds.push(
      `${prefix}.keep-live-root`,
      `${prefix}.keep-live-leases-root`,
    );
  }
  if (profile.surfaces.windowLocator) {
    declarationIds.push(`${prefix}.window-locators-root`);
  }
  if (profile.surfaces.statuslineAsset !== null) {
    declarationIds.push(`${prefix}.statusline-assets-root`);
  }
  if (profile.surfaces.activityMonitor) {
    declarationIds.push(`${prefix}.activity-monitor-root`);
  }
  if (profile.surfaces.temporaryPrompts) {
    declarationIds.push(
      `${prefix}.temporary-root`,
      `${prefix}.temporary-prompts-root`,
    );
  }
  const catalog = createWakeflowWorkspaceHostResourceCatalog(profile);
  const declarations = Object.freeze(declarationIds.map((declarationId) => {
    const declaration = catalog.find((entry) => (
      entry.declarationId === declarationId
    ));
    if (
      declaration === undefined
      || declaration.nodePolicy.kind !== "directory"
      || declaration.processing.kind !== "directory-container"
    ) {
      fail("catalog", "$declarations");
    }
    return declaration;
  }));
  const basis = {
    kind: "WakeflowHostCapabilityLayoutAuthority" as const,
    schemaVersion: 1 as const,
    hostId: profile.hostId,
    declarations,
  };
  return Object.freeze({
    ...basis,
    authorityDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}
