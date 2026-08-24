// 本模块是baseline window-runtime投影的纯portable codec。
// 它把durable topology、当前binding引用和脱敏根目录观察绑定成可重建记录；
// 不保存raw handle，不证明宿主在线/已接收消息，也不反向修改config、binding或真实根目录。
// 阅读顺序：closed data准入 → typed root/identity/fingerprint闭包 → projection摘要 → host-local portable ref。
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { WAKEFLOW_PROTOCOL_HOST_IDS } from "./wakeflow-host-capability.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";

export const WAKEFLOW_WINDOW_RUNTIME_KIND = "wakeflow-window-runtime-projection";
export const WAKEFLOW_WINDOW_RUNTIME_SCHEMA_VERSION = 1;

const PROTOCOL_HOST_IDS = new Set(WAKEFLOW_PROTOCOL_HOST_IDS);
const WINDOW_ROLES = new Set(["controller", "design", "test", "product"]);
const ROOT_STATUSES = new Set(["unobserved", "available", "missing"]);
const DISPATCH_ELIGIBILITY = new Set(["eligible", "ineligible"]);
const PREFLIGHT_STATUSES = new Set(["ready", "blocked"]);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const BINDING_ID_RE = /^binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const DOMAIN_FIELDS = Object.freeze([
  "programId",
  "hostId",
  "windowId",
  "role",
  "rootRef",
  "configuredRoot",
  "resolvedRoot",
  "identity",
  "dispatchEligibility",
  "preflightStatus",
  "blockingReasons",
  "hostAvailability",
  "sourceFingerprints",
]);
const UNSIGNED_RECORD_FIELDS = Object.freeze([
  "kind",
  "schemaVersion",
  ...DOMAIN_FIELDS,
]);
const RECORD_FIELDS = Object.freeze([
  ...UNSIGNED_RECORD_FIELDS,
  "projectionDigest",
]);
const BLOCKING_REASON_BY_CODE = Object.freeze({
  "identity-unregistered": "identity",
  "root-unavailable": "root",
});

export class WakeflowWindowRuntimeRecordError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowWindowRuntimeRecordError";
    this.code = code;
    this.path = errorPath;
    this.details = details;
  }
}

// ---------- Closed JSON 数据准入 ----------

function fail(code, errorPath, message, details = {}, cause = undefined) {
  throw new WakeflowWindowRuntimeRecordError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
    cause,
  });
}

function assertPlainObject(value, errorPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(
      "wakeflow-window-runtime-type",
      errorPath,
      "window runtime projection value must be a plain object",
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(
      "wakeflow-window-runtime-type",
      errorPath,
      "window runtime projection value must be a plain object",
    );
  }
  return value;
}

// 在读取值之前关闭own-key与descriptor集合，拒绝getter、隐藏字段、Symbol和未知字段。
function ownDataKeys(value, errorPath) {
  const keys = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      fail(
        "wakeflow-window-runtime-unknown-field",
        errorPath,
        "window runtime projection objects cannot contain symbol fields",
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-window-runtime-field",
        `${errorPath}/${key}`,
        `window runtime projection field ${key} must be one enumerable data property`,
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
        "wakeflow-window-runtime-unknown-field",
        `${errorPath}/<unknown>`,
        "window runtime projection object contains an unknown field",
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail(
        "wakeflow-window-runtime-required-field",
        `${errorPath}/${key}`,
        `missing required window runtime projection field ${key}`,
      );
    }
  }
  return value;
}

function field(value, key) {
  return Object.getOwnPropertyDescriptor(value, key).value;
}

function assertDenseArray(value, errorPath) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(
      "wakeflow-window-runtime-type",
      errorPath,
      "window runtime projection field must be one ordinary array",
    );
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string") {
      fail(
        "wakeflow-window-runtime-unknown-field",
        errorPath,
        "window runtime projection arrays cannot contain symbol fields",
      );
    }
    const index = Number(key);
    if (
      !Number.isInteger(index)
      || index < 0
      || index >= value.length
      || String(index) !== key
    ) {
      fail(
        "wakeflow-window-runtime-unknown-field",
        `${errorPath}/<unknown>`,
        "window runtime projection arrays cannot contain additional fields",
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-window-runtime-field",
        `${errorPath}/${key}`,
        "window runtime projection array entries must be enumerable data properties",
      );
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail(
        "wakeflow-window-runtime-field",
        `${errorPath}/${index}`,
        "window runtime projection arrays cannot contain sparse entries",
      );
    }
  }
  return value;
}

