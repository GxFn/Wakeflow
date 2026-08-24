import { spawnSync } from "node:child_process";
import path from "node:path";

const defaultSpawnSyncMaxBuffer = 64 * 1024 * 1024;
const maxSpawnSyncTimeout = 120_000;
const allowedOptionKeys = new Set([
  "encoding",
  "env",
  "maxBuffer",
  "shell",
  "stdio",
  "timeout",
  "windowsHide",
]);

// 当前唯一 Git 消费者是 observability：它只需要以下六种固定、只读查询。
// 这里保存完整尾参数，而不是按 subcommand 放行，避免以后调用者借 `git` 边界执行写操作。
const allowedGitQueryTails = Object.freeze([
  Object.freeze(["rev-parse", "--is-inside-work-tree"]),
  Object.freeze(["rev-parse", "--show-toplevel"]),
  Object.freeze(["rev-parse", "--verify", "HEAD"]),
  Object.freeze(["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=none"]),
  Object.freeze(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
  Object.freeze(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
]);

const darwinProcessIdentityFields = new Set([
  "command",
  "comm",
  "lstart",
  "ppid",
]);

/**
 * Wakeflow 的同步系统进程边界。
 *
 * 能力导航：
 * - observability 通过它读取固定 Git 快照，不执行 Git mutation；
 * - process-identity 通过它读取 Darwin 指定 PID 的四个身份字段；
 * - shell、Node 脚本、MCP launcher、keep-live 与任意其他命令都不属于本模块当前职责。
 */

// 校验命令模板后同步执行，并给潜在的大型只读 Git 状态结果提供统一缓冲上限。
export function runSync(command, args, options = {}) {
  const prepared = prepareProcessRequest(command, args, options);
  return spawnSync(prepared.command, prepared.args, prepared.options);
}

// 将调用约束成当前代码真实使用的精确模板；返回值仅供 runSync 执行和边界测试观察。
export function prepareWakeflowCommand(command, args, options = {}) {
  const prepared = prepareProcessRequest(command, args, options);
  return Object.freeze({
    kind: prepared.kind,
    command: prepared.command,
    args: prepared.args,
  });
}

// 在任何字段读取和子进程执行前，把命令、参数和options收敛为被动快照。
function prepareProcessRequest(command, args, options) {
  if (typeof command !== "string") {
    throw new Error("Wakeflow process command must be a string");
  }
  const safeArgs = snapshotStringArray(args, "args");
  const safeOptions = snapshotSpawnSyncOptions(options);
  if (command === "git") {
    assertGitQueryArgs(safeArgs);
    return Object.freeze({
      kind: "git",
      command,
      args: safeArgs,
      options: finalizeSpawnSyncOptions("git", safeOptions),
    });
  }
  if (process.platform === "darwin" && command === "/bin/ps") {
    assertDarwinProcessIdentityArgs(safeArgs);
    return Object.freeze({
      kind: "ps-process-identity",
      command,
      args: safeArgs,
      options: finalizeSpawnSyncOptions("ps-process-identity", safeOptions),
    });
  }
  throw new Error(`Unsupported Wakeflow process command: ${command}`);
}

// 只接受当前两个production consumer真实使用的spawnSync选项，拒绝accessor、隐藏字段和扩展原型。
function snapshotSpawnSyncOptions(value) {
  const descriptors = passiveRecordDescriptors(value, "options");
  const snapshot = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowedOptionKeys.has(key)) {
      throw new Error("Wakeflow process options contain an unsupported field");
    }
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(`Wakeflow process option ${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  if (snapshot.encoding !== undefined && snapshot.encoding !== "utf8") {
    throw new Error("Wakeflow process encoding must be utf8");
  }
  if (snapshot.shell !== undefined && snapshot.shell !== false) {
    throw new Error("Wakeflow process execution forbids shell mode");
  }
  if (
    snapshot.timeout !== undefined
    && (!Number.isSafeInteger(snapshot.timeout) || snapshot.timeout <= 0 || snapshot.timeout > maxSpawnSyncTimeout)
  ) {
    throw new Error(`Wakeflow process timeout must be an integer from 1 to ${maxSpawnSyncTimeout}`);
  }
  if (
    snapshot.maxBuffer !== undefined
    && (
      !Number.isSafeInteger(snapshot.maxBuffer)
      || snapshot.maxBuffer <= 0
      || snapshot.maxBuffer > defaultSpawnSyncMaxBuffer
    )
  ) {
    throw new Error(`Wakeflow process maxBuffer must be an integer from 1 to ${defaultSpawnSyncMaxBuffer}`);
  }
  if (snapshot.windowsHide !== undefined && typeof snapshot.windowsHide !== "boolean") {
    throw new Error("Wakeflow process windowsHide must be boolean");
  }
  if (snapshot.stdio !== undefined) {
    const stdio = snapshotStringArray(snapshot.stdio, "options.stdio");
    if (
      stdio.length !== 3
      || stdio[0] !== "ignore"
      || stdio[1] !== "pipe"
      || stdio[2] !== "pipe"
    ) {
      throw new Error("Wakeflow process stdio must be exactly ignore/pipe/pipe");
    }
    snapshot.stdio = stdio;
  }
  if (snapshot.env !== undefined) {
    snapshot.env = snapshotEnvironment(snapshot.env);
  }
  return Object.freeze(snapshot);
}

function finalizeSpawnSyncOptions(kind, options) {
  const finalized = {
    ...options,
    maxBuffer: options.maxBuffer ?? defaultSpawnSyncMaxBuffer,
  };
  if (kind === "git") {
    finalized.env = gitReadOnlyEnvironment(options.env);
  }
  return Object.freeze(finalized);
}

function passiveRecordDescriptors(value, label) {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label} must be a passive plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a passive plain object`);
  }
  return Object.getOwnPropertyDescriptors(value);
}

function snapshotStringArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error(`${label} must be a standard dense array of strings`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error(`${label} must not contain symbol fields`);
  }
  const lengthDescriptor = descriptors.length;
  if (
    lengthDescriptor === undefined
    || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    throw new Error(`${label} length must be passive`);
  }
  const length = lengthDescriptor.value;
  const snapshot = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined
      || !("value" in descriptor)
      || !descriptor.enumerable
      || typeof descriptor.value !== "string"
    ) {
      throw new Error(`${label} must be a standard dense array of strings`);
    }
    snapshot.push(descriptor.value);
  }
  if (keys.length !== length + 1) {
    throw new Error(`${label} must not contain extra fields`);
  }
  return Object.freeze(snapshot);
}

function snapshotEnvironment(value) {
  const descriptors = passiveRecordDescriptors(value, "options.env");
  const snapshot = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (
      typeof key !== "string"
      || key === ""
      || key.includes("=")
      || key.includes("\0")
      || !("value" in descriptor)
      || !descriptor.enumerable
      || typeof descriptor.value !== "string"
      || descriptor.value.includes("\0")
    ) {
      throw new Error("Wakeflow process environment must contain only enumerable string data properties");
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

// Git不继承任何可重定向仓库、配置、trace或helper行为的GIT_*变量，只补只读运行所需固定值。
function gitReadOnlyEnvironment(environment) {
  const source = environment ?? { ...process.env };
  const sanitized = Object.create(null);
  for (const [key, value] of Object.entries(source)) {
    if (!key.toUpperCase().startsWith("GIT_")) sanitized[key] = value;
  }
  sanitized.GIT_CONFIG_NOSYSTEM = "1";
  sanitized.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  sanitized.GIT_OPTIONAL_LOCKS = "0";
  sanitized.GIT_TERMINAL_PROMPT = "0";
  return Object.freeze(sanitized);
}

// Git 必须显式绑定目标目录，并且尾参数逐项匹配 observability 的固定只读查询。
function assertGitQueryArgs(args) {
  const root = args[1];
  const tail = args.slice(2);
  const matchesKnownQuery = allowedGitQueryTails.some((expected) => (
    expected.length === tail.length
    && expected.every((value, index) => value === tail[index])
  ));
  if (
    args[0] !== "-C"
    || typeof root !== "string"
    || !path.isAbsolute(root)
    || path.normalize(root) !== root
    || !matchesKnownQuery
  ) {
    throw new Error("Unsupported Wakeflow Git observation query");
  }
}

// Darwin 仅允许对正 PID 读取 command/comm/lstart/ppid，不能枚举全机进程或读取环境字段。
function assertDarwinProcessIdentityArgs(args) {
  const field = typeof args[1] === "string" && args[1].endsWith("=")
    ? args[1].slice(0, -1)
    : "";
  if (
    args.length !== 4
    || args[0] !== "-o"
    || !darwinProcessIdentityFields.has(field)
    || args[2] !== "-p"
    || !/^[1-9][0-9]*$/u.test(args[3] ?? "")
  ) {
    throw new Error("Unsupported Wakeflow Darwin process-identity ps arguments");
  }
}
