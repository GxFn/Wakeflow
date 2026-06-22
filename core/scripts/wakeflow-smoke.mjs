#!/usr/bin/env node

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnProcess } from "../lib/wakeflow-process.mjs";
import { runWakeflowRuntime } from "../lib/wakeflow-runtime.mjs";

const root = mkdtempSync(path.join(tmpdir(), "wakeflow-smoke-"));

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
  const args = (server.args ?? []).map((arg) => arg.replace(/^\$\{[A-Z0-9_]+\}/, "."));
  const child = spawnProcess(server.command, args, {
    cwd,
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
      "wakeflow_status",
      "wakeflow_prepare_delivery",
      "wakeflow_record_delivery",
      "wakeflow_record_target_result",
      "wakeflow_review_pack",
      "wakeflow_view",
      "wakeflow_reduce_results",
      "wakeflow_decide_review",
      "wakeflow_archive",
      "wakeflow_verify",
    ]) {
      if (!toolNames.includes(expected)) {
        throw new Error(`MCP tools/list missing ${expected}`);
      }
    }
    const hostVisiblePrefix = toolNames.slice(0, 12);
    for (const expected of [
      "wakeflow_review_pack",
      "wakeflow_reduce_results",
      "wakeflow_decide_review",
      "wakeflow_complete_demand",
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

    const called = await request("tools/call", {
      name: "wakeflow_create_demand",
      arguments: {
        root: rootPath,
        demandKey: "mcp-smoke",
        title: "MCP Smoke",
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

    const addedTask = await request("tools/call", {
      name: "wakeflow_add_task",
      arguments: {
        root: rootPath,
        stateRoot: mcpStateRoot,
        taskId: "mcp-smoke-task",
        targetWindow: "Target",
        summary: "MCP smoke task package.",
        targetSummary: "Return MCP smoke evidence.",
      },
    });
    const addedTaskPayload = JSON.parse(addedTask.result.content?.[0]?.text);
    if (!addedTaskPayload.ok || addedTaskPayload.parsedJson?.command !== "add-task-package") {
      throw new Error("MCP wakeflow_add_task did not create a task package");
    }

    const prepared = await request("tools/call", {
      name: "wakeflow_prepare_delivery",
      arguments: {
        root: rootPath,
        direction: "target",
        stateRoot: mcpStateRoot,
        taskId: "mcp-smoke-task",
        dispatchGroup: "mcp-smoke-group",
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
      || !preparedPrompt?.includes("mcp-smoke-task")
      || !preparedJson?.deliveryFile
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
        status: "completed",
        evidenceRefs: [mcpSmokeEvidenceRef],
        verification: ["mcp smoke target result recorded"],
      },
    });
    const recordedTargetResultPayload = JSON.parse(recordedTargetResult.result.content?.[0]?.text);
    if (
      !recordedTargetResultPayload.ok
      || recordedTargetResultPayload.parsedJson?.command !== "import-target-result"
    ) {
      throw new Error("MCP wakeflow_record_target_result did not record target evidence");
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
