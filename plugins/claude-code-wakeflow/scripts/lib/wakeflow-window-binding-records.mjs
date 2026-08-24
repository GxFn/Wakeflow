// 本模块是窗口身份绑定的纯 portable codec。
// 记录只回答“哪个稳定 windowId 当前绑定哪个宿主 opaque handle”，并以新 bindingId 区分替换代际；
// 它不保存窗口角色、职责、仓库路径、活跃状态或宿主进程事实，这些分别属于 config、lease/runtime 与宿主 owner。
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { WAKEFLOW_PROTOCOL_HOST_IDS } from "./wakeflow-host-capability.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";

export const WAKEFLOW_WINDOW_BINDING_KIND = "wakeflow-window-binding";
export const WAKEFLOW_WINDOW_BINDING_SCHEMA_VERSION = 1;

const REQUIRED_RECORD_FIELDS = Object.freeze([
  "kind",
  "schemaVersion",
  "programId",
  "hostId",
  "windowId",
  "bindingId",
  "handle",
  "registeredAt",
]);
const OPTIONAL_RECORD_FIELDS = Object.freeze(["hostVerifiedAt"]);
const CREATE_FIELDS = Object.freeze([
  "programId",
  "hostId",
  "windowId",
  "bindingId",
  "handle",
  "registeredAt",
]);
const EXPECTATION_FIELDS = Object.freeze([
  "expectedProgramId",
  "expectedHostId",
  "expectedWindowId",
  "expectedHandleKind",
]);
const PROTOCOL_HOST_IDS = new Set(WAKEFLOW_PROTOCOL_HOST_IDS);
const BINDING_ID_RE = /^binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;

// 领域错误保留精确 JSON 路径，供 records/service 在不暴露 handle 值的情况下定位合同问题。
export class WakeflowWindowBindingRecordError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowWindowBindingRecordError";
    this.code = code;
    this.path = errorPath;
    this.details = details;
  }
}

function fail(code, errorPath, message, details = {}, cause = undefined) {
  throw new WakeflowWindowBindingRecordError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
    cause,
  });
}

function assertPlainObject(value, errorPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-window-binding-type", errorPath, "window binding value must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-window-binding-type", errorPath, "window binding value must be a plain object");
  }
  return value;
}

// closed object 在读取字段值前先拒绝 accessor、隐藏字段和 Symbol，保证codec准入无行为。
function ownDataKeys(value, errorPath) {
  const keys = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      fail(
        "wakeflow-window-binding-unknown-field",
        errorPath,
        "window binding objects cannot contain symbol fields",
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-window-binding-field",
        `${errorPath}/${key}`,
        `window binding field ${key} must be one enumerable data property`,
      );
    }
    keys.push(key);
  }
  return keys;
}

function assertExactKeys(value, required, optional, errorPath) {
  assertPlainObject(value, errorPath);
  const allowed = new Set([...required, ...optional]);
  for (const key of ownDataKeys(value, errorPath)) {
    if (!allowed.has(key)) {
      fail(
        "wakeflow-window-binding-unknown-field",
        `${errorPath}/${key}`,
        `unknown window binding field ${key}`,
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail(
        "wakeflow-window-binding-required-field",
        `${errorPath}/${key}`,
        `missing required window binding field ${key}`,
      );
    }
  }
  return value;
}

function field(value, key) {
  return Object.getOwnPropertyDescriptor(value, key).value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertTypedId(value, type, errorPath) {
  try {
    return assertWakeflowId(value, type, errorPath);
  } catch (cause) {
    fail(
      "wakeflow-window-binding-identifier",
      errorPath,
      `window binding requires one typed ${type} identifier`,
      {},
      cause,
    );
  }
}

/** 校验不带语义标题的随机 binding 代际 ID。 */
export function assertWindowBindingId(value, errorPath = "$") {
  if (typeof value !== "string" || !BINDING_ID_RE.test(value)) {
    fail(
      "wakeflow-window-binding-identifier",
      errorPath,
      "window binding identifier must match binding_<lowercase UUID v4>",
      { valueType: typeof value },
    );
  }
  return value;
}

/** 只委托 UUID 来源生成新代际标识；唯一性仍由 binding service 的当前 inventory 负责。 */
export function generateWindowBindingId(uuidFactory = randomUUID) {
  if (typeof uuidFactory !== "function") {
    fail(
      "wakeflow-window-binding-identifier-generator",
      "$uuidFactory",
      "window binding UUID source must be a function",
    );
  }
  let uuid;
  try {
    uuid = uuidFactory();
  } catch (cause) {
    fail(
      "wakeflow-window-binding-identifier-generator",
      "$uuidFactory",
      "window binding UUID source failed",
      {},
      cause,
    );
  }
  if (typeof uuid !== "string") {
    fail(
      "wakeflow-window-binding-identifier-generator",
      "$uuidFactory",
      "window binding UUID source must return one lowercase UUID v4 string",
      { valueType: typeof uuid },
    );
  }
  return assertWindowBindingId(`binding_${uuid}`, "$generatedBindingId");
}

function assertProtocolHostId(value, errorPath) {
  if (typeof value !== "string" || !PROTOCOL_HOST_IDS.has(value)) {
    fail(
      "wakeflow-window-binding-host",
      errorPath,
      "window binding hostId must be a Wakeflow protocol host",
      { allowedHostIds: WAKEFLOW_PROTOCOL_HOST_IDS },
    );
  }
  return value;
}

function assertOpaqueToken(value, errorPath, label, maxLength) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > maxLength
    || CONTROL_RE.test(value)
  ) {
    fail(
      "wakeflow-window-binding-token",
      errorPath,
      `${label} must be non-empty, bounded, already trimmed, single-line, and control-free`,
    );
  }
  return value;
}

