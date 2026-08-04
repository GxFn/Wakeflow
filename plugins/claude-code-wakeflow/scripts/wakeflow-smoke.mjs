#!/usr/bin/env node

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnProcess } from "../lib/wakeflow-process.mjs";
import { runWakeflowRuntime } from "../lib/wakeflow-runtime.mjs";

const root = mkdtempSync(path.join(tmpdir(), "wakeflow-smoke-"));
const targetRoot = path.join(root, "Target");
mkdirSync(targetRoot, { recursive: true });
writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify({
  workspaceName: "Wakeflow Smoke",
  controllerWindow: "Wakeflow",
  designWindow: "Design",
  testWindow: "Test",
  activeLedgerRoot: ".wakeflow-active",
  workspaceCurrentDir: ".wakeflow-active/current",
  projectLedgerRoot: "wakeflow-ledger",
  repositories: [
    {
      windowName: "Target",
      path: "Target",
      role: "Smoke target",
      managedAgents: false,
      mode: "internal",
    },
  ],
}, null, 2)}\n`);

assertOk(await runWakeflowRuntime({
  script: "wakeflow-delivery",
  args: [
    "register-thread",
    "--root", root,
    "--window", "Target",
    "--thread-id", "wakeflow-smoke-target-session",
    "--write",
    "--json",
  ],
}), "wakeflow-delivery register-thread");

const init = await runWakeflowRuntime({
  script: "wakeflow-state",
  args: [
    "init",
    "--root", root,
    "--demand-key", "smoke",
    "--title", "Smoke",
    "--goal", "Check Wakeflow full controller runtime.",
    "--completion-definition", "Review reaches review-ready after a target result.",
    "--stage-plan", "Initialize, add a task package, prepare delivery, import result, reduce review.",
    "--write",
    "--json",
  ],
});
assertOk(init, "wakeflow-state init");
const stateRoot = init.parsedJson?.stateRoot;
if (!stateRoot) throw new Error("wakeflow-state init did not return a stateRoot");

assertOk(await runWakeflowRuntime({
  script: "wakeflow-state",
  args: [
    "add-task-package",
    "--root", root,
    "--state-root", stateRoot,
    "--task-package-id", "SMOKE-P1",
    "--summary", "Check full delivery intent generation.",
    "--target-window", "Target",
    "--target-task-id", "SMOKE-T1",
    "--target-summary", "Return smoke evidence.",
    "--write",
    "--json",
  ],
}), "wakeflow-state add-task-package");

const delivery = await runWakeflowRuntime({
  script: "wakeflow-delivery",
  args: [
    "prepare-dispatch-from-state",
    "--root", root,
    "--state-root", stateRoot,
    "--target-task-id", "SMOKE-T1",
    "--group", "SMOKE-G1",
    "--write",
    "--json",
  ],
});
assertOk(delivery, "wakeflow-delivery prepare-dispatch-from-state");
if (!delivery.parsedJson?.envelope?.prompt?.includes("SMOKE-T1")) {
  throw new Error("delivery envelope prompt did not include the target task id");
}

assertOk(await runWakeflowRuntime({
  script: "wakeflow-state",
  args: [
    "import-target-result",
    "--root", root,
    "--state-root", stateRoot,
    "--target-task-id", "SMOKE-T1",
    "--target-window", "Target",
    "--status", "completed",
    "--summary", "Smoke result.",
    "--evidence-ref", "smoke:evidence",
    "--write",
    "--json",
  ],
}), "wakeflow-state import-target-result");

const reviewed = await runWakeflowRuntime({
  script: "wakeflow-state",
  args: ["reduce-results", "--root", root, "--state-root", stateRoot, "--write", "--json"],
});
assertOk(reviewed, "wakeflow-state reduce-results");
if (reviewed.parsedJson?.nextState !== "review-ready" && reviewed.parsedJson?.review?.status !== "ready") {
  throw new Error("review reduction did not reach review-ready");
}

const controlStatus = await runWakeflowRuntime({
  script: "wakeflow-cli",
  args: ["--print", "status"],
  timeoutMs: 30000,
});
if (!controlStatus.ok || !controlStatus.stdout.includes("wakeflow-repo-status.mjs")) {
  throw new Error("embedded runtime did not print status route");
}

const mcpRoot = mkdtempSync(path.join(tmpdir(), "wakeflow-mcp-smoke-"));
const mcpSmoke = await runMcpSmoke(mcpRoot);

console.log(JSON.stringify({ ok: true, root, stateRoot, wakeflowRuntime: "ok", mcpRoot, mcp: mcpSmoke }, null, 2));

function assertOk(result, label) {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  }
}

async function runMcpSmoke(rootPath) {
  const mcpConfig = JSON.parse(readFileSync(".mcp.json", "utf8"));
  const server = mcpConfig.mcpServers?.wakeflow;
  if (!server) throw new Error("Wakeflow MCP config is missing mcpServers.wakeflow");
  const cwd = server.cwd === "." ? process.cwd() : path.resolve(process.cwd(), server.cwd ?? ".");
  const variables = {
    CLAUDE_PLUGIN_ROOT: process.cwd(),
    CLAUDE_PROJECT_DIR: rootPath,
  };
  const command = expandMcpValue(server.command, variables);
  const args = (server.args ?? []).map((arg) => expandMcpValue(arg, variables));
  const env = {
    ...process.env,
    ...Object.fromEntries(
      Object.entries(server.env ?? {}).map(([key, value]) => [key, expandMcpValue(value, variables)]),
    ),
  };
  const child = spawnProcess(command, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
    for (const { reject } of pending.values()) {
      reject(new Error("MCP smoke timed out"));
    }
    pending.clear();
  }, 15000);

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    drainFrames();
  });

  function writeMessage(payload) {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  function writeFramedMessage(payload) {
    const body = JSON.stringify(payload);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  function notify(method, params = undefined) {
    const payload = { jsonrpc: "2.0", method };
    if (params !== undefined) payload.params = params;
    writeMessage(payload);
  }

  function request(method, params = undefined) {
    const id = nextId;
    nextId += 1;
    const payload = { jsonrpc: "2.0", id, method };
    if (params !== undefined) payload.params = params;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      writeMessage(payload);
    });
  }

  function rawRequest(payload, { framed = false } = {}) {
    return new Promise((resolve, reject) => {
      pending.set(payload.id, { resolve, reject });
      if (framed) writeFramedMessage(payload);
      else writeMessage(payload);
    });
  }

  function requestError(payload) {
    return new Promise((resolve, reject) => {
      pending.set(payload.id, {
        resolveErrors: true,
        resolve: (message) => {
          if (!message.error) {
            reject(new Error(`Expected JSON-RPC error for ${payload.method || "raw request"}`));
            return;
          }
          resolve(message.error);
        },
        reject,
      });
      writeMessage(payload);
    });
  }

  function drainFrames() {
    while (buffer.length > 0) {
      if (buffer.toString("utf8", 0, Math.min(buffer.length, 15)).startsWith("Content-Length:")) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = buffer.toString("utf8", 0, headerEnd);
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) throw new Error("Invalid MCP frame header");
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + length) return;
        const body = buffer.toString("utf8", bodyStart, bodyStart + length);
        buffer = buffer.slice(bodyStart + length);
        resolveMessage(JSON.parse(body));
        continue;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.toString("utf8", 0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) resolveMessage(JSON.parse(line));
    }
  }

  function resolveMessage(message) {
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      if (message.error && !waiter.resolveErrors) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message);
    }
  }

  try {
    const initializedServer = await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "wakeflow-smoke", version: "0.0.0" },
    });
    if (initializedServer.result.protocolVersion !== "2024-11-05") {
      throw new Error("MCP initialize did not preserve a supported protocol version");
    }
    notify("notifications/initialized");
    const pong = await request("ping");
    if (!pong.result || Object.keys(pong.result).length !== 0) {
      throw new Error("MCP ping did not return an empty result");
    }
    const unsupportedVersion = await request("initialize", {
      protocolVersion: "2099-01-01",
      capabilities: {},
      clientInfo: { name: "wakeflow-smoke", version: "0.0.0" },
    });
    if (unsupportedVersion.result.protocolVersion !== "2025-03-26") {
      throw new Error("MCP initialize did not negotiate unsupported protocol versions to the default");
    }
    const unknown = await requestError({ jsonrpc: "2.0", id: nextId++, method: "wakeflow/unknown" });
    if (unknown.code !== -32601) {
      throw new Error("MCP unknown request did not return MethodNotFound");
    }
    const invalidParams = await requestError({ jsonrpc: "2.0", id: nextId++, method: "tools/list", params: "bad" });
    if (invalidParams.code !== -32602) {
      throw new Error("MCP non-object params did not return InvalidParams");
    }
    const listed = await rawRequest({ jsonrpc: "2.0", id: nextId++, method: "tools/list" }, { framed: true });
    const tools = listed.result.tools;
    assertToolSchemasAcceptedByHost(tools);
    assertToolAnnotationsAcceptedByHost(tools);
    const toolNames = tools.map((tool) => tool.name);
    for (const expected of [
      "wakeflow_initialize_workspace",
      "wakeflow_replace_windows",
      "wakeflow_register_window",
      "wakeflow_status",
      "wakeflow_prepare_delivery",
      "wakeflow_record_delivery",
      "wakeflow_record_target_result",
      "wakeflow_review_pack",
      "wakeflow_view",
      "wakeflow_storage_preserve",
      "wakeflow_reduce_results",
      "wakeflow_decide_review",
      "wakeflow_complete_demand",
      "wakeflow_continue_demand",
      "wakeflow_archive",
      "wakeflow_pod_open",
      "wakeflow_pod_bind",
      "wakeflow_pod_plan",
      "wakeflow_pod_record",
      "wakeflow_verify",
    ]) {
      if (!toolNames.includes(expected)) {
        throw new Error(`MCP tools/list missing ${expected}`);
      }
    }
    if (toolNames.length !== 31) {
      throw new Error(`MCP tools/list expected 31 public tools, found ${toolNames.length}`);
    }
    for (const retired of [
      "wakeflow_render_progress",
      "wakeflow_pod_list",
      "wakeflow_sanitize_archive",
      "wakeflow_pod_prepare_design_request",
      "wakeflow_pod_prepare_test_access",
      "wakeflow_pod_close",
      "wakeflow_pod_record_materialization",
      "wakeflow_pod_record_design_handoff",
      "wakeflow_pod_record_test_access",
      "wakeflow_pod_record_close_receipt",
    ]) {
      if (toolNames.includes(retired)) {
        throw new Error(`MCP tools/list exposes retired tool ${retired}`);
      }
    }
    const hostVisiblePrefix = toolNames.slice(0, 14);
    for (const expected of [
      "wakeflow_review_pack",
      "wakeflow_reduce_results",
      "wakeflow_decide_review",
      "wakeflow_complete_demand",
      "wakeflow_continue_demand",
    ]) {
      if (!hostVisiblePrefix.includes(expected)) {
        throw new Error(`MCP host-visible tool prefix missing ${expected}`);
      }
    }
    for (const internal of [
      "wakeflow_discover_workspace",
      "wakeflow_access_profiles",
      "wakeflow_sync_agents",
      "wakeflow_review",
      "wakeflow_build_controller_return",
      "wakeflow_stop_loop",
      "wakeflow_keep_live_state",
      "wakeflow_run_backend",
      "wakeflow_full_status",
      "wakeflow_full_verify",
    ]) {
      if (toolNames.includes(internal)) {
        throw new Error(`MCP tools/list exposes internal tool ${internal}`);
      }
    }
    const initializeTool = tools.find((tool) => tool.name === "wakeflow_initialize_workspace");
    const deliveryTool = tools.find((tool) => tool.name === "wakeflow_prepare_delivery");
    const initializeSchema = JSON.stringify(initializeTool.inputSchema);
    const deliverySchema = JSON.stringify(deliveryTool.inputSchema);
    if (initializeSchema.includes("threadId") || initializeSchema.includes("\"threads\"")) {
      throw new Error("wakeflow_initialize_workspace schema exposes thread id fields");
    }
    if (initializeSchema.includes("replaceWindows")) {
      throw new Error("wakeflow_initialize_workspace schema exposes replacement-window input");
    }
    if (deliverySchema.includes("requireThread")) {
      throw new Error("wakeflow_prepare_delivery schema exposes requireThread");
    }
    if (!deliverySchema.includes("controller-return")) {
      throw new Error("wakeflow_prepare_delivery schema must cover controller-return direction");
    }

    const initialized = await request("tools/call", {
      name: "wakeflow_initialize_workspace",
      arguments: {
        root: rootPath,
        parent: rootPath,
      },
    });
    const initializedText = initialized.result.content?.[0]?.text;
    const initializedPayload = JSON.parse(initializedText);
    if (
      !initializedPayload.ok
      || initializedPayload.parsedJson?.command !== "initialize"
      || initializedPayload.parsedJson?.mode !== "discovery"
      || initializedPayload.parsedJson?.wrote !== false
    ) {
      throw new Error("MCP wakeflow_initialize_workspace did not return a dry-run discovery plan");
    }
    writeFileSync(
      path.join(rootPath, "wakeflow.config.json"),
      `${JSON.stringify({
        workspaceName: "MCP Smoke",
        controllerWindow: "Controller",
        designWindow: "Design",
        testWindow: "Test",
        repositories: [
          { windowName: "Controller", path: ".", role: "controller" },
          { windowName: "Design", path: ".", role: "design" },
          { windowName: "Test", path: ".", role: "test" },
          { windowName: "Target", path: ".", role: "product" },
        ],
      }, null, 2)}\n`,
    );
    writeFileSync(path.join(rootPath, "AGENTS.md"), "# MCP Smoke Workspace\n");
    const smokeWindowHandles = {
      Controller: "10000000-0000-4000-8000-000000000001",
      Design: "10000000-0000-4000-8000-000000000002",
      Test: "10000000-0000-4000-8000-000000000003",
      Target: "10000000-0000-4000-8000-000000000004",
    };
    for (const [window, windowHandle] of Object.entries(smokeWindowHandles)) {
      const registered = await request("tools/call", {
        name: "wakeflow_register_window",
        arguments: {
          root: rootPath,
          window,
          windowHandle,
          apply: true,
        },
      });
      const registeredPayload = JSON.parse(registered.result.content?.[0]?.text);
      if (!registeredPayload.ok || registeredPayload.parsedJson?.threadRegistered !== true) {
        throw new Error(`MCP wakeflow_register_window did not register ${window}`);
      }
    }

    const called = await request("tools/call", {
      name: "wakeflow_create_demand",
      arguments: {
        root: rootPath,
        demandKey: "mcp-smoke",
        title: "MCP Smoke",
        demandType: "bug",
        goal: "Verify Wakeflow MCP tools/call.",
        completionDefinition: "MCP call creates a state root through the capability interface.",
        stagePlan: "Call wakeflow_create_demand.",
        apply: true,
      },
    });
    const text = called.result.content?.[0]?.text;
    const payload = JSON.parse(text);
    if (!payload.ok || !payload.parsedJson?.created?.stateRoot) {
      throw new Error("MCP tools/call did not create a state root");
    }
    const mcpStateRoot = payload.parsedJson.created.stateRoot;
    writeFileSync(
      path.join(rootPath, "mcp-smoke-requirement.md"),
      "# MCP Smoke Requirement\n\n## Goal\n\nExercise the target delivery surface.\n\n## Completion\n\nThe MCP delivery envelope is created from a reviewed preview.\n\n## Reproduction\n\nThe MCP smoke creates a typed draft and freezes its authority with the first implementation package.\n\n## Scope\n\nOnly the synthetic MCP smoke workspace and target delivery path are in scope.\n\n## Non-goals\n\nNo product implementation or external repository is in scope.\n",
    );

    const mcpSmokeDemandAuthority = {
      schemaVersion: 1,
      artifactKind: "wakeflow-demand-authority",
      demandKey: "mcp-smoke",
      demandType: "bug",
      entryMode: "controller-inline",
      authorityRefs: ["reproduction", "scope", "non-goals"].map((role) => ({
        role,
        ref: `mcp-smoke-requirement.md#${role}`,
      })),
      testDecision: {
        mode: "controller-only",
        summary: "The controller independently reproduces the MCP target delivery smoke path.",
      },
    };

    const addedTask = await request("tools/call", {
      name: "wakeflow_add_task",
      arguments: {
        root: rootPath,
        stateRoot: mcpStateRoot,
        taskId: "mcp-smoke-task",
        targetWindow: "Target",
        summary: "MCP smoke task package.",
        targetSummary: "Return MCP smoke evidence.",
        demandAuthority: mcpSmokeDemandAuthority,
        workType: "implementation",
        objective: "Return evidence from the MCP smoke target without widening scope.",
        contextSummary: ["This package exercises the installed MCP target-delivery path."],
        requirementRefs: [
          { ref: "mcp-smoke-requirement.md#goal", role: "goal" },
          { ref: "mcp-smoke-requirement.md#completion", role: "completion" },
        ],
        boundaries: {
          inScope: ["MCP smoke target delivery."],
          outOfScope: ["Product implementation."],
          forbidden: ["Do not create unrelated work."],
        },
        completionExpectations: ["The target delivery envelope is created from the package."],
        dependsOnTaskIds: [],
        commitExpectation: "leave-uncommitted",
        acceptanceAnchors: [{
          id: "AC-MCP-SMOKE-1",
          claim: "The MCP surface prepares a target delivery from package context.",
          probe: "Preview and apply the same target delivery.",
          expected: "The applied envelope prompt equals the reviewed preview prompt.",
        }],
      },
    });
    const addedTaskPayload = JSON.parse(addedTask.result.content?.[0]?.text);
    if (!addedTaskPayload.ok || addedTaskPayload.parsedJson?.command !== "add-task-package") {
      throw new Error("MCP wakeflow_add_task did not create a task package");
    }

    const previewed = await request("tools/call", {
      name: "wakeflow_prepare_delivery",
      arguments: {
        root: rootPath,
        direction: "target",
        stateRoot: mcpStateRoot,
        taskId: "mcp-smoke-task",
        dispatchGroup: "mcp-smoke-group",
      },
    });
    const previewedPayload = JSON.parse(previewed.result.content?.[0]?.text);
    const previewedJson = previewedPayload.parsedJson;
    if (
      !previewedPayload.ok
      || previewedJson?.command !== "prepare-dispatch-from-state"
      || previewedJson?.preview !== true
      || !previewedJson?.readiness?.taskPackageDigest
      || previewedJson?.deliveryFile
    ) {
      throw new Error("MCP wakeflow_prepare_delivery did not return a non-writing target preview");
    }
    const prepared = await request("tools/call", {
      name: "wakeflow_prepare_delivery",
      arguments: {
        root: rootPath,
        direction: "target",
        stateRoot: mcpStateRoot,
        taskId: "mcp-smoke-task",
        dispatchGroup: "mcp-smoke-group",
        expectedPreviewDigest: previewedJson.previewDigest,
        apply: true,
      },
    });
    const preparedPayload = JSON.parse(prepared.result.content?.[0]?.text);
    // MCP payloads are compact by default: the prompt is still present, the
    // full envelope lives on disk at deliveryFile.
    const preparedJson = preparedPayload.parsedJson;
    const preparedPrompt = preparedJson?.prompt ?? preparedJson?.envelope?.prompt;
    if (
      !preparedPayload.ok
      || preparedJson?.command !== "prepare-dispatch-from-state"
      || preparedJson?.preview !== false
      || !preparedPrompt?.includes("mcp-smoke-task")
      || !preparedJson?.deliveryFile
      || preparedPrompt !== (previewedJson?.prompt ?? previewedJson?.packet?.prompt)
    ) {
      throw new Error("MCP wakeflow_prepare_delivery did not create a target delivery envelope");
    }

    const mcpSmokeEvidenceRef = "target-results/mcp-smoke.md";
    const mcpSmokeEvidenceFile = path.join(rootPath, mcpStateRoot, mcpSmokeEvidenceRef);
    mkdirSync(path.dirname(mcpSmokeEvidenceFile), { recursive: true });
    writeFileSync(mcpSmokeEvidenceFile, "mcp smoke evidence\n");

    const recordedTargetResult = await request("tools/call", {
      name: "wakeflow_record_target_result",
      arguments: {
        root: rootPath,
        stateRoot: mcpStateRoot,
        targetWindow: "Target",
        taskId: "mcp-smoke-task",
        dispatchGroup: "mcp-smoke-group",
        status: "completed",
        summary: "MCP smoke target delivery matched the reviewed preview and produced review inputs.",
        commitDisposition: "no-changes",
        evidenceRefs: [mcpSmokeEvidenceRef],
        verification: ["mcp smoke target result recorded"],
        craftEvidence: [{
          kind: "acceptance-anchor",
          anchorId: "AC-MCP-SMOKE-1",
          red: "Before apply, the reviewed preview carried a stable digest and no delivery file.",
          green: "Apply used the reviewed digest and produced the same prompt in a delivery envelope.",
          ref: mcpSmokeEvidenceRef,
        }],
      },
    });
    const recordedTargetResultPayload = JSON.parse(recordedTargetResult.result.content?.[0]?.text);
    if (
      !recordedTargetResultPayload.ok
      || recordedTargetResultPayload.parsedJson?.command !== "import-target-result"
    ) {
      throw new Error("MCP wakeflow_record_target_result did not record target review inputs");
    }

    const reducedResults = await request("tools/call", {
      name: "wakeflow_reduce_results",
      arguments: {
        root: rootPath,
        stateRoot: mcpStateRoot,
        apply: true,
      },
    });
    const reducedResultsPayload = JSON.parse(reducedResults.result.content?.[0]?.text);
    if (
      !reducedResultsPayload.ok
      || reducedResultsPayload.parsedJson?.command !== "reduce-results"
      || !reducedResultsPayload.parsedJson?.candidateId
    ) {
      throw new Error("MCP wakeflow_reduce_results did not create a review candidate");
    }

    const statusCall = await request("tools/call", {
      name: "wakeflow_status",
      arguments: { root: rootPath },
    });
    const statusText = statusCall.result.content?.[0]?.text;
    const statusPayload = JSON.parse(statusText);
    if (!statusPayload.ok || statusPayload.parsedJson?.command !== "status") {
      throw new Error("MCP wakeflow_status did not inspect the requested root");
    }

    const traced = await request("tools/call", {
      name: "wakeflow_view",
      arguments: {
        root: rootPath,
        scope: "trace",
        stateRoot: mcpStateRoot,
        targetWindow: "Target",
        taskId: "mcp-smoke-task",
      },
    });
    const tracedPayload = JSON.parse(traced.result.content?.[0]?.text);
    if (
      !tracedPayload.ok
      || tracedPayload.parsedJson?.command !== "trace-spine"
      || tracedPayload.parsedJson?.traceSpine?.coverage?.dispatchPacketCount !== 1
      || tracedPayload.parsedJson?.traceSpine?.coverage?.targetResultCount !== 1
    ) {
      throw new Error("MCP wakeflow_view(scope=trace) did not return the task evidence spine");
    }

    const progressPreview = await request("tools/call", {
      name: "wakeflow_view",
      arguments: { root: rootPath, scope: "progress", stateRoot: mcpStateRoot },
    });
    const progressPreviewPayload = JSON.parse(progressPreview.result.content?.[0]?.text);
    if (!progressPreviewPayload.ok) {
      throw new Error("MCP wakeflow_view(scope=progress) did not preserve dry-run projection routing");
    }

    const podsView = await request("tools/call", {
      name: "wakeflow_view",
      arguments: { root: rootPath, scope: "pods" },
    });
    const podsViewPayload = JSON.parse(podsView.result.content?.[0]?.text);
    if (!podsViewPayload.ok || !Array.isArray(podsViewPayload.parsedJson?.pods)) {
      throw new Error("MCP wakeflow_view(scope=pods) did not return the Pod inventory");
    }

    const preserveSource = path.join(rootPath, ".wakeflow-local", "mcp-preserve-smoke.txt");
    mkdirSync(path.dirname(preserveSource), { recursive: true });
    writeFileSync(preserveSource, "preserve through the public MCP surface\n");
    const preservePreview = await request("tools/call", {
      name: "wakeflow_storage_preserve",
      arguments: {
        root: rootPath,
        source: ".wakeflow-local/mcp-preserve-smoke.txt",
        reason: "mcp-smoke",
      },
    });
    const preservePreviewPayload = JSON.parse(preservePreview.result.content?.[0]?.text);
    if (
      !preservePreviewPayload.ok
      || preservePreviewPayload.parsedJson?.command !== "preserve"
      || preservePreviewPayload.parsedJson?.wrote !== false
    ) {
      throw new Error("MCP wakeflow_storage_preserve did not preserve dry-run semantics");
    }
    const preserveApply = await request("tools/call", {
      name: "wakeflow_storage_preserve",
      arguments: {
        root: rootPath,
        source: ".wakeflow-local/mcp-preserve-smoke.txt",
        reason: "mcp-smoke",
        note: "MCP smoke audit hold",
        apply: true,
      },
    });
    const preserveApplyPayload = JSON.parse(preserveApply.result.content?.[0]?.text);
    if (
      !preserveApplyPayload.ok
      || preserveApplyPayload.parsedJson?.command !== "preserve"
      || preserveApplyPayload.parsedJson?.wrote !== true
    ) {
      throw new Error("MCP wakeflow_storage_preserve did not apply through the storage backend");
    }

    return { ok: true, toolCount: toolNames.length, stateRoot: mcpStateRoot };
  } finally {
    clearTimeout(timeout);
    child.stdin.end();
    child.kill("SIGTERM");
    if (stderr.trim()) {
      // Keep stderr visible when the smoke itself fails; successful runs ignore quiet shutdown noise.
    }
  }
}

