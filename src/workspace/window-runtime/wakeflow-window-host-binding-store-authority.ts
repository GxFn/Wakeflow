import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import { createWakeflowWindowHostBindingResourceCatalog } from "./wakeflow-window-host-binding-resource-catalog.js";
import type { WakeflowWindowHostBindingStoreAuthority } from "./wakeflow-window-host-binding-store.js";
import {
  parseWakeflowWindowHostIdentityProfile,
  WakeflowWindowHostIdentityProfileError,
  type WakeflowWindowHostIdentityProfile,
} from "./wakeflow-window-host-identity-profile.js";
import {
  compileWakeflowWindowRuntimeDesiredTopology,
  WakeflowWindowRuntimeDesiredTopologyError,
} from "./wakeflow-window-runtime-desired-topology.js";
import {
  wakeflowWindowHostBindingMutationLockRef,
  wakeflowWindowHostBindingRootRef,
} from "./wakeflow-window-runtime-paths.js";

/**
 * Wakeflow Workspace / Window Runtime：私有Binding Store的纯读取权威。
 *
 * 该authority只从当前Config和固定宿主profiles派生完整允许路径与私有节点边界；它不
 * 接受handle或Agent observation，也不授权创建、替换、恢复或删除Binding。
 */

type WakeflowWindowHostBindingStoreAuthorityErrorReason =
  "profile" | "topology" | "resource";

const ERROR_MESSAGES = {
  profile: "Window Host Binding Store authority profiles are inconsistent.",
  topology: "Window Host Binding Store authority topology is invalid.",
  resource: "Window Host Binding Store authority resource catalog is invalid.",
} as const satisfies Readonly<
  Record<WakeflowWindowHostBindingStoreAuthorityErrorReason, string>
>;

/** Binding Store读取权威无法从当前静态来源闭合时的稳定错误。 */
export class WakeflowWindowHostBindingStoreAuthorityError extends Error {
  override readonly name = "WakeflowWindowHostBindingStoreAuthorityError";
  readonly code = "wakeflow-window-host-binding-store-authority" as const;
  readonly reason: WakeflowWindowHostBindingStoreAuthorityErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWindowHostBindingStoreAuthorityErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowWindowHostBindingStoreAuthorityErrorReason,
  path: string,
): never {
  throw new WakeflowWindowHostBindingStoreAuthorityError(reason, path);
}

/** 从当前Config与Host profiles编译完整、零I/O的Binding Store读取权威。 */
export function compileWakeflowWindowHostBindingStoreAuthority(
  configValue: unknown,
  resourceProfileValue: unknown,
  identityProfileValue: unknown,
): Readonly<WakeflowWindowHostBindingStoreAuthority> {
  let resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  let identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
  try {
    resourceProfile =
      parseWakeflowWorkspaceHostResourceProfile(resourceProfileValue);
    identityProfile =
      parseWakeflowWindowHostIdentityProfile(identityProfileValue);
  } catch (error: unknown) {
    if (
      error instanceof WakeflowWorkspaceHostResourceProfileError ||
      error instanceof WakeflowWindowHostIdentityProfileError
    ) {
      fail("profile", error.path);
    }
    throw error;
  }
  if (
    !resourceProfile.surfaces.windowIdentity ||
    resourceProfile.hostId !== identityProfile.hostId
  ) {
    fail("profile", "$profiles");
  }
  let topology;
  try {
    topology = compileWakeflowWindowRuntimeDesiredTopology(
      configValue,
      resourceProfile,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowRuntimeDesiredTopologyError) {
      fail("topology", error.path);
    }
    throw error;
  }
  let bindingRefs;
  try {
    bindingRefs = Object.freeze(
      createWakeflowWindowHostBindingResourceCatalog(
        configValue,
        resourceProfile,
      ).map((declaration) => {
        admitWakeflowResourceOperation(
          declaration.processing,
          "exclusive-create",
        );
        const ref = declaration.placement.relativePath;
        if (ref === null) fail("resource", "$bindingCatalog");
        return ref;
      }),
    );
  } catch (error: unknown) {
    if (
      error instanceof WakeflowResourceProcessingContractError ||
      error instanceof WakeflowWindowHostBindingStoreAuthorityError
    ) {
      fail("resource", "$bindingCatalog");
    }
    throw error;
  }
  if (
    bindingRefs.length !== topology.windows.length ||
    new Set(bindingRefs).size !== bindingRefs.length
  ) {
    fail("resource", "$bindingCatalog");
  }
  return Object.freeze({
    programId: topology.programId,
    resourceProfile,
    identityProfile,
    bindingRefs,
    bindingRootRef: wakeflowWindowHostBindingRootRef(resourceProfile),
    lockRef: wakeflowWindowHostBindingMutationLockRef(resourceProfile),
  });
}
