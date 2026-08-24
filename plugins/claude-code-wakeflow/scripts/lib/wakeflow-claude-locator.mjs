/**
 * Claude Code 窗口 locator 与逐窗口宿主操作互斥量的宿主专属 owner。
 *
 * 能力导航：
 * - 记录合同：校验并规范化稳定 window/binding/locator ID 与最小 tmux 坐标。
 * - 物理观察：把宿主 adapter 提供的 pane 事实收敛为 live/missing/drift 等有限状态。
 * - 私有库存：安全读取 locator 与 operation lock，关联当前 config 和 window binding authority。
 * - 操作互斥：在 shared runtime mutation 内为单窗口签发、持有、释放或恢复进程身份锁。
 * - CAS 写入：只有持有已签发窗口操作上下文时，才可提交或删除一个 locator generation。
 * - endpoint 证明：send/readback 前重新验证 binding、locator、锁和唯一 live pane。
 *
 * 本文件不创建或关闭 tmux/Claude 进程，不拥有 window binding、config、transport、业务状态或
 * workspace 级 maintenance；这些动作分别留给 lifecycle adapter 与对应 shared owner。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  atomicWriteFile,
  sha256Bytes,
} from "./wakeflow-atomic-write.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  captureWakeflowProcessIdentity,
  probeWakeflowProcessIdentity,
} from "./wakeflow-process-identity.mjs";
import {
  inspectWindowBindingInventory,
  inspectWindowBindingInventoryForProtocolHost,
} from "./wakeflow-window-binding-service.mjs";
import { withWakeflowRuntimeMutation } from "./wakeflow-workspace-mutation.mjs";

export const WAKEFLOW_CLAUDE_WINDOW_LOCATOR_KIND = "WakeflowClaudeWindowLocator";
export const WAKEFLOW_CLAUDE_WINDOW_LOCATOR_SCHEMA_VERSION = 1;

const HOST_ID = "claude-code";
const PROVIDER = "tmux";
const OPERATION_LOCK_KIND = "WakeflowClaudeWindowOperationLock";
const OPERATION_LOCK_SCHEMA_VERSION = 1;
const LOCATOR_ID_RE = /^locator_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPERATION_ID_RE = /^claude-operation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BINDING_ID_RE = /^binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const SOCKET_NAME_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,128}$/u;
const TMUX_WINDOW_ID_RE = /^@[0-9]+$/u;
const TMUX_PANE_ID_RE = /^%[0-9]+$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const OPERATION_KINDS = new Set([
  "launch",
  "resume",
  "replace",
  "close",
  "retitle",
  "arrange",
  "send",
  "readback",
  "reconcile",
]);
const LOCATOR_COMMIT_OPERATION_KINDS = new Set(["launch", "resume", "replace", "reconcile"]);
const LOCATOR_REMOVE_OPERATION_KINDS = new Set(["replace", "close", "reconcile"]);
const MAX_LOCATORS = 4_096;
const MAX_RECORD_BYTES = 64 * 1_024;
const ISSUED_OPERATION_CONTEXTS = new WeakMap();
const ISSUED_OBSERVATIONS = new WeakMap();

/** 统一承载 locator owner 的稳定错误码、脱敏细节和内部 cause。 */
export class WakeflowClaudeLocatorError extends Error {
  constructor(code, message, { cause, details = {} } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowClaudeLocatorError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowClaudeLocatorError(code, message, { cause, details });
}

function boundary(label, cause, code = "wakeflow-claude-locator-operation") {
  if (cause instanceof WakeflowClaudeLocatorError) throw cause;
  fail(code, `${label} failed`, {}, cause);
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

// 数组元素只有在确认标准原型、连续own data索引且无额外字段后才允许读取。
function exactDataArray(value, label, maximum, code) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(code, `${label} must be one standard array`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    value.length > maximum
    || keys.length !== value.length + 1
    || keys.at(-1) !== "length"
  ) {
    fail(code, `${label} must be bounded, dense and have no extra fields`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      keys[index] !== key
      || !descriptor?.enumerable
      || !Object.hasOwn(descriptor, "value")
    ) {
      fail(code, `${label}[${index}] must be one enumerable data property`);
    }
  }
  return value;
}

function exactDataObject(value, required, optional, label) {
  if (!plainObject(value)) fail("wakeflow-claude-locator-contract", `${label} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("wakeflow-claude-locator-contract", `${label} has an unknown field`, {
        field: String(key),
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-claude-locator-contract", `${label}.${key} must be one enumerable data property`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-claude-locator-contract", `${label} is missing ${key}`);
    }
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function typedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, `$/${label}`);
  } catch (cause) {
    fail("wakeflow-claude-locator-identifier", `${label} must be one typed ${type} ID`, {}, cause);
  }
}

function bindingId(value, label = "bindingId") {
  if (typeof value !== "string" || !BINDING_ID_RE.test(value)) {
    fail("wakeflow-claude-locator-identifier", `${label} must be one window binding ID`);
  }
  return value;
}

function locatorId(value, label = "locatorId") {
  if (typeof value !== "string" || !LOCATOR_ID_RE.test(value)) {
    fail("wakeflow-claude-locator-identifier", `${label} must match locator_<lowercase UUID v4>`);
  }
  return value;
}

function operationId(value, label = "operationId") {
  if (typeof value !== "string" || !OPERATION_ID_RE.test(value)) {
    fail("wakeflow-claude-locator-identifier", `${label} must match claude-operation_<lowercase UUID v4>`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-claude-locator-digest", `${label} must be one sha256 digest`);
  }
  return value;
}

function timestamp(value, label) {
  const match = typeof value === "string" ? value.match(TIMESTAMP_RE) : null;
  if (!match) fail("wakeflow-claude-locator-timestamp", `${label} must be a strict UTC RFC3339 timestamp`);
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(0);
  parsed.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  parsed.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)
  ) {
    fail("wakeflow-claude-locator-timestamp", `${label} must name a real UTC instant`);
  }
  return value;
}

function boundedToken(value, label, maximum = 128) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || [...value].length > maximum
    || CONTROL_RE.test(value)
  ) {
    fail("wakeflow-claude-locator-coordinate", `${label} must be bounded, trimmed and control-free`);
  }
  return value;
}

function socketName(value, label = "socketName") {
  if (value === null) return null;
  if (typeof value !== "string" || !SOCKET_NAME_RE.test(value)) {
    fail(
      "wakeflow-claude-locator-coordinate",
      `${label} must be null for the default server or one safe tmux socket name`,
    );
  }
  return value;
}

function tmuxWindowId(value, label = "tmux.windowId") {
  if (typeof value !== "string" || !TMUX_WINDOW_ID_RE.test(value)) {
    fail("wakeflow-claude-locator-coordinate", `${label} must be an exact tmux @window id`);
  }
  return value;
}

function tmuxPaneId(value, label = "tmux.paneId") {
  if (typeof value !== "string" || !TMUX_PANE_ID_RE.test(value)) {
    fail("wakeflow-claude-locator-coordinate", `${label} must be an exact tmux %pane id`);
  }
  return value;
}

function normalizeTmux(value, label = "tmux") {
  exactDataObject(value, ["socketName", "sessionName", "windowId", "paneId"], [], label);
  return deepFreeze({
    socketName: socketName(value.socketName, `${label}.socketName`),
    sessionName: boundedToken(value.sessionName, `${label}.sessionName`),
    windowId: tmuxWindowId(value.windowId, `${label}.windowId`),
    paneId: tmuxPaneId(value.paneId, `${label}.paneId`),
  });
}

/** 从UUID v4源生成新的locator generation ID；不读取workspace状态。 */
export function generateClaudeWindowLocatorId(uuidFactory = randomUUID) {
  if (typeof uuidFactory !== "function") {
    fail("wakeflow-claude-locator-id-generator", "locator UUID source must be a function");
  }
  let uuid;
  try {
    uuid = uuidFactory();
  } catch (cause) {
    fail("wakeflow-claude-locator-id-generator", "locator UUID source failed", {}, cause);
  }
  return locatorId(`locator_${uuid}`, "generated locatorId");
}

/** 校验并冻结磁盘上唯一允许的最小 Claude locator 记录。 */
export function validateClaudeWindowLocatorRecord(value) {
  exactDataObject(value, [
    "kind",
    "schemaVersion",
    "programId",
    "hostId",
    "windowId",
    "bindingId",
    "locatorId",
    "provider",
    "tmux",
    "locatedAt",
  ], [], "Claude window locator");
  if (value.kind !== WAKEFLOW_CLAUDE_WINDOW_LOCATOR_KIND) {
    fail("wakeflow-claude-locator-kind", "Claude window locator kind is invalid");
  }
  if (value.schemaVersion !== WAKEFLOW_CLAUDE_WINDOW_LOCATOR_SCHEMA_VERSION) {
    fail("wakeflow-claude-locator-schema-version", "Claude window locator schemaVersion is invalid");
  }
  if (value.hostId !== HOST_ID) {
    fail("wakeflow-claude-locator-host", "Claude window locator hostId must be claude-code");
  }
  if (value.provider !== PROVIDER) {
    fail("wakeflow-claude-locator-provider", "Claude window locator provider must be tmux");
  }
  return deepFreeze({
    kind: WAKEFLOW_CLAUDE_WINDOW_LOCATOR_KIND,
    schemaVersion: WAKEFLOW_CLAUDE_WINDOW_LOCATOR_SCHEMA_VERSION,
    programId: typedId(value.programId, "program", "programId"),
    hostId: HOST_ID,
    windowId: typedId(value.windowId, "window", "windowId"),
    bindingId: bindingId(value.bindingId),
    locatorId: locatorId(value.locatorId),
    provider: PROVIDER,
    tmux: normalizeTmux(value.tmux),
    locatedAt: timestamp(value.locatedAt, "locatedAt"),
  });
}

/** 从owner输入构造一条完整locator记录；不执行任何物理写入。 */
export function createClaudeWindowLocatorRecord(value = {}) {
  exactDataObject(value, [
    "programId",
    "windowId",
    "bindingId",
    "locatorId",
    "tmux",
    "locatedAt",
  ], [], "Claude window locator input");
  return validateClaudeWindowLocatorRecord({
    kind: WAKEFLOW_CLAUDE_WINDOW_LOCATOR_KIND,
    schemaVersion: WAKEFLOW_CLAUDE_WINDOW_LOCATOR_SCHEMA_VERSION,
    programId: value.programId,
    hostId: HOST_ID,
    windowId: value.windowId,
    bindingId: value.bindingId,
    locatorId: value.locatorId,
    provider: PROVIDER,
    tmux: value.tmux,
    locatedAt: value.locatedAt,
  });
}

/** 返回locator owner的canonical UTF-8落盘字节。 */
export function claudeWindowLocatorCanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(validateClaudeWindowLocatorRecord(value))}\n`, "utf8");
}

/** 返回覆盖完整locator generation与tmux坐标的canonical digest。 */
export function claudeWindowLocatorDigest(value) {
  return canonicalJsonDigest(validateClaudeWindowLocatorRecord(value));
}

/** 从stable window ID派生唯一portable locator ref。 */
export function claudeWindowLocatorRef(value = {}) {
  exactDataObject(value, ["windowId"], [], "Claude window locator ref input");
  const windowId = typedId(value.windowId, "window", "windowId");
  return `.wakeflow-local/runtime/hosts/${HOST_ID}/operations/window-locators/${windowId}.json`;
}

function operationLockRef(windowIdValue) {
  const windowId = typedId(windowIdValue, "window", "windowId");
  return `.wakeflow-local/runtime/hosts/${HOST_ID}/operations/window-locators/${windowId}.lock`;
}

function normalizeBindingTuple(value, label = "binding") {
  exactDataObject(value, ["programId", "hostId", "windowId", "bindingId"], [], label);
  if (value.hostId !== HOST_ID) fail("wakeflow-claude-locator-host", `${label}.hostId must be claude-code`);
  return deepFreeze({
    programId: typedId(value.programId, "program", `${label}.programId`),
    hostId: HOST_ID,
    windowId: typedId(value.windowId, "window", `${label}.windowId`),
    bindingId: bindingId(value.bindingId, `${label}.bindingId`),
  });
}

function normalizeMetadata(value, label) {
  exactDataObject(value, [
    "programId",
    "hostId",
    "windowId",
    "bindingId",
    "locatorId",
  ], [], label);
  if (value.hostId !== HOST_ID) fail("wakeflow-claude-locator-host", `${label}.hostId must be claude-code`);
  return deepFreeze({
    programId: typedId(value.programId, "program", `${label}.programId`),
    hostId: HOST_ID,
    windowId: typedId(value.windowId, "window", `${label}.windowId`),
    bindingId: bindingId(value.bindingId, `${label}.bindingId`),
    locatorId: locatorId(value.locatorId, `${label}.locatorId`),
  });
}

function normalizeObservation(value, label) {
  exactDataObject(value, [
    "provider",
    "socketName",
    "sessionName",
    "windowId",
    "paneId",
    "paneWindowId",
    "paneDead",
    "claudeProcess",
    "metadata",
  ], [], label);
  if (value.provider !== PROVIDER) {
    fail("wakeflow-claude-locator-observation", `${label}.provider must be tmux`);
  }
  if (typeof value.paneDead !== "boolean" || typeof value.claudeProcess !== "boolean") {
    fail("wakeflow-claude-locator-observation", `${label} booleans are invalid`);
  }
  return deepFreeze({
    provider: PROVIDER,
    socketName: socketName(value.socketName, `${label}.socketName`),
    sessionName: boundedToken(value.sessionName, `${label}.sessionName`),
    windowId: tmuxWindowId(value.windowId, `${label}.windowId`),
    paneId: tmuxPaneId(value.paneId, `${label}.paneId`),
    paneWindowId: tmuxWindowId(value.paneWindowId, `${label}.paneWindowId`),
    paneDead: value.paneDead,
    claudeProcess: value.claudeProcess,
    metadata: normalizeMetadata(value.metadata, `${label}.metadata`),
  });
}

// 全tmux inventory可含没有Wakeflow metadata的普通pane；先被动投影，再只严格解析相关候选。
function passiveObservationForRelation(value, label) {
  const fields = [
    "provider",
    "socketName",
    "sessionName",
    "windowId",
    "paneId",
    "paneWindowId",
    "paneDead",
    "claudeProcess",
    "metadata",
  ];
  exactDataObject(value, fields, [], label);
  const entry = Object.fromEntries(fields.map((field) => [
    field,
    Object.getOwnPropertyDescriptor(value, field).value,
  ]));
  const metadataFields = ["programId", "hostId", "windowId", "bindingId", "locatorId"];
  exactDataObject(entry.metadata, metadataFields, [], `${label}.metadata`);
  const metadata = Object.fromEntries(metadataFields.map((field) => [
    field,
    Object.getOwnPropertyDescriptor(entry.metadata, field).value,
  ]));
  return deepFreeze({ ...entry, metadata });
}

function sameTuple(left, right, fields) {
  return fields.every((field) => left[field] === right[field]);
}

function observationResult(locator, status) {
  const result = deepFreeze({
    kind: "WakeflowClaudeWindowLocatorObservation",
    schemaVersion: 1,
    windowId: locator.windowId,
    bindingId: locator.bindingId,
    locatorId: locator.locatorId,
    status,
    authorityEligible: status === "live",
  });
  ISSUED_OBSERVATIONS.set(result, Object.freeze({
    locatorDigest: claudeWindowLocatorDigest(locator),
    status,
  }));
  return result;
}

function issuedObservationEvidence(value, label) {
  const evidence = ISSUED_OBSERVATIONS.get(value);
  if (!evidence) {
    fail("wakeflow-claude-locator-observation", `${label} requires an issued locator observation`);
  }
  return evidence;
}

/**
 * 将调用方提供的宿主pane事实分类为有限状态并签发不可伪造的观察结果。
 * 该结果证明的是完整locator digest，而不只是可碰撞复用的三个公开ID。
 */
export function inspectClaudeWindowLocatorObservation(value = {}) {
  exactDataObject(
    value,
    ["locator", "binding", "expectedSocketName", "observations"],
    [],
    "Claude locator observation input",
  );
  const locator = validateClaudeWindowLocatorRecord(value.locator);
  const binding = normalizeBindingTuple(value.binding);
  const expectedSocketName = socketName(value.expectedSocketName, "expectedSocketName");
  if (!sameTuple(locator, binding, ["programId", "hostId", "windowId", "bindingId"])) {
    return observationResult(locator, "binding-mismatch");
  }
  if (locator.tmux.socketName !== expectedSocketName) {
    return observationResult(locator, "host-context-drift");
  }
  exactDataArray(
    value.observations,
    "observations",
    16,
    "wakeflow-claude-locator-observation",
  );
  const observations = value.observations.map((entry, index) => (
    normalizeObservation(entry, `observations[${index}]`)
  ));
  if (observations.length === 0) return observationResult(locator, "missing");
  if (observations.length > 1) return observationResult(locator, "duplicate");
  const [observed] = observations;
  if (
    observed.provider !== locator.provider
    || observed.socketName !== locator.tmux.socketName
    || observed.sessionName !== locator.tmux.sessionName
    || observed.windowId !== locator.tmux.windowId
    || observed.paneId !== locator.tmux.paneId
  ) {
    return observationResult(locator, "coordinate-mismatch");
  }
  if (observed.paneWindowId !== locator.tmux.windowId) {
    return observationResult(locator, "pane-window-mismatch");
  }
  if (observed.paneDead) return observationResult(locator, "pane-dead");
  if (!observed.claudeProcess) return observationResult(locator, "process-mismatch");
  if (!sameTuple(observed.metadata, locator, [
    "programId",
    "hostId",
    "windowId",
    "bindingId",
    "locatorId",
  ])) {
    return observationResult(locator, "metadata-mismatch");
  }
  return observationResult(locator, "live");
}

function normalizeWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value.trim()
    || value !== value.trim()
    || CONTROL_RE.test(value)
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) {
    fail("wakeflow-claude-locator-input", "workspaceRoot must be one normalized absolute path");
  }
  const root = value;
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch (cause) {
    fail("wakeflow-claude-locator-layout", "workspace root is unavailable", {}, cause);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-claude-locator-layout", "workspace root must be one real directory");
  }
  try {
    return fs.realpathSync(root);
  } catch (cause) {
    fail("wakeflow-claude-locator-layout", "workspace root cannot be resolved", {}, cause);
  }
}

