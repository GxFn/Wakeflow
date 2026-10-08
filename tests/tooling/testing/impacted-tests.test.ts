import { deepEqual, equal, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { selectImpactedTests } from "../../../tooling/testing/impacted-tests.js";

function git(root: string, args: readonly string[]): void {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=Wakeflow fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  );
  equal(result.status, 0, result.stderr);
}

function write(root: string, relative: string, text: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-impacted-tests-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, ".gitignore", ".build/\n");
  write(root, "src/kernel/a.ts", "export const a = 1;\n");
  write(
    root,
    "src/capabilities/x/service.ts",
    'import { a } from "../../kernel/a.js";\nexport const s = a;\n',
  );
  write(root, "src/capabilities/y/service.ts", "export const y = 2;\n");
  write(root, "tests/kernel/a.test.ts", 'import { a } from "../../src/kernel/a.js";\n');
  write(
    root,
    "tests/capabilities/x/service.fixture.ts",
    'import { s } from "../../../src/capabilities/x/service.js";\nexport const f = s;\n',
  );
  write(
    root,
    "tests/capabilities/x/service.test.ts",
    'import { f } from "./service.fixture.js";\n',
  );
  write(
    root,
    "tests/capabilities/y/service.test.ts",
    'import { y } from "../../../src/capabilities/y/service.js";\n',
  );
  git(root, ["init", "--quiet"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  return root;
}

test("受影响测试沿静态导入反向传播：直接与经由夹具的间接依赖都选中，无关测试不选", (t) => {
  const root = fixture(t);
  deepEqual(selectImpactedTests(root).tests, []);
  write(root, "src/kernel/a.ts", "export const a = 2;\n");
  const selection = selectImpactedTests(root);
  deepEqual(selection.changed, ["src/kernel/a.ts"]);
  deepEqual(selection.tests, ["tests/capabilities/x/service.test.ts", "tests/kernel/a.test.ts"]);
  deepEqual(selection.reasons, {
    "tests/capabilities/x/service.test.ts": "src/kernel/a.ts",
    "tests/kernel/a.test.ts": "src/kernel/a.ts",
  });
  equal(selection.fullGateRecommended, false);
  equal(selection.since, "HEAD");
});

test("改动的夹具只影响它的消费者；新增的未跟踪测试本身入选；提交后按 --since 仍能回看", (t) => {
  const root = fixture(t);
  write(
    root,
    "tests/capabilities/x/service.fixture.ts",
    'import { s } from "../../../src/capabilities/x/service.js";\nexport const f = s + 1;\n',
  );
  deepEqual(selectImpactedTests(root).tests, ["tests/capabilities/x/service.test.ts"]);
  write(root, "tests/new/c.test.ts", "// new\n");
  deepEqual(selectImpactedTests(root).tests, [
    "tests/capabilities/x/service.test.ts",
    "tests/new/c.test.ts",
  ]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "change"]);
  deepEqual(selectImpactedTests(root).tests, []);
  const since = selectImpactedTests(root, { since: "HEAD~1" });
  deepEqual(since.tests, ["tests/capabilities/x/service.test.ts", "tests/new/c.test.ts"]);
  equal(since.since, "HEAD~1");
  throws(() => selectImpactedTests(root, { since: "--output=x" }), /one Git revision/u);
});

test("Schema、agent 文本、工具链输入与运行器改动建议完整门；选择集过大也建议完整门", (t) => {
  const root = fixture(t);
  write(root, "src/contracts/schemas/x.schema.json", "{}\n");
  write(root, "assets/agent-text/README.md", "# x\n");
  write(root, "knip.json", "{}\n");
  const selection = selectImpactedTests(root);
  equal(selection.fullGateRecommended, true);
  deepEqual(selection.fullGateReasons, [
    "agent-text",
    "schema-or-generated-contract",
    "toolchain-input",
  ]);
  for (let index = 0; index < 90; index += 1) {
    write(
      root,
      `tests/many/t${String(index).padStart(3, "0")}.test.ts`,
      'import { a } from "../../src/kernel/a.js";\n',
    );
  }
  write(root, "src/kernel/a.ts", "export const a = 3;\n");
  const large = selectImpactedTests(root);
  equal(large.tests.length, 92);
  equal(large.fullGateReasons.includes("selection-too-large"), true);
});
