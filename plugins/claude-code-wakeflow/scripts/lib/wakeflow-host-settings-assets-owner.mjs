import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
} from "./wakeflow-config-v3.mjs";
import {
  normalizeWakeflowHostCapabilityProfile,
} from "./wakeflow-host-capability.mjs";

/**
 * settings/assets 共享编排 owner。
 *
 * 职责导航：
 * 1. 根据宿主 capability 判断 settings/assets 是否适用。
 * 2. 从当前插件产物装载一个冻结、精确、宿主中立的 adapter。
 * 3. 把 local、support surface 和 managed-content 的前置计划投影为宿主输入。
 * 4. 验证宿主计划的公共元数据，再投影为统一 maintenance action。
 * 5. 为已确认计划创建宿主 mutation participant，但不实现任何 Claude 私有写入。
 *
 * 本文件不拥有 workspace 配置，不推断 Codex/Claude 分支，也不缓存当前 workspace 权限。
 */

// 一、公开身份与通用数据合同。
export const WAKEFLOW_HOST_SETTINGS_ASSETS_COMPONENT_ID = "host-settings-assets";
export const WAKEFLOW_HOST_SETTINGS_ASSETS_OWNER = "host-settings-assets-owner";

const ACTIONS = new Set(["fresh-initialize", "reconfigure", "reconcile"]);
const PHYSICAL_ACTIONS = new Set(["create-managed", "update-managed"]);
const ROOT_KINDS = new Set(["program", "repository", "support-surface"]);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;

export class WakeflowHostSettingsAssetsOwnerError extends Error {
  constructor(code, message, { cause, details = {} } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowHostSettingsAssetsOwnerError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { cause, details = {} } = {}) {
  throw new WakeflowHostSettingsAssetsOwnerError(code, message, { cause, details });
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 精确字段检查同时拒绝 symbol、不可枚举属性和 accessor，避免读取时触发隐藏行为。
function exactKeys(
  value,
  expected,
  label,
  code = "wakeflow-host-settings-owner-contract",
) {
  if (!plainObject(value)) fail(code, `${label} must be one plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail(code, `${label} has an invalid field set`, {
      details: { expected, actual: actual.map(String) },
    });
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${label}.${key} must be an enumerable data property`);
    }
  }
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
    fail("wakeflow-host-settings-owner-canonical", `${label} must be canonical JSON data`, { cause });
  }
}

function portableRef(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value.includes("\\")
    || path.posix.isAbsolute(value)
    || value === "."
    || value === ".."
    || value.startsWith("../")
    || path.posix.normalize(value) !== value
  ) fail("wakeflow-host-settings-owner-plan", `${label} must be one canonical portable relative ref`);
  return value;
}

function normalizeAuthorizedRepositoryIds(value, desiredModel) {
  if (!Array.isArray(value)) {
    fail("wakeflow-host-settings-owner-authorization", "authorizedRepositoryIds must be one explicit array");
  }
  const known = new Set(desiredModel.topology.repositories.map((entry) => entry.repositoryId));
  const result = [...value];
  if (
    result.some((entry) => typeof entry !== "string" || !known.has(entry))
    || new Set(result).size !== result.length
    || canonicalJson(result) !== canonicalJson([...result].sort(lexicalCompare))
  ) {
    fail(
      "wakeflow-host-settings-owner-authorization",
      "authorizedRepositoryIds must be a canonical exact subset of desired repositories",
    );
  }
  return Object.freeze(result);
}

