import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  captureWakeflowProcessIdentity as captureSelfProcessIdentity,
  probeWakeflowProcessIdentity as probeProcessIdentity,
} from "./wakeflow-process-identity.mjs";

/**
 * Wakeflow宿主中立的workspace mutation事务内核。
 *
 * 职责导航：
 * 1. 在`.wakeflow-local/runtime`维护唯一workspace gate、transaction journal、recovery claim和checkpoint stage。
 * 2. 对confirmed plan、step handler、callback verdict和持久协议文件执行闭合准入。
 * 3. 按observe→prepare→checkpoint→commit→checkpoint顺序推进物理step，并在terminal closure稳定后清理证据。
 * 4. 为普通runtime mutation提供同一gate和失败后的owner-specific release证明。
 * 5. 从精确operationId、journal、claim、gate与进程存活事实恢复，不按mtime或Agent判断猜测所有权。
 * 6. 不理解config、transport、Pod或host effect业务语义；领域owner通过plan codec、handler和closure提供这些事实。
 */

// 一、持久协议常量、错误合同与own-data准入。
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_PROTOCOL_FILE_BYTES = 8 * 1024 * 1024;
const MAX_OWNER_EFFECT_RECORD_BYTES = 64 * 1024;
const MAX_SAFE_PROTOCOL_INTEGER = Number.MAX_SAFE_INTEGER;
const MAX_TERMINAL_CLOSURE_DIGESTS = 1_024;
const MAX_TERMINAL_CLOSURE_BYTES = Buffer.byteLength(canonicalJson({
  planDigest: `sha256:${"f".repeat(64)}`,
  closureDigests: Array.from({ length: MAX_TERMINAL_CLOSURE_DIGESTS }, () => ({
    name: "a".repeat(128),
    digest: `sha256:${"f".repeat(64)}`,
  })),
}), "utf8");
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5_000;
const RETRY_INTERVAL_MS = 20;

const LOCAL_REF = ".wakeflow-local";
const RUNTIME_REF = `${LOCAL_REF}/runtime`;
const MAINTENANCE_REF = `${RUNTIME_REF}/maintenance`;
const TRANSACTIONS_REF = `${MAINTENANCE_REF}/transactions`;
const LOCK_REF = `${RUNTIME_REF}/maintenance.lock`;

const ACTIONS = new Set([
  "fresh-initialize",
  "reconfigure",
  "reconcile",
  "explicit-migration",
]);
const LOCK_ONLY_ACTIONS = new Set(["runtime-mutation-recovery", "explicit-migration"]);
const LOCK_MODES = new Set(["runtime-mutation", "maintenance", "recovery-cleanup"]);
const STEP_KINDS = new Set(["create-or-update", "remove", "audit-publish", "owner-effect"]);
const TOKEN_PATTERN = /^[a-z][a-z0-9-]{0,127}$/u;
const OWNER_TOKEN_PATTERN = /^[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OPERATION_ID_PATTERN = /^workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SCHEMA_ID_PATTERN = /^urn:wakeflow:internal:[a-z0-9][a-z0-9:-]*:v[1-9][0-9]*$/u;
const MODE_PATTERN = /^0[0-7]{3}$/u;
const TIMESTAMP_PATTERN = /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,9})?Z$/u;
const PORTABLE_REF_PATTERN = /^(?!\/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\s)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)(?!.*\/\/)(?!.*\/$)[^\u0000-\u001F\u007F-\u009F]*[^\s\u0000-\u001F\u007F-\u009F]$/u;
const JOURNAL_NAME_PATTERN = /^(workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;
const CLAIM_NAME_PATTERN = /^(workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.recovery-([1-9][0-9]*)\.json$/u;
const STAGE_NAME_PATTERN = /^\.(workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(0|[1-9][0-9]*)\.checkpoint-stage$/u;
const PUBLISHER_STAGE_PREFIX = ".wakeflow-publish.";
const PUBLISHER_STAGE_PATTERN = /^\.wakeflow-publish\.(lock|journal|claim|checkpoint)\.(workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(0|[1-9][0-9]*)\.(darwin|linux)\.([1-9][0-9]*)\.([0-9a-f]{64})\.([0-9a-f]{32})\.stage$/u;
const CLAIM_REF_PATTERN = /^\.wakeflow-local\/runtime\/maintenance\/transactions\/(workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.recovery-([1-9][0-9]*)\.json$/u;
const SAFE_MIGRATION_LOCAL_MODES = Object.freeze(
  Array.from({ length: 0o1000 }, (_, mode) => mode)
    .filter((mode) => (mode & 0o700) === 0o700 && (mode & 0o022) === 0),
);

const mutationStorage = new AsyncLocalStorage();
const contextRecords = new WeakMap();

class WakeflowWorkspaceMutationError extends Error {
  constructor(code, message, { cause, ...details } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowWorkspaceMutationError";
    this.code = code;
    this.details = Object.freeze({ code, ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}) {
  throw new WakeflowWorkspaceMutationError(code, message, details);
}

function wrapFailure(code, message, cause, details = {}) {
  return new WakeflowWorkspaceMutationError(code, `${message}: ${cause?.message ?? String(cause)}`, {
    ...details,
    cause,
  });
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, expected, label, code = "wakeflow-mutation-invalid-contract") {
  if (!isPlainObject(value)) fail(code, `${label} must be a plain object`);
  const actual = Reflect.ownKeys(value);
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key) => typeof key !== "string" || !wanted.includes(key))
  ) {
    fail(code, `${label} has an invalid field set`, {
      actual: actual.map(String).sort(),
      expected: wanted,
    });
  }
  for (const key of wanted) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${label}.${key} must be an enumerable data property`);
    }
  }
  return value;
}

function allowedKeys(value, allowed, label, code = "wakeflow-mutation-invalid-contract") {
  if (!isPlainObject(value)) fail(code, `${label} must be a plain object`);
  const allowedSet = new Set(allowed);
  const actual = Reflect.ownKeys(value);
  const unknown = actual.filter((key) => typeof key !== "string" || !allowedSet.has(key));
  if (unknown.length > 0) {
    fail(code, `${label} contains unknown fields`, {
      unknown: unknown.map(String),
    });
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${label}.${key} must be an enumerable data property`);
    }
  }
  return value;
}

function assertToken(value, label) {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    fail("wakeflow-mutation-invalid-contract", `${label} must be a bounded lower-case token`);
  }
  return value;
}

function assertSchemaId(value, label) {
  if (typeof value !== "string" || !SCHEMA_ID_PATTERN.test(value)) {
    fail("wakeflow-mutation-invalid-contract", `${label} must be an internal Wakeflow schema ID`);
  }
  return value;
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    fail("wakeflow-mutation-invalid-contract", `${label} must be a sha256 digest`);
  }
  return value;
}

function assertOperationId(value, label = "operationId") {
  if (typeof value !== "string" || !OPERATION_ID_PATTERN.test(value)) {
    fail("wakeflow-mutation-invalid-contract", `${label} is not a Wakeflow workspace mutation ID`);
  }
  return value;
}

function assertOwnerToken(value, label = "ownerToken") {
  if (typeof value !== "string" || !OWNER_TOKEN_PATTERN.test(value)) {
    fail("wakeflow-mutation-invalid-contract", `${label} is not a private owner token`);
  }
  return value;
}

function assertPortableRef(value, label) {
  if (typeof value !== "string" || value.length > 1024 || !PORTABLE_REF_PATTERN.test(value)) {
    fail("wakeflow-mutation-invalid-contract", `${label} must be a portable workspace-relative ref`);
  }
  return value;
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function assertProtocolFileSize(bytes, label, code = "wakeflow-mutation-invalid-artifact") {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_PROTOCOL_FILE_BYTES) {
    fail(code, `${label} exceeds the bounded protocol file size`);
  }
  return bytes;
}

function assertSafeProtocolInteger(value, label, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail("wakeflow-mutation-invalid-artifact", `${label} is invalid`);
  }
  return value;
}

function parseSafeProtocolInteger(value, label, { minimum = 0 } = {}) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    fail("wakeflow-mutation-invalid-artifact", `${label} is not a canonical decimal integer`);
  }
  const parsed = Number(value);
  assertSafeProtocolInteger(parsed, label, { minimum });
  if (String(parsed) !== value) {
    fail("wakeflow-mutation-invalid-artifact", `${label} is not a canonical safe integer`);
  }
  return parsed;
}

function nextProtocolInteger(value, label) {
  assertSafeProtocolInteger(value, label);
  if (value === MAX_SAFE_PROTOCOL_INTEGER) {
    fail("wakeflow-mutation-manual-recovery", `${label} cannot advance beyond the safe integer boundary`);
  }
  return value + 1;
}

function bytesEqual(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.equals(right);
}

function samePrivateFileSource(actual, expected) {
  return actual !== null
    && expected !== null
    && bytesEqual(actual.bytes, expected.bytes)
    && actual.stat.nlink === 1
    && expected.stat.nlink === 1
    && String(actual.stat.dev) === String(expected.stat.dev)
    && String(actual.stat.ino) === String(expected.stat.ino);
}

function sameValue(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function cloneFrozen(value) {
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function canonicalCallbackSnapshot(
  value,
  label,
  code = "wakeflow-mutation-invalid-callback",
) {
  try {
    return cloneFrozen(value);
  } catch (cause) {
    fail(code, `${label} must be canonical JSON data`, { cause });
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function nowTimestamp() {
  return new Date().toISOString();
}

function newOperationId() {
  return `workspace-mutation_${randomUUID()}`;
}

function newOwnerToken() {
  return randomBytes(32).toString("hex");
}

// 二、workspace路径身份、私有协议目录与durable canonical文件发布。
function workspacePaths(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  return Object.freeze({
    root,
    realRoot: realpathSync(root),
    directoryIdentities: new Map(),
    local: path.join(root, LOCAL_REF),
    runtime: path.join(root, ...RUNTIME_REF.split("/")),
    maintenance: path.join(root, ...MAINTENANCE_REF.split("/")),
    transactions: path.join(root, ...TRANSACTIONS_REF.split("/")),
    lock: path.join(root, ...LOCK_REF.split("/")),
  });
}

function journalRef(operationId) {
  return `${TRANSACTIONS_REF}/${operationId}.json`;
}

function claimRef(operationId, generation) {
  return `${TRANSACTIONS_REF}/${operationId}.recovery-${generation}.json`;
}

function checkpointStageRef(operationId, generation) {
  return `${TRANSACTIONS_REF}/.${operationId}.${generation}.checkpoint-stage`;
}

function resolvePortable(paths, ref) {
  assertPortableRef(ref, "protocol ref");
  const candidate = path.resolve(paths.root, ...ref.split("/"));
  const relative = path.relative(paths.root, candidate);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail("wakeflow-mutation-path-escape", `protocol ref escaped the workspace: ${ref}`);
  }
  return candidate;
}

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail("wakeflow-mutation-unsupported-platform", "workspace mutation requires POSIX ownership semantics");
  }
  return process.geteuid();
}

function statIdentity(stat) {
  return Object.freeze({
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
  });
}

function sameIdentity(stat, identity) {
  return String(stat.dev) === identity.deviceId && String(stat.ino) === identity.inodeId;
}

function pathEntryExists(candidate, label) {
  try {
    lstatSync(candidate);
    return true;
  } catch (cause) {
    if (cause?.code === "ENOENT") return false;
    fail("wakeflow-mutation-directory", `cannot inspect ${label}`, { candidate, cause });
  }
}

function rememberDirectoryIdentity(paths, candidate, stat, label) {
  const existing = paths.directoryIdentities.get(candidate);
  if (existing && !sameIdentity(stat, existing)) {
    fail("wakeflow-mutation-path-race", `${label} changed identity`, { candidate });
  }
  if (!existing) paths.directoryIdentities.set(candidate, statIdentity(stat));
}

function reassertKnownAncestorIdentities(paths, candidate, label) {
  let current = path.dirname(candidate);
  while (current === paths.root || current.startsWith(`${paths.root}${path.sep}`)) {
    const expected = paths.directoryIdentities.get(current);
    if (expected) {
      let stat;
      try {
        stat = lstatSync(current);
      } catch (cause) {
        fail("wakeflow-mutation-path-race", `${label} ancestor disappeared`, {
          candidate: current,
          cause,
        });
      }
      if (
        stat.isSymbolicLink()
        || !stat.isDirectory()
        || stat.uid !== currentEuid()
        || !sameIdentity(stat, expected)
      ) {
        fail("wakeflow-mutation-path-race", `${label} ancestor changed identity`, {
          candidate: current,
        });
      }
    }
    if (current === paths.root) break;
    current = path.dirname(current);
  }
}

function modeString(stat) {
  return `0${(stat.mode & 0o777).toString(8).padStart(3, "0")}`;
}

function assertWorkspaceRoot(paths) {
  let stat;
  try {
    stat = lstatSync(paths.root);
  } catch (cause) {
    fail("wakeflow-mutation-workspace-root", `cannot inspect workspace root ${paths.root}`, { cause });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-mutation-workspace-root", "workspace root must be a real directory");
  }
  if (stat.uid !== currentEuid()) {
    fail("wakeflow-mutation-workspace-root", "workspace root must be owned by the current euid");
  }
  const real = realpathSync(paths.root);
  if (real !== paths.realRoot) fail("wakeflow-mutation-workspace-root", "workspace root identity changed");
  rememberDirectoryIdentity(paths, paths.root, stat, "workspace root");
  return { stat, identity: statIdentity(stat) };
}

function assertDirectory(candidate, {
  paths,
  label,
  modes = [DIRECTORY_MODE],
  expectedIdentity = null,
} = {}) {
  reassertKnownAncestorIdentities(paths, candidate, label);
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch (cause) {
    fail("wakeflow-mutation-directory", `cannot inspect ${label}`, { candidate, cause });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-mutation-directory", `${label} must be a real directory`, { candidate });
  }
  if (stat.uid !== currentEuid()) {
    fail("wakeflow-mutation-directory", `${label} must be owned by the current euid`, { candidate });
  }
  const actualMode = stat.mode & 0o777;
  if (!modes.includes(actualMode)) {
    fail("wakeflow-mutation-directory-mode", `${label} has unsafe mode ${modeString(stat)}`, {
      candidate,
      actualMode: modeString(stat),
    });
  }
  const relative = path.relative(paths.realRoot, realpathSync(candidate));
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail("wakeflow-mutation-path-escape", `${label} resolves outside the workspace`, { candidate });
  }
  if (expectedIdentity && !sameIdentity(stat, expectedIdentity)) {
    fail("wakeflow-mutation-path-race", `${label} changed identity`, { candidate });
  }
  rememberDirectoryIdentity(paths, candidate, stat, label);
  return { stat, identity: statIdentity(stat) };
}

function openDirectoryAndFsync(candidate, label) {
  let descriptor;
  try {
    descriptor = openSync(
      candidate,
      fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor);
    if (!stat.isDirectory()) fail("wakeflow-mutation-directory", `${label} is not a directory`);
    fsyncSync(descriptor);
  } catch (cause) {
    if (cause instanceof WakeflowWorkspaceMutationError) throw cause;
    fail("wakeflow-mutation-durability-unknown", `cannot fsync ${label}`, { candidate, cause });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function fsyncParent(candidate, label) {
  openDirectoryAndFsync(path.dirname(candidate), `${label} parent`);
}

function createPrivateDirectory(candidate, { paths, label, parentModes = [DIRECTORY_MODE] }) {
  const parent = path.dirname(candidate);
  const effectiveParentModes = parent === paths.root
    ? Array.from({ length: 512 }, (_, mode) => mode)
    : parentModes;
  const parentBefore = assertDirectory(parent, {
    paths,
    label: `${label} parent`,
    modes: effectiveParentModes,
  });
  try {
    mkdirSync(candidate, { mode: DIRECTORY_MODE });
  } catch (cause) {
    if (cause?.code === "EEXIST") {
      return { created: false, ...assertDirectory(candidate, { paths, label }) };
    }
    fail("wakeflow-mutation-bootstrap", `cannot create ${label}`, { candidate, cause });
  }
  let descriptor;
  try {
    descriptor = openSync(
      candidate,
      fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0),
    );
    fchmodSync(descriptor, DIRECTORY_MODE);
    fsyncSync(descriptor);
    const stat = fstatSync(descriptor);
    if (!stat.isDirectory() || stat.uid !== currentEuid() || (stat.mode & 0o777) !== DIRECTORY_MODE) {
      fail("wakeflow-mutation-bootstrap", `${label} did not become a private directory`);
    }
  } catch (cause) {
    if (cause instanceof WakeflowWorkspaceMutationError) throw cause;
    fail("wakeflow-mutation-durability-unknown", `cannot make ${label} durable`, { candidate, cause });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  assertDirectory(parent, {
    paths,
    label: `${label} parent`,
    modes: effectiveParentModes,
    expectedIdentity: parentBefore.identity,
  });
  fsyncParent(candidate, label);
  const created = assertDirectory(candidate, { paths, label });
  return { created: true, ...created };
}

function removeCreatedDirectory(candidate, identity, {
  paths,
  label,
  parentModes = [DIRECTORY_MODE],
}) {
  const current = assertDirectory(candidate, {
    paths,
    label,
    expectedIdentity: identity,
  });
  if (readdirSync(candidate).length !== 0) {
    fail("wakeflow-mutation-bootstrap-recovery-required", `${label} is no longer empty`);
  }
  const parentPath = path.dirname(candidate);
  const effectiveParentModes = parentPath === paths.root
    ? Array.from({ length: 512 }, (_, mode) => mode)
    : parentModes;
  const parent = assertDirectory(parentPath, {
    paths,
    label: `${label} parent`,
    modes: effectiveParentModes,
  });
  try {
    rmdirSync(candidate);
  } catch (cause) {
    fail("wakeflow-mutation-bootstrap-recovery-required", `cannot remove ${label}`, { cause });
  }
  try {
    assertDirectory(path.dirname(candidate), {
      paths,
      label: `${label} parent`,
      modes: effectiveParentModes,
      expectedIdentity: parent.identity,
    });
    fsyncParent(candidate, label);
  } catch (cause) {
    fail("wakeflow-mutation-durability-unknown", `${label} removal durability is unknown`, { cause });
  }
  return current;
}

function decodeCanonicalJson(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    fail("wakeflow-mutation-invalid-artifact", `${label} is not valid UTF-8`, { cause });
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail("wakeflow-mutation-invalid-artifact", `${label} must be one canonical JSON line`);
  }
  let value;
  try {
    value = JSON.parse(text.slice(0, -1));
  } catch (cause) {
    fail("wakeflow-mutation-invalid-artifact", `${label} is not valid JSON`, { cause });
  }
  let expected;
  try {
    expected = canonicalBytes(value);
  } catch (cause) {
    fail("wakeflow-mutation-invalid-artifact", `${label} is outside the canonical JSON domain`, { cause });
  }
  if (!expected.equals(bytes)) {
    fail("wakeflow-mutation-invalid-artifact", `${label} bytes are not canonical`);
  }
  return value;
}

function readPrivateCanonicalFile(candidate, {
  paths,
  label,
  allowMissing = false,
  allowedLinkCounts = [1],
} = {}) {
  const linkCounts = new Set(allowedLinkCounts);
  if (
    linkCounts.size === 0
    || [...linkCounts].some((count) => !Number.isInteger(count) || count < 1)
  ) {
    fail("wakeflow-mutation-invalid-contract", `${label} has invalid allowed link counts`);
  }
  reassertKnownAncestorIdentities(paths, candidate, label);
  let before;
  try {
    before = lstatSync(candidate);
  } catch (cause) {
    if (allowMissing && cause?.code === "ENOENT") return null;
    fail("wakeflow-mutation-invalid-artifact", `cannot inspect ${label}`, { candidate, cause });
  }
  if (before.isSymbolicLink() || !before.isFile() || !linkCounts.has(before.nlink)) {
    fail("wakeflow-mutation-invalid-artifact", `${label} has an invalid regular-file link count`);
  }
  if (before.uid !== currentEuid() || (before.mode & 0o777) !== FILE_MODE) {
    fail("wakeflow-mutation-invalid-artifact", `${label} must be current-euid mode 0600`);
  }
  const relative = path.relative(paths.realRoot, realpathSync(candidate));
  if (relative === "" || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail("wakeflow-mutation-path-escape", `${label} resolves outside the workspace`);
  }
  let descriptor;
  let bytes;
  try {
    descriptor = openSync(candidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile()
      || opened.nlink !== before.nlink
      || opened.uid !== currentEuid()
      || (opened.mode & 0o777) !== FILE_MODE
      || String(opened.dev) !== String(before.dev)
      || String(opened.ino) !== String(before.ino)
      || opened.size > MAX_PROTOCOL_FILE_BYTES
    ) {
      fail("wakeflow-mutation-path-race", `${label} changed while opening`);
    }
    bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const overflowProbe = Buffer.alloc(1);
    const overflowCount = readSync(descriptor, overflowProbe, 0, 1, offset);
    if (offset !== opened.size || overflowCount !== 0) {
      fail("wakeflow-mutation-path-race", `${label} changed size while reading`);
    }
    const afterRead = fstatSync(descriptor);
    if (
      !afterRead.isFile()
      || afterRead.uid !== currentEuid()
      || (afterRead.mode & 0o777) !== FILE_MODE
      || String(afterRead.dev) !== String(opened.dev)
      || String(afterRead.ino) !== String(opened.ino)
      || afterRead.size !== opened.size
      || afterRead.mtimeMs !== opened.mtimeMs
      || afterRead.nlink !== opened.nlink
      || afterRead.size > MAX_PROTOCOL_FILE_BYTES
    ) {
      fail("wakeflow-mutation-path-race", `${label} changed while reading`);
    }
  } catch (cause) {
    if (cause instanceof WakeflowWorkspaceMutationError) throw cause;
    fail("wakeflow-mutation-invalid-artifact", `cannot read ${label}`, { candidate, cause });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  reassertKnownAncestorIdentities(paths, candidate, label);
  let after;
  try {
    after = lstatSync(candidate);
  } catch (cause) {
    fail("wakeflow-mutation-path-race", `${label} disappeared after reading`, { candidate, cause });
  }
  if (
    after.isSymbolicLink()
    || !after.isFile()
    || after.uid !== currentEuid()
    || (after.mode & 0o777) !== FILE_MODE
    || String(after.dev) !== String(before.dev)
    || String(after.ino) !== String(before.ino)
    || after.nlink !== before.nlink
    || after.size !== before.size
    || after.size > MAX_PROTOCOL_FILE_BYTES
  ) {
    fail("wakeflow-mutation-path-race", `${label} changed after reading`);
  }
  return Object.freeze({
    value: decodeCanonicalJson(bytes, label),
    bytes,
    stat: after,
    identity: statIdentity(after),
    digest: sha256Bytes(bytes),
  });
}

function publicationDescriptorForTarget(paths, candidate, value) {
  const normalized = path.resolve(candidate);
  let kind;
  let operationId;
  let generation;
  let processIdentity;
  if (normalized === paths.lock) {
    validateLockRecord(value);
    kind = "lock";
    ({ operationId, recoveryGeneration: generation, processIdentity } = value);
  } else if (path.dirname(normalized) === paths.transactions) {
    const name = path.basename(normalized);
    const journalMatch = name.match(JOURNAL_NAME_PATTERN);
    const claimMatch = name.match(CLAIM_NAME_PATTERN);
    const checkpointMatch = name.match(STAGE_NAME_PATTERN);
    if (journalMatch) {
      validateTransactionRecord(value);
      kind = "journal";
      operationId = journalMatch[1];
      generation = value.recoveryGeneration;
      processIdentity = value.processIdentity;
    } else if (claimMatch) {
      validateClaimRecord(value);
      kind = "claim";
      operationId = claimMatch[1];
      generation = parseSafeProtocolInteger(
        claimMatch[2],
        "recovery claim publication generation",
        { minimum: 1 },
      );
      processIdentity = value.nextOwner.processIdentity;
    } else if (checkpointMatch) {
      validateTransactionRecord(value);
      kind = "checkpoint";
      operationId = checkpointMatch[1];
      generation = parseSafeProtocolInteger(
        checkpointMatch[2],
        "checkpoint publication generation",
      );
      processIdentity = value.processIdentity;
    } else {
      fail("wakeflow-mutation-invalid-contract", "canonical publication target is not a protocol artifact");
    }
    if (value.operationId !== operationId || value.recoveryGeneration !== generation) {
      fail("wakeflow-mutation-invalid-contract", "canonical publication target differs from its payload");
    }
  } else {
    fail("wakeflow-mutation-invalid-contract", "canonical publication target is outside the protocol roots");
  }
  validateProcessIdentity(processIdentity, "publisher processIdentity");
  return Object.freeze({ kind, operationId, generation, processIdentity, target: normalized });
}

function publisherStageName(descriptor) {
  return [
    "",
    "wakeflow-publish",
    descriptor.kind,
    descriptor.operationId,
    String(descriptor.generation),
    descriptor.processIdentity.platform,
    String(descriptor.processIdentity.pid),
    descriptor.processIdentity.startIdentity.slice("sha256:".length),
    randomBytes(16).toString("hex"),
    "stage",
  ].join(".");
}

function sameCanonicalInode(left, right) {
  return left !== null
    && right !== null
    && bytesEqual(left.bytes, right.bytes)
    && String(left.stat.dev) === String(right.stat.dev)
    && String(left.stat.ino) === String(right.stat.ino);
}

function unlinkExactPublicationName(candidate, expectedStat, {
  paths,
  label,
  expectedLinkCount,
  allowMissing = false,
  allowRestrictedMode = false,
}) {
  reassertKnownAncestorIdentities(paths, candidate, label);
  let current;
  try {
    current = lstatSync(candidate);
  } catch (cause) {
    if (allowMissing && cause?.code === "ENOENT") return false;
    fail("wakeflow-mutation-path-race", `${label} disappeared before cleanup`, { candidate, cause });
  }
  if (
    current.isSymbolicLink()
    || !current.isFile()
    || current.uid !== currentEuid()
    || (
      allowRestrictedMode
        ? ((current.mode & 0o777) & ~FILE_MODE) !== 0
        : (current.mode & 0o777) !== FILE_MODE
    )
    || current.nlink !== expectedLinkCount
    || String(current.dev) !== String(expectedStat.dev)
    || String(current.ino) !== String(expectedStat.ino)
  ) {
    fail("wakeflow-mutation-path-race", `${label} changed before cleanup`, { candidate });
  }
  const parent = assertDirectory(path.dirname(candidate), { paths, label: `${label} parent` });
  try {
    unlinkSync(candidate);
  } catch (cause) {
    fail("wakeflow-mutation-recovery-required", `cannot unlink ${label}`, { candidate, cause });
  }
  assertDirectory(path.dirname(candidate), {
    paths,
    label: `${label} parent`,
    expectedIdentity: parent.identity,
  });
  fsyncParent(candidate, label);
  return true;
}

function reconcilePublishedCanonicalFile(candidate, stageCandidate, stageStat, bytes, {
  paths,
  label,
  targetDirectoryDurable,
}) {
  let target;
  try {
    target = readPrivateCanonicalFile(candidate, {
      paths,
      label,
      allowedLinkCounts: [1, 2],
    });
  } catch {
    return null;
  }
  if (
    !bytesEqual(target.bytes, bytes)
    || String(target.stat.dev) !== String(stageStat.dev)
    || String(target.stat.ino) !== String(stageStat.ino)
  ) {
    return null;
  }

  let stage;
  try {
    stage = readPrivateCanonicalFile(stageCandidate, {
      paths,
      label: `${label} publisher stage reconciliation`,
      allowMissing: true,
      allowedLinkCounts: [2],
    });
  } catch {
    return null;
  }
  if (!targetDirectoryDurable) {
    try {
      fsyncParent(candidate, label);
      targetDirectoryDurable = true;
    } catch {
      return null;
    }
  }
  if (stage !== null) {
    if (target.stat.nlink !== 2 || !sameCanonicalInode(stage, target)) return null;
    try {
      unlinkExactPublicationName(stageCandidate, stage.stat, {
        paths,
        label: `${label} publisher stage reconciliation`,
        expectedLinkCount: 2,
      });
    } catch {
      // The target link was already durably published. Re-read both names below:
      // an unlink that completed before its parent fsync is still a successful
      // publication when the exact target remains as the sole link.
    }
  }

  try {
    if (lstatSync(stageCandidate)) return null;
  } catch (cause) {
    if (cause?.code !== "ENOENT") return null;
  }
  let stable;
  try {
    stable = readPrivateCanonicalFile(candidate, { paths, label });
  } catch {
    return null;
  }
  if (
    !bytesEqual(stable.bytes, bytes)
    || String(stable.stat.dev) !== String(stageStat.dev)
    || String(stable.stat.ino) !== String(stageStat.ino)
  ) {
    return null;
  }
  return stable;
}

function createCanonicalFile(candidate, value, { paths, label }) {
  const bytes = assertProtocolFileSize(canonicalBytes(value), label);
  const publication = publicationDescriptorForTarget(paths, candidate, value);
  const parent = assertDirectory(path.dirname(candidate), { paths, label: `${label} parent` });
  const stageCandidate = path.join(path.dirname(candidate), publisherStageName(publication));
  let descriptor;
  let stageStat = null;
  let published = false;
  let targetDirectoryDurable = false;
  let targetConflict = false;
  try {
    descriptor = openSync(
      stageCandidate,
      fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | (fsConstants.O_NOFOLLOW ?? 0),
      FILE_MODE,
    );
    stageStat = fstatSync(descriptor);
    fchmodSync(descriptor, FILE_MODE);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const durableStat = fstatSync(descriptor);
    if (
      !durableStat.isFile()
      || durableStat.nlink !== 1
      || durableStat.uid !== currentEuid()
      || (durableStat.mode & 0o777) !== FILE_MODE
      || String(durableStat.dev) !== String(stageStat.dev)
      || String(durableStat.ino) !== String(stageStat.ino)
      || durableStat.size !== bytes.length
    ) {
      fail("wakeflow-mutation-durability-unknown", `${label} publisher stage is not a private regular file`);
    }
    stageStat = durableStat;
    closeSync(descriptor);
    descriptor = undefined;
    assertDirectory(path.dirname(candidate), {
      paths,
      label: `${label} parent`,
      expectedIdentity: parent.identity,
    });
    fsyncParent(stageCandidate, `${label} publisher stage`);
    const stableStage = readPrivateCanonicalFile(stageCandidate, {
      paths,
      label: `${label} publisher stage`,
    });
    if (!bytesEqual(stableStage.bytes, bytes)) {
      fail("wakeflow-mutation-durability-unknown", `${label} publisher stage differs after durable create`);
    }
    try {
      linkSync(stageCandidate, candidate);
    } catch (cause) {
      if (cause?.code === "EEXIST") targetConflict = true;
      throw cause;
    }
    published = true;
    assertDirectory(path.dirname(candidate), {
      paths,
      label: `${label} parent`,
      expectedIdentity: parent.identity,
    });
    fsyncParent(candidate, label);
    targetDirectoryDurable = true;
    const linkedStage = readPrivateCanonicalFile(stageCandidate, {
      paths,
      label: `${label} linked publisher stage`,
      allowedLinkCounts: [2],
    });
    const linkedTarget = readPrivateCanonicalFile(candidate, {
      paths,
      label,
      allowedLinkCounts: [2],
    });
    if (!sameCanonicalInode(linkedStage, linkedTarget) || !bytesEqual(linkedTarget.bytes, bytes)) {
      fail("wakeflow-mutation-durability-unknown", `${label} hard-link publication pair differs`);
    }
    unlinkExactPublicationName(stageCandidate, linkedStage.stat, {
      paths,
      label: `${label} publisher stage`,
      expectedLinkCount: 2,
    });
    const stable = readPrivateCanonicalFile(candidate, { paths, label });
    if (
      !bytesEqual(stable.bytes, bytes)
      || String(stable.stat.dev) !== String(linkedTarget.stat.dev)
      || String(stable.stat.ino) !== String(linkedTarget.stat.ino)
    ) {
      fail("wakeflow-mutation-durability-unknown", `${label} differs after durable publication`);
    }
    return stable;
  } catch (cause) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The recognized publisher stage remains the recovery authority for close uncertainty.
      }
      descriptor = undefined;
    }
    if (published && stageStat !== null) {
      const reconciled = reconcilePublishedCanonicalFile(
        candidate,
        stageCandidate,
        stageStat,
        bytes,
        { paths, label, targetDirectoryDurable },
      );
      if (reconciled !== null) return reconciled;
    }
    let cleanupError = null;
    if (!published && stageStat !== null) {
      try {
        unlinkExactPublicationName(stageCandidate, stageStat, {
          paths,
          label: `${label} failed publisher stage`,
          expectedLinkCount: 1,
          allowMissing: true,
          allowRestrictedMode: true,
        });
      } catch (error) {
        cleanupError = error;
      }
    }
    if (targetConflict && cleanupError === null) {
      fail("wakeflow-mutation-exclusive-conflict", `cannot exclusively publish ${label}`, {
        candidate,
        cause,
      });
    }
    if (cause instanceof WakeflowWorkspaceMutationError && !published && cleanupError === null) {
      throw cause;
    }
    fail("wakeflow-mutation-durability-unknown", `cannot durably publish ${label}`, {
      candidate,
      stageCandidate,
      cause,
      cleanupError,
    });
  }
}

