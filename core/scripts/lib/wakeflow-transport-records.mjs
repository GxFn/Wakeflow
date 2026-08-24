/**
 * Shared transport 的纯记录合同层。
 *
 * 本模块只负责四类 immutable transport 文件及其交叉闭包：
 * 1. DispatchGroup 固化一个轮次的完整成员和 Controller return policy；
 * 2. DispatchPacket 固化每个 target 的任务、边界、审查输入与结果合同；
 * 3. Target/Controller-return Envelope 固化一次 one-shot 发送意图和 binding 快照；
 * 4. DeliveryRun 固化一次宿主 attempt、readback、可选 record-time lease tuple 与连续 lineage。
 *
 * 所有 create/validate 都是无 I/O codec：不读取 current workspace，不选择 current result，
 * 不签发 send authority，也不把 transport/readback 事实解释为业务接受。物理写入归 transport store，
 * plan/claim/outcome/rearm 顺序归 delivery orchestration，归档脱敏与删除策略归各自 owner。
 */
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { WAKEFLOW_PROTOCOL_HOST_IDS } from "./wakeflow-host-capability.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  assertWindowBindingId,
  windowBindingRef,
} from "./wakeflow-window-binding-records.mjs";
import {
  assertWindowCoordinationLeaseId,
  validateWindowCoordinationLeaseRecord,
  windowCoordinationLeaseRef,
} from "./wakeflow-window-lease-records.mjs";

export const WAKEFLOW_TRANSPORT_SCHEMA_VERSION = 1;
export const WAKEFLOW_DISPATCH_GROUP_KIND = "wakeflow-dispatch-group";
export const WAKEFLOW_DISPATCH_PACKET_KIND = "wakeflow-controller-dispatch-packet";
export const WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND =
  "wakeflow-controller-return-envelope";
export const WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND =
  "wakeflow-target-delivery-envelope";
export const WAKEFLOW_DIRECT_THREAD_DELIVERY_RUN_KIND =
  "wakeflow-direct-thread-delivery-run";

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const DISALLOWED_TEXT_CONTROL_RE = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const RETURN_POLICY_MODES = new Set(["group-ready", "per-target"]);
const WORK_TYPES = new Set(["documentation", "implementation", "research", "test"]);
const COMMIT_EXPECTATIONS = new Set(["commit", "leave-uncommitted"]);
const CONTEXT_POLICIES = new Set(["assumed-current", "force-refresh", "refresh-if-missing"]);
const PROTOCOL_HOST_IDS = new Set(WAKEFLOW_PROTOCOL_HOST_IDS);
const DELIVERY_RUN_TRANSPORT_STATUSES = new Set([
  "accepted",
  "ambiguous",
  "rejected-before-send",
]);
const DELIVERY_RUN_READBACK_STATUSES = new Set([
  "confirmed",
  "pending",
  "unavailable",
]);
const RESERVED_HOST_FACT_TOKENS = new Set([
  "default",
  "none",
  "unknown",
  "unspecified",
]);
const WAKEFLOW_TARGET_SKILL_REF = "skills/wakeflow-target/SKILL.md";

const DISPATCH_GROUP_CREATE_FIELDS = Object.freeze([
  "programId",
  "demandId",
  "groupId",
  "stateRevision",
  "controllerWindowId",
  "members",
  "returnPolicy",
  "createdAt",
]);
const DISPATCH_GROUP_UNSIGNED_FIELDS = Object.freeze([
  "schemaVersion",
  "artifactKind",
  ...DISPATCH_GROUP_CREATE_FIELDS,
]);
const DISPATCH_GROUP_RECORD_FIELDS = Object.freeze([
  ...DISPATCH_GROUP_UNSIGNED_FIELDS,
  "groupDigest",
]);
const DISPATCH_GROUP_MEMBER_FIELDS = Object.freeze([
  "windowId",
  "targetTaskId",
  "packetId",
]);
const DISPATCH_PACKET_CREATE_FIELDS = Object.freeze([
  "programId",
  "demandId",
  "groupId",
  "groupDigest",
  "packetId",
  "windowId",
  "targetTaskId",
  "taskPackageId",
  "taskPackageDigest",
  "objective",
  "taskBriefing",
  "boundaries",
  "acceptanceAnchors",
  "reviewInputContract",
  "resultContract",
  "contextPolicy",
  "prompt",
  "createdAt",
]);
const DISPATCH_PACKET_CREATE_OPTIONAL_FIELDS = Object.freeze([
  "designIntent",
  "testContract",
]);
const DISPATCH_PACKET_UNSIGNED_FIELDS = Object.freeze([
  "schemaVersion",
  "artifactKind",
  "programId",
  "demandId",
  "groupId",
  "groupRef",
  "groupDigest",
  "packetId",
  "windowId",
  "targetTaskId",
  "taskPackageId",
  "taskPackageRef",
  "taskPackageDigest",
  "objective",
  "taskBriefing",
  "boundaries",
  "acceptanceAnchors",
  "reviewInputContract",
  "resultContract",
  "contextPolicy",
  "prompt",
  "createdAt",
]);
const DISPATCH_PACKET_UNSIGNED_OPTIONAL_FIELDS = DISPATCH_PACKET_CREATE_OPTIONAL_FIELDS;
const DISPATCH_PACKET_RECORD_FIELDS = Object.freeze([
  ...DISPATCH_PACKET_UNSIGNED_FIELDS,
  "packetDigest",
]);
const DELIVERY_ENVELOPE_COMMON_CREATE_FIELDS = Object.freeze([
  "programId",
  "demandId",
  "deliveryId",
  "groupId",
  "groupDigest",
  "preparedByHostId",
  "windowId",
  "bindingId",
  "identityBindingDigest",
  "prompt",
  "oneShot",
  "transportPolicy",
  "readbackPolicy",
  "automationRequested",
  "createdAt",
]);
const TARGET_DELIVERY_ENVELOPE_CREATE_FIELDS = Object.freeze([
  ...DELIVERY_ENVELOPE_COMMON_CREATE_FIELDS.slice(0, 5),
  "packetId",
  "packetDigest",
  ...DELIVERY_ENVELOPE_COMMON_CREATE_FIELDS.slice(5),
]);
const CONTROLLER_RETURN_ENVELOPE_CREATE_FIELDS = Object.freeze([
  ...DELIVERY_ENVELOPE_COMMON_CREATE_FIELDS.slice(0, 5),
  "resultSetDigest",
  "reviewSnapshotDigest",
  ...DELIVERY_ENVELOPE_COMMON_CREATE_FIELDS.slice(5),
]);
const DELIVERY_ENVELOPE_COMMON_UNSIGNED_FIELDS = Object.freeze([
  "schemaVersion",
  "artifactKind",
  "programId",
  "demandId",
  "deliveryId",
  "groupId",
  "groupRef",
  "groupDigest",
  "preparedByHostId",
  "windowId",
  "identityRef",
  "bindingId",
  "identityBindingDigest",
  "prompt",
  "oneShot",
  "transportPolicy",
  "readbackPolicy",
  "automationRequested",
  "correlationId",
  "createdAt",
]);
const TARGET_DELIVERY_ENVELOPE_UNSIGNED_FIELDS = Object.freeze([
  ...DELIVERY_ENVELOPE_COMMON_UNSIGNED_FIELDS.slice(0, 8),
  "packetId",
  "packetRef",
  "packetDigest",
  ...DELIVERY_ENVELOPE_COMMON_UNSIGNED_FIELDS.slice(8),
]);
const CONTROLLER_RETURN_ENVELOPE_UNSIGNED_FIELDS = Object.freeze([
  ...DELIVERY_ENVELOPE_COMMON_UNSIGNED_FIELDS.slice(0, 8),
  "resultSetDigest",
  "reviewSnapshotDigest",
  ...DELIVERY_ENVELOPE_COMMON_UNSIGNED_FIELDS.slice(8),
]);
const TARGET_DELIVERY_ENVELOPE_RECORD_FIELDS = Object.freeze([
  ...TARGET_DELIVERY_ENVELOPE_UNSIGNED_FIELDS,
  "envelopeDigest",
]);
const CONTROLLER_RETURN_ENVELOPE_RECORD_FIELDS = Object.freeze([
  ...CONTROLLER_RETURN_ENVELOPE_UNSIGNED_FIELDS,
  "envelopeDigest",
]);
const DELIVERY_RUN_CREATE_FIELDS = Object.freeze([
  "programId",
  "demandId",
  "runId",
  "deliveryId",
  "envelopeDigest",
  "hostId",
  "windowId",
  "attemptOrdinal",
  "hostMethod",
  "hostMode",
  "transportStatus",
  "readback",
  "createdAt",
]);
const DELIVERY_RUN_OPTIONAL_FIELDS = Object.freeze([
  "previousRun",
  "observedLease",
  "error",
]);
const DELIVERY_RUN_UNSIGNED_FIELDS = Object.freeze([
  "schemaVersion",
  "artifactKind",
  "programId",
  "demandId",
  "runId",
  "deliveryId",
  "envelopeRef",
  "envelopeDigest",
  "hostId",
  "windowId",
  "attemptOrdinal",
  "hostMethod",
  "hostMode",
  "transportStatus",
  "readback",
  "createdAt",
]);
const DELIVERY_RUN_RECORD_FIELDS = Object.freeze([
  ...DELIVERY_RUN_UNSIGNED_FIELDS,
  "runDigest",
]);

export class WakeflowTransportRecordError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowTransportRecordError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, errorPath, message, details = {}, cause = undefined) {
  throw new WakeflowTransportRecordError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
    cause,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// digest、record 与 ordered-set 使用 Unicode code unit 顺序，不能受宿主 locale 影响。
function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPlainObject(value, errorPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-transport-type", errorPath, "transport value must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-transport-type", errorPath, "transport value must be a plain object");
  }
  return value;
}

