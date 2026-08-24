// 本模块是shared window coordination lease的纯portable codec。
// lease把一次target delivery绑定到稳定窗口、当前binding、transport group/envelope与可选main checkout claim；
// 它不表示宿主进程活跃，不拥有发送结果，也不允许仅凭expiresAt自动删除或转移占用。
import { randomUUID } from "node:crypto";
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

export const WAKEFLOW_WINDOW_COORDINATION_LEASE_KIND = "wakeflow-window-coordination-lease";
export const WAKEFLOW_WINDOW_COORDINATION_LEASE_SCHEMA_VERSION = 1;

const REQUIRED_RECORD_FIELDS = Object.freeze([
  "kind",
  "schemaVersion",
  "programId",
  "hostId",
  "windowId",
  "leaseId",
  "demandId",
  "targetTaskId",
  "groupId",
  "groupRef",
  "groupDigest",
  "deliveryId",
  "envelopeRef",
  "envelopeDigest",
  "identityRef",
  "bindingId",
  "identityBindingDigest",
  "acquiredAt",
  "expiresAt",
  "leaseDigest",
]);
const UNSIGNED_RECORD_FIELDS = Object.freeze(REQUIRED_RECORD_FIELDS.slice(0, -1));
const CLAIM_FIELDS = Object.freeze(["repositoryId", "checkoutResourceKey"]);
const CREATE_FIELDS = Object.freeze([
  "programId",
  "hostId",
  "windowId",
  "leaseId",
  "demandId",
  "targetTaskId",
  "groupId",
  "groupDigest",
  "deliveryId",
  "envelopeDigest",
  "bindingId",
  "identityBindingDigest",
  "acquiredAt",
  "expiresAt",
]);
const EXPECTATION_FIELDS = Object.freeze([
  "expectedProgramId",
  "expectedHostId",
  "expectedWindowId",
]);
const OWNER_FIELDS = Object.freeze([
  "programId",
  "hostId",
  "windowId",
  "demandId",
  "targetTaskId",
  "groupId",
  "groupRef",
  "groupDigest",
  "deliveryId",
  "envelopeRef",
  "envelopeDigest",
  "identityRef",
  "bindingId",
  "identityBindingDigest",
  "repositoryId",
  "checkoutResourceKey",
]);
const PROTOCOL_HOST_IDS = new Set(WAKEFLOW_PROTOCOL_HOST_IDS);
const LEASE_ID_RE = /^lease_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TRANSPORT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;

