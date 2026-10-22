import { deepEqual, equal, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { reportChangeImpact } from "../../../tooling/impact/change-impact.js";

function git(root: string, args: readonly string[]): void {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=f",
      "-c",
      "user.email=f@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  );
  equal(result.status, 0, result.stderr);
}

function write(root: string, relative: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), text);
}

function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-change-impact-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, ".gitignore", ".build/\n");
  write(root, "src/kernel/a.ts", "export const a = 1;\n");
  write(root, "tests/kernel/a.test.ts", 'import { a } from "../../src/kernel/a.js";\n');
  git(root, ["init", "--quiet"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  return root;
}

test("变更影响：按所有权规则分类，运行时改动要求重建制品，Schema 改动要求 schema:build，顺序给出建议命令", (t) => {
  const root = fixture(t);
  deepEqual(reportChangeImpact(root).recommended, ["npm run wf -- handoff"]);
  write(root, "src/kernel/a.ts", "export const a = 2;\n");
  write(root, "src/capabilities/tasking/decide.ts", "export const d = 1;\n");
  write(root, "src/contracts/schemas/x.schema.json", "{}\n");
  write(root, "docs/notes.md", "# notes\n");
  const report = reportChangeImpact(root);
  equal(report.kind, "WakeflowChangeImpact");
  equal(report.changed, 4);
  deepEqual(report.categories.runtime, ["src/capabilities/tasking/decide.ts", "src/kernel/a.ts"]);
  deepEqual(report.categories.schemas, ["src/contracts/schemas/x.schema.json"]);
  deepEqual(report.categories.docs, ["docs/notes.md"]);
  deepEqual(report.owners, {
    "capabilities/tasking": ["src/capabilities/tasking/decide.ts"],
    contracts: ["src/contracts/schemas/x.schema.json"],
    kernel: ["src/kernel/a.ts"],
  });
  equal(report.schemaBuildRequired, true);
  equal(report.artifactsAffected, true);
  equal(report.tests.count, 1);
  equal(report.tests.fullGateRecommended, true);
  deepEqual(report.recommended, [
    "npm run schema:build",
    "npm run schema:check",
    "npm run build:artifacts:committed",
    "npm run locked -- npm test",
    "npm run smoke:artifacts",
    "check docs/README.md pointers (wf handoff covers it)",
    "npm run wf -- handoff",
  ]);
  deepEqual(report.warnings, []);
  // kernel 与 contracts 是公共形状：第 2 级（完整门）。
  equal(report.tier.level, 2);
  ok(report.tier.reasons.includes("owner contracts changed"));
  ok(report.tier.reasons.includes("owner kernel changed"));
});

test("变更影响：手改生成目录与制品给出警告；只改 tooling 与测试不触及制品；未分类路径点名", (t) => {
  const root = fixture(t);
  write(root, "plugins/codex-wakeflow/README.md", "edited\n");
  write(root, "src/contracts/generated/x.ts", "export const x = 1;\n");
  write(root, "tooling/x.ts", "export const t = 1;\n");
  write(root, "tests/kernel/b.test.ts", "// b\n");
  write(root, "mystery.txt", "?\n");
  const report = reportChangeImpact(root);
  deepEqual(report.categories["artifacts-edited"], ["plugins/codex-wakeflow/README.md"]);
  deepEqual(report.categories["generated-edited"], ["src/contracts/generated/x.ts"]);
  deepEqual(report.categories.tooling, ["tooling/x.ts"]);
  deepEqual(report.categories.unclassified, ["mystery.txt"]);
  equal(report.artifactsAffected, false);
  equal(report.schemaBuildRequired, false);
  equal(report.warnings.length, 3);
  ok(report.warnings[0]?.includes("plugins/ is generated"));
  // 手改的生成合同本身就建议完整门，所以这里是整门而不是聚焦。
  equal(report.tests.fullGateRecommended, true);
  ok(report.recommended.includes("npm run locked -- npm test"));
  equal(report.recommended.includes("npm run build:artifacts:committed"), false);
  rmSync(path.join(root, "src/contracts/generated"), { recursive: true, force: true });
  rmSync(path.join(root, "plugins"), { recursive: true, force: true });
  const focused = reportChangeImpact(root);
  equal(focused.tests.fullGateRecommended, false);
  equal(focused.tests.count, 1);
  ok(focused.recommended.includes("npm run wf -- verify quick --changed"));
  equal(focused.artifactsAffected, false);
  // 只改 tooling 与测试：第 1 级；只改文档：第 0 级；改场景链或运行器：第 2 级。
  equal(focused.tier.level, 1);
  deepEqual(reportChangeImpact(fixture(t)).tier, {
    level: 0,
    reasons: ["only docs or repository files changed"],
  });
  write(root, "tests/scenarios/chain.ts", "export const chain = 1;\n");
  const chain = reportChangeImpact(root);
  equal(chain.tier.level, 2);
  ok(chain.tier.reasons.includes("tests/scenarios/chain.ts is gate infrastructure"));
});

test("变更影响：建议命令跟着级别走——第 1 级的运行时改动重建制品、跑受影响测试与 smoke，不推整门；agent 文本是第 1 级", (t) => {
  const root = fixture(t);
  write(root, "src/capabilities/tasking/decide.ts", "export const d = 1;\n");
  write(
    root,
    "tests/capabilities/tasking/decide.test.ts",
    'import { d } from "../../../src/capabilities/tasking/decide.js";\n',
  );
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "slice"]);
  write(root, "src/capabilities/tasking/decide.ts", "export const d = 2;\n");
  const runtime = reportChangeImpact(root);
  deepEqual(runtime.tier, { level: 1, reasons: ["runtime changed"] });
  equal(runtime.artifactsAffected, true);
  equal(runtime.tests.count, 1);
  equal(runtime.tests.fullGateRecommended, false);
  deepEqual(runtime.recommended, [
    "npm run build:artifacts:committed",
    "npm run wf -- verify quick --changed",
    "npm run smoke:artifacts",
    "npm run wf -- handoff",
  ]);

  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "runtime"]);
  write(root, "assets/agent-text/skills/x/SKILL.md", "# x\n");
  const text = reportChangeImpact(root);
  deepEqual(text.tier, { level: 1, reasons: ["agent-text changed"] });
  equal(text.tests.fullGateRecommended, false);
  deepEqual(text.recommended, [
    "npm run build:artifacts:committed",
    "npm run smoke:artifacts",
    "npm run wf -- handoff",
  ]);
});