function replaceCanonicalFile(candidate, value, expectedSource, stageCandidate, {
  paths,
  label,
}) {
  const replacementBytes = assertProtocolFileSize(canonicalBytes(value), label);
  const source = readPrivateCanonicalFile(candidate, { paths, label });
  if (!samePrivateFileSource(source, expectedSource)) {
    fail("wakeflow-mutation-path-race", `${label} changed before checkpoint`);
  }
  const stage = createCanonicalFile(stageCandidate, value, {
    paths,
    label: `${label} checkpoint stage`,
  });
  if (!bytesEqual(stage.bytes, replacementBytes)) {
    fail("wakeflow-mutation-durability-unknown", `${label} checkpoint stage differs`);
  }
  const parent = assertDirectory(path.dirname(candidate), { paths, label: `${label} parent` });
  const sourceAgain = readPrivateCanonicalFile(candidate, { paths, label });
  if (!samePrivateFileSource(sourceAgain, expectedSource)) {
    fail("wakeflow-mutation-path-race", `${label} changed before checkpoint rename`);
  }
  try {
    renameSync(stageCandidate, candidate);
  } catch (cause) {
    fail("wakeflow-mutation-durability-unknown", `cannot checkpoint ${label}`, { cause });
  }
  assertDirectory(path.dirname(candidate), {
    paths,
    label: `${label} parent`,
    expectedIdentity: parent.identity,
  });
  fsyncParent(candidate, label);
  const stable = readPrivateCanonicalFile(candidate, { paths, label });
  if (!bytesEqual(stable.bytes, replacementBytes) || !samePrivateFileSource(stable, stage)) {
    fail("wakeflow-mutation-durability-unknown", `${label} differs after checkpoint`);
  }
  return stable;
}

function unlinkExactFile(candidate, expectedSource, { paths, label, allowMissing = false }) {
  const source = readPrivateCanonicalFile(candidate, { paths, label, allowMissing });
  if (source === null) return false;
  if (!samePrivateFileSource(source, expectedSource)) {
    fail("wakeflow-mutation-path-race", `${label} changed before unlink`);
  }
  const parent = assertDirectory(path.dirname(candidate), { paths, label: `${label} parent` });
  const sourceAgain = readPrivateCanonicalFile(candidate, { paths, label });
  if (!samePrivateFileSource(sourceAgain, expectedSource)) {
    fail("wakeflow-mutation-path-race", `${label} changed immediately before unlink`);
  }
  try {
    unlinkSync(candidate);
  } catch (cause) {
    fail("wakeflow-mutation-recovery-required", `cannot unlink ${label}`, { cause });
  }
  try {
    assertDirectory(path.dirname(candidate), {
      paths,
      label: `${label} parent`,
      expectedIdentity: parent.identity,
    });
    fsyncParent(candidate, label);
  } catch (cause) {
    fail("wakeflow-mutation-durability-unknown", `${label} unlink durability is unknown`, { cause });
  }
  return true;
}

function fileArtifact(paths, ref, source) {
  return Object.freeze({
    type: "file",
    ref,
    mode: "0600",
    digest: source.digest,
    deviceId: String(source.stat.dev),
    inodeId: String(source.stat.ino),
    linkCount: source.stat.nlink,
  });
}

function absentArtifact(ref) {
  return Object.freeze({ type: "absent", ref });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validateProcessIdentity(value, label = "processIdentity") {
  exactKeys(value, ["platform", "pid", "startIdentity"], label);
  if (value.platform !== "darwin" && value.platform !== "linux") {
    fail("wakeflow-mutation-invalid-artifact", `${label}.platform is unsupported`);
  }
  assertSafeProtocolInteger(value.pid, `${label}.pid`, { minimum: 1 });
  assertDigest(value.startIdentity, `${label}.startIdentity`);
  return value;
}

function existingEntryNames(candidate) {
  try {
    return readdirSync(candidate).sort();
  } catch (cause) {
    fail("wakeflow-mutation-directory", `cannot enumerate ${candidate}`, { cause });
  }
}

function parsePublisherStageName(name) {
  const match = name.match(PUBLISHER_STAGE_PATTERN);
  if (!match) return null;
  const [, kind, operationId, rawGeneration, platform, rawPid, startIdentityHex, nonce] = match;
  return Object.freeze({
    name,
    kind,
    operationId,
    generation: parseSafeProtocolInteger(rawGeneration, "publisher stage generation"),
    processIdentity: deepFreeze({
      platform,
      pid: parseSafeProtocolInteger(rawPid, "publisher stage pid", { minimum: 1 }),
      startIdentity: `sha256:${startIdentityHex}`,
    }),
    nonce,
  });
}

function publisherTargetForEntry(paths, entry, parentKind) {
  if (parentKind === "runtime") {
    return entry.kind === "lock" ? paths.lock : null;
  }
  if (entry.kind === "journal") return resolvePortable(paths, journalRef(entry.operationId));
  if (entry.kind === "claim") {
    if (entry.generation === 0) return null;
    return resolvePortable(paths, claimRef(entry.operationId, entry.generation));
  }
  if (entry.kind === "checkpoint") {
    return resolvePortable(paths, checkpointStageRef(entry.operationId, entry.generation));
  }
  return null;
}

function inspectPublisherStageFile(paths, candidate, label, {
  allowTransientMissing = false,
} = {}) {
  reassertKnownAncestorIdentities(paths, candidate, label);
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch (cause) {
    if (allowTransientMissing && cause?.code === "ENOENT") return null;
    fail("wakeflow-mutation-invalid-artifact", `cannot inspect ${label}`, { candidate, cause });
  }
  const mode = stat.mode & 0o777;
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
    || stat.uid !== currentEuid()
    || (stat.nlink !== 1 && stat.nlink !== 2)
    || (stat.nlink === 1 ? (mode & ~FILE_MODE) !== 0 : mode !== FILE_MODE)
    || stat.size > MAX_PROTOCOL_FILE_BYTES
  ) {
    fail("wakeflow-mutation-invalid-artifact", `${label} is not a bounded private publisher stage`);
  }
  let resolved;
  try {
    resolved = realpathSync(candidate);
  } catch (cause) {
    if (allowTransientMissing && cause?.code === "ENOENT") return null;
    fail("wakeflow-mutation-invalid-artifact", `cannot resolve ${label}`, { candidate, cause });
  }
  const relative = path.relative(paths.realRoot, resolved);
  if (relative === "" || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail("wakeflow-mutation-path-escape", `${label} resolves outside the workspace`);
  }
  return stat;
}

function scanRuntimePublisherStages(paths) {
  const publisherStages = [];
  const publisherUnknown = [];
  for (const name of existingEntryNames(paths.runtime)) {
    if (!name.startsWith(PUBLISHER_STAGE_PREFIX)) continue;
    const parsed = parsePublisherStageName(name);
    const target = parsed ? publisherTargetForEntry(paths, parsed, "runtime") : null;
    if (!parsed || target === null) {
      publisherUnknown.push(name);
      continue;
    }
    const candidate = path.join(paths.runtime, name);
    const stat = inspectPublisherStageFile(paths, candidate, "workspace gate publisher stage", {
      allowTransientMissing: true,
    });
    if (stat === null) continue;
    let targetSource = null;
    if (stat.nlink === 2) {
      try {
        const stageSource = readPrivateCanonicalFile(candidate, {
          paths,
          label: "workspace gate publisher stage",
          allowedLinkCounts: [2],
        });
        targetSource = readPrivateCanonicalFile(target, {
          paths,
          label: "workspace gate publisher target",
          allowedLinkCounts: [2],
        });
        validateLockRecord(targetSource.value);
        const descriptor = publicationDescriptorForTarget(paths, target, targetSource.value);
        if (
          !sameCanonicalInode(stageSource, targetSource)
          || !publisherEntryMatchesDescriptor({ ...parsed, target }, descriptor)
        ) {
          fail("wakeflow-mutation-invalid-artifact", "workspace gate publisher pair is not exact");
        }
      } catch (cause) {
        if (!pathEntryExists(candidate, "workspace gate publisher stage")) continue;
        if (cause instanceof WakeflowWorkspaceMutationError) throw cause;
        fail("wakeflow-mutation-invalid-artifact", "workspace gate publisher pair is invalid", { cause });
      }
    }
    publisherStages.push(Object.freeze({
      ...parsed,
      ref: `${RUNTIME_REF}/${name}`,
      candidate,
      target,
      stat,
      targetSource,
    }));
  }
  return { publisherStages, publisherUnknown };
}

function assertFreshPrefixContents(paths) {
  if (!pathEntryExists(paths.local, "Wakeflow local root")) return;
  assertDirectory(paths.local, { paths, label: "Wakeflow local root" });
  const localEntries = existingEntryNames(paths.local);
  if (localEntries.some((entry) => entry !== "runtime")) {
    fail("wakeflow-mutation-fresh-footprint", "fresh initialization found a non-protocol local entry");
  }
  if (!pathEntryExists(paths.runtime, "Wakeflow runtime root")) return;
  assertDirectory(paths.runtime, { paths, label: "Wakeflow runtime root" });
  const runtimeEntries = existingEntryNames(paths.runtime);
  if (runtimeEntries.some((entry) => (
    entry !== "maintenance"
    && entry !== "maintenance.lock"
    && !entry.startsWith(PUBLISHER_STAGE_PREFIX)
  ))) {
    fail("wakeflow-mutation-fresh-footprint", "fresh initialization found a non-protocol runtime entry");
  }
  if (!pathEntryExists(paths.maintenance, "Wakeflow maintenance root")) return;
  assertDirectory(paths.maintenance, { paths, label: "Wakeflow maintenance root" });
  const maintenanceEntries = existingEntryNames(paths.maintenance);
  if (maintenanceEntries.some((entry) => entry !== "transactions")) {
    fail("wakeflow-mutation-fresh-footprint", "fresh initialization found maintenance residue");
  }
  if (!pathEntryExists(paths.transactions, "Wakeflow maintenance transactions root")) return;
  assertDirectory(paths.transactions, { paths, label: "Wakeflow maintenance transactions root" });
}

function validateExistingProtocol(paths, {
  action = null,
  allowMissingMaintenance = false,
  allowMissingTransactions = false,
} = {}) {
  assertWorkspaceRoot(paths);
  if (!pathEntryExists(paths.local, "Wakeflow local root")) {
    fail("wakeflow-mutation-protocol-missing", "Wakeflow local protocol root is missing");
  }
  const localModes = action === "explicit-migration"
    ? SAFE_MIGRATION_LOCAL_MODES
    : [0o700];
  const local = assertDirectory(paths.local, {
    paths,
    label: "Wakeflow local root",
    modes: localModes,
  });
  if (action === "explicit-migration" && ((local.stat.mode & 0o022) !== 0)) {
    fail("wakeflow-mutation-directory-mode", "legacy local root is group/world writable");
  }
  if (!pathEntryExists(paths.runtime, "Wakeflow runtime root")) {
    fail("wakeflow-mutation-protocol-missing", "Wakeflow runtime root is missing");
  }
  assertDirectory(paths.runtime, { paths, label: "Wakeflow runtime root" });
  if (!pathEntryExists(paths.maintenance, "Wakeflow maintenance root")) {
    if (allowMissingMaintenance) return;
    fail("wakeflow-mutation-protocol-missing", "Wakeflow maintenance root is missing");
  }
  assertDirectory(paths.maintenance, { paths, label: "Wakeflow maintenance root" });
  const maintenanceEntries = existingEntryNames(paths.maintenance);
  if (maintenanceEntries.some((entry) => entry !== "transactions")) {
    fail("wakeflow-mutation-manual-recovery", "unknown entry exists in the maintenance protocol root");
  }
  if (!pathEntryExists(paths.transactions, "Wakeflow maintenance transactions root")) {
    if (allowMissingTransactions) return;
    fail("wakeflow-mutation-protocol-missing", "Wakeflow maintenance transactions root is missing");
  }
  assertDirectory(paths.transactions, { paths, label: "Wakeflow maintenance transactions root" });
}

function validateRecoveryProtocol(paths) {
  validateExistingProtocol(paths, {
    action: "explicit-migration",
    allowMissingMaintenance: true,
    allowMissingTransactions: true,
  });
  const local = assertDirectory(paths.local, {
    paths,
    label: "Wakeflow local root",
    modes: SAFE_MIGRATION_LOCAL_MODES,
  });
  return Object.freeze({
    localMode: local.stat.mode & 0o777,
    maintenancePresent: pathEntryExists(paths.maintenance, "Wakeflow maintenance root"),
    transactionsPresent: pathEntryExists(paths.transactions, "Wakeflow maintenance transactions root"),
  });
}

function prepareBootstrap(paths, action, created) {
  assertWorkspaceRoot(paths);
  if (action === "fresh-initialize") assertFreshPrefixContents(paths);

  if (!pathEntryExists(paths.local, "Wakeflow local root")) {
    const result = createPrivateDirectory(paths.local, { paths, label: "Wakeflow local root" });
    if (result.created) created.push({ path: paths.local, identity: result.identity, phase: "pre-lock" });
  } else {
    const modes = action === "explicit-migration"
      ? SAFE_MIGRATION_LOCAL_MODES
      : [0o700];
    const local = assertDirectory(paths.local, { paths, label: "Wakeflow local root", modes });
    if (action === "explicit-migration" && ((local.stat.mode & 0o022) !== 0)) {
      fail("wakeflow-mutation-directory-mode", "legacy local root is group/world writable");
    }
  }

  if (!pathEntryExists(paths.runtime, "Wakeflow runtime root")) {
    const runtimeParentModes = action === "explicit-migration"
      ? SAFE_MIGRATION_LOCAL_MODES
      : [0o700];
    const result = createPrivateDirectory(paths.runtime, {
      paths,
      label: "Wakeflow runtime root",
      parentModes: runtimeParentModes,
    });
    if (result.created) {
      created.push({
        path: paths.runtime,
        identity: result.identity,
        phase: "pre-lock",
        parentModes: runtimeParentModes,
      });
    }
  } else {
    assertDirectory(paths.runtime, { paths, label: "Wakeflow runtime root" });
  }

  if (action === "fresh-initialize") assertFreshPrefixContents(paths);
  if (pathEntryExists(paths.maintenance, "Wakeflow maintenance root")) {
    assertDirectory(paths.maintenance, { paths, label: "Wakeflow maintenance root" });
    const entries = existingEntryNames(paths.maintenance);
    if (entries.some((entry) => entry !== "transactions")) {
      fail("wakeflow-mutation-manual-recovery", "unknown entry exists in the maintenance protocol root");
    }
    if (pathEntryExists(paths.transactions, "Wakeflow maintenance transactions root")) {
      assertDirectory(paths.transactions, { paths, label: "Wakeflow maintenance transactions root" });
    }
  }
  return created;
}

function completeBootstrapInsideGate(paths, created) {
  if (!pathEntryExists(paths.maintenance, "Wakeflow maintenance root")) {
    const result = createPrivateDirectory(paths.maintenance, {
      paths,
      label: "Wakeflow maintenance root",
    });
    if (result.created) created.push({ path: paths.maintenance, identity: result.identity, phase: "under-lock" });
  } else {
    assertDirectory(paths.maintenance, { paths, label: "Wakeflow maintenance root" });
  }
  const entries = existingEntryNames(paths.maintenance);
  if (entries.some((entry) => entry !== "transactions")) {
    fail("wakeflow-mutation-manual-recovery", "unknown entry exists in the maintenance protocol root");
  }
  if (!pathEntryExists(paths.transactions, "Wakeflow maintenance transactions root")) {
    const result = createPrivateDirectory(paths.transactions, {
      paths,
      label: "Wakeflow maintenance transactions root",
    });
    if (result.created) created.push({ path: paths.transactions, identity: result.identity, phase: "under-lock" });
  } else {
    assertDirectory(paths.transactions, { paths, label: "Wakeflow maintenance transactions root" });
  }
}

function cleanBootstrap(paths, created, phase) {
  const selected = [...created]
    .filter((entry) => entry.phase === phase)
    .sort((left, right) => right.path.length - left.path.length);
  for (const entry of selected) {
    if (!pathEntryExists(entry.path, `bootstrap directory ${path.basename(entry.path)}`)) continue;
    removeCreatedDirectory(entry.path, entry.identity, {
      paths,
      label: `bootstrap directory ${path.basename(entry.path)}`,
      parentModes: entry.parentModes,
    });
  }
}

// 三、maintenance plan、step handler与持久化容量合同。
function validatePlanWrapper(plan, label) {
  exactKeys(plan, ["schemaId", "payload"], label);
  if (typeof plan.schemaId !== "string" || !SCHEMA_ID_PATTERN.test(plan.schemaId)) {
    fail("wakeflow-mutation-invalid-plan", `${label}.schemaId is invalid`);
  }
  if (!isPlainObject(plan.payload) || !Object.hasOwn(plan.payload, "steps") || !Array.isArray(plan.payload.steps)) {
    fail("wakeflow-mutation-invalid-plan", `${label}.payload.steps must be an own array`);
  }
  return plan;
}

async function codecPlan(plan, validatePlan, label) {
  if (typeof validatePlan !== "function") {
    fail("wakeflow-mutation-invalid-plan", "validatePlan is required as the plan codec");
  }
  let frozen;
  try {
    frozen = cloneFrozen(plan);
  } catch (cause) {
    fail("wakeflow-mutation-invalid-plan", `${label} is not canonical JSON data`, { cause });
  }
  validatePlanWrapper(frozen, label);
  assertProtocolFileSize(canonicalBytes(frozen), label, "wakeflow-mutation-invalid-plan");
  let rawVerdict;
  try {
    rawVerdict = await validatePlan({ plan: frozen });
  } catch (cause) {
    fail("wakeflow-mutation-invalid-plan", `${label} failed its owner codec`, { cause });
  }
  let verdict;
  try {
    verdict = cloneFrozen(rawVerdict);
    exactKeys(verdict, ["valid"], "plan codec verdict");
  } catch (cause) {
    fail("wakeflow-mutation-invalid-plan", "validatePlan returned a non-canonical verdict", { cause });
  }
  if (verdict.valid !== true) {
    fail("wakeflow-mutation-invalid-plan", "validatePlan must return exact { valid: true }");
  }
  return frozen;
}

function validateResourceSnapshot(value, { label, target }) {
  if (!isPlainObject(value)) fail("wakeflow-mutation-invalid-plan", `${label} must be an object`);
  if (value.type === "absent") {
    exactKeys(value, ["ref", "type"], label);
    assertPortableRef(value.ref, `${label}.ref`);
    return;
  }
  exactKeys(value, ["ref", "type", "mode", "digest"], label);
  assertPortableRef(value.ref, `${label}.ref`);
  if (value.type !== "file" && value.type !== "directory") {
    fail("wakeflow-mutation-invalid-plan", `${label}.type must be file, directory, or absent`);
  }
  if (typeof value.mode !== "string" || !MODE_PATTERN.test(value.mode)) {
    fail("wakeflow-mutation-invalid-plan", `${label}.mode is invalid`);
  }
  if (target && (
    (value.type === "file" && value.mode !== "0600" && value.mode !== "0644")
    || (value.type === "directory" && value.mode !== "0700" && value.mode !== "0755")
  )) {
    fail("wakeflow-mutation-invalid-plan", `${label}.mode does not match an admitted target type`);
  }
  assertDigest(value.digest, `${label}.digest`);
}

function absentSnapshot(ref) {
  return Object.freeze({ ref, type: "absent" });
}

function validateStepShape(step, ordinal, { action = null } = {}) {
  if (!isPlainObject(step)) {
    fail("wakeflow-mutation-invalid-plan", `plan step ${ordinal} must be a plain object`);
  }
  const ownerEffect = step.stepKind === "owner-effect";
  exactKeys(
    step,
    ownerEffect
      ? [
        "stepId",
        "ordinal",
        "stepKind",
        "effectKind",
        "intentDigest",
        "checkpointSchemaId",
        "resultSchemaId",
        "outcomeSchemaId",
      ]
      : ["stepId", "ordinal", "stepKind", "source", "staging", "final"],
    `plan step ${ordinal}`,
  );
  assertToken(step.stepId, `plan step ${ordinal}.stepId`);
  if (step.ordinal !== ordinal) {
    fail("wakeflow-mutation-invalid-plan", "maintenance step ordinals must be contiguous from zero");
  }
  if (!STEP_KINDS.has(step.stepKind)) {
    fail("wakeflow-mutation-invalid-plan", `unsupported maintenance step kind: ${step.stepKind}`);
  }
  if (ownerEffect) {
    if (action !== "explicit-migration") {
      fail("wakeflow-mutation-invalid-plan", `${step.stepId} owner effect is migration-only`);
    }
    assertToken(step.effectKind, `${step.stepId}.effectKind`);
    assertDigest(step.intentDigest, `${step.stepId}.intentDigest`);
    assertSchemaId(step.checkpointSchemaId, `${step.stepId}.checkpointSchemaId`);
    assertSchemaId(step.resultSchemaId, `${step.stepId}.resultSchemaId`);
    assertSchemaId(step.outcomeSchemaId, `${step.stepId}.outcomeSchemaId`);
    return;
  }
  validateResourceSnapshot(step.source, { label: `${step.stepId}.source`, target: false });
  if (step.staging !== null) {
    validateResourceSnapshot(step.staging, { label: `${step.stepId}.staging`, target: true });
  }
  validateResourceSnapshot(step.final, { label: `${step.stepId}.final`, target: true });
  if (
    step.staging !== null
    && path.posix.dirname(step.staging.ref) !== path.posix.dirname(step.final.ref)
  ) {
    fail("wakeflow-mutation-invalid-plan", `${step.stepId} staging must be a same-directory sibling`);
  }

  if (step.stepKind === "create-or-update") {
    if (step.source.ref !== step.final.ref || step.final.type === "absent") {
      fail("wakeflow-mutation-invalid-plan", `${step.stepId} create/update must target its source ref`);
    }
    if (step.staging === null) {
      const directoryCreate = step.source.type === "absent"
        && step.final.type === "directory"
        && (step.final.mode === "0700" || step.final.mode === "0755");
      const directoryModeRepair = step.source.type === "directory"
        && step.final.type === "directory"
        && step.source.digest === step.final.digest
        && step.source.mode !== "0700"
        && SAFE_MIGRATION_LOCAL_MODES.includes(Number.parseInt(step.source.mode, 8))
        && step.final.mode === "0700"
        && action !== "fresh-initialize"
        && (action !== "explicit-migration" || step.source.ref === LOCAL_REF);
      if (!directoryCreate && !directoryModeRepair) {
        fail(
          "wakeflow-mutation-invalid-plan",
          `${step.stepId} has an invalid atomic directory create or in-place mode repair`,
        );
      }
    } else if (
      step.staging.type === "absent"
      || step.staging.ref === step.final.ref
      || !sameResourceContent(step.staging, step.final)
    ) {
      fail("wakeflow-mutation-invalid-plan", `${step.stepId} staging and final targets differ`);
    }
  } else if (step.stepKind === "remove") {
    if (
      step.source.type === "absent"
      || step.staging === null
      || step.staging.type === "absent"
      || step.final.type !== "absent"
      || step.source.ref !== step.final.ref
      || step.staging.ref === step.final.ref
      || !sameResourceContent(step.source, step.staging)
    ) {
      fail("wakeflow-mutation-invalid-plan", `${step.stepId} has an invalid remove contract`);
    }
  } else if (
    step.source.type === "absent"
    || step.staging === null
    || step.staging.type === "absent"
    || step.final.type === "absent"
    || step.source.ref === step.staging.ref
    || step.source.ref === step.final.ref
    || step.staging.ref === step.final.ref
    || !sameResourceContent(step.staging, step.final)
  ) {
    fail("wakeflow-mutation-invalid-plan", `${step.stepId} has an invalid audit publication contract`);
  }
}

function sameResourceContent(left, right) {
  return left.type === right.type && left.mode === right.mode && left.digest === right.digest;
}

