import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseTaskPackage,
  TaskPackageError,
  type TestTaskPackage,
} from "../tasking/task-package.js";
import {
  assertDeliveryEnvelopeMatchesTaskPackage,
  DeliveryEnvelopeError,
  parseDeliveryEnvelope,
  type DeliveryEnvelope,
} from "../delivery/delivery-envelope.js";
import {
  parseTestCard,
  TestCardError,
  type TestCard,
} from "../testing/test-card.js";
import {
  assertTestExecutionAttemptMatchesCard,
  TestExecutionAttemptError,
} from "../testing/test-execution-attempt.js";
import {
  assertTestTaskPackageMatchesTestCard,
  TestTaskPackageError,
} from "../testing/test-task-package.js";
import {
  parseTestTargetResultReport,
  TestTargetResultReportError,
  type TestTargetResultReport,
} from "./test-target-result-report.js";
import { assertDeliveryBindingFollowsEnvelope } from "./implementation-target-result.js";
import {
  parseTargetResult,
  TargetResultError,
  targetResultIdForClaim,
  type TargetResultBasis,
  type TargetResultDeliveryBinding,
  type TestTargetResult,
} from "./target-result.js";

/**
 * Test 任务包、测试卡、逻辑尝试、投递信封与宿主效果处置的 Result 来源闭合。
 *
 * 本模块只证明 Report 属于当前批准步骤与精确的 Test 投递谱系；Evidence 内容真假和
 * 测试是否满足需求仍由 Controller 独立审查。
 */

export interface CreateTestTargetResultInput {
  readonly taskPackage: Readonly<TestTaskPackage>;
  readonly testCard: Readonly<TestCard>;
  readonly envelope: Readonly<DeliveryEnvelope>;
  readonly delivery: Readonly<TargetResultDeliveryBinding>;
  readonly report: Readonly<TestTargetResultReport>;
}

export type TestTargetResultErrorReason =
  | "task-package"
  | "test-card"
  | "envelope"
  | "delivery"
  | "report"
  | "relation";

const ERROR_MESSAGES = {
  "task-package": "Test Target Result requires a valid Test TaskPackage.",
  "test-card": "Test Target Result requires a valid TestCard.",
  envelope: "Test Target Result requires a valid test Delivery Envelope.",
  delivery:
    "Test Target Result requires an accepted or indeterminate delivery generation.",
  report: "Test Target Result requires a valid Test Report.",
  relation: "Test Target Result sources are inconsistent.",
} as const satisfies Readonly<Record<TestTargetResultErrorReason, string>>;

/** Test Result来源闭合失败时的稳定错误。 */
export class TestTargetResultError extends Error {
  override readonly name = "TestTargetResultError";
  readonly code = "wakeflow-test-target-result" as const;
  readonly reason: TestTargetResultErrorReason;

  constructor(reason: TestTargetResultErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: TestTargetResultErrorReason): never {
  throw new TestTargetResultError(reason);
}

function assertReportMatchesApprovedPlan(
  report: Readonly<TestTargetResultReport>,
  testCard: Readonly<TestCard>,
): void {
  const mappings = report.stepEvidence;
  if (
    mappings.some(
      (entry) =>
        entry.planIndex >= testCard.approvedPlan.length ||
        entry.step !== testCard.approvedPlan[entry.planIndex],
    ) ||
    (report.outcome === "completed" &&
      (mappings.length !== testCard.approvedPlan.length ||
        testCard.approvedPlan.some(
          (_step, index) => mappings[index]?.planIndex !== index,
        )))
  ) {
    fail("relation");
  }
}

export function createTestTargetResult(
  input: Readonly<CreateTestTargetResultInput>,
): Readonly<TestTargetResult> {
  let taskPackage;
  let testCard;
  let envelope;
  let report;
  try {
    taskPackage = parseTaskPackage(input.taskPackage);
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) fail("task-package");
    throw error;
  }
  if (taskPackage.workType !== "test") fail("task-package");
  try {
    testCard = parseTestCard(input.testCard);
  } catch (error: unknown) {
    if (error instanceof TestCardError) fail("test-card");
    throw error;
  }
  try {
    assertTestTaskPackageMatchesTestCard(taskPackage, testCard);
  } catch (error: unknown) {
    if (error instanceof TestTaskPackageError) fail("task-package");
    throw error;
  }
  try {
    envelope = parseDeliveryEnvelope(input.envelope);
    assertDeliveryEnvelopeMatchesTaskPackage(envelope, taskPackage);
  } catch (error: unknown) {
    if (error instanceof DeliveryEnvelopeError) fail("envelope");
    throw error;
  }
  if (envelope.workType !== "test") fail("envelope");
  try {
    assertTestExecutionAttemptMatchesCard(envelope.attempt, testCard);
  } catch (error: unknown) {
    if (error instanceof TestExecutionAttemptError) fail("envelope");
    throw error;
  }
  try {
    report = parseTestTargetResultReport(input.report);
  } catch (error: unknown) {
    if (error instanceof TestTargetResultReportError) fail("report");
    throw error;
  }
  try {
    assertDeliveryBindingFollowsEnvelope(envelope, input.delivery);
  } catch {
    fail("delivery");
  }
  assertReportMatchesApprovedPlan(report, testCard);
  const basis = {
    kind: "WakeflowTargetResult" as const,
    schemaVersion: 1 as const,
    workType: "test" as const,
    targetResultId: targetResultIdForClaim(input.delivery.fence.claimId),
    programId: taskPackage.programId,
    demandId: taskPackage.demandId,
    targetTaskId: taskPackage.targetTaskId,
    deliveryId: envelope.deliveryId,
    taskPackage: Object.freeze({
      taskPackageId: taskPackage.taskPackageId,
      ref: envelope.target.taskPackageRef,
      digest: envelope.target.taskPackageDigest,
    }),
    assignment: taskPackage.assignment,
    delivery: Object.freeze({
      generation: input.delivery.generation,
      fence: Object.freeze({
        claimId: input.delivery.fence.claimId,
        claimDigest: input.delivery.fence.claimDigest,
      }),
      outcomeDigest: input.delivery.outcomeDigest,
      disposition: input.delivery.disposition,
      readbackStatus: input.delivery.readbackStatus,
      observedAt: input.delivery.observedAt,
    }),
    testExecution: Object.freeze({
      testAttemptId: envelope.attempt.testAttemptId,
      testCard: envelope.attempt.testCard,
    }),
    report,
  } satisfies Readonly<TargetResultBasis>;
  let result;
  try {
    result = parseTargetResult({
      ...basis,
      resultDigest: computeCanonicalJsonSha256Digest(basis),
    });
  } catch (error: unknown) {
    if (error instanceof TargetResultError) fail("relation");
    throw error;
  }
  if (result.workType !== "test") fail("relation");
  return result;
}
