import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";

const helperScript = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs",
);

const tmuxPresent = spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0;
const serverSession = `wakeflow-test-${process.pid}`;

function makeWorkspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), "claude-host-"));
  mkdirSync(path.join(root, "RepoA"), { recursive: true });
  const stub = path.join(root, "stub-claude");
  writeFileSync(stub, "#!/bin/sh\necho \"stub-claude started\"\nexec cat\n", { mode: 0o755 });
  return root;
}

function runHelper(root, helperArgs, env = {}) {
  return runSync(process.execPath, [helperScript, ...helperArgs, "--root", root], {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, WAKEFLOW_CLAUDE_BIN: path.join(root, "stub-claude"), ...env },
  });
}

function parseOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function killServer() {
  spawnSync("tmux", ["kill-session", "-t", serverSession], { encoding: "utf8" });
}

test("preflight reports tmux and recommendation", () => {
  const root = makeWorkspace();
  const result = runHelper(root, ["preflight"]);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "preflight");
  assert.equal(typeof payload.tmux.present, "boolean");
  assert.ok(["ready", "install-tmux", "install-homebrew-then-tmux"].includes(payload.recommendation));
});

test("launch-window, send, readback, lock, and wait-results work end to end", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  t.after(killServer);

  const promptFile = path.join(root, "entry-prompt.txt");
  writeFileSync(promptFile, "wakeflow-entry-sync-marker\n");

  const launched = parseOk(runHelper(root, [
    "launch-window",
    "--server", serverSession,
    "--window", "RepoA",
    "--title", "RepoA Work",
    "--cwd", "RepoA",
    "--prompt-file", promptFile,
    "--boot-wait-ms", "800",
  ]));
  assert.equal(launched.ok, true);
  assert.match(launched.windowId, /^@/);
  assert.equal(launched.title, "RepoA Work");
  assert.match(launched.sessionId, /^[0-9a-f-]{36}$/);
  assert.match(launched.registerArgv.join(" "), /RepoA=/);

  const bindingFile = path.join(root, launched.bindingFile);
  assert.match(launched.bindingFile, /hosts\/claude-code\/window-host\//);
  const binding = JSON.parse(readFileSync(bindingFile, "utf8"));
  assert.equal(binding.kind, "ClaudeWindowHostBinding");
  assert.equal(binding.threadId, launched.sessionId);
  assert.equal(binding.tmux.server, serverSession);

  const deliveryPrompt = path.join(root, "delivery-prompt.txt");
  writeFileSync(deliveryPrompt, "wakeflow-delivery-marker line-one\nline-two\n");
  const sent = parseOk(runHelper(root, [
    "send",
    "--window", "RepoA",
    "--prompt-file", deliveryPrompt,
    "--delivery-id", "dlv-test-1",
    "--readback-wait-ms", "700",
  ]));
  assert.equal(sent.ok, true);
  assert.match(sent.readback.paneTail, /wakeflow-delivery-marker line-one/);
  assert.match(sent.readback.paneTail, /line-two/);
  assert.ok(existsSync(path.join(root, sent.lockFile)), "send must create the shared window lock");

  const busyStatus = parseOk(runHelper(root, ["window-status"]));
  assert.equal(busyStatus.windows.find((row) => row.window === "RepoA").state, "busy", "send marks the window busy");

  // A SAME-host fresh lock is advisory: re-send proceeds with a warning (a
  // controller-return to a window holding its own inbound lock must not
  // deadlock). Only a CROSS-host lock hard-blocks.
  const sameHostResend = parseOk(runHelper(root, ["send", "--window", "RepoA", "--prompt-file", deliveryPrompt]));
  assert.match(sameHostResend.lockWarning || "", /same-host delivery lock/);
  assert.equal(sameHostResend.deliveryId, "dlv-test-1", "same-host resend without an explicit id preserves the locked delivery id");
  const sameHostLock = JSON.parse(readFileSync(path.join(root, sent.lockFile), "utf8"));
  assert.equal(sameHostLock.deliveryId, "dlv-test-1", "same-host resend must not erase the lock delivery id");

  // Simulate a fresh lock from the OTHER host -> hard block.
  const lockFile = path.join(root, ".workspace-local/wakeflow-delivery/locks/RepoA.json");
  writeFileSync(lockFile, JSON.stringify({
    kind: "WakeflowWindowDeliveryLock", windowName: "RepoA", host: "codex",
    deliveryId: "dlv-codex", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  }));
  const crossHostSend = runHelper(root, ["send", "--window", "RepoA", "--prompt-file", deliveryPrompt]);
  assert.notEqual(crossHostSend.status, 0);
  assert.match(crossHostSend.stderr + crossHostSend.stdout, /fresh in-flight delivery lock from host codex/);

  const readback = parseOk(runHelper(root, ["readback", "--window", "RepoA", "--lines", "30"]));
  assert.equal(readback.alive, true);
  assert.match(readback.paneTail, /wakeflow-entry-sync-marker/);

  const retitled = parseOk(runHelper(root, ["retitle", "--window", "RepoA", "--title", "RepoA Focus"]));
  assert.equal(retitled.title, "RepoA Focus");

  const stalled = runHelper(root, ["wait-results", "--group", "grp-1", "--target", "RepoA", "--timeout-sec", "1", "--poll-ms", "250"]);
  assert.notEqual(stalled.status, 0);
  assert.equal(JSON.parse(stalled.stdout).status, "stalled");

  const resultsDir = path.join(root, ".workspace-local/wakeflow-delivery/target-results");
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(path.join(resultsDir, "grp-1__RepoA__task-1.json"), JSON.stringify({
    kind: "TargetResultEnvelope",
    dispatchGroup: "grp-1",
    targetWindow: "RepoA",
    taskId: "task-1",
    status: "completed",
    reportedAt: new Date().toISOString(),
  }));
  const ready = parseOk(runHelper(root, ["wait-results", "--group", "grp-1", "--target", "RepoA", "--timeout-sec", "5", "--poll-ms", "250"]));
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.windows, ["RepoA"]);
  assert.ok(!existsSync(path.join(root, sent.lockFile)), "wait-results must release the delivered window lock");

  const attach = parseOk(runHelper(root, ["attach-window", "--window", "RepoA"]));
  assert.match(attach.attach, new RegExp(serverSession));

  const status = parseOk(runHelper(root, ["window-status"]));
  const repoRow = status.windows.find((row) => row.window === "RepoA");
  assert.equal(repoRow.alive, true);
  assert.equal(repoRow.state, "done", "wait-results marks the window done");

  const reconciled = parseOk(runHelper(root, ["window-status", "--reconcile"]));
  const cleared = reconciled.windows.find((row) => row.window === "RepoA");
  assert.equal(cleared.state, "", "reconcile clears transient done state when no fresh lock");
});

