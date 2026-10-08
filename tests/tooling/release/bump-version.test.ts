import { deepEqual, equal, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { planVersionBump } from "../../../tooling/release/bump-version.js";

function write(root: string, relative: string, value: unknown): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function read(root: string, relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, relative), "utf8")) as Record<string, unknown>;
}

function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-bump-version-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "assets/release/version.json", {
    kind: "WakeflowReleaseVersion",
    schemaVersion: 1,
    version: "1.1.0-rc.5",
  });
  write(root, ".claude-plugin/marketplace.json", {
    name: "fixture",
    metadata: { version: "1.0.0" },
    plugins: [
      {
        name: "wakeflow",
        source: "./plugins/claude-code-wakeflow",
        version: "1.1.0-rc.5",
        keywords: ["mcp"],
      },
    ],
  });
  write(root, "plugins/codex-wakeflow/package.json", {
    name: "@fixture/codex",
    version: "1.1.0-rc.5",
  });
  write(root, "plugins/claude-code-wakeflow/package.json", {
    name: "@fixture/claude",
    version: "1.1.0-rc.5",
  });
  return root;
}

test("版本准备：预览只列出两处版本源与待重建的生成文件，--apply 才写入，并保持其余字段不变", (t) => {
  const root = fixture(t);
  const preview = planVersionBump(root, "1.1.0-rc.6");
  equal(preview.changesApplied, false);
  deepEqual(preview.edits, [
    { path: "assets/release/version.json", from: "1.1.0-rc.5", to: "1.1.0-rc.6" },
    { path: ".claude-plugin/marketplace.json", from: "1.1.0-rc.5", to: "1.1.0-rc.6" },
  ]);
  deepEqual(
    preview.generated.map((entry) => [entry.path, entry.version]),
    [
      ["plugins/codex-wakeflow/package.json", "1.1.0-rc.5"],
      ["plugins/codex-wakeflow/.codex-plugin/plugin.json", null],
      ["plugins/claude-code-wakeflow/package.json", "1.1.0-rc.5"],
      ["plugins/claude-code-wakeflow/.claude-plugin/plugin.json", null],
    ],
  );
  equal(read(root, "assets/release/version.json").version, "1.1.0-rc.5");
  const applied = planVersionBump(root, "1.1.0-rc.6", { apply: true });
  equal(applied.changesApplied, true);
  deepEqual(read(root, "assets/release/version.json"), {
    kind: "WakeflowReleaseVersion",
    schemaVersion: 1,
    version: "1.1.0-rc.6",
  });
  const marketplace = read(root, ".claude-plugin/marketplace.json");
  deepEqual(marketplace.metadata, { version: "1.0.0" });
  deepEqual((marketplace.plugins as Record<string, unknown>[])[0], {
    name: "wakeflow",
    source: "./plugins/claude-code-wakeflow",
    version: "1.1.0-rc.6",
    keywords: ["mcp"],
  });
  equal(applied.nextSteps[0]?.includes("build:artifacts:committed"), true);
  // 生成文件不由本命令改写。
  equal(read(root, "plugins/codex-wakeflow/package.json").version, "1.1.0-rc.5");
});

test("版本准备拒绝相同版本、非发布序列和非法版本文本", (t) => {
  const root = fixture(t);
  throws(() => planVersionBump(root, "1.1.0-rc.5"), /already carries/u);
  throws(() => planVersionBump(root, "0.9.0"), /release series/u);
  throws(() => planVersionBump(root, "not-a-version"), /requested version/u);
  equal(read(root, "assets/release/version.json").version, "1.1.0-rc.5");
});