function arrayField(value, index) {
  return Object.getOwnPropertyDescriptor(value, String(index)).value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, "value")) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

function isDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !isDeepFrozen(descriptor.value, seen)) {
      return false;
    }
  }
  return true;
}

function assertTypedId(value, type, errorPath) {
  try {
    return assertWakeflowId(value, type, errorPath);
  } catch {
    fail(
      "wakeflow-window-runtime-identifier",
      errorPath,
      `window runtime projection requires one typed ${type} identifier`,
    );
  }
}

function assertProtocolHostId(value, errorPath) {
  if (typeof value !== "string" || !PROTOCOL_HOST_IDS.has(value)) {
    fail(
      "wakeflow-window-runtime-host",
      errorPath,
      "window runtime projection hostId must be a Wakeflow protocol host",
      { allowedHostIds: WAKEFLOW_PROTOCOL_HOST_IDS },
    );
  }
  return value;
}

function assertEnum(value, allowed, errorPath, label) {
  if (typeof value !== "string" || !allowed.has(value)) {
    fail(
      "wakeflow-window-runtime-value",
      errorPath,
      `${label} is not supported by the window runtime projection schema`,
      { allowed: [...allowed] },
    );
  }
  return value;
}

function assertDigest(value, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail(
      "wakeflow-window-runtime-digest",
      errorPath,
      "window runtime projection digest must be one lowercase sha256 digest",
    );
  }
  return value;
}

function assertBindingId(value, errorPath) {
  if (typeof value !== "string" || !BINDING_ID_RE.test(value)) {
    fail(
      "wakeflow-window-runtime-identity",
      errorPath,
      "window runtime projection bindingId must match binding_<lowercase UUID v4>",
    );
  }
  return value;
}

function assertPortableConfiguredRoot(value, role, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || CONTROL_RE.test(value)
    || value.includes("\\")
    || value.endsWith("/")
    || path.posix.isAbsolute(value)
    || /^[A-Za-z]:/u.test(value)
  ) {
    fail(
      "wakeflow-window-runtime-configured-root",
      errorPath,
      "configuredRoot must be one canonical portable non-absolute placement",
    );
  }
  if (role === "controller") {
    if (value !== ".") {
      fail(
        "wakeflow-window-runtime-role-root",
        errorPath,
        "controller window runtime projection must use the program root placement",
      );
    }
    return value;
  }
  const normalized = path.posix.normalize(value);
  const onlyParentSegments = normalized.split("/").every((segment) => segment === "..");
  if (normalized !== value || normalized === "." || onlyParentSegments) {
    fail(
      "wakeflow-window-runtime-configured-root",
      errorPath,
      "configuredRoot must already be in canonical portable relative form",
    );
  }
  return value;
}

// ---------- Durable topology 与 identity 派生闭包 ----------

// rootRef只保存typed logical owner；configuredRoot仍是portable placement，不是session cwd证明。
function objectDiscriminator(value, errorPath, fieldName) {
  assertPlainObject(value, errorPath);
  ownDataKeys(value, errorPath);
  if (!Object.hasOwn(value, fieldName)) {
    fail(
      "wakeflow-window-runtime-required-field",
      `${errorPath}/${fieldName}`,
      `missing required window runtime projection field ${fieldName}`,
    );
  }
  return field(value, fieldName);
}

