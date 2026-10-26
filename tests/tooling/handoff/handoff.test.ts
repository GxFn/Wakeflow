import { deepEqual, equal, match, ok } from "node:assert/strict";
import os from "node:os";
import { type TestContext, test } from "node:test";
import { checkHandoff } from "../../../tooling/handoff/handoff.js";
import { runGit } from "../../support/git-fixture.js";
import { disposableRoot } from "../../support/temp-root.js";
import { writeTextFile } from "../../support/write-tree.js";

/**
 * `wf handoff`（第 4 级，维护者工具）：只读交接检查单的八项判定与整体状态，夹具是一次性 Git
 * 检出，`build:check` 由夹具脚本充当。整体状态的规则——显式 `--no-artifacts` 跳过的 build:check
 * 不计入，必需检查没能执行即 unavailable（退出码 2）——见 open-items W26。
 */

function git(root: string, args: readonly string[]): void {
  runGit(root, ...args);
}

const write = writeTextFile;

function fixture(t: TestContext): string {
  const root = disposableRoot(t, "wakeflow-handoff-");
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

test("干净的检出：八项检查通过，不运行 build:check 时该项为 unavailable 但整体仍通过", async (t) => {
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
      ["version-bytes", "passed"],
      ["docs-pointers", "passed"],
      ["test-durations", "passed"],
      ["instructions-parity", "passed"],
      ["git", "passed"],
    ],
  );
  deepEqual(check(report, "version-bytes").details, [
    "no assets/release/version.json; nothing to compare",
  ]);
  deepEqual(check(report, "test-durations").details, ["no tooling/testing/test-durations.json"]);
  deepEqual(check(report, "instructions-parity").details, ["no instruction files"]);
  match(check(report, "git").details.join("\n"), /modified, 0 untracked/u);
});

test("过期标记点名：脚手架占位、README 的（待填）按失败；最后一节写未提交而树里只有 docs 改动按 review", async (t) => {
  const root = fixture(t);
  write(
    root,
    "docs/progress/consolidation-gate-log.md",
    "### 13.1 first\n\nbody\n\n### 13.2 second（2026-10-09）\n\n<!-- §13.2 验证待填 -->\n\n本批未提交。\n",
  );
  write(
    root,
    "docs/README.md",
    "| gate-log | active，最新节点 §13.2（2026-10-09）；second（待填） | reviews/first.md | references/tools.md |\n",
  );
  const report = await checkHandoff(root, { artifacts: false });
  const docs = check(report, "docs-pointers");
  equal(docs.status, "failed");
  deepEqual(docs.details, [
    "gate log §13.2 still carries the scaffold placeholder 验证待填",
    "docs/README.md still says （待填）",
    "review §13.2 says 未提交 but only docs/ differ from HEAD; update it if the batch is committed",
  ]);
  // 树里有 docs 之外的改动时，"未提交"是当下的事实，不点名。
  write(root, "src/a.ts", "export const a = 2;\n");
  write(
    root,
    "docs/README.md",
    "| gate-log | active，最新节点 §13.2（2026-10-09）；second | reviews/first.md | references/tools.md |\n",
  );
  write(
    root,
    "docs/progress/consolidation-gate-log.md",
    "### 13.1 first\n\nbody\n\n### 13.2 second（2026-10-09）\n\n本批未提交。\n",
  );
  const current = await checkHandoff(root, { artifacts: false });
  equal(check(current, "docs-pointers").status, "passed");
  deepEqual(check(current, "docs-pointers").details, []);
});

