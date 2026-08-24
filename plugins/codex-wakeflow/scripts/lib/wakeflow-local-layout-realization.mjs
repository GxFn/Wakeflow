import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  assertWakeflowLocalLayoutInspection,
  inspectWakeflowLocalLayout,
} from "./wakeflow-local-layout-inspection.mjs";
import { assertWakeflowMaintenanceLocalTransitionScope } from "./wakeflow-maintenance-action-composition.mjs";
import { planWakeflowLocalLayout } from "./wakeflow-local-layout.mjs";
import { inspectWindowRuntimeProjectionsForLayout } from "./wakeflow-window-runtime-projector.mjs";
import { assertWakeflowMutationContext } from "./wakeflow-workspace-mutation.mjs";

const REALIZATION_SCHEMA_ID = "urn:wakeflow:internal:local-layout-realization-plan:v1";
const REALIZATION_KIND = "WakeflowLocalLayoutRealizationPlan";
const REALIZATION_SCHEMA_VERSION = 1;
const DIRECTORY_MODE = 0o700;
const DIRECTORY_MODE_STRING = "0700";
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ACTIONS = new Set([
  "fresh-initialize",
  "reconfigure",
  "reconcile",
  "explicit-migration",
]);
const PROTOCOL_PROVIDED_REFS = Object.freeze([
  ".wakeflow-local",
  ".wakeflow-local/runtime",
  ".wakeflow-local/runtime/maintenance",
  ".wakeflow-local/runtime/maintenance/transactions",
]);
const PROTOCOL_PROVIDED_SET = new Set(PROTOCOL_PROVIDED_REFS);
const DELEGATED_REPAIR_OWNERS = new Set([
  "host-settings-assets-owner",
  "runtime-projection-builder",
]);
const DELEGATED_REPAIR_CLASSIFICATIONS = new Set([
  "delegated-drift",
  "owner-validator-pending",
  "owner-validator-stale",
]);
const PLAN_PAYLOAD_KEYS = Object.freeze([
  "action",
  "blockers",
  "kind",
  "layoutPlanDigest",
  "protocolProvided",
  "schemaVersion",
  "steps",
  "structuralInventoryDigest",
]);

/**
 * `.wakeflow-local` 静态目录 owner 的计划与 mutation participant。
 *
 * 阅读导航：
 * 1. `buildRealizationPlan()` 把只读 inspection 归约为静态目录步骤和 blocker。
 * 2. `assertPlanShape()` 闭合 confirmed plan codec，不接受调用方扩张写入集合。
 * 3. `createStepHandler()` 在 T02 context 内执行目录创建或 same-inode mode repair。
 * 4. `createWakeflowLocalLayoutMutationParticipant()` 提供重推、步骤和 terminal closure。
 * 5. storage/verify 入口只投影同模块签发的 inspection，不读取或修改 workspace。
 *
 * delegated asset、window projection、event fact 和 T02 协议前缀均由其他 owner 管理。
 */

