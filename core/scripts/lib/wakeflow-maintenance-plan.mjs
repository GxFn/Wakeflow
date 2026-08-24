import { createHash } from "node:crypto";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";

/**
 * 三类workspace维护动作共用的纯数据计划合同。
 *
 * 职责导航：
 * 1. createWakeflowMaintenancePlan把各领域owner的投影汇总为规范排序、不可变的aggregate plan。
 * 2. validateWakeflowMaintenancePlan重新验证外部或持久化后返回的完整计划，不信任派生字段。
 * 3. validateGraph闭合component、owner、dependency、blocker、filesystem action与transaction step关系。
 * 4. wakeflowMaintenancePlanDigest只对通过同一合同的计划生成摘要。
 * 5. 本模块不读取workspace、不执行写入，也不签发apply权限；物理事务归workspace mutation层所有。
 */

// 一、计划身份、闭合词汇与资源上限。
export const WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_ID = "urn:wakeflow:internal:workspace-maintenance-plan:v1";
export const WAKEFLOW_MAINTENANCE_PLAN_KIND = "WakeflowWorkspaceMaintenancePlan";
export const WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_VERSION = 1;
export const WAKEFLOW_MAINTENANCE_PLAN_ACTIONS = Object.freeze([
  "fresh-initialize",
  "reconfigure",
  "reconcile",
]);

const ACTION_SET = new Set(WAKEFLOW_MAINTENANCE_PLAN_ACTIONS);
const HOST_IDS = new Set(["codex", "claude-code"]);
const CONFIG_REF = "wakeflow.config.json";
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TOKEN_RE = /^[a-z][a-z0-9-]{0,127}$/u;
const MODE_RE = /^0[0-7]{3}$/u;
const TARGET_FILE_MODES = new Set(["0600", "0644"]);
const TARGET_DIRECTORY_MODES = new Set(["0700", "0755"]);
const SAFE_PRIVATE_DIRECTORY_SOURCE_MODES = new Set(
  Array.from({ length: 0o1000 }, (_, mode) => mode)
    .filter((mode) => (mode & 0o700) === 0o700 && (mode & 0o022) === 0 && mode !== 0o700)
    .map((mode) => mode.toString(8).padStart(4, "0")),
);
const MAX_PLAN_BYTES = 4 * 1024 * 1024;
const MAX_COLLECTION_ITEMS = 4_096;

const ENTITY_TYPES = Object.freeze(["repository", "surface", "window"]);
const ENTITY_TYPE_SET = new Set(ENTITY_TYPES);
const ENTITY_CHANGE_SET = new Set([
  "unchanged",
  "metadata-changed",
  "added",
  "removed",
  "root-changed",
  "role-reassigned",
]);
const ROOT_KINDS = new Set(["program", "ledger", "repository", "support-surface"]);
const ROOT_BASES = new Set(["source", "target"]);
const CLASSIFICATIONS = new Set([
  "managed-missing",
  "managed-current",
  "managed-stale-known",
  "managed-modified",
  "user-owned",
  "legacy-generated-exact",
  "legacy-generated-modified",
  "derived-projection",
  "runtime-fact",
  "unknown-nonconflicting",
  "conflict",
]);
const FILESYSTEM_ACTIONS = new Set([
  "current",
  "create-managed",
  "update-managed",
  "remove-managed-block",
  "remove-empty-static-dir",
  "preserve",
  "defer",
  "blocked",
]);
const PHYSICAL_ACTIONS = new Set([
  "create-managed",
  "update-managed",
  "remove-managed-block",
  "remove-empty-static-dir",
]);
const AUTHORIZATION_KINDS = new Set([
  "none",
  "wakeflow-owned",
  "configured-managed-component",
  "explicit-repository",
  "owner-lifecycle",
]);
const DEPENDENCY_STATUSES = new Set(["satisfied", "blocked", "deferred", "not-applicable"]);
const SUBJECT_KINDS = new Set(["program", "repository", "surface", "window", "host", "resource"]);
const STEP_KINDS = new Set(["create-or-update", "remove"]);

// 二、错误合同与canonical JSON准入原语。
export class WakeflowMaintenancePlanError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowMaintenancePlanError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowMaintenancePlanError(code, message, {
    path: errorPath,
    details,
    cause,
  });
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 在任何字段读取和排序前先复制纯JSON快照，拒绝accessor、symbol和非枚举权威。
function cloneCanonical(value, label = "maintenance plan") {
  let encoded;
  try {
    encoded = canonicalJson(value);
  } catch (cause) {
    fail("wakeflow-maintenance-plan-canonical", `${label} must be canonical JSON data`, { cause });
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_PLAN_BYTES) {
    fail("wakeflow-maintenance-plan-too-large", `${label} exceeds the bounded plan size`);
  }
  return JSON.parse(encoded);
}

function exactKeys(value, expected, label, errorPath = "$") {
  if (!isPlainObject(value)) {
    fail("wakeflow-maintenance-plan-contract", `${label} must be a plain object`, { errorPath });
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail("wakeflow-maintenance-plan-contract", `${label} has an invalid field set`, {
      errorPath,
      details: { expected: wanted, actual },
    });
  }
  return value;
}

function boundedArray(value, label, errorPath) {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_ITEMS) {
    fail("wakeflow-maintenance-plan-contract", `${label} must be a bounded array`, { errorPath });
  }
  return value;
}

function token(value, label, errorPath) {
  if (typeof value !== "string" || !TOKEN_RE.test(value)) {
    fail("wakeflow-maintenance-plan-contract", `${label} must be a bounded lowercase token`, { errorPath });
  }
  return value;
}

function digest(value, label, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-maintenance-plan-contract", `${label} must be a lowercase sha256 digest`, { errorPath });
  }
  return value;
}

function typedId(value, type, label, errorPath) {
  try {
    return assertWakeflowId(value, type, errorPath);
  } catch (cause) {
    fail("wakeflow-maintenance-plan-contract", `${label} must be a typed ${type} identifier`, {
      errorPath,
      cause,
    });
  }
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertCanonicalOrder(values, key, label, errorPath) {
  const actual = values.map(key);
  const expected = [...actual].sort(lexicalCompare);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("wakeflow-maintenance-plan-order", `${label} must use canonical order`, { errorPath });
  }
}

