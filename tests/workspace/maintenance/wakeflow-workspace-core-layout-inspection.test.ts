import { equal } from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  withRootedExclusiveFileLock,
} from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  WAKEFLOW_MAINTENANCE_GATE_REF,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-resource-catalog.js";
import {
  inspectWakeflowWorkspaceCoreLayout,
} from "../../../src/workspace/maintenance/wakeflow-workspace-core-layout-inspection.js";

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-core-layout-inspection-",
  )));
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

function materializeProtocol(root: string, depth: 1 | 2 | 3 | 4): void {
  const paths = protocolPaths(root);
  mkdirSync(paths.local, { mode: 0o700 });
  if (depth >= 2) mkdirSync(paths.runtime, { mode: 0o700 });
  if (depth >= 3) mkdirSync(paths.maintenance, { mode: 0o700 });
  if (depth >= 4) mkdirSync(paths.transactions, { mode: 0o700 });
}

function writeInactiveLock(root: string): void {
  const lockPath = path.join(root, ...WAKEFLOW_MAINTENANCE_GATE_REF.split("/"));
  writeFileSync(lockPath, `${JSON.stringify({
    createdAt: "2026-08-27T10:00:00.000Z",
    kind: "WakeflowExclusiveFileLock",
    pid: 2_147_483_647,
    threadId: 0,
    token: "2147483647-0-11111111-1111-4111-8111-111111111111",
    version: 1,
  }, null, 2)}\n`, { mode: 0o600 });
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
  const partialInspection = await inspectWakeflowWorkspaceCoreLayout(
    partial.root,
  );
  equal(partialInspection.active.status, "conflict");
  equal(
    partialInspection.issueCodes.includes("active-layout-node-policy"),
    true,
  );
});

test("core layout distinguishes busy, recovery residue and conflicts", async (t) => {
  const busy = await fixture(t);
  materializeProtocol(busy.absolutePath, 4);
  let enter: (() => void) | undefined;
  let release: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const holder = withRootedExclusiveFileLock(
    busy.root,
    WAKEFLOW_MAINTENANCE_GATE_REF,
    async () => {
      enter?.();
      await released;
    },
  );
  await entered;
  try {
    const inspected = await inspectWakeflowWorkspaceCoreLayout(busy.root);
    equal(inspected.local.status, "busy");
    equal(inspected.local.freshCompatible, false);
  } finally {
    release?.();
    await holder;
  }

  const residue = await fixture(t);
  materializeProtocol(residue.absolutePath, 4);
  writeInactiveLock(residue.absolutePath);
  const inactive = await inspectWakeflowWorkspaceCoreLayout(residue.root);
  equal(inactive.local.status, "recovery-required");
  equal(inactive.local.freshCompatible, false);

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
