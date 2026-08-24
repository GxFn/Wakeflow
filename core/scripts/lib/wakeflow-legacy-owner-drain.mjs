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

import {
  canonicalJson,
  canonicalJsonDigest,
  canonicalJsonDigestHex,
} from "./wakeflow-canonical-json.mjs";
import {
  validateWakeflowArtifactTreeManifest,
} from "./wakeflow-artifact-tree-identity.mjs";
import {
  inspectWakeflowMigrationInventory,
} from "./wakeflow-migration-inventory.mjs";
import {
  validateWakeflowLegacyEvidenceFact,
} from "./wakeflow-legacy-archive-records.mjs";

/**
 * T06 legacy owner drain 是显式迁移前的只读业务静止证明器，不是旧runtime兼容层。
 * 它只识别exact legacy artifact仍拥有的历史状态，不执行旧命令、host/Git effect、
 * archive发布、source释放或v3状态转换。
 *
 * 阅读导航：
 * 1. 封闭数据合同：拒绝行为型对象、稀疏数组、非canonical字符串与伪造artifact摘要。
 * 2. 稳定物理观察：对workspace、文件和目录做no-follow、有界、前后身份一致的读取。
 * 3. Demand/archive：交叉核对active state、连续event、archive manifest、task/result闭包。
 * 4. Transport：沿group→packet→envelope→run→result→archived task逐链判断是否静止。
 * 5. Keep-live：区分历史stop记录、仍存lease/lock和真实进程存活，不输出PID或token。
 * 6. Stream/worktree：只识别overlay、worktree、lock与pending merge是否仍需旧owner处理。
 * 7. Pod：核对manifest、launch/close operation、binding/receipt、archive窗口与Test access。
 * 8. Portable输出：只保留status、count、source ID与digest；业务key、路径和host handle不外泄。
 * 9. 双重观察与公共入口：两次完整重算必须逐字一致；standalone validator只证明payload内闭合，
 *    不证明当前workspace freshness，执行阶段仍须在mutation gate内重新观察。
 */
export const WAKEFLOW_LEGACY_OWNER_DRAIN_KIND = "WakeflowLegacyOwnerDrainAssessment";
export const WAKEFLOW_LEGACY_OWNER_DRAIN_SCHEMA_VERSION = 1;
export const WAKEFLOW_LEGACY_OWNER_DRAIN_STATUSES = Object.freeze([
  "absent",
  "drain-required",
  "drained",
  "drained-with-host-followup",
  "manual-recovery",
]);
export const WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_KIND =
  "WakeflowLegacyArchiveImportInventory";
export const WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_SCHEMA_VERSION = 1;

