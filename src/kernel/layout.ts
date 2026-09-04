import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import { isWakeflowHostId, type WakeflowHostId } from "../contracts/vocabulary/wakeflow-host-id.js";
import { fail } from "./error.js";

/**
 * Wakeflow Kernel / Layout：工作区内私有运行时根的固定布局。
 *
 * `.wakeflow-local/runtime/hosts/<host>/` 下按宿主分开存放私有权威与观察；
 * 这里只给出路径事实，不创建目录、不解释内容。L1 的 workspace 切片把配置与
 * 布局的其余部分并入本模块。
 */

const WAKEFLOW_LOCAL_RUNTIME_ROOT_REF = parsePortableResourcePath(
  ".wakeflow-local/runtime",
  "$layout",
);

export function parseWakeflowHostId(value: unknown, path = "$hostId"): WakeflowHostId {
  if (!isWakeflowHostId(value)) fail("invalid-request", "host-id", path);
  return value;
}

/** `.wakeflow-local/runtime/hosts/<host>`。 */
export function hostRuntimeRootRef(hostId: WakeflowHostId): PortableResourcePath {
  return parsePortableResourcePath(
    `${WAKEFLOW_LOCAL_RUNTIME_ROOT_REF}/hosts/${parseWakeflowHostId(hostId)}`,
    "$layout",
  );
}

/** 宿主 hook 观察记录目录：`.wakeflow-local/runtime/hosts/<host>/observations/hooks`。 */
export function hostHookObservationsRootRef(hostId: WakeflowHostId): PortableResourcePath {
  return parsePortableResourcePath(`${hostRuntimeRootRef(hostId)}/observations/hooks`, "$layout");
}
