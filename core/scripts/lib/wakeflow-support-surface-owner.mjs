import { createHash } from "node:crypto";
import {
  lstatSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  buildWakeflowConfigV3Indexes,
  parseWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { assertWakeflowConfigV3TransitionAuthority } from "./wakeflow-config-v3-transition-authority.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "./wakeflow-host-capability.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  createWakeflowLayoutDescriptor,
  validateWakeflowConfigRootPlacements,
} from "./wakeflow-layout-descriptor.mjs";
import { planWakeflowSupportMaterialization } from "./wakeflow-support-materialization.mjs";
import { createWakeflowTrackedMaterializationParticipant } from "./wakeflow-tracked-materialization.mjs";

/**
 * Wakeflow-managed Design/Test support目录的物理领域owner。
 *
 * 职责导航：
 * 1. 从strict config/layout/host事实与当前目录观察构造closed owner plan。
 * 2. fresh只允许absent root；reconfigure/reconcile区分current、missing、mode drift与unsafe。
 * 3. 把ready plan投影为maintenance action，并把目录step适配给唯一T02/M3事务。
 * 4. participant在执行与恢复时重验config authority和当前owner plan。
 *
 * support memory bytes/managed-block归managed-content owner；底层mkdir、identity与恢复归tracked materialization。
 */

export const WAKEFLOW_SUPPORT_SURFACE_OWNER_SCHEMA_ID = "urn:wakeflow:internal:support-surface-owner-plan:v1";
export const WAKEFLOW_SUPPORT_SURFACE_OWNER_KIND = "WakeflowSupportSurfaceOwnerPlan";
export const WAKEFLOW_SUPPORT_SURFACE_OWNER_SCHEMA_VERSION = 1;

const ACTIONS = new Set(["fresh-initialize", "reconfigure", "reconcile"]);
const DIRECTORY_MODE = "0755";
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const DIRECTORY_MODE_RE = /^0[0-7]{3}$/u;
const SUPPORT_REFS = Object.freeze({
  design: Object.freeze([".", "drafts"]),
  test: Object.freeze([".", "fixtures", "harnesses"]),
});

export class WakeflowSupportSurfaceOwnerError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowSupportSurfaceOwnerError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowSupportSurfaceOwnerError(code, message, {
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

function exactKeys(value, allowed, required, label, errorPath = "$") {
  if (!isPlainObject(value)) fail("wakeflow-support-surface-contract", `${label} must be a plain object`, { path: errorPath });
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string" || !allowed.includes(key))) {
    fail("wakeflow-support-surface-contract", `${label} has an unknown field`, {
      path: errorPath,
      details: { allowed, actual: actual.map(String) },
    });
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-support-surface-contract", `${label}.${key} is required`, { path: `${errorPath}/${key}` });
    }
  }
  const snapshot = Object.create(null);
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-support-surface-contract", `${label}.${key} must be an enumerable data property`, {
        path: `${errorPath}/${key}`,
      });
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function canonicalSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-support-surface-canonical", `${label} must be canonical JSON data`, { cause });
  }
}

// 完整宿主画像允许携带 host-specific callback；共享 owner 只投影布局与展示所需字段。
function hostPresentationName(value) {
  if (!isPlainObject(value)) {
    fail("wakeflow-support-surface-host", "hostProfile must be a plain object facade");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "hostName");
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail("wakeflow-support-surface-host", "hostProfile.hostName must be an enumerable data property");
  }
  const hostName = descriptor.value;
  if (
    typeof hostName !== "string"
    || !hostName
    || hostName !== hostName.trim()
    || /[\r\n\0]/u.test(hostName)
  ) fail("wakeflow-support-surface-host", "hostProfile.hostName must be canonical single-line text");
  return hostName;
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail("wakeflow-support-surface-platform", "support-surface owner requires POSIX ownership semantics");
  }
  return process.geteuid();
}

function modeString(stat) {
  return `0${(stat.mode & 0o777).toString(8).padStart(3, "0")}`;
}

