import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeTaskPackageDigest,
  parseTaskPackage,
  TaskPackageError,
  type TestTaskPackage,
} from "../tasking/task-package.js";
import {
  parseTargetDeliveryHostEffectObservation,
  targetDeliveryHostEffectDisposition,
  targetDeliveryHostEffectObservationEventId,
  TargetDeliveryHostEffectObservationError,
  type TargetDeliveryHostEffectObservation,
} from "../delivery/target-delivery-host-effect-observation.js";
import {
  parseWindowWorkClaim,
  WindowWorkClaimError,
  type WindowWorkClaim,
} from "../delivery/window-work-claim.js";
import {
  parseTestCard,
  TestCardError,
  type TestCard,
} from "../testing/test-card.js";
import {
  assertTestDeliveryIntentMatchesSources,
  parseTestDeliveryIntent,
  TestDeliveryIntentError,
  type TestDeliveryIntent,
} from "../testing/test-delivery-intent.js";
import {
  assertTestDispatchPacketMatchesSources,
  parseTestDispatchPacket,
  TestDispatchPacketError,
  type TestDispatchPacket,
} from "../testing/test-dispatch-packet.js";
import {
  assertTestTaskPackageMatchesTestCard,
  TestTaskPackageError,
} from "../testing/test-task-package.js";
import {
  parseTestTargetResultReport,
  TestTargetResultReportError,
  type TestTargetResultReport,
} from "./test-target-result-report.js";
import {
  parseTargetResult,
  TargetResultError,
  targetResultIdForAction,
  type TargetResultBasis,
  type TestTargetResult,
} from "./target-result.js";

/**
 * Test TaskPackage、Card、attempt、packet与宿主效果的Result来源闭合。
 *
 * 本模块只证明Report属于当前批准步骤与exact Test delivery lineage；Evidence内容真假和
 * 测试是否满足需求仍由Controller独立审查。
 */

export interface CreateTestTargetResultInput {
  readonly taskPackage: Readonly<TestTaskPackage>;
  readonly testCard: Readonly<TestCard>;
  readonly intent: Readonly<TestDeliveryIntent>;
  readonly packet: Readonly<TestDispatchPacket>;
  readonly claim: Readonly<WindowWorkClaim>;
  readonly observation: Readonly<TargetDeliveryHostEffectObservation>;
  readonly report: Readonly<TestTargetResultReport>;
}

export type TestTargetResultErrorReason =
  | "task-package"
  | "test-card"
  | "intent"
  | "packet"
  | "claim"
  | "observation"
  | "report"
  | "relation";