test("耗时表覆盖按 review 点名缺口与消失的文件；指令文件除标题与 Host Boundary 一节外必须逐节相同", async (t) => {
  const root = fixture(t);
  write(
    root,
    "tooling/testing/test-durations.json",
    `${JSON.stringify({ durationsMs: { "tests/a.test.ts": 12, "tests/gone.test.ts": 3 } })}\n`,
  );
  write(root, "tests/new.test.ts", "// synthetic\n");
  const shared = "intro line\n\n## Scope\n\n- rule one\n\n";
  write(
    root,
    "CLAUDE.md",
    `# Instructions For Claude Code\n${shared}## Claude Code Host Boundary\n\n- tmux is an adapter\n\n## Handoff\n\n- summarize\n`,
  );
  write(
    root,
    "AGENTS.md",
    `# Instructions\n${shared}## Host Boundary\n\n- threads are an adapter\n\n## Handoff\n\n- summarize\n`,
  );
  const report = await checkHandoff(root, { artifacts: false });
  equal(report.status, "passed");
  deepEqual(check(report, "test-durations").details, [
    "review tests/new.test.ts has no measured duration (run wf timings apply after a full gate)",
    "review tests/gone.test.ts is in tooling/testing/test-durations.json but no longer exists",
  ]);
  deepEqual(check(report, "instructions-parity").details, []);
  write(
    root,
    "AGENTS.md",
    `# Instructions\n${shared}## Host Boundary\n\n- threads are an adapter\n\n## Handoff\n\n- summarize differently\n`,
  );
  const drifted = await checkHandoff(root, { artifacts: false });
  equal(drifted.status, "failed");
  deepEqual(check(drifted, "instructions-parity").details, [
    'section "Handoff" differs between CLAUDE.md and AGENTS.md',
  ]);
  write(root, "AGENTS.md", `# Instructions\n${shared}## Handoff\n\n- summarize\n\n## Extra\n\nx\n`);
  match(
    check(await checkHandoff(root, { artifacts: false }), "instructions-parity").details.join("\n"),
    /section headings differ/u,
  );
  write(root, "tooling/testing/test-durations.json", "{}\n");
  equal(
    check(await checkHandoff(root, { artifacts: false }), "test-durations").status,
    "unavailable",
  );
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

test("必需的 build:check 没能执行（等锁前已取消、构建锁一直被占用）时该项 unavailable 并让整体 unavailable、退出码 2；只有显式 --no-artifacts 才不计入", async (t) => {
  const root = fixture(t);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await checkHandoff(root, { artifacts: true, signal: controller.signal });
  equal(cancelled.status, "unavailable");
  equal(cancelled.exitCode, 2);
  deepEqual(check(cancelled, "artifacts"), {
    name: "artifacts",
    status: "unavailable",
    details: [
      "build:check did not run (build-lock-aborted); the handoff is unavailable until it runs",
    ],
  });
  // 另一条活着的进程持有夹具的构建锁：等待预算为零时立即报 busy，同样不能当作通过。
  write(
    root,
    ".build/locks/build.lock/owner.json",
    `${JSON.stringify({ pid: process.pid, token: "fixture-holder", command: "fixture" })}\n`,
  );
  const timeout = process.env.WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS;
  process.env.WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS = "0";
  try {
    const busy = await checkHandoff(root, { artifacts: true });
    equal(busy.status, "unavailable");
    equal(busy.exitCode, 2);
    match(check(busy, "artifacts").details.join("\n"), /did not run \(build-lock-busy\)/u);
  } finally {
    if (timeout === undefined) delete process.env.WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS;
    else process.env.WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS = timeout;
  }
  const skipped = await checkHandoff(root, { artifacts: false });
  equal(skipped.status, "passed");
  equal(skipped.exitCode, 0);
  match(check(skipped, "artifacts").details.join("\n"), /skipped on request \(--no-artifacts\)/u);
});

test("version-bytes（ADR-0021）：当前版本的 tag 存在时比较两份制品清单的文件摘要，同版本改字节必须先 bump；没有 tag 只记录未比较", async (t) => {
  const root = fixture(t);
  const manifest = (sha: string) =>
    `${JSON.stringify({ kind: "WakeflowPluginArtifactManifest", version: "1.2.3", files: [{ path: "lib/a.js", sha256: sha }] })}\n`;
  const versionInput = (version: string) =>
    `${JSON.stringify({ kind: "WakeflowReleaseVersion", schemaVersion: 1, version })}\n`;
  write(root, "assets/release/version.json", versionInput("1.2.3"));
  write(
    root,
    "plugins/codex-wakeflow/artifact-manifest.json",
    manifest(`sha256:${"a".repeat(64)}`),
  );
  write(
    root,
    "plugins/claude-code-wakeflow/artifact-manifest.json",
    manifest(`sha256:${"b".repeat(64)}`),
  );
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "release bytes"]);
  const untagged = check(await checkHandoff(root, { artifacts: false }), "version-bytes");
  equal(untagged.status, "passed");
  match(untagged.details.join("\n"), /tag v1\.2\.3 is absent locally/u);

  git(root, ["tag", "v1.2.3"]);
  deepEqual(check(await checkHandoff(root, { artifacts: false }), "version-bytes"), {
    name: "version-bytes",
    status: "passed",
    details: ["artifact bytes match v1.2.3"],
  });

  // 同一版本号下改了一个文件的字节：失败并点名清单、文件与要做的 bump。
  write(
    root,
    "plugins/codex-wakeflow/artifact-manifest.json",
    manifest(`sha256:${"c".repeat(64)}`),
  );
  const changed = check(await checkHandoff(root, { artifacts: false }), "version-bytes");
  equal(changed.status, "failed");
  match(
    changed.details.join("\n"),
    /plugins\/codex-wakeflow\/artifact-manifest\.json: 1 file\(s\) differ from v1\.2\.3 \(lib\/a\.js\); bump assets\/release\/version\.json/u,
  );

  // bump 之后当前版本没有 tag：回到"未比较"，新字节可以继续提交。
  write(root, "assets/release/version.json", versionInput("1.2.4"));
  equal(check(await checkHandoff(root, { artifacts: false }), "version-bytes").status, "passed");
});
