import { equal, ok, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { WakeflowError } from "../../../src/kernel/error.js";
import { demandArchivesRootRef } from "../../../src/kernel/layout.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  applyCompletion,
  assertInOrder,
  indexOfEvent,
  type LifecycleOrderCase,
  lifecycleOrderCase,
  recoverCompletion,
  renamedTo,
} from "./lifecycle-order.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：完成事务沿用"已经在盘面上"的结果之前先把它落盘（1.4.1 段 1b，清单第 4 项的第 2、5 行）。
 *
 * 完成事务的后两步是删活动根、删生命周期日志，都不可逆。它们之前的两步各有一个"上一次可能死在改名之后、
 * 同步之前"的结果：已封的归档包（`archives/<demandId>/<修订号>`，以及 `archives/<demandId>` 这个目录
 * 自己），和已经置成 archived 的认领状态文件。重试看到结果已经在，就直接沿用；这里钉住沿用之前补的
 * 那一次同步发生在删根与删日志之前，以及核对期间结果变了时拒绝为可重试、根与日志原样。
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

test("沿用已封归档：recover 先同步 archives 与 archives/<demandId>，再把根改名退役、删日志", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await completionLosingArchivePublicationSync(scenario);

  const events = await recoverCompletion(scenario);
  assertInOrder(events, [
    "sync ledger:archives",
    `sync ${scenario.archives}`,
    renamedTo(scenario.retiredRoot),
    `unlink ${scenario.journal}`,
  ]);
});

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

test("封档时 archives/<demandId> 已经在：先同步 archives 把这个名字落盘，再往里放归档", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  mkdirSync(path.join(scenario.ledger, ...demandArchivesRootRef(scenario.demandId).split("/")), {
    mode: 0o755,
  });

  await applyCompletion(scenario);
  assertInOrder(scenario.events, [
    "sync ledger:archives",
    (event) => event.startsWith(`rename ${scenario.archives}/.candidate-* -> `),
    renamedTo(scenario.retiredRoot),
    `unlink ${scenario.journal}`,
  ]);
});

test("沿用已置终态的认领状态：recover 先同步 board，再把根改名退役、删日志", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  scenario.failAfterRename(renamedTo(scenario.claimState));
  await applyCompletionFailing(scenario);
  ok(scenario.events.includes("rename-interrupted"), scenario.events.join(" | "));

  const events = await recoverCompletion(scenario);
  const settled = indexOfEvent(events, `sync ${scenario.board}`);
  equal(
    events.slice(0, settled).some(renamedTo(scenario.claimState)),
    false,
    `recover 不应重写认领状态：${events.join(" | ")}`,
  );
  assertInOrder(events, [
    `sync ${scenario.board}`,
    renamedTo(scenario.retiredRoot),
    `unlink ${scenario.journal}`,
  ]);
});