function expandMcpValue(value, variables) {
  if (typeof value !== "string") throw new Error("Wakeflow MCP command values must be strings");
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => {
    const resolved = variables[name] ?? process.env[name];
    if (resolved === undefined) throw new Error(`Wakeflow MCP variable is unresolved: ${match}`);
    return resolved;
  });
}

function assertToolSchemasAcceptedByHost(tools) {
  for (const tool of tools) {
    if (!tool.inputSchema || tool.inputSchema.type !== "object") {
      throw new Error(`${tool.name} inputSchema must be an object schema`);
    }
    assertEnumSchemasHaveTypes(tool.inputSchema, tool.name);
  }
}

function assertToolAnnotationsAcceptedByHost(tools) {
  for (const tool of tools) {
    const annotations = tool.annotations;
    if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) {
      throw new Error(`${tool.name} annotations must be present`);
    }
    for (const field of ["title", "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      if (!(field in annotations)) {
        throw new Error(`${tool.name} annotations missing ${field}`);
      }
    }
    if (annotations.destructiveHint !== false || annotations.openWorldHint !== false) {
      throw new Error(`${tool.name} annotations must describe a local non-destructive tool`);
    }
  }
}

function assertEnumSchemasHaveTypes(schema, location) {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema.enum) && !schema.type) {
    throw new Error(`${location} enum schema is missing an explicit type`);
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key === "enum") continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertEnumSchemasHaveTypes(item, `${location}.${key}[${index}]`));
    } else {
      assertEnumSchemasHaveTypes(value, `${location}.${key}`);
    }
  }
}
