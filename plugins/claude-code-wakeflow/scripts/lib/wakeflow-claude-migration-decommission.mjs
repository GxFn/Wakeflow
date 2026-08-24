import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  inspectWakeflowMigrationInventory,
} from "./wakeflow-migration-inventory.mjs";
import {
  validateWakeflowMigrationPlan,
} from "./wakeflow-migration-plan.mjs";
import {
  assertMigrationHostDecommissionPlanAgainstMigrationPlan,
  createMigrationHostDecommissionOutcome,
  createMigrationHostDecommissionPlan,
  validateMigrationHostDecommissionPlan,
} from "./wakeflow-migration-host-decommission.mjs";

/**
 * Claude T07适配器把历史registry/config/window-host与helper residue重新观察为shared
 * HostDecommissionPlan，并把close/readback观察翻译为HostDecommissionOutcome；它不调用tmux。
 *
 * 阅读导航：
 * 1. 输入合同：公开参数和observation必须是封闭own-data，数组不能携带getter/隐藏属性。
 * 2. 物理观察：workspace、祖先、目录、JSON及runtime residue均no-follow、有界并稳定复验。
 * 3. Source关联：只解释T05 coverage中与classifier及物理身份唯一对应的历史source。
 * 4. Subject归约：registration/config/window-host必须组成同一binding/handle/window闭包，
 *    thread handle与tmux target都不能跨语义window复用。
 * 5. Runtime residue：helper pid/lock/text只形成后续owner-effect blocker，不被当成可关闭window。
 * 6. I3边界：只有pre-close live、effect completed、close succeeded且至少一次post-close absent
 *    才可machine-verified；缺失、歧义或recovery无法确认close都保持blocked。
 * 7. 隐私：tmux session/windowId/threadId只参与内存归约，从不进入portable plan/outcome。
 *
 * legacy classifier是第一层source身份门；shared T07负责portable codec，T08 Claude effect
 * participant才拥有真实close、journal和post-close probe的执行证据。
 */
