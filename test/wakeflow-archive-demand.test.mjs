#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  assert.doesNotMatch(
    readFileSync(path.join(root, stateRoot, "developer-progress.md"), "utf8"),
    /archived →/,
    "a failed staging commit must not append a false archive timeline entry",
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

test("archive-demand refuses absolute workspace paths and re-scans the portable archive copy", () => {
  const { root, stateRoot } = initDemand({ demandKey: "ARCH-PATH" });
  const noteFile = path.join(root, stateRoot, "target-results", "path-leak.json");
  mkdirSync(path.dirname(noteFile), { recursive: true });
  writeJson(noteFile, {
    wakeflowTrace: { root },
    evidenceRefs: [`${root}/reports/private-result.json`],
  });

  const refuse = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "portable archive", "--write", "--json"]);
  assert.notEqual(refuse.status, 0);
  const refusedPayload = JSON.parse(refuse.stdout);
  assert.match(refusedPayload.error, /workspace-absolute-path/);
  assert.equal(existsSync(noteFile), true, "privacy refusal must leave the active root unchanged");

  const archived = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", `evidence checked under ${root}`, "--redact", "--write", "--json"]);
  assert.equal(archived.status, 0, archived.stderr || archived.stdout);
  const payload = JSON.parse(archived.stdout);
  const ledgerDest = path.join(root, payload.archived.ledgerDest);
  const copied = readFileSync(path.join(ledgerDest, "target-results", "path-leak.json"), "utf8");
  const committedManifest = readFileSync(path.join(ledgerDest, "archive-manifest.json"), "utf8");
  assert.doesNotMatch(copied, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(copied, /<workspace-root>/);
  assert.doesNotMatch(committedManifest, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "preserved-pointer enrichment must not restore the raw manifest");
  assert.match(committedManifest, /<workspace-root>/, "archive reason is sanitized in the committed manifest");
  assert.doesNotMatch(readFileSync(path.join(ledgerDest, "archive-summary.md"), "utf8"), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "generated summary is included in the final scan");
  assert.ok(payload.archived.redactedFields.some((field) => field.kinds?.["workspace-absolute-path"] > 0));
  assert.equal(existsSync(path.join(root, payload.archived.originalPreservedAt, "target-results", "path-leak.json")), true);
});

// Cancel is the escape hatch for an in-flight demand: no acceptance, no
// evidence gate, and the root still holds capacity until archived — archive
// accepts cancelled exactly like completed.
test("cancel-demand stops an in-flight demand and archive accepts the cancelled state", () => {
  const { root, stateRoot, stateFile } = initDemand({ demandKey: "CXL-1", complete: false });

  const dry = run(["cancel-demand", "--root", root, "--state-root", stateRoot, "--reason", "scope moved", "--json"]);
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  assert.equal(JSON.parse(dry.stdout).wrote, false);
  assert.notEqual(readJson(stateFile).state, "cancelled");

  const cancel = run(["cancel-demand", "--root", root, "--state-root", stateRoot, "--reason", "scope moved", "--write", "--json"]);
  assert.equal(cancel.status, 0, cancel.stderr || cancel.stdout);
  const payload = JSON.parse(cancel.stdout);
  assert.equal(payload.nextState, "cancelled");
  const state = readJson(stateFile);
  assert.equal(state.state, "cancelled");
  assert.equal(state.stateReason, "scope moved");
  const events = readFileSync(path.join(root, stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n");
  const last = JSON.parse(events[events.length - 1]);
  assert.equal(last.type, "demand.cancelled");
  assert.ok(Array.isArray(last.forbiddenConclusions) && last.forbiddenConclusions.length > 0);

  const again = run(["cancel-demand", "--root", root, "--state-root", stateRoot, "--reason", "twice", "--write", "--json"]);
  assert.notEqual(again.status, 0);
  assert.match(again.stdout, /already cancelled/);

  const archive = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "cancelled demand", "--write", "--json"]);
  assert.equal(archive.status, 0, archive.stderr || archive.stdout);
  assert.equal(existsSync(path.join(root, stateRoot)), false, "cancelled root moves into the archive ledger");
});

