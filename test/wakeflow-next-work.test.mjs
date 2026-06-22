#!/usr/bin/env node

import assert from "node:assert/strict";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const script = path.join(workspaceRoot, "scripts/wakeflow-next-work.mjs");

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function writeJson(file, value) {
  writeFile(file, JSON.stringify(value, null, 2));
}

function makeFixture({ status = "idle", todoRows = "" } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-next-work-"));
  writeFile(
    path.join(root, ".wakeflow-active/current/workspace-current-status.md"),
    `# Status\n\nStatus: ${status}\n`,
  );
  writeFile(
    path.join(root, ".wakeflow-active/current/global-todo-board.md"),
    `# Global TODO\n\n## Global TODO\n\n| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${todoRows}\n`,
  );
  return { root };
}

function run(root, args = []) {
  return runSync(process.execPath, [script, "--json", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("after-completion fails closed when current state is not completed or idle", () => {
  const { root } = makeFixture({ status: "paused / user stop" });
  const result = run(root, ["--after-completion"]);
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.match(parsed.issues.join("\n"), /requires current state completed or idle/);
});

test("TODO candidates exclude completed slash-status and Aux-owned rows", () => {
  const { root } = makeFixture({
    todoRows: [
      "| DONE-2026-06-04 | completed / controller-accepted | fixture | P1 | Workspace | done | no | evidence | AlembicWorkspace | current |",
      "| AUX-2026-06-04 | Aux claimed / continue | fixture | P1 | AlembicWorkspace-Aux | aux | yes | Aux | AlembicWorkspace-Aux | current |",
      "| CLAIM-2026-06-04 | pending-schedule | fixture | P1 | Wakeflow | claimable | yes | none | Wakeflow | current |",
    ].join("\n"),
  });
  const result = run(root, ["--source", "todo", "--after-completion"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.candidateCount, 1);
  assert.equal(parsed.recommended.id, "CLAIM-2026-06-04");
  assert.equal(parsed.autoClaimable, true);
});

test("unified-surface TODO row: Auto Claim drives controllerClaimable", () => {
  const { root } = makeFixture({});
  writeFile(
    path.join(root, ".wakeflow-active/current/global-todo-board.md"),
    `# Global TODO

## Global TODO

| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount | Auto Claim | Documents |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTO-2026-06-04 | pending-claim | requirement | P1 | Wakeflow | auto deliverable | no | none | Wakeflow | none | yes | [plan](p.md) |
| MANUAL-2026-06-04 | pending-claim | requirement | P1 | Wakeflow | manual deliverable | no | none | Wakeflow | none | no |  |`,
  );
  const result = run(root, ["--source", "todo", "--after-completion"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  const auto = parsed.candidates.find((candidate) => candidate.id === "AUTO-2026-06-04");
  const manual = parsed.candidates.find((candidate) => candidate.id === "MANUAL-2026-06-04");
  assert.ok(auto, "Auto Claim=yes row should be an eligible candidate");
  assert.equal(auto.autoClaim, true);
  assert.equal(auto.controllerClaimable, true);
  assert.ok(manual, "Auto Claim=no row should still be eligible (controller confirms)");
  assert.equal(manual.controllerClaimable, false);
});

test("next-work blocks new candidates while another demand state root is unarchived", () => {
  const { root } = makeFixture({
    todoRows:
      "| NEXT-2026-06-04 | pending-claim | requirement | P1 | Wakeflow | next | no | none | Wakeflow | none |",
  });
  writeJson(path.join(root, ".wakeflow-active/current/current-demand/wakeflow-state.json"), {
    demandKey: "current-demand",
    state: "needs-rework",
  });

  const result = run(root, ["--source", "todo", "--after-completion"]);
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.candidateCount, 0);
  assert.match(parsed.issues.join("\n"), /workspace has unarchived demand state root/);
  assert.equal(parsed.workspaceDemandConflicts[0].demandKey, "current-demand");
});
