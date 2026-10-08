import { equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { runToolingCli } from "../../tooling/cli.js";

function write(root: string, relative: string, text: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-cli-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, ".gitignore", ".build/\n");
  write(root, "docs/README.md", "最新节点 §13.1\n");
  write(root, "docs/progress/consolidation-gate-log.md", "### 13.1 first\n");
  write(
    root,
    "assets/release/version.json",
    `${JSON.stringify({ kind: "WakeflowReleaseVersion", schemaVersion: 1, version: "1.0.0" })}\n`,
  );
  write(
    root,
    ".claude-plugin/marketplace.json",
    `${JSON.stringify({ plugins: [{ name: "wakeflow", version: "1.0.0" }] })}\n`,
  );
  write(root, "src/a.ts", "export const a = 1;\n");
  write(root, "tests/a.test.ts", 'import { a } from "../src/a.js";\n');
  const git = (args: string[]) => {
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
  };
  git(["init", "--quiet"]);
  git(["add", "."]);
  git(["commit", "-qm", "fixture"]);
  return root;
}

test("wf 新命令的接线：impact tests、handoff --no-artifacts、release bump 预览，以及参数校验", async (t) => {
  const root = fixture(t);
  write(root, "src/a.ts", "export const a = 2;\n");
  const impact = (await runToolingCli(["impact", "tests"], root)) as unknown as {
    kind: string;
    tests: string[];
    status: string;
  };
  equal(impact.kind, "WakeflowImpactedTests");
  equal(impact.tests.join(","), "tests/a.test.ts");
  equal(impact.status, "passed");
  const handoff = (await runToolingCli(["handoff", "--no-artifacts"], root)) as unknown as {
    kind: string;
    status: string;
    exitCode: number;
  };
  equal(handoff.kind, "WakeflowHandoffCheck");
  equal(handoff.status, "passed");
  equal(handoff.exitCode, 0);
  const bump = (await runToolingCli(
    ["release", "bump", "--version", "1.0.1"],
    root,
  )) as unknown as {
    kind: string;
    changesApplied: boolean;
  };
  equal(bump.kind, "WakeflowVersionBumpPlan");
  equal(bump.changesApplied, false);
  for (const args of [
    ["impact", "files"],
    ["impact", "tests", "--files", "x"],
    ["handoff", "now"],
    ["handoff", "--no-artifacts", "x"],
    ["release", "bump"],
    ["release", "bump", "--version"],
    ["verify", "quick", "--changed", "--files", "tests/a.test.ts"],
    ["verify", "quick", "--since", "HEAD"],
    ["verify", "gate", "--changed"],
    ["locked"],
  ]) {
    await rejects(runToolingCli(args, root), /Invalid command/u, args.join(" "));
  }
});
