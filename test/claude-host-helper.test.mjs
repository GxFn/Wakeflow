import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";

const helperScript = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs",
);

const tmuxPresent = spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0;
let serverSessionCounter = 0;

function makeServerSession() {
  serverSessionCounter += 1;
  return `wakeflow-test-${process.pid}-${serverSessionCounter}`;
}

const setupScript = path.join(path.dirname(path.dirname(helperScript)), "wakeflow-setup.mjs");

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

function killServer(serverSession) {
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

test("ensure-server honors a configured dedicated tmux socket (isolated from the default server)", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  const serverSession = makeServerSession();
  const socket = `wfsock-${process.pid}-${serverSession.split("-").pop()}`;
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "SocketFlow",
    controllerWindow: "SocketFlow",
    hosts: { "claude-code": { tmuxSession: serverSession, tmuxSocket: socket } },
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));
  t.after(() => {
    const pidFile = path.join(root, ".wakeflow-local/wakeflow-delivery/hosts/claude-code", `activity-monitor-${serverSession}.pid`);
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      if (Number.isInteger(pid)) { try { process.kill(pid); } catch { /* already gone */ } }
    }
    spawnSync("tmux", ["-L", socket, "kill-server"], { encoding: "utf8" });
  });

  const payload = parseOk(runHelper(root, ["ensure-server", "--server", serverSession]));
  assert.equal(payload.ok, true);
  assert.equal(payload.created, true);

  // The session is created on the dedicated -L socket...
  assert.equal(
    spawnSync("tmux", ["-L", socket, "has-session", "-t", serverSession], { encoding: "utf8" }).status,
    0,
    "session must exist on the dedicated -L socket",
  );
  // ...and must NOT leak onto the shared default socket the user's personal sessions use.
  assert.notEqual(
    spawnSync("tmux", ["has-session", "-t", serverSession], { encoding: "utf8" }).status,
    0,
    "session must not appear on the default socket",
  );
});

