// 本模块拥有窗口binding的当前物理事实：严格读取、唯一性检查、create/replace/decommission与私有handle借用。
// config只授权稳定窗口，host profile只给出当前宿主的handle格式，window lease只阻止占用中的身份切换；
// 本模块不推导窗口职责、不判断宿主窗口是否存活，也不把opaque handle写入公开inventory或callback结果。
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { atomicWriteFile, sha256Bytes } from "./wakeflow-atomic-write.mjs";
import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import {
  normalizeWakeflowHostCapabilityProfile,
  WAKEFLOW_PROTOCOL_HOST_IDS,
} from "./wakeflow-host-capability.mjs";
import { hostProfile } from "./wakeflow-host-profile.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  assertWindowBindingId,
  createWindowBindingRecord,
  generateWindowBindingId,
  validateWindowBindingRecord,
  windowBindingCanonicalBytes,
  windowBindingDigest,
  windowBindingRef,
} from "./wakeflow-window-binding-records.mjs";
import {
  assertWakeflowMutationContext,
  withWakeflowRuntimeMutation,
} from "./wakeflow-workspace-mutation.mjs";

const INVENTORY_KIND = "WakeflowWindowBindingInventory";
const INVENTORY_SCHEMA_VERSION = 1;
const MAX_BINDING_BYTES = 64 * 1024;
const MAX_BINDINGS = 10_000;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const HANDLE_KIND_RE = /^[a-z][a-z0-9-]{0,63}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const PROTOCOL_HOST_IDS = new Set(WAKEFLOW_PROTOCOL_HOST_IDS);
const WINDOW_COORDINATION_LEASE_ROOT_REF = ".wakeflow-local/runtime/shared/coordination/window-leases";
const LEGACY_IDENTITY_REFS = Object.freeze([
  ".wakeflow-local/wakeflow-delivery",
  ".wakeflow-local/thread-registry",
]);

// 公开错误不携带原始handle；文件路径只在内部effect中使用，不进入普通成功投影。
export class WakeflowWindowBindingError extends Error {
  constructor(code, message, { details = {} } = {}) {
    super(message);
    this.name = "WakeflowWindowBindingError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, details = {}) {
  throw new WakeflowWindowBindingError(code, message, { details });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || Buffer.isBuffer(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 公开/组合入口一律先复制自有data字段，拒绝getter、hidden、Symbol及未知authority。
function exactDataObject(value, required, optional, label) {
  if (!plainObject(value)) fail("wakeflow-window-binding-input", `${label} must be one plain data object`);
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("wakeflow-window-binding-input", `${label} has the wrong field set`);
  }
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-window-binding-input", `${label} fields must be enumerable data properties`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function normalizeWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || CONTROL_RE.test(value)
  ) {
    fail("wakeflow-window-binding-input", "workspaceRoot must be one trimmed control-free path");
  }
  return path.resolve(value);
}

function normalizeAcquireTimeout(value) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 300_000) {
    fail(
      "wakeflow-window-binding-input",
      "acquireTimeoutMs must be an integer from 0 through 300000",
    );
  }
  return value;
}

function normalizeWindowId(value) {
  try {
    return assertWakeflowId(value, "window", "$/windowId");
  } catch {
    fail("wakeflow-window-binding-input", "windowId must be one typed Wakeflow window ID");
  }
}

function normalizeExpectedBindingId(value) {
  try {
    return assertWindowBindingId(value, "$/expectedBindingId");
  } catch {
    fail("wakeflow-window-binding-input", "expectedBindingId must be one typed window binding ID");
  }
}

function normalizeExpectedDigest(value) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-window-binding-input", "expectedBindingDigest must be one sha256 digest");
  }
  return value;
}

// 完整host profile是宿主扩展面；这里只无行为投影identity owner真正消费的handle三字段。
function normalizeHandleContractProfile(value) {
  const descriptor = plainObject(value)
    ? Object.getOwnPropertyDescriptor(value, "handleId")
    : null;
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail(
      "wakeflow-window-binding-profile",
      "host identity handle contract must be one enumerable data property",
    );
  }
  let handleId;
  try {
    handleId = exactDataObject(
      descriptor.value,
      ["kind", "placeholders", "idShape"],
      [],
      "host identity handle contract",
    );
  } catch {
    fail("wakeflow-window-binding-profile", "host identity handle contract is invalid");
  }
  if (!Array.isArray(handleId.placeholders) || handleId.placeholders.length > 1_000) {
    fail("wakeflow-window-binding-profile", "host identity handle placeholders are invalid");
  }
  const placeholders = [];
  for (let index = 0; index < handleId.placeholders.length; index += 1) {
    const entry = Object.getOwnPropertyDescriptor(handleId.placeholders, String(index));
    if (!entry?.enumerable || !Object.hasOwn(entry, "value") || typeof entry.value !== "string") {
      fail("wakeflow-window-binding-profile", "host identity handle placeholders must be dense data strings");
    }
    placeholders.push(entry.value);
  }
  const expectedKeys = new Set([
    "length",
    ...placeholders.map((ignored, index) => String(index)),
  ]);
  if (Reflect.ownKeys(handleId.placeholders).some((key) => !expectedKeys.has(key))) {
    fail("wakeflow-window-binding-profile", "host identity handle placeholders cannot contain extra fields");
  }
  return Object.freeze({
    kind: handleId.kind,
    idShape: handleId.idShape,
    placeholders: Object.freeze(placeholders),
  });
}

// capability投影负责hostId/目录/applicability，本函数再组合宿主自有的opaque handle合同。
function normalizeIdentityProfile(value = hostProfile) {
  let base;
  try {
    base = normalizeWakeflowHostCapabilityProfile(value);
  } catch {
    fail("wakeflow-window-binding-profile", "host identity profile is invalid");
  }
  if (!base.capabilities.identity.applicable) {
    fail("wakeflow-window-binding-profile", "host identity capability is not applicable");
  }
  const handleId = normalizeHandleContractProfile(value);
  if (
    typeof handleId.kind !== "string"
    || !HANDLE_KIND_RE.test(handleId.kind)
    || typeof handleId.idShape !== "string"
    || !handleId.idShape
  ) {
    fail("wakeflow-window-binding-profile", "host identity handle contract is invalid");
  }
  let valuePattern;
  try {
    valuePattern = new RegExp(`^(?:${handleId.idShape})$`, "u");
  } catch {
    fail("wakeflow-window-binding-profile", "host identity handle shape is invalid");
  }
  return deepFreeze({
    hostId: base.hostId,
    hostDirName: base.hostDirName,
    handleKind: handleId.kind,
    valuePattern,
    placeholders: new Set(handleId.placeholders.map((entry) => entry.toLowerCase())),
  });
}

// 真实handle值只在本进程内验证；placeholder或格式不符均不能成为binding authority。
function normalizeHandle(value, profile) {
  const handle = exactDataObject(value, ["kind", "value"], [], "handle");
  if (handle.kind !== profile.handleKind) {
    fail("wakeflow-window-binding-handle", "handle kind does not match the current host identity profile");
  }
  if (
    typeof handle.value !== "string"
    || !handle.value
    || handle.value !== handle.value.trim()
    || handle.value.length > 512
    || CONTROL_RE.test(handle.value)
    || profile.placeholders.has(handle.value.toLowerCase())
    || !profile.valuePattern.test(handle.value)
  ) {
    fail("wakeflow-window-binding-handle", "handle value is not a real current-host identity");
  }
  return Object.freeze({ kind: handle.kind, value: handle.value });
}

