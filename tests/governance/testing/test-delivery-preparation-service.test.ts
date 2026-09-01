import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { createWindowWorkClaimInStore } from "../../../src/governance/delivery/window-work-claim-store.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { TargetHostEffectOutcomeService } from "../../../src/governance/delivery/target-host-effect-outcome-service.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import { ControllerTestReviewDecisionService } from "../../../src/governance/review/controller-test-review-decision-service.js";
import { TargetResultImportService } from "../../../src/governance/result/target-result-import-service.js";
import { TargetTaskPlanningService } from "../../../src/governance/tasking/target-task-planning-service.js";
import { parseTestDeliveryIntent } from "../../../src/governance/testing/test-delivery-intent.js";
import { executeTestDeliveryPreparationPublicRequest } from "../../../src/governance/testing/test-delivery-preparation-public-coordinator.js";
import {
  computeTestDeliveryPreparationPlanDigest,
  createTestDeliveryPreparationPlan,
} from "../../../src/governance/testing/test-delivery-preparation-plan.js";
import {
  TestDeliveryPreparationService,
  TestDeliveryPreparationServiceError,
} from "../../../src/governance/testing/test-delivery-preparation-service.js";
import {
  createInitialTestExecutionAttempt,
  createRerunTestExecutionAttempt,
  parseTestExecutionAttempt,
  TestExecutionAttemptError,
} from "../../../src/governance/testing/test-execution-attempt.js";
import { TestDispatchProjectionStore } from "../../../src/governance/testing/test-dispatch-projection-store.js";
import { parseTestCard } from "../../../src/governance/testing/test-card.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
} from "../review/controller-test-review-decision-service.fixture.js";
import {
  cleanupTestTaskPlanningWorkspaceFixture,
  createTestTaskPlanningWorkspaceFixture,
  TEST_TASK_PACKAGE_CREATED_AT,
  testTaskPlanningUuidFactory,
} from "./test-task-planning-service.fixture.js";
import {
  cleanupTestDeliveryPreparationWorkspaceFixture,
  createTestDeliveryPreparationWorkspaceFixture,
  TEST_DELIVERY_PREPARED_AT,
  testDeliveryUuidFactory,
} from "./test-delivery-preparation-service.fixture.js";

const RERUN_DECIDED_AT = parseUtcInstant("2026-08-29T12:35:00.000Z");
const RERUN_PREPARED_AT = parseUtcInstant("2026-08-29T12:18:00.000Z");
const RERUN_CLAIM_OBSERVED_AT = parseUtcInstant("2026-08-29T12:37:00.000Z");
const RERUN_CLAIMED_AT = parseUtcInstant("2026-08-29T12:38:00.000Z");
const RERUN_OUTCOME_AT = parseUtcInstant("2026-08-29T12:39:00.000Z");
const RERUN_RESULT_AT = parseUtcInstant("2026-08-29T12:40:00.000Z");
const RERUN_DECISION_UUID = "d5d5d5d5-d5d5-45d5-85d5-d5d5d5d5d5d5";
const RERUN_PREPARATION_UUIDS = Object.freeze([
  "d6d6d6d6-d6d6-46d6-86d6-d6d6d6d6d6d6",
  "d7d7d7d7-d7d7-47d7-87d7-d7d7d7d7d7d7",
  "d8d8d8d8-d8d8-48d8-88d8-d8d8d8d8d8d8",
  "d9d9d9d9-d9d9-49d9-89d9-d9d9d9d9d9d9",
]);
const RERUN_CLAIM_UUIDS = Object.freeze([
  "dadadada-dada-4ada-8ada-dadadadadada",
  "dbdbdbdb-dbdb-4bdb-8bdb-dbdbdbdbdbdb",
  "dcdcdcdc-dcdc-4cdc-8cdc-dcdcdcdcdcdc",
]);

const CODEX_TEST_DELIVERY_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});

function rerunPreparationUuidFactory(): () => string {
  let index = 0;
  return () => RERUN_PREPARATION_UUIDS[index++] ?? "invalid";
}

function rerunClaimUuidFactory(): () => string {
  let index = 0;
  return () => RERUN_CLAIM_UUIDS[index++] ?? "invalid";
}

async function aggregate(workspacePath: string, demandId: string) {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return (await new DemandEventSourcingRepository(root).audit()).aggregate;
  } finally {
    await root.close();
  }
}

function service(root: RootedDirectory): TestDeliveryPreparationService {
  return new TestDeliveryPreparationService(
    root,
    codexWorkspaceHostResourceProfile,
    codexWindowHostIdentityProfile,
  );
}

