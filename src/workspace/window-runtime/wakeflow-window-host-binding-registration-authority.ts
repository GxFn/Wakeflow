import type { WakeflowConfigV3Model } from "../../configuration/wakeflow-config-v3.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { WakeflowDurableId } from "../../foundation/identity/wakeflow-durable-id.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  createWakeflowWindowHostBindingResourceCatalog,
} from "./wakeflow-window-host-binding-resource-catalog.js";
import {
  parseWakeflowWindowHostHandle,
  parseWakeflowWindowHostIdentityProfile,
  WakeflowWindowHostIdentityProfileError,
  type WakeflowWindowHostHandle,
  type WakeflowWindowHostIdentityProfile,
} from "./wakeflow-window-host-identity-profile.js";
import {
  compileWakeflowWindowLaunchIntents,
  WakeflowWindowLaunchIntentError,
} from "./wakeflow-window-launch-intent.js";
import {
  wakeflowWindowBindingRef,
  wakeflowWindowBindingRootRef,
  wakeflowWindowHostBindingMutationLockRef,
} from "./wakeflow-window-runtime-paths.js";
import {
  createWakeflowWindowRuntimeProjectionResourceCatalog,
} from "./wakeflow-window-runtime-resource-catalog.js";
import {
  compileWakeflowWindowRuntimeUnregisteredProjectionSet,
  WakeflowWindowRuntimeUnregisteredProjectionError,
  type WakeflowWindowRuntimeUnregisteredProjectionEntry,
} from "./wakeflow-window-runtime-unregistered-projection.js";

/**
 * Wakeflow Workspace / Window Runtime：Binding registration 的纯 authority 编译。
 *
 * 本模块把当前 Config、Resource/Identity Profiles 与 Agent observation 闭合为唯一
 * launch intent、Binding 目标集合和 unregistered projection source。它不打开
 * workspace、不取得锁、不分配 bindingId，也不执行任何文件写入。
 */

export interface RegisterWakeflowWindowHostBindingRequest {
  readonly config: WakeflowConfigV3Model;
  readonly resourceProfile: WakeflowWorkspaceHostResourceProfile;
  readonly identityProfile: WakeflowWindowHostIdentityProfile;
  readonly observation: Readonly<{
    readonly hostId: WakeflowWorkspaceHostResourceProfile["hostId"];
    readonly windowId: WakeflowDurableId<"window">;
    readonly launchIntentDigest: Sha256Digest;
    readonly handle: Readonly<{ readonly kind: string; readonly value: string }>;
    readonly observedAt: UtcInstant;
  }>;
}

export interface WakeflowWindowHostBindingRegistrationAuthority {
  readonly config: WakeflowConfigV3Model;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
  readonly windowId: WakeflowDurableId<"window">;
  readonly launchIntentDigest: Sha256Digest;
  readonly handle: Readonly<WakeflowWindowHostHandle>;
  readonly observedAt: UtcInstant;
  readonly bindingRef: PortableResourcePath;
  readonly bindingRefs: readonly PortableResourcePath[];
  readonly bindingRootRef: PortableResourcePath;
  readonly lockRef: PortableResourcePath;
  readonly unregisteredProjection:
    Readonly<WakeflowWindowRuntimeUnregisteredProjectionEntry>;
}

export type WakeflowWindowHostBindingRegistrationAuthorityErrorReason =
  | "profile"
  | "handle"
  | "launch-intent"
  | "resource";

const ERROR_MESSAGES = {
  profile: "Window Host Binding registration profiles are inconsistent.",
  handle: "Agent host result contains an invalid current-host handle.",
  "launch-intent": "Agent host result does not match a current launch intent.",
  resource: "Window Host Binding registration resource catalog is inconsistent.",
} as const satisfies Readonly<Record<
  WakeflowWindowHostBindingRegistrationAuthorityErrorReason,
  string
>>;

/** 纯 registration authority 无法闭合时返回的稳定错误。 */
export class WakeflowWindowHostBindingRegistrationAuthorityError
  extends Error {
  override readonly name =
    "WakeflowWindowHostBindingRegistrationAuthorityError";
  readonly code = "wakeflow-window-host-binding-registration-authority" as const;
  readonly reason: WakeflowWindowHostBindingRegistrationAuthorityErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWindowHostBindingRegistrationAuthorityErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowWindowHostBindingRegistrationAuthorityErrorReason,
  path: string,
): never {
  throw new WakeflowWindowHostBindingRegistrationAuthorityError(reason, path);
}

