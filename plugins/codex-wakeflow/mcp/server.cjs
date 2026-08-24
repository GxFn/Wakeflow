#!/usr/bin/env node

"use strict";

/**
 * Wakeflow MCP 的 stdio / JSON-RPC 传输入口。
 *
 * 能力导航：
 * - 协议协商与消息分派：main、handleMessage、negotiateProtocolVersion。
 * - 精确工具调用：callTool，只允许注册表自己的可调用属性。
 * - 公共结果与脱敏错误：toolContent、publicToolError、toolError。
 * - 行与 Content-Length framing：LineJsonRpcTransport。
 *
 * 本文件不拥有任何领域操作；它只把已注册工具暴露给 MCP 客户端，并保持公共错误边界。
 */
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const pluginRoot = path.dirname(__dirname);
const packageVersion = readPackageVersion();
const JSONRPC_VERSION = "2.0";
const LATEST_PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_NEGOTIATED_PROTOCOL_VERSION = "2025-03-26";
const PUBLIC_MCP_ERROR_CODE_PATTERN = /^wakeflow-public-mcp-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const STABLE_WAKEFLOW_CODE_PATTERN = /^wakeflow-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
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

// 加载同一安装产物的精确工具表，并把每个输入 frame 交给统一协议分派。
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

// 处理 JSON-RPC 协议方法；tools/call 的领域失败仍作为 MCP tool result 返回。
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
    return jsonRpcError(id, ERROR_CODES.internalError, "Internal error");
  }
}

/**
 * 调用一个精确注册的 Wakeflow 工具。
 * own-property 与 function 两项检查共同阻断 constructor、toString 等原型链名字进入执行路径。
 */
async function callTool(params, handlers) {
  if (!isObject(params) || typeof params.name !== "string") {
    return toolError({
      code: "wakeflow-mcp-invalid-call",
      message: "tools/call requires params.name",
    });
  }
  if (!Object.hasOwn(handlers, params.name) || typeof handlers[params.name] !== "function") {
    return toolError({
      code: "wakeflow-mcp-unknown-tool",
      message: "Unknown Wakeflow tool",
    });
  }
  const handler = handlers[params.name];
  try {
    return toolContent(await handler(isObject(params.arguments) ? params.arguments : {}));
  } catch (error) {
    return toolError(publicToolError(error));
  }
}

// 成功结果保持领域 owner 已经生成的可移植 JSON 结构，不增加第二套 envelope。
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

/**
 * 只保留共享 MCP 组合层显式产生的稳定公开错误。
 * 未识别异常会收敛为通用失败，避免内部 message、stack、路径或任意 details 穿透传输层。
 */
function publicToolError(error) {
  if (
    error?.name === "WakeflowPublicMcpError"
    && PUBLIC_MCP_ERROR_CODE_PATTERN.test(error.code)
    && typeof error.message === "string"
  ) {
    const causeCode = STABLE_WAKEFLOW_CODE_PATTERN.test(error?.details?.causeCode)
      ? error.details.causeCode
      : undefined;
    return {
      code: error.code,
      message: error.message,
      ...(causeCode === undefined ? {} : { causeCode }),
    };
  }
  return {
    code: "wakeflow-mcp-tool-failed",
    message: "Wakeflow tool failed inside its bounded public owner",
  };
}

// MCP tool error 固定返回 code/message/可选 causeCode，不回显调用参数或内部 details。
function toolError({ code, message, causeCode = undefined }) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: {
            code,
            message,
            ...(causeCode === undefined ? {} : { causeCode }),
          },
        }, null, 2),
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

// 同时兼容逐行 JSON 与 MCP Content-Length frame；framing 只负责传输，不解释业务内容。
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