function rewriteConfig(workspacePath: string): void {
  const value = createMinimalWakeflowConfigV3();
  const program = value.program as Record<string, unknown>;
  program.displayName = "Changed after Test Delivery preparation";
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfigV3(parseWakeflowConfigV3(value)),
    { mode: 0o644 },
  );
}

test("Test Delivery preview零写派生initial attempt，Apply只追加授权Event", async () => {
  const fixture = await createTestDeliveryPreparationWorkspaceFixture();
  try {
    const owner = service(fixture.workspaceRoot);
    const before = await aggregate(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    equal(before.streamRevision, 9);
    const preview = await owner.preview(fixture.testDeliveryRequest, {
      clock: () => TEST_DELIVERY_PREPARED_AT,
      uuidFactory: testDeliveryUuidFactory(),
    });
    equal(
      (await aggregate(fixture.workspacePath, fixture.intent.demandId))
        .streamRevision,
      9,
    );
    const intent = preview.plan.intent;
    equal(intent.kind, "WakeflowTestDeliveryIntent");
    equal(intent.route.windowId, fixture.testCard.testWindowId);
    equal(intent.route.bindingId, fixture.testBindingId);
    equal(intent.target.testCard.testCardId, fixture.testCard.testCardId);
    equal(intent.attempt.ordinal, 1);
    equal(intent.attempt.mode, "initial");
    equal(intent.preparedAt, TEST_DELIVERY_PREPARED_AT);
    equal(intent.preparedAt < fixture.testCard.createdAt, true);
    equal(intent.preparedAt < TEST_TASK_PACKAGE_CREATED_AT, true);
    deepEqual(intent.attempt.environmentSetup, {
      policy: "reuse-existing",
      directive: "reuse-confirmed-environment",
    });
    equal(Object.hasOwn(intent, "portablePrompt"), false);
    equal(Object.hasOwn(intent, "packet"), false);
    equal(Object.hasOwn(intent, "workClaim"), false);
    equal(JSON.stringify(intent).includes(fixture.testRawHandle), false);

    const applied = await owner.apply(preview.plan, preview.planDigest);
    equal(applied.disposition, "committed");
    equal(applied.commandResult.aggregate.streamRevision, 10);
    equal(
      applied.commandResult.commit.events[0]?.eventType,
      "testing.test-delivery-prepared",
    );
    const target = applied.commandResult.aggregate.state.targetTasks.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    equal(target?.phase, "test-delivery-prepared");
    if (
      target?.workType !== "test" ||
      target.phase !== "test-delivery-prepared"
    ) {
      throw new Error("Expected prepared Test target.");
    }
    equal(target.testAttempts.length, 1);
    equal(target.currentDelivery.testAttemptId, intent.attempt.testAttemptId);
    const route = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.intent.demandId,
    );
    equal(route.nextStage.status, "test-dispatch-planning");
    if (route.nextStage.status !== "test-dispatch-planning") {
      throw new Error("Expected Test dispatch planning route.");
    }
    equal(
      route.nextStage.testDelivery.testAttemptId,
      intent.attempt.testAttemptId,
    );

    rewriteConfig(fixture.workspacePath);
    const replayed = await owner.apply(preview.plan, preview.planDigest);
    equal(replayed.disposition, "idempotent");
    equal(replayed.commandResult.aggregate.streamRevision, 10);
  } finally {
    await cleanupTestDeliveryPreparationWorkspaceFixture(fixture);
  }
});