// 二、宿主 adapter 准入与artifact物理身份。
// 调用方注入的 adapter 可以只提供当前阶段所需方法；准入后总是返回冻结快照。
function normalizeAdapter(value, hostId, { participant = false } = {}) {
  if (!plainObject(value)) {
    fail("wakeflow-host-settings-owner-adapter", "applicable host settings/assets require one host adapter");
  }
  const required = participant
    ? ["hostId", "planMaintenance", "createMutationParticipant"]
    : ["hostId", "planMaintenance"];
  for (const key of required) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-host-settings-owner-adapter", `host adapter is missing ${key}`);
    }
  }
  const adapterHostId = Object.getOwnPropertyDescriptor(value, "hostId").value;
  const planMaintenance = Object.getOwnPropertyDescriptor(value, "planMaintenance").value;
  if (adapterHostId !== hostId || typeof planMaintenance !== "function") {
    fail("wakeflow-host-settings-owner-adapter", "host adapter identity or planner is invalid");
  }
  const createMutationParticipant = participant
    ? Object.getOwnPropertyDescriptor(value, "createMutationParticipant").value
    : null;
  if (participant && typeof createMutationParticipant !== "function") {
    fail("wakeflow-host-settings-owner-adapter", "host adapter participant factory is invalid");
  }
  return Object.freeze({
    hostId: adapterHostId,
    planMaintenance,
    ...(participant ? { createMutationParticipant } : {}),
  });
}

// 插件产物导出的 adapter 是发布合同，必须完整、exact 且由宿主 owner 主动冻结。
function normalizeLoadedAdapter(value, hostId) {
  exactKeys(
    value,
    ["hostId", "planMaintenance", "createMutationParticipant"],
    "host settings/assets artifact adapter",
    "wakeflow-host-settings-owner-adapter",
  );
  if (!Object.isFrozen(value)) {
    fail("wakeflow-host-settings-owner-adapter", "host settings/assets artifact adapter must be frozen");
  }
  return normalizeAdapter(value, hostId, { participant: true });
}

function ownerApplicable(normalizedHost) {
  return normalizedHost.capabilities.settings.applicable
    || normalizedHost.capabilities.assets.applicable;
}

function canonicalArtifactRelativePath(value) {
  if (
    typeof value !== "string"
    || !value
    || value.includes("\\")
    || path.posix.isAbsolute(value)
    || path.posix.normalize(value) !== value
    || value === "."
    || value === ".."
    || value.startsWith("../")
  ) fail("wakeflow-host-settings-owner-adapter", "host settings/assets path is not canonical");
  return value;
}

// 动态 import 会跟随符号链接；因此在 import 前验证当前观察到的产物根与模块物理身份。
// 这是artifact准入检查，不替代产物发布原子性，也不声称关闭检查后的并发替换窗口。
function inspectArtifactAdapterFile(wakeflowRoot, relative) {
  const file = path.resolve(wakeflowRoot, ...relative.split("/"));
  const containment = path.relative(wakeflowRoot, file);
  if (!containment || containment.startsWith("..") || path.isAbsolute(containment)) {
    fail("wakeflow-host-settings-owner-adapter", "host settings/assets path escapes the artifact root");
  }

  let rootStat;
  let fileStat;
  let physicalRoot;
  let physicalFile;
  try {
    rootStat = lstatSync(wakeflowRoot);
    fileStat = lstatSync(file);
    physicalRoot = realpathSync(wakeflowRoot);
    physicalFile = realpathSync(file);
  } catch (cause) {
    fail("wakeflow-host-settings-owner-adapter", "host settings/assets artifact path is unavailable", { cause });
  }
  if (
    rootStat.isSymbolicLink()
    || !rootStat.isDirectory()
    || physicalRoot !== wakeflowRoot
  ) {
    fail("wakeflow-host-settings-owner-adapter", "Wakeflow artifact root lacks exact directory identity");
  }
  if (
    fileStat.isSymbolicLink()
    || !fileStat.isFile()
    || physicalFile !== file
  ) {
    fail("wakeflow-host-settings-owner-adapter", "host settings/assets module lacks exact regular-file identity");
  }
  const physicalContainment = path.relative(physicalRoot, physicalFile);
  if (
    !physicalContainment
    || physicalContainment.startsWith("..")
    || path.isAbsolute(physicalContainment)
  ) {
    fail("wakeflow-host-settings-owner-adapter", "host settings/assets module escapes the artifact root");
  }
  return physicalFile;
}

/**
 * 从一个明确的插件产物根装载 settings/assets adapter。
 *
 * 输入：物理规范化的产物绝对路径与当前宿主画像。
 * 输出：不适用宿主返回 null；适用宿主返回 exact、冻结的三字段 adapter 快照。
 * 边界：拒绝符号链接、非普通文件、路径逃逸、错误 hostId、accessor 和扩展字段。
 */
