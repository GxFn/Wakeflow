// 本模块拥有shared window coordination lease的当前物理inventory与exact acquire/release effect。
// 它联合config窗口资格、跨宿主binding代际和checkout/delivery唯一性，保护一次target delivery的独占占用；
// transport内容、host send、TargetResult与业务终态由各自owner负责，expiresAt只触发显式恢复门而不授权自动回收。
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  atomicWriteFile,
  sha256Bytes,
} from "./wakeflow-atomic-write.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import {
  buildWakeflowConfigV3Indexes,
  parseWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "./wakeflow-host-capability.mjs";
import { hostProfile as installedHostProfile } from "./wakeflow-host-profile.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  assertWindowBindingId,
} from "./wakeflow-window-binding-records.mjs";
import {
  inspectWindowBindingInventory,
  inspectWindowBindingInventoryForProtocolHost,
  inspectWindowBindingInventoryForLayout,
} from "./wakeflow-window-binding-service.mjs";
import {
  assertWindowCoordinationLeaseId,
  createWindowCoordinationLeaseRecord,
  generateWindowCoordinationLeaseId,
  sameWindowCoordinationLeaseOwner,
  validateWindowCoordinationLeaseRecord,
  windowCoordinationLeaseCanonicalBytes,
  windowCoordinationLeaseRef,
} from "./wakeflow-window-lease-records.mjs";
import {
  assertWakeflowMutationContext,
  withWakeflowRuntimeMutation,
} from "./wakeflow-workspace-mutation.mjs";

const INVENTORY_KIND = "WakeflowWindowCoordinationLeaseInventory";
const INVENTORY_SCHEMA_VERSION = 1;
const COORDINATION_ROOT_REF = ".wakeflow-local/runtime/shared/coordination/window-leases";
const DEFAULT_LEASE_DURATION_MS = 2 * 60 * 60 * 1_000;
const MAX_LEASE_BYTES = 256 * 1024;
const MAX_LEASES = 10_000;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TRANSPORT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const LEASE_OWNER_ROLES = new Set(["product", "test"]);

// 对外错误投影稳定领域码；底层cause只在内部保留，不把绝对路径或binding handle写入details。
export class WakeflowWindowCoordinationLeaseError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowWindowCoordinationLeaseError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowWindowCoordinationLeaseError(code, message, { details, cause });
}

function deepFreeze(value) {
  if (
    !value
    || typeof value !== "object"
    || Object.isFrozen(value)
    || Buffer.isBuffer(value)
  ) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 全部公开与admitted入口先复制own data字段，拒绝accessor、hidden、Symbol和附加authority。
function exactDataObject(value, required, optional, label) {
  if (!plainObject(value)) {
    fail("wakeflow-window-lease-input", `${label} must be one plain data object`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("wakeflow-window-lease-input", `${label} has the wrong field set`);
  }
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-window-lease-input",
        `${label} fields must be enumerable data properties`,
      );
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
    fail(
      "wakeflow-window-lease-input",
      "workspaceRoot must be one trimmed control-free path",
    );
  }
  return path.resolve(value);
}

function normalizeAcquireTimeout(value) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 300_000) {
    fail(
      "wakeflow-window-lease-input",
      "acquireTimeoutMs must be an integer from 0 through 300000",
    );
  }
  return value;
}

function normalizeTypedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, `$/${label}`);
  } catch (cause) {
    fail(
      "wakeflow-window-lease-input",
      `${label} must be one typed Wakeflow ${type} ID`,
      {},
      cause,
    );
  }
}

function normalizeLeaseId(value) {
  try {
    return assertWindowCoordinationLeaseId(value, "$/leaseId");
  } catch (cause) {
    fail(
      "wakeflow-window-lease-input",
      "leaseId must be one typed window coordination lease ID",
      {},
      cause,
    );
  }
}

function normalizeBindingId(value) {
  try {
    return assertWindowBindingId(value, "$/bindingId");
  } catch (cause) {
    fail(
      "wakeflow-window-lease-input",
      "bindingId must be one typed window binding ID",
      {},
      cause,
    );
  }
}

function normalizeTransportId(value, label) {
  if (typeof value !== "string" || !TRANSPORT_ID_RE.test(value)) {
    fail(
      "wakeflow-window-lease-input",
      `${label} must be one bounded portable transport ID`,
    );
  }
  return value;
}

function normalizeDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-window-lease-input", `${label} must be one sha256 digest`);
  }
  return value;
}

function normalizeInspectInput(input) {
  const values = exactDataObject(
    input,
    ["workspaceRoot"],
    [],
    "window coordination lease inspection input",
  );
  return Object.freeze({ workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot) });
}

function normalizeLayoutInspectInput(input) {
  const values = exactDataObject(
    input,
    ["workspaceRoot", "model", "configDigest", "hostProfile"],
    [],
    "layout window coordination lease inspection input",
  );
  const workspaceRoot = normalizeWorkspaceRoot(values.workspaceRoot);
  const configDigest = normalizeDigest(values.configDigest, "configDigest");
  let model;
  let profile;
  try {
    model = parseWakeflowConfigV3(values.model);
    profile = normalizeWakeflowHostCapabilityProfile(values.hostProfile);
  } catch (cause) {
    fail(
      "wakeflow-window-lease-layout-source",
      "layout model or host profile is not a valid Wakeflow authority input",
      {},
      cause,
    );
  }
  if (wakeflowConfigV3Digest(model) !== configDigest) {
    fail(
      "wakeflow-window-lease-layout-source",
      "layout configDigest does not match the supplied strict v3 model",
    );
  }
  return Object.freeze({
    workspaceRoot,
    model,
    indexes: buildWakeflowConfigV3Indexes(model),
    configDigest,
    profile,
    rawHostProfile: values.hostProfile,
  });
}

// acquire tuple由delivery owner提供；service只接受完整transport/binding摘要，不自行重建envelope。
const ACQUIRE_FIELDS = Object.freeze([
  "workspaceRoot",
  "windowId",
  "demandId",
  "targetTaskId",
  "groupId",
  "groupDigest",
  "deliveryId",
  "envelopeDigest",
  "bindingId",
  "identityBindingDigest",
]);

