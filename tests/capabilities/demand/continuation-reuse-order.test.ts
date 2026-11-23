import { deepEqual, equal, rejects } from "node:assert/strict";
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
  renamedTo,
} from "./lifecycle-order.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：完成事务死在"根已改名退役、还没删完"时，continue 可以接手并改写日志，所以它在放回根
 * 之前清掉退役根（1.4.1 段 1b）。钉"沿用之前先落盘"的三条顺序用例在 1.4.2 的验证瘦身里删掉了
 * （open-items D13）：那条规则还在代码里，没有测试钉着。
 */

async function assertActive(scenario: LifecycleOrderCase): Promise<void> {
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false);
  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), true);
  const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, {
    root: scenario.root,
    demandId: scenario.demandId,
  });
  equal(status.route?.lifecycle, "active");
}

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
