#!/usr/bin/env node

import assert from "node:assert/strict";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const script = path.join(workspaceRoot, "scripts/wakeflow-import-design-handoffs.mjs");

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function designDoc(id, title) {
  return `# ${title}

Design Key: ${id}

## Goal

Fixture only.
`;
}

function makeFixture({ row, header }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-import-design-handoffs-"));
  const id = "enum-flow-2026-05-30";
  const designDir = path.join(root, "DesignWindow/docs/current/enum-flow");
  writeFile(path.join(designDir, "original-plan-2026-05-30.md"), designDoc(id, "Original Plan"));
  writeFile(path.join(designDir, "requirement-design-2026-05-30.md"), designDoc(id, "Requirement Design"));
  writeFile(path.join(designDir, "workspace-handoff-2026-05-30.md"), designDoc(id, "Workspace Handoff"));
  writeFile(
    path.join(root, "DesignWindow/docs/current/workspace-handoff-board.md"),
    `# Workspace Handoff Board

## Handoff Board

${header}
${row}
`,
  );
  return {
    board: path.join(root, "DesignWindow/docs/current/workspace-handoff-board.md"),
    id,
    root,
  };
}

function run({ board, id, root }) {
  return runSync(process.execPath, [script, "--board", board, "--id", id, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

const legacyHeader = `| ID | Status | Title | Original Plan | Requirement Design | Handoff | User Confirmation | Current Mainline Relation | Suggested TODO | Priority | Next Step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`;

const enumHeader = `| ID | Status | Title | Original Plan | Requirement Design | Handoff | User Confirmation Status | User Confirmation | Mainline Relation Status | Current Mainline Relation | Suggested TODO | Priority Enum | Priority | Next Step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`;

function legacyRow(userConfirmation = "user confirmed") {
  return `| enum-flow-2026-05-30 | ready-for-workspace | Enum fixture | [original](enum-flow/original-plan-2026-05-30.md) | [design](enum-flow/requirement-design-2026-05-30.md) | [handoff](enum-flow/workspace-handoff-2026-05-30.md) | ${userConfirmation} | does not affect current mainline | TODO | P1 | controller intake |`;
}

function enumRow({ confirmationStatus, userConfirmation = "", mainlineStatus = "todo-candidate", priorityStatus = "P1" }) {
  return `| enum-flow-2026-05-30 | ready-for-workspace | Enum fixture | [original](enum-flow/original-plan-2026-05-30.md) | [design](enum-flow/requirement-design-2026-05-30.md) | [handoff](enum-flow/workspace-handoff-2026-05-30.md) | ${confirmationStatus} | ${userConfirmation} | ${mainlineStatus} | does not affect current mainline | TODO | ${priorityStatus} | P1 | controller intake |`;
}

test("legacy user confirmation text remains accepted for old boards", () => {
  const result = run(makeFixture({ header: legacyHeader, row: legacyRow() }));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.issueCount, 0);
  assert.equal(parsed.target.userConfirmationStatus.status, "confirmed");
  assert.equal(parsed.target.userConfirmationStatus.source, "legacy-text");
});

test("machine user confirmation enum accepts ready rows without relying on prose", () => {
  const result = run(makeFixture({ header: enumHeader, row: enumRow({ confirmationStatus: "confirmed" }) }));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.issueCount, 0);
  assert.equal(parsed.target.userConfirmationStatus.status, "confirmed");
  assert.equal(parsed.target.userConfirmationStatus.source, "enum");
  assert.equal(parsed.target.mainlineRelationStatus, "todo-candidate");
  assert.equal(parsed.target.priorityStatus, "P1");
});

test("ready rows fail when enum and prose confirmation conflict", () => {
  const result = run(
    makeFixture({
      header: enumHeader,
      row: enumRow({ confirmationStatus: "needs-confirmation", userConfirmation: "user confirmed" }),
    }),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /conflicts with User Confirmation text/);
  assert.match(result.stdout, /ready entry must record user confirmation status/);
});

test("ready rows fail when required enum cells are blank on enum boards", () => {
  const result = run(makeFixture({ header: enumHeader, row: enumRow({ confirmationStatus: "" }) }));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /ready entry is missing User Confirmation Status/);
});

test("Design Key must use lowercase kebab-case", () => {
  const fixture = makeFixture({
    header: enumHeader,
    row: enumRow({ confirmationStatus: "confirmed" }).replaceAll("enum-flow-2026-05-30", "ENUM-FLOW-2026-05-30"),
  });
  const result = run({ ...fixture, id: "ENUM-FLOW-2026-05-30" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /lowercase kebab-case/);
});

test("uppercase Design Key metadata is reported as a mismatch", () => {
  const fixture = makeFixture({ header: enumHeader, row: enumRow({ confirmationStatus: "confirmed" }) });
  writeFile(
    path.join(fixture.root, "DesignWindow/docs/current/enum-flow/original-plan-2026-05-30.md"),
    designDoc("ENUM-FLOW-2026-05-30", "Original Plan"),
  );
  const result = run(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /has Design Key ENUM-FLOW-2026-05-30, expected enum-flow-2026-05-30/);
});