function normalizeRootRef(value, role, programId, errorPath) {
  const kind = objectDiscriminator(value, errorPath, "kind");
  if (kind === "program") {
    assertExactKeys(value, ["kind", "programId"], [], errorPath);
    const rootProgramId = assertTypedId(field(value, "programId"), "program", `${errorPath}/programId`);
    if (role !== "controller" || rootProgramId !== programId) {
      fail(
        "wakeflow-window-runtime-role-root",
        errorPath,
        "program rootRef must belong to the controller and match projection programId",
      );
    }
    return Object.freeze({ kind, programId: rootProgramId });
  }
  if (kind === "support-surface") {
    assertExactKeys(value, ["kind", "surfaceId"], [], errorPath);
    if (role !== "design" && role !== "test") {
      fail(
        "wakeflow-window-runtime-role-root",
        errorPath,
        "support-surface rootRef requires a design or test role",
      );
    }
    return Object.freeze({
      kind,
      surfaceId: assertTypedId(field(value, "surfaceId"), "surface", `${errorPath}/surfaceId`),
    });
  }
  if (kind === "repository") {
    assertExactKeys(value, ["kind", "repositoryId"], [], errorPath);
    if (role !== "product") {
      fail(
        "wakeflow-window-runtime-role-root",
        errorPath,
        "repository rootRef requires a product role",
      );
    }
    return Object.freeze({
      kind,
      repositoryId: assertTypedId(
        field(value, "repositoryId"),
        "repository",
        `${errorPath}/repositoryId`,
      ),
    });
  }
  fail(
    "wakeflow-window-runtime-role-root",
    `${errorPath}/kind`,
    "window runtime projection rootRef kind is not supported",
  );
}

function normalizeResolvedRoot(value, errorPath) {
  assertExactKeys(value, ["status", "observationDigest"], [], errorPath);
  return Object.freeze({
    status: assertEnum(field(value, "status"), ROOT_STATUSES, `${errorPath}/status`, "resolved root status"),
    observationDigest: assertDigest(
      field(value, "observationDigest"),
      `${errorPath}/observationDigest`,
    ),
  });
}

// valid identity只携带binding外键和摘要；raw宿主handle始终留在binding owner中。
function normalizeIdentity(value, hostId, windowId, errorPath) {
  const status = objectDiscriminator(value, errorPath, "status");
  if (status === "unregistered") {
    assertExactKeys(value, ["status"], [], errorPath);
    return Object.freeze({ status });
  }
  if (status !== "valid") {
    fail(
      "wakeflow-window-runtime-identity",
      `${errorPath}/status`,
      "baseline window runtime identity must be unregistered or valid",
    );
  }
  assertExactKeys(
    value,
    ["status", "identityRef", "bindingId", "identityBindingDigest"],
    [],
    errorPath,
  );
  const identityRef = field(value, "identityRef");
  const expectedIdentityRef = `.wakeflow-local/runtime/hosts/${hostId}/identity/window-bindings/${windowId}.json`;
  if (typeof identityRef !== "string" || identityRef !== expectedIdentityRef) {
    fail(
      "wakeflow-window-runtime-identity",
      `${errorPath}/identityRef`,
      "window runtime identityRef must match the projection host and window authority",
    );
  }
  return Object.freeze({
    status,
    identityRef,
    bindingId: assertBindingId(field(value, "bindingId"), `${errorPath}/bindingId`),
    identityBindingDigest: assertDigest(
      field(value, "identityBindingDigest"),
      `${errorPath}/identityBindingDigest`,
    ),
  });
}

function normalizeBlockingReasons(value, errorPath) {
  assertDenseArray(value, errorPath);
  if (value.length > 2) {
    fail(
      "wakeflow-window-runtime-preflight",
      errorPath,
      "window runtime projection has too many blocking reasons",
    );
  }
  const reasons = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const reasonPath = `${errorPath}/${index}`;
    const reason = arrayField(value, index);
    assertExactKeys(reason, ["code", "source"], [], reasonPath);
    const code = field(reason, "code");
    const source = field(reason, "source");
    if (
      typeof code !== "string"
      || typeof source !== "string"
      || !Object.hasOwn(BLOCKING_REASON_BY_CODE, code)
      || BLOCKING_REASON_BY_CODE[code] !== source
    ) {
      fail(
        "wakeflow-window-runtime-preflight",
        reasonPath,
        "window runtime projection blocking reason is not a supported code/source pair",
      );
    }
    if (seen.has(code)) {
      fail(
        "wakeflow-window-runtime-preflight",
        `${reasonPath}/code`,
        "window runtime projection blocking reasons cannot contain duplicates",
      );
    }
    seen.add(code);
    reasons.push(Object.freeze({ code, source }));
  }
  return Object.freeze(reasons);
}

