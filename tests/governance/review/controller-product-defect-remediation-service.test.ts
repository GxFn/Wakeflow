import { equal, rejects, throws } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { TargetDeliveryPreparationService } from "../../../src/governance/delivery/target-delivery-preparation-service.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { TargetHostEffectOutcomeService } from "../../../src/governance/delivery/target-host-effect-outcome-service.js";
import { targetDeliveryPurpose } from "../../../src/governance/delivery/target-delivery-intent.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  parseDemandEventSourcingCommand,
  DemandEventSourcingDecisionError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  createTestCardInDemandAggregateState,
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
import { TargetTaskPlanningService } from "../../../src/governance/tasking/target-task-planning-service.js";
import { TestCardPlanningService } from "../../../src/governance/testing/test-card-planning-service.js";
import { createImplementationTargetResultReportContentFixture } from "../result/implementation-target-result-report.fixture.js";
import { controllerImplementationReviewDecisionInput } from "./controller-implementation-review-decision.fixture.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
} from "./controller-test-review-decision-service.fixture.js";

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
      fixture.testClaimRequest.demandId,
    );
    equal(defectRoute.nextStage.status, "test-product-defect-escalated");
    if (defectRoute.nextStage.status !== "test-product-defect-escalated") {
      throw new Error("Expected product-defect route.");
    }
    const implementationBaseline = fixture.testCard.implementationBaselines[0];
    if (implementationBaseline === undefined) {
      throw new Error("Expected implementation baseline.");
    }
    const remediationRequest = {
      demandId: fixture.testClaimRequest.demandId,
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
        ...demandFinalRootRef(fixture.testClaimRequest.demandId).split("/"),
      ),
    );
    const repository = new DemandEventSourcingRepository(demandRoot);
    const history = await repository.auditTargetResultHistory();
    const defectTarget = history.aggregate.state.targetTasks.find(
      (target) => target.targetTaskId === fixture.testTargetTaskId,
    );
    equal(defectTarget?.phase, "test-product-defect");
    equal(Object.hasOwn(history.aggregate.state, "currentTestCard"), false);
    equal(
      history.aggregate.state.pendingTestRetest?.previousTestCard.testCardId,
      fixture.testCard.testCardId,
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
      (await repository.findTestCardCreatedEvent(fixture.testCard.testCardId))
        ?.event.data.testCard.testCardDigest,
      fixture.testCard.testCardDigest,
    );
    const blockedRoute = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.testClaimRequest.demandId,
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
    equal(Object.hasOwn(historical, "currentTestCard"), false);
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
    const preparation = new TargetDeliveryPreparationService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    );
    const deliveryUuids = [
      "d9d9d9d9-d9d9-49d9-89d9-d9d9d9d9d9d9",
      "eaeaeaea-eaea-4aea-8aea-eaeaeaeaeaea",
      "fbfbfbfb-fbfb-4bfb-8bfb-fbfbfbfbfbfb",
    ];
    let deliveryUuidIndex = 0;
    const deliveryPreview = await preparation.preview(
      {
        demandId: fixture.testClaimRequest.demandId,
        targetTaskId: implementationBaseline.targetTaskId,
      },
      {
        clock: () => parseUtcInstant("2026-08-29T12:38:00.000Z"),
        uuidFactory: () => deliveryUuids[deliveryUuidIndex++] ?? "invalid",
      },
    );
    equal(
      targetDeliveryPurpose(deliveryPreview.plan.intent),
      "product-defect-remediation",
    );
    equal(
      deliveryPreview.plan.intent.productDefectRemediation?.authorization
        .productDefectRemediationId,
      authorization.productDefectRemediationId,
    );
    equal(
      deliveryPreview.plan.intent.productDefectRemediation
        ?.requiredCorrections[0]?.checkId,
      "controller-product-defect",
    );
    equal(
      deliveryPreview.plan.intent.portablePrompt.includes(
        "Product-defect remediation basis",
      ),
      true,
    );
    const deliveryApplied = await preparation.apply(
      deliveryPreview.plan,
      deliveryPreview.planDigest,
    );
    equal(deliveryApplied.disposition, "committed");
    equal(deliveryApplied.commandResult.commit.events[0]?.eventVersion, 3);
    const deliveryReplayed = await preparation.apply(
      deliveryPreview.plan,
      deliveryPreview.planDigest,
    );
    equal(deliveryReplayed.disposition, "idempotent");

    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.testClaimRequest.demandId).split("/"),
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
      Object.hasOwn(preparedHistory.aggregate.state, "currentTestCard"),
      false,
    );
    equal(
      preparedHistory.aggregate.state.pendingTestRetest
        ?.productDefectRemediation.productDefectRemediationId,
      authorization.productDefectRemediationId,
    );
    await demandRoot.close();
    demandRoot = undefined;

    const claimUuids = [
      "14141414-1414-4414-8414-141414141414",
      "15151515-1515-4515-8515-151515151515",
      "16161616-1616-4616-8616-161616161616",
    ];
    let claimUuidIndex = 0;
    const claimed = await new TargetHostEffectClaimService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    ).claim(
      {
        workType: "implementation",
        demandId: deliveryPreview.plan.intent.demandId,
        targetTaskId: deliveryPreview.plan.intent.target.targetTaskId,
        targetDeliveryId: deliveryPreview.plan.intent.targetDeliveryId,
        intentDigest: deliveryPreview.plan.intent.intentDigest,
        observation: {
          ...fixture.claimRequest.observation,
          observedAt: parseUtcInstant("2026-08-29T12:39:00.000Z"),
        },
      },
      {
        clock: () => parseUtcInstant("2026-08-29T12:40:00.000Z"),
        uuidFactory: () => claimUuids[claimUuidIndex++] ?? "invalid",
      },
    );
    if (claimed.action === null) {
      throw new Error("Expected product remediation host action.");
    }
    const remediationOutcome = await new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    ).record({
      demandId: deliveryPreview.plan.intent.demandId,
      actionId: claimed.action.actionId,
      claimDigest: claimed.action.workClaim.claimDigest,
      attempt: {
        status: "accepted",
        evidence: { remediation: "host-effect-accepted" },
      },
      readback: { status: "pending", evidence: { visible: false } },
      observedAt: parseUtcInstant("2026-08-29T12:41:00.000Z"),
    });
    await new TargetResultImportService(fixture.workspaceRoot, "codex").import(
      {
        demandId: deliveryPreview.plan.intent.demandId,
        actionId: claimed.action.actionId,
        observationDigest: remediationOutcome.observation.observationDigest,
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
        ...demandFinalRootRef(fixture.testClaimRequest.demandId).split("/"),
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
          demandId: fixture.testClaimRequest.demandId,
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
      fixture.testClaimRequest.demandId,
    );
    equal(retestRoute.nextStage.status, "real-environment-test-planning");

    const cardUuids = [
      "18181818-1818-4818-8818-181818181818",
      "19191919-1919-4919-8919-191919191919",
      "20202020-2020-4020-8020-202020202020",
      "21212121-2121-4121-8121-212121212121",
    ];
    let cardUuidIndex = 0;
    const cardPlanning = new TestCardPlanningService(fixture.workspaceRoot);
    const cardPreview = await cardPlanning.preview(
      {
        demandId: fixture.testClaimRequest.demandId,
        testCard: fixture.testCardContent,
      },
      {
        clock: () => parseUtcInstant("2026-08-29T12:44:00.000Z"),
        uuidFactory: () => cardUuids[cardUuidIndex++] ?? "invalid",
      },
    );
    equal(cardPreview.plan.generationSource.kind, "product-defect-retest");
    if (cardPreview.plan.generationSource.kind !== "product-defect-retest") {
      throw new Error("Expected product-defect retest generation source.");
    }
    equal(
      cardPreview.plan.generationSource.previousTestCard.testCardId,
      fixture.testCard.testCardId,
    );
    equal(
      cardPreview.plan.generationSource.productDefectRemediation
        .productDefectRemediationId,
      authorization.productDefectRemediationId,
    );
    equal(Object.hasOwn(cardPreview.plan.testCard, "generationSource"), false);
    throws(
      () =>
        parseDemandEventSourcingCommand({
          commandType: "testing.create-test-card",
          commandVersion: 1,
          eventId: cardPreview.plan.eventId,
          authority: cardPreview.plan.authority,
          testCard: cardPreview.plan.testCard,
          generationSource: cardPreview.plan.generationSource,
        }),
      (error: unknown) =>
        error instanceof DemandEventSourcingDecisionError &&
        error.reason === "input",
    );
    equal(
      cardPreview.plan.testCard.testCardId === fixture.testCard.testCardId,
      false,
    );
    equal(
      cardPreview.plan.testCard.implementationBaselines[0]?.targetResultId,
      remediationReviewTarget.targetResult.targetResultId,
    );
    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.testClaimRequest.demandId).split("/"),
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
    throws(
      () =>
        createTestCardInDemandAggregateState(
          beforeRetest.aggregate.state,
          cardPreview.plan.testCard,
          {
            ...cardPreview.plan.generationSource,
            productDefectRemediation: {
              productDefectRemediationId:
                "product-defect-remediation_31313131-3131-4131-8131-313131313131",
              authorizationDigest: authorization.authorizationDigest,
            },
          },
        ),
      (error: unknown) =>
        error instanceof DemandAggregateStateError &&
        error.reason === "transition",
    );
    await demandRoot.close();
    demandRoot = undefined;
    await cardPlanning.apply(cardPreview.plan, cardPreview.planDigest);
    const newTestRoute = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.testClaimRequest.demandId,
    );
    equal(newTestRoute.nextStage.status, "test-task-planning");
    const taskUuids = [
      "22222222-2222-4222-8222-222222222222",
      "23232323-2323-4323-8323-232323232323",
      "24242424-2424-4424-8424-242424242424",
    ];
    let taskUuidIndex = 0;
    const taskPlanning = new TargetTaskPlanningService(fixture.workspaceRoot);
    const taskPreview = await taskPlanning.preview(
      {
        demandId: fixture.testClaimRequest.demandId,
        taskPackage: { workType: "test" },
      },
      {
        clock: () => parseUtcInstant("2026-08-29T12:45:00.000Z"),
        uuidFactory: () => taskUuids[taskUuidIndex++] ?? "invalid",
      },
    );
    await taskPlanning.apply(taskPreview.plan, taskPreview.planDigest);
    const newTestDeliveryRoute = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.testClaimRequest.demandId,
    );
    equal(newTestDeliveryRoute.nextStage.status, "test-delivery-planning");

    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.testClaimRequest.demandId).split("/"),
      ),
    );
    const retestHistory = await new DemandEventSourcingRepository(
      demandRoot,
    ).auditTargetResultHistory();
    equal(retestHistory.testCards.length, 2);
    equal(
      retestHistory.testCards[1]?.generationSource.kind,
      "product-defect-retest",
    );
    equal(
      retestHistory.aggregate.state.currentTestCard?.testCardId,
      cardPreview.plan.testCard.testCardId,
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
        (target) =>
          target.targetTaskId === cardPreview.plan.testCard.targetTaskId,
      )?.phase,
      "planned",
    );
  } finally {
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});