function normalizeInput(value, { participant = false } = {}) {
  const allowed = [
    "workspaceRoot",
    "action",
    "sourceModel",
    "desiredModel",
    "layoutDescriptor",
    "hostProfile",
    ...(participant ? ["confirmedPlan"] : []),
  ];
  const input = exactKeys(value, allowed, allowed, participant
    ? "support-surface participant input"
    : "support-surface planning input");
  if (
    typeof input.workspaceRoot !== "string"
    || !input.workspaceRoot
    || input.workspaceRoot.trim() !== input.workspaceRoot
    || input.workspaceRoot.includes("\0")
    || !path.isAbsolute(input.workspaceRoot)
    || path.resolve(input.workspaceRoot) !== input.workspaceRoot
  ) {
    fail("wakeflow-support-surface-input", "workspaceRoot must be one exact absolute path");
  }
  const workspaceRoot = input.workspaceRoot;
  if (!ACTIONS.has(input.action)) fail("wakeflow-support-surface-input", "action is invalid");
  const sourceModelInput = input.sourceModel === null
    ? null
    : canonicalSnapshot(input.sourceModel, "source config model");
  const desiredModelInput = canonicalSnapshot(input.desiredModel, "desired config model");
  const layoutDescriptor = canonicalSnapshot(input.layoutDescriptor, "layout descriptor");
  const sourceModel = sourceModelInput === null ? null : parseWakeflowConfigV3(sourceModelInput);
  const desiredModel = parseWakeflowConfigV3(desiredModelInput);
  if (input.action === "fresh-initialize" && sourceModel !== null) {
    fail("wakeflow-support-surface-input", "fresh-initialize requires sourceModel=null");
  }
  if (input.action !== "fresh-initialize" && sourceModel === null) {
    fail("wakeflow-support-surface-input", `${input.action} requires one strict source model`);
  }
  if (sourceModel !== null && sourceModel.program.programId !== desiredModel.program.programId) {
    fail("wakeflow-support-surface-input", "source and desired program identities differ");
  }
  if (
    input.action === "reconcile"
    && wakeflowConfigV3Digest(sourceModel) !== wakeflowConfigV3Digest(desiredModel)
  ) fail("wakeflow-support-surface-input", "reconcile cannot change config semantics");
  const profile = normalizeWakeflowHostCapabilityProfile(input.hostProfile);
  const hostName = hostPresentationName(input.hostProfile);
  const hostProfile = deepFreeze({
    hostId: profile.hostId,
    hostName,
    memoryFile: profile.memoryFile,
    runtime: { hostDirName: profile.hostDirName },
    capabilities: profile.capabilities,
  });
  const expectedDescriptor = createWakeflowLayoutDescriptor({
    model: desiredModel,
    hostProfile,
  });
  if (!sameCanonical(expectedDescriptor, layoutDescriptor)) {
    fail("wakeflow-support-surface-layout", "layout descriptor differs from config and host authority");
  }
  validateWakeflowConfigRootPlacements({ workspaceRoot, model: desiredModel });
  if (sourceModel !== null) validateWakeflowConfigRootPlacements({ workspaceRoot, model: sourceModel });
  return {
    workspaceRoot,
    action: input.action,
    sourceModel,
    desiredModel,
    layoutDescriptor: expectedDescriptor,
    hostProfile,
    profile,
    ...(participant ? { confirmedPlan: input.confirmedPlan } : {}),
  };
}

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

function directoryDigest({ programId, surfaceId, role, ref }) {
  return canonicalJsonDigest({
    kind: "WakeflowSupportCapabilityDirectory",
    schemaVersion: 1,
    programId,
    surfaceId,
    role,
    ref,
    mode: DIRECTORY_MODE,
  });
}

function operationId(surfaceId, ref) {
  const suffix = createHash("sha256").update(`${surfaceId}\0${ref}`).digest("hex").slice(0, 32);
  return `support-surface-${suffix}`;
}

function resourceRef(surfaceId, ref) {
  return `targets/support-surface/${surfaceId}/${ref === "." ? "root" : ref}`;
}

function operationOrder(entry) {
  return `${entry.public.surfaceId}:${entry.public.ref === "." ? "0" : `1:${entry.public.ref}`}`;
}

function expectedCapabilities(supportPlan, surfaceId) {
  return supportPlan.operations
    .filter((entry) => entry.surfaceId === surfaceId && entry.kind === "ensure-directory")
    .map((entry) => path.posix.basename(entry.path))
    .sort(lexicalCompare);
}

