#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const script = path.join(workspaceRoot, "scripts/next-control-work.mjs");

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function designDoc(id, title) {
  return `# ${title}

Design Key: ${id}
`;
}

function makeFixture({ status = "空闲", designRows = "", todoRows = "" } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "next-control-work-"));
  writeFile(
    path.join(root, ".workspace-active/workspace/current/workspace-current-status.md"),
    `# Status

状态：${status}
`,
  );
  const designId = "NEXT-DESIGN-2026-06-04";
  const designDir = path.join(root, ".workspace-active/workspace/current/next-design");
  writeFile(path.join(designDir, "original-plan-2026-06-04.md"), designDoc(designId, "Original Plan"));
  writeFile(path.join(designDir, "requirement-design-2026-06-04.md"), designDoc(designId, "Requirement Design"));
  writeFile(path.join(designDir, "workspace-handoff-2026-06-04.md"), designDoc(designId, "Workspace Handoff"));
  writeFile(
    path.join(root, ".workspace-active/workspace/current/design-handoff-board.md"),
    `# Workspace Handoff Board

## Handoff 清单

| ID | 状态 | 标题 | 原始计划 | 需求设计 | Handoff | 用户确认状态 | 用户确认 | 主线关系状态 | 当前主线关系 | 建议 TODO | 优先级枚举 | 优先级 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${designRows}
`,
  );
  writeFile(
    path.join(root, ".workspace-active/workspace/current/global-todo-board.md"),
    `# Global TODO

## 全局 TODO

| ID | 状态 | 类型 | 优先级 | 归属 | 事项 / 目标 | 影响复测 / 派发 | 依赖 / 触发 | 推荐窗口 | 当前挂载 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${todoRows}
`,
  );
  return { designId, root };
}

function run(root, args = []) {
  return spawnSync("node", [script, "--json", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("after-completion fails closed when current state is not completed or idle", () => {
  const { root } = makeFixture({ status: "暂停 / 用户停止" });
  const result = run(root, ["--after-completion"]);
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.match(parsed.issues.join("\n"), /requires current state completed or idle/);
});

test("single ready Design handoff becomes auto-claimable candidate only", () => {
  const { root, designId } = makeFixture({
    designRows:
      "| NEXT-DESIGN-2026-06-04 | ready-for-workspace | Next design | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | [handoff](next-design/workspace-handoff-2026-06-04.md) | confirmed |  | next-mainline | 当前主线后接手 | GTODO-NEXT | P1 | P1 | 总控接收 |",
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
      "| OPTIONAL-HANDOFF-2026-06-04 | ready-for-workspace | Optional handoff design | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | 需求设计已包含交接信息 | confirmed |  | next-mainline | 当前主线后接手 | GTODO-NEXT | P1 | P1-runtime-reliability | 总控接收 |",
  });
  const result = run(root, ["--id", "OPTIONAL-HANDOFF-2026-06-04", "--after-completion"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.autoClaimable, true);
  assert.equal(parsed.recommended.id, "OPTIONAL-HANDOFF-2026-06-04");
  assert.equal(parsed.recommended.priority, "P1");
  assert.equal(parsed.recommended.documents.handoff.optionalMissing, true);
});

test("target id focuses next-work scan when multiple ready Design demands exist", () => {
  const { root } = makeFixture({
    designRows: [
      "| FIRST-DESIGN-2026-06-04 | ready-for-workspace | First design | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | 需求设计已包含交接信息 | confirmed |  | next-mainline | 当前主线后接手 | GTODO-FIRST | P1 | P1 | 总控接收 |",
      "| SECOND-DESIGN-2026-06-04 | ready-for-workspace | Second design | [original](next-design/original-plan-2026-06-04.md) | [design](next-design/requirement-design-2026-06-04.md) | 需求设计已包含交接信息 | confirmed |  | next-mainline | 当前主线后接手 | GTODO-SECOND | P1 | P1 | 总控接收 |",
    ].join("\n"),
  });
  const result = run(root, ["--id", "SECOND-DESIGN-2026-06-04", "--after-completion"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.candidateCount, 1);
  assert.equal(parsed.autoClaimable, true);
  assert.equal(parsed.recommended.id, "SECOND-DESIGN-2026-06-04");
});

test("TODO candidates exclude completed slash-status and Aux-owned rows", () => {
  const { root } = makeFixture({
    todoRows: [
      "| DONE-2026-06-04 | 已完成 / 总控验收通过 | fixture | P1 | Workspace | done | 否 | evidence | AlembicWorkspace | current |",
      "| AUX-2026-06-04 | Aux 已领取 / 继续推进 | fixture | P1 | AlembicWorkspace-Aux | aux | 是 | Aux | AlembicWorkspace-Aux | current |",
      "| CLAIM-2026-06-04 | 待排期 | fixture | P1 | Wakeflow | claimable | 是 | none | Wakeflow | current |",
    ].join("\n"),
  });
  const result = run(root, ["--source", "todo", "--after-completion"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.candidateCount, 1);
  assert.equal(parsed.recommended.id, "CLAIM-2026-06-04");
  assert.equal(parsed.autoClaimable, true);
});
