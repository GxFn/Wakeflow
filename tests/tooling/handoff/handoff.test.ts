import { deepEqual, equal, match, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { checkHandoff } from "../../../tooling/handoff/handoff.js";

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
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-handoff-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, ".gitignore", ".build/\nnode_modules/\n");
  write(
    root,
    "package.json",
    `${JSON.stringify({ name: "handoff-fixture", version: "0.0.0", private: true, type: "module", scripts: { "build:check": "node check.mjs" } })}\n`,
  );
  write(root, "check.mjs", "process.exit(process.env.HANDOFF_FIXTURE_FAIL === '1' ? 1 : 0);\n");
  write(
    root,
    "docs/README.md",
    "| gate-log | active，最新节点 §13.1 | reviews/first.md | references/tools.md |\n",
  );
  write(root, "docs/progress/consolidation-gate-log.md", "### 13.1 first\n\nbody\n");
  write(root, "docs/reviews/first.md", "# first\n");
  write(root, "docs/references/tools.md", "# tools\n");
  write(root, "src/a.ts", "export const a = 1;\n");
  write(root, "tests/a.test.ts", "// synthetic\n");
  git(root, ["init", "--quiet"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  return root;
}

function check(report: Awaited<ReturnType<typeof checkHandoff>>, name: string) {
  const found = report.checks.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`missing check ${name}`);
  return found;
}

test("干净的检出：五项检查通过，不运行 build:check 时该项为 unavailable 但整体仍通过", async (t) => {
  const root = fixture(t);
  const report = await checkHandoff(root, { artifacts: false });
  equal(report.status, "passed");
  equal(report.exitCode, 0);
  deepEqual(
    report.checks.map((entry) => [entry.name, entry.status]),
    [
      ["whitespace", "passed"],
      ["private-content", "passed"],
      ["artifacts", "unavailable"],
      ["docs-pointers", "passed"],
      ["git", "passed"],
    ],
  );
  match(check(report, "git").details.join("\n"), /modified, 0 untracked/u);
});

test("空白错误、本机路径、凭证样式、未索引文档与指针漂移各自点名；测试里的凭证只作 review", async (t) => {
  const root = fixture(t);
  const user = os.userInfo().username;
  write(root, "src/a.ts", "export const a = 1; \n");
  write(
    root,
    "notes.md",
    `see /Users/${user}/Documents/private\nAPI_KEY=abcdefghijklmnop12345678\n`,
  );
  write(
    root,
    "tests/b.test.ts",
    "const token = 'abcdefghijklmnop12345678';\nTOKEN=abcdefghijklmnop12345678\n",
  );
  write(root, "tests/c.test.ts", "const home = '/Users/someone/Workspace';\n");
  write(
    root,
    "notes-temp.md",
    "logs under /var/folders/xx/y\ntoken = process.env[TOKEN_VARIABLE]\n",
  );
  write(root, "docs/reviews/second.md", "# second\n");
  write(
    root,
    "docs/progress/consolidation-gate-log.md",
    "### 13.1 first\n\nbody\n\n### 13.2 second\n\nbody\n",
  );
  const report = await checkHandoff(root, { artifacts: false });
  equal(report.status, "failed");
  equal(report.exitCode, 1);
  const whitespace = check(report, "whitespace");
  equal(whitespace.status, "failed");
  match(whitespace.details.join("\n"), /src\/a\.ts:1: trailing whitespace/u);
  const privateContent = check(report, "private-content");
  equal(privateContent.status, "failed");
  deepEqual(privateContent.details, [
    "notes.md:1: machine-path",
    "notes.md:2: credential-assignment",
    "review notes-temp.md:1: temporary-path",
    "review tests/b.test.ts:1: credential-assignment",
    "review tests/b.test.ts:2: credential-assignment",
  ]);
  const docs = check(report, "docs-pointers");
  equal(docs.status, "failed");
  deepEqual(docs.details, [
    "docs/README.md points at §13.1 but the gate log ends at §13.2",
    "docs/reviews/second.md is not indexed in docs/README.md",
  ]);
});

test("build:check 在构建锁下真实运行：失败的脚本让制品项失败，日志留在 .build/handoff 下", async (t) => {
  const root = fixture(t);
  const passed = await checkHandoff(root, { artifacts: true });
  equal(check(passed, "artifacts").status, "passed");
  match(check(passed, "artifacts").details.join("\n"), /logs under \.build\/handoff\/run-/u);
  process.env.HANDOFF_FIXTURE_FAIL = "1";
  try {
    const failed = await checkHandoff(root, { artifacts: true });
    equal(check(failed, "artifacts").status, "failed");
    equal(failed.status, "failed");
  } finally {
    delete process.env.HANDOFF_FIXTURE_FAIL;
  }
  ok(check(passed, "git").details.some((line) => line.startsWith("branch ")));
});
