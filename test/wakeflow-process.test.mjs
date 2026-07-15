#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  execFileText,
  prepareWakeflowCommand,
  runSync,
} from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";

test("wakeflow process boundary normalizes node to the current runtime", () => {
  const prepared = prepareWakeflowCommand("node", ["--version"]);
  assert.equal(prepared.kind, "node");
  assert.equal(prepared.command, process.execPath);
});

test("wakeflow process boundary allows fixed node and git commands", () => {
  const nodeResult = runSync(process.execPath, ["--version"], { encoding: "utf8" });
  assert.equal(nodeResult.status, 0, nodeResult.stderr || nodeResult.stdout);
  assert.match(nodeResult.stdout, /^v\d+/);

  const gitVersion = execFileText("git", ["--version"], { encoding: "utf8" });
  assert.match(gitVersion, /^git version /);
});

test("wakeflow process boundary allows only the bundled argument-free MCP launcher", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wakeflow-process-launcher-"));
  try {
    const launcher = path.join(root, "bin", "wakeflow-mcp");
    const prepared = prepareWakeflowCommand(launcher, [], { cwd: root });
    assert.equal(prepared.kind, "wakeflow-mcp");
    assert.equal(prepared.command, launcher);
    assert.deepEqual(prepared.args, []);

    assert.throws(
      () => prepareWakeflowCommand(launcher, ["--unexpected"], { cwd: root }),
      /Unsupported Wakeflow MCP launcher arguments/,
    );
    assert.throws(
      () => prepareWakeflowCommand(path.join(root, "other", "wakeflow-mcp"), [], { cwd: root }),
      /Unsupported Wakeflow process command/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wakeflow process boundary rejects shell mode and unsupported commands", () => {
  assert.throws(
    () => runSync("sh", ["-c", "echo no"], { shell: true }),
    /shell mode|Unsupported Wakeflow process command/,
  );
  assert.throws(
    () => runSync("curl", ["https://example.invalid"], { encoding: "utf8" }),
    /Unsupported Wakeflow process command/,
  );
  assert.throws(
    () => runSync(process.execPath, ["-e", "console.log('no')"], { encoding: "utf8" }),
    /Unsupported Wakeflow node flag: -e/,
  );
});

test("Wakeflow spawnSync wrapper buffers large local JSON-sized output", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wakeflow-process-buffer-"));
  try {
    const script = path.join(root, "large-output.mjs");
    writeFileSync(script, "process.stdout.write('x'.repeat(2 * 1024 * 1024));\n");

    const result = runSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.equal(result.status, 0, result.error?.message);
    assert.equal(result.error, undefined);
    assert.equal(result.stdout.length, 2 * 1024 * 1024);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