function normalizeAcquireInput(input, { admitted }) {
  const values = exactDataObject(
    input,
    [...ACQUIRE_FIELDS, ...(admitted ? ["mutationContext"] : [])],
    admitted ? [] : ["acquireTimeoutMs"],
    admitted
      ? "admitted window coordination lease acquisition input"
      : "window coordination lease acquisition input",
  );
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    windowId: normalizeTypedId(values.windowId, "window", "windowId"),
    demandId: normalizeTypedId(values.demandId, "demand", "demandId"),
    targetTaskId: normalizeTypedId(values.targetTaskId, "target-task", "targetTaskId"),
    groupId: normalizeTransportId(values.groupId, "groupId"),
    groupDigest: normalizeDigest(values.groupDigest, "groupDigest"),
    deliveryId: normalizeTransportId(values.deliveryId, "deliveryId"),
    envelopeDigest: normalizeDigest(values.envelopeDigest, "envelopeDigest"),
    bindingId: normalizeBindingId(values.bindingId),
    identityBindingDigest: normalizeDigest(
      values.identityBindingDigest,
      "identityBindingDigest",
    ),
    ...(admitted ? { mutationContext: values.mutationContext } : {}),
    ...(!admitted && values.acquireTimeoutMs !== undefined
      ? { acquireTimeoutMs: normalizeAcquireTimeout(values.acquireTimeoutMs) }
      : {}),
  });
}

const RELEASE_FIELDS = Object.freeze([
  "workspaceRoot",
  "windowId",
  "leaseId",
  "deliveryId",
  "bindingId",
  "leaseDigest",
]);

function normalizeReleaseInput(input, { admitted }) {
  const values = exactDataObject(
    input,
    [...RELEASE_FIELDS, ...(admitted ? ["mutationContext"] : [])],
    admitted ? [] : ["acquireTimeoutMs"],
    admitted
      ? "admitted window coordination lease release input"
      : "window coordination lease release input",
  );
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    windowId: normalizeTypedId(values.windowId, "window", "windowId"),
    leaseId: normalizeLeaseId(values.leaseId),
    deliveryId: normalizeTransportId(values.deliveryId, "deliveryId"),
    bindingId: normalizeBindingId(values.bindingId),
    leaseDigest: normalizeDigest(values.leaseDigest, "leaseDigest"),
    ...(admitted ? { mutationContext: values.mutationContext } : {}),
    ...(!admitted && values.acquireTimeoutMs !== undefined
      ? { acquireTimeoutMs: normalizeAcquireTimeout(values.acquireTimeoutMs) }
      : {}),
  });
}

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail(
      "wakeflow-window-lease-platform",
      "window coordination leases require POSIX ownership semantics",
    );
  }
  return BigInt(process.geteuid());
}

function modeOf(stat) {
  return Number(stat.mode & 0o777n);
}

// 物理身份比较固定inode、owner、mode、link、size与纳秒时间；rename后允许ctime变化但不允许换文件。
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
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

// coordination根逐级no-follow检查current-euid/private mode；layout观察只放宽可安全修复的mode。
function inspectPrivateDirectoryChain(workspaceRoot, relativeRef, modePolicy = "strict") {
  if (!new Set(["strict", "layout-repairable"]).has(modePolicy)) {
    fail("wakeflow-window-lease-layout", "coordination directory mode policy is invalid");
  }
  let rootStat;
  let realRoot;
  try {
    rootStat = fs.lstatSync(workspaceRoot, { bigint: true });
    realRoot = fs.realpathSync(workspaceRoot);
  } catch (cause) {
    fail(
      "wakeflow-window-lease-layout",
      "workspace root cannot be inspected safely",
      {},
      cause,
    );
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail("wakeflow-window-lease-layout", "workspace root must be one real directory");
  }
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
      fail(
        "wakeflow-window-lease-layout",
        "coordination directory chain cannot be inspected",
        {},
        cause,
      );
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
        "wakeflow-window-lease-layout",
        "coordination directory chain must be current-euid private real directories",
      );
    }
    let real;
    try {
      real = fs.realpathSync(current);
    } catch (cause) {
      fail(
        "wakeflow-window-lease-layout",
        "coordination directory chain cannot be resolved safely",
        {},
        cause,
      );
    }
    if (!pathInside(realRoot, real) || real === realRoot) {
      fail("wakeflow-window-lease-layout", "coordination directory chain escaped the workspace");
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
    } catch (cause) {
      fail(
        "wakeflow-window-lease-inventory",
        "coordination directory chain changed during inspection",
        {},
        cause,
      );
    }
    if (!sameStat(source.stat, current)) {
      fail(
        "wakeflow-window-lease-inventory",
        "coordination directory chain changed during inspection",
      );
    }
  }
}

// 单个lease读取同时关闭path/descriptor竞态、0600/single-link/current-owner、容量、canonical bytes与record codec。
function readStableLeaseFile(file, expected) {
  const euid = currentEuid();
  let before;
  try {
    before = fs.lstatSync(file, { bigint: true });
  } catch (cause) {
    fail("wakeflow-window-lease-inventory", "lease file is unavailable", {}, cause);
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || before.uid !== euid
    || modeOf(before) !== 0o600
    || before.size <= 0n
    || before.size > BigInt(MAX_LEASE_BYTES)
  ) {
    fail(
      "wakeflow-window-lease-inventory",
      "lease source must be one current-euid single-link 0600 regular file",
    );
  }
  let descriptor = null;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameStat(before, opened)) {
      fail("wakeflow-window-lease-inventory", "lease source changed while being opened");
    }
    const bytes = fs.readFileSync(descriptor);
    const afterDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(file, { bigint: true });
    if (
      bytes.length !== Number(opened.size)
      || !sameStat(opened, afterDescriptor)
      || !sameStat(opened, afterPath)
    ) {
      fail("wakeflow-window-lease-inventory", "lease source changed while being read");
    }
    let parsed;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      parsed = JSON.parse(text);
    } catch (cause) {
      fail(
        "wakeflow-window-lease-inventory",
        "lease source is not strict UTF-8 JSON",
        {},
        cause,
      );
    }
    let record;
    try {
      record = validateWindowCoordinationLeaseRecord(parsed, {
        expectedProgramId: expected.programId,
        expectedWindowId: expected.windowId,
      });
    } catch (cause) {
      fail(
        "wakeflow-window-lease-inventory",
        "lease record failed its owner codec",
        { causeCode: typeof cause?.code === "string" ? cause.code : "unknown" },
        cause,
      );
    }
    let canonical;
    try {
      canonical = windowCoordinationLeaseCanonicalBytes(record);
    } catch (cause) {
      fail(
        "wakeflow-window-lease-inventory",
        "lease record cannot be canonically encoded",
        {},
        cause,
      );
    }
    if (!bytes.equals(canonical)) {
      fail("wakeflow-window-lease-inventory", "lease file bytes are not canonical");
    }
    return Object.freeze({
      record,
      bytes,
      stat: opened,
      fileSha256: sha256Bytes(bytes),
    });
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // close失败不会改变已经完成的source分类，也不能授予后续effect。
      }
    }
  }
}

