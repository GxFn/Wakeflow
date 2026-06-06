#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const controlScript = path.join(workspaceRoot, "scripts/wakeflow-cli.mjs");

function run(args) {
  return spawnSync("node", [controlScript, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

test("--print verify maps friendly flags to wakeflow-verify flags", () => {
  const result = run(["--print", "verify", "--runtime", "--script-tests"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /node scripts\/wakeflow-verify\.mjs --with-runtime --with-script-tests/,
  );
});

test("--print sync renders controller state progress documents", () => {
  const result = run(["--print", "sync", "--state-root", ".workspace-active/workspace/current/example-demand", "--write", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /node scripts\/wakeflow-render-progress\.mjs --state-root \.workspace-active\/workspace\/current\/example-demand --write --json/,
  );
});

test("--print design preserves focused handoff validation arguments", () => {
  const result = run(["--print", "design", "--id", "PCVM-2026-05-25", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node scripts\/wakeflow-import-design-handoffs\.mjs --json --id PCVM-2026-05-25/);
});

test("--print intake maps Design/Test intake to the state-root bridge", () => {
  const result = run([
    "--print",
    "intake",
    "test-card",
    "--state-root",
    ".workspace-active/workspace/current/example-demand",
    "--test-id",
    "TEST-1",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /node scripts\/wakeflow-intake\.mjs test-card --state-root \.workspace-active\/workspace\/current\/example-demand --test-id TEST-1 --json/,
  );
});

test("--print scripts --tests includes script validation and all script tests", () => {
  const result = run(["--print", "scripts", "--tests"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node scripts\/wakeflow-check-scripts\.mjs/);
  assert.match(result.stdout, /node --test .*scripts\/wakeflow-delivery\.test\.mjs/);
  assert.match(result.stdout, /scripts\/wakeflow-intake\.test\.mjs/);
  assert.match(result.stdout, /scripts\/wakeflow-demand-sequence\.test\.mjs/);
  assert.match(result.stdout, /scripts\/wakeflow-import-design-handoffs\.test\.mjs/);
  assert.match(result.stdout, /scripts\/wakeflow-next-work\.test\.mjs/);
  assert.match(result.stdout, /scripts\/wakeflow-cli\.test\.mjs/);
});

test("--print loop maps to Wakeflow delivery-loop script", () => {
  const result = run(["--print", "loop", "status", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node scripts\/wakeflow-delivery\.mjs status --json/);
});

test("--print sequence maps to ordered demand sequence script", () => {
  const result = run(["--print", "sequence", "claim-next", "--manifest", "workspace-ledger/requirement-designs/example/sequence.json", "--write", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /node scripts\/wakeflow-demand-sequence\.mjs claim-next --manifest workspace-ledger\/requirement-designs\/example\/sequence\.json --write --json/,
  );
});

test("--print next-work maps to the controller candidate scan script", () => {
  const result = run(["--print", "next-work", "--id", "PLUGIN-MCP-MULTI-PROJECT-RUNTIME-2026-06-03", "--after-completion", "--source", "design", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /node scripts\/wakeflow-next-work\.mjs --id PLUGIN-MCP-MULTI-PROJECT-RUNTIME-2026-06-03 --after-completion --source design --json/,
  );
});

test("status --json returns a machine-readable aggregate", () => {
  const result = run(["status", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, "status");
  assert.deepEqual(
    payload.checks.map((check) => check.key),
    ["repoStatus", "closedLoopStatus"],
  );
});

test("--print status routes an explicit Wakeflow root to status checks", () => {
  const root = "/tmp/example-wakeflow";
  const result = run(["--print", "status", "--root", root, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`node scripts/wakeflow-repo-status\\.mjs --root ${root} --json`));
  assert.match(result.stdout, new RegExp(`node scripts/wakeflow-delivery\\.mjs status --root ${root} --json`));
});

test("status --root uses embedded scripts when the target root has no scripts directory", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wakeflow-cli-status-root-"));
  try {
    const result = run(["status", "--root", root, "--json"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.checks[0].payload.workspaceRoot, root);
    assert.deepEqual(payload.checks[0].payload.repos, []);
    assert.match(payload.checks[1].payload.stateDir, /\.workspace-local\/wakeflow-delivery$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--print verify routes an explicit Wakeflow root to verification", () => {
  const root = "/tmp/example-wakeflow";
  const result = run(["--print", "verify", "--root", root, "--script-tests"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`node scripts/wakeflow-verify\\.mjs --root ${root} --with-script-tests`));
});

test("sync without state root fails closed instead of using legacy Markdown state", () => {
  const result = run(["--print", "sync", "--write"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sync requires --state-root/);
});

test("legacy-sync command is not accepted", () => {
  const result = run(["--print", "legacy-sync", "--write"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown wakeflow-cli command: legacy-sync/);
});

test("dispatch command is not accepted", () => {
  const result = run(["--print", "dispatch"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown wakeflow-cli command: dispatch/);
});

test("--print install maps to Wakeflow runtime install script", () => {
  const result = run(["--print", "install", "prompts", "--window", "BaseWindow"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node scripts\/wakeflow-setup\.mjs prompts --window BaseWindow/);
});

test("--print install supports internal Design/Test template sync", () => {
  const result = run(["--print", "install", "configure", "--internal-design", "--internal-test", "--write"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node scripts\/wakeflow-setup\.mjs configure --internal-design --internal-test --write/);
});

test("--print install write-agents supports explicit unmanaged window refresh", () => {
  const result = run(["--print", "install", "write-agents", "--all", "--include-unmanaged", "--write"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node scripts\/wakeflow-setup\.mjs write-agents --all --include-unmanaged --write/);
});

test("legacy vad command is not accepted", () => {
  const result = run(["--print", "vad", "status", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown wakeflow-cli command: vad/);
});

test("unknown command fails closed", () => {
  const result = run(["--print", "launch"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown wakeflow-cli command/);
});