test("cancel-demand refuses a completed demand", () => {
  const { root, stateRoot } = initDemand({ demandKey: "CXL-2", complete: true });
  const result = run(["cancel-demand", "--root", root, "--state-root", stateRoot, "--reason", "x", "--write", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /already completed/);
});

// P0 fix wave: cancel is a REAL stop — it releases the demand's in-flight
// window delivery locks (the documented close order would otherwise dead-end
// on "fresh in-flight delivery lock" for up to the lock TTL), and the board
// row of a cancelled demand archives honestly instead of claiming delivery.
test("cancel-demand releases the demand's in-flight window locks and leaves foreign locks alone", () => {
  const { root, stateRoot, stateFile } = initDemand({ demandKey: "CXL-3", complete: false });
  const state = readJson(stateFile);
  state.targetTasks = [{
    targetTaskId: "CXL-3-T1", taskPackageId: "CXL-3-P1", targetWindow: "RepoA",
    status: "sent", delivery: { deliveryId: "d-cxl-3" },
  }];
  writeJson(stateFile, state);
  const locksDir = path.join(root, ".wakeflow-local/wakeflow-delivery/locks");
  mkdirSync(locksDir, { recursive: true });
  writeJson(path.join(locksDir, "RepoA.json"), {
    kind: "WakeflowWindowDeliveryLock", version: 1, windowName: "RepoA",
    deliveryId: "d-cxl-3", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7200000).toISOString(),
  });
  writeJson(path.join(locksDir, "RepoB.json"), {
    kind: "WakeflowWindowDeliveryLock", version: 1, windowName: "RepoB",
    deliveryId: "d-other-demand", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7200000).toISOString(),
  });
  const cancel = run(["cancel-demand", "--root", root, "--state-root", stateRoot, "--reason", "stop", "--write", "--json"]);
  assert.equal(cancel.status, 0, cancel.stderr || cancel.stdout);
  assert.deepEqual(JSON.parse(cancel.stdout).releasedWindowLocks, ["RepoA"]);
  assert.equal(existsSync(path.join(locksDir, "RepoA.json")), false, "own in-flight lock released");
  assert.equal(existsSync(path.join(locksDir, "RepoB.json")), true, "foreign lock untouched");
});

test("archiving a cancelled demand marks its board row cancelled, not completed", () => {
  const { root, stateRoot } = initDemand({ demandKey: "CXL-4", complete: false, designKey: "CXL-4" });
  assert.equal(run(["cancel-demand", "--root", root, "--state-root", stateRoot, "--reason", "scope dropped", "--write", "--json"]).status, 0);
  assert.equal(run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "cancelled", "--write", "--json"]).status, 0);
  const board = readFileSync(path.join(root, ".wakeflow-active/current/global-todo-board.md"), "utf8");
  assert.match(board, /\| CXL-4 \| cancelled \/ archived \|/);
  assert.doesNotMatch(board, /\| CXL-4 \| completed \/ archived \|/);
});

// P1 fix wave: a late result from a superseded dispatch round must not
// release the in-flight round's window lock (import used to match only the
// task's CURRENT deliveryId, so any (window, task) result unlocked it).
test("importing a stale-round result leaves the in-flight round's window lock alone", () => {
  const { root, stateRoot, stateFile } = initDemand({ demandKey: "LCK-1", complete: false });
  const state = readJson(stateFile);
  state.state = "dispatched";
  state.taskPackages = [{ taskPackageId: "LCK-1-P1", summary: "s", status: "sent", targetWindow: "RepoA", targetTaskId: "LCK-1-T1" }];
  state.targetTasks = [{
    targetTaskId: "LCK-1-T1", taskPackageId: "LCK-1-P1", targetWindow: "RepoA",
    status: "sent", delivery: { deliveryId: "d2", dispatchGroup: "G2" },
  }];
  writeJson(stateFile, state);
  const locksDir = path.join(root, ".wakeflow-local/wakeflow-delivery/locks");
  mkdirSync(locksDir, { recursive: true });
  const lockPayload = {
    kind: "WakeflowWindowDeliveryLock", version: 1, windowName: "RepoA",
    deliveryId: "d2", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7200000).toISOString(),
  };
  writeJson(path.join(locksDir, "RepoA.json"), lockPayload);

  const stale = run(["import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "LCK-1-T1", "--target-window", "RepoA", "--status", "completed",
    "--dispatch-group", "G1", "--result-id", "r-old", "--write", "--json"]);
  assert.equal(stale.status, 0, stale.stderr || stale.stdout);
  const stalePayload = JSON.parse(stale.stdout);
  assert.equal(stalePayload.lockReleased ?? false, false, "stale-round result must not unlock d2");
  assert.equal(stalePayload.historyOnly, true, "stale-round result is audit history, not the task's current result");
  assert.match(stalePayload.resultFile, /target-results\/history\//);
  assert.equal(existsSync(path.join(locksDir, "RepoA.json")), true);

  const current = run(["import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "LCK-1-T1", "--target-window", "RepoA", "--status", "completed",
    "--dispatch-group", "G2", "--result-id", "r-new", "--write", "--json"]);
  assert.equal(current.status, 0, current.stderr || current.stdout);
  const currentPayload = JSON.parse(current.stdout);
  assert.equal(currentPayload.currentResult, true);
  assert.equal(currentPayload.historyOnly ?? false, false);
  const currentResult = readJson(path.join(root, currentPayload.resultFile));
  assert.equal(currentResult.dispatchGroup, "G2");
  assert.equal(currentResult.currentResult, true);
  const topLevelResults = readdirSync(path.join(root, stateRoot, "target-results"))
    .filter((name) => name.endsWith(".json"));
  assert.deepEqual(topLevelResults, ["r-new.json"]);
  assert.equal(existsSync(path.join(locksDir, "RepoA.json")), false, "current-round result releases the lock");
});