const ERROR_MESSAGES = {
  "task-package": "Test Target Result requires a valid Test TaskPackage.",
  "test-card": "Test Target Result requires a valid TestCard.",
  intent: "Test Target Result requires a valid TestDeliveryIntent.",
  packet: "Test Target Result requires a valid TestDispatchPacket.",
  claim: "Test Target Result requires a valid Test WindowWorkClaim.",
  observation:
    "Test Target Result requires a valid Test Host Effect Observation.",
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
  let intent;
  let packet;
  let claim;
  let observation;
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
    intent = parseTestDeliveryIntent(input.intent);
    assertTestDeliveryIntentMatchesSources(intent, taskPackage, testCard);
  } catch (error: unknown) {
    if (error instanceof TestDeliveryIntentError) fail("intent");
    throw error;
  }
  try {
    packet = parseTestDispatchPacket(input.packet);
    assertTestDispatchPacketMatchesSources(
      packet,
      intent,
      taskPackage,
      testCard,
      {
        eventId: packet.source.eventId,
        eventDigest: packet.source.eventDigest,
        streamRevision: packet.source.streamRevision,
      },
    );
  } catch (error: unknown) {
    if (error instanceof TestDispatchPacketError) fail("packet");
    throw error;
  }
  try {
    claim = parseWindowWorkClaim(input.claim);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) fail("claim");
    throw error;
  }
  try {
    observation = parseTargetDeliveryHostEffectObservation(input.observation);
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryHostEffectObservationError) {
      fail("observation");
    }
    throw error;
  }
  try {
    report = parseTestTargetResultReport(input.report);
  } catch (error: unknown) {
    if (error instanceof TestTargetResultReportError) fail("report");
    throw error;
  }
  const disposition = targetDeliveryHostEffectDisposition(observation);
  if (
    disposition === "rejected-before-effect" ||
    taskPackage.programId !== intent.programId ||
    taskPackage.demandId !== intent.demandId ||
    taskPackage.targetTaskId !== intent.target.targetTaskId ||
    computeTaskPackageDigest(taskPackage) !== intent.target.taskPackageDigest ||
    taskPackage.taskPackageId !== intent.target.taskPackageId ||
    !("workType" in claim.target) ||
    claim.target.workType !== "test" ||
    claim.programId !== taskPackage.programId ||
    claim.target.demandId !== intent.demandId ||
    claim.target.targetTaskId !== taskPackage.targetTaskId ||
    claim.target.targetDeliveryId !== intent.targetDeliveryId ||
    claim.target.intentDigest !== intent.intentDigest ||
    claim.target.intentPreparedAt !== intent.preparedAt ||
    claim.target.testAttemptId !== intent.attempt.testAttemptId ||
    claim.target.testDispatchPacketDigest !== packet.packetDigest ||
    claim.route.hostId !== intent.route.hostId ||
    claim.route.windowId !== taskPackage.assignment.windowId ||
    claim.route.windowId !== intent.route.windowId ||
    claim.route.bindingId !== intent.route.bindingId ||
    !("workType" in observation.action) ||
    observation.action.workType !== "test" ||
    claim.claimId !== observation.action.actionId ||
    claim.claimDigest !== observation.action.claimDigest ||
    claim.claimTransition.eventId !== observation.action.claimEventId ||
    claim.claimTransition.commitId !== observation.action.claimCommitId ||
    observation.action.targetDeliveryId !== intent.targetDeliveryId ||
    observation.action.intentDigest !== intent.intentDigest ||
    observation.action.hostId !== intent.route.hostId ||
    observation.action.windowId !== intent.route.windowId ||
    observation.action.bindingId !== intent.route.bindingId ||
    observation.action.claimEventStreamRevision !==
      claim.claimTransition.expectedStreamRevision + 1 ||
    observation.action.claimExpectedStateDigest !==
      claim.claimTransition.expectedStateDigest ||
    observation.action.hostObservationAuthorityDigest !==
      claim.hostObservation.authorityDigest ||
    observation.action.issuedAt !== claim.claimedAt ||
    observation.action.testAttemptId !== intent.attempt.testAttemptId ||
    observation.action.testDispatchPacketDigest !== packet.packetDigest ||
    packet.attempt.testAttemptId !== intent.attempt.testAttemptId
  ) {
    fail("relation");
  }
  assertReportMatchesApprovedPlan(report, testCard);
  const basis = {
    kind: "WakeflowTargetResult" as const,
    schemaVersion: 1 as const,
    workType: "test" as const,
    targetResultId: targetResultIdForAction(claim.claimId),
    programId: taskPackage.programId,
    demandId: taskPackage.demandId,
    targetTaskId: taskPackage.targetTaskId,
    targetDeliveryId: intent.targetDeliveryId,
    taskPackage: Object.freeze({
      taskPackageId: taskPackage.taskPackageId,
      ref: intent.target.taskPackageRef,
      digest: intent.target.taskPackageDigest,
    }),
    assignment: taskPackage.assignment,
    hostEffect: Object.freeze({
      actionId: claim.claimId,
      claimDigest: claim.claimDigest,
      claimEventId: claim.claimTransition.eventId,
      claimCommitId: claim.claimTransition.commitId,
      observationDigest: observation.observationDigest,
      disposition,
      readbackStatus: observation.readback.status,
      observedEventId: targetDeliveryHostEffectObservationEventId(
        claim.claimId,
      ),
      observedAt: observation.observedAt,
    }),
    testExecution: Object.freeze({
      testAttemptId: intent.attempt.testAttemptId,
      testCard: intent.attempt.testCard,
      testDispatchPacketDigest: packet.packetDigest,
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
