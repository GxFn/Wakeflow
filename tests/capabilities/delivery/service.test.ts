import { equal, ok, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { executeRearmDeliveryRequest } from "../../../src/capabilities/delivery/service.js";
import { renderDeterministicJsonDocument } from "../../../src/foundation/data/deterministic-json-document.js";
import { parseJsonValue } from "../../../src/foundation/data/json-value.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { computeDeliveryPromptDigest } from "../../../src/governance/delivery/delivery-envelope.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import {
  createHostHookObservation,
  HOST_HOOK_RECORDS_MAXIMUM,
  writeHostHookObservation,
} from "../../../src/kernel/hook-observations.js";
import { hostHookObservationsRootRef, workClaimRef } from "../../../src/kernel/layout.js";
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
import {
  cleanupTestDeliveryWorkspaceFixture,
  createTestDeliveryWorkspaceFixture,
} from "../../governance/delivery/test-delivery-workspace.fixture.js";
import {
  PLANNING_REQUIREMENT_ID,
  planFixtureTargetTask,
} from "../../governance/tasking/target-task-planning-service.fixture.js";

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
    // 目标已换到新信封之后，重放第一代的结局仍返回幂等结果，而不是 delivery-unknown。
    const replayedFirst = await recordFixtureDeliveryOutcome(fixture, prepared, {
      attempt: { status: "failed-before-send" },
      readback: { status: "unavailable" },
    });
    equal(replayedFirst.status, "idempotent");
    equal(replayedFirst.outcome.generation, 1);

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
    const hooks = path.join(fixture.workspacePath, hostHookObservationsRootRef("codex"));
    mkdirSync(hooks, { recursive: true, mode: 0o700 });
    const damaged = path.join(hooks, "unrecognized.txt");
    writeFileSync(damaged, "unavailable hook channel", { mode: 0o600 });
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
    equal(existsSync(damaged), true);
    unlinkSync(damaged);
    const rearmed = await rearm(
      fixture,
      prepared.delivery.deliveryId,
      "fixture-rearm-after-resolution",
      resolved.event.streamRevision,
    );
    equal(rearmed.rearm.generation, 2);
    equal(JSON.stringify(rearmed).includes(fixture.workspacePath), false);
    // 第二代的静默从它自己的第一次 indeterminate 起算，不沿用第一代的时刻。
    const fence = rearmed.permit.fence;
    if (fence === null) throw new Error("Expected a target rearm fence.");
    const second = {
      ...prepared,
      permit: { ...rearmed.permit, fence },
      event: rearmed.event,
      delivery: { ...prepared.delivery, generation: 2 },
    };
    const secondAt = parseUtcInstant("2026-08-29T12:30:00.000Z");
    const secondIndeterminate = await recordFixtureDeliveryOutcome(
      fixture,
      second,
      { idempotencyKey: "fixture-outcome-2-indeterminate", observedAt: secondAt },
      { clock: () => secondAt },
    );
    equal(secondIndeterminate.outcome.disposition, "indeterminate");
    const retryAt = parseUtcInstant("2026-08-29T12:31:00.000Z");
    await rejects(
      recordFixtureDeliveryOutcome(
        fixture,
        second,
        {
          idempotencyKey: "fixture-outcome-2-retry",
          expectedStreamRevision: secondIndeterminate.event.streamRevision,
          observedAt: retryAt,
        },
        { clock: () => retryAt },
      ),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.reason === "landing-evidence-missing" &&
        error.details?.blocker2 === undefined,
    );
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

/** 阅读顺序段：从段头到下一个空行。 */
function readingSection(prompt: string, header: string): readonly string[] {
  const lines = prompt.split("\n");
  const start = lines.indexOf(header);
  if (start === -1) throw new Error(`prompt lacks ${header}`);
  const end = lines.indexOf("", start);
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** 带编号的阅读条目：编号去掉后的路径，以及紧跟在它下面的章节行。 */
function readingEntries(
  lines: readonly string[],
): readonly Readonly<{ target: string; sections: string | null }>[] {
  const entries: { target: string; sections: string | null }[] = [];
  for (const line of lines) {
    const numbered = /^\d+\. (.+)$/u.exec(line);
    if (numbered?.[1] !== undefined) entries.push({ target: numbered[1], sections: null });
    else {
      const last = entries.at(-1);
      if (last === undefined) throw new Error(`section line before any entry: ${line}`);
      last.sections = line.trim();
    }
  }
  return entries;
}

/**
 * 阅读顺序从窗口根解析（§13.134，收 §13.133 I7）：夹具的产品仓库是工作区的兄弟目录
 * （`../ProductA`），ledger 也在工作区外（`../wakeflow-ledger`）。任务包、requirement.md、
 * landing.md 与 Demand 状态根都必须从窗口根解析到真实存在的文件，章节列在所在文档下。
 */
function assertReadingOrderResolves(
  prompt: string,
  header: string,
  sectionsLabel: string,
  fixture: Readonly<{ readonly fixtureRoot: string; readonly workspacePath: string }>,
  windowPath: string,
  expectedSections: Readonly<Record<"requirement" | "landing", string | null>>,
): void {
  const executionLabel =
    header === "Read in this order:"
      ? "Execution root (relative to workspace): "
      : "执行目录（相对工作区根）: ";
  const execution = prompt.split("\n").find((line) => line.startsWith(executionLabel));
  ok(execution !== undefined, "the delivery must explicitly select its execution root");
  equal(path.resolve(fixture.workspacePath, execution.slice(executionLabel.length)), windowPath);
  const entries = readingEntries(readingSection(prompt, header));
  const requirementRoot = path.join(
    fixture.fixtureRoot,
    "wakeflow-ledger",
    "requirements",
    PLANNING_REQUIREMENT_ID,
  );
  const resolved = entries.map((entry) => path.resolve(windowPath, entry.target));
  const taskPackage = resolved[0];
  ok(
    taskPackage !== undefined && existsSync(taskPackage),
    `task package path does not resolve from the window: ${entries[0]?.target}`,
  );
  for (const [index, role] of [
    [1, "requirement"],
    [2, "landing"],
  ] as const) {
    equal(resolved[index], path.join(requirementRoot, `${role}.md`), `${role}.md path`);
    ok(existsSync(path.join(requirementRoot, `${role}.md`)));
    equal(
      entries[index]?.sections ?? null,
      expectedSections[role] === null ? null : `${sectionsLabel}: ${expectedSections[role]}`,
      `${role}.md sections`,
    );
  }
  const stateRoot = resolved.at(-1);
  ok(stateRoot !== undefined && existsSync(stateRoot), "state root does not resolve");
  equal(/^\d+\. requirement\.md$/mu.test(prompt), false, "requirement.md must not be bare");
  equal(prompt.includes("requirement.md ("), false, "sections must not hang on requirement.md");
}

test("投递 prompt 的阅读顺序按文档给出从窗口根可解析的需求包路径，章节在所在文档下（§13.134）", async () => {
  for (const [language, header, label] of [
    ["en", "Read in this order:", "sections"],
    ["zh-Hans", "按序阅读:", "章节"],
  ] as const) {
    const fixture = await createDeliveryWorkspaceFixture();
    try {
      const draft = fixture.request.taskPackage;
      if (draft.workType !== "implementation") throw new Error("Expected an implementation draft.");
      const planned = await planFixtureTargetTask(fixture, {
        idempotencyKey: "fixture-plan-sections",
        expectedStreamRevision: 2,
        taskPackage: {
          ...draft,
          sectionAnchors: ["landing-plan", "acceptance-criteria", "code-facts"],
          lineage: { kind: "replacement", replacesTargetTaskId: fixture.targetTaskId },
        },
      });
      const prepared = await prepareFixtureDelivery(fixture, {
        targetTaskId: planned.targetTask.targetTaskId,
        expectedStreamRevision: 3,
        language,
      });
      assertReadingOrderResolves(
        prepared.permit.prompt,
        header,
        label,
        fixture,
        fixture.route.windowPath,
        { requirement: "acceptance-criteria", landing: "landing-plan, code-facts" },
      );
    } finally {
      await cleanupDeliveryWorkspaceFixture(fixture);
    }
  }
});

test("测试投递的 prompt 同样从 Test 窗口根解析需求包文档，不带章节行（§13.134）", async () => {
  const fixture = await createTestDeliveryWorkspaceFixture();
  try {
    const prepared = await prepareFixtureDelivery(
      {
        workspacePath: fixture.workspacePath,
        demandId: fixture.demandId,
        targetTaskId: fixture.testTargetTaskId,
      },
      { expectedStreamRevision: 8, idempotencyKey: "fixture-test-prepare-sections" },
    );
    assertReadingOrderResolves(
      prepared.permit.prompt,
      "按序阅读:",
      "章节",
      fixture,
      fixture.testRoute.windowPath,
      { requirement: null, landing: null },
    );
  } finally {
    await cleanupTestDeliveryWorkspaceFixture(fixture);
  }
});

test("投递查询不完整不能作未落地判断；独立宿主回执仍可证明落地", { timeout: 120_000 }, async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    const prepared = await prepareFixtureDelivery(fixture);
    const directory = path.join(fixture.workspacePath, hostHookObservationsRootRef("codex"));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const files: string[] = [];
    // §13.161：投递读取整个有界集合（HOST_HOOK_RECORDS_MAXIMUM），超出才是不完整。
    for (let index = 0; index < HOST_HOOK_RECORDS_MAXIMUM + 1; index += 1) {
      const record = createHostHookObservation({
        hostId: "codex",
        event: "stop",
        sessionId: fixture.route.rawHandle,
        cwd: fixture.route.windowPath,
        recordedAt: parseUtcInstant("2026-08-29T12:05:10.000Z"),
        turnId: `noise-${index}`,
      });
      const file = path.join(directory, `20260829T120510000Z-stop-${record.recordId}.json`);
      writeFileSync(file, renderDeterministicJsonDocument(parseJsonValue(record)), { mode: 0o600 });
      files.push(file);
    }
    await rejects(
      recordFixtureDeliveryOutcome(fixture, prepared),
      rejectedWith("observation-query-incomplete", "io-failure"),
    );
    equal(existsSync(claimPath(fixture)), true);
    // Retry at the same revision proves the failed observation never appended an outcome.
    for (const file of files) unlinkSync(file);
    // §13.161 B5-1：外来文件名只计 skipped，不再阻断；记录命名却读不出的文件可能藏着落地记录，才阻断。
    const unknown = path.join(directory, "unrecognized.txt");
    writeFileSync(unknown, "not hook evidence", { mode: 0o600 });
    const unreadable = path.join(
      directory,
      "20260829T120510000Z-stop-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json",
    );
    writeFileSync(unreadable, "not hook evidence", { mode: 0o600 });
    await rejects(
      recordFixtureDeliveryOutcome(fixture, prepared),
      rejectedWith("observation-query-unavailable", "io-failure"),
    );
    unlinkSync(unreadable);
    const result = await recordFixtureDeliveryOutcome(fixture, prepared, {
      attempt: { status: "sent", evidenceDigest: `sha256:${"7".repeat(64)}` },
    });
    equal(result.outcome.disposition, "accepted");
    equal(result.outcome.evidenceKind, "host-send-return");
    equal(result.outcome.hookRecordId, null);
    equal(existsSync(unknown), true);
    equal(result.event.streamRevision, prepared.event.streamRevision + 1);
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});
