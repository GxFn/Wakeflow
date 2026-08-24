import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  hostActivationScopeDigest,
  validateHostActivationScopeObservation,
} from "./wakeflow-host-activation-scope.mjs";

// 本模块组合三个既有事实：宿主安装覆盖面、当前workspace切换状态、可选人工覆盖确认。
// 它只产出一次activation report，不执行插件激活，也不维护跨项目安装索引。
// per-workspace且v3-ready才可能machine-ready；host-wide或unknown永远禁止无人值守激活。

// ==================== 一、协议词汇与strict-data边界 ====================

export const WAKEFLOW_HOST_ACTIVATION_GATE_SCHEMA_VERSION = 1;
export const WAKEFLOW_WORKSPACE_ACTIVATION_SUBJECT_KIND = "WakeflowWorkspaceActivationSubject";
export const WAKEFLOW_WORKSPACE_CUTOVER_OBSERVATION_KIND = "WakeflowWorkspaceCutoverObservation";
export const WAKEFLOW_HOST_ACTIVATION_REPORT_KIND = "WakeflowHostActivationReport";
export const HOST_ACTIVATION_GATE_STATUSES = Object.freeze([
  "blocked",
  "manual-host-gate",
  "ready",
]);

const HOST_IDS = new Set(["codex", "claude-code"]);
const CUTOVER_STATUSES = new Set(["migration-required", "pending", "v3-ready"]);
const REPORT_STATUSES = new Set(HOST_ACTIVATION_GATE_STATUSES);
const COVERAGE_STATUSES = new Set(["manual-acknowledged", "not-required", "required"]);
const COVERAGE_DISPOSITIONS = new Set([
  "accept-unlisted-migration-required",
  "known-set-complete",
]);
const ACTIVATION_DISPOSITIONS = new Set([
  "do-not-activate",
  "machine-ready",
  "manual-only",
]);
const UNATTENDED_ELIGIBILITY = new Set(["eligible", "forbidden"]);
const REASON_CODES = new Set([
  "activation-scope-unknown",
  "host-wide-coverage-acknowledgement-required",
  "host-wide-manual-coverage-acknowledged",
  "unknown-scope-coverage-acknowledgement-required",
  "unknown-scope-manual-coverage-acknowledged",
  "workspace-cutover-incomplete",
]);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const MAX_COVERAGE_ITEMS = 10_000;

export class WakeflowHostActivationGateError extends Error {
  constructor(code, message, { errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowHostActivationGateError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowHostActivationGateError(code, `${message} at ${errorPath}`, {
    errorPath,
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

function exactObject(value, fields, errorPath, code = "wakeflow-host-activation-gate-contract") {
  if (!plainObject(value)) fail(code, "expected one plain data object", { errorPath });
  const keys = Reflect.ownKeys(value);
  const actual = keys.map(String).sort();
  const expected = [...fields].sort();
  if (
    keys.some((key) => typeof key !== "string")
    || canonicalJson(actual) !== canonicalJson(expected)
  ) {
    fail(code, "object fields differ from the closed contract", {
      errorPath,
      details: { actual, expected },
    });
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, "fields must be enumerable data properties", {
        errorPath: `${errorPath}/${field}`,
      });
    }
  }
  return value;
}

function denseArray(value, errorPath) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("wakeflow-host-activation-gate-contract", "expected one bounded array", { errorPath });
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor?.value;
  if (
    !Object.hasOwn(lengthDescriptor ?? {}, "value")
    || !Number.isSafeInteger(length)
    || length < 0
    || length > MAX_COVERAGE_ITEMS
  ) {
    fail("wakeflow-host-activation-gate-contract", "expected one bounded array", { errorPath });
  }
  const expectedKeys = new Set(["length"]);
  for (let index = 0; index < length; index += 1) expectedKeys.add(String(index));
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.size
    || keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    fail(
      "wakeflow-host-activation-gate-contract",
      "array authority must be confined to dense slots",
      { errorPath },
    );
  }
  const result = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-host-activation-gate-contract", "array entries must be enumerable data properties", {
        errorPath: `${errorPath}/${index}`,
      });
    }
    result[index] = descriptor.value;
  }
  return result;
}

