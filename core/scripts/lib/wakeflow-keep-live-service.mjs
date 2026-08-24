/**
 * keep-live领域owner：在严格v3配置和唯一workspace mutation gate内维护租约、进程代与控制请求。
 *
 * 能力导航：
 * - 严格清单与脱敏观察：`inspectKeepLive()`、`inspectKeepLiveInventoryForLayout()`；
 * - 请求并确认保持唤醒：`ensureKeepLive()`、`recordKeepLiveStartOutcome()`；
 * - 精确释放并确认停止：`releaseKeepLive()`、`recordKeepLiveStopOutcome()`；
 * - crash-prefix收敛：`reconcileKeepLive()`；
 * - 同进程精确补偿：`rollbackKeepLiveEnsure()`。
 *
 * 上述入口共用一套领域事实和状态迁移，不是多套平行authority。本文件只产出宿主操作描述，
 * 不启动caffeinate、不发送进程信号，也不替delivery决定何时申请或释放租约。
 */
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
import { wakeflowConfigV3Digest } from "./wakeflow-config-v3.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "./wakeflow-host-capability.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  createKeepLiveControlRecord,
  createKeepLiveLeaseRecord,
  createKeepLiveManagerLockRecord,
  createKeepLiveProcessRecord,
  generateKeepLiveGenerationId,
  generateKeepLiveRequestId,
  keepLiveControlCanonicalBytes,
  keepLiveControlRef,
  keepLiveLeaseCanonicalBytes,
  keepLiveLeaseRef,
  keepLiveManagerLockCanonicalBytes,
  keepLiveManagerLockRef,
  keepLiveProcessCanonicalBytes,
  keepLiveProcessRef,
  validateKeepLiveControlRecord,
  validateKeepLiveLeaseRecord,
  validateKeepLiveManagerLockRecord,
  validateKeepLiveProcessRecord,
} from "./wakeflow-keep-live-records.mjs";
import {
  captureWakeflowProcessIdentity,
  probeWakeflowProcessIdentity,
  probeWakeflowProcessSubject,
} from "./wakeflow-process-identity.mjs";
import { withWakeflowRuntimeMutation } from "./wakeflow-workspace-mutation.mjs";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_FILE_BYTES = 1024 * 1024;
const CAPABILITIES = new Set(["macos-caffeinate", "disabled", "unavailable"]);
const OUTCOME_STATUSES = new Set(["running", "failed"]);
const STOP_OUTCOME_STATUSES = new Set(["stopped", "failed"]);
const ENSURE_RECEIPTS = new WeakMap();
const GENERATION_ID_RE = /^keep-live-generation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_ID_RE = /^keep-live-request_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

// ===== 公开错误与无行为输入准入 =====

