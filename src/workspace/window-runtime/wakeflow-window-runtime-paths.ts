import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";
import {
  wakeflowHostIdentityRootRef,
  wakeflowHostProjectionsRootRef,
} from "../workspace-host-runtime-paths.js";

/**
 * Wakeflow Workspace / Window Runtime：当前宿主的 identity 与 projection 路径词汇。
 *
 * 本模块只从严格 Host Profile 和稳定 windowId 派生可移植引用，不读取 Binding、投影
 * 或文件系统，也不接受 display name、绝对路径或任意文件名。Profile 与 windowId 是类型化的
 * （Profile 在宿主模块加载时解析，windowId 来自配置模型或请求入口的解析）。
 */

export function wakeflowWindowHostBindingRootRef(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): PortableResourcePath {
  return parsePortableResourcePath(`${wakeflowHostIdentityRootRef(profile)}/window-bindings`);
}

export function wakeflowWindowHostBindingRef(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  windowId: WakeflowDurableId<"window">,
): PortableResourcePath {
  return parsePortableResourcePath(`${wakeflowWindowHostBindingRootRef(profile)}/${windowId}.json`);
}

export function wakeflowWindowRuntimeProjectionRootRef(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): PortableResourcePath {
  return parsePortableResourcePath(`${wakeflowHostProjectionsRootRef(profile)}/window-runtime`);
}

export function wakeflowWindowRuntimeProjectionRef(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  windowId: WakeflowDurableId<"window">,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${wakeflowWindowRuntimeProjectionRootRef(profile)}/${windowId}.json`,
  );
}
