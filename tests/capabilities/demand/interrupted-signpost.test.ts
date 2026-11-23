import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME,
} from "../../../src/capabilities/demand/contract.js";
import {
  executeDemandCancellationRequest,
  executeDemandCompletionRequest,
  executeDemandContinuationRequest,
} from "../../../src/capabilities/demand/lifecycle.js";
import { WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME } from "../../../src/capabilities/evidence/contract.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../../src/capabilities/workspace/maintain-workspace.js";
import { renderDeterministicJsonDocument } from "../../../src/foundation/data/deterministic-json-document.js";
import { DEMAND_LIFECYCLE_JOURNAL_KIND } from "../../../src/governance/demand/demand-interruption.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { DEMAND_RECOVERY_TOOLS } from "../../../src/kernel/next-projection.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  applyCompletion,
  applyContinuation,
  currentNames,
  type LifecycleOrderCase,
  lifecycleOrderCase,
  recoverCompletion,
  recoverContinuation,
  renamedTo,
} from "./lifecycle-order.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：Demand 停在被打断的事务上时，生命周期命令的拒绝点名能走通的出口（1.4.1 段 1b，清单第 2 项）。
 *
 * 每个用例经真实的服务造出一种中断状态（注入一次失败，或在根里手写一份恢复记录），断言完成、取消、续接
 * 的拒绝是 `recovery-required`、原因与 `details.tool` / `details.operationId` 相符，再按点名的那一个调用
 * 走一遍，确认它治得好。反过来的几条钉住不该点名的情形：没有恢复记录的终态根、终态事件没有提交的旧
 * 日志、读不出的日志、根自己不安全、不是这条出口能治的打不开。
 */

const CONTINUATION = { kind: "optimization", summary: "Tighten the focused checks." } as const;

async function refusalOf(run: () => Promise<unknown>): Promise<WakeflowError> {
  try {
    await run();
  } catch (error: unknown) {
    if (error instanceof WakeflowError) return error;
    throw error;
  }
  throw new Error("Expected a refusal.");
}

/** `subject`：点名的调用要带的那个参数；证据的 recover 认 `demandId`，其余认 `operationId`。 */
function assertSignpost(
  error: WakeflowError,
  reason: string,
  tool: string,
  subject: string | null | Readonly<{ demandId: string }>,
): void {
  equal(error.code, "recovery-required", `${error.code}/${error.reason}`);
  equal(error.reason, reason);
  equal(error.retryable, false);
  deepEqual(
    error.details,
    subject === null
      ? { tool }
      : typeof subject === "string"
        ? { tool, operationId: subject }
        : { tool, ...subject },
  );
}

const completePreview = (scenario: LifecycleOrderCase) => () =>
  executeDemandCompletionRequest({
    root: scenario.root,
    mode: "preview",
    demandId: scenario.demandId,
  });
const completeApply = (scenario: LifecycleOrderCase) => () => applyCompletion(scenario);
const cancelPreview = (scenario: LifecycleOrderCase) => () =>
  executeDemandCancellationRequest({
    root: scenario.root,
    mode: "preview",
    demandId: scenario.demandId,
    reason: "No longer wanted.",
  });
const continuePreview = (scenario: LifecycleOrderCase) => () =>
  executeDemandContinuationRequest({
    root: scenario.root,
    mode: "preview",
    demandId: scenario.demandId,
    action: "continue",
    continuation: CONTINUATION,
  });
const decisionPreview = (scenario: LifecycleOrderCase) => () =>
  executeDemandContinuationRequest({
    root: scenario.root,
    mode: "preview",
    demandId: scenario.demandId,
    action: "record-decision",
    decision: { text: "Wait.", chosenOption: "Wait" },
  });

function inRoot(scenario: LifecycleOrderCase, ...segments: string[]): string {
  return path.join(scenario.workspace, ...scenario.demandRoot.split("/"), ...segments);
}

/** 完成事务停在"认领状态已置终态"之后：终态事件已提交、归档已封，根还在（completed），日志留着。 */
async function interruptCompletionAfterClaim(scenario: LifecycleOrderCase): Promise<void> {
  scenario.failAfterRename(renamedTo(scenario.claimState));
  await rejects(applyCompletion(scenario), (error: unknown) => error instanceof WakeflowError);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), true);
  equal(existsSync(inRoot(scenario)), true);
}