function validateBindingInventory(
  context,
  inventory,
  expectedHostId = context.profile.hostId,
) {
  if (
    inventory.programId !== context.model.program.programId
    || inventory.hostId !== expectedHostId
    || inventory.configDigest !== context.configDigest
    || typeof inventory.inventoryDigest !== "string"
    || !DIGEST_RE.test(inventory.inventoryDigest)
    || !Array.isArray(inventory.bindings)
  ) {
    fail(
      "wakeflow-window-lease-binding-source",
      "window binding inventory does not match lease source authority",
    );
  }
  return inventory;
}

// normal context用config→binding→config双读固定当前artifact宿主的source authority。
function normalSourceContext(workspaceRoot) {
  let initial;
  let confirmed;
  let profile;
  let bindingInventory;
  try {
    initial = loadWakeflowConfigV3Snapshot({ workspaceRoot });
    profile = normalizeWakeflowHostCapabilityProfile(installedHostProfile);
  } catch (cause) {
    fail(
      "wakeflow-window-lease-config-source",
      "strict v3 config authority is unavailable to the lease manager",
      {},
      cause,
    );
  }
  try {
    bindingInventory = inspectWindowBindingInventory({ workspaceRoot });
  } catch (cause) {
    fail(
      "wakeflow-window-lease-binding-source",
      "strict current window binding inventory is unavailable to the lease manager",
      { causeCode: typeof cause?.code === "string" ? cause.code : "unknown" },
      cause,
    );
  }
  try {
    confirmed = loadWakeflowConfigV3Snapshot({ workspaceRoot });
  } catch (cause) {
    fail(
      "wakeflow-window-lease-config-source",
      "strict v3 config authority cannot be confirmed after binding inspection",
      {},
      cause,
    );
  }
  if (
    initial.configDigest !== confirmed.configDigest
    || bindingInventory.configDigest !== confirmed.configDigest
  ) {
    fail(
      "wakeflow-window-lease-source-race",
      "lease source authority changed across binding inspection",
    );
  }
  const context = Object.freeze({
    workspaceRoot,
    model: confirmed.model,
    indexes: confirmed.indexes,
    configDigest: confirmed.configDigest,
    profile,
    bindingInventory,
  });
  validateBindingInventory(context, bindingInventory);
  return context;
}

// layout context消费调用方已解析的同digest config，并复用binding owner的layout-repairable观察。
function layoutSourceContext(input) {
  let bindingInventory;
  try {
    bindingInventory = inspectWindowBindingInventoryForLayout({
      workspaceRoot: input.workspaceRoot,
      programId: input.model.program.programId,
      hostId: input.profile.hostId,
      configDigest: input.configDigest,
      windowIds: input.model.topology.windows.map((window) => window.windowId),
      hostProfile: input.rawHostProfile,
    });
  } catch (cause) {
    fail(
      "wakeflow-window-lease-binding-source",
      "strict layout window binding inventory is unavailable to the lease manager",
      { causeCode: typeof cause?.code === "string" ? cause.code : "unknown" },
      cause,
    );
  }
  const context = Object.freeze({
    workspaceRoot: input.workspaceRoot,
    model: input.model,
    indexes: input.indexes,
    configDigest: input.configDigest,
    profile: input.profile,
    bindingInventory,
  });
  validateBindingInventory(context, bindingInventory);
  return context;
}

// shared lease可引用另一协议宿主的binding；foreign inventory仍按同program/config和严格物理合同读取。
function inspectForeignBindingInventory(context, hostId) {
  let inventory;
  try {
    inventory = inspectWindowBindingInventoryForProtocolHost({
      workspaceRoot: context.workspaceRoot,
      programId: context.model.program.programId,
      hostId,
      configDigest: context.configDigest,
      windowIds: context.model.topology.windows.map((window) => window.windowId),
    });
  } catch (cause) {
    fail(
      "wakeflow-window-lease-binding-source",
      "strict foreign-host window binding inventory is unavailable to the lease manager",
      {
        hostId,
        causeCode: typeof cause?.code === "string" ? cause.code : "unknown",
      },
      cause,
    );
  }
  return validateBindingInventory(context, inventory, hostId);
}

function bindingAuthorityDigest(inventoriesByHost) {
  return canonicalJsonDigest([...inventoriesByHost.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([hostId, inventory]) => ({
      hostId,
      inventoryDigest: inventory.inventoryDigest,
    })));
}

