import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync, readdirSync, realpathSync, rmSync, utimesSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { executeDemandCompletionRequest } from "../../../src/capabilities/demand/lifecycle.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { RootedResourceParentHandle } from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { refreshActiveProjection } from "../../../src/governance/observation/active-projection-refresh.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { demandLifecycleJournalRef } from "../../../src/kernel/layout.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "../../governance/lifecycle/demand-completion-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 2 级（能力）：Demand 终态应用里退役活动根与删日志的先后（1.4.1 段 1b，清单第 5 项"先改名、再删"；
 * 段 1 的"整目录删除"合同并入这里）。
 *
 * 钉住的顺序：`applyTerminalLocked` 先把 Demand 根改名为 `current/.retire-<demandId>-<uuid>` 并同步
 * `current/`，再删改名后的树并再同步一次，最后持久删除生命周期日志。少任何一次同步，掉电之后都可能
 * 出现日志已经消失、而根（或退役根）又回来的状态，recover 再也找不到日志去完成退役。这里按发生顺序
 * 记录 Demand 根的 `rename`、`filesystemMutation.removeTree`、`filesystemMutation.unlink` 与父目录句柄的
 * `sync`。三条路径：一次完整的完成应用；删退役根的中途失败；根的顶层在快照之后变过。"同步丢了"的
 * 三条在 1.4.2 的验证瘦身里删掉了（open-items D13）。一次性工作区以 `none` 打开，fsync 系统调用被
 * 跳过，但同步调用本身的顺序就是要钉住的合同。
 */

interface RecordedTerminalEvents {
  readonly events: string[];
  /** Demand 根改名之后，对 `current/` 的第一次同步抛错且不执行。 */
  readonly loseSyncAfterRootRename: () => void;
  /** 下一次退役根 removeTree 之后，对 `current/` 的第一次同步抛错且不执行。 */
  readonly loseSyncAfterRetiredRootRemoval: () => void;
  /** 从现在起对 `current/` 的第一次同步抛错且不执行。 */
  readonly loseNextCurrentSync: () => void;
  /** 下一次退役根 removeTree 只删掉一个顶层文件就抛错。 */
  readonly failRetiredRootRemoval: () => void;
  /**
   * 开或关：每次有句柄从 Demand 根上关闭，就改一次根目录自己的时间。退役前的整树快照读完之后关闭的
   * 那一次落在"看过根的节点"与"改名"之间：负载不变，节点快照变了。
   */
  readonly touchRootOnClose: (enabled: boolean) => void;
}

const RETIRED_ROOT_SUFFIX = /(\.retire-demand_[0-9a-f-]{36})-[0-9a-f-]{36}$/u;

function recordTerminalEvents(
  t: TestContext,
  workspace: string,
  demandId: string,
): RecordedTerminalEvents {
  const relative = (absolute: string) =>
    path
      .relative(workspace, absolute)
      .split(path.sep)
      .join("/")
      .replace(RETIRED_ROOT_SUFFIX, "$1-*");
  const demandRoot = demandFinalRootRef(demandId);
  const current = path.posix.dirname(demandRoot);
  const retiredRoot = `${current}/.retire-${demandId}-*`;
  const events: string[] = [];
  let loseAfterRename = false;
  let loseAfterRemoval = false;
  let failRemoval = false;
  let touchRoot = false;
  let touches = 0;
  let pending = false;

  const originalRename = filesystemMutation.rename;
  t.mock.method(filesystemMutation, "rename", async (from: string, to: string) => {
    await originalRename.call(filesystemMutation, from, to);
    if (relative(from) !== demandRoot) return;
    events.push(`rename ${relative(from)} -> ${relative(to)}`);
    if (loseAfterRename) {
      loseAfterRename = false;
      pending = true;
    }
  });
  const originalRemoveTree = filesystemMutation.removeTree;
  t.mock.method(filesystemMutation, "removeTree", async (target: string) => {
    const retired = relative(target) === retiredRoot;
    if (retired && failRemoval) {
      failRemoval = false;
      rmSync(path.join(target, "identity.json"), { force: true });
      events.push(`removeTree-failed ${relative(target)}`);
      throw Object.assign(new Error("injected tree removal failure"), { code: "EIO" });
    }
    await originalRemoveTree.call(filesystemMutation, target);
    events.push(`removeTree ${relative(target)}`);
    if (retired && loseAfterRemoval) {
      loseAfterRemoval = false;
      pending = true;
    }
  });
  const originalUnlink = filesystemMutation.unlink;
  t.mock.method(filesystemMutation, "unlink", async (target: string) => {
    await originalUnlink.call(filesystemMutation, target);
    events.push(`unlink ${relative(target)}`);
  });
  const originalSync = RootedResourceParentHandle.prototype.sync;
  t.mock.method(
    RootedResourceParentHandle.prototype,
    "sync",
    async function observedSync(this: RootedResourceParentHandle) {
      const directory = relative(path.dirname(this.resourceAbsolutePath));
      if (pending && directory === current) {
        pending = false;
        events.push(`sync-lost ${directory}`);
        throw Object.assign(new Error("injected parent sync loss"), { code: "EIO" });
      }
      events.push(`sync ${directory}`);
      return originalSync.call(this);
    },
  );
  const originalClose = RootedDirectory.prototype.close;
  t.mock.method(
    RootedDirectory.prototype,
    "close",
    async function observedClose(this: RootedDirectory) {
      const opened = this.absolutePath;
      await originalClose.call(this);
      if (!touchRoot || relative(opened) !== demandRoot) return;
      touches += 1;
      const later = new Date(Date.now() + touches * 60_000);
      utimesSync(opened, later, later);
      events.push(`touch ${relative(opened)}`);
    },
  );
  return Object.freeze({
    events,
    loseSyncAfterRootRename: () => {
      loseAfterRename = true;
    },
    loseSyncAfterRetiredRootRemoval: () => {
      loseAfterRemoval = true;
    },
    loseNextCurrentSync: () => {
      pending = true;
    },
    failRetiredRootRemoval: () => {
      failRemoval = true;
    },
    touchRootOnClose: (enabled: boolean) => {
      touchRoot = enabled;
    },
  });
}

