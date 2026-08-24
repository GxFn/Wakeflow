import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";

/**
 * Claude Code Pod宿主适配器的职责地图：
 * - 校验shared Pod service签发的候选计划并派生search/create操作；
 * - 通过显式注入的同步宿主回调先查唯一correlation，再恢复或创建Claude session；
 * - 把最终session和真实cwd规范化为领域观察，供Pod service另行写入证据、binding与state；
 * - 回调注入是in-process宿主边界，本文件不拥有全局session registry、异步队列或业务状态机。
 */

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze({ ...details });
  throw error;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Claude宿主边界先取得无行为JSON快照，计划和物理观察中的getter不能参与分支或摘要计算。
function canonicalDataSnapshot(value, code, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(code, `${label} must be canonical passive data`, { causeCode: cause?.code ?? null });
  }
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

// 回调本身不是JSON数据，因此只读取已经证明为own enumerable data property的函数引用。
function exactHostAdapters(value) {
  if (!plainObject(value)) {
    fail("invalid-host-adapter", "Claude Pod host adapters must be one plain object");
  }
  const expected = ["inspectExisting", "create"];
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length
    || keys.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("invalid-host-adapter", "Claude Pod host adapters must expose the exact callback set");
  }
  const callbacks = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor?.enumerable
      || !Object.hasOwn(descriptor, "value")
      || typeof descriptor.value !== "function"
    ) {
      fail("invalid-host-adapter", `${key} must be one own enumerable callback data property`);
    }
    callbacks[key] = descriptor.value;
  }
  return Object.freeze(callbacks);
}

function token(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > 4096
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail("invalid-host-observation", `${label} must be one bounded non-empty token`);
  }
  return value;
}

function finalSessionId(value) {
  const valueToken = token(value, "sessionId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(valueToken)) {
    fail("invalid-host-observation", "sessionId must be one final Claude session UUID");
  }
  return valueToken;
}

function planToken(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail("invalid-materialization-plan", `${label} is invalid`);
  }
  return value;
}

