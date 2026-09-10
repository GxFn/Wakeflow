import { equal, rejects, throws } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { deliveryPurpose } from "../../../src/governance/delivery/delivery-envelope.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  parseDemandAggregateState,
  planTargetTaskInDemandAggregateState,
  DemandAggregateStateError,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { ControllerImplementationReviewDecisionService } from "../../../src/governance/review/controller-implementation-review-decision-service.js";
import {
  ControllerProductDefectRemediationService,
  ControllerProductDefectRemediationServiceError,
} from "../../../src/governance/review/controller-product-defect-remediation-service.js";
import { ControllerTestReviewDecisionService } from "../../../src/governance/review/controller-test-review-decision-service.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import { TargetResultImportService } from "../../../src/governance/result/target-result-import-service.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { createImplementationTargetResultReportContentFixture } from "../result/implementation-target-result-report.fixture.js";
import { controllerImplementationReviewDecisionInput } from "./controller-implementation-review-decision.fixture.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
} from "./controller-test-review-decision-service.fixture.js";
import {
  landFixturePrompt,
  loadFixtureDeliveryEnvelope,
  prepareFixtureDelivery,
  recordFixtureDeliveryOutcome,
} from "../delivery/delivery-workspace.fixture.js";
import { planFixtureTestTask } from "../tasking/test-task-planning.fixture.js";

const DECIDED_AT = parseUtcInstant("2026-08-29T12:35:00.000Z");
const PRODUCT_DEFECT_DECISION_UUID = "a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6";
const PRODUCT_DEFECT_REMEDIATION_UUID = "b7b7b7b7-b7b7-47b7-87b7-b7b7b7b7b7b7";
const PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_AT = parseUtcInstant(
  "2026-08-29T12:10:00.000Z",
);