test("Controller授权后以精确lineage创建第二个Test rerun attempt", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture({
    maxAttempts: 2,
  });
  let demandRoot: RootedDirectory | undefined;
  try {
    const decision = await new ControllerTestReviewDecisionService(
      fixture.workspaceRoot,
    ).decide(
      {
        ...fixture.testDecisionRequest,
        decision: "request-another-attempt",
        assessment: {
          conclusion: "inconclusive",
          evidenceSufficiency: "insufficient",
        },
        independentChecks: [
          {
            checkId: "controller-rerun-evidence",
            method: "复验首次Test逐步Evidence的覆盖范围。",
            outcome: "inconclusive",
            observation: "当前Evidence不足以关闭冻结Test问题。",
          },
        ],
        rationale: "授权一次新的logical Test rerun补齐Evidence。",
      },
      {
        clock: () => RERUN_DECIDED_AT,
        uuidFactory: () => RERUN_DECISION_UUID,
      },
    );
    const route = await readDemandPostAcceptanceRoute(
      fixture.workspaceRoot,
      fixture.testClaimRequest.demandId,
    );
    if (route.nextStage.status !== "test-another-attempt-planning") {
      throw new Error("Expected another Test attempt planning route.");
    }
    const owner = service(fixture.workspaceRoot);
    let allocations = 0;
    await rejects(
      owner.preview(
        {
          mode: "rerun",
          demandId: fixture.testClaimRequest.demandId,
          targetTaskId: fixture.testTargetTaskId,
          rerunSource: route.nextStage.testReview,
        },
        {
          clock: () => RERUN_PREPARED_AT,
          uuidFactory: () => {
            allocations += 1;
            return RERUN_PREPARATION_UUIDS[0]!;
          },
        },
      ),
      (error: unknown) =>
        error instanceof TestDeliveryPreparationServiceError &&
        error.reason === "input",
    );
    equal(allocations, 0);

    const preview = await executeTestDeliveryPreparationPublicRequest(
      CODEX_TEST_DELIVERY_FACADE,
      {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.testClaimRequest.demandId,
        targetTaskId: fixture.testTargetTaskId,
      },
      {
        preview: {
          clock: () => RERUN_PREPARED_AT,
          uuidFactory: rerunPreparationUuidFactory(),
        },
      },
    );
    if (preview.mode !== "preview") {
      throw new Error("Expected public Test Delivery rerun preview.");
    }
    const rerun = preview.plan.intent.attempt;
    equal(rerun.mode, "rerun");
    equal(rerun.ordinal, 2);
    equal(preview.plan.intent.preparedAt, RERUN_PREPARED_AT);
    equal(RERUN_PREPARED_AT < decision.decision.decidedAt, true);
    equal(rerun.rerunSource?.previousAttemptId, fixture.testAttemptId);
    equal(
      rerun.rerunSource?.reviewDecision.targetReviewDecisionId,
      decision.decision.targetReviewDecisionId,
    );
    equal(rerun.environmentSetup.policy, "reuse-existing");
    equal(rerun.environmentSetup.directive, "reuse-confirmed-environment");

    const applied = await executeTestDeliveryPreparationPublicRequest(
      CODEX_TEST_DELIVERY_FACADE,
      {
        root: fixture.workspacePath,
        mode: "apply",
        plan: preview.plan,
        planDigest: preview.planDigest,
      },
    );
    if (applied.mode !== "apply") {
      throw new Error("Expected public Test Delivery rerun apply.");
    }
    equal(applied.disposition, "committed");
    equal(applied.testDelivery.authorizationKind, "rerun");
    const target = (
      await aggregate(fixture.workspacePath, fixture.testClaimRequest.demandId)
    ).state.targetTasks.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    if (
      target?.workType !== "test" ||
      target.phase !== "test-delivery-prepared"
    ) {
      throw new Error("Expected prepared Test rerun target.");
    }
    equal(target.testAttempts.length, 2);
    equal(target.testAttempts[0]?.attempt.testAttemptId, fixture.testAttemptId);
    equal(target.testAttempts[1]?.attempt.testAttemptId, rerun.testAttemptId);
    equal(target.testAttempts[1]?.deliveryAuthorizations.length, 1);
    const previousAuthorization =
      target.testAttempts[0]?.deliveryAuthorizations.at(-1);
    const rerunAuthorization =
      target.testAttempts[1]?.deliveryAuthorizations[0];
    if (
      previousAuthorization === undefined ||
      rerunAuthorization === undefined
    ) {
      throw new Error("Expected exact Test attempt authorizations.");
    }
    equal(rerunAuthorization.preparedAt, RERUN_PREPARED_AT);
    equal(
      rerunAuthorization.preparedAt < previousAuthorization.preparedAt,
      true,
    );

    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.testClaimRequest.demandId).split("/"),
      ),
    );
    const packet = (
      await new TestDispatchProjectionStore(demandRoot).materialize(
        preview.plan.intent.targetDeliveryId,
      )
    ).packet.projection.packet;
    equal(packet.attempt.mode, "rerun");
    equal(packet.attempt.ordinal, 2);
    equal(
      Object.hasOwn(packet.testContract.executionContract, "restartConditions"),
      false,
    );
    await demandRoot.close();
    demandRoot = undefined;

    const claimed = await new TargetHostEffectClaimService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    ).claim(
      {
        workType: "test",
        demandId: fixture.testClaimRequest.demandId,
        targetTaskId: fixture.testTargetTaskId,
        targetDeliveryId: preview.plan.intent.targetDeliveryId,
        intentDigest: preview.plan.intent.intentDigest,
        testDispatchPacketDigest: packet.packetDigest,
        observation: {
          ...fixture.testClaimRequest.observation,
          observedAt: RERUN_CLAIM_OBSERVED_AT,
        },
      },
      {
        clock: () => RERUN_CLAIMED_AT,
        uuidFactory: rerunClaimUuidFactory(),
      },
    );
    if (claimed.action?.kind !== "WakeflowTestDeliveryAgentHostAction") {
      throw new Error("Expected rerun Test Agent Host Action.");
    }
    const outcome = await new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    ).record({
      demandId: fixture.testClaimRequest.demandId,
      actionId: claimed.action.actionId,
      claimDigest: claimed.action.workClaim.claimDigest,
      attempt: {
        status: "accepted",
        evidence: { transport: "rerun-accepted" },
      },
      readback: {
        status: "pending",
        evidence: { visible: false },
      },
      observedAt: RERUN_OUTCOME_AT,
    });
    if (outcome.observation.action.workType !== "test") {
      throw new Error("Expected rerun Test Host Effect Observation.");
    }
    equal(outcome.observation.action.testAttemptId, rerun.testAttemptId);
    const evidenceLocators = fixture.testCard.approvedPlan.map(
      (_step, index) => ({
        kind: "test-step-report" as const,
        ref: `evidence/test-runs/rerun-step-${index}.json`,
        digest: `sha256:${String(index + 3).repeat(64)}`,
      }),
    );
    const imported = await new TargetResultImportService(
      fixture.workspaceRoot,
      "codex",
    ).import(
      {
        demandId: fixture.testClaimRequest.demandId,
        actionId: claimed.action.actionId,
        observationDigest: outcome.observation.observationDigest,
        report: {
          workType: "test",
          content: {
            outcome: "completed",
            summary: "第二个logical attempt完成全部批准步骤。",
            evidenceLocators,
            verification: ["逐项复验第二attempt Evidence。"],
            risks: ["第二Result仍需Controller独立审查。"],
            stepEvidence: fixture.testCard.approvedPlan.map((step, index) => ({
              planIndex: index,
              step,
              evidence: {
                ref: evidenceLocators[index]!.ref,
                digest: evidenceLocators[index]!.digest,
              },
            })),
          },
        },
      },
      { clock: () => RERUN_RESULT_AT },
    );
    if (imported.result.workType !== "test") {
      throw new Error("Expected imported rerun Test Result.");
    }
    equal(imported.result.testExecution.testAttemptId, rerun.testAttemptId);
    equal(imported.claimAuthority, "released");
    demandRoot = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.testClaimRequest.demandId).split("/"),
      ),
    );
    const reviewSnapshot = await readDemandResultReviewSnapshot(demandRoot);
    const reportedRerun = reviewSnapshot.targets.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    equal(reportedRerun?.status, "reported");
    if (
      reportedRerun?.status !== "reported" ||
      reportedRerun.targetResult.workType !== "test"
    ) {
      throw new Error("Expected reported rerun Test Result.");
    }
    equal(
      reportedRerun.targetResult.testExecution.testAttemptId,
      rerun.testAttemptId,
    );
    await demandRoot.close();
    demandRoot = undefined;

    const replayed = await owner.apply(preview.plan, preview.planDigest);
    equal(replayed.disposition, "idempotent");
    const replayedTarget =
      replayed.commandResult.aggregate.state.targetTasks.find(
        (entry) => entry.targetTaskId === fixture.testTargetTaskId,
      );
    if (
      replayedTarget?.workType !== "test" ||
      !("testAttempts" in replayedTarget)
    ) {
      throw new Error("Expected replayed Test target.");
    }
    equal(replayedTarget.testAttempts.length, 2);
  } finally {
    if (demandRoot !== undefined) await demandRoot.close();
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});