function assertLeaseOwner(context, source, bindingInventory) {
  const record = source.record;
  const window = context.indexes.windowById[record.windowId];
  if (!window) {
    fail(
      "wakeflow-window-lease-inventory",
      "lease inventory contains an unauthorized window identity",
    );
  }
  if (!LEASE_OWNER_ROLES.has(window.role)) {
    fail(
      "wakeflow-window-lease-inventory",
      "only Product and Test windows can own target coordination leases",
      { windowId: record.windowId, role: window.role },
    );
  }
  if (window.role === "product") {
    const repositoryId = window.root?.kind === "repository"
      ? window.root.repositoryId
      : null;
    if (
      repositoryId === null
      || record.repositoryId !== repositoryId
      || record.checkoutResourceKey !== `main:${repositoryId}`
    ) {
      fail(
        "wakeflow-window-lease-inventory",
        "product lease checkout claim differs from durable topology",
      );
    }
  } else if (
    Object.hasOwn(record, "repositoryId")
    || Object.hasOwn(record, "checkoutResourceKey")
  ) {
    fail(
      "wakeflow-window-lease-inventory",
      "non-product lease cannot own a checkout claim",
    );
  }
  const binding = bindingInventory.bindings.find((entry) => (
    entry.windowId === record.windowId
  ));
  if (
    !binding
    || binding.identityRef !== record.identityRef
    || binding.bindingId !== record.bindingId
    || binding.identityBindingDigest !== record.identityBindingDigest
  ) {
    fail(
      "wakeflow-window-lease-inventory",
      "lease binding tuple is not the current T03 identity authority",
    );
  }
}

function publicLease(source) {
  return deepFreeze({
    leaseRef: windowCoordinationLeaseRef({ windowId: source.record.windowId }),
    lease: source.record,
  });
}

function buildPublicInventory(context, state, sources) {
  const leases = sources.map(publicLease);
  const unsigned = {
    kind: INVENTORY_KIND,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    programId: context.model.program.programId,
    coordinationRootRef: COORDINATION_ROOT_REF,
    configDigest: context.configDigest,
    status: state === "missing" ? "missing" : leases.length === 0 ? "empty" : "current",
    leases,
  };
  return deepFreeze({ ...unsigned, inventoryDigest: canonicalJsonDigest(unsigned) });
}

// inventory同时关闭window资格、binding当前代际、lease/delivery/checkout全局唯一性与稳定目录快照。
function scanLeaseInventoryInternal({
  context,
  directoryModePolicy = "strict",
  requiredBindingHostIds = [],
}) {
  const chain = inspectPrivateDirectoryChain(
    context.workspaceRoot,
    COORDINATION_ROOT_REF,
    directoryModePolicy,
  );
  const bindingInventoriesByHost = new Map([
    [context.profile.hostId, context.bindingInventory],
  ]);
  for (const hostId of requiredBindingHostIds) {
    if (bindingInventoriesByHost.has(hostId)) continue;
    bindingInventoriesByHost.set(
      hostId,
      inspectForeignBindingInventory(context, hostId),
    );
  }
  if (chain.state === "missing") {
    return Object.freeze({
      state: "missing",
      context,
      chain,
      sources: Object.freeze([]),
      byWindowId: new Map(),
      bindingInventoriesByHost,
      bindingAuthorityDigest: bindingAuthorityDigest(bindingInventoriesByHost),
      public: buildPublicInventory(context, "missing", []),
    });
  }
  let beforeRoot;
  let names;
  try {
    beforeRoot = fs.lstatSync(chain.root, { bigint: true });
    names = fs.readdirSync(chain.root).sort();
  } catch (cause) {
    fail(
      "wakeflow-window-lease-inventory",
      "lease inventory cannot be read safely",
      {},
      cause,
    );
  }
  if (names.length > MAX_LEASES) {
    fail("wakeflow-window-lease-inventory", "lease inventory exceeds its closed size limit");
  }
  const sources = [];
  const byWindowId = new Map();
  const leaseIds = new Set();
  const deliveryIds = new Set();
  const checkoutClaims = new Set();
  for (const name of names) {
    if (!name.endsWith(".json")) {
      fail("wakeflow-window-lease-inventory", "lease inventory contains an unknown sibling");
    }
    const windowId = name.slice(0, -".json".length);
    try {
      assertWakeflowId(windowId, "window", "$/inventory/windowId");
    } catch (cause) {
      fail(
        "wakeflow-window-lease-inventory",
        "lease inventory contains an invalid filename",
        {},
        cause,
      );
    }
    if (!Object.hasOwn(context.indexes.windowById, windowId)) {
      fail(
        "wakeflow-window-lease-inventory",
        "lease inventory contains an unauthorized window identity",
      );
    }
    const source = readStableLeaseFile(path.join(chain.root, name), {
      programId: context.model.program.programId,
      windowId,
    });
    let bindingInventory = bindingInventoriesByHost.get(source.record.hostId);
    if (!bindingInventory) {
      bindingInventory = inspectForeignBindingInventory(context, source.record.hostId);
      bindingInventoriesByHost.set(source.record.hostId, bindingInventory);
    }
    assertLeaseOwner(context, source, bindingInventory);
    if (leaseIds.has(source.record.leaseId)) {
      fail("wakeflow-window-lease-inventory", "one lease ID belongs to multiple windows");
    }
    if (deliveryIds.has(source.record.deliveryId)) {
      fail("wakeflow-window-lease-inventory", "one delivery ID owns multiple target leases");
    }
    if (Object.hasOwn(source.record, "checkoutResourceKey")) {
      if (checkoutClaims.has(source.record.checkoutResourceKey)) {
        fail(
          "wakeflow-window-lease-inventory",
          "one checkout resource has multiple unresolved lease claims",
        );
      }
      checkoutClaims.add(source.record.checkoutResourceKey);
    }
    leaseIds.add(source.record.leaseId);
    deliveryIds.add(source.record.deliveryId);
    sources.push(source);
    byWindowId.set(windowId, source);
  }
  let afterRoot;
  let afterNames;
  try {
    afterNames = fs.readdirSync(chain.root).sort();
    afterRoot = fs.lstatSync(chain.root, { bigint: true });
  } catch (cause) {
    fail(
      "wakeflow-window-lease-inventory",
      "lease inventory changed while being read",
      {},
      cause,
    );
  }
  if (canonicalJson(afterNames) !== canonicalJson(names) || !sameStat(beforeRoot, afterRoot)) {
    fail("wakeflow-window-lease-inventory", "lease inventory changed while being read");
  }
  for (const source of sources) {
    let current;
    try {
      current = fs.lstatSync(
        path.join(chain.root, `${source.record.windowId}.json`),
        { bigint: true },
      );
    } catch (cause) {
      fail(
        "wakeflow-window-lease-inventory",
        "lease inventory changed after validation",
        {},
        cause,
      );
    }
    if (!sameStat(source.stat, current)) {
      fail("wakeflow-window-lease-inventory", "lease inventory changed after validation");
    }
  }
  assertDirectoryChainStillCurrent(chain);
  const sortedSources = sources.sort((left, right) => (
    left.record.windowId < right.record.windowId
      ? -1
      : left.record.windowId > right.record.windowId
        ? 1
        : 0
  ));
  return Object.freeze({
    state: "current",
    context,
    chain,
    sources: Object.freeze(sortedSources),
    byWindowId,
    bindingInventoriesByHost,
    bindingAuthorityDigest: bindingAuthorityDigest(bindingInventoriesByHost),
    public: buildPublicInventory(context, "current", sortedSources),
  });
}

