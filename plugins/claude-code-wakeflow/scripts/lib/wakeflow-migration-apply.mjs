import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  assertMigrationHostDecommissionPlanAgainstMigrationPlan,
  validateMigrationHostDecommissionPlan,
} from "./wakeflow-migration-host-decommission.mjs";
import {
  validateWakeflowMigrationPlan,
} from "./wakeflow-migration-plan.mjs";
import {
  assertWakeflowMutationContext,
  inspectWakeflowMaintenancePersistenceBudget,
  runWakeflowMaintenanceMutation,
} from "./wakeflow-workspace-mutation.mjs";

/**
 * 显式迁移的T08领域组合层。
 *
 * 职责导航：
 * 1. 把T05 migration plan、T07 host plan/effect snapshot与五个phase owner snapshot
 *    组合为唯一、可持久化的explicit-migration confirmed plan。
 * 2. 在执行前冻结owner participant及step callback引用，并把owner-local ordinal映射到
 *    aggregate ordinal；调用方准入后的对象替换不能改变journal真正执行的代码。
 * 3. apply只允许gate内重建出同一完整计划；recovery只消费journal已经绑定的计划，
 *    不借恢复重新规划或重发不可逆宿主effect。
 * 4. 物理gate、journal、checkpoint、effect outcome和resume-forward仍由workspace mutation
 *    manager拥有；本文件不扫描legacy source，也不实现Codex/Claude宿主API。
 */

export const WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_ID =
  "urn:wakeflow:internal:migration-apply-plan:v1";
export const WAKEFLOW_MIGRATION_APPLY_PLAN_KIND = "WakeflowMigrationApplyPlan";
export const WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_VERSION = 1;
export const WAKEFLOW_MIGRATION_APPLY_PHASES = Object.freeze([
  "target-authority",
  "archive-or-preservation",
  "managed-surfaces",
  "derived-projections",
  "exact-source-release",
]);

const PHASE_SET = new Set(WAKEFLOW_MIGRATION_APPLY_PHASES);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TOKEN_RE = /^[a-z][a-z0-9-]{0,127}$/u;
const SCHEMA_ID_RE = /^urn:wakeflow:internal:[a-z0-9][a-z0-9:-]*:v[1-9][0-9]*$/u;
const STEP_KINDS = new Set(["create-or-update", "remove", "audit-publish", "owner-effect"]);
const MAX_PLAN_BYTES = 8 * 1024 * 1024;
const MAX_OWNER_CLOSURE_DIGESTS = 1_024;

// 一、错误、纯数据与容量准入。

export class WakeflowMigrationApplyError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowMigrationApplyError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowMigrationApplyError(code, message, {
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

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!plainObject(value)) fail("wakeflow-migration-apply-contract", `${label} must be one plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("wakeflow-migration-apply-contract", `${label} has an invalid field set`, {
      details: { actual: actual.map(String), expected },
    });
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-migration-apply-contract", `${label}.${key} must be an enumerable data property`);
    }
  }
  return value;
}

// 行为型数组不能进入计划或callback registry：先检查全部descriptor，再复制数据槽位。
function denseDataArray(value, label, { maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail("wakeflow-migration-apply-contract", `${label} must be one bounded array`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const index = typeof key === "string" ? Number(key) : Number.NaN;
    if (
      !Number.isInteger(index)
      || index < 0
      || index >= value.length
      || String(index) !== key
    ) fail("wakeflow-migration-apply-contract", `${label} has an invalid array field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-migration-apply-contract", `${label}/${String(key)} must be an enumerable data slot`);
    }
  }
  const entries = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-migration-apply-contract", `${label}/${index} must be one dense enumerable data slot`);
    }
    entries.push(descriptor.value);
  }
  return Object.freeze(entries);
}