function normalizeInspectInput(input) {
  const values = exactDataObject(input, ["workspaceRoot"], [], "binding inspection input");
  return Object.freeze({ workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot) });
}

function normalizeRegisterInput(input, profile) {
  const values = exactDataObject(
    input,
    ["workspaceRoot", "windowId", "handle"],
    ["acquireTimeoutMs"],
    "binding registration input",
  );
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    windowId: normalizeWindowId(values.windowId),
    handle: normalizeHandle(values.handle, profile),
    acquireTimeoutMs: normalizeAcquireTimeout(values.acquireTimeoutMs),
  });
}

function normalizeReplaceInput(input, profile) {
  const values = exactDataObject(
    input,
    [
      "workspaceRoot",
      "windowId",
      "handle",
      "expectedBindingId",
      "expectedBindingDigest",
    ],
    ["acquireTimeoutMs"],
    "binding replacement input",
  );
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    windowId: normalizeWindowId(values.windowId),
    handle: normalizeHandle(values.handle, profile),
    expectedBindingId: normalizeExpectedBindingId(values.expectedBindingId),
    expectedBindingDigest: normalizeExpectedDigest(values.expectedBindingDigest),
    acquireTimeoutMs: normalizeAcquireTimeout(values.acquireTimeoutMs),
  });
}

function normalizeDecommissionInput(input) {
  const values = exactDataObject(
    input,
    ["workspaceRoot", "windowId", "expectedBindingId", "expectedBindingDigest"],
    ["acquireTimeoutMs"],
    "binding decommission input",
  );
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    windowId: normalizeWindowId(values.windowId),
    expectedBindingId: normalizeExpectedBindingId(values.expectedBindingId),
    expectedBindingDigest: normalizeExpectedDigest(values.expectedBindingDigest),
    acquireTimeoutMs: normalizeAcquireTimeout(values.acquireTimeoutMs),
  });
}

function normalizeHandleConsumerInput(input) {
  const values = exactDataObject(
    input,
    ["workspaceRoot", "windowId", "expectedBindingId", "expectedBindingDigest"],
    [],
    "binding handle consumer input",
  );
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    windowId: normalizeWindowId(values.windowId),
    expectedBindingId: normalizeExpectedBindingId(values.expectedBindingId),
    expectedBindingDigest: normalizeExpectedDigest(values.expectedBindingDigest),
  });
}

// preauthorized入口只表示调用者已经持有T02，不代表它可以省略program/config/binding CAS。
function normalizePreauthorizedRegisterInput(input, profile) {
  const values = exactDataObject(
    input,
    [
      "workspaceRoot",
      "expectedProgramId",
      "expectedConfigDigest",
      "windowId",
      "bindingId",
      "handle",
      "mutationContext",
    ],
    [],
    "preauthorized binding registration input",
  );
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    expectedProgramId: normalizeInventoryProgramId(values.expectedProgramId, "preauthorized registration"),
    expectedConfigDigest: normalizeInventoryDigest(values.expectedConfigDigest, "preauthorized registration"),
    windowId: normalizeWindowId(values.windowId),
    bindingId: normalizeExpectedBindingId(values.bindingId),
    handle: normalizeHandle(values.handle, profile),
    mutationContext: values.mutationContext,
  });
}

function normalizePreauthorizedDecommissionInput(input) {
  const values = exactDataObject(
    input,
    [
      "workspaceRoot",
      "expectedProgramId",
      "expectedConfigDigest",
      "windowId",
      "expectedBindingId",
      "expectedBindingDigest",
      "mutationContext",
    ],
    [],
    "preauthorized binding decommission input",
  );
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    expectedProgramId: normalizeInventoryProgramId(values.expectedProgramId, "preauthorized decommission"),
    expectedConfigDigest: normalizeInventoryDigest(values.expectedConfigDigest, "preauthorized decommission"),
    windowId: normalizeWindowId(values.windowId),
    expectedBindingId: normalizeExpectedBindingId(values.expectedBindingId),
    expectedBindingDigest: normalizeExpectedDigest(values.expectedBindingDigest),
    mutationContext: values.mutationContext,
  });
}

function normalizeInventoryProgramId(value, label) {
  let programId;
  try {
    programId = assertWakeflowId(value, "program", "$/programId");
  } catch {
    fail("wakeflow-window-binding-input", `${label} programId must be one typed Wakeflow program ID`);
  }
  return programId;
}

function normalizeInventoryDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-window-binding-input", `${label} configDigest must be one sha256 digest`);
  }
  return value;
}

function normalizeInventoryWindowIds(value, label) {
  if (!Array.isArray(value) || value.length > MAX_BINDINGS) {
    fail("wakeflow-window-binding-input", `${label} windowIds must be one bounded array`);
  }
  const windowIds = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-window-binding-input", `${label} windowIds must contain only dense data entries`);
    }
    let windowId;
    try {
      windowId = assertWakeflowId(descriptor.value, "window", `$/windowIds/${index}`);
    } catch {
      fail("wakeflow-window-binding-input", `${label} windowIds must contain typed Wakeflow window IDs`);
    }
    if (seen.has(windowId)) {
      fail("wakeflow-window-binding-input", `${label} windowIds cannot contain duplicates`);
    }
    seen.add(windowId);
    windowIds.push(windowId);
  }
  const expectedArrayKeys = new Set([
    "length",
    ...windowIds.map((ignored, index) => String(index)),
  ]);
  if (Reflect.ownKeys(value).some((key) => !expectedArrayKeys.has(key))) {
    fail("wakeflow-window-binding-input", `${label} windowIds cannot contain extra fields`);
  }
  return Object.freeze(windowIds);
}

// layout入口允许静态目录mode待修复；普通host inventory仍要求完整0700链。
function normalizeLayoutInventoryInput(input) {
  const values = exactDataObject(
    input,
    ["workspaceRoot", "programId", "hostId", "configDigest", "windowIds", "hostProfile"],
    [],
    "layout binding inventory input",
  );
  const profile = normalizeIdentityProfile(values.hostProfile);
  if (values.hostId !== profile.hostId) {
    fail("wakeflow-window-binding-profile", "layout host identity differs from its profile");
  }
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    programId: normalizeInventoryProgramId(values.programId, "layout"),
    configDigest: normalizeInventoryDigest(values.configDigest, "layout"),
    windowIds: normalizeInventoryWindowIds(values.windowIds, "layout"),
    profile,
  });
}

function normalizeHostInventoryInput(input) {
  const values = exactDataObject(
    input,
    ["workspaceRoot", "programId", "hostId", "configDigest", "windowIds"],
    [],
    "protocol-host binding inventory input",
  );
  if (typeof values.hostId !== "string" || !PROTOCOL_HOST_IDS.has(values.hostId)) {
    fail(
      "wakeflow-window-binding-profile",
      "protocol-host binding inventory requires one Wakeflow protocol hostId",
    );
  }
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    programId: normalizeInventoryProgramId(values.programId, "protocol-host"),
    configDigest: normalizeInventoryDigest(values.configDigest, "protocol-host"),
    windowIds: normalizeInventoryWindowIds(values.windowIds, "protocol-host"),
    profile: Object.freeze({
      hostId: values.hostId,
      hostDirName: values.hostId,
      handleKind: null,
    }),
  });
}

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail("wakeflow-window-binding-platform", "window identity files require POSIX ownership semantics");
  }
  return BigInt(process.geteuid());
}