function snapshotStepHandlers(value) {
  // 在任何异步plan codec之前冻结真正消费的callback引用，阻止准入后的registry替换。
  if (!isPlainObject(value)) {
    fail("wakeflow-mutation-invalid-handlers", "stepHandlers must be an exact plain object map");
  }
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      fail("wakeflow-mutation-invalid-handlers", "stepHandlers cannot contain symbol-keyed authority");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-mutation-invalid-handlers",
        `stepHandlers.${key} must be an enumerable data property`,
      );
    }
    const handler = descriptor.value;
    if (!isPlainObject(handler)) {
      fail("wakeflow-mutation-invalid-handlers", `${key} handler is invalid`);
    }
    const callbackEntries = [];
    for (const callbackName of Reflect.ownKeys(handler)) {
      if (typeof callbackName !== "string") {
        fail("wakeflow-mutation-invalid-handlers", `${key} handler cannot contain symbol-keyed authority`);
      }
      const callbackDescriptor = Object.getOwnPropertyDescriptor(handler, callbackName);
      if (!callbackDescriptor?.enumerable || !Object.hasOwn(callbackDescriptor, "value")) {
        fail(
          "wakeflow-mutation-invalid-handlers",
          `${key}.${callbackName} must be an enumerable data property`,
        );
      }
      callbackEntries.push([callbackName, callbackDescriptor.value]);
    }
    entries.push([key, Object.freeze(Object.fromEntries(callbackEntries))]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function validateMaintenanceStepCollection(plan, { action }) {
  // 纯step shape既供真实执行准入，也供preview的最坏持久化预算共用。
  const seen = new Set();
  for (let index = 0; index < plan.payload.steps.length; index += 1) {
    const step = plan.payload.steps[index];
    validateStepShape(step, index, { action });
    if (seen.has(step.stepId)) fail("wakeflow-mutation-invalid-plan", `duplicate maintenance step ID: ${step.stepId}`);
    seen.add(step.stepId);
  }
  return [...seen].sort();
}

function validateMaintenancePlanSteps(plan, stepHandlers, {
  action,
  requireTerminalClosure,
  deriveTerminalClosure,
}) {
  // plan step与handler map必须一一覆盖；owner-effect保留迁移专用的八方法闭包。
  const stepIds = validateMaintenanceStepCollection(plan, { action });
  exactKeys(
    stepHandlers,
    stepIds,
    "maintenance step handler map",
    "wakeflow-mutation-invalid-handlers",
  );
  for (const step of plan.payload.steps) {
    const handler = stepHandlers[step.stepId];
    if (!isPlainObject(handler)) fail("wakeflow-mutation-invalid-handlers", `${step.stepId} handler is invalid`);
    if (step.stepKind === "owner-effect") {
      const callbacks = [
        "prepareEffect",
        "performEffect",
        "recoverEffect",
        "observeEffect",
        "validateEffectCheckpoint",
        "validateEffectResult",
        "validateEffectOutcome",
        "assertEffectOutcome",
      ];
      exactKeys(
        handler,
        callbacks,
        `${step.stepId} owner-effect handler`,
        "wakeflow-mutation-invalid-handlers",
      );
      for (const callback of callbacks) {
        if (typeof handler[callback] !== "function") {
          fail("wakeflow-mutation-invalid-handlers", `${step.stepId}.${callback} is required`);
        }
      }
      continue;
    }
    allowedKeys(
      handler,
      ["prepare", "observe", "commit", "cleanup"],
      `${step.stepId} handler`,
      "wakeflow-mutation-invalid-handlers",
    );
    for (const callback of ["prepare", "observe", "commit"]) {
      if (!Object.hasOwn(handler, callback) || typeof handler[callback] !== "function") {
        fail("wakeflow-mutation-invalid-handlers", `${step.stepId}.${callback} is required`);
      }
    }
    if (Object.hasOwn(handler, "cleanup") && typeof handler.cleanup !== "function") {
      fail("wakeflow-mutation-invalid-handlers", `${step.stepId}.cleanup must be a function`);
    }
    if (step.stepKind === "remove" && typeof handler.cleanup !== "function") {
      fail(
        "wakeflow-mutation-recovery-invalid-handlers",
        `${step.stepId} remove recovery requires an exact cleanup callback`,
      );
    }
  }
  if (requireTerminalClosure && typeof deriveTerminalClosure !== "function") {
    fail("wakeflow-mutation-invalid-plan", "deriveTerminalClosure is required for physical maintenance");
  }
}

/**
 * 计算一份计划在最坏可达checkpoint下的journal字节预算。
 *
 * 该方法验证同一纯step shape并投影容量，不读取workspace，也不为超预算计划创建gate或journal。
 */
export function inspectWakeflowMaintenancePersistenceBudget(options = {}) {
  exactKeys(options, ["plan", "purpose", "action"], "maintenance persistence budget input");
  const { plan, purpose, action } = options;
  validatePlanWrapper(plan, "maintenance persistence budget plan");
  if (purpose !== "maintenance-apply" && purpose !== "lock-only-recovery") {
    fail("wakeflow-mutation-invalid-plan", "maintenance persistence budget purpose is invalid");
  }
  if (
    (purpose === "maintenance-apply" && !ACTIONS.has(action))
    || (purpose === "lock-only-recovery" && !LOCK_ONLY_ACTIONS.has(action))
  ) fail("wakeflow-mutation-invalid-plan", "maintenance persistence budget action is invalid");
  validateMaintenanceStepCollection(plan, { action });
  const operationId = "workspace-mutation_00000000-0000-4000-8000-000000000000";
  const planDigest = canonicalJsonDigest(plan);
  const recoveryGeneration = MAX_SAFE_PROTOCOL_INTEGER;
  const probe = {
    schemaVersion: 1,
    artifactKind: "wakeflow-maintenance-transaction",
    operationId,
    purpose,
    action,
    operationKind: "a".repeat(128),
    domainOwner: "a".repeat(128),
    ownerToken: "f".repeat(64),
    recoveryGeneration,
    processIdentity: {
      platform: "darwin",
      pid: MAX_SAFE_PROTOCOL_INTEGER,
      startIdentity: `sha256:${"f".repeat(64)}`,
    },
    ownerDisposition: "relinquished",
    recoveryClaim: {
      ref: claimRef(operationId, recoveryGeneration),
      generation: recoveryGeneration,
      digest: `sha256:${"f".repeat(64)}`,
    },
    phase: "incomplete",
    plan,
    planDigest,
    checkpoint: purpose === "lock-only-recovery" ? 0 : MAX_SAFE_PROTOCOL_INTEGER,
    steps: purpose === "lock-only-recovery"
      ? []
      : plan.payload.steps.map((step) => ({
        ...step,
        status: "committed",
        ...(step.stepKind === "owner-effect" ? {
          effectCheckpoint: null,
          effectResult: null,
          effectOutcome: null,
        } : {}),
      })),
    terminalClosure: null,
  };
  const baseBytes = canonicalBytes(probe).length;
  const ownerEffectRecordBudget = purpose === "maintenance-apply"
    ? plan.payload.steps.filter((step) => step.stepKind === "owner-effect").length
      * 3
      * MAX_OWNER_EFFECT_RECORD_BYTES
    : 0;
  const maximumReachableBytes = purpose === "maintenance-apply"
    ? baseBytes
      - Buffer.byteLength("null", "utf8")
      + MAX_TERMINAL_CLOSURE_BYTES
      + ownerEffectRecordBudget
    : baseBytes;
  return deepFreeze({
    admitted: maximumReachableBytes <= MAX_PROTOCOL_FILE_BYTES,
    maximumProtocolFileBytes: MAX_PROTOCOL_FILE_BYTES,
    maximumReachableBytes,
  });
}

function assertTransactionPersistenceBudget(plan, { purpose, action }) {
  const budget = inspectWakeflowMaintenancePersistenceBudget({ plan, purpose, action });
  if (!budget.admitted) {
    fail(
      "wakeflow-mutation-invalid-plan",
      "maintenance plan exceeds the durable transaction persistence budget",
      {
        maximumReachableBytes: budget.maximumReachableBytes,
        maximumProtocolFileBytes: budget.maximumProtocolFileBytes,
      },
    );
  }
}

function validateTimestamp(value, label) {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) {
    fail("wakeflow-mutation-invalid-artifact", `${label} must be a strict RFC3339 UTC timestamp`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    fail("wakeflow-mutation-invalid-artifact", `${label} is not a real UTC timestamp`);
  }
  const components = value.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})/u);
  if (
    !components
    || parsed.getUTCFullYear() !== Number(components[1])
    || parsed.getUTCMonth() + 1 !== Number(components[2])
    || parsed.getUTCDate() !== Number(components[3])
    || parsed.getUTCHours() !== Number(components[4])
    || parsed.getUTCMinutes() !== Number(components[5])
    || parsed.getUTCSeconds() !== Number(components[6])
  ) {
    fail("wakeflow-mutation-invalid-artifact", `${label} has an invalid UTC calendar value`);
  }
}

function validateRecoveryClaimRef(value, label, { operationId, generation } = {}) {
  exactKeys(value, ["ref", "generation", "digest"], label);
  assertPortableRef(value.ref, `${label}.ref`);
  assertSafeProtocolInteger(value.generation, `${label}.generation`, { minimum: 1 });
  assertDigest(value.digest, `${label}.digest`);
  const match = value.ref.match(CLAIM_REF_PATTERN);
  if (
    !match
    || match[1] !== operationId
    || parseSafeProtocolInteger(match[2], `${label}.ref generation`, { minimum: 1 }) !== value.generation
  ) {
    fail("wakeflow-mutation-invalid-artifact", `${label}.ref does not match its operation and generation`);
  }
  if (generation !== undefined && value.generation !== generation) {
    fail("wakeflow-mutation-invalid-artifact", `${label}.generation differs from its owner generation`);
  }
}

// 四、workspace gate、journal、recovery claim与branded mutation context。
function validateLockRecord(lock) {
  exactKeys(lock, [
    "schemaVersion",
    "artifactKind",
    "operationId",
    "mode",
    "operationKind",
    "domainOwner",
    "ownerToken",
    "recoveryGeneration",
    "processIdentity",
    "recoveryClaim",
    "acquiredAt",
  ], "workspace mutation lock");
  if (lock.schemaVersion !== 1 || lock.artifactKind !== "wakeflow-workspace-mutation-lock") {
    fail("wakeflow-mutation-invalid-artifact", "workspace mutation lock kind/version is invalid");
  }
  assertOperationId(lock.operationId);
  if (!LOCK_MODES.has(lock.mode)) fail("wakeflow-mutation-invalid-artifact", "workspace mutation lock mode is invalid");
  assertToken(lock.operationKind, "lock.operationKind");
  assertToken(lock.domainOwner, "lock.domainOwner");
  assertOwnerToken(lock.ownerToken);
  assertSafeProtocolInteger(lock.recoveryGeneration, "lock.recoveryGeneration");
  if (
    (lock.recoveryGeneration === 0 && lock.mode === "recovery-cleanup")
    || (lock.recoveryGeneration > 0 && lock.mode !== "recovery-cleanup")
  ) {
    fail("wakeflow-mutation-invalid-artifact", "lock mode and recovery generation are inconsistent");
  }
  validateProcessIdentity(lock.processIdentity, "lock.processIdentity");
  if (lock.recoveryGeneration === 0) {
    if (lock.recoveryClaim !== null) fail("wakeflow-mutation-invalid-artifact", "generation-zero lock cannot cite a claim");
  } else {
    validateRecoveryClaimRef(lock.recoveryClaim, "lock.recoveryClaim", {
      operationId: lock.operationId,
      generation: lock.recoveryGeneration,
    });
    if (lock.recoveryClaim.generation !== lock.recoveryGeneration) {
      fail("wakeflow-mutation-invalid-artifact", "lock recovery generation and claim differ");
    }
  }
  validateTimestamp(lock.acquiredAt, "lock.acquiredAt");
  return lock;
}

function lockRecord({
  operationId,
  mode,
  operationKind,
  domainOwner,
  ownerToken,
  recoveryGeneration,
  processIdentity,
  recoveryClaim,
  acquiredAt = nowTimestamp(),
}) {
  return deepFreeze({
    schemaVersion: 1,
    artifactKind: "wakeflow-workspace-mutation-lock",
    operationId,
    mode,
    operationKind,
    domainOwner,
    ownerToken,
    recoveryGeneration,
    processIdentity,
    recoveryClaim,
    acquiredAt,
  });
}

function readLock(paths, { allowMissing = true, allowedLinkCounts = [1] } = {}) {
  const source = readPrivateCanonicalFile(paths.lock, {
    paths,
    label: "workspace mutation lock",
    allowMissing,
    allowedLinkCounts,
  });
  if (source === null) return null;
  validateLockRecord(source.value);
  return source;
}

async function acquireGate(paths, {
  mode,
  operationKind,
  domainOwner,
  operationId = newOperationId(),
  ownerToken = newOwnerToken(),
  recoveryGeneration = 0,
  processIdentity,
  recoveryClaim = null,
  acquiredAt,
  acquireTimeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS,
}) {
  // gate使用create-only canonical file竞争；timeout只控制等待，不改变已有owner事实。
  if (!LOCK_MODES.has(mode)) fail("wakeflow-mutation-invalid-contract", `invalid lock mode: ${mode}`);
  assertToken(operationKind, "operationKind");
  assertToken(domainOwner, "domainOwner");
  assertOperationId(operationId);
  assertOwnerToken(ownerToken);
  if (!Number.isInteger(acquireTimeoutMs) || acquireTimeoutMs < 0 || acquireTimeoutMs > 300_000) {
    fail("wakeflow-mutation-invalid-contract", "acquireTimeoutMs must be an integer from 0 to 300000");
  }
  assertDirectory(paths.runtime, { paths, label: "Wakeflow runtime root" });
  const record = lockRecord({
    operationId,
    mode,
    operationKind,
    domainOwner,
    ownerToken,
    recoveryGeneration,
    processIdentity,
    recoveryClaim,
    acquiredAt,
  });
  validateLockRecord(record);
  const deadline = Date.now() + acquireTimeoutMs;
  while (true) {
    try {
      const source = createCanonicalFile(paths.lock, record, {
        paths,
        label: "workspace mutation lock",
      });
      validateLockRecord(source.value);
      if (!sameValue(source.value, record)) {
        fail("wakeflow-mutation-path-race", "workspace mutation lock changed after acquisition");
      }
      return { record, source };
    } catch (error) {
      if (error?.code !== "wakeflow-mutation-exclusive-conflict") throw error;
      if (Date.now() >= deadline) {
        fail("wakeflow-mutation-busy", "workspace mutation gate is busy or acquire timed out", {
          acquireTimeoutMs,
        });
      }
      await sleep(Math.min(RETRY_INTERVAL_MS, Math.max(1, deadline - Date.now())));
    }
  }
}

function releaseGate(paths, gate) {
  // 释放前同时比较记录字节与inode，避免同内容替换伪装成原owner。
  const current = readLock(paths, { allowMissing: false });
  if (!sameValue(current.value, gate.record) || !bytesEqual(current.bytes, gate.source.bytes)) {
    fail("wakeflow-mutation-recovery-required", "workspace mutation lock is no longer owned by this operation");
  }
  unlinkExactFile(paths.lock, gate.source, {
    paths,
    label: "workspace mutation lock",
  });
}

function validateOwnerEffectRecord(value, expectedSchemaId, label, {
  code = "wakeflow-mutation-invalid-artifact",
} = {}) {
  exactKeys(value, ["schemaId", "payload", "recordDigest"], label);
  assertSchemaId(value.schemaId, `${label}.schemaId`);
  if (value.schemaId !== expectedSchemaId) {
    fail(code, `${label} schema differs from the owner-effect plan`);
  }
  if (!isPlainObject(value.payload)) {
    fail(code, `${label}.payload must be a plain object`);
  }
  assertDigest(value.recordDigest, `${label}.recordDigest`);
  let bytes;
  let expectedDigest;
  try {
    bytes = canonicalBytes(value);
    expectedDigest = canonicalJsonDigest({ schemaId: value.schemaId, payload: value.payload });
  } catch {
    fail(code, `${label} is not canonical JSON data`);
  }
  if (bytes.length > MAX_OWNER_EFFECT_RECORD_BYTES) {
    fail(code, `${label} exceeds the owner-effect record budget`);
  }
  if (value.recordDigest !== expectedDigest) {
    fail(code, `${label} digest differs from its payload`);
  }
  return value;
}

function validateOwnerEffectTransactionStep(recorded, planned, index, action) {
  exactKeys(recorded, [
    "stepId",
    "ordinal",
    "stepKind",
    "effectKind",
    "intentDigest",
    "checkpointSchemaId",
    "resultSchemaId",
    "outcomeSchemaId",
    "status",
    "effectCheckpoint",
    "effectResult",
    "effectOutcome",
  ], `transaction step ${index}`);
  const {
    status,
    effectCheckpoint,
    effectResult,
    effectOutcome,
    ...withoutRecords
  } = recorded;
  validateStepShape(withoutRecords, index, { action });
  if (!sameValue(withoutRecords, planned)) {
    fail("wakeflow-mutation-invalid-artifact", `transaction step ${index} differs from its plan`);
  }
  if (!["planned", "effect-started", "effect-completed", "committed"].includes(status)) {
    fail("wakeflow-mutation-invalid-artifact", `transaction step ${index} status is invalid`);
  }
  if (effectCheckpoint !== null) {
    validateOwnerEffectRecord(
      effectCheckpoint,
      recorded.checkpointSchemaId,
      `transaction step ${index}.effectCheckpoint`,
    );
  }
  if (effectResult !== null) {
    validateOwnerEffectRecord(
      effectResult,
      recorded.resultSchemaId,
      `transaction step ${index}.effectResult`,
    );
  }
  if (effectOutcome !== null) {
    validateOwnerEffectRecord(
      effectOutcome,
      recorded.outcomeSchemaId,
      `transaction step ${index}.effectOutcome`,
    );
  }
  const exactRecordShape = (
    (status === "planned" && effectCheckpoint === null && effectResult === null && effectOutcome === null)
    || (status === "effect-started" && effectCheckpoint !== null && effectResult === null && effectOutcome === null)
    || (status === "effect-completed" && effectCheckpoint !== null && effectResult !== null && effectOutcome === null)
    || (status === "committed" && effectCheckpoint !== null && effectResult !== null && effectOutcome !== null)
  );
  if (!exactRecordShape) {
    fail("wakeflow-mutation-invalid-artifact", `transaction step ${index} effect records differ from its status`);
  }
  return status;
}

function validateTransactionRecord(transaction) {
  exactKeys(transaction, [
    "schemaVersion",
    "artifactKind",
    "operationId",
    "purpose",
    "action",
    "operationKind",
    "domainOwner",
    "ownerToken",
    "recoveryGeneration",
    "processIdentity",
    "ownerDisposition",
    "recoveryClaim",
    "phase",
    "plan",
    "planDigest",
    "checkpoint",
    "steps",
    "terminalClosure",
  ], "maintenance transaction");
  if (transaction.schemaVersion !== 1 || transaction.artifactKind !== "wakeflow-maintenance-transaction") {
    fail("wakeflow-mutation-invalid-artifact", "maintenance transaction kind/version is invalid");
  }
  assertOperationId(transaction.operationId);
  if (transaction.purpose !== "maintenance-apply" && transaction.purpose !== "lock-only-recovery") {
    fail("wakeflow-mutation-invalid-artifact", "maintenance transaction purpose is invalid");
  }
  if (
    (transaction.purpose === "maintenance-apply" && !ACTIONS.has(transaction.action))
    || (transaction.purpose === "lock-only-recovery" && !LOCK_ONLY_ACTIONS.has(transaction.action))
  ) {
    fail("wakeflow-mutation-invalid-artifact", "maintenance transaction purpose/action pair is invalid");
  }
  assertToken(transaction.operationKind, "transaction.operationKind");
  assertToken(transaction.domainOwner, "transaction.domainOwner");
  assertOwnerToken(transaction.ownerToken, "transaction.ownerToken");
  assertSafeProtocolInteger(transaction.recoveryGeneration, "transaction.recoveryGeneration");
  validateProcessIdentity(transaction.processIdentity, "transaction.processIdentity");
  if (transaction.ownerDisposition !== "active" && transaction.ownerDisposition !== "relinquished") {
    fail("wakeflow-mutation-invalid-artifact", "transaction.ownerDisposition is invalid");
  }
  if (transaction.recoveryGeneration === 0) {
    if (transaction.recoveryClaim !== null) fail("wakeflow-mutation-invalid-artifact", "generation-zero transaction cannot cite a claim");
  } else {
    validateRecoveryClaimRef(transaction.recoveryClaim, "transaction.recoveryClaim", {
      operationId: transaction.operationId,
      generation: transaction.recoveryGeneration,
    });
    if (transaction.recoveryClaim.generation !== transaction.recoveryGeneration) {
      fail("wakeflow-mutation-invalid-artifact", "transaction recovery generation and claim differ");
    }
  }
  if (transaction.phase !== "incomplete" && transaction.phase !== "terminal") {
    fail("wakeflow-mutation-invalid-artifact", "transaction.phase is invalid");
  }
  validatePlanWrapper(transaction.plan, "transaction.plan");
  assertDigest(transaction.planDigest, "transaction.planDigest");
  if (canonicalJsonDigest(transaction.plan) !== transaction.planDigest) {
    fail("wakeflow-mutation-invalid-artifact", "transaction plan digest differs from its payload");
  }
  if (!Number.isSafeInteger(transaction.checkpoint) || transaction.checkpoint < 0 || !Array.isArray(transaction.steps)) {
    fail("wakeflow-mutation-invalid-artifact", "transaction checkpoint/steps are invalid");
  }
  if (transaction.steps.length !== transaction.plan.payload.steps.length) {
    fail("wakeflow-mutation-invalid-artifact", "transaction steps differ from plan payload steps");
  }
  let previousStatusRank = 2;
  let activeStepCount = 0;
  for (let index = 0; index < transaction.steps.length; index += 1) {
    const recorded = transaction.steps[index];
    let status;
    if (recorded?.stepKind === "owner-effect") {
      status = validateOwnerEffectTransactionStep(
        recorded,
        transaction.plan.payload.steps[index],
        index,
        transaction.action,
      );
    } else {
      exactKeys(recorded, ["stepId", "ordinal", "stepKind", "status", "source", "staging", "final"], `transaction step ${index}`);
      const { status: filesystemStatus, ...withoutStatus } = recorded;
      status = filesystemStatus;
      validateStepShape(withoutStatus, index, { action: transaction.action });
      if (!sameValue(withoutStatus, transaction.plan.payload.steps[index])) {
        fail("wakeflow-mutation-invalid-artifact", `transaction step ${index} differs from its plan`);
      }
      if (!["planned", "prepared", "committed"].includes(status)) {
        fail("wakeflow-mutation-invalid-artifact", `transaction step ${index} status is invalid`);
      }
    }
    const statusRank = status === "planned" ? 0 : status === "committed" ? 2 : 1;
    if (statusRank === 1) activeStepCount += 1;
    if (statusRank > previousStatusRank) {
      fail("wakeflow-mutation-invalid-artifact", "transaction step checkpoints are out of execution order");
    }
    previousStatusRank = statusRank;
  }
  if (activeStepCount > 1) {
    fail(
      "wakeflow-mutation-invalid-artifact",
      "transaction cannot contain multiple prepared or owner-effect checkpoint steps",
    );
  }
  if (transaction.purpose === "maintenance-apply" && transaction.steps.length === 0) {
    fail("wakeflow-mutation-invalid-artifact", "maintenance apply transaction cannot be empty");
  }
  if (transaction.purpose === "lock-only-recovery" && (
    transaction.recoveryGeneration < 1
    ||
    transaction.steps.length !== 0
    || transaction.phase !== "incomplete"
    || transaction.checkpoint !== 0
    || transaction.terminalClosure !== null
  )) {
    fail("wakeflow-mutation-invalid-artifact", "lock-only recovery transaction shape is invalid");
  }
  if (transaction.phase === "incomplete") {
    if (transaction.terminalClosure !== null) {
      fail("wakeflow-mutation-invalid-artifact", "incomplete transaction cannot have terminal closure");
    }
  } else {
    if (transaction.ownerDisposition !== "active" || transaction.steps.some((step) => step.status !== "committed")) {
      fail("wakeflow-mutation-invalid-artifact", "terminal transaction is not fully active/committed");
    }
    validateTerminalClosure(transaction.terminalClosure, transaction.planDigest);
  }
  if (transaction.ownerDisposition === "relinquished" && transaction.phase !== "incomplete") {
    fail("wakeflow-mutation-invalid-artifact", "only incomplete transaction ownership may be relinquished");
  }
  return transaction;
}

function readTransaction(paths, operationId, {
  allowMissing = false,
  allowedLinkCounts = [1],
} = {}) {
  assertOperationId(operationId);
  const ref = journalRef(operationId);
  const source = readPrivateCanonicalFile(resolvePortable(paths, ref), {
    paths,
    label: "maintenance transaction",
    allowMissing,
    allowedLinkCounts,
  });
  if (source === null) return null;
  validateTransactionRecord(source.value);
  if (source.value.operationId !== operationId) {
    fail("wakeflow-mutation-invalid-artifact", "maintenance transaction filename and operation ID differ");
  }
  return { ...source, ref };
}

function checkpointTransaction(paths, transactionState, nextValue) {
  // checkpoint只允许通过同目录stage原子替换当前journal，并刷新调用方持有的精确source。
  validateTransactionRecord(nextValue);
  const stage = resolvePortable(
    paths,
    checkpointStageRef(nextValue.operationId, nextValue.recoveryGeneration),
  );
  const target = resolvePortable(paths, journalRef(nextValue.operationId));
  const source = replaceCanonicalFile(target, nextValue, transactionState.source, stage, {
    paths,
    label: "maintenance transaction",
  });
  transactionState.value = source.value;
  transactionState.bytes = source.bytes;
  transactionState.source = source;
  return transactionState;
}

function validatePreviousArtifact(value, label) {
  if (!isPlainObject(value)) fail("wakeflow-mutation-invalid-artifact", `${label} is invalid`);
  if (value.type === "absent") {
    exactKeys(value, ["type", "ref"], label);
    assertPortableRef(value.ref, `${label}.ref`);
    return;
  }
  exactKeys(value, ["type", "ref", "mode", "digest", "deviceId", "inodeId", "linkCount"], label);
  if (value.type !== "file" || value.mode !== "0600" || value.linkCount !== 1) {
    fail("wakeflow-mutation-invalid-artifact", `${label} is not a private file artifact`);
  }
  assertPortableRef(value.ref, `${label}.ref`);
  assertDigest(value.digest, `${label}.digest`);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value.deviceId) || !/^(?:0|[1-9][0-9]*)$/u.test(value.inodeId)) {
    fail("wakeflow-mutation-invalid-artifact", `${label} identity is invalid`);
  }
}

function validateClaimRecord(claim) {
  exactKeys(claim, [
    "schemaVersion",
    "artifactKind",
    "operationId",
    "recoveryGeneration",
    "planDigest",
    "previousOwner",
    "nextOwner",
    "previousJournal",
    "previousLock",
    "previousClaim",
    "createdAt",
  ], "workspace recovery claim");
  if (claim.schemaVersion !== 1 || claim.artifactKind !== "wakeflow-workspace-recovery-claim") {
    fail("wakeflow-mutation-invalid-artifact", "workspace recovery claim kind/version is invalid");
  }
  assertOperationId(claim.operationId);
  assertSafeProtocolInteger(claim.recoveryGeneration, "claim.recoveryGeneration", { minimum: 1 });
  assertDigest(claim.planDigest, "claim.planDigest");
  exactKeys(claim.previousOwner, [
    "mode", "operationKind", "domainOwner", "ownerTokenDigest", "recoveryGeneration",
    "processIdentity", "ownerDisposition",
  ], "claim.previousOwner");
  if (!LOCK_MODES.has(claim.previousOwner.mode)) fail("wakeflow-mutation-invalid-artifact", "previous owner mode is invalid");
  assertToken(claim.previousOwner.operationKind, "claim.previousOwner.operationKind");
  assertToken(claim.previousOwner.domainOwner, "claim.previousOwner.domainOwner");
  assertDigest(claim.previousOwner.ownerTokenDigest, "claim.previousOwner.ownerTokenDigest");
  assertSafeProtocolInteger(
    claim.previousOwner.recoveryGeneration,
    "claim.previousOwner.recoveryGeneration",
  );
  validateProcessIdentity(claim.previousOwner.processIdentity, "claim.previousOwner.processIdentity");
  if (claim.previousOwner.ownerDisposition !== "active" && claim.previousOwner.ownerDisposition !== "relinquished") {
    fail("wakeflow-mutation-invalid-artifact", "previous owner disposition is invalid");
  }
  exactKeys(claim.nextOwner, [
    "mode", "operationKind", "domainOwner", "ownerToken", "recoveryGeneration", "processIdentity", "acquiredAt",
  ], "claim.nextOwner");
  if (claim.nextOwner.mode !== "recovery-cleanup") fail("wakeflow-mutation-invalid-artifact", "next owner mode is invalid");
  assertToken(claim.nextOwner.operationKind, "claim.nextOwner.operationKind");
  assertToken(claim.nextOwner.domainOwner, "claim.nextOwner.domainOwner");
  assertOwnerToken(claim.nextOwner.ownerToken, "claim.nextOwner.ownerToken");
  if (claim.nextOwner.recoveryGeneration !== claim.recoveryGeneration) {
    fail("wakeflow-mutation-invalid-artifact", "claim next owner generation differs");
  }
  validateProcessIdentity(claim.nextOwner.processIdentity, "claim.nextOwner.processIdentity");
  validateTimestamp(claim.nextOwner.acquiredAt, "claim.nextOwner.acquiredAt");
  for (const [label, artifact] of [
    ["claim.previousJournal", claim.previousJournal],
    ["claim.previousLock", claim.previousLock],
    ["claim.previousClaim", claim.previousClaim],
  ]) validatePreviousArtifact(artifact, label);
  if (
    (claim.previousOwner.recoveryGeneration === 0 && claim.previousOwner.mode === "recovery-cleanup")
    || (claim.previousOwner.recoveryGeneration > 0 && claim.previousOwner.mode !== "recovery-cleanup")
  ) {
    fail("wakeflow-mutation-invalid-artifact", "claim previous owner mode and generation are inconsistent");
  }
  if (claim.previousLock.type === "file" && claim.previousOwner.ownerDisposition !== "active") {
    fail("wakeflow-mutation-invalid-artifact", "claim file-lock predecessor must be active");
  }
  if (claim.previousJournal.type === "absent" && claim.previousLock.type !== "file") {
    fail("wakeflow-mutation-invalid-artifact", "claim must bind a predecessor journal or lock");
  }
  validateTimestamp(claim.createdAt, "claim.createdAt");
  if (claim.createdAt !== claim.nextOwner.acquiredAt) {
    fail("wakeflow-mutation-invalid-artifact", "claim timestamps differ between record and next owner");
  }
  return claim;
}

