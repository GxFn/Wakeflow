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
  createWakeflowMigrationConfigTransitionScope,
  withWakeflowMigrationConfigTransitionScope,
} from "./wakeflow-config-v3-transition-authority.mjs";
import {
  parseWakeflowConfigV3,
} from "./wakeflow-config-v3.mjs";
import {
  planWakeflowMigrationMaterializationBackbone,
} from "./wakeflow-fresh-initialize.mjs";
import {
  createWakeflowHostSettingsAssetsOwnerMutationParticipant,
} from "./wakeflow-host-settings-assets-owner.mjs";
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
  WAKEFLOW_MIGRATION_APPLY_PHASES,
  createWakeflowMigrationMutationParticipant,
  planWakeflowMigrationApply,
  runWakeflowMigrationApply,
  validateWakeflowMigrationApplyPlan,
} from "./wakeflow-migration-apply.mjs";
import {
  assertWakeflowMigrationConfigOwnerPlanAgainstMigrationPlan,
  createWakeflowMigrationConfigOwnerParticipant,
  planWakeflowMigrationConfigOwner,
} from "./wakeflow-migration-config-owner.mjs";
import {
  validateWakeflowMigrationPlan,
} from "./wakeflow-migration-plan.mjs";
import {
  createWakeflowSupportSurfaceMutationParticipant,
} from "./wakeflow-support-surface-owner.mjs";
import {
  assertParsedWakeflowAssetBundle,
} from "./wakeflow-template-renderer.mjs";
import {
  createWindowRuntimeProjectionMutationParticipant,
} from "./wakeflow-window-runtime-projector.mjs";
import {
  recoverWakeflowWorkspaceMutation,
} from "./wakeflow-workspace-mutation.mjs";

/**
 * config-only production migration 总装层。
 *
 * 职责导航：
 * 1. 把T05 config-only计划、config物理owner和fresh materialization backbone
 *    组合为五个D38 phase snapshot。
 * 2. 把完整恢复种子只放入target-authority phase，并可离线重建同一composition。
 * 3. 为apply/recovery重建全部materialization owner，再适配到shared migration与唯一M3。
 * 4. 明确阻断尚未接线的host decommission、legacy archive和manual cohort。
 *
 * 本文件不扫描legacy source、不实现任何宿主effect、不拥有文件写入，也不把迁移完成
 * 提升为宿主激活证明。恢复是按checkpoint前向完成，不提供跨phase回滚。
 */
export const WAKEFLOW_PRODUCTION_MIGRATION_KIND = "WakeflowProductionMigrationComposition";
export const WAKEFLOW_PRODUCTION_MIGRATION_SCHEMA_VERSION = 1;
export const WAKEFLOW_PRODUCTION_MIGRATION_PHASE_SCHEMA_ID =
  "urn:wakeflow:internal:migration-production-phase-plan:v1";

const DERIVED_COMPONENTS = new Set([
  "active-projection",
  "window-runtime-projection",
]);
const PHASE_OWNER_IDS = Object.freeze({
  "target-authority": "migration-target-authority",
  "archive-or-preservation": "migration-archive-preservation",
  "managed-surfaces": "migration-managed-surfaces",
  "derived-projections": "migration-derived-projections",
  "exact-source-release": "migration-exact-source-release",
});

// ==================== 一、组合合同与首发cohort边界 ====================