/** 编译一次无 I/O 的 Window Host Binding registration authority。 */
export function compileWakeflowWindowHostBindingRegistrationAuthority(
  request: Readonly<RegisterWakeflowWindowHostBindingRequest>,
): Readonly<WakeflowWindowHostBindingRegistrationAuthority> {
  let resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  let identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
  try {
    resourceProfile = parseWakeflowWorkspaceHostResourceProfile(
      request.resourceProfile,
    );
    identityProfile = parseWakeflowWindowHostIdentityProfile(
      request.identityProfile,
    );
  } catch (error: unknown) {
    if (
      error instanceof WakeflowWorkspaceHostResourceProfileError
      || error instanceof WakeflowWindowHostIdentityProfileError
    ) {
      fail("profile", error.path);
    }
    throw error;
  }
  if (
    !resourceProfile.surfaces.windowIdentity
    || resourceProfile.hostId !== identityProfile.hostId
    || request.observation.hostId !== resourceProfile.hostId
  ) {
    fail("profile", "$profiles");
  }
  let handle: Readonly<WakeflowWindowHostHandle>;
  try {
    handle = parseWakeflowWindowHostHandle(
      identityProfile,
      request.observation.handle,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostIdentityProfileError) {
      fail("handle", error.path);
    }
    throw error;
  }
  let launchSet;
  let unregisteredSet;
  try {
    launchSet = compileWakeflowWindowLaunchIntents(
      request.config,
      resourceProfile,
    );
    unregisteredSet = compileWakeflowWindowRuntimeUnregisteredProjectionSet(
      request.config,
      resourceProfile,
    );
  } catch (error: unknown) {
    if (
      error instanceof WakeflowWindowLaunchIntentError
      || error instanceof WakeflowWindowRuntimeUnregisteredProjectionError
    ) {
      fail("launch-intent", "$observation");
    }
    throw error;
  }
  const launchIntent = launchSet.intents.find((entry) => (
    entry.windowId === request.observation.windowId
  ));
  const unregisteredProjection = unregisteredSet.entries.find((entry) => (
    entry.windowId === request.observation.windowId
  ));
  if (
    launchIntent === undefined
    || unregisteredProjection === undefined
    || launchIntent.intentDigest !== request.observation.launchIntentDigest
  ) {
    fail("launch-intent", "$observation.launchIntentDigest");
  }
  let bindingRefs: readonly PortableResourcePath[];
  try {
    bindingRefs = Object.freeze(
      createWakeflowWindowHostBindingResourceCatalog(
        request.config,
        resourceProfile,
      ).map((entry) => {
        admitWakeflowResourceOperation(entry.processing, "exclusive-create");
        const relativePath = entry.placement.relativePath;
        if (relativePath === null) fail("resource", "$bindingCatalog");
        return relativePath;
      }),
    );
    const projectionDeclaration =
      createWakeflowWindowRuntimeProjectionResourceCatalog(
        request.config,
        resourceProfile,
      ).find((entry) => (
        entry.placement.relativePath === unregisteredProjection.resourceRef
      ));
    if (projectionDeclaration === undefined) {
      fail("resource", "$projectionCatalog");
    }
    admitWakeflowResourceOperation(
      projectionDeclaration.processing,
      "deterministic-rewrite",
    );
  } catch (error: unknown) {
    if (
      error instanceof WakeflowResourceProcessingContractError
      || error instanceof WakeflowWindowHostBindingRegistrationAuthorityError
    ) {
      fail("resource", "$resourceCatalog");
    }
    throw error;
  }
  const bindingRef = wakeflowWindowBindingRef(
    resourceProfile,
    request.observation.windowId,
  );
  if (!bindingRefs.includes(bindingRef)) {
    fail("launch-intent", "$observation.windowId");
  }
  return Object.freeze({
    config: request.config,
    resourceProfile,
    identityProfile,
    windowId: request.observation.windowId,
    launchIntentDigest: request.observation.launchIntentDigest,
    handle,
    observedAt: request.observation.observedAt,
    bindingRef,
    bindingRefs,
    bindingRootRef: wakeflowWindowBindingRootRef(resourceProfile),
    lockRef: wakeflowWindowHostBindingMutationLockRef(resourceProfile),
    unregisteredProjection,
  });
}
