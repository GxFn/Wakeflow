import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import {
  parseSha256Digest,
  type Sha256Digest,
} from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { parseDemandEventStreamRevision } from "../../../src/governance/demand/event-sourcing/demand-event-stream-position.js";
import {
  createControllerImplementationReviewDecision,
  type ControllerImplementationReviewDecisionType,
  type CreateControllerImplementationReviewDecisionInput,
} from "../../../src/governance/review/controller-implementation-review-decision.js";
import type { DemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import { createTargetResultFixture } from "../result/target-result.fixture.js";
import { createTaskPackageFixture } from "../tasking/task-package.fixture.js";

export const CONTROLLER_REVIEW_WINDOW_ID = parseWakeflowDurableIdOfKind(
  "window_77777777-7777-4777-8777-777777777777",
  "window",
);
export const CONTROLLER_REVIEW_SNAPSHOT_DIGEST = parseSha256Digest(
  `sha256:${"1".repeat(64)}`,
);
export const CONTROLLER_REVIEW_UNIT_DIGEST = parseSha256Digest(
  `sha256:${"2".repeat(64)}`,
);
export const CONTROLLER_REVIEW_STATE_DIGEST = parseSha256Digest(
  `sha256:${"3".repeat(64)}`,
);
export const CONTROLLER_REVIEW_DECIDED_AT = parseUtcInstant(
  "2026-08-29T12:15:00.000Z",
);
export const CONTROLLER_REVIEW_DECISION_UUID =
  "dededede-dede-4ded-8ded-dededededede";

export function controllerImplementationReviewDecisionInput(
  decision: ControllerImplementationReviewDecisionType = "accept",
): Readonly<CreateControllerImplementationReviewDecisionInput> {
  const taskPackage = createTaskPackageFixture();
  const targetResult = createTargetResultFixture();
  const assessment =
    decision === "accept"
      ? {
          requirementAlignment: "aligned" as const,
          implementationQuality: "satisfactory" as const,
        }
      : decision === "rework"
        ? {
            requirementAlignment: "aligned" as const,
            implementationQuality: "defective" as const,
          }
        : decision === "redesign"
          ? {
              requirementAlignment: "mismatch" as const,
              implementationQuality: "unverified" as const,
            }
          : {
              requirementAlignment: "unresolved" as const,
              implementationQuality: "unverified" as const,
            };
  const outcome =
    decision === "accept"
      ? ("passed" as const)
      : decision === "rework"
        ? ("failed" as const)
        : ("inconclusive" as const);
  return Object.freeze({
    programId: taskPackage.programId,
    demandId: taskPackage.demandId,
    targetTaskId: taskPackage.targetTaskId,
    controllerWindowId: CONTROLLER_REVIEW_WINDOW_ID,
    reviewed: Object.freeze({
      snapshotDigest: CONTROLLER_REVIEW_SNAPSHOT_DIGEST,
      reviewUnitDigest: CONTROLLER_REVIEW_UNIT_DIGEST,
      stateDigest: CONTROLLER_REVIEW_STATE_DIGEST,
      streamRevision: parseDemandEventStreamRevision(8),
      taskPackageId: taskPackage.taskPackageId,
      taskPackageDigest: targetResult.taskPackage.digest,
      targetResultId: targetResult.targetResultId,
      targetResultDigest: targetResult.resultDigest,
      targetResultOutcome: targetResult.report.outcome,
      targetResultReportedAt: targetResult.report.reportedAt,
    }),
    decision,
    assessment: Object.freeze(assessment),
    independentChecks: Object.freeze([
      Object.freeze({
        checkId: `controller-${decision}`,
        method: "重新读取变更并运行新增 TypeScript 聚焦测试",
        outcome,
        observation:
          outcome === "passed"
            ? "实现与任务合同一致，聚焦测试通过。"
            : outcome === "failed"
              ? "独立检查复现了实现缺陷。"
              : "当前输入不足以形成可接受结论。",
      }),
    ] as const),
    rationale: `Controller完成独立检查并决定${decision}。`,
    blockingReasons:
      decision === "blocked"
        ? Object.freeze(["缺少继续判断所需的外部事实。"])
        : Object.freeze([]),
    residualRisks: Object.freeze([]),
  });
}

export function createControllerImplementationReviewDecisionFixture(
  decision: ControllerImplementationReviewDecisionType = "accept",
) {
  return createControllerImplementationReviewDecision(
    controllerImplementationReviewDecisionInput(decision),
    {
      clock: () => CONTROLLER_REVIEW_DECIDED_AT,
      uuidFactory: () => CONTROLLER_REVIEW_DECISION_UUID,
    },
  );
}

export function createControllerImplementationReviewDecisionForState(
  stateDigest: Sha256Digest,
  decision: ControllerImplementationReviewDecisionType = "accept",
  streamRevision = 8,
  targetResult = createTargetResultFixture(),
) {
  const input = controllerImplementationReviewDecisionInput(decision);
  return createControllerImplementationReviewDecision(
    {
      ...input,
      programId: targetResult.programId,
      demandId: targetResult.demandId,
      targetTaskId: targetResult.targetTaskId,
      reviewed: Object.freeze({
        ...input.reviewed,
        stateDigest,
        streamRevision: parseDemandEventStreamRevision(streamRevision),
        taskPackageId: targetResult.taskPackage.taskPackageId,
        taskPackageDigest: targetResult.taskPackage.digest,
        targetResultId: targetResult.targetResultId,
        targetResultDigest: targetResult.resultDigest,
        targetResultOutcome: targetResult.report.outcome,
        targetResultReportedAt: targetResult.report.reportedAt,
      }),
    },
    {
      clock: () => CONTROLLER_REVIEW_DECIDED_AT,
      uuidFactory: () => CONTROLLER_REVIEW_DECISION_UUID,
    },
  );
}

export function createControllerImplementationReviewDecisionForSnapshot(
  snapshot: Readonly<DemandResultReviewSnapshot>,
  decision: ControllerImplementationReviewDecisionType = "accept",
) {
  const target = snapshot.targets.find((entry) => entry.status === "reported");
  if (target?.status !== "reported") {
    throw new Error("Expected one reported review target fixture.");
  }
  const input = controllerImplementationReviewDecisionInput(decision);
  return createControllerImplementationReviewDecision(
    {
      ...input,
      programId: target.taskPackage.programId,
      demandId: target.targetResult.demandId,
      targetTaskId: target.targetTaskId,
      reviewed: Object.freeze({
        snapshotDigest: snapshot.snapshotDigest,
        reviewUnitDigest: target.reviewUnitDigest,
        stateDigest: snapshot.eventStream.stateDigest,
        streamRevision: snapshot.eventStream.streamRevision,
        taskPackageId: target.taskPackage.taskPackageId,
        taskPackageDigest: target.targetResult.taskPackage.digest,
        targetResultId: target.targetResult.targetResultId,
        targetResultDigest: target.targetResult.resultDigest,
        targetResultOutcome: target.targetResult.report.outcome,
        targetResultReportedAt: target.targetResult.report.reportedAt,
      }),
    },
    {
      clock: () => CONTROLLER_REVIEW_DECIDED_AT,
      uuidFactory: () => CONTROLLER_REVIEW_DECISION_UUID,
    },
  );
}