test("并发相同Test Delivery plan收敛为一个initial attempt Event", async () => {
  const fixture = await createTestDeliveryPreparationWorkspaceFixture();
  try {
    const owner = service(fixture.workspaceRoot);
    const preview = await owner.preview(fixture.testDeliveryRequest, {
      clock: () => TEST_DELIVERY_PREPARED_AT,
      uuidFactory: testDeliveryUuidFactory(),
    });
    const settled = await Promise.allSettled([
      owner.apply(preview.plan, preview.planDigest),
      owner.apply(preview.plan, preview.planDigest),
    ]);
    equal(
      settled.some(
        (entry) =>
          entry.status === "fulfilled" &&
          entry.value.disposition === "committed",
      ),
      true,
    );
    equal(
      (await owner.apply(preview.plan, preview.planDigest)).disposition,
      "idempotent",
    );
    const state = await aggregate(
      fixture.workspacePath,
      fixture.intent.demandId,
    );
    equal(state.streamRevision, 10);
    const target = state.state.targetTasks.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    if (
      target?.workType !== "test" ||
      target.phase !== "test-delivery-prepared"
    ) {
      throw new Error("Expected one prepared Test attempt.");
    }
    equal(target.testAttempts.length, 1);
  } finally {
    await cleanupTestDeliveryPreparationWorkspaceFixture(fixture);
  }
});

