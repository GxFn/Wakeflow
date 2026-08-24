import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  createWakeflowMigrationManualAcknowledgement,
} from "./wakeflow-migration-apply.mjs";
import {
  assertMigrationHostDecommissionPlanAgainstMigrationPlan,
  validateMigrationHostDecommissionPlan,
} from "./wakeflow-migration-host-decommission.mjs";
import {
  validateWakeflowMigrationPlan,
} from "./wakeflow-migration-plan.mjs";
import {
  inspectCodexMigrationDecommissionPlan,
} from "./wakeflow-codex-migration-decommission.mjs";

// 本文件是Codex legacy任务归档的T08宿主effect owner：消费T07冻结的HostPlan，
// 把preflight、archive observation与人工确认写成唯一workspace mutation journal可校验的记录。
// 阅读顺序：输入/回调准入 → effect snapshot → checkpoint/result/outcome codec → participant与terminal closure。
// 它不枚举legacy source、不直接调用Codex宿主API，也不把archive observation冒充不可恢复的关闭证明。

export const WAKEFLOW_CODEX_MIGRATION_EFFECT_HOST_ID = "codex";
export const WAKEFLOW_CODEX_MIGRATION_EFFECT_SCHEMA_VERSION = 1;
export const WAKEFLOW_CODEX_MIGRATION_EFFECT_PLAN_SCHEMA_ID =
  "urn:wakeflow:internal:codex-migration-host-effect-plan:v1";

const CHECKPOINT_SCHEMA_ID = "urn:wakeflow:internal:codex-migration-host-effect-checkpoint:v1";
const RESULT_SCHEMA_ID = "urn:wakeflow:internal:codex-migration-host-effect-result:v1";
const OUTCOME_SCHEMA_ID = "urn:wakeflow:internal:codex-migration-host-effect-outcome:v1";
const OWNER_ID = "codex-migration-host-effect";
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const PREFLIGHT_STATUSES = new Set(["ambiguous", "ready", "unavailable"]);
const OBSERVATION_STATUSES = new Set(["archived", "failed", "not-attempted", "unavailable"]);
const EVIDENCE_REQUIRED_STATUSES = new Set(["archived", "ready"]);

export class WakeflowCodexMigrationEffectError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowCodexMigrationEffectError";
    this.code = code;
  }
}

// 一、无行为输入准入与可复用的纯数据辅助。

function fail(code, message, cause = undefined) {
  throw new WakeflowCodexMigrationEffectError(code, message, { cause });
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
  if (!plainObject(value)) fail("wakeflow-codex-migration-effect-contract", `${label} must be one plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) fail("wakeflow-codex-migration-effect-contract", `${label} has an invalid field set`);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-codex-migration-effect-contract", `${label}.${key} must be an enumerable data field`);
    }
  }
  return value;
}

function denseDataArray(value, label, code = "wakeflow-codex-migration-effect-contract") {
  if (!Array.isArray(value)) fail(code, `${label} must be one array`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const index = typeof key === "string" ? Number(key) : Number.NaN;
    if (
      !Number.isInteger(index)
      || index < 0
      || index >= value.length
      || String(index) !== key
    ) fail(code, `${label} has an invalid array field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${label}/${key} must be an enumerable data slot`);
    }
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${label}/${index} must be one dense enumerable data slot`);
    }
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}

function ownDataField(value, key, label, code) {
  if (!plainObject(value)) fail(code, `${label} must be one plain object`);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail(code, `${label}.${key} must be an enumerable data field`);
  }
  return descriptor.value;
}

function snapshotAdapter(value) {
  // 回调引用在participant创建时一次冻结；准入后的adapter字段替换不能改变journal effect。
  const names = ["preflight", "archive", "recover"];
  exactKeys(value, names, "Codex migration effect adapter");
  const callbacks = {};
  for (const name of names) {
    if (typeof value[name] !== "function") {
      fail("wakeflow-codex-migration-effect-adapter", `Codex adapter.${name} must be one function`);
    }
    callbacks[name] = value[name];
  }
  return Object.freeze(callbacks);
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function normalizeWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
    || value.includes("\0")
  ) fail("wakeflow-codex-migration-effect-workspace", "workspaceRoot must be one normalized absolute path");
  return value;
}