test("launch-window, send, readback, lock, and wait-results work end to end", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  const serverSession = makeServerSession();
  const noAuto = { WAKEFLOW_DISABLE_MONITOR: "1" };
  t.after(() => killServer(serverSession));

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
  ], noAuto));
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
  assert.equal(binding.tmux.session, serverSession);

  const deliveryPrompt = path.join(root, "delivery-prompt.txt");
  writeFileSync(deliveryPrompt, "wakeflow-delivery-marker line-one\nline-two\n");
  const sent = parseOk(runHelper(root, [
    "send",
    "--window", "RepoA",
    "--prompt-file", deliveryPrompt,
    "--delivery-id", "dlv-test-1",
    "--readback-wait-ms", "700",
  ], noAuto));
  assert.equal(sent.ok, true);
  assert.match(sent.readback.paneTail, /wakeflow-delivery-marker line-one/);
  assert.match(sent.readback.paneTail, /line-two/);
  assert.ok(existsSync(path.join(root, sent.lockFile)), "send must create the shared window lock");

  const busyStatus = parseOk(runHelper(root, ["window-status"], noAuto));
  assert.equal(busyStatus.windows.find((row) => row.window === "RepoA").state, "busy", "send marks the window busy");

  // A SAME-host fresh lock is advisory: re-send proceeds with a warning (a
  // controller-return to a window holding its own inbound lock must not
  // deadlock). Only a CROSS-host lock hard-blocks.
  const sameHostResend = parseOk(runHelper(root, ["send", "--window", "RepoA", "--prompt-file", deliveryPrompt], noAuto));
  assert.match(sameHostResend.lockWarning || "", /same-host delivery lock/);
  assert.equal(sameHostResend.deliveryId, "dlv-test-1", "same-host resend without an explicit id preserves the locked delivery id");
  const sameHostLock = JSON.parse(readFileSync(path.join(root, sent.lockFile), "utf8"));
  assert.equal(sameHostLock.deliveryId, "dlv-test-1", "same-host resend must not erase the lock delivery id");

  // Simulate a fresh lock from the OTHER host -> hard block.
  const lockFile = path.join(root, ".wakeflow-local/wakeflow-delivery/locks/RepoA.json");
  writeFileSync(lockFile, JSON.stringify({
    kind: "WakeflowWindowDeliveryLock", windowName: "RepoA", host: "codex",
    deliveryId: "dlv-codex", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  }));
  const crossHostSend = runHelper(root, ["send", "--window", "RepoA", "--prompt-file", deliveryPrompt], noAuto);
  assert.notEqual(crossHostSend.status, 0);
  assert.match(crossHostSend.stderr + crossHostSend.stdout, /fresh in-flight delivery lock from host codex/);

  const readback = parseOk(runHelper(root, ["readback", "--window", "RepoA", "--lines", "30"], noAuto));
  assert.equal(readback.alive, true);
  assert.match(readback.paneTail, /wakeflow-entry-sync-marker/);

  const retitled = parseOk(runHelper(root, ["retitle", "--window", "RepoA", "--title", "RepoA Focus"], noAuto));
  assert.equal(retitled.title, "RepoA Focus");

  const stalled = runHelper(root, ["wait-results", "--group", "grp-1", "--target", "RepoA", "--timeout-sec", "1", "--poll-ms", "250"], noAuto);
  assert.notEqual(stalled.status, 0);
  assert.equal(JSON.parse(stalled.stdout).status, "timeout");

  const resultsDir = path.join(root, ".wakeflow-local/wakeflow-delivery/target-results");
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(path.join(resultsDir, "grp-1__RepoA__task-1.json"), JSON.stringify({
    kind: "TargetResultEnvelope",
    dispatchGroup: "grp-1",
    targetWindow: "RepoA",
    taskId: "task-1",
    status: "completed",
    reportedAt: new Date().toISOString(),
  }));
  const ready = parseOk(runHelper(root, ["wait-results", "--group", "grp-1", "--target", "RepoA", "--timeout-sec", "5", "--poll-ms", "250"], noAuto));
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.windows, ["RepoA"]);
  assert.ok(existsSync(path.join(root, sent.lockFile)), "wait-results is a pure observer: the lock is untouched (core release / sentinel own it)");

  // the sentinel flips busy -> done once the lock is released (as the core
  // record/import path does after a real result)
  rmSync(path.join(root, sent.lockFile), { force: true });
  parseOk(runHelper(root, ["activity-monitor", "--server", serverSession, "--once"], noAuto));

  const status = parseOk(runHelper(root, ["window-status"], noAuto));
  const repoRow = status.windows.find((row) => row.window === "RepoA");
  assert.equal(repoRow.alive, true);
  assert.equal(repoRow.state, "done", "wait-results marks the window done");

  const reconciled = parseOk(runHelper(root, ["window-status", "--reconcile"], noAuto));
  const cleared = reconciled.windows.find((row) => row.window === "RepoA");
  assert.equal(cleared.state, "", "reconcile clears transient done state when no fresh lock");
});

test("check-workspace reports gaps and stamp-runtime clears the version gap", () => {
  const root = makeWorkspace();
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
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
  const serverSession = makeServerSession();
  mkdirSync(path.join(root, "Worker"), { recursive: true });
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "EffortFlow",
    controllerWindow: "EffortFlow",
    hosts: { "claude-code": { tmuxSession: serverSession, modelByRole: { default: "claude-fable-5" } } },
    repositories: [{ windowName: "Worker", path: "Worker", role: "Repository window" }],
  }));
  mkdirSync(path.join(root, "EffortFlow"), { recursive: true });
  t.after(() => killServer(serverSession));

  const ctrl = parseOk(runHelper(root, ["launch-window", "--server", serverSession, "--window", "EffortFlow", "--cwd", ".", "--boot-wait-ms", "600"]));
  assert.equal(ctrl.role, "controller");
  assert.equal(ctrl.effort, "max", "controller launches at max");
  assert.equal(ctrl.model, "claude-fable-5", "controller model pinned from modelByRole");

  const worker = parseOk(runHelper(root, ["launch-window", "--server", serverSession, "--window", "Worker", "--cwd", "Worker", "--boot-wait-ms", "600"]));
  assert.equal(worker.role, "product");
  assert.equal(worker.effort, "xhigh", "worker launches at xhigh (profile default)");
  assert.equal(worker.model, "claude-fable-5", "worker model pinned from modelByRole");
});