// handle 在records层只是有界不透明token；宿主特定kind与value格式由service结合host profile校验。
function assertHandle(value, errorPath = "$/handle") {
  assertExactKeys(value, ["kind", "value"], [], errorPath);
  return Object.freeze({
    kind: assertOpaqueToken(
      field(value, "kind"),
      `${errorPath}/kind`,
      "window binding handle kind",
      64,
    ),
    value: assertOpaqueToken(
      field(value, "value"),
      `${errorPath}/value`,
      "window binding handle value",
      512,
    ),
  });
}

// 纳秒精度只用于比较两个显式时间的顺序，记录仍保留调用方提供的canonical文本。
function assertTimestamp(value, errorPath) {
  const match = typeof value === "string" ? value.match(TIMESTAMP_RE) : null;
  if (!match) {
    fail(
      "wakeflow-window-binding-timestamp",
      errorPath,
      "window binding timestamp must be an explicit strict UTC RFC3339 value",
    );
  }
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const parsed = new Date(0);
  parsed.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  parsed.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)
  ) {
    fail(
      "wakeflow-window-binding-timestamp",
      errorPath,
      "window binding timestamp must name a real UTC calendar instant",
    );
  }
  return Object.freeze({
    value,
    instantNanoseconds: BigInt(parsed.getTime()) * 1_000_000n
      + BigInt(fraction.padEnd(9, "0") || "0"),
  });
}

// expectations 是consumer附加的authority闭包，不进入记录本身或记录digest。
function normalizedExpectations(value) {
  assertExactKeys(value, [], EXPECTATION_FIELDS, "$expectations");
  const normalized = {};
  if (Object.hasOwn(value, "expectedProgramId")) {
    normalized.expectedProgramId = assertTypedId(
      field(value, "expectedProgramId"),
      "program",
      "$expectations/expectedProgramId",
    );
  }
  if (Object.hasOwn(value, "expectedHostId")) {
    normalized.expectedHostId = assertProtocolHostId(
      field(value, "expectedHostId"),
      "$expectations/expectedHostId",
    );
  }
  if (Object.hasOwn(value, "expectedWindowId")) {
    normalized.expectedWindowId = assertTypedId(
      field(value, "expectedWindowId"),
      "window",
      "$expectations/expectedWindowId",
    );
  }
  if (Object.hasOwn(value, "expectedHandleKind")) {
    normalized.expectedHandleKind = assertOpaqueToken(
      field(value, "expectedHandleKind"),
      "$expectations/expectedHandleKind",
      "expected window binding handle kind",
      64,
    );
  }
  return normalized;
}

function assertExpectations(record, expectations) {
  const comparisons = [
    ["expectedProgramId", "programId", "program identity"],
    ["expectedHostId", "hostId", "host identity"],
    ["expectedWindowId", "windowId", "window identity"],
  ];
  for (const [expectationKey, recordKey, label] of comparisons) {
    if (
      Object.hasOwn(expectations, expectationKey)
      && record[recordKey] !== expectations[expectationKey]
    ) {
      fail(
        "wakeflow-window-binding-identity-mismatch",
        `$/${recordKey}`,
        `window binding ${label} does not match the expected authority`,
      );
    }
  }
  if (
    Object.hasOwn(expectations, "expectedHandleKind")
    && record.handle.kind !== expectations.expectedHandleKind
  ) {
    fail(
      "wakeflow-window-binding-handle-kind",
      "$/handle/kind",
      "window binding handle kind does not match the expected host handle kind",
      {
        actualKind: record.handle.kind,
        expectedKind: expectations.expectedHandleKind,
      },
    );
  }
}

/**
 * 校验完整binding记录及可选consumer expectations，返回与输入对象隔离的深冻结数据。
 */
