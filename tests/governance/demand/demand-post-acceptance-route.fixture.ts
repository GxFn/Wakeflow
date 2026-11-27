import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import type { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
} from "../../../src/governance/demand/demand-operation-authority-context.js";
import {
  buildDemandPostAcceptanceRoute,
  type DemandPostAcceptanceRoute,
} from "../../../src/governance/demand/demand-post-acceptance-route.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/demand/demand-result-review-snapshot.js";

/** 与 Controller 路由、完成计划同一种读法：打开 Demand 上下文，读评审快照，构造 post-acceptance 路由。 */
export async function readPostAcceptanceRoute(
  workspaceRoot: RootedDirectory,
  demandId: string,
): Promise<Readonly<DemandPostAcceptanceRoute>> {
  const context = await openDemandOperationAuthorityContext(
    workspaceRoot,
    parseWakeflowDurableIdOfKind(demandId, "demand"),
    undefined,
  );
  try {
    return buildDemandPostAcceptanceRoute(
      context.loaded,
      await readDemandResultReviewSnapshot(context.demandRoot),
    );
  } finally {
    await closeDemandOperationAuthorityContext(context);
  }
}
