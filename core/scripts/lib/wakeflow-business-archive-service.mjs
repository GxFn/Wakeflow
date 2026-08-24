/**
 * BusinessArchive 的整需求归档编排 owner。
 *
 * 本文件在 Active 双锁与 demand state-root 锁内重建终态业务闭包，先持久化可恢复事务，
 * 再委托 ledger owner 发布不可变归档、精确消费 TODO，最后以 sidecar/tombstone 前缀脱离 current。
 * 它不执行宿主关闭、不删除 transport，也不把归档存在解释为宿主 effect 或业务验收证明。
 */
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { withWakeflowActiveIdentityLock } from "./wakeflow-active-identity-lock.mjs";
import { withWakeflowActiveProjectionLock } from "./wakeflow-active-projection-lock.mjs";
import { atomicWriteFile, sha256Bytes } from "./wakeflow-atomic-write.mjs";
import {
  assertBusinessArchivePortable,
  businessArchiveCanonicalBytes,
  validateBusinessArchivePlan,
  validateBusinessArchiveSummary,
  validateBusinessArchiveTodoHistory,
  validateBusinessArchiveTransportSummary,
  validateBusinessArchiveTransaction,
} from "./wakeflow-business-archive-records.mjs";
import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import {
  demandArtifactCanonicalBytes,
  demandArtifactIdentity,
  inspectDemandArtifactInventory,
  loadDemandArtifactByRef,
  validateDemandArtifactRecord,
  WAKEFLOW_DEMAND_ARTIFACT_KINDS,
} from "./wakeflow-demand-artifact-records.mjs";
import {
  demandCoreCanonicalBytes,
  loadDemandArchiveRecoveryRecordsWhileLocked,
  loadDemandCoreRecordsWhileLocked,
  validateDemandCoreStack,
} from "./wakeflow-demand-core-records.mjs";
import { wakeflowDemandCapabilityRoots } from "./wakeflow-demand-layout.mjs";
import {
  evidenceIdentity,
  evidenceManifestCanonicalBytes,
  inspectManagedEvidenceInventory,
  loadManagedEvidenceByRef,
  loadManagedEvidencePortableMembers,
  validateEvidenceManifest,
} from "./wakeflow-evidence-records.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { inspectPodCloseFromLoadedWhileLocked } from "./wakeflow-pod-service.mjs";
import {
  findDemandArchiveRecord,
  ledgerRecordRelativeRoot,
  loadLedgerMemberBytes,
  loadLedgerRecord,
  validateLedgerRecord,
} from "./wakeflow-ledger-records.mjs";
import {
  commitLedgerRecordAndProject,
  writeLedgerProjection,
} from "./wakeflow-ledger-projector.mjs";
import { withStateRootLock } from "./wakeflow-state-lock.mjs";
import { buildTargetResultAuthoritySnapshotFromLoaded } from "./wakeflow-target-result-authority.mjs";
import { inspectTransportDemandAuthority } from "./wakeflow-transport-store.mjs";
import {
  inspectTodoArchiveLineage,
  recoverTodoRowArchive,
  TODO_BOARD_REF,
} from "./wakeflow-todo-service.mjs";

const PLAN_INPUT_KEYS = Object.freeze([
  "archiveEventId",
  "archiveId",
  "archiveReason",
  "archivedAt",
  "conclusion",
  "demandId",
  "expectedPrevious",
  "expectedProgramId",
  "workspaceRoot",
]);
const RECOVERY_INPUT_KEYS = Object.freeze([
  "archiveId",
  "demandId",
  "expectedProgramId",
  "workspaceRoot",
]);
const EXPECTED_PREVIOUS_KEYS = Object.freeze(["revision", "stateDigest"]);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const ARCHIVE_JOURNAL_REF = "transactions/archive.json";
const BUSINESS_SUMMARY_REF = "business-summary.json";
const TRANSPORT_SUMMARY_REF = "transport-summary.json";
const TODO_HISTORY_REF = "todo-history.json";
const MAX_SOURCE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_TREE_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_TRANSACTION_BYTES = 16 * 1024 * 1024;
const ACTIVE_PROJECTION_STATUS = "stale";
const ATOMIC_STAGE_SUFFIX_RE = /^(?:0|[1-9][0-9]*)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ARTIFACT_KINDS = new Set(WAKEFLOW_DEMAND_ARTIFACT_KINDS);

/**
 * 归档编排对外稳定错误；cause 只保留在进程内，不进入持久记录。
 */
export class WakeflowBusinessArchiveError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowBusinessArchiveError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowBusinessArchiveError(code, message, { details, cause });
}

