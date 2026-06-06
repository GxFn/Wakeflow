#!/usr/bin/env node

import {
  addTask,
  initDemand,
  prepareDelivery,
  recordDelivery,
  review,
  status,
  submitResult,
} from "../lib/wakeflow-state.mjs";

const tools = [
  {
    name: "wakeflow_status",
    description: "Inspect local Wakeflow active demands. Does not send messages.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Workspace root. Defaults to cwd." },
      },
    },
  },
  {
    name: "wakeflow_init_demand",
    description: "Create a local Wakeflow state root for one demand.",
    inputSchema: {
      type: "object",
      required: ["demandKey", "title"],
      properties: {
        root: { type: "string" },
        demandKey: { type: "string" },
        title: { type: "string" },
        goal: { type: "string" },
        completionDefinition: { type: "string" },
        controllerWindow: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_add_task",
    description: "Add a target task package to a Wakeflow state root.",
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
      },
    },
  },
  {
    name: "wakeflow_prepare_delivery",
    description: "Create a delivery intent and compact prompt. This is not a send.",
    inputSchema: {
      type: "object",
      required: ["stateRoot", "taskId"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        taskId: { type: "string" },
        dispatchGroup: { type: "string" },
        controllerWindow: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_record_delivery",
    description: "Record external host-send evidence for a delivery intent.",
    inputSchema: {
      type: "object",
      required: ["stateRoot", "deliveryId", "status"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        deliveryId: { type: "string" },
        status: { enum: ["sent", "blocked", "failed", "deferred"] },
        evidence: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_submit_result",
    description: "Import a target result envelope into a Wakeflow state root.",
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
        evidenceRefs: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
  {
    name: "wakeflow_review",
    description: "Summarize completed, missing, and blocked target results.",
    inputSchema: {
      type: "object",
      required: ["stateRoot"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
      },
    },
  },
];

const handlers = {
  wakeflow_status: (args) => status({ root: args.root || process.cwd() }),
  wakeflow_init_demand: (args) => initDemand({ ...args, root: args.root || process.cwd(), write: true }),
  wakeflow_add_task: (args) => addTask({ ...args, root: args.root || process.cwd(), write: true }),
  wakeflow_prepare_delivery: (args) => prepareDelivery({ ...args, root: args.root || process.cwd(), write: true }),
  wakeflow_record_delivery: (args) => recordDelivery({ ...args, root: args.root || process.cwd(), write: true }),
  wakeflow_submit_result: (args) => submitResult({ ...args, root: args.root || process.cwd(), evidenceRefs: args.evidenceRefs || [], write: true }),
  wakeflow_review: (args) => review({ root: args.root || process.cwd(), stateRoot: args.stateRoot }),
};

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  drainBuffer();
});

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
      result(request.id, toolContent(handler(args)));
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