// 错误路径只定位portable合同字段，不回显宿主handle或本地绝对路径。
export class WakeflowWindowCoordinationLeaseRecordError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowWindowCoordinationLeaseRecordError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, errorPath, message, details = {}, cause = undefined) {
  throw new WakeflowWindowCoordinationLeaseRecordError(
    code,
    `${message} at ${errorPath}`,
    { path: errorPath, details, cause },
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertPlainObject(value, errorPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-window-lease-type", errorPath, "window lease value must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-window-lease-type", errorPath, "window lease value must be a plain object");
  }
  return value;
}

// codec在取值前先关闭own-key与descriptor集合，拒绝getter、hidden、Symbol及未知字段。
function ownDataKeys(value, errorPath) {
  const keys = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      fail(
        "wakeflow-window-lease-unknown-field",
        errorPath,
        "window lease objects cannot contain symbol fields",
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-window-lease-field",
        `${errorPath}/${key}`,
        `window lease field ${key} must be one enumerable data property`,
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
        "wakeflow-window-lease-unknown-field",
        `${errorPath}/${key}`,
        `unknown window lease field ${key}`,
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail(
        "wakeflow-window-lease-required-field",
        `${errorPath}/${key}`,
        `missing required window lease field ${key}`,
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
      "wakeflow-window-lease-identifier",
      errorPath,
      `window lease requires one typed ${type} identifier`,
      {},
      cause,
    );
  }
}

function assertProtocolHostId(value, errorPath) {
  if (typeof value !== "string" || !PROTOCOL_HOST_IDS.has(value)) {
    fail(
      "wakeflow-window-lease-host",
      errorPath,
      "window lease hostId must be a Wakeflow protocol host",
      { allowedHostIds: WAKEFLOW_PROTOCOL_HOST_IDS },
    );
  }
  return value;
}

/** 校验与业务标题无关的随机lease代际ID。 */
export function assertWindowCoordinationLeaseId(value, errorPath = "$") {
  if (typeof value !== "string" || !LEASE_ID_RE.test(value)) {
    fail(
      "wakeflow-window-lease-identifier",
      errorPath,
      "window lease identifier must match lease_<lowercase UUID v4>",
      { valueType: typeof value },
    );
  }
  return value;
}

/** 生成候选lease ID；当前inventory中的唯一性由service另行确认。 */
export function generateWindowCoordinationLeaseId(uuidFactory = randomUUID) {
  if (typeof uuidFactory !== "function") {
    fail(
      "wakeflow-window-lease-identifier-generator",
      "$uuidFactory",
      "window lease UUID source must be a function",
    );
  }
  let uuid;
  try {
    uuid = uuidFactory();
  } catch (cause) {
    fail(
      "wakeflow-window-lease-identifier-generator",
      "$uuidFactory",
      "window lease UUID source failed",
      {},
      cause,
    );
  }
  if (typeof uuid !== "string") {
    fail(
      "wakeflow-window-lease-identifier-generator",
      "$uuidFactory",
      "window lease UUID source must return one lowercase UUID v4 string",
      { valueType: typeof uuid },
    );
  }
  return assertWindowCoordinationLeaseId(`lease_${uuid}`, "$generatedLeaseId");
}

// transport ID仍由transport领域生成；此处只约束可携带ref所需的词法边界。
function assertTransportId(value, errorPath, label) {
  if (typeof value !== "string" || !TRANSPORT_ID_RE.test(value)) {
    fail(
      "wakeflow-window-lease-transport-identifier",
      errorPath,
      `${label} must be one bounded portable transport identifier`,
      { valueType: typeof value },
    );
  }
  return value;
}

function assertDigest(value, errorPath, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail(
      "wakeflow-window-lease-digest",
      errorPath,
      `${label} must be one sha256 digest`,
    );
  }
  return value;
}

// 时间只固定acquired<expires关系；过期后的处置仍需要service的exact release/recovery authority。
function assertTimestamp(value, errorPath) {
  const match = typeof value === "string" ? value.match(TIMESTAMP_RE) : null;
  if (!match) {
    fail(
      "wakeflow-window-lease-timestamp",
      errorPath,
      "window lease timestamp must be an explicit strict UTC RFC3339 value",
    );
  }
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
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
      "wakeflow-window-lease-timestamp",
      errorPath,
      "window lease timestamp must name a real UTC calendar instant",
    );
  }
  return Object.freeze({
    value,
    instantNanoseconds: BigInt(parsed.getTime()) * 1_000_000n
      + BigInt(fraction.padEnd(9, "0") || "0"),
  });
}

function transportRef(demandId, collection, transportId) {
  return `.wakeflow-local/runtime/shared/transport/demands/${demandId}`
    + `/${collection}/${transportId}.json`;
}

