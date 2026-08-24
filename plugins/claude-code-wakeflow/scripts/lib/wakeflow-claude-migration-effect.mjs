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
  inspectClaudeMigrationDecommissionPlan,
} from "./wakeflow-claude-migration-decommission.mjs";

// 本文件是Claude legacy session关闭的T08宿主effect owner：消费T07冻结的HostPlan，
// 在唯一workspace mutation journal中串起pre-close、close与bounded post-close observation。
// 阅读顺序：输入/回调准入 → effect snapshot → checkpoint/result/outcome codec → participant与terminal closure。
// 它不枚举legacy source、不自行解析或持久化raw tmux locator，也不把recovery absence冒充close成功。

export const WAKEFLOW_CLAUDE_MIGRATION_EFFECT_HOST_ID = "claude-code";
export const WAKEFLOW_CLAUDE_MIGRATION_EFFECT_SCHEMA_VERSION = 1;
export const WAKEFLOW_CLAUDE_MIGRATION_EFFECT_PLAN_SCHEMA_ID =
  "urn:wakeflow:internal:claude-migration-host-effect-plan:v1";

const CHECKPOINT_SCHEMA_ID = "urn:wakeflow:internal:claude-migration-host-effect-checkpoint:v1";
const RESULT_SCHEMA_ID = "urn:wakeflow:internal:claude-migration-host-effect-result:v1";
const OUTCOME_SCHEMA_ID = "urn:wakeflow:internal:claude-migration-host-effect-outcome:v1";
const OWNER_ID = "claude-migration-host-effect";
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const PRE_CLOSE_STATUSES = new Set(["ambiguous", "live", "missing", "unavailable"]);
const CLOSE_STATUSES = new Set(["failed", "not-attempted", "succeeded", "unavailable"]);
const PROBE_STATUSES = new Set(["absent", "ambiguous", "not-attempted", "present", "unavailable"]);
const OBSERVED_PROBE_STATUSES = new Set(["absent", "ambiguous", "present", "unavailable"]);
const EVIDENCE_REQUIRED_STATUSES = new Set(["absent", "live", "succeeded"]);

export class WakeflowClaudeMigrationEffectError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowClaudeMigrationEffectError";
    this.code = code;
  }
}

// 一、无行为输入准入与可复用的纯数据辅助。

