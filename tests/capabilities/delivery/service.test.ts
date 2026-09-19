import { equal, rejects } from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { executeRearmDeliveryRequest } from "../../../src/capabilities/delivery/service.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { computeDeliveryPromptDigest } from "../../../src/governance/delivery/delivery-envelope.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { workClaimRef } from "../../../src/kernel/layout.js";
import { inspectWorkClaim } from "../../../src/kernel/work-claims.js";
import {
  cleanupDeliveryWorkspaceFixture,
  CODEX_DELIVERY_FACADE,
  createDeliveryWorkspaceFixture,
  DELIVERY_AUTHORED,
  landFixturePrompt,
  prepareFixtureDelivery,
  recordFixtureDeliveryOutcome,
  type DeliveryWorkspaceFixture,
} from "../../governance/delivery/delivery-workspace.fixture.js";

/**
 * delivery 切片效果：prepare 一次追加并返回可移植许可（声明、信封、围栏）；重放、异请求、
 * 过期修订、非法 phase 各有结局；结局按证据派生并处理声明；rearm 换代直至上限。
 */

function rejectedWith(reason: string, code = "precondition-failed") {
  return (error: unknown) =>
    isWakeflowError(error) && error.code === code && error.reason === reason;
}

function claimPath(fixture: Readonly<DeliveryWorkspaceFixture>): string {
  return path.join(fixture.workspacePath, ...workClaimRef(fixture.route.windowId).split("/"));
}

async function rearm(
  fixture: Readonly<DeliveryWorkspaceFixture>,
  deliveryId: string,
  idempotencyKey: string,
  expectedStreamRevision: number,
  clock = parseUtcInstant("2026-08-29T12:20:00.000Z"),
) {
  return executeRearmDeliveryRequest(
    CODEX_DELIVERY_FACADE,
    {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey,
      expectedStreamRevision,
      deliveryId,
    },
    { clock: () => clock },
  );
}