// 在读取字段值前先验证 descriptor，确保 accessor、hidden 与 Symbol 都不能携带行为或被忽略。
function ownDataKeys(value, errorPath) {
  const keys = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      fail(
        "wakeflow-transport-unknown-field",
        errorPath,
        "transport objects cannot contain symbol fields",
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-transport-field",
        `${errorPath}/${key}`,
        `transport field ${key} must be one enumerable data property`,
      );
    }
    keys.push(key);
  }
  return keys;
}

function assertExactKeys(value, required, errorPath) {
  return assertClosedKeys(value, required, [], errorPath);
}

function assertClosedKeys(value, required, optional, errorPath) {
  assertPlainObject(value, errorPath);
  const allowed = new Set([...required, ...optional]);
  for (const key of ownDataKeys(value, errorPath)) {
    if (!allowed.has(key)) {
      fail(
        "wakeflow-transport-unknown-field",
        `${errorPath}/${key}`,
        `unknown transport field ${key}`,
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail(
        "wakeflow-transport-required-field",
        `${errorPath}/${key}`,
        `missing required transport field ${key}`,
      );
    }
  }
  return value;
}

function field(value, key) {
  return Object.getOwnPropertyDescriptor(value, key).value;
}

function assertTypedId(value, type, errorPath) {
  try {
    return assertWakeflowId(value, type, errorPath);
  } catch (cause) {
    fail(
      "wakeflow-transport-identifier",
      errorPath,
      `transport record requires one typed ${type} identifier`,
      {},
      cause,
    );
  }
}

function assertDigest(value, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail(
      "wakeflow-transport-digest",
      errorPath,
      "transport digest must match sha256:<64 lowercase hex>",
    );
  }
  return value;
}

function assertPositiveInteger(value, errorPath) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(
      "wakeflow-transport-integer",
      errorPath,
      "transport state revision must be one positive safe integer",
    );
  }
  return value;
}

function assertTimestamp(value, errorPath) {
  const match = typeof value === "string" ? value.match(TIMESTAMP_RE) : null;
  if (!match) {
    fail(
      "wakeflow-transport-timestamp",
      errorPath,
      "transport timestamp must be one explicit strict UTC RFC3339 value",
    );
  }
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(0);
  parsed.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  parsed.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)
  ) {
    fail(
      "wakeflow-transport-timestamp",
      errorPath,
      "transport timestamp must name one real UTC calendar instant",
    );
  }
  return value;
}

function assertHumanText(value, errorPath) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || DISALLOWED_TEXT_CONTROL_RE.test(value)
  ) {
    fail(
      "wakeflow-transport-text",
      errorPath,
      "transport text must be non-empty, already trimmed, and free of disallowed controls",
    );
  }
  return value;
}

function assertToken(value, errorPath) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail(
      "wakeflow-transport-token",
      errorPath,
      "transport token must be non-empty, already trimmed, and free of controls",
    );
  }
  return value;
}

function assertHostFactToken(value, errorPath, label) {
  if (
    typeof value !== "string"
    || value.length < 3
    || value.length > 64
    || !/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/u.test(value)
    || RESERVED_HOST_FACT_TOKENS.has(value)
  ) {
    fail(
      "wakeflow-transport-host-fact-token",
      errorPath,
      `${label} must be one meaningful bounded lowercase token`,
    );
  }
  return value;
}

function assertEnum(value, allowed, errorPath, label) {
  if (typeof value !== "string" || !allowed.has(value)) {
    fail(
      "wakeflow-transport-enum",
      errorPath,
      `${label} must be one of: ${[...allowed].join(", ")}`,
    );
  }
  return value;
}

function assertBoolean(value, errorPath) {
  if (typeof value !== "boolean") {
    fail(
      "wakeflow-transport-boolean",
      errorPath,
      "transport boolean must be true or false",
    );
  }
  return value;
}

function assertProtocolHostId(value, errorPath) {
  if (typeof value !== "string" || !PROTOCOL_HOST_IDS.has(value)) {
    fail(
      "wakeflow-transport-host",
      errorPath,
      `transport host must be one of: ${WAKEFLOW_PROTOCOL_HOST_IDS.join(", ")}`,
    );
  }
  return value;
}

function assertBindingId(value, errorPath) {
  try {
    return assertWindowBindingId(value, errorPath);
  } catch (cause) {
    fail(
      "wakeflow-transport-identifier",
      errorPath,
      "delivery envelope requires one typed window binding identifier",
      {},
      cause,
    );
  }
}

function assertLeaseId(value, errorPath) {
  try {
    return assertWindowCoordinationLeaseId(value, errorPath);
  } catch (cause) {
    fail(
      "wakeflow-transport-identifier",
      errorPath,
      "delivery run observed lease requires one typed lease identifier",
      {},
      cause,
    );
  }
}

function timestampInstantNanoseconds(value) {
  const match = value.match(TIMESTAMP_RE);
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const parsed = new Date(0);
  parsed.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  parsed.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  return BigInt(parsed.getTime()) * 1_000_000n
    + BigInt(fraction.padEnd(9, "0") || "0");
}

function deriveIdentityRef(hostDirName, windowId, errorPath) {
  try {
    return windowBindingRef({ hostDirName, windowId });
  } catch (cause) {
    fail(
      "wakeflow-transport-ref",
      errorPath,
      "delivery envelope prepared host and window must derive one portable identity ref",
      {},
      cause,
    );
  }
}

function normalizeTransportPolicy(value, errorPath) {
  assertExactKeys(value, ["kind", "missingIdentity"], errorPath);
  if (field(value, "kind") !== "direct-thread") {
    fail(
      "wakeflow-transport-policy",
      `${errorPath}/kind`,
      "delivery envelope transport policy kind must be direct-thread",
    );
  }
  if (field(value, "missingIdentity") !== "rejected-before-send") {
    fail(
      "wakeflow-transport-policy",
      `${errorPath}/missingIdentity`,
      "delivery envelope missing identity policy must reject before send",
    );
  }
  return {
    kind: "direct-thread",
    missingIdentity: "rejected-before-send",
  };
}

function normalizeReadbackPolicy(value, errorPath) {
  assertExactKeys(value, ["required", "maxObservations"], errorPath);
  if (field(value, "required") !== true) {
    fail(
      "wakeflow-transport-policy",
      `${errorPath}/required`,
      "delivery envelope readback must be required",
    );
  }
  if (field(value, "maxObservations") !== 1) {
    fail(
      "wakeflow-transport-policy",
      `${errorPath}/maxObservations`,
      "delivery envelope readback policy permits exactly one observation",
    );
  }
  return { required: true, maxObservations: 1 };
}

// 数组准入先检查每个 slot descriptor，再由调用方 validator 读取值；附加属性和稀疏位一律拒绝。
function assertDenseArray(value, errorPath) {
  if (!Array.isArray(value)) {
    fail("wakeflow-transport-array", errorPath, "transport value must be an array");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) {
      fail(
        "wakeflow-transport-array",
        errorPath,
        "transport arrays cannot contain additional properties",
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-transport-array",
        `${errorPath}/${key}`,
        "transport array slots must be enumerable data properties",
      );
    }
  }
  return value;
}

// ordered-set 在保留调用方既有顺序的同时校验唯一性和 code-unit 顺序，不在背后重排输入。
function normalizeArray(
  value,
  errorPath,
  validator,
  { minItems = 0, uniqueKey = null, sortedKey = null } = {},
) {
  assertDenseArray(value, errorPath);
  if (value.length < minItems) {
    fail(
      "wakeflow-transport-array",
      errorPath,
      `transport array must contain at least ${minItems} item(s)`,
    );
  }
  const normalized = [];
  const seen = new Set();
  let previousSortKey = null;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail(
        "wakeflow-transport-array",
        `${errorPath}/${index}`,
        "transport arrays cannot contain sparse slots",
      );
    }
    const entry = validator(
      Object.getOwnPropertyDescriptor(value, String(index)).value,
      `${errorPath}/${index}`,
    );
    if (uniqueKey) {
      const key = uniqueKey(entry);
      if (seen.has(key)) {
        fail(
          "wakeflow-transport-array-duplicate",
          `${errorPath}/${index}`,
          "transport array entries must be unique",
        );
      }
      seen.add(key);
    }
    if (sortedKey) {
      const key = sortedKey(entry);
      if (previousSortKey !== null && lexicalCompare(previousSortKey, key) > 0) {
        fail(
          "wakeflow-transport-array-order",
          `${errorPath}/${index}`,
          "transport array entries must already use deterministic lexical order",
        );
      }
      previousSortKey = key;
    }
    normalized.push(entry);
  }
  return normalized;
}

function normalizeStringArray(value, errorPath, options = {}) {
  return normalizeArray(value, errorPath, assertHumanText, {
    ...options,
    ...(options.unique ? { uniqueKey: (entry) => entry } : {}),
    ...(options.sorted ? { sortedKey: (entry) => entry } : {}),
  });
}

function normalizeTokenArray(value, errorPath, { minItems = 0 } = {}) {
  return normalizeArray(value, errorPath, assertToken, {
    minItems,
    uniqueKey: (entry) => entry,
    sortedKey: (entry) => entry,
  });
}

function assertPortableRef(value, errorPath) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || value.includes("\\")
    || value.includes("//")
    || value.endsWith("/")
    || path.posix.isAbsolute(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
    || value.split("/").some((segment) => segment === "." || segment === "..")
    || path.posix.normalize(value) !== value
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail(
      "wakeflow-transport-ref",
      errorPath,
      "transport ref must be one normalized portable relative path",
    );
  }
  return value;
}

