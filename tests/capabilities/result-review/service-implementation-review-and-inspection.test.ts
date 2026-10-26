import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { test } from "node:test";

import type { TargetResultReviewInspectionResult } from "../../../src/capabilities/result-review/contract.js";
import { executeImplementationReviewDecisionRequest } from "../../../src/capabilities/result-review/service.js";
import { createWakeflowDurableId } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  createWorkClaim,
  inspectWorkClaim,
  releaseWorkClaim,
  takeWorkClaim,
} from "../../../src/kernel/work-claims.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  deliverFixtureTarget,
  registerFixtureWindowRoute,
  withFixtureDemandRoot,
} from "../../governance/delivery/delivery-workspace.fixture.js";
import { deliverFixtureTestTarget } from "../../governance/delivery/test-delivery-workspace.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "../../governance/result/implementation-target-result-report.fixture.js";
import { implementationReviewJudgmentWire } from "../../governance/review/controller-implementation-review-decision.fixture.js";
import {
  CODEX_REVIEW_FACADE,
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
  currentFixtureStreamRevision,
  decideFixtureImplementation,
  fixtureImplementationDecisionRequest,
  importFixtureImplementationResult,
  inspectFixtureReview,
  landFixtureCallback,
  landFixtureTargetCompletion,
  loadFixtureTaskPackage,
  REVIEW_INSPECTED_AT,
  readControllerImplementationReviewDecisionServiceSnapshot,
  recordFixtureEvidence,
  registerFixtureControllerWindow,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import {
  createControllerTestReviewDecisionServiceFixture,
  importFixtureTestResult,
  TEST_REVIEW_INSPECTED_AT,
  TEST_TARGET_STOPPED_AT,
} from "../../governance/review/controller-test-review-decision-service.fixture.js";
import {
  cleanupTestTaskPlanningWorkspaceFixture,
  createTestTaskPlanningWorkspaceFixture,
  planFixtureTestTask,
} from "../../governance/tasking/test-task-planning.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  allows,
  at,
  decisionOptions,
  plain,
  rearmCallback,
  rejectedWith,
} from "./service.fixture.js";

useDisposableDurability();

/**
 * result-review 切片效果（§13.87 D1–D8）之实现评审决定与评审检查，2 级（能力）测试：落地后的回调
 * 不再重发；过期基线被拒；blocked/escalated 之后只有带 resumption 的再决定回到同一结果；rework 之后
 * 再投递、再导入形成新的评审单元并保留历史；needs-review 结果按锚点绑定本 Demand 托管证据后接受
 * （§13.121 D7）；评审检查接纳超长合同步骤并按 detail=summary 收窄任务包。拆自 service.test.ts
 * （测试门清理 D4，open-items D9），与 service-import-and-callback、service-test-review 共用
 * service.fixture.ts。
 */

const OTHER_DECISION_ID = "target-review-decision_11111111-1111-4111-8111-111111111111";
const OTHER_EVENT_ID = "demand-event_22222222-2222-4222-8222-222222222222";

