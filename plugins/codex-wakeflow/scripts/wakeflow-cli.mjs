#!/usr/bin/env node

/**
 * Wakeflow 公开 CLI 的 JSON-stdin 镜像入口。
 *
 * 能力导航：
 * - parseWakeflowCliArgv：只接纳固定的 stdin + JSON 启动形式。
 * - parseWakeflowCliRequest：把一条请求收敛为已注册工具名和冻结参数。
 * - runWakeflowCli：精确选择共享 MCP handler，不在本文件复制领域路由。
 * - runWakeflowCliStdin：限制输入字节、编码公开结果并收敛错误。
 *
 * 本文件只拥有 CLI 传输合同；工具权限、状态转换和领域错误仍由原 handler owner 拥有。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { handlers, tools } from "../lib/wakeflow-mcp-tools.mjs";

export const WAKEFLOW_CLI_STDIN_LIMIT = 8 * 1024 * 1024;

const REQUIRED_FLAGS = Object.freeze(["--request-stdin", "--json"]);
const PUBLIC_TOOLS = Object.freeze(tools.map((tool) => tool.name));
const PUBLIC_MCP_ERROR_CODE_PATTERN = /^wakeflow-public-mcp-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const STABLE_WAKEFLOW_CODE_PATTERN = /^wakeflow-[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export class WakeflowCliError extends Error {
  constructor(code, message, { cause, details = {} } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowCliError";
    this.code = code;
    this.details = deepFreeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, cause = undefined) {
  throw new WakeflowCliError(code, message, { cause });
}

// 公共输入只接受普通对象；class instance 与自定义原型不能充当数据合同。
function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

// clone 完成后递归冻结参数，避免 handler 之间通过调用方对象共享可变状态。
function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

// 同时检查字段集合与 data property，验证阶段不执行 accessor。
function exactDataObject(value, allowed, required, label) {
  if (!plainObject(value)) fail("wakeflow-cli-invalid-contract", `${label} must be one plain object`);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))) {
    fail("wakeflow-cli-invalid-contract", `${label} has an unknown field`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail("wakeflow-cli-invalid-contract", `${label} is missing ${key}`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-cli-invalid-contract", `${label}.${String(key)} must be an enumerable data property`);
    }
  }
  return value;
}

// CLI 不保留旧子命令或别名，只允许精确的 stdin JSON 调用形式。
export function parseWakeflowCliArgv(argv = []) {
  if (!Array.isArray(argv) || argv.some((entry) => typeof entry !== "string")) {
    fail("wakeflow-cli-invalid-argv", "public CLI argv must be an array of strings");
  }
  if (
    argv.length !== REQUIRED_FLAGS.length
    || REQUIRED_FLAGS.some((flag) => argv.filter((entry) => entry === flag).length !== 1)
  ) {
    fail(
      "wakeflow-cli-invalid-argv",
      "public CLI invocation requires exact --request-stdin and --json flags",
    );
  }
  return Object.freeze({ requestStdin: true, json: true });
}

// 一次 stdin 只承载一个已注册工具请求；参数在进入 handler 前完成 clone 与 freeze。
export function parseWakeflowCliRequest(raw) {
  if (typeof raw !== "string") {
    fail("wakeflow-cli-invalid-stdin", "public CLI stdin must be one UTF-8 JSON string");
  }
  if (Buffer.byteLength(raw, "utf8") > WAKEFLOW_CLI_STDIN_LIMIT) {
    fail("wakeflow-cli-stdin-too-large", "public CLI stdin exceeds its bounded size");
  }
  if (!raw.trim()) fail("wakeflow-cli-invalid-stdin", "public CLI stdin is empty");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    fail("wakeflow-cli-invalid-json", "public CLI stdin must contain exactly one JSON request", cause);
  }
  const request = exactDataObject(parsed, ["tool", "arguments"], ["tool", "arguments"], "CLI request");
  if (typeof request.tool !== "string" || !PUBLIC_TOOLS.includes(request.tool)) {
    fail("wakeflow-cli-unknown-tool", "CLI request.tool must name one public Wakeflow tool");
  }
  exactDataObject(
    request.arguments,
    Reflect.ownKeys(request.arguments).filter((key) => typeof key === "string"),
    [],
    "CLI request.arguments",
  );
  let argumentsValue;
  try {
    argumentsValue = deepFreeze(structuredClone(request.arguments));
  } catch (cause) {
    fail("wakeflow-cli-invalid-contract", "CLI request.arguments must contain cloneable JSON-compatible data", cause);
  }
  return Object.freeze({ tool: request.tool, arguments: argumentsValue });
}

// 先按原始字节执行上限检查，再用 fatal UTF-8 解码，禁止替换字符改变请求语义。
async function readBoundedUtf8(stream) {
  if (stream === null || typeof stream !== "object" || stream[Symbol.asyncIterator] === undefined) {
    fail("wakeflow-cli-invalid-stdin", "public CLI stdin must be an async-readable stream");
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    total += bytes.length;
    if (total > WAKEFLOW_CLI_STDIN_LIMIT) {
      fail("wakeflow-cli-stdin-too-large", "public CLI stdin exceeds its bounded size");
    }
    chunks.push(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch (cause) {
    fail("wakeflow-cli-invalid-stdin", "public CLI stdin is not valid UTF-8", cause);
  }
}

// 只有当前共享注册表中的真实 handler 才能把 MCP 领域错误提升为 CLI 公开错误。
function trustedPublicToolError(error, tool, handler) {
  if (
    handler !== handlers[tool]
    || error?.name !== "WakeflowPublicMcpError"
    || !PUBLIC_MCP_ERROR_CODE_PATTERN.test(error.code)
    || typeof error.message !== "string"
  ) return null;
  const causeCode = STABLE_WAKEFLOW_CODE_PATTERN.test(error?.details?.causeCode)
    ? error.details.causeCode
    : undefined;
  return new WakeflowCliError(error.code, error.message, {
    cause: error,
    details: causeCode === undefined ? {} : { causeCode },
  });
}

// 公开失败只保留本 facade 或受信 handler 产生的稳定字段，其他异常统一脱敏。
function publicError(error) {
  if (error instanceof WakeflowCliError) {
    const causeCode = STABLE_WAKEFLOW_CODE_PATTERN.test(error?.details?.causeCode)
      ? error.details.causeCode
      : undefined;
    return Object.freeze({
      code: error.code,
      message: error.message,
      ...(causeCode === undefined ? {} : { causeCode }),
    });
  }
  return Object.freeze({
    code: "wakeflow-cli-failed",
    message: "public Wakeflow tool failed inside its bounded owner",
  });
}

// 这里仅完成工具选择；领域操作仍直接调用共享 MCP handler。
export async function runWakeflowCli(value = {}) {
  const input = exactDataObject(value, ["argv", "rawRequest", "toolHandlers"], [
    "argv",
    "rawRequest",
    "toolHandlers",
  ], "CLI execution");
  parseWakeflowCliArgv(input.argv);
  if (!plainObject(input.toolHandlers)) {
    fail("wakeflow-cli-invalid-handlers", "public CLI handlers must be one exact map");
  }
  const request = parseWakeflowCliRequest(input.rawRequest);
  const descriptor = Object.getOwnPropertyDescriptor(input.toolHandlers, request.tool);
  if (
    !descriptor?.enumerable
    || !Object.hasOwn(descriptor, "value")
    || typeof descriptor.value !== "function"
  ) {
    fail("wakeflow-cli-handler-missing", "selected public CLI tool has no handler");
  }
  const handler = descriptor.value;
  try {
    return await handler(request.arguments);
  } catch (error) {
    throw trustedPublicToolError(error, request.tool, handler) ?? error;
  }
}

// stdin 适配层保证每次调用只写一个 JSON envelope，并以 exitCode 表示传输结果。
export async function runWakeflowCliStdin(value = {}) {
  const input = exactDataObject(value, ["argv", "stdin", "stdout", "toolHandlers"], [
    "argv",
    "stdin",
    "stdout",
    "toolHandlers",
  ], "CLI stdin execution");
  if (input.stdout === null || typeof input.stdout?.write !== "function") {
    fail("wakeflow-cli-invalid-stdout", "public CLI stdout must provide write()");
  }
  try {
    const rawRequest = await readBoundedUtf8(input.stdin);
    const result = await runWakeflowCli({
      argv: input.argv,
      rawRequest,
      toolHandlers: input.toolHandlers,
    });
    input.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
    return Object.freeze({ exitCode: 0, result });
  } catch (error) {
    const serialized = publicError(error);
    input.stdout.write(`${JSON.stringify({ ok: false, error: serialized }, null, 2)}\n`);
    return Object.freeze({ exitCode: 1, error: serialized });
  }
}

// import 本模块不会启动进程入口；只有精确脚本执行才连接真实共享 handlers。
function isDirectExecution() {
  return typeof process.argv[1] === "string"
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isDirectExecution()) {
  const completed = await runWakeflowCliStdin({
    argv: process.argv.slice(2),
    stdin: process.stdin,
    stdout: process.stdout,
    toolHandlers: handlers,
  });
  process.exitCode = completed.exitCode;
}
