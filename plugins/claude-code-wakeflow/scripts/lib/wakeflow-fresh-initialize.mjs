import { lstatSync } from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  WAKEFLOW_CONFIG_V3_KIND,
  WAKEFLOW_CONFIG_V3_SCHEMA_ID,
  WAKEFLOW_CONFIG_V3_VERSION,
  buildWakeflowConfigV3Indexes,
  parseWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import {
  planWakeflowConfigV3FreshOwner,
} from "./wakeflow-config-v3-owner.mjs";
import {
  generateWakeflowId,
} from "./wakeflow-identifiers.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "./wakeflow-host-capability.mjs";
import { planWakeflowHostSettingsAssetsOwner } from "./wakeflow-host-settings-assets-owner.mjs";
import { createWakeflowLayoutDescriptor } from "./wakeflow-layout-descriptor.mjs";
import {
  assertWakeflowLocalLayoutInspection,
  inspectWakeflowLocalLayout,
} from "./wakeflow-local-layout-inspection.mjs";
import {
  planWakeflowLocalLayoutRealization,
} from "./wakeflow-local-layout-realization.mjs";
import {
  createWakeflowMaintenancePlan,
  wakeflowMaintenancePlanDigest,
} from "./wakeflow-maintenance-plan.mjs";
import {
  planWakeflowManagedContent,
  projectWakeflowManagedContentMaintenance,
} from "./wakeflow-managed-content.mjs";
import {
  planWakeflowSupportSurfaceOwner,
  projectWakeflowSupportSurfaceMaintenance,
} from "./wakeflow-support-surface-owner.mjs";
import {
  planWakeflowLedgerMaterialization,
  projectWakeflowLedgerMaterializationMaintenance,
} from "./wakeflow-ledger-materialization.mjs";
import {
  planWakeflowActiveFoundation,
  projectWakeflowActiveFoundationMaintenance,
} from "./wakeflow-active-foundation.mjs";
import {
  planWakeflowActiveProjectionMaintenance,
  projectWakeflowActiveProjectionMaintenance,
} from "./wakeflow-active-projector.mjs";
import {
  planWindowRuntimeProjectionMaintenance,
  projectWindowRuntimeProjectionMaintenance,
} from "./wakeflow-window-runtime-projector.mjs";
import { createWakeflowConfirmedActionPlan } from "./wakeflow-maintenance-action-composition.mjs";

/**
 * fresh initialize与migration materialization共用的只读领域编排层。
 *
 * 职责导航：
 * 1. createWakeflowFreshDesiredModel把用户selection分配为稳定typed ID并交给strict config codec验证。
 * 2. inspectWakeflowFreshLocalEligibility证明目标没有会与fresh初始化冲突的本地权威或残留。
 * 3. 各领域owner分别规划config、local、support、ledger、managed、active、window runtime与host assets。
 * 4. aggregatePlan只合并owner投影并闭合transaction offset，不直接写入任何文件。
 * 5. ready计划由action composition绑定owner snapshot；launchIntents仍只是宿主操作意图，不执行建窗。
 * 6. migration入口复用相同目标物化链，但必须携带并冻结独立config owner计划和legacy source authority。
 */

// 一、公共身份、selection词汇与输入合同。
export const WAKEFLOW_FRESH_INITIALIZE_KIND = "WakeflowFreshInitializeBackbonePlan";
export const WAKEFLOW_FRESH_INITIALIZE_SCHEMA_VERSION = 1;

const SELECTION_KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const SAFE_HOST_TOOL_PATTERN = /^[a-z][a-z0-9_-]*(?: [a-z][a-z0-9_-]*){0,3}$/u;
const PROTOCOL_PROVIDED_REFS = new Set([
  ".wakeflow-local",
  ".wakeflow-local/runtime",
  ".wakeflow-local/runtime/maintenance",
  ".wakeflow-local/runtime/maintenance/transactions",
]);
const MISSING_FRESH_OWNERS = Object.freeze([]);

export class WakeflowFreshInitializeError extends Error {
  constructor(code, message, { errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowFreshInitializeError";
    this.code = code;
    this.path = errorPath;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowFreshInitializeError(code, message, { errorPath, details, cause });
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, allowed, required, label, errorPath = "$") {
  if (!isPlainObject(value)) {
    fail("wakeflow-fresh-selection-contract", `${label} must be a plain object`, { errorPath });
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))) {
    fail("wakeflow-fresh-selection-contract", `${label} has an unknown field`, {
      errorPath,
      details: { allowed, actual: keys.map(String) },
    });
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-fresh-selection-contract", `${label}.${key} is required`, {
        errorPath: `${errorPath}/${key}`,
      });
    }
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-fresh-selection-contract", `${label}.${String(key)} must be an enumerable data property`, {
        errorPath: `${errorPath}/${String(key)}`,
      });
    }
  }
  return value;
}

// 完整host profile是可扩展facade；这里只准入当前真正消费的own data property，不擅自闭合其余宿主字段。
function requiredDataProperty(value, key, label, errorPath = "$") {
  if (!isPlainObject(value)) {
    fail("wakeflow-fresh-selection-contract", `${label} must be a plain object`, { errorPath });
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail("wakeflow-fresh-selection-contract", `${label}.${key} must be an enumerable data property`, {
      errorPath: `${errorPath}/${key}`,
    });
  }
  return descriptor.value;
}

function exactFunctionInput(value) {
  exactKeys(value, ["selection", "uuidFactory"], ["selection", "uuidFactory"], "fresh model input");
  if (typeof value.uuidFactory !== "function") {
    fail("wakeflow-fresh-id-source", "uuidFactory must be a function", { errorPath: "$/uuidFactory" });
  }
  return value;
}

