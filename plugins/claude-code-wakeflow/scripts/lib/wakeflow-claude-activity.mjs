/**
 * Claude Code 活动投影与安全prompt临时文件的宿主专属owner。
 *
 * 职责导航：
 * 1. activity manager按真实tmux server context维护唯一短生命周期monitor generation；
 * 2. monitor只把locator owner签发的精确坐标与实时pane事实连接，并临时叠加/恢复glyph；
 * 3. activity结果只是诊断投影，不解释delivery完成、业务成功、阻塞或重发条件；
 * 4. prompt默认只走内存，path-only适配器才在T02 mutation内创建0600短命文件；
 * 5. prompt inspection只返回脱敏计数，sweeper只按本机当前时钟删除严格expired orphan；
 * 6. process、manager lock及prompt删除都要求当前私有parent与exact source identity未漂移。
 *
 * 本模块不拥有config、binding、locator、transport或业务状态，也不建立第二套窗口authority。
 */
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  captureWakeflowProcessIdentity,
  inspectWakeflowProcessSnapshot,
  probeWakeflowProcessIdentity,
} from "./wakeflow-process-identity.mjs";
import { inspectClaudeWindowLocatorInventory } from "./wakeflow-claude-locator.mjs";
import {
  inspectWakeflowWorkspaceMutation,
  withWakeflowRuntimeMutation,
} from "./wakeflow-workspace-mutation.mjs";

export const WAKEFLOW_CLAUDE_ACTIVITY_HOST_ID = "claude-code";
export const WAKEFLOW_CLAUDE_ACTIVITY_SCHEMA_VERSION = 1;
export const WAKEFLOW_CLAUDE_ACTIVITY_PROCESS_KIND = "WakeflowClaudeActivityMonitorProcess";
export const WAKEFLOW_CLAUDE_ACTIVITY_MANAGER_LOCK_KIND = "WakeflowClaudeActivityMonitorManagerLock";

const HOST_ID = WAKEFLOW_CLAUDE_ACTIVITY_HOST_ID;
const SCHEMA_VERSION = WAKEFLOW_CLAUDE_ACTIVITY_SCHEMA_VERSION;
const PROCESS_KIND = WAKEFLOW_CLAUDE_ACTIVITY_PROCESS_KIND;
const MANAGER_LOCK_KIND = WAKEFLOW_CLAUDE_ACTIVITY_MANAGER_LOCK_KIND;
const MODULE_FILE = fileURLToPath(import.meta.url);
const WORKER_MARKER = "--wakeflow-claude-activity-worker-v1";
const ACTIVITY_ROOT_REF = `.wakeflow-local/runtime/hosts/${HOST_ID}/operations/activity-monitor`;
const PROMPT_ROOT_REF = `.wakeflow-local/runtime/hosts/${HOST_ID}/operations/temp/prompts`;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const SERVER_CONTEXT_ID_RE = /^claude-server-context_[0-9a-f]{64}$/u;
const MONITOR_ID_RE = /^claude-monitor_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LOCK_ID_RE = /^claude-activity-lock_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const WORKSPACE_OPERATION_ID_RE = /^workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROMPT_FILE_RE = /^(workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.txt$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.[0-9]{1,9})?Z$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_PROMPT_BYTES = 1024 * 1024;
const MAX_TMUX_OUTPUT_BYTES = 1024 * 1024;
const MAX_PANES = 4_096;
const MAX_CONTEXT_ENTRIES = 16;
const MAX_ACTIVITY_CONTEXTS = 4_096;
const MAX_PROMPT_FILES = 4_096;
const MAX_WINDOW_IDS = 4_096;
const TMUX_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_MS = 1_500;
const MIN_POLL_MS = 800;
const MAX_POLL_MS = 60_000;
const DEFAULT_PROMPT_EXPIRY_MS = 60 * 60 * 1000;
const MIN_PROMPT_EXPIRY_MS = 15 * 60 * 1000;
const STOP_TIMEOUT_MS = 5_000;
const ABSENT_GLYPH_SENTINEL = "__wakeflow_absent__";
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const ACTIVITY_MEMORY = new Map();

