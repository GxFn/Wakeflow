import { canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import {
  WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND,
  WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION,
  validateHostActivationScopeObservation,
} from "./wakeflow-host-activation-scope.mjs";

// Claude edition把宿主私有安装观察压缩成共享scope合同：project/local只在全部绑定当前
// workspace时为per-workspace，user/managed为host-wide，其余缺失、session或混合事实均为
// unknown。本文件不暴露原始settings/cache路径，也不维护跨项目安装索引。

// ==================== 一、宿主观察合同与strict-data边界 ====================

export const WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_HOST_ID = "claude-code";
export const WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_PLUGIN_ID = "wakeflow@gxfn";
export const WAKEFLOW_CLAUDE_INSTALLATION_OBSERVATION_KIND = "ClaudePluginInstallationScopeObservation";
export const WAKEFLOW_CLAUDE_INSTALLATION_OBSERVATION_SCHEMA_VERSION = 1;

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const CLAUDE_SCOPES = new Set(["user", "project", "local", "managed", "session"]);
const WORKSPACE_SCOPES = new Set(["project", "local"]);
const BROAD_SCOPES = new Set(["user", "managed"]);

export class WakeflowClaudeActivationScopeError extends Error {
  constructor(code, message, { cause, details = {} } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowClaudeActivationScopeError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowClaudeActivationScopeError(code, message, { cause, details });
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, required, optional, label) {
  if (!plainObject(value)) fail("wakeflow-claude-activation-scope-contract", `${label} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("wakeflow-claude-activation-scope-contract", `${label} has an unknown field`, {
        field: String(key),
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-claude-activation-scope-contract",
        `${label}.${key} must be an enumerable data field`,
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-claude-activation-scope-contract", `${label} is missing ${key}`);
    }
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-claude-activation-scope-digest", `${label} must be one sha256 digest`);
  }
  return value;
}

function clockValue(clock) {
  let value;
  try {
    value = clock();
  } catch (cause) {
    fail("wakeflow-claude-activation-scope-time", "activation scope clock failed", {}, cause);
  }
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
    fail("wakeflow-claude-activation-scope-time", "activation scope clock returned an invalid UTC timestamp");
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 只接收标准原型、无附加权限、无accessor的稠密数组；拒绝时不得执行slot代码。
function denseDataArray(value, label, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("wakeflow-claude-activation-scope-observation", `${label} must be one dense data array`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor?.value;
  if (
    !Object.hasOwn(lengthDescriptor ?? {}, "value")
    || !Number.isSafeInteger(length)
    || length < 0
    || length > maximum
  ) {
    fail("wakeflow-claude-activation-scope-observation", `${label} exceeds its bounded array contract`);
  }
  const expectedKeys = new Set(["length"]);
  for (let index = 0; index < length; index += 1) expectedKeys.add(String(index));
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.size
    || keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    fail("wakeflow-claude-activation-scope-observation", `${label} contains authority outside dense slots`);
  }
  const result = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-claude-activation-scope-observation", `${label} slots must be enumerable data fields`);
    }
    result[index] = descriptor.value;
  }
  return result;
}

function normalizeEffectiveScope(value, index) {
  exactObject(
    value,
    ["scope", "workspaceSubjectDigest"],
    [],
    `Claude installation observation effectiveScopes[${index}]`,
  );
  if (!CLAUDE_SCOPES.has(value.scope)) {
    fail(
      "wakeflow-claude-activation-scope-observation",
      "Claude installation observation contains an unsupported scope",
    );
  }
  if (WORKSPACE_SCOPES.has(value.scope)) {
    return {
      scope: value.scope,
      workspaceSubjectDigest: digest(
        value.workspaceSubjectDigest,
        `effectiveScopes[${index}].workspaceSubjectDigest`,
      ),
    };
  }
  if (value.workspaceSubjectDigest !== null) {
    fail(
      "wakeflow-claude-activation-scope-observation",
      `${value.scope} scope cannot claim one workspace subject`,
    );
  }
  return { scope: value.scope, workspaceSubjectDigest: null };
}

function normalizeHostObservation(value) {
  exactObject(
    value,
    ["kind", "schemaVersion", "complete", "effectiveScopes"],
    [],
    "Claude installation observation",
  );
  if (
    value.kind !== WAKEFLOW_CLAUDE_INSTALLATION_OBSERVATION_KIND
    || value.schemaVersion !== WAKEFLOW_CLAUDE_INSTALLATION_OBSERVATION_SCHEMA_VERSION
    || typeof value.complete !== "boolean"
  ) {
    fail(
      "wakeflow-claude-activation-scope-observation",
      "Claude installation observation kind, version, completeness, or scope list is invalid",
    );
  }
  const normalizedScopes = denseDataArray(
    value.effectiveScopes,
    "Claude installation observation effectiveScopes",
    16,
  ).map(normalizeEffectiveScope);
  normalizedScopes.sort((left, right) => {
    const byScope = left.scope < right.scope ? -1 : left.scope > right.scope ? 1 : 0;
    if (byScope !== 0) return byScope;
    const leftDigest = left.workspaceSubjectDigest ?? "";
    const rightDigest = right.workspaceSubjectDigest ?? "";
    return leftDigest < rightDigest ? -1 : leftDigest > rightDigest ? 1 : 0;
  });
  const effectiveScopes = normalizedScopes.filter((entry, index) => index === 0
    || entry.scope !== normalizedScopes[index - 1].scope
    || entry.workspaceSubjectDigest !== normalizedScopes[index - 1].workspaceSubjectDigest);
  return deepFreeze({
    kind: WAKEFLOW_CLAUDE_INSTALLATION_OBSERVATION_KIND,
    schemaVersion: WAKEFLOW_CLAUDE_INSTALLATION_OBSERVATION_SCHEMA_VERSION,
    complete: value.complete,
    effectiveScopes,
  });
}

// ==================== 二、覆盖面分类 ====================

// 分类只消费已脱敏的宿主观察；任一混合或不完整事实都保持unknown并禁止无人值守。
function classifyObservation(observation, workspaceSubjectDigest) {
  if (!observation.complete) {
    return { scope: "unknown", reasonCode: "host-observation-incomplete" };
  }
  if (observation.effectiveScopes.some((entry) => BROAD_SCOPES.has(entry.scope))) {
    return { scope: "host-wide", reasonCode: "host-wide-installation-observed" };
  }
  if (observation.effectiveScopes.length === 0) {
    return { scope: "unknown", reasonCode: "no-active-installation-observed" };
  }
  const sessionScopes = observation.effectiveScopes.filter((entry) => entry.scope === "session");
  if (sessionScopes.length > 0) {
    return {
      scope: "unknown",
      reasonCode: sessionScopes.length === observation.effectiveScopes.length
        ? "session-only-installation-observed"
        : "host-observation-ambiguous",
    };
  }
  if (
    observation.effectiveScopes.every((entry) => WORKSPACE_SCOPES.has(entry.scope))
    && observation.effectiveScopes.every((entry) => entry.workspaceSubjectDigest === workspaceSubjectDigest)
  ) {
    return { scope: "per-workspace", reasonCode: "workspace-scoped-installation-observed" };
  }
  return { scope: "unknown", reasonCode: "host-observation-ambiguous" };
}

function unavailableResult(workspaceSubjectDigest, observedAt) {
  return validateHostActivationScopeObservation({
    kind: WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND,
    schemaVersion: WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION,
    hostId: WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_HOST_ID,
    pluginId: WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_PLUGIN_ID,
    workspaceSubjectDigest,
    scope: "unknown",
    evidence: {
      kind: "host-observation-unavailable",
      digest: null,
      reasonCode: "host-observation-unavailable",
    },
    unattendedEligibility: "forbidden",
    observedAt,
  });
}

/**
 * 调用方只提交workspace subject；安装范围只能由内部observer callback进入，不能通过公共
 * request自报。adapters在首次校验后立即快照，避免clock或await期间替换已经准入的回调。
 */
export async function inspectClaudeHostActivationScope(value = {}, adapters = {}) {
  exactObject(value, ["workspaceSubjectDigest"], [], "Claude activation scope input");
  exactObject(adapters, [], ["observeInstallation", "clock"], "Claude activation scope adapters");
  const workspaceSubjectDigest = digest(value.workspaceSubjectDigest, "workspaceSubjectDigest");
  const clock = adapters.clock ?? (() => new Date().toISOString());
  const observeInstallation = adapters.observeInstallation;
  if (typeof clock !== "function") {
    fail("wakeflow-claude-activation-scope-adapter", "clock must be a function");
  }
  if (observeInstallation !== undefined && typeof observeInstallation !== "function") {
    fail("wakeflow-claude-activation-scope-adapter", "observeInstallation must be a function when provided");
  }
  const observedAt = clockValue(clock);
  if (observeInstallation === undefined) {
    return unavailableResult(workspaceSubjectDigest, observedAt);
  }

  const request = deepFreeze({
    hostId: WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_HOST_ID,
    pluginId: WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_PLUGIN_ID,
    workspaceSubjectDigest,
  });
  let observation;
  try {
    observation = normalizeHostObservation(await observeInstallation(request));
  } catch {
    return unavailableResult(workspaceSubjectDigest, observedAt);
  }
  const classification = classifyObservation(observation, workspaceSubjectDigest);
  try {
    return validateHostActivationScopeObservation({
      kind: WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND,
      schemaVersion: WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION,
      hostId: WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_HOST_ID,
      pluginId: WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_PLUGIN_ID,
      workspaceSubjectDigest,
      scope: classification.scope,
      evidence: {
        kind: "exact-host-installation-observation",
        digest: canonicalJsonDigest(observation),
        reasonCode: classification.reasonCode,
      },
      unattendedEligibility: classification.scope === "per-workspace"
        ? "m6-evaluation-required"
        : "forbidden",
      observedAt,
    });
  } catch (cause) {
    if (cause instanceof WakeflowClaudeActivationScopeError) throw cause;
    fail(
      "wakeflow-claude-activation-scope-result",
      "Claude activation scope result failed shared validation",
      {},
      cause,
    );
  }
}

// bootstrap只看到共享identity与inspect入口，Claude私有观察协议不向shared core扩散。
export const wakeflowHostActivationScopeAdapter = Object.freeze({
  hostId: WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_HOST_ID,
  pluginId: WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_PLUGIN_ID,
  inspect: inspectClaudeHostActivationScope,
});
