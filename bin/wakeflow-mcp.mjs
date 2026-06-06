#!/usr/bin/env node

import { listControlRuntimeScripts, runControlRuntime } from "../lib/control-runtime.mjs";

const tools = [
  {
    name: "wakeflow_initialize_workspace",
    description: "Initialize a Wakeflow control workspace: discover siblings, generate/apply workspace config, install AGENTS blocks, create Design/Test surfaces, and record local window/thread runtime. Dry-run unless apply is true.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        parent: { type: "string" },
        workspaceName: { type: "string" },
        controlWindow: { type: "string" },
        useDiscovered: { type: "boolean" },
        apply: { type: "boolean" },
        internalDesign: { type: "boolean" },
        internalTest: { type: "boolean" },
        includeRealProject: { type: "boolean" },
        repositories: {
          type: "array",
          items: {
            type: "object",
            required: ["windowName", "path"],
            properties: {
              windowName: { type: "string" },
              path: { type: "string" },
              role: { type: "string" },
            },
          },
        },
        localWindows: {
          type: "array",
          items: {
            type: "object",
            required: ["windowName"],
            properties: {
              windowName: { type: "string" },
              role: { enum: ["controller", "target", "test-target", "design", "observer"] },
              cwd: { type: "string" },
              responsibilityRoot: { type: "string" },
              displayTitle: { type: "string" },
              canonicalUse: { type: "string" },
            },
          },
        },
        threads: {
          type: "array",
          items: {
            type: "object",
            required: ["windowName", "threadId"],
            properties: {
              windowName: { type: "string" },
              threadId: { type: "string" },
              role: { enum: ["controller", "target", "test-target", "design", "observer"] },
              cwd: { type: "string" },
              responsibilityRoot: { type: "string" },
              displayTitle: { type: "string" },
              canonicalUse: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    name: "wakeflow_status",
    description: "Inspect Wakeflow repository and closed-loop runtime status. Does not send messages.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "wakeflow_init_demand",
    description: "Create a full Wakeflow controller state root for one demand.",
    inputSchema: {
      type: "object",
      required: ["demandKey", "title"],
      properties: {
        root: { type: "string" },
        demandKey: { type: "string" },
        title: { type: "string" },
        goal: { type: "string" },
        completionDefinition: { type: "string" },
        stagePlan: { type: "string" },
        stateRoot: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_add_task",
    description: "Add a full runtime task package and optional target task to a Wakeflow controller state root.",
    inputSchema: {
      type: "object",
      required: ["stateRoot", "taskId", "targetWindow", "summary"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        taskId: { type: "string" },
        targetWindow: { type: "string" },
        summary: { type: "string" },
        packageId: { type: "string" },
        sourceRef: { type: "string" },
        targetSummary: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_prepare_delivery",
    description: "Prepare a full runtime dispatch packet and delivery envelope. This is not a send.",
    inputSchema: {
      type: "object",
      required: ["stateRoot", "taskId"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        taskId: { type: "string" },
        dispatchGroup: { type: "string" },
        controllerWindow: { type: "string" },
        taskPackageId: { type: "string" },
        humanContextRef: { type: "string" },
        returnPolicy: { enum: ["group-ready", "per-target"] },
        requireThread: { type: "boolean" },
        automationEnabled: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_record_delivery",
    description: "Record external host-send evidence for a full runtime delivery envelope.",
    inputSchema: {
      type: "object",
      required: ["deliveryFile", "status"],
      properties: {
        root: { type: "string" },
        deliveryFile: { type: "string" },
        status: { enum: ["sent", "blocked", "failed"] },
        evidence: { type: "string" },
        error: { type: "string" },
        readbackOk: { type: "boolean" },
        hostMethod: { type: "string" },
        hostMode: { enum: ["new-turn", "unknown"] },
      },
    },
  },
  {
    name: "wakeflow_submit_result",
    description: "Import a target result envelope into a full Wakeflow controller state root.",
    inputSchema: {
      type: "object",
      required: ["stateRoot", "taskId", "targetWindow", "status"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        taskId: { type: "string" },
        targetWindow: { type: "string" },
        status: { enum: ["completed", "blocked", "needs-review"] },
        summary: { type: "string" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        verification: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        resultId: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_review",
    description: "Reduce full runtime target results into a controller review candidate.",
    inputSchema: {
      type: "object",
      required: ["stateRoot"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_control_runtime",
    description: "Run a Wakeflow runtime script through a whitelist. This does not send host thread messages.",
    inputSchema: {
      type: "object",
      required: ["script"],
      properties: {
        script: { enum: listControlRuntimeScripts() },
        args: { type: "array", items: { type: "string" } },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "wakeflow_full_status",
    description: "Run the embedded runtime status path.",
    inputSchema: { type: "object", properties: { json: { type: "boolean" } } },
  },
  {
    name: "wakeflow_full_verify",
    description: "Run embedded control runtime verification.",
    inputSchema: { type: "object", properties: { scriptTests: { type: "boolean" } } },
  },
];

const handlers = {
  wakeflow_initialize_workspace: (args) => runControlRuntime({
    script: "control-workspace-install",
    args: [
      "initialize",
      ...rootArgs(args),
      ...optionalValue("--parent", args.parent),
      ...optionalValue("--workspace-name", args.workspaceName),
      ...optionalValue("--control-window", args.controlWindow),
      ...(args.useDiscovered ? ["--use-discovered"] : []),
      ...(args.internalDesign ? ["--internal-design"] : []),
      ...(args.internalTest ? ["--internal-test"] : []),
      ...(args.includeRealProject ? ["--include-real-project"] : []),
      ...repositoryArgs(args.repositories),
      ...localWindowArgs(args.localWindows),
      ...threadArgs(args.threads),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
  }),
  wakeflow_status: () => runControlRuntime({
    script: "workspace-control",
    args: ["status", "--json"],
  }),
  wakeflow_init_demand: (args) => runControlRuntime({
    script: "controller-state",
    args: [
      "init",
      "--demand-key", args.demandKey,
      "--title", args.title,
      ...optionalValue("--goal", args.goal),
      ...optionalValue("--completion-definition", args.completionDefinition),
      ...optionalValue("--stage-plan", args.stagePlan),
      ...optionalValue("--state-root", args.stateRoot),
      ...rootArgs(args),
      "--write",
      "--json",
    ],
  }),
  wakeflow_add_task: (args) => runControlRuntime({
    script: "controller-state",
    args: [
      "add-task-package",
      "--state-root", args.stateRoot,
      "--task-package-id", args.packageId || args.taskId,
      "--summary", args.summary,
      "--target-window", args.targetWindow,
      "--target-task-id", args.taskId,
      ...optionalValue("--target-summary", args.targetSummary),
      ...optionalValue("--source-ref", args.sourceRef),
      ...rootArgs(args),
      "--write",
      "--json",
    ],
  }),
  wakeflow_prepare_delivery: (args) => runControlRuntime({
    script: "codex-automation-loop",
    args: [
      "prepare-dispatch-from-state",
      "--state-root", args.stateRoot,
      "--target-task-id", args.taskId,
      ...optionalValue("--task-package-id", args.taskPackageId),
      ...optionalValue("--human-context-ref", args.humanContextRef),
      ...optionalValue("--controller-window", args.controllerWindow),
      ...optionalValue("--group", args.dispatchGroup),
      ...optionalValue("--return-policy", args.returnPolicy),
      ...(args.requireThread ? ["--require-thread"] : []),
      ...(args.automationEnabled ? ["--automation-enabled"] : []),
      ...rootArgs(args),
      "--write",
      "--json",
    ],
  }),
  wakeflow_record_delivery: (args) => runControlRuntime({
    script: "codex-automation-loop",
    args: [
      "record-delivery-run",
      "--delivery-file", args.deliveryFile,
      "--status", args.status,
      ...optionalValue("--evidence", args.evidence),
      ...optionalValue("--error", args.error),
      ...optionalValue("--host-method", args.hostMethod),
      ...optionalValue("--host-mode", args.hostMode),
      ...(typeof args.readbackOk === "boolean" ? ["--readback-ok", String(args.readbackOk)] : []),
      ...rootArgs(args),
      "--write",
      "--json",
    ],
  }),
  wakeflow_submit_result: (args) => runControlRuntime({
    script: "controller-state",
    args: [
      "import-target-result",
      "--state-root", args.stateRoot,
      "--target-task-id", args.taskId,
      "--target-window", args.targetWindow,
      "--status", args.status,
      ...optionalValue("--summary", args.summary),
      ...optionalValue("--result-id", args.resultId),
      ...repeatValues("--evidence-ref", args.evidenceRefs),
      ...repeatValues("--verification", args.verification),
      ...repeatValues("--risk", args.risks),
      ...rootArgs(args),
      "--write",
      "--json",
    ],
  }),
  wakeflow_review: (args) => runControlRuntime({
    script: "controller-state",
    args: ["reduce-results", "--state-root", args.stateRoot, ...rootArgs(args), "--write", "--json"],
  }),
  wakeflow_control_runtime: (args) => runControlRuntime({
    script: args.script,
    args: args.args || [],
    timeoutMs: args.timeoutMs || 120000,
  }),
  wakeflow_full_status: (args) => runControlRuntime({
    script: "workspace-control",
    args: ["status", ...(args.json === false ? [] : ["--json"])],
  }),
  wakeflow_full_verify: (args) => runControlRuntime({
    script: "workspace-control",
    args: ["verify", ...(args.scriptTests ? ["--script-tests"] : []), "--json"],
    timeoutMs: args.scriptTests ? 180000 : 120000,
  }),
};

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  drainBuffer();
});

function optionalValue(flag, value) {
  return value === undefined || value === null || value === "" ? [] : [flag, String(value)];
}

function repeatValues(flag, values) {
  if (!values) return [];
  const list = Array.isArray(values) ? values : [values];
  return list.flatMap((value) => optionalValue(flag, value));
}

function repositoryArgs(repositories = []) {
  return (repositories || []).flatMap((repo) => [
    "--repo", `${repo.windowName}=${repo.path}`,
    ...optionalValue("--role", repo.role ? `${repo.windowName}=${repo.role}` : ""),
  ]);
}

function localWindowArgs(windows = []) {
  return (windows || []).flatMap((item) => [
    "--window", item.windowName,
    ...optionalValue("--thread-role", item.role ? `${item.windowName}=${item.role}` : ""),
    ...optionalValue("--thread-cwd", item.cwd ? `${item.windowName}=${item.cwd}` : ""),
    ...optionalValue("--thread-responsibility-root", item.responsibilityRoot ? `${item.windowName}=${item.responsibilityRoot}` : ""),
    ...optionalValue("--thread-title", item.displayTitle ? `${item.windowName}=${item.displayTitle}` : ""),
    ...optionalValue("--thread-use", item.canonicalUse ? `${item.windowName}=${item.canonicalUse}` : ""),
  ]);
}

function threadArgs(threads = []) {
  return (threads || []).flatMap((item) => [
    "--thread", `${item.windowName}=${item.threadId}`,
    ...optionalValue("--thread-role", item.role ? `${item.windowName}=${item.role}` : ""),
    ...optionalValue("--thread-cwd", item.cwd ? `${item.windowName}=${item.cwd}` : ""),
    ...optionalValue("--thread-responsibility-root", item.responsibilityRoot ? `${item.windowName}=${item.responsibilityRoot}` : ""),
    ...optionalValue("--thread-title", item.displayTitle ? `${item.windowName}=${item.displayTitle}` : ""),
    ...optionalValue("--thread-use", item.canonicalUse ? `${item.windowName}=${item.canonicalUse}` : ""),
  ]);
}

function rootArgs(args) {
  return optionalValue("--root", args.root);
}

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function result(id, payload) {
  send({ jsonrpc: "2.0", id, result: payload });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolContent(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function handleLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch (parseError) {
    error(null, -32700, `Parse error: ${parseError.message}`);
    return;
  }
  try {
    if (request.method === "initialize") {
      result(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "wakeflow", version: "0.1.0" },
      });
      return;
    }
    if (request.method === "tools/list") {
      result(request.id, { tools });
      return;
    }
    if (request.method === "tools/call") {
      const { name, arguments: args = {} } = request.params || {};
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown Wakeflow tool: ${name}`);
      Promise.resolve(handler(args))
        .then((payload) => result(request.id, toolContent(payload)))
        .catch((toolError) => error(request.id, -32000, toolError.message));
      return;
    }
    if (!request.id) return;
    error(request.id, -32601, `Unknown method: ${request.method}`);
  } catch (callError) {
    error(request.id, -32000, callError.message);
  }
}

function drainBuffer() {
  while (buffer.length) {
    if (buffer.startsWith("Content-Length:")) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        error(null, -32600, "Invalid MCP frame header");
        buffer = "";
        return;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.slice(bodyStart, bodyStart + length);
      buffer = buffer.slice(bodyStart + length);
      handleLine(body);
      continue;
    }
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) handleLine(line);
  }
}
