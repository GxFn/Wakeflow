import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";

const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../tools/sync-core.mjs");

const commonHostFiles = [
  ".mcp.json",
  "README.md",
  "README.zh-CN.md",
  "package.json",
  "scripts/README.md",
  "scripts/lib/wakeflow-host-profile.mjs",
  "scripts/lib/wakeflow-host-artifact-checks.mjs",
  "scripts/lib/wakeflow-host-send-adapter.mjs",
  "skills/wakeflow-controller/SKILL.md",
  "skills/wakeflow-target/SKILL.md",
  "skills/wakeflow-governance/SKILL.md",
  "templates/wakeflow-template-bundle.json",
];

function write(file, content = "") {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-sync-core-"));
  write(path.join(root, "core/scripts/shared.mjs"), "export const current = true;\n");
  for (const [target, manifest, memory] of [
    ["plugins/codex-wakeflow", ".codex-plugin/plugin.json", "AGENTS.md"],
    ["plugins/claude-code-wakeflow", ".claude-plugin/plugin.json", "CLAUDE.md"],
  ]) {
    const targetRoot = path.join(root, target);
    for (const relative of [...commonHostFiles, manifest, memory]) write(path.join(targetRoot, relative), "{}\n");
    write(path.join(targetRoot, "scripts/shared.mjs"), "export const current = true;\n");
    write(path.join(targetRoot, "scripts/obsolete.mjs"), "stale\n");
    write(path.join(targetRoot, "host-only.txt"), "preserve\n");
    write(path.join(targetRoot, "scripts/wakeflow-core-manifest.json"), JSON.stringify({
      schemaVersion: 1,
      source: "core",
      files: ["scripts/obsolete.mjs", "scripts/shared.mjs"],
    }));
  }
  return root;
}

function run(root, extra = []) {
  return runSync(process.execPath, [script, "--repo-root", root, ...extra], {
    cwd: root,
    encoding: "utf8",
  });
}

test("sync-core detects and removes only stale core-managed files", () => {
  const root = makeFixture();
  const before = run(root, ["--check"]);
  assert.notEqual(before.status, 0);
  assert.match(before.stderr, /scripts\/obsolete\.mjs is a stale core-managed file/);

  const sync = run(root);
  assert.equal(sync.status, 0, sync.stderr || sync.stdout);
  for (const target of ["plugins/codex-wakeflow", "plugins/claude-code-wakeflow"]) {
    assert.equal(existsSync(path.join(root, target, "scripts/obsolete.mjs")), false);
    assert.equal(readFileSync(path.join(root, target, "host-only.txt"), "utf8"), "preserve\n");
    const manifest = JSON.parse(readFileSync(path.join(root, target, "scripts/wakeflow-core-manifest.json"), "utf8"));
    assert.deepEqual(manifest.files, ["scripts/shared.mjs"]);
  }

  const after = run(root, ["--check"]);
  assert.equal(after.status, 0, after.stderr || after.stdout);
});