// Product main checkout claim必须由repositoryId唯一派生；Test等无仓库窗口不得伪造claim。
function normalizeRepositoryClaim(value, errorPath = "$") {
  const hasRepositoryId = Object.hasOwn(value, "repositoryId");
  const hasCheckoutResourceKey = Object.hasOwn(value, "checkoutResourceKey");
  if (hasRepositoryId !== hasCheckoutResourceKey) {
    fail(
      "wakeflow-window-lease-checkout-claim",
      `${errorPath}/checkoutResourceKey`,
      "repositoryId and checkoutResourceKey must either both be present or both be absent",
    );
  }
  if (!hasRepositoryId) return Object.freeze({});
  const repositoryId = field(value, "repositoryId");
  const checkoutResourceKey = field(value, "checkoutResourceKey");
  const normalizedRepositoryId = assertTypedId(repositoryId, "repository", "$/repositoryId");
  const expectedKey = `main:${normalizedRepositoryId}`;
  if (checkoutResourceKey !== expectedKey) {
    fail(
      "wakeflow-window-lease-checkout-claim",
      "$/checkoutResourceKey",
      "main checkout claim must be derived exactly from repositoryId",
    );
  }
  return Object.freeze({
    repositoryId: normalizedRepositoryId,
    checkoutResourceKey: expectedKey,
  });
}

function normalizeExpectations(value) {
  assertExactKeys(value, [], EXPECTATION_FIELDS, "$expectations");
  return Object.freeze({
    ...(Object.hasOwn(value, "expectedProgramId")
      ? { expectedProgramId: assertTypedId(field(value, "expectedProgramId"), "program", "$expectations/expectedProgramId") }
      : {}),
    ...(Object.hasOwn(value, "expectedHostId")
      ? { expectedHostId: assertProtocolHostId(field(value, "expectedHostId"), "$expectations/expectedHostId") }
      : {}),
    ...(Object.hasOwn(value, "expectedWindowId")
      ? { expectedWindowId: assertTypedId(field(value, "expectedWindowId"), "window", "$expectations/expectedWindowId") }
      : {}),
  });
}

function assertExpectations(record, expectations) {
  for (const [expectation, key] of [
    ["expectedProgramId", "programId"],
    ["expectedHostId", "hostId"],
    ["expectedWindowId", "windowId"],
  ]) {
    if (Object.hasOwn(expectations, expectation) && expectations[expectation] !== record[key]) {
      fail(
        "wakeflow-window-lease-identity-mismatch",
        `$/${key}`,
        `window lease ${key} does not match expected authority`,
      );
    }
  }
}