function normalizedRootRelativeRef(value, label, errorPath, { allowDot = true } = {}) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\\")
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || path.posix.isAbsolute(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
    || path.posix.normalize(value) !== value
    || (!allowDot && value === ".")
    || value === ".."
    || value.startsWith("../")
    || value.includes("/../")
  ) {
    fail("wakeflow-maintenance-plan-ref", `${label} must be a canonical root-relative ref`, { errorPath });
  }
  return value;
}

function contentDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// 三、配置、宿主、拓扑与资源节点的领域字段规范化。
function normalizeNode(value, label, errorPath, { target = false } = {}) {
  if (!isPlainObject(value)) {
    fail("wakeflow-maintenance-plan-resource", `${label} must be a resource node`, { errorPath });
  }
  if (value.type === "absent") {
    exactKeys(value, ["type"], label, errorPath);
    return { type: "absent" };
  }
  exactKeys(value, ["type", "mode", "digest"], label, errorPath);
  if (value.type !== "file" && value.type !== "directory") {
    fail("wakeflow-maintenance-plan-resource", `${label}.type is invalid`, { errorPath });
  }
  if (typeof value.mode !== "string" || !MODE_RE.test(value.mode)) {
    fail("wakeflow-maintenance-plan-resource", `${label}.mode is invalid`, { errorPath });
  }
  if (target) {
    const modes = value.type === "file" ? TARGET_FILE_MODES : TARGET_DIRECTORY_MODES;
    if (!modes.has(value.mode)) {
      fail("wakeflow-maintenance-plan-resource", `${label}.mode is not an admitted target mode`, { errorPath });
    }
  }
  return { type: value.type, mode: value.mode, digest: digest(value.digest, `${label}.digest`, errorPath) };
}

function normalizeStepResource(value, label, errorPath, { target = false } = {}) {
  if (!isPlainObject(value)) {
    fail("wakeflow-maintenance-plan-step", `${label} must be a step resource`, { errorPath });
  }
  const ref = normalizedRootRelativeRef(value.ref, `${label}.ref`, `${errorPath}/ref`, { allowDot: false });
  const node = normalizeNode(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== "ref")),
    label,
    errorPath,
    { target },
  );
  return { ref, ...node };
}

function normalizeConfig(value, action, { creation = false } = {}) {
  exactKeys(
    value,
    creation
      ? ["disposition", "source", "sourceAuthority", "desiredModel"]
      : ["disposition", "source", "sourceAuthority", "target", "desiredModel", "desiredModelDigest"],
    "maintenance config contract",
    "$/config",
  );
  const desiredModel = parseWakeflowConfigV3(value.desiredModel);
  const desiredModelDigest = wakeflowConfigV3Digest(desiredModel);
  const target = {
    type: "file",
    mode: "0644",
    digest: contentDigest(serializeWakeflowConfigV3(desiredModel)),
  };
  if (!creation) {
    const suppliedTarget = normalizeNode(value.target, "config.target", "$/config/target", { target: true });
    const suppliedModelDigest = digest(
      value.desiredModelDigest,
      "config desiredModelDigest",
      "$/config/desiredModelDigest",
    );
    if (
      canonicalJson(suppliedTarget) !== canonicalJson(target)
      || suppliedModelDigest !== desiredModelDigest
    ) {
      fail("wakeflow-maintenance-plan-config", "config derived target metadata is stale", {
        errorPath: "$/config",
      });
    }
  }
  const source = normalizeNode(value.source, "config.source", "$/config/source");
  let sourceAuthority = null;
  if (value.sourceAuthority !== null) {
    exactKeys(
      value.sourceAuthority,
      ["programId", "modelDigest"],
      "config source authority",
      "$/config/sourceAuthority",
    );
    sourceAuthority = {
      programId: typedId(
        value.sourceAuthority.programId,
        "program",
        "config source programId",
        "$/config/sourceAuthority/programId",
      ),
      modelDigest: digest(
        value.sourceAuthority.modelDigest,
        "config source modelDigest",
        "$/config/sourceAuthority/modelDigest",
      ),
    };
  }
  if (!new Set(["create", "current", "update"]).has(value.disposition)) {
    fail("wakeflow-maintenance-plan-config", "config disposition is invalid", {
      errorPath: "$/config/disposition",
    });
  }
  if ((source.type === "absent") !== (sourceAuthority === null)) {
    fail("wakeflow-maintenance-plan-config", "config source and source authority disagree", {
      errorPath: "$/config",
    });
  }
  if (source.type !== "absent" && (source.type !== "file" || source.mode !== "0644")) {
    fail("wakeflow-maintenance-plan-config", "existing strict config must be one 0644 file", {
      errorPath: "$/config/source",
    });
  }
  const current = source.type === "file"
    && canonicalJson(source) === canonicalJson(target)
    && sourceAuthority?.programId === desiredModel.program.programId
    && sourceAuthority?.modelDigest === desiredModelDigest;
  if (action === "fresh-initialize") {
    if (value.disposition !== "create" || source.type !== "absent" || sourceAuthority !== null) {
      fail("wakeflow-maintenance-plan-config", "fresh initialize requires absent→create config", {
        errorPath: "$/config",
      });
    }
  } else {
    if (source.type !== "file" || sourceAuthority?.programId !== desiredModel.program.programId) {
      fail("wakeflow-maintenance-plan-config", `${action} must preserve the exact program ID`, {
        errorPath: "$/config/sourceAuthority",
      });
    }
    if (action === "reconcile" && (value.disposition !== "current" || !current)) {
      fail("wakeflow-maintenance-plan-config", "reconcile cannot change config bytes or semantics", {
        errorPath: "$/config",
      });
    }
    if (action === "reconfigure") {
      if ((value.disposition === "current") !== current || value.disposition === "create") {
        fail("wakeflow-maintenance-plan-config", "reconfigure config disposition differs from its source/target", {
          errorPath: "$/config/disposition",
        });
      }
    }
  }
  return {
    disposition: value.disposition,
    source,
    sourceAuthority,
    target,
    desiredModel,
    desiredModelDigest,
  };
}

