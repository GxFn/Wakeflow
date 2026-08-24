import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
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
import {
  EMPTY_TODO_BOARD,
  TODO_BOARD_MAX_BYTES,
  TODO_BOARD_REF,
  scanTodoBoard,
} from "./wakeflow-todo-service.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { createWakeflowTrackedMaterializationParticipant } from "./wakeflow-tracked-materialization.mjs";
import { assertWakeflowMutationContext } from "./wakeflow-workspace-mutation.mjs";

/**
 * `.wakeflow-active`静态基础层，只拥有三个首次物化资源：活动根、current根和全局TODO权威。
 *
 * 职责导航：
 * 1. normalizeInput闭合维护动作、配置模型与程序身份，不读取投影内容。
 * 2. inspectDirectory/inspectTodo只观察三个静态资源，并把未知或不安全状态转成blocker。
 * 3. derivePlan生成不含绝对路径的owner plan；codec同时证明固定资源集合没有被删减或重映射。
 * 4. inspectWakeflowFreshTodoTransitionAuthority只识别TODO首次提交的absent/strict/committed-pair三种物理状态。
 * 5. participant把确认计划交给既有tracked-materialization与workspace mutation执行，不另建gate或journal。
 *
 * 本模块不拥有workspace状态投影、demand目录、TODO后续写入或恢复状态机；这些职责分别属于
 * active projector、demand owner、TODO service和workspace mutation。
 */

export const WAKEFLOW_ACTIVE_FOUNDATION_SCHEMA_ID = "urn:wakeflow:internal:active-foundation-plan:v1";
export const WAKEFLOW_ACTIVE_FOUNDATION_KIND = "WakeflowActiveFoundationPlan";
export const WAKEFLOW_ACTIVE_FOUNDATION_SCHEMA_VERSION = 1;

const ACTIONS = new Set(["fresh-initialize", "reconfigure", "reconcile"]);
const ACTIVE_ROOT_REF = ".wakeflow-active";
const CURRENT_ROOT_REF = `${ACTIVE_ROOT_REF}/current`;
const DIRECTORY_MODE = "0755";
const TODO_MODE = "0644";
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;

// ==================== 一、错误合同、严格数据准入与维护输入 ====================