function absoluteRef(workspaceRoot, ref) {
  const absolute = path.resolve(workspaceRoot, ...ref.split("/"));
  if (!absolute.startsWith(`${workspaceRoot}${path.sep}`)) {
    fail("wakeflow-claude-locator-layout", "locator ref escaped the workspace root");
  }
  return absolute;
}

function modeOf(stat) {
  return Number(stat.mode & 0o777n);
}

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail("wakeflow-claude-locator-platform", "Claude locator storage requires POSIX ownership semantics");
  }
  return BigInt(process.geteuid());
}

function sameStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameNode(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.nlink === right.nlink;
}

function sourceIdentity(stat) {
  return Object.freeze({
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
    mode: String(stat.mode),
    uid: String(stat.uid),
    gid: String(stat.gid),
    linkCount: String(stat.nlink),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  });
}

function assertPrivateDirectoryChain(workspaceRoot, ref, { allowMissingLeaf = false } = {}) {
  const euid = currentEuid();
  let current = workspaceRoot;
  const parts = ref.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let stat;
    try {
      stat = fs.lstatSync(current, { bigint: true });
    } catch (cause) {
      if (cause?.code === "ENOENT" && allowMissingLeaf && index === parts.length - 1) return null;
      fail("wakeflow-claude-locator-layout", `private locator directory is unavailable: ${ref}`, {}, cause);
    }
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || stat.uid !== euid
      || modeOf(stat) !== 0o700
    ) {
      fail("wakeflow-claude-locator-layout", `private locator directory is unsafe: ${ref}`);
    }
  }
  let resolved;
  try {
    resolved = fs.realpathSync(current);
  } catch (cause) {
    fail("wakeflow-claude-locator-layout", `private locator directory cannot be resolved: ${ref}`, {}, cause);
  }
  if (!resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
    fail("wakeflow-claude-locator-layout", `private locator directory escaped the workspace: ${ref}`);
  }
  return current;
}

