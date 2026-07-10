#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const script = path.join(workspaceRoot, "scripts/wakeflow-state.mjs");
const deliveryScript = path.join(workspaceRoot, "scripts/wakeflow-delivery.mjs");

function run(args) {
  return runSync(process.execPath, [script, ...args], { cwd: workspaceRoot, encoding: "utf8" });
}
function runDelivery(args) {
  return runSync(process.execPath, [deliveryScript, ...args], { cwd: workspaceRoot, encoding: "utf8" });
}
function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }
function writeJson(file, value) { writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

function initDemand({ demandKey = "ARCH-1", complete = true, designKey = null } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-archive-"));
  writeJson(path.join(root, "wakeflow.config.json"), { workspaceName: "X", controllerWindow: "C", projectLedgerRoot: "wakeflow-ledger" });
  const init = JSON.parse(run(["init", "--root", root, "--demand-key", demandKey, "--title", "Archive me", ...(designKey ? ["--design-key", designKey] : []), "--write", "--json"]).stdout);
  const stateFile = path.join(root, init.stateRoot, "wakeflow-state.json");
  if (complete) writeJson(stateFile, { ...readJson(stateFile), state: "completed" });
  if (designKey) {
    const board = path.join(root, ".wakeflow-active/current/global-todo-board.md");
    mkdirSync(path.dirname(board), { recursive: true });
    writeFileSync(board, [
      "# Global TODO", "", "## Global TODO", "",
      "| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount | Auto Claim | Testing Decision | Documents |",
      `| ${Array(13).fill("---").join(" | ")} |`,
      `| ${designKey} | completed / claimed | requirement | P1 | Design | Archive me | no | none | C | ${init.stateRoot} | yes | unit | [plan](plan.md) |`,
      "",
    ].join("\n"));
  }
  return { root, stateRoot: init.stateRoot, stateFile };
}

test("archive-demand refuses a demand that is not completed", () => {
  const { root, stateRoot } = initDemand({ demandKey: "ARCH-2", complete: false });
  const result = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "x", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /requires state=completed/);
});

test("archive-demand dry-run reports the move without writing", () => {
  const { root, stateRoot, stateFile } = initDemand();
  const result = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "done", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.wrote, false);
  assert.match(payload.wouldArchive.ledgerDest, /wakeflow-ledger\/workspace\/archive\//);
  assert.equal(payload.wouldArchive.redactNeeded, false);
  assert.equal(readJson(stateFile).state, "completed", "dry-run must not flip state");
});

test("archive-demand --write flips to archived, relocates into the ledger, writes a manifest", () => {
  const { root, stateRoot, stateFile } = initDemand();
  const result = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "done", "--write", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.wrote, true);
  assert.equal(existsSync(stateFile), false, "original active state root is moved away");
  const ledgerDest = path.join(root, payload.archived.ledgerDest);
  assert.equal(readJson(path.join(ledgerDest, "wakeflow-state.json")).state, "archived");
  const manifest = readJson(path.join(ledgerDest, "archive-manifest.json"));
  assert.equal(manifest.demandKey, "ARCH-1");
  assert.deepEqual(manifest.redactedFields, []);
  assert.match(readFileSync(path.join(ledgerDest, "controller-events.jsonl"), "utf8"), /"type":"demand\.archived"/);
});

test("archived demand transport history does not poison live runtime status", () => {
  const { root, stateRoot } = initDemand({ demandKey: "ARCH-STATUS" });
  const packetsDir = path.join(root, ".wakeflow-local/wakeflow-delivery/dispatch-packets");
  const deliveriesDir = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-envelopes");
  mkdirSync(packetsDir, { recursive: true });
  mkdirSync(deliveriesDir, { recursive: true });
  writeJson(path.join(packetsDir, "ARCH-PACKET.json"), {
    kind: "ControllerDispatchPacket",
    version: 1,
    id: "ARCH-PACKET",
    taskId: "ARCH-TASK",
    targetWindow: "WinA",
    dispatchGroup: "ARCH-GROUP",
    stateRef: { stateRoot },
  });
  writeJson(path.join(deliveriesDir, "ARCH-DELIVERY.json"), {
    kind: "DeliveryEnvelope",
    version: 1,
    deliveryId: "ARCH-DELIVERY",
    sourcePacketId: "ARCH-PACKET",
    taskId: "ARCH-TASK",
    targetWindow: "WinA",
    dispatchGroup: "ARCH-GROUP",
    stateRef: { stateRoot },
  });

  const archived = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "done", "--write", "--json"]);
  assert.equal(archived.status, 0, archived.stderr || archived.stdout);
  const status = runDelivery(["status", "--root", root, "--json"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const payload = JSON.parse(status.stdout);
  assert.deepEqual(payload.runtimeSummary.diagnostics.errors, []);
  assert.equal(payload.runtimeSummary.groups.items.length, 0, "archived groups are historical, not active review work");
  assert.deepEqual(payload.runtimeSummary.deliveries.pendingHostSend, [], "archived pending envelopes remain on disk but are not live send work");
  assert.equal(payload.runtimeSummary.nextAction, "idle");
  assert.match(readFileSync(path.join(root, ".wakeflow-active/current/workspace-current-status.md"), "utf8"), /Status: idle/);
});

