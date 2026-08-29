import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
} from "../../foundation/identity/wakeflow-durable-id.js";
import {
  wakeflowHostIdentityRootRef,
  wakeflowHostProjectionsRootRef,
} from "../workspace-host-runtime-paths.js";

/**
 * Wakeflow Workspace / Window Runtime：当前宿主的 identity 与 projection 路径词汇。
 *
 * 本模块只从严格 Host Profile 和稳定 windowId 派生可移植引用，不读取 Binding、投影
 * 或文件系统，也不接受 display name、绝对路径或任意文件名。
 */

export function wakeflowWindowBindingRootRef(
  profileValue: unknown,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${wakeflowHostIdentityRootRef(profileValue)}/window-bindings`,
  );
}

export function wakeflowWindowBindingRef(
  profileValue: unknown,
  windowIdValue: unknown,
): PortableResourcePath {
  const windowId = parseWakeflowDurableIdOfKind(
    windowIdValue,
    "window",
    "$windowId",
  );
  return parsePortableResourcePath(
    `${wakeflowWindowBindingRootRef(profileValue)}/${windowId}.json`,
  );
}

/** 当前宿主全部 Window Host Binding mutation 共用的短生命周期独占锁。 */
export function wakeflowWindowHostBindingMutationLockRef(
  profileValue: unknown,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${wakeflowWindowBindingRootRef(profileValue)}/.registration.lock`,
  );
}

export function wakeflowWindowRuntimeProjectionRootRef(
  profileValue: unknown,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${wakeflowHostProjectionsRootRef(profileValue)}/window-runtime`,
  );
}

export function wakeflowWindowRuntimeProjectionRef(
  profileValue: unknown,
  windowIdValue: unknown,
): PortableResourcePath {
  const windowId = parseWakeflowDurableIdOfKind(
    windowIdValue,
    "window",
    "$windowId",
  );
  return parsePortableResourcePath(
    `${wakeflowWindowRuntimeProjectionRootRef(profileValue)}/${windowId}.json`,
  );
}