test("wait-results never touches locks or glyphs (pure observation)", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  const serverSession = makeServerSession();
  mkdirSync(path.join(root, "RepoA"), { recursive: true });
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "LockFlow", controllerWindow: "LockFlow",
    hosts: { "claude-code": { tmuxSession: serverSession } },
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));
  t.after(() => killServer(serverSession));

  const resultsDir = path.join(root, ".wakeflow-local/wakeflow-delivery/target-results");
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(path.join(resultsDir, "grp__RepoA__t1.json"), JSON.stringify({
    kind: "TargetResultEnvelope", dispatchGroup: "grp", targetWindow: "RepoA", taskId: "t1",
    status: "completed", reportedAt: new Date().toISOString(),
  }));
  const locksDir = path.join(root, ".wakeflow-local/wakeflow-delivery/locks");
  mkdirSync(locksDir, { recursive: true });
  const lockFile = path.join(locksDir, "RepoA.json");
  writeFileSync(lockFile, JSON.stringify({
    kind: "WakeflowWindowDeliveryLock", windowName: "RepoA", host: "claude-code",
    deliveryId: "dlv-new", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  }));

  const ready = parseOk(runHelper(root, ["wait-results", "--group", "grp", "--target", "RepoA", "--timeout-sec", "5", "--poll-ms", "250"]));
  assert.equal(ready.status, "ready");
  assert.ok(existsSync(lockFile), "the lock survives: release belongs to the core record path");
});
test("activity-monitor --once marks live-executing windows running and clears idle ones", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  const serverSession = makeServerSession();
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "MonFlow", controllerWindow: "MonFlow",
    hosts: { "claude-code": { tmuxSession: serverSession } },
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));
  spawnSync("tmux", ["new-session", "-d", "-s", serverSession, "-c", root], { encoding: "utf8" });
  t.after(() => killServer(serverSession));

  // window 1: a pane that prints the live "esc to interrupt" marker and stays open
  const busyWindow = spawnSync("tmux", ["new-window", "-t", serverSession, "-n", "Busy", "-P", "-F", "#{window_id}", "sh -c 'printf \"esc to interrupt\"; sleep 60'"], { encoding: "utf8" }).stdout.trim();
  // window 2: an idle shell
  const idleWindow = spawnSync("tmux", ["new-window", "-t", serverSession, "-n", "Idle", "-P", "-F", "#{window_id}", "sh -c 'sleep 60'"], { encoding: "utf8" }).stdout.trim();
  const bindingDir = path.join(root, ".wakeflow-local/wakeflow-delivery/hosts/claude-code/window-host");
  mkdirSync(bindingDir, { recursive: true });
  writeFileSync(path.join(bindingDir, "Busy.json"), JSON.stringify({
    kind: "ClaudeWindowHostBinding",
    version: 1,
    windowName: "Busy",
    threadId: "test-busy",
    cwd: root,
    tmux: { session: serverSession, windowId: busyWindow, title: "Busy" },
  }));
  writeFileSync(path.join(bindingDir, "Idle.json"), JSON.stringify({
    kind: "ClaudeWindowHostBinding",
    version: 1,
    windowName: "Idle",
    threadId: "test-idle",
    cwd: root,
    tmux: { session: serverSession, windowId: idleWindow, title: "Idle" },
  }));
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
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
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
  const stillDefault = JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8"));
  assert.equal(stillDefault.hosts["claude-code"].permissionMode, undefined, "dry run does not write");

  const wrote = parseOk(runHelper(root, ["set-unattended", "--mode", "bypassPermissions", "--write"]));
  assert.equal(wrote.wrote, true);
  const after = JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8"));
  assert.equal(after.hosts["claude-code"].permissionMode, "bypassPermissions");
  assert.equal(after.hosts["claude-code"].tmuxSession, "modeflow", "other host keys preserved");
  assert.deepEqual(after.hosts["claude-code"].claudeArgs, ["--effort", "max"], "claudeArgs preserved");
});