function exactBackboneInput(value) {
  exactKeys(
    value,
    ["workspaceRoot", "desiredModel", "hostProfile", "bundle", "language", "hostSettingsAssetsAdapter"],
    ["workspaceRoot", "desiredModel", "hostProfile", "bundle", "language"],
    "fresh backbone input",
  );
  if (typeof value.workspaceRoot !== "string" || !value.workspaceRoot.trim()) {
    fail("wakeflow-fresh-workspace", "workspaceRoot is required", { errorPath: "$/workspaceRoot" });
  }
  return value;
}

function exactMigrationMaterializationInput(value) {
  exactKeys(
    value,
    [
      "workspaceRoot",
      "desiredModel",
      "hostProfile",
      "bundle",
      "language",
      "hostSettingsAssetsAdapter",
      "configOwnerPlan",
      "configSourceAuthority",
    ],
    [
      "workspaceRoot",
      "desiredModel",
      "hostProfile",
      "bundle",
      "language",
      "configOwnerPlan",
      "configSourceAuthority",
    ],
    "migration materialization backbone input",
  );
  if (typeof value.workspaceRoot !== "string" || !value.workspaceRoot.trim()) {
    fail("wakeflow-fresh-workspace", "workspaceRoot is required", { errorPath: "$/workspaceRoot" });
  }
  if (!isPlainObject(value.configOwnerPlan)) {
    fail("wakeflow-fresh-config-owner", "migration configOwnerPlan must be one owner snapshot");
  }
  exactKeys(
    value.configSourceAuthority,
    ["programId", "modelDigest"],
    ["programId", "modelDigest"],
    "migration config source authority",
    "$/configSourceAuthority",
  );
  return value;
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
    fail("wakeflow-fresh-canonical", `${label} must be canonical JSON data`, { cause });
  }
}

// 二、fresh selection与跨类型ID分配。
function selectionKey(value, errorPath) {
  if (typeof value !== "string" || !SELECTION_KEY_PATTERN.test(value)) {
    fail("wakeflow-fresh-selection-key", "selectionKey must be one bounded lowercase token", { errorPath });
  }
  return value;
}

function array(value, label, errorPath, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum) {
    fail("wakeflow-fresh-selection-contract", `${label} must contain at least ${minimum} item(s)`, { errorPath });
  }
  return value;
}

function without(value, omitted) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.includes(key)));
}

function generatedId(type, uuidFactory, seen) {
  let id;
  try {
    id = generateWakeflowId(type, uuidFactory);
  } catch (cause) {
    fail("wakeflow-fresh-id-source", `cannot generate the fresh ${type} ID`, { cause });
  }
  const opaque = id.slice(id.indexOf("_") + 1);
  if (seen.has(opaque)) {
    fail("wakeflow-fresh-id-collision", "fresh preview generated a duplicate UUID collision", {
      details: { type },
    });
  }
  seen.add(opaque);
  return id;
}

function normalizeSelection(selection, uuidFactory) {
  exactKeys(
    selection,
    ["program", "topology", "storage", "governance", "hosts"],
    ["program", "topology", "storage", "governance", "hosts"],
    "fresh selection",
  );
  exactKeys(
    selection.program,
    ["displayName", "description", "interfaceLanguage"],
    ["displayName", "interfaceLanguage"],
    "fresh program selection",
    "$/selection/program",
  );
  exactKeys(
    selection.topology,
    ["repositories", "supportSurfaces", "windows"],
    ["repositories", "supportSurfaces", "windows"],
    "fresh topology selection",
    "$/selection/topology",
  );
  exactKeys(selection.storage, ["ledgerRoot"], ["ledgerRoot"], "fresh storage selection", "$/selection/storage");
  if (!isPlainObject(selection.governance) || !isPlainObject(selection.hosts)) {
    fail("wakeflow-fresh-selection-contract", "governance and hosts must be plain objects");
  }

  const seenRawIds = new Set();
  const seenSelectionKeys = new Set();
  const programId = generatedId("program", uuidFactory, seenRawIds);
  const repositoryByKey = new Map();
  const repositories = array(
    selection.topology.repositories,
    "fresh repositories",
    "$/selection/topology/repositories",
    1,
  ).map((entry, index) => {
    const at = `$/selection/topology/repositories/${index}`;
    exactKeys(
      entry,
      ["selectionKey", "path", "displayName", "description", "instructionManagement", "validation"],
      ["selectionKey", "path", "displayName", "instructionManagement"],
      "fresh repository selection",
      at,
    );
    const key = selectionKey(entry.selectionKey, `${at}/selectionKey`);
    if (seenSelectionKeys.has(key)) {
      fail("wakeflow-fresh-selection-key", "fresh selection keys must be globally unique", {
        errorPath: `${at}/selectionKey`,
      });
    }
    seenSelectionKeys.add(key);
    const repositoryId = generatedId("repository", uuidFactory, seenRawIds);
    repositoryByKey.set(key, repositoryId);
    return { repositoryId, ...without(entry, ["selectionKey"]) };
  });

  const surfaceByKey = new Map();
  const supportSurfaces = array(
    selection.topology.supportSurfaces,
    "fresh support surfaces",
    "$/selection/topology/supportSurfaces",
    2,
  ).map((entry, index) => {
    const at = `$/selection/topology/supportSurfaces/${index}`;
    exactKeys(
      entry,
      ["selectionKey", "capability", "path", "displayName", "description", "ownership", "instructionManagement"],
      ["selectionKey", "capability", "path", "displayName", "ownership"],
      "fresh support-surface selection",
      at,
    );
    const key = selectionKey(entry.selectionKey, `${at}/selectionKey`);
    if (seenSelectionKeys.has(key)) {
      fail("wakeflow-fresh-selection-key", "fresh selection keys must be globally unique", {
        errorPath: `${at}/selectionKey`,
      });
    }
    seenSelectionKeys.add(key);
    const surfaceId = generatedId("surface", uuidFactory, seenRawIds);
    surfaceByKey.set(key, surfaceId);
    return { surfaceId, ...without(entry, ["selectionKey"]) };
  });

  const windows = array(
    selection.topology.windows,
    "fresh windows",
    "$/selection/topology/windows",
    4,
  ).map((entry, index) => {
    const at = `$/selection/topology/windows/${index}`;
    exactKeys(
      entry,
      ["role", "displayName", "description", "root"],
      ["role", "displayName", "root"],
      "fresh window selection",
      at,
    );
    const windowId = generatedId("window", uuidFactory, seenRawIds);
    const rootAt = `${at}/root`;
    if (entry.role === "controller") {
      exactKeys(entry.root, ["kind"], ["kind"], "controller root selection", rootAt);
      return { windowId, ...without(entry, ["root"]), root: { kind: entry.root.kind } };
    }
    exactKeys(entry.root, ["kind", "selectionKey"], ["kind", "selectionKey"], "window root selection", rootAt);
    const key = selectionKey(entry.root.selectionKey, `${rootAt}/selectionKey`);
    if (entry.root.kind === "repository") {
      const repositoryId = repositoryByKey.get(key);
      if (!repositoryId) {
        fail("wakeflow-fresh-selection-reference", "product window references an unknown repository selection", {
          errorPath: `${rootAt}/selectionKey`,
        });
      }
      return { windowId, ...without(entry, ["root"]), root: { kind: "repository", repositoryId } };
    }
    if (entry.root.kind === "support-surface") {
      const surfaceId = surfaceByKey.get(key);
      if (!surfaceId) {
        fail("wakeflow-fresh-selection-reference", "support window references an unknown surface selection", {
          errorPath: `${rootAt}/selectionKey`,
        });
      }
      return { windowId, ...without(entry, ["root"]), root: { kind: "support-surface", surfaceId } };
    }
    fail("wakeflow-fresh-selection-reference", "window root kind is invalid", { errorPath: `${rootAt}/kind` });
  });

  const candidate = {
    $schema: WAKEFLOW_CONFIG_V3_SCHEMA_ID,
    kind: WAKEFLOW_CONFIG_V3_KIND,
    schemaVersion: WAKEFLOW_CONFIG_V3_VERSION,
    program: { programId, ...selection.program },
    topology: { repositories, supportSurfaces, windows },
    storage: selection.storage,
    governance: selection.governance,
    hosts: selection.hosts,
  };
  try {
    return parseWakeflowConfigV3(candidate);
  } catch (cause) {
    fail("wakeflow-fresh-selection-invalid", `fresh selection does not form a strict v3 model: ${cause.message}`, {
      cause,
    });
  }
}