function normalizeHost(value) {
  exactKeys(value, ["hostId", "profileDigest"], "maintenance host", "$/host");
  if (!HOST_IDS.has(value.hostId)) {
    fail("wakeflow-maintenance-plan-host", "hostId is not a Wakeflow protocol host", {
      errorPath: "$/host/hostId",
    });
  }
  return {
    hostId: value.hostId,
    profileDigest: digest(value.profileDigest, "host profileDigest", "$/host/profileDigest"),
  };
}

function targetEntities(model) {
  const records = [];
  for (const entry of model.topology.repositories) {
    records.push({
      entityType: "repository",
      entityId: entry.repositoryId,
      digest: canonicalJsonDigest(entry),
      placement: entry.path,
      entry,
    });
  }
  for (const entry of model.topology.supportSurfaces) {
    records.push({
      entityType: "surface",
      entityId: entry.surfaceId,
      digest: canonicalJsonDigest(entry),
      placement: entry.path,
      entry,
    });
  }
  for (const entry of model.topology.windows) {
    records.push({
      entityType: "window",
      entityId: entry.windowId,
      digest: canonicalJsonDigest(entry),
      placement: null,
      entry,
    });
  }
  return records;
}

function entityKey(type, id) {
  return `${type}:${id}`;
}

function entityIdType(type) {
  return type === "surface" ? "surface" : type;
}

function normalizeTopologyDiff(values, action, desiredModel, { sort = false } = {}) {
  const targets = targetEntities(desiredModel);
  const targetByKey = new Map(targets.map((entry) => [entityKey(entry.entityType, entry.entityId), entry]));
  const seen = new Set();
  const normalized = boundedArray(values, "topologyDiff", "$/topologyDiff").map((value, index) => {
    const at = `$/topologyDiff/${index}`;
    exactKeys(value, [
      "entityType",
      "entityId",
      "change",
      "sourceDigest",
      "targetDigest",
      "sourcePlacement",
      "targetPlacement",
    ], "topology diff entry", at);
    if (!ENTITY_TYPE_SET.has(value.entityType) || !ENTITY_CHANGE_SET.has(value.change)) {
      fail("wakeflow-maintenance-plan-topology", "topology diff type or change is invalid", { errorPath: at });
    }
    const entityId = typedId(
      value.entityId,
      entityIdType(value.entityType),
      "topology entityId",
      `${at}/entityId`,
    );
    const key = entityKey(value.entityType, entityId);
    if (seen.has(key)) {
      fail("wakeflow-maintenance-plan-topology", "topology diff contains a duplicate entity", { errorPath: at });
    }
    seen.add(key);
    const target = targetByKey.get(key) ?? null;
    const sourceDigest = value.sourceDigest === null
      ? null
      : digest(value.sourceDigest, "topology sourceDigest", `${at}/sourceDigest`);
    const targetDigest = value.targetDigest === null
      ? null
      : digest(value.targetDigest, "topology targetDigest", `${at}/targetDigest`);
    const placementBearing = value.entityType !== "window";
    const sourcePlacement = value.sourcePlacement;
    const targetPlacement = value.targetPlacement;
    if (
      (sourcePlacement !== null && typeof sourcePlacement !== "string")
      || (targetPlacement !== null && typeof targetPlacement !== "string")
      || (!placementBearing && (sourcePlacement !== null || targetPlacement !== null))
    ) {
      fail("wakeflow-maintenance-plan-topology", "topology placement shape is invalid", { errorPath: at });
    }
    if (value.change === "added") {
      if (!target || sourceDigest !== null || sourcePlacement !== null || targetDigest !== target.digest) {
        fail("wakeflow-maintenance-plan-topology", "added topology entry is not an exact target addition", { errorPath: at });
      }
    } else if (value.change === "removed") {
      if (target || sourceDigest === null || targetDigest !== null || targetPlacement !== null) {
        fail("wakeflow-maintenance-plan-topology", "removed topology entry is not an exact source removal", { errorPath: at });
      }
    } else {
      if (!target || sourceDigest === null || targetDigest !== target.digest) {
        fail("wakeflow-maintenance-plan-topology", "topology entry does not close its current target", { errorPath: at });
      }
      if (value.change === "unchanged" && (
        sourceDigest !== targetDigest
        || sourcePlacement !== targetPlacement
      )) {
        fail("wakeflow-maintenance-plan-topology", "unchanged topology entry differs", { errorPath: at });
      }
    }
    if (target && targetPlacement !== target.placement) {
      fail("wakeflow-maintenance-plan-topology", "topology target placement differs from desired config", {
        errorPath: `${at}/targetPlacement`,
      });
    }
    if (placementBearing && value.change !== "added" && sourcePlacement === null) {
      fail("wakeflow-maintenance-plan-topology", "source topology placement is required", {
        errorPath: `${at}/sourcePlacement`,
      });
    }
    return {
      entityType: value.entityType,
      entityId,
      change: value.change,
      sourceDigest,
      targetDigest,
      sourcePlacement,
      targetPlacement,
    };
  });
  for (const target of targets) {
    if (!seen.has(entityKey(target.entityType, target.entityId))) {
      fail("wakeflow-maintenance-plan-topology", "topology diff omits a desired stable entity", {
        details: { entityType: target.entityType, entityId: target.entityId },
      });
    }
  }
  if (action === "fresh-initialize" && normalized.some((entry) => entry.change !== "added")) {
    fail("wakeflow-maintenance-plan-topology", "fresh topology may contain only added entities");
  }
  if (action === "reconcile" && normalized.some((entry) => entry.change !== "unchanged")) {
    fail("wakeflow-maintenance-plan-topology", "reconcile topology must remain unchanged");
  }
  const key = (entry) => `${String(ENTITY_TYPES.indexOf(entry.entityType)).padStart(2, "0")}:${entry.entityId}`;
  if (sort) normalized.sort((left, right) => lexicalCompare(key(left), key(right)));
  else assertCanonicalOrder(normalized, key, "topologyDiff", "$/topologyDiff");
  return normalized;
}

