import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseTaskPackage,
  TaskPackageError,
  type ImplementationTaskPackage,
} from "../tasking/task-package.js";
import {
  assertDeliveryEnvelopeMatchesTaskPackage,
  DeliveryEnvelopeError,
  parseDeliveryEnvelope,
  type DeliveryEnvelope,
} from "../delivery/delivery-envelope.js";
import {
  parseImplementationTargetResultReport,
  ImplementationTargetResultReportError,
  type ImplementationTargetResultReport,
} from "./implementation-target-result-report.js";
import {
  parseTargetResult,
  TargetResultError,
  targetResultIdForClaim,
  type ImplementationTargetResult,
  type TargetResultBasis,
  type TargetResultDeliveryBinding,
} from "./target-result.js";

/**
 * 单仓库 implementation 来源闭合并创建 authority-enriched TargetResult。
 *
 * 本模块只解释 implementation 任务包、投递信封与仓库策略；共享 Result 解析、
 * typed 身份与确定性摘要仍由 `target-result` 拥有。投递代际与围栏来自聚合的当前投递。
 */

export interface CreateImplementationTargetResultInput {
  readonly taskPackage: Readonly<ImplementationTaskPackage>;
  readonly envelope: Readonly<DeliveryEnvelope>;
  readonly delivery: Readonly<TargetResultDeliveryBinding>;
  readonly report: Readonly<ImplementationTargetResultReport>;
}

export type ImplementationTargetResultErrorReason =
  "task-package" | "envelope" | "delivery" | "report" | "relation";

const ERROR_MESSAGES = {
  "task-package":
    "Implementation Target Result requires a valid implementation TaskPackage.",
  envelope: "Implementation Target Result requires a valid Delivery Envelope.",
  delivery:
    "Implementation Target Result requires an accepted or indeterminate delivery generation.",
  report:
    "Implementation Target Result requires a valid implementation Report.",
  relation: "Implementation Target Result sources are inconsistent.",
} as const satisfies Readonly<
  Record<ImplementationTargetResultErrorReason, string>
>;

/** implementation来源闭合失败时的稳定错误。 */
export class ImplementationTargetResultError extends Error {
  override readonly name = "ImplementationTargetResultError";
  readonly code = "wakeflow-implementation-target-result" as const;
  readonly reason: ImplementationTargetResultErrorReason;

  constructor(reason: ImplementationTargetResultErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: ImplementationTargetResultErrorReason): never {
  throw new ImplementationTargetResultError(reason);
}

function assertReportMatchesTaskPackage(
  report: Readonly<ImplementationTargetResultReport>,
  taskPackage: Readonly<ImplementationTaskPackage>,
): void {
  if (
    report.repositoryChange.repositoryId !== taskPackage.assignment.repositoryId
  ) {
    fail("relation");
  }
  const expectedAnchors = taskPackage.acceptanceAnchors.map(
    (anchor) => anchor.anchorId,
  );
  const actualAnchors = report.anchorEvidence.map((entry) => entry.anchorId);
  if (
    actualAnchors.some((anchorId) => !expectedAnchors.includes(anchorId)) ||
    (report.outcome === "completed" &&
      (actualAnchors.length !== expectedAnchors.length ||
        expectedAnchors.some(
          (anchorId) => !actualAnchors.includes(anchorId),
        ))) ||
    (report.outcome === "completed" &&
      taskPackage.commitExpectation === "commit" &&
      report.repositoryChange.disposition !== "committed") ||
    (report.outcome === "completed" &&
      taskPackage.commitExpectation === "leave-uncommitted" &&
      report.repositoryChange.disposition === "committed")
  ) {
    fail("relation");
  }
}

/**
 * 只有 accepted 或 indeterminate 的投递代际能产生 Result；初代际的围栏必须就是信封里的围栏，
 * 后续代际的围栏由 rearm 事件与聚合转换证明。
 */
export function assertDeliveryBindingFollowsEnvelope(
  envelope: Readonly<DeliveryEnvelope>,
  delivery: Readonly<TargetResultDeliveryBinding>,
): void {
  const disposition: string = delivery.disposition;
  if (
    (disposition !== "accepted" && disposition !== "indeterminate") ||
    !Number.isSafeInteger(delivery.generation) ||
    delivery.generation < 1 ||
    (delivery.generation === 1 &&
      (delivery.fence.claimId !== envelope.fence.claimId ||
        delivery.fence.claimDigest !== envelope.fence.claimDigest))
  ) {
    fail("delivery");
  }
}

export function createImplementationTargetResult(
  input: Readonly<CreateImplementationTargetResultInput>,
): Readonly<ImplementationTargetResult> {
  let taskPackage;
  let envelope;
  let report;
  try {
    taskPackage = parseTaskPackage(input.taskPackage);
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) fail("task-package");
    throw error;
  }
  if (taskPackage.workType !== "implementation") fail("task-package");
  try {
    envelope = parseDeliveryEnvelope(input.envelope);
    assertDeliveryEnvelopeMatchesTaskPackage(envelope, taskPackage);
  } catch (error: unknown) {
    if (error instanceof DeliveryEnvelopeError) fail("envelope");
    throw error;
  }
  if (envelope.workType !== "implementation") fail("envelope");
  try {
    report = parseImplementationTargetResultReport(input.report);
  } catch (error: unknown) {
    if (error instanceof ImplementationTargetResultReportError) fail("report");
    throw error;
  }
  assertDeliveryBindingFollowsEnvelope(envelope, input.delivery);
  assertReportMatchesTaskPackage(report, taskPackage);
  const basis = {
    kind: "WakeflowTargetResult" as const,
    schemaVersion: 1 as const,
    workType: "implementation" as const,
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
  if (result.workType !== "implementation") fail("relation");
  return result;
}
