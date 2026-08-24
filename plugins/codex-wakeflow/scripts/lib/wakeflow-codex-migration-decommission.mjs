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
 * Codex T07适配器把历史thread-registry/window-config重新观察为shared HostDecommissionPlan，
 * 并把宿主返回的archive观察翻译为HostDecommissionOutcome；它本身不执行archive。
 *
 * 阅读导航：
 * 1. 输入合同：公开参数和observation必须是封闭own-data，数组不能携带getter/隐藏属性。
 * 2. 物理观察：workspace、祖先、目录和文件均no-follow、有界、current-owner、纳秒稳定复验。
 * 3. Source关联：只接纳T05 coverage中与path/digest/mode/size/classifier身份唯一对应的source。
 * 4. Subject归约：按语义window闭合registration/config、binding和handle唯一性。
 * 5. I3边界：Codex archive观察无论成功与否都只生成manual-host-gate，绝不构造机器撤销证明。
 * 6. Recovery：只重新观察并报告仍需人工确认的subject，不重发archive动作。
 *
 * legacy classifier是第一层source身份门；本文件只解释已经关联到Codex coverage的宿主语义。
 * shared T07负责portable codec，T08 host-effect participant才拥有实际effect/journal边界。
 */
export const WAKEFLOW_CODEX_MIGRATION_DECOMMISSION_HOST_ID = "codex";
export const WAKEFLOW_CODEX_MIGRATION_DECOMMISSION_SCHEMA_VERSION = 1;

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_SCAN_ENTRIES = 100_000;
const MAX_TOTAL_SOURCE_BYTES = 1024 * 1024 * 1024;
const CURRENT_UID = typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const REGISTRATION_KIND = "CodexWindowThreadRegistration";
const WINDOW_CONFIG_KIND = "CodexSubwindowDispatchConfig";
const OBSERVATION_STATUSES = new Set(["archived", "failed", "not-attempted", "unavailable"]);
const PRIVATE_PATH_RE = /(?:^|[\s"'`(])(?:\/(?:Users|home|private|var\/folders)\/[^\s"'`)]*|[A-Za-z]:\\Users\\[^\s"'`)]*)/u;
const SOURCE_DIRECTORIES = Object.freeze([
  [".wakeflow-local", "wakeflow-delivery", "hosts", "codex", "thread-registry"],
  [".wakeflow-local", "wakeflow-delivery", "hosts", "codex", "window-config"],
  [".workspace-local", "wakeflow-delivery", "hosts", "codex", "thread-registry"],
  [".workspace-local", "wakeflow-delivery", "hosts", "codex", "window-config"],
  [".wakeflow-local", "wakeflow-delivery", "thread-registry"],
  [".wakeflow-local", "wakeflow-delivery", "window-config"],
  [".workspace-local", "wakeflow-delivery", "thread-registry"],
  [".workspace-local", "wakeflow-delivery", "window-config"],
]);

// ==================== 一、封闭输入与物理读取原语 ====================

/** 承载Codex适配器稳定错误码与脱敏详情。 */
export class WakeflowCodexMigrationDecommissionError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowCodexMigrationDecommissionError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

// 统一失败出口；不把source路径、thread handle或原始记录拼入公开消息。
function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowCodexMigrationDecommissionError(code, message, { details, cause });
}

// 冻结适配器返回的纯数据，避免调用方在签发后改写观察结论。
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
  if (!plainObject(value)) fail("wakeflow-codex-migration-decommission-contract", `${label} must be one plain object`);
  const actual = Reflect.ownKeys(value).map(String).sort(compareText);
  const expected = [...fields].sort(compareText);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("wakeflow-codex-migration-decommission-contract", `${label} fields differ from the closed contract`, { actual, expected });
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-codex-migration-decommission-contract", `${label}.${field} must be an enumerable data field`);
    }
  }
  return value;
}

// 返回数组entry的被动快照，同时拒绝稀疏和任何额外/行为型属性。
function denseArray(value, label) {
  if (!Array.isArray(value) || value.length > 100_000) {
    fail("wakeflow-codex-migration-decommission-contract", `${label} must be one bounded array`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string"
      || !/^(?:0|[1-9][0-9]*)$/u.test(key)
      || Number(key) >= value.length
    ) fail("wakeflow-codex-migration-decommission-contract", `${label} cannot carry additional or behavioral properties`);
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail("wakeflow-codex-migration-decommission-contract", `${label} cannot be sparse`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-codex-migration-decommission-contract", `${label} entries must be enumerable data fields`);
    }
    result.push(descriptor.value);
  }
  return result;
}

// 物理source identity统一使用带算法前缀的SHA-256。
function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

// workspace必须是调用方已经解析出的real absolute directory，且解析期间身份稳定。
function normalizeWorkspaceRoot(value) {
  if (typeof value !== "string" || !value || !path.isAbsolute(value) || path.resolve(value) !== value || value.includes("\0")) {
    fail("wakeflow-codex-migration-decommission-workspace", "workspaceRoot must be one normalized absolute path");
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
    fail("wakeflow-codex-migration-decommission-workspace", "workspaceRoot is unavailable", {}, cause);
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
    fail("wakeflow-codex-migration-decommission-workspace", "workspaceRoot must be one real directory");
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
      fail("wakeflow-codex-migration-decommission-source", "cannot inspect a legacy source ancestor", {}, error);
    }
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || (CURRENT_UID !== null && stat.uid !== CURRENT_UID)
    ) {
      fail("wakeflow-codex-migration-decommission-source", "legacy source ancestor is not one real directory");
    }
    finalStat = stat;
  }
  return { directory: current, snapshot: finalStat };
}

// 文件读取完成后再次走完整祖先链，确认目录仍是原节点。
function assertDirectoryUnchanged(workspaceRoot, segments, expected) {
  const current = assertNoFollowAncestors(workspaceRoot, segments);
  if (current === null || !sameSnapshot(current.snapshot, expected)) {
    fail("wakeflow-codex-migration-decommission-stale", "legacy source directory changed during inspection");
  }
}

// 以descriptor/path双重身份和全局entry预算枚举一个目录，避免readdir整体无界分配。
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
      fail("wakeflow-codex-migration-decommission-stale", "legacy source directory changed while it was opened");
    }
    directory = opendirSync(observed.directory, { encoding: "utf8" });
    while (true) {
      const entry = directory.readSync();
      if (entry === null) break;
      names.push(entry.name);
      if (scanState.entryCount + names.length > MAX_SCAN_ENTRIES) {
        fail("wakeflow-codex-migration-decommission-source", "legacy source directory inventory exceeds the bounded entry limit");
      }
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(observed.directory, { bigint: true });
    if (
      afterPath.isSymbolicLink()
      || !afterPath.isDirectory()
      || !sameSnapshot(opened, afterDescriptor)
      || !sameSnapshot(afterDescriptor, afterPath)
    ) fail("wakeflow-codex-migration-decommission-stale", "legacy source directory changed during enumeration");
  } catch (cause) {
    if (cause instanceof WakeflowCodexMigrationDecommissionError) throw cause;
    fail("wakeflow-codex-migration-decommission-source", "cannot enumerate a legacy host source directory", {}, cause);
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

// 以expected-size+1读取单个JSON source，拒绝增长/替换、非UTF-8和不安全物理形状。
function readStableJson(file, relativePath, scanState) {
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
    ) fail("wakeflow-codex-migration-decommission-source", "legacy host source has an unsafe physical shape");
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameSnapshot(before, opened)) {
      fail("wakeflow-codex-migration-decommission-stale", "legacy host source changed while it was opened");
    }
    const expectedSize = Number(opened.size);
    if (scanState.totalBytes + expectedSize > MAX_TOTAL_SOURCE_BYTES) {
      fail("wakeflow-codex-migration-decommission-source", "legacy host source bytes exceed the bounded inspection limit");
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
      fail("wakeflow-codex-migration-decommission-stale", "legacy host source changed during inspection");
    }
    bytes = buffer.subarray(0, offset);
    scanState.totalBytes += expectedSize;
  } catch (cause) {
    if (cause instanceof WakeflowCodexMigrationDecommissionError) throw cause;
    fail("wakeflow-codex-migration-decommission-source", "cannot read one legacy host source", {}, cause);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  let value;
  try {
    value = JSON.parse(STRICT_UTF8_DECODER.decode(bytes));
  } catch (cause) {
    fail("wakeflow-codex-migration-decommission-source", "legacy host source is not valid JSON", {}, cause);
  }
  if (!plainObject(value)) fail("wakeflow-codex-migration-decommission-source", "legacy host source must contain one JSON object");
  return {
    digest: sha256(bytes),
    mode: `0${(before.mode & 0o777n).toString(8).padStart(3, "0")}`,
    relativePath,
    size: bytes.length,
    value,
  };
}

// 枚举全部历史Codex身份目录；目录中的未知entry直接fail closed。
function listCandidates(workspaceRoot) {
  const candidates = [];
  const scanState = { entryCount: 0, totalBytes: 0 };
  for (const segments of SOURCE_DIRECTORIES) {
    const observed = listDirectoryNames(workspaceRoot, segments, scanState);
    if (observed === null) continue;
    for (const name of observed.names) {
      if (!/^[A-Za-z0-9._-]{1,200}\.json$/u.test(name)) {
        fail("wakeflow-codex-migration-decommission-source", "legacy host source directory contains an unknown entry");
      }
      const relativePath = [...segments, name].join("/");
      candidates.push({
        role: segments.at(-1) === "thread-registry" ? "registration" : "window-config",
        ...readStableJson(path.join(observed.directory, name), relativePath, scanState),
      });
    }
    assertDirectoryUnchanged(workspaceRoot, segments, observed.snapshot);
  }
  return candidates;
}

// ==================== 二、T05 source关联与Codex subject语义 ====================

// 隐私路径只通过portable descriptor ref与root IDs重算，不反推出真实绝对路径。
function expectedPathDigest(relativePath, rootIds) {
  return sha256(Buffer.from(canonicalJson({ descriptorRef: relativePath, rootIds }), "utf8"));
}

// 候选必须与T05 source的kind/physical identity/location形成唯一对应。
function correlateCandidate(candidate, coverageSources) {
  const expectedKind = candidate.role === "registration" ? REGISTRATION_KIND : WINDOW_CONFIG_KIND;
  const matches = coverageSources.filter((source) => (
    source.sourceKind === expectedKind
    && source.source.type === "file"
    && source.source.digest === candidate.digest
    && source.source.mode === candidate.mode
    && source.source.size === candidate.size
    && source.classification?.confidence !== "unknown"
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

// 提取后续archive所需的最小registration语义，不把真实threadId写入portable plan。
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

// 提取window-config的binding/registered语义，用于与registration交叉闭合。
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

// 以语义key分组；重复记录是否冲突由领域字段投影决定，而非按文件名猜测winner。
function semanticUnique(values, keyFor) {
  const byKey = new Map();
  for (const value of values) {
    const key = keyFor(value);
    const group = byKey.get(key) ?? [];
    group.push(value);
    byKey.set(key, group);
  }
  return byKey;
}

// 归约每个window的exact source集合、archive/none effect和所有冲突blocker。
function deriveSubjects(correlated, coverageSourceIds) {
  const blockerCodes = [];
  const normalized = [];
  for (const candidate of correlated) {
    const value = candidate.role === "registration"
      ? normalizeRegistration(candidate)
      : normalizeWindowConfig(candidate);
    if (value === null) {
      blockerCodes.push("migration-codex-legacy-source-invalid");
      continue;
    }
    normalized.push({ ...value, role: candidate.role });
  }
  const byWindow = semanticUnique(normalized, (entry) => entry.windowName);
  const handleWindows = new Map();
  for (const entry of normalized.filter((item) => item.role === "registration")) {
    const windows = handleWindows.get(entry.handle) ?? new Set();
    windows.add(entry.windowName);
    handleWindows.set(entry.handle, windows);
  }
  const subjects = [];
  for (const [windowName, entries] of [...byWindow].sort(([left], [right]) => compareText(left, right))) {
    const registrations = entries.filter((entry) => entry.role === "registration");
    const configs = entries.filter((entry) => entry.role === "window-config");
    const subjectBlockers = [];
    const registrationKeys = new Set(registrations.map((entry) => canonicalJson({ bindingId: entry.bindingId, handle: entry.handle })));
    const configKeys = new Set(configs.map((entry) => canonicalJson({ bindingId: entry.bindingId, registered: entry.registered })));
    if (registrationKeys.size > 1) subjectBlockers.push("migration-codex-registration-conflict");
    if (configKeys.size > 1) subjectBlockers.push("migration-codex-window-config-conflict");
    const registration = registrations[0] ?? null;
    const config = configs[0] ?? null;
    if (registration !== null && config === null) subjectBlockers.push("migration-codex-window-config-missing");
    if (registration === null && config?.registered === true) subjectBlockers.push("migration-codex-registration-missing");
    if (
      registration !== null
      && config !== null
      && (config.registered !== true || config.bindingId !== registration.bindingId)
    ) subjectBlockers.push("migration-codex-registration-config-mismatch");
    if (registration !== null && (handleWindows.get(registration.handle)?.size ?? 0) > 1) {
      subjectBlockers.push("migration-codex-handle-reused-across-windows");
    }
    subjects.push({
      blockerCodes: [...new Set(subjectBlockers)].sort(compareText),
      effect: registration === null ? "none" : "archive",
      proofPolicy: registration === null ? "source-freeze-only" : "manual-host-gate",
      sourceIds: [...new Set(entries.map((entry) => entry.sourceId))].sort(compareText),
    });
    void windowName;
  }
  const assigned = new Set(subjects.flatMap((subject) => subject.sourceIds));
  if (coverageSourceIds.some((sourceId) => !assigned.has(sourceId))) {
    blockerCodes.push("migration-codex-legacy-source-unrecognized");
  }
  return {
    blockerCodes: [...new Set(blockerCodes)].sort(compareText),
    subjects,
  };
}

// ==================== 三、双重观察与HostDecommissionPlan ====================

// 单次完整重扫同时绑定T04 inventory、T05 coverage和当前Codex历史source。
function inspectPlanOnce({ workspaceRoot, migrationPlan }) {
  const plan = validateWakeflowMigrationPlan(migrationPlan);
  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot });
  if (inventory.inventoryDigest !== plan.payload.inventory.inventoryDigest) {
    fail("wakeflow-codex-migration-decommission-stale", "workspace inventory differs from the exact migration plan");
  }
  const coverage = plan.payload.decommissionCoverage.find((entry) => entry.hostId === WAKEFLOW_CODEX_MIGRATION_DECOMMISSION_HOST_ID);
  if (!coverage) fail("wakeflow-codex-migration-decommission-coverage", "migration plan has no exact Codex decommission coverage");
  const sourceById = new Map(plan.payload.sources.map((source) => [source.sourceId, source]));
  const coverageSources = coverage.sourceIds.map((sourceId) => sourceById.get(sourceId)).filter(Boolean);
  if (coverageSources.length !== coverage.sourceIds.length) {
    fail("wakeflow-codex-migration-decommission-coverage", "Codex coverage references a missing plan source");
  }
  const correlated = listCandidates(workspaceRoot)
    .map((candidate) => correlateCandidate(candidate, coverageSources))
    .filter((candidate) => candidate !== null);
  const derived = deriveSubjects(correlated, coverage.sourceIds);
  return createMigrationHostDecommissionPlan({
    blockerCodes: derived.blockerCodes,
    hostId: WAKEFLOW_CODEX_MIGRATION_DECOMMISSION_HOST_ID,
    migrationPlan: plan,
    subjects: derived.subjects,
  });
}

/** 两次完整重算必须逐字一致，才返回一个只读Codex HostDecommissionPlan。 */
export function inspectCodexMigrationDecommissionPlan(value = {}) {
  exactObject(value, ["migrationPlan", "workspaceRoot"], "Codex migration decommission input");
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const first = inspectPlanOnce({ workspaceRoot, migrationPlan: value.migrationPlan });
  const second = inspectPlanOnce({ workspaceRoot, migrationPlan: value.migrationPlan });
  if (canonicalJson(first) !== canonicalJson(second)) {
    fail("wakeflow-codex-migration-decommission-stale", "legacy Codex source set changed during inspection");
  }
  return second;
}

// ==================== 四、archive观察、manual gate与recovery ====================

// 把一条宿主archive观察映射为shared subject outcome；成功也只证明“观察到已归档”。
function observationOutcome(subject, observation, plan) {
  const evidenceDigest = canonicalJsonDigest({
    hostId: WAKEFLOW_CODEX_MIGRATION_DECOMMISSION_HOST_ID,
    planDigest: plan.planDigest,
    status: observation?.status ?? "not-attempted",
    subjectId: subject.subjectId,
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
  const status = observation.status;
  return {
    effectStatus: status === "archived" ? "succeeded" : status,
    evidenceDigest,
    postCloseAttempts: 0,
    proof: status === "archived" ? "archive-observed" : "none",
    reasonCode: status === "archived"
      ? "codex-archive-observed-instance-confirmation-required"
      : status === "not-attempted"
        ? "codex-instance-confirmation-required"
        : status === "unavailable"
          ? "codex-archive-unavailable"
          : "codex-archive-failed",
    status: "manual-host-gate",
    subjectId: subject.subjectId,
  };
}

/**
 * 在验证全量observation并重新扫描当前source后生成outcome。
 * 该函数不接受acknowledged字段，也不能把Codex结果升级成machine-verified。
 */
export function recordCodexMigrationDecommissionOutcome(value = {}) {
  exactObject(value, ["migrationPlan", "observations", "plan", "workspaceRoot"], "Codex migration outcome input");
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const plan = validateMigrationHostDecommissionPlan(value.plan);
  assertMigrationHostDecommissionPlanAgainstMigrationPlan({ migrationPlan: value.migrationPlan, plan });
  const observations = denseArray(value.observations, "Codex observations").map((entry, index) => {
    exactObject(entry, ["status", "subjectId"], `Codex observation ${index}`);
    if (!OBSERVATION_STATUSES.has(entry.status)) {
      fail("wakeflow-codex-migration-decommission-observation", "Codex observation status is unsupported");
    }
    return entry;
  });
  const bySubject = new Map();
  for (const observation of observations) {
    if (bySubject.has(observation.subjectId)) {
      fail("wakeflow-codex-migration-decommission-observation", "Codex observation subject is duplicated");
    }
    bySubject.set(observation.subjectId, observation);
  }
  const archiveSubjects = plan.subjects.filter((subject) => subject.effect === "archive" && subject.state === "ready");
  const archiveSubjectIds = new Set(archiveSubjects.map((subject) => subject.subjectId));
  if (
    observations.length !== archiveSubjects.length
    || observations.some((entry) => !archiveSubjectIds.has(entry.subjectId))
  ) fail("wakeflow-codex-migration-decommission-observation", "Codex observations must cover each ready archive subject exactly once");
  const current = inspectCodexMigrationDecommissionPlan({ workspaceRoot, migrationPlan: value.migrationPlan });
  if (canonicalJson(current) !== canonicalJson(plan)) {
    fail("wakeflow-codex-migration-decommission-stale", "Codex legacy source set changed after decommission planning");
  }
  const outcome = createMigrationHostDecommissionOutcome({
    plan,
    subjectOutcomes: plan.subjects.map((subject) => observationOutcome(subject, bySubject.get(subject.subjectId), plan)),
  });
  if (PRIVATE_PATH_RE.test(canonicalJson(outcome))) {
    fail("wakeflow-codex-migration-decommission-privacy", "Codex migration outcome leaked a private path or handle");
  }
  return outcome;
}

/** Recovery只复核exact frozen plan并返回人工门状态，不执行或重试archive。 */
export function inspectCodexMigrationDecommissionRecovery(value = {}) {
  exactObject(value, ["migrationPlan", "plan", "workspaceRoot"], "Codex migration recovery input");
  const plan = validateMigrationHostDecommissionPlan(value.plan);
  const current = inspectCodexMigrationDecommissionPlan({
    migrationPlan: value.migrationPlan,
    workspaceRoot: normalizeWorkspaceRoot(value.workspaceRoot),
  });
  if (canonicalJson(plan) !== canonicalJson(current)) {
    fail("wakeflow-codex-migration-decommission-stale", "Codex recovery source set differs from the frozen plan");
  }
  return deepFreeze({
    artifactKind: "WakeflowCodexMigrationDecommissionRecovery",
    hostId: WAKEFLOW_CODEX_MIGRATION_DECOMMISSION_HOST_ID,
    planDigest: plan.planDigest,
    schemaVersion: WAKEFLOW_CODEX_MIGRATION_DECOMMISSION_SCHEMA_VERSION,
    status: "manual-host-gate",
    subjectIds: plan.subjects.filter((subject) => subject.effect === "archive").map((subject) => subject.subjectId),
  });
}

// Bootstrap只获得一个静态inspect seam；真实宿主effect不会通过shared adapter被隐式调用。
export const wakeflowMigrationDecommissionHostAdapter = Object.freeze({
  hostId: WAKEFLOW_CODEX_MIGRATION_DECOMMISSION_HOST_ID,
  inspect: inspectCodexMigrationDecommissionPlan,
});