export async function loadWakeflowHostSettingsAssetsAdapter(value = {}) {
  const input = exactKeys(
    value,
    ["wakeflowRoot", "hostProfile"],
    "host settings/assets artifact adapter input",
  );
  if (
    typeof input.wakeflowRoot !== "string"
    || !path.isAbsolute(input.wakeflowRoot)
    || path.resolve(input.wakeflowRoot) !== input.wakeflowRoot
  ) fail("wakeflow-host-settings-owner-adapter", "Wakeflow artifact root must be one normalized absolute path");
  const normalizedHost = normalizeWakeflowHostCapabilityProfile(input.hostProfile);
  const applicable = ownerApplicable(normalizedHost);
  const relative = input.hostProfile?.artifact?.settingsAssetsHostFile ?? null;
  if (relative === null) {
    if (applicable) {
      fail(
        "wakeflow-host-settings-owner-adapter",
        "applicable host settings/assets lack their artifact adapter path",
      );
    }
    return null;
  }
  if (!applicable) {
    fail(
      "wakeflow-host-settings-owner-adapter",
      "a non-applicable host cannot declare a settings/assets artifact adapter",
    );
  }
  canonicalArtifactRelativePath(relative);
  const file = inspectArtifactAdapterFile(input.wakeflowRoot, relative);
  let namespace;
  try {
    namespace = await import(pathToFileURL(file).href);
  } catch (cause) {
    fail("wakeflow-host-settings-owner-adapter", "host settings/assets module is unavailable", { cause });
  }
  return normalizeLoadedAdapter(
    namespace.wakeflowHostSettingsAssetsAdapter,
    normalizedHost.hostId,
  );
}

// 三、把其他 owner 已确认的计划收窄为宿主所需的只读前置事实。
function plannedLocalDirectoryRefs(localPlan) {
  if (localPlan === null) return Object.freeze([]);
  if (!plainObject(localPlan?.payload) || !Array.isArray(localPlan.payload.steps)) {
    fail("wakeflow-host-settings-owner-prerequisite", "local owner plan is invalid");
  }
  const refs = localPlan.payload.steps
    .filter((step) => step?.final?.type === "directory")
    .map((step) => portableRef(step.final.ref, "planned local directory ref"))
    .sort(lexicalCompare);
  if (new Set(refs).size !== refs.length) {
    fail("wakeflow-host-settings-owner-prerequisite", "planned local directory refs are not unique");
  }
  return Object.freeze(refs);
}

function plannedSupportSurfaceIds(supportPlan, desiredModel) {
  const ids = supportPlan?.payload?.plannedSupportSurfaceIds;
  if (!Array.isArray(ids)) {
    fail("wakeflow-host-settings-owner-prerequisite", "support owner plan lacks plannedSupportSurfaceIds");
  }
  const managed = new Set(desiredModel.topology.supportSurfaces
    .filter((entry) => entry.ownership === "wakeflow-managed")
    .map((entry) => entry.surfaceId));
  if (
    ids.some((entry) => !managed.has(entry))
    || new Set(ids).size !== ids.length
    || canonicalJson(ids) !== canonicalJson([...ids].sort(lexicalCompare))
  ) fail("wakeflow-host-settings-owner-prerequisite", "planned support surface IDs are invalid");
  return Object.freeze([...ids]);
}

function rootKey(root) {
  const kind = root.kind === "surface" ? "support-surface" : root.kind;
  if (!ROOT_KINDS.has(kind) || typeof root.rootId !== "string") {
    fail("wakeflow-host-settings-owner-prerequisite", "managed ignore operation has an invalid root");
  }
  return `${kind}:${root.rootId}`;
}

function plannedIgnoreRootKeys(managedPlan) {
  if (!plainObject(managedPlan?.payload) || !Array.isArray(managedPlan.payload.operations)) {
    fail("wakeflow-host-settings-owner-prerequisite", "managed-content owner plan is invalid");
  }
  const keys = managedPlan.payload.operations
    .filter((operation) => (
      operation.owner === "ignore-manager"
      && PHYSICAL_ACTIONS.has(operation.action)
    ))
    .map((operation) => rootKey(operation.root))
    .sort(lexicalCompare);
  if (new Set(keys).size !== keys.length) {
    fail("wakeflow-host-settings-owner-prerequisite", "planned ignore roots are not unique");
  }
  return Object.freeze(keys);
}