// unsigned字段共同形成leaseDigest，derived refs和checkout claim也纳入交叉闭包。
function normalizeRecord(value, { leaseDigestRequired }) {
  assertExactKeys(
    value,
    leaseDigestRequired ? REQUIRED_RECORD_FIELDS : UNSIGNED_RECORD_FIELDS,
    CLAIM_FIELDS,
    "$",
  );
  if (field(value, "kind") !== WAKEFLOW_WINDOW_COORDINATION_LEASE_KIND) {
    fail(
      "wakeflow-window-lease-kind",
      "$/kind",
      `window lease kind must be ${WAKEFLOW_WINDOW_COORDINATION_LEASE_KIND}`,
    );
  }
  if (field(value, "schemaVersion") !== WAKEFLOW_WINDOW_COORDINATION_LEASE_SCHEMA_VERSION) {
    fail(
      "wakeflow-window-lease-schema-version",
      "$/schemaVersion",
      `window lease schemaVersion must be ${WAKEFLOW_WINDOW_COORDINATION_LEASE_SCHEMA_VERSION}`,
    );
  }

  const programId = assertTypedId(field(value, "programId"), "program", "$/programId");
  const hostId = assertProtocolHostId(field(value, "hostId"), "$/hostId");
  const windowId = assertTypedId(field(value, "windowId"), "window", "$/windowId");
  const demandId = assertTypedId(field(value, "demandId"), "demand", "$/demandId");
  const groupId = assertTransportId(field(value, "groupId"), "$/groupId", "groupId");
  const deliveryId = assertTransportId(
    field(value, "deliveryId"),
    "$/deliveryId",
    "deliveryId",
  );
  const expectedGroupRef = transportRef(demandId, "groups", groupId);
  const expectedEnvelopeRef = transportRef(demandId, "envelopes", deliveryId);
  const expectedIdentityRef = windowBindingRef({ hostDirName: hostId, windowId });
  for (const [key, expected] of [
    ["groupRef", expectedGroupRef],
    ["envelopeRef", expectedEnvelopeRef],
    ["identityRef", expectedIdentityRef],
  ]) {
    if (field(value, key) !== expected) {
      fail(
        "wakeflow-window-lease-ref",
        `$/${key}`,
        `window lease ${key} must be the canonical ref derived from its stable identifiers`,
      );
    }
  }
  const claim = normalizeRepositoryClaim(value);
  const acquiredAt = assertTimestamp(field(value, "acquiredAt"), "$/acquiredAt");
  const expiresAt = assertTimestamp(field(value, "expiresAt"), "$/expiresAt");
  if (expiresAt.instantNanoseconds <= acquiredAt.instantNanoseconds) {
    fail(
      "wakeflow-window-lease-timestamp-order",
      "$/expiresAt",
      "window lease expiresAt must be later than acquiredAt",
    );
  }

  const unsigned = {
    kind: WAKEFLOW_WINDOW_COORDINATION_LEASE_KIND,
    schemaVersion: WAKEFLOW_WINDOW_COORDINATION_LEASE_SCHEMA_VERSION,
    programId,
    hostId,
    windowId,
    leaseId: assertWindowCoordinationLeaseId(field(value, "leaseId"), "$/leaseId"),
    demandId,
    targetTaskId: assertTypedId(
      field(value, "targetTaskId"),
      "target-task",
      "$/targetTaskId",
    ),
    groupId,
    groupRef: expectedGroupRef,
    groupDigest: assertDigest(field(value, "groupDigest"), "$/groupDigest", "groupDigest"),
    deliveryId,
    envelopeRef: expectedEnvelopeRef,
    envelopeDigest: assertDigest(
      field(value, "envelopeDigest"),
      "$/envelopeDigest",
      "envelopeDigest",
    ),
    identityRef: expectedIdentityRef,
    bindingId: (() => {
      try {
        return assertWindowBindingId(field(value, "bindingId"), "$/bindingId");
      } catch (cause) {
        fail(
          "wakeflow-window-lease-identifier",
          "$/bindingId",
          "window lease requires one typed binding identifier",
          {},
          cause,
        );
      }
    })(),
    identityBindingDigest: assertDigest(
      field(value, "identityBindingDigest"),
      "$/identityBindingDigest",
      "identityBindingDigest",
    ),
    ...claim,
    acquiredAt: acquiredAt.value,
    expiresAt: expiresAt.value,
  };
  const expectedLeaseDigest = canonicalJsonDigest(unsigned);
  if (leaseDigestRequired) {
    const actual = assertDigest(field(value, "leaseDigest"), "$/leaseDigest", "leaseDigest");
    if (actual !== expectedLeaseDigest) {
      fail(
        "wakeflow-window-lease-digest",
        "$/leaseDigest",
        "leaseDigest must cover the canonical window lease excluding itself",
      );
    }
  }
  return deepFreeze({ ...unsigned, leaseDigest: expectedLeaseDigest });
}