/**
 * 把闭合selection转换为strict v3 desired model；本方法只分配身份，不检查或创建workspace。
 */
export function createWakeflowFreshDesiredModel(value) {
  const input = exactFunctionInput(value);
  const selection = canonicalSnapshot(input.selection, "fresh selection");
  return normalizeSelection(selection, input.uuidFactory);
}

// 三、fresh本地准入；只消费layout inspector事实，不把缺失或存在本身解释成业务完成状态。
function freshLocalBlocker(code, value) {
  const ref = typeof value?.path === "string"
    ? value.path
    : typeof value?.ref === "string"
      ? value.ref
      : null;
  return {
    code,
    ref,
    evidenceDigest: canonicalJsonDigest(value),
  };
}

/**
 * 判断当前local layout是否仍符合fresh前置条件，并返回可公开、可去重的阻断证据摘要。
 */
export function inspectWakeflowFreshLocalEligibility(value) {
  exactKeys(value, ["inspection"], ["inspection"], "fresh local eligibility input");
  const inspection = assertWakeflowLocalLayoutInspection(value.inspection);
  const blockers = [];
  if (
    !["absent", "bootstrap-prefix", "idle"].includes(inspection.mutation.state)
    || inspection.mutation.lockPresent
    || inspection.mutation.operationCount !== 0
  ) {
    blockers.push(freshLocalBlocker("fresh-local-mutation-residue", inspection.mutation));
  }
  for (const blocker of inspection.blockers) {
    blockers.push(freshLocalBlocker("fresh-local-authority-blocker", blocker));
  }
  for (const item of inspection.items.staticDirectories) {
    const allowed = PROTOCOL_PROVIDED_REFS.has(item.path)
      ? ["missing", "current"].includes(item.classification)
      : item.classification === "missing";
    if (!allowed) blockers.push(freshLocalBlocker("fresh-local-static-footprint", item));
  }
  for (const item of inspection.items.managedFiles) {
    if (item.classification !== "delegated-missing") {
      blockers.push(freshLocalBlocker("fresh-local-managed-footprint", item));
    }
  }
  for (const item of inspection.items.initialProjections) {
    if (item.classification !== "delegated-missing") {
      blockers.push(freshLocalBlocker("fresh-local-projection-footprint", item));
    }
  }
  for (const item of inspection.items.events) {
    if (item.classification !== "deferred") {
      blockers.push(freshLocalBlocker("fresh-local-event-footprint", item));
    }
  }
  for (const item of inspection.items.boundaries) {
    blockers.push(freshLocalBlocker("fresh-local-unknown-boundary", item));
  }
  const unique = [...new Map(blockers.map((entry) => [canonicalJson(entry), entry])).values()]
    .sort((left, right) => lexicalCompare(canonicalJson(left), canonicalJson(right)));
  return deepFreeze({
    kind: "WakeflowFreshLocalEligibility",
    schemaVersion: 1,
    inspectionDigest: inspection.inspectionDigest,
    eligible: unique.length === 0,
    blockers: unique,
  });
}