type CompletionFixture = Awaited<ReturnType<typeof createAcceptedDemandCompletionWorkspaceFixture>>;

interface TerminalCase {
  readonly fixture: CompletionFixture;
  readonly workspace: string;
  readonly demandRoot: string;
  readonly current: string;
  readonly retiredRoot: string;
  readonly journal: string;
  readonly recorded: RecordedTerminalEvents;
}

async function terminalCase(t: TestContext): Promise<TerminalCase> {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  t.after(() => cleanupAcceptedDemandCompletionWorkspaceFixture(fixture));
  const workspace = realpathSync(fixture.workspacePath);
  const demandRoot = demandFinalRootRef(fixture.demandId);
  const current = path.posix.dirname(demandRoot);
  return Object.freeze({
    fixture,
    workspace,
    demandRoot,
    current,
    retiredRoot: `${current}/.retire-${fixture.demandId}-*`,
    journal: demandLifecycleJournalRef(fixture.demandId),
    recorded: recordTerminalEvents(t, workspace, fixture.demandId),
  });
}

function retiredRootNames(scenario: TerminalCase): readonly string[] {
  return readdirSync(path.join(scenario.workspace, scenario.current)).filter((name) =>
    name.startsWith(".retire-"),
  );
}

function isDemandRootRemoveFailure(error: unknown): boolean {
  return (
    error instanceof WakeflowError &&
    error.code === "io-failure" &&
    error.reason === "demand-root-remove"
  );
}

/** 完成应用以 io-failure `demand-root-remove` 失败：根已离开自己的名字，日志留给 recover。 */
async function applyFailingRootRemoval(scenario: TerminalCase): Promise<void> {
  await rejects(
    executeDemandCompletionRequest({
      root: scenario.fixture.workspacePath,
      mode: "apply",
      demandId: scenario.fixture.demandId,
    }),
    isDemandRootRemoveFailure,
  );
  equal(
    existsSync(path.join(scenario.workspace, scenario.demandRoot)),
    false,
    "Demand 根应已离开自己的名字",
  );
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), true, "日志必须留给 recover");
}

/** recover 成功之后：日志已删、没有退役根留下；返回这一次 recover 期间的事件。 */
async function recoverCompletion(scenario: TerminalCase): Promise<readonly string[]> {
  const start = scenario.recorded.events.length;
  const recovered = await executeDemandCompletionRequest({
    root: scenario.fixture.workspacePath,
    mode: "recover",
    operationId: scenario.fixture.demandId,
  });
  if (recovered.kind !== "WakeflowDemandCompletionMutation")
    throw new Error("Expected a mutation.");
  equal(recovered.disposition, "recovered");
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), false);
  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), false);
  deepEqual(retiredRootNames(scenario), []);
  return scenario.recorded.events.slice(start);
}