test("prepare_delivery 一次追加、取得声明并返回可移植许可；重放、异请求、过期修订、非法 phase 各有结局", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    await rejects(
      prepareFixtureDelivery(fixture, {
        targetTaskId: "target-task_00000000-0000-4000-8000-000000000000",
      }),
      rejectedWith("target-unknown", "not-found"),
    );
    const prepared = await prepareFixtureDelivery(fixture);
    equal(prepared.status, "committed");
    equal(prepared.delivery.workType, "implementation");
    equal(prepared.delivery.phase, "delivery-prepared");
    equal(prepared.delivery.generation, 1);
    equal(prepared.delivery.targetTaskId, fixture.targetTaskId);
    equal(prepared.permit.hostAction.effect, "send-prompt-to-window");
    equal(prepared.permit.hostAction.windowId, fixture.route.windowId);
    equal(prepared.permit.hostAction.bindingId, fixture.route.bindingId);
    equal(prepared.permit.fence.streamRevision, 3);
    equal(prepared.event.streamRevision, 3);
    equal(prepared.next.frontier, "implementation-host-effect-execution");
    equal(prepared.next.owner, "controller");
    equal(prepared.next.suggestedTool, "wakeflow_record_delivery_outcome");
    const prompt = prepared.permit.prompt;
    equal(prompt.includes(fixture.workspacePath), false, "prompt leaked the workspace root");
    equal(prompt.includes(prepared.delivery.deliveryId), true);
    equal(prompt.includes(prepared.permit.fence.claimDigest), true);
    equal(prompt.includes(DELIVERY_AUTHORED.goal), true);
    equal(prompt.includes("skills/wakeflow-target/SKILL.md"), true);
    const rendered = JSON.stringify(prepared);
    equal(rendered.includes(fixture.workspacePath), false);
    equal(rendered.includes(fixture.route.rawHandle), false);

    equal(existsSync(claimPath(fixture)), true);
    const claim = (await inspectWorkClaim(fixture.workspaceRoot, fixture.route.windowId)).claim;
    equal(claim?.claimId, prepared.permit.fence.claimId);
    equal(claim?.claimDigest, prepared.permit.fence.claimDigest);
    equal(claim?.holder.deliveryId, prepared.delivery.deliveryId);
    equal(claim?.holder.generation, 1);

    const replayed = await prepareFixtureDelivery(
      fixture,
      {},
      {
        clock: () => parseUtcInstant("2026-08-29T12:09:00.000Z"),
      },
    );
    equal(replayed.status, "idempotent");
    equal(replayed.delivery.deliveryId, prepared.delivery.deliveryId);
    equal(replayed.permit.fence.claimDigest, prepared.permit.fence.claimDigest);
    equal(replayed.permit.prompt, prompt);
    equal(replayed.event.eventId, prepared.event.eventId);
    await rejects(
      prepareFixtureDelivery(fixture, {
        authored: { ...DELIVERY_AUTHORED, goal: "另一个目标。" },
      }),
      rejectedWith("request-digest", "idempotency-mismatch"),
    );
    await rejects(
      prepareFixtureDelivery(fixture, { idempotencyKey: "fixture-prepare-2" }),
      rejectedWith("stream-revision", "concurrency-conflict"),
    );
    await rejects(
      prepareFixtureDelivery(fixture, {
        idempotencyKey: "fixture-prepare-2",
        expectedStreamRevision: 3,
      }),
      rejectedWith("target-phase"),
    );
    equal(existsSync(claimPath(fixture)), true);
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

test("record_delivery_outcome：围栏不符被拒；无落地证据为 indeterminate 并保留声明；静默超时交给 Controller；落地后再次记录为 accepted", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    const prepared = await prepareFixtureDelivery(fixture);
    await rejects(
      recordFixtureDeliveryOutcome(fixture, {
        ...prepared,
        permit: {
          ...prepared.permit,
          fence: { ...prepared.permit.fence, claimDigest: `sha256:${"f".repeat(64)}` },
        },
      }),
      rejectedWith("fence-mismatch"),
    );
    await rejects(
      recordFixtureDeliveryOutcome(fixture, prepared, {
        resolution: { disposition: "accepted", hookRecordId: "missing", rationale: "看到了。" },
      }),
      rejectedWith("resolution-phase"),
    );

    const indeterminate = await recordFixtureDeliveryOutcome(fixture, prepared);
    equal(indeterminate.status, "recorded");
    equal(indeterminate.outcome.disposition, "indeterminate");
    equal(indeterminate.outcome.evidenceKind, "agent-declaration");
    equal(indeterminate.outcome.claimHandling, "retain");
    equal(indeterminate.target.phase, "host-effect-indeterminate");
    equal(indeterminate.next.blockers.includes("landing-evidence-missing"), true);
    equal(indeterminate.next.blockers.includes("landing-silence-exceeded"), false);
    equal(existsSync(claimPath(fixture)), true);
    const replayed = await recordFixtureDeliveryOutcome(fixture, prepared);
    equal(replayed.status, "idempotent");
    equal(replayed.outcome.outcomeDigest, indeterminate.outcome.outcomeDigest);

    // 十分钟后仍无证据：不再追加事件，而是把静默超时作为阻塞交给 Controller 决断。
    await rejects(
      recordFixtureDeliveryOutcome(
        fixture,
        prepared,
        {
          idempotencyKey: "fixture-outcome-silent",
          expectedStreamRevision: indeterminate.event.streamRevision,
          observedAt: parseUtcInstant("2026-08-29T12:17:00.000Z"),
        },
        { clock: () => parseUtcInstant("2026-08-29T12:17:00.000Z") },
      ),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.reason === "landing-evidence-missing" &&
        error.details?.blocker === "landing-evidence-missing" &&
        error.details.blocker2 === "landing-silence-exceeded",
    );
    const silent = indeterminate;
    await rejects(
      recordFixtureDeliveryOutcome(fixture, prepared, {
        idempotencyKey: "fixture-outcome-resolve-missing",
        expectedStreamRevision: silent.event.streamRevision,
        resolution: { disposition: "accepted", hookRecordId: "missing", rationale: "看到了。" },
      }),
      rejectedWith("resolution-evidence-missing"),
    );
    // 显式解决只认落地记录：同一会话的 stop 记录即使带着相同提示摘要也不是落地证据。
    const stopRecord = await writeHostHookObservation(fixture.workspaceRoot, {
      hostId: "codex",
      event: "stop",
      sessionId: fixture.route.rawHandle,
      cwd: fixture.route.windowPath,
      recordedAt: parseUtcInstant("2026-08-29T12:16:00.000Z"),
      promptDigest: computeDeliveryPromptDigest(prepared.permit.prompt),
    });
    await rejects(
      recordFixtureDeliveryOutcome(fixture, prepared, {
        idempotencyKey: "fixture-outcome-resolve-stop-record",
        expectedStreamRevision: silent.event.streamRevision,
        resolution: {
          disposition: "accepted",
          hookRecordId: stopRecord.record.recordId,
          rationale: "看到了。",
        },
      }),
      rejectedWith("resolution-evidence-missing"),
    );

    const landed = await landFixturePrompt(
      fixture,
      fixture.route,
      prepared.permit.prompt,
      parseUtcInstant("2026-08-29T12:18:00.000Z"),
    );
    const accepted = await recordFixtureDeliveryOutcome(
      fixture,
      prepared,
      {
        idempotencyKey: "fixture-outcome-landed",
        expectedStreamRevision: silent.event.streamRevision,
        observedAt: parseUtcInstant("2026-08-29T12:19:00.000Z"),
      },
      { clock: () => parseUtcInstant("2026-08-29T12:19:00.000Z") },
    );
    equal(accepted.outcome.disposition, "accepted");
    equal(accepted.outcome.evidenceKind, "hook-record");
    equal(accepted.outcome.hookRecordId, landed.record.recordId);
    equal(accepted.outcome.claimHandling, "retain");
    equal(accepted.target.phase, "host-effect-accepted");
    equal(accepted.next.frontier, "implementation-target-result-import");
    equal(accepted.next.blockers.includes("landing-evidence-missing"), false);
    equal(existsSync(claimPath(fixture)), true);
    await rejects(
      recordFixtureDeliveryOutcome(fixture, prepared, {
        idempotencyKey: "fixture-outcome-after-accept",
        expectedStreamRevision: accepted.event.streamRevision,
      }),
      rejectedWith("target-phase"),
    );
    await rejects(
      rearm(
        fixture,
        prepared.delivery.deliveryId,
        "fixture-rearm-x",
        accepted.event.streamRevision,
      ),
      rejectedWith("target-phase"),
    );
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

test("Codex 发送返回摘要直接 accepted；发送前失败释放声明并可 rearm 至上限，之后重新准备新信封", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    const prepared = await prepareFixtureDelivery(fixture);
    const rejected = await recordFixtureDeliveryOutcome(fixture, prepared, {
      attempt: { status: "failed-before-send" },
      readback: { status: "unavailable" },
    });
    equal(rejected.outcome.disposition, "rejected-before-send");
    equal(rejected.outcome.claimHandling, "release-authorized");
    equal(rejected.target.phase, "host-effect-rejected");
    equal(rejected.next.frontier, "implementation-host-effect-rearm");
    equal(rejected.next.suggestedTool, "wakeflow_rearm_delivery");
    equal(existsSync(claimPath(fixture)), false, "rejected outcome must release the claim");
    await rejects(
      prepareFixtureDelivery(fixture, {
        idempotencyKey: "fixture-prepare-while-rearmable",
        expectedStreamRevision: rejected.event.streamRevision,
      }),
      rejectedWith("rearm-available"),
    );
    await rejects(
      rearm(
        fixture,
        "target-delivery_00000000-0000-4000-8000-000000000000",
        "fixture-rearm-unknown",
        rejected.event.streamRevision,
      ),
      rejectedWith("delivery-unknown", "not-found"),
    );

    let streamRevision = rejected.event.streamRevision;
    let permit = prepared.permit;
    for (const generation of [2, 3, 4]) {
      const rearmed = await rearm(
        fixture,
        prepared.delivery.deliveryId,
        `fixture-rearm-${generation}`,
        streamRevision,
      );
      equal(rearmed.status, "rearmed");
      equal(rearmed.rearm.previousGeneration, generation - 1);
      equal(rearmed.rearm.generation, generation);
      equal(rearmed.delivery.deliveryId, prepared.delivery.deliveryId);
      equal(rearmed.delivery.generation, generation);
      equal(rearmed.rearm.kind, "target");
      equal(rearmed.permit.prompt, prepared.permit.prompt);
      const fence = rearmed.permit.fence;
      if (fence === null) throw new Error("Expected a target rearm fence.");
      equal(fence.claimId === permit.fence.claimId, false);
      equal(rearmed.next.frontier, "implementation-host-effect-execution");
      equal(existsSync(claimPath(fixture)), true);
      const claim = (await inspectWorkClaim(fixture.workspaceRoot, fixture.route.windowId)).claim;
      equal(claim?.holder.generation, generation);
      // 同键重放只读不写、返回同一围栏：换代之间是同一条路径，第一代验一次即可。
      if (generation === 2) {
        const replay = await rearm(
          fixture,
          prepared.delivery.deliveryId,
          `fixture-rearm-${generation}`,
          streamRevision,
        );
        equal(replay.status, "idempotent");
        equal(replay.permit.fence?.claimDigest, fence.claimDigest);
      }
      permit = { ...rearmed.permit, fence };
      const rejectedAgain = await recordFixtureDeliveryOutcome(
        fixture,
        {
          ...prepared,
          permit,
          event: rearmed.event,
          delivery: { ...prepared.delivery, generation: rearmed.delivery.generation },
        },
        {
          idempotencyKey: `fixture-outcome-rejected-${generation}`,
          attempt: { status: "failed-before-send" },
          readback: { status: "unavailable" },
        },
      );
      equal(rejectedAgain.outcome.generation, generation);
      equal(rejectedAgain.outcome.disposition, "rejected-before-send");
      equal(existsSync(claimPath(fixture)), false);
      streamRevision = rejectedAgain.event.streamRevision;
    }
    await rejects(
      rearm(fixture, prepared.delivery.deliveryId, "fixture-rearm-5", streamRevision),
      rejectedWith("rearm-limit"),
    );
    const reprepared = await prepareFixtureDelivery(fixture, {
      idempotencyKey: "fixture-prepare-again",
      expectedStreamRevision: streamRevision,
    });
    equal(reprepared.status, "committed");
    equal(reprepared.delivery.deliveryId === prepared.delivery.deliveryId, false);
    equal(reprepared.delivery.generation, 1);
    equal(reprepared.delivery.phase, "delivery-prepared");

    // Codex 宿主：发送调用的返回摘要就是 accepted 证据，无需等待 hook 记录。
    const sentReturn = await recordFixtureDeliveryOutcome(fixture, reprepared, {
      idempotencyKey: "fixture-outcome-send-return",
      attempt: { status: "sent", evidenceDigest: parseSha256Digest(`sha256:${"a".repeat(64)}`) },
      readback: { status: "unavailable" },
    });
    equal(sentReturn.outcome.disposition, "accepted");
    equal(sentReturn.outcome.evidenceKind, "host-send-return");
    equal(sentReturn.target.phase, "host-effect-accepted");
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

test("Controller 解决：indeterminate 可被显式判为 rejected-before-send 并释放声明", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    const prepared = await prepareFixtureDelivery(fixture);
    const indeterminate = await recordFixtureDeliveryOutcome(fixture, prepared);
    equal(indeterminate.outcome.disposition, "indeterminate");
    const resolved = await recordFixtureDeliveryOutcome(fixture, prepared, {
      idempotencyKey: "fixture-outcome-resolved",
      expectedStreamRevision: indeterminate.event.streamRevision,
      resolution: { disposition: "rejected-before-send", rationale: "目标会话没有任何新输入。" },
    });
    equal(resolved.outcome.disposition, "rejected-before-send");
    equal(resolved.outcome.evidenceKind, "controller-resolution");
    equal(resolved.outcome.claimHandling, "release-authorized");
    equal(resolved.target.phase, "host-effect-rejected");
    equal(existsSync(claimPath(fixture)), false);
    const rearmed = await rearm(
      fixture,
      prepared.delivery.deliveryId,
      "fixture-rearm-after-resolution",
      resolved.event.streamRevision,
    );
    equal(rearmed.rearm.generation, 2);
    equal(JSON.stringify(rearmed).includes(fixture.workspacePath), false);
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});
