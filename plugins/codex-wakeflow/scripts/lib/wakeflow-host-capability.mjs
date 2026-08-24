import path from "node:path";

/**
 * Wakeflow 宿主能力的共享静态合同。
 *
 * Codex 与 Claude Code 的完整 host profile 还拥有各自的 adapter、artifact、
 * handle 与真实宿主操作。本模块只投影 shared core 可以安全消费的窄视图：
 * 协议宿主标识、memory 文件、运行时目录名以及能力声明。它不探测窗口、进程
 * 或 session，也不执行关闭、撤销、激活等宿主动作。
 *
 * `applicable` 只说明某项能力是否适用于该宿主；它不是 `live`、`available`
 * 或执行成功证明。需要真实观察的能力必须继续由对应的宿主 owner 产出证据。
 *
 * 阅读导航：exactObject/projectRequiredDataProperties 分别处理 shared closed object 与
 * host facade 窄投影；normalizeBaseCapability 闭合 applicable/realization 关系；
 * normalizeSettings/normalizeAssets 处理带附加静态数据的两类能力；两个公开 normalize
 * 入口最终产出 host-neutral、深冻结的 capability/profile 视图。
 */
export const HOST_CAPABILITY_NAMES = Object.freeze([
  "identity",
  "pod",
  "keepLive",
  "locator",
  "settings",
  "assets",
  "activity",
  "temp",
  "close",
  "revoke",
  "activation",
]);

/**
 * `realization` 只描述当前代码如何兑现静态能力声明：
 * - `current`：已有当前 owner 实现；
 * - `runtime-probed`：必须结合真实宿主观察后才能判断；
 * - `manual-gate`：机器证据不足，必须保留人工门；
 * - `not-applicable`：该宿主没有这项能力表面。
 */
export const HOST_CAPABILITY_REALIZATIONS = Object.freeze([
  "current",
  "runtime-probed",
  "manual-gate",
  "not-applicable",
]);

// 协议宿主 ID 与其 `.wakeflow-local/runtime/hosts/<hostDirName>` 目录一一对应。
const HOST_DIRECTORY_BY_ID = Object.freeze({
  codex: "codex",
  "claude-code": "claude-code",
});
export const WAKEFLOW_PROTOCOL_HOST_IDS = Object.freeze(Object.keys(HOST_DIRECTORY_BY_ID));
const HOST_IDS = new Set(Object.keys(HOST_DIRECTORY_BY_ID));
const REALIZATION_SET = new Set(HOST_CAPABILITY_REALIZATIONS);

// ==================== 一、共享普通数据与路径合同 ====================

/**
 * 宿主能力静态合同的稳定错误类型；path 指向 shared capability 数据。
 */
export class WakeflowHostCapabilityError extends Error {
  constructor(code, message, { path = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowHostCapabilityError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

// 使用本领域 code/path 拒绝静态 profile，不解释真实宿主状态。
function fail(code, at, message, details = {}) {
  throw new WakeflowHostCapabilityError(code, `${message} at ${at}`, { path: at, details });
}

// 仅接受普通 data object，拒绝数组及带行为的类实例。
function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 对 shared-owned 对象执行精确字段、必填字段和 enumerable data property 校验。
function exactObject(value, at, allowed, required = allowed, {
  unknownKind = "field",
  missingKind = "required field",
} = {}) {
  if (!plainObject(value)) fail("wakeflow-host-capability-type", at, "expected a plain data object");
  const allowedSet = new Set(allowed);
  const entries = [];
  const observed = new Set();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      fail("wakeflow-host-capability-unknown", at, "object fields must use string keys", {
        field: String(key),
        allowed,
      });
    }
    if (!allowedSet.has(key)) {
      fail("wakeflow-host-capability-unknown", `${at}/${key}`, `unknown ${unknownKind} ${key}`, { allowed });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-host-capability-type",
        `${at}/${key}`,
        "fields must be enumerable data properties",
      );
    }
    observed.add(key);
    entries.push([key, descriptor.value]);
  }
  for (const key of required) {
    if (!observed.has(key)) {
      fail("wakeflow-host-capability-missing", `${at}/${key}`, `missing ${missingKind} ${key}`);
    }
  }
  return Object.fromEntries(entries);
}

