import {
  WAKEFLOW_ACTIVE_ROOT,
} from "../../configuration/wakeflow-config-v3.js";
import {
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";

/** Wakeflow Workspace / Active：共享运行期根目录的固定可移植路径。 */

export const WAKEFLOW_ACTIVE_ROOT_REF =
  parsePortableResourcePath(WAKEFLOW_ACTIVE_ROOT);

export const WAKEFLOW_ACTIVE_CURRENT_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_ACTIVE_ROOT_REF}/current`,
);

/** Workspace级可丢弃导航投影。 */
export const WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF = parsePortableResourcePath(
  `${WAKEFLOW_ACTIVE_ROOT_REF}/index.md`,
);

/** Workspace级可丢弃当前状态投影。 */
export const WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF = parsePortableResourcePath(
  `${WAKEFLOW_ACTIVE_CURRENT_ROOT_REF}/workspace-current-status.md`,
);

/** Active workspace projection owner 的短期互斥锁。 */
export const WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF = parsePortableResourcePath(
  `${WAKEFLOW_ACTIVE_ROOT_REF}/projector.lock`,
);
