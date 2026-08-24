/**
 * keep-live portable record codec。
 *
 * 能力导航：
 * - 四类事实身份与路径：`WAKEFLOW_KEEP_LIVE_*_KIND`、`keepLive*Ref()`；
 * - 租约事实：`create/validate/keepLiveLease*()`；
 * - 进程代事实：`create/validate/keepLiveProcess*()`；
 * - 宿主控制请求：`create/validate/keepLiveControl*()`；
 * - 短时管理锁：`create/validate/keepLiveManagerLock*()`。
 *
 * 本文件只闭合纯数据、跨字段状态和自摘要，不读workspace、不观察进程，也不决定是否启动或停止宿主进程。
 */
import { randomUUID } from "node:crypto";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { WAKEFLOW_PROTOCOL_HOST_IDS } from "./wakeflow-host-capability.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";

const SCHEMA_VERSION = 1;
export const WAKEFLOW_KEEP_LIVE_LEASE_KIND = "wakeflow-keep-live-lease";
export const WAKEFLOW_KEEP_LIVE_PROCESS_KIND = "wakeflow-keep-live-process";
export const WAKEFLOW_KEEP_LIVE_CONTROL_KIND = "wakeflow-keep-live-control";
export const WAKEFLOW_KEEP_LIVE_MANAGER_LOCK_KIND = "wakeflow-keep-live-manager-lock";

const HOST_IDS = new Set(WAKEFLOW_PROTOCOL_HOST_IDS);
const HOST_DIRS = new Set(["codex", "claude-code"]);
const PROCESS_STATUSES = new Set(["starting", "running", "stopping", "failed"]);
const CONTROL_ACTIONS = new Set(["start", "stop"]);
const CONTROL_PHASES = new Set(["requested", "acknowledged", "failed"]);
const CAPABILITIES = new Set(["macos-caffeinate"]);
const MECHANISMS = new Set(["worker-caffeinate"]);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const GENERATION_ID_RE = /^keep-live-generation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_ID_RE = /^keep-live-request_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const WORKSPACE_OPERATION_ID_RE = /^workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TIMESTAMP_RE = /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,9})?Z$/u;
const CODE_RE = /^[a-z][a-z0-9-]{0,127}$/u;

// ===== 错误与无行为合同准入 =====

class WakeflowKeepLiveRecordError extends Error {
  constructor(code, message, { path = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowKeepLiveRecordError";
    this.code = code;
    this.path = path;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, path, message, details = {}) {
  throw new WakeflowKeepLiveRecordError(code, `${message} at ${path}`, { path, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, fields, path) {
  if (!plainObject(value)) fail("wakeflow-keep-live-record-type", path, "expected a plain object");
  const actual = Reflect.ownKeys(value);
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length
    || actual.some((field) => typeof field !== "string" || !fields.includes(field))
  ) {
    fail("wakeflow-keep-live-record-fields", path, "record has an invalid field set", {
      actual: actual.map(String).sort(),
      expected,
    });
  }
  const snapshot = {};
  for (const field of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-keep-live-record-fields",
        `${path}/${field}`,
        "record fields must be enumerable data properties",
      );
    }
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

// ===== 标量、进程主体与canonical摘要 =====

function enumValue(value, allowed, path, label) {
  if (typeof value !== "string" || !allowed.has(value)) {
    fail("wakeflow-keep-live-record-enum", path, `${label} is invalid`, {
      value,
      allowed: [...allowed],
    });
  }
  return value;
}

function digest(value, path) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-keep-live-record-digest", path, "expected a sha256 digest");
  }
  return value;
}

function timestamp(value, path) {
  if (typeof value !== "string" || !TIMESTAMP_RE.test(value) || !Number.isFinite(Date.parse(value))) {
    fail("wakeflow-keep-live-record-time", path, "expected a canonical UTC timestamp");
  }
  return value;
}

function nullableTimestamp(value, path) {
  return value === null ? null : timestamp(value, path);
}

function code(value, path) {
  if (typeof value !== "string" || !CODE_RE.test(value)) {
    fail("wakeflow-keep-live-record-code", path, "expected a bounded lower-case code");
  }
  return value;
}

function nullableCode(value, path) {
  return value === null ? null : code(value, path);
}

function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("wakeflow-keep-live-record-integer", path, "expected a positive safe integer");
  }
  return value;
}

function nullableString(value, matcher, path, label) {
  if (value === null) return null;
  if (typeof value !== "string" || !matcher.test(value)) {
    fail("wakeflow-keep-live-record-identifier", path, `${label} is invalid`);
  }
  return value;
}

