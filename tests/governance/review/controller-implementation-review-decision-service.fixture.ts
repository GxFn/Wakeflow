import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import type { DeliveryEnvelope } from "../../../src/governance/delivery/delivery-envelope.js";
import {
  readDemandResultReviewSnapshot,
  type DemandResultReviewSnapshot,
} from "../../../src/governance/review/demand-result-review-snapshot.js";
import type { ControllerImplementationReviewDecisionRequest } from "../../../src/governance/review/controller-implementation-review-decision-input.js";
import {
  TargetResultImportService,
  type TargetResultImportResult,
} from "../../../src/governance/result/target-result-import-service.js";
import { TaskPackageProjectionStore } from "../../../src/governance/tasking/task-package-projection-store.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  deliverFixtureTarget,
  withFixtureDemandRoot,
  type DeliveredTarget,
  type DeliveryWorkspaceFixture,
} from "../delivery/delivery-workspace.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "../result/implementation-target-result-report.fixture.js";
import { controllerImplementationReviewDecisionInput } from "./controller-implementation-review-decision.fixture.js";
import type { TargetTaskPlanningWorkspaceFixtureOptions } from "../tasking/target-task-planning-service.fixture.js";

export const REVIEW_FIXTURE_REPORTED_AT = parseUtcInstant("2026-08-29T12:10:00.000Z");

/**
 * 实现链的评审夹具：已规划目标 → 投递 accepted → 结果导入 → 一份可直接决定的评审请求。
 * `envelope` 是投递信封（旧 intent 的替代），`delivered` 保存许可与结局。
 */
export interface ControllerImplementationReviewDecisionServiceFixture extends DeliveryWorkspaceFixture {
  readonly delivered: Readonly<DeliveredTarget>;
  readonly envelope: Readonly<DeliveryEnvelope>;
  readonly imported: Readonly<TargetResultImportResult>;
  readonly reviewSnapshot: Readonly<DemandResultReviewSnapshot>;
  readonly decisionRequest: Readonly<ControllerImplementationReviewDecisionRequest>;
}

export async function readControllerImplementationReviewDecisionServiceSnapshot(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
): Promise<Readonly<DemandResultReviewSnapshot>> {
  return withFixtureDemandRoot(fixture, readDemandResultReviewSnapshot);
}

/** 导入实现结果：报告内容按当前任务包生成，围栏取自 accepted 结局的声明摘要。 */
export async function importFixtureImplementationResult(
  fixture: Readonly<DeliveryWorkspaceFixture>,
  delivered: Readonly<DeliveredTarget>,
  reportedAt = REVIEW_FIXTURE_REPORTED_AT,
): Promise<Readonly<TargetResultImportResult>> {
  const taskPackage = await withFixtureDemandRoot(fixture, async (root) => {
    const snapshot = await readDemandResultReviewSnapshot(root);
    const target = snapshot.targets.find((entry) => entry.targetTaskId === fixture.targetTaskId);
    if (target?.status !== "awaiting-result") {
      throw new Error("Expected awaiting-result fixture target.");
    }
    return (
      await new TaskPackageProjectionStore(root).load(target.taskPackage.taskPackageId, {
        expectedTaskPackageDigest: target.taskPackage.digest,
      })
    ).taskPackage;
  });
  return new TargetResultImportService(fixture.workspaceRoot, "codex").import(
    {
      demandId: fixture.demandId,
      deliveryId: delivered.prepared.delivery.deliveryId,
      claimDigest: delivered.prepared.permit.fence.claimDigest,
      report: {
        workType: "implementation",
        content: createImplementationTargetResultReportContentFixture(taskPackage),
      },
    },
    { clock: () => reportedAt },
  );
}

export async function createControllerImplementationReviewDecisionServiceFixture(
  options: TargetTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<ControllerImplementationReviewDecisionServiceFixture>> {
  const fixture = await createDeliveryWorkspaceFixture(options);
  try {
    const delivered = await deliverFixtureTarget(fixture);
    const imported = await importFixtureImplementationResult(fixture, delivered);
    const reviewSnapshot = await readControllerImplementationReviewDecisionServiceSnapshot(fixture);
    const target = reviewSnapshot.targets[0];
    if (target?.status !== "reported") {
      throw new Error("Expected reported fixture target.");
    }
    const judgment = controllerImplementationReviewDecisionInput();
    return Object.freeze({
      ...fixture,
      delivered,
      envelope: delivered.envelope,
      imported,
      reviewSnapshot,
      decisionRequest: Object.freeze({
        demandId: target.targetResult.demandId,
        targetResultId: target.targetResult.targetResultId,
        snapshotDigest: reviewSnapshot.snapshotDigest,
        reviewUnitDigest: target.reviewUnitDigest,
        decision: judgment.decision,
        assessment: judgment.assessment,
        independentChecks: judgment.independentChecks,
        rationale: judgment.rationale,
        blockingReasons: judgment.blockingReasons,
        residualRisks: judgment.residualRisks,
      }),
    });
  } catch (error: unknown) {
    await cleanupDeliveryWorkspaceFixture(fixture);
    throw error;
  }
}

export async function cleanupControllerImplementationReviewDecisionServiceFixture(
  fixture: Readonly<ControllerImplementationReviewDecisionServiceFixture>,
): Promise<void> {
  await cleanupDeliveryWorkspaceFixture(fixture);
}