async function assertCompletionHealed(scenario: LifecycleOrderCase): Promise<void> {
  await recoverCompletion(scenario);
  equal(existsSync(inRoot(scenario)), false);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false);
  deepEqual(currentNames(scenario, ".retire-"), []);
  const after = await completePreview(scenario)();
  if (after.kind !== "WakeflowDemandCompletionPreview") throw new Error("Expected a preview.");
  deepEqual(after.blockers, ["already-archived:completed"]);
}

test("恢复出口的工具名与各切片导出的工具名相等", () => {
  deepEqual(DEMAND_RECOVERY_TOOLS, {
    publication: WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME,
    evidence: WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME,
    "append-candidates": WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    complete: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
    cancel: WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
    continue: WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
  });
});

test("终态事件已提交、根还在：完成、取消、续接、记录决定都点名 complete 的 recover；recover 治好", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await interruptCompletionAfterClaim(scenario);
  for (const run of [
    completePreview(scenario),
    completeApply(scenario),
    cancelPreview(scenario),
    continuePreview(scenario),
    decisionPreview(scenario),
  ]) {
    assertSignpost(
      await refusalOf(run),
      "lifecycle-journal-pending",
      "wakeflow_complete_demand",
      scenario.demandId,
    );
  }
  await assertCompletionHealed(scenario);
});

test("根已改名退役、还没删完：根不在时完成与取消点名 complete 的 recover；recover 治好", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  scenario.failNextRemoveTree((target) => target === scenario.retiredRoot);
  await rejects(applyCompletion(scenario), (error: unknown) => error instanceof WakeflowError);
  equal(existsSync(inRoot(scenario)), false);
  equal(currentNames(scenario, ".retire-").length, 1);
  for (const run of [
    completePreview(scenario),
    cancelPreview(scenario),
    decisionPreview(scenario),
  ]) {
    assertSignpost(
      await refusalOf(run),
      "lifecycle-journal-pending",
      "wakeflow_complete_demand",
      scenario.demandId,
    );
  }
  await assertCompletionHealed(scenario);
});

test("续接事件已追加、认领还没回来：续接、完成、取消都点名 continue 的 recover；recover 治好", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await applyCompletion(scenario);
  scenario.failBeforeRename((destination) => destination === scenario.claimState);
  await rejects(applyContinuation(scenario), (error: unknown) => error instanceof WakeflowError);
  ok(scenario.events.includes(`rename-refused ${scenario.claimState}`));
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), true);
  for (const run of [
    continuePreview(scenario),
    completePreview(scenario),
    cancelPreview(scenario),
  ]) {
    assertSignpost(
      await refusalOf(run),
      "lifecycle-journal-pending",
      "wakeflow_continue_demand",
      scenario.demandId,
    );
  }
  await recoverContinuation(scenario);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false);
  const after = await cancelPreview(scenario)();
  if (after.kind !== "WakeflowDemandCancellationPreview") throw new Error("Expected a preview.");
  equal(after.status, "ready", after.blockers.join(","));
});

test("续接停在根放回之前（日志在、根不在）：完成与取消点名 continue 的 recover；recover 放回根并收尾", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await applyCompletion(scenario);
  scenario.failBeforeRename((destination) => destination === scenario.demandRoot);
  await rejects(applyContinuation(scenario), (error: unknown) => error instanceof WakeflowError);
  equal(existsSync(inRoot(scenario)), false);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), true);
  for (const run of [completePreview(scenario), cancelPreview(scenario)]) {
    assertSignpost(
      await refusalOf(run),
      "lifecycle-journal-pending",
      "wakeflow_continue_demand",
      scenario.demandId,
    );
  }
  await recoverContinuation(scenario);
  equal(existsSync(inRoot(scenario)), true);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false);
  deepEqual(currentNames(scenario, ".restore-"), []);
});