function exactPlanObject(value, required, optional, label) {
  if (!plainObject(value)) {
    fail("invalid-materialization-plan", `${label} must be one plain object`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    keys.length < required.length
    || keys.some((key) => !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("invalid-materialization-plan", `${label} has the wrong closed field set`);
  }
  return value;
}

function canonicalPlanRoot(value, label) {
  const root = token(value, label);
  if (!path.isAbsolute(root) || !existsSync(root) || realpathSync.native(root) !== root) {
    fail("invalid-materialization-plan", `${label} must be one existing canonical absolute root`);
  }
  return root;
}

function assertCandidateOperation(plan) {
  const operation = plan.operation;
  const common = [
    "role",
    "environmentIntent",
    "launchOperationId",
    "correlationId",
    "stateRootRef",
  ];
  const product = operation?.role === "product";
  exactPlanObject(
    operation,
    product
      ? [
          ...common,
          "repositoryId",
          "repositoryRoot",
          "repositorySourceDigest",
          "expectedBaseHead",
        ]
      : [...common, "controlRoot"],
    product ? ["hostResourceKey"] : [],
    "Claude Pod materialization operation",
  );
  planToken(
    operation.launchOperationId,
    /^pod-launch_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    "launchOperationId",
  );
  if (
    operation.correlationId !== operation.launchOperationId
    || operation.stateRootRef !== `.wakeflow-active/current/${plan.demandId}`
  ) {
    fail("invalid-materialization-plan", "Claude Pod operation correlation or state-root ref is invalid");
  }
  if (product) {
    if (
      operation.environmentIntent !== "host-worktree"
      || !/^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(operation.repositoryId)
      || !/^sha256:[0-9a-f]{64}$/u.test(operation.repositorySourceDigest)
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(operation.expectedBaseHead)
    ) {
      fail("invalid-materialization-plan", "Claude Pod product operation is incomplete or malformed");
    }
    canonicalPlanRoot(operation.repositoryRoot, "repositoryRoot");
    if (operation.hostResourceKey !== undefined) token(operation.hostResourceKey, "hostResourceKey");
  } else {
    if (
      !["controller", "design", "test"].includes(operation.role)
      || operation.environmentIntent !== "host-local"
    ) {
      fail("invalid-materialization-plan", "Claude Pod control operation role or environment is invalid");
    }
    canonicalPlanRoot(operation.controlRoot, "controlRoot");
  }
}

function exactCandidatePlan(value, modes) {
  value = canonicalDataSnapshot(
    value,
    "invalid-materialization-plan",
    "Claude Pod materialization plan",
  );
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-materialization-plan", "Claude Pod materialization requires one candidate plan object");
  }
  exactPlanObject(value, [
    "kind",
    "schemaVersion",
    "mode",
    "programId",
    "demandId",
    "hostId",
    "podId",
    "windowId",
    "bindingId",
    "configDigest",
    "state",
    "launchIntent",
    "materialization",
    "operation",
    "requiresHostOperationFence",
    "hostCreateAllowed",
    "recoveryOnly",
    "planDigest",
  ], [], "Claude Pod materialization plan");
  const { planDigest, ...unsigned } = value;
  const expectedFlags = value.mode === "host-create"
    ? [true, false, "creating"]
    : value.mode === "host-recovery"
      ? [false, true, "pending"]
      : [false, true, "finalized"];
  if (
    value.kind !== "WakeflowPodWindowMaterializationPlan"
    || value.schemaVersion !== 1
    || value.hostId !== "claude-code"
    || !modes.includes(value.mode)
    || value.requiresHostOperationFence !== true
    || typeof planDigest !== "string"
    || canonicalJsonDigest(unsigned) !== planDigest
    || value.hostCreateAllowed !== expectedFlags[0]
    || value.recoveryOnly !== expectedFlags[1]
    || value.materialization?.status !== expectedFlags[2]
    || value.launchIntent?.ref !== `.wakeflow-local/runtime/hosts/claude-code/evidence/pods/${value.podId}`
      + `/launch-intents/${value.operation?.launchOperationId}.json`
    || !/^sha256:[0-9a-f]{64}$/u.test(value.launchIntent?.digest)
  ) {
    fail(
      "invalid-materialization-plan",
      "Claude Pod materialization plan is stale, modified, or belongs to another host/mode",
    );
  }
  for (const [fieldValue, pattern, label] of [
    [value.programId, /^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "programId"],
    [value.demandId, /^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "demandId"],
    [value.podId, /^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "podId"],
    [value.windowId, /^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "windowId"],
    [value.bindingId, /^binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "bindingId"],
    [value.configDigest, /^sha256:[0-9a-f]{64}$/u, "configDigest"],
  ]) planToken(fieldValue, pattern, label);
  exactPlanObject(value.state, ["revision", "digest"], [], "Claude Pod source state");
  if (!Number.isInteger(value.state.revision) || value.state.revision < 1) {
    fail("invalid-materialization-plan", "Claude Pod source state revision is invalid");
  }
  planToken(value.state.digest, /^sha256:[0-9a-f]{64}$/u, "state.digest");
  assertCandidateOperation(value);
  return value;
}

function exactExistingSessions(value, correlationId) {
  const snapshot = canonicalDataSnapshot(
    value,
    "invalid-host-observation",
    "Claude existing-session observation",
  );
  const sessions = Array.isArray(snapshot)
    ? snapshot
    : Array.isArray(snapshot?.sessions)
      ? snapshot.sessions
      : [];
  return sessions.filter((entry) => (
    entry
    && typeof entry.sessionId === "string"
    && entry.sessionId.trim()
    && (entry.correlationId ?? entry.launchOperationId) === correlationId
  ));
}

function invokeSynchronous(callback, value, label) {
  if (typeof callback !== "function") {
    fail("invalid-host-adapter", `${label} must be one synchronous injected host callback`);
  }
  const result = callback(value);
  if (result instanceof Promise) {
    fail("async-host-adapter-forbidden", `${label} returned a Promise; Claude Pod creation is synchronous`);
  }
  return result;
}

function entryPrompt(plan) {
  return [
    "Wakeflow Pod entry synchronization only; do not execute product work.",
    `Program: ${plan.programId}`,
    `Demand: ${plan.demandId}`,
    `Window: ${plan.windowId}`,
    `Role: ${plan.operation.role}`,
    `State root: ${plan.operation.stateRootRef}`,
    `Wakeflow launch correlation: ${plan.operation.correlationId}`,
  ].join("\n");
}

// 将candidate plan降为Claude专用search/create描述；host-recovery计划绝不包含create授权。
export function planClaudePodMaterializationOperation(value) {
  const plan = exactCandidatePlan(value, ["host-create", "host-recovery"]);
  const product = plan.operation.role === "product";
  if (
    (plan.mode === "host-create" && (plan.hostCreateAllowed !== true || plan.recoveryOnly !== false))
    || (plan.mode === "host-recovery" && (plan.hostCreateAllowed !== false || plan.recoveryOnly !== true))
  ) {
    fail("host-create-not-authorized", "Claude Pod materialization flags differ from the admitted mode");
  }
  const unsigned = {
    kind: "WakeflowClaudePodMaterializationOperation",
    schemaVersion: 1,
    mode: plan.mode,
    sourcePlanDigest: plan.planDigest,
    windowId: plan.windowId,
    launchOperationId: plan.operation.launchOperationId,
    search: {
      correlationId: plan.operation.correlationId,
      cardinality: "zero-or-one",
      beforeCreate: true,
    },
    createAllowed: plan.mode === "host-create",
    ...(plan.mode === "host-create" ? {
      create: {
        role: plan.operation.role,
        prompt: entryPrompt(plan),
        stateRootRef: plan.operation.stateRootRef,
        environment: product
          ? {
              type: "host-worktree",
              repositoryRoot: plan.operation.repositoryRoot,
              expectedBaseHead: plan.operation.expectedBaseHead,
              ...(plan.operation.hostResourceKey === undefined
                ? {}
                : { hostResourceKey: plan.operation.hostResourceKey }),
            }
          : {
              type: "host-local",
              cwd: plan.operation.controlRoot,
            },
      },
    } : {}),
  };
  return deepFreeze({ ...unsigned, operationDigest: canonicalJsonDigest(unsigned) });
}

// 只接受最终Claude session及存在的canonical cwd，并回绑原launch correlation。
export function normalizeClaudePodCreationObservation(value, response = {}) {
  const plan = exactCandidatePlan(value, ["host-create", "host-recovery", "record-creation"]);
  response = canonicalDataSnapshot(
    response,
    "invalid-host-observation",
    "Claude Pod creation observation",
  );
  const sessionId = finalSessionId(response.sessionId);
  const actualCwdInput = token(response.actualCwd, "actualCwd");
  if (!existsSync(actualCwdInput)) {
    fail("invalid-host-observation", "Claude Pod final observation cwd does not exist");
  }
  const actualCwd = realpathSync.native(actualCwdInput);
  if (
    (response.correlationId ?? response.launchOperationId ?? plan.operation.correlationId)
      !== plan.operation.correlationId
  ) {
    fail("invalid-host-observation", "Claude Pod final observation belongs to another launch correlation");
  }
  return deepFreeze({
    status: "finalized",
    handle: { kind: "claude-session", value: sessionId },
    observation: {
      actualCwd,
      ...(response.hostCreatedAt === undefined
        ? {}
        : { hostCreatedAt: token(response.hostCreatedAt, "hostCreatedAt") }),
    },
  });
}

// 用调用方明确提供的同步adapter执行search-before-create；该seam不自行发现或缓存Claude宿主API。
export function executeClaudePodMaterialization(
  value,
  adapterValue = {},
) {
  const plan = exactCandidatePlan(value, ["host-create", "host-recovery"]);
  const { inspectExisting, create } = exactHostAdapters(adapterValue);
  const operation = planClaudePodMaterializationOperation(plan);
  const inspected = invokeSynchronous(
    inspectExisting,
    operation.search,
    "inspectExisting",
  );
  const matches = exactExistingSessions(inspected, plan.operation.correlationId);
  if (matches.length > 1) {
    fail(
      "recovery-not-unique",
      "multiple Claude sessions match the exact Pod launch correlation",
      { matchCount: matches.length },
    );
  }
  if (matches.length === 1) {
    return deepFreeze({
      ...normalizeClaudePodCreationObservation(plan, matches[0]),
      recovered: true,
    });
  }
  if (plan.mode === "host-recovery") {
    fail("recovery-not-found", "no Claude session matches the exact Pod launch correlation");
  }
  const created = invokeSynchronous(create, operation.create, "create");
  return deepFreeze({
    ...normalizeClaudePodCreationObservation(plan, created),
    recovered: false,
  });
}