function digest(value, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-host-activation-gate-digest", "expected one canonical SHA-256 digest", {
      errorPath,
    });
  }
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUniqueText(values, errorPath) {
  const sorted = [...new Set(values)].sort(compareText);
  if (canonicalJson(values) !== canonicalJson(sorted)) {
    fail("wakeflow-host-activation-gate-order", "values must be unique and lexically ordered", {
      errorPath,
    });
  }
  return values;
}

function normalizedWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\0")
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) {
    fail(
      "wakeflow-host-activation-gate-root",
      "workspaceRoot must be one normalized absolute path already resolved by the caller boundary",
      { errorPath: "$/workspaceRoot" },
    );
  }
  return value;
}

// ==================== 二、workspace切换与人工覆盖事实 ====================

function normalizeCutoverObservation(value, errorPath = "$") {
  exactObject(value, [
    "kind",
    "schemaVersion",
    "workspaceSubjectDigest",
    "status",
    "evidenceDigest",
  ], errorPath, "wakeflow-host-activation-gate-cutover");
  if (
    value.kind !== WAKEFLOW_WORKSPACE_CUTOVER_OBSERVATION_KIND
    || value.schemaVersion !== WAKEFLOW_HOST_ACTIVATION_GATE_SCHEMA_VERSION
    || !CUTOVER_STATUSES.has(value.status)
  ) {
    fail(
      "wakeflow-host-activation-gate-cutover",
      "workspace cutover kind, version, or status is invalid",
      { errorPath },
    );
  }
  return deepFreeze({
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    workspaceSubjectDigest: digest(
      value.workspaceSubjectDigest,
      `${errorPath}/workspaceSubjectDigest`,
    ),
    status: value.status,
    evidenceDigest: digest(value.evidenceDigest, `${errorPath}/evidenceDigest`),
  });
}

function normalizeManualCoverage(value, currentCutover) {
  exactObject(value, [
    "disposition",
    "acknowledgementDigest",
    "workspaceCutovers",
  ], "$/manualCoverage");
  if (!COVERAGE_DISPOSITIONS.has(value.disposition)) {
    fail(
      "wakeflow-host-activation-gate-coverage",
      "manual coverage disposition is outside the closed vocabulary",
      { errorPath: "$/manualCoverage/disposition" },
    );
  }
  const cutovers = denseArray(value.workspaceCutovers, "$/manualCoverage/workspaceCutovers")
    .map((entry, index) => normalizeCutoverObservation(
      entry,
      `$/manualCoverage/workspaceCutovers/${index}`,
    ))
    .sort((left, right) => compareText(left.workspaceSubjectDigest, right.workspaceSubjectDigest));
  if (cutovers.length === 0) {
    fail("wakeflow-host-activation-gate-coverage", "manual coverage set cannot be empty", {
      errorPath: "$/manualCoverage/workspaceCutovers",
    });
  }
  const subjects = cutovers.map((entry) => entry.workspaceSubjectDigest);
  if (new Set(subjects).size !== subjects.length) {
    fail("wakeflow-host-activation-gate-coverage", "manual coverage subjects must be unique", {
      errorPath: "$/manualCoverage/workspaceCutovers",
    });
  }
  const current = cutovers.find(
    (entry) => entry.workspaceSubjectDigest === currentCutover.workspaceSubjectDigest,
  );
  if (current === undefined || canonicalJson(current) !== canonicalJson(currentCutover)) {
    fail(
      "wakeflow-host-activation-gate-coverage",
      "manual coverage must contain the exact current workspace cutover",
      { errorPath: "$/manualCoverage/workspaceCutovers" },
    );
  }
  if (cutovers.some((entry) => entry.status === "pending")) {
    fail("wakeflow-host-activation-gate-coverage", "manual coverage cannot include a pending workspace", {
      errorPath: "$/manualCoverage/workspaceCutovers",
    });
  }
  if (
    value.disposition === "known-set-complete"
    && cutovers.some((entry) => entry.status !== "v3-ready")
  ) {
    fail(
      "wakeflow-host-activation-gate-coverage",
      "known-set-complete requires every explicit workspace to be v3-ready",
      { errorPath: "$/manualCoverage/workspaceCutovers" },
    );
  }
  const acknowledgementDigest = digest(
    value.acknowledgementDigest,
    "$/manualCoverage/acknowledgementDigest",
  );
  return deepFreeze({
    disposition: value.disposition,
    acknowledgementDigest,
    workspaceCutovers: cutovers,
    knownWorkspaceSetDigest: canonicalJsonDigest(cutovers),
  });
}