// source authority digest把本次实际消费的全部宿主binding inventory纳入effect前后闭包。
function sameSourceAuthority(left, right) {
  return left.context.configDigest === right.context.configDigest
    && left.context.profile.hostId === right.context.profile.hostId
    && left.bindingAuthorityDigest === right.bindingAuthorityDigest;
}

function otherSourcesUnchanged(before, after, windowId) {
  if (!sameSourceAuthority(before, after)) return false;
  const beforeOthers = before.sources.filter((source) => source.record.windowId !== windowId);
  const afterOthers = after.sources.filter((source) => source.record.windowId !== windowId);
  if (beforeOthers.length !== afterOthers.length) return false;
  const afterByWindow = new Map(afterOthers.map((source) => [source.record.windowId, source]));
  return beforeOthers.every((source) => {
    const current = afterByWindow.get(source.record.windowId);
    return current
      && current.record.leaseDigest === source.record.leaseDigest
      && canonicalJson(sourceFingerprint(current)) === canonicalJson(sourceFingerprint(source));
  });
}

function transitionMatches({
  before,
  after,
  windowId,
  desiredRecord,
  commitIdentity = null,
  removalReceipt = null,
}) {
  if (!otherSourcesUnchanged(before, after, windowId)) return false;
  const current = after.byWindowId.get(windowId) ?? null;
  if (desiredRecord === null) {
    return current === null
      && removalReceipt?.source === before.byWindowId.get(windowId);
  }
  return current !== null
    && commitIdentity !== null
    && current.record.leaseDigest === desiredRecord.leaseDigest
    && statMatchesCommitIdentity(current.stat, commitIdentity);
}

function unchangedMatches(before, after) {
  if (!sameSourceAuthority(before, after)) return false;
  if (before.sources.length !== after.sources.length) return false;
  const afterByWindow = new Map(after.sources.map((source) => [source.record.windowId, source]));
  return before.sources.every((source) => {
    const current = afterByWindow.get(source.record.windowId);
    return current
      && current.record.leaseDigest === source.record.leaseDigest
      && canonicalJson(sourceFingerprint(current)) === canonicalJson(sourceFingerprint(source));
  });
}

function syncDirectory(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      directory,
      fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0),
    );
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (!stat.isDirectory()) {
      fail("wakeflow-window-lease-durability", "lease parent is no longer a directory");
    }
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function syncLeaseTarget(file, expectedIdentity) {
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
      fail(
        "wakeflow-window-lease-durability",
        "committed lease target is not one exact private file",
      );
    }
    fs.fsyncSync(descriptor);
    const afterDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(file, { bigint: true });
    if (
      !statMatchesCommitIdentity(afterDescriptor, expectedIdentity)
      || !statMatchesCommitIdentity(afterPath, expectedIdentity)
    ) {
      fail(
        "wakeflow-window-lease-durability",
        "committed lease target changed during durability sync",
      );
    }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
  syncDirectory(path.dirname(file));
}

// create使用whole-file absent CAS；release使用同目录rename→fsync→unlink并逐阶段核对同一inode。
function writeLease({ workspaceRoot, desiredRecord }) {
  const target = path.resolve(
    workspaceRoot,
    ...windowCoordinationLeaseRef({ windowId: desiredRecord.windowId }).split("/"),
  );
  let result;
  try {
    result = atomicWriteFile({
      root: workspaceRoot,
      target,
      content: windowCoordinationLeaseCanonicalBytes(desiredRecord),
      expectation: { type: "absent" },
      captureCommitIdentity: true,
      mode: 0o600,
      ownership: "whole-file",
      label: "window coordination lease",
    });
  } catch (cause) {
    fail(
      "wakeflow-window-lease-commit",
      "window coordination lease atomic create failed",
      {
        atomicCode: typeof cause?.code === "string" ? cause.code : "unknown",
        cleanupCode: typeof cause?.cleanupError?.code === "string"
          ? cause.cleanupError.code
          : null,
      },
      cause,
    );
  }
  return Object.freeze({ target, commitIdentity: result.commitIdentity });
}

function assertRemovalPathAbsent(file, message) {
  try {
    fs.lstatSync(file, { bigint: true });
    fail("wakeflow-window-lease-recovery-required", message);
  } catch (cause) {
    if (cause instanceof WakeflowWindowCoordinationLeaseError) throw cause;
    if (cause?.code !== "ENOENT") {
      fail(
        "wakeflow-window-lease-recovery-required",
        "lease removal path absence cannot be proven",
        {},
        cause,
      );
    }
  }
}

