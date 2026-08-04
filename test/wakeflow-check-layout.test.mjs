#!/usr/bin/env node

import assert from "node:assert/strict";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const wakeflowRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const checkScript = path.join(wakeflowRoot, "scripts/wakeflow-check-layout.mjs");
const nextWorkScript = path.join(wakeflowRoot, "scripts/wakeflow-next-work.mjs");
const templateBundle = JSON.parse(readFileSync(path.join(wakeflowRoot, "templates/wakeflow-template-bundle.json"), "utf8"));

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function makeStarterFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-layout-"));
  writeBundledTemplates("templates/starter-workspace/workspace/", path.join(root, ".wakeflow-active"));
  writeFile(path.join(root, "AGENTS.md"), "# Fixture Workspace\n");
  writeFile(
    path.join(root, "wakeflow.config.json"),
    JSON.stringify(
      {
        $schema: "https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json",
        schemaVersion: 2,
        workspace: {
          name: "FixtureWorkspace",
          language: "auto",
          runtimeMode: "plugin",
          root: ".",
          wakeflowRepoDir: "",
        },
        roles: { controller: "Wakeflow", design: "Design", test: "Test" },
        storage: {
          activeRoot: ".wakeflow-active",
          localRoot: ".wakeflow-local",
          ledgerRoot: "wakeflow-ledger",
        },
        repositories: [],
        hosts: {},
      },
      null,
      2,
    ),
  );
  return root;
}

function writeBundledTemplates(prefix, targetRoot) {
  for (const [relativePath, content] of Object.entries(templateBundle.files)) {
    if (!relativePath.startsWith(prefix)) continue;
    const target = path.join(targetRoot, relativePath.slice(prefix.length));
    writeFile(target, content);
  }
}

function run(script, root, args = []) {
  return runSync(process.execPath, [script, "--root", root, "--json", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("starter workspace current docs satisfy layout and next-work reader contracts", () => {
  const root = makeStarterFixture();

  const layout = run(checkScript, root);
  assert.equal(layout.status, 0, layout.stderr || layout.stdout);
  assert.deepEqual(JSON.parse(layout.stdout).issues, []);

  const nextWork = run(nextWorkScript, root, ["--source", "todo", "--after-completion"]);
  assert.equal(nextWork.status, 0, nextWork.stderr || nextWork.stdout);
  const parsed = JSON.parse(nextWork.stdout);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.candidateCount, 0);
});

test("layout check catches a TODO board that is visible but missing the script-readable section", () => {
  const root = makeStarterFixture();
  const todoPath = path.join(root, ".wakeflow-active/current/global-todo-board.md");
  writeFile(todoPath, readFileSync(todoPath, "utf8").replace(/\n## Global TODO\n/u, "\n"));

  const result = run(checkScript, root);
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.match(parsed.issues.join("\n"), /global-todo-board\.md is missing ## Global TODO/);
});

test("layout check catches starter TODO columns that next-work depends on", () => {
  const root = makeStarterFixture();
  const todoPath = path.join(root, ".wakeflow-active/current/global-todo-board.md");
  writeFile(todoPath, readFileSync(todoPath, "utf8").replace("Item / Goal", "Goal"));

  const result = run(checkScript, root);
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.match(parsed.issues.join("\n"), /global TODO table is missing required columns/);
  assert.match(parsed.issues.join("\n"), /Item \/ Goal/);
});
