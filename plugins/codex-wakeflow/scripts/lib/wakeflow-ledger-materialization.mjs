/**
 * fresh/reconfigure/reconcile 中 ledger 静态布局与四个投影的 maintenance adapter。
 *
 * 本文件把 config 中唯一 ledgerRoot 编译为五个 0755 目录和四个 0644 projection
 * operation，闭合 preview plan 的派生语义，再适配到共享 workspace mutation participant。
 * 它不创建 requirement/confirmation/archive record，不搬迁 ledgerRoot，也不把空投影
 * 写入缺失的既有 authority 以伪装“没有记录”。
 *
 * 阅读地图：planWakeflowLedgerMaterialization 负责只读分类；plan validator 负责防止
 * 自签名语义篡改；projectWakeflowLedgerMaterializationMaintenance 只生成 aggregate action；
 * createWakeflowLedgerMaterializationMutationParticipant 才提供 M3 物理步骤。
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { assertWakeflowConfigV3TransitionAuthority } from "./wakeflow-config-v3-transition-authority.mjs";
import { validateWakeflowConfigRootPlacements } from "./wakeflow-layout-descriptor.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  LEDGER_PROJECTION_PATHS,
  buildEmptyLedgerProjection,
  inspectLedgerProjectionSource,
} from "./wakeflow-ledger-projector.mjs";
import { createWakeflowTrackedMaterializationParticipant } from "./wakeflow-tracked-materialization.mjs";

export const WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_ID = "urn:wakeflow:internal:ledger-materialization-plan:v1";
export const WAKEFLOW_LEDGER_MATERIALIZATION_KIND = "WakeflowLedgerMaterializationPlan";
export const WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_VERSION = 1;

const ACTIONS = new Set(["fresh-initialize", "reconfigure", "reconcile"]);
const DIRECTORY_MODE = "0755";
const FILE_MODE = "0644";
const MAX_LEDGER_PROJECTION_BYTES = 256 * 1024 * 1024;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const DIRECTORY_REFS = Object.freeze([
  ".",
  "requirement-designs",
  "goal-stage-confirmation",
  "workspace",
  "workspace/archive",
]);
const ORDERED_REFS = Object.freeze([...DIRECTORY_REFS, ...LEDGER_PROJECTION_PATHS]);
const PROJECTION_MARKERS = Object.freeze({
  "requirement-designs/index.md": "<!-- wakeflow:ledger-projection:v1:requirement-designs -->",
  "goal-stage-confirmation/index.md": "<!-- wakeflow:ledger-projection:v1:goal-stage-confirmation -->",
  "workspace/workspace-record-map.md": "<!-- wakeflow:ledger-projection:v1:workspace-record-map -->",
  "workspace/archive/index.md": "<!-- wakeflow:ledger-projection:v1:workspace-archive -->",
});
const DIRECTORY_BLOCK_REASONS = new Set([
  "fresh-ledger-root-unsafe",
  "fresh-ledger-root-present",
  "ledger-authority-root-missing",
  "ledger-authority-directory-missing",
  "ledger-directory-parent-unavailable",
  "ledger-directory-mode-drift",
  "ledger-directory-unsafe",
]);
const FILE_BLOCK_REASONS = new Set([
  "ledger-authority-inventory-unsafe",
  "ledger-projection-unsafe",
  "ledger-projection-invalid-utf8",
  "ledger-projection-unmanaged",
]);

// ==================== 一、输入、错误与物理观察 ====================

/**
 * ledger materialization 的稳定错误，既覆盖只读计划也覆盖 mutation participant 准入。
 */