function modeOf(stat) {
  return Number(stat.mode & 0o777n);
}

// stat闭包使用纳秒mtime/ctime与inode；跨rename比较允许ctime变化，但仍固定同一物理文件。
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

function sameMovedStat(left, right, { allowUnlinked = false } = {}) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && (allowUnlinked ? right.nlink === 0n : left.nlink === right.nlink)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs;
}

function sourceFingerprint(source) {
  return Object.freeze({
    dev: String(source.stat.dev),
    ino: String(source.stat.ino),
    mode: String(source.stat.mode),
    uid: String(source.stat.uid),
    gid: String(source.stat.gid),
    nlink: String(source.stat.nlink),
    size: String(source.stat.size),
    mtimeNs: String(source.stat.mtimeNs),
    ctimeNs: String(source.stat.ctimeNs),
    sha256: source.fileSha256,
  });
}

// callback返回值必须是被动plain-data树；任何function、accessor或外来prototype都可能成为handle泄露通道。
function valueContainsExactString(value, forbidden, seen = new Set()) {
  if (value === forbidden) return true;
  if (typeof value === "function") return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value)
    && prototype !== Object.prototype
    && prototype !== null
  ) {
    return true;
  }
  seen.add(value);
  return Reflect.ownKeys(value).some((key) => {
    if (Array.isArray(value) && key === "length") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return true;
    return valueContainsExactString(descriptor.value, forbidden, seen);
  });
}

function atomicSourceIdentity(source) {
  return Object.freeze({
    deviceId: String(source.stat.dev),
    inodeId: String(source.stat.ino),
    mode: String(source.stat.mode),
    uid: String(source.stat.uid),
    gid: String(source.stat.gid),
    linkCount: String(source.stat.nlink),
    size: String(source.stat.size),
    mtimeNs: String(source.stat.mtimeNs),
    ctimeNs: String(source.stat.ctimeNs),
  });
}

function statMatchesCommitIdentity(stat, identity) {
  return identity !== null
    && String(stat.dev) === identity.deviceId
    && String(stat.ino) === identity.inodeId
    && String(stat.mode) === identity.mode
    && String(stat.uid) === identity.uid
    && String(stat.gid) === identity.gid
    && String(stat.nlink) === identity.linkCount
    && String(stat.size) === identity.size;
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

// 从workspace root逐级no-follow核验current-euid目录；本函数只观察，不创建或修复布局。
function inspectPrivateDirectoryChain(workspaceRoot, relativeRef, modePolicy = "strict") {
  if (!new Set(["strict", "layout-repairable"]).has(modePolicy)) {
    fail("wakeflow-window-binding-layout", "identity directory mode policy is invalid");
  }
  const rootStat = fs.lstatSync(workspaceRoot, { bigint: true });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail("wakeflow-window-binding-layout", "workspace root must be one real directory");
  }
  const realRoot = fs.realpathSync(workspaceRoot);
  const euid = currentEuid();
  const components = relativeRef.split("/");
  let current = workspaceRoot;
  const snapshots = [];
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    let stat;
    try {
      stat = fs.lstatSync(current, { bigint: true });
    } catch (cause) {
      if (cause?.code === "ENOENT") {
        return Object.freeze({
          state: "missing",
          root: path.resolve(workspaceRoot, ...components),
          missingFrom: index,
          snapshots: Object.freeze(snapshots),
        });
      }
      fail("wakeflow-window-binding-layout", "identity directory chain cannot be inspected");
    }
    const directoryMode = modeOf(stat);
    const modeAccepted = modePolicy === "strict"
      ? directoryMode === 0o700
      : (directoryMode & 0o700) === 0o700 && (directoryMode & 0o022) === 0;
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || stat.uid !== euid
      || !modeAccepted
    ) {
      fail(
        "wakeflow-window-binding-layout",
        "identity directory chain must be current-euid real 0700 directories",
      );
    }
    let real;
    try {
      real = fs.realpathSync(current);
    } catch {
      fail("wakeflow-window-binding-layout", "identity directory chain cannot be resolved safely");
    }
    if (!pathInside(realRoot, real) || real === realRoot) {
      fail("wakeflow-window-binding-layout", "identity directory chain escaped the workspace");
    }
    snapshots.push(Object.freeze({ path: current, stat }));
  }
  return Object.freeze({
    state: "current",
    root: current,
    snapshots: Object.freeze(snapshots),
  });
}

function assertDirectoryChainStillCurrent(chain) {
  if (chain.state !== "current") return;
  for (const source of chain.snapshots) {
    let current;
    try {
      current = fs.lstatSync(source.path, { bigint: true });
    } catch {
      fail("wakeflow-window-binding-inventory", "identity directory chain changed during inspection");
    }
    if (!sameStat(source.stat, current)) {
      fail("wakeflow-window-binding-inventory", "identity directory chain changed during inspection");
    }
  }
}

function legacyIdentityPresent(workspaceRoot) {
  for (const ref of LEGACY_IDENTITY_REFS) {
    try {
      fs.lstatSync(path.resolve(workspaceRoot, ...ref.split("/")), { bigint: true });
      return true;
    } catch (cause) {
      if (cause?.code !== "ENOENT") {
        fail("wakeflow-window-binding-migration-required", "legacy identity authority cannot be inspected");
      }
    }
  }
  return false;
}

// 单个binding读取同时固定path/descriptor身份、0600/current-owner/single-link、容量与canonical bytes。
function readStableBindingFile(file, expected, profile) {
  const euid = currentEuid();
  let before;
  try {
    before = fs.lstatSync(file, { bigint: true });
  } catch {
    fail("wakeflow-window-binding-inventory", "binding file is unavailable");
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || before.uid !== euid
    || modeOf(before) !== 0o600
    || before.size <= 0n
    || before.size > BigInt(MAX_BINDING_BYTES)
  ) {
    fail(
      "wakeflow-window-binding-inventory",
      "binding source must be one current-euid single-link 0600 regular file",
    );
  }
  let descriptor = null;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameStat(before, opened)) {
      fail("wakeflow-window-binding-inventory", "binding source changed while being opened");
    }
    const bytes = fs.readFileSync(descriptor);
    const afterDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(file, { bigint: true });
    if (
      bytes.length !== Number(opened.size)
      || !sameStat(opened, afterDescriptor)
      || !sameStat(opened, afterPath)
    ) {
      fail("wakeflow-window-binding-inventory", "binding source changed while being read");
    }
    let text;
    let parsed;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      parsed = JSON.parse(text);
    } catch {
      fail("wakeflow-window-binding-inventory", "binding source is not strict UTF-8 JSON");
    }
    let record;
    try {
      record = validateWindowBindingRecord(parsed, {
        expectedProgramId: expected.programId,
        expectedHostId: expected.hostId,
        expectedWindowId: expected.windowId,
        ...(profile.handleKind === null
          ? {}
          : { expectedHandleKind: profile.handleKind }),
      });
    } catch {
      fail("wakeflow-window-binding-inventory", "binding record failed its owner codec");
    }
    let canonical;
    try {
      canonical = windowBindingCanonicalBytes(record);
    } catch {
      fail("wakeflow-window-binding-inventory", "binding record cannot be canonically encoded");
    }
    if (!bytes.equals(canonical)) {
      fail("wakeflow-window-binding-inventory", "binding file bytes are not canonical");
    }
    return Object.freeze({
      record,
      bytes,
      stat: opened,
      fileSha256: sha256Bytes(bytes),
      identityBindingDigest: windowBindingDigest(record),
    });
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // close失败不会改变已经完成的source分类，也不能把读取结果升级为写入授权。
      }
    }
  }
}