export class WakeflowActiveFoundationError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowActiveFoundationError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowActiveFoundationError(code, message, {
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
  if (!isPlainObject(value)) {
    fail("wakeflow-active-foundation-contract", `${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("wakeflow-active-foundation-contract", `${label} has an invalid field set`, {
      details: { expected, actual: actual.map(String) },
    });
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-active-foundation-contract", `${label}.${key} must be an enumerable data property`);
    }
  }
  return value;
}

function canonicalSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-active-foundation-canonical", `${label} must be canonical JSON data`, { cause });
  }
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail("wakeflow-active-foundation-platform", "active foundation requires POSIX ownership semantics");
  }
  return process.geteuid();
}

function modeString(stat) {
  return `0${(stat.mode & 0o777).toString(8).padStart(3, "0")}`;
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

// 把planner和participant输入收敛为同一份配置语义；confirmedPlan只在participant边界增加。
function normalizeInput(value, { participant = false } = {}) {
  const expected = [
    "workspaceRoot",
    "action",
    "sourceModel",
    "desiredModel",
    ...(participant ? ["confirmedPlan"] : []),
  ];
  const input = exactKeys(
    value,
    expected,
    participant ? "active foundation participant input" : "active foundation planning input",
  );
  if (
    typeof input.workspaceRoot !== "string"
    || !input.workspaceRoot.trim()
    || input.workspaceRoot !== input.workspaceRoot.trim()
    || !path.isAbsolute(path.resolve(input.workspaceRoot))
  ) {
    fail("wakeflow-active-foundation-input", "workspaceRoot is required");
  }
  const workspaceRoot = path.resolve(input.workspaceRoot);
  if (!ACTIONS.has(input.action)) {
    fail("wakeflow-active-foundation-input", "action is invalid");
  }
  const sourceModel = input.sourceModel === null
    ? null
    : parseWakeflowConfigV3(input.sourceModel);
  const desiredModel = parseWakeflowConfigV3(input.desiredModel);
  if (input.action === "fresh-initialize" && sourceModel !== null) {
    fail("wakeflow-active-foundation-input", "fresh-initialize requires sourceModel=null");
  }
  if (input.action !== "fresh-initialize" && sourceModel === null) {
    fail("wakeflow-active-foundation-input", `${input.action} requires one strict source model`);
  }
  if (sourceModel !== null && sourceModel.program.programId !== desiredModel.program.programId) {
    fail("wakeflow-active-foundation-input", "source and desired program identities differ");
  }
  if (
    input.action === "reconcile"
    && wakeflowConfigV3Digest(sourceModel) !== wakeflowConfigV3Digest(desiredModel)
  ) {
    fail("wakeflow-active-foundation-input", "reconcile cannot change config semantics");
  }
  return {
    workspaceRoot,
    action: input.action,
    sourceModel,
    desiredModel,
    ...(participant ? { confirmedPlan: input.confirmedPlan } : {}),
  };
}

// ==================== 二、静态目录与TODO权威的稳定观察 ====================

// 静态目录必须是真实、当前进程所有且mode精确的目录；本层不擅自修复mode漂移。
function inspectDirectory(candidate) {
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch (cause) {
    if (cause?.code === "ENOENT") return { classification: "missing", stat: null };
    return { classification: "unsafe", stat: null };
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== currentEuid()) {
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

function sameFile(left, right) {
  return left.isFile()
    && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function todoWriterResidue(boardFile) {
  const directory = path.dirname(boardFile);
  const basename = path.basename(boardFile);
  let names;
  try {
    names = readdirSync(directory);
  } catch {
    return true;
  }
  return names.some((name) => (
    name === `${basename}.lock`
    || name.startsWith(`.${basename}.wakeflow-stage-`)
    || name.startsWith(`.${basename}.wakeflow-maintenance-`)
  ));
}

// TODO是长期权威，不是可重建投影；非fresh动作只能验证，绝不能在缺失或损坏时重建。
function inspectTodo(boardFile) {
  let before;
  try {
    before = lstatSync(boardFile, { bigint: true });
  } catch (cause) {
    return cause?.code === "ENOENT"
      ? { classification: "missing", digest: null }
      : { classification: "unsafe", digest: null };
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || before.uid !== BigInt(currentEuid())
    || Number(before.mode & 0o777n) !== 0o644
    || before.size > BigInt(TODO_BOARD_MAX_BYTES)
    || todoWriterResidue(boardFile)
  ) {
    return { classification: "unsafe", digest: null };
  }
  let descriptor;
  try {
    descriptor = openSync(boardFile, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameFile(before, opened)) return { classification: "unsafe", digest: null };
    const bytes = readFileSync(descriptor);
    const after = lstatSync(boardFile, { bigint: true });
    if (!sameFile(opened, after) || BigInt(bytes.length) !== opened.size) {
      return { classification: "unsafe", digest: null };
    }
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const board = scanTodoBoard(content);
      return { classification: "current", digest: board.boardDigest };
    } catch {
      return { classification: "invalid", digest: digestBytes(bytes) };
    }
  } catch {
    return { classification: "unsafe", digest: null };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

// ==================== 三、固定资源操作与首次TODO提交过渡 ====================

function directoryDigest(programId, ref) {
  return canonicalJsonDigest({
    kind: "WakeflowActiveStaticDirectory",
    schemaVersion: 1,
    programId,
    ref,
    mode: DIRECTORY_MODE,
  });
}

function operationId(componentId, ref) {
  const suffix = createHash("sha256").update(`${componentId}\0${ref}`).digest("hex").slice(0, 32);
  return `active-foundation-${suffix}`;
}

function resourceRef(programId, ref) {
  return `targets/program/${programId}/${ref}`;
}

function rootDescriptor(programId) {
  return { kind: "program", rootId: programId, basis: "target", configuredPath: "." };
}

function directoryOperation(programId, ref, inspection, action) {
  const digest = directoryDigest(programId, ref);
  const base = {
    operationId: operationId("active-layout", ref),
    componentId: "active-layout",
    owner: "layout-manager",
    ref,
    resourceRef: resourceRef(programId, ref),
    root: rootDescriptor(programId),
  };
  if (action === "fresh-initialize" && inspection.classification === "missing") {
    return {
      ...base,
      classification: "managed-missing",
      source: { type: "absent" },
      target: { type: "directory", mode: DIRECTORY_MODE, digest },
      action: "create-managed",
      reasonCode: "active-static-create",
    };
  }
  if (action === "fresh-initialize") {
    return {
      ...base,
      classification: "conflict",
      source: { type: "unsafe", mode: null, digest: null },
      target: null,
      action: "blocked",
      reasonCode: "fresh-active-footprint-present",
    };
  }
  if (inspection.classification === "current") {
    const node = { type: "directory", mode: DIRECTORY_MODE, digest };
    return {
      ...base,
      classification: "managed-current",
      source: node,
      target: node,
      action: "current",
      reasonCode: "active-static-current",
    };
  }
  return {
    ...base,
    classification: "conflict",
    source: inspection.classification === "missing"
      ? { type: "absent" }
      : { type: "unsafe", mode: null, digest: null },
    target: null,
    action: "blocked",
    reasonCode: action === "fresh-initialize"
      ? "fresh-active-footprint-present"
      : inspection.classification === "missing"
        ? "active-layout-missing"
        : inspection.classification === "mode-drift"
          ? "active-layout-mode-drift"
          : "active-layout-unsafe",
  };
}

function todoOperation(programId, inspection, action) {
  const base = {
    operationId: operationId("todo-authority", TODO_BOARD_REF),
    componentId: "todo-authority",
    owner: "todo-service",
    ref: TODO_BOARD_REF,
    resourceRef: resourceRef(programId, TODO_BOARD_REF),
    root: rootDescriptor(programId),
  };
  const targetDigest = digestBytes(Buffer.from(EMPTY_TODO_BOARD, "utf8"));
  if (action === "fresh-initialize" && inspection.classification === "missing") {
    return {
      ...base,
      classification: "managed-missing",
      source: { type: "absent" },
      target: { type: "file", mode: TODO_MODE, digest: targetDigest },
      action: "create-managed",
      reasonCode: "todo-authority-create",
    };
  }
  if (inspection.classification === "current") {
    const node = { type: "file", mode: TODO_MODE, digest: inspection.digest };
    return {
      ...base,
      classification: "managed-current",
      source: node,
      target: node,
      action: "current",
      reasonCode: "todo-authority-current",
    };
  }
  const code = action === "fresh-initialize"
    ? "fresh-active-footprint-present"
    : inspection.classification === "missing"
      ? "todo-authority-missing"
      : inspection.classification === "invalid"
        ? "todo-authority-invalid"
        : "todo-authority-unsafe";
  return {
    ...base,
    classification: "conflict",
    source: inspection.classification === "missing"
      ? { type: "absent" }
      : { type: "unsafe", mode: null, digest: null },
    target: null,
    action: "blocked",
    reasonCode: code,
  };
}

function todoStageRef(operation) {
  const suffix = operation.operationId.slice("active-foundation-".length, "active-foundation-".length + 16);
  return `${CURRENT_ROOT_REF}/.global-todo-board.md.wakeflow-maintenance-${suffix}`;
}

// 对TODO final/stage做同一inode、稳定字节和mode检查，避免把近似残留当成合法恢复阶段。
function inspectTodoTransitionFile(candidate) {
  let before;
  try {
    before = lstatSync(candidate, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    fail("wakeflow-active-foundation-transition", "TODO transition source cannot be inspected", { cause });
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.uid !== BigInt(currentEuid())
    || Number(before.mode & 0o777n) !== 0o644
    || before.size > BigInt(TODO_BOARD_MAX_BYTES)
  ) fail("wakeflow-active-foundation-transition", "TODO transition source is unsafe");
  let descriptor;
  try {
    descriptor = openSync(candidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameFile(before, opened)) {
      fail("wakeflow-active-foundation-transition", "TODO transition source changed while opening");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const refreshed = lstatSync(candidate, { bigint: true });
    if (
      !sameFile(opened, after)
      || !sameFile(after, refreshed)
      || BigInt(bytes.length) !== after.size
    ) fail("wakeflow-active-foundation-transition", "TODO transition source changed while reading");
    return { stat: after, bytes };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * 识别fresh事务中TODO authority的精确物理阶段。
 * 输入为绝对workspaceRoot和可空M3 context；输出只含portable ref与状态，不泄露stat或路径。
 * committed-pair只有在精确branded mutation context内才可见，普通观察不能据此猜测恢复权。
 */
export function inspectWakeflowFreshTodoTransitionAuthority(value) {
  const input = exactKeys(
    value,
    ["workspaceRoot", "context"],
    "fresh TODO transition authority input",
  );
  if (
    typeof input.workspaceRoot !== "string"
    || !input.workspaceRoot
    || path.resolve(input.workspaceRoot) !== input.workspaceRoot
  ) fail("wakeflow-active-foundation-transition", "fresh TODO transition workspace is invalid");
  const todoOperationId = operationId("todo-authority", TODO_BOARD_REF);
  const stageRef = todoStageRef({ operationId: todoOperationId });
  const final = inspectTodoTransitionFile(path.join(input.workspaceRoot, ...TODO_BOARD_REF.split("/")));
  const stage = inspectTodoTransitionFile(path.join(input.workspaceRoot, ...stageRef.split("/")));
  const expectedBytes = Buffer.from(EMPTY_TODO_BOARD, "utf8");
  const currentDirectory = path.join(input.workspaceRoot, ...CURRENT_ROOT_REF.split("/"));
  let residue = [];
  try {
    residue = readdirSync(currentDirectory).filter((name) => (
      name === "global-todo-board.md.lock"
      || name.startsWith(".global-todo-board.md.wakeflow-stage-")
      || name.startsWith(".global-todo-board.md.wakeflow-maintenance-")
    ));
  } catch (cause) {
    if (cause?.code !== "ENOENT") {
      fail("wakeflow-active-foundation-transition", "TODO transition namespace cannot be inspected", { cause });
    }
  }
  if (final === null && stage === null && residue.length === 0) {
    return deepFreeze({ status: "absent", finalRef: TODO_BOARD_REF, stageRef });
  }
  if (
    final !== null
    && stage === null
    && final.stat.nlink === 1n
    && final.bytes.equals(expectedBytes)
    && residue.length === 0
  ) return deepFreeze({ status: "strict", finalRef: TODO_BOARD_REF, stageRef });
  if (
    final === null
    || stage === null
    || final.stat.nlink !== 2n
    || stage.stat.nlink !== 2n
    || final.stat.dev !== stage.stat.dev
    || final.stat.ino !== stage.stat.ino
    || !final.bytes.equals(expectedBytes)
    || !stage.bytes.equals(expectedBytes)
    || residue.length !== 1
    || residue[0] !== path.posix.basename(stageRef)
  ) fail("wakeflow-active-foundation-transition", "fresh TODO transition pair is not exact");
  if (input.context === null || typeof input.context !== "object") {
    fail("wakeflow-active-foundation-transition", "fresh TODO transition pair requires the exact M3 gate");
  }
  try {
    const mode = input.context.recoveryGeneration > 0 ? "recovery-cleanup" : "maintenance";
    assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context: input.context, mode });
  } catch (cause) {
    fail("wakeflow-active-foundation-transition", "fresh TODO transition pair requires the exact M3 gate", {
      cause,
    });
  }
  return deepFreeze({ status: "committed-pair", finalRef: TODO_BOARD_REF, stageRef });
}

// ==================== 四、owner plan派生与闭合codec ====================

function stepFor(operation, ordinal) {
  const staging = operation.target.type === "file"
    ? {
        ref: resourceRef(operation.root.rootId, todoStageRef(operation)),
        type: "file",
        mode: operation.target.mode,
        digest: operation.target.digest,
      }
    : null;
  return {
    stepId: operation.operationId,
    ordinal,
    stepKind: "create-or-update",
    source: { ref: operation.resourceRef, ...operation.source },
    staging,
    final: { ref: operation.resourceRef, ...operation.target },
  };
}

function derivePlan(normalized) {
  const programId = normalized.desiredModel.program.programId;
  const activeRoot = path.join(normalized.workspaceRoot, ACTIVE_ROOT_REF);
  const currentRoot = path.join(normalized.workspaceRoot, CURRENT_ROOT_REF);
  const rootInspection = inspectDirectory(activeRoot);
  let operations;
  if (normalized.action === "fresh-initialize" && rootInspection.classification !== "missing") {
    operations = [directoryOperation(programId, ACTIVE_ROOT_REF, rootInspection, normalized.action)];
  } else {
    const rootOperation = directoryOperation(programId, ACTIVE_ROOT_REF, rootInspection, normalized.action);
    const currentInspection = rootOperation.action === "create-managed"
      ? { classification: "missing", stat: null }
      : inspectDirectory(currentRoot);
    const currentOperation = directoryOperation(
      programId,
      CURRENT_ROOT_REF,
      currentInspection,
      normalized.action,
    );
    const todoInspection = currentOperation.action === "create-managed"
      ? { classification: "missing", digest: null }
      : currentOperation.action === "current"
        ? inspectTodo(path.join(normalized.workspaceRoot, ...TODO_BOARD_REF.split("/")))
        : { classification: "unsafe", digest: null };
    operations = [rootOperation, currentOperation, todoOperation(programId, todoInspection, normalized.action)];
  }
  const blockers = operations
    .filter((entry) => entry.action === "blocked")
    .map((entry) => ({
      blockerId: entry.operationId,
      operationId: entry.operationId,
      componentId: entry.componentId,
      resourceRef: entry.resourceRef,
      code: entry.reasonCode,
    }));
  const steps = operations
    .filter((entry) => entry.action === "create-managed")
    .map(stepFor);
  const payload = {
    kind: WAKEFLOW_ACTIVE_FOUNDATION_KIND,
    schemaVersion: WAKEFLOW_ACTIVE_FOUNDATION_SCHEMA_VERSION,
    action: normalized.action,
    status: blockers.length === 0 ? "ready" : "blocked",
    programId,
    sourceModelDigest: normalized.sourceModel === null
      ? null
      : wakeflowConfigV3Digest(normalized.sourceModel),
    desiredModelDigest: wakeflowConfigV3Digest(normalized.desiredModel),
    operations,
    blockers,
    steps,
  };
  return validatePlanInternal({ schemaId: WAKEFLOW_ACTIVE_FOUNDATION_SCHEMA_ID, payload });
}

function validateNode(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (!isPlainObject(value) || typeof value.type !== "string") {
    fail("wakeflow-active-foundation-plan", `${label} must be one resource node`);
  }
  if (value.type === "absent") {
    exactKeys(value, ["type"], label);
    return value;
  }
  if (value.type === "unsafe") {
    exactKeys(value, ["type", "mode", "digest"], label);
    if (value.mode !== null || value.digest !== null) {
      fail("wakeflow-active-foundation-plan", `${label} unsafe node must be redacted`);
    }
    return value;
  }
  exactKeys(value, ["type", "mode", "digest"], label);
  if (
    !new Set(["directory", "file"]).has(value.type)
    || typeof value.mode !== "string"
    || !DIGEST_RE.test(value.digest)
  ) {
    fail("wakeflow-active-foundation-plan", `${label} is invalid`);
  }
  return value;
}

function assertProgramId(value) {
  try {
    assertWakeflowId(value, "program", "$activeFoundation/programId");
  } catch {
    fail("wakeflow-active-foundation-plan", "active foundation program identity is invalid");
  }
}

function expectedOperationIdentity(programId, ref) {
  if (ref === TODO_BOARD_REF) {
    return {
      componentId: "todo-authority",
      owner: "todo-service",
      operationId: operationId("todo-authority", ref),
    };
  }
  return {
    componentId: "active-layout",
    owner: "layout-manager",
    operationId: operationId("active-layout", ref),
  };
}

function expectedCurrentNode(programId, operation) {
  if (operation.ref === TODO_BOARD_REF) {
    return { type: "file", mode: TODO_MODE, digest: operation.source.digest };
  }
  return {
    type: "directory",
    mode: DIRECTORY_MODE,
    digest: directoryDigest(programId, operation.ref),
  };
}

// 固定三资源plan不能只满足“字段像plan”；component、owner、root、动作和节点语义也必须闭合。
function assertOperationSemantics(operation, payload) {
  const expectedIdentity = expectedOperationIdentity(payload.programId, operation.ref);
  if (
    operation.componentId !== expectedIdentity.componentId
    || operation.owner !== expectedIdentity.owner
    || operation.operationId !== expectedIdentity.operationId
    || !sameCanonical(operation.root, rootDescriptor(payload.programId))
  ) {
    fail("wakeflow-active-foundation-plan", "active foundation operation ownership is invalid");
  }

  const isTodo = operation.ref === TODO_BOARD_REF;
  const createReason = isTodo ? "todo-authority-create" : "active-static-create";
  const currentReason = isTodo ? "todo-authority-current" : "active-static-current";
  if (operation.action === "create-managed") {
    const target = isTodo
      ? { type: "file", mode: TODO_MODE, digest: digestBytes(Buffer.from(EMPTY_TODO_BOARD, "utf8")) }
      : expectedCurrentNode(payload.programId, operation);
    if (
      payload.action !== "fresh-initialize"
      || operation.classification !== "managed-missing"
      || !sameCanonical(operation.source, { type: "absent" })
      || !sameCanonical(operation.target, target)
      || operation.reasonCode !== createReason
    ) fail("wakeflow-active-foundation-plan", "active foundation create operation is invalid");
    return;
  }
  if (operation.action === "current") {
    const expected = expectedCurrentNode(payload.programId, operation);
    if (
      payload.action === "fresh-initialize"
      || operation.classification !== "managed-current"
      || !sameCanonical(operation.source, expected)
      || !sameCanonical(operation.target, expected)
      || operation.reasonCode !== currentReason
    ) fail("wakeflow-active-foundation-plan", "active foundation current operation is invalid");
    return;
  }
  if (operation.classification !== "conflict" || operation.action !== "blocked") {
    fail("wakeflow-active-foundation-plan", "active foundation blocked operation is invalid");
  }
  const sourceType = operation.source.type;
  const allowedBlocked = isTodo
    ? new Set([
        `fresh-active-footprint-present\0unsafe`,
        `todo-authority-missing\0absent`,
        `todo-authority-invalid\0unsafe`,
        `todo-authority-unsafe\0unsafe`,
      ])
    : new Set([
        `fresh-active-footprint-present\0unsafe`,
        `active-layout-missing\0absent`,
        `active-layout-mode-drift\0unsafe`,
        `active-layout-unsafe\0unsafe`,
      ]);
  if (!allowedBlocked.has(`${operation.reasonCode}\0${sourceType}`)) {
    fail("wakeflow-active-foundation-plan", "active foundation blocker semantics are invalid");
  }
}

// fresh-ready与所有非fresh计划必须完整覆盖三资源；fresh冲突只允许根级单一blocker。
function assertOperationRoster(payload) {
  const refs = payload.operations.map((entry) => entry.ref);
  const fullRoster = [ACTIVE_ROOT_REF, CURRENT_ROOT_REF, TODO_BOARD_REF];
  if (payload.action === "fresh-initialize" && payload.status === "blocked") {
    if (
      payload.operations.length !== 1
      || refs[0] !== ACTIVE_ROOT_REF
      || payload.operations[0].action !== "blocked"
    ) fail("wakeflow-active-foundation-plan", "fresh active foundation blocker roster is invalid");
    return;
  }
  if (!sameCanonical(refs, fullRoster)) {
    fail("wakeflow-active-foundation-plan", "active foundation operation roster is incomplete");
  }
  if (
    payload.action === "fresh-initialize"
    && payload.operations.some((entry) => entry.action !== "create-managed")
  ) fail("wakeflow-active-foundation-plan", "fresh active foundation ready roster is invalid");
  if (
    payload.action !== "fresh-initialize"
    && payload.operations.some((entry) => entry.action === "create-managed")
  ) fail("wakeflow-active-foundation-plan", "non-fresh active foundation cannot recreate authority");
}

function validatePlanInternal(value) {
  const plan = canonicalSnapshot(value, "active foundation plan");
  exactKeys(plan, ["schemaId", "payload"], "active foundation plan");
  if (plan.schemaId !== WAKEFLOW_ACTIVE_FOUNDATION_SCHEMA_ID) {
    fail("wakeflow-active-foundation-plan", "active foundation schema identity is invalid");
  }
  const payloadKeys = [
    "kind", "schemaVersion", "action", "status", "programId", "sourceModelDigest",
    "desiredModelDigest", "operations", "blockers", "steps",
  ];
  exactKeys(plan.payload, payloadKeys, "active foundation payload");
  const payload = plan.payload;
  if (
    payload.kind !== WAKEFLOW_ACTIVE_FOUNDATION_KIND
    || payload.schemaVersion !== WAKEFLOW_ACTIVE_FOUNDATION_SCHEMA_VERSION
    || !ACTIONS.has(payload.action)
    || !DIGEST_RE.test(payload.desiredModelDigest)
    || (payload.sourceModelDigest !== null && !DIGEST_RE.test(payload.sourceModelDigest))
    || !Array.isArray(payload.operations)
    || !Array.isArray(payload.blockers)
    || !Array.isArray(payload.steps)
  ) {
    fail("wakeflow-active-foundation-plan", "active foundation metadata is invalid");
  }
  assertProgramId(payload.programId);
  if ((payload.action === "fresh-initialize") !== (payload.sourceModelDigest === null)) {
    fail("wakeflow-active-foundation-plan", "active foundation source model identity is inconsistent");
  }
  const operationIds = new Set();
  for (const operation of payload.operations) {
    const keys = [
      "operationId", "componentId", "owner", "ref", "resourceRef", "root",
      "classification", "source", "target", "action", "reasonCode",
    ];
    exactKeys(operation, keys, "active foundation operation");
    if (
      typeof operation.operationId !== "string"
      || operationIds.has(operation.operationId)
      || !new Set(["active-layout", "todo-authority"]).has(operation.componentId)
      || !new Set([ACTIVE_ROOT_REF, CURRENT_ROOT_REF, TODO_BOARD_REF]).has(operation.ref)
      || !new Set(["current", "create-managed", "blocked"]).has(operation.action)
      || operation.resourceRef !== resourceRef(payload.programId, operation.ref)
    ) {
      fail("wakeflow-active-foundation-plan", "active foundation operation identity is invalid");
    }
    operationIds.add(operation.operationId);
    validateNode(operation.source, "active foundation source");
    validateNode(operation.target, "active foundation target", { nullable: true });
    if ((operation.action === "blocked") !== (operation.target === null)) {
      fail("wakeflow-active-foundation-plan", "active foundation blocker target is inconsistent");
    }
    assertOperationSemantics(operation, payload);
  }
  const expectedBlockers = payload.operations
    .filter((entry) => entry.action === "blocked")
    .map((entry) => ({
      blockerId: entry.operationId,
      operationId: entry.operationId,
      componentId: entry.componentId,
      resourceRef: entry.resourceRef,
      code: entry.reasonCode,
    }));
  const expectedSteps = payload.operations
    .filter((entry) => entry.action === "create-managed")
    .map(stepFor);
  if (
    !sameCanonical(payload.blockers, expectedBlockers)
    || !sameCanonical(payload.steps, expectedSteps)
    || payload.status !== (expectedBlockers.length === 0 ? "ready" : "blocked")
  ) {
    fail("wakeflow-active-foundation-plan", "active foundation derived collections are invalid");
  }
  assertOperationRoster(payload);
  return deepFreeze(plan);
}

/**
 * 只读规划三个静态资源。返回的portable plan可公开确认，但不含workspaceRoot、文件字节或私有stat。
 */
export function planWakeflowActiveFoundation(value) {
  const normalized = normalizeInput(value);
  const plan = derivePlan(normalized);
  if (canonicalJson(plan).includes(normalized.workspaceRoot)) {
    fail("wakeflow-active-foundation-private-data", "active foundation plan leaked its workspace root");
  }
  return plan;
}

export function validateWakeflowActiveFoundationPlan(value) {
  return validatePlanInternal(value);
}

// 将领域owner plan投影为maintenance aggregate片段；不在这里签发apply authority。
export function projectWakeflowActiveFoundationMaintenance(value) {
  const input = exactKeys(
    value,
    ["plan", "transactionOffset"],
    "active foundation projection input",
  );
  const plan = validatePlanInternal(input.plan);
  if (!Number.isSafeInteger(input.transactionOffset) || input.transactionOffset < 0) {
    fail("wakeflow-active-foundation-input", "transactionOffset must be a non-negative safe integer");
  }
  const planDigest = canonicalJsonDigest(plan);
  const stepIndex = new Map(plan.payload.steps.map((entry, index) => [entry.stepId, index]));
  const filesystemActions = plan.payload.operations
    .filter((entry) => entry.action !== "blocked")
    .map((entry) => {
      const index = stepIndex.get(entry.operationId);
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
        authorization: { kind: entry.action === "current" ? "none" : "wakeflow-owned" },
        reasonCode: entry.reasonCode,
        stepId: index === undefined ? null : entry.operationId,
        commitOrder: index === undefined ? null : input.transactionOffset + index,
      };
    });
  const dependencyChecks = plan.payload.blockers.map((entry) => ({
    checkId: `active-foundation-blocked-${entry.operationId}`,
    componentId: entry.componentId,
    owner: plan.payload.operations.find((operation) => operation.operationId === entry.operationId).owner,
    subject: { kind: "resource", value: entry.resourceRef },
    status: "blocked",
    code: entry.code,
    evidence: [{ kind: "owner-plan", ref: entry.resourceRef, digest: planDigest }],
  }));
  return deepFreeze({
    components: [
      { componentId: "active-layout", owner: "layout-manager", ownerPlanDigest: planDigest },
      { componentId: "todo-authority", owner: "todo-service", ownerPlanDigest: planDigest },
    ],
    filesystemActions,
    dependencyChecks,
    preserved: [],
    deferredOwnerActions: dependencyChecks.map((entry) => ({
      deferredId: entry.checkId,
      componentId: entry.componentId,
      owner: entry.owner,
      action: "resolve-active-foundation-conflict",
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
    steps: plan.payload.steps.map((step, index) => ({
      ...step,
      ordinal: input.transactionOffset + index,
    })),
  });
}

// ==================== 五、配置权威复验与M3物化participant ====================

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
    fail("wakeflow-active-foundation-config", "strict config authority is unavailable", { cause });
  }
}

/**
 * 把ready plan绑定到本次action/config输入并重建私有目标字节。
 * 物理提交、checkpoint和forward recovery继续由tracked materialization与workspace mutation拥有。
 */
export function createWakeflowActiveFoundationMutationParticipant(value) {
  const normalized = normalizeInput(value, { participant: true });
  const confirmedPlan = validatePlanInternal(normalized.confirmedPlan);
  if (confirmedPlan.payload.status !== "ready") {
    fail("wakeflow-active-foundation-blocked", "a blocked active foundation plan cannot create a participant");
  }
  const expectedSourceModelDigest = normalized.sourceModel === null
    ? null
    : wakeflowConfigV3Digest(normalized.sourceModel);
  if (
    confirmedPlan.payload.action !== normalized.action
    || confirmedPlan.payload.programId !== normalized.desiredModel.program.programId
    || confirmedPlan.payload.sourceModelDigest !== expectedSourceModelDigest
    || confirmedPlan.payload.desiredModelDigest !== wakeflowConfigV3Digest(normalized.desiredModel)
  ) {
    fail("wakeflow-active-foundation-plan", "active foundation plan differs from participant input");
  }
  const operationById = new Map(confirmedPlan.payload.operations.map((entry) => [entry.operationId, entry]));
  const privateOperations = confirmedPlan.payload.steps.map((step) => {
    const operation = operationById.get(step.stepId);
    const targetPath = path.join(normalized.workspaceRoot, ...operation.ref.split("/"));
    if (operation.target.type === "directory") {
      return {
        stepId: step.stepId,
        kind: "directory",
        targetPath,
        stagePath: null,
        targetBytes: null,
        maxFileBytes: null,
      };
    }
    return {
      stepId: step.stepId,
      kind: "file",
      targetPath,
      stagePath: path.join(normalized.workspaceRoot, ...todoStageRef(operation).split("/")),
      targetBytes: Buffer.from(EMPTY_TODO_BOARD, "utf8"),
      maxFileBytes: TODO_BOARD_MAX_BYTES,
    };
  });
  return createWakeflowTrackedMaterializationParticipant({
    workspaceRoot: normalized.workspaceRoot,
    confirmedPlan,
    validatePlan: validatePlanInternal,
    deriveCurrentPlan() {
      return derivePlan(normalized);
    },
    validateAuthority({ context }) {
      assertConfigAuthority(normalized, context);
      return { valid: true };
    },
    privateOperations,
    closureName: "active-foundation-closure",
  });
}