// owner记录只接受canonical、strict UTF-8、0600、single-link且稳定不变的bounded文件。
function parseStrictJson(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    fail("wakeflow-claude-locator-storage", `${label} is not strict UTF-8`, {}, cause);
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    fail("wakeflow-claude-locator-storage", `${label} is not valid JSON`, {}, cause);
  }
}

function stableReadRecord(workspaceRoot, ref, codec, canonicalBytes, label) {
  const file = absoluteRef(workspaceRoot, ref);
  let before;
  try {
    before = fs.lstatSync(file, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    fail("wakeflow-claude-locator-storage", `${label} cannot be inspected`, {}, cause);
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.uid !== currentEuid()
    || before.nlink !== 1n
    || modeOf(before) !== 0o600
    || before.size > BigInt(MAX_RECORD_BYTES)
  ) {
    fail(
      "wakeflow-claude-locator-storage",
      `${label} must be one bounded current-euid single-link 0600 file`,
    );
  }
  let descriptor = null;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!sameStat(before, opened)) {
      fail("wakeflow-claude-locator-storage", `${label} changed while being opened`);
    }
    const buffer = Buffer.alloc(Number(opened.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const afterDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const after = fs.lstatSync(file, { bigint: true });
    if (
      offset !== Number(opened.size)
      || !sameStat(opened, afterDescriptor)
      || !sameStat(opened, after)
    ) {
      fail("wakeflow-claude-locator-storage", `${label} changed while being read`);
    }
    const bytes = buffer.subarray(0, offset);
    let record;
    try {
      record = codec(parseStrictJson(bytes, label));
    } catch (cause) {
      if (cause instanceof WakeflowClaudeLocatorError) throw cause;
      fail("wakeflow-claude-locator-storage", `${label} failed its owner codec`, {}, cause);
    }
    let canonical;
    try {
      canonical = canonicalBytes(record);
    } catch (cause) {
      fail("wakeflow-claude-locator-storage", `${label} cannot be canonically encoded`, {}, cause);
    }
    if (!bytes.equals(canonical)) {
      fail("wakeflow-claude-locator-storage", `${label} bytes are not canonical`);
    }
    return Object.freeze({
      ref,
      file,
      record,
      bytes,
      sha256: sha256Bytes(bytes),
      stat: after,
      sourceIdentity: sourceIdentity(after),
    });
  } catch (cause) {
    if (cause instanceof WakeflowClaudeLocatorError) throw cause;
    boundary(label, cause, "wakeflow-claude-locator-storage");
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The source was already classified from the open descriptor.
      }
    }
  }
  return null;
}

// 目录项在读取过程中即执行上限，不先把不受信任的完整目录装入内存。
function boundedDirectoryNames(root, maximum) {
  let directory = null;
  const names = [];
  try {
    directory = fs.opendirSync(root);
    while (true) {
      const entry = directory.readSync();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length > maximum) {
        fail("wakeflow-claude-locator-inventory", "locator inventory exceeds its closed size limit");
      }
    }
  } catch (cause) {
    if (cause instanceof WakeflowClaudeLocatorError) throw cause;
    fail("wakeflow-claude-locator-inventory", "locator inventory cannot be enumerated", {}, cause);
  } finally {
    if (directory !== null) {
      try { directory.closeSync(); } catch { /* directory identity is rechecked by the caller */ }
    }
  }
  return names.sort();
}

function normalizeProcessIdentity(value, label = "operation lock owner") {
  exactDataObject(value, ["platform", "pid", "startIdentity"], [], label);
  if (!new Set(["darwin", "linux"]).has(value.platform)) {
    fail("wakeflow-claude-locator-lock", `${label}.platform is unsupported`);
  }
  if (!Number.isSafeInteger(value.pid) || value.pid <= 0) {
    fail("wakeflow-claude-locator-lock", `${label}.pid must be one positive safe integer`);
  }
  return deepFreeze({
    platform: value.platform,
    pid: value.pid,
    startIdentity: digest(value.startIdentity, `${label}.startIdentity`),
  });
}

function operationKind(value) {
  if (typeof value !== "string" || !OPERATION_KINDS.has(value)) {
    fail("wakeflow-claude-locator-lock", "operationKind is unsupported", {
      allowed: [...OPERATION_KINDS],
    });
  }
  return value;
}

function nullableBindingId(value, label) {
  return value === null ? null : bindingId(value, label);
}

function nullableLocatorId(value, label) {
  return value === null ? null : locatorId(value, label);
}

function nullableDigest(value, label) {
  return value === null ? null : digest(value, label);
}

function operationLockUnsigned(value) {
  return {
    kind: OPERATION_LOCK_KIND,
    schemaVersion: OPERATION_LOCK_SCHEMA_VERSION,
    programId: value.programId,
    hostId: HOST_ID,
    windowId: value.windowId,
    operationId: value.operationId,
    operationKind: value.operationKind,
    operationSubjectDigest: value.operationSubjectDigest,
    expectedBindingId: value.expectedBindingId,
    expectedLocatorId: value.expectedLocatorId,
    owner: value.owner,
    acquiredAt: value.acquiredAt,
  };
}