function assertSkillRef(value, errorPath) {
  assertPortableRef(value, errorPath);
  if (!/^skills\/[^/]+\/SKILL\.md$/u.test(value)) {
    fail(
      "wakeflow-transport-skill-ref",
      errorPath,
      "required skill must use the portable skills/<skill>/SKILL.md reference form",
    );
  }
  return value;
}

// —— DispatchPacket 内嵌任务合同 ——

// briefing 固化 target 已确认的执行上下文；Test 与非 Test 的 commit 责任保持不同。
function normalizeTaskBriefing(value, errorPath) {
  assertClosedKeys(value, [
    "workType",
    "confirmedContext",
    "completionExpectations",
    "requiredSkills",
  ], ["commitExpectation"], errorPath);
  const workType = assertEnum(
    field(value, "workType"),
    WORK_TYPES,
    `${errorPath}/workType`,
    "work type",
  );
  const hasCommitExpectation = Object.hasOwn(value, "commitExpectation");
  if (workType === "test" && hasCommitExpectation) {
    fail(
      "wakeflow-transport-test-contract",
      `${errorPath}/commitExpectation`,
      "Test task briefing must omit repository commit expectation",
    );
  }
  if (workType !== "test" && !hasCommitExpectation) {
    fail(
      "wakeflow-transport-task-briefing",
      `${errorPath}/commitExpectation`,
      "non-Test task briefing requires one commit expectation",
    );
  }
  const requiredSkills = normalizeArray(
    field(value, "requiredSkills"),
    `${errorPath}/requiredSkills`,
    assertSkillRef,
    {
      minItems: 1,
      uniqueKey: (entry) => entry,
    },
  );
  if (requiredSkills[0] !== WAKEFLOW_TARGET_SKILL_REF) {
    fail(
      "wakeflow-transport-task-briefing",
      `${errorPath}/requiredSkills/0`,
      `required Skills must begin with ${WAKEFLOW_TARGET_SKILL_REF}`,
    );
  }
  return {
    workType,
    confirmedContext: normalizeStringArray(
      field(value, "confirmedContext"),
      `${errorPath}/confirmedContext`,
      { minItems: 1, unique: true },
    ),
    completionExpectations: normalizeStringArray(
      field(value, "completionExpectations"),
      `${errorPath}/completionExpectations`,
      { minItems: 1, unique: true },
    ),
    requiredSkills,
    ...(hasCommitExpectation ? {
      commitExpectation: assertEnum(
        field(value, "commitExpectation"),
        COMMIT_EXPECTATIONS,
        `${errorPath}/commitExpectation`,
        "commit expectation",
      ),
    } : {}),
  };
}

function normalizeBoundaries(value, errorPath) {
  assertExactKeys(value, ["inScope", "outOfScope", "forbidden"], errorPath);
  return {
    inScope: normalizeStringArray(field(value, "inScope"), `${errorPath}/inScope`, {
      minItems: 1,
      unique: true,
    }),
    outOfScope: normalizeStringArray(field(value, "outOfScope"), `${errorPath}/outOfScope`, {
      unique: true,
    }),
    forbidden: normalizeStringArray(field(value, "forbidden"), `${errorPath}/forbidden`, {
      unique: true,
    }),
  };
}

function normalizeAcceptanceAnchor(value, errorPath) {
  assertExactKeys(value, ["anchorId", "claim", "probe", "expected"], errorPath);
  return {
    anchorId: assertToken(field(value, "anchorId"), `${errorPath}/anchorId`),
    claim: assertHumanText(field(value, "claim"), `${errorPath}/claim`),
    probe: assertHumanText(field(value, "probe"), `${errorPath}/probe`),
    expected: assertHumanText(field(value, "expected"), `${errorPath}/expected`),
  };
}

function normalizeAcceptanceAnchors(value, errorPath) {
  return normalizeArray(value, errorPath, normalizeAcceptanceAnchor, {
    uniqueKey: (entry) => entry.anchorId,
  });
}

function normalizeReviewInputContract(value, errorPath) {
  assertExactKeys(value, ["requiredKinds", "requiredAcceptanceAnchorIds"], errorPath);
  return {
    requiredKinds: normalizeTokenArray(
      field(value, "requiredKinds"),
      `${errorPath}/requiredKinds`,
    ),
    requiredAcceptanceAnchorIds: normalizeTokenArray(
      field(value, "requiredAcceptanceAnchorIds"),
      `${errorPath}/requiredAcceptanceAnchorIds`,
    ),
  };
}

function normalizeResultContract(value, errorPath) {
  assertExactKeys(value, ["artifactKind", "schemaVersion"], errorPath);
  if (field(value, "artifactKind") !== "wakeflow-target-result") {
    fail(
      "wakeflow-transport-result-contract",
      `${errorPath}/artifactKind`,
      "result contract artifactKind must be wakeflow-target-result",
    );
  }
  if (field(value, "schemaVersion") !== 1) {
    fail(
      "wakeflow-transport-result-contract",
      `${errorPath}/schemaVersion`,
      "result contract schemaVersion must be 1",
    );
  }
  return { artifactKind: "wakeflow-target-result", schemaVersion: 1 };
}

