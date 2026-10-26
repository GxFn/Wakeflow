import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";

import { executeDemandContinuationRequest } from "../../../src/capabilities/demand/lifecycle.js";
import type { TargetResultReviewInspectionResult } from "../../../src/capabilities/result-review/contract.js";
import {
  type ExecuteResultReviewOptions,
  executeImplementationReviewDecisionRequest,
} from "../../../src/capabilities/result-review/service.js";
import { parseUtcInstant, type UtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DEMAND_REWORK_ESCALATION_THRESHOLD } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { deliverFixtureTarget } from "../../governance/delivery/delivery-workspace.fixture.js";
import { implementationReviewJudgmentWire } from "../../governance/review/controller-implementation-review-decision.fixture.js";
import {
  CODEX_REVIEW_FACADE,
  cleanupControllerImplementationReviewDecisionServiceFixture,
  type ControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
  currentFixtureStreamRevision,
  decideFixtureImplementation,
  fixtureImplementationDecisionRequest,
  importFixtureImplementationResult,
  inspectFixtureReview,
  landFixtureTargetCompletion,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * result-review 切片效果（W21 修法 B，CR-S3）：同一实现目标的第三次 rework 被 `rework-brake` 拒绝，
 * 不再"先记录 rework 再附带升级"；检查投影的允许集去掉 rework；Controller 改记 escalate 交用户决定，
 * 用户回答后带 resumption 的 accept 可达，rework 也放行一次。级别 2（能力）。
 */

/** 公开结果是冻结的无原型对象；结构比较前转成普通 JSON 值。 */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function rejectedWith(reason: string) {
  return (error: unknown) =>
    isWakeflowError(error) && error.code === "precondition-failed" && error.reason === reason;
}

function at(time: string): UtcInstant {
  return parseUtcInstant(`2026-08-29T${time}.000Z`);
}

function decisionOptions(clock: UtcInstant, uuid: string): ExecuteResultReviewOptions {
  return { clock: () => clock, uuidFactory: () => uuid };
}

/** 一轮返工的往返：返工投递 → 再导入（沿用已登记的受管证据）→ 目标 Stop 记录 → 检查投影。 */
async function reworkRound(
  fixture: Readonly<ControllerImplementationReviewDecisionServiceFixture>,
  round: number,
  expectedStreamRevision: number,
  times: Readonly<{ reportedAt: string; stoppedAt: string; inspectedAt: string }>,
): Promise<
  Readonly<{ inspection: Readonly<TargetResultReviewInspectionResult>; streamRevision: number }>
> {
  const redelivered = await deliverFixtureTarget(
    fixture,
    { idempotencyKey: `brake-prepare-${round}`, expectedStreamRevision },
    round,
  );
  equal(redelivered.recorded.outcome.disposition, "accepted");
  const reimported = await importFixtureImplementationResult(fixture, redelivered, {
    idempotencyKey: `brake-import-${round}`,
    evidence: fixture.evidence,
    reportedAt: at(times.reportedAt),
  });
  equal(reimported.status, "committed");
  await landFixtureTargetCompletion(fixture, fixture.route, at(times.stoppedAt));
  const inspection = await inspectFixtureReview(fixture, fixture.targetTaskId, {
    clock: () => at(times.inspectedAt),
  });
  equal(inspection.reviewUnit.status, "reported");
  equal(inspection.reviewUnit.priorReviewHistory.length, round - 1);
  return Object.freeze({ inspection, streamRevision: reimported.event.streamRevision });
}

test("第三次 rework 被 rework-brake 拒绝，允许集去掉 rework；Controller 记 escalate 等待用户，回答后带 resumption 的 accept 可达且 rework 放行一次", async () => {
  equal(
    DEMAND_REWORK_ESCALATION_THRESHOLD,
    3,
    "the fixture walks exactly two reworks to the brake",
  );
  const fixture = await createControllerImplementationReviewDecisionServiceFixture();
  try {
    deepEqual(plain(fixture.inspection.reviewUnit.allowedDecisions), [
      "accept",
      "rework",
      "blocked",
      "escalate",
    ]);
    const firstRework = await decideFixtureImplementation(
      fixture,
      { ...implementationReviewJudgmentWire("rework"), idempotencyKey: "brake-rework-1" },
      decisionOptions(at("12:16:00"), "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1"),
    );
    equal(firstRework.status, "committed");
    equal(firstRework.target.phase, "rework-requested");
    equal(firstRework.target.reworkCount, 1);
    equal(firstRework.attached.escalationEventId, null);

    const second = await reworkRound(fixture, 2, firstRework.event.streamRevision, {
      reportedAt: "12:20:00",
      stoppedAt: "12:21:00",
      inspectedAt: "12:22:00",
    });
    deepEqual(plain(second.inspection.reviewUnit.allowedDecisions), [
      "accept",
      "rework",
      "blocked",
      "escalate",
    ]);
    const secondRework = await executeImplementationReviewDecisionRequest(
      CODEX_REVIEW_FACADE,
      fixtureImplementationDecisionRequest(
        fixture,
        second.inspection,
        second.streamRevision,
        "rework",
        "brake-rework-2",
      ),
      decisionOptions(at("12:23:00"), "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2"),
    );
    equal(secondRework.status, "committed");
    equal(secondRework.target.reworkCount, 2);
    equal(secondRework.attached.escalationEventId, null, "the second rework is not braked");

    // 第三份结果：刹车把 rework 从允许集里拿掉；记录时被 rework-brake 拒绝，计数与相位都不动。
    const third = await reworkRound(fixture, 3, secondRework.event.streamRevision, {
      reportedAt: "12:30:00",
      stoppedAt: "12:31:00",
      inspectedAt: "12:32:00",
    });
    deepEqual(plain(third.inspection.reviewUnit.allowedDecisions), [
      "accept",
      "blocked",
      "escalate",
    ]);
    await rejects(
      executeImplementationReviewDecisionRequest(
        CODEX_REVIEW_FACADE,
        fixtureImplementationDecisionRequest(
          fixture,
          third.inspection,
          third.streamRevision,
          "rework",
          "brake-rework-3",
        ),
        decisionOptions(at("12:33:00"), "b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3"),
      ),
      rejectedWith("rework-brake"),
    );

    // Controller 改记 escalate：目标落 escalated，Demand 等用户；回答前任何决定都不能记录。
    const escalated = await executeImplementationReviewDecisionRequest(
      CODEX_REVIEW_FACADE,
      fixtureImplementationDecisionRequest(
        fixture,
        third.inspection,
        third.streamRevision,
        "escalate",
        "brake-escalate",
      ),
      decisionOptions(at("12:34:00"), "b4b4b4b4-b4b4-4b4b-8b4b-b4b4b4b4b4b4"),
    );
    equal(escalated.status, "committed");
    equal(escalated.target.phase, "escalated");
    equal(escalated.target.reworkCount, 2, "a refused rework is not counted");
    equal(escalated.next.owner, "user");
    const escalationEventId = escalated.attached.escalationEventId;
    if (escalationEventId === null) throw new Error("escalate must attach the escalation event");
    const waiting = await inspectFixtureReview(fixture, fixture.targetTaskId, {
      clock: () => at("12:35:00"),
    });
    equal(waiting.reviewUnit.status, "escalated");
    deepEqual(plain(waiting.reviewUnit.allowedDecisions), []);
    deepEqual(plain(waiting.reviewUnit.resumptionBasis), {
      kind: "decision-recorded",
      escalationEventId,
      answered: false,
    });

    // 用户回答经 record-decision 进入事件流；回答后恢复的单元放行 accept，也放行一次 rework。
    const decision = {
      text: "Accept the current result with the recorded residual risks.",
      chosenOption: "Accept the current result with the recorded residual risks.",
    };
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
    if (recorded.kind !== "WakeflowDemandContinuationMutation") {
      throw new Error("Expected a mutation.");
    }
    equal(recorded.disposition, "decision-recorded");
    equal(recorded.next.frontier, "implementation-result-review");
    const answered = await inspectFixtureReview(fixture, fixture.targetTaskId, {
      clock: () => at("12:37:00"),
    });
    deepEqual(plain(answered.reviewUnit.resumptionBasis), {
      kind: "decision-recorded",
      escalationEventId,
      answered: true,
    });
    deepEqual(plain(answered.reviewUnit.allowedDecisions), [
      "accept",
      "rework",
      "blocked",
      "escalate",
    ]);
    const accepted = await executeImplementationReviewDecisionRequest(
      CODEX_REVIEW_FACADE,
      {
        ...fixtureImplementationDecisionRequest(
          fixture,
          answered,
          await currentFixtureStreamRevision(fixture),
          "accept",
          "brake-accept",
        ),
        resumption: {
          previousDecisionId: escalated.decision.targetReviewDecisionId,
          basis: { kind: "decision-recorded", escalationEventId },
          summary: "用户已回答：按当前结果接受。",
        },
      },
      decisionOptions(at("12:38:00"), "b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5"),
    );
    equal(accepted.status, "committed");
    equal(accepted.target.phase, "accepted");
    equal(accepted.target.reworkCount, 2);
    equal(accepted.attached.escalationEventId, null);
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});