function exactHostPlan(migrationPlan, candidate) {
  let plan;
  try {
    plan = validateMigrationHostDecommissionPlan(candidate);
    assertMigrationHostDecommissionPlanAgainstMigrationPlan({ migrationPlan, plan });
  } catch (cause) {
    fail("wakeflow-codex-migration-effect-plan", "Codex host plan is invalid or stale", cause);
  }
  if (plan.hostId !== WAKEFLOW_CODEX_MIGRATION_EFFECT_HOST_ID) {
    fail("wakeflow-codex-migration-effect-plan", "host plan is not the Codex migration owner");
  }
  return plan;
}

// 每个effect边界都重读宿主自己的legacy source plan，避免确认后source漂移仍触发归档。
function assertCurrentHostPlan(workspaceRoot, migrationPlan, hostPlan) {
  let current;
  try {
    current = inspectCodexMigrationDecommissionPlan({ migrationPlan, workspaceRoot });
  } catch (cause) {
    fail("wakeflow-codex-migration-effect-stale", "Codex legacy source set cannot be revalidated", cause);
  }
  if (!sameCanonical(current, hostPlan)) {
    fail("wakeflow-codex-migration-effect-stale", "Codex legacy source set differs from the frozen host plan");
  }
  return current;
}

// 二、把T07 subject确定性编译为T08 owner-effect计划；这里仍然零宿主副作用。

