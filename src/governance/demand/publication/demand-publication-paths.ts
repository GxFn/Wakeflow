import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../../foundation/filesystem/portable-resource-path.js";
import { demandFinalRootRef } from "../../../kernel/layout.js";

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
export const DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF = parsePortableResourcePath(
  ".wakeflow-active/current/demand-publication/transactions",
);

/**
 * Demand 身份在能力层的请求、计划与结果里一路是字符串（Schema 已按领域文法核过）；这些路径
 * 词汇是它们换成类型化身份的地方，所以这一次解析留在这里。
 */
function parseDemandId(value: string): WakeflowDurableId<"demand"> {
  return parseWakeflowDurableIdOfKind(value, "demand", "$demandId");
}

export function demandPublicationStageRef(demandId: string): PortableResourcePath {
  return parsePortableResourcePath(
    `${DEMAND_PUBLICATION_STAGES_ROOT_REF}/${parseDemandId(demandId)}`,
  );
}

/** Demand 根目录内用于阻断正常事件溯源加载的发布标记。 */
export const DEMAND_PUBLICATION_MARKER_REF = parsePortableResourcePath(
  "transactions/publication.json",
);

export function demandFinalPublicationMarkerRef(demandId: string): PortableResourcePath {
  return parsePortableResourcePath(
    `${demandFinalRootRef(demandId)}/${DEMAND_PUBLICATION_MARKER_REF}`,
  );
}

/** 还没有改名生效时，同一份标记在暂存根里的位置。 */
export function demandStagePublicationMarkerRef(demandId: string): PortableResourcePath {
  return parsePortableResourcePath(
    `${demandPublicationStageRef(demandId)}/${DEMAND_PUBLICATION_MARKER_REF}`,
  );
}
