import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  validateWakeflowMaintenancePlan,
  wakeflowMaintenancePlanDigest,
} from "./wakeflow-maintenance-plan.mjs";
import {
  assertWakeflowMutationContext,
} from "./wakeflow-workspace-mutation.mjs";

/**
 * 三类正常workspace维护动作的领域组合层。
 *
 * 职责导航：
 * 1. 把ready aggregate plan与每个component的owner snapshot绑定为confirmed action plan。
 * 2. 把多个owner participant收敛为一份完整、冻结的M3 participant表面。
 * 3. 为local layout签发只在本进程有效的transition scope，允许同一事务内识别合法中间态。
 * 4. 在apply时重新规划并比较完整confirmed plan；在recovery时只消费journal已绑定的snapshot。
 * 5. 不创建gate、journal或checkpoint；物理提交和恢复始终由workspace mutation manager拥有。
 */

// 一、confirmed action plan常量、错误合同与纯数据准入。
export const WAKEFLOW_CONFIRMED_ACTION_PLAN_SCHEMA_ID =
  "urn:wakeflow:internal:confirmed-maintenance-action-plan:v1";
export const WAKEFLOW_CONFIRMED_ACTION_PLAN_KIND = "WakeflowConfirmedMaintenanceActionPlan";
export const WAKEFLOW_CONFIRMED_ACTION_PLAN_SCHEMA_VERSION = 1;

const ACTIONS = new Set(["fresh-initialize", "reconfigure", "reconcile"]);
const ADMISSIONS = new Set(["apply", "recovery"]);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const ISSUED_LOCAL_TRANSITION_SCOPES = new WeakSet();

export class WakeflowMaintenanceActionCompositionError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowMaintenanceActionCompositionError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowMaintenanceActionCompositionError(code, message, {
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
  if (!plainObject(value)) {
    fail("wakeflow-maintenance-action-contract", `${label} must be one plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("wakeflow-maintenance-action-contract", `${label} has an invalid field set`, {
      details: { expected, actual: actual.map(String) },
    });
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-maintenance-action-contract", `${label}.${key} must be an enumerable data property`);
    }
  }
  return value;
}

function allowedKeys(value, allowed, label) {
  if (!plainObject(value)) {
    fail("wakeflow-maintenance-action-contract", `${label} must be one plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      fail("wakeflow-maintenance-action-contract", `${label} has an invalid field set`, {
        details: { allowed, actual: Reflect.ownKeys(value).map(String) },
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-maintenance-action-contract", `${label}.${key} must be an enumerable data property`);
    }
  }
  return value;
}

function dataProperty(value, key, label, { required = true } = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined && !required) return undefined;
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail(
      "wakeflow-maintenance-action-contract",
      `${label}.${key} must be an enumerable data property`,
    );
  }
  return descriptor.value;
}

function canonicalSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-maintenance-action-canonical", `${label} must be canonical JSON data`, { cause });
  }
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function snapshotSchemaId(snapshot) {
  if (!plainObject(snapshot) || typeof snapshot.schemaId !== "string" || !snapshot.schemaId.startsWith("urn:")) {
    fail("wakeflow-maintenance-action-owner-snapshot", "owner snapshot lacks one schema identity");
  }
  return snapshot.schemaId;
}

function normalizeOwnerSnapshotInput(value) {
  exactKeys(value, ["componentId", "owner", "snapshot"], "owner snapshot input");
  if (typeof value.componentId !== "string" || typeof value.owner !== "string") {
    fail("wakeflow-maintenance-action-owner-snapshot", "owner snapshot identity is invalid");
  }
  const snapshot = canonicalSnapshot(value.snapshot, "owner snapshot");
  return {
    componentId: value.componentId,
    owner: value.owner,
    schemaId: snapshotSchemaId(snapshot),
    snapshotDigest: canonicalJsonDigest(snapshot),
    snapshot,
  };
}

function validateOwnerSnapshot(value, component, previousComponentId) {
  exactKeys(
    value,
    ["componentId", "owner", "schemaId", "snapshotDigest", "snapshot"],
    "confirmed owner snapshot",
  );
  if (
    value.componentId !== component.componentId
    || value.owner !== component.owner
    || value.snapshotDigest !== component.ownerPlanDigest
    || value.schemaId !== snapshotSchemaId(value.snapshot)
    || value.snapshotDigest !== canonicalJsonDigest(value.snapshot)
    || !DIGEST_RE.test(value.snapshotDigest)
    || (previousComponentId !== null && lexicalCompare(previousComponentId, value.componentId) >= 0)
  ) {
    fail(
      "wakeflow-maintenance-action-owner-snapshot",
      "owner snapshot does not close its aggregate component",
      { details: { componentId: value.componentId } },
    );
  }
  return value.componentId;
}