test("根里留着发布标记、证据事务或追加候选：打不开的根点名各自的出口；追加候选不带参数，证据带 demandId", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  const candidate = inRoot(scenario, "event-sourcing", "append-candidates", "left-behind");
  writeFileSync(candidate, "x", { mode: 0o600 });
  assertSignpost(
    await refusalOf(completePreview(scenario)),
    "append-candidates-pending",
    "wakeflow_maintain_workspace",
    null,
  );

  // 证据事务与候选都在（证据事件追加到一半被杀的样子）：先点维护，候选收掉之后才点证据的 recover，
  // 它的参数是 `demandId`（`wakeflow_record_evidence` 的 recover 不认 `operationId`）。
  const evidence = inRoot(scenario, "transactions", "managed-evidence-publication.json");
  writeFileSync(evidence, "{}\n", { mode: 0o600 });
  assertSignpost(
    await refusalOf(cancelPreview(scenario)),
    "append-candidates-pending",
    "wakeflow_maintain_workspace",
    null,
  );
  rmSync(candidate);
  assertSignpost(
    await refusalOf(cancelPreview(scenario)),
    "evidence-publication-pending",
    "wakeflow_record_evidence",
    { demandId: scenario.demandId },
  );

  writeFileSync(inRoot(scenario, "transactions", "publication.json"), "{}\n", { mode: 0o600 });
  for (const run of [
    completeApply(scenario),
    continuePreview(scenario),
    decisionPreview(scenario),
  ]) {
    assertSignpost(
      await refusalOf(run),
      "demand-publication",
      "wakeflow_create_demand",
      scenario.demandId,
    );
  }
});

function writeJournal(scenario: LifecycleOrderCase, text: string): void {
  const file = path.join(scenario.workspace, scenario.journal);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, text, { mode: 0o600 });
}

function journalText(scenario: LifecycleOrderCase, action: string): string {
  return renderDeterministicJsonDocument({
    kind: DEMAND_LIFECYCLE_JOURNAL_KIND,
    schemaVersion: 1,
    plan: {
      action,
      demandId: scenario.demandId,
      eventId: "demand-event_99999999-9999-4999-8999-999999999999",
    },
    planDigest: `sha256:${"9".repeat(64)}`,
    verify: null,
  });
}

test("不该点名的情形：终态事件没有提交的旧日志照常计划并被改写；读不出的日志不影响预览", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  writeJournal(scenario, "garbage\n");
  const withGarbage = await completePreview(scenario)();
  if (withGarbage.kind !== "WakeflowDemandCompletionPreview")
    throw new Error("Expected a preview.");
  equal(withGarbage.status, "ready", withGarbage.blockers.join(","));

  writeJournal(scenario, journalText(scenario, "complete"));
  const withStale = await cancelPreview(scenario)();
  if (withStale.kind !== "WakeflowDemandCancellationPreview")
    throw new Error("Expected a preview.");
  equal(withStale.status, "ready", withStale.blockers.join(","));
  const completed = await applyCompletion(scenario);
  equal(completed.disposition, "completed");
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false);
});

test("不该点名的情形：没有日志的 completed 根按原来的阻塞项回答", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await interruptCompletionAfterClaim(scenario);
  rmSync(path.join(scenario.workspace, scenario.journal));
  const preview = await completePreview(scenario)();
  if (preview.kind !== "WakeflowDemandCompletionPreview") throw new Error("Expected a preview.");
  equal(preview.status, "blocked");
  equal(preview.blockers.includes("lifecycle:completed"), true, preview.blockers.join(","));
});

test("不该点名的情形：根是符号链接时原来的拒绝不变；不是出口能治的打不开保持原来的拒绝", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await applyCompletion(scenario);
  scenario.failBeforeRename((destination) => destination === scenario.claimState);
  await rejects(applyContinuation(scenario), (error: unknown) => error instanceof WakeflowError);

  // 续接的日志在、七个可重建目录都在，根因为一个不认识的文件打不开：不是 continue 的 recover 能治的。
  writeFileSync(inRoot(scenario, "stray.txt"), "x", { mode: 0o600 });
  const unloadable = await refusalOf(continuePreview(scenario));
  equal(unloadable.code, "precondition-failed");
  equal(unloadable.reason.startsWith("demand-authority-"), true, unloadable.reason);
  rmSync(inRoot(scenario, "stray.txt"));

  const aside = `${inRoot(scenario)}.aside`;
  renameSync(inRoot(scenario), aside);
  symlinkSync(aside, inRoot(scenario));
  const symlinked = await refusalOf(completePreview(scenario));
  equal(symlinked.code === "recovery-required", false, `${symlinked.code}/${symlinked.reason}`);
  equal(symlinked.reason.startsWith("demand-root-"), true, symlinked.reason);
});
