import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";

import { executeRearmDeliveryRequest } from "../../../src/capabilities/delivery/service.js";
import { executeDemandContinuationRequest } from "../../../src/capabilities/demand/lifecycle.js";
import type { TestReviewDecisionRequest } from "../../../src/capabilities/result-review/contract.js";
import {
  executeImplementationReviewDecisionRequest,
  executeTestReviewDecisionRequest,
  type ExecuteResultReviewOptions,
} from "../../../src/capabilities/result-review/service.js";
import { createWakeflowDurableId } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant, type UtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import {
  createWorkClaim,
  inspectWorkClaim,
  releaseWorkClaim,
  takeWorkClaim,
} from "../../../src/kernel/work-claims.js";
import {
  CODEX_DELIVERY_FACADE,
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  deliverFixtureTarget,
  landFixturePrompt,
  loadFixtureDeliveryEnvelope,
  prepareFixtureDelivery,
  recordFixtureDeliveryOutcome,
  withFixtureDemandRoot,
} from "../../governance/delivery/delivery-workspace.fixture.js";
import {
  cleanupTestDeliveryWorkspaceFixture,
  createTestDeliveryWorkspaceFixture,
  deliverFixtureTestTarget,
  type TestDeliveryWorkspaceFixture,
} from "../../governance/delivery/test-delivery-workspace.fixture.js";
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
  readControllerImplementationReviewDecisionServiceSnapshot,
  recordFixtureEvidence,
  registerFixtureControllerWindow,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import { implementationReviewJudgmentWire } from "../../governance/review/controller-implementation-review-decision.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "../../governance/result/implementation-target-result-report.fixture.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
  decideFixtureTest,
  failingStep,
  fixtureTestDecisionRequest,
  importFixtureTestResult,
  passingStep,
  TEST_REVIEW_DECIDED_AT,
  TEST_REVIEW_INSPECTED_AT,
  TEST_TARGET_STOPPED_AT,
} from "../../governance/review/controller-test-review-decision-service.fixture.js";

/**
 * result-review 切片效果（§13.87 D1–D8）：导入重放与二次导入；回调只在静默后重发、重放幂等、
 * 三次到顶、落地后不再重发；blocked/escalated 之后只有带 resumption 的再决定回到同一结果；
 * 测试评审按逐步分类路由，重跑只带失败子集并沿用基线，product-defect 升级在同一提交追加修复授权。
 */

const OTHER_DECISION_ID = "target-review-decision_11111111-1111-4111-8111-111111111111";
const OTHER_EVENT_ID = "demand-event_22222222-2222-4222-8222-222222222222";
const STRANGER_CLAIM_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const SILENCE_PLUS_ONE_MINUTE = 11 * 60_000;

/** 公开结果是冻结的无原型对象；结构比较前转成普通 JSON 值。 */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function allows(
  unit: Readonly<{ readonly allowedDecisions: readonly string[] }>,
  decision: string,
): boolean {
  return unit.allowedDecisions.includes(decision);
}

type TestEscalationWire = NonNullable<TestReviewDecisionRequest["escalation"]>;
type TestJudgmentWire = Pick<
  TestReviewDecisionRequest,
  "decision" | "assessment" | "independentChecks"
>;

function rejectedWith(reason: string, code = "precondition-failed") {
  return (error: unknown) =>
    isWakeflowError(error) && error.code === code && error.reason === reason;
}

function at(time: string): UtcInstant {
  return parseUtcInstant(`2026-08-29T${time}.000Z`);
}

function after(instant: string, milliseconds: number): UtcInstant {
  return parseUtcInstant(new Date(Date.parse(instant) + milliseconds).toISOString());
}

function decisionOptions(clock: UtcInstant, uuid: string): ExecuteResultReviewOptions {
  return { clock: () => clock, uuidFactory: () => uuid };
}

async function rearmCallback(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
  callbackId: string,
  idempotencyKey: string,
  expectedStreamRevision: number,
  clock: UtcInstant,
) {
  return executeRearmDeliveryRequest(
    CODEX_DELIVERY_FACADE,
    {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey,
      expectedStreamRevision,
      deliveryId: callbackId,
    },
    { clock: () => clock },
  );
}

