#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDeliveryStore,
  releaseWindowLockForResult,
} from "../core/scripts/lib/wakeflow-delivery-store.mjs";

function makeStore(
  workspaceRoot,
  stateDir = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery"),
  sanctionedStateRoots = [],
) {
  return createDeliveryStore({
    workspaceRoot,
    stateDir,
    sanctionedStateRoots,
    slug: (value) => String(value).replace(/[^A-Za-z0-9._-]+/g, "-"),
    nowIso: () => "2026-07-30T00:00:00.000Z",
    fail: (message) => {
      throw new Error(message);
    },
  });
}

test("existing input and state-root symlinks cannot escape the workspace", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-store-workspace-"));
  const outsideRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-store-outside-"));
  const outsideStateRoot = path.join(outsideRoot, "state-root");
  mkdirSync(outsideStateRoot, { recursive: true });
  writeFileSync(path.join(outsideStateRoot, "wakeflow-state.json"), "{}\n");
  symlinkSync(outsideStateRoot, path.join(workspaceRoot, "linked-state"), "dir");

  const outsidePacket = path.join(outsideRoot, "packet.json");
  writeFileSync(outsidePacket, "{}\n");
  symlinkSync(outsidePacket, path.join(workspaceRoot, "linked-packet.json"), "file");

  const store = makeStore(workspaceRoot);
  assert.throws(
    () => store.resolveStateRoot("linked-state"),
    /--state-root must not be a symbolic link|sanctioned state root/,
  );
  assert.throws(
    () => store.resolveInputPath("linked-packet.json", "--packet-file"),
    /--packet-file must stay inside workspace/,
  );
});

test("state directory creation and writes reject symlinked parents outside the workspace", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-store-workspace-"));
  const outsideRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-store-outside-"));
  symlinkSync(outsideRoot, path.join(workspaceRoot, ".wakeflow-local"), "dir");

  const store = makeStore(workspaceRoot);
  assert.throws(
    () => store.ensureStateDirs(),
    /closed-loop state directory must stay inside workspace/,
  );
  assert.equal(existsSync(path.join(outsideRoot, "wakeflow-delivery/dispatch-packets")), false);

  assert.throws(
    () => store.atomicWriteJson(
      path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/escape.json"),
      { escaped: true },
    ),
    /closed-loop state must stay inside workspace/,
  );
  assert.equal(existsSync(path.join(outsideRoot, "wakeflow-delivery/escape.json")), false);
});

test("append and lock release do not follow runtime symlinks outside the workspace", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-store-workspace-"));
  const outsideRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-store-outside-"));
  const insideRuntime = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery");
  mkdirSync(insideRuntime, { recursive: true });
  const outsideEvents = path.join(outsideRoot, "events.jsonl");
  writeFileSync(outsideEvents, "original\n");
  symlinkSync(outsideEvents, path.join(insideRuntime, "events.jsonl"), "file");

  const store = makeStore(workspaceRoot);
  assert.throws(
    () => store.appendJsonLine(path.join(insideRuntime, "events.jsonl"), { escaped: true }),
    /controller event log must stay inside workspace/,
  );
  assert.equal(readFileSync(outsideEvents, "utf8"), "original\n");

  const outsideRuntime = path.join(outsideRoot, "wakeflow-delivery");
  const outsideLocks = path.join(outsideRuntime, "locks");
  mkdirSync(outsideLocks, { recursive: true });
  const outsideLock = path.join(outsideLocks, "Repo.json");
  writeFileSync(outsideLock, `${JSON.stringify({ deliveryId: "delivery-1" })}\n`);
  const secondWorkspace = mkdtempSync(path.join(os.tmpdir(), "wakeflow-store-workspace-"));
  symlinkSync(outsideRoot, path.join(secondWorkspace, ".wakeflow-local"), "dir");
  const escapedLock = path.join(secondWorkspace, ".wakeflow-local/wakeflow-delivery/locks/Repo.json");
  assert.equal(
    releaseWindowLockForResult(escapedLock, (lock) => lock.deliveryId === "delivery-1"),
    false,
  );
  assert.equal(existsSync(outsideLock), true);
});

test("symlinks that resolve inside the workspace remain usable", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-store-workspace-"));
  const actualDir = path.join(workspaceRoot, "actual");
  mkdirSync(actualDir, { recursive: true });
  symlinkSync(actualDir, path.join(workspaceRoot, "alias"), "dir");
  const store = makeStore(workspaceRoot);

  store.atomicWriteJson(path.join(workspaceRoot, "alias", "..safe.json"), { ok: true });
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(actualDir, "..safe.json"), "utf8")),
    { ok: true },
  );
});

test("configured external ledger state roots are readable without widening transport storage", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-store-parent-"));
  const workspaceRoot = path.join(parent, "Workspace");
  const ledgerRoot = path.join(parent, "wakeflow-ledger");
  const currentRoot = path.join(ledgerRoot, "current");
  const stateRoot = path.join(currentRoot, "EXTERNAL-DEMAND");
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(path.join(stateRoot, "task-packages"), { recursive: true });
  writeFileSync(
    path.join(stateRoot, "wakeflow-state.json"),
    `${JSON.stringify({ demandKey: "EXTERNAL-DEMAND", revision: 1 })}\n`,
  );
  writeFileSync(
    path.join(stateRoot, "task-packages", "PKG.json"),
    `${JSON.stringify({ taskPackageId: "PKG" })}\n`,
  );

  const store = makeStore(workspaceRoot, undefined, [currentRoot, ledgerRoot]);
  assert.equal(
    store.resolveStateRoot("../wakeflow-ledger/current/EXTERNAL-DEMAND"),
    stateRoot,
  );
  assert.equal(
    store.readControllerStateRoot(stateRoot).state.demandKey,
    "EXTERNAL-DEMAND",
  );
  assert.equal(
    store.readTaskPackageFromStateRoot(stateRoot, "PKG").taskPackageId,
    "PKG",
  );

  const externalTransport = path.join(ledgerRoot, ".wakeflow-local/wakeflow-delivery");
  const externalStore = makeStore(
    workspaceRoot,
    externalTransport,
    [currentRoot, ledgerRoot],
  );
  assert.throws(
    () => externalStore.ensureStateDirs(),
    /closed-loop state directory must stay inside workspace/,
  );
  assert.equal(existsSync(path.join(externalTransport, "dispatch-packets")), false);
});

test("a configured external ledger does not authorize state-root symlink escapes", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-store-parent-"));
  const workspaceRoot = path.join(parent, "Workspace");
  const currentRoot = path.join(parent, "wakeflow-ledger", "current");
  const outsideRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-store-outside-"));
  const outsideStateRoot = path.join(outsideRoot, "ESCAPED-DEMAND");
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(outsideStateRoot, { recursive: true });
  writeFileSync(path.join(outsideStateRoot, "wakeflow-state.json"), "{}\n");
  mkdirSync(currentRoot, { recursive: true });
  symlinkSync(outsideStateRoot, path.join(currentRoot, "ESCAPED-DEMAND"), "dir");

  const store = makeStore(workspaceRoot, undefined, [currentRoot]);
  assert.throws(
    () => store.resolveStateRoot("../wakeflow-ledger/current/ESCAPED-DEMAND"),
    /--state-root must not be a symbolic link|sanctioned state root/,
  );
});
