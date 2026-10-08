import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { summarizeAtlasDrift } from "../../../tooling/atlas/drift.js";

function git(root: string, args: readonly string[]): string {
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
  return result.stdout.trim();
}

/** 一个桩图谱：check-atlas.mjs 打印固定报告；README 记录基线提交。 */
function fixture(t: TestContext, stale: readonly string[]): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-atlas-drift-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "src/kernel"), { recursive: true });
  writeFileSync(path.join(root, "src/kernel/a.ts"), "export const a = 1;\n");
  git(root, ["init", "--quiet"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "baseline"]);
  const baseline = git(root, ["rev-parse", "--short=8", "HEAD"]);
  mkdirSync(path.join(root, "wakeflow-architecture-atlas/scripts"), { recursive: true });
  writeFileSync(
    path.join(root, "wakeflow-architecture-atlas/README.md"),
    `# atlas\n\n**当前工作树：\`${baseline}\` 加未提交字节。**\n`,
  );
  writeFileSync(
    path.join(root, "wakeflow-architecture-atlas/scripts/check-atlas.mjs"),
    `const report = { ok: ${stale.length === 0}, documents: 3, fingerprints: 3, staleFingerprints: ${JSON.stringify(stale)}, errors: [] };\nprocess.stdout.write(JSON.stringify(report, null, 2) + "\\n");\nif (!report.ok) process.exitCode = 1;\n`,
  );
  writeFileSync(path.join(root, "src/kernel/a.ts"), "export const a = 2;\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "change"]);
  return root;
}

test("图谱漂移：按专题汇总过期指纹，并列出基线提交以来变化的源文件", (t) => {
  const root = fixture(t, [
    "maps/11-kernel/README.md",
    "maps/11-kernel/hook-history.md",
    "maps/16-observation/README.md",
  ]);
  const drift = summarizeAtlasDrift(root);
  equal(drift.kind, "WakeflowAtlasDrift");
  equal(drift.status, "failed");
  equal(drift.stale, 3);
  deepEqual(drift.byTopic, { "maps/11-kernel": 2, "maps/16-observation": 1 });
  equal(typeof drift.baselineCommit, "string");
  equal(drift.changedSourcesSinceBaseline, 1);
  deepEqual(drift.changedSample, ["src/kernel/a.ts"]);
  equal(drift.exitCode, 1);
});

test("图谱漂移：没有过期指纹按 passed；缺少检查脚本按 unavailable", (t) => {
  const clean = summarizeAtlasDrift(fixture(t, []));
  equal(clean.status, "passed");
  equal(clean.stale, 0);
  const empty = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-atlas-empty-")));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const missing = summarizeAtlasDrift(empty);
  equal(missing.status, "unavailable");
  equal(missing.reason, "atlas-check-script-missing");
});