function topologyDiff(model) {
  return [
    ...model.topology.repositories.map((entry) => ({
      entityType: "repository",
      entityId: entry.repositoryId,
      change: "added",
      sourceDigest: null,
      targetDigest: canonicalJsonDigest(entry),
      sourcePlacement: null,
      targetPlacement: entry.path,
    })),
    ...model.topology.supportSurfaces.map((entry) => ({
      entityType: "surface",
      entityId: entry.surfaceId,
      change: "added",
      sourceDigest: null,
      targetDigest: canonicalJsonDigest(entry),
      sourcePlacement: null,
      targetPlacement: entry.path,
    })),
    ...model.topology.windows.map((entry) => ({
      entityType: "window",
      entityId: entry.windowId,
      change: "added",
      sourceDigest: null,
      targetDigest: canonicalJsonDigest(entry),
      sourcePlacement: null,
      targetPlacement: null,
    })),
  ];
}

function rootDescriptorForWindow(window, indexes, programId) {
  if (window.root.kind === "program") {
    return { kind: "program", rootId: programId, configuredPath: "." };
  }
  if (window.root.kind === "repository") {
    const repository = indexes.repositoryById[window.root.repositoryId];
    return {
      kind: "repository",
      rootId: repository.repositoryId,
      configuredPath: repository.path,
    };
  }
  const surface = indexes.surfaceById[window.root.surfaceId];
  return {
    kind: "support-surface",
    rootId: surface.surfaceId,
    configuredPath: surface.path,
  };
}

// 将配置窗口编译为宿主中立的建窗与后续注册意图；authorityEligible=false禁止把preview当成host授权。
function launchIntents(model, hostProfile, normalizedHost) {
  const hostTools = requiredDataProperty(hostProfile, "hostTools", "host profile");
  const createTool = requiredDataProperty(hostTools, "createWindow", "host profile hostTools", "$/hostTools");
  if (typeof createTool !== "string" || !SAFE_HOST_TOOL_PATTERN.test(createTool)) {
    fail("wakeflow-fresh-host-profile", "host profile lacks one safe create-window tool intent");
  }
  const indexes = buildWakeflowConfigV3Indexes(model);
  const profileDigest = canonicalJsonDigest(normalizedHost);
  return [...model.topology.windows]
    .sort((left, right) => lexicalCompare(left.windowId, right.windowId))
    .map((window) => ({
      windowId: window.windowId,
      role: window.role,
      displayTitle: window.displayName,
      root: rootDescriptorForWindow(window, indexes, model.program.programId),
      host: {
        hostId: normalizedHost.hostId,
        profileDigest,
      },
      create: {
        effect: "create-window",
        hostTool: createTool,
        requiresHostOperation: true,
        authorityEligible: false,
      },
      registration: {
        operation: "register-window-binding",
        windowId: window.windowId,
        hostId: normalizedHost.hostId,
        handleSource: "host-create-result",
        authorityEligible: false,
      },
    }));
}

function missingOwners(normalizedHost, hostSettingsStatus) {
  const owners = [...MISSING_FRESH_OWNERS];
  if (
    (
      normalizedHost.capabilities.settings.applicable
      || normalizedHost.capabilities.assets.applicable
    )
    && hostSettingsStatus === "missing"
  ) {
    owners.push({ componentId: "host-settings-assets", owner: "host-settings-assets-owner" });
  }
  return owners.sort((left, right) => lexicalCompare(left.componentId, right.componentId));
}

// 四、无法进入owner规划链时使用的稳定、脱敏公开描述，不携带绝对路径或任意底层异常。
function missingDescriptor(component) {
  return {
    kind: "WakeflowFreshOwnerUnavailable",
    schemaVersion: 1,
    componentId: component.componentId,
    owner: component.owner,
    reasonCode: "fresh-owner-not-implemented",
  };
}

function managedSourceUnavailableDescriptor(component) {
  return {
    kind: "WakeflowFreshManagedContentSourceUnavailable",
    schemaVersion: 1,
    componentId: component.componentId,
    owner: component.owner,
    reasonCode: "fresh-managed-content-source-unavailable",
  };
}

function ownerSourceUnavailableDescriptor(component) {
  return {
    kind: "WakeflowFreshOwnerSourceUnavailable",
    schemaVersion: 1,
    componentId: component.componentId,
    owner: component.owner,
    reasonCode: "fresh-source-ineligible",
  };
}

function inspectFreshActiveFootprint(workspaceRoot) {
  const ref = ".wakeflow-active";
  const candidate = path.join(path.resolve(workspaceRoot), ref);
  let classification = "absent";
  try {
    const stat = lstatSync(candidate);
    classification = stat.isSymbolicLink() ? "unsafe" : "present";
  } catch (cause) {
    if (cause?.code !== "ENOENT") classification = "unsafe";
  }
  const evidence = { kind: "WakeflowFreshActiveFootprint", schemaVersion: 1, ref, classification };
  return deepFreeze({
    eligible: classification === "absent",
    classification,
    evidenceDigest: canonicalJsonDigest(evidence),
  });
}

function stripRef(resource) {
  return Object.fromEntries(Object.entries(resource).filter(([key]) => key !== "ref"));
}

function resourcePrefix(programId) {
  return `targets/program/${programId}`;
}

/**
 * 合并已经由各领域owner验证的projection，并让maintenance-plan codec再次校验全图闭合。
 * 本方法只组合计划，不替代owner证据判断，也不持有事务gate。
 */