// 公开binding刻意删除raw handle，只保留可携带identity ref/digest与代际时间。
function publicBinding(source, profile) {
  const record = source.record;
  return deepFreeze({
    programId: record.programId,
    hostId: record.hostId,
    windowId: record.windowId,
    bindingId: record.bindingId,
    identityRef: windowBindingRef({ hostDirName: profile.hostDirName, windowId: record.windowId }),
    identityBindingDigest: source.identityBindingDigest,
    registeredAt: record.registeredAt,
    ...(record.hostVerifiedAt === undefined ? {} : { hostVerifiedAt: record.hostVerifiedAt }),
  });
}

function inventoryRootRef(profile) {
  return `.wakeflow-local/runtime/hosts/${profile.hostDirName}/identity/window-bindings`;
}

function buildPublicInventory(snapshot, profile, state, sources) {
  const bindings = sources.map((source) => publicBinding(source, profile));
  const unsigned = {
    kind: INVENTORY_KIND,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    programId: snapshot.model.program.programId,
    hostId: profile.hostId,
    identityRootRef: inventoryRootRef(profile),
    configDigest: snapshot.configDigest,
    status: state === "missing" ? "missing" : bindings.length === 0 ? "empty" : "current",
    bindings,
  };
  return deepFreeze({ ...unsigned, inventoryDigest: canonicalJsonDigest(unsigned) });
}

// 严格inventory同时验证全部文件、唯一bindingId/handle、前后目录快照与确定性windowId顺序。
function scanBindingInventoryInternal({
  workspaceRoot,
  snapshot,
  profile,
  directoryModePolicy = "strict",
}) {
  if (legacyIdentityPresent(workspaceRoot)) {
    fail(
      "wakeflow-window-binding-migration-required",
      "legacy and candidate identity authority cannot coexist",
    );
  }
  const chain = inspectPrivateDirectoryChain(
    workspaceRoot,
    inventoryRootRef(profile),
    directoryModePolicy,
  );
  if (chain.state === "missing") {
    return Object.freeze({
      state: "missing",
      chain,
      sources: Object.freeze([]),
      byWindowId: new Map(),
      public: buildPublicInventory(snapshot, profile, "missing", []),
    });
  }
  let beforeRoot;
  let names;
  try {
    beforeRoot = fs.lstatSync(chain.root, { bigint: true });
    names = fs.readdirSync(chain.root).sort();
  } catch {
    fail("wakeflow-window-binding-inventory", "binding inventory cannot be read safely");
  }
  if (names.length > MAX_BINDINGS) {
    fail("wakeflow-window-binding-inventory", "binding inventory exceeds its closed size limit");
  }
  const sources = [];
  const byWindowId = new Map();
  const bindingIds = new Set();
  const handles = new Set();
  for (const name of names) {
    if (!name.endsWith(".json")) {
      fail("wakeflow-window-binding-inventory", "binding inventory contains an unknown sibling");
    }
    const windowId = name.slice(0, -".json".length);
    try {
      assertWakeflowId(windowId, "window");
    } catch {
      fail("wakeflow-window-binding-inventory", "binding inventory contains an invalid filename");
    }
    const source = readStableBindingFile(path.join(chain.root, name), {
      programId: snapshot.model.program.programId,
      hostId: profile.hostId,
      windowId,
    }, profile);
    if (bindingIds.has(source.record.bindingId)) {
      fail("wakeflow-window-binding-duplicate", "one binding ID belongs to multiple active windows");
    }
    const handleKey = `${source.record.handle.kind}\u0000${source.record.handle.value}`;
    if (handles.has(handleKey)) {
      fail("wakeflow-window-binding-duplicate", "one host handle belongs to multiple active windows");
    }
    bindingIds.add(source.record.bindingId);
    handles.add(handleKey);
    sources.push(source);
    byWindowId.set(windowId, source);
  }
  let afterNames;
  let afterRoot;
  try {
    afterNames = fs.readdirSync(chain.root).sort();
    afterRoot = fs.lstatSync(chain.root, { bigint: true });
  } catch {
    fail("wakeflow-window-binding-inventory", "binding inventory changed while being read");
  }
  if (canonicalJson(afterNames) !== canonicalJson(names) || !sameStat(beforeRoot, afterRoot)) {
    fail("wakeflow-window-binding-inventory", "binding inventory changed while being read");
  }
  for (const source of sources) {
    const file = path.join(chain.root, `${source.record.windowId}.json`);
    let current;
    try {
      current = fs.lstatSync(file, { bigint: true });
    } catch {
      fail("wakeflow-window-binding-inventory", "binding inventory changed after validation");
    }
    if (!sameStat(source.stat, current)) {
      fail("wakeflow-window-binding-inventory", "binding inventory changed after validation");
    }
  }
  assertDirectoryChainStillCurrent(chain);
  const sortedSources = sources.sort((left, right) => (
    left.record.windowId < right.record.windowId ? -1 : left.record.windowId > right.record.windowId ? 1 : 0
  ));
  return Object.freeze({
    state: "current",
    chain,
    sources: Object.freeze(sortedSources),
    byWindowId,
    public: buildPublicInventory(snapshot, profile, "current", sortedSources),
  });
}

function assertBindingIdUnique(inventory, bindingId, excludedWindowId = null) {
  for (const source of inventory.sources) {
    if (source.record.windowId === excludedWindowId) continue;
    if (source.record.bindingId === bindingId) {
      fail("wakeflow-window-binding-duplicate", "one binding ID cannot bind multiple active windows");
    }
  }
}

function loadCandidateSnapshot(workspaceRoot, profile) {
  let snapshot;
  try {
    snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot });
  } catch {
    fail("wakeflow-window-binding-config", "strict v3 config authority is unavailable");
  }
  if (!profile.hostId || !snapshot.model.program.programId) {
    fail("wakeflow-window-binding-config", "identity authority cannot be derived from config and host profile");
  }
  return snapshot;
}

// 只有普通durable窗口注册才要求config window；Pod动态窗口通过专用preauthorized seam取得领域授权。
function assertConfiguredWindow(snapshot, windowId) {
  if (!Object.hasOwn(snapshot.indexes.windowById, windowId)) {
    fail("wakeflow-window-binding-window", "windowId is not authorized by current durable topology");
  }
}

function nextRegisteredAt(previous = null) {
  const now = Date.now();
  const previousMs = previous === null ? Number.NEGATIVE_INFINITY : Date.parse(previous);
  return new Date(Math.max(now, previousMs + 1)).toISOString();
}

function newUniqueBindingId(inventory) {
  const existing = new Set(inventory.sources.map((source) => source.record.bindingId));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = generateWindowBindingId();
    if (!existing.has(candidate)) return candidate;
  }
  fail("wakeflow-window-binding-id", "cannot allocate a unique window binding ID");
}

function assertHandleUnique(inventory, handle, excludedWindowId = null) {
  for (const source of inventory.sources) {
    if (source.record.windowId === excludedWindowId) continue;
    if (source.record.handle.kind === handle.kind && source.record.handle.value === handle.value) {
      fail("wakeflow-window-binding-duplicate", "one host handle cannot bind multiple active windows");
    }
  }
}

