import { deepEqual, equal, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import {
  selectImpactedTests,
  testSourcesDependingOn,
} from "../../../tooling/testing/impacted-tests.js";

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

test("多行 named import、import type、export … from 与默认加命名导入都是静态边（W27）", (t) => {
  const root = fixture(t);
  write(
    root,
    "tests/kernel/multiline.test.ts",
    'import {\n  a,\n  // 注释行也在子句里\n} from "../../src/kernel/a.js";\nexport const m = a;\n',
  );
  write(
    root,
    "tests/kernel/type-only.test.ts",
    'import type {\n  X,\n} from "../../src/kernel/a.js";\nexport const n: X | null = null;\n',
  );
  write(
    root,
    "tests/kernel/reexport.fixture.ts",
    'export {\n  a,\n} from "../../src/kernel/a.js";\n',
  );
  write(
    root,
    "tests/kernel/reexport.test.ts",
    'import { a } from "./reexport.fixture.js";\nexport const r = a;\n',
  );
  write(
    root,
    "tests/kernel/default-and-named.test.ts",
    'import x, {\n  a,\n} from "../../src/kernel/a.js";\nexport const d = [x, a];\n',
  );
  write(
    root,
    "tests/kernel/unrelated-string.test.ts",
    'const text = "from";\nexport const u = text;\n',
  );
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "multiline"]);
  write(root, "src/kernel/a.ts", "export const a = 3;\n");
  const selection = selectImpactedTests(root);
  deepEqual(selection.tests, [
    "tests/capabilities/x/service.test.ts",
    "tests/kernel/a.test.ts",
    "tests/kernel/default-and-named.test.ts",
    "tests/kernel/multiline.test.ts",
    "tests/kernel/reexport.test.ts",
    "tests/kernel/type-only.test.ts",
  ]);
  deepEqual([...testSourcesDependingOn(root, "src/kernel/a.ts")].sort(), [
    "tests/capabilities/x/service.test.ts",
    "tests/kernel/a.test.ts",
    "tests/kernel/default-and-named.test.ts",
    "tests/kernel/multiline.test.ts",
    "tests/kernel/reexport.test.ts",
    "tests/kernel/type-only.test.ts",
  ]);
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

test("Schema、工具链输入与运行器改动建议完整门；agent 文本不再是整门理由；选择集过大也建议完整门", (t) => {
  const root = fixture(t);
  write(root, "src/contracts/schemas/x.schema.json", "{}\n");
  write(root, "assets/agent-text/README.md", "# x\n");
  write(root, "knip.json", "{}\n");
  write(root, "tooling/testing/impacted-tests.ts", "export const x = 1;\n");
  const selection = selectImpactedTests(root);
  equal(selection.fullGateRecommended, true);
  deepEqual(selection.fullGateReasons, [
    "schema-or-generated-contract",
    "test-runner",
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

test("agent 文本改动经资源边传播：读取它的模块的导入者与按路径点名它的测试入选，其余不选，不建议完整门", (t) => {
  const root = fixture(t);
  write(root, "src/hosts/codex/codex-agent-text-profile.ts", "export const profile = 1;\n");
  write(root, "tooling/artifacts/build-plugin-artifacts.ts", "export const build = 1;\n");
  write(
    root,
    "tests/artifacts/agent-text-honesty.test.ts",
    'import { profile } from "../../src/hosts/codex/codex-agent-text-profile.js";\n',
  );
  write(
    root,
    "tests/artifacts/plugin-artifacts.test.ts",
    'import { build } from "../../tooling/artifacts/build-plugin-artifacts.js";\n',
  );
  write(
    root,
    "tests/entrypoints/descriptions.test.ts",
    'const SKILL_ROOT = path.join(process.cwd(), "assets", "agent-text", "skills");\n',
  );
  write(root, "assets/agent-text/skills/wakeflow-test/SKILL.md", "# skill\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "owners"]);
  deepEqual(selectImpactedTests(root).tests, []);

  write(root, "assets/agent-text/skills/wakeflow-test/SKILL.md", "# skill v2\n");
  const selection = selectImpactedTests(root);
  deepEqual(selection.changed, ["assets/agent-text/skills/wakeflow-test/SKILL.md"]);
  deepEqual(selection.tests, [
    "tests/artifacts/agent-text-honesty.test.ts",
    "tests/artifacts/plugin-artifacts.test.ts",
    "tests/entrypoints/descriptions.test.ts",
  ]);
  deepEqual(selection.reasons, {
    "tests/artifacts/agent-text-honesty.test.ts": "assets/agent-text/skills/wakeflow-test/SKILL.md",
    "tests/artifacts/plugin-artifacts.test.ts": "assets/agent-text/skills/wakeflow-test/SKILL.md",
    "tests/entrypoints/descriptions.test.ts": "assets/agent-text/skills/wakeflow-test/SKILL.md",
  });
  equal(selection.fullGateRecommended, false);
  deepEqual(selection.fullGateReasons, []);
});

test("tooling 源也在静态图里：改动的 tooling 模块选中导入它的测试，经另一个 tooling 模块的间接导入也选中", (t) => {
  const root = fixture(t);
  write(root, "tooling/verification/files.ts", "export const files = 1;\n");
  write(
    root,
    "tooling/testing/test-recording.ts",
    'import { files } from "../verification/files.js";\nexport const recording = files;\n',
  );
  write(
    root,
    "tests/tooling/testing/test-recording.test.ts",
    'import { recording } from "../../../tooling/testing/test-recording.js";\n',
  );
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "tooling"]);
  write(root, "tooling/verification/files.ts", "export const files = 2;\n");
  const selection = selectImpactedTests(root);
  deepEqual(selection.tests, ["tests/tooling/testing/test-recording.test.ts"]);
  deepEqual(selection.reasons, {
    "tests/tooling/testing/test-recording.test.ts": "tooling/verification/files.ts",
  });
  equal(selection.fullGateRecommended, false);
});

test("testSourcesDependingOn：静态导入链到达目标的测试文件，含经夹具的间接依赖；目标不存在或无人导入时为空集", (t) => {
  const root = fixture(t);
  write(root, "tests/support/load-sensitive.ts", "export const loadSensitive = 1;\n");
  write(
    root,
    "tests/foundation/lock.test.ts",
    'import { loadSensitive } from "../support/load-sensitive.js";\n',
  );
  write(
    root,
    "tests/tooling/lab/workflow-matrix.fixture.ts",
    'import { loadSensitive } from "../../support/load-sensitive.js";\nexport const matrix = 1;\n',
  );
  write(
    root,
    "tests/tooling/lab/workflow-codex.load.test.ts",
    'import { matrix } from "./workflow-matrix.fixture.js";\n',
  );
  deepEqual([...testSourcesDependingOn(root, "tests/support/load-sensitive.ts")].sort(), [
    "tests/foundation/lock.test.ts",
    "tests/tooling/lab/workflow-codex.load.test.ts",
  ]);
  // 夹具本身不是测试文件，不在集合里；无关测试也不在。
  equal(
    testSourcesDependingOn(root, "tests/support/load-sensitive.ts").has("tests/kernel/a.test.ts"),
    false,
  );
  deepEqual([...testSourcesDependingOn(root, "tests/support/missing.ts")], []);
  deepEqual([...testSourcesDependingOn(root, "src/kernel/a.ts")].sort(), [
    "tests/capabilities/x/service.test.ts",
    "tests/kernel/a.test.ts",
  ]);
});
