import { ok } from "node:assert/strict";
import { readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";

import {
  executeDemandCompletionRequest,
  executeDemandContinuationRequest,
} from "../../../src/capabilities/demand/lifecycle.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { RootedResourceParentHandle } from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import {
  demandArchivesRootRef,
  demandFinalRootRef,
  demandLifecycleJournalRef,
  requirementClaimStateRef,
} from "../../../src/kernel/layout.js";
import { readRequirementClaimState } from "../../../src/kernel/requirement-board.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "../../governance/lifecycle/demand-completion-service.fixture.js";
import { PLANNING_REQUIREMENT_ID } from "../../governance/tasking/target-task-planning-service.fixture.js";

/**
 * 生命周期事务的顺序记录（1.4.1 段 1b 的"沿用之前先落盘"各测试共用）：按发生的先后记下改名、删树、
 * 删文件、建目录与父目录句柄的同步，并在指定位置注入一次失败。
 *
 * 路径相对工作区根；账本里的路径带 `ledger:` 前缀。名字里随进程变的那一段被换成 `*`：退役根
 * `.retire-<demandId>-*`、恢复候选 `.restore-<demandId>-*`、归档候选 `.candidate-*`、原子写的暂存名
 * `.wakeflow-atomic-*`。同步"丢失"用抛错且不执行模拟：同步失败与进程恰在这里被杀留下的磁盘状态相同。
 * 一次性工作区以 `none` 打开，fsync 系统调用被跳过，但同步调用本身的先后就是要钉住的合同。
 */

type CompletionFixture = Awaited<ReturnType<typeof createAcceptedDemandCompletionWorkspaceFixture>>;

export interface LifecycleOrderCase {
  readonly fixture: CompletionFixture;
  readonly root: string;
  readonly demandId: string;
  readonly workspace: string;
  readonly ledger: string;
  /** `.wakeflow-active/current`。 */
  readonly current: string;
  readonly demandRoot: string;
  readonly retiredRoot: string;
  readonly restoringRoot: string;
  readonly journal: string;
  readonly board: string;
  readonly claimState: string;
  /** `ledger:archives/<demandId>`。 */
  readonly archives: string;
  readonly events: string[];
  /** 下一条满足 `after` 的事件之后，对 `directory` 的第一次同步抛错且不执行。 */
  readonly loseSyncAfter: (after: (event: string) => boolean, directory: string) => void;
  /** 对 `directory` 的下一次同步之前先运行 `action`（同步照常执行）。 */
  readonly beforeNextSync: (directory: string, action: () => void) => void;
  /** 下一次目标满足 `target` 的 removeTree 不执行、抛错。 */
  readonly failNextRemoveTree: (target: (relativePath: string) => boolean) => void;
  /**
   * 下一条满足 `match` 的改名照常执行，然后抛错：盘面与"进程死在改名之后"相同。原子文件写在 `none`
   * 根上不调用父目录同步，丢同步的注入对它不起作用，用这一个。
   */
  readonly failAfterRename: (match: (event: string) => boolean) => void;
  /** 下一次目的地满足 `destination` 的改名不执行、抛错：盘面与"进程死在改名之前"相同。 */
  readonly failBeforeRename: (destination: (relativePath: string) => boolean) => void;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const VOLATILE_NAMES: readonly (readonly [RegExp, string])[] = [
  [new RegExp(`(\\.(?:retire|restore)-demand_${UUID})-${UUID}`, "gu"), "$1-*"],
  [/\.candidate-[0-9]{10}-[0-9a-f-]{36}/gu, ".candidate-*"],
  [/\.wakeflow-atomic-[^/]+/gu, ".wakeflow-atomic-*"],
];

function label(roots: { workspace: string; ledger: string }, absolute: string): string {
  const inLedger = absolute === roots.ledger || absolute.startsWith(`${roots.ledger}${path.sep}`);
  const relative = path
    .relative(inLedger ? roots.ledger : roots.workspace, absolute)
    .split(path.sep)
    .join("/");
  const stable = VOLATILE_NAMES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    relative,
  );
  return inLedger ? `ledger:${stable}` : stable;
}

interface Injections {
  syncLossArmed: { after: (event: string) => boolean; directory: string } | null;
  syncLossPending: string | null;
  beforeSync: { directory: string; action: () => void } | null;
  removeTreeFailure: ((relativePath: string) => boolean) | null;
  renameFailure: ((event: string) => boolean) | null;
  renameRefusal: ((relativePath: string) => boolean) | null;
}

