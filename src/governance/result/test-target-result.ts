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
  assertTestExecutionAttemptMatchesPackage,
  TestExecutionAttemptError,
} from "../testing/test-execution-attempt.js";
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
 * Test 任务包（含测试合同）、逻辑尝试、投递信封与宿主效果处置的 Result 来源闭合。
 *
 * 本模块只证明 Report 逐步对应测试合同并属于精确的 Test 投递谱系；Evidence 内容真假和
 * 测试是否满足需求仍由 Controller 独立审查。
 */

export interface CreateTestTargetResultInput {
  readonly taskPackage: Readonly<TestTaskPackage>;
  readonly envelope: Readonly<DeliveryEnvelope>;
  readonly delivery: Readonly<TargetResultDeliveryBinding>;
  readonly report: Readonly<TestTargetResultReport>;
}

export type TestTargetResultErrorReason =
  | "task-package"
  | "envelope"
  | "delivery"
  | "report"
  | "relation";

const ERROR_MESSAGES = {
  "task-package": "Test Target Result requires a valid Test TaskPackage.",
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

/**
 * Report 的每一步都属于合同并落在本次尝试的范围内（重跑可只跑失败子集）；
 * `completed` 必须覆盖范围内的每个 stepId 恰一次。
 */
function assertReportMatchesContract(
  report: Readonly<TestTargetResultReport>,
  taskPackage: Readonly<TestTaskPackage>,
  scope: readonly string[] | null,
): void {
  const contractIds = new Set(taskPackage.testContract.steps.map((step) => step.stepId));
  if (scope?.some((stepId) => !contractIds.has(stepId))) fail("envelope");
  const scopedIds = scope === null ? contractIds : new Set(scope);
  const seen = new Set<string>();
  for (const step of report.steps) {
    if (!scopedIds.has(step.stepId) || seen.has(step.stepId)) fail("relation");
    seen.add(step.stepId);
  }
  if (report.outcome === "completed" && seen.size !== scopedIds.size) {
    fail("relation");
  }
}

export function createTestTargetResult(
  input: Readonly<CreateTestTargetResultInput>,
): Readonly<TestTargetResult> {
  let taskPackage;
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
    envelope = parseDeliveryEnvelope(input.envelope);
    assertDeliveryEnvelopeMatchesTaskPackage(envelope, taskPackage);
  } catch (error: unknown) {
    if (error instanceof DeliveryEnvelopeError) fail("envelope");
    throw error;
  }
  if (envelope.workType !== "test") fail("envelope");
  try {
    assertTestExecutionAttemptMatchesPackage(envelope.attempt, taskPackage);
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
  const attempt = envelope.attempt;
  const stepIds = attempt.mode === "rerun" ? attempt.rerunSource.stepIds : null;
  assertReportMatchesContract(report, taskPackage, stepIds);
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
      testAttemptId: attempt.testAttemptId,
      ordinal: attempt.ordinal,
      stepIds,
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
