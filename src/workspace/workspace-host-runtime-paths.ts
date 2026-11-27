import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import {
  hostRuntimeProfilesRootRef,
  hostRuntimeRootRef,
  hostWindowLocatorsRootRef,
} from "../kernel/layout.js";
import type { WakeflowWorkspaceHostResourceProfile } from "./workspace-host-resource-profile.js";

/** Wakeflow Workspace：共享 hosts 根与当前宿主命名空间的可移植路径词汇。 */

export const WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_REF: PortableResourcePath =
  hostRuntimeProfilesRootRef();

export function wakeflowHostRuntimeRootRef(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): PortableResourcePath {
  // Profile 解析保证 runtimeDirectoryName === hostId，路径与 kernel 读取方同源。
  return hostRuntimeRootRef(profile.hostId);
}

export function wakeflowHostIdentityRootRef(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): PortableResourcePath {
  return parsePortableResourcePath(`${wakeflowHostRuntimeRootRef(profile)}/identity`);
}

/** 窗口定位器目录 `identity/window-locators`：与 locator store 同一内核常量（复审 J5）。 */
export function wakeflowHostWindowLocatorsRootRef(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): PortableResourcePath {
  return hostWindowLocatorsRootRef(profile.hostId);
}

export function wakeflowHostProjectionsRootRef(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): PortableResourcePath {
  return parsePortableResourcePath(`${wakeflowHostRuntimeRootRef(profile)}/projections`);
}