function aggregatePlan({
  model,
  descriptor,
  normalizedHost,
  configPlan,
  localPlan,
  supportProjection,
  ledgerProjection,
  managedProjection,
  activeFoundationProjection,
  activeProjection,
  windowRuntimeProjection,
  hostSettingsProjection,
  missing,
  aggregateAction,
  configSourceAuthority,
}) {
  const programId = model.program.programId;
  const prefix = resourcePrefix(programId);
  const [configOwnerStep] = configPlan.payload.steps;
  const configCreating = configOwnerStep.source.type === "absent";
  const configAction = {
    actionId: configOwnerStep.stepId,
    componentId: "config",
    owner: "config-writer",
    root: { kind: "program", rootId: programId, basis: "target", configuredPath: "." },
    ref: "wakeflow.config.json",
    resourceRef: `${prefix}/wakeflow.config.json`,
    classification: configCreating ? "managed-missing" : "legacy-generated-exact",
    source: stripRef(configOwnerStep.source),
    target: stripRef(configOwnerStep.final),
    action: configCreating ? "create-managed" : "update-managed",
    authorization: { kind: "wakeflow-owned" },
    reasonCode: configCreating ? "fresh-config" : "migration-config-schema-map",
    stepId: configOwnerStep.stepId,
    commitOrder: 0,
  };
  const localActions = localPlan.payload.steps.map((step, index) => ({
    actionId: step.stepId,
    componentId: "local-layout",
    owner: "layout-manager",
    root: { kind: "program", rootId: programId, basis: "target", configuredPath: "." },
    ref: step.final.ref,
    resourceRef: `${prefix}/${step.final.ref}`,
    classification: "managed-missing",
    source: stripRef(step.source),
    target: stripRef(step.final),
    action: "create-managed",
    authorization: { kind: "wakeflow-owned" },
    reasonCode: "fresh-local-static",
    stepId: step.stepId,
    commitOrder: index + 1,
  }));
  const steps = [
    {
      ...configOwnerStep,
      source: { ...configOwnerStep.source, ref: `${prefix}/${configOwnerStep.source.ref}` },
      staging: configOwnerStep.staging === null
        ? null
        : { ...configOwnerStep.staging, ref: `${prefix}/${configOwnerStep.staging.ref}` },
      final: { ...configOwnerStep.final, ref: `${prefix}/${configOwnerStep.final.ref}` },
    },
    ...localPlan.payload.steps.map((step, index) => ({
      ...step,
      ordinal: index + 1,
      source: { ...step.source, ref: `${prefix}/${step.source.ref}` },
      final: { ...step.final, ref: `${prefix}/${step.final.ref}` },
    })),
  ];
  const components = [
    {
      componentId: "config",
      owner: "config-writer",
      ownerPlanDigest: canonicalJsonDigest(configPlan),
    },
    {
      componentId: "local-layout",
      owner: "layout-manager",
      ownerPlanDigest: canonicalJsonDigest(localPlan),
    },
    ...supportProjection.components,
    ...ledgerProjection.components,
    ...managedProjection.components,
    ...activeFoundationProjection.components,
    ...activeProjection.components,
    ...windowRuntimeProjection.components,
    ...(hostSettingsProjection?.components ?? []),
    ...missing.map((component) => ({
      componentId: component.componentId,
      owner: component.owner,
      ownerPlanDigest: canonicalJsonDigest(missingDescriptor(component)),
    })),
  ];
  const missingDependencyChecks = missing.map((component) => ({
    checkId: `fresh-owner-${component.componentId}`,
    componentId: component.componentId,
    owner: component.owner,
    subject: { kind: "program", value: programId },
    status: "blocked",
    code: "fresh-owner-not-implemented",
    evidence: [],
  }));
  const missingBlockers = missing.map((component) => ({
    blockerId: `fresh-owner-${component.componentId}`,
    componentId: component.componentId,
    owner: component.owner,
    subject: { kind: "program", value: programId },
    code: "fresh-owner-not-implemented",
    dependencyCheckId: `fresh-owner-${component.componentId}`,
  }));
  const missingDeferredOwnerActions = missing.map((component) => ({
    deferredId: `fresh-owner-${component.componentId}`,
    componentId: component.componentId,
    owner: component.owner,
    action: "materialize-fresh-component",
    subject: { kind: "program", value: programId },
    prerequisiteCheckIds: [`fresh-owner-${component.componentId}`],
    reasonCode: "fresh-owner-not-implemented",
  }));
  return createWakeflowMaintenancePlan({
    action: aggregateAction,
    programId,
    host: {
      hostId: normalizedHost.hostId,
      profileDigest: canonicalJsonDigest(normalizedHost),
    },
    config: {
      disposition: configCreating ? "create" : "update",
      source: stripRef(configOwnerStep.source),
      sourceAuthority: configCreating ? null : configSourceAuthority,
      desiredModel: model,
    },
    layoutDigest: descriptor.layoutDigest,
    topologyDiff: topologyDiff(model),
    components,
    filesystemActions: [
      configAction,
      ...localActions,
      ...supportProjection.filesystemActions,
      ...ledgerProjection.filesystemActions,
      ...managedProjection.filesystemActions,
      ...activeFoundationProjection.filesystemActions,
      ...activeProjection.filesystemActions,
      ...windowRuntimeProjection.filesystemActions,
      ...(hostSettingsProjection?.filesystemActions ?? []),
    ],
    dependencyChecks: [
      ...missingDependencyChecks,
      ...supportProjection.dependencyChecks,
      ...ledgerProjection.dependencyChecks,
      ...managedProjection.dependencyChecks,
      ...activeFoundationProjection.dependencyChecks,
      ...activeProjection.dependencyChecks,
      ...windowRuntimeProjection.dependencyChecks,
      ...(hostSettingsProjection?.dependencyChecks ?? []),
    ],
    preserved: [
      ...supportProjection.preserved,
      ...ledgerProjection.preserved,
      ...managedProjection.preserved,
      ...activeFoundationProjection.preserved,
      ...activeProjection.preserved,
      ...windowRuntimeProjection.preserved,
      ...(hostSettingsProjection?.preserved ?? []),
    ],
    deferredOwnerActions: [
      ...missingDeferredOwnerActions,
      ...supportProjection.deferredOwnerActions,
      ...ledgerProjection.deferredOwnerActions,
      ...managedProjection.deferredOwnerActions,
      ...activeFoundationProjection.deferredOwnerActions,
      ...activeProjection.deferredOwnerActions,
      ...windowRuntimeProjection.deferredOwnerActions,
      ...(hostSettingsProjection?.deferredOwnerActions ?? []),
    ],
    blockers: [
      ...missingBlockers,
      ...supportProjection.blockers,
      ...ledgerProjection.blockers,
      ...managedProjection.blockers,
      ...activeFoundationProjection.blockers,
      ...activeProjection.blockers,
      ...windowRuntimeProjection.blockers,
      ...(hostSettingsProjection?.blockers ?? []),
    ],
    steps: [
      ...steps,
      ...supportProjection.steps,
      ...ledgerProjection.steps,
      ...managedProjection.steps,
      ...activeFoundationProjection.steps,
      ...activeProjection.steps,
      ...windowRuntimeProjection.steps,
      ...(hostSettingsProjection?.steps ?? []),
    ],
  });
}