function assertInteger(value, errorPath, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(
      "wakeflow-transport-integer",
      errorPath,
      `transport integer must be between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function normalizeChangeControl(value, errorPath) {
  const fields = [
    "testMayChangeApproach",
    "testMayChangeGoal",
    "testMayAddUnmappedSteps",
    "testMayUseUnlistedSkills",
    "route",
  ];
  assertExactKeys(value, fields, errorPath);
  for (const key of fields.slice(0, -1)) {
    if (field(value, key) !== false) {
      fail(
        "wakeflow-transport-test-change-control",
        `${errorPath}/${key}`,
        `${key} must remain false in a frozen Test contract`,
      );
    }
  }
  if (field(value, "route") !== "return-blocked-to-controller") {
    fail(
      "wakeflow-transport-test-change-control",
      `${errorPath}/route`,
      "Test change-control route must return blocked to Controller",
    );
  }
  return {
    testMayChangeApproach: false,
    testMayChangeGoal: false,
    testMayAddUnmappedSteps: false,
    testMayUseUnlistedSkills: false,
    route: "return-blocked-to-controller",
  };
}

function normalizeTestExecutionContract(value, errorPath) {
  assertExactKeys(value, [
    "requirementGoal",
    "approvedPlan",
    "allowedSkills",
    "setupPolicy",
    "maxAttempts",
    "restartConditions",
    "changeControl",
  ], errorPath);
  const setupPolicy = assertEnum(
    field(value, "setupPolicy"),
    new Set(["fresh-once", "fresh-per-attempt", "reuse-existing"]),
    `${errorPath}/setupPolicy`,
    "Test setup policy",
  );
  const restartConditions = normalizeStringArray(
    field(value, "restartConditions"),
    `${errorPath}/restartConditions`,
    { unique: true },
  );
  if (setupPolicy === "fresh-per-attempt" && restartConditions.length === 0) {
    fail(
      "wakeflow-transport-test-restart",
      `${errorPath}/restartConditions`,
      "fresh-per-attempt Test execution requires an explicit restart condition",
    );
  }
  return {
    requirementGoal: assertHumanText(
      field(value, "requirementGoal"),
      `${errorPath}/requirementGoal`,
    ),
    approvedPlan: normalizeStringArray(
      field(value, "approvedPlan"),
      `${errorPath}/approvedPlan`,
      { minItems: 1 },
    ),
    allowedSkills: normalizeTokenArray(
      field(value, "allowedSkills"),
      `${errorPath}/allowedSkills`,
    ),
    setupPolicy,
    maxAttempts: assertInteger(
      field(value, "maxAttempts"),
      `${errorPath}/maxAttempts`,
      { minimum: 1, maximum: 10 },
    ),
    restartConditions,
    changeControl: normalizeChangeControl(
      field(value, "changeControl"),
      `${errorPath}/changeControl`,
    ),
  };
}

function normalizeTestCardTuple(value, errorPath) {
  assertExactKeys(value, ["testCardId", "ref", "digest"], errorPath);
  const testCardId = assertTypedId(
    field(value, "testCardId"),
    "test-card",
    `${errorPath}/testCardId`,
  );
  const ref = assertPortableRef(field(value, "ref"), `${errorPath}/ref`);
  const expectedRef = `test-cards/${testCardId}.json`;
  if (ref !== expectedRef) {
    fail(
      "wakeflow-transport-ref",
      `${errorPath}/ref`,
      `TestCard ref must be ${expectedRef}`,
    );
  }
  return {
    testCardId,
    ref,
    digest: assertDigest(field(value, "digest"), `${errorPath}/digest`),
  };
}

function normalizeTestContract(value, errorPath) {
  assertExactKeys(value, ["testCard", "executionContract"], errorPath);
  return {
    testCard: normalizeTestCardTuple(field(value, "testCard"), `${errorPath}/testCard`),
    executionContract: normalizeTestExecutionContract(
      field(value, "executionContract"),
      `${errorPath}/executionContract`,
    ),
  };
}

function normalizeDispatchGroupMember(value, errorPath) {
  assertExactKeys(value, DISPATCH_GROUP_MEMBER_FIELDS, errorPath);
  return {
    windowId: assertTypedId(field(value, "windowId"), "window", `${errorPath}/windowId`),
    targetTaskId: assertTypedId(
      field(value, "targetTaskId"),
      "target-task",
      `${errorPath}/targetTaskId`,
    ),
    packetId: assertTypedId(
      field(value, "packetId"),
      "dispatch-packet",
      `${errorPath}/packetId`,
    ),
  };
}

function normalizeDispatchGroupMembers(value, errorPath) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(
      "wakeflow-transport-group-members",
      errorPath,
      "dispatch group members must be one non-empty ordered array",
    );
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) {
      fail(
        "wakeflow-transport-group-members",
        errorPath,
        "dispatch group members cannot contain additional array properties",
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-transport-group-members",
        `${errorPath}/${key}`,
        "dispatch group member slots must be enumerable data properties",
      );
    }
  }
  const members = [];
  const targetTaskIds = new Set();
  const packetIds = new Set();
  const assignments = new Set();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail(
        "wakeflow-transport-group-members",
        `${errorPath}/${index}`,
        "dispatch group members cannot contain sparse slots",
      );
    }
    const member = normalizeDispatchGroupMember(
      Object.getOwnPropertyDescriptor(value, String(index)).value,
      `${errorPath}/${index}`,
    );
    const assignment = `${member.windowId}\u0000${member.targetTaskId}`;
    if (assignments.has(assignment)) {
      fail(
        "wakeflow-transport-group-member-duplicate",
        `${errorPath}/${index}`,
        `dispatch group window/task assignment ${member.windowId}/${member.targetTaskId} is duplicated`,
      );
    }
    if (targetTaskIds.has(member.targetTaskId)) {
      fail(
        "wakeflow-transport-group-member-duplicate",
        `${errorPath}/${index}/targetTaskId`,
        `dispatch group target task ${member.targetTaskId} is duplicated`,
      );
    }
    if (packetIds.has(member.packetId)) {
      fail(
        "wakeflow-transport-group-member-duplicate",
        `${errorPath}/${index}/packetId`,
        `dispatch group packet ${member.packetId} is duplicated`,
      );
    }
    const previous = members.at(-1);
    if (
      previous
      && (
        previous.windowId > member.windowId
        || (
          previous.windowId === member.windowId
          && previous.targetTaskId > member.targetTaskId
        )
      )
    ) {
      fail(
        "wakeflow-transport-group-member-order",
        `${errorPath}/${index}`,
        "dispatch group members must already use windowId then targetTaskId lexical order",
      );
    }
    assignments.add(assignment);
    targetTaskIds.add(member.targetTaskId);
    packetIds.add(member.packetId);
    members.push(member);
  }
  return members;
}

function normalizeReturnPolicy(value, errorPath) {
  assertExactKeys(value, ["mode"], errorPath);
  const mode = field(value, "mode");
  if (typeof mode !== "string" || !RETURN_POLICY_MODES.has(mode)) {
    fail(
      "wakeflow-transport-return-policy",
      `${errorPath}/mode`,
      "dispatch group return policy mode must be group-ready or per-target",
    );
  }
  return { mode };
}

// —— DispatchGroup codec ——

// group digest 覆盖完整成员集合、来源 state revision、Controller 与 return policy。
function normalizeDispatchGroupRecord(value, { digestRequired }) {
  assertExactKeys(
    value,
    digestRequired ? DISPATCH_GROUP_RECORD_FIELDS : DISPATCH_GROUP_UNSIGNED_FIELDS,
    "$",
  );
  if (field(value, "schemaVersion") !== WAKEFLOW_TRANSPORT_SCHEMA_VERSION) {
    fail(
      "wakeflow-transport-schema-version",
      "$/schemaVersion",
      `dispatch group schemaVersion must be ${WAKEFLOW_TRANSPORT_SCHEMA_VERSION}`,
    );
  }
  if (field(value, "artifactKind") !== WAKEFLOW_DISPATCH_GROUP_KIND) {
    fail(
      "wakeflow-transport-artifact-kind",
      "$/artifactKind",
      `dispatch group artifactKind must be ${WAKEFLOW_DISPATCH_GROUP_KIND}`,
    );
  }
  const demandId = assertTypedId(field(value, "demandId"), "demand", "$/demandId");
  const unsigned = {
    schemaVersion: WAKEFLOW_TRANSPORT_SCHEMA_VERSION,
    artifactKind: WAKEFLOW_DISPATCH_GROUP_KIND,
    programId: assertTypedId(field(value, "programId"), "program", "$/programId"),
    demandId,
    groupId: assertTypedId(field(value, "groupId"), "dispatch-group", "$/groupId"),
    stateRevision: assertPositiveInteger(field(value, "stateRevision"), "$/stateRevision"),
    controllerWindowId: assertTypedId(
      field(value, "controllerWindowId"),
      "window",
      "$/controllerWindowId",
    ),
    members: normalizeDispatchGroupMembers(field(value, "members"), "$/members"),
    returnPolicy: normalizeReturnPolicy(field(value, "returnPolicy"), "$/returnPolicy"),
    createdAt: assertTimestamp(field(value, "createdAt"), "$/createdAt"),
  };
  const expectedDigest = canonicalJsonDigest(unsigned);
  if (digestRequired) {
    const actualDigest = assertDigest(field(value, "groupDigest"), "$/groupDigest");
    if (actualDigest !== expectedDigest) {
      fail(
        "wakeflow-transport-digest",
        "$/groupDigest",
        "groupDigest must cover the complete canonical dispatch group excluding itself",
      );
    }
  }
  return deepFreeze({ ...unsigned, groupDigest: expectedDigest });
}

/** 根据已关闭的创建字段生成 self-digest、deep-frozen DispatchGroup。 */
export function createDispatchGroupRecord(value = {}) {
  assertExactKeys(value, DISPATCH_GROUP_CREATE_FIELDS, "$input");
  return normalizeDispatchGroupRecord({
    schemaVersion: WAKEFLOW_TRANSPORT_SCHEMA_VERSION,
    artifactKind: WAKEFLOW_DISPATCH_GROUP_KIND,
    ...Object.fromEntries(DISPATCH_GROUP_CREATE_FIELDS.map((key) => [key, field(value, key)])),
  }, { digestRequired: false });
}

/** 验证已有 DispatchGroup 的完整字段与自摘要，不读取其他 transport 文件。 */
export function validateDispatchGroupRecord(value) {
  return normalizeDispatchGroupRecord(value, { digestRequired: true });
}

export function dispatchGroupDigest(value) {
  return validateDispatchGroupRecord(value).groupDigest;
}

export function dispatchGroupCanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(validateDispatchGroupRecord(value))}\n`, "utf8");
}

/** 从 demand/group typed ID 派生唯一 portable ref。 */
export function dispatchGroupRef(value = {}) {
  assertExactKeys(value, ["demandId", "groupId"], "$input");
  const demandId = assertTypedId(field(value, "demandId"), "demand", "$input/demandId");
  const groupId = assertTypedId(field(value, "groupId"), "dispatch-group", "$input/groupId");
  const ref = `.wakeflow-local/runtime/shared/transport/demands/${demandId}`
    + `/groups/${groupId}.json`;
  if (path.posix.isAbsolute(ref) || path.posix.normalize(ref) !== ref || ref.includes("\\")) {
    fail("wakeflow-transport-ref", "$input", "dispatch group ref must be canonical and portable");
  }
  return ref;
}

function taskPackageRef({ taskPackageId }) {
  return `task-packages/${taskPackageId}.json`;
}

// —— DispatchPacket codec ——

