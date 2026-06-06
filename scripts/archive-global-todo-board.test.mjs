#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const script = path.join(workspaceRoot, "scripts/archive-global-todo-board.mjs");

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "archive-global-todo-"));
  writeFile(
    path.join(root, ".workspace-active/workspace/current/global-todo-board.md"),
    `# Global TODO Board

## 全局 TODO

| ID | 状态 | 类型 | 优先级 | 归属 | 事项 / 目标 | 影响复测 / 派发 | 依赖 / 触发 | 推荐窗口 | 当前挂载 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DONE-SLASH-2026-06-04 | 已完成 / 总控验收通过 | fixture | P1 | Workspace | done with note | 否 | evidence | AlembicWorkspace | [plan](plan.md) |
| ACTIVE-2026-06-04 | 观察中 | fixture | P2 | Workspace | keep active | 否 | none | AlembicWorkspace | current |

## 已完成 TODO 和历史同步记录

已完成 TODO、旧同步记录和来源归档统一从 [workspace-record-map.md](../../../../workspace-ledger/workspace/workspace-record-map.md#todo-records) 查询。
`,
  );
  writeFile(path.join(root, ".workspace-active/workspace/current/plan.md"), "# Plan\n");
  writeFile(path.resolve(root, "../workspace-ledger/workspace/workspace-record-map.md"), "# Record Map\n");
  return root;
}

function run(root, args = []) {
  return spawnSync("node", [script, "--month", "2026-06", "--date", "2026-06-04", ...args, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

test("archives completed rows even when the displayed status has a note suffix", () => {
  const root = makeFixture();
  const result = run(root, ["--apply"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.completedRows, 1);

  const board = readFileSync(path.join(root, ".workspace-active/workspace/current/global-todo-board.md"), "utf8");
  const archive = readFileSync(
    path.resolve(root, "../workspace-ledger/workspace/archive/2026-06/global-todo/global-todo-completed-2026-06-04.md"),
    "utf8",
  );
  assert.doesNotMatch(board, /DONE-SLASH-2026-06-04/);
  assert.match(board, /ACTIVE-2026-06-04/);
  assert.match(archive, /DONE-SLASH-2026-06-04/);
});
