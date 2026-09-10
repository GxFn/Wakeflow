import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import type { DeliveryEnvelope } from "../../../src/governance/delivery/delivery-envelope.js";
import {
  TargetResultImportService,
  type TargetResultImportResult,
} from "../../../src/governance/result/target-result-import-service.js";
import {
  readDemandResultReviewSnapshot,
  type DemandResultReviewSnapshot,
} from "../../../src/governance/review/demand-result-review-snapshot.js";
import {
  parseControllerTestReviewDecisionRequest,
  type ControllerTestReviewDecisionRequest,
} from "../../../src/governance/review/controller-test-review-decision-input.js";
import {
  withFixtureDemandRoot,
  type DeliveredTarget,
} from "../delivery/delivery-workspace.fixture.js";
import {
  cleanupTestDeliveryWorkspaceFixture,
  createTestDeliveryWorkspaceFixture,
  deliverFixtureTestTarget,
  type TestDeliveryWorkspaceFixture,
} from "../delivery/test-delivery-workspace.fixture.js";
import type { TestTaskPlanningWorkspaceFixtureOptions } from "../tasking/test-task-planning.fixture.js";

export const TEST_RESULT_REPORTED_AT = parseUtcInstant("2026-08-29T12:34:00.000Z");

export interface ControllerTestReviewDecisionServiceFixture extends TestDeliveryWorkspaceFixture {
  readonly testDelivered: Readonly<DeliveredTarget>;
  readonly testEnvelope: Readonly<DeliveryEnvelope>;
  readonly testAttemptId: string;
  readonly testImported: Readonly<TargetResultImportResult>;
  readonly reviewSnapshot: Readonly<DemandResultReviewSnapshot>;
  readonly testDecisionRequest: Readonly<ControllerTestReviewDecisionRequest>;
}

export function testResultReportContent(stepIds: readonly string[]) {
  const evidenceLocators = stepIds.map((stepId, index) =>
    Object.freeze({
      kind: "test-step-report" as const,
      ref: `evidence/test-runs/${stepId}.json`,
      digest: `sha256:${String(index + 1).repeat(64)}`,
    }),
  );
  return {
    outcome: "completed" as const,
    summary: "已执行测试合同的全部步骤并返回逐步事实。",
    evidenceLocators,
    verification: ["逐项复验Evidence ref与digest。"],
    risks: ["Result仍需Controller独立审查。"],
    stepEvidence: stepIds.map((stepId, index) => ({
      stepId,
      evidence: {
        ref: evidenceLocators[index]!.ref,
        digest: evidenceLocators[index]!.digest,
      },
    })),
  };
}

/** 导入测试结果：逐步证据按测试合同的 stepId 生成。 */
export async function importFixtureTestResult(
  fixture: Readonly<TestDeliveryWorkspaceFixture>,
  delivered: Readonly<DeliveredTarget>,
  reportedAt = TEST_RESULT_REPORTED_AT,
): Promise<Readonly<TargetResultImportResult>> {
  return new TargetResultImportService(fixture.workspaceRoot, "codex").import(
    {
      demandId: fixture.demandId,
      deliveryId: delivered.prepared.delivery.deliveryId,
      claimDigest: delivered.prepared.permit.fence.claimDigest,
      report: { workType: "test", content: testResultReportContent(fixture.testStepIds) },
    },
    { clock: () => reportedAt },
  );
}

export async function createControllerTestReviewDecisionServiceFixture(
  options: TestTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<ControllerTestReviewDecisionServiceFixture>> {
  const fixture = await createTestDeliveryWorkspaceFixture(options);
  try {
    const testDelivered = await deliverFixtureTestTarget(fixture);
    if (testDelivered.envelope.workType !== "test") {
      throw new Error("Expected a Test delivery envelope fixture.");
    }
    const testAttemptId = testDelivered.envelope.attempt.testAttemptId;
    const testImported = await importFixtureTestResult(fixture, testDelivered);
    const reviewSnapshot = await withFixtureDemandRoot(fixture, readDemandResultReviewSnapshot);
    const target = reviewSnapshot.targets.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    if (target?.status !== "reported" || target.targetResult.workType !== "test") {
      throw new Error("Expected reported Test review target fixture.");
    }
    const testDecisionRequest = parseControllerTestReviewDecisionRequest({
      demandId: fixture.demandId,
      targetResultId: target.targetResult.targetResultId,
      snapshotDigest: reviewSnapshot.snapshotDigest,
      reviewUnitDigest: target.reviewUnitDigest,
      decision: "accept" as const,
      assessment: Object.freeze({
        conclusion: "satisfied" as const,
        evidenceSufficiency: "sufficient" as const,
      }),
      independentChecks: Object.freeze([
        Object.freeze({
          checkId: "controller-test-evidence",
          method: "重新读取逐步Evidence并复验冻结Test问题。",
          outcome: "passed" as const,
          observation: "全部批准步骤的Evidence闭合且未观察到产品缺陷。",
        }),
      ] as const),
      rationale: "Controller独立检查已关闭当前真实环境风险。",
      blockingReasons: Object.freeze([]),
      residualRisks: Object.freeze(["该决定不替代后续Demand completion检查。"]),
    });
    return Object.freeze({
      ...fixture,
      testDelivered,
      testEnvelope: testDelivered.envelope,
      testAttemptId,
      testImported,
      reviewSnapshot,
      testDecisionRequest,
    });
  } catch (error: unknown) {
    await cleanupTestDeliveryWorkspaceFixture(fixture);
    throw error;
  }
}

export async function cleanupControllerTestReviewDecisionServiceFixture(
  fixture: Readonly<ControllerTestReviewDecisionServiceFixture>,
): Promise<void> {
  await cleanupTestDeliveryWorkspaceFixture(fixture);
}
