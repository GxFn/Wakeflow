#!/usr/bin/env node

import assert from "node:assert/strict";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const validateScript = path.join(workspaceRoot, "scripts/wakeflow-validate.mjs");

function run(root) {
  return runSync(process.execPath, [validateScript, "--root", root], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

function parseOutput(result) {
  return JSON.parse(result.status === 0 ? result.stdout : result.stderr);
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-validate-"));
  for (const entry of [
    ".codex-plugin",
    "assets",
    "lib",
    "mcp",
    "schemas",
    "scripts",
    "skills",
    "templates",
  ]) {
    cpSync(path.join(workspaceRoot, entry), path.join(root, entry), {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`),
    });
  }
  for (const file of [
    ".mcp.json",
    "AGENTS.md",
    "LICENSE",
    "README.md",
    "README.zh-CN.md",
    "package.json",
    "workspace.config.json",
  ]) {
    cpSync(path.join(workspaceRoot, file), path.join(root, file));
  }
  return root;
}

function mutateJson(file, mutate) {
  const payload = JSON.parse(readFileSync(file, "utf8"));
  mutate(payload);
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function mutateText(file, mutate) {
  writeFileSync(file, mutate(readFileSync(file, "utf8")));
}

test("passes for the repository plugin surface", () => {
  const result = run(workspaceRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseOutput(result);
  assert.equal(payload.ok, true);
  assert.ok(payload.checked.requiredFiles > 30);
  assert.ok(payload.checked.runtimeScripts > 20);
  assert.ok(payload.checked.skills >= 3);
});

test("fails when the MCP config points at a missing server entrypoint", () => {
  const root = makeFixture();
  try {
    mutateJson(path.join(root, ".mcp.json"), (payload) => {
      payload.mcpServers.wakeflow.args = ["./mcp/missing-server.cjs"];
    });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing file: mcp\/missing-server\.cjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when the MCP config does not launch from the plugin root", () => {
  const root = makeFixture();
  try {
    mutateJson(path.join(root, ".mcp.json"), (payload) => {
      delete payload.mcpServers.wakeflow.cwd;
    });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow MCP cwd must be \./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when an MCP tool declaration is missing annotations", () => {
  const root = makeFixture();
  try {
    mutateText(path.join(root, "lib/wakeflow-mcp-tools.mjs"), (text) => {
      return text.replace('    annotations: readOnlyTool("Inspect Wakeflow Status"),\n', "");
    });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /MCP tool wakeflow_status must declare annotations/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when a runtime whitelist script is absent from the package", () => {
  const root = makeFixture();
  try {
    rmSync(path.join(root, "scripts/wakeflow-delivery.mjs"), { force: true });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing file: scripts\/wakeflow-delivery\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when a plugin skill surface is missing", () => {
  const root = makeFixture();
  try {
    rmSync(path.join(root, "skills/wakeflow-target/SKILL.md"), { force: true });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing file: skills\/wakeflow-target\/SKILL\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when package metadata is still private", () => {
  const root = makeFixture();
  try {
    mutateJson(path.join(root, "package.json"), (payload) => {
      payload.private = true;
    });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package\.json must not be private/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when plugin starter prompts exceed the Codex UI limit", () => {
  const root = makeFixture();
  try {
    mutateJson(path.join(root, ".codex-plugin/plugin.json"), (payload) => {
      payload.interface.defaultPrompt.push("Run Wakeflow control status");
    });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /defaultPrompt must contain at most 3 prompts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when project-specific names leak into reusable runtime text", () => {
  const root = makeFixture();
  try {
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/bad.md"), "# Bad\n\nAlembicWorkspace should not be a reusable default.\n");
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /project-specific token AlembicWorkspace remains in docs\/bad\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when non-English project text is introduced", () => {
  const root = makeFixture();
  try {
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/bad.md"), `# Bad\n\n${"\u4e2d\u6587\u5185\u5bb9"}\n`);
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-English Han text remains in docs\/bad\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows the localized Chinese README", () => {
  const root = makeFixture();
  try {
    writeFileSync(path.join(root, "README.zh-CN.md"), `# Wakeflow\n\n${"\u4e2d\u6587\u8bf4\u660e\uff1a\u53ef\u672c\u5730\u5316\u3002"}\n`);
    const result = run(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignores local runtime text while validating the reusable plugin package", () => {
  const root = makeFixture();
  try {
    mkdirSync(path.join(root, ".workspace-active/workspace/current"), { recursive: true });
    mkdirSync(path.join(root, ".workspace-local"), { recursive: true });
    writeFileSync(
      path.join(root, ".workspace-active/workspace/current/local.md"),
      `# Local\n\n${"\u4e2d\u6587\u8fd0\u884c\u6001"}\n`,
    );
    writeFileSync(path.join(root, ".workspace-local/local.json"), JSON.stringify({ note: "\u672c\u5730" }));
    const result = run(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
