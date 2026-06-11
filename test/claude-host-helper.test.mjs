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

  const lockedSend = runHelper(root, ["send", "--window", "RepoA", "--prompt-file", deliveryPrompt]);
  assert.notEqual(lockedSend.status, 0);
  assert.match(lockedSend.stderr + lockedSend.stdout, /in-flight delivery lock/);

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
  }));
  const ready = parseOk(runHelper(root, ["wait-results", "--group", "grp-1", "--target", "RepoA", "--timeout-sec", "5", "--poll-ms", "250"]));
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.windows, ["RepoA"]);
  assert.ok(!existsSync(path.join(root, sent.lockFile)), "wait-results must release the delivered window lock");

  const attach = parseOk(runHelper(root, ["attach-window", "--window", "RepoA"]));
  assert.match(attach.attach, new RegExp(serverSession));
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
