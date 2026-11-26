import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { executeStatusRequest } from "../../../src/capabilities/observation/service.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { withWorkspaceLock } from "../../../src/kernel/workspace-locks.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";

/**
 * 级别 2（能力）：没有操作可恢复的维护残留（open-items B9，§13.242；ADR-0033 之后只剩孤儿暂存这一种）。
 *
 * 真实进程的中断矩阵（`maintenance-crash-recovery.load.test.ts`）跑出这种状态并走通了它的出口；这里用
 * 手工摆出的残留钉住出口的边界——什么时候有这份计划、什么时候没有、什么时候 apply 拒绝动手。
 */

useDisposableDurability();

function git(cwd: string, ...args: readonly string[]): void {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

async function initializedWorkspace(t: TestContext): Promise<string> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-gate-residue-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "Workspace");
  mkdirSync(root);
  git(root, "init", "--quiet");
  const selection = createMinimalWakeflowFreshConfigSelection();
  (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const request = { root, action: "fresh-initialize", request: { selection } } as const;
  const preview = await executeCodexWakeflowMaintenance({ ...request, mode: "preview" });
  if (preview.mode !== "preview" || preview.planDigest === null) {
    throw new Error("Expected a ready fresh plan.");
  }
  await executeCodexWakeflowMaintenance({
    ...request,
    mode: "apply",
    planDigest: preview.planDigest,
  });
  return root;
}

/** 公共结果是冻结的空原型对象：比较前归一成普通 JSON。 */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const transactionsOf = (root: string) =>
  path.join(root, ".wakeflow-local", "runtime", "maintenance", "transactions");

/** 与 foundation 签发的暂存名同形的孤儿暂存；`pid` 是名字里记着的属主。 */
function leaveOrphanStage(root: string, pid: number, seed = "6"): string {
  const file = path.join(
    transactionsOf(root),
    `.wakeflow-atomic-v1-create-${"a".repeat(64)}-${"b".repeat(64)}-m600__${pid}-0-${seed.repeat(8)}-6666-4666-8666-666666666666.tmp`,
  );
  writeFileSync(file, "{}\n", { mode: 0o600 });
  return file;
}

async function previewReconcile(root: string) {
  const preview = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  if (preview.mode !== "preview") throw new Error("Expected a preview.");
  return preview;
}

async function applyReconcile(root: string, planDigest: string) {
  return executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    planDigest,
    request: {},
  });
}

async function protocolOf(root: string): Promise<string> {
  return (await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root })).maintenance.protocol;
}

test("只剩孤儿暂存、没有任何操作：reconcile 的第一份计划退役它，预览零写，计划过期被拒，之后回到 idle", {
  timeout: 120_000,
}, async (t) => {
  const root = await initializedWorkspace(t);
  const first = leaveOrphanStage(root, 2_147_483_647);
  equal(await protocolOf(root), "recovery-required");
  const preview = await previewReconcile(root);
  deepEqual(plain(preview.plan), {
    kind: "WakeflowMaintenanceGateResiduePlan",
    schemaVersion: 1,
    transactionStages: 1,
  });
  equal(existsSync(first), true, "preview writes nothing");
  if (preview.planDigest === null) throw new Error("Expected a ready plan.");

  // 预览之后多出一份孤儿暂存：旧摘要的 apply 被拒，什么都没有删。
  const second = leaveOrphanStage(root, 2_147_483_647, "7");
  await rejects(applyReconcile(root, preview.planDigest), (error: unknown) => {
    equal(isWakeflowError(error) && error.code, "precondition-failed");
    return true;
  });
  equal(existsSync(first), true);
  equal(existsSync(second), true);

  const again = await previewReconcile(root);
  deepEqual(plain(again.plan), {
    kind: "WakeflowMaintenanceGateResiduePlan",
    schemaVersion: 1,
    transactionStages: 2,
  });
  if (again.planDigest === null) throw new Error("Expected a ready plan.");
  const applied = await applyReconcile(root, again.planDigest);
  if (applied.mode !== "apply") throw new Error("Expected an apply result.");
  deepEqual(plain(applied.stepReceipts), [
    { kind: "WakeflowMaintenanceGateResidueReceipt", stagesRetired: 2 },
  ]);
  deepEqual(readdirSync(transactionsOf(root)), []);
  equal(await protocolOf(root), "idle");
  // 下一次预览回到平常的布局维护。
  const ordinary = await previewReconcile(root);
  equal(ordinary.status, "ready");
  equal((ordinary.plan as { kind?: string } | null)?.kind, "WakeflowMaintenancePlanSummary");
});