const STATUS_SET = new Set(WAKEFLOW_LEGACY_OWNER_DRAIN_STATUSES);
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const HEX_DIGEST_RE = /^[a-f0-9]{64}$/u;
const LEGACY_TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_JSONL_LINES = 100_000;
const MAX_SCAN_ENTRIES = 100_000;
const MAX_SCAN_DEPTH = 128;
const MAX_TEXT_BYTES = 4096;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const PRIVATE_OUTPUT_RE = /(?:^|[\s"'`(])(?:\/(?:Users|home|private|var\/folders)\/[^\s"'`)]*|[A-Za-z]:\\Users\\[^\s"'`)]*)/u;
const PHYSICAL_MANUAL_CODES = new Set([
  "migration-source-depth-limit",
  "migration-source-entry-limit",
  "migration-source-file-limit",
  "migration-source-multiple-links",
  "migration-source-owner-mismatch",
  "migration-source-size-unrepresentable",
  "migration-source-special-node",
  "migration-source-symlink",
  "migration-source-symlink-ancestor",
  "migration-source-total-byte-limit",
  "migration-source-type-mismatch",
  "migration-source-unreadable",
  "migration-source-unstable",
]);
const CURRENT_ROOT_IGNORED_FILES = new Set([
  "README.md",
  "global-todo-board.md",
  "index.md",
  "test-exchange.md",
  "workspace-current-status.md",
]);
const TRANSPORT_DIRECTORIES = Object.freeze([
  "delivery-envelopes",
  "delivery-runs",
  "dispatch-groups",
  "dispatch-packets",
  "locks",
  "target-results",
]);
const LEGACY_TEST_ACCESS_BLOCK_REASONS = new Set([
  "access-probe-failed",
  "direct-multi-root-unsupported",
  "per-repo-executor-unavailable",
]);
const ARCHIVE_IMPORT_TRANSPORT_DIGEST_FIELDS = Object.freeze([
  "currentResultDigests",
  "envelopeDigests",
  "groupDigests",
  "historicalResultDigests",
  "packetDigests",
  "runDigests",
]);

const DOMAIN_DEFINITIONS = Object.freeze([
  {
    domain: "demand-state",
    owner: "legacy-state-owner",
    ownerActions: ["wakeflow-state:complete-or-cancel", "wakeflow-state:archive-demand"],
    requiredAll: ["scripts/wakeflow-state.mjs"],
  },
  {
    domain: "keep-live",
    owner: "legacy-keep-live-owner",
    ownerActions: ["wakeflow-delivery:keep-live-stop"],
    requiredAll: ["scripts/lib/wakeflow-keep-live.mjs", "scripts/wakeflow-delivery.mjs"],
  },
  {
    domain: "pod",
    owner: "legacy-pod-owner",
    ownerActions: ["wakeflow-pod:close-plan", "wakeflow-pod:record-close", "wakeflow-state:archive-demand"],
    requiredAll: ["scripts/wakeflow-pod.mjs", "scripts/wakeflow-state.mjs"],
  },
  {
    domain: "stream-worktree",
    owner: "legacy-stream-owner",
    ownerActions: ["wakeflow-claude-host:stream-close", "legacy-branch-owner:merge-or-drop"],
    requiredAll: ["scripts/lib/wakeflow-claude-host.mjs", "scripts/lib/wakeflow-stream-overlay.mjs"],
  },
  {
    domain: "transport",
    owner: "legacy-transport-owner",
    ownerActions: ["wakeflow-delivery:resolve-transport", "wakeflow-state:import-review-and-archive"],
    requiredAll: ["scripts/wakeflow-delivery.mjs", "scripts/wakeflow-state.mjs"],
  },
]);
const DOMAIN_BY_NAME = new Map(DOMAIN_DEFINITIONS.map((entry) => [entry.domain, entry]));
const DOMAIN_NAMES = DOMAIN_DEFINITIONS.map((entry) => entry.domain);

// ==================== 一、封闭数据合同与canonical原语 ====================

/** 统一承载T06错误码、JSON pointer与脱敏详情。 */
export class WakeflowLegacyOwnerDrainError extends Error {
  constructor(code, message, { errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowLegacyOwnerDrainError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

// 统一失败出口；错误消息不拼入机器私有路径或原始业务内容。
function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowLegacyOwnerDrainError(code, `${message} at ${errorPath}`, {
    errorPath,
    details,
    cause,
  });
}

// 签发前递归冻结纯数据，防止调用方改写两次观察后的结论。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 所有持久排序统一使用code-unit顺序，避免locale改变digest。
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// 将集合归约为唯一、有序的portable数组。
function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

// 只承认普通数据对象；类实例、数组与自定义原型均不属于合同输入。
function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 校验对象exact字段及enumerable data-property，读取前拒绝getter和Symbol。
function exactObject(value, fields, errorPath, code = "wakeflow-legacy-owner-drain-contract") {
  if (!plainObject(value)) fail(code, "expected a plain data object", { errorPath });
  const keys = Reflect.ownKeys(value);
  const actual = keys.map(String).sort(compareText);
  const expected = [...fields].sort(compareText);
  if (
    keys.some((key) => typeof key !== "string")
    || canonicalJson(actual) !== canonicalJson(expected)
  ) {
    fail(code, "object fields differ from the closed contract", {
      errorPath,
      details: { actual, expected },
    });
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, "fields must be enumerable data properties", { errorPath: `${errorPath}/${field}` });
    }
  }
  return value;
}

// 校验有界稠密数组，并拒绝隐藏、Symbol、accessor和附加索引。
function denseArray(value, errorPath, code = "wakeflow-legacy-owner-drain-contract") {
  if (!Array.isArray(value) || value.length > MAX_SCAN_ENTRIES) {
    fail(code, "expected one bounded array", { errorPath });
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string"
      || !/^(?:0|[1-9][0-9]*)$/u.test(key)
      || Number(key) >= value.length
    ) fail(code, "arrays cannot contain hidden, symbol, or additional properties", { errorPath });
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(code, "sparse arrays are not allowed", { errorPath: `${errorPath}/${index}` });
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, "array entries must be enumerable data properties", { errorPath: `${errorPath}/${index}` });
    }
    result.push(descriptor.value);
  }
  return result;
}

// portable文本必须非空、NFC、无控制字符且受UTF-8字节上限约束。
function text(value, errorPath, code = "wakeflow-legacy-owner-drain-contract") {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value !== value.normalize("NFC")
    || Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) fail(code, "expected one bounded control-free string", { errorPath });
  return value;
}

// 校验带算法前缀的canonical SHA-256摘要。
function digest(value, errorPath, code = "wakeflow-legacy-owner-drain-contract") {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail(code, "expected one canonical SHA-256 digest", { errorPath });
  }
  return value;
}

// 数量字段只能是非负安全整数。
function nonNegativeInteger(value, errorPath, code = "wakeflow-legacy-owner-drain-contract") {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(code, "expected one non-negative safe integer", { errorPath });
  }
  return value;
}

// 在不执行getter/toJSON的前提下取得canonical纯数据副本。
function canonicalClone(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-legacy-owner-drain-canonical", `${label} is not canonical JSON data`, { cause });
  }
}

// 对exact原始字节计算带算法前缀的摘要。
function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

// JSON与Markdown识别均使用fatal UTF-8，禁止替换字符掩盖损坏字节。
function strictUtf8(bytes) {
  try {
    return STRICT_UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

// ==================== 二、稳定、有界且no-follow的物理观察 ====================

// 固定workspace根的词法路径、真实目录与打开前后节点身份；不缓存跨调用authority。
function normalizeWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
    || value.includes("\0")
  ) fail("wakeflow-legacy-owner-drain-input", "workspaceRoot must be one normalized absolute path", { errorPath: "$/workspaceRoot" });
  let before;
  let opened;
  let resolved;
  let after;
  let real;
  let descriptor;
  try {
    before = lstatSync(value, { bigint: true });
    descriptor = openSync(
      value,
      fsConstants.O_RDONLY
        | (fsConstants.O_DIRECTORY ?? 0)
        | (fsConstants.O_NOFOLLOW ?? 0),
    );
    opened = fstatSync(descriptor, { bigint: true });
    real = realpathSync(value);
    resolved = lstatSync(real, { bigint: true });
    after = lstatSync(value, { bigint: true });
  } catch (cause) {
    fail("wakeflow-legacy-owner-drain-workspace", "cannot inspect workspaceRoot", { cause });
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // root身份已由打开前后快照决定；close失败不回显机器路径。
      }
    }
  }
  if (
    before.isSymbolicLink()
    || !before.isDirectory()
    || !opened.isDirectory()
    || resolved.isSymbolicLink()
    || !resolved.isDirectory()
    || after.isSymbolicLink()
    || !after.isDirectory()
    || !sameNodeSnapshot(before, opened)
    || !sameNodeSnapshot(opened, resolved)
    || !sameNodeSnapshot(resolved, after)
  ) {
    fail("wakeflow-legacy-owner-drain-workspace", "workspaceRoot must be one real normalized directory");
  }
  return real;
}

// 只接受完整artifact tree manifest及其exact总摘要，不按版本标题猜旧owner。
function normalizeArtifact(value) {
  exactObject(
    value,
    ["artifactDigest", "manifest"],
    "$/legacyOwnerArtifact",
    "wakeflow-legacy-owner-drain-artifact",
  );
  const artifactDigest = digest(
    value.artifactDigest,
    "$/legacyOwnerArtifact/artifactDigest",
    "wakeflow-legacy-owner-drain-artifact",
  );
  let manifest;
  try {
    manifest = validateWakeflowArtifactTreeManifest(value.manifest);
  } catch (cause) {
    fail("wakeflow-legacy-owner-drain-artifact", "legacy owner artifact manifest is invalid", {
      errorPath: "$/legacyOwnerArtifact/manifest",
      cause,
    });
  }
  if (canonicalJsonDigest(manifest) !== artifactDigest) {
    fail("wakeflow-legacy-owner-drain-artifact", "artifact digest differs from its complete manifest", {
      errorPath: "$/legacyOwnerArtifact",
    });
  }
  return { artifactDigest, manifest };
}

// 比较会影响读取真实性的纳秒级节点字段。
function sameNodeSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

// 无异常外泄地观察节点存在性与基本类型，symlink保持独立类型。
function inspectPath(file) {
  try {
    const stat = lstatSync(file, { bigint: true });
    return { exists: true, stat, type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "special" };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, stat: null, type: null };
    return { exists: true, stat: null, type: "unreadable" };
  }
}

// 通过no-follow descriptor执行expected-size+1读取，并复验descriptor与最终路径。
function readRegularFile(file) {
  const inspected = inspectPath(file);
  if (!inspected.exists) return { ok: false, code: "missing", bytes: null, digest: null };
  if (inspected.type !== "file" || !inspected.stat) {
    return { ok: false, code: inspected.type === "symlink" ? "symlink" : "type", bytes: null, digest: null };
  }
  if (
    inspected.stat.size < 0n
    || inspected.stat.size > BigInt(MAX_JSON_BYTES)
    || inspected.stat.size > BigInt(Number.MAX_SAFE_INTEGER)
  ) return { ok: false, code: "limit", bytes: null, digest: null };
  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameNodeSnapshot(inspected.stat, opened)) {
      return { ok: false, code: "unstable", bytes: null, digest: null };
    }
    const expectedSize = Number(opened.size);
    const buffer = Buffer.allocUnsafe(expectedSize + 1);
    let consumed = 0;
    while (consumed < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        consumed,
        buffer.length - consumed,
        consumed,
      );
      if (count === 0) break;
      consumed += count;
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    if (
      consumed !== expectedSize
      || afterPath.isSymbolicLink()
      || !afterPath.isFile()
      || !sameNodeSnapshot(opened, afterDescriptor)
      || !sameNodeSnapshot(afterDescriptor, afterPath)
    ) {
      return { ok: false, code: "unstable", bytes: null, digest: null };
    }
    const bytes = buffer.subarray(0, consumed);
    return { ok: true, code: null, bytes, digest: sha256(bytes) };
  } catch (error) {
    if (error?.code === "ELOOP") {
      return { ok: false, code: "symlink", bytes: null, digest: null };
    }
    return { ok: false, code: "unreadable", bytes: null, digest: null };
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // 读取结果已经由descriptor/path复验决定；close失败不回显私有路径。
      }
    }
  }
}

// 从稳定原始字节解析单个普通JSON对象，保留原始字节摘要作为证据。
function readJsonFile(file) {
  const read = readRegularFile(file);
  if (!read.ok) return { ...read, value: null };
  const decoded = strictUtf8(read.bytes);
  if (decoded === null) {
    return { ok: false, code: "utf8", bytes: null, digest: read.digest, value: null };
  }
  try {
    const value = JSON.parse(decoded);
    return plainObject(value)
      ? { ...read, value }
      : { ok: false, code: "shape", bytes: null, digest: read.digest, value: null };
  } catch {
    return { ok: false, code: "json", bytes: null, digest: read.digest, value: null };
  }
}

// 解析有界、非空、逐行普通对象的legacy JSONL事件日志。
function readJsonLines(file) {
  const read = readRegularFile(file);
  if (!read.ok) return { ...read, values: null };
  const decoded = strictUtf8(read.bytes);
  if (decoded === null) {
    return { ok: false, code: "utf8", bytes: null, digest: read.digest, values: null };
  }
  const lines = decoded.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || lines.length > MAX_JSONL_LINES || lines.some((line) => !line)) {
    return { ok: false, code: "jsonl-shape", bytes: null, digest: read.digest, values: null };
  }
  try {
    const values = lines.map(JSON.parse);
    if (values.some((value) => !plainObject(value))) throw new Error("non-object event");
    return { ...read, values };
  } catch {
    return { ok: false, code: "jsonl", bytes: null, digest: read.digest, values: null };
  }
}

// 有界枚举目录并复验目录节点；不在超限时保留OS顺序的任意子集。
function listDirectory(file) {
  const inspected = inspectPath(file);
  if (!inspected.exists) return { ok: true, exists: false, entries: [] };
  if (inspected.type !== "directory") return { ok: false, exists: true, entries: [], code: inspected.type };
  let descriptor;
  let directory;
  try {
    descriptor = openSync(
      file,
      fsConstants.O_RDONLY
        | (fsConstants.O_DIRECTORY ?? 0)
        | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isDirectory() || !sameNodeSnapshot(inspected.stat, opened)) {
      return { ok: false, exists: true, entries: [], code: "unstable" };
    }
    directory = opendirSync(file, { encoding: "utf8" });
    const names = [];
    while (true) {
      const entry = directory.readSync();
      if (entry === null) break;
      if (names.length >= MAX_SCAN_ENTRIES) {
        return { ok: false, exists: true, entries: [], code: "limit" };
      }
      names.push(entry.name);
    }
    directory.closeSync();
    directory = undefined;
    names.sort(compareText);
    const entries = names.map((name) => ({ name, ...inspectPath(path.join(file, name)) }));
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    if (
      afterPath.isSymbolicLink()
      || !afterPath.isDirectory()
      || !sameNodeSnapshot(opened, afterDescriptor)
      || !sameNodeSnapshot(afterDescriptor, afterPath)
    ) return { ok: false, exists: true, entries: [], code: "unstable" };
    return {
      ok: true,
      exists: true,
      entries,
    };
  } catch (error) {
    if (error?.code === "ELOOP") {
      return { ok: false, exists: true, entries: [], code: "symlink" };
    }
    return { ok: false, exists: true, entries: [], code: "unreadable" };
  } finally {
    try {
      directory?.closeSync();
    } catch {
      // 目录读取失败已由统一code表达。
    }
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // 同上。
      }
    }
  }
}

// legacy严格目录只容许直接JSON文件，任何其他entry使整个集合失效。
function jsonFiles(directory) {
  const listed = listDirectory(directory);
  if (!listed.ok) return { ok: false, files: [], code: listed.code };
  const files = [];
  for (const entry of listed.entries) {
    if (entry.type !== "file" || !entry.name.endsWith(".json")) {
      return { ok: false, files: [], code: entry.type === "symlink" ? "symlink" : "unexpected-entry" };
    }
    files.push(path.join(directory, entry.name));
  }
  return { ok: true, files, code: null };
}

// 在ledger树内有界查找archive manifest，并显式阻断staging/sanitize残留。
function walkForFileNames(root, wantedName) {
  const result = { files: [], blocker: null, entries: 0 };
  function visit(directory, depth) {
    if (result.blocker) return;
    if (depth > MAX_SCAN_DEPTH) {
      result.blocker = "migration-archive-depth-limit";
      return;
    }
    const listed = listDirectory(directory);
    if (!listed.ok) {
      result.blocker = `migration-archive-${listed.code}`;
      return;
    }
    for (const entry of listed.entries) {
      result.entries += 1;
      if (result.entries > MAX_SCAN_ENTRIES) {
        result.blocker = "migration-archive-entry-limit";
        return;
      }
      const child = path.join(directory, entry.name);
      if (entry.type === "directory" && (
        /\.tmp-[0-9]+-[0-9]+$/u.test(entry.name)
        || /\.sanitize-tmp-[0-9]+-[0-9]+$/u.test(entry.name)
        || entry.name.endsWith(".sanitized")
      )) {
        result.blocker = "migration-archive-staging-residue";
        return;
      }
      if (entry.type === "directory") visit(child, depth + 1);
      else if (entry.type === "file" && entry.name === wantedName) result.files.push(child);
      else if (["symlink", "special", "unreadable"].includes(entry.type)) {
        result.blocker = `migration-archive-${entry.type}`;
        return;
      }
    }
  }
  visit(root, 0);
  result.files.sort(compareText);
  return result;
}

// 有界收集archive内全部JSON结果成员；未知节点不被静默跳过。
function walkJsonFiles(root) {
  const result = { files: [], blocker: null, entries: 0 };
  if (!inspectPath(root).exists) return result;
  function visit(directory, depth) {
    if (result.blocker) return;
    if (depth > MAX_SCAN_DEPTH) {
      result.blocker = "depth-limit";
      return;
    }
    const listed = listDirectory(directory);
    if (!listed.ok) {
      result.blocker = listed.code ?? "unreadable";
      return;
    }
    for (const entry of listed.entries) {
      result.entries += 1;
      if (result.entries > MAX_SCAN_ENTRIES) {
        result.blocker = "entry-limit";
        return;
      }
      const child = path.join(directory, entry.name);
      if (entry.type === "directory") visit(child, depth + 1);
      else if (entry.type === "file" && entry.name.endsWith(".json")) result.files.push(child);
      else {
        result.blocker = entry.type === "symlink" ? "symlink" : "unexpected-entry";
        return;
      }
    }
  }
  visit(root, 0);
  result.files.sort(compareText);
  return result;
}

// ==================== 三、legacy摘要、引用与source闭包辅助 ====================

// legacy envelope的generatedAt是派生展示时间，不参与旧preparation digest。
function withoutGeneratedAt(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(withoutGeneratedAt);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "generatedAt")
      .map(([key, nested]) => [key, withoutGeneratedAt(nested)]),
  );
}

// 复刻退休writer对undefined的JSON可比语义，仅用于验证历史摘要。
function legacyComparableJsonValue(value, { arrayMember = false } = {}) {
  if (value === undefined) return arrayMember ? null : undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => legacyComparableJsonValue(entry, { arrayMember: true }));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, legacyComparableJsonValue(entry)]),
    );
  }
  return value;
}

// 投影退休packet摘要真正覆盖的字段集合。
function dispatchPacketComparable(packet = {}) {
  return {
    kind: packet.kind,
    version: packet.version,
    id: packet.id,
    targetWindow: packet.targetWindow,
    taskId: packet.taskId,
    dispatchGroup: packet.dispatchGroup,
    controllerWindow: packet.controllerWindow,
    humanContextRef: packet.humanContextRef,
    stateRef: packet.stateRef,
    objective: packet.objective,
    taskBriefing: packet.taskBriefing,
    taskPackageDigest: packet.taskPackageDigest,
    acceptanceAnchors: packet.acceptanceAnchors ?? [],
    testExecution: packet.testExecution,
    scope: packet.scope ?? [],
    outOfScope: packet.outOfScope ?? [],
    forbidden: packet.forbidden ?? [],
    evidenceRequired: packet.evidenceRequired ?? [],
    resultContract: packet.resultContract,
    returnPolicy: packet.returnPolicy,
    contextPolicy: packet.contextPolicy,
    prompt: packet.prompt,
  };
}

// 投影退休delivery preparation摘要真正覆盖的字段集合。
function deliveryEnvelopeComparable(envelope = {}) {
  return {
    kind: envelope.kind,
    version: envelope.version,
    deliveryId: envelope.deliveryId,
    sourcePacketId: envelope.sourcePacketId,
    sourcePacketDigest: envelope.sourcePacketDigest,
    targetWindow: envelope.targetWindow,
    taskId: envelope.taskId,
    dispatchGroup: envelope.dispatchGroup,
    controllerWindow: envelope.controllerWindow,
    humanContextRef: envelope.humanContextRef,
    stateRef: envelope.stateRef,
    prompt: envelope.prompt,
    returnPolicy: envelope.returnPolicy,
    returnRoute: envelope.returnRoute,
    oneShot: envelope.oneShot,
    correlationId: envelope.correlationId,
    targetThread: envelope.targetThread,
    transport: envelope.transport,
    automation: envelope.automation,
    windowConfig: withoutGeneratedAt(envelope.windowConfig),
  };
}

// 重算legacy packetDigest，拒绝只改原文后保留旧摘要。
function legacyDispatchPacketDigest(packet) {
  return canonicalJsonDigestHex(legacyComparableJsonValue(dispatchPacketComparable(packet)));
}

// 重算packet+envelope preparationDigest，闭合发送前冻结关系。
function legacyDispatchPreparationDigest(packet, envelope) {
  return canonicalJsonDigestHex(legacyComparableJsonValue({
    packet: dispatchPacketComparable(packet),
    envelope: deliveryEnvelopeComparable(envelope),
  }));
}

// stateRef必须是同一份canonical数据，不能只比较部分ID。
function exactStateRef(left, right) {
  try {
    return plainObject(left) && plainObject(right) && canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

// wakeflowTrace只验证本调用点要求的精确lineage字段。
function traceMatches(value, expected) {
  const trace = value?.wakeflowTrace;
  if (!plainObject(trace)) return false;
  return Object.entries(expected).every(([key, expectedValue]) => trace[key] === expectedValue);
}

// 从T04 inventory按domain resource kind选择真实物理source ID。
function sourceIdsFor(inventory, resourceKinds) {
  const selected = new Set(resourceKinds);
  return inventory.sources
    .filter((source) => selected.has(source.resource.kind))
    .map((source) => source.sourceId)
    .sort(compareText);
}

// 只把物理完整性blocker带入T06；migration分类/目标选择仍归T05。
function physicalSourceBlockers(inventory, sourceIds) {
  const selected = new Set(sourceIds);
  return sortedUnique(inventory.sources
    .filter((source) => selected.has(source.sourceId))
    .flatMap((source) => source.blockerCodes)
    .filter((code) => PHYSICAL_MANUAL_CODES.has(code)));
}

// 展开inventory parent/child闭包，使archive根的任一不安全后代都能阻断导入。
function sourceClosureIds(inventory, rootSourceId) {
  const sourceById = new Map(inventory.sources.map((source) => [source.sourceId, source]));
  const visited = new Set();
  const pending = [rootSourceId];
  while (pending.length > 0) {
    const sourceId = pending.pop();
    if (visited.has(sourceId)) continue;
    const source = sourceById.get(sourceId);
    if (!source) continue;
    visited.add(sourceId);
    for (const childSourceId of source.childSourceIds) pending.push(childSourceId);
  }
  return [...visited].sort(compareText);
}

// 将portable workspace-relative ref收敛为不逃逸的绝对观察路径。
function workspaceRef(workspaceRoot, value) {
  if (
    typeof value !== "string"
    || !value
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || path.posix.normalize(value) !== value
    || value.split("/").some((part) => !part || part === "..")
  ) return null;
  const resolved = path.resolve(workspaceRoot, ...value.split("/"));
  const relative = path.relative(workspaceRoot, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? resolved : null;
}

// 汇总标准及已配置active root下该demand可合法引用的legacy state root。
function legacyStateRootRefs(inventory, demandKey) {
  const refs = new Set([`.wakeflow-active/current/${demandKey}`]);
  for (const root of inventory.roots.filter((entry) => entry.rootKind === "configured-active-root")) {
    if (root.location.kind !== "workspace-relative" || root.location.path === null) continue;
    const base = root.location.path.replace(/\/$/u, "");
    refs.add(`${base}/current/${demandKey}`);
  }
  return refs;
}

// 验证event ID唯一、revision从1连续，并可选对齐当前state revision。
function legacyEventLogValid(events, { expectedRevision = null } = {}) {
  if (!Array.isArray(events) || events.length === 0) return false;
  const eventIds = new Set();
  for (const [index, event] of events.entries()) {
    if (
      !plainObject(event)
      || typeof event.eventId !== "string"
      || !event.eventId
      || eventIds.has(event.eventId)
      || event.stateRevision !== index + 1
    ) return false;
    eventIds.add(event.eventId);
  }
  return expectedRevision === null || events.at(-1).stateRevision === expectedRevision;
}

// ==================== 四、Demand active/archive业务静止识别 ====================

/**
 * 识别configured ledger中的完整legacy archive。
 * manifest/state/event/task/result必须形成同一demand闭包；这里只生成私有观察事实，
 * 不发布v3 archive、不修改历史字节，也不把归档等同于业务验收。
 */
function inspectArchiveRoot(workspaceRoot, inventory) {
  const result = {
    archives: new Map(),
    blockerCodes: new Set(),
    facts: [],
  };
  const roots = new Map();
  for (const root of inventory.roots.filter((entry) => entry.rootKind === "configured-ledger-root")) {
    if (root.blockerCodes.some((code) => [
      "migration-config-root-divergence",
      "migration-config-root-escape",
      "migration-config-root-overlap",
      "migration-source-unreadable",
    ].includes(code))) {
      result.blockerCodes.add("migration-archive-ledger-root-unresolved");
    }
    if (root.location.kind !== "workspace-relative" || root.location.path === null) {
      result.blockerCodes.add("migration-archive-ledger-root-private");
      continue;
    }
    const absolute = workspaceRef(workspaceRoot, root.location.path);
    if (!absolute) {
      result.blockerCodes.add("migration-archive-ledger-root-invalid");
      continue;
    }
    if (!root.exists) continue;
    if (root.type !== "directory") {
      result.blockerCodes.add("migration-archive-ledger-root-invalid");
      continue;
    }
    roots.set(absolute, root.digest);
  }

  for (const [ledgerRoot, ledgerDigest] of [...roots].sort(([left], [right]) => compareText(left, right))) {
    const ledgerSource = archiveImportSource(inventory, workspaceRoot, ledgerRoot);
    if (!ledgerSource) {
      result.blockerCodes.add("migration-archive-source-unresolved");
      continue;
    }
    const physicalBlockers = physicalSourceBlockers(
      inventory,
      sourceClosureIds(inventory, ledgerSource.sourceId),
    );
    if (physicalBlockers.length > 0) {
      for (const code of physicalBlockers) result.blockerCodes.add(code);
      continue;
    }
    const walked = walkForFileNames(ledgerRoot, "archive-manifest.json");
    if (walked.blocker) result.blockerCodes.add(walked.blocker);
    for (const manifestFile of walked.files) {
      const archiveRoot = path.dirname(manifestFile);
      const manifestRead = readJsonFile(manifestFile);
      // Current typed M2 archive authority may coexist with exact legacy
      // archive roots during explicit migration. It is validated by the M2
      // ledger owner and is never reinterpreted as a legacy v1/v2 aggregate.
      if (
        manifestRead.ok
        && manifestRead.value?.artifactKind === "wakeflow-archive-manifest"
        && manifestRead.value?.schemaVersion === 1
      ) continue;
      const stateRead = readJsonFile(path.join(archiveRoot, "wakeflow-state.json"));
      const eventsRead = readJsonLines(path.join(archiveRoot, "controller-events.jsonl"));
      if (!manifestRead.ok || !stateRead.ok || !eventsRead.ok) {
        result.blockerCodes.add("migration-archive-contract-invalid");
        continue;
      }
      const manifest = manifestRead.value;
      const state = stateRead.value;
      const events = eventsRead.values;
      const demandKey = state.demandKey;
      const last = events.at(-1);
      const sourceStateRoot = typeof manifest.sourceStateRoot === "string" ? manifest.sourceStateRoot : null;
      const allowedSourceRoots = typeof demandKey === "string"
        ? legacyStateRootRefs(inventory, demandKey)
        : new Set();
      const valid = (
        manifest.kind === "WakeflowArchiveManifest"
        && [1, 2].includes(manifest.version)
        && state.schemaVersion === 1
        && typeof demandKey === "string"
        && demandKey.length > 0
        && manifest.demandKey === demandKey
        && state.state === "archived"
        && Number.isSafeInteger(state.revision)
        && state.revision > 0
        && allowedSourceRoots.has(sourceStateRoot)
        && legacyEventLogValid(events, { expectedRevision: state.revision })
        && events.every((event) => (
          !plainObject(event.wakeflowTrace)
          || event.wakeflowTrace.demandKey === demandKey
        ))
        && last?.stateRevision === state.revision
        && last?.type === "demand.archived"
        && last?.actor === "controller"
        && ["completed", "cancelled"].includes(last?.from)
        && last?.to === "archived"
      );
      if (!valid) {
        result.blockerCodes.add("migration-archive-contract-invalid");
        continue;
      }
      if (result.archives.has(demandKey)) {
        result.blockerCodes.add("migration-archive-demand-duplicate");
        continue;
      }
      const taskLedger = Array.isArray(manifest.taskLedger) ? manifest.taskLedger : [];
      const taskStatus = new Map();
      const stateTasks = Array.isArray(state.targetTasks) ? state.targetTasks : [];
      const stateTaskById = new Map();
      let taskLedgerValid = true;
      for (const task of stateTasks) {
        if (
          !plainObject(task)
          || typeof task.targetTaskId !== "string"
          || !task.targetTaskId
          || stateTaskById.has(task.targetTaskId)
        ) {
          taskLedgerValid = false;
          break;
        }
        stateTaskById.set(task.targetTaskId, task);
      }
      for (const task of taskLedger) {
        const stateTask = stateTaskById.get(task?.targetTaskId);
        if (
          !plainObject(task)
          || typeof task.targetTaskId !== "string"
          || !task.targetTaskId
          || typeof task.status !== "string"
          || taskStatus.has(task.targetTaskId)
          || !stateTask
          || task.targetWindow !== (stateTask.targetWindow ?? null)
          || task.status !== (stateTask.status ?? null)
          || task.reviewDecision !== (stateTask.reviewDecision ?? null)
          || task.dispatchCount !== (stateTask.counts?.dispatchCount ?? 0)
          || task.reworkCount !== (stateTask.counts?.reworkCount ?? 0)
          || task.redesignCount !== (stateTask.counts?.redesignCount ?? 0)
        ) {
          taskLedgerValid = false;
          break;
        }
        taskStatus.set(task.targetTaskId, task.status);
      }
      if (!taskLedgerValid || taskLedger.length !== stateTaskById.size) {
        result.blockerCodes.add("migration-archive-task-ledger-invalid");
        continue;
      }
      const archivedResults = walkJsonFiles(path.join(archiveRoot, "target-results"));
      if (archivedResults.blocker) {
        result.blockerCodes.add("migration-archive-target-result-invalid");
        continue;
      }
      const resultRecords = [];
      const resultIds = new Set();
      const resultRevisionKeys = new Set();
      for (const file of archivedResults.files) {
        const read = readJsonFile(file);
        const value = read.value;
        const stateTask = stateTaskById.get(value?.targetTaskId);
        const revisionKey = `${value?.targetTaskId ?? ""}\0${value?.resultRevision ?? ""}`;
        if (
          !read.ok
          || value.schemaVersion !== 1
          || typeof value.resultId !== "string"
          || !value.resultId
          || value.demandKey !== demandKey
          || value.stateRoot !== sourceStateRoot
          || typeof value.taskPackageId !== "string"
          || typeof value.dispatchGroup !== "string"
          || typeof value.targetWindow !== "string"
          || typeof value.targetTaskId !== "string"
          || ![true, false].includes(value.currentResult)
          || !Number.isSafeInteger(value.resultRevision)
          || value.resultRevision <= 0
          || resultIds.has(value.resultId)
          || resultRevisionKeys.has(revisionKey)
          || !stateTask
          || value.taskPackageId !== stateTask.taskPackageId
          || value.targetWindow !== stateTask.targetWindow
          || !traceMatches(value, {
            demandKey,
            dispatchGroup: value.dispatchGroup,
            targetTaskId: value.targetTaskId,
            targetWindow: value.targetWindow,
          })
          || (value.currentResult === true && (
            stateTask.status !== "accepted"
            || value.resultId !== stateTask.resultId
            || value.dispatchGroup !== stateTask.delivery?.dispatchGroup
          ))
        ) {
          taskLedgerValid = false;
          break;
        }
        resultIds.add(value.resultId);
        resultRevisionKeys.add(revisionKey);
        resultRecords.push({ digest: read.digest, value });
      }
      const acceptedTaskLineage = new Map();
      for (const stateTask of stateTasks.filter((task) => task.status === "accepted")) {
        if (
          typeof stateTask.resultId !== "string"
          || !stateTask.resultId
          || typeof stateTask.taskPackageId !== "string"
          || !stateTask.taskPackageId
          || typeof stateTask.targetWindow !== "string"
          || !stateTask.targetWindow
          || typeof stateTask.delivery?.dispatchGroup !== "string"
          || !stateTask.delivery.dispatchGroup
        ) {
          taskLedgerValid = false;
          break;
        }
        const matching = resultRecords.filter(({ value }) => (
          value.schemaVersion === 1
          && value.currentResult === true
          && value.resultId === stateTask.resultId
          && value.demandKey === demandKey
          && value.taskPackageId === stateTask.taskPackageId
          && value.dispatchGroup === stateTask.delivery?.dispatchGroup
          && value.stateRoot === sourceStateRoot
          && value.targetWindow === stateTask.targetWindow
          && value.targetTaskId === stateTask.targetTaskId
          && Number.isSafeInteger(value.resultRevision)
          && value.resultRevision > 0
        ));
        if (matching.length !== 1) {
          taskLedgerValid = false;
          break;
        }
        acceptedTaskLineage.set(stateTask.targetTaskId, {
          dispatchGroup: stateTask.delivery.dispatchGroup,
          resultRevision: matching[0].value.resultRevision,
          stateResultId: stateTask.resultId,
          targetTaskId: stateTask.targetTaskId,
          targetWindow: stateTask.targetWindow,
          taskPackageId: stateTask.taskPackageId,
        });
      }
      if (!taskLedgerValid) {
        result.blockerCodes.add("migration-archive-target-result-invalid");
        continue;
      }
      const evidenceDigest = canonicalJsonDigest({
        demandKey,
        eventsDigest: eventsRead.digest,
        ledgerDigest,
        manifestDigest: manifestRead.digest,
        resultDigests: resultRecords.map((entry) => entry.digest).sort(compareText),
        stateDigest: stateRead.digest,
      });
      result.archives.set(demandKey, {
        demandKey,
        evidenceDigest,
        acceptedTaskLineage,
        archiveRoot,
        eventsDigest: eventsRead.digest,
        manifest,
        manifestDigest: manifestRead.digest,
        resultDigests: resultRecords.map((entry) => entry.digest).sort(compareText),
        state,
        stateDigest: stateRead.digest,
        taskStatus,
      });
      result.facts.push({ demandKey, evidenceDigest, revision: state.revision });
    }
  }
  result.facts.sort((left, right) => compareText(left.demandKey, right.demandKey));
  return result;
}

// 识别仍由旧state owner持有的current demand及pending recovery，不尝试代做transition。
function activeDemandFacts(workspaceRoot, inventory) {
  const result = {
    blockerCodes: new Set(),
    drainCodes: new Set(),
    facts: [],
    activeKeys: new Set(),
  };
  const oldRoot = inspectPath(path.join(workspaceRoot, ".workspace-active"));
  if (oldRoot.exists) result.blockerCodes.add("migration-old-active-root-manual-recovery");
  const canonicalActiveRoot = path.join(workspaceRoot, ".wakeflow-active");
  for (const root of inventory.roots.filter((entry) => entry.rootKind === "configured-active-root")) {
    if (root.location.kind !== "workspace-relative" || root.location.path === null) {
      result.blockerCodes.add("migration-active-root-unresolved");
      continue;
    }
    const configuredRoot = workspaceRef(workspaceRoot, root.location.path);
    if (!configuredRoot) {
      result.blockerCodes.add("migration-active-root-unresolved");
      continue;
    }
    if (configuredRoot === canonicalActiveRoot || !root.exists) continue;
    const listedFork = listDirectory(configuredRoot);
    if (!listedFork.ok) {
      result.blockerCodes.add("migration-active-root-unresolved");
      continue;
    }
    result.facts.push({
      configuredForkDigest: root.digest,
      configuredForkEntryCount: listedFork.entries.length,
      configuredForkRootId: root.rootId,
    });
    if (listedFork.entries.length > 0) {
      result.blockerCodes.add("migration-active-root-divergence");
    }
  }
  const currentRoot = path.join(workspaceRoot, ".wakeflow-active/current");
  const listed = listDirectory(currentRoot);
  if (!listed.ok) {
    result.blockerCodes.add("migration-active-root-unreadable");
    return result;
  }
  for (const entry of listed.entries) {
    if (CURRENT_ROOT_IGNORED_FILES.has(entry.name)) continue;
    const demandRoot = path.join(currentRoot, entry.name);
    if (entry.type !== "directory") {
      result.blockerCodes.add("migration-active-root-residue-unrecognized");
      continue;
    }
    const stateRead = readJsonFile(path.join(demandRoot, "wakeflow-state.json"));
    const eventsRead = readJsonLines(path.join(demandRoot, "controller-events.jsonl"));
    if (!stateRead.ok || !eventsRead.ok || stateRead.value.demandKey !== entry.name) {
      result.blockerCodes.add("migration-active-demand-contract-invalid");
      continue;
    }
    const state = stateRead.value;
    const pendingTransition = inspectPath(path.join(demandRoot, "wakeflow-state.pending-transition.json")).exists;
    const pendingArchive = inspectPath(path.join(demandRoot, "wakeflow-archive.pending-intent.json")).exists;
    if (
      state.schemaVersion !== 1
      || typeof state.demandKey !== "string"
      || !state.demandKey
      || !Number.isSafeInteger(state.revision)
      || state.revision <= 0
      || !legacyEventLogValid(eventsRead.values, {
        expectedRevision: pendingTransition || pendingArchive ? null : state.revision,
      })
    ) {
      result.blockerCodes.add("migration-active-demand-contract-invalid");
      continue;
    }
    result.activeKeys.add(state.demandKey);
    if (pendingTransition || pendingArchive) result.drainCodes.add("migration-state-recovery-required");
    if (["completed", "cancelled"].includes(state.state)) result.drainCodes.add("migration-demand-archive-required");
    else if (state.state === "archived") result.drainCodes.add("migration-archive-finalization-required");
    else result.drainCodes.add("migration-demand-owner-drain-required");
    result.facts.push({
      demandKey: state.demandKey,
      eventsDigest: eventsRead.digest,
      pendingArchive,
      pendingTransition,
      revision: state.revision,
      state: state.state,
      stateDigest: stateRead.digest,
    });
  }
  result.facts.sort((left, right) => compareText(left.demandKey, right.demandKey));
  return result;
}

// 按manual > drain > host-followup > drained/absent的固定优先级归约领域状态。
function semanticStatus({ manualCodes, drainCodes, followCodes, present }) {
  if (manualCodes.size > 0) return "manual-recovery";
  if (drainCodes.size > 0) return "drain-required";
  if (followCodes.size > 0) return "drained-with-host-followup";
  return present ? "drained" : "absent";
}

// 将T04已证明的物理source风险并入本领域manual结论。
function addPhysicalBlockers(manualCodes, inventory, sourceIds) {
  for (const code of physicalSourceBlockers(inventory, sourceIds)) manualCodes.add(code);
}

// 证明用户提供的exact artifact真实携带本领域最后owner入口。
function capabilityFor(domain, artifact) {
  const definition = DOMAIN_BY_NAME.get(domain);
  const files = new Map(artifact.manifest.files.map((entry) => [entry.ref, entry]));
  const observed = [];
  const missing = [];
  for (const ref of definition.requiredAll) {
    const entry = files.get(ref);
    if (!entry) missing.push(ref);
    else observed.push({ digest: entry.digest, ref });
  }
  return {
    capabilityDigest: canonicalJsonDigest({ artifactDigest: artifact.artifactDigest, domain, observed }),
    missing,
  };
}

// 统一签发单领域portable closure；privateFacts只进入摘要，不进入输出。
function finalizeDomain({
  artifact,
  domain,
  sourceIds,
  subjectCount,
  privateFacts,
  manualCodes = new Set(),
  drainCodes = new Set(),
  followCodes = new Set(),
  present = subjectCount > 0 || sourceIds.length > 0,
}) {
  const definition = DOMAIN_BY_NAME.get(domain);
  const capability = capabilityFor(domain, artifact);
  if (present && subjectCount > 0 && capability.missing.length > 0) {
    manualCodes.add("migration-legacy-owner-capability-missing");
  }
  const status = semanticStatus({ manualCodes, drainCodes, followCodes, present });
  return {
    blockerCodes: sortedUnique([...manualCodes, ...drainCodes, ...followCodes]),
    capabilityDigest: capability.capabilityDigest,
    domain,
    evidenceDigest: canonicalJsonDigest({
      artifactDigest: artifact.artifactDigest,
      blockerCodes: sortedUnique([...manualCodes, ...drainCodes, ...followCodes]),
      domain,
      privateFacts,
      sourceIds,
      status,
      subjectCount,
    }),
    owner: definition.owner,
    ownerActions: definition.ownerActions,
    sourceIds,
    status,
    subjectCount,
  };
}

// Demand域组合active与archive事实，保持状态authority和迁移处置相互独立。
function inspectDemandDomain({ workspaceRoot, inventory, artifact, archives, active }) {
  const sourceIds = sourceIdsFor(inventory, ["active-demand", "active-root-residue"]);
  const manualCodes = new Set(archives.blockerCodes);
  const drainCodes = new Set(active.drainCodes);
  for (const code of active.blockerCodes) manualCodes.add(code);
  addPhysicalBlockers(manualCodes, inventory, sourceIds);
  return finalizeDomain({
    artifact,
    domain: "demand-state",
    drainCodes,
    manualCodes,
    privateFacts: { active: active.facts, archives: archives.facts },
    sourceIds,
    subjectCount: active.facts.length + archives.facts.length,
    present: active.facts.length > 0 || archives.facts.length > 0 || sourceIds.length > 0,
  });
}

// ==================== 五、legacy transport完整链识别 ====================

// 构建唯一key索引；坏key或重复key只记录领域blocker，不选择winner。
function mapUnique(values, selector, manualCodes, duplicateCode) {
  const result = new Map();
  for (const value of values) {
    const key = selector(value);
    if (typeof key !== "string" || !key || result.has(key)) {
      manualCodes.add(duplicateCode);
      continue;
    }
    result.set(key, value);
  }
  return result;
}

// 严格读取一个仅含JSON文件的目录，并保留每个exact字节摘要。
function parseJsonDirectory(directory, manualCodes, code) {
  const listed = jsonFiles(directory);
  if (!listed.ok) {
    if (inspectPath(directory).exists) manualCodes.add(code);
    return [];
  }
  const values = [];
  for (const file of listed.files) {
    const read = readJsonFile(file);
    if (!read.ok) manualCodes.add(code);
    else values.push({ digest: read.digest, value: read.value });
  }
  return values;
}

// 从stateRef或trace取得transport的legacy demand关联；不从文件名推断。
function transportDemandKey(value) {
  return value?.stateRef?.demandKey ?? value?.wakeflowTrace?.demandKey ?? null;
}

// 比较两个纯数据值的完整canonical语义。
function sameCanonicalValue(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

// 生成local TargetResult的业务lineage tuple，resultId不与archive imported result强求相等。
function transportResultTuple(value) {
  const demandKey = transportDemandKey(value);
  if (
    value?.kind !== "TargetResultEnvelope"
    || value.version !== 1
    || typeof value.resultId !== "string"
    || !value.resultId
    || typeof value.dispatchGroup !== "string"
    || !value.dispatchGroup
    || typeof value.targetWindow !== "string"
    || !value.targetWindow
    || typeof value.taskId !== "string"
    || !value.taskId
    || typeof demandKey !== "string"
    || !demandKey
    || !Number.isSafeInteger(value.resultRevision)
    || value.resultRevision <= 0
  ) return null;
  return `${demandKey}\0${value.dispatchGroup}\0${value.targetWindow}\0${value.taskId}`;
}

// 读取current/superseded结果并闭合双向supersession与逐revision历史链。
function parseTransportResults(workspaceRoot, root, manualCodes) {
  const resultsRoot = path.join(root, "target-results");
  const listed = listDirectory(resultsRoot);
  if (!listed.ok) {
    if (listed.exists) manualCodes.add("migration-transport-result-invalid");
    return { current: [], historical: [], all: [] };
  }
  const files = [];
  for (const entry of listed.entries) {
    if (entry.type === "file" && entry.name.endsWith(".json")) {
      files.push({ file: path.join(resultsRoot, entry.name), historical: false });
    } else if (entry.type === "directory" && entry.name === "superseded") {
      const history = jsonFiles(path.join(resultsRoot, "superseded"));
      if (!history.ok) manualCodes.add("migration-transport-result-history-invalid");
      else files.push(...history.files.map((file) => ({ file, historical: true })));
    } else {
      manualCodes.add("migration-transport-result-invalid");
    }
  }
  const records = [];
  for (const entry of files.sort((left, right) => compareText(left.file, right.file))) {
    const read = readJsonFile(entry.file);
    const fileRef = path.relative(workspaceRoot, entry.file).split(path.sep).join("/");
    if (!read.ok || !transportResultTuple(read.value)) {
      manualCodes.add(entry.historical
        ? "migration-transport-result-history-invalid"
        : "migration-transport-result-invalid");
      continue;
    }
    records.push({ digest: read.digest, fileRef, historical: entry.historical, value: read.value });
  }
  const current = records.filter((entry) => !entry.historical);
  const historical = records.filter((entry) => entry.historical);
  const currentByTuple = mapUnique(current, ({ value }) => transportResultTuple(value), manualCodes, "migration-transport-result-duplicate");
  const historyByRef = mapUnique(historical, ({ fileRef }) => fileRef, manualCodes, "migration-transport-result-history-invalid");
  const usedHistory = new Set();
  for (const currentRecord of currentByTuple.values()) {
    let newer = currentRecord;
    const visited = new Set();
    while (plainObject(newer.value.supersedes)) {
      const archivedRef = newer.value.supersedes.archivedResultFile;
      const older = historyByRef.get(archivedRef);
      if (
        typeof archivedRef !== "string"
        || !archivedRef.startsWith(".wakeflow-local/wakeflow-delivery/target-results/superseded/")
        || !older
        || visited.has(archivedRef)
        || transportResultTuple(older.value) !== transportResultTuple(newer.value)
        || older.value.resultRevision + 1 !== newer.value.resultRevision
        || newer.value.supersedes.resultId !== older.value.resultId
        || newer.value.supersedes.status !== older.value.status
        || newer.value.supersedes.reportedAt !== older.value.reportedAt
        || !plainObject(older.value.supersededBy)
        || older.value.supersededBy.resultId !== newer.value.resultId
        || older.value.supersededBy.resultFile !== currentRecord.fileRef
        || older.value.supersededBy.supersededAt !== newer.value.supersedes.supersededAt
      ) {
        manualCodes.add("migration-transport-result-history-invalid");
        break;
      }
      visited.add(archivedRef);
      usedHistory.add(archivedRef);
      newer = older;
    }
  }
  for (const historicalRecord of historical) {
    if (!usedHistory.has(historicalRecord.fileRef)) {
      manualCodes.add("migration-transport-result-history-orphan");
    }
  }
  return { current, historical, all: records };
}

// 归约同一delivery的多次真实attempt；accepted、ambiguous和pre-send reject保持不同语义。
function classifyTransportRuns({ deliveryRuns, drainCodes, manualCodes, envelope, expected }) {
  if (deliveryRuns.length === 0) {
    drainCodes.add("migration-transport-run-missing");
    return { accepted: false, terminalRejected: false };
  }
  let acceptedCount = 0;
  let rejectedCount = 0;
  for (const { value: run } of deliveryRuns) {
    if (
      run.kind !== "DirectThreadDeliveryRun"
      || run.version !== 2
      || typeof run.deliveryRunId !== "string"
      || !run.deliveryRunId
      || run.deliveryId !== envelope.deliveryId
      || run.dispatchGroup !== expected.dispatchGroup
      || run.targetWindow !== expected.targetWindow
      || run.taskId !== expected.taskId
      || (expected.triggerTarget !== undefined && run.triggerTarget !== expected.triggerTarget)
      || (expected.triggerTaskId !== undefined && run.triggerTaskId !== expected.triggerTaskId)
      || (expected.reviewScope !== undefined && run.reviewScope !== expected.reviewScope)
      || !traceMatches(run, {
        deliveryId: envelope.deliveryId,
        deliveryRunId: run.deliveryRunId,
        demandKey: expected.demandKey,
        dispatchGroup: expected.dispatchGroup,
        targetWindow: expected.targetWindow,
      })
    ) {
      manualCodes.add("migration-transport-run-lineage-invalid");
      continue;
    }
    if (run.transportStatus === "accepted") {
      acceptedCount += 1;
      if (run.status !== "sent") {
        manualCodes.add("migration-transport-accepted-run-invalid");
      } else if (
        run.readback?.checked !== true
        || run.readback?.ok !== true
        || run.readback?.status !== "confirmed"
      ) {
        drainCodes.add("migration-transport-readback-unconfirmed");
      }
    } else if (run.transportStatus === "ambiguous") {
      if (!["blocked", "failed"].includes(run.status) || run.readback?.status === "confirmed") {
        manualCodes.add("migration-transport-ambiguous-run-invalid");
      } else {
        drainCodes.add("migration-transport-ambiguous");
      }
    } else if (run.transportStatus === "rejected-before-send") {
      rejectedCount += 1;
      if (
        !["blocked", "failed"].includes(run.status)
        || run.readback?.checked !== false
        || run.readback?.ok !== false
        || run.readback?.status !== "unavailable"
      ) manualCodes.add("migration-transport-rejected-run-invalid");
    } else {
      manualCodes.add("migration-transport-status-invalid");
    }
  }
  if (acceptedCount > 1) manualCodes.add("migration-transport-accepted-run-duplicate");
  return {
    accepted: acceptedCount > 0,
    terminalRejected: rejectedCount === deliveryRuns.length,
  };
}

/**
 * 沿group→packet→envelope→run→local result→archive accepted task核验每条transport链。
 * 它不重写旧aggregate为v3记录；只有完整闭环后才向archive transform提供digest inventory。
 */
function inspectTransportDomain({
  workspaceRoot,
  inventory,
  artifact,
  archives,
  active,
  importFactsByDemand = null,
  importSourceIdsByDemand = null,
}) {
  const sourceIds = sourceIdsFor(inventory, ["transport"]);
  const manualCodes = new Set();
  const drainCodes = new Set();
  addPhysicalBlockers(manualCodes, inventory, sourceIds);
  const root = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery");
  const rootState = inspectPath(root);
  if (rootState.exists && rootState.type !== "directory") manualCodes.add("migration-transport-root-invalid");
  const records = Object.fromEntries(TRANSPORT_DIRECTORIES
    .filter((name) => !["locks", "target-results"].includes(name))
    .map((name) => [name, parseJsonDirectory(path.join(root, name), manualCodes, "migration-transport-record-invalid")]));
  const parsedResults = parseTransportResults(workspaceRoot, root, manualCodes);
  const locks = listDirectory(path.join(root, "locks"));
  if (!locks.ok) manualCodes.add("migration-transport-lock-root-invalid");
  else {
    for (const entry of locks.entries) {
      if (entry.type === "file") drainCodes.add("migration-transport-lock-active");
      else manualCodes.add("migration-transport-lock-invalid");
    }
  }

  const groups = records["dispatch-groups"];
  const packets = records["dispatch-packets"];
  const envelopes = records["delivery-envelopes"];
  const runs = records["delivery-runs"];
  const results = parsedResults.current;
  const groupById = mapUnique(groups, ({ value }) => value.groupId, manualCodes, "migration-transport-group-duplicate");
  const packetById = mapUnique(packets, ({ value }) => value.id, manualCodes, "migration-transport-packet-duplicate");
  const envelopeById = mapUnique(envelopes, ({ value }) => value.deliveryId, manualCodes, "migration-transport-envelope-duplicate");
  mapUnique(runs, ({ value }) => value.deliveryRunId, manualCodes, "migration-transport-run-duplicate");
  mapUnique(results, ({ value }) => value.resultId, manualCodes, "migration-transport-result-duplicate");

  const runsByDelivery = new Map();
  for (const run of runs) {
    const key = run.value.deliveryId;
    const values = runsByDelivery.get(key) ?? [];
    values.push(run);
    runsByDelivery.set(key, values);
  }
  const resultsByTuple = new Map();
  for (const result of results) {
    const key = transportResultTuple(result.value);
    if (resultsByTuple.has(key)) manualCodes.add("migration-transport-result-duplicate");
    resultsByTuple.set(key, result);
  }

  const expectedPacketIds = new Set();
  const expectedEnvelopeIds = new Set();
  const usedResultRefs = new Set();
  for (const groupRecord of groups) {
    const group = groupRecord.value;
    const demandKey = transportDemandKey(group);
    const archive = typeof demandKey === "string" ? archives.archives.get(demandKey) : null;
    if (
      group.kind !== "DispatchGroup"
      || group.version !== 1
      || typeof group.groupId !== "string"
      || !group.groupId
      || group.membershipFinalized !== true
      || typeof group.controllerWindow !== "string"
      || !group.controllerWindow
      || !plainObject(group.stateRef)
      || !Array.isArray(group.expectedTargets)
      || group.expectedTargets.length === 0
      || typeof demandKey !== "string"
      || !legacyStateRootRefs(inventory, demandKey).has(group.stateRef.stateRoot)
      || (archive && group.stateRef.stateRoot !== archive.manifest.sourceStateRoot)
      || !traceMatches(group, { demandKey, dispatchGroup: group.groupId })
    ) {
      manualCodes.add("migration-transport-group-invalid");
      continue;
    }
    if (!archive) {
      if (active.activeKeys.has(demandKey)) drainCodes.add("migration-transport-demand-not-archived");
      else manualCodes.add("migration-transport-archive-evidence-missing");
    }
    const targetKeys = new Set();
    for (const target of group.expectedTargets) {
      const tuple = `${target?.targetWindow ?? ""}\0${target?.taskId ?? ""}`;
      if (
        !plainObject(target)
        || typeof target.targetWindow !== "string"
        || typeof target.taskId !== "string"
        || typeof target.packetId !== "string"
        || targetKeys.has(tuple)
      ) {
        manualCodes.add("migration-transport-group-membership-invalid");
        continue;
      }
      targetKeys.add(tuple);
      expectedPacketIds.add(target.packetId);
      const packetRecord = packetById.get(target.packetId);
      const packet = packetRecord?.value;
      if (
        !packet
        || packet.kind !== "ControllerDispatchPacket"
        || packet.version !== 1
        || packet.dispatchGroup !== group.groupId
        || packet.targetWindow !== target.targetWindow
        || packet.taskId !== target.taskId
        || transportDemandKey(packet) !== demandKey
        || packet.controllerWindow !== group.controllerWindow
        || packet.stateRef?.stateRoot !== group.stateRef.stateRoot
        || packet.stateRef?.stateRevision !== group.stateRef.stateRevision
        || packet.stateRef?.targetTaskId !== target.taskId
        || !sameCanonicalValue(packet.returnPolicy, group.returnPolicy)
        || packet.packetDigest !== legacyDispatchPacketDigest(packet)
        || !traceMatches(packet, {
          demandKey,
          dispatchGroup: group.groupId,
          targetTaskId: target.taskId,
          targetWindow: target.targetWindow,
        })
      ) {
        manualCodes.add("migration-transport-packet-lineage-invalid");
        continue;
      }
      const matchingEnvelopes = envelopes.filter(({ value }) => (
        value.kind === "DeliveryEnvelope" && value.sourcePacketId === packet.id
      ));
      if (matchingEnvelopes.length !== 1) {
        if (matchingEnvelopes.length === 0) drainCodes.add("migration-transport-envelope-missing");
        else manualCodes.add("migration-transport-envelope-duplicate");
        continue;
      }
      const envelopeRecord = matchingEnvelopes[0];
      const envelope = envelopeRecord.value;
      expectedEnvelopeIds.add(envelope.deliveryId);
      if (
        envelope.version !== 3
        || envelope.dispatchGroup !== group.groupId
        || envelope.targetWindow !== target.targetWindow
        || envelope.taskId !== target.taskId
        || transportDemandKey(envelope) !== demandKey
        || envelope.controllerWindow !== group.controllerWindow
        || !exactStateRef(envelope.stateRef, packet.stateRef)
        || !sameCanonicalValue(envelope.returnPolicy, group.returnPolicy)
        || envelope.sourcePacketDigest !== packet.packetDigest
        || envelope.preparationDigest !== legacyDispatchPreparationDigest(packet, envelope)
        || !traceMatches(envelope, {
          deliveryId: envelope.deliveryId,
          demandKey,
          dispatchGroup: group.groupId,
          targetTaskId: target.taskId,
          targetWindow: target.targetWindow,
        })
      ) {
        manualCodes.add("migration-transport-envelope-lineage-invalid");
        continue;
      }
      const deliveryRuns = runsByDelivery.get(envelope.deliveryId) ?? [];
      const classified = classifyTransportRuns({
        deliveryRuns,
        drainCodes,
        manualCodes,
        envelope,
        expected: {
          demandKey,
          dispatchGroup: group.groupId,
          targetWindow: target.targetWindow,
          taskId: target.taskId,
        },
      });
      if (classified.accepted) {
        const resultKey = `${demandKey}\0${group.groupId}\0${target.targetWindow}\0${target.taskId}`;
        const result = resultsByTuple.get(resultKey);
        if (!result) drainCodes.add("migration-transport-result-missing");
        else {
          usedResultRefs.add(result.fileRef);
          const acceptedLineage = archive?.acceptedTaskLineage.get(target.taskId);
          if (
            !exactStateRef(result.value.stateRef, packet.stateRef)
            || !traceMatches(result.value, {
              dispatchGroup: group.groupId,
              targetTaskId: target.taskId,
              targetWindow: target.targetWindow,
            })
          ) {
            manualCodes.add("migration-transport-result-lineage-invalid");
          } else if (
            archive?.taskStatus.get(target.taskId) !== "accepted"
            || !acceptedLineage
            || acceptedLineage.dispatchGroup !== group.groupId
            || acceptedLineage.resultRevision !== result.value.resultRevision
            || acceptedLineage.targetWindow !== target.targetWindow
            || acceptedLineage.taskPackageId !== packet.stateRef.taskPackageId
          ) {
            drainCodes.add("migration-transport-result-not-archived-as-accepted");
          }
        }
      } else if (
        classified.terminalRejected
        && archive?.taskStatus.get(target.taskId) === "accepted"
      ) {
        manualCodes.add("migration-transport-run-archive-mismatch");
      }
    }
  }

  for (const packetId of packetById.keys()) if (!expectedPacketIds.has(packetId)) manualCodes.add("migration-transport-packet-orphan");
  for (const envelopeRecord of envelopes) {
    const envelope = envelopeRecord.value;
    if (envelope.kind === "DeliveryEnvelope") {
      if (!expectedEnvelopeIds.has(envelope.deliveryId)) manualCodes.add("migration-transport-envelope-orphan");
      continue;
    }
    if (envelope.kind !== "ControllerReturnEnvelope" || envelope.version !== 3) {
      manualCodes.add("migration-transport-envelope-invalid");
      continue;
    }
    const group = groupById.get(envelope.dispatchGroup)?.value;
    const demandKey = transportDemandKey(envelope) ?? transportDemandKey(group);
    if (
      !group
      || typeof demandKey !== "string"
      || envelope.controllerWindow !== group.controllerWindow
      || envelope.targetThread?.windowName !== group.controllerWindow
      || !exactStateRef(envelope.stateRef, group.stateRef)
      || !sameCanonicalValue(envelope.returnPolicy, group.returnPolicy)
      || typeof envelope.triggerTarget !== "string"
      || typeof envelope.triggerTaskId !== "string"
      || !traceMatches(envelope, {
        deliveryId: envelope.deliveryId,
        demandKey,
        dispatchGroup: group.groupId,
        targetTaskId: envelope.triggerTaskId,
        targetWindow: envelope.triggerTarget,
      })
    ) {
      manualCodes.add("migration-transport-controller-return-orphan");
      continue;
    }
    expectedEnvelopeIds.add(envelope.deliveryId);
    if (!archives.archives.has(demandKey)) {
      if (active.activeKeys.has(demandKey)) drainCodes.add("migration-transport-demand-not-archived");
      else manualCodes.add("migration-transport-archive-evidence-missing");
    }
    const deliveryRuns = runsByDelivery.get(envelope.deliveryId) ?? [];
    classifyTransportRuns({
      deliveryRuns,
      drainCodes,
      manualCodes,
      envelope,
      expected: {
        demandKey,
        dispatchGroup: group.groupId,
        targetWindow: group.controllerWindow,
        taskId: envelope.triggerTaskId,
        triggerTarget: envelope.triggerTarget,
        triggerTaskId: envelope.triggerTaskId,
        reviewScope: envelope.reviewScope,
      },
    });
  }
  for (const envelopeId of envelopeById.keys()) if (!expectedEnvelopeIds.has(envelopeId)) manualCodes.add("migration-transport-envelope-orphan");
  for (const deliveryId of runsByDelivery.keys()) if (!envelopeById.has(deliveryId)) manualCodes.add("migration-transport-run-orphan");
  for (const result of results) if (!usedResultRefs.has(result.fileRef)) manualCodes.add("migration-transport-result-orphan");

  const facts = {
    envelopeDigests: envelopes.map((entry) => entry.digest).sort(compareText),
    groupDigests: groups.map((entry) => entry.digest).sort(compareText),
    lockCount: locks.ok ? locks.entries.length : null,
    packetDigests: packets.map((entry) => entry.digest).sort(compareText),
    resultDigests: parsedResults.all.map((entry) => entry.digest).sort(compareText),
    runDigests: runs.map((entry) => entry.digest).sort(compareText),
  };
  if (importFactsByDemand) {
    const envelopeDemandById = new Map(envelopes.map(({ value }) => {
      const group = groupById.get(value.dispatchGroup)?.value ?? null;
      return [value.deliveryId, transportDemandKey(value) ?? transportDemandKey(group)];
    }));
    for (const demandKey of [...archives.archives.keys()].sort(compareText)) {
      const selected = {
        currentResultDigests: parsedResults.current
          .filter(({ value }) => transportDemandKey(value) === demandKey)
          .map((entry) => entry.digest)
          .sort(compareText),
        envelopeDigests: envelopes
          .filter(({ value }) => envelopeDemandById.get(value.deliveryId) === demandKey)
          .map((entry) => entry.digest)
          .sort(compareText),
        groupDigests: groups
          .filter(({ value }) => transportDemandKey(value) === demandKey)
          .map((entry) => entry.digest)
          .sort(compareText),
        historicalResultDigests: parsedResults.historical
          .filter(({ value }) => transportDemandKey(value) === demandKey)
          .map((entry) => entry.digest)
          .sort(compareText),
        packetDigests: packets
          .filter(({ value }) => transportDemandKey(value) === demandKey)
          .map((entry) => entry.digest)
          .sort(compareText),
        runDigests: runs
          .filter(({ value }) => (
            transportDemandKey(value) === demandKey
            || envelopeDemandById.get(value.deliveryId) === demandKey
          ))
          .map((entry) => entry.digest)
          .sort(compareText),
      };
      const inventoryDigest = canonicalJsonDigest(selected);
      const recordCount = ARCHIVE_IMPORT_TRANSPORT_DIGEST_FIELDS.reduce(
        (count, field) => count + selected[field].length,
        0,
      );
      const sourceStatus = recordCount === 0 ? "absent" : "archived";
      appendImportSourceIds(importSourceIdsByDemand, demandKey, exactImportSourceIds({
        inventory,
        resourceKind: "transport",
        sourceDigests: ARCHIVE_IMPORT_TRANSPORT_DIGEST_FIELDS.flatMap((field) => selected[field]),
        manualCodes,
        code: "migration-transport-import-source-ambiguous",
      }));
      importFactsByDemand.set(demandKey, {
        ...selected,
        inventoryDigest,
        sourceDigest: canonicalJsonDigest({ inventoryDigest, sourceStatus }),
        sourceStatus,
      });
    }
  }
  const subjectCount = groups.length + packets.length + envelopes.length + runs.length + parsedResults.all.length + (locks.ok ? locks.entries.length : 0);
  return finalizeDomain({
    artifact,
    domain: "transport",
    drainCodes,
    manualCodes,
    privateFacts: facts,
    sourceIds,
    subjectCount,
    present: rootState.exists || sourceIds.length > 0,
  });
}

// ==================== 六、Keep-live与stream/worktree静止识别 ====================

// bounded probe只区分absent/dead/alive/unknown；PID本身绝不进入portable输出。
function probePid(value) {
  if (value === undefined || value === null || value === 0 || value === "0") return "absent";
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid <= 0) return "unknown";
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if (error?.code === "ESRCH") return "dead";
    if (error?.code === "EPERM") return "alive";
    return "unknown";
  }
}

// 收集unscoped与host-scoped旧keep-live根，不把host目录存在当活跃证明。
function keepLiveRoots(workspaceRoot) {
  const deliveryRoot = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery");
  const roots = [];
  const unscoped = path.join(deliveryRoot, "keep-live");
  if (inspectPath(unscoped).exists) roots.push(unscoped);
  const hosts = listDirectory(path.join(deliveryRoot, "hosts"));
  if (hosts.ok) {
    for (const host of hosts.entries.filter((entry) => entry.type === "directory")) {
      const candidate = path.join(deliveryRoot, "hosts", host.name, "keep-live");
      if (inspectPath(candidate).exists) roots.push(candidate);
    }
  }
  return roots.sort(compareText);
}

// 历史control只有完整stop request可保留；残缺或其他action不能证明已停机。
function validLegacyKeepLiveStopControl(value) {
  return plainObject(value)
    && value.version === 1
    && value.action === "stop"
    && typeof value.token === "string"
    && value.token.length > 0
    && strictLegacyTimestamp(value.requestedAt)
    && Number.isSafeInteger(value.workerPid)
    && value.workerPid >= 0
    && Number.isSafeInteger(value.childPid)
    && value.childPid >= 0;
}

/**
 * 核对terminal state、零lease/active run、历史stop control、锁及当前进程观察。
 * control中的旧PID不是当前process identity，live/unknown主体仍分别进入drain/manual。
 */
function inspectKeepLiveDomain({ workspaceRoot, inventory, artifact }) {
  const sourceIds = sourceIdsFor(inventory, ["keep-live"]);
  const manualCodes = new Set();
  const drainCodes = new Set();
  addPhysicalBlockers(manualCodes, inventory, sourceIds);
  const facts = [];
  for (const root of keepLiveRoots(workspaceRoot)) {
    const listed = listDirectory(root);
    let lockCount = 0;
    if (!listed.ok) {
      manualCodes.add("migration-keep-live-root-invalid");
      continue;
    }
    for (const entry of listed.entries) {
      if (["state.json", "control.json"].includes(entry.name)) {
        if (entry.type !== "file") manualCodes.add("migration-keep-live-contract-invalid");
      } else if (entry.name.endsWith(".lock") || entry.name.endsWith(".guard")) {
        if (entry.type !== "file") manualCodes.add("migration-keep-live-lock-invalid");
        else {
          lockCount += 1;
          drainCodes.add("migration-keep-live-lock-active");
        }
      } else {
        manualCodes.add("migration-keep-live-residue-invalid");
      }
    }
    const statePath = path.join(root, "state.json");
    const statePathState = inspectPath(statePath);
    const controlPath = path.join(root, "control.json");
    const controlState = inspectPath(controlPath);
    if (!statePathState.exists) {
      if (controlState.exists) manualCodes.add("migration-keep-live-contract-invalid");
      if (lockCount > 0) facts.push({
        activeIdCount: 0,
        controlDigest: null,
        leaseCount: 0,
        lockCount,
        pidStates: [],
        stateDigest: null,
        status: "missing",
      });
      continue;
    }
    const stateRead = readJsonFile(statePath);
    const controlRead = controlState.exists ? readJsonFile(controlPath) : null;
    if (!stateRead.ok || (controlRead && !controlRead.ok)) {
      manualCodes.add("migration-keep-live-contract-invalid");
      continue;
    }
    const state = stateRead.value;
    const leases = state.leases === undefined ? {} : state.leases;
    const activeIds = state.activeAutomationRunIds === undefined ? [] : state.activeAutomationRunIds;
    const pidStates = [state.pid, state.workerPid, state.childPid].map(probePid);
    if (
      state.kind !== "AutomationKeepLiveState"
      || state.version !== 1
      || !plainObject(leases)
      || !Array.isArray(activeIds)
      || (state.activeRunCount !== undefined && !Number.isSafeInteger(state.activeRunCount))
      || (controlRead && !validLegacyKeepLiveStopControl(controlRead.value))
    ) {
      manualCodes.add("migration-keep-live-contract-invalid");
      continue;
    }
    if (pidStates.includes("unknown")) manualCodes.add("migration-keep-live-process-unknown");
    if (
      state.status !== "stopped"
      || Object.keys(leases).length > 0
      || activeIds.length > 0
      || (state.activeRunCount ?? 0) !== 0
      || state.active === true
      || state.workerActive === true
      || state.childActive === true
    ) drainCodes.add("migration-keep-live-lease-active");
    if (pidStates.includes("alive")) drainCodes.add("migration-keep-live-process-active");
    if (state.error !== undefined && state.error !== null && state.error !== "") {
      manualCodes.add("migration-keep-live-terminal-error");
    }
    facts.push({
      activeIdCount: activeIds.length,
      controlDigest: controlRead?.digest ?? null,
      leaseCount: Object.keys(leases).length,
      lockCount,
      pidStates,
      stateDigest: stateRead.digest,
      status: state.status,
    });
  }
  return finalizeDomain({
    artifact,
    domain: "keep-live",
    drainCodes,
    manualCodes,
    privateFacts: facts,
    sourceIds,
    subjectCount: facts.length,
    present: keepLiveRoots(workspaceRoot).length > 0 || sourceIds.length > 0,
  });
}

// 解析旧Markdown ledger中的真实表格行；正文说明不冒充pending branch。
function pendingMergeRows(bytes) {
  const textValue = strictUtf8(bytes);
  if (textValue === null) return null;
  if (!textValue.startsWith("# Pending Merges") || !textValue.includes("| Closed At | Demand | Repo | Branch | Window |")) {
    return null;
  }
  return textValue.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("|")
      && trimmed.endsWith("|")
      && !trimmed.includes("Closed At")
      && !/^\|(?:\s*:?-+:?\s*\|)+$/u.test(trimmed);
  }).length;
}

// stream域要求overlay/worktree/lock归零且pending merge已由旧branch owner处置。
function inspectStreamDomain({ workspaceRoot, inventory, artifact }) {
  const physicalSourceIds = new Set(inventory.sources.map((source) => source.sourceId));
  const overlaySourceIds = inventory.configSources
    .filter((entry) => entry.scope === "local-overlay" && physicalSourceIds.has(entry.sourceId))
    .map((entry) => entry.sourceId);
  const sourceIds = sortedUnique([
    ...sourceIdsFor(inventory, ["stream-worktree"]),
    ...overlaySourceIds,
  ]);
  const manualCodes = new Set();
  const drainCodes = new Set();
  addPhysicalBlockers(manualCodes, inventory, sourceIds);
  const facts = { overlayCount: overlaySourceIds.length, pendingMergeDigests: [], pendingRowCount: 0, worktreeCount: 0 };
  if (overlaySourceIds.length > 0) drainCodes.add("migration-stream-overlay-active");
  if (inspectPath(path.join(workspaceRoot, ".wakeflow-local/stream-overlay.lock")).exists) {
    drainCodes.add("migration-stream-lock-active");
  }
  const worktrees = listDirectory(path.join(workspaceRoot, ".wakeflow-local/worktrees"));
  if (!worktrees.ok) manualCodes.add("migration-stream-worktree-root-invalid");
  else {
    for (const entry of worktrees.entries) {
      if (entry.type !== "directory") manualCodes.add("migration-stream-worktree-invalid");
      else {
        facts.worktreeCount += 1;
        drainCodes.add("migration-stream-worktree-active");
      }
    }
  }
  const pendingSources = inventory.sources.filter((source) => (
    source.resource.kind === "stream-worktree"
    && typeof source.path === "string"
    && source.path.endsWith("pending-merges.md")
  ));
  for (const source of pendingSources) {
    const file = workspaceRef(workspaceRoot, source.path);
    if (!file) {
      manualCodes.add("migration-stream-pending-merge-unlocatable");
      continue;
    }
    const read = readRegularFile(file);
    const rows = read.ok ? pendingMergeRows(read.bytes) : null;
    if (!read.ok || rows === null) manualCodes.add("migration-stream-pending-merge-invalid");
    else {
      facts.pendingMergeDigests.push(read.digest);
      facts.pendingRowCount += rows;
      if (rows > 0) drainCodes.add("migration-stream-pending-merge");
    }
  }
  facts.pendingMergeDigests.sort(compareText);
  const subjectCount = facts.overlayCount + facts.pendingMergeDigests.length + facts.worktreeCount;
  return finalizeDomain({
    artifact,
    domain: "stream-worktree",
    drainCodes,
    manualCodes,
    privateFacts: facts,
    sourceIds,
    subjectCount,
    present: sourceIds.length > 0 || worktrees.exists,
  });
}

// ==================== 七、Pod与Test-access跨记录闭包 ====================

// 枚举host-owned Pod目录；host效果、locator与真实窗口撤销仍归T07。
function hostDirectories(workspaceRoot) {
  const hostsRoot = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/hosts");
  const listed = listDirectory(hostsRoot);
  if (!listed.ok) return { ok: false, roots: [] };
  return {
    ok: true,
    roots: listed.entries.filter((entry) => entry.type === "directory")
      .map((entry) => ({ host: entry.name, root: path.join(hostsRoot, entry.name) }))
      .sort((left, right) => compareText(left.host, right.host)),
  };
}

// 读取每个Pod的binding目录，拒绝混入未知entry或非目录Pod节点。
function readPodBindings(hostRoot, manualCodes) {
  const result = [];
  const pods = listDirectory(path.join(hostRoot, "pod-bindings"));
  if (!pods.ok) {
    if (pods.exists) manualCodes.add("migration-pod-binding-root-invalid");
    return result;
  }
  for (const pod of pods.entries) {
    if (pod.type !== "directory") {
      manualCodes.add("migration-pod-binding-root-invalid");
      continue;
    }
    result.push(...parseJsonDirectory(
      path.join(hostRoot, "pod-bindings", pod.name),
      manualCodes,
      "migration-pod-binding-invalid",
    ));
  }
  return result;
}

// close receipt允许confirmedAt观察时间不同，其余关闭事实必须完全相同。
function sameReceipt(left, right) {
  try {
    if (!plainObject(left) || !plainObject(right)) return false;
    const withoutObservationTime = (value) => Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "confirmedAt"),
    );
    return canonicalJson(withoutObservationTime(left)) === canonicalJson(withoutObservationTime(right));
  } catch {
    return false;
  }
}

// 校验legacy RFC3339 UTC时间并确认日历字段没有被Date归一化吞掉。
function strictLegacyTimestamp(value) {
  const match = typeof value === "string" ? LEGACY_TIMESTAMP_RE.exec(value) : null;
  if (!match) return false;
  const milliseconds = Date.parse(value);
  const instant = new Date(milliseconds);
  return Number.isFinite(milliseconds)
    && instant.getUTCFullYear() === Number(match[1])
    && instant.getUTCMonth() + 1 === Number(match[2])
    && instant.getUTCDate() === Number(match[3])
    && instant.getUTCHours() === Number(match[4])
    && instant.getUTCMinutes() === Number(match[5])
    && instant.getUTCSeconds() === Number(match[6]);
}

// 核对Test access plan/receipt的逐Product观察，并标记legacy identity覆盖完整度。
function inspectLegacyTestAccessReceipt(plan, receipt) {
  const targets = Array.isArray(plan.probeTargets) ? plan.probeTargets : [];
  const observations = Array.isArray(receipt.productAccess) ? receipt.productAccess : [];
  if (
    targets.length === 0
    || !strictLegacyTimestamp(receipt.observedAt)
    || (receipt.recordedAt !== undefined && !strictLegacyTimestamp(receipt.recordedAt))
  ) return { valid: false, legacyIdentityCoverage: null, recordedAt: null };
  const targetByBinding = new Map();
  for (const target of targets) {
    if (
      !plainObject(target)
      || typeof target.windowName !== "string"
      || typeof target.repositoryWindow !== "string"
      || typeof target.bindingId !== "string"
      || targetByBinding.has(target.bindingId)
      || !HEX_DIGEST_RE.test(target.expectedRootDigest ?? "")
      || !HEX_DIGEST_RE.test(target.expectedGitTopLevelDigest ?? "")
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(target.expectedHead ?? "")
    ) return { valid: false, legacyIdentityCoverage: null, recordedAt: null };
    targetByBinding.set(target.bindingId, target);
  }
  const observedBindings = new Set();
  let completeCommonDirCoverage = true;
  for (const observation of observations) {
    const target = plainObject(observation)
      ? targetByBinding.get(observation.bindingId)
      : null;
    if (
      !target
      || observedBindings.has(observation.bindingId)
      || observation.windowName !== target.windowName
      || observation.repositoryWindow !== target.repositoryWindow
      || observation.rootDigest !== target.expectedRootDigest
      || observation.gitTopLevelDigest !== target.expectedGitTopLevelDigest
      || observation.head !== target.expectedHead
      || ![true, false].includes(observation.readable)
      || ![true, false].includes(observation.gitIdentityVerified)
    ) return { valid: false, legacyIdentityCoverage: null, recordedAt: null };
    observedBindings.add(observation.bindingId);
    if (
      !HEX_DIGEST_RE.test(target.expectedGitCommonDirDigest ?? "")
      || observation.gitCommonDirDigest !== target.expectedGitCommonDirDigest
    ) completeCommonDirCoverage = false;
  }
  if (receipt.status === "validated") {
    if (
      receipt.capability !== "direct-multi-root"
      || Object.hasOwn(receipt, "reasonCode")
      || observations.length !== targets.length
      || observations.some((entry) => entry.readable !== true || entry.gitIdentityVerified !== true)
    ) return { valid: false, legacyIdentityCoverage: null, recordedAt: null };
  } else if (
    receipt.status !== "blocked"
    || !["unsupported", "per-repo-executor-unavailable"].includes(receipt.capability)
    || !LEGACY_TEST_ACCESS_BLOCK_REASONS.has(receipt.reasonCode)
  ) return { valid: false, legacyIdentityCoverage: null, recordedAt: null };
  return {
    valid: true,
    legacyIdentityCoverage: completeCommonDirCoverage && observations.length === targets.length
      ? "full"
      : "partial",
    recordedAt: receipt.recordedAt ?? null,
  };
}

// 聚合某demand参与portable import的exact source字节摘要。
function appendImportSourceDigests(sourceDigestsByDemand, demandKey, digests) {
  if (!sourceDigestsByDemand) return;
  const values = sourceDigestsByDemand.get(demandKey) ?? new Set();
  for (const entry of digests) values.add(entry);
  sourceDigestsByDemand.set(demandKey, values);
}

// 聚合某demand的T04物理source ID，不在此决定source处置。
function appendImportSourceIds(sourceIdsByDemand, demandKey, sourceIds) {
  if (!sourceIdsByDemand) return;
  const values = sourceIdsByDemand.get(demandKey) ?? new Set();
  for (const entry of sourceIds) values.add(entry);
  sourceIdsByDemand.set(demandKey, values);
}

// 每个import字节摘要必须唯一对应一个同domain物理source，重复或缺失均阻断。
function exactImportSourceIds({ inventory, resourceKind, sourceDigests, manualCodes, code }) {
  const result = [];
  for (const sourceDigest of [...new Set(sourceDigests)].sort(compareText)) {
    const matches = inventory.sources.filter((source) => (
      source.resource.kind === resourceKind
      && source.type === "file"
      && source.digest === sourceDigest
    ));
    if (matches.length !== 1) {
      manualCodes.add(code);
      continue;
    }
    result.push(matches[0].sourceId);
  }
  return sortedUnique(result);
}

// 追加已验证的Pod legacy evidence摘要及其原始source覆盖。
function appendPodImportFact(
  importFactsByDemand,
  demandKey,
  fact,
  sourceDigestsByDemand,
  sourceDigests,
) {
  if (!importFactsByDemand) return;
  const facts = importFactsByDemand.get(demandKey) ?? [];
  facts.push(fact);
  importFactsByDemand.set(demandKey, facts);
  appendImportSourceDigests(sourceDigestsByDemand, demandKey, sourceDigests);
}

// archived podProvisioning.windows必须与manifest的完整launch窗口集合逐项相等。
function archivedPodWindowsMatch(archive, manifest, launchByWindow) {
  if (!archive) return true;
  const provisioning = archive.state.podProvisioning;
  if (
    !plainObject(provisioning)
    || provisioning.phase !== "closed"
    || provisioning.podId !== manifest.podId
    || provisioning.host !== manifest.host
    || archive.state.executionPlacement?.podId !== manifest.podId
    || manifest.stateRootRelative !== archive.manifest.sourceStateRoot
    || !Array.isArray(provisioning.windows)
    || provisioning.windows.length !== launchByWindow.size
  ) return false;
  const seen = new Set();
  for (const window of provisioning.windows) {
    const launch = plainObject(window) ? launchByWindow.get(window.windowName) : null;
    const repositoryWindow = launch?.intent?.repositoryWindow ?? null;
    if (
      !launch
      || seen.has(window.windowName)
      || window.status !== "closed"
      || window.role !== launch.role
      || window.launchCorrelationId !== launch.operationId
      || (window.repositoryWindow ?? null) !== repositoryWindow
    ) return false;
    seen.add(window.windowName);
  }
  return seen.size === launchByWindow.size;
}

/**
 * 核验manifest、launch/close operation、binding/receipt、archive窗口和Test access。
 * 逻辑closed与物理资源撤销分轴：retained/unknown只形成T07 host follow-up，
 * 不把session/worktree已经消失写成T06业务事实。
 */
function inspectPodDomain({
  workspaceRoot,
  inventory,
  artifact,
  archives,
  active,
  importFactsByDemand = null,
  importSourceIdsByDemand = null,
}) {
  const sourceIds = sourceIdsFor(inventory, ["pod"]);
  const manualCodes = new Set();
  const drainCodes = new Set();
  const followCodes = new Set();
  const importSourceDigestsByDemand = importSourceIdsByDemand ? new Map() : null;
  addPhysicalBlockers(manualCodes, inventory, sourceIds);
  const hosts = hostDirectories(workspaceRoot);
  if (!hosts.ok) manualCodes.add("migration-pod-host-root-invalid");
  const manifests = [];
  const operations = [];
  const bindings = [];
  const testAccessPlans = [];
  const testAccessReceipts = [];
  let lockCount = 0;
  for (const host of hosts.roots) {
    manifests.push(...parseJsonDirectory(path.join(host.root, "pod-manifests"), manualCodes, "migration-pod-manifest-invalid"));
    operations.push(...parseJsonDirectory(path.join(host.root, "pod-operations"), manualCodes, "migration-pod-operation-invalid"));
    bindings.push(...readPodBindings(host.root, manualCodes));
    testAccessPlans.push(...parseJsonDirectory(path.join(host.root, "pod-test-access-plans"), manualCodes, "migration-pod-test-access-plan-invalid"));
    testAccessReceipts.push(...parseJsonDirectory(path.join(host.root, "pod-test-access-receipts"), manualCodes, "migration-pod-test-access-receipt-invalid"));
    for (const name of ["pod-operations.lock", "pod-bindings.lock", "pod-test-access.lock"]) {
      for (const candidate of [name, `${name}.guard`]) {
        const lock = inspectPath(path.join(host.root, candidate));
        if (!lock.exists) continue;
        if (lock.type !== "file") manualCodes.add("migration-pod-lock-invalid");
        else {
          lockCount += 1;
          drainCodes.add("migration-pod-lock-active");
        }
      }
    }
  }
  const manifestByPod = mapUnique(manifests, ({ value }) => `${value.host ?? ""}\0${value.podId ?? ""}`, manualCodes, "migration-pod-manifest-duplicate");
  const operationById = mapUnique(operations, ({ value }) => value.operationId, manualCodes, "migration-pod-operation-duplicate");
  const bindingByTuple = mapUnique(bindings, ({ value }) => `${value.host ?? ""}\0${value.podId ?? ""}\0${value.windowName ?? ""}`, manualCodes, "migration-pod-binding-duplicate");
  const testAccessPlanById = mapUnique(testAccessPlans, ({ value }) => value.probeId, manualCodes, "migration-pod-test-access-plan-duplicate");
  const testAccessReceiptById = mapUnique(testAccessReceipts, ({ value }) => value.probeId, manualCodes, "migration-pod-test-access-receipt-duplicate");
  const referencedOperations = new Set();
  const referencedBindings = new Set();
  const referencedTestAccessReceipts = new Set();

  for (const manifestRecord of manifests) {
    const manifest = manifestRecord.value;
    const key = `${manifest.host ?? ""}\0${manifest.podId ?? ""}`;
    if (manifestByPod.get(key) !== manifestRecord) continue;
    const closeOperationIds = manifest.closeOperationIds ?? [];
    if (
      manifest.kind !== "WakeflowHostManagedPodManifest"
      || manifest.version !== 1
      || typeof manifest.demandKey !== "string"
      || typeof manifest.podId !== "string"
      || typeof manifest.host !== "string"
      || !Array.isArray(manifest.operationIds)
      || !Array.isArray(closeOperationIds)
      || new Set(manifest.operationIds).size !== manifest.operationIds.length
      || new Set(closeOperationIds).size !== closeOperationIds.length
      || !legacyStateRootRefs(inventory, manifest.demandKey).has(manifest.stateRootRelative)
    ) {
      manualCodes.add("migration-pod-manifest-invalid");
      continue;
    }
    const archive = archives.archives.get(manifest.demandKey);
    if (!archive) {
      if (active.activeKeys.has(manifest.demandKey)) drainCodes.add("migration-pod-demand-not-archived");
      else manualCodes.add("migration-pod-archive-evidence-missing");
    }
    if (manifest.lastKnownPhase !== "closed") drainCodes.add("migration-pod-not-closed");
    if (archive && (
      archive.state.executionPlacement?.podId !== manifest.podId
      || archive.state.podProvisioning?.podId !== manifest.podId
      || archive.state.podProvisioning?.host !== manifest.host
      || archive.state.podProvisioning?.phase !== "closed"
      || manifest.stateRootRelative !== archive.manifest.sourceStateRoot
    )) manualCodes.add("migration-pod-archive-state-mismatch");

    const launchByWindow = new Map();
    const launchRecordByWindow = new Map();
    for (const operationId of manifest.operationIds) {
      referencedOperations.add(operationId);
      const operationRecord = operationById.get(operationId);
      const operation = operationRecord?.value;
      if (
        !operation
        || operation.kind !== "WakeflowHostPodOperation"
        || operation.version !== 1
        || operation.operationType !== "launch"
        || operation.status !== "bound"
        || operation.demandKey !== manifest.demandKey
        || operation.podId !== manifest.podId
        || operation.host !== manifest.host
        || typeof operation.windowName !== "string"
        || !operation.windowName
        || typeof operation.role !== "string"
        || !operation.role
        || !plainObject(operation.intent)
        || !HEX_DIGEST_RE.test(operation.intentDigest ?? "")
        || operation.intentDigest !== canonicalJsonDigestHex(operation.intent)
        || operation.intent.demandKey !== manifest.demandKey
        || operation.intent.podId !== manifest.podId
        || operation.intent.host !== manifest.host
        || operation.intent.windowName !== operation.windowName
        || operation.intent.role !== operation.role
        || operation.intent.launchCorrelationId !== operation.operationId
        || operation.intent.stateRootRelative !== manifest.stateRootRelative
        || typeof operation.intent.registrationBindingId !== "string"
        || !operation.intent.registrationBindingId
        || launchByWindow.has(operation.windowName)
      ) {
        manualCodes.add("migration-pod-launch-chain-invalid");
        continue;
      }
      launchByWindow.set(operation.windowName, operation);
      launchRecordByWindow.set(operation.windowName, operationRecord);
    }
    const closeByWindow = new Map();
    const closeRecordByWindow = new Map();
    for (const operationId of closeOperationIds) {
      referencedOperations.add(operationId);
      const operationRecord = operationById.get(operationId);
      const operation = operationRecord?.value;
      const launch = launchByWindow.get(operation?.windowName);
      if (
        !operation
        || !launch
        || operation.kind !== "WakeflowHostPodOperation"
        || operation.version !== 1
        || operation.operationType !== "close"
        || (manifest.lastKnownPhase === "closed"
          ? operation.status !== "closed"
          : !["planned", "closed"].includes(operation.status))
        || operation.demandKey !== manifest.demandKey
        || operation.podId !== manifest.podId
        || operation.host !== manifest.host
        || typeof operation.windowName !== "string"
        || operation.role !== launch.role
        || !plainObject(operation.intent)
        || operation.intent.demandKey !== manifest.demandKey
        || operation.intent.podId !== manifest.podId
        || operation.intent.host !== manifest.host
        || operation.intent.launchCorrelationId !== launch.operationId
        || operation.intent.bindingId !== launch.bindingId
        || operation.intent.windowName !== launch.windowName
        || operation.intent.role !== launch.role
        || !HEX_DIGEST_RE.test(operation.intentDigest ?? "")
        || operation.intentDigest !== canonicalJsonDigestHex(operation.intent)
        || !plainObject(operation.receipt)
        || !HEX_DIGEST_RE.test(operation.receiptDigest ?? "")
        || operation.receiptDigest !== canonicalJsonDigestHex(operation.receipt)
        || operation.receipt?.closeCorrelationId !== operation.operationId
        || operation.receipt?.bindingId !== operation.intent.bindingId
        || operation.receipt?.windowName !== operation.windowName
        || operation.receipt?.host !== operation.host
        || closeByWindow.has(operation.windowName)
      ) {
        manualCodes.add("migration-pod-close-chain-invalid");
        continue;
      }
      closeByWindow.set(operation.windowName, operation);
      closeRecordByWindow.set(operation.windowName, operationRecord);
    }
    if (
      launchByWindow.size === 0
      || closeByWindow.size > launchByWindow.size
      || [...closeByWindow.keys()].some((windowName) => !launchByWindow.has(windowName))
      || (manifest.lastKnownPhase === "closed" && (
        launchByWindow.size !== closeByWindow.size
        || manifest.operationIds.length !== closeOperationIds.length
      ))
    ) manualCodes.add("migration-pod-window-coverage-invalid");
    if (!archivedPodWindowsMatch(archive, manifest, launchByWindow)) {
      manualCodes.add("migration-pod-archive-state-mismatch");
    }

    const bindingRecordByWindow = new Map();
    let resourceFollowupRequired = false;
    for (const [windowName, launch] of launchByWindow) {
      const bindingKey = `${manifest.host}\0${manifest.podId}\0${windowName}`;
      const bindingRecord = bindingByTuple.get(bindingKey);
      const binding = bindingRecord?.value;
      const close = closeByWindow.get(windowName);
      const baseBindingValid = (
        binding
        && binding.kind === "WakeflowHostPodBinding"
        && binding.version === 1
        && binding.demandKey === manifest.demandKey
        && binding.podId === manifest.podId
        && binding.host === manifest.host
        && binding.windowName === windowName
        && binding.role === launch.role
        && (binding.repositoryWindow ?? null) === (launch.intent.repositoryWindow ?? null)
        && binding.launchCorrelationId === launch.operationId
        && binding.bindingId === launch.bindingId
        && binding.receiptDigest === launch.receiptDigest
        && plainObject(binding.receipt)
        && HEX_DIGEST_RE.test(binding.receiptDigest ?? "")
        && binding.receiptDigest === canonicalJsonDigestHex(binding.receipt)
        && binding.receipt.launchCorrelationId === launch.operationId
        && binding.receipt.windowName === windowName
        && binding.receipt.host === manifest.host
        && binding.receipt.bindingId === binding.bindingId
        && binding.receipt.stateRootRelative === manifest.stateRootRelative
        && binding.receipt.handleRegistered === true
        && binding.receipt.handleKind === "final"
        && (binding.role !== "product" || (
          binding.receipt.actualCwd === binding.receipt.gitTopLevel
          && binding.receipt.mainCheckout === false
          && binding.receipt.head === launch.intent.expectedBaseHead
        ))
      );
      if (manifest.lastKnownPhase !== "closed") {
        if (!baseBindingValid || !["active", "closed"].includes(binding.status)) {
          manualCodes.add("migration-pod-binding-lifecycle-invalid");
          continue;
        }
        referencedBindings.add(bindingKey);
        if (binding.status === "closed" && (
          !close
          || close.status !== "closed"
          || close.intent?.launchCorrelationId !== launch.operationId
          || close.intent?.bindingId !== binding.bindingId
          || close.receipt?.bindingId !== binding.bindingId
          || binding.closeReceipt?.bindingId !== binding.bindingId
          || !sameReceipt(close.receipt, binding.closeReceipt)
        )) manualCodes.add("migration-pod-binding-close-chain-invalid");
        continue;
      }
      if (!baseBindingValid) {
        manualCodes.add("migration-pod-binding-lifecycle-invalid");
        continue;
      }
      if (
        !close
        || binding.status !== "closed"
        || close.intent?.launchCorrelationId !== launch.operationId
        || close.intent?.bindingId !== binding.bindingId
        || close.receipt?.bindingId !== binding.bindingId
        || binding.closeReceipt?.bindingId !== binding.bindingId
        || close.receipt?.closeCorrelationId !== close.operationId
        || binding.closeReceipt?.closeCorrelationId !== close.operationId
        || !sameReceipt(close.receipt, binding.closeReceipt)
      ) {
        manualCodes.add("migration-pod-binding-close-chain-invalid");
        continue;
      }
      referencedBindings.add(bindingKey);
      bindingRecordByWindow.set(windowName, bindingRecord);
      const sessionStatus = binding.closeReceipt.sessionStatus;
      const worktreeStatus = binding.closeReceipt.worktreeStatus;
      if (sessionStatus === "handed-off") {
        followCodes.add("migration-pod-host-resource-followup-required");
        resourceFollowupRequired = true;
      } else if (!["archived", "closed", "not-found"].includes(sessionStatus)) {
        manualCodes.add("migration-pod-session-status-invalid");
      }
      if (["retained", "unknown"].includes(worktreeStatus)) {
        followCodes.add("migration-pod-host-resource-followup-required");
        resourceFollowupRequired = true;
      } else if (!["removed", "not-applicable"].includes(worktreeStatus)) {
        manualCodes.add("migration-pod-worktree-status-invalid");
      }
    }
    if (
      importFactsByDemand
      && manifest.lastKnownPhase === "closed"
      && launchRecordByWindow.size > 0
      && launchRecordByWindow.size === closeRecordByWindow.size
      && launchRecordByWindow.size === bindingRecordByWindow.size
    ) {
      const launchOperationDigests = [...launchRecordByWindow.values()]
        .map((entry) => entry.digest)
        .sort(compareText);
      const closeOperationDigests = [...closeRecordByWindow.values()]
        .map((entry) => entry.digest)
        .sort(compareText);
      const bindingDigests = [...bindingRecordByWindow.values()]
        .map((entry) => entry.digest)
        .sort(compareText);
      const materializationSource = {
        bindingDigests,
        launchOperationDigests,
        manifestDigest: manifestRecord.digest,
      };
      appendPodImportFact(importFactsByDemand, manifest.demandKey, {
        summarySchemaVersion: 1,
        sourceKind: "pod-close",
        sourceDigest: canonicalJsonDigest({
          bindingDigests,
          closeOperationDigests,
          manifestDigest: manifestRecord.digest,
        }),
        outcome: "verified-closed-archived",
        coverage: resourceFollowupRequired
          ? ["binding-correlation", "close-chain", "state-membership"]
          : [
              "binding-correlation",
              "close-chain",
              "host-resource-closure",
              "state-membership",
            ],
        artifactCount: 1 + closeOperationDigests.length + bindingDigests.length,
        details: {
          kind: "pod-close",
          podCount: 1,
          manifestCount: 1,
          closeOperationCount: closeOperationDigests.length,
          closedBindingCount: bindingDigests.length,
          resourceCoverage: resourceFollowupRequired ? "host-followup" : "complete",
        },
      }, importSourceDigestsByDemand, [
        manifestRecord.digest,
        ...closeOperationDigests,
        ...bindingDigests,
      ]);
      appendPodImportFact(importFactsByDemand, manifest.demandKey, {
        summarySchemaVersion: 1,
        sourceKind: "pod-materialization",
        sourceDigest: canonicalJsonDigest(materializationSource),
        outcome: "verified-closed-archived",
        coverage: ["binding-correlation", "launch-chain", "state-membership"],
        artifactCount: 1 + launchOperationDigests.length + bindingDigests.length,
        details: {
          kind: "pod-materialization",
          podCount: 1,
          manifestCount: 1,
          launchOperationCount: launchOperationDigests.length,
          boundWindowCount: bindingDigests.length,
          latestPhase: "closed",
          historyComplete: false,
        },
      }, importSourceDigestsByDemand, [
        manifestRecord.digest,
        ...launchOperationDigests,
        ...bindingDigests,
      ]);
    }
  }
  for (const planRecord of testAccessPlanById.values()) {
    const plan = planRecord.value;
    const { planDigest, ...planBase } = plan;
    const manifest = manifestByPod.get(`${plan.host ?? ""}\0${plan.podId ?? ""}`)?.value;
    const receiptRecord = testAccessReceiptById.get(plan.probeId) ?? null;
    const receipt = receiptRecord?.value ?? null;
    const archive = archives.archives.get(plan.demandKey);
    const stateAccess = archive?.state.podProvisioning?.testAccess ?? null;
    const targets = Array.isArray(plan.probeTargets) ? plan.probeTargets : [];
    const targetBindingIds = new Set();
    const targetBindings = [];
    let targetBindingsValid = targets.length > 0;
    for (const target of targets) {
      const bindingRecord = plainObject(target)
        ? bindingByTuple.get(`${plan.host}\0${plan.podId}\0${target.windowName}`)
        : null;
      const binding = bindingRecord?.value;
      if (
        !plainObject(target)
        || typeof target.windowName !== "string"
        || typeof target.repositoryWindow !== "string"
        || typeof target.bindingId !== "string"
        || targetBindingIds.has(target.bindingId)
        || binding?.bindingId !== target.bindingId
        || binding.role !== "product"
        || binding.repositoryWindow !== target.repositoryWindow
        || binding.receiptDigest !== target.receiptDigest
        || binding.receipt?.actualCwd !== target.actualRoot
        || target.expectedRootDigest !== canonicalJsonDigestHex({
          kind: "pod-product-root",
          value: binding.receipt?.actualCwd,
        })
        || target.expectedGitTopLevelDigest !== canonicalJsonDigestHex({
          kind: "pod-product-git-top-level",
          value: binding.receipt?.gitTopLevel,
        })
        || target.expectedHead !== binding.receipt?.head
      ) {
        targetBindingsValid = false;
        continue;
      }
      targetBindingIds.add(target.bindingId);
      targetBindings.push(binding);
    }
    targetBindings.sort((left, right) => compareText(left.repositoryWindow, right.repositoryWindow));
    const testBinding = bindingByTuple.get(
      `${plan.host ?? ""}\0${plan.podId ?? ""}\0${plan.testWindowName ?? ""}`,
    )?.value ?? null;
    const expectedBindingSetDigest = testBinding && targetBindingsValid
      ? canonicalJsonDigestHex({
          test: {
            windowName: testBinding.windowName,
            bindingId: testBinding.bindingId,
            receiptDigest: testBinding.receiptDigest,
          },
          products: targetBindings.map((binding) => ({
            windowName: binding.windowName,
            repositoryWindow: binding.repositoryWindow,
            bindingId: binding.bindingId,
            receiptDigest: binding.receiptDigest,
          })),
        })
      : null;
    const planValid = (
      plan.kind === "WakeflowPodTestAccessProbePlan"
      && plan.version === 1
      && typeof plan.probeId === "string"
      && plan.probeId
      && typeof plan.demandKey === "string"
      && plan.demandKey
      && typeof plan.podId === "string"
      && plan.podId
      && typeof plan.host === "string"
      && plan.host
      && typeof plan.testWindowName === "string"
      && typeof plan.testBindingId === "string"
      && HEX_DIGEST_RE.test(plan.bindingSetDigest ?? "")
      && HEX_DIGEST_RE.test(planDigest ?? "")
      && planDigest === canonicalJsonDigestHex(planBase)
      && plan.capabilityUnderTest === "direct-multi-root"
      && targetBindingsValid
      && targetBindings.length === targets.length
      && plan.bindingSetDigest === expectedBindingSetDigest
      && testBinding?.bindingId === plan.testBindingId
      && testBinding.role === "test"
      && manifest?.demandKey === plan.demandKey
    );
    if (!planValid) {
      manualCodes.add("migration-pod-test-access-plan-invalid");
      continue;
    }
    if (!receipt) {
      if (stateAccess?.status === "pending" || !archive) {
        drainCodes.add("migration-pod-test-access-pending");
      } else {
        manualCodes.add("migration-pod-test-access-receipt-missing");
      }
      continue;
    }
    referencedTestAccessReceipts.add(plan.probeId);
    const receiptInspection = inspectLegacyTestAccessReceipt(plan, receipt);
    const receiptValid = (
      receipt.kind === "WakeflowPodTestAccessProbeReceipt"
      && receipt.version === 1
      && receipt.probeId === plan.probeId
      && receipt.demandKey === plan.demandKey
      && receipt.podId === plan.podId
      && receipt.host === plan.host
      && receipt.testWindowName === plan.testWindowName
      && receipt.testBindingId === plan.testBindingId
      && receipt.bindingSetDigest === plan.bindingSetDigest
      && receipt.planDigest === plan.planDigest
      && ["validated", "blocked"].includes(receipt.status)
      && ["direct-multi-root", "unsupported", "per-repo-executor-unavailable"].includes(receipt.capability)
      && Array.isArray(receipt.productAccess)
      && receiptInspection.valid
      && stateAccess?.probeId === plan.probeId
      && stateAccess.status === receipt.status
      && stateAccess.capability === receipt.capability
      && stateAccess.bindingSetDigest === plan.bindingSetDigest
      && stateAccess.planDigest === plan.planDigest
      && stateAccess.productBindingCount === targets.length
      && stateAccess.receiptDigest === canonicalJsonDigestHex(receipt)
      && (receipt.status !== "blocked" || stateAccess.reasonCode === receipt.reasonCode)
      && (receipt.status !== "validated" || stateAccess.validatedAt === receipt.observedAt)
    );
    if (!receiptValid) {
      manualCodes.add("migration-pod-test-access-receipt-invalid");
    } else if (importFactsByDemand) {
      const coverage = [
        "binding-correlation",
        "close-chain",
        "observed-time",
        "plan-receipt-pair",
        ...(receiptInspection.recordedAt === null ? [] : ["recorded-time"]),
        "state-membership",
      ].sort(compareText);
      appendPodImportFact(importFactsByDemand, plan.demandKey, {
        summarySchemaVersion: 1,
        sourceKind: "pod-test-access",
        sourceDigest: canonicalJsonDigest({
          planDigest: planRecord.digest,
          receiptDigest: receiptRecord.digest,
        }),
        outcome: "verified-closed-archived",
        coverage,
        artifactCount: 2,
        details: {
          kind: "pod-test-access",
          probeType: "direct-multi-root",
          probeOutcome: receipt.status,
          ...(receipt.status === "blocked" ? { reasonCode: receipt.reasonCode } : {}),
          targetCount: targets.length,
          planDigest: planRecord.digest,
          receiptDigest: receiptRecord.digest,
          legacyIdentityCoverage: receiptInspection.legacyIdentityCoverage,
          observedAt: receipt.observedAt,
          recordedAt: receiptInspection.recordedAt,
        },
      }, importSourceDigestsByDemand, [planRecord.digest, receiptRecord.digest]);
    }
  }
  for (const receiptId of testAccessReceiptById.keys()) {
    if (!referencedTestAccessReceipts.has(receiptId)) {
      manualCodes.add("migration-pod-test-access-receipt-orphan");
    }
  }
  for (const manifestRecord of manifestByPod.values()) {
    const manifest = manifestRecord.value;
    const stateAccess = archives.archives.get(manifest.demandKey)?.state.podProvisioning?.testAccess;
    if (stateAccess && !testAccessPlanById.has(stateAccess.probeId)) {
      manualCodes.add("migration-pod-test-access-plan-missing");
    }
  }
  for (const operationId of operationById.keys()) if (!referencedOperations.has(operationId)) manualCodes.add("migration-pod-operation-orphan");
  for (const bindingKey of bindingByTuple.keys()) if (!referencedBindings.has(bindingKey)) manualCodes.add("migration-pod-binding-orphan");
  if (manifests.length === 0 && sourceIds.length > 0) {
    const nonContainerPodSource = inventory.sources.some((source) => (
      sourceIds.includes(source.sourceId) && source.type === "file"
    ));
    if (nonContainerPodSource) manualCodes.add("migration-pod-source-unrecognized");
  }
  for (const [demandKey, sourceDigests] of importSourceDigestsByDemand ?? []) {
    appendImportSourceIds(importSourceIdsByDemand, demandKey, exactImportSourceIds({
      inventory,
      resourceKind: "pod",
      sourceDigests: [...sourceDigests],
      manualCodes,
      code: "migration-pod-import-source-ambiguous",
    }));
  }
  return finalizeDomain({
    artifact,
    domain: "pod",
    drainCodes,
    followCodes,
    manualCodes,
    privateFacts: {
      bindingDigests: bindings.map((entry) => entry.digest).sort(compareText),
      manifestDigests: manifests.map((entry) => entry.digest).sort(compareText),
      operationDigests: operations.map((entry) => entry.digest).sort(compareText),
      testAccessPlanDigests: testAccessPlans.map((entry) => entry.digest).sort(compareText),
      testAccessReceiptDigests: testAccessReceipts.map((entry) => entry.digest).sort(compareText),
      lockCount,
    },
    sourceIds,
    subjectCount: manifests.length + operations.length + bindings.length + testAccessPlans.length + testAccessReceipts.length + lockCount,
    present: manifests.length > 0 || operations.length > 0 || bindings.length > 0 || testAccessPlans.length > 0 || testAccessReceipts.length > 0 || lockCount > 0 || sourceIds.length > 0,
  });
}

// ==================== 八、portable assessment与archive-import inventory组合 ====================

// 从五个领域状态重算唯一全局summary；follow-up不等于owner drain失败。
function summaryFor(domains) {
  const manualRecoveryCount = domains.filter((entry) => entry.status === "manual-recovery").length;
  const drainRequiredCount = domains.filter((entry) => entry.status === "drain-required").length;
  const hostFollowupCount = domains.filter((entry) => entry.status === "drained-with-host-followup").length;
  const ownerDrainSatisfied = manualRecoveryCount === 0 && drainRequiredCount === 0;
  const status = manualRecoveryCount > 0
    ? "manual-recovery"
    : drainRequiredCount > 0
      ? "drain-required"
      : hostFollowupCount > 0
        ? "drained-with-host-followup"
        : "drained";
  return {
    domainCount: domains.length,
    drainRequiredCount,
    hostFollowupCount,
    manualRecoveryCount,
    ownerDrainSatisfied,
    status,
  };
}

// 将一个archive根精确关联到T04唯一directory source，不接受路径猜测或多候选。
function archiveImportSource(inventory, workspaceRoot, archiveRoot) {
  const relative = path.relative(workspaceRoot, archiveRoot).split(path.sep).join("/");
  if (!relative || relative.startsWith("../") || path.posix.isAbsolute(relative)) return null;
  const candidates = inventory.sources.filter((source) => (
    source.path === relative
    && source.type === "directory"
    && typeof source.digest === "string"
    && DIGEST_RE.test(source.digest)
  ));
  return candidates.length === 1 ? candidates[0] : null;
}

// 为没有旧transport材料的archive生成可验证的显式absent事实。
function emptyTransportImportFact() {
  const selected = Object.fromEntries(
    ARCHIVE_IMPORT_TRANSPORT_DIGEST_FIELDS.map((field) => [field, []]),
  );
  const inventoryDigest = canonicalJsonDigest(selected);
  return {
    ...selected,
    inventoryDigest,
    sourceDigest: canonicalJsonDigest({ inventoryDigest, sourceStatus: "absent" }),
    sourceStatus: "absent",
  };
}

// 仅在全部业务domain已drain后组合每个archive的source/digest/evidence inventory。
function buildArchiveImportInventory({
  workspaceRoot,
  artifact,
  inventory,
  archives,
  assessment,
  podImportFacts,
  transportImportFacts,
  importSourceIdsByDemand,
}) {
  if (!assessment.summary.ownerDrainSatisfied) {
    return { code: "owner-drain-incomplete", inventory: null };
  }
  const demands = [];
  for (const [demandKey, archive] of [...archives.archives].sort(([left], [right]) => compareText(left, right))) {
    const source = archiveImportSource(inventory, workspaceRoot, archive.archiveRoot);
    if (!source) return { code: "archive-source-unresolved", inventory: null };
    const legacyEvidenceFacts = [...(podImportFacts.get(demandKey) ?? [])]
      .sort((left, right) => compareText(
        `${left.sourceKind}\0${left.sourceDigest}`,
        `${right.sourceKind}\0${right.sourceDigest}`,
      ));
    try {
      for (const fact of legacyEvidenceFacts) validateWakeflowLegacyEvidenceFact(fact);
    } catch {
      return { code: "legacy-evidence-invalid", inventory: null };
    }
    const transport = transportImportFacts.get(demandKey) ?? emptyTransportImportFact();
    const sourceIds = sortedUnique([
      source.sourceId,
      ...(importSourceIdsByDemand.get(demandKey) ?? []),
    ]);
    const archiveImportId = canonicalJsonDigest({
      archiveEvidenceDigest: archive.evidenceDigest,
      archiveSourceId: source.sourceId,
      archiveTreeDigest: source.digest,
    });
    demands.push({
      archiveImportId,
      archive: {
        archiveEvidenceDigest: archive.evidenceDigest,
        archiveSourceId: source.sourceId,
        archiveTreeDigest: source.digest,
        eventsDigest: archive.eventsDigest,
        manifestDigest: archive.manifestDigest,
        resultDigests: archive.resultDigests,
        stateDigest: archive.stateDigest,
      },
      legacyEvidenceFacts,
      sourceIds,
      transport,
    });
  }
  demands.sort((left, right) => compareText(left.archiveImportId, right.archiveImportId));
  const payload = {
    artifactKind: WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_KIND,
    demands,
    legacyOwnerArtifactDigest: artifact.artifactDigest,
    migrationInventoryDigest: inventory.inventoryDigest,
    ownerDrainAssessmentDigest: assessment.assessmentDigest,
    schemaVersion: WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_SCHEMA_VERSION,
  };
  return {
    code: null,
    inventory: { ...payload, inventoryDigest: canonicalJsonDigest(payload) },
  };
}

/**
 * 完成一次独立全量观察：T04 inventory、archive/active及五领域均来自同一轮读取。
 * includeArchiveImport只增加已验证摘要组合，不改变领域识别和workspace字节。
 */
function buildObservationOnce({ workspaceRoot, artifact, includeArchiveImport = false }) {
  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot });
  const archives = inspectArchiveRoot(workspaceRoot, inventory);
  const active = activeDemandFacts(workspaceRoot, inventory);
  const podImportFacts = includeArchiveImport ? new Map() : null;
  const transportImportFacts = includeArchiveImport ? new Map() : null;
  const importSourceIdsByDemand = includeArchiveImport ? new Map() : null;
  const domains = [
    inspectDemandDomain({ workspaceRoot, inventory, artifact, archives, active }),
    inspectKeepLiveDomain({ workspaceRoot, inventory, artifact }),
    inspectPodDomain({
      workspaceRoot,
      inventory,
      artifact,
      archives,
      active,
      importFactsByDemand: podImportFacts,
      importSourceIdsByDemand,
    }),
    inspectStreamDomain({ workspaceRoot, inventory, artifact }),
    inspectTransportDomain({
      workspaceRoot,
      inventory,
      artifact,
      archives,
      active,
      importFactsByDemand: transportImportFacts,
      importSourceIdsByDemand,
    }),
  ].sort((left, right) => compareText(left.domain, right.domain));
  const summary = summaryFor(domains);
  const payload = {
    artifactKind: WAKEFLOW_LEGACY_OWNER_DRAIN_KIND,
    artifact: {
      legacyOwnerArtifactDigest: artifact.artifactDigest,
    },
    domains,
    inventory: {
      inventoryDigest: inventory.inventoryDigest,
      sourceCount: inventory.sources.length,
    },
    schemaVersion: WAKEFLOW_LEGACY_OWNER_DRAIN_SCHEMA_VERSION,
    summary,
  };
  const assessment = { ...payload, assessmentDigest: canonicalJsonDigest(payload) };
  return {
    assessment,
    archiveImport: includeArchiveImport
      ? buildArchiveImportInventory({
          workspaceRoot,
          artifact,
          inventory,
          archives,
          assessment,
          podImportFacts,
          transportImportFacts,
          importSourceIdsByDemand,
        })
      : null,
  };
}

// assessment入口的单轮投影，供外层双观察比较。
function buildAssessmentOnce({ workspaceRoot, artifact }) {
  return buildObservationOnce({ workspaceRoot, artifact }).assessment;
}

// ==================== 九、standalone codec与公共只读入口 ====================

// 校验portable字符串数组唯一且按code-unit排序。
function validateStringArray(value, errorPath) {
  const entries = denseArray(value, errorPath).map((entry, index) => text(entry, `${errorPath}/${index}`));
  const expected = [...entries].sort(compareText);
  if (new Set(entries).size !== entries.length || canonicalJson(entries) !== canonicalJson(expected)) {
    fail("wakeflow-legacy-owner-drain-contract", "array must be unique and lexically ordered", { errorPath });
  }
  return entries;
}

/**
 * 验证assessment字段、领域顺序、状态/blocker关系、summary和总摘要。
 * 该codec无法从脱敏payload反演隐藏的filesystem/process事实，因此不承担来源认证。
 */
function validateAssessment(value) {
  const assessment = canonicalClone(value, "legacy owner drain assessment");
  exactObject(assessment, [
    "artifactKind",
    "artifact",
    "assessmentDigest",
    "domains",
    "inventory",
    "schemaVersion",
    "summary",
  ], "$", "wakeflow-legacy-owner-drain-contract");
  if (
    assessment.artifactKind !== WAKEFLOW_LEGACY_OWNER_DRAIN_KIND
    || assessment.schemaVersion !== WAKEFLOW_LEGACY_OWNER_DRAIN_SCHEMA_VERSION
  ) fail("wakeflow-legacy-owner-drain-contract", "assessment identity is invalid");
  exactObject(assessment.artifact, ["legacyOwnerArtifactDigest"], "$/artifact");
  digest(assessment.artifact.legacyOwnerArtifactDigest, "$/artifact/legacyOwnerArtifactDigest");
  exactObject(assessment.inventory, ["inventoryDigest", "sourceCount"], "$/inventory");
  digest(assessment.inventory.inventoryDigest, "$/inventory/inventoryDigest");
  nonNegativeInteger(assessment.inventory.sourceCount, "$/inventory/sourceCount");
  const domains = denseArray(assessment.domains, "$/domains");
  if (domains.length !== DOMAIN_NAMES.length) fail("wakeflow-legacy-owner-drain-domain", "assessment must cover every closed drain domain", { errorPath: "$/domains" });
  const names = [];
  for (const [index, domain] of domains.entries()) {
    const at = `$/domains/${index}`;
    exactObject(domain, [
      "blockerCodes",
      "capabilityDigest",
      "domain",
      "evidenceDigest",
      "owner",
      "ownerActions",
      "sourceIds",
      "status",
      "subjectCount",
    ], at);
    const definition = DOMAIN_BY_NAME.get(domain.domain);
    if (!definition || domain.owner !== definition.owner || canonicalJson(domain.ownerActions) !== canonicalJson(definition.ownerActions)) {
      fail("wakeflow-legacy-owner-drain-domain", "domain owner contract is invalid", { errorPath: at });
    }
    names.push(domain.domain);
    digest(domain.capabilityDigest, `${at}/capabilityDigest`);
    digest(domain.evidenceDigest, `${at}/evidenceDigest`);
    nonNegativeInteger(domain.subjectCount, `${at}/subjectCount`);
    const blockers = validateStringArray(domain.blockerCodes, `${at}/blockerCodes`);
    const sourceIds = validateStringArray(domain.sourceIds, `${at}/sourceIds`);
    sourceIds.forEach((sourceId, sourceIndex) => digest(sourceId, `${at}/sourceIds/${sourceIndex}`));
    if (!STATUS_SET.has(domain.status)) fail("wakeflow-legacy-owner-drain-domain", "domain status is invalid", { errorPath: `${at}/status` });
    if (domain.status === "absent" && domain.subjectCount !== 0) {
      fail("wakeflow-legacy-owner-drain-domain", "absent domain cannot contain subjects", { errorPath: at });
    }
    if (["absent", "drained"].includes(domain.status) && blockers.length !== 0) {
      fail("wakeflow-legacy-owner-drain-domain", "closed domain cannot contain blockers", { errorPath: `${at}/blockerCodes` });
    }
    if (["drain-required", "manual-recovery", "drained-with-host-followup"].includes(domain.status) && blockers.length === 0) {
      fail("wakeflow-legacy-owner-drain-domain", "nonclosed domain status needs an explicit blocker", { errorPath: `${at}/blockerCodes` });
    }
    if (domain.status === "drained-with-host-followup" && domain.domain !== "pod") {
      fail("wakeflow-legacy-owner-drain-domain", "only Pod may transfer physical cleanup to the host seam", { errorPath: `${at}/status` });
    }
  }
  const expectedNames = [...DOMAIN_NAMES].sort(compareText);
  if (canonicalJson(names) !== canonicalJson(expectedNames)) {
    fail("wakeflow-legacy-owner-drain-domain", "domains must be unique and lexically ordered", { errorPath: "$/domains" });
  }
  exactObject(assessment.summary, [
    "domainCount",
    "drainRequiredCount",
    "hostFollowupCount",
    "manualRecoveryCount",
    "ownerDrainSatisfied",
    "status",
  ], "$/summary");
  const expectedSummary = summaryFor(domains);
  if (canonicalJson(expectedSummary) !== canonicalJson(assessment.summary)) {
    fail("wakeflow-legacy-owner-drain-summary", "summary differs from exact domain statuses", { errorPath: "$/summary" });
  }
  const unsigned = {
    artifactKind: assessment.artifactKind,
    artifact: assessment.artifact,
    domains: assessment.domains,
    inventory: assessment.inventory,
    schemaVersion: assessment.schemaVersion,
    summary: assessment.summary,
  };
  if (digest(assessment.assessmentDigest, "$/assessmentDigest") !== canonicalJsonDigest(unsigned)) {
    fail("wakeflow-legacy-owner-drain-digest", "assessmentDigest differs from the complete canonical payload", { errorPath: "$/assessmentDigest" });
  }
  if (PRIVATE_OUTPUT_RE.test(canonicalJson(assessment))) {
    fail("wakeflow-legacy-owner-drain-privacy", "assessment contains a machine-private absolute path");
  }
  return deepFreeze(assessment);
}

// 验证某archive的旧transport digest集合及absent/archived基数关系。
function validateArchiveImportTransport(value, errorPath) {
  exactObject(value, [
    ...ARCHIVE_IMPORT_TRANSPORT_DIGEST_FIELDS,
    "inventoryDigest",
    "sourceDigest",
    "sourceStatus",
  ], errorPath, "wakeflow-legacy-owner-drain-import-contract");
  if (!new Set(["absent", "archived"]).has(value.sourceStatus)) {
    fail("wakeflow-legacy-owner-drain-import-contract", "archive import transport status is invalid", {
      errorPath: `${errorPath}/sourceStatus`,
    });
  }
  const selected = {};
  let recordCount = 0;
  for (const field of ARCHIVE_IMPORT_TRANSPORT_DIGEST_FIELDS) {
    const entries = validateStringArray(value[field], `${errorPath}/${field}`);
    entries.forEach((entry, index) => digest(entry, `${errorPath}/${field}/${index}`));
    selected[field] = entries;
    recordCount += entries.length;
  }
  const inventoryDigest = digest(value.inventoryDigest, `${errorPath}/inventoryDigest`);
  if (inventoryDigest !== canonicalJsonDigest(selected)) {
    fail("wakeflow-legacy-owner-drain-import-digest", "archive import transport inventory digest differs from its exact digest sets", {
      errorPath: `${errorPath}/inventoryDigest`,
    });
  }
  const sourceDigest = digest(value.sourceDigest, `${errorPath}/sourceDigest`);
  if (sourceDigest !== canonicalJsonDigest({ inventoryDigest, sourceStatus: value.sourceStatus })) {
    fail("wakeflow-legacy-owner-drain-import-digest", "archive import transport source digest differs from its exact inventory", {
      errorPath: `${errorPath}/sourceDigest`,
    });
  }
  if (
    (value.sourceStatus === "absent" && recordCount !== 0)
    || (value.sourceStatus === "archived" && recordCount === 0)
  ) {
    fail("wakeflow-legacy-owner-drain-import-contract", "archive import transport status and record count differ", {
      errorPath,
    });
  }
}

// 验证脱敏archive-import inventory、source覆盖、legacy fact及完整总摘要。
function validateArchiveImportInventory(value) {
  const inventory = canonicalClone(value, "legacy archive import inventory");
  const encoded = canonicalJson(inventory);
  if (
    PRIVATE_OUTPUT_RE.test(encoded)
    || /"(?:actualRoot|argv|cwd|demandKey|fileNames|files|handle|path|pid|prompt|rawHandle|repositoryWindow|rootDigest|session|threadId|windowName)"\s*:/u.test(encoded)
  ) {
    fail("wakeflow-legacy-owner-drain-import-privacy", "archive import inventory contains a forbidden private or semantic field");
  }
  exactObject(inventory, [
    "artifactKind",
    "demands",
    "inventoryDigest",
    "legacyOwnerArtifactDigest",
    "migrationInventoryDigest",
    "ownerDrainAssessmentDigest",
    "schemaVersion",
  ], "$", "wakeflow-legacy-owner-drain-import-contract");
  if (
    inventory.artifactKind !== WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_KIND
    || inventory.schemaVersion !== WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_SCHEMA_VERSION
  ) fail("wakeflow-legacy-owner-drain-import-contract", "archive import inventory identity is invalid");
  digest(inventory.legacyOwnerArtifactDigest, "$/legacyOwnerArtifactDigest");
  digest(inventory.migrationInventoryDigest, "$/migrationInventoryDigest");
  digest(inventory.ownerDrainAssessmentDigest, "$/ownerDrainAssessmentDigest");
  const demands = denseArray(inventory.demands, "$/demands", "wakeflow-legacy-owner-drain-import-contract");
  const importIds = [];
  for (const [index, demand] of demands.entries()) {
    const at = `$/demands/${index}`;
    exactObject(demand, [
      "archiveImportId",
      "archive",
      "legacyEvidenceFacts",
      "sourceIds",
      "transport",
    ], at, "wakeflow-legacy-owner-drain-import-contract");
    const archiveImportId = digest(demand.archiveImportId, `${at}/archiveImportId`);
    importIds.push(archiveImportId);
    exactObject(demand.archive, [
      "archiveEvidenceDigest",
      "archiveSourceId",
      "archiveTreeDigest",
      "eventsDigest",
      "manifestDigest",
      "resultDigests",
      "stateDigest",
    ], `${at}/archive`, "wakeflow-legacy-owner-drain-import-contract");
    for (const field of [
      "archiveEvidenceDigest",
      "archiveSourceId",
      "archiveTreeDigest",
      "eventsDigest",
      "manifestDigest",
      "stateDigest",
    ]) digest(demand.archive[field], `${at}/archive/${field}`);
    const resultDigests = validateStringArray(
      demand.archive.resultDigests,
      `${at}/archive/resultDigests`,
    );
    resultDigests.forEach((entry, resultIndex) => (
      digest(entry, `${at}/archive/resultDigests/${resultIndex}`)
    ));
    const expectedImportId = canonicalJsonDigest({
      archiveEvidenceDigest: demand.archive.archiveEvidenceDigest,
      archiveSourceId: demand.archive.archiveSourceId,
      archiveTreeDigest: demand.archive.archiveTreeDigest,
    });
    if (archiveImportId !== expectedImportId) {
      fail("wakeflow-legacy-owner-drain-import-digest", "archive import ID differs from its exact archive source", {
        errorPath: `${at}/archiveImportId`,
      });
    }
    const sourceIds = validateStringArray(demand.sourceIds, `${at}/sourceIds`);
    sourceIds.forEach((entry, sourceIndex) => digest(entry, `${at}/sourceIds/${sourceIndex}`));
    if (!sourceIds.includes(demand.archive.archiveSourceId)) {
      fail(
        "wakeflow-legacy-owner-drain-import-contract",
        "archive import source coverage omits its exact archive root",
        { errorPath: `${at}/sourceIds` },
      );
    }
    const facts = denseArray(
      demand.legacyEvidenceFacts,
      `${at}/legacyEvidenceFacts`,
      "wakeflow-legacy-owner-drain-import-contract",
    );
    const factKeys = [];
    for (const [factIndex, fact] of facts.entries()) {
      try {
        validateWakeflowLegacyEvidenceFact(fact);
      } catch (cause) {
        fail("wakeflow-legacy-owner-drain-import-contract", "legacy evidence fact is invalid", {
          errorPath: `${at}/legacyEvidenceFacts/${factIndex}`,
          cause,
        });
      }
      factKeys.push(`${fact.sourceKind}\0${fact.sourceDigest}`);
    }
    const sortedFactKeys = [...new Set(factKeys)].sort(compareText);
    if (canonicalJson(factKeys) !== canonicalJson(sortedFactKeys)) {
      fail("wakeflow-legacy-owner-drain-import-contract", "legacy evidence facts must be unique and lexically ordered", {
        errorPath: `${at}/legacyEvidenceFacts`,
      });
    }
    validateArchiveImportTransport(demand.transport, `${at}/transport`);
  }
  const sortedImportIds = [...new Set(importIds)].sort(compareText);
  if (canonicalJson(importIds) !== canonicalJson(sortedImportIds)) {
    fail("wakeflow-legacy-owner-drain-import-contract", "archive imports must be unique and lexically ordered", {
      errorPath: "$/demands",
    });
  }
  const unsigned = {
    artifactKind: inventory.artifactKind,
    demands: inventory.demands,
    legacyOwnerArtifactDigest: inventory.legacyOwnerArtifactDigest,
    migrationInventoryDigest: inventory.migrationInventoryDigest,
    ownerDrainAssessmentDigest: inventory.ownerDrainAssessmentDigest,
    schemaVersion: inventory.schemaVersion,
  };
  if (digest(inventory.inventoryDigest, "$/inventoryDigest") !== canonicalJsonDigest(unsigned)) {
    fail("wakeflow-legacy-owner-drain-import-digest", "archive import inventory digest differs from its complete payload", {
      errorPath: "$/inventoryDigest",
    });
  }
  return deepFreeze(inventory);
}

/** 对当前workspace连续执行两轮完整T06观察；任一变化都以stale失败。 */
export function inspectWakeflowLegacyOwnerDrain(value) {
  exactObject(
    value,
    ["legacyOwnerArtifact", "workspaceRoot"],
    "$",
    "wakeflow-legacy-owner-drain-input",
  );
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const artifact = normalizeArtifact(value.legacyOwnerArtifact);
  const first = buildAssessmentOnce({ workspaceRoot, artifact });
  const second = buildAssessmentOnce({ workspaceRoot, artifact });
  if (canonicalJson(first) !== canonicalJson(second)) {
    fail("wakeflow-legacy-owner-drain-stale", "workspace owner-drain evidence changed during observation");
  }
  return validateAssessment(second);
}

/** 在同样双观察门内生成T09可消费的严格archive-import inventory。 */
export function inspectWakeflowLegacyArchiveImportInventory(value) {
  exactObject(
    value,
    ["legacyOwnerArtifact", "workspaceRoot"],
    "$",
    "wakeflow-legacy-owner-drain-input",
  );
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const artifact = normalizeArtifact(value.legacyOwnerArtifact);
  const first = buildObservationOnce({ workspaceRoot, artifact, includeArchiveImport: true });
  const second = buildObservationOnce({ workspaceRoot, artifact, includeArchiveImport: true });
  if (canonicalJson(first) !== canonicalJson(second)) {
    fail("wakeflow-legacy-owner-drain-stale", "workspace archive-import evidence changed during observation");
  }
  const assessment = validateAssessment(second.assessment);
  if (
    !assessment.summary.ownerDrainSatisfied
    || second.archiveImport?.code !== null
    || !second.archiveImport.inventory
  ) {
    fail("wakeflow-legacy-owner-drain-import-blocked", "legacy archive import requires a completely drained strict owner graph", {
      details: {
        reasonCode: second.archiveImport?.code ?? "owner-drain-incomplete",
      },
    });
  }
  const inventory = validateArchiveImportInventory(second.archiveImport.inventory);
  if (
    inventory.ownerDrainAssessmentDigest !== assessment.assessmentDigest
    || inventory.legacyOwnerArtifactDigest !== assessment.artifact.legacyOwnerArtifactDigest
    || inventory.migrationInventoryDigest !== assessment.inventory.inventoryDigest
  ) {
    fail("wakeflow-legacy-owner-drain-import-digest", "archive import inventory differs from its exact owner-drain assessment");
  }
  return inventory;
}

/** 仅校验一份portable assessment内部闭包，不认证它来自当前workspace。 */
export function validateWakeflowLegacyOwnerDrainAssessment(value) {
  return validateAssessment(value);
}

/** 仅校验一份portable archive-import inventory内部闭包。 */
export function validateWakeflowLegacyArchiveImportInventory(value) {
  return validateArchiveImportInventory(value);
}

/** 返回已校验assessment的canonical总摘要。 */
export function wakeflowLegacyOwnerDrainAssessmentDigest(value) {
  return validateAssessment(value).assessmentDigest;
}

/** 返回已校验archive-import inventory的canonical总摘要。 */
export function wakeflowLegacyArchiveImportInventoryDigest(value) {
  return validateArchiveImportInventory(value).inventoryDigest;
}
