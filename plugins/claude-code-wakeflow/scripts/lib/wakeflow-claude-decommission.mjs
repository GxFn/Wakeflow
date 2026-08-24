import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  createHostDecommissionResult,
} from "./wakeflow-host-decommission-result.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { assertWindowBindingId } from "./wakeflow-window-binding-records.mjs";
import {
  claudeWindowLocatorDigest,
  inspectClaudeWindowLocatorObservation,
  recoverClaudeWindowOperationMutex,
  resolveClaudeWindowOperationEndpoint,
  validateClaudeWindowLocatorRecord,
  withClaudeWindowOperationMutex,
} from "./wakeflow-claude-locator.mjs";

// 本模块是Claude普通窗口decommission owner：在exact locator operation mutex内先证明目标
// 唯一且live，再执行精确close并进行有界post-close复查。只有close成功且目标明确missing
// 才生成machine-verified；歧义观察在effect后必须保留mutex等待显式recovery。

// ==================== 一、计划合同、错误与strict-data边界 ====================

export const WAKEFLOW_CLAUDE_DECOMMISSION_HOST_ID = "claude-code";
export const WAKEFLOW_CLAUDE_DECOMMISSION_SCHEMA_VERSION = 1;

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const SOCKET_NAME_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,128}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const EXACT_NONABSENT_STATUSES = new Set(["live", "pane-dead", "process-mismatch"]);