function unlinkLease({ workspaceRoot, source }) {
  const target = path.resolve(
    workspaceRoot,
    ...windowCoordinationLeaseRef({ windowId: source.record.windowId }).split("/"),
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
      fail("wakeflow-window-lease-cas-mismatch", "lease source changed before release");
    }
    fs.renameSync(target, removalStage);
    const movedDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const movedPath = fs.lstatSync(removalStage, { bigint: true });
    if (
      !sameMovedStat(source.stat, movedDescriptor)
      || !sameMovedStat(source.stat, movedPath)
    ) {
      fail(
        "wakeflow-window-lease-recovery-required",
        "lease release captured an unexpected source",
      );
    }
    assertRemovalPathAbsent(target, "a successor appeared during lease release");
    syncDirectory(parent);
    const beforeUnlinkDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const beforeUnlinkPath = fs.lstatSync(removalStage, { bigint: true });
    if (
      !sameMovedStat(source.stat, beforeUnlinkDescriptor)
      || !sameMovedStat(source.stat, beforeUnlinkPath)
    ) {
      fail(
        "wakeflow-window-lease-recovery-required",
        "lease release source changed before removal",
      );
    }
    fs.unlinkSync(removalStage);
    const unlinked = fs.fstatSync(descriptor, { bigint: true });
    if (!sameMovedStat(source.stat, unlinked, { allowUnlinked: true })) {
      fail(
        "wakeflow-window-lease-recovery-required",
        "lease release removed an unexpected source",
      );
    }
    assertRemovalPathAbsent(removalStage, "lease removal stage was repopulated after unlink");
    assertRemovalPathAbsent(target, "a successor appeared after lease release");
    syncDirectory(parent);
    const settled = fs.fstatSync(descriptor, { bigint: true });
    if (!sameMovedStat(source.stat, settled, { allowUnlinked: true })) {
      fail(
        "wakeflow-window-lease-recovery-required",
        "lease unlink proof changed after parent sync",
      );
    }
    assertRemovalPathAbsent(
      removalStage,
      "lease removal stage was repopulated after parent sync",
    );
    assertRemovalPathAbsent(target, "a successor appeared after lease release sync");
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
  return Object.freeze({ source });
}

// 两小时时间只标记“需要exact recovery”；它不是TTL清理器，也不会覆盖旧holder。
function nextLeaseTimes() {
  const acquiredMs = Date.now();
  if (!Number.isFinite(acquiredMs)) {
    fail("wakeflow-window-lease-time", "current lease time is unavailable");
  }
  const expiresMs = acquiredMs + DEFAULT_LEASE_DURATION_MS;
  return Object.freeze({
    acquiredAt: new Date(acquiredMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
  });
}

function uniqueLeaseId(inventory) {
  const existing = new Set(inventory.sources.map((source) => source.record.leaseId));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = generateWindowCoordinationLeaseId();
    if (!existing.has(candidate)) return candidate;
  }
  fail("wakeflow-window-lease-identifier", "cannot allocate a unique coordination lease ID");
}

function currentBindingFor(context, input) {
  const binding = context.bindingInventory.bindings.find((entry) => (
    entry.windowId === input.windowId
  ));
  if (!binding) {
    fail(
      "wakeflow-window-lease-binding-required",
      "target window requires one current T03 binding before lease acquisition or release",
      { windowId: input.windowId },
    );
  }
  return binding;
}

function bindingForLease(inventory, record) {
  const bindingInventory = inventory.bindingInventoriesByHost.get(record.hostId);
  const binding = bindingInventory?.bindings.find((entry) => (
    entry.windowId === record.windowId
  ));
  if (!binding) {
    fail(
      "wakeflow-window-lease-binding-required",
      "lease holder requires one current T03 binding before exact release",
      { hostId: record.hostId, windowId: record.windowId },
    );
  }
  return binding;
}

function assertAcquireBinding(binding, input) {
  if (
    binding.bindingId !== input.bindingId
    || binding.identityBindingDigest !== input.identityBindingDigest
  ) {
    fail(
      "wakeflow-window-lease-binding-mismatch",
      "requested binding tuple is not the current T03 identity authority",
      { windowId: input.windowId, bindingId: input.bindingId },
    );
  }
}

function assertRecordBinding(binding, record) {
  if (
    binding.identityRef !== record.identityRef
    || binding.bindingId !== record.bindingId
    || binding.identityBindingDigest !== record.identityBindingDigest
  ) {
    fail(
      "wakeflow-window-lease-binding-mismatch",
      "current binding tuple no longer matches the exact lease holder",
      { windowId: record.windowId, bindingId: record.bindingId },
    );
  }
}

// 只有durable Product/Test窗口可直接持有target lease；动态Pod窗口须先有独立实现与授权合同。
function configuredWindowOrReject(context, windowId) {
  const window = context.indexes.windowById[windowId];
  if (!window) {
    fail(
      "wakeflow-window-lease-dynamic-pod-owner-not-realized",
      "config-external dynamic Pod window authority is not realized",
      { windowId },
    );
  }
  if (!LEASE_OWNER_ROLES.has(window.role)) {
    fail(
      "wakeflow-window-lease-window-ineligible",
      "only Product and Test windows can receive target coordination leases",
      { windowId, role: window.role },
    );
  }
  return window;
}

// Product窗口按main:<repositoryId>互斥checkout；Test窗口不取得仓库claim。
function checkoutClaimForWindow(window) {
  if (window.role !== "product") return Object.freeze({});
  const repositoryId = window.root?.kind === "repository"
    ? window.root.repositoryId
    : null;
  if (repositoryId === null) {
    fail(
      "wakeflow-window-lease-config-source",
      "product window has no exact repository authority",
      { windowId: window.windowId },
    );
  }
  return Object.freeze({
    repositoryId,
    checkoutResourceKey: `main:${repositoryId}`,
  });
}

function assertCheckoutAvailable(inventory, claim, windowId) {
  if (!Object.hasOwn(claim, "checkoutResourceKey")) return;
  const holder = inventory.sources.find((source) => (
    source.record.windowId !== windowId
    && source.record.checkoutResourceKey === claim.checkoutResourceKey
  ));
  if (holder) {
    fail(
      "wakeflow-window-lease-checkout-conflict",
      "main checkout already has an unresolved coordination lease",
      {
        windowId,
        checkoutResourceKey: claim.checkoutResourceKey,
        holderWindowId: holder.record.windowId,
      },
    );
  }
}

function assertDeliveryAvailable(inventory, deliveryId, windowId) {
  const holder = inventory.sources.find((source) => (
    source.record.deliveryId === deliveryId
  ));
  if (holder) {
    fail(
      "wakeflow-window-lease-delivery-conflict",
      "delivery already owns an unresolved target coordination lease",
      {
        windowId,
        deliveryId,
        holderWindowId: holder.record.windowId,
      },
    );
  }
}

// 过期判断只选择错误路线，调用者仍必须用完整holder tuple执行显式release。
function isExpired(record) {
  return Date.parse(record.expiresAt) <= Date.now();
}