export class WakeflowLocalLayoutRealizationError extends Error {
  constructor(code, message, { errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowLocalLayoutRealizationError";
    this.code = code;
    this.path = errorPath;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowLocalLayoutRealizationError(code, message, { errorPath, details, cause });
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-local-realization-canonical", `${label} must be canonical JSON data`, { cause });
  }
}

function exactInput(value, expected, label) {
  if (!isPlainObject(value)) {
    fail("wakeflow-local-realization-input", `${label} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length
    || keys.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("wakeflow-local-realization-input", `${label} has an invalid field set`, {
      details: { expected, actual: keys.map(String) },
    });
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-local-realization-input", `${label}.${key} must be an enumerable data property`);
    }
  }
  return value;
}

function assertAction(action) {
  if (!ACTIONS.has(action)) {
    fail("wakeflow-local-realization-action", `unsupported local layout action: ${String(action)}`);
  }
  return action;
}

// 只有 current euid 可完整访问且未向 group/other 开放写权限的旧 mode 才允许收敛到 0700。
function isSafeRepairMode(mode) {
  if (!/^0[0-7]{3}$/u.test(mode) || mode === DIRECTORY_MODE_STRING) return false;
  const numeric = Number.parseInt(mode, 8);
  return (numeric & 0o700) === 0o700 && (numeric & 0o022) === 0;
}

function desiredLayout(input) {
  return planWakeflowLocalLayout({
    model: input.model,
    layoutDescriptor: input.layoutDescriptor,
    hostProfile: input.hostProfile,
  });
}

// 四级前缀由 T02 为取得 mutation gate 而创建，不能再次成为 layout domain step。
function protocolProvidedProjection() {
  return PROTOCOL_PROVIDED_REFS.map((ref) => ({
    ref,
    classification: "protocol-provided",
  }));
}

function isMaintenanceActualEvent(item) {
  return item.partition !== "event-pattern"
    && Array.isArray(item.matchedKeys)
    && item.matchedKeys.some((key) => key.startsWith("event.maintenance."));
}

function replacementForCommittedStep(item, step) {
  if (step.source.type === "absent") {
    return {
      ...item,
      classification: "missing",
      actual: null,
    };
  }
  return {
    ...item,
    classification: "permission-drift",
    actual: item.actual === null ? null : {
      ...item.actual,
      mode: step.source.mode,
    },
  };
}

/**
 * 形成跨 gate 重推稳定的 structural inventory。
 * 已提交步骤被还原成确认时 source，T02 动态 residue 和 protocol-provided 前缀不制造伪 stale。
 */
function normalizedStructuralInventory(inspection, committedStepSources = new Map()) {
  const staticDirectories = inspection.items.staticDirectories
    .filter((item) => !PROTOCOL_PROVIDED_SET.has(item.path))
    .map((item) => {
      const step = committedStepSources.get(item.path);
      return step ? replacementForCommittedStep(item, step) : item;
    });
  return {
    layoutPlanDigest: inspection.layoutPlanDigest,
    host: inspection.host,
    staticDirectories,
    managedFiles: inspection.items.managedFiles,
    initialProjections: inspection.items.initialProjections,
    events: inspection.items.events.filter((item) => !isMaintenanceActualEvent(item)),
    boundaries: inspection.items.boundaries,
  };
}

function structuralInventoryDigest(inspection, committedStepSources = new Map()) {
  return canonicalJsonDigest(normalizedStructuralInventory(inspection, committedStepSources));
}

function transitionRefDigest(ref) {
  return `sha256:${createHash("sha256").update(ref, "utf8").digest("hex")}`;
}

function composedStructuralInventoryDigest(inspection) {
  return canonicalJsonDigest({
    layoutPlanDigest: inspection.layoutPlanDigest,
    host: inspection.host,
    staticDirectories: inspection.items.staticDirectories,
  });
}

// composition scope 只能豁免本事务精确声明的 delegated final/staging ref，不能按目录前缀放宽。
function authorizedComposedTransitionBlocker(blocker, scope) {
  for (const resource of scope.resources) {
    if (
      DELEGATED_REPAIR_CLASSIFICATIONS.has(blocker.classification)
      && blocker.owner === resource.owner
      && blocker.path === resource.finalRef
    ) return true;
    if (
      blocker.classification === "unknown"
      && blocker.owner === "user-review"
      && (
        blocker.path === resource.stagingRef
        || blocker.pathDigest === transitionRefDigest(resource.stagingRef)
      )
    ) return true;
  }
  return false;
}

function projectionTransitionFinalRefs({
  inspection,
  scope,
  workspaceRoot,
  model,
  hostProfile,
  configDigest,
}) {
  const resources = scope.resources.filter((resource) => (
    resource.componentId === "window-runtime-projection"
    && resource.owner === "runtime-projection-builder"
  ));
  if (resources.length === 0) return new Set();

  let projection;
  try {
    projection = inspectWindowRuntimeProjectionsForLayout({
      workspaceRoot,
      model,
      configDigest,
      hostProfile,
    });
  } catch {
    return new Set();
  }

  const rootPrefix = `${projection.projectionRootRef}/`;
  const windowByFinalRef = new Map(projection.windows.map((window) => [
    `${rootPrefix}${window.windowId}.json`,
    window,
  ]));
  const resourceByFinalRef = new Map();
  for (const resource of resources) {
    if (
      !windowByFinalRef.has(resource.finalRef)
      || resourceByFinalRef.has(resource.finalRef)
      || !resource.stagingRef.startsWith(rootPrefix)
    ) return new Set();
    resourceByFinalRef.set(resource.finalRef, resource);
  }

  const stagedFinalRefs = new Set();
  for (const resource of resources) {
    if (inspection.blockers.some((blocker) => (
      blocker.classification === "unknown"
      && blocker.owner === "user-review"
      && (
        blocker.path === resource.stagingRef
        || blocker.pathDigest === transitionRefDigest(resource.stagingRef)
      )
    ))) stagedFinalRefs.add(resource.finalRef);
  }
  if (stagedFinalRefs.size === 0) return new Set();

  let unsafeScopedWindows = 0;
  for (const [finalRef, window] of windowByFinalRef) {
    if (!resourceByFinalRef.has(finalRef)) {
      if (window.status !== "current") return new Set();
      continue;
    }
    if (window.status === "unsafe") {
      if (!stagedFinalRefs.has(finalRef)) return new Set();
      unsafeScopedWindows += 1;
    }
  }
  if (
    projection.projectionStatus !== "unsafe"
    || projection.unsafeEntryCount !== stagedFinalRefs.size + unsafeScopedWindows
  ) return new Set();

  return new Set(windowByFinalRef.keys());
}

// projection 的 `final + staging` 瞬态必须同时闭合 scope、窗口全集和 unsafe 计数才可在 gate 内继续。
function filterAuthorizedComposedTransitionBlockers(blockers, {
  inspection,
  scope,
  workspaceRoot,
  model,
  hostProfile,
  configDigest,
}) {
  const remaining = blockers.filter((blocker) => !authorizedComposedTransitionBlocker(blocker, scope));
  if (!remaining.some((blocker) => (
    blocker.classification === "owner-validator-invalid"
    && blocker.owner === "runtime-projection-builder"
  ))) return remaining;

  const authorizedProjectionRefs = projectionTransitionFinalRefs({
    inspection,
    scope,
    workspaceRoot,
    model,
    hostProfile,
    configDigest,
  });
  return remaining.filter((blocker) => !(
    blocker.classification === "owner-validator-invalid"
    && blocker.owner === "runtime-projection-builder"
    && authorizedProjectionRefs.has(blocker.path)
  ));
}

function directoryNodeDigest(layoutPlanDigest, item) {
  return canonicalJsonDigest({
    kind: "WakeflowLocalStaticDirectoryNode",
    schemaVersion: 1,
    layoutPlanDigest,
    ref: item.path,
    owner: item.owner,
    lifecycle: item.lifecycle,
    type: "directory",
    mode: DIRECTORY_MODE_STRING,
  });
}

function stepIdFor(ref) {
  return `local-directory-${canonicalJsonDigest({ ref }).slice(7, 23)}`;
}

function isMutationBlocker(blocker) {
  return typeof blocker.classification === "string"
    && blocker.classification.startsWith("workspace-mutation-");
}

function isDelegatedRepairBlocker(blocker, action) {
  return ["reconcile", "reconfigure"].includes(action)
    && DELEGATED_REPAIR_OWNERS.has(blocker.owner)
    && DELEGATED_REPAIR_CLASSIFICATIONS.has(blocker.classification);
}

function actionDriftBlocker(item, action) {
  if (item.classification !== "permission-drift") return null;
  if (action === "reconcile" || action === "reconfigure") return null;
  return {
    path: item.path,
    classification: "action-incompatible-permission-drift",
    owner: "layout-manager",
    action,
  };
}

/**
 * 从一次 inspection 生成 closed owner plan。
 * 仅 missing 静态目录和 reconcile/reconfigure 下的安全 mode drift 可成为步骤；任一其他 blocker 都使写集合为空。
 */
function buildRealizationPlan({ inspection, layoutPlan, action, ignoreMutationBlockers = false }) {
  const blockers = inspection.blockers
    .filter((blocker) => !ignoreMutationBlockers || !isMutationBlocker(blocker))
    .filter((blocker) => !isDelegatedRepairBlocker(blocker, action))
    .map((blocker) => canonicalSnapshot(blocker, "inspection blocker"));
  for (const item of inspection.items.staticDirectories) {
    if (PROTOCOL_PROVIDED_SET.has(item.path)) {
      if (item.classification === "permission-drift") {
        blockers.push({
          path: item.path,
          classification: "protocol-permission-drift",
          owner: "mutation-gate-manager",
        });
      }
      continue;
    }
    const actionBlocker = actionDriftBlocker(item, action);
    if (actionBlocker) blockers.push(actionBlocker);
  }
  blockers.sort((left, right) => lexicalCompare(canonicalJson(left), canonicalJson(right)));

  const steps = [];
  if (blockers.length === 0) {
    for (const item of inspection.items.staticDirectories) {
      if (PROTOCOL_PROVIDED_SET.has(item.path) || item.classification === "current") continue;
      if (![
        "missing",
        "permission-drift",
      ].includes(item.classification)) {
        fail(
          "wakeflow-local-realization-classification",
          `unhandled static directory classification: ${item.classification}`,
          { details: { ref: item.path } },
        );
      }
      const digest = directoryNodeDigest(layoutPlan.planDigest, item);
      const source = item.classification === "missing"
        ? { ref: item.path, type: "absent" }
        : {
          ref: item.path,
          type: "directory",
          mode: item.actual.mode,
          digest,
        };
      steps.push({
        stepId: stepIdFor(item.path),
        ordinal: steps.length,
        stepKind: "create-or-update",
        source,
        staging: null,
        final: {
          ref: item.path,
          type: "directory",
          mode: DIRECTORY_MODE_STRING,
          digest,
        },
      });
    }
  }

  return deepFreeze({
    schemaId: REALIZATION_SCHEMA_ID,
    payload: {
      kind: REALIZATION_KIND,
      schemaVersion: REALIZATION_SCHEMA_VERSION,
      action,
      layoutPlanDigest: layoutPlan.planDigest,
      structuralInventoryDigest: structuralInventoryDigest(inspection),
      protocolProvided: protocolProvidedProjection(),
      steps,
      blockers,
    },
  });
}

/**
 * 只读规划入口：重新编译 expected layout、观察真实树并产出待确认计划。
 * 此入口不创建 T02 前缀，也不执行任何目录或 delegated owner effect。
 */
export function planWakeflowLocalLayoutRealization(value) {
  const input = exactInput(
    value,
    ["workspaceRoot", "action", "model", "layoutDescriptor", "hostProfile"],
    "local layout realization input",
  );
  const action = assertAction(input.action);
  const layoutPlan = desiredLayout(input);
  const inspection = inspectWakeflowLocalLayout({
    workspaceRoot: input.workspaceRoot,
    model: input.model,
    layoutDescriptor: input.layoutDescriptor,
    hostProfile: input.hostProfile,
  });
  return buildRealizationPlan({ inspection, layoutPlan, action });
}

function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) fail("wakeflow-local-realization-plan", `${label} must be a plain object`);
  const actual = Object.keys(value).sort(lexicalCompare);
  const wanted = [...expected].sort(lexicalCompare);
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail("wakeflow-local-realization-plan", `${label} has an invalid field set`, {
      details: { expected: wanted, actual },
    });
  }
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

// confirmed plan 的每个 step 必须一对一指向 expected 静态目录，且 source/final 形状不能扩张。
function assertPlanShape(plan, layoutPlan) {
  exactKeys(plan, ["schemaId", "payload"], "realization plan");
  if (plan.schemaId !== REALIZATION_SCHEMA_ID) {
    fail("wakeflow-local-realization-plan", "realization plan schemaId is invalid");
  }
  exactKeys(plan.payload, PLAN_PAYLOAD_KEYS, "realization plan payload");
  const payload = plan.payload;
  if (
    payload.kind !== REALIZATION_KIND
    || payload.schemaVersion !== REALIZATION_SCHEMA_VERSION
    || !ACTIONS.has(payload.action)
    || payload.layoutPlanDigest !== layoutPlan.planDigest
    || !DIGEST_PATTERN.test(payload.structuralInventoryDigest)
  ) {
    fail("wakeflow-local-realization-plan", "realization plan identity or digest fields are invalid");
  }
  if (!Array.isArray(payload.protocolProvided) || !sameCanonical(payload.protocolProvided, protocolProvidedProjection())) {
    fail("wakeflow-local-realization-plan", "realization plan protocol-provided set is invalid");
  }
  if (!Array.isArray(payload.blockers) || !Array.isArray(payload.steps)) {
    fail("wakeflow-local-realization-plan", "realization plan steps and blockers must be arrays");
  }

  const staticByRef = new Map(layoutPlan.staticDirectories.map((item) => [item.path, item]));
  const seen = new Set();
  for (const [ordinal, step] of payload.steps.entries()) {
    exactKeys(step, ["stepId", "ordinal", "stepKind", "source", "staging", "final"], `step ${ordinal}`);
    exactKeys(step.final, ["ref", "type", "mode", "digest"], `step ${ordinal} final`);
    if (!isPlainObject(step.source)) {
      fail("wakeflow-local-realization-plan", `step ${ordinal} source must be a plain object`);
    }
    if (
      step.ordinal !== ordinal
      || step.stepKind !== "create-or-update"
      || step.staging !== null
      || typeof step.stepId !== "string"
      || step.stepId !== stepIdFor(step.final.ref)
    ) {
      fail("wakeflow-local-realization-plan", `step ${ordinal} has an invalid directory contract`);
    }
    const desired = staticByRef.get(step.final.ref);
    if (!desired || PROTOCOL_PROVIDED_SET.has(step.final.ref) || seen.has(step.final.ref)) {
      fail("wakeflow-local-realization-plan", `step ${ordinal} does not target one unique managed static directory`);
    }
    seen.add(step.final.ref);
    const digest = directoryNodeDigest(layoutPlan.planDigest, desired);
    if (!sameCanonical(step.final, {
      ref: desired.path,
      type: "directory",
      mode: DIRECTORY_MODE_STRING,
      digest,
    })) {
      fail("wakeflow-local-realization-plan", `step ${ordinal} final contract is invalid`);
    }
    if (step.source.type === "absent") {
      exactKeys(step.source, ["ref", "type"], `step ${ordinal} source`);
      if (!sameCanonical(step.source, { ref: desired.path, type: "absent" })) {
        fail("wakeflow-local-realization-plan", `step ${ordinal} absent source is invalid`);
      }
    } else {
      exactKeys(step.source, ["ref", "type", "mode", "digest"], `step ${ordinal} source`);
      if (
        step.source.ref !== desired.path
        || step.source.type !== "directory"
        || !isSafeRepairMode(step.source.mode)
        || step.source.digest !== digest
        || !["reconcile", "reconfigure"].includes(payload.action)
      ) {
        fail("wakeflow-local-realization-plan", `step ${ordinal} mode-repair source is invalid`);
      }
    }
  }
  return plan;
}

function currentEuid() {
  return typeof process.geteuid === "function" ? process.geteuid() : null;
}

function modeString(stat) {
  return `0${(stat.mode & 0o777).toString(8).padStart(3, "0")}`;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

// 目录 effect 依赖 POSIX uid、mode、O_NOFOLLOW 与 descriptor fsync 语义。
function assertPosix() {
  if (process.platform === "win32" || currentEuid() === null) {
    fail("wakeflow-local-realization-platform", "local layout realization requires POSIX ownership and mode semantics");
  }
}

function resolveRef(workspaceRoot, ref) {
  if (
    typeof ref !== "string"
    || path.posix.isAbsolute(ref)
    || ref.includes("\\")
    || path.posix.normalize(ref) !== ref
    || (ref !== ".wakeflow-local" && !ref.startsWith(".wakeflow-local/"))
  ) {
    fail("wakeflow-local-realization-ref", "local layout ref is not canonical", { details: { ref } });
  }
  const root = path.resolve(workspaceRoot);
  const absolute = path.resolve(root, ...ref.split("/"));
  const relative = path.relative(root, absolute);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail("wakeflow-local-realization-ref", "local layout ref escapes the workspace", { details: { ref } });
  }
  return { root, absolute };
}

// 每次路径检查同时验证真实目录、current euid、允许 mode、可选 inode CAS 和物理 containment。
function assertRealDirectory(candidate, {
  workspaceRoot,
  label,
  allowedModes = [DIRECTORY_MODE_STRING],
  allowWorkspaceMode = false,
  expectedIdentity = null,
} = {}) {
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch (cause) {
    fail("wakeflow-local-realization-directory", `cannot inspect ${label}`, { cause });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-local-realization-directory", `${label} must be a real directory`);
  }
  if (stat.uid !== currentEuid()) {
    fail("wakeflow-local-realization-owner", `${label} must be owned by the current euid`);
  }
  const actualMode = modeString(stat);
  if (!allowWorkspaceMode && !allowedModes.includes(actualMode)) {
    fail("wakeflow-local-realization-mode", `${label} has an unexpected mode`, {
      details: { actualMode, allowedModes },
    });
  }
  if (expectedIdentity && !sameIdentity(stat, expectedIdentity)) {
    fail("wakeflow-local-realization-race", `${label} changed identity`);
  }
  const realRoot = realpathSync(path.resolve(workspaceRoot));
  const realCandidate = realpathSync(candidate);
  const relative = path.relative(realRoot, realCandidate);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail("wakeflow-local-realization-ref", `${label} resolves outside the workspace`);
  }
  return stat;
}

function assertAncestorChain(workspaceRoot, target) {
  const root = path.resolve(workspaceRoot);
  assertRealDirectory(root, {
    workspaceRoot: root,
    label: "workspace root",
    allowWorkspaceMode: true,
  });
  const relative = path.relative(root, path.dirname(target));
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    assertRealDirectory(current, { workspaceRoot: root, label: "local layout ancestor" });
  }
}

function openDirectory(candidate, { workspaceRoot, label, allowedModes, expectedIdentity = null }) {
  let descriptor;
  try {
    descriptor = openSync(
      candidate,
      fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor);
    if (!stat.isDirectory() || stat.uid !== currentEuid() || !allowedModes.includes(modeString(stat))) {
      fail("wakeflow-local-realization-directory", `${label} descriptor does not match its directory contract`);
    }
    if (expectedIdentity && !sameIdentity(stat, expectedIdentity)) {
      fail("wakeflow-local-realization-race", `${label} descriptor changed identity`);
    }
    const pathStat = assertRealDirectory(candidate, {
      workspaceRoot,
      label,
      allowedModes,
      expectedIdentity: stat,
    });
    if (!sameIdentity(pathStat, stat)) fail("wakeflow-local-realization-race", `${label} path changed identity`);
    return { descriptor, stat };
  } catch (cause) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (cause instanceof WakeflowLocalLayoutRealizationError) throw cause;
    fail("wakeflow-local-realization-directory", `cannot open ${label}`, { cause });
  }
}

function assertContext(workspaceRoot, context) {
  if (context === null || typeof context !== "object") {
    fail("wakeflow-local-realization-context", "a branded mutation context is required");
  }
  const mode = context.recoveryGeneration > 0 ? "recovery-cleanup" : "maintenance";
  assertWakeflowMutationContext({ workspaceRoot, context, mode });
}

// step observation 同时返回公开 source/final 事实和仅供紧邻 commit 使用的 parent/target inode。
function inspectDirectoryStep(workspaceRoot, step) {
  const { absolute } = resolveRef(workspaceRoot, step.final.ref);
  assertAncestorChain(workspaceRoot, absolute);
  const parentIdentity = assertRealDirectory(path.dirname(absolute), {
    workspaceRoot,
    label: `${step.stepId} parent`,
  });
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      const absent = { ref: step.final.ref, type: "absent" };
      return {
        observation: { source: absent, staging: null, final: absent },
        parentIdentity,
        targetIdentity: null,
      };
    }
    fail("wakeflow-local-realization-directory", "cannot inspect static directory step", { cause });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== currentEuid()) {
    fail("wakeflow-local-realization-directory", "static directory step observed a non-owned real-directory mismatch");
  }
  const mode = modeString(stat);
  const allowedModes = step.source.type === "directory"
    ? [step.source.mode, step.final.mode]
    : [step.final.mode];
  if (!allowedModes.includes(mode)) {
    fail("wakeflow-local-realization-mode", "static directory step observed an unexpected mode", {
      details: { ref: step.final.ref, mode, allowedModes },
    });
  }
  assertRealDirectory(absolute, {
    workspaceRoot,
    label: "static directory step",
    allowedModes,
    expectedIdentity: stat,
  });
  const current = {
    ref: step.final.ref,
    type: "directory",
    mode,
    digest: step.final.digest,
  };
  return {
    observation: { source: current, staging: null, final: current },
    parentIdentity,
    targetIdentity: stat,
  };
}

function closeDescriptor(descriptor) {
  if (descriptor !== null && descriptor !== undefined) closeSync(descriptor);
}

/**
 * 为一个静态目录创建 prepare/observe/commit 三段处理器。
 * commit 只消费紧邻 observation 保存的 inode；创建后或 chmod 后均通过 descriptor 与路径双重重验并 fsync。
 */
function createStepHandler(workspaceRoot, step) {
  let lastObservation = null;
  const observeAndRemember = () => {
    const inspected = inspectDirectoryStep(workspaceRoot, step);
    lastObservation = {
      parentIdentity: inspected.parentIdentity,
      targetIdentity: inspected.targetIdentity,
    };
    return inspected.observation;
  };
  return {
    prepare({ context }) {
      assertContext(workspaceRoot, context);
      const observation = observeAndRemember();
      if (!sameCanonical(observation.source, step.source)) {
        fail("wakeflow-local-realization-stale", `${step.stepId} source changed before prepare`);
      }
    },

    observe({ context }) {
      assertContext(workspaceRoot, context);
      return observeAndRemember();
    },

    commit({ context }) {
      assertContext(workspaceRoot, context);
      if (lastObservation === null) {
        fail("wakeflow-local-realization-race", `${step.stepId} commit has no immediately preceding observation`);
      }
      const expectedObservation = lastObservation;
      lastObservation = null;
      const { absolute } = resolveRef(workspaceRoot, step.final.ref);
      const parent = path.dirname(absolute);
      assertAncestorChain(workspaceRoot, absolute);
      let parentHandle = null;
      let targetHandle = null;
      try {
        parentHandle = openDirectory(parent, {
          workspaceRoot,
          label: `${step.stepId} parent`,
          allowedModes: [DIRECTORY_MODE_STRING],
          expectedIdentity: expectedObservation.parentIdentity,
        });
        if (step.source.type === "absent") {
          try {
            lstatSync(absolute);
            fail("wakeflow-local-realization-stale", `${step.stepId} target is no longer absent`);
          } catch (cause) {
            if (cause instanceof WakeflowLocalLayoutRealizationError) throw cause;
            if (cause?.code !== "ENOENT") {
              fail("wakeflow-local-realization-directory", `cannot preflight ${step.stepId}`, { cause });
            }
          }
          try {
            mkdirSync(absolute, { mode: DIRECTORY_MODE });
          } catch (cause) {
            fail("wakeflow-local-realization-directory", `cannot exclusively create ${step.stepId}`, { cause });
          }
          targetHandle = openDirectory(absolute, {
            workspaceRoot,
            label: step.stepId,
            allowedModes: [DIRECTORY_MODE_STRING],
          });
          fchmodSync(targetHandle.descriptor, DIRECTORY_MODE);
        } else {
          targetHandle = openDirectory(absolute, {
            workspaceRoot,
            label: step.stepId,
            allowedModes: [step.source.mode],
            expectedIdentity: expectedObservation.targetIdentity,
          });
          fchmodSync(targetHandle.descriptor, DIRECTORY_MODE);
        }
        fsyncSync(targetHandle.descriptor);
        const committedStat = fstatSync(targetHandle.descriptor);
        if (
          !committedStat.isDirectory()
          || committedStat.uid !== currentEuid()
          || modeString(committedStat) !== DIRECTORY_MODE_STRING
        ) {
          fail("wakeflow-local-realization-directory", `${step.stepId} did not reach its private directory contract`);
        }
        assertRealDirectory(absolute, {
          workspaceRoot,
          label: step.stepId,
          allowedModes: [DIRECTORY_MODE_STRING],
          expectedIdentity: committedStat,
        });
        const parentStat = fstatSync(parentHandle.descriptor);
        if (!sameIdentity(parentStat, parentHandle.stat)) {
          fail("wakeflow-local-realization-race", `${step.stepId} parent descriptor changed identity`);
        }
        assertRealDirectory(parent, {
          workspaceRoot,
          label: `${step.stepId} parent`,
          expectedIdentity: parentStat,
        });
        fsyncSync(parentHandle.descriptor);
      } catch (cause) {
        if (cause instanceof WakeflowLocalLayoutRealizationError) throw cause;
        fail("wakeflow-local-realization-durability", `${step.stepId} commit durability is unknown`, { cause });
      } finally {
        closeDescriptor(targetHandle?.descriptor);
        closeDescriptor(parentHandle?.descriptor);
      }
    },
  };
}

function assertDerivationContext(workspaceRoot, context) {
  if (context === null) return;
  assertContext(workspaceRoot, context);
}

function nonMutationBlockers(inspection, action) {
  return inspection.blockers.filter((blocker) => (
    !isMutationBlocker(blocker) && !isDelegatedRepairBlocker(blocker, action)
  ));
}

/**
 * 在 gate 内重推当前 inspection，并接受尚未执行或已经提交的确认步骤前缀。
 * 无 composition scope 时必须匹配完整 structural digest；有 scope 时只允许事务自身的精确瞬态资源。
 */
function assertCurrentPlanAdmissible(
  inspection,
  confirmedPlan,
  localTransitionScope,
  projectionContext,
) {
  const scope = localTransitionScope === null
    ? null
    : assertWakeflowMaintenanceLocalTransitionScope(localTransitionScope);
  let blockers = nonMutationBlockers(inspection, confirmedPlan.payload.action);
  if (scope !== null) {
    blockers = filterAuthorizedComposedTransitionBlockers(blockers, {
      inspection,
      scope,
      ...projectionContext,
    });
  }
  if (blockers.length > 0) {
    fail("wakeflow-local-realization-blocked", "current local layout contains a blocking boundary", {
      details: { blockers: canonicalSnapshot(blockers, "current blockers") },
    });
  }
  const stepsByRef = new Map(confirmedPlan.payload.steps.map((step) => [step.final.ref, step]));
  const committedSources = new Map();
  for (const item of inspection.items.staticDirectories) {
    if (PROTOCOL_PROVIDED_SET.has(item.path)) {
      if (!["missing", "current"].includes(item.classification)) {
        fail("wakeflow-local-realization-blocked", `protocol-provided directory ${item.path} is unsafe`);
      }
      continue;
    }
    const step = stepsByRef.get(item.path);
    if (!step) {
      if (item.classification !== "current") {
        fail("wakeflow-local-realization-stale", `unplanned static directory changed: ${item.path}`);
      }
      continue;
    }
    if (step.source.type === "absent") {
      if (item.classification === "missing") continue;
      if (item.classification === "current") {
        committedSources.set(item.path, step);
        continue;
      }
    } else {
      if (item.classification === "permission-drift" && item.actual?.mode === step.source.mode) continue;
      if (item.classification === "current") {
        committedSources.set(item.path, step);
        continue;
      }
    }
    fail("wakeflow-local-realization-stale", `static directory step has an inadmissible state: ${item.path}`);
  }
  if (scope !== null) return;
  const digest = structuralInventoryDigest(inspection, committedSources);
  if (digest !== confirmedPlan.payload.structuralInventoryDigest) {
    fail("wakeflow-local-realization-stale", "local structural inventory changed since confirmation", {
      details: {
        expected: confirmedPlan.payload.structuralInventoryDigest,
        actual: digest,
      },
    });
  }
}

/**
 * 将已确认计划绑定为 T02 owner participant。
 * participant 不拥有 gate 和 journal；它只在 branded context 内复验本领域计划、执行步骤并提交结构闭包摘要。
 */
export function createWakeflowLocalLayoutMutationParticipant(value) {
  const input = exactInput(
    value,
    ["workspaceRoot", "confirmedPlan", "model", "layoutDescriptor", "hostProfile"],
    "local layout mutation participant input",
  );
  assertPosix();
  const layoutPlan = desiredLayout(input);
  const confirmedPlan = deepFreeze(canonicalSnapshot(input.confirmedPlan, "confirmed realization plan"));
  assertPlanShape(confirmedPlan, layoutPlan);
  if (confirmedPlan.payload.blockers.length > 0) {
    fail("wakeflow-local-realization-blocked", "a blocked realization plan cannot create a mutation participant");
  }
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const inspect = () => inspectWakeflowLocalLayout({
    workspaceRoot,
    model: input.model,
    layoutDescriptor: input.layoutDescriptor,
    hostProfile: input.hostProfile,
  });
  const stepHandlers = Object.fromEntries(confirmedPlan.payload.steps.map((step) => [
    step.stepId,
    createStepHandler(workspaceRoot, step),
  ]));

  return Object.freeze({
    validatePlan({ plan }) {
      const candidate = canonicalSnapshot(plan, "realization plan codec input");
      assertPlanShape(candidate, layoutPlan);
      if (!sameCanonical(candidate, confirmedPlan)) {
        fail("wakeflow-local-realization-plan", "realization plan differs from the participant contract");
      }
      return { valid: true };
    },

    deriveCurrentPlan({ context, localTransitionScope = null }) {
      assertDerivationContext(workspaceRoot, context);
      const inspection = inspect();
      assertCurrentPlanAdmissible(inspection, confirmedPlan, localTransitionScope, {
        workspaceRoot,
        model: input.model,
        hostProfile: input.hostProfile,
        configDigest: layoutPlan.configDigest,
      });
      return confirmedPlan;
    },

    deriveTerminalClosure({ context, plan, planDigest, localTransitionScope = null }) {
      assertContext(workspaceRoot, context);
      if (!sameCanonical(plan, confirmedPlan) || planDigest !== canonicalJsonDigest(confirmedPlan)) {
        fail("wakeflow-local-realization-plan", "terminal closure received a different realization plan");
      }
      const inspection = inspect();
      let closureDigest;
      let blockers = nonMutationBlockers(inspection, confirmedPlan.payload.action);
      if (localTransitionScope !== null) {
        const scope = assertWakeflowMaintenanceLocalTransitionScope(localTransitionScope);
        blockers = filterAuthorizedComposedTransitionBlockers(blockers, {
          inspection,
          scope,
          workspaceRoot,
          model: input.model,
          hostProfile: input.hostProfile,
          configDigest: layoutPlan.configDigest,
        });
        closureDigest = composedStructuralInventoryDigest(inspection);
      }
      if (blockers.length > 0) {
        fail("wakeflow-local-realization-blocked", "terminal local layout still contains a blocking boundary", {
          details: { blockers: canonicalSnapshot(blockers, "terminal blockers") },
        });
      }
      if (inspection.items.staticDirectories.some((item) => item.classification !== "current")) {
        fail("wakeflow-local-realization-terminal", "terminal local layout has an incomplete static directory");
      }
      const closure = {
        kind: "WakeflowLocalLayoutStructuralClosure",
        schemaVersion: 1,
        layoutPlanDigest: layoutPlan.planDigest,
        structuralInventoryDigest: closureDigest ?? structuralInventoryDigest(inspection),
      };
      return {
        planDigest,
        closureDigests: [{
          name: "local-layout-structural-closure",
          digest: canonicalJsonDigest(closure),
        }],
      };
    },

    stepHandlers: Object.freeze(stepHandlers),
  });
}

// 只接受本进程 inspection 模块签发且摘要自洽的事实，再复制为纯数据 projection source。
function inspectionSnapshot(value) {
  const input = exactInput(value, ["inspection"], "inspection projection input");
  assertWakeflowLocalLayoutInspection(input.inspection);
  const inspection = canonicalSnapshot(input.inspection, "local layout inspection");
  if (
    inspection.kind !== "WakeflowLocalLayoutInspection"
    || inspection.schemaVersion !== 1
    || typeof inspection.inspectionDigest !== "string"
  ) {
    fail("wakeflow-local-realization-inspection", "inspection projection source is invalid");
  }
  const { inspectionDigest, ...unsigned } = inspection;
  if (inspectionDigest !== canonicalJsonDigest(unsigned)) {
    fail("wakeflow-local-realization-inspection", "inspection projection source digest is invalid");
  }
  return inspection;
}

// storage projection 保留完整分区和摘要，但不把诊断结果提升为修复 authority。
export function projectWakeflowLocalLayoutStorage(value) {
  const inspection = inspectionSnapshot(value);
  return deepFreeze({
    kind: "WakeflowLocalLayoutStorageProjection",
    schemaVersion: 1,
    inspectionDigest: inspection.inspectionDigest,
    layoutPlanDigest: inspection.layoutPlanDigest,
    protocolRoot: inspection.protocolRoot,
    host: inspection.host,
    overall: inspection.overall,
    items: inspection.items,
    summary: inspection.summary,
  });
}

// verification 只把 healthy 映射为 ok；blocker 仍保留原 owner 与分类，不做全局健康语义重写。
export function verifyWakeflowLocalLayoutInspection(value) {
  const inspection = inspectionSnapshot(value);
  return deepFreeze({
    kind: "WakeflowLocalLayoutVerification",
    schemaVersion: 1,
    inspectionDigest: inspection.inspectionDigest,
    ok: inspection.overall === "healthy",
    overall: inspection.overall,
    blockers: inspection.blockers,
    summary: inspection.summary,
  });
}

export { inspectWakeflowLocalLayout };
