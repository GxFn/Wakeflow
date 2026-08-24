import {
  canonicalJson,
  canonicalJsonBytes,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";

// 本模块只定义T08 legacy archive wrapper可携带的portable数据合同：
// evidence fact/summary、transport summary及其canonical bytes/digest。
// 它不扫描legacy目录、不选择preservation处置，也不写BusinessArchive；这些分别由
// owner-drain、legacy-archive-transform和ledger owner负责。

export const WAKEFLOW_LEGACY_ARCHIVE_RECORD_SCHEMA_VERSION = 1;
export const WAKEFLOW_LEGACY_ARCHIVE_TRANSPORT_SUMMARY_KIND =
  "wakeflow-legacy-archive-transport-summary";
export const WAKEFLOW_LEGACY_EVIDENCE_SOURCE_KINDS = Object.freeze([
  "pod-close",
  "pod-materialization",
  "pod-test-access",
]);

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const SOURCE_KIND_SET = new Set(WAKEFLOW_LEGACY_EVIDENCE_SOURCE_KINDS);
const TEST_ACCESS_BLOCK_REASONS = new Set([
  "access-probe-failed",
  "direct-multi-root-unsupported",
  "per-repo-executor-unavailable",
]);
const TRANSPORT_SOURCE_STATUSES = new Set(["absent", "archived"]);
const COVERAGE_CONTRACTS = Object.freeze({
  "pod-close": Object.freeze({
    allowed: new Set([
      "binding-correlation",
      "close-chain",
      "host-resource-closure",
      "state-membership",
    ]),
    required: Object.freeze([
      "binding-correlation",
      "close-chain",
      "state-membership",
    ]),
  }),
  "pod-materialization": Object.freeze({
    allowed: new Set([
      "binding-correlation",
      "launch-chain",
      "state-membership",
    ]),
    required: Object.freeze([
      "binding-correlation",
      "launch-chain",
      "state-membership",
    ]),
  }),
  "pod-test-access": Object.freeze({
    allowed: new Set([
      "binding-correlation",
      "close-chain",
      "observed-time",
      "plan-receipt-pair",
      "recorded-time",
      "state-membership",
    ]),
    required: Object.freeze([
      "binding-correlation",
      "close-chain",
      "observed-time",
      "plan-receipt-pair",
      "state-membership",
    ]),
  }),
});
const TRANSPORT_DIGEST_FIELDS = Object.freeze([
  "currentResultDigests",
  "envelopeDigests",
  "groupDigests",
  "historicalResultDigests",
  "packetDigests",
  "runDigests",
]);

export class WakeflowLegacyArchiveRecordError extends Error {
  constructor(code, message, { path = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowLegacyArchiveRecordError";
    this.code = code;
    this.path = path;
    this.details = Object.freeze({ ...details });
  }
}

// ==================== 一、无行为的strict data基础校验 ====================

function fail(code, message, { path = "$", details = {}, cause } = {}) {
  throw new WakeflowLegacyArchiveRecordError(code, message, {
    path,
    details,
    cause,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozenClone(value) {
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function plainObject(value, errorPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-legacy-archive-record-shape", "legacy archive value must be a plain data object", {
      path: errorPath,
    });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-legacy-archive-record-shape", "legacy archive value must be a plain data object", {
      path: errorPath,
    });
  }
  return value;
}

function exactDataFields(value, required, optional, errorPath) {
  plainObject(value, errorPath);
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("wakeflow-legacy-archive-record-field", "legacy archive value cannot contain symbol fields", {
      path: errorPath,
    });
  }
  for (const key of keys) {
    if (!allowed.has(key)) {
      fail("wakeflow-legacy-archive-record-field", "legacy archive value contains an unknown field", {
        path: errorPath,
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-legacy-archive-record-field", "legacy archive fields must be enumerable data fields", {
        path: `${errorPath}/${key}`,
      });
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-legacy-archive-record-field", "legacy archive value is missing a required field", {
        path: `${errorPath}/${key}`,
      });
    }
  }
  return value;
}

function digest(value, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-legacy-archive-record-digest", "legacy archive digest must be sha256:<64 lowercase hex>", {
      path: errorPath,
    });
  }
  return value;
}