function exactReleaseHolder(source, input) {
  return source.record.leaseId === input.leaseId
    && source.record.deliveryId === input.deliveryId
    && source.record.bindingId === input.bindingId
    && source.record.leaseDigest === input.leaseDigest;
}

function successValue(status, source, inventory) {
  return deepFreeze({
    status,
    leaseRef: windowCoordinationLeaseRef({ windowId: source.record.windowId }),
    lease: source.record,
    inventoryDigest: inventory.public.inventoryDigest,
  });
}

function successResult(value) {
  return deepFreeze({ outcome: "success", value });
}

function rejectedResult(cause) {
  if (cause instanceof WakeflowWindowCoordinationLeaseError) {
    return deepFreeze({
      outcome: "rejected",
      code: cause.code,
      message: cause.message,
      details: cause.details,
    });
  }
  return deepFreeze({
    outcome: "rejected",
    code: "wakeflow-window-lease-operation",
    message: "window coordination lease operation failed before its commit boundary",
    details: {
      causeCode: typeof cause?.code === "string" ? cause.code : "unknown",
    },
  });
}

function throwRejected(value) {
  throw new WakeflowWindowCoordinationLeaseError(value.code, value.message, {
    details: value.details,
  });
}

function assertAdmittedContext(input) {
  assertWakeflowMutationContext({
    workspaceRoot: input.workspaceRoot,
    context: input.mutationContext,
    mode: "runtime-mutation",
  });
}

// admitted seam要求调用者已持有T02；内部仍重读config、binding和整个lease inventory再执行effect。
function admittedAcquire(input) {
  assertAdmittedContext(input);
  let before = null;
  let desiredRecord = null;
  let commitIdentity = null;
  let commitAttempted = false;
  try {
    const context = normalSourceContext(input.workspaceRoot);
    before = scanLeaseInventoryInternal({ context });
    if (before.state !== "current") {
      fail(
        "wakeflow-window-lease-layout",
        "coordination lease layout must be materialized before acquisition",
      );
    }
    const window = configuredWindowOrReject(context, input.windowId);
    const binding = currentBindingFor(context, input);
    assertAcquireBinding(binding, input);
    const claim = checkoutClaimForWindow(window);
    const times = nextLeaseTimes();
    desiredRecord = createWindowCoordinationLeaseRecord({
      programId: context.model.program.programId,
      hostId: context.profile.hostId,
      windowId: input.windowId,
      leaseId: uniqueLeaseId(before),
      demandId: input.demandId,
      targetTaskId: input.targetTaskId,
      groupId: input.groupId,
      groupDigest: input.groupDigest,
      deliveryId: input.deliveryId,
      envelopeDigest: input.envelopeDigest,
      bindingId: input.bindingId,
      identityBindingDigest: input.identityBindingDigest,
      ...claim,
      acquiredAt: times.acquiredAt,
      expiresAt: times.expiresAt,
    });
    const existing = before.byWindowId.get(input.windowId) ?? null;
    if (existing !== null) {
      if (isExpired(existing.record)) {
        fail(
          "wakeflow-window-lease-expired-recovery-required",
          "expired coordination lease requires exact release or authorized recovery",
          {
            windowId: input.windowId,
            leaseId: existing.record.leaseId,
            deliveryId: existing.record.deliveryId,
          },
        );
      }
      if (sameWindowCoordinationLeaseOwner(existing.record, desiredRecord)) {
        return successResult(successValue("replayed", existing, before));
      }
      fail(
        "wakeflow-window-lease-conflict",
        "target window already has a different unresolved coordination lease",
        {
          windowId: input.windowId,
          leaseId: existing.record.leaseId,
          deliveryId: existing.record.deliveryId,
        },
      );
    }
    assertCheckoutAvailable(before, claim, input.windowId);
    assertDeliveryAvailable(before, input.deliveryId, input.windowId);

    commitAttempted = true;
    const committed = writeLease({
      workspaceRoot: input.workspaceRoot,
      desiredRecord,
    });
    commitIdentity = committed.commitIdentity;
    syncLeaseTarget(committed.target, commitIdentity);
    const after = scanLeaseInventoryInternal({
      context: normalSourceContext(input.workspaceRoot),
      requiredBindingHostIds: before.bindingInventoriesByHost.keys(),
    });
    if (!transitionMatches({
      before,
      after,
      windowId: input.windowId,
      desiredRecord,
      commitIdentity,
    })) {
      fail(
        "wakeflow-window-lease-recovery-required",
        "lease acquisition transition did not close exactly",
      );
    }
    return successResult(successValue(
      "created",
      after.byWindowId.get(input.windowId),
      after,
    ));
  } catch (cause) {
    if (!commitAttempted) return rejectedResult(cause);
    if (before !== null) {
      try {
        const current = scanLeaseInventoryInternal({
          context: normalSourceContext(input.workspaceRoot),
          requiredBindingHostIds: before.bindingInventoriesByHost.keys(),
        });
        if (transitionMatches({
          before,
          after: current,
          windowId: input.windowId,
          desiredRecord,
          commitIdentity,
        })) {
          const committed = current.byWindowId.get(input.windowId);
          const target = path.resolve(
            input.workspaceRoot,
            ...windowCoordinationLeaseRef({ windowId: input.windowId }).split("/"),
          );
          syncLeaseTarget(target, commitIdentity);
          return successResult(successValue("created", committed, current));
        }
        if (unchangedMatches(before, current)) return rejectedResult(cause);
      } catch {
        // 未知stage/source/durability状态必须逃出callback，让T02保留exact恢复证据。
      }
    }
    throw new WakeflowWindowCoordinationLeaseError(
      "wakeflow-window-lease-recovery-required",
      "window coordination lease acquisition has an ambiguous recovery state",
    );
  }
}