/**
 * 校验一份外部回传或journal关联的confirmed action plan。
 *
 * 输入必须同时闭合ready aggregate、host/program/action元数据以及按component排序的owner snapshots。
 * 返回值是canonical深冻结副本；digest只证明字节身份，不能替代后续apply重规划或recovery admission。
 */
export function validateWakeflowConfirmedActionPlan(value) {
  const plan = canonicalSnapshot(value, "confirmed maintenance action plan");
  exactKeys(plan, ["schemaId", "payload"], "confirmed maintenance action plan");
  if (plan.schemaId !== WAKEFLOW_CONFIRMED_ACTION_PLAN_SCHEMA_ID) {
    fail("wakeflow-maintenance-action-plan", "confirmed action schema identity is invalid");
  }
  exactKeys(plan.payload, [
    "kind",
    "schemaVersion",
    "action",
    "programId",
    "host",
    "aggregatePlanDigest",
    "aggregatePlan",
    "ownerSnapshots",
  ], "confirmed maintenance action payload");
  const payload = plan.payload;
  let aggregate;
  try {
    aggregate = validateWakeflowMaintenancePlan(payload.aggregatePlan);
  } catch (cause) {
    fail("wakeflow-maintenance-action-plan", "aggregate maintenance plan is invalid", { cause });
  }
  if (
    payload.kind !== WAKEFLOW_CONFIRMED_ACTION_PLAN_KIND
    || payload.schemaVersion !== WAKEFLOW_CONFIRMED_ACTION_PLAN_SCHEMA_VERSION
    || !ACTIONS.has(payload.action)
    || payload.action !== aggregate.payload.action
    || payload.programId !== aggregate.payload.programId
    || payload.aggregatePlanDigest !== wakeflowMaintenancePlanDigest(aggregate)
    || aggregate.payload.status !== "ready"
    || !sameCanonical(payload.host, aggregate.payload.host)
    || !Array.isArray(payload.ownerSnapshots)
    || payload.ownerSnapshots.length !== aggregate.payload.components.length
  ) {
    fail("wakeflow-maintenance-action-plan", "confirmed action metadata is not derived from one ready aggregate");
  }
  let previousComponentId = null;
  for (const [index, component] of aggregate.payload.components.entries()) {
    previousComponentId = validateOwnerSnapshot(
      payload.ownerSnapshots[index],
      component,
      previousComponentId,
    );
  }
  return deepFreeze(plan);
}

/**
 * 从ready aggregate和各领域owner plan创建confirmed action plan。
 *
 * 该方法只冻结确认时的领域事实，不执行filesystem写入，也不签发mutation context。
 */
export function createWakeflowConfirmedActionPlan(value) {
  const input = exactKeys(
    value,
    ["aggregatePlan", "ownerSnapshots"],
    "confirmed maintenance action plan input",
  );
  let aggregate;
  try {
    aggregate = validateWakeflowMaintenancePlan(input.aggregatePlan);
  } catch (cause) {
    fail("wakeflow-maintenance-action-plan", "aggregate maintenance plan is invalid", { cause });
  }
  if (aggregate.payload.status !== "ready") {
    fail("wakeflow-maintenance-action-blocked", "a blocked aggregate cannot become a confirmed action plan");
  }
  if (!Array.isArray(input.ownerSnapshots)) {
    fail("wakeflow-maintenance-action-owner-snapshot", "ownerSnapshots must be one array");
  }
  const normalized = input.ownerSnapshots
    .map(normalizeOwnerSnapshotInput)
    .sort((left, right) => lexicalCompare(left.componentId, right.componentId));
  return validateWakeflowConfirmedActionPlan({
    schemaId: WAKEFLOW_CONFIRMED_ACTION_PLAN_SCHEMA_ID,
    payload: {
      kind: WAKEFLOW_CONFIRMED_ACTION_PLAN_KIND,
      schemaVersion: WAKEFLOW_CONFIRMED_ACTION_PLAN_SCHEMA_VERSION,
      action: aggregate.payload.action,
      programId: aggregate.payload.programId,
      host: aggregate.payload.host,
      aggregatePlanDigest: wakeflowMaintenancePlanDigest(aggregate),
      aggregatePlan: aggregate,
      ownerSnapshots: normalized,
    },
  });
}

