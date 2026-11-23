import { equal, ok, rejects } from "node:assert/strict";
import { existsSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { WakeflowError } from "../../../src/kernel/error.js";
import { demandArchivesRootRef } from "../../../src/kernel/layout.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  applyCompletion,
  type LifecycleOrderCase,
  lifecycleOrderCase,
  recoverCompletion,
} from "./lifecycle-order.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：完成事务沿用已封的归档时，核对期间归档变了要拒绝为可重试的冲突，根与日志原样；归档
 * 回来之后 recover 完成（1.4.1 段 1b）。钉"沿用之前先同步"的三条顺序用例在 1.4.2 的验证瘦身里删掉了
 * （open-items D13）：那条规则还在代码里，没有测试钉着。
 */

function isRetryableConflict(reason: string) {
  return (error: unknown) =>
    error instanceof WakeflowError &&
    error.code === "concurrency-conflict" &&
    error.reason === reason &&
    error.retryable === true;
}

async function applyCompletionFailing(scenario: LifecycleOrderCase): Promise<void> {
  await rejects(applyCompletion(scenario), (error: unknown) => error instanceof WakeflowError);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), true, "日志必须留给 recover");
  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), true, "根应当还在");
}

/** 封档的发布改名之后丢掉对 `archives/<demandId>` 的那次同步：归档包已经在名字空间里，但名字没有落盘。 */
async function completionLosingArchivePublicationSync(scenario: LifecycleOrderCase): Promise<void> {
  scenario.loseSyncAfter(
    (event) =>
      event.startsWith(`rename ${scenario.archives}/.candidate-* -> ${scenario.archives}/`),
    scenario.archives,
  );
  await applyCompletionFailing(scenario);
  ok(scenario.events.includes(`sync-lost ${scenario.archives}`), scenario.events.join(" | "));
}

test("沿用已封归档：核对期间归档包不见了，拒绝为可重试的冲突，根与日志原样；归档回来之后 recover 完成", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await completionLosingArchivePublicationSync(scenario);

  const archives = path.join(
    scenario.ledger,
    ...demandArchivesRootRef(scenario.demandId).split("/"),
  );
  const revision = readdirSync(archives).find((name) => /^[0-9]{10}$/u.test(name));
  if (revision === undefined) throw new Error("Expected a sealed archive revision.");
  const aside = path.join(archives, "moved-aside");
  scenario.beforeNextSync(scenario.archives, () => {
    renameSync(path.join(archives, revision), aside);
  });
  const start = scenario.events.length;
  await rejects(
    recoverCompletion(scenario),
    isRetryableConflict("archive-settle-observation-changed"),
  );
  const refused = scenario.events.slice(start);
  equal(
    refused.some((event) => event.startsWith("rename ") || event.startsWith("removeTree ")),
    false,
    `拒绝之后不应再动根：${refused.join(" | ")}`,
  );
  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), true);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), true);

  renameSync(aside, path.join(archives, revision));
  await recoverCompletion(scenario);
  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), false);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false);
});