export const WAKEFLOW_CLAUDE_MIGRATION_DECOMMISSION_HOST_ID = "claude-code";
export const WAKEFLOW_CLAUDE_MIGRATION_DECOMMISSION_SCHEMA_VERSION = 1;

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_SCAN_ENTRIES = 100_000;
const MAX_TOTAL_SOURCE_BYTES = 1024 * 1024 * 1024;
const CURRENT_UID = typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const REGISTRATION_KIND = "ClaudeWindowSessionRegistration";
const WINDOW_CONFIG_KIND = "ClaudeSubwindowDispatchConfig";
const WINDOW_HOST_KIND = "ClaudeWindowHostBinding";
const PRE_CLOSE_STATUSES = new Set(["ambiguous", "live", "missing", "unavailable"]);
const CLOSE_STATUSES = new Set(["failed", "not-attempted", "succeeded", "unavailable"]);
const POST_CLOSE_STATUSES = new Set(["absent", "ambiguous", "not-attempted", "present", "unavailable"]);
const EFFECT_CHECKPOINTS = new Set(["completed", "not-started", "started"]);
const PRIVATE_PATH_RE = /(?:^|[\s"'`(])(?:\/(?:Users|home|private|var\/folders)\/[^\s"'`)]*|[A-Za-z]:\\Users\\[^\s"'`)]*)/u;
const SOURCE_DIRECTORIES = Object.freeze([
  [".wakeflow-local", "wakeflow-delivery", "hosts", "claude-code", "thread-registry"],
  [".wakeflow-local", "wakeflow-delivery", "hosts", "claude-code", "window-config"],
  [".wakeflow-local", "wakeflow-delivery", "hosts", "claude-code", "window-host"],
  [".workspace-local", "wakeflow-delivery", "hosts", "claude-code", "thread-registry"],
  [".workspace-local", "wakeflow-delivery", "hosts", "claude-code", "window-config"],
  [".workspace-local", "wakeflow-delivery", "hosts", "claude-code", "window-host"],
  [".wakeflow-local", "wakeflow-delivery", "thread-registry"],
  [".wakeflow-local", "wakeflow-delivery", "window-config"],
  [".wakeflow-local", "wakeflow-delivery", "window-host"],
  [".workspace-local", "wakeflow-delivery", "thread-registry"],
  [".workspace-local", "wakeflow-delivery", "window-config"],
  [".workspace-local", "wakeflow-delivery", "window-host"],
]);
const RUNTIME_RESIDUE_RE = /^(?:activity-monitor-[A-Za-z0-9._-]+\.pid|deliver-[A-Za-z0-9._-]+\.txt|entry-sync-[A-Za-z0-9._-]+\.txt|paste-[A-Za-z0-9._-]+\.lock|pod-entry-[A-Za-z0-9._-]+\.txt)$/u;

// ==================== 一、封闭输入与物理读取原语 ====================

/** 承载Claude适配器稳定错误码与脱敏详情。 */
export class WakeflowClaudeMigrationDecommissionError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowClaudeMigrationDecommissionError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

// 统一失败出口；不把source路径、session、tmux target或原始记录拼入公开消息。
function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowClaudeMigrationDecommissionError(code, message, { details, cause });
}

// 冻结适配器返回的纯数据，防止签发后的观察被原地改写。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 所有持久排序使用code-unit顺序，避免locale改变subject/digest。
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// 只接受普通对象或null-prototype对象。
function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 校验封闭字段并拒绝accessor、Symbol或不可枚举authority字段。
function exactObject(value, fields, label) {
  if (!plainObject(value)) fail("wakeflow-claude-migration-decommission-contract", `${label} must be one plain object`);
  const actual = Reflect.ownKeys(value).map(String).sort(compareText);
  const expected = [...fields].sort(compareText);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("wakeflow-claude-migration-decommission-contract", `${label} fields differ from the closed contract`, { actual, expected });
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-claude-migration-decommission-contract", `${label}.${field} must be an enumerable data field`);
    }
  }
  return value;
}

// 返回数组entry的被动快照，同时拒绝稀疏和任何额外/行为型属性。
function denseArray(value, label) {
  if (!Array.isArray(value) || value.length > 100_000) {
    fail("wakeflow-claude-migration-decommission-contract", `${label} must be one bounded array`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string"
      || !/^(?:0|[1-9][0-9]*)$/u.test(key)
      || Number(key) >= value.length
    ) fail("wakeflow-claude-migration-decommission-contract", `${label} cannot carry additional or behavioral properties`);
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail("wakeflow-claude-migration-decommission-contract", `${label} cannot be sparse`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-claude-migration-decommission-contract", `${label} entries must be enumerable data fields`);
    }
    result.push(descriptor.value);
  }
  return result;
}

// 物理source identity统一使用带算法前缀的SHA-256。
function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

// workspace必须是调用方已解析的real absolute directory，且解析期间身份稳定。
function normalizeWorkspaceRoot(value) {
  if (typeof value !== "string" || !value || !path.isAbsolute(value) || path.resolve(value) !== value || value.includes("\0")) {
    fail("wakeflow-claude-migration-decommission-workspace", "workspaceRoot must be one normalized absolute path");
  }
  let before;
  let real;
  let after;
  let resolved;
  try {
    before = lstatSync(value, { bigint: true });
    real = realpathSync(value);
    after = lstatSync(value, { bigint: true });
    resolved = lstatSync(real, { bigint: true });
  } catch (cause) {
    fail("wakeflow-claude-migration-decommission-workspace", "workspaceRoot is unavailable", {}, cause);
  }
  if (
    before.isSymbolicLink()
    || !before.isDirectory()
    || real !== value
    || after.isSymbolicLink()
    || !after.isDirectory()
    || !resolved.isDirectory()
    || !sameSnapshot(before, after)
    || !sameSnapshot(after, resolved)
  ) {
    fail("wakeflow-claude-migration-decommission-workspace", "workspaceRoot must be one real directory");
  }
  return value;
}

// 比较读取相关的完整bigint节点身份；atime有意排除，因为读取本身可改变它。
function sameSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.gid === right.gid
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

// 从workspace向下逐段拒绝symlink、非目录与foreign-owner祖先。
function assertNoFollowAncestors(workspaceRoot, segments) {
  let current = workspaceRoot;
  let finalStat = null;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = lstatSync(current, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      fail("wakeflow-claude-migration-decommission-source", "cannot inspect a legacy source ancestor", {}, error);
    }
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || (CURRENT_UID !== null && stat.uid !== CURRENT_UID)
    ) {
      fail("wakeflow-claude-migration-decommission-source", "legacy source ancestor is not one real directory");
    }
    finalStat = stat;
  }
  return { directory: current, snapshot: finalStat };
}

// 文件读取完成后再次走完整祖先链，确认目录仍是原节点。
function assertDirectoryUnchanged(workspaceRoot, segments, expected) {
  const current = assertNoFollowAncestors(workspaceRoot, segments);
  if (current === null || !sameSnapshot(current.snapshot, expected)) {
    fail("wakeflow-claude-migration-decommission-stale", "legacy source directory changed during inspection");
  }
}

// 以descriptor/path双重身份和全局entry预算枚举目录，包括Claude host根的residue扫描。
function listDirectoryNames(workspaceRoot, segments, scanState) {
  const observed = assertNoFollowAncestors(workspaceRoot, segments);
  if (observed === null) return null;
  let descriptor;
  let directory;
  const names = [];
  try {
    descriptor = openSync(
      observed.directory,
      fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameSnapshot(observed.snapshot, opened)) {
      fail("wakeflow-claude-migration-decommission-stale", "legacy source directory changed while it was opened");
    }
    directory = opendirSync(observed.directory, { encoding: "utf8" });
    while (true) {
      const entry = directory.readSync();
      if (entry === null) break;
      names.push(entry.name);
      if (scanState.entryCount + names.length > MAX_SCAN_ENTRIES) {
        fail("wakeflow-claude-migration-decommission-source", "legacy source directory inventory exceeds the bounded entry limit");
      }
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(observed.directory, { bigint: true });
    if (
      afterPath.isSymbolicLink()
      || !afterPath.isDirectory()
      || !sameSnapshot(opened, afterDescriptor)
      || !sameSnapshot(afterDescriptor, afterPath)
    ) fail("wakeflow-claude-migration-decommission-stale", "legacy source directory changed during enumeration");
  } catch (cause) {
    if (cause instanceof WakeflowClaudeMigrationDecommissionError) throw cause;
    fail("wakeflow-claude-migration-decommission-source", "cannot enumerate a legacy host source directory", {}, cause);
  } finally {
    if (directory !== undefined) {
      try { directory.closeSync(); } catch { /* best-effort descriptor cleanup */ }
    }
    if (descriptor !== undefined) closeSync(descriptor);
  }
  scanState.entryCount += names.length;
  assertDirectoryUnchanged(workspaceRoot, segments, observed.snapshot);
  return {
    directory: observed.directory,
    names: names.sort(compareText),
    snapshot: observed.snapshot,
  };
}

// 以expected-size+1读取JSON或opaque runtime source，拒绝增长/替换与不安全物理形状。
function readStable(file, relativePath, { json }, scanState) {
  let before;
  let bytes;
  let descriptor;
  try {
    before = lstatSync(file, { bigint: true });
    if (
      before.isSymbolicLink()
      || !before.isFile()
      || before.nlink !== 1n
      || before.size > BigInt(MAX_SOURCE_BYTES)
      || (before.mode & 0o022n) !== 0n
      || (CURRENT_UID !== null && before.uid !== CURRENT_UID)
    ) fail("wakeflow-claude-migration-decommission-source", "legacy host source has an unsafe physical shape");
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameSnapshot(before, opened)) {
      fail("wakeflow-claude-migration-decommission-stale", "legacy host source changed while it was opened");
    }
    const expectedSize = Number(opened.size);
    if (scanState.totalBytes + expectedSize > MAX_TOTAL_SOURCE_BYTES) {
      fail("wakeflow-claude-migration-decommission-source", "legacy host source bytes exceed the bounded inspection limit");
    }
    const buffer = Buffer.alloc(expectedSize + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    if (
      !sameSnapshot(opened, after)
      || afterPath.isSymbolicLink()
      || !afterPath.isFile()
      || !sameSnapshot(after, afterPath)
      || offset !== expectedSize
    ) {
      fail("wakeflow-claude-migration-decommission-stale", "legacy host source changed during inspection");
    }
    bytes = buffer.subarray(0, offset);
    scanState.totalBytes += expectedSize;
  } catch (cause) {
    if (cause instanceof WakeflowClaudeMigrationDecommissionError) throw cause;
    fail("wakeflow-claude-migration-decommission-source", "cannot read one legacy host source", {}, cause);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  let value = null;
  if (json) {
    try {
      value = JSON.parse(STRICT_UTF8_DECODER.decode(bytes));
    } catch (cause) {
      fail("wakeflow-claude-migration-decommission-source", "legacy host source is not valid JSON", {}, cause);
    }
    if (!plainObject(value)) fail("wakeflow-claude-migration-decommission-source", "legacy host source must contain one JSON object");
  }
  return {
    digest: sha256(bytes),
    mode: `0${(before.mode & 0o777n).toString(8).padStart(3, "0")}`,
    relativePath,
    size: bytes.length,
    value,
  };
}

// 将历史目录角色固定映射为registration/config/window-host，禁止根据内容猜测。
function roleForDirectory(name) {
  if (name === "thread-registry") return "registration";
  if (name === "window-host") return "window-host";
  return "window-config";
}

// 枚举三类身份文件和封闭命名的helper residue；source目录中的未知entry直接fail closed。
function listCandidates(workspaceRoot) {
  const candidates = [];
  const scanState = { entryCount: 0, totalBytes: 0 };
  for (const segments of SOURCE_DIRECTORIES) {
    const observed = listDirectoryNames(workspaceRoot, segments, scanState);
    if (observed === null) continue;
    for (const name of observed.names) {
      if (!/^[A-Za-z0-9._-]{1,200}\.json$/u.test(name)) {
        fail("wakeflow-claude-migration-decommission-source", "legacy host source directory contains an unknown entry");
      }
      const relativePath = [...segments, name].join("/");
      candidates.push({
        role: roleForDirectory(segments.at(-1)),
        ...readStable(path.join(observed.directory, name), relativePath, { json: true }, scanState),
      });
    }
    assertDirectoryUnchanged(workspaceRoot, segments, observed.snapshot);
  }
  for (const prefix of [[".wakeflow-local"], [".workspace-local"]]) {
    const segments = [...prefix, "wakeflow-delivery", "hosts", "claude-code"];
    const observed = listDirectoryNames(workspaceRoot, segments, scanState);
    if (observed === null) continue;
    for (const name of observed.names.filter((entry) => RUNTIME_RESIDUE_RE.test(entry))) {
      const relativePath = [...segments, name].join("/");
      candidates.push({
        role: "runtime",
        ...readStable(path.join(observed.directory, name), relativePath, { json: false }, scanState),
      });
    }
    assertDirectoryUnchanged(workspaceRoot, segments, observed.snapshot);
  }
  return candidates;
}

// ==================== 二、T05 source关联与Claude subject语义 ====================

// 隐私路径只通过portable descriptor ref与root IDs重算，不反推出真实绝对路径。
function expectedPathDigest(relativePath, rootIds) {
  return sha256(Buffer.from(canonicalJson({ descriptorRef: relativePath, rootIds }), "utf8"));
}

// 每个目录角色只接受对应历史record kind；runtime residue没有JSON kind。
function expectedKindForRole(role) {
  if (role === "registration") return REGISTRATION_KIND;
  if (role === "window-config") return WINDOW_CONFIG_KIND;
  if (role === "window-host") return WINDOW_HOST_KIND;
  return null;
}

// 候选必须与T05 source的kind/physical identity/location形成唯一对应。
function correlateCandidate(candidate, coverageSources) {
  const expectedKind = expectedKindForRole(candidate.role);
  const matches = coverageSources.filter((source) => (
    (expectedKind === null || source.sourceKind === expectedKind)
    && source.source.type === "file"
    && source.source.digest === candidate.digest
    && source.source.mode === candidate.mode
    && source.source.size === candidate.size
    && (candidate.role === "runtime" || source.classification?.confidence !== "unknown")
    && (source.path === candidate.relativePath || (
      source.path === null
      && source.pathDigest === expectedPathDigest(candidate.relativePath, source.rootIds)
    ))
  ));
  if (matches.length !== 1) return null;
  return { ...candidate, source: matches[0], sourceId: matches[0].sourceId };
}

// 历史宿主token必须trim稳定、NFC、无控制字符并按UTF-8字节限长。
function token(value) {
  return typeof value === "string"
    && value.length > 0
    && value === value.normalize("NFC")
    && Buffer.byteLength(value, "utf8") <= 4096
    && value === value.trim()
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

// 提取最小session-registration语义；真实threadId只在内存中用于一致性检查。
function normalizeRegistration(candidate) {
  const value = candidate.value;
  if (
    value.kind !== REGISTRATION_KIND
    || !Number.isInteger(value.version)
    || value.version < 1
    || value.version > 3
    || !token(value.windowName)
    || !token(value.bindingId)
    || !token(value.threadId)
  ) return null;
  return {
    bindingId: value.bindingId,
    handle: value.threadId,
    sourceId: candidate.sourceId,
    windowName: value.windowName,
  };
}

// 提取window-config的binding/registered语义，与registration交叉闭合。
function normalizeWindowConfig(candidate) {
  const value = candidate.value;
  if (
    value.kind !== WINDOW_CONFIG_KIND
    || !Number.isInteger(value.version)
    || value.version < 1
    || value.version > 3
    || !token(value.windowName)
    || typeof value.threadRegistered !== "boolean"
    || (value.threadBindingId !== undefined && value.threadBindingId !== null && !token(value.threadBindingId))
  ) return null;
  return {
    bindingId: value.threadBindingId ?? null,
    registered: value.threadRegistered,
    sourceId: candidate.sourceId,
    windowName: value.windowName,
  };
}

// 提取当前window-host的binding、handle及tmux target；不会把locator写入portable结果。
function normalizeWindowHost(candidate) {
  const value = candidate.value;
  if (
    value.kind !== WINDOW_HOST_KIND
    || value.version !== 2
    || !token(value.windowName)
    || !token(value.bindingId)
    || !token(value.threadId)
    || !plainObject(value.tmux)
    || !token(value.tmux.session)
    || !token(value.tmux.windowId)
  ) return null;
  return {
    bindingId: value.bindingId,
    handle: value.threadId,
    session: value.tmux.session,
    sourceId: candidate.sourceId,
    windowId: value.tmux.windowId,
    windowName: value.windowName,
  };
}

// 按语义key保留全部候选；冲突由领域字段投影决定，绝不选择“最新”文件。
function semanticGroups(values, keyFor) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

// 归约每个window的close/none effect、三元闭包、handle/tmux唯一性及runtime blocker。
function deriveSubjects(correlated, coverageSourceIds) {
  const blockerCodes = [];
  const normalized = [];
  const runtime = [];
  for (const candidate of correlated) {
    if (candidate.role === "runtime") {
      runtime.push(candidate);
      continue;
    }
    const value = candidate.role === "registration"
      ? normalizeRegistration(candidate)
      : candidate.role === "window-config"
        ? normalizeWindowConfig(candidate)
        : normalizeWindowHost(candidate);
    if (value === null) {
      blockerCodes.push("migration-claude-legacy-source-invalid");
      continue;
    }
    normalized.push({ ...value, role: candidate.role });
  }
  const byWindow = semanticGroups(normalized, (entry) => entry.windowName);
  const handleWindows = new Map();
  const tmuxWindows = new Map();
  for (const entry of normalized.filter((item) => item.role === "registration")) {
    const windows = handleWindows.get(entry.handle) ?? new Set();
    windows.add(entry.windowName);
    handleWindows.set(entry.handle, windows);
  }
  for (const entry of normalized.filter((item) => item.role === "window-host")) {
    const key = `${entry.session}\0${entry.windowId}`;
    const windows = tmuxWindows.get(key) ?? new Set();
    windows.add(entry.windowName);
    tmuxWindows.set(key, windows);
  }
  const subjects = [];
  for (const [windowName, entries] of [...byWindow].sort(([left], [right]) => compareText(left, right))) {
    const registrations = entries.filter((entry) => entry.role === "registration");
    const configs = entries.filter((entry) => entry.role === "window-config");
    const hosts = entries.filter((entry) => entry.role === "window-host");
    const subjectBlockers = [];
    const registrationKeys = new Set(registrations.map((entry) => canonicalJson({ bindingId: entry.bindingId, handle: entry.handle })));
    const configKeys = new Set(configs.map((entry) => canonicalJson({ bindingId: entry.bindingId, registered: entry.registered })));
    const hostKeys = new Set(hosts.map((entry) => canonicalJson({ bindingId: entry.bindingId, handle: entry.handle, session: entry.session, windowId: entry.windowId })));
    if (registrationKeys.size > 1) subjectBlockers.push("migration-claude-registration-conflict");
    if (configKeys.size > 1) subjectBlockers.push("migration-claude-window-config-conflict");
    if (hostKeys.size > 1) subjectBlockers.push("migration-claude-window-host-conflict");
    const registration = registrations[0] ?? null;
    const config = configs[0] ?? null;
    const host = hosts[0] ?? null;
    const hasHostAuthority = registration !== null || host !== null;
    if (hasHostAuthority && config === null) subjectBlockers.push("migration-claude-window-config-missing");
    if (hasHostAuthority && registration === null) subjectBlockers.push("migration-claude-registration-missing");
    if (registration !== null && host === null) subjectBlockers.push("migration-claude-window-host-missing");
    if (registration === null && config?.registered === true) subjectBlockers.push("migration-claude-registration-missing");
    if (
      registration !== null
      && config !== null
      && (config.registered !== true || config.bindingId !== registration.bindingId)
    ) subjectBlockers.push("migration-claude-registration-config-mismatch");
    if (
      registration !== null
      && host !== null
      && (host.bindingId !== registration.bindingId || host.handle !== registration.handle)
    ) subjectBlockers.push("migration-claude-window-host-registration-mismatch");
    if (registration !== null && (handleWindows.get(registration.handle)?.size ?? 0) > 1) {
      subjectBlockers.push("migration-claude-handle-reused-across-windows");
    }
    if (host !== null && (tmuxWindows.get(`${host.session}\0${host.windowId}`)?.size ?? 0) > 1) {
      subjectBlockers.push("migration-claude-tmux-target-reused-across-windows");
    }
    subjects.push({
      blockerCodes: [...new Set(subjectBlockers)].sort(compareText),
      effect: hasHostAuthority ? "close" : "none",
      proofPolicy: hasHostAuthority ? "exact-close-and-absence" : "source-freeze-only",
      sourceIds: [...new Set(entries.map((entry) => entry.sourceId))].sort(compareText),
    });
    void windowName;
  }
  if (runtime.length > 0) {
    subjects.push({
      blockerCodes: ["migration-claude-runtime-residue-requires-owner-effect"],
      effect: "none",
      proofPolicy: "source-freeze-only",
      sourceIds: runtime.map((entry) => entry.sourceId).sort(compareText),
    });
  }
  const assigned = new Set(subjects.flatMap((subject) => subject.sourceIds));
  if (coverageSourceIds.some((sourceId) => !assigned.has(sourceId))) {
    blockerCodes.push("migration-claude-legacy-source-unrecognized");
  }
  return {
    blockerCodes: [...new Set(blockerCodes)].sort(compareText),
    subjects,
  };
}

// ==================== 三、双重观察与HostDecommissionPlan ====================

// 单次完整重扫同时绑定T04 inventory、T05 coverage和当前Claude历史source。
function inspectPlanOnce({ workspaceRoot, migrationPlan }) {
  const plan = validateWakeflowMigrationPlan(migrationPlan);
  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot });
  if (inventory.inventoryDigest !== plan.payload.inventory.inventoryDigest) {
    fail("wakeflow-claude-migration-decommission-stale", "workspace inventory differs from the exact migration plan");
  }
  const coverage = plan.payload.decommissionCoverage.find((entry) => entry.hostId === WAKEFLOW_CLAUDE_MIGRATION_DECOMMISSION_HOST_ID);
  if (!coverage) fail("wakeflow-claude-migration-decommission-coverage", "migration plan has no exact Claude decommission coverage");
  const sourceById = new Map(plan.payload.sources.map((source) => [source.sourceId, source]));
  const coverageSources = coverage.sourceIds.map((sourceId) => sourceById.get(sourceId)).filter(Boolean);
  if (coverageSources.length !== coverage.sourceIds.length) {
    fail("wakeflow-claude-migration-decommission-coverage", "Claude coverage references a missing plan source");
  }
  const correlated = listCandidates(workspaceRoot)
    .map((candidate) => correlateCandidate(candidate, coverageSources))
    .filter((candidate) => candidate !== null);
  const derived = deriveSubjects(correlated, coverage.sourceIds);
  return createMigrationHostDecommissionPlan({
    blockerCodes: derived.blockerCodes,
    hostId: WAKEFLOW_CLAUDE_MIGRATION_DECOMMISSION_HOST_ID,
    migrationPlan: plan,
    subjects: derived.subjects,
  });
}

/** 两次完整重算必须逐字一致，才返回一个只读Claude HostDecommissionPlan。 */
export function inspectClaudeMigrationDecommissionPlan(value = {}) {
  exactObject(value, ["migrationPlan", "workspaceRoot"], "Claude migration decommission input");
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const first = inspectPlanOnce({ workspaceRoot, migrationPlan: value.migrationPlan });
  const second = inspectPlanOnce({ workspaceRoot, migrationPlan: value.migrationPlan });
  if (canonicalJson(first) !== canonicalJson(second)) {
    fail("wakeflow-claude-migration-decommission-stale", "legacy Claude source set changed during inspection");
  }
  return second;
}

// ==================== 四、close观察、I3结论与recovery ====================

// 校验宿主effect返回的封闭状态元组；subject membership稍后对exact plan复核。
function normalizeObservation(value, index) {
  exactObject(value, [
    "closeStatus",
    "effectCheckpoint",
    "postCloseAttempts",
    "postCloseStatus",
    "preCloseStatus",
    "subjectId",
  ], `Claude observation ${index}`);
  if (
    !PRE_CLOSE_STATUSES.has(value.preCloseStatus)
    || !CLOSE_STATUSES.has(value.closeStatus)
    || !POST_CLOSE_STATUSES.has(value.postCloseStatus)
    || !EFFECT_CHECKPOINTS.has(value.effectCheckpoint)
    || !Number.isInteger(value.postCloseAttempts)
    || value.postCloseAttempts < 0
    || value.postCloseAttempts > 8
  ) fail("wakeflow-claude-migration-decommission-observation", "Claude observation is outside the closed effect contract");
  return value;
}

// 将观察映射为shared outcome；机器成功条件在此保持精确合取，其他情况一律blocked。
function observationOutcome(subject, observation, plan) {
  const normalizedObservation = observation ?? {
    closeStatus: "not-attempted",
    effectCheckpoint: "not-started",
    postCloseAttempts: 0,
    postCloseStatus: "not-attempted",
    preCloseStatus: "unavailable",
    subjectId: subject.subjectId,
  };
  const evidenceDigest = canonicalJsonDigest({
    hostId: WAKEFLOW_CLAUDE_MIGRATION_DECOMMISSION_HOST_ID,
    observation: normalizedObservation,
    planDigest: plan.planDigest,
  });
  if (subject.state === "blocked") {
    return {
      effectStatus: "not-attempted",
      evidenceDigest,
      postCloseAttempts: 0,
      proof: "none",
      reasonCode: "plan-blocked",
      status: "blocked",
      subjectId: subject.subjectId,
    };
  }
  if (subject.effect === "none") {
    return {
      effectStatus: "not-attempted",
      evidenceDigest,
      postCloseAttempts: 0,
      proof: "source-freeze-only",
      reasonCode: "source-freeze-only",
      status: "not-applicable",
      subjectId: subject.subjectId,
    };
  }
  if (
    normalizedObservation.preCloseStatus === "live"
    && normalizedObservation.effectCheckpoint === "completed"
    && normalizedObservation.closeStatus === "succeeded"
    && normalizedObservation.postCloseStatus === "absent"
    && normalizedObservation.postCloseAttempts >= 1
  ) {
    return {
      effectStatus: "succeeded",
      evidenceDigest,
      postCloseAttempts: normalizedObservation.postCloseAttempts,
      proof: "exact-post-close-absence",
      reasonCode: null,
      status: "machine-verified",
      subjectId: subject.subjectId,
    };
  }
  const reasonCode = normalizedObservation.preCloseStatus === "missing"
    ? "claude-preclose-missing"
    : normalizedObservation.preCloseStatus !== "live"
      ? "claude-preclose-ambiguous"
      : normalizedObservation.closeStatus !== "succeeded"
        ? "claude-close-failed"
        : normalizedObservation.postCloseStatus === "present"
          ? "claude-postclose-present"
          : "claude-postclose-ambiguous";
  return {
    effectStatus: normalizedObservation.closeStatus,
    evidenceDigest,
    postCloseAttempts: normalizedObservation.postCloseAttempts,
    proof: "none",
    reasonCode,
    status: "blocked",
    subjectId: subject.subjectId,
  };
}

// 普通与recovery入口共用同一被动翻译流程，但都必须重新扫描当前source与exact plan。
function recordOutcome(value, label) {
  exactObject(value, ["migrationPlan", "observations", "plan", "workspaceRoot"], label);
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const plan = validateMigrationHostDecommissionPlan(value.plan);
  assertMigrationHostDecommissionPlanAgainstMigrationPlan({ migrationPlan: value.migrationPlan, plan });
  const observations = denseArray(value.observations, "Claude observations").map(normalizeObservation);
  const bySubject = new Map();
  for (const observation of observations) {
    if (bySubject.has(observation.subjectId)) {
      fail("wakeflow-claude-migration-decommission-observation", "Claude observation subject is duplicated");
    }
    bySubject.set(observation.subjectId, observation);
  }
  const closeSubjects = plan.subjects.filter((subject) => subject.effect === "close" && subject.state === "ready");
  const closeSubjectIds = new Set(closeSubjects.map((subject) => subject.subjectId));
  if (
    observations.length !== closeSubjects.length
    || observations.some((entry) => !closeSubjectIds.has(entry.subjectId))
  ) fail("wakeflow-claude-migration-decommission-observation", "Claude observations must cover each ready close subject exactly once");
  const current = inspectClaudeMigrationDecommissionPlan({ workspaceRoot, migrationPlan: value.migrationPlan });
  if (canonicalJson(current) !== canonicalJson(plan)) {
    fail("wakeflow-claude-migration-decommission-stale", "Claude legacy source set changed after decommission planning");
  }
  const outcome = createMigrationHostDecommissionOutcome({
    plan,
    subjectOutcomes: plan.subjects.map((subject) => observationOutcome(subject, bySubject.get(subject.subjectId), plan)),
  });
  if (PRIVATE_PATH_RE.test(canonicalJson(outcome))) {
    fail("wakeflow-claude-migration-decommission-privacy", "Claude migration outcome leaked a private path or handle");
  }
  return outcome;
}

/** 记录正常close/readback观察；真实tmux effect不在此函数内执行。 */
export function recordClaudeMigrationDecommissionOutcome(value = {}) {
  return recordOutcome(value, "Claude migration outcome input");
}

/** 记录恢复阶段已有的完整观察；仅“absence”而没有close成功仍不会成为机器证明。 */
export function recordClaudeMigrationDecommissionRecoveryOutcome(value = {}) {
  return recordOutcome(value, "Claude migration recovery input");
}

// Bootstrap只获得一个静态inspect seam；真实Claude effect不会通过shared adapter隐式调用。
export const wakeflowMigrationDecommissionHostAdapter = Object.freeze({
  hostId: WAKEFLOW_CLAUDE_MIGRATION_DECOMMISSION_HOST_ID,
  inspect: inspectClaudeMigrationDecommissionPlan,
});