// packet 固化 target 执行与 review 消费的全部字段，但不反向重建或拥有 group。
function normalizeDispatchPacketRecord(value, { digestRequired }) {
  assertClosedKeys(
    value,
    digestRequired ? DISPATCH_PACKET_RECORD_FIELDS : DISPATCH_PACKET_UNSIGNED_FIELDS,
    DISPATCH_PACKET_UNSIGNED_OPTIONAL_FIELDS,
    "$",
  );
  if (field(value, "schemaVersion") !== WAKEFLOW_TRANSPORT_SCHEMA_VERSION) {
    fail(
      "wakeflow-transport-schema-version",
      "$/schemaVersion",
      `dispatch packet schemaVersion must be ${WAKEFLOW_TRANSPORT_SCHEMA_VERSION}`,
    );
  }
  if (field(value, "artifactKind") !== WAKEFLOW_DISPATCH_PACKET_KIND) {
    fail(
      "wakeflow-transport-artifact-kind",
      "$/artifactKind",
      `dispatch packet artifactKind must be ${WAKEFLOW_DISPATCH_PACKET_KIND}`,
    );
  }

  const programId = assertTypedId(field(value, "programId"), "program", "$/programId");
  const demandId = assertTypedId(field(value, "demandId"), "demand", "$/demandId");
  const groupId = assertTypedId(field(value, "groupId"), "dispatch-group", "$/groupId");
  const expectedGroupRef = dispatchGroupRef({ demandId, groupId });
  if (field(value, "groupRef") !== expectedGroupRef) {
    fail(
      "wakeflow-transport-ref",
      "$/groupRef",
      `dispatch packet groupRef must be ${expectedGroupRef}`,
    );
  }
  const taskPackageId = assertTypedId(
    field(value, "taskPackageId"),
    "task-package",
    "$/taskPackageId",
  );
  const expectedTaskPackageRef = taskPackageRef({ taskPackageId });
  if (field(value, "taskPackageRef") !== expectedTaskPackageRef) {
    fail(
      "wakeflow-transport-ref",
      "$/taskPackageRef",
      `dispatch packet taskPackageRef must be ${expectedTaskPackageRef}`,
    );
  }

  const taskBriefing = normalizeTaskBriefing(field(value, "taskBriefing"), "$/taskBriefing");
  const acceptanceAnchors = normalizeAcceptanceAnchors(
    field(value, "acceptanceAnchors"),
    "$/acceptanceAnchors",
  );
  const reviewInputContract = normalizeReviewInputContract(
    field(value, "reviewInputContract"),
    "$/reviewInputContract",
  );
  const anchorIds = acceptanceAnchors.map((entry) => entry.anchorId);
  for (const requiredAnchorId of reviewInputContract.requiredAcceptanceAnchorIds) {
    if (!anchorIds.includes(requiredAnchorId)) {
      fail(
        "wakeflow-transport-acceptance-anchor",
        "$/reviewInputContract/requiredAcceptanceAnchorIds",
        `review input contract names unknown acceptance anchor ${requiredAnchorId}`,
      );
    }
  }
  if (taskBriefing.workType === "implementation" && acceptanceAnchors.length === 0) {
    fail(
      "wakeflow-transport-acceptance-anchor",
      "$/acceptanceAnchors",
      "implementation dispatch packet requires at least one acceptance anchor",
    );
  }
  if (taskBriefing.workType === "test") {
    if (acceptanceAnchors.length !== 0 || reviewInputContract.requiredAcceptanceAnchorIds.length !== 0) {
      fail(
        "wakeflow-transport-test-contract",
        "$/acceptanceAnchors",
        "Test dispatch packet cannot define acceptance-anchor review mapping",
      );
    }
    if (!Object.hasOwn(value, "testContract")) {
      fail(
        "wakeflow-transport-test-contract",
        "$/testContract",
        "Test dispatch packet requires one frozen Test contract",
      );
    }
  } else {
    if (Object.hasOwn(value, "testContract")) {
      fail(
        "wakeflow-transport-test-contract",
        "$/testContract",
        "non-Test dispatch packet must omit Test contract",
      );
    }
    const sortedAnchorIds = [...anchorIds].sort(lexicalCompare);
    if (
      sortedAnchorIds.length !== reviewInputContract.requiredAcceptanceAnchorIds.length
      || sortedAnchorIds.some(
        (anchorId, index) => (
          anchorId !== reviewInputContract.requiredAcceptanceAnchorIds[index]
        ),
      )
    ) {
      fail(
        "wakeflow-transport-acceptance-anchor",
        "$/reviewInputContract/requiredAcceptanceAnchorIds",
        "non-Test dispatch review contract must require the exact authored anchor set",
      );
    }
  }

  const unsigned = {
    schemaVersion: WAKEFLOW_TRANSPORT_SCHEMA_VERSION,
    artifactKind: WAKEFLOW_DISPATCH_PACKET_KIND,
    programId,
    demandId,
    groupId,
    groupRef: expectedGroupRef,
    groupDigest: assertDigest(field(value, "groupDigest"), "$/groupDigest"),
    packetId: assertTypedId(field(value, "packetId"), "dispatch-packet", "$/packetId"),
    windowId: assertTypedId(field(value, "windowId"), "window", "$/windowId"),
    targetTaskId: assertTypedId(
      field(value, "targetTaskId"),
      "target-task",
      "$/targetTaskId",
    ),
    taskPackageId,
    taskPackageRef: expectedTaskPackageRef,
    taskPackageDigest: assertDigest(field(value, "taskPackageDigest"), "$/taskPackageDigest"),
    objective: assertHumanText(field(value, "objective"), "$/objective"),
    taskBriefing,
    boundaries: normalizeBoundaries(field(value, "boundaries"), "$/boundaries"),
    acceptanceAnchors,
    ...(Object.hasOwn(value, "designIntent") ? {
      designIntent: assertHumanText(field(value, "designIntent"), "$/designIntent"),
    } : {}),
    reviewInputContract,
    resultContract: normalizeResultContract(field(value, "resultContract"), "$/resultContract"),
    ...(Object.hasOwn(value, "testContract") ? {
      testContract: normalizeTestContract(field(value, "testContract"), "$/testContract"),
    } : {}),
    contextPolicy: assertEnum(
      field(value, "contextPolicy"),
      CONTEXT_POLICIES,
      "$/contextPolicy",
      "context policy",
    ),
    prompt: assertHumanText(field(value, "prompt"), "$/prompt"),
    createdAt: assertTimestamp(field(value, "createdAt"), "$/createdAt"),
  };
  const expectedDigest = canonicalJsonDigest(unsigned);
  if (digestRequired) {
    const actualDigest = assertDigest(field(value, "packetDigest"), "$/packetDigest");
    if (actualDigest !== expectedDigest) {
      fail(
        "wakeflow-transport-digest",
        "$/packetDigest",
        "packetDigest must cover the complete canonical dispatch packet excluding itself",
      );
    }
  }
  return deepFreeze({ ...unsigned, packetDigest: expectedDigest });
}

/** 根据 TaskPackage 已选字段创建 immutable DispatchPacket。 */
export function createDispatchPacketRecord(value = {}) {
  assertClosedKeys(
    value,
    DISPATCH_PACKET_CREATE_FIELDS,
    DISPATCH_PACKET_CREATE_OPTIONAL_FIELDS,
    "$input",
  );
  const normalizedInput = Object.fromEntries(
    DISPATCH_PACKET_CREATE_FIELDS.map((key) => [key, field(value, key)]),
  );
  for (const key of DISPATCH_PACKET_CREATE_OPTIONAL_FIELDS) {
    if (Object.hasOwn(value, key)) normalizedInput[key] = field(value, key);
  }
  const demandId = assertTypedId(normalizedInput.demandId, "demand", "$input/demandId");
  const groupId = assertTypedId(normalizedInput.groupId, "dispatch-group", "$input/groupId");
  const taskPackageId = assertTypedId(
    normalizedInput.taskPackageId,
    "task-package",
    "$input/taskPackageId",
  );
  return normalizeDispatchPacketRecord({
    schemaVersion: WAKEFLOW_TRANSPORT_SCHEMA_VERSION,
    artifactKind: WAKEFLOW_DISPATCH_PACKET_KIND,
    ...normalizedInput,
    groupRef: dispatchGroupRef({ demandId, groupId }),
    taskPackageRef: taskPackageRef({ taskPackageId }),
  }, { digestRequired: false });
}

/** 验证 packet 自身 closed shape 与 packetDigest。 */
export function validateDispatchPacketRecord(value) {
  return normalizeDispatchPacketRecord(value, { digestRequired: true });
}

export function dispatchPacketDigest(value) {
  return validateDispatchPacketRecord(value).packetDigest;
}

