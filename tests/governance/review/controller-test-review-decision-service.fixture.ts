import type {
  TargetResultImportResult,
  TargetResultReviewInspectionResult,
  TestReviewDecisionRequest,
  TestReviewDecisionResult,
} from "../../../src/capabilities/result-review/contract.js";
import {
  executeTargetResultImportRequest,
  executeTestReviewDecisionRequest,
  type ExecuteResultReviewOptions,
} from "../../../src/capabilities/result-review/service.js";
import { parseUtcInstant, type UtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DISPOSABLE_WORKSPACE_DURABILITY } from "../../support/prepared-workspace.js";
import type { DeliveryEnvelope } from "../../../src/governance/delivery/delivery-envelope.js";
import type { DeliveredTarget } from "../delivery/delivery-workspace.fixture.js";
import {
  cleanupTestDeliveryWorkspaceFixture,
  createTestDeliveryWorkspaceFixture,
  deliverFixtureTestTarget,
  type TestDeliveryWorkspaceFixture,
} from "../delivery/test-delivery-workspace.fixture.js";
import type { TestTaskPlanningWorkspaceFixtureOptions } from "../tasking/test-task-planning.fixture.js";
import {
  CODEX_REVIEW_FACADE,
  currentFixtureStreamRevision,
  inspectFixtureReview,
  landFixtureTargetCompletion,
  type FixtureEvidence,
} from "./controller-implementation-review-decision-service.fixture.js";

/**
 * 测试链的评审夹具：测试投递 accepted → 经切片导入逐步记录（证据沿用实现链记录的受管证据）
 * → 测试会话 Stop 记录 → 检查投影 → 一份可直接提交的 accept 决定请求。
 */

export const TEST_RESULT_REPORTED_AT = parseUtcInstant("2026-08-29T12:34:00.000Z");
export const TEST_TARGET_STOPPED_AT = parseUtcInstant("2026-08-29T12:35:00.000Z");
export const TEST_REVIEW_INSPECTED_AT = parseUtcInstant("2026-08-29T12:36:00.000Z");
export const TEST_REVIEW_DECIDED_AT = parseUtcInstant("2026-08-29T12:37:00.000Z");
export const TEST_REVIEW_DECISION_UUID = "e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5";

export type TestStepFailureContent = Readonly<{
  readonly classification:
    | "product-defect"
    | "harness-defect"
    | "environment"
    | "flaky"
    | "missing-evidence"
    | "out-of-scope"
    | "needs-decision";
  readonly likelyOwner: "implementation" | "test" | "environment" | "user";
  readonly recommendedAction: string;
}>;

export type TestStepContent = Readonly<{
  readonly stepId: string;
  readonly observed: string;
  readonly evidence: Readonly<{ readonly ref: string; readonly digest: string }>;
  readonly verdict: "pass" | "fail" | "blocked" | "cannot-conclude";
  readonly failure?: TestStepFailureContent;
}>;

export interface ControllerTestReviewDecisionServiceFixture extends TestDeliveryWorkspaceFixture {
  readonly testDelivered: Readonly<DeliveredTarget>;
  readonly testEnvelope: Readonly<DeliveryEnvelope>;
  readonly testAttemptId: string;
  readonly testImported: Readonly<TargetResultImportResult>;
  readonly testInspection: Readonly<TargetResultReviewInspectionResult>;
  readonly testDecisionRequest: Readonly<TestReviewDecisionRequest>;
}

/** 一步通过的记录；失败步骤由调用方改写 verdict 与 failure。 */
export function passingStep(stepId: string, evidence: Readonly<FixtureEvidence>): TestStepContent {
  return Object.freeze({
    stepId,
    observed: `${stepId} 按合同 then 表现一致。`,
    evidence: Object.freeze({ ref: evidence.ref, digest: evidence.digest }),
    verdict: "pass" as const,
  });
}

export function failingStep(
  stepId: string,
  evidence: Readonly<FixtureEvidence>,
  classification: TestStepFailureContent["classification"],
  verdict: "fail" | "blocked" | "cannot-conclude" = "fail",
): TestStepContent {
  const owner: TestStepFailureContent["likelyOwner"] =
    classification === "product-defect"
      ? "implementation"
      : classification === "environment"
        ? "environment"
        : classification === "needs-decision" || classification === "out-of-scope"
          ? "user"
          : "test";
  return Object.freeze({
    stepId,
    observed: `${stepId} 观察到与合同 then 不一致的行为。`,
    evidence: Object.freeze({ ref: evidence.ref, digest: evidence.digest }),
    verdict,
    failure: Object.freeze({
      classification,
      likelyOwner: owner,
      recommendedAction: `按 ${classification} 处理 ${stepId}。`,
    }),
  });
}

