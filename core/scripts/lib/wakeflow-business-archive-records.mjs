/**
 * BusinessArchive 的便携记录合同层。
 *
 * 本文件只负责四类归档记录的闭合字段、跨记录身份关系、canonical 字节与摘要，
 * 以及归档发布前的拒绝式隐私准入；它不读取工作区、不发布 ledger，也不决定归档时机。
 */
import { createHash } from "node:crypto";

import {
  canonicalJson,
  canonicalJsonBytes,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  validateControllerEventRecord,
  validateDemandStateRecord,
} from "./wakeflow-demand-core-records.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { validateLedgerRecord } from "./wakeflow-ledger-records.mjs";
import {
  EMPTY_TODO_BOARD,
  planTodoClaim,
  TODO_BOARD_REF,
} from "./wakeflow-todo-service.mjs";

export const WAKEFLOW_BUSINESS_ARCHIVE_SCHEMA_VERSION = 1;
export const WAKEFLOW_BUSINESS_ARCHIVE_KINDS = Object.freeze([
  "wakeflow-business-archive-summary",
  "wakeflow-business-archive-transport-summary",
  "wakeflow-business-archive-todo-history",
  "wakeflow-business-archive-transaction",
]);

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const MEDIA_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const PORTABLE_REF_FIELDS = new Set([
  "boardRef",
  "ledgerRootRef",
  "lineageRef",
  "memberRef",
  "ref",
  "sourceRef",
  "stateRootRef",
]);
const STRUCTURAL_STRING_FIELDS = new Set([
  "actor",
  "artifactKind",
  "command",
  "contentClass",
  "family",
  "kind",
  "lifecycleStatus",
  "mediaType",
  "mode",
  "outcome",
  "role",
  "state",
  "status",
  "type",
]);
const CREDENTIAL_RE = /(?:\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}\b|\bgh[pousr]_[0-9A-Za-z]{20,}\b|\bsk-(?:proj-)?[0-9A-Za-z_-]{20,}\b|\bxox[baprs]-[0-9A-Za-z-]{10,}\b|\bBearer\s+[0-9A-Za-z._~+\/-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/u;
const PRIVATE_PATH_RE = /(?:^|[\s"'`(])(?:\/(?:Users|home|private|var\/folders)\/[^\s"'`)]*|[A-Za-z]:\\Users\\[^\s"'`)]*)/u;
const BARE_UUID_RE = /(?<![a-z0-9-])[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![a-z0-9-])/iu;
const BARE_UUID_GLOBAL_RE = /(?<![a-z0-9-])[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![a-z0-9-])/giu;
const TYPED_UUID_PREFIX_RE = /(?:^|[^a-z0-9-])(?:archive|binding|confirmation|delivery|delivery-run|demand|dispatch-group|dispatch-packet|evidence|lease|pod|pod-close|pod-design-handoff|pod-design-request|pod-launch|pod-materialization-attempt|pod-materialization-event|pod-resume-observation|pod-test-probe|preservation|program|repository|requirement|review-candidate|surface|target-result|target-task|task-package|test-attempt|test-card|window)_$/u;
const TYPED_ID_RE = /^(?:archive|binding|confirmation|delivery|delivery-run|demand|dispatch-group|dispatch-packet|evidence|lease|pod|pod-close|pod-design-handoff|pod-design-request|pod-launch|pod-materialization-attempt|pod-materialization-event|pod-resume-observation|pod-test-probe|preservation|program|repository|requirement|review-candidate|surface|target-result|target-task|task-package|test-attempt|test-card|window)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * 统一携带稳定错误码、字段路径和脱敏详情的记录合同错误。
 */
export class WakeflowBusinessArchiveRecordError extends Error {
  constructor(code, message, { path = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowBusinessArchiveRecordError";
    this.code = code;
    this.path = path;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, { path = "$", details = {}, cause } = {}) {
  throw new WakeflowBusinessArchiveRecordError(code, message, {
    path,
    details,
    cause,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || Buffer.isBuffer(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozenClone(value) {
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function canonicalRecordSnapshot(value, errorPath = "$") {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(
      "wakeflow-business-archive-record-shape",
      "business archive records must be canonical passive data",
      { path: errorPath, cause },
    );
  }
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPlainObject(value, errorPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-business-archive-record-shape", "business archive value must be an object", { path: errorPath });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-business-archive-record-shape", "business archive value must be a plain data object", { path: errorPath });
  }
  return value;
}

function assertExactKeys(value, required, optional, errorPath) {
  assertPlainObject(value, errorPath);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("wakeflow-business-archive-record-field", "business archive value contains an unknown field", {
        path: `${errorPath}/${key}`,
      });
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-business-archive-record-field", "business archive value is missing a required field", {
        path: `${errorPath}/${key}`,
      });
    }
  }
}

function assertSchemaKind(value, kind, errorPath = "$") {
  if (
    value.schemaVersion !== WAKEFLOW_BUSINESS_ARCHIVE_SCHEMA_VERSION
    || value.artifactKind !== kind
  ) {
    fail("wakeflow-business-archive-record-kind", "unsupported business archive record contract", {
      path: errorPath,
    });
  }
}

function assertId(value, type, errorPath) {
  try {
    return assertWakeflowId(value, type, errorPath);
  } catch (cause) {
    fail("wakeflow-business-archive-record-id", "business archive typed identity is invalid", {
      path: errorPath,
      cause,
    });
  }
}

function assertDigest(value, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-business-archive-record-digest", "business archive digest must be sha256:<64 lowercase hex>", {
      path: errorPath,
    });
  }
  return value;
}

function assertTimestamp(value, errorPath) {
  const match = typeof value === "string" ? TIMESTAMP_RE.exec(value) : null;
  if (!match) {
    fail("wakeflow-business-archive-record-timestamp", "business archive timestamp must be explicit UTC", {
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
    fail("wakeflow-business-archive-record-timestamp", "business archive timestamp is not a real instant", {
      path: errorPath,
    });
  }
  return value;
}

function assertInteger(value, errorPath, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail("wakeflow-business-archive-record-integer", "business archive integer is outside its admitted range", {
      path: errorPath,
    });
  }
  return value;
}

function assertHumanText(value, errorPath) {
  if (typeof value !== "string" || !value || value !== value.trim() || CONTROL_RE.test(value)) {
    fail("wakeflow-business-archive-record-text", "business archive human text must be trimmed and control-free", {
      path: errorPath,
    });
  }
  return value;
}

function assertToken(value, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail("wakeflow-business-archive-record-token", "business archive token must be one trimmed line", {
      path: errorPath,
    });
  }
  return value;
}

function assertPortableRef(value, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\\")
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("//")
    || /^[A-Za-z]:/u.test(value)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail("wakeflow-business-archive-record-ref", "business archive reference must be a portable relative file ref", {
      path: errorPath,
    });
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("wakeflow-business-archive-record-ref", "business archive reference cannot contain dot segments", {
      path: errorPath,
    });
  }
  return value;
}

function assertSortedUnique(values, errorPath, selector = (value) => value) {
  const keys = values.map(selector);
  const sorted = [...new Set(keys)].sort(lexicalCompare);
  if (sorted.length !== keys.length || sorted.some((value, index) => value !== keys[index])) {
    fail("wakeflow-business-archive-record-order", "business archive collection must be unique and lexically sorted", {
      path: errorPath,
    });
  }
}

function validateTerminalAdmission(value) {
  assertExactKeys(value, [
    "state",
    "revision",
    "stateDigest",
    "eventId",
    "eventDigest",
  ], [], "$/terminalAdmission");
  if (!["completed", "cancelled"].includes(value.state)) {
    fail("wakeflow-business-archive-record-terminal", "archive terminal state must be completed or cancelled", {
      path: "$/terminalAdmission/state",
    });
  }
  assertInteger(value.revision, "$/terminalAdmission/revision", { minimum: 1 });
  assertDigest(value.stateDigest, "$/terminalAdmission/stateDigest");
  assertToken(value.eventId, "$/terminalAdmission/eventId");
  assertDigest(value.eventDigest, "$/terminalAdmission/eventDigest");
  return value;
}

function validateArchiveTransition(value, terminal) {
  assertExactKeys(value, [
    "eventId",
    "eventDigest",
    "previousRevision",
    "nextRevision",
    "from",
    "to",
    "createdAt",
    "reason",
    "stateDigest",
  ], [], "$/archiveTransition");
  assertToken(value.eventId, "$/archiveTransition/eventId");
  assertDigest(value.eventDigest, "$/archiveTransition/eventDigest");
  assertInteger(value.previousRevision, "$/archiveTransition/previousRevision", { minimum: 1 });
  assertInteger(value.nextRevision, "$/archiveTransition/nextRevision", { minimum: 2 });
  if (
    value.previousRevision !== terminal.revision
    || value.nextRevision !== value.previousRevision + 1
    || value.from !== terminal.state
    || value.to !== "archived"
  ) {
    fail("wakeflow-business-archive-record-transition", "archive transition must advance the exact terminal revision to archived", {
      path: "$/archiveTransition",
    });
  }
  assertTimestamp(value.createdAt, "$/archiveTransition/createdAt");
  assertHumanText(value.reason, "$/archiveTransition/reason");
  assertDigest(value.stateDigest, "$/archiveTransition/stateDigest");
  return value;
}

function validateCoreEntries(value) {
  if (!Array.isArray(value)) {
    fail("wakeflow-business-archive-record-core", "summary core must be an array", { path: "$/core" });
  }
  const roles = new Set(["demand", "authority", "state", "events"]);
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    const errorPath = `$/core/${index}`;
    assertExactKeys(entry, [
      "role",
      "sourceRef",
      "sourceDigest",
      "sourceByteDigest",
      "memberRef",
      "memberDigest",
      "mediaType",
    ], [], errorPath);
    if (!roles.has(entry.role)) {
      fail("wakeflow-business-archive-record-core", "summary core role is unsupported", { path: `${errorPath}/role` });
    }
    assertPortableRef(entry.sourceRef, `${errorPath}/sourceRef`);
    assertDigest(entry.sourceDigest, `${errorPath}/sourceDigest`);
    assertDigest(entry.sourceByteDigest, `${errorPath}/sourceByteDigest`);
    assertPortableRef(entry.memberRef, `${errorPath}/memberRef`);
    assertDigest(entry.memberDigest, `${errorPath}/memberDigest`);
    if (typeof entry.mediaType !== "string" || !MEDIA_TYPE_RE.test(entry.mediaType)) {
      fail("wakeflow-business-archive-record-media-type", "summary core mediaType is invalid", { path: `${errorPath}/mediaType` });
    }
  }
  assertSortedUnique(value, "$/core", (entry) => entry.memberRef);
  const actualRoles = new Set(value.map((entry) => entry.role));
  for (const required of ["demand", "state", "events"]) {
    if (!actualRoles.has(required)) {
      fail("wakeflow-business-archive-record-core", "summary core is missing a required role", { path: "$/core" });
    }
  }
  if (actualRoles.size !== value.length) {
    fail("wakeflow-business-archive-record-core", "summary core roles must be unique", { path: "$/core" });
  }
  return value;
}

function validateArtifactEntries(value) {
  if (!Array.isArray(value)) {
    fail("wakeflow-business-archive-record-artifacts", "summary artifacts must be an array", { path: "$/artifacts" });
  }
  const kinds = new Map([
    ["wakeflow-pod-design-handoff", "pod-design-handoff"],
    ["wakeflow-pod-design-request", "pod-design-request"],
    ["wakeflow-task-package", "task-package"],
    ["wakeflow-target-result", "target-result"],
    ["wakeflow-review-candidate", "review-candidate"],
    ["wakeflow-test-card", "test-card"],
  ]);
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    const errorPath = `$/artifacts/${index}`;
    assertExactKeys(entry, [
      "artifactKind",
      "artifactId",
      "ref",
      "digest",
      "memberRef",
      "memberDigest",
      "lifecycleStatus",
    ], [], errorPath);
    const idType = kinds.get(entry.artifactKind);
    if (!idType) {
      fail("wakeflow-business-archive-record-artifacts", "summary artifact kind is unsupported", { path: `${errorPath}/artifactKind` });
    }
    assertId(entry.artifactId, idType, `${errorPath}/artifactId`);
    assertPortableRef(entry.ref, `${errorPath}/ref`);
    assertDigest(entry.digest, `${errorPath}/digest`);
    assertPortableRef(entry.memberRef, `${errorPath}/memberRef`);
    assertDigest(entry.memberDigest, `${errorPath}/memberDigest`);
    assertToken(entry.lifecycleStatus, `${errorPath}/lifecycleStatus`);
  }
  assertSortedUnique(value, "$/artifacts", (entry) => entry.memberRef);
  return value;
}

function validateEvidenceEntries(value) {
  if (!Array.isArray(value)) {
    fail("wakeflow-business-archive-record-evidence", "summary evidence must be an array", { path: "$/evidence" });
  }
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    const errorPath = `$/evidence/${index}`;
    assertExactKeys(entry, ["evidenceId", "ref", "digest", "memberRefs"], [], errorPath);
    assertId(entry.evidenceId, "evidence", `${errorPath}/evidenceId`);
    assertPortableRef(entry.ref, `${errorPath}/ref`);
    assertDigest(entry.digest, `${errorPath}/digest`);
    if (!Array.isArray(entry.memberRefs) || entry.memberRefs.length < 1) {
      fail("wakeflow-business-archive-record-evidence", "evidence summary must contain its manifest member", { path: `${errorPath}/memberRefs` });
    }
    for (let memberIndex = 0; memberIndex < entry.memberRefs.length; memberIndex += 1) {
      const member = entry.memberRefs[memberIndex];
      const memberPath = `${errorPath}/memberRefs/${memberIndex}`;
      assertExactKeys(member, ["ref", "digest"], [], memberPath);
      assertPortableRef(member.ref, `${memberPath}/ref`);
      assertDigest(member.digest, `${memberPath}/digest`);
    }
    assertSortedUnique(entry.memberRefs, `${errorPath}/memberRefs`, (member) => member.ref);
  }
  assertSortedUnique(value, "$/evidence", (entry) => entry.evidenceId);
  return value;
}

function validateResultAuthority(value) {
  assertExactKeys(value, [
    "stateRevision",
    "stateDigest",
    "eventId",
    "eventDigest",
    "currentResultSetDigest",
    "selectedResults",
  ], [], "$/resultAuthority");
  assertInteger(value.stateRevision, "$/resultAuthority/stateRevision", { minimum: 1 });
  assertDigest(value.stateDigest, "$/resultAuthority/stateDigest");
  assertToken(value.eventId, "$/resultAuthority/eventId");
  assertDigest(value.eventDigest, "$/resultAuthority/eventDigest");
  assertDigest(value.currentResultSetDigest, "$/resultAuthority/currentResultSetDigest");
  if (!Array.isArray(value.selectedResults)) {
    fail("wakeflow-business-archive-record-results", "selectedResults must be an array", { path: "$/resultAuthority/selectedResults" });
  }
  for (let index = 0; index < value.selectedResults.length; index += 1) {
    const entry = value.selectedResults[index];
    const errorPath = `$/resultAuthority/selectedResults/${index}`;
    assertExactKeys(entry, ["targetTaskId", "targetResultId", "ref", "digest", "outcome"], [], errorPath);
    assertId(entry.targetTaskId, "target-task", `${errorPath}/targetTaskId`);
    assertId(entry.targetResultId, "target-result", `${errorPath}/targetResultId`);
    assertPortableRef(entry.ref, `${errorPath}/ref`);
    assertDigest(entry.digest, `${errorPath}/digest`);
    assertToken(entry.outcome, `${errorPath}/outcome`);
  }
  assertSortedUnique(value.selectedResults, "$/resultAuthority/selectedResults", (entry) => entry.targetTaskId);
  return value;
}

function validateTodoLineageRef(value, errorPath) {
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "boardRef",
    "todoId",
    "intakeRowDigest",
  ], [], errorPath);
  if (
    value.schemaVersion !== 1
    || value.artifactKind !== "wakeflow-todo-lineage-ref"
    || value.boardRef !== TODO_BOARD_REF
  ) {
    fail("wakeflow-business-archive-record-todo", "TODO lineage ref contract is invalid", { path: errorPath });
  }
  assertToken(value.todoId, `${errorPath}/todoId`);
  assertDigest(value.intakeRowDigest, `${errorPath}/intakeRowDigest`);
  return value;
}

function validateTodoSummary(value) {
  if (value === null) return null;
  assertExactKeys(value, [
    "todoId",
    "lineageRef",
    "intakeRowDigest",
    "claimedRowDigest",
    "memberRef",
  ], [], "$/todo");
  assertToken(value.todoId, "$/todo/todoId");
  const lineage = validateTodoLineageRef(value.lineageRef, "$/todo/lineageRef");
  assertDigest(value.intakeRowDigest, "$/todo/intakeRowDigest");
  assertDigest(value.claimedRowDigest, "$/todo/claimedRowDigest");
  assertPortableRef(value.memberRef, "$/todo/memberRef");
  if (
    lineage.todoId !== value.todoId
    || lineage.intakeRowDigest !== value.intakeRowDigest
  ) {
    fail("wakeflow-business-archive-record-todo", "TODO summary does not bind one exact lineage", { path: "$/todo" });
  }
  return value;
}

function transportRecordRef(demandId, collection, id) {
  return `.wakeflow-local/runtime/shared/transport/demands/${demandId}/${collection}/${id}.json`;
}

function assertMachineToken(value, errorPath) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/u.test(value)) {
    fail("wakeflow-business-archive-record-transport", "transport summary token is invalid", {
      path: errorPath,
    });
  }
  return value;
}

function validateTransportTuple(value, errorPath, {
  idType,
  collection,
  demandId,
}) {
  assertExactKeys(value, ["id", "ref", "digest"], [], errorPath);
  const id = assertId(value.id, idType, `${errorPath}/id`);
  const expectedRef = transportRecordRef(demandId, collection, id);
  if (value.ref !== expectedRef) {
    fail("wakeflow-business-archive-record-transport", "transport summary tuple ref is not canonical", {
      path: `${errorPath}/ref`,
    });
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateTransportReadback(value, errorPath) {
  assertExactKeys(value, ["status", "attempts", "evidence"], [], errorPath);
  if (!["confirmed", "pending", "unavailable"].includes(value.status)) {
    fail("wakeflow-business-archive-record-transport", "transport summary readback status is invalid", {
      path: `${errorPath}/status`,
    });
  }
  assertInteger(value.attempts, `${errorPath}/attempts`);
  if (value.attempts > 1 || !Array.isArray(value.evidence) || value.evidence.length > 1) {
    fail("wakeflow-business-archive-record-transport", "transport summary readback cardinality is invalid", {
      path: errorPath,
    });
  }
  for (let index = 0; index < value.evidence.length; index += 1) {
    const entry = value.evidence[index];
    const entryPath = `${errorPath}/evidence/${index}`;
    assertExactKeys(entry, ["kind", "digest"], [], entryPath);
    assertMachineToken(entry.kind, `${entryPath}/kind`);
    assertDigest(entry.digest, `${entryPath}/digest`);
  }
  const observed = `${value.attempts}:${value.evidence.length}`;
  if (
    ((value.status === "confirmed" || value.status === "pending") && observed !== "1:1")
    || (value.status === "unavailable" && !["0:0", "1:1"].includes(observed))
  ) {
    fail("wakeflow-business-archive-record-transport", "transport summary readback facts do not close", {
      path: errorPath,
    });
  }
  return value;
}

/**
 * 校验并冻结整项需求的脱敏 transport 闭包摘要。
 */
export function validateBusinessArchiveTransportSummary(value) {
  value = canonicalRecordSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "sourceStatus",
    "inventoryDigest",
    "groups",
    "packets",
    "envelopes",
    "runs",
  ], [], "$" );
  assertSchemaKind(value, "wakeflow-business-archive-transport-summary");
  const programId = assertId(value.programId, "program", "$/programId");
  const demandId = assertId(value.demandId, "demand", "$/demandId");
  if (!["missing", "empty", "current"].includes(value.sourceStatus)) {
    fail("wakeflow-business-archive-record-transport", "transport summary sourceStatus is invalid", {
      path: "$/sourceStatus",
    });
  }
  assertDigest(value.inventoryDigest, "$/inventoryDigest");
  for (const field of ["groups", "packets", "envelopes", "runs"]) {
    if (!Array.isArray(value[field])) {
      fail("wakeflow-business-archive-record-transport", "transport summary collections must be arrays", {
        path: `$/${field}`,
      });
    }
  }

  const groupIds = new Set();
  const packetOwners = new Map();
  for (let index = 0; index < value.groups.length; index += 1) {
    const group = value.groups[index];
    const errorPath = `$/groups/${index}`;
    assertExactKeys(group, [
      "groupId",
      "ref",
      "digest",
      "stateRevision",
      "controllerWindowId",
      "members",
      "returnPolicy",
      "createdAt",
    ], [], errorPath);
    const groupId = assertId(group.groupId, "dispatch-group", `${errorPath}/groupId`);
    if (group.ref !== transportRecordRef(demandId, "groups", groupId)) {
      fail("wakeflow-business-archive-record-transport", "transport summary group ref is not canonical", {
        path: `${errorPath}/ref`,
      });
    }
    assertDigest(group.digest, `${errorPath}/digest`);
    assertInteger(group.stateRevision, `${errorPath}/stateRevision`, { minimum: 1 });
    assertId(group.controllerWindowId, "window", `${errorPath}/controllerWindowId`);
    assertTimestamp(group.createdAt, `${errorPath}/createdAt`);
    assertExactKeys(group.returnPolicy, ["mode"], [], `${errorPath}/returnPolicy`);
    if (!["group-ready", "per-target"].includes(group.returnPolicy.mode)) {
      fail("wakeflow-business-archive-record-transport", "transport summary return policy is invalid", {
        path: `${errorPath}/returnPolicy/mode`,
      });
    }
    if (!Array.isArray(group.members) || group.members.length === 0) {
      fail("wakeflow-business-archive-record-transport", "transport summary group members cannot be empty", {
        path: `${errorPath}/members`,
      });
    }
    const targetTaskIds = new Set();
    let previousMember = null;
    for (let memberIndex = 0; memberIndex < group.members.length; memberIndex += 1) {
      const member = group.members[memberIndex];
      const memberPath = `${errorPath}/members/${memberIndex}`;
      assertExactKeys(member, ["windowId", "targetTaskId", "packetId"], [], memberPath);
      assertId(member.windowId, "window", `${memberPath}/windowId`);
      assertId(member.targetTaskId, "target-task", `${memberPath}/targetTaskId`);
      assertId(member.packetId, "dispatch-packet", `${memberPath}/packetId`);
      if (
        targetTaskIds.has(member.targetTaskId)
        || packetOwners.has(member.packetId)
        || (previousMember && (
          previousMember.windowId > member.windowId
          || (previousMember.windowId === member.windowId && previousMember.targetTaskId > member.targetTaskId)
        ))
      ) {
        fail("wakeflow-business-archive-record-transport", "transport summary group membership is duplicated or unordered", {
          path: memberPath,
        });
      }
      targetTaskIds.add(member.targetTaskId);
      packetOwners.set(member.packetId, { groupId, member });
      previousMember = member;
    }
    if (groupIds.has(groupId)) {
      fail("wakeflow-business-archive-record-transport", "transport summary group ID is duplicated", {
        path: `${errorPath}/groupId`,
      });
    }
    groupIds.add(groupId);
  }
  assertSortedUnique(value.groups, "$/groups", (entry) => entry.ref);
  const groupsById = new Map(value.groups.map((entry) => [entry.groupId, entry]));

  for (let index = 0; index < value.packets.length; index += 1) {
    const packet = value.packets[index];
    const errorPath = `$/packets/${index}`;
    assertExactKeys(packet, [
      "packetId",
      "ref",
      "digest",
      "groupId",
      "groupRef",
      "groupDigest",
      "windowId",
      "targetTaskId",
      "taskPackage",
      "workType",
      "createdAt",
    ], ["testCard"], errorPath);
    const packetId = assertId(packet.packetId, "dispatch-packet", `${errorPath}/packetId`);
    const groupId = assertId(packet.groupId, "dispatch-group", `${errorPath}/groupId`);
    if (packet.ref !== transportRecordRef(demandId, "packets", packetId)) {
      fail("wakeflow-business-archive-record-transport", "transport summary packet ref is not canonical", {
        path: `${errorPath}/ref`,
      });
    }
    assertDigest(packet.digest, `${errorPath}/digest`);
    assertId(packet.windowId, "window", `${errorPath}/windowId`);
    assertId(packet.targetTaskId, "target-task", `${errorPath}/targetTaskId`);
    assertTimestamp(packet.createdAt, `${errorPath}/createdAt`);
    if (!["documentation", "implementation", "research", "test"].includes(packet.workType)) {
      fail("wakeflow-business-archive-record-transport", "transport summary packet workType is invalid", {
        path: `${errorPath}/workType`,
      });
    }
    const group = groupsById.get(groupId);
    const owner = packetOwners.get(packetId);
    if (
      !group
      || !owner
      || owner.groupId !== groupId
      || owner.member.windowId !== packet.windowId
      || owner.member.targetTaskId !== packet.targetTaskId
      || packet.groupRef !== group.ref
      || packet.groupDigest !== group.digest
    ) {
      fail("wakeflow-business-archive-record-transport", "transport summary packet ancestry differs", {
        path: errorPath,
      });
    }
    assertExactKeys(packet.taskPackage, ["taskPackageId", "ref", "digest"], [], `${errorPath}/taskPackage`);
    const taskPackageId = assertId(packet.taskPackage.taskPackageId, "task-package", `${errorPath}/taskPackage/taskPackageId`);
    if (packet.taskPackage.ref !== `task-packages/${taskPackageId}.json`) {
      fail("wakeflow-business-archive-record-transport", "transport summary task package ref is not canonical", {
        path: `${errorPath}/taskPackage/ref`,
      });
    }
    assertDigest(packet.taskPackage.digest, `${errorPath}/taskPackage/digest`);
    if ((packet.workType === "test") !== Object.hasOwn(packet, "testCard")) {
      fail("wakeflow-business-archive-record-transport", "only Test packet summaries may carry a TestCard", {
        path: errorPath,
      });
    }
    if (packet.testCard) {
      assertExactKeys(packet.testCard, ["testCardId", "ref", "digest"], [], `${errorPath}/testCard`);
      const testCardId = assertId(packet.testCard.testCardId, "test-card", `${errorPath}/testCard/testCardId`);
      if (packet.testCard.ref !== `test-cards/${testCardId}.json`) {
        fail("wakeflow-business-archive-record-transport", "transport summary TestCard ref is not canonical", {
          path: `${errorPath}/testCard/ref`,
        });
      }
      assertDigest(packet.testCard.digest, `${errorPath}/testCard/digest`);
    }
  }
  assertSortedUnique(value.packets, "$/packets", (entry) => entry.ref);
  const packetsById = new Map(value.packets.map((entry) => [entry.packetId, entry]));
  if (packetsById.size !== value.packets.length) {
    fail("wakeflow-business-archive-record-transport", "transport summary packet ID is duplicated", {
      path: "$/packets",
    });
  }

  for (let index = 0; index < value.envelopes.length; index += 1) {
    const envelope = value.envelopes[index];
    const errorPath = `$/envelopes/${index}`;
    assertExactKeys(envelope, [
      "artifactKind",
      "deliveryId",
      "ref",
      "digest",
      "group",
      "preparedByHostId",
      "windowId",
      "correlationId",
      "createdAt",
    ], ["packet", "resultSetDigest", "reviewSnapshotDigest"], errorPath);
    const deliveryId = assertId(envelope.deliveryId, "delivery", `${errorPath}/deliveryId`);
    if (envelope.ref !== transportRecordRef(demandId, "envelopes", deliveryId)) {
      fail("wakeflow-business-archive-record-transport", "transport summary envelope ref is not canonical", {
        path: `${errorPath}/ref`,
      });
    }
    assertDigest(envelope.digest, `${errorPath}/digest`);
    validateTransportTuple(envelope.group, `${errorPath}/group`, {
      idType: "dispatch-group",
      collection: "groups",
      demandId,
    });
    const group = groupsById.get(envelope.group.id);
    if (!group || envelope.group.ref !== group.ref || envelope.group.digest !== group.digest) {
      fail("wakeflow-business-archive-record-transport", "transport summary envelope group differs", {
        path: `${errorPath}/group`,
      });
    }
    if (!["codex", "claude-code"].includes(envelope.preparedByHostId)) {
      fail("wakeflow-business-archive-record-transport", "transport summary envelope host is invalid", {
        path: `${errorPath}/preparedByHostId`,
      });
    }
    assertId(envelope.windowId, "window", `${errorPath}/windowId`);
    assertId(envelope.correlationId, "dispatch-group", `${errorPath}/correlationId`);
    assertTimestamp(envelope.createdAt, `${errorPath}/createdAt`);
    if (envelope.correlationId !== group.groupId) {
      fail("wakeflow-business-archive-record-transport", "transport summary correlation differs from group", {
        path: `${errorPath}/correlationId`,
      });
    }
    if (envelope.artifactKind === "wakeflow-target-delivery-envelope") {
      if (!envelope.packet || Object.hasOwn(envelope, "resultSetDigest") || Object.hasOwn(envelope, "reviewSnapshotDigest")) {
        fail("wakeflow-business-archive-record-transport", "target envelope summary fields are invalid", {
          path: errorPath,
        });
      }
      validateTransportTuple(envelope.packet, `${errorPath}/packet`, {
        idType: "dispatch-packet",
        collection: "packets",
        demandId,
      });
      const packet = packetsById.get(envelope.packet.id);
      if (
        !packet
        || envelope.packet.ref !== packet.ref
        || envelope.packet.digest !== packet.digest
        || packet.groupId !== group.groupId
        || packet.windowId !== envelope.windowId
      ) {
        fail("wakeflow-business-archive-record-transport", "target envelope summary packet differs", {
          path: `${errorPath}/packet`,
        });
      }
    } else if (envelope.artifactKind === "wakeflow-controller-return-envelope") {
      if (Object.hasOwn(envelope, "packet") || envelope.windowId !== group.controllerWindowId) {
        fail("wakeflow-business-archive-record-transport", "Controller-return envelope summary fields are invalid", {
          path: errorPath,
        });
      }
      assertDigest(envelope.resultSetDigest, `${errorPath}/resultSetDigest`);
      assertDigest(envelope.reviewSnapshotDigest, `${errorPath}/reviewSnapshotDigest`);
    } else {
      fail("wakeflow-business-archive-record-transport", "transport summary envelope kind is invalid", {
        path: `${errorPath}/artifactKind`,
      });
    }
  }
  assertSortedUnique(value.envelopes, "$/envelopes", (entry) => entry.ref);
  const envelopesById = new Map(value.envelopes.map((entry) => [entry.deliveryId, entry]));
  if (envelopesById.size !== value.envelopes.length) {
    fail("wakeflow-business-archive-record-transport", "transport summary envelope ID is duplicated", {
      path: "$/envelopes",
    });
  }

  const runsById = new Map();
  const runOrdinals = new Set();
  for (let index = 0; index < value.runs.length; index += 1) {
    const run = value.runs[index];
    const errorPath = `$/runs/${index}`;
    assertExactKeys(run, [
      "runId",
      "ref",
      "digest",
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
    ], ["previousRun", "observedLease", "errorCode"], errorPath);
    const runId = assertId(run.runId, "delivery-run", `${errorPath}/runId`);
    const deliveryId = assertId(run.deliveryId, "delivery", `${errorPath}/deliveryId`);
    if (run.ref !== transportRecordRef(demandId, "runs", runId)) {
      fail("wakeflow-business-archive-record-transport", "transport summary run ref is not canonical", {
        path: `${errorPath}/ref`,
      });
    }
    assertDigest(run.digest, `${errorPath}/digest`);
    if (!["codex", "claude-code"].includes(run.hostId)) {
      fail("wakeflow-business-archive-record-transport", "transport summary run host is invalid", {
        path: `${errorPath}/hostId`,
      });
    }
    assertId(run.windowId, "window", `${errorPath}/windowId`);
    assertInteger(run.attemptOrdinal, `${errorPath}/attemptOrdinal`, { minimum: 1 });
    assertMachineToken(run.hostMethod, `${errorPath}/hostMethod`);
    assertMachineToken(run.hostMode, `${errorPath}/hostMode`);
    if (!["accepted", "ambiguous", "rejected-before-send"].includes(run.transportStatus)) {
      fail("wakeflow-business-archive-record-transport", "transport summary run status is invalid", {
        path: `${errorPath}/transportStatus`,
      });
    }
    validateTransportReadback(run.readback, `${errorPath}/readback`);
    assertTimestamp(run.createdAt, `${errorPath}/createdAt`);
    const envelope = envelopesById.get(deliveryId);
    if (
      !envelope
      || run.envelopeRef !== envelope.ref
      || run.envelopeDigest !== envelope.digest
      || run.hostId !== envelope.preparedByHostId
      || run.windowId !== envelope.windowId
    ) {
      fail("wakeflow-business-archive-record-transport", "transport summary run envelope differs", {
        path: errorPath,
      });
    }
    const ordinalKey = `${deliveryId}\u0000${run.attemptOrdinal}`;
    if (runsById.has(runId) || runOrdinals.has(ordinalKey)) {
      fail("wakeflow-business-archive-record-transport", "transport summary run identity or ordinal is duplicated", {
        path: errorPath,
      });
    }
    if (run.attemptOrdinal === 1 && Object.hasOwn(run, "previousRun")) {
      fail("wakeflow-business-archive-record-transport", "first transport run cannot name a predecessor", {
        path: `${errorPath}/previousRun`,
      });
    }
    if (run.attemptOrdinal > 1) {
      assertExactKeys(run.previousRun, ["runId", "ref", "digest"], [], `${errorPath}/previousRun`);
      const previousRunId = assertId(run.previousRun.runId, "delivery-run", `${errorPath}/previousRun/runId`);
      const previous = value.runs.find((entry) => entry.runId === previousRunId);
      if (
        !previous
        || previous.deliveryId !== deliveryId
        || previous.attemptOrdinal !== run.attemptOrdinal - 1
        || run.previousRun.ref !== previous.ref
        || run.previousRun.digest !== previous.digest
      ) {
        fail("wakeflow-business-archive-record-transport", "transport summary previous-run lineage differs", {
          path: `${errorPath}/previousRun`,
        });
      }
    }
    if ((run.transportStatus === "accepted") === Object.hasOwn(run, "errorCode")) {
      fail("wakeflow-business-archive-record-transport", "transport summary error code presence differs from run status", {
        path: `${errorPath}/errorCode`,
      });
    }
    if (Object.hasOwn(run, "errorCode")) assertMachineToken(run.errorCode, `${errorPath}/errorCode`);
    if (run.transportStatus === "rejected-before-send" && (
      run.readback.status !== "unavailable"
      || run.readback.attempts !== 0
      || run.readback.evidence.length !== 0
    )) {
      fail("wakeflow-business-archive-record-transport", "rejected run summary must have unavailable zero-attempt readback", {
        path: `${errorPath}/readback`,
      });
    }
    if (run.observedLease) {
      assertExactKeys(run.observedLease, ["leaseId", "leaseRef", "leaseDigest"], [], `${errorPath}/observedLease`);
      assertId(run.observedLease.leaseId, "lease", `${errorPath}/observedLease/leaseId`);
      assertPortableRef(run.observedLease.leaseRef, `${errorPath}/observedLease/leaseRef`);
      assertDigest(run.observedLease.leaseDigest, `${errorPath}/observedLease/leaseDigest`);
    }
    runsById.set(runId, run);
    runOrdinals.add(ordinalKey);
  }
  assertSortedUnique(value.runs, "$/runs", (entry) => entry.ref);

  const entries = Object.fromEntries(["groups", "packets", "envelopes", "runs"].map((field) => [
    field,
    value[field].map(({ ref, digest }) => ({ ref, digest })),
  ]));
  const calculatedInventoryDigest = canonicalJsonDigest({ programId, demandId, entries });
  const recordCount = Object.values(entries).reduce((sum, records) => sum + records.length, 0);
  if (
    value.inventoryDigest !== calculatedInventoryDigest
    || ((value.sourceStatus === "missing" || value.sourceStatus === "empty") && recordCount !== 0)
    || (value.sourceStatus === "current" && recordCount === 0)
  ) {
    fail("wakeflow-business-archive-record-transport", "transport summary status or inventory digest differs", {
      path: "$/inventoryDigest",
    });
  }
  return frozenClone(value);
}

function validateArchivedTransportDeclaration(value, errorPath) {
  assertExactKeys(value, ["status", "inventoryDigest", "memberRefs"], [], errorPath);
  if (value.status !== "archived" || !Array.isArray(value.memberRefs) || value.memberRefs.length !== 1) {
    fail("wakeflow-business-archive-record-transport", "demand archive transport declaration must name one archived member", {
      path: errorPath,
    });
  }
  assertDigest(value.inventoryDigest, `${errorPath}/inventoryDigest`);
  const member = value.memberRefs[0];
  assertExactKeys(member, ["ref", "digest"], [], `${errorPath}/memberRefs/0`);
  if (member.ref !== "transport-summary.json") {
    fail("wakeflow-business-archive-record-transport", "transport archive member ref must be transport-summary.json", {
      path: `${errorPath}/memberRefs/0/ref`,
    });
  }
  assertDigest(member.digest, `${errorPath}/memberRefs/0/digest`);
  return value;
}

/**
 * 校验归档业务摘要及其终态、artifact、evidence、result、transport、TODO 交叉闭包。
 */
export function validateBusinessArchiveSummary(value) {
  value = canonicalRecordSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "archiveId",
    "programId",
    "demandId",
    "archivedAt",
    "conclusion",
    "terminalAdmission",
    "archiveTransition",
    "core",
    "artifacts",
    "evidence",
    "resultAuthority",
    "transport",
    "todo",
  ], [], "$");
  assertSchemaKind(value, "wakeflow-business-archive-summary");
  assertId(value.archiveId, "archive", "$/archiveId");
  assertId(value.programId, "program", "$/programId");
  assertId(value.demandId, "demand", "$/demandId");
  assertTimestamp(value.archivedAt, "$/archivedAt");
  assertHumanText(value.conclusion, "$/conclusion");
  const terminal = validateTerminalAdmission(value.terminalAdmission);
  const transition = validateArchiveTransition(value.archiveTransition, terminal);
  if (transition.createdAt !== value.archivedAt) {
    fail("wakeflow-business-archive-record-transition", "summary archivedAt must equal the archive event time", {
      path: "$/archivedAt",
    });
  }
  validateCoreEntries(value.core);
  validateArtifactEntries(value.artifacts);
  validateEvidenceEntries(value.evidence);
  const resultAuthority = validateResultAuthority(value.resultAuthority);
  if (
    resultAuthority.stateRevision !== terminal.revision
    || resultAuthority.stateDigest !== terminal.stateDigest
    || resultAuthority.eventId !== terminal.eventId
    || resultAuthority.eventDigest !== terminal.eventDigest
  ) {
    fail("wakeflow-business-archive-record-results", "result authority must bind the exact terminal state snapshot", {
      path: "$/resultAuthority",
    });
  }
  validateArchivedTransportDeclaration(value.transport, "$/transport");
  validateTodoSummary(value.todo);
  return frozenClone(value);
}

function validateTodoSnapshot(value, errorPath) {
  assertExactKeys(value, ["schemaVersion", "artifactKind", "todoId", "row", "rowDigest"], [], errorPath);
  if (value.schemaVersion !== 1 || value.artifactKind !== "wakeflow-todo-row-snapshot") {
    fail("wakeflow-business-archive-record-todo", "TODO history snapshot contract is invalid", { path: errorPath });
  }
  assertToken(value.todoId, `${errorPath}/todoId`);
  if (typeof value.row !== "string" || !value.row || !value.row.endsWith("|")) {
    fail("wakeflow-business-archive-record-todo", "TODO history row must contain exact Markdown row bytes", { path: `${errorPath}/row` });
  }
  assertDigest(value.rowDigest, `${errorPath}/rowDigest`);
  const digest = `sha256:${createHash("sha256").update(Buffer.from(value.row, "utf8")).digest("hex")}`;
  if (digest !== value.rowDigest) {
    fail("wakeflow-business-archive-record-todo", "TODO history row digest does not match its bytes", { path: `${errorPath}/rowDigest` });
  }
  return value;
}

/**
 * 校验被消费 TODO 行的精确前后字节快照与 lineage。
 */
export function validateBusinessArchiveTodoHistory(value) {
  value = canonicalRecordSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "archiveId",
    "programId",
    "demandId",
    "boardRef",
    "todoId",
    "lineageRef",
    "mount",
    "intakeRow",
    "claimedRow",
  ], [], "$");
  assertSchemaKind(value, "wakeflow-business-archive-todo-history");
  assertId(value.archiveId, "archive", "$/archiveId");
  assertId(value.programId, "program", "$/programId");
  assertId(value.demandId, "demand", "$/demandId");
  assertPortableRef(value.boardRef, "$/boardRef");
  assertToken(value.todoId, "$/todoId");
  const lineage = validateTodoLineageRef(value.lineageRef, "$/lineageRef");
  assertExactKeys(value.mount, ["demandId", "identityDigest", "stateRootRef"], [], "$/mount");
  assertId(value.mount.demandId, "demand", "$/mount/demandId");
  assertDigest(value.mount.identityDigest, "$/mount/identityDigest");
  assertPortableRef(value.mount.stateRootRef, "$/mount/stateRootRef");
  validateTodoSnapshot(value.intakeRow, "$/intakeRow");
  validateTodoSnapshot(value.claimedRow, "$/claimedRow");
  let claim;
  try {
    claim = planTodoClaim({
      content: `${EMPTY_TODO_BOARD}${value.intakeRow.row}\n`,
      todoId: value.todoId,
      expectedRow: value.intakeRow,
      mount: value.mount,
    });
  } catch (cause) {
    fail("wakeflow-business-archive-record-todo", "TODO history cannot reconstruct one strict claim", {
      path: "$",
      cause,
    });
  }
  if (
    value.mount.demandId !== value.demandId
    || value.todoId !== value.intakeRow.todoId
    || value.todoId !== value.claimedRow.todoId
    || lineage.boardRef !== value.boardRef
    || lineage.todoId !== value.todoId
    || lineage.intakeRowDigest !== value.intakeRow.rowDigest
    || canonicalJson(lineage) !== canonicalJson(claim.lineageRef)
    || canonicalJson(value.claimedRow) !== canonicalJson(claim.committed.snapshot)
  ) {
    fail("wakeflow-business-archive-record-todo", "TODO history identities do not form one exact lineage", { path: "$" });
  }
  return frozenClone(value);
}

function validateSourceTree(value) {
  assertExactKeys(value, ["directories", "files", "treeDigest"], [], "$/sourceTree");
  if (!Array.isArray(value.directories) || !Array.isArray(value.files)) {
    fail("wakeflow-business-archive-record-source-tree", "source tree inventories must be arrays", { path: "$/sourceTree" });
  }
  for (let index = 0; index < value.directories.length; index += 1) {
    const entry = value.directories[index];
    const errorPath = `$/sourceTree/directories/${index}`;
    assertExactKeys(entry, ["ref", "mode"], [], errorPath);
    assertPortableRef(entry.ref, `${errorPath}/ref`);
    if (entry.mode !== 448) {
      fail("wakeflow-business-archive-record-source-tree", "source directory mode must be 0700", { path: `${errorPath}/mode` });
    }
  }
  for (let index = 0; index < value.files.length; index += 1) {
    const entry = value.files[index];
    const errorPath = `$/sourceTree/files/${index}`;
    assertExactKeys(entry, ["ref", "mode", "byteDigest"], [], errorPath);
    assertPortableRef(entry.ref, `${errorPath}/ref`);
    if (entry.mode !== 384) {
      fail("wakeflow-business-archive-record-source-tree", "source file mode must be 0600", { path: `${errorPath}/mode` });
    }
    assertDigest(entry.byteDigest, `${errorPath}/byteDigest`);
  }
  assertSortedUnique(value.directories, "$/sourceTree/directories", (entry) => entry.ref);
  assertSortedUnique(value.files, "$/sourceTree/files", (entry) => entry.ref);
  assertDigest(value.treeDigest, "$/sourceTree/treeDigest");
  const calculated = canonicalJsonDigest({ directories: value.directories, files: value.files });
  if (calculated !== value.treeDigest) {
    fail("wakeflow-business-archive-record-source-tree", "source tree digest does not match its exact inventory", {
      path: "$/sourceTree/treeDigest",
    });
  }
  return value;
}

/**
 * 校验 archive event、archived state、ledger manifest 与全部便携成员形成同一计划。
 */
export function validateBusinessArchivePlan(value) {
  value = canonicalRecordSnapshot(value, "$/plan");
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "archiveEvent",
    "archivedState",
    "manifest",
    "businessSummary",
    "transportSummary",
    "todoHistory",
  ], [], "$/plan");
  if (value.schemaVersion !== 1 || value.artifactKind !== "wakeflow-business-archive-plan") {
    fail("wakeflow-business-archive-record-plan", "archive transaction plan contract is invalid", { path: "$/plan" });
  }
  const archiveEvent = validateControllerEventRecord(value.archiveEvent);
  const archivedState = validateDemandStateRecord(value.archivedState);
  const ledger = validateLedgerRecord(value.manifest);
  if (ledger.family !== "archive" || ledger.record.archiveKind !== "demand") {
    fail("wakeflow-business-archive-record-plan", "business archive plan must contain one demand archive manifest", {
      path: "$/plan/manifest",
    });
  }
  const summary = validateBusinessArchiveSummary(value.businessSummary);
  const transportSummary = validateBusinessArchiveTransportSummary(value.transportSummary);
  const todoHistory = value.todoHistory === null ? null : validateBusinessArchiveTodoHistory(value.todoHistory);
  if (
    archiveEvent.actor !== "controller"
    || archiveEvent.command !== "archive-demand"
    || archiveEvent.type !== "demand.archived"
    || archiveEvent.to !== "archived"
    || archiveEvent.changedArtifacts.length !== 0
    || archivedState.state !== "archived"
    || archivedState.lastEvent.eventId !== archiveEvent.eventId
    || archivedState.lastEvent.eventDigest !== canonicalJsonDigest(archiveEvent)
  ) {
    fail("wakeflow-business-archive-record-plan", "archive event and archived state do not form one exact transition", {
      path: "$/plan",
    });
  }
  for (const candidate of [ledger.record, summary, todoHistory].filter(Boolean)) {
    if (
      candidate.archiveId !== summary.archiveId
      || candidate.programId !== summary.programId
      || (Object.hasOwn(candidate, "demandId") && candidate.demandId !== summary.demandId)
    ) {
      fail("wakeflow-business-archive-record-plan", "archive plan identities do not match", { path: "$/plan" });
    }
  }
  if (
    transportSummary.programId !== summary.programId
    || transportSummary.demandId !== summary.demandId
  ) {
    fail("wakeflow-business-archive-record-plan", "transport summary identity differs from the archive", {
      path: "$/plan/transportSummary",
    });
  }
  if (
    ledger.record.source.demandId !== summary.demandId
    || ledger.record.yearMonth !== summary.archivedAt.slice(0, 7)
    || ledger.record.conclusion !== summary.conclusion
    || archiveEvent.eventId !== summary.archiveTransition.eventId
    || archiveEvent.previousRevision !== summary.archiveTransition.previousRevision
    || archiveEvent.nextRevision !== summary.archiveTransition.nextRevision
    || archiveEvent.from !== summary.archiveTransition.from
    || archiveEvent.to !== summary.archiveTransition.to
    || archiveEvent.createdAt !== summary.archiveTransition.createdAt
    || archiveEvent.reason !== summary.archiveTransition.reason
    || archiveEvent.decisionSummary !== summary.conclusion
    || canonicalJsonDigest(archiveEvent) !== summary.archiveTransition.eventDigest
    || canonicalJsonDigest(archivedState) !== summary.archiveTransition.stateDigest
    || archivedState.revision !== archiveEvent.nextRevision
    || archivedState.state !== archiveEvent.to
    || archivedState.stateReason !== archiveEvent.reason
    || archivedState.updatedAt !== archiveEvent.createdAt
  ) {
    fail("wakeflow-business-archive-record-plan", "archive manifest, summary, event, and state do not close", {
      path: "$/plan",
    });
  }
  const manifestMembers = new Map(ledger.record.members.map((entry) => [entry.path, entry]));
  const expected = new Map();
  const addExpected = (ref, digest) => {
    const prior = expected.get(ref);
    if (prior && prior !== digest) {
      fail("wakeflow-business-archive-record-closure", "one archive member ref has conflicting digests", { path: "$/plan" });
    }
    expected.set(ref, digest);
  };
  addExpected("business-summary.json", businessArchiveByteDigest(summary));
  addExpected("transport-summary.json", businessArchiveByteDigest(transportSummary));
  if (todoHistory) addExpected("todo-history.json", businessArchiveByteDigest(todoHistory));
  for (const entry of summary.core) addExpected(entry.memberRef, entry.memberDigest);
  for (const entry of summary.artifacts) addExpected(entry.memberRef, entry.memberDigest);
  for (const evidence of summary.evidence) {
    for (const member of evidence.memberRefs) addExpected(member.ref, member.digest);
  }
  if (
    expected.size !== manifestMembers.size
    || [...expected].some(([ref, digest]) => manifestMembers.get(ref)?.digest !== digest)
  ) {
    fail("wakeflow-business-archive-record-closure", "manifest members and summary portable closure differ", {
      path: "$/plan/manifest/members",
    });
  }
  if (
    manifestMembers.get("business-summary.json")?.role !== "summary"
    || manifestMembers.get("transport-summary.json")?.role !== "transport-summary"
    || summary.transport.status !== "archived"
    || summary.transport.inventoryDigest !== transportSummary.inventoryDigest
    || summary.transport.memberRefs[0]?.ref !== "transport-summary.json"
    || summary.transport.memberRefs[0]?.digest !== businessArchiveByteDigest(transportSummary)
    || ledger.record.transport.inventoryDigest !== transportSummary.inventoryDigest
    || ledger.record.transport.memberRefs[0]?.ref !== "transport-summary.json"
    || ledger.record.transport.memberRefs[0]?.digest !== businessArchiveByteDigest(transportSummary)
    || (todoHistory !== null) !== (manifestMembers.get("todo-history.json")?.role === "todo-history")
    || (todoHistory === null) !== (summary.todo === null)
  ) {
    fail("wakeflow-business-archive-record-closure", "summary and optional TODO member roles differ", {
      path: "$/plan/manifest/members",
    });
  }
  if (todoHistory && (
    summary.todo.todoId !== todoHistory.todoId
    || canonicalJson(summary.todo.lineageRef) !== canonicalJson(todoHistory.lineageRef)
    || summary.todo.intakeRowDigest !== todoHistory.intakeRow.rowDigest
    || summary.todo.claimedRowDigest !== todoHistory.claimedRow.rowDigest
    || summary.todo.memberRef !== "todo-history.json"
  )) {
    fail("wakeflow-business-archive-record-closure", "summary TODO declaration differs from the history member", {
      path: "$/plan/businessSummary/todo",
    });
  }
  return frozenClone(value);
}

/**
 * 校验可恢复事务，绑定配置快照、源树清单和不可变归档计划。
 */
export function validateBusinessArchiveTransaction(value) {
  value = canonicalRecordSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "archiveId",
    "programId",
    "demandId",
    "config",
    "sourceTree",
    "plan",
    "planDigest",
  ], [], "$");
  assertSchemaKind(value, "wakeflow-business-archive-transaction");
  assertId(value.archiveId, "archive", "$/archiveId");
  assertId(value.programId, "program", "$/programId");
  assertId(value.demandId, "demand", "$/demandId");
  assertExactKeys(value.config, ["ref", "digest", "ledgerRootRef"], [], "$/config");
  if (value.config.ref !== "wakeflow.config.json") {
    fail("wakeflow-business-archive-record-config", "archive config ref must be wakeflow.config.json", { path: "$/config/ref" });
  }
  assertDigest(value.config.digest, "$/config/digest");
  assertPortableRef(value.config.ledgerRootRef, "$/config/ledgerRootRef");
  validateSourceTree(value.sourceTree);
  const plan = validateBusinessArchivePlan(value.plan);
  assertDigest(value.planDigest, "$/planDigest");
  if (canonicalJsonDigest(plan) !== value.planDigest) {
    fail("wakeflow-business-archive-record-plan", "archive plan digest does not match its immutable plan", { path: "$/planDigest" });
  }
  if (
    plan.manifest.archiveId !== value.archiveId
    || plan.manifest.programId !== value.programId
    || plan.manifest.source.demandId !== value.demandId
  ) {
    fail("wakeflow-business-archive-record-plan", "transaction identity differs from its immutable plan", { path: "$" });
  }
  return frozenClone(value);
}

/**
 * 为四类持久归档记录生成唯一 canonical JSON 与末尾换行字节。
 */
export function businessArchiveCanonicalBytes(value) {
  const snapshot = canonicalRecordSnapshot(value);
  const validated = snapshot.artifactKind === "wakeflow-business-archive-summary"
    ? validateBusinessArchiveSummary(snapshot)
    : snapshot.artifactKind === "wakeflow-business-archive-transport-summary"
      ? validateBusinessArchiveTransportSummary(snapshot)
      : snapshot.artifactKind === "wakeflow-business-archive-todo-history"
        ? validateBusinessArchiveTodoHistory(snapshot)
        : snapshot.artifactKind === "wakeflow-business-archive-transaction"
          ? validateBusinessArchiveTransaction(snapshot)
          : fail("wakeflow-business-archive-record-kind", "unsupported business archive record kind");
  return Buffer.concat([canonicalJsonBytes(validated), Buffer.from("\n", "utf8")]);
}

/**
 * 返回记录语义对象的 domain canonical 摘要。
 */
export function businessArchiveDigest(value) {
  const snapshot = canonicalRecordSnapshot(value);
  const validated = snapshot.artifactKind === "wakeflow-business-archive-summary"
    ? validateBusinessArchiveSummary(snapshot)
    : snapshot.artifactKind === "wakeflow-business-archive-transport-summary"
      ? validateBusinessArchiveTransportSummary(snapshot)
      : snapshot.artifactKind === "wakeflow-business-archive-todo-history"
        ? validateBusinessArchiveTodoHistory(snapshot)
        : snapshot.artifactKind === "wakeflow-business-archive-transaction"
          ? validateBusinessArchiveTransaction(snapshot)
          : fail("wakeflow-business-archive-record-kind", "unsupported business archive record kind");
  return canonicalJsonDigest(validated);
}

/**
 * 返回实际持久字节的摘要，显式包含 canonical 末尾换行。
 */
export function businessArchiveByteDigest(value) {
  return `sha256:${createHash("sha256").update(businessArchiveCanonicalBytes(value)).digest("hex")}`;
}

function looksStructuralString(key, value) {
  if (PORTABLE_REF_FIELDS.has(key) || key.endsWith("Ref")) return true;
  // Controller event ID 已由 demand-core stack 作为便携的不透明事件 token 校验。
  // 其惯用拼写可能嵌入 typed ID，不能把内部 UUID 再当作自由文本误拒。
  if (key === "eventId") return true;
  if (key.endsWith("Digest") || key === "digest" || key === "byteDigest" || key === "treeDigest") {
    return DIGEST_RE.test(value);
  }
  if (key.endsWith("At") || key === "createdAt" || key === "updatedAt") return TIMESTAMP_RE.test(value);
  if (key.endsWith("Id") || key.endsWith("Ids")) return TYPED_ID_RE.test(value) || !BARE_UUID_RE.test(value);
  return STRUCTURAL_STRING_FIELDS.has(key);
}

function containsBareUuid(value) {
  for (const match of value.matchAll(BARE_UUID_GLOBAL_RE)) {
    const before = value.slice(0, match.index);
    if (!TYPED_UUID_PREFIX_RE.test(before)) return true;
  }
  return false;
}

function findingForString(value, forbiddenRoots) {
  if (CONTROL_RE.test(value) || CREDENTIAL_RE.test(value) || PRIVATE_PATH_RE.test(value)) return true;
  if (forbiddenRoots.some((root) => root && value.includes(root))) return true;
  return containsBareUuid(value) && !TYPED_ID_RE.test(value);
}

function passivePrivacyObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Buffer.isBuffer(value)) {
    fail("wakeflow-business-archive-privacy", `${label} must be one passive plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-business-archive-privacy", `${label} must be one passive plain object`);
  }
  const result = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      fail("wakeflow-business-archive-privacy", `${label} cannot contain symbol keys`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-business-archive-privacy", `${label} fields must be enumerable data properties`);
    }
    result.push([key, descriptor.value]);
  }
  return result;
}