// 四、owner component、filesystem action、dependency、evidence与transaction step规范化。
function normalizeComponents(values, { sort = false } = {}) {
  const seen = new Set();
  const normalized = boundedArray(values, "components", "$/components").map((value, index) => {
    const at = `$/components/${index}`;
    exactKeys(value, ["componentId", "owner", "ownerPlanDigest"], "maintenance component", at);
    const componentId = token(value.componentId, "componentId", `${at}/componentId`);
    if (seen.has(componentId)) {
      fail("wakeflow-maintenance-plan-component", "duplicate componentId", { errorPath: at });
    }
    seen.add(componentId);
    return {
      componentId,
      owner: token(value.owner, "component owner", `${at}/owner`),
      ownerPlanDigest: digest(value.ownerPlanDigest, "ownerPlanDigest", `${at}/ownerPlanDigest`),
    };
  });
  if (normalized.length === 0) {
    fail("wakeflow-maintenance-plan-component", "maintenance plan requires at least one component");
  }
  if (sort) normalized.sort((left, right) => lexicalCompare(left.componentId, right.componentId));
  else assertCanonicalOrder(normalized, (entry) => entry.componentId, "components", "$/components");
  return normalized;
}

function topologyEntryFor(topology, type, id) {
  return topology.find((entry) => entry.entityType === type && entry.entityId === id) ?? null;
}

function normalizeActionRoot(value, desiredModel, topology, errorPath) {
  exactKeys(value, ["kind", "rootId", "basis", "configuredPath"], "filesystem action root", errorPath);
  if (!ROOT_KINDS.has(value.kind) || !ROOT_BASES.has(value.basis)) {
    fail("wakeflow-maintenance-plan-root", "filesystem root kind or basis is invalid", { errorPath });
  }
  let rootId;
  let expectedPath;
  if (value.kind === "program" || value.kind === "ledger") {
    rootId = typedId(value.rootId, "program", "rootId", `${errorPath}/rootId`);
    if (rootId !== desiredModel.program.programId) {
      fail("wakeflow-maintenance-plan-root", "program-scoped root belongs to another program", { errorPath });
    }
    expectedPath = value.kind === "program" ? "." : desiredModel.storage.ledgerRoot;
  } else {
    const entityType = value.kind === "repository" ? "repository" : "surface";
    rootId = typedId(value.rootId, entityType, "rootId", `${errorPath}/rootId`);
    const diff = topologyEntryFor(topology, entityType, rootId);
    if (!diff) {
      fail("wakeflow-maintenance-plan-root", "filesystem root has no topology authority", { errorPath });
    }
    expectedPath = value.basis === "source" ? diff.sourcePlacement : diff.targetPlacement;
    if (expectedPath === null) {
      fail("wakeflow-maintenance-plan-root", "filesystem root basis has no configured placement", { errorPath });
    }
  }
  if (value.configuredPath !== expectedPath) {
    fail("wakeflow-maintenance-plan-root", "filesystem root differs from its config/topology mapping", {
      errorPath: `${errorPath}/configuredPath`,
      details: { expected: expectedPath, actual: value.configuredPath },
    });
  }
  return { kind: value.kind, rootId, basis: value.basis, configuredPath: expectedPath };
}

function normalizeAuthorization(value, root, desiredModel, topology, errorPath) {
  if (!isPlainObject(value) || !AUTHORIZATION_KINDS.has(value.kind)) {
    fail("wakeflow-maintenance-plan-authorization", "filesystem authorization is invalid", { errorPath });
  }
  if (value.kind === "explicit-repository") {
    exactKeys(value, ["kind", "repositoryId"], "explicit repository authorization", errorPath);
    const repositoryId = typedId(
      value.repositoryId,
      "repository",
      "authorization repositoryId",
      `${errorPath}/repositoryId`,
    );
    const diff = topologyEntryFor(topology, "repository", repositoryId);
    const targetAuthorized = root.basis === "target"
      && diff?.targetPlacement !== null
      && desiredModel.topology.repositories.some((entry) => entry.repositoryId === repositoryId);
    const sourceAuthorized = root.basis === "source" && diff?.sourcePlacement !== null;
    if (
      root.kind !== "repository"
      || root.rootId !== repositoryId
      || (!targetAuthorized && !sourceAuthorized)
    ) {
      fail("wakeflow-maintenance-plan-authorization", "repository authorization differs from the action root", {
        errorPath,
      });
    }
    return { kind: value.kind, repositoryId };
  }
  exactKeys(value, ["kind"], "filesystem authorization", errorPath);
  return { kind: value.kind };
}

