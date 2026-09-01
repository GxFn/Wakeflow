import { executeTargetResultReviewInspectionPublicRequest } from "../governance/review/target-result-review-inspection-public-coordinator.js";

/** Claude Code制品的共享TargetResult Review只读公共入口。 */
export async function executeClaudeCodeTargetResultReviewInspection(
  value: unknown,
) {
  return executeTargetResultReviewInspectionPublicRequest(value);
}