function scanTransactions(paths, { strictRecords = true } = {}) {
  assertDirectory(paths.transactions, { paths, label: "Wakeflow maintenance transactions root" });
  const journals = new Map();
  const claims = new Map();
  const stages = [];
  const publisherStages = [];
  const publisherUnknown = [];
  const unknown = [];
  for (const name of existingEntryNames(paths.transactions)) {
    if (name.startsWith(PUBLISHER_STAGE_PREFIX)) {
      const parsed = parsePublisherStageName(name);
      const target = parsed ? publisherTargetForEntry(paths, parsed, "transactions") : null;
      if (!parsed || target === null) {
        publisherUnknown.push(name);
        continue;
      }
      const candidate = path.join(paths.transactions, name);
      const stat = inspectPublisherStageFile(paths, candidate, "transaction publisher stage");
      let targetSource = null;
      if (stat.nlink === 2) {
        try {
          const stageSource = readPrivateCanonicalFile(candidate, {
            paths,
            label: "transaction publisher stage",
            allowedLinkCounts: [2],
          });
          targetSource = readPrivateCanonicalFile(target, {
            paths,
            label: "transaction publisher target",
            allowedLinkCounts: [2],
          });
          const descriptor = publicationDescriptorForTarget(paths, target, targetSource.value);
          if (
            !sameCanonicalInode(stageSource, targetSource)
            || !publisherEntryMatchesDescriptor({ ...parsed, target }, descriptor)
          ) {
            fail("wakeflow-mutation-invalid-artifact", "transaction publisher pair is not exact");
          }
        } catch (cause) {
          if (cause instanceof WakeflowWorkspaceMutationError) throw cause;
          fail("wakeflow-mutation-invalid-artifact", "transaction publisher pair is invalid", { cause });
        }
      }
      publisherStages.push(Object.freeze({
        ...parsed,
        ref: `${TRANSACTIONS_REF}/${name}`,
        candidate,
        target,
        stat,
        targetSource,
      }));
      continue;
    }
    const journalMatch = name.match(JOURNAL_NAME_PATTERN);
    if (journalMatch) {
      const operationId = journalMatch[1];
      const target = resolvePortable(paths, journalRef(operationId));
      const hasPublisher = publisherStages.some((entry) => entry.target === target);
      const source = strictRecords
        ? readTransaction(paths, operationId, {
          allowedLinkCounts: hasPublisher ? [1, 2] : [1],
        })
        : null;
      journals.set(operationId, source);
      continue;
    }
    const claimMatch = name.match(CLAIM_NAME_PATTERN);
    if (claimMatch) {
      const operationId = claimMatch[1];
      const generation = parseSafeProtocolInteger(
        claimMatch[2],
        "recovery claim filename generation",
        { minimum: 1 },
      );
      const ref = `${TRANSACTIONS_REF}/${name}`;
      const target = resolvePortable(paths, ref);
      const hasPublisher = publisherStages.some((entry) => entry.target === target);
      const source = strictRecords
        ? readPrivateCanonicalFile(target, {
          paths,
          label: "workspace recovery claim",
          allowedLinkCounts: hasPublisher ? [1, 2] : [1],
        })
        : null;
      if (source) {
        validateClaimRecord(source.value);
        if (source.value.operationId !== operationId || source.value.recoveryGeneration !== generation) {
          fail("wakeflow-mutation-invalid-artifact", "recovery claim filename and payload differ");
        }
      }
      if (!claims.has(operationId)) claims.set(operationId, []);
      claims.get(operationId).push({ generation, ref, source });
      continue;
    }
    const stageMatch = name.match(STAGE_NAME_PATTERN);
    if (stageMatch) {
      const operationId = stageMatch[1];
      const generation = parseSafeProtocolInteger(
        stageMatch[2],
        "checkpoint stage filename generation",
      );
      const ref = `${TRANSACTIONS_REF}/${name}`;
      const target = resolvePortable(paths, ref);
      const hasPublisher = publisherStages.some((entry) => entry.target === target);
      const source = strictRecords
        ? readPrivateCanonicalFile(target, {
          paths,
          label: "maintenance transaction checkpoint stage",
          allowedLinkCounts: hasPublisher ? [1, 2] : [1],
        })
        : null;
      if (source) {
        validateTransactionRecord(source.value);
        if (source.value.operationId !== operationId || source.value.recoveryGeneration !== generation) {
          fail("wakeflow-mutation-invalid-artifact", "checkpoint stage filename and transaction owner differ");
        }
      }
      stages.push({ operationId, generation, name, ref, source });
      continue;
    }
    unknown.push(name);
  }
  for (const entries of claims.values()) entries.sort((left, right) => left.generation - right.generation);
  return { journals, claims, stages, publisherStages, publisherUnknown, unknown };
}

function emptyTransactionScan() {
  return {
    journals: new Map(),
    claims: new Map(),
    stages: [],
    publisherStages: [],
    publisherUnknown: [],
    unknown: [],
  };
}

function admissionRelevantRuntimePublishers(scan, runtimePublishers) {
  const transactionResidueExists = scan.journals.size > 0
    || scan.claims.size > 0
    || scan.stages.length > 0
    || scan.publisherStages.length > 0
    || scan.publisherUnknown.length > 0
    || scan.unknown.length > 0;
  if (transactionResidueExists || runtimePublishers.publisherUnknown.length > 0) {
    return runtimePublishers;
  }
  return {
    publisherStages: runtimePublishers.publisherStages.filter(
      (entry) => probeProcessIdentity(entry.processIdentity) !== "same-live",
    ),
    publisherUnknown: runtimePublishers.publisherUnknown,
  };
}

function assertEmptyAdmissionResidue(paths) {
  const scan = pathEntryExists(paths.transactions, "Wakeflow maintenance transactions root")
    ? scanTransactions(paths)
    : emptyTransactionScan();
  const runtimePublishers = scanRuntimePublisherStages(paths);
  // A live lock publisher without transaction facts is part of gate admission,
  // not abandoned recovery state. The canonical lock target remains the sole
  // exclusion authority, and every dead or unverifiable publisher stays
  // fail-closed through the ordinary residue classifier.
  const classification = classifyTransactionResidue(
    scan,
    admissionRelevantRuntimePublishers(scan, runtimePublishers),
  );
  if (classification.disposition === "manual") {
    fail("wakeflow-mutation-manual-recovery", "maintenance transaction residue requires manual recovery", {
      journals: [...scan.journals.keys()],
      claims: [...scan.claims.keys()],
      stages: scan.stages.map((entry) => entry.name),
      publisherStages: [
        ...runtimePublishers.publisherStages,
        ...scan.publisherStages,
      ].map((entry) => entry.name),
      unknown: [
        ...scan.unknown,
        ...runtimePublishers.publisherUnknown,
        ...scan.publisherUnknown,
      ],
    });
  }
  if (classification.disposition === "recovery-required") {
    fail("wakeflow-mutation-recovery-required", "maintenance transaction residue blocks normal admission", {
      journals: [...scan.journals.keys()],
      claims: [...scan.claims.keys()],
      stages: scan.stages.map((entry) => entry.name),
      publisherStages: [
        ...runtimePublishers.publisherStages,
        ...scan.publisherStages,
      ].map((entry) => entry.name),
      unknown: [
        ...scan.unknown,
        ...runtimePublishers.publisherUnknown,
        ...scan.publisherUnknown,
      ],
    });
  }
}

function sameTransactionFields(left, right, fields) {
  return fields.every((field) => sameValue(left[field], right[field]));
}

function checkpointStageIsExactSuccessor(journal, stage, latestClaim) {
  if (bytesEqual(journal.bytes, stage.source.bytes)) return true;
  const current = journal.value;
  const next = stage.source.value;
  if (!sameTransactionFields(current, next, [
    "schemaVersion",
    "artifactKind",
    "operationId",
    "purpose",
    "action",
    "operationKind",
    "domainOwner",
    "plan",
    "planDigest",
  ])) return false;

  const ownerFields = [
    "ownerToken",
    "recoveryGeneration",
    "processIdentity",
    "recoveryClaim",
  ];
  const ownerSame = sameTransactionFields(current, next, ownerFields);
  const executionSame = sameTransactionFields(current, next, ["phase", "steps", "terminalClosure"]);

  let changedStepCount = 0;
  let validStepAdvance = true;
  if (current.steps.length !== next.steps.length) validStepAdvance = false;
  for (let index = 0; validStepAdvance && index < current.steps.length; index += 1) {
    const before = current.steps[index];
    const after = next.steps[index];
    const {
      status: beforeStatus,
      effectCheckpoint: _beforeCheckpoint,
      effectResult: _beforeResult,
      effectOutcome: _beforeOutcome,
      ...beforeContract
    } = before;
    const {
      status: afterStatus,
      effectCheckpoint: _afterCheckpoint,
      effectResult: _afterResult,
      effectOutcome: _afterOutcome,
      ...afterContract
    } = after;
    if (!sameValue(beforeContract, afterContract)) {
      validStepAdvance = false;
      break;
    }
    if (beforeStatus !== afterStatus) {
      changedStepCount += 1;
      const statusRanks = before.stepKind === "owner-effect"
        ? { planned: 0, "effect-started": 1, "effect-completed": 2, committed: 3 }
        : { planned: 0, prepared: 1, committed: 2 };
      if (statusRanks[afterStatus] !== statusRanks[beforeStatus] + 1) validStepAdvance = false;
    } else if (!sameValue(before, after)) {
      validStepAdvance = false;
    }
  }
  const stepCheckpoint = ownerSame
    && current.ownerDisposition === next.ownerDisposition
    && current.phase === next.phase
    && sameValue(current.terminalClosure, next.terminalClosure)
    && next.checkpoint === nextProtocolInteger(current.checkpoint, "maintenance checkpoint")
    && validStepAdvance
    && changedStepCount === 1;
  if (stepCheckpoint) return true;

  const relinquishCheckpoint = ownerSame
    && executionSame
    && current.ownerDisposition === "active"
    && next.ownerDisposition === "relinquished"
    && next.checkpoint === (
      current.purpose === "lock-only-recovery"
        ? current.checkpoint
        : nextProtocolInteger(current.checkpoint, "maintenance checkpoint")
    );
  if (relinquishCheckpoint) return true;

  const terminalCheckpoint = ownerSame
    && sameValue(current.steps, next.steps)
    && current.ownerDisposition === "active"
    && next.ownerDisposition === "active"
    && current.phase === "incomplete"
    && next.phase === "terminal"
    && current.terminalClosure === null
    && next.terminalClosure !== null
    && next.checkpoint === nextProtocolInteger(current.checkpoint, "maintenance checkpoint");
  if (terminalCheckpoint) return true;

  if (!latestClaim || stage.generation !== latestClaim.generation) return false;
  const expectedClaimRef = {
    ref: latestClaim.ref,
    generation: latestClaim.generation,
    digest: canonicalJsonDigest(latestClaim.source.value),
  };
  const nextOwner = latestClaim.source.value.nextOwner;
  return executionSame
    && (next.ownerDisposition === "active" || next.ownerDisposition === "relinquished")
    && next.ownerToken === nextOwner.ownerToken
    && next.recoveryGeneration === nextOwner.recoveryGeneration
    && sameValue(next.processIdentity, nextOwner.processIdentity)
    && sameValue(next.recoveryClaim, expectedClaimRef)
    && next.checkpoint === (
      current.purpose === "lock-only-recovery"
        ? current.checkpoint
        : nextProtocolInteger(current.checkpoint, "maintenance checkpoint")
    );
}

function classifyTransactionResidue(scan, runtimePublishers = {
  publisherStages: [],
  publisherUnknown: [],
}) {
  // classifier只基于协议形状返回empty/recovery-required/manual，不执行清理。
  const publisherStages = [
    ...runtimePublishers.publisherStages,
    ...scan.publisherStages,
  ];
  const operations = [...new Set([
    ...scan.journals.keys(),
    ...scan.claims.keys(),
    ...scan.stages.map((stage) => stage.operationId),
    ...publisherStages.map((stage) => stage.operationId),
  ])].sort();
  const transactionOperations = new Set([
    ...scan.journals.keys(),
    ...scan.claims.keys(),
    ...scan.stages.map((stage) => stage.operationId),
  ]);
  const cleanupOnlyLockPublisher = publisherStages.length === 1
    && scan.publisherStages.length === 0
    && runtimePublishers.publisherStages.length === 1
    && runtimePublishers.publisherStages[0].kind === "lock"
    && runtimePublishers.publisherStages[0].stat.nlink === 1
    && !transactionOperations.has(runtimePublishers.publisherStages[0].operationId)
    && transactionOperations.size <= 1;
  const foreignLockPublisherPair = publisherStages.length === 1
    && scan.publisherStages.length === 0
    && runtimePublishers.publisherStages.length === 1
    && runtimePublishers.publisherStages[0].kind === "lock"
    && runtimePublishers.publisherStages[0].stat.nlink === 2
    && !transactionOperations.has(runtimePublishers.publisherStages[0].operationId)
    && transactionOperations.size === 1;
  if (
    scan.unknown.length > 0
    || scan.publisherUnknown.length > 0
    || runtimePublishers.publisherUnknown.length > 0
  ) {
    return Object.freeze({ disposition: "manual", operations });
  }
  if (
    (operations.length > 1 && !cleanupOnlyLockPublisher && !foreignLockPublisherPair)
    || scan.stages.length > 1
  ) {
    return Object.freeze({ disposition: "manual", operations });
  }
  for (const stage of scan.stages) {
    const journal = scan.journals.get(stage.operationId) ?? null;
    if (journal === null) return Object.freeze({ disposition: "manual", operations });
    const latestClaim = (scan.claims.get(stage.operationId) ?? []).at(-1) ?? null;
    if (!checkpointStageIsExactSuccessor(journal, stage, latestClaim)) {
      return Object.freeze({ disposition: "manual", operations });
    }
  }
  if (publisherStages.length > 0) {
    return Object.freeze({ disposition: "recovery-required", operations });
  }
  return Object.freeze({
    disposition: operations.length === 0 ? "empty" : "recovery-required",
    operations,
  });
}

function publisherEntryMatchesDescriptor(entry, descriptor) {
  return entry.kind === descriptor.kind
    && entry.operationId === descriptor.operationId
    && entry.generation === descriptor.generation
    && entry.target === descriptor.target
    && sameValue(entry.processIdentity, descriptor.processIdentity);
}

function recoverPublisherStages(paths, entries, operationId) {
  if (entries.some((entry) => entry.operationId !== operationId)) {
    fail("wakeflow-mutation-manual-recovery", "publisher residue belongs to another operation");
  }
  const actions = [];
  for (const entry of entries) {
    const current = inspectPublisherStageFile(paths, entry.candidate, "publisher recovery stage");
    if (
      String(current.dev) !== String(entry.stat.dev)
      || String(current.ino) !== String(entry.stat.ino)
      || current.nlink !== entry.stat.nlink
      || current.size !== entry.stat.size
    ) {
      fail("wakeflow-mutation-recovery-race", "publisher stage changed before recovery");
    }
    const probe = probeProcessIdentity(entry.processIdentity);
    if (probe === "same-live") {
      fail("wakeflow-mutation-recovery-busy", "publisher stage owner is still live");
    }
    if (probe === "unverifiable") {
      fail("wakeflow-mutation-manual-recovery", "publisher stage owner cannot be verified");
    }
    let targetStat = null;
    try {
      targetStat = lstatSync(entry.target);
    } catch (cause) {
      if (cause?.code !== "ENOENT") {
        fail("wakeflow-mutation-manual-recovery", "publisher target cannot be inspected", { cause });
      }
    }
    if (current.nlink === 1) {
      if (
        targetStat
        && String(targetStat.dev) === String(current.dev)
        && String(targetStat.ino) === String(current.ino)
      ) {
        fail("wakeflow-mutation-manual-recovery", "single-link publisher stage aliases its target");
      }
      actions.push({ entry, stat: current, linkCount: 1, restrictedMode: true });
      continue;
    }
    if (
      !targetStat
      || targetStat.isSymbolicLink()
      || !targetStat.isFile()
      || targetStat.uid !== currentEuid()
      || (targetStat.mode & 0o777) !== FILE_MODE
      || (current.mode & 0o777) !== FILE_MODE
      || targetStat.nlink !== 2
      || String(targetStat.dev) !== String(current.dev)
      || String(targetStat.ino) !== String(current.ino)
    ) {
      fail("wakeflow-mutation-manual-recovery", "publisher hard-link pair is not exact");
    }
    let stageSource;
    let targetSource;
    try {
      stageSource = readPrivateCanonicalFile(entry.candidate, {
        paths,
        label: "publisher recovery stage",
        allowedLinkCounts: [2],
      });
      targetSource = readPrivateCanonicalFile(entry.target, {
        paths,
        label: "publisher recovery target",
        allowedLinkCounts: [2],
      });
      const descriptor = publicationDescriptorForTarget(paths, entry.target, targetSource.value);
      if (
        !sameCanonicalInode(stageSource, targetSource)
        || !publisherEntryMatchesDescriptor(entry, descriptor)
      ) {
        fail("wakeflow-mutation-manual-recovery", "publisher hard-link pair payload is not exact");
      }
    } catch (cause) {
      if (cause?.code === "wakeflow-mutation-manual-recovery") throw cause;
      fail("wakeflow-mutation-manual-recovery", "publisher hard-link pair is not canonical", { cause });
    }
    actions.push({ entry, stat: stageSource.stat, linkCount: 2, restrictedMode: false });
  }
  for (const action of actions) {
    unlinkExactPublicationName(action.entry.candidate, action.stat, {
      paths,
      label: "publisher recovery stage",
      expectedLinkCount: action.linkCount,
      allowRestrictedMode: action.restrictedMode,
    });
  }
  return actions;
}