function classifyDirectory({ normalized, surface, role, ref, parentPlanned }) {
  const target = ref === "."
    ? path.resolve(normalized.workspaceRoot, ...surface.path.split("/"))
    : path.resolve(normalized.workspaceRoot, ...surface.path.split("/"), ref);
  const inspected = inspectDirectory(target);
  const digest = directoryDigest({
    programId: normalized.desiredModel.program.programId,
    surfaceId: surface.surfaceId,
    role,
    ref,
  });
  const base = {
    operationId: operationId(surface.surfaceId, ref),
    surfaceId: surface.surfaceId,
    role,
    ref,
    resourceRef: resourceRef(surface.surfaceId, ref),
    root: {
      kind: "support-surface",
      rootId: surface.surfaceId,
      configuredPath: surface.path,
      basis: "target",
    },
  };
  if (normalized.action === "fresh-initialize" && ref === "." && inspected.classification !== "missing") {
    return {
      public: {
        ...base,
        classification: inspected.classification === "unsafe" ? "conflict" : "legacy-or-managed-footprint",
        source: inspected.classification === "unsafe"
          ? { type: "unsafe", mode: null, digest: null }
          : { type: "directory", mode: modeString(inspected.stat), digest },
        target: null,
        action: "blocked",
        reasonCode: inspected.classification === "unsafe"
          ? "fresh-support-root-unsafe"
          : "fresh-support-root-present",
      },
      private: null,
    };
  }
  if (inspected.classification === "current") {
    const node = { type: "directory", mode: DIRECTORY_MODE, digest };
    return {
      public: {
        ...base,
        classification: "managed-current",
        source: node,
        target: node,
        action: "current",
        reasonCode: "support-capability-current",
      },
      private: { targetPath: target },
    };
  }
  if (inspected.classification === "missing") {
    const parent = inspectDirectory(path.dirname(target));
    if (!parentPlanned && !["current", "mode-drift"].includes(parent.classification)) {
      return {
        public: {
          ...base,
          classification: "conflict",
          source: { type: "absent" },
          target: null,
          action: "blocked",
          reasonCode: "support-capability-parent-unavailable",
        },
        private: null,
      };
    }
    const targetNode = { type: "directory", mode: DIRECTORY_MODE, digest };
    return {
      public: {
        ...base,
        classification: "managed-missing",
        source: { type: "absent" },
        target: targetNode,
        action: "create-managed",
        reasonCode: ref === "." ? "support-root-create" : "support-capability-create",
      },
      private: { targetPath: target },
    };
  }
  return {
    public: {
      ...base,
      classification: "conflict",
      source: inspected.classification === "unsafe"
        ? { type: "unsafe", mode: null, digest: null }
        : { type: "directory", mode: modeString(inspected.stat), digest },
      target: null,
      action: "blocked",
      reasonCode: inspected.classification === "mode-drift"
        ? "support-capability-mode-drift"
        : "support-capability-unsafe",
    },
    private: null,
  };
}

function stepFor(operation, ordinal) {
  return {
    stepId: operation.operationId,
    ordinal,
    stepKind: "create-or-update",
    source: { ref: operation.resourceRef, ...operation.source },
    staging: null,
    final: { ref: operation.resourceRef, ...operation.target },
  };
}

function derivePlan(normalized) {
  const indexes = buildWakeflowConfigV3Indexes(normalized.desiredModel);
  const supportPlan = planWakeflowSupportMaterialization({
    model: normalized.desiredModel,
    layoutDescriptor: normalized.layoutDescriptor,
    hostProfile: normalized.hostProfile,
  });
  const classified = [];
  for (const [role, window] of [["design", indexes.designWindow], ["test", indexes.testWindow]]) {
    const surface = indexes.surfaceById[window.root.surfaceId];
    if (surface.ownership !== "wakeflow-managed") continue;
    const root = classifyDirectory({ normalized, surface, role, ref: ".", parentPlanned: false });
    classified.push(root);
    if (root.public.action === "blocked") continue;
    const rootPlanned = root.public.action === "create-managed";
    for (const ref of expectedCapabilities(supportPlan, surface.surfaceId)) {
      classified.push(classifyDirectory({ normalized, surface, role, ref, parentPlanned: rootPlanned }));
    }
  }
  // Parent directories must precede their capabilities in the one M3 commit
  // order. resourceRef remains presentation-only and therefore does not carry
  // a synthetic ordering prefix.
  classified.sort((left, right) => lexicalCompare(operationOrder(left), operationOrder(right)));
  const operations = classified.map((entry) => entry.public);
  const privateOperations = new Map(classified
    .filter((entry) => entry.private !== null)
    .map((entry) => [entry.public.operationId, entry.private]));
  const blockers = operations.filter((entry) => entry.action === "blocked").map((entry) => ({
    blockerId: entry.operationId,
    operationId: entry.operationId,
    resourceRef: entry.resourceRef,
    code: entry.reasonCode,
  }));
  const steps = operations.filter((entry) => entry.action === "create-managed").map(stepFor);
  const plannedSupportSurfaceIds = operations
    .filter((entry) => entry.ref === "." && entry.action === "create-managed")
    .map((entry) => entry.surfaceId)
    .sort(lexicalCompare);
  const payload = {
    kind: WAKEFLOW_SUPPORT_SURFACE_OWNER_KIND,
    schemaVersion: WAKEFLOW_SUPPORT_SURFACE_OWNER_SCHEMA_VERSION,
    action: normalized.action,
    status: blockers.length === 0 ? "ready" : "blocked",
    programId: normalized.desiredModel.program.programId,
    hostId: normalized.profile.hostId,
    sourceModelDigest: normalized.sourceModel === null ? null : wakeflowConfigV3Digest(normalized.sourceModel),
    desiredModelDigest: wakeflowConfigV3Digest(normalized.desiredModel),
    layoutDigest: normalized.layoutDescriptor.layoutDigest,
    plannedSupportSurfaceIds,
    operations,
    blockers,
    steps,
  };
  return {
    plan: validatePlanInternal({ schemaId: WAKEFLOW_SUPPORT_SURFACE_OWNER_SCHEMA_ID, payload }),
    privateOperations,
  };
}