test("import 重放幂等、已回报目标拒绝二次导入；回调只在静默后重发，重放幂等，第四代之后到顶", async () => {
  const fixture = await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const imported = fixture.imported;
    equal(imported.status, "committed");
    equal(imported.callback.permit.generation, 1);
    equal(imported.callback.permit.hostAction.windowId, fixture.controllerRoute.windowId);
    equal(imported.next.frontier, "implementation-result-review");
    const replayed = await importFixtureImplementationResult(fixture, fixture.delivered, {
      evidence: fixture.evidence,
      expectedStreamRevision: imported.event.streamRevision - 1,
    });
    equal(replayed.status, "idempotent");
    equal(replayed.callback.callbackId, imported.callback.callbackId);
    equal(replayed.result.resultDigest, imported.result.resultDigest);
    await rejects(
      importFixtureImplementationResult(fixture, fixture.delivered, {
        idempotencyKey: "fixture-import-again",
        evidence: fixture.evidence,
      }),
      rejectedWith("target-phase"),
    );

    const callbackId = imported.callback.callbackId;
    let revision = imported.event.streamRevision;
    await rejects(
      rearmCallback(fixture, callbackId, "fixture-callback-rearm-early", revision, at("12:15:00")),
      rejectedWith("callback-pending"),
    );
    let previousIssuedAt = imported.callback.permit.issuedAt;
    for (const generation of [2, 3, 4]) {
      const clock = after(previousIssuedAt, SILENCE_PLUS_ONE_MINUTE);
      const key = `fixture-callback-rearm-${generation}`;
      const reissued = await rearmCallback(fixture, callbackId, key, revision, clock);
      equal(reissued.status, "rearmed");
      equal(reissued.rearm.kind, "callback");
      equal(reissued.rearm.previousGeneration, generation - 1);
      equal(reissued.rearm.generation, generation);
      equal(reissued.permit.fence, null);
      equal(reissued.permit.prompt, imported.callback.permit.prompt);
      equal(reissued.permit.hostAction.windowId, fixture.controllerRoute.windowId);
      equal(reissued.permit.issuedAt, clock);
      equal(reissued.delivery.deliveryId, callbackId);
      equal(reissued.delivery.workType, "callback");
      equal(reissued.delivery.generation, generation);
      equal(reissued.delivery.envelopeDigest, imported.result.resultDigest);
      equal(reissued.delivery.phase, "result-reported");
      equal(reissued.event.streamRevision, revision + 1);
      equal(
        (await inspectWorkClaim(fixture.workspaceRoot, fixture.route.windowId)).status,
        "absent",
        "a callback reissue never takes a work claim",
      );
      // 重发的重放幂等与"检查投影跟到当前代际"都是逐代同一条路径：在第一次重发上钉住，
      // 其余两代只驱动到第四代的上限。第四代的代际与静默状态由循环后的 `silent` 检查钉住。
      if (generation === 2) {
        const replay = await rearmCallback(fixture, callbackId, key, revision, clock);
        equal(replay.status, "idempotent");
        equal(replay.rearm.generation, generation);
        equal(replay.event.eventId, reissued.event.eventId);
        const inspection = await inspectFixtureReview(fixture, fixture.targetTaskId, {
          clock: () => clock,
        });
        equal(inspection.reviewUnit.callback.generation, generation);
        equal(inspection.reviewUnit.callback.issuedAt, reissued.permit.issuedAt);
        equal(inspection.reviewUnit.callback.status, "pending");
      }
      revision = reissued.event.streamRevision;
      previousIssuedAt = reissued.permit.issuedAt;
    }
    const exhausted = after(previousIssuedAt, SILENCE_PLUS_ONE_MINUTE);
    await rejects(
      rearmCallback(fixture, callbackId, "fixture-callback-rearm-5", revision, exhausted),
      rejectedWith("callback-limit"),
    );
    const silent = await inspectFixtureReview(fixture, fixture.targetTaskId, {
      clock: () => exhausted,
    });
    equal(silent.reviewUnit.callback.status, "silent");
    equal(silent.reviewUnit.callback.generation, 4);
    equal(allows(silent.reviewUnit, "accept"), true);
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

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

test("测试评审：全部通过只允许 accept 与 escalate；needs-decision 升级附带 Demand 升级事件，用户回答后带 resumption 的 accept 进入 test-accepted", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  try {
    const unit = fixture.testInspection.reviewUnit;
    equal(unit.workType, "test");
    equal(unit.testSteps?.length, fixture.testStepIds.length);
    equal(
      unit.testSteps?.every((step) => step.baseline === null && step.verdict === "pass"),
      true,
    );
    deepEqual(plain(unit.attemptScope), { ordinal: 1, stepIds: null });
    deepEqual(plain(unit.allowedDecisions), ["accept", "escalate"]);
    await rejects(
      decideFixtureTest(fixture, {
        decision: "request-another-attempt",
        stepIds: ["ts-1"],
        assessment: { conclusion: "inconclusive", evidenceSufficiency: "insufficient" },
        independentChecks: [
          {
            checkId: "controller-test-evidence",
            method: "复核逐步证据。",
            outcome: "inconclusive",
            observation: "没有失败步骤可重跑。",
          },
        ],
      }),
      rejectedWith("no-failed-step"),
    );
    await rejects(
      decideFixtureTest(fixture, {
        decision: "blocked",
        assessment: { conclusion: "inconclusive", evidenceSufficiency: "insufficient" },
        blockingReasons: ["环境事实尚未确认。"],
      }),
      rejectedWith("blocked-basis"),
    );

    const escalation: TestEscalationWire = {
      classification: "needs-decision",
      userDecision: {
        issue: "测试全部通过，但需求包对结果留存期限的表述需要用户裁定。",
        requirementRefs: [],
        evidence: [],
        options: [
          { option: "按当前结果接受。", impact: "不再补充测试。" },
          { option: "补充一轮留存期限测试。", impact: "需要新的测试合同。" },
        ],
        recommendation: "建议按当前结果接受。",
      },
    };
    const escalated = await decideFixtureTest(fixture, {
      decision: "escalate",
      assessment: { conclusion: "inconclusive", evidenceSufficiency: "sufficient" },
      escalation,
      idempotencyKey: "fixture-test-decision-escalate",
    });
    equal(escalated.status, "committed");
    equal(escalated.target.phase, "test-escalated");
    equal(escalated.attached.productDefectRemediationId, null);
    const escalationEventId = escalated.attached.escalationEventId;
    if (escalationEventId === null) throw new Error("needs-decision must attach the escalation");
    const waiting = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
      clock: () => at("12:38:00"),
    });
    equal(waiting.reviewUnit.status, "escalated");
    deepEqual(plain(waiting.reviewUnit.allowedDecisions), []);
    deepEqual(plain(waiting.reviewUnit.resumptionBasis), {
      kind: "decision-recorded",
      escalationEventId,
      answered: false,
    });

    const decision = { text: "按当前结果接受。", chosenOption: "按当前结果接受。" };
    const preview = await executeDemandContinuationRequest({
      root: fixture.workspacePath,
      mode: "preview",
      demandId: fixture.demandId,
      action: "record-decision",
      decision,
    });
    if (preview.kind !== "WakeflowDemandContinuationPreview" || preview.planDigest === null) {
      throw new Error("Expected a ready decision plan.");
    }
    const recorded = await executeDemandContinuationRequest({
      root: fixture.workspacePath,
      mode: "apply",
      demandId: fixture.demandId,
      action: "record-decision",
      decision,
      planDigest: preview.planDigest,
    });
    if (recorded.kind !== "WakeflowDemandContinuationMutation")
      throw new Error("Expected a mutation.");
    equal(recorded.disposition, "decision-recorded");
    equal(recorded.next.frontier, "test-result-review");
    const answered = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
      clock: () => at("12:39:00"),
    });
    deepEqual(plain(answered.reviewUnit.resumptionBasis), {
      kind: "decision-recorded",
      escalationEventId,
      answered: true,
    });
    deepEqual(plain(answered.reviewUnit.allowedDecisions), ["accept", "escalate"]);
    const accepted = await executeTestReviewDecisionRequest(
      CODEX_REVIEW_FACADE,
      {
        ...fixtureTestDecisionRequest(
          fixture,
          answered,
          await currentFixtureStreamRevision(fixture),
          "fixture-test-decision-resumed",
        ),
        resumption: {
          previousDecisionId: escalated.decision.targetReviewDecisionId,
          basis: { kind: "decision-recorded", escalationEventId },
          summary: "用户已回答：按当前结果接受。",
        },
      },
      decisionOptions(at("12:40:00"), "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1"),
    );
    equal(accepted.status, "committed");
    equal(accepted.target.phase, "test-accepted");
    equal(accepted.target.attemptCount, 1);
    equal(accepted.next.frontier, "demand-completion-preflight");
  } finally {
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});