test("archive-demand moves the consumed TODO mount to the durable ledger", () => {
  const designKey = "archive-row-2026-07-10";
  const { root, stateRoot } = initDemand({ demandKey: "ARCH-TODO", designKey });
  const result = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "done", "--write", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.archived.todoArchive.changed, true);
  const board = readFileSync(path.join(root, ".wakeflow-active/current/global-todo-board.md"), "utf8");
  assert.match(board, /archive-row-2026-07-10 \| completed \/ archived/);
  assert.match(board, /wakeflow-ledger\/workspace\/archive\/\d{4}-\d{2}\/arch-todo/i);
  assert.doesNotMatch(board, new RegExp(`${stateRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`));
});

test("archive-demand write failure leaves the active state root unchanged before ledger commit", () => {
  const { root, stateRoot, stateFile } = initDemand({ demandKey: "ARCH-4" });
  const dryRun = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "done", "--json"]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  const dryPayload = JSON.parse(dryRun.stdout);
  const ledgerDest = path.join(root, dryPayload.wouldArchive.ledgerDest);
  const blockedMonthDir = path.dirname(ledgerDest);
  mkdirSync(path.dirname(blockedMonthDir), { recursive: true });
  writeFileSync(blockedMonthDir, "not a directory\n");

  const result = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "done", "--write", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /active state root was left unchanged/);
  assert.equal(readJson(stateFile).state, "completed");
  assert.doesNotMatch(
    readFileSync(path.join(root, stateRoot, "controller-events.jsonl"), "utf8"),
    /"type":"demand\.archived"/,
  );
});

test("archive-demand refuses a planted real id unless --redact, then relocates a cleaned copy", () => {
  const { root, stateRoot } = initDemand({ demandKey: "ARCH-3" });
  const uuid = "3f8a1c2b-9d4e-4f6a-8b1c-2d3e4f5a6b7c";
  const noteFile = path.join(root, stateRoot, "leak.md");
  writeFileSync(noteFile, `thread ${uuid}\n`);

  const refuse = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "x", "--write", "--json"]);
  assert.notEqual(refuse.status, 0);
  assert.match(refuse.stdout, /refuses|real id/i);
  assert.equal(existsSync(noteFile), true, "a refused archive must not move anything");

  const redacted = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "x", "--redact", "--write", "--json"]);
  assert.equal(redacted.status, 0, redacted.stderr || redacted.stdout);
  const payload = JSON.parse(redacted.stdout);
  assert.equal(payload.archived.preservedOriginal, true);
  // The original is machine-moved into the canonical audit hold (current/
  // stays clean without manual moves) with a manifest.
  assert.equal(existsSync(noteFile), false, "the original moves out of the active layer");
  const preservedAt = payload.archived.originalPreservedAt;
  assert.match(preservedAt, /\.wakeflow-local\/preserved\/\d{4}-\d{2}-\d{2}-archive-original-arch-3/i);
  assert.equal(existsSync(path.join(root, preservedAt, "leak.md")), true, "the original (with the id) is preserved for audit");
  assert.equal(existsSync(path.join(root, preservedAt, "MANIFEST.md")), true, "the hold carries its manifest");
  const ledgerLeak = readFileSync(path.join(root, payload.archived.ledgerDest, "leak.md"), "utf8");
  assert.doesNotMatch(ledgerLeak, new RegExp(uuid), "the committed copy must not carry the real id");
  assert.match(ledgerLeak, /<redacted>/);
  assert.ok(payload.archived.redactedFields.some((field) => field.file === "leak.md"));
});
