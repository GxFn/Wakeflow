import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  createWakeflowActiveFoundationMutationParticipant,
} from "./wakeflow-active-foundation.mjs";
import {
  createWakeflowActiveProjectionMutationParticipant,
} from "./wakeflow-active-projector.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  createWakeflowConfigV3OwnerMutationParticipant,
  createWakeflowConfigV3ReconfigureMutationParticipant,
} from "./wakeflow-config-v3-owner.mjs";
import {
  parseWakeflowConfigV3,
} from "./wakeflow-config-v3.mjs";
import {
  createWakeflowFreshDesiredModel,
  planWakeflowFreshInitializeBackbone,
} from "./wakeflow-fresh-initialize.mjs";
import {
  normalizeWakeflowHostCapabilityProfile,
} from "./wakeflow-host-capability.mjs";
import {
  createWakeflowHostSettingsAssetsOwnerMutationParticipant,
  loadWakeflowHostSettingsAssetsAdapter,
} from "./wakeflow-host-settings-assets-owner.mjs";
import {
  assertWakeflowId,
} from "./wakeflow-identifiers.mjs";
import {
  createWakeflowLayoutDescriptor,
} from "./wakeflow-layout-descriptor.mjs";
import {
  createWakeflowLedgerMaterializationMutationParticipant,
} from "./wakeflow-ledger-materialization.mjs";
import {
  createWakeflowLocalLayoutMutationParticipant,
} from "./wakeflow-local-layout-realization.mjs";
import {
  createWakeflowMaintenanceActionMutationParticipant,
  validateWakeflowConfirmedActionPlan,
} from "./wakeflow-maintenance-action-composition.mjs";
import {
  createWakeflowManagedContentMutationParticipant,
} from "./wakeflow-managed-content.mjs";
import {
  planWakeflowReconcileBackbone,
} from "./wakeflow-reconcile.mjs";
import {
  planWakeflowReconfigureBackbone,
} from "./wakeflow-reconfigure.mjs";
import {
  createWakeflowSupportSurfaceMutationParticipant,
} from "./wakeflow-support-surface-owner.mjs";
import {
  assertParsedWakeflowAssetBundle,
  loadWakeflowAssetBundle,
} from "./wakeflow-template-renderer.mjs";
import {
  createWindowRuntimeProjectionMutationParticipant,
} from "./wakeflow-window-runtime-projector.mjs";
import {
  recoverWakeflowWorkspaceMutation,
  runWakeflowMaintenanceMutation,
} from "./wakeflow-workspace-mutation.mjs";

/**
 * 三类正常workspace maintenance action的生产运行时。
 *
 * 职责导航：
 * 1. 为fresh-initialize、reconfigure、reconcile构造各自的preview校验与规划入口。
 * 2. 从confirmed action plan恢复owner snapshots、模型、授权仓库和语言事实。
 * 3. 为每个owner建立participant，并由action composition闭合aggregate step与terminal closure。
 * 4. 只通过workspace mutation manager执行apply/recover，不直接实现领域文件写入。
 * 5. artifact loader只装载静态profile、asset bundle和可选宿主adapter，不缓存workspace authority。
 */

// 一、运行时版本、组件所有权与错误合同。
export const WAKEFLOW_MAINTENANCE_ACTION_RUNTIME_VERSION = 1;

const ACTIONS = Object.freeze(["fresh-initialize", "reconfigure", "reconcile"]);
const LANGUAGES = new Set(["en", "zh"]);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const MAINTENANCE_COMPONENT_OWNERS = new Map([
  ["active-layout", "layout-manager"],
  ["active-projection", "active-projector"],
  ["config", "config-writer"],
  ["host-settings-assets", "host-settings-assets-owner"],
  ["ignore", "ignore-manager"],
  ["ledger-layout", "ledger-service"],
  ["ledger-projection", "ledger-projector"],
  ["local-layout", "layout-manager"],
  ["managed-memory", "instruction-renderer"],
  ["support-surface", "support-materializer"],
  ["todo-authority", "todo-service"],
  ["window-runtime-projection", "runtime-projection-builder"],
]);
const REQUIRED_MAINTENANCE_COMPONENTS = Object.freeze([
  "active-layout",
  "active-projection",
  "config",
  "ignore",
  "ledger-layout",
  "ledger-projection",
  "managed-memory",
  "support-surface",
  "todo-authority",
  "window-runtime-projection",
]);

