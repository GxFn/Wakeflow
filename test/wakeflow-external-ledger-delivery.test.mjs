#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const coreRoot = path.join(repoRoot, "core");
const codexBundleRoot = path.join(repoRoot, "plugins", "codex-wakeflow");

function makeRuntime() {
  const runtime = mkdtempSync(path.join(os.tmpdir(), "wakeflow-external-ledger-runtime-"));
  const hostProfile = readFileSync(path.join(codexBundleRoot, "scripts/lib/wakeflow-host-profile.mjs"));
  cpSync(codexBundleRoot, runtime, { recursive: true });
  cpSync(coreRoot, runtime, { recursive: true, force: true });
  writeFileSync(path.join(runtime, "scripts/lib/wakeflow-host-profile.mjs"), hostProfile);
  return runtime;
}

function makeWorkspace() {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-external-ledger-"));
  const root = path.join(parent, "Workspace");
  mkdirSync(root, { recursive: true });
  writeJson(path.join(root, "wakeflow.config.json"), {
    workspaceName: "External ledger delivery",
    controllerWindow: "Controller",
    workspaceCurrentDir: "../wakeflow-ledger/current",
    projectLedgerRoot: "../wakeflow-ledger",
    repositories: [
      { windowName: "Controller", path: ".", role: "controller" },
      { windowName: "Target", path: ".", role: "implementation" },
    ],
    dispatchWindows: ["Target"],
  });
  return { parent, root };
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function run(runtime, script, args) {
  return spawnSync(process.execPath, [path.join(runtime, "scripts", script), ...args], {
    cwd: runtime,
    encoding: "utf8",
  });
}

function parseOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("prepare and record delivery support a configured external current ledger while transport stays local", () => {
  const runtime = makeRuntime();
  const { parent, root } = makeWorkspace();
  const initialized = parseOk(run(runtime, "wakeflow-state.mjs", [
    "init",
    "--root", root,
    "--demand-key", "EXTERNAL-LEDGER-DELIVERY",
    "--title", "External ledger delivery",
    "--write",
    "--json",
  ]));
  assert.equal(initialized.stateRoot, "../wakeflow-ledger/current/EXTERNAL-LEDGER-DELIVERY");

  parseOk(run(runtime, "wakeflow-state.mjs", [
    "add-task-package",
    "--root", root,
    "--state-root", initialized.stateRoot,
    "--task-package-id", "PKG",
    "--summary", "Deliver from the configured external ledger.",
    "--target-window", "Target",
    "--target-task-id", "TASK",
    "--target-summary", "Implement the external-ledger task.",
    "--write",
    "--json",
  ]));

  const prepared = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "prepare-dispatch-from-state",
    "--root", root,
    "--state-root", initialized.stateRoot,
    "--target-task-id", "TASK",
    "--group", "G1",
    "--controller-window", "Controller",
    "--human-context-ref", `${initialized.stateRoot}/developer-progress.md`,
    "--write",
    "--json",
  ]));
  assert.equal(prepared.envelope.stateRef.stateRoot, initialized.stateRoot);
  assert.equal(
    path.resolve(root, prepared.deliveryFile).startsWith(path.join(root, ".wakeflow-local")),
    true,
  );

  const recorded = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "record-delivery-run",
    "--root", root,
    "--delivery-file", prepared.deliveryFile,
    "--status", "sent",
    "--readback-ok", "true",
    "--evidence", "real host send/readback evidence",
    "--write",
    "--json",
  ]));
  assert.equal(recorded.stateUpdate.updated, true);

  const stateRoot = path.resolve(root, initialized.stateRoot);
  const state = JSON.parse(readFileSync(path.join(stateRoot, "wakeflow-state.json"), "utf8"));
  assert.equal(state.targetTasks[0].status, "sent");
  assert.equal(state.targetTasks[0].delivery.dispatchGroup, "G1");
  assert.equal(existsSync(path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-runs")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger", ".wakeflow-local")), false);
});