test("launch-window --replace kills the old window instead of leaking an orphan", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  const serverSession = makeServerSession();
  t.after(() => killServer(serverSession));
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

test("sentinel: --once flips a delivered window to done when its lock is released; controller exempt", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  const serverSession = makeServerSession();
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "SentinelFlow", controllerWindow: "SentinelFlow",
    hosts: { "claude-code": { tmuxSession: serverSession } },
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));
  t.after(() => killServer(serverSession));
  const noAuto = { WAKEFLOW_DISABLE_MONITOR: "1" };
  const ctrl = parseOk(runHelper(root, ["launch-window", "--server", serverSession, "--window", "SentinelFlow", "--cwd", ".", "--boot-wait-ms", "400"], noAuto));
  const repo = parseOk(runHelper(root, ["launch-window", "--server", serverSession, "--window", "RepoA", "--cwd", "RepoA", "--boot-wait-ms", "400"], noAuto));
  const readState = (wid) => spawnSync("tmux", ["show-options", "-w", "-q", "-v", "-t", wid, "@wakeflow_state"], { encoding: "utf8" }).stdout.trim();

  // delivered window: busy + lock -> stays busy (the monitor never judges silence)
  spawnSync("tmux", ["set-option", "-w", "-t", repo.windowId, "@wakeflow_state", "busy"], { encoding: "utf8" });
  const locksDir = path.join(root, ".wakeflow-local/wakeflow-delivery/locks");
  mkdirSync(locksDir, { recursive: true });
  const lockFile = path.join(locksDir, "RepoA.json");
  writeFileSync(lockFile, JSON.stringify({
    kind: "WakeflowWindowDeliveryLock", windowName: "RepoA", host: "claude-code",
    deliveryId: "dlv-1", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  }));
  parseOk(runHelper(root, ["activity-monitor", "--server", serverSession, "--once"]));
  assert.equal(readState(repo.windowId), "busy", "locked delivered window stays busy; silence is never auto-judged");

  // core releases the lock (result recorded) -> done
  rmSync(lockFile, { force: true });
  parseOk(runHelper(root, ["activity-monitor", "--server", serverSession, "--once"]));
  assert.equal(readState(repo.windowId), "done", "lock release flips the window to done");

  // controller never enters the delivery lifecycle
  spawnSync("tmux", ["set-option", "-w", "-t", ctrl.windowId, "@wakeflow_state", "busy"], { encoding: "utf8" });
  parseOk(runHelper(root, ["activity-monitor", "--server", serverSession, "--once"]));
  assert.equal(readState(ctrl.windowId), "busy", "controller is exempt from done transitions");
  spawnSync("tmux", ["set-option", "-w", "-u", "-t", ctrl.windowId, "@wakeflow_state"], { encoding: "utf8" });

  // residue from the removed stall feature migrates back to busy while locked
  spawnSync("tmux", ["set-option", "-w", "-t", repo.windowId, "@wakeflow_state", "stalled"], { encoding: "utf8" });
  writeFileSync(lockFile, JSON.stringify({ kind: "WakeflowWindowDeliveryLock", windowName: "RepoA", host: "claude-code", deliveryId: "dlv-2", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() }));
  parseOk(runHelper(root, ["activity-monitor", "--server", serverSession, "--once"]));
  assert.equal(readState(repo.windowId), "busy", "legacy stalled residue migrates to busy");
});