function contractSteps(fixture: Readonly<TestDeliveryWorkspaceFixture>): readonly [string, string] {
  const [first, second] = fixture.testStepIds;
  if (first === undefined || second === undefined) throw new Error("Expected two contract steps.");
  return [first, second];
}

function testDecision(request: Readonly<TestReviewDecisionRequest>, uuid: string) {
  return executeTestReviewDecisionRequest(
    CODEX_REVIEW_FACADE,
    request,
    decisionOptions(TEST_REVIEW_DECIDED_AT, uuid),
  );
}

test("flaky 失败步骤只允许 request-another-attempt 与 escalate；重跑尝试只带失败子集，范围外步骤沿用上一轮通过基线", async () => {
  const fixture = await createTestDeliveryWorkspaceFixture({ maxAttempts: 2 });
  try {
    const [first, second] = contractSteps(fixture);
    const delivered = await deliverFixtureTestTarget(fixture);
    const imported = await importFixtureTestResult(fixture, delivered, {
      steps: [passingStep(first, fixture.evidence), failingStep(second, fixture.evidence, "flaky")],
    });
    equal(imported.status, "committed");
    await landFixtureTargetCompletion(fixture, fixture.testRoute, TEST_TARGET_STOPPED_AT);
    const inspection = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
      clock: () => TEST_REVIEW_INSPECTED_AT,
    });
    deepEqual(plain(inspection.reviewUnit.allowedDecisions), [
      "request-another-attempt",
      "escalate",
    ]);
    equal(inspection.reviewUnit.testSteps?.[1]?.failure?.classification, "flaky");
    const revision = imported.event.streamRevision;
    const rerunJudgment: TestJudgmentWire = {
      decision: "request-another-attempt",
      assessment: { conclusion: "inconclusive", evidenceSufficiency: "insufficient" },
      independentChecks: [
        {
          checkId: "controller-flaky-check",
          method: "重读失败步骤证据并对照合同 then。",
          outcome: "inconclusive",
          observation: "失败与产品行为无关，需重跑确认。",
        },
      ],
    };
    await rejects(
      testDecision(
        fixtureTestDecisionRequest(fixture, inspection, revision, "fixture-test-accept-flaky"),
        "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0",
      ),
      rejectedWith("verdict"),
    );
    await rejects(
      testDecision(
        {
          ...fixtureTestDecisionRequest(fixture, inspection, revision, "fixture-test-rerun-scope"),
          ...rerunJudgment,
          stepIds: [first],
        },
        "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0",
      ),
      rejectedWith("step-scope"),
    );
    const rerun = await testDecision(
      {
        ...fixtureTestDecisionRequest(fixture, inspection, revision, "fixture-test-rerun"),
        ...rerunJudgment,
        stepIds: [second],
      },
      "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
    );
    equal(rerun.status, "committed");
    equal(rerun.target.phase, "test-another-attempt-requested");
    equal(rerun.target.attemptCount, 1);
    equal(rerun.next.frontier, "test-delivery-rerun-planning");

    const redelivered = await deliverFixtureTestTarget(
      fixture,
      { expectedStreamRevision: rerun.event.streamRevision },
      2,
    );
    const envelope = redelivered.envelope;
    if (envelope.workType !== "test" || envelope.attempt.mode !== "rerun") {
      throw new Error("Expected a rerun Test delivery envelope.");
    }
    equal(envelope.attempt.ordinal, 2);
    deepEqual(plain(envelope.attempt.rerunSource.stepIds), [second]);
    equal(
      envelope.attempt.rerunSource.reviewDecision.targetReviewDecisionId,
      rerun.decision.targetReviewDecisionId,
    );
    const reimported = await importFixtureTestResult(fixture, redelivered, {
      idempotencyKey: "fixture-test-import-2",
      steps: [passingStep(second, fixture.evidence)],
      reportedAt: at("12:44:00"),
    });
    equal(reimported.status, "committed");
    await landFixtureTargetCompletion(fixture, fixture.testRoute, at("12:45:00"));
    const rerunInspection = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
      clock: () => at("12:46:00"),
    });
    deepEqual(plain(rerunInspection.reviewUnit.attemptScope), { ordinal: 2, stepIds: [second] });
    const [firstView, secondView] = rerunInspection.reviewUnit.testSteps ?? [];
    equal(firstView?.observed, null);
    equal(firstView?.verdict, null);
    equal(firstView?.baseline?.attemptOrdinal, 1);
    equal(firstView?.baseline?.targetTaskId, fixture.testTargetTaskId);
    equal(secondView?.verdict, "pass");
    equal(secondView?.baseline, null);
    equal(rerunInspection.reviewUnit.priorReviewHistory.length, 1);
    deepEqual(plain(rerunInspection.reviewUnit.allowedDecisions), ["accept", "escalate"]);
    const rerunRevision = reimported.event.streamRevision;
    await rejects(
      testDecision(
        {
          ...fixtureTestDecisionRequest(
            fixture,
            rerunInspection,
            rerunRevision,
            "fixture-test-rerun-again",
          ),
          ...rerunJudgment,
          stepIds: [second],
        },
        "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2",
      ),
      rejectedWith("no-failed-step"),
    );
    const accepted = await testDecision(
      fixtureTestDecisionRequest(fixture, rerunInspection, rerunRevision, "fixture-test-accept-2"),
      "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
    );
    equal(accepted.status, "committed");
    equal(accepted.target.phase, "test-accepted");
    equal(accepted.target.attemptCount, 2);
  } finally {
    await cleanupTestDeliveryWorkspaceFixture(fixture);
  }
});