// baseline尚未消费真实host observation，因此这里只能诚实表达unobserved。
function normalizeHostAvailability(value, errorPath) {
  assertExactKeys(value, ["status"], [], errorPath);
  if (field(value, "status") !== "unobserved") {
    fail(
      "wakeflow-window-runtime-host-observation",
      `${errorPath}/status`,
      "T04 baseline window runtime projection host availability must remain unobserved",
    );
  }
  return Object.freeze({ status: "unobserved" });
}

// source fingerprints让consumer发现投影stale；它们不是上游authority的替代副本。
function normalizeSourceFingerprints(value, identity, resolvedRoot, errorPath) {
  const required = [
    "configDigest",
    "topologyDigest",
    "windowDigest",
    "rootObservationDigest",
    "identityInventoryDigest",
  ];
  assertExactKeys(value, required, ["identityBindingDigest"], errorPath);
  const normalized = Object.fromEntries(required.map((key) => [
    key,
    assertDigest(field(value, key), `${errorPath}/${key}`),
  ]));
  if (normalized.rootObservationDigest !== resolvedRoot.observationDigest) {
    fail(
      "wakeflow-window-runtime-source-fingerprint",
      `${errorPath}/rootObservationDigest`,
      "root observation fingerprint must match resolvedRoot observation digest",
    );
  }
  if (identity.status === "valid") {
    if (!Object.hasOwn(value, "identityBindingDigest")) {
      fail(
        "wakeflow-window-runtime-source-fingerprint",
        `${errorPath}/identityBindingDigest`,
        "valid identity requires its binding digest in source fingerprints",
      );
    }
    const identityBindingDigest = assertDigest(
      field(value, "identityBindingDigest"),
      `${errorPath}/identityBindingDigest`,
    );
    if (identityBindingDigest !== identity.identityBindingDigest) {
      fail(
        "wakeflow-window-runtime-source-fingerprint",
        `${errorPath}/identityBindingDigest`,
        "identity binding fingerprint must match the projected identity digest",
      );
    }
    normalized.identityBindingDigest = identityBindingDigest;
  } else if (Object.hasOwn(value, "identityBindingDigest")) {
    fail(
      "wakeflow-window-runtime-source-fingerprint",
      `${errorPath}/identityBindingDigest`,
      "unregistered identity cannot claim an identity binding fingerprint",
    );
  }
  return Object.freeze(normalized);
}

// blockingReasons只能由identity与root gate确定性导出，调用方不能附加主观判断。
function expectedBlockingReasons({ identity, resolvedRoot }) {
  return Object.freeze([
    ...(identity.status === "unregistered"
      ? [Object.freeze({ code: "identity-unregistered", source: "identity" })]
      : []),
    ...(resolvedRoot.status === "missing"
      ? [Object.freeze({ code: "root-unavailable", source: "root" })]
      : []),
  ]);
}

function assertBlockingReasons(actual, expected) {
  if (
    actual.length !== expected.length
    || actual.some((reason, index) => (
      reason.code !== expected[index].code || reason.source !== expected[index].source
    ))
  ) {
    fail(
      "wakeflow-window-runtime-preflight",
      "$/blockingReasons",
      "blocking reasons must exactly and deterministically describe identity and root gates",
    );
  }
}

// ---------- 完整投影闭包与摘要 ----------