test("check-workspace reports gaps and stamp-runtime clears the version gap", () => {
  const root = makeWorkspace();
  writeFileSync(path.join(root, "workspace.config.json"), JSON.stringify({
    workspaceName: "CheckFlow",
    controllerWindow: "CheckFlow",
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));

  const first = parseOk(runHelper(root, ["check-workspace"]));
  assert.equal(first.healthy, false);
  const areas = new Set(first.gaps.map((gap) => gap.area));
  for (const expected of ["workspace-config", "root-memory-file", "window-card", "permissions", "registry", "plugin-version"]) {
    assert.ok(areas.has(expected), `expected gap area ${expected}`);
  }
  assert.ok(first.gaps.every((gap) => gap.fix), "every gap names its fix");

  parseOk(runHelper(root, ["seed-permissions", "--write"]));
  parseOk(runHelper(root, ["stamp-runtime", "--write"]));
  const second = parseOk(runHelper(root, ["check-workspace"]));
  const secondAreas = new Set(second.gaps.map((gap) => gap.area));
  assert.ok(!secondAreas.has("permissions"), "seeded permissions clear the permissions gap");
  assert.ok(!secondAreas.has("plugin-version"), "stamp clears the version gap");
  assert.equal(second.stamp.pluginVersion, second.pluginVersion);
});

test("launch-window resolves per-role effort and model pin (controller=max, worker=xhigh)", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  mkdirSync(path.join(root, "Worker"), { recursive: true });
  writeFileSync(path.join(root, "workspace.config.json"), JSON.stringify({
    workspaceName: "EffortFlow",
    controllerWindow: "EffortFlow",
    hosts: { "claude-code": { tmuxSession: serverSession, modelByRole: { default: "claude-fable-5" } } },
    repositories: [{ windowName: "Worker", path: "Worker", role: "Repository window" }],
  }));
  mkdirSync(path.join(root, "EffortFlow"), { recursive: true });
  t.after(killServer);

  const ctrl = parseOk(runHelper(root, ["launch-window", "--server", serverSession, "--window", "EffortFlow", "--cwd", ".", "--boot-wait-ms", "600"]));
  assert.equal(ctrl.role, "controller");
  assert.equal(ctrl.effort, "max", "controller launches at max");
  assert.equal(ctrl.model, "claude-fable-5", "controller model pinned from modelByRole");

  const worker = parseOk(runHelper(root, ["launch-window", "--server", serverSession, "--window", "Worker", "--cwd", "Worker", "--boot-wait-ms", "600"]));
  assert.equal(worker.role, "product");
  assert.equal(worker.effort, "xhigh", "worker launches at xhigh (profile default)");
  assert.equal(worker.model, "claude-fable-5", "worker model pinned from modelByRole");
});