function boundary(operation) {
  try {
    return operation();
  } catch (cause) {
    if (cause instanceof WakeflowBusinessArchiveError) throw cause;
    const causeCode = typeof cause?.code === "string" && /^[-a-z0-9]+$/u.test(cause.code)
      ? cause.code
      : null;
    const mapped = causeCode?.includes("privacy")
      ? "wakeflow-business-archive-privacy"
      : causeCode?.includes("conflict") || causeCode?.includes("cas-mismatch")
        ? "wakeflow-business-archive-conflict"
        : causeCode?.startsWith("todo-")
          ? "wakeflow-business-archive-todo"
          : causeCode?.includes("stage") || causeCode?.includes("journal") || causeCode?.includes("transaction")
            ? "wakeflow-business-archive-recovery"
            : "wakeflow-business-archive-closure";
    throw new WakeflowBusinessArchiveError(
      mapped,
      "business archive operation failed closed",
      { details: causeCode ? { causeCode } : {}, cause },
    );
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || Buffer.isBuffer(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozenClone(value) {
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactDataObject(value, keys, code, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, `${label} must be one plain data object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(code, `${label} must be one plain data object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key))
  ) {
    fail(code, `${label} has the wrong field set`);
  }
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${label} fields must be enumerable data properties`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function assertInputId(value, type) {
  try {
    assertWakeflowId(value, type);
  } catch (cause) {
    fail("wakeflow-business-archive-input-id", "business archive input contains an invalid typed identity", {}, cause);
  }
  return value;
}

function assertInputTimestamp(value) {
  const match = typeof value === "string" ? TIMESTAMP_RE.exec(value) : null;
  const milliseconds = match ? Date.parse(value) : Number.NaN;
  const instant = new Date(milliseconds);
  if (
    !match
    || !Number.isFinite(milliseconds)
    || instant.getUTCFullYear() !== Number(match[1])
    || instant.getUTCMonth() + 1 !== Number(match[2])
    || instant.getUTCDate() !== Number(match[3])
    || instant.getUTCHours() !== Number(match[4])
    || instant.getUTCMinutes() !== Number(match[5])
    || instant.getUTCSeconds() !== Number(match[6])
  ) {
    fail("wakeflow-business-archive-input-timestamp", "archivedAt must be one real explicit UTC timestamp");
  }
  return value;
}

function assertInputText(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() || CONTROL_RE.test(value)) {
    fail("wakeflow-business-archive-input", `${label} must be trimmed and control-free`);
  }
  return value;
}

function normalizePrevious(value) {
  const previous = exactDataObject(
    value,
    EXPECTED_PREVIOUS_KEYS,
    "wakeflow-business-archive-input",
    "expectedPrevious",
  );
  if (!Number.isSafeInteger(previous.revision) || previous.revision < 1 || !DIGEST_RE.test(previous.stateDigest)) {
    fail("wakeflow-business-archive-input", "expectedPrevious must bind one positive revision and state digest");
  }
  return Object.freeze(previous);
}

function normalizeWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail("wakeflow-business-archive-input", "workspaceRoot must be one trimmed control-free path");
  }
  return path.resolve(value);
}

function normalizePlanInput(input) {
  const values = exactDataObject(input, PLAN_INPUT_KEYS, "wakeflow-business-archive-input", "archive input");
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    expectedProgramId: assertInputId(values.expectedProgramId, "program"),
    demandId: assertInputId(values.demandId, "demand"),
    archiveId: assertInputId(values.archiveId, "archive"),
    archivedAt: assertInputTimestamp(values.archivedAt),
    archiveEventId: assertInputText(values.archiveEventId, "archiveEventId"),
    archiveReason: assertInputText(values.archiveReason, "archiveReason"),
    conclusion: assertInputText(values.conclusion, "conclusion"),
    expectedPrevious: normalizePrevious(values.expectedPrevious),
  });
}

function normalizeRecoveryInput(input) {
  const values = exactDataObject(input, RECOVERY_INPUT_KEYS, "wakeflow-business-archive-input", "archive recovery input");
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    expectedProgramId: assertInputId(values.expectedProgramId, "program"),
    demandId: assertInputId(values.demandId, "demand"),
    archiveId: assertInputId(values.archiveId, "archive"),
  });
}

function prefixedDigest(bytes) {
  return `sha256:${sha256Bytes(bytes)}`;
}

function stateRootRef(demandId) {
  return `.wakeflow-active/current/${demandId}`;
}

function archiveSidecarRef(demandId) {
  return `.wakeflow-active/current/.${demandId}.wakeflow-archive-intent.json`;
}

function archiveTombstoneRef(demandId) {
  return `.wakeflow-active/current/.${demandId}.wakeflow-archive-stage`;
}

function refPath(root, ref) {
  return path.join(root, ...ref.split("/"));
}

function lstatIfPresent(candidate) {
  try {
    return lstatSync(candidate, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function resolveContext(values) {
  const activeChain = inspectActiveWorkspaceChain(values.workspaceRoot);
  const snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: values.workspaceRoot });
  if (snapshot.model.program.programId !== values.expectedProgramId) {
    fail("wakeflow-business-archive-program", "canonical config belongs to another program");
  }
  const stateRef = stateRootRef(values.demandId);
  return Object.freeze({
    values,
    snapshot,
    activeChain,
    workspaceRoot: values.workspaceRoot,
    stateRef,
    stateRoot: refPath(values.workspaceRoot, stateRef),
    sidecarRef: archiveSidecarRef(values.demandId),
    sidecar: refPath(values.workspaceRoot, archiveSidecarRef(values.demandId)),
    tombstoneRef: archiveTombstoneRef(values.demandId),
    tombstone: refPath(values.workspaceRoot, archiveTombstoneRef(values.demandId)),
    journal: refPath(refPath(values.workspaceRoot, stateRef), ARCHIVE_JOURNAL_REF),
    ledgerRoot: snapshot.ledgerRoot,
    ledgerRootRef: snapshot.model.storage.ledgerRoot,
    todoBoard: refPath(values.workspaceRoot, TODO_BOARD_REF),
  });
}

function currentEffectiveUid() {
  if (process.platform === "win32" || typeof process.geteuid !== "function") return null;
  return BigInt(process.geteuid());
}

function permissionBits(stat) {
  return Number(stat.mode & 0o777n);
}

function nodeOwnedByCurrentUser(stat) {
  const expectedUid = currentEffectiveUid();
  return expectedUid === null || stat.uid === expectedUid;
}

function privateFileIdentity(stat) {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  });
}

function samePrivateFileIdentity(stat, identity) {
  return stat.dev === identity.dev
    && stat.ino === identity.ino
    && stat.uid === identity.uid
    && stat.gid === identity.gid
    && stat.mode === identity.mode
    && stat.nlink === identity.nlink
    && stat.size === identity.size
    && stat.mtimeNs === identity.mtimeNs
    && stat.ctimeNs === identity.ctimeNs;
}

function samePrivateFileNode(stat, identity) {
  return stat.dev === identity.dev
    && stat.ino === identity.ino
    && stat.uid === identity.uid
    && stat.gid === identity.gid
    && stat.mode === identity.mode
    && stat.nlink === identity.nlink
    && stat.size === identity.size;
}

function privateDirectoryIdentity(stat, { ownerRequired = true } = {}) {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode,
    ownerRequired,
  });
}

function assertPrivateDirectorySnapshot(candidate, identity, mode, label) {
  const stat = lstatSync(candidate, { bigint: true });
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || stat.dev !== identity.dev
    || stat.ino !== identity.ino
    || stat.uid !== identity.uid
    || stat.gid !== identity.gid
    || stat.mode !== identity.mode
    || (identity.ownerRequired && !nodeOwnedByCurrentUser(stat))
    || (mode !== null && process.platform !== "win32" && permissionBits(stat) !== mode)
    || (identity.realPath && realpathSync(candidate) !== identity.realPath)
  ) {
    fail("wakeflow-business-archive-recovery", `${label} changed during bounded cleanup`);
  }
  return stat;
}

function inspectPrivateDirectoryChain(root, directory, label) {
  const lexicalRoot = path.resolve(root);
  const lexicalDirectory = path.resolve(directory);
  const relative = path.relative(lexicalRoot, lexicalDirectory);
  if (
    !relative
    || path.isAbsolute(relative)
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
  ) {
    fail("wakeflow-business-archive-recovery", `${label} must remain below the workspace root`);
  }
  const rootStat = lstatSync(lexicalRoot, { bigint: true });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail("wakeflow-business-archive-recovery", `${label} workspace root is unsafe`);
  }
  const realRoot = realpathSync(lexicalRoot);
  const chain = [{
    candidate: lexicalRoot,
    identity: Object.freeze({
      ...privateDirectoryIdentity(rootStat, { ownerRequired: false }),
      realPath: realRoot,
    }),
    mode: null,
  }];
  let candidate = lexicalRoot;
  let expectedReal = realRoot;
  for (const segment of relative.split(path.sep)) {
    candidate = path.join(candidate, segment);
    expectedReal = path.join(expectedReal, segment);
    const stat = lstatSync(candidate, { bigint: true });
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || !nodeOwnedByCurrentUser(stat)
      || (process.platform !== "win32" && permissionBits(stat) !== 0o700)
      || realpathSync(candidate) !== expectedReal
    ) {
      fail("wakeflow-business-archive-recovery", `${label} contains an unsafe private directory ancestor`);
    }
    chain.push({
      candidate,
      identity: Object.freeze({ ...privateDirectoryIdentity(stat), realPath: expectedReal }),
      mode: 0o700,
    });
  }
  return Object.freeze(chain.map((entry) => Object.freeze(entry)));
}

function inspectActiveWorkspaceChain(workspaceRoot) {
  return inspectPrivateDirectoryChain(
    workspaceRoot,
    path.join(workspaceRoot, ".wakeflow-active", "current"),
    "active workspace",
  );
}

function assertPrivateAncestorChain(ancestors, label) {
  for (const ancestor of ancestors) {
    assertPrivateDirectorySnapshot(ancestor.candidate, ancestor.identity, ancestor.mode, label);
  }
}

/**
 * 以 no-follow descriptor 有界读取私有文件，并在读取前后复验 current owner 与纳秒节点身份。
 */
function safeReadPrivateFileSnapshot(candidate, { maximumBytes = MAX_SOURCE_FILE_BYTES, mode = 0o600 } = {}) {
  const before = lstatSync(candidate, { bigint: true });
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || before.size > BigInt(maximumBytes)
    || !nodeOwnedByCurrentUser(before)
    || (process.platform !== "win32" && permissionBits(before) !== mode)
  ) {
    throw Object.assign(new Error("unsafe private archive file"), { code: "wakeflow-business-archive-file-unsafe" });
  }
  let descriptor;
  try {
    descriptor = openSync(candidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    throw Object.assign(new Error("private archive file changed before open"), {
      code: "wakeflow-business-archive-file-race",
      cause,
    });
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile()
      || opened.nlink !== 1n
      || opened.size > BigInt(maximumBytes)
      || !nodeOwnedByCurrentUser(opened)
      || !samePrivateFileIdentity(opened, privateFileIdentity(before))
      || (process.platform !== "win32" && permissionBits(opened) !== mode)
    ) {
      throw Object.assign(new Error("private archive file changed while opening"), { code: "wakeflow-business-archive-file-race" });
    }
    const expectedSize = Number(opened.size);
    const capture = Buffer.alloc(expectedSize + 1);
    let offset = 0;
    while (offset < capture.length) {
      const count = readSync(descriptor, capture, offset, capture.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = lstatSync(candidate, { bigint: true });
    if (
      after.isSymbolicLink()
      || !after.isFile()
      || after.nlink !== 1n
      || !nodeOwnedByCurrentUser(after)
      || !samePrivateFileIdentity(after, privateFileIdentity(opened))
      || offset !== expectedSize
      || (process.platform !== "win32" && permissionBits(after) !== mode)
    ) {
      throw Object.assign(new Error("private archive file changed while reading"), { code: "wakeflow-business-archive-file-race" });
    }
    return Object.freeze({
      bytes: Buffer.from(capture.subarray(0, offset)),
      identity: privateFileIdentity(after),
    });
  } finally {
    closeSync(descriptor);
  }
}

function safeReadPrivateFile(candidate, options = undefined) {
  return safeReadPrivateFileSnapshot(candidate, options).bytes;
}

function parseCanonicalBusinessRecordBytes(bytes, validator) {
  let raw;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw Object.assign(new Error("archive record is not valid UTF-8 JSON"), {
      code: "wakeflow-business-archive-record-invalid",
      cause,
    });
  }
  const value = validator(raw);
  if (!bytes.equals(businessArchiveCanonicalBytes(value))) {
    throw Object.assign(new Error("archive record is not canonical"), { code: "wakeflow-business-archive-record-invalid" });
  }
  return value;
}

function readCanonicalBusinessRecord(candidate, validator) {
  const bytes = safeReadPrivateFile(candidate, { maximumBytes: 16 * 1024 * 1024 });
  const value = parseCanonicalBusinessRecordBytes(bytes, validator);
  return Object.freeze({ value, bytes, byteDigest: prefixedDigest(bytes) });
}

function interruptedAtomicStages(target, ancestors) {
  assertPrivateAncestorChain(ancestors, "interrupted atomic stage ancestor");
  const directory = path.dirname(target);
  const prefix = `.${path.basename(target)}.wakeflow-stage-`;
  const stages = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name.startsWith(prefix) && ATOMIC_STAGE_SUFFIX_RE.test(entry.name.slice(prefix.length)))
    .map((entry) => path.join(directory, entry.name))
    .sort(lexicalCompare);
  assertPrivateAncestorChain(ancestors, "interrupted atomic stage ancestor");
  return stages;
}

function inspectInterruptedAtomicStage(target, label, ancestors) {
  const stages = interruptedAtomicStages(target, ancestors);
  if (lstatIfPresent(target)) {
    if (stages.length !== 0) {
      fail("wakeflow-business-archive-recovery", `${label} coexists with an interrupted atomic stage`);
    }
    return null;
  }
  if (stages.length > 1) {
    fail("wakeflow-business-archive-recovery", `${label} has more than one interrupted atomic stage`);
  }
  return stages[0] ?? null;
}

function promoteInterruptedAtomicStage(target, stage, expectedBytes, label, ancestors) {
  assertPrivateAncestorChain(ancestors, `interrupted ${label} ancestor`);
  const snapshot = safeReadPrivateFileSnapshot(stage, { maximumBytes: 16 * 1024 * 1024 });
  if (!snapshot.bytes.equals(expectedBytes) || lstatIfPresent(target)) {
    fail("wakeflow-business-archive-conflict", `interrupted ${label} stage differs from its exact transaction intent`);
  }
  const before = lstatSync(stage, { bigint: true });
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || !samePrivateFileIdentity(before, snapshot.identity)
  ) {
    fail("wakeflow-business-archive-recovery", `interrupted ${label} stage changed before promotion`);
  }
  assertPrivateAncestorChain(ancestors, `interrupted ${label} ancestor`);
  renameSync(stage, target);
  assertPrivateAncestorChain(ancestors, `interrupted ${label} ancestor`);
  const promoted = safeReadPrivateFileSnapshot(target, { maximumBytes: 16 * 1024 * 1024 });
  if (
    !promoted.bytes.equals(expectedBytes)
    || !samePrivateFileNode(promoted.identity, snapshot.identity)
  ) {
    fail("wakeflow-business-archive-recovery", `interrupted ${label} stage did not promote exactly`);
  }
}

function discardInterruptedAtomicStage(stage, expectedIdentity, label, ancestors) {
  assertPrivateAncestorChain(ancestors, `interrupted ${label} ancestor`);
  const before = lstatSync(stage, { bigint: true });
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || !samePrivateFileIdentity(before, expectedIdentity)
  ) {
    fail("wakeflow-business-archive-recovery", `interrupted ${label} stage changed before cleanup`);
  }
  assertPrivateAncestorChain(ancestors, `interrupted ${label} ancestor`);
  unlinkSync(stage);
  assertPrivateAncestorChain(ancestors, `interrupted ${label} ancestor`);
  if (lstatIfPresent(stage)) {
    fail("wakeflow-business-archive-recovery", `interrupted ${label} stage survived bounded cleanup`);
  }
}

function recoverInterruptedJournalStage(context, mode) {
  const ancestors = inspectPrivateDirectoryChain(
    context.workspaceRoot,
    path.dirname(context.journal),
    "archive journal",
  );
  const stage = inspectInterruptedAtomicStage(context.journal, "archive journal", ancestors);
  if (!stage) return false;
  const snapshot = safeReadPrivateFileSnapshot(stage, { maximumBytes: 16 * 1024 * 1024 });
  let transaction;
  try {
    transaction = parseCanonicalBusinessRecordBytes(snapshot.bytes, validateBusinessArchiveTransaction);
  } catch (cause) {
    if (mode === "recover") {
      fail(
        "wakeflow-business-archive-recovery",
        "interrupted archive journal does not retain a complete transaction intent",
        {},
        cause,
      );
    }
    discardInterruptedAtomicStage(stage, snapshot.identity, "archive journal", ancestors);
    return false;
  }
  contextFromTransaction(context, transaction);
  promoteInterruptedAtomicStage(context.journal, stage, snapshot.bytes, "archive journal", ancestors);
  return true;
}

function scanSourceTreeOnce(stateRoot) {
  const rootStat = lstatSync(stateRoot, { bigint: true });
  if (
    rootStat.isSymbolicLink()
    || !rootStat.isDirectory()
    || !nodeOwnedByCurrentUser(rootStat)
    || (process.platform !== "win32" && permissionBits(rootStat) !== 0o700)
  ) {
    throw Object.assign(new Error("archive source root is unsafe"), { code: "wakeflow-business-archive-source-unsafe" });
  }
  const rootReal = realpathSync(stateRoot);
  const directories = [];
  const files = [];
  let totalBytes = 0;
  const visit = (directory, prefix = "") => {
    const before = lstatSync(directory, { bigint: true });
    const beforeIdentity = privateFileIdentity(before);
    if (
      before.isSymbolicLink()
      || !before.isDirectory()
      || !nodeOwnedByCurrentUser(before)
      || (process.platform !== "win32" && permissionBits(before) !== 0o700)
    ) {
      throw Object.assign(new Error("archive source directory is unsafe"), { code: "wakeflow-business-archive-source-unsafe" });
    }
    if (realpathSync(directory) !== (prefix ? path.join(rootReal, ...prefix.split("/")) : rootReal)) {
      throw Object.assign(new Error("archive source directory escapes its root"), { code: "wakeflow-business-archive-source-unsafe" });
    }
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => lexicalCompare(left.name, right.name));
    for (const entry of entries) {
      const ref = prefix ? `${prefix}/${entry.name}` : entry.name;
      const candidate = path.join(directory, entry.name);
      const stat = lstatSync(candidate, { bigint: true });
      if (stat.isSymbolicLink()) {
        throw Object.assign(new Error("archive source contains a symlink"), { code: "wakeflow-business-archive-source-unsafe" });
      }
      if (stat.isDirectory()) {
        if (
          !nodeOwnedByCurrentUser(stat)
          || (process.platform !== "win32" && permissionBits(stat) !== 0o700)
        ) {
          throw Object.assign(new Error("archive source directory mode is unsafe"), { code: "wakeflow-business-archive-source-unsafe" });
        }
        directories.push({ ref, mode: 0o700 });
        visit(candidate, ref);
      } else if (stat.isFile()) {
        const bytes = safeReadPrivateFile(candidate);
        totalBytes += bytes.length;
        if (totalBytes > MAX_SOURCE_TREE_BYTES) {
          throw Object.assign(new Error("archive source exceeds its bounded tree size"), { code: "wakeflow-business-archive-source-limit" });
        }
        files.push({ ref, mode: 0o600, byteDigest: prefixedDigest(bytes) });
      } else {
        throw Object.assign(new Error("archive source contains a special entry"), { code: "wakeflow-business-archive-source-unsafe" });
      }
    }
    const after = lstatSync(directory, { bigint: true });
    if (
      after.isSymbolicLink()
      || !after.isDirectory()
      || !nodeOwnedByCurrentUser(after)
      || !samePrivateFileIdentity(after, beforeIdentity)
    ) {
      throw Object.assign(new Error("archive source directory changed while reading"), {
        code: "wakeflow-business-archive-source-race",
      });
    }
  };
  visit(stateRoot);
  directories.sort((left, right) => lexicalCompare(left.ref, right.ref));
  files.sort((left, right) => lexicalCompare(left.ref, right.ref));
  return frozenClone({
    directories,
    files,
    treeDigest: canonicalJsonDigest({ directories, files }),
  });
}

/**
 * 连续两次枚举 current 根，只有目录和文件的精确身份与摘要都稳定时才返回源树。
 */
function stableSourceTree(stateRoot) {
  const first = scanSourceTreeOnce(stateRoot);
  const second = scanSourceTreeOnce(stateRoot);
  if (canonicalJson(first) !== canonicalJson(second)) {
    throw Object.assign(new Error("archive source changed across inventory capture"), { code: "wakeflow-business-archive-source-race" });
  }
  return first;
}

function parentRefs(ref) {
  const segments = ref.split("/").slice(0, -1);
  return segments.map((_segment, index) => segments.slice(0, index + 1).join("/"));
}

function assertExpectedSourceTree(sourceTree, { expectedFiles, expectedDirectories }) {
  const actualFiles = sourceTree.files.map((entry) => entry.ref);
  const actualDirectories = sourceTree.directories.map((entry) => entry.ref);
  const files = [...expectedFiles].sort(lexicalCompare);
  const directories = [...expectedDirectories].sort(lexicalCompare);
  if (
    actualFiles.length !== files.length
    || actualDirectories.length !== directories.length
    || actualFiles.some((ref, index) => ref !== files[index])
    || actualDirectories.some((ref, index) => ref !== directories[index])
  ) {
    fail("wakeflow-business-archive-source-closure", "archive source tree contains missing, orphan, or unknown entries");
  }
}

function expectedArtifactTuples(events) {
  const tuples = events.flatMap((event) => event.changedArtifacts.filter((entry) => ARTIFACT_KINDS.has(entry.artifactKind)));
  const refs = new Set();
  const identities = new Set();
  for (const tuple of tuples) {
    const identity = `${tuple.artifactKind}\u0000${tuple.artifactId}`;
    if (refs.has(tuple.ref) || identities.has(identity)) {
      fail("wakeflow-business-archive-artifact-closure", "one immutable demand artifact must be committed exactly once");
    }
    refs.add(tuple.ref);
    identities.add(identity);
  }
  return tuples.sort((left, right) => lexicalCompare(left.ref, right.ref));
}

function expectedEvidenceTuples(events) {
  const tuples = events.flatMap((event) => event.changedArtifacts.filter((entry) => entry.artifactKind === "wakeflow-evidence"));
  if (
    new Set(tuples.map((entry) => entry.ref)).size !== tuples.length
    || new Set(tuples.map((entry) => entry.artifactId)).size !== tuples.length
  ) {
    fail("wakeflow-business-archive-evidence-closure", "one immutable evidence identity must be committed exactly once");
  }
  return tuples.sort((left, right) => lexicalCompare(left.ref, right.ref));
}

function artifactLifecycle(loaded, identity) {
  if (identity.artifactKind === "wakeflow-pod-design-request") {
    return loaded.state.pod?.designRequest?.podDesignRequestId === identity.artifactId
      ? "current"
      : "historical";
  }
  if (identity.artifactKind === "wakeflow-pod-design-handoff") {
    return loaded.state.pod?.designHandoff?.podDesignHandoffId === identity.artifactId
      ? "current"
      : "historical";
  }
  if (identity.artifactKind === "wakeflow-task-package") {
    return loaded.state.taskPackages.find((entry) => entry.taskPackageId === identity.artifactId)?.lifecycleStatus ?? "unknown";
  }
  if (identity.artifactKind === "wakeflow-target-result") {
    return loaded.state.targetResults.find((entry) => entry.targetResultId === identity.artifactId)?.lifecycleStatus ?? "unknown";
  }
  if (identity.artifactKind === "wakeflow-test-card") {
    return loaded.state.testCards.find((entry) => entry.testCardId === identity.artifactId)?.lifecycleStatus ?? "unknown";
  }
  return loaded.state.review.pendingCandidate?.reviewCandidateId === identity.artifactId ? "pending" : "historical";
}

function testCardTaskAuthorityIsExact(state, record) {
  const stateCard = state.testCards.find((entry) => entry.testCardId === record.testCardId);
  const task = state.targetTasks.find((entry) => entry.targetTaskId === record.targetTaskId);
  if (!stateCard) return false;
  if (!task) return state.state === "cancelled";
  return Boolean(
    task.testCard
    && task.testCard.testCardId === record.testCardId
    && task.testCard.ref === stateCard.ref
    && task.testCard.digest === stateCard.digest
    && task.windowId === record.windowId
  );
}

function assertTerminalClosure(loaded, resultAuthority, expectedPrevious) {
  const terminal = loaded.state.state;
  if (!["completed", "cancelled"].includes(terminal)) {
    fail("wakeflow-business-archive-terminal", "business archive requires completed or cancelled state");
  }
  const lifecycle = assertTerminalLifecycleEventChain(loaded.events, terminal, {
    archived: false,
  });
  if (
    loaded.state.revision !== expectedPrevious.revision
    || loaded.digests.state !== expectedPrevious.stateDigest
  ) {
    fail("wakeflow-business-archive-terminal", "terminal expected previous state is not exact");
  }
  if (
    loaded.demand.executionPlacement.mode === "main"
    && lifecycle.index !== loaded.events.length - 1
  ) {
    fail("wakeflow-business-archive-terminal", "main placement requires its terminal lifecycle event at the source tail");
  }
  if (
    loaded.state.review.status !== "idle"
    || Object.hasOwn(loaded.state.review, "pendingCandidate")
    || loaded.state.review.readyTargetTaskIds.length !== 0
    || loaded.state.review.blockedTargetTaskIds.length !== 0
    || loaded.state.review.missingTargetTaskIds.length !== 0
    || resultAuthority.review.pending !== null
    || resultAuthority.review.current.ready.length !== 0
    || resultAuthority.review.current.blocked.length !== 0
    || resultAuthority.review.current.missing.length !== 0
  ) {
    fail("wakeflow-business-archive-review", "terminal archive requires an idle and empty review boundary");
  }
  if (loaded.state.taskPackages.some((entry) => !["closed", "superseded"].includes(entry.lifecycleStatus))) {
    fail("wakeflow-business-archive-lifecycle", "terminal archive contains an open task package");
  }
  if (loaded.state.testCards.some((entry) => !["closed", "superseded"].includes(entry.lifecycleStatus))) {
    fail("wakeflow-business-archive-lifecycle", "terminal archive contains an open Test card");
  }
  const artifactById = new Map(resultAuthority.artifacts.map((entry) => [entry.targetResultId, entry]));
  for (const task of loaded.state.targetTasks) {
    if (!["accepted", "cancelled", "superseded"].includes(task.lifecycleStatus)) {
      fail("wakeflow-business-archive-lifecycle", "terminal archive contains an open target task");
    }
    if (task.lifecycleStatus === "accepted") {
      const selected = task.currentResult ? artifactById.get(task.currentResult.targetResultId) : null;
      if (
        !selected
        || selected.ref !== task.currentResult.ref
        || selected.digest !== task.currentResult.digest
        || selected.record.outcome === "blocked"
      ) {
        fail("wakeflow-business-archive-lifecycle", "accepted target task lacks one exact nonblocked current result");
      }
    }
  }
  const closed = [...resultAuthority.review.current.closed].sort(lexicalCompare);
  const tasks = loaded.state.targetTasks.map((entry) => entry.targetTaskId).sort(lexicalCompare);
  if (closed.length !== tasks.length || closed.some((id, index) => id !== tasks[index])) {
    fail("wakeflow-business-archive-lifecycle", "T07 closed target set differs from terminal state");
  }
}

function assertTerminalLifecycleEventChain(events, terminal, { archived }) {
  const expectedCommand = terminal === "completed" ? "complete-demand" : "cancel-demand";
  const matches = events.map((event, index) => ({ event, index })).filter(({ event }) => (
    event.actor === "controller"
    && event.command === expectedCommand
    && event.type === `demand.${terminal}`
    && event.to === terminal
  ));
  if (matches.length !== 1) {
    fail(
      archived ? "wakeflow-business-archive-archive-invalid" : "wakeflow-business-archive-terminal",
      "terminal lifecycle history must contain one exact completion or cancellation event",
    );
  }
  const lifecycle = matches[0];
  for (const event of events.slice(lifecycle.index + 1)) {
    if (
      event.actor !== "controller"
      || !["plan-pod-close", "record-pod-close"].includes(event.command)
      || !["pod.close-planned", "pod.close-recorded"].includes(event.type)
      || event.from !== terminal
      || event.to !== terminal
      || !event.podTransition
      || !["plan-close", "settle-close"].includes(event.podTransition.action)
    ) {
      fail(
        archived ? "wakeflow-business-archive-archive-invalid" : "wakeflow-business-archive-terminal",
        "only exact Pod close events may follow terminal lifecycle settlement",
      );
    }
  }
  return lifecycle;
}

function assertPodArchiveGate(context, loaded) {
  if (loaded.demand.executionPlacement.mode === "main") {
    if (loaded.state.pod) {
      fail("wakeflow-business-archive-placement", "main placement cannot carry Pod close authority");
    }
    return;
  }
  let inspection;
  try {
    inspection = inspectPodCloseFromLoadedWhileLocked({
      workspaceRoot: context.workspaceRoot,
      stateRoot: context.stateRoot,
      expectedProgramId: loaded.demand.programId,
      loaded,
    });
  } catch (cause) {
    fail(
      "wakeflow-business-archive-pod-close",
      "isolated Pod close authority is unavailable",
      {},
      cause,
    );
  }
  if (
    inspection.status !== "closed"
    || inspection.authorityEligible !== true
    || inspection.archiveEligible !== true
  ) {
    fail("wakeflow-business-archive-pod-close", "isolated business archive requires exact acknowledged Pod close authority");
  }
}

function archiveEventAndState(context, loaded, values) {
  if (Date.parse(values.archivedAt) < Date.parse(loaded.events.at(-1).createdAt)) {
    fail("wakeflow-business-archive-input-timestamp", "archivedAt cannot precede the terminal event");
  }
  const archiveEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: values.archiveEventId,
    demandId: values.demandId,
    createdAt: values.archivedAt,
    actor: "controller",
    command: "archive-demand",
    type: "demand.archived",
    previousRevision: loaded.state.revision,
    nextRevision: loaded.state.revision + 1,
    from: loaded.state.state,
    to: "archived",
    reason: values.archiveReason,
    decisionSummary: values.conclusion,
    changedArtifacts: [],
  };
  const archivedState = structuredClone(loaded.state);
  archivedState.revision = archiveEvent.nextRevision;
  archivedState.state = "archived";
  archivedState.stateReason = archiveEvent.reason;
  archivedState.updatedAt = archiveEvent.createdAt;
  archivedState.lastEvent = {
    eventId: archiveEvent.eventId,
    eventDigest: canonicalJsonDigest(archiveEvent),
  };
  const stack = validateDemandCoreStack({
    demand: loaded.demand,
    authority: loaded.authority,
    state: archivedState,
    events: [...loaded.events, archiveEvent],
    ledgerRoot: context.ledgerRoot,
  });
  return Object.freeze({
    archiveEvent: stack.events.at(-1),
    archivedState: stack.state,
    events: stack.events,
  });
}

function assertTodoHistoryMatchesDemand(context, loaded, history) {
  const source = loaded.demand.source;
  if (source.artifactKind === "wakeflow-demand-ledger-source") {
    if (history !== null) {
      fail("wakeflow-business-archive-todo", "ledger-backed archive cannot contain TODO history");
    }
    return;
  }
  if (history === null) {
    fail("wakeflow-business-archive-todo", "TODO-backed archive requires exact TODO history");
  }
  const expectedMount = {
    demandId: loaded.demand.demandId,
    identityDigest: loaded.digests.demand,
    stateRootRef: context.stateRef,
  };
  if (
    history.archiveId !== context.values.archiveId
    || history.programId !== loaded.demand.programId
    || history.demandId !== loaded.demand.demandId
    || history.boardRef !== source.boardRef
    || history.todoId !== source.todoId
    || canonicalJson(history.lineageRef) !== canonicalJson(source)
    || history.intakeRow.rowDigest !== source.intakeRowDigest
    || canonicalJson(history.mount) !== canonicalJson(expectedMount)
  ) {
    fail("wakeflow-business-archive-todo", "TODO history differs from the immutable demand lineage");
  }
}

function todoHistoryForLoaded(context, loaded, override = undefined, { verifyLive = true } = {}) {
  const source = loaded.demand.source;
  if (source.artifactKind === "wakeflow-demand-ledger-source") {
    if (override !== undefined && override !== null) {
      fail("wakeflow-business-archive-todo", "ledger-backed archive cannot contain TODO history");
    }
    return null;
  }
  const admitted = override === undefined ? null : validateBusinessArchiveTodoHistory(override);
  if (admitted) assertTodoHistoryMatchesDemand(context, loaded, admitted);
  if (!verifyLive) {
    if (!admitted) fail("wakeflow-business-archive-todo", "TODO recovery requires journaled history");
    return admitted;
  }
  const mount = {
    demandId: loaded.demand.demandId,
    identityDigest: loaded.digests.demand,
    stateRootRef: context.stateRef,
  };
  const inspection = inspectTodoArchiveLineage({
    root: context.workspaceRoot,
    boardPath: context.todoBoard,
    todoId: source.todoId,
    intakeRowDigest: source.intakeRowDigest,
    mount,
  });
  const live = validateBusinessArchiveTodoHistory({
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-todo-history",
    archiveId: context.values.archiveId,
    programId: loaded.demand.programId,
    demandId: loaded.demand.demandId,
    boardRef: source.boardRef,
    todoId: source.todoId,
    lineageRef: inspection.lineageRef,
    mount,
    intakeRow: inspection.pending.snapshot,
    claimedRow: inspection.claimed.snapshot,
  });
  assertTodoHistoryMatchesDemand(context, loaded, live);
  if (admitted && canonicalJson(admitted) !== canonicalJson(live)) {
    fail("wakeflow-business-archive-conflict", "journaled TODO history differs from the current claimed lineage");
  }
  return live;
}

function projectTransportSummary(inventory) {
  const groups = inventory.entries.groups.map(({ ref, digest, record }) => ({
    groupId: record.groupId,
    ref,
    digest,
    stateRevision: record.stateRevision,
    controllerWindowId: record.controllerWindowId,
    members: record.members,
    returnPolicy: record.returnPolicy,
    createdAt: record.createdAt,
  }));
  const packets = inventory.entries.packets.map(({ ref, digest, record }) => ({
    packetId: record.packetId,
    ref,
    digest,
    groupId: record.groupId,
    groupRef: record.groupRef,
    groupDigest: record.groupDigest,
    windowId: record.windowId,
    targetTaskId: record.targetTaskId,
    taskPackage: {
      taskPackageId: record.taskPackageId,
      ref: record.taskPackageRef,
      digest: record.taskPackageDigest,
    },
    workType: record.taskBriefing.workType,
    ...(record.testContract ? { testCard: record.testContract.testCard } : {}),
    createdAt: record.createdAt,
  }));
  const envelopes = inventory.entries.envelopes.map(({ ref, digest, record }) => ({
    artifactKind: record.artifactKind,
    deliveryId: record.deliveryId,
    ref,
    digest,
    group: {
      id: record.groupId,
      ref: record.groupRef,
      digest: record.groupDigest,
    },
    ...(record.packetId ? {
      packet: {
        id: record.packetId,
        ref: record.packetRef,
        digest: record.packetDigest,
      },
    } : {
      resultSetDigest: record.resultSetDigest,
      reviewSnapshotDigest: record.reviewSnapshotDigest,
    }),
    preparedByHostId: record.preparedByHostId,
    windowId: record.windowId,
    correlationId: record.correlationId,
    createdAt: record.createdAt,
  }));
  const runs = inventory.entries.runs.map(({ ref, digest, record }) => ({
    runId: record.runId,
    ref,
    digest,
    deliveryId: record.deliveryId,
    envelopeRef: record.envelopeRef,
    envelopeDigest: record.envelopeDigest,
    hostId: record.hostId,
    windowId: record.windowId,
    attemptOrdinal: record.attemptOrdinal,
    ...(record.previousRun ? { previousRun: record.previousRun } : {}),
    hostMethod: record.hostMethod,
    hostMode: record.hostMode,
    transportStatus: record.transportStatus,
    readback: record.readback,
    ...(record.observedLease ? { observedLease: record.observedLease } : {}),
    ...(record.error ? { errorCode: record.error.code } : {}),
    createdAt: record.createdAt,
  }));
  return validateBusinessArchiveTransportSummary({
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-transport-summary",
    programId: inventory.programId,
    demandId: inventory.demandId,
    sourceStatus: inventory.status,
    inventoryDigest: inventory.inventoryDigest,
    groups,
    packets,
    envelopes,
    runs,
  });
}

function assertTransportTuple(entry, tuple, idField, label) {
  if (
    !entry
    || entry[idField] !== tuple.id
    || entry.ref !== tuple.ref
    || entry.digest !== tuple.digest
  ) {
    fail("wakeflow-business-archive-transport-closure", `${label} differs from strict T06 authority`);
  }
}

function assertArchivedTransportCrossClosure(loaded, artifacts, transportSummary) {
  const groups = new Map(transportSummary.groups.map((entry) => [entry.groupId, entry]));
  const packets = new Map(transportSummary.packets.map((entry) => [entry.packetId, entry]));
  const envelopes = new Map(transportSummary.envelopes.map((entry) => [entry.deliveryId, entry]));
  const runs = new Map(transportSummary.runs.map((entry) => [entry.runId, entry]));
  for (const artifact of artifacts) {
    if (artifact.identity.artifactKind !== "wakeflow-target-result") continue;
    assertTransportTuple(
      groups.get(artifact.record.transport.group.id),
      artifact.record.transport.group,
      "groupId",
      "TargetResult group",
    );
    assertTransportTuple(
      envelopes.get(artifact.record.transport.envelope.id),
      artifact.record.transport.envelope,
      "deliveryId",
      "TargetResult envelope",
    );
  }
  const assertStateGroup = (tuple, label) => assertTransportTuple(
    groups.get(tuple.groupId),
    { id: tuple.groupId, ref: tuple.ref, digest: tuple.digest },
    "groupId",
    label,
  );
  const assertStatePacket = (tuple, label) => assertTransportTuple(
    packets.get(tuple.packetId),
    { id: tuple.packetId, ref: tuple.ref, digest: tuple.digest },
    "packetId",
    label,
  );
  const assertStateEnvelope = (tuple, label) => assertTransportTuple(
    envelopes.get(tuple.deliveryId),
    { id: tuple.deliveryId, ref: tuple.ref, digest: tuple.digest },
    "deliveryId",
    label,
  );
  const assertStateRun = (tuple, label) => {
    const entry = runs.get(tuple.runId);
    if (
      !entry
      || entry.ref !== tuple.ref
      || entry.digest !== tuple.digest
      || entry.attemptOrdinal !== tuple.attemptOrdinal
      || entry.transportStatus !== tuple.transportStatus
      || entry.readback.status !== tuple.readbackStatus
    ) {
      fail("wakeflow-business-archive-transport-closure", `${label} differs from strict T06 authority`);
    }
  };
  for (const task of loaded.state.targetTasks) {
    if (task.currentDelivery) {
      assertStateGroup(task.currentDelivery.group, "state currentDelivery group");
      assertStatePacket(task.currentDelivery.packet, "state currentDelivery packet");
      assertStateEnvelope(task.currentDelivery.envelope, "state currentDelivery envelope");
      if (task.currentDelivery.latestRun) {
        assertStateRun(task.currentDelivery.latestRun, "state currentDelivery run");
      }
    }
    for (const attempt of task.testAttempts ?? []) {
      for (const authorization of attempt.deliveryAuthorizations) {
        assertStateGroup(authorization.group, "Test attempt group");
        assertStatePacket(authorization.packet, "Test attempt packet");
        assertStateEnvelope(authorization.envelope, "Test attempt envelope");
        if (authorization.replacesRun) assertStateRun(authorization.replacesRun, "Test replacement run");
      }
    }
  }
  for (const event of loaded.events) {
    if (event.deliveryTransition) {
      const envelope = envelopes.get(event.deliveryTransition.deliveryId);
      if (!envelope || envelope.digest !== event.deliveryTransition.envelopeDigest) {
        fail("wakeflow-business-archive-transport-closure", "delivery event envelope differs from strict T06 authority");
      }
      if (event.deliveryTransition.run) {
        assertStateRun(event.deliveryTransition.run, "delivery event run");
      }
    }
    if (event.reviewDecision) {
      assertStateGroup(event.reviewDecision.group, "review decision group");
    }
  }
}

/**
 * 从同一持锁 core stack 组合 artifact、evidence、TargetResult、transport、Pod close 与 TODO 权威。
 */
function buildPortableClosure(context, loaded, todoOverride = undefined, { verifyTodoLive = true } = {}) {
  const expectedArtifacts = expectedArtifactTuples(loaded.events);
  const artifactInventory = inspectDemandArtifactInventory({
    stateRoot: context.stateRoot,
    expectedProgramId: loaded.demand.programId,
    expectedDemandId: loaded.demand.demandId,
    expectedArtifacts,
  });
  if (artifactInventory.issues.length !== 0) {
    fail("wakeflow-business-archive-artifact-closure", "T05 artifact inventory is not exactly closed");
  }
  const artifacts = expectedArtifacts.map((expected) => {
    const loadedArtifact = loadDemandArtifactByRef({
      stateRoot: context.stateRoot,
      ref: expected.ref,
      digest: expected.digest,
      expectedArtifactKind: expected.artifactKind,
      expectedArtifactId: expected.artifactId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
    });
    return Object.freeze({ ...loadedArtifact, lifecycleStatus: artifactLifecycle(loaded, expected) });
  });
  for (const artifact of artifacts) {
    if (
      artifact.identity.artifactKind === "wakeflow-test-card"
      && !testCardTaskAuthorityIsExact(loaded.state, artifact.record)
    ) {
      fail(
        "wakeflow-business-archive-artifact-closure",
        "Test card differs from its terminal target task authority",
      );
    }
  }

  const expectedEvidence = expectedEvidenceTuples(loaded.events);
  const evidenceInventory = inspectManagedEvidenceInventory({
    stateRoot: context.stateRoot,
    expectedProgramId: loaded.demand.programId,
    expectedDemandId: loaded.demand.demandId,
    expectedDemandDigest: loaded.digests.demand,
    expectedEvidence,
  });
  if (evidenceInventory.issues.length !== 0) {
    fail("wakeflow-business-archive-evidence-closure", "T06 evidence inventory is not exactly closed");
  }
  const evidence = expectedEvidence.map((expected) => {
    const loadedEvidence = loadManagedEvidenceByRef({
      stateRoot: context.stateRoot,
      ref: expected.ref,
      digest: expected.digest,
      expectedEvidenceId: expected.artifactId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
      expectedDemandDigest: loaded.digests.demand,
    });
    const members = loadManagedEvidencePortableMembers({
      stateRoot: context.stateRoot,
      ref: expected.ref,
      digest: expected.digest,
      expectedEvidenceId: expected.artifactId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
      expectedDemandDigest: loaded.digests.demand,
    });
    return Object.freeze({ loaded: loadedEvidence, members });
  });

  const resultAuthority = buildTargetResultAuthoritySnapshotFromLoaded(loaded);
  assertTerminalClosure(loaded, resultAuthority, context.values.expectedPrevious);
  assertPodArchiveGate(context, loaded);
  const todoHistory = todoHistoryForLoaded(context, loaded, todoOverride, { verifyLive: verifyTodoLive });
  const transportSummary = projectTransportSummary(inspectTransportDemandAuthority({
    workspaceRoot: context.workspaceRoot,
    programId: loaded.demand.programId,
    demandId: loaded.demand.demandId,
  }));
  assertArchivedTransportCrossClosure(loaded, artifacts, transportSummary);
  return Object.freeze({ artifacts, evidence, resultAuthority, todoHistory, transportSummary });
}

function evidenceMediaType(evidenceRecord, sourceRef) {
  if (sourceRef === evidenceRecord.ref) return "application/json";
  const relative = sourceRef.slice(`${path.posix.dirname(evidenceRecord.ref)}/`.length);
  return evidenceRecord.manifest.payload?.files.find((entry) => entry.path === relative)?.contentClass
    ?? "application/octet-stream";
}

function addMember(memberContents, members, { role = "payload", path: memberPath, mediaType, bytes }) {
  if (memberContents.has(memberPath)) {
    fail("wakeflow-business-archive-member-closure", "archive member path is duplicated");
  }
  const content = Buffer.from(bytes);
  memberContents.set(memberPath, content);
  members.push({ role, path: memberPath, mediaType, digest: prefixedDigest(content) });
}

function buildPlanAndMembers(context, loaded, closure) {
  const transition = archiveEventAndState(context, loaded, context.values);
  const memberContents = new Map();
  const members = [];
  const core = [];
  const addCore = ({ role, sourceRef, sourceDigest, sourceBytes, memberRef, memberBytes, mediaType }) => {
    addMember(memberContents, members, { path: memberRef, mediaType, bytes: memberBytes });
    core.push({
      role,
      sourceRef,
      sourceDigest,
      sourceByteDigest: prefixedDigest(sourceBytes),
      memberRef,
      memberDigest: prefixedDigest(memberBytes),
      mediaType,
    });
  };
  addCore({
    role: "demand",
    sourceRef: "demand.json",
    sourceDigest: loaded.digests.demand,
    sourceBytes: loaded.bytes.demand,
    memberRef: "payload/demand.json",
    memberBytes: loaded.bytes.demand,
    mediaType: "application/json",
  });
  if (loaded.authority) {
    addCore({
      role: "authority",
      sourceRef: "demand-authority.json",
      sourceDigest: loaded.digests.authority,
      sourceBytes: loaded.bytes.authority,
      memberRef: "payload/demand-authority.json",
      memberBytes: loaded.bytes.authority,
      mediaType: "application/json",
    });
  }
  const archivedStateBytes = Buffer.from(`${canonicalJson(transition.archivedState)}\n`, "utf8");
  addCore({
    role: "state",
    sourceRef: "wakeflow-state.json",
    sourceDigest: loaded.digests.state,
    sourceBytes: loaded.bytes.state,
    memberRef: "payload/wakeflow-state.json",
    memberBytes: archivedStateBytes,
    mediaType: "application/json",
  });
  const archivedEventsBytes = Buffer.from(`${transition.events.map((event) => canonicalJson(event)).join("\n")}\n`, "utf8");
  addCore({
    role: "events",
    sourceRef: "controller-events.jsonl",
    sourceDigest: loaded.digests.lastEvent,
    sourceBytes: loaded.bytes.events,
    memberRef: "payload/controller-events.jsonl",
    memberBytes: archivedEventsBytes,
    mediaType: "application/x-ndjson",
  });
  core.sort((left, right) => lexicalCompare(left.memberRef, right.memberRef));

  const artifactSummaries = closure.artifacts.map((artifact) => {
    const memberRef = `payload/${artifact.ref}`;
    addMember(memberContents, members, {
      path: memberRef,
      mediaType: "application/json",
      bytes: artifact.bytes,
    });
    return {
      artifactKind: artifact.identity.artifactKind,
      artifactId: artifact.identity.artifactId,
      ref: artifact.ref,
      digest: artifact.identity.digest,
      memberRef,
      memberDigest: artifact.byteDigest,
      lifecycleStatus: artifact.lifecycleStatus,
    };
  }).sort((left, right) => lexicalCompare(left.memberRef, right.memberRef));

  const evidenceSummaries = closure.evidence.map((evidence) => {
    const memberRefs = evidence.members.map((member) => {
      const memberRef = `payload/${member.ref}`;
      addMember(memberContents, members, {
        path: memberRef,
        mediaType: evidenceMediaType(evidence.loaded, member.ref),
        bytes: member.bytes,
      });
      return { ref: memberRef, digest: member.byteDigest };
    }).sort((left, right) => lexicalCompare(left.ref, right.ref));
    return {
      evidenceId: evidence.loaded.identity.artifactId,
      ref: evidence.loaded.ref,
      digest: evidence.loaded.identity.digest,
      memberRefs,
    };
  }).sort((left, right) => lexicalCompare(left.evidenceId, right.evidenceId));

  const selectedResults = loaded.state.targetTasks.filter((task) => task.currentResult).map((task) => {
    const artifact = closure.resultAuthority.artifacts.find((entry) => entry.targetResultId === task.currentResult.targetResultId);
    if (!artifact) fail("wakeflow-business-archive-result-closure", "selected result is missing from T07 authority");
    return {
      targetTaskId: task.targetTaskId,
      targetResultId: artifact.targetResultId,
      ref: artifact.ref,
      digest: artifact.digest,
      outcome: artifact.record.outcome,
    };
  }).sort((left, right) => lexicalCompare(left.targetTaskId, right.targetTaskId));

  const todoSummary = closure.todoHistory === null ? null : {
    todoId: closure.todoHistory.todoId,
    lineageRef: closure.todoHistory.lineageRef,
    intakeRowDigest: closure.todoHistory.intakeRow.rowDigest,
    claimedRowDigest: closure.todoHistory.claimedRow.rowDigest,
    memberRef: TODO_HISTORY_REF,
  };
  if (closure.todoHistory) {
    addMember(memberContents, members, {
      role: "todo-history",
      path: TODO_HISTORY_REF,
      mediaType: "application/json",
      bytes: businessArchiveCanonicalBytes(closure.todoHistory),
    });
  }

  const transportSummaryBytes = businessArchiveCanonicalBytes(closure.transportSummary);
  const transportSummaryByteDigest = prefixedDigest(transportSummaryBytes);
  addMember(memberContents, members, {
    role: "transport-summary",
    path: TRANSPORT_SUMMARY_REF,
    mediaType: "application/json",
    bytes: transportSummaryBytes,
  });

  const businessSummary = validateBusinessArchiveSummary({
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-summary",
    archiveId: context.values.archiveId,
    programId: loaded.demand.programId,
    demandId: loaded.demand.demandId,
    archivedAt: context.values.archivedAt,
    conclusion: context.values.conclusion,
    terminalAdmission: {
      state: loaded.state.state,
      revision: loaded.state.revision,
      stateDigest: loaded.digests.state,
      eventId: loaded.state.lastEvent.eventId,
      eventDigest: loaded.state.lastEvent.eventDigest,
    },
    archiveTransition: {
      eventId: transition.archiveEvent.eventId,
      eventDigest: canonicalJsonDigest(transition.archiveEvent),
      previousRevision: transition.archiveEvent.previousRevision,
      nextRevision: transition.archiveEvent.nextRevision,
      from: transition.archiveEvent.from,
      to: transition.archiveEvent.to,
      createdAt: transition.archiveEvent.createdAt,
      reason: transition.archiveEvent.reason,
      stateDigest: canonicalJsonDigest(transition.archivedState),
    },
    core,
    artifacts: artifactSummaries,
    evidence: evidenceSummaries,
    resultAuthority: {
      stateRevision: closure.resultAuthority.state.revision,
      stateDigest: closure.resultAuthority.state.digest,
      eventId: closure.resultAuthority.state.eventId,
      eventDigest: closure.resultAuthority.state.eventDigest,
      currentResultSetDigest: closure.resultAuthority.review.current.resultSetDigest,
      selectedResults,
    },
    transport: {
      status: "archived",
      inventoryDigest: closure.transportSummary.inventoryDigest,
      memberRefs: [{ ref: TRANSPORT_SUMMARY_REF, digest: transportSummaryByteDigest }],
    },
    todo: todoSummary,
  });
  addMember(memberContents, members, {
    role: "summary",
    path: BUSINESS_SUMMARY_REF,
    mediaType: "application/json",
    bytes: businessArchiveCanonicalBytes(businessSummary),
  });
  members.sort((left, right) => lexicalCompare(left.path, right.path));
  const manifest = validateLedgerRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-archive-manifest",
    archiveId: context.values.archiveId,
    programId: loaded.demand.programId,
    archiveKind: "demand",
    yearMonth: context.values.archivedAt.slice(0, 7),
    title: loaded.demand.title,
    conclusion: context.values.conclusion,
    source: {
      kind: "demand",
      demandId: loaded.demand.demandId,
      demandRef: "payload/demand.json",
      demandDigest: prefixedDigest(loaded.bytes.demand),
    },
    transport: {
      status: "archived",
      inventoryDigest: closure.transportSummary.inventoryDigest,
      memberRefs: [{ ref: TRANSPORT_SUMMARY_REF, digest: transportSummaryByteDigest }],
    },
    members,
  }).record;
  const plan = validateBusinessArchivePlan({
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-plan",
    archiveEvent: transition.archiveEvent,
    archivedState: transition.archivedState,
    manifest,
    businessSummary,
    transportSummary: closure.transportSummary,
    todoHistory: closure.todoHistory,
  });
  return Object.freeze({ plan, memberContents });
}

function expectedSourceContract(loaded, closure) {
  const expectedFiles = new Set([
    "demand.json",
    "wakeflow-state.json",
    "controller-events.jsonl",
    "index.md",
    "developer-progress.md",
  ]);
  if (loaded.authority) expectedFiles.add("demand-authority.json");
  for (const artifact of closure.artifacts) expectedFiles.add(artifact.ref);
  for (const evidence of closure.evidence) {
    for (const member of evidence.members) expectedFiles.add(member.ref);
  }
  const expectedDirectories = new Set(wakeflowDemandCapabilityRoots(loaded.demand.executionPlacement));
  for (const directory of [...expectedDirectories]) {
    for (const parent of parentRefs(`${directory}/.capability-leaf`)) {
      if (parent !== directory) expectedDirectories.add(parent);
    }
  }
  for (const file of expectedFiles) for (const parent of parentRefs(file)) expectedDirectories.add(parent);
  for (const evidence of closure.evidence) {
    const evidenceRoot = path.posix.dirname(evidence.loaded.ref);
    for (const directory of evidence.loaded.manifest.payload?.directories ?? []) {
      expectedDirectories.add(`${evidenceRoot}/${directory}`);
    }
  }
  return { expectedFiles, expectedDirectories };
}

/**
 * 在任何归档写入前完成业务闭包、源树、隐私和可恢复容量准入，生成唯一事务字节。
 */
function collectFreshPlanWhileLocked(
  context,
  loaded,
  todoOverride = undefined,
  { sourceTreeOverride = null, verifyTodoLive = true } = {},
) {
  if (!["main", "isolated"].includes(loaded.demand.executionPlacement.mode)) {
    fail("wakeflow-business-archive-placement", "business archive placement mode is unsupported");
  }
  const closure = buildPortableClosure(context, loaded, todoOverride, { verifyTodoLive });
  const sourceTree = sourceTreeOverride ?? stableSourceTree(context.stateRoot);
  assertExpectedSourceTree(sourceTree, expectedSourceContract(loaded, closure));
  const built = buildPlanAndMembers(context, loaded, closure);
  const transaction = validateBusinessArchiveTransaction({
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-transaction",
    archiveId: context.values.archiveId,
    programId: loaded.demand.programId,
    demandId: loaded.demand.demandId,
    config: {
      ref: "wakeflow.config.json",
      digest: context.snapshot.configDigest,
      ledgerRootRef: context.ledgerRootRef,
    },
    sourceTree,
    plan: built.plan,
    planDigest: canonicalJsonDigest(built.plan),
  });
  const opaqueMembers = [];
  for (const evidence of closure.evidence) {
    for (const member of evidence.members) {
      if (member.ref !== evidence.loaded.ref) opaqueMembers.push({ ref: member.ref, bytes: member.bytes });
    }
  }
  assertBusinessArchivePortable({
    values: [
      loaded.demand,
      loaded.authority,
      loaded.state,
      loaded.events,
      ...closure.artifacts.map((entry) => entry.record),
      ...closure.evidence.map((entry) => entry.loaded.manifest),
      built.plan,
    ].filter(Boolean),
    opaqueMembers,
    forbiddenRoots: [context.workspaceRoot, context.ledgerRoot, os.homedir()],
  });
  const transactionBytes = businessArchiveCanonicalBytes(transaction);
  if (transactionBytes.length > MAX_ARCHIVE_TRANSACTION_BYTES) {
    fail(
      "wakeflow-business-archive-source-limit",
      "archive transaction exceeds the recoverable journal capacity",
      {
        maximumBytes: MAX_ARCHIVE_TRANSACTION_BYTES,
        actualBytes: transactionBytes.length,
      },
    );
  }
  return Object.freeze({
    transaction,
    transactionBytes,
    plan: built.plan,
    memberContents: built.memberContents,
    publicPlan: deepFreeze({
      schemaVersion: 1,
      kind: "WakeflowDemandBusinessArchivePlan",
      planDigest: transaction.planDigest,
      manifest: built.plan.manifest,
      businessSummary: built.plan.businessSummary,
      transportSummary: built.plan.transportSummary,
      todoHistory: built.plan.todoHistory,
    }),
  });
}

function contextFromTransaction(baseContext, transaction) {
  if (
    transaction.archiveId !== baseContext.values.archiveId
    || transaction.programId !== baseContext.values.expectedProgramId
    || transaction.demandId !== baseContext.values.demandId
    || transaction.config.ref !== "wakeflow.config.json"
    || transaction.config.digest !== baseContext.snapshot.configDigest
    || transaction.config.ledgerRootRef !== baseContext.ledgerRootRef
  ) {
    fail("wakeflow-business-archive-conflict", "archive transaction no longer matches canonical config or requested identity");
  }
  const summary = transaction.plan.businessSummary;
  return Object.freeze({
    ...baseContext,
    values: Object.freeze({
      workspaceRoot: baseContext.workspaceRoot,
      expectedProgramId: transaction.programId,
      demandId: transaction.demandId,
      archiveId: transaction.archiveId,
      archivedAt: summary.archivedAt,
      archiveEventId: summary.archiveTransition.eventId,
      archiveReason: summary.archiveTransition.reason,
      conclusion: summary.conclusion,
      expectedPrevious: Object.freeze({
        revision: summary.terminalAdmission.revision,
        stateDigest: summary.terminalAdmission.stateDigest,
      }),
    }),
  });
}

function assertCommitInputMatchesTransaction(values, transaction) {
  const summary = transaction.plan.businessSummary;
  if (
    values.archiveId !== transaction.archiveId
    || values.demandId !== transaction.demandId
    || values.expectedProgramId !== transaction.programId
    || values.archivedAt !== summary.archivedAt
    || values.archiveEventId !== summary.archiveTransition.eventId
    || values.archiveReason !== summary.archiveTransition.reason
    || values.conclusion !== summary.conclusion
    || values.expectedPrevious.revision !== summary.terminalAdmission.revision
    || values.expectedPrevious.stateDigest !== summary.terminalAdmission.stateDigest
  ) {
    fail("wakeflow-business-archive-conflict", "archive commit input differs from the immutable transaction");
  }
}

function rebuildFromJournalWhileLocked(context, loaded, transaction, { verifyTodoLive }) {
  const journalContext = contextFromTransaction(context, transaction);
  const sourceTree = assertSourceInventoryMatches(context.stateRoot, transaction, { journalRequired: true });
  const rebuilt = collectFreshPlanWhileLocked(
    journalContext,
    loaded,
    transaction.plan.todoHistory,
    { sourceTreeOverride: sourceTree, verifyTodoLive },
  );
  if (
    rebuilt.transaction.planDigest !== transaction.planDigest
    || canonicalJson(rebuilt.transaction.plan) !== canonicalJson(transaction.plan)
    || canonicalJson(rebuilt.transaction.sourceTree) !== canonicalJson(transaction.sourceTree)
  ) {
    fail("wakeflow-business-archive-conflict", "current source no longer reconstructs the journaled archive plan");
  }
  return Object.freeze({
    ...rebuilt,
    transaction,
    transactionBytes: businessArchiveCanonicalBytes(transaction),
  });
}

/**
 * 先 create-once 写入 exact archive.json，回读验证后才允许 ledger、TODO 和 current effect。
 */
function writeJournal(context, built) {
  const ancestors = inspectPrivateDirectoryChain(
    context.workspaceRoot,
    path.dirname(context.journal),
    "archive journal",
  );
  assertPrivateAncestorChain(ancestors, "archive journal ancestor");
  atomicWriteFile({
    root: context.stateRoot,
    target: context.journal,
    content: built.transactionBytes,
    expectation: { type: "absent" },
    mode: 0o600,
    label: "business archive transaction journal",
  });
  assertPrivateAncestorChain(ancestors, "archive journal ancestor");
  const loaded = loadDemandArchiveRecoveryRecordsWhileLocked({
    stateRoot: context.stateRoot,
    expectedProgramId: context.values.expectedProgramId,
    ledgerRoot: context.ledgerRoot,
  });
  const journal = validateBusinessArchiveTransaction(loaded.journal);
  if (!loaded.bytes.journal.equals(built.transactionBytes) || canonicalJson(journal) !== canonicalJson(built.transaction)) {
    fail("wakeflow-business-archive-recovery", "archive journal did not commit the exact plan");
  }
  return loaded;
}

function loadArchivedJsonMember(loadedArchive, ledgerRoot, memberPath) {
  const member = loadLedgerMemberBytes({
    ledgerRoot,
    root: loadedArchive.root,
    expectedFamily: "archive",
    expectedProgramId: loadedArchive.record.programId,
    memberPath,
  });
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(member.bytes));
  } catch (cause) {
    throw Object.assign(new Error("archived JSON member is invalid"), { code: "wakeflow-business-archive-archive-invalid", cause });
  }
  return Object.freeze({ value, bytes: member.bytes });
}

function loadArchivedEventsMember(loadedArchive, ledgerRoot) {
  const member = loadLedgerMemberBytes({
    ledgerRoot,
    root: loadedArchive.root,
    expectedFamily: "archive",
    expectedProgramId: loadedArchive.record.programId,
    memberPath: "payload/controller-events.jsonl",
  });
  const text = new TextDecoder("utf-8", { fatal: true }).decode(member.bytes);
  if (!text.endsWith("\n") || text.includes("\r") || text.slice(0, -1).split("\n").some((line) => !line)) {
    fail("wakeflow-business-archive-archive-invalid", "archived event history is not canonical JSONL");
  }
  const events = text.slice(0, -1).split("\n").map((line) => {
    const value = JSON.parse(line);
    if (canonicalJson(value) !== line) fail("wakeflow-business-archive-archive-invalid", "archived event line is not canonical");
    return value;
  });
  return Object.freeze({ events: deepFreeze(events), bytes: member.bytes });
}

function assertSameArchiveValue(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("wakeflow-business-archive-archive-invalid", `archived ${label} differs from its declared closure`);
  }
}

function reconstructTerminalStack({ context, demand, authority, archivedState, events }) {
  if (events.length < 2) {
    fail("wakeflow-business-archive-archive-invalid", "archived event history lacks its terminal predecessor");
  }
  const archiveEvent = events.at(-1);
  const sourceEvents = events.slice(0, -1);
  const terminalEvent = sourceEvents.at(-1);
  const terminalState = structuredClone(archivedState);
  terminalState.revision = archiveEvent.previousRevision;
  terminalState.state = archiveEvent.from;
  terminalState.stateReason = terminalEvent.reason;
  terminalState.updatedAt = terminalEvent.createdAt;
  terminalState.lastEvent = {
    eventId: terminalEvent.eventId,
    eventDigest: canonicalJsonDigest(terminalEvent),
  };
  return validateDemandCoreStack({
    demand,
    authority,
    state: terminalState,
    events: sourceEvents,
    ledgerRoot: context.ledgerRoot,
  });
}

function expectedArchivedCoreSummary({ terminal, archivedStateBytes, archivedEvents, demandBytes, authorityBytes }) {
  const entries = [];
  const add = ({ role, sourceRef, sourceDigest, sourceBytes, memberRef, memberBytes, mediaType }) => {
    entries.push({
      role,
      sourceRef,
      sourceDigest,
      sourceByteDigest: prefixedDigest(sourceBytes),
      memberRef,
      memberDigest: prefixedDigest(memberBytes),
      mediaType,
    });
  };
  add({
    role: "demand",
    sourceRef: "demand.json",
    sourceDigest: terminal.digests.demand,
    sourceBytes: demandBytes,
    memberRef: "payload/demand.json",
    memberBytes: demandBytes,
    mediaType: "application/json",
  });
  if (terminal.authority) {
    add({
      role: "authority",
      sourceRef: "demand-authority.json",
      sourceDigest: terminal.digests.authority,
      sourceBytes: authorityBytes,
      memberRef: "payload/demand-authority.json",
      memberBytes: authorityBytes,
      mediaType: "application/json",
    });
  }
  add({
    role: "state",
    sourceRef: "wakeflow-state.json",
    sourceDigest: terminal.digests.state,
    sourceBytes: demandCoreCanonicalBytes(terminal.state),
    memberRef: "payload/wakeflow-state.json",
    memberBytes: archivedStateBytes,
    mediaType: "application/json",
  });
  const sourceEventBytes = Buffer.from(`${terminal.events.map((event) => canonicalJson(event)).join("\n")}\n`, "utf8");
  add({
    role: "events",
    sourceRef: "controller-events.jsonl",
    sourceDigest: terminal.digests.lastEvent,
    sourceBytes: sourceEventBytes,
    memberRef: "payload/controller-events.jsonl",
    memberBytes: archivedEvents.bytes,
    mediaType: "application/x-ndjson",
  });
  return entries.sort((left, right) => lexicalCompare(left.memberRef, right.memberRef));
}

function loadArchivedArtifactClosure(context, loadedArchive, summary, terminal) {
  const expectedByRef = new Map(expectedArtifactTuples(terminal.events).map((entry) => [entry.ref, entry]));
  const records = new Map();
  const projected = summary.artifacts.map((entry) => {
    const member = loadArchivedJsonMember(loadedArchive, context.ledgerRoot, entry.memberRef);
    const record = validateDemandArtifactRecord(member.value);
    if (!member.bytes.equals(demandArtifactCanonicalBytes(record))) {
      fail("wakeflow-business-archive-archive-invalid", "archived demand artifact is not canonical");
    }
    const identity = demandArtifactIdentity(record);
    const eventIdentity = expectedByRef.get(identity.ref) ?? null;
    if (
      !eventIdentity
      || identity.artifactKind !== eventIdentity.artifactKind
      || identity.artifactId !== eventIdentity.artifactId
      || identity.digest !== eventIdentity.digest
      || record.programId !== terminal.demand.programId
      || record.demandId !== terminal.demand.demandId
      || record.demandDigest !== terminal.digests.demand
    ) {
      fail("wakeflow-business-archive-archive-invalid", "archived demand artifact is outside the terminal event closure");
    }
    records.set(identity.artifactId, record);
    expectedByRef.delete(identity.ref);
    return {
      artifactKind: identity.artifactKind,
      artifactId: identity.artifactId,
      ref: identity.ref,
      digest: identity.digest,
      memberRef: `payload/${identity.ref}`,
      memberDigest: prefixedDigest(member.bytes),
      lifecycleStatus: artifactLifecycle(terminal, identity),
    };
  }).sort((left, right) => lexicalCompare(left.memberRef, right.memberRef));
  if (expectedByRef.size !== 0) {
    fail("wakeflow-business-archive-archive-invalid", "archived demand artifact closure is incomplete");
  }
  assertSameArchiveValue(summary.artifacts, projected, "artifact summary");
  return records;
}

function loadArchivedEvidenceClosure(context, loadedArchive, summary, terminal, artifactRecords) {
  const expectedByRef = new Map(expectedEvidenceTuples(terminal.events).map((entry) => [entry.ref, entry]));
  const eventById = new Map(terminal.events.map((event, index) => [event.eventId, { event, index }]));
  const artifactCreationIndex = new Map();
  const evidenceCreationByRef = new Map();
  for (let index = 0; index < terminal.events.length; index += 1) {
    const event = terminal.events[index];
    for (const identity of event.changedArtifacts) {
      if (ARTIFACT_KINDS.has(identity.artifactKind)) artifactCreationIndex.set(identity.artifactId, index);
      if (identity.artifactKind === "wakeflow-evidence") {
        evidenceCreationByRef.set(identity.ref, { event, identity, index });
      }
    }
  }
  const manifests = [];
  const opaqueMembers = [];
  const projected = summary.evidence.map((entry) => {
    const manifestRef = `payload/${entry.ref}`;
    const member = loadArchivedJsonMember(loadedArchive, context.ledgerRoot, manifestRef);
    const manifest = validateEvidenceManifest(member.value);
    if (!member.bytes.equals(evidenceManifestCanonicalBytes(manifest))) {
      fail("wakeflow-business-archive-archive-invalid", "archived evidence manifest is not canonical");
    }
    const identity = evidenceIdentity(manifest);
    const eventIdentity = expectedByRef.get(identity.ref) ?? null;
    const creation = evidenceCreationByRef.get(identity.ref) ?? null;
    if (
      !eventIdentity
      || identity.artifactId !== eventIdentity.artifactId
      || identity.digest !== eventIdentity.digest
      || !creation
      || creation.event.actor !== "controller"
      || creation.event.command !== "record-evidence"
      || creation.event.type !== "evidence.recorded"
      || creation.event.createdAt !== manifest.capturedAt
      || creation.event.to !== creation.event.from
      || creation.event.changedArtifacts.length !== 1
      || canonicalJson(creation.identity) !== canonicalJson(identity)
      || manifest.programId !== terminal.demand.programId
      || manifest.demandId !== terminal.demand.demandId
      || manifest.demandDigest !== terminal.digests.demand
    ) {
      fail("wakeflow-business-archive-archive-invalid", "archived evidence is outside the terminal event closure");
    }
    expectedByRef.delete(identity.ref);
    for (const relation of manifest.relations) {
      if (relation.kind === "artifact") {
        const related = artifactRecords.get(relation.artifactId);
        const relatedIdentity = related ? demandArtifactIdentity(related) : null;
        if (
          !relatedIdentity
          || relatedIdentity.artifactKind !== relation.artifactKind
          || relatedIdentity.ref !== relation.ref
          || relatedIdentity.digest !== relation.digest
          || !Number.isInteger(artifactCreationIndex.get(relation.artifactId))
          || artifactCreationIndex.get(relation.artifactId) >= creation.index
        ) {
          fail("wakeflow-business-archive-archive-invalid", "archived evidence has a dangling artifact relation");
        }
      } else {
        const related = eventById.get(relation.eventId) ?? null;
        if (
          !related
          || related.index >= creation.index
          || canonicalJsonDigest(related.event) !== relation.digest
        ) {
          fail("wakeflow-business-archive-archive-invalid", "archived evidence has a dangling controller-event relation");
        }
      }
    }
    manifests.push(manifest);
    const rootRef = path.posix.dirname(identity.ref);
    const memberRefs = [{ ref: manifestRef, digest: prefixedDigest(member.bytes) }];
    for (const payload of manifest.payload?.files ?? []) {
      const archivedRef = `payload/${rootRef}/${payload.path}`;
      const archivedMember = loadLedgerMemberBytes({
        ledgerRoot: context.ledgerRoot,
        root: loadedArchive.root,
        expectedFamily: "archive",
        expectedProgramId: loadedArchive.record.programId,
        memberPath: archivedRef,
      });
      if (prefixedDigest(archivedMember.bytes) !== payload.digest) {
        fail("wakeflow-business-archive-archive-invalid", "archived evidence payload digest differs from its manifest");
      }
      memberRefs.push({ ref: archivedRef, digest: payload.digest });
      opaqueMembers.push({ ref: archivedRef, bytes: archivedMember.bytes });
    }
    memberRefs.sort((left, right) => lexicalCompare(left.ref, right.ref));
    return {
      evidenceId: identity.artifactId,
      ref: identity.ref,
      digest: identity.digest,
      memberRefs,
    };
  }).sort((left, right) => lexicalCompare(left.evidenceId, right.evidenceId));
  if (expectedByRef.size !== 0) {
    fail("wakeflow-business-archive-archive-invalid", "archived evidence closure is incomplete");
  }
  assertSameArchiveValue(summary.evidence, projected, "evidence summary");
  return { manifests, opaqueMembers };
}

function assertArchivedManifestClosure(
  loadedArchive,
  summary,
  transportSummary,
  todoHistory,
  evidenceClosure,
  demand,
) {
  const expected = [{
    role: "summary",
    path: BUSINESS_SUMMARY_REF,
    mediaType: "application/json",
    digest: prefixedDigest(businessArchiveCanonicalBytes(summary)),
  }, {
    role: "transport-summary",
    path: TRANSPORT_SUMMARY_REF,
    mediaType: "application/json",
    digest: prefixedDigest(businessArchiveCanonicalBytes(transportSummary)),
  }];
  if (todoHistory) {
    expected.push({
      role: "todo-history",
      path: TODO_HISTORY_REF,
      mediaType: "application/json",
      digest: prefixedDigest(businessArchiveCanonicalBytes(todoHistory)),
    });
  }
  for (const entry of summary.core) {
    expected.push({
      role: "payload",
      path: entry.memberRef,
      mediaType: entry.mediaType,
      digest: entry.memberDigest,
    });
  }
  for (const entry of summary.artifacts) {
    expected.push({
      role: "payload",
      path: entry.memberRef,
      mediaType: "application/json",
      digest: entry.memberDigest,
    });
  }
  const evidenceByRef = new Map(evidenceClosure.manifests.map((manifest) => {
    const identity = evidenceIdentity(manifest);
    return [identity.ref, { manifest, ref: identity.ref }];
  }));
  for (const entry of summary.evidence) {
    const evidence = evidenceByRef.get(entry.ref);
    if (!evidence) {
      fail("wakeflow-business-archive-archive-invalid", "archive manifest evidence declaration is unresolved");
    }
    for (const member of entry.memberRefs) {
      const sourceRef = member.ref.slice("payload/".length);
      expected.push({
        role: "payload",
        path: member.ref,
        mediaType: evidenceMediaType(evidence, sourceRef),
        digest: member.digest,
      });
    }
  }
  expected.sort((left, right) => lexicalCompare(left.path, right.path));
  if (
    loadedArchive.record.title !== demand.title
    || loadedArchive.record.conclusion !== summary.conclusion
    || canonicalJson(loadedArchive.record.transport) !== canonicalJson(summary.transport)
  ) {
    fail("wakeflow-business-archive-archive-invalid", "archive manifest business metadata differs from its demand summary");
  }
  assertSameArchiveValue(loadedArchive.record.members, expected, "manifest member contract");
}

function archivedObservedEvent(terminal, observed, creationIndex, label) {
  const event = terminal.events[observed.revision - 1];
  if (
    !event
    || observed.revision - 1 >= creationIndex
    || event.eventId !== observed.eventId
    || canonicalJsonDigest(event) !== observed.eventDigest
  ) {
    fail("wakeflow-business-archive-archive-invalid", `${label} does not bind one exact prior controller event`);
  }
  return event;
}

function archiveLedgerLocationForRef(ref) {
  const segments = ref.split("/");
  if (segments[0] === "requirement-designs" && segments.length >= 3) {
    return { family: "requirement", relativeRoot: segments.slice(0, 2).join("/"), memberPath: segments.slice(2).join("/") };
  }
  if (segments[0] === "goal-stage-confirmation" && segments.length >= 3) {
    return { family: "confirmation", relativeRoot: segments.slice(0, 2).join("/"), memberPath: segments.slice(2).join("/") };
  }
  return null;
}

function normalizedMarkdownAnchor(value) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(value ?? ""));
  } catch {
    return null;
  }
  return decoded
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replace(/[\s_]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function archivedMarkdownHasHeading(bytes, anchor) {
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  const expected = normalizedMarkdownAnchor(anchor);
  if (!expected) return false;
  return content
    .split(/\r?\n/u)
    .map((line) => line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/u)?.[1])
    .filter(Boolean)
    .map(normalizedMarkdownAnchor)
    .includes(expected);
}

function assertArchivedRequirementRefs(context, terminal, record) {
  for (const requirementRef of record.requirementRefs) {
    const authorityRef = terminal.authority?.authorityRefs.find((entry) => (
      entry.memberRef === requirementRef.ref
      && entry.memberDigest === requirementRef.digest
    ));
    const location = archiveLedgerLocationForRef(requirementRef.ref);
    if (!authorityRef || !location) {
      fail("wakeflow-business-archive-archive-invalid", "archived package requirement ref is outside frozen demand authority");
    }
    let resolved;
    try {
      resolved = loadLedgerMemberBytes({
        ledgerRoot: context.ledgerRoot,
        root: refPath(context.ledgerRoot, location.relativeRoot),
        expectedFamily: location.family,
        expectedProgramId: terminal.demand.programId,
        memberPath: location.memberPath,
      });
    } catch (cause) {
      fail(
        "wakeflow-business-archive-archive-invalid",
        "archived package requirement ref cannot be strict-loaded from its ledger authority",
        {},
        cause,
      );
    }
    if (
      resolved.member.digest !== requirementRef.digest
      || (resolved.loaded.family === "confirmation" && resolved.loaded.record.demandId !== terminal.demand.demandId)
      || (
        requirementRef.role !== "evidence"
        && (
          resolved.member.mediaType !== "text/markdown"
          || !archivedMarkdownHasHeading(resolved.bytes, requirementRef.anchor)
        )
      )
    ) {
      fail("wakeflow-business-archive-archive-invalid", "archived package requirement ref is not one exact authority member");
    }
  }
}

function assertArchivedResultCraftClosure(record, taskPackage, testCard) {
  const evidenceKinds = new Set(record.evidenceLocators.map((entry) => entry.kind));
  const evidenceTupleKeys = new Set(record.evidenceLocators.map((entry) => `${entry.ref}\u0000${entry.digest}`));
  const evidenceRefs = record.evidenceLocators.map((entry) => entry.ref);
  const acceptanceMappings = record.craftMapping.filter((entry) => entry.kind === "acceptance-anchor");
  const testStepMappings = record.craftMapping.filter((entry) => entry.kind === "test-step");
  if (
    new Set(evidenceRefs).size !== evidenceRefs.length
    || (record.outcome === "completed" && taskPackage.reviewInputContract.requiredKinds.some((kind) => !evidenceKinds.has(kind)))
    || acceptanceMappings.some((mapping) => mapping.evidenceRefs.some(
      (entry) => !evidenceTupleKeys.has(`${entry.ref}\u0000${entry.digest}`),
    ))
    || testStepMappings.some((mapping) => (
      record.evidenceLocators.filter((entry) => entry.ref === mapping.ref).length !== 1
    ))
  ) {
    fail("wakeflow-business-archive-archive-invalid", "archived TargetResult craft evidence closure is not exact");
  }
  if (taskPackage.workType === "test") {
    const approvedPlan = testCard?.executionContract.approvedPlan ?? [];
    const planIndices = testStepMappings.map((entry) => entry.planIndex);
    const sortedPlanIndices = [...planIndices].sort((left, right) => left - right);
    if (
      !testCard
      || acceptanceMappings.length !== 0
      || new Set(planIndices).size !== planIndices.length
      || planIndices.some((planIndex, index) => planIndex !== sortedPlanIndices[index])
      || testStepMappings.some((entry) => (
        entry.planIndex >= approvedPlan.length
        || entry.step !== approvedPlan[entry.planIndex]
      ))
      || (
        record.outcome === "completed"
        && (
          testStepMappings.length !== approvedPlan.length
          || approvedPlan.some((_step, planIndex) => !planIndices.includes(planIndex))
        )
      )
    ) {
      fail("wakeflow-business-archive-archive-invalid", "archived Test TargetResult does not close over its approved plan");
    }
    return;
  }
  const packageAnchorIds = new Set(taskPackage.acceptanceAnchors.map((entry) => entry.anchorId));
  const mappingAnchorIds = acceptanceMappings.map((entry) => entry.anchorId);
  const sortedMappingAnchorIds = [...mappingAnchorIds].sort(lexicalCompare);
  if (
    testStepMappings.length !== 0
    || new Set(mappingAnchorIds).size !== mappingAnchorIds.length
    || mappingAnchorIds.some((anchorId, index) => !packageAnchorIds.has(anchorId) || anchorId !== sortedMappingAnchorIds[index])
    || (
      record.outcome === "completed"
      && taskPackage.acceptanceAnchors.some((anchor) => !mappingAnchorIds.includes(anchor.anchorId))
    )
  ) {
    fail("wakeflow-business-archive-archive-invalid", "archived TargetResult does not close over its package acceptance anchors");
  }
}

/**
 * 从已发布成员重建六类 artifact 的 producer、event 与 state 语义，拒绝结构自洽的伪归档。
 */
function assertArchivedArtifactStateClosure(context, terminal, artifactRecords) {
  const contracts = [
    {
      artifactKind: "wakeflow-task-package",
      stateEntries: terminal.state.taskPackages,
      idField: "taskPackageId",
    },
    {
      artifactKind: "wakeflow-target-result",
      stateEntries: terminal.state.targetResults,
      idField: "targetResultId",
    },
    {
      artifactKind: "wakeflow-test-card",
      stateEntries: terminal.state.testCards,
      idField: "testCardId",
    },
  ];
  const changed = expectedArtifactTuples(terminal.events);
  const eventContract = new Map([
    ["wakeflow-pod-design-request", {
      commands: new Set(["record-pod-design-request"]),
      type: "pod.design-request-recorded",
      expectedTo: (event) => event.from,
      podAction: "record-design-request",
      podSelectorField: "podDesignRequestId",
    }],
    ["wakeflow-pod-design-handoff", {
      commands: new Set(["record-pod-design-handoff"]),
      type: "pod.design-handoff-recorded",
      expectedTo: (event) => event.from,
      podAction: "record-design-handoff",
      podSelectorField: "podDesignHandoffId",
    }],
    ["wakeflow-task-package", {
      commands: new Set(["create-task-package"]),
      type: "task-package.created",
      expectedTo: (event) => (["intake", "needs-rework", "completed"].includes(event.from) ? "planned" : event.from),
    }],
    ["wakeflow-target-result", {
      commands: new Set(["record-target-result-current", "record-target-result-historical"]),
      type: "target-result.recorded",
      expectedTo: (event) => event.from,
    }],
    ["wakeflow-review-candidate", {
      commands: new Set(["create-review-candidate"]),
      type: "review-candidate.created",
      expectedTo: () => "review-ready",
    }],
    ["wakeflow-test-card", {
      commands: new Set(["create-test-card"]),
      type: "test-card.created",
      expectedTo: (event) => event.from,
    }],
  ]);
  const creationById = new Map();
  for (let index = 0; index < terminal.events.length; index += 1) {
    const event = terminal.events[index];
    for (const identity of event.changedArtifacts.filter((entry) => ARTIFACT_KINDS.has(entry.artifactKind))) {
      creationById.set(identity.artifactId, { event, identity, index });
    }
  }
  for (const [artifactKind, selector, idField] of [
    ["wakeflow-pod-design-request", terminal.state.pod?.designRequest ?? null, "podDesignRequestId"],
    ["wakeflow-pod-design-handoff", terminal.state.pod?.designHandoff ?? null, "podDesignHandoffId"],
  ]) {
    const committed = changed.filter((entry) => entry.artifactKind === artifactKind);
    if (
      committed.length > 1
      || (committed.length === 0) !== (selector === null)
      || (selector !== null && (
        committed[0].artifactId !== selector[idField]
        || committed[0].ref !== selector.ref
        || committed[0].digest !== selector.digest
      ))
    ) {
      fail(
        "wakeflow-business-archive-archive-invalid",
        "archived Pod Design artifacts differ from the terminal Pod selectors",
      );
    }
  }
  for (const contract of contracts) {
    const committed = changed.filter((entry) => entry.artifactKind === contract.artifactKind);
    const stateById = new Map(contract.stateEntries.map((entry) => [entry[contract.idField], entry]));
    if (committed.length !== stateById.size) {
      fail("wakeflow-business-archive-archive-invalid", "archived artifact events and terminal state do not form one exact set");
    }
    for (const identity of committed) {
      const stateEntry = stateById.get(identity.artifactId);
      const record = artifactRecords.get(identity.artifactId);
      if (
        !stateEntry
        || !record
        || stateEntry.ref !== identity.ref
        || stateEntry.digest !== identity.digest
      ) {
        fail("wakeflow-business-archive-archive-invalid", "archived artifact state differs from its immutable event identity");
      }
    }
  }

  for (const [artifactId, record] of artifactRecords) {
    const creation = creationById.get(artifactId);
    const contract = eventContract.get(record.artifactKind);
    if (
      !creation
      || !contract
      || !contract.commands.has(creation.event.command)
      || creation.event.type !== contract.type
      || creation.event.createdAt !== record.createdAt
      || creation.event.actor !== "controller"
      || creation.event.to !== contract.expectedTo(creation.event)
      || creation.event.changedArtifacts.length !== 1
      || canonicalJson(creation.event.changedArtifacts[0]) !== canonicalJson(creation.identity)
      || (contract.podAction && (
        creation.event.podTransition?.action !== contract.podAction
        || creation.event.podTransition?.[contract.podSelectorField] !== artifactId
        || creation.event.podTransition.podId !== record.podId
      ))
    ) {
      fail("wakeflow-business-archive-archive-invalid", "archived artifact lacks its exact creation event contract");
    }
    if (record.demandDigest !== terminal.digests.demand) {
      fail("wakeflow-business-archive-archive-invalid", "archived artifact demand digest differs from demand authority");
    }
    if (record.artifactKind === "wakeflow-pod-design-request") {
      if (
        terminal.state.pod?.podId !== record.podId
        || record.demandType !== terminal.demand.demandType
        || record.originalGoal !== terminal.demand.goal
        || record.completionDefinition !== terminal.demand.completionDefinition
      ) {
        fail(
          "wakeflow-business-archive-archive-invalid",
          "archived Pod Design request differs from immutable demand and Pod authority",
        );
      }
      assertArchivedRequirementRefs(context, terminal, record);
    } else if (record.artifactKind === "wakeflow-pod-design-handoff") {
      const request = artifactRecords.get(record.designRequest.podDesignRequestId);
      const requestIdentity = request ? demandArtifactIdentity(request) : null;
      const requestCreation = requestIdentity ? creationById.get(requestIdentity.artifactId) : null;
      if (
        terminal.state.pod?.podId !== record.podId
        || requestIdentity?.artifactKind !== "wakeflow-pod-design-request"
        || requestIdentity.ref !== record.designRequest.ref
        || requestIdentity.digest !== record.designRequest.digest
        || !requestCreation
        || requestCreation.index >= creation.index
        || record.demandAuthority.ref !== "demand-authority.json"
        || record.demandAuthority.digest !== terminal.digests.authority
        || canonicalJson(record.requirementRefs) !== canonicalJson(request.requirementRefs)
        || canonicalJson(record.nonGoals) !== canonicalJson(request.nonGoals)
        || canonicalJson(record.testDecision) !== canonicalJson(terminal.authority?.testDecision)
      ) {
        fail(
          "wakeflow-business-archive-archive-invalid",
          "archived Pod Design handoff differs from request or frozen demand authority",
        );
      }
      assertArchivedRequirementRefs(context, terminal, record);
      for (const landing of record.landingPlan) {
        const repository = context.snapshot.indexes.repositoryById[landing.repositoryId] ?? null;
        const window = context.snapshot.indexes.windowById[landing.responsibilityWindowId] ?? null;
        if (
          repository === null
          || window?.role !== "product"
          || window.root.kind !== "repository"
          || window.root.repositoryId !== landing.repositoryId
        ) {
          fail(
            "wakeflow-business-archive-archive-invalid",
            "archived Pod Design landing differs from canonical config responsibility",
          );
        }
      }
    } else if (record.artifactKind === "wakeflow-task-package") {
      const task = terminal.state.targetTasks.find((entry) => entry.targetTaskId === record.targetTaskId);
      if (
        !task
        || task.taskPackageId !== artifactId
        || task.windowId !== record.windowId
        || (task.repositoryId ?? null) !== (record.repositoryId ?? null)
        || record.demandAuthorityDigest !== terminal.digests.authority
      ) {
        fail("wakeflow-business-archive-archive-invalid", "archived task package differs from its terminal assignment");
      }
      assertArchivedRequirementRefs(context, terminal, record);
      if (record.continuation) {
        const previous = artifactRecords.get(record.continuation.previousTaskPackageId);
        const previousIdentity = previous ? demandArtifactIdentity(previous) : null;
        if (
          previousIdentity?.artifactKind !== "wakeflow-task-package"
          || previousIdentity.ref !== record.continuation.ref
          || previousIdentity.digest !== record.continuation.digest
          || creationById.get(previousIdentity.artifactId)?.index >= creation.index
        ) {
          fail("wakeflow-business-archive-archive-invalid", "archived package continuation lineage is not exact");
        }
      }
      for (const dependencyId of record.dependsOnTargetTaskIds) {
        const dependencyTask = terminal.state.targetTasks.find((entry) => entry.targetTaskId === dependencyId);
        const dependencyPackage = dependencyTask ? artifactRecords.get(dependencyTask.taskPackageId) : null;
        const dependencyIdentity = dependencyPackage ? demandArtifactIdentity(dependencyPackage) : null;
        if (
          dependencyIdentity?.artifactKind !== "wakeflow-task-package"
          || dependencyPackage.targetTaskId !== dependencyId
          || !Number.isInteger(creationById.get(dependencyIdentity.artifactId)?.index)
          || creationById.get(dependencyIdentity.artifactId)?.index >= creation.index
        ) {
          fail("wakeflow-business-archive-archive-invalid", "archived package dependency lineage is not exact");
        }
      }
      if (record.replacesTargetTask) {
        const replacedTask = terminal.state.targetTasks.find((entry) => (
          entry.targetTaskId === record.replacesTargetTask.targetTaskId
        ));
        const replacedPackage = replacedTask ? artifactRecords.get(replacedTask.taskPackageId) : null;
        const replacedIdentity = replacedPackage ? demandArtifactIdentity(replacedPackage) : null;
        if (
          replacedIdentity?.artifactKind !== "wakeflow-task-package"
          || replacedIdentity.ref !== record.replacesTargetTask.taskPackageRef
          || replacedIdentity.digest !== record.replacesTargetTask.taskPackageDigest
          || creationById.get(replacedIdentity.artifactId)?.index >= creation.index
        ) {
          fail("wakeflow-business-archive-archive-invalid", "archived package replacement lineage is not exact");
        }
      }
    } else if (record.artifactKind === "wakeflow-target-result") {
      const stateResult = terminal.state.targetResults.find((entry) => entry.targetResultId === artifactId);
      const task = terminal.state.targetTasks.find((entry) => entry.targetTaskId === record.targetTaskId);
      const taskPackage = artifactRecords.get(record.taskPackage.taskPackageId);
      const taskPackageIdentity = taskPackage ? demandArtifactIdentity(taskPackage) : null;
      if (
        !stateResult
        || stateResult.targetTaskId !== record.targetTaskId
        || !task
        || task.taskPackageId !== record.taskPackage.taskPackageId
        || !taskPackageIdentity
        || taskPackageIdentity.ref !== record.taskPackage.ref
        || taskPackageIdentity.digest !== record.taskPackage.digest
        || !Number.isInteger(creationById.get(taskPackageIdentity.artifactId)?.index)
        || creationById.get(taskPackageIdentity.artifactId)?.index >= creation.index
        || task.windowId !== record.assignment.windowId
        || (task.repositoryId ?? null) !== (record.assignment.repositoryId ?? null)
      ) {
        fail("wakeflow-business-archive-archive-invalid", "archived target result differs from its terminal task authority");
      }
      archivedObservedEvent(terminal, record.observedState, creation.index, "archived TargetResult observed state");
      const testCard = taskPackage?.testCard
        ? artifactRecords.get(taskPackage.testCard.testCardId)
        : null;
      assertArchivedResultCraftClosure(record, taskPackage, testCard);
      const assignedRepositoryId = record.assignment.repositoryId ?? null;
      if (
        (assignedRepositoryId === null && record.repositoryChanges.length !== 0)
        || (
          assignedRepositoryId !== null
          && (
            record.repositoryChanges.length !== 1
            || record.repositoryChanges[0].repositoryId !== assignedRepositoryId
          )
        )
        || (
          record.outcome === "completed"
          && assignedRepositoryId !== null
          && (
            (taskPackage.commitExpectation === "commit" && record.repositoryChanges[0].disposition !== "committed")
            || (
              taskPackage.commitExpectation === "leave-uncommitted"
              && record.repositoryChanges[0].disposition === "committed"
            )
          )
        )
      ) {
        fail("wakeflow-business-archive-archive-invalid", "archived TargetResult repository disposition is not exact");
      }
      if (record.supersedes) {
        const previous = artifactRecords.get(record.supersedes.targetResultId);
        const previousIdentity = previous ? demandArtifactIdentity(previous) : null;
        if (
          previousIdentity?.artifactKind !== "wakeflow-target-result"
          || previous.targetTaskId !== record.targetTaskId
          || previousIdentity.ref !== record.supersedes.ref
          || previousIdentity.digest !== record.supersedes.digest
          || creationById.get(previousIdentity.artifactId)?.index >= creation.index
        ) {
          fail("wakeflow-business-archive-archive-invalid", "archived TargetResult supersedes lineage is not exact");
        }
      }
    } else if (record.artifactKind === "wakeflow-test-card") {
      const stateCard = terminal.state.testCards.find((entry) => entry.testCardId === artifactId);
      if (
        !stateCard
        || record.demandAuthorityRef !== "demand-authority.json"
        || record.demandAuthorityDigest !== terminal.digests.authority
        || terminal.authority?.testDecision.mode !== "real-environment"
        || record.executionContract.requirementGoal !== terminal.demand.goal
        || !terminal.authority.authorityRefs.some((entry) => (
          entry.memberRef === record.strategySource.ref
          && entry.memberDigest === record.strategySource.digest
        ))
        || record.observedState.revision !== creation.event.previousRevision
        || !testCardTaskAuthorityIsExact(terminal.state, record)
      ) {
        fail("wakeflow-business-archive-archive-invalid", "archived Test card differs from its terminal task authority");
      }
      archivedObservedEvent(terminal, record.observedState, creation.index, "archived Test card observed state");
    } else if (record.artifactKind === "wakeflow-review-candidate") {
      const previousEvent = terminal.events.find((event) => event.nextRevision === record.fromState.revision);
      const taskIds = new Set(terminal.state.targetTasks.map((entry) => entry.targetTaskId));
      if (
        creation.event.previousRevision !== record.fromState.revision
        || !previousEvent
        || previousEvent.eventId !== record.fromState.eventId
        || canonicalJsonDigest(previousEvent) !== record.fromState.eventDigest
        || [...record.reviewScope.targetTaskIds, ...record.reviewScope.excludedTargetTaskIds]
          .some((targetTaskId) => !taskIds.has(targetTaskId))
      ) {
        fail("wakeflow-business-archive-archive-invalid", "archived review candidate differs from its exact source state");
      }
      for (const result of record.results) {
        const selected = artifactRecords.get(result.targetResultId);
        const selectedIdentity = selected ? demandArtifactIdentity(selected) : null;
        if (
          selectedIdentity?.artifactKind !== "wakeflow-target-result"
          || selected.targetTaskId !== result.targetTaskId
          || selectedIdentity.ref !== result.ref
          || selectedIdentity.digest !== result.digest
          || selected.outcome !== result.outcome
          || creationById.get(selectedIdentity.artifactId)?.index >= creation.index
        ) {
          fail("wakeflow-business-archive-archive-invalid", "archived review candidate result set is not exact");
        }
      }
    }
  }
  for (const task of terminal.state.targetTasks) {
    const taskPackage = artifactRecords.get(task.taskPackageId);
    if (
      taskPackage?.artifactKind !== "wakeflow-task-package"
      || taskPackage.targetTaskId !== task.targetTaskId
      || taskPackage.windowId !== task.windowId
      || (taskPackage.repositoryId ?? null) !== (task.repositoryId ?? null)
    ) {
      fail("wakeflow-business-archive-archive-invalid", "archived target task lacks its exact immutable package assignment");
    }
    if (taskPackage.workType === "test") {
      const testCard = artifactRecords.get(taskPackage.testCard.testCardId);
      const testCardIdentity = testCard ? demandArtifactIdentity(testCard) : null;
      if (
        !task.testCard
        || task.testCard.testCardId !== taskPackage.testCard.testCardId
        || task.testCard.ref !== taskPackage.testCard.ref
        || task.testCard.digest !== taskPackage.testCard.digest
        || testCardIdentity?.artifactKind !== "wakeflow-test-card"
        || testCardIdentity.ref !== task.testCard.ref
        || testCardIdentity.digest !== task.testCard.digest
      ) {
        fail("wakeflow-business-archive-archive-invalid", "archived Test task lacks its exact Test card authority");
      }
    } else if (task.testCard) {
      fail("wakeflow-business-archive-archive-invalid", "non-Test archived task cannot select a Test card");
    }
  }
}

function assertArchivedTerminalBusinessClosure(context, terminal, artifactRecords, summary) {
  const state = terminal.state;
  const lifecycle = ["completed", "cancelled"].includes(state.state)
    ? assertTerminalLifecycleEventChain(terminal.events, state.state, { archived: true })
    : null;
  if (
    !["completed", "cancelled"].includes(state.state)
    || lifecycle === null
    || state.review.status !== "idle"
    || Object.hasOwn(state.review, "pendingCandidate")
    || state.review.readyTargetTaskIds.length !== 0
    || state.review.blockedTargetTaskIds.length !== 0
    || state.review.missingTargetTaskIds.length !== 0
    || state.taskPackages.some((entry) => !["closed", "superseded"].includes(entry.lifecycleStatus))
    || state.testCards.some((entry) => !["closed", "superseded"].includes(entry.lifecycleStatus))
  ) {
    fail("wakeflow-business-archive-archive-invalid", "archived terminal lifecycle closure is invalid");
  }
  if (terminal.demand.executionPlacement.mode === "main") {
    if (lifecycle.index !== terminal.events.length - 1 || state.pod) {
      fail("wakeflow-business-archive-archive-invalid", "archived main placement terminal tail is invalid");
    }
  } else if (
    terminal.demand.executionPlacement.mode !== "isolated"
    || !state.pod
    || state.pod.phase !== "closed"
    || state.pod.windows.some((entry) => entry.status !== "closed" || !entry.close?.receipt)
  ) {
    fail("wakeflow-business-archive-archive-invalid", "archived isolated placement lacks a fully acknowledged closed Pod");
  }
  assertArchivedArtifactStateClosure(context, terminal, artifactRecords);
  const selectedResults = [];
  for (const task of state.targetTasks) {
    if (!["accepted", "cancelled", "superseded"].includes(task.lifecycleStatus)) {
      fail("wakeflow-business-archive-archive-invalid", "archived target task is not terminal");
    }
    if (!task.currentResult) {
      if (task.lifecycleStatus === "accepted") {
        fail("wakeflow-business-archive-archive-invalid", "accepted archived target task lacks its selected result");
      }
      continue;
    }
    const record = artifactRecords.get(task.currentResult.targetResultId);
    const identity = record ? demandArtifactIdentity(record) : null;
    if (
      !identity
      || identity.ref !== task.currentResult.ref
      || identity.digest !== task.currentResult.digest
      || (task.lifecycleStatus === "accepted" && record.outcome === "blocked")
    ) {
      fail("wakeflow-business-archive-archive-invalid", "archived target selection is not exact");
    }
    selectedResults.push({
      targetTaskId: task.targetTaskId,
      targetResultId: identity.artifactId,
      ref: identity.ref,
      digest: identity.digest,
      outcome: record.outcome,
    });
  }
  selectedResults.sort((left, right) => lexicalCompare(left.targetTaskId, right.targetTaskId));
  assertSameArchiveValue(summary.resultAuthority.selectedResults, selectedResults, "selected result summary");
  if (summary.resultAuthority.currentResultSetDigest !== canonicalJsonDigest([])) {
    fail("wakeflow-business-archive-archive-invalid", "archived terminal review result-set digest is invalid");
  }
}

function plannedArchiveLocator(plan) {
  const manifest = plan.manifest;
  return Object.freeze({
    record: manifest,
    recordId: manifest.archiveId,
    recordDigest: canonicalJsonDigest(manifest),
    relativeRoot: ledgerRecordRelativeRoot(manifest),
    members: manifest.members,
  });
}

function assertArchiveLocatorMatchesLoaded(locator, loaded) {
  const loadedMembers = loaded.members.map(({ role, path: memberPath, mediaType, digest }) => ({
    role,
    path: memberPath,
    mediaType,
    digest,
  }));
  if (
    loaded.recordId !== locator.recordId
    || loaded.recordDigest !== locator.recordDigest
    || loaded.relativeRoot !== locator.relativeRoot
    || canonicalJson(loaded.record) !== canonicalJson(locator.record)
    || canonicalJson(loadedMembers) !== canonicalJson(locator.members)
  ) {
    fail("wakeflow-business-archive-archive-invalid", "archive authority changed after its exact locator was resolved");
  }
}

function loadExistingArchive(context, locator) {
  if (!locator) return null;
  const root = refPath(context.ledgerRoot, locator.relativeRoot);
  const loaded = loadLedgerRecord({
    ledgerRoot: context.ledgerRoot,
    root,
    expectedFamily: "archive",
    expectedProgramId: context.values.expectedProgramId,
  });
  assertArchiveLocatorMatchesLoaded(locator, loaded);
  const summaryMember = loadArchivedJsonMember(loaded, context.ledgerRoot, BUSINESS_SUMMARY_REF);
  const businessSummary = validateBusinessArchiveSummary(summaryMember.value);
  if (!summaryMember.bytes.equals(businessArchiveCanonicalBytes(businessSummary))) {
    fail("wakeflow-business-archive-archive-invalid", "archived business summary is not canonical");
  }
  const todoDeclaration = loaded.record.members.find((entry) => entry.role === "todo-history") ?? null;
  const todoMember = todoDeclaration
    ? loadArchivedJsonMember(loaded, context.ledgerRoot, todoDeclaration.path)
    : null;
  const todoHistory = todoMember ? validateBusinessArchiveTodoHistory(todoMember.value) : null;
  if (todoMember && !todoMember.bytes.equals(businessArchiveCanonicalBytes(todoHistory))) {
    fail("wakeflow-business-archive-archive-invalid", "archived TODO history is not canonical");
  }
  const transportDeclaration = loaded.record.members.find(
    (entry) => entry.role === "transport-summary",
  );
  if (!transportDeclaration || transportDeclaration.path !== TRANSPORT_SUMMARY_REF) {
    fail("wakeflow-business-archive-archive-invalid", "archive has no exact transport summary member");
  }
  const transportMember = loadArchivedJsonMember(
    loaded,
    context.ledgerRoot,
    transportDeclaration.path,
  );
  const transportSummary = validateBusinessArchiveTransportSummary(transportMember.value);
  if (!transportMember.bytes.equals(businessArchiveCanonicalBytes(transportSummary))) {
    fail("wakeflow-business-archive-archive-invalid", "archived transport summary is not canonical");
  }
  const archivedStateMember = loadArchivedJsonMember(loaded, context.ledgerRoot, "payload/wakeflow-state.json");
  const archivedState = archivedStateMember.value;
  const archivedEvents = loadArchivedEventsMember(loaded, context.ledgerRoot);
  const archiveEvent = archivedEvents.events.at(-1);
  const plan = validateBusinessArchivePlan({
    schemaVersion: 1,
    artifactKind: "wakeflow-business-archive-plan",
    archiveEvent,
    archivedState,
    manifest: loaded.record,
    businessSummary,
    transportSummary,
    todoHistory,
  });
  const demandMember = loadArchivedJsonMember(loaded, context.ledgerRoot, "payload/demand.json");
  const demand = demandMember.value;
  if (
    loaded.record.source.demandRef !== "payload/demand.json"
    || loaded.record.source.demandDigest !== prefixedDigest(demandMember.bytes)
  ) {
    fail("wakeflow-business-archive-archive-invalid", "archive manifest source does not bind its exact demand member");
  }
  const authorityDeclaration = loaded.record.members.find((entry) => entry.path === "payload/demand-authority.json");
  const authorityMember = authorityDeclaration
    ? loadArchivedJsonMember(loaded, context.ledgerRoot, authorityDeclaration.path)
    : null;
  const authority = authorityMember?.value ?? null;
  validateDemandCoreStack({
    demand,
    authority,
    state: archivedState,
    events: archivedEvents.events,
    ledgerRoot: context.ledgerRoot,
  });
  assertTodoHistoryMatchesDemand(context, {
    demand,
    digests: { demand: canonicalJsonDigest(demand) },
  }, todoHistory);
  if (!demandMember.bytes.equals(demandCoreCanonicalBytes(demand))) {
    fail("wakeflow-business-archive-archive-invalid", "archived demand is not canonical");
  }
  if (authorityMember && !authorityMember.bytes.equals(demandCoreCanonicalBytes(authority))) {
    fail("wakeflow-business-archive-archive-invalid", "archived authority is not canonical");
  }
  if (!archivedStateMember.bytes.equals(demandCoreCanonicalBytes(archivedState))) {
    fail("wakeflow-business-archive-archive-invalid", "archived state is not canonical");
  }
  const terminal = reconstructTerminalStack({
    context,
    demand,
    authority,
    archivedState,
    events: archivedEvents.events,
  });
  assertSameArchiveValue(businessSummary.terminalAdmission, {
    state: terminal.state.state,
    revision: terminal.state.revision,
    stateDigest: terminal.digests.state,
    eventId: terminal.state.lastEvent.eventId,
    eventDigest: terminal.state.lastEvent.eventDigest,
  }, "terminal admission");
  assertSameArchiveValue(businessSummary.core, expectedArchivedCoreSummary({
    terminal,
    archivedStateBytes: archivedStateMember.bytes,
    archivedEvents,
    demandBytes: demandMember.bytes,
    authorityBytes: authorityMember?.bytes ?? null,
  }), "core summary");
  const artifactRecords = loadArchivedArtifactClosure(context, loaded, businessSummary, terminal);
  const evidenceClosure = loadArchivedEvidenceClosure(context, loaded, businessSummary, terminal, artifactRecords);
  const archivedArtifactClosure = [...artifactRecords].map(([ref, record]) => ({
    ref,
    record,
    identity: demandArtifactIdentity(record),
  }));
  assertArchivedTransportCrossClosure(terminal, archivedArtifactClosure, transportSummary);
  assertArchivedManifestClosure(
    loaded,
    businessSummary,
    transportSummary,
    todoHistory,
    evidenceClosure,
    terminal.demand,
  );
  assertArchivedTerminalBusinessClosure(context, terminal, artifactRecords, businessSummary);
  assertBusinessArchivePortable({
    values: [
      terminal.demand,
      terminal.authority,
      terminal.state,
      terminal.events,
      archivedState,
      archivedEvents.events.at(-1),
      ...artifactRecords.values(),
      ...evidenceClosure.manifests,
      transportSummary,
      plan,
    ].filter(Boolean),
    opaqueMembers: evidenceClosure.opaqueMembers,
    forbiddenRoots: [context.workspaceRoot, context.ledgerRoot, os.homedir()],
  });
  return Object.freeze({
    locator,
    loaded,
    plan,
    terminal,
    transportSummary,
  });
}

function findExistingArchive(context) {
  const locator = findDemandArchiveRecord({
    ledgerRoot: context.ledgerRoot,
    expectedProgramId: context.values.expectedProgramId,
    demandId: context.values.demandId,
    archiveId: context.values.archiveId,
  });
  return loadExistingArchive(context, locator);
}

function loadPlannedArchiveIfPresent(context, plan) {
  const locator = plannedArchiveLocator(plan);
  if (!lstatIfPresent(refPath(context.ledgerRoot, locator.relativeRoot))) return null;
  return loadExistingArchive(context, locator);
}

function assertCommitInputMatchesArchive(values, archive) {
  const summary = archive.plan.businessSummary;
  if (
    values.archiveId !== summary.archiveId
    || values.demandId !== summary.demandId
    || values.expectedProgramId !== summary.programId
    || values.archivedAt !== summary.archivedAt
    || values.archiveEventId !== summary.archiveTransition.eventId
    || values.archiveReason !== summary.archiveTransition.reason
    || values.conclusion !== summary.conclusion
    || values.expectedPrevious.revision !== summary.terminalAdmission.revision
    || values.expectedPrevious.stateDigest !== summary.terminalAdmission.stateDigest
  ) {
    fail("wakeflow-business-archive-conflict", "archive input conflicts with committed immutable authority");
  }
}

function projectionResult(context, archive, preferredStatus = null) {
  let projectionStatus = preferredStatus;
  if (projectionStatus === null) {
    try {
      writeLedgerProjection({
        ledgerRoot: context.ledgerRoot,
        programId: context.values.expectedProgramId,
        programDisplayName: context.snapshot.model.program.displayName,
      });
      projectionStatus = "current";
    } catch {
      projectionStatus = "stale";
    }
  }
  return deepFreeze({
    archiveId: archive.loaded.record.archiveId,
    demandId: archive.loaded.record.source.demandId,
    manifestDigest: archive.loaded.recordDigest,
    ledgerProjectionStatus: projectionStatus,
    activeProjectionStatus: ACTIVE_PROJECTION_STATUS,
  });
}

/**
 * 委托 ledger projector 发布不可变 authority，并复验其定位与完整业务成员。
 */
function ensureLedgerArchive(context, built) {
  const locator = plannedArchiveLocator(built.plan);
  const plannedExisting = loadPlannedArchiveIfPresent(context, built.plan);
  if (plannedExisting) {
    const existing = findExistingArchive(context);
    if (
      !existing
      || canonicalJson(existing.plan) !== canonicalJson(built.plan)
      || existing.loaded.recordDigest !== locator.recordDigest
    ) {
      fail("wakeflow-business-archive-conflict", "committed archive differs from the journaled plan");
    }
    let projectionStatus;
    try {
      writeLedgerProjection({
        ledgerRoot: context.ledgerRoot,
        programId: context.values.expectedProgramId,
        programDisplayName: context.snapshot.model.program.displayName,
      });
      projectionStatus = "current";
    } catch {
      projectionStatus = "stale";
    }
    return Object.freeze({ archive: existing, projectionStatus });
  }
  const result = commitLedgerRecordAndProject({
    ledgerRoot: context.ledgerRoot,
    programId: context.values.expectedProgramId,
    record: built.plan.manifest,
    memberContents: built.memberContents,
    programDisplayName: context.snapshot.model.program.displayName,
  });
  if (
    result.authority.recordId !== locator.recordId
    || result.authority.recordDigest !== locator.recordDigest
    || result.authority.relativeRoot !== locator.relativeRoot
  ) {
    fail("wakeflow-business-archive-conflict", "ledger writer returned authority outside the journaled archive identity");
  }
  const archive = loadExistingArchive(context, locator);
  if (canonicalJson(archive.plan) !== canonicalJson(built.plan)) {
    fail("wakeflow-business-archive-conflict", "ledger publish did not commit the exact archive authority");
  }
  return Object.freeze({ archive, projectionStatus: result.projectionStatus });
}

function ensureTodoConsumed(context, transaction, manifestDigest) {
  const history = transaction.plan.todoHistory;
  if (history === null) return Object.freeze({ status: "not-applicable", wrote: false });
  return recoverTodoRowArchive({
    root: context.workspaceRoot,
    boardPath: context.todoBoard,
    expectedRow: history.claimedRow,
    archiveReceipt: {
      schemaVersion: 1,
      artifactKind: "wakeflow-business-archive-receipt",
      archiveId: transaction.archiveId,
      demandId: transaction.demandId,
      todoId: history.todoId,
      claimedRowDigest: history.claimedRow.rowDigest,
      manifestDigest,
    },
  });
}

function ensureSidecar(context, transactionBytes) {
  assertPrivateAncestorChain(context.activeChain, "archive sidecar ancestor");
  const interrupted = inspectInterruptedAtomicStage(
    context.sidecar,
    "archive sidecar",
    context.activeChain,
  );
  if (interrupted) {
    const snapshot = safeReadPrivateFileSnapshot(interrupted, { maximumBytes: 16 * 1024 * 1024 });
    if (snapshot.bytes.equals(transactionBytes)) {
      promoteInterruptedAtomicStage(
        context.sidecar,
        interrupted,
        transactionBytes,
        "archive sidecar",
        context.activeChain,
      );
    } else {
      try {
        parseCanonicalBusinessRecordBytes(snapshot.bytes, validateBusinessArchiveTransaction);
      } catch {
        discardInterruptedAtomicStage(
          interrupted,
          snapshot.identity,
          "archive sidecar",
          context.activeChain,
        );
      }
      if (lstatIfPresent(interrupted)) {
        fail(
          "wakeflow-business-archive-conflict",
          "interrupted archive sidecar stage contains a different complete transaction intent",
        );
      }
    }
  }
  const stat = lstatIfPresent(context.sidecar);
  if (stat) {
    const existing = safeReadPrivateFile(context.sidecar, { maximumBytes: 16 * 1024 * 1024 });
    if (!existing.equals(transactionBytes)) {
      fail("wakeflow-business-archive-conflict", "archive sidecar differs from the immutable journal");
    }
    return;
  }
  atomicWriteFile({
    root: context.workspaceRoot,
    target: context.sidecar,
    content: transactionBytes,
    expectation: { type: "absent" },
    mode: 0o600,
    label: "business archive recovery sidecar",
  });
  assertPrivateAncestorChain(context.activeChain, "archive sidecar ancestor");
  const written = safeReadPrivateFile(context.sidecar, { maximumBytes: 16 * 1024 * 1024 });
  if (!written.equals(transactionBytes)) {
    fail("wakeflow-business-archive-recovery", "archive sidecar write did not preserve the journal bytes");
  }
}

function assertSourceInventoryMatches(stateRoot, transaction, { journalRequired }) {
  const actual = stableSourceTree(stateRoot);
  const directories = actual.directories;
  let files = actual.files;
  const journal = files.find((entry) => entry.ref === ARCHIVE_JOURNAL_REF) ?? null;
  if (journalRequired) {
    const journalBytes = businessArchiveCanonicalBytes(transaction);
    if (!journal || journal.byteDigest !== prefixedDigest(journalBytes)) {
      fail("wakeflow-business-archive-recovery", "source root lacks the exact archive journal");
    }
    files = files.filter((entry) => entry.ref !== ARCHIVE_JOURNAL_REF);
  } else if (journal) {
    fail("wakeflow-business-archive-source-closure", "fresh archive source unexpectedly contains an archive journal");
  }
  const normalized = frozenClone({
    directories,
    files,
    treeDigest: canonicalJsonDigest({ directories, files }),
  });
  if (canonicalJson(normalized) !== canonicalJson(transaction.sourceTree)) {
    fail("wakeflow-business-archive-conflict", "source tree differs from the immutable archive transaction");
  }
  return normalized;
}

function inspectTombstoneSubset(context, transaction) {
  const sourceDirectories = new Map(transaction.sourceTree.directories.map((entry) => [entry.ref, entry]));
  const sourceFiles = new Map(transaction.sourceTree.files.map((entry) => [entry.ref, entry]));
  sourceFiles.set(ARCHIVE_JOURNAL_REF, {
    ref: ARCHIVE_JOURNAL_REF,
    mode: 0o600,
    byteDigest: prefixedDigest(businessArchiveCanonicalBytes(transaction)),
  });
  const rootStat = lstatSync(context.tombstone, { bigint: true });
  if (
    rootStat.isSymbolicLink()
    || !rootStat.isDirectory()
    || !nodeOwnedByCurrentUser(rootStat)
    || (process.platform !== "win32" && permissionBits(rootStat) !== 0o700)
  ) {
    fail("wakeflow-business-archive-recovery", "archive tombstone root is unsafe");
  }
  const rootIdentity = privateDirectoryIdentity(rootStat);
  const rootAncestors = inspectActiveWorkspaceChain(context.workspaceRoot);
  const actualFiles = [];
  const actualDirectories = [];
  const visit = (directory, prefix, identity, mode, ancestors) => {
    assertPrivateAncestorChain(ancestors, "archive tombstone ancestor");
    assertPrivateDirectorySnapshot(directory, identity, mode, "archive tombstone directory");
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => lexicalCompare(left.name, right.name))) {
      const ref = prefix ? `${prefix}/${entry.name}` : entry.name;
      const candidate = path.join(directory, entry.name);
      const stat = lstatSync(candidate, { bigint: true });
      if (stat.isSymbolicLink()) fail("wakeflow-business-archive-recovery", "archive tombstone contains an unsafe entry");
      if (stat.isDirectory()) {
        const expected = sourceDirectories.get(ref);
        if (
          !expected
          || !nodeOwnedByCurrentUser(stat)
          || (process.platform !== "win32" && permissionBits(stat) !== expected.mode)
        ) {
          fail("wakeflow-business-archive-recovery", "archive tombstone contains an unknown directory");
        }
        const childIdentity = privateDirectoryIdentity(stat);
        const childAncestors = [...ancestors, { candidate: directory, identity, mode }];
        actualDirectories.push({
          ref,
          candidate,
          expected,
          identity: childIdentity,
          ancestors: childAncestors,
        });
        visit(candidate, ref, childIdentity, expected.mode, childAncestors);
      } else if (stat.isFile()) {
        const expected = sourceFiles.get(ref);
        if (!expected) fail("wakeflow-business-archive-recovery", "archive tombstone contains an unknown file");
        const initialIdentity = privateFileIdentity(stat);
        const snapshot = safeReadPrivateFileSnapshot(candidate, { mode: expected.mode });
        if (
          !samePrivateFileIdentity(snapshot.identity, initialIdentity)
          || prefixedDigest(snapshot.bytes) !== expected.byteDigest
        ) {
          fail("wakeflow-business-archive-conflict", "archive tombstone file differs from the immutable source inventory");
        }
        actualFiles.push({
          ref,
          candidate,
          expected,
          identity: snapshot.identity,
          ancestors: [...ancestors, { candidate: directory, identity, mode }],
        });
      } else {
        fail("wakeflow-business-archive-recovery", "archive tombstone contains a special entry");
      }
    }
    assertPrivateAncestorChain(ancestors, "archive tombstone ancestor");
    assertPrivateDirectorySnapshot(directory, identity, mode, "archive tombstone directory");
  };
  visit(context.tombstone, "", rootIdentity, 0o700, rootAncestors);
  return { actualFiles, actualDirectories, rootIdentity, rootAncestors };
}

function unlinkExactPrivateFile(
  candidate,
  expectedDigest,
  expectedIdentity = null,
  mode = 0o600,
  ancestors = [],
) {
  assertPrivateAncestorChain(ancestors, "archive cleanup ancestor");
  const snapshot = safeReadPrivateFileSnapshot(candidate, { mode });
  if (
    prefixedDigest(snapshot.bytes) !== expectedDigest
    || (expectedIdentity && !samePrivateFileIdentity(snapshot.identity, expectedIdentity))
  ) {
    fail("wakeflow-business-archive-conflict", "archive cleanup target changed before unlink");
  }
  const before = lstatSync(candidate, { bigint: true });
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || !nodeOwnedByCurrentUser(before)
    || !samePrivateFileIdentity(before, snapshot.identity)
  ) {
    fail("wakeflow-business-archive-recovery", "archive cleanup target identity changed before unlink");
  }
  assertPrivateAncestorChain(ancestors, "archive cleanup ancestor");
  unlinkSync(candidate);
  assertPrivateAncestorChain(ancestors, "archive cleanup ancestor");
}

function removeExactPrivateDirectory(candidate, identity, mode, ancestors = []) {
  const matches = (stat) => stat
    && !stat.isSymbolicLink()
    && stat.isDirectory()
    && stat.dev === identity.dev
    && stat.ino === identity.ino
    && stat.uid === identity.uid
    && stat.gid === identity.gid
    && stat.mode === identity.mode
    && nodeOwnedByCurrentUser(stat)
    && (process.platform === "win32" || permissionBits(stat) === mode);
  assertPrivateAncestorChain(ancestors, "archive cleanup ancestor");
  const before = lstatIfPresent(candidate);
  if (!matches(before) || readdirSync(candidate).length !== 0) {
    fail("wakeflow-business-archive-recovery", "archive cleanup directory changed or is not empty");
  }
  const after = lstatIfPresent(candidate);
  if (!matches(after)) {
    fail("wakeflow-business-archive-recovery", "archive cleanup directory identity changed before removal");
  }
  assertPrivateAncestorChain(ancestors, "archive cleanup ancestor");
  rmdirSync(candidate);
  assertPrivateAncestorChain(ancestors, "archive cleanup ancestor");
}

function cleanupTombstone(context, transaction) {
  const {
    actualFiles,
    actualDirectories,
    rootIdentity,
    rootAncestors,
  } = inspectTombstoneSubset(context, transaction);
  const journalDigest = prefixedDigest(businessArchiveCanonicalBytes(transaction));
  const regularFiles = actualFiles.filter((entry) => entry.ref !== ARCHIVE_JOURNAL_REF)
    .sort((left, right) => lexicalCompare(right.ref, left.ref));
  for (const entry of regularFiles) {
    unlinkExactPrivateFile(
      entry.candidate,
      entry.expected.byteDigest,
      entry.identity,
      entry.expected.mode,
      entry.ancestors,
    );
  }
  const journal = actualFiles.find((entry) => entry.ref === ARCHIVE_JOURNAL_REF);
  if (journal) {
    unlinkExactPrivateFile(
      journal.candidate,
      journalDigest,
      journal.identity,
      journal.expected.mode,
      journal.ancestors,
    );
  }
  for (const entry of actualDirectories.sort((left, right) => (
    right.ref.split("/").length - left.ref.split("/").length || lexicalCompare(right.ref, left.ref)
  ))) {
    removeExactPrivateDirectory(entry.candidate, entry.identity, entry.expected.mode, entry.ancestors);
  }
  removeExactPrivateDirectory(context.tombstone, rootIdentity, 0o700, rootAncestors);
}

function unlinkExactSidecar(context, transactionBytes) {
  const ancestors = inspectActiveWorkspaceChain(context.workspaceRoot);
  const snapshot = safeReadPrivateFileSnapshot(context.sidecar, { maximumBytes: 16 * 1024 * 1024 });
  if (!snapshot.bytes.equals(transactionBytes)) {
    fail("wakeflow-business-archive-conflict", "archive sidecar changed before cleanup");
  }
  unlinkExactPrivateFile(
    context.sidecar,
    prefixedDigest(transactionBytes),
    snapshot.identity,
    0o600,
    ancestors,
  );
}

/**
 * 在 ledger authority 与 TODO effect 完成后，把 exact current 原子改名为 tombstone 并有界清理。
 */
function detachCurrent(context, transaction) {
  const transactionBytes = businessArchiveCanonicalBytes(transaction);
  assertPrivateAncestorChain(context.activeChain, "archive detach ancestor");
  const sourceStat = lstatSync(context.stateRoot, { bigint: true });
  if (
    sourceStat.isSymbolicLink()
    || !sourceStat.isDirectory()
    || !nodeOwnedByCurrentUser(sourceStat)
    || (process.platform !== "win32" && permissionBits(sourceStat) !== 0o700)
  ) {
    fail("wakeflow-business-archive-recovery", "archive detach source root is unsafe");
  }
  const sourceIdentity = privateDirectoryIdentity(sourceStat);
  assertSourceInventoryMatches(context.stateRoot, transaction, { journalRequired: true });
  const snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: context.workspaceRoot });
  if (
    snapshot.configDigest !== transaction.config.digest
    || snapshot.model.storage.ledgerRoot !== transaction.config.ledgerRootRef
  ) {
    fail("wakeflow-business-archive-conflict", "canonical config changed before archive detach");
  }
  ensureSidecar(context, transactionBytes);
  if (lstatIfPresent(context.tombstone)) {
    fail("wakeflow-business-archive-recovery", "current root and archive tombstone cannot coexist");
  }
  assertPrivateAncestorChain(context.activeChain, "archive detach ancestor");
  assertPrivateDirectorySnapshot(context.stateRoot, sourceIdentity, 0o700, "archive detach source root");
  renameSync(context.stateRoot, context.tombstone);
  assertPrivateAncestorChain(context.activeChain, "archive detach ancestor");
  assertPrivateDirectorySnapshot(context.tombstone, sourceIdentity, 0o700, "archive detach tombstone root");
  cleanupTombstone(context, transaction);
  unlinkExactSidecar(context, transactionBytes);
}

function completeFromTombstone(context, transaction, archive) {
  const transactionBytes = businessArchiveCanonicalBytes(transaction);
  ensureTodoConsumed(context, transaction, archive.loaded.recordDigest);
  cleanupTombstone(context, transaction);
  unlinkExactSidecar(context, transactionBytes);
  return projectionResult(context, archive);
}

function completeFromSidecar(context, transaction, archive) {
  const transactionBytes = businessArchiveCanonicalBytes(transaction);
  ensureTodoConsumed(context, transaction, archive.loaded.recordDigest);
  unlinkExactSidecar(context, transactionBytes);
  return projectionResult(context, archive);
}

function loadSidecar(context) {
  return readCanonicalBusinessRecord(context.sidecar, validateBusinessArchiveTransaction);
}

function planWhileLocked(context) {
  if (lstatIfPresent(context.tombstone) || lstatIfPresent(context.sidecar)) {
    fail("wakeflow-business-archive-recovery", "pending archive recovery residue blocks planning");
  }
  if (!lstatIfPresent(context.stateRoot)) {
    fail("wakeflow-business-archive-terminal", "active terminal demand root is missing");
  }
  if (findExistingArchive(context)) {
    fail("wakeflow-business-archive-conflict", "demand already has immutable archive authority");
  }
  const loaded = loadDemandCoreRecordsWhileLocked({
    stateRoot: context.stateRoot,
    expectedProgramId: context.values.expectedProgramId,
    ledgerRoot: context.ledgerRoot,
  });
  return collectFreshPlanWhileLocked(context, loaded).publicPlan;
}

function advanceCurrentWhileLocked(context, mode) {
  recoverInterruptedJournalStage(context, mode);
  const journalStat = lstatIfPresent(context.journal);
  let built;
  if (!journalStat) {
    if (mode === "recover") {
      fail("wakeflow-business-archive-recovery", "no archive transaction exists for recovery");
    }
    const existing = findExistingArchive(context);
    if (existing) {
      fail("wakeflow-business-archive-conflict", "healthy current root coexists with committed archive authority");
    }
    const loaded = loadDemandCoreRecordsWhileLocked({
      stateRoot: context.stateRoot,
      expectedProgramId: context.values.expectedProgramId,
      ledgerRoot: context.ledgerRoot,
    });
    built = collectFreshPlanWhileLocked(context, loaded);
    writeJournal(context, built);
  } else {
    const loaded = loadDemandArchiveRecoveryRecordsWhileLocked({
      stateRoot: context.stateRoot,
      expectedProgramId: context.values.expectedProgramId,
      ledgerRoot: context.ledgerRoot,
    });
    const transaction = validateBusinessArchiveTransaction(loaded.journal);
    const bytes = businessArchiveCanonicalBytes(transaction);
    if (!loaded.bytes.journal.equals(bytes)) {
      fail("wakeflow-business-archive-recovery", "archive journal is not canonical");
    }
    if (mode === "commit") assertCommitInputMatchesTransaction(context.values, transaction);
    const committedArchive = loadPlannedArchiveIfPresent(context, transaction.plan);
    if (committedArchive && canonicalJson(committedArchive.plan) !== canonicalJson(transaction.plan)) {
      fail("wakeflow-business-archive-conflict", "committed archive differs from the current journal");
    }
    built = rebuildFromJournalWhileLocked(context, loaded, transaction, {
      verifyTodoLive: committedArchive === null,
    });
    const sidecarStat = lstatIfPresent(context.sidecar);
    if (sidecarStat) {
      const sidecar = loadSidecar(context);
      if (!sidecar.bytes.equals(bytes)) fail("wakeflow-business-archive-conflict", "archive journal and sidecar differ");
    }
  }
  const effectiveContext = contextFromTransaction(context, built.transaction);
  const ledger = ensureLedgerArchive(effectiveContext, built);
  ensureTodoConsumed(effectiveContext, built.transaction, ledger.archive.loaded.recordDigest);
  detachCurrent(effectiveContext, built.transaction);
  return projectionResult(effectiveContext, ledger.archive, ledger.projectionStatus);
}

/**
 * 识别 current/journal、tombstone/sidecar、sidecar 或 ledger-only 四类合法恢复前缀并收敛。
 */
function runLockedOperation(context, mode) {
  const current = lstatIfPresent(context.stateRoot);
  const tombstone = lstatIfPresent(context.tombstone);
  const sidecar = lstatIfPresent(context.sidecar);
  if (current && tombstone) {
    fail("wakeflow-business-archive-recovery", "current demand root and archive tombstone coexist");
  }
  if (current) return advanceCurrentWhileLocked(context, mode);

  const archive = findExistingArchive(context);
  if (tombstone) {
    if (!sidecar || !archive) {
      fail("wakeflow-business-archive-recovery", "archive tombstone requires exact sidecar and ledger authority");
    }
    const sidecarRecord = loadSidecar(context);
    const transaction = sidecarRecord.value;
    contextFromTransaction(context, transaction);
    if (canonicalJson(transaction.plan) !== canonicalJson(archive.plan)) {
      fail("wakeflow-business-archive-conflict", "tombstone sidecar differs from committed archive authority");
    }
    if (mode === "commit") assertCommitInputMatchesTransaction(context.values, transaction);
    return completeFromTombstone(context, transaction, archive);
  }
  if (sidecar) {
    if (!archive) fail("wakeflow-business-archive-recovery", "orphan archive sidecar has no immutable authority");
    const sidecarRecord = loadSidecar(context);
    const transaction = sidecarRecord.value;
    contextFromTransaction(context, transaction);
    if (canonicalJson(transaction.plan) !== canonicalJson(archive.plan)) {
      fail("wakeflow-business-archive-conflict", "sidecar differs from committed archive authority");
    }
    if (mode === "commit") assertCommitInputMatchesTransaction(context.values, transaction);
    return completeFromSidecar(context, transaction, archive);
  }
  if (!archive) fail("wakeflow-business-archive-recovery", "no active source or committed archive exists");
  if (mode === "commit") assertCommitInputMatchesArchive(context.values, archive);
  return projectionResult(context, archive);
}

/**
 * 固定 Active projection、Active identity、demand state-root 的锁序。
 */
function withArchiveLocks(values, operation) {
  const activeChain = inspectActiveWorkspaceChain(values.workspaceRoot);
  return withWakeflowActiveProjectionLock(values.workspaceRoot, () => {
    assertPrivateAncestorChain(activeChain, "active workspace lock ancestor");
    return withWakeflowActiveIdentityLock(values.workspaceRoot, () => {
      assertPrivateAncestorChain(activeChain, "active workspace lock ancestor");
      const context = resolveContext(values);
      return withStateRootLock(context.stateRoot, () => operation(context));
    });
  });
}

/**
 * 零写入预览：重建当前终态闭包并返回可公开计划。
 */
export function planDemandBusinessArchive(input = {}) {
  return boundary(() => {
    const values = normalizePlanInput(input);
    return withArchiveLocks(values, (context) => planWhileLocked(context));
  });
}

/**
 * 以调用方明确的终态 CAS 与归档身份提交完整事务。
 */
export function commitDemandBusinessArchive(input = {}) {
  return boundary(() => {
    const values = normalizePlanInput(input);
    return withArchiveLocks(values, (context) => runLockedOperation(context, "commit"));
  });
}

/**
 * 不接受新的业务决定，只按已持久化事务或 authority 前向收敛。
 */
export function recoverDemandBusinessArchive(input = {}) {
  return boundary(() => {
    const values = normalizeRecoveryInput(input);
    return withArchiveLocks(values, (context) => runLockedOperation(context, "recover"));
  });
}

/**
 * 只读加载 exact ledger authority，并返回已复验的业务、transport 与定位投影。
 */
export function inspectDemandBusinessArchive(input = {}) {
  return boundary(() => {
    const values = normalizeRecoveryInput(input);
    return withArchiveLocks(values, (context) => {
      const archive = findExistingArchive(context);
      if (!archive) {
        fail("wakeflow-business-archive-not-found", "no exact committed demand archive exists");
      }
      const transportMember = archive.loaded.record.members.find(
        (entry) => entry.role === "transport-summary",
      );
      if (!transportMember) {
        fail("wakeflow-business-archive-archive-invalid", "archive transport member is missing after validation");
      }
      return frozenClone({
        schemaVersion: 1,
        artifactKind: "wakeflow-demand-business-archive-inspection",
        archiveId: archive.loaded.record.archiveId,
        programId: archive.loaded.record.programId,
        demandId: archive.loaded.record.source.demandId,
        manifest: {
          ref: path.posix.join(archive.loaded.relativeRoot, archive.loaded.recordFile),
          digest: archive.loaded.recordDigest,
        },
        transport: {
          memberRef: path.posix.join(archive.loaded.relativeRoot, transportMember.path),
          memberDigest: transportMember.digest,
          summary: archive.transportSummary,
        },
        terminalAdmission: archive.plan.businessSummary.terminalAdmission,
        archivedState: archive.plan.archivedState,
      });
    });
  });
}
