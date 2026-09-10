import type { DemandRouteInspectionResult } from "../../../src/capabilities/demand/contract.js";
import { executeDemandRouteInspectionRequest } from "../../../src/capabilities/demand/service.js";

/** 读活动 Demand 的路由；已归档的 Demand 在这里是断言失败，不是分支。 */
export async function inspectActiveRoute(
  request: Readonly<{ readonly root: string; readonly demandId: string }>,
): Promise<Extract<DemandRouteInspectionResult, { readonly status: "current" }>> {
  const result = await executeDemandRouteInspectionRequest(request);
  if (result.status !== "current") {
    throw new Error(`Expected an active Demand route, got ${result.status}.`);
  }
  return result;
}
