#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const repositoryRoot = path.resolve(workspaceRoot, "../..");
const script = path.join(workspaceRoot, "scripts/wakeflow-state.mjs");
const deliveryScript = path.join(workspaceRoot, "scripts/wakeflow-delivery.mjs");
const archivePendingFileName = "wakeflow-archive.pending-intent.json";

function run(args) {
  return runSync(process.execPath, [script, ...args], { cwd: workspaceRoot, encoding: "utf8" });
}
function runDelivery(args) {
  return runSync(process.execPath, [deliveryScript, ...args], { cwd: workspaceRoot, encoding: "utf8" });
}
function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }
function writeJson(file, value) { writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

function markDemandCompleted(root, stateRoot, stateFile) {
  const state = readJson(stateFile);
  const createdAt = new Date().toISOString();
  const revision = Number(state.revision) + 1;
  const event = {
    eventId: `evt-test-completed-${revision}`,
    createdAt,
    actor: "controller",
    type: "demand.completed",
    from: state.state,
    to: "completed",
    reason: "test fixture completion",
    evidenceRefs: ["test:archive-fixture"],
    allowedWrites: ["wakeflow-state.json", "controller-events.jsonl"],
    forbiddenConclusions: ["fixture-is-production-evidence"],
    stateRevision: revision,
  };
  writeFileSync(
    path.join(root, stateRoot, "controller-events.jsonl"),
    `${JSON.stringify(event)}\n`,
    { flag: "a" },
  );
  writeJson(stateFile, {
    ...state,
    state: "completed",
    stateReason: event.reason,
    revision,
    updatedAt: createdAt,
    allowedActions: ["wakeflow-render-progress"],
    decisionsRequired: [],
    projection: { ...(state.projection ?? {}), status: "stale" },
  });
}

function archiveTreeDigest(root) {
  const hash = createHash("sha256");
  let entries = 0;
  const visit = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(absolute);
      entries += 1;
      if (stat.isDirectory()) {
        hash.update(`directory\0${relativePath}\0`);
        visit(absolute, relativePath);
      } else if (stat.isFile()) {
        const content = readFileSync(absolute);
        hash.update(`file\0${relativePath}\0${content.length}\0`);
        hash.update(content);
        hash.update("\0");
      } else if (stat.isSymbolicLink()) {
        const target = readlinkSync(absolute);
        hash.update(`symlink\0${relativePath}\0${Buffer.byteLength(target)}\0${target}\0`);
      } else {
        throw new Error(`unsupported archive fixture entry: ${relativePath}`);
      }
    }
  };
  visit(root);
  return { algorithm: "sha256", value: hash.digest("hex"), entries };
}