function fail(code, message, cause = undefined) {
  throw new WakeflowClaudeMigrationEffectError(code, message, { cause });
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
  if (!plainObject(value)) fail("wakeflow-claude-migration-effect-contract", `${label} must be one plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) fail("wakeflow-claude-migration-effect-contract", `${label} has an invalid field set`);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-claude-migration-effect-contract", `${label}.${key} must be an enumerable data field`);
    }
  }
  return value;
}

function denseDataArray(value, label, code = "wakeflow-claude-migration-effect-contract") {
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
  const names = ["preflight", "close", "recover", "postClose"];
  exactKeys(value, names, "Claude migration effect adapter");
  const callbacks = {};
  for (const name of names) {
    if (typeof value[name] !== "function") {
      fail("wakeflow-claude-migration-effect-adapter", `Claude adapter.${name} must be one function`);
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
  ) fail("wakeflow-claude-migration-effect-workspace", "workspaceRoot must be one normalized absolute path");
  return value;
}

function exactHostPlan(migrationPlan, candidate) {
  let plan;
  try {
    plan = validateMigrationHostDecommissionPlan(candidate);
    assertMigrationHostDecommissionPlanAgainstMigrationPlan({ migrationPlan, plan });
  } catch (cause) {
    fail("wakeflow-claude-migration-effect-plan", "Claude host plan is invalid or stale", cause);
  }
  if (plan.hostId !== WAKEFLOW_CLAUDE_MIGRATION_EFFECT_HOST_ID) {
    fail("wakeflow-claude-migration-effect-plan", "host plan is not the Claude migration owner");
  }
  return plan;
}

// 每个effect边界都重读宿主自己的legacy source plan，避免确认后source漂移仍触发关闭。
function assertCurrentHostPlan(workspaceRoot, migrationPlan, hostPlan) {
  let current;
  try {
    current = inspectClaudeMigrationDecommissionPlan({ migrationPlan, workspaceRoot });
  } catch (cause) {
    fail("wakeflow-claude-migration-effect-stale", "Claude legacy source set cannot be revalidated", cause);
  }
  if (!sameCanonical(current, hostPlan)) {
    fail("wakeflow-claude-migration-effect-stale", "Claude legacy source set differs from the frozen host plan");
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
  return `claude-host-effect-${subject.subjectId.slice("sha256:".length)}`;
}

function buildSnapshot(migrationPlan, hostPlan) {
  const subjects = hostPlan.subjects
    .filter((subject) => subject.effect === "close")
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
    schemaId: WAKEFLOW_CLAUDE_MIGRATION_EFFECT_PLAN_SCHEMA_ID,
    payload: {
      kind: "WakeflowClaudeMigrationHostEffectPlan",
      schemaVersion: WAKEFLOW_CLAUDE_MIGRATION_EFFECT_SCHEMA_VERSION,
      hostId: WAKEFLOW_CLAUDE_MIGRATION_EFFECT_HOST_ID,
      migrationPlanDigest: migrationPlan.planDigest,
      hostPlanDigest: hostPlan.planDigest,
      subjects,
      steps,
    },
  };
  return {
    hostId: WAKEFLOW_CLAUDE_MIGRATION_EFFECT_HOST_ID,
    ownerId: OWNER_ID,
    snapshot,
    effectBindings: subjects.map((subject) => ({
      subjectId: subject.subjectId,
      stepId: stepId(subject),
    })),
  };
}

/**
 * 为全部Claude close subject生成journal owner snapshot。
 * 输出只含opaque subject/source摘要，不携带socket、session、window、pane或PID。
 */
export function planClaudeMigrationHostEffects(value = {}) {
  exactKeys(value, ["workspaceRoot", "migrationPlan", "hostPlan"], "Claude migration effect planning input");
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const migrationPlan = validateWakeflowMigrationPlan(value.migrationPlan);
  const hostPlan = exactHostPlan(migrationPlan, value.hostPlan);
  assertCurrentHostPlan(workspaceRoot, migrationPlan, hostPlan);
  return deepFreeze(buildSnapshot(migrationPlan, hostPlan));
}

// 三、checkpoint/result/outcome分别冻结effect前、effect后和post-close证据。

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
    fail("wakeflow-claude-migration-effect-record", `${label} identity is invalid`);
  }
  exactKeys(value.payload, fields, `${label}.payload`);
  if (value.recordDigest !== canonicalJsonDigest({ schemaId, payload: value.payload })) {
    fail("wakeflow-claude-migration-effect-record", `${label} digest differs from its payload`);
  }
  return value;
}

function normalizeObservation(value, statuses, label) {
  exactKeys(value, ["status", "evidenceDigest"], label);
  if (
    !statuses.has(value.status)
    || (value.evidenceDigest !== null && !DIGEST_RE.test(value.evidenceDigest))
    || (EVIDENCE_REQUIRED_STATUSES.has(value.status) && value.evidenceDigest === null)
  ) {
    fail("wakeflow-claude-migration-effect-adapter", `${label} is outside the closed portable observation contract`);
  }
  return value;
}

function normalizePostClose(value, label) {
  exactKeys(value, ["status", "attempts", "evidenceDigest"], label);
  if (
    !OBSERVED_PROBE_STATUSES.has(value.status)
    || !Number.isInteger(value.attempts)
    || value.attempts < 1
    || value.attempts > 8
    || (value.evidenceDigest !== null && !DIGEST_RE.test(value.evidenceDigest))
    || (value.status === "absent" && value.evidenceDigest === null)
  ) fail("wakeflow-claude-migration-effect-adapter", `${label} is outside the bounded post-close contract`);
  return value;
}

function validateCheckpoint(record, base) {
  validateOwnerRecord(record, CHECKPOINT_SCHEMA_ID, [
    "kind", "schemaVersion", "hostId", "migrationPlanDigest", "hostPlanDigest",
    "subjectId", "subjectDigest", "preCloseStatus", "evidenceDigest",
  ], "Claude migration effect checkpoint");
  const expectedBase = { ...record.payload };
  for (const field of ["kind", "schemaVersion", "preCloseStatus", "evidenceDigest"]) delete expectedBase[field];
  if (
    record.payload.kind !== "WakeflowClaudeMigrationHostEffectCheckpoint"
    || record.payload.schemaVersion !== 1
    || !PRE_CLOSE_STATUSES.has(record.payload.preCloseStatus)
    || (record.payload.evidenceDigest !== null && !DIGEST_RE.test(record.payload.evidenceDigest))
    || (record.payload.preCloseStatus === "live" && record.payload.evidenceDigest === null)
    || !sameCanonical(expectedBase, base)
  ) fail("wakeflow-claude-migration-effect-record", "Claude migration effect checkpoint semantics are stale");
  return record;
}

function validateResult(record, base) {
  validateOwnerRecord(record, RESULT_SCHEMA_ID, [
    "kind", "schemaVersion", "hostId", "migrationPlanDigest", "hostPlanDigest",
    "subjectId", "subjectDigest", "mode", "closeStatus", "recoveryStatus", "evidenceDigest",
  ], "Claude migration effect result");
  const expectedBase = { ...record.payload };
  for (const field of ["kind", "schemaVersion", "mode", "closeStatus", "recoveryStatus", "evidenceDigest"]) delete expectedBase[field];
  const modeValid = (
    record.payload.mode === "close-call"
    && CLOSE_STATUSES.has(record.payload.closeStatus)
    && record.payload.recoveryStatus === "not-attempted"
  ) || (
    record.payload.mode === "recovery-probe"
    && record.payload.closeStatus === "unavailable"
    && PROBE_STATUSES.has(record.payload.recoveryStatus)
    && record.payload.recoveryStatus !== "not-attempted"
  );
  if (
    record.payload.kind !== "WakeflowClaudeMigrationHostEffectResult"
    || record.payload.schemaVersion !== 1
    || !modeValid
    || (record.payload.evidenceDigest !== null && !DIGEST_RE.test(record.payload.evidenceDigest))
    || (
      (record.payload.closeStatus === "succeeded" || record.payload.recoveryStatus === "absent")
      && record.payload.evidenceDigest === null
    )
    || !sameCanonical(expectedBase, base)
  ) fail("wakeflow-claude-migration-effect-record", "Claude migration effect result semantics are stale");
  return record;
}

function machineVerified(checkpoint, result, outcomePayload) {
  // 三段都必须有证据摘要；只有同一次正常close-call可以得到机器证明。
  return checkpoint.payload.preCloseStatus === "live"
    && checkpoint.payload.evidenceDigest !== null
    && result.payload.mode === "close-call"
    && result.payload.closeStatus === "succeeded"
    && result.payload.evidenceDigest !== null
    && outcomePayload.postCloseStatus === "absent"
    && outcomePayload.postCloseAttempts >= 1
    && outcomePayload.evidenceDigest !== null;
}

function reasonCode(checkpoint, result, postClose) {
  if (checkpoint.payload.preCloseStatus === "missing") return "claude-preclose-missing";
  if (checkpoint.payload.preCloseStatus !== "live") return "claude-preclose-ambiguous";
  if (result.payload.mode === "recovery-probe") return "claude-close-unconfirmed-after-recovery";
  if (result.payload.closeStatus !== "succeeded") return "claude-close-failed";
  if (postClose.status === "present") return "claude-postclose-present";
  return "claude-postclose-ambiguous";
}

function validateOutcome(record, base, checkpoint, result) {
  validateOwnerRecord(record, OUTCOME_SCHEMA_ID, [
    "kind", "schemaVersion", "hostId", "migrationPlanDigest", "hostPlanDigest",
    "subjectId", "subjectDigest", "mode", "preCloseStatus", "effectCheckpoint",
    "closeStatus", "postCloseStatus", "postCloseAttempts", "evidenceDigest",
    "status", "reasonCode",
  ], "Claude migration effect outcome");
  const expectedBase = { ...record.payload };
  for (const field of [
    "kind", "schemaVersion", "mode", "preCloseStatus", "effectCheckpoint",
    "closeStatus", "postCloseStatus", "postCloseAttempts", "evidenceDigest",
    "status", "reasonCode",
  ]) delete expectedBase[field];
  const verified = machineVerified(checkpoint, result, record.payload);
  const expectedCheckpoint = result.payload.mode === "recovery-probe"
    ? "started"
    : checkpoint.payload.preCloseStatus === "live"
      ? "completed"
      : "not-started";
  const expectedReason = verified ? null : reasonCode(checkpoint, result, {
    status: record.payload.postCloseStatus,
  });
  const postCloseShapeValid = record.payload.postCloseStatus === "not-attempted"
    ? record.payload.postCloseAttempts === 0 && record.payload.evidenceDigest === null
    : OBSERVED_PROBE_STATUSES.has(record.payload.postCloseStatus)
      && record.payload.postCloseAttempts >= 1;
  if (
    record.payload.kind !== "WakeflowClaudeMigrationHostEffectOutcome"
    || record.payload.schemaVersion !== 1
    || record.payload.mode !== result.payload.mode
    || record.payload.preCloseStatus !== checkpoint.payload.preCloseStatus
    || record.payload.effectCheckpoint !== expectedCheckpoint
    || record.payload.closeStatus !== result.payload.closeStatus
    || !postCloseShapeValid
    || !Number.isInteger(record.payload.postCloseAttempts)
    || record.payload.postCloseAttempts < 0
    || record.payload.postCloseAttempts > 8
    || (record.payload.evidenceDigest !== null && !DIGEST_RE.test(record.payload.evidenceDigest))
    || !sameCanonical(expectedBase, base)
    || record.payload.status !== (verified ? "machine-verified" : "blocked")
    || record.payload.reasonCode !== expectedReason
  ) fail("wakeflow-claude-migration-effect-record", "Claude migration effect outcome semantics are stale");
  return record;
}

function callbackIdentity(args, snapshot, step, label) {
  const candidatePlan = ownDataField(
    args,
    "plan",
    label,
    "wakeflow-claude-migration-effect-callback",
  );
  const candidateStep = ownDataField(
    args,
    "step",
    label,
    "wakeflow-claude-migration-effect-callback",
  );
  if (!sameCanonical(candidatePlan, snapshot) || !sameCanonical(candidateStep, step)) {
    fail("wakeflow-claude-migration-effect-callback", `${label} received another owner plan or step`);
  }
}

/**
 * 组合Claude owner-effect participant。
 * prepare只观察live，perform只调用一次close，observe执行bounded absence probe；
 * recover只探测既有结果，哪怕对象已不存在也固定blocked，避免把未知关闭来源升级为机器证明。
 */
export function createClaudeMigrationHostEffectParticipant(value = {}) {
  exactKeys(value, [
    "workspaceRoot", "migrationPlan", "hostPlan", "hostEffectSnapshot", "adapter",
  ], "Claude migration effect participant input");
  const workspaceRoot = normalizeWorkspaceRoot(value.workspaceRoot);
  const migrationPlan = validateWakeflowMigrationPlan(value.migrationPlan);
  const hostPlan = exactHostPlan(migrationPlan, value.hostPlan);
  const expected = planClaudeMigrationHostEffects({ workspaceRoot, migrationPlan, hostPlan });
  if (!sameCanonical(value.hostEffectSnapshot, expected)) {
    fail("wakeflow-claude-migration-effect-stale", "Claude host effect snapshot differs from current T07 evidence");
  }
  const adapter = snapshotAdapter(value.adapter);

  const snapshot = expected.snapshot;
  const snapshotDigest = canonicalJsonDigest(snapshot);
  const subjectsById = new Map(hostPlan.subjects
    .filter((subject) => subject.effect === "close")
    .map((subject) => [subject.subjectId, subject]));
  const effectSemanticsByStep = new Map();
  const stepHandlers = {};
  for (const step of snapshot.payload.steps) {
    const subject = subjectsById.get(expected.effectBindings.find((entry) => entry.stepId === step.stepId)?.subjectId);
    const base = {
      hostId: WAKEFLOW_CLAUDE_MIGRATION_EFFECT_HOST_ID,
      migrationPlanDigest: migrationPlan.planDigest,
      hostPlanDigest: hostPlan.planDigest,
      subjectId: subject.subjectId,
      subjectDigest: subject.subjectDigest,
    };
    effectSemanticsByStep.set(step.stepId, { base, step });
    const adapterArgs = () => deepFreeze({ workspaceRoot, migrationPlan, hostPlan, subject });
    stepHandlers[step.stepId] = Object.freeze({
      async prepareEffect(args) {
        // journal持久化effect-started之前只允许只读pre-close observation。
        callbackIdentity(args, snapshot, step, "prepareEffect");
        assertCurrentHostPlan(workspaceRoot, migrationPlan, hostPlan);
        const observation = subject.state === "ready"
          ? normalizeObservation(await adapter.preflight(adapterArgs()), PRE_CLOSE_STATUSES, "Claude preflight")
          : { status: "ambiguous", evidenceDigest: null };
        return ownerRecord(CHECKPOINT_SCHEMA_ID, {
          kind: "WakeflowClaudeMigrationHostEffectCheckpoint",
          schemaVersion: 1,
          ...base,
          preCloseStatus: observation.status,
          evidenceDigest: observation.evidenceDigest,
        });
      },
      async performEffect(args) {
        // 只有带证据的live checkpoint可以进入一次close调用。
        callbackIdentity(args, snapshot, step, "performEffect");
        const checkpoint = validateCheckpoint(args.checkpoint, base);
        assertCurrentHostPlan(workspaceRoot, migrationPlan, hostPlan);
        const observation = checkpoint.payload.preCloseStatus === "live"
          ? normalizeObservation(await adapter.close(adapterArgs()), CLOSE_STATUSES, "Claude close")
          : { status: "not-attempted", evidenceDigest: null };
        return ownerRecord(RESULT_SCHEMA_ID, {
          kind: "WakeflowClaudeMigrationHostEffectResult",
          schemaVersion: 1,
          ...base,
          mode: "close-call",
          closeStatus: observation.status,
          recoveryStatus: "not-attempted",
          evidenceDigest: observation.evidenceDigest,
        });
      },
      async recoverEffect(args) {
        // effect-started崩溃后的恢复只探测，不重发不可逆close。
        callbackIdentity(args, snapshot, step, "recoverEffect");
        validateCheckpoint(args.checkpoint, base);
        assertCurrentHostPlan(workspaceRoot, migrationPlan, hostPlan);
        const observation = normalizeObservation(
          await adapter.recover(adapterArgs()),
          new Set(["absent", "ambiguous", "present", "unavailable"]),
          "Claude recovery probe",
        );
        return ownerRecord(RESULT_SCHEMA_ID, {
          kind: "WakeflowClaudeMigrationHostEffectResult",
          schemaVersion: 1,
          ...base,
          mode: "recovery-probe",
          closeStatus: "unavailable",
          recoveryStatus: observation.status,
          evidenceDigest: observation.evidenceDigest,
        });
      },
      async observeEffect(args) {
        // 正常close与恢复都可post-probe，但只有正常close完整三段可machine-verified。
        callbackIdentity(args, snapshot, step, "observeEffect");
        const checkpoint = validateCheckpoint(args.checkpoint, base);
        const result = validateResult(args.result, base);
        assertCurrentHostPlan(workspaceRoot, migrationPlan, hostPlan);
        const shouldProbe = checkpoint.payload.preCloseStatus === "live"
          && (result.payload.mode === "recovery-probe" || result.payload.closeStatus === "succeeded");
        const postClose = shouldProbe
          ? normalizePostClose(await adapter.postClose(adapterArgs()), "Claude post-close probe")
          : { status: "not-attempted", attempts: 0, evidenceDigest: null };
        const candidate = {
          kind: "WakeflowClaudeMigrationHostEffectOutcome",
          schemaVersion: 1,
          ...base,
          mode: result.payload.mode,
          preCloseStatus: checkpoint.payload.preCloseStatus,
          effectCheckpoint: result.payload.mode === "recovery-probe"
            ? "started"
            : checkpoint.payload.preCloseStatus === "live"
              ? "completed"
              : "not-started",
          closeStatus: result.payload.closeStatus,
          postCloseStatus: postClose.status,
          postCloseAttempts: postClose.attempts,
          evidenceDigest: postClose.evidenceDigest,
        };
        const verified = machineVerified(checkpoint, result, candidate);
        return ownerRecord(OUTCOME_SCHEMA_ID, {
          ...candidate,
          status: verified ? "machine-verified" : "blocked",
          reasonCode: verified ? null : reasonCode(checkpoint, result, postClose),
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
        validateOutcome(record, base, validateCheckpoint(checkpoint, base), validateResult(result, base));
        return { valid: true };
      },
      async assertEffectOutcome({ checkpoint, result, outcome }) {
        const record = validateOutcome(
          outcome,
          base,
          validateCheckpoint(checkpoint, base),
          validateResult(result, base),
        );
        return { admitted: record.payload.status === "machine-verified" };
      },
    });
  }

  return deepFreeze({
    hostId: WAKEFLOW_CLAUDE_MIGRATION_EFFECT_HOST_ID,
    snapshotDigest,
    participant: {
      validatePlan({ plan }) {
        if (!sameCanonical(plan, snapshot)) {
          fail("wakeflow-claude-migration-effect-stale", "Claude effect owner received another plan");
        }
        return { valid: true };
      },
      async deriveCurrentPlan() {
        return snapshot;
      },
      async deriveTerminalClosure({ planDigest, effectRecords }) {
        // 从全局journal中过滤本owner的exact step，并逐条重验三段I3 record。
        if (planDigest !== snapshotDigest) {
          fail("wakeflow-claude-migration-effect-closure", "Claude effect closure received another plan");
        }
        const records = denseDataArray(
          effectRecords,
          "Claude migration effect closure records",
          "wakeflow-claude-migration-effect-closure",
        );
        const recordsByStep = new Map();
        for (const record of records) {
          if (!plainObject(record)) continue;
          const stepIdDescriptor = Object.getOwnPropertyDescriptor(record, "stepId");
          if (stepIdDescriptor && (
            !stepIdDescriptor.enumerable
            || !Object.hasOwn(stepIdDescriptor, "value")
          )) {
            fail("wakeflow-claude-migration-effect-closure", "Claude effect closure record stepId must be passive data");
          }
          const recordStepId = stepIdDescriptor?.value;
          if (!Object.hasOwn(stepHandlers, recordStepId)) continue;
          exactKeys(record, [
            "stepId", "ordinal", "effectKind", "intentDigest", "checkpoint", "result", "outcome",
          ], `Claude migration effect closure record ${recordStepId}`);
          if (recordsByStep.has(recordStepId)) {
            fail("wakeflow-claude-migration-effect-closure", "Claude effect closure contains a duplicate step");
          }
          recordsByStep.set(recordStepId, record);
        }
        if (recordsByStep.size !== snapshot.payload.steps.length) {
          fail("wakeflow-claude-migration-effect-closure", "Claude effect closure is incomplete");
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
          ) fail("wakeflow-claude-migration-effect-closure", "Claude effect closure differs from its frozen step");
          const checkpoint = validateCheckpoint(record.checkpoint, semantics.base);
          const result = validateResult(record.result, semantics.base);
          const outcome = validateOutcome(record.outcome, semantics.base, checkpoint, result);
          if (outcome.payload.status !== "machine-verified") {
            fail("wakeflow-claude-migration-effect-closure", "Claude effect closure contains a blocked outcome");
          }
          return record;
        });
        return {
          planDigest,
          closureDigests: [{
            name: "claude-migration-host-effects",
            digest: canonicalJsonDigest({
              hostPlanDigest: hostPlan.planDigest,
              effectRecords: selected,
            }),
          }],
        };
      },
      stepHandlers: Object.freeze(stepHandlers),
    },
  });
}