function publicBlocker(componentId, owner, code, source) {
  return {
    componentId,
    owner,
    code,
    subject: { kind: "program", value: source.programId },
  };
}

/**
 * 编排fresh目标的完整owner计划，构造公开preview与可选confirmed action plan。
 * 所有filesystem与host effect均留给后续apply/宿主操作阶段，本方法保证自身零写入。
 */
function planWakeflowFreshInitializeBackboneInternal(input, {
  configOwnerPlan = null,
  aggregateAction = "fresh-initialize",
  configSourceAuthority = null,
} = {}) {
  const model = parseWakeflowConfigV3(input.desiredModel);
  const normalizedHost = normalizeWakeflowHostCapabilityProfile(input.hostProfile);
  const descriptor = createWakeflowLayoutDescriptor({ model, hostProfile: input.hostProfile });
  const configPlan = configOwnerPlan ?? planWakeflowConfigV3FreshOwner({
    workspaceRoot: input.workspaceRoot,
    model,
  });
  const configPlanStatus = configPlan?.payload?.status;
  const expectedConfigStepCount = configPlanStatus === "ready"
    ? 1
    : configPlanStatus === "blocked" ? 0 : null;
  if (
    !isPlainObject(configPlan?.payload)
    || expectedConfigStepCount === null
    || !Array.isArray(configPlan.payload.steps)
    || configPlan.payload.steps.length !== expectedConfigStepCount
    || !isPlainObject(configPlan.payload.desiredModel)
    || canonicalJson(configPlan.payload.desiredModel) !== canonicalJson(model)
  ) {
    fail("wakeflow-fresh-config-owner", "config owner plan is not one exact materialization source");
  }
  const localInspection = inspectWakeflowLocalLayout({
    workspaceRoot: input.workspaceRoot,
    model,
    layoutDescriptor: descriptor,
    hostProfile: input.hostProfile,
  });
  const localEligibility = inspectWakeflowFreshLocalEligibility({ inspection: localInspection });
  const localPlan = planWakeflowLocalLayoutRealization({
    workspaceRoot: input.workspaceRoot,
    action: "fresh-initialize",
    model,
    layoutDescriptor: descriptor,
    hostProfile: input.hostProfile,
  });
  const activeFootprint = inspectFreshActiveFootprint(input.workspaceRoot);
  const baseSourceReady = configPlan.payload.status === "ready"
    && localEligibility.eligible
    && localPlan.payload.blockers.length === 0
    && activeFootprint.eligible;
  const activeFoundationPlan = baseSourceReady
    ? planWakeflowActiveFoundation({
        workspaceRoot: input.workspaceRoot,
        action: "fresh-initialize",
        sourceModel: null,
        desiredModel: model,
      })
    : null;
  const sourceReady = baseSourceReady && activeFoundationPlan.payload.status === "ready";
  const supportPlan = sourceReady
    ? planWakeflowSupportSurfaceOwner({
        workspaceRoot: input.workspaceRoot,
        action: "fresh-initialize",
        sourceModel: null,
        desiredModel: model,
        layoutDescriptor: descriptor,
        hostProfile: input.hostProfile,
      })
    : null;
  const supportProjection = supportPlan === null
    ? null
    : projectWakeflowSupportSurfaceMaintenance({
        plan: supportPlan,
        transactionOffset: configPlan.payload.steps.length + localPlan.payload.steps.length,
      });
  const ledgerPlan = sourceReady
    ? planWakeflowLedgerMaterialization({
        workspaceRoot: input.workspaceRoot,
        action: "fresh-initialize",
        sourceModel: null,
        desiredModel: model,
      })
    : null;
  const ledgerProjection = ledgerPlan === null
    ? null
    : projectWakeflowLedgerMaterializationMaintenance({
        plan: ledgerPlan,
        transactionOffset: configPlan.payload.steps.length
          + localPlan.payload.steps.length
          + supportPlan.payload.steps.length,
      });
  const managedPlan = sourceReady
    ? planWakeflowManagedContent({
        workspaceRoot: input.workspaceRoot,
        action: "fresh-initialize",
        sourceModel: null,
        desiredModel: model,
        hostProfile: input.hostProfile,
        authorizedRepositoryIds: [],
        plannedSupportSurfaceIds: supportPlan.payload.plannedSupportSurfaceIds,
      })
    : null;
  const managedProjection = managedPlan === null
    ? null
    : projectWakeflowManagedContentMaintenance({
        plan: managedPlan,
        transactionOffset: configPlan.payload.steps.length
          + localPlan.payload.steps.length
          + supportPlan.payload.steps.length
          + ledgerPlan.payload.steps.length,
      });
  const activeFoundationOffset = sourceReady
    ? configPlan.payload.steps.length
      + localPlan.payload.steps.length
      + supportPlan.payload.steps.length
      + ledgerPlan.payload.steps.length
      + managedPlan.payload.steps.length
    : null;
  const activeFoundationProjection = sourceReady
    ? projectWakeflowActiveFoundationMaintenance({
        plan: activeFoundationPlan,
        transactionOffset: activeFoundationOffset,
      })
    : null;
  const activeProjectionPlan = sourceReady
    ? planWakeflowActiveProjectionMaintenance({
        workspaceRoot: input.workspaceRoot,
        action: "fresh-initialize",
        sourceModel: null,
        desiredModel: model,
        bundle: input.bundle,
        language: input.language,
      })
    : null;
  const activeProjection = sourceReady
    ? projectWakeflowActiveProjectionMaintenance({
        plan: activeProjectionPlan,
        transactionOffset: activeFoundationOffset + activeFoundationPlan.payload.steps.length,
      })
    : null;
  const windowRuntimePlan = sourceReady
    ? planWindowRuntimeProjectionMaintenance({
        workspaceRoot: input.workspaceRoot,
        action: "fresh-initialize",
        sourceModel: null,
        desiredModel: model,
        hostProfile: input.hostProfile,
      })
    : null;
  const windowRuntimeProjection = sourceReady
    ? projectWindowRuntimeProjectionMaintenance({
        plan: windowRuntimePlan,
        transactionOffset: activeFoundationOffset
          + activeFoundationPlan.payload.steps.length
          + activeProjectionPlan.payload.steps.length,
      })
    : null;
  const hostSettingsOwner = sourceReady
    ? planWakeflowHostSettingsAssetsOwner({
        workspaceRoot: path.resolve(input.workspaceRoot),
        action: "fresh-initialize",
        sourceModel: null,
        desiredModel: model,
        hostProfile: input.hostProfile,
        authorizedRepositoryIds: [],
        localPlan,
        supportPlan,
        managedPlan,
        adapter: input.hostSettingsAssetsAdapter ?? null,
        transactionOffset: activeFoundationOffset
          + activeFoundationPlan.payload.steps.length
          + activeProjectionPlan.payload.steps.length
          + windowRuntimePlan.payload.steps.length,
      })
    : null;
  const hostSettingsPlan = hostSettingsOwner?.plan ?? null;
  const hostSettingsProjection = hostSettingsOwner?.projection ?? null;
  const missing = missingOwners(normalizedHost, hostSettingsOwner?.status ?? "missing");
  const managedComponents = [
    { componentId: "ignore", owner: "ignore-manager" },
    { componentId: "managed-memory", owner: "instruction-renderer" },
  ];
  const managedOwnerAvailability = (owner) => (
    managedPlan?.payload.operations.some((entry) => entry.owner === owner && entry.action === "blocked")
      ? "blocked"
      : managedPlan === null ? "blocked" : "available"
  );
  const foundationComponents = [
    { componentId: "support-surface", owner: "support-materializer", plan: supportPlan },
    { componentId: "ledger-layout", owner: "ledger-service", plan: ledgerPlan },
    { componentId: "ledger-projection", owner: "ledger-projector", plan: ledgerPlan },
    { componentId: "active-layout", owner: "layout-manager", plan: activeFoundationPlan },
    { componentId: "todo-authority", owner: "todo-service", plan: activeFoundationPlan },
    { componentId: "active-projection", owner: "active-projector", plan: activeProjectionPlan },
    {
      componentId: "window-runtime-projection",
      owner: "runtime-projection-builder",
      plan: windowRuntimePlan,
    },
  ];
  const foundationOwnerGraph = foundationComponents.map((component) => ({
    componentId: component.componentId,
    owner: component.owner,
    availability: component.plan === null
      ? "blocked"
      : component.plan.payload.blockers.length > 0 ? "blocked" : "available",
    ownerPlanDigest: canonicalJsonDigest(
      component.plan ?? ownerSourceUnavailableDescriptor(component),
    ),
  }));
  const ownerGraph = [
    {
      componentId: "config",
      owner: "config-writer",
      availability: configPlan.payload.status === "ready" ? "available" : "blocked",
      ownerPlanDigest: canonicalJsonDigest(configPlan),
    },
    {
      componentId: "local-layout",
      owner: "layout-manager",
      availability: localEligibility.eligible && localPlan.payload.blockers.length === 0
        ? "available"
        : "blocked",
      ownerPlanDigest: canonicalJsonDigest(localPlan),
    },
    ...foundationOwnerGraph,
    ...(managedProjection?.components ?? managedComponents.map((component) => ({
      ...component,
      ownerPlanDigest: canonicalJsonDigest(managedSourceUnavailableDescriptor(component)),
    }))).map((component) => ({
      ...component,
      availability: managedOwnerAvailability(component.owner),
    })),
    ...(hostSettingsPlan === null ? [] : [{
      componentId: "host-settings-assets",
      owner: "host-settings-assets-owner",
      availability: hostSettingsPlan.payload.status === "ready" ? "available" : "blocked",
      ownerPlanDigest: canonicalJsonDigest(hostSettingsPlan),
    }]),
    ...missing.map((component) => ({
      ...component,
      availability: "missing",
      ownerPlanDigest: canonicalJsonDigest(missingDescriptor(component)),
    })),
  ].sort((left, right) => lexicalCompare(left.componentId, right.componentId));
  const aggregate = sourceReady
    ? aggregatePlan({
        model,
        descriptor,
        normalizedHost,
        configPlan,
        localPlan,
        supportProjection,
        ledgerProjection,
        managedProjection,
        activeFoundationProjection,
        activeProjection,
        windowRuntimeProjection,
        hostSettingsProjection,
        missing,
        aggregateAction,
        configSourceAuthority,
      })
    : null;
  const sourceBlockers = [
    ...configPlan.payload.blockers.map((entry) => publicBlocker(
      "config",
      "config-writer",
      entry.code,
      { programId: model.program.programId },
    )),
    ...localEligibility.blockers.map((entry) => publicBlocker(
      "local-layout",
      "layout-manager",
      entry.code,
      { programId: model.program.programId },
    )),
    ...localPlan.payload.blockers.map(() => publicBlocker(
      "local-layout",
      "layout-manager",
      "fresh-local-owner-blocked",
      { programId: model.program.programId },
    )),
    ...(!activeFootprint.eligible ? [publicBlocker(
      "active-projection",
      "active-projector",
      "fresh-active-footprint-present",
      { programId: model.program.programId },
    )] : []),
  ];
  const blockers = sourceReady
    ? aggregate.payload.blockers.map((entry) => ({
        componentId: entry.componentId,
        owner: entry.owner,
        code: entry.code,
        subject: entry.subject,
      }))
    : sourceBlockers;
  const confirmedActionPlan = aggregate?.payload.status === "ready"
    ? createWakeflowConfirmedActionPlan({
        aggregatePlan: aggregate,
        ownerSnapshots: [
          { componentId: "config", owner: "config-writer", snapshot: configPlan },
          { componentId: "local-layout", owner: "layout-manager", snapshot: localPlan },
          { componentId: "support-surface", owner: "support-materializer", snapshot: supportPlan },
          { componentId: "ledger-layout", owner: "ledger-service", snapshot: ledgerPlan },
          { componentId: "ledger-projection", owner: "ledger-projector", snapshot: ledgerPlan },
          { componentId: "ignore", owner: "ignore-manager", snapshot: managedPlan },
          { componentId: "managed-memory", owner: "instruction-renderer", snapshot: managedPlan },
          { componentId: "active-layout", owner: "layout-manager", snapshot: activeFoundationPlan },
          { componentId: "todo-authority", owner: "todo-service", snapshot: activeFoundationPlan },
          { componentId: "active-projection", owner: "active-projector", snapshot: activeProjectionPlan },
          {
            componentId: "window-runtime-projection",
            owner: "runtime-projection-builder",
            snapshot: windowRuntimePlan,
          },
          ...(hostSettingsPlan === null ? [] : [{
            componentId: "host-settings-assets",
            owner: "host-settings-assets-owner",
            snapshot: hostSettingsPlan,
          }]),
        ],
      })
    : null;
  const result = {
    kind: WAKEFLOW_FRESH_INITIALIZE_KIND,
    schemaVersion: WAKEFLOW_FRESH_INITIALIZE_SCHEMA_VERSION,
    action: aggregateAction,
    status: aggregate?.payload.status ?? "blocked",
    hostEffectsAllowed: false,
    programId: model.program.programId,
    configDigest: wakeflowConfigV3Digest(model),
    host: {
      hostId: normalizedHost.hostId,
      profileDigest: canonicalJsonDigest(normalizedHost),
    },
    sourceEligibility: {
      config: {
        status: configPlan.payload.status,
        sourceClassification: configPlan.payload.sourceClassification,
        ownerPlanDigest: canonicalJsonDigest(configPlan),
      },
      local: {
        eligible: localEligibility.eligible,
        inspectionDigest: localEligibility.inspectionDigest,
        ownerPlanDigest: canonicalJsonDigest(localPlan),
      },
      active: activeFootprint,
    },
    ownerGraph,
    blockers,
    aggregatePlan: aggregate,
    aggregatePlanDigest: aggregate === null ? null : wakeflowMaintenancePlanDigest(aggregate),
    confirmedActionPlan,
    launchIntents: launchIntents(model, input.hostProfile, normalizedHost),
  };
  const snapshot = canonicalSnapshot(result, "fresh initialize backbone plan");
  if (canonicalJson(snapshot).includes(path.resolve(input.workspaceRoot))) {
    fail("wakeflow-fresh-private-data", "fresh initialize plan leaked its absolute workspace root");
  }
  return deepFreeze(snapshot);
}