function makeMutationContext(paths, gate) {
  const context = {};
  for (const [key, value] of [
    ["operationId", gate.record.operationId],
    ["ownerToken", gate.record.ownerToken],
    ["recoveryGeneration", gate.record.recoveryGeneration],
  ]) {
    Object.defineProperty(context, key, {
      value,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  Object.freeze(context);
  contextRecords.set(context, {
    active: true,
    workspaceRoot: paths.root,
    mode: gate.record.mode,
    operationKind: gate.record.operationKind,
    domainOwner: gate.record.domainOwner,
    gate,
  });
  return context;
}

function expireMutationContext(context) {
  const record = contextRecords.get(context);
  if (record) record.active = false;
}

function assertNoReentrantMutation() {
  const current = mutationStorage.getStore();
  if (current && contextRecords.get(current)?.active) {
    fail("wakeflow-mutation-reentrant", "nested or reentrant workspace mutation admission is forbidden");
  }
}

/**
 * 证明一个进程内context仍绑定当前workspace的精确gate inode与owner tuple。
 *
 * 该断言不会创建或续期context；gate变化、workspace不匹配或调用结束后的context都会失效。
 */
export function assertWakeflowMutationContext(options = {}) {
  if (!isPlainObject(options)) {
    fail("wakeflow-mutation-invalid-contract", "mutation context assertion options must be a plain object");
  }
  allowedKeys(options, ["workspaceRoot", "context", "mode"], "mutation context assertion options");
  const { workspaceRoot, context, mode } = options;
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    fail("wakeflow-mutation-invalid-contract", "workspaceRoot is required");
  }
  const paths = workspacePaths(workspaceRoot);
  const record = contextRecords.get(context);
  if (!record) fail("wakeflow-mutation-context-forgery", "mutation context is not a branded capability");
  if (!record.active) fail("wakeflow-mutation-context-expired", "mutation context is expired or inactive");
  if (record.workspaceRoot !== paths.root) fail("wakeflow-mutation-context-mismatch", "mutation context belongs to another workspace");
  if (mode !== undefined && record.mode !== mode) fail("wakeflow-mutation-context-mismatch", "mutation context mode differs");
  const current = readLock(paths, { allowMissing: false });
  if (!sameValue(current.value, record.gate.record) || !samePrivateFileSource(current, record.gate.source)) {
    fail("wakeflow-mutation-context-expired", "mutation context no longer owns the exact workspace gate");
  }
  return context;
}

// 五、step观察、owner effect、checkpoint推进与terminal closure。
function normalizeObservationResource(value, contract, label) {
  if (!isPlainObject(value)) fail("wakeflow-mutation-manual-recovery", `${label} observation is not an object`);
  if (value.ref !== contract.ref) fail("wakeflow-mutation-manual-recovery", `${label} observation ref differs`);
  if (value.type === "absent") {
    exactKeys(value, ["ref", "type"], `${label} observation`);
    return cloneFrozen(value);
  }
  exactKeys(value, ["ref", "type", "mode", "digest"], `${label} observation`);
  if (value.type !== "file" && value.type !== "directory") {
    fail("wakeflow-mutation-manual-recovery", `${label} observed an unsupported filesystem type`);
  }
  if (typeof value.mode !== "string" || !MODE_PATTERN.test(value.mode)) {
    fail("wakeflow-mutation-manual-recovery", `${label} observed an invalid mode`);
  }
  assertDigest(value.digest, `${label} observed digest`);
  return cloneFrozen(value);
}

async function observeStep(handler, context, plan, step, effectRecords = []) {
  let raw;
  try {
    raw = await handler.observe({ context, plan, step, effectRecords });
  } catch (cause) {
    fail("wakeflow-mutation-recovery-required", `${step.stepId} strict observer failed`, { cause });
  }
  exactKeys(raw, ["source", "staging", "final"], `${step.stepId} observation`);
  const source = normalizeObservationResource(raw.source, step.source, `${step.stepId}.source`);
  let staging;
  if (step.staging === null) {
    if (raw.staging !== null) {
      fail("wakeflow-mutation-manual-recovery", `${step.stepId}.staging must observe null for in-place repair`);
    }
    staging = null;
  } else {
    staging = normalizeObservationResource(raw.staging, step.staging, `${step.stepId}.staging`);
  }
  const final = normalizeObservationResource(raw.final, step.final, `${step.stepId}.final`);
  return deepFreeze({ source, staging, final });
}

function resourceEquals(observed, expected) {
  return sameValue(observed, expected);
}

function sourceAtFinalRef(step) {
  if (step.source.ref === step.final.ref) return step.source;
  return step.source.type === "absent"
    ? absentSnapshot(step.final.ref)
    : Object.freeze({ ...step.source, ref: step.final.ref });
}

function classifyStepObservation(step, observation) {
  if (step.stepKind === "create-or-update" && step.staging === null) {
    const oldSource = resourceEquals(observation.source, step.source);
    const oldFinal = resourceEquals(observation.final, step.source);
    const newSource = resourceEquals(observation.source, step.final);
    const newFinal = resourceEquals(observation.final, step.final);
    if (oldSource && oldFinal) return "prepared";
    if (newSource && newFinal) return "committed";
    return "illegal";
  }

  const stagingAbsent = step.staging === null
    ? observation.staging === null
    : resourceEquals(observation.staging, absentSnapshot(step.staging.ref));

  if (step.stepKind === "create-or-update") {
    const oldFinal = sourceAtFinalRef(step);
    const initial = resourceEquals(observation.source, step.source)
      && resourceEquals(observation.final, oldFinal)
      && stagingAbsent;
    if (initial) return "initial";
    const prepared = resourceEquals(observation.source, step.source)
      && resourceEquals(observation.final, oldFinal)
      && resourceEquals(observation.staging, step.staging);
    if (prepared) return "prepared";
    const committed = resourceEquals(observation.source, step.final)
      && resourceEquals(observation.final, step.final)
      && stagingAbsent;
    if (committed) return "committed";
    return "illegal";
  }

  if (step.stepKind === "remove") {
    const oldFinal = resourceEquals(observation.source, step.source)
      && resourceEquals(observation.final, step.source);
    if (oldFinal && stagingAbsent) return "prepared";
    const detached = resourceEquals(observation.source, step.final)
      && resourceEquals(observation.final, step.final)
      && resourceEquals(observation.staging, step.staging);
    if (detached) return "committed";
    const cleaned = resourceEquals(observation.source, step.final)
      && resourceEquals(observation.final, step.final)
      && stagingAbsent;
    if (cleaned) return "cleaned";
    return "illegal";
  }

  const sourceExact = resourceEquals(observation.source, step.source);
  const finalAbsent = resourceEquals(observation.final, absentSnapshot(step.final.ref));
  if (sourceExact && finalAbsent && stagingAbsent) return "initial";
  if (sourceExact && finalAbsent && resourceEquals(observation.staging, step.staging)) return "prepared";
  if (sourceExact && resourceEquals(observation.final, step.final) && stagingAbsent) return "committed";
  return "illegal";
}

function expectedAfterPrepare(step) {
  return step.stepKind === "remove" || (step.stepKind === "create-or-update" && step.staging === null)
    ? "prepared"
    : "prepared";
}

function transactionWithStepStatus(transaction, ordinal, status) {
  const steps = transaction.steps.map((step, index) => (
    index === ordinal ? { ...step, status } : step
  ));
  return cloneFrozen({
    ...transaction,
    checkpoint: nextProtocolInteger(transaction.checkpoint, "maintenance checkpoint"),
    steps,
  });
}

function transactionWithOwnerEffectState(transaction, ordinal, {
  status,
  effectCheckpoint,
  effectResult,
  effectOutcome,
}) {
  const steps = transaction.steps.map((step, index) => (
    index === ordinal
      ? {
        ...step,
        status,
        effectCheckpoint,
        effectResult,
        effectOutcome,
      }
      : step
  ));
  return cloneFrozen({
    ...transaction,
    checkpoint: nextProtocolInteger(transaction.checkpoint, "maintenance checkpoint"),
    steps,
  });
}

function portableOwnerEffectRecords(transaction) {
  return deepFreeze(transaction.steps
    .filter((step) => step.stepKind === "owner-effect" && step.status === "committed")
    .map((step) => ({
      stepId: step.stepId,
      ordinal: step.ordinal,
      effectKind: step.effectKind,
      intentDigest: step.intentDigest,
      checkpoint: step.effectCheckpoint,
      result: step.effectResult,
      outcome: step.effectOutcome,
    })));
}

function effectCallbackArgs(transaction, context, plan, step, records = {}) {
  return deepFreeze({
    context,
    plan,
    step,
    checkpoint: records.checkpoint ?? null,
    result: records.result ?? null,
    outcome: records.outcome ?? null,
    effectRecords: portableOwnerEffectRecords(transaction),
  });
}

async function callOwnerEffectRecordBoundary(callback, args, expectedSchemaId, label) {
  let raw;
  try {
    raw = await callback(args);
  } catch {
    fail("wakeflow-mutation-callback-failed", `${label} failed without a portable owner record`);
  }
  let record;
  try {
    record = cloneFrozen(raw);
    validateOwnerEffectRecord(record, expectedSchemaId, label, {
      code: "wakeflow-mutation-invalid-callback",
    });
  } catch (error) {
    if (error instanceof WakeflowWorkspaceMutationError) throw error;
    fail("wakeflow-mutation-invalid-callback", `${label} did not return canonical JSON data`);
  }
  return record;
}

async function callOwnerEffectValidator(callback, args, label) {
  let rawVerdict;
  try {
    rawVerdict = await callback(args);
  } catch {
    fail("wakeflow-mutation-invalid-callback", `${label} rejected its portable owner record`);
  }
  const verdict = canonicalCallbackSnapshot(rawVerdict, `${label} verdict`);
  exactKeys(
    verdict,
    ["valid"],
    `${label} verdict`,
    "wakeflow-mutation-invalid-callback",
  );
  if (verdict.valid !== true) {
    fail("wakeflow-mutation-invalid-callback", `${label} must return exact { valid: true }`);
  }
}

async function validateRecordedOwnerEffect(handler, transaction, context, plan, step, recorded, {
  assertAdmission,
}) {
  const base = effectCallbackArgs(transaction, context, plan, step, {
    checkpoint: recorded.effectCheckpoint,
    result: recorded.effectResult,
    outcome: recorded.effectOutcome,
  });
  if (recorded.effectCheckpoint !== null) {
    await callOwnerEffectValidator(
      handler.validateEffectCheckpoint,
      deepFreeze({ ...base, record: recorded.effectCheckpoint }),
      `${step.stepId}.validateEffectCheckpoint`,
    );
  }
  if (recorded.effectResult !== null) {
    await callOwnerEffectValidator(
      handler.validateEffectResult,
      deepFreeze({ ...base, record: recorded.effectResult }),
      `${step.stepId}.validateEffectResult`,
    );
  }
  if (recorded.effectOutcome !== null) {
    await callOwnerEffectValidator(
      handler.validateEffectOutcome,
      deepFreeze({ ...base, record: recorded.effectOutcome }),
      `${step.stepId}.validateEffectOutcome`,
    );
  }
  if (assertAdmission && recorded.status === "committed") {
    let rawVerdict;
    try {
      rawVerdict = await handler.assertEffectOutcome(base);
    } catch {
      fail("wakeflow-mutation-effect-blocked", `${step.stepId} owner outcome did not admit migration continuation`);
    }
    const verdict = canonicalCallbackSnapshot(
      rawVerdict,
      `${step.stepId}.assertEffectOutcome verdict`,
      "wakeflow-mutation-effect-blocked",
    );
    exactKeys(
      verdict,
      ["admitted"],
      `${step.stepId}.assertEffectOutcome verdict`,
      "wakeflow-mutation-effect-blocked",
    );
    if (verdict.admitted !== true) {
      fail(
        "wakeflow-mutation-effect-blocked",
        `${step.stepId}.assertEffectOutcome must return exact { admitted: true }`,
      );
    }
  }
}

function initialMaintenanceTransaction({ action, gate, plan, planDigest }) {
  assertTransactionPersistenceBudget(plan, { purpose: "maintenance-apply", action });
  const value = {
    schemaVersion: 1,
    artifactKind: "wakeflow-maintenance-transaction",
    operationId: gate.record.operationId,
    purpose: "maintenance-apply",
    action,
    operationKind: gate.record.operationKind,
    domainOwner: gate.record.domainOwner,
    ownerToken: gate.record.ownerToken,
    recoveryGeneration: gate.record.recoveryGeneration,
    processIdentity: gate.record.processIdentity,
    ownerDisposition: "active",
    recoveryClaim: gate.record.recoveryClaim,
    phase: "incomplete",
    plan,
    planDigest,
    checkpoint: 0,
    steps: plan.payload.steps.map((step) => ({
      ...step,
      status: "planned",
      ...(step.stepKind === "owner-effect" ? {
        effectCheckpoint: null,
        effectResult: null,
        effectOutcome: null,
      } : {}),
    })),
    terminalClosure: null,
  };
  validateTransactionRecord(value);
  return deepFreeze(value);
}

function createTransaction(paths, value) {
  const ref = journalRef(value.operationId);
  const source = createCanonicalFile(resolvePortable(paths, ref), value, {
    paths,
    label: "maintenance transaction",
  });
  validateTransactionRecord(source.value);
  return {
    value: source.value,
    bytes: source.bytes,
    source,
    ref,
    affectedOrdinal: null,
    affectedBoundary: null,
  };
}

function validateTerminalClosure(value, expectedPlanDigest) {
  exactKeys(value, ["planDigest", "closureDigests"], "terminal closure");
  if (value.planDigest !== expectedPlanDigest) {
    fail("wakeflow-mutation-terminal-closure", "terminal closure plan digest differs");
  }
  if (
    !Array.isArray(value.closureDigests)
    || value.closureDigests.length === 0
    || value.closureDigests.length > MAX_TERMINAL_CLOSURE_DIGESTS
  ) {
    fail("wakeflow-mutation-terminal-closure", "terminal closure requires at least one domain digest");
  }
  const names = new Set();
  for (const [index, entry] of value.closureDigests.entries()) {
    exactKeys(entry, ["name", "digest"], `terminal closure digest ${index}`);
    assertToken(entry.name, `terminal closure digest ${index}.name`);
    assertDigest(entry.digest, `terminal closure digest ${index}.digest`);
    if (names.has(entry.name)) fail("wakeflow-mutation-terminal-closure", `duplicate closure name: ${entry.name}`);
    names.add(entry.name);
  }
  return value;
}

async function deriveClosure(deriveTerminalClosure, {
  context,
  plan,
  planDigest,
  effectRecords = [],
}) {
  let raw;
  try {
    raw = await deriveTerminalClosure({ context, plan, planDigest, effectRecords });
  } catch (cause) {
    fail("wakeflow-mutation-terminal-closure", "domain terminal closure derivation failed", { cause });
  }
  let frozen;
  try {
    frozen = cloneFrozen(raw);
  } catch (cause) {
    fail("wakeflow-mutation-terminal-closure", "domain terminal closure is not canonical JSON", { cause });
  }
  validateTerminalClosure(frozen, planDigest);
  return frozen;
}

async function callBoundary(callback, args, label) {
  let result;
  try {
    result = await callback(args);
  } catch (cause) {
    throw wrapFailure("wakeflow-mutation-callback-failed", `${label} failed`, cause);
  }
  if (result !== undefined) {
    fail("wakeflow-mutation-invalid-callback", `${label} must return undefined`);
  }
}

async function reconcileIncompleteStep(paths, transactionState, context, plan, handlers, ordinal) {
  const recorded = transactionState.value.steps[ordinal];
  const step = plan.payload.steps[ordinal];
  if (step.stepKind === "owner-effect") {
    await validateRecordedOwnerEffect(
      handlers[step.stepId],
      transactionState.value,
      context,
      plan,
      step,
      recorded,
      { assertAdmission: false },
    );
    return recorded.status;
  }
  const observation = await observeStep(
    handlers[step.stepId],
    context,
    plan,
    step,
    portableOwnerEffectRecords(transactionState.value),
  );
  const physical = classifyStepObservation(step, observation);
  if (physical === "illegal" || physical === "cleaned") {
    fail("wakeflow-mutation-manual-recovery", `${step.stepId} has an illegal physical artifact combination`);
  }
  let targetStatus = recorded.status;
  if (physical === "committed" && recorded.status === "planned") {
    fail("wakeflow-mutation-manual-recovery", `${step.stepId} crossed prepare and commit from a planned checkpoint`);
  }
  if (physical === "committed") targetStatus = "committed";
  else if (physical === "prepared" && recorded.status === "planned") targetStatus = "prepared";
  else if (physical === "initial" && recorded.status !== "planned") {
    fail("wakeflow-mutation-manual-recovery", `${step.stepId} regressed behind its durable checkpoint`);
  }
  if (recorded.status === "committed" && physical !== "committed") {
    fail("wakeflow-mutation-manual-recovery", `${step.stepId} differs from its committed checkpoint`);
  }
  if (targetStatus !== recorded.status) {
    checkpointTransaction(
      paths,
      transactionState,
      transactionWithStepStatus(transactionState.value, ordinal, targetStatus),
    );
  }
  return physical;
}

async function reconcileAffectedIncompleteStep(paths, transactionState, context, plan, handlers) {
  if (!Number.isInteger(transactionState.affectedOrdinal)) return;
  await reconcileIncompleteStep(
    paths,
    transactionState,
    context,
    plan,
    handlers,
    transactionState.affectedOrdinal,
  );
  transactionState.affectedOrdinal = null;
  transactionState.affectedBoundary = null;
}

async function executeOwnerEffectStep(
  paths,
  transactionState,
  context,
  plan,
  step,
  handler,
  ordinal,
  { recovery },
) {
  let recorded = transactionState.value.steps[ordinal];
  await validateRecordedOwnerEffect(
    handler,
    transactionState.value,
    context,
    plan,
    step,
    recorded,
    { assertAdmission: false },
  );
  let startedHere = false;

  if (recorded.status === "planned") {
    transactionState.affectedOrdinal = ordinal;
    transactionState.affectedBoundary = "effect-preflight";
    let checkpoint;
    try {
      checkpoint = await callOwnerEffectRecordBoundary(
        handler.prepareEffect,
        effectCallbackArgs(transactionState.value, context, plan, step),
        step.checkpointSchemaId,
        `${step.stepId}.prepareEffect`,
      );
    } catch (error) {
      transactionState.affectedOrdinal = null;
      transactionState.affectedBoundary = null;
      throw error;
    }
    await callOwnerEffectValidator(
      handler.validateEffectCheckpoint,
      deepFreeze({
        ...effectCallbackArgs(transactionState.value, context, plan, step, { checkpoint }),
        record: checkpoint,
      }),
      `${step.stepId}.validateEffectCheckpoint`,
    );
    checkpointTransaction(
      paths,
      transactionState,
      transactionWithOwnerEffectState(transactionState.value, ordinal, {
        status: "effect-started",
        effectCheckpoint: checkpoint,
        effectResult: null,
        effectOutcome: null,
      }),
    );
    transactionState.affectedOrdinal = null;
    transactionState.affectedBoundary = null;
    recorded = transactionState.value.steps[ordinal];
    startedHere = true;
  }

  if (recorded.status === "effect-started") {
    transactionState.affectedOrdinal = ordinal;
    transactionState.affectedBoundary = recovery && !startedHere
      ? "effect-recovery-probe"
      : "effect";
    const callback = recovery && !startedHere ? handler.recoverEffect : handler.performEffect;
    const callbackName = recovery && !startedHere ? "recoverEffect" : "performEffect";
    const result = await callOwnerEffectRecordBoundary(
      callback,
      effectCallbackArgs(transactionState.value, context, plan, step, {
        checkpoint: recorded.effectCheckpoint,
      }),
      step.resultSchemaId,
      `${step.stepId}.${callbackName}`,
    );
    await callOwnerEffectValidator(
      handler.validateEffectResult,
      deepFreeze({
        ...effectCallbackArgs(transactionState.value, context, plan, step, {
          checkpoint: recorded.effectCheckpoint,
          result,
        }),
        record: result,
      }),
      `${step.stepId}.validateEffectResult`,
    );
    checkpointTransaction(
      paths,
      transactionState,
      transactionWithOwnerEffectState(transactionState.value, ordinal, {
        status: "effect-completed",
        effectCheckpoint: recorded.effectCheckpoint,
        effectResult: result,
        effectOutcome: null,
      }),
    );
    transactionState.affectedOrdinal = null;
    transactionState.affectedBoundary = null;
    recorded = transactionState.value.steps[ordinal];
  }

  if (recorded.status === "effect-completed") {
    transactionState.affectedOrdinal = ordinal;
    transactionState.affectedBoundary = "effect-observation";
    const outcome = await callOwnerEffectRecordBoundary(
      handler.observeEffect,
      effectCallbackArgs(transactionState.value, context, plan, step, {
        checkpoint: recorded.effectCheckpoint,
        result: recorded.effectResult,
      }),
      step.outcomeSchemaId,
      `${step.stepId}.observeEffect`,
    );
    await callOwnerEffectValidator(
      handler.validateEffectOutcome,
      deepFreeze({
        ...effectCallbackArgs(transactionState.value, context, plan, step, {
          checkpoint: recorded.effectCheckpoint,
          result: recorded.effectResult,
          outcome,
        }),
        record: outcome,
      }),
      `${step.stepId}.validateEffectOutcome`,
    );
    checkpointTransaction(
      paths,
      transactionState,
      transactionWithOwnerEffectState(transactionState.value, ordinal, {
        status: "committed",
        effectCheckpoint: recorded.effectCheckpoint,
        effectResult: recorded.effectResult,
        effectOutcome: outcome,
      }),
    );
    transactionState.affectedOrdinal = null;
    transactionState.affectedBoundary = null;
    recorded = transactionState.value.steps[ordinal];
  }

  if (recorded.status !== "committed") {
    fail("wakeflow-mutation-invalid-artifact", `${step.stepId} has an unknown owner-effect checkpoint status`);
  }
  await validateRecordedOwnerEffect(
    handler,
    transactionState.value,
    context,
    plan,
    step,
    recorded,
    { assertAdmission: true },
  );
}

async function executeMaintenanceSteps(paths, transactionState, context, plan, handlers, { recovery }) {
  // normal与recovery共享同一forward-only执行器，差异只在已存在物理中间态的接纳方式。
  for (let ordinal = 0; ordinal < plan.payload.steps.length; ordinal += 1) {
    const step = plan.payload.steps[ordinal];
    const handler = handlers[step.stepId];
    if (step.stepKind === "owner-effect") {
      await executeOwnerEffectStep(
        paths,
        transactionState,
        context,
        plan,
        step,
        handler,
        ordinal,
        { recovery },
      );
      continue;
    }
    let recorded = transactionState.value.steps[ordinal];
    let observation = await observeStep(
      handler,
      context,
      plan,
      step,
      portableOwnerEffectRecords(transactionState.value),
    );
    let physical = classifyStepObservation(step, observation);
    if (physical === "illegal" || physical === "cleaned") {
      fail("wakeflow-mutation-manual-recovery", `${step.stepId} has an illegal physical artifact combination`);
    }

    if (recorded.status === "planned") {
      if (!recovery) {
        const exactNormalInitial = step.stepKind === "remove"
          || (step.stepKind === "create-or-update" && step.staging === null)
          ? "prepared"
          : "initial";
        if (physical !== exactNormalInitial) {
          fail("wakeflow-mutation-manual-recovery", `${step.stepId} changed before its normal prepare boundary`);
        }
        transactionState.affectedOrdinal = ordinal;
        transactionState.affectedBoundary = "prepare";
        await callBoundary(handler.prepare, {
          context,
          plan,
          step,
          effectRecords: portableOwnerEffectRecords(transactionState.value),
        }, `${step.stepId}.prepare`);
        observation = await observeStep(
          handler,
          context,
          plan,
          step,
          portableOwnerEffectRecords(transactionState.value),
        );
        physical = classifyStepObservation(step, observation);
        if (physical !== expectedAfterPrepare(step)) {
          fail("wakeflow-mutation-manual-recovery", `${step.stepId} prepare did not produce its exact prepared state`);
        }
        checkpointTransaction(
          paths,
          transactionState,
          transactionWithStepStatus(transactionState.value, ordinal, "prepared"),
        );
        transactionState.affectedOrdinal = null;
        transactionState.affectedBoundary = null;
        recorded = transactionState.value.steps[ordinal];
      } else if (physical === "committed") {
        fail("wakeflow-mutation-manual-recovery", `${step.stepId} committed without a prepared checkpoint`);
      } else if (physical === "prepared") {
        checkpointTransaction(
          paths,
          transactionState,
          transactionWithStepStatus(transactionState.value, ordinal, "prepared"),
        );
        recorded = transactionState.value.steps[ordinal];
      } else {
        transactionState.affectedOrdinal = ordinal;
        transactionState.affectedBoundary = "prepare";
        await callBoundary(handler.prepare, {
          context,
          plan,
          step,
          effectRecords: portableOwnerEffectRecords(transactionState.value),
        }, `${step.stepId}.prepare`);
        observation = await observeStep(
          handler,
          context,
          plan,
          step,
          portableOwnerEffectRecords(transactionState.value),
        );
        physical = classifyStepObservation(step, observation);
        if (physical !== expectedAfterPrepare(step)) {
          fail("wakeflow-mutation-manual-recovery", `${step.stepId} prepare did not produce its exact prepared state`);
        }
        checkpointTransaction(
          paths,
          transactionState,
          transactionWithStepStatus(transactionState.value, ordinal, "prepared"),
        );
        transactionState.affectedOrdinal = null;
        transactionState.affectedBoundary = null;
        recorded = transactionState.value.steps[ordinal];
      }
    }

    if (recorded.status === "prepared") {
      observation = await observeStep(
        handler,
        context,
        plan,
        step,
        portableOwnerEffectRecords(transactionState.value),
      );
      physical = classifyStepObservation(step, observation);
      if (physical === "committed") {
        checkpointTransaction(
          paths,
          transactionState,
          transactionWithStepStatus(transactionState.value, ordinal, "committed"),
        );
        continue;
      }
      if (physical !== "prepared") {
        fail("wakeflow-mutation-manual-recovery", `${step.stepId} differs from its prepared checkpoint`);
      }
      transactionState.affectedOrdinal = ordinal;
      transactionState.affectedBoundary = "commit";
      await callBoundary(handler.commit, {
        context,
        plan,
        step,
        effectRecords: portableOwnerEffectRecords(transactionState.value),
      }, `${step.stepId}.commit`);
      observation = await observeStep(
        handler,
        context,
        plan,
        step,
        portableOwnerEffectRecords(transactionState.value),
      );
      physical = classifyStepObservation(step, observation);
      if (physical !== "committed") {
        fail("wakeflow-mutation-manual-recovery", `${step.stepId} commit did not produce its exact committed state`);
      }
      checkpointTransaction(
        paths,
        transactionState,
        transactionWithStepStatus(transactionState.value, ordinal, "committed"),
      );
      transactionState.affectedOrdinal = null;
      transactionState.affectedBoundary = null;
      continue;
    }

    if (recorded.status === "committed") {
      if (physical !== "committed") {
        fail("wakeflow-mutation-manual-recovery", `${step.stepId} differs from its committed checkpoint`);
      }
      continue;
    }
    fail("wakeflow-mutation-invalid-artifact", `${step.stepId} has an unknown checkpoint status`);
  }
}

async function terminalizeAndCleanup(paths, transactionState, context, plan, handlers, deriveTerminalClosure) {
  // 先持久化第一次closure，再做幂等cleanup，最后要求同一closure保持不变。
  const effectRecords = portableOwnerEffectRecords(transactionState.value);
  const firstClosure = await deriveClosure(deriveTerminalClosure, {
    context,
    plan,
    planDigest: transactionState.value.planDigest,
    effectRecords,
  });
  const terminal = cloneFrozen({
    ...transactionState.value,
    ownerDisposition: "active",
    phase: "terminal",
    checkpoint: nextProtocolInteger(transactionState.value.checkpoint, "maintenance checkpoint"),
    terminalClosure: firstClosure,
  });
  checkpointTransaction(paths, transactionState, terminal);

  for (const step of plan.payload.steps) {
    const handler = handlers[step.stepId];
    if (step.stepKind === "owner-effect") {
      await validateRecordedOwnerEffect(
        handler,
        transactionState.value,
        context,
        plan,
        step,
        transactionState.value.steps[step.ordinal],
        { assertAdmission: true },
      );
      continue;
    }
    if (handler.cleanup) {
      await callBoundary(handler.cleanup, {
        context,
        plan,
        step,
        effectRecords: portableOwnerEffectRecords(transactionState.value),
      }, `${step.stepId}.cleanup`);
    }
    const observation = await observeStep(
      handler,
      context,
      plan,
      step,
      portableOwnerEffectRecords(transactionState.value),
    );
    const physical = classifyStepObservation(step, observation);
    const expected = step.stepKind === "remove" ? "cleaned" : "committed";
    if (physical !== expected) {
      fail("wakeflow-mutation-manual-recovery", `${step.stepId} terminal cleanup is not exact`);
    }
  }

  const secondClosure = await deriveClosure(deriveTerminalClosure, {
    context,
    plan,
    planDigest: transactionState.value.planDigest,
    effectRecords: portableOwnerEffectRecords(transactionState.value),
  });
  if (!sameValue(secondClosure, firstClosure)) {
    fail("wakeflow-mutation-terminal-closure", "domain closure changed during terminal cleanup");
  }
}

async function verifyTerminalAndCleanup(transactionState, context, plan, handlers, deriveTerminalClosure) {
  // terminal recovery不重放commit，只验证持久closure并幂等完成cleanup。
  const recordedClosure = transactionState.value.terminalClosure;
  const effectRecords = portableOwnerEffectRecords(transactionState.value);
  const beforeCleanup = await deriveClosure(deriveTerminalClosure, {
    context,
    plan,
    planDigest: transactionState.value.planDigest,
    effectRecords,
  });
  if (!sameValue(beforeCleanup, recordedClosure)) {
    fail("wakeflow-mutation-terminal-closure", "terminal recovery closure differs from the durable checkpoint");
  }
  for (const step of plan.payload.steps) {
    const handler = handlers[step.stepId];
    if (step.stepKind === "owner-effect") {
      await validateRecordedOwnerEffect(
        handler,
        transactionState.value,
        context,
        plan,
        step,
        transactionState.value.steps[step.ordinal],
        { assertAdmission: true },
      );
      continue;
    }
    if (handler.cleanup) {
      await callBoundary(handler.cleanup, {
        context,
        plan,
        step,
        effectRecords: portableOwnerEffectRecords(transactionState.value),
      }, `${step.stepId}.cleanup`);
    }
    const observation = await observeStep(
      handler,
      context,
      plan,
      step,
      portableOwnerEffectRecords(transactionState.value),
    );
    const physical = classifyStepObservation(step, observation);
    const expected = step.stepKind === "remove" ? "cleaned" : "committed";
    if (physical !== expected) {
      fail("wakeflow-mutation-manual-recovery", `${step.stepId} terminal recovery cleanup is not exact`);
    }
  }
  const afterCleanup = await deriveClosure(deriveTerminalClosure, {
    context,
    plan,
    planDigest: transactionState.value.planDigest,
    effectRecords: portableOwnerEffectRecords(transactionState.value),
  });
  if (!sameValue(afterCleanup, recordedClosure)) {
    fail("wakeflow-mutation-terminal-closure", "terminal recovery closure changed during cleanup");
  }
}

function relinquishIncompleteTransaction(paths, transactionState) {
  // 失败owner只能在incomplete阶段持久化relinquished，terminal owner必须保留gate等待显式恢复。
  if (transactionState.value.phase !== "incomplete") {
    fail("wakeflow-mutation-recovery-required", "terminal transaction ownership cannot be relinquished");
  }
  if (transactionState.value.ownerDisposition !== "relinquished") {
    const relinquished = cloneFrozen({
      ...transactionState.value,
      ownerDisposition: "relinquished",
      checkpoint: nextProtocolInteger(transactionState.value.checkpoint, "maintenance checkpoint"),
    });
    checkpointTransaction(paths, transactionState, relinquished);
  }
}

function deleteTransaction(paths, transactionState) {
  unlinkExactFile(resolvePortable(paths, transactionState.ref), transactionState.source, {
    paths,
    label: "maintenance transaction",
  });
}

function publicLockSummary(lock) {
  if (!lock) return null;
  return deepFreeze({
    operationId: lock.value.operationId,
    mode: lock.value.mode,
    operationKind: lock.value.operationKind,
    domainOwner: lock.value.domainOwner,
    recoveryGeneration: lock.value.recoveryGeneration,
  });
}

// 六、只读检查、普通runtime gate与confirmed maintenance apply入口。

/**
 * 只读分类workspace mutation协议当前是absent、bootstrap-prefix、idle、busy还是recovery-required。
 *
 * 返回值只包含脱敏operation摘要；它不清理publisher、journal或未知residue，也不宣告领域任务完成。
 */
export function inspectWakeflowWorkspaceMutation(options = {}) {
  if (!isPlainObject(options)) {
    fail("wakeflow-mutation-invalid-contract", "workspace mutation inspection options must be a plain object");
  }
  allowedKeys(options, ["workspaceRoot"], "workspace mutation inspection options");
  const { workspaceRoot } = options;
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    fail("wakeflow-mutation-invalid-contract", "workspaceRoot is required");
  }
  const paths = workspacePaths(workspaceRoot);
  assertWorkspaceRoot(paths);
  if (!pathEntryExists(paths.local, "Wakeflow local root")) {
    return deepFreeze({ state: "absent", lock: null, operations: [] });
  }
  assertDirectory(paths.local, {
    paths,
    label: "Wakeflow local root",
    modes: SAFE_MIGRATION_LOCAL_MODES,
  });
  if (!pathEntryExists(paths.runtime, "Wakeflow runtime root")) {
    return deepFreeze({ state: "bootstrap-prefix", lock: null, operations: [] });
  }
  assertDirectory(paths.runtime, { paths, label: "Wakeflow runtime root" });
  const runtimePublishers = scanRuntimePublisherStages(paths);
  if (!pathEntryExists(paths.maintenance, "Wakeflow maintenance root")) {
    const classification = classifyTransactionResidue(emptyTransactionScan(), runtimePublishers);
    if (classification.disposition === "manual") {
      fail("wakeflow-mutation-manual-recovery", "runtime root contains invalid publisher residue");
    }
    if (classification.disposition === "recovery-required") {
      return deepFreeze({ state: "recovery-required", lock: null, operations: classification.operations });
    }
    const lock = readLock(paths, { allowMissing: true });
    return deepFreeze({ state: lock ? "busy" : "bootstrap-prefix", lock: publicLockSummary(lock), operations: [] });
  }
  assertDirectory(paths.maintenance, { paths, label: "Wakeflow maintenance root" });
  if (existingEntryNames(paths.maintenance).some((entry) => entry !== "transactions")) {
    fail("wakeflow-mutation-manual-recovery", "unknown entry exists in the maintenance protocol root");
  }
  if (!pathEntryExists(paths.transactions, "Wakeflow maintenance transactions root")) {
    const classification = classifyTransactionResidue(emptyTransactionScan(), runtimePublishers);
    if (classification.disposition === "manual") {
      fail("wakeflow-mutation-manual-recovery", "runtime root contains invalid publisher residue");
    }
    if (classification.disposition === "recovery-required") {
      return deepFreeze({ state: "recovery-required", lock: null, operations: classification.operations });
    }
    const lock = readLock(paths, { allowMissing: true });
    return deepFreeze({ state: lock ? "busy" : "bootstrap-prefix", lock: publicLockSummary(lock), operations: [] });
  }
  const scan = scanTransactions(paths);
  const classification = classifyTransactionResidue(scan, runtimePublishers);
  if (classification.disposition === "manual") {
    fail("wakeflow-mutation-manual-recovery", "maintenance transaction root contains unknown residue");
  }
  const lock = runtimePublishers.publisherStages.length > 0
    ? null
    : readLock(paths, { allowMissing: true });
  const state = classification.disposition === "recovery-required"
    ? "recovery-required"
    : lock
      ? "busy"
      : "idle";
  return deepFreeze({ state, lock: publicLockSummary(lock), operations: classification.operations });
}

function validateSafeReleaseVerdict(value) {
  exactKeys(value, ["disposition", "closureDigests"], "runtime safe-release verdict");
  if (value.disposition !== "safe-to-release") {
    fail("wakeflow-mutation-invalid-callback", "runtime verifier disposition is invalid");
  }
  if (!Array.isArray(value.closureDigests) || value.closureDigests.length === 0) {
    fail("wakeflow-mutation-invalid-callback", "safe release requires owner closure digests");
  }
  const names = new Set();
  for (const [index, entry] of value.closureDigests.entries()) {
    exactKeys(entry, ["name", "digest"], `runtime closure digest ${index}`);
    assertToken(entry.name, `runtime closure digest ${index}.name`);
    assertDigest(entry.digest, `runtime closure digest ${index}.digest`);
    if (names.has(entry.name)) fail("wakeflow-mutation-invalid-callback", "runtime closure names must be unique");
    names.add(entry.name);
  }
  return cloneFrozen(value);
}

async function validateLockOnlyVerdict(value, validateRecoveryPlan) {
  exactKeys(value, ["disposition", "plan", "planDigest"], "runtime lock-only recovery verdict");
  if (value.disposition !== "lock-only-recovery") {
    fail("wakeflow-mutation-invalid-callback", "runtime verifier disposition is invalid");
  }
  const plan = await codecPlan(value.plan, validateRecoveryPlan, "runtime recovery plan");
  if (plan.payload.steps.length !== 0) {
    fail("wakeflow-mutation-invalid-plan", "lock-only recovery plan must contain zero physical steps");
  }
  assertTransactionPersistenceBudget(plan, {
    purpose: "lock-only-recovery",
    action: "runtime-mutation-recovery",
  });
  const digest = canonicalJsonDigest(plan);
  if (value.planDigest !== digest) {
    fail("wakeflow-mutation-invalid-plan", "runtime recovery plan digest differs from its payload");
  }
  return deepFreeze({ disposition: "lock-only-recovery", plan, planDigest: digest });
}

async function classifyRuntimeFailureVerdict(value, validateRecoveryPlan) {
  const verdict = canonicalCallbackSnapshot(value, "runtime failure verifier verdict");
  if (!isPlainObject(verdict) || typeof verdict.disposition !== "string") {
    fail("wakeflow-mutation-invalid-callback", "runtime failure verifier returned no disposition");
  }
  if (verdict.disposition === "safe-to-release") return validateSafeReleaseVerdict(verdict);
  if (verdict.disposition === "lock-only-recovery") {
    if (typeof validateRecoveryPlan !== "function") {
      fail("wakeflow-mutation-invalid-plan", "validateRecoveryPlan is required for lock-only recovery");
    }
    return validateLockOnlyVerdict(verdict, validateRecoveryPlan);
  }
  fail("wakeflow-mutation-invalid-callback", `unsupported runtime failure disposition: ${verdict.disposition}`);
}

/**
 * 在唯一workspace gate内运行一个非maintenance领域的普通runtime callback。
 *
 * callback成功后释放gate；失败时只有owner verifier给出精确safe-release或lock-only recovery计划才允许推进。
 * 该入口不替领域owner判断业务回滚，也不把失败自动转换成maintenance step。
 */
export async function withWakeflowRuntimeMutation(options, callback) {
  if (!isPlainObject(options)) fail("wakeflow-mutation-invalid-contract", "runtime mutation options are required");
  allowedKeys(options, [
    "workspaceRoot",
    "operationKind",
    "domainOwner",
    "acquireTimeoutMs",
    "validateRecoveryPlan",
    "onCallbackFailure",
  ], "runtime mutation options");
  if (typeof callback !== "function") fail("wakeflow-mutation-invalid-contract", "runtime mutation callback is required");
  assertNoReentrantMutation();
  const {
    workspaceRoot,
    operationKind,
    domainOwner,
    acquireTimeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS,
    validateRecoveryPlan,
    onCallbackFailure,
  } = options;
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    fail("wakeflow-mutation-invalid-contract", "workspaceRoot is required");
  }
  assertToken(operationKind, "operationKind");
  assertToken(domainOwner, "domainOwner");
  if (onCallbackFailure !== undefined && typeof onCallbackFailure !== "function") {
    fail("wakeflow-mutation-invalid-contract", "onCallbackFailure must be a function");
  }
  const paths = workspacePaths(workspaceRoot);
  validateExistingProtocol(paths);
  assertEmptyAdmissionResidue(paths);
  const processIdentity = captureSelfProcessIdentity();
  let gate = await acquireGate(paths, {
    mode: "runtime-mutation",
    operationKind,
    domainOwner,
    processIdentity,
    acquireTimeoutMs,
  });
  let context;
  let gateReleased = false;
  try {
    assertEmptyAdmissionResidue(paths);
    context = makeMutationContext(paths, gate);
    let result;
    try {
      result = await mutationStorage.run(context, async () => callback(context));
    } catch (callbackError) {
      if (!onCallbackFailure) {
        throw wrapFailure(
          "wakeflow-mutation-recovery-required",
          "runtime callback failed without an owner-specific release verifier; exact gate retained",
          callbackError,
        );
      }
      let firstRaw;
      try {
        firstRaw = await mutationStorage.run(context, async () => onCallbackFailure({
          context,
          error: callbackError,
          phase: "after-callback-settled",
          expectedPlanDigest: null,
        }));
      } catch (cause) {
        throw wrapFailure(
          "wakeflow-mutation-recovery-required",
          "runtime failure verifier failed; exact gate retained",
          cause,
        );
      }
      const first = await classifyRuntimeFailureVerdict(firstRaw, validateRecoveryPlan);
      if (first.disposition === "safe-to-release") {
        releaseGate(paths, gate);
        gateReleased = true;
        throw wrapFailure("wakeflow-mutation-callback-failed", "runtime callback failed after safe release", callbackError);
      }

      const oldGate = gate;
      const generation = nextProtocolInteger(
        oldGate.record.recoveryGeneration,
        "workspace recovery generation",
      );
      const nextToken = newOwnerToken();
      const acquiredAt = nowTimestamp();
      const previousJournal = absentArtifact(journalRef(oldGate.record.operationId));
      const previousLock = fileArtifact(paths, LOCK_REF, oldGate.source);
      const previousClaim = absentArtifact(claimRef(oldGate.record.operationId, generation - 1));
      const nextOwner = deepFreeze({
        mode: "recovery-cleanup",
        operationKind: oldGate.record.operationKind,
        domainOwner: oldGate.record.domainOwner,
        ownerToken: nextToken,
        recoveryGeneration: generation,
        processIdentity,
        acquiredAt,
      });
      const claimValue = recoveryClaimRecord({
        operationId: oldGate.record.operationId,
        generation,
        planDigest: first.planDigest,
        previousOwner: ownerFromLock(oldGate.source),
        nextOwner,
        previousJournal,
        previousLock,
        previousClaim,
        createdAt: acquiredAt,
      });
      const newClaimRef = claimRef(oldGate.record.operationId, generation);
      let newClaim;
      try {
        newClaim = createCanonicalFile(resolvePortable(paths, newClaimRef), claimValue, {
          paths,
          label: `runtime failure recovery claim generation ${generation}`,
        });
      } catch (error) {
        if (error?.code === "wakeflow-mutation-exclusive-conflict") {
          fail("wakeflow-mutation-recovery-claim-busy", "another runtime recovery contender won the claim");
        }
        throw error;
      }
      const claimReference = deepFreeze({
        ref: newClaimRef,
        generation,
        digest: canonicalJsonDigest(claimValue),
      });
      assertArtifactStill(paths, previousJournal, "absent runtime failure journal");
      assertArtifactStill(paths, previousLock, "runtime failure workspace gate");
      assertArtifactStill(paths, previousClaim, "runtime failure predecessor claim");
      const transactionState = createTransaction(paths, orphanLockOnlyTransaction({
        action: "runtime-mutation-recovery",
        lock: oldGate.source,
        plan: first.plan,
        planDigest: first.planDigest,
        nextOwner,
        claimReference,
      }));
      assertArtifactStill(paths, previousLock, "runtime failure workspace gate");
      assertArtifactStill(paths, fileArtifact(paths, newClaimRef, newClaim), "runtime failure recovery claim");
      releaseGate(paths, oldGate);
      gateReleased = true;
      expireMutationContext(context);
      context = null;
      try {
        gate = await acquireGate(paths, {
          mode: "recovery-cleanup",
          operationKind: oldGate.record.operationKind,
          domainOwner: oldGate.record.domainOwner,
          operationId: oldGate.record.operationId,
          ownerToken: nextToken,
          recoveryGeneration: generation,
          processIdentity,
          recoveryClaim: claimReference,
          acquiredAt,
          acquireTimeoutMs: 0,
        });
      } catch (error) {
        let settled = false;
        try {
          settled = settleActiveIncompleteOwnerAfterGateFailure(paths, transactionState);
        } catch (settlementError) {
          throw wrapFailure(
            "wakeflow-mutation-recovery-required",
            "runtime failure takeover could not be durably relinquished",
            error,
            { settlementError, operationId: oldGate.record.operationId, recoveryGeneration: generation },
          );
        }
        if (settled) {
          throw wrapFailure(
            "wakeflow-mutation-recovery-required",
            "runtime failure takeover was durably relinquished",
            error,
            { operationId: oldGate.record.operationId, recoveryGeneration: generation },
          );
        }
        throw error;
      }
      gateReleased = false;
      context = makeMutationContext(paths, gate);
      let secondRaw;
      try {
        secondRaw = await mutationStorage.run(context, async () => onCallbackFailure({
          context,
          error: callbackError,
          phase: "before-gate-release",
          expectedPlanDigest: first.planDigest,
        }));
      } catch (cause) {
        throw wrapFailure(
          "wakeflow-mutation-recovery-required",
          "second runtime recovery proof failed; exact gate retained",
          cause,
        );
      }
      const second = await classifyRuntimeFailureVerdict(secondRaw, validateRecoveryPlan);
      if (second.disposition !== "lock-only-recovery" || !sameValue(second, first)) {
        fail("wakeflow-mutation-recovery-required", "runtime lock-only recovery proof changed; exact gate retained");
      }
      const relinquished = cloneFrozen({
        ...transactionState.value,
        ownerDisposition: "relinquished",
      });
      checkpointTransaction(paths, transactionState, relinquished);
      releaseGate(paths, gate);
      gateReleased = true;
      throw wrapFailure(
        "wakeflow-mutation-recovery-required",
        "runtime callback left a stable lock-only recovery journal",
        callbackError,
        { operationId: gate.record.operationId },
      );
    }
    releaseGate(paths, gate);
    gateReleased = true;
    return result;
  } catch (error) {
    if (!context && !gateReleased) {
      try {
        releaseGate(paths, gate);
        gateReleased = true;
      } catch (releaseError) {
        throw wrapFailure(
          "wakeflow-mutation-recovery-required",
          "runtime admission failed and its exact gate could not be released",
          error,
          { releaseError },
        );
      }
    }
    throw error;
  } finally {
    if (context) expireMutationContext(context);
  }
}

