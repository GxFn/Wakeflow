import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeTaskPackageDigest,
  parseTaskPackage,
  TaskPackageError,
  type ImplementationTaskPackage,
} from "../tasking/task-package.js";
import {
  parseTargetDeliveryIntent,
  TargetDeliveryIntentError,
  type TargetDeliveryIntent,
} from "../delivery/target-delivery-intent.js";
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
  parseImplementationTargetResultReport,
  ImplementationTargetResultReportError,
  type ImplementationTargetResultReport,
} from "./implementation-target-result-report.js";
import {
  parseTargetResult,
  TargetResultError,
  targetResultIdForAction,
  type ImplementationTargetResult,
  type TargetResultBasis,
} from "./target-result.js";

/**
 * 单仓库implementation来源闭合并创建authority-enriched TargetResult。
 *
 * 本模块只解释implementation TaskPackage、Intent和repository policy；共享Result解析、
 * typed身份与确定性摘要仍由`target-result`拥有。
 */

export interface CreateImplementationTargetResultInput {
  readonly taskPackage: Readonly<ImplementationTaskPackage>;
  readonly intent: Readonly<TargetDeliveryIntent>;
  readonly claim: Readonly<WindowWorkClaim>;
  readonly observation: Readonly<TargetDeliveryHostEffectObservation>;
  readonly report: Readonly<ImplementationTargetResultReport>;
}

export type ImplementationTargetResultErrorReason =
  "task-package" | "intent" | "claim" | "observation" | "report" | "relation";

const ERROR_MESSAGES = {
  "task-package":
    "Implementation Target Result requires a valid implementation TaskPackage.",
  intent: "Implementation Target Result requires a valid TargetDeliveryIntent.",
  claim:
    "Implementation Target Result requires a valid implementation WindowWorkClaim.",
  observation:
    "Implementation Target Result requires a valid implementation Host Effect Observation.",
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

export function createImplementationTargetResult(
  input: Readonly<CreateImplementationTargetResultInput>,
): Readonly<ImplementationTargetResult> {
  let taskPackage;
  let intent;
  let claim;
  let observation;
  let report;
  try {
    taskPackage = parseTaskPackage(input.taskPackage);
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) fail("task-package");
    throw error;
  }
  if (taskPackage.workType !== "implementation") fail("task-package");
  try {
    intent = parseTargetDeliveryIntent(input.intent);
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryIntentError) fail("intent");
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
    report = parseImplementationTargetResultReport(input.report);
  } catch (error: unknown) {
    if (error instanceof ImplementationTargetResultReportError) fail("report");
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
    claim.programId !== taskPackage.programId ||
    claim.target.demandId !== intent.demandId ||
    claim.target.targetTaskId !== taskPackage.targetTaskId ||
    claim.target.targetDeliveryId !== intent.targetDeliveryId ||
    claim.target.intentDigest !== intent.intentDigest ||
    claim.target.intentPreparedAt !== intent.preparedAt ||
    "workType" in claim.target ||
    claim.route.hostId !== intent.route.hostId ||
    claim.claimId !== observation.action.actionId ||
    claim.claimDigest !== observation.action.claimDigest ||
    "workType" in observation.action ||
    claim.route.windowId !== taskPackage.assignment.windowId ||
    claim.route.windowId !== intent.route.windowId ||
    claim.route.bindingId !== intent.route.bindingId ||
    observation.action.targetDeliveryId !== intent.targetDeliveryId ||
    observation.action.intentDigest !== intent.intentDigest ||
    observation.action.hostId !== intent.route.hostId ||
    observation.action.windowId !== intent.route.windowId ||
    observation.action.bindingId !== intent.route.bindingId ||
    observation.action.claimEventId !== claim.claimTransition.eventId ||
    observation.action.claimCommitId !== claim.claimTransition.commitId ||
    observation.action.claimEventStreamRevision !==
      claim.claimTransition.expectedStreamRevision + 1 ||
    observation.action.claimExpectedStateDigest !==
      claim.claimTransition.expectedStateDigest ||
    observation.action.hostObservationAuthorityDigest !==
      claim.hostObservation.authorityDigest ||
    observation.action.issuedAt !== claim.claimedAt
  ) {
    fail("relation");
  }
  assertReportMatchesTaskPackage(report, taskPackage);
  const basis = {
    kind: "WakeflowTargetResult" as const,
    schemaVersion: 1 as const,
    workType: "implementation" as const,
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