function transitionInput(input, sourceModel, desiredModel, authorizedRepositoryIds) {
  return deepFreeze({
    workspaceRoot: input.workspaceRoot,
    action: input.action,
    sourceModel,
    desiredModel,
    authorizedRepositoryIds,
    plannedSupportSurfaceIds: plannedSupportSurfaceIds(input.supportPlan, desiredModel),
    plannedLocalDirectoryRefs: plannedLocalDirectoryRefs(input.localPlan),
    plannedIgnoreRootKeys: plannedIgnoreRootKeys(input.managedPlan),
  });
}

// 四、统一规划和participant阶段的转换输入，保持两阶段身份一致。
function normalizeInput(value, { participant = false } = {}) {
  const expected = [
    "workspaceRoot",
    "action",
    "sourceModel",
    "desiredModel",
    "hostProfile",
    "authorizedRepositoryIds",
    "localPlan",
    "supportPlan",
    "managedPlan",
    "adapter",
    ...(participant ? ["confirmedPlan"] : ["transactionOffset"]),
  ];
  const input = exactKeys(
    value,
    expected,
    participant ? "host settings/assets participant input" : "host settings/assets plan input",
  );
  if (
    typeof input.workspaceRoot !== "string"
    || !path.isAbsolute(input.workspaceRoot)
    || path.resolve(input.workspaceRoot) !== input.workspaceRoot
    || !ACTIONS.has(input.action)
  ) fail("wakeflow-host-settings-owner-contract", "host settings/assets action identity is invalid");
  const desiredModel = parseWakeflowConfigV3(input.desiredModel);
  const sourceModel = input.sourceModel === null
    ? null
    : parseWakeflowConfigV3(input.sourceModel);
  if (
    (input.action === "fresh-initialize") !== (sourceModel === null)
    || (sourceModel !== null && sourceModel.program.programId !== desiredModel.program.programId)
  ) fail("wakeflow-host-settings-owner-contract", "host settings/assets transition models are invalid");
  const normalizedHost = normalizeWakeflowHostCapabilityProfile(input.hostProfile);
  const authorizedRepositoryIds = normalizeAuthorizedRepositoryIds(
    input.authorizedRepositoryIds,
    desiredModel,
  );
  if (!participant && (!Number.isSafeInteger(input.transactionOffset) || input.transactionOffset < 0)) {
    fail("wakeflow-host-settings-owner-contract", "transactionOffset must be a non-negative safe integer");
  }
  return {
    ...input,
    sourceModel,
    desiredModel,
    normalizedHost,
    authorizedRepositoryIds,
  };
}

// 五、验证宿主计划的共享元数据；Claude私有字段仍由Claude owner负责闭合。
function validateNode(value, label) {
  if (!plainObject(value) || !new Set(["absent", "file", "directory"]).has(value.type)) {
    fail("wakeflow-host-settings-owner-plan", `${label} is invalid`);
  }
  if (value.type === "absent") {
    exactKeys(value, ["type"], label);
    return value;
  }
  exactKeys(value, ["type", "mode", "digest"], label);
  if (typeof value.mode !== "string" || !DIGEST_RE.test(value.digest)) {
    fail("wakeflow-host-settings-owner-plan", `${label} file/directory identity is invalid`);
  }
  return value;
}