function normalizeProjection(value, { projectionDigestRequired }) {
  assertExactKeys(
    value,
    projectionDigestRequired ? RECORD_FIELDS : UNSIGNED_RECORD_FIELDS,
    [],
    "$",
  );
  if (field(value, "kind") !== WAKEFLOW_WINDOW_RUNTIME_KIND) {
    fail(
      "wakeflow-window-runtime-kind",
      "$/kind",
      `window runtime projection kind must be ${WAKEFLOW_WINDOW_RUNTIME_KIND}`,
    );
  }
  if (field(value, "schemaVersion") !== WAKEFLOW_WINDOW_RUNTIME_SCHEMA_VERSION) {
    fail(
      "wakeflow-window-runtime-schema-version",
      "$/schemaVersion",
      `window runtime projection schemaVersion must be ${WAKEFLOW_WINDOW_RUNTIME_SCHEMA_VERSION}`,
    );
  }

  const programId = assertTypedId(field(value, "programId"), "program", "$/programId");
  const hostId = assertProtocolHostId(field(value, "hostId"), "$/hostId");
  const windowId = assertTypedId(field(value, "windowId"), "window", "$/windowId");
  const role = assertEnum(field(value, "role"), WINDOW_ROLES, "$/role", "window role");
  const rootRef = normalizeRootRef(field(value, "rootRef"), role, programId, "$/rootRef");
  const configuredRoot = assertPortableConfiguredRoot(
    field(value, "configuredRoot"),
    role,
    "$/configuredRoot",
  );
  const resolvedRoot = normalizeResolvedRoot(field(value, "resolvedRoot"), "$/resolvedRoot");
  const identity = normalizeIdentity(field(value, "identity"), hostId, windowId, "$/identity");
  if (
    (identity.status === "unregistered" && resolvedRoot.status !== "unobserved")
    || (identity.status === "valid" && resolvedRoot.status === "unobserved")
  ) {
    fail(
      "wakeflow-window-runtime-root-observation",
      "$/resolvedRoot/status",
      "root observation status must match durable identity registration",
    );
  }
  const dispatchEligibility = assertEnum(
    field(value, "dispatchEligibility"),
    DISPATCH_ELIGIBILITY,
    "$/dispatchEligibility",
    "dispatch eligibility",
  );
  const expectedEligibility = role === "design" ? "ineligible" : "eligible";
  if (dispatchEligibility !== expectedEligibility) {
    fail(
      "wakeflow-window-runtime-role-eligibility",
      "$/dispatchEligibility",
      "dispatch eligibility must match the durable window role",
    );
  }
  const preflightStatus = assertEnum(
    field(value, "preflightStatus"),
    PREFLIGHT_STATUSES,
    "$/preflightStatus",
    "preflight status",
  );
  const blockingReasons = normalizeBlockingReasons(
    field(value, "blockingReasons"),
    "$/blockingReasons",
  );
  const expectedReasons = expectedBlockingReasons({ identity, resolvedRoot });
  assertBlockingReasons(blockingReasons, expectedReasons);
  const expectedPreflightStatus = expectedReasons.length === 0 ? "ready" : "blocked";
  if (preflightStatus !== expectedPreflightStatus) {
    fail(
      "wakeflow-window-runtime-preflight",
      "$/preflightStatus",
      "preflight status must match identity, root, and dispatch blocking reasons",
    );
  }
  const hostAvailability = normalizeHostAvailability(
    field(value, "hostAvailability"),
    "$/hostAvailability",
  );
  const sourceFingerprints = normalizeSourceFingerprints(
    field(value, "sourceFingerprints"),
    identity,
    resolvedRoot,
    "$/sourceFingerprints",
  );

  const unsigned = {
    kind: WAKEFLOW_WINDOW_RUNTIME_KIND,
    schemaVersion: WAKEFLOW_WINDOW_RUNTIME_SCHEMA_VERSION,
    programId,
    hostId,
    windowId,
    role,
    rootRef,
    configuredRoot,
    resolvedRoot,
    identity,
    dispatchEligibility,
    preflightStatus,
    blockingReasons,
    hostAvailability,
    sourceFingerprints,
  };
  const expectedProjectionDigest = canonicalJsonDigest(unsigned);
  if (projectionDigestRequired) {
    const actualProjectionDigest = assertDigest(
      field(value, "projectionDigest"),
      "$/projectionDigest",
    );
    if (actualProjectionDigest !== expectedProjectionDigest) {
      fail(
        "wakeflow-window-runtime-projection-digest",
        "$/projectionDigest",
        "projectionDigest must cover the canonical projection excluding itself",
      );
    }
  }
  return deepFreeze({ ...unsigned, projectionDigest: expectedProjectionDigest });
}

