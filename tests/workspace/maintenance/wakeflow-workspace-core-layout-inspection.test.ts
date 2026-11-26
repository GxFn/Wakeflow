import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  materializeWorkspaceLocksRoot,
  WORKSPACE_LOCK_NAMES,
  withWorkspaceLock,
  workspaceLockRef,
} from "../../../src/kernel/workspace-locks.js";
import { inspectWakeflowWorkspaceCoreLayout } from "../../../src/workspace/maintenance/wakeflow-workspace-core-layout-inspection.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-core-layout-inspection-")),
  );
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function protocolPaths(root: string) {
  const local = path.join(root, ".wakeflow-local");
  const runtime = path.join(local, "runtime");
  const maintenance = path.join(runtime, "maintenance");
  const transactions = path.join(maintenance, "transactions");
  return Object.freeze({ local, runtime, maintenance, transactions });
}

/** 深度 4 是完整的协议：事务目录连同锁目录（`locks: false` 摆出从文件锁版本更新上来的样子）。 */
function materializeProtocol(root: string, depth: 1 | 2 | 3 | 4, locks = true): void {
  const paths = protocolPaths(root);
  mkdirSync(paths.local, { mode: 0o700 });
  if (depth >= 2) mkdirSync(paths.runtime, { mode: 0o700 });
  if (depth >= 3) mkdirSync(paths.maintenance, { mode: 0o700 });
  if (depth >= 4) mkdirSync(paths.transactions, { mode: 0o700 });
  if (depth >= 4 && locks) mkdirSync(path.join(paths.runtime, "locks"), { mode: 0o700 });
}

function gatePath(root: string): string {
  return path.join(root, ...workspaceLockRef("maintenance-gate").split("/"));
}

test("core layout distinguishes absent, bootstrap-prefix and idle", async (t) => {
  const absent = await fixture(t);
  const absentInspection = await inspectWakeflowWorkspaceCoreLayout(absent.root);
  equal(absentInspection.active.status, "absent");
  equal(absentInspection.local.status, "absent");
  equal(absentInspection.local.freshCompatible, true);

  const prefix = await fixture(t);
  materializeProtocol(prefix.absolutePath, 2);
  const prefixInspection = await inspectWakeflowWorkspaceCoreLayout(prefix.root);
  equal(prefixInspection.local.status, "bootstrap-prefix");
  equal(prefixInspection.local.freshCompatible, true);
  equal(prefixInspection.local.protocolComplete, false);

  const idle = await fixture(t);
  materializeProtocol(idle.absolutePath, 4);
  const idleInspection = await inspectWakeflowWorkspaceCoreLayout(idle.root);
  equal(idleInspection.local.status, "idle");
  equal(idleInspection.local.freshCompatible, true);
  equal(idleInspection.local.protocolComplete, true);
  equal(/^sha256:[0-9a-f]{64}$/u.test(idleInspection.inspectionDigest), true);

  // 事务目录在而锁目录不在：从文件锁的版本更新上来的工作区，协议还差一段（ADR-0033 决定 10）。
  const upgraded = await fixture(t);
  materializeProtocol(upgraded.absolutePath, 4, false);
  mkdirSync(path.join(upgraded.absolutePath, ".wakeflow-local", "runtime", "operation-admission"), {
    mode: 0o700,
  });
  const upgradedInspection = await inspectWakeflowWorkspaceCoreLayout(upgraded.root);
  equal(upgradedInspection.local.status, "bootstrap-prefix");
  equal(upgradedInspection.local.freshCompatible, false);
  equal(upgradedInspection.local.protocolComplete, false);
  deepEqual(upgradedInspection.issueCodes, []);
});

test("core layout separates installed resources from fresh-compatible prefix", async (t) => {
  const current = await fixture(t);
  materializeProtocol(current.absolutePath, 4);
  mkdirSync(path.join(current.absolutePath, ".wakeflow-active", "current"), {
    mode: 0o700,
    recursive: true,
  });
  chmodSync(path.join(current.absolutePath, ".wakeflow-active"), 0o700);
  chmodSync(path.join(current.absolutePath, ".wakeflow-active", "current"), 0o700);
  mkdirSync(path.join(current.absolutePath, ".wakeflow-local", "audit"), {
    mode: 0o700,
  });
  const inspected = await inspectWakeflowWorkspaceCoreLayout(current.root);
  equal(inspected.active.status, "present");
  equal(inspected.local.status, "idle");
  equal(inspected.local.freshCompatible, false);

  chmodSync(path.join(current.absolutePath, ".wakeflow-active"), 0o755);
  const drifted = await inspectWakeflowWorkspaceCoreLayout(current.root);
  equal(drifted.active.status, "conflict");
  equal(drifted.issueCodes.includes("active-layout-node-policy"), true);

  const partial = await fixture(t);
  mkdirSync(path.join(partial.absolutePath, ".wakeflow-active"), { mode: 0o700 });
  // 根在而 current/ 不在是可由维护 ensure 补齐的 incomplete，不是节点政策冲突。
  const partialInspection = await inspectWakeflowWorkspaceCoreLayout(partial.root);
  equal(partialInspection.active.status, "incomplete");
  deepEqual([...partialInspection.issueCodes], []);
});