test("sentinel: changing pane content counts as activity (long tool calls never stall)", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  const serverSession = makeServerSession();
  const activeSession = `${serverSession}-s2`;
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "ActiveFlow", controllerWindow: "ActiveFlow",
    hosts: { "claude-code": { tmuxSession: activeSession } },
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));
  // a "claude" whose pane updates every second WITHOUT any esc-to-interrupt
  // hint — exactly the long-tool-call rendering that fooled the hint regex
  writeFileSync(path.join(root, "stub-claude"), "#!/bin/sh\nwhile true; do date; sleep 1; done\n", { mode: 0o755 });
  t.after(() => spawnSync("tmux", ["kill-session", "-t", activeSession], { encoding: "utf8" }));

  const noAuto = { WAKEFLOW_DISABLE_MONITOR: "1" };
  const launched = parseOk(runHelper(root, ["launch-window", "--server", activeSession, "--window", "RepoA", "--cwd", "RepoA", "--boot-wait-ms", "400"], noAuto));
  // simulate a delivered window: busy + lock
  spawnSync("tmux", ["set-option", "-w", "-t", launched.windowId, "@wakeflow_state", "busy"], { encoding: "utf8" });
  const locksDir = path.join(root, ".wakeflow-local/wakeflow-delivery/locks");
  mkdirSync(locksDir, { recursive: true });
  writeFileSync(path.join(locksDir, "RepoA.json"), JSON.stringify({
    kind: "WakeflowWindowDeliveryLock", windowName: "RepoA", host: "claude-code",
    deliveryId: "dlv-active", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  }));

  const monitor = spawn(process.execPath, [helperScript, "activity-monitor", "--root", root, "--server", activeSession, "--poll-ms", "500"], { detached: true, stdio: "ignore", env: { ...process.env, WAKEFLOW_CLAUDE_BIN: path.join(root, "stub-claude") } });
  monitor.unref();
  t.after(() => { try { process.kill(monitor.pid); } catch { /* gone */ } });

  const readActiveState = () => spawnSync("tmux", ["show-options", "-w", "-q", "-v", "-t", launched.windowId, "@wakeflow_state"], { encoding: "utf8" }).stdout.trim();
  {
    const deadline = Date.now() + 12000;
    while (readActiveState() !== "running" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert.equal(readActiveState(), "running", "content change lights the running badge");
});

test("send to the controller window is a lock-free notification (no busy residue)", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  const serverSession = makeServerSession();
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "CtrlFlow", controllerWindow: "CtrlFlow",
    hosts: { "claude-code": { tmuxSession: serverSession } },
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));
  t.after(() => killServer(serverSession));
  const noAuto = { WAKEFLOW_DISABLE_MONITOR: "1" };
  const ctrl = parseOk(runHelper(root, ["launch-window", "--server", serverSession, "--window", "CtrlFlow", "--cwd", ".", "--boot-wait-ms", "400"], noAuto));
  const prompt = path.join(root, "ret.txt");
  writeFileSync(prompt, "controller return\n");
  const sent = parseOk(runHelper(root, ["send", "--window", "CtrlFlow", "--prompt-file", prompt, "--readback-wait-ms", "200"], noAuto));
  assert.equal(sent.controllerNotification, true);
  assert.equal(sent.lockFile, undefined, "no lock file reported");
  assert.equal(existsSync(path.join(root, ".wakeflow-local/wakeflow-delivery/locks/CtrlFlow.json")), false, "no controller lock written");
  const state = spawnSync("tmux", ["show-options", "-w", "-q", "-v", "-t", ctrl.windowId, "@wakeflow_state"], { encoding: "utf8" }).stdout.trim();
  assert.equal(state, "", "no busy residue on the controller");
});