function typedId(value, type, path) {
  try {
    return assertWakeflowId(value, type, path);
  } catch {
    fail("wakeflow-keep-live-record-identifier", path, `expected one typed ${type} identifier`);
  }
}

function hostId(value, path) {
  return enumValue(value, HOST_IDS, path, "hostId");
}

function hostDirectory(value, path) {
  return enumValue(value, HOST_DIRS, path, "host directory");
}

function generationId(value, path) {
  if (typeof value !== "string" || !GENERATION_ID_RE.test(value)) {
    fail("wakeflow-keep-live-record-identifier", path, "generationId is invalid");
  }
  return value;
}

function requestId(value, path) {
  if (typeof value !== "string" || !REQUEST_ID_RE.test(value)) {
    fail("wakeflow-keep-live-record-identifier", path, "requestId is invalid");
  }
  return value;
}

function processIdentity(value, path) {
  const input = exactObject(value, ["platform", "pid", "startIdentity"], path);
  if (input.platform !== "darwin" && input.platform !== "linux") {
    fail("wakeflow-keep-live-record-platform", `${path}/platform`, "process platform is unsupported");
  }
  return deepFreeze({
    platform: input.platform,
    pid: positiveInteger(input.pid, `${path}/pid`),
    startIdentity: digest(input.startIdentity, `${path}/startIdentity`),
  });
}

function processSubject(value, path) {
  if (value === null) return null;
  const input = exactObject(
    value,
    ["identity", "parentPid", "executableDigest", "argvDigest"],
    path,
  );
  return deepFreeze({
    identity: processIdentity(input.identity, `${path}/identity`),
    parentPid: positiveInteger(input.parentPid, `${path}/parentPid`),
    executableDigest: digest(input.executableDigest, `${path}/executableDigest`),
    argvDigest: digest(input.argvDigest, `${path}/argvDigest`),
  });
}

function temporalOrder(record, pairs) {
  for (const [earlier, later] of pairs) {
    if (record[earlier] !== null && record[later] !== null) {
      if (Date.parse(record[earlier]) > Date.parse(record[later])) {
        fail(
          "wakeflow-keep-live-record-time-order",
          `$/` + later,
          `${later} precedes ${earlier}`,
        );
      }
    }
  }
}

function unsignedRecord(record, digestField) {
  return Object.fromEntries(Object.entries(record).filter(([field]) => field !== digestField));
}

function assertSelfDigest(record, digestField) {
  const expected = canonicalJsonDigest(unsignedRecord(record, digestField));
  if (record[digestField] !== expected) {
    fail(
      "wakeflow-keep-live-record-self-digest",
      `$/${digestField}`,
      `${digestField} does not match the canonical record`,
      { expected, actual: record[digestField] },
    );
  }
}

