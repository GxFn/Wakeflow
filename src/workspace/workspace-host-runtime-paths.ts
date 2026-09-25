import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import { hostRuntimeProfilesRootRef, hostRuntimeRootRef } from "../kernel/layout.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
} from "./workspace-host-resource-profile.js";

/** Wakeflow Workspace：共享 hosts 根与当前宿主命名空间的可移植路径词汇。 */

export const WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_REF: PortableResourcePath =
  hostRuntimeProfilesRootRef();

export function wakeflowHostRuntimeRootRef(
  profileValue: unknown,
): PortableResourcePath {
  // Profile 解析保证 runtimeDirectoryName === hostId，路径与 kernel 读取方同源。
  const profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
  return hostRuntimeRootRef(profile.hostId);
}

export function wakeflowHostIdentityRootRef(
  profileValue: unknown,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${wakeflowHostRuntimeRootRef(profileValue)}/identity`,
  );
}

export function wakeflowHostProjectionsRootRef(
  profileValue: unknown,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${wakeflowHostRuntimeRootRef(profileValue)}/projections`,
  );
}