function validateHostPlan(value, input) {
  const plan = canonicalSnapshot(value, "host settings/assets maintenance plan");
  if (!plainObject(plan) || typeof plan.schemaId !== "string" || !plan.schemaId.startsWith("urn:")) {
    fail("wakeflow-host-settings-owner-plan", "host plan lacks one portable schema identity");
  }
  const payload = plan.payload;
  if (
    !plainObject(payload)
    || payload.action !== input.action
    || payload.programId !== input.desiredModel.program.programId
    || payload.hostId !== input.normalizedHost.hostId
    || !new Set(["ready", "blocked"]).has(payload.status)
    || !Array.isArray(payload.operations)
    || !Array.isArray(payload.blockers)
    || !Array.isArray(payload.steps)
  ) fail("wakeflow-host-settings-owner-plan", "host plan metadata is invalid");
  const operationIds = new Set();
  for (const operation of payload.operations) {
    if (
      !plainObject(operation)
      || typeof operation.operationId !== "string"
      || operationIds.has(operation.operationId)
      || operation.owner !== WAKEFLOW_HOST_SETTINGS_ASSETS_OWNER
      || !ROOT_KINDS.has(operation.root?.rootKind)
      || typeof operation.root?.rootId !== "string"
      || typeof operation.root?.configuredPath !== "string"
      || !new Set(["managed-missing", "managed-stale-known"]).has(operation.classification)
      || !PHYSICAL_ACTIONS.has(operation.action)
      || typeof operation.reasonCode !== "string"
    ) fail("wakeflow-host-settings-owner-plan", "host plan operation is invalid");
    operationIds.add(operation.operationId);
    portableRef(operation.ref, "host operation ref");
    portableRef(operation.resourceRef, "host operation resourceRef");
    validateNode(operation.source, "host operation source");
    validateNode(operation.target, "host operation target");
  }
  for (const blocker of payload.blockers) {
    if (!plainObject(blocker) || typeof blocker.code !== "string" || blocker.code.length === 0) {
      fail("wakeflow-host-settings-owner-plan", "host plan blocker is invalid");
    }
  }
  if (
    payload.status !== (payload.blockers.length === 0 ? "ready" : "blocked")
    || (payload.status === "ready" && payload.steps.length !== payload.operations.length)
    || (payload.status === "blocked" && payload.steps.length !== 0)
  ) fail("wakeflow-host-settings-owner-plan", "host plan status is not derived");
  for (const [ordinal, step] of payload.steps.entries()) {
    if (!operationIds.has(step?.stepId) || step.ordinal !== ordinal) {
      fail("wakeflow-host-settings-owner-plan", "host plan step is not operation-derived");
    }
  }
  const serialized = canonicalJson(plan);
  if (serialized.includes(input.workspaceRoot)) {
    fail("wakeflow-host-settings-owner-private-data", "host plan leaked its absolute workspace root");
  }
  return deepFreeze(plan);
}

// 六、把已验证宿主计划投影到统一maintenance action，不执行任何effect。
function actionRoot(operation) {
  return {
    kind: operation.root.rootKind,
    rootId: operation.root.rootId,
    basis: "target",
    configuredPath: operation.root.configuredPath,
  };
}

function actionAuthorization(operation) {
  if (operation.root.rootKind === "repository") {
    return { kind: "explicit-repository", repositoryId: operation.root.rootId };
  }
  return {
    kind: operation.component === "statusline-asset"
      ? "wakeflow-owned"
      : "configured-managed-component",
  };
}

