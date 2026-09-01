import { executeControllerImplementationReviewDecisionPublicRequest } from "../governance/review/controller-implementation-review-decision-public-coordinator.js";

/** Claude Code制品的Controller Implementation Review Decision公共入口。 */
export async function executeClaudeCodeControllerImplementationReviewDecision(
  value: unknown,
) {
  return executeControllerImplementationReviewDecisionPublicRequest(value);
}