function nodeEquals(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function normalizeFilesystemActions(values, desiredModel, topology, { sort = false } = {}) {
  const actionIds = new Set();
  const resourceRefs = new Set();
  const normalized = boundedArray(values, "filesystemActions", "$/filesystemActions").map((value, index) => {
    const at = `$/filesystemActions/${index}`;
    exactKeys(value, [
      "actionId",
      "componentId",
      "owner",
      "root",
      "ref",
      "resourceRef",
      "classification",
      "source",
      "target",
      "action",
      "authorization",
      "reasonCode",
      "stepId",
      "commitOrder",
    ], "filesystem action", at);
    const actionId = token(value.actionId, "actionId", `${at}/actionId`);
    if (actionIds.has(actionId)) {
      fail("wakeflow-maintenance-plan-action", "duplicate filesystem actionId", { errorPath: at });
    }
    actionIds.add(actionId);
    const resourceRef = normalizedRootRelativeRef(
      value.resourceRef,
      "resourceRef",
      `${at}/resourceRef`,
      { allowDot: false },
    );
    if (resourceRefs.has(resourceRef)) {
      fail("wakeflow-maintenance-plan-action", "duplicate filesystem resourceRef", { errorPath: at });
    }
    resourceRefs.add(resourceRef);
    if (!CLASSIFICATIONS.has(value.classification) || !FILESYSTEM_ACTIONS.has(value.action)) {
      fail("wakeflow-maintenance-plan-action", "filesystem classification or action is invalid", { errorPath: at });
    }
    const root = normalizeActionRoot(value.root, desiredModel, topology, `${at}/root`);
    const source = normalizeNode(value.source, "filesystem action source", `${at}/source`);
    const target = normalizeNode(value.target, "filesystem action target", `${at}/target`, { target: true });
    const authorization = normalizeAuthorization(
      value.authorization,
      root,
      desiredModel,
      topology,
      `${at}/authorization`,
    );
    const physical = PHYSICAL_ACTIONS.has(value.action);
    if (physical) {
      if (value.stepId !== actionId || !Number.isSafeInteger(value.commitOrder) || value.commitOrder < 0) {
        fail("wakeflow-maintenance-plan-action", "physical action must bind its own step and commit order", {
          errorPath: at,
        });
      }
      if (authorization.kind === "none" || authorization.kind === "owner-lifecycle") {
        fail("wakeflow-maintenance-plan-authorization", "physical action lacks write authorization", {
          errorPath: `${at}/authorization`,
        });
      }
    } else if (value.stepId !== null || value.commitOrder !== null) {
      fail("wakeflow-maintenance-plan-action", "non-physical action cannot bind a transaction step", {
        errorPath: at,
      });
    }
    if (value.action === "current" || value.action === "preserve") {
      if (!nodeEquals(source, target)) {
        fail("wakeflow-maintenance-plan-action", `${value.action} action must preserve the exact resource`, {
          errorPath: at,
        });
      }
    } else if (value.action === "create-managed") {
      if (source.type !== "absent" || target.type === "absent") {
        fail("wakeflow-maintenance-plan-action", "create-managed requires absent→present", { errorPath: at });
      }
    } else if (value.action === "update-managed" || value.action === "remove-managed-block") {
      if (source.type === "absent" || target.type === "absent" || source.type !== target.type) {
        fail("wakeflow-maintenance-plan-action", `${value.action} requires present→present`, { errorPath: at });
      }
    } else if (value.action === "remove-empty-static-dir") {
      if (source.type !== "directory" || target.type !== "absent") {
        fail("wakeflow-maintenance-plan-action", "remove-empty-static-dir requires directory→absent", {
          errorPath: at,
        });
      }
    }
    return {
      actionId,
      componentId: token(value.componentId, "componentId", `${at}/componentId`),
      owner: token(value.owner, "action owner", `${at}/owner`),
      root,
      ref: normalizedRootRelativeRef(value.ref, "filesystem ref", `${at}/ref`),
      resourceRef,
      classification: value.classification,
      source,
      target,
      action: value.action,
      authorization,
      reasonCode: token(value.reasonCode, "reasonCode", `${at}/reasonCode`),
      stepId: physical ? actionId : null,
      commitOrder: physical ? value.commitOrder : null,
    };
  });
  if (sort) normalized.sort((left, right) => lexicalCompare(left.actionId, right.actionId));
  else assertCanonicalOrder(normalized, (entry) => entry.actionId, "filesystemActions", "$/filesystemActions");
  return normalized;
}

function normalizeSubject(value, errorPath) {
  exactKeys(value, ["kind", "value"], "dependency subject", errorPath);
  if (!SUBJECT_KINDS.has(value.kind)) {
    fail("wakeflow-maintenance-plan-dependency", "dependency subject kind is invalid", { errorPath });
  }
  let normalized;
  if (new Set(["program", "repository", "surface", "window"]).has(value.kind)) {
    normalized = typedId(value.value, value.kind, "dependency subject", `${errorPath}/value`);
  } else if (value.kind === "host") {
    if (!HOST_IDS.has(value.value)) {
      fail("wakeflow-maintenance-plan-dependency", "dependency host subject is invalid", { errorPath });
    }
    normalized = value.value;
  } else {
    normalized = normalizedRootRelativeRef(value.value, "dependency resource subject", `${errorPath}/value`, {
      allowDot: false,
    });
  }
  return { kind: value.kind, value: normalized };
}

function normalizeEvidence(values, errorPath) {
  const normalized = boundedArray(values, "dependency evidence", errorPath).map((value, index) => {
    const at = `${errorPath}/${index}`;
    exactKeys(value, ["kind", "ref", "digest"], "dependency evidence", at);
    return {
      kind: token(value.kind, "evidence kind", `${at}/kind`),
      ref: value.ref === null
        ? null
        : normalizedRootRelativeRef(value.ref, "evidence ref", `${at}/ref`),
      digest: digest(value.digest, "evidence digest", `${at}/digest`),
    };
  });
  assertCanonicalOrder(
    normalized,
    (entry) => `${entry.kind}:${entry.ref ?? ""}:${entry.digest}`,
    "dependency evidence",
    errorPath,
  );
  return normalized;
}

function normalizeDependencies(values, { sort = false } = {}) {
  const seen = new Set();
  const normalized = boundedArray(values, "dependencyChecks", "$/dependencyChecks").map((value, index) => {
    const at = `$/dependencyChecks/${index}`;
    exactKeys(value, [
      "checkId",
      "componentId",
      "owner",
      "subject",
      "status",
      "code",
      "evidence",
    ], "dependency check", at);
    const checkId = token(value.checkId, "checkId", `${at}/checkId`);
    if (seen.has(checkId)) {
      fail("wakeflow-maintenance-plan-dependency", "duplicate dependency checkId", { errorPath: at });
    }
    seen.add(checkId);
    if (!DEPENDENCY_STATUSES.has(value.status)) {
      fail("wakeflow-maintenance-plan-dependency", "dependency status is invalid", { errorPath: at });
    }
    return {
      checkId,
      componentId: token(value.componentId, "componentId", `${at}/componentId`),
      owner: token(value.owner, "dependency owner", `${at}/owner`),
      subject: normalizeSubject(value.subject, `${at}/subject`),
      status: value.status,
      code: token(value.code, "dependency code", `${at}/code`),
      evidence: normalizeEvidence(value.evidence, `${at}/evidence`),
    };
  });
  if (sort) normalized.sort((left, right) => lexicalCompare(left.checkId, right.checkId));
  else assertCanonicalOrder(normalized, (entry) => entry.checkId, "dependencyChecks", "$/dependencyChecks");
  return normalized;
}

function normalizePreserved(values, { sort = false } = {}) {
  const seen = new Set();
  const normalized = boundedArray(values, "preserved", "$/preserved").map((value, index) => {
    const at = `$/preserved/${index}`;
    exactKeys(value, ["actionId", "reasonCode"], "preserved action reference", at);
    const actionId = token(value.actionId, "preserved actionId", `${at}/actionId`);
    if (seen.has(actionId)) fail("wakeflow-maintenance-plan-preserved", "duplicate preserved action", { errorPath: at });
    seen.add(actionId);
    return { actionId, reasonCode: token(value.reasonCode, "preserved reasonCode", `${at}/reasonCode`) };
  });
  if (sort) normalized.sort((left, right) => lexicalCompare(left.actionId, right.actionId));
  else assertCanonicalOrder(normalized, (entry) => entry.actionId, "preserved", "$/preserved");
  return normalized;
}

function normalizeDeferred(values, { sort = false } = {}) {
  const seen = new Set();
  const normalized = boundedArray(values, "deferredOwnerActions", "$/deferredOwnerActions").map((value, index) => {
    const at = `$/deferredOwnerActions/${index}`;
    exactKeys(value, [
      "deferredId",
      "componentId",
      "owner",
      "action",
      "subject",
      "prerequisiteCheckIds",
      "reasonCode",
    ], "deferred owner action", at);
    const deferredId = token(value.deferredId, "deferredId", `${at}/deferredId`);
    if (seen.has(deferredId)) fail("wakeflow-maintenance-plan-deferred", "duplicate deferredId", { errorPath: at });
    seen.add(deferredId);
    const prerequisiteCheckIds = boundedArray(
      value.prerequisiteCheckIds,
      "prerequisiteCheckIds",
      `${at}/prerequisiteCheckIds`,
    ).map((entry, item) => token(entry, "prerequisite checkId", `${at}/prerequisiteCheckIds/${item}`));
    if (new Set(prerequisiteCheckIds).size !== prerequisiteCheckIds.length) {
      fail("wakeflow-maintenance-plan-deferred", "deferred prerequisites contain duplicates", { errorPath: at });
    }
    const sortedPrerequisites = [...prerequisiteCheckIds].sort(lexicalCompare);
    if (canonicalJson(prerequisiteCheckIds) !== canonicalJson(sortedPrerequisites)) {
      fail("wakeflow-maintenance-plan-order", "deferred prerequisites must use canonical order", { errorPath: at });
    }
    return {
      deferredId,
      componentId: token(value.componentId, "componentId", `${at}/componentId`),
      owner: token(value.owner, "deferred owner", `${at}/owner`),
      action: token(value.action, "deferred owner action", `${at}/action`),
      subject: normalizeSubject(value.subject, `${at}/subject`),
      prerequisiteCheckIds,
      reasonCode: token(value.reasonCode, "deferred reasonCode", `${at}/reasonCode`),
    };
  });
  if (sort) normalized.sort((left, right) => lexicalCompare(left.deferredId, right.deferredId));
  else assertCanonicalOrder(normalized, (entry) => entry.deferredId, "deferredOwnerActions", "$/deferredOwnerActions");
  return normalized;
}

function normalizeBlockers(values, { sort = false } = {}) {
  const seen = new Set();
  const normalized = boundedArray(values, "blockers", "$/blockers").map((value, index) => {
    const at = `$/blockers/${index}`;
    exactKeys(value, [
      "blockerId",
      "componentId",
      "owner",
      "subject",
      "code",
      "dependencyCheckId",
    ], "maintenance blocker", at);
    const blockerId = token(value.blockerId, "blockerId", `${at}/blockerId`);
    if (seen.has(blockerId)) fail("wakeflow-maintenance-plan-blocker", "duplicate blockerId", { errorPath: at });
    seen.add(blockerId);
    return {
      blockerId,
      componentId: token(value.componentId, "componentId", `${at}/componentId`),
      owner: token(value.owner, "blocker owner", `${at}/owner`),
      subject: normalizeSubject(value.subject, `${at}/subject`),
      code: token(value.code, "blocker code", `${at}/code`),
      dependencyCheckId: value.dependencyCheckId === null
        ? null
        : token(value.dependencyCheckId, "blocker dependencyCheckId", `${at}/dependencyCheckId`),
    };
  });
  if (sort) normalized.sort((left, right) => lexicalCompare(left.blockerId, right.blockerId));
  else assertCanonicalOrder(normalized, (entry) => entry.blockerId, "blockers", "$/blockers");
  return normalized;
}

function normalizeSteps(values) {
  return boundedArray(values, "steps", "$/steps").map((value, index) => {
    const at = `$/steps/${index}`;
    exactKeys(value, ["stepId", "ordinal", "stepKind", "source", "staging", "final"], "maintenance step", at);
    const stepId = token(value.stepId, "stepId", `${at}/stepId`);
    if (value.ordinal !== index || !STEP_KINDS.has(value.stepKind)) {
      fail("wakeflow-maintenance-plan-step", "step ordinal or kind is invalid", { errorPath: at });
    }
    const source = normalizeStepResource(value.source, "step source", `${at}/source`);
    const final = normalizeStepResource(value.final, "step final", `${at}/final`, { target: true });
    const staging = value.staging === null
      ? null
      : normalizeStepResource(value.staging, "step staging", `${at}/staging`, { target: true });
    if (value.stepKind === "create-or-update") {
      if (source.ref !== final.ref || final.type === "absent") {
        fail("wakeflow-maintenance-plan-step", "create/update step has inconsistent resource refs", { errorPath: at });
      }
      if (staging === null) {
        const directoryCreate = source.type === "absent"
          && final.type === "directory"
          && TARGET_DIRECTORY_MODES.has(final.mode);
        const privateModeRepair = source.type === "directory"
          && final.type === "directory"
          && source.digest === final.digest
          && SAFE_PRIVATE_DIRECTORY_SOURCE_MODES.has(source.mode)
          && final.mode === "0700";
        if (!directoryCreate && !privateModeRepair) {
          fail("wakeflow-maintenance-plan-step", "null-staging step is not directory create/private repair", {
            errorPath: at,
          });
        }
      } else if (
        staging.ref === final.ref
        || path.posix.dirname(staging.ref) !== path.posix.dirname(final.ref)
        || !nodeEquals(
          { type: staging.type, mode: staging.mode, digest: staging.digest },
          { type: final.type, mode: final.mode, digest: final.digest },
        )
      ) {
        fail("wakeflow-maintenance-plan-step", "staging and final resources differ", { errorPath: at });
      }
    } else if (
      source.type === "absent"
      || staging === null
      || final.type !== "absent"
      || source.ref !== final.ref
      || staging.ref === final.ref
      || path.posix.dirname(staging.ref) !== path.posix.dirname(final.ref)
      || !nodeEquals(
        { type: source.type, mode: source.mode, digest: source.digest },
        { type: staging.type, mode: staging.mode, digest: staging.digest },
      )
    ) {
      fail("wakeflow-maintenance-plan-step", "remove step contract is invalid", { errorPath: at });
    }
    return { stepId, ordinal: index, stepKind: value.stepKind, source, staging, final };
  });
}

/**
 * 交叉验证规范化后的整张计划图，确保每个引用都由唯一且一致的owner事实闭合。
 * 这里验证关系，不判断任何领域证据本身是否足以授权写入。
 */
function validateGraph(payload) {
  const componentById = new Map(payload.components.map((entry) => [entry.componentId, entry]));
  const actionById = new Map(payload.filesystemActions.map((entry) => [entry.actionId, entry]));
  const dependencyById = new Map(payload.dependencyChecks.map((entry) => [entry.checkId, entry]));
  const blockerByDependency = new Map();
  const assertOwned = (entry, label) => {
    const component = componentById.get(entry.componentId);
    if (!component || component.owner !== entry.owner) {
      fail("wakeflow-maintenance-plan-owner", `${label} differs from its component owner`, {
        details: { componentId: entry.componentId, owner: entry.owner },
      });
    }
  };
  for (const action of payload.filesystemActions) assertOwned(action, `filesystem action ${action.actionId}`);
  for (const dependency of payload.dependencyChecks) assertOwned(dependency, `dependency ${dependency.checkId}`);
  for (const deferred of payload.deferredOwnerActions) {
    assertOwned(deferred, `deferred action ${deferred.deferredId}`);
    for (const checkId of deferred.prerequisiteCheckIds) {
      if (!dependencyById.has(checkId)) {
        fail("wakeflow-maintenance-plan-deferred", "deferred action references an unknown dependency", {
          details: { deferredId: deferred.deferredId, checkId },
        });
      }
    }
  }
  for (const blocker of payload.blockers) {
    assertOwned(blocker, `blocker ${blocker.blockerId}`);
    if (blocker.dependencyCheckId !== null) {
      const dependency = dependencyById.get(blocker.dependencyCheckId);
      if (
        !dependency
        || dependency.status !== "blocked"
        || dependency.componentId !== blocker.componentId
        || dependency.owner !== blocker.owner
        || !nodeEquals(dependency.subject, blocker.subject)
        || dependency.code !== blocker.code
      ) {
        fail("wakeflow-maintenance-plan-blocker", "blocker does not close one blocked dependency", {
          details: { blockerId: blocker.blockerId },
        });
      }
      if (blockerByDependency.has(blocker.dependencyCheckId)) {
        fail("wakeflow-maintenance-plan-blocker", "blocked dependency has multiple blockers", {
          details: { checkId: blocker.dependencyCheckId },
        });
      }
      blockerByDependency.set(blocker.dependencyCheckId, blocker);
    }
  }
  for (const dependency of payload.dependencyChecks) {
    if (dependency.status === "blocked" && !blockerByDependency.has(dependency.checkId)) {
      fail("wakeflow-maintenance-plan-blocker", "blocked dependency lacks an exact blocker", {
        details: { checkId: dependency.checkId },
      });
    }
  }
  for (const preserved of payload.preserved) {
    const action = actionById.get(preserved.actionId);
    if (!action || action.action !== "preserve" || action.reasonCode !== preserved.reasonCode) {
      fail("wakeflow-maintenance-plan-preserved", "preserved entry does not select one preserve action", {
        details: { actionId: preserved.actionId },
      });
    }
  }

  const physicalActions = payload.filesystemActions
    .filter((entry) => PHYSICAL_ACTIONS.has(entry.action))
    .sort((left, right) => left.commitOrder - right.commitOrder);
  if (physicalActions.length !== payload.steps.length) {
    fail("wakeflow-maintenance-plan-step", "physical actions and transaction steps differ in cardinality");
  }
  for (let index = 0; index < payload.steps.length; index += 1) {
    const action = physicalActions[index];
    const step = payload.steps[index];
    if (!action || action.commitOrder !== index || action.stepId !== step.stepId || action.actionId !== step.stepId) {
      fail("wakeflow-maintenance-plan-step", "physical action commit order differs from steps", {
        details: { ordinal: index },
      });
    }
    const expectedKind = action.action === "remove-empty-static-dir" ? "remove" : "create-or-update";
    if (
      step.stepKind !== expectedKind
      || step.source.ref !== action.resourceRef
      || step.final.ref !== action.resourceRef
      || !nodeEquals(
        Object.fromEntries(Object.entries(step.source).filter(([key]) => key !== "ref")),
        action.source,
      )
      || !nodeEquals(
        Object.fromEntries(Object.entries(step.final).filter(([key]) => key !== "ref")),
        action.target,
      )
    ) {
      fail("wakeflow-maintenance-plan-step", "transaction step differs from its filesystem action", {
        details: { actionId: action.actionId },
      });
    }
  }

  const configActions = payload.filesystemActions.filter((entry) => (
    entry.owner === "config-writer"
    && entry.root.kind === "program"
    && entry.root.basis === "target"
    && entry.root.configuredPath === "."
    && entry.ref === CONFIG_REF
    && entry.resourceRef === `targets/program/${payload.programId}/${CONFIG_REF}`
  ));
  if (configActions.length !== 1) {
    fail("wakeflow-maintenance-plan-config", "plan must contain one exact config inventory action");
  }
  const configAction = configActions[0];
  if (!nodeEquals(configAction.source, payload.config.source) || !nodeEquals(configAction.target, payload.config.target)) {
    fail("wakeflow-maintenance-plan-config", "config action differs from the config contract");
  }
  const expectedAction = {
    create: "create-managed",
    current: "current",
    update: "update-managed",
  }[payload.config.disposition];
  if (configAction.action !== expectedAction) {
    fail("wakeflow-maintenance-plan-config", "config action differs from config disposition");
  }
  if (payload.action === "reconcile" && configAction.stepId !== null) {
    fail("wakeflow-maintenance-plan-config", "reconcile cannot contain a config mutation step");
  }

  const blocked = payload.blockers.length > 0
    || payload.dependencyChecks.some((entry) => entry.status === "blocked")
    || payload.filesystemActions.some((entry) => entry.action === "blocked");
  const expectedStatus = blocked ? "blocked" : "ready";
  if (payload.status !== expectedStatus) {
    fail("wakeflow-maintenance-plan-status", "plan status differs from its blockers");
  }
}

function normalizePayload(value, { sort = false, creation = false } = {}) {
  const expected = [
    "kind",
    "schemaVersion",
    "action",
    "status",
    "programId",
    "host",
    "config",
    "layoutDigest",
    "topologyDiff",
    "components",
    "filesystemActions",
    "dependencyChecks",
    "preserved",
    "deferredOwnerActions",
    "blockers",
    "steps",
  ];
  if (creation) {
    exactKeys(
      value,
      expected.filter((field) => !new Set(["kind", "schemaVersion", "status"]).has(field)),
      "maintenance plan creation input",
    );
  } else {
    exactKeys(value, expected, "maintenance plan payload", "$/payload");
    if (value.kind !== WAKEFLOW_MAINTENANCE_PLAN_KIND || value.schemaVersion !== WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_VERSION) {
      fail("wakeflow-maintenance-plan-identity", "maintenance plan kind or version is invalid", {
        errorPath: "$/payload",
      });
    }
    if (value.status !== "ready" && value.status !== "blocked") {
      fail("wakeflow-maintenance-plan-status", "maintenance plan status is invalid", {
        errorPath: "$/payload/status",
      });
    }
  }
  if (!ACTION_SET.has(value.action)) {
    fail("wakeflow-maintenance-plan-action", "maintenance plan action is invalid", {
      errorPath: "$/payload/action",
    });
  }
  const config = normalizeConfig(value.config, value.action, { creation });
  const normalizedProgramId = typedId(value.programId, "program", "programId", "$/payload/programId");
  if (normalizedProgramId !== config.desiredModel.program.programId) {
    fail("wakeflow-maintenance-plan-config", "plan programId differs from desired config", {
      errorPath: "$/payload/programId",
    });
  }
  const topologyDiff = normalizeTopologyDiff(value.topologyDiff, value.action, config.desiredModel, { sort });
  const components = normalizeComponents(value.components, { sort });
  const filesystemActions = normalizeFilesystemActions(
    value.filesystemActions,
    config.desiredModel,
    topologyDiff,
    { sort },
  );
  const dependencyChecks = normalizeDependencies(value.dependencyChecks, { sort });
  const preserved = normalizePreserved(value.preserved, { sort });
  const deferredOwnerActions = normalizeDeferred(value.deferredOwnerActions, { sort });
  const blockers = normalizeBlockers(value.blockers, { sort });
  const steps = normalizeSteps(value.steps);
  const blocked = blockers.length > 0
    || dependencyChecks.some((entry) => entry.status === "blocked")
    || filesystemActions.some((entry) => entry.action === "blocked");
  const payload = {
    kind: WAKEFLOW_MAINTENANCE_PLAN_KIND,
    schemaVersion: WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_VERSION,
    action: value.action,
    status: blocked ? "blocked" : "ready",
    programId: normalizedProgramId,
    host: normalizeHost(value.host),
    config,
    layoutDigest: digest(value.layoutDigest, "layoutDigest", "$/payload/layoutDigest"),
    topologyDiff,
    components,
    filesystemActions,
    dependencyChecks,
    preserved,
    deferredOwnerActions,
    blockers,
    steps,
  };
  if (!creation && value.status !== payload.status) {
    fail("wakeflow-maintenance-plan-status", "maintenance plan status is not derived", {
      errorPath: "$/payload/status",
    });
  }
  validateGraph(payload);
  return payload;
}

// 五、公共计划codec；creation负责规范排序，validation要求输入本身已经符合规范顺序。
function validateInternal(value) {
  exactKeys(value, ["schemaId", "payload"], "workspace maintenance plan");
  if (value.schemaId !== WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_ID) {
    fail("wakeflow-maintenance-plan-identity", "maintenance plan schemaId is invalid", {
      errorPath: "$/schemaId",
    });
  }
  return {
    schemaId: WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_ID,
    payload: normalizePayload(value.payload),
  };
}

/**
 * 从各owner提供的计划片段创建唯一规范的aggregate plan。
 */
export function createWakeflowMaintenancePlan(value) {
  const input = cloneCanonical(value, "maintenance plan creation input");
  const payload = normalizePayload(input, { sort: true, creation: true });
  return deepFreeze({
    schemaId: WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_ID,
    payload,
  });
}

/**
 * 重新解析并完整验证一份现有aggregate plan，返回独立冻结快照。
 */
export function validateWakeflowMaintenancePlan(value) {
  const plan = cloneCanonical(value);
  return deepFreeze(validateInternal(plan));
}

/**
 * 只为已经通过计划合同的数据生成稳定摘要。
 */
export function wakeflowMaintenancePlanDigest(value) {
  return canonicalJsonDigest(validateWakeflowMaintenancePlan(value));
}

/**
 * 判断计划是否不存在任何已闭合blocker；这不是apply授权或并发新鲜度证明。
 */
export function isWakeflowMaintenancePlanApplicable(value) {
  return validateWakeflowMaintenancePlan(value).payload.status === "ready";
}