function admittedRelease(input) {
  assertAdmittedContext(input);
  let before = null;
  let previousSource = null;
  let removalReceipt = null;
  let commitAttempted = false;
  try {
    const context = normalSourceContext(input.workspaceRoot);
    before = scanLeaseInventoryInternal({ context });
    if (before.state !== "current") {
      fail(
        "wakeflow-window-lease-layout",
        "coordination lease layout must be materialized before release",
      );
    }
    configuredWindowOrReject(context, input.windowId);
    previousSource = before.byWindowId.get(input.windowId) ?? null;
    if (previousSource === null) {
      fail(
        "wakeflow-window-lease-cas-mismatch",
        "exact coordination lease holder is absent",
        { windowId: input.windowId },
      );
    }
    if (!exactReleaseHolder(previousSource, input)) {
      fail(
        "wakeflow-window-lease-cas-mismatch",
        "release tuple does not match the exact current lease holder",
        { windowId: input.windowId },
      );
    }
    const binding = bindingForLease(before, previousSource.record);
    assertRecordBinding(binding, previousSource.record);

    commitAttempted = true;
    removalReceipt = unlinkLease({
      workspaceRoot: input.workspaceRoot,
      source: previousSource,
    });
    const after = scanLeaseInventoryInternal({
      context: normalSourceContext(input.workspaceRoot),
      requiredBindingHostIds: before.bindingInventoriesByHost.keys(),
    });
    if (!transitionMatches({
      before,
      after,
      windowId: input.windowId,
      desiredRecord: null,
      removalReceipt,
    })) {
      fail(
        "wakeflow-window-lease-recovery-required",
        "lease release transition did not close exactly",
      );
    }
    return successResult(successValue("released", previousSource, after));
  } catch (cause) {
    if (!commitAttempted) return rejectedResult(cause);
    if (before !== null) {
      try {
        const current = scanLeaseInventoryInternal({
          context: normalSourceContext(input.workspaceRoot),
          requiredBindingHostIds: before.bindingInventoriesByHost.keys(),
        });
        if (transitionMatches({
          before,
          after: current,
          windowId: input.windowId,
          desiredRecord: null,
          removalReceipt,
        })) {
          syncDirectory(current.chain.root);
          return successResult(successValue("released", previousSource, current));
        }
        if (unchangedMatches(before, current)) return rejectedResult(cause);
      } catch {
        // removal residue或durability无法闭合时保留exact T02 gate，不猜测release成功。
      }
    }
    throw new WakeflowWindowCoordinationLeaseError(
      "wakeflow-window-lease-recovery-required",
      "window coordination lease release has an ambiguous recovery state",
    );
  }
}

function wrapMutationFailure(cause) {
  if (cause instanceof WakeflowWindowCoordinationLeaseError) throw cause;
  const causeCode = typeof cause?.code === "string" && /^[-a-z0-9]+$/u.test(cause.code)
    ? cause.code
    : "unknown";
  const code = causeCode.includes("busy") || causeCode.includes("timeout")
    ? "wakeflow-window-lease-mutation-busy"
    : causeCode.includes("recovery") || causeCode.includes("durability")
      ? "wakeflow-window-lease-recovery-required"
      : "wakeflow-window-lease-mutation";
  throw new WakeflowWindowCoordinationLeaseError(
    code,
    "window coordination lease mutation failed closed",
    { details: { causeCode }, cause },
  );
}

/** 读取跨宿主、脱敏且完整闭合的shared lease inventory；不执行超时清理。 */
export function inspectWindowCoordinationLeaseInventory(input = {}) {
  const normalized = normalizeInspectInput(input);
  return scanLeaseInventoryInternal({
    context: normalSourceContext(normalized.workspaceRoot),
  }).public;
}

/** 供layout/observability在静态mode待修复阶段观察lease事实，仍保持零写入。 */
export function inspectWindowCoordinationLeaseInventoryForLayout(input = {}) {
  const normalized = normalizeLayoutInspectInput(input);
  return scanLeaseInventoryInternal({
    context: layoutSourceContext(normalized),
    directoryModePolicy: "layout-repairable",
  }).public;
}

/** 普通入口取得runtime T02后，为调用方给定的完整tuple创建或幂等重放lease；生产authority由delivery编排提供。 */
export async function acquireWindowCoordinationLease(input = {}) {
  const normalized = normalizeAcquireInput(input, { admitted: false });
  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot: normalized.workspaceRoot,
      operationKind: "window-coordination-lease-acquire",
      domainOwner: "lease-manager",
      ...(normalized.acquireTimeoutMs === undefined
        ? {}
        : { acquireTimeoutMs: normalized.acquireTimeoutMs }),
    }, (mutationContext) => admittedAcquire({
      ...normalized,
      mutationContext,
    }));
  } catch (cause) {
    wrapMutationFailure(cause);
  }
  if (result?.outcome === "rejected") throwRejected(result);
  if (result?.outcome !== "success") {
    fail(
      "wakeflow-window-lease-mutation",
      "window coordination lease acquisition returned an invalid result",
    );
  }
  return result.value;
}

/** 已持T02的delivery编排入口；不会重复取得gate或削弱source重验。 */
export function acquireWindowCoordinationLeaseAdmitted(input = {}) {
  const normalized = normalizeAcquireInput(input, { admitted: true });
  return admittedAcquire(normalized);
}

/** 普通入口取得runtime T02后按lease/delivery/binding/digest四元组释放exact holder。 */
export async function releaseWindowCoordinationLease(input = {}) {
  const normalized = normalizeReleaseInput(input, { admitted: false });
  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot: normalized.workspaceRoot,
      operationKind: "window-coordination-lease-release",
      domainOwner: "lease-manager",
      ...(normalized.acquireTimeoutMs === undefined
        ? {}
        : { acquireTimeoutMs: normalized.acquireTimeoutMs }),
    }, (mutationContext) => admittedRelease({
      ...normalized,
      mutationContext,
    }));
  } catch (cause) {
    wrapMutationFailure(cause);
  }
  if (result?.outcome === "rejected") throwRejected(result);
  if (result?.outcome !== "success") {
    fail(
      "wakeflow-window-lease-mutation",
      "window coordination lease release returned an invalid result",
    );
  }
  return result.value;
}

/** 已持T02的result/lifecycle编排入口；只compare-and-delete调用方指定的exact holder。 */
export function releaseWindowCoordinationLeaseAdmitted(input = {}) {
  const normalized = normalizeReleaseInput(input, { admitted: true });
  return admittedRelease(normalized);
}
