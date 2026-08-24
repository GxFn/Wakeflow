import { canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import {
  createHostDecommissionResult,
} from "./wakeflow-host-decommission-result.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { assertWindowBindingId } from "./wakeflow-window-binding-records.mjs";

// 本模块是Codex普通窗口decommission owner：冻结要归档的program/window/binding subject，
// 再把宿主archive观察转换为共享I3结果。Codex归档不是终止证明，因此所有结果都保持
// manual-host-gate；本owner不撤销routing identity，也不声称线程未来不会再次活动。

// ==================== 一、计划合同与基础词汇 ====================

export const WAKEFLOW_CODEX_DECOMMISSION_HOST_ID = "codex";
export const WAKEFLOW_CODEX_DECOMMISSION_SCHEMA_VERSION = 1;

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const OBSERVATION_STATUSES = new Set(["archived", "not-attempted", "unavailable", "failed"]);

export class WakeflowCodexDecommissionError extends Error {
  constructor(code, message, { cause, details = {} } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowCodexDecommissionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowCodexDecommissionError(code, message, { cause, details });
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, required, label) {
  if (!plainObject(value)) fail("wakeflow-codex-decommission-contract", `${label} must be a plain object`);
  const allowed = new Set(required);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("wakeflow-codex-decommission-contract", `${label} has an unknown field`, {
        field: String(key),
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-codex-decommission-contract", `${label}.${key} must be an enumerable data field`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-codex-decommission-contract", `${label} is missing ${key}`);
    }
  }
  return value;
}

function typedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, `$/${label}`);
  } catch (cause) {
    fail("wakeflow-codex-decommission-identifier", `${label} must be one typed ${type} ID`, {}, cause);
  }
}

function bindingId(value) {
  try {
    return assertWindowBindingId(value, "$/binding/bindingId");
  } catch (cause) {
    fail("wakeflow-codex-decommission-identifier", "bindingId must be one typed binding ID", {}, cause);
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-codex-decommission-digest", `${label} must be one sha256 digest`);
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
    fail("wakeflow-codex-decommission-time", `${label} must be one canonical UTC timestamp`);
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeBinding(value) {
  exactObject(value, ["bindingId", "digest"], "binding");
  return {
    bindingId: bindingId(value.bindingId),
    digest: digest(value.digest, "binding.digest"),
  };
}

function unsignedPlan(value) {
  return {
    kind: "WakeflowCodexWindowDecommissionPlan",
    schemaVersion: WAKEFLOW_CODEX_DECOMMISSION_SCHEMA_VERSION,
    hostId: WAKEFLOW_CODEX_DECOMMISSION_HOST_ID,
    programId: value.programId,
    windowId: value.windowId,
    binding: value.binding,
    subjectDigest: value.subjectDigest,
    hostOperation: {
      tool: "set_thread_archived",
      archive: true,
      handleSource: "current-window-binding",
    },
    machineVerificationAvailable: false,
    requiresManualHostGate: true,
    routingRevocationAfterStateAcknowledgement: true,
  };
}

// 校验plan自身摘要及固定Codex能力声明，拒绝把archive伪装成machine-verifiable close。
export function validateCodexWindowDecommissionPlan(value) {
  exactObject(value, [
    "kind",
    "schemaVersion",
    "hostId",
    "programId",
    "windowId",
    "binding",
    "subjectDigest",
    "hostOperation",
    "machineVerificationAvailable",
    "requiresManualHostGate",
    "routingRevocationAfterStateAcknowledgement",
    "planDigest",
  ], "Codex decommission plan");
  exactObject(value.hostOperation, ["tool", "archive", "handleSource"], "Codex decommission hostOperation");
  const normalized = unsignedPlan({
    programId: typedId(value.programId, "program", "programId"),
    windowId: typedId(value.windowId, "window", "windowId"),
    binding: normalizeBinding(value.binding),
    subjectDigest: digest(value.subjectDigest, "subjectDigest"),
  });
  if (
    value.kind !== normalized.kind
    || value.schemaVersion !== normalized.schemaVersion
    || value.hostId !== normalized.hostId
    || value.hostOperation.tool !== normalized.hostOperation.tool
    || value.hostOperation.archive !== true
    || value.hostOperation.handleSource !== normalized.hostOperation.handleSource
    || value.machineVerificationAvailable !== false
    || value.requiresManualHostGate !== true
    || value.routingRevocationAfterStateAcknowledgement !== true
    || value.planDigest !== canonicalJsonDigest(normalized)
  ) {
    fail(
      "wakeflow-codex-decommission-plan",
      "Codex decommission plan is stale, modified, or claims unsupported machine verification",
    );
  }
  return deepFreeze({ ...normalized, planDigest: value.planDigest });
}

// 从当前binding与调用方提供的subject生成不可变宿主操作计划，不执行归档。
export function planCodexWindowDecommission(value = {}) {
  exactObject(value, ["programId", "windowId", "binding", "subjectDigest"], "Codex decommission plan input");
  const unsigned = unsignedPlan({
    programId: typedId(value.programId, "program", "programId"),
    windowId: typedId(value.windowId, "window", "windowId"),
    binding: normalizeBinding(value.binding),
    subjectDigest: digest(value.subjectDigest, "subjectDigest"),
  });
  return validateCodexWindowDecommissionPlan({
    ...unsigned,
    planDigest: canonicalJsonDigest(unsigned),
  });
}

// ==================== 二、archive观察到共享I3结果 ====================

/**
 * 记录一次外部Codex archive操作的有限观察。即使观察到archived，本方法仍要求人工确认，
 * 并把routing revocation留给后续state acknowledgement。
 */
export function recordCodexWindowDecommissionObservation(value = {}) {
  exactObject(value, ["plan", "observation"], "Codex decommission observation input");
  const plan = validateCodexWindowDecommissionPlan(value.plan);
  exactObject(value.observation, ["status", "observedAt"], "Codex decommission observation");
  if (!OBSERVATION_STATUSES.has(value.observation.status)) {
    fail("wakeflow-codex-decommission-observation", "Codex archive observation status is unsupported");
  }
  const observedAt = timestamp(value.observation.observedAt, "observation.observedAt");
  const archiveObserved = value.observation.status === "archived";
  const reasonCode = archiveObserved
    ? "codex-archive-observed-not-termination-proof"
    : value.observation.status === "not-attempted"
      ? "codex-manual-stop-or-archive-required"
      : value.observation.status === "unavailable"
        ? "codex-archive-unavailable"
        : "codex-archive-failed";
  return createHostDecommissionResult({
    programId: plan.programId,
    hostId: WAKEFLOW_CODEX_DECOMMISSION_HOST_ID,
    windowId: plan.windowId,
    binding: plan.binding,
    subjectDigest: plan.subjectDigest,
    status: "manual-host-gate",
    hostAction: {
      kind: "archive",
      status: archiveObserved ? "succeeded" : value.observation.status,
    },
    session: {
      status: archiveObserved ? "archived" : "unknown",
      proof: archiveObserved ? "archive-observed" : "none",
      postCloseAttempts: 0,
    },
    locator: null,
    routingRevocation: "pending-state-acknowledgement",
    locatorDisposition: "not-applicable",
    manualAction: {
      required: true,
      action: "stop-or-archive-window-and-confirm",
      acknowledgement: "machine-cannot-prove-future-inactivity",
    },
    reasonCode,
    observedAt,
  });
}
