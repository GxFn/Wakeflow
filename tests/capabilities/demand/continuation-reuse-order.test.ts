import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { executeStatusRequest } from "../../../src/capabilities/observation/service.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";
import {
  applyCompletion,
  applyContinuation,
  assertInOrder,
  currentNames,
  type LifecycleOrderCase,
  lifecycleOrderCase,
  recoverContinuation,
  renamedTo,
} from "./lifecycle-order.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：continue 沿用"已经在盘面上"的结果之前先把它落盘，并清掉退役根（1.4.1 段 1b，清单
 * 第 4 项的第 3、4 行，第 5 项的收尾，以及可重建目录的名字）。
 *
 * continue 的最后一步是删生命周期日志，不可逆。它之前的每一步都有一个"上一次可能死在改名或建目录之后、
 * 同步之前"的结果：放回原位的活动根（`current/<demandId>`）、根里可重建的空目录、回到 claimed 的认领
 * 状态文件。恢复看到结果已经在就沿用；这里钉住沿用之前补的那一次同步发生在删日志之前。另一条：完成
 * 事务死在"根已改名退役、还没删完"时，continue 可以接手并改写日志，所以它在放回根之前清掉退役根。
 */

async function applyContinuationFailing(scenario: LifecycleOrderCase): Promise<void> {
  await rejects(applyContinuation(scenario), (error: unknown) => error instanceof WakeflowError);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), true, "日志必须留给 recover");
}

async function assertActive(scenario: LifecycleOrderCase): Promise<void> {
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false);
  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), true);
  const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, {
    root: scenario.root,
    demandId: scenario.demandId,
  });
  equal(status.route?.lifecycle, "active");
}

test("沿用已放回的根：recover 先同步 current 把根的名字落盘，再删日志", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await applyCompletion(scenario);
  scenario.loseSyncAfter(renamedTo(scenario.demandRoot), scenario.current);
  await applyContinuationFailing(scenario);
  ok(scenario.events.includes(`sync-lost ${scenario.current}`), scenario.events.join(" | "));
  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), true, "根已经在名字空间里");

  const events = await recoverContinuation(scenario);
  equal(
    events.some(renamedTo(scenario.demandRoot)),
    false,
    `recover 不应再放回一次根：${events.join(" | ")}`,
  );
  assertInOrder(events, [`sync ${scenario.current}`, `unlink ${scenario.journal}`]);
  await assertActive(scenario);
});

test("沿用已建的可重建目录：recover 把已经在的目录名落盘，再删日志", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await applyCompletion(scenario);
  const eventSourcing = `${scenario.demandRoot}/event-sourcing`;
  // 丢的是 `event-sourcing/` 下最后一个可重建目录建出之后的那一次同步：recover 进来时这几个目录都已经
  // 在，它自己不再建任何一个，`event-sourcing/` 的同步只能来自"沿用之前先落盘"。丢更早的一次时 recover
  // 还要建剩下的目录，那几次建目录本来就会同步 `event-sourcing/`，测不出这条规则。
  const lastRebuilt = `mkdir ${eventSourcing}/append-candidates`;
  scenario.loseSyncAfter((event) => event === lastRebuilt, eventSourcing);
  await applyContinuationFailing(scenario);
  ok(scenario.events.includes(`sync-lost ${eventSourcing}`), scenario.events.join(" | "));

  const events = await recoverContinuation(scenario);
  equal(
    events.some((event) => event.startsWith(`mkdir ${eventSourcing}/`)),
    false,
    `recover 不应再建 event-sourcing 下的目录：${events.join(" | ")}`,
  );
  assertInOrder(events, [
    `sync ${scenario.current}`,
    `sync ${eventSourcing}`,
    `unlink ${scenario.journal}`,
  ]);
  await assertActive(scenario);
});

test("沿用已回到 claimed 的认领状态：recover 先同步 board，再删日志", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await applyCompletion(scenario);
  scenario.failAfterRename(renamedTo(scenario.claimState));
  await applyContinuationFailing(scenario);
  ok(scenario.events.includes("rename-interrupted"), scenario.events.join(" | "));

  const events = await recoverContinuation(scenario);
  equal(
    events.some(renamedTo(scenario.claimState)),
    false,
    `recover 不应重写认领状态：${events.join(" | ")}`,
  );
  assertInOrder(events, [`sync ${scenario.board}`, `unlink ${scenario.journal}`]);
  await assertActive(scenario);
});

test("完成事务停在退役根没删完：continue 接手，先清掉退役根再放回根，不留退役根也不留日志", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  scenario.failNextRemoveTree((target) => target === scenario.retiredRoot);
  await rejects(
    applyCompletion(scenario),
    (error: unknown) => error instanceof WakeflowError && error.reason === "demand-root-remove",
  );
  equal(currentNames(scenario, ".retire-").length, 1, "退役根应留在 current 里");
  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), false);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), true);

  const start = scenario.events.length;
  const continued = await applyContinuation(scenario);
  equal(continued.disposition, "continued");
  assertInOrder(scenario.events.slice(start), [
    `removeTree ${scenario.retiredRoot}`,
    `sync ${scenario.current}`,
    renamedTo(scenario.demandRoot),
    `unlink ${scenario.journal}`,
  ]);
  deepEqual(currentNames(scenario, ".retire-"), []);
  deepEqual(currentNames(scenario, ".restore-"), []);
  await assertActive(scenario);
});