// 五、公共fresh入口与显式migration物化接缝。
/**
 * 为没有现存v3权威的目标workspace规划一次fresh初始化。
 */
export function planWakeflowFreshInitializeBackbone(value) {
  return planWakeflowFreshInitializeBackboneInternal(exactBackboneInput(value));
}

/**
 * 为已由migration owner证明的legacy来源规划v3目标物化；先冻结owner snapshot再进入共享编排链。
 */
export function planWakeflowMigrationMaterializationBackbone(value) {
  const admitted = exactMigrationMaterializationInput(value);
  const input = {
    ...admitted,
    configOwnerPlan: canonicalSnapshot(admitted.configOwnerPlan, "migration config owner plan"),
  };
  const model = parseWakeflowConfigV3(input.desiredModel);
  if (
    input.configSourceAuthority.programId !== model.program.programId
    || typeof input.configSourceAuthority.modelDigest !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(input.configSourceAuthority.modelDigest)
  ) {
    fail(
      "wakeflow-fresh-config-owner",
      "migration config source authority must bind the target program and one opaque legacy digest",
    );
  }
  return planWakeflowFreshInitializeBackboneInternal(input, {
    configOwnerPlan: input.configOwnerPlan,
    aggregateAction: "reconfigure",
    configSourceAuthority: input.configSourceAuthority,
  });
}