function createSigned(unsigned, digestField) {
  return deepFreeze({
    ...unsigned,
    [digestField]: canonicalJsonDigest(unsigned),
  });
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

// ===== 标识与协议路径 =====

/**
 * 生成并校验一个新的进程代标识；可注入UUID源只用于确定性测试，不授予创建进程代的authority。
 */
export function generateKeepLiveGenerationId(uuidFactory = randomUUID) {
  if (typeof uuidFactory !== "function") {
    fail("wakeflow-keep-live-record-generator", "$uuidFactory", "UUID source must be a function");
  }
  return generationId(`keep-live-generation_${uuidFactory()}`, "$generatedId");
}

/**
 * 生成控制请求或管理锁使用的标识；调用方仍负责把它绑定到当前代、revision和workspace gate。
 */
export function generateKeepLiveRequestId(uuidFactory = randomUUID) {
  if (typeof uuidFactory !== "function") {
    fail("wakeflow-keep-live-record-generator", "$uuidFactory", "UUID source must be a function");
  }
  return requestId(`keep-live-request_${uuidFactory()}`, "$generatedId");
}

/**
 * 由宿主目录与automation run所有者确定单租约的portable ref。
 */
export function keepLiveLeaseRef(input = {}) {
  const values = exactObject(input, ["hostDirName", "automationRunId"], "$input");
  const directory = hostDirectory(values.hostDirName, "$input/hostDirName");
  const owner = typedId(values.automationRunId, "dispatch-group", "$input/automationRunId");
  return `.wakeflow-local/runtime/hosts/${directory}/operations/keep-live/leases/${owner}.json`;
}

// 三个宿主级单例ref只编码物理位置，不证明对应事实存在或当前有效。
export function keepLiveProcessRef(input = {}) {
  const values = exactObject(input, ["hostDirName"], "$input");
  return `.wakeflow-local/runtime/hosts/${hostDirectory(values.hostDirName, "$input/hostDirName")}/operations/keep-live/process.json`;
}

export function keepLiveControlRef(input = {}) {
  const values = exactObject(input, ["hostDirName"], "$input");
  return `.wakeflow-local/runtime/hosts/${hostDirectory(values.hostDirName, "$input/hostDirName")}/operations/keep-live/control.json`;
}

export function keepLiveManagerLockRef(input = {}) {
  const values = exactObject(input, ["hostDirName"], "$input");
  return `.wakeflow-local/runtime/hosts/${hostDirectory(values.hostDirName, "$input/hostDirName")}/operations/keep-live/manager.lock`;
}

const LEASE_CREATE_FIELDS = Object.freeze([
  "programId",
  "hostId",
  "demandId",
  "automationRunId",
  "acquiredAt",
  "lastConfirmedAt",
]);

// ===== Automation run租约事实 =====

/**
 * 创建带自摘要的租约事实；一个文件只表达一个automation run仍请求keep-live。
 */
export function createKeepLiveLeaseRecord(input = {}) {
  const values = exactObject(input, LEASE_CREATE_FIELDS, "$input");
  return validateKeepLiveLeaseRecord(createSigned({
    schemaVersion: SCHEMA_VERSION,
    artifactKind: WAKEFLOW_KEEP_LIVE_LEASE_KIND,
    programId: values.programId,
    hostId: values.hostId,
    demandId: values.demandId,
    automationRunId: values.automationRunId,
    acquiredAt: values.acquiredAt,
    lastConfirmedAt: values.lastConfirmedAt,
  }, "leaseDigest"));
}

/**
 * 闭合租约身份、typed ID、时间顺序和自摘要，并返回与调用方对象隔离的冻结快照。
 */
export function validateKeepLiveLeaseRecord(value) {
  const input = exactObject(value, [
    "schemaVersion",
    "artifactKind",
    ...LEASE_CREATE_FIELDS,
    "leaseDigest",
  ], "$record");
  if (input.schemaVersion !== SCHEMA_VERSION || input.artifactKind !== WAKEFLOW_KEEP_LIVE_LEASE_KIND) {
    fail("wakeflow-keep-live-record-identity", "$record", "lease record identity is invalid");
  }
  const record = {
    schemaVersion: SCHEMA_VERSION,
    artifactKind: WAKEFLOW_KEEP_LIVE_LEASE_KIND,
    programId: typedId(input.programId, "program", "$/programId"),
    hostId: hostId(input.hostId, "$/hostId"),
    demandId: typedId(input.demandId, "demand", "$/demandId"),
    automationRunId: typedId(input.automationRunId, "dispatch-group", "$/automationRunId"),
    acquiredAt: timestamp(input.acquiredAt, "$/acquiredAt"),
    lastConfirmedAt: timestamp(input.lastConfirmedAt, "$/lastConfirmedAt"),
    leaseDigest: digest(input.leaseDigest, "$/leaseDigest"),
  };
  temporalOrder(record, [["acquiredAt", "lastConfirmedAt"]]);
  assertSelfDigest(record, "leaseDigest");
  return deepFreeze(record);
}

export function keepLiveLeaseCanonicalBytes(value) {
  return canonicalBytes(validateKeepLiveLeaseRecord(value));
}

const PROCESS_CREATE_FIELDS = Object.freeze([
  "programId",
  "hostId",
  "generationId",
  "capability",
  "mechanism",
  "status",
  "worker",
  "child",
  "controlRequestId",
  "controlRevision",
  "createdAt",
  "startedAt",
  "observedAt",
  "stopRequestedAt",
  "errorCode",
]);

// ===== 当前进程代事实 =====

/**
 * 创建当前进程代的带摘要事实；worker/child只是精确主体证据，不是实时存活结论。
 */
export function createKeepLiveProcessRecord(input = {}) {
  const values = exactObject(input, PROCESS_CREATE_FIELDS, "$input");
  return validateKeepLiveProcessRecord(createSigned({
    schemaVersion: SCHEMA_VERSION,
    artifactKind: WAKEFLOW_KEEP_LIVE_PROCESS_KIND,
    ...values,
  }, "processDigest"));
}

/**
 * 校验starting/running/stopping/failed四态的字段闭包、父子进程关系、时间线和自摘要。
 */
export function validateKeepLiveProcessRecord(value) {
  const input = exactObject(value, [
    "schemaVersion",
    "artifactKind",
    ...PROCESS_CREATE_FIELDS,
    "processDigest",
  ], "$record");
  if (input.schemaVersion !== SCHEMA_VERSION || input.artifactKind !== WAKEFLOW_KEEP_LIVE_PROCESS_KIND) {
    fail("wakeflow-keep-live-record-identity", "$record", "process record identity is invalid");
  }
  const record = {
    schemaVersion: SCHEMA_VERSION,
    artifactKind: WAKEFLOW_KEEP_LIVE_PROCESS_KIND,
    programId: typedId(input.programId, "program", "$/programId"),
    hostId: hostId(input.hostId, "$/hostId"),
    generationId: generationId(input.generationId, "$/generationId"),
    capability: enumValue(input.capability, CAPABILITIES, "$/capability", "capability"),
    mechanism: enumValue(input.mechanism, MECHANISMS, "$/mechanism", "mechanism"),
    status: enumValue(input.status, PROCESS_STATUSES, "$/status", "process status"),
    worker: processSubject(input.worker, "$/worker"),
    child: processSubject(input.child, "$/child"),
    controlRequestId: requestId(input.controlRequestId, "$/controlRequestId"),
    controlRevision: positiveInteger(input.controlRevision, "$/controlRevision"),
    createdAt: timestamp(input.createdAt, "$/createdAt"),
    startedAt: nullableTimestamp(input.startedAt, "$/startedAt"),
    observedAt: timestamp(input.observedAt, "$/observedAt"),
    stopRequestedAt: nullableTimestamp(input.stopRequestedAt, "$/stopRequestedAt"),
    errorCode: nullableCode(input.errorCode, "$/errorCode"),
    processDigest: digest(input.processDigest, "$/processDigest"),
  };
  if (record.child !== null) {
    if (
      record.worker === null
      || record.child.parentPid !== record.worker.identity.pid
      || record.child.identity.platform !== record.worker.identity.platform
      || record.child.identity.pid === record.worker.identity.pid
    ) {
      fail(
        "wakeflow-keep-live-record-process-lineage",
        "$/child",
        "child must bind one distinct exact worker parent",
      );
    }
  }
  if (record.status === "starting") {
    if (
      record.worker !== null
      || record.child !== null
      || record.startedAt !== null
      || record.stopRequestedAt !== null
      || record.errorCode !== null
    ) {
      fail("wakeflow-keep-live-record-process-state", "$/status", "starting process fields are inconsistent");
    }
  } else if (record.status === "running") {
    if (
      record.worker === null
      || record.child === null
      || record.startedAt === null
      || record.stopRequestedAt !== null
      || record.errorCode !== null
    ) {
      fail("wakeflow-keep-live-record-process-state", "$/status", "running process fields are inconsistent");
    }
  } else if (record.status === "stopping") {
    if (
      (record.worker === null) !== (record.child === null)
      || (record.worker === null) !== (record.startedAt === null)
      || record.stopRequestedAt === null
      || record.errorCode !== null
    ) {
      fail("wakeflow-keep-live-record-process-state", "$/status", "stopping process fields are inconsistent");
    }
  } else if (
    record.stopRequestedAt !== null
    || record.errorCode === null
  ) {
    fail("wakeflow-keep-live-record-process-state", "$/status", "failed process fields are inconsistent");
  }
  temporalOrder(record, [
    ["createdAt", "startedAt"],
    ["createdAt", "observedAt"],
    ["startedAt", "observedAt"],
    ["startedAt", "stopRequestedAt"],
  ]);
  assertSelfDigest(record, "processDigest");
  return deepFreeze(record);
}

export function keepLiveProcessCanonicalBytes(value) {
  return canonicalBytes(validateKeepLiveProcessRecord(value));
}

const CONTROL_CREATE_FIELDS = Object.freeze([
  "programId",
  "hostId",
  "generationId",
  "requestId",
  "action",
  "phase",
  "revision",
  "requestedAt",
  "updatedAt",
  "errorCode",
]);

// ===== 宿主控制请求事实 =====

/**
 * 创建start/stop请求及其requested/acknowledged/failed阶段事实；真正宿主effect不在本文件执行。
 */
export function createKeepLiveControlRecord(input = {}) {
  const values = exactObject(input, CONTROL_CREATE_FIELDS, "$input");
  return validateKeepLiveControlRecord(createSigned({
    schemaVersion: SCHEMA_VERSION,
    artifactKind: WAKEFLOW_KEEP_LIVE_CONTROL_KIND,
    ...values,
  }, "controlDigest"));
}

/**
 * 校验控制请求的代、request、revision、阶段与错误字段闭包。
 */
export function validateKeepLiveControlRecord(value) {
  const input = exactObject(value, [
    "schemaVersion",
    "artifactKind",
    ...CONTROL_CREATE_FIELDS,
    "controlDigest",
  ], "$record");
  if (input.schemaVersion !== SCHEMA_VERSION || input.artifactKind !== WAKEFLOW_KEEP_LIVE_CONTROL_KIND) {
    fail("wakeflow-keep-live-record-identity", "$record", "control record identity is invalid");
  }
  const record = {
    schemaVersion: SCHEMA_VERSION,
    artifactKind: WAKEFLOW_KEEP_LIVE_CONTROL_KIND,
    programId: typedId(input.programId, "program", "$/programId"),
    hostId: hostId(input.hostId, "$/hostId"),
    generationId: generationId(input.generationId, "$/generationId"),
    requestId: requestId(input.requestId, "$/requestId"),
    action: enumValue(input.action, CONTROL_ACTIONS, "$/action", "control action"),
    phase: enumValue(input.phase, CONTROL_PHASES, "$/phase", "control phase"),
    revision: positiveInteger(input.revision, "$/revision"),
    requestedAt: timestamp(input.requestedAt, "$/requestedAt"),
    updatedAt: timestamp(input.updatedAt, "$/updatedAt"),
    errorCode: nullableCode(input.errorCode, "$/errorCode"),
    controlDigest: digest(input.controlDigest, "$/controlDigest"),
  };
  if ((record.phase === "failed") !== (record.errorCode !== null)) {
    fail("wakeflow-keep-live-record-control-state", "$/phase", "control errorCode does not match phase");
  }
  temporalOrder(record, [["requestedAt", "updatedAt"]]);
  assertSelfDigest(record, "controlDigest");
  return deepFreeze(record);
}

export function keepLiveControlCanonicalBytes(value) {
  return canonicalBytes(validateKeepLiveControlRecord(value));
}

const LOCK_CREATE_FIELDS = Object.freeze([
  "programId",
  "hostId",
  "lockId",
  "workspaceOperationId",
  "owner",
  "acquiredAt",
]);

// ===== keep-live领域短时管理锁 =====

/**
 * 创建绑定workspace mutation operation和进程生命周期身份的管理锁事实。
 */
export function createKeepLiveManagerLockRecord(input = {}) {
  const values = exactObject(input, LOCK_CREATE_FIELDS, "$input");
  return validateKeepLiveManagerLockRecord(createSigned({
    schemaVersion: SCHEMA_VERSION,
    artifactKind: WAKEFLOW_KEEP_LIVE_MANAGER_LOCK_KIND,
    ...values,
  }, "lockDigest"));
}

/**
 * 校验锁所有者与workspace operation绑定；是否可回收仍须由进程身份观察层判断。
 */
export function validateKeepLiveManagerLockRecord(value) {
  const input = exactObject(value, [
    "schemaVersion",
    "artifactKind",
    ...LOCK_CREATE_FIELDS,
    "lockDigest",
  ], "$record");
  if (
    input.schemaVersion !== SCHEMA_VERSION
    || input.artifactKind !== WAKEFLOW_KEEP_LIVE_MANAGER_LOCK_KIND
  ) {
    fail("wakeflow-keep-live-record-identity", "$record", "manager lock record identity is invalid");
  }
  const record = {
    schemaVersion: SCHEMA_VERSION,
    artifactKind: WAKEFLOW_KEEP_LIVE_MANAGER_LOCK_KIND,
    programId: typedId(input.programId, "program", "$/programId"),
    hostId: hostId(input.hostId, "$/hostId"),
    lockId: requestId(input.lockId, "$/lockId"),
    workspaceOperationId: nullableString(
      input.workspaceOperationId,
      WORKSPACE_OPERATION_ID_RE,
      "$/workspaceOperationId",
      "workspaceOperationId",
    ),
    owner: processIdentity(input.owner, "$/owner"),
    acquiredAt: timestamp(input.acquiredAt, "$/acquiredAt"),
    lockDigest: digest(input.lockDigest, "$/lockDigest"),
  };
  if (record.workspaceOperationId === null) {
    fail(
      "wakeflow-keep-live-record-identifier",
      "$/workspaceOperationId",
      "workspaceOperationId is required",
    );
  }
  assertSelfDigest(record, "lockDigest");
  return deepFreeze(record);
}

export function keepLiveManagerLockCanonicalBytes(value) {
  return canonicalBytes(validateKeepLiveManagerLockRecord(value));
}