function validateOperationLockRecord(value) {
  exactDataObject(value, [
    "kind",
    "schemaVersion",
    "programId",
    "hostId",
    "windowId",
    "operationId",
    "operationKind",
    "operationSubjectDigest",
    "expectedBindingId",
    "expectedLocatorId",
    "owner",
    "acquiredAt",
    "lockDigest",
  ], [], "Claude window operation lock");
  if (value.kind !== OPERATION_LOCK_KIND || value.schemaVersion !== OPERATION_LOCK_SCHEMA_VERSION) {
    fail("wakeflow-claude-locator-lock", "Claude window operation lock kind or version is invalid");
  }
  if (value.hostId !== HOST_ID) fail("wakeflow-claude-locator-lock", "operation lock hostId must be claude-code");
  const unsigned = operationLockUnsigned({
    programId: typedId(value.programId, "program", "lock.programId"),
    windowId: typedId(value.windowId, "window", "lock.windowId"),
    operationId: operationId(value.operationId),
    operationKind: operationKind(value.operationKind),
    operationSubjectDigest: nullableDigest(
      value.operationSubjectDigest,
      "lock.operationSubjectDigest",
    ),
    expectedBindingId: nullableBindingId(value.expectedBindingId, "lock.expectedBindingId"),
    expectedLocatorId: nullableLocatorId(value.expectedLocatorId, "lock.expectedLocatorId"),
    owner: normalizeProcessIdentity(value.owner),
    acquiredAt: timestamp(value.acquiredAt, "lock.acquiredAt"),
  });
  const expectedDigest = canonicalJsonDigest(unsigned);
  if (value.lockDigest !== expectedDigest) {
    fail("wakeflow-claude-locator-lock", "operation lock self digest is invalid");
  }
  return deepFreeze({ ...unsigned, lockDigest: expectedDigest });
}

function createOperationLockRecord(value) {
  const unsigned = operationLockUnsigned({
    programId: typedId(value.programId, "program", "lock.programId"),
    windowId: typedId(value.windowId, "window", "lock.windowId"),
    operationId: operationId(value.operationId),
    operationKind: operationKind(value.operationKind),
    operationSubjectDigest: nullableDigest(
      value.operationSubjectDigest,
      "lock.operationSubjectDigest",
    ),
    expectedBindingId: nullableBindingId(value.expectedBindingId, "lock.expectedBindingId"),
    expectedLocatorId: nullableLocatorId(value.expectedLocatorId, "lock.expectedLocatorId"),
    owner: normalizeProcessIdentity(value.owner),
    acquiredAt: timestamp(value.acquiredAt, "lock.acquiredAt"),
  });
  return validateOperationLockRecord({ ...unsigned, lockDigest: canonicalJsonDigest(unsigned) });
}

function operationLockCanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(validateOperationLockRecord(value))}\n`, "utf8");
}

function locatorRootRef() {
  return `.wakeflow-local/runtime/hosts/${HOST_ID}/operations/window-locators`;
}

function readLocator(workspaceRoot, windowId) {
  return stableReadRecord(
    workspaceRoot,
    claudeWindowLocatorRef({ windowId }),
    validateClaudeWindowLocatorRecord,
    claudeWindowLocatorCanonicalBytes,
    "Claude window locator",
  );
}

function readOperationLock(workspaceRoot, windowId) {
  return stableReadRecord(
    workspaceRoot,
    operationLockRef(windowId),
    validateOperationLockRecord,
    operationLockCanonicalBytes,
    "Claude window operation lock",
  );
}

function normalAuthority(workspaceRoot) {
  let snapshot;
  let identity;
  try {
    snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot });
    identity = inspectWindowBindingInventory({ workspaceRoot });
  } catch (cause) {
    fail("wakeflow-claude-locator-authority", "strict v3 config or Claude identity authority is unavailable", {}, cause);
  }
  if (
    identity.hostId !== HOST_ID
    || identity.programId !== snapshot.model.program.programId
    || identity.configDigest !== snapshot.configDigest
  ) {
    fail("wakeflow-claude-locator-authority", "Claude identity inventory differs from strict config authority");
  }
  return deepFreeze({ workspaceRoot, snapshot, identity });
}

// 将当前binding、locator与operation lock在同一次稳定目录扫描中建立关联。
function bindingByWindow(identity) {
  return new Map(identity.bindings.map((binding) => [binding.windowId, binding]));
}

function scanLocatorInventory({ workspaceRoot, programId, identity }) {
  const rootRef = locatorRootRef();
  const root = assertPrivateDirectoryChain(workspaceRoot, rootRef, { allowMissingLeaf: true });
  const identities = bindingByWindow(identity);
  if (root === null) {
    return Object.freeze({
      state: "missing",
      rootRef,
      identity,
      identities,
      locators: Object.freeze([]),
      locks: Object.freeze([]),
      locatorByWindow: new Map(),
      lockByWindow: new Map(),
    });
  }
  let before;
  let names;
  try {
    before = fs.lstatSync(root, { bigint: true });
    names = boundedDirectoryNames(root, MAX_LOCATORS * 2);
  } catch (cause) {
    if (cause instanceof WakeflowClaudeLocatorError) throw cause;
    fail("wakeflow-claude-locator-inventory", "locator inventory cannot be enumerated", {}, cause);
  }
  const locators = [];
  const locks = [];
  const locatorByWindow = new Map();
  const lockByWindow = new Map();
  for (const name of names) {
    const match = name.match(/^(window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(json|lock)$/u);
    if (!match) fail("wakeflow-claude-locator-unknown", "unknown entry exists in locator root", { entry: name });
    const [, windowId, extension] = match;
    const source = extension === "json"
      ? readLocator(workspaceRoot, windowId)
      : readOperationLock(workspaceRoot, windowId);
    if (!source) fail("wakeflow-claude-locator-inventory", "locator inventory changed during scan");
    if (source.record.programId !== programId || source.record.windowId !== windowId) {
      fail("wakeflow-claude-locator-authority", "locator artifact differs from filename or program authority");
    }
    if (extension === "json") {
      if (locatorByWindow.has(windowId)) fail("wakeflow-claude-locator-duplicate", "duplicate locator window identity");
      locatorByWindow.set(windowId, source);
      locators.push(source);
    } else {
      if (lockByWindow.has(windowId)) fail("wakeflow-claude-locator-duplicate", "duplicate locator lock window identity");
      lockByWindow.set(windowId, source);
      locks.push(source);
    }
  }
  let after;
  let afterNames;
  try {
    after = fs.lstatSync(root, { bigint: true });
    afterNames = boundedDirectoryNames(root, MAX_LOCATORS * 2);
  } catch (cause) {
    if (cause instanceof WakeflowClaudeLocatorError) throw cause;
    fail("wakeflow-claude-locator-inventory", "locator inventory changed during scan", {}, cause);
  }
  if (!sameStat(before, after) || canonicalJson(names) !== canonicalJson(afterNames)) {
    fail("wakeflow-claude-locator-inventory", "locator inventory changed during scan");
  }
  for (const source of [...locators, ...locks]) {
    let current;
    try {
      current = fs.lstatSync(source.file, { bigint: true });
    } catch {
      fail("wakeflow-claude-locator-inventory", "locator artifact disappeared after validation");
    }
    if (!sameStat(source.stat, current)) {
      fail("wakeflow-claude-locator-inventory", "locator artifact changed after validation");
    }
  }
  return Object.freeze({
    state: "current",
    rootRef,
    identity,
    identities,
    locators: Object.freeze(locators),
    locks: Object.freeze(locks),
    locatorByWindow,
    lockByWindow,
  });
}

function lockHealth(source) {
  if (!source) return "absent";
  let verdict;
  try {
    verdict = probeWakeflowProcessIdentity(source.record.owner);
  } catch {
    return "unverifiable";
  }
  if (verdict === "same-live") return "active";
  if (verdict === "old-identity-gone-or-reused") return "stale";
  return "unverifiable";
}

function publicLocator(source, binding, expectedSocketName, observation = null) {
  const record = source.record;
  let status = "current";
  if (!binding) status = "locator-without-identity";
  else if (
    binding.programId !== record.programId
    || binding.hostId !== record.hostId
    || binding.windowId !== record.windowId
    || binding.bindingId !== record.bindingId
  ) status = "binding-mismatch";
  else if (expectedSocketName !== undefined && record.tmux.socketName !== expectedSocketName) {
    status = "host-context-drift";
  } else if (observation) status = observation.status;
  return deepFreeze({
    status,
    ref: source.ref,
    digest: claudeWindowLocatorDigest(record),
    locatorId: record.locatorId,
    bindingId: record.bindingId,
    locatedAt: record.locatedAt,
  });
}

function buildPublicInventory(inventory, { programId, configDigest, expectedSocketName, observe }) {
  const windows = [];
  const issues = [];
  for (const binding of inventory.identity.bindings) {
    const source = inventory.locatorByWindow.get(binding.windowId) ?? null;
    const lock = inventory.lockByWindow.get(binding.windowId) ?? null;
    let locator = null;
    if (source) {
      let observation = null;
      if (typeof observe === "function") {
        let raw;
        try {
          raw = observe(source.record);
        } catch (cause) {
          fail("wakeflow-claude-locator-observation", "host locator observer failed", {}, cause);
        }
        observation = inspectClaudeWindowLocatorObservation({
          locator: source.record,
          binding: {
            programId: binding.programId,
            hostId: binding.hostId,
            windowId: binding.windowId,
            bindingId: binding.bindingId,
          },
          expectedSocketName: expectedSocketName ?? source.record.tmux.socketName,
          observations: raw,
        });
      }
      locator = publicLocator(source, binding, expectedSocketName, observation);
      if (!["current", "live"].includes(locator.status)) {
        issues.push(`${binding.windowId}:${locator.status}`);
      }
    } else {
      issues.push(`${binding.windowId}:identity-without-locator`);
    }
    const operationStatus = lockHealth(lock);
    if (!["absent"].includes(operationStatus)) issues.push(`${binding.windowId}:operation-${operationStatus}`);
    windows.push(deepFreeze({
      windowId: binding.windowId,
      bindingId: binding.bindingId,
      identityRef: binding.identityRef,
      identityBindingDigest: binding.identityBindingDigest,
      locator,
      operation: lock
        ? deepFreeze({
          status: operationStatus,
          ref: lock.ref,
          digest: lock.record.lockDigest,
          operationId: lock.record.operationId,
          operationKind: lock.record.operationKind,
          })
        : null,
    }));
  }
  const orphans = inventory.locators
    .filter((source) => !inventory.identities.has(source.record.windowId))
    .map((source) => {
      issues.push(`${source.record.windowId}:locator-without-identity`);
      return deepFreeze({
        windowId: source.record.windowId,
        locator: publicLocator(source, null, expectedSocketName),
      });
    });
  for (const lock of inventory.locks) {
    if (inventory.identities.has(lock.record.windowId)) continue;
    issues.push(`${lock.record.windowId}:operation-lock-without-identity`);
  }
  const unsigned = {
    kind: "WakeflowClaudeWindowLocatorInventory",
    schemaVersion: 1,
    programId,
    hostId: HOST_ID,
    configDigest,
    locatorRootRef: inventory.rootRef,
    status: issues.length === 0 ? "current" : "attention-required",
    windows,
    orphans,
    issues: [...new Set(issues)].sort(),
  };
  return deepFreeze({ ...unsigned, inventoryDigest: canonicalJsonDigest(unsigned) });
}

/** 读取严格config与Claude binding authority，并返回脱敏locator/lock库存。 */
export function inspectClaudeWindowLocatorInventory(value = {}) {
  exactDataObject(
    value,
    ["workspaceRoot"],
    ["expectedSocketName", "observe"],
    "Claude locator inventory input",
  );
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const expectedSocketName = Object.hasOwn(value, "expectedSocketName")
    ? socketName(value.expectedSocketName, "expectedSocketName")
    : undefined;
  const observe = Object.hasOwn(value, "observe") ? value.observe : undefined;
  if (observe !== undefined && typeof observe !== "function") {
    fail("wakeflow-claude-locator-input", "observe must be a synchronous host observation function");
  }
  const authority = normalAuthority(workspaceRoot);
  const inventory = scanLocatorInventory({
    workspaceRoot,
    programId: authority.snapshot.model.program.programId,
    identity: authority.identity,
  });
  return buildPublicInventory(inventory, {
    programId: authority.snapshot.model.program.programId,
    configDigest: authority.snapshot.configDigest,
    expectedSocketName,
    observe,
  });
}

/** 为shared layout inspector提供不重载config的窄库存投影；输入authority由调用方给出。 */
export function inspectClaudeWindowLocatorInventoryForLayout(value = {}) {
  exactDataObject(value, [
    "workspaceRoot",
    "programId",
    "hostId",
    "configDigest",
    "windowIds",
  ], [], "Claude locator layout inventory input");
  if (value.hostId !== HOST_ID) {
    fail("wakeflow-claude-locator-host", "layout locator inventory belongs only to claude-code");
  }
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const programId = typedId(value.programId, "program", "programId");
  digest(value.configDigest, "configDigest");
  exactDataArray(
    value.windowIds,
    "windowIds",
    MAX_LOCATORS,
    "wakeflow-claude-locator-input",
  );
  const windowIds = value.windowIds.map((entry, index) => {
    return typedId(entry, "window", `windowIds[${index}]`);
  });
  let identity;
  try {
    identity = inspectWindowBindingInventoryForProtocolHost({
      workspaceRoot,
      programId,
      hostId: HOST_ID,
      configDigest: value.configDigest,
      windowIds,
    });
  } catch (cause) {
    fail("wakeflow-claude-locator-authority", "layout identity inventory is unavailable", {}, cause);
  }
  const inventory = scanLocatorInventory({ workspaceRoot, programId, identity });
  const entries = [
    ...inventory.locators.map((source) => {
      const binding = inventory.identities.get(source.record.windowId) ?? null;
      return deepFreeze({
        ref: source.ref,
        kind: "locator",
        status: binding && binding.bindingId === source.record.bindingId ? "current" : "invalid",
        digest: claudeWindowLocatorDigest(source.record),
      });
    }),
    ...inventory.locks.map((source) => deepFreeze({
      ref: source.ref,
      kind: "operation-lock",
      status: lockHealth(source),
      digest: source.record.lockDigest,
    })),
  ].sort((left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0);
  const issues = entries
    .filter((entry) => !["current", "active"].includes(entry.status))
    .map((entry) => `${entry.ref}:${entry.status}`);
  return deepFreeze({
    kind: "WakeflowClaudeWindowLocatorLayoutInventory",
    schemaVersion: 1,
    programId,
    hostId: HOST_ID,
    configDigest: value.configDigest,
    status: issues.length === 0 ? "current" : "unsafe",
    entries,
    issues,
  });
}

function sameSource(left, right) {
  return Boolean(left && right)
    && left.ref === right.ref
    && left.sha256 === right.sha256
    && sameStat(left.stat, right.stat);
}

function writeRecordSource({
  workspaceRoot,
  source,
  ref,
  record,
  canonicalBytes,
  readBack = null,
  label,
}) {
  const bytes = canonicalBytes(record);
  if (source && source.bytes.equals(bytes)) return source;
  try {
    atomicWriteFile({
      root: workspaceRoot,
      target: absoluteRef(workspaceRoot, ref),
      content: bytes,
      expectation: source
        ? { type: "file", sha256: source.sha256 }
        : { type: "absent" },
      mode: 0o600,
      ownership: "whole-file",
      sourceIdentity: source?.sourceIdentity ?? null,
      label,
    });
  } catch (cause) {
    if (typeof readBack === "function") {
      let committed = null;
      try {
        committed = readBack();
      } catch {
        committed = null;
      }
      if (committed?.bytes?.equals(bytes)) return committed;
    }
    fail("wakeflow-claude-locator-commit", `${label} cannot be atomically committed`, {}, cause);
  }
  return null;
}

// 删除前先固定私有parent与source identity，删除后对同一parent descriptor执行durability证明。
function exactUnlinkSource(source, label) {
  const parentPath = path.dirname(source.file);
  let parentDescriptor = null;
  try {
    const parentBefore = fs.lstatSync(parentPath, { bigint: true });
    if (
      parentBefore.isSymbolicLink()
      || !parentBefore.isDirectory()
      || parentBefore.uid !== currentEuid()
      || modeOf(parentBefore) !== 0o700
    ) {
      fail("wakeflow-claude-locator-recovery-required", `${label} parent is no longer private`);
    }
    parentDescriptor = fs.openSync(
      parentPath,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY ?? 0)
        | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const parentOpened = fs.fstatSync(parentDescriptor, { bigint: true });
    if (!sameStat(parentBefore, parentOpened)) {
      fail("wakeflow-claude-locator-recovery-required", `${label} parent changed while being opened`);
    }
    const current = fs.lstatSync(source.file, { bigint: true });
    if (!sameStat(source.stat, current)) {
      fail("wakeflow-claude-locator-recovery-required", `${label} changed before exact release`);
    }
    fs.unlinkSync(source.file);
    fs.fsyncSync(parentDescriptor);
    const parentAfterDescriptor = fs.fstatSync(parentDescriptor, { bigint: true });
    const parentAfterPath = fs.lstatSync(parentPath, { bigint: true });
    if (!sameNode(parentAfterDescriptor, parentAfterPath)) {
      fail("wakeflow-claude-locator-recovery-required", `${label} parent changed during release`);
    }
  } catch (cause) {
    if (cause instanceof WakeflowClaudeLocatorError) throw cause;
    fail("wakeflow-claude-locator-recovery-required", `${label} cannot be durably released`, {}, cause);
  } finally {
    if (parentDescriptor !== null) {
      try { fs.closeSync(parentDescriptor); } catch { /* release outcome is proved below */ }
    }
  }
  try {
    fs.lstatSync(source.file);
  } catch (cause) {
    if (cause?.code === "ENOENT") return;
    fail("wakeflow-claude-locator-recovery-required", `${label} absence cannot be proved`, {}, cause);
  }
  fail("wakeflow-claude-locator-recovery-required", `${label} remains after exact release`);
}

function normalizeMutexInput(value) {
  exactDataObject(value, [
    "workspaceRoot",
    "windowId",
    "operationKind",
    "expectedBindingId",
    "expectedLocatorId",
  ], ["operationSubjectDigest"], "Claude window operation input");
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(value.workspaceRoot),
    windowId: typedId(value.windowId, "window", "windowId"),
    operationKind: operationKind(value.operationKind),
    operationSubjectDigest: Object.hasOwn(value, "operationSubjectDigest")
      ? nullableDigest(value.operationSubjectDigest, "operationSubjectDigest")
      : null,
    expectedBindingId: nullableBindingId(value.expectedBindingId, "expectedBindingId"),
    expectedLocatorId: nullableLocatorId(value.expectedLocatorId, "expectedLocatorId"),
  });
}

function currentWindowTuple(inventory, windowId) {
  const binding = inventory.identities.get(windowId) ?? null;
  const locator = inventory.locatorByWindow.get(windowId) ?? null;
  return Object.freeze({
    binding,
    locator,
    bindingId: binding?.bindingId ?? null,
    locatorId: locator?.record.locatorId ?? null,
  });
}

function assertCurrentTuple(tuple, expectedBindingId, expectedLocatorId) {
  if (tuple.bindingId !== expectedBindingId || tuple.locatorId !== expectedLocatorId) {
    fail("wakeflow-claude-locator-cas-mismatch", "current binding or locator generation differs from the expected operation tuple", {
      expectedBindingId,
      actualBindingId: tuple.bindingId,
      expectedLocatorId,
      actualLocatorId: tuple.locatorId,
    });
  }
  if (
    tuple.locator
    && (!tuple.binding || tuple.locator.record.bindingId !== tuple.binding.bindingId)
  ) {
    fail("wakeflow-claude-locator-binding-mismatch", "current locator does not reference the current identity binding");
  }
}

async function acquireOperation(input) {
  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: `claude-window-${input.operationKind}`,
      domainOwner: "host-lifecycle-adapter",
    }, async () => {
      try {
        const authority = normalAuthority(input.workspaceRoot);
        assertPrivateDirectoryChain(input.workspaceRoot, locatorRootRef());
        const inventory = scanLocatorInventory({
          workspaceRoot: input.workspaceRoot,
          programId: authority.snapshot.model.program.programId,
          identity: authority.identity,
        });
        const existingLock = inventory.lockByWindow.get(input.windowId) ?? null;
        if (existingLock) {
          const health = lockHealth(existingLock);
          if (health === "active") {
            fail("wakeflow-claude-locator-busy", "Claude window already has one exact live operation owner");
          }
          if (health === "stale") {
            fail("wakeflow-claude-locator-recovery-required", "stale Claude window operation requires explicit recovery");
          }
          fail("wakeflow-claude-locator-lock-unverifiable", "Claude window operation owner cannot be verified");
        }
        const tuple = currentWindowTuple(inventory, input.windowId);
        assertCurrentTuple(tuple, input.expectedBindingId, input.expectedLocatorId);
        const record = createOperationLockRecord({
          programId: authority.snapshot.model.program.programId,
          windowId: input.windowId,
          operationId: `claude-operation_${randomUUID()}`,
          operationKind: input.operationKind,
          operationSubjectDigest: input.operationSubjectDigest,
          expectedBindingId: input.expectedBindingId,
          expectedLocatorId: input.expectedLocatorId,
          owner: captureWakeflowProcessIdentity(),
          acquiredAt: new Date().toISOString(),
        });
        const ref = operationLockRef(input.windowId);
        writeRecordSource({
          workspaceRoot: input.workspaceRoot,
          source: null,
          ref,
          record,
          canonicalBytes: operationLockCanonicalBytes,
          readBack: () => readOperationLock(input.workspaceRoot, input.windowId),
          label: "Claude window operation lock",
        });
        const created = readOperationLock(input.workspaceRoot, input.windowId);
        if (!created || created.record.lockDigest !== record.lockDigest) {
          fail("wakeflow-claude-locator-recovery-required", "operation lock commit cannot be proved");
        }
        return Object.freeze({ outcome: "success", value: { authority, source: created } });
      } catch (error) {
        return Object.freeze({ outcome: "rejected", error });
      }
    });
  } catch (cause) {
    boundary("Claude operation admission", cause, "wakeflow-claude-locator-mutation");
  }
  if (result?.outcome === "rejected") {
    if (result.error instanceof Error) throw result.error;
    fail("wakeflow-claude-locator-operation", "operation admission was rejected without a structured error");
  }
  if (result?.outcome !== "success") {
    fail("wakeflow-claude-locator-operation", "operation admission returned an invalid result");
  }
  return result.value;
}

function assertIssuedOperation(value) {
  const state = ISSUED_OPERATION_CONTEXTS.get(value);
  if (!state) fail("wakeflow-claude-locator-operation-context", "operation must be an issued Claude window context");
  if (!state.active) fail("wakeflow-claude-locator-operation-context", "Claude window operation context is no longer active");
  return state;
}

function publicOperationContext(record) {
  return deepFreeze({
    kind: "WakeflowClaudeWindowOperationContext",
    schemaVersion: 1,
    windowId: record.windowId,
    operationId: record.operationId,
    operationKind: record.operationKind,
    operationSubjectDigest: record.operationSubjectDigest,
    expectedBindingId: record.expectedBindingId,
    expectedLocatorId: record.expectedLocatorId,
  });
}

async function releaseOperationContext(operation, state) {
  try {
    let result;
    try {
      result = await withWakeflowRuntimeMutation({
        workspaceRoot: state.workspaceRoot,
        operationKind: "claude-window-operation-release",
        domainOwner: "host-lifecycle-adapter",
      }, async () => {
        try {
          const current = readOperationLock(state.workspaceRoot, state.windowId);
          if (!sameSource(current, state.lockSource)) {
            fail("wakeflow-claude-locator-recovery-required", "exact operation lock ownership changed before release");
          }
          exactUnlinkSource(current, "Claude window operation lock");
          return Object.freeze({ outcome: "success", value: true });
        } catch (error) {
          return Object.freeze({ outcome: "rejected", error });
        }
      });
    } catch (cause) {
      if (cause instanceof WakeflowClaudeLocatorError
        && cause.code === "wakeflow-claude-locator-recovery-required") throw cause;
      fail(
        "wakeflow-claude-locator-recovery-required",
        "Claude operation release transaction failed; exact recovery is required",
        {},
        cause,
      );
    }
    if (result?.outcome === "rejected") {
      if (result.error instanceof WakeflowClaudeLocatorError
        && result.error.code === "wakeflow-claude-locator-recovery-required") throw result.error;
      fail(
        "wakeflow-claude-locator-recovery-required",
        "operation release could not prove exact lock removal",
        {},
        result.error instanceof Error ? result.error : undefined,
      );
    }
    if (result?.outcome !== "success") {
      fail("wakeflow-claude-locator-recovery-required", "operation release returned an invalid result");
    }
  } finally {
    // 一次callback结束后上下文永不复用；物理释放不确定时改走显式recovery。
    state.active = false;
    ISSUED_OPERATION_CONTEXTS.delete(operation);
  }
}

function normalizeFailureVerdict(value) {
  exactDataObject(value, ["disposition"], [], "Claude operation failure verdict");
  if (!new Set(["safe-to-release", "retain-for-recovery"]).has(value.disposition)) {
    fail("wakeflow-claude-locator-failure-verdict", "operation failure verdict is unsupported");
  }
  return value.disposition;
}

/**
 * 为一个stable window持有唯一宿主操作锁并执行callback。
 * callback失败默认保留锁，只有owner显式给出safe-to-release证明才会删除。
 */
export async function withClaudeWindowOperationMutex(input = {}, callback, options = {}) {
  const normalized = normalizeMutexInput(input);
  if (typeof callback !== "function") {
    fail("wakeflow-claude-locator-input", "operation callback must be a function");
  }
  exactDataObject(options, [], ["onFailure"], "Claude operation options");
  const onFailure = Object.hasOwn(options, "onFailure") ? options.onFailure : null;
  if (onFailure !== null && typeof onFailure !== "function") {
    fail("wakeflow-claude-locator-input", "onFailure must be a function");
  }
  const acquired = await acquireOperation(normalized);
  const operation = publicOperationContext(acquired.source.record);
  const state = {
    active: true,
    workspaceRoot: normalized.workspaceRoot,
    windowId: normalized.windowId,
    programId: acquired.source.record.programId,
    operationKind: normalized.operationKind,
    operationSubjectDigest: normalized.operationSubjectDigest,
    expectedBindingId: normalized.expectedBindingId,
    expectedLocatorId: normalized.expectedLocatorId,
    lockSource: acquired.source,
  };
  ISSUED_OPERATION_CONTEXTS.set(operation, state);
  let value;
  try {
    value = await callback(operation);
  } catch (cause) {
    let disposition = "retain-for-recovery";
    if (onFailure) {
      let raw;
      try {
        raw = await onFailure({ operation, error: cause });
      } catch (failureCause) {
        state.active = false;
        ISSUED_OPERATION_CONTEXTS.delete(operation);
        fail(
          "wakeflow-claude-locator-recovery-required",
          "operation failure verifier failed; exact mutex retained",
          { operationId: operation.operationId },
          failureCause,
        );
      }
      disposition = normalizeFailureVerdict(raw);
    }
    if (disposition === "safe-to-release") {
      await releaseOperationContext(operation, state);
      fail("wakeflow-claude-locator-callback-failed", "operation callback failed after exact safe release", {}, cause);
    }
    state.active = false;
    ISSUED_OPERATION_CONTEXTS.delete(operation);
    fail(
      "wakeflow-claude-locator-recovery-required",
      "operation callback failed without a safe-release proof; exact mutex retained",
      { operationId: operation.operationId },
      cause,
    );
  }
  await releaseOperationContext(operation, state);
  return value;
}

function observationRelatesToLocator(observation, locator) {
  const metadataMatches = sameTuple(observation.metadata, locator, [
    "programId",
    "hostId",
    "windowId",
    "bindingId",
    "locatorId",
  ]);
  const coordinateMatches = observation.socketName === locator.tmux.socketName
    && (
      observation.windowId === locator.tmux.windowId
      || observation.paneId === locator.tmux.paneId
    );
  return metadataMatches || coordinateMatches;
}

/** 在已签发操作锁内重验authority，并解析唯一live tmux endpoint供send/readback使用。 */
export function resolveClaudeWindowOperationEndpoint(value = {}) {
  exactDataObject(value, [
    "operation",
    "binding",
    "expectedSocketName",
    "expectedSessionName",
    "observations",
  ], [], "Claude window endpoint input");
  const state = assertIssuedOperation(value.operation);
  if (state.expectedBindingId === null || state.expectedLocatorId === null) {
    fail(
      "wakeflow-claude-locator-operation-authority",
      `${state.operationKind} has no exact current binding and locator endpoint authority`,
    );
  }
  assertLockStillOwned(state);
  const authority = normalAuthority(state.workspaceRoot);
  if (authority.snapshot.model.program.programId !== state.programId) {
    fail("wakeflow-claude-locator-authority", "operation program authority is no longer current");
  }
  const inventory = scanLocatorInventory({
    workspaceRoot: state.workspaceRoot,
    programId: state.programId,
    identity: authority.identity,
  });
  const tuple = currentWindowTuple(inventory, state.windowId);
  assertCurrentTuple(tuple, state.expectedBindingId, state.expectedLocatorId);
  if (!tuple.binding || !tuple.locator) {
    fail("wakeflow-claude-locator-endpoint", "current Claude endpoint is incomplete");
  }
  const binding = normalizeBindingTuple(value.binding);
  if (!sameTuple(binding, tuple.binding, ["programId", "hostId", "windowId", "bindingId"])) {
    fail("wakeflow-claude-locator-binding-mismatch", "endpoint binding differs from current identity authority");
  }
  const expectedSocketName = socketName(value.expectedSocketName, "expectedSocketName");
  const expectedSessionName = boundedToken(value.expectedSessionName, "expectedSessionName");
  const locator = tuple.locator.record;
  if (
    locator.tmux.socketName !== expectedSocketName
    || locator.tmux.sessionName !== expectedSessionName
  ) {
    fail(
      "wakeflow-claude-locator-host-context-drift",
      "current locator differs from the adopted tmux socket or session context",
    );
  }
  exactDataArray(
    value.observations,
    "endpoint observations",
    MAX_LOCATORS,
    "wakeflow-claude-locator-observation",
  );
  const relevant = value.observations
    .map((entry, index) => passiveObservationForRelation(
      entry,
      `observations[${index}]`,
    ))
    .filter((entry) => observationRelatesToLocator(entry, locator))
    .map((entry, index) => normalizeObservation(entry, `relevant observations[${index}]`));
  if (relevant.length > 16) {
    fail(
      "wakeflow-claude-locator-endpoint-not-live",
      "too many pane observations relate to the exact locator generation",
      { status: "duplicate" },
    );
  }
  const observation = inspectClaudeWindowLocatorObservation({
    locator,
    binding,
    expectedSocketName,
    observations: relevant,
  });
  if (!observation.authorityEligible || observation.status !== "live") {
    fail(
      "wakeflow-claude-locator-endpoint-not-live",
      "current Claude locator has no unique live physical endpoint",
      { status: observation.status },
    );
  }
  return deepFreeze({
    kind: "WakeflowClaudeWindowOperationEndpoint",
    schemaVersion: 1,
    programId: locator.programId,
    hostId: HOST_ID,
    windowId: locator.windowId,
    bindingId: locator.bindingId,
    locatorId: locator.locatorId,
    operationId: value.operation.operationId,
    operationSubjectDigest: state.operationSubjectDigest,
    provider: PROVIDER,
    tmux: locator.tmux,
  });
}

function assertLockStillOwned(state) {
  const current = readOperationLock(state.workspaceRoot, state.windowId);
  if (!sameSource(current, state.lockSource)) {
    fail("wakeflow-claude-locator-recovery-required", "issued operation no longer owns the exact mutex");
  }
  return current;
}

function commitResult(source, status) {
  return deepFreeze({
    kind: "WakeflowClaudeWindowLocatorCommit",
    schemaVersion: 1,
    status,
    windowId: source.record.windowId,
    bindingId: source.record.bindingId,
    locatorId: source.record.locatorId,
    ref: source.ref,
    digest: claudeWindowLocatorDigest(source.record),
    locatedAt: source.record.locatedAt,
  });
}

/** 以完整live observation和当前binding CAS提交一个locator generation。 */
export async function commitClaudeWindowLocator(value = {}) {
  exactDataObject(
    value,
    ["operation", "locator", "observation", "expectedSocketName"],
    [],
    "Claude locator commit input",
  );
  const state = assertIssuedOperation(value.operation);
  if (!LOCATOR_COMMIT_OPERATION_KINDS.has(state.operationKind)) {
    fail(
      "wakeflow-claude-locator-operation-authority",
      `${state.operationKind} cannot create or replace a Claude window locator`,
    );
  }
  const locator = validateClaudeWindowLocatorRecord(value.locator);
  if (
    locator.programId !== state.programId
    || locator.windowId !== state.windowId
  ) {
    fail("wakeflow-claude-locator-operation-context", "locator differs from its issued operation authority");
  }
  const expectedSocketName = socketName(value.expectedSocketName, "expectedSocketName");
  const observationEvidence = issuedObservationEvidence(value.observation, "commit");
  if (
    value.observation.status !== "live"
    || value.observation.windowId !== locator.windowId
    || value.observation.bindingId !== locator.bindingId
    || value.observation.locatorId !== locator.locatorId
    || locator.tmux.socketName !== expectedSocketName
    || observationEvidence.locatorDigest !== claudeWindowLocatorDigest(locator)
  ) {
    fail("wakeflow-claude-locator-observation", "commit requires an exact live observation in the adopted host context");
  }
  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot: state.workspaceRoot,
      operationKind: "claude-window-locator-commit",
      domainOwner: "host-lifecycle-adapter",
    }, async () => {
      try {
        assertLockStillOwned(state);
        const authority = normalAuthority(state.workspaceRoot);
        const inventory = scanLocatorInventory({
          workspaceRoot: state.workspaceRoot,
          programId: authority.snapshot.model.program.programId,
          identity: authority.identity,
        });
        const tuple = currentWindowTuple(inventory, state.windowId);
        if (tuple.bindingId !== locator.bindingId || tuple.locatorId !== state.expectedLocatorId) {
          fail("wakeflow-claude-locator-cas-mismatch", "binding or locator changed before locator commit");
        }
        if (
          tuple.locator
          && tuple.locator.record.bindingId !== tuple.binding.bindingId
          && !(
            state.operationKind === "replace"
            && tuple.locator.record.bindingId === state.expectedBindingId
            && tuple.binding.bindingId === locator.bindingId
          )
        ) {
          fail("wakeflow-claude-locator-binding-mismatch", "locator replacement lineage is not the issued identity transition");
        }
        if (tuple.binding.programId !== locator.programId) {
          fail("wakeflow-claude-locator-authority", "current identity program differs from locator");
        }
        if (tuple.locator?.record.locatorId === locator.locatorId) {
          if (claudeWindowLocatorDigest(tuple.locator.record) !== claudeWindowLocatorDigest(locator)) {
            fail("wakeflow-claude-locator-conflict", "one locator generation cannot change coordinates or metadata");
          }
          return Object.freeze({ outcome: "success", value: commitResult(tuple.locator, "replayed") });
        }
        const ref = claudeWindowLocatorRef({ windowId: locator.windowId });
        writeRecordSource({
          workspaceRoot: state.workspaceRoot,
          source: tuple.locator,
          ref,
          record: locator,
          canonicalBytes: claudeWindowLocatorCanonicalBytes,
          readBack: () => readLocator(state.workspaceRoot, locator.windowId),
          label: "Claude window locator",
        });
        const committed = readLocator(state.workspaceRoot, locator.windowId);
        if (!committed || claudeWindowLocatorDigest(committed.record) !== claudeWindowLocatorDigest(locator)) {
          fail("wakeflow-claude-locator-recovery-required", "locator commit cannot be proved");
        }
        return Object.freeze({ outcome: "success", value: commitResult(committed, tuple.locator ? "replaced" : "created") });
      } catch (error) {
        return Object.freeze({ outcome: "rejected", error });
      }
    });
  } catch (cause) {
    boundary("Claude locator commit", cause, "wakeflow-claude-locator-mutation");
  }
  if (result?.outcome === "rejected") {
    if (result.error instanceof Error) throw result.error;
    fail("wakeflow-claude-locator-operation", "locator commit was rejected without a structured error");
  }
  if (result?.outcome !== "success") fail("wakeflow-claude-locator-operation", "locator commit returned an invalid result");
  state.expectedBindingId = locator.bindingId;
  state.expectedLocatorId = locator.locatorId;
  return result.value;
}

/** 仅在完整locator payload的missing observation成立时CAS删除当前generation。 */
export async function removeClaudeWindowLocator(value = {}) {
  exactDataObject(
    value,
    ["operation", "expectedLocatorId", "observation"],
    [],
    "Claude locator removal input",
  );
  const state = assertIssuedOperation(value.operation);
  if (!LOCATOR_REMOVE_OPERATION_KINDS.has(state.operationKind)) {
    fail(
      "wakeflow-claude-locator-operation-authority",
      `${state.operationKind} cannot remove a Claude window locator`,
    );
  }
  const expectedLocatorId = locatorId(value.expectedLocatorId, "expectedLocatorId");
  const observationEvidence = issuedObservationEvidence(value.observation, "removal");
  if (
    value.observation.status !== "missing"
    || value.observation.windowId !== state.windowId
    || value.observation.locatorId !== expectedLocatorId
  ) {
    fail("wakeflow-claude-locator-observation", "locator removal requires an exact absent physical postcondition");
  }
  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot: state.workspaceRoot,
      operationKind: "claude-window-locator-remove",
      domainOwner: "host-lifecycle-adapter",
    }, async () => {
      try {
        assertLockStillOwned(state);
        const authority = normalAuthority(state.workspaceRoot);
        const inventory = scanLocatorInventory({
          workspaceRoot: state.workspaceRoot,
          programId: authority.snapshot.model.program.programId,
          identity: authority.identity,
        });
        const tuple = currentWindowTuple(inventory, state.windowId);
        assertCurrentTuple(tuple, state.expectedBindingId, expectedLocatorId);
        if (!tuple.locator) fail("wakeflow-claude-locator-cas-mismatch", "locator removal source is absent");
        if (observationEvidence.locatorDigest !== claudeWindowLocatorDigest(tuple.locator.record)) {
          fail(
            "wakeflow-claude-locator-observation",
            "locator removal observation belongs to a different locator generation payload",
          );
        }
        exactUnlinkSource(tuple.locator, "Claude window locator");
        if (readLocator(state.workspaceRoot, state.windowId)) {
          fail("wakeflow-claude-locator-recovery-required", "locator remains after removal");
        }
        return Object.freeze({
          outcome: "success",
          value: deepFreeze({
            kind: "WakeflowClaudeWindowLocatorRemoval",
            schemaVersion: 1,
            status: "removed",
            windowId: state.windowId,
            bindingId: state.expectedBindingId,
            locatorId: expectedLocatorId,
          }),
        });
      } catch (error) {
        return Object.freeze({ outcome: "rejected", error });
      }
    });
  } catch (cause) {
    boundary("Claude locator removal", cause, "wakeflow-claude-locator-mutation");
  }
  if (result?.outcome === "rejected") {
    if (result.error instanceof Error) throw result.error;
    fail("wakeflow-claude-locator-operation", "locator removal was rejected without a structured error");
  }
  if (result?.outcome !== "success") fail("wakeflow-claude-locator-operation", "locator removal returned an invalid result");
  state.expectedLocatorId = null;
  return result.value;
}

/** 对dead/reused或当前进程遗留的operation lock执行owner判定后的显式恢复。 */
export async function recoverClaudeWindowOperationMutex(value = {}, inspect) {
  exactDataObject(
    value,
    ["workspaceRoot", "windowId", "operationId"],
    [],
    "Claude operation recovery input",
  );
  if (typeof inspect !== "function") {
    fail("wakeflow-claude-locator-input", "operation recovery requires one owner-specific inspector");
  }
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const windowId = typedId(value.windowId, "window", "windowId");
  const expectedOperationId = operationId(value.operationId);
  const authority = normalAuthority(workspaceRoot);
  const inventory = scanLocatorInventory({
    workspaceRoot,
    programId: authority.snapshot.model.program.programId,
    identity: authority.identity,
  });
  const source = inventory.lockByWindow.get(windowId) ?? null;
  if (!source || source.record.operationId !== expectedOperationId) {
    fail("wakeflow-claude-locator-cas-mismatch", "recovery operation lock is absent or differs");
  }
  const health = lockHealth(source);
  let sameCurrentProcess = false;
  if (health === "active") {
    try {
      sameCurrentProcess = canonicalJson(source.record.owner) === canonicalJson(captureWakeflowProcessIdentity());
    } catch {
      sameCurrentProcess = false;
    }
  }
  if (health !== "stale" && !sameCurrentProcess) {
    fail(
      "wakeflow-claude-locator-recovery-busy",
      "only a dead/reused or exact same-process retained operation can be recovered",
    );
  }
  let verdict;
  try {
    verdict = normalizeFailureVerdict(await inspect(deepFreeze({
      operationId: source.record.operationId,
      operationKind: source.record.operationKind,
      operationSubjectDigest: source.record.operationSubjectDigest,
      windowId,
      expectedBindingId: source.record.expectedBindingId,
      expectedLocatorId: source.record.expectedLocatorId,
    })));
  } catch (cause) {
    if (cause instanceof WakeflowClaudeLocatorError) throw cause;
    fail("wakeflow-claude-locator-recovery-required", "operation recovery inspector failed", {}, cause);
  }
  if (verdict !== "safe-to-release") {
    return deepFreeze({
      kind: "WakeflowClaudeWindowOperationRecovery",
      schemaVersion: 1,
      status: "retained-for-recovery",
      windowId,
      operationId: expectedOperationId,
    });
  }
  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "claude-window-operation-recover",
      domainOwner: "host-lifecycle-adapter",
    }, async () => {
      try {
        const current = readOperationLock(workspaceRoot, windowId);
        const currentHealth = lockHealth(current);
        let currentSameProcess = false;
        if (currentHealth === "active") {
          try {
            currentSameProcess = canonicalJson(current.record.owner) === canonicalJson(captureWakeflowProcessIdentity());
          } catch {
            currentSameProcess = false;
          }
        }
        if (
          !sameSource(current, source)
          || (currentHealth !== "stale" && !currentSameProcess)
        ) {
          fail("wakeflow-claude-locator-recovery-race", "operation lock changed before recovery release");
        }
        exactUnlinkSource(current, "stale Claude window operation lock");
        return Object.freeze({ outcome: "success", value: true });
      } catch (error) {
        return Object.freeze({ outcome: "rejected", error });
      }
    });
  } catch (cause) {
    boundary("Claude operation recovery", cause, "wakeflow-claude-locator-mutation");
  }
  if (result?.outcome === "rejected") {
    if (result.error instanceof Error) throw result.error;
    fail("wakeflow-claude-locator-recovery-required", "operation recovery was rejected without a structured error");
  }
  if (result?.outcome !== "success") {
    fail("wakeflow-claude-locator-recovery-required", "operation recovery returned an invalid result");
  }
  return deepFreeze({
    kind: "WakeflowClaudeWindowOperationRecovery",
    schemaVersion: 1,
    status: "released",
    windowId,
    operationId: expectedOperationId,
  });
}