test("落地后的回调不再重发；过期基线被拒；blocked 之后只有带 condition-cleared resumption 的再决定回到同一结果", async () => {
  const fixture = await createControllerImplementationReviewDecisionServiceFixture();
  try {
    await landFixtureCallback(
      fixture,
      fixture.controllerRoute,
      fixture.imported.callback.permit.prompt,
    );
    const callbackId = fixture.imported.callback.callbackId;
    const revision = fixture.imported.event.streamRevision;
    await rejects(
      rearmCallback(fixture, callbackId, "fixture-callback-rearm-landed", revision, at("12:25:00")),
      rejectedWith("callback-landed"),
    );
    const landed = await inspectFixtureReview(fixture, fixture.targetTaskId);
    equal(landed.reviewUnit.status, "reported");
    equal(landed.reviewUnit.callback.status, "landed");
    equal(typeof landed.reviewUnit.callback.landedRecordId, "string");
    equal(landed.reviewUnit.targetCompletion.status, "confirmed");
    deepEqual(plain(landed.reviewUnit.allowedDecisions), [
      "accept",
      "rework",
      "blocked",
      "escalate",
    ]);
    equal(landed.reviewUnit.resumptionBasis, null);
    equal(landed.reviewUnit.currentDecision, null);

    await rejects(
      decideFixtureImplementation(fixture, { snapshotDigest: `sha256:${"0".repeat(64)}` }),
      rejectedWith("snapshot-stale"),
    );
    await rejects(
      decideFixtureImplementation(fixture, { reviewUnitDigest: `sha256:${"0".repeat(64)}` }),
      rejectedWith("review-unit-stale"),
    );
    await rejects(
      decideFixtureImplementation(fixture, {
        resumption: {
          previousDecisionId: OTHER_DECISION_ID,
          basis: { kind: "condition-cleared" },
          summary: "没有可续的决定。",
        },
      }),
      rejectedWith("resumption-unexpected"),
    );

    const blocked = await decideFixtureImplementation(
      fixture,
      {
        ...implementationReviewJudgmentWire("blocked"),
        idempotencyKey: "fixture-decision-blocked",
      },
      decisionOptions(at("12:15:00"), "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1"),
    );
    equal(blocked.status, "committed");
    equal(blocked.target.phase, "review-blocked");
    equal(blocked.decision.decision, "blocked");
    equal(blocked.decision.callbackLanding, "landed");
    equal(blocked.decision.targetCompletion, "confirmed");
    equal(blocked.attached.escalationEventId, null);
    equal(blocked.next.frontier, "implementation-review-blocked");
    const waiting = await inspectFixtureReview(fixture, fixture.targetTaskId, {
      clock: () => at("12:16:00"),
    });
    equal(waiting.reviewUnit.status, "review-blocked");
    equal(
      waiting.reviewUnit.currentDecision?.decision.targetReviewDecisionId,
      blocked.decision.targetReviewDecisionId,
    );
    deepEqual(plain(waiting.reviewUnit.resumptionBasis), { kind: "condition-cleared" });
    equal(waiting.reviewUnit.callback.status, "acknowledged");
    equal(allows(waiting.reviewUnit, "accept"), true);
    equal(waiting.snapshotDigest === landed.snapshotDigest, false);

    const base = fixtureImplementationDecisionRequest(
      fixture,
      waiting,
      blocked.event.streamRevision,
      "accept",
      "fixture-decision-resumed",
    );
    const options = decisionOptions(at("12:17:00"), "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2");
    await rejects(
      executeImplementationReviewDecisionRequest(CODEX_REVIEW_FACADE, base, options),
      rejectedWith("resumption-missing"),
    );
    await rejects(
      executeImplementationReviewDecisionRequest(
        CODEX_REVIEW_FACADE,
        {
          ...base,
          resumption: {
            previousDecisionId: OTHER_DECISION_ID,
            basis: { kind: "condition-cleared" },
            summary: "错误的前一决定。",
          },
        },
        options,
      ),
      rejectedWith("resumption-previous-decision"),
    );
    await rejects(
      executeImplementationReviewDecisionRequest(
        CODEX_REVIEW_FACADE,
        {
          ...base,
          resumption: {
            previousDecisionId: blocked.decision.targetReviewDecisionId,
            basis: { kind: "decision-recorded", escalationEventId: OTHER_EVENT_ID },
            summary: "blocked 之后不能以用户决定续审。",
          },
        },
        options,
      ),
      rejectedWith("resumption-basis"),
    );
    const resumption = {
      previousDecisionId: blocked.decision.targetReviewDecisionId,
      basis: { kind: "condition-cleared" as const },
      summary: "外部依赖已恢复，可以继续评审。",
    };
    const accepted = await executeImplementationReviewDecisionRequest(
      CODEX_REVIEW_FACADE,
      { ...base, resumption },
      options,
    );
    equal(accepted.status, "committed");
    equal(accepted.target.phase, "accepted");
    equal(accepted.decision.decision, "accept");
    // 该夹具的 Demand 没有测试阶段：实现接受后直接进入完成预检。
    equal(accepted.next.frontier, "demand-completion-preflight");
    const replay = await executeImplementationReviewDecisionRequest(
      CODEX_REVIEW_FACADE,
      { ...base, resumption },
      options,
    );
    equal(replay.status, "idempotent");
    equal(replay.decision.targetReviewDecisionId, accepted.decision.targetReviewDecisionId);
    equal(replay.event.eventId, accepted.event.eventId);
    // 接受后的再决定：修订对得上，但检查投影已经过期。
    await rejects(
      executeImplementationReviewDecisionRequest(
        CODEX_REVIEW_FACADE,
        {
          ...base,
          resumption,
          idempotencyKey: "fixture-decision-after-accept",
          expectedStreamRevision: accepted.event.streamRevision,
        },
        options,
      ),
      rejectedWith("snapshot-stale"),
    );
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("rework 之后再投递、再导入形成新的评审单元并保留历史；escalate 附带升级事件，用户回答前不能续审", async () => {
  const fixture = await createControllerImplementationReviewDecisionServiceFixture();
  try {
    // 全部 passed 的 rework 在记录时就被拒：没有 failed 检查就没有整改项，投递投影也不会接受它（§13.119）。
    const passedOnly = implementationReviewJudgmentWire("rework");
    await rejects(
      decideFixtureImplementation(fixture, {
        ...passedOnly,
        independentChecks: [{ ...passedOnly.independentChecks[0], outcome: "passed" as const }],
        idempotencyKey: "fixture-decision-rework-passed-only",
      }),
      rejectedWith("rework-checks"),
    );
    const rework = await decideFixtureImplementation(fixture, {
      ...implementationReviewJudgmentWire("rework"),
      idempotencyKey: "fixture-decision-rework",
    });
    equal(rework.status, "committed");
    equal(rework.target.phase, "rework-requested");
    equal(rework.decision.callbackLanding, "unlanded");
    equal(rework.next.frontier, "implementation-delivery-planning");

    const redelivered = await deliverFixtureTarget(
      fixture,
      { idempotencyKey: "fixture-prepare-2", expectedStreamRevision: rework.event.streamRevision },
      2,
    );
    equal(redelivered.recorded.outcome.disposition, "accepted");
    // 返工投递已准备、目标已前进之后，重放同一决定仍回到第一次的结果与相位。
    const reworkReplay = await decideFixtureImplementation(fixture, {
      ...implementationReviewJudgmentWire("rework"),
      idempotencyKey: "fixture-decision-rework",
    });
    equal(reworkReplay.status, "idempotent");
    equal(reworkReplay.target.phase, "rework-requested");
    equal(reworkReplay.event.eventId, rework.event.eventId);
    // 导入前窗口声明已易主（例如被更高代际重取）：结果事件照常提交，清理既不否定它也不动别人的声明。
    const heldBefore = (await inspectWorkClaim(fixture.workspaceRoot, fixture.route.windowId))
      .claim;
    if (heldBefore === null) throw new Error("a delivered target must hold the window claim");
    await releaseWorkClaim(fixture.workspaceRoot, heldBefore);
    const foreign = createWorkClaim({
      claimId: createWakeflowDurableId("work-claim"),
      hostId: heldBefore.hostId,
      windowId: heldBefore.windowId,
      bindingId: heldBefore.bindingId,
      holder: { ...heldBefore.holder, generation: heldBefore.holder.generation + 1 },
      claimedAt: at("12:19:00"),
    });
    await takeWorkClaim(fixture.workspaceRoot, foreign);
    const reimported = await importFixtureImplementationResult(fixture, redelivered, {
      idempotencyKey: "fixture-import-2",
      evidence: fixture.evidence,
      reportedAt: at("12:20:00"),
    });
    equal(reimported.status, "committed");
    equal(
      (await inspectWorkClaim(fixture.workspaceRoot, fixture.route.windowId)).claim?.claimId,
      foreign.claimId,
      "a foreign claim survives the import cleanup",
    );
    equal(reimported.callback.permit.generation, 1);
    equal(reimported.callback.callbackId === fixture.imported.callback.callbackId, false);
    const before = await inspectFixtureReview(fixture, fixture.targetTaskId, {
      clock: () => at("12:20:30"),
    });
    equal(before.reviewUnit.status, "reported");
    equal(
      before.reviewUnit.targetCompletion.status,
      "pending",
      "the Stop record of the first result does not count for the second",
    );
    equal(before.reviewUnit.priorReviewHistory.length, 1);
    equal(before.reviewUnit.priorReviewHistory[0]?.decision.decision, "rework");
    equal(allows(before.reviewUnit, "accept"), false);
    await landFixtureTargetCompletion(fixture, fixture.route, at("12:21:00"), "turn-complete");
    const inspection = await inspectFixtureReview(fixture, fixture.targetTaskId, {
      clock: () => at("12:22:00"),
    });
    const completion = inspection.reviewUnit.targetCompletion;
    equal(completion.status, "confirmed");
    if (completion.status === "confirmed") equal(completion.event, "turn-complete");
    equal(allows(inspection.reviewUnit, "accept"), true);

    const escalated = await executeImplementationReviewDecisionRequest(
      CODEX_REVIEW_FACADE,
      fixtureImplementationDecisionRequest(
        fixture,
        inspection,
        reimported.event.streamRevision,
        "escalate",
        "fixture-decision-escalate",
      ),
      decisionOptions(at("12:23:00"), "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2"),
    );
    equal(escalated.status, "committed");
    equal(escalated.target.phase, "escalated");
    equal(escalated.next.owner, "user");
    const escalationEventId = escalated.attached.escalationEventId;
    if (escalationEventId === null) throw new Error("escalate must attach the escalation event");
    const awaiting = await inspectFixtureReview(fixture, fixture.targetTaskId, {
      clock: () => at("12:24:00"),
    });
    equal(awaiting.reviewUnit.status, "escalated");
    deepEqual(plain(awaiting.reviewUnit.resumptionBasis), {
      kind: "decision-recorded",
      escalationEventId,
      answered: false,
    });
    deepEqual(plain(awaiting.reviewUnit.allowedDecisions), []);
    await rejects(
      executeImplementationReviewDecisionRequest(
        CODEX_REVIEW_FACADE,
        {
          ...fixtureImplementationDecisionRequest(
            fixture,
            awaiting,
            await currentFixtureStreamRevision(fixture),
            "accept",
            "fixture-decision-after-escalate",
          ),
          resumption: {
            previousDecisionId: escalated.decision.targetReviewDecisionId,
            basis: { kind: "decision-recorded", escalationEventId },
            summary: "用户尚未回答。",
          },
        },
        decisionOptions(at("12:25:00"), "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3"),
      ),
      rejectedWith("awaiting-decision"),
    );
    await withFixtureDemandRoot(fixture, async (root) => {
      const { aggregate } = await new DemandEventSourcingRepository(root).audit();
      equal(aggregate.state.awaitingDecision?.escalationEventId, escalationEventId);
      const target = aggregate.state.targetTasks.find(
        (entry) => entry.targetTaskId === fixture.targetTaskId,
      );
      equal(target?.phase, "escalated");
      equal(aggregate.streamRevision, escalated.event.streamRevision + 1, "decided + escalation");
    });
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("needs-review 结果在 Controller 把每个锚点绑到本 Demand 托管证据后可直接 accept；绑定缺失或锚点不在包内被拒（§13.121 D7）", async () => {
  const workspace = await createDeliveryWorkspaceFixture();
  try {
    const controllerRoute = await registerFixtureControllerWindow(workspace);
    const delivered = await deliverFixtureTarget(workspace);
    const evidence = await recordFixtureEvidence(workspace);
    const taskPackage = await loadFixtureTaskPackage(
      workspace,
      delivered.envelope.target.taskPackageId,
    );
    const anchorIds = taskPackage.acceptanceAnchors.map((anchor) => anchor.anchorId);
    const needsReview = {
      ...createImplementationTargetResultReportContentFixture(taskPackage, evidence),
      outcome: "needs-review" as const,
      anchorEvidence: [],
      evidenceLocators: [],
    };
    const imported = await importFixtureImplementationResult(workspace, delivered, {
      evidence,
      content: needsReview,
    });
    await landFixtureTargetCompletion(workspace, workspace.route);
    const inspection = await inspectFixtureReview(workspace, workspace.targetTaskId);
    // 本 Demand 已有托管证据：评审单元把 accept 列进允许集，绑定在记录时核对。
    deepEqual(inspection.reviewUnit.allowedDecisions, ["accept", "rework", "blocked", "escalate"]);
    const fixture = Object.freeze({
      ...workspace,
      controllerRoute,
      delivered,
      envelope: delivered.envelope,
      evidence,
      imported,
      inspection,
      reviewSnapshot: await readControllerImplementationReviewDecisionServiceSnapshot(workspace),
      decisionRequest: fixtureImplementationDecisionRequest(
        workspace,
        inspection,
        imported.event.streamRevision,
      ),
    });
    await rejects(
      decideFixtureImplementation(fixture, {
        idempotencyKey: "fixture-accept-needs-review-unbound",
      }),
      rejectedWith("anchor-evidence"),
    );
    await rejects(
      decideFixtureImplementation(fixture, {
        idempotencyKey: "fixture-accept-needs-review-wrong-anchor",
        anchorEvidence: [{ anchorId: "ac-not-in-package", evidenceIds: [evidence.evidenceId] }],
      }),
      rejectedWith("anchor-evidence"),
    );
    const [firstAnchor, ...restAnchors] = anchorIds;
    if (firstAnchor === undefined) throw new Error("fixture task package has no anchors");
    const accepted = await decideFixtureImplementation(fixture, {
      idempotencyKey: "fixture-accept-needs-review-bound",
      anchorEvidence: [
        { anchorId: firstAnchor, evidenceIds: [evidence.evidenceId] as [string] },
        ...restAnchors.map((anchorId) => ({
          anchorId,
          evidenceIds: [evidence.evidenceId] as [string],
        })),
      ],
    });
    equal(accepted.status, "committed");
    equal(accepted.decision.decision, "accept");
    equal(accepted.target.phase, "accepted");
  } finally {
    await cleanupDeliveryWorkspaceFixture(workspace);
  }
});

test("测试合同步骤的 given/when/then 超过 8192 字符（至 16384）时，评审检查仍接纳并原样投影", async () => {
  const fixture = await createTestTaskPlanningWorkspaceFixture();
  try {
    const long = (letter: string) => letter.repeat(16_384);
    const contract = fixture.testTaskRequest.taskPackage.testContract;
    const [first, ...rest] = contract.steps;
    if (first === undefined) throw new Error("Expected a test contract step.");
    // biome-ignore lint/suspicious/noThenProperty: Given/When/Then 合同步骤字段（§13.85 D1）
    const longStep = { ...first, given: long("g"), when: long("w"), then: long("t") };
    const planned = await planFixtureTestTask(fixture, 7, {
      taskPackage: { testContract: { ...contract, steps: [longStep, ...rest] } },
    });
    const testRoute = await registerFixtureWindowRoute(fixture, planned.targetTask.windowId, {
      value: "codex-host-thread:long-step-fixture",
      uuid: "a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5",
      observedAt: at("12:30:00"),
      registeredAt: at("12:29:00"),
    });
    const delivery = Object.freeze({
      ...fixture,
      testTargetTaskId: planned.targetTask.targetTaskId,
      testTaskPackageId: planned.targetTask.taskPackageId,
      testRoute,
    });
    const delivered = await deliverFixtureTestTarget(delivery);
    await importFixtureTestResult(delivery, delivered);
    await landFixtureTargetCompletion(delivery, testRoute, TEST_TARGET_STOPPED_AT);
    const inspection = await inspectFixtureReview(delivery, delivery.testTargetTaskId, {
      clock: () => TEST_REVIEW_INSPECTED_AT,
    });
    const step = inspection.reviewUnit.testSteps?.find((entry) => entry.stepId === "ts-1");
    equal(step?.given, long("g"));
    equal(step?.when, long("w"));
    equal(step?.expected, long("t"));
  } finally {
    await cleanupTestTaskPlanningWorkspaceFixture(fixture);
  }
});

/** summary 档的任务包；拿到 full 档说明服务没有按 `detail` 换包。 */
function summaryTaskPackage(result: Readonly<TargetResultReviewInspectionResult>) {
  const taskPackage = result.reviewUnit.taskPackage;
  if (!("detail" in taskPackage)) {
    throw new Error("expected a summary task package");
  }
  return taskPackage;
}

/** full 档测试任务包的合同步骤 id；summary 的 `testStepIds` 必须与之一致。 */
function fullTestStepIds(result: Readonly<TargetResultReviewInspectionResult>): readonly string[] {
  const taskPackage = result.reviewUnit.taskPackage;
  if (!("testContract" in taskPackage)) {
    throw new Error("expected a full test task package");
  }
  return taskPackage.testContract.steps.map((step) => step.stepId);
}

/** 去掉随 `detail` 变化的两处（顶层 `detail` 与任务包）后的结果，用来证明其余字段逐字相同。 */
function detailInvariantPart(result: Readonly<TargetResultReviewInspectionResult>) {
  const { detail: _detail, reviewUnit, ...rest } = result;
  const { taskPackage: _taskPackage, ...unit } = reviewUnit;
  return plain({ ...rest, reviewUnit: unit });
}

test("inspect detail=summary：实现目标的任务包收成身份、目标与锚点，digest 与其余字段同 full，体积更小", async () => {
  const fixture = await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const full = fixture.inspection;
    equal(full.detail, "full");
    equal("detail" in full.reviewUnit.taskPackage, false);
    const summary = await inspectFixtureReview(
      fixture,
      fixture.targetTaskId,
      { clock: () => REVIEW_INSPECTED_AT },
      { detail: "summary" },
    );
    equal(summary.detail, "summary");
    const fullPackage = full.reviewUnit.taskPackage;
    deepEqual(plain(summaryTaskPackage(summary)), {
      detail: "summary",
      taskPackageId: fullPackage.taskPackageId,
      workType: "implementation",
      objective: fullPackage.objective,
      acceptanceAnchors: fullPackage.acceptanceAnchors.map(({ anchorId, claim }) => ({
        anchorId,
        claim,
      })),
      testStepIds: null,
    });
    equal(summary.snapshotDigest, full.snapshotDigest);
    equal(summary.reviewUnit.reviewUnitDigest, full.reviewUnit.reviewUnitDigest);
    deepEqual(detailInvariantPart(summary), detailInvariantPart(full));
    ok(JSON.stringify(summary).length < JSON.stringify(full).length);
    const explicitFull = await inspectFixtureReview(
      fixture,
      fixture.targetTaskId,
      { clock: () => REVIEW_INSPECTED_AT },
      { detail: "full" },
    );
    deepEqual(plain(explicitFull), plain(full));
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

test("inspect detail=summary：测试目标的任务包带合同步骤 id，逐步表与允许集合不变", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  try {
    const full = fixture.testInspection;
    const summary = await inspectFixtureReview(
      fixture,
      fixture.testTargetTaskId,
      { clock: () => TEST_REVIEW_INSPECTED_AT },
      { detail: "summary" },
    );
    const taskPackage = summaryTaskPackage(summary);
    equal(taskPackage.workType, "test");
    deepEqual(taskPackage.testStepIds, fullTestStepIds(full));
    ok(taskPackage.testStepIds !== null && taskPackage.testStepIds.length > 0);
    deepEqual(detailInvariantPart(summary), detailInvariantPart(full));
    ok(JSON.stringify(summary).length < JSON.stringify(full).length);
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});