function validateMaintenanceInputs(options) {
  if (!isPlainObject(options)) fail("wakeflow-mutation-invalid-contract", "maintenance mutation options are required");
  allowedKeys(options, [
    "workspaceRoot",
    "action",
    "operationKind",
    "domainOwner",
    "acquireTimeoutMs",
    "confirmedPlan",
    "planDigest",
    "validatePlan",
    "deriveCurrentPlan",
    "deriveTerminalClosure",
    "stepHandlers",
  ], "maintenance mutation options");
  const {
    workspaceRoot,
    action,
    operationKind,
    domainOwner,
    confirmedPlan,
    planDigest,
    validatePlan,
    deriveCurrentPlan,
    deriveTerminalClosure,
    stepHandlers,
    acquireTimeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS,
  } = options;
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) fail("wakeflow-mutation-invalid-contract", "workspaceRoot is required");
  if (!ACTIONS.has(action)) fail("wakeflow-mutation-invalid-action", `invalid maintenance action: ${action}`);
  assertToken(operationKind, "operationKind");
  assertToken(domainOwner, "domainOwner");
  if (typeof deriveCurrentPlan !== "function") fail("wakeflow-mutation-invalid-plan", "deriveCurrentPlan is required");
  if (!isPlainObject(stepHandlers)) fail("wakeflow-mutation-invalid-handlers", "stepHandlers is required");
  const stableStepHandlers = snapshotStepHandlers(stepHandlers);
  if (!Number.isInteger(acquireTimeoutMs) || acquireTimeoutMs < 0 || acquireTimeoutMs > 300_000) {
    fail("wakeflow-mutation-invalid-contract", "acquireTimeoutMs must be an integer from 0 to 300000");
  }
  return {
    workspaceRoot,
    action,
    operationKind,
    domainOwner,
    confirmedPlan,
    planDigest,
    validatePlan,
    deriveCurrentPlan,
    deriveTerminalClosure,
    stepHandlers: stableStepHandlers,
    acquireTimeoutMs,
  };
}

async function deriveAndVerifyCurrentPlan({ deriveCurrentPlan, validatePlan, context, confirmedPlan, planDigest }) {
  let raw;
  try {
    raw = await deriveCurrentPlan({ context });
  } catch (cause) {
    fail("wakeflow-mutation-plan-blocked", "current maintenance plan derivation was blocked", { cause });
  }
  const current = await codecPlan(raw, validatePlan, "current maintenance plan");
  const currentDigest = canonicalJsonDigest(current);
  if (currentDigest !== planDigest || !sameValue(current, confirmedPlan)) {
    fail("wakeflow-mutation-plan-stale", "confirmed maintenance plan is plan-stale");
  }
  return current;
}

/**
 * 使用confirmed plan执行一笔完整maintenance事务。
 *
 * 入栅栏后重新派生并比较计划；每个物理边界之后先checkpoint，再进入下一步。
 * 无step计划只验证当前事实并释放gate；有step计划只有terminal closure稳定且journal删除后才报告completed。
 */
export async function runWakeflowMaintenanceMutation(options) {
  assertNoReentrantMutation();
  const input = validateMaintenanceInputs(options);
  const confirmedPlan = await codecPlan(input.confirmedPlan, input.validatePlan, "confirmed maintenance plan");
  const expectedPlanDigest = canonicalJsonDigest(confirmedPlan);
  if (input.planDigest !== expectedPlanDigest) {
    fail("wakeflow-mutation-invalid-plan", "confirmed maintenance plan digest differs from its payload");
  }
  validateMaintenancePlanSteps(confirmedPlan, input.stepHandlers, {
    action: input.action,
    requireTerminalClosure: confirmedPlan.payload.steps.length > 0,
    deriveTerminalClosure: input.deriveTerminalClosure,
  });
  if (confirmedPlan.payload.steps.length > 0) {
    assertTransactionPersistenceBudget(confirmedPlan, {
      purpose: "maintenance-apply",
      action: input.action,
    });
  }

  const paths = workspacePaths(input.workspaceRoot);
  const processIdentity = captureSelfProcessIdentity();
  let created = [];
  let gate;
  let gateReleased = false;
  let context;
  let transactionState = null;
  let terminalJournalRemoved = false;
  let completed = false;
  try {
    prepareBootstrap(paths, input.action, created);
    assertEmptyAdmissionResidue(paths);
    gate = await acquireGate(paths, {
      mode: "maintenance",
      operationKind: input.operationKind,
      domainOwner: input.domainOwner,
      processIdentity,
      acquireTimeoutMs: input.acquireTimeoutMs,
    });
    completeBootstrapInsideGate(paths, created);
    assertEmptyAdmissionResidue(paths);
    context = makeMutationContext(paths, gate);
    const currentPlan = await mutationStorage.run(context, () => deriveAndVerifyCurrentPlan({
      deriveCurrentPlan: input.deriveCurrentPlan,
      validatePlan: input.validatePlan,
      context,
      confirmedPlan,
      planDigest: expectedPlanDigest,
    }));

    if (currentPlan.payload.steps.length === 0) {
      releaseGate(paths, gate);
      gateReleased = true;
      completed = true;
      return deepFreeze({
        operationId: gate.record.operationId,
        status: "no-op",
        planDigest: expectedPlanDigest,
      });
    }

    transactionState = createTransaction(paths, initialMaintenanceTransaction({
      action: input.action,
      gate,
      plan: currentPlan,
      planDigest: expectedPlanDigest,
    }));
    await mutationStorage.run(context, () => executeMaintenanceSteps(
      paths,
      transactionState,
      context,
      currentPlan,
      input.stepHandlers,
      { recovery: false },
    ));
    await mutationStorage.run(context, () => terminalizeAndCleanup(
      paths,
      transactionState,
      context,
      currentPlan,
      input.stepHandlers,
      input.deriveTerminalClosure,
    ));
    deleteTransaction(paths, transactionState);
    terminalJournalRemoved = true;
    transactionState = null;
    releaseGate(paths, gate);
    gateReleased = true;
    completed = true;
    return deepFreeze({
      operationId: gate.record.operationId,
      status: "completed",
      planDigest: expectedPlanDigest,
    });
  } catch (error) {
    if (gate && !gateReleased && transactionState) {
      if (transactionState.value.phase === "incomplete") {
        const noBoundaryWasAttempted = transactionState.value.checkpoint === 0
          && transactionState.affectedOrdinal === null
          && transactionState.value.steps.every((step) => step.status === "planned");
        if (noBoundaryWasAttempted) {
          try {
            deleteTransaction(paths, transactionState);
            transactionState = null;
            cleanBootstrap(paths, created, "under-lock");
            releaseGate(paths, gate);
            gateReleased = true;
            cleanBootstrap(paths, created, "pre-lock");
          } catch (cleanupError) {
            throw wrapFailure(
              "wakeflow-mutation-recovery-required",
              "pre-boundary maintenance rejection could not remove its exact protocol artifacts",
              error,
              { cleanupError, operationId: gate.record.operationId },
            );
          }
          throw error;
        }
        try {
          if (context) {
            await mutationStorage.run(context, () => reconcileAffectedIncompleteStep(
              paths,
              transactionState,
              context,
              confirmedPlan,
              input.stepHandlers,
            ));
          }
          relinquishIncompleteTransaction(paths, transactionState);
          releaseGate(paths, gate);
          gateReleased = true;
          throw wrapFailure(
            "wakeflow-mutation-recovery-required",
            "maintenance callback/effect failed after a stable incomplete checkpoint",
            error,
            { operationId: gate.record.operationId },
          );
        } catch (recoveryError) {
          if (recoveryError?.code === "wakeflow-mutation-recovery-required" && gateReleased) throw recoveryError;
          throw wrapFailure(
            "wakeflow-mutation-recovery-required",
            "maintenance failure could not be safely relinquished; exact gate retained",
            error,
            { recoveryError, operationId: gate.record.operationId },
          );
        }
      }
      throw wrapFailure(
        "wakeflow-mutation-recovery-required",
        "terminal maintenance cleanup failed; exact gate retained",
        error,
        { operationId: gate.record.operationId },
      );
    }

    if (gate && !gateReleased && terminalJournalRemoved) {
      throw wrapFailure(
        "wakeflow-mutation-recovery-required",
        "terminal maintenance completed but final gate release is unresolved; bootstrap roots retained",
        error,
        { operationId: gate.record.operationId },
      );
    }

    if (gate && !gateReleased) {
      let cleanupError = null;
      try {
        cleanBootstrap(paths, created, "under-lock");
      } catch (cause) {
        cleanupError = cause;
      }
      try {
        releaseGate(paths, gate);
        gateReleased = true;
      } catch (cause) {
        cleanupError ??= cause;
      }
      if (cleanupError) {
        throw wrapFailure(
          "wakeflow-mutation-bootstrap-recovery-required",
          "maintenance admission failed and bootstrap cleanup was incomplete",
          error,
          { cleanupError },
        );
      }
    }
    if (!completed) {
      try {
        cleanBootstrap(paths, created, "pre-lock");
      } catch (cleanupError) {
        throw wrapFailure(
          "wakeflow-mutation-bootstrap-recovery-required",
          "maintenance admission failed and pre-lock bootstrap cleanup was incomplete",
          error,
          { cleanupError },
        );
      }
    }
    throw error;
  } finally {
    if (context) expireMutationContext(context);
  }
}

// 七、recovery owner链、claim接管、publisher收敛与显式恢复入口。

function artifactForSource(paths, ref, source) {
  return source === null ? absentArtifact(ref) : fileArtifact(paths, ref, source);
}

function assertArtifactStill(paths, artifact, label) {
  const candidate = resolvePortable(paths, artifact.ref);
  if (artifact.type === "absent") {
    if (pathEntryExists(candidate, label)) {
      fail("wakeflow-mutation-recovery-race", `${label} appeared during recovery claim`);
    }
    return null;
  }
  const source = readPrivateCanonicalFile(candidate, { paths, label });
  if (!sameValue(fileArtifact(paths, artifact.ref, source), artifact)) {
    fail("wakeflow-mutation-recovery-race", `${label} changed during recovery claim`);
  }
  return source;
}

function ownerFromLock(lock) {
  return deepFreeze({
    mode: lock.value.mode,
    operationKind: lock.value.operationKind,
    domainOwner: lock.value.domainOwner,
    ownerTokenDigest: sha256Bytes(Buffer.from(lock.value.ownerToken, "utf8")),
    recoveryGeneration: lock.value.recoveryGeneration,
    processIdentity: lock.value.processIdentity,
    ownerDisposition: "active",
  });
}

function ownerFromTransaction(transaction) {
  return deepFreeze({
    mode: transaction.value.recoveryGeneration > 0
      ? "recovery-cleanup"
      : transaction.value.purpose === "maintenance-apply"
        ? "maintenance"
        : "runtime-mutation",
    operationKind: transaction.value.operationKind,
    domainOwner: transaction.value.domainOwner,
    ownerTokenDigest: sha256Bytes(Buffer.from(transaction.value.ownerToken, "utf8")),
    recoveryGeneration: transaction.value.recoveryGeneration,
    processIdentity: transaction.value.processIdentity,
    ownerDisposition: transaction.value.ownerDisposition,
  });
}

function activeOwnerFromTransaction(transaction) {
  return deepFreeze({
    ...ownerFromTransaction(transaction),
    ownerDisposition: "active",
  });
}

function ownerFromClaimNext(claim) {
  return deepFreeze({
    mode: "recovery-cleanup",
    operationKind: claim.source.value.nextOwner.operationKind,
    domainOwner: claim.source.value.nextOwner.domainOwner,
    ownerTokenDigest: sha256Bytes(Buffer.from(claim.source.value.nextOwner.ownerToken, "utf8")),
    recoveryGeneration: claim.source.value.nextOwner.recoveryGeneration,
    processIdentity: claim.source.value.nextOwner.processIdentity,
    ownerDisposition: "active",
  });
}

function relinquishedOwnerFromClaimNext(claim) {
  return deepFreeze({
    ...ownerFromClaimNext(claim),
    ownerDisposition: "relinquished",
  });
}

function currentRecoveryOwner({ transaction = null, lock = null, latestClaim = null }) {
  const authoritativeArtifactGeneration = Math.max(
    transaction?.value.recoveryGeneration ?? 0,
    lock?.value.recoveryGeneration ?? 0,
  );
  if (latestClaim && latestClaim.generation > authoritativeArtifactGeneration) {
    return ownerFromClaimNext(latestClaim);
  }
  if (lock && lock.value.recoveryGeneration === authoritativeArtifactGeneration) {
    return ownerFromLock(lock);
  }
  if (transaction && transaction.value.recoveryGeneration === authoritativeArtifactGeneration) {
    return ownerFromTransaction(transaction);
  }
  if (latestClaim) return ownerFromClaimNext(latestClaim);
  fail("wakeflow-mutation-manual-recovery", "recovery has no authoritative predecessor owner");
}

function claimReferenceForEntry(claim) {
  return {
    ref: claim.ref,
    generation: claim.generation,
    digest: canonicalJsonDigest(claim.source.value),
  };
}

function claimNextOwnerMatchesLock(claim, lock) {
  return sameValue(claim.source.value.nextOwner, {
    mode: lock.value.mode,
    operationKind: lock.value.operationKind,
    domainOwner: lock.value.domainOwner,
    ownerToken: lock.value.ownerToken,
    recoveryGeneration: lock.value.recoveryGeneration,
    processIdentity: lock.value.processIdentity,
    acquiredAt: lock.value.acquiredAt,
  });
}

function claimNextOwnerMatchesTransaction(claim, transaction) {
  const next = claim.source.value.nextOwner;
  return transaction.value.operationKind === next.operationKind
    && transaction.value.domainOwner === next.domainOwner
    && transaction.value.ownerToken === next.ownerToken
    && transaction.value.recoveryGeneration === next.recoveryGeneration
    && sameValue(transaction.value.processIdentity, next.processIdentity)
    && sameValue(transaction.value.recoveryClaim, claimReferenceForEntry(claim));
}

function journalTransitionPreviousOwner(transaction, claim, claims) {
  const priorClaim = claims.find((entry) => entry.generation === claim.generation - 1) ?? null;
  if (priorClaim && priorClaim.generation > transaction.value.recoveryGeneration) {
    return ownerFromClaimNext(priorClaim);
  }
  return claim.source.value.previousLock.type === "file"
    ? activeOwnerFromTransaction(transaction)
    : ownerFromTransaction(transaction);
}

function assertRecoveryCheckpointCapacity(transaction) {
  if (!transaction || transaction.value.purpose !== "maintenance-apply") return;
  let requiredAdvances = 1;
  if (transaction.value.phase === "incomplete") {
    requiredAdvances += 1;
    for (const step of transaction.value.steps) {
      const remaining = step.stepKind === "owner-effect"
        ? {
          planned: 3,
          "effect-started": 2,
          "effect-completed": 1,
          committed: 0,
        }[step.status]
        : { planned: 2, prepared: 1, committed: 0 }[step.status];
      if (!Number.isSafeInteger(remaining)) {
        fail("wakeflow-mutation-manual-recovery", "maintenance step has an unknown checkpoint status");
      }
      requiredAdvances += remaining;
    }
  }
  if (
    !Number.isSafeInteger(requiredAdvances)
    || requiredAdvances > MAX_SAFE_PROTOCOL_INTEGER - transaction.value.checkpoint
  ) {
    fail(
      "wakeflow-mutation-manual-recovery",
      "maintenance checkpoint has insufficient safe-integer capacity for recovery",
    );
  }
}

function validateExistingRecoveryChain(paths, {
  operationId,
  planDigest,
  transaction,
  claims,
  lock,
}) {
  // recovery只接受由exact artifact和连续generation共同证明的唯一owner链。
  if (!transaction && !lock) {
    fail("wakeflow-mutation-manual-recovery", "recovery has neither an exact journal nor an exact orphan lock");
  }
  if (transaction && transaction.value.operationId !== operationId) {
    fail("wakeflow-mutation-manual-recovery", "maintenance journal belongs to another operation");
  }
  if (lock && lock.value.operationId !== operationId) {
    fail("wakeflow-mutation-manual-recovery", "workspace gate belongs to another operation");
  }
  assertRecoveryCheckpointCapacity(transaction);
  const operationKind = transaction?.value.operationKind ?? lock?.value.operationKind;
  const domainOwner = transaction?.value.domainOwner ?? lock?.value.domainOwner;
  if (transaction && lock && (
    lock.value.operationKind !== operationKind
    || lock.value.domainOwner !== domainOwner
  )) {
    fail("wakeflow-mutation-manual-recovery", "workspace gate owner tuple differs from the journal");
  }
  const terminal = transaction?.value.phase === "terminal";
  const orphan = transaction === null;
  const lockOnlyCleanupJournal = transaction?.value.purpose === "lock-only-recovery"
    && LOCK_ONLY_ACTIONS.has(transaction.value.action)
    && transaction.value.ownerDisposition === "relinquished"
    && transaction.value.recoveryGeneration > 0;
  const lockOnlyCleanup = lockOnlyCleanupJournal
    && lock !== null
    && transaction.value.recoveryGeneration === lock.value.recoveryGeneration
    && lock.value.mode === "recovery-cleanup";
  const lockOnlyTransitionClaim = lockOnlyCleanupJournal
    ? claims.find((claim) => claim.generation === nextProtocolInteger(
      transaction.value.recoveryGeneration,
      "workspace recovery generation",
    )) ?? null
    : null;
  const lockOnlyTransitionPredecessor = lockOnlyCleanupJournal
    ? claims.find((claim) => claim.generation === transaction.value.recoveryGeneration) ?? null
    : null;
  const lockOnlyTransitionPredecessorArtifact = lockOnlyTransitionClaim
    ? lockOnlyTransitionPredecessor
      ? fileArtifact(paths, lockOnlyTransitionPredecessor.ref, lockOnlyTransitionPredecessor.source)
      : absentArtifact(claimRef(operationId, transaction.value.recoveryGeneration))
    : null;
  const lockOnlyJournalTransition = lockOnlyTransitionClaim !== null
    && claims.at(-1).generation > transaction.value.recoveryGeneration
    && (
      lockOnlyTransitionPredecessor !== null
      || claims[0].generation === lockOnlyTransitionClaim.generation
    )
    && sameValue(
      lockOnlyTransitionClaim.source.value.previousClaim,
      lockOnlyTransitionPredecessorArtifact,
    )
    && sameValue(
      lockOnlyTransitionClaim.source.value.previousJournal,
      fileArtifact(paths, transaction.ref, transaction),
    )
    && sameValue(
      lockOnlyTransitionClaim.source.value.previousOwner,
      journalTransitionPreviousOwner(transaction, lockOnlyTransitionClaim, claims),
    );
  // claims -> journal -> gate publication can crash before the lock-only journal
  // or immediately after publishing it while the exact old gate still exists.
  // Both states retain one complete claim chain bound to that old gate and to the
  // journal's formerly absent canonical path.
  const latestPublishedClaim = claims.at(-1) ?? null;
  const orphanPublicationChain = lock !== null
    && claims.length > 0
    && (
      orphan
      || (
        transaction.value.purpose === "lock-only-recovery"
        && transaction.value.ownerDisposition === "active"
        && transaction.value.recoveryGeneration > lock.value.recoveryGeneration
        && transaction.value.recoveryGeneration === latestPublishedClaim.generation
      )
    );
  if (claims.length > 0) {
    const firstGeneration = claims[0].generation;
    const orphanDerivedSuffix = !orphanPublicationChain
      && transaction?.value.purpose === "lock-only-recovery"
      && claims[0].source.value.previousJournal.type === "absent"
      && claims[0].source.value.previousClaim.type === "absent";
    if (
      !terminal
      && !orphanDerivedSuffix
      && !orphanPublicationChain
      && !lockOnlyCleanup
      && !lockOnlyJournalTransition
      && firstGeneration !== 1
    ) {
      fail("wakeflow-mutation-manual-recovery", "incomplete recovery claim chain must start at generation one");
    }
    if (
      orphanPublicationChain
      && firstGeneration !== nextProtocolInteger(
        lock.value.recoveryGeneration,
        "workspace recovery generation",
      )
    ) {
      fail("wakeflow-mutation-manual-recovery", "orphan recovery claim suffix does not start after the old gate");
    }
    const orphanJournal = orphanPublicationChain ? absentArtifact(journalRef(operationId)) : null;
    const orphanLock = orphanPublicationChain ? fileArtifact(paths, LOCK_REF, lock) : null;
    for (let index = 0; index < claims.length; index += 1) {
      const claim = claims[index];
      const value = claim.source.value;
      if (
        value.operationId !== operationId
        || value.recoveryGeneration !== claim.generation
        || value.planDigest !== planDigest
        || value.nextOwner.operationKind !== operationKind
        || value.nextOwner.domainOwner !== domainOwner
        || value.previousOwner.operationKind !== operationKind
        || value.previousOwner.domainOwner !== domainOwner
        || value.previousOwner.recoveryGeneration !== claim.generation - 1
      ) {
        fail("wakeflow-mutation-manual-recovery", "recovery claim operation/plan/owner tuple is inconsistent");
      }
      if (orphanPublicationChain && (
        !sameValue(value.previousJournal, orphanJournal)
        || !sameValue(value.previousLock, orphanLock)
      )) {
        fail("wakeflow-mutation-manual-recovery", "orphan recovery claim does not bind the exact old gate and absent journal");
      }
      if (index > 0) {
        const previous = claims[index - 1];
        if (claim.generation !== nextProtocolInteger(previous.generation, "workspace recovery generation")) {
          fail("wakeflow-mutation-manual-recovery", "recovery claims are not a contiguous chain");
        }
        if (!sameValue(value.previousClaim, fileArtifact(paths, previous.ref, previous.source))) {
          fail("wakeflow-mutation-manual-recovery", "recovery claim predecessor artifact is not exact");
        }
        const directJournalTransitionOwner = index === claims.length - 1
          && transaction
          && transaction.value.recoveryGeneration === previous.generation
          ? journalTransitionPreviousOwner(transaction, claim, claims)
          : null;
        if (
          !sameValue(value.previousOwner, ownerFromClaimNext(previous))
          && !sameValue(value.previousOwner, relinquishedOwnerFromClaimNext(previous))
          && !sameValue(value.previousOwner, directJournalTransitionOwner)
        ) {
          fail("wakeflow-mutation-manual-recovery", "recovery claim previous owner differs from the prior claimant");
        }
      } else if (orphanPublicationChain) {
        const expectedPreviousClaim = absentArtifact(claimRef(
          operationId,
          lock.value.recoveryGeneration,
        ));
        if (
          !sameValue(value.previousClaim, expectedPreviousClaim)
          || !sameValue(value.previousOwner, ownerFromLock(lock))
          || pathEntryExists(
            resolvePortable(paths, expectedPreviousClaim.ref),
            "orphan predecessor recovery claim",
          )
        ) {
          fail("wakeflow-mutation-manual-recovery", "first orphan recovery claim predecessor is not exact");
        }
      } else if (claim.generation === 1) {
        if (
          value.previousClaim.type !== "absent"
          || value.previousClaim.ref !== claimRef(operationId, 0)
        ) {
          fail("wakeflow-mutation-manual-recovery", "first recovery claim has an invalid predecessor claim ref");
        }
      } else if (terminal || lockOnlyCleanup || lockOnlyJournalTransition) {
        if (value.previousClaim.type !== "file" && value.previousClaim.type !== "absent") {
          fail("wakeflow-mutation-manual-recovery", "cleanup claim suffix predecessor has an invalid type");
        }
        const expectedMissingRef = claimRef(operationId, claim.generation - 1);
        if (
          value.previousClaim.ref !== expectedMissingRef
          || pathEntryExists(resolvePortable(paths, expectedMissingRef), "cleanup predecessor recovery claim")
        ) {
          fail("wakeflow-mutation-manual-recovery", "claim suffix predecessor is not a legal cleaned claim");
        }
      } else if (orphanDerivedSuffix) {
        const expectedMissingRef = claimRef(operationId, claim.generation - 1);
        if (
          value.previousClaim.type !== "absent"
          || value.previousClaim.ref !== expectedMissingRef
          || value.previousJournal.type !== "absent"
        ) {
          fail("wakeflow-mutation-manual-recovery", "orphan-derived claim suffix is not exact");
        }
      } else {
        fail("wakeflow-mutation-manual-recovery", "nonterminal recovery claim suffix is not allowed");
      }
      if (
        value.previousJournal.ref !== journalRef(operationId)
        || value.previousLock.ref !== LOCK_REF
      ) {
        fail("wakeflow-mutation-manual-recovery", "recovery claim predecessor refs are not canonical");
      }
    }
  }

  const latest = claims.at(-1) ?? null;
  const authoritativeGeneration = Math.max(
    transaction?.value.recoveryGeneration ?? 0,
    lock?.value.recoveryGeneration ?? 0,
  );
  if (lockOnlyCleanup && latest && latest.generation < authoritativeGeneration) {
    fail("wakeflow-mutation-manual-recovery", "lock-only cleanup claim suffix ends before the authoritative generation");
  }
  if (terminal) {
    if (latest && latest.generation < authoritativeGeneration) {
      fail("wakeflow-mutation-manual-recovery", "terminal cleanup claim suffix ends before the authoritative generation");
    }
  } else if (!orphan && !lockOnlyCleanup && (
    (authoritativeGeneration > 0 && !latest)
    || (latest && latest.generation < authoritativeGeneration)
  )) {
    fail("wakeflow-mutation-manual-recovery", "incomplete recovery owner has no covering recovery claim chain");
  }

  if (lock?.value.recoveryGeneration > 0) {
    const matching = claims.find((claim) => claim.generation === lock.value.recoveryGeneration) ?? null;
    if (matching) {
      if (
        !sameValue(lock.value.recoveryClaim, claimReferenceForEntry(matching))
        || !claimNextOwnerMatchesLock(matching, lock)
      ) {
        fail("wakeflow-mutation-manual-recovery", "successor gate differs from its recovery claim");
      }
    } else if (!terminal && !orphan && !lockOnlyCleanup && !orphanPublicationChain) {
      fail("wakeflow-mutation-manual-recovery", "nonterminal successor gate references a missing recovery claim");
    }
  }

  if (transaction?.value.recoveryGeneration > 0) {
    const matching = claims.find((claim) => claim.generation === transaction.value.recoveryGeneration) ?? null;
    if (matching) {
      if (!claimNextOwnerMatchesTransaction(matching, transaction)) {
        fail("wakeflow-mutation-manual-recovery", "journal owner differs from its latest recovery claim");
      }
    } else if (!terminal && !lockOnlyCleanup && !lockOnlyJournalTransition) {
      fail("wakeflow-mutation-manual-recovery", "nonterminal journal references a missing recovery claim");
    }
  }

  if (transaction && lock && transaction.value.recoveryGeneration === lock.value.recoveryGeneration) {
    if (
      lock.value.mode !== ownerFromTransaction(transaction).mode
      ||
      transaction.value.ownerToken !== lock.value.ownerToken
      || !sameValue(transaction.value.processIdentity, lock.value.processIdentity)
      || !sameValue(transaction.value.recoveryClaim, lock.value.recoveryClaim)
    ) {
      fail("wakeflow-mutation-manual-recovery", "matching-generation lock and journal owners differ");
    }
  }

  if (latest && lock && lock.value.recoveryGeneration < latest.generation) {
    if (!sameValue(latest.source.value.previousLock, fileArtifact(paths, LOCK_REF, lock))) {
      fail("wakeflow-mutation-manual-recovery", "pending recovery claim does not bind the exact old lock");
    }
    if (transaction) {
      const orphanJournalPublishedAfterClaim = transaction.value.purpose === "lock-only-recovery"
        && transaction.value.recoveryGeneration === latest.generation
        && latest.source.value.previousJournal.type === "absent";
      if (
        !orphanJournalPublishedAfterClaim
        && !sameValue(latest.source.value.previousJournal, fileArtifact(paths, transaction.ref, transaction))
      ) {
        fail("wakeflow-mutation-manual-recovery", "pending recovery claim does not bind the exact current journal");
      }
    } else if (latest.source.value.previousJournal.type !== "absent") {
      fail("wakeflow-mutation-manual-recovery", "orphan-lock recovery claim unexpectedly cites a journal");
    }
    const priorClaim = claims.find((claim) => claim.generation === latest.generation - 1) ?? null;
    const expectedPreviousOwner = priorClaim
      ? ownerFromClaimNext(priorClaim)
      : ownerFromLock(lock);
    if (!sameValue(latest.source.value.previousOwner, expectedPreviousOwner)) {
      fail("wakeflow-mutation-manual-recovery", "pending recovery claim previous owner differs from the old lock");
    }
  }

  if (
    latest
    && lock?.value.recoveryGeneration === latest.generation
    && transaction
    && transaction.value.recoveryGeneration < latest.generation
  ) {
    if (!sameValue(latest.source.value.previousJournal, fileArtifact(paths, transaction.ref, transaction))) {
      fail("wakeflow-mutation-manual-recovery", "claim plus successor-lock transition does not bind the old journal");
    }
    if (!sameValue(
      latest.source.value.previousOwner,
      journalTransitionPreviousOwner(transaction, latest, claims),
    )) {
      fail("wakeflow-mutation-manual-recovery", "claim transition previous owner differs from the old journal authority");
    }
  }
  if (
    latest
    && !lock
    && transaction
    && transaction.value.recoveryGeneration < latest.generation
  ) {
    if (!sameValue(latest.source.value.previousJournal, fileArtifact(paths, transaction.ref, transaction))) {
      fail("wakeflow-mutation-manual-recovery", "claim-only transition does not bind the exact old journal");
    }
    if (!sameValue(
      latest.source.value.previousOwner,
      journalTransitionPreviousOwner(transaction, latest, claims),
    )) {
      fail("wakeflow-mutation-manual-recovery", "claim-only transition previous owner differs from the old journal authority");
    }
  }
  return latest;
}