function timestamp(value, errorPath) {
  const match = typeof value === "string" ? TIMESTAMP_RE.exec(value) : null;
  if (!match) {
    fail("wakeflow-legacy-archive-record-timestamp", "legacy archive timestamp must be explicit UTC", {
      path: errorPath,
    });
  }
  const milliseconds = Date.parse(value);
  const instant = new Date(milliseconds);
  if (
    !Number.isFinite(milliseconds)
    || instant.getUTCFullYear() !== Number(match[1])
    || instant.getUTCMonth() + 1 !== Number(match[2])
    || instant.getUTCDate() !== Number(match[3])
    || instant.getUTCHours() !== Number(match[4])
    || instant.getUTCMinutes() !== Number(match[5])
    || instant.getUTCSeconds() !== Number(match[6])
  ) {
    fail("wakeflow-legacy-archive-record-timestamp", "legacy archive timestamp is not a real instant", {
      path: errorPath,
    });
  }
  return value;
}

function positiveInteger(value, errorPath) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("wakeflow-legacy-archive-record-integer", "legacy archive count must be a positive safe integer", {
      path: errorPath,
    });
  }
  return value;
}

function denseArray(value, errorPath, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("wakeflow-legacy-archive-record-array", "legacy archive collection must be a dense array", {
      path: errorPath,
    });
  }
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  const slots = [];
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      fail("wakeflow-legacy-archive-record-array", "legacy archive collection cannot contain authority outside dense slots", {
        path: errorPath,
      });
    }
    const index = Number(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !Number.isSafeInteger(index)
      || index >= length
      || !descriptor?.enumerable
      || !Object.hasOwn(descriptor, "value")
    ) {
      fail("wakeflow-legacy-archive-record-array", "legacy archive collection slots must be enumerable data fields", {
        path: `${errorPath}/${key}`,
      });
    }
    slots.push(index);
  }
  slots.sort((left, right) => left - right);
  if (
    !Number.isSafeInteger(length)
    || length < 0
    || (nonEmpty && length === 0)
    || slots.length !== length
    || slots.some((index, position) => index !== position)
  ) {
    fail("wakeflow-legacy-archive-record-array", "legacy archive collection must be a dense array", {
      path: errorPath,
    });
  }
  return value;
}

function assertSortedUnique(values, errorPath, selector = (entry) => entry) {
  const keys = values.map(selector);
  const sorted = [...new Set(keys)].sort();
  if (sorted.length !== keys.length || sorted.some((entry, index) => entry !== keys[index])) {
    fail("wakeflow-legacy-archive-record-order", "legacy archive collection must be unique and lexically sorted", {
      path: errorPath,
    });
  }
}

function typedId(value, type, errorPath) {
  try {
    return assertWakeflowId(value, type, errorPath);
  } catch {
    fail("wakeflow-legacy-archive-record-id", "legacy archive wrapper identity is invalid", {
      path: errorPath,
    });
  }
}

function validateCoverage(value, sourceKind) {
  denseArray(value, "$/coverage", { nonEmpty: true });
  if (value.some((entry) => typeof entry !== "string")) {
    fail("wakeflow-legacy-archive-record-coverage", "legacy evidence coverage entries must be tokens", {
      path: "$/coverage",
    });
  }
  assertSortedUnique(value, "$/coverage");
  const contract = COVERAGE_CONTRACTS[sourceKind];
  if (
    value.some((entry) => !contract.allowed.has(entry))
    || contract.required.some((entry) => !value.includes(entry))
  ) {
    fail("wakeflow-legacy-archive-record-coverage", "legacy evidence coverage does not satisfy its source contract", {
      path: "$/coverage",
    });
  }
  return value;
}

function validateCloseDetails(value, artifactCount, coverage) {
  exactDataFields(value, [
    "kind",
    "podCount",
    "manifestCount",
    "closeOperationCount",
    "closedBindingCount",
    "resourceCoverage",
  ], [], "$/details");
  if (value.kind !== "pod-close" || !["complete", "host-followup"].includes(value.resourceCoverage)) {
    fail("wakeflow-legacy-archive-record-details", "Pod close details use an unsupported discriminator or resource coverage", {
      path: "$/details",
    });
  }
  for (const field of ["podCount", "manifestCount", "closeOperationCount", "closedBindingCount"]) {
    positiveInteger(value[field], `$/details/${field}`);
  }
  if (
    value.manifestCount !== value.podCount
    || value.closedBindingCount !== value.closeOperationCount
    || value.closeOperationCount < value.podCount
    || artifactCount !== value.manifestCount + value.closeOperationCount + value.closedBindingCount
  ) {
    fail("wakeflow-legacy-archive-record-details", "Pod close counts do not close over the archived source set", {
      path: "$/details",
    });
  }
  const hasResourceClosure = coverage.includes("host-resource-closure");
  if ((value.resourceCoverage === "complete") !== hasResourceClosure) {
    fail("wakeflow-legacy-archive-record-coverage", "Pod close host resource coverage is inconsistent", {
      path: "$/coverage",
    });
  }
}