function recordOrder(
  t: TestContext,
  roots: { workspace: string; ledger: string },
  events: string[],
  injections: Injections,
): void {
  const record = (event: string) => {
    events.push(event);
    const armed = injections.syncLossArmed;
    if (armed?.after(event) === true) {
      injections.syncLossArmed = null;
      injections.syncLossPending = armed.directory;
    }
  };
  const originalRename = filesystemMutation.rename;
  t.mock.method(filesystemMutation, "rename", async (from: string, to: string) => {
    if (injections.renameRefusal?.(label(roots, to)) === true) {
      injections.renameRefusal = null;
      record(`rename-refused ${label(roots, to)}`);
      throw Object.assign(new Error("injected failure before rename"), { code: "EIO" });
    }
    await originalRename.call(filesystemMutation, from, to);
    const event = `rename ${label(roots, from)} -> ${label(roots, to)}`;
    record(event);
    if (injections.renameFailure?.(event) === true) {
      injections.renameFailure = null;
      record("rename-interrupted");
      throw Object.assign(new Error("injected failure after rename"), { code: "EIO" });
    }
  });
  const originalRemoveTree = filesystemMutation.removeTree;
  t.mock.method(filesystemMutation, "removeTree", async (target: string) => {
    const relative = label(roots, target);
    if (injections.removeTreeFailure?.(relative) === true) {
      injections.removeTreeFailure = null;
      record(`removeTree-failed ${relative}`);
      throw Object.assign(new Error("injected tree removal failure"), { code: "EIO" });
    }
    await originalRemoveTree.call(filesystemMutation, target);
    record(`removeTree ${relative}`);
  });
  const originalUnlink = filesystemMutation.unlink;
  t.mock.method(filesystemMutation, "unlink", async (target: string) => {
    await originalUnlink.call(filesystemMutation, target);
    record(`unlink ${label(roots, target)}`);
  });
  const originalMkdir = filesystemMutation.mkdir;
  t.mock.method(
    filesystemMutation,
    "mkdir",
    async (target: string, options: Parameters<typeof originalMkdir>[1]) => {
      await originalMkdir.call(filesystemMutation, target, options);
      record(`mkdir ${label(roots, target)}`);
    },
  );
  const originalSync = RootedResourceParentHandle.prototype.sync;
  t.mock.method(
    RootedResourceParentHandle.prototype,
    "sync",
    async function observedSync(this: RootedResourceParentHandle) {
      const directory = label(roots, path.dirname(this.resourceAbsolutePath));
      if (injections.syncLossPending === directory) {
        injections.syncLossPending = null;
        record(`sync-lost ${directory}`);
        throw Object.assign(new Error("injected parent sync loss"), { code: "EIO" });
      }
      if (injections.beforeSync?.directory === directory) {
        const { action } = injections.beforeSync;
        injections.beforeSync = null;
        action();
      }
      record(`sync ${directory}`);
      return originalSync.call(this);
    },
  );
}

/** 一个实现目标已 accept 的 Demand，外加从现在起的顺序记录。 */
export async function lifecycleOrderCase(t: TestContext): Promise<LifecycleOrderCase> {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  t.after(() => cleanupAcceptedDemandCompletionWorkspaceFixture(fixture));
  const roots = {
    workspace: realpathSync(fixture.workspacePath),
    ledger: realpathSync(path.join(fixture.fixtureRoot, "wakeflow-ledger")),
  };
  const demandId = fixture.demandId;
  const demandRoot = demandFinalRootRef(demandId);
  const current = path.posix.dirname(demandRoot);
  const claimState = requirementClaimStateRef(PLANNING_REQUIREMENT_ID);
  const events: string[] = [];
  const injections: Injections = {
    syncLossArmed: null,
    syncLossPending: null,
    beforeSync: null,
    removeTreeFailure: null,
    renameFailure: null,
    renameRefusal: null,
  };
  recordOrder(t, roots, events, injections);
  return Object.freeze({
    fixture,
    root: fixture.workspacePath,
    demandId,
    ...roots,
    current,
    demandRoot,
    retiredRoot: `${current}/.retire-${demandId}-*`,
    restoringRoot: `${current}/.restore-${demandId}-*`,
    journal: demandLifecycleJournalRef(demandId),
    board: path.posix.dirname(claimState),
    claimState,
    archives: `ledger:${demandArchivesRootRef(demandId)}`,
    events,
    loseSyncAfter: (after: (event: string) => boolean, directory: string) => {
      injections.syncLossArmed = { after, directory };
    },
    beforeNextSync: (directory: string, action: () => void) => {
      injections.beforeSync = { directory, action };
    },
    failNextRemoveTree: (target: (relativePath: string) => boolean) => {
      injections.removeTreeFailure = target;
    },
    failAfterRename: (match: (event: string) => boolean) => {
      injections.renameFailure = match;
    },
    failBeforeRename: (destination: (relativePath: string) => boolean) => {
      injections.renameRefusal = destination;
    },
  });
}