test("Test Delivery Apply拒绝伪造Binding和preview后产品Claim漂移", async () => {
  const fixture = await createTestDeliveryPreparationWorkspaceFixture();
  try {
    const owner = service(fixture.workspaceRoot);
    const preview = await owner.preview(fixture.testDeliveryRequest, {
      clock: () => TEST_DELIVERY_PREPARED_AT,
      uuidFactory: testDeliveryUuidFactory(),
    });
    const { intentDigest: _intentDigest, ...intentBasis } = preview.plan.intent;
    const forgedBasis = {
      ...intentBasis,
      route: {
        ...intentBasis.route,
        bindingId: "window_binding_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    };
    const forgedIntent = parseTestDeliveryIntent({
      ...forgedBasis,
      intentDigest: computeCanonicalJsonSha256Digest(forgedBasis),
    });
    const forgedPlan = createTestDeliveryPreparationPlan({
      demandId: preview.plan.demandId,
      targetTaskId: preview.plan.targetTaskId,
      expectedStreamRevision: preview.plan.expectedStreamRevision,
      commitId: preview.plan.commitId,
      eventId: preview.plan.eventId,
      intent: forgedIntent,
    });
    await rejects(
      owner.apply(
        forgedPlan,
        computeTestDeliveryPreparationPlanDigest(forgedPlan),
      ),
      (error: unknown) =>
        error instanceof TestDeliveryPreparationServiceError &&
        error.reason === "plan" &&
        error.eventAuthority === "unchanged",
    );

    const reported = fixture.reviewSnapshot.targets[0];
    if (reported?.status !== "reported") {
      throw new Error("Expected prior reported product TargetResult.");
    }
    const root = await RootedDirectory.open(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.intent.demandId).split("/"),
      ),
    );
    let priorClaim;
    try {
      const located = await new DemandEventSourcingRepository(
        root,
      ).findTargetHostEffectClaimedEvent(
        reported.targetResult.hostEffect.actionId,
      );
      if (located === null) throw new Error("Expected prior Claim Event.");
      priorClaim = located.event.data.claim;
    } finally {
      await root.close();
    }
    await createWindowWorkClaimInStore(fixture.workspaceRoot, priorClaim);
    await rejects(
      owner.apply(preview.plan, preview.planDigest),
      (error: unknown) =>
        error instanceof TestDeliveryPreparationServiceError &&
        error.reason === "claim" &&
        error.eventAuthority === "unchanged",
    );
    equal(
      (await aggregate(fixture.workspacePath, fixture.intent.demandId))
        .streamRevision,
      9,
    );
  } finally {
    await cleanupTestDeliveryPreparationWorkspaceFixture(fixture);
  }
});

test("Test Delivery Apply在Event提交前拒绝Config digest漂移", async () => {
  const fixture = await createTestDeliveryPreparationWorkspaceFixture();
  try {
    const owner = service(fixture.workspaceRoot);
    const preview = await owner.preview(fixture.testDeliveryRequest, {
      clock: () => TEST_DELIVERY_PREPARED_AT,
      uuidFactory: testDeliveryUuidFactory(),
    });
    rewriteConfig(fixture.workspacePath);
    await rejects(
      owner.apply(preview.plan, preview.planDigest),
      (error: unknown) =>
        error instanceof TestDeliveryPreparationServiceError &&
        error.reason === "config" &&
        error.eventAuthority === "unchanged",
    );
    equal(
      (await aggregate(fixture.workspacePath, fixture.intent.demandId))
        .streamRevision,
      9,
    );
  } finally {
    await cleanupTestDeliveryPreparationWorkspaceFixture(fixture);
  }
});