export function dispatchPacketCanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(validateDispatchPacketRecord(value))}\n`, "utf8");
}

export function dispatchPacketRef(value = {}) {
  assertExactKeys(value, ["demandId", "packetId"], "$input");
  const demandId = assertTypedId(field(value, "demandId"), "demand", "$input/demandId");
  const packetId = assertTypedId(
    field(value, "packetId"),
    "dispatch-packet",
    "$input/packetId",
  );
  return `.wakeflow-local/runtime/shared/transport/demands/${demandId}`
    + `/packets/${packetId}.json`;
}

/** 证明 packet 精确属于 group 的一个 window/target/packet 成员。 */
export function validateDispatchPacketAgainstGroup(value = {}) {
  assertExactKeys(value, ["packet", "group"], "$input");
  const packet = validateDispatchPacketRecord(field(value, "packet"));
  const group = validateDispatchGroupRecord(field(value, "group"));
  const mismatches = [];
  if (packet.programId !== group.programId) mismatches.push("programId");
  if (packet.demandId !== group.demandId) mismatches.push("demandId");
  if (packet.groupId !== group.groupId) mismatches.push("groupId");
  if (packet.groupDigest !== group.groupDigest) mismatches.push("groupDigest");
  const member = group.members.find((entry) => entry.packetId === packet.packetId);
  if (!member) {
    mismatches.push("packetId");
  } else {
    if (packet.windowId !== member.windowId) mismatches.push("windowId");
    if (packet.targetTaskId !== member.targetTaskId) mismatches.push("targetTaskId");
  }
  if (mismatches.length > 0) {
    fail(
      "wakeflow-transport-group-membership",
      "$input",
      `dispatch packet does not match its exact group membership: ${mismatches.join(", ")}`,
      { mismatches },
    );
  }
  return packet;
}

function envelopeFieldsForKind(artifactKind, { digestRequired }) {
  if (artifactKind === WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND) {
    return digestRequired
      ? TARGET_DELIVERY_ENVELOPE_RECORD_FIELDS
      : TARGET_DELIVERY_ENVELOPE_UNSIGNED_FIELDS;
  }
  if (artifactKind === WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND) {
    return digestRequired
      ? CONTROLLER_RETURN_ENVELOPE_RECORD_FIELDS
      : CONTROLLER_RETURN_ENVELOPE_UNSIGNED_FIELDS;
  }
  fail(
    "wakeflow-transport-artifact-kind",
    "$/artifactKind",
    "delivery envelope artifactKind must be target-delivery or controller-return",
  );
}

// —— DeliveryEnvelope codec ——

// 两类 envelope 共享 one-shot/binding/policy 主体，但 target 与 Controller-return 的 lineage 字段互斥。
function normalizeDeliveryEnvelopeRecord(value, { digestRequired }) {
  assertPlainObject(value, "$");
  if (!Object.hasOwn(value, "artifactKind")) {
    fail(
      "wakeflow-transport-required-field",
      "$/artifactKind",
      "missing required transport field artifactKind",
    );
  }
  const artifactKind = field(value, "artifactKind");
  assertExactKeys(value, envelopeFieldsForKind(artifactKind, { digestRequired }), "$");
  if (field(value, "schemaVersion") !== WAKEFLOW_TRANSPORT_SCHEMA_VERSION) {
    fail(
      "wakeflow-transport-schema-version",
      "$/schemaVersion",
      `delivery envelope schemaVersion must be ${WAKEFLOW_TRANSPORT_SCHEMA_VERSION}`,
    );
  }

  const programId = assertTypedId(field(value, "programId"), "program", "$/programId");
  const demandId = assertTypedId(field(value, "demandId"), "demand", "$/demandId");
  const deliveryId = assertTypedId(field(value, "deliveryId"), "delivery", "$/deliveryId");
  const groupId = assertTypedId(field(value, "groupId"), "dispatch-group", "$/groupId");
  const expectedGroupRef = dispatchGroupRef({ demandId, groupId });
  if (field(value, "groupRef") !== expectedGroupRef) {
    fail(
      "wakeflow-transport-ref",
      "$/groupRef",
      `delivery envelope groupRef must be ${expectedGroupRef}`,
    );
  }
  const preparedByHostId = assertProtocolHostId(
    field(value, "preparedByHostId"),
    "$/preparedByHostId",
  );
  const windowId = assertTypedId(field(value, "windowId"), "window", "$/windowId");
  const expectedIdentityRef = deriveIdentityRef(
    preparedByHostId,
    windowId,
    "$/identityRef",
  );
  if (field(value, "identityRef") !== expectedIdentityRef) {
    fail(
      "wakeflow-transport-ref",
      "$/identityRef",
      `delivery envelope identityRef must be ${expectedIdentityRef}`,
    );
  }
  if (field(value, "oneShot") !== true) {
    fail(
      "wakeflow-transport-policy",
      "$/oneShot",
      "delivery envelope must be one-shot",
    );
  }
  if (field(value, "correlationId") !== groupId) {
    fail(
      "wakeflow-transport-correlation",
      "$/correlationId",
      "delivery envelope correlationId must equal its dispatch group identifier",
    );
  }

  const commonPrefix = {
    schemaVersion: WAKEFLOW_TRANSPORT_SCHEMA_VERSION,
    artifactKind,
    programId,
    demandId,
    deliveryId,
    groupId,
    groupRef: expectedGroupRef,
    groupDigest: assertDigest(field(value, "groupDigest"), "$/groupDigest"),
  };
  let variant;
  if (artifactKind === WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND) {
    const packetId = assertTypedId(
      field(value, "packetId"),
      "dispatch-packet",
      "$/packetId",
    );
    const expectedPacketRef = dispatchPacketRef({ demandId, packetId });
    if (field(value, "packetRef") !== expectedPacketRef) {
      fail(
        "wakeflow-transport-ref",
        "$/packetRef",
        `target delivery envelope packetRef must be ${expectedPacketRef}`,
      );
    }
    variant = {
      packetId,
      packetRef: expectedPacketRef,
      packetDigest: assertDigest(field(value, "packetDigest"), "$/packetDigest"),
    };
  } else {
    variant = {
      resultSetDigest: assertDigest(
        field(value, "resultSetDigest"),
        "$/resultSetDigest",
      ),
      reviewSnapshotDigest: assertDigest(
        field(value, "reviewSnapshotDigest"),
        "$/reviewSnapshotDigest",
      ),
    };
  }
  const unsigned = {
    ...commonPrefix,
    ...variant,
    preparedByHostId,
    windowId,
    identityRef: expectedIdentityRef,
    bindingId: assertBindingId(field(value, "bindingId"), "$/bindingId"),
    identityBindingDigest: assertDigest(
      field(value, "identityBindingDigest"),
      "$/identityBindingDigest",
    ),
    prompt: assertHumanText(field(value, "prompt"), "$/prompt"),
    oneShot: true,
    transportPolicy: normalizeTransportPolicy(
      field(value, "transportPolicy"),
      "$/transportPolicy",
    ),
    readbackPolicy: normalizeReadbackPolicy(
      field(value, "readbackPolicy"),
      "$/readbackPolicy",
    ),
    automationRequested: assertBoolean(
      field(value, "automationRequested"),
      "$/automationRequested",
    ),
    correlationId: groupId,
    createdAt: assertTimestamp(field(value, "createdAt"), "$/createdAt"),
  };
  const expectedDigest = canonicalJsonDigest(unsigned);
  if (digestRequired) {
    const actualDigest = assertDigest(field(value, "envelopeDigest"), "$/envelopeDigest");
    if (actualDigest !== expectedDigest) {
      fail(
        "wakeflow-transport-digest",
        "$/envelopeDigest",
        "envelopeDigest must cover the complete canonical delivery envelope excluding itself",
      );
    }
  }
  return deepFreeze({ ...unsigned, envelopeDigest: expectedDigest });
}

function createDeliveryEnvelopeRecord(value, { artifactKind, createFields }) {
  assertExactKeys(value, createFields, "$input");
  const normalizedInput = Object.fromEntries(
    createFields.map((key) => [key, field(value, key)]),
  );
  const demandId = assertTypedId(normalizedInput.demandId, "demand", "$input/demandId");
  const groupId = assertTypedId(
    normalizedInput.groupId,
    "dispatch-group",
    "$input/groupId",
  );
  const windowId = assertTypedId(normalizedInput.windowId, "window", "$input/windowId");
  const preparedByHostId = assertProtocolHostId(
    normalizedInput.preparedByHostId,
    "$input/preparedByHostId",
  );
  const derived = {
    groupRef: dispatchGroupRef({ demandId, groupId }),
    identityRef: deriveIdentityRef(
      preparedByHostId,
      windowId,
      "$input/preparedByHostId",
    ),
    correlationId: groupId,
  };
  if (artifactKind === WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND) {
    const packetId = assertTypedId(
      normalizedInput.packetId,
      "dispatch-packet",
      "$input/packetId",
    );
    derived.packetRef = dispatchPacketRef({ demandId, packetId });
  }
  return normalizeDeliveryEnvelopeRecord({
    schemaVersion: WAKEFLOW_TRANSPORT_SCHEMA_VERSION,
    artifactKind,
    ...normalizedInput,
    ...derived,
  }, { digestRequired: false });
}

/** 创建绑定 exact group/packet 的 target one-shot envelope。 */
export function createTargetDeliveryEnvelopeRecord(value = {}) {
  return createDeliveryEnvelopeRecord(value, {
    artifactKind: WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND,
    createFields: TARGET_DELIVERY_ENVELOPE_CREATE_FIELDS,
  });
}

/** 创建只携带 result/review 摘要的 Controller-return envelope。 */
export function createControllerReturnEnvelopeRecord(value = {}) {
  return createDeliveryEnvelopeRecord(value, {
    artifactKind: WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND,
    createFields: CONTROLLER_RETURN_ENVELOPE_CREATE_FIELDS,
  });
}

/** 按 artifactKind 分支验证 envelope closed shape、自摘要与派生 ref。 */
export function validateDeliveryEnvelopeRecord(value) {
  return normalizeDeliveryEnvelopeRecord(value, { digestRequired: true });
}

export function deliveryEnvelopeDigest(value) {
  return validateDeliveryEnvelopeRecord(value).envelopeDigest;
}

export function deliveryEnvelopeCanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(validateDeliveryEnvelopeRecord(value))}\n`, "utf8");
}

export function deliveryEnvelopeRef(value = {}) {
  assertExactKeys(value, ["demandId", "deliveryId"], "$input");
  const demandId = assertTypedId(field(value, "demandId"), "demand", "$input/demandId");
  const deliveryId = assertTypedId(
    field(value, "deliveryId"),
    "delivery",
    "$input/deliveryId",
  );
  return `.wakeflow-local/runtime/shared/transport/demands/${demandId}`
    + `/envelopes/${deliveryId}.json`;
}

function assertEnvelopeKind(envelope, expectedKind, errorPath) {
  if (envelope.artifactKind !== expectedKind) {
    fail(
      "wakeflow-transport-artifact-kind",
      errorPath,
      `delivery envelope must use artifactKind ${expectedKind}`,
    );
  }
}

/** 证明 target envelope 与 group、packet 的程序/需求/成员/prompt lineage 完全一致。 */
export function validateTargetDeliveryEnvelopeAgainstSources(value = {}) {
  assertExactKeys(value, ["envelope", "group", "packet"], "$input");
  const envelope = validateDeliveryEnvelopeRecord(field(value, "envelope"));
  assertEnvelopeKind(
    envelope,
    WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND,
    "$input/envelope/artifactKind",
  );
  const group = validateDispatchGroupRecord(field(value, "group"));
  const packet = validateDispatchPacketAgainstGroup({
    packet: field(value, "packet"),
    group,
  });
  const mismatches = [];
  for (const [key, expected] of [
    ["programId", group.programId],
    ["demandId", group.demandId],
    ["groupId", group.groupId],
    ["groupRef", dispatchGroupRef({ demandId: group.demandId, groupId: group.groupId })],
    ["groupDigest", group.groupDigest],
    ["packetId", packet.packetId],
    ["packetRef", dispatchPacketRef({ demandId: packet.demandId, packetId: packet.packetId })],
    ["packetDigest", packet.packetDigest],
    ["windowId", packet.windowId],
    ["prompt", packet.prompt],
  ]) {
    if (envelope[key] !== expected) mismatches.push(key);
  }
  if (envelope.programId !== packet.programId && !mismatches.includes("programId")) {
    mismatches.push("programId");
  }
  if (envelope.demandId !== packet.demandId && !mismatches.includes("demandId")) {
    mismatches.push("demandId");
  }
  if (mismatches.length > 0) {
    fail(
      "wakeflow-transport-envelope-source",
      "$input/envelope",
      `target delivery envelope does not match its exact sources: ${mismatches.join(", ")}`,
      { mismatches },
    );
  }
  return envelope;
}

/** 证明 Controller-return envelope 指向 group 的 Controller window 与精确 group 摘要。 */
export function validateControllerReturnEnvelopeAgainstGroup(value = {}) {
  assertExactKeys(value, ["envelope", "group"], "$input");
  const envelope = validateDeliveryEnvelopeRecord(field(value, "envelope"));
  assertEnvelopeKind(
    envelope,
    WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND,
    "$input/envelope/artifactKind",
  );
  const group = validateDispatchGroupRecord(field(value, "group"));
  const mismatches = [];
  for (const [key, expected] of [
    ["programId", group.programId],
    ["demandId", group.demandId],
    ["groupId", group.groupId],
    ["groupRef", dispatchGroupRef({ demandId: group.demandId, groupId: group.groupId })],
    ["groupDigest", group.groupDigest],
    ["windowId", group.controllerWindowId],
  ]) {
    if (envelope[key] !== expected) mismatches.push(key);
  }
  if (mismatches.length > 0) {
    fail(
      "wakeflow-transport-envelope-source",
      "$input/envelope",
      `controller return envelope does not match its dispatch group: ${mismatches.join(", ")}`,
      { mismatches },
    );
  }
  return envelope;
}