export function validateWindowBindingRecord(value, expectations = {}) {
  assertExactKeys(value, REQUIRED_RECORD_FIELDS, OPTIONAL_RECORD_FIELDS, "$");
  if (field(value, "kind") !== WAKEFLOW_WINDOW_BINDING_KIND) {
    fail(
      "wakeflow-window-binding-kind",
      "$/kind",
      `window binding kind must be ${WAKEFLOW_WINDOW_BINDING_KIND}`,
    );
  }
  if (field(value, "schemaVersion") !== WAKEFLOW_WINDOW_BINDING_SCHEMA_VERSION) {
    fail(
      "wakeflow-window-binding-schema-version",
      "$/schemaVersion",
      `window binding schemaVersion must be ${WAKEFLOW_WINDOW_BINDING_SCHEMA_VERSION}`,
    );
  }
  const registeredAt = assertTimestamp(field(value, "registeredAt"), "$/registeredAt");
  const hostVerifiedAt = Object.hasOwn(value, "hostVerifiedAt")
    ? assertTimestamp(field(value, "hostVerifiedAt"), "$/hostVerifiedAt")
    : null;
  if (
    hostVerifiedAt
    && hostVerifiedAt.instantNanoseconds < registeredAt.instantNanoseconds
  ) {
    fail(
      "wakeflow-window-binding-timestamp-order",
      "$/hostVerifiedAt",
      "window binding hostVerifiedAt cannot precede registeredAt",
    );
  }
  const record = {
    kind: WAKEFLOW_WINDOW_BINDING_KIND,
    schemaVersion: WAKEFLOW_WINDOW_BINDING_SCHEMA_VERSION,
    programId: assertTypedId(field(value, "programId"), "program", "$/programId"),
    hostId: assertProtocolHostId(field(value, "hostId"), "$/hostId"),
    windowId: assertTypedId(field(value, "windowId"), "window", "$/windowId"),
    bindingId: assertWindowBindingId(field(value, "bindingId"), "$/bindingId"),
    handle: assertHandle(field(value, "handle")),
    registeredAt: registeredAt.value,
    ...(hostVerifiedAt ? { hostVerifiedAt: hostVerifiedAt.value } : {}),
  };
  const normalized = deepFreeze(record);
  assertExpectations(normalized, normalizedExpectations(expectations));
  return normalized;
}

/** 从writer输入补齐固定kind/version，再复用同一个完整记录codec。 */
export function createWindowBindingRecord(value = {}) {
  assertExactKeys(value, CREATE_FIELDS, OPTIONAL_RECORD_FIELDS, "$input");
  return validateWindowBindingRecord({
    kind: WAKEFLOW_WINDOW_BINDING_KIND,
    schemaVersion: WAKEFLOW_WINDOW_BINDING_SCHEMA_VERSION,
    programId: field(value, "programId"),
    hostId: field(value, "hostId"),
    windowId: field(value, "windowId"),
    bindingId: field(value, "bindingId"),
    handle: field(value, "handle"),
    registeredAt: field(value, "registeredAt"),
    ...(Object.hasOwn(value, "hostVerifiedAt")
      ? { hostVerifiedAt: field(value, "hostVerifiedAt") }
      : {}),
  });
}

/** 输出唯一持久化形式：canonical JSON加单个LF。 */
export function windowBindingCanonicalBytes(value) {
  const record = validateWindowBindingRecord(value);
  return Buffer.from(`${canonicalJson(record)}\n`, "utf8");
}

/** 计算不含文件路径和物理元数据的portable绑定摘要。 */
export function windowBindingDigest(value) {
  return canonicalJsonDigest(validateWindowBindingRecord(value));
}

// hostDirName是宿主运行目录组件而不是协议hostId；两者的一致性由host profile/service证明。
function assertPortableComponent(value, errorPath) {
  const component = assertOpaqueToken(value, errorPath, "host runtime directory name", 128);
  if (
    component === "."
    || component === ".."
    || component.includes("/")
    || component.includes("\\")
    || path.posix.basename(component) !== component
  ) {
    fail(
      "wakeflow-window-binding-ref",
      errorPath,
      "host runtime directory name must be one safe portable path component",
    );
  }
  return component;
}

/** 用宿主目录与稳定windowId构造唯一binding ref；显示名变化不会改变位置。 */
export function windowBindingRef(value = {}) {
  assertExactKeys(value, ["hostDirName", "windowId"], [], "$input");
  const hostDirName = assertPortableComponent(field(value, "hostDirName"), "$input/hostDirName");
  const windowId = assertTypedId(field(value, "windowId"), "window", "$input/windowId");
  return `.wakeflow-local/runtime/hosts/${hostDirName}/identity/window-bindings/${windowId}.json`;
}