function validateResourceNode(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (!isPlainObject(value) || typeof value.type !== "string") {
    fail("wakeflow-support-surface-plan", `${label} must be one resource node`);
  }
  if (value.type === "absent") {
    exactKeys(value, ["type"], ["type"], label);
    return value;
  }
  if (value.type === "unsafe") {
    exactKeys(value, ["type", "mode", "digest"], ["type", "mode", "digest"], label);
    if (value.mode !== null || value.digest !== null) fail("wakeflow-support-surface-plan", `${label} unsafe node must be redacted`);
    return value;
  }
  exactKeys(value, ["type", "mode", "digest"], ["type", "mode", "digest"], label);
  if (value.type !== "directory" || !DIRECTORY_MODE_RE.test(value.mode) || !DIGEST_RE.test(value.digest)) {
    fail("wakeflow-support-surface-plan", `${label} directory node is invalid`);
  }
  return value;
}

function assertTypedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, label);
  } catch (cause) {
    fail("wakeflow-support-surface-plan", `${label} is not a canonical ${type} identifier`, { cause });
  }
  return null;
}

function assertPortableSupportRoot(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value.trim() !== value
    || value.includes("\\")
    || value.includes("\0")
    || /[\r\n]/u.test(value)
    || path.posix.isAbsolute(value)
    || path.posix.normalize(value) !== value
    || value === "."
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    fail("wakeflow-support-surface-plan", `${label} must be one canonical portable support root`);
  }
  return value;
}

function sameResource(left, right) {
  return sameCanonical(left, right);
}

