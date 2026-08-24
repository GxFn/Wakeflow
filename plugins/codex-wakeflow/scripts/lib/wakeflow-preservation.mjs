import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import {
  assertWakeflowId,
  generateWakeflowId,
} from "./wakeflow-identifiers.mjs";
import {
  assertWakeflowMutationContext,
  recoverWakeflowWorkspaceMutation,
  runWakeflowMaintenanceMutation,
} from "./wakeflow-workspace-mutation.mjs";

/**
 * 本文件是 `.wakeflow-local/audit/preserved` 的唯一物理 owner。
 *
 * 职责分为五层：
 * 1. 校验 strict preservation manifest，并生成 canonical bytes；
 * 2. 以 no-follow、current-owner、完整 tree digest 观察待保全源和既有 entry；
 * 3. 生成普通 preserve、迁移 retained-hold、显式 release 三类冻结计划；
 * 4. 把计划适配到唯一 T02 maintenance journal，完成 publish、detach 与前向恢复；
 * 5. 输出不含源路径、reason note 和 payload 成员名的只读 inventory。
 *
 * 本文件不判断业务归档是否完成，不读取 payload 作为兼容回退，也不把 reviewAfter
 * 解释成自动删除权。archive/sanitize 的业务 closure 与 migration 的 source authority
 * 分别由它们自己的 owner 证明；这里仅执行已经闭合的本地审计保全物理步骤。
 */

const MANIFEST_KIND = "WakeflowLocalPreservation";
const MANIFEST_SCHEMA_VERSION = 1;
const PLAN_SCHEMA_ID = "urn:wakeflow:internal:maintenance:local-preservation-plan:v1";
const PLAN_KIND = "wakeflow-local-preservation-plan";
const INVENTORY_KIND = "wakeflow-local-preservation-inventory";
const MANAGER_LOCK_KIND = "wakeflow-local-preservation-manager-lock";
const LOCAL_REF = ".wakeflow-local";
const AUDIT_REF = `${LOCAL_REF}/audit`;
const PRESERVED_REF = `${AUDIT_REF}/preserved`;
const MANAGER_LOCK_REF = `${AUDIT_REF}/manager.lock`;
const LEGACY_PRESERVED_REF = `${LOCAL_REF}/preserved`;
const MANIFEST_NAME = "preservation.json";
const PAYLOAD_NAME = "payload";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_MANAGER_LOCK_BYTES = 64 * 1024;
const MAX_TREE_ENTRIES = 20_000;
const MAX_TREE_DEPTH = 128;
const MAX_REASON_NOTE_BYTES = 2_048;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const MAX_PRESERVED_REVIEW_AFTER_DAYS = 36_500;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TOKEN_RE = /^[a-z][a-z0-9-]{0,127}$/u;
const TIMESTAMP_RE = /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,9})?Z$/u;
const OPERATION_ID_RE = /^workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PRODUCERS = Object.freeze([
  "archive-demand",
  "migration",
  "sanitize-archive",
  "storage-preserve",
]);
const STORAGE_CLASSES = new Set([
  "archive-original",
  "corrupt",
  "legacy",
  "migration-preimage",
  "unknown",
]);
const BLOCKER_SCOPES = new Set([
  "entry",
  "link",
  "manifest",
  "payload",
  "producer",
  "review",
  "source",
]);
const MANUAL_INACTIVE_ROOTS = Object.freeze([
  `${LOCAL_REF}/preserved-delivery-artifacts`,
  `${LOCAL_REF}/preserved-state-roots`,
  `${LOCAL_REF}/preserved-wakeflow-delivery`,
  `${LOCAL_REF}/runtime-quarantine`,
  `${LOCAL_REF}/wakeflow-delivery-quarantine`,
]);
const PRESERVATION_OPERATIONS = new Set([
  "migration-hold",
  "preserve",
  "release",
]);

export class WakeflowPreservationError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowPreservationError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

// ==================== 一、无行为输入、标识与时间合同 ====================

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowPreservationError(code, message, { details, cause });
}

function causeCode(cause) {
  return typeof cause?.code === "string" && TOKEN_RE.test(cause.code)
    ? cause.code
    : "unknown";
}

function wrap(cause, operation) {
  if (cause instanceof WakeflowPreservationError) throw cause;
  const code = causeCode(cause);
  const mapped = code.includes("stale") || code.includes("changed") || code.includes("race")
    ? "wakeflow-preservation-stale"
    : code.includes("recovery") || code.includes("manual") || code.includes("durability")
      ? "wakeflow-preservation-recovery-required"
      : code.includes("blocked")
        ? "wakeflow-preservation-blocked"
        : "wakeflow-preservation-authority";
  throw new WakeflowPreservationError(
    mapped,
    `local preservation ${operation} failed closed`,
    { details: { causeCode: code }, cause },
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactDataFields(value, required, optional, label) {
  if (!isPlainObject(value)) {
    fail("wakeflow-preservation-contract", `${label} must be one plain data object`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("wakeflow-preservation-contract", `${label} cannot contain symbol fields`);
  }
  for (const key of keys) {
    if (!allowed.has(key)) {
      fail("wakeflow-preservation-contract", `${label} contains an unknown field`, { key: String(key) });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-preservation-contract", `${label}.${key} must be an enumerable data field`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-preservation-contract", `${label} is missing ${key}`);
    }
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozenClone(value) {
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function pathDigest(value) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-preservation-contract", `${label} must be a canonical sha256 digest`);
  }
  return value;
}

function assertToken(value, label) {
  if (typeof value !== "string" || !TOKEN_RE.test(value)) {
    fail("wakeflow-preservation-contract", `${label} must be a bounded lower-case token`);
  }
  return value;
}

function assertPortableRef(value, label) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 1024
    || value.startsWith("/")
    || /^[A-Za-z]:/u.test(value)
    || value.includes("\\")
    || value.includes("//")
    || value.endsWith("/")
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || path.posix.normalize(value) !== value
    || value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    fail("wakeflow-preservation-contract", `${label} must be a portable canonical ref`);
  }
  return value;
}

function normalizeWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail("wakeflow-preservation-contract", "workspaceRoot must be one trimmed control-free path");
  }
  return path.resolve(value);
}

function assertTimestamp(value, label) {
  if (typeof value !== "string" || !TIMESTAMP_RE.test(value)) {
    fail("wakeflow-preservation-contract", `${label} must be a strict RFC3339 UTC timestamp`);
  }
  const parsed = new Date(value);
  const match = value.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})/u);
  if (
    Number.isNaN(parsed.getTime())
    || !match
    || parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() + 1 !== Number(match[2])
    || parsed.getUTCDate() !== Number(match[3])
    || parsed.getUTCHours() !== Number(match[4])
    || parsed.getUTCMinutes() !== Number(match[5])
    || parsed.getUTCSeconds() !== Number(match[6])
  ) {
    fail("wakeflow-preservation-contract", `${label} is not a real UTC timestamp`);
  }
  return value;
}

// 时间文本允许 1-9 位小数；所有先后关系必须保留纳秒精度，不能退化为 Date 的毫秒精度。
function timestampInstantNanoseconds(value, label) {
  assertTimestamp(value, label);
  const match = value.match(
    /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?Z$/u,
  );
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const parsed = new Date(0);
  parsed.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  parsed.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  return BigInt(parsed.getTime()) * 1_000_000n
    + BigInt(fraction.padEnd(9, "0") || "0");
}

function addReviewDays(createdAt, days) {
  assertTimestamp(createdAt, "createdAt");
  const match = createdAt.match(
    /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?Z$/u,
  );
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const base = new Date(0);
  base.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  base.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  const value = base.getTime() + days * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(value)) {
    fail("wakeflow-preservation-contract", "reviewAfter exceeds the supported timestamp range");
  }
  let reviewAfter;
  try {
    const wholeSecond = new Date(value).toISOString().slice(0, 19);
    reviewAfter = `${wholeSecond}.${fraction || "000"}Z`;
  } catch {
    fail("wakeflow-preservation-contract", "reviewAfter exceeds the supported timestamp range");
  }
  if (!TIMESTAMP_RE.test(reviewAfter)) {
    fail("wakeflow-preservation-contract", "reviewAfter exceeds the supported timestamp range");
  }
  return reviewAfter;
}

function assertSafeInteger(value, label, { minimum = 0, maximum = MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("wakeflow-preservation-contract", `${label} must be a bounded safe integer`);
  }
  return value;
}

function validateLinks(value, producer) {
  exactDataFields(
    value,
    ["demandId", "archiveManifestDigest", "migrationId"],
    [],
    "preservation links",
  );
  if (value.demandId !== null) assertWakeflowId(value.demandId, "demand", "$manifest/links/demandId");
  if (value.archiveManifestDigest !== null) {
    assertDigest(value.archiveManifestDigest, "links.archiveManifestDigest");
  }
  if (value.migrationId !== null) assertToken(value.migrationId, "links.migrationId");
  if (producer === "migration") {
    if (value.migrationId === null || value.demandId !== null || value.archiveManifestDigest !== null) {
      fail("wakeflow-preservation-manifest", "migration preservation links are not exact");
    }
  } else if (producer === "storage-preserve") {
    if (Object.values(value).some((entry) => entry !== null)) {
      fail("wakeflow-preservation-manifest", "manual storage preservation cannot claim external links");
    }
  } else if (value.demandId === null || value.archiveManifestDigest === null || value.migrationId !== null) {
    fail("wakeflow-preservation-manifest", "archive preservation links are incomplete");
  }
}

function validProducerStoragePair(producer, storageClass) {
  if (producer === "migration") return storageClass === "migration-preimage";
  if (producer === "storage-preserve") {
    return new Set(["legacy", "unknown", "corrupt"]).has(storageClass);
  }
  return storageClass === "archive-original";
}

/** 校验一份 create-only manifest，并返回与调用方对象脱离的深冻结快照。 */
export function validateLocalPreservationManifest(value) {
  const manifest = frozenClone(value);
  exactDataFields(manifest, [
    "kind",
    "schemaVersion",
    "programId",
    "preservationId",
    "producer",
    "createdAt",
    "source",
    "reason",
    "payload",
    "retention",
    "links",
  ], [], "local preservation manifest");
  if (manifest.kind !== MANIFEST_KIND || manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail("wakeflow-preservation-manifest", "local preservation manifest kind/version is invalid");
  }
  assertWakeflowId(manifest.programId, "program", "$manifest/programId");
  assertWakeflowId(manifest.preservationId, "preservation", "$manifest/preservationId");
  if (!PRODUCERS.includes(manifest.producer)) {
    fail("wakeflow-preservation-manifest", "local preservation producer is invalid");
  }
  assertTimestamp(manifest.createdAt, "manifest.createdAt");
  exactDataFields(manifest.source, ["relativePath", "storageClass", "type"], [], "manifest source");
  assertPortableRef(manifest.source.relativePath, "manifest.source.relativePath");
  if (!STORAGE_CLASSES.has(manifest.source.storageClass)) {
    fail("wakeflow-preservation-manifest", "manifest source storageClass is invalid");
  }
  if (!new Set(["directory", "file"]).has(manifest.source.type)) {
    fail("wakeflow-preservation-manifest", "manifest source type is invalid");
  }
  if (!validProducerStoragePair(manifest.producer, manifest.source.storageClass)) {
    fail("wakeflow-preservation-manifest", "manifest producer/storageClass pair is invalid");
  }
  exactDataFields(manifest.reason, ["code", "note"], [], "manifest reason");
  assertToken(manifest.reason.code, "manifest.reason.code");
  if (
    manifest.reason.note !== null
    && (
      typeof manifest.reason.note !== "string"
      || Buffer.byteLength(manifest.reason.note, "utf8") < 1
      || Buffer.byteLength(manifest.reason.note, "utf8") > MAX_REASON_NOTE_BYTES
      || /[\u0000-\u001f\u007f-\u009f]/u.test(manifest.reason.note)
    )
  ) {
    fail("wakeflow-preservation-manifest", "manifest reason note is invalid");
  }
  exactDataFields(manifest.payload, ["treeDigest", "bytes"], [], "manifest payload");
  exactDataFields(
    manifest.payload.treeDigest,
    ["algorithm", "value", "entries"],
    [],
    "manifest payload treeDigest",
  );
  if (manifest.payload.treeDigest.algorithm !== "sha256") {
    fail("wakeflow-preservation-manifest", "manifest tree digest algorithm is invalid");
  }
  assertDigest(manifest.payload.treeDigest.value, "manifest.payload.treeDigest.value");
  assertSafeInteger(manifest.payload.treeDigest.entries, "manifest.payload.treeDigest.entries", {
    maximum: MAX_TREE_ENTRIES,
  });
  assertSafeInteger(manifest.payload.bytes, "manifest.payload.bytes");
  exactDataFields(
    manifest.retention,
    ["class", "reviewAfter", "requiresExplicitRelease"],
    [],
    "manifest retention",
  );
  if (
    manifest.retention.class !== "reviewable-local-audit"
    || manifest.retention.requiresExplicitRelease !== true
  ) {
    fail("wakeflow-preservation-manifest", "manifest retention policy is invalid");
  }
  const createdInstant = timestampInstantNanoseconds(manifest.createdAt, "manifest.createdAt");
  const reviewInstant = timestampInstantNanoseconds(
    manifest.retention.reviewAfter,
    "manifest.retention.reviewAfter",
  );
  if (reviewInstant <= createdInstant) {
    fail("wakeflow-preservation-manifest", "manifest reviewAfter must follow createdAt");
  }
  validateLinks(manifest.links, manifest.producer);
  return manifest;
}

