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

const REQUIREMENT_ID_PATTERN =
  /^requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** 共享活动根的当前段：`.wakeflow-active/current`。 */
const WAKEFLOW_ACTIVE_CURRENT_ROOT_REF = parsePortableResourcePath(
  ".wakeflow-active/current",
  "$layout",
);

/** 需求包看板：认领状态文件与人读索引所在目录（0700）。 */
export const REQUIREMENT_BOARD_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_ACTIVE_CURRENT_ROOT_REF}/board`,
  "$layout",
);

/** 看板的人读投影，由认领状态确定性重写。 */
export const REQUIREMENT_BOARD_INDEX_REF = parsePortableResourcePath(
  `${REQUIREMENT_BOARD_ROOT_REF}/index.md`,
  "$layout",
);

/** 一个需求包的认领状态文件：`.wakeflow-active/current/board/<requirementId>.json`。 */
export function requirementClaimStateRef(requirementId: string): PortableResourcePath {
  if (!REQUIREMENT_ID_PATTERN.test(requirementId)) {
    fail("invalid-request", "requirement-id", "$requirementId");
  }
  return parsePortableResourcePath(
    `${REQUIREMENT_BOARD_ROOT_REF}/${requirementId}.json`,
    "$layout",
  );
}

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