function coverageSummary(scope, manualCoverage) {
  if (scope === "per-workspace") {
    if (manualCoverage !== null) {
      fail(
        "wakeflow-host-activation-gate-coverage",
        "per-workspace scope does not admit a host-wide manual coverage claim",
        { errorPath: "$/manualCoverage" },
      );
    }
    return deepFreeze({
      status: "not-required",
      disposition: null,
      acknowledgementDigest: null,
      knownWorkspaceCount: 0,
      knownWorkspaceSetDigest: null,
    });
  }
  if (manualCoverage === null) {
    return deepFreeze({
      status: "required",
      disposition: null,
      acknowledgementDigest: null,
      knownWorkspaceCount: 0,
      knownWorkspaceSetDigest: null,
    });
  }
  return deepFreeze({
    status: "manual-acknowledged",
    disposition: manualCoverage.disposition,
    acknowledgementDigest: manualCoverage.acknowledgementDigest,
    knownWorkspaceCount: manualCoverage.workspaceCutovers.length,
    knownWorkspaceSetDigest: manualCoverage.knownWorkspaceSetDigest,
  });
}

// 分类函数只把已校验事实映射为关闭状态词汇，不读取宿主或filesystem状态。
function expectedClassification({ scope, currentCutover, coverage }) {
  const reasonCodes = [];
  if (currentCutover.status !== "v3-ready") reasonCodes.push("workspace-cutover-incomplete");
  if (scope === "host-wide") {
    reasonCodes.push(
      coverage.status === "manual-acknowledged"
        ? "host-wide-manual-coverage-acknowledged"
        : "host-wide-coverage-acknowledgement-required",
    );
  } else if (scope === "unknown") {
    reasonCodes.push("activation-scope-unknown");
    reasonCodes.push(
      coverage.status === "manual-acknowledged"
        ? "unknown-scope-manual-coverage-acknowledged"
        : "unknown-scope-coverage-acknowledgement-required",
    );
  }
  reasonCodes.sort(compareText);
  const status = currentCutover.status !== "v3-ready"
    ? "blocked"
    : scope === "per-workspace"
      ? "ready"
      : coverage.status === "manual-acknowledged"
        ? "manual-host-gate"
        : "blocked";
  return {
    status,
    reasonCodes,
    activationDisposition: status === "ready"
      ? "machine-ready"
      : status === "manual-host-gate"
        ? "manual-only"
        : "do-not-activate",
    unattendedEligibility: status === "ready" ? "eligible" : "forbidden",
  };
}

function normalizeCoverageSummary(value) {
  exactObject(value, [
    "status",
    "disposition",
    "acknowledgementDigest",
    "knownWorkspaceCount",
    "knownWorkspaceSetDigest",
  ], "$/coverage", "wakeflow-host-activation-gate-report");
  if (!COVERAGE_STATUSES.has(value.status)) {
    fail("wakeflow-host-activation-gate-report", "coverage status is invalid", {
      errorPath: "$/coverage/status",
    });
  }
  if (
    !Number.isSafeInteger(value.knownWorkspaceCount)
    || value.knownWorkspaceCount < 0
    || value.knownWorkspaceCount > MAX_COVERAGE_ITEMS
  ) {
    fail("wakeflow-host-activation-gate-report", "coverage count is invalid", {
      errorPath: "$/coverage/knownWorkspaceCount",
    });
  }
  if (value.status === "manual-acknowledged") {
    if (
      !COVERAGE_DISPOSITIONS.has(value.disposition)
      || value.knownWorkspaceCount < 1
    ) {
      fail("wakeflow-host-activation-gate-report", "manual coverage summary is invalid", {
        errorPath: "$/coverage",
      });
    }
    return deepFreeze({
      status: value.status,
      disposition: value.disposition,
      acknowledgementDigest: digest(
        value.acknowledgementDigest,
        "$/coverage/acknowledgementDigest",
      ),
      knownWorkspaceCount: value.knownWorkspaceCount,
      knownWorkspaceSetDigest: digest(
        value.knownWorkspaceSetDigest,
        "$/coverage/knownWorkspaceSetDigest",
      ),
    });
  }
  if (
    value.disposition !== null
    || value.acknowledgementDigest !== null
    || value.knownWorkspaceCount !== 0
    || value.knownWorkspaceSetDigest !== null
  ) {
    fail("wakeflow-host-activation-gate-report", "non-manual coverage cannot claim a set", {
      errorPath: "$/coverage",
    });
  }
  return deepFreeze({
    status: value.status,
    disposition: null,
    acknowledgementDigest: null,
    knownWorkspaceCount: 0,
    knownWorkspaceSetDigest: null,
  });
}

