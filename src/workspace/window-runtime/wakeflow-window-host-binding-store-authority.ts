import type { WakeflowConfigModel } from "../../configuration/wakeflow-config.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";
import { createWakeflowWindowHostBindingResourceCatalog } from "./wakeflow-window-host-binding-resource-catalog.js";
import type { WakeflowWindowHostBindingStoreAuthority } from "./wakeflow-window-host-binding-store.js";
import type { WakeflowWindowHostIdentityProfile } from "./wakeflow-window-host-identity-profile.js";
import {
  compileWakeflowWindowRuntimeDesiredTopology,
  WakeflowWindowRuntimeDesiredTopologyError,
} from "./wakeflow-window-runtime-desired-topology.js";
import { wakeflowWindowHostBindingRootRef } from "../wakeflow-window-runtime-paths.js";

/**
 * Wakeflow Workspace / Window Runtime：私有Binding Store的纯读取权威。
 *
 * 该authority只从当前Config和固定宿主profiles派生完整允许路径与私有节点边界；它不
 * 接受handle或Agent observation，也不授权创建、替换、恢复或删除Binding。
 */

type WakeflowWindowHostBindingStoreAuthorityErrorReason = "profile" | "topology" | "resource";

/** Binding Store读取权威无法从当前静态来源闭合时的稳定错误。 */
export class WakeflowWindowHostBindingStoreAuthorityError extends ModuleError<WakeflowWindowHostBindingStoreAuthorityErrorReason> {
  static override readonly code = "wakeflow-window-host-binding-store-authority";
}

const fail: Fail<WakeflowWindowHostBindingStoreAuthorityErrorReason> = failWith(
  WakeflowWindowHostBindingStoreAuthorityError,
);

/**
 * 从当前Config与Host profiles编译完整、零I/O的Binding Store读取权威。三者都是类型化的（Config
 * 来自权威快照或请求入口的解析，profiles 在宿主模块加载时解析）；宿主是否支持窗口身份、两份
 * profile 是否同一宿主仍在这里核对。
 */
export function compileWakeflowWindowHostBindingStoreAuthority(
  config: WakeflowConfigModel,
  resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  identityProfile: Readonly<WakeflowWindowHostIdentityProfile>,
): Readonly<WakeflowWindowHostBindingStoreAuthority> {
  if (
    !resourceProfile.surfaces.windowIdentity ||
    resourceProfile.hostId !== identityProfile.hostId
  ) {
    fail("profile", "$profiles");
  }
  let topology: ReturnType<typeof compileWakeflowWindowRuntimeDesiredTopology>;
  try {
    topology = compileWakeflowWindowRuntimeDesiredTopology(config, resourceProfile);
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowRuntimeDesiredTopologyError) {
      fail("topology", error.path, error);
    }
    throw error;
  }
  let bindingRefs: readonly NonNullable<
    ReturnType<
      typeof createWakeflowWindowHostBindingResourceCatalog
    >[number]["placement"]["relativePath"]
  >[];
  try {
    bindingRefs = Object.freeze(
      createWakeflowWindowHostBindingResourceCatalog(config, resourceProfile).map((declaration) => {
        admitWakeflowResourceOperation(declaration.processing, "exclusive-create");
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
      fail("resource", "$bindingCatalog", error);
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
  });
}