function projectHostPlan(plan, transactionOffset) {
  const planDigest = canonicalJsonDigest(plan);
  const ready = plan.payload.status === "ready";
  const filesystemActions = ready
    ? plan.payload.operations.map((operation, ordinal) => ({
        actionId: operation.operationId,
        componentId: WAKEFLOW_HOST_SETTINGS_ASSETS_COMPONENT_ID,
        owner: WAKEFLOW_HOST_SETTINGS_ASSETS_OWNER,
        root: actionRoot(operation),
        ref: operation.ref,
        resourceRef: operation.resourceRef,
        classification: operation.classification,
        source: operation.source,
        target: operation.target,
        action: operation.action,
        authorization: actionAuthorization(operation),
        reasonCode: operation.reasonCode,
        stepId: operation.operationId,
        commitOrder: transactionOffset + ordinal,
      }))
    : [];
  const dependencyChecks = plan.payload.blockers.map((blocker, ordinal) => ({
    checkId: `host-settings-assets-blocked-${String(ordinal).padStart(4, "0")}`,
    componentId: WAKEFLOW_HOST_SETTINGS_ASSETS_COMPONENT_ID,
    owner: WAKEFLOW_HOST_SETTINGS_ASSETS_OWNER,
    subject: { kind: "program", value: plan.payload.programId },
    status: "blocked",
    code: blocker.code,
    evidence: [],
  }));
  return deepFreeze({
    components: [{
      componentId: WAKEFLOW_HOST_SETTINGS_ASSETS_COMPONENT_ID,
      owner: WAKEFLOW_HOST_SETTINGS_ASSETS_OWNER,
      ownerPlanDigest: planDigest,
    }],
    filesystemActions,
    dependencyChecks,
    preserved: [],
    deferredOwnerActions: dependencyChecks.map((dependency) => ({
      deferredId: dependency.checkId,
      componentId: dependency.componentId,
      owner: dependency.owner,
      action: "resolve-host-settings-assets-conflict",
      subject: dependency.subject,
      prerequisiteCheckIds: [dependency.checkId],
      reasonCode: dependency.code,
    })),
    blockers: dependencyChecks.map((dependency) => ({
      blockerId: dependency.checkId,
      componentId: dependency.componentId,
      owner: dependency.owner,
      subject: dependency.subject,
      code: dependency.code,
      dependencyCheckId: dependency.checkId,
    })),
    steps: ready
      ? plan.payload.steps.map((step, ordinal) => ({
          ...step,
          ordinal: transactionOffset + ordinal,
        }))
      : [],
  });
}

// 七、公开规划与participant入口。
/**
 * 生成宿主 settings/assets 的 maintenance owner 结果。
 *
 * 输入：已解析转换模型、前置 owner 计划、授权仓库集合和宿主 adapter。
 * 输出：not-applicable、missing，或带规范化宿主计划与统一 action 投影的结果。
 * 边界：本方法只规划，不调用 mutation participant，也不直接触碰文件系统。
 */
export function planWakeflowHostSettingsAssetsOwner(value) {
  const input = normalizeInput(value);
  if (!ownerApplicable(input.normalizedHost)) {
    if (input.adapter !== null) {
      fail("wakeflow-host-settings-owner-adapter", "a non-applicable host cannot supply a settings/assets adapter");
    }
    return deepFreeze({ status: "not-applicable", plan: null, projection: null });
  }
  if (input.adapter === null) {
    return deepFreeze({ status: "missing", plan: null, projection: null });
  }
  const adapter = normalizeAdapter(input.adapter, input.normalizedHost.hostId);
  const adapterInput = transitionInput(
    input,
    input.sourceModel,
    input.desiredModel,
    input.authorizedRepositoryIds,
  );
  let rawPlan;
  try {
    rawPlan = adapter.planMaintenance(adapterInput);
  } catch (cause) {
    fail("wakeflow-host-settings-owner-plan", "host adapter could not derive its maintenance plan", { cause });
  }
  const plan = validateHostPlan(rawPlan, input);
  return deepFreeze({
    status: plan.payload.status,
    plan,
    projection: projectHostPlan(plan, input.transactionOffset),
  });
}

/**
 * 为已确认的宿主计划创建 transaction participant。
 *
 * 输入：与规划阶段相同的转换事实、exact confirmedPlan 和具备 participant factory 的 adapter。
 * 输出：宿主 owner 创建的 participant，由上层 workspace mutation 协调提交与恢复。
 * 边界：再次验证 confirmedPlan，防止规划与执行之间替换宿主、program 或操作集合。
 */
export function createWakeflowHostSettingsAssetsOwnerMutationParticipant(value) {
  const input = normalizeInput(value, { participant: true });
  if (!ownerApplicable(input.normalizedHost)) {
    fail("wakeflow-host-settings-owner-adapter", "a non-applicable host has no settings/assets participant");
  }
  const adapter = normalizeAdapter(input.adapter, input.normalizedHost.hostId, { participant: true });
  const adapterInput = transitionInput(
    input,
    input.sourceModel,
    input.desiredModel,
    input.authorizedRepositoryIds,
  );
  const confirmedPlan = validateHostPlan(input.confirmedPlan, input);
  try {
    return adapter.createMutationParticipant({ ...adapterInput, confirmedPlan });
  } catch (cause) {
    fail("wakeflow-host-settings-owner-participant", "host adapter could not create its participant", { cause });
  }
}