test("seed-permissions keeps committed settings portable and migrates old residue to settings.local.json", () => {
  const root = makeWorkspace();
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "SeedFlow", controllerWindow: "SeedFlow",
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));
  // simulate the OLD buggy layout: absolute workspace path + wakeflow statusLine in the COMMITTED file
  const repoSettingsDir = path.join(root, "RepoA", ".claude");
  mkdirSync(repoSettingsDir, { recursive: true });
  writeFileSync(path.join(repoSettingsDir, "settings.json"), JSON.stringify({
    statusLine: { type: "command", command: `node ${root}/.wakeflow-local/wakeflow-statusline.mjs` },
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

test("deliver sends straight from a delivery envelope file (one-step transport)", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  const serverSession = makeServerSession();
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "DeliverFlow", controllerWindow: "DeliverFlow",
    hosts: { "claude-code": { tmuxSession: serverSession } },
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));
  t.after(() => killServer(serverSession));
  const noAuto = { WAKEFLOW_DISABLE_MONITOR: "1" };
  parseOk(runHelper(root, ["launch-window", "--server", serverSession, "--window", "RepoA", "--cwd", "RepoA", "--boot-wait-ms", "400"], noAuto));

  const envelopeFile = path.join(root, "delivery.json");
  writeFileSync(envelopeFile, JSON.stringify({
    kind: "DeliveryEnvelope", deliveryId: "dlv-deliver-1", targetWindow: "RepoA",
    taskId: "T1", dispatchGroup: "G1", prompt: "Continue current window task: RepoA / T1.",
  }));
  const sent = parseOk(runHelper(root, ["deliver", "--delivery-file", "delivery.json", "--readback-wait-ms", "300"], noAuto));
  assert.equal(sent.command, "deliver");
  assert.equal(sent.deliveryId, "dlv-deliver-1");
  assert.match(sent.readback.paneTail, /RepoA \/ T1/, "prompt landed in the pane");
  const lock = JSON.parse(readFileSync(path.join(root, ".wakeflow-local/wakeflow-delivery/locks/RepoA.json"), "utf8"));
  assert.equal(lock.deliveryId, "dlv-deliver-1", "lock carries the envelope delivery id");
});

test("replace-all tears down and rebuilds the whole fleet with fresh registered sessions", { skip: !tmuxPresent }, async (t) => {
  const root = makeWorkspace();
  const serverSession = makeServerSession();
  const noAuto = { WAKEFLOW_DISABLE_MONITOR: "1" };
  // scaffold a real initialized workspace so replace-windows registration works
  const init = runSync(process.execPath, [setupScript, "initialize", "--root", root, "--repo", "RepoA=./RepoA", "--internal-design", "--internal-test", "--write", "--json"], { encoding: "utf8", cwd: root });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const cfg = JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8"));
  const controllerWindow = cfg.controllerWindow;
  t.after(() => spawnSync("tmux", ["kill-session", "-t", serverSession], { encoding: "utf8" }));

  const out = parseOk(runHelper(root, ["replace-all", "--server", serverSession, "--boot-wait-ms", "600"], noAuto));
  assert.equal(out.command, "replace-all");
  assert.equal(out.scope, "all-configured");
  assert.ok(out.results.length >= 3, "replaces Design, controller, RepoA, Test");
  for (const r of out.results) {
    assert.equal(r.status, "replaced", `${r.window} replaced (${r.error ?? ""})`);
    assert.equal(r.sessionIdRegistered, true, `${r.window} new session id registered`);
  }
  // the controller's registry now holds a freshly written session id
  const registryFile = path.join(root, ".wakeflow-local/wakeflow-delivery/hosts/claude-code/thread-registry", `${controllerWindow.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`);
  assert.equal(existsSync(registryFile), true);
  const reg = JSON.parse(readFileSync(registryFile, "utf8"));
  assert.ok(reg.threadId && reg.threadId.length > 8, "registry carries a real session id");

  // a named subset replaces only those
  const subset = parseOk(runHelper(root, ["replace-all", "--server", serverSession, "--window", "RepoA", "--boot-wait-ms", "600"], noAuto));
  assert.deepEqual(subset.scope, ["RepoA"]);
  assert.equal(subset.results.length, 1);
  assert.equal(subset.results[0].window, "RepoA");
});

test("send refuses when no binding exists and lock release stays idempotent", () => {
  const root = makeWorkspace();
  const promptFile = path.join(root, "p.txt");
  writeFileSync(promptFile, "x\n");
  const missing = runHelper(root, ["send", "--window", "Ghost", "--prompt-file", promptFile]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr + missing.stdout, /No window-host binding/);

  // Lock release is owned by the delivery runtime (MCP wakeflow_release_window_lock);
  // the host helper no longer duplicates it.
  const deliveryScript = path.resolve(path.dirname(helperScript), "../wakeflow-delivery.mjs");
  const released = runSync(process.execPath, [deliveryScript, "release-window-lock", "--window", "Ghost", "--root", root, "--write", "--json"], { encoding: "utf8", cwd: root });
  assert.equal(released.status, 0, released.stderr || released.stdout);
});
