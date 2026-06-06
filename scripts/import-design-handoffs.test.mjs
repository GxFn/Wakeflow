#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const script = path.join(workspaceRoot, "scripts/import-design-handoffs.mjs");

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function designDoc(id, title) {
  return `# ${title}

Design Key: ${id}

## 目标

Fixture only.
`;
}

function makeFixture({ row, header }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "import-design-handoffs-"));
  const id = "ENUM-FLOW-2026-05-30";
  const designDir = path.join(root, "DesignWindow/docs/current/enum-flow");
  writeFile(path.join(designDir, "original-plan-2026-05-30.md"), designDoc(id, "Original Plan"));
  writeFile(path.join(designDir, "requirement-design-2026-05-30.md"), designDoc(id, "Requirement Design"));
  writeFile(path.join(designDir, "workspace-handoff-2026-05-30.md"), designDoc(id, "Workspace Handoff"));
  writeFile(
    path.join(root, "DesignWindow/docs/current/workspace-handoff-board.md"),
    `# Workspace Handoff Board

## Handoff 清单

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
  return spawnSync("node", [script, "--board", board, "--id", id, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

const legacyHeader = `| ID | 状态 | 标题 | 原始计划 | 需求设计 | Handoff | 用户确认 | 当前主线关系 | 建议 TODO | 优先级 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`;

const enumHeader = `| ID | 状态 | 标题 | 原始计划 | 需求设计 | Handoff | 用户确认状态 | 用户确认 | 主线关系状态 | 当前主线关系 | 建议 TODO | 优先级枚举 | 优先级 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`;

function legacyRow(userConfirmation = "用户已确认") {
  return `| ENUM-FLOW-2026-05-30 | ready-for-workspace | Enum fixture | [original](enum-flow/original-plan-2026-05-30.md) | [design](enum-flow/requirement-design-2026-05-30.md) | [handoff](enum-flow/workspace-handoff-2026-05-30.md) | ${userConfirmation} | 不影响主线 | TODO | P1 | 总控接收 |`;
}

function enumRow({ confirmationStatus, userConfirmation = "", mainlineStatus = "todo-candidate", priorityStatus = "P1" }) {
  return `| ENUM-FLOW-2026-05-30 | ready-for-workspace | Enum fixture | [original](enum-flow/original-plan-2026-05-30.md) | [design](enum-flow/requirement-design-2026-05-30.md) | [handoff](enum-flow/workspace-handoff-2026-05-30.md) | ${confirmationStatus} | ${userConfirmation} | ${mainlineStatus} | 不影响主线 | TODO | ${priorityStatus} | P1 | 总控接收 |`;
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
      row: enumRow({ confirmationStatus: "needs-confirmation", userConfirmation: "用户已确认" }),
    }),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /conflicts with 用户确认 text/);
  assert.match(result.stdout, /ready entry must record user confirmation status/);
});

test("ready rows fail when required enum cells are blank on enum boards", () => {
  const result = run(makeFixture({ header: enumHeader, row: enumRow({ confirmationStatus: "" }) }));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /ready entry is missing 用户确认状态/);
});