function assertExpectedCurrent(source, input) {
  if (
    source.record.bindingId !== input.expectedBindingId
    || source.identityBindingDigest !== input.expectedBindingDigest
  ) {
    fail("wakeflow-window-binding-cas-mismatch", "expected binding identity no longer matches current authority");
  }
}

// replacement/decommission在T02 gate内检查exact window lease；存在、不可读或竞态均fail closed。
function assertWindowCoordinationLeaseAbsent(workspaceRoot, windowId) {
  const chain = inspectPrivateDirectoryChain(
    workspaceRoot,
    WINDOW_COORDINATION_LEASE_ROOT_REF,
  );
  if (chain.state === "missing") return;
  const leaseRef = `${WINDOW_COORDINATION_LEASE_ROOT_REF}/${windowId}.json`;
  const target = path.resolve(workspaceRoot, ...leaseRef.split("/"));
  try {
    fs.lstatSync(target, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      assertDirectoryChainStillCurrent(chain);
      return;
    }
    fail(
      "wakeflow-window-binding-active-lease-guard",
      "window lease presence cannot be proven absent",
      { windowId, leaseRef },
    );
  }
  fail(
    "wakeflow-window-binding-active-lease",
    "an active window lease blocks identity replacement or decommission",
    { windowId, leaseRef },
  );
}

function syncDirectory(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (!stat.isDirectory()) fail("wakeflow-window-binding-durability", "binding parent is no longer a directory");
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function syncBindingTarget(file, expectedIdentity) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(descriptor, { bigint: true });
    const beforePath = fs.lstatSync(file, { bigint: true });
    if (
      !stat.isFile()
      || stat.nlink !== 1n
      || stat.uid !== currentEuid()
      || modeOf(stat) !== 0o600
      || !statMatchesCommitIdentity(stat, expectedIdentity)
      || !statMatchesCommitIdentity(beforePath, expectedIdentity)
    ) {
      fail("wakeflow-window-binding-durability", "committed binding target is not one private file");
    }
    fs.fsyncSync(descriptor);
    const afterDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(file, { bigint: true });
    if (
      !statMatchesCommitIdentity(afterDescriptor, expectedIdentity)
      || !statMatchesCommitIdentity(afterPath, expectedIdentity)
    ) {
      fail("wakeflow-window-binding-durability", "committed binding target changed during durability sync");
    }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
  syncDirectory(path.dirname(file));
}

function otherSourcesUnchanged(before, after, windowId) {
  const beforeOthers = before.sources.filter((source) => source.record.windowId !== windowId);
  const afterByWindow = new Map(after.sources.map((source) => [source.record.windowId, source]));
  if (after.sources.filter((source) => source.record.windowId !== windowId).length !== beforeOthers.length) return false;
  return beforeOthers.every((source) => {
    const current = afterByWindow.get(source.record.windowId);
    return current
      && current.identityBindingDigest === source.identityBindingDigest
      && canonicalJson(sourceFingerprint(current)) === canonicalJson(sourceFingerprint(source));
  });
}

function transitionMatches(
  before,
  after,
  windowId,
  desiredRecord,
  expectedCommitIdentity = null,
  removalReceipt = null,
) {
  if (!otherSourcesUnchanged(before, after, windowId)) return false;
  const current = after.byWindowId.get(windowId) ?? null;
  if (desiredRecord === null) {
    return current === null
      && removalReceipt?.source === before.byWindowId.get(windowId);
  }
  return current !== null
    && expectedCommitIdentity !== null
    && current.identityBindingDigest === windowBindingDigest(desiredRecord)
    && statMatchesCommitIdentity(current.stat, expectedCommitIdentity);
}

function unchangedMatches(before, after) {
  if (before.sources.length !== after.sources.length) return false;
  const afterByWindow = new Map(after.sources.map((source) => [source.record.windowId, source]));
  return before.sources.every((source) => {
    const current = afterByWindow.get(source.record.windowId);
    return current
      && current.identityBindingDigest === source.identityBindingDigest
      && canonicalJson(sourceFingerprint(current)) === canonicalJson(sourceFingerprint(source));
  });
}

// create/replace委托atomic writer，decommission采用同目录rename→fsync→unlink并保留恢复判定证据。
function writeBinding({ workspaceRoot, profile, desiredRecord, previousSource }) {
  const target = path.resolve(
    workspaceRoot,
    ...windowBindingRef({
      hostDirName: profile.hostDirName,
      windowId: desiredRecord.windowId,
    }).split("/"),
  );
  const bytes = windowBindingCanonicalBytes(desiredRecord);
  const result = atomicWriteFile({
    root: workspaceRoot,
    target,
    content: bytes,
    expectation: previousSource === null
      ? { type: "absent" }
      : { type: "file", sha256: previousSource.fileSha256 },
    sourceIdentity: previousSource === null ? null : atomicSourceIdentity(previousSource),
    captureCommitIdentity: true,
    mode: 0o600,
    ownership: "whole-file",
    label: "window identity binding",
  });
  return Object.freeze({ target, commitIdentity: result.commitIdentity });
}