export function testResultReportContent(
  steps: readonly TestStepContent[],
  evidence: Readonly<FixtureEvidence>,
  outcome: "completed" | "blocked" | "needs-review" = "completed",
) {
  return {
    outcome,
    summary: "已执行测试合同范围内的步骤并返回逐步记录。",
    evidenceLocators: [{ kind: "test-output", ref: evidence.ref, digest: evidence.digest }],
    verification: ["逐项复验 Evidence ref 与 digest。"],
    risks: ["结果仍需 Controller 独立审查。"],
    steps: steps.map((step) => ({ ...step })),
  };
}

export interface ImportFixtureTestOptions {
  readonly idempotencyKey?: string;
  readonly expectedStreamRevision?: number;
  readonly reportedAt?: UtcInstant;
  readonly steps?: readonly TestStepContent[];
  readonly outcome?: "completed" | "blocked" | "needs-review";
}

/** 经切片导入测试结果：逐步记录按测试合同的 stepId 生成，缺省全部 pass。 */
export async function importFixtureTestResult(
  fixture: Readonly<TestDeliveryWorkspaceFixture>,
  delivered: Readonly<DeliveredTarget>,
  options: ImportFixtureTestOptions = {},
): Promise<Readonly<TargetResultImportResult>> {
  const steps =
    options.steps ?? fixture.testStepIds.map((stepId) => passingStep(stepId, fixture.evidence));
  return executeTargetResultImportRequest(
    CODEX_REVIEW_FACADE,
    {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey: options.idempotencyKey ?? "fixture-test-import-1",
      expectedStreamRevision:
        options.expectedStreamRevision ?? (await currentFixtureStreamRevision(fixture)),
      deliveryId: delivered.prepared.delivery.deliveryId,
      claimDigest: delivered.prepared.permit.fence.claimDigest,
      report: {
        workType: "test",
        content: testResultReportContent(steps, fixture.evidence, options.outcome),
      },
    },
    {
      clock: () => options.reportedAt ?? TEST_RESULT_REPORTED_AT,
      durability: DISPOSABLE_WORKSPACE_DURABILITY,
    },
  );
}

/** 测试决定请求：accept 判断；调用方按需覆盖决定、范围与升级。 */
export function fixtureTestDecisionRequest(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
  inspection: Readonly<TargetResultReviewInspectionResult>,
  expectedStreamRevision: number,
  idempotencyKey = "fixture-test-decision-1",
): Readonly<TestReviewDecisionRequest> {
  return {
    root: fixture.workspacePath,
    demandId: fixture.demandId,
    idempotencyKey,
    expectedStreamRevision,
    targetResultId: inspection.reviewUnit.targetResult.targetResultId,
    snapshotDigest: inspection.snapshotDigest,
    reviewUnitDigest: inspection.reviewUnit.reviewUnitDigest,
    decision: "accept" as const,
    assessment: Object.freeze({
      conclusion: "satisfied" as const,
      evidenceSufficiency: "sufficient" as const,
    }),
    independentChecks: [
      {
        checkId: "controller-test-evidence",
        method: "重新读取逐步Evidence并复验冻结Test问题。",
        outcome: "passed" as const,
        observation: "全部合同步骤的Evidence闭合且未观察到产品缺陷。",
      },
    ],
    rationale: "Controller独立检查已关闭当前真实环境风险。",
    blockingReasons: [],
    residualRisks: ["该决定不替代后续Demand completion检查。"],
  };
}

export async function decideFixtureTest(
  fixture: Readonly<ControllerTestReviewDecisionServiceFixture>,
  overrides: Partial<TestReviewDecisionRequest> = {},
  options: ExecuteResultReviewOptions = {
    clock: () => TEST_REVIEW_DECIDED_AT,
    uuidFactory: () => TEST_REVIEW_DECISION_UUID,
  },
): Promise<Readonly<TestReviewDecisionResult>> {
  return executeTestReviewDecisionRequest(
    CODEX_REVIEW_FACADE,
    { ...fixture.testDecisionRequest, ...overrides },
    { durability: DISPOSABLE_WORKSPACE_DURABILITY, ...options },
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
    await landFixtureTargetCompletion(fixture, fixture.testRoute, TEST_TARGET_STOPPED_AT);
    const testInspection = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
      clock: () => TEST_REVIEW_INSPECTED_AT,
    });
    return Object.freeze({
      ...fixture,
      testDelivered,
      testEnvelope: testDelivered.envelope,
      testAttemptId,
      testImported,
      testInspection,
      testDecisionRequest: fixtureTestDecisionRequest(
        fixture,
        testInspection,
        testImported.event.streamRevision,
      ),
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