function validateMaterializationDetails(value, artifactCount) {
  exactDataFields(value, [
    "kind",
    "podCount",
    "manifestCount",
    "launchOperationCount",
    "boundWindowCount",
    "latestPhase",
    "historyComplete",
  ], [], "$/details");
  if (
    value.kind !== "pod-materialization"
    || value.latestPhase !== "closed"
    || value.historyComplete !== false
  ) {
    fail("wakeflow-legacy-archive-record-details", "Pod materialization must remain a closed latest snapshot with incomplete history", {
      path: "$/details",
    });
  }
  for (const field of ["podCount", "manifestCount", "launchOperationCount", "boundWindowCount"]) {
    positiveInteger(value[field], `$/details/${field}`);
  }
  if (
    value.manifestCount !== value.podCount
    || value.boundWindowCount !== value.launchOperationCount
    || value.launchOperationCount < value.podCount
    || artifactCount !== value.manifestCount + value.launchOperationCount + value.boundWindowCount
  ) {
    fail("wakeflow-legacy-archive-record-details", "Pod materialization counts do not close over the archived source set", {
      path: "$/details",
    });
  }
}

function validateTestAccessDetails(value, artifactCount, coverage) {
  exactDataFields(value, [
    "kind",
    "probeType",
    "probeOutcome",
    "targetCount",
    "planDigest",
    "receiptDigest",
    "legacyIdentityCoverage",
    "observedAt",
    "recordedAt",
  ], ["reasonCode"], "$/details");
  if (
    value.kind !== "pod-test-access"
    || value.probeType !== "direct-multi-root"
    || !["validated", "blocked"].includes(value.probeOutcome)
    || !["partial", "full"].includes(value.legacyIdentityCoverage)
  ) {
    fail("wakeflow-legacy-archive-record-details", "Pod Test access details contain an unsupported closed value", {
      path: "$/details",
    });
  }
  if (artifactCount !== 2) {
    fail("wakeflow-legacy-archive-record-details", "one Pod Test access summary must cover exactly one plan and one receipt", {
      path: "$/artifactCount",
    });
  }
  positiveInteger(value.targetCount, "$/details/targetCount");
  digest(value.planDigest, "$/details/planDigest");
  digest(value.receiptDigest, "$/details/receiptDigest");
  timestamp(value.observedAt, "$/details/observedAt");
  if (value.recordedAt !== null) timestamp(value.recordedAt, "$/details/recordedAt");
  const hasRecordedTime = coverage.includes("recorded-time");
  if ((value.recordedAt !== null) !== hasRecordedTime) {
    fail("wakeflow-legacy-archive-record-coverage", "Pod Test access recorded-time coverage is inconsistent", {
      path: "$/coverage",
    });
  }
  if (value.probeOutcome === "blocked") {
    if (!Object.hasOwn(value, "reasonCode") || !TEST_ACCESS_BLOCK_REASONS.has(value.reasonCode)) {
      fail("wakeflow-legacy-archive-record-details", "blocked Pod Test access requires one bounded legacy reason", {
        path: "$/details/reasonCode",
      });
    }
  } else if (Object.hasOwn(value, "reasonCode")) {
    fail("wakeflow-legacy-archive-record-details", "validated Pod Test access cannot contain a block reason", {
      path: "$/details/reasonCode",
    });
  }
}

