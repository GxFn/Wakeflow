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
  lifecycleOrderCase,
  recoverCompletion,
  recoverContinuation,
  renamedTo,
} from "./lifecycle-order.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：recover 重放哪一份日志，以拿到 pod 锁之后读到的为准（1.4.1 段 1b）。
 *
 * 钉住的丢数据顺序（1.4.0 就有）：一个 recover 在锁外读到日志、然后等 pod 锁；等的期间另一个 recover
 * 把同一份日志收尾并删掉，接着别的命令改变了这个 Demand（续接，或再取消一次）。先前那个 recover 拿到
 * 锁之后若仍按锁外的旧副本重放：完成的 recover 会把日志写回去、把续接之后还活着的根当残根删掉；续接的
 * recover 会把更早的归档盖回到一个之后已经取消的 Demand 上。这里让第一个 recover 停在取 pod 锁之前
 * （拦住锁文件的 `link`），把另外两步跑完再放行，断言它按"日志已不在"回答、Demand 停在后来的状态。
 */

function isJournalAbsent(error: unknown): boolean {
  return (
    error instanceof WakeflowError &&
    error.code === "not-found" &&
    error.reason === "journal-absent"
  );
}

test("完成的 recover 等锁期间日志已被收尾、Demand 已续接：拿到锁后按日志已不在回答，续接后的根与认领原样", {
  timeout: 60_000,
}, async (t) => {
  const scenario = await lifecycleOrderCase(t);
  scenario.failNextRemoveTree((target) => target === scenario.retiredRoot);
  await rejects(applyCompletion(scenario), (error: unknown) => error instanceof WakeflowError);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), true);

  const held = holdNextPodLock(t);
  const stale = recoverCompletion(scenario);
  // 提前挂上处理器：放行之前它不会兑现，放行之后的结果在下面断言。
  const staleSettled = stale.then(
    () => null,
    (error: unknown) => error,
  );
  await held.reached;

  await recoverCompletion(scenario);
  const continued = await applyContinuation(scenario);
  equal(continued.disposition, "continued");

  held.release();
  const failure = await staleSettled;
  equal(isJournalAbsent(failure), true, `过期的 recover 应按日志已不在回答：${String(failure)}`);

  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), true, "续接后的根被删了");
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false, "日志被写回来了");
  deepEqual(currentNames(scenario, ".retire-"), []);
  equal(await claimStatus(scenario), "claimed");
  const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, {
    root: scenario.root,
    demandId: scenario.demandId,
  });
  equal(status.route?.lifecycle, "active");
});

test("续接的 recover 等锁期间日志已被收尾、Demand 又被取消：拿到锁后按日志已不在回答，不把旧归档放回来", {
  timeout: 60_000,
}, async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await applyCompletion(scenario);
  scenario.failAfterRename(renamedTo(scenario.claimState));
  await rejects(applyContinuation(scenario), (error: unknown) => error instanceof WakeflowError);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), true);

  const held = holdNextPodLock(t);
  const stale = recoverContinuation(scenario);
  const staleSettled = stale.then(
    () => null,
    (error: unknown) => error,
  );
  await held.reached;

  await recoverContinuation(scenario);
  const reason = "The continuation is no longer wanted.";
  const preview = await executeDemandCancellationRequest({
    root: scenario.root,
    mode: "preview",
    demandId: scenario.demandId,
    reason,
  });
  if (preview.kind !== "WakeflowDemandCancellationPreview") throw new Error("Expected a preview.");
  if (preview.planDigest === null) throw new Error(preview.blockers.join(","));
  const cancelled = await executeDemandCancellationRequest({
    root: scenario.root,
    mode: "apply",
    demandId: scenario.demandId,
    reason,
    planDigest: preview.planDigest,
  });
  if (cancelled.kind !== "WakeflowDemandCancellationMutation")
    throw new Error("Expected a mutation.");
  equal(cancelled.disposition, "cancelled");

  held.release();
  const failure = await staleSettled;
  equal(isJournalAbsent(failure), true, `过期的 recover 应按日志已不在回答：${String(failure)}`);

  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), false, "旧归档被放回来了");
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false, "日志被写回来了");
  deepEqual(currentNames(scenario, ".restore-"), []);
  equal(await claimStatus(scenario), "withdrawn");
});
