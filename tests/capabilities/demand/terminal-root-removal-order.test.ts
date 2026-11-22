import { equal, ok, rejects } from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { executeDemandCompletionRequest } from "../../../src/capabilities/demand/lifecycle.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { RootedResourceParentHandle } from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { demandLifecycleJournalRef } from "../../../src/kernel/layout.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "../../governance/lifecycle/demand-completion-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 2 级（能力）：Demand 终态应用里删根与删日志的先后（1.4.1 第 1 段，清单 2.1“整目录删除”）。
 *
 * 钉住的掉电风险：`applyTerminalLocked` 先退役 Demand 根、再持久删除生命周期日志。若删根之后
 * 不同步其父目录，掉电后可能出现日志已经消失、而 Demand 根又回来的状态，recover 再也找不到
 * 日志去完成退役。这里按发生顺序记录 `filesystemMutation.removeTree`、`filesystemMutation.unlink`
 * 与父目录句柄的 `sync`，断言 Demand 根消失之后、日志的 `unlink` 之前有一次对 Demand 根父目录的
 * 同步。三种路径：一次完整的完成应用；删根之后父目录同步没有发生（同步失败，或进程恰在
 * 这里被杀，两者留下的磁盘状态相同）、随后 recover 发现根已不在的重试；以及 recover 在根已
 * 不在的分支里自己的那次父目录同步失败：recover 报同一个 io-failure、日志留着，再一次 recover
 * 仍先同步再删日志。一次性工作区以 `none` 打开，fsync 系统调用被跳过，但同步调用本身的顺序
 * 就是要钉住的合同。
 */

interface RecordedTerminalEvents {
  readonly events: string[];
  /** 下一次 Demand 根 removeTree 之后，对 Demand 根父目录的第一次同步抛错且不执行。 */
  readonly failNextRootParentSync: () => void;
  /** 从现在起对 Demand 根父目录的第一次同步抛错且不执行（不要求之前删过根）。 */
  readonly failNextRootParentSyncNow: () => void;
}

function recordTerminalEvents(
  t: TestContext,
  workspace: string,
  demandId: string,
): RecordedTerminalEvents {
  const relative = (absolute: string) =>
    path.relative(workspace, absolute).split(path.sep).join("/");
  const demandRoot = demandFinalRootRef(demandId);
  const events: string[] = [];
  let armed = false;
  let pending = false;
  const originalRemoveTree = filesystemMutation.removeTree;
  t.mock.method(filesystemMutation, "removeTree", async (target: string) => {
    await originalRemoveTree.call(filesystemMutation, target);
    events.push(`removeTree ${relative(target)}`);
    if (armed && relative(target) === demandRoot) {
      armed = false;
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
      if (pending && directory === path.posix.dirname(demandRoot)) {
        pending = false;
        events.push(`sync-lost ${directory}`);
        throw Object.assign(new Error("injected parent sync loss"), { code: "EIO" });
      }
      events.push(`sync ${directory}`);
      return originalSync.call(this);
    },
  );
  return Object.freeze({
    events,
    failNextRootParentSync: () => {
      armed = true;
    },
    failNextRootParentSyncNow: () => {
      pending = true;
    },
  });
}

type CompletionFixture = Awaited<ReturnType<typeof createAcceptedDemandCompletionWorkspaceFixture>>;

function isDemandRootRemoveFailure(error: unknown): boolean {
  return (
    error instanceof WakeflowError &&
    error.code === "io-failure" &&
    error.reason === "demand-root-remove"
  );
}

/** 完成应用在删根之后丢掉父目录同步：报 io-failure，根已离开命名空间，日志留给 recover。 */
async function applyLosingRootParentSync(
  fixture: CompletionFixture,
  workspace: string,
  recorded: RecordedTerminalEvents,
): Promise<void> {
  const demandRoot = demandFinalRootRef(fixture.demandId);
  recorded.failNextRootParentSync();
  await rejects(
    executeDemandCompletionRequest({
      root: fixture.workspacePath,
      mode: "apply",
      demandId: fixture.demandId,
    }),
    isDemandRootRemoveFailure,
  );
  ok(
    recorded.events.includes(`sync-lost ${path.posix.dirname(demandRoot)}`),
    recorded.events.join(" | "),
  );
  equal(existsSync(path.join(workspace, demandRoot)), false, "Demand 根应已从命名空间消失");
  equal(
    existsSync(path.join(workspace, demandLifecycleJournalRef(fixture.demandId))),
    true,
    "日志必须留给 recover",
  );
}

/** recover 成功：不再删根，删日志之前同步过 Demand 根的父目录。 */
async function recoverSyncingBeforeJournalUnlink(
  fixture: CompletionFixture,
  workspace: string,
  events: readonly string[],
): Promise<void> {
  const demandRoot = demandFinalRootRef(fixture.demandId);
  const journal = demandLifecycleJournalRef(fixture.demandId);
  const recoverStart = events.length;
  const recovered = await executeDemandCompletionRequest({
    root: fixture.workspacePath,
    mode: "recover",
    operationId: fixture.demandId,
  });
  if (recovered.kind !== "WakeflowDemandCompletionMutation")
    throw new Error("Expected a mutation.");
  equal(recovered.disposition, "recovered");
  equal(existsSync(path.join(workspace, journal)), false);
  const recoverEvents = events.slice(recoverStart);
  equal(
    recoverEvents.some((event) => event.startsWith("removeTree ")),
    false,
    `recover 不应再删根：${recoverEvents.join(" | ")}`,
  );
  const unlinked = recoverEvents.indexOf(`unlink ${journal}`);
  ok(unlinked >= 0, `recover 没有删除日志：${recoverEvents.join(" | ")}`);
  const parentSync = recoverEvents.indexOf(`sync ${path.posix.dirname(demandRoot)}`);
  ok(
    parentSync >= 0 && parentSync < unlinked,
    `recover 删日志之前没有同步 Demand 根的父目录：${recoverEvents.join(" | ")}`,
  );
}

test("完成应用：Demand 根 removeTree 之后先同步它的父目录，再 unlink 生命周期日志", async (t) => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  t.after(() => cleanupAcceptedDemandCompletionWorkspaceFixture(fixture));
  const workspace = realpathSync(fixture.workspacePath);
  const demandId = fixture.demandId;
  const { events } = recordTerminalEvents(t, workspace, demandId);

  const completed = await executeDemandCompletionRequest({
    root: fixture.workspacePath,
    mode: "apply",
    demandId,
  });
  equal(completed.kind, "WakeflowDemandCompletionMutation");

  const demandRoot = demandFinalRootRef(demandId);
  const journal = demandLifecycleJournalRef(demandId);
  const removed = events.indexOf(`removeTree ${demandRoot}`);
  const unlinked = events.indexOf(`unlink ${journal}`);
  ok(removed >= 0, `Demand 根的 removeTree 未出现：${events.join(" | ")}`);
  ok(unlinked > removed, `日志的 unlink 不在删根之后：${events.join(" | ")}`);
  const parentSync = events.indexOf(`sync ${path.posix.dirname(demandRoot)}`, removed);
  ok(
    parentSync > removed && parentSync < unlinked,
    `删根与删日志之间没有 Demand 根父目录的同步：${events.join(" | ")}`,
  );
});

