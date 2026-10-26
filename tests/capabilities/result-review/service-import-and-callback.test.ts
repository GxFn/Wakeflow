import { deepEqual, equal, notEqual, rejects } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { executeTargetResultImportRequest } from "../../../src/capabilities/result-review/service.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant, type UtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { computeDeliveryPromptDigest } from "../../../src/governance/delivery/delivery-envelope.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { inspectWorkClaim } from "../../../src/kernel/work-claims.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  landFixturePrompt,
  loadFixtureDeliveryEnvelope,
  prepareFixtureDelivery,
  recordFixtureDeliveryOutcome,
} from "../../governance/delivery/delivery-workspace.fixture.js";
import {
  cleanupTestDeliveryWorkspaceFixture,
  createTestDeliveryWorkspaceFixture,
} from "../../governance/delivery/test-delivery-workspace.fixture.js";
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
  landFixtureTargetCompletion,
  loadFixtureTaskPackage,
  recordFixtureEvidence,
  registerFixtureControllerWindow,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
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
 * result-review 切片效果（§13.87 D1–D8）之导入与回调，2 级（能力）测试：导入重放幂等、已回报目标拒绝
 * 二次导入；回调只在静默后重发、重放幂等、第四代之后到顶；rearm 不重渲染 prompt，第一代 claimDigest
 * 仍被接纳而陌生摘要被拒；rearm 用尽的返工投递与测试投递换新信封；评审前一次 supersedes 导入换新身份
 * 与新回调（R5，§13.210）。拆自 service.test.ts（测试门清理 D4，open-items D9），与
 * service-implementation-review-and-inspection、service-test-review 共用 service.fixture.ts。
 */

const STRANGER_CLAIM_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const SILENCE_PLUS_ONE_MINUTE = 11 * 60_000;

function after(instant: string, milliseconds: number): UtcInstant {
  return parseUtcInstant(new Date(Date.parse(instant) + milliseconds).toISOString());
}

test("import 重放幂等、已回报目标拒绝二次导入；回调只在静默后重发，重放幂等，第四代之后到顶", async () => {
  const fixture = await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const imported = fixture.imported;
    equal(imported.status, "committed");
    equal(imported.callback.permit.generation, 1);
    equal(imported.callback.permit.hostAction.windowId, fixture.controllerRoute.windowId);
    // K6：回调 prompt 也落在 Demand 根下，目标侧助手按 promptRef 读取并核对 promptDigest。
    equal(
      imported.callback.permit.promptRef,
      `.wakeflow-active/current/${fixture.demandId}/artifacts/permits/callback/${imported.callback.callbackId}.txt`,
    );
    equal(
      imported.callback.permit.promptDigest,
      computeDeliveryPromptDigest(imported.callback.permit.prompt),
    );
    equal(
      readFileSync(
        path.join(fixture.workspacePath, ...imported.callback.permit.promptRef.split("/")),
        "utf8",
      ),
      imported.callback.permit.prompt,
    );
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
      equal(reissued.permit.promptRef, imported.callback.permit.promptRef);
      equal(reissued.permit.promptDigest, imported.callback.permit.promptDigest);
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

test("R5（§13.210）：评审前一次 supersedes 导入换新身份与新回调；点错、第二次、决定之后都被拒；旧身份的决定失效", async () => {
  const fixture = await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const first = fixture.imported;
    const taskPackage = await loadFixtureTaskPackage(
      fixture,
      fixture.delivered.envelope.target.taskPackageId,
    );
    const corrected = {
      ...createImplementationTargetResultReportContentFixture(taskPackage, fixture.evidence),
      summary: "更正后的摘要：补充了遗漏的验证说明。",
    };
    const supersede = (
      idempotencyKey: string,
      supersedes: string,
      expectedStreamRevision: number,
    ) =>
      executeTargetResultImportRequest(
        CODEX_REVIEW_FACADE,
        {
          root: fixture.workspacePath,
          demandId: fixture.demandId,
          idempotencyKey,
          expectedStreamRevision,
          deliveryId: fixture.delivered.prepared.delivery.deliveryId,
          claimDigest: fixture.delivered.prepared.permit.fence.claimDigest,
          report: { workType: "implementation", content: corrected },
          supersedes,
        },
        { clock: () => at("12:12:00"), durability: "none" },
      );
    await rejects(
      supersede(
        "fixture-supersede-wrong",
        `target-result_${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`,
        await currentFixtureStreamRevision(fixture),
      ),
      rejectedWith("supersede-result-mismatch"),
    );
    const second = await supersede(
      "fixture-supersede-1",
      first.result.targetResultId,
      await currentFixtureStreamRevision(fixture),
    );
    equal(second.status, "committed");
    notEqual(second.result.targetResultId, first.result.targetResultId);
    equal(second.result.supersedes, first.result.targetResultId);
    notEqual(second.callback.callbackId, first.callback.callbackId);
    equal(second.callback.permit.generation, 1);
    equal(second.next.frontier, "implementation-result-review");
    const replayed = await supersede(
      "fixture-supersede-1",
      first.result.targetResultId,
      second.event.streamRevision - 1,
    );
    equal(replayed.status, "idempotent");
    equal(replayed.result.targetResultId, second.result.targetResultId);
    await rejects(
      supersede(
        "fixture-supersede-2",
        second.result.targetResultId,
        await currentFixtureStreamRevision(fixture),
      ),
      rejectedWith("supersede-exhausted"),
    );

    const inspection = await inspectFixtureReview(fixture, fixture.targetTaskId);
    equal(inspection.reviewUnit.targetResult.targetResultId, second.result.targetResultId);
    deepEqual(inspection.reviewUnit.supersededResults, [first.result.targetResultId]);
    // 夹具里按第一份结果准备的决定请求点的是旧身份：被取代的结果不再是可决定的单元。
    await rejects(
      decideFixtureImplementation(fixture, {
        expectedStreamRevision: await currentFixtureStreamRevision(fixture),
      }),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "precondition-failed" &&
        (error.reason === "snapshot-stale" || error.reason === "result-unknown"),
    );

    await landFixtureTargetCompletion(fixture, fixture.route, at("12:21:00"));
    const confirmed = await inspectFixtureReview(fixture, fixture.targetTaskId, {
      clock: () => at("12:22:00"),
    });
    equal(allows(confirmed.reviewUnit, "accept"), true);
    const decided = await decideFixtureImplementation(
      fixture,
      fixtureImplementationDecisionRequest(
        fixture,
        confirmed,
        await currentFixtureStreamRevision(fixture),
        "accept",
        "fixture-decision-after-supersede",
      ),
      decisionOptions(at("12:23:00"), "c5c5c5c5-c5c5-4c5c-8c5c-c5c5c5c5c5c5"),
    );
    equal(decided.status, "committed");
    await rejects(
      supersede(
        "fixture-supersede-3",
        second.result.targetResultId,
        await currentFixtureStreamRevision(fixture),
      ),
      rejectedWith("supersede-target-phase"),
    );
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});