function normalizeDeliveryRunReadbackEvidence(value, errorPath) {
  assertExactKeys(value, ["kind", "digest"], errorPath);
  return {
    kind: assertHostFactToken(
      field(value, "kind"),
      `${errorPath}/kind`,
      "readback evidence kind",
    ),
    digest: assertDigest(field(value, "digest"), `${errorPath}/digest`),
  };
}

// —— DeliveryRun codec ——

// readback 是有界观察事实，不覆盖 accepted/ambiguous/rejected-before-send transport 事实。
function normalizeDeliveryRunReadback(value, errorPath) {
  assertExactKeys(value, ["status", "attempts", "evidence"], errorPath);
  const status = assertEnum(
    field(value, "status"),
    DELIVERY_RUN_READBACK_STATUSES,
    `${errorPath}/status`,
    "delivery run readback status",
  );
  const attempts = assertInteger(
    field(value, "attempts"),
    `${errorPath}/attempts`,
    { minimum: 0, maximum: 1 },
  );
  const evidence = normalizeArray(
    field(value, "evidence"),
    `${errorPath}/evidence`,
    normalizeDeliveryRunReadbackEvidence,
  );
  if (evidence.length > 1) {
    fail(
      "wakeflow-transport-readback",
      `${errorPath}/evidence`,
      "delivery run permits at most one readback observation",
    );
  }
  if (evidence.length !== attempts) {
    fail(
      "wakeflow-transport-readback",
      errorPath,
      "delivery run readback attempts must equal its digest-only observation count",
    );
  }
  if (status !== "unavailable" && (attempts !== 1 || evidence.length !== 1)) {
    fail(
      "wakeflow-transport-readback",
      errorPath,
      `${status} readback must preserve its one digest-only observation`,
    );
  }
  return { status, attempts, evidence };
}

function normalizePreviousDeliveryRun(value, errorPath, { demandId, runId }) {
  assertExactKeys(value, ["runId", "ref", "digest"], errorPath);
  const previousRunId = assertTypedId(
    field(value, "runId"),
    "delivery-run",
    `${errorPath}/runId`,
  );
  if (previousRunId === runId) {
    fail(
      "wakeflow-transport-run-lineage",
      `${errorPath}/runId`,
      "delivery run cannot name itself as its previous attempt",
    );
  }
  const expectedRef = deliveryRunRef({ demandId, runId: previousRunId });
  if (field(value, "ref") !== expectedRef) {
    fail(
      "wakeflow-transport-ref",
      `${errorPath}/ref`,
      `previous delivery run ref must be ${expectedRef}`,
    );
  }
  return {
    runId: previousRunId,
    ref: expectedRef,
    digest: assertDigest(field(value, "digest"), `${errorPath}/digest`),
  };
}

function normalizeObservedLease(value, errorPath, { windowId }) {
  assertExactKeys(value, ["leaseId", "leaseRef", "leaseDigest"], errorPath);
  const expectedRef = windowCoordinationLeaseRef({ windowId });
  if (field(value, "leaseRef") !== expectedRef) {
    fail(
      "wakeflow-transport-ref",
      `${errorPath}/leaseRef`,
      `observed lease ref must be ${expectedRef}`,
    );
  }
  return {
    leaseId: assertLeaseId(field(value, "leaseId"), `${errorPath}/leaseId`),
    leaseRef: expectedRef,
    leaseDigest: assertDigest(field(value, "leaseDigest"), `${errorPath}/leaseDigest`),
  };
}

function normalizeDeliveryRunError(value, errorPath) {
  assertExactKeys(value, ["code", "message"], errorPath);
  return {
    code: assertHostFactToken(field(value, "code"), `${errorPath}/code`, "host error code"),
    message: assertHumanText(field(value, "message"), `${errorPath}/message`),
  };
}

// run 只描述一次宿主 attempt；previousRun 与 observedLease 都保存 immutable tuple 而非 current authority。
function normalizeDeliveryRunRecord(value, { digestRequired }) {
  assertClosedKeys(
    value,
    digestRequired ? DELIVERY_RUN_RECORD_FIELDS : DELIVERY_RUN_UNSIGNED_FIELDS,
    DELIVERY_RUN_OPTIONAL_FIELDS,
    "$",
  );
  if (field(value, "schemaVersion") !== WAKEFLOW_TRANSPORT_SCHEMA_VERSION) {
    fail(
      "wakeflow-transport-schema-version",
      "$/schemaVersion",
      `delivery run schemaVersion must be ${WAKEFLOW_TRANSPORT_SCHEMA_VERSION}`,
    );
  }
  if (field(value, "artifactKind") !== WAKEFLOW_DIRECT_THREAD_DELIVERY_RUN_KIND) {
    fail(
      "wakeflow-transport-artifact-kind",
      "$/artifactKind",
      `delivery run artifactKind must be ${WAKEFLOW_DIRECT_THREAD_DELIVERY_RUN_KIND}`,
    );
  }

  const programId = assertTypedId(field(value, "programId"), "program", "$/programId");
  const demandId = assertTypedId(field(value, "demandId"), "demand", "$/demandId");
  const runId = assertTypedId(field(value, "runId"), "delivery-run", "$/runId");
  const deliveryId = assertTypedId(field(value, "deliveryId"), "delivery", "$/deliveryId");
  const expectedEnvelopeRef = deliveryEnvelopeRef({ demandId, deliveryId });
  if (field(value, "envelopeRef") !== expectedEnvelopeRef) {
    fail(
      "wakeflow-transport-ref",
      "$/envelopeRef",
      `delivery run envelopeRef must be ${expectedEnvelopeRef}`,
    );
  }
  const hostId = assertProtocolHostId(field(value, "hostId"), "$/hostId");
  const windowId = assertTypedId(field(value, "windowId"), "window", "$/windowId");
  const attemptOrdinal = assertInteger(
    field(value, "attemptOrdinal"),
    "$/attemptOrdinal",
    { minimum: 1 },
  );
  const hasPreviousRun = Object.hasOwn(value, "previousRun");
  if (attemptOrdinal === 1 && hasPreviousRun) {
    fail(
      "wakeflow-transport-run-lineage",
      "$/previousRun",
      "initial delivery attempt must not name a previous run",
    );
  }
  if (attemptOrdinal > 1 && !hasPreviousRun) {
    fail(
      "wakeflow-transport-run-lineage",
      "$/previousRun",
      "non-initial delivery attempt requires one previous run tuple",
    );
  }

  const transportStatus = assertEnum(
    field(value, "transportStatus"),
    DELIVERY_RUN_TRANSPORT_STATUSES,
    "$/transportStatus",
    "delivery run transport status",
  );
  const readback = normalizeDeliveryRunReadback(field(value, "readback"), "$/readback");
  const hasError = Object.hasOwn(value, "error");
  if (transportStatus !== "accepted" && !hasError) {
    fail(
      "wakeflow-transport-run-error",
      "$/error",
      `${transportStatus} delivery attempt requires one closed host error fact`,
    );
  }
  if (
    transportStatus === "rejected-before-send"
    && (
      readback.status !== "unavailable"
      || readback.attempts !== 0
      || readback.evidence.length !== 0
    )
  ) {
    fail(
      "wakeflow-transport-readback",
      "$/readback/status",
      "a send rejected before transport cannot claim a readback observation",
    );
  }

  const unsigned = {
    schemaVersion: WAKEFLOW_TRANSPORT_SCHEMA_VERSION,
    artifactKind: WAKEFLOW_DIRECT_THREAD_DELIVERY_RUN_KIND,
    programId,
    demandId,
    runId,
    deliveryId,
    envelopeRef: expectedEnvelopeRef,
    envelopeDigest: assertDigest(field(value, "envelopeDigest"), "$/envelopeDigest"),
    hostId,
    windowId,
    attemptOrdinal,
    ...(hasPreviousRun ? {
      previousRun: normalizePreviousDeliveryRun(field(value, "previousRun"), "$/previousRun", {
        demandId,
        runId,
      }),
    } : {}),
    hostMethod: assertHostFactToken(
      field(value, "hostMethod"),
      "$/hostMethod",
      "host method",
    ),
    hostMode: assertHostFactToken(field(value, "hostMode"), "$/hostMode", "host mode"),
    transportStatus,
    readback,
    ...(Object.hasOwn(value, "observedLease") ? {
      observedLease: normalizeObservedLease(
        field(value, "observedLease"),
        "$/observedLease",
        { windowId },
      ),
    } : {}),
    ...(hasError ? { error: normalizeDeliveryRunError(field(value, "error"), "$/error") } : {}),
    createdAt: assertTimestamp(field(value, "createdAt"), "$/createdAt"),
  };
  const expectedDigest = canonicalJsonDigest(unsigned);
  if (digestRequired) {
    const actualDigest = assertDigest(field(value, "runDigest"), "$/runDigest");
    if (actualDigest !== expectedDigest) {
      fail(
        "wakeflow-transport-digest",
        "$/runDigest",
        "runDigest must cover the complete canonical delivery run excluding itself",
      );
    }
  }
  return deepFreeze({ ...unsigned, runDigest: expectedDigest });
}