export class WakeflowMaintenanceActionRuntimeError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowMaintenanceActionRuntimeError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { details = {}, cause } = {}) {
  throw new WakeflowMaintenanceActionRuntimeError(code, message, { details, cause });
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value,
  expected,
  label,
  code = "wakeflow-maintenance-runtime-contract",
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

// 完整profile含宿主函数，无法canonical clone；因此要求调用方提供已递归冻结的静态数据树。
function deepFrozenDataTree(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return true;
  if ((!Array.isArray(value) && !plainObject(value)) || !Object.isFrozen(value)) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor?.enumerable
      || !Object.hasOwn(descriptor, "value")
      || !deepFrozenDataTree(descriptor.value, seen)
    ) return false;
  }
  return true;
}

// settings/assets在不适用宿主必须严格为null；适用宿主只接纳R11冻结的exact adapter。
function normalizeHostSettingsAssetsAdapter(value, normalizedHost) {
  const settingsCapability = normalizedHost.capabilities.settings;
  const assetsCapability = normalizedHost.capabilities.assets;
  const applicable = (
    settingsCapability.applicable === true
    && settingsCapability.realization === "current"
    && assetsCapability.applicable === true
    && assetsCapability.realization === "current"
  );
  const notApplicable = (
    settingsCapability.applicable === false
    && settingsCapability.realization === "not-applicable"
    && assetsCapability.applicable === false
    && assetsCapability.realization === "not-applicable"
  );
  if (!applicable && !notApplicable) {
    fail(
      "wakeflow-maintenance-runtime-host",
      "settings and assets must be jointly current or jointly not-applicable",
    );
  }
  if (notApplicable) {
    if (value !== null) {
      fail(
        "wakeflow-maintenance-runtime-host",
        "a non-applicable host cannot supply one settings/assets adapter",
      );
    }
    return null;
  }
  if (value === null) {
    fail(
      "wakeflow-maintenance-runtime-host",
      "an applicable host must supply one settings/assets adapter",
    );
  }
  exactKeys(
    value,
    ["hostId", "planMaintenance", "createMutationParticipant"],
    "host settings/assets adapter",
    "wakeflow-maintenance-runtime-host",
  );
  if (
    !Object.isFrozen(value)
    || value.hostId !== normalizedHost.hostId
    || typeof value.planMaintenance !== "function"
    || typeof value.createMutationParticipant !== "function"
  ) {
    fail(
      "wakeflow-maintenance-runtime-host",
      "hostSettingsAssetsAdapter does not exactly match the current host profile applicability",
    );
  }
  return Object.freeze({
    hostId: value.hostId,
    planMaintenance: value.planMaintenance,
    createMutationParticipant: value.createMutationParticipant,
  });
}

function normalizedRoot(value, label = "workspace root") {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail("wakeflow-maintenance-runtime-root", `${label} must be one normalized absolute path`);
  return value;
}

function language(value) {
  if (!LANGUAGES.has(value)) {
    fail("wakeflow-maintenance-runtime-language", "language must be the caller-resolved value en or zh");
  }
  return value;
}