/** 从owner输入派生全部portable refs和self-digest，返回深冻结lease记录。 */
export function createWindowCoordinationLeaseRecord(value = {}) {
  assertExactKeys(value, CREATE_FIELDS, CLAIM_FIELDS, "$input");
  const programId = assertTypedId(field(value, "programId"), "program", "$input/programId");
  const hostId = assertProtocolHostId(field(value, "hostId"), "$input/hostId");
  const windowId = assertTypedId(field(value, "windowId"), "window", "$input/windowId");
  const leaseId = assertWindowCoordinationLeaseId(
    field(value, "leaseId"),
    "$input/leaseId",
  );
  const demandId = assertTypedId(field(value, "demandId"), "demand", "$input/demandId");
  const targetTaskId = assertTypedId(
    field(value, "targetTaskId"),
    "target-task",
    "$input/targetTaskId",
  );
  const groupId = assertTransportId(field(value, "groupId"), "$input/groupId", "groupId");
  const groupDigest = assertDigest(
    field(value, "groupDigest"),
    "$input/groupDigest",
    "groupDigest",
  );
  const deliveryId = assertTransportId(
    field(value, "deliveryId"),
    "$input/deliveryId",
    "deliveryId",
  );
  const envelopeDigest = assertDigest(
    field(value, "envelopeDigest"),
    "$input/envelopeDigest",
    "envelopeDigest",
  );
  let bindingId;
  try {
    bindingId = assertWindowBindingId(field(value, "bindingId"), "$input/bindingId");
  } catch (cause) {
    fail(
      "wakeflow-window-lease-identifier",
      "$input/bindingId",
      "window lease requires one typed binding identifier",
      {},
      cause,
    );
  }
  const identityBindingDigest = assertDigest(
    field(value, "identityBindingDigest"),
    "$input/identityBindingDigest",
    "identityBindingDigest",
  );
  const claim = normalizeRepositoryClaim(value, "$input");
  return normalizeRecord({
    kind: WAKEFLOW_WINDOW_COORDINATION_LEASE_KIND,
    schemaVersion: WAKEFLOW_WINDOW_COORDINATION_LEASE_SCHEMA_VERSION,
    programId,
    hostId,
    windowId,
    leaseId,
    demandId,
    targetTaskId,
    groupId,
    groupRef: transportRef(demandId, "groups", groupId),
    groupDigest,
    deliveryId,
    envelopeRef: transportRef(demandId, "envelopes", deliveryId),
    envelopeDigest,
    identityRef: windowBindingRef({ hostDirName: hostId, windowId }),
    bindingId,
    identityBindingDigest,
    ...claim,
    acquiredAt: field(value, "acquiredAt"),
    expiresAt: field(value, "expiresAt"),
  }, { leaseDigestRequired: false });
}

/** 校验完整持久化记录及可选program/host/window expectations。 */
export function validateWindowCoordinationLeaseRecord(value, expectations = {}) {
  const normalized = normalizeRecord(value, { leaseDigestRequired: true });
  assertExpectations(normalized, normalizeExpectations(expectations));
  return normalized;
}

/** 输出唯一持久化形式：canonical JSON加单个LF。 */
export function windowCoordinationLeaseCanonicalBytes(value) {
  const record = validateWindowCoordinationLeaseRecord(value);
  return Buffer.from(`${canonicalJson(record)}\n`, "utf8");
}

/** 返回记录自带且已重算验证的leaseDigest。 */
export function windowCoordinationLeaseDigest(value) {
  return validateWindowCoordinationLeaseRecord(value).leaseDigest;
}

// owner比较刻意忽略leaseId和时间代际，用于识别同一delivery占用的幂等acquire重放。
export function sameWindowCoordinationLeaseOwner(left, right) {
  const normalizedLeft = validateWindowCoordinationLeaseRecord(left);
  const normalizedRight = validateWindowCoordinationLeaseRecord(right);
  return OWNER_FIELDS.every((key) => (
    Object.hasOwn(normalizedLeft, key) === Object.hasOwn(normalizedRight, key)
    && normalizedLeft[key] === normalizedRight[key]
  ));
}

/** 每个稳定window最多一个shared lease，因此ref只由windowId决定。 */
export function windowCoordinationLeaseRef(value = {}) {
  assertExactKeys(value, ["windowId"], [], "$input");
  const windowId = assertTypedId(field(value, "windowId"), "window", "$input/windowId");
  const ref = `.wakeflow-local/runtime/shared/coordination/window-leases/${windowId}.json`;
  if (path.posix.isAbsolute(ref) || ref.includes("\\")) {
    fail("wakeflow-window-lease-ref", "$input/windowId", "window lease ref is not portable");
  }
  return ref;
}