/**
 * 从已经提供的领域字段创建canonical、深冻结的baseline投影。
 * 该入口计算projectionDigest，但不读取workspace，也不探测binding、root或host。
 */
export function createWindowRuntimeProjection(value = {}) {
  assertExactKeys(
    value,
    DOMAIN_FIELDS,
    ["kind", "schemaVersion"],
    "$input",
  );
  if (
    Object.hasOwn(value, "kind")
    && field(value, "kind") !== WAKEFLOW_WINDOW_RUNTIME_KIND
  ) {
    fail(
      "wakeflow-window-runtime-kind",
      "$input/kind",
      `window runtime projection kind must be ${WAKEFLOW_WINDOW_RUNTIME_KIND}`,
    );
  }
  if (
    Object.hasOwn(value, "schemaVersion")
    && field(value, "schemaVersion") !== WAKEFLOW_WINDOW_RUNTIME_SCHEMA_VERSION
  ) {
    fail(
      "wakeflow-window-runtime-schema-version",
      "$input/schemaVersion",
      `window runtime projection schemaVersion must be ${WAKEFLOW_WINDOW_RUNTIME_SCHEMA_VERSION}`,
    );
  }
  return normalizeProjection({
    kind: WAKEFLOW_WINDOW_RUNTIME_KIND,
    schemaVersion: WAKEFLOW_WINDOW_RUNTIME_SCHEMA_VERSION,
    ...Object.fromEntries(DOMAIN_FIELDS.map((key) => [key, field(value, key)])),
  }, { projectionDigestRequired: false });
}

/** 校验持久记录的字段、跨字段关系与自摘要；不把文件存在解释为当前事实。 */
export function validateWindowRuntimeProjection(value) {
  const normalized = normalizeProjection(value, { projectionDigestRequired: true });
  if (isDeepFrozen(value) && canonicalJson(value) === canonicalJson(normalized)) return value;
  return normalized;
}

/** 返回owner规定的canonical JSON加单个LF，用于确定性持久化和字节CAS。 */
export function windowRuntimeProjectionCanonicalBytes(value) {
  const record = validateWindowRuntimeProjection(value);
  return Buffer.from(`${canonicalJson(record)}\n`, "utf8");
}

/** 读取经完整codec验证的projectionDigest。 */
export function windowRuntimeProjectionDigest(value) {
  return validateWindowRuntimeProjection(value).projectionDigest;
}

function assertPortableComponent(value, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > 128
    || CONTROL_RE.test(value)
    || value === "."
    || value === ".."
    || value.includes("/")
    || value.includes("\\")
    || path.posix.basename(value) !== value
  ) {
    fail(
      "wakeflow-window-runtime-ref",
      errorPath,
      "host runtime directory name must be one safe portable path component",
    );
  }
  if (!PROTOCOL_HOST_IDS.has(value)) {
    fail(
      "wakeflow-window-runtime-ref",
      errorPath,
      "host runtime directory name must identify one supported Wakeflow protocol host",
    );
  }
  return value;
}

/**
 * 派生当前宿主私有projection路径；只接受protocol host目录名与typed windowId，
 * 不接受绝对路径、语义窗口名或调用方提供的任意文件名。
 */
export function windowRuntimeProjectionRef(value = {}) {
  assertExactKeys(value, ["hostDirName", "windowId"], [], "$input");
  const hostDirName = assertPortableComponent(
    field(value, "hostDirName"),
    "$input/hostDirName",
  );
  const windowId = assertTypedId(field(value, "windowId"), "window", "$input/windowId");
  return `.wakeflow-local/runtime/hosts/${hostDirName}/projections/window-runtime/${windowId}.json`;
}