test("product-defect 失败步骤只允许 escalate；escalate{product-defect} 在同一提交追加修复授权并把实现目标送回返工", async () => {
  const fixture = await createTestDeliveryWorkspaceFixture({ maxAttempts: 2 });
  try {
    const [first, second] = contractSteps(fixture);
    const delivered = await deliverFixtureTestTarget(fixture);
    const imported = await importFixtureTestResult(fixture, delivered, {
      steps: [
        passingStep(first, fixture.evidence),
        failingStep(second, fixture.evidence, "product-defect"),
      ],
    });
    await landFixtureTargetCompletion(fixture, fixture.testRoute, TEST_TARGET_STOPPED_AT);
    const inspection = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
      clock: () => TEST_REVIEW_INSPECTED_AT,
    });
    deepEqual(plain(inspection.reviewUnit.allowedDecisions), ["escalate"]);
    equal(inspection.reviewUnit.testSteps?.[1]?.failure?.classification, "product-defect");
    const revision = imported.event.streamRevision;
    const base = fixtureTestDecisionRequest(fixture, inspection, revision, "fixture-test-escalate");
    await rejects(
      testDecision(
        {
          ...base,
          decision: "request-another-attempt",
          stepIds: [second],
          assessment: { conclusion: "inconclusive", evidenceSufficiency: "insufficient" },
          independentChecks: [
            {
              checkId: "controller-rerun",
              method: "复核失败步骤。",
              outcome: "inconclusive",
              observation: "希望重跑。",
            },
          ],
        },
        "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0",
      ),
      rejectedWith("classification"),
    );
    const escalateJudgment: TestJudgmentWire = {
      decision: "escalate",
      assessment: { conclusion: "defect-observed", evidenceSufficiency: "sufficient" },
      independentChecks: [
        {
          checkId: "controller-defect-check",
          method: "按合同 then 复现失败步骤。",
          outcome: "failed",
          observation: "入口在真实环境返回了错误状态，与实现有关。",
        },
      ],
    };
    const remediation = (failedStepIds: [string]): TestEscalationWire => ({
      classification: "product-defect",
      remediation: {
        affectedTargets: [
          {
            targetTaskId: fixture.targetTaskId,
            failedStepIds,
            correctionObjective: "修复入口在真实环境下的返回状态。",
          },
        ],
        authorizationRationale: "测试证据指向实现缺陷，授权按失败步骤返工。",
      },
    });
    await rejects(
      testDecision(
        { ...base, ...escalateJudgment, escalation: remediation([first]) },
        "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0",
      ),
      rejectedWith("remediation-step"),
    );
    const escalated = await testDecision(
      { ...base, ...escalateJudgment, escalation: remediation([second]) },
      "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
    );
    equal(escalated.status, "committed");
    equal(escalated.target.phase, "test-product-defect");
    equal(escalated.attached.escalationEventId, null);
    const remediationId = escalated.attached.productDefectRemediationId;
    equal(typeof remediationId, "string");
    equal(escalated.next.frontier, "implementation-delivery-planning");
    const replay = await testDecision(
      { ...base, ...escalateJudgment, escalation: remediation([second]) },
      "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
    );
    equal(replay.status, "idempotent");
    equal(replay.attached.productDefectRemediationId, remediationId);
    await withFixtureDemandRoot(fixture, async (root) => {
      const repository = new DemandEventSourcingRepository(root);
      const { aggregate } = await repository.audit();
      equal(
        aggregate.streamRevision,
        escalated.event.streamRevision + 1,
        "two events in one commit",
      );
      equal(aggregate.state.awaitingDecision, undefined);
      const implementation = aggregate.state.targetTasks.find(
        (entry) => entry.targetTaskId === fixture.targetTaskId,
      );
      equal(implementation?.phase, "product-defect-rework-requested");
      if (implementation?.phase === "product-defect-rework-requested") {
        equal(implementation.productDefectRemediation.productDefectRemediationId, remediationId);
        deepEqual([...implementation.productDefectRemediation.failedStepIds], [second]);
        equal(
          implementation.productDefectRemediation.testReviewDecisionId,
          escalated.decision.targetReviewDecisionId,
        );
      }
      const commit = await repository.findCommitById(escalated.commit.commitId);
      equal(commit?.events.length, 2);
      equal(commit?.events[0]?.eventType, "review.target-result-decided");
      equal(commit?.events[1]?.eventType, "review.product-defect-remediation-authorized");
    });
  } finally {
    await cleanupTestDeliveryWorkspaceFixture(fixture);
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

test("重新武装不重渲染 prompt：目标用 prompt 里第一代的 claimDigest 导入仍被接受，陌生摘要被拒", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    await registerFixtureControllerWindow(fixture);
    const prepared = await prepareFixtureDelivery(fixture);
    const rejected = await recordFixtureDeliveryOutcome(fixture, prepared, {
      attempt: { status: "failed-before-send" },
      readback: { status: "unavailable" },
    });
    const rearmed = await rearmCallback(
      fixture,
      prepared.delivery.deliveryId,
      "fixture-rearm-2",
      rejected.event.streamRevision,
      at("12:07:00"),
    );
    const fence = rearmed.permit.fence;
    if (fence === null) throw new Error("Expected a target rearm fence.");
    equal(fence.claimDigest === prepared.permit.fence.claimDigest, false);
    const landed = await landFixturePrompt(
      fixture,
      fixture.route,
      prepared.permit.prompt,
      at("12:07:30"),
    );
    const recorded = await recordFixtureDeliveryOutcome(
      fixture,
      {
        ...prepared,
        permit: { ...rearmed.permit, fence },
        event: rearmed.event,
        delivery: { ...prepared.delivery, generation: rearmed.delivery.generation },
      },
      { idempotencyKey: "fixture-outcome-accepted-2", observedAt: at("12:08:00") },
      { clock: () => at("12:08:00") },
    );
    equal(recorded.outcome.disposition, "accepted");
    const envelope = await loadFixtureDeliveryEnvelope(fixture, prepared.delivery.deliveryId);
    const delivered = { prepared, landed, recorded, envelope };
    const evidence = await recordFixtureEvidence(fixture);
    await rejects(
      importFixtureImplementationResult(
        fixture,
        {
          ...delivered,
          prepared: {
            ...prepared,
            permit: {
              ...prepared.permit,
              fence: { ...prepared.permit.fence, claimDigest: STRANGER_CLAIM_DIGEST },
            },
          },
        },
        { idempotencyKey: "fixture-import-stranger", evidence },
      ),
      rejectedWith("fence-mismatch"),
    );
    const imported = await importFixtureImplementationResult(fixture, delivered, { evidence });
    equal(imported.status, "committed");
    equal(imported.result.delivery.generation, 2);
    equal(imported.result.delivery.fence.claimDigest, fence.claimDigest);
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

/** 发送前失败，再 rearm 三次仍失败：返回第四代的拒绝结局，此后只能换新信封。 */
async function exhaustRearms(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
  prepared: Awaited<ReturnType<typeof prepareFixtureDelivery>>,
  prefix: string,
) {
  const failed = {
    attempt: { status: "failed-before-send" as const },
    readback: { status: "unavailable" as const },
  };
  let rejected = await recordFixtureDeliveryOutcome(fixture, prepared, {
    ...failed,
    idempotencyKey: `${prefix}-outcome-1`,
  });
  for (const generation of [2, 3, 4]) {
    const rearmed = await rearmCallback(
      fixture,
      prepared.delivery.deliveryId,
      `${prefix}-rearm-${generation}`,
      rejected.event.streamRevision,
      at("12:20:00"),
    );
    const fence = rearmed.permit.fence;
    if (fence === null) throw new Error("Expected a target rearm fence.");
    rejected = await recordFixtureDeliveryOutcome(
      fixture,
      {
        ...prepared,
        permit: { ...rearmed.permit, fence },
        event: rearmed.event,
        delivery: { ...prepared.delivery, generation },
      },
      { ...failed, idempotencyKey: `${prefix}-outcome-${generation}` },
    );
  }
  return rejected;
}

test("rearm 用尽的返工投递换新信封：前沿回到准备，新信封原样带上被拒信封的返工依据", async () => {
  const fixture = await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const rework = await decideFixtureImplementation(fixture, {
      ...implementationReviewJudgmentWire("rework"),
      idempotencyKey: "fixture-decision-rework",
    });
    const prepared = await prepareFixtureDelivery(fixture, {
      idempotencyKey: "fixture-prepare-rework",
      expectedStreamRevision: rework.event.streamRevision,
    });
    const rejected = await exhaustRearms(fixture, prepared, "fixture-rework");
    equal(rejected.target.phase, "host-effect-rejected");
    equal(rejected.next.frontier, "implementation-delivery-planning");
    const reprepared = await prepareFixtureDelivery(fixture, {
      idempotencyKey: "fixture-prepare-rework-again",
      expectedStreamRevision: rejected.event.streamRevision,
    });
    equal(reprepared.status, "committed");
    const before = await loadFixtureDeliveryEnvelope(fixture, prepared.delivery.deliveryId);
    const after = await loadFixtureDeliveryEnvelope(fixture, reprepared.delivery.deliveryId);
    if (before.workType !== "implementation" || after.workType !== "implementation") {
      throw new Error("Expected implementation envelopes.");
    }
    equal(before.rework === undefined, false);
    deepEqual(plain(after.rework), plain(before.rework));
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("rearm 用尽的测试投递换新信封：前沿回到准备，重发同一次尝试而不是新增尝试", async () => {
  const fixture = await createTestDeliveryWorkspaceFixture();
  try {
    const target = {
      workspacePath: fixture.workspacePath,
      demandId: fixture.demandId,
      targetTaskId: fixture.testTargetTaskId,
    };
    const prepared = await prepareFixtureDelivery(target, {
      expectedStreamRevision: 8,
      idempotencyKey: "fixture-test-prepare-1",
    });
    const rejected = await exhaustRearms(fixture, prepared, "fixture-test");
    equal(rejected.target.phase, "test-host-effect-rejected");
    equal(rejected.next.frontier, "test-delivery-planning");
    const reprepared = await prepareFixtureDelivery(target, {
      expectedStreamRevision: rejected.event.streamRevision,
      idempotencyKey: "fixture-test-prepare-again",
    });
    equal(reprepared.status, "committed");
    equal(reprepared.delivery.phase, "test-delivery-prepared");
    const before = await loadFixtureDeliveryEnvelope(fixture, prepared.delivery.deliveryId);
    const after = await loadFixtureDeliveryEnvelope(fixture, reprepared.delivery.deliveryId);
    if (before.workType !== "test" || after.workType !== "test") {
      throw new Error("Expected test envelopes.");
    }
    equal(after.attempt.testAttemptId, before.attempt.testAttemptId);
  } finally {
    await cleanupTestDeliveryWorkspaceFixture(fixture);
  }
});
