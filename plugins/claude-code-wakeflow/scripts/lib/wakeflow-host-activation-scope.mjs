import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";

// 本模块定义宿主安装覆盖面的瞬时portable观察合同。宿主adapter只负责提供可证明的
// installation scope事实；本层负责关闭词汇、证据摘要与unattended eligibility的组合。
// 它不扫描workspace、不保存全局registry，也不决定当前workspace是否已经完成v3切换。

// ==================== 一、协议常量与错误边界 ====================

export const HOST_ACTIVATION_SCOPES = Object.freeze([
  "per-workspace",
  "host-wide",
  "unknown",
]);
export const WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND = "WakeflowHostActivationScopeObservation";
export const WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION = 1;

const HOST_IDS = new Set(["codex", "claude-code"]);
const SCOPE_SET = new Set(HOST_ACTIVATION_SCOPES);
const EVIDENCE_KINDS = new Set([
  "exact-host-installation-observation",
  "host-observation-unavailable",
]);
const UNKNOWN_EXACT_REASONS = new Set([
  "host-observation-ambiguous",
  "host-observation-incomplete",
  "no-active-installation-observed",
  "session-only-installation-observed",
]);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}@[a-z0-9][a-z0-9._-]{0,127}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;

export class WakeflowHostActivationScopeError extends Error {
  constructor(code, message, { path = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowHostActivationScopeError";
    this.code = code;
    this.path = path;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, at, message, details = {}) {
  throw new WakeflowHostActivationScopeError(code, `${message} at ${at}`, {
    path: at,
    details,
  });
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, fields, at) {
  if (!plainObject(value)) fail("wakeflow-host-activation-scope-contract", at, "expected a plain object");
  const allowed = new Set(fields);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("wakeflow-host-activation-scope-unknown", `${at}/${String(key)}`, "unknown field", {
        field: String(key),
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-host-activation-scope-contract",
        `${at}/${key}`,
        "fields must be enumerable data properties",
      );
    }
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      fail("wakeflow-host-activation-scope-missing", `${at}/${field}`, `missing required field ${field}`);
    }
  }
  return value;
}

function digest(value, at) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-host-activation-scope-digest", at, "expected one sha256 digest");
  }
  return value;
}

function nullableDigest(value, at) {
  return value === null ? null : digest(value, at);
}

function timestamp(value, at) {
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
    fail("wakeflow-host-activation-scope-time", at, "expected one canonical UTC timestamp");
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// ==================== 二、证据归一化与分类闭包 ====================

function normalizeEvidence(value) {
  exactObject(value, ["kind", "digest", "reasonCode"], "$/evidence");
  if (!EVIDENCE_KINDS.has(value.kind)) {
    fail(
      "wakeflow-host-activation-scope-evidence",
      "$/evidence/kind",
      "evidence kind is outside the closed vocabulary",
    );
  }
  if (typeof value.reasonCode !== "string" || !value.reasonCode) {
    fail(
      "wakeflow-host-activation-scope-evidence",
      "$/evidence/reasonCode",
      "evidence reasonCode must be one closed non-empty token",
    );
  }
  return {
    kind: value.kind,
    digest: nullableDigest(value.digest, "$/evidence/digest"),
    reasonCode: value.reasonCode,
  };
}

function validateClassification(value) {
  const { scope, evidence, unattendedEligibility } = value;
  if (scope === "per-workspace") {
    if (
      evidence.kind !== "exact-host-installation-observation"
      || evidence.digest === null
      || evidence.reasonCode !== "workspace-scoped-installation-observed"
      || unattendedEligibility !== "m6-evaluation-required"
    ) {
      fail(
        "wakeflow-host-activation-scope-classification",
        "$",
        "per-workspace scope requires exact workspace-scoped evidence and only M6 evaluation eligibility",
      );
    }
    return;
  }
  if (scope === "host-wide") {
    if (
      evidence.kind !== "exact-host-installation-observation"
      || evidence.digest === null
      || evidence.reasonCode !== "host-wide-installation-observed"
      || unattendedEligibility !== "forbidden"
    ) {
      fail(
        "wakeflow-host-activation-scope-classification",
        "$",
        "host-wide scope requires exact broad evidence and forbids unattended activation",
      );
    }
    return;
  }
  if (unattendedEligibility !== "forbidden") {
    fail(
      "wakeflow-host-activation-scope-classification",
      "$/unattendedEligibility",
      "unknown scope must forbid unattended activation",
    );
  }
  if (evidence.kind === "host-observation-unavailable") {
    if (evidence.digest !== null || evidence.reasonCode !== "host-observation-unavailable") {
      fail(
        "wakeflow-host-activation-scope-classification",
        "$/evidence",
        "unavailable host evidence cannot carry a digest or another reason",
      );
    }
    return;
  }
  if (evidence.digest === null || !UNKNOWN_EXACT_REASONS.has(evidence.reasonCode)) {
    fail(
      "wakeflow-host-activation-scope-classification",
      "$/evidence",
      "an exact unknown observation requires a digest and one closed unknown reason",
    );
  }
}

/**
 * 校验并冻结一个宿主覆盖面观察。这里证明的是“宿主报告了什么覆盖范围”，不是激活许可；
 * workspace切换状态与manual coverage仍必须交给wakeflow-host-activation-gate组合。
 */
export function validateHostActivationScopeObservation(value) {
  exactObject(value, [
    "kind",
    "schemaVersion",
    "hostId",
    "pluginId",
    "workspaceSubjectDigest",
    "scope",
    "evidence",
    "unattendedEligibility",
    "observedAt",
  ], "$");
  if (
    value.kind !== WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND
    || value.schemaVersion !== WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION
  ) {
    fail(
      "wakeflow-host-activation-scope-kind",
      "$",
      "activation scope kind or schema version is invalid",
    );
  }
  if (!HOST_IDS.has(value.hostId)) {
    fail("wakeflow-host-activation-scope-host", "$/hostId", "hostId is not a Wakeflow protocol host");
  }
  if (typeof value.pluginId !== "string" || !PLUGIN_ID_RE.test(value.pluginId)) {
    fail("wakeflow-host-activation-scope-plugin", "$/pluginId", "pluginId must be one stable plugin identity");
  }
  const workspaceSubjectDigest = digest(value.workspaceSubjectDigest, "$/workspaceSubjectDigest");
  if (!SCOPE_SET.has(value.scope)) {
    fail("wakeflow-host-activation-scope-value", "$/scope", "scope is outside the closed vocabulary");
  }
  if (!new Set(["m6-evaluation-required", "forbidden"]).has(value.unattendedEligibility)) {
    fail(
      "wakeflow-host-activation-scope-value",
      "$/unattendedEligibility",
      "unattendedEligibility is outside the closed vocabulary",
    );
  }
  const normalized = {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    hostId: value.hostId,
    pluginId: value.pluginId,
    workspaceSubjectDigest,
    scope: value.scope,
    evidence: normalizeEvidence(value.evidence),
    unattendedEligibility: value.unattendedEligibility,
    observedAt: timestamp(value.observedAt, "$/observedAt"),
  };
  validateClassification(normalized);
  return deepFreeze(normalized);
}

// ==================== 三、portable编码 ====================

// 规范字节用于跨owner传递同一观察，不携带宿主原始settings或filesystem路径。
export function hostActivationScopeCanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(validateHostActivationScopeObservation(value))}\n`, "utf8");
}

// 摘要绑定完整规范化观察，供activation report保存不可逆的证据引用。
export function hostActivationScopeDigest(value) {
  return canonicalJsonDigest(validateHostActivationScopeObservation(value));
}
