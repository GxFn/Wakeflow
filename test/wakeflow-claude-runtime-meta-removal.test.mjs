import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeRoot = path.join(repoRoot, "plugins/claude-code-wakeflow");
const facadeFile = path.join(claudeRoot, "scripts/lib/wakeflow-claude-host.mjs");

function read(relativePath) {
  return readFileSync(path.join(claudeRoot, relativePath), "utf8");
}

function runFacade(command, cwd) {
  return spawnSync(process.execPath, [facadeFile, command], {
    cwd,
    encoding: "utf8",
    input: "{}",
  });
}

test("M4-T11/M7A keeps every shipped runtime-meta producer and consumer retired", () => {
  const forbiddenByFile = new Map([
    ["scripts/lib/wakeflow-claude-host.mjs", [
      "runtime-meta",
      "ClaudeHostRuntimeMeta",
      "stamp-runtime",
      "plugin-version",
      "check-workspace",
    ]],
    ["commands/check.md", ["runtime-meta", "stamp-runtime", "plugin-version", "--fix"]],
    ["README.md", ["runtime-meta", "stamp-runtime"]],
    ["README.zh-CN.md", ["runtime-meta", "stamp-runtime"]],
    ["scripts/README.md", ["runtime-meta", "stamp-runtime"]],
    ["skills/wakeflow-governance/references/stage-route-map.md", ["stamp-runtime"]],
  ]);

  for (const [relativePath, forbidden] of forbiddenByFile) {
    const source = read(relativePath);
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${relativePath} must not contain ${token}`);
    }
  }
});

test("retired runtime-meta commands cannot read, rewrite, or recreate legacy bytes", (t) => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-runtime-meta-retired-"));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runtimeMetaFile = path.join(
    workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/claude-code/runtime-meta.json",
  );
  mkdirSync(path.dirname(runtimeMetaFile), { recursive: true });
  const bytes = "{malformed-runtime-meta\n";
  writeFileSync(runtimeMetaFile, bytes);

  for (const command of ["check-workspace", "stamp-runtime"]) {
    const result = runFacade(command, workspaceRoot);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.code, "wakeflow-claude-host-command");
    assert.equal(readFileSync(runtimeMetaFile, "utf8"), bytes);
  }
});

test("the Claude artifact validator rejects a reintroduced runtime-meta surface", (t) => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-runtime-meta-validator-"));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const copiedPluginRoot = path.join(workspaceRoot, "claude-plugin-copy");
  cpSync(claudeRoot, copiedPluginRoot, { recursive: true });
  const readmeFile = path.join(copiedPluginRoot, "README.md");
  writeFileSync(readmeFile, `${readFileSync(readmeFile, "utf8")}\n<!-- runtime-meta -->\n`);

  const result = spawnSync(process.execPath, [path.join(copiedPluginRoot, "scripts/wakeflow-validate.mjs")], {
    cwd: copiedPluginRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /retired runtime-meta surface/u);
});