function unlinkBinding({ workspaceRoot, profile, source }) {
  const target = path.resolve(
    workspaceRoot,
    ...windowBindingRef({ hostDirName: profile.hostDirName, windowId: source.record.windowId }).split("/"),
  );
  const parent = path.dirname(target);
  const removalStage = path.join(
    parent,
    `.${path.basename(target)}.wakeflow-removal-${process.pid}-${randomUUID()}`,
  );
  let descriptor = null;
  try {
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(target, { bigint: true });
    if (!sameStat(source.stat, opened) || !sameStat(source.stat, current)) {
      fail("wakeflow-window-binding-cas-mismatch", "binding source changed before decommission");
    }
    fs.renameSync(target, removalStage);
    const movedDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const movedPath = fs.lstatSync(removalStage, { bigint: true });
    if (
      !sameMovedStat(source.stat, movedDescriptor)
      || !sameMovedStat(source.stat, movedPath)
    ) {
      fail("wakeflow-window-binding-recovery-required", "decommission captured an unexpected source");
    }
    assertDecommissionPathAbsent(target, "a successor appeared during decommission");
    syncDirectory(parent);
    const beforeUnlinkDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const beforeUnlinkPath = fs.lstatSync(removalStage, { bigint: true });
    if (
      !sameMovedStat(source.stat, beforeUnlinkDescriptor)
      || !sameMovedStat(source.stat, beforeUnlinkPath)
    ) {
      fail("wakeflow-window-binding-recovery-required", "decommission source changed before removal");
    }
    fs.unlinkSync(removalStage);
    const unlinked = fs.fstatSync(descriptor, { bigint: true });
    if (!sameMovedStat(source.stat, unlinked, { allowUnlinked: true })) {
      fail("wakeflow-window-binding-recovery-required", "decommission removed an unexpected source");
    }
    assertDecommissionPathAbsent(
      removalStage,
      "decommission removal stage was repopulated after unlink",
    );
    assertDecommissionPathAbsent(target, "a successor appeared after decommission");
    syncDirectory(parent);
    const settled = fs.fstatSync(descriptor, { bigint: true });
    if (!sameMovedStat(source.stat, settled, { allowUnlinked: true })) {
      fail("wakeflow-window-binding-recovery-required", "decommission unlink proof changed after sync");
    }
    assertDecommissionPathAbsent(
      removalStage,
      "decommission removal stage was repopulated after sync",
    );
    assertDecommissionPathAbsent(target, "a successor appeared after decommission sync");
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
  return Object.freeze({ source });
}

function assertDecommissionPathAbsent(file, occupiedMessage) {
  try {
    fs.lstatSync(file, { bigint: true });
    fail("wakeflow-window-binding-recovery-required", occupiedMessage);
  } catch (cause) {
    if (cause instanceof WakeflowWindowBindingError) throw cause;
    if (cause?.code !== "ENOENT") {
      fail("wakeflow-window-binding-recovery-required", "decommission path absence cannot be proven");
    }
  }
}

function mutationResult(status, source, profile) {
  return deepFreeze({ status, ...publicBinding(source, profile) });
}

function decommissionResult(source, profile) {
  return deepFreeze({ status: "decommissioned", ...publicBinding(source, profile) });
}

function rejectedResult(cause) {
  if (cause instanceof WakeflowWindowBindingError) {
    return deepFreeze({ outcome: "rejected", code: cause.code, message: cause.message, details: cause.details });
  }
  return deepFreeze({
    outcome: "rejected",
    code: "wakeflow-window-binding-operation",
    message: "window identity operation failed before its commit boundary",
    details: {},
  });
}

function throwRejected(value) {
  throw new WakeflowWindowBindingError(value.code, value.message, { details: value.details });
}

function wrapMutationFailure(cause) {
  if (cause instanceof WakeflowWindowBindingError) throw cause;
  const causeCode = typeof cause?.code === "string" && /^[-a-z0-9]+$/u.test(cause.code)
    ? cause.code
    : "unknown";
  const code = causeCode.includes("busy") || causeCode.includes("timeout")
    ? "wakeflow-window-binding-mutation-busy"
    : causeCode.includes("recovery") || causeCode.includes("durability")
      ? "wakeflow-window-binding-recovery-required"
      : "wakeflow-window-binding-mutation";
  throw new WakeflowWindowBindingError(code, "window identity mutation failed closed", {
    details: { causeCode },
  });
}

// 普通三类mutation统一在runtime T02 gate内重读config/inventory，并把effect后状态闭合为old或new。
async function runBindingMutation(action, input, profile) {
  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: `window-binding-${action}`,
      domainOwner: "window-registration-service",
      ...(input.acquireTimeoutMs === undefined ? {} : { acquireTimeoutMs: input.acquireTimeoutMs }),
    }, async (context) => {
      assertWakeflowMutationContext({
        workspaceRoot: input.workspaceRoot,
        context,
        mode: "runtime-mutation",
      });
      let before = null;
      let desiredRecord = null;
      let previousSource = null;
      let expectedCommitIdentity = null;
      let removalReceipt = null;
      let commitAttempted = false;
      let successStatus = null;
      try {
        const snapshot = loadCandidateSnapshot(input.workspaceRoot, profile);
        assertConfiguredWindow(snapshot, input.windowId);
        before = scanBindingInventoryInternal({ workspaceRoot: input.workspaceRoot, snapshot, profile });
        if (before.state !== "current") {
          fail("wakeflow-window-binding-layout", "identity layout must be materialized before registration");
        }
        previousSource = before.byWindowId.get(input.windowId) ?? null;

        if (action === "register") {
          if (previousSource !== null) {
            if (
              previousSource.record.handle.kind === input.handle.kind
              && previousSource.record.handle.value === input.handle.value
            ) {
              return deepFreeze({ outcome: "success", value: mutationResult("replayed", previousSource, profile) });
            }
            fail(
              "wakeflow-window-binding-replace-required",
              "a different handle requires explicit binding replacement",
            );
          }
          assertHandleUnique(before, input.handle);
          desiredRecord = createWindowBindingRecord({
            programId: snapshot.model.program.programId,
            hostId: profile.hostId,
            windowId: input.windowId,
            bindingId: newUniqueBindingId(before),
            handle: input.handle,
            registeredAt: nextRegisteredAt(),
          });
          successStatus = "created";
        } else if (action === "replace") {
          if (previousSource === null) {
            fail("wakeflow-window-binding-cas-mismatch", "replacement requires one current binding");
          }
          assertExpectedCurrent(previousSource, input);
          if (
            previousSource.record.handle.kind === input.handle.kind
            && previousSource.record.handle.value === input.handle.value
          ) {
            fail("wakeflow-window-binding-replay-required", "same-handle registration must use the replay path");
          }
          assertHandleUnique(before, input.handle, input.windowId);
          desiredRecord = createWindowBindingRecord({
            programId: snapshot.model.program.programId,
            hostId: profile.hostId,
            windowId: input.windowId,
            bindingId: newUniqueBindingId(before),
            handle: input.handle,
            registeredAt: nextRegisteredAt(previousSource.record.registeredAt),
          });
          successStatus = "replaced";
        } else {
          if (previousSource === null) {
            fail("wakeflow-window-binding-cas-mismatch", "decommission requires one current binding");
          }
          assertExpectedCurrent(previousSource, input);
          successStatus = "decommissioned";
        }

        if (action !== "register") {
          assertWindowCoordinationLeaseAbsent(input.workspaceRoot, input.windowId);
        }
        commitAttempted = true;
        if (action === "decommission") {
          removalReceipt = unlinkBinding({
            workspaceRoot: input.workspaceRoot,
            profile,
            source: previousSource,
          });
        } else {
          const committed = writeBinding({
            workspaceRoot: input.workspaceRoot,
            profile,
            desiredRecord,
            previousSource,
          });
          expectedCommitIdentity = committed.commitIdentity;
          syncBindingTarget(committed.target, expectedCommitIdentity);
        }
        const afterSnapshot = loadCandidateSnapshot(input.workspaceRoot, profile);
        const after = scanBindingInventoryInternal({
          workspaceRoot: input.workspaceRoot,
          snapshot: afterSnapshot,
          profile,
        });
        if (!transitionMatches(
          before,
          after,
          input.windowId,
          desiredRecord,
          expectedCommitIdentity,
          removalReceipt,
        )) {
          fail("wakeflow-window-binding-recovery-required", "binding transition did not close exactly");
        }
        if (action !== "register") {
          assertWindowCoordinationLeaseAbsent(input.workspaceRoot, input.windowId);
        }
        if (action === "decommission") {
          return deepFreeze({ outcome: "success", value: decommissionResult(previousSource, profile) });
        }
        return deepFreeze({
          outcome: "success",
          value: mutationResult(successStatus, after.byWindowId.get(input.windowId), profile),
        });
      } catch (cause) {
        if (!commitAttempted) return rejectedResult(cause);
        if (before !== null) {
          try {
            const snapshot = loadCandidateSnapshot(input.workspaceRoot, profile);
            const current = scanBindingInventoryInternal({
              workspaceRoot: input.workspaceRoot,
              snapshot,
              profile,
            });
            if (transitionMatches(
              before,
              current,
              input.windowId,
              desiredRecord,
              expectedCommitIdentity,
              removalReceipt,
            )) {
              if (action !== "register") {
                assertWindowCoordinationLeaseAbsent(input.workspaceRoot, input.windowId);
              }
              if (action === "decommission") {
                syncDirectory(current.chain.root);
                return deepFreeze({ outcome: "success", value: decommissionResult(previousSource, profile) });
              }
              const committed = current.byWindowId.get(input.windowId);
              const target = path.resolve(input.workspaceRoot, ...publicBinding(committed, profile).identityRef.split("/"));
              syncBindingTarget(target, expectedCommitIdentity);
              return deepFreeze({
                outcome: "success",
                value: mutationResult(successStatus, committed, profile),
              });
            }
            if (unchangedMatches(before, current)) return rejectedResult(cause);
          } catch {
            // 未知stage/source/durability状态必须逃出callback，让T02保留恢复证据，不能猜测新旧身份。
          }
        }
        throw new WakeflowWindowBindingError(
          "wakeflow-window-binding-recovery-required",
          "window identity commit has an ambiguous recovery state",
        );
      }
    });
  } catch (cause) {
    wrapMutationFailure(cause);
  }
  if (result?.outcome === "rejected") throwRejected(result);
  if (result?.outcome !== "success") {
    fail("wakeflow-window-binding-mutation", "window identity mutation returned an invalid result");
  }
  return result.value;
}

