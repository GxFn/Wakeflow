import { deepEqual, equal, ok } from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import {
  CHAIN_BUDGET_MS,
  LOAD_FILE_BUDGET_MS,
  reportTestLevels,
  TEST_LEVEL_BUDGETS_MS,
  TEST_LEVEL_NAMES,
} from "../../../tooling/testing/test-levels.js";

/**
 * `wf test levels`（§13.206 D6）：按测试开发标准 §2 从静态事实归级，对照预算、标签与 `.load` 后缀报偏差。
 * 夹具树覆盖每一级与每一种偏差；真实仓库只断言不变量，不钉当前清单。
 */

function write(root: string, relative: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), text);
}

function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-test-levels-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "tests/support/load-sensitive.ts", "export const loadSensitive = () => false;\n");
  write(
    root,
    "tests/foundation/data/json.test.ts",
    'import { test } from "node:test";\ntest("a", () => {});\n',
  );
  write(
    root,
    "tests/kernel/store.test.ts",
    '/** header */\nimport { mkdtempSync } from "node:fs";\nimport { test } from "node:test";\ntest("b", () => {});\n',
  );
  write(
    root,
    "tests/capabilities/x/service.test.ts",
    'import { test } from "node:test";\nimport { f } from "./service.fixture.js";\ntest("c", () => {});\ntest("d", () => {});\n',
  );
  write(root, "tests/capabilities/x/service.fixture.ts", "export const f = 1;\n");
  write(
    root,
    "tests/capabilities/x/decide.test.ts",
    'import { test } from "node:test";\ntest("e", () => {});\n',
  );
  write(
    root,
    "tests/entrypoints/tool.test.ts",
    'import { test } from "node:test";\ntest("f", () => {});\n',
  );
  write(
    root,
    "tests/scenarios/chain.test.ts",
    'import { test } from "node:test";\ntest("g", () => {});\n',
  );
  write(
    root,
    "tests/tooling/cli.test.ts",
    'import { test } from "node:test";\ntest("h", () => {});\n',
  );
  write(
    root,
    "tests/artifacts/plugin.test.ts",
    'import { test } from "node:test";\ntest("i", () => {});\n',
  );
  write(
    root,
    "tests/foundation/filesystem/lock.test.ts",
    'import { mkdtempSync } from "node:fs";\nimport { test } from "node:test";\nimport { loadSensitive } from "../../support/load-sensitive.js";\ntest("j", (t) => { loadSensitive(t, "x"); });\ntest("k", () => {});\n',
  );
  write(
    root,
    "tests/tooling/lab/matrix.load.test.ts",
    'import { test } from "node:test";\nimport { loadSensitive } from "../../support/load-sensitive.js";\ntest("l", (t) => { loadSensitive(t, "y"); });\n',
  );
  write(
    root,
    "tests/kernel/wrong.load.test.ts",
    'import { test } from "node:test";\ntest("m", () => {});\n',
  );
  write(
    root,
    "tests/hosts/claude-code/asset.test.ts",
    'import { spawnSync } from "node:child_process";\nimport { test } from "node:test";\nimport { loadSensitive } from "../../support/load-sensitive.js";\ntest("n", (t) => { loadSensitive(t, "z"); });\n',
  );
  write(
    root,
    "tooling/testing/test-durations.json",
    JSON.stringify({
      durationsMs: {
        "tests/foundation/data/json.test.ts": 5,
        "tests/kernel/store.test.ts": 25_000,
        "tests/capabilities/x/service.test.ts": 100_000,
        "tests/scenarios/chain.test.ts": 500_000,
        "tests/tooling/lab/matrix.load.test.ts": 400_000,
        "tests/kernel/wrong.load.test.ts": 1,
      },
    }),
  );
  return root;
}