/**
 * 完整 host profile 是宿主扩展 facade，不能按 shared 字段做 exact-close。
 * 这里只读取本模块真正拥有的字段，并要求这些字段是可枚举 data property，
 * 从而既保留宿主扩展面，也避免归一化过程触发输入 getter。
 */
function projectRequiredDataProperties(value, at, fields) {
  if (!plainObject(value)) fail("wakeflow-host-capability-type", at, "expected a plain data object");
  return Object.fromEntries(fields.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      fail("wakeflow-host-capability-missing", `${at}/${key}`, `missing required field ${key}`);
    }
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-host-capability-type",
        `${at}/${key}`,
        "fields must be enumerable data properties",
      );
    }
    return [key, descriptor.value];
  }));
}

// 校验无首尾空白的静态文本字段。
function nonEmptyString(value, at) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    fail("wakeflow-host-capability-type", at, "expected a non-empty string without outer whitespace");
  }
  return value;
}

// 校验保持在所属根内的 canonical portable relative path。
function portableRelativePath(value, at) {
  const candidate = nonEmptyString(value, at);
  if (
    candidate.includes("\\")
    || candidate.includes("\0")
    || /[\r\n]/u.test(candidate)
    || path.posix.isAbsolute(candidate)
    || /^[A-Za-z]:\//u.test(candidate)
    || path.posix.normalize(candidate) !== candidate
    || candidate === "."
    || candidate === ".."
    || candidate.startsWith("../")
  ) {
    fail("wakeflow-host-capability-type", at, "expected a canonical portable relative path", { value: candidate });
  }
  return candidate;
}

// 校验只能作为单个文件/目录名称使用的 portable component。
function portableComponent(value, at) {
  const candidate = nonEmptyString(value, at);
  if (
    candidate === "."
    || candidate === ".."
    || candidate.includes("/")
    || candidate.includes("\\")
    || candidate.includes("\0")
    || /[\r\n]/u.test(candidate)
    || path.posix.basename(candidate) !== candidate
  ) {
    fail("wakeflow-host-capability-type", at, "expected one safe portable path component", { value: candidate });
  }
  return candidate;
}

// ==================== 二、Capability 语义归一化 ====================

// 闭合 applicable 与 realization 的一致性，同时把领域附加字段留给专用 normalizer。
function normalizeBaseCapability(value, at, extraAllowed = []) {
  const fields = exactObject(value, at, ["applicable", "realization", ...extraAllowed]);
  if (typeof fields.applicable !== "boolean") {
    fail("wakeflow-host-capability-type", `${at}/applicable`, "applicable must be boolean");
  }
  if (!REALIZATION_SET.has(fields.realization)) {
    fail("wakeflow-host-capability-type", `${at}/realization`, "unknown capability realization", {
      value: fields.realization,
      allowed: HOST_CAPABILITY_REALIZATIONS,
    });
  }
  if (fields.applicable !== (fields.realization !== "not-applicable")) {
    fail(
      "wakeflow-host-capability-contradiction",
      `${at}/realization`,
      "not-applicable realization must exactly match applicable=false",
      { applicable: fields.applicable, realization: fields.realization },
    );
  }
  return {
    normalized: { applicable: fields.applicable, realization: fields.realization },
    fields,
  };
}

