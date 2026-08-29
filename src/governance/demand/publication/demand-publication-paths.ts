import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
} from "../../../foundation/identity/wakeflow-durable-id.js";
import {
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
} from "../../../workspace/active/wakeflow-active-paths.js";

export { WAKEFLOW_ACTIVE_CURRENT_ROOT_REF };

/**
 * Wakeflow Governance / Demand Publication：Workspace 内创建事务、暂存目录、逐 Demand
 * 锁和最终 Demand 根目录的可移植路径词汇。
 */

export const DEMAND_PUBLICATION_ROOT_REF = parsePortableResourcePath(
  ".wakeflow-active/current/demand-publication",
);
export const DEMAND_PUBLICATION_STAGES_ROOT_REF = parsePortableResourcePath(
  ".wakeflow-active/current/demand-publication/stages",
);
export const DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF =
  parsePortableResourcePath(
    ".wakeflow-active/current/demand-publication/transactions",
  );
export const DEMAND_PUBLICATION_LOCKS_ROOT_REF = parsePortableResourcePath(
  ".wakeflow-active/current/demand-publication/locks",
);

function parseDemandId(value: unknown): WakeflowDurableId<"demand"> {
  return parseWakeflowDurableIdOfKind(value, "demand", "$demandId");
}

export function demandFinalRootRef(value: unknown): PortableResourcePath {
  return parsePortableResourcePath(
    `${WAKEFLOW_ACTIVE_CURRENT_ROOT_REF}/${parseDemandId(value)}`,
  );
}

export function demandPublicationStageRef(value: unknown): PortableResourcePath {
  return parsePortableResourcePath(
    `${DEMAND_PUBLICATION_STAGES_ROOT_REF}/${parseDemandId(value)}`,
  );
}

export function demandPublicationTransactionRef(
  value: unknown,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF}/${parseDemandId(value)}.json`,
  );
}

export function demandPublicationLockRef(value: unknown): PortableResourcePath {
  return parsePortableResourcePath(
    `${DEMAND_PUBLICATION_LOCKS_ROOT_REF}/${parseDemandId(value)}.lock`,
  );
}

/** Demand 根目录内用于阻断正常事件溯源加载的发布标记。 */
export const DEMAND_PUBLICATION_MARKER_REF = parsePortableResourcePath(
  "transactions/publication.json",
);

export function demandFinalPublicationMarkerRef(
  value: unknown,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${demandFinalRootRef(value)}/${DEMAND_PUBLICATION_MARKER_REF}`,
  );
}

export function demandStagePublicationMarkerRef(
  value: unknown,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${demandPublicationStageRef(value)}/${DEMAND_PUBLICATION_MARKER_REF}`,
  );
}