function initDemand({ demandKey = "ARCH-1", complete = true, designKey = null } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-archive-"));
  writeJson(path.join(root, "wakeflow.config.json"), {
    workspaceName: "X",
    controllerWindow: "C",
    projectLedgerRoot: "wakeflow-ledger",
    workspaceArchiveDir: "wakeflow-ledger/workspace/archive",
  });
  const init = JSON.parse(run(["init", "--root", root, "--demand-key", demandKey, "--title", "Archive me", ...(designKey ? ["--design-key", designKey] : []), "--write", "--json"]).stdout);
  const stateFile = path.join(root, init.stateRoot, "wakeflow-state.json");
  if (complete) markDemandCompleted(root, init.stateRoot, stateFile);
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

function makeCoreRuntime() {
  const runtimeParent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-core-archive-runtime-"));
  const runtimeRoot = path.join(runtimeParent, "wakeflow");
  cpSync(path.join(repositoryRoot, "core"), runtimeRoot, { recursive: true });
  mkdirSync(path.join(runtimeRoot, "templates"), { recursive: true });
  cpSync(
    path.join(repositoryRoot, "plugins/codex-wakeflow/templates/wakeflow-template-bundle.json"),
    path.join(runtimeRoot, "templates/wakeflow-template-bundle.json"),
  );
  const coreScript = path.join(runtimeRoot, "scripts/wakeflow-state.mjs");
  const runCore = (args) => runSync(process.execPath, [coreScript, ...args], {
    cwd: runtimeRoot,
    encoding: "utf8",
  });
  return { runtimeRoot, runCore };
}

function initCoreDemand({
  demandKey = "ARCH-RECOVERY",
  complete = true,
  config = {},
} = {}) {
  const { runCore } = makeCoreRuntime();
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-core-archive-"));
  writeJson(path.join(root, "wakeflow.config.json"), {
    workspaceName: "X",
    controllerWindow: "C",
    projectLedgerRoot: "wakeflow-ledger",
    workspaceArchiveDir: "wakeflow-ledger/workspace/archive",
    ...config,
  });
  const initialized = runCore([
    "init",
    "--root", root,
    "--demand-key", demandKey,
    "--title", "Archive recovery",
    "--write",
    "--json",
  ]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  const init = JSON.parse(initialized.stdout);
  const stateFile = path.join(root, init.stateRoot, "wakeflow-state.json");
  if (complete) markDemandCompleted(root, init.stateRoot, stateFile);
  return {
    root,
    stateRoot: init.stateRoot,
    stateFile,
    eventsFile: path.join(root, init.stateRoot, "controller-events.jsonl"),
    pendingFile: path.join(root, init.stateRoot, archivePendingFileName),
    runCore,
  };
}

test("init refuses the reserved invisible staging namespace", () => {
  const { runCore } = makeCoreRuntime();
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-core-init-prefix-"));
  const result = runCore([
    "init",
    "--root", root,
    "--demand-key", ".wakeflow-init-real-demand",
    "--title", "Must remain visible",
    "--write",
    "--json",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /reserved.*wakeflow-init|wakeflow-init.*reserved/i);
  assert.equal(
    existsSync(path.join(root, ".wakeflow-active/current/.wakeflow-init-real-demand")),
    false,
  );
});

test("archive-demand refuses a demand that is not completed", () => {
  const { root, stateRoot } = initDemand({ demandKey: "ARCH-2", complete: false });
  const result = run(["archive-demand", "--root", root, "--state-root", stateRoot, "--reason", "x", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /requires state=completed/);
});

test("archive-demand refuses a terminal state not explained by its strict event history", () => {
  const {
    root, stateRoot, stateFile, runCore,
  } = initCoreDemand({
    demandKey: "ARCH-COUNTERFEIT-TERMINAL",
    complete: false,
  });
  writeJson(stateFile, {
    ...readJson(stateFile),
    state: "completed",
    stateReason: "counterfeit fixture without a terminal event",
  });

  const result = runCore([
    "archive-demand",
    "--root", root,
    "--state-root", stateRoot,
    "--reason", "must refuse",
    "--write",
    "--json",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout + result.stderr,
    /no matching demand\.completed event|terminal state.*event history/i,
  );
  assert.equal(readJson(stateFile).state, "completed");
  assert.equal(
    existsSync(path.join(root, "wakeflow-ledger/workspace/archive")),
    false,
  );
});

test("archive-demand commits only below configured workspaceArchiveDir", () => {
  const {
    root, stateRoot, runCore,
  } = initCoreDemand({
    demandKey: "ARCH-CUSTOM-ROOT",
    config: {
      projectLedgerRoot: "primary-ledger",
      workspaceArchiveDir: "separate-ledger/committed-archives",
    },
  });
  const result = runCore([
    "archive-demand",
    "--root", root,
    "--state-root", stateRoot,
    "--reason", "configured archive root",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.match(
    payload.archived.ledgerDest,
    /^separate-ledger\/committed-archives\/\d{4}-\d{2}\/ARCH-CUSTOM-ROOT$/,
  );
  assert.equal(existsSync(path.join(root, payload.archived.ledgerDest)), true);
  assert.equal(
    existsSync(path.join(root, "primary-ledger/workspace/archive")),
    false,
    "projectLedgerRoot must not override the configured archive directory",
  );
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

test("archive-demand refuses opaque files by default and records hashes when explicitly allowed", () => {
  const { root, stateRoot, stateFile } = initDemand({ demandKey: "ARCH-OPAQUE" });
  const opaqueFile = path.join(root, stateRoot, "evidence", "fixture.bin");
  mkdirSync(path.dirname(opaqueFile), { recursive: true });
  writeFileSync(opaqueFile, Buffer.from([0xff, 0xfe, 0x00, 0x41]));

  const refused = run([
    "archive-demand", "--root", root, "--state-root", stateRoot,
    "--reason", "opaque fixture", "--write", "--json",
  ]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stdout + refused.stderr, /opaque file.*--allow-opaque/i);
  assert.equal(readJson(stateFile).state, "completed");
  assert.equal(existsSync(path.join(root, stateRoot, archivePendingFileName)), false);

  const allowed = run([
    "archive-demand", "--root", root, "--state-root", stateRoot,
    "--reason", "opaque fixture", "--allow-opaque", "--write", "--json",
  ]);
  assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
  const payload = JSON.parse(allowed.stdout);
  const manifest = readJson(path.join(root, payload.archived.ledgerDest, "archive-manifest.json"));
  assert.deepEqual(manifest.opaqueFiles.map((item) => ({
    file: item.file,
    algorithm: item.algorithm,
    bytes: item.bytes,
  })), [{
    file: "evidence/fixture.bin",
    algorithm: "sha256",
    bytes: 4,
  }]);
  assert.match(manifest.opaqueFiles[0].sha256, /^[a-f0-9]{64}$/);
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
  assert.match(result.stdout, /active state authority was left unchanged/);
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

test("archive-demand can switch to --redact after command metadata fails the final privacy scan", () => {
  const {
    root, stateRoot, stateFile, pendingFile, runCore,
  } = initCoreDemand({ demandKey: "ARCH-METADATA-PRIVACY" });
  const reason = `verified under ${root}/private-report.json`;
  const initial = runCore([
    "archive-demand",
    "--root", root,
    "--state-root", stateRoot,
    "--reason", reason,
    "--write",
    "--json",
  ]);

  assert.notEqual(initial.status, 0);
  assert.match(initial.stdout + initial.stderr, /privacy scan|workspace-absolute-path/i);
  assert.equal(readJson(stateFile).state, "completed");
  assert.equal(
    existsSync(pendingFile),
    false,
    "a deterministic metadata privacy refusal must not pin a non-redacted intent",
  );

  const redacted = runCore([
    "archive-demand",
    "--root", root,
    "--state-root", stateRoot,
    "--reason", reason,
    "--redact",
    "--write",
    "--json",
  ]);
  assert.equal(redacted.status, 0, redacted.stderr || redacted.stdout);
  const payload = JSON.parse(redacted.stdout);
  assert.equal(payload.archived.preservedOriginal, true);
  assert.equal(existsSync(path.join(root, payload.archived.ledgerDest)), true);
});

test("archive-demand refuses a symlinked local preserved boundary", () => {
  for (const component of [".wakeflow-local", ".wakeflow-local/preserved"]) {
    const {
      root, stateRoot, stateFile, runCore,
    } = initCoreDemand({ demandKey: `ARCH-PRESERVED-${path.basename(component).toUpperCase()}` });
    const external = mkdtempSync(path.join(os.tmpdir(), "wakeflow-preserved-escape-"));
    const link = path.join(root, component);
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(external, link, "dir");

    const archived = runCore([
      "archive-demand",
      "--root", root,
      "--state-root", stateRoot,
      "--reason", "preserved boundary",
      "--redact",
      "--write",
      "--json",
    ]);

    assert.notEqual(archived.status, 0, `${component} symlink must fail closed`);
    assert.match(archived.stdout + archived.stderr, /archive (?:local|preserved) root.*symbolic link/i);
    assert.equal(readJson(stateFile).state, "completed");
    assert.deepEqual(readdirSync(external), [], "un-redacted state must never move through the symlink");
  }
});

test("archive-demand resumes a redacted archive whose state is archived but still under current", () => {
  const {
    root, stateRoot, stateFile, eventsFile, pendingFile, runCore,
  } = initCoreDemand({ demandKey: "ARCH-RESUME" });
  const preservedBlocker = path.join(root, ".wakeflow-local/preserved");
  mkdirSync(path.dirname(preservedBlocker), { recursive: true });
  writeFileSync(preservedBlocker, "block preserved directory creation\n");
  const archiveArgs = [
    "archive-demand",
    "--root", root,
    "--state-root", stateRoot,
    "--reason", "recovery fixture",
    "--evidence-ref", "test:archive-recovery",
    "--redact",
    "--write",
    "--json",
  ];

  const interrupted = runCore(archiveArgs);
  assert.notEqual(interrupted.status, 0, interrupted.stderr || interrupted.stdout);
  assert.equal(readJson(stateFile).state, "archived", "active state reached archived before its preserve move failed");
  assert.equal(existsSync(pendingFile), true, "archive intent survives the incomplete active finalize");
  const intentBefore = readJson(pendingFile);
  const ledgerDest = path.join(root, intentBefore.ledgerDest);
  assert.equal(existsSync(ledgerDest), true, "ledger commit is retained for recovery");
  const ledgerManifestBefore = readFileSync(path.join(ledgerDest, "archive-manifest.json"), "utf8");
  const ledgerStateBefore = readFileSync(path.join(ledgerDest, "wakeflow-state.json"), "utf8");
  const ledgerEventsBefore = readFileSync(path.join(ledgerDest, "controller-events.jsonl"), "utf8");
  const activeEventsBefore = readFileSync(eventsFile, "utf8");

  const wrongArgs = runCore([
    ...archiveArgs.slice(0, archiveArgs.indexOf("--reason") + 1),
    "different reason",
    ...archiveArgs.slice(archiveArgs.indexOf("--reason") + 2),
  ]);
  assert.notEqual(wrongArgs.status, 0);
  assert.match(wrongArgs.stdout, /command arguments.*intent|intent.*command arguments/i);
  assert.deepEqual(readJson(pendingFile), intentBefore, "argument mismatch must not rewrite the intent");
  assert.equal(readFileSync(path.join(ledgerDest, "archive-manifest.json"), "utf8"), ledgerManifestBefore);
  assert.equal(readFileSync(path.join(ledgerDest, "wakeflow-state.json"), "utf8"), ledgerStateBefore);
  assert.equal(readFileSync(path.join(ledgerDest, "controller-events.jsonl"), "utf8"), ledgerEventsBefore);
  assert.equal(readFileSync(eventsFile, "utf8"), activeEventsBefore, "argument mismatch must not duplicate the archive event");

  rmSync(preservedBlocker, { force: true });
  const resumed = runCore(archiveArgs);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  const payload = JSON.parse(resumed.stdout);
  assert.equal(payload.archived.resumed, true);
  assert.equal(payload.archived.ledgerDest, intentBefore.ledgerDest);
  assert.equal(existsSync(path.join(root, stateRoot)), false, "recovery moves the archived original out of current");
  assert.equal(existsSync(path.join(root, intentBefore.preservedDest)), true);
  assert.equal(existsSync(path.join(root, intentBefore.preservedDest, archivePendingFileName)), false);
  assert.equal(readFileSync(path.join(ledgerDest, "archive-manifest.json"), "utf8"), ledgerManifestBefore);
  assert.equal(readFileSync(path.join(ledgerDest, "wakeflow-state.json"), "utf8"), ledgerStateBefore);
  assert.equal(readFileSync(path.join(ledgerDest, "controller-events.jsonl"), "utf8"), ledgerEventsBefore);
});

test("archive-demand refuses to overwrite or delete a committed ledger that diverges from its intent", () => {
  const {
    root, stateRoot, stateFile, pendingFile, runCore,
  } = initCoreDemand({ demandKey: "ARCH-TAMPER" });
  const preservedBlocker = path.join(root, ".wakeflow-local/preserved");
  mkdirSync(path.dirname(preservedBlocker), { recursive: true });
  writeFileSync(preservedBlocker, "block preserved directory creation\n");
  const archiveArgs = [
    "archive-demand",
    "--root", root,
    "--state-root", stateRoot,
    "--reason", "tamper fixture",
    "--redact",
    "--write",
    "--json",
  ];
  const interrupted = runCore(archiveArgs);
  assert.notEqual(interrupted.status, 0, interrupted.stderr || interrupted.stdout);
  assert.equal(readJson(stateFile).state, "archived");
  const intent = readJson(pendingFile);
  const ledgerDest = path.join(root, intent.ledgerDest);
  const files = {
    "archive-manifest.json": readFileSync(path.join(ledgerDest, "archive-manifest.json"), "utf8"),
    "wakeflow-state.json": readFileSync(path.join(ledgerDest, "wakeflow-state.json"), "utf8"),
    "controller-events.jsonl": readFileSync(path.join(ledgerDest, "controller-events.jsonl"), "utf8"),
    "demand.json": readFileSync(path.join(ledgerDest, "demand.json"), "utf8"),
  };

  for (const [name, original] of Object.entries(files)) {
    const file = path.join(ledgerDest, name);
    if (name.endsWith(".json")) {
      writeJson(file, { ...JSON.parse(original), recoveryTamper: name });
    } else {
      const lines = original.trimEnd().split("\n");
      const last = JSON.parse(lines.at(-1));
      lines[lines.length - 1] = JSON.stringify({ ...last, recoveryTamper: name });
      writeFileSync(file, `${lines.join("\n")}\n`);
    }
    const retry = runCore(archiveArgs);
    assert.notEqual(retry.status, 0, `${name} divergence must block recovery`);
    assert.match(retry.stdout, /committed archive.*does not match.*intent|does not match.*archive intent/i);
    assert.equal(existsSync(ledgerDest), true, "mismatched ledger must never be deleted");
    assert.equal(readFileSync(file, "utf8").includes("recoveryTamper"), true, "mismatched ledger must never be overwritten");
    writeFileSync(file, original);
  }

  assert.deepEqual(readJson(pendingFile), intent, "ledger mismatches must not rewrite the intent");
  assert.equal(existsSync(path.join(root, stateRoot)), true, "ledger mismatch leaves the active root for manual inspection");
});

test("archive-demand reuses its fixed intent after a pre-ledger staging failure", () => {
  const {
    root, stateRoot, stateFile, pendingFile, runCore,
  } = initCoreDemand({ demandKey: "ARCH-PRESTAGE" });
  const baseArgs = [
    "archive-demand",
    "--root", root,
    "--state-root", stateRoot,
    "--reason", "pre-ledger retry",
    "--json",
  ];
  const dryRun = runCore(baseArgs);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.equal(existsSync(pendingFile), false, "dry-run must not persist an archive intent");
  const dryPayload = JSON.parse(dryRun.stdout);
  const ledgerDest = path.join(root, dryPayload.wouldArchive.ledgerDest);
  const blockedMonthDir = path.dirname(ledgerDest);
  mkdirSync(path.dirname(blockedMonthDir), { recursive: true });
  writeFileSync(blockedMonthDir, "block archive month directory\n");

  const interrupted = runCore([...baseArgs.slice(0, -1), "--write", "--json"]);
  assert.notEqual(interrupted.status, 0);
  assert.equal(readJson(stateFile).state, "completed");
  assert.equal(existsSync(pendingFile), true, "pre-ledger failure retains the fixed archive intent");
  const intentBefore = readJson(pendingFile);
  assert.equal(intentBefore.ledgerDest, dryPayload.wouldArchive.ledgerDest);
  assert.equal(intentBefore.ledgerSnapshot, null);

  rmSync(blockedMonthDir, { force: true });
  const resumed = runCore([...baseArgs.slice(0, -1), "--write", "--json"]);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  const payload = JSON.parse(resumed.stdout);
  assert.equal(payload.archived.resumed, true);
  assert.equal(payload.archived.ledgerDest, intentBefore.ledgerDest);
  assert.equal(existsSync(path.join(root, stateRoot)), false);
  assert.equal(readJson(path.join(root, intentBefore.ledgerDest, "wakeflow-state.json")).state, "archived");
});

test("archive-demand resumes non-redacted active deletion after the ledger commit", () => {
  const {
    root, stateRoot, pendingFile, runCore,
  } = initCoreDemand({ demandKey: "ARCH-DELETE-RESUME" });
  const activeRoot = path.join(root, stateRoot);
  const sourceBackup = mkdtempSync(path.join(os.tmpdir(), "wakeflow-archive-source-backup-"));
  cpSync(activeRoot, path.join(sourceBackup, "state"), { recursive: true });
  const archiveArgs = [
    "archive-demand",
    "--root", root,
    "--state-root", stateRoot,
    "--reason", "delete retry",
    "--write",
    "--json",
  ];
  const committed = runCore(archiveArgs);
  assert.equal(committed.status, 0, committed.stderr || committed.stdout);
  const committedPayload = JSON.parse(committed.stdout);
  const ledgerDest = path.join(root, committedPayload.archived.ledgerDest);
  const ledgerEvents = readFileSync(path.join(ledgerDest, "controller-events.jsonl"), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  const ledgerSnapshot = {
    manifest: readJson(path.join(ledgerDest, "archive-manifest.json")),
    nextState: readJson(path.join(ledgerDest, "wakeflow-state.json")),
    event: ledgerEvents.at(-1),
    treeDigest: archiveTreeDigest(ledgerDest),
  };

  // Recreate the exact bytes a process crash immediately after ledger rename
  // would have left in current/: source authority plus its persisted intent.
  cpSync(path.join(sourceBackup, "state"), activeRoot, { recursive: true });
  const sourceState = readJson(path.join(activeRoot, "wakeflow-state.json"));
  writeJson(pendingFile, {
    kind: "WakeflowArchivePendingIntent",
    version: 1,
    command: "archive-demand",
    createdAt: ledgerSnapshot.manifest.archivedAt,
    sourceStateRoot: stateRoot,
    ledgerDest: committedPayload.archived.ledgerDest,
    preservedDest: null,
    commandArgs: { reason: "delete retry", redact: false, evidenceRefs: [] },
    sourceState,
    event: ledgerSnapshot.event,
    nextState: ledgerSnapshot.nextState,
    archiveManifest: ledgerSnapshot.manifest,
    initialScan: { clean: true, findings: [] },
    danglingRefs: [],
    ledgerSnapshot,
  });

  const resumed = runCore(archiveArgs);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  const payload = JSON.parse(resumed.stdout);
  assert.equal(payload.archived.resumed, true);
  assert.equal(existsSync(activeRoot), false, "retry only finalizes removal of the active source");
  assert.equal(existsSync(ledgerDest), true);
  assert.deepEqual(readJson(path.join(ledgerDest, "archive-manifest.json")), ledgerSnapshot.manifest);
  assert.deepEqual(readJson(path.join(ledgerDest, "wakeflow-state.json")), ledgerSnapshot.nextState);
  assert.equal(readFileSync(path.join(ledgerDest, "controller-events.jsonl"), "utf8").trimEnd().split("\n").at(-1), JSON.stringify(ledgerSnapshot.event));
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
  assert.equal(again.status, 0, again.stderr || again.stdout);
  const replay = JSON.parse(again.stdout);
  assert.equal(replay.wrote, false);
  assert.equal(replay.stateRevision, state.revision);
  assert.equal(
    readFileSync(path.join(root, stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n").length,
    events.length,
    "idempotent cancellation replay must not append another event",
  );

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

  const cancelledState = readJson(stateFile);
  const eventCount = readFileSync(path.join(root, stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n").length;
  writeJson(path.join(locksDir, "RepoA.json"), {
    kind: "WakeflowWindowDeliveryLock", version: 1, windowName: "RepoA",
    deliveryId: "d-cxl-3", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7200000).toISOString(),
  });
  const replay = run(["cancel-demand", "--root", root, "--state-root", stateRoot, "--reason", "stop", "--write", "--json"]);
  assert.equal(replay.status, 0, replay.stderr || replay.stdout);
  assert.deepEqual(JSON.parse(replay.stdout).releasedWindowLocks, ["RepoA"]);
  assert.equal(existsSync(path.join(locksDir, "RepoA.json")), false, "replay cleans a residual own lock");
  assert.equal(existsSync(path.join(locksDir, "RepoB.json")), true, "replay still leaves foreign lock untouched");
  assert.equal(readJson(stateFile).revision, cancelledState.revision, "replay must not bump the state revision");
  assert.equal(
    readFileSync(path.join(root, stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n").length,
    eventCount,
    "replay must not append a second cancellation event",
  );
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
  const packetDir = path.join(root, ".wakeflow-local/wakeflow-delivery/dispatch-packets");
  mkdirSync(packetDir, { recursive: true });
  writeJson(path.join(packetDir, "G1__RepoA__LCK-1-T1.json"), {
    kind: "ControllerDispatchPacket",
    version: 1,
    id: "G1__RepoA__LCK-1-T1",
    targetWindow: "RepoA",
    taskId: "LCK-1-T1",
    dispatchGroup: "G1",
    stateRef: {
      stateRoot,
      demandKey: "LCK-1",
      taskPackageId: "LCK-1-P1",
      targetTaskId: "LCK-1-T1",
    },
  });
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
    "--dispatch-group", "G1", "--result-id", "r-old",
    "--summary", "Late G1 result retained for audit history.", "--write", "--json"]);
  assert.equal(stale.status, 0, stale.stderr || stale.stdout);
  const stalePayload = JSON.parse(stale.stdout);
  assert.equal(stalePayload.lockReleased ?? false, false, "stale-round result must not unlock d2");
  assert.equal(stalePayload.historyOnly, true, "stale-round result is audit history, not the task's current result");
  assert.match(stalePayload.resultFile, /target-results\/history\//);
  assert.equal(existsSync(path.join(locksDir, "RepoA.json")), true);

  const current = run(["import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "LCK-1-T1", "--target-window", "RepoA", "--status", "completed",
    "--dispatch-group", "G2", "--result-id", "r-new",
    "--summary", "Current G2 result completed.", "--write", "--json"]);
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