test("Test Delivery拒绝缺失Binding，Attempt拒绝旧mode并派生rerun环境策略", async () => {
  const withoutBinding = await createTestTaskPlanningWorkspaceFixture();
  try {
    const planning = new TargetTaskPlanningService(
      withoutBinding.workspaceRoot,
    );
    const task = await planning.preview(withoutBinding.testTaskRequest, {
      clock: () => TEST_TASK_PACKAGE_CREATED_AT,
      uuidFactory: testTaskPlanningUuidFactory(),
    });
    await planning.apply(task.plan, task.planDigest);
    await rejects(
      service(withoutBinding.workspaceRoot).preview({
        mode: "initial",
        demandId: withoutBinding.intent.demandId,
        targetTaskId: task.plan.taskPackage.targetTaskId,
      }),
      (error: unknown) =>
        error instanceof TestDeliveryPreparationServiceError &&
        error.reason === "input",
    );
    await rejects(
      service(withoutBinding.workspaceRoot).preview({
        demandId: withoutBinding.intent.demandId,
        targetTaskId: task.plan.taskPackage.targetTaskId,
      }),
      (error: unknown) =>
        error instanceof TestDeliveryPreparationServiceError &&
        error.reason === "binding",
    );
  } finally {
    await cleanupTestTaskPlanningWorkspaceFixture(withoutBinding);
  }

  const fixture = await createTestDeliveryPreparationWorkspaceFixture();
  try {
    const preview = await service(fixture.workspaceRoot).preview(
      fixture.testDeliveryRequest,
      {
        clock: () => TEST_DELIVERY_PREPARED_AT,
        uuidFactory: testDeliveryUuidFactory(),
      },
    );
    throws(
      () =>
        parseTestExecutionAttempt({
          ...preview.plan.intent.attempt,
          ordinal: 2,
          mode: "resume",
        }),
      (error: unknown) =>
        error instanceof TestExecutionAttemptError && error.reason === "schema",
    );
    const { testCardDigest: _testCardDigest, ...cardBasis } = fixture.testCard;
    const freshBasis = {
      ...cardBasis,
      setupPolicy: "fresh-once" as const,
      maxAttempts: 2,
    };
    const freshCard = parseTestCard({
      ...freshBasis,
      testCardDigest: computeCanonicalJsonSha256Digest(freshBasis),
    });
    const freshInitial = createInitialTestExecutionAttempt({
      testAttemptId: preview.plan.intent.attempt.testAttemptId,
      testCard: freshCard,
    });
    equal(freshInitial.environmentSetup.directive, "prepare-fresh-environment");
    const rerunSource = {
      previousResult: {
        targetResultId: parseWakeflowDurableIdOfKind(
          "target-result_c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1",
          "target-result",
        ),
        resultDigest: parseSha256Digest(`sha256:${"1".repeat(64)}`),
      },
      reviewDecision: {
        targetReviewDecisionId: parseWakeflowDurableIdOfKind(
          "target-review-decision_c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2",
          "target-review-decision",
        ),
        decisionDigest: parseSha256Digest(`sha256:${"2".repeat(64)}`),
      },
    } as const;
    const freshOnceRerun = createRerunTestExecutionAttempt({
      testAttemptId: parseWakeflowDurableIdOfKind(
        "test-attempt_c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3",
        "test-attempt",
      ),
      testCard: freshCard,
      previousAttempt: freshInitial,
      ...rerunSource,
    });
    equal(
      freshOnceRerun.environmentSetup.directive,
      "reuse-confirmed-environment",
    );
    const freshPerBasis = {
      ...cardBasis,
      setupPolicy: "fresh-per-attempt" as const,
      maxAttempts: 2,
    };
    const freshPerCard = parseTestCard({
      ...freshPerBasis,
      testCardDigest: computeCanonicalJsonSha256Digest(freshPerBasis),
    });
    const freshPerInitial = createInitialTestExecutionAttempt({
      testAttemptId: preview.plan.intent.attempt.testAttemptId,
      testCard: freshPerCard,
    });
    equal(
      createRerunTestExecutionAttempt({
        testAttemptId: parseWakeflowDurableIdOfKind(
          "test-attempt_c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4",
          "test-attempt",
        ),
        testCard: freshPerCard,
        previousAttempt: freshPerInitial,
        ...rerunSource,
      }).environmentSetup.directive,
      "prepare-fresh-environment",
    );
  } finally {
    await cleanupTestDeliveryPreparationWorkspaceFixture(fixture);
  }
});