/** 读取当前artifact宿主的脱敏binding inventory；不探测真实宿主窗口。 */
export function inspectWindowBindingInventory(input = {}) {
  const normalized = normalizeInspectInput(input);
  const profile = normalizeIdentityProfile();
  const snapshot = loadCandidateSnapshot(normalized.workspaceRoot, profile);
  return scanBindingInventoryInternal({
    workspaceRoot: normalized.workspaceRoot,
    snapshot,
    profile,
  }).public;
}

/** 供layout owner在静态mode可修复阶段观察指定host profile，仍不执行目录修复。 */
export function inspectWindowBindingInventoryForLayout(input = {}) {
  const normalized = normalizeLayoutInventoryInput(input);
  const windowById = Object.fromEntries(normalized.windowIds.map((windowId) => [windowId, true]));
  const snapshot = deepFreeze({
    configDigest: normalized.configDigest,
    model: { program: { programId: normalized.programId } },
    indexes: { windowById },
  });
  return scanBindingInventoryInternal({
    workspaceRoot: normalized.workspaceRoot,
    snapshot,
    profile: normalized.profile,
    directoryModePolicy: "layout-repairable",
  }).public;
}

/** 供跨宿主诊断按protocol host读取脱敏inventory，不取得该宿主的handle格式或effect能力。 */
export function inspectWindowBindingInventoryForProtocolHost(input = {}) {
  const normalized = normalizeHostInventoryInput(input);
  const windowById = Object.fromEntries(normalized.windowIds.map((windowId) => [windowId, true]));
  const snapshot = deepFreeze({
    configDigest: normalized.configDigest,
    model: { program: { programId: normalized.programId } },
    indexes: { windowById },
  });
  return scanBindingInventoryInternal({
    workspaceRoot: normalized.workspaceRoot,
    snapshot,
    profile: normalized.profile,
  }).public;
}

// 宿主adapter只有在exact binding CAS后才能短暂借用私有handle；callback结束后再次核验同一source。
// 返回值只能携带被动、已脱敏的数据，不能通过字符串、function、accessor或隐藏属性带出raw handle。
export async function withCurrentWindowBindingHandle(input = {}, callback) {
  const normalized = normalizeHandleConsumerInput(input);
  if (typeof callback !== "function") {
    fail("wakeflow-window-binding-input", "binding handle consumer must be a function");
  }
  const profile = normalizeIdentityProfile();
  const snapshot = loadCandidateSnapshot(normalized.workspaceRoot, profile);
  const before = scanBindingInventoryInternal({
    workspaceRoot: normalized.workspaceRoot,
    snapshot,
    profile,
  });
  const source = before.byWindowId.get(normalized.windowId) ?? null;
  if (source === null) {
    fail("wakeflow-window-binding-cas-mismatch", "binding handle consumer requires one current binding");
  }
  assertExpectedCurrent(source, normalized);
  const handle = Object.freeze({
    kind: source.record.handle.kind,
    value: source.record.handle.value,
  });
  let value;
  try {
    value = await callback(handle);
  } catch (cause) {
    if (cause instanceof WakeflowWindowBindingError) throw cause;
    throw cause;
  }
  const confirmed = loadCandidateSnapshot(normalized.workspaceRoot, profile);
  if (
    confirmed.model.program.programId !== snapshot.model.program.programId
    || confirmed.configDigest !== snapshot.configDigest
  ) {
    fail("wakeflow-window-binding-config", "config authority changed during private handle consumption");
  }
  const after = scanBindingInventoryInternal({
    workspaceRoot: normalized.workspaceRoot,
    snapshot: confirmed,
    profile,
  });
  const current = after.byWindowId.get(normalized.windowId) ?? null;
  if (
    current === null
    || current.record.bindingId !== normalized.expectedBindingId
    || current.identityBindingDigest !== normalized.expectedBindingDigest
    || canonicalJson(sourceFingerprint(current)) !== canonicalJson(sourceFingerprint(source))
  ) {
    fail("wakeflow-window-binding-cas-mismatch", "binding changed during private handle consumption");
  }
  if (valueContainsExactString(value, handle.value)) {
    fail("wakeflow-window-binding-handle-leak", "binding handle consumer result exposed the private raw handle");
  }
  return value;
}

/** 为config授权的durable窗口注册首个binding；同handle重放幂等，不同handle必须显式replace。 */
export async function registerWindowBinding(input = {}) {
  const profile = normalizeIdentityProfile();
  return runBindingMutation("register", normalizeRegisterInput(input, profile), profile);
}