function validatePreservation(value) {
  exactDataFields(value, [
    "preservationId",
    "payloadTreeDigest",
    "retentionClass",
  ], [], "$/preservation");
  typedId(value.preservationId, "preservation", "$/preservation/preservationId");
  exactDataFields(value.payloadTreeDigest, ["algorithm", "value", "entries"], [], "$/preservation/payloadTreeDigest");
  if (value.payloadTreeDigest.algorithm !== "sha256") {
    fail("wakeflow-legacy-archive-record-preservation", "legacy preservation tree digest algorithm must be sha256", {
      path: "$/preservation/payloadTreeDigest/algorithm",
    });
  }
  digest(value.payloadTreeDigest.value, "$/preservation/payloadTreeDigest/value");
  positiveInteger(value.payloadTreeDigest.entries, "$/preservation/payloadTreeDigest/entries");
  if (value.retentionClass !== "reviewable-local-audit") {
    fail("wakeflow-legacy-archive-record-preservation", "legacy preservation retention class is invalid", {
      path: "$/preservation/retentionClass",
    });
  }
}

const LEGACY_EVIDENCE_CORE_FIELDS = Object.freeze([
  "summarySchemaVersion",
  "sourceKind",
  "sourceDigest",
  "outcome",
  "coverage",
  "artifactCount",
  "details",
]);

// ==================== 二、legacy evidence fact与archive summary合同 ====================

function validateLegacyEvidenceCore(value) {
  if (value.summarySchemaVersion !== WAKEFLOW_LEGACY_ARCHIVE_RECORD_SCHEMA_VERSION) {
    fail("wakeflow-legacy-archive-record-version", "legacy evidence summary schema version is invalid", {
      path: "$/summarySchemaVersion",
    });
  }
  if (!SOURCE_KIND_SET.has(value.sourceKind)) {
    fail("wakeflow-legacy-archive-record-kind", "legacy evidence source kind is unsupported", {
      path: "$/sourceKind",
    });
  }
  digest(value.sourceDigest, "$/sourceDigest");
  if (value.outcome !== "verified-closed-archived") {
    fail("wakeflow-legacy-archive-record-outcome", "legacy evidence outcome is unsupported", {
      path: "$/outcome",
    });
  }
  const coverage = validateCoverage(value.coverage, value.sourceKind);
  const artifactCount = positiveInteger(value.artifactCount, "$/artifactCount");
  if (value.sourceKind === "pod-close") validateCloseDetails(value.details, artifactCount, coverage);
  else if (value.sourceKind === "pod-materialization") validateMaterializationDetails(value.details, artifactCount);
  else validateTestAccessDetails(value.details, artifactCount, coverage);
}

// fact只记录T06已验证的关闭事实，不携带raw bytes处置。
export function validateWakeflowLegacyEvidenceFact(value) {
  exactDataFields(value, LEGACY_EVIDENCE_CORE_FIELDS, [], "$");
  validateLegacyEvidenceCore(value);
  return frozenClone(value);
}

// 集合codec负责排序、唯一性和深冻结；单项业务闭包仍由对应单项validator拥有。
export function validateWakeflowLegacyEvidenceFacts(value) {
  denseArray(value, "$", { nonEmpty: true });
  const facts = value.map((entry) => validateWakeflowLegacyEvidenceFact(entry));
  assertSortedUnique(
    facts,
    "$",
    (entry) => `${entry.sourceKind}\0${entry.sourceDigest}`,
  );
  return deepFreeze(facts);
}

// summary在fact上增加rawDisposition；preservation tuple必须与处置成对出现。
export function validateWakeflowLegacyEvidenceSummary(value) {
  exactDataFields(value, [
    ...LEGACY_EVIDENCE_CORE_FIELDS,
    "rawDisposition",
  ], ["preservation"], "$");
  validateLegacyEvidenceCore(value);

  if (value.rawDisposition === "preserved") {
    if (!Object.hasOwn(value, "preservation")) {
      fail("wakeflow-legacy-archive-record-preservation", "preserved legacy evidence requires an exact preservation tuple", {
        path: "$/preservation",
      });
    }
    validatePreservation(value.preservation);
  } else if (value.rawDisposition === "release-after-wrapper") {
    if (Object.hasOwn(value, "preservation")) {
      fail("wakeflow-legacy-archive-record-preservation", "release-after-wrapper legacy evidence cannot claim preservation", {
        path: "$/preservation",
      });
    }
  } else {
    fail("wakeflow-legacy-archive-record-disposition", "legacy evidence raw disposition is unsupported", {
      path: "$/rawDisposition",
    });
  }
  return frozenClone(value);
}

