import { executeControllerImplementationReviewDecisionPublicRequest } from "../governance/review/controller-implementation-review-decision-public-coordinator.js";

/** Codex制品的Controller Implementation Review Decision公共入口。 */
export async function executeCodexControllerImplementationReviewDecision(
  value: unknown,
) {
  return executeControllerImplementationReviewDecisionPublicRequest(value);
}