/** Pod等领域owner已持有T02时使用的窄注册缝；仍固定program/config与调用方预分配bindingId。 */
export function registerPreauthorizedWindowBindingWithinMutation(input = {}) {
  const profile = normalizeIdentityProfile();
  const normalized = normalizePreauthorizedRegisterInput(input, profile);
  assertWakeflowMutationContext({
    workspaceRoot: normalized.workspaceRoot,
    context: normalized.mutationContext,
    mode: "runtime-mutation",
  });
  let before = null;
  let desiredRecord = null;
  let expectedCommitIdentity = null;
  let commitAttempted = false;
  try {
    const snapshot = loadCandidateSnapshot(normalized.workspaceRoot, profile);
    if (
      snapshot.model.program.programId !== normalized.expectedProgramId
      || snapshot.configDigest !== normalized.expectedConfigDigest
    ) {
      fail(
        "wakeflow-window-binding-config",
        "preauthorized registration no longer matches current config authority",
      );
    }
    before = scanBindingInventoryInternal({
      workspaceRoot: normalized.workspaceRoot,
      snapshot,
      profile,
    });
    if (before.state !== "current") {
      fail("wakeflow-window-binding-layout", "identity layout must be materialized before registration");
    }
    const previousSource = before.byWindowId.get(normalized.windowId) ?? null;
    if (previousSource !== null) {
      if (
        previousSource.record.bindingId === normalized.bindingId
        && previousSource.record.handle.kind === normalized.handle.kind
        && previousSource.record.handle.value === normalized.handle.value
      ) {
        return mutationResult("replayed", previousSource, profile);
      }
      fail(
        "wakeflow-window-binding-preauthorized-conflict",
        "preauthorized window identity already has a different binding or handle",
      );
    }
    assertBindingIdUnique(before, normalized.bindingId);
    assertHandleUnique(before, normalized.handle);
    desiredRecord = createWindowBindingRecord({
      programId: snapshot.model.program.programId,
      hostId: profile.hostId,
      windowId: normalized.windowId,
      bindingId: normalized.bindingId,
      handle: normalized.handle,
      registeredAt: nextRegisteredAt(),
    });
    commitAttempted = true;
    const committed = writeBinding({
      workspaceRoot: normalized.workspaceRoot,
      profile,
      desiredRecord,
      previousSource: null,
    });
    expectedCommitIdentity = committed.commitIdentity;
    syncBindingTarget(committed.target, expectedCommitIdentity);
    const confirmed = loadCandidateSnapshot(normalized.workspaceRoot, profile);
    if (
      confirmed.model.program.programId !== normalized.expectedProgramId
      || confirmed.configDigest !== normalized.expectedConfigDigest
    ) {
      fail(
        "wakeflow-window-binding-config",
        "config authority changed during preauthorized registration",
      );
    }
    const after = scanBindingInventoryInternal({
      workspaceRoot: normalized.workspaceRoot,
      snapshot: confirmed,
      profile,
    });
    if (!transitionMatches(
      before,
      after,
      normalized.windowId,
      desiredRecord,
      expectedCommitIdentity,
    )) {
      fail(
        "wakeflow-window-binding-recovery-required",
        "preauthorized binding transition did not close exactly",
      );
    }
    return mutationResult("created", after.byWindowId.get(normalized.windowId), profile);
  } catch (cause) {
    if (!commitAttempted) {
      if (cause instanceof WakeflowWindowBindingError) throw cause;
      wrapMutationFailure(cause);
    }
    if (before !== null && desiredRecord !== null) {
      try {
        const snapshot = loadCandidateSnapshot(normalized.workspaceRoot, profile);
        if (
          snapshot.model.program.programId === normalized.expectedProgramId
          && snapshot.configDigest === normalized.expectedConfigDigest
        ) {
          const current = scanBindingInventoryInternal({
            workspaceRoot: normalized.workspaceRoot,
            snapshot,
            profile,
          });
          const source = current.byWindowId.get(normalized.windowId) ?? null;
          if (
            source !== null
            && source.record.bindingId === normalized.bindingId
            && source.record.handle.kind === normalized.handle.kind
            && source.record.handle.value === normalized.handle.value
            && source.identityBindingDigest === windowBindingDigest(desiredRecord)
            && otherSourcesUnchanged(before, current, normalized.windowId)
          ) {
            const target = path.resolve(
              normalized.workspaceRoot,
              ...publicBinding(source, profile).identityRef.split("/"),
            );
            syncBindingTarget(target, atomicSourceIdentity(source));
            return mutationResult("created", source, profile);
          }
          if (unchangedMatches(before, current)) {
            if (cause instanceof WakeflowWindowBindingError) throw cause;
            wrapMutationFailure(cause);
          }
        }
      } catch (recoveryCause) {
        if (recoveryCause instanceof WakeflowWindowBindingError) throw recoveryCause;
      }
    }
    fail(
      "wakeflow-window-binding-recovery-required",
      "preauthorized identity commit has an ambiguous recovery state",
    );
  }
}

// 领域owner已持有T02时使用的窄清理缝，不重复取得T02；调用者仍须先证明本域state acknowledgement。
export function decommissionPreauthorizedWindowBindingWithinMutation(input = {}) {
  const profile = normalizeIdentityProfile();
  const normalized = normalizePreauthorizedDecommissionInput(input);
  assertWakeflowMutationContext({
    workspaceRoot: normalized.workspaceRoot,
    context: normalized.mutationContext,
    mode: "runtime-mutation",
  });
  let before = null;
  let previousSource = null;
  let removalReceipt = null;
  let commitAttempted = false;
  try {
    const snapshot = loadCandidateSnapshot(normalized.workspaceRoot, profile);
    if (
      snapshot.model.program.programId !== normalized.expectedProgramId
      || snapshot.configDigest !== normalized.expectedConfigDigest
    ) {
      fail(
        "wakeflow-window-binding-config",
        "preauthorized decommission no longer matches current config authority",
      );
    }
    before = scanBindingInventoryInternal({
      workspaceRoot: normalized.workspaceRoot,
      snapshot,
      profile,
    });
    if (before.state !== "current") {
      fail("wakeflow-window-binding-layout", "identity layout must remain materialized for decommission");
    }
    previousSource = before.byWindowId.get(normalized.windowId) ?? null;
    if (previousSource === null) {
      fail("wakeflow-window-binding-cas-mismatch", "preauthorized decommission requires one current binding");
    }
    assertExpectedCurrent(previousSource, normalized);
    assertWindowCoordinationLeaseAbsent(normalized.workspaceRoot, normalized.windowId);
    commitAttempted = true;
    removalReceipt = unlinkBinding({
      workspaceRoot: normalized.workspaceRoot,
      profile,
      source: previousSource,
    });
    const confirmed = loadCandidateSnapshot(normalized.workspaceRoot, profile);
    if (
      confirmed.model.program.programId !== normalized.expectedProgramId
      || confirmed.configDigest !== normalized.expectedConfigDigest
    ) {
      fail(
        "wakeflow-window-binding-config",
        "config authority changed during preauthorized decommission",
      );
    }
    const after = scanBindingInventoryInternal({
      workspaceRoot: normalized.workspaceRoot,
      snapshot: confirmed,
      profile,
    });
    if (!transitionMatches(
      before,
      after,
      normalized.windowId,
      null,
      null,
      removalReceipt,
    )) {
      fail(
        "wakeflow-window-binding-recovery-required",
        "preauthorized decommission did not close exactly",
      );
    }
    assertWindowCoordinationLeaseAbsent(normalized.workspaceRoot, normalized.windowId);
    return decommissionResult(previousSource, profile);
  } catch (cause) {
    if (!commitAttempted) {
      if (cause instanceof WakeflowWindowBindingError) throw cause;
      wrapMutationFailure(cause);
    }
    if (before !== null && previousSource !== null) {
      try {
        const snapshot = loadCandidateSnapshot(normalized.workspaceRoot, profile);
        if (
          snapshot.model.program.programId === normalized.expectedProgramId
          && snapshot.configDigest === normalized.expectedConfigDigest
        ) {
          const current = scanBindingInventoryInternal({
            workspaceRoot: normalized.workspaceRoot,
            snapshot,
            profile,
          });
          if (transitionMatches(
            before,
            current,
            normalized.windowId,
            null,
            null,
            removalReceipt,
          )) {
            assertWindowCoordinationLeaseAbsent(normalized.workspaceRoot, normalized.windowId);
            syncDirectory(current.chain.root);
            return decommissionResult(previousSource, profile);
          }
          if (unchangedMatches(before, current)) {
            if (cause instanceof WakeflowWindowBindingError) throw cause;
            wrapMutationFailure(cause);
          }
        }
      } catch (recoveryCause) {
        if (recoveryCause instanceof WakeflowWindowBindingError) throw recoveryCause;
      }
    }
    fail(
      "wakeflow-window-binding-recovery-required",
      "preauthorized identity decommission has an ambiguous recovery state",
    );
  }
}

/** 以旧bindingId+digest和lease-absent CAS切换到新handle与新binding代际。 */
export async function replaceWindowBinding(input = {}) {
  const profile = normalizeIdentityProfile();
  return runBindingMutation("replace", normalizeReplaceInput(input, profile), profile);
}

/** 以旧bindingId+digest和lease-absent CAS移除当前binding，不关闭任何宿主窗口。 */
export async function decommissionWindowBinding(input = {}) {
  const profile = normalizeIdentityProfile();
  return runBindingMutation("decommission", normalizeDecommissionInput(input), profile);
}