/** 创建一次宿主发送 attempt 的 immutable run record。 */
export function createDeliveryRunRecord(value = {}) {
  assertClosedKeys(value, DELIVERY_RUN_CREATE_FIELDS, DELIVERY_RUN_OPTIONAL_FIELDS, "$input");
  const normalizedInput = Object.fromEntries(
    DELIVERY_RUN_CREATE_FIELDS.map((key) => [key, field(value, key)]),
  );
  for (const key of DELIVERY_RUN_OPTIONAL_FIELDS) {
    if (Object.hasOwn(value, key)) normalizedInput[key] = field(value, key);
  }
  const demandId = assertTypedId(normalizedInput.demandId, "demand", "$input/demandId");
  const deliveryId = assertTypedId(normalizedInput.deliveryId, "delivery", "$input/deliveryId");
  return normalizeDeliveryRunRecord({
    schemaVersion: WAKEFLOW_TRANSPORT_SCHEMA_VERSION,
    artifactKind: WAKEFLOW_DIRECT_THREAD_DELIVERY_RUN_KIND,
    ...normalizedInput,
    envelopeRef: deliveryEnvelopeRef({ demandId, deliveryId }),
  }, { digestRequired: false });
}

/** 验证单个 run 的 closed facts、自摘要及 ordinal/previous tuple 形态。 */
export function validateDeliveryRunRecord(value) {
  return normalizeDeliveryRunRecord(value, { digestRequired: true });
}

export function deliveryRunDigest(value) {
  return validateDeliveryRunRecord(value).runDigest;
}

export function deliveryRunCanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(validateDeliveryRunRecord(value))}\n`, "utf8");
}

export function deliveryRunRef(value = {}) {
  assertExactKeys(value, ["demandId", "runId"], "$input");
  const demandId = assertTypedId(field(value, "demandId"), "demand", "$input/demandId");
  const runId = assertTypedId(field(value, "runId"), "delivery-run", "$input/runId");
  return `.wakeflow-local/runtime/shared/transport/demands/${demandId}`
    + `/runs/${runId}.json`;
}

function deliveryRunLineageMismatches(run, previousRun) {
  const mismatches = [];
  const expectedTuple = {
    runId: previousRun.runId,
    ref: deliveryRunRef({ demandId: previousRun.demandId, runId: previousRun.runId }),
    digest: previousRun.runDigest,
  };
  for (const [key, expected] of Object.entries(expectedTuple)) {
    if (run.previousRun?.[key] !== expected) mismatches.push(`previousRun.${key}`);
  }
  for (const key of [
    "programId",
    "demandId",
    "deliveryId",
    "envelopeRef",
    "envelopeDigest",
    "hostId",
    "windowId",
  ]) {
    if (run[key] !== previousRun[key]) mismatches.push(key);
  }
  if (run.attemptOrdinal !== previousRun.attemptOrdinal + 1) {
    mismatches.push("attemptOrdinal");
  }
  if (
    timestampInstantNanoseconds(run.createdAt)
    <= timestampInstantNanoseconds(previousRun.createdAt)
  ) {
    mismatches.push("createdAt");
  }
  return mismatches;
}

/**
 * 将 run 与 exact envelope、可选 previous run、可选 record-time lease 交叉闭合。
 * 历史 target run 可在 lease 后续释放后只保留 observed tuple；Controller-return 禁止声称该 tuple。
 */
export function validateDeliveryRunAgainstSources(value = {}) {
  assertClosedKeys(value, ["run", "envelope"], ["previousRun", "lease"], "$input");
  const run = validateDeliveryRunRecord(field(value, "run"));
  const envelope = validateDeliveryEnvelopeRecord(field(value, "envelope"));
  const mismatches = [];
  for (const [key, expected] of [
    ["programId", envelope.programId],
    ["demandId", envelope.demandId],
    ["deliveryId", envelope.deliveryId],
    ["envelopeRef", deliveryEnvelopeRef({
      demandId: envelope.demandId,
      deliveryId: envelope.deliveryId,
    })],
    ["envelopeDigest", envelope.envelopeDigest],
    ["hostId", envelope.preparedByHostId],
    ["windowId", envelope.windowId],
  ]) {
    if (run[key] !== expected) mismatches.push(key);
  }
  if (mismatches.length > 0) {
    fail(
      "wakeflow-transport-run-source",
      "$input/run",
      `delivery run does not match its exact envelope: ${mismatches.join(", ")}`,
      { mismatches },
    );
  }

  const hasPreviousTuple = Object.hasOwn(run, "previousRun");
  const hasPreviousSource = Object.hasOwn(value, "previousRun");
  if (hasPreviousTuple !== hasPreviousSource) {
    fail(
      "wakeflow-transport-run-lineage",
      "$input/previousRun",
      "delivery run lineage tuple and previous immutable source must be provided together",
    );
  }
  if (hasPreviousSource) {
    const previousRun = validateDeliveryRunRecord(field(value, "previousRun"));
    const lineageMismatches = deliveryRunLineageMismatches(run, previousRun);
    if (lineageMismatches.length > 0) {
      fail(
        "wakeflow-transport-run-lineage",
        "$input/previousRun",
        `delivery run lineage is not continuous: ${lineageMismatches.join(", ")}`,
        { mismatches: lineageMismatches },
      );
    }
  }

  const hasObservedLease = Object.hasOwn(run, "observedLease");
  const hasLeaseSource = Object.hasOwn(value, "lease");
  if (
    hasObservedLease
    && envelope.artifactKind !== WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND
  ) {
    fail(
      "wakeflow-transport-run-lease",
      "$input/run/observedLease",
      "controller-return delivery runs cannot claim a target-work coordination lease",
    );
  }
  if (hasLeaseSource && !hasObservedLease) {
    fail(
      "wakeflow-transport-run-lease",
      "$input/lease",
      "a supplied record-time lease source requires its observed tuple in the delivery run",
    );
  }
  if (hasLeaseSource) {
    const lease = validateWindowCoordinationLeaseRecord(field(value, "lease"));
    const leaseMismatches = [];
    for (const [key, expected] of [
      ["leaseId", lease.leaseId],
      ["leaseRef", windowCoordinationLeaseRef({ windowId: lease.windowId })],
      ["leaseDigest", lease.leaseDigest],
    ]) {
      if (run.observedLease[key] !== expected) {
        leaseMismatches.push(`observedLease.${key}`);
      }
    }
    for (const [leaseKey, expected] of [
      ["programId", envelope.programId],
      ["hostId", envelope.preparedByHostId],
      ["windowId", envelope.windowId],
      ["demandId", envelope.demandId],
      ["groupId", envelope.groupId],
      ["groupRef", envelope.groupRef],
      ["groupDigest", envelope.groupDigest],
      ["deliveryId", envelope.deliveryId],
      ["envelopeRef", run.envelopeRef],
      ["envelopeDigest", envelope.envelopeDigest],
      ["identityRef", envelope.identityRef],
      ["bindingId", envelope.bindingId],
      ["identityBindingDigest", envelope.identityBindingDigest],
    ]) {
      if (lease[leaseKey] !== expected) leaseMismatches.push(`lease.${leaseKey}`);
    }
    const runInstant = timestampInstantNanoseconds(run.createdAt);
    if (
      runInstant < timestampInstantNanoseconds(lease.acquiredAt)
      || runInstant >= timestampInstantNanoseconds(lease.expiresAt)
    ) {
      leaseMismatches.push("createdAt");
    }
    if (leaseMismatches.length > 0) {
      fail(
        "wakeflow-transport-run-lease",
        "$input/lease",
        `delivery run does not close over its record-time lease: ${leaseMismatches.join(", ")}`,
        { mismatches: leaseMismatches },
      );
    }
  }
  return run;
}

/** 验证同一 envelope 的 run 集合无 gap、fork、重复 ordinal，返回按 attempt 排序的冻结链。 */
export function validateDeliveryRunChain(value = {}) {
  assertExactKeys(value, ["runs"], "$input");
  const runs = normalizeArray(field(value, "runs"), "$input/runs", validateDeliveryRunRecord);
  if (runs.length === 0) return deepFreeze([]);

  const seenRunIds = new Set();
  for (const run of runs) {
    if (seenRunIds.has(run.runId)) {
      fail(
        "wakeflow-transport-run-lineage",
        "$input/runs",
        `delivery run chain contains duplicate run ${run.runId}`,
      );
    }
    seenRunIds.add(run.runId);
  }
  const ordered = [...runs].sort((left, right) => {
    const ordinalOrder = left.attemptOrdinal - right.attemptOrdinal;
    if (ordinalOrder !== 0) return ordinalOrder;
    return left.runId < right.runId ? -1 : 1;
  });
  const first = ordered[0];
  for (let index = 0; index < ordered.length; index += 1) {
    const run = ordered[index];
    if (run.attemptOrdinal !== index + 1) {
      fail(
        "wakeflow-transport-run-lineage",
        `$input/runs/${index}/attemptOrdinal`,
        "delivery run chain must contain one contiguous attempt ordinal sequence from 1",
      );
    }
    for (const key of [
      "programId",
      "demandId",
      "deliveryId",
      "envelopeRef",
      "envelopeDigest",
      "hostId",
      "windowId",
    ]) {
      if (run[key] !== first[key]) {
        fail(
          "wakeflow-transport-run-lineage",
          `$input/runs/${index}/${key}`,
          `delivery run chain must retain one exact ${key}`,
        );
      }
    }
    if (index === 0) {
      if (Object.hasOwn(run, "previousRun")) {
        fail(
          "wakeflow-transport-run-lineage",
          "$input/runs/0/previousRun",
          "initial delivery run must be the root of its chain",
        );
      }
      continue;
    }
    const lineageMismatches = deliveryRunLineageMismatches(run, ordered[index - 1]);
    if (lineageMismatches.length > 0) {
      fail(
        "wakeflow-transport-run-lineage",
        `$input/runs/${index}`,
        `delivery run chain is forked or discontinuous: ${lineageMismatches.join(", ")}`,
        { mismatches: lineageMismatches },
      );
    }
  }
  return deepFreeze(ordered);
}