// 二、仅供组合事务内部传递的local transition scope。

/**
 * 验证local layout收到的是本组合层真实签发的进程内scope。
 *
 * scope使用WeakSet品牌而不是可伪造JSON；它只解释同一M3事务的合法local中间态，不授予文件写入权。
 */
export function assertWakeflowMaintenanceLocalTransitionScope(value) {
  if (!plainObject(value) || !ISSUED_LOCAL_TRANSITION_SCOPES.has(value)) {
    fail(
      "wakeflow-maintenance-action-transition-scope",
      "local transition scope must be the exact immutable value issued by the action coordinator",
    );
  }
  return value;
}

function createLocalTransitionScope(aggregatePlan, aggregatePlanDigest) {
  const actionByStep = new Map(
    aggregatePlan.payload.filesystemActions
      .filter((entry) => entry.stepId !== null)
      .map((entry) => [entry.stepId, entry]),
  );
  const resources = [];
  for (const step of aggregatePlan.payload.steps) {
    const action = actionByStep.get(step.stepId);
    if (
      !action
      || step.stepKind !== "create-or-update"
      || step.final.type !== "file"
      || step.staging === null
      || !(action.ref === ".wakeflow-local" || action.ref.startsWith(".wakeflow-local/"))
      || step.final.ref !== action.resourceRef
      || !action.resourceRef.endsWith(action.ref)
    ) continue;
    const resourcePrefix = action.resourceRef.slice(0, -action.ref.length);
    if (!step.staging.ref.startsWith(resourcePrefix)) {
      fail("wakeflow-maintenance-action-transition-scope", "local staging ref differs from its aggregate action");
    }
    const stagingRef = step.staging.ref.slice(resourcePrefix.length);
    if (
      stagingRef === ".wakeflow-local"
      || !stagingRef.startsWith(".wakeflow-local/")
      || path.posix.normalize(stagingRef) !== stagingRef
    ) fail("wakeflow-maintenance-action-transition-scope", "local staging ref is not canonical");
    resources.push({
      componentId: action.componentId,
      owner: action.owner,
      finalRef: action.ref,
      stagingRef,
    });
  }
  resources.sort((left, right) => lexicalCompare(left.finalRef, right.finalRef));
  const scope = deepFreeze({
    kind: "WakeflowMaintenanceLocalTransitionScope",
    schemaVersion: 1,
    aggregatePlanDigest,
    resources,
  });
  ISSUED_LOCAL_TRANSITION_SCOPES.add(scope);
  return scope;
}

function normalizeWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) {
    fail("wakeflow-maintenance-action-workspace", "workspaceRoot must be one normalized absolute path");
  }
  return value;
}

// 三、owner participant的callable准入、观察映射与terminal closure聚合。

function validateParticipant(value, snapshotDigest, snapshot) {
  exactKeys(value, ["snapshotDigest", "participant"], "owner participant entry");
  if (value.snapshotDigest !== snapshotDigest || !plainObject(value.participant)) {
    fail("wakeflow-maintenance-action-participant", "owner participant identity is invalid");
  }
  const participant = value.participant;
  const validatePlan = dataProperty(participant, "validatePlan", "owner participant");
  const deriveCurrentPlan = dataProperty(participant, "deriveCurrentPlan", "owner participant");
  const deriveTerminalClosure = dataProperty(
    participant,
    "deriveTerminalClosure",
    "owner participant",
    { required: false },
  );
  const stepHandlers = dataProperty(participant, "stepHandlers", "owner participant");
  for (const [name, callback] of [["validatePlan", validatePlan], ["deriveCurrentPlan", deriveCurrentPlan]]) {
    if (typeof callback !== "function") {
      fail("wakeflow-maintenance-action-participant", `owner participant lacks ${name}()`);
    }
  }
  const ownerSteps = snapshot?.payload?.steps;
  if (
    !Array.isArray(ownerSteps)
    || (
      typeof deriveTerminalClosure !== "function"
      && !(ownerSteps.length === 0 && deriveTerminalClosure == null)
    )
  ) fail("wakeflow-maintenance-action-participant", "owner participant lacks deriveTerminalClosure()");
  if (!plainObject(stepHandlers)) {
    fail("wakeflow-maintenance-action-participant", "owner participant lacks stepHandlers");
  }
  return Object.freeze({
    validatePlan,
    deriveCurrentPlan,
    deriveTerminalClosure,
    stepHandlers,
  });
}

