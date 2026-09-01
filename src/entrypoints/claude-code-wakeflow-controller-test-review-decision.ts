import { executeControllerTestReviewDecisionPublicRequest } from "../governance/review/controller-test-review-decision-public-coordinator.js";

/** Claude Code制品的Controller Test Review Decision公共入口。 */
export async function executeClaudeCodeControllerTestReviewDecision(
  value: unknown,
) {
  return executeControllerTestReviewDecisionPublicRequest(value);
}