test("删根之后父目录同步丢失：应用报 io-failure、日志留着；recover 见根已不在，先同步根的父目录再 unlink 日志", async (t) => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  t.after(() => cleanupAcceptedDemandCompletionWorkspaceFixture(fixture));
  const workspace = realpathSync(fixture.workspacePath);
  const recorded = recordTerminalEvents(t, workspace, fixture.demandId);

  await applyLosingRootParentSync(fixture, workspace, recorded);
  await recoverSyncingBeforeJournalUnlink(fixture, workspace, recorded.events);
});

test("recover 见根已不在、自己的父目录同步失败：报 io-failure、日志留着；再一次 recover 先同步再 unlink 日志", async (t) => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  t.after(() => cleanupAcceptedDemandCompletionWorkspaceFixture(fixture));
  const workspace = realpathSync(fixture.workspacePath);
  const demandId = fixture.demandId;
  const parentDirectory = path.posix.dirname(demandFinalRootRef(demandId));
  const journal = demandLifecycleJournalRef(demandId);
  const recorded = recordTerminalEvents(t, workspace, demandId);
  const { events } = recorded;

  await applyLosingRootParentSync(fixture, workspace, recorded);

  // 根已不在的分支里那次父目录同步失败：失败必须报出，日志不能被删。
  const failedRecoverStart = events.length;
  recorded.failNextRootParentSyncNow();
  await rejects(
    executeDemandCompletionRequest({
      root: fixture.workspacePath,
      mode: "recover",
      operationId: demandId,
    }),
    isDemandRootRemoveFailure,
  );
  const failedRecoverEvents = events.slice(failedRecoverStart);
  ok(
    failedRecoverEvents.includes(`sync-lost ${parentDirectory}`),
    `recover 没有走到根已不在分支的父目录同步：${failedRecoverEvents.join(" | ")}`,
  );
  equal(
    failedRecoverEvents.some((event) => event.startsWith("removeTree ")),
    false,
    `recover 不应再删根：${failedRecoverEvents.join(" | ")}`,
  );
  equal(
    failedRecoverEvents.includes(`unlink ${journal}`),
    false,
    `父目录同步失败之后日志被删：${failedRecoverEvents.join(" | ")}`,
  );
  equal(existsSync(path.join(workspace, journal)), true, "日志必须留给下一次 recover");

  await recoverSyncingBeforeJournalUnlink(fixture, workspace, events);
});