test("core layout distinguishes busy, recovery residue and conflicts", async (t) => {
  const busy = await fixture(t);
  materializeProtocol(busy.absolutePath, 4);
  let enter: (() => void) | undefined;
  let release: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = withWorkspaceLock(busy.root, "maintenance-gate", async () => {
    enter?.();
    await released;
  });
  await entered;
  try {
    const inspected = await inspectWakeflowWorkspaceCoreLayout(busy.root);
    equal(inspected.local.status, "busy");
    equal(inspected.local.freshCompatible, false);
  } finally {
    release?.();
    await holder;
  }

  // 门放开之后什么都不留下：锁文件还在，没有人持有，协议是 idle（ADR-0033 决定 5）。
  const afterRelease = await inspectWakeflowWorkspaceCoreLayout(busy.root);
  equal(afterRelease.local.status, "idle");
  equal(afterRelease.local.freshCompatible, true);

  const transaction = await fixture(t);
  materializeProtocol(transaction.absolutePath, 4);
  writeFileSync(
    path.join(protocolPaths(transaction.absolutePath).transactions, "pending.json"),
    "{}\n",
    { mode: 0o600 },
  );
  const pending = await inspectWakeflowWorkspaceCoreLayout(transaction.root);
  equal(pending.local.status, "recovery-required");
  equal(pending.issueCodes.includes("maintenance-transaction-residue"), true);

  const conflict = await fixture(t);
  materializeProtocol(conflict.absolutePath, 3);
  writeFileSync(
    path.join(protocolPaths(conflict.absolutePath).maintenance, "unknown.txt"),
    "unknown",
  );
  const conflicting = await inspectWakeflowWorkspaceCoreLayout(conflict.root);
  equal(conflicting.local.status, "conflict");
  equal(conflicting.issueCodes.includes("maintenance-root-unknown-entry"), true);
});

test("transactions 里的残留按名字分类（§13.130）：合法的 intent 带 operationId，其余是 unknown（含 1.3 留下的 journal）；idle 时为空", async (t) => {
  const idle = await fixture(t);
  materializeProtocol(idle.absolutePath, 4);
  deepEqual((await inspectWakeflowWorkspaceCoreLayout(idle.root)).local.residues, []);

  const current = await fixture(t);
  materializeProtocol(current.absolutePath, 4);
  const { transactions } = protocolPaths(current.absolutePath);
  const operationId = "maintenance_operation_22222222-2222-4222-8222-222222222222";
  for (const name of [
    `${operationId}.journal.json`,
    `${operationId}.intent.json`,
    "operation_00000000-0000-4000-8000-000000000000.intent.json",
    "notes.txt",
  ]) {
    writeFileSync(path.join(transactions, name), "{}\n", { mode: 0o600 });
  }
  const inspected = await inspectWakeflowWorkspaceCoreLayout(current.root);
  equal(inspected.local.status, "recovery-required");
  deepEqual(
    inspected.local.residues.map((residue) => ({ ...residue })),
    [
      { name: `${operationId}.intent.json`, kind: "intent", operationId },
      // 1.4 起一次维护只有 intent 这一个文件；1.3 的检查点日志不再被认（ADR-0031，5a 的 C 行）。
      { name: `${operationId}.journal.json`, kind: "unknown", operationId: null },
      { name: "notes.txt", kind: "unknown", operationId: null },
      {
        name: "operation_00000000-0000-4000-8000-000000000000.intent.json",
        kind: "unknown",
        operationId: null,
      },
    ],
  );
});

test("unsafe gate without maintenance/ is a conflict, not a bootstrap prefix", async (t) => {
  const unsafe = await fixture(t);
  materializeProtocol(unsafe.absolutePath, 2);
  mkdirSync(path.dirname(gatePath(unsafe.absolutePath)), { mode: 0o700 });
  symlinkSync(path.join(unsafe.absolutePath, "elsewhere"), gatePath(unsafe.absolutePath));
  const inspected = await inspectWakeflowWorkspaceCoreLayout(unsafe.root);
  equal(inspected.local.status, "conflict");
  equal(inspected.local.freshCompatible, false);
  equal(inspected.issueCodes.includes("maintenance-gate-unsafe"), true);
});

test("锁目录里只有本协议的锁文件时仍算全新；不认识的名字或节点不对的条目不算（ADR-0033）", async (t) => {
  const { absolutePath, root } = await fixture(t);
  materializeProtocol(absolutePath, 2);
  const fresh = async () => (await inspectWakeflowWorkspaceCoreLayout(root)).local.freshCompatible;
  equal(await fresh(), true, "没有锁目录");

  // 一次没有做完的初始化留下的：锁目录和全部锁文件。它们不带状态，不妨碍下一次按全新来预览。
  await materializeWorkspaceLocksRoot(root);
  const locks = path.join(protocolPaths(absolutePath).runtime, "locks");
  equal(await fresh(), true, "只有锁文件");
  equal((await inspectWakeflowWorkspaceCoreLayout(root)).local.status, "bootstrap-prefix");

  // 锁目录的内容此后不变：一把锁被用过，观察的摘要不动。
  const before = (await inspectWakeflowWorkspaceCoreLayout(root)).inspectionDigest;
  for (const name of WORKSPACE_LOCK_NAMES) {
    if (name === "operation-gate" || name === "operation-scope") continue;
    await withWorkspaceLock(root, name, async () => undefined);
  }
  equal((await inspectWakeflowWorkspaceCoreLayout(root)).inspectionDigest, before);

  const unknown = path.join(locks, "notes.txt");
  writeFileSync(unknown, "x", { mode: 0o600 });
  equal(await fresh(), false, "不认识的条目");
  rmSync(unknown);
  equal(await fresh(), true);

  chmodSync(path.join(locks, "requirement-board.lock"), 0o644);
  equal(await fresh(), false, "权限位不对");
});
