import { executeTargetResultReviewInspectionPublicRequest } from "../governance/review/target-result-review-inspection-public-coordinator.js";

/** Codex制品的共享TargetResult Review只读公共入口。 */
export async function executeCodexTargetResultReviewInspection(value: unknown) {
  return executeTargetResultReviewInspectionPublicRequest(value);
}