function passivePrivacyArray(value, label) {
  if (!Array.isArray(value)) {
    fail("wakeflow-business-archive-privacy", `${label} must be one passive dense array`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor?.value;
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      fail("wakeflow-business-archive-privacy", `${label} cannot contain array authority outside dense slots`);
    }
    const index = Number(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !Number.isSafeInteger(index)
      || index >= length
      || !descriptor?.enumerable
      || !Object.hasOwn(descriptor, "value")
    ) {
      fail("wakeflow-business-archive-privacy", `${label} slots must be enumerable data properties`);
    }
    entries.push([index, descriptor.value]);
  }
  entries.sort((left, right) => left[0] - right[0]);
  if (
    !Number.isSafeInteger(length)
    || length < 0
    || entries.length !== length
    || entries.some(([index], position) => index !== position)
  ) {
    fail("wakeflow-business-archive-privacy", `${label} must be one passive dense array`);
  }
  return entries.map(([, entry]) => entry);
}

function privacyAdmissionInput(value) {
  const entries = new Map(passivePrivacyObject(value, "portable archive scan input"));
  const allowed = new Set(["values", "opaqueMembers", "forbiddenRoots"]);
  if ([...entries.keys()].some((key) => !allowed.has(key))) {
    fail("wakeflow-business-archive-privacy", "portable archive scan input has an unknown field");
  }
  return {
    values: passivePrivacyArray(
      entries.has("values") ? entries.get("values") : [],
      "portable archive values",
    ),
    opaqueMembers: passivePrivacyArray(
      entries.has("opaqueMembers") ? entries.get("opaqueMembers") : [],
      "portable archive opaque members",
    ),
    forbiddenRoots: passivePrivacyArray(
      entries.has("forbiddenRoots") ? entries.get("forbiddenRoots") : [],
      "portable archive forbidden roots",
    ),
  };
}

