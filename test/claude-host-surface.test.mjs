import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import {
  handlers as claudeMcpHandlers,
  tools as claudeMcpTools,
} from "../plugins/claude-code-wakeflow/lib/wakeflow-mcp-tools.mjs";
import {
  handlers as codexMcpHandlers,
  tools as codexMcpTools,
} from "../plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs";
import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import * as codexAdapter from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-send-adapter.mjs";
import * as claudeAdapter from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-send-adapter.mjs";
import {
  adapterForWindowMode,
  claudeHeadlessRecoveryAdapter,
  claudeTmuxResidentAdapter,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-send-adapter.mjs";

const claudePluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/claude-code-wakeflow");

function shapeOf(value) {
  if (Array.isArray(value)) return "array";
  return typeof value;
}

const HOST_SPECIFIC_CONTRACT_PATHS = new Set([
  "hostProfile.launch.thinkingByRole",
  "hostProfile.launch.planFlags.includesHostCreateThreadSettings",
]);

function assertSameShape(reference, candidate, trail = "hostProfile") {
  for (const [key, refValue] of Object.entries(reference)) {
    const at = `${trail}.${key}`;
    if (HOST_SPECIFIC_CONTRACT_PATHS.has(at)) continue;
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

test("both hosts expose the same consolidated 31-tool MCP surface", () => {
  const codexNames = codexMcpTools.map((tool) => tool.name);
  const claudeNames = claudeMcpTools.map((tool) => tool.name);
  assert.equal(codexNames.length, 31);
  assert.deepEqual(claudeNames, codexNames);
  assert.deepEqual([...codexNames].sort(), [
    "wakeflow_add_task",
    "wakeflow_adopt_demand_host",
    "wakeflow_archive",
    "wakeflow_cancel_demand",
    "wakeflow_claim_next",
    "wakeflow_complete_demand",
    "wakeflow_continue_demand",
    "wakeflow_create_demand",
    "wakeflow_decide_review",
    "wakeflow_deliver",
    "wakeflow_initialize_workspace",
    "wakeflow_intake_test_card",
    "wakeflow_next_work",
    "wakeflow_pod_bind",
    "wakeflow_pod_open",
    "wakeflow_pod_plan",
    "wakeflow_pod_record",
    "wakeflow_prepare_delivery",
    "wakeflow_prune_runtime",
    "wakeflow_record_delivery",
    "wakeflow_record_target_result",
    "wakeflow_recover_state_transition",
    "wakeflow_reduce_results",
    "wakeflow_register_window",
    "wakeflow_release_window_lock",
    "wakeflow_replace_windows",
    "wakeflow_review_pack",
    "wakeflow_status",
    "wakeflow_storage_preserve",
    "wakeflow_verify",
    "wakeflow_view",
  ]);
  for (const current of [
    "wakeflow_review_pack",
    "wakeflow_pod_open",
    "wakeflow_pod_bind",
    "wakeflow_pod_plan",
    "wakeflow_pod_record",
  ]) {
    assert.ok(codexNames.includes(current), `${current} remains public`);
  }
  for (const retired of [
    "wakeflow_render_progress",
    "wakeflow_sanitize_archive",
    "wakeflow_pod_record_materialization",
    "wakeflow_pod_prepare_design_request",
    "wakeflow_pod_record_design_handoff",
    "wakeflow_pod_prepare_test_access",
    "wakeflow_pod_record_test_access",
    "wakeflow_pod_close",
    "wakeflow_pod_record_close_receipt",
    "wakeflow_pod_list",
  ]) {
    assert.equal(codexNames.includes(retired), false, `${retired} is hidden on Codex`);
    assert.equal(claudeNames.includes(retired), false, `${retired} is hidden on Claude`);
    assert.equal(typeof codexMcpHandlers[retired], "function", `${retired} keeps Codex compatibility`);
    assert.equal(typeof claudeMcpHandlers[retired], "function", `${retired} keeps Claude compatibility`);
  }
});

test("claude host profile carries terminal-only Claude Code semantics", () => {
  assert.equal(claudeProfile.hostId, "claude-code");
  assert.equal(claudeProfile.memoryFile, "CLAUDE.md");
  assert.equal(claudeProfile.pluginManifestPath, ".claude-plugin/plugin.json");
  assert.equal(claudeProfile.runtime.hostDirName, "claude-code");
  assert.equal(claudeProfile.runtime.legacyRegistryFallback, false);
  assert.equal(codexProfile.runtime.hostDirName, "codex");
  assert.equal(codexProfile.runtime.legacyRegistryFallback, true);
  assert.equal(claudeProfile.kinds.windowRegistration, "ClaudeWindowSessionRegistration");
  assert.equal(claudeProfile.kinds.windowDispatchConfig, "ClaudeSubwindowDispatchConfig");
  assert.equal(claudeProfile.handleId.launchResultField, "hostLaunch.sessionId");
  assert.equal(claudeProfile.handleId.launchResultPlaceholder, "<hostLaunch.sessionId>");
  assert.equal(claudeProfile.launch.planFlags.requiresHostTitleReset, true);
  assert.equal(claudeProfile.launch.titleReset("Window Title").required, true);
  assert.match(claudeProfile.launch.titleReset("Window Title").hostTool, /retitle/);
  for (const language of ["zh", "en"]) {
    const steps = claudeProfile.launch.workflowSteps(language).join("\n");
    assert.match(steps, /tmux/, `launch workflow (${language}) must describe the tmux-resident flow`);
    assert.match(steps, /preflight/, `launch workflow (${language}) must run preflight first`);
    assert.match(steps, /launch-window/, `launch workflow (${language}) must use the host helper`);
    assert.match(steps, /wakeflow_register_window/, `launch workflow (${language}) must use the public registration tool`);
    assert.match(steps, /hostLaunch\.sessionId/, `launch workflow (${language}) must identify the real host handle source`);
  }
  assert.match(claudeProfile.texts.registeredHandle("Repo"), /Claude Code session for Repo/);
  assert.match(claudeProfile.hostTools.sendToWindow, /wakeflow-claude-host deliver/);
});

test("host entryExtras emit host-specific launch specs", () => {
  const entry = {
    windowName: "RepoA",
    deliveryRole: "product",
    displayTitle: "RepoA Work",
    cwd: "/tmp/repo-a",
    createThreadPrompt: "entry sync",
  };
  const codexExtras = codexProfile.launch.entryExtras(entry, { config: {} });
  assert.equal(codexExtras.hostCreateThread.required, true);
  assert.equal(codexExtras.hostCreateThread.hostTool, "create_thread");
  assert.equal(codexExtras.hostCreateThread.promptField, "createThreadPrompt");
  assert.equal(codexExtras.hostCreateThread.thinking, "xhigh");
  assert.equal(codexExtras.hostCreateThread.model, null);
  assert.match(codexExtras.hostCreateThread.modelPolicy, /inherit the current Codex model/);

  const extras = claudeProfile.launch.entryExtras(entry);
  assert.equal(extras.windowMode, "tmux-resident");
  assert.ok(existsSync(extras.hostLaunch.helper), "host helper path must exist in the artifact");
  const launchArgv = extras.hostLaunch.launchArgv.join(" ");
  assert.match(launchArgv, /launch-window/);
  assert.match(launchArgv, /--window RepoA/);
  assert.match(launchArgv, /--title RepoA Work/);
  assert.match(launchArgv, /--cwd \/tmp\/repo-a/);
  assert.match(extras.hostLaunch.sendArgv.join(" "), /send/);
  assert.match(extras.hostLaunch.sendArgv.join(" "), /--delivery-id <delivery envelope id>/);
  assert.match(extras.hostLaunch.recovery, /--resume/);
});

test("Claude Pod entryExtras use native host worktrees and keep resume/local roles distinct", () => {
  const workspaceRoot = "/tmp/wakeflow-host-profile";
  const stateRoot = "/tmp/wakeflow-host-profile/.wakeflow-active/current/pod-a";
  const product = claudeProfile.pod.entryExtras({
    demandKey: "pod-a",
    podId: "pod-a",
    windowName: "RepoA__pod-a",
    role: "product",
    repositoryWindow: "RepoA",
    repositoryRoot: "/tmp/repo-a",
    host: "claude-code",
    environmentIntent: "host-worktree",
    basePolicy: "head",
    expectedBaseHead: "a".repeat(40),
    displayTitle: "RepoA Pod",
    createPrompt: "entry sync",
    launchCorrelationId: "corr-pod-a-repo-a",
    registrationBindingId: "binding-pod-a-repo-a",
  }, { workspaceRoot, stateRoot });
  assert.equal(product.nativeEnvironmentIntent, "host-worktree");
  assert.equal(product.hostCwd, "/tmp/repo-a");
  assert.equal(product.nativeBasePolicy, "head");
  assert.deepEqual(product.addDirectories, [stateRoot]);
  assert.equal(product.nativeArgvIntent.filter((arg) => arg === "--worktree").length, 1);
  assert.ok(product.nativeArgvIntent.includes("--settings"));
  assert.ok(!product.nativeArgvIntent.includes("--tmux"));
  const launch = product.hostLaunch.launchArgv;
  assert.ok(launch.includes("--host-worktree"));
  assert.ok(launch.includes("--repository-root"));
  const addDirIndices = launch.flatMap((arg, index) => arg === "--add-dir" ? [index] : []);
  assert.deepEqual(addDirIndices.map((index) => launch[index + 1]), [stateRoot]);
  assert.ok(!addDirIndices.some((index) => launch[index + 1] === workspaceRoot));
  assert.ok(!product.hostLaunch.resumeArgv.includes("--host-worktree"), "resume does not create another worktree");
  assert.ok(product.hostLaunch.resumeArgv.includes("--resume"));
  assert.equal(product.hostLaunch.receiptContract.handleRedacted, true);
  assert.equal(product.hostLaunch.receiptContract.handleKind, "final");

  for (const role of ["controller", "design", "test"]) {
    const local = claudeProfile.pod.entryExtras({
      demandKey: "pod-a",
      podId: "pod-a",
      windowName: `${role}__pod-a`,
      role,
      repositoryRoot: null,
      host: "claude-code",
      environmentIntent: "host-local",
      basePolicy: "local",
      displayTitle: `${role} Pod`,
      createPrompt: "entry sync",
      launchCorrelationId: `corr-pod-a-${role}`,
      registrationBindingId: `binding-pod-a-${role}`,
    }, { workspaceRoot, stateRoot });
    assert.equal(local.nativeEnvironmentIntent, "host-local");
    assert.equal(local.hostWorktreeName, null);
    assert.ok(!local.hostLaunch.launchArgv.includes("--host-worktree"));
    assert.ok(!local.nativeArgvIntent.includes("--worktree"));
  }
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
  assert.equal(claudeSteps[0].adapter.adapterId, "claude-tmux-resident");
  assert.match(claudeSteps[0].hostTool, /deliver --root <workspace-root> --delivery-file/);
  assert.match(claudeSteps[0].instruction, /wakeflow-claude-host deliver/);
  assert.match(claudeSteps[0].instruction, /deliveries\/example\.json/);
  assert.match(claudeSteps[0].instruction, /exactly one pane observation/);
  assert.match(claudeSteps[0].instruction, /paste the prompt again/);
  assert.equal(claudeSteps[0].adapter.readbackPolicy.maxReadAttempts, 1);
  assert.equal(claudeSteps[0].adapter.readbackPolicy.observationDelayMs, 1_200);
  assert.equal(claudeSteps[0].adapter.readbackPolicy.maxWaitMs, 5_000);
  assert.equal(claudeSteps[0].adapter.readbackPolicy.resendOnRetry, false);
  assert.equal(claudeSteps[1].tool, "wakeflow_record_delivery");
  assert.equal(
    Object.hasOwn(claudeSteps[1].arguments, "readbackOk"),
    false,
    "the adapter must record the helper's real observation instead of hard-coding readback success",
  );
  assert.deepEqual(claudeSteps[1].arguments, {
    deliveryFile: "deliveries/example.json",
  });
  assert.match(claudeSteps[1].after, /explicit transportStatus/);
  assert.match(claudeSteps[1].after, /sent-unconfirmed/);
  assert.match(claudeSteps[1].after, /preserve the lease/);
});

test("adapterForWindowMode pins tmux-resident with headless recovery", () => {
  assert.equal(adapterForWindowMode("tmux-resident"), claudeTmuxResidentAdapter);
  assert.equal(adapterForWindowMode(undefined), claudeTmuxResidentAdapter);
  assert.equal(adapterForWindowMode("headless-recovery"), claudeHeadlessRecoveryAdapter);
  assert.match(claudeHeadlessRecoveryAdapter.hostTool, /claude -p --resume/);
  assert.match(claudeHeadlessRecoveryAdapter.hostTool, /baseline-only last resort/);
  assert.match(claudeHeadlessRecoveryAdapter.hostTool, /never use for a Pod window/);
});

test("claude artifact registers a session id under the host-scoped registry", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "claude-wakeflow-"));
  mkdirSync(path.join(workspaceRoot, "RepoA"), { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
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
  assert.match(payload.registryFile, /hosts\/claude-code\/thread-registry\//);

  const registryFile = path.join(workspaceRoot, payload.registryFile);
  const registration = JSON.parse(readFileSync(registryFile, "utf8"));
  assert.equal(registration.kind, "ClaudeWindowSessionRegistration");
  assert.equal(registration.windowName, "RepoA");
  assert.equal(registration.threadId, "a1b2c3d4-5678-90ab-cdef-claude-session");
});

test("claude MCP surface registers and redacts a hostLaunch session id", async () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "claude-wakeflow-mcp-"));
  mkdirSync(path.join(workspaceRoot, "RepoA"), { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    JSON.stringify({
      workspaceName: "ClaudeFlow",
      controllerWindow: "ClaudeFlow",
      repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
    }),
  );
  const sessionId = "a1b2c3d4-5678-90ab-cdef-claude-mcp-session";
  assert.ok(claudeMcpTools.some((tool) => tool.name === "wakeflow_register_window"));

  const result = await claudeMcpHandlers.wakeflow_register_window({
    root: workspaceRoot,
    window: "RepoA",
    windowHandle: sessionId,
    apply: true,
  });
  assert.equal(result.ok, true, result.stderr || result.stdout);
  assert.equal(result.parsedJson.threadRegistered, true);
  assert.equal(result.parsedJson.windowConfigWritten, true);
  assert.match(result.parsedJson.registryFile, /hosts\/claude-code\/thread-registry\//);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(sessionId));

  const registration = JSON.parse(readFileSync(path.join(workspaceRoot, result.parsedJson.registryFile), "utf8"));
  assert.equal(registration.kind, "ClaudeWindowSessionRegistration");
  assert.equal(registration.threadId, sessionId);
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
