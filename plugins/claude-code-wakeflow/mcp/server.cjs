#!/usr/bin/env node

"use strict";

const { readFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const pluginRoot = path.dirname(__dirname);
const packageVersion = readPackageVersion();
const JSONRPC_VERSION = "2.0";
const LATEST_PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_NEGOTIATED_PROTOCOL_VERSION = "2025-03-26";
const SUPPORTED_PROTOCOL_VERSIONS = [
  LATEST_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07",
];

const ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
};

main().catch((error) => {
  process.stderr.write(`[wakeflow-mcp] ${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const { tools, handlers } = await import(pathToFileURL(path.join(pluginRoot, "lib/wakeflow-mcp-tools.mjs")).href);
  const transport = new LineJsonRpcTransport(process.stdin, process.stdout);

  transport.onMessage = async (message) => {
    const responses = [];
    for (const item of Array.isArray(message) ? message : [message]) {
      const response = await handleMessage(item, tools, handlers);
      if (response) responses.push(response);
    }
    if (Array.isArray(message)) {
      if (responses.length > 0) transport.send(responses);
      return;
    }
    if (responses[0]) transport.send(responses[0]);
  };

  transport.onError = (error) => {
    transport.send(jsonRpcError(null, ERROR_CODES.parseError, error.message || "Parse error"));
  };

  transport.start();
}

async function handleMessage(message, tools, handlers) {
  if (isJsonRpcResponse(message)) {
    return null;
  }

  if (!isObject(message) || message.jsonrpc !== JSONRPC_VERSION || typeof message.method !== "string") {
    return jsonRpcError(safeResponseId(message), ERROR_CODES.invalidRequest, "Invalid JSON-RPC request");
  }

  const hasId = Object.hasOwn(message, "id");
  if (hasId && !isValidRequestId(message.id)) {
    return jsonRpcError(null, ERROR_CODES.invalidRequest, "Invalid JSON-RPC request id");
  }

  const id = hasId ? message.id : undefined;
  const params = message.params;
  if (params !== undefined && !isObject(params)) {
    if (!hasId) return null;
    return jsonRpcError(id, ERROR_CODES.invalidParams, "Request params must be an object");
  }

  try {
    switch (message.method) {
      case "initialize":
        if (!hasId) return null;
        return jsonRpcResult(id, {
          protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
          capabilities: { tools: {} },
          serverInfo: { name: "wakeflow", version: packageVersion },
        });
      case "notifications/initialized":
        return null;
      case "ping":
        return hasId ? jsonRpcResult(id, {}) : null;
      case "tools/list":
        return hasId ? jsonRpcResult(id, { tools }) : null;
      case "tools/call":
        if (!hasId) return null;
        return jsonRpcResult(id, await callTool(params || {}, handlers));
      default:
        if (!hasId) return null;
        return jsonRpcError(id, ERROR_CODES.methodNotFound, `Method not found: ${message.method}`);
    }
  } catch (error) {
    if (!hasId) return null;
    return jsonRpcError(id, ERROR_CODES.internalError, error?.message || String(error));
  }
}

async function callTool(params, handlers) {
  if (!isObject(params) || typeof params.name !== "string") {
    return toolError("tools/call requires params.name");
  }
  const handler = handlers[params.name];
  if (!handler) {
    return toolError(`Unknown Wakeflow tool: ${params.name}`);
  }
  try {
    return toolContent(await handler(isObject(params.arguments) ? params.arguments : {}));
  } catch (error) {
    return toolError(error?.message || String(error));
  }
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

function toolError(message) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, error: message }, null, 2),
      },
    ],
  };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

function jsonRpcError(id, code, message, data = undefined) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: JSONRPC_VERSION, id, error };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidRequestId(value) {
  return typeof value === "string" || (Number.isInteger(value) && Number.isSafeInteger(value));
}

function isJsonRpcResponse(message) {
  return isObject(message)
    && message.jsonrpc === JSONRPC_VERSION
    && Object.hasOwn(message, "id")
    && !Object.hasOwn(message, "method")
    && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"));
}

function safeResponseId(message) {
  if (!isObject(message) || !Object.hasOwn(message, "id")) return null;
  return isValidRequestId(message.id) ? message.id : null;
}

function negotiateProtocolVersion(requested) {
  if (typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  return DEFAULT_NEGOTIATED_PROTOCOL_VERSION;
}

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(pluginRoot, "package.json"), "utf8"));
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

class LineJsonRpcTransport {
  constructor(input, output) {
    this.input = input;
    this.output = output;
    this.buffer = Buffer.alloc(0);
    this.onMessage = undefined;
    this.onError = undefined;
  }

  start() {
    this.input.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    this.input.on("error", (error) => {
      this.onError?.(error);
    });
  }

  send(message) {
    const payload = `${JSON.stringify(message)}\n`;
    if (!this.output.write(payload)) {
      this.output.once("drain", () => {});
    }
  }

  drain() {
    while (this.buffer.length > 0) {
      const framed = this.tryReadContentLengthFrame();
      if (framed === null) {
        const line = this.tryReadLine();
        if (line === null) return;
        if (line === "") continue;
        this.dispatch(line);
        continue;
      }
      if (framed === undefined) return;
      this.dispatch(framed);
    }
  }

  tryReadContentLengthFrame() {
    const prefix = this.buffer.toString("utf8", 0, Math.min(this.buffer.length, 15));
    if (!prefix.startsWith("Content-Length:")) return null;
    const delimiter = this.findHeaderDelimiter();
    if (!delimiter) return undefined;
    const { index: headerEnd, length: delimiterLength } = delimiter;
    const header = this.buffer.toString("utf8", 0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      this.onError?.(new Error("Invalid MCP frame header"));
      this.buffer = Buffer.alloc(0);
      return undefined;
    }
    const length = Number(match[1]);
    if (!Number.isSafeInteger(length) || length < 0) {
      this.onError?.(new Error("Invalid MCP frame length"));
      this.buffer = Buffer.alloc(0);
      return undefined;
    }
    const bodyStart = headerEnd + delimiterLength;
    if (this.buffer.length < bodyStart + length) return undefined;
    const body = this.buffer.toString("utf8", bodyStart, bodyStart + length);
    this.buffer = this.buffer.subarray(bodyStart + length);
    return body;
  }

  findHeaderDelimiter() {
    const crlf = this.buffer.indexOf("\r\n\r\n");
    const lf = this.buffer.indexOf("\n\n");
    if (crlf < 0 && lf < 0) return null;
    if (crlf >= 0 && (lf < 0 || crlf <= lf)) return { index: crlf, length: 4 };
    return { index: lf, length: 2 };
  }

  tryReadLine() {
    const newline = this.buffer.indexOf("\n");
    if (newline < 0) return null;
    const line = this.buffer.toString("utf8", 0, newline).replace(/\r$/, "").trim();
    this.buffer = this.buffer.subarray(newline + 1);
    return line;
  }

  dispatch(raw) {
    try {
      Promise.resolve(this.onMessage?.(JSON.parse(raw))).catch((error) => {
        this.onError?.(error);
      });
    } catch (error) {
      this.onError?.(error);
    }
  }
}