/** `events` 里从 `from` 起第一条满足 `match` 的事件的位置；没有就让测试失败并打印整段记录。 */
function indexOfEvent(
  events: readonly string[],
  match: string | ((event: string) => boolean),
  from = 0,
): number {
  const test = typeof match === "string" ? (event: string) => event === match : match;
  const found = events.findIndex((event, index) => index >= from && test(event));
  ok(
    found >= 0,
    `没有找到 ${typeof match === "string" ? `"${match}"` : "预期的事件"}：${events.slice(from).join(" | ")}`,
  );
  return found;
}

/** 依次出现：每一项都在前一项之后。 */
export function assertInOrder(
  events: readonly string[],
  sequence: readonly (string | ((event: string) => boolean))[],
): void {
  let from = 0;
  for (const match of sequence) from = indexOfEvent(events, match, from) + 1;
}

export const renamedTo = (destination: string) => (event: string) =>
  event.startsWith("rename ") && event.endsWith(` -> ${destination}`);

/** `current/` 里以 `prefix` 开头的名字。 */
export function currentNames(scenario: LifecycleOrderCase, prefix: string): readonly string[] {
  return readdirSync(path.join(scenario.workspace, scenario.current)).filter((name) =>
    name.startsWith(prefix),
  );
}

export async function applyCompletion(scenario: LifecycleOrderCase) {
  const completed = await executeDemandCompletionRequest({
    root: scenario.root,
    mode: "apply",
    demandId: scenario.demandId,
  });
  if (completed.kind !== "WakeflowDemandCompletionMutation")
    throw new Error("Expected a mutation.");
  return completed;
}

/** complete recover；返回这一次 recover 期间的事件。 */
export async function recoverCompletion(scenario: LifecycleOrderCase): Promise<readonly string[]> {
  const start = scenario.events.length;
  const recovered = await executeDemandCompletionRequest({
    root: scenario.root,
    mode: "recover",
    operationId: scenario.demandId,
  });
  if (recovered.kind !== "WakeflowDemandCompletionMutation")
    throw new Error("Expected a mutation.");
  if (recovered.disposition !== "recovered") throw new Error(recovered.disposition);
  return scenario.events.slice(start);
}

const CONTINUATION = { kind: "optimization", summary: "Tighten the focused checks." } as const;

/** continue 的 preview 与 apply；preview 被挡住时抛出它的 blockers。 */
export async function applyContinuation(scenario: LifecycleOrderCase) {
  const request = {
    root: scenario.root,
    demandId: scenario.demandId,
    action: "continue",
    continuation: CONTINUATION,
  } as const;
  const preview = await executeDemandContinuationRequest({ ...request, mode: "preview" });
  if (preview.kind !== "WakeflowDemandContinuationPreview") throw new Error("Expected a preview.");
  if (preview.planDigest === null) throw new Error(preview.blockers.join(","));
  const continued = await executeDemandContinuationRequest({
    ...request,
    mode: "apply",
    planDigest: preview.planDigest,
  });
  if (continued.kind !== "WakeflowDemandContinuationMutation")
    throw new Error("Expected a mutation.");
  return continued;
}

/** continue recover；返回这一次 recover 期间的事件。 */
export async function recoverContinuation(
  scenario: LifecycleOrderCase,
): Promise<readonly string[]> {
  const start = scenario.events.length;
  const recovered = await executeDemandContinuationRequest({
    root: scenario.root,
    mode: "recover",
    operationId: scenario.demandId,
  });
  if (recovered.kind !== "WakeflowDemandContinuationMutation")
    throw new Error("Expected a mutation.");
  if (recovered.disposition !== "recovered") throw new Error(recovered.disposition);
  return scenario.events.slice(start);
}

/** 下一次取 pod 变更锁的调用停在打开锁文件之前；`reached` 兑现时它已经停住，`release` 放行。 */
export function holdNextPodLock(t: TestContext): { reached: Promise<void>; release: () => void } {
  const reached = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  let armed = true;
  const originalOpen = filesystemMutation.openLockFile;
  t.mock.method(
    filesystemMutation,
    "openLockFile",
    async (target: string, flags: number, mode: number) => {
      if (armed && /[/\\]locks[/\\]pod-mutation\.lock$/u.test(target)) {
        armed = false;
        reached.resolve();
        await released.promise;
      }
      return originalOpen.call(filesystemMutation, target, flags, mode);
    },
  );
  return { reached: reached.promise, release: () => released.resolve() };
}

/** 第一份需求包的认领状态；没有认领文件时是 undefined。 */
export async function claimStatus(scenario: LifecycleOrderCase): Promise<string | undefined> {
  const claim = await readRequirementClaimState(
    scenario.fixture.workspaceRoot,
    PLANNING_REQUIREMENT_ID,
  );
  return claim?.state.status;
}