function validateOperationSemantics(payload, operation, index) {
  assertTypedId(operation.surfaceId, "surface", `support operation ${index} surfaceId`);
  const allowedRefs = SUPPORT_REFS[operation.role];
  if (!allowedRefs || !allowedRefs.includes(operation.ref)) {
    fail("wakeflow-support-surface-plan", `support operation ${index} role/ref relation is invalid`);
  }
  const root = exactKeys(
    operation.root,
    ["kind", "rootId", "configuredPath", "basis"],
    ["kind", "rootId", "configuredPath", "basis"],
    `support operation ${index} root`,
  );
  if (
    root.kind !== "support-surface"
    || root.rootId !== operation.surfaceId
    || root.basis !== "target"
  ) {
    fail("wakeflow-support-surface-plan", `support operation ${index} root identity is invalid`);
  }
  assertPortableSupportRoot(root.configuredPath, `support operation ${index} configuredPath`);
  if (
    operation.operationId !== operationId(operation.surfaceId, operation.ref)
    || operation.resourceRef !== resourceRef(operation.surfaceId, operation.ref)
  ) {
    fail("wakeflow-support-surface-plan", `support operation ${index} derived identity is invalid`);
  }

  const expectedDirectory = {
    type: "directory",
    mode: DIRECTORY_MODE,
    digest: directoryDigest({
      programId: payload.programId,
      surfaceId: operation.surfaceId,
      role: operation.role,
      ref: operation.ref,
    }),
  };
  const source = validateResourceNode(operation.source, `support operation ${index} source`);
  const target = validateResourceNode(operation.target, `support operation ${index} target`, { nullable: true });
  if (source.type === "directory" && source.digest !== expectedDirectory.digest) {
    fail("wakeflow-support-surface-plan", `support operation ${index} source digest is not derived`);
  }
  if (target?.type === "directory" && target.digest !== expectedDirectory.digest) {
    fail("wakeflow-support-surface-plan", `support operation ${index} target digest is not derived`);
  }

  if (operation.action === "current") {
    if (
      operation.classification !== "managed-current"
      || operation.reasonCode !== "support-capability-current"
      || !sameResource(source, expectedDirectory)
      || !sameResource(target, expectedDirectory)
    ) fail("wakeflow-support-surface-plan", `support operation ${index} current matrix is invalid`);
    return;
  }
  if (operation.action === "create-managed") {
    const expectedReason = operation.ref === "." ? "support-root-create" : "support-capability-create";
    if (
      operation.classification !== "managed-missing"
      || operation.reasonCode !== expectedReason
      || !sameResource(source, { type: "absent" })
      || !sameResource(target, expectedDirectory)
    ) fail("wakeflow-support-surface-plan", `support operation ${index} create matrix is invalid`);
    return;
  }
  if (operation.action !== "blocked" || target !== null) {
    fail("wakeflow-support-surface-plan", `support operation ${index} action/target relation is invalid`);
  }
  const blockedMatrix = {
    "fresh-support-root-unsafe": operation.ref === "."
      && payload.action === "fresh-initialize"
      && operation.classification === "conflict"
      && source.type === "unsafe",
    "fresh-support-root-present": operation.ref === "."
      && payload.action === "fresh-initialize"
      && operation.classification === "legacy-or-managed-footprint"
      && source.type === "directory",
    "support-capability-parent-unavailable": operation.ref !== "."
      && operation.classification === "conflict"
      && source.type === "absent",
    "support-capability-mode-drift": operation.classification === "conflict"
      && source.type === "directory"
      && source.mode !== DIRECTORY_MODE,
    "support-capability-unsafe": operation.classification === "conflict"
      && source.type === "unsafe",
  };
  if (blockedMatrix[operation.reasonCode] !== true) {
    fail("wakeflow-support-surface-plan", `support operation ${index} blocked matrix is invalid`);
  }
}

function validateOperationCoverage(operations) {
  if (operations.length > 5) {
    fail("wakeflow-support-surface-plan", "support operation set exceeds the closed Design/Test surface budget");
  }
  const byRole = new Map();
  const roleBySurface = new Map();
  for (const operation of operations) {
    const existingRole = roleBySurface.get(operation.surfaceId);
    if (existingRole && existingRole !== operation.role) {
      fail("wakeflow-support-surface-plan", "one support surface cannot serve both Design and Test roles");
    }
    roleBySurface.set(operation.surfaceId, operation.role);
    const group = byRole.get(operation.role) ?? [];
    if (group.length > 0 && group[0].surfaceId !== operation.surfaceId) {
      fail("wakeflow-support-surface-plan", `support role ${operation.role} names multiple surfaces`);
    }
    group.push(operation);
    byRole.set(operation.role, group);
  }
  for (const [role, group] of byRole) {
    const root = group.find((operation) => operation.ref === ".");
    if (!root) fail("wakeflow-support-surface-plan", `support role ${role} omits its root operation`);
    if (group.some((operation) => !sameCanonical(operation.root, root.root))) {
      fail("wakeflow-support-surface-plan", `support role ${role} operations disagree on their configured root`);
    }
    const expectedRefs = root.action === "blocked" ? ["."] : SUPPORT_REFS[role];
    const actualRefs = group.map((operation) => operation.ref).sort(lexicalCompare);
    if (!sameCanonical(actualRefs, [...expectedRefs].sort(lexicalCompare))) {
      fail("wakeflow-support-surface-plan", `support role ${role} operation coverage is incomplete`);
    }
  }
}

