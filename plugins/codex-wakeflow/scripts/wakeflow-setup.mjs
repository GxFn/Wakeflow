/**
 * Wakeflow workspace maintenance 的专用 JSON-stdin 入口。
 *
 * 能力导航：
 * - parseWakeflowSetupArgv：只接纳固定的 maintenance stdin 调用形式。
 * - parseWakeflowSetupRequest：完成有界 JSON 对象解码。
 * - runWakeflowSetup：把完整请求原样交给唯一 maintenance coordinator。
 * - runWakeflowSetupStdin：编码公开结果，并收敛 facade、coordinator 与 artifact 错误。
 *
 * 本文件不规划或执行初始化写入，也不属于普通 31-tool 领域 runtime；真实计划、事务与恢复
 * 仍由 action runtime 和 maintenance coordinator 拥有。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { hostProfile } from "./lib/wakeflow-host-profile.mjs";
import {
  WakeflowMaintenanceActionRuntimeError,
  loadWakeflowMaintenanceActionHandlers,
} from "./lib/wakeflow-maintenance-action-runtime.mjs";
import {
  WakeflowMaintenanceCoordinatorError,
  createWakeflowMaintenanceCoordinator,
} from "./lib/wakeflow-maintenance-coordinator.mjs";

export const WAKEFLOW_SETUP_STDIN_LIMIT = 8 * 1024 * 1024;

const REQUIRED_FLAGS = Object.freeze(["--request-stdin", "--json"]);

export class WakeflowSetupError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowSetupError";
    this.code = code;
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message) {
  throw new WakeflowSetupError(code, message);
}

// facade 的数据选项只接受普通对象，避免自定义原型参与合同解释。
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 精确检查字段及 data property；验证 options 时不会触发调用方 accessor。
function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) fail("wakeflow-setup-v3-invalid-contract", `${label} must be a plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("wakeflow-setup-v3-invalid-contract", `${label} has an invalid field set`);
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-setup-v3-invalid-contract",
        `${label}.${key} must be an enumerable data property`,
      );
    }
  }
  return value;
}

// 依赖注入入口只接受对象自己的可枚举函数，不执行 getter 或原型链方法。
function ownCallable(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null;
  return typeof descriptor.value === "function" ? descriptor.value : null;
}

// setup 不保留旧 initialize/configure 子命令；公开入口只有精确 stdin JSON 形式。
export function parseWakeflowSetupArgv(argv = []) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== "string")) {
    fail("wakeflow-setup-v3-invalid-argv", "public argv must be an array of strings");
  }
  if (
    argv.length !== REQUIRED_FLAGS.length
    || REQUIRED_FLAGS.some((flag) => argv.filter((value) => value === flag).length !== 1)
  ) {
    fail(
      "wakeflow-setup-v3-invalid-argv",
      "public invocation requires exact --request-stdin and --json flags",
    );
  }
  return Object.freeze({ requestStdin: true, json: true });
}

// 本层只确认有界 JSON 对象；action/mode/plan 的 closed contract 由 coordinator 验证。
export function parseWakeflowSetupRequest(raw) {
  if (typeof raw !== "string") {
    fail("wakeflow-setup-v3-invalid-stdin", "public stdin must be one UTF-8 JSON string");
  }
  if (Buffer.byteLength(raw, "utf8") > WAKEFLOW_SETUP_STDIN_LIMIT) {
    fail("wakeflow-setup-v3-stdin-too-large", "public stdin exceeds its bounded size");
  }
  if (!raw.trim()) fail("wakeflow-setup-v3-invalid-stdin", "public stdin is empty");
  let request;
  try {
    request = JSON.parse(raw);
  } catch (cause) {
    throw new WakeflowSetupError(
      "wakeflow-setup-v3-invalid-json",
      "public stdin must contain exactly one JSON request",
      { cause },
    );
  }
  if (!isPlainObject(request)) {
    fail("wakeflow-setup-v3-invalid-stdin", "public stdin request must be a JSON object");
  }
  return request;
}

// 先按原始字节执行上限检查，再以 fatal UTF-8 解码，防止替换字符改变计划内容。
async function readBoundedUtf8(stream) {
  if (stream === null || typeof stream !== "object" || stream[Symbol.asyncIterator] === undefined) {
    fail("wakeflow-setup-v3-invalid-stdin", "public stdin must be an async-readable stream");
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    total += bytes.length;
    if (total > WAKEFLOW_SETUP_STDIN_LIMIT) {
      fail("wakeflow-setup-v3-stdin-too-large", "public stdin exceeds its bounded size");
    }
    chunks.push(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch (cause) {
    throw new WakeflowSetupError(
      "wakeflow-setup-v3-invalid-stdin",
      "public stdin is not valid UTF-8",
      { cause },
    );
  }
}

// 只透传三个真实错误家族的稳定 code/message；任意同前缀异常不能伪装成公开错误。
function publicError(error) {
  if (
    error instanceof WakeflowSetupError
    || error instanceof WakeflowMaintenanceCoordinatorError
    || error instanceof WakeflowMaintenanceActionRuntimeError
  ) {
    return Object.freeze({ code: error.code, message: error.message });
  }
  return Object.freeze({
    code: "wakeflow-setup-failed",
    message: "public maintenance request failed inside its bounded coordinator",
  });
}

// setup 只调用注入 coordinator 的唯一 execute，不解释 action，也不直接接触 filesystem owner。
export async function runWakeflowSetup(options = {}) {
  const input = exactKeys(options, ["argv", "rawRequest", "coordinator"], "public setup options");
  parseWakeflowSetupArgv(input.argv);
  const execute = ownCallable(input.coordinator, "execute");
  if (execute === null) {
    fail("wakeflow-setup-v3-invalid-coordinator", "public coordinator is required");
  }
  const request = parseWakeflowSetupRequest(input.rawRequest);
  return execute.call(input.coordinator, request);
}

// stdin adapter 每次只写一个 JSON envelope；maintenance result 保持 coordinator 的既有顶层结构。
export async function runWakeflowSetupStdin(options = {}) {
  const input = exactKeys(
    options,
    ["argv", "stdin", "stdout", "coordinator"],
    "public stdin setup options",
  );
  if (input.stdout === null || typeof input.stdout?.write !== "function") {
    fail("wakeflow-setup-v3-invalid-stdout", "public stdout must provide write()");
  }
  try {
    const rawRequest = await readBoundedUtf8(input.stdin);
    const result = await runWakeflowSetup({
      argv: input.argv,
      rawRequest,
      coordinator: input.coordinator,
    });
    input.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
    return Object.freeze({ exitCode: 0, result });
  } catch (error) {
    const serialized = publicError(error);
    input.stdout.write(`${JSON.stringify({ ok: false, error: serialized }, null, 2)}\n`);
    return Object.freeze({ exitCode: 1, error: serialized });
  }
}

// import 本模块不会执行维护；只有精确脚本启动才从当前 artifact 加载 host/action 依赖。
function isDirectExecution() {
  return typeof process.argv[1] === "string"
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isDirectExecution()) {
  const wakeflowRoot = path.resolve(path.dirname(path.resolve(process.argv[1])), "..");
  try {
    parseWakeflowSetupArgv(process.argv.slice(2));
    const actionHandlers = await loadWakeflowMaintenanceActionHandlers({
      wakeflowRoot,
      hostProfile,
    });
    const coordinator = createWakeflowMaintenanceCoordinator({ actionHandlers });
    const completed = await runWakeflowSetupStdin({
      argv: process.argv.slice(2),
      stdin: process.stdin,
      stdout: process.stdout,
      coordinator,
    });
    process.exitCode = completed.exitCode;
  } catch (error) {
    const serialized = publicError(error);
    process.stdout.write(`${JSON.stringify({ ok: false, error: serialized }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