// ==================== 三、公共构造与activation gate ====================

/**
 * 从调用方已经解析好的绝对workspace根生成domain-separated subject摘要。
 * 该摘要隐藏路径文本；本方法不发现其他workspace，也不证明目录当前仍是同一实体。
 */
export function createWakeflowWorkspaceActivationSubjectDigest(value = {}) {
  exactObject(value, ["workspaceRoot"], "$", "wakeflow-host-activation-gate-contract");
  const workspaceRoot = normalizedWorkspaceRoot(value.workspaceRoot);
  return canonicalJsonDigest({
    kind: WAKEFLOW_WORKSPACE_ACTIVATION_SUBJECT_KIND,
    schemaVersion: WAKEFLOW_HOST_ACTIVATION_GATE_SCHEMA_VERSION,
    workspaceRoot,
  });
}

// 将迁移owner提供的当前workspace事实收敛为activation gate可消费的最小观察。
export function createWakeflowWorkspaceCutoverObservation(value = {}) {
  exactObject(value, [
    "workspaceSubjectDigest",
    "status",
    "evidenceDigest",
  ], "$", "wakeflow-host-activation-gate-contract");
  return normalizeCutoverObservation({
    kind: WAKEFLOW_WORKSPACE_CUTOVER_OBSERVATION_KIND,
    schemaVersion: WAKEFLOW_HOST_ACTIVATION_GATE_SCHEMA_VERSION,
    workspaceSubjectDigest: value.workspaceSubjectDigest,
    status: value.status,
    evidenceDigest: value.evidenceDigest,
  });
}

/**
 * 组合scope、current cutover与manual coverage，返回唯一分类报告。
 * manual acknowledgement最多把host-wide/unknown推进到manual-host-gate，不能升级为ready。
 */
export function evaluateWakeflowHostActivationGate(value = {}) {
  exactObject(value, [
    "scopeObservation",
    "currentCutover",
    "manualCoverage",
  ], "$", "wakeflow-host-activation-gate-contract");
  let scopeObservation;
  try {
    scopeObservation = validateHostActivationScopeObservation(value.scopeObservation);
  } catch (cause) {
    fail(
      "wakeflow-host-activation-gate-scope",
      "scopeObservation failed the M4 host observation contract",
      { errorPath: "$/scopeObservation", cause },
    );
  }
  if (scopeObservation.pluginId !== "wakeflow@gxfn") {
    fail("wakeflow-host-activation-gate-scope", "scope observation belongs to another plugin", {
      errorPath: "$/scopeObservation/pluginId",
    });
  }
  const currentCutover = normalizeCutoverObservation(value.currentCutover, "$/currentCutover");
  if (scopeObservation.workspaceSubjectDigest !== currentCutover.workspaceSubjectDigest) {
    fail(
      "wakeflow-host-activation-gate-subject",
      "scope observation and current cutover belong to different workspaces",
      { errorPath: "$" },
    );
  }
  const manualCoverage = value.manualCoverage === null
    ? null
    : normalizeManualCoverage(value.manualCoverage, currentCutover);
  const coverage = coverageSummary(scopeObservation.scope, manualCoverage);
  const classification = expectedClassification({
    scope: scopeObservation.scope,
    currentCutover,
    coverage,
  });
  return validateWakeflowHostActivationReport({
    kind: WAKEFLOW_HOST_ACTIVATION_REPORT_KIND,
    schemaVersion: WAKEFLOW_HOST_ACTIVATION_GATE_SCHEMA_VERSION,
    hostId: scopeObservation.hostId,
    pluginId: scopeObservation.pluginId,
    workspaceSubjectDigest: currentCutover.workspaceSubjectDigest,
    scope: scopeObservation.scope,
    scopeObservationDigest: hostActivationScopeDigest(scopeObservation),
    currentCutover,
    coverage,
    status: classification.status,
    reasonCodes: classification.reasonCodes,
    activationDisposition: classification.activationDisposition,
    unattendedEligibility: classification.unattendedEligibility,
  });
}

