import {
  type ControllerImplementationReviewDecisionServiceFixture,
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
  decideFixtureImplementation,
} from "../review/controller-implementation-review-decision-service.fixture.js";
import type { TargetTaskPlanningWorkspaceFixtureOptions } from "../tasking/target-task-planning-service.fixture.js";

export interface AcceptedDemandCompletionWorkspaceFixture
  extends ControllerImplementationReviewDecisionServiceFixture {
  readonly acceptedDecisionId: string;
}

/** 实现目标经切片 accept 之后的 Demand：完成、测试规划与后续链从这里出发。 */
export async function createAcceptedDemandCompletionWorkspaceFixture(
  options: TargetTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<AcceptedDemandCompletionWorkspaceFixture>> {
  const fixture = await createControllerImplementationReviewDecisionServiceFixture({
    coverAllCriteria: options.testingMode !== "real-environment",
    ...options,
  });
  try {
    const accepted = await decideFixtureImplementation(fixture);
    if (accepted.target.phase !== "accepted") {
      throw new Error("Expected the fixture implementation target to be accepted.");
    }
    return Object.freeze({
      ...fixture,
      acceptedDecisionId: accepted.decision.targetReviewDecisionId,
    });
  } catch (error: unknown) {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
    throw error;
  }
}

export async function cleanupAcceptedDemandCompletionWorkspaceFixture(
  fixture: Readonly<AcceptedDemandCompletionWorkspaceFixture>,
): Promise<void> {
  await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
}