function validateOwnerCodec(participant, snapshot) {
  let result;
  try {
    result = participant.validatePlan({ plan: snapshot });
  } catch (cause) {
    fail("wakeflow-maintenance-action-owner-codec", "owner snapshot failed its participant codec", { cause });
  }
  exactKeys(result, ["valid"], "owner participant codec verdict");
  if (result.valid !== true) {
    fail("wakeflow-maintenance-action-owner-codec", "owner participant codec returned an invalid result");
  }
}

function stepSemantics(step) {
  const withoutRef = (node) => node === null
    ? null
    : Object.fromEntries(Object.entries(node).filter(([key]) => key !== "ref"));
  return {
    stepId: step.stepId,
    stepKind: step.stepKind,
    source: withoutRef(step.source),
    staging: withoutRef(step.staging),
    final: withoutRef(step.final),
  };
}

function mapObservationRef(observation, aggregateStep) {
  if (!plainObject(observation)) {
    fail("wakeflow-maintenance-action-observation", "owner observer returned an invalid observation");
  }
  exactKeys(observation, ["source", "staging", "final"], "owner step observation");
  const mapNode = (node, target) => {
    if (node === null || target === null) {
      if (node !== target) {
        fail("wakeflow-maintenance-action-observation", "owner observation staging shape is invalid");
      }
      return null;
    }
    const snapshot = canonicalSnapshot(node, "owner observation resource");
    if (!plainObject(snapshot) || typeof snapshot.ref !== "string") {
      fail("wakeflow-maintenance-action-observation", "owner observation resource is invalid");
    }
    return { ...snapshot, ref: target.ref };
  };
  return {
    source: mapNode(observation.source, aggregateStep.source),
    staging: mapNode(observation.staging, aggregateStep.staging),
    final: mapNode(observation.final, aggregateStep.final),
  };
}

function adaptStepHandler(handler, aggregateStep) {
  if (!plainObject(handler)) {
    fail("wakeflow-maintenance-action-handler", "owner step handler must be one plain object");
  }
  allowedKeys(handler, ["prepare", "observe", "commit", "cleanup"], "owner step handler");
  const callbacks = Object.fromEntries(
    ["prepare", "observe", "commit", "cleanup"].map((name) => [
      name,
      dataProperty(handler, name, "owner step handler", { required: name !== "cleanup" }),
    ]),
  );
  for (const required of ["prepare", "observe", "commit"]) {
    if (typeof callbacks[required] !== "function") {
      fail("wakeflow-maintenance-action-handler", `owner step handler lacks ${required}()`);
    }
  }
  const adapted = {
    async prepare(value) {
      return callbacks.prepare(value);
    },
    async observe(value) {
      return mapObservationRef(await callbacks.observe(value), aggregateStep);
    },
    async commit(value) {
      return callbacks.commit(value);
    },
  };
  if (callbacks.cleanup !== undefined && typeof callbacks.cleanup !== "function") {
    fail("wakeflow-maintenance-action-handler", "owner step handler cleanup must be one function");
  }
  if (typeof callbacks.cleanup === "function") {
    adapted.cleanup = async (value) => callbacks.cleanup(value);
  }
  return Object.freeze(adapted);
}

function validateClosure(value, snapshotDigest) {
  exactKeys(value, ["planDigest", "closureDigests"], "owner terminal closure");
  if (value.planDigest !== snapshotDigest || !Array.isArray(value.closureDigests)) {
    fail("wakeflow-maintenance-action-closure", "owner terminal closure has an invalid plan identity");
  }
  return value.closureDigests.map((entry) => {
    exactKeys(entry, ["name", "digest"], "owner closure digest");
    if (typeof entry.name !== "string" || !DIGEST_RE.test(entry.digest)) {
      fail("wakeflow-maintenance-action-closure", "owner closure digest is invalid");
    }
    return entry;
  });
}

/**
 * 把confirmed action plan覆盖的全部owner participants组合为一个M3 participant。
 *
 * apply要求replan与confirmed plan逐字节相同；recovery禁止replan并复用已确认snapshot。
 * 每个owner codec、step handler和closure都必须精确覆盖其snapshot，组合层只改写portable aggregate ref。
 * 返回值不持有workspace gate；所有callback仍必须通过workspace mutation manager签发的branded context运行。
 */
