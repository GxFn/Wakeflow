import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import { planWakeflowConfigV3ReconfigureOwner } from "./wakeflow-config-v3-owner.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "./wakeflow-host-capability.mjs";
import { planWakeflowHostSettingsAssetsOwner } from "./wakeflow-host-settings-assets-owner.mjs";
import { createWakeflowLayoutDescriptor } from "./wakeflow-layout-descriptor.mjs";
import { planWakeflowLocalLayoutRealization } from "./wakeflow-local-layout-realization.mjs";
import {
  createWakeflowMaintenancePlan,
  wakeflowMaintenancePlanDigest,
} from "./wakeflow-maintenance-plan.mjs";
import { createWakeflowConfirmedActionPlan } from "./wakeflow-maintenance-action-composition.mjs";
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
import { diffWakeflowConfigV3Topology } from "./wakeflow-reconfigure.mjs";
import {
  inspectWindowRuntimeProjectionsForLayout,
  planWindowRuntimeProjectionMaintenance,
  projectWindowRuntimeProjectionMaintenance,
} from "./wakeflow-window-runtime-projector.mjs";

/**
 * 当前strict v3配置下的reconcile只读编排层。
 *
 * 职责导航：
 * 1. 只从workspace重新读取current config，不接受desired model，也不改变配置语义。
 * 2. 只规划当前宿主表面的local、support、ledger、managed、active、window runtime与host assets修复。
 * 3. windowInspection提供诊断事实；window runtime owner计划单独决定能否参与maintenance事务。
 * 4. aggregatePlan合并owner投影并保持config action为current、无config transaction step。
 * 5. ready aggregate由action composition绑定owner snapshot；本模块自身不写入、不注册窗口、不迁移数据。
 */

// 一、公共身份、输入合同与canonical公开快照。
export const WAKEFLOW_RECONCILE_KIND = "WakeflowReconcileBackbonePlan";
export const WAKEFLOW_RECONCILE_SCHEMA_VERSION = 1;

const MISSING_RECONCILE_OWNERS = Object.freeze([]);

export class WakeflowReconcileError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowReconcileError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowReconcileError(code, message, { path: errorPath, details, cause });
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactInput(value) {
  if (!plainObject(value)) {
    fail("wakeflow-reconcile-input", "reconcile input must be one plain object");
  }
  const expected = ["workspaceRoot", "hostProfile", "bundle", "language"];
  const optional = ["authorizedRepositoryIds", "hostSettingsAssetsAdapter"];
  const allowed = [...expected, ...optional];
  const actual = Reflect.ownKeys(value);
  if (
    actual.some((key) => typeof key !== "string" || !allowed.includes(key))
    || expected.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("wakeflow-reconcile-input", "reconcile input has an invalid field set", {
      details: { expected, optional, actual: actual.map(String) },
    });
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-reconcile-input", `reconcile input ${key} must be an enumerable data property`);
    }
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-reconcile-canonical", `${label} must be canonical JSON data`, { cause });
  }
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stripRef(resource) {
  return Object.fromEntries(Object.entries(resource).filter(([key]) => key !== "ref"));
}

function missingOwnerDescriptor(component) {
  return {
    kind: "WakeflowReconcileOwnerUnavailable",
    schemaVersion: 1,
    componentId: component.componentId,
    owner: component.owner,
    reasonCode: "reconcile-owner-not-implemented",
  };
}

