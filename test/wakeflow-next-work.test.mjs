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

function designDoc(id, title) {
  return `# ${title}

Design Key: ${id}
`;
}

function makeFixture({ status = "idle", designRows = "", todoRows = "" } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-next-work-"));
  writeFile(
    path.join(root, ".wakeflow-active/current/workspace-current-status.md"),
    `# Status

Status: ${status}
`,
  );
  const designId = "next-design-2026-06-04";
  const designDir = path.join(root, ".wakeflow-active/current/next-design");
  writeFile(path.join(designDir, "original-plan-2026-06-04.md"), designDoc(designId, "Original Plan"));
  writeFile(path.join(designDir, "requirement-design-2026-06-04.md"), designDoc(designId, "Requirement Design"));
  writeFile(path.join(designDir, "workspace-handoff-2026-06-04.md"), designDoc(designId, "Workspace Handoff"));
  writeFile(
    path.join(root, ".wakeflow-active/current/design-handoff-board.md"),
    `# Workspace Handoff Board

## Handoff Board

| ID | Status | Title | Original Plan | Requirement Design | Handoff | User Confirmation Status | User Confirmation | Mainline Relation Status | Current Mainline Relation | Suggested TODO | Priority Enum | Priority | Next Step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${designRows}
`,
  );
  writeFile(
    path.join(root, ".wakeflow-active/current/global-todo-board.md"),
    `# Global TODO

## Global TODO

| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${todoRows}
`,
  );
  return { designId, root };
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

test("single ready Design handoff becomes auto-claimable candidate only", () => {
  const { root, designId } = makeFixture({
    designRows:
      "| next-design-2026-06-04 | ready-for-workspace | Next design | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | [handoff](next-design/workspace-handoff-2026-06-04.md) | confirmed |  | next-mainline | after current mainline | GTODO-NEXT | P1 | P1 | controller intake |",
  });
  const result = run(root, ["--after-completion"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.autoClaimable, true);
  assert.equal(parsed.recommended.id, designId);
  assert.equal(parsed.recommended.source, "design");
});

test("ready Design demand without separate handoff link remains claimable from requirement design", () => {
  const { root } = makeFixture({
    designRows:
      "| optional-handoff-2026-06-04 | ready-for-workspace | Optional handoff design | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | Requirement design contains handoff details | confirmed |  | next-mainline | after current mainline | GTODO-NEXT | P1 | P1-runtime-reliability | controller intake |",
  });
  const result = run(root, ["--id", "optional-handoff-2026-06-04", "--after-completion"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.autoClaimable, true);
  assert.equal(parsed.recommended.id, "optional-handoff-2026-06-04");
  assert.equal(parsed.recommended.priority, "P1");
  assert.equal(parsed.recommended.documents.handoff.optionalMissing, true);
});

test("target id focuses next-work scan when multiple ready Design demands exist", () => {
  const { root } = makeFixture({
    designRows: [
      "| first-design-2026-06-04 | ready-for-workspace | First design | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | Requirement design contains handoff details | confirmed |  | next-mainline | after current mainline | GTODO-FIRST | P1 | P1 | controller intake |",
      "| second-design-2026-06-04 | ready-for-workspace | Second design | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | Requirement design contains handoff details | confirmed |  | next-mainline | after current mainline | GTODO-SECOND | P1 | P1 | controller intake |",
    ].join("\n"),
  });
  const result = run(root, ["--id", "second-design-2026-06-04", "--after-completion"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.candidateCount, 1);
  assert.equal(parsed.autoClaimable, true);
  assert.equal(parsed.recommended.id, "second-design-2026-06-04");
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

test("controller-claimable Design row reports controllerClaimable; ready-for-workspace reports false", () => {
  const { root } = makeFixture({
    designRows: [
      "| claim-design-2026-06-04 | controller-claimable | Claimable | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | Requirement design contains handoff details | confirmed |  | next-mainline | after current mainline | GTODO-CLAIM | P1 | P1 | controller intake |",
      "| ready-design-2026-06-04 | ready-for-workspace | Ready | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | Requirement design contains handoff details | confirmed |  | next-mainline | after current mainline | GTODO-READY | P1 | P1 | controller intake |",
    ].join("\n"),
  });
  const result = run(root, ["--source", "design"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  const claim = parsed.candidates.find((candidate) => candidate.id === "claim-design-2026-06-04");
  const ready = parsed.candidates.find((candidate) => candidate.id === "ready-design-2026-06-04");
  assert.equal(claim.controllerClaimable, true);
  assert.equal(ready.controllerClaimable, false);
});

test("Design rows with an existing active state root are lifecycle-blocked", () => {
  const { root, designId } = makeFixture({
    designRows:
      "| next-design-2026-06-04 | controller-claimable | Next design | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | [handoff](next-design/workspace-handoff-2026-06-04.md) | confirmed |  | next-mainline | after current mainline | GTODO-NEXT | P1 | P1 | controller intake |",
  });
  writeJson(path.join(root, ".wakeflow-active/current", designId, "wakeflow-state.json"), {
    demandKey: designId,
    state: "planned",
  });

  const result = run(root, ["--id", designId, "--source", "design"]);
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.match(parsed.issues.join("\n"), /already active: planned/);
});

test("next-work blocks new candidates while another demand state root is unarchived", () => {
  const { root } = makeFixture({
    designRows:
      "| next-design-2026-06-04 | controller-claimable | Next design | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | [handoff](next-design/workspace-handoff-2026-06-04.md) | confirmed |  | next-mainline | after current mainline | GTODO-NEXT | P1 | P1 | controller intake |",
  });
  writeJson(path.join(root, ".wakeflow-active/current/current-demand/wakeflow-state.json"), {
    demandKey: "current-demand",
    state: "needs-rework",
  });

  const result = run(root, ["--source", "design", "--after-completion"]);
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.candidateCount, 0);
  assert.match(parsed.issues.join("\n"), /workspace has unarchived demand state root/);
  assert.equal(parsed.workspaceDemandConflicts[0].demandKey, "current-demand");
});

test("Design rows with an archived state root are lifecycle-blocked", () => {
  const { root, designId } = makeFixture({
    designRows:
      "| next-design-2026-06-04 | controller-claimable | Next design | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | [handoff](next-design/workspace-handoff-2026-06-04.md) | confirmed |  | next-mainline | after current mainline | GTODO-NEXT | P1 | P1 | controller intake |",
  });
  writeJson(path.join(root, "workspace.config.json"), {
    workspaceArchiveDir: "wakeflow-ledger/workspace/archive",
  });
  writeJson(path.join(root, "wakeflow-ledger/workspace/archive/2026-06", designId, "wakeflow-state.json"), {
    demandKey: designId,
    state: "archived",
  });

  const result = run(root, ["--id", designId, "--source", "design"]);
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.match(parsed.issues.join("\n"), /already archived/);
});
