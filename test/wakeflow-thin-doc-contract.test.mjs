import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("public v3 no longer installs the v2 starter-document bundle", () => {
  for (const host of ["codex-wakeflow", "claude-code-wakeflow"]) {
    const templateRoot = path.join(repositoryRoot, "plugins", host, "templates");
    assert.equal(existsSync(path.join(templateRoot, "wakeflow-template-bundle.json")), false);
    const assetBundle = JSON.parse(readFileSync(path.join(templateRoot, "wakeflow-asset-bundle.json"), "utf8"));
    const serialized = JSON.stringify(assetBundle);
    assert.doesNotMatch(serialized, /starter-workspace|workspace-current-status|wakeflow:doc-contract/u);
  }
});

test("normal runtime removes the retired subprocess dispatcher and disconnects v2 helpers", () => {
  for (const root of [
    "core",
    "plugins/codex-wakeflow",
    "plugins/claude-code-wakeflow",
  ]) {
    assert.equal(existsSync(path.join(repositoryRoot, root, "lib/wakeflow-runtime.mjs")), false);
    assert.equal(existsSync(path.join(repositoryRoot, root, "lib/wakeflow-trace.mjs")), false);
  }
  const forbidden = [
    "verify-workspace-docs.mjs",
    "wakeflow-check-layout.mjs",
    "wakeflow-storage.mjs",
    "runWakeflowRuntime",
    "buildWakeflowTrace",
  ];
  const normalSources = [
    "core/lib/wakeflow-mcp-tools.mjs",
    "core/mcp/server.cjs",
    "core/scripts/wakeflow-cli.mjs",
    "core/scripts/wakeflow-setup.mjs",
  ];
  for (const relative of normalSources) {
    const source = readFileSync(path.join(repositoryRoot, relative), "utf8");
    for (const basename of forbidden) assert.equal(source.includes(basename), false, relative);
  }
});