// 二、window runtime诊断观察；失败收敛为脱敏unavailable事实，不把异常存在本身解释为修复授权。
function windowInspection({ workspaceRoot, snapshot, hostProfile }) {
  try {
    return inspectWindowRuntimeProjectionsForLayout({
      workspaceRoot,
      model: snapshot.model,
      configDigest: snapshot.configDigest,
      hostProfile,
    });
  } catch (cause) {
    const code = typeof cause?.code === "string"
      ? cause.code
      : "wakeflow-window-runtime-projector-source-unavailable";
    return deepFreeze({
      kind: "WakeflowWindowRuntimeProjectionInventoryUnavailable",
      schemaVersion: 1,
      programId: snapshot.model.program.programId,
      hostId: normalizeWakeflowHostCapabilityProfile(hostProfile).hostId,
      projectionStatus: "unavailable",
      windows: [],
      unsafeEntryCount: 0,
      issueCode: code,
      inventoryDigest: canonicalJsonDigest({
        kind: "WakeflowWindowRuntimeProjectionInventoryUnavailable",
        schemaVersion: 1,
        programId: snapshot.model.program.programId,
        hostId: normalizeWakeflowHostCapabilityProfile(hostProfile).hostId,
        issueCode: code,
      }),
    });
  }
}

function windowDependency(windowRuntime) {
  if (windowRuntime.projectionStatus === "current") return null;
  if (["missing", "stale"].includes(windowRuntime.projectionStatus)) {
    return {
      componentId: "window-runtime-projection",
      owner: "runtime-projection-builder",
      code: "reconcile-window-runtime-participant-unavailable",
    };
  }
  return {
    componentId: "window-runtime-projection",
    owner: "runtime-projection-builder",
    code: windowRuntime.projectionStatus === "unsafe"
      ? "reconcile-window-runtime-unsafe"
      : "reconcile-window-runtime-source-unavailable",
  };
}

function missingOwners(normalizedHost, hostSettingsStatus) {
  const result = [...MISSING_RECONCILE_OWNERS];
  if (
    (
      normalizedHost.capabilities.settings.applicable
      || normalizedHost.capabilities.assets.applicable
    )
    && hostSettingsStatus === "missing"
  ) {
    result.push({ componentId: "host-settings-assets", owner: "host-settings-assets-owner" });
  }
  return result.sort((left, right) => lexicalCompare(left.componentId, right.componentId));
}

function dependencyRecords({ programId, missing }) {
  const records = missing.map((component) => ({
    ...component,
    code: "reconcile-owner-not-implemented",
  }));
  return records
    .map((entry) => ({ ...entry, subject: { kind: "program", value: programId } }))
    .sort((left, right) => lexicalCompare(
      `${left.componentId}:${left.owner}:${left.code}`,
      `${right.componentId}:${right.owner}:${right.code}`,
    ));
}

function windowOwnerDescriptor(windowRuntime) {
  return {
    kind: "WakeflowReconcileWindowRuntimeOwnerObservation",
    schemaVersion: 1,
    programId: windowRuntime.programId,
    hostId: windowRuntime.hostId,
    projectionStatus: windowRuntime.projectionStatus,
    inventoryDigest: windowRuntime.inventoryDigest,
  };
}