export class WakeflowProductionMigrationError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowProductionMigrationError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { details = {}, cause } = {}) {
  throw new WakeflowProductionMigrationError(code, message, { details, cause });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!plainObject(value)) fail("wakeflow-production-migration-contract", `${label} must be one plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) fail("wakeflow-production-migration-contract", `${label} has an invalid field set`);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-production-migration-contract", `${label}.${key} must be an enumerable data field`);
    }
  }
  return value;
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function normalizedRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail("wakeflow-production-migration-root", "workspaceRoot must be one normalized absolute path");
  return value;
}

function canonicalSnapshot(value, label, code = "wakeflow-production-migration-plan") {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(code, `${label} must be passive canonical JSON data`, { cause });
  }
}

function blockedComposition(migrationPlan, reasonCodes) {
  const migrationApplyPlan = planWakeflowMigrationApply({
    migrationPlan,
    hostPlans: [],
    hostEffectSnapshots: [],
    manualAcknowledgements: [],
    phaseSnapshots: [],
  });
  return deepFreeze({
    kind: WAKEFLOW_PRODUCTION_MIGRATION_KIND,
    schemaVersion: WAKEFLOW_PRODUCTION_MIGRATION_SCHEMA_VERSION,
    status: "blocked",
    reasonCodes: [...new Set(reasonCodes)].sort(lexicalCompare),
    migrationPlanDigest: migrationPlan.planDigest,
    configOwnerPlan: null,
    confirmedActionPlan: null,
    migrationApplyPlan,
    migrationApplyPlanDigest: canonicalJsonDigest(migrationApplyPlan),
  });
}

function configOnlyCohortReasons(migrationPlan) {
  const reasons = [];
  const sources = migrationPlan.payload.sources;
  const units = sources.flatMap((source) => source.units);
  const physicalUnits = migrationPlan.payload.commitPhases.flatMap((phase) => phase.unitIds);
  const targetPhase = migrationPlan.payload.commitPhases.find((phase) => phase.phase === "target-authority");
  if (migrationPlan.payload.status !== "ready") reasons.push("migration-plan-blocked");
  if (migrationPlan.payload.decommissionCoverage.length !== 0) reasons.push("migration-host-effect-required");
  if (migrationPlan.payload.legacyArchiveTransform !== null) reasons.push("migration-archive-transform-required");
  if (migrationPlan.payload.blockers.length !== 0) reasons.push("migration-upstream-blocker-present");
  if (sources.length !== 1 || sources[0]?.path !== "wakeflow.config.json") {
    reasons.push("migration-non-config-source-present");
  }
  if (
    units.length !== 1
    || units[0]?.action !== "transform"
    || units[0]?.route !== "schema-map"
    || units[0]?.target?.ref !== "wakeflow.config.json"
  ) reasons.push("migration-config-unit-unsupported");
  if (
    physicalUnits.length !== 1
    || targetPhase?.unitIds.length !== 1
    || physicalUnits[0] !== units[0]?.unitId
  ) reasons.push("migration-phase-coverage-unsupported");
  if (units.some((unit) => unit.action === "manual")) reasons.push("migration-manual-unit-present");
  return [...new Set(reasons)].sort(lexicalCompare);
}

// ==================== 二、五阶段快照与零写production preview ====================

function transitionScope(workspaceRoot, configOwnerPlan) {
  return createWakeflowMigrationConfigTransitionScope({
    workspaceRoot,
    sourceDigest: configOwnerPlan.payload.source.digest,
    desiredModel: configOwnerPlan.payload.desiredModel,
  });
}

function phaseForLayoutEntry(entry) {
  if (entry.key === "workspace.config" || entry.owner === "config-service") {
    return "target-authority";
  }
  if (entry.owner === "active-projector" || entry.owner === "runtime-projection-builder") {
    return "derived-projections";
  }
  return "managed-surfaces";
}

function phaseSnapshot({
  phase,
  steps,
  materializationPlanDigest,
  configOwnerPlanDigest,
  recoverySeed,
}) {
  return {
    schemaId: WAKEFLOW_PRODUCTION_MIGRATION_PHASE_SCHEMA_ID,
    payload: {
      kind: "WakeflowProductionMigrationPhasePlan",
      schemaVersion: 1,
      phase,
      materializationPlanDigest,
      configOwnerPlanDigest,
      recoverySeed,
      steps: steps.map((step, ordinal) => ({ ...step, ordinal })),
    },
  };
}

function composePhaseSnapshots(migrationPlan, configOwnerPlan, materializationBackbone) {
  const confirmed = validateWakeflowConfirmedActionPlan(materializationBackbone.confirmedActionPlan);
  const aggregate = confirmed.payload.aggregatePlan;
  const actionByStep = new Map(
    aggregate.payload.filesystemActions
      .filter((entry) => entry.stepId !== null)
      .map((entry) => [entry.stepId, entry]),
  );
  const steps = new Map(WAKEFLOW_MIGRATION_APPLY_PHASES.map((phase) => [phase, []]));
  for (const step of aggregate.payload.steps) {
    const action = actionByStep.get(step.stepId);
    if (!action) fail("wakeflow-production-migration-steps", "materialization step lacks one exact action");
    const phase = action.componentId === "config"
      ? "target-authority"
      : DERIVED_COMPONENTS.has(action.componentId)
        ? "derived-projections"
        : "managed-surfaces";
    steps.get(phase).push(step);
  }
  steps.get("exact-source-release").push(configOwnerPlan.payload.releaseStep);
  const targetKeysByPhase = new Map(WAKEFLOW_MIGRATION_APPLY_PHASES.map((phase) => [phase, []]));
  for (const entry of migrationPlan.payload.target.layoutEntries) {
    targetKeysByPhase.get(phaseForLayoutEntry(entry)).push(entry.key);
  }
  const unitsByPhase = new Map(
    migrationPlan.payload.commitPhases.map((entry) => [entry.phase, entry.unitIds]),
  );
  const unresolvedDependencies = migrationPlan.payload.dependencies
    .filter((entry) => entry.status !== "satisfied")
    .map((entry) => entry.dependencyId)
    .sort(lexicalCompare);
  const materializationPlanDigest = confirmed.payload.aggregatePlanDigest;
  const configOwnerPlanDigest = canonicalJsonDigest(configOwnerPlan);
  return WAKEFLOW_MIGRATION_APPLY_PHASES.map((phase) => ({
    phase,
    ownerId: PHASE_OWNER_IDS[phase],
    snapshot: phaseSnapshot({
      phase,
      steps: steps.get(phase),
      materializationPlanDigest,
      configOwnerPlanDigest,
      recoverySeed: phase === "target-authority"
        ? {
            configOwnerPlan,
            confirmedActionPlan: confirmed,
          }
        : null,
    }),
    unitIds: unitsByPhase.get(phase) ?? [],
    targetKeys: targetKeysByPhase.get(phase).sort(lexicalCompare),
    blockerIds: [],
    dependencyIds: phase === "exact-source-release" ? unresolvedDependencies : [],
    manualUnitIds: [],
  }));
}

function readyComposition({ migrationPlan, configOwnerPlan, confirmedActionPlan, migrationApplyPlan }) {
  return deepFreeze({
    kind: WAKEFLOW_PRODUCTION_MIGRATION_KIND,
    schemaVersion: WAKEFLOW_PRODUCTION_MIGRATION_SCHEMA_VERSION,
    status: "ready",
    reasonCodes: [],
    migrationPlanDigest: migrationPlan.planDigest,
    configOwnerPlan,
    confirmedActionPlan,
    migrationApplyPlan,
    migrationApplyPlanDigest: canonicalJsonDigest(migrationApplyPlan),
  });
}

function planReadyComposition({ workspaceRoot, migrationPlan, hostProfile, bundle, hostSettingsAssetsAdapter }) {
  let configOwnerPlan;
  let materializationBackbone;
  try {
    configOwnerPlan = planWakeflowMigrationConfigOwner({ workspaceRoot, migrationPlan });
    const scope = transitionScope(workspaceRoot, configOwnerPlan);
    materializationBackbone = withWakeflowMigrationConfigTransitionScope(
      scope,
      () => planWakeflowMigrationMaterializationBackbone({
        workspaceRoot,
        desiredModel: migrationPlan.payload.target.desiredModel,
        hostProfile,
        bundle,
        language: migrationPlan.payload.target.desiredModel.program.interfaceLanguage,
        ...(hostSettingsAssetsAdapter === null ? {} : { hostSettingsAssetsAdapter }),
        configOwnerPlan,
        configSourceAuthority: {
          programId: configOwnerPlan.payload.programId,
          modelDigest: configOwnerPlan.payload.sourceAuthorityDigest,
        },
      }),
    );
  } catch (cause) {
    return blockedComposition(migrationPlan, [
      cause?.code ?? "migration-production-owner-plan-unavailable",
    ]);
  }
  if (materializationBackbone.status !== "ready" || materializationBackbone.confirmedActionPlan === null) {
    return blockedComposition(migrationPlan, [
      "migration-production-materialization-blocked",
      ...materializationBackbone.blockers.map((entry) => entry.code),
    ]);
  }
  const phaseSnapshots = composePhaseSnapshots(
    migrationPlan,
    configOwnerPlan,
    materializationBackbone,
  );
  const migrationApplyPlan = planWakeflowMigrationApply({
    migrationPlan,
    hostPlans: [],
    hostEffectSnapshots: [],
    manualAcknowledgements: [],
    phaseSnapshots,
  });
  if (migrationApplyPlan.payload.status !== "ready") {
    return deepFreeze({
      kind: WAKEFLOW_PRODUCTION_MIGRATION_KIND,
      schemaVersion: WAKEFLOW_PRODUCTION_MIGRATION_SCHEMA_VERSION,
      status: "blocked",
      reasonCodes: migrationApplyPlan.payload.issues.map((entry) => entry.code).sort(lexicalCompare),
      migrationPlanDigest: migrationPlan.planDigest,
      configOwnerPlan,
      confirmedActionPlan: materializationBackbone.confirmedActionPlan,
      migrationApplyPlan,
      migrationApplyPlanDigest: canonicalJsonDigest(migrationApplyPlan),
    });
  }
  return readyComposition({
    migrationPlan,
    configOwnerPlan,
    confirmedActionPlan: materializationBackbone.confirmedActionPlan,
    migrationApplyPlan,
  });
}

/**
 * 生成零写production composition。当前只支持唯一legacy config schema-map cohort；
 * 任何host effect、archive transform、manual unit或额外source都会返回blocked。
 */
export function planWakeflowProductionMigration(value = {}) {
  exactKeys(
    value,
    ["workspaceRoot", "migrationPlan", "hostProfile", "bundle", "hostSettingsAssetsAdapter"],
    "production migration planning input",
  );
  const workspaceRoot = normalizedRoot(value.workspaceRoot);
  const migrationPlan = validateWakeflowMigrationPlan(value.migrationPlan);
  assertParsedWakeflowAssetBundle(value.bundle);
  if (value.hostSettingsAssetsAdapter !== null && !plainObject(value.hostSettingsAssetsAdapter)) {
    fail("wakeflow-production-migration-host", "host settings/assets adapter is invalid");
  }
  const reasons = configOnlyCohortReasons(migrationPlan);
  if (reasons.length > 0) return blockedComposition(migrationPlan, reasons);
  return planReadyComposition({
    workspaceRoot,
    migrationPlan,
    hostProfile: value.hostProfile,
    bundle: value.bundle,
    hostSettingsAssetsAdapter: value.hostSettingsAssetsAdapter,
  });
}

// ==================== 三、持久恢复种子与composition重建 ====================

function productionRecoverySeed(migrationApplyPlan) {
  const confirmedApply = validateWakeflowMigrationApplyPlan(migrationApplyPlan);
  if (confirmedApply.payload.status !== "ready") {
    fail("wakeflow-production-migration-plan", "only one ready migration apply plan can restore production owners");
  }
  let seed = null;
  for (const entry of confirmedApply.payload.phaseSnapshots) {
    if (
      entry.ownerId !== PHASE_OWNER_IDS[entry.phase]
      || entry.snapshot.schemaId !== WAKEFLOW_PRODUCTION_MIGRATION_PHASE_SCHEMA_ID
    ) fail("wakeflow-production-migration-phase", `${entry.phase} is not a production phase snapshot`);
    exactKeys(entry.snapshot.payload, [
      "kind",
      "schemaVersion",
      "phase",
      "materializationPlanDigest",
      "configOwnerPlanDigest",
      "recoverySeed",
      "steps",
    ], `${entry.phase} production phase payload`);
    if (
      entry.snapshot.payload.kind !== "WakeflowProductionMigrationPhasePlan"
      || entry.snapshot.payload.schemaVersion !== 1
      || entry.snapshot.payload.phase !== entry.phase
    ) fail("wakeflow-production-migration-phase", `${entry.phase} phase identity is invalid`);
    if (entry.phase === "target-authority") {
      exactKeys(
        entry.snapshot.payload.recoverySeed,
        ["configOwnerPlan", "confirmedActionPlan"],
        "production recovery seed",
      );
      seed = entry.snapshot.payload.recoverySeed;
    } else if (entry.snapshot.payload.recoverySeed !== null) {
      fail("wakeflow-production-migration-phase", `${entry.phase} must not duplicate the recovery seed`);
    }
  }
  if (seed === null) fail("wakeflow-production-migration-plan", "production recovery seed is absent");
  const configOwnerPlan = assertWakeflowMigrationConfigOwnerPlanAgainstMigrationPlan({
    migrationPlan: confirmedApply.payload.migrationPlan,
    plan: seed.configOwnerPlan,
  });
  const confirmedActionPlan = validateWakeflowConfirmedActionPlan(seed.confirmedActionPlan);
  const configOwnerPlanDigest = canonicalJsonDigest(configOwnerPlan);
  for (const entry of confirmedApply.payload.phaseSnapshots) {
    if (
      entry.snapshot.payload.configOwnerPlanDigest !== configOwnerPlanDigest
      || entry.snapshot.payload.materializationPlanDigest
        !== confirmedActionPlan.payload.aggregatePlanDigest
    ) fail("wakeflow-production-migration-phase", "production phase owner digests disagree");
  }
  const expectedPhaseSnapshots = composePhaseSnapshots(
    confirmedApply.payload.migrationPlan,
    configOwnerPlan,
    { confirmedActionPlan },
  );
  const expectedApply = planWakeflowMigrationApply({
    migrationPlan: confirmedApply.payload.migrationPlan,
    hostPlans: [],
    hostEffectSnapshots: [],
    manualAcknowledgements: [],
    phaseSnapshots: expectedPhaseSnapshots,
  });
  if (!sameCanonical(expectedApply, confirmedApply)) {
    fail("wakeflow-production-migration-plan", "production phase graph differs from its frozen owner seed");
  }
  return { confirmedApply, configOwnerPlan, confirmedActionPlan };
}

/**
 * 只从migration apply plan内嵌的恢复种子重建同一ready composition。
 * 不读取workspace、不重新规划，也不接收调用方另行提供的owner plan。
 */
export function restoreWakeflowProductionMigrationComposition(value = {}) {
  exactKeys(value, ["migrationApplyPlan"], "production migration restoration input");
  const {
    confirmedApply,
    configOwnerPlan,
    confirmedActionPlan,
  } = productionRecoverySeed(value.migrationApplyPlan);
  return readyComposition({
    migrationPlan: confirmedApply.payload.migrationPlan,
    configOwnerPlan,
    confirmedActionPlan,
    migrationApplyPlan: confirmedApply,
  });
}

function confirmReadyComposition(value) {
  const candidate = canonicalSnapshot(value, "production migration composition");
  exactKeys(candidate, [
    "kind",
    "schemaVersion",
    "status",
    "reasonCodes",
    "migrationPlanDigest",
    "configOwnerPlan",
    "confirmedActionPlan",
    "migrationApplyPlan",
    "migrationApplyPlanDigest",
  ], "production migration composition");
  if (
    candidate.kind !== WAKEFLOW_PRODUCTION_MIGRATION_KIND
    || candidate.schemaVersion !== WAKEFLOW_PRODUCTION_MIGRATION_SCHEMA_VERSION
    || candidate.status !== "ready"
    || !Array.isArray(candidate.reasonCodes)
    || candidate.reasonCodes.length !== 0
  ) fail("wakeflow-production-migration-plan", "only one ready production composition can execute");
  const restored = restoreWakeflowProductionMigrationComposition({
    migrationApplyPlan: candidate.migrationApplyPlan,
  });
  if (!sameCanonical(restored, candidate)) {
    fail("wakeflow-production-migration-plan", "production composition differs from its frozen apply plan");
  }
  return restored;
}

// 上层preview只能在M3建协议树之前重跑一次；持锁后的真实复查由各物理owner完成，
// 否则M3自己的maintenance目录会被零残留preview正确识别为非初始状态。
function assertCurrentComposition(replan, confirmed) {
  let raw;
  try {
    raw = replan();
  } catch (cause) {
    fail("wakeflow-production-migration-stale", "production migration composition cannot be reconstructed", {
      cause,
    });
  }
  let current;
  try {
    current = confirmReadyComposition(raw);
  } catch (cause) {
    fail("wakeflow-production-migration-stale", "production migration replan is not one exact composition", {
      cause,
    });
  }
  if (!sameCanonical(current, confirmed)) {
    fail("wakeflow-production-migration-stale", "production migration composition changed before admission");
  }
  return confirmed;
}

// ==================== 四、materialization owner图与phase适配 ====================

function snapshotByComponent(confirmed) {
  return new Map(confirmed.payload.ownerSnapshots.map((entry) => [entry.componentId, entry]));
}

function requiredSnapshot(byComponent, componentId) {
  const entry = byComponent.get(componentId);
  if (!entry) fail("wakeflow-production-migration-owner", `materialization lacks ${componentId}`);
  return entry;
}

function materializationOwnerParticipants({
  workspaceRoot,
  confirmed,
  configParticipant,
  hostProfile,
  bundle,
  hostSettingsAssetsAdapter,
}) {
  const desiredModel = parseWakeflowConfigV3(
    requiredSnapshot(snapshotByComponent(confirmed), "config").snapshot.payload.desiredModel,
  );
  const byComponent = snapshotByComponent(confirmed);
  const descriptor = createWakeflowLayoutDescriptor({ model: desiredModel, hostProfile });
  const supportPlan = requiredSnapshot(byComponent, "support-surface").snapshot;
  const localPlan = byComponent.get("local-layout")?.snapshot ?? null;
  const managedPlan = requiredSnapshot(byComponent, "ignore").snapshot;
  const definitions = [];
  const add = (componentId, participant) => {
    const entry = requiredSnapshot(byComponent, componentId);
    definitions.push({ snapshotDigest: entry.snapshotDigest, participant });
  };
  add("config", configParticipant);
  add("support-surface", createWakeflowSupportSurfaceMutationParticipant({
    workspaceRoot,
    action: "fresh-initialize",
    sourceModel: null,
    desiredModel,
    layoutDescriptor: descriptor,
    hostProfile,
    confirmedPlan: supportPlan,
  }));
  add("ledger-layout", createWakeflowLedgerMaterializationMutationParticipant({
    workspaceRoot,
    action: "fresh-initialize",
    sourceModel: null,
    desiredModel,
    confirmedPlan: requiredSnapshot(byComponent, "ledger-layout").snapshot,
  }));
  add("ignore", createWakeflowManagedContentMutationParticipant({
    workspaceRoot,
    action: "fresh-initialize",
    sourceModel: null,
    desiredModel,
    hostProfile,
    authorizedRepositoryIds: [],
    plannedSupportSurfaceIds: supportPlan.payload.plannedSupportSurfaceIds,
    confirmedPlan: managedPlan,
  }));
  add("active-layout", createWakeflowActiveFoundationMutationParticipant({
    workspaceRoot,
    action: "fresh-initialize",
    sourceModel: null,
    desiredModel,
    confirmedPlan: requiredSnapshot(byComponent, "active-layout").snapshot,
  }));
  add("active-projection", createWakeflowActiveProjectionMutationParticipant({
    workspaceRoot,
    action: "fresh-initialize",
    sourceModel: null,
    desiredModel,
    bundle,
    language: desiredModel.program.interfaceLanguage,
    confirmedPlan: requiredSnapshot(byComponent, "active-projection").snapshot,
  }));
  add("window-runtime-projection", createWindowRuntimeProjectionMutationParticipant({
    workspaceRoot,
    action: "fresh-initialize",
    sourceModel: null,
    desiredModel,
    hostProfile,
    confirmedPlan: requiredSnapshot(byComponent, "window-runtime-projection").snapshot,
  }));
  if (localPlan !== null) {
    add("local-layout", createWakeflowLocalLayoutMutationParticipant({
      workspaceRoot,
      confirmedPlan: localPlan,
      model: desiredModel,
      layoutDescriptor: descriptor,
      hostProfile,
    }));
  }
  if (byComponent.has("host-settings-assets")) {
    add("host-settings-assets", createWakeflowHostSettingsAssetsOwnerMutationParticipant({
      workspaceRoot,
      action: "fresh-initialize",
      sourceModel: null,
      desiredModel,
      hostProfile,
      authorizedRepositoryIds: [],
      localPlan,
      supportPlan,
      managedPlan,
      adapter: hostSettingsAssetsAdapter,
      confirmedPlan: requiredSnapshot(byComponent, "host-settings-assets").snapshot,
    }));
  }
  const expected = new Set(confirmed.payload.ownerSnapshots.map((entry) => entry.snapshotDigest));
  const actual = new Set(definitions.map((entry) => entry.snapshotDigest));
  if (expected.size !== actual.size || [...expected].some((digest) => !actual.has(digest))) {
    fail("wakeflow-production-migration-owner", "materialization participants do not cover every owner snapshot");
  }
  return definitions;
}

// phase snapshot使用portable aggregate step；回调执行时恢复原materialization plan/step，
// 并只在动态调用区间开放config transition scope。
function wrapHandlerWithScope(handler, scope, fullPlan, originalStep) {
  const wrapped = {};
  for (const callback of Reflect.ownKeys(handler)) {
    wrapped[callback] = (args) => withWakeflowMigrationConfigTransitionScope(
      scope,
      () => handler[callback]({ ...args, plan: fullPlan, step: originalStep }),
    );
  }
  return Object.freeze(wrapped);
}

function phaseParticipants({ composition, fullParticipant, configParticipant, scope, admission }) {
  const confirmedApply = validateWakeflowMigrationApplyPlan(composition.migrationApplyPlan);
  const confirmedAction = validateWakeflowConfirmedActionPlan(
    composition.confirmedActionPlan,
  );
  const fullPlan = confirmedAction.payload.aggregatePlan;
  const fullPlanDigest = confirmedAction.payload.aggregatePlanDigest;
  const fullSteps = new Map(fullPlan.payload.steps.map((step) => [step.stepId, step]));
  return confirmedApply.payload.phaseSnapshots.map((entry) => {
    const phaseSnapshotDigest = entry.snapshotDigest;
    const handlers = {};
    for (const phaseStep of entry.snapshot.payload.steps) {
      if (phaseStep.stepId === configParticipant.release.step.stepId) {
        handlers[phaseStep.stepId] = wrapHandlerWithScope(
          configParticipant.release.handler,
          scope,
          entry.snapshot,
          configParticipant.release.step,
        );
        continue;
      }
      const originalStep = fullSteps.get(phaseStep.stepId);
      const handler = fullParticipant.stepHandlers[phaseStep.stepId];
      if (!originalStep || !handler) {
        fail("wakeflow-production-migration-owner", "phase step lacks its materialization owner");
      }
      handlers[phaseStep.stepId] = wrapHandlerWithScope(handler, scope, fullPlan, originalStep);
    }
    const participant = Object.freeze({
      validatePlan({ plan }) {
        if (!sameCanonical(plan, entry.snapshot)) {
          fail("wakeflow-production-migration-phase", `${entry.phase} received another phase snapshot`);
        }
        return { valid: true };
      },
      async deriveCurrentPlan({ context }) {
        // Recovery的journal checkpoint和每个step observer才知道当前phase进度；这里不能
        // 提前要求未来owner的ancestor已经创建。后续step逐项fail closed，terminal再全量闭合。
        if (admission === "recovery") return entry.snapshot;
        await withWakeflowMigrationConfigTransitionScope(
          scope,
          () => fullParticipant.deriveCurrentPlan({ context }),
        );
        return entry.snapshot;
      },
      async deriveTerminalClosure({ context, plan, planDigest }) {
        if (!sameCanonical(plan, entry.snapshot) || planDigest !== phaseSnapshotDigest) {
          fail("wakeflow-production-migration-phase", `${entry.phase} closure received another plan`);
        }
        const closure = await withWakeflowMigrationConfigTransitionScope(
          scope,
          () => fullParticipant.deriveTerminalClosure({
            context,
            plan: fullPlan,
            planDigest: fullPlanDigest,
          }),
        );
        return {
          planDigest,
          closureDigests: [{
            name: `migration-phase-${entry.phase}`,
            digest: canonicalJsonDigest({ phase: entry.phase, closure }),
          }],
        };
      },
      stepHandlers: Object.freeze(handlers),
    });
    return { phase: entry.phase, snapshotDigest: phaseSnapshotDigest, participant };
  });
}

/**
 * 从一个exact ready composition重建shared migration participant。
 * apply先在栅栏外复算一次composition，再由M3栅栏内的owner观察关闭TOCTOU；
 * recovery禁止replan，只使用journal绑定的phase图前向完成。
 */
export function createWakeflowProductionMigrationParticipant(value = {}) {
  exactKeys(value, [
    "workspaceRoot",
    "composition",
    "hostProfile",
    "bundle",
    "hostSettingsAssetsAdapter",
    "admission",
    "replan",
  ], "production migration participant input");
  const workspaceRoot = normalizedRoot(value.workspaceRoot);
  const admission = value.admission;
  const replan = value.replan;
  const hostProfile = value.hostProfile;
  const bundle = value.bundle;
  const hostSettingsAssetsAdapter = value.hostSettingsAssetsAdapter;
  if (!new Set(["apply", "recovery"]).has(admission)) {
    fail("wakeflow-production-migration-admission", "admission must be apply or recovery");
  }
  if ((admission === "apply") !== (typeof replan === "function")) {
    fail("wakeflow-production-migration-admission", "apply requires replan while recovery requires null");
  }
  const composition = confirmReadyComposition(value.composition);
  if (admission === "apply") assertCurrentComposition(replan, composition);
  const configOwnerPlan = assertWakeflowMigrationConfigOwnerPlanAgainstMigrationPlan({
    migrationPlan: composition.migrationApplyPlan.payload.migrationPlan,
    plan: composition.configOwnerPlan,
  });
  const confirmedAction = validateWakeflowConfirmedActionPlan(
    composition.confirmedActionPlan,
  );
  assertParsedWakeflowAssetBundle(bundle);
  const scope = transitionScope(workspaceRoot, configOwnerPlan);
  const configParticipant = createWakeflowMigrationConfigOwnerParticipant({
    workspaceRoot,
    confirmedPlan: configOwnerPlan,
    admission,
  });
  const ownerParticipants = withWakeflowMigrationConfigTransitionScope(
    scope,
    () => materializationOwnerParticipants({
      workspaceRoot,
      confirmed: confirmedAction,
      configParticipant,
      hostProfile,
      bundle,
      hostSettingsAssetsAdapter,
    }),
  );
  const fullParticipant = createWakeflowMaintenanceActionMutationParticipant({
    workspaceRoot,
    admission,
    confirmedActionPlan: confirmedAction,
    ownerParticipants,
    replan: admission === "apply"
      ? () => composition.confirmedActionPlan
      : null,
  });
  const phases = phaseParticipants({
    composition,
    fullParticipant,
    configParticipant,
    scope,
    admission,
  });
  return createWakeflowMigrationMutationParticipant({
    workspaceRoot,
    admission,
    confirmedPlan: composition.migrationApplyPlan,
    hostEffectParticipants: [],
    phaseParticipants: phases,
    replan: admission === "apply"
      ? () => composition.migrationApplyPlan
      : null,
  });
}

// ==================== 五、唯一production apply/recovery入口 ====================

/** 通过shared migration participant进入唯一M3 maintenance journal。 */
export async function runWakeflowProductionMigrationApply(value = {}) {
  exactKeys(value, [
    "workspaceRoot",
    "composition",
    "hostProfile",
    "bundle",
    "hostSettingsAssetsAdapter",
    "replan",
  ], "production migration apply input");
  const workspaceRoot = value.workspaceRoot;
  const composition = confirmReadyComposition(value.composition);
  const hostProfile = value.hostProfile;
  const bundle = value.bundle;
  const hostSettingsAssetsAdapter = value.hostSettingsAssetsAdapter;
  const replan = value.replan;
  const participant = createWakeflowProductionMigrationParticipant({
    workspaceRoot,
    composition,
    hostProfile,
    bundle,
    hostSettingsAssetsAdapter,
    replan,
    admission: "apply",
  });
  return runWakeflowMigrationApply({
    workspaceRoot,
    confirmedPlan: composition.migrationApplyPlan,
    planDigest: composition.migrationApplyPlanDigest,
    participant,
  });
}

/**
 * 用离线恢复的同一composition接管既有operation；不重扫、重规划或回滚已提交phase。
 */
export async function recoverWakeflowProductionMigration(value = {}) {
  exactKeys(value, [
    "workspaceRoot",
    "operationId",
    "composition",
    "hostProfile",
    "bundle",
    "hostSettingsAssetsAdapter",
  ], "production migration recovery input");
  const workspaceRoot = value.workspaceRoot;
  const operationId = value.operationId;
  const composition = confirmReadyComposition(value.composition);
  const hostProfile = value.hostProfile;
  const bundle = value.bundle;
  const hostSettingsAssetsAdapter = value.hostSettingsAssetsAdapter;
  const participant = createWakeflowProductionMigrationParticipant({
    workspaceRoot,
    composition,
    hostProfile,
    bundle,
    hostSettingsAssetsAdapter,
    admission: "recovery",
    replan: null,
  });
  return recoverWakeflowWorkspaceMutation({
    workspaceRoot,
    operationId,
    confirmedPlan: composition.migrationApplyPlan,
    planDigest: composition.migrationApplyPlanDigest,
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
}