export function validateWakeflowLegacyEvidenceSummaries(value) {
  denseArray(value, "$", { nonEmpty: true });
  const summaries = value.map((entry) => validateWakeflowLegacyEvidenceSummary(entry));
  assertSortedUnique(
    summaries,
    "$",
    (entry) => `${entry.sourceKind}\0${entry.sourceDigest}`,
  );
  return deepFreeze(summaries);
}

// ==================== 三、legacy transport摘要及portable编码 ====================

function validateDigestCollection(value, errorPath) {
  denseArray(value, errorPath);
  value.forEach((entry, index) => digest(entry, `${errorPath}/${index}`));
  assertSortedUnique(value, errorPath);
  return value;
}

// transport摘要只携带分组后的record digest集合，并从集合重派inventory/source digest。
export function validateWakeflowLegacyTransportSummary(value) {
  exactDataFields(value, [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "sourceStatus",
    "ownerDrainAssessmentDigest",
    "sourceDigest",
    "inventoryDigest",
    ...TRANSPORT_DIGEST_FIELDS,
  ], [], "$");
  if (
    value.schemaVersion !== WAKEFLOW_LEGACY_ARCHIVE_RECORD_SCHEMA_VERSION
    || value.artifactKind !== WAKEFLOW_LEGACY_ARCHIVE_TRANSPORT_SUMMARY_KIND
  ) {
    fail("wakeflow-legacy-archive-record-kind", "legacy transport summary identity is invalid", {
      path: "$",
    });
  }
  typedId(value.programId, "program", "$/programId");
  typedId(value.demandId, "demand", "$/demandId");
  if (!TRANSPORT_SOURCE_STATUSES.has(value.sourceStatus)) {
    fail("wakeflow-legacy-archive-record-transport", "legacy transport source status is invalid", {
      path: "$/sourceStatus",
    });
  }
  digest(value.ownerDrainAssessmentDigest, "$/ownerDrainAssessmentDigest");
  digest(value.sourceDigest, "$/sourceDigest");
  digest(value.inventoryDigest, "$/inventoryDigest");
  for (const field of TRANSPORT_DIGEST_FIELDS) {
    validateDigestCollection(value[field], `$/${field}`);
  }
  const inventory = Object.fromEntries(
    TRANSPORT_DIGEST_FIELDS.map((field) => [field, value[field]]),
  );
  if (value.inventoryDigest !== canonicalJsonDigest(inventory)) {
    fail("wakeflow-legacy-archive-record-transport", "legacy transport inventory digest differs from its exact record digest sets", {
      path: "$/inventoryDigest",
    });
  }
  if (value.sourceDigest !== canonicalJsonDigest({
    inventoryDigest: value.inventoryDigest,
    sourceStatus: value.sourceStatus,
  })) {
    fail("wakeflow-legacy-archive-record-transport", "legacy transport source digest differs from its exact source status and inventory", {
      path: "$/sourceDigest",
    });
  }
  const recordCount = TRANSPORT_DIGEST_FIELDS.reduce(
    (total, field) => total + value[field].length,
    0,
  );
  if (
    (value.sourceStatus === "absent" && recordCount !== 0)
    || (value.sourceStatus === "archived" && recordCount === 0)
  ) {
    fail("wakeflow-legacy-archive-record-transport", "legacy transport status does not match its record inventory", {
      path: "$/sourceStatus",
    });
  }
  return frozenClone(value);
}

// discriminator也必须是own enumerable data field；不能为了选择codec而先执行getter。
function isTransportSummary(value) {
  if (!value || typeof value !== "object") return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "artifactKind");
  return descriptor?.enumerable === true
    && Object.hasOwn(descriptor, "value")
    && descriptor.value === WAKEFLOW_LEGACY_ARCHIVE_TRANSPORT_SUMMARY_KIND;
}

// archive成员统一使用一行canonical JSON；换行属于成员字节合同并进入上层digest。
export function wakeflowLegacyArchiveCanonicalBytes(value) {
  const validated = isTransportSummary(value)
    ? validateWakeflowLegacyTransportSummary(value)
    : validateWakeflowLegacyEvidenceSummary(value);
  return Buffer.concat([canonicalJsonBytes(validated), Buffer.from("\n", "utf8")]);
}

export function wakeflowLegacyArchiveDigest(value) {
  const validated = isTransportSummary(value)
    ? validateWakeflowLegacyTransportSummary(value)
    : validateWakeflowLegacyEvidenceSummary(value);
  return canonicalJsonDigest(validated);
}