export class WakeflowClaudeDecommissionError extends Error {
  constructor(code, message, { cause, details = {} } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowClaudeDecommissionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowClaudeDecommissionError(code, message, { cause, details });
}

function boundary(label, cause, code = "wakeflow-claude-decommission-operation") {
  if (cause instanceof WakeflowClaudeDecommissionError) throw cause;
  const causeCode = typeof cause?.code === "string" ? cause.code : null;
  const recoveryRequired = causeCode?.includes("recovery-required") === true;
  fail(
    recoveryRequired ? "wakeflow-claude-decommission-recovery-required" : code,
    recoveryRequired
      ? `${label} requires explicit recovery; the exact host operation mutex remains retained`
      : `${label} failed`,
    { causeCode },
    cause,
  );
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, required, optional, label) {
  if (!plainObject(value)) fail("wakeflow-claude-decommission-contract", `${label} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("wakeflow-claude-decommission-contract", `${label} has an unknown field`, {
        field: String(key),
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-claude-decommission-contract", `${label}.${key} must be an enumerable data field`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-claude-decommission-contract", `${label} is missing ${key}`);
    }
  }
  return value;
}

function typedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, `$/${label}`);
  } catch (cause) {
    fail("wakeflow-claude-decommission-identifier", `${label} must be one typed ${type} ID`, {}, cause);
  }
}

function bindingId(value) {
  try {
    return assertWindowBindingId(value, "$/binding/bindingId");
  } catch (cause) {
    fail("wakeflow-claude-decommission-identifier", "bindingId must be one typed binding ID", {}, cause);
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-claude-decommission-digest", `${label} must be one sha256 digest`);
  }
  return value;
}

function timestamp(value, label) {
  const match = typeof value === "string" ? TIMESTAMP_RE.exec(value) : null;
  const milliseconds = match ? Date.parse(value) : Number.NaN;
  const instant = new Date(milliseconds);
  if (
    !match
    || !Number.isFinite(milliseconds)
    || instant.getUTCFullYear() !== Number(match[1])
    || instant.getUTCMonth() + 1 !== Number(match[2])
    || instant.getUTCDate() !== Number(match[3])
    || instant.getUTCHours() !== Number(match[4])
    || instant.getUTCMinutes() !== Number(match[5])
    || instant.getUTCSeconds() !== Number(match[6])
  ) {
    fail("wakeflow-claude-decommission-time", `${label} must be one canonical UTC timestamp`);
  }
  return value;
}

function token(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > 4096
    || CONTROL_RE.test(value)
  ) {
    fail("wakeflow-claude-decommission-contract", `${label} must be one bounded token`);
  }
  return value;
}

function socketName(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !SOCKET_NAME_RE.test(value)) {
    fail("wakeflow-claude-decommission-contract", "expectedSocketName must be null or one safe tmux socket name");
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 宿主观察数组只允许标准原型和稠密own-data slot，拒绝时不得执行getter或隐藏字段。
function denseDataArray(value, label, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("wakeflow-claude-decommission-observation", `${label} must be one bounded dense data array`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor?.value;
  if (
    !Object.hasOwn(lengthDescriptor ?? {}, "value")
    || !Number.isSafeInteger(length)
    || length < 0
    || length > maximum
  ) {
    fail("wakeflow-claude-decommission-observation", `${label} exceeds its bounded array contract`);
  }
  const expectedKeys = new Set(["length"]);
  for (let index = 0; index < length; index += 1) expectedKeys.add(String(index));
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.size
    || keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    fail("wakeflow-claude-decommission-observation", `${label} contains authority outside dense slots`);
  }
  const result = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-claude-decommission-observation", `${label} slots must be enumerable data fields`);
    }
    result[index] = descriptor.value;
  }
  return result;
}

function normalizeBinding(value) {
  exactObject(value, ["bindingId", "digest"], [], "binding");
  return {
    bindingId: bindingId(value.bindingId),
    digest: digest(value.digest, "binding.digest"),
  };
}

function attemptLimit(value) {
  if (!Number.isInteger(value) || value < 1 || value > 8) {
    fail("wakeflow-claude-decommission-attempts", "postCloseAttemptLimit must be an integer from 1 through 8");
  }
  return value;
}

function unsignedPlan(value) {
  return {
    kind: "WakeflowClaudeWindowDecommissionPlan",
    schemaVersion: WAKEFLOW_CLAUDE_DECOMMISSION_SCHEMA_VERSION,
    hostId: WAKEFLOW_CLAUDE_DECOMMISSION_HOST_ID,
    programId: value.programId,
    windowId: value.windowId,
    binding: value.binding,
    locator: value.locator,
    locatorDigest: value.locatorDigest,
    subjectDigest: value.subjectDigest,
    expectedSocketName: value.expectedSocketName,
    expectedSessionName: value.expectedSessionName,
    postCloseAttemptLimit: value.postCloseAttemptLimit,
    requiresHostOperationFence: true,
    routingRevocationAfterStateAcknowledgement: true,
    locatorRemovalAfterStateAcknowledgement: true,
  };
}

// 校验plan摘要、binding/locator闭包和固定的operation-fence/acknowledgement顺序。
export function validateClaudeWindowDecommissionPlan(value) {
  exactObject(value, [
    "kind",
    "schemaVersion",
    "hostId",
    "programId",
    "windowId",
    "binding",
    "locator",
    "locatorDigest",
    "subjectDigest",
    "expectedSocketName",
    "expectedSessionName",
    "postCloseAttemptLimit",
    "requiresHostOperationFence",
    "routingRevocationAfterStateAcknowledgement",
    "locatorRemovalAfterStateAcknowledgement",
    "planDigest",
  ], [], "Claude decommission plan");
  let locator;
  try {
    locator = validateClaudeWindowLocatorRecord(value.locator);
  } catch (cause) {
    fail("wakeflow-claude-decommission-locator", "Claude decommission plan locator is invalid", {}, cause);
  }
  const binding = normalizeBinding(value.binding);
  const normalized = unsignedPlan({
    programId: typedId(value.programId, "program", "programId"),
    windowId: typedId(value.windowId, "window", "windowId"),
    binding,
    locator,
    locatorDigest: digest(value.locatorDigest, "locatorDigest"),
    subjectDigest: digest(value.subjectDigest, "subjectDigest"),
    expectedSocketName: socketName(value.expectedSocketName),
    expectedSessionName: token(value.expectedSessionName, "expectedSessionName"),
    postCloseAttemptLimit: attemptLimit(value.postCloseAttemptLimit),
  });
  if (
    value.kind !== normalized.kind
    || value.schemaVersion !== normalized.schemaVersion
    || value.hostId !== normalized.hostId
    || locator.programId !== normalized.programId
    || locator.windowId !== normalized.windowId
    || locator.bindingId !== binding.bindingId
    || locator.tmux.socketName !== normalized.expectedSocketName
    || locator.tmux.sessionName !== normalized.expectedSessionName
    || normalized.locatorDigest !== claudeWindowLocatorDigest(locator)
    || value.requiresHostOperationFence !== true
    || value.routingRevocationAfterStateAcknowledgement !== true
    || value.locatorRemovalAfterStateAcknowledgement !== true
    || value.planDigest !== canonicalJsonDigest(normalized)
  ) {
    fail("wakeflow-claude-decommission-plan", "Claude decommission plan is stale, modified, or does not close its exact locator tuple");
  }
  return deepFreeze({ ...normalized, planDigest: value.planDigest });
}

// 从当前binding与exact locator生成不可变close计划；这里不执行任何宿主effect。
export function planClaudeWindowDecommission(value = {}) {
  exactObject(value, [
    "programId",
    "windowId",
    "binding",
    "locator",
    "subjectDigest",
    "expectedSocketName",
    "expectedSessionName",
    "postCloseAttemptLimit",
  ], [], "Claude decommission plan input");
  let locator;
  try {
    locator = validateClaudeWindowLocatorRecord(value.locator);
  } catch (cause) {
    fail("wakeflow-claude-decommission-locator", "Claude decommission input locator is invalid", {}, cause);
  }
  const unsigned = unsignedPlan({
    programId: typedId(value.programId, "program", "programId"),
    windowId: typedId(value.windowId, "window", "windowId"),
    binding: normalizeBinding(value.binding),
    locator,
    locatorDigest: claudeWindowLocatorDigest(locator),
    subjectDigest: digest(value.subjectDigest, "subjectDigest"),
    expectedSocketName: socketName(value.expectedSocketName),
    expectedSessionName: token(value.expectedSessionName, "expectedSessionName"),
    postCloseAttemptLimit: attemptLimit(value.postCloseAttemptLimit),
  });
  return validateClaudeWindowDecommissionPlan({
    ...unsigned,
    planDigest: canonicalJsonDigest(unsigned),
  });
}

// ==================== 二、共享结果构造与宿主观察 ====================

function bindingTuple(plan) {
  return {
    programId: plan.programId,
    hostId: WAKEFLOW_CLAUDE_DECOMMISSION_HOST_ID,
    windowId: plan.windowId,
    bindingId: plan.binding.bindingId,
  };
}

function locatorTuple(plan) {
  return {
    locatorId: plan.locator.locatorId,
    digest: plan.locatorDigest,
  };
}

function resultBase(plan, observedAt) {
  return {
    programId: plan.programId,
    hostId: WAKEFLOW_CLAUDE_DECOMMISSION_HOST_ID,
    windowId: plan.windowId,
    binding: plan.binding,
    subjectDigest: plan.subjectDigest,
    locator: locatorTuple(plan),
    routingRevocation: "pending-state-acknowledgement",
    locatorDisposition: "retained-for-acknowledgement",
    manualAction: null,
    observedAt,
  };
}

function blockedResult(plan, {
  actionKind,
  actionStatus,
  sessionStatus,
  attempts,
  reasonCode,
  observedAt,
}) {
  return createHostDecommissionResult({
    ...resultBase(plan, observedAt),
    status: "blocked",
    hostAction: { kind: actionKind, status: actionStatus },
    session: {
      status: sessionStatus,
      proof: "none",
      postCloseAttempts: attempts,
    },
    reasonCode,
  });
}

function machineResult(plan, attempts, observedAt) {
  return createHostDecommissionResult({
    ...resultBase(plan, observedAt),
    status: "machine-verified",
    hostAction: { kind: "close", status: "succeeded" },
    session: {
      status: "closed",
      proof: "exact-post-close-absence",
      postCloseAttempts: attempts,
    },
    reasonCode: null,
  });
}

function clockValue(clock) {
  let value;
  try {
    value = clock();
  } catch (cause) {
    fail("wakeflow-claude-decommission-time", "decommission clock failed", {}, cause);
  }
  return timestamp(value, "observedAt");
}

async function invokeAdapter(callback, input, label) {
  try {
    return await callback(input);
  } catch (cause) {
    fail("wakeflow-claude-decommission-host-effect", `${label} failed`, {}, cause);
  }
}

function exactCloseResponse(value) {
  exactObject(value, ["status"], [], "Claude close response");
  if (!new Set(["succeeded", "failed"]).has(value.status)) {
    fail("wakeflow-claude-decommission-host-effect", "Claude close response status is unsupported");
  }
  return value.status;
}

function assertEndpointMatchesPlan(endpoint, plan) {
  if (
    endpoint.programId !== plan.programId
    || endpoint.windowId !== plan.windowId
    || endpoint.bindingId !== plan.binding.bindingId
    || endpoint.locatorId !== plan.locator.locatorId
    || canonicalJson(endpoint.tmux) !== canonicalJson(plan.locator.tmux)
  ) {
    fail("wakeflow-claude-decommission-authority", "locked endpoint differs from the frozen decommission plan");
  }
  return endpoint;
}

async function inspectRaw(inspect, plan, phase, attempt, endpoint = null) {
  const observations = await invokeAdapter(inspect, deepFreeze({
    phase,
    attempt,
    target: {
      provider: "tmux",
      socketName: plan.expectedSocketName,
      sessionName: plan.expectedSessionName,
      windowId: plan.locator.tmux.windowId,
      paneId: plan.locator.tmux.paneId,
      locatorId: plan.locator.locatorId,
    },
    endpoint,
  }), "Claude exact close inspection");
  return denseDataArray(observations, "Claude inspection observations", 16);
}

function postObservation(plan, observations) {
  try {
    return inspectClaudeWindowLocatorObservation({
      locator: plan.locator,
      binding: bindingTuple(plan),
      expectedSocketName: plan.expectedSocketName,
      observations,
    });
  } catch (cause) {
    fail("wakeflow-claude-decommission-observation", "Claude post-close observation is invalid", {}, cause);
  }
}

// ==================== 三、精确close执行 ====================

/**
 * 在locator mutex内执行pre-close定位、单次close与有界absence复查。adapters在进入任何
 * await前快照；effect后的歧义异常由mutex owner保留恢复权，不能降级成普通blocked回执。
 */
export async function executeClaudeWindowDecommission(value = {}, adapters = {}) {
  exactObject(value, ["workspaceRoot", "plan"], [], "Claude decommission execution input");
  exactObject(adapters, ["inspect", "close"], ["clock"], "Claude decommission adapters");
  const workspaceRoot = value.workspaceRoot;
  const inspect = adapters.inspect;
  const close = adapters.close;
  const clock = adapters.clock ?? (() => new Date().toISOString());
  if (typeof inspect !== "function" || typeof close !== "function") {
    fail("wakeflow-claude-decommission-adapter", "Claude decommission requires inspect and close callbacks");
  }
  if (typeof clock !== "function") fail("wakeflow-claude-decommission-adapter", "clock must be a function");
  const plan = validateClaudeWindowDecommissionPlan(value.plan);
  let effectStarted = false;
  try {
    return await withClaudeWindowOperationMutex({
      workspaceRoot,
      windowId: plan.windowId,
      operationKind: "close",
      operationSubjectDigest: plan.subjectDigest,
      expectedBindingId: plan.binding.bindingId,
      expectedLocatorId: plan.locator.locatorId,
    }, async (operation) => {
      let endpoint;
      try {
        const observations = await inspectRaw(inspect, plan, "pre-close", 0);
        endpoint = assertEndpointMatchesPlan(resolveClaudeWindowOperationEndpoint({
          operation,
          binding: bindingTuple(plan),
          expectedSocketName: plan.expectedSocketName,
          expectedSessionName: plan.expectedSessionName,
          observations,
        }), plan);
      } catch {
        return blockedResult(plan, {
          actionKind: "none",
          actionStatus: "not-attempted",
          sessionStatus: "unknown",
          attempts: 0,
          reasonCode: "claude-preclose-not-live",
          observedAt: clockValue(clock),
        });
      }

      effectStarted = true;
      let closeStatus = "failed";
      try {
        closeStatus = exactCloseResponse(await invokeAdapter(
          close,
          endpoint,
          "Claude exact close",
        ));
      } catch {
        closeStatus = "failed";
      }

      let lastStatus = "unknown";
      for (let attempt = 1; attempt <= plan.postCloseAttemptLimit; attempt += 1) {
        const observations = await inspectRaw(
          inspect,
          plan,
          "post-close",
          attempt,
          endpoint,
        );
        const observed = postObservation(plan, observations);
        lastStatus = observed.status;
        if (observed.status === "missing") {
          return closeStatus === "succeeded"
            ? machineResult(plan, attempt, clockValue(clock))
            : blockedResult(plan, {
                actionKind: "close",
                actionStatus: "failed",
                sessionStatus: "unknown",
                attempts: attempt,
                reasonCode: "claude-close-failed",
                observedAt: clockValue(clock),
              });
        }
        if (!EXACT_NONABSENT_STATUSES.has(observed.status)) {
          fail(
            "wakeflow-claude-decommission-recovery-required",
            "post-close observation is ambiguous; the exact operation mutex must be retained",
            { status: observed.status },
          );
        }
      }
      return blockedResult(plan, {
        actionKind: "close",
        actionStatus: closeStatus,
        sessionStatus: lastStatus === "live" ? "still-live" : "unknown",
        attempts: plan.postCloseAttemptLimit,
        reasonCode: closeStatus === "succeeded"
          ? "claude-postclose-still-present"
          : "claude-close-failed",
        observedAt: clockValue(clock),
      });
    }, {
      onFailure: () => ({
        disposition: effectStarted ? "retain-for-recovery" : "safe-to-release",
      }),
    });
  } catch (cause) {
    boundary("Claude window decommission", cause);
  }
}

// ==================== 四、effect后显式恢复 ====================

/**
 * 复用保留的exact operation mutex重新观察目标。明确missing或明确仍存在都允许释放mutex，
 * 但因原close outcome不可恢复，返回值始终是blocked而不是machine-verified。
 */
export async function recoverClaudeWindowDecommission(value = {}, adapters = {}) {
  exactObject(
    value,
    ["workspaceRoot", "plan", "operationId"],
    [],
    "Claude decommission recovery input",
  );
  exactObject(adapters, ["inspect"], ["clock"], "Claude decommission recovery adapters");
  const workspaceRoot = value.workspaceRoot;
  const operationId = value.operationId;
  const inspect = adapters.inspect;
  const clock = adapters.clock ?? (() => new Date().toISOString());
  if (typeof inspect !== "function") {
    fail("wakeflow-claude-decommission-adapter", "Claude decommission recovery requires one inspect callback");
  }
  if (typeof clock !== "function") fail("wakeflow-claude-decommission-adapter", "clock must be a function");
  const plan = validateClaudeWindowDecommissionPlan(value.plan);
  let observedStatus = "unknown";
  let attempts = 0;
  try {
    const recovery = await recoverClaudeWindowOperationMutex({
      workspaceRoot,
      windowId: plan.windowId,
      operationId,
    }, async (operation) => {
      if (
        operation.operationKind !== "close"
        || operation.operationSubjectDigest !== plan.subjectDigest
        || operation.expectedBindingId !== plan.binding.bindingId
        || operation.expectedLocatorId !== plan.locator.locatorId
      ) {
        fail("wakeflow-claude-decommission-recovery-subject", "retained mutex belongs to another decommission subject");
      }
      try {
        for (let attempt = 1; attempt <= plan.postCloseAttemptLimit; attempt += 1) {
          attempts = attempt;
          const observations = await inspectRaw(
            inspect,
            plan,
            "recovery",
            attempt,
          );
          const observed = postObservation(plan, observations);
          observedStatus = observed.status;
          if (observed.status === "missing" || EXACT_NONABSENT_STATUSES.has(observed.status)) {
            return { disposition: "safe-to-release" };
          }
        }
      } catch {
        return { disposition: "retain-for-recovery" };
      }
      return { disposition: "retain-for-recovery" };
    });
    if (recovery.status !== "released") {
      return deepFreeze({
        kind: "WakeflowClaudeWindowDecommissionRecovery",
        schemaVersion: WAKEFLOW_CLAUDE_DECOMMISSION_SCHEMA_VERSION,
        status: "retained-for-recovery",
        programId: plan.programId,
        windowId: plan.windowId,
        operationId,
        subjectDigest: plan.subjectDigest,
      });
    }
    return deepFreeze({
      kind: "WakeflowClaudeWindowDecommissionRecovery",
      schemaVersion: WAKEFLOW_CLAUDE_DECOMMISSION_SCHEMA_VERSION,
      status: "released-without-machine-proof",
      programId: plan.programId,
      windowId: plan.windowId,
      operationId,
      subjectDigest: plan.subjectDigest,
      result: blockedResult(plan, {
        actionKind: "close",
        actionStatus: "unavailable",
        sessionStatus: observedStatus === "live" ? "still-live" : "unknown",
        attempts,
        reasonCode: "claude-close-outcome-unrecoverable",
        observedAt: clockValue(clock),
      }),
    });
  } catch (cause) {
    boundary("Claude window decommission recovery", cause, "wakeflow-claude-decommission-recovery-required");
  }
}