function refreshInterloperRecoveryInventory(paths, {
  operationId,
  planDigest,
  transaction,
  claims,
  stages,
  expectedLock,
}) {
  const runtimePublishers = scanRuntimePublisherStages(paths);
  const scan = scanTransactions(paths);
  if (
    runtimePublishers.publisherStages.length > 0
    || runtimePublishers.publisherUnknown.length > 0
    || scan.publisherStages.length > 0
    || scan.publisherUnknown.length > 0
    || scan.unknown.length > 0
    || scan.journals.size !== 1
    || !scan.journals.has(operationId)
    || [...scan.claims.keys()].some((candidate) => candidate !== operationId)
    || scan.stages.some((stage) => stage.operationId !== operationId)
  ) {
    fail("wakeflow-mutation-recovery-race", "interloper recovery inventory is no longer exact");
  }
  const refreshedTransaction = scan.journals.get(operationId);
  const refreshedClaims = scan.claims.get(operationId) ?? [];
  if (
    !samePrivateFileSource(refreshedTransaction, transaction)
    || refreshedClaims.length !== claims.length
    || scan.stages.length !== stages.length
    || refreshedClaims.some((claim, index) => (
      claim.generation !== claims[index].generation
      || claim.ref !== claims[index].ref
      || !samePrivateFileSource(claim.source, claims[index].source)
    ))
    || scan.stages.some((stage, index) => (
      stage.generation !== stages[index].generation
      || stage.ref !== stages[index].ref
      || !samePrivateFileSource(stage.source, stages[index].source)
    ))
  ) {
    fail("wakeflow-mutation-recovery-race", "interloper recovery evidence changed");
  }
  const refreshedLock = readLock(paths, { allowMissing: true });
  if (
    (expectedLock === null && refreshedLock !== null)
    || (expectedLock !== null && !samePrivateFileSource(refreshedLock, expectedLock))
  ) {
    fail("wakeflow-mutation-recovery-race", "interloper workspace gate changed");
  }
  const latestClaim = validateExistingRecoveryChain(paths, {
    operationId,
    planDigest,
    transaction: refreshedTransaction,
    claims: refreshedClaims,
    lock: null,
  });
  for (const stage of scan.stages) {
    if (!checkpointStageIsExactSuccessor(refreshedTransaction, stage, latestClaim)) {
      fail("wakeflow-mutation-manual-recovery", "interloper cleanup cannot bind the checkpoint stage");
    }
  }
  return {
    transaction: refreshedTransaction,
    claims: refreshedClaims,
    stages: scan.stages,
    foreignLock: refreshedLock,
    latestClaim,
  };
}

function removeDeadUnadmittedInterloperGate(paths, {
  operationId,
  planDigest,
  transaction,
  claims,
  stages,
  foreignLock,
}) {
  if (!foreignLock || foreignLock.value.operationId === operationId) {
    return { transaction, claims, stages, oldLock: foreignLock };
  }
  const claimlessRelinquishedJournal = claims.length === 0
    && transaction.value.purpose === "maintenance-apply"
    && transaction.value.recoveryGeneration === 0
    && transaction.value.recoveryClaim === null
    && transaction.value.phase === "incomplete"
    && transaction.value.ownerDisposition === "relinquished"
    && transaction.value.checkpoint >= 1;
  if (
    (!claimlessRelinquishedJournal && claims.length === 0)
    || foreignLock.value.recoveryGeneration !== 0
    || foreignLock.value.recoveryClaim !== null
  ) {
    fail("wakeflow-mutation-manual-recovery", "foreign workspace gate is not an unadmitted generation-zero interloper");
  }
  let refreshed = refreshInterloperRecoveryInventory(paths, {
    operationId,
    planDigest,
    transaction,
    claims,
    stages,
    expectedLock: foreignLock,
  });
  const foreignArtifact = fileArtifact(paths, LOCK_REF, refreshed.foreignLock);
  if (refreshed.claims.some((claim) => sameValue(claim.source.value.previousLock, foreignArtifact))) {
    fail(
      "wakeflow-mutation-manual-recovery",
      "recovery claim binds the foreign workspace gate and cannot classify it as an interloper",
    );
  }
  const predecessorOwner = currentRecoveryOwner({
    transaction: refreshed.transaction,
    lock: null,
    latestClaim: refreshed.latestClaim,
  });
  assertPreviousOwnerRecoverable(predecessorOwner, { lockPresent: false });
  const interloperProbe = probeProcessIdentity(refreshed.foreignLock.value.processIdentity);
  if (interloperProbe === "same-live") {
    fail("wakeflow-mutation-recovery-busy", "an unadmitted workspace gate interloper is still live");
  }
  if (interloperProbe === "unverifiable") {
    fail("wakeflow-mutation-manual-recovery", "an unadmitted workspace gate interloper cannot be verified");
  }
  unlinkExactFile(paths.lock, refreshed.foreignLock, {
    paths,
    label: "unadmitted workspace gate interloper",
  });
  refreshed = refreshInterloperRecoveryInventory(paths, {
    operationId,
    planDigest,
    transaction: refreshed.transaction,
    claims: refreshed.claims,
    stages: refreshed.stages,
    expectedLock: null,
  });
  return {
    transaction: refreshed.transaction,
    claims: refreshed.claims,
    stages: refreshed.stages,
    oldLock: null,
  };
}

function assertPreviousOwnerRecoverable(owner, { lockPresent }) {
  if (!lockPresent && owner.ownerDisposition === "relinquished") return;
  const probe = probeProcessIdentity(owner.processIdentity);
  if (probe === "same-live") {
    fail("wakeflow-mutation-recovery-busy", "recorded workspace mutation owner is still live");
  }
  if (probe === "unverifiable") {
    fail("wakeflow-mutation-manual-recovery", "recorded workspace mutation owner cannot be verified");
  }
}

function validateRecoveryInputs(options) {
  if (!isPlainObject(options)) fail("wakeflow-mutation-invalid-contract", "recovery options are required");
  allowedKeys(options, [
    "workspaceRoot",
    "operationId",
    "confirmedPlan",
    "planDigest",
    "validatePlan",
    "deriveCurrentPlan",
    "deriveTerminalClosure",
    "stepHandlers",
  ], "workspace mutation recovery options");
  const {
    workspaceRoot,
    operationId,
    confirmedPlan,
    planDigest,
    validatePlan,
    deriveCurrentPlan,
    deriveTerminalClosure,
    stepHandlers,
  } = options;
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) fail("wakeflow-mutation-invalid-contract", "workspaceRoot is required");
  assertOperationId(operationId);
  if (typeof deriveCurrentPlan !== "function") fail("wakeflow-mutation-invalid-plan", "deriveCurrentPlan is required for recovery");
  if (!isPlainObject(stepHandlers)) fail("wakeflow-mutation-invalid-handlers", "stepHandlers is required for recovery");
  const stableStepHandlers = snapshotStepHandlers(stepHandlers);
  return {
    workspaceRoot,
    operationId,
    confirmedPlan,
    planDigest,
    validatePlan,
    deriveCurrentPlan,
    deriveTerminalClosure,
    stepHandlers: stableStepHandlers,
  };
}

async function deriveRecoveryPlan({ deriveCurrentPlan, validatePlan, context, confirmedPlan, planDigest, phase }) {
  // 每个接管关键点都重新派生同一计划，防止claim期间authority发生变化。
  let raw;
  try {
    raw = await deriveCurrentPlan({ context });
  } catch (cause) {
    fail("wakeflow-mutation-manual-recovery", `recovery plan derivation failed ${phase}`, { cause });
  }
  const plan = await codecPlan(raw, validatePlan, `recovery plan ${phase}`);
  if (canonicalJsonDigest(plan) !== planDigest || !sameValue(plan, confirmedPlan)) {
    fail("wakeflow-mutation-plan-stale", `recovery plan is plan-stale ${phase}`);
  }
  return plan;
}

function recoveryClaimRecord({
  operationId,
  generation,
  planDigest,
  previousOwner,
  nextOwner,
  previousJournal,
  previousLock,
  previousClaim,
  createdAt,
}) {
  const value = deepFreeze({
    schemaVersion: 1,
    artifactKind: "wakeflow-workspace-recovery-claim",
    operationId,
    recoveryGeneration: generation,
    planDigest,
    previousOwner,
    nextOwner,
    previousJournal,
    previousLock,
    previousClaim,
    createdAt,
  });
  validateClaimRecord(value);
  return value;
}

function recoveryOwnedTransaction(transaction, gate, claimReference) {
  const checkpoint = transaction.value.purpose === "lock-only-recovery"
    ? 0
    : nextProtocolInteger(transaction.value.checkpoint, "maintenance checkpoint");
  const value = cloneFrozen({
    ...transaction.value,
    ownerToken: gate.record.ownerToken,
    recoveryGeneration: gate.record.recoveryGeneration,
    processIdentity: gate.record.processIdentity,
    ownerDisposition: "active",
    recoveryClaim: claimReference,
    checkpoint,
  });
  validateTransactionRecord(value);
  return value;
}

function relinquishedRecoveryOwnedTransaction(transaction, nextOwner, claimReference) {
  if (transaction.value.phase !== "incomplete") return null;
  const checkpoint = transaction.value.purpose === "lock-only-recovery"
    ? transaction.value.checkpoint
    : nextProtocolInteger(transaction.value.checkpoint, "maintenance checkpoint");
  const value = cloneFrozen({
    ...transaction.value,
    ownerToken: nextOwner.ownerToken,
    recoveryGeneration: nextOwner.recoveryGeneration,
    processIdentity: nextOwner.processIdentity,
    ownerDisposition: "relinquished",
    recoveryClaim: claimReference,
    checkpoint,
  });
  validateTransactionRecord(value);
  return value;
}

function settleFailedPreSuccessorTakeover(paths, {
  transaction,
  claims,
  stages,
  nextOwner,
  claimReference,
  newClaim,
}) {
  const settledValue = relinquishedRecoveryOwnedTransaction(
    transaction,
    nextOwner,
    claimReference,
  );
  if (settledValue === null) return false;
  const runtimePublishers = scanRuntimePublisherStages(paths);
  if (
    runtimePublishers.publisherStages.length > 0
    || runtimePublishers.publisherUnknown.length > 0
  ) return false;
  const currentLock = readLock(paths, { allowMissing: true });
  if (
    currentLock !== null
    && (
      currentLock.value.operationId === transaction.value.operationId
      || currentLock.value.recoveryGeneration !== 0
      || currentLock.value.recoveryClaim !== null
    )
  ) return false;
  const currentLockArtifact = artifactForSource(paths, LOCK_REF, currentLock);
  if (currentLock === null) {
    // The predecessor unlink may have completed before its parent fsync failed.
    // Do not publish a relinquished successor journal until lock absence itself
    // has a successful durability boundary.
    fsyncParent(paths.lock, "pre-successor predecessor gate absence");
    assertArtifactStill(
      paths,
      currentLockArtifact,
      "durable pre-successor predecessor gate absence",
    );
  }
  const expectedClaims = [
    ...claims,
    { generation: claimReference.generation, ref: claimReference.ref, source: newClaim },
  ];
  const inventoryIsExact = (scan, { allowStages }) => {
    if (
      scan.unknown.length > 0
      || scan.publisherStages.length > 0
      || scan.publisherUnknown.length > 0
      || scan.journals.size !== 1
      || !scan.journals.has(transaction.value.operationId)
      || [...scan.claims.keys()].some((operationId) => operationId !== transaction.value.operationId)
      || (!allowStages && scan.stages.length > 0)
    ) return false;
    const currentClaims = scan.claims.get(transaction.value.operationId) ?? [];
    if (
      currentClaims.length !== expectedClaims.length
      || currentClaims.some((claim, index) => (
        claim.generation !== expectedClaims[index].generation
        || claim.ref !== expectedClaims[index].ref
        || !samePrivateFileSource(claim.source, expectedClaims[index].source)
      ))
    ) return false;
    if (!allowStages) return true;
    return scan.stages.length === stages.length
      && scan.stages.every((stage, index) => (
        stage.operationId === stages[index].operationId
        && stage.generation === stages[index].generation
        && stage.ref === stages[index].ref
        && samePrivateFileSource(stage.source, stages[index].source)
      ));
  };
  let currentScan = scanTransactions(paths);
  const currentTransaction = currentScan.journals.get(transaction.value.operationId) ?? null;
  if (
    !samePrivateFileSource(currentTransaction, transaction)
    || !inventoryIsExact(currentScan, { allowStages: true })
  ) return false;
  for (const stage of currentScan.stages) {
    unlinkExactFile(resolvePortable(paths, stage.ref), stage.source, {
      paths,
      label: `abandoned pre-successor checkpoint stage generation ${stage.generation}`,
    });
  }
  currentScan = scanTransactions(paths);
  if (
    !inventoryIsExact(currentScan, { allowStages: false })
    || !samePrivateFileSource(
      currentScan.journals.get(transaction.value.operationId) ?? null,
      currentTransaction,
    )
  ) {
    fail(
      "wakeflow-mutation-recovery-race",
      "pre-successor settlement evidence changed after checkpoint-stage cleanup",
    );
  }
  assertArtifactStill(
    paths,
    currentLockArtifact,
    "pre-successor settlement workspace gate",
  );
  const transactionState = {
    value: currentTransaction.value,
    bytes: currentTransaction.bytes,
    source: currentTransaction,
    ref: currentTransaction.ref,
    affectedOrdinal: null,
    affectedBoundary: null,
  };
  checkpointTransaction(paths, transactionState, settledValue);
  assertArtifactStill(
    paths,
    fileArtifact(paths, claimReference.ref, newClaim),
    "settled takeover recovery claim",
  );
  assertArtifactStill(
    paths,
    currentLockArtifact,
    "settled takeover workspace gate",
  );
  return true;
}

function settleActiveIncompleteOwnerAfterGateFailure(paths, transactionState) {
  if (!transactionState || transactionState.value.phase !== "incomplete") return false;
  const runtimePublishers = scanRuntimePublisherStages(paths);
  if (
    runtimePublishers.publisherStages.length > 0
    || runtimePublishers.publisherUnknown.length > 0
  ) return false;
  const currentLock = readLock(paths, { allowMissing: true });
  if (
    currentLock !== null
    && (
      currentLock.value.operationId === transactionState.value.operationId
      || currentLock.value.recoveryGeneration !== 0
      || currentLock.value.recoveryClaim !== null
    )
  ) return false;
  const currentLockArtifact = artifactForSource(paths, LOCK_REF, currentLock);
  const currentTransaction = readTransaction(paths, transactionState.value.operationId);
  if (!samePrivateFileSource(currentTransaction, transactionState.source)) return false;
  assertArtifactStill(
    paths,
    currentLockArtifact,
    "active incomplete settlement workspace gate",
  );
  relinquishIncompleteTransaction(paths, transactionState);
  assertArtifactStill(
    paths,
    currentLockArtifact,
    "relinquished takeover workspace gate",
  );
  return true;
}

function cleanupRecoveryClaims(paths, claims) {
  for (const claim of claims.sort((left, right) => left.generation - right.generation)) {
    unlinkExactFile(resolvePortable(paths, claim.ref), claim.source, {
      paths,
      label: `recovery claim generation ${claim.generation}`,
    });
  }
}

function markLockOnlyCleanupReady(paths, transactionState) {
  if (transactionState.value.purpose !== "lock-only-recovery") {
    fail("wakeflow-mutation-invalid-artifact", "only a lock-only journal can enter lock-only cleanup");
  }
  if (transactionState.value.ownerDisposition === "relinquished") return;
  checkpointTransaction(paths, transactionState, cloneFrozen({
    ...transactionState.value,
    ownerDisposition: "relinquished",
  }));
}

function orphanLockOnlyTransaction({ action, lock, plan, planDigest, nextOwner, claimReference }) {
  assertTransactionPersistenceBudget(plan, { purpose: "lock-only-recovery", action });
  const value = deepFreeze({
    schemaVersion: 1,
    artifactKind: "wakeflow-maintenance-transaction",
    operationId: lock.value.operationId,
    purpose: "lock-only-recovery",
    action,
    operationKind: lock.value.operationKind,
    domainOwner: lock.value.domainOwner,
    ownerToken: nextOwner.ownerToken,
    recoveryGeneration: nextOwner.recoveryGeneration,
    processIdentity: nextOwner.processIdentity,
    ownerDisposition: "active",
    recoveryClaim: claimReference,
    phase: "incomplete",
    plan,
    planDigest,
    checkpoint: 0,
    steps: [],
    terminalClosure: null,
  });
  validateTransactionRecord(value);
  return value;
}

async function recoverOrphanWorkspaceLock({
  action,
  input,
  paths,
  confirmedPlan,
  planDigest,
  processIdentity,
  scan,
  claims,
  oldLock,
}) {
  // orphan gate只能通过零step confirmed plan转成可审计的lock-only journal后清理。
  if (!oldLock || oldLock.value.operationId !== input.operationId) {
    fail("wakeflow-mutation-manual-recovery", "zero-journal recovery requires the exact requested orphan lock");
  }
  if (scan.stages.length > 0) {
    fail("wakeflow-mutation-manual-recovery", "zero-journal recovery cannot interpret a checkpoint stage");
  }
  if (confirmedPlan.payload.steps.length !== 0 || Reflect.ownKeys(input.stepHandlers).length !== 0) {
    fail("wakeflow-mutation-invalid-plan", "orphan-lock recovery requires an explicit zero-step plan and empty handlers");
  }
  validateMaintenancePlanSteps(confirmedPlan, input.stepHandlers, {
    action,
    requireTerminalClosure: false,
    deriveTerminalClosure: input.deriveTerminalClosure,
  });
  assertTransactionPersistenceBudget(confirmedPlan, {
    purpose: "lock-only-recovery",
    action,
  });
  const latestClaim = validateExistingRecoveryChain(paths, {
    operationId: input.operationId,
    planDigest,
    transaction: null,
    claims,
    lock: oldLock,
  });
  if (latestClaim && oldLock.value.recoveryGeneration < latestClaim.generation) {
    const claimantProbe = probeProcessIdentity(latestClaim.source.value.nextOwner.processIdentity);
    if (claimantProbe === "same-live") {
      fail("wakeflow-mutation-recovery-busy", "an orphan-lock recovery claimant is still live");
    }
    if (claimantProbe === "unverifiable") {
      fail("wakeflow-mutation-manual-recovery", "orphan-lock recovery claimant cannot be verified");
    }
  }
  assertPreviousOwnerRecoverable(ownerFromLock(oldLock), { lockPresent: true });
  await deriveRecoveryPlan({
    deriveCurrentPlan: input.deriveCurrentPlan,
    validatePlan: input.validatePlan,
    context: null,
    confirmedPlan,
    planDigest,
    phase: "before orphan-lock claim",
  });

  const stableOldLock = fileArtifact(paths, LOCK_REF, oldLock);
  assertArtifactStill(paths, stableOldLock, "orphan workspace gate");
  completeBootstrapInsideGate(paths, []);
  assertArtifactStill(paths, stableOldLock, "orphan workspace gate");
  const refreshed = scanTransactions(paths);
  const refreshedRuntimePublishers = scanRuntimePublisherStages(paths);
  if (
    refreshed.unknown.length > 0
    || refreshed.publisherStages.length > 0
    || refreshed.publisherUnknown.length > 0
    || refreshedRuntimePublishers.publisherStages.length > 0
    || refreshedRuntimePublishers.publisherUnknown.length > 0
    || refreshed.stages.length > 0
    || refreshed.journals.size > 0
    || [...refreshed.claims.keys()].some((operationId) => operationId !== input.operationId)
  ) {
    fail("wakeflow-mutation-recovery-race", "orphan recovery protocol residue changed before its claim");
  }
  const refreshedClaims = refreshed.claims.get(input.operationId) ?? [];
  if (
    refreshedClaims.length !== claims.length
    || refreshedClaims.some((claim, index) => (
      claim.generation !== claims[index].generation
      || claim.ref !== claims[index].ref
      || !samePrivateFileSource(claim.source, claims[index].source)
    ))
  ) {
    fail("wakeflow-mutation-recovery-race", "orphan recovery claim inventory changed before takeover");
  }
  claims = refreshedClaims;

  const maxGeneration = Math.max(
    oldLock.value.recoveryGeneration,
    latestClaim?.generation ?? 0,
  );
  const generation = nextProtocolInteger(maxGeneration, "workspace recovery generation");
  const nextToken = newOwnerToken();
  const acquiredAt = nowTimestamp();
  const previousJournalRef = journalRef(input.operationId);
  const previousJournal = absentArtifact(previousJournalRef);
  const previousLock = fileArtifact(paths, LOCK_REF, oldLock);
  const previousClaim = latestClaim
    ? fileArtifact(paths, latestClaim.ref, latestClaim.source)
    : absentArtifact(claimRef(input.operationId, maxGeneration));
  const nextOwner = deepFreeze({
    mode: "recovery-cleanup",
    operationKind: oldLock.value.operationKind,
    domainOwner: oldLock.value.domainOwner,
    ownerToken: nextToken,
    recoveryGeneration: generation,
    processIdentity,
    acquiredAt,
  });
  const claimValue = recoveryClaimRecord({
    operationId: input.operationId,
    generation,
    planDigest,
    previousOwner: currentRecoveryOwner({ lock: oldLock, latestClaim }),
    nextOwner,
    previousJournal,
    previousLock,
    previousClaim,
    createdAt: acquiredAt,
  });
  const newClaimRef = claimRef(input.operationId, generation);
  let newClaim;
  try {
    newClaim = createCanonicalFile(resolvePortable(paths, newClaimRef), claimValue, {
      paths,
      label: `orphan-lock recovery claim generation ${generation}`,
    });
  } catch (error) {
    if (error?.code === "wakeflow-mutation-exclusive-conflict") {
      fail("wakeflow-mutation-recovery-claim-busy", "another orphan-lock recovery contender won the claim");
    }
    throw error;
  }
  const claimReference = deepFreeze({
    ref: newClaimRef,
    generation,
    digest: canonicalJsonDigest(claimValue),
  });
  let transactionState = null;
  let gate;
  try {
    assertArtifactStill(paths, previousJournal, "absent orphan maintenance journal");
    assertArtifactStill(paths, previousLock, "orphan workspace gate");
    assertArtifactStill(paths, previousClaim, "orphan predecessor claim");
    transactionState = createTransaction(paths, orphanLockOnlyTransaction({
      action,
      lock: oldLock,
      plan: confirmedPlan,
      planDigest,
      nextOwner,
      claimReference,
    }));
    assertArtifactStill(paths, previousLock, "orphan workspace gate");
    assertArtifactStill(paths, previousClaim, "orphan predecessor claim");
    unlinkExactFile(paths.lock, oldLock, {
      paths,
      label: "orphan workspace mutation lock",
    });
    gate = await acquireGate(paths, {
      mode: "recovery-cleanup",
      operationKind: oldLock.value.operationKind,
      domainOwner: oldLock.value.domainOwner,
      operationId: input.operationId,
      ownerToken: nextToken,
      recoveryGeneration: generation,
      processIdentity,
      recoveryClaim: claimReference,
      acquiredAt,
      acquireTimeoutMs: 0,
    });
  } catch (error) {
    let settled = false;
    try {
      settled = settleActiveIncompleteOwnerAfterGateFailure(paths, transactionState);
    } catch (settlementError) {
      throw wrapFailure(
        "wakeflow-mutation-recovery-required",
        "orphan takeover could not be durably relinquished",
        error,
        { settlementError, operationId: input.operationId, recoveryGeneration: generation },
      );
    }
    if (settled) {
      throw wrapFailure(
        "wakeflow-mutation-recovery-required",
        "orphan takeover was durably relinquished",
        error,
        { operationId: input.operationId, recoveryGeneration: generation },
      );
    }
    throw error;
  }
  const context = makeMutationContext(paths, gate);
  try {
    await mutationStorage.run(context, () => deriveRecoveryPlan({
      deriveCurrentPlan: input.deriveCurrentPlan,
      validatePlan: input.validatePlan,
      context,
      confirmedPlan,
      planDigest,
      phase: "after orphan successor gate",
    }));
    markLockOnlyCleanupReady(paths, transactionState);
    cleanupRecoveryClaims(paths, [
      ...claims,
      { generation, ref: newClaimRef, source: newClaim },
    ]);
    deleteTransaction(paths, transactionState);
    releaseGate(paths, gate);
    return deepFreeze({
      operationId: input.operationId,
      status: "orphan-lock-recovered",
      recoveryGeneration: generation,
      planDigest,
    });
  } catch (error) {
    throw wrapFailure(
      "wakeflow-mutation-manual-recovery",
      "orphan workspace lock recovery stopped with evidence retained",
      error,
      { operationId: input.operationId, recoveryGeneration: generation },
    );
  } finally {
    expireMutationContext(context);
  }
}

