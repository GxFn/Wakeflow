import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { executeDemandCancellationRequest } from "../../../src/capabilities/demand/lifecycle.js";
import { executeStatusRequest } from "../../../src/capabilities/observation/service.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";
import {
  applyCompletion,
  applyContinuation,
  claimStatus,
  currentNames,
  holdNextPodLock,
  type LifecycleOrderCase,
  lifecycleOrderCase,
} from "./lifecycle-order.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：apply 执行的计划以拿到 pod 锁之后的盘面为准（1.4.1 段 1b，评审之后补的；1.4.0 就有）。
 *
 * 完成、取消与续接的计划都在 pod 锁之外算出来。两个调用各自算好计划、先后进锁时，后进的那个若不再核对，
 * 就按一份过期的计划往下做：过期的取消会盖掉完成留下的日志；过期的完成在"完成、又续接"之后会认出同一个
 * 归档提交、把续接之后还活着的根当残根删掉；过期的续接会把更早的归档放回来。这里让第一个 apply 停在取
 * pod 锁之前（拦住锁文件的 `link`），把另外的命令跑完再放行，断言它以可重试的
 * `concurrency-conflict/stream-advanced` 被拒绝，盘面停在后来的状态。同一份计划的日志还在时（被打断之后
 * 原样重发）照常接着做，由 `terminal-archive-reuse-order.test.ts` 等顺序测试覆盖。
 */

function isPlanStale(error: unknown): boolean {
  return (
    error instanceof WakeflowError &&
    error.code === "concurrency-conflict" &&
    error.reason === "stream-advanced" &&
    error.retryable
  );
}

function settled(run: Promise<unknown>): Promise<unknown> {
  // 提前挂上处理器：放行之前它不会兑现，放行之后的结果由调用方断言。
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

const CANCEL_REASON = "The work is no longer wanted.";

async function applyCancellation(scenario: LifecycleOrderCase) {
  const request = { root: scenario.root, demandId: scenario.demandId, reason: CANCEL_REASON };
  const preview = await executeDemandCancellationRequest({ ...request, mode: "preview" });
  if (preview.kind !== "WakeflowDemandCancellationPreview") throw new Error("Expected a preview.");
  if (preview.planDigest === null) throw new Error(preview.blockers.join(","));
  const cancelled = await executeDemandCancellationRequest({
    ...request,
    mode: "apply",
    planDigest: preview.planDigest,
  });
  if (cancelled.kind !== "WakeflowDemandCancellationMutation")
    throw new Error("Expected a mutation.");
  return cancelled;
}

function scopedStatus(scenario: LifecycleOrderCase) {
  return executeStatusRequest(CODEX_OBSERVATION_FACADE, {
    root: scenario.root,
    demandId: scenario.demandId,
  });
}

test("过期的完成：等锁期间 Demand 已完成又续接，拿到锁后被拒绝，续接后的根与认领原样", {
  timeout: 60_000,
}, async (t) => {
  const scenario = await lifecycleOrderCase(t);
  const held = holdNextPodLock(t);
  const staleSettled = settled(applyCompletion(scenario));
  await held.reached;

  await applyCompletion(scenario);
  const continued = await applyContinuation(scenario);
  equal(continued.disposition, "continued");

  held.release();
  const failure = await staleSettled;
  equal(isPlanStale(failure), true, `过期的完成应被拒绝：${String(failure)}`);

  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), true, "续接后的根被删了");
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false, "留下了日志");
  deepEqual(currentNames(scenario, ".retire-"), []);
  equal(await claimStatus(scenario), "claimed");
  equal((await scopedStatus(scenario)).route?.lifecycle, "active");
});

test("过期的取消：等锁期间 Demand 已完成，拿到锁后被拒绝，不留日志，归档仍是完成", {
  timeout: 60_000,
}, async (t) => {
  const scenario = await lifecycleOrderCase(t);
  const request = { root: scenario.root, demandId: scenario.demandId, reason: CANCEL_REASON };
  const preview = await executeDemandCancellationRequest({ ...request, mode: "preview" });
  if (preview.kind !== "WakeflowDemandCancellationPreview") throw new Error("Expected a preview.");
  if (preview.planDigest === null) throw new Error(preview.blockers.join(","));
  const held = holdNextPodLock(t);
  const staleSettled = settled(
    executeDemandCancellationRequest({ ...request, mode: "apply", planDigest: preview.planDigest }),
  );
  await held.reached;

  const completed = await applyCompletion(scenario);
  equal(completed.disposition, "completed");

  held.release();
  const failure = await staleSettled;
  equal(isPlanStale(failure), true, `过期的取消应被拒绝：${String(failure)}`);

  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false, "留下了日志");
  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), false);
  const status = await scopedStatus(scenario);
  equal(status.archive?.outcome, "completed");
  equal(status.next.frontier === "demand-recovery", false);
});

test("过期的续接：等锁期间 Demand 已续接又取消，拿到锁后被拒绝，不把更早的归档放回来", {
  timeout: 60_000,
}, async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await applyCompletion(scenario);
  const held = holdNextPodLock(t);
  const staleSettled = settled(applyContinuation(scenario));
  await held.reached;

  const continued = await applyContinuation(scenario);
  equal(continued.disposition, "continued");
  const cancelled = await applyCancellation(scenario);
  equal(cancelled.disposition, "cancelled");

  held.release();
  const failure = await staleSettled;
  equal(isPlanStale(failure), true, `过期的续接应被拒绝：${String(failure)}`);

  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), false, "旧归档被放回来了");
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false, "留下了日志");
  deepEqual(currentNames(scenario, ".restore-"), []);
  equal(await claimStatus(scenario), "withdrawn");
  equal((await scopedStatus(scenario)).archive?.outcome, "cancelled");
});

test("过期的续接：等锁期间另一个续接已经做完，拿到锁后被拒绝，根停在那一次续接之后", {
  timeout: 60_000,
}, async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await applyCompletion(scenario);
  const held = holdNextPodLock(t);
  const staleSettled = settled(applyContinuation(scenario));
  await held.reached;

  const continued = await applyContinuation(scenario);
  equal(continued.disposition, "continued");
  const before = (await scopedStatus(scenario)).next.subject?.streamRevision;
  equal(typeof before, "number");

  held.release();
  const failure = await staleSettled;
  equal(isPlanStale(failure), true, `过期的续接应被拒绝：${String(failure)}`);

  const after = await scopedStatus(scenario);
  equal(after.route?.lifecycle, "active");
  equal(after.next.subject?.streamRevision, before);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false, "留下了日志");
  await rejects(applyContinuation(scenario), /./u, "活动的 Demand 不能再续接");
});