export class WakeflowKeepLiveError extends Error {
  constructor(code, message, { cause, details = {} } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowKeepLiveError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowKeepLiveError(code, message, { cause, details });
}

function boundary(label, cause, code = "wakeflow-keep-live-operation") {
  if (cause instanceof WakeflowKeepLiveError) throw cause;
  fail(code, `${label} failed closed`, {
    causeCode: typeof cause?.code === "string" ? cause.code : "unknown",
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

function exactObject(value, required, optional = [], label = "input") {
  if (!plainObject(value)) fail("wakeflow-keep-live-input", `${label} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  const actual = Reflect.ownKeys(value);
  if (
    actual.some((key) => typeof key !== "string" || !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("wakeflow-keep-live-input", `${label} has an invalid field set`, {
      actual: actual.map(String).sort(),
      required: [...required].sort(),
      optional: [...optional].sort(),
    });
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-keep-live-input", `${label}.${String(key)} must be an enumerable data property`);
    }
  }
  return value;
}

function canonicalInputSnapshot(value, label) {
  try {
    return deepFreeze(JSON.parse(canonicalJson(value)));
  } catch (cause) {
    boundary(label, cause, "wakeflow-keep-live-input");
  }
}

// ===== 严格配置、宿主能力与协议路径上下文 =====

function normalizedWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value.trim()
    || value !== value.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail("wakeflow-keep-live-input", "workspaceRoot must be a trimmed control-free path");
  }
  return path.resolve(value);
}

function typedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, `$input/${label}`);
  } catch {
    fail("wakeflow-keep-live-input", `${label} must be one typed ${type} identifier`);
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail("wakeflow-keep-live-input", `${label} must be a sha256 digest`);
  }
  return value;
}

function keepLiveIdentifier(value, matcher, label) {
  if (typeof value !== "string" || !matcher.test(value)) {
    fail("wakeflow-keep-live-input", `${label} is not a valid keep-live identifier`);
  }
  return value;
}

function capability(value) {
  if (typeof value !== "string" || !CAPABILITIES.has(value)) {
    fail("wakeflow-keep-live-input", "capability must be macos-caffeinate, disabled, or unavailable");
  }
  return value;
}

function normalizeHostProfile(value) {
  try {
    const profile = normalizeWakeflowHostCapabilityProfile(value);
    if (!profile.capabilities.keepLive.applicable) {
      fail("wakeflow-keep-live-capability", "current host profile does not own a keep-live surface");
    }
    return profile;
  } catch (cause) {
    if (cause instanceof WakeflowKeepLiveError) throw cause;
    boundary("host profile validation", cause, "wakeflow-keep-live-profile");
  }
}

function contextPaths(workspaceRoot, profile) {
  const rootRef = `.wakeflow-local/runtime/hosts/${profile.hostDirName}/operations/keep-live`;
  return Object.freeze({
    workspaceRoot,
    rootRef,
    root: path.resolve(workspaceRoot, ...rootRef.split("/")),
    leasesRef: `${rootRef}/leases`,
    leases: path.resolve(workspaceRoot, ...`${rootRef}/leases`.split("/")),
    processRef: keepLiveProcessRef({ hostDirName: profile.hostDirName }),
    controlRef: keepLiveControlRef({ hostDirName: profile.hostDirName }),
    managerLockRef: keepLiveManagerLockRef({ hostDirName: profile.hostDirName }),
  });
}

function normalContext(input) {
  const workspaceRoot = normalizedWorkspaceRoot(input.workspaceRoot);
  const profile = normalizeHostProfile(input.hostProfile);
  let snapshot;
  try {
    snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot });
  } catch (cause) {
    boundary("strict v3 config load", cause, "wakeflow-keep-live-config");
  }
  return Object.freeze({
    workspaceRoot,
    profile,
    programId: snapshot.model.program.programId,
    configDigest: snapshot.configDigest,
    model: snapshot.model,
    paths: contextPaths(workspaceRoot, profile),
  });
}

function layoutContext(input) {
  exactObject(
    input,
    ["workspaceRoot", "model", "configDigest", "hostProfile"],
    [],
    "layout keep-live inspection input",
  );
  const workspaceRoot = normalizedWorkspaceRoot(input.workspaceRoot);
  const profile = normalizeHostProfile(input.hostProfile);
  let configDigest;
  try {
    configDigest = wakeflowConfigV3Digest(input.model);
  } catch (cause) {
    boundary("layout config validation", cause, "wakeflow-keep-live-config");
  }
  if (input.configDigest !== configDigest) {
    fail("wakeflow-keep-live-config", "layout configDigest differs from the supplied strict v3 model");
  }
  return Object.freeze({
    workspaceRoot,
    profile,
    programId: input.model.program.programId,
    configDigest,
    model: input.model,
    paths: contextPaths(workspaceRoot, profile),
  });
}

// ===== 有界、no-follow且可稳定复验的物理读取 =====

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail("wakeflow-keep-live-platform", "keep-live files require POSIX ownership semantics");
  }
  return BigInt(process.geteuid());
}

function modeOf(stat) {
  return Number(stat.mode & 0o777n);
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

function inspectDirectory(candidate, label, { layoutRepairable = false } = {}) {
  let stat;
  try {
    stat = fs.lstatSync(candidate, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    fail("wakeflow-keep-live-layout", `cannot inspect ${label}`, {}, cause);
  }
  const mode = modeOf(stat);
  const expectedMode = layoutRepairable
    ? (mode & 0o700) === 0o700 && (mode & 0o022) === 0
    : mode === DIRECTORY_MODE;
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || stat.uid !== currentEuid()
    || !expectedMode
  ) {
    fail("wakeflow-keep-live-layout", `${label} is not a private owner directory`);
  }
  return stat;
}

function assertSafeAncestorChain(context, candidate, label) {
  const relative = path.relative(context.workspaceRoot, candidate);
  if (
    relative === ""
    || path.isAbsolute(relative)
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
  ) {
    fail("wakeflow-keep-live-layout", `${label} escapes the workspace`);
  }
  let current = context.workspaceRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current, { bigint: true });
    } catch (cause) {
      if (cause?.code === "ENOENT") return;
      fail("wakeflow-keep-live-layout", `cannot inspect ${label} ancestor`, {}, cause);
    }
    if (stat.isSymbolicLink()) {
      fail("wakeflow-keep-live-layout", `${label} ancestor cannot be a symlink`);
    }
    if (current !== candidate && !stat.isDirectory()) {
      fail("wakeflow-keep-live-layout", `${label} ancestor must be a directory`);
    }
  }
}

function stableReadFile(context, ref, validator, canonicalBytes, label) {
  const candidate = path.resolve(context.workspaceRoot, ...ref.split("/"));
  assertSafeAncestorChain(context, candidate, label);
  let before;
  try {
    before = fs.lstatSync(candidate, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    fail("wakeflow-keep-live-read", `cannot inspect ${label}`, { ref }, cause);
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.uid !== currentEuid()
    || before.nlink !== 1n
    || modeOf(before) !== FILE_MODE
    || before.size > BigInt(MAX_FILE_BYTES)
  ) {
    fail("wakeflow-keep-live-corrupt", `${label} is not one bounded private regular file`, { ref });
  }
  let descriptor;
  try {
    descriptor = fs.openSync(candidate, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    fail("wakeflow-keep-live-read", `cannot open ${label}`, { ref }, cause);
  }
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!sameStat(before, opened)) {
      fail("wakeflow-keep-live-unstable", `${label} changed while being opened`, { ref });
    }
    const bytes = fs.readFileSync(descriptor);
    const afterDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(candidate, { bigint: true });
    if (
      bytes.length > MAX_FILE_BYTES
      || !sameStat(opened, afterDescriptor)
      || !sameStat(opened, afterPath)
      || afterDescriptor.size !== BigInt(bytes.length)
    ) {
      fail("wakeflow-keep-live-unstable", `${label} changed while being read`, { ref });
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch (cause) {
      fail("wakeflow-keep-live-corrupt", `${label} is not valid JSON`, { ref }, cause);
    }
    let record;
    try {
      record = validator(parsed);
    } catch (cause) {
      fail("wakeflow-keep-live-schema-mismatch", `${label} does not match its closed record contract`, {
        ref,
        recordCode: typeof cause?.code === "string" ? cause.code : "unknown",
      }, cause);
    }
    const expected = canonicalBytes(record);
    if (!expected.equals(bytes)) {
      fail("wakeflow-keep-live-corrupt", `${label} is not canonical JSON`, { ref });
    }
    return Object.freeze({
      ref,
      candidate,
      record,
      bytes,
      sha256: sha256Bytes(bytes),
      stat: opened,
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSourceContext(source, context, label) {
  if (!source) return;
  if (
    source.record.programId !== context.programId
    || source.record.hostId !== context.profile.hostId
  ) {
    fail("wakeflow-keep-live-authority", `${label} belongs to another program or host`, {
      ref: source.ref,
    });
  }
}

function readLease(context, automationRunId) {
  const ref = keepLiveLeaseRef({
    hostDirName: context.profile.hostDirName,
    automationRunId,
  });
  const source = stableReadFile(
    context,
    ref,
    validateKeepLiveLeaseRecord,
    keepLiveLeaseCanonicalBytes,
    "keep-live lease",
  );
  assertSourceContext(source, context, "keep-live lease");
  if (source && source.record.automationRunId !== automationRunId) {
    fail("wakeflow-keep-live-authority", "lease filename differs from its automation owner", { ref });
  }
  return source;
}

function readProcess(context) {
  const source = stableReadFile(
    context,
    context.paths.processRef,
    validateKeepLiveProcessRecord,
    keepLiveProcessCanonicalBytes,
    "keep-live process generation",
  );
  assertSourceContext(source, context, "keep-live process generation");
  return source;
}

function readControl(context) {
  const source = stableReadFile(
    context,
    context.paths.controlRef,
    validateKeepLiveControlRecord,
    keepLiveControlCanonicalBytes,
    "keep-live control request",
  );
  assertSourceContext(source, context, "keep-live control request");
  return source;
}

function readManagerLock(context) {
  const source = stableReadFile(
    context,
    context.paths.managerLockRef,
    validateKeepLiveManagerLockRecord,
    keepLiveManagerLockCanonicalBytes,
    "keep-live manager lock",
  );
  assertSourceContext(source, context, "keep-live manager lock");
  return source;
}

// ===== 领域清单、进程观察与公开投影 =====

// 进程记录是持久化事实；health必须通过当前OS主体重查派生，不能由status或文件存在性代替。
function processObservation(source) {
  if (!source) {
    return Object.freeze({ health: "missing", worker: "missing", child: "missing" });
  }
  const { record } = source;
  if (record.status === "starting") {
    return Object.freeze({ health: "starting", worker: "missing", child: "missing" });
  }
  if (record.worker === null && record.child === null) {
    return Object.freeze({
      health: record.status === "stopping" ? "stopping" : "failed",
      worker: "missing",
      child: "missing",
    });
  }
  const worker = record.worker === null ? "missing" : probeWakeflowProcessSubject(record.worker);
  const child = record.child === null ? "missing" : probeWakeflowProcessSubject(record.child);
  const identityMismatch = [worker, child].some((value) => [
    "executable-mismatch",
    "argv-mismatch",
    "parent-mismatch",
  ].includes(value));
  if (identityMismatch) return Object.freeze({ health: "identity-mismatch", worker, child });
  if (worker === "unverifiable" || child === "unverifiable") {
    return Object.freeze({ health: "unverifiable", worker, child });
  }
  if (worker === "same-live" && child === "same-live") {
    return Object.freeze({ health: record.status, worker, child });
  }
  if (worker === "old-identity-gone-or-reused" && child === "old-identity-gone-or-reused") {
    return Object.freeze({ health: "missing", worker, child });
  }
  return Object.freeze({ health: "identity-mismatch", worker, child });
}

// 只判断process/control的代、request、revision和阶段闭包，不执行修复。
function controlIssue(processSource, controlSource) {
  if (!controlSource) {
    if (processSource && ["starting", "stopping"].includes(processSource.record.status)) {
      return "missing-control";
    }
    return null;
  }
  if (!processSource) return "stale-control";
  const processRecord = processSource.record;
  const control = controlSource.record;
  if (
    control.generationId !== processRecord.generationId
    || control.requestId !== processRecord.controlRequestId
    || control.revision !== processRecord.controlRevision
  ) {
    return "stale-control";
  }
  if (
    (processRecord.status === "starting"
      && (control.action !== "start" || control.phase !== "requested"))
    || (processRecord.status === "stopping" && control.action !== "stop")
  ) {
    return "stale-control";
  }
  if (
    processRecord.status === "running"
    && !(control.action === "start" && control.phase !== "failed")
  ) {
    return "stale-control";
  }
  if (processRecord.status === "failed" && control.phase !== "failed") {
    return "stale-control";
  }
  return null;
}

/**
 * 在同一配置/宿主上下文中读取完整keep-live树，并把未知条目、损坏记录和不安全物理属性fail closed。
 */
function scanInventory(context, { layoutRepairable = false, allowMissingLayout = false } = {}) {
  assertSafeAncestorChain(context, context.paths.root, "keep-live root");
  const rootStat = inspectDirectory(context.paths.root, "keep-live root", { layoutRepairable });
  if (rootStat === null) {
    if (!allowMissingLayout) fail("wakeflow-keep-live-layout", "keep-live root is not materialized");
    return Object.freeze({
      context,
      state: "missing",
      leases: [],
      process: null,
      control: null,
      managerLock: null,
      processObservation: Object.freeze({ health: "missing", worker: "missing", child: "missing" }),
      issues: Object.freeze(["layout-missing"]),
    });
  }
  const leaseRootStat = inspectDirectory(context.paths.leases, "keep-live lease root", {
    layoutRepairable,
  });
  if (leaseRootStat === null) {
    if (!allowMissingLayout) fail("wakeflow-keep-live-layout", "keep-live lease root is not materialized");
    return Object.freeze({
      context,
      state: "missing",
      leases: [],
      process: null,
      control: null,
      managerLock: null,
      processObservation: Object.freeze({ health: "missing", worker: "missing", child: "missing" }),
      issues: Object.freeze(["layout-missing"]),
    });
  }

  const rootEntries = fs.readdirSync(context.paths.root).sort();
  const allowedRootEntries = new Set(["leases", "process.json", "control.json", "manager.lock"]);
  const unknownRoot = rootEntries.filter((entry) => !allowedRootEntries.has(entry));
  if (unknownRoot.length > 0) {
    fail("wakeflow-keep-live-unknown", "unknown entry exists in keep-live root", {
      entries: unknownRoot,
    });
  }
  const leaseEntries = fs.readdirSync(context.paths.leases).sort();
  const leases = [];
  for (const name of leaseEntries) {
    const match = name.match(/^(dispatch-group_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u);
    if (!match) {
      fail("wakeflow-keep-live-unknown", "unknown entry exists in keep-live lease root", {
        entry: name,
      });
    }
    leases.push(readLease(context, match[1]));
  }
  const processSource = readProcess(context);
  const controlSource = readControl(context);
  const managerLock = readManagerLock(context);
  const observation = processObservation(processSource);
  const issues = [];
  const controlProblem = controlIssue(processSource, controlSource);
  if (controlProblem) issues.push(controlProblem);
  if (leases.length > 0 && (!processSource || observation.health === "missing")) {
    issues.push("lease-without-process");
  }
  if (leases.length === 0 && processSource) issues.push("process-without-lease");
  if (observation.health === "identity-mismatch") issues.push("process-identity-mismatch");
  if (observation.health === "unverifiable") issues.push("process-identity-unverifiable");
  return Object.freeze({
    context,
    state: "current",
    leases: Object.freeze(leases),
    process: processSource,
    control: controlSource,
    managerLock,
    processObservation: observation,
    issues: Object.freeze([...new Set(issues)].sort()),
  });
}

function publicInventory(inventory) {
  const diskTuple = {
    leases: inventory.leases.map((source) => ({
      ref: source.ref,
      digest: source.record.leaseDigest,
    })),
    process: inventory.process
      ? { ref: inventory.process.ref, digest: inventory.process.record.processDigest }
      : null,
    control: inventory.control
      ? { ref: inventory.control.ref, digest: inventory.control.record.controlDigest }
      : null,
    managerLock: inventory.managerLock
      ? { ref: inventory.managerLock.ref, digest: inventory.managerLock.record.lockDigest }
      : null,
  };
  return deepFreeze({
    kind: "WakeflowKeepLiveInventory",
    schemaVersion: 1,
    programId: inventory.context.programId,
    hostId: inventory.context.profile.hostId,
    state: inventory.state,
    leaseCount: inventory.leases.length,
    leases: inventory.leases.map((source) => ({
      automationRunId: source.record.automationRunId,
      demandId: source.record.demandId,
      ref: source.ref,
      digest: source.record.leaseDigest,
    })),
    process: inventory.process
      ? {
        ref: inventory.process.ref,
        digest: inventory.process.record.processDigest,
        generationId: inventory.process.record.generationId,
        capability: inventory.process.record.capability,
        status: inventory.process.record.status,
        health: inventory.processObservation.health,
        observedAt: inventory.process.record.observedAt,
        errorCode: inventory.process.record.errorCode,
      }
      : null,
    control: inventory.control
      ? {
        ref: inventory.control.ref,
        digest: inventory.control.record.controlDigest,
        generationId: inventory.control.record.generationId,
        requestId: inventory.control.record.requestId,
        action: inventory.control.record.action,
        phase: inventory.control.record.phase,
        revision: inventory.control.record.revision,
      }
      : null,
    managerLock: inventory.managerLock
      ? {
        ref: inventory.managerLock.ref,
        digest: inventory.managerLock.record.lockDigest,
        active: true,
        ownerHealth: probeWakeflowProcessIdentity(inventory.managerLock.record.owner),
      }
      : null,
    issues: inventory.issues,
    inventoryDigest: canonicalJsonDigest(diskTuple),
  });
}

function publicInventoryAfterOwnedMutation(inventory) {
  return publicInventory(Object.freeze({
    ...inventory,
    managerLock: null,
  }));
}

// ===== 精确CAS写入与compare-and-delete effect =====

// 所有领域写入经atomicWriteFile按原字节摘要和stat identity提交，随后立即重读证明当前值。
function writeRecord(context, source, ref, record, canonicalBytes, label) {
  const target = path.resolve(context.workspaceRoot, ...ref.split("/"));
  const content = canonicalBytes(record);
  try {
    atomicWriteFile({
      root: context.workspaceRoot,
      target,
      content,
      expectation: source
        ? { type: "file", sha256: source.sha256 }
        : { type: "absent" },
      ...(source ? { sourceIdentity: sourceIdentity(source.stat) } : {}),
      mode: FILE_MODE,
      ownership: "whole-file",
      label,
    });
  } catch (cause) {
    fail("wakeflow-keep-live-commit", `${label} atomic commit failed`, {
      ref,
      atomicCode: typeof cause?.code === "string" ? cause.code : "unknown",
      cleanupCode: typeof cause?.cleanupError?.code === "string"
        ? cause.cleanupError.code
        : null,
    }, cause);
  }
}

function syncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertAbsent(candidate, label) {
  try {
    fs.lstatSync(candidate, { bigint: true });
    fail("wakeflow-keep-live-recovery-required", `${label} unexpectedly exists`);
  } catch (cause) {
    if (cause instanceof WakeflowKeepLiveError) throw cause;
    if (cause?.code !== "ENOENT") {
      fail("wakeflow-keep-live-recovery-required", `cannot prove ${label} absence`, {}, cause);
    }
  }
}

function unlinkSource(source, label) {
  const parent = path.dirname(source.candidate);
  const stage = path.join(
    parent,
    `.${path.basename(source.candidate)}.wakeflow-removal-${process.pid}-${randomUUID()}`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(
      source.candidate,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(source.candidate, { bigint: true });
    if (!sameStat(source.stat, opened) || !sameStat(source.stat, current)) {
      fail("wakeflow-keep-live-cas-mismatch", `${label} changed before removal`, { ref: source.ref });
    }
    fs.renameSync(source.candidate, stage);
    const movedDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const movedPath = fs.lstatSync(stage, { bigint: true });
    if (!sameMovedStat(source.stat, movedDescriptor) || !sameMovedStat(source.stat, movedPath)) {
      fail("wakeflow-keep-live-recovery-required", `${label} removal captured another source`, {
        ref: source.ref,
      });
    }
    assertAbsent(source.candidate, `${label} successor`);
    syncDirectory(parent);
    fs.unlinkSync(stage);
    const unlinked = fs.fstatSync(descriptor, { bigint: true });
    if (!sameMovedStat(source.stat, unlinked, { allowUnlinked: true })) {
      fail("wakeflow-keep-live-recovery-required", `${label} unlink proof changed`, {
        ref: source.ref,
      });
    }
    assertAbsent(stage, `${label} removal stage`);
    assertAbsent(source.candidate, `${label} successor`);
    syncDirectory(parent);
  } catch (cause) {
    if (cause instanceof WakeflowKeepLiveError) throw cause;
    fail("wakeflow-keep-live-recovery-required", `${label} exact removal failed`, {
      ref: source.ref,
      causeCode: typeof cause?.code === "string" ? cause.code : "unknown",
    }, cause);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

// ===== workspace gate内的领域短锁 =====

function timestampAfter(...values) {
  const maximum = values
    .filter((value) => typeof value === "string")
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .reduce((current, value) => Math.max(current, value), Number.NEGATIVE_INFINITY);
  const now = Date.now();
  return new Date(Number.isFinite(maximum) ? Math.max(now, maximum + 1) : now).toISOString();
}

function recordCreateInput(record, digestField) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => ![
    "schemaVersion",
    "artifactKind",
    digestField,
  ].includes(key)));
}

function acquireManagerLock(context, mutationContext) {
  const existing = readManagerLock(context);
  if (existing) {
    const verdict = probeWakeflowProcessIdentity(existing.record.owner);
    if (verdict === "same-live") {
      fail("wakeflow-keep-live-manager-busy", "keep-live manager lock has one exact live owner");
    }
    if (verdict !== "old-identity-gone-or-reused") {
      fail("wakeflow-keep-live-manager-unverifiable", "keep-live manager lock owner cannot be verified");
    }
    unlinkSource(existing, "stale keep-live manager lock");
  }
  const record = createKeepLiveManagerLockRecord({
    programId: context.programId,
    hostId: context.profile.hostId,
    lockId: generateKeepLiveRequestId(),
    workspaceOperationId: mutationContext.operationId,
    owner: captureWakeflowProcessIdentity(),
    acquiredAt: new Date().toISOString(),
  });
  writeRecord(
    context,
    null,
    context.paths.managerLockRef,
    record,
    keepLiveManagerLockCanonicalBytes,
    "keep-live manager lock",
  );
  const created = readManagerLock(context);
  if (!created || created.record.lockDigest !== record.lockDigest) {
    fail("wakeflow-keep-live-recovery-required", "keep-live manager lock commit cannot be proved");
  }
  return created;
}

function releaseManagerLock(context, owned) {
  const current = readManagerLock(context);
  if (
    !current
    || current.record.lockId !== owned.record.lockId
    || current.record.lockDigest !== owned.record.lockDigest
    || !sameStat(current.stat, owned.stat)
  ) {
    fail("wakeflow-keep-live-recovery-required", "exact keep-live manager lock ownership changed");
  }
  unlinkSource(current, "keep-live manager lock");
}

/**
 * 在T02 workspace gate内获取manager.lock、重读配置并串行执行一次领域mutation。
 * 短锁只防同域竞争；callback仍必须自行维持可恢复的文件前缀，宿主effect不在锁内发生。
 */
async function withManagerMutation(input, operationKind, callback) {
  const outer = normalContext(input);
  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot: outer.workspaceRoot,
      operationKind,
      domainOwner: "keep-live-manager",
    }, async (mutationContext) => {
      const current = normalContext(input);
      if (
        current.configDigest !== outer.configDigest
        || current.profile.hostId !== outer.profile.hostId
      ) {
        return Object.freeze({
          outcome: "rejected",
          error: new WakeflowKeepLiveError(
            "wakeflow-keep-live-stale",
            "config or host profile changed before keep-live mutation admission",
          ),
        });
      }
      let lock = null;
      let value;
      try {
        lock = acquireManagerLock(current, mutationContext);
        value = await callback(current);
      } catch (error) {
        value = Object.freeze({ outcome: "rejected", error });
      } finally {
        if (lock) releaseManagerLock(current, lock);
      }
      return value?.outcome === "rejected"
        ? value
        : Object.freeze({ outcome: "success", value });
    });
  } catch (cause) {
    boundary("keep-live workspace mutation", cause, "wakeflow-keep-live-mutation");
  }
  if (result?.outcome === "rejected") {
    if (result.error instanceof Error) throw result.error;
    fail("wakeflow-keep-live-operation", "keep-live mutation was rejected without a structured error");
  }
  if (result?.outcome !== "success") {
    fail("wakeflow-keep-live-operation", "keep-live mutation returned an invalid result");
  }
  return result.value;
}

// ===== 宿主操作协议与领域安全预检 =====

function ensureResult(
  inventory,
  requestedCapability,
  leaseCreated,
  automationRunId,
  hostOperation = null,
) {
  const publicView = publicInventory(inventory);
  const lease = publicView.leases.find((entry) => (
    entry.automationRunId === automationRunId
  )) ?? null;
  const result = deepFreeze({
    kind: "WakeflowKeepLiveEnsureResult",
    schemaVersion: 1,
    requested: true,
    status: requestedCapability === "macos-caffeinate"
      ? hostOperation
        ? "host-operation-required"
        : publicView.process?.health === "running"
          ? "ready"
          : "pending"
      : "risk",
    capability: requestedCapability,
    health: publicView.process?.health ?? "missing",
    generationId: publicView.process?.generationId ?? null,
    observedAt: publicView.process?.observedAt ?? new Date().toISOString(),
    leaseCreated,
    lease,
    hostOperation,
  });
  return result;
}

function writeLease(context, source, record) {
  const ref = keepLiveLeaseRef({
    hostDirName: context.profile.hostDirName,
    automationRunId: record.automationRunId,
  });
  writeRecord(context, source, ref, record, keepLiveLeaseCanonicalBytes, "keep-live lease");
  const committed = readLease(context, record.automationRunId);
  if (!committed || committed.record.leaseDigest !== record.leaseDigest) {
    fail("wakeflow-keep-live-recovery-required", "keep-live lease commit cannot be proved");
  }
  return committed;
}

function writeProcess(context, source, record) {
  writeRecord(
    context,
    source,
    context.paths.processRef,
    record,
    keepLiveProcessCanonicalBytes,
    "keep-live process generation",
  );
  const committed = readProcess(context);
  if (!committed || committed.record.processDigest !== record.processDigest) {
    fail("wakeflow-keep-live-recovery-required", "keep-live process commit cannot be proved");
  }
  return committed;
}

function writeControl(context, source, record) {
  writeRecord(
    context,
    source,
    context.paths.controlRef,
    record,
    keepLiveControlCanonicalBytes,
    "keep-live control request",
  );
  const committed = readControl(context);
  if (!committed || committed.record.controlDigest !== record.controlDigest) {
    fail("wakeflow-keep-live-recovery-required", "keep-live control commit cannot be proved");
  }
  return committed;
}

function newStartingGeneration(context, inventory, now) {
  const generationId = generateKeepLiveGenerationId();
  const requestId = generateKeepLiveRequestId();
  const revision = 1;
  const processRecord = createKeepLiveProcessRecord({
    programId: context.programId,
    hostId: context.profile.hostId,
    generationId,
    capability: "macos-caffeinate",
    mechanism: "worker-caffeinate",
    status: "starting",
    worker: null,
    child: null,
    controlRequestId: requestId,
    controlRevision: revision,
    createdAt: now,
    startedAt: null,
    observedAt: now,
    stopRequestedAt: null,
    errorCode: null,
  });
  const processSource = writeProcess(context, inventory.process, processRecord);
  const controlRecord = createKeepLiveControlRecord({
    programId: context.programId,
    hostId: context.profile.hostId,
    generationId,
    requestId,
    action: "start",
    phase: "requested",
    revision,
    requestedAt: now,
    updatedAt: now,
    errorCode: null,
  });
  writeControl(context, inventory.control, controlRecord);
  return deepFreeze({
    kind: "start-keep-live-generation",
    generationId,
    requestId,
    revision,
    capability: "macos-caffeinate",
    mechanism: "worker-caffeinate",
  });
}

function repairMissingControl(context, inventory, action) {
  const processRecord = inventory.process.record;
  const now = timestampAfter(processRecord.observedAt);
  const requestId = generateKeepLiveRequestId();
  const revision = processRecord.controlRevision + 1;
  if (!Number.isSafeInteger(revision)) {
    fail("wakeflow-keep-live-revision", "keep-live control revision cannot advance safely");
  }
  const repairedProcess = createKeepLiveProcessRecord({
    ...recordCreateInput(processRecord, "processDigest"),
    controlRequestId: requestId,
    controlRevision: revision,
    observedAt: now,
  });
  writeProcess(context, inventory.process, repairedProcess);
  const control = createKeepLiveControlRecord({
    programId: context.programId,
    hostId: context.profile.hostId,
    generationId: processRecord.generationId,
    requestId,
    action,
    phase: "requested",
    revision,
    requestedAt: now,
    updatedAt: now,
    errorCode: null,
  });
  writeControl(context, inventory.control, control);
  return deepFreeze({
    kind: action === "start" ? "start-keep-live-generation" : "stop-keep-live-generation",
    generationId: processRecord.generationId,
    requestId,
    revision,
    capability: "macos-caffeinate",
    mechanism: "worker-caffeinate",
  });
}

function existingHostOperation(inventory) {
  if (!inventory.process || !inventory.control) return null;
  const processRecord = inventory.process.record;
  const control = inventory.control.record;
  if (
    processRecord.generationId !== control.generationId
    || processRecord.controlRequestId !== control.requestId
    || processRecord.controlRevision !== control.revision
    || control.phase !== "requested"
  ) return null;
  if (
    (processRecord.status === "starting" && control.action !== "start")
    || (processRecord.status === "stopping" && control.action !== "stop")
  ) return null;
  return deepFreeze({
    kind: control.action === "start" ? "start-keep-live-generation" : "stop-keep-live-generation",
    generationId: control.generationId,
    requestId: control.requestId,
    revision: control.revision,
    capability: processRecord.capability,
    mechanism: processRecord.mechanism,
  });
}

function assertSafeProcessForAutomaticAction(inventory) {
  if (["identity-mismatch", "unverifiable"].includes(inventory.processObservation.health)) {
    fail(
      "wakeflow-keep-live-process-identity",
      "keep-live process identity cannot authorize automatic reuse or stop",
      { health: inventory.processObservation.health },
    );
  }
  // failed 代仍持有精确活进程时，必须先由宿主或人工收敛；不能先写入新租约再在后续分支拒绝。
  if (
    inventory.process?.record.status === "failed"
    && inventory.processObservation.health !== "missing"
    && (inventory.process.record.worker !== null || inventory.process.record.child !== null)
  ) {
    fail(
      "wakeflow-keep-live-process-identity",
      "failed keep-live generation still owns a live process",
      { health: inventory.processObservation.health },
    );
  }
}

function assertSafeControlForAutomaticAction(inventory) {
  if (
    inventory.process
    && inventory.control
    && controlIssue(inventory.process, inventory.control) === "stale-control"
  ) {
    fail(
      "wakeflow-keep-live-control-lineage",
      "stale keep-live control cannot authorize automatic replacement",
    );
  }
}

function sameProcessSubject(left, right) {
  return left !== null
    && right !== null
    && canonicalJson(left) === canonicalJson(right);
}

function isExactRunningStartReplay(processRecord, outcome) {
  return processRecord.status === "running"
    && outcome.status === "running"
    && sameProcessSubject(processRecord.worker, outcome.worker)
    && sameProcessSubject(processRecord.child, outcome.child);
}

// ===== 公共观察与生命周期入口 =====

/**
 * 从真实workspace加载严格配置并返回当前宿主keep-live清单；这是诊断视图，不授予宿主effect authority。
 */
export function inspectKeepLive(input = {}) {
  exactObject(input, ["workspaceRoot", "hostProfile"], [], "keep-live inspection input");
  try {
    return publicInventory(scanInventory(normalContext(input), { allowMissingLayout: true }));
  } catch (cause) {
    boundary("keep-live inspection", cause, "wakeflow-keep-live-inspection");
  }
}

/**
 * 供layout inspection在尚未完成物化时读取repairable清单；model/configDigest必须已由调用方闭合一致。
 */
export function inspectKeepLiveInventoryForLayout(input = {}) {
  try {
    return publicInventory(scanInventory(layoutContext(input), {
      layoutRepairable: true,
      allowMissingLayout: true,
    }));
  } catch (cause) {
    boundary("layout keep-live inspection", cause, "wakeflow-keep-live-layout-inspection");
  }
}

/**
 * 为一个demand/automation run创建或刷新精确租约，并在需要时创建start控制请求。
 * 返回的`hostOperation`只是下一步宿主effect指令；本入口不会自行启动进程。
 */
export async function ensureKeepLive(input = {}) {
  exactObject(
    input,
    ["workspaceRoot", "hostProfile", "demandId", "automationRunId", "capability"],
    [],
    "keep-live ensure input",
  );
  let hostProfileSnapshot;
  try {
    hostProfileSnapshot = JSON.parse(canonicalJson(input.hostProfile));
  } catch (cause) {
    boundary("keep-live host profile snapshot", cause, "wakeflow-keep-live-profile");
  }
  const normalized = Object.freeze({
    workspaceRoot: normalizedWorkspaceRoot(input.workspaceRoot),
    hostProfile: hostProfileSnapshot,
    demandId: typedId(input.demandId, "demand", "demandId"),
    automationRunId: typedId(input.automationRunId, "dispatch-group", "automationRunId"),
    capability: capability(input.capability),
  });
  if (normalized.capability !== "macos-caffeinate") {
    const inventory = scanInventory(normalContext(normalized), { allowMissingLayout: true });
    if (inventory.leases.some((source) => source.record.automationRunId === normalized.automationRunId)) {
      fail(
        "wakeflow-keep-live-capability",
        "disabled or unavailable capability cannot silently retain an accepted lease",
      );
    }
    return ensureResult(
      inventory,
      normalized.capability,
      false,
      normalized.automationRunId,
    );
  }

  const result = await withManagerMutation(normalized, "keep-live-ensure", (context) => {
    let inventory = scanInventory(context);
    assertSafeProcessForAutomaticAction(inventory);
    assertSafeControlForAutomaticAction(inventory);
    const existingLease = inventory.leases.find((source) => (
      source.record.automationRunId === normalized.automationRunId
    )) ?? null;
    if (existingLease && existingLease.record.demandId !== normalized.demandId) {
      fail("wakeflow-keep-live-owner-conflict", "automationRunId is already bound to another demand");
    }
    const now = timestampAfter(existingLease?.record.lastConfirmedAt);
    const leaseRecord = createKeepLiveLeaseRecord({
      programId: context.programId,
      hostId: context.profile.hostId,
      demandId: normalized.demandId,
      automationRunId: normalized.automationRunId,
      acquiredAt: existingLease?.record.acquiredAt ?? now,
      lastConfirmedAt: now,
    });
    writeLease(context, existingLease, leaseRecord);
    inventory = scanInventory(context);
    let hostOperation = null;
    if (!inventory.process) {
      hostOperation = newStartingGeneration(context, inventory, timestampAfter(now));
    } else if (inventory.process.record.status === "starting") {
      hostOperation = existingHostOperation(inventory)
        ?? repairMissingControl(context, inventory, "start");
    } else if (inventory.process.record.status === "running") {
      if (inventory.processObservation.health === "missing") {
        hostOperation = newStartingGeneration(context, inventory, timestampAfter(now));
      }
    } else if (inventory.process.record.status === "failed") {
      if (inventory.processObservation.health === "missing" || (
        inventory.process.record.worker === null && inventory.process.record.child === null
      )) {
        hostOperation = newStartingGeneration(context, inventory, timestampAfter(now));
      } else {
        fail("wakeflow-keep-live-process-identity", "failed keep-live generation still owns a live process");
      }
    } else {
      hostOperation = existingHostOperation(inventory);
    }
    inventory = scanInventory(context);
    const value = ensureResult(
      inventory,
      normalized.capability,
      existingLease === null,
      normalized.automationRunId,
      hostOperation,
    );
    ENSURE_RECEIPTS.set(value, Object.freeze({
      workspaceRoot: context.workspaceRoot,
      hostProfile: normalized.hostProfile,
      automationRunId: normalized.automationRunId,
      leaseDigest: value.lease?.digest ?? null,
      leaseCreated: existingLease === null,
    }));
    return value;
  });
  return result;
}

function normalizeStartOutcome(value) {
  exactObject(value, ["status", "worker", "child", "observedAt", "errorCode"], [], "start outcome");
  const snapshot = canonicalInputSnapshot(value, "start outcome snapshot");
  if (!OUTCOME_STATUSES.has(snapshot.status)) {
    fail("wakeflow-keep-live-input", "start outcome status must be running or failed");
  }
  if (typeof snapshot.observedAt !== "string" || !Number.isFinite(Date.parse(snapshot.observedAt))) {
    fail("wakeflow-keep-live-input", "start outcome observedAt must be a timestamp");
  }
  if (snapshot.status === "running") {
    if (!plainObject(snapshot.worker) || !plainObject(snapshot.child) || snapshot.errorCode !== null) {
      fail("wakeflow-keep-live-input", "running start outcome requires worker/child and no errorCode");
    }
  } else if (
    snapshot.worker !== null
    || snapshot.child !== null
    || typeof snapshot.errorCode !== "string"
  ) {
    fail("wakeflow-keep-live-input", "failed start outcome requires one errorCode and no process subjects");
  }
  return snapshot;
}

/**
 * 接纳当前generation/request的宿主启动结果；running结果必须重新证明worker/child是精确活主体。
 * 成功结算后消费control，旧请求只允许完全一致的running replay。
 */
export async function recordKeepLiveStartOutcome(input = {}) {
  exactObject(
    input,
    ["workspaceRoot", "hostProfile", "generationId", "requestId", "outcome"],
    [],
    "keep-live start outcome input",
  );
  const normalized = Object.freeze({
    workspaceRoot: normalizedWorkspaceRoot(input.workspaceRoot),
    hostProfile: input.hostProfile,
    generationId: keepLiveIdentifier(input.generationId, GENERATION_ID_RE, "generationId"),
    requestId: keepLiveIdentifier(input.requestId, REQUEST_ID_RE, "requestId"),
    outcome: normalizeStartOutcome(input.outcome),
  });
  return withManagerMutation(normalized, "keep-live-start-settle", (context) => {
    let inventory = scanInventory(context);
    if (
      !inventory.process
      || inventory.process.record.generationId !== normalized.generationId
    ) {
      fail("wakeflow-keep-live-stale", "start outcome generation is no longer current");
    }
    const processRecord = inventory.process.record;
    if (
      processRecord.controlRequestId !== normalized.requestId
      || processRecord.status !== "starting"
      || !inventory.control
      || inventory.control.record.requestId !== normalized.requestId
      || inventory.control.record.action !== "start"
    ) {
      if (
        processRecord.controlRequestId === normalized.requestId
        && isExactRunningStartReplay(processRecord, normalized.outcome)
      ) return publicInventoryAfterOwnedMutation(inventory);
      if (
        processRecord.controlRequestId === normalized.requestId
        && processRecord.status === "running"
      ) {
        fail("wakeflow-keep-live-conflict", "start outcome conflicts with the settled running generation");
      }
      fail("wakeflow-keep-live-stale", "start outcome request is no longer current");
    }
    const observedAt = timestampAfter(
      processRecord.createdAt,
      processRecord.observedAt,
      normalized.outcome.observedAt,
    );
    let nextProcess;
    let nextControl;
    if (normalized.outcome.status === "running") {
      const workerVerdict = probeWakeflowProcessSubject(normalized.outcome.worker);
      const childVerdict = probeWakeflowProcessSubject(normalized.outcome.child);
      if (workerVerdict !== "same-live" || childVerdict !== "same-live") {
        fail("wakeflow-keep-live-process-identity", "start outcome process subjects are not exact live identities", {
          workerVerdict,
          childVerdict,
        });
      }
      nextProcess = createKeepLiveProcessRecord({
        programId: context.programId,
        hostId: context.profile.hostId,
        generationId: processRecord.generationId,
        capability: processRecord.capability,
        mechanism: processRecord.mechanism,
        status: "running",
        worker: normalized.outcome.worker,
        child: normalized.outcome.child,
        controlRequestId: processRecord.controlRequestId,
        controlRevision: processRecord.controlRevision,
        createdAt: processRecord.createdAt,
        startedAt: observedAt,
        observedAt,
        stopRequestedAt: null,
        errorCode: null,
      });
      nextControl = createKeepLiveControlRecord({
        ...recordCreateInput(inventory.control.record, "controlDigest"),
        phase: "acknowledged",
        updatedAt: observedAt,
        errorCode: null,
      });
    } else {
      nextProcess = createKeepLiveProcessRecord({
        programId: context.programId,
        hostId: context.profile.hostId,
        generationId: processRecord.generationId,
        capability: processRecord.capability,
        mechanism: processRecord.mechanism,
        status: "failed",
        worker: null,
        child: null,
        controlRequestId: processRecord.controlRequestId,
        controlRevision: processRecord.controlRevision,
        createdAt: processRecord.createdAt,
        startedAt: null,
        observedAt,
        stopRequestedAt: null,
        errorCode: normalized.outcome.errorCode,
      });
      nextControl = createKeepLiveControlRecord({
        ...recordCreateInput(inventory.control.record, "controlDigest"),
        phase: "failed",
        updatedAt: observedAt,
        errorCode: normalized.outcome.errorCode,
      });
    }
    writeProcess(context, inventory.process, nextProcess);
    const currentControl = readControl(context);
    writeControl(context, currentControl, nextControl);
    unlinkSource(readControl(context), "consumed keep-live start control");
    inventory = scanInventory(context);
    return publicInventoryAfterOwnedMutation(inventory);
  });
}

function createStopOperation(context, inventory) {
  const processRecord = inventory.process.record;
  const now = timestampAfter(processRecord.observedAt, processRecord.startedAt);
  const requestId = generateKeepLiveRequestId();
  const revision = processRecord.controlRevision + 1;
  if (!Number.isSafeInteger(revision)) {
    fail("wakeflow-keep-live-revision", "keep-live control revision cannot advance safely");
  }
  const stopping = createKeepLiveProcessRecord({
    ...recordCreateInput(processRecord, "processDigest"),
    status: "stopping",
    controlRequestId: requestId,
    controlRevision: revision,
    observedAt: now,
    stopRequestedAt: now,
    errorCode: null,
  });
  writeProcess(context, inventory.process, stopping);
  const control = createKeepLiveControlRecord({
    programId: context.programId,
    hostId: context.profile.hostId,
    generationId: processRecord.generationId,
    requestId,
    action: "stop",
    phase: "requested",
    revision,
    requestedAt: now,
    updatedAt: now,
    errorCode: null,
  });
  writeControl(context, inventory.control, control);
  return deepFreeze({
    kind: "stop-keep-live-generation",
    generationId: processRecord.generationId,
    requestId,
    revision,
    capability: processRecord.capability,
    mechanism: processRecord.mechanism,
  });
}

function releaseResult(inventory, status, releasedLease, hostOperation = null) {
  const view = publicInventory(inventory);
  return deepFreeze({
    kind: "WakeflowKeepLiveReleaseResult",
    schemaVersion: 1,
    status,
    releasedLease,
    remainingLeaseCount: view.leaseCount,
    health: view.process?.health ?? "missing",
    generationId: view.process?.generationId ?? null,
    observedAt: view.process?.observedAt ?? new Date().toISOString(),
    hostOperation,
  });
}

/**
 * 以automationRunId与leaseDigest精确释放一个所有者；仍有其他租约时不触碰共享进程。
 * 最后一个所有者只创建可追踪stop请求，不在本进程中发送终止信号。
 */
export async function releaseKeepLive(input = {}) {
  exactObject(
    input,
    ["workspaceRoot", "hostProfile", "automationRunId", "leaseDigest"],
    [],
    "keep-live release input",
  );
  const normalized = Object.freeze({
    workspaceRoot: normalizedWorkspaceRoot(input.workspaceRoot),
    hostProfile: input.hostProfile,
    automationRunId: typedId(input.automationRunId, "dispatch-group", "automationRunId"),
    leaseDigest: digest(input.leaseDigest, "leaseDigest"),
  });
  return withManagerMutation(normalized, "keep-live-release", (context) => {
    let inventory = scanInventory(context);
    const source = inventory.leases.find((entry) => (
      entry.record.automationRunId === normalized.automationRunId
    )) ?? null;
    if (!source) return releaseResult(inventory, "already-released", null);
    if (source.record.leaseDigest !== normalized.leaseDigest) {
      fail("wakeflow-keep-live-cas-mismatch", "lease digest changed before exact release");
    }
    const releasedLease = deepFreeze({
      automationRunId: source.record.automationRunId,
      ref: source.ref,
      digest: source.record.leaseDigest,
    });
    unlinkSource(source, "keep-live lease");
    inventory = scanInventory(context);
    if (inventory.leases.length > 0) {
      return releaseResult(inventory, "retained-by-other-runs", releasedLease);
    }
    if (!inventory.process) {
      if (inventory.control) unlinkSource(inventory.control, "orphan keep-live control");
      return releaseResult(scanInventory(context), "stopped", releasedLease);
    }
    if (controlIssue(inventory.process, inventory.control) === "stale-control") {
      return releaseResult(inventory, "manual-reconcile-required", releasedLease);
    }
    if (["identity-mismatch", "unverifiable"].includes(inventory.processObservation.health)) {
      return releaseResult(inventory, "manual-reconcile-required", releasedLease);
    }
    if (inventory.processObservation.health === "missing") {
      if (inventory.control) unlinkSource(inventory.control, "stale keep-live control");
      unlinkSource(readProcess(context), "terminal keep-live process");
      return releaseResult(scanInventory(context), "stopped", releasedLease);
    }
    const operation = inventory.process.record.status === "stopping"
      ? existingHostOperation(inventory)
        ?? repairMissingControl(context, inventory, "stop")
      : createStopOperation(context, inventory);
    return releaseResult(scanInventory(context), "host-operation-required", releasedLease, operation);
  });
}

function normalizeStopOutcome(value) {
  exactObject(value, ["status", "observedAt", "errorCode"], [], "stop outcome");
  const snapshot = canonicalInputSnapshot(value, "stop outcome snapshot");
  if (!STOP_OUTCOME_STATUSES.has(snapshot.status)) {
    fail("wakeflow-keep-live-input", "stop outcome status must be stopped or failed");
  }
  if (typeof snapshot.observedAt !== "string" || !Number.isFinite(Date.parse(snapshot.observedAt))) {
    fail("wakeflow-keep-live-input", "stop outcome observedAt must be a timestamp");
  }
  if ((snapshot.status === "failed") !== (typeof snapshot.errorCode === "string")) {
    fail("wakeflow-keep-live-input", "stop outcome errorCode does not match status");
  }
  if (snapshot.status === "stopped" && snapshot.errorCode !== null) {
    fail("wakeflow-keep-live-input", "stopped outcome cannot carry an errorCode");
  }
  return snapshot;
}

/**
 * 结算当前stop请求：只有OS观察不再发现记录主体时才接受stopped；failed保留主体证据供后续处置。
 */
export async function recordKeepLiveStopOutcome(input = {}) {
  exactObject(
    input,
    ["workspaceRoot", "hostProfile", "generationId", "requestId", "outcome"],
    [],
    "keep-live stop outcome input",
  );
  const normalized = Object.freeze({
    workspaceRoot: normalizedWorkspaceRoot(input.workspaceRoot),
    hostProfile: input.hostProfile,
    generationId: keepLiveIdentifier(input.generationId, GENERATION_ID_RE, "generationId"),
    requestId: keepLiveIdentifier(input.requestId, REQUEST_ID_RE, "requestId"),
    outcome: normalizeStopOutcome(input.outcome),
  });
  return withManagerMutation(normalized, "keep-live-stop-settle", (context) => {
    let inventory = scanInventory(context);
    if (!inventory.process && !inventory.control) {
      fail("wakeflow-keep-live-stale", "stop outcome cannot be tied to a current generation");
    }
    if (
      !inventory.process
      || inventory.process.record.generationId !== normalized.generationId
      || inventory.process.record.controlRequestId !== normalized.requestId
      || inventory.process.record.status !== "stopping"
      || !inventory.control
      || inventory.control.record.requestId !== normalized.requestId
      || inventory.control.record.action !== "stop"
    ) {
      fail("wakeflow-keep-live-stale", "stop outcome is no longer the current control request");
    }
    const processRecord = inventory.process.record;
    const observedAt = timestampAfter(processRecord.observedAt, normalized.outcome.observedAt);
    if (normalized.outcome.status === "stopped") {
      const observation = processObservation(inventory.process);
      if (![
        "missing",
        "stopping",
      ].includes(observation.health)) {
        fail("wakeflow-keep-live-process-identity", "stop outcome cannot prove exact process termination", {
          health: observation.health,
        });
      }
      if (observation.worker === "same-live" || observation.child === "same-live") {
        fail("wakeflow-keep-live-process-identity", "stop outcome still has an exact live process subject");
      }
      const acknowledged = createKeepLiveControlRecord({
        ...recordCreateInput(inventory.control.record, "controlDigest"),
        phase: "acknowledged",
        updatedAt: observedAt,
        errorCode: null,
      });
      writeControl(context, inventory.control, acknowledged);
      unlinkSource(readControl(context), "consumed keep-live stop control");
      unlinkSource(readProcess(context), "stopped keep-live process generation");
      inventory = scanInventory(context);
      return publicInventoryAfterOwnedMutation(inventory);
    }
    const failed = createKeepLiveProcessRecord({
      ...recordCreateInput(processRecord, "processDigest"),
      status: "failed",
      observedAt,
      stopRequestedAt: null,
      errorCode: normalized.outcome.errorCode,
    });
    writeProcess(context, inventory.process, failed);
    const failedControl = createKeepLiveControlRecord({
      ...recordCreateInput(inventory.control.record, "controlDigest"),
      phase: "failed",
      updatedAt: observedAt,
      errorCode: normalized.outcome.errorCode,
    });
    writeControl(context, inventory.control, failedControl);
    unlinkSource(readControl(context), "consumed failed keep-live stop control");
    return publicInventoryAfterOwnedMutation(scanInventory(context));
  });
}

/**
 * 在领域锁内收敛lease-only、process-only、缺失/残留control等已知crash prefix。
 * identity mismatch或无法验证的主体保持fail closed，不被当作可自动清理的旧进程。
 */
export async function reconcileKeepLive(input = {}) {
  exactObject(
    input,
    ["workspaceRoot", "hostProfile", "capability"],
    [],
    "keep-live reconcile input",
  );
  const normalized = Object.freeze({
    workspaceRoot: normalizedWorkspaceRoot(input.workspaceRoot),
    hostProfile: input.hostProfile,
    capability: capability(input.capability),
  });
  if (normalized.capability !== "macos-caffeinate") {
    return deepFreeze({
      kind: "WakeflowKeepLiveReconcileResult",
      schemaVersion: 1,
      status: "risk",
      capability: normalized.capability,
      inventory: inspectKeepLive({
        workspaceRoot: normalized.workspaceRoot,
        hostProfile: normalized.hostProfile,
      }),
      hostOperation: null,
    });
  }
  return withManagerMutation(normalized, "keep-live-reconcile", (context) => {
    let inventory = scanInventory(context);
    assertSafeProcessForAutomaticAction(inventory);
    assertSafeControlForAutomaticAction(inventory);
    let operation = null;
    const issue = controlIssue(inventory.process, inventory.control);
    if (
      inventory.process
      && ["running", "failed"].includes(inventory.process.record.status)
      && inventory.control
      && issue === null
    ) {
      unlinkSource(inventory.control, "consumed keep-live control residue");
      inventory = scanInventory(context);
    }
    if (!inventory.process && inventory.control) {
      unlinkSource(inventory.control, "orphan keep-live control residue");
      inventory = scanInventory(context);
    }
    if (inventory.leases.length === 0) {
      if (inventory.process) {
        if (
          inventory.processObservation.health === "missing"
          || (inventory.process.record.status === "failed"
            && inventory.process.record.worker === null
            && inventory.process.record.child === null)
        ) {
          if (inventory.control) unlinkSource(inventory.control, "terminal keep-live control residue");
          unlinkSource(readProcess(context), "terminal keep-live process residue");
        } else if (inventory.process.record.status === "stopping") {
          operation = existingHostOperation(inventory)
            ?? repairMissingControl(context, inventory, "stop");
        } else {
          operation = createStopOperation(context, inventory);
        }
      }
    } else if (!inventory.process || inventory.processObservation.health === "missing") {
      operation = newStartingGeneration(context, inventory, timestampAfter());
    } else if (inventory.process.record.status === "starting") {
      operation = existingHostOperation(inventory)
        ?? repairMissingControl(context, inventory, "start");
    } else if (inventory.process.record.status === "stopping") {
      operation = existingHostOperation(inventory)
        ?? repairMissingControl(context, inventory, "stop");
    } else if (inventory.process.record.status === "failed") {
      if (inventory.process.record.worker === null && inventory.process.record.child === null) {
        operation = newStartingGeneration(context, inventory, timestampAfter());
      }
    }
    inventory = scanInventory(context);
    return deepFreeze({
      kind: "WakeflowKeepLiveReconcileResult",
      schemaVersion: 1,
      status: operation ? "host-operation-required" : "current",
      capability: normalized.capability,
      inventory: publicInventoryAfterOwnedMutation(inventory),
      hostOperation: operation,
    });
  });
}

/**
 * 只凭同进程WeakMap回执补偿本次ensure新建的租约；预存或仅刷新过的租约不能被此入口释放。
 */
export async function rollbackKeepLiveEnsure(input = {}) {
  exactObject(input, ["result"], [], "keep-live rollback input");
  const receipt = ENSURE_RECEIPTS.get(input.result);
  if (!receipt) {
    fail("wakeflow-keep-live-rollback-proof", "rollback requires the exact in-process ensure result");
  }
  if (!receipt.leaseCreated || receipt.leaseDigest === null) {
    fail("wakeflow-keep-live-rollback-proof", "rollback cannot release a touched or pre-existing lease");
  }
  return releaseKeepLive({
    workspaceRoot: receipt.workspaceRoot,
    hostProfile: receipt.hostProfile,
    automationRunId: receipt.automationRunId,
    leaseDigest: receipt.leaseDigest,
  });
}