export function createWakeflowMaintenanceActionMutationParticipant(value) {
  const input = exactKeys(value, [
    "workspaceRoot",
    "admission",
    "confirmedActionPlan",
    "ownerParticipants",
    "replan",
  ], "maintenance action participant input");
  normalizeWorkspaceRoot(input.workspaceRoot);
  const confirmed = validateWakeflowConfirmedActionPlan(input.confirmedActionPlan);
  if (
    !ADMISSIONS.has(input.admission)
    || !Array.isArray(input.ownerParticipants)
    || (input.admission === "apply" && typeof input.replan !== "function")
    || (input.admission === "recovery" && input.replan !== null)
  ) {
    fail(
      "wakeflow-maintenance-action-participant",
      "apply requires replan while recovery requires the exact confirmed snapshots and a null replan",
    );
  }
  if (input.admission === "apply") {
    let replanned;
    try {
      replanned = validateWakeflowConfirmedActionPlan(input.replan());
    } catch (cause) {
      fail("wakeflow-maintenance-action-stale", "current action plan cannot be reconstructed", { cause });
    }
    if (!sameCanonical(replanned, confirmed)) {
      fail("wakeflow-maintenance-action-stale", "current action plan differs from the confirmed action plan");
    }
  }

  const uniqueSnapshots = new Map();
  for (const entry of confirmed.payload.ownerSnapshots) {
    const existing = uniqueSnapshots.get(entry.snapshotDigest);
    if (existing && !sameCanonical(existing.snapshot, entry.snapshot)) {
      fail("wakeflow-maintenance-action-owner-snapshot", "one digest identifies conflicting owner snapshots");
    }
    uniqueSnapshots.set(entry.snapshotDigest, entry);
  }
  const supplied = new Map();
  for (const entry of input.ownerParticipants) {
    exactKeys(entry, ["snapshotDigest", "participant"], "owner participant entry");
    if (typeof entry.snapshotDigest !== "string") {
      fail("wakeflow-maintenance-action-participant", "owner participant entry is invalid");
    }
    const ownerSnapshot = uniqueSnapshots.get(entry.snapshotDigest);
    if (!ownerSnapshot || supplied.has(entry.snapshotDigest)) {
      fail("wakeflow-maintenance-action-participant", "owner participant coverage is duplicate or unknown");
    }
    const participant = validateParticipant(entry, entry.snapshotDigest, ownerSnapshot.snapshot);
    validateOwnerCodec(participant, ownerSnapshot.snapshot);
    supplied.set(entry.snapshotDigest, participant);
  }
  if (supplied.size !== uniqueSnapshots.size) {
    fail("wakeflow-maintenance-action-participant", "owner participants do not cover every unique snapshot");
  }

  const aggregateSteps = new Map(
    confirmed.payload.aggregatePlan.payload.steps.map((step) => [step.stepId, step]),
  );
  const coveredSteps = new Set();
  const stepHandlers = {};
  for (const [snapshotDigest, entry] of uniqueSnapshots) {
    const participant = supplied.get(snapshotDigest);
    const ownerSteps = entry.snapshot?.payload?.steps;
    if (!Array.isArray(ownerSteps)) {
      fail("wakeflow-maintenance-action-owner-snapshot", "owner snapshot lacks a step collection");
    }
    const ownerStepIds = ownerSteps.map((step) => step.stepId).sort(lexicalCompare);
    exactKeys(participant.stepHandlers, ownerStepIds, "owner step handler map");
    for (const ownerStep of ownerSteps) {
      const aggregateStep = aggregateSteps.get(ownerStep.stepId);
      if (
        !aggregateStep
        || coveredSteps.has(ownerStep.stepId)
        || !sameCanonical(stepSemantics(ownerStep), stepSemantics(aggregateStep))
      ) {
        fail("wakeflow-maintenance-action-handler", "owner step does not map exactly to one aggregate step");
      }
      coveredSteps.add(ownerStep.stepId);
      stepHandlers[ownerStep.stepId] = adaptStepHandler(
        participant.stepHandlers[ownerStep.stepId],
        aggregateStep,
      );
    }
  }
  if (coveredSteps.size !== aggregateSteps.size) {
    fail("wakeflow-maintenance-action-handler", "aggregate steps are not fully covered by owner snapshots");
  }
  const aggregatePlan = confirmed.payload.aggregatePlan;
  const aggregateDigest = confirmed.payload.aggregatePlanDigest;
  const localTransitionScope = createLocalTransitionScope(aggregatePlan, aggregateDigest);
  const assertAdmissionContext = (context) => {
    if (context === null && input.admission === "recovery") return;
    try {
      assertWakeflowMutationContext({
        workspaceRoot: input.workspaceRoot,
        context,
        mode: input.admission === "apply" ? "maintenance" : "recovery-cleanup",
      });
    } catch (cause) {
      fail(
        "wakeflow-maintenance-action-admission",
        `maintenance action participant cannot run through ${input.admission === "apply" ? "recovery" : "normal apply"} admission`,
        { cause },
      );
    }
  };

  return Object.freeze({
    validatePlan({ plan }) {
      const candidate = validateWakeflowMaintenancePlan(plan);
      if (!sameCanonical(candidate, aggregatePlan)) {
        fail("wakeflow-maintenance-action-plan", "aggregate plan differs from the confirmed action contract");
      }
      return { valid: true };
    },

    async deriveCurrentPlan({ context }) {
      assertAdmissionContext(context);
      // Recovery preflight runs before M3 can issue the successor recovery gate.
      // The mutation manager has already bound the exact aggregate plan to the
      // durable journal at this point; domain owners must not weaken their
      // config checks to inspect an in-flight committed pair without a gate.
      // Revalidate every owner immediately after the recovery gate is issued,
      // before any domain step handler can run.
      if (input.admission === "recovery" && context === null) return aggregatePlan;
      for (const [snapshotDigest, entry] of uniqueSnapshots) {
        const participant = supplied.get(snapshotDigest);
        let current;
        try {
          current = await participant.deriveCurrentPlan({
            context,
            ...(input.admission === "recovery" ? { localTransitionScope } : {}),
          });
          validateOwnerCodec(participant, current);
        } catch (cause) {
          fail("wakeflow-maintenance-action-stale", "owner source changed since confirmation", { cause });
        }
        if (!sameCanonical(current, entry.snapshot)) {
          fail("wakeflow-maintenance-action-stale", "owner plan differs from its confirmed snapshot");
        }
      }
      return aggregatePlan;
    },

    async deriveTerminalClosure({ context, plan, planDigest }) {
      assertAdmissionContext(context);
      if (!sameCanonical(plan, aggregatePlan) || planDigest !== aggregateDigest) {
        fail("wakeflow-maintenance-action-plan", "terminal closure received another aggregate plan");
      }
      const byName = new Map();
      for (const [snapshotDigest, entry] of uniqueSnapshots) {
        const participant = supplied.get(snapshotDigest);
        let closure;
        try {
          if (typeof participant.deriveTerminalClosure === "function") {
            closure = await participant.deriveTerminalClosure({
              context,
              plan: entry.snapshot,
              planDigest: snapshotDigest,
              localTransitionScope,
            });
          } else {
            const current = await participant.deriveCurrentPlan({ context });
            validateOwnerCodec(participant, current);
            if (!sameCanonical(current, entry.snapshot)) {
              fail("wakeflow-maintenance-action-stale", "zero-step owner changed before terminal closure");
            }
            closure = {
              planDigest: snapshotDigest,
              closureDigests: [{
                name: `owner-noop-${snapshotDigest.slice("sha256:".length, "sha256:".length + 32)}`,
                digest: canonicalJsonDigest({
                  kind: "WakeflowZeroStepOwnerClosure",
                  schemaVersion: 1,
                  snapshotDigest,
                }),
              }],
            };
          }
        } catch (cause) {
          fail("wakeflow-maintenance-action-closure", "owner terminal closure failed", { cause });
        }
        for (const item of validateClosure(closure, snapshotDigest)) {
          const existing = byName.get(item.name);
          if (existing !== undefined && existing !== item.digest) {
            fail("wakeflow-maintenance-action-closure", "owner closure names conflict");
          }
          byName.set(item.name, item.digest);
        }
      }
      return {
        planDigest: aggregateDigest,
        closureDigests: [...byName]
          .sort(([left], [right]) => lexicalCompare(left, right))
          .map(([name, digest]) => ({ name, digest })),
      };
    },

    stepHandlers: Object.freeze(stepHandlers),
  });
}
