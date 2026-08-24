import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
} from "./wakeflow-config-v3.mjs";
import {
  planWakeflowConfigV3ReconfigureOwner,
} from "./wakeflow-config-v3-owner.mjs";
import {
  normalizeWakeflowHostCapabilityProfile,
} from "./wakeflow-host-capability.mjs";
import { planWakeflowHostSettingsAssetsOwner } from "./wakeflow-host-settings-assets-owner.mjs";
import { createWakeflowLayoutDescriptor } from "./wakeflow-layout-descriptor.mjs";
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
import {
  planWindowRuntimeProjectionMaintenance,
  projectWindowRuntimeProjectionMaintenance,
} from "./wakeflow-window-runtime-projector.mjs";

/**
 * 已有strict v3 workspace的reconfigure只读编排层。
 *
 * 职责导航：
 * 1. diffWakeflowConfigV3Topology按stable ID比较current与desired拓扑，并拒绝更换program identity。
 * 2. dependencyMatrix把删除、换根、窗口角色重分配和ledger迁移路由给真正的生命周期owner。
 * 3. 各领域owner独立规划config、support、ledger、managed、active、window runtime与host assets。
 * 4. aggregatePlan只合并owner投影和事务顺序；未证明的dependency保持blocked，绝不猜测授权。
 * 5. ready aggregate再由action composition绑定owner snapshot；本模块不写文件，也不执行宿主操作。
 */

// 一、公共身份、拓扑词汇与输入准入。
export const WAKEFLOW_RECONFIGURE_KIND = "WakeflowReconfigureBackbonePlan";
export const WAKEFLOW_RECONFIGURE_SCHEMA_VERSION = 1;

const TYPE_ORDER = Object.freeze(["repository", "surface", "window"]);
const PRESERVED_WINDOW_FACTS = Object.freeze([
  "binding",
  "evidence",
  "lease",
  "operations",
  "transport",
]);
const WINDOW_DECOMMISSION_OWNERS = Object.freeze([
  "active-state-owner",
  "host-lifecycle-owner",
  "pod-owner",
  "transport-owner",
  "window-binding-owner",
  "window-lease-owner",
  "window-runtime-projector",
]);