/** `events` 里 `first` 之后出现 `second`，返回 `second` 的位置。 */
function after(events: readonly string[], first: number, second: string): number {
  const found = events.indexOf(second, first + 1);
  ok(first >= 0 && found > first, `"${second}" 不在预期的位置：${events.join(" | ")}`);
  return found;
}

/** recover 见根已不在：先清退役根（留着的话）、同步 `current/`，再删日志。 */
function assertRecoverClearedRetiredRoot(scenario: TerminalCase, events: readonly string[]): void {
  const removed = events.indexOf(`removeTree ${scenario.retiredRoot}`);
  ok(removed >= 0, `recover 没有清掉退役根：${events.join(" | ")}`);
  const removalSync = after(events, removed, `sync ${scenario.current}`);
  after(events, removalSync, `unlink ${scenario.journal}`);
  equal(
    events.some((event) => event.startsWith("rename ")),
    false,
    `recover 不应再改名：${events.join(" | ")}`,
  );
}

test("完成应用：根先改名为退役根并同步 current，再删退役根并同步 current，最后 unlink 生命周期日志", async (t) => {
  const scenario = await terminalCase(t);
  const { events } = scenario.recorded;

  const completed = await executeDemandCompletionRequest({
    root: scenario.fixture.workspacePath,
    mode: "apply",
    demandId: scenario.fixture.demandId,
  });
  equal(completed.kind, "WakeflowDemandCompletionMutation");

  const renamed = events.indexOf(`rename ${scenario.demandRoot} -> ${scenario.retiredRoot}`);
  ok(renamed >= 0, `Demand 根没有改名为退役根：${events.join(" | ")}`);
  const renameSync = after(events, renamed, `sync ${scenario.current}`);
  const removed = after(events, renameSync, `removeTree ${scenario.retiredRoot}`);
  const removalSync = after(events, removed, `sync ${scenario.current}`);
  after(events, removalSync, `unlink ${scenario.journal}`);
  equal(
    events.includes(`removeTree ${scenario.demandRoot}`),
    false,
    `不应在 Demand 自己的名字下删树：${events.join(" | ")}`,
  );
  deepEqual(retiredRootNames(scenario), []);
});

test("删退役根中途失败：根已不在自己的名字下，半棵退役根与日志留着；recover 清掉退役根、同步、再 unlink 日志", async (t) => {
  const scenario = await terminalCase(t);
  scenario.recorded.failRetiredRootRemoval();
  await applyFailingRootRemoval(scenario);
  ok(scenario.recorded.events.includes(`removeTree-failed ${scenario.retiredRoot}`));
  equal(retiredRootNames(scenario).length, 1, "半棵退役根应留在 current 里");

  assertRecoverClearedRetiredRoot(scenario, await recoverCompletion(scenario));
});

test("recover 补完终态事务之后活动投影已经重算：再刷新一次没有页面要改", async (t) => {
  const scenario = await terminalCase(t);
  scenario.recorded.failRetiredRootRemoval();
  await applyFailingRootRemoval(scenario);
  await recoverCompletion(scenario);
  const root = await RootedDirectory.open(scenario.workspace, "$root");
  try {
    equal((await refreshActiveProjection(root)).disposition, "current");
  } finally {
    await root.close();
  }
});

test("根的顶层在快照之后变过：改名之前拒绝为可重试的 demand-root-drift，根与日志原样；recover 走残根清除完成", async (t) => {
  const scenario = await terminalCase(t);
  scenario.recorded.touchRootOnClose(true);
  await rejects(
    executeDemandCompletionRequest({
      root: scenario.fixture.workspacePath,
      mode: "apply",
      demandId: scenario.fixture.demandId,
    }),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "precondition-failed" &&
      error.reason === "demand-root-drift" &&
      error.retryable === true,
  );
  scenario.recorded.touchRootOnClose(false);
  ok(scenario.recorded.events.includes(`touch ${scenario.demandRoot}`));
  equal(
    scenario.recorded.events.some((event) => event.startsWith("rename ")),
    false,
    "改名不应发生",
  );
  equal(existsSync(path.join(scenario.workspace, scenario.demandRoot)), true);
  equal(existsSync(path.join(scenario.workspace, scenario.journal)), true);
  deepEqual(retiredRootNames(scenario), []);

  const events = await recoverCompletion(scenario);
  const renamed = events.indexOf(`rename ${scenario.demandRoot} -> ${scenario.retiredRoot}`);
  ok(renamed >= 0, `recover 没有把残根改名：${events.join(" | ")}`);
  const removed = after(events, renamed, `removeTree ${scenario.retiredRoot}`);
  after(events, removed, `unlink ${scenario.journal}`);
});