test("wait-results keeps a delivery lock that is newer than the arrived result", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  mkdirSync(path.join(root, "RepoA"), { recursive: true });
  writeFileSync(path.join(root, "workspace.config.json"), JSON.stringify({
    workspaceName: "LockFlow", controllerWindow: "LockFlow",
    hosts: { "claude-code": { tmuxSession: serverSession } },
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));
  t.after(killServer);

  const resultsDir = path.join(root, ".workspace-local/wakeflow-delivery/target-results");
  mkdirSync(resultsDir, { recursive: true });
  // An OLD result already exists for RepoA.
  writeFileSync(path.join(resultsDir, "grp__RepoA__t1.json"), JSON.stringify({
    kind: "TargetResultEnvelope", dispatchGroup: "grp", targetWindow: "RepoA", taskId: "t1",
    status: "completed", createdAt: "2026-01-01T00:00:00.000Z",
  }));
  // A NEW lock (fresh delivery) was written AFTER that result.
  const locksDir = path.join(root, ".workspace-local/wakeflow-delivery/locks");
  mkdirSync(locksDir, { recursive: true });
  const lockFile = path.join(locksDir, "RepoA.json");
  writeFileSync(lockFile, JSON.stringify({
    kind: "WakeflowWindowDeliveryLock", windowName: "RepoA", host: "claude-code",
    deliveryId: "dlv-new", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  }));

  const ready = parseOk(runHelper(root, ["wait-results", "--group", "grp", "--target", "RepoA", "--timeout-sec", "5", "--poll-ms", "250"]));
  assert.equal(ready.status, "ready");
  assert.ok(existsSync(lockFile), "lock newer than the result must survive (still-in-flight delivery)");
});

test("activity-monitor --once marks live-executing windows running and clears idle ones", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  writeFileSync(path.join(root, "workspace.config.json"), JSON.stringify({
    workspaceName: "MonFlow", controllerWindow: "MonFlow",
    hosts: { "claude-code": { tmuxSession: serverSession } },
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));
  spawnSync("tmux", ["new-session", "-d", "-s", serverSession, "-c", root], { encoding: "utf8" });
  t.after(killServer);

  // window 1: a pane that prints the live "esc to interrupt" marker and stays open
  spawnSync("tmux", ["new-window", "-t", serverSession, "-n", "Busy", "sh -c 'printf \"esc to interrupt\"; sleep 60'"], { encoding: "utf8" });
  // window 2: an idle shell
  spawnSync("tmux", ["new-window", "-t", serverSession, "-n", "Idle", "sh -c 'sleep 60'"], { encoding: "utf8" });
  await new Promise((r) => setTimeout(r, 800));

  parseOk(runHelper(root, ["activity-monitor", "--server", serverSession, "--once"]));
  const states = spawnSync("tmux", ["list-windows", "-t", serverSession, "-F", "#{window_name}|#{@wakeflow_state}"], { encoding: "utf8" }).stdout.trim().split("\n");
  const busy = states.find((l) => l.startsWith("Busy|"));
  const idle = states.find((l) => l.startsWith("Idle|"));
  assert.equal(busy, "Busy|running", "the executing window is marked running");
  assert.ok(idle === "Idle|" || idle === "Idle|-" || idle.endsWith("|"), `idle window has no running state (${idle})`);
});