// 三、owner projection汇总；config只能以current inventory action出现，不能生成配置写步骤。
function aggregatePlan({
  snapshot,
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
  dependencies,
  missing,
}) {
  const programId = snapshot.model.program.programId;
  const prefix = `targets/program/${programId}`;
  const configNode = {
    type: "file",
    mode: "0644",
    digest: configPlan.payload.configBytesDigest,
  };
  const configAction = {
    actionId: "reconcile-config-v3-current",
    componentId: "config",
    owner: "config-writer",
    root: { kind: "program", rootId: programId, basis: "target", configuredPath: "." },
    ref: "wakeflow.config.json",
    resourceRef: `${prefix}/wakeflow.config.json`,
    classification: "managed-current",
    source: configNode,
    target: configNode,
    action: "current",
    authorization: { kind: "none" },
    reasonCode: "reconcile-config-current",
    stepId: null,
    commitOrder: null,
  };
  const localActions = localPlan.payload.steps.map((step, index) => {
    const missingSource = step.source.type === "absent";
    return {
      actionId: step.stepId,
      componentId: "local-layout",
      owner: "layout-manager",
      root: { kind: "program", rootId: programId, basis: "target", configuredPath: "." },
      ref: step.final.ref,
      resourceRef: `${prefix}/${step.final.ref}`,
      classification: missingSource ? "managed-missing" : "managed-stale-known",
      source: stripRef(step.source),
      target: stripRef(step.final),
      action: missingSource ? "create-managed" : "update-managed",
      authorization: { kind: "wakeflow-owned" },
      reasonCode: missingSource ? "reconcile-local-static-missing" : "reconcile-local-static-mode",
      stepId: step.stepId,
      commitOrder: index,
    };
  });
  const steps = localPlan.payload.steps.map((step, index) => ({
    ...step,
    ordinal: index,
    source: { ...step.source, ref: `${prefix}/${step.source.ref}` },
    final: { ...step.final, ref: `${prefix}/${step.final.ref}` },
  }));
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
      ownerPlanDigest: canonicalJsonDigest(missingOwnerDescriptor(component)),
    })),
  ];
  const dependencyChecks = dependencies.map((entry, index) => ({
    checkId: `reconcile-dependency-${index}`,
    componentId: entry.componentId,
    owner: entry.owner,
    subject: entry.subject,
    status: "blocked",
    code: entry.code,
    evidence: [],
  }));
  const blockers = dependencies.map((entry, index) => ({
    blockerId: `reconcile-dependency-${index}`,
    componentId: entry.componentId,
    owner: entry.owner,
    subject: entry.subject,
    code: entry.code,
    dependencyCheckId: `reconcile-dependency-${index}`,
  }));
  const deferredOwnerActions = dependencies.map((entry, index) => ({
    deferredId: `reconcile-dependency-${index}`,
    componentId: entry.componentId,
    owner: entry.owner,
    action: "reconcile-owned-component",
    subject: entry.subject,
    prerequisiteCheckIds: [`reconcile-dependency-${index}`],
    reasonCode: entry.code,
  }));
  return createWakeflowMaintenancePlan({
    action: "reconcile",
    programId,
    host: {
      hostId: normalizedHost.hostId,
      profileDigest: canonicalJsonDigest(normalizedHost),
    },
    config: {
      disposition: "current",
      source: configNode,
      sourceAuthority: {
        programId,
        modelDigest: configPlan.payload.sourceModelDigest,
      },
      desiredModel: snapshot.model,
    },
    layoutDigest: descriptor.layoutDigest,
    topologyDiff: diffWakeflowConfigV3Topology({
      currentModel: snapshot.model,
      desiredModel: snapshot.model,
    }),
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
      ...dependencyChecks,
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
      ...deferredOwnerActions,
      ...supportProjection.deferredOwnerActions,
      ...ledgerProjection.deferredOwnerActions,
      ...managedProjection.deferredOwnerActions,
      ...activeFoundationProjection.deferredOwnerActions,
      ...activeProjection.deferredOwnerActions,
      ...windowRuntimeProjection.deferredOwnerActions,
      ...(hostSettingsProjection?.deferredOwnerActions ?? []),
    ],
    blockers: [
      ...blockers,
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

function sourceBlockers({ snapshot, configPlan, localPlan, windowRuntime }) {
  const subject = { kind: "program", value: snapshot.model.program.programId };
  const blockers = [];
  if (configPlan.payload.status !== "ready" || configPlan.payload.disposition !== "current") {
    const codes = configPlan.payload.blockers.length === 0
      ? ["reconcile-config-not-current"]
      : configPlan.payload.blockers.map((entry) => entry.code);
    for (const code of codes) blockers.push({
      componentId: "config",
      owner: "config-writer",
      subject,
      code,
    });
  }
  if (localPlan.payload.blockers.length > 0) {
    blockers.push({
      componentId: "local-layout",
      owner: "layout-manager",
      subject,
      code: "reconcile-local-layout-blocked",
    });
  }
  const window = windowDependency(windowRuntime);
  if (window && ["unsafe", "unavailable"].includes(windowRuntime.projectionStatus)) {
    blockers.push({ ...window, subject });
  }
  return blockers.sort((left, right) => lexicalCompare(
    `${left.componentId}:${left.owner}:${left.code}`,
    `${right.componentId}:${right.owner}:${right.code}`,
  ));
}

// 四、公共reconcile编排入口。
/**
 * 对当前配置和当前宿主表面生成一次零写入preview；只有完整ready时才附带confirmed action plan。
 */
export function planWakeflowReconcileBackbone(value) {
  const input = exactInput(value);
  const authorizedRepositoryIds = input.authorizedRepositoryIds ?? [];
  const normalizedHost = normalizeWakeflowHostCapabilityProfile(input.hostProfile);
  let snapshot;
  try {
    snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: input.workspaceRoot });
  } catch (cause) {
    fail("wakeflow-reconcile-config-source", "strict current v3 config authority is unavailable", { cause });
  }
  const descriptor = createWakeflowLayoutDescriptor({
    model: snapshot.model,
    hostProfile: input.hostProfile,
  });
  const configPlan = planWakeflowConfigV3ReconfigureOwner({
    workspaceRoot: input.workspaceRoot,
    desiredModel: snapshot.model,
  });
  const localPlan = planWakeflowLocalLayoutRealization({
    workspaceRoot: input.workspaceRoot,
    action: "reconcile",
    model: snapshot.model,
    layoutDescriptor: descriptor,
    hostProfile: input.hostProfile,
  });
  const supportPlan = planWakeflowSupportSurfaceOwner({
    workspaceRoot: input.workspaceRoot,
    action: "reconcile",
    sourceModel: snapshot.model,
    desiredModel: snapshot.model,
    layoutDescriptor: descriptor,
    hostProfile: input.hostProfile,
  });
  const supportProjection = projectWakeflowSupportSurfaceMaintenance({
    plan: supportPlan,
    transactionOffset: localPlan.payload.steps.length,
  });
  const ledgerPlan = planWakeflowLedgerMaterialization({
    workspaceRoot: input.workspaceRoot,
    action: "reconcile",
    sourceModel: snapshot.model,
    desiredModel: snapshot.model,
  });
  const ledgerProjection = projectWakeflowLedgerMaterializationMaintenance({
    plan: ledgerPlan,
    transactionOffset: localPlan.payload.steps.length + supportPlan.payload.steps.length,
  });
  const managedPlan = planWakeflowManagedContent({
    workspaceRoot: input.workspaceRoot,
    action: "reconcile",
    sourceModel: snapshot.model,
    desiredModel: snapshot.model,
    hostProfile: input.hostProfile,
    authorizedRepositoryIds,
    plannedSupportSurfaceIds: supportPlan.payload.plannedSupportSurfaceIds,
  });
  const managedProjection = projectWakeflowManagedContentMaintenance({
    plan: managedPlan,
    transactionOffset: localPlan.payload.steps.length
      + supportPlan.payload.steps.length
      + ledgerPlan.payload.steps.length,
  });
  const activeFoundationOffset = localPlan.payload.steps.length
    + supportPlan.payload.steps.length
    + ledgerPlan.payload.steps.length
    + managedPlan.payload.steps.length;
  const activeFoundationPlan = planWakeflowActiveFoundation({
    workspaceRoot: input.workspaceRoot,
    action: "reconcile",
    sourceModel: snapshot.model,
    desiredModel: snapshot.model,
  });
  const activeFoundationProjection = projectWakeflowActiveFoundationMaintenance({
    plan: activeFoundationPlan,
    transactionOffset: activeFoundationOffset,
  });
  const activeProjectionPlan = planWakeflowActiveProjectionMaintenance({
    workspaceRoot: input.workspaceRoot,
    action: "reconcile",
    sourceModel: snapshot.model,
    desiredModel: snapshot.model,
    bundle: input.bundle,
    language: input.language,
  });
  const activeProjection = projectWakeflowActiveProjectionMaintenance({
    plan: activeProjectionPlan,
    transactionOffset: activeFoundationOffset + activeFoundationPlan.payload.steps.length,
  });
  const windowRuntime = windowInspection({
    workspaceRoot: input.workspaceRoot,
    snapshot,
    hostProfile: input.hostProfile,
  });
  let windowRuntimePlan = null;
  try {
    windowRuntimePlan = planWindowRuntimeProjectionMaintenance({
      workspaceRoot: input.workspaceRoot,
      action: "reconcile",
      sourceModel: snapshot.model,
      desiredModel: snapshot.model,
      hostProfile: input.hostProfile,
    });
  } catch {
    windowRuntimePlan = null;
  }
  const windowRuntimeProjection = windowRuntimePlan === null
    ? null
    : projectWindowRuntimeProjectionMaintenance({
        plan: windowRuntimePlan,
        transactionOffset: activeFoundationOffset
          + activeFoundationPlan.payload.steps.length
          + activeProjectionPlan.payload.steps.length,
      });
  const hostSettingsOwner = windowRuntimePlan === null
    ? null
    : planWakeflowHostSettingsAssetsOwner({
        workspaceRoot: path.resolve(input.workspaceRoot),
        action: "reconcile",
        sourceModel: snapshot.model,
        desiredModel: snapshot.model,
        hostProfile: input.hostProfile,
        authorizedRepositoryIds,
        localPlan,
        supportPlan,
        managedPlan,
        adapter: input.hostSettingsAssetsAdapter ?? null,
        transactionOffset: activeFoundationOffset
          + activeFoundationPlan.payload.steps.length
          + activeProjectionPlan.payload.steps.length
          + windowRuntimePlan.payload.steps.length,
      });
  const hostSettingsPlan = hostSettingsOwner?.plan ?? null;
  const hostSettingsProjection = hostSettingsOwner?.projection ?? null;
  const missing = missingOwners(normalizedHost, hostSettingsOwner?.status ?? "missing");
  const dependencies = dependencyRecords({
    programId: snapshot.model.program.programId,
    missing,
  });
  const sourceReady = configPlan.payload.status === "ready"
    && configPlan.payload.disposition === "current"
    && configPlan.payload.sourceModelDigest === snapshot.configDigest
    && localPlan.payload.blockers.length === 0
    && windowRuntimePlan !== null;
  const aggregate = sourceReady
    ? aggregatePlan({
        snapshot,
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
        dependencies,
        missing,
      })
    : null;
  const publicBlockers = aggregate === null
    ? sourceBlockers({ snapshot, configPlan, localPlan, windowRuntime })
    : aggregate.payload.blockers.map((entry) => ({
        componentId: entry.componentId,
        owner: entry.owner,
        subject: entry.subject,
        code: entry.code,
      }));
  const windowAvailability = windowRuntimePlan === null || windowRuntimePlan.payload.status === "blocked"
    ? "blocked"
    : "available";
  const managedOwnerAvailability = (owner) => (
    managedPlan.payload.operations.some((entry) => entry.owner === owner && entry.action === "blocked")
      ? "blocked"
      : "available"
  );
  const supportAvailability = supportPlan.payload.operations.some((entry) => entry.action === "blocked")
    ? "blocked"
    : "available";
  const ledgerAvailability = ledgerPlan.payload.operations.some((entry) => entry.action === "blocked")
    ? "blocked"
    : "available";
  const ownerGraph = [
    {
      componentId: "config",
      owner: "config-writer",
      availability: configPlan.payload.status === "ready" && configPlan.payload.disposition === "current"
        ? "available"
        : "blocked",
      ownerPlanDigest: canonicalJsonDigest(configPlan),
    },
    {
      componentId: "local-layout",
      owner: "layout-manager",
      availability: localPlan.payload.blockers.length === 0 ? "available" : "blocked",
      ownerPlanDigest: canonicalJsonDigest(localPlan),
    },
    {
      componentId: "window-runtime-projection",
      owner: "runtime-projection-builder",
      availability: windowAvailability,
      ownerPlanDigest: canonicalJsonDigest(
        windowRuntimePlan ?? windowOwnerDescriptor(windowRuntime),
      ),
    },
    ...supportProjection.components.map((component) => ({
      ...component,
      availability: supportAvailability,
    })),
    ...ledgerProjection.components.map((component) => ({
      ...component,
      availability: ledgerAvailability,
    })),
    ...managedProjection.components.map((component) => ({
      ...component,
      availability: managedOwnerAvailability(component.owner),
    })),
    ...activeFoundationProjection.components.map((component) => ({
      ...component,
      availability: activeFoundationPlan.payload.status === "ready" ? "available" : "blocked",
    })),
    ...activeProjection.components.map((component) => ({
      ...component,
      availability: activeProjectionPlan.payload.status === "ready" ? "available" : "blocked",
    })),
    ...(hostSettingsPlan === null ? [] : [{
      componentId: "host-settings-assets",
      owner: "host-settings-assets-owner",
      availability: hostSettingsPlan.payload.status === "ready" ? "available" : "blocked",
      ownerPlanDigest: canonicalJsonDigest(hostSettingsPlan),
    }]),
    ...missing.map((component) => ({
      componentId: component.componentId,
      owner: component.owner,
      availability: "missing",
      ownerPlanDigest: canonicalJsonDigest(missingOwnerDescriptor(component)),
    })),
  ].sort((left, right) => lexicalCompare(left.componentId, right.componentId));
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
    kind: WAKEFLOW_RECONCILE_KIND,
    schemaVersion: WAKEFLOW_RECONCILE_SCHEMA_VERSION,
    action: "reconcile",
    status: aggregate?.payload.status ?? "blocked",
    hostEffectsAllowed: false,
    programId: snapshot.model.program.programId,
    host: {
      hostId: normalizedHost.hostId,
      profileDigest: canonicalJsonDigest(normalizedHost),
    },
    scope: {
      kind: "current-host-surface",
      hostId: normalizedHost.hostId,
      hostDirName: normalizedHost.hostDirName,
      configMutationAllowed: false,
      registrationAllowed: false,
      migrationAllowed: false,
    },
    config: {
      status: configPlan.payload.status,
      disposition: configPlan.payload.disposition,
      sourceClassification: configPlan.payload.sourceClassification,
      modelDigest: snapshot.configDigest,
      bytesDigest: configPlan.payload.sourceConfigBytesDigest,
      ownerPlanDigest: canonicalJsonDigest(configPlan),
    },
    localLayout: {
      status: localPlan.payload.blockers.length === 0 ? "ready" : "blocked",
      stepCount: localPlan.payload.steps.length,
      blockerCount: localPlan.payload.blockers.length,
      ownerPlanDigest: canonicalJsonDigest(localPlan),
    },
    windowRuntime,
    topologyDiff: diffWakeflowConfigV3Topology({
      currentModel: snapshot.model,
      desiredModel: snapshot.model,
    }),
    ownerGraph,
    blockers: publicBlockers,
    aggregatePlan: aggregate,
    aggregatePlanDigest: aggregate === null ? null : wakeflowMaintenancePlanDigest(aggregate),
    confirmedActionPlan,
  };
  const publicResult = canonicalSnapshot(result, "reconcile backbone plan");
  if (canonicalJson(publicResult).includes(path.resolve(input.workspaceRoot))) {
    fail("wakeflow-reconcile-private-data", "reconcile plan leaked its absolute workspace root");
  }
  return deepFreeze(publicResult);
}