test("暂存的属主还活着时 apply 以 maintenance-gate-residue 拒绝并且不删；换成属主已经不在的，同一条路把它退役", {
  timeout: 120_000,
}, async (t) => {
  const root = await initializedWorkspace(t);
  // 属主是本测试的父进程：它活着，而且在这份暂存写下之前就在运行。
  const live = leaveOrphanStage(root, process.ppid);
  equal(await protocolOf(root), "recovery-required");
  const guarded = await previewReconcile(root);
  deepEqual(plain(guarded.plan), {
    kind: "WakeflowMaintenanceGateResiduePlan",
    schemaVersion: 1,
    transactionStages: 1,
  });
  if (guarded.planDigest === null) throw new Error("Expected a ready plan.");
  await rejects(applyReconcile(root, guarded.planDigest), (error: unknown) => {
    if (!isWakeflowError(error)) return false;
    equal(error.code, "recovery-required");
    equal(error.reason, "maintenance-gate-residue");
    return true;
  });
  equal(existsSync(live), true, "a stage whose owner may be alive is never deleted");

  rmSync(live);
  leaveOrphanStage(root, 2_147_483_647);
  const dead = await previewReconcile(root);
  if (dead.planDigest === null) throw new Error("Expected a ready plan.");
  const applied = await applyReconcile(root, dead.planDigest);
  if (applied.mode !== "apply") throw new Error("Expected an apply result.");
  deepEqual(plain(applied.stepReceipts), [
    { kind: "WakeflowMaintenanceGateResidueReceipt", stagesRetired: 1 },
  ]);
  equal(await protocolOf(root), "idle");
});

test("不归这份计划管的两种状态：有一次维护在跑（门被持有），或事务目录里有 intent——reconcile 仍被协议状态挡住", {
  timeout: 120_000,
}, async (t) => {
  const root = await initializedWorkspace(t);
  // 门被持有、事务目录里只有暂存：那是进行中的维护正在发布它的 intent，不是残留。
  const stage = leaveOrphanStage(root, 2_147_483_647);
  const rooted = await RootedDirectory.open(root);
  t.after(() => rooted.close());
  const inside = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const running = withWorkspaceLock(rooted, "maintenance-gate", async () => {
    inside.resolve();
    await release.promise;
  });
  await inside.promise;
  try {
    equal(await protocolOf(root), "busy");
    const busy = await previewReconcile(root);
    equal(busy.plan, null);
    equal(busy.planDigest, null);
    deepEqual(busy.blockerCodes, ["maintenance-protocol-busy"]);
    equal(existsSync(stage), true);
  } finally {
    release.resolve();
    await running;
  }

  // 一份 intent：那是一个可以按 operation ID 恢复的操作，不在这里退役。
  rmSync(stage);
  const intent = path.join(
    transactionsOf(root),
    "maintenance_operation_88888888-8888-4888-8888-888888888888.intent.json",
  );
  writeFileSync(intent, "{}\n", { mode: 0o600 });
  const withOperation = await previewReconcile(root);
  equal(withOperation.plan, null);
  deepEqual(withOperation.blockerCodes, ["maintenance-protocol-recovery-required"]);
  const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root });
  deepEqual(
    status.maintenance.residues.map((residue) => [residue.kind, residue.recoverable]),
    [["intent", true]],
  );
  equal(existsSync(intent), true);
});
