#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const script = path.join(workspaceRoot, "scripts/wakeflow-demand-sequence.mjs");

function makeRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-sequence-"));
}

function run(args) {
  return runSync(process.execPath, [script, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createManifest(root) {
  writeJson(path.join(root, "workspace.config.json"), {
    workspaceName: "ExampleWorkspace",
    controllerWindow: "ExampleController",
    // These fixtures pin the strict single-active sequencing semantics; the
    // multi-active default (2) is covered by wakeflow-multi-demand.test.mjs.
    maxActiveDemands: 1,
  });
  const docsDir = path.join(root, "wakeflow-ledger/requirement-designs/example");
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(path.join(docsDir, "req-01.md"), standardDoc("EXAMPLE-REQ-01", "First Requirement"));
  writeFileSync(path.join(docsDir, "req-02.md"), standardDoc("EXAMPLE-REQ-02", "Second Requirement"));
  const manifestPath = path.join(docsDir, "sequence.json");
  writeJson(manifestPath, {
    kind: "ControllerDemandSequenceManifest",
    schemaVersion: 1,
    sequenceId: "EXAMPLE-SEQUENCE-2026-06-06",
    title: "Example Sequence",
    items: [
      {
        order: 1,
        demandKey: "EXAMPLE-REQ-01",
        title: "First Requirement",
        developerDoc: "wakeflow-ledger/requirement-designs/example/req-01.md",
        stateRoot: ".wakeflow-active/current/example-req-01",
        goal: "Prove the first requirement can be claimed.",
        completionDefinition: "The first requirement is reviewed and completed.",
        stagePlan: "Stage 0: review code facts.",
        initialTaskPackages: [
          {
            taskPackageId: "EXAMPLE-REQ-01-P1",
            summary: "Review first requirement code facts.",
            targetWindow: "ExampleProduct",
            targetTaskId: "EXAMPLE-REQ-01-T1",
          },
        ],
      },
      {
        order: 2,
        demandKey: "EXAMPLE-REQ-02",
        title: "Second Requirement",
        developerDoc: "wakeflow-ledger/requirement-designs/example/req-02.md",
        stateRoot: ".wakeflow-active/current/example-req-02",
        goal: "Prove the second requirement waits for the first.",
        completionDefinition: "The second requirement is reviewed and completed.",
        stagePlan: "Stage 0: review code facts.",
        initialTaskPackages: [
          {
            taskPackageId: "EXAMPLE-REQ-02-P1",
            summary: "Review second requirement code facts.",
            targetWindow: "ExampleProduct",
            targetTaskId: "EXAMPLE-REQ-02-T1",
          },
        ],
      },
    ],
  });
  return manifestPath;
}

function standardDoc(demandKey, title) {
  return `# ${title} Progress

## Unified Status

<!-- unified-status:start -->
Demand: ${demandKey} - ${title}
Main state: not-claimed
Stage: sequence-ready
Current task packages: none
Windows: none
Blockers: none
Next action: claim next.
Review: none
Automation: disabled
User decisions needed: none
Last updated: fixture
Source state: sequence manifest / no state-root
<!-- unified-status:end -->

## Goal

Fixture goal.

## Completion Definition

Fixture completion definition.

## Stage Plan

Fixture stage plan.

## Task Packages

## Backfill Summaries

## Decisions And Append Log
`;
}

function markCompleted(stateRoot) {
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = readJson(stateFile);
  writeJson(stateFile, {
    ...state,
    state: "completed",
    review: {
      ...(state.review ?? {}),
      status: "demand-completed",
    },
    taskPackages: (state.taskPackages ?? []).map((item) => ({ ...item, status: "accepted" })),
    targetTasks: (state.targetTasks ?? []).map((item) => ({ ...item, status: "accepted" })),
  });
}

function markArchived(stateRoot) {
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = readJson(stateFile);
  writeJson(stateFile, {
    ...state,
    state: "archived",
    review: {
      ...(state.review ?? {}),
      status: "demand-archived",
    },
  });
}

test("status reports the next claimable demand without writing state roots", () => {
  const root = makeRoot();
  const manifestPath = createManifest(root);
  const result = run(["status", "--root", root, "--manifest", manifestPath, "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.sequenceId, "EXAMPLE-SEQUENCE-2026-06-06");
  assert.equal(payload.totalCount, 2);
  assert.equal(payload.completedCount, 0);
  assert.equal(payload.nextClaimable.demandKey, "EXAMPLE-REQ-01");
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/example-req-01")), false);
});

test("claim-next dry-run does not create the state root", () => {
  const root = makeRoot();
  const manifestPath = createManifest(root);
  const result = run(["claim-next", "--root", root, "--manifest", manifestPath, "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.wrote, false);
  assert.equal(payload.wouldClaim.demandKey, "EXAMPLE-REQ-01");
  assert.equal(payload.wouldClaim.developerDoc, "wakeflow-ledger/requirement-designs/example/req-01.md");
  assert.match(payload.wouldClaim.dispatchCandidates[0].prepareCommand, /prepare-dispatch-from-state/);
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/example-req-01")), false);
});

test("claim-next --write creates one active state root and initial task package", () => {
  const root = makeRoot();
  const manifestPath = createManifest(root);
  const result = run(["claim-next", "--root", root, "--manifest", manifestPath, "--write", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.wrote, true);
  assert.equal(payload.claimed.demandKey, "EXAMPLE-REQ-01");
  assert.equal(payload.claimed.stateRoot, ".wakeflow-active/current/example-req-01");
  assert.equal(payload.claimed.developerDoc, "wakeflow-ledger/requirement-designs/example/req-01.md");
  assert.equal(payload.claimed.developerDocChanged, true);
  assert.deepEqual(payload.claimed.taskPackages, ["EXAMPLE-REQ-01-P1"]);
  assert.match(payload.claimed.dispatchCandidates[0].prepareCommand, /--root /);
  assert.match(payload.claimed.dispatchCandidates[0].prepareCommand, /--group EXAMPLE-REQ-01-GROUP/);
  assert.match(payload.claimed.dispatchCandidates[0].prepareCommand, /--controller-window ExampleController/);
  assert.doesNotMatch(payload.claimed.dispatchCandidates[0].prepareCommand, /--dispatch-group/);
  assert.match(payload.claimed.dispatchCandidates[0].prepareCommand, /--target-task-id EXAMPLE-REQ-01-T1/);

  const stateRoot = path.join(root, payload.claimed.stateRoot);
  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
  const progress = readFileSync(path.join(stateRoot, "developer-progress.md"), "utf8");
  const developerDoc = readFileSync(path.join(root, "wakeflow-ledger/requirement-designs/example/req-01.md"), "utf8");

  assert.equal(state.state, "planned");
  assert.equal(state.demandKey, "EXAMPLE-REQ-01");
  assert.equal(state.taskPackages[0].taskPackageId, "EXAMPLE-REQ-01-P1");
  assert.equal(state.targetTasks[0].targetWindow, "ExampleProduct");
  assert.match(progress, /Main state: planned/);
  assert.match(progress, /Current task packages: EXAMPLE-REQ-01-P1\(pending\)/);
  assert.match(developerDoc, /Main state: planned/);
  assert.match(developerDoc, /Current task packages: EXAMPLE-REQ-01-P1\(pending\)/);
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/example-req-02")), false);
});

test("sync-doc updates the standard developer document from an existing state root", () => {
  const root = makeRoot();
  const manifestPath = createManifest(root);
  const first = run(["claim-next", "--root", root, "--manifest", manifestPath, "--write", "--json"]);
  const firstPayload = JSON.parse(first.stdout);
  const docPath = path.join(root, "wakeflow-ledger/requirement-designs/example/req-01.md");
  const previousDoc = readFileSync(docPath, "utf8").replace(/Main state: planned/, "Main state: stale");
  writeFileSync(docPath, previousDoc);

  const result = run(["sync-doc", "--root", root, "--manifest", manifestPath, "--demand-key", "EXAMPLE-REQ-01", "--write", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const nextDoc = readFileSync(docPath, "utf8");

  assert.equal(payload.ok, true);
  assert.equal(payload.command, "sync-doc");
  assert.equal(payload.developerDoc, "wakeflow-ledger/requirement-designs/example/req-01.md");
  assert.match(nextDoc, /Main state: planned/);
});

test("claim-next refuses to skip an active demand", () => {
  const root = makeRoot();
  const manifestPath = createManifest(root);
  run(["claim-next", "--root", root, "--manifest", manifestPath, "--write", "--json"]);
  const result = run(["claim-next", "--root", root, "--manifest", manifestPath, "--write", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.claimed, null);
  assert.equal(payload.active.demandKey, "EXAMPLE-REQ-01");
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/example-req-02")), false);
});

test("claim-next advances only after the previous demand is archived", () => {
  const root = makeRoot();
  const manifestPath = createManifest(root);
  const first = run(["claim-next", "--root", root, "--manifest", manifestPath, "--write", "--json"]);
  const firstPayload = JSON.parse(first.stdout);
  markCompleted(path.join(root, firstPayload.claimed.stateRoot));

  const blocked = run(["claim-next", "--root", root, "--manifest", manifestPath, "--write", "--json"]);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stdout, /completed but not archived/);
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/example-req-02/wakeflow-state.json")), false);

  markArchived(path.join(root, firstPayload.claimed.stateRoot));
  const result = run(["claim-next", "--root", root, "--manifest", manifestPath, "--write", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.claimed.demandKey, "EXAMPLE-REQ-02");
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/example-req-02/wakeflow-state.json")), true);
});

test("missing landing docs fail closed", () => {
  const root = makeRoot();
  const manifestPath = path.join(root, "sequence.json");
  writeJson(manifestPath, {
    kind: "ControllerDemandSequenceManifest",
    schemaVersion: 1,
    sequenceId: "BROKEN-SEQUENCE",
    title: "Broken",
    items: [
      {
        order: 1,
        demandKey: "BROKEN-REQ-01",
        title: "Broken Requirement",
        developerDoc: "missing.md",
        goal: "Should fail.",
        completionDefinition: "Should fail.",
        stagePlan: "Should fail.",
      },
    ],
  });
  const result = run(["status", "--root", root, "--manifest", manifestPath, "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /references missing source/);
});

test("developer documents without the standard status marker fail closed", () => {
  const root = makeRoot();
  const docsDir = path.join(root, "wakeflow-ledger/requirement-designs/example");
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(path.join(docsDir, "bad.md"), "# Bad\n");
  const manifestPath = path.join(root, "sequence.json");
  writeJson(manifestPath, {
    kind: "ControllerDemandSequenceManifest",
    schemaVersion: 1,
    sequenceId: "BROKEN-STANDARD-DOC",
    title: "Broken Standard Doc",
    items: [
      {
        order: 1,
        demandKey: "BROKEN-REQ-01",
        title: "Broken Requirement",
        developerDoc: "wakeflow-ledger/requirement-designs/example/bad.md",
        goal: "Should fail.",
        completionDefinition: "Should fail.",
        stagePlan: "Should fail.",
      },
    ],
  });
  const result = run(["status", "--root", root, "--manifest", manifestPath, "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /must contain exactly one unified-status marker block/);
});