/** 生成 preservation.json 唯一允许的单行 canonical UTF-8 字节。 */
export function localPreservationCanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(validateLocalPreservationManifest(value))}\n`, "utf8");
}

// ==================== 二、严格文件系统快照与 tree identity ====================

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail("wakeflow-preservation-platform", "local preservation requires POSIX ownership semantics");
  }
  return process.geteuid();
}

function modeString(stat) {
  return `0${statMode(stat).toString(8).padStart(3, "0")}`;
}

function statMode(stat) {
  return Number(stat.mode & (typeof stat.mode === "bigint" ? 0o777n : 0o777));
}

function statHasSingleLink(stat) {
  return stat.nlink === (typeof stat.nlink === "bigint" ? 1n : 1);
}

function nodeType(stat) {
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  if (stat.isSymbolicLink()) return "symlink";
  return "unsupported";
}

function statIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    type: nodeType(stat),
    mode: statMode(stat),
    uid: String(stat.uid),
    gid: String(stat.gid),
    nlink: String(stat.nlink),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  };
}

function sameIdentity(left, right) {
  return canonicalJson(statIdentity(left)) === canonicalJson(statIdentity(right));
}

function sameNodeIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && nodeType(left) === nodeType(right)
    && left.uid === right.uid
    && left.gid === right.gid;
}

// rename 允许内核更新 ctime；其余节点与内容身份仍必须保持不变。
function sameRenamedIdentity(left, right) {
  return sameNodeIdentity(left, right)
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs;
}

function lstatIfPresent(candidate) {
  try {
    return fs.lstatSync(candidate, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    fail("wakeflow-preservation-filesystem", "cannot inspect local preservation path", {}, cause);
  }
}

// 目录枚举也属于 authority 快照：限制一次性成员数，并在枚举后复验纳秒身份。
function listDirectoryNames(candidate, expectedStat, label, maximumEntries) {
  if (!expectedStat.isDirectory() || expectedStat.isSymbolicLink()) {
    fail("wakeflow-preservation-directory", `${label} must be one real directory`);
  }
  let names;
  try {
    names = fs.readdirSync(candidate);
  } catch (cause) {
    fail("wakeflow-preservation-filesystem", `cannot enumerate ${label}`, {}, cause);
  }
  if (names.length > maximumEntries) {
    fail("wakeflow-preservation-limit", `${label} exceeds the maximum entry count`, {
      maximumEntries,
    });
  }
  const settled = fs.lstatSync(candidate, { bigint: true });
  if (!sameIdentity(expectedStat, settled)) {
    fail("wakeflow-preservation-race", `${label} changed during enumeration`);
  }
  return names.sort(lexicalCompare);
}

function assertOwned(stat, label) {
  const expected = typeof stat.uid === "bigint" ? BigInt(currentEuid()) : currentEuid();
  if (stat.uid !== expected) {
    fail("wakeflow-preservation-owner", `${label} is not owned by the current euid`);
  }
}

function assertPrivateDirectory(candidate, label, { allowMissing = false } = {}) {
  const stat = lstatIfPresent(candidate);
  if (stat === null && allowMissing) return null;
  if (
    stat === null
    || stat.isSymbolicLink()
    || !stat.isDirectory()
    || statMode(stat) !== DIRECTORY_MODE
  ) {
    fail("wakeflow-preservation-directory", `${label} must be one private real directory`);
  }
  assertOwned(stat, label);
  return stat;
}

function assertWorkspaceRoot(workspaceRoot) {
  const stat = lstatIfPresent(workspaceRoot);
  if (stat === null || stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-preservation-workspace", "workspace root must be one real directory");
  }
  assertOwned(stat, "workspace root");
  return stat;
}

function resolveRef(workspaceRoot, ref) {
  assertPortableRef(ref, "workspace ref");
  const candidate = path.resolve(workspaceRoot, ...ref.split("/"));
  const relative = path.relative(workspaceRoot, candidate);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail("wakeflow-preservation-path-escape", "local preservation ref escaped the workspace");
  }
  return candidate;
}

function fsyncDirectory(candidate, label) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      candidate,
      fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0),
    );
    fs.fsyncSync(descriptor);
  } catch (cause) {
    fail("wakeflow-preservation-durability", `cannot fsync ${label}`, {}, cause);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

/**
 * 在调用方已经完成 type/mode/owner/link 检查后，通过 no-follow descriptor 捕获有界精确字节。
 * expected+1 的读取窗口同时防止检查后增长的文件被静默截断。
 */
function readBoundedExactFile(candidate, expectedStat, maximumBytes, label) {
  if (expectedStat.size > BigInt(maximumBytes)) {
    fail("wakeflow-preservation-limit", `${label} exceeds its byte limit`, { maximumBytes });
  }
  let descriptor;
  try {
    descriptor = fs.openSync(candidate, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameIdentity(opened, expectedStat)) {
      fail("wakeflow-preservation-race", `${label} changed while opening`);
    }
    const expectedSize = Number(opened.size);
    const capture = Buffer.alloc(expectedSize + 1);
    let offset = 0;
    while (offset < capture.length) {
      const count = fs.readSync(descriptor, capture, offset, capture.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const afterDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(candidate, { bigint: true });
    if (
      offset !== expectedSize
      || !sameIdentity(opened, afterDescriptor)
      || !sameIdentity(opened, afterPath)
    ) {
      fail("wakeflow-preservation-race", `${label} changed while reading`);
    }
    return Buffer.from(capture.subarray(0, expectedSize));
  } catch (cause) {
    if (cause instanceof WakeflowPreservationError) throw cause;
    fail("wakeflow-preservation-read", `cannot read ${label}`, {}, cause);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertAuditRoots(workspaceRoot) {
  assertWorkspaceRoot(workspaceRoot);
  const local = resolveRef(workspaceRoot, LOCAL_REF);
  const audit = resolveRef(workspaceRoot, AUDIT_REF);
  const preserved = resolveRef(workspaceRoot, PRESERVED_REF);
  assertPrivateDirectory(local, "Wakeflow local root");
  assertPrivateDirectory(audit, "Wakeflow audit root");
  assertPrivateDirectory(preserved, "Wakeflow preserved root");
  return Object.freeze({ local, audit, preserved });
}

function fileDigest(candidate, expectedStat, label) {
  let descriptor;
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    descriptor = fs.openSync(candidate, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(before, expectedStat) || !before.isFile()) {
      fail("wakeflow-preservation-race", `${label} changed while opening`);
    }
    if (before.size > BigInt(MAX_SAFE_INTEGER)) {
      fail("wakeflow-preservation-limit", `${label} exceeds the safe byte count`);
    }
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      bytes += count;
      if (!Number.isSafeInteger(bytes)) {
        fail("wakeflow-preservation-limit", `${label} exceeds the safe byte count`);
      }
      hash.update(buffer.subarray(0, count));
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(before, after) || BigInt(bytes) !== after.size) {
      fail("wakeflow-preservation-race", `${label} changed while reading`);
    }
  } catch (cause) {
    if (cause instanceof WakeflowPreservationError) throw cause;
    fail("wakeflow-preservation-read", `cannot read ${label}`, {}, cause);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  const settled = fs.lstatSync(candidate, { bigint: true });
  if (!sameIdentity(settled, expectedStat)) {
    fail("wakeflow-preservation-race", `${label} changed after reading`);
  }
  return { bytes, contentDigest: `sha256:${hash.digest("hex")}` };
}

function symlinkDigest(candidate, expectedStat, label) {
  let target;
  try {
    target = fs.readlinkSync(candidate, "buffer");
  } catch (cause) {
    fail("wakeflow-preservation-read", `cannot read ${label} link target`, {}, cause);
  }
  const settled = fs.lstatSync(candidate, { bigint: true });
  if (!sameIdentity(settled, expectedStat)) {
    fail("wakeflow-preservation-race", `${label} changed while reading its link target`);
  }
  return {
    bytes: target.length,
    contentDigest: sha256Bytes(target),
    linkTarget: target,
  };
}

function assertSafeSourceMode(stat, type, label, { root = false } = {}) {
  const mode = statMode(stat);
  if (root) {
    const expected = type === "directory" ? DIRECTORY_MODE : FILE_MODE;
    if (mode !== expected) {
      fail("wakeflow-preservation-source-mode", `${label} root must already be private`);
    }
    return;
  }
  if ((mode & 0o022) !== 0) {
    fail("wakeflow-preservation-source-mode", `${label} is group/world writable`);
  }
  if (type === "directory" && (mode & 0o500) !== 0o500) {
    fail("wakeflow-preservation-source-mode", `${label} is not owner-readable/traversable`);
  }
  if (type === "file" && (mode & 0o400) !== 0o400) {
    fail("wakeflow-preservation-source-mode", `${label} is not owner-readable`);
  }
}

function scanChild(candidate, relative, depth, entries) {
  if (depth > MAX_TREE_DEPTH) {
    fail("wakeflow-preservation-limit", "preservation source exceeds the maximum tree depth");
  }
  if (entries.length >= MAX_TREE_ENTRIES) {
    fail("wakeflow-preservation-limit", "preservation source exceeds the maximum entry count");
  }
  const before = fs.lstatSync(candidate, { bigint: true });
  const type = nodeType(before);
  if (type === "unsupported") {
    fail("wakeflow-preservation-unsupported-entry", "preservation source contains an unsupported filesystem entry");
  }
  assertOwned(before, "preservation source entry");
  if (type === "file" && !statHasSingleLink(before)) {
    fail("wakeflow-preservation-unsupported-entry", "preservation source contains a hard-linked file");
  }
  if (type === "symlink" && !statHasSingleLink(before)) {
    fail("wakeflow-preservation-unsupported-entry", "preservation source contains an ambiguous symlink");
  }
  assertSafeSourceMode(before, type, "preservation source entry");
  const entry = {
    path: relative,
    absolute: candidate,
    type,
    mode: type === "symlink" ? null : modeString(before),
    bytes: 0,
    contentDigest: null,
    stat: before,
    linkTarget: null,
  };
  entries.push(entry);
  if (type === "file") {
    Object.assign(entry, fileDigest(candidate, before, "preservation source file"));
    return;
  }
  if (type === "symlink") {
    Object.assign(entry, symlinkDigest(candidate, before, "preservation source symlink"));
    return;
  }
  const names = listDirectoryNames(
    candidate,
    before,
    "preservation source directory",
    MAX_TREE_ENTRIES - entries.length,
  );
  for (const name of names) {
    scanChild(path.join(candidate, name), relative ? `${relative}/${name}` : name, depth + 1, entries);
  }
  const after = fs.lstatSync(candidate, { bigint: true });
  if (!sameIdentity(before, after)) {
    fail("wakeflow-preservation-race", "preservation source directory changed during traversal");
  }
}

function publicTreeEntry(entry) {
  return {
    path: entry.path,
    type: entry.type,
    mode: entry.mode,
    bytes: entry.bytes,
    contentDigest: entry.contentDigest,
  };
}

function cleanupEntry(entry) {
  return {
    pathDigest: pathDigest(entry.path),
    type: entry.type,
    mode: entry.mode,
    contentDigest: entry.contentDigest,
    bytes: entry.bytes,
  };
}

function finalizeTreeInventory({ rootType, rootMode, rootStat, rootAbsolute, entries }) {
  const projected = entries.map(publicTreeEntry);
  const treeDigest = canonicalJsonDigest({ rootType, entries: projected });
  const bytes = projected.reduce((total, entry) => {
    const next = total + entry.bytes;
    if (!Number.isSafeInteger(next)) fail("wakeflow-preservation-limit", "preservation byte count overflowed");
    return next;
  }, 0);
  const rootContent = rootType === "file" && entries.length === 1
    ? entries[0]
    : null;
  const rootEntry = {
    path: "",
    absolute: rootAbsolute,
    type: rootType,
    mode: rootMode,
    bytes: rootContent?.bytes ?? 0,
    contentDigest: rootContent?.contentDigest ?? null,
    stat: rootStat,
    linkTarget: rootContent?.linkTarget ?? null,
  };
  // single-file payload需要basename参与tree digest，但source detach只观察stage根文件，不能生成重复清理节点。
  const cleanupEntries = rootType === "file" ? [rootEntry] : [rootEntry, ...entries];
  const cleanupInventory = cleanupEntries
    .map(cleanupEntry)
    .sort((left, right) => lexicalCompare(left.pathDigest, right.pathDigest));
  return {
    rootType,
    rootMode,
    rootStat,
    rootAbsolute,
    entries,
    projected,
    treeDigest,
    bytes,
    cleanupInventory,
  };
}

function scanSourceTree(workspaceRoot, sourceRef, { allowPublicRoot = false } = {}) {
  const source = resolveRef(workspaceRoot, sourceRef);
  const rootStat = lstatIfPresent(source);
  if (rootStat === null) fail("wakeflow-preservation-source-missing", "preservation source is missing");
  const rootType = nodeType(rootStat);
  if (!new Set(["directory", "file"]).has(rootType)) {
    fail("wakeflow-preservation-unsupported-entry", "preservation source root must be a real file or directory");
  }
  assertOwned(rootStat, "preservation source root");
  if (rootType === "file" && !statHasSingleLink(rootStat)) {
    fail("wakeflow-preservation-unsupported-entry", "preservation source root is hard linked");
  }
  assertSafeSourceMode(rootStat, rootType, "preservation source", {
    root: !allowPublicRoot,
  });
  const entries = [];
  if (rootType === "file") {
    scanChild(source, path.posix.basename(sourceRef), 0, entries);
    if (entries.length !== 1 || !sameIdentity(rootStat, entries[0].stat)) {
      fail("wakeflow-preservation-race", "preservation source file changed during traversal");
    }
  } else {
    const names = listDirectoryNames(
      source,
      rootStat,
      "preservation source root",
      MAX_TREE_ENTRIES,
    );
    for (const name of names) scanChild(path.join(source, name), name, 1, entries);
    const settled = fs.lstatSync(source, { bigint: true });
    if (!sameIdentity(rootStat, settled)) {
      fail("wakeflow-preservation-race", "preservation source root changed during traversal");
    }
  }
  return finalizeTreeInventory({
    rootType,
    rootMode: modeString(rootStat),
    rootStat,
    rootAbsolute: source,
    entries,
  });
}

// payload walker复用source tree算法，但入口始终是0700隔离目录，tree rootType仍表达原source类型。
function scanPayloadTree(payloadRoot, manifest) {
  const rootStat = assertPrivateDirectory(payloadRoot, "preservation payload root");
  const entries = [];
  const names = listDirectoryNames(
    payloadRoot,
    rootStat,
    "preservation payload root",
    MAX_TREE_ENTRIES,
  );
  if (manifest.source.type === "file") {
    const expected = path.posix.basename(manifest.source.relativePath);
    if (canonicalJson(names) !== canonicalJson([expected])) {
      fail("wakeflow-preservation-payload", "single-file preservation payload has an invalid member set");
    }
    scanChild(path.join(payloadRoot, expected), expected, 0, entries);
  } else {
    for (const name of names) scanChild(path.join(payloadRoot, name), name, 1, entries);
  }
  const settled = fs.lstatSync(payloadRoot, { bigint: true });
  if (!sameIdentity(rootStat, settled)) {
    fail("wakeflow-preservation-race", "preservation payload changed during traversal");
  }
  return finalizeTreeInventory({
    rootType: manifest.source.type,
    rootMode: manifest.source.type === "directory" ? "0700" : "0600",
    rootStat,
    rootAbsolute: payloadRoot,
    entries,
  });
}

function readCanonicalManifest(file) {
  const stat = lstatIfPresent(file);
  if (
    stat === null
    || stat.isSymbolicLink()
    || !stat.isFile()
    || !statHasSingleLink(stat)
    || statMode(stat) !== FILE_MODE
  ) {
    fail("wakeflow-preservation-missing-manifest", "preservation manifest is missing or unsafe");
  }
  assertOwned(stat, "preservation manifest");
  if (stat.size > BigInt(MAX_MANIFEST_BYTES)) {
    fail("wakeflow-preservation-corrupt-manifest", "preservation manifest exceeds the size limit");
  }
  const bytes = readBoundedExactFile(file, stat, MAX_MANIFEST_BYTES, "preservation manifest");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    fail("wakeflow-preservation-corrupt-manifest", "preservation manifest is not UTF-8", {}, cause);
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail("wakeflow-preservation-corrupt-manifest", "preservation manifest is not one canonical JSON line");
  }
  let value;
  try {
    value = JSON.parse(text.slice(0, -1));
  } catch (cause) {
    fail("wakeflow-preservation-corrupt-manifest", "preservation manifest is not JSON", {}, cause);
  }
  const manifest = validateLocalPreservationManifest(value);
  const canonical = localPreservationCanonicalBytes(manifest);
  if (!canonical.equals(bytes)) {
    fail("wakeflow-preservation-corrupt-manifest", "preservation manifest bytes are not canonical");
  }
  return { manifest, bytes, manifestDigest: sha256Bytes(bytes), stat };
}

function entryDigest(manifestDigest, payloadTreeDigest) {
  return canonicalJsonDigest({ manifestDigest, payloadTreeDigest });
}

function inspectEntry(workspaceRoot, preservationId, expectedProgramId) {
  assertWakeflowId(preservationId, "preservation", "$preservationId");
  const entryRef = `${PRESERVED_REF}/${preservationId}`;
  const entryRoot = resolveRef(workspaceRoot, entryRef);
  const rootStat = assertPrivateDirectory(entryRoot, "preservation entry", { allowMissing: true });
  if (rootStat === null) return null;
  const names = listDirectoryNames(entryRoot, rootStat, "preservation entry", 2);
  if (canonicalJson(names) !== canonicalJson([MANIFEST_NAME, PAYLOAD_NAME].sort(lexicalCompare))) {
    fail("wakeflow-preservation-entry", "preservation entry has an invalid member set");
  }
  const manifestSource = readCanonicalManifest(path.join(entryRoot, MANIFEST_NAME));
  const { manifest } = manifestSource;
  if (
    manifest.preservationId !== preservationId
    || manifest.programId !== expectedProgramId
  ) {
    fail("wakeflow-preservation-entry", "preservation manifest identity differs from its entry");
  }
  const payload = scanPayloadTree(path.join(entryRoot, PAYLOAD_NAME), manifest);
  if (
    payload.treeDigest !== manifest.payload.treeDigest.value
    || payload.projected.length !== manifest.payload.treeDigest.entries
    || payload.bytes !== manifest.payload.bytes
  ) {
    fail("wakeflow-preservation-digest-mismatch", "preservation payload differs from its immutable manifest");
  }
  const settled = fs.lstatSync(entryRoot, { bigint: true });
  if (!sameIdentity(rootStat, settled)) fail("wakeflow-preservation-race", "preservation entry changed during inspection");
  const fullEntries = [];
  scanChild(path.join(entryRoot, MANIFEST_NAME), MANIFEST_NAME, 1, fullEntries);
  scanChild(path.join(entryRoot, PAYLOAD_NAME), PAYLOAD_NAME, 1, fullEntries);
  const fullTree = finalizeTreeInventory({
    rootType: "directory",
    rootMode: "0700",
    rootStat,
    rootAbsolute: entryRoot,
    entries: fullEntries,
  });
  return Object.freeze({
    entryRef,
    entryRoot,
    manifest,
    manifestDigest: manifestSource.manifestDigest,
    payload,
    entryDigest: entryDigest(manifestSource.manifestDigest, payload.treeDigest),
    cleanupInventory: fullTree.cleanupInventory,
  });
}

// ==================== 三、verified-copy、atomic publish 与 exact cleanup ====================

function writeExactFile(sourceEntry, destination) {
  let sourceFd;
  let targetFd;
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    sourceFd = fs.openSync(sourceEntry.absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(sourceFd, { bigint: true });
    if (!sameIdentity(opened, sourceEntry.stat)) {
      fail("wakeflow-preservation-race", "preservation source file changed before copy");
    }
    targetFd = fs.openSync(
      destination,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      FILE_MODE,
    );
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const count = fs.readSync(sourceFd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      let offset = 0;
      while (offset < count) offset += fs.writeSync(targetFd, buffer, offset, count - offset);
      hash.update(buffer.subarray(0, count));
      bytes += count;
      if (!Number.isSafeInteger(bytes)) {
        fail("wakeflow-preservation-limit", "preservation source file exceeds the safe byte count");
      }
    }
    const sourceAfter = fs.fstatSync(sourceFd, { bigint: true });
    if (!sameIdentity(opened, sourceAfter) || BigInt(bytes) !== sourceAfter.size) {
      fail("wakeflow-preservation-race", "preservation source file changed during copy");
    }
    if (bytes !== sourceEntry.bytes || `sha256:${hash.digest("hex")}` !== sourceEntry.contentDigest) {
      fail("wakeflow-preservation-copy", "preservation source file copy digest differs");
    }
    fs.fchmodSync(targetFd, Number.parseInt(sourceEntry.mode, 8));
    fs.fsyncSync(targetFd);
  } catch (cause) {
    if (cause instanceof WakeflowPreservationError) throw cause;
    fail("wakeflow-preservation-copy", "cannot copy preservation source file", {}, cause);
  } finally {
    if (sourceFd !== undefined) fs.closeSync(sourceFd);
    if (targetFd !== undefined) fs.closeSync(targetFd);
  }
}

// 新建目录必须在 descriptor 上收紧 mode，并复验路径仍指向同一 current-owner 目录。
function setExactDirectoryMode(candidate, mode, label) {
  const before = fs.lstatSync(candidate, { bigint: true });
  if (before.isSymbolicLink() || !before.isDirectory()) {
    fail("wakeflow-preservation-copy", `${label} is not one real directory`);
  }
  assertOwned(before, label);
  let descriptor;
  try {
    descriptor = fs.openSync(
      candidate,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY ?? 0)
        | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(opened, before)) {
      fail("wakeflow-preservation-race", `${label} changed while opening`);
    }
    fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
    const hardened = fs.fstatSync(descriptor, { bigint: true });
    const settled = fs.lstatSync(candidate, { bigint: true });
    if (
      !sameIdentity(hardened, settled)
      || !sameNodeIdentity(before, hardened)
      || statMode(hardened) !== mode
    ) {
      fail("wakeflow-preservation-race", `${label} changed while hardening mode`);
    }
  } catch (cause) {
    if (cause instanceof WakeflowPreservationError) throw cause;
    fail("wakeflow-preservation-copy", `cannot harden ${label}`, {}, cause);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function createPrivateDirectory(candidate, label) {
  try {
    fs.mkdirSync(candidate, { mode: DIRECTORY_MODE });
  } catch (cause) {
    fail("wakeflow-preservation-copy", `cannot create ${label}`, {}, cause);
  }
  setExactDirectoryMode(candidate, DIRECTORY_MODE, label);
  fsyncDirectory(candidate, label);
  fsyncDirectory(path.dirname(candidate), `${label} parent`);
}

function copySourceIntoPayload(source, payloadRoot) {
  const directories = source.entries.filter((entry) => entry.type === "directory");
  for (const entry of directories) {
    createPrivateDirectory(path.join(payloadRoot, ...entry.path.split("/")), "preservation payload directory");
  }
  for (const entry of source.entries.filter((candidate) => candidate.type !== "directory")) {
    const destination = path.join(payloadRoot, ...entry.path.split("/"));
    if (entry.type === "file") {
      writeExactFile(entry, destination);
    } else {
      try {
        fs.symlinkSync(entry.linkTarget, destination);
      } catch (cause) {
        fail("wakeflow-preservation-copy", "cannot copy preservation source symlink", {}, cause);
      }
      const copied = fs.lstatSync(destination, { bigint: true });
      const copiedDigest = symlinkDigest(destination, copied, "preservation payload symlink");
      if (copiedDigest.contentDigest !== entry.contentDigest || copiedDigest.bytes !== entry.bytes) {
        fail("wakeflow-preservation-copy", "preservation symlink copy differs from its source");
      }
      fsyncDirectory(path.dirname(destination), "preservation symlink parent");
    }
  }
  for (const entry of [...directories].sort((left, right) => (
    right.path.split("/").length - left.path.split("/").length
    || lexicalCompare(right.path, left.path)
  ))) {
    const destination = path.join(payloadRoot, ...entry.path.split("/"));
    setExactDirectoryMode(destination, Number.parseInt(entry.mode, 8), "preservation payload directory");
    fsyncDirectory(destination, "preservation payload directory");
  }
  fsyncDirectory(payloadRoot, "preservation payload root");
}

function writeManifest(file, manifest) {
  const bytes = localPreservationCanonicalBytes(manifest);
  let descriptor;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      FILE_MODE,
    );
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    fs.fchmodSync(descriptor, FILE_MODE);
    fs.fsyncSync(descriptor);
  } catch (cause) {
    fail("wakeflow-preservation-manifest-write", "cannot write preservation manifest", {}, cause);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(file), "preservation entry stage");
}

function expectedPublishPaths(source) {
  const entries = [
    { path: "", type: "directory" },
    { path: PAYLOAD_NAME, type: "directory" },
    { path: MANIFEST_NAME, type: "file" },
    ...source.entries.map((entry) => ({ path: `${PAYLOAD_NAME}/${entry.path}`, type: entry.type })),
  ];
  return new Map(entries.map((entry) => [pathDigest(entry.path), entry.type]));
}

function scanLooseTree(root) {
  const output = [];
  const visit = (candidate, relative, depth) => {
    if (depth > MAX_TREE_DEPTH + 2 || output.length >= MAX_TREE_ENTRIES + 3) {
      fail("wakeflow-preservation-limit", "preservation stage exceeds its bounded tree shape");
    }
    const stat = fs.lstatSync(candidate, { bigint: true });
    const type = nodeType(stat);
    if (type === "unsupported") fail("wakeflow-preservation-stage", "preservation stage contains an unsupported node");
    assertOwned(stat, "preservation stage node");
    output.push({ path: relative, absolute: candidate, type, stat });
    if (type === "directory") {
      for (const name of listDirectoryNames(
        candidate,
        stat,
        "preservation stage directory",
        MAX_TREE_ENTRIES + 3 - output.length,
      )) {
        visit(path.join(candidate, name), relative ? `${relative}/${name}` : name, depth + 1);
      }
    }
  };
  visit(root, "", 0);
  return output;
}

function clearPartialPublishStage(stage, source) {
  const stat = lstatIfPresent(stage);
  if (stat === null) return;
  if (stat.isSymbolicLink() || !stat.isDirectory() || statMode(stat) !== DIRECTORY_MODE) {
    fail("wakeflow-preservation-stage", "preservation publish stage is unsafe");
  }
  const expected = expectedPublishPaths(source);
  const entries = scanLooseTree(stage);
  for (const entry of entries) {
    if (expected.get(pathDigest(entry.path)) !== entry.type) {
      fail("wakeflow-preservation-stage", "preservation publish stage contains an unknown node");
    }
  }
  const removals = entries
    .filter((entry) => entry.path !== "")
    .sort((left, right) => (
      Number(left.type === "directory") - Number(right.type === "directory")
      || right.path.split("/").length - left.path.split("/").length
      || lexicalCompare(left.path, right.path)
    ));
  for (const entry of removals) {
    if (entry.type === "directory") fs.rmdirSync(entry.absolute);
    else fs.unlinkSync(entry.absolute);
    fsyncDirectory(path.dirname(entry.absolute), "preservation partial stage parent");
  }
  fs.rmdirSync(stage);
  fsyncDirectory(path.dirname(stage), "preservation publish parent");
}

function materializePublishStage(workspaceRoot, plan, source, stageRef) {
  const stage = resolveRef(workspaceRoot, stageRef);
  clearPartialPublishStage(stage, source);
  createPrivateDirectory(stage, "preservation entry stage");
  const payloadRoot = path.join(stage, PAYLOAD_NAME);
  createPrivateDirectory(payloadRoot, "preservation payload root");
  try {
    copySourceIntoPayload(source, payloadRoot);
    const sourceAfter = scanSourceTree(
      workspaceRoot,
      plan.payload.manifest.source.relativePath,
      {
        allowPublicRoot: plan.payload.operation === "migration-hold"
          && directLegacyArchiveEntry(plan.payload.manifest.source.relativePath),
      },
    );
    if (
      sourceAfter.treeDigest !== source.treeDigest
      || canonicalJson(sourceAfter.projected) !== canonicalJson(source.projected)
    ) {
      fail("wakeflow-preservation-race", "preservation source changed while building the audit entry");
    }
    writeManifest(path.join(stage, MANIFEST_NAME), plan.payload.manifest);
    const inspected = inspectEntryAtRef(workspaceRoot, stageRef, plan.payload.manifest);
    if (inspected.entryDigest !== plan.payload.entryDigest) {
      fail("wakeflow-preservation-copy", "preservation stage digest differs from the confirmed plan");
    }
  } catch (cause) {
    try {
      clearPartialPublishStage(stage, source);
    } catch (cleanupCause) {
      fail(
        "wakeflow-preservation-recovery-required",
        "preservation stage failed and could not be safely cleared",
        { cleanupCode: causeCode(cleanupCause) },
        cause,
      );
    }
    throw cause;
  }
}

function inspectEntryAtRef(workspaceRoot, entryRef, expectedManifest) {
  const entryRoot = resolveRef(workspaceRoot, entryRef);
  const rootStat = assertPrivateDirectory(entryRoot, "preservation entry stage");
  const names = listDirectoryNames(entryRoot, rootStat, "preservation entry stage", 2);
  if (canonicalJson(names) !== canonicalJson([MANIFEST_NAME, PAYLOAD_NAME].sort(lexicalCompare))) {
    fail("wakeflow-preservation-entry", "preservation entry stage has an invalid member set");
  }
  const source = readCanonicalManifest(path.join(entryRoot, MANIFEST_NAME));
  if (canonicalJson(source.manifest) !== canonicalJson(expectedManifest)) {
    fail("wakeflow-preservation-entry", "preservation entry stage manifest differs from the plan");
  }
  const payload = scanPayloadTree(path.join(entryRoot, PAYLOAD_NAME), source.manifest);
  if (
    payload.treeDigest !== source.manifest.payload.treeDigest.value
    || payload.projected.length !== source.manifest.payload.treeDigest.entries
    || payload.bytes !== source.manifest.payload.bytes
  ) {
    fail("wakeflow-preservation-digest-mismatch", "preservation entry stage payload differs");
  }
  const settled = fs.lstatSync(entryRoot, { bigint: true });
  if (!sameIdentity(rootStat, settled)) fail("wakeflow-preservation-race", "preservation stage changed");
  return {
    entryRoot,
    entryRef,
    manifest: source.manifest,
    manifestDigest: source.manifestDigest,
    payload,
    entryDigest: entryDigest(source.manifestDigest, payload.treeDigest),
  };
}

function publishStage(workspaceRoot, stageRef, finalRef, expectedManifest, expectedEntryDigest) {
  const stage = resolveRef(workspaceRoot, stageRef);
  const final = resolveRef(workspaceRoot, finalRef);
  const inspected = inspectEntryAtRef(workspaceRoot, stageRef, expectedManifest);
  if (inspected.entryDigest !== expectedEntryDigest || lstatIfPresent(final) !== null) {
    fail("wakeflow-preservation-stale", "preservation publish target changed before commit");
  }
  const stageStat = fs.lstatSync(stage, { bigint: true });
  try {
    fs.renameSync(stage, final);
  } catch (cause) {
    fail("wakeflow-preservation-publish", "cannot atomically publish preservation entry", {}, cause);
  }
  const finalStat = fs.lstatSync(final, { bigint: true });
  if (!sameRenamedIdentity(stageStat, finalStat)) {
    fail("wakeflow-preservation-race", "published preservation entry changed identity");
  }
  fsyncDirectory(path.dirname(final), "preservation publish parent");
  const settled = inspectEntryAtRef(workspaceRoot, finalRef, expectedManifest);
  if (settled.entryDigest !== expectedEntryDigest) {
    fail("wakeflow-preservation-publish", "published preservation entry failed verification");
  }
}

function cleanupInventoryMap(inventory) {
  const map = new Map();
  for (const entry of inventory) {
    if (map.has(entry.pathDigest)) fail("wakeflow-preservation-plan", "cleanup inventory contains duplicate paths");
    map.set(entry.pathDigest, entry);
  }
  return map;
}

function assertCleanupSubset(stage, cleanupInventory) {
  const stat = lstatIfPresent(stage);
  if (stat === null) return { state: "absent", entries: [] };
  const expected = cleanupInventoryMap(cleanupInventory);
  const entries = scanLooseTree(stage);
  for (const entry of entries) {
    const declaration = expected.get(pathDigest(entry.path));
    if (!declaration || declaration.type !== entry.type) {
      fail("wakeflow-preservation-release-stage", "preservation cleanup stage contains an unknown node");
    }
    const actualMode = entry.type === "symlink" ? null : modeString(entry.stat);
    if (actualMode !== declaration.mode) {
      fail("wakeflow-preservation-release-stage", "preservation cleanup stage node mode changed");
    }
    if (entry.type === "file") {
      const actual = fileDigest(entry.absolute, entry.stat, "preservation cleanup file");
      if (actual.contentDigest !== declaration.contentDigest || actual.bytes !== declaration.bytes) {
        fail("wakeflow-preservation-release-stage", "preservation cleanup file differs from its plan");
      }
    } else if (entry.type === "symlink") {
      const actual = symlinkDigest(entry.absolute, entry.stat, "preservation cleanup symlink");
      if (actual.contentDigest !== declaration.contentDigest || actual.bytes !== declaration.bytes) {
        fail("wakeflow-preservation-release-stage", "preservation cleanup symlink differs from its plan");
      }
    }
  }
  return { state: "present", entries };
}

function cleanupDetachedTree(stage, cleanupInventory) {
  for (;;) {
    const state = assertCleanupSubset(stage, cleanupInventory);
    if (state.state === "absent") return;
    const nonRoot = state.entries.filter((entry) => entry.path !== "");
    const files = nonRoot.filter((entry) => entry.type !== "directory").sort((a, b) => lexicalCompare(a.path, b.path));
    const directories = nonRoot.filter((entry) => entry.type === "directory").sort((a, b) => (
      b.path.split("/").length - a.path.split("/").length || lexicalCompare(a.path, b.path)
    ));
    const next = files[0] ?? directories.find((entry) => listDirectoryNames(
      entry.absolute,
      entry.stat,
      "preservation cleanup directory",
      MAX_TREE_ENTRIES,
    ).length === 0) ?? state.entries[0];
    if (!next) fail("wakeflow-preservation-release-stage", "preservation cleanup has no exact next node");
    if (next.path === "") {
      if (next.type === "directory" && listDirectoryNames(
        next.absolute,
        next.stat,
        "preservation cleanup root",
        MAX_TREE_ENTRIES,
      ).length !== 0) {
        fail("wakeflow-preservation-release-stage", "preservation cleanup root is not empty");
      }
      const current = fs.lstatSync(next.absolute, { bigint: true });
      if (!sameIdentity(current, next.stat)) {
        fail("wakeflow-preservation-race", "preservation cleanup root changed before removal");
      }
      if (next.type === "directory") fs.rmdirSync(next.absolute);
      else fs.unlinkSync(next.absolute);
    } else if (next.type === "directory") {
      if (listDirectoryNames(
        next.absolute,
        next.stat,
        "preservation cleanup directory",
        MAX_TREE_ENTRIES,
      ).length !== 0) {
        fail("wakeflow-preservation-release-stage", "preservation cleanup directory is not empty");
      }
      const current = fs.lstatSync(next.absolute, { bigint: true });
      if (!sameIdentity(current, next.stat)) {
        fail("wakeflow-preservation-race", "preservation cleanup directory changed before removal");
      }
      fs.rmdirSync(next.absolute);
    } else {
      const current = fs.lstatSync(next.absolute, { bigint: true });
      if (!sameIdentity(current, next.stat)) {
        fail("wakeflow-preservation-race", "preservation cleanup node changed before removal");
      }
      fs.unlinkSync(next.absolute);
    }
    fsyncDirectory(path.dirname(next.absolute), "preservation cleanup parent");
  }
}

// ==================== 四、冻结计划与领域语义闭包 ====================

function privateRootSnapshot(ref, digest) {
  return Object.freeze({ ref, type: "directory", mode: "0700", digest });
}

function privateFileSnapshot(ref, digest) {
  return Object.freeze({ ref, type: "file", mode: "0600", digest });
}

function absentSnapshot(ref) {
  return Object.freeze({ ref, type: "absent" });
}

function sourceSnapshot(ref, inventory) {
  return Object.freeze({
    ref,
    type: inventory.rootType,
    mode: inventory.rootMode,
    digest: inventory.treeDigest,
  });
}

function auditAuthorityDigest(programId) {
  return canonicalJsonDigest({ programId, authority: "wakeflow-local-preservation-root" });
}

function auditAuthoritySnapshot(programId) {
  return privateRootSnapshot(PRESERVED_REF, auditAuthorityDigest(programId));
}

function entryRef(preservationId) {
  return `${PRESERVED_REF}/${preservationId}`;
}

function publishStageRef(preservationId) {
  return `${PRESERVED_REF}/.${preservationId}.wakeflow-publish-stage`;
}

function detachStageRef(sourceRef, preservationId) {
  const parent = path.posix.dirname(sourceRef);
  const base = path.posix.basename(sourceRef);
  return `${parent}/.${base}.${preservationId}.wakeflow-detach-stage`;
}

function releaseStageRef(preservationId) {
  return `${PRESERVED_REF}/.${preservationId}.wakeflow-release-stage`;
}

function sortedBlockers(values) {
  const map = new Map();
  for (const value of values) {
    if (!TOKEN_RE.test(value.code) || !BLOCKER_SCOPES.has(value.scope)) {
      fail("wakeflow-preservation-plan", "preservation blocker is invalid");
    }
    map.set(`${value.scope}:${value.code}`, Object.freeze({ code: value.code, scope: value.scope }));
  }
  return Object.freeze([...map.values()].sort((left, right) => (
    lexicalCompare(left.scope, right.scope) || lexicalCompare(left.code, right.code)
  )));
}

function blockedPlan({ operation, programId, blockers, preservationId = null, entry = null, reviewedAt = null, decision = null, expectedTreeDigest = null }) {
  return buildPlan({
    operation,
    programId,
    preservationId,
    entry,
    manifest: null,
    manifestDigest: null,
    entryDigestValue: null,
    reviewedAt,
    decision,
    expectedTreeDigest,
    cleanupInventory: [],
    disposition: "blocked",
    blockers: sortedBlockers(blockers),
    steps: [],
  });
}

function buildPlan({
  operation,
  programId,
  preservationId,
  entry,
  manifest,
  manifestDigest,
  entryDigestValue,
  reviewedAt,
  decision,
  expectedTreeDigest,
  cleanupInventory,
  disposition,
  blockers,
  steps,
  retainedSource = undefined,
}) {
  const plan = validatePreservationPlan({
    schemaId: PLAN_SCHEMA_ID,
    payload: {
      schemaVersion: 1,
      artifactKind: PLAN_KIND,
      operation,
      programId,
      preservationId,
      entryRef: entry,
      manifest,
      manifestDigest,
      entryDigest: entryDigestValue,
      reviewedAt,
      decision,
      expectedTreeDigest,
      cleanupInventory,
      disposition,
      blockers,
      steps,
      ...(retainedSource === undefined ? {} : { retainedSource }),
    },
  });
  return deepFreeze({ plan, planDigest: canonicalJsonDigest(plan) });
}

function normalizeReason(value) {
  exactDataFields(value, ["code", "note"], [], "preservation reason");
  assertToken(value.code, "reason.code");
  if (
    value.note !== null
    && (
      typeof value.note !== "string"
      || Buffer.byteLength(value.note, "utf8") < 1
      || Buffer.byteLength(value.note, "utf8") > MAX_REASON_NOTE_BYTES
      || /[\u0000-\u001f\u007f-\u009f]/u.test(value.note)
    )
  ) {
    fail("wakeflow-preservation-contract", "reason.note must be bounded and control-free");
  }
  return frozenClone(value);
}

function normalizeLinks(value, producer) {
  exactDataFields(value, ["demandId", "archiveManifestDigest", "migrationId"], [], "preservation links");
  const normalized = frozenClone(value);
  validateLinks(normalized, producer);
  return normalized;
}

function normalizePreserveInput(input) {
  exactDataFields(input, [
    "workspaceRoot",
    "expectedProgramId",
    "producer",
    "sourceRef",
    "storageClass",
    "reason",
    "links",
    "createdAt",
  ], [], "local preservation plan input");
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const expectedProgramId = assertWakeflowId(input.expectedProgramId, "program", "$input/expectedProgramId");
  if (!PRODUCERS.includes(input.producer)) fail("wakeflow-preservation-contract", "producer is invalid");
  if (!STORAGE_CLASSES.has(input.storageClass)) fail("wakeflow-preservation-contract", "storageClass is invalid");
  if (input.producer === "migration") {
    fail(
      "wakeflow-preservation-contract",
      "migration preservation requires the source-retained migration planner",
    );
  }
  if (!validProducerStoragePair(input.producer, input.storageClass)) {
    fail("wakeflow-preservation-contract", "producer/storageClass pair is invalid");
  }
  return Object.freeze({
    workspaceRoot,
    expectedProgramId,
    producer: input.producer,
    sourceRef: assertPortableRef(input.sourceRef, "sourceRef"),
    storageClass: input.storageClass,
    reason: normalizeReason(input.reason),
    links: normalizeLinks(input.links, input.producer),
    createdAt: assertTimestamp(input.createdAt, "createdAt"),
  });
}

function normalizeMigrationHoldInput(input) {
  exactDataFields(input, [
    "workspaceRoot",
    "expectedProgramId",
    "preservationId",
    "sourceRef",
    "migrationId",
    "reasonCode",
    "createdAt",
  ], ["migrationAuthority"], "migration source-retained preservation plan input");
  let migrationAuthority = null;
  if (input.migrationAuthority !== undefined) {
    exactDataFields(input.migrationAuthority, [
      "configDigest",
      "preservedReviewAfterDays",
    ], [], "migration planning authority");
    const preservedReviewAfterDays = input.migrationAuthority.preservedReviewAfterDays;
    if (
      !Number.isSafeInteger(preservedReviewAfterDays)
      || preservedReviewAfterDays < 1
      || preservedReviewAfterDays > MAX_PRESERVED_REVIEW_AFTER_DAYS
    ) {
      fail(
        "wakeflow-preservation-contract",
        "migration planning authority has no valid review policy",
      );
    }
    migrationAuthority = Object.freeze({
      configDigest: assertDigest(
        input.migrationAuthority.configDigest,
        "migrationAuthority.configDigest",
      ),
      preservedReviewAfterDays,
    });
  }
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(input.workspaceRoot),
    expectedProgramId: assertWakeflowId(
      input.expectedProgramId,
      "program",
      "$input/expectedProgramId",
    ),
    preservationId: assertWakeflowId(
      input.preservationId,
      "preservation",
      "$input/preservationId",
    ),
    producer: "migration",
    sourceRef: assertPortableRef(input.sourceRef, "sourceRef"),
    storageClass: "migration-preimage",
    reason: Object.freeze({
      code: assertToken(input.reasonCode, "reasonCode"),
      note: null,
    }),
    links: Object.freeze({
      demandId: null,
      archiveManifestDigest: null,
      migrationId: assertToken(input.migrationId, "migrationId"),
    }),
    createdAt: assertTimestamp(input.createdAt, "createdAt"),
    migrationAuthority,
  });
}

function normalizeReleaseInput(input) {
  exactDataFields(input, [
    "workspaceRoot",
    "expectedProgramId",
    "preservationId",
    "expectedTreeDigest",
    "reviewedAt",
    "decision",
  ], [], "local preservation release plan input");
  if (input.decision !== "explicit-release") {
    fail("wakeflow-preservation-contract", "release decision must be explicit-release");
  }
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(input.workspaceRoot),
    expectedProgramId: assertWakeflowId(input.expectedProgramId, "program", "$input/expectedProgramId"),
    preservationId: assertWakeflowId(input.preservationId, "preservation", "$input/preservationId"),
    expectedTreeDigest: assertDigest(input.expectedTreeDigest, "expectedTreeDigest"),
    reviewedAt: assertTimestamp(input.reviewedAt, "reviewedAt"),
    decision: input.decision,
  });
}

function normalizeApplyInput(input) {
  exactDataFields(
    input,
    ["workspaceRoot", "expectedProgramId", "plan", "planDigest"],
    ["acquireTimeoutMs"],
    "local preservation apply input",
  );
  if (
    Object.hasOwn(input, "acquireTimeoutMs")
    && (!Number.isSafeInteger(input.acquireTimeoutMs) || input.acquireTimeoutMs < 0 || input.acquireTimeoutMs > 300_000)
  ) {
    fail("wakeflow-preservation-contract", "acquireTimeoutMs is invalid");
  }
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(input.workspaceRoot),
    expectedProgramId: assertWakeflowId(input.expectedProgramId, "program", "$input/expectedProgramId"),
    plan: input.plan,
    planDigest: assertDigest(input.planDigest, "planDigest"),
    ...(Object.hasOwn(input, "acquireTimeoutMs") ? { acquireTimeoutMs: input.acquireTimeoutMs } : {}),
  });
}

function normalizeRecoveryInput(input) {
  exactDataFields(
    input,
    ["workspaceRoot", "expectedProgramId", "operationId", "plan", "planDigest"],
    [],
    "local preservation recovery input",
  );
  if (typeof input.operationId !== "string" || !OPERATION_ID_RE.test(input.operationId)) {
    fail("wakeflow-preservation-contract", "operationId is not a workspace mutation ID");
  }
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(input.workspaceRoot),
    expectedProgramId: assertWakeflowId(input.expectedProgramId, "program", "$input/expectedProgramId"),
    operationId: input.operationId,
    plan: input.plan,
    planDigest: assertDigest(input.planDigest, "planDigest"),
  });
}

function loadAuthority(input) {
  const snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: input.workspaceRoot });
  if (snapshot.model.program.programId !== input.expectedProgramId) {
    fail("wakeflow-preservation-authority", "canonical config belongs to another program");
  }
  const reviewDays = snapshot.model.governance?.audit?.preservedReviewAfterDays;
  if (
    !Number.isSafeInteger(reviewDays)
    || reviewDays < 1
    || reviewDays > MAX_PRESERVED_REVIEW_AFTER_DAYS
  ) {
    fail("wakeflow-preservation-authority", "canonical config has no preserved review policy");
  }
  assertAuditRoots(input.workspaceRoot);
  return Object.freeze({ snapshot, reviewDays });
}

function isAtOrBelow(ref, root) {
  return ref === root || ref.startsWith(`${root}/`);
}

function directLegacyPreservedEntry(ref) {
  if (!ref.startsWith(`${LEGACY_PRESERVED_REF}/`)) return false;
  return ref.slice(LEGACY_PRESERVED_REF.length + 1).split("/").length === 1;
}

function directLegacyArchiveEntry(ref) {
  const segments = ref.split("/");
  if (segments.length < 4) return false;
  const [workspace, archive, yearMonth, entry] = segments.slice(-4);
  return workspace === "workspace"
    && archive === "archive"
    && /^[0-9]{4}-(?:0[1-9]|1[0-2])$/u.test(yearMonth)
    && entry.length > 0;
}

function sourceAdmission(input) {
  if (new Set(["archive-demand", "sanitize-archive"]).has(input.producer)) {
    return sortedBlockers([{ code: "producer-closure-unavailable", scope: "producer" }]);
  }
  if (input.producer === "storage-preserve") {
    if (input.storageClass !== "legacy") {
      return sortedBlockers([{ code: "inactive-source-unproven", scope: "source" }]);
    }
    if (!MANUAL_INACTIVE_ROOTS.some((root) => isAtOrBelow(input.sourceRef, root))) {
      return sortedBlockers([{ code: "active-or-unknown-source", scope: "source" }]);
    }
    return Object.freeze([]);
  }
  if (
    input.storageClass !== "migration-preimage"
    || input.links.migrationId === null
    || input.links.demandId !== null
    || input.links.archiveManifestDigest !== null
  ) {
    return sortedBlockers([{ code: "migration-source-unproven", scope: "source" }]);
  }
  if (
    !directLegacyPreservedEntry(input.sourceRef)
    && !directLegacyArchiveEntry(input.sourceRef)
    && !MANUAL_INACTIVE_ROOTS.some((root) => isAtOrBelow(input.sourceRef, root))
  ) {
    return sortedBlockers([{ code: "migration-source-not-admitted", scope: "source" }]);
  }
  return Object.freeze([]);
}

function preservationManifest(input, source, preservationId, reviewAfter) {
  return validateLocalPreservationManifest({
    kind: MANIFEST_KIND,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    programId: input.expectedProgramId,
    preservationId,
    producer: input.producer,
    createdAt: input.createdAt,
    source: {
      relativePath: input.sourceRef,
      storageClass: input.storageClass,
      type: source.rootType,
    },
    reason: input.reason,
    payload: {
      treeDigest: {
        algorithm: "sha256",
        value: source.treeDigest,
        entries: source.projected.length,
      },
      bytes: source.bytes,
    },
    retention: {
      class: "reviewable-local-audit",
      reviewAfter,
      requiresExplicitRelease: true,
    },
    links: input.links,
  });
}

function preserveSteps(programId, preservationId, sourceRefValue, source, entryDigestValue) {
  const finalRef = entryRef(preservationId);
  const stageRef = publishStageRef(preservationId);
  const detachRef = detachStageRef(sourceRefValue, preservationId);
  const sourceResource = sourceSnapshot(sourceRefValue, source);
  return Object.freeze([
    Object.freeze({
      stepId: "publish-local-preservation",
      ordinal: 0,
      stepKind: "audit-publish",
      source: auditAuthoritySnapshot(programId),
      staging: privateRootSnapshot(stageRef, entryDigestValue),
      final: privateRootSnapshot(finalRef, entryDigestValue),
    }),
    Object.freeze({
      stepId: "detach-local-preservation-source",
      ordinal: 1,
      stepKind: "remove",
      source: sourceResource,
      staging: { ...sourceResource, ref: detachRef },
      final: absentSnapshot(sourceRefValue),
    }),
  ]);
}

function migrationHoldStep(programId, preservationId, entryDigestValue) {
  return Object.freeze({
    stepId: `publish-migration-hold-${preservationId.slice("preservation_".length)}`,
    ordinal: 0,
    stepKind: "audit-publish",
    source: auditAuthoritySnapshot(programId),
    staging: privateRootSnapshot(publishStageRef(preservationId), entryDigestValue),
    final: privateRootSnapshot(entryRef(preservationId), entryDigestValue),
  });
}

function releaseStep(preservationId, entryDigestValue) {
  const ref = entryRef(preservationId);
  return Object.freeze({
    stepId: "release-local-preservation",
    ordinal: 0,
    stepKind: "remove",
    source: privateRootSnapshot(ref, entryDigestValue),
    staging: privateRootSnapshot(releaseStageRef(preservationId), entryDigestValue),
    final: absentSnapshot(ref),
  });
}

function derivePreservePlan(input) {
  const authority = loadAuthority(input);
  const blockers = sourceAdmission(input);
  if (blockers.length > 0) {
    return blockedPlan({ operation: "preserve", programId: input.expectedProgramId, blockers });
  }
  let source;
  try {
    source = scanSourceTree(input.workspaceRoot, input.sourceRef);
  } catch (cause) {
    if (cause instanceof WakeflowPreservationError && new Set([
      "wakeflow-preservation-source-missing",
      "wakeflow-preservation-source-mode",
      "wakeflow-preservation-unsupported-entry",
    ]).has(cause.code)) {
      return blockedPlan({
        operation: "preserve",
        programId: input.expectedProgramId,
        blockers: [{ code: cause.code.replace(/^wakeflow-preservation-/u, ""), scope: "source" }],
      });
    }
    throw cause;
  }
  const preservationId = generateWakeflowId("preservation");
  const manifest = preservationManifest(
    input,
    source,
    preservationId,
    addReviewDays(input.createdAt, authority.reviewDays),
  );
  const manifestDigest = sha256Bytes(localPreservationCanonicalBytes(manifest));
  const entryDigestValue = entryDigest(manifestDigest, source.treeDigest);
  return buildPlan({
    operation: "preserve",
    programId: input.expectedProgramId,
    preservationId,
    entry: entryRef(preservationId),
    manifest,
    manifestDigest,
    entryDigestValue,
    reviewedAt: null,
    decision: null,
    expectedTreeDigest: source.treeDigest,
    cleanupInventory: source.cleanupInventory,
    disposition: "eligible",
    blockers: [],
    steps: preserveSteps(input.expectedProgramId, preservationId, input.sourceRef, source, entryDigestValue),
  });
}

function deriveMigrationHoldPlan(input) {
  const authority = input.migrationAuthority === null
    ? loadAuthority(input)
    : Object.freeze({ reviewDays: input.migrationAuthority.preservedReviewAfterDays });
  const blockers = sourceAdmission(input);
  if (blockers.length > 0) {
    return blockedPlan({
      operation: "migration-hold",
      programId: input.expectedProgramId,
      preservationId: input.preservationId,
      entry: entryRef(input.preservationId),
      blockers,
    });
  }
  let source;
  try {
    source = scanSourceTree(input.workspaceRoot, input.sourceRef, {
      allowPublicRoot: directLegacyArchiveEntry(input.sourceRef),
    });
  } catch (cause) {
    if (cause instanceof WakeflowPreservationError && new Set([
      "wakeflow-preservation-source-missing",
      "wakeflow-preservation-source-mode",
      "wakeflow-preservation-unsupported-entry",
    ]).has(cause.code)) {
      return blockedPlan({
        operation: "migration-hold",
        programId: input.expectedProgramId,
        preservationId: input.preservationId,
        entry: entryRef(input.preservationId),
        blockers: [{ code: cause.code.replace(/^wakeflow-preservation-/u, ""), scope: "source" }],
      });
    }
    throw cause;
  }
  const manifest = preservationManifest(
    input,
    source,
    input.preservationId,
    addReviewDays(input.createdAt, authority.reviewDays),
  );
  const manifestDigest = sha256Bytes(localPreservationCanonicalBytes(manifest));
  const entryDigestValue = entryDigest(manifestDigest, source.treeDigest);
  return buildPlan({
    operation: "migration-hold",
    programId: input.expectedProgramId,
    preservationId: input.preservationId,
    entry: entryRef(input.preservationId),
    manifest,
    manifestDigest,
    entryDigestValue,
    reviewedAt: null,
    decision: null,
    expectedTreeDigest: source.treeDigest,
    cleanupInventory: source.cleanupInventory,
    disposition: "eligible",
    blockers: [],
    steps: [migrationHoldStep(input.expectedProgramId, input.preservationId, entryDigestValue)],
    retainedSource: sourceSnapshot(input.sourceRef, source),
  });
}

function releaseGate(entry, input) {
  const blockers = [];
  if (entry.manifest.payload.treeDigest.value !== input.expectedTreeDigest) {
    blockers.push({ code: "expected-tree-digest-mismatch", scope: "payload" });
  }
  if (
    timestampInstantNanoseconds(input.reviewedAt, "reviewedAt")
    < timestampInstantNanoseconds(entry.manifest.retention.reviewAfter, "reviewAfter")
  ) {
    blockers.push({ code: "review-not-eligible", scope: "review" });
  }
  if (
    entry.manifest.producer !== "storage-preserve"
    || entry.manifest.source.storageClass !== "legacy"
    || Object.values(entry.manifest.links).some((value) => value !== null)
  ) {
    blockers.push({ code: "external-release-authority-unavailable", scope: "link" });
  }
  return sortedBlockers(blockers);
}

function deriveReleasePlan(input) {
  loadAuthority(input);
  const entry = inspectEntry(input.workspaceRoot, input.preservationId, input.expectedProgramId);
  if (entry === null) {
    return buildPlan({
      operation: "release",
      programId: input.expectedProgramId,
      preservationId: input.preservationId,
      entry: entryRef(input.preservationId),
      manifest: null,
      manifestDigest: null,
      entryDigestValue: null,
      reviewedAt: input.reviewedAt,
      decision: input.decision,
      expectedTreeDigest: input.expectedTreeDigest,
      cleanupInventory: [],
      disposition: "source-absent",
      blockers: [],
      steps: [],
    });
  }
  const blockers = releaseGate(entry, input);
  if (blockers.length > 0) {
    return blockedPlan({
      operation: "release",
      programId: input.expectedProgramId,
      preservationId: input.preservationId,
      entry: entry.entryRef,
      reviewedAt: input.reviewedAt,
      decision: input.decision,
      expectedTreeDigest: input.expectedTreeDigest,
      blockers,
    });
  }
  return buildPlan({
    operation: "release",
    programId: input.expectedProgramId,
    preservationId: input.preservationId,
    entry: entry.entryRef,
    manifest: entry.manifest,
    manifestDigest: entry.manifestDigest,
    entryDigestValue: entry.entryDigest,
    reviewedAt: input.reviewedAt,
    decision: input.decision,
    expectedTreeDigest: input.expectedTreeDigest,
    cleanupInventory: entry.cleanupInventory,
    disposition: "eligible",
    blockers: [],
    steps: [releaseStep(input.preservationId, entry.entryDigest)],
  });
}

function validateResource(value, label) {
  if (value?.type === "absent") {
    exactDataFields(value, ["ref", "type"], [], label);
    assertPortableRef(value.ref, `${label}.ref`);
    return;
  }
  exactDataFields(value, ["ref", "type", "mode", "digest"], [], label);
  assertPortableRef(value.ref, `${label}.ref`);
  if (!new Set(["directory", "file"]).has(value.type) || !/^0[0-7]{3}$/u.test(value.mode)) {
    fail("wakeflow-preservation-plan", `${label} resource shape is invalid`);
  }
  assertDigest(value.digest, `${label}.digest`);
}

function validateCleanupInventory(value) {
  if (!Array.isArray(value) || value.length > MAX_TREE_ENTRIES + 1) {
    fail("wakeflow-preservation-plan", "cleanup inventory is invalid");
  }
  const keys = [];
  for (const [index, entry] of value.entries()) {
    exactDataFields(
      entry,
      ["pathDigest", "type", "mode", "contentDigest", "bytes"],
      [],
      `cleanup inventory ${index}`,
    );
    assertDigest(entry.pathDigest, `cleanup inventory ${index}.pathDigest`);
    if (!new Set(["directory", "file", "symlink"]).has(entry.type)) {
      fail("wakeflow-preservation-plan", "cleanup inventory type is invalid");
    }
    if (entry.type === "symlink") {
      if (entry.mode !== null) fail("wakeflow-preservation-plan", "symlink cleanup mode must be null");
    } else if (typeof entry.mode !== "string" || !/^0[0-7]{3}$/u.test(entry.mode)) {
      fail("wakeflow-preservation-plan", "cleanup inventory mode is invalid");
    }
    if (entry.type === "directory") {
      if (entry.contentDigest !== null || entry.bytes !== 0) {
        fail("wakeflow-preservation-plan", "directory cleanup content must be empty");
      }
    } else {
      assertDigest(entry.contentDigest, "cleanup inventory contentDigest");
      assertSafeInteger(entry.bytes, "cleanup inventory bytes");
    }
    keys.push(entry.pathDigest);
  }
  if (canonicalJson(keys) !== canonicalJson([...new Set(keys)].sort(lexicalCompare))) {
    fail("wakeflow-preservation-plan", "cleanup inventory must be sorted and unique");
  }
}

function validatePreservationPlan(value) {
  const plan = frozenClone(value);
  exactDataFields(plan, ["schemaId", "payload"], [], "local preservation plan");
  if (plan.schemaId !== PLAN_SCHEMA_ID) fail("wakeflow-preservation-plan", "plan schemaId is invalid");
  const payload = plan.payload;
  exactDataFields(payload, [
    "schemaVersion",
    "artifactKind",
    "operation",
    "programId",
    "preservationId",
    "entryRef",
    "manifest",
    "manifestDigest",
    "entryDigest",
    "reviewedAt",
    "decision",
    "expectedTreeDigest",
    "cleanupInventory",
    "disposition",
    "blockers",
    "steps",
  ], ["retainedSource"], "local preservation plan payload");
  if (payload.schemaVersion !== 1 || payload.artifactKind !== PLAN_KIND) {
    fail("wakeflow-preservation-plan", "plan kind/version is invalid");
  }
  if (!PRESERVATION_OPERATIONS.has(payload.operation)) {
    fail("wakeflow-preservation-plan", "plan operation is invalid");
  }
  assertWakeflowId(payload.programId, "program", "$plan/payload/programId");
  if (payload.preservationId !== null) {
    assertWakeflowId(payload.preservationId, "preservation", "$plan/payload/preservationId");
  }
  if (payload.entryRef !== null) assertPortableRef(payload.entryRef, "plan entryRef");
  if (payload.manifest !== null) validateLocalPreservationManifest(payload.manifest);
  for (const [name, digest] of [
    ["manifestDigest", payload.manifestDigest],
    ["entryDigest", payload.entryDigest],
    ["expectedTreeDigest", payload.expectedTreeDigest],
  ]) {
    if (digest !== null) assertDigest(digest, `plan.${name}`);
  }
  if (payload.reviewedAt !== null) assertTimestamp(payload.reviewedAt, "plan.reviewedAt");
  if (payload.decision !== null && payload.decision !== "explicit-release") {
    fail("wakeflow-preservation-plan", "plan decision is invalid");
  }
  if (Object.hasOwn(payload, "retainedSource")) {
    validateResource(payload.retainedSource, "plan retainedSource");
    if (payload.retainedSource.type === "absent") {
      fail("wakeflow-preservation-plan", "plan retainedSource must be present");
    }
  }
  validateCleanupInventory(payload.cleanupInventory);
  if (!new Set(["blocked", "eligible", "source-absent"]).has(payload.disposition)) {
    fail("wakeflow-preservation-plan", "plan disposition is invalid");
  }
  if (!Array.isArray(payload.blockers) || !Array.isArray(payload.steps)) {
    fail("wakeflow-preservation-plan", "plan collections are invalid");
  }
  if (Object.hasOwn(payload, "retainedSource") && payload.operation !== "migration-hold") {
    fail("wakeflow-preservation-plan", "only migration hold plans may declare retainedSource");
  }
  const blockers = sortedBlockers(payload.blockers);
  if (canonicalJson(blockers) !== canonicalJson(payload.blockers)) {
    fail("wakeflow-preservation-plan", "plan blockers must be sorted and unique");
  }
  for (const [index, step] of payload.steps.entries()) {
    exactDataFields(step, ["stepId", "ordinal", "stepKind", "source", "staging", "final"], [], `plan step ${index}`);
    assertToken(step.stepId, `plan step ${index}.stepId`);
    if (step.ordinal !== index || !new Set(["audit-publish", "remove"]).has(step.stepKind)) {
      fail("wakeflow-preservation-plan", "plan step kind/ordinal is invalid");
    }
    validateResource(step.source, `plan step ${index}.source`);
    validateResource(step.staging, `plan step ${index}.staging`);
    validateResource(step.final, `plan step ${index}.final`);
  }
  if (payload.disposition === "blocked") {
    const commonBlockedShape = payload.blockers.length > 0
      && payload.steps.length === 0
      && payload.cleanupInventory.length === 0
      && payload.manifest === null
      && payload.manifestDigest === null
      && payload.entryDigest === null
      && !Object.hasOwn(payload, "retainedSource");
    const operationShape = payload.operation === "preserve"
      ? payload.preservationId === null
        && payload.entryRef === null
        && payload.reviewedAt === null
        && payload.decision === null
        && payload.expectedTreeDigest === null
      : payload.operation === "migration-hold"
        ? payload.preservationId !== null
          && payload.entryRef === entryRef(payload.preservationId)
          && payload.reviewedAt === null
          && payload.decision === null
          && payload.expectedTreeDigest === null
        : payload.preservationId !== null
          && payload.entryRef === entryRef(payload.preservationId)
          && payload.reviewedAt !== null
          && payload.decision === "explicit-release"
          && payload.expectedTreeDigest !== null;
    if (!commonBlockedShape || !operationShape) {
      fail("wakeflow-preservation-plan", "blocked plan physical contract is invalid");
    }
    return plan;
  }
  if (payload.disposition === "source-absent") {
    if (
      payload.operation !== "release"
      || payload.preservationId === null
      || payload.entryRef !== entryRef(payload.preservationId)
      || payload.manifest !== null
      || payload.manifestDigest !== null
      || payload.entryDigest !== null
      || payload.reviewedAt === null
      || payload.decision !== "explicit-release"
      || payload.expectedTreeDigest === null
      || payload.cleanupInventory.length !== 0
      || payload.blockers.length !== 0
      || payload.steps.length !== 0
      || Object.hasOwn(payload, "retainedSource")
    ) {
      fail("wakeflow-preservation-plan", "source-absent plan contract is invalid");
    }
    return plan;
  }
  if (
    payload.blockers.length !== 0
    || payload.cleanupInventory.length === 0
    || payload.preservationId === null
    || payload.entryRef !== entryRef(payload.preservationId)
    || payload.manifest === null
    || payload.manifest.preservationId !== payload.preservationId
    || payload.manifest.programId !== payload.programId
    || payload.manifestDigest !== sha256Bytes(localPreservationCanonicalBytes(payload.manifest))
    || payload.entryDigest !== entryDigest(payload.manifestDigest, payload.manifest.payload.treeDigest.value)
    || payload.expectedTreeDigest !== payload.manifest.payload.treeDigest.value
  ) {
    fail("wakeflow-preservation-plan", "eligible plan authority closure is invalid");
  }
  if (payload.operation === "preserve") {
    if (Object.hasOwn(payload, "retainedSource")) {
      fail("wakeflow-preservation-plan", "normal preserve plans cannot retain a migration source");
    }
    if (
      payload.reviewedAt !== null
      || payload.decision !== null
      || payload.steps.length !== 2
      || payload.manifest.producer === "migration"
      || sourceAdmission({
        producer: payload.manifest.producer,
        storageClass: payload.manifest.source.storageClass,
        links: payload.manifest.links,
        sourceRef: payload.manifest.source.relativePath,
      }).length > 0
    ) {
      fail("wakeflow-preservation-plan", "eligible preserve plan shape is invalid");
    }
    const sourceRefValue = payload.manifest.source.relativePath;
    const source = payload.steps[1].source;
    const expected = [
      {
        stepId: "publish-local-preservation",
        ordinal: 0,
        stepKind: "audit-publish",
        source: auditAuthoritySnapshot(payload.programId),
        staging: privateRootSnapshot(publishStageRef(payload.preservationId), payload.entryDigest),
        final: privateRootSnapshot(payload.entryRef, payload.entryDigest),
      },
      {
        stepId: "detach-local-preservation-source",
        ordinal: 1,
        stepKind: "remove",
        source,
        staging: { ...source, ref: detachStageRef(sourceRefValue, payload.preservationId) },
        final: absentSnapshot(sourceRefValue),
      },
    ];
    if (
      source.ref !== sourceRefValue
      || source.type !== payload.manifest.source.type
      || source.digest !== payload.expectedTreeDigest
      || payload.cleanupInventory.length !== (
        payload.manifest.source.type === "file"
          ? 1
          : payload.manifest.payload.treeDigest.entries + 1
      )
      || canonicalJson(payload.steps) !== canonicalJson(expected)
    ) {
      fail("wakeflow-preservation-plan", "eligible preserve plan steps are invalid");
    }
  } else if (payload.operation === "migration-hold") {
    const sourceRefValue = payload.manifest.source.relativePath;
    if (
      payload.reviewedAt !== null
      || payload.decision !== null
      || payload.manifest.producer !== "migration"
      || payload.manifest.source.storageClass !== "migration-preimage"
      || sourceAdmission({
        producer: payload.manifest.producer,
        storageClass: payload.manifest.source.storageClass,
        links: payload.manifest.links,
        sourceRef: payload.manifest.source.relativePath,
      }).length > 0
      || !Object.hasOwn(payload, "retainedSource")
      || payload.retainedSource.ref !== sourceRefValue
      || payload.retainedSource.type !== payload.manifest.source.type
      || payload.retainedSource.digest !== payload.expectedTreeDigest
      || payload.cleanupInventory.length !== (
        payload.manifest.source.type === "file"
          ? 1
          : payload.manifest.payload.treeDigest.entries + 1
      )
      || payload.steps.length !== 1
      || canonicalJson(payload.steps[0]) !== canonicalJson(migrationHoldStep(
        payload.programId,
        payload.preservationId,
        payload.entryDigest,
      ))
    ) {
      fail("wakeflow-preservation-plan", "eligible migration hold plan shape is invalid");
    }
  } else {
    if (Object.hasOwn(payload, "retainedSource")) {
      fail("wakeflow-preservation-plan", "release plans cannot retain a migration source");
    }
    if (
      payload.reviewedAt === null
      || payload.decision !== "explicit-release"
      || releaseGate({ manifest: payload.manifest }, {
        expectedTreeDigest: payload.expectedTreeDigest,
        reviewedAt: payload.reviewedAt,
      }).length > 0
      || payload.cleanupInventory.length !== payload.manifest.payload.treeDigest.entries + 3
      || payload.steps.length !== 1
      || canonicalJson(payload.steps[0]) !== canonicalJson(releaseStep(payload.preservationId, payload.entryDigest))
    ) {
      fail("wakeflow-preservation-plan", "eligible release plan shape is invalid");
    }
  }
  return plan;
}

// ==================== 五、T02 participant、短期 manager lock 与前向恢复 ====================

function assertPlanIdentity(input, plan, planDigestValue) {
  const confirmed = validatePreservationPlan(plan);
  const actualDigest = canonicalJsonDigest(confirmed);
  if (actualDigest !== planDigestValue) fail("wakeflow-preservation-plan", "planDigest differs from plan");
  if (confirmed.payload.programId !== input.expectedProgramId) {
    fail("wakeflow-preservation-stale", "preservation plan belongs to another program");
  }
  return confirmed;
}

function managerLockRecord(context, plan) {
  return deepFreeze({
    schemaVersion: 1,
    artifactKind: MANAGER_LOCK_KIND,
    operationId: context.operationId,
    operation: plan.payload.operation,
    preservationId: plan.payload.preservationId,
  });
}

function readManagerLock(workspaceRoot) {
  const file = resolveRef(workspaceRoot, MANAGER_LOCK_REF);
  const stat = lstatIfPresent(file);
  if (stat === null) return null;
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
    || !statHasSingleLink(stat)
    || statMode(stat) !== FILE_MODE
    || stat.size > BigInt(MAX_MANAGER_LOCK_BYTES)
  ) {
    fail("wakeflow-preservation-manager-lock", "preservation manager lock is unsafe");
  }
  assertOwned(stat, "preservation manager lock");
  const bytes = readBoundedExactFile(
    file,
    stat,
    MAX_MANAGER_LOCK_BYTES,
    "preservation manager lock",
  );
  let value;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) throw new Error("not canonical line");
    value = JSON.parse(text.slice(0, -1));
    if (Buffer.from(`${canonicalJson(value)}\n`, "utf8").compare(bytes) !== 0) throw new Error("not canonical bytes");
  } catch (cause) {
    fail("wakeflow-preservation-manager-lock", "preservation manager lock is corrupt", {}, cause);
  }
  exactDataFields(
    value,
    ["schemaVersion", "artifactKind", "operationId", "operation", "preservationId"],
    [],
    "preservation manager lock",
  );
  if (
    value.schemaVersion !== 1
    || value.artifactKind !== MANAGER_LOCK_KIND
    || !OPERATION_ID_RE.test(value.operationId)
    || !PRESERVATION_OPERATIONS.has(value.operation)
  ) {
    fail("wakeflow-preservation-manager-lock", "preservation manager lock identity is invalid");
  }
  assertWakeflowId(value.preservationId, "preservation", "$managerLock/preservationId");
  return { value: deepFreeze(value), bytes, stat };
}

function acquireManagerLock(workspaceRoot, context, plan) {
  assertWakeflowMutationContext({ workspaceRoot, context });
  const expected = managerLockRecord(context, plan);
  const existing = readManagerLock(workspaceRoot);
  if (existing) {
    if (canonicalJson(existing.value) !== canonicalJson(expected)) {
      fail("wakeflow-preservation-manager-lock", "another preservation operation owns manager.lock");
    }
    return existing;
  }
  const file = resolveRef(workspaceRoot, MANAGER_LOCK_REF);
  const bytes = Buffer.from(`${canonicalJson(expected)}\n`, "utf8");
  let descriptor;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      FILE_MODE,
    );
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    fs.fchmodSync(descriptor, FILE_MODE);
    fs.fsyncSync(descriptor);
  } catch (cause) {
    fail("wakeflow-preservation-manager-lock", "cannot acquire preservation manager lock", {}, cause);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(file), "Wakeflow audit root");
  return readManagerLock(workspaceRoot);
}

function assertManagerLockCompatible(workspaceRoot, plan, operationId = null) {
  const lock = readManagerLock(workspaceRoot);
  if (lock === null) return null;
  if (
    lock.value.operation !== plan.payload.operation
    || lock.value.preservationId !== plan.payload.preservationId
    || (operationId !== null && lock.value.operationId !== operationId)
  ) {
    fail("wakeflow-preservation-manager-lock", "preservation manager lock differs from the plan");
  }
  return lock;
}

function releaseManagerLock(workspaceRoot, context, plan) {
  assertWakeflowMutationContext({ workspaceRoot, context });
  const lock = readManagerLock(workspaceRoot);
  if (lock === null) return;
  const expected = managerLockRecord(context, plan);
  if (canonicalJson(lock.value) !== canonicalJson(expected)) {
    fail("wakeflow-preservation-manager-lock", "preservation manager lock ownership changed");
  }
  const file = resolveRef(workspaceRoot, MANAGER_LOCK_REF);
  const current = fs.lstatSync(file, { bigint: true });
  if (!sameIdentity(current, lock.stat)) fail("wakeflow-preservation-race", "manager lock changed before release");
  fs.unlinkSync(file);
  fsyncDirectory(path.dirname(file), "Wakeflow audit root");
}

function sourceMatchesPlan(workspaceRoot, plan) {
  const sourceRefValue = plan.payload.manifest.source.relativePath;
  const inventory = scanSourceTree(workspaceRoot, sourceRefValue, {
    allowPublicRoot: plan.payload.operation === "migration-hold"
      && directLegacyArchiveEntry(sourceRefValue),
  });
  const declaration = plan.payload.operation === "migration-hold"
    ? plan.payload.retainedSource
    : plan.payload.steps[1].source;
  const differences = [
    ...(inventory.rootType === declaration.type ? [] : ["type"]),
    ...(inventory.rootMode === declaration.mode ? [] : ["mode"]),
    ...(inventory.treeDigest === declaration.digest ? [] : ["tree-digest"]),
    ...(canonicalJson(inventory.cleanupInventory) === canonicalJson(plan.payload.cleanupInventory)
      ? []
      : ["cleanup-inventory"]),
  ];
  if (differences.length > 0) {
    fail("wakeflow-preservation-stale", "preservation source differs from the confirmed plan", {
      differences,
    });
  }
  return inventory;
}

function inspectPreserveState(workspaceRoot, plan) {
  const sourceRefValue = plan.payload.manifest.source.relativePath;
  const sourcePath = resolveRef(workspaceRoot, sourceRefValue);
  const publishStage = resolveRef(workspaceRoot, publishStageRef(plan.payload.preservationId));
  const final = resolveRef(workspaceRoot, plan.payload.entryRef);
  const detachStage = resolveRef(
    workspaceRoot,
    detachStageRef(sourceRefValue, plan.payload.preservationId),
  );
  const finalStat = lstatIfPresent(final);
  const publishStat = lstatIfPresent(publishStage);
  const sourceStat = lstatIfPresent(sourcePath);
  const detachStat = lstatIfPresent(detachStage);
  if (finalStat && publishStat) fail("wakeflow-preservation-stage", "final entry and publish stage coexist");
  if (sourceStat && detachStat) fail("wakeflow-preservation-stage", "source and detach stage coexist");
  let finalEntry = null;
  if (finalStat) {
    finalEntry = inspectEntryAtRef(workspaceRoot, plan.payload.entryRef, plan.payload.manifest);
    if (finalEntry.entryDigest !== plan.payload.entryDigest) {
      fail("wakeflow-preservation-stale", "published preservation entry differs from the plan");
    }
  }
  let publishState = "absent";
  if (publishStat) {
    try {
      const staged = inspectEntryAtRef(
        workspaceRoot,
        publishStageRef(plan.payload.preservationId),
        plan.payload.manifest,
      );
      if (staged.entryDigest !== plan.payload.entryDigest) {
        fail("wakeflow-preservation-stage", "preservation publish stage differs from the plan");
      }
      publishState = "full";
    } catch (cause) {
      if (cause instanceof WakeflowPreservationError) publishState = "partial";
      else throw cause;
    }
  }
  let source = null;
  if (sourceStat) source = sourceMatchesPlan(workspaceRoot, plan);
  let detached = { state: "absent", entries: [] };
  if (detachStat) detached = assertCleanupSubset(detachStage, plan.payload.cleanupInventory);
  if (!finalStat && (!sourceStat || detachStat)) {
    fail("wakeflow-preservation-stage", "unpublished preservation lost its exact source");
  }
  if (finalStat && sourceStat === null && detachStat === null) {
    return { state: "source-cleaned", finalEntry, publishState, source, detached };
  }
  if (finalStat && detachStat) {
    return { state: "source-detached", finalEntry, publishState, source, detached };
  }
  if (finalStat) return { state: "published", finalEntry, publishState, source, detached };
  return { state: publishState === "full" ? "publish-prepared" : publishState === "partial" ? "publish-partial" : "initial", finalEntry, publishState, source, detached };
}

function preservedRootObservation(workspaceRoot, programId) {
  assertPrivateDirectory(resolveRef(workspaceRoot, PRESERVED_REF), "Wakeflow preserved root");
  return auditAuthoritySnapshot(programId);
}

function createPreserveParticipant(input, plan, { recovery, retainSource = false }) {
  if (retainSource !== (plan.payload.operation === "migration-hold")) {
    fail("wakeflow-preservation-plan", "preservation participant mode differs from its plan");
  }
  const publishStep = plan.payload.steps[0];
  const detachStep = retainSource ? null : plan.payload.steps[1];
  const sourceRefValue = plan.payload.manifest.source.relativePath;
  const publishRef = publishStageRef(plan.payload.preservationId);
  const detachRef = retainSource ? null : detachStageRef(sourceRefValue, plan.payload.preservationId);
  const verifyAuthority = (context = null) => {
    loadAuthority(input);
    const state = inspectPreserveState(input.workspaceRoot, plan);
    const operationId = recovery
      ? context?.operationId ?? input.operationId ?? null
      : null;
    const lock = assertManagerLockCompatible(input.workspaceRoot, plan, operationId);
    if (!recovery && lock !== null) fail("wakeflow-preservation-stale", "unexpected preservation manager lock exists");
    const admitted = retainSource
      ? recovery
        ? new Set(["initial", "publish-partial", "publish-prepared", "published"])
        : new Set(["initial", "published"])
      : recovery
        ? new Set(["initial", "publish-partial", "publish-prepared", "published", "source-detached", "source-cleaned"])
        : new Set(["initial"]);
    if (!admitted.has(state.state)) {
      fail("wakeflow-preservation-stale", "preservation physical state changed before apply");
    }
    return state;
  };
  const publishHandler = {
    prepare({ context }) {
      acquireManagerLock(input.workspaceRoot, context, plan);
      const state = inspectPreserveState(input.workspaceRoot, plan);
      if (!new Set(["initial", "publish-partial"]).has(state.state)) {
        fail("wakeflow-preservation-stale", "preservation publish prepare requires its exact source");
      }
      const source = state.source ?? sourceMatchesPlan(input.workspaceRoot, plan);
      materializePublishStage(input.workspaceRoot, plan, source, publishRef);
    },
    observe({ context }) {
      assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
      const state = inspectPreserveState(input.workspaceRoot, plan);
      const source = preservedRootObservation(input.workspaceRoot, plan.payload.programId);
      if (state.publishState === "full") {
        return { source, staging: publishStep.staging, final: absentSnapshot(publishStep.final.ref) };
      }
      if (state.finalEntry) {
        return { source, staging: absentSnapshot(publishStep.staging.ref), final: publishStep.final };
      }
      return { source, staging: absentSnapshot(publishStep.staging.ref), final: absentSnapshot(publishStep.final.ref) };
    },
    commit({ context }) {
      assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
      publishStage(
        input.workspaceRoot,
        publishStep.staging.ref,
        publishStep.final.ref,
        plan.payload.manifest,
        plan.payload.entryDigest,
      );
    },
    ...(retainSource ? {
      cleanup({ context }) {
        assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
        const state = inspectPreserveState(input.workspaceRoot, plan);
        if (state.state !== "published") {
          fail("wakeflow-preservation-terminal", "migration hold cleanup requires an exact retained source");
        }
        releaseManagerLock(input.workspaceRoot, context, plan);
      },
    } : {}),
  };
  const stepHandlers = {
    [publishStep.stepId]: Object.freeze(publishHandler),
  };
  if (!retainSource) {
    stepHandlers[detachStep.stepId] = Object.freeze({
      prepare({ context }) {
        assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
        const state = inspectPreserveState(input.workspaceRoot, plan);
        if (state.state !== "published") {
          fail("wakeflow-preservation-stale", "source detach requires the published preservation entry");
        }
      },
      observe({ context }) {
        assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
        const state = inspectPreserveState(input.workspaceRoot, plan);
        if (state.state === "published") {
          return { source: detachStep.source, staging: absentSnapshot(detachRef), final: detachStep.source };
        }
        if (state.state === "source-detached") {
          return { source: absentSnapshot(sourceRefValue), staging: detachStep.staging, final: absentSnapshot(sourceRefValue) };
        }
        if (state.state === "source-cleaned") {
          return { source: absentSnapshot(sourceRefValue), staging: absentSnapshot(detachRef), final: absentSnapshot(sourceRefValue) };
        }
        fail("wakeflow-preservation-stage", "source detach observation is invalid");
      },
      commit({ context }) {
        assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
        const source = resolveRef(input.workspaceRoot, sourceRefValue);
        const stage = resolveRef(input.workspaceRoot, detachRef);
        const currentSource = sourceMatchesPlan(input.workspaceRoot, plan);
        const before = fs.lstatSync(source, { bigint: true });
        if (!sameIdentity(before, currentSource.rootStat)) {
          fail("wakeflow-preservation-race", "preservation source changed before detach");
        }
        if (lstatIfPresent(stage) !== null) fail("wakeflow-preservation-stage", "detach stage already exists");
        fs.renameSync(source, stage);
        const after = fs.lstatSync(stage, { bigint: true });
        if (!sameRenamedIdentity(before, after)) fail("wakeflow-preservation-race", "detached source identity changed");
        fsyncDirectory(path.dirname(stage), "preservation source parent");
      },
      cleanup({ context }) {
        assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
        cleanupDetachedTree(resolveRef(input.workspaceRoot, detachRef), plan.payload.cleanupInventory);
        releaseManagerLock(input.workspaceRoot, context, plan);
      },
    });
  }
  return Object.freeze({
    validatePlan({ plan: candidate }) {
      const validated = validatePreservationPlan(candidate);
      if (canonicalJson(validated) !== canonicalJson(plan)) {
        fail("wakeflow-preservation-plan", "mutation manager received another preservation plan");
      }
      return { valid: true };
    },
    deriveCurrentPlan({ context = null } = {}) {
      verifyAuthority(context);
      return plan;
    },
    deriveTerminalClosure({ context, plan: received, planDigest }) {
      assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
      if (canonicalJson(received) !== canonicalJson(plan) || planDigest !== canonicalJsonDigest(plan)) {
        fail("wakeflow-preservation-plan", "terminal closure received another plan");
      }
      const state = inspectPreserveState(input.workspaceRoot, plan);
      const terminalStates = retainSource
        ? new Set(["published"])
        : new Set(["source-detached", "source-cleaned"]);
      if (!terminalStates.has(state.state)) {
        fail(
          "wakeflow-preservation-terminal",
          retainSource
            ? "migration preservation source is not retained after publish"
            : "preservation source is not detached after publish",
        );
      }
      assertManagerLockCompatible(input.workspaceRoot, plan, context.operationId);
      return {
        planDigest,
        closureDigests: [
          { name: "preservation-manifest", digest: plan.payload.manifestDigest },
          { name: "preservation-payload", digest: plan.payload.expectedTreeDigest },
          {
            name: retainSource ? "preservation-source-retained" : "preservation-source-detached",
            digest: canonicalJsonDigest({
              sourceRefDigest: pathDigest(sourceRefValue),
              treeDigest: plan.payload.expectedTreeDigest,
              state: retainSource ? "retained" : "absent",
            }),
          },
        ],
      };
    },
    stepHandlers: Object.freeze(stepHandlers),
  });
}

function inspectReleaseState(workspaceRoot, plan) {
  const sourceRefValue = plan.payload.entryRef;
  const stageRef = releaseStageRef(plan.payload.preservationId);
  const source = inspectEntry(workspaceRoot, plan.payload.preservationId, plan.payload.programId);
  const stagePath = resolveRef(workspaceRoot, stageRef);
  const stageStat = lstatIfPresent(stagePath);
  if (source && stageStat) fail("wakeflow-preservation-release-stage", "release source and stage coexist");
  if (source) {
    if (
      source.entryDigest !== plan.payload.entryDigest
      || canonicalJson(source.cleanupInventory) !== canonicalJson(plan.payload.cleanupInventory)
    ) {
      fail("wakeflow-preservation-stale", "release source differs from the confirmed plan");
    }
    return { state: "source", source, stageRef };
  }
  if (stageStat) {
    const subset = assertCleanupSubset(stagePath, plan.payload.cleanupInventory);
    return { state: "staged", source: null, stageRef, subset };
  }
  return { state: "absent", source: null, stageRef };
}

function createReleaseParticipant(input, plan, { recovery }) {
  const step = plan.payload.steps[0];
  const verifyAuthority = () => {
    loadAuthority(input);
    const state = inspectReleaseState(input.workspaceRoot, plan);
    const lock = assertManagerLockCompatible(input.workspaceRoot, plan, recovery ? input.operationId ?? null : null);
    if (!recovery && lock !== null) fail("wakeflow-preservation-stale", "unexpected preservation manager lock exists");
    if (!recovery && state.state !== "source") fail("wakeflow-preservation-stale", "release source changed before apply");
    if (state.source) {
      const blockers = releaseGate(state.source, {
        expectedTreeDigest: plan.payload.expectedTreeDigest,
        reviewedAt: plan.payload.reviewedAt,
      });
      if (blockers.length > 0) fail("wakeflow-preservation-blocked", "release authority is no longer closed", { blockers });
    }
    return state;
  };
  return Object.freeze({
    validatePlan({ plan: candidate }) {
      const validated = validatePreservationPlan(candidate);
      if (canonicalJson(validated) !== canonicalJson(plan)) {
        fail("wakeflow-preservation-plan", "mutation manager received another release plan");
      }
      return { valid: true };
    },
    deriveCurrentPlan() {
      verifyAuthority();
      return plan;
    },
    deriveTerminalClosure({ context, plan: received, planDigest }) {
      assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
      if (canonicalJson(received) !== canonicalJson(plan) || planDigest !== canonicalJsonDigest(plan)) {
        fail("wakeflow-preservation-plan", "release closure received another plan");
      }
      const state = inspectReleaseState(input.workspaceRoot, plan);
      if (!new Set(["staged", "absent"]).has(state.state)) {
        fail("wakeflow-preservation-terminal", "released preservation remains in the canonical namespace");
      }
      assertManagerLockCompatible(input.workspaceRoot, plan, context.operationId);
      return {
        planDigest,
        closureDigests: [
          { name: "released-preservation-manifest", digest: plan.payload.manifestDigest },
          { name: "released-preservation-payload", digest: plan.payload.expectedTreeDigest },
          {
            name: "released-preservation-absent",
            digest: canonicalJsonDigest({ preservationId: plan.payload.preservationId, state: "absent" }),
          },
        ],
      };
    },
    stepHandlers: Object.freeze({
      [step.stepId]: Object.freeze({
        prepare({ context }) {
          acquireManagerLock(input.workspaceRoot, context, plan);
          const state = inspectReleaseState(input.workspaceRoot, plan);
          if (state.state !== "source") fail("wakeflow-preservation-stale", "release prepare requires exact source");
        },
        observe({ context }) {
          assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
          const state = inspectReleaseState(input.workspaceRoot, plan);
          if (state.state === "source") return { source: step.source, staging: absentSnapshot(step.staging.ref), final: step.source };
          if (state.state === "staged") return { source: absentSnapshot(step.source.ref), staging: step.staging, final: absentSnapshot(step.source.ref) };
          return { source: absentSnapshot(step.source.ref), staging: absentSnapshot(step.staging.ref), final: absentSnapshot(step.source.ref) };
        },
        commit({ context }) {
          assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
          const source = resolveRef(input.workspaceRoot, step.source.ref);
          const stage = resolveRef(input.workspaceRoot, step.staging.ref);
          const currentState = inspectReleaseState(input.workspaceRoot, plan);
          if (currentState.state !== "source") {
            fail("wakeflow-preservation-stale", "release source changed before detach");
          }
          const before = fs.lstatSync(source, { bigint: true });
          if (lstatIfPresent(stage) !== null) fail("wakeflow-preservation-release-stage", "release stage already exists");
          fs.renameSync(source, stage);
          const after = fs.lstatSync(stage, { bigint: true });
          if (!sameRenamedIdentity(before, after)) fail("wakeflow-preservation-race", "released entry identity changed");
          fsyncDirectory(path.dirname(stage), "preservation release parent");
        },
        cleanup({ context }) {
          assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
          cleanupDetachedTree(resolveRef(input.workspaceRoot, step.staging.ref), plan.payload.cleanupInventory);
          releaseManagerLock(input.workspaceRoot, context, plan);
        },
      }),
    }),
  });
}

function mutationParticipant(input, plan, { recovery }) {
  if (plan.payload.operation === "preserve") {
    return createPreserveParticipant(input, plan, { recovery });
  }
  if (plan.payload.operation === "release") {
    return createReleaseParticipant(input, plan, { recovery });
  }
  fail(
    "wakeflow-preservation-contract",
    "migration hold plans require the migration-only participant seam",
  );
}

// ==================== 六、脱敏 inventory 与公开窄入口 ====================

function publicInventoryEntry(entry, reviewedAt) {
  const eligible = reviewedAt !== null
    && timestampInstantNanoseconds(reviewedAt, "reviewedAt")
      >= timestampInstantNanoseconds(entry.manifest.retention.reviewAfter, "reviewAfter");
  return Object.freeze({
    preservationId: entry.manifest.preservationId,
    ref: entry.entryRef,
    manifestDigest: entry.manifestDigest,
    payloadTreeDigest: entry.payload.treeDigest,
    entries: entry.payload.projected.length,
    bytes: entry.payload.bytes,
    producer: entry.manifest.producer,
    createdAt: entry.manifest.createdAt,
    reviewAfter: entry.manifest.retention.reviewAfter,
    status: eligible ? "review-eligible" : "valid",
  });
}

function inventoryIssue(code, ref) {
  return Object.freeze({ code, refDigest: pathDigest(ref) });
}

function inspectInventory(input) {
  exactDataFields(
    input,
    ["workspaceRoot", "expectedProgramId"],
    ["reviewedAt"],
    "local preservation inventory input",
  );
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const expectedProgramId = assertWakeflowId(input.expectedProgramId, "program", "$input/expectedProgramId");
  const reviewedAt = Object.hasOwn(input, "reviewedAt") && input.reviewedAt !== null
    ? assertTimestamp(input.reviewedAt, "reviewedAt")
    : null;
  assertWorkspaceRoot(workspaceRoot);
  const preservedRoot = resolveRef(workspaceRoot, PRESERVED_REF);
  const preservedStat = lstatIfPresent(preservedRoot);
  if (preservedStat === null) {
    const unsigned = {
      schemaVersion: 1,
      artifactKind: INVENTORY_KIND,
      programId: expectedProgramId,
      status: "missing",
      entries: [],
      issues: [],
      summary: { valid: 0, reviewEligible: 0, blocked: 0, bytes: 0, oldestReviewAfter: null },
      managerLock: { status: "absent" },
    };
    return deepFreeze({ ...unsigned, inventoryDigest: canonicalJsonDigest(unsigned) });
  }
  assertAuditRoots(workspaceRoot);
  const entries = [];
  const issues = [];
  const names = listDirectoryNames(
    preservedRoot,
    preservedStat,
    "Wakeflow preserved root",
    MAX_TREE_ENTRIES + 2,
  );
  for (const name of names) {
    const ref = `${PRESERVED_REF}/${name}`;
    try {
      assertWakeflowId(name, "preservation", "$preservedEntry");
      const entry = inspectEntry(workspaceRoot, name, expectedProgramId);
      if (entry === null) throw new WakeflowPreservationError("wakeflow-preservation-entry", "entry disappeared");
      entries.push(publicInventoryEntry(entry, reviewedAt));
    } catch (cause) {
      issues.push(inventoryIssue(causeCode(cause), ref));
    }
  }
  let managerLock;
  try {
    const lock = readManagerLock(workspaceRoot);
    managerLock = lock === null
      ? { status: "absent" }
      : {
        status: "current",
        operationId: lock.value.operationId,
        operation: lock.value.operation,
        preservationId: lock.value.preservationId,
      };
  } catch (cause) {
    managerLock = { status: "invalid", code: causeCode(cause) };
    issues.push(inventoryIssue(causeCode(cause), MANAGER_LOCK_REF));
  }
  entries.sort((left, right) => lexicalCompare(left.preservationId, right.preservationId));
  issues.sort((left, right) => lexicalCompare(`${left.code}:${left.refDigest}`, `${right.code}:${right.refDigest}`));
  const reviewEligible = entries.filter((entry) => entry.status === "review-eligible");
  const totalBytes = entries.reduce((total, entry) => {
    const next = total + entry.bytes;
    if (!Number.isSafeInteger(next)) {
      fail("wakeflow-preservation-limit", "preservation inventory byte count overflowed");
    }
    return next;
  }, 0);
  const settledPreservedRoot = fs.lstatSync(preservedRoot, { bigint: true });
  if (!sameIdentity(preservedStat, settledPreservedRoot)) {
    fail("wakeflow-preservation-race", "Wakeflow preserved root changed during inventory");
  }
  const unsigned = {
    schemaVersion: 1,
    artifactKind: INVENTORY_KIND,
    programId: expectedProgramId,
    status: issues.length > 0 ? "corrupt" : entries.length > 0 ? "current" : "empty",
    entries,
    issues,
    summary: {
      valid: entries.length - reviewEligible.length,
      reviewEligible: reviewEligible.length,
      blocked: issues.length,
      bytes: totalBytes,
      oldestReviewAfter: entries.length === 0
        ? null
        : entries.map((entry) => entry.reviewAfter).sort(lexicalCompare)[0],
    },
    managerLock,
  };
  return deepFreeze({ ...unsigned, inventoryDigest: canonicalJsonDigest(unsigned) });
}

/**
 * 列出strict-valid entry与hash-only issue；reviewedAt只影响只读资格标签，不产生删除权。
 */
export function inspectLocalPreservationInventory(input = {}) {
  try {
    return inspectInventory(input);
  } catch (cause) {
    wrap(cause, "inventory inspection");
  }
}

/** layout inspector专用视图：固定不计算review资格，避免观察时间污染布局digest。 */
export function inspectLocalPreservationInventoryForLayout(input = {}) {
  try {
    exactDataFields(input, ["workspaceRoot", "expectedProgramId"], [], "layout preservation inventory input");
    return inspectInventory({ ...input, reviewedAt: null });
  } catch (cause) {
    wrap(cause, "layout inspection");
  }
}

/**
 * 为普通storage/archive/sanitize入口生成计划；migration必须走下方专用retained-hold入口。
 */
export function planLocalPreservation(input = {}) {
  try {
    return derivePreservePlan(normalizePreserveInput(input));
  } catch (cause) {
    wrap(cause, "planning");
  }
}

/** 生成只发布audit entry、绝不提前detach迁移源树的migration-hold计划。 */
export function planMigrationSourceRetainedPreservation(input = {}) {
  try {
    return deriveMigrationHoldPlan(normalizeMigrationHoldInput(input));
  } catch (cause) {
    wrap(cause, "migration hold planning");
  }
}

/** 把已确认migration-hold计划适配给外层migration拥有的同一个T02 transaction。 */
export function createMigrationSourceRetainedPreservationParticipant(input = {}) {
  try {
    exactDataFields(input, [
      "workspaceRoot",
      "expectedProgramId",
      "admission",
      "confirmedPlan",
    ], [], "migration source-retained preservation participant input");
    const normalized = Object.freeze({
      workspaceRoot: normalizeWorkspaceRoot(input.workspaceRoot),
      expectedProgramId: assertWakeflowId(
        input.expectedProgramId,
        "program",
        "$input/expectedProgramId",
      ),
      admission: input.admission,
    });
    if (!new Set(["apply", "recovery"]).has(normalized.admission)) {
      fail("wakeflow-preservation-contract", "migration hold admission must be apply or recovery");
    }
    const confirmed = validatePreservationPlan(input.confirmedPlan);
    if (
      confirmed.payload.operation !== "migration-hold"
      || confirmed.payload.disposition !== "eligible"
      || confirmed.payload.programId !== normalized.expectedProgramId
    ) {
      fail(
        "wakeflow-preservation-plan",
        "only one eligible matching migration hold plan may create this participant",
      );
    }
    return createPreserveParticipant(normalized, confirmed, {
      recovery: normalized.admission === "recovery",
      retainSource: true,
    });
  } catch (cause) {
    wrap(cause, "migration hold participant creation");
  }
}

/** 为单一manual legacy hold生成exact digest + explicit decision release计划。 */
export function planLocalPreservationRelease(input = {}) {
  try {
    return deriveReleasePlan(normalizeReleaseInput(input));
  } catch (cause) {
    wrap(cause, "release planning");
  }
}

/** 执行普通preserve/release计划；明确拒绝migration-hold借用standalone入口。 */
export async function applyLocalPreservationPlan(input = {}) {
  try {
    const normalized = normalizeApplyInput(input);
    const confirmed = assertPlanIdentity(normalized, normalized.plan, normalized.planDigest);
    if (confirmed.payload.operation === "migration-hold") {
      fail(
        "wakeflow-preservation-contract",
        "migration holds cannot use the standalone preservation apply entrypoint",
      );
    }
    if (confirmed.payload.disposition === "blocked") {
      fail("wakeflow-preservation-blocked", "a blocked preservation plan cannot be applied", {
        blockers: confirmed.payload.blockers,
      });
    }
    if (confirmed.payload.disposition === "source-absent") {
      const current = deriveReleasePlan({
        workspaceRoot: normalized.workspaceRoot,
        expectedProgramId: normalized.expectedProgramId,
        preservationId: confirmed.payload.preservationId,
        expectedTreeDigest: confirmed.payload.expectedTreeDigest,
        reviewedAt: confirmed.payload.reviewedAt,
        decision: confirmed.payload.decision,
      });
      if (current.planDigest !== normalized.planDigest) {
        fail("wakeflow-preservation-stale", "source-absent preservation plan is stale");
      }
      return deepFreeze({ status: "source-absent", planDigest: normalized.planDigest });
    }
    const participantInput = { ...normalized };
    const participant = mutationParticipant(participantInput, confirmed, { recovery: false });
    const result = await runWakeflowMaintenanceMutation({
      workspaceRoot: normalized.workspaceRoot,
      action: "reconcile",
      operationKind: confirmed.payload.operation === "preserve"
        ? "local-audit-preserve"
        : "local-audit-release",
      domainOwner: "preservation-manager",
      ...(normalized.acquireTimeoutMs === undefined ? {} : { acquireTimeoutMs: normalized.acquireTimeoutMs }),
      confirmedPlan: confirmed,
      planDigest: normalized.planDigest,
      validatePlan: participant.validatePlan,
      deriveCurrentPlan: participant.deriveCurrentPlan,
      deriveTerminalClosure: participant.deriveTerminalClosure,
      stepHandlers: participant.stepHandlers,
    });
    return deepFreeze({
      status: result.status,
      operationId: result.operationId,
      operation: confirmed.payload.operation,
      preservationId: confirmed.payload.preservationId,
      planDigest: result.planDigest,
    });
  } catch (cause) {
    wrap(cause, "apply");
  }
}

/** 只按指定operationId前向恢复普通preserve/release，不扫描或猜测待恢复操作。 */
export async function recoverLocalPreservationMutation(input = {}) {
  try {
    const normalized = normalizeRecoveryInput(input);
    const confirmed = assertPlanIdentity(normalized, normalized.plan, normalized.planDigest);
    if (confirmed.payload.operation === "migration-hold") {
      fail(
        "wakeflow-preservation-contract",
        "migration holds cannot use the standalone preservation recovery entrypoint",
      );
    }
    if (confirmed.payload.disposition !== "eligible") {
      fail("wakeflow-preservation-plan", "only eligible preservation plans own recovery");
    }
    const participantInput = { ...normalized };
    const participant = mutationParticipant(participantInput, confirmed, { recovery: true });
    const result = await recoverWakeflowWorkspaceMutation({
      workspaceRoot: normalized.workspaceRoot,
      operationId: normalized.operationId,
      confirmedPlan: confirmed,
      planDigest: normalized.planDigest,
      validatePlan: participant.validatePlan,
      deriveCurrentPlan: participant.deriveCurrentPlan,
      deriveTerminalClosure: participant.deriveTerminalClosure,
      stepHandlers: participant.stepHandlers,
    });
    return deepFreeze({
      status: result.status,
      operationId: result.operationId,
      recoveryGeneration: result.recoveryGeneration,
      operation: confirmed.payload.operation,
      preservationId: confirmed.payload.preservationId,
      planDigest: result.planDigest,
    });
  } catch (cause) {
    wrap(cause, "recovery");
  }
}