/** 统一承载activity/temp边界的稳定错误码与脱敏details。 */
export class WakeflowClaudeActivityError extends Error {
  constructor(code, message, { cause, details = {} } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowClaudeActivityError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowClaudeActivityError(code, message, { cause, details });
}

function boundary(label, cause, code = "wakeflow-claude-activity") {
  if (cause instanceof WakeflowClaudeActivityError) throw cause;
  fail(code, `${label} failed closed`, {
    ...(typeof cause?.code === "string" ? { causeCode: cause.code } : {}),
  }, cause);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, required, optional, label) {
  if (!plainObject(value)) fail("wakeflow-claude-activity-contract", `${label} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("wakeflow-claude-activity-contract", `${label} has an unknown field`, {
        field: String(key),
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-claude-activity-contract", `${label}.${key} must be one enumerable data property`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-claude-activity-contract", `${label} is missing ${key}`);
    }
  }
  return value;
}

// 外部数组只允许标准原型、连续own data索引和唯一length，避免getter或稀疏槽进入被动检查。
function exactDataArray(value, label, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("wakeflow-claude-activity-contract", `${label} must be one standard array`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    value.length > maximum
    || keys.length !== value.length + 1
    || keys.at(-1) !== "length"
  ) {
    fail("wakeflow-claude-activity-contract", `${label} must be bounded, dense and have no extra fields`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (keys[index] !== key || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-claude-activity-contract", `${label}[${index}] must be one enumerable data property`);
    }
  }
  return value;
}

function typedId(value, type, label) {
  try {
    assertWakeflowId(value, type);
  } catch (cause) {
    fail("wakeflow-claude-activity-identity", `${label} must be a typed ${type} ID`, {}, cause);
  }
  return value;
}

function matchToken(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail("wakeflow-claude-activity-identity", `${label} is invalid`);
  }
  return value;
}

function digest(value, label) {
  return matchToken(value, DIGEST_RE, label);
}

// opaque context ID必须由同一digest逐字派生，不能把任意合法形状当成可访问目录authority。
function normalizeServerContextIdentity(serverContextIdValue, serverContextDigestValue, label) {
  const serverContextId = matchToken(
    serverContextIdValue,
    SERVER_CONTEXT_ID_RE,
    `${label}.serverContextId`,
  );
  const serverContextDigest = digest(serverContextDigestValue, `${label}.serverContextDigest`);
  if (serverContextId !== `claude-server-context_${serverContextDigest.slice("sha256:".length)}`) {
    fail("wakeflow-claude-activity-context", `${label} ID does not match its digest`);
  }
  return Object.freeze({ serverContextId, serverContextDigest });
}

function timestamp(value, label) {
  const match = typeof value === "string" ? value.match(TIMESTAMP_RE) : null;
  if (!match) {
    fail("wakeflow-claude-activity-time", `${label} must be one strict UTC timestamp`);
  }
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
    fail("wakeflow-claude-activity-time", `${label} must name one real UTC instant`);
  }
  return value;
}

function boundedString(value, label, maximum = 4_096) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value !== value.trim()
    || CONTROL_RE.test(value)
  ) {
    fail("wakeflow-claude-activity-contract", `${label} must be one bounded trimmed token`);
  }
  return value;
}

function nullableSocketName(value, label = "socketName") {
  if (value === null) return null;
  const token = boundedString(value, label, 128);
  if (token === "." || token === ".." || /[\/\\]/u.test(token)) {
    fail("wakeflow-claude-activity-contract", `${label} is not one tmux socket name`);
  }
  return token;
}

function normalizeWorkspaceRoot(value) {
  const lexical = boundedString(value, "workspaceRoot", 8_192);
  if (!path.isAbsolute(lexical) || path.resolve(lexical) !== lexical) {
    fail("wakeflow-claude-activity-workspace", "workspace root must be one normalized absolute path");
  }
  let stat;
  let real;
  try {
    stat = fs.lstatSync(lexical);
    real = fs.realpathSync.native(lexical);
  } catch (cause) {
    fail("wakeflow-claude-activity-workspace", "workspace root cannot be inspected", {}, cause);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || path.resolve(real) !== lexical) {
    fail("wakeflow-claude-activity-workspace", "workspace root must be one canonical real directory");
  }
  return lexical;
}

function relativeFile(workspaceRoot, ref) {
  return path.join(workspaceRoot, ...ref.split("/"));
}

function currentEuid() {
  return typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
}

function modeOf(stat) {
  return typeof stat.mode === "bigint"
    ? Number(stat.mode & 0o777n)
    : Number(stat.mode & 0o777);
}

// 文件身份保留纳秒时间与完整inode字段；mtimeMs只用于保守年龄计算，不参与CAS。
function statIdentity(stat) {
  return Object.freeze({
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
    mode: modeOf(stat),
    uid: String(stat.uid),
    gid: String(stat.gid),
    linkCount: String(stat.nlink),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
    mtimeMs: Number(stat.mtimeNs / 1_000_000n),
  });
}

function sameStat(left, right) {
  return Boolean(left && right)
    && left.deviceId === String(right.dev)
    && left.inodeId === String(right.ino)
    && left.mode === modeOf(right)
    && left.uid === String(right.uid)
    && left.gid === String(right.gid)
    && left.linkCount === String(right.nlink)
    && left.size === String(right.size)
    && left.mtimeNs === String(right.mtimeNs)
    && left.ctimeNs === String(right.ctimeNs);
}

function sameNode(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.nlink === right.nlink;
}

function assertPrivateDirectory(file, label) {
  let stat;
  try {
    stat = fs.lstatSync(file, { bigint: true });
  } catch (cause) {
    fail("wakeflow-claude-activity-layout", `${label} is missing or unreadable`, {}, cause);
  }
  const euid = currentEuid();
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || modeOf(stat) !== 0o700
    || (euid !== null && stat.uid !== euid)
  ) {
    fail("wakeflow-claude-activity-layout", `${label} must be one current-euid mode 0700 directory`);
  }
  return stat;
}

function assertPrivateDirectoryChain(workspaceRoot, ref) {
  let current = workspaceRoot;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    assertPrivateDirectory(current, ref);
  }
  return current;
}

function syncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// 目录枚举在收集第maximum+1项时立即失败，避免unknown residue制造无界内存与排序工作。
function boundedDirectoryNames(directory, maximum, label) {
  let handle;
  const names = [];
  try {
    handle = fs.opendirSync(directory);
    for (;;) {
      const entry = handle.readSync();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length > maximum) {
        fail("wakeflow-claude-activity-inventory-limit", `${label} exceeded its closed entry bound`, {
          maximum,
        });
      }
    }
  } catch (cause) {
    if (cause instanceof WakeflowClaudeActivityError) throw cause;
    fail("wakeflow-claude-activity-storage", `${label} cannot be enumerated`, {}, cause);
  } finally {
    if (handle) {
      try {
        handle.closeSync();
      } catch {
        // 后续读取会继续按失败关闭处理。
      }
    }
  }
  return names.sort(lexicalCompare);
}

// 仅删除仍为同一私有节点的空context目录；非空目录不是错误，也不会被递归处理。
function removeEmptyPrivateDirectory(directory, label) {
  let before;
  try {
    before = fs.lstatSync(directory, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return false;
    fail("wakeflow-claude-activity-recovery-required", `${label} cannot be inspected`, {}, cause);
  }
  if (
    before.isSymbolicLink()
    || !before.isDirectory()
    || modeOf(before) !== 0o700
    || (currentEuid() !== null && before.uid !== currentEuid())
  ) {
    fail("wakeflow-claude-activity-recovery-required", `${label} is no longer one private directory`);
  }
  let handle;
  try {
    handle = fs.opendirSync(directory);
    if (handle.readSync() !== null) return false;
  } catch (cause) {
    fail("wakeflow-claude-activity-recovery-required", `${label} emptiness cannot be proved`, {}, cause);
  } finally {
    if (handle) handle.closeSync();
  }
  const parentPath = path.dirname(directory);
  let parentDescriptor;
  let directoryDescriptor;
  try {
    const parentBefore = fs.lstatSync(parentPath, { bigint: true });
    if (
      parentBefore.isSymbolicLink()
      || !parentBefore.isDirectory()
      || modeOf(parentBefore) !== 0o700
      || (currentEuid() !== null && parentBefore.uid !== currentEuid())
    ) {
      fail("wakeflow-claude-activity-recovery-required", `${label} parent is no longer private`);
    }
    parentDescriptor = fs.openSync(
      parentPath,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY ?? 0)
        | (fs.constants.O_NOFOLLOW ?? 0),
    );
    directoryDescriptor = fs.openSync(
      directory,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY ?? 0)
        | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const parentOpened = fs.fstatSync(parentDescriptor, { bigint: true });
    const directoryOpened = fs.fstatSync(directoryDescriptor, { bigint: true });
    if (
      !sameStat(statIdentity(parentBefore), parentOpened)
      || !sameStat(statIdentity(before), directoryOpened)
      || !sameNode(parentOpened, fs.lstatSync(parentPath, { bigint: true }))
      || !sameNode(directoryOpened, fs.lstatSync(directory, { bigint: true }))
    ) {
      fail("wakeflow-claude-activity-recovery-required", `${label} changed before removal`);
    }
    fs.rmdirSync(directory);
    fs.fsyncSync(parentDescriptor);
    if (!sameNode(fs.fstatSync(parentDescriptor, { bigint: true }), fs.lstatSync(parentPath, { bigint: true }))) {
      fail("wakeflow-claude-activity-recovery-required", `${label} parent changed during removal`);
    }
  } catch (cause) {
    if (cause instanceof WakeflowClaudeActivityError) throw cause;
    fail("wakeflow-claude-activity-recovery-required", `${label} cannot be removed exactly`, {}, cause);
  } finally {
    if (directoryDescriptor !== undefined) fs.closeSync(directoryDescriptor);
    if (parentDescriptor !== undefined) fs.closeSync(parentDescriptor);
  }
  try {
    fs.lstatSync(directory);
    fail("wakeflow-claude-activity-recovery-required", `${label} remains after removal`);
  } catch (cause) {
    if (cause instanceof WakeflowClaudeActivityError) throw cause;
    if (cause?.code !== "ENOENT") {
      fail("wakeflow-claude-activity-recovery-required", `${label} absence cannot be proved`, {}, cause);
    }
  }
  return true;
}

// descriptor读取最多maximum+1字节；文件在初次stat后增长也不会触发无界分配。
function readBoundedFile(descriptor, maximum, label) {
  const buffer = Buffer.allocUnsafe(maximum + 1);
  let offset = 0;
  try {
    while (offset < buffer.length) {
      const count = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
  } catch (cause) {
    fail("wakeflow-claude-activity-storage", `${label} cannot be read safely`, {}, cause);
  }
  if (offset > maximum) {
    fail("wakeflow-claude-activity-storage", `${label} exceeded its closed byte bound`);
  }
  return buffer.subarray(0, offset);
}

function createPrivateDirectory(parent, name, label) {
  const target = path.join(parent, name);
  try {
    fs.mkdirSync(target, { mode: 0o700 });
    syncDirectory(parent);
  } catch (cause) {
    if (cause?.code !== "EEXIST") {
      fail("wakeflow-claude-activity-layout", `${label} cannot be created`, {}, cause);
    }
  }
  assertPrivateDirectory(target, label);
  return target;
}

function normalizeProcessIdentity(value, label) {
  exactObject(value, ["platform", "pid", "startIdentity"], [], label);
  if (!new Set(["darwin", "linux"]).has(value.platform)) {
    fail("wakeflow-claude-activity-process", `${label}.platform is unsupported`);
  }
  if (!Number.isSafeInteger(value.pid) || value.pid <= 0) {
    fail("wakeflow-claude-activity-process", `${label}.pid is invalid`);
  }
  return deepFreeze({
    platform: value.platform,
    pid: value.pid,
    startIdentity: digest(value.startIdentity, `${label}.startIdentity`),
  });
}

function processUnsigned(value) {
  return {
    kind: PROCESS_KIND,
    schemaVersion: SCHEMA_VERSION,
    programId: value.programId,
    hostId: HOST_ID,
    serverContextId: value.serverContextId,
    serverContextDigest: value.serverContextDigest,
    monitorId: value.monitorId,
    processIdentity: value.processIdentity,
    executableDigest: value.executableDigest,
    argvDigest: value.argvDigest,
    startedAt: value.startedAt,
  };
}

function validateProcessRecord(value) {
  exactObject(value, [
    "kind",
    "schemaVersion",
    "programId",
    "hostId",
    "serverContextId",
    "serverContextDigest",
    "monitorId",
    "processIdentity",
    "executableDigest",
    "argvDigest",
    "startedAt",
    "processDigest",
  ], [], "activity process record");
  if (value.kind !== PROCESS_KIND || value.schemaVersion !== SCHEMA_VERSION || value.hostId !== HOST_ID) {
    fail("wakeflow-claude-activity-process", "activity process kind, version, or host is invalid");
  }
  const context = normalizeServerContextIdentity(
    value.serverContextId,
    value.serverContextDigest,
    "process context",
  );
  const unsigned = processUnsigned({
    programId: typedId(value.programId, "program", "process.programId"),
    ...context,
    monitorId: matchToken(value.monitorId, MONITOR_ID_RE, "process.monitorId"),
    processIdentity: normalizeProcessIdentity(value.processIdentity, "process.processIdentity"),
    executableDigest: digest(value.executableDigest, "process.executableDigest"),
    argvDigest: digest(value.argvDigest, "process.argvDigest"),
    startedAt: timestamp(value.startedAt, "process.startedAt"),
  });
  const expected = canonicalJsonDigest(unsigned);
  if (value.processDigest !== expected) {
    fail("wakeflow-claude-activity-process", "activity process self digest is invalid");
  }
  return deepFreeze({ ...unsigned, processDigest: expected });
}

function createProcessRecord(value) {
  exactObject(value, [
    "programId",
    "serverContextId",
    "serverContextDigest",
    "monitorId",
    "processIdentity",
    "executableDigest",
    "argvDigest",
    "startedAt",
  ], [], "activity process creation input");
  const context = normalizeServerContextIdentity(
    value.serverContextId,
    value.serverContextDigest,
    "process context",
  );
  const unsigned = processUnsigned({
    programId: typedId(value.programId, "program", "process.programId"),
    ...context,
    monitorId: matchToken(value.monitorId, MONITOR_ID_RE, "process.monitorId"),
    processIdentity: normalizeProcessIdentity(value.processIdentity, "process.processIdentity"),
    executableDigest: digest(value.executableDigest, "process.executableDigest"),
    argvDigest: digest(value.argvDigest, "process.argvDigest"),
    startedAt: timestamp(value.startedAt, "process.startedAt"),
  });
  return validateProcessRecord({ ...unsigned, processDigest: canonicalJsonDigest(unsigned) });
}

function processCanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(validateProcessRecord(value))}\n`, "utf8");
}

function managerLockUnsigned(value) {
  return {
    kind: MANAGER_LOCK_KIND,
    schemaVersion: SCHEMA_VERSION,
    programId: value.programId,
    hostId: HOST_ID,
    serverContextId: value.serverContextId,
    serverContextDigest: value.serverContextDigest,
    lockId: value.lockId,
    workspaceOperationId: value.workspaceOperationId,
    owner: value.owner,
    acquiredAt: value.acquiredAt,
  };
}

function validateManagerLockRecord(value) {
  exactObject(value, [
    "kind",
    "schemaVersion",
    "programId",
    "hostId",
    "serverContextId",
    "serverContextDigest",
    "lockId",
    "workspaceOperationId",
    "owner",
    "acquiredAt",
    "lockDigest",
  ], [], "activity manager lock record");
  if (value.kind !== MANAGER_LOCK_KIND || value.schemaVersion !== SCHEMA_VERSION || value.hostId !== HOST_ID) {
    fail("wakeflow-claude-activity-manager-lock", "activity manager lock kind, version, or host is invalid");
  }
  const context = normalizeServerContextIdentity(
    value.serverContextId,
    value.serverContextDigest,
    "manager lock context",
  );
  const unsigned = managerLockUnsigned({
    programId: typedId(value.programId, "program", "lock.programId"),
    ...context,
    lockId: matchToken(value.lockId, LOCK_ID_RE, "lock.lockId"),
    workspaceOperationId: matchToken(
      value.workspaceOperationId,
      WORKSPACE_OPERATION_ID_RE,
      "lock.workspaceOperationId",
    ),
    owner: normalizeProcessIdentity(value.owner, "lock.owner"),
    acquiredAt: timestamp(value.acquiredAt, "lock.acquiredAt"),
  });
  const expected = canonicalJsonDigest(unsigned);
  if (value.lockDigest !== expected) {
    fail("wakeflow-claude-activity-manager-lock", "activity manager lock self digest is invalid");
  }
  return deepFreeze({ ...unsigned, lockDigest: expected });
}

function createManagerLockRecord(value) {
  exactObject(value, [
    "programId",
    "serverContextId",
    "serverContextDigest",
    "lockId",
    "workspaceOperationId",
    "owner",
    "acquiredAt",
  ], [], "activity manager lock creation input");
  const context = normalizeServerContextIdentity(
    value.serverContextId,
    value.serverContextDigest,
    "manager lock context",
  );
  const unsigned = managerLockUnsigned({
    programId: typedId(value.programId, "program", "lock.programId"),
    ...context,
    lockId: matchToken(value.lockId, LOCK_ID_RE, "lock.lockId"),
    workspaceOperationId: matchToken(
      value.workspaceOperationId,
      WORKSPACE_OPERATION_ID_RE,
      "lock.workspaceOperationId",
    ),
    owner: normalizeProcessIdentity(value.owner, "lock.owner"),
    acquiredAt: timestamp(value.acquiredAt, "lock.acquiredAt"),
  });
  return validateManagerLockRecord({ ...unsigned, lockDigest: canonicalJsonDigest(unsigned) });
}

function managerLockCanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(validateManagerLockRecord(value))}\n`, "utf8");
}

function activityContextRef(serverContextId) {
  return `${ACTIVITY_ROOT_REF}/${matchToken(serverContextId, SERVER_CONTEXT_ID_RE, "serverContextId")}`;
}

function processRef(serverContextId) {
  return `${activityContextRef(serverContextId)}/process.json`;
}

function managerLockRef(serverContextId) {
  return `${activityContextRef(serverContextId)}/manager.lock`;
}

function sourceDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readCanonicalSource(workspaceRoot, ref, validate, canonicalBytes, label, { allowMissing = true } = {}) {
  const file = relativeFile(workspaceRoot, ref);
  let lexical;
  try {
    lexical = fs.lstatSync(file, { bigint: true });
  } catch (cause) {
    if (allowMissing && cause?.code === "ENOENT") return null;
    fail("wakeflow-claude-activity-storage", `${label} cannot be inspected`, { ref }, cause);
  }
  const euid = currentEuid();
  if (
    lexical.isSymbolicLink()
    || !lexical.isFile()
    || modeOf(lexical) !== 0o600
    || lexical.nlink !== 1n
    || lexical.size > BigInt(MAX_RECORD_BYTES)
    || (euid !== null && lexical.uid !== euid)
  ) {
    fail("wakeflow-claude-activity-storage", `${label} is not one bounded current-euid mode 0600 file`, { ref });
  }
  let descriptor;
  let bytes;
  let opened;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    opened = fs.fstatSync(descriptor, { bigint: true });
    if (!sameStat(statIdentity(lexical), opened)) {
      fail("wakeflow-claude-activity-storage", `${label} changed before read`, { ref });
    }
    bytes = readBoundedFile(descriptor, MAX_RECORD_BYTES, label);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameStat(statIdentity(opened), after) || BigInt(bytes.length) !== after.size) {
      fail("wakeflow-claude-activity-storage", `${label} changed during read`, { ref });
    }
  } catch (cause) {
    if (cause instanceof WakeflowClaudeActivityError) throw cause;
    fail("wakeflow-claude-activity-storage", `${label} cannot be read safely`, { ref }, cause);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  let text;
  let raw;
  try {
    text = UTF8_FATAL.decode(bytes);
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) throw new Error("not one canonical JSON line");
    raw = JSON.parse(text);
  } catch (cause) {
    fail("wakeflow-claude-activity-storage", `${label} is not canonical UTF-8 JSON`, { ref }, cause);
  }
  const record = validate(raw);
  const expected = canonicalBytes(record);
  if (!bytes.equals(expected)) {
    fail("wakeflow-claude-activity-storage", `${label} bytes are not canonical`, { ref });
  }
  return Object.freeze({
    ref,
    file,
    bytes,
    sha256: sourceDigest(bytes),
    stat: statIdentity(opened),
    record,
  });
}

function writeNewCanonicalSource(workspaceRoot, ref, record, canonicalBytes, readBack, label) {
  const file = relativeFile(workspaceRoot, ref);
  const bytes = canonicalBytes(record);
  let descriptor;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (!stat.isFile() || modeOf(stat) !== 0o600 || stat.nlink !== 1n || stat.size !== BigInt(bytes.length)) {
      fail("wakeflow-claude-activity-storage", `${label} stage changed while writing`, { ref });
    }
  } catch (cause) {
    if (cause instanceof WakeflowClaudeActivityError) throw cause;
    const code = cause?.code === "EEXIST"
      ? "wakeflow-claude-activity-conflict"
      : "wakeflow-claude-activity-storage";
    fail(code, `${label} cannot be created exclusively`, { ref }, cause);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  syncDirectory(path.dirname(file));
  const source = readBack();
  if (!source || !source.bytes.equals(bytes)) {
    fail("wakeflow-claude-activity-recovery-required", `${label} commit cannot be proved`, { ref });
  }
  return source;
}

// 删除前同时固定source与私有parent；删除后的durability落在同一parent descriptor上。
function exactUnlinkPrivateSource(source, current, label) {
  if (!current || current.ref !== source.ref || current.file !== source.file) {
    fail("wakeflow-claude-activity-recovery-required", `${label} source identity changed before release`, {
      ref: source.ref,
    });
  }
  const parentPath = path.dirname(source.file);
  let parentDescriptor;
  let sourceDescriptor;
  try {
    const parentBefore = fs.lstatSync(parentPath, { bigint: true });
    if (
      parentBefore.isSymbolicLink()
      || !parentBefore.isDirectory()
      || modeOf(parentBefore) !== 0o700
      || (currentEuid() !== null && parentBefore.uid !== currentEuid())
    ) {
      fail("wakeflow-claude-activity-recovery-required", `${label} parent is no longer private`, {
        ref: source.ref,
      });
    }
    parentDescriptor = fs.openSync(
      parentPath,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY ?? 0)
        | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const parentOpened = fs.fstatSync(parentDescriptor, { bigint: true });
    if (!sameStat(statIdentity(parentBefore), parentOpened)) {
      fail("wakeflow-claude-activity-recovery-required", `${label} parent changed while opening`, {
        ref: source.ref,
      });
    }
    const lexical = fs.lstatSync(current.file, { bigint: true });
    if (!sameStat(source.stat, lexical) || !sameStat(current.stat, lexical)) {
      fail("wakeflow-claude-activity-recovery-required", `${label} source identity changed before release`, {
        ref: source.ref,
      });
    }
    sourceDescriptor = fs.openSync(current.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    if (!sameStat(source.stat, fs.fstatSync(sourceDescriptor, { bigint: true }))) {
      fail("wakeflow-claude-activity-recovery-required", `${label} changed before unlink`, { ref: source.ref });
    }
    const parentAtEffect = fs.lstatSync(parentPath, { bigint: true });
    if (!sameNode(parentOpened, parentAtEffect)) {
      fail("wakeflow-claude-activity-recovery-required", `${label} parent changed before unlink`, {
        ref: source.ref,
      });
    }
    fs.unlinkSync(current.file);
    fs.fsyncSync(parentDescriptor);
    const parentAfterDescriptor = fs.fstatSync(parentDescriptor, { bigint: true });
    const parentAfterPath = fs.lstatSync(parentPath, { bigint: true });
    if (!sameNode(parentAfterDescriptor, parentAfterPath)) {
      fail("wakeflow-claude-activity-recovery-required", `${label} parent changed during unlink`, {
        ref: source.ref,
      });
    }
    if (fs.fstatSync(sourceDescriptor, { bigint: true }).nlink !== 0n) {
      fail("wakeflow-claude-activity-recovery-required", `${label} unlink was not exact`, { ref: source.ref });
    }
  } catch (cause) {
    if (cause instanceof WakeflowClaudeActivityError) throw cause;
    fail("wakeflow-claude-activity-recovery-required", `${label} cannot be released exactly`, {
      ref: source.ref,
    }, cause);
  } finally {
    if (sourceDescriptor !== undefined) fs.closeSync(sourceDescriptor);
    if (parentDescriptor !== undefined) fs.closeSync(parentDescriptor);
  }
  try {
    fs.lstatSync(current.file);
    fail("wakeflow-claude-activity-recovery-required", `${label} remains after release`, { ref: source.ref });
  } catch (cause) {
    if (cause instanceof WakeflowClaudeActivityError) throw cause;
    if (cause?.code !== "ENOENT") {
      fail("wakeflow-claude-activity-recovery-required", `${label} absence cannot be proved`, {
        ref: source.ref,
      }, cause);
    }
  }
}

function exactUnlinkSource(source, readBack, label) {
  const current = readBack();
  if (!current || current.sha256 !== source.sha256) {
    fail("wakeflow-claude-activity-recovery-required", `${label} content changed before release`, {
      ref: source.ref,
    });
  }
  exactUnlinkPrivateSource(source, current, label);
}

function readProcess(workspaceRoot, serverContextId) {
  return readCanonicalSource(
    workspaceRoot,
    processRef(serverContextId),
    validateProcessRecord,
    processCanonicalBytes,
    "Claude activity process",
  );
}

function readManagerLock(workspaceRoot, serverContextId) {
  return readCanonicalSource(
    workspaceRoot,
    managerLockRef(serverContextId),
    validateManagerLockRecord,
    managerLockCanonicalBytes,
    "Claude activity manager lock",
  );
}

function processHealth(source) {
  if (!source) return "missing";
  let snapshot;
  try {
    snapshot = inspectWakeflowProcessSnapshot(source.record.processIdentity.pid);
  } catch {
    return "unverifiable";
  }
  if (
    snapshot === null
    || snapshot.identity.startIdentity !== source.record.processIdentity.startIdentity
  ) return "dead";
  if (
    snapshot.identity.platform !== source.record.processIdentity.platform
    || snapshot.executableDigest !== source.record.executableDigest
    || snapshot.argvDigest !== source.record.argvDigest
  ) return "identity-mismatch";
  return "running";
}

function managerLockHealth(source) {
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

function contextDirectory(workspaceRoot, serverContextId, { create = false } = {}) {
  const activityRoot = assertPrivateDirectoryChain(workspaceRoot, ACTIVITY_ROOT_REF);
  const name = matchToken(serverContextId, SERVER_CONTEXT_ID_RE, "serverContextId");
  const target = path.join(activityRoot, name);
  if (create) return createPrivateDirectory(activityRoot, name, "Claude activity server context root");
  try {
    return assertPrivateDirectory(target, "Claude activity server context root") && target;
  } catch (cause) {
    if (cause?.cause?.code === "ENOENT" || cause?.details?.causeCode === "ENOENT") return null;
    throw cause;
  }
}

function scanContext(workspaceRoot, context, { allowMissing = true } = {}) {
  const directory = contextDirectory(workspaceRoot, context.serverContextId);
  if (!directory) {
    if (allowMissing) return Object.freeze({ directory: null, process: null, managerLock: null });
    fail("wakeflow-claude-activity-layout", "Claude activity server context root is missing");
  }
  const entries = boundedDirectoryNames(
    directory,
    MAX_CONTEXT_ENTRIES,
    "Claude activity server context",
  );
  const unknown = entries.filter((entry) => !new Set(["process.json", "manager.lock"]).has(entry));
  if (unknown.length > 0) {
    fail("wakeflow-claude-activity-unknown", "Claude activity server context contains unknown residue", {
      count: unknown.length,
    });
  }
  const processSource = readProcess(workspaceRoot, context.serverContextId);
  const managerLock = readManagerLock(workspaceRoot, context.serverContextId);
  for (const source of [processSource, managerLock].filter(Boolean)) {
    if (
      source.record.programId !== context.programId
      || source.record.serverContextDigest !== context.serverContextDigest
    ) {
      fail("wakeflow-claude-activity-context", "activity record belongs to another program or server context");
    }
  }
  return Object.freeze({ directory, process: processSource, managerLock });
}

function normalAuthority(workspaceRoot) {
  let snapshot;
  try {
    snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot });
  } catch (cause) {
    boundary("Claude activity config authority", cause, "wakeflow-claude-activity-authority");
  }
  return Object.freeze({
    workspaceRoot,
    programId: snapshot.model.program.programId,
    configDigest: snapshot.configDigest,
  });
}

/** 从program、真实socket路径和exact session派生不泄漏宿主坐标的opaque context。 */
export function deriveClaudeActivityServerContext(value = {}) {
  exactObject(value, ["programId", "socketPath", "sessionName"], [], "activity server context input");
  const programId = typedId(value.programId, "program", "programId");
  const socketPath = boundedString(value.socketPath, "socketPath", 8_192);
  if (!path.isAbsolute(socketPath) || path.resolve(socketPath) !== socketPath) {
    fail("wakeflow-claude-activity-context", "socketPath must be one normalized absolute tmux socket path");
  }
  const sessionName = boundedString(value.sessionName, "sessionName", 128);
  const serverContextDigest = canonicalJsonDigest({
    schemaVersion: SCHEMA_VERSION,
    programId,
    provider: "tmux",
    socketPath,
    sessionName,
  });
  return deepFreeze({
    kind: "WakeflowClaudeActivityServerContext",
    schemaVersion: SCHEMA_VERSION,
    programId,
    hostId: HOST_ID,
    serverContextId: `claude-server-context_${serverContextDigest.slice("sha256:".length)}`,
    serverContextDigest,
  });
}

function normalizeContextTuple(value, programId, label = "serverContext") {
  exactObject(value, ["serverContextId", "serverContextDigest"], [], label);
  const context = normalizeServerContextIdentity(
    value.serverContextId,
    value.serverContextDigest,
    label,
  );
  return deepFreeze({
    programId,
    ...context,
  });
}

function publicActivity(context, inventory) {
  const health = processHealth(inventory.process);
  const lockHealth = managerLockHealth(inventory.managerLock);
  const issues = [];
  if (new Set(["dead", "identity-mismatch", "unverifiable"]).has(health)) issues.push(`process-${health}`);
  if (!new Set(["absent", "active"]).has(lockHealth)) issues.push(`manager-lock-${lockHealth}`);
  return deepFreeze({
    kind: "WakeflowClaudeActivityInspection",
    schemaVersion: SCHEMA_VERSION,
    programId: context.programId,
    hostId: HOST_ID,
    serverContextId: context.serverContextId,
    serverContextDigest: context.serverContextDigest,
    status: issues.length > 0 ? "attention-required" : health === "running" ? "running" : "stopped",
    process: inventory.process
      ? {
          monitorId: inventory.process.record.monitorId,
          processDigest: inventory.process.record.processDigest,
          startedAt: inventory.process.record.startedAt,
          health,
        }
      : null,
    manager: inventory.managerLock
      ? {
          lockDigest: inventory.managerLock.record.lockDigest,
          health: lockHealth,
        }
      : null,
    issues,
  });
}

/** 只读检查指定opaque context的process与manager lock，不做host发现或状态修复。 */
export function inspectClaudeActivity(value = {}) {
  exactObject(value, ["workspaceRoot", "serverContext"], [], "activity inspection input");
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const authority = normalAuthority(workspaceRoot);
  const context = normalizeContextTuple(value.serverContext, authority.programId);
  try {
    return publicActivity(context, scanContext(workspaceRoot, context));
  } catch (cause) {
    boundary("Claude activity inspection", cause, "wakeflow-claude-activity-inspection");
  }
}

function tmuxCommand() {
  const value = process.env.WAKEFLOW_TMUX_BIN ?? "tmux";
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 8_192
    || value !== value.trim()
    || CONTROL_RE.test(value)
  ) {
    fail("wakeflow-claude-activity-host", "WAKEFLOW_TMUX_BIN is invalid");
  }
  return value;
}

function tmuxArguments(socketName, args) {
  return socketName === null ? args : ["-L", socketName, ...args];
}

// 即使使用default socket也不允许继承当前tmux client定位，否则宿主观察会被ambient pane重定向。
function hostChildEnvironment() {
  const env = { ...process.env };
  delete env.TMUX;
  delete env.TMUX_PANE;
  if (!/utf-?8/iu.test(env.LC_ALL ?? env.LANG ?? "")) {
    env.LANG = "en_US.UTF-8";
    env.LC_ALL = "en_US.UTF-8";
  }
  return env;
}

function executeTmux(socketName, args, { input } = {}) {
  let result;
  try {
    result = spawnSync(tmuxCommand(), tmuxArguments(socketName, args), {
      encoding: "utf8",
      shell: false,
      env: hostChildEnvironment(),
      timeout: TMUX_TIMEOUT_MS,
      maxBuffer: MAX_TMUX_OUTPUT_BYTES,
      ...(input === undefined ? {} : { input }),
    });
  } catch (cause) {
    return Object.freeze({ ok: false, stdout: "", stderr: "", cause });
  }
  return Object.freeze({
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    cause: result.error,
  });
}

function observeServerContext(socketName, sessionName, programId) {
  const result = executeTmux(socketName, [
    "display-message",
    "-p",
    "-t",
    sessionName,
    "#{socket_path}\t#{session_name}",
  ]);
  if (!result.ok) {
    fail("wakeflow-claude-activity-host-observation", "tmux server context is unavailable", {}, result.cause);
  }
  const lines = result.stdout.split("\n").filter((line) => line.length > 0);
  if (lines.length !== 1) {
    fail("wakeflow-claude-activity-host-observation", "tmux server context returned an invalid row count");
  }
  const fields = lines[0].split("\t");
  if (fields.length !== 2 || fields[1] !== sessionName) {
    fail("wakeflow-claude-activity-host-observation", "tmux server context differs from the exact session");
  }
  const context = deriveClaudeActivityServerContext({
    programId,
    socketPath: fields[0],
    sessionName: fields[1],
  });
  return Object.freeze({
    ...context,
    socketName,
    sessionName,
  });
}

function normalizePollMs(value) {
  if (!Number.isSafeInteger(value) || value < MIN_POLL_MS || value > MAX_POLL_MS) {
    fail("wakeflow-claude-activity-contract", `pollMs must be between ${MIN_POLL_MS} and ${MAX_POLL_MS}`);
  }
  return value;
}

function normalizeMonitorInput(value, label) {
  exactObject(value, ["workspaceRoot", "socketName", "sessionName"], ["pollMs"], label);
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(value.workspaceRoot),
    socketName: nullableSocketName(value.socketName),
    sessionName: boundedString(value.sessionName, "sessionName", 128),
    pollMs: Object.hasOwn(value, "pollMs") ? normalizePollMs(value.pollMs) : DEFAULT_POLL_MS,
  });
}

function resolveMonitorContext(input) {
  const authority = normalAuthority(input.workspaceRoot);
  return Object.freeze({
    ...observeServerContext(input.socketName, input.sessionName, authority.programId),
    workspaceRoot: input.workspaceRoot,
    configDigest: authority.configDigest,
    pollMs: input.pollMs,
  });
}

function sameContext(left, right) {
  return left.programId === right.programId
    && left.configDigest === right.configDigest
    && left.serverContextId === right.serverContextId
    && left.serverContextDigest === right.serverContextDigest
    && left.socketName === right.socketName
    && left.sessionName === right.sessionName;
}

function acquireManagerLock(context, mutationContext) {
  const existing = readManagerLock(context.workspaceRoot, context.serverContextId);
  if (existing) {
    const health = managerLockHealth(existing);
    if (health === "active") {
      fail("wakeflow-claude-activity-manager-busy", "activity manager lock has one exact live owner");
    }
    if (health !== "stale") {
      fail("wakeflow-claude-activity-manager-unverifiable", "activity manager lock owner cannot be verified");
    }
    exactUnlinkSource(
      existing,
      () => readManagerLock(context.workspaceRoot, context.serverContextId),
      "stale Claude activity manager lock",
    );
  }
  const record = createManagerLockRecord({
    programId: context.programId,
    serverContextId: context.serverContextId,
    serverContextDigest: context.serverContextDigest,
    lockId: `claude-activity-lock_${randomUUID()}`,
    workspaceOperationId: mutationContext.operationId,
    owner: captureWakeflowProcessIdentity(),
    acquiredAt: new Date().toISOString(),
  });
  return writeNewCanonicalSource(
    context.workspaceRoot,
    managerLockRef(context.serverContextId),
    record,
    managerLockCanonicalBytes,
    () => readManagerLock(context.workspaceRoot, context.serverContextId),
    "Claude activity manager lock",
  );
}

function releaseManagerLock(context, source) {
  exactUnlinkSource(
    source,
    () => readManagerLock(context.workspaceRoot, context.serverContextId),
    "Claude activity manager lock",
  );
}

// 外层先冻结config/tmux事实，进入T02后重验并再取得context manager lock。
async function withActivityMutation(input, operationKind, callback, { removeEmpty = false } = {}) {
  const outer = resolveMonitorContext(input);
  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind,
      domainOwner: "activity-monitor-manager",
    }, async (mutationContext) => {
      let current;
      let managerLock = null;
      let response;
      try {
        current = resolveMonitorContext(input);
        if (!sameContext(current, outer)) {
          fail("wakeflow-claude-activity-stale", "config or tmux server context changed before mutation admission");
        }
        contextDirectory(current.workspaceRoot, current.serverContextId, { create: true });
        managerLock = acquireManagerLock(current, mutationContext);
        response = Object.freeze({ outcome: "success", value: await callback(current) });
      } catch (error) {
        response = Object.freeze({ outcome: "rejected", error });
      }
      if (managerLock) {
        try {
          releaseManagerLock(current, managerLock);
        } catch (error) {
          response = Object.freeze({ outcome: "rejected", error });
        }
      }
      if (removeEmpty && current) {
        const directory = relativeFile(current.workspaceRoot, activityContextRef(current.serverContextId));
        try {
          removeEmptyPrivateDirectory(directory, "Claude activity server context root");
        } catch (error) {
          response = Object.freeze({ outcome: "rejected", error });
        }
      }
      return response;
    });
  } catch (cause) {
    boundary("Claude activity workspace mutation", cause, "wakeflow-claude-activity-mutation");
  }
  if (result?.outcome === "rejected") {
    if (result.error instanceof Error) throw result.error;
    fail("wakeflow-claude-activity-operation", "activity mutation was rejected without one structured error");
  }
  if (result?.outcome !== "success") {
    fail("wakeflow-claude-activity-operation", "activity mutation returned an invalid result");
  }
  return result.value;
}

function encodeWorkerValue(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeWorkerValue(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/u.test(value)) {
    fail("wakeflow-claude-activity-worker", `${label} is not canonical base64url`);
  }
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  if (encodeWorkerValue(decoded) !== value) {
    fail("wakeflow-claude-activity-worker", `${label} is not canonical base64url`);
  }
  return decoded;
}

function workerArguments(context, monitorId) {
  return [
    MODULE_FILE,
    WORKER_MARKER,
    "--workspace-root-base64",
    encodeWorkerValue(context.workspaceRoot),
    "--socket-name-base64",
    encodeWorkerValue(context.socketName ?? ""),
    "--session-name-base64",
    encodeWorkerValue(context.sessionName),
    "--server-context-id",
    context.serverContextId,
    "--server-context-digest",
    context.serverContextDigest,
    "--monitor-id",
    monitorId,
    "--poll-ms",
    String(context.pollMs),
  ];
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

function waitForWorkerMessage(child, expected) {
  return new Promise((resolve, reject) => {
    let bytes = "";
    let timeout;
    const settle = (callback, value) => {
      clearTimeout(timeout);
      child.stdout.removeAllListeners();
      callback(value);
    };
    timeout = setTimeout(
      () => settle(reject, new Error("activity worker handshake timed out")),
      10_000,
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      bytes += chunk;
      if (bytes === expected) settle(resolve);
      else if (!expected.startsWith(bytes) || bytes.length >= expected.length) {
        settle(reject, new Error("activity worker handshake is invalid"));
      }
    });
    child.stdout.on("end", () => settle(reject, new Error("activity worker exited during handshake")));
    child.stdout.on("error", (cause) => settle(reject, cause));
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function captureChildSnapshot(child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      fail("wakeflow-claude-activity-start", "activity worker exited before its process identity was captured");
    }
    try {
      const snapshot = inspectWakeflowProcessSnapshot(child.pid);
      if (snapshot) return snapshot;
    } catch {
      // The exact child may not yet be visible to the platform process observer.
    }
    await sleep(10);
  }
  fail("wakeflow-claude-activity-start", "activity worker process identity could not be captured");
}

// parent/child两阶段握手保证worker只在canonical process record可回读后接管poll loop。
async function startWorker(context) {
  const monitorId = `claude-monitor_${randomUUID()}`;
  const child = spawn(process.execPath, workerArguments(context, monitorId), {
    detached: true,
    stdio: ["pipe", "pipe", "ignore"],
    env: hostChildEnvironment(),
    windowsHide: true,
  });
  let source = null;
  try {
    await waitForSpawn(child);
    await waitForWorkerMessage(child, "ready\n");
    const snapshot = await captureChildSnapshot(child);
    const record = createProcessRecord({
      programId: context.programId,
      serverContextId: context.serverContextId,
      serverContextDigest: context.serverContextDigest,
      monitorId,
      processIdentity: snapshot.identity,
      executableDigest: snapshot.executableDigest,
      argvDigest: snapshot.argvDigest,
      startedAt: new Date().toISOString(),
    });
    source = writeNewCanonicalSource(
      context.workspaceRoot,
      processRef(context.serverContextId),
      record,
      processCanonicalBytes,
      () => readProcess(context.workspaceRoot, context.serverContextId),
      "Claude activity process",
    );
    const committed = waitForWorkerMessage(child, "committed\n");
    child.stdin.end("commit\n");
    await committed;
    child.stdout.destroy();
    child.unref();
    return source;
  } catch (cause) {
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (source) {
      try {
        await waitForExactProcessExit(source);
        exactUnlinkSource(
          source,
          () => readProcess(context.workspaceRoot, context.serverContextId),
          "failed Claude activity process",
        );
      } catch {
        // Preserve the stronger process-start error; strict inspection exposes residue.
      }
    }
    boundary("Claude activity worker start", cause, "wakeflow-claude-activity-start");
  }
}

function ensureResult(context, inventory, created) {
  const inspection = publicActivity(context, inventory);
  return deepFreeze({
    kind: "WakeflowClaudeActivityEnsureResult",
    schemaVersion: SCHEMA_VERSION,
    programId: context.programId,
    hostId: HOST_ID,
    serverContextId: context.serverContextId,
    serverContextDigest: context.serverContextDigest,
    status: created ? "started" : "current",
    created,
    process: inspection.process,
  });
}

/** 在T02→server-context manager lock顺序下复用或创建唯一可验证monitor generation。 */
export async function ensureClaudeActivityMonitor(value = {}) {
  const input = normalizeMonitorInput(value, "activity ensure input");
  return withActivityMutation(input, "claude-activity-ensure", async (context) => {
    let inventory = scanContext(context.workspaceRoot, context, { allowMissing: false });
    const health = processHealth(inventory.process);
    if (health === "running") return ensureResult(context, inventory, false);
    if (new Set(["identity-mismatch", "unverifiable"]).has(health)) {
      fail("wakeflow-claude-activity-process-identity", "current activity process cannot authorize reuse or replacement", {
        health,
      });
    }
    if (inventory.process) {
      exactUnlinkSource(
        inventory.process,
        () => readProcess(context.workspaceRoot, context.serverContextId),
        "dead Claude activity process",
      );
    }
    await startWorker(context);
    inventory = scanContext(context.workspaceRoot, context, { allowMissing: false });
    if (processHealth(inventory.process) !== "running") {
      fail("wakeflow-claude-activity-start", "new activity process generation is not exact and live");
    }
    return ensureResult(context, inventory, true);
  });
}

async function waitForExactProcessExit(source) {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const health = processHealth(source);
    if (health === "dead" || health === "identity-mismatch") return;
    if (health !== "running") {
      fail("wakeflow-claude-activity-process-identity", "activity process identity became unverifiable while stopping", {
        health,
      });
    }
    await sleep(25);
  }
  fail("wakeflow-claude-activity-stop", "activity process did not stop within the bounded wait");
}

/** 只signal预先验证的exact process identity，并以process source CAS完成停止。 */
export async function stopClaudeActivityMonitor(value = {}) {
  exactObject(value, ["workspaceRoot", "serverContext"], [], "activity stop input");
  return withRecordedActivityMutation(value, "claude-activity-stop", async (context) => {
    const inventory = scanContext(context.workspaceRoot, context);
    if (!inventory.process) {
      return deepFreeze({
        kind: "WakeflowClaudeActivityStopResult",
        schemaVersion: SCHEMA_VERSION,
        programId: context.programId,
        hostId: HOST_ID,
        serverContextId: context.serverContextId,
        status: "already-stopped",
      });
    }
    const health = processHealth(inventory.process);
    if (new Set(["identity-mismatch", "unverifiable"]).has(health)) {
      fail("wakeflow-claude-activity-process-identity", "activity process cannot be signaled safely", { health });
    }
    if (health === "running") {
      try {
        process.kill(inventory.process.record.processIdentity.pid, "SIGTERM");
      } catch (cause) {
        if (cause?.code !== "ESRCH") {
          fail("wakeflow-claude-activity-stop", "exact activity process could not be signaled", {}, cause);
        }
      }
      await waitForExactProcessExit(inventory.process);
    }
    exactUnlinkSource(
      inventory.process,
      () => readProcess(context.workspaceRoot, context.serverContextId),
      "stopped Claude activity process",
    );
    return deepFreeze({
      kind: "WakeflowClaudeActivityStopResult",
      schemaVersion: SCHEMA_VERSION,
      programId: context.programId,
      hostId: HOST_ID,
      serverContextId: context.serverContextId,
      status: health === "dead" ? "stale-record-removed" : "stopped",
    });
  }, { removeEmpty: true });
}

const PANE_FORMAT = [
  "#{session_name}",
  "#{window_id}",
  "#{pane_id}",
  "#{pane_dead}",
  "#{pane_current_command}",
  "#{@wakeflow_program_id}",
  "#{@wakeflow_host_id}",
  "#{@wakeflow_window_id}",
  "#{@wakeflow_binding_id}",
  "#{@wakeflow_locator_id}",
].join("\t");

function paneCurrentCommandIsClaude(value) {
  const command = value.trim();
  return command === "claude" || path.posix.basename(command) === "claude";
}

function listActivityPanes(context) {
  const result = executeTmux(context.socketName, ["list-panes", "-a", "-F", PANE_FORMAT]);
  if (!result.ok) {
    fail("wakeflow-claude-activity-host-observation", "tmux pane inventory is unavailable", {}, result.cause);
  }
  const lines = result.stdout.split("\n").filter((line) => line.length > 0);
  if (lines.length > MAX_PANES) {
    fail("wakeflow-claude-activity-host-observation", "tmux pane inventory exceeded its closed bound");
  }
  return lines.map((line) => {
    const fields = line.split("\t");
    if (fields.length !== 10) {
      fail("wakeflow-claude-activity-host-observation", "tmux pane inventory returned an invalid closed row");
    }
    const [
      sessionName,
      tmuxWindowId,
      paneId,
      paneDead,
      paneCurrentCommand,
      programId,
      hostId,
      windowId,
      bindingId,
      locatorId,
    ] = fields;
    if (!new Set(["0", "1"]).has(paneDead)) {
      fail("wakeflow-claude-activity-host-observation", "tmux pane inventory returned invalid liveness");
    }
    return Object.freeze({
      sessionName,
      tmuxWindowId,
      paneId,
      paneDead: paneDead === "1",
      paneCurrentCommand,
      programId,
      hostId,
      windowId,
      bindingId,
      locatorId,
    });
  });
}

function showWindowOption(context, tmuxWindowId, option) {
  const result = executeTmux(context.socketName, [
    "show-options",
    "-w",
    "-q",
    "-v",
    "-t",
    tmuxWindowId,
    option,
  ]);
  if (result.ok) return result.stdout.trim();
  if (result.cause || result.status !== 1) {
    fail(
      "wakeflow-claude-activity-host-observation",
      "tmux activity glyph observation failed",
      {},
      result.cause,
    );
  }
  const target = executeTmux(context.socketName, [
    "display-message",
    "-p",
    "-t",
    tmuxWindowId,
    "#{window_id}",
  ]);
  if (target.ok && target.stdout.trim() === tmuxWindowId) return "";
  fail(
    "wakeflow-claude-activity-host-observation",
    "tmux activity glyph cannot distinguish an absent option from an unavailable window",
    {},
    result.cause,
  );
}

function setWindowOption(context, tmuxWindowId, option, value) {
  const result = executeTmux(context.socketName, [
    "set-option",
    "-w",
    "-t",
    tmuxWindowId,
    option,
    value,
  ]);
  if (!result.ok) {
    fail("wakeflow-claude-activity-host-effect", "tmux activity glyph could not be set", {}, result.cause);
  }
}

function unsetWindowOption(context, tmuxWindowId, option) {
  const result = executeTmux(context.socketName, [
    "set-option",
    "-w",
    "-u",
    "-t",
    tmuxWindowId,
    option,
  ]);
  if (!result.ok) {
    fail("wakeflow-claude-activity-host-effect", "tmux activity glyph could not be unset", {}, result.cause);
  }
}

function capturePane(context, paneId) {
  const result = executeTmux(context.socketName, ["capture-pane", "-p", "-t", paneId]);
  if (!result.ok) return null;
  return result.stdout;
}

function paneShowsExecution(value) {
  return /esc to interrupt/iu.test(value);
}

function overlayActivityState(context, pane, running) {
  const current = showWindowOption(context, pane.tmuxWindowId, "@wakeflow_state");
  if (running && current !== "running") {
    if (current) setWindowOption(context, pane.tmuxWindowId, "@wakeflow_prev_state", current);
    else setWindowOption(context, pane.tmuxWindowId, "@wakeflow_prev_state", ABSENT_GLYPH_SENTINEL);
    setWindowOption(context, pane.tmuxWindowId, "@wakeflow_state", "running");
    return;
  }
  if (!running && current === "running") {
    const previous = showWindowOption(context, pane.tmuxWindowId, "@wakeflow_prev_state");
    if (!previous) return;
    if (previous === ABSENT_GLYPH_SENTINEL) unsetWindowOption(context, pane.tmuxWindowId, "@wakeflow_state");
    else setWindowOption(context, pane.tmuxWindowId, "@wakeflow_state", previous);
    unsetWindowOption(context, pane.tmuxWindowId, "@wakeflow_prev_state");
  }
}

function normalizeCycleInput(value) {
  exactObject(value, [
    "workspaceRoot",
    "socketName",
    "sessionName",
    "serverContext",
    "monitorId",
  ], [], "activity cycle input");
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const authority = normalAuthority(workspaceRoot);
  const context = normalizeContextTuple(value.serverContext, authority.programId);
  return Object.freeze({
    workspaceRoot,
    programId: authority.programId,
    configDigest: authority.configDigest,
    socketName: nullableSocketName(value.socketName),
    sessionName: boundedString(value.sessionName, "sessionName", 128),
    ...context,
    monitorId: matchToken(value.monitorId, MONITOR_ID_RE, "monitorId"),
  });
}

function paneMetadataMatchesLocator(pane, locator) {
  return pane.programId === locator.programId
    && pane.hostId === locator.hostId
    && pane.windowId === locator.windowId
    && pane.bindingId === locator.bindingId
    && pane.locatorId === locator.locatorId;
}

function paneRelatesToLocator(pane, locator) {
  return paneMetadataMatchesLocator(pane, locator)
    || pane.tmuxWindowId === locator.tmux.windowId
    || pane.paneId === locator.tmux.paneId;
}

function locatorObservationFromPane(input, pane) {
  return {
    provider: "tmux",
    socketName: input.socketName,
    sessionName: pane.sessionName,
    windowId: pane.tmuxWindowId,
    paneId: pane.paneId,
    paneWindowId: pane.tmuxWindowId,
    paneDead: pane.paneDead,
    claudeProcess: paneCurrentCommandIsClaude(pane.paneCurrentCommand),
    metadata: {
      programId: pane.programId,
      hostId: pane.hostId,
      windowId: pane.windowId,
      bindingId: pane.bindingId,
      locatorId: pane.locatorId,
    },
  };
}

function inspectActivityTopology(input) {
  const panes = listActivityPanes(input).filter((pane) => pane.sessionName === input.sessionName);
  const locatorRecords = new Map();
  const locatorInventory = inspectClaudeWindowLocatorInventory({
    workspaceRoot: input.workspaceRoot,
    expectedSocketName: input.socketName,
    observe: (locator) => {
      locatorRecords.set(locator.windowId, locator);
      return panes
        .filter((pane) => paneRelatesToLocator(pane, locator))
        .map((pane) => locatorObservationFromPane(input, pane));
    },
  });
  return Object.freeze({ panes, locatorRecords, locatorInventory });
}

/** 执行一次只读pane观察与临时glyph投影；不把pane变化解释成transport或业务完成。 */
export function runClaudeActivityMonitorCycle(value = {}) {
  const input = normalizeCycleInput(value);
  const observed = observeServerContext(input.socketName, input.sessionName, input.programId);
  if (
    observed.serverContextId !== input.serverContextId
    || observed.serverContextDigest !== input.serverContextDigest
  ) {
    fail("wakeflow-claude-activity-context", "tmux context changed before the monitor cycle");
  }
  const processSource = readProcess(input.workspaceRoot, input.serverContextId);
  if (
    !processSource
    || processSource.record.monitorId !== input.monitorId
    || processSource.record.serverContextDigest !== input.serverContextDigest
    || processHealth(processSource) !== "running"
  ) {
    fail("wakeflow-claude-activity-stale", "monitor cycle no longer owns the exact process generation");
  }

  let topology;
  try {
    topology = inspectActivityTopology(input);
  } catch (cause) {
    return deepFreeze({
      kind: "WakeflowClaudeActivityCycleResult",
      schemaVersion: SCHEMA_VERSION,
      programId: input.programId,
      hostId: HOST_ID,
      serverContextId: input.serverContextId,
      status: "attention-required",
      windows: [],
      issues: [`locator-inventory:${typeof cause?.code === "string" ? cause.code : "unavailable"}`],
    });
  }
  const { panes, locatorRecords, locatorInventory } = topology;
  const windows = [];
  const issues = [...locatorInventory.issues];
  const observedMemoryKeys = new Set();
  for (const window of locatorInventory.windows) {
    if (!window.locator || window.locator.status !== "live") {
      windows.push({ windowId: window.windowId, status: "unavailable" });
      continue;
    }
    const locator = locatorRecords.get(window.windowId);
    const matches = locator
      ? panes.filter((pane) => (
          pane.tmuxWindowId === locator.tmux.windowId
          && pane.paneId === locator.tmux.paneId
          && paneMetadataMatchesLocator(pane, locator)
        ))
      : [];
    if (matches.length !== 1) {
      const status = matches.length === 0 ? "missing-live-pane" : "duplicate-live-pane";
      issues.push(`${window.windowId}:${status}`);
      windows.push({ windowId: window.windowId, status });
      continue;
    }
    const pane = matches[0];
    if (pane.paneDead || !paneCurrentCommandIsClaude(pane.paneCurrentCommand)) {
      issues.push(`${window.windowId}:pane-not-live-claude`);
      windows.push({ windowId: window.windowId, status: "pane-not-live-claude" });
      continue;
    }
    const text = capturePane(input, pane.paneId);
    if (text === null) {
      issues.push(`${window.windowId}:pane-unreadable`);
      windows.push({ windowId: window.windowId, status: "pane-unreadable" });
      continue;
    }
    const key = `${input.serverContextId}\0${window.windowId}`;
    observedMemoryKeys.add(key);
    const paneDigest = canonicalJsonDigest({ paneText: text });
    const previous = ACTIVITY_MEMORY.get(key);
    ACTIVITY_MEMORY.set(key, paneDigest);
    const running = paneShowsExecution(text) || (previous !== undefined && previous !== paneDigest);
    overlayActivityState(input, pane, running);
    windows.push({ windowId: window.windowId, status: running ? "running" : "idle" });
  }
  const contextPrefix = `${input.serverContextId}\0`;
  for (const key of ACTIVITY_MEMORY.keys()) {
    if (key.startsWith(contextPrefix) && !observedMemoryKeys.has(key)) ACTIVITY_MEMORY.delete(key);
  }
  const uniqueIssues = [...new Set(issues)].sort();
  return deepFreeze({
    kind: "WakeflowClaudeActivityCycleResult",
    schemaVersion: SCHEMA_VERSION,
    programId: input.programId,
    hostId: HOST_ID,
    serverContextId: input.serverContextId,
    status: uniqueIssues.length === 0 ? "current" : "attention-required",
    windows: windows.sort((left, right) => lexicalCompare(left.windowId, right.windowId)),
    issues: uniqueIssues,
  });
}

// monitor停止时只恢复仍带Wakeflow previous marker的exact live locator，不碰无marker的宿主状态。
function restoreClaudeActivityGlyphs(input) {
  const { panes, locatorRecords, locatorInventory } = inspectActivityTopology(input);
  for (const window of locatorInventory.windows) {
    if (window.locator?.status !== "live") continue;
    const locator = locatorRecords.get(window.windowId);
    const pane = locator
      ? panes.find((entry) => (
          entry.tmuxWindowId === locator.tmux.windowId
          && entry.paneId === locator.tmux.paneId
          && paneMetadataMatchesLocator(entry, locator)
        ))
      : null;
    if (pane) overlayActivityState(input, pane, false);
  }
}

async function withRecordedActivityMutation(value, operationKind, callback, { removeEmpty = false } = {}) {
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const authority = normalAuthority(workspaceRoot);
  const context = Object.freeze({
    workspaceRoot,
    configDigest: authority.configDigest,
    ...normalizeContextTuple(value.serverContext, authority.programId),
  });
  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind,
      domainOwner: "activity-monitor-manager",
    }, async (mutationContext) => {
      let lock = null;
      let response;
      try {
        const currentAuthority = normalAuthority(workspaceRoot);
        if (
          currentAuthority.programId !== context.programId
          || currentAuthority.configDigest !== context.configDigest
        ) {
          fail("wakeflow-claude-activity-stale", "config changed before recorded activity mutation");
        }
        const directory = contextDirectory(workspaceRoot, context.serverContextId);
        if (directory) lock = acquireManagerLock(context, mutationContext);
        response = Object.freeze({ outcome: "success", value: await callback(context) });
      } catch (error) {
        response = Object.freeze({ outcome: "rejected", error });
      }
      if (lock) {
        try {
          releaseManagerLock(context, lock);
        } catch (error) {
          response = Object.freeze({ outcome: "rejected", error });
        }
      }
      if (removeEmpty) {
        const directory = relativeFile(workspaceRoot, activityContextRef(context.serverContextId));
        try {
          removeEmptyPrivateDirectory(directory, "Claude activity server context root");
        } catch (error) {
          response = Object.freeze({ outcome: "rejected", error });
        }
      }
      return response;
    });
  } catch (cause) {
    boundary("recorded Claude activity mutation", cause, "wakeflow-claude-activity-mutation");
  }
  if (result?.outcome === "rejected") throw result.error;
  if (result?.outcome !== "success") {
    fail("wakeflow-claude-activity-operation", "recorded activity mutation returned an invalid result");
  }
  return result.value;
}

async function cleanupWorkerGeneration(worker) {
  try {
    await withRecordedActivityMutation({
      workspaceRoot: worker.workspaceRoot,
      serverContext: {
        serverContextId: worker.serverContextId,
        serverContextDigest: worker.serverContextDigest,
      },
    }, "claude-activity-worker-exit", (context) => {
      const source = readProcess(context.workspaceRoot, context.serverContextId);
      if (!source || source.record.monitorId !== worker.monitorId) return false;
      const self = inspectWakeflowProcessSnapshot(process.pid);
      if (
        !self
        || source.record.processIdentity.pid !== process.pid
        || source.record.processIdentity.startIdentity !== self.identity.startIdentity
        || source.record.executableDigest !== self.executableDigest
        || source.record.argvDigest !== self.argvDigest
      ) {
        fail("wakeflow-claude-activity-process-identity", "worker cannot prove exact ownership of its process record");
      }
      exactUnlinkSource(
        source,
        () => readProcess(context.workspaceRoot, context.serverContextId),
        "exited Claude activity process",
      );
      return true;
    }, { removeEmpty: true });
  } catch {
    // A failed CAS or busy T02 gate intentionally preserves the exact process record for recovery.
  }
}

function workerOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length || args.indexOf(name, index + 1) >= 0) {
    fail("wakeflow-claude-activity-worker", `worker option ${name} is missing or duplicated`);
  }
  return args[index + 1];
}

function parseWorkerArguments(args) {
  const allowed = new Set([
    "--workspace-root-base64",
    "--socket-name-base64",
    "--session-name-base64",
    "--server-context-id",
    "--server-context-digest",
    "--monitor-id",
    "--poll-ms",
  ]);
  if (args.length !== allowed.size * 2) {
    fail("wakeflow-claude-activity-worker", "worker arguments have an invalid cardinality");
  }
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index])) fail("wakeflow-claude-activity-worker", "worker received an unknown option");
  }
  const socketRaw = decodeWorkerValue(workerOption(args, "--socket-name-base64"), "socketName");
  const serverContext = normalizeServerContextIdentity(
    workerOption(args, "--server-context-id"),
    workerOption(args, "--server-context-digest"),
    "worker context",
  );
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(decodeWorkerValue(
      workerOption(args, "--workspace-root-base64"),
      "workspaceRoot",
    )),
    socketName: socketRaw === "" ? null : nullableSocketName(socketRaw),
    sessionName: boundedString(
      decodeWorkerValue(workerOption(args, "--session-name-base64"), "sessionName"),
      "sessionName",
      128,
    ),
    ...serverContext,
    monitorId: matchToken(workerOption(args, "--monitor-id"), MONITOR_ID_RE, "monitorId"),
    pollMs: normalizePollMs(Number(workerOption(args, "--poll-ms"))),
  });
}

function awaitWorkerCommit() {
  return new Promise((resolve, reject) => {
    let bytes = "";
    const timeout = setTimeout(() => reject(new Error("activity worker commit handshake timed out")), 10_000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      bytes += chunk;
      if (bytes.length > 32) reject(new Error("activity worker commit handshake is oversized"));
    });
    process.stdin.on("end", () => {
      clearTimeout(timeout);
      if (bytes === "commit\n") resolve();
      else reject(new Error("activity worker commit handshake is invalid"));
    });
    process.stdin.on("error", (cause) => {
      clearTimeout(timeout);
      reject(cause);
    });
    process.stdin.resume();
  });
}

// detached worker反向验证自己的process generation，再轮询当前locator与pane事实。
async function runWorker(args) {
  const worker = parseWorkerArguments(args);
  let stopRequested = false;
  let wakeInterval = null;
  const requestStop = () => {
    stopRequested = true;
    if (wakeInterval) wakeInterval();
  };
  const waitInterval = (milliseconds) => new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeInterval = null;
      resolve();
    }, milliseconds);
    wakeInterval = () => {
      clearTimeout(timer);
      wakeInterval = null;
      resolve();
    };
    if (stopRequested) wakeInterval();
  });
  process.once("SIGTERM", requestStop);
  process.once("SIGINT", requestStop);
  try {
    process.stdout.write("ready\n");
    await awaitWorkerCommit();
    const authority = normalAuthority(worker.workspaceRoot);
    const observed = observeServerContext(worker.socketName, worker.sessionName, authority.programId);
    if (
      observed.serverContextId !== worker.serverContextId
      || observed.serverContextDigest !== worker.serverContextDigest
    ) {
      fail("wakeflow-claude-activity-context", "worker tmux context differs from its committed process record");
    }
    const processSource = readProcess(worker.workspaceRoot, worker.serverContextId);
    if (
      !processSource
      || processSource.record.monitorId !== worker.monitorId
      || processHealth(processSource) !== "running"
    ) {
      fail("wakeflow-claude-activity-process-identity", "worker cannot adopt its exact committed process generation");
    }
    process.stdout.write("committed\n");
    for (;;) {
      if (stopRequested) break;
      const alive = executeTmux(worker.socketName, ["has-session", "-t", worker.sessionName]);
      if (!alive.ok) break;
      runClaudeActivityMonitorCycle({
        workspaceRoot: worker.workspaceRoot,
        socketName: worker.socketName,
        sessionName: worker.sessionName,
        serverContext: {
          serverContextId: worker.serverContextId,
          serverContextDigest: worker.serverContextDigest,
        },
        monitorId: worker.monitorId,
      });
      await waitInterval(worker.pollMs);
    }
    if (stopRequested) {
      try {
        restoreClaudeActivityGlyphs({
          workspaceRoot: worker.workspaceRoot,
          socketName: worker.socketName,
          sessionName: worker.sessionName,
          serverContextId: worker.serverContextId,
          serverContextDigest: worker.serverContextDigest,
          monitorId: worker.monitorId,
        });
      } catch {
        // UI恢复失败不伪造宿主证明；后续monitor可依据保留的previous marker再次恢复。
      }
    }
  } finally {
    if (!stopRequested) await cleanupWorkerGeneration(worker);
  }
}

function promptBytes(value) {
  if (typeof value !== "string") {
    fail("wakeflow-claude-activity-prompt", "prompt must be one string");
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length === 0 || bytes.length > MAX_PROMPT_BYTES) {
    fail("wakeflow-claude-activity-prompt", "prompt is empty or exceeds the closed byte bound");
  }
  return bytes;
}

function promptMetadata(file, ref, { allowMissing = true } = {}) {
  let stat;
  try {
    stat = fs.lstatSync(file, { bigint: true });
  } catch (cause) {
    if (allowMissing && cause?.code === "ENOENT") return null;
    fail("wakeflow-claude-activity-prompt-storage", "prompt fallback cannot be inspected", {}, cause);
  }
  const euid = currentEuid();
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
    || modeOf(stat) !== 0o600
    || stat.nlink !== 1n
    || stat.size > BigInt(MAX_PROMPT_BYTES)
    || (euid !== null && stat.uid !== euid)
  ) {
    return Object.freeze({ ref, file, valid: false, stat: statIdentity(stat) });
  }
  return Object.freeze({ ref, file, valid: true, stat: statIdentity(stat) });
}

function createPromptFallback(workspaceRoot, operationId, bytes) {
  const directory = assertPrivateDirectoryChain(workspaceRoot, PROMPT_ROOT_REF);
  const name = `${matchToken(operationId, WORKSPACE_OPERATION_ID_RE, "operationId")}.txt`;
  const file = path.join(directory, name);
  const ref = `${PROMPT_ROOT_REF}/${name}`;
  let descriptor;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (!stat.isFile() || modeOf(stat) !== 0o600 || stat.nlink !== 1n || stat.size !== BigInt(bytes.length)) {
      fail("wakeflow-claude-activity-prompt-storage", "prompt fallback changed while writing");
    }
  } catch (cause) {
    if (cause instanceof WakeflowClaudeActivityError) throw cause;
    fail("wakeflow-claude-activity-prompt-storage", "prompt fallback cannot be created exclusively", {}, cause);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  syncDirectory(directory);
  const source = promptMetadata(file, ref, { allowMissing: false });
  if (!source?.valid || source.stat.size !== String(bytes.length)) {
    fail("wakeflow-claude-activity-recovery-required", "prompt fallback commit cannot be proved");
  }
  return Object.freeze({ ...source, sha256: sourceDigest(bytes) });
}

function exactUnlinkPrompt(source, label) {
  const current = promptMetadata(source.file, source.ref, { allowMissing: false });
  if (!current.valid) {
    fail("wakeflow-claude-activity-recovery-required", `${label} source identity changed before cleanup`);
  }
  exactUnlinkPrivateSource(source, current, label);
}

/** 默认传内存值；仅在requiresPath为真时于T02锁内创建并精确清理短命文件。 */
export async function withClaudePromptTransfer(value = {}, callback) {
  exactObject(value, ["workspaceRoot", "prompt", "requiresPath"], [], "prompt transfer input");
  if (typeof value.requiresPath !== "boolean") {
    fail("wakeflow-claude-activity-prompt", "requiresPath must be a boolean");
  }
  if (typeof callback !== "function") {
    fail("wakeflow-claude-activity-prompt", "prompt transfer callback must be a function");
  }
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const bytes = promptBytes(value.prompt);
  normalAuthority(workspaceRoot);
  if (!value.requiresPath) {
    try {
      return await callback(deepFreeze({ kind: "memory", prompt: value.prompt }));
    } catch (cause) {
      fail(
        "wakeflow-claude-activity-prompt-callback",
        "memory prompt transfer callback failed",
        {},
        cause,
      );
    }
  }
  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "claude-secure-prompt",
      domainOwner: "secure-temp-operation-owner",
    }, async (mutationContext) => {
      let source = null;
      try {
        normalAuthority(workspaceRoot);
        source = createPromptFallback(workspaceRoot, mutationContext.operationId, bytes);
      } catch (error) {
        return Object.freeze({ outcome: "rejected", phase: "prepare", error });
      }
      let response;
      try {
        response = Object.freeze({
          outcome: "success",
          value: await callback(deepFreeze({
            kind: "file",
            operationId: mutationContext.operationId,
            path: source.file,
          })),
        });
      } catch (error) {
        response = Object.freeze({ outcome: "rejected", phase: "callback", error });
      }
      try {
        exactUnlinkPrompt(source, "Claude prompt fallback");
      } catch (error) {
        response = Object.freeze({ outcome: "rejected", phase: "cleanup", error });
      }
      return response;
    });
  } catch (cause) {
    boundary("Claude prompt transfer mutation", cause, "wakeflow-claude-activity-prompt-mutation");
  }
  if (result?.outcome === "rejected") {
    if (new Set(["prepare", "cleanup"]).has(result.phase) && result.error instanceof Error) {
      throw result.error;
    }
    if (result.error instanceof Error) {
      fail("wakeflow-claude-activity-prompt-callback", "prompt transfer callback failed after exact cleanup", {}, result.error);
    }
    fail("wakeflow-claude-activity-prompt-callback", "prompt transfer failed without one structured error");
  }
  if (result?.outcome !== "success") {
    fail("wakeflow-claude-activity-prompt-callback", "prompt transfer returned an invalid result");
  }
  return result.value;
}

function normalizeObservedAt(value) {
  return value === undefined ? new Date().toISOString() : timestamp(value, "observedAt");
}

function normalizeExpiryMs(value) {
  if (value === undefined) return DEFAULT_PROMPT_EXPIRY_MS;
  if (!Number.isSafeInteger(value) || value < MIN_PROMPT_EXPIRY_MS || value > 30 * 24 * 60 * 60 * 1000) {
    fail("wakeflow-claude-activity-prompt", "expiryMs is outside the closed safe range");
  }
  return value;
}

function scanPromptTemp(workspaceRoot, { observedAt, expiryMs }) {
  const directory = relativeFile(workspaceRoot, PROMPT_ROOT_REF);
  try {
    fs.lstatSync(directory);
  } catch (cause) {
    if (cause?.code === "ENOENT") return Object.freeze({ entries: [], mutation: null });
    fail("wakeflow-claude-activity-prompt-storage", "prompt fallback root cannot be inspected", {}, cause);
  }
  assertPrivateDirectoryChain(workspaceRoot, PROMPT_ROOT_REF);
  const names = boundedDirectoryNames(directory, MAX_PROMPT_FILES, "Claude prompt fallback root");
  let mutation;
  try {
    mutation = inspectWakeflowWorkspaceMutation({ workspaceRoot });
  } catch (cause) {
    mutation = Object.freeze({ state: "unverifiable", lock: null, causeCode: cause?.code ?? "unknown" });
  }
  const now = Date.parse(observedAt);
  const entries = names.map((name) => {
    const match = name.match(PROMPT_FILE_RE);
    const ref = `${PROMPT_ROOT_REF}/${name}`;
    const file = path.join(directory, name);
    const source = promptMetadata(file, ref, { allowMissing: false });
    let status = "invalid";
    if (match && source.valid) {
      if (
        mutation.state === "busy"
        && mutation.lock?.operationId === match[1]
        && mutation.lock?.domainOwner === "secure-temp-operation-owner"
      ) {
        status = "live";
      } else if (mutation.state === "unverifiable" || mutation.state === "recovery-required") {
        status = "unverifiable";
      } else {
        const age = now - source.stat.mtimeMs;
        status = age < 0 ? "invalid" : age >= expiryMs ? "expired" : "orphan";
      }
    }
    return Object.freeze({
      ref,
      operationId: match?.[1] ?? null,
      status,
      source,
      digest: canonicalJsonDigest({
        schemaVersion: SCHEMA_VERSION,
        status,
        valid: source.valid,
        mode: source.stat.mode,
        linkCount: source.stat.linkCount,
        size: source.stat.size,
        mtimeMs: source.stat.mtimeMs,
      }),
    });
  });
  return Object.freeze({ entries, mutation });
}

function publicPromptInventory(scan, observedAt, expiryMs) {
  const counts = Object.fromEntries(
    ["live", "orphan", "expired", "invalid", "unverifiable"].map((status) => [
      status,
      scan.entries.filter((entry) => entry.status === status).length,
    ]),
  );
  const unsigned = {
    kind: "WakeflowClaudePromptTempInspection",
    schemaVersion: SCHEMA_VERSION,
    hostId: HOST_ID,
    observedAt,
    expiryMs,
    counts,
    status: counts.invalid > 0 || counts.unverifiable > 0 ? "attention-required" : "current",
  };
  return deepFreeze({ ...unsigned, inventoryDigest: canonicalJsonDigest(unsigned) });
}

/** 返回prompt临时区的脱敏分类计数；不读取正文，也不公开basename或绝对路径。 */
export function inspectClaudePromptTemp(value = {}) {
  exactObject(value, ["workspaceRoot"], ["observedAt", "expiryMs"], "prompt temp inspection input");
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  normalAuthority(workspaceRoot);
  const observedAt = normalizeObservedAt(value.observedAt);
  const expiryMs = normalizeExpiryMs(value.expiryMs);
  return publicPromptInventory(scanPromptTemp(workspaceRoot, { observedAt, expiryMs }), observedAt, expiryMs);
}

/** 使用本机当前时钟清理严格expired orphan；调用方不能注入未来时间扩大删除集合。 */
export async function sweepClaudePromptTemp(value = {}) {
  exactObject(value, ["workspaceRoot"], ["expiryMs"], "prompt temp sweep input");
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const expiryMs = normalizeExpiryMs(value.expiryMs);
  normalAuthority(workspaceRoot);
  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "claude-prompt-sweep",
      domainOwner: "secure-temp-operation-owner",
    }, () => {
      let scan;
      try {
        normalAuthority(workspaceRoot);
        const observedAt = new Date().toISOString();
        scan = scanPromptTemp(workspaceRoot, { observedAt, expiryMs });
        const unsafe = scan.entries.filter((entry) => new Set(["invalid", "unverifiable", "live"]).has(entry.status));
        if (unsafe.length > 0) {
          fail("wakeflow-claude-activity-prompt-sweep", "prompt fallback inventory contains unsafe entries", {
            count: unsafe.length,
          });
        }
      } catch (error) {
        return Object.freeze({ outcome: "rejected", error });
      }
      const expired = scan.entries.filter((entry) => entry.status === "expired");
      for (const entry of expired) exactUnlinkPrompt(entry.source, "expired Claude prompt fallback");
      return Object.freeze({
        outcome: "success",
        value: deepFreeze({
          kind: "WakeflowClaudePromptTempSweepResult",
          schemaVersion: SCHEMA_VERSION,
          hostId: HOST_ID,
          removed: expired.length,
          preserved: scan.entries.length - expired.length,
        }),
      });
    });
  } catch (cause) {
    boundary("Claude prompt temp sweep", cause, "wakeflow-claude-activity-prompt-sweep");
  }
  if (result?.outcome === "rejected") {
    if (result.error instanceof Error) throw result.error;
    fail("wakeflow-claude-activity-prompt-sweep", "prompt sweep was rejected without one structured error");
  }
  if (result?.outcome !== "success") {
    fail("wakeflow-claude-activity-prompt-sweep", "prompt sweep returned an invalid result");
  }
  return result.value;
}

function diagnosticFileEntry(workspaceRoot, ref, kind, inspect) {
  try {
    const source = inspect();
    return source
      ? Object.freeze({ ref, kind, status: "current", digest: source.sha256, source })
      : null;
  } catch (cause) {
    const file = relativeFile(workspaceRoot, ref);
    let digestValue = canonicalJsonDigest({ ref, status: "invalid" });
    try {
      const stat = fs.lstatSync(file, { bigint: true });
      digestValue = canonicalJsonDigest({
        status: "invalid",
        type: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "other",
        mode: modeOf(stat),
        size: String(stat.size),
      });
    } catch {
      // Keep the redacted deterministic fallback digest.
    }
    return Object.freeze({
      ref,
      kind,
      status: "invalid",
      digest: digestValue,
      errorCode: cause?.code ?? "wakeflow-claude-activity-storage",
      source: null,
    });
  }
}

/** 为shared layout inspector返回exact ref→owner状态映射；动态ref只在进程内用于闭合候选节点。 */
export function inspectClaudeActivityForLayout(value = {}) {
  exactObject(value, [
    "workspaceRoot",
    "programId",
    "hostId",
    "configDigest",
    "windowIds",
  ], [], "activity layout inspection input");
  if (value.hostId !== HOST_ID) {
    fail("wakeflow-claude-activity-host", "activity layout inspection belongs only to claude-code");
  }
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const authority = normalAuthority(workspaceRoot);
  if (
    authority.programId !== typedId(value.programId, "program", "programId")
    || authority.configDigest !== digest(value.configDigest, "configDigest")
  ) {
    fail("wakeflow-claude-activity-stale", "activity layout config authority is stale");
  }
  exactDataArray(value.windowIds, "windowIds", MAX_WINDOW_IDS);
  const windowIds = value.windowIds.map((entry, index) => typedId(entry, "window", `windowIds[${index}]`));
  if (new Set(windowIds).size !== windowIds.length) {
    fail("wakeflow-claude-activity-contract", "windowIds cannot contain duplicates");
  }
  const entries = [];
  const activityRoot = relativeFile(workspaceRoot, ACTIVITY_ROOT_REF);
  let activityRootPresent = false;
  try {
    fs.lstatSync(activityRoot);
    activityRootPresent = true;
  } catch (cause) {
    if (cause?.code !== "ENOENT") {
      fail("wakeflow-claude-activity-storage", "Claude activity root cannot be inspected", {}, cause);
    }
  }
  if (activityRootPresent) {
    assertPrivateDirectoryChain(workspaceRoot, ACTIVITY_ROOT_REF);
    for (const name of boundedDirectoryNames(
      activityRoot,
      MAX_ACTIVITY_CONTEXTS,
      "Claude activity root",
    )) {
      const contextRef = `${ACTIVITY_ROOT_REF}/${name}`;
      const contextFile = path.join(activityRoot, name);
      let contextStatus = "current";
      try {
        assertPrivateDirectory(contextFile, "Claude activity context root");
      } catch {
        contextStatus = "invalid";
      }
      if (!SERVER_CONTEXT_ID_RE.test(name)) contextStatus = "invalid";
      if (contextStatus !== "invalid") {
        const childNames = boundedDirectoryNames(
          contextFile,
          MAX_CONTEXT_ENTRIES,
          "Claude activity context root",
        );
        for (const childName of childNames) {
          if (new Set(["process.json", "manager.lock"]).has(childName)) continue;
          const ref = `${contextRef}/${childName}`;
          entries.push(Object.freeze({
            ref,
            kind: "activity-unknown",
            status: "invalid",
            digest: canonicalJsonDigest({ schemaVersion: SCHEMA_VERSION, ref, status: "invalid" }),
          }));
          contextStatus = "invalid";
        }
      }
      const processEntry = SERVER_CONTEXT_ID_RE.test(name)
        ? diagnosticFileEntry(
            workspaceRoot,
            `${contextRef}/process.json`,
            "activity-process",
            () => readProcess(workspaceRoot, name),
          )
        : null;
      const lockEntry = SERVER_CONTEXT_ID_RE.test(name)
        ? diagnosticFileEntry(
            workspaceRoot,
            `${contextRef}/manager.lock`,
            "activity-manager-lock",
            () => readManagerLock(workspaceRoot, name),
          )
        : null;
      if (processEntry) {
        const sourceMatchesContext = Boolean(
          processEntry.source
          && processEntry.source.record.programId === authority.programId
          && processEntry.source.record.serverContextId === name
          && name === `claude-server-context_${processEntry.source.record.serverContextDigest.slice("sha256:".length)}`
        );
        const health = sourceMatchesContext ? processHealth(processEntry.source) : "invalid";
        entries.push(Object.freeze({
          ...processEntry,
          status: health === "running" ? "current" : health === "dead" ? "stale" : "invalid",
        }));
        if (health !== "running") contextStatus = health === "dead" && contextStatus === "current" ? "stale" : "invalid";
      }
      if (lockEntry) {
        const sourceMatchesContext = Boolean(
          lockEntry.source
          && lockEntry.source.record.programId === authority.programId
          && lockEntry.source.record.serverContextId === name
          && name === `claude-server-context_${lockEntry.source.record.serverContextDigest.slice("sha256:".length)}`
        );
        const health = sourceMatchesContext ? managerLockHealth(lockEntry.source) : "invalid";
        entries.push(Object.freeze({
          ...lockEntry,
          status: health === "active" ? "active" : health === "stale" ? "stale" : "invalid",
        }));
        if (!new Set(["active", "stale"]).has(health)) contextStatus = "invalid";
      }
      if (!processEntry && !lockEntry && contextStatus === "current") contextStatus = "stale";
      entries.push(Object.freeze({
        ref: contextRef,
        kind: "activity-context-root",
        status: contextStatus,
        digest: canonicalJsonDigest({ schemaVersion: SCHEMA_VERSION, status: contextStatus }),
      }));
    }
  }
  const observedAt = new Date().toISOString();
  const promptScan = scanPromptTemp(workspaceRoot, {
    observedAt,
    expiryMs: DEFAULT_PROMPT_EXPIRY_MS,
  });
  for (const entry of promptScan.entries) {
    entries.push(Object.freeze({
      ref: entry.ref,
      kind: "prompt-fallback",
      status: entry.status,
      digest: entry.digest,
    }));
  }
  entries.sort((left, right) => lexicalCompare(left.ref, right.ref));
  const issues = entries
    .filter((entry) => !new Set(["current", "active", "live"]).has(entry.status))
    .map((entry) => `${entry.kind}:${entry.status}`)
    .sort();
  return deepFreeze({
    kind: "WakeflowClaudeActivityLayoutInspection",
    schemaVersion: SCHEMA_VERSION,
    programId: authority.programId,
    hostId: HOST_ID,
    configDigest: authority.configDigest,
    status: issues.length === 0 ? "current" : "attention-required",
    entries: entries.map(({ source, errorCode, ...entry }) => entry),
    issues,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(MODULE_FILE) && process.argv[2] === WORKER_MARKER) {
  try {
    await runWorker(process.argv.slice(3));
  } catch {
    process.exitCode = 1;
  }
}
