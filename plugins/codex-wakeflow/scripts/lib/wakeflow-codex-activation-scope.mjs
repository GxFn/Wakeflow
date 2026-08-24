import {
  WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND,
  WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION,
  validateHostActivationScopeObservation,
} from "./wakeflow-host-activation-scope.mjs";

// Codex edition当前没有可供Wakeflow精确读取的安装覆盖面API。本adapter因此只能生成
// unknown/unavailable观察，明确把后续激活留在manual-host-gate，不能从“当前能运行插件”
// 反推per-workspace或host-wide范围。

// ==================== 一、宿主输入与时间边界 ====================

export const WAKEFLOW_CODEX_ACTIVATION_SCOPE_HOST_ID = "codex";
export const WAKEFLOW_CODEX_ACTIVATION_SCOPE_PLUGIN_ID = "wakeflow@gxfn";

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;

export class WakeflowCodexActivationScopeError extends Error {
  constructor(code, message, { cause, details = {} } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowCodexActivationScopeError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowCodexActivationScopeError(code, message, { cause, details });
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, required, optional, label) {
  if (!plainObject(value)) fail("wakeflow-codex-activation-scope-contract", `${label} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("wakeflow-codex-activation-scope-contract", `${label} has an unknown field`, {
        field: String(key),
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-codex-activation-scope-contract",
        `${label}.${key} must be an enumerable data field`,
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-codex-activation-scope-contract", `${label} is missing ${key}`);
    }
  }
  return value;
}

function digest(value) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail(
      "wakeflow-codex-activation-scope-digest",
      "workspaceSubjectDigest must be one sha256 digest",
    );
  }
  return value;
}

function clockValue(clock) {
  let value;
  try {
    value = clock();
  } catch (cause) {
    fail("wakeflow-codex-activation-scope-time", "activation scope clock failed", {}, cause);
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
    fail("wakeflow-codex-activation-scope-time", "activation scope clock returned an invalid UTC timestamp");
  }
  return value;
}

/**
 * 接收唯一workspace subject并生成共享scope observation。公共输入刻意不接受scope声明，
 * 因此调用方不能把环境中可见的Codex插件升级成机器可验证的安装覆盖证据。
 */
export async function inspectCodexHostActivationScope(value = {}, adapters = {}) {
  exactObject(value, ["workspaceSubjectDigest"], [], "Codex activation scope input");
  exactObject(adapters, [], ["clock"], "Codex activation scope adapters");
  const clock = adapters.clock ?? (() => new Date().toISOString());
  if (typeof clock !== "function") {
    fail("wakeflow-codex-activation-scope-adapter", "clock must be a function");
  }
  try {
    return validateHostActivationScopeObservation({
      kind: WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND,
      schemaVersion: WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION,
      hostId: WAKEFLOW_CODEX_ACTIVATION_SCOPE_HOST_ID,
      pluginId: WAKEFLOW_CODEX_ACTIVATION_SCOPE_PLUGIN_ID,
      workspaceSubjectDigest: digest(value.workspaceSubjectDigest),
      scope: "unknown",
      evidence: {
        kind: "host-observation-unavailable",
        digest: null,
        reasonCode: "host-observation-unavailable",
      },
      unattendedEligibility: "forbidden",
      observedAt: clockValue(clock),
    });
  } catch (cause) {
    if (cause instanceof WakeflowCodexActivationScopeError) throw cause;
    fail(
      "wakeflow-codex-activation-scope-result",
      "Codex activation scope result failed shared validation",
      {},
      cause,
    );
  }
}

// bootstrap按host profile动态装载这一最小adapter；对象冻结防止装载后改写identity或入口。
export const wakeflowHostActivationScopeAdapter = Object.freeze({
  hostId: WAKEFLOW_CODEX_ACTIVATION_SCOPE_HOST_ID,
  pluginId: WAKEFLOW_CODEX_ACTIVATION_SCOPE_PLUGIN_ID,
  inspect: inspectCodexHostActivationScope,
});