function validatePlanInternal(value) {
  const plan = canonicalSnapshot(value, "support-surface owner plan");
  exactKeys(plan, ["schemaId", "payload"], ["schemaId", "payload"], "support-surface owner plan");
  if (plan.schemaId !== WAKEFLOW_SUPPORT_SURFACE_OWNER_SCHEMA_ID) {
    fail("wakeflow-support-surface-plan", "support-surface owner schema identity is invalid");
  }
  const payloadKeys = [
    "kind", "schemaVersion", "action", "status", "programId", "hostId",
    "sourceModelDigest", "desiredModelDigest", "layoutDigest", "plannedSupportSurfaceIds",
    "operations", "blockers", "steps",
  ];
  exactKeys(plan.payload, payloadKeys, payloadKeys, "support-surface owner payload");
  const payload = plan.payload;
  if (
    payload.kind !== WAKEFLOW_SUPPORT_SURFACE_OWNER_KIND
    || payload.schemaVersion !== WAKEFLOW_SUPPORT_SURFACE_OWNER_SCHEMA_VERSION
    || !ACTIONS.has(payload.action)
    || !DIGEST_RE.test(payload.desiredModelDigest)
    || !DIGEST_RE.test(payload.layoutDigest)
    || (payload.sourceModelDigest !== null && !DIGEST_RE.test(payload.sourceModelDigest))
    || !Array.isArray(payload.operations)
    || !Array.isArray(payload.blockers)
    || !Array.isArray(payload.steps)
    || !Array.isArray(payload.plannedSupportSurfaceIds)
  ) fail("wakeflow-support-surface-plan", "support-surface owner plan metadata is invalid");
  assertTypedId(payload.programId, "program", "support plan programId");
  if (typeof payload.hostId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(payload.hostId)) {
    fail("wakeflow-support-surface-plan", "support plan hostId is invalid");
  }
  if (
    (payload.action === "fresh-initialize" && payload.sourceModelDigest !== null)
    || (payload.action !== "fresh-initialize" && payload.sourceModelDigest === null)
    || (payload.action === "reconcile" && payload.sourceModelDigest !== payload.desiredModelDigest)
  ) fail("wakeflow-support-surface-plan", "support plan action/source digest relation is invalid");
  const operationIds = new Set();
  let previousOrder = null;
  for (const [index, operation] of payload.operations.entries()) {
    const keys = [
      "operationId", "surfaceId", "role", "ref", "resourceRef", "root",
      "classification", "source", "target", "action", "reasonCode",
    ];
    exactKeys(operation, keys, keys, `support operation ${index}`);
    if (
      typeof operation.operationId !== "string"
      || operationIds.has(operation.operationId)
      || !["design", "test"].includes(operation.role)
      || ![".", "drafts", "fixtures", "harnesses"].includes(operation.ref)
      || typeof operation.resourceRef !== "string"
      || (previousOrder !== null && lexicalCompare(previousOrder, operationOrder({ public: operation })) >= 0)
      || !["current", "create-managed", "blocked"].includes(operation.action)
    ) fail("wakeflow-support-surface-plan", "support operation identity or ordering is invalid");
    operationIds.add(operation.operationId);
    previousOrder = operationOrder({ public: operation });
    validateOperationSemantics(payload, operation, index);
  }
  validateOperationCoverage(payload.operations);
  const expectedBlocked = payload.operations.filter((entry) => entry.action === "blocked").map((entry) => ({
    blockerId: entry.operationId,
    operationId: entry.operationId,
    resourceRef: entry.resourceRef,
    code: entry.reasonCode,
  }));
  if (!sameCanonical(payload.blockers, expectedBlocked)) {
    fail("wakeflow-support-surface-plan", "support blockers are not derived from operations");
  }
  const expectedSteps = payload.operations.filter((entry) => entry.action === "create-managed").map(stepFor);
  if (!sameCanonical(payload.steps, expectedSteps)) {
    fail("wakeflow-support-surface-plan", "support steps are not derived from operations");
  }
  const expectedPlanned = payload.operations
    .filter((entry) => entry.ref === "." && entry.action === "create-managed")
    .map((entry) => entry.surfaceId)
    .sort(lexicalCompare);
  if (
    !sameCanonical(payload.plannedSupportSurfaceIds, expectedPlanned)
    || payload.status !== (payload.blockers.length === 0 ? "ready" : "blocked")
  ) fail("wakeflow-support-surface-plan", "support status or planned-root set is not derived");
  return deepFreeze(plan);
}

/** 观察 Wakeflow-owned Design/Test 目录并生成闭合、只读的领域 owner plan。 */
export function planWakeflowSupportSurfaceOwner(value) {
  return derivePlan(normalizeInput(value)).plan;
}