/**
 * 校验可传递的activation report及其派生分类闭包。scopeObservationDigest在report中是
 * 上游观察的opaque provenance引用；只有evaluate入口持有原观察并负责现场重算该摘要。
 */
export function validateWakeflowHostActivationReport(value) {
  exactObject(value, [
    "kind",
    "schemaVersion",
    "hostId",
    "pluginId",
    "workspaceSubjectDigest",
    "scope",
    "scopeObservationDigest",
    "currentCutover",
    "coverage",
    "status",
    "reasonCodes",
    "activationDisposition",
    "unattendedEligibility",
  ], "$", "wakeflow-host-activation-gate-report");
  if (
    value.kind !== WAKEFLOW_HOST_ACTIVATION_REPORT_KIND
    || value.schemaVersion !== WAKEFLOW_HOST_ACTIVATION_GATE_SCHEMA_VERSION
    || !HOST_IDS.has(value.hostId)
    || value.pluginId !== "wakeflow@gxfn"
    || !new Set(["per-workspace", "host-wide", "unknown"]).has(value.scope)
    || !REPORT_STATUSES.has(value.status)
    || !ACTIVATION_DISPOSITIONS.has(value.activationDisposition)
    || !UNATTENDED_ELIGIBILITY.has(value.unattendedEligibility)
  ) {
    fail("wakeflow-host-activation-gate-report", "activation report identity or vocabulary is invalid", {
      errorPath: "$",
    });
  }
  const workspaceSubjectDigest = digest(
    value.workspaceSubjectDigest,
    "$/workspaceSubjectDigest",
  );
  const currentCutover = normalizeCutoverObservation(value.currentCutover, "$/currentCutover");
  if (currentCutover.workspaceSubjectDigest !== workspaceSubjectDigest) {
    fail("wakeflow-host-activation-gate-report", "report and cutover subjects differ", {
      errorPath: "$/currentCutover/workspaceSubjectDigest",
    });
  }
  const coverage = normalizeCoverageSummary(value.coverage);
  if (
    (value.scope === "per-workspace" && coverage.status !== "not-required")
    || (value.scope !== "per-workspace" && coverage.status === "not-required")
  ) {
    fail("wakeflow-host-activation-gate-report", "scope and coverage classification disagree", {
      errorPath: "$/coverage/status",
    });
  }
  const reasonCodes = denseArray(value.reasonCodes, "$/reasonCodes")
    .map((entry, index) => {
      if (!REASON_CODES.has(entry)) {
        fail("wakeflow-host-activation-gate-report", "reason code is outside the closed vocabulary", {
          errorPath: `$/reasonCodes/${index}`,
        });
      }
      return entry;
    });
  sortedUniqueText(reasonCodes, "$/reasonCodes");
  const expected = expectedClassification({
    scope: value.scope,
    currentCutover,
    coverage,
  });
  if (
    value.status !== expected.status
    || value.activationDisposition !== expected.activationDisposition
    || value.unattendedEligibility !== expected.unattendedEligibility
    || canonicalJson(reasonCodes) !== canonicalJson(expected.reasonCodes)
  ) {
    fail("wakeflow-host-activation-gate-report", "activation report classification is stale", {
      errorPath: "$",
    });
  }
  return deepFreeze({
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    hostId: value.hostId,
    pluginId: value.pluginId,
    workspaceSubjectDigest,
    scope: value.scope,
    scopeObservationDigest: digest(
      value.scopeObservationDigest,
      "$/scopeObservationDigest",
    ),
    currentCutover,
    coverage,
    status: value.status,
    reasonCodes,
    activationDisposition: value.activationDisposition,
    unattendedEligibility: value.unattendedEligibility,
  });
}

// 报告摘要绑定scope、cutover、coverage和最终分类，不能单独替代原始scope观察。
export function hostActivationReportDigest(value) {
  return canonicalJsonDigest(validateWakeflowHostActivationReport(value));
}
