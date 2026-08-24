import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { assertWindowBindingId } from "./wakeflow-window-binding-records.mjs";

// 本模块是普通Pod窗口关闭的共享证明合同。Codex归档只能形成manual-host-gate；Claude
// 只有精确close成功并在有界复查中证明目标不存在，才形成machine-verified。任何结果都
// 不自行撤销routing identity或删除Claude locator，后续状态确认仍归Pod/state owner。

// ==================== 一、协议词汇与strict-data边界 ====================

export const WAKEFLOW_HOST_DECOMMISSION_RESULT_KIND = "WakeflowHostDecommissionResult";
export const WAKEFLOW_HOST_DECOMMISSION_SCHEMA_VERSION = 1;

const HOST_IDS = new Set(["codex", "claude-code"]);
const STATUS_SET = new Set(["machine-verified", "manual-host-gate", "blocked"]);
const HOST_ACTION_KINDS = new Set(["close", "archive", "none"]);
const HOST_ACTION_STATUSES = new Set(["succeeded", "failed", "unavailable", "not-attempted"]);
const SESSION_STATUSES = new Set(["closed", "archived", "unknown", "still-live"]);
const SESSION_PROOFS = new Set(["exact-post-close-absence", "archive-observed", "none"]);
const REASON_CODES = new Set([
  "codex-archive-observed-not-termination-proof",
  "codex-manual-stop-or-archive-required",
  "codex-archive-unavailable",
  "codex-archive-failed",
  "claude-preclose-not-live",
  "claude-close-failed",
  "claude-postclose-still-present",
  "claude-close-outcome-unrecoverable",
]);
const CODEX_REASON_CODES = new Set([...REASON_CODES].filter((value) => value.startsWith("codex-")));
const CLAUDE_REASON_CODES = new Set([...REASON_CODES].filter((value) => value.startsWith("claude-")));
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const LOCATOR_ID_RE = /^locator_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const HOST_DECOMMISSION_INPUT_FIELDS = Object.freeze([
  "programId",
  "hostId",
  "windowId",
  "binding",
  "subjectDigest",
  "status",
  "hostAction",
  "session",
  "locator",
  "routingRevocation",
  "locatorDisposition",
  "manualAction",
  "reasonCode",
  "observedAt",
]);

export class WakeflowHostDecommissionResultError extends Error {
  constructor(code, message, { path = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowHostDecommissionResultError";
    this.code = code;
    this.path = path;
    this.details = Object.freeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, path, message, details = {}, cause = undefined) {
  throw new WakeflowHostDecommissionResultError(code, `${message} at ${path}`, {
    path,
    details,
    cause,
  });
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, required, path) {
  if (!plainObject(value)) fail("wakeflow-host-decommission-contract", path, "expected a plain object");
  const allowed = new Set(required);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("wakeflow-host-decommission-contract", path, "object has an unknown field", {
        field: String(key),
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-host-decommission-contract", `${path}/${key}`, "field must be one enumerable data property");
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-host-decommission-contract", `${path}/${key}`, "missing required field");
    }
  }
  return value;
}

function typedId(value, type, path) {
  try {
    return assertWakeflowId(value, type, path);
  } catch (cause) {
    fail("wakeflow-host-decommission-identifier", path, `expected one typed ${type} ID`, {}, cause);
  }
}

function bindingId(value, path) {
  try {
    return assertWindowBindingId(value, path);
  } catch (cause) {
    fail("wakeflow-host-decommission-identifier", path, "expected one typed binding ID", {}, cause);
  }
}

function digest(value, path) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-host-decommission-digest", path, "expected one sha256 digest");
  }
  return value;
}