test("Controller Product Defect Remediation保留旧Test代际并打开精确产品返工", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  let demandRoot: RootedDirectory | undefined;
  try {
    const decided = await new ControllerTestReviewDecisionService(
      fixture.workspaceRoot,
    ).decide(
      {
        ...fixture.testDecisionRequest,
        decision: "escalate-product-defect",
        assessment: {
          conclusion: "defect-observed",
          evidenceSufficiency: "sufficient",
        },
        independentChecks: [
          {
            checkId: "controller-product-defect",
            method: "复验真实环境Evidence并定位产品行为偏差。",
            outcome: "failed",
            observation: "冻结实现基线在批准场景中稳定复现产品缺陷。",
          },
        ],
        rationale: "当前Test代际已充分证明产品缺陷，不能作为环境重跑处理。",
      },
      {
        clock: () => DECIDED_AT,
        uuidFactory: () => PRODUCT_DEFECT_DECISION_UUID,
      },
    );
    const defectRoute = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.demandId,
    );
    equal(defectRoute.nextStage.status, "test-product-defect-escalated");
    if (defectRoute.nextStage.status !== "test-product-defect-escalated") {
      throw new Error("Expected product-defect route.");
    }
    const implementationBaseline = { targetTaskId: fixture.targetTaskId };
    const remediationRequest = {
      demandId: fixture.demandId,
      testReviewDecisionId: decided.decision.targetReviewDecisionId,
      postAcceptanceRouteDigest: defectRoute.routeDigest,
      affectedTargets: [
        {
          targetTaskId: implementationBaseline.targetTaskId,
          failedCheckIds: ["controller-product-defect"],
          correctionObjective: "在原TaskPackage边界内修复已复现产品缺陷。",
        },
      ],
      authorizationRationale: "缺陷已映射到唯一产品Target及原包边界。",
    };
    const remediationService = new ControllerProductDefectRemediationService(
      fixture.workspaceRoot,
    );
    await rejects(
      remediationService.authorize({
        ...remediationRequest,
        testTargetTaskId: fixture.testTargetTaskId,
      }),
      (error: unknown) =>
        error instanceof ControllerProductDefectRemediationServiceError &&
        error.reason === "input" &&
        error.eventAuthority === "unchanged",
    );
    await rejects(
      remediationService.authorize(
        {
          ...remediationRequest,
          affectedTargets: [
            {
              ...remediationRequest.affectedTargets[0],
              failedCheckIds: ["unknown-check"],
            },
          ],
        },
        {
          clock: () => PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_AT,
          uuidFactory: () => PRODUCT_DEFECT_REMEDIATION_UUID,
        },
      ),
      (error: unknown) =>
        error instanceof ControllerProductDefectRemediationServiceError &&
        error.reason === "authorization" &&
        error.eventAuthority === "unchanged",
    );
    const authorized = await remediationService.authorize(remediationRequest, {
      clock: () => PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_AT,
      uuidFactory: () => PRODUCT_DEFECT_REMEDIATION_UUID,
    });
    equal(authorized.status, "authorized");
    equal(authorized.disposition, "committed");
    const authorization = authorized.authorization;
    equal(
      authorization.authorizedAt <
        authorization.source.testReviewDecision.decidedAt,
      true,
    );
    equal(
      authorized.commandResult.commit.events[0]?.eventType,
      "review.product-defect-remediation-authorized",
    );
    equal(authorized.commandResult.commit.events[0]?.eventVersion, 1);
    const replayed = await remediationService.authorize(remediationRequest, {
      clock: () => parseUtcInstant("2026-08-29T12:37:00.000Z"),
      uuidFactory: () => "c8c8c8c8-c8c8-48c8-88c8-c8c8c8c8c8c8",
    });
    equal(replayed.status, "already-authorized");
    equal(replayed.disposition, "idempotent");
    equal(
      replayed.authorization.productDefectRemediationId,
      authorization.productDefectRemediationId,
    );
    await rejects(
      remediationService.authorize({
        ...remediationRequest,
        authorizationRationale: "试图用不同意图重放同一Test Decision。",
      }),
      (error: unknown) =>
        error instanceof ControllerProductDefectRemediationServiceError &&
        error.reason === "state" &&
        error.eventAuthority === "current",
    );

    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.demandId).split("/"),
      ),
    );
    const repository = new DemandEventSourcingRepository(demandRoot);
    const history = await repository.auditTargetResultHistory();
    const defectTarget = history.aggregate.state.targetTasks.find(
      (target) => target.targetTaskId === fixture.testTargetTaskId,
    );
    equal(defectTarget?.phase, "test-product-defect");
    equal(
      history.aggregate.state.pendingTestRetest?.previousTestTarget.targetTaskId,
      fixture.testTargetTaskId,
    );
    equal(
      history.aggregate.state.pendingTestRetest?.previousTestTarget.taskPackageId,
      fixture.testTaskPackageId,
    );
    equal(
      history.aggregate.state.pendingTestRetest?.productDefectRemediation
        .productDefectRemediationId,
      authorization.productDefectRemediationId,
    );
    const remediationTarget = history.aggregate.state.targetTasks.find(
      (target) => target.targetTaskId === implementationBaseline.targetTaskId,
    );
    equal(remediationTarget?.phase, "product-defect-rework-requested");
    if (remediationTarget?.phase !== "product-defect-rework-requested") {
      throw new Error("Expected product-defect product rework target.");
    }
    equal(
      remediationTarget.productDefectRemediation.authorizedAt <
        remediationTarget.currentDelivery.reviewDecision.decidedAt,
      true,
    );
    equal(
      remediationTarget.productDefectRemediation.authorizationDigest,
      authorization.authorizationDigest,
    );
    equal(history.productDefectRemediationAuthorizations.length, 1);
    equal(
      authorization.source.testTaskPackage.taskPackageId,
      fixture.testTaskPackageId,
    );
    const blockedRoute = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.demandId,
    );
    equal(blockedRoute.nextStage.status, "not-ready");
    if (blockedRoute.nextStage.status !== "not-ready") {
      throw new Error("Expected product rework blocker route.");
    }
    equal(blockedRoute.nextStage.reason, "targets-not-accepted");
    equal(
      blockedRoute.nextStage.blockingTargets[0]?.phase,
      "product-defect-rework-requested",
    );

    const historical = parseDemandAggregateState(history.aggregate.state);
    equal(
      historical.targetTasks.find(
        (target) => target.targetTaskId === fixture.testTargetTaskId,
      )?.phase,
      "test-product-defect",
    );

    if (defectTarget?.phase !== "test-product-defect") {
      throw new Error("Expected product-defect Test target.");
    }
    throws(
      () =>
        parseDemandAggregateState({
          ...historical,
          targetTasks: historical.targetTasks.map((target) =>
            target.targetTaskId === defectTarget.targetTaskId
              ? {
                  ...defectTarget,
                  phase: "test-another-attempt-requested",
                  currentDelivery: {
                    ...defectTarget.currentDelivery,
                    reviewDecision: {
                      ...defectTarget.currentDelivery.reviewDecision,
                      decision: "request-another-attempt",
                    },
                  },
                }
              : target,
          ),
        }),
      (error: unknown) =>
        error instanceof DemandAggregateStateError &&
        error.reason === "relation",
    );

    const implementationPackage = history.taskPackages.find(
      (source) => source.taskPackage.workType === "implementation",
    )?.taskPackage;
    if (implementationPackage?.workType !== "implementation") {
      throw new Error("Expected implementation TaskPackage history.");
    }
    throws(
      () =>
        planTargetTaskInDemandAggregateState(historical, {
          ...implementationPackage,
          taskPackageId: "task-package_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          targetTaskId: "target-task_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          assignment: {
            repositoryId: "repository_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            windowId: "window_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        }),
      (error: unknown) =>
        error instanceof DemandAggregateStateError &&
        error.reason === "transition",
    );

    await demandRoot.close();
    demandRoot = undefined;
    const remediationTargetRef = {
      workspacePath: fixture.workspacePath,
      demandId: fixture.demandId,
      targetTaskId: implementationBaseline.targetTaskId,
    };
    const remediationPrepareOverrides = {
      idempotencyKey: "remediation-prepare-1",
      expectedStreamRevision: blockedRoute.observedEventStream.streamRevision,
      language: "en" as const,
    };
    const remediationPrepared = await prepareFixtureDelivery(
      remediationTargetRef,
      remediationPrepareOverrides,
      { clock: () => parseUtcInstant("2026-08-29T12:38:00.000Z") },
    );
    equal(remediationPrepared.status, "committed");
    const remediationEnvelope = await loadFixtureDeliveryEnvelope(
      fixture,
      remediationPrepared.delivery.deliveryId,
    );
    equal(deliveryPurpose(remediationEnvelope), "product-defect-remediation");
    equal(
      remediationEnvelope.productDefectRemediation?.authorization
        .productDefectRemediationId,
      authorization.productDefectRemediationId,
    );
    equal(
      remediationEnvelope.productDefectRemediation?.requiredCorrections[0]?.checkId,
      "controller-product-defect",
    );
    equal(
      remediationPrepared.permit.prompt.includes("Product-defect remediation basis"),
      true,
    );
    const deliveryReplayed = await prepareFixtureDelivery(
      remediationTargetRef,
      remediationPrepareOverrides,
      { clock: () => parseUtcInstant("2026-08-29T12:38:30.000Z") },
    );
    equal(deliveryReplayed.status, "idempotent");

    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.demandId).split("/"),
      ),
    );
    const preparedHistory = await new DemandEventSourcingRepository(
      demandRoot,
    ).auditTargetResultHistory();
    equal(
      preparedHistory.aggregate.state.targetTasks.find(
        (target) => target.targetTaskId === implementationBaseline.targetTaskId,
      )?.phase,
      "delivery-prepared",
    );
    equal(
      preparedHistory.aggregate.state.targetTasks.find(
        (target) => target.targetTaskId === fixture.testTargetTaskId,
      )?.phase,
      "test-product-defect",
    );
    equal(
      preparedHistory.aggregate.state.pendingTestRetest
        ?.productDefectRemediation.productDefectRemediationId,
      authorization.productDefectRemediationId,
    );
    await demandRoot.close();
    demandRoot = undefined;

    await landFixturePrompt(
      fixture,
      fixture.route,
      remediationPrepared.permit.prompt,
      parseUtcInstant("2026-08-29T12:39:00.000Z"),
    );
    const remediationOutcome = await recordFixtureDeliveryOutcome(
      fixture,
      remediationPrepared,
      {
        idempotencyKey: "remediation-outcome-1",
        observedAt: parseUtcInstant("2026-08-29T12:41:00.000Z"),
      },
      { clock: () => parseUtcInstant("2026-08-29T12:41:00.000Z") },
    );
    equal(remediationOutcome.outcome.disposition, "accepted");
    await new TargetResultImportService(fixture.workspaceRoot, "codex").import(
      {
        demandId: fixture.demandId,
        deliveryId: remediationPrepared.delivery.deliveryId,
        claimDigest: remediationPrepared.permit.fence.claimDigest,
        report: {
          workType: "implementation",
          content: createImplementationTargetResultReportContentFixture(
            implementationPackage,
          ),
        },
      },
      { clock: () => parseUtcInstant("2026-08-29T12:42:00.000Z") },
    );

    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.demandId).split("/"),
      ),
    );
    const remediationReviewSnapshot =
      await readDemandResultReviewSnapshot(demandRoot);
    await demandRoot.close();
    demandRoot = undefined;
    const remediationReviewTarget = remediationReviewSnapshot.targets.find(
      (target) => target.targetTaskId === implementationBaseline.targetTaskId,
    );
    if (remediationReviewTarget?.status !== "reported") {
      throw new Error("Expected reported remediation product target.");
    }
    const acceptedJudgment =
      controllerImplementationReviewDecisionInput("accept");
    const acceptedRemediation =
      await new ControllerImplementationReviewDecisionService(
        fixture.workspaceRoot,
      ).decide(
        {
          demandId: fixture.demandId,
          targetResultId: remediationReviewTarget.targetResult.targetResultId,
          snapshotDigest: remediationReviewSnapshot.snapshotDigest,
          reviewUnitDigest: remediationReviewTarget.reviewUnitDigest,
          decision: acceptedJudgment.decision,
          assessment: acceptedJudgment.assessment,
          independentChecks: acceptedJudgment.independentChecks,
          rationale: "Controller独立检查确认产品缺陷修复已闭合原TaskPackage。",
          blockingReasons: acceptedJudgment.blockingReasons,
          residualRisks: ["仍需对新实现基线重新执行真实环境Test。"],
        },
        {
          clock: () => parseUtcInstant("2026-08-29T12:43:00.000Z"),
          uuidFactory: () => "17171717-1717-4717-8717-171717171717",
        },
      );
    equal(acceptedRemediation.decision.decision, "accept");
    const retestRoute = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.demandId,
    );
    equal(retestRoute.nextStage.status, "test-task-planning");
    if (retestRoute.nextStage.status !== "test-task-planning") {
      throw new Error("Expected retest planning route.");
    }
    equal(
      retestRoute.nextStage.retest?.productDefectRemediation
        .productDefectRemediationId,
      authorization.productDefectRemediationId,
    );
    equal(
      retestRoute.nextStage.retest?.previousTestTarget.targetTaskId,
      fixture.testTargetTaskId,
    );

    // 复测任务包必须以 retest 谱系消费待处理授权；首轮谱系在追加前被拒。
    const retestRevision = retestRoute.observedEventStream.streamRevision;
    await rejects(
      planFixtureTestTask(
        fixture,
        retestRevision,
        { idempotencyKey: "remediation-test-plan-initial" },
        { clock: () => parseUtcInstant("2026-08-29T12:44:00.000Z") },
      ),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "precondition-failed" &&
        error.reason === "lineage-retest-required",
    );
    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.demandId).split("/"),
      ),
    );
    const beforeRetest = await new DemandEventSourcingRepository(
      demandRoot,
    ).auditTargetResultHistory();
    equal(
      beforeRetest.aggregate.state.pendingTestRetest?.productDefectRemediation
        .productDefectRemediationId,
      authorization.productDefectRemediationId,
    );
    const previousTestPackage = beforeRetest.taskPackages.find(
      (source) => source.taskPackage.taskPackageId === fixture.testTaskPackageId,
    )?.taskPackage;
    if (previousTestPackage?.workType !== "test") {
      throw new Error("Expected previous Test TaskPackage history.");
    }
    throws(
      () =>
        planTargetTaskInDemandAggregateState(beforeRetest.aggregate.state, {
          ...previousTestPackage,
          taskPackageId: "task-package_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          targetTaskId: "target-task_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          lineage: {
            kind: "retest",
            retestsTargetTaskId: fixture.testTargetTaskId,
            productDefectRemediationId:
              "product-defect-remediation_31313131-3131-4131-8131-313131313131",
            authorizationDigest: authorization.authorizationDigest,
          },
        }),
      (error: unknown) =>
        error instanceof DemandAggregateStateError &&
        error.reason === "transition",
    );
    await demandRoot.close();
    demandRoot = undefined;

    const retestPlanned = await planFixtureTestTask(
      fixture,
      retestRevision,
      {
        idempotencyKey: "remediation-test-plan",
        taskPackage: {
          lineage: { kind: "retest", retestsTargetTaskId: fixture.testTargetTaskId },
        },
      },
      { clock: () => parseUtcInstant("2026-08-29T12:45:00.000Z") },
    );
    equal(retestPlanned.status, "committed");
    if (retestPlanned.targetTask.workType !== "test") {
      throw new Error("Expected a retest Test target.");
    }
    equal(retestPlanned.targetTask.lineage?.kind, "retest");
    equal(
      retestPlanned.targetTask.lineage?.productDefectRemediationId,
      authorization.productDefectRemediationId,
    );
    equal(
      retestPlanned.targetTask.lineage?.authorizationDigest,
      authorization.authorizationDigest,
    );
    equal(retestPlanned.next.frontier, "test-delivery-planning");
    const newTestDeliveryRoute = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.demandId,
    );
    equal(newTestDeliveryRoute.nextStage.status, "test-delivery-planning");

    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.demandId).split("/"),
      ),
    );
    const retestHistory = await new DemandEventSourcingRepository(
      demandRoot,
    ).auditTargetResultHistory();
    const retestPackage = retestHistory.taskPackages.find(
      (source) =>
        source.taskPackage.taskPackageId === retestPlanned.targetTask.taskPackageId,
    )?.taskPackage;
    if (retestPackage?.workType !== "test") {
      throw new Error("Expected retest TaskPackage history.");
    }
    equal(
      retestPackage.implementationBaselines[0]?.targetResultId,
      remediationReviewTarget.targetResult.targetResultId,
    );
    equal(
      Object.hasOwn(retestHistory.aggregate.state, "pendingTestRetest"),
      false,
    );
    equal(
      retestHistory.aggregate.state.targetTasks.find(
        (target) => target.targetTaskId === fixture.testTargetTaskId,
      )?.phase,
      "test-product-defect",
    );
    equal(
      retestHistory.aggregate.state.targetTasks.filter(
        (target) => target.workType === "test",
      ).length,
      2,
    );
    equal(
      retestHistory.aggregate.state.targetTasks.find(
        (target) => target.targetTaskId === retestPlanned.targetTask.targetTaskId,
      )?.phase,
      "planned",
    );
  } finally {
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});