function allowedKeys(value, allowed, label) {
  if (!plainObject(value)) {
    fail("wakeflow-migration-apply-contract", `${label} must be one plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      fail("wakeflow-migration-apply-contract", `${label} has an invalid field set`, {
        details: { actual: Reflect.ownKeys(value).map(String), allowed },
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-migration-apply-contract", `${label}.${String(key)} must be an enumerable data property`);
    }
  }
  return value;
}

function dataProperty(value, key, label, { required = true } = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined && !required) return undefined;
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail("wakeflow-migration-apply-contract", `${label}.${key} must be an enumerable data property`);
  }
  return descriptor.value;
}

function canonicalClone(value, label) {
  let encoded;
  try {
    encoded = canonicalJson(value);
  } catch (cause) {
    fail("wakeflow-migration-apply-canonical", `${label} must be canonical JSON data`, { cause });
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_PLAN_BYTES) {
    fail(
      "wakeflow-migration-apply-persistence-budget",
      `${label} exceeds the complete maintenance-journal persistence budget`,
    );
  }
  return JSON.parse(encoded);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function token(value, label) {
  if (typeof value !== "string" || !TOKEN_RE.test(value)) {
    fail("wakeflow-migration-apply-contract", `${label} must be one bounded lower-case token`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-migration-apply-contract", `${label} must be one canonical SHA-256 digest`);
  }
  return value;
}

function canonicalStrings(value, label, { allowed = null } = {}) {
  const entries = denseDataArray(value, label, {
    maximum: allowed === null ? Number.MAX_SAFE_INTEGER : allowed.size,
  }).map((entry, index) => {
    if (typeof entry !== "string" || !entry || /[\u0000-\u001f\u007f-\u009f]/u.test(entry)) {
      fail("wakeflow-migration-apply-contract", `${label}/${index} is invalid`);
    }
    if (allowed !== null && !allowed.has(entry)) {
      fail("wakeflow-migration-apply-coverage", `${label}/${index} references an unknown fact`);
    }
    return entry;
  });
  const sorted = [...new Set(entries)].sort(lexicalCompare);
  if (!sameCanonical(entries, sorted)) {
    fail("wakeflow-migration-apply-order", `${label} must be unique and lexically ordered`);
  }
  return entries;
}

function normalizeWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail("wakeflow-migration-apply-workspace", "workspaceRoot must be one normalized absolute path");
  return value;
}

// 将任意领域owner plan收敛为可持久化快照；具体业务语义稍后仍由该owner codec复验。
function normalizeOwnerPlan(value, label) {
  const snapshot = canonicalClone(value, label);
  exactKeys(snapshot, ["schemaId", "payload"], label);
  if (typeof snapshot.schemaId !== "string" || !SCHEMA_ID_RE.test(snapshot.schemaId)) {
    fail("wakeflow-migration-apply-owner-snapshot", `${label}.schemaId is invalid`);
  }
  if (!plainObject(snapshot.payload) || !Array.isArray(snapshot.payload.steps)) {
    fail("wakeflow-migration-apply-owner-snapshot", `${label}.payload.steps must be one array`);
  }
  const ids = new Set();
  snapshot.payload.steps.forEach((step, index) => {
    if (!plainObject(step) || step.ordinal !== index || !STEP_KINDS.has(step.stepKind)) {
      fail("wakeflow-migration-apply-owner-snapshot", `${label}.payload.steps/${index} is invalid`);
    }
    token(step.stepId, `${label}.payload.steps/${index}/stepId`);
    if (ids.has(step.stepId)) {
      fail("wakeflow-migration-apply-owner-snapshot", `${label} contains duplicate step IDs`);
    }
    ids.add(step.stepId);
  });
  return snapshot;
}

// 二、上游T05/T07事实、phase snapshot与manual gate归一化。

// 绑定一个phase可声明的unit/target/blocker/dependency集合，并闭合Task D专属owner身份。
function normalizePhaseSnapshot(value, index, facts) {
  exactKeys(value, [
    "phase",
    "ownerId",
    "snapshot",
    "unitIds",
    "targetKeys",
    "blockerIds",
    "dependencyIds",
    "manualUnitIds",
  ], `phaseSnapshots/${index}`);
  if (!PHASE_SET.has(value.phase)) {
    fail("wakeflow-migration-apply-phase", `phaseSnapshots/${index}.phase is invalid`);
  }
  token(value.ownerId, `phaseSnapshots/${index}.ownerId`);
  const snapshot = normalizeOwnerPlan(value.snapshot, `phaseSnapshots/${index}.snapshot`);
  const expectedUnits = facts.unitsByPhase.get(value.phase);
  const normalized = {
    phase: value.phase,
    ownerId: value.ownerId,
    snapshot,
    snapshotSchemaId: snapshot.schemaId,
    snapshotDigest: canonicalJsonDigest(snapshot),
    unitIds: canonicalStrings(value.unitIds, `phaseSnapshots/${index}.unitIds`, {
      allowed: new Set(expectedUnits),
    }),
    targetKeys: canonicalStrings(value.targetKeys, `phaseSnapshots/${index}.targetKeys`, {
      allowed: facts.targetKeys,
    }),
    blockerIds: canonicalStrings(value.blockerIds, `phaseSnapshots/${index}.blockerIds`, {
      allowed: facts.blockerIds,
    }),
    dependencyIds: canonicalStrings(value.dependencyIds, `phaseSnapshots/${index}.dependencyIds`, {
      allowed: facts.dependencyIds,
    }),
    manualUnitIds: canonicalStrings(value.manualUnitIds, `phaseSnapshots/${index}.manualUnitIds`, {
      allowed: facts.manualUnitIds,
    }),
  };
  if (value.phase === "archive-or-preservation" && facts.legacyArchiveTransform !== null) {
    if (
      normalized.ownerId !== facts.legacyArchiveTransform.ownerId
      || normalized.snapshotSchemaId !== facts.legacyArchiveTransform.ownerPlanSchemaId
      || normalized.snapshotDigest !== facts.legacyArchiveTransform.ownerPlanDigest
      || !sameCanonical(normalized.unitIds, facts.legacyArchiveTransformUnitIds)
      || !sameCanonical(expectedUnits, facts.legacyArchiveTransformUnitIds)
    ) {
      fail(
        "wakeflow-migration-apply-phase-owner",
        "archive-or-preservation phase differs from the exact Task D transform owner",
      );
    }
  }
  return normalized;
}

// 从T05计划提取apply组合真正消费的有限事实，不在这里重新决定migration action。
function migrationFacts(migrationPlan) {
  const unitsByPhase = new Map(WAKEFLOW_MIGRATION_APPLY_PHASES.map((phase) => [phase, []]));
  for (const [index, phase] of migrationPlan.payload.commitPhases.entries()) {
    if (phase.ordinal !== index || phase.phase !== WAKEFLOW_MIGRATION_APPLY_PHASES[index]) {
      fail("wakeflow-migration-apply-upstream", "migration commit phases differ from the frozen five-phase order");
    }
    unitsByPhase.set(phase.phase, phase.unitIds);
  }
  const legacyArchiveTransform = migrationPlan.payload.legacyArchiveTransform;
  const legacyArchiveTransformUnitIds = migrationPlan.payload.sources
    .flatMap((source) => source.units)
    .filter((unit) => (
      unit.target?.kind === "migration-transform-owner"
      && unit.target.ownerId === legacyArchiveTransform?.ownerId
      && unit.target.ownerPlanDigest === legacyArchiveTransform?.ownerPlanDigest
      && unit.target.resolutionDigest === legacyArchiveTransform?.resolutionDigest
    ))
    .map((unit) => unit.unitId)
    .sort(lexicalCompare);
  return {
    unitsByPhase,
    physicalUnitIds: new Set(migrationPlan.payload.commitPhases.flatMap((entry) => entry.unitIds)),
    targetKeys: new Set(migrationPlan.payload.target.layoutEntries.map((entry) => entry.key)),
    blockerIds: new Set(migrationPlan.payload.blockers.map((entry) => entry.blockerId)),
    dependencyIds: new Set(migrationPlan.payload.dependencies
      .filter((entry) => entry.status !== "satisfied")
      .map((entry) => entry.dependencyId)),
    manualUnitIds: new Set(migrationPlan.payload.sources
      .flatMap((source) => source.units)
      .filter((unit) => unit.action === "manual")
      .map((unit) => unit.unitId)),
    legacyArchiveTransform,
    legacyArchiveTransformUnitIds,
  };
}

// 每份HostPlan都必须反向绑定同一T05 decommission coverage，不能只信plan自己的digest。
function normalizeHostPlans(values, migrationPlan) {
  const expectedHosts = new Set(migrationPlan.payload.decommissionCoverage.map((entry) => entry.hostId));
  const plans = denseDataArray(values, "hostPlans", { maximum: expectedHosts.size }).map((value, index) => {
    let plan;
    try {
      plan = validateMigrationHostDecommissionPlan(value);
      assertMigrationHostDecommissionPlanAgainstMigrationPlan({ migrationPlan, plan });
    } catch (cause) {
      fail("wakeflow-migration-apply-host", `hostPlans/${index} is invalid or stale`, { cause });
    }
    if (!expectedHosts.has(plan.hostId)) {
      fail("wakeflow-migration-apply-host", `hostPlans/${index} covers an unknown host`);
    }
    return plan;
  }).sort((left, right) => lexicalCompare(left.hostId, right.hostId));
  if (new Set(plans.map((entry) => entry.hostId)).size !== plans.length) {
    fail("wakeflow-migration-apply-host", "hostPlans contain duplicate hosts");
  }
  return plans;
}

function hostEffectIntentDigest(migrationPlan, hostPlan, subject) {
  return canonicalJsonDigest({
    kind: "WakeflowMigrationHostEffectIntent",
    schemaVersion: 1,
    migrationPlanDigest: migrationPlan.planDigest,
    hostPlanDigest: hostPlan.planDigest,
    hostId: hostPlan.hostId,
    subjectId: subject.subjectId,
    subjectDigest: subject.subjectDigest,
    sourceIds: subject.sourceIds,
    effect: subject.effect,
    proofPolicy: subject.proofPolicy,
  });
}

// 把T07 physical subject与owner-effect step一一绑定；source-freeze-only subject不伪造effect。
function normalizeHostEffectSnapshot(value, index, migrationPlan, hostPlansById) {
  exactKeys(
    value,
    ["hostId", "ownerId", "snapshot", "effectBindings"],
    `hostEffectSnapshots/${index}`,
  );
  const hostPlan = hostPlansById.get(value.hostId);
  if (!hostPlan) fail("wakeflow-migration-apply-host", `hostEffectSnapshots/${index} has no exact host plan`);
  token(value.ownerId, `hostEffectSnapshots/${index}.ownerId`);
  const snapshot = normalizeOwnerPlan(value.snapshot, `hostEffectSnapshots/${index}.snapshot`);
  const subjects = hostPlan.subjects.filter((subject) => subject.effect !== "none");
  const subjectsById = new Map(subjects.map((subject) => [subject.subjectId, subject]));
  const stepsById = new Map(snapshot.payload.steps.map((step) => [step.stepId, step]));
  const effectBindings = denseDataArray(
    value.effectBindings,
    `hostEffectSnapshots/${index}.effectBindings`,
    { maximum: subjects.length },
  ).map((binding, bindingIndex) => {
    exactKeys(binding, ["subjectId", "stepId"], `hostEffectSnapshots/${index}.effectBindings/${bindingIndex}`);
    const subject = subjectsById.get(binding.subjectId);
    const step = stepsById.get(binding.stepId);
    if (!subject || !step || step.stepKind !== "owner-effect") {
      fail("wakeflow-migration-apply-host", "host effect binding is unknown or not an owner-effect step");
    }
    if (
      step.effectKind !== "migration-host-decommission"
      || step.intentDigest !== hostEffectIntentDigest(migrationPlan, hostPlan, subject)
    ) fail("wakeflow-migration-apply-host", "host owner-effect intent differs from its frozen T07 subject");
    return { subjectId: binding.subjectId, stepId: binding.stepId };
  }).sort((left, right) => lexicalCompare(left.subjectId, right.subjectId));
  if (
    !sameCanonical(effectBindings.map((entry) => entry.subjectId), subjects.map((entry) => entry.subjectId).sort(lexicalCompare))
    || new Set(effectBindings.map((entry) => entry.stepId)).size !== effectBindings.length
    || effectBindings.length !== snapshot.payload.steps.length
  ) fail("wakeflow-migration-apply-host", "host effect snapshot does not exactly cover physical T07 subjects");
  return {
    hostId: value.hostId,
    ownerId: value.ownerId,
    hostPlanDigest: hostPlan.planDigest,
    snapshot,
    snapshotSchemaId: snapshot.schemaId,
    snapshotDigest: canonicalJsonDigest(snapshot),
    effectBindings,
  };
}

// Codex人工确认只覆盖一个exact archive subject，并同时绑定T05/T07两层plan digest。
function validateManualAcknowledgement(value, migrationPlan, hostPlansById, label) {
  exactKeys(value, [
    "hostId",
    "subjectId",
    "subjectDigest",
    "hostPlanDigest",
    "migrationPlanDigest",
    "decision",
    "acknowledgementDigest",
  ], label);
  const hostPlan = hostPlansById.get(value.hostId);
  const subject = hostPlan?.subjects.find((entry) => entry.subjectId === value.subjectId);
  if (
    value.hostId !== "codex"
    || !subject
    || subject.effect !== "archive"
    || subject.proofPolicy !== "manual-host-gate"
    || value.subjectDigest !== subject.subjectDigest
    || value.hostPlanDigest !== hostPlan.planDigest
    || value.migrationPlanDigest !== migrationPlan.planDigest
    || value.decision !== "accept-manual-host-gate"
  ) fail("wakeflow-migration-apply-acknowledgement", `${label} does not bind one exact Codex archive subject`);
  const { acknowledgementDigest, ...unsigned } = value;
  if (acknowledgementDigest !== canonicalJsonDigest(unsigned)) {
    fail("wakeflow-migration-apply-acknowledgement", `${label} digest differs from its exact subject decision`);
  }
  return value;
}

/** 为一个精确Codex archive subject签发manual-host-gate确认，不扩张到整宿主。 */
export function createWakeflowMigrationManualAcknowledgement(value = {}) {
  exactKeys(value, ["migrationPlan", "hostPlan", "subjectId"], "manual acknowledgement input");
  const migrationPlan = validateWakeflowMigrationPlan(value.migrationPlan);
  let hostPlan;
  try {
    hostPlan = assertMigrationHostDecommissionPlanAgainstMigrationPlan({
      migrationPlan,
      plan: value.hostPlan,
    });
  } catch (cause) {
    fail("wakeflow-migration-apply-acknowledgement", "host plan is invalid or stale", { cause });
  }
  const subject = hostPlan.subjects.find((entry) => entry.subjectId === value.subjectId);
  if (hostPlan.hostId !== "codex" || subject?.effect !== "archive" || subject.proofPolicy !== "manual-host-gate") {
    fail("wakeflow-migration-apply-acknowledgement", "only one exact Codex archive subject may be acknowledged");
  }
  const unsigned = {
    hostId: hostPlan.hostId,
    subjectId: subject.subjectId,
    subjectDigest: subject.subjectDigest,
    hostPlanDigest: hostPlan.planDigest,
    migrationPlanDigest: migrationPlan.planDigest,
    decision: "accept-manual-host-gate",
  };
  return deepFreeze({ ...unsigned, acknowledgementDigest: canonicalJsonDigest(unsigned) });
}

function issue(code, value) {
  return { code, subjectDigest: canonicalJsonDigest(value) };
}

function missing(expected, actual) {
  const actualSet = new Set(actual);
  return [...expected].filter((entry) => !actualSet.has(entry)).sort(lexicalCompare);
}

function assertNoDuplicateCoverage(entries, field) {
  const values = entries.flatMap((entry) => entry[field]);
  if (new Set(values).size !== values.length) {
    fail("wakeflow-migration-apply-coverage", `${field} is claimed by multiple owner phases`);
  }
  return values;
}

// 按host再按五phase顺序拼接owner-local steps，并在此唯一改写aggregate ordinal。
function aggregateSteps(hostSnapshots, phaseSnapshots) {
  const ordered = [
    ...hostSnapshots,
    ...WAKEFLOW_MIGRATION_APPLY_PHASES
      .map((phase) => phaseSnapshots.find((entry) => entry.phase === phase))
      .filter(Boolean),
  ];
  const ids = new Set();
  const steps = [];
  for (const owner of ordered) {
    for (const step of owner.snapshot.payload.steps) {
      if (ids.has(step.stepId)) fail("wakeflow-migration-apply-owner-snapshot", `duplicate aggregate step ID: ${step.stepId}`);
      ids.add(step.stepId);
      steps.push({ ...step, ordinal: steps.length });
    }
  }
  return steps;
}

// 三、完整confirmed apply plan构建与自重建校验。

function buildPlan(input) {
  exactKeys(input, [
    "migrationPlan",
    "hostPlans",
    "hostEffectSnapshots",
    "manualAcknowledgements",
    "phaseSnapshots",
  ], "migration apply planning input");
  const migrationPlan = validateWakeflowMigrationPlan(input.migrationPlan);
  const facts = migrationFacts(migrationPlan);
  const hostPlans = normalizeHostPlans(input.hostPlans, migrationPlan);
  const hostPlansById = new Map(hostPlans.map((entry) => [entry.hostId, entry]));
  const hostEffectSnapshots = denseDataArray(
    input.hostEffectSnapshots,
    "hostEffectSnapshots",
    { maximum: hostPlans.length },
  )
    .map((entry, index) => normalizeHostEffectSnapshot(entry, index, migrationPlan, hostPlansById))
    .sort((left, right) => lexicalCompare(left.hostId, right.hostId));
  if (new Set(hostEffectSnapshots.map((entry) => entry.hostId)).size !== hostEffectSnapshots.length) {
    fail("wakeflow-migration-apply-host", "hostEffectSnapshots contain duplicate hosts");
  }
  const phaseSnapshots = denseDataArray(
    input.phaseSnapshots,
    "phaseSnapshots",
    { maximum: WAKEFLOW_MIGRATION_APPLY_PHASES.length },
  )
    .map((entry, index) => normalizePhaseSnapshot(entry, index, facts))
    .sort((left, right) => (
      WAKEFLOW_MIGRATION_APPLY_PHASES.indexOf(left.phase)
      - WAKEFLOW_MIGRATION_APPLY_PHASES.indexOf(right.phase)
    ));
  if (new Set(phaseSnapshots.map((entry) => entry.phase)).size !== phaseSnapshots.length) {
    fail("wakeflow-migration-apply-phase", "phaseSnapshots contain duplicate phases");
  }
  const expectedManualSubjects = hostPlans.flatMap((hostPlan) => hostPlan.subjects
    .filter((subject) => hostPlan.hostId === "codex" && subject.effect === "archive")
    .map((subject) => subject.subjectId)).sort(lexicalCompare);
  const manualAcknowledgements = denseDataArray(
    input.manualAcknowledgements,
    "manualAcknowledgements",
    { maximum: expectedManualSubjects.length },
  )
    .map((entry, index) => validateManualAcknowledgement(
      canonicalClone(entry, `manualAcknowledgements/${index}`),
      migrationPlan,
      hostPlansById,
      `manualAcknowledgements/${index}`,
    ))
    .sort((left, right) => lexicalCompare(left.subjectId, right.subjectId));
  if (new Set(manualAcknowledgements.map((entry) => entry.subjectId)).size !== manualAcknowledgements.length) {
    fail("wakeflow-migration-apply-acknowledgement", "manualAcknowledgements contain duplicate subjects");
  }

  const issues = [];
  const expectedHosts = migrationPlan.payload.decommissionCoverage.map((entry) => entry.hostId).sort(lexicalCompare);
  for (const hostId of missing(expectedHosts, hostPlans.map((entry) => entry.hostId))) {
    issues.push(issue("migration-apply-host-plan-missing", { hostId }));
  }
  for (const hostPlan of hostPlans) {
    const hardBlockers = hostPlan.blockerCodes.filter(
      (code) => code !== "migration-host-resource-followup-unresolved",
    );
    if (hardBlockers.length > 0) {
      issues.push(issue("migration-apply-host-plan-blocked", {
        hostId: hostPlan.hostId,
        blockerCodes: hardBlockers,
      }));
    }
    const physical = hostPlan.subjects.filter((subject) => subject.effect !== "none");
    if (physical.length > 0 && !hostEffectSnapshots.some((entry) => entry.hostId === hostPlan.hostId)) {
      issues.push(issue("migration-apply-host-effect-snapshot-missing", { hostId: hostPlan.hostId }));
    }
  }
  for (const subjectId of missing(expectedManualSubjects, manualAcknowledgements.map((entry) => entry.subjectId))) {
    issues.push(issue("migration-apply-manual-host-acknowledgement-missing", { subjectId }));
  }
  for (const phase of WAKEFLOW_MIGRATION_APPLY_PHASES) {
    if (!phaseSnapshots.some((entry) => entry.phase === phase)) {
      issues.push(issue("migration-apply-phase-missing", { phase }));
    }
  }
  const unitClaims = assertNoDuplicateCoverage(phaseSnapshots, "unitIds");
  const targetClaims = assertNoDuplicateCoverage(phaseSnapshots, "targetKeys");
  const blockerClaims = assertNoDuplicateCoverage(phaseSnapshots, "blockerIds");
  const dependencyClaims = assertNoDuplicateCoverage(phaseSnapshots, "dependencyIds");
  const manualClaims = assertNoDuplicateCoverage(phaseSnapshots, "manualUnitIds");

  // phase owner可以关闭它精确认领的dependency及其同一blocker，但不能仅靠“列入coverage”
  // 把未解决的physical/manual fact洗成证明。Host decommission是例外的物理owner：其关闭
  // 来自exact T07 HostPlan/effect snapshot，而不是普通D38 phase participant。
  const hostCoveredSourceIds = new Set(hostPlans.flatMap((entry) => entry.coverage.sourceIds));
  const hostResourceDependencyIds = new Set(hostPlans.flatMap(
    (entry) => entry.resourceFollowupDependencyIds,
  ));
  const hostClosableDependencyIds = new Set(migrationPlan.payload.dependencies
    .filter((entry) => (
      entry.status === "required"
      && (
        hostResourceDependencyIds.has(entry.dependencyId)
        || (
          entry.kind === "host-decommission"
          && entry.sourceIds.length > 0
          && entry.sourceIds.every((sourceId) => hostCoveredSourceIds.has(sourceId))
        )
      )
    ))
    .map((entry) => entry.dependencyId));
  const hardBlockers = migrationPlan.payload.blockers.filter((entry) => {
    if (entry.dependencyId !== null) return false;
    const exactHostSource = entry.sourceId === null || hostCoveredSourceIds.has(entry.sourceId);
    const hostEffectOwned = exactHostSource
      && entry.code.includes("host-decommission")
      && hostPlans.length > 0;
    const resourceFollowupOwned = exactHostSource
      && entry.code === "migration-pod-host-resource-followup-required"
      && hostResourceDependencyIds.size > 0;
    return !hostEffectOwned && !resourceFollowupOwned;
  });
  if (hardBlockers.length > 0) {
    issues.push(issue("migration-apply-upstream-blocker-unresolved", hardBlockers.map((entry) => ({
      blockerId: entry.blockerId,
      code: entry.code,
    }))));
  }
  if (facts.manualUnitIds.size > 0) {
    issues.push(issue(
      "migration-apply-upstream-manual-unit-unresolved",
      [...facts.manualUnitIds].sort(lexicalCompare),
    ));
  }
  const uncoveredHostDependencies = migrationPlan.payload.dependencies.filter((entry) => (
    entry.status === "required"
    && entry.kind === "host-decommission"
    && !hostClosableDependencyIds.has(entry.dependencyId)
  ));
  if (uncoveredHostDependencies.length > 0) {
    issues.push(issue(
      "migration-apply-host-dependency-unresolved",
      uncoveredHostDependencies.map((entry) => entry.dependencyId),
    ));
  }
  for (const [code, expected, actual] of [
    ["migration-apply-unit-coverage-missing", facts.physicalUnitIds, unitClaims],
    ["migration-apply-target-coverage-missing", facts.targetKeys, targetClaims],
    ["migration-apply-blocker-coverage-missing", facts.blockerIds, blockerClaims],
    ["migration-apply-dependency-coverage-missing", facts.dependencyIds, dependencyClaims],
    ["migration-apply-manual-unit-coverage-missing", facts.manualUnitIds, manualClaims],
  ]) {
    const absent = missing(expected, actual);
    if (absent.length > 0) issues.push(issue(code, absent));
  }
  for (const phaseSnapshot of phaseSnapshots) {
    const absent = missing(facts.unitsByPhase.get(phaseSnapshot.phase), phaseSnapshot.unitIds);
    if (absent.length > 0) {
      issues.push(issue("migration-apply-phase-unit-coverage-missing", {
        phase: phaseSnapshot.phase,
        unitIds: absent,
      }));
    }
  }
  const steps = aggregateSteps(hostEffectSnapshots, phaseSnapshots);
  if (steps.length === 0) issues.push(issue("migration-apply-physical-step-missing", migrationPlan.planDigest));
  issues.sort((left, right) => (
    lexicalCompare(left.code, right.code)
    || lexicalCompare(left.subjectDigest, right.subjectDigest)
  ));

  const result = {
    schemaId: WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_ID,
    payload: {
      kind: WAKEFLOW_MIGRATION_APPLY_PLAN_KIND,
      schemaVersion: WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_VERSION,
      action: "explicit-migration",
      status: issues.length === 0 ? "ready" : "blocked",
      issues,
      migrationPlanDigest: migrationPlan.planDigest,
      inventoryDigest: migrationPlan.payload.inventory.inventoryDigest,
      artifactDigests: migrationPlan.payload.artifacts,
      migrationPlan,
      hostPlans,
      hostEffectSnapshots,
      manualAcknowledgements,
      phaseSnapshots,
      coverage: {
        physicalUnitIds: [...facts.physicalUnitIds].sort(lexicalCompare),
        targetKeys: [...facts.targetKeys].sort(lexicalCompare),
        blockerIds: [...facts.blockerIds].sort(lexicalCompare),
        dependencyIds: [...facts.dependencyIds].sort(lexicalCompare),
        manualUnitIds: [...facts.manualUnitIds].sort(lexicalCompare),
        hostSubjectIds: hostPlans.flatMap((entry) => entry.subjects.map((subject) => subject.subjectId)).sort(lexicalCompare),
      },
      steps,
    },
  };
  let persistenceBudget;
  try {
    // 预算器复用M3自己的step-shape规则；preview不能把注定无法进入journal的owner plan标为ready。
    persistenceBudget = inspectWakeflowMaintenancePersistenceBudget({
      action: "explicit-migration",
      plan: result,
      purpose: "maintenance-apply",
    });
  } catch (cause) {
    fail(
      "wakeflow-migration-apply-owner-snapshot",
      "aggregate owner steps are outside the shared mutation contract",
      { cause },
    );
  }
  if (!persistenceBudget.admitted) {
    result.payload.issues.push(issue("migration-apply-persistence-budget-exceeded", {
      maximumProtocolFileBytes: persistenceBudget.maximumProtocolFileBytes,
      maximumReachableBytes: persistenceBudget.maximumReachableBytes,
    }));
    result.payload.issues.sort((left, right) => (
      lexicalCompare(left.code, right.code)
      || lexicalCompare(left.subjectDigest, right.subjectDigest)
    ));
    result.payload.status = "blocked";
  }
  return result;
}

/** 纯规划入口：完整覆盖不足时返回blocked plan，绝不触发workspace或宿主副作用。 */
export function planWakeflowMigrationApply(value = {}) {
  return validateWakeflowMigrationApplyPlan(buildPlan(value));
}

/** 从全部嵌入的上游/owner snapshot重建计划，拒绝只重签外层字段的co-tamper。 */
export function validateWakeflowMigrationApplyPlan(value) {
  const plan = canonicalClone(value, "migration apply plan");
  exactKeys(plan, ["schemaId", "payload"], "migration apply plan");
  if (plan.schemaId !== WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_ID) {
    fail("wakeflow-migration-apply-plan", "migration apply plan schema identity is invalid");
  }
  exactKeys(plan.payload, [
    "kind",
    "schemaVersion",
    "action",
    "status",
    "issues",
    "migrationPlanDigest",
    "inventoryDigest",
    "artifactDigests",
    "migrationPlan",
    "hostPlans",
    "hostEffectSnapshots",
    "manualAcknowledgements",
    "phaseSnapshots",
    "coverage",
    "steps",
  ], "migration apply plan payload");
  if (
    plan.payload.kind !== WAKEFLOW_MIGRATION_APPLY_PLAN_KIND
    || plan.payload.schemaVersion !== WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_VERSION
    || plan.payload.action !== "explicit-migration"
    || !new Set(["ready", "blocked"]).has(plan.payload.status)
  ) fail("wakeflow-migration-apply-plan", "migration apply plan identity or status is invalid");
  const expected = buildPlan({
    migrationPlan: plan.payload.migrationPlan,
    hostPlans: plan.payload.hostPlans,
    hostEffectSnapshots: plan.payload.hostEffectSnapshots.map((entry) => ({
      hostId: entry.hostId,
      ownerId: entry.ownerId,
      snapshot: entry.snapshot,
      effectBindings: entry.effectBindings,
    })),
    manualAcknowledgements: plan.payload.manualAcknowledgements,
    phaseSnapshots: plan.payload.phaseSnapshots.map((entry) => ({
      phase: entry.phase,
      ownerId: entry.ownerId,
      snapshot: entry.snapshot,
      unitIds: entry.unitIds,
      targetKeys: entry.targetKeys,
      blockerIds: entry.blockerIds,
      dependencyIds: entry.dependencyIds,
      manualUnitIds: entry.manualUnitIds,
    })),
  });
  if (!sameCanonical(plan, expected)) {
    fail("wakeflow-migration-apply-plan", "migration apply plan differs from its exact upstream and owner snapshots");
  }
  return deepFreeze(plan);
}

/** 对通过完整重建校验的apply plan计算canonical digest。 */
export function wakeflowMigrationApplyPlanDigest(value) {
  return canonicalJsonDigest(validateWakeflowMigrationApplyPlan(value));
}

// 四、owner callable准入、两阶段authority快照与aggregate participant适配。

// 只读取participant四个真实消费字段，并在任何owner代码执行前冻结其全部step callback。
function validateOwnerParticipant(entry, expected, label) {
  const entryFields = Object.hasOwn(expected, "phase")
    ? ["phase", "snapshotDigest", "participant"]
    : ["hostId", "snapshotDigest", "participant"];
  exactKeys(entry, entryFields, label);
  const identityField = Object.hasOwn(expected, "phase") ? "phase" : "hostId";
  if (
    entry[identityField] !== expected[identityField]
    || entry.snapshotDigest !== expected.snapshotDigest
    || !plainObject(entry.participant)
  ) fail("wakeflow-migration-apply-participant", `${label} identity is invalid`);
  const participant = entry.participant;
  exactKeys(
    participant,
    ["validatePlan", "deriveCurrentPlan", "deriveTerminalClosure", "stepHandlers"],
    `${label}.participant`,
  );
  const callbacks = {};
  for (const callback of ["validatePlan", "deriveCurrentPlan", "deriveTerminalClosure"]) {
    const candidate = dataProperty(participant, callback, `${label}.participant`);
    if (typeof candidate !== "function") {
      fail("wakeflow-migration-apply-participant", `${label} lacks ${callback}()`);
    }
    callbacks[callback] = candidate;
  }
  const ownerSteps = expected.snapshot.payload.steps;
  const rawStepHandlers = dataProperty(participant, "stepHandlers", `${label}.participant`);
  if (!plainObject(rawStepHandlers)) {
    fail("wakeflow-migration-apply-participant", `${label} lacks stepHandlers`);
  }
  const expectedSteps = ownerSteps.map((step) => step.stepId).sort(lexicalCompare);
  exactKeys(rawStepHandlers, expectedSteps, `${label}.participant.stepHandlers`);
  const stepById = new Map(ownerSteps.map((step) => [step.stepId, step]));
  const stepHandlers = Object.fromEntries(expectedSteps.map((stepId) => {
    const ownerStep = stepById.get(stepId);
    const handler = dataProperty(rawStepHandlers, stepId, `${label}.participant.stepHandlers`);
    if (!plainObject(handler)) {
      fail("wakeflow-migration-apply-participant", `${ownerStep.stepId} handler is invalid`);
    }
    const effect = ownerStep.stepKind === "owner-effect";
    const required = effect
      ? [
        "prepareEffect",
        "performEffect",
        "recoverEffect",
        "observeEffect",
        "validateEffectCheckpoint",
        "validateEffectResult",
        "validateEffectOutcome",
        "assertEffectOutcome",
      ]
      : ["prepare", "observe", "commit"];
    const accepted = effect ? required : [...required, "cleanup"];
    allowedKeys(handler, accepted, `${label}.participant.stepHandlers.${ownerStep.stepId}`);
    const stable = {};
    for (const callback of required) {
      const candidate = dataProperty(
        handler,
        callback,
        `${label}.participant.stepHandlers.${ownerStep.stepId}`,
      );
      if (typeof candidate !== "function") {
        fail("wakeflow-migration-apply-participant", `${ownerStep.stepId} handler lacks ${callback}()`);
      }
      stable[callback] = candidate;
    }
    if (!effect) {
      const cleanup = dataProperty(
        handler,
        "cleanup",
        `${label}.participant.stepHandlers.${ownerStep.stepId}`,
        { required: false },
      );
      if (cleanup !== undefined && typeof cleanup !== "function") {
        fail("wakeflow-migration-apply-participant", `${ownerStep.stepId} cleanup must be one function`);
      }
      if (ownerStep.stepKind === "remove" && typeof cleanup !== "function") {
        fail(
          "wakeflow-migration-apply-participant",
          `${ownerStep.stepId} remove recovery requires cleanup()`,
        );
      }
      if (cleanup !== undefined) stable.cleanup = cleanup;
    }
    return [stepId, Object.freeze(stable)];
  }));
  return Object.freeze({
    ...callbacks,
    stepHandlers: Object.freeze(stepHandlers),
  });
}

function validateOwnerCodec(participant, expected, label) {
  let verdict;
  try {
    verdict = participant.validatePlan({ plan: expected.snapshot });
  } catch (cause) {
    fail("wakeflow-migration-apply-participant", `${label} rejected its frozen owner snapshot`, { cause });
  }
  exactKeys(verdict, ["valid"], `${label}.participant codec verdict`);
  if (verdict.valid !== true) {
    fail("wakeflow-migration-apply-participant", `${label} codec must return exact { valid: true }`);
  }
}

// 用owner-local plan/step调用已冻结callback，同时向M3暴露aggregate plan/ordinal语义。
function adaptStepHandler(handler, aggregatePlan, aggregateStep, ownerPlan, ownerStep) {
  const effect = ownerStep.stepKind === "owner-effect";
  const callbacks = effect
    ? [
      "prepareEffect",
      "performEffect",
      "recoverEffect",
      "observeEffect",
      "validateEffectCheckpoint",
      "validateEffectResult",
      "validateEffectOutcome",
      "assertEffectOutcome",
    ]
    : ["prepare", "observe", "commit"];
  const map = (args) => ({ ...args, plan: ownerPlan, step: ownerStep });
  const adapted = Object.fromEntries(callbacks.map((callback) => {
    const ownerCallback = handler[callback];
    return [callback, async (args) => ownerCallback(map(args))];
  }));
  if (!effect && typeof handler.cleanup === "function") {
    const ownerCleanup = handler.cleanup;
    adapted.cleanup = async (args) => ownerCleanup(map(args));
  }
  if (!sameCanonical(
    { ...ownerStep, ordinal: aggregateStep.ordinal },
    aggregateStep,
  )) fail("wakeflow-migration-apply-participant", `${ownerStep.stepId} aggregate semantics differ from owner snapshot`);
  return Object.freeze(adapted);
}

// 每个owner必须返回至少一个被动、命名且带canonical digest的durable terminal证明。
function validateClosure(value, snapshotDigest, label) {
  exactKeys(value, ["planDigest", "closureDigests"], label);
  if (value.planDigest !== snapshotDigest) {
    fail("wakeflow-migration-apply-closure", `${label} has an invalid snapshot identity`);
  }
  const closureDigests = denseDataArray(value.closureDigests, `${label}.closureDigests`, {
    maximum: MAX_OWNER_CLOSURE_DIGESTS,
  });
  if (closureDigests.length === 0) {
    fail("wakeflow-migration-apply-closure", `${label} must contribute one durable closure digest`);
  }
  return closureDigests.map((entry, index) => {
    exactKeys(entry, ["name", "digest"], `${label}.closureDigests/${index}`);
    token(entry.name, `${label}.closureDigests/${index}.name`);
    digest(entry.digest, `${label}.closureDigests/${index}.digest`);
    return { name: entry.name, digest: entry.digest };
  });
}

/**
 * 把全部owner participant冻结并适配为workspace mutation manager唯一认识的组合participant。
 * participant本身不持有gate；每次执行仍须接受M3签发且与apply/recovery模式匹配的context。
 */
export function createWakeflowMigrationMutationParticipant(value = {}) {
  exactKeys(value, [
    "workspaceRoot",
    "admission",
    "confirmedPlan",
    "hostEffectParticipants",
    "phaseParticipants",
    "replan",
  ], "migration mutation participant input");
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const admission = value.admission;
  const replan = value.replan;
  if (!new Set(["apply", "recovery"]).has(admission)) {
    fail("wakeflow-migration-apply-participant", "admission must be apply or recovery");
  }
  if ((admission === "apply") !== (typeof replan === "function")) {
    fail("wakeflow-migration-apply-participant", "apply requires replan while recovery requires null replan");
  }
  const confirmedPlan = validateWakeflowMigrationApplyPlan(value.confirmedPlan);
  if (confirmedPlan.payload.status !== "ready") {
    fail("wakeflow-migration-apply-blocked", "a blocked migration apply plan cannot create a mutation participant");
  }
  const expectedHost = confirmedPlan.payload.hostEffectSnapshots;
  const expectedPhases = confirmedPlan.payload.phaseSnapshots;
  const hostEffectParticipants = denseDataArray(
    value.hostEffectParticipants,
    "hostEffectParticipants",
    { maximum: expectedHost.length },
  );
  const phaseParticipants = denseDataArray(
    value.phaseParticipants,
    "phaseParticipants",
    { maximum: expectedPhases.length },
  );
  const hostById = new Map(expectedHost.map((entry) => [entry.hostId, entry]));
  const phaseById = new Map(expectedPhases.map((entry) => [entry.phase, entry]));
  const suppliedHost = new Map();
  for (const [index, entry] of hostEffectParticipants.entries()) {
    const label = `hostEffectParticipants/${index}`;
    exactKeys(entry, ["hostId", "snapshotDigest", "participant"], label);
    const hostId = entry.hostId;
    const expected = hostById.get(hostId);
    if (!expected || suppliedHost.has(hostId)) {
      fail("wakeflow-migration-apply-participant", `hostEffectParticipants/${index} is duplicate or unknown`);
    }
    suppliedHost.set(hostId, validateOwnerParticipant(entry, expected, label));
  }
  const suppliedPhases = new Map();
  for (const [index, entry] of phaseParticipants.entries()) {
    const label = `phaseParticipants/${index}`;
    exactKeys(entry, ["phase", "snapshotDigest", "participant"], label);
    const phase = entry.phase;
    const expected = phaseById.get(phase);
    if (!expected || suppliedPhases.has(phase)) {
      fail("wakeflow-migration-apply-participant", `phaseParticipants/${index} is duplicate or unknown`);
    }
    suppliedPhases.set(phase, validateOwnerParticipant(entry, expected, label));
  }
  if (suppliedHost.size !== hostById.size || suppliedPhases.size !== phaseById.size) {
    fail("wakeflow-migration-apply-participant", "participants do not cover every frozen owner snapshot");
  }

  // 两阶段准入：先冻结全部owner/handler引用，再允许任何owner codec执行。
  // 这样前一个codec即使修改调用方对象，也无法替换尚未校验owner的执行authority。
  for (const entry of expectedHost) {
    validateOwnerCodec(
      suppliedHost.get(entry.hostId),
      entry,
      `hostEffectParticipants/${entry.hostId}`,
    );
  }
  for (const entry of expectedPhases) {
    validateOwnerCodec(
      suppliedPhases.get(entry.phase),
      entry,
      `phaseParticipants/${entry.phase}`,
    );
  }

  const aggregateById = new Map(confirmedPlan.payload.steps.map((step) => [step.stepId, step]));
  const stepHandlers = {};
  const owners = [
    ...expectedHost.map((entry) => ({ entry, participant: suppliedHost.get(entry.hostId) })),
    ...expectedPhases.map((entry) => ({ entry, participant: suppliedPhases.get(entry.phase) })),
  ];
  for (const { entry, participant } of owners) {
    for (const ownerStep of entry.snapshot.payload.steps) {
      const aggregateStep = aggregateById.get(ownerStep.stepId);
      if (!aggregateStep || Object.hasOwn(stepHandlers, ownerStep.stepId)) {
        fail("wakeflow-migration-apply-participant", "owner step coverage is duplicate or unknown");
      }
      stepHandlers[ownerStep.stepId] = adaptStepHandler(
        participant.stepHandlers[ownerStep.stepId],
        confirmedPlan,
        aggregateStep,
        entry.snapshot,
        ownerStep,
      );
    }
  }
  if (Object.keys(stepHandlers).length !== confirmedPlan.payload.steps.length) {
    fail("wakeflow-migration-apply-participant", "owner handlers do not cover every aggregate step");
  }

  const assertContext = (context) => {
    if (admission === "recovery" && context === null) return;
    try {
      assertWakeflowMutationContext({
        workspaceRoot,
        context,
        mode: admission === "apply" ? "maintenance" : "recovery-cleanup",
      });
    } catch (cause) {
      fail("wakeflow-migration-apply-admission", "migration participant received the wrong mutation context", { cause });
    }
  };

  return Object.freeze({
    validatePlan({ plan }) {
      const candidate = validateWakeflowMigrationApplyPlan(plan);
      if (!sameCanonical(candidate, confirmedPlan)) {
        fail("wakeflow-migration-apply-stale", "maintenance manager received another migration apply plan");
      }
      return { valid: true };
    },

    async deriveCurrentPlan({ context }) {
      assertContext(context);
      if (admission === "apply") {
        let replanned;
        try {
          replanned = validateWakeflowMigrationApplyPlan(await replan({ context }));
        } catch (cause) {
          fail("wakeflow-migration-apply-stale", "migration apply plan cannot be reconstructed", { cause });
        }
        if (!sameCanonical(replanned, confirmedPlan)) {
          fail("wakeflow-migration-apply-stale", "migration apply plan changed inside the maintenance fence");
        }
      } else if (context === null) {
        return confirmedPlan;
      }
      for (const { entry, participant } of owners) {
        let current;
        try {
          current = await participant.deriveCurrentPlan({ context });
          const verdict = participant.validatePlan({ plan: current });
          if (!plainObject(verdict) || !sameCanonical(verdict, { valid: true })) throw new Error("invalid codec verdict");
        } catch (cause) {
          fail("wakeflow-migration-apply-stale", "one migration owner snapshot changed", { cause });
        }
        if (!sameCanonical(current, entry.snapshot)) {
          fail("wakeflow-migration-apply-stale", "one migration owner plan differs from confirmation");
        }
      }
      return confirmedPlan;
    },

    async deriveTerminalClosure({ context, plan, planDigest, effectRecords }) {
      assertContext(context);
      const confirmedDigest = canonicalJsonDigest(confirmedPlan);
      if (!sameCanonical(plan, confirmedPlan) || planDigest !== confirmedDigest) {
        fail("wakeflow-migration-apply-closure", "terminal closure received another migration apply plan");
      }
      const byName = new Map();
      for (const { entry, participant } of owners) {
        let closure;
        try {
          closure = await participant.deriveTerminalClosure({
            context,
            plan: entry.snapshot,
            planDigest: entry.snapshotDigest,
            effectRecords,
          });
        } catch (cause) {
          fail("wakeflow-migration-apply-closure", "one owner terminal closure failed", { cause });
        }
        for (const item of validateClosure(closure, entry.snapshotDigest, `${entry.ownerId} terminal closure`)) {
          if (item.name === "migration-apply-plan" || byName.has(item.name)) {
            fail("wakeflow-migration-apply-closure", "owner terminal closure names conflict");
          }
          byName.set(item.name, item.digest);
        }
      }
      byName.set("migration-apply-plan", canonicalJsonDigest({
        planDigest: confirmedDigest,
        migrationPlanDigest: confirmedPlan.payload.migrationPlanDigest,
        coverage: confirmedPlan.payload.coverage,
        effectRecords,
      }));
      return {
        planDigest: confirmedDigest,
        closureDigests: [...byName]
          .sort(([left], [right]) => lexicalCompare(left, right))
          .map(([name, closureDigest]) => ({ name, digest: closureDigest })),
      };
    },

    stepHandlers: Object.freeze(stepHandlers),
  });
}

// 五、ready confirmed plan到唯一M3 journal的执行入口。

/** 在shared maintenance gate中执行一份ready且digest完全匹配的迁移计划。 */
export async function runWakeflowMigrationApply(value = {}) {
  exactKeys(
    value,
    ["workspaceRoot", "confirmedPlan", "planDigest", "participant"],
    "migration apply input",
  );
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const confirmedPlan = validateWakeflowMigrationApplyPlan(value.confirmedPlan);
  if (confirmedPlan.payload.status !== "ready") {
    fail("wakeflow-migration-apply-blocked", "blocked migration apply plans execute zero mutation boundaries");
  }
  const expectedDigest = canonicalJsonDigest(confirmedPlan);
  if (value.planDigest !== expectedDigest) {
    fail("wakeflow-migration-apply-plan", "confirmed plan digest differs from the complete apply plan");
  }
  exactKeys(
    value.participant,
    ["validatePlan", "deriveCurrentPlan", "deriveTerminalClosure", "stepHandlers"],
    "migration apply participant",
  );
  const participant = Object.freeze({
    validatePlan: dataProperty(value.participant, "validatePlan", "migration apply participant"),
    deriveCurrentPlan: dataProperty(value.participant, "deriveCurrentPlan", "migration apply participant"),
    deriveTerminalClosure: dataProperty(
      value.participant,
      "deriveTerminalClosure",
      "migration apply participant",
    ),
    stepHandlers: dataProperty(value.participant, "stepHandlers", "migration apply participant"),
  });
  if (
    typeof participant.validatePlan !== "function"
    || typeof participant.deriveCurrentPlan !== "function"
    || typeof participant.deriveTerminalClosure !== "function"
    || !plainObject(participant.stepHandlers)
  ) fail("wakeflow-migration-apply-participant", "participant is not the closed migration mutation surface");
  return runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "explicit-migration",
    operationKind: "explicit-migration",
    domainOwner: "migration-apply",
    confirmedPlan,
    planDigest: expectedDigest,
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
}