function canonicalRepositoryIds(value, desiredModel) {
  if (!Array.isArray(value)) {
    fail("wakeflow-maintenance-runtime-authorization", "authorizedRepositoryIds must be one array");
  }
  const known = new Set(desiredModel.topology.repositories.map((entry) => entry.repositoryId));
  const expected = [...value].sort(lexicalCompare);
  if (
    value.some((entry) => typeof entry !== "string" || !known.has(entry))
    || new Set(value).size !== value.length
    || canonicalJson(value) !== canonicalJson(expected)
  ) {
    fail(
      "wakeflow-maintenance-runtime-authorization",
      "authorizedRepositoryIds must be one canonical exact subset of desired repositories",
    );
  }
  return Object.freeze([...value]);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validationUuidFactory() {
  let cursor = 0;
  return () => {
    cursor += 1;
    return `00000000-0000-4000-8000-${cursor.toString(16).padStart(12, "0")}`;
  };
}

// 二、preview请求只验证结构；fresh的真实ID仅在随后同一次preview规划中分配。
function validateFreshPreviewRequest(request) {
  exactKeys(request, ["selection", "language"], "fresh-initialize preview request");
  language(request.language);
  createWakeflowFreshDesiredModel({
    selection: request.selection,
    uuidFactory: validationUuidFactory(),
  });
  return Object.freeze({ valid: true });
}

function validateReconfigurePreviewRequest(request) {
  exactKeys(
    request,
    ["desiredModel", "language", "authorizedRepositoryIds"],
    "reconfigure preview request",
  );
  language(request.language);
  const desiredModel = parseWakeflowConfigV3(request.desiredModel);
  canonicalRepositoryIds(request.authorizedRepositoryIds, desiredModel);
  return Object.freeze({ valid: true });
}

function validateReconcilePreviewRequest(request) {
  exactKeys(
    request,
    ["language", "authorizedRepositoryIds"],
    "reconcile preview request",
  );
  language(request.language);
  if (!Array.isArray(request.authorizedRepositoryIds)) {
    fail("wakeflow-maintenance-runtime-authorization", "authorizedRepositoryIds must be one array");
  }
  const canonical = [...request.authorizedRepositoryIds].sort(lexicalCompare);
  if (
    request.authorizedRepositoryIds.some((entry, index) => {
      try {
        assertWakeflowId(entry, "repository", `$/authorizedRepositoryIds/${index}`);
        return false;
      } catch {
        return true;
      }
    })
    || new Set(request.authorizedRepositoryIds).size !== request.authorizedRepositoryIds.length
    || canonicalJson(canonical) !== canonicalJson(request.authorizedRepositoryIds)
  ) {
    fail(
      "wakeflow-maintenance-runtime-authorization",
      "authorizedRepositoryIds must be one canonical repository ID set",
    );
  }
  return Object.freeze({ valid: true });
}

// 三、confirmed plan恢复阶段只接受当前action、当前宿主画像和完整已知owner集合。
function validateConfirmedForAction(plan, action) {
  let confirmed;
  try {
    confirmed = validateWakeflowConfirmedActionPlan(plan);
  } catch (cause) {
    fail("wakeflow-maintenance-runtime-plan", "confirmed action plan is invalid", { cause });
  }
  if (confirmed.payload.action !== action) {
    fail("wakeflow-maintenance-runtime-plan", "confirmed action plan belongs to another action");
  }
  return confirmed;
}

function validateOuterPlanDigest(plan, planDigest) {
  if (typeof planDigest !== "string" || !DIGEST_RE.test(planDigest)) {
    fail("wakeflow-maintenance-runtime-plan", "planDigest must be one lowercase sha256 digest");
  }
  if (canonicalJsonDigest(plan) !== planDigest) {
    fail("wakeflow-maintenance-runtime-plan", "planDigest differs from the exact confirmed action plan");
  }
}

function snapshotMap(confirmed) {
  return new Map(confirmed.payload.ownerSnapshots.map((entry) => [entry.componentId, entry]));
}

function requiredSnapshot(byComponent, componentId) {
  const entry = byComponent.get(componentId);
  if (!entry) {
    fail("wakeflow-maintenance-runtime-owner", `confirmed action plan lacks ${componentId}`);
  }
  return entry;
}

function actionContext(confirmed, expectedHostProfileDigest) {
  const aggregate = confirmed.payload.aggregatePlan;
  if (
    aggregate.payload.host.hostId !== expectedHostProfileDigest.hostId
    || aggregate.payload.host.profileDigest !== expectedHostProfileDigest.profileDigest
  ) {
    fail("wakeflow-maintenance-runtime-host", "confirmed action plan belongs to another host profile");
  }
  const byComponent = snapshotMap(confirmed);
  if (byComponent.size !== confirmed.payload.ownerSnapshots.length) {
    fail("wakeflow-maintenance-runtime-owner", "confirmed action plan repeats an owner component");
  }
  for (const entry of confirmed.payload.ownerSnapshots) {
    const expectedOwner = MAINTENANCE_COMPONENT_OWNERS.get(entry.componentId);
    if (expectedOwner === undefined || entry.owner !== expectedOwner) {
      fail(
        "wakeflow-maintenance-runtime-owner",
        "confirmed action plan contains an unknown or mismatched owner component",
      );
    }
  }
  for (const componentId of REQUIRED_MAINTENANCE_COMPONENTS) {
    requiredSnapshot(byComponent, componentId);
  }
  const configPlan = requiredSnapshot(byComponent, "config").snapshot;
  const desiredModel = parseWakeflowConfigV3(configPlan?.payload?.desiredModel);
  const sourceModel = confirmed.payload.action === "fresh-initialize"
    ? null
    : parseWakeflowConfigV3(configPlan?.payload?.sourceModel);
  const managedPlan = requiredSnapshot(byComponent, "ignore").snapshot;
  const activeProjectionPlan = requiredSnapshot(byComponent, "active-projection").snapshot;
  const authorizedRepositoryIds = canonicalRepositoryIds(
    managedPlan?.payload?.authorizedRepositoryIds,
    desiredModel,
  );
  const resolvedLanguage = language(activeProjectionPlan?.payload?.language);
  return Object.freeze({
    byComponent,
    sourceModel,
    desiredModel,
    managedPlan,
    language: resolvedLanguage,
    authorizedRepositoryIds,
  });
}

// 四、把每份owner snapshot交还给真实领域participant，当前文件只负责完整覆盖与接线。
function ownerParticipants({
  workspaceRoot,
  action,
  confirmed,
  context,
  hostProfile,
  bundle,
  hostSettingsAssetsAdapter,
}) {
  const byComponent = context.byComponent;
  const descriptor = createWakeflowLayoutDescriptor({ model: context.desiredModel, hostProfile });
  const supportPlan = requiredSnapshot(byComponent, "support-surface").snapshot;
  const localPlan = byComponent.get("local-layout")?.snapshot ?? null;
  const definitions = [];
  const add = (componentId, participant) => {
    const entry = requiredSnapshot(byComponent, componentId);
    definitions.push({ snapshotDigest: entry.snapshotDigest, participant });
  };
  add("config", action === "fresh-initialize"
    ? createWakeflowConfigV3OwnerMutationParticipant({
        workspaceRoot,
        model: context.desiredModel,
        confirmedPlan: requiredSnapshot(byComponent, "config").snapshot,
      })
    : createWakeflowConfigV3ReconfigureMutationParticipant({
        workspaceRoot,
        desiredModel: context.desiredModel,
        confirmedPlan: requiredSnapshot(byComponent, "config").snapshot,
      }));
  add("support-surface", createWakeflowSupportSurfaceMutationParticipant({
    workspaceRoot,
    action,
    sourceModel: context.sourceModel,
    desiredModel: context.desiredModel,
    layoutDescriptor: descriptor,
    hostProfile,
    confirmedPlan: supportPlan,
  }));
  add("ledger-layout", createWakeflowLedgerMaterializationMutationParticipant({
    workspaceRoot,
    action,
    sourceModel: context.sourceModel,
    desiredModel: context.desiredModel,
    confirmedPlan: requiredSnapshot(byComponent, "ledger-layout").snapshot,
  }));
  add("ignore", createWakeflowManagedContentMutationParticipant({
    workspaceRoot,
    action,
    sourceModel: context.sourceModel,
    desiredModel: context.desiredModel,
    hostProfile,
    authorizedRepositoryIds: context.authorizedRepositoryIds,
    plannedSupportSurfaceIds: supportPlan.payload.plannedSupportSurfaceIds,
    confirmedPlan: context.managedPlan,
  }));
  add("active-layout", createWakeflowActiveFoundationMutationParticipant({
    workspaceRoot,
    action,
    sourceModel: context.sourceModel,
    desiredModel: context.desiredModel,
    confirmedPlan: requiredSnapshot(byComponent, "active-layout").snapshot,
  }));
  add("active-projection", createWakeflowActiveProjectionMutationParticipant({
    workspaceRoot,
    action,
    sourceModel: context.sourceModel,
    desiredModel: context.desiredModel,
    bundle,
    language: context.language,
    confirmedPlan: requiredSnapshot(byComponent, "active-projection").snapshot,
  }));
  add("window-runtime-projection", createWindowRuntimeProjectionMutationParticipant({
    workspaceRoot,
    action,
    sourceModel: context.sourceModel,
    desiredModel: context.desiredModel,
    hostProfile,
    confirmedPlan: requiredSnapshot(byComponent, "window-runtime-projection").snapshot,
  }));
  if (localPlan !== null) {
    add("local-layout", createWakeflowLocalLayoutMutationParticipant({
      workspaceRoot,
      confirmedPlan: localPlan,
      model: context.desiredModel,
      layoutDescriptor: descriptor,
      hostProfile,
    }));
  }
  if (byComponent.has("host-settings-assets")) {
    add("host-settings-assets", createWakeflowHostSettingsAssetsOwnerMutationParticipant({
      workspaceRoot,
      action,
      sourceModel: context.sourceModel,
      desiredModel: context.desiredModel,
      hostProfile,
      authorizedRepositoryIds: context.authorizedRepositoryIds,
      localPlan,
      supportPlan,
      managedPlan: context.managedPlan,
      adapter: hostSettingsAssetsAdapter,
      confirmedPlan: requiredSnapshot(byComponent, "host-settings-assets").snapshot,
    }));
  }

  const expectedDigests = new Set(
    confirmed.payload.ownerSnapshots.map((entry) => entry.snapshotDigest),
  );
  const actualDigests = new Set(definitions.map((entry) => entry.snapshotDigest));
  if (
    actualDigests.size !== expectedDigests.size
    || [...expectedDigests].some((digest) => !actualDigests.has(digest))
  ) {
    fail(
      "wakeflow-maintenance-runtime-owner",
      "production owner participants do not cover every unique confirmed snapshot",
    );
  }
  return Object.freeze(definitions);
}

function backboneInput({ root, action, context, hostProfile, bundle, hostSettingsAssetsAdapter }) {
  const shared = {
    workspaceRoot: root,
    hostProfile,
    bundle,
    language: context.language,
    ...(hostSettingsAssetsAdapter === null ? {} : { hostSettingsAssetsAdapter }),
  };
  if (action === "fresh-initialize") {
    return { ...shared, desiredModel: context.desiredModel };
  }
  if (action === "reconfigure") {
    return {
      ...shared,
      desiredModel: context.desiredModel,
      authorizedRepositoryIds: context.authorizedRepositoryIds,
    };
  }
  return { ...shared, authorizedRepositoryIds: context.authorizedRepositoryIds };
}

function planBackbone(action, input) {
  if (action === "fresh-initialize") return planWakeflowFreshInitializeBackbone(input);
  if (action === "reconfigure") return planWakeflowReconfigureBackbone(input);
  return planWakeflowReconcileBackbone(input);
}

/**
 * 执行一份已确认action plan。
 *
 * apply会按当前workspace重新规划并要求与确认计划完全一致；recovery只消费journal绑定的原计划。
 * 两种模式最终都交给workspace mutation manager，action runtime不自行提交或清理文件。
 */
async function executeConfirmed({
  root,
  action,
  confirmedPlan,
  planDigest,
  operationId = null,
  admission,
  hostProfile,
  normalizedHost,
  bundle,
  hostSettingsAssetsAdapter,
}) {
  const workspaceRoot = normalizedRoot(root);
  validateOuterPlanDigest(confirmedPlan, planDigest);
  const confirmed = validateConfirmedForAction(confirmedPlan, action);
  const context = actionContext(confirmed, {
    hostId: normalizedHost.hostId,
    profileDigest: canonicalJsonDigest(normalizedHost),
  });
  const participants = ownerParticipants({
    workspaceRoot,
    action,
    confirmed,
    context,
    hostProfile,
    bundle,
    hostSettingsAssetsAdapter,
  });
  const input = backboneInput({
    root: workspaceRoot,
    action,
    context,
    hostProfile,
    bundle,
    hostSettingsAssetsAdapter,
  });
  const participant = createWakeflowMaintenanceActionMutationParticipant({
    workspaceRoot,
    admission,
    confirmedActionPlan: confirmed,
    ownerParticipants: participants,
    replan: admission === "apply"
      ? () => planBackbone(action, input).confirmedActionPlan
      : null,
  });
  const mutationInput = {
    workspaceRoot,
    confirmedPlan: confirmed.payload.aggregatePlan,
    planDigest: confirmed.payload.aggregatePlanDigest,
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  };
  if (admission === "recovery") {
    return recoverWakeflowWorkspaceMutation({ ...mutationInput, operationId });
  }
  return runWakeflowMaintenanceMutation({
    ...mutationInput,
    action,
    operationKind: `${action}-v3`,
    domainOwner: "maintenance-action-coordinator",
  });
}

// 五、每个action handler保持同一五方法形状，但preview输入与backbone严格分流。
function createActionHandler(action, runtime) {
  const validatePreview = action === "fresh-initialize"
    ? validateFreshPreviewRequest
    : action === "reconfigure"
      ? validateReconfigurePreviewRequest
      : validateReconcilePreviewRequest;
  return Object.freeze({
    async validatePreviewRequest(value) {
      exactKeys(value, ["request"], `${action} preview validation input`);
      return validatePreview(value.request);
    },

    async validateConfirmedPlan(value) {
      exactKeys(value, ["plan"], `${action} confirmed-plan validation input`);
      validateConfirmedForAction(value.plan, action);
      return Object.freeze({ valid: true });
    },

    async preview(value) {
      exactKeys(value, ["root", "request"], `${action} preview input`);
      const root = normalizedRoot(value.root);
      validatePreview(value.request);
      if (action === "fresh-initialize") {
        const desiredModel = createWakeflowFreshDesiredModel({
          selection: value.request.selection,
          uuidFactory: runtime.uuidFactory,
        });
        return planWakeflowFreshInitializeBackbone({
          workspaceRoot: root,
          desiredModel,
          hostProfile: runtime.hostProfile,
          bundle: runtime.bundle,
          language: value.request.language,
          ...(runtime.hostSettingsAssetsAdapter === null
            ? {}
            : { hostSettingsAssetsAdapter: runtime.hostSettingsAssetsAdapter }),
        });
      }
      if (action === "reconfigure") {
        return planWakeflowReconfigureBackbone({
          workspaceRoot: root,
          desiredModel: value.request.desiredModel,
          hostProfile: runtime.hostProfile,
          bundle: runtime.bundle,
          language: value.request.language,
          authorizedRepositoryIds: value.request.authorizedRepositoryIds,
          ...(runtime.hostSettingsAssetsAdapter === null
            ? {}
            : { hostSettingsAssetsAdapter: runtime.hostSettingsAssetsAdapter }),
        });
      }
      return planWakeflowReconcileBackbone({
        workspaceRoot: root,
        hostProfile: runtime.hostProfile,
        bundle: runtime.bundle,
        language: value.request.language,
        authorizedRepositoryIds: value.request.authorizedRepositoryIds,
        ...(runtime.hostSettingsAssetsAdapter === null
          ? {}
          : { hostSettingsAssetsAdapter: runtime.hostSettingsAssetsAdapter }),
      });
    },

    async apply(value) {
      exactKeys(value, ["root", "confirmedPlan", "planDigest"], `${action} apply input`);
      return executeConfirmed({
        ...value,
        action,
        admission: "apply",
        ...runtime,
      });
    },

    async recover(value) {
      exactKeys(
        value,
        ["root", "operationId", "confirmedPlan", "planDigest"],
        `${action} recovery input`,
      );
      return executeConfirmed({
        ...value,
        action,
        admission: "recovery",
        ...runtime,
      });
    },
  });
}

/**
 * 从静态宿主依赖构造三组action handlers。
 *
 * 输入：递归冻结的完整host profile、已解析asset bundle、适用性一致的冻结adapter和UUID源。
 * 输出：冻结的三action callable registry，可交给host-neutral coordinator缓存复用。
 * 边界：缓存对象不包含workspace root、config snapshot、confirmed plan或mutation context。
 */
export function createWakeflowMaintenanceActionHandlers(value = {}) {
  exactKeys(
    value,
    ["hostProfile", "bundle", "hostSettingsAssetsAdapter", "uuidFactory"],
    "maintenance action runtime input",
  );
  if (typeof value.uuidFactory !== "function") {
    fail("wakeflow-maintenance-runtime-id-source", "uuidFactory must be one function");
  }
  if (!deepFrozenDataTree(value.hostProfile)) {
    fail(
      "wakeflow-maintenance-runtime-host",
      "hostProfile must be one deeply frozen static data tree",
    );
  }
  const normalizedHost = normalizeWakeflowHostCapabilityProfile(value.hostProfile);
  assertParsedWakeflowAssetBundle(value.bundle);
  const hostSettingsAssetsAdapter = normalizeHostSettingsAssetsAdapter(
    value.hostSettingsAssetsAdapter,
    normalizedHost,
  );
  const runtime = Object.freeze({
    hostProfile: value.hostProfile,
    normalizedHost,
    bundle: value.bundle,
    hostSettingsAssetsAdapter,
    uuidFactory: value.uuidFactory,
  });
  return Object.freeze(Object.fromEntries(ACTIONS.map((action) => [
    action,
    createActionHandler(action, runtime),
  ])));
}

/**
 * 从当前插件产物装载action handlers所需的静态依赖。
 *
 * asset bundle与宿主adapter的文件准入由各自loader负责；失败会被收敛为稳定runtime错误。
 * 本入口不读取目标workspace，也不因一次加载成功而获得任何跨调用写权限。
 */
export async function loadWakeflowMaintenanceActionHandlers(value = {}) {
  exactKeys(value, ["wakeflowRoot", "hostProfile"], "maintenance artifact runtime input");
  const wakeflowRoot = normalizedRoot(value.wakeflowRoot, "Wakeflow artifact root");
  let bundle;
  try {
    bundle = loadWakeflowAssetBundle({ wakeflowRoot });
  } catch (cause) {
    fail("wakeflow-maintenance-runtime-bundle", "installed Wakeflow asset bundle is unavailable", { cause });
  }
  let hostSettingsAssetsAdapter;
  try {
    hostSettingsAssetsAdapter = await loadWakeflowHostSettingsAssetsAdapter({
      wakeflowRoot,
      hostProfile: value.hostProfile,
    });
  } catch (cause) {
    fail("wakeflow-maintenance-runtime-host", "host settings/assets adapter is unavailable", { cause });
  }
  return createWakeflowMaintenanceActionHandlers({
    hostProfile: value.hostProfile,
    bundle,
    hostSettingsAssetsAdapter,
    uuidFactory: randomUUID,
  });
}
