import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
  decideFixtureImplementation,
  type ControllerImplementationReviewDecisionServiceFixture,
} from "../review/controller-implementation-review-decision-service.fixture.js";
import type { TargetTaskPlanningWorkspaceFixtureOptions } from "../tasking/target-task-planning-service.fixture.js";

export const COMPLETION_COMPLETED_AT = parseUtcInstant(
  "2026-08-29T12:20:00.000Z",
);

const COMPLETION_UUIDS = Object.freeze([
  "d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4",
  "d5d5d5d5-d5d5-45d5-85d5-d5d5d5d5d5d5",
]);

export interface AcceptedDemandCompletionWorkspaceFixture extends ControllerImplementationReviewDecisionServiceFixture {
  readonly acceptedDecisionId: string;
}

export function completionUuidFactory(): () => string {
  let index = 0;
  return () => COMPLETION_UUIDS[index++] ?? "invalid";
}

/** 实现目标经切片 accept 之后的 Demand：完成、测试规划与后续链从这里出发。 */
export async function createAcceptedDemandCompletionWorkspaceFixture(
  options: TargetTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<AcceptedDemandCompletionWorkspaceFixture>> {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture(options);
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
