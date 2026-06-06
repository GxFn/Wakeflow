#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const checkScript = path.join(workspaceRoot, "scripts/check-repository-residue.mjs");

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "repository-residue-"));
  writeFile(
    path.join(root, "workspace.config.json"),
    JSON.stringify(
      {
        repositories: [
          { windowName: "AppWindow", path: "../App", role: "App" },
          { windowName: "PluginWindow", path: "../Plugin", role: "Plugin" },
          { windowName: "RealProject", path: "../RealProject", role: "Real project" },
        ],
      },
      null,
      2
    )
  );

  const parent = path.dirname(root);
  writeFile(path.join(parent, "App/.asd/logs/combined.log"), "");
  writeFile(path.join(parent, "App/.cursor/skills/demo/SKILL.md"), "# Demo");
  writeFile(path.join(parent, "Plugin/.agents/plugins/marketplace.json"), "{}");
  writeFile(path.join(parent, "RealProject/.agents/skills/demo/SKILL.md"), "# Demo");
  writeFile(path.join(parent, "RealProject/.agents/.DS_Store"), "noise");
  return root;
}

function run(root, extraArgs = []) {
  return spawnSync("node", [checkScript, "--root", root, "--json", ...extraArgs], {
    encoding: "utf8",
  });
}

test("detects source repository runtime residue without flagging marketplace metadata", () => {
  const root = makeFixture();
  const result = run(root);
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.deepEqual(
    parsed.residue.map((entry) => `${entry.windowName}:${entry.relPath}`).sort(),
    [
      "AppWindow:.asd",
      "AppWindow:.cursor/skills",
      "RealProject:.agents/.DS_Store",
      "RealProject:.agents/skills",
    ]
  );
});

test("--fix removes untracked residue and empty parents", () => {
  const root = makeFixture();
  const parent = path.dirname(root);
  const result = run(root, ["--fix"]);
  assert.equal(result.status, 0, result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.fixed.length, 6);
  assert.equal(existsSync(path.join(parent, "App/.asd")), false);
  assert.equal(existsSync(path.join(parent, "App/.cursor")), false);
  assert.equal(existsSync(path.join(parent, "RealProject/.agents")), false);
  assert.equal(existsSync(path.join(parent, "Plugin/.agents/plugins/marketplace.json")), true);
});