// 规范化 settings 的 portable/local 路径，并与 applicable 状态保持完全一致。
function normalizeSettings(value, at) {
  const { normalized: base, fields } = normalizeBaseCapability(value, at, ["paths"]);
  const pathsInput = exactObject(fields.paths, `${at}/paths`, ["portable", "local"]);
  const normalizePath = (setting, name) => setting === null
    ? null
    : portableRelativePath(setting, `${at}/paths/${name}`);
  const paths = {
    portable: normalizePath(pathsInput.portable, "portable"),
    local: normalizePath(pathsInput.local, "local"),
  };
  if (!base.applicable && (paths.portable !== null || paths.local !== null)) {
    fail(
      "wakeflow-host-capability-contradiction",
      `${at}/paths`,
      "a non-applicable settings capability cannot declare settings paths",
    );
  }
  if (base.applicable && (paths.portable === null || paths.local === null)) {
    fail(
      "wakeflow-host-capability-contradiction",
      `${at}/paths`,
      "an applicable settings capability requires portable and local paths",
    );
  }
  return { ...base, paths };
}

// 规范化 asset statusline 文件名，并拒绝 applicable 与静态数据互相矛盾。
function normalizeAssets(value, at) {
  const { normalized: base, fields } = normalizeBaseCapability(value, at, ["statuslineFileName"]);
  const statuslineFileName = fields.statuslineFileName === null
    ? null
    : portableComponent(fields.statuslineFileName, `${at}/statuslineFileName`);
  if (!base.applicable && statuslineFileName !== null) {
    fail(
      "wakeflow-host-capability-contradiction",
      `${at}/statuslineFileName`,
      "a non-applicable asset capability cannot declare a statusline filename",
    );
  }
  if (base.applicable && statuslineFileName === null) {
    fail(
      "wakeflow-host-capability-contradiction",
      `${at}/statuslineFileName`,
      "an applicable asset capability requires a statusline filename",
    );
  }
  return { ...base, statuslineFileName };
}

// 深冻结 shared projection，避免宿主 facade 后续修改已验证能力事实。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * 规范化完整、闭合的能力表。
 * 每个协议能力必须出现；本入口只验证静态 applicability/realization，不做 live probe。
 */
export function normalizeWakeflowHostCapabilities(value, at = "$/capabilities") {
  const capabilities = exactObject(value, at, HOST_CAPABILITY_NAMES, HOST_CAPABILITY_NAMES, {
    unknownKind: "capability",
    missingKind: "capability",
  });
  return deepFreeze(Object.fromEntries(HOST_CAPABILITY_NAMES.map((name) => {
    const capabilityAt = `${at}/${name}`;
    if (name === "settings") return [name, normalizeSettings(capabilities[name], capabilityAt)];
    if (name === "assets") return [name, normalizeAssets(capabilities[name], capabilityAt)];
    return [name, normalizeBaseCapability(capabilities[name], capabilityAt).normalized];
  })));
}

/**
 * 从可扩展 host profile 中投影 shared core 所需的窄视图。
 * 宿主自有 adapter、locator、handle 与 effect 字段不会进入返回值。
 */
export function normalizeWakeflowHostCapabilityProfile(profile) {
  const fields = projectRequiredDataProperties(
    profile,
    "$",
    ["hostId", "memoryFile", "runtime", "capabilities"],
  );
  const runtime = projectRequiredDataProperties(fields.runtime, "$/runtime", ["hostDirName"]);
  if (!HOST_IDS.has(fields.hostId)) {
    fail("wakeflow-host-capability-host", "$/hostId", "hostId must be a Wakeflow protocol host", {
      value: fields.hostId,
      allowed: [...HOST_IDS],
    });
  }
  const memoryFile = portableComponent(fields.memoryFile, "$/memoryFile");
  const hostDirName = portableComponent(runtime.hostDirName, "$/runtime/hostDirName");
  if (hostDirName !== HOST_DIRECTORY_BY_ID[fields.hostId]) {
    fail(
      "wakeflow-host-capability-contradiction",
      "$/runtime/hostDirName",
      "host runtime directory must match the protocol host identity",
      { hostId: fields.hostId, expected: HOST_DIRECTORY_BY_ID[fields.hostId], actual: hostDirName },
    );
  }
  return deepFreeze({
    hostId: fields.hostId,
    memoryFile,
    hostDirName,
    capabilities: normalizeWakeflowHostCapabilities(fields.capabilities),
  });
}
