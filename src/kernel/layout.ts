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
export const WAKEFLOW_ACTIVE_CURRENT_ROOT_REF = parsePortableResourcePath(
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

const DEMAND_ID_PATTERN =
  /^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function parseDemandIdText(value: string): string {
  if (!DEMAND_ID_PATTERN.test(value)) fail("invalid-request", "demand-id", "$demandId");
  return value;
}

/** 生命周期事务（完成、取消、续接）的步骤日志目录（0700）；活动根删除后日志仍可恢复。 */
export const DEMAND_LIFECYCLE_JOURNALS_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_ACTIVE_CURRENT_ROOT_REF}/lifecycle`,
  "$layout",
);

/** 一个 Demand 的生命周期事务日志：`.wakeflow-active/current/lifecycle/<demandId>.json`。 */
export function demandLifecycleJournalRef(demandId: string): PortableResourcePath {
  return parsePortableResourcePath(
    `${DEMAND_LIFECYCLE_JOURNALS_ROOT_REF}/${parseDemandIdText(demandId)}.json`,
    "$layout",
  );
}

/** Ledger 内归档包容器（tracked，0755）。 */
const LEDGER_ARCHIVES_ROOT_REF = parsePortableResourcePath("archives", "$layout");

/** 一个 Demand 归档包：`<ledger>/archives/<demandId>/<终态事件流修订号，十位>/`。 */
export function demandArchiveRef(demandId: string, streamRevision: number): PortableResourcePath {
  if (!Number.isSafeInteger(streamRevision) || streamRevision < 2) {
    fail("invalid-request", "archive-stream-revision", "$streamRevision");
  }
  return parsePortableResourcePath(
    `${LEDGER_ARCHIVES_ROOT_REF}/${parseDemandIdText(demandId)}/${String(streamRevision).padStart(10, "0")}`,
    "$layout",
  );
}

/** 一个 Demand 的全部归档包所在目录。 */
export function demandArchivesRootRef(demandId: string): PortableResourcePath {
  return parsePortableResourcePath(
    `${LEDGER_ARCHIVES_ROOT_REF}/${parseDemandIdText(demandId)}`,
    "$layout",
  );
}

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

/** 共享协调根下的窗口工作声明目录：`.wakeflow-local/runtime/shared/coordination/window-work-claims`。 */
export const WORK_CLAIMS_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_LOCAL_RUNTIME_ROOT_REF}/shared/coordination/window-work-claims`,
  "$layout",
);

/** 每个稳定窗口至多一份当前工作声明，路径只由 `windowId` 决定。 */
export function workClaimRef(windowId: string): PortableResourcePath {
  return parsePortableResourcePath(`${WORK_CLAIMS_ROOT_REF}/${windowId}.json`, "$layout");
}