function transactionInventoryArtifacts(paths, scan) {
  const artifacts = [];
  for (const [operationId, source] of scan.journals) {
    artifacts.push(fileArtifact(paths, journalRef(operationId), source));
  }
  for (const claims of scan.claims.values()) {
    for (const claim of claims) artifacts.push(fileArtifact(paths, claim.ref, claim.source));
  }
  for (const stage of scan.stages) {
    artifacts.push(fileArtifact(paths, stage.ref, stage.source));
  }
  return artifacts;
}

function assertTransactionInventoryStill(paths, names, artifacts, label) {
  if (!sameValue(existingEntryNames(paths.transactions), names)) {
    fail("wakeflow-mutation-recovery-race", `${label} transaction inventory changed`);
  }
  for (const [index, artifact] of artifacts.entries()) {
    assertArtifactStill(paths, artifact, `${label} transaction artifact ${index}`);
  }
}

async function recoverUnlinkedLockPublisherLoser({
  paths,
  input,
  confirmedPlan,
  planDigest,
  action,
  scan,
  runtimePublishers,
}) {
  if (
    runtimePublishers.publisherStages.length !== 1
    || scan.publisherStages.length !== 0
    || runtimePublishers.publisherUnknown.length !== 0
    || scan.publisherUnknown.length !== 0
    || scan.unknown.length !== 0
  ) return null;
  const [publisher] = runtimePublishers.publisherStages;
  if (
    publisher.operationId !== input.operationId
    || publisher.kind !== "lock"
    || publisher.stat.nlink !== 1
    || scan.journals.has(input.operationId)
    || scan.claims.has(input.operationId)
    || scan.stages.some((stage) => stage.operationId === input.operationId)
  ) return null;

  const foreignLock = readLock(paths, { allowMissing: true });
  if (foreignLock === null || foreignLock.value.operationId === input.operationId) return null;
  const transactionOperations = new Set([
    ...scan.journals.keys(),
    ...scan.claims.keys(),
    ...scan.stages.map((stage) => stage.operationId),
  ]);
  if (
    transactionOperations.size > 1
    || [...transactionOperations].some((operationId) => operationId !== foreignLock.value.operationId)
    || classifyTransactionResidue(scan).disposition === "manual"
  ) {
    fail("wakeflow-mutation-manual-recovery", "publisher loser coexists with invalid foreign authority");
  }
  if (transactionOperations.size === 1) {
    const foreignOperationId = foreignLock.value.operationId;
    const transaction = scan.journals.get(foreignOperationId) ?? null;
    const claims = scan.claims.get(foreignOperationId) ?? [];
    const latestClaim = validateExistingRecoveryChain(paths, {
      operationId: foreignOperationId,
      planDigest: transaction?.value.planDigest ?? claims[0]?.source.value.planDigest,
      transaction,
      claims,
      lock: foreignLock,
    });
    for (const stage of scan.stages) {
      if (stage.operationId !== foreignOperationId || !transaction
        || !checkpointStageIsExactSuccessor(transaction, stage, latestClaim)) {
        fail("wakeflow-mutation-manual-recovery", "publisher loser foreign checkpoint is not exact");
      }
    }
  }

  const transactionNames = existingEntryNames(paths.transactions);
  const artifacts = transactionInventoryArtifacts(paths, scan);
  const foreignLockArtifact = fileArtifact(paths, LOCK_REF, foreignLock);
  if (confirmedPlan.payload.steps.length !== 0 || Reflect.ownKeys(input.stepHandlers).length !== 0) {
    fail("wakeflow-mutation-invalid-plan", "publisher-loser cleanup requires a zero-step plan and empty handlers");
  }
  validateMaintenancePlanSteps(confirmedPlan, input.stepHandlers, {
    action,
    requireTerminalClosure: false,
    deriveTerminalClosure: input.deriveTerminalClosure,
  });
  await deriveRecoveryPlan({
    deriveCurrentPlan: input.deriveCurrentPlan,
    validatePlan: input.validatePlan,
    context: null,
    confirmedPlan,
    planDigest,
    phase: "before publisher-loser cleanup",
  });
  const actions = recoverPublisherStages(paths, [publisher], input.operationId);
  if (actions.length !== 1 || actions[0].linkCount !== 1) {
    fail("wakeflow-mutation-recovery-race", "publisher loser cleanup changed classification");
  }
  assertTransactionInventoryStill(paths, transactionNames, artifacts, "publisher loser cleanup");
  assertArtifactStill(paths, foreignLockArtifact, "publisher loser foreign gate");
  const refreshedPublishers = scanRuntimePublisherStages(paths);
  if (refreshedPublishers.publisherUnknown.length > 0 || refreshedPublishers.publisherStages.length > 0) {
    fail("wakeflow-mutation-recovery-race", "publisher loser residue changed during cleanup");
  }
  await deriveRecoveryPlan({
    deriveCurrentPlan: input.deriveCurrentPlan,
    validatePlan: input.validatePlan,
    context: null,
    confirmedPlan,
    planDigest,
    phase: "after publisher-loser cleanup",
  });
  return deepFreeze({
    operationId: input.operationId,
    status: "publisher-stage-recovered",
    recoveryGeneration: 0,
    planDigest,
  });
}

async function preflightJournalRecovery({
  protocol,
  scan,
  input,
  confirmedPlan,
  planDigest,
}) {
  // 在创建successor claim之前，先把用户确认计划与durable journal重新绑定。
  if (scan.journals.size === 0) return null;
  const transaction = scan.journals.get(input.operationId);
  if (!transaction) {
    fail("wakeflow-mutation-manual-recovery", "maintenance journal belongs to another operation");
  }
  if (protocol.localMode !== DIRECTORY_MODE && transaction.value.action !== "explicit-migration") {
    fail("wakeflow-mutation-manual-recovery", "only explicit migration may recover under a safe legacy local mode");
  }
  if (
    transaction.value.purpose === "lock-only-recovery"
    && transaction.value.action === "explicit-migration"
    && protocol.localMode === DIRECTORY_MODE
  ) {
    fail("wakeflow-mutation-manual-recovery", "explicit-migration lock-only recovery requires a safe legacy local mode");
  }
  const journalPlan = await codecPlan(transaction.value.plan, input.validatePlan, "journal recovery plan");
  if (transaction.value.planDigest !== planDigest || !sameValue(journalPlan, confirmedPlan)) {
    fail("wakeflow-mutation-manual-recovery", "confirmed recovery plan differs from the journal");
  }
  assertTransactionPersistenceBudget(confirmedPlan, {
    purpose: transaction.value.purpose,
    action: transaction.value.action,
  });
  for (const stage of scan.stages) {
    if (
      stage.operationId !== input.operationId
      || stage.source.value.planDigest !== planDigest
      || !sameValue(stage.source.value.plan, confirmedPlan)
    ) {
      fail("wakeflow-mutation-manual-recovery", "checkpoint stage is not an abandoned candidate for this operation");
    }
  }
  validateMaintenancePlanSteps(confirmedPlan, input.stepHandlers, {
    action: transaction.value.action,
    requireTerminalClosure: transaction.value.purpose === "maintenance-apply",
    deriveTerminalClosure: input.deriveTerminalClosure,
  });
  return transaction;
}

async function cleanupForeignLockPublisherForRecovery({
  paths,
  input,
  confirmedPlan,
  planDigest,
  scan,
  runtimePublishers,
}) {
  if (
    runtimePublishers.publisherStages.length !== 1
    || runtimePublishers.publisherUnknown.length !== 0
    || scan.publisherStages.length !== 0
    || scan.publisherUnknown.length !== 0
    || scan.unknown.length !== 0
  ) return null;
  const [publisher] = runtimePublishers.publisherStages;
  if (publisher.kind !== "lock" || publisher.operationId === input.operationId) return null;
  const transaction = scan.journals.get(input.operationId) ?? null;
  const claims = scan.claims.get(input.operationId) ?? [];
  if (
    transaction === null
    || scan.journals.size !== 1
    || [...scan.claims.keys()].some((operationId) => operationId !== input.operationId)
    || scan.stages.some((stage) => stage.operationId !== input.operationId)
    || classifyTransactionResidue(scan).disposition === "manual"
  ) {
    fail("wakeflow-mutation-manual-recovery", "foreign lock publisher coexists with invalid transaction authority");
  }

  const oldLock = publisher.stat.nlink === 2
    ? readLock(paths, { allowMissing: false, allowedLinkCounts: [2] })
    : readLock(paths, { allowMissing: true });
  if (
    oldLock !== null
    && oldLock.value.operationId !== input.operationId
    && oldLock.value.operationId !== publisher.operationId
  ) {
    fail("wakeflow-mutation-manual-recovery", "foreign lock publisher target belongs to a third operation");
  }
  const chainLock = oldLock?.value.operationId === input.operationId ? oldLock : null;
  const latestClaim = validateExistingRecoveryChain(paths, {
    operationId: input.operationId,
    planDigest,
    transaction,
    claims,
    lock: chainLock,
  });
  for (const stage of scan.stages) {
    if (!checkpointStageIsExactSuccessor(transaction, stage, latestClaim)) {
      fail("wakeflow-mutation-manual-recovery", "foreign publisher recovery checkpoint is not exact");
    }
  }
  assertPreviousOwnerRecoverable(currentRecoveryOwner({
    transaction,
    lock: chainLock,
    latestClaim,
  }), { lockPresent: chainLock !== null });
  if (oldLock !== null && oldLock.value.operationId !== input.operationId) {
    const claimlessRelinquishedJournal = claims.length === 0
      && transaction.value.purpose === "maintenance-apply"
      && transaction.value.recoveryGeneration === 0
      && transaction.value.recoveryClaim === null
      && transaction.value.phase === "incomplete"
      && transaction.value.ownerDisposition === "relinquished"
      && transaction.value.checkpoint >= 1;
    if (
      (!claimlessRelinquishedJournal && claims.length === 0)
      || oldLock.value.recoveryGeneration !== 0
      || oldLock.value.recoveryClaim !== null
    ) {
      fail("wakeflow-mutation-manual-recovery", "foreign lock publisher target is not an unadmitted interloper");
    }
    const prospectiveForeignArtifact = {
      ...fileArtifact(paths, LOCK_REF, oldLock),
      linkCount: 1,
    };
    if (claims.some((claim) => sameValue(claim.source.value.previousLock, prospectiveForeignArtifact))) {
      fail("wakeflow-mutation-manual-recovery", "recovery claim binds the foreign publisher target");
    }
    const interloperProbe = probeProcessIdentity(oldLock.value.processIdentity);
    if (interloperProbe === "same-live") {
      fail("wakeflow-mutation-recovery-busy", "foreign lock publisher target is still live");
    }
    if (interloperProbe === "unverifiable") {
      fail("wakeflow-mutation-manual-recovery", "foreign lock publisher target cannot be verified");
    }
  }

  const transactionNames = existingEntryNames(paths.transactions);
  const artifacts = transactionInventoryArtifacts(paths, scan);
  const oldLockBytes = oldLock?.bytes ?? null;
  const oldLockDevice = oldLock ? String(oldLock.stat.dev) : null;
  const oldLockInode = oldLock ? String(oldLock.stat.ino) : null;
  await deriveRecoveryPlan({
    deriveCurrentPlan: input.deriveCurrentPlan,
    validatePlan: input.validatePlan,
    context: null,
    confirmedPlan,
    planDigest,
    phase: "before foreign lock publisher cleanup",
  });
  const actions = recoverPublisherStages(paths, [publisher], publisher.operationId);
  if (actions.length !== 1) {
    fail("wakeflow-mutation-recovery-race", "foreign lock publisher cleanup changed classification");
  }
  assertTransactionInventoryStill(paths, transactionNames, artifacts, "foreign lock publisher cleanup");
  const refreshedLock = readLock(paths, { allowMissing: true });
  if (
    (oldLock === null && refreshedLock !== null)
    || (oldLock !== null && (
      refreshedLock === null
      || !bytesEqual(refreshedLock.bytes, oldLockBytes)
      || String(refreshedLock.stat.dev) !== oldLockDevice
      || String(refreshedLock.stat.ino) !== oldLockInode
      || refreshedLock.stat.nlink !== 1
    ))
  ) {
    fail("wakeflow-mutation-recovery-race", "foreign lock publisher target changed during cleanup");
  }
  const refreshedPublishers = scanRuntimePublisherStages(paths);
  if (refreshedPublishers.publisherStages.length > 0 || refreshedPublishers.publisherUnknown.length > 0) {
    fail("wakeflow-mutation-recovery-race", "foreign lock publisher residue changed during cleanup");
  }
  return {
    scan: scanTransactions(paths),
    runtimePublishers: refreshedPublishers,
  };
}

/**
 * 沿指定operationId的持久证据向前恢复workspace mutation。
 *
 * 输入计划必须与journal完全相同；恢复依次闭合publisher、claim、successor gate、checkpoint和terminal cleanup。
 * 未知residue、多operation、活跃或不可验证owner都会停止，方法不会扫描并猜选“最可能”的事务。
 */
export async function recoverWakeflowWorkspaceMutation(options) {
  assertNoReentrantMutation();
  const input = validateRecoveryInputs(options);
  const confirmedPlan = await codecPlan(input.confirmedPlan, input.validatePlan, "confirmed recovery plan");
  const expectedPlanDigest = canonicalJsonDigest(confirmedPlan);
  if (input.planDigest !== expectedPlanDigest) {
    fail("wakeflow-mutation-invalid-plan", "confirmed recovery plan digest differs from its payload");
  }
  const paths = workspacePaths(input.workspaceRoot);
  const protocol = validateRecoveryProtocol(paths);
  const processIdentity = captureSelfProcessIdentity();
  let scan = protocol.transactionsPresent
    ? scanTransactions(paths)
    : emptyTransactionScan();
  let runtimePublishers = scanRuntimePublisherStages(paths);
  const publisherLoserResult = await recoverUnlinkedLockPublisherLoser({
    paths,
    input,
    confirmedPlan,
    planDigest: expectedPlanDigest,
    action: protocol.localMode === DIRECTORY_MODE
      ? "runtime-mutation-recovery"
      : "explicit-migration",
    scan,
    runtimePublishers,
  });
  if (publisherLoserResult !== null) return publisherLoserResult;
  let preflightTransaction = scan.journals.size === 1 && scan.journals.has(input.operationId)
    ? await preflightJournalRecovery({
      protocol,
      scan,
      input,
      confirmedPlan,
      planDigest: expectedPlanDigest,
    })
    : null;
  const foreignPublisherCleanup = await cleanupForeignLockPublisherForRecovery({
    paths,
    input,
    confirmedPlan,
    planDigest: expectedPlanDigest,
    scan,
    runtimePublishers,
  });
  if (foreignPublisherCleanup !== null) {
    scan = foreignPublisherCleanup.scan;
    runtimePublishers = foreignPublisherCleanup.runtimePublishers;
  }
  const initialClassification = classifyTransactionResidue(scan, runtimePublishers);
  if (initialClassification.disposition === "manual") {
    fail("wakeflow-mutation-manual-recovery", "maintenance residue is not one recoverable operation");
  }
  if (initialClassification.operations.some((operationId) => operationId !== input.operationId)) {
    fail("wakeflow-mutation-manual-recovery", "maintenance residue belongs to another operation");
  }
  if (
    scan.unknown.length > 0
    || scan.publisherUnknown.length > 0
    || runtimePublishers.publisherUnknown.length > 0
  ) {
    fail("wakeflow-mutation-manual-recovery", "unknown maintenance transaction residue requires manual recovery");
  }
  if (scan.journals.size > 1 || (scan.journals.size === 1 && !scan.journals.has(input.operationId))) {
    fail("wakeflow-mutation-manual-recovery", "another or multiple maintenance journals exist");
  }
  if ([...scan.claims.keys()].some((operationId) => operationId !== input.operationId)) {
    fail("wakeflow-mutation-manual-recovery", "another operation recovery claim exists");
  }
  preflightTransaction ??= await preflightJournalRecovery({
    protocol,
    scan,
    input,
    confirmedPlan,
    planDigest: expectedPlanDigest,
  });
  const publicationEntries = [
    ...runtimePublishers.publisherStages,
    ...scan.publisherStages,
  ];
  let publicationCleanup = [];
  if (publicationEntries.length > 0) {
    if (publicationEntries.some((entry) => entry.operationId !== input.operationId)) {
      fail("wakeflow-mutation-manual-recovery", "another operation publisher residue exists");
    }
    const publisherOnly = scan.journals.size === 0;
    if (publisherOnly) {
      if (confirmedPlan.payload.steps.length !== 0 || Reflect.ownKeys(input.stepHandlers).length !== 0) {
        fail("wakeflow-mutation-invalid-plan", "publisher-only recovery requires a zero-step plan and empty handlers");
      }
      validateMaintenancePlanSteps(confirmedPlan, input.stepHandlers, {
        action: protocol.localMode === DIRECTORY_MODE
          ? "runtime-mutation-recovery"
          : "explicit-migration",
        requireTerminalClosure: false,
        deriveTerminalClosure: input.deriveTerminalClosure,
      });
    }
    await deriveRecoveryPlan({
      deriveCurrentPlan: input.deriveCurrentPlan,
      validatePlan: input.validatePlan,
      context: null,
      confirmedPlan,
      planDigest: expectedPlanDigest,
      phase: "before publisher-stage cleanup",
    });
    publicationCleanup = recoverPublisherStages(paths, publicationEntries, input.operationId);
    scan = protocol.transactionsPresent
      ? scanTransactions(paths)
      : emptyTransactionScan();
    runtimePublishers = scanRuntimePublisherStages(paths);
    const refreshedClassification = classifyTransactionResidue(scan, runtimePublishers);
    if (refreshedClassification.disposition === "manual") {
      fail("wakeflow-mutation-recovery-race", "maintenance residue became non-recoverable during publisher cleanup");
    }
    if (refreshedClassification.operations.some((operationId) => operationId !== input.operationId)) {
      fail("wakeflow-mutation-recovery-race", "another operation appeared during publisher cleanup");
    }
    if (
      scan.publisherStages.length > 0
      || scan.publisherUnknown.length > 0
      || runtimePublishers.publisherStages.length > 0
      || runtimePublishers.publisherUnknown.length > 0
    ) {
      fail("wakeflow-mutation-recovery-race", "publisher residue changed during cleanup");
    }
    if (preflightTransaction !== null) {
      const refreshedTransaction = scan.journals.get(input.operationId) ?? null;
      if (
        refreshedTransaction === null
        || !bytesEqual(refreshedTransaction.bytes, preflightTransaction.bytes)
        || String(refreshedTransaction.stat.dev) !== String(preflightTransaction.stat.dev)
        || String(refreshedTransaction.stat.ino) !== String(preflightTransaction.stat.ino)
      ) {
        fail("wakeflow-mutation-recovery-race", "maintenance journal changed during publisher cleanup");
      }
    }
  }
  if (publicationCleanup.length > 0 && (
    scan.unknown.length > 0
    || scan.journals.size > 1
    || (scan.journals.size === 1 && !scan.journals.has(input.operationId))
    || [...scan.claims.keys()].some((operationId) => operationId !== input.operationId)
    || scan.stages.some((stage) => stage.operationId !== input.operationId)
  )) {
    fail("wakeflow-mutation-recovery-race", "maintenance residue changed during publisher cleanup");
  }
  let oldLock = readLock(paths, { allowMissing: true });
  if (
    publicationCleanup.length > 0
    && oldLock === null
    && scan.journals.size === 0
    && scan.claims.size === 0
    && scan.stages.length === 0
  ) {
    await deriveRecoveryPlan({
      deriveCurrentPlan: input.deriveCurrentPlan,
      validatePlan: input.validatePlan,
      context: null,
      confirmedPlan,
      planDigest: expectedPlanDigest,
      phase: "after publisher-stage cleanup",
    });
    return deepFreeze({
      operationId: input.operationId,
      status: "publisher-stage-recovered",
      recoveryGeneration: 0,
      planDigest: expectedPlanDigest,
    });
  }
  let claims = scan.claims.get(input.operationId) ?? [];
  if (scan.journals.size === 0) {
    return recoverOrphanWorkspaceLock({
      action: protocol.localMode === DIRECTORY_MODE
        ? "runtime-mutation-recovery"
        : "explicit-migration",
      input,
      paths,
      confirmedPlan,
      planDigest: expectedPlanDigest,
      processIdentity,
      scan,
      claims,
      oldLock,
    });
  }
  let transaction = scan.journals.get(input.operationId);
  if (oldLock && oldLock.value.operationId !== input.operationId) {
    const refreshed = removeDeadUnadmittedInterloperGate(paths, {
      operationId: input.operationId,
      planDigest: expectedPlanDigest,
      transaction,
      claims,
      stages: scan.stages,
      foreignLock: oldLock,
    });
    transaction = refreshed.transaction;
    claims = refreshed.claims;
    scan.stages = refreshed.stages;
    oldLock = refreshed.oldLock;
  }
  const latestClaim = validateExistingRecoveryChain(paths, {
    operationId: input.operationId,
    planDigest: expectedPlanDigest,
    transaction,
    claims,
    lock: oldLock,
  });
  for (const stage of scan.stages) {
    if (!checkpointStageIsExactSuccessor(transaction, stage, latestClaim)) {
      fail(
        "wakeflow-mutation-manual-recovery",
        "checkpoint stage is neither the current journal bytes nor one exact checkpoint successor",
      );
    }
  }

  const recoverabilityOwner = currentRecoveryOwner({
    transaction,
    lock: oldLock,
    latestClaim,
  });
  assertPreviousOwnerRecoverable(recoverabilityOwner, { lockPresent: oldLock !== null });

  await deriveRecoveryPlan({
    deriveCurrentPlan: input.deriveCurrentPlan,
    validatePlan: input.validatePlan,
    context: null,
    confirmedPlan,
    planDigest: expectedPlanDigest,
    phase: "before claim",
  });

  const maxGeneration = Math.max(
    transaction.value.recoveryGeneration,
    oldLock?.value.recoveryGeneration ?? 0,
    latestClaim?.generation ?? 0,
  );
  if (scan.stages.some((stage) => stage.generation > maxGeneration)) {
    fail("wakeflow-mutation-manual-recovery", "checkpoint stage generation is ahead of the recoverable owner chain");
  }
  const generation = nextProtocolInteger(maxGeneration, "workspace recovery generation");
  const nextToken = newOwnerToken();
  const acquiredAt = nowTimestamp();
  const previousJournalArtifact = fileArtifact(paths, transaction.ref, transaction);
  const previousLockArtifact = artifactForSource(paths, LOCK_REF, oldLock);
  const previousClaimRef = claimRef(input.operationId, generation - 1);
  const previousClaimArtifact = latestClaim
    ? fileArtifact(paths, latestClaim.ref, latestClaim.source)
    : absentArtifact(previousClaimRef);
  const nextOwner = deepFreeze({
    mode: "recovery-cleanup",
    operationKind: transaction.value.operationKind,
    domainOwner: transaction.value.domainOwner,
    ownerToken: nextToken,
    recoveryGeneration: generation,
    processIdentity,
    acquiredAt,
  });
  const claimValue = recoveryClaimRecord({
    operationId: input.operationId,
    generation,
    planDigest: expectedPlanDigest,
    previousOwner: recoverabilityOwner,
    nextOwner,
    previousJournal: previousJournalArtifact,
    previousLock: previousLockArtifact,
    previousClaim: previousClaimArtifact,
    createdAt: acquiredAt,
  });
  const newClaimRef = claimRef(input.operationId, generation);
  let newClaim;
  try {
    newClaim = createCanonicalFile(resolvePortable(paths, newClaimRef), claimValue, {
      paths,
      label: `recovery claim generation ${generation}`,
    });
  } catch (error) {
    if (error?.code === "wakeflow-mutation-exclusive-conflict") {
      fail("wakeflow-mutation-recovery-claim-busy", "another recovery contender won the generation claim");
    }
    throw error;
  }

  const claimReference = deepFreeze({
    ref: newClaimRef,
    generation,
    digest: canonicalJsonDigest(claimValue),
  });
  let gate;
  try {
    assertArtifactStill(paths, previousJournalArtifact, "previous maintenance journal");
    assertArtifactStill(paths, previousLockArtifact, "previous workspace gate");
    assertArtifactStill(paths, previousClaimArtifact, "previous recovery claim");
    if (oldLock) {
      unlinkExactFile(paths.lock, oldLock, {
        paths,
        label: "previous workspace mutation lock",
      });
    }
    gate = await acquireGate(paths, {
      mode: "recovery-cleanup",
      operationKind: transaction.value.operationKind,
      domainOwner: transaction.value.domainOwner,
      operationId: input.operationId,
      ownerToken: nextToken,
      recoveryGeneration: generation,
      processIdentity,
      recoveryClaim: claimReference,
      acquiredAt,
      acquireTimeoutMs: 0,
    });
  } catch (error) {
    let settled = false;
    try {
      settled = settleFailedPreSuccessorTakeover(paths, {
        transaction,
        claims,
        stages: scan.stages,
        nextOwner,
        claimReference,
        newClaim,
      });
    } catch (settlementError) {
      throw wrapFailure(
        "wakeflow-mutation-recovery-required",
        "failed recovery takeover could not be durably relinquished",
        error,
        { settlementError, operationId: input.operationId, recoveryGeneration: generation },
      );
    }
    if (settled) {
      throw wrapFailure(
        "wakeflow-mutation-recovery-required",
        "failed recovery takeover was durably relinquished",
        error,
        { operationId: input.operationId, recoveryGeneration: generation },
      );
    }
    throw error;
  }
  for (const stage of scan.stages.sort((left, right) => left.generation - right.generation)) {
    unlinkExactFile(resolvePortable(paths, stage.ref), stage.source, {
      paths,
      label: `abandoned checkpoint stage generation ${stage.generation}`,
    });
  }
  const transactionState = {
    value: transaction.value,
    bytes: transaction.bytes,
    source: transaction,
    ref: transaction.ref,
    affectedOrdinal: null,
    affectedBoundary: null,
  };
  checkpointTransaction(
    paths,
    transactionState,
    recoveryOwnedTransaction(transaction, gate, claimReference),
  );
  const context = makeMutationContext(paths, gate);
  let gateReleased = false;
  try {
    const currentPlan = await mutationStorage.run(context, () => deriveRecoveryPlan({
      deriveCurrentPlan: input.deriveCurrentPlan,
      validatePlan: input.validatePlan,
      context,
      confirmedPlan,
      planDigest: expectedPlanDigest,
      phase: "after successor gate",
    }));
    const allClaims = [
      ...claims,
      { generation, ref: newClaimRef, source: newClaim },
    ];
    if (transactionState.value.purpose === "lock-only-recovery") {
      markLockOnlyCleanupReady(paths, transactionState);
      cleanupRecoveryClaims(paths, allClaims);
      deleteTransaction(paths, transactionState);
      releaseGate(paths, gate);
      gateReleased = true;
      return deepFreeze({
        operationId: input.operationId,
        status: "lock-only-recovered",
        recoveryGeneration: generation,
        planDigest: expectedPlanDigest,
      });
    }

    if (transactionState.value.phase === "terminal") {
      await mutationStorage.run(context, () => verifyTerminalAndCleanup(
        transactionState,
        context,
        currentPlan,
        input.stepHandlers,
        input.deriveTerminalClosure,
      ));
      cleanupRecoveryClaims(paths, allClaims);
      deleteTransaction(paths, transactionState);
      releaseGate(paths, gate);
      gateReleased = true;
      return deepFreeze({
        operationId: input.operationId,
        status: "terminal-cleanup-recovered",
        recoveryGeneration: generation,
        planDigest: expectedPlanDigest,
      });
    }

    await mutationStorage.run(context, () => executeMaintenanceSteps(
      paths,
      transactionState,
      context,
      currentPlan,
      input.stepHandlers,
      { recovery: true },
    ));
    await mutationStorage.run(context, () => terminalizeAndCleanup(
      paths,
      transactionState,
      context,
      currentPlan,
      input.stepHandlers,
      input.deriveTerminalClosure,
    ));
    cleanupRecoveryClaims(paths, allClaims);
    deleteTransaction(paths, transactionState);
    releaseGate(paths, gate);
    gateReleased = true;
    return deepFreeze({
      operationId: input.operationId,
      status: "recovered",
      recoveryGeneration: generation,
      planDigest: expectedPlanDigest,
    });
  } catch (error) {
    if (!gateReleased && transactionState.value.phase === "incomplete") {
      try {
        await mutationStorage.run(context, () => reconcileAffectedIncompleteStep(
          paths,
          transactionState,
          context,
          confirmedPlan,
          input.stepHandlers,
        ));
        relinquishIncompleteTransaction(paths, transactionState);
        releaseGate(paths, gate);
        gateReleased = true;
        throw wrapFailure(
          "wakeflow-mutation-recovery-required",
          "explicit recovery failed after a stable incomplete checkpoint and relinquished its gate",
          error,
          { operationId: input.operationId, recoveryGeneration: generation },
        );
      } catch (relinquishError) {
        if (gateReleased) throw relinquishError;
        throw wrapFailure(
          "wakeflow-mutation-manual-recovery",
          "explicit recovery could not safely relinquish its incomplete owner",
          error,
          { relinquishError, operationId: input.operationId, recoveryGeneration: generation },
        );
      }
    }
    throw wrapFailure(
      error?.code === "wakeflow-mutation-recovery-busy"
        ? error.code
        : "wakeflow-mutation-manual-recovery",
      "explicit workspace mutation recovery stopped with evidence retained",
      error,
      { operationId: input.operationId, recoveryGeneration: generation },
    );
  } finally {
    expireMutationContext(context);
  }
}