function timestamp(value, path) {
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
    fail("wakeflow-host-decommission-time", path, "expected one canonical UTC timestamp");
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeBinding(value) {
  exactObject(value, ["bindingId", "digest"], "$/binding");
  return {
    bindingId: bindingId(value.bindingId, "$/binding/bindingId"),
    digest: digest(value.digest, "$/binding/digest"),
  };
}

function normalizeLocator(value) {
  if (value === null) return null;
  exactObject(value, ["locatorId", "digest"], "$/locator");
  if (typeof value.locatorId !== "string" || !LOCATOR_ID_RE.test(value.locatorId)) {
    fail("wakeflow-host-decommission-identifier", "$/locator/locatorId", "expected one typed locator ID");
  }
  return {
    locatorId: value.locatorId,
    digest: digest(value.digest, "$/locator/digest"),
  };
}

function normalizeHostAction(value) {
  exactObject(value, ["kind", "status"], "$/hostAction");
  if (!HOST_ACTION_KINDS.has(value.kind) || !HOST_ACTION_STATUSES.has(value.status)) {
    fail("wakeflow-host-decommission-action", "$/hostAction", "host action is outside the closed vocabulary");
  }
  return { kind: value.kind, status: value.status };
}

function normalizeSession(value) {
  exactObject(value, ["status", "proof", "postCloseAttempts"], "$/session");
  if (!SESSION_STATUSES.has(value.status) || !SESSION_PROOFS.has(value.proof)) {
    fail("wakeflow-host-decommission-session", "$/session", "session observation is outside the closed vocabulary");
  }
  if (!Number.isInteger(value.postCloseAttempts) || value.postCloseAttempts < 0 || value.postCloseAttempts > 8) {
    fail("wakeflow-host-decommission-session", "$/session/postCloseAttempts", "post-close attempts must be an integer from 0 through 8");
  }
  return {
    status: value.status,
    proof: value.proof,
    postCloseAttempts: value.postCloseAttempts,
  };
}

function normalizeManualAction(value) {
  if (value === null) return null;
  exactObject(value, ["required", "action", "acknowledgement"], "$/manualAction");
  if (
    value.required !== true
    || value.action !== "stop-or-archive-window-and-confirm"
    || value.acknowledgement !== "machine-cannot-prove-future-inactivity"
  ) {
    fail("wakeflow-host-decommission-manual", "$/manualAction", "manual action differs from the I3 acknowledgement contract");
  }
  return { ...value };
}

// ==================== 二、I3宿主非对称证明闭包 ====================

// Codex每个reason必须与真实archive observation一一对应，避免改写reason后重签同一结果。
function assertCodexManualClosure(result) {
  const expected = new Map([
    ["codex-archive-observed-not-termination-proof", {
      actionStatus: "succeeded",
      sessionStatus: "archived",
      sessionProof: "archive-observed",
    }],
    ["codex-manual-stop-or-archive-required", {
      actionStatus: "not-attempted",
      sessionStatus: "unknown",
      sessionProof: "none",
    }],
    ["codex-archive-unavailable", {
      actionStatus: "unavailable",
      sessionStatus: "unknown",
      sessionProof: "none",
    }],
    ["codex-archive-failed", {
      actionStatus: "failed",
      sessionStatus: "unknown",
      sessionProof: "none",
    }],
  ]).get(result.reasonCode);
  if (
    expected === undefined
    || result.hostAction.status !== expected.actionStatus
    || result.session.status !== expected.sessionStatus
    || result.session.proof !== expected.sessionProof
  ) {
    fail(
      "wakeflow-host-decommission-manual",
      "$",
      "Codex archive reason, action, and session observation must describe one exact manual-gate outcome",
    );
  }
}

// Claude blocked结果仍要说明失败发生在哪一阶段，不能把未执行close伪装成post-close事实。
function assertClaudeBlockedClosure(result) {
  const postCloseSession = new Set(["unknown", "still-live"]);
  const hasPostCloseAttempt = result.session.postCloseAttempts >= 1;
  const valid = result.reasonCode === "claude-preclose-not-live"
    ? result.hostAction.kind === "none"
      && result.hostAction.status === "not-attempted"
      && result.session.status === "unknown"
      && result.session.postCloseAttempts === 0
    : result.reasonCode === "claude-close-failed"
      ? result.hostAction.kind === "close"
        && result.hostAction.status === "failed"
        && postCloseSession.has(result.session.status)
        && hasPostCloseAttempt
      : result.reasonCode === "claude-postclose-still-present"
        ? result.hostAction.kind === "close"
          && result.hostAction.status === "succeeded"
          && postCloseSession.has(result.session.status)
          && hasPostCloseAttempt
        : result.reasonCode === "claude-close-outcome-unrecoverable"
          ? result.hostAction.kind === "close"
            && result.hostAction.status === "unavailable"
            && postCloseSession.has(result.session.status)
            && hasPostCloseAttempt
          : false;
  if (!valid) {
    fail(
      "wakeflow-host-decommission-blocked",
      "$",
      "Claude blocked reason, host action, and bounded session observation disagree",
    );
  }
}

function assertSemanticClosure(result) {
  const hasLocator = result.locator !== null;
  if (
    result.routingRevocation !== "pending-state-acknowledgement"
    || result.locatorDisposition !== (hasLocator ? "retained-for-acknowledgement" : "not-applicable")
  ) {
    fail(
      "wakeflow-host-decommission-closure",
      "$",
      "host result cannot revoke identity or dispose a locator before state acknowledgement",
    );
  }
  if (result.hostId === "codex" && hasLocator) {
    fail("wakeflow-host-decommission-host", "$/locator", "Codex cannot carry a Claude locator tuple");
  }
  if (result.hostId === "claude-code" && !hasLocator) {
    fail("wakeflow-host-decommission-host", "$/locator", "Claude decommission requires its exact current locator tuple");
  }
  if (result.status === "machine-verified") {
    if (
      result.hostId !== "claude-code"
      || result.hostAction.kind !== "close"
      || result.hostAction.status !== "succeeded"
      || result.session.status !== "closed"
      || result.session.proof !== "exact-post-close-absence"
      || result.session.postCloseAttempts < 1
      || result.manualAction !== null
      || result.reasonCode !== null
    ) {
      fail("wakeflow-host-decommission-proof", "$", "machine verification requires exact Claude close success plus bounded absence proof");
    }
    return;
  }
  if (result.status === "manual-host-gate") {
    if (
      result.hostId !== "codex"
      || result.hostAction.kind !== "archive"
      || result.manualAction === null
      || !CODEX_REASON_CODES.has(result.reasonCode)
      || result.session.postCloseAttempts !== 0
      || !new Set(["archived", "unknown"]).has(result.session.status)
      || result.session.proof !== (result.session.status === "archived" ? "archive-observed" : "none")
    ) {
      fail("wakeflow-host-decommission-manual", "$", "manual host gate must remain the closed Codex I3 result");
    }
    assertCodexManualClosure(result);
    return;
  }
  if (
    result.hostId !== "claude-code"
    || result.manualAction !== null
    || result.reasonCode === null
    || !CLAUDE_REASON_CODES.has(result.reasonCode)
    || result.session.proof !== "none"
  ) {
    fail("wakeflow-host-decommission-blocked", "$", "blocked host result has an invalid proof or reason classification");
  }
  assertClaudeBlockedClosure(result);
}

// ==================== 三、公共codec与Pod桥接 ====================

/**
 * 校验完整共享结果并重新推导宿主非对称语义闭包。该方法只承认proof字段的结构与组合，
 * 不直接调用宿主，也不把结果提升为routing revocation acknowledgement。
 */
export function validateHostDecommissionResult(value) {
  exactObject(value, [
    "kind",
    "schemaVersion",
    "programId",
    "hostId",
    "windowId",
    "binding",
    "subjectDigest",
    "status",
    "hostAction",
    "session",
    "locator",
    "routingRevocation",
    "locatorDisposition",
    "manualAction",
    "reasonCode",
    "observedAt",
  ], "$");
  if (
    value.kind !== WAKEFLOW_HOST_DECOMMISSION_RESULT_KIND
    || value.schemaVersion !== WAKEFLOW_HOST_DECOMMISSION_SCHEMA_VERSION
  ) {
    fail("wakeflow-host-decommission-kind", "$", "host decommission result kind or schema version is invalid");
  }
  if (!HOST_IDS.has(value.hostId)) {
    fail("wakeflow-host-decommission-host", "$/hostId", "hostId is not a Wakeflow protocol host");
  }
  if (!STATUS_SET.has(value.status)) {
    fail("wakeflow-host-decommission-status", "$/status", "status is outside the closed vocabulary");
  }
  if (value.reasonCode !== null && !REASON_CODES.has(value.reasonCode)) {
    fail("wakeflow-host-decommission-reason", "$/reasonCode", "reasonCode is outside the closed vocabulary");
  }
  const result = {
    kind: WAKEFLOW_HOST_DECOMMISSION_RESULT_KIND,
    schemaVersion: WAKEFLOW_HOST_DECOMMISSION_SCHEMA_VERSION,
    programId: typedId(value.programId, "program", "$/programId"),
    hostId: value.hostId,
    windowId: typedId(value.windowId, "window", "$/windowId"),
    binding: normalizeBinding(value.binding),
    subjectDigest: digest(value.subjectDigest, "$/subjectDigest"),
    status: value.status,
    hostAction: normalizeHostAction(value.hostAction),
    session: normalizeSession(value.session),
    locator: normalizeLocator(value.locator),
    routingRevocation: value.routingRevocation,
    locatorDisposition: value.locatorDisposition,
    manualAction: normalizeManualAction(value.manualAction),
    reasonCode: value.reasonCode,
    observedAt: timestamp(value.observedAt, "$/observedAt"),
  };
  assertSemanticClosure(result);
  return deepFreeze(result);
}

// 构造器先关闭payload字段，再逐字段组装固定kind/version，避免spread在准入前执行getter。
export function createHostDecommissionResult(value = {}) {
  exactObject(value, HOST_DECOMMISSION_INPUT_FIELDS, "$input");
  return validateHostDecommissionResult({
    kind: WAKEFLOW_HOST_DECOMMISSION_RESULT_KIND,
    schemaVersion: WAKEFLOW_HOST_DECOMMISSION_SCHEMA_VERSION,
    programId: value.programId,
    hostId: value.hostId,
    windowId: value.windowId,
    binding: value.binding,
    subjectDigest: value.subjectDigest,
    status: value.status,
    hostAction: value.hostAction,
    session: value.session,
    locator: value.locator,
    routingRevocation: value.routingRevocation,
    locatorDisposition: value.locatorDisposition,
    manualAction: value.manualAction,
    reasonCode: value.reasonCode,
    observedAt: value.observedAt,
  });
}

// 规范字节和摘要仅编码已经通过I3闭包的portable结果，不包含原始宿主handle。
export function hostDecommissionResultCanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(validateHostDecommissionResult(value))}\n`, "utf8");
}

export function hostDecommissionResultDigest(value) {
  return canonicalJsonDigest(validateHostDecommissionResult(value));
}

/**
 * 把宿主证明包装成Pod close observation，并显式携带由worktree owner提供的状态。
 * 本桥接不推断或删除worktree，也不把Codex manual gate升级为关闭证明。
 */
export function hostDecommissionResultToPodCloseObservation(value, options = {}) {
  const result = validateHostDecommissionResult(value);
  exactObject(options, ["worktreeStatus"], "$/options");
  const worktreeStatus = options.worktreeStatus;
  if (!new Set(["not-applicable", "removed", "retained", "unknown"]).has(worktreeStatus)) {
    fail("wakeflow-host-decommission-pod", "$/worktreeStatus", "Pod worktree status is outside the closed vocabulary");
  }
  return deepFreeze({
    kind: "host-result",
    hostResult: result,
    worktreeStatus,
  });
}