/**
 * 非写入式便携准入门，只返回汇总计数与不透明摘要。
 * 错误和回执都不得包含命中值、文件名、绝对路径或原始字节。
 */
export function assertBusinessArchivePortable(input = {}) {
  const { values, opaqueMembers, forbiddenRoots } = privacyAdmissionInput(input);
  if (forbiddenRoots.some((root) => typeof root !== "string")) {
    fail("wakeflow-business-archive-privacy", "portable archive forbidden roots must be strings");
  }
  let findingCount = 0;
  let scannedStringCount = 0;
  let scannedByteCount = 0;
  const opaqueRefs = [];
  const visit = (value, key = "") => {
    if (typeof value === "string") {
      scannedStringCount += 1;
      if (!looksStructuralString(key, value) && findingForString(value, forbiddenRoots)) findingCount += 1;
      return;
    }
    if (value === null || Buffer.isBuffer(value)) return;
    if (Array.isArray(value)) {
      for (const entry of passivePrivacyArray(value, "portable archive nested array")) visit(entry, key);
      return;
    }
    if (typeof value !== "object") {
      if (!["number", "boolean"].includes(typeof value) || (typeof value === "number" && !Number.isFinite(value))) {
        fail("wakeflow-business-archive-privacy", "portable archive values must contain passive JSON data");
      }
      return;
    }
    for (const [childKey, child] of passivePrivacyObject(value, "portable archive nested object")) {
      visit(child, childKey);
    }
  };
  for (const value of values) visit(value);
  for (let index = 0; index < opaqueMembers.length; index += 1) {
    const memberEntries = new Map(passivePrivacyObject(
      opaqueMembers[index],
      "portable archive opaque member",
    ));
    if (
      memberEntries.size !== 2
      || !memberEntries.has("ref")
      || !memberEntries.has("bytes")
      || typeof memberEntries.get("ref") !== "string"
      || !Buffer.isBuffer(memberEntries.get("bytes"))
    ) {
      fail("wakeflow-business-archive-privacy", "portable opaque member scan input is invalid");
    }
    const ref = memberEntries.get("ref");
    const bytes = Buffer.from(memberEntries.get("bytes"));
    scannedByteCount += bytes.length;
    const text = bytes.toString("latin1");
    if (findingForString(text, forbiddenRoots)) {
      findingCount += 1;
      opaqueRefs.push(`sha256:${createHash("sha256").update(ref).digest("hex")}`);
    }
  }
  if (findingCount > 0) {
    fail("wakeflow-business-archive-privacy", "portable archive admission rejected unsafe content", {
      details: {
        findingCount,
        opaqueRefHashes: Object.freeze(opaqueRefs.sort(lexicalCompare)),
      },
    });
  }
  return deepFreeze({
    schemaVersion: 1,
    disposition: "passed",
    findingCount: 0,
    scannedStringCount,
    scannedByteCount,
  });
}