export class WakeflowLedgerMaterializationError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowLedgerMaterializationError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowLedgerMaterializationError(code, message, {
    path: errorPath,
    details,
    cause,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) fail("wakeflow-ledger-materialization-contract", `${label} must be a plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("wakeflow-ledger-materialization-contract", `${label} has an invalid field set`, {
      details: { expected, actual: actual.map(String) },
    });
  }
  return value;
}

function canonicalSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-ledger-materialization-canonical", `${label} must be canonical JSON data`, { cause });
  }
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail("wakeflow-ledger-materialization-platform", "ledger materialization requires POSIX ownership semantics");
  }
  return process.geteuid();
}

function modeString(stat) {
  const mode = Number(stat.mode & (typeof stat.mode === "bigint" ? 0o777n : 0o777));
  return `0${mode.toString(8).padStart(3, "0")}`;
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// 从一次完整 config snapshot 派生绝对路径；ledgerRoot 变化仍由显式 migration owner 处理。
function normalizeInput(value, { participant = false } = {}) {
  const expected = [
    "workspaceRoot",
    "action",
    "sourceModel",
    "desiredModel",
    ...(participant ? ["confirmedPlan"] : []),
  ];
  const input = exactKeys(canonicalSnapshot(
    value,
    participant ? "ledger materialization participant input" : "ledger materialization planning input",
  ), expected, participant
    ? "ledger materialization participant input"
    : "ledger materialization planning input");
  if (typeof input.workspaceRoot !== "string" || !input.workspaceRoot.trim()) {
    fail("wakeflow-ledger-materialization-input", "workspaceRoot is required");
  }
  if (!ACTIONS.has(input.action)) fail("wakeflow-ledger-materialization-input", "action is invalid");
  const sourceModel = input.sourceModel === null ? null : parseWakeflowConfigV3(input.sourceModel);
  const desiredModel = parseWakeflowConfigV3(input.desiredModel);
  if (input.action === "fresh-initialize" && sourceModel !== null) {
    fail("wakeflow-ledger-materialization-input", "fresh-initialize requires sourceModel=null");
  }
  if (input.action !== "fresh-initialize" && sourceModel === null) {
    fail("wakeflow-ledger-materialization-input", `${input.action} requires one strict source model`);
  }
  if (sourceModel !== null && sourceModel.program.programId !== desiredModel.program.programId) {
    fail("wakeflow-ledger-materialization-input", "source and desired program identities differ");
  }
  if (
    input.action === "reconcile"
    && wakeflowConfigV3Digest(sourceModel) !== wakeflowConfigV3Digest(desiredModel)
  ) fail("wakeflow-ledger-materialization-input", "reconcile cannot change config semantics");
  if (
    sourceModel !== null
    && sourceModel.storage.ledgerRoot !== desiredModel.storage.ledgerRoot
  ) fail("wakeflow-ledger-materialization-migration", "ledgerRoot changes require explicit migration");
  const workspaceRoot = path.resolve(input.workspaceRoot);
  validateWakeflowConfigRootPlacements({ workspaceRoot, model: desiredModel });
  if (sourceModel !== null) validateWakeflowConfigRootPlacements({ workspaceRoot, model: sourceModel });
  return {
    workspaceRoot,
    action: input.action,
    sourceModel,
    desiredModel,
    ledgerRoot: path.resolve(workspaceRoot, ...desiredModel.storage.ledgerRoot.split("/")),
    ...(participant ? { confirmedPlan: input.confirmedPlan } : {}),
  };
}

function inspectDirectory(candidate) {
  let stat;
  try {
    stat = lstatSync(candidate, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return { classification: "missing", stat: null };
    return { classification: "unsafe", stat: null };
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== BigInt(currentEuid())) {
    return { classification: "unsafe", stat };
  }
  try {
    realpathSync(candidate);
  } catch {
    return { classification: "unsafe", stat };
  }
  return {
    classification: modeString(stat) === DIRECTORY_MODE ? "current" : "mode-drift",
    stat,
  };
}

// 只读取已存在投影的稳定 descriptor 字节；unsafe 观察只进入 blocker，不触发修复。
function inspectFile(candidate) {
  let before;
  try {
    before = lstatSync(candidate, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return { classification: "missing", stat: null, bytes: null };
    return { classification: "unsafe", stat: null, bytes: null };
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.uid !== BigInt(currentEuid())
    || before.nlink !== 1n
    || modeString(before) !== FILE_MODE
  ) return { classification: "unsafe", stat: before, bytes: null };
  let descriptor;
  try {
    descriptor = openSync(candidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    const sameSnapshot = (left, right) => left.dev === right.dev
      && left.ino === right.ino
      && left.uid === right.uid
      && left.gid === right.gid
      && left.mode === right.mode
      && left.nlink === right.nlink
      && left.size === right.size
      && left.mtimeNs === right.mtimeNs
      && left.ctimeNs === right.ctimeNs;
    if (!sameSnapshot(before, opened) || opened.size > BigInt(MAX_LEDGER_PROJECTION_BYTES)) {
      return { classification: "unsafe", stat: opened, bytes: null };
    }
    const expectedSize = Number(opened.size);
    const captured = Buffer.alloc(expectedSize + 1);
    let offset = 0;
    while (offset < captured.length) {
      const count = readSync(descriptor, captured, offset, captured.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const refreshed = lstatSync(candidate, { bigint: true });
    if (
      offset !== expectedSize
      || !sameSnapshot(opened, after)
      || !sameSnapshot(after, refreshed)
    ) return { classification: "unsafe", stat: after, bytes: null };
    return { classification: "file", stat: after, bytes: captured.subarray(0, expectedSize) };
  } catch {
    return { classification: "unsafe", stat: before, bytes: null };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function resourceRef(programId, ref) {
  return `targets/ledger/${programId}/${ref === "." ? "root" : ref}`;
}

function operationId(programId, ref) {
  const suffix = createHash("sha256").update(`${programId}\0${ref}`).digest("hex").slice(0, 32);
  return `ledger-materialization-${suffix}`;
}

function directoryDigest(programId, ref) {
  return canonicalJsonDigest({
    kind: "WakeflowLedgerDirectory",
    schemaVersion: 1,
    programId,
    ref,
    mode: DIRECTORY_MODE,
  });
}

// ==================== 二、领域 operation 与 owner plan 派生 ====================

function operationBase(normalized, ref, resourceKind) {
  const programId = normalized.desiredModel.program.programId;
  return {
    operationId: operationId(programId, ref),
    componentId: resourceKind === "directory" ? "ledger-layout" : "ledger-projection",
    owner: resourceKind === "directory" ? "ledger-service" : "ledger-projector",
    resourceKind,
    ref,
    resourceRef: resourceRef(programId, ref),
    root: {
      kind: "ledger",
      rootId: programId,
      configuredPath: normalized.desiredModel.storage.ledgerRoot,
      basis: "target",
    },
  };
}

function blockedOperation(normalized, ref, resourceKind, reasonCode, source = { type: "unsafe", mode: null, digest: null }) {
  return {
    public: {
      ...operationBase(normalized, ref, resourceKind),
      classification: "conflict",
      source,
      target: null,
      action: "blocked",
      reasonCode,
      stageRef: null,
    },
    private: null,
  };
}

function directoryOperation(normalized, ref, { parentPlanned }) {
  const targetPath = ref === "." ? normalized.ledgerRoot : path.join(normalized.ledgerRoot, ...ref.split("/"));
  const inspected = inspectDirectory(targetPath);
  const digest = directoryDigest(normalized.desiredModel.program.programId, ref);
  if (inspected.classification === "current") {
    const node = { type: "directory", mode: DIRECTORY_MODE, digest };
    return {
      public: {
        ...operationBase(normalized, ref, "directory"),
        classification: "managed-current",
        source: node,
        target: node,
        action: "current",
        reasonCode: "ledger-directory-current",
        stageRef: null,
      },
      private: { targetPath },
    };
  }
  if (inspected.classification === "missing") {
    if (normalized.action !== "fresh-initialize") {
      return blockedOperation(
        normalized,
        ref,
        "directory",
        ref === "." ? "ledger-authority-root-missing" : "ledger-authority-directory-missing",
        { type: "absent" },
      );
    }
    const parent = inspectDirectory(path.dirname(targetPath));
    if (!parentPlanned && !["current", "mode-drift"].includes(parent.classification)) {
      return blockedOperation(normalized, ref, "directory", "ledger-directory-parent-unavailable", { type: "absent" });
    }
    const target = { type: "directory", mode: DIRECTORY_MODE, digest };
    return {
      public: {
        ...operationBase(normalized, ref, "directory"),
        classification: "managed-missing",
        source: { type: "absent" },
        target,
        action: "create-managed",
        reasonCode: "ledger-directory-create",
        stageRef: null,
      },
      private: { targetPath },
    };
  }
  return blockedOperation(
    normalized,
    ref,
    "directory",
    inspected.classification === "mode-drift" ? "ledger-directory-mode-drift" : "ledger-directory-unsafe",
    inspected.classification === "mode-drift"
      ? { type: "directory", mode: modeString(inspected.stat), digest }
      : { type: "unsafe", mode: null, digest: null },
  );
}

function stageName(operation, targetDigest) {
  return `.${operation.operationId}.${targetDigest.slice("sha256:".length, "sha256:".length + 16)}.stage`;
}

function fileOperation(normalized, ref, content) {
  const base = operationBase(normalized, ref, "file");
  const targetPath = path.join(normalized.ledgerRoot, ...ref.split("/"));
  const inspected = inspectFile(targetPath);
  const targetBytes = Buffer.from(content, "utf8");
  const target = { type: "file", mode: FILE_MODE, digest: digestBytes(targetBytes) };
  if (inspected.classification === "missing") {
    const stageRef = path.posix.join(path.posix.dirname(ref), stageName(base, target.digest));
    return {
      public: {
        ...base,
        classification: "derived-projection",
        source: { type: "absent" },
        target,
        action: "create-managed",
        reasonCode: "ledger-projection-create",
        stageRef,
      },
      private: {
        targetPath,
        stagePath: path.join(path.dirname(targetPath), path.basename(stageRef)),
        targetBytes,
      },
    };
  }
  if (inspected.classification !== "file") {
    return blockedOperation(normalized, ref, "file", "ledger-projection-unsafe");
  }
  const source = { type: "file", mode: FILE_MODE, digest: digestBytes(inspected.bytes) };
  if (source.digest === target.digest) {
    return {
      public: {
        ...base,
        classification: "derived-projection",
        source,
        target,
        action: "current",
        reasonCode: "ledger-projection-current",
        stageRef: null,
      },
      private: { targetPath, stagePath: null, targetBytes },
    };
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(inspected.bytes);
  } catch {
    return blockedOperation(normalized, ref, "file", "ledger-projection-invalid-utf8", source);
  }
  if (!text.includes(PROJECTION_MARKERS[ref])) {
    return blockedOperation(normalized, ref, "file", "ledger-projection-unmanaged", source);
  }
  const stageRef = path.posix.join(path.posix.dirname(ref), stageName(base, target.digest));
  return {
    public: {
      ...base,
      classification: "derived-projection",
      source,
      target,
      action: "update-managed",
      reasonCode: "ledger-projection-rebuild",
      stageRef,
    },
    private: {
      targetPath,
      stagePath: path.join(path.dirname(targetPath), path.basename(stageRef)),
      targetBytes,
    },
  };
}

function stepFor(operation, ordinal) {
  const stage = operation.resourceKind === "file"
    ? { ref: `${operation.resourceRef}.stage`, ...operation.target }
    : null;
  return {
    stepId: operation.operationId,
    ordinal,
    stepKind: "create-or-update",
    source: { ref: operation.resourceRef, ...operation.source },
    staging: stage,
    final: { ref: operation.resourceRef, ...operation.target },
  };
}

function sourceProjection(normalized) {
  if (normalized.action === "fresh-initialize") {
    return buildEmptyLedgerProjection({
      programId: normalized.desiredModel.program.programId,
      programDisplayName: normalized.desiredModel.program.displayName,
    });
  }
  return inspectLedgerProjectionSource({
    ledgerRoot: normalized.ledgerRoot,
    programId: normalized.desiredModel.program.programId,
    programDisplayName: normalized.desiredModel.program.displayName,
  });
}

// fresh 只接受整个根 absent；非 fresh 必须先看见完整静态 authority 再重建投影。
function derivePlan(normalized) {
  const rootInspection = inspectDirectory(normalized.ledgerRoot);
  if (normalized.action === "fresh-initialize" && rootInspection.classification !== "missing") {
    const operation = blockedOperation(
      normalized,
      ".",
      "directory",
      rootInspection.classification === "unsafe" ? "fresh-ledger-root-unsafe" : "fresh-ledger-root-present",
      rootInspection.classification !== "unsafe" && rootInspection.stat
        ? { type: "directory", mode: modeString(rootInspection.stat), digest: directoryDigest(normalized.desiredModel.program.programId, ".") }
        : { type: "unsafe", mode: null, digest: null },
    );
    const payload = payloadFor(normalized, [operation.public], null);
    return { plan: validatePlanInternal({ schemaId: WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_ID, payload }), privateOperations: new Map() };
  }
  if (normalized.action !== "fresh-initialize" && rootInspection.classification === "missing") {
    const operation = blockedOperation(normalized, ".", "directory", "ledger-authority-root-missing", { type: "absent" });
    const payload = payloadFor(normalized, [operation.public], null);
    return { plan: validatePlanInternal({ schemaId: WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_ID, payload }), privateOperations: new Map() };
  }
  const classified = [];
  const plannedDirectories = new Set();
  for (const ref of DIRECTORY_REFS) {
    const parentRef = ref === "." ? null : path.posix.dirname(ref);
    const parentPlanned = parentRef === "."
      ? plannedDirectories.has(".")
      : plannedDirectories.has(parentRef);
    const entry = directoryOperation(normalized, ref, { parentPlanned });
    classified.push(entry);
    if (entry.public.action === "create-managed") plannedDirectories.add(ref);
  }
  if (classified.some((entry) => entry.public.action === "blocked")) {
    const byRef = new Map(classified.map((entry) => [entry.public.ref, entry]));
    const ordered = ORDERED_REFS.map((ref) => byRef.get(ref)).filter(Boolean);
    const operations = ordered.map((entry) => entry.public);
    return {
      plan: validatePlanInternal({
        schemaId: WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_ID,
        payload: payloadFor(normalized, operations, null),
      }),
      privateOperations: new Map(),
    };
  }
  let projection;
  try {
    projection = sourceProjection(normalized);
  } catch {
    const sourceFailure = blockedOperation(
      normalized,
      "workspace/workspace-record-map.md",
      "file",
      "ledger-authority-inventory-unsafe",
    );
    classified.push(sourceFailure);
    const byRef = new Map(classified.map((entry) => [entry.public.ref, entry]));
    const ordered = ORDERED_REFS.map((ref) => byRef.get(ref)).filter(Boolean);
    const operations = ordered.map((entry) => entry.public);
    return {
      plan: validatePlanInternal({
        schemaId: WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_ID,
        payload: payloadFor(normalized, operations, null),
      }),
      privateOperations: new Map(),
    };
  }
  if (projection !== null) {
    for (const ref of LEDGER_PROJECTION_PATHS) {
      classified.push(fileOperation(normalized, ref, projection.files[ref]));
    }
  }
  const byRef = new Map(classified.map((entry) => [entry.public.ref, entry]));
  const ordered = ORDERED_REFS.map((ref) => byRef.get(ref)).filter(Boolean);
  const operations = ordered.map((entry) => entry.public);
  const privateOperations = new Map(ordered
    .filter((entry) => entry.private !== null)
    .map((entry) => [entry.public.operationId, entry.private]));
  const payload = payloadFor(normalized, operations, projection);
  return {
    plan: validatePlanInternal({ schemaId: WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_ID, payload }),
    privateOperations,
  };
}

function payloadFor(normalized, operations, projection) {
  const blockers = operations.filter((entry) => entry.action === "blocked").map((entry) => ({
    blockerId: entry.operationId,
    operationId: entry.operationId,
    resourceRef: entry.resourceRef,
    code: entry.reasonCode,
  }));
  const steps = operations
    .filter((entry) => ["create-managed", "update-managed"].includes(entry.action))
    .map(stepFor);
  return {
    kind: WAKEFLOW_LEDGER_MATERIALIZATION_KIND,
    schemaVersion: WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_VERSION,
    action: normalized.action,
    status: blockers.length === 0 ? "ready" : "blocked",
    programId: normalized.desiredModel.program.programId,
    sourceModelDigest: normalized.sourceModel === null ? null : wakeflowConfigV3Digest(normalized.sourceModel),
    desiredModelDigest: wakeflowConfigV3Digest(normalized.desiredModel),
    ledgerRootRef: normalized.desiredModel.storage.ledgerRoot,
    projectionSourceDigest: projection?.sourceDigest ?? null,
    operations,
    blockers,
    steps,
  };
}

// ==================== 三、confirmed plan 的完整语义闭包 ====================

function validateNode(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (!isPlainObject(value) || typeof value.type !== "string") {
    fail("wakeflow-ledger-materialization-plan", `${label} must be a resource node`);
  }
  if (value.type === "absent") {
    exactKeys(value, ["type"], label);
    return value;
  }
  if (value.type === "unsafe") {
    exactKeys(value, ["type", "mode", "digest"], label);
    if (value.mode !== null || value.digest !== null) fail("wakeflow-ledger-materialization-plan", `${label} unsafe node must be redacted`);
    return value;
  }
  exactKeys(value, ["type", "mode", "digest"], label);
  if (
    !["directory", "file"].includes(value.type)
    || typeof value.mode !== "string"
    || !DIGEST_RE.test(value.digest)
  ) fail("wakeflow-ledger-materialization-plan", `${label} is invalid`);
  return value;
}

function assertPlanIdentity(payload) {
  try {
    assertWakeflowId(payload.programId, "program", "$/payload/programId");
  } catch (cause) {
    fail("wakeflow-ledger-materialization-plan", "ledger plan program identity is invalid", { cause });
  }
  const candidate = payload.ledgerRootRef;
  const normalized = typeof candidate === "string" ? path.posix.normalize(candidate) : null;
  if (
    typeof candidate !== "string"
    || !candidate.trim()
    || candidate !== candidate.trim()
    || candidate.includes("\\")
    || candidate.includes("\0")
    || /[\r\n]/u.test(candidate)
    || candidate.endsWith("/")
    || path.posix.isAbsolute(candidate)
    || /^[A-Za-z]:/u.test(candidate)
    || normalized !== candidate
    || normalized === "."
    || normalized.split("/").every((segment) => segment === "..")
  ) fail("wakeflow-ledger-materialization-plan", "ledgerRootRef is not one canonical relative placement");
  if ((payload.action === "fresh-initialize") !== (payload.sourceModelDigest === null)) {
    fail("wakeflow-ledger-materialization-plan", "source model identity does not match the maintenance action");
  }
}

function assertNodeEquals(actual, expected, message) {
  if (!sameCanonical(actual, expected)) {
    fail("wakeflow-ledger-materialization-plan", message);
  }
}

// operation 的 ID、owner、resourceRef 和 root 全部从 program/ref/ledgerRootRef 重算。
function assertOperationSkeleton(payload, operation) {
  const directory = DIRECTORY_REFS.includes(operation.ref);
  const expectedKind = directory ? "directory" : "file";
  const expected = {
    operationId: operationId(payload.programId, operation.ref),
    componentId: directory ? "ledger-layout" : "ledger-projection",
    owner: directory ? "ledger-service" : "ledger-projector",
    resourceKind: expectedKind,
    ref: operation.ref,
    resourceRef: resourceRef(payload.programId, operation.ref),
    root: {
      kind: "ledger",
      rootId: payload.programId,
      configuredPath: payload.ledgerRootRef,
      basis: "target",
    },
  };
  const actual = Object.fromEntries(Object.keys(expected).map((key) => [key, operation[key]]));
  if (!sameCanonical(actual, expected)) {
    fail("wakeflow-ledger-materialization-plan", "ledger operation identity is not payload-derived", {
      details: { ref: operation.ref },
    });
  }
}

function assertDirectoryOperation(payload, operation) {
  const digest = directoryDigest(payload.programId, operation.ref);
  const target = { type: "directory", mode: DIRECTORY_MODE, digest };
  if (operation.action === "current") {
    if (
      operation.classification !== "managed-current"
      || operation.reasonCode !== "ledger-directory-current"
      || operation.stageRef !== null
    ) fail("wakeflow-ledger-materialization-plan", "current ledger directory semantics are invalid");
    assertNodeEquals(operation.source, target, "current ledger directory source is not derived");
    assertNodeEquals(operation.target, target, "current ledger directory target is not derived");
    return;
  }
  if (operation.action === "create-managed") {
    if (
      operation.classification !== "managed-missing"
      || operation.reasonCode !== "ledger-directory-create"
      || operation.stageRef !== null
    ) fail("wakeflow-ledger-materialization-plan", "created ledger directory semantics are invalid");
    assertNodeEquals(operation.source, { type: "absent" }, "created ledger directory source is not absent");
    assertNodeEquals(operation.target, target, "created ledger directory target is not derived");
    return;
  }
  if (
    operation.action !== "blocked"
    || operation.classification !== "conflict"
    || operation.target !== null
    || operation.stageRef !== null
    || !DIRECTORY_BLOCK_REASONS.has(operation.reasonCode)
  ) fail("wakeflow-ledger-materialization-plan", "blocked ledger directory semantics are invalid");

  const rootOnly = new Set([
    "fresh-ledger-root-unsafe",
    "fresh-ledger-root-present",
    "ledger-authority-root-missing",
  ]);
  if (rootOnly.has(operation.reasonCode) && operation.ref !== ".") {
    fail("wakeflow-ledger-materialization-plan", "ledger root blocker is attached to a child directory");
  }
  if (
    operation.reasonCode === "ledger-authority-directory-missing"
    && (operation.ref === "." || payload.action === "fresh-initialize")
  ) fail("wakeflow-ledger-materialization-plan", "ledger child-authority blocker is invalid");
  if (
    operation.reasonCode.startsWith("fresh-")
    && payload.action !== "fresh-initialize"
  ) fail("wakeflow-ledger-materialization-plan", "fresh ledger blocker is attached to a non-fresh action");
  if (
    operation.reasonCode === "ledger-authority-root-missing"
    && payload.action === "fresh-initialize"
  ) fail("wakeflow-ledger-materialization-plan", "existing-authority blocker is attached to fresh initialization");

  if (["ledger-authority-root-missing", "ledger-authority-directory-missing", "ledger-directory-parent-unavailable"].includes(operation.reasonCode)) {
    assertNodeEquals(operation.source, { type: "absent" }, "missing ledger directory source is not absent");
  } else if (["fresh-ledger-root-unsafe", "ledger-directory-unsafe"].includes(operation.reasonCode)) {
    assertNodeEquals(
      operation.source,
      { type: "unsafe", mode: null, digest: null },
      "unsafe ledger directory source is not redacted",
    );
  } else {
    if (
      operation.source.type !== "directory"
      || operation.source.digest !== digest
      || !/^0[0-7]{3}$/u.test(operation.source.mode)
      || (operation.reasonCode === "ledger-directory-mode-drift" && operation.source.mode === DIRECTORY_MODE)
    ) fail("wakeflow-ledger-materialization-plan", "observed ledger directory source is invalid");
  }
}

function assertFileOperation(operation) {
  if (operation.action === "current") {
    if (
      operation.classification !== "derived-projection"
      || operation.reasonCode !== "ledger-projection-current"
      || operation.stageRef !== null
      || operation.source.type !== "file"
      || operation.source.mode !== FILE_MODE
    ) fail("wakeflow-ledger-materialization-plan", "current ledger projection semantics are invalid");
    assertNodeEquals(operation.target, operation.source, "current ledger projection changes bytes");
    return;
  }
  if (["create-managed", "update-managed"].includes(operation.action)) {
    const creating = operation.action === "create-managed";
    if (
      operation.classification !== "derived-projection"
      || operation.reasonCode !== (creating ? "ledger-projection-create" : "ledger-projection-rebuild")
      || operation.target?.type !== "file"
      || operation.target.mode !== FILE_MODE
      || (creating && operation.source.type !== "absent")
      || (!creating && (
        operation.source.type !== "file"
        || operation.source.mode !== FILE_MODE
        || operation.source.digest === operation.target.digest
      ))
    ) fail("wakeflow-ledger-materialization-plan", "writable ledger projection semantics are invalid");
    const expectedStage = path.posix.join(
      path.posix.dirname(operation.ref),
      stageName(operation, operation.target.digest),
    );
    if (operation.stageRef !== expectedStage) {
      fail("wakeflow-ledger-materialization-plan", "ledger projection stage is not target-derived");
    }
    return;
  }
  if (
    operation.action !== "blocked"
    || operation.classification !== "conflict"
    || operation.target !== null
    || operation.stageRef !== null
    || !FILE_BLOCK_REASONS.has(operation.reasonCode)
  ) fail("wakeflow-ledger-materialization-plan", "blocked ledger projection semantics are invalid");
  if (
    operation.reasonCode === "ledger-authority-inventory-unsafe"
    && operation.ref !== "workspace/workspace-record-map.md"
  ) fail("wakeflow-ledger-materialization-plan", "ledger inventory blocker is attached to the wrong projection");
  if (["ledger-projection-invalid-utf8", "ledger-projection-unmanaged"].includes(operation.reasonCode)) {
    if (operation.source.type !== "file" || operation.source.mode !== FILE_MODE) {
      fail("wakeflow-ledger-materialization-plan", "blocked ledger projection source is invalid");
    }
  } else {
    assertNodeEquals(
      operation.source,
      { type: "unsafe", mode: null, digest: null },
      "unsafe ledger projection source is not redacted",
    );
  }
}

// 只接纳 producer 可达的 1/5/6/9 项拓扑，禁止删减操作后重算 digest 自签名。
function assertOperationTopology(payload) {
  const refs = payload.operations.map((operation) => operation.ref);
  const expected = refs.length === 1
    ? ["."]
    : refs.length === DIRECTORY_REFS.length
      ? DIRECTORY_REFS
      : refs.length === DIRECTORY_REFS.length + 1
        ? [...DIRECTORY_REFS, "workspace/workspace-record-map.md"]
        : refs.length === ORDERED_REFS.length
          ? ORDERED_REFS
          : null;
  if (expected === null || !sameCanonical(refs, expected)) {
    fail("wakeflow-ledger-materialization-plan", "ledger operation topology is not producer-reachable");
  }
  const full = refs.length === ORDERED_REFS.length;
  if ((payload.projectionSourceDigest !== null) !== full) {
    fail("wakeflow-ledger-materialization-plan", "projection source identity does not match the operation topology");
  }
  if (payload.action === "fresh-initialize") {
    const rootFootprintBlock = refs.length === 1
      && payload.operations[0].action === "blocked"
      && payload.operations[0].reasonCode.startsWith("fresh-");
    const unavailableParentBlock = refs.length === DIRECTORY_REFS.length
      && payload.operations.every((operation) => (
        operation.action === "blocked"
        && operation.reasonCode === "ledger-directory-parent-unavailable"
      ));
    if (
      (full && payload.operations.some((operation) => operation.action !== "create-managed"))
      || (!full && !rootFootprintBlock && !unavailableParentBlock)
    ) fail("wakeflow-ledger-materialization-plan", "fresh ledger operation topology is invalid");
    return;
  }
  if (full && payload.operations.slice(0, DIRECTORY_REFS.length).some((operation) => operation.action !== "current")) {
    fail("wakeflow-ledger-materialization-plan", "existing ledger projections lack current authority directories");
  }
  if (refs.length === DIRECTORY_REFS.length + 1) {
    if (
      payload.operations.slice(0, DIRECTORY_REFS.length).some((operation) => operation.action !== "current")
      || payload.operations.at(-1).reasonCode !== "ledger-authority-inventory-unsafe"
    ) fail("wakeflow-ledger-materialization-plan", "ledger inventory-failure topology is invalid");
  }
  if (
    refs.length === DIRECTORY_REFS.length
    && !payload.operations.some((operation) => operation.action === "blocked")
  ) fail("wakeflow-ledger-materialization-plan", "partial ledger directory topology has no blocker");
  if (refs.length === 1 && payload.operations[0].reasonCode !== "ledger-authority-root-missing") {
    fail("wakeflow-ledger-materialization-plan", "single existing-ledger operation has the wrong blocker");
  }
}

function validatePlanInternal(value) {
  const plan = canonicalSnapshot(value, "ledger materialization plan");
  exactKeys(plan, ["schemaId", "payload"], "ledger materialization plan");
  if (plan.schemaId !== WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_ID) {
    fail("wakeflow-ledger-materialization-plan", "ledger materialization schema identity is invalid");
  }
  const payloadKeys = [
    "kind", "schemaVersion", "action", "status", "programId", "sourceModelDigest",
    "desiredModelDigest", "ledgerRootRef", "projectionSourceDigest", "operations", "blockers", "steps",
  ];
  exactKeys(plan.payload, payloadKeys, "ledger materialization payload");
  const payload = plan.payload;
  if (
    payload.kind !== WAKEFLOW_LEDGER_MATERIALIZATION_KIND
    || payload.schemaVersion !== WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_VERSION
    || !ACTIONS.has(payload.action)
    || !DIGEST_RE.test(payload.desiredModelDigest)
    || (payload.sourceModelDigest !== null && !DIGEST_RE.test(payload.sourceModelDigest))
    || (payload.projectionSourceDigest !== null && !DIGEST_RE.test(payload.projectionSourceDigest))
    || !Array.isArray(payload.operations)
    || !Array.isArray(payload.blockers)
    || !Array.isArray(payload.steps)
  ) fail("wakeflow-ledger-materialization-plan", "ledger materialization metadata is invalid");
  assertPlanIdentity(payload);
  const ids = new Set();
  let lastOrder = -1;
  for (const [index, operation] of payload.operations.entries()) {
    const keys = [
      "operationId", "componentId", "owner", "resourceKind", "ref", "resourceRef", "root",
      "classification", "source", "target", "action", "reasonCode", "stageRef",
    ];
    exactKeys(operation, keys, `ledger operation ${index}`);
    const order = ORDERED_REFS.indexOf(operation.ref);
    if (
      typeof operation.operationId !== "string"
      || ids.has(operation.operationId)
      || order < 0
      || order <= lastOrder
      || !["directory", "file"].includes(operation.resourceKind)
      || !["current", "create-managed", "update-managed", "blocked"].includes(operation.action)
    ) fail("wakeflow-ledger-materialization-plan", "ledger operation identity or ordering is invalid");
    ids.add(operation.operationId);
    lastOrder = order;
    validateNode(operation.source, `ledger operation ${index} source`);
    validateNode(operation.target, `ledger operation ${index} target`, { nullable: true });
    assertOperationSkeleton(payload, operation);
    if (operation.resourceKind === "directory") assertDirectoryOperation(payload, operation);
    else assertFileOperation(operation);
  }
  assertOperationTopology(payload);
  const expectedBlockers = payload.operations.filter((entry) => entry.action === "blocked").map((entry) => ({
    blockerId: entry.operationId,
    operationId: entry.operationId,
    resourceRef: entry.resourceRef,
    code: entry.reasonCode,
  }));
  if (!sameCanonical(payload.blockers, expectedBlockers)) {
    fail("wakeflow-ledger-materialization-plan", "ledger blockers are not derived");
  }
  const expectedSteps = payload.operations
    .filter((entry) => ["create-managed", "update-managed"].includes(entry.action))
    .map(stepFor);
  if (
    !sameCanonical(payload.steps, expectedSteps)
    || payload.status !== (payload.blockers.length === 0 ? "ready" : "blocked")
  ) fail("wakeflow-ledger-materialization-plan", "ledger steps or status are not derived");
  return deepFreeze(plan);
}

// ==================== 四、maintenance 公开适配与 M3 participant ====================

/**
 * 只读检查当前 ledger footprint，并返回可确认的 ready/blocked owner plan；不会创建任何节点。
 */
export function planWakeflowLedgerMaterialization(value) {
  return derivePlan(normalizeInput(value)).plan;
}

/**
 * 重新闭合 plan 的字段、操作骨架、action/node/reason/stage 矩阵及 blocker/step 派生关系。
 */
export function validateWakeflowLedgerMaterializationPlan(value) {
  return validatePlanInternal(value);
}

/**
 * 把一个已闭合 owner plan 投影为 aggregate maintenance 的 component/action/check/step；
 * 此入口不重新观察磁盘，也不执行 effect。
 */
export function projectWakeflowLedgerMaterializationMaintenance(value) {
  const input = exactKeys(
    canonicalSnapshot(value, "ledger maintenance projection input"),
    ["plan", "transactionOffset"],
    "ledger maintenance projection input",
  );
  const plan = validatePlanInternal(input.plan);
  if (!Number.isSafeInteger(input.transactionOffset) || input.transactionOffset < 0) {
    fail("wakeflow-ledger-materialization-input", "transactionOffset must be one non-negative safe integer");
  }
  const planDigest = canonicalJsonDigest(plan);
  const stepIndex = new Map(plan.payload.steps.map((entry, index) => [entry.stepId, index]));
  const filesystemActions = plan.payload.operations.filter((entry) => entry.action !== "blocked").map((entry) => {
    const index = stepIndex.get(entry.operationId);
    const physical = index !== undefined;
    return {
      actionId: entry.operationId,
      componentId: entry.componentId,
      owner: entry.owner,
      root: entry.root,
      ref: entry.ref,
      resourceRef: entry.resourceRef,
      classification: entry.classification,
      source: entry.source,
      target: entry.target,
      action: entry.action,
      authorization: { kind: "wakeflow-owned" },
      reasonCode: entry.reasonCode,
      stepId: physical ? entry.operationId : null,
      commitOrder: physical ? input.transactionOffset + index : null,
    };
  });
  const dependencyChecks = plan.payload.blockers.map((entry) => {
    const operation = plan.payload.operations.find((candidate) => candidate.operationId === entry.operationId);
    return {
      checkId: `ledger-blocked-${entry.operationId}`,
      componentId: operation.componentId,
      owner: operation.owner,
      subject: { kind: "resource", value: entry.resourceRef },
      status: "blocked",
      code: entry.code,
      evidence: [{ kind: "owner-plan", ref: entry.resourceRef, digest: planDigest }],
    };
  });
  return deepFreeze({
    components: [
      { componentId: "ledger-layout", owner: "ledger-service", ownerPlanDigest: planDigest },
      { componentId: "ledger-projection", owner: "ledger-projector", ownerPlanDigest: planDigest },
    ],
    filesystemActions,
    dependencyChecks,
    preserved: [],
    deferredOwnerActions: dependencyChecks.map((entry) => ({
      deferredId: entry.checkId,
      componentId: entry.componentId,
      owner: entry.owner,
      action: "resolve-ledger-materialization-conflict",
      subject: entry.subject,
      prerequisiteCheckIds: [entry.checkId],
      reasonCode: entry.code,
    })),
    blockers: dependencyChecks.map((entry) => ({
      blockerId: entry.checkId,
      componentId: entry.componentId,
      owner: entry.owner,
      subject: entry.subject,
      code: entry.code,
      dependencyCheckId: entry.checkId,
    })),
    steps: plan.payload.steps.map((step, index) => ({ ...step, ordinal: input.transactionOffset + index })),
  });
}

function assertConfigAuthority(normalized, context = null) {
  try {
    assertWakeflowConfigV3TransitionAuthority({
      workspaceRoot: normalized.workspaceRoot,
      action: normalized.action,
      sourceModel: normalized.sourceModel,
      desiredModel: normalized.desiredModel,
      context,
    });
  } catch (cause) {
    fail("wakeflow-ledger-materialization-config", "strict config authority is unavailable", { cause });
  }
}

// participant 建立前重取精确投影来源；sourceDigest 不同即按 stale 拒绝。
function projectionForConfirmed(normalized, confirmedPlan) {
  if (normalized.action === "fresh-initialize") {
    return buildEmptyLedgerProjection({
      programId: normalized.desiredModel.program.programId,
      programDisplayName: normalized.desiredModel.program.displayName,
    });
  }
  const projection = inspectLedgerProjectionSource({
    ledgerRoot: normalized.ledgerRoot,
    programId: normalized.desiredModel.program.programId,
    programDisplayName: normalized.desiredModel.program.displayName,
  });
  if (projection.sourceDigest !== confirmedPlan.payload.projectionSourceDigest) {
    fail("wakeflow-ledger-materialization-stale", "ledger authority changed since plan confirmation");
  }
  return projection;
}

/**
 * 把 ready confirmed plan 绑定到当前 config authority 和私有目标字节，交由共享 M3
 * primitive 执行 prepare/commit/recovery；领域语义与物理事务仍保持两层 owner。
 */
export function createWakeflowLedgerMaterializationMutationParticipant(value) {
  const normalized = normalizeInput(value, { participant: true });
  const confirmedPlan = validatePlanInternal(normalized.confirmedPlan);
  if (confirmedPlan.payload.status !== "ready") {
    fail("wakeflow-ledger-materialization-blocked", "a blocked ledger plan cannot create a participant");
  }
  const projection = projectionForConfirmed(normalized, confirmedPlan);
  const operationById = new Map(confirmedPlan.payload.operations.map((entry) => [entry.operationId, entry]));
  const privateOperations = confirmedPlan.payload.steps.map((step) => {
    const operation = operationById.get(step.stepId);
    const targetPath = operation.ref === "."
      ? normalized.ledgerRoot
      : path.join(normalized.ledgerRoot, ...operation.ref.split("/"));
    if (operation.resourceKind === "directory") {
      return {
        stepId: step.stepId,
        kind: "directory",
        targetPath,
        stagePath: null,
        targetBytes: null,
        maxFileBytes: null,
      };
    }
    const targetBytes = Buffer.from(projection.files[operation.ref], "utf8");
    return {
      stepId: step.stepId,
      kind: "file",
      targetPath,
      stagePath: path.join(path.dirname(targetPath), path.basename(operation.stageRef)),
      targetBytes,
      maxFileBytes: MAX_LEDGER_PROJECTION_BYTES,
    };
  });
  return createWakeflowTrackedMaterializationParticipant({
    workspaceRoot: normalized.workspaceRoot,
    confirmedPlan,
    validatePlan: validatePlanInternal,
    deriveCurrentPlan() {
      return derivePlan(normalized).plan;
    },
    validateAuthority({ context }) {
      assertConfigAuthority(normalized, context);
      return { valid: true };
    },
    privateOperations,
    closureName: "ledger-materialization-closure",
  });
}