export class WakeflowReconfigureError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowReconfigureError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowReconfigureError(code, message, { path: errorPath, details, cause });
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactInput(value, expected, label, { optional = [] } = {}) {
  if (!isPlainObject(value)) fail("wakeflow-reconfigure-contract", `${label} must be a plain object`);
  const actual = Reflect.ownKeys(value);
  const allowed = [...expected, ...optional];
  if (
    actual.some((key) => typeof key !== "string" || !allowed.includes(key))
    || expected.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("wakeflow-reconfigure-contract", `${label} has an invalid field set`, {
      details: { expected, optional, actual: actual.map(String) },
    });
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-reconfigure-contract", `${label}.${key} must be an enumerable data property`);
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
    fail("wakeflow-reconfigure-canonical", `${label} must be canonical JSON data`, { cause });
  }
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// 二、基于stable ID的拓扑差异；display metadata变化不会被误判为实体替换。
function entityRecords(model) {
  return [
    ...model.topology.repositories.map((entry) => ({
      entityType: "repository",
      entityId: entry.repositoryId,
      placement: entry.path,
      entry,
    })),
    ...model.topology.supportSurfaces.map((entry) => ({
      entityType: "surface",
      entityId: entry.surfaceId,
      placement: entry.path,
      entry,
    })),
    ...model.topology.windows.map((entry) => ({
      entityType: "window",
      entityId: entry.windowId,
      placement: null,
      entry,
    })),
  ];
}

function entityKey(entry) {
  return `${entry.entityType}:${entry.entityId}`;
}

function classifyChangedEntity(source, target) {
  if (canonicalJson(source.entry) === canonicalJson(target.entry)) return "unchanged";
  if (
    source.entityType === "repository"
    || source.entityType === "surface"
  ) {
    return source.placement === target.placement ? "metadata-changed" : "root-changed";
  }
  if (
    source.entry.role !== target.entry.role
    || canonicalJson(source.entry.root) !== canonicalJson(target.entry.root)
  ) {
    return "role-reassigned";
  }
  return "metadata-changed";
}

/**
 * 计算同一program内的repository、surface与window变化，返回规范排序的纯事实diff。
 */
export function diffWakeflowConfigV3Topology(value) {
  const input = exactInput(value, ["currentModel", "desiredModel"], "topology diff input");
  const current = parseWakeflowConfigV3(input.currentModel);
  const desired = parseWakeflowConfigV3(input.desiredModel);
  if (current.program.programId !== desired.program.programId) {
    fail(
      "wakeflow-reconfigure-program-identity",
      "reconfigure must preserve the exact program identity",
    );
  }
  const sourceByKey = new Map(entityRecords(current).map((entry) => [entityKey(entry), entry]));
  const targetByKey = new Map(entityRecords(desired).map((entry) => [entityKey(entry), entry]));
  const keys = [...new Set([...sourceByKey.keys(), ...targetByKey.keys()])].sort((left, right) => {
    const [leftType, leftId] = left.split(":");
    const [rightType, rightId] = right.split(":");
    const typeDelta = TYPE_ORDER.indexOf(leftType) - TYPE_ORDER.indexOf(rightType);
    return typeDelta || lexicalCompare(leftId, rightId);
  });
  return deepFreeze(keys.map((key) => {
    const source = sourceByKey.get(key) ?? null;
    const target = targetByKey.get(key) ?? null;
    const basis = source ?? target;
    return {
      entityType: basis.entityType,
      entityId: basis.entityId,
      change: source === null
        ? "added"
        : target === null
          ? "removed"
          : classifyChangedEntity(source, target),
      sourceDigest: source === null ? null : canonicalJsonDigest(source.entry),
      targetDigest: target === null ? null : canonicalJsonDigest(target.entry),
      sourcePlacement: source?.placement ?? null,
      targetPlacement: target?.placement ?? null,
    };
  }));
}

function subjectKey(subject) {
  return `${subject.kind}:${subject.value}`;
}

function dependency(owner, subject, code = "reconfigure-authority-unproven") {
  return { owner, subject, status: "blocked", code };
}

// 三、跨owner依赖与preservation边界；这些记录只描述缺失证明，不自行执行decommission或迁移。
function dependencyMatrix({ current, desired, diff, hostSettingsMissing }) {
  const dependencies = [];
  const add = (entry) => dependencies.push(entry);
  const programSubject = { kind: "program", value: desired.program.programId };
  if (hostSettingsMissing) {
    add(dependency("host-settings-assets-owner", programSubject, "reconfigure-host-settings-owner-unavailable"));
  }
  if (current.storage.ledgerRoot !== desired.storage.ledgerRoot) {
    add(dependency("ledger-migration-owner", programSubject, "ledger-root-requires-explicit-migration"));
  }
  for (const entry of diff) {
    const subject = { kind: entry.entityType, value: entry.entityId };
    if (
      entry.entityType === "window"
      && ["removed", "role-reassigned"].includes(entry.change)
    ) {
      for (const owner of WINDOW_DECOMMISSION_OWNERS) add(dependency(owner, subject));
    }
    if (
      entry.entityType === "repository"
      && ["removed", "root-changed"].includes(entry.change)
    ) {
      add(dependency("repository-scope-owner", subject, "repository-scope-authority-unproven"));
    }
    if (
      entry.entityType === "surface"
      && ["removed", "root-changed"].includes(entry.change)
    ) {
      add(dependency("support-surface-owner", subject, "support-surface-authority-unproven"));
    }
  }
  const unique = new Map();
  for (const entry of dependencies) {
    unique.set(`${entry.owner}:${subjectKey(entry.subject)}:${entry.code}`, entry);
  }
  return [...unique.values()].sort((left, right) => lexicalCompare(
    `${left.owner}:${subjectKey(left.subject)}:${left.code}`,
    `${right.owner}:${subjectKey(right.subject)}:${right.code}`,
  ));
}

function preservation(diff) {
  return diff
    .filter((entry) => entry.entityType === "window" && ["unchanged", "metadata-changed"].includes(entry.change))
    .map((entry) => ({
      entityType: entry.entityType,
      entityId: entry.entityId,
      change: entry.change,
      preserves: [...PRESERVED_WINDOW_FACTS],
    }));
}

function stripRef(resource) {
  return Object.fromEntries(Object.entries(resource).filter(([key]) => key !== "ref"));
}

function missingOwnerDescriptor(owner, entries) {
  return {
    kind: "WakeflowReconfigureOwnerUnavailable",
    schemaVersion: 1,
    owner,
    subjects: entries.map((entry) => entry.subject),
    reasonCodes: [...new Set(entries.map((entry) => entry.code))].sort(lexicalCompare),
  };
}

// window runtime源读取失败时生成稳定描述，避免吞错后伪装成可用owner或泄漏底层路径。
function unavailableWindowRuntimeDescriptor(desired, normalizedHost) {
  return {
    kind: "WakeflowReconfigureWindowRuntimeOwnerUnavailable",
    schemaVersion: 1,
    programId: desired.program.programId,
    hostId: normalizedHost.hostId,
    reasonCode: "reconfigure-window-runtime-source-unavailable",
  };
}

/**
 * 把config与所有可用领域projection汇总为统一maintenance plan，并交给纯计划codec验证闭合。
 */
function aggregatePlan({
  desired,
  descriptor,
  normalizedHost,
  diff,
  configPlan,
  supportProjection,
  ledgerProjection,
  ledgerComponents,
  managedProjection,
  activeFoundationProjection,
  activeProjection,
  windowRuntimeProjection,
  hostSettingsProjection,
  dependencies,
}) {
  const programId = desired.program.programId;
  const prefix = `targets/program/${programId}`;
  const configStep = configPlan.payload.steps[0] ?? null;
  const sourceNode = {
    type: "file",
    mode: "0644",
    digest: configPlan.payload.sourceConfigBytesDigest,
  };
  const targetNode = {
    type: "file",
    mode: "0644",
    digest: configPlan.payload.configBytesDigest,
  };
  const configPhysical = configPlan.payload.disposition === "update";
  const configAction = {
    actionId: configPhysical ? configStep.stepId : "reconfigure-config-v3-current",
    componentId: "config",
    owner: "config-writer",
    root: { kind: "program", rootId: programId, basis: "target", configuredPath: "." },
    ref: "wakeflow.config.json",
    resourceRef: `${prefix}/wakeflow.config.json`,
    classification: configPhysical ? "managed-stale-known" : "managed-current",
    source: sourceNode,
    target: targetNode,
    action: configPhysical ? "update-managed" : "current",
    authorization: { kind: configPhysical ? "wakeflow-owned" : "none" },
    reasonCode: configPhysical ? "reconfigure-config-update" : "reconfigure-config-current",
    stepId: configPhysical ? configStep.stepId : null,
    commitOrder: configPhysical ? 0 : null,
  };
  const dependenciesByOwner = new Map();
  for (const entry of dependencies) {
    const values = dependenciesByOwner.get(entry.owner) ?? [];
    values.push(entry);
    dependenciesByOwner.set(entry.owner, values);
  }
  const components = [{
    componentId: "config",
    owner: "config-writer",
    ownerPlanDigest: canonicalJsonDigest(configPlan),
  },
  ...supportProjection.components,
  ...ledgerComponents,
  ...managedProjection.components,
  ...activeFoundationProjection.components,
  ...activeProjection.components,
  ...windowRuntimeProjection.components,
  ...(hostSettingsProjection?.components ?? [])];
  for (const [owner, entries] of dependenciesByOwner) {
    components.push({
      componentId: owner,
      owner,
      ownerPlanDigest: canonicalJsonDigest(missingOwnerDescriptor(owner, entries)),
    });
  }
  const dependencyChecks = dependencies.map((entry, index) => ({
    checkId: `reconfigure-dependency-${index}`,
    componentId: entry.owner,
    owner: entry.owner,
    subject: entry.subject,
    status: "blocked",
    code: entry.code,
    evidence: [],
  }));
  const blockers = dependencies.map((entry, index) => ({
    blockerId: `reconfigure-dependency-${index}`,
    componentId: entry.owner,
    owner: entry.owner,
    subject: entry.subject,
    code: entry.code,
    dependencyCheckId: `reconfigure-dependency-${index}`,
  }));
  const deferredOwnerActions = dependencies.map((entry, index) => ({
    deferredId: `reconfigure-dependency-${index}`,
    componentId: entry.owner,
    owner: entry.owner,
    action: "prove-reconfigure-dependency",
    subject: entry.subject,
    prerequisiteCheckIds: [`reconfigure-dependency-${index}`],
    reasonCode: entry.code,
  }));
  const steps = configPhysical
    ? [{
        ...configStep,
        source: { ...configStep.source, ref: `${prefix}/${configStep.source.ref}` },
        staging: { ...configStep.staging, ref: `${prefix}/${configStep.staging.ref}` },
        final: { ...configStep.final, ref: `${prefix}/${configStep.final.ref}` },
      }]
    : [];
  return createWakeflowMaintenancePlan({
    action: "reconfigure",
    programId,
    host: {
      hostId: normalizedHost.hostId,
      profileDigest: canonicalJsonDigest(normalizedHost),
    },
    config: {
      disposition: configPhysical ? "update" : "current",
      source: sourceNode,
      sourceAuthority: {
        programId,
        modelDigest: configPlan.payload.sourceModelDigest,
      },
      desiredModel: desired,
    },
    layoutDigest: descriptor.layoutDigest,
    topologyDiff: diff,
    components,
    filesystemActions: [
      configAction,
      ...supportProjection.filesystemActions,
      ...(ledgerProjection?.filesystemActions ?? []),
      ...managedProjection.filesystemActions,
      ...activeFoundationProjection.filesystemActions,
      ...activeProjection.filesystemActions,
      ...windowRuntimeProjection.filesystemActions,
      ...(hostSettingsProjection?.filesystemActions ?? []),
    ],
    dependencyChecks: [
      ...dependencyChecks,
      ...supportProjection.dependencyChecks,
      ...(ledgerProjection?.dependencyChecks ?? []),
      ...managedProjection.dependencyChecks,
      ...activeFoundationProjection.dependencyChecks,
      ...activeProjection.dependencyChecks,
      ...windowRuntimeProjection.dependencyChecks,
      ...(hostSettingsProjection?.dependencyChecks ?? []),
    ],
    preserved: [
      ...supportProjection.preserved,
      ...(ledgerProjection?.preserved ?? []),
      ...managedProjection.preserved,
      ...activeFoundationProjection.preserved,
      ...activeProjection.preserved,
      ...windowRuntimeProjection.preserved,
      ...(hostSettingsProjection?.preserved ?? []),
    ],
    deferredOwnerActions: [
      ...deferredOwnerActions,
      ...supportProjection.deferredOwnerActions,
      ...(ledgerProjection?.deferredOwnerActions ?? []),
      ...managedProjection.deferredOwnerActions,
      ...activeFoundationProjection.deferredOwnerActions,
      ...activeProjection.deferredOwnerActions,
      ...windowRuntimeProjection.deferredOwnerActions,
      ...(hostSettingsProjection?.deferredOwnerActions ?? []),
    ],
    blockers: [
      ...blockers,
      ...supportProjection.blockers,
      ...(ledgerProjection?.blockers ?? []),
      ...managedProjection.blockers,
      ...activeFoundationProjection.blockers,
      ...activeProjection.blockers,
      ...windowRuntimeProjection.blockers,
      ...(hostSettingsProjection?.blockers ?? []),
    ],
    steps: [
      ...steps,
      ...supportProjection.steps,
      ...(ledgerProjection?.steps ?? []),
      ...managedProjection.steps,
      ...activeFoundationProjection.steps,
      ...activeProjection.steps,
      ...windowRuntimeProjection.steps,
      ...(hostSettingsProjection?.steps ?? []),
    ],
  });
}

function sourceBlockers(programId, configPlan) {
  return configPlan.payload.blockers.map((entry) => ({
    componentId: "config",
    owner: "config-writer",
    subject: { kind: "program", value: programId },
    code: entry.code,
  }));
}

// 四、公共reconfigure编排入口。
/**
 * 从现存strict config owner事实规划desired model转换；preview阶段只返回计划和阻断关系。
 */
export function planWakeflowReconfigureBackbone(value) {
  const input = exactInput(
    value,
    ["workspaceRoot", "desiredModel", "hostProfile", "bundle", "language"],
    "reconfigure backbone input",
    { optional: ["authorizedRepositoryIds", "hostSettingsAssetsAdapter"] },
  );
  const authorizedRepositoryIds = input.authorizedRepositoryIds ?? [];
  const desired = parseWakeflowConfigV3(input.desiredModel);
  const normalizedHost = normalizeWakeflowHostCapabilityProfile(input.hostProfile);
  const descriptor = createWakeflowLayoutDescriptor({ model: desired, hostProfile: input.hostProfile });
  const configPlan = planWakeflowConfigV3ReconfigureOwner({
    workspaceRoot: input.workspaceRoot,
    desiredModel: desired,
  });
  const current = configPlan.payload.sourceModel;
  const sourceReady = configPlan.payload.status === "ready" && current !== null;
  const diff = sourceReady
    ? diffWakeflowConfigV3Topology({ currentModel: current, desiredModel: desired })
    : null;
  const supportPlan = sourceReady
    ? planWakeflowSupportSurfaceOwner({
        workspaceRoot: input.workspaceRoot,
        action: "reconfigure",
        sourceModel: current,
        desiredModel: desired,
        layoutDescriptor: descriptor,
        hostProfile: input.hostProfile,
      })
    : null;
  const supportProjection = supportPlan === null
    ? null
    : projectWakeflowSupportSurfaceMaintenance({
        plan: supportPlan,
        transactionOffset: configPlan.payload.steps.length,
      });
  const ledgerRootStable = sourceReady
    && current.storage.ledgerRoot === desired.storage.ledgerRoot;
  const ledgerPlan = ledgerRootStable
    ? planWakeflowLedgerMaterialization({
        workspaceRoot: input.workspaceRoot,
        action: "reconfigure",
        sourceModel: current,
        desiredModel: desired,
      })
    : null;
  const ledgerProjection = ledgerPlan === null
    ? null
    : projectWakeflowLedgerMaterializationMaintenance({
        plan: ledgerPlan,
        transactionOffset: configPlan.payload.steps.length + supportPlan.payload.steps.length,
      });
  const managedPlan = sourceReady
    ? planWakeflowManagedContent({
        workspaceRoot: input.workspaceRoot,
        action: "reconfigure",
        sourceModel: current,
        desiredModel: desired,
        hostProfile: input.hostProfile,
        authorizedRepositoryIds,
        plannedSupportSurfaceIds: supportPlan.payload.plannedSupportSurfaceIds,
      })
    : null;
  const managedProjection = managedPlan === null
    ? null
    : projectWakeflowManagedContentMaintenance({
        plan: managedPlan,
        transactionOffset: configPlan.payload.steps.length
          + supportPlan.payload.steps.length
          + (ledgerPlan?.payload.steps.length ?? 0),
      });
  const activeFoundationOffset = sourceReady
    ? configPlan.payload.steps.length
      + supportPlan.payload.steps.length
      + (ledgerPlan?.payload.steps.length ?? 0)
      + managedPlan.payload.steps.length
    : null;
  const activeFoundationPlan = sourceReady
    ? planWakeflowActiveFoundation({
        workspaceRoot: input.workspaceRoot,
        action: "reconfigure",
        sourceModel: current,
        desiredModel: desired,
      })
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
        action: "reconfigure",
        sourceModel: current,
        desiredModel: desired,
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
  let windowRuntimePlan = null;
  if (sourceReady) {
    try {
      windowRuntimePlan = planWindowRuntimeProjectionMaintenance({
        workspaceRoot: input.workspaceRoot,
        action: "reconfigure",
        sourceModel: current,
        desiredModel: desired,
        hostProfile: input.hostProfile,
      });
    } catch {
      windowRuntimePlan = null;
    }
  }
  const windowRuntimeSourceBlocker = sourceReady && windowRuntimePlan === null
    ? {
        componentId: "window-runtime-projection",
        owner: "runtime-projection-builder",
        subject: { kind: "program", value: desired.program.programId },
        code: "reconfigure-window-runtime-source-unavailable",
      }
    : null;
  const windowRuntimeProjection = windowRuntimePlan === null
    ? null
    : projectWindowRuntimeProjectionMaintenance({
        plan: windowRuntimePlan,
        transactionOffset: activeFoundationOffset
          + activeFoundationPlan.payload.steps.length
          + activeProjectionPlan.payload.steps.length,
      });
  const hostSettingsOwner = sourceReady && windowRuntimePlan !== null
    ? planWakeflowHostSettingsAssetsOwner({
        workspaceRoot: path.resolve(input.workspaceRoot),
        action: "reconfigure",
        sourceModel: current,
        desiredModel: desired,
        hostProfile: input.hostProfile,
        authorizedRepositoryIds,
        localPlan: null,
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
  const dependencies = sourceReady
      ? dependencyMatrix({
        current,
        desired,
        diff,
        hostSettingsMissing: hostSettingsOwner?.status === "missing",
      })
    : [];
  const ledgerComponents = ledgerProjection?.components ?? [
    {
      componentId: "ledger-layout",
      owner: "ledger-service",
      ownerPlanDigest: canonicalJsonDigest(missingOwnerDescriptor("ledger-service", [{
        subject: { kind: "program", value: desired.program.programId },
        code: "ledger-root-requires-explicit-migration",
      }])),
    },
    {
      componentId: "ledger-projection",
      owner: "ledger-projector",
      ownerPlanDigest: canonicalJsonDigest(missingOwnerDescriptor("ledger-projector", [{
        subject: { kind: "program", value: desired.program.programId },
        code: "ledger-root-requires-explicit-migration",
      }])),
    },
  ];
  const aggregate = sourceReady && windowRuntimePlan !== null
    ? aggregatePlan({
        desired,
        descriptor,
        normalizedHost,
        diff,
        configPlan,
        supportProjection,
        ledgerProjection,
        ledgerComponents,
        managedProjection,
        activeFoundationProjection,
        activeProjection,
        windowRuntimeProjection,
        hostSettingsProjection,
        dependencies,
      })
    : null;
  const blockers = !sourceReady
    ? sourceBlockers(desired.program.programId, configPlan)
    : aggregate !== null
      ? aggregate.payload.blockers.map((entry) => ({
        componentId: entry.componentId,
        owner: entry.owner,
        subject: entry.subject,
        code: entry.code,
      }))
      : [
          ...dependencies.map((entry) => ({
            componentId: entry.owner,
            owner: entry.owner,
            subject: entry.subject,
            code: entry.code,
          })),
          ...(windowRuntimeSourceBlocker === null ? [] : [windowRuntimeSourceBlocker]),
        ];
  const owners = sourceReady
    ? [
        {
          componentId: "config",
          owner: "config-writer",
          availability: "available",
          ownerPlanDigest: canonicalJsonDigest(configPlan),
        },
        ...supportProjection.components.map((component) => ({
          ...component,
          availability: supportPlan.payload.operations.some((entry) => entry.action === "blocked")
            ? "blocked"
            : "available",
        })),
        ...ledgerComponents.map((component) => ({
          ...component,
          availability: ledgerPlan === null || ledgerPlan.payload.operations.some((entry) => entry.action === "blocked")
            ? "blocked"
            : "available",
        })),
        ...managedProjection.components.map((component) => ({
          ...component,
          availability: managedPlan.payload.operations.some((entry) => (
            entry.owner === component.owner && entry.action === "blocked"
          )) ? "blocked" : "available",
        })),
        ...activeFoundationProjection.components.map((component) => ({
          ...component,
          availability: activeFoundationPlan.payload.status === "ready" ? "available" : "blocked",
        })),
        ...activeProjection.components.map((component) => ({
          ...component,
          availability: activeProjectionPlan.payload.status === "ready" ? "available" : "blocked",
        })),
        ...(windowRuntimeProjection === null
          ? [{
              componentId: "window-runtime-projection",
              owner: "runtime-projection-builder",
              availability: "blocked",
              ownerPlanDigest: canonicalJsonDigest(
                unavailableWindowRuntimeDescriptor(desired, normalizedHost),
              ),
            }]
          : windowRuntimeProjection.components.map((component) => ({
              ...component,
              availability: windowRuntimePlan.payload.status === "ready" ? "available" : "blocked",
            }))),
        ...(hostSettingsPlan === null ? [] : [{
          componentId: "host-settings-assets",
          owner: "host-settings-assets-owner",
          availability: hostSettingsPlan.payload.status === "ready" ? "available" : "blocked",
          ownerPlanDigest: canonicalJsonDigest(hostSettingsPlan),
        }]),
        ...[...new Set(dependencies.map((entry) => entry.owner))].map((owner) => ({
          componentId: owner,
          owner,
          availability: "missing",
          ownerPlanDigest: canonicalJsonDigest(missingOwnerDescriptor(
            owner,
            dependencies.filter((entry) => entry.owner === owner),
          )),
        })),
      ]
    : [{
        componentId: "config",
        owner: "config-writer",
        availability: "blocked",
        ownerPlanDigest: canonicalJsonDigest(configPlan),
      }];
  const confirmedActionPlan = aggregate?.payload.status === "ready"
    ? createWakeflowConfirmedActionPlan({
        aggregatePlan: aggregate,
        ownerSnapshots: [
          { componentId: "config", owner: "config-writer", snapshot: configPlan },
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
    kind: WAKEFLOW_RECONFIGURE_KIND,
    schemaVersion: WAKEFLOW_RECONFIGURE_SCHEMA_VERSION,
    action: "reconfigure",
    status: aggregate?.payload.status ?? "blocked",
    hostEffectsAllowed: false,
    programId: desired.program.programId,
    host: {
      hostId: normalizedHost.hostId,
      profileDigest: canonicalJsonDigest(normalizedHost),
    },
    config: {
      status: configPlan.payload.status,
      disposition: configPlan.payload.disposition,
      sourceModelDigest: configPlan.payload.sourceModelDigest,
      desiredModelDigest: configPlan.payload.modelDigest,
      ownerPlanDigest: canonicalJsonDigest(configPlan),
    },
    topologyDiff: diff,
    preservation: diff === null ? [] : preservation(diff),
    dependencyMatrix: [
      ...dependencies,
      ...(windowRuntimeSourceBlocker === null ? [] : [{
        owner: windowRuntimeSourceBlocker.owner,
        subject: windowRuntimeSourceBlocker.subject,
        status: "blocked",
        code: windowRuntimeSourceBlocker.code,
      }]),
      ...(supportProjection?.dependencyChecks ?? []).map((entry) => ({
        owner: entry.owner,
        subject: entry.subject,
        status: entry.status,
        code: entry.code,
      })),
      ...(ledgerProjection?.dependencyChecks ?? []).map((entry) => ({
        owner: entry.owner,
        subject: entry.subject,
        status: entry.status,
        code: entry.code,
      })),
      ...(managedProjection?.dependencyChecks ?? []).map((entry) => ({
        owner: entry.owner,
        subject: entry.subject,
        status: entry.status,
        code: entry.code,
      })),
    ].sort((left, right) => lexicalCompare(
      `${left.owner}:${subjectKey(left.subject)}:${left.code}`,
      `${right.owner}:${subjectKey(right.subject)}:${right.code}`,
    )),
    ownerGraph: owners.sort((left, right) => lexicalCompare(left.componentId, right.componentId)),
    blockers,
    aggregatePlan: aggregate,
    aggregatePlanDigest: aggregate === null ? null : wakeflowMaintenancePlanDigest(aggregate),
    confirmedActionPlan,
  };
  const snapshot = canonicalSnapshot(result, "reconfigure backbone plan");
  if (canonicalJson(snapshot).includes(path.resolve(input.workspaceRoot))) {
    fail("wakeflow-reconfigure-private-data", "reconfigure plan leaked its absolute workspace root");
  }
  return deepFreeze(snapshot);
}
