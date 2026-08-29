import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
} from "./workspace-host-resource-profile.js";

/** Wakeflow Workspace：共享 hosts 根与当前宿主命名空间的可移植路径词汇。 */

export const WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_REF =
  parsePortableResourcePath(".wakeflow-local/runtime/hosts");

export function wakeflowHostRuntimeRootRef(
  profileValue: unknown,
): PortableResourcePath {
  const profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
  return parsePortableResourcePath(
    `${WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_REF}/${profile.runtimeDirectoryName}`,
  );
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
