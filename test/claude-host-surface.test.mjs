import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import * as codexAdapter from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-send-adapter.mjs";
import * as claudeAdapter from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-send-adapter.mjs";
import {
  adapterForDeliveryMode,
  claudeDesktopSessionAdapter,
  claudeHeadlessResumeAdapter,
  claudeSessionAutoAdapter,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-send-adapter.mjs";

const claudePluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/claude-code-wakeflow");

function shapeOf(value) {
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function assertSameShape(reference, candidate, trail = "hostProfile") {
  for (const [key, refValue] of Object.entries(reference)) {
    const at = `${trail}.${key}`;
    assert.ok(key in candidate, `${at} is missing from the claude host profile`);
    const candidateValue = candidate[key];
    assert.equal(shapeOf(candidateValue), shapeOf(refValue), `${at} must have shape ${shapeOf(refValue)}`);
    if (shapeOf(refValue) === "object" && refValue !== null) {
      assertSameShape(refValue, candidateValue, at);
    }
  }
}

test("claude host profile matches the codex host profile contract shape", () => {
  assertSameShape(codexProfile, claudeProfile);
});

test("claude host profile carries Claude Code semantics", () => {
  assert.equal(claudeProfile.hostId, "claude-code");
  assert.equal(claudeProfile.memoryFile, "CLAUDE.md");
  assert.equal(claudeProfile.pluginManifestPath, ".claude-plugin/plugin.json");
  assert.equal(claudeProfile.kinds.windowRegistration, "ClaudeWindowSessionRegistration");
  assert.equal(claudeProfile.kinds.windowDispatchConfig, "ClaudeSubwindowDispatchConfig");
  assert.equal(claudeProfile.launch.planFlags.requiresHostTitleReset, false);
  assert.equal(claudeProfile.launch.titleReset("Window Title").required, false);
  for (const language of ["zh", "en"]) {
    const steps = claudeProfile.launch.workflowSteps(language).join("\n");
    assert.match(steps, /claude -p/, `launch workflow (${language}) must explain headless-resume`);
    assert.match(steps, /session/i, `launch workflow (${language}) must speak session vocabulary`);
  }
  assert.match(claudeProfile.texts.registeredHandle("Repo"), /Claude Code session for Repo/);
});

test("claude send adapters keep the codex adapter step contract", () => {
  const delivery = {
    file: "deliveries/example.json",
    deliveryId: "dlv-1",
    kind: "target-task",
    targetWindow: "Repo",
    taskId: "task-1",
    dispatchGroup: "group-1",
    wakeflowTrace: { traceId: "trace-1" },
  };
  const codexSteps = codexAdapter.buildHostSendResumeSteps([delivery]);
  const claudeSteps = claudeAdapter.buildHostSendResumeSteps([delivery]);
  assert.equal(claudeSteps.length, codexSteps.length);
  for (const [index, codexStep] of codexSteps.entries()) {
    assert.deepEqual(
      Object.keys(claudeSteps[index]).sort(),
      Object.keys(codexStep).sort(),
      `resume step ${index} must keep the same field contract`,
    );
  }
  assert.equal(claudeSteps[0].adapter.adapterId, "claude-session-auto");
  assert.equal(claudeSteps[1].tool, "wakeflow_record_delivery");
});

test("adapterForDeliveryMode pins desktop-session and headless-resume", () => {
  assert.equal(adapterForDeliveryMode("desktop-session"), claudeDesktopSessionAdapter);
  assert.equal(adapterForDeliveryMode("headless-resume"), claudeHeadlessResumeAdapter);
  assert.equal(adapterForDeliveryMode(undefined), claudeSessionAutoAdapter);
  assert.match(claudeHeadlessResumeAdapter.hostTool, /claude -p --resume/);
});

test("claude artifact registers a session id as the window thread registration", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "claude-wakeflow-"));
  mkdirSync(path.join(workspaceRoot, "RepoA"), { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, "workspace.config.json"),
    JSON.stringify({
      workspaceName: "ClaudeFlow",
      controllerWindow: "ClaudeFlow",
      repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
    }),
  );
  const deliveryScript = path.join(claudePluginRoot, "scripts/wakeflow-delivery.mjs");
  const result = runSync(
    process.execPath,
    [
      deliveryScript,
      "register-thread",
      "--root",
      workspaceRoot,
      "--window",
      "RepoA",
      "--thread-id",
      "a1b2c3d4-5678-90ab-cdef-claude-session",
      "--write",
      "--json",
    ],
    { encoding: "utf8", cwd: workspaceRoot },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.threadRegistered, true);
  assert.equal(payload.windowName, "RepoA");

  const registryFile = path.join(workspaceRoot, payload.registryFile);
  const registration = JSON.parse(readFileSync(registryFile, "utf8"));
  assert.equal(registration.kind, "ClaudeWindowSessionRegistration");
  assert.equal(registration.windowName, "RepoA");
  assert.equal(registration.threadId, "a1b2c3d4-5678-90ab-cdef-claude-session");
});

test("claude artifact rejects placeholder session ids", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "claude-wakeflow-"));
  const deliveryScript = path.join(claudePluginRoot, "scripts/wakeflow-delivery.mjs");
  const result = runSync(
    process.execPath,
    [deliveryScript, "register-thread", "--root", workspaceRoot, "--window", "RepoA", "--thread-id", "current-claude-session", "--write", "--json"],
    { encoding: "utf8", cwd: workspaceRoot },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /real Claude Code session id/);
});