test("测试级别报告：按目录与静态事实归级，预算按级别、链与 .load 文件分别取", (t) => {
  const report = reportTestLevels(fixture(t));
  equal(report.kind, "WakeflowTestLevels");
  const levelOf = (file: string) => report.files.find((record) => record.file === file)?.level;
  equal(levelOf("tests/foundation/data/json.test.ts"), 0);
  equal(levelOf("tests/capabilities/x/decide.test.ts"), 0);
  equal(levelOf("tests/kernel/store.test.ts"), 1);
  equal(levelOf("tests/foundation/filesystem/lock.test.ts"), 1);
  equal(levelOf("tests/capabilities/x/service.test.ts"), 2);
  equal(levelOf("tests/hosts/claude-code/asset.test.ts"), 2);
  equal(levelOf("tests/entrypoints/tool.test.ts"), 3);
  equal(levelOf("tests/scenarios/chain.test.ts"), 3);
  equal(levelOf("tests/tooling/cli.test.ts"), 4);
  equal(levelOf("tests/artifacts/plugin.test.ts"), 5);
  deepEqual(
    report.levels.map((level) => [level.name, level.files]),
    [
      // wrong.load.test.ts 没有任何文件系统或子进程事实，所以是 0 级——后缀不改变级别，只触发后缀不一致。
      [TEST_LEVEL_NAMES[0], 3],
      [TEST_LEVEL_NAMES[1], 2],
      [TEST_LEVEL_NAMES[2], 2],
      [TEST_LEVEL_NAMES[3], 2],
      [TEST_LEVEL_NAMES[4], 2],
      [TEST_LEVEL_NAMES[5], 1],
    ],
  );
  const budgetOf = (file: string) => report.files.find((record) => record.file === file)?.budgetMs;
  equal(budgetOf("tests/scenarios/chain.test.ts"), CHAIN_BUDGET_MS);
  equal(budgetOf("tests/tooling/lab/matrix.load.test.ts"), LOAD_FILE_BUDGET_MS);
  equal(budgetOf("tests/capabilities/x/service.test.ts"), TEST_LEVEL_BUDGETS_MS[2]);
  // 超预算：组件 25 秒 > 20 秒，能力 100 秒 > 90 秒，.load 400 秒 > 360 秒；链 500 秒在 600 秒之内。
  deepEqual(
    report.overBudget.map((entry) => entry.file),
    [
      "tests/capabilities/x/service.test.ts",
      "tests/kernel/store.test.ts",
      "tests/tooling/lab/matrix.load.test.ts",
    ],
  );
});

test("测试级别报告：混合文件、.load 后缀与标签的不一致、缺头注释与未计时文件", (t) => {
  const report = reportTestLevels(fixture(t));
  deepEqual(report.mixed, [
    { file: "tests/foundation/filesystem/lock.test.ts", tagged: 1, testCalls: 2 },
  ]);
  deepEqual(report.suffixProblems, [
    { file: "tests/hosts/claude-code/asset.test.ts", problem: "fully-tagged-without-load-suffix" },
    { file: "tests/kernel/wrong.load.test.ts", problem: "load-suffix-without-tag" },
  ]);
  // 只有 store.test.ts 有文件头注释。
  equal(report.missingHeader.count, report.files.length - 1);
  ok(report.missingHeader.sample.includes("tests/artifacts/plugin.test.ts"));
  deepEqual(report.untimed, [
    "tests/artifacts/plugin.test.ts",
    "tests/capabilities/x/decide.test.ts",
    "tests/entrypoints/tool.test.ts",
    "tests/foundation/filesystem/lock.test.ts",
    "tests/hosts/claude-code/asset.test.ts",
    "tests/tooling/cli.test.ts",
  ]);
  const matrix = report.files.find(
    (record) => record.file === "tests/tooling/lab/matrix.load.test.ts",
  );
  equal(matrix?.loadSensitive, true);
  equal(matrix?.header, false);
});

test("真实仓库：每个测试文件都有级别，场景链是 3 级链，.load 文件都在负载标签的导入闭包里，没有后缀不一致", () => {
  const report = reportTestLevels(process.cwd());
  ok(report.files.length > 300);
  for (const record of report.files) ok([0, 1, 2, 3, 4, 5].includes(record.level), record.file);
  for (const chain of report.files.filter((record) => record.file.startsWith("tests/scenarios/"))) {
    equal(chain.level, 3);
    equal(chain.chain, true);
    equal(chain.budgetMs, CHAIN_BUDGET_MS);
  }
  for (const record of report.files.filter((record) => record.loadSuffix)) {
    equal(record.loadSensitive, true, record.file);
  }
  deepEqual(report.suffixProblems, []);
  equal(
    report.levels.reduce((sum, level) => sum + level.files, 0),
    report.files.length,
  );
});
