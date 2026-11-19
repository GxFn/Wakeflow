import { deepEqual, equal } from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { hostHelperObservationsRootRef } from "../../../src/kernel/layout.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  type DeliveryWorkspaceFixture,
  deliverFixtureTarget,
  fixtureLandingInstant,
  loadFixtureDeliveryEnvelope,
  prepareFixtureDelivery,
  recordFixtureDeliveryOutcome,
  withFixtureDemandRoot,
} from "../../governance/delivery/delivery-workspace.fixture.js";
import {
  importFixtureImplementationResult,
  inspectFixtureReview,
  landFixtureTargetCompletion,
  REVIEW_FIXTURE_REPORTED_AT,
  recordFixtureEvidence,
  registerFixtureControllerWindow,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { plain } from "./service.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：导入那一刻 Wakeflow 自己对目标会话的越级观察（open-items H13，1.4 第 4 段）。从这份投递的
 * 落地记录到导入，目标会话里提交过的 prompt 归成三类计数，随结果事件落盘，评审单元原样带出；没有落地记录
 * 可当起点时报未观察而不是零条。观察只是旁证：它从不让导入失败。
 */

const NUDGE_TEXT = "Continue.";

function instantAfterLanding(seconds: number) {
  return parseUtcInstant(
    new Date(Date.parse(fixtureLandingInstant(1)) + seconds * 1000).toISOString(),
  );
}

async function submitPrompt(
  fixture: Readonly<DeliveryWorkspaceFixture>,
  input: Readonly<{
    readonly sessionId?: string;
    readonly seconds: number;
    readonly text: string;
    readonly permitIds?: readonly string[];
  }>,
): Promise<void> {
  await writeHostHookObservation(fixture.workspaceRoot, {
    hostId: "codex",
    event: "user-prompt-submit",
    sessionId: input.sessionId ?? fixture.route.rawHandle,
    cwd: fixture.route.windowPath,
    recordedAt: instantAfterLanding(input.seconds),
    promptDigest: computeSha256Digest(encodeUtf8(input.text, "$test"), "$test"),
    promptPermitIds: input.permitIds ?? [],
    promptCharacters: input.text.length,
  });
}

async function storedSessionPrompts(
  fixture: Readonly<DeliveryWorkspaceFixture>,
  claimId: string,
): Promise<unknown> {
  const stored = await withFixtureDemandRoot(fixture, (demandRoot) =>
    new DemandEventSourcingRepository(demandRoot).findTargetResultRecordedEvent(claimId),
  );
  return plain(stored?.event.data.sessionPrompts ?? null);
}

test("落地到导入之间的 prompt 被归成三类并随结果事件落盘；评审单元原样带出；别的会话与区间之外的不算", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    await registerFixtureControllerWindow(fixture);
    const delivered = await deliverFixtureTarget(fixture);
    const evidence = await recordFixtureEvidence(fixture);

    // 使用者直接对产品窗口说了两句话。
    await submitPrompt(fixture, { seconds: 30, text: "顺手把标题也改掉" });
    await submitPrompt(fixture, { seconds: 90, text: "再加一行说明" });
    // Controller 推过一次续跑短句：助手留下了记录，目标会话里有同一句的提交。
    const helperDirectory = path.join(
      fixture.workspacePath,
      ...hostHelperObservationsRootRef("codex").split("/"),
    );
    mkdirSync(helperDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(
        helperDirectory,
        "20260829T120700000Z-nudge-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json",
      ),
      `${JSON.stringify({
        kind: "WakeflowWindowNudge",
        windowId: fixture.route.windowId,
        textDigest: computeSha256Digest(encodeUtf8(NUDGE_TEXT, "$test"), "$test"),
        sentAt: instantAfterLanding(120),
      })}\n`,
      { mode: 0o600 },
    );
    await submitPrompt(fixture, { seconds: 121, text: NUDGE_TEXT });
    // 一条带着 Wakeflow 许可身份的 prompt（重新武装的投递就是这个样子）。
    await submitPrompt(fixture, {
      seconds: 150,
      text: "带许可的投递",
      permitIds: [delivered.prepared.delivery.deliveryId],
    });
    // 不算的两条：导入之后才提交的，和另一个会话里的。
    await submitPrompt(fixture, { seconds: 600, text: "导入之后" });
    await submitPrompt(fixture, { seconds: 60, text: "别的会话", sessionId: "another-session" });

    const imported = await importFixtureImplementationResult(fixture, delivered, { evidence });
    equal(imported.status, "committed");
    const expected = {
      status: "observed",
      reason: null,
      from: fixtureLandingInstant(1),
      until: REVIEW_FIXTURE_REPORTED_AT,
      permitPrompts: 1,
      nudgePrompts: 1,
      outsidePrompts: 2,
      outsideAt: [instantAfterLanding(30), instantAfterLanding(90)],
    };
    deepEqual(
      await storedSessionPrompts(fixture, imported.result.delivery.fence.claimId),
      expected,
    );

    await landFixtureTargetCompletion(fixture, fixture.route);
    const inspection = await inspectFixtureReview(fixture, fixture.targetTaskId);
    deepEqual(plain(inspection.reviewUnit.sessionPrompts), expected);
    // 观察不带内容、摘要与会话标识。
    const text = JSON.stringify(inspection.reviewUnit.sessionPrompts);
    equal(text.includes(fixture.route.rawHandle), false);
    equal(text.includes("sha256:"), false);
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

test("没有落地记录可当起点（落地由宿主的发送返回证明）时报未观察，不是零条；导入照常成功", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    await registerFixtureControllerWindow(fixture);
    const prepared = await prepareFixtureDelivery(fixture);
    // Codex 的线程发送：落地由发送的返回值证明，结局不点名任何 hook 记录。
    const recorded = await recordFixtureDeliveryOutcome(fixture, prepared, {
      attempt: {
        status: "sent",
        sendReturn: { thread_id: "thread-7", message_id: "message-9", status: "ok" },
      },
    });
    equal(recorded.outcome.disposition, "accepted");
    equal(recorded.outcome.hookRecordId, null);
    // 目标会话里即使有别的 prompt，没有起点也数不了。
    await submitPrompt(fixture, { seconds: 30, text: "没有起点时的一句话" });
    const envelope = await loadFixtureDeliveryEnvelope(fixture, prepared.delivery.deliveryId);
    const imported = await importFixtureImplementationResult(
      fixture,
      { prepared, recorded, envelope } as Parameters<typeof importFixtureImplementationResult>[1],
      { evidence: await recordFixtureEvidence(fixture) },
    );
    equal(imported.status, "committed");
    deepEqual(await storedSessionPrompts(fixture, imported.result.delivery.fence.claimId), {
      status: "unobserved",
      reason: "landing-record-absent",
      from: null,
      until: REVIEW_FIXTURE_REPORTED_AT,
      permitPrompts: 0,
      nudgePrompts: 0,
      outsidePrompts: 0,
      outsideAt: [],
    });
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});
