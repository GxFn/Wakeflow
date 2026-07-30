#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const roots = [];
const runtimeParent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-render-runtime-"));
const runtimeRoot = path.join(runtimeParent, "runtime");
roots.push(runtimeParent);
cpSync(path.join(repositoryRoot, "core"), runtimeRoot, { recursive: true });
cpSync(
  path.join(repositoryRoot, "plugins/codex-wakeflow/templates"),
  path.join(runtimeRoot, "templates"),
  { recursive: true },
);
const stateScript = path.join(runtimeRoot, "scripts/wakeflow-state.mjs");
const renderScript = path.join(runtimeRoot, "scripts/wakeflow-render-progress.mjs");

test.after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function makeRoot(prefix = "wakeflow-render-invariant-") {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args, "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function initDemand(root, demandKey) {
  const result = run(stateScript, [
    "init",
    "--root",
    root,
    "--demand-key",
    demandKey,
    "--title",
    demandKey,
    "--write",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("render rejects a progress document that escapes its state root", () => {
  const root = makeRoot();
  const init = initDemand(root, "RENDER-PATH-ESCAPE");
  const stateRoot = path.join(root, init.stateRoot);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.md`);
  roots.push(outside);
  writeFileSync(outside, "<!-- unified-status:start -->\noutside\n<!-- unified-status:end -->\n");
  const beforeOutside = readFileSync(outside, "utf8");
  const state = readJson(stateFile);
  state.projection.progressDoc = path.relative(stateRoot, outside);
  state.projection.status = "stale";
  writeJson(stateFile, state);

  const rendered = run(renderScript, [
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
  ]);
  assert.notEqual(rendered.status, 0);
  assert.match(rendered.stdout + rendered.stderr, /progress document|state root/i);
  assert.equal(readFileSync(outside, "utf8"), beforeOutside);
  assert.equal(readJson(stateFile).projection.status, "stale");
});

test("render marks projection synced only after the progress document write succeeds", () => {
  const root = makeRoot();
  const init = initDemand(root, "RENDER-SYNC-LAST");
  const stateRoot = path.join(root, init.stateRoot);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const progressDir = path.join(stateRoot, "read-only");
  const progressFile = path.join(progressDir, "progress.md");
  mkdirSync(progressDir, { recursive: true });
  writeFileSync(progressFile, [
    "# Progress",
    "",
    "<!-- unified-status:start -->",
    "stale",
    "<!-- unified-status:end -->",
    "",
  ].join("\n"));
  const state = readJson(stateFile);
  state.projection.progressDoc = "read-only/progress.md";
  state.projection.status = "stale";
  writeJson(stateFile, state);
  const beforeProgress = readFileSync(progressFile, "utf8");

  chmodSync(progressDir, 0o500);
  let rendered;
  try {
    rendered = run(renderScript, [
      "--root",
      root,
      "--state-root",
      init.stateRoot,
      "--write",
    ]);
  } finally {
    chmodSync(progressDir, 0o700);
  }
  assert.notEqual(rendered.status, 0);
  assert.equal(readJson(stateFile).projection.status, "stale");
  assert.equal(readFileSync(progressFile, "utf8"), beforeProgress);
});

test("render rejects state that advanced without its controller event", () => {
  const root = makeRoot();
  const init = initDemand(root, "RENDER-STATE-AHEAD");
  const stateRoot = path.join(root, init.stateRoot);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = readJson(stateFile);
  state.revision += 1;
  state.projection.status = "stale";
  writeJson(stateFile, state);

  const rendered = run(renderScript, [
    "--root",
    root,
    "--state-root",
    init.stateRoot,
    "--write",
  ]);
  assert.notEqual(rendered.status, 0);
  const payload = JSON.parse(rendered.stdout);
  assert.equal(payload.errorCode, "controller-event-manual-recovery-required");
  assert.equal(readJson(stateFile).projection.status, "stale");
});

test("render rejects a state-root symlink that resolves outside the workspace", () => {
  const workspace = makeRoot();
  const external = makeRoot("wakeflow-render-external-");
  const init = initDemand(external, "RENDER-EXTERNAL");
  const externalRoot = path.join(external, init.stateRoot);
  const externalStateFile = path.join(externalRoot, "wakeflow-state.json");
  const before = readFileSync(externalStateFile, "utf8");
  const link = path.join(workspace, ".wakeflow-active/current/RENDER-EXTERNAL");
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(externalRoot, link);

  const rendered = run(renderScript, [
    "--root",
    workspace,
    "--state-root",
    ".wakeflow-active/current/RENDER-EXTERNAL",
    "--write",
  ]);
  assert.notEqual(rendered.status, 0);
  assert.match(rendered.stdout + rendered.stderr, /inside the Wakeflow runtime|state root|symbolic link/i);
  assert.equal(readFileSync(externalStateFile, "utf8"), before);
});