/** 校验 portable owner plan 的字段、派生身份、状态矩阵、覆盖范围与 step 闭包。 */
export function validateWakeflowSupportSurfaceOwnerPlan(value) {
  return validatePlanInternal(value);
}

/** 把已验证 owner plan 投影为统一 maintenance composition 可以消费的动作片段。 */
export function projectWakeflowSupportSurfaceMaintenance(value) {
  const input = exactKeys(
    value,
    ["plan", "transactionOffset"],
    ["plan", "transactionOffset"],
    "support maintenance projection input",
  );
  const plan = validatePlanInternal(input.plan);
  if (!Number.isSafeInteger(input.transactionOffset) || input.transactionOffset < 0) {
    fail("wakeflow-support-surface-input", "transactionOffset must be one non-negative safe integer");
  }
  const planDigest = canonicalJsonDigest(plan);
  const stepIndex = new Map(plan.payload.steps.map((entry, index) => [entry.stepId, index]));
  const filesystemActions = plan.payload.operations
    .filter((entry) => entry.action !== "blocked")
    .map((entry) => {
      const physicalIndex = stepIndex.get(entry.operationId);
      const physical = physicalIndex !== undefined;
      return {
        actionId: entry.operationId,
        componentId: "support-surface",
        owner: "support-materializer",
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
        commitOrder: physical ? input.transactionOffset + physicalIndex : null,
      };
    });
  const dependencyChecks = plan.payload.blockers.map((entry) => ({
    checkId: `support-blocked-${entry.operationId}`,
    componentId: "support-surface",
    owner: "support-materializer",
    subject: { kind: "resource", value: entry.resourceRef },
    status: "blocked",
    code: entry.code,
    evidence: [{ kind: "owner-plan", ref: entry.resourceRef, digest: planDigest }],
  }));
  const blockers = dependencyChecks.map((entry) => ({
    blockerId: entry.checkId,
    componentId: entry.componentId,
    owner: entry.owner,
    subject: entry.subject,
    code: entry.code,
    dependencyCheckId: entry.checkId,
  }));
  return deepFreeze({
    components: [{
      componentId: "support-surface",
      owner: "support-materializer",
      ownerPlanDigest: planDigest,
    }],
    filesystemActions,
    dependencyChecks,
    preserved: [],
    deferredOwnerActions: dependencyChecks.map((entry) => ({
      deferredId: entry.checkId,
      componentId: entry.componentId,
      owner: entry.owner,
      action: "resolve-support-surface-conflict",
      subject: entry.subject,
      prerequisiteCheckIds: [entry.checkId],
      reasonCode: entry.code,
    })),
    blockers,
    steps: plan.payload.steps.map((step, index) => ({ ...step, ordinal: input.transactionOffset + index })),
    plannedSupportSurfaceIds: plan.payload.plannedSupportSurfaceIds,
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
    fail("wakeflow-support-surface-config", "strict config authority is unavailable", { cause });
  }
}

/** 为 ready plan 创建 T02/M3 participant；执行和恢复前都会重验 config 与 owner plan。 */
export function createWakeflowSupportSurfaceMutationParticipant(value) {
  const normalized = normalizeInput(value, { participant: true });
  const confirmedPlan = validatePlanInternal(normalized.confirmedPlan);
  if (confirmedPlan.payload.status !== "ready") {
    fail("wakeflow-support-surface-blocked", "a blocked support-surface plan cannot create a participant");
  }
  const derived = derivePlan(normalized);
  const operationById = new Map(confirmedPlan.payload.operations.map((entry) => [entry.operationId, entry]));
  const privateOperations = confirmedPlan.payload.steps.map((step) => {
    const privateOperation = derived.privateOperations.get(step.stepId);
    const publicOperation = operationById.get(step.stepId);
    const surface = normalized.desiredModel.topology.supportSurfaces.find((entry) => (
      entry.surfaceId === publicOperation.surfaceId
    ));
    const targetPath = publicOperation.ref === "."
      ? path.resolve(normalized.workspaceRoot, ...surface.path.split("/"))
      : path.resolve(normalized.workspaceRoot, ...surface.path.split("/"), publicOperation.ref);
    return {
      stepId: step.stepId,
      kind: "directory",
      targetPath: privateOperation?.targetPath ?? targetPath,
      stagePath: null,
      targetBytes: null,
      maxFileBytes: null,
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
    closureName: "support-surface-closure",
  });
}