function intentDigest(migrationPlan, hostPlan, subject) {
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

function stepId(subject) {
  return `codex-host-effect-${subject.subjectId.slice("sha256:".length)}`;
}

function buildSnapshot(migrationPlan, hostPlan) {
  const subjects = hostPlan.subjects
    .filter((subject) => subject.effect === "archive")
    .map((subject) => ({
      effect: subject.effect,
      proofPolicy: subject.proofPolicy,
      sourceIds: subject.sourceIds,
      state: subject.state,
      subjectDigest: subject.subjectDigest,
      subjectId: subject.subjectId,
    }));
  const steps = subjects.map((subject, ordinal) => ({
    stepId: stepId(subject),
    ordinal,
    stepKind: "owner-effect",
    effectKind: "migration-host-decommission",
    intentDigest: intentDigest(migrationPlan, hostPlan, subject),
    checkpointSchemaId: CHECKPOINT_SCHEMA_ID,
    resultSchemaId: RESULT_SCHEMA_ID,
    outcomeSchemaId: OUTCOME_SCHEMA_ID,
  }));
  const snapshot = {
    schemaId: WAKEFLOW_CODEX_MIGRATION_EFFECT_PLAN_SCHEMA_ID,
    payload: {
      kind: "WakeflowCodexMigrationHostEffectPlan",
      schemaVersion: WAKEFLOW_CODEX_MIGRATION_EFFECT_SCHEMA_VERSION,
      hostId: WAKEFLOW_CODEX_MIGRATION_EFFECT_HOST_ID,
      migrationPlanDigest: migrationPlan.planDigest,
      hostPlanDigest: hostPlan.planDigest,
      subjects,
      steps,
    },
  };
  return {
    hostId: WAKEFLOW_CODEX_MIGRATION_EFFECT_HOST_ID,
    ownerId: OWNER_ID,
    snapshot,
    effectBindings: subjects.map((subject) => ({
      subjectId: subject.subjectId,
      stepId: stepId(subject),
    })),
  };
}

/**
 * 为全部Codex archive subject生成journal owner snapshot。
 * 输出只含opaque subject/source摘要，不携带thread handle或语义窗口名。
 */
export function planCodexMigrationHostEffects(value = {}) {
  exactKeys(value, ["workspaceRoot", "migrationPlan", "hostPlan"], "Codex migration effect planning input");
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const migrationPlan = validateWakeflowMigrationPlan(value.migrationPlan);
  const hostPlan = exactHostPlan(migrationPlan, value.hostPlan);
  assertCurrentHostPlan(workspaceRoot, migrationPlan, hostPlan);
  return deepFreeze(buildSnapshot(migrationPlan, hostPlan));
}

// 三、checkpoint/result/outcome只记录可持久化的宿主观察，不认证callback自身来源。

function ownerRecord(schemaId, payload) {
  return deepFreeze({
    schemaId,
    payload,
    recordDigest: canonicalJsonDigest({ schemaId, payload }),
  });
}

function validateOwnerRecord(value, schemaId, fields, label) {
  exactKeys(value, ["schemaId", "payload", "recordDigest"], label);
  if (value.schemaId !== schemaId || !DIGEST_RE.test(value.recordDigest)) {
    fail("wakeflow-codex-migration-effect-record", `${label} identity is invalid`);
  }
  exactKeys(value.payload, fields, `${label}.payload`);
  if (value.recordDigest !== canonicalJsonDigest({ schemaId, payload: value.payload })) {
    fail("wakeflow-codex-migration-effect-record", `${label} digest differs from its payload`);
  }
  return value;
}

function normalizeAdapterObservation(value, statuses, label) {
  exactKeys(value, ["status", "evidenceDigest"], label);
  if (
    !statuses.has(value.status)
    || (value.evidenceDigest !== null && !DIGEST_RE.test(value.evidenceDigest))
    || (EVIDENCE_REQUIRED_STATUSES.has(value.status) && value.evidenceDigest === null)
  ) {
    fail("wakeflow-codex-migration-effect-adapter", `${label} is outside the closed portable observation contract`);
  }
  return value;
}

function checkpointPayload(base, observation) {
  return {
    kind: "WakeflowCodexMigrationHostEffectCheckpoint",
    schemaVersion: 1,
    ...base,
    preflightStatus: observation.status,
    evidenceDigest: observation.evidenceDigest,
  };
}

function resultPayload(base, observation, mode) {
  return {
    kind: "WakeflowCodexMigrationHostEffectResult",
    schemaVersion: 1,
    ...base,
    mode,
    observationStatus: observation.status,
    evidenceDigest: observation.evidenceDigest,
  };
}

function validateCheckpoint(record, base) {
  validateOwnerRecord(record, CHECKPOINT_SCHEMA_ID, [
    "kind", "schemaVersion", "hostId", "migrationPlanDigest", "hostPlanDigest",
    "subjectId", "subjectDigest", "preflightStatus", "evidenceDigest",
  ], "Codex migration effect checkpoint");
  const expectedBase = { ...record.payload };
  delete expectedBase.kind;
  delete expectedBase.schemaVersion;
  delete expectedBase.preflightStatus;
  delete expectedBase.evidenceDigest;
  if (
    record.payload.kind !== "WakeflowCodexMigrationHostEffectCheckpoint"
    || record.payload.schemaVersion !== 1
    || !PREFLIGHT_STATUSES.has(record.payload.preflightStatus)
    || (record.payload.evidenceDigest !== null && !DIGEST_RE.test(record.payload.evidenceDigest))
    || (record.payload.preflightStatus === "ready" && record.payload.evidenceDigest === null)
    || !sameCanonical(expectedBase, base)
  ) fail("wakeflow-codex-migration-effect-record", "Codex migration effect checkpoint semantics are stale");
  return record;
}

function validateResult(record, base) {
  validateOwnerRecord(record, RESULT_SCHEMA_ID, [
    "kind", "schemaVersion", "hostId", "migrationPlanDigest", "hostPlanDigest",
    "subjectId", "subjectDigest", "mode", "observationStatus", "evidenceDigest",
  ], "Codex migration effect result");
  const expectedBase = { ...record.payload };
  for (const field of ["kind", "schemaVersion", "mode", "observationStatus", "evidenceDigest"]) delete expectedBase[field];
  if (
    record.payload.kind !== "WakeflowCodexMigrationHostEffectResult"
    || record.payload.schemaVersion !== 1
    || !new Set(["archive-call", "recovery-probe"]).has(record.payload.mode)
    || !OBSERVATION_STATUSES.has(record.payload.observationStatus)
    || (record.payload.evidenceDigest !== null && !DIGEST_RE.test(record.payload.evidenceDigest))
    || (record.payload.observationStatus === "archived" && record.payload.evidenceDigest === null)
    || !sameCanonical(expectedBase, base)
  ) fail("wakeflow-codex-migration-effect-record", "Codex migration effect result semantics are stale");
  return record;
}

function validateOutcome(record, base, acknowledgementDigest, checkpoint, result) {
  const exactCheckpoint = validateCheckpoint(checkpoint, base);
  const exactResult = validateResult(result, base);
  validateOwnerRecord(record, OUTCOME_SCHEMA_ID, [
    "kind", "schemaVersion", "hostId", "migrationPlanDigest", "hostPlanDigest",
    "subjectId", "subjectDigest", "preflightStatus", "observationStatus",
    "acknowledgementDigest", "status",
  ], "Codex migration effect outcome");
  const expectedBase = { ...record.payload };
  for (const field of [
    "kind", "schemaVersion", "preflightStatus", "observationStatus",
    "acknowledgementDigest", "status",
  ]) delete expectedBase[field];
  const admitted = record.payload.preflightStatus === "ready"
    && record.payload.observationStatus === "archived"
    && record.payload.acknowledgementDigest === acknowledgementDigest;
  if (
    record.payload.kind !== "WakeflowCodexMigrationHostEffectOutcome"
    || record.payload.schemaVersion !== 1
    || !PREFLIGHT_STATUSES.has(record.payload.preflightStatus)
    || !OBSERVATION_STATUSES.has(record.payload.observationStatus)
    || record.payload.acknowledgementDigest !== acknowledgementDigest
    || record.payload.preflightStatus !== exactCheckpoint.payload.preflightStatus
    || record.payload.observationStatus !== exactResult.payload.observationStatus
    || !sameCanonical(expectedBase, base)
    || record.payload.status !== (admitted ? "manual-host-gate-acknowledged" : "blocked")
  ) fail("wakeflow-codex-migration-effect-record", "Codex migration effect outcome semantics are stale");
  return record;
}

// workspace mutation会传入自己的plan与step；先以descriptor读取，避免行为型参数越过边界。
function callbackIdentity(args, snapshot, step, label) {
  const candidatePlan = ownDataField(
    args,
    "plan",
    label,
    "wakeflow-codex-migration-effect-callback",
  );
  const candidateStep = ownDataField(
    args,
    "step",
    label,
    "wakeflow-codex-migration-effect-callback",
  );
  if (!sameCanonical(candidatePlan, snapshot) || !sameCanonical(candidateStep, step)) {
    fail("wakeflow-codex-migration-effect-callback", `${label} received another owner plan or step`);
  }
}

/**
 * 组合Codex owner-effect participant。
 * prepare只做preflight，perform才调用一次archive，recover只复查而不重发archive；
 * 即使观察到archived，也必须绑定该subject的manual acknowledgement，最终仍是人工门。
 */
export function createCodexMigrationHostEffectParticipant(value = {}) {
  exactKeys(value, [
    "workspaceRoot", "migrationPlan", "hostPlan", "hostEffectSnapshot",
    "manualAcknowledgements", "adapter",
  ], "Codex migration effect participant input");
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const migrationPlan = validateWakeflowMigrationPlan(value.migrationPlan);
  const hostPlan = exactHostPlan(migrationPlan, value.hostPlan);
  const expected = planCodexMigrationHostEffects({ workspaceRoot, migrationPlan, hostPlan });
  if (!sameCanonical(value.hostEffectSnapshot, expected)) {
    fail("wakeflow-codex-migration-effect-stale", "Codex host effect snapshot differs from current T07 evidence");
  }
  const adapter = snapshotAdapter(value.adapter);
  const manualAcknowledgements = denseDataArray(
    value.manualAcknowledgements,
    "manualAcknowledgements",
  );
  const acknowledgementBySubject = new Map();
  for (const [index, acknowledgement] of manualAcknowledgements.entries()) {
    const subjectId = ownDataField(
      acknowledgement,
      "subjectId",
      `manualAcknowledgements/${index}`,
      "wakeflow-codex-migration-effect-acknowledgement",
    );
    const subject = hostPlan.subjects.find((entry) => entry.subjectId === subjectId);
    if (!subject || acknowledgementBySubject.has(subject.subjectId)) {
      fail("wakeflow-codex-migration-effect-acknowledgement", "Codex acknowledgement is duplicate or unknown");
    }
    const exact = createWakeflowMigrationManualAcknowledgement({
      migrationPlan,
      hostPlan,
      subjectId: subject.subjectId,
    });
    if (!sameCanonical(acknowledgement, exact)) {
      fail("wakeflow-codex-migration-effect-acknowledgement", "Codex acknowledgement is not the exact subject decision");
    }
    acknowledgementBySubject.set(subject.subjectId, exact);
  }
  const physicalSubjects = hostPlan.subjects.filter((subject) => subject.effect === "archive");
  if (acknowledgementBySubject.size !== physicalSubjects.length) {
    fail("wakeflow-codex-migration-effect-acknowledgement", "each Codex archive subject needs one exact manual acknowledgement");
  }

  const snapshot = expected.snapshot;
  const snapshotDigest = canonicalJsonDigest(snapshot);
  const subjectsById = new Map(physicalSubjects.map((subject) => [subject.subjectId, subject]));
  const effectSemanticsByStep = new Map();
  const stepHandlers = {};
  for (const step of snapshot.payload.steps) {
    const subject = subjectsById.get(expected.effectBindings.find((entry) => entry.stepId === step.stepId)?.subjectId);
    const acknowledgement = acknowledgementBySubject.get(subject.subjectId);
    const base = {
      hostId: WAKEFLOW_CODEX_MIGRATION_EFFECT_HOST_ID,
      migrationPlanDigest: migrationPlan.planDigest,
      hostPlanDigest: hostPlan.planDigest,
      subjectId: subject.subjectId,
      subjectDigest: subject.subjectDigest,
    };
    effectSemanticsByStep.set(step.stepId, { acknowledgement, base, step });
    const adapterArgs = () => deepFreeze({ workspaceRoot, migrationPlan, hostPlan, subject });
    stepHandlers[step.stepId] = Object.freeze({
      async prepareEffect(args) {
        // journal持久化effect-started之前只允许只读preflight。
        callbackIdentity(args, snapshot, step, "prepareEffect");
        assertCurrentHostPlan(workspaceRoot, migrationPlan, hostPlan);
        const observation = subject.state === "ready"
          ? normalizeAdapterObservation(await adapter.preflight(adapterArgs()), PREFLIGHT_STATUSES, "Codex preflight")
          : { status: "ambiguous", evidenceDigest: null };
        return ownerRecord(CHECKPOINT_SCHEMA_ID, checkpointPayload(base, observation));
      },
      async performEffect(args) {
        // 只有已持久化的ready checkpoint可以进入一次archive调用。
        callbackIdentity(args, snapshot, step, "performEffect");
        const checkpoint = validateCheckpoint(args.checkpoint, base);
        assertCurrentHostPlan(workspaceRoot, migrationPlan, hostPlan);
        const observation = checkpoint.payload.preflightStatus === "ready"
          ? normalizeAdapterObservation(await adapter.archive(adapterArgs()), OBSERVATION_STATUSES, "Codex archive")
          : { status: "not-attempted", evidenceDigest: null };
        return ownerRecord(RESULT_SCHEMA_ID, resultPayload(base, observation, "archive-call"));
      },
      async recoverEffect(args) {
        // 不可逆调用后的恢复只观察现状，绝不再次发送archive。
        callbackIdentity(args, snapshot, step, "recoverEffect");
        const checkpoint = validateCheckpoint(args.checkpoint, base);
        assertCurrentHostPlan(workspaceRoot, migrationPlan, hostPlan);
        const observation = checkpoint.payload.preflightStatus === "ready"
          ? normalizeAdapterObservation(await adapter.recover(adapterArgs()), OBSERVATION_STATUSES, "Codex recovery probe")
          : { status: "not-attempted", evidenceDigest: null };
        return ownerRecord(RESULT_SCHEMA_ID, resultPayload(base, observation, "recovery-probe"));
      },
      async observeEffect(args) {
        // outcome把宿主观察与人工确认绑定，但不提升为machine-verified。
        callbackIdentity(args, snapshot, step, "observeEffect");
        const checkpoint = validateCheckpoint(args.checkpoint, base);
        const result = validateResult(args.result, base);
        assertCurrentHostPlan(workspaceRoot, migrationPlan, hostPlan);
        const admitted = checkpoint.payload.preflightStatus === "ready"
          && result.payload.observationStatus === "archived";
        return ownerRecord(OUTCOME_SCHEMA_ID, {
          kind: "WakeflowCodexMigrationHostEffectOutcome",
          schemaVersion: 1,
          ...base,
          preflightStatus: checkpoint.payload.preflightStatus,
          observationStatus: result.payload.observationStatus,
          acknowledgementDigest: acknowledgement.acknowledgementDigest,
          status: admitted ? "manual-host-gate-acknowledged" : "blocked",
        });
      },
      async validateEffectCheckpoint({ record }) {
        validateCheckpoint(record, base);
        return { valid: true };
      },
      async validateEffectResult({ record }) {
        validateResult(record, base);
        return { valid: true };
      },
      async validateEffectOutcome({ checkpoint, result, record }) {
        validateOutcome(record, base, acknowledgement.acknowledgementDigest, checkpoint, result);
        return { valid: true };
      },
      async assertEffectOutcome({ checkpoint, result, outcome }) {
        const record = validateOutcome(
          outcome,
          base,
          acknowledgement.acknowledgementDigest,
          checkpoint,
          result,
        );
        return {
          admitted: record.payload.status === "manual-host-gate-acknowledged",
        };
      },
    });
  }

  return deepFreeze({
    hostId: WAKEFLOW_CODEX_MIGRATION_EFFECT_HOST_ID,
    snapshotDigest,
    participant: {
      validatePlan({ plan }) {
        if (!sameCanonical(plan, snapshot)) {
          fail("wakeflow-codex-migration-effect-stale", "Codex effect owner received another plan");
        }
        return { valid: true };
      },
      async deriveCurrentPlan() {
        return snapshot;
      },
      async deriveTerminalClosure({ planDigest, effectRecords }) {
        // 从全局journal中过滤本owner的exact step，并逐条重验三段record及人工门。
        if (planDigest !== snapshotDigest) {
          fail("wakeflow-codex-migration-effect-closure", "Codex effect closure received another plan");
        }
        const records = denseDataArray(
          effectRecords,
          "Codex migration effect closure records",
          "wakeflow-codex-migration-effect-closure",
        );
        const recordsByStep = new Map();
        for (const record of records) {
          if (!plainObject(record)) continue;
          const stepIdDescriptor = Object.getOwnPropertyDescriptor(record, "stepId");
          if (stepIdDescriptor && (
            !stepIdDescriptor.enumerable
            || !Object.hasOwn(stepIdDescriptor, "value")
          )) {
            fail("wakeflow-codex-migration-effect-closure", "Codex effect closure record stepId must be passive data");
          }
          const recordStepId = stepIdDescriptor?.value;
          if (!Object.hasOwn(stepHandlers, recordStepId)) continue;
          exactKeys(record, [
            "stepId", "ordinal", "effectKind", "intentDigest", "checkpoint", "result", "outcome",
          ], `Codex migration effect closure record ${recordStepId}`);
          if (recordsByStep.has(recordStepId)) {
            fail("wakeflow-codex-migration-effect-closure", "Codex effect closure contains a duplicate step");
          }
          recordsByStep.set(recordStepId, record);
        }
        if (recordsByStep.size !== snapshot.payload.steps.length) {
          fail("wakeflow-codex-migration-effect-closure", "Codex effect closure is incomplete");
        }
        const selected = snapshot.payload.steps.map((step) => {
          const record = recordsByStep.get(step.stepId);
          const semantics = effectSemanticsByStep.get(step.stepId);
          if (
            !record
            || !semantics
            || !Number.isSafeInteger(record.ordinal)
            || record.ordinal < 0
            || record.effectKind !== step.effectKind
            || record.intentDigest !== step.intentDigest
          ) fail("wakeflow-codex-migration-effect-closure", "Codex effect closure differs from its frozen step");
          const checkpoint = validateCheckpoint(record.checkpoint, semantics.base);
          const result = validateResult(record.result, semantics.base);
          const outcome = validateOutcome(
            record.outcome,
            semantics.base,
            semantics.acknowledgement.acknowledgementDigest,
            checkpoint,
            result,
          );
          if (outcome.payload.status !== "manual-host-gate-acknowledged") {
            fail("wakeflow-codex-migration-effect-closure", "Codex effect closure contains a blocked outcome");
          }
          return record;
        });
        return {
          planDigest,
          closureDigests: [{
            name: "codex-migration-host-effects",
            digest: canonicalJsonDigest({
              hostPlanDigest: hostPlan.planDigest,
              acknowledgements: snapshot.payload.steps.map((step) => (
                effectSemanticsByStep.get(step.stepId).acknowledgement
              )),
              effectRecords: selected,
            }),
          }],
        };
      },
      stepHandlers: Object.freeze(stepHandlers),
    },
  });
}