test("set-unattended records the permission mode and reports restart plan", () => {
  const root = makeWorkspace();
  writeFileSync(path.join(root, "workspace.config.json"), JSON.stringify({
    workspaceName: "ModeFlow",
    controllerWindow: "ModeFlow",
    hosts: { "claude-code": { tmuxSession: "modeflow", claudeArgs: ["--effort", "max"] } },
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));

  const bad = runHelper(root, ["set-unattended", "--mode", "nonsense", "--write"]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr + bad.stdout, /--mode must be one of/);

  const dry = parseOk(runHelper(root, ["set-unattended", "--mode", "bypassPermissions"]));
  assert.equal(dry.wrote, false);
  assert.equal(dry.previousMode, "acceptEdits");
  assert.equal(dry.mode, "bypassPermissions");
  const stillDefault = JSON.parse(readFileSync(path.join(root, "workspace.config.json"), "utf8"));
  assert.equal(stillDefault.hosts["claude-code"].permissionMode, undefined, "dry run does not write");

  const wrote = parseOk(runHelper(root, ["set-unattended", "--mode", "bypassPermissions", "--write"]));
  assert.equal(wrote.wrote, true);
  const after = JSON.parse(readFileSync(path.join(root, "workspace.config.json"), "utf8"));
  assert.equal(after.hosts["claude-code"].permissionMode, "bypassPermissions");
  assert.equal(after.hosts["claude-code"].tmuxSession, "modeflow", "other host keys preserved");
  assert.deepEqual(after.hosts["claude-code"].claudeArgs, ["--effort", "max"], "claudeArgs preserved");
});

test("launch-window --replace kills the old window instead of leaking an orphan", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  t.after(killServer);
  const first = parseOk(runHelper(root, ["launch-window", "--server", serverSession, "--window", "RepoA", "--cwd", "RepoA", "--boot-wait-ms", "500"]));
  const oldWid = first.windowId;
  const before = spawnSync("tmux", ["list-windows", "-t", serverSession, "-F", "#{window_id}"], { encoding: "utf8" }).stdout.trim().split("\n");
  assert.ok(before.includes(oldWid));

  const second = parseOk(runHelper(root, ["launch-window", "--server", serverSession, "--window", "RepoA", "--cwd", "RepoA", "--replace", "--boot-wait-ms", "500"]));
  assert.notEqual(second.windowId, oldWid, "replace creates a new window id");
  const after = spawnSync("tmux", ["list-windows", "-t", serverSession, "-F", "#{window_id}"], { encoding: "utf8" }).stdout.trim().split("\n");
  assert.equal(after.length, before.length, "window count unchanged: no orphan leaked");
  assert.ok(!after.includes(oldWid), "old window was killed");
  assert.ok(after.includes(second.windowId), "new window is alive");
});

test("seed-permissions keeps committed settings portable and migrates old residue to settings.local.json", () => {
  const root = makeWorkspace();
  writeFileSync(path.join(root, "workspace.config.json"), JSON.stringify({
    workspaceName: "SeedFlow", controllerWindow: "SeedFlow",
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));
  // simulate the OLD buggy layout: absolute workspace path + wakeflow statusLine in the COMMITTED file
  const repoSettingsDir = path.join(root, "RepoA", ".claude");
  mkdirSync(repoSettingsDir, { recursive: true });
  writeFileSync(path.join(repoSettingsDir, "settings.json"), JSON.stringify({
    statusLine: { type: "command", command: `node ${root}/.workspace-local/wakeflow-statusline.mjs` },
    permissions: { allow: [], additionalDirectories: [root] },
  }));

  parseOk(runHelper(root, ["seed-permissions", "--write"]));

  const committed = JSON.parse(readFileSync(path.join(repoSettingsDir, "settings.json"), "utf8"));
  assert.equal(committed.statusLine, undefined, "wakeflow statusLine migrated out of the committed file");
  const dirs = committed.permissions.additionalDirectories;
  assert.ok(!dirs.includes(root), "absolute workspace path removed");
  assert.ok(dirs.includes(".."), "relative parent reference present");
  assert.ok(!JSON.stringify(committed).includes(root), "no absolute machine path anywhere in the committed file");

  const local = JSON.parse(readFileSync(path.join(repoSettingsDir, "settings.local.json"), "utf8"));
  assert.match(local.statusLine.command, /wakeflow-statusline\.mjs/, "statusline lives in the machine-local layer");

  // a user-custom statusLine in the committed file is left untouched
  const rootSettings = path.join(root, ".claude");
  mkdirSync(rootSettings, { recursive: true });
  writeFileSync(path.join(rootSettings, "settings.json"), JSON.stringify({
    statusLine: { type: "command", command: "my-custom-statusline" },
  }));
  parseOk(runHelper(root, ["seed-permissions", "--write"]));
  const rootCommitted = JSON.parse(readFileSync(path.join(rootSettings, "settings.json"), "utf8"));
  assert.equal(rootCommitted.statusLine.command, "my-custom-statusline", "custom statusLine untouched");
});

test("send refuses when no binding exists and release-lock is idempotent", () => {
  const root = makeWorkspace();
  const promptFile = path.join(root, "p.txt");
  writeFileSync(promptFile, "x\n");
  const missing = runHelper(root, ["send", "--window", "Ghost", "--prompt-file", promptFile]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr + missing.stdout, /No window-host binding/);

  const released = parseOk(runHelper(root, ["release-lock", "--window", "Ghost"]));
  assert.equal(released.released, false);
});
