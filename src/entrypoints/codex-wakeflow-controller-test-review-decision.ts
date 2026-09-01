import { executeControllerTestReviewDecisionPublicRequest } from "../governance/review/controller-test-review-decision-public-coordinator.js";

/** Codex制品的Controller Test Review Decision公共入口。 */
export async function executeCodexControllerTestReviewDecision(value: unknown) {
  return executeControllerTestReviewDecisionPublicRequest(value);
}
