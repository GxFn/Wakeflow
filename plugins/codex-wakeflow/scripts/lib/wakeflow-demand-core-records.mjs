/**
 * Wakeflow 需求核心记录与状态事务编解码器。
 *
 * 这里负责五类 portable core record 的纯数据准入、跨记录闭包、状态增量约束，
 * 以及持锁后的物理文件读取。它不决定业务动作是否应该发生，也不执行宿主操作；
 * lifecycle、delivery、review、Pod 与 business archive 仍由各自 service 拥有。
 */

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonBytes,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { resolveLedgerMemberReference } from "./wakeflow-ledger-records.mjs";
import { sha256Bytes } from "./wakeflow-atomic-write.mjs";
import {
  demandArtifactContractForKind,
  demandArtifactIdentity,
  validateDemandArtifactWriteIntent,
} from "./wakeflow-demand-artifact-records.mjs";
import {
  evidenceIdentity,
  validateEvidenceWriteIntent,
} from "./wakeflow-evidence-records.mjs";
import { withStateRootLock } from "./wakeflow-state-lock.mjs";
import { assertWindowBindingId } from "./wakeflow-window-binding-records.mjs";

export const WAKEFLOW_DEMAND_CORE_SCHEMA_VERSION = 1;
export const WAKEFLOW_DEMAND_FILE = "demand.json";
export const WAKEFLOW_DEMAND_AUTHORITY_FILE = "demand-authority.json";
export const WAKEFLOW_DEMAND_STATE_FILE = "wakeflow-state.json";

const MAX_DEMAND_CORE_FILE_BYTES = 64 * 1024 * 1024;
export const WAKEFLOW_DEMAND_EVENTS_FILE = "controller-events.jsonl";
export const WAKEFLOW_DEMAND_TRANSACTIONS_DIRECTORY = "transactions";
export const WAKEFLOW_DEMAND_STATE_TRANSITION_FILE = "state-transition.json";
export const WAKEFLOW_DEMAND_ARCHIVE_TRANSACTION_FILE = "archive.json";

export const WAKEFLOW_DEMAND_TYPES = Object.freeze([
  "requirement",
  "bug",
  "supplement",
  "research",
]);

export const WAKEFLOW_DEMAND_STATES = Object.freeze([
  "intake",
  "planned",
  "dispatched",
  "waiting-results",
  "review-ready",
  "needs-rework",
  "blocked",
  "cancelled",
  "completed",
  "archived",
]);

export const WAKEFLOW_DEMAND_AUTHORITY_ENTRY_MODES = Object.freeze([
  "design-delivery",
  "controller-inline",
  "pod-design",
]);

export const WAKEFLOW_DEMAND_TEST_MODES = Object.freeze([
  "controller-only",
  "real-environment",
  "not-applicable",
]);

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const TOKEN_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const HUMAN_CONTROL_RE = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const LEDGER_SOURCE_KIND = "wakeflow-demand-ledger-source";
const TODO_LINEAGE_KIND = "wakeflow-todo-lineage-ref";
const TODO_BOARD_REF = ".wakeflow-active/current/global-todo-board.md";
const TODO_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LEASE_ID_RE = /^lease_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MEMBER_REF_KIND = "wakeflow-ledger-member-ref";
const MEMBER_REF_FAMILIES = new Set(["requirement", "confirmation"]);
const AUTHORITY_ROLES = new Set([
  "original-plan",
  "requirement-design",
  "code-facts",
  "landing-plan",
  "non-goals",
  "user-confirmation",
  "reproduction",
  "scope",
  "requirement-delta",
  "research-question",
  "boundaries",
  "test-environment",
]);
const LEDGER_MEMBER_ROLES = new Set([
  ...AUTHORITY_ROLES,
  "goal-stage-decision",
  "supporting-evidence",
]);
const REQUIREMENT_MEMBER_ROLES = new Set([
  "original-plan",
  "requirement-design",
  "code-facts",
  "landing-plan",
  "non-goals",
  "user-confirmation",
  "reproduction",
  "scope",
  "requirement-delta",
  "research-question",
  "boundaries",
  "test-environment",
  "supporting-evidence",
]);
const CONFIRMATION_MEMBER_ROLES = new Set([
  "goal-stage-decision",
  "user-confirmation",
  "requirement-delta",
  "supporting-evidence",
]);
const PLACEMENT_AUTHORITY_ROLES = new Set([
  "goal-stage-decision",
  "user-confirmation",
]);
const REQUIRED_AUTHORITY_ROLES = Object.freeze({
  requirement: Object.freeze([
    "original-plan",
    "requirement-design",
    "code-facts",
    "landing-plan",
    "non-goals",
    "user-confirmation",
  ]),
  bug: Object.freeze(["reproduction", "scope", "non-goals"]),
  supplement: Object.freeze(["requirement-design", "requirement-delta", "user-confirmation"]),
  research: Object.freeze(["research-question", "boundaries"]),
});
const DEMAND_STATE_SET = new Set(WAKEFLOW_DEMAND_STATES);
const DEMAND_TYPE_SET = new Set(WAKEFLOW_DEMAND_TYPES);
const ENTRY_MODE_SET = new Set(WAKEFLOW_DEMAND_AUTHORITY_ENTRY_MODES);
const TEST_MODE_SET = new Set(WAKEFLOW_DEMAND_TEST_MODES);
const CHANGED_ARTIFACT_CONTRACTS = Object.freeze({
  "wakeflow-demand": WAKEFLOW_DEMAND_FILE,
  "wakeflow-demand-authority": WAKEFLOW_DEMAND_AUTHORITY_FILE,
});
const TASK_PACKAGE_LIFECYCLE_SET = new Set(["active", "closed", "superseded"]);
const TARGET_TASK_LIFECYCLE_SET = new Set([
  "accepted",
  "blocked",
  "cancelled",
  "dispatched",
  "needs-rework",
  "planned",
  "review-ready",
  "superseded",
  "waiting-result",
]);
const TARGET_RESULT_LIFECYCLE_SET = new Set(["current", "historical"]);
const TEST_CARD_LIFECYCLE_SET = new Set(["active", "closed", "superseded"]);
const REVIEW_STATUS_SET = new Set(["idle", "pending"]);
const DELIVERY_PHASE_SET = new Set([
  "prepared",
  "send-claimed",
  "accepted",
  "rejected-before-send",
  "ambiguous",
]);
const DELIVERY_RUN_STATUS_SET = new Set([
  "accepted",
  "rejected-before-send",
  "ambiguous",
]);
const DELIVERY_READBACK_STATUS_SET = new Set([
  "confirmed",
  "pending",
  "unavailable",
]);
const TEST_ATTEMPT_MODE_SET = new Set(["initial", "resume", "restart"]);
const DELIVERY_EVENT_CONTRACTS = Object.freeze({
  "prepare-target-delivery": Object.freeze({
    type: "target-delivery.prepared",
    fromPhases: new Set([null, "accepted", "rejected-before-send", "ambiguous"]),
    toPhases: new Set(["prepared"]),
    run: "forbidden",
  }),
  "claim-target-delivery-send": Object.freeze({
    type: "target-delivery.send-claimed",
    fromPhases: new Set(["prepared"]),
    toPhases: new Set(["send-claimed"]),
    run: "forbidden",
  }),
  "record-target-delivery-run": Object.freeze({
    type: "target-delivery.run-recorded",
    fromPhases: new Set(["send-claimed"]),
    toPhases: new Set(["accepted", "rejected-before-send", "ambiguous"]),
    run: "required",
  }),
  "rearm-target-delivery": Object.freeze({
    type: "target-delivery.rearmed",
    fromPhases: new Set(["rejected-before-send"]),
    toPhases: new Set(["prepared"]),
    run: "required",
  }),
});
const DELIVERY_COMMAND_SET = new Set(Object.keys(DELIVERY_EVENT_CONTRACTS));
const REVIEW_DECISION_EVENT_TYPES = Object.freeze({
  accept: "review.accepted",
  blocked: "review.blocked",
  redesign: "review.redesign-requested",
  rework: "review.rework-requested",
});
const REVIEW_DECISION_COMMAND = "decide-review-candidate";
const LIFECYCLE_EVENT_CONTRACTS = Object.freeze({
  "complete-demand": Object.freeze({ action: "complete", type: "demand.completed", to: "completed" }),
  "cancel-demand": Object.freeze({ action: "cancel", type: "demand.cancelled", to: "cancelled" }),
});
const LIFECYCLE_COMMAND_SET = new Set(Object.keys(LIFECYCLE_EVENT_CONTRACTS));
const TERMINAL_DEMAND_STATE_SET = new Set(["completed", "cancelled"]);
const ARCHIVE_COMMAND = "archive-demand";
const POD_EVENT_CONTRACTS = Object.freeze({
  "initialize-pod": Object.freeze({ action: "initialize", type: "pod.initialized", selector: null }),
  "add-pod-members": Object.freeze({ action: "add-members", type: "pod.members-added", selector: null }),
  "record-pod-design-request": Object.freeze({
    action: "record-design-request",
    type: "pod.design-request-recorded",
    selector: "design-request",
    artifactKind: "wakeflow-pod-design-request",
  }),
  "record-pod-design-handoff": Object.freeze({
    action: "record-design-handoff",
    type: "pod.design-handoff-recorded",
    selector: "design-handoff",
    artifactKind: "wakeflow-pod-design-handoff",
  }),
  "bind-pod-window": Object.freeze({ action: "bind-window", type: "pod.window-bound", selector: "window" }),
  "plan-pod-test-access": Object.freeze({ action: "plan-test-access", type: "pod.test-access-planned", selector: "probe" }),
  "record-pod-test-access": Object.freeze({ action: "settle-test-access", type: "pod.test-access-recorded", selector: "probe" }),
  "retry-pod-test-access": Object.freeze({ action: "retry-test-access", type: "pod.test-access-retry-planned", selector: "probe" }),
  "plan-pod-close": Object.freeze({ action: "plan-close", type: "pod.close-planned", selector: "close" }),
  "record-pod-close": Object.freeze({ action: "settle-close", type: "pod.close-recorded", selector: "close" }),
});
const POD_COMMAND_SET = new Set(Object.keys(POD_EVENT_CONTRACTS));
const POD_PHASE_SET = new Set([
  "reserved",
  "creating-control",
  "control-ready",
  "designing",
  "creating-products",
  "execution-ready",
  "retryable",
  "blocked",
  "cancelling",
  "closing",
  "closed",
]);
const POD_ROLE_SET = new Set(["controller", "design", "test", "product"]);
const POD_WINDOW_STATUS_SET = new Set(["planned", "bound", "closing", "closed"]);
const POD_RESOURCE_CLAIM_SET = new Set(["reserved", "active", "retained", "unknown", "released"]);
const POD_TEST_ACCESS_STATUS_SET = new Set(["pending", "validated", "blocked"]);
const POD_TEST_BLOCK_REASON_SET = new Set([
  "capability-unsupported",
  "git-identity-mismatch",
  "observer-identity-mismatch",
  "probe-execution-failed",
  "root-unreadable",
]);
const POD_HOST_ID_RE = /^[a-z][a-z0-9-]{0,63}$/u;
const POD_LAUNCH_ID_RE = /^pod-launch_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POD_MATERIALIZATION_EVENT_ID_RE = /^pod-materialization-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POD_TEST_PROBE_ID_RE = /^pod-test-probe_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POD_CLOSE_ID_RE = /^pod-close_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ARTIFACT_STATE_KEYS = Object.freeze([
  "taskPackages",
  "targetTasks",
  "targetResults",
  "testCards",
  "evidence",
  "review",
]);
const CORE_ATOMIC_STAGE_PREFIXES = Object.freeze([
  WAKEFLOW_DEMAND_FILE,
  WAKEFLOW_DEMAND_AUTHORITY_FILE,
  WAKEFLOW_DEMAND_STATE_FILE,
  WAKEFLOW_DEMAND_EVENTS_FILE,
].map((file) => `.${file}.wakeflow-stage-`));

export class WakeflowDemandCoreError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowDemandCoreError";
    this.code = code;
    this.path = errorPath;
    this.details = details;
  }
}

function fail(code, errorPath, message, details = {}, cause = undefined) {
  throw new WakeflowDemandCoreError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
    cause,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  // Byte-bearing internal readers return defensive Buffer copies. ArrayBuffer
  // views cannot be frozen in Node.js; freezing their containing records still
  // prevents reference replacement while callers retain a disposable copy.
  if (ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalClone(value) {
  return JSON.parse(canonicalJson(value));
}

// 所有公开 codec 都先取得无行为的 canonical 快照，校验过程绝不执行调用方 getter。
function canonicalDataSnapshot(value, errorPath = "$") {
  try {
    return canonicalClone(value);
  } catch (cause) {
    fail(
      "wakeflow-demand-core-data",
      errorPath,
      "demand core input must be canonical plain data without accessors, symbols, hidden fields, or cycles",
      { causeCode: cause?.code ?? null },
      cause,
    );
  }
}

function frozenClone(value) {
  return deepFreeze(canonicalClone(value));
}

function assertPlainObject(value, errorPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-demand-core-type", errorPath, "demand core value must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-demand-core-type", errorPath, "demand core value must be a plain object");
  }
  return value;
}

function assertExactKeys(value, required, optional, errorPath) {
  assertPlainObject(value, errorPath);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("wakeflow-demand-core-unknown-field", `${errorPath}/${key}`, `unknown demand core field ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-demand-core-required-field", `${errorPath}/${key}`, `missing required demand core field ${key}`);
    }
  }
}

function assertSchemaAndKind(value, artifactKind, errorPath = "$") {
  if (value.schemaVersion !== WAKEFLOW_DEMAND_CORE_SCHEMA_VERSION) {
    fail(
      "wakeflow-demand-core-schema-version",
      `${errorPath}/schemaVersion`,
      `demand core schemaVersion must be ${WAKEFLOW_DEMAND_CORE_SCHEMA_VERSION}`,
    );
  }
  if (value.artifactKind !== artifactKind) {
    fail(
      "wakeflow-demand-core-artifact-kind",
      `${errorPath}/artifactKind`,
      `demand core artifactKind must be ${artifactKind}`,
    );
  }
}

function assertToken(value, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || TOKEN_CONTROL_RE.test(value)
  ) {
    fail(
      "wakeflow-demand-core-token",
      errorPath,
      "demand core token must be non-empty, single-line, control-free, and already trimmed",
    );
  }
  return value;
}

function assertHumanText(value, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || HUMAN_CONTROL_RE.test(value)
  ) {
    fail(
      "wakeflow-demand-core-text",
      errorPath,
      "demand core human text must be non-empty, control-free except line breaks, and already trimmed",
    );
  }
  return value;
}

function assertTimestamp(value, errorPath) {
  const match = typeof value === "string" ? value.match(TIMESTAMP_RE) : null;
  if (!match) {
    fail("wakeflow-demand-core-timestamp", errorPath, "demand core timestamp must be a UTC RFC3339 value");
  }
  const [, year, month, day, hour, minute, second] = match;
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
    fail("wakeflow-demand-core-timestamp", errorPath, "demand core timestamp must name a real UTC RFC3339 calendar instant");
  }
  return value;
}

function assertDigest(value, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-demand-core-digest", errorPath, "demand core digest must be sha256:<64 lowercase hex>");
  }
  return value;
}

function assertRevision(value, errorPath, { positive = false } = {}) {
  const minimum = positive ? 1 : 0;
  if (!Number.isInteger(value) || value < minimum) {
    fail(
      "wakeflow-demand-core-revision",
      errorPath,
      `demand core revision must be an integer greater than or equal to ${minimum}`,
    );
  }
  return value;
}

function assertPortableRef(value, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\\")
    || TOKEN_CONTROL_RE.test(value)
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("//")
    || /^[A-Za-z]:/u.test(value)
  ) {
    fail("wakeflow-demand-core-ref", errorPath, "demand core ref must be a canonical portable relative path");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("wakeflow-demand-core-ref", errorPath, "demand core ref cannot contain dot segments");
  }
  if (path.posix.normalize(value) !== value) {
    fail("wakeflow-demand-core-ref", errorPath, "demand core ref must already be normalized");
  }
  return value;
}

function assertWakeflowTypedId(value, type, errorPath) {
  try {
    assertWakeflowId(value, type, errorPath);
  } catch (cause) {
    fail("wakeflow-demand-core-id", errorPath, `demand core ${type} ID is invalid`, {}, cause);
  }
  return value;
}

function assertDemandState(value, errorPath, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!DEMAND_STATE_SET.has(value)) {
    fail(
      "wakeflow-demand-core-state",
      errorPath,
      `demand state must be one of: ${WAKEFLOW_DEMAND_STATES.join(", ")}`,
    );
  }
  return value;
}

function validateTodoLineage(value, errorPath) {
  assertExactKeys(
    value,
    ["artifactKind", "schemaVersion", "boardRef", "todoId", "intakeRowDigest"],
    [],
    errorPath,
  );
  if (
    value.artifactKind !== TODO_LINEAGE_KIND
    || value.schemaVersion !== WAKEFLOW_DEMAND_CORE_SCHEMA_VERSION
    || value.boardRef !== TODO_BOARD_REF
  ) {
    fail("wakeflow-demand-core-source", errorPath, "TODO source must preserve the exact T02 lineage contract");
  }
  if (typeof value.todoId !== "string" || !TODO_ID_RE.test(value.todoId)) {
    fail("wakeflow-demand-core-source", `${errorPath}/todoId`, "TODO source must preserve the exact T02 opaque portable ID");
  }
  assertDigest(value.intakeRowDigest, `${errorPath}/intakeRowDigest`);
  return frozenClone(value);
}

function validateLedgerMemberRef(value, errorPath, {
  ledgerRoot = null,
  expectedProgramId = null,
  expectedDemandId = null,
  allowedRoles = LEDGER_MEMBER_ROLES,
} = {}) {
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "family",
    "recordId",
    "recordRef",
    "recordDigest",
    "memberRef",
    "memberDigest",
    "role",
  ], [], errorPath);
  if (value.schemaVersion !== 1 || value.artifactKind !== MEMBER_REF_KIND) {
    fail("wakeflow-demand-core-ledger-ref", errorPath, "authority ref must use the exact T01 member-ref contract");
  }
  if (!MEMBER_REF_FAMILIES.has(value.family)) {
    fail("wakeflow-demand-core-ledger-ref", `${errorPath}/family`, "demand authority may reference requirement or confirmation records only");
  }
  assertWakeflowTypedId(value.recordId, value.family, `${errorPath}/recordId`);
  const recordRef = assertPortableRef(value.recordRef, `${errorPath}/recordRef`);
  const memberRef = assertPortableRef(value.memberRef, `${errorPath}/memberRef`);
  if (path.posix.basename(recordRef) !== "record.json") {
    fail("wakeflow-demand-core-ledger-ref", `${errorPath}/recordRef`, "T01 requirement/confirmation recordRef must end in record.json");
  }
  const recordRoot = path.posix.dirname(recordRef);
  if (!memberRef.startsWith(`${recordRoot}/`) || memberRef === recordRef) {
    fail("wakeflow-demand-core-ledger-ref", `${errorPath}/memberRef`, "memberRef must stay inside its immutable ledger record root");
  }
  assertDigest(value.recordDigest, `${errorPath}/recordDigest`);
  assertDigest(value.memberDigest, `${errorPath}/memberDigest`);
  const familyRoles = value.family === "requirement" ? REQUIREMENT_MEMBER_ROLES : CONFIRMATION_MEMBER_ROLES;
  if (!familyRoles.has(value.role) || !LEDGER_MEMBER_ROLES.has(value.role) || !allowedRoles.has(value.role)) {
    fail("wakeflow-demand-core-authority-role", `${errorPath}/role`, `unsupported ledger member role ${String(value.role)} for this demand field`);
  }
  if (ledgerRoot !== null) {
    let resolved;
    try {
      resolved = resolveLedgerMemberReference({
        ledgerRoot,
        reference: value,
        expectedFamily: value.family,
        expectedRole: value.role,
        expectedProgramId,
      });
    } catch (cause) {
      fail(
        "wakeflow-demand-core-ledger-ref-unresolved",
        errorPath,
        "authority ref does not resolve to the exact T01 ledger member",
        {},
        cause,
      );
    }
    if (
      value.family === "confirmation"
      && expectedDemandId !== null
      && resolved.record.record.demandId !== expectedDemandId
    ) {
      fail(
        "wakeflow-demand-core-confirmation-demand",
        errorPath,
        `confirmation authority belongs to ${resolved.record.record.demandId}, not ${expectedDemandId}`,
      );
    }
  }
  return frozenClone(value);
}

function assertUniqueLedgerRefs(refs, errorPath) {
  const keys = refs.map((entry) => `${entry.family}\u0000${entry.recordRef}\u0000${entry.memberRef}\u0000${entry.role}`);
  if (new Set(keys).size !== keys.length) {
    fail("wakeflow-demand-core-ledger-ref-duplicate", errorPath, "ledger member references must be unique");
  }
  const sorted = [...keys].sort();
  if (keys.some((key, index) => key !== sorted[index])) {
    fail("wakeflow-demand-core-ledger-ref-order", errorPath, "ledger member references must be lexically sorted");
  }
}

function validateDemandSource(value, {
  ledgerRoot = null,
  expectedProgramId,
} = {}) {
  assertPlainObject(value, "$/source");
  if (value.artifactKind === TODO_LINEAGE_KIND) return validateTodoLineage(value, "$/source");
  if (value.artifactKind !== LEDGER_SOURCE_KIND) {
    fail(
      "wakeflow-demand-core-source",
      "$/source/artifactKind",
      "demand source must be the exact TODO lineage or a strict T01 ledger source",
    );
  }
  assertExactKeys(value, ["schemaVersion", "artifactKind", "memberRefs"], [], "$/source");
  if (value.schemaVersion !== WAKEFLOW_DEMAND_CORE_SCHEMA_VERSION) {
    fail("wakeflow-demand-core-source", "$/source/schemaVersion", "unsupported demand ledger source version");
  }
  if (!Array.isArray(value.memberRefs) || value.memberRefs.length === 0) {
    fail("wakeflow-demand-core-source", "$/source/memberRefs", "demand ledger source requires at least one exact member ref");
  }
  const refs = value.memberRefs.map((entry, index) => validateLedgerMemberRef(
    entry,
    `$/source/memberRefs/${index}`,
    { ledgerRoot, expectedProgramId },
  ));
  assertUniqueLedgerRefs(refs, "$/source/memberRefs");
  return frozenClone({
    schemaVersion: WAKEFLOW_DEMAND_CORE_SCHEMA_VERSION,
    artifactKind: LEDGER_SOURCE_KIND,
    memberRefs: refs,
  });
}

function validateExecutionPlacement(value, {
  ledgerRoot = null,
  expectedProgramId,
  expectedDemandId,
} = {}) {
  assertPlainObject(value, "$/executionPlacement");
  if (value.mode === "main") {
    assertExactKeys(value, ["mode"], [], "$/executionPlacement");
    return frozenClone(value);
  }
  if (value.mode === "isolated") {
    assertExactKeys(value, ["mode", "authorizationRef"], [], "$/executionPlacement");
    validateLedgerMemberRef(value.authorizationRef, "$/executionPlacement/authorizationRef", {
      ledgerRoot,
      expectedProgramId,
      expectedDemandId,
      allowedRoles: PLACEMENT_AUTHORITY_ROLES,
    });
    return frozenClone(value);
  }
  fail(
    "wakeflow-demand-core-placement",
    "$/executionPlacement/mode",
    "execution placement mode must be main or isolated",
  );
}

/** 校验不可变 demand identity，并在有 ledgerRoot 时解析其来源与隔离授权。 */
export function validateDemandRecord(value, { ledgerRoot = null } = {}) {
  value = canonicalDataSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "createdAt",
    "title",
    "goal",
    "completionDefinition",
    "demandType",
    "source",
    "executionPlacement",
  ], [], "$");
  assertSchemaAndKind(value, "wakeflow-demand");
  assertWakeflowTypedId(value.programId, "program", "$/programId");
  assertWakeflowTypedId(value.demandId, "demand", "$/demandId");
  assertTimestamp(value.createdAt, "$/createdAt");
  assertHumanText(value.title, "$/title");
  assertHumanText(value.goal, "$/goal");
  assertHumanText(value.completionDefinition, "$/completionDefinition");
  if (!DEMAND_TYPE_SET.has(value.demandType)) {
    fail("wakeflow-demand-core-demand-type", "$/demandType", `unsupported demandType ${String(value.demandType)}`);
  }
  validateDemandSource(value.source, { ledgerRoot, expectedProgramId: value.programId });
  validateExecutionPlacement(value.executionPlacement, {
    ledgerRoot,
    expectedProgramId: value.programId,
    expectedDemandId: value.demandId,
  });
  return frozenClone(value);
}

function validateTestDecision(value, {
  demand = null,
  authorityRefs,
} = {}) {
  assertExactKeys(value, ["mode", "summary"], ["environmentSpecRef"], "$/testDecision");
  if (!TEST_MODE_SET.has(value.mode)) {
    fail("wakeflow-demand-core-test-mode", "$/testDecision/mode", `unsupported test decision mode ${String(value.mode)}`);
  }
  assertHumanText(value.summary, "$/testDecision/summary");
  const environmentRefs = authorityRefs.filter((entry) => entry.role === "test-environment");
  if (value.mode === "real-environment") {
    if (!Object.hasOwn(value, "environmentSpecRef")) {
      fail("wakeflow-demand-core-test-environment", "$/testDecision/environmentSpecRef", "real-environment testing requires an exact test-environment memberRef");
    }
    assertPortableRef(value.environmentSpecRef, "$/testDecision/environmentSpecRef");
    if (environmentRefs.length !== 1 || environmentRefs[0].memberRef !== value.environmentSpecRef) {
      fail(
        "wakeflow-demand-core-test-environment",
        "$/testDecision/environmentSpecRef",
        "environmentSpecRef must match the unique digest-bearing test-environment authority member",
      );
    }
  } else if (Object.hasOwn(value, "environmentSpecRef")) {
    fail(
      "wakeflow-demand-core-test-environment",
      "$/testDecision/environmentSpecRef",
      "environmentSpecRef is valid only for real-environment testing",
    );
  }
  if (demand?.demandType === "research" && value.mode !== "not-applicable") {
    fail("wakeflow-demand-core-test-mode", "$/testDecision/mode", "research authority requires not-applicable testing");
  }
  if (demand && demand.demandType !== "research" && value.mode === "not-applicable") {
    fail("wakeflow-demand-core-test-mode", "$/testDecision/mode", `${demand.demandType} authority requires an applicable testing decision`);
  }
  return frozenClone(value);
}

/** 校验一次冻结的需求 authority；它只引用 ledger 成员，不复制需求正文。 */
export function validateDemandAuthorityRecord(value, {
  demand = null,
  ledgerRoot = null,
} = {}) {
  value = canonicalDataSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "demandId",
    "demandRef",
    "demandDigest",
    "entryMode",
    "authorityRefs",
    "testDecision",
  ], [], "$");
  assertSchemaAndKind(value, "wakeflow-demand-authority");
  assertWakeflowTypedId(value.demandId, "demand", "$/demandId");
  if (value.demandRef !== WAKEFLOW_DEMAND_FILE) {
    fail("wakeflow-demand-core-authority-ref", "$/demandRef", `demandRef must be ${WAKEFLOW_DEMAND_FILE}`);
  }
  assertDigest(value.demandDigest, "$/demandDigest");
  if (!ENTRY_MODE_SET.has(value.entryMode)) {
    fail("wakeflow-demand-core-entry-mode", "$/entryMode", `unsupported authority entryMode ${String(value.entryMode)}`);
  }
  if (!Array.isArray(value.authorityRefs) || value.authorityRefs.length === 0) {
    fail("wakeflow-demand-core-authority-refs", "$/authorityRefs", "authorityRefs must be a non-empty array");
  }
  if (demand !== null) {
    demand = validateDemandRecord(demand, { ledgerRoot });
    if (value.demandId !== demand.demandId || value.demandDigest !== canonicalJsonDigest(demand)) {
      fail("wakeflow-demand-core-authority-demand", "$/demandId", "authority must reference the exact immutable demand record");
    }
  }
  if (ledgerRoot !== null && demand === null) {
    fail("wakeflow-demand-core-ledger-ref-unresolved", "$ledgerRoot", "resolving authority refs requires the owning demand record");
  }
  const authorityRefs = value.authorityRefs.map((entry, index) => validateLedgerMemberRef(
    entry,
    `$/authorityRefs/${index}`,
    {
      ledgerRoot,
      expectedProgramId: demand?.programId ?? null,
      expectedDemandId: demand?.demandId ?? null,
      allowedRoles: AUTHORITY_ROLES,
    },
  ));
  assertUniqueLedgerRefs(authorityRefs, "$/authorityRefs");
  if (demand) {
    const roles = new Set(authorityRefs.map((entry) => entry.role));
    for (const role of REQUIRED_AUTHORITY_ROLES[demand.demandType]) {
      if (!roles.has(role)) {
        fail(
          "wakeflow-demand-core-authority-role",
          "$/authorityRefs",
          `${demand.demandType} authority requires role=${role}`,
        );
      }
    }
  }
  validateTestDecision(value.testDecision, { demand, authorityRefs });
  return frozenClone(value);
}

function validateLastEvent(value) {
  assertExactKeys(value, ["eventId", "eventDigest"], [], "$/lastEvent");
  assertToken(value.eventId, "$/lastEvent/eventId");
  assertDigest(value.eventDigest, "$/lastEvent/eventDigest");
  return frozenClone(value);
}

function assertLifecycle(value, allowed, errorPath, label) {
  if (!allowed.has(value)) {
    fail(
      "wakeflow-demand-core-artifact-lifecycle",
      errorPath,
      `${label} must be one of: ${[...allowed].join(", ")}`,
    );
  }
  return value;
}

function assertCanonicalIdOrder(entries, idField, errorPath) {
  const ids = entries.map((entry) => entry[idField]);
  if (new Set(ids).size !== ids.length) {
    fail("wakeflow-demand-core-artifact-state", errorPath, `${idField} values must be unique`);
  }
  const sorted = [...ids].sort((left, right) => left.localeCompare(right));
  if (ids.some((id, index) => id !== sorted[index])) {
    fail("wakeflow-demand-core-artifact-state", errorPath, `${idField} entries must use lexical order`);
  }
}

function validateArtifactStateTuple(value, errorPath, {
  artifactKind,
  idField,
  idType,
  lifecycleSet,
}) {
  assertExactKeys(value, [idField, "ref", "digest", "lifecycleStatus"], [], errorPath);
  assertWakeflowTypedId(value[idField], idType, `${errorPath}/${idField}`);
  assertPortableRef(value.ref, `${errorPath}/ref`);
  assertDigest(value.digest, `${errorPath}/digest`);
  assertLifecycle(value.lifecycleStatus, lifecycleSet, `${errorPath}/lifecycleStatus`, `${artifactKind} lifecycleStatus`);
  const contract = demandArtifactContractForKind(artifactKind);
  const expectedRef = contract.ref({ [idField]: value[idField] });
  if (value.ref !== expectedRef) {
    fail("wakeflow-demand-core-artifact-state", `${errorPath}/ref`, `${artifactKind} state ref must be ${expectedRef}`);
  }
  return value;
}

function validateCurrentResultTuple(value, errorPath, targetTaskId) {
  assertExactKeys(value, ["targetResultId", "ref", "digest"], [], errorPath);
  assertWakeflowTypedId(value.targetResultId, "target-result", `${errorPath}/targetResultId`);
  const expectedRef = `target-results/${targetTaskId}/${value.targetResultId}.json`;
  if (value.ref !== expectedRef) {
    fail("wakeflow-demand-core-artifact-state", `${errorPath}/ref`, `current result ref must be ${expectedRef}`);
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateTestCardTuple(value, errorPath) {
  assertExactKeys(value, ["testCardId", "ref", "digest"], [], errorPath);
  assertWakeflowTypedId(value.testCardId, "test-card", `${errorPath}/testCardId`);
  const expectedRef = `test-cards/${value.testCardId}.json`;
  if (value.ref !== expectedRef) {
    fail("wakeflow-demand-core-artifact-state", `${errorPath}/ref`, `Test card ref must be ${expectedRef}`);
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateEvidenceStateTuple(value, errorPath) {
  assertExactKeys(value, ["evidenceId", "ref", "digest"], [], errorPath);
  assertWakeflowTypedId(value.evidenceId, "evidence", `${errorPath}/evidenceId`);
  const expectedRef = `evidence/${value.evidenceId}/evidence.json`;
  if (value.ref !== expectedRef) {
    fail("wakeflow-demand-core-artifact-state", `${errorPath}/ref`, `evidence manifest ref must be ${expectedRef}`);
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateEventAuthority(value, errorPath) {
  assertExactKeys(value, ["revision", "eventId", "eventDigest"], [], errorPath);
  assertRevision(value.revision, `${errorPath}/revision`, { positive: true });
  assertToken(value.eventId, `${errorPath}/eventId`);
  assertDigest(value.eventDigest, `${errorPath}/eventDigest`);
  return value;
}

function validateDeliverySourceState(value, errorPath) {
  assertExactKeys(
    value,
    ["revision", "stateDigest", "eventId", "eventDigest"],
    [],
    errorPath,
  );
  assertRevision(value.revision, `${errorPath}/revision`, { positive: true });
  assertDigest(value.stateDigest, `${errorPath}/stateDigest`);
  assertToken(value.eventId, `${errorPath}/eventId`);
  assertDigest(value.eventDigest, `${errorPath}/eventDigest`);
  return value;
}

function validateDispatchGroupTuple(value, errorPath, demandId) {
  assertExactKeys(value, ["groupId", "ref", "digest"], [], errorPath);
  assertWakeflowTypedId(value.groupId, "dispatch-group", `${errorPath}/groupId`);
  const expectedRef = `.wakeflow-local/runtime/shared/transport/demands/${demandId}`
    + `/groups/${value.groupId}.json`;
  if (value.ref !== expectedRef) {
    fail(
      "wakeflow-demand-core-delivery-ref",
      `${errorPath}/ref`,
      `dispatch group ref must be ${expectedRef}`,
    );
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateDispatchPacketTuple(value, errorPath, demandId) {
  assertExactKeys(value, ["packetId", "ref", "digest"], [], errorPath);
  assertWakeflowTypedId(value.packetId, "dispatch-packet", `${errorPath}/packetId`);
  const expectedRef = `.wakeflow-local/runtime/shared/transport/demands/${demandId}`
    + `/packets/${value.packetId}.json`;
  if (value.ref !== expectedRef) {
    fail(
      "wakeflow-demand-core-delivery-ref",
      `${errorPath}/ref`,
      `dispatch packet ref must be ${expectedRef}`,
    );
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateDeliveryEnvelopeTuple(value, errorPath, demandId) {
  assertExactKeys(value, ["deliveryId", "ref", "digest"], [], errorPath);
  assertWakeflowTypedId(value.deliveryId, "delivery", `${errorPath}/deliveryId`);
  const expectedRef = `.wakeflow-local/runtime/shared/transport/demands/${demandId}`
    + `/envelopes/${value.deliveryId}.json`;
  if (value.ref !== expectedRef) {
    fail(
      "wakeflow-demand-core-delivery-ref",
      `${errorPath}/ref`,
      `delivery envelope ref must be ${expectedRef}`,
    );
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateDeliveryRunTuple(value, errorPath, demandId) {
  assertExactKeys(value, [
    "runId",
    "ref",
    "digest",
    "attemptOrdinal",
    "transportStatus",
    "readbackStatus",
  ], [], errorPath);
  assertWakeflowTypedId(value.runId, "delivery-run", `${errorPath}/runId`);
  const expectedRef = `.wakeflow-local/runtime/shared/transport/demands/${demandId}`
    + `/runs/${value.runId}.json`;
  if (value.ref !== expectedRef) {
    fail(
      "wakeflow-demand-core-delivery-ref",
      `${errorPath}/ref`,
      `delivery run ref must be ${expectedRef}`,
    );
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  assertRevision(value.attemptOrdinal, `${errorPath}/attemptOrdinal`, { positive: true });
  assertLifecycle(
    value.transportStatus,
    DELIVERY_RUN_STATUS_SET,
    `${errorPath}/transportStatus`,
    "delivery run transportStatus",
  );
  assertLifecycle(
    value.readbackStatus,
    DELIVERY_READBACK_STATUS_SET,
    `${errorPath}/readbackStatus`,
    "delivery run readbackStatus",
  );
  return value;
}

function validateCoordinationLeaseTuple(value, errorPath, windowId) {
  assertExactKeys(value, ["leaseId", "ref", "digest"], [], errorPath);
  if (typeof value.leaseId !== "string" || !LEASE_ID_RE.test(value.leaseId)) {
    fail(
      "wakeflow-demand-core-delivery-lease",
      `${errorPath}/leaseId`,
      "coordination lease ID must match lease_<lowercase UUID v4>",
    );
  }
  const expectedRef = ".wakeflow-local/runtime/shared/coordination/window-leases/"
    + `${windowId}.json`;
  if (value.ref !== expectedRef) {
    fail(
      "wakeflow-demand-core-delivery-ref",
      `${errorPath}/ref`,
      `coordination lease ref must be ${expectedRef}`,
    );
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateRestartAuthorization(value, errorPath) {
  assertExactKeys(value, ["conditionIndex", "condition", "reason"], [], errorPath);
  assertRevision(value.conditionIndex, `${errorPath}/conditionIndex`);
  assertHumanText(value.condition, `${errorPath}/condition`);
  assertHumanText(value.reason, `${errorPath}/reason`);
  if (value.reason.length > 1024) {
    fail(
      "wakeflow-demand-core-test-attempt",
      `${errorPath}/reason`,
      "Test restart reason must contain at most 1024 characters",
    );
  }
  return value;
}

function sameTransportTuple(left, right, idField) {
  return left[idField] === right[idField]
    && left.ref === right.ref
    && left.digest === right.digest;
}

function validateTestAttempts(value, errorPath, { demandId, targetTaskId, testCard }) {
  if (!Array.isArray(value) || value.length > 10) {
    fail(
      "wakeflow-demand-core-test-attempt",
      errorPath,
      "Test attempt lineage must be an array with at most ten entries",
    );
  }
  const attemptIds = new Set();
  const deliveryIds = new Set();
  const priorAttemptGroupIds = new Set();
  const priorAttemptPacketIds = new Set();
  let previous = null;
  for (const [index, attempt] of value.entries()) {
    const itemPath = `${errorPath}/${index}`;
    assertExactKeys(attempt, [
      "testAttemptId",
      "ordinal",
      "mode",
      "testCard",
      "deliveryAuthorizations",
    ], ["previousAttemptId", "previousResult", "restart"], itemPath);
    assertWakeflowTypedId(attempt.testAttemptId, "test-attempt", `${itemPath}/testAttemptId`);
    if (attemptIds.has(attempt.testAttemptId)) {
      fail(
        "wakeflow-demand-core-test-attempt",
        `${itemPath}/testAttemptId`,
        "Test attempt identities must be unique",
      );
    }
    attemptIds.add(attempt.testAttemptId);
    if (attempt.ordinal !== index + 1) {
      fail(
        "wakeflow-demand-core-test-attempt",
        `${itemPath}/ordinal`,
        "Test attempt ordinals must be contiguous and begin at one",
      );
    }
    assertLifecycle(
      attempt.mode,
      TEST_ATTEMPT_MODE_SET,
      `${itemPath}/mode`,
      "Test attempt mode",
    );
    validateTestCardTuple(attempt.testCard, `${itemPath}/testCard`);
    if (canonicalJson(attempt.testCard) !== canonicalJson(testCard)) {
      fail(
        "wakeflow-demand-core-test-attempt",
        `${itemPath}/testCard`,
        "Test attempt must retain the target task's exact TestCard tuple",
      );
    }
    if (!Array.isArray(attempt.deliveryAuthorizations) || attempt.deliveryAuthorizations.length === 0) {
      fail(
        "wakeflow-demand-core-test-attempt",
        `${itemPath}/deliveryAuthorizations`,
        "each logical Test attempt requires at least one delivery authorization",
      );
    }
    let previousAuthorization = null;
    const currentAttemptGroupIds = new Set();
    const currentAttemptPacketIds = new Set();
    for (const [authorizationIndex, authorization] of attempt.deliveryAuthorizations.entries()) {
      const authorizationPath = `${itemPath}/deliveryAuthorizations/${authorizationIndex}`;
      assertExactKeys(authorization, [
        "ordinal",
        "group",
        "packet",
        "envelope",
        "authorizedBy",
      ], ["replacesRun"], authorizationPath);
      if (authorization.ordinal !== authorizationIndex + 1) {
        fail(
          "wakeflow-demand-core-test-attempt",
          `${authorizationPath}/ordinal`,
          "Test delivery authorization ordinals must be contiguous and begin at one",
        );
      }
      validateDispatchGroupTuple(authorization.group, `${authorizationPath}/group`, demandId);
      validateDispatchPacketTuple(authorization.packet, `${authorizationPath}/packet`, demandId);
      validateDeliveryEnvelopeTuple(authorization.envelope, `${authorizationPath}/envelope`, demandId);
      validateEventAuthority(authorization.authorizedBy, `${authorizationPath}/authorizedBy`);
      if (
        priorAttemptGroupIds.has(authorization.group.groupId)
        || priorAttemptPacketIds.has(authorization.packet.packetId)
      ) {
        fail(
          "wakeflow-demand-core-test-attempt",
          authorizationPath,
          "a later logical Test attempt cannot reuse a dispatch group or packet from any earlier attempt",
        );
      }
      currentAttemptGroupIds.add(authorization.group.groupId);
      currentAttemptPacketIds.add(authorization.packet.packetId);
      if (deliveryIds.has(authorization.envelope.deliveryId)) {
        fail(
          "wakeflow-demand-core-test-attempt",
          `${authorizationPath}/envelope/deliveryId`,
          "one immutable envelope can appear in only one Test delivery authorization",
        );
      }
      deliveryIds.add(authorization.envelope.deliveryId);
      if (previousAuthorization === null) {
        if (Object.hasOwn(authorization, "replacesRun")) {
          fail(
            "wakeflow-demand-core-test-attempt",
            `${authorizationPath}/replacesRun`,
            "the first delivery authorization in one logical attempt cannot replace a run",
          );
        }
      } else {
        if (!Object.hasOwn(authorization, "replacesRun")) {
          fail(
            "wakeflow-demand-core-test-attempt",
            `${authorizationPath}/replacesRun`,
            "replacement Test delivery authorization requires the exact rejected run",
          );
        }
        validateDeliveryRunTuple(
          authorization.replacesRun,
          `${authorizationPath}/replacesRun`,
          demandId,
        );
        if (
          authorization.replacesRun.transportStatus !== "rejected-before-send"
          || authorization.authorizedBy.revision <= previousAuthorization.authorizedBy.revision
        ) {
          fail(
            "wakeflow-demand-core-test-attempt",
            authorizationPath,
            "replacement Test delivery authorization must follow a rejected-before-send run at a later revision",
          );
        }
      }
      previousAuthorization = authorization;
    }
    if (previous === null) {
      if (
        attempt.mode !== "initial"
        || Object.hasOwn(attempt, "previousAttemptId")
        || Object.hasOwn(attempt, "previousResult")
        || Object.hasOwn(attempt, "restart")
      ) {
        fail(
          "wakeflow-demand-core-test-attempt",
          itemPath,
          "the first Test attempt must be initial and omit previous/restart lineage",
        );
      }
    } else {
      if (
        attempt.mode === "initial"
        || attempt.previousAttemptId !== previous.testAttemptId
        || !Object.hasOwn(attempt, "previousResult")
      ) {
        fail(
          "wakeflow-demand-core-test-attempt",
          itemPath,
          "a later Test attempt must reference the immediately preceding attempt and result",
        );
      }
      validateCurrentResultTuple(
        attempt.previousResult,
        `${itemPath}/previousResult`,
        targetTaskId,
      );
      const firstAuthorization = attempt.deliveryAuthorizations[0];
      const previousLastAuthorization = previous.deliveryAuthorizations.at(-1);
      if (firstAuthorization.authorizedBy.revision <= previousLastAuthorization.authorizedBy.revision) {
        fail(
          "wakeflow-demand-core-test-attempt",
          `${itemPath}/deliveryAuthorizations/0/authorizedBy/revision`,
          "Test attempt authorization revisions must increase",
        );
      }
      if (attempt.mode === "restart") {
        if (!Object.hasOwn(attempt, "restart")) {
          fail(
            "wakeflow-demand-core-test-attempt",
            `${itemPath}/restart`,
            "restart Test attempt requires exact restart authorization",
          );
        }
        validateRestartAuthorization(attempt.restart, `${itemPath}/restart`);
      } else if (Object.hasOwn(attempt, "restart")) {
        fail(
          "wakeflow-demand-core-test-attempt",
          `${itemPath}/restart`,
          "only restart Test attempts may carry restart authorization",
        );
      }
    }
    for (const groupId of currentAttemptGroupIds) priorAttemptGroupIds.add(groupId);
    for (const packetId of currentAttemptPacketIds) priorAttemptPacketIds.add(packetId);
    previous = attempt;
  }
  return value;
}

function validateCurrentDelivery(value, errorPath, { demandId, windowId, stateRevision }) {
  assertExactKeys(value, [
    "sourceState",
    "group",
    "packet",
    "envelope",
    "lease",
    "phase",
    "sendGeneration",
    "preparedBy",
    "authorizedBy",
  ], [
    "claimedBy",
    "recordedBy",
    "rearmedFrom",
    "latestRun",
    "testAttemptId",
  ], errorPath);
  validateDeliverySourceState(value.sourceState, `${errorPath}/sourceState`);
  validateDispatchGroupTuple(value.group, `${errorPath}/group`, demandId);
  validateDispatchPacketTuple(value.packet, `${errorPath}/packet`, demandId);
  validateDeliveryEnvelopeTuple(value.envelope, `${errorPath}/envelope`, demandId);
  validateCoordinationLeaseTuple(value.lease, `${errorPath}/lease`, windowId);
  assertLifecycle(value.phase, DELIVERY_PHASE_SET, `${errorPath}/phase`, "delivery phase");
  assertRevision(value.sendGeneration, `${errorPath}/sendGeneration`, { positive: true });
  validateEventAuthority(value.preparedBy, `${errorPath}/preparedBy`);
  validateEventAuthority(value.authorizedBy, `${errorPath}/authorizedBy`);
  if (value.sourceState.revision >= value.preparedBy.revision) {
    fail(
      "wakeflow-demand-core-delivery-event",
      `${errorPath}/preparedBy/revision`,
      "delivery preparation must advance beyond its source state revision",
    );
  }
  if (value.authorizedBy.revision < value.preparedBy.revision) {
    fail(
      "wakeflow-demand-core-delivery-event",
      `${errorPath}/authorizedBy/revision`,
      "current send authorization cannot precede delivery preparation",
    );
  }
  for (const [field, pointer] of [
    ["preparedBy", value.preparedBy],
    ["authorizedBy", value.authorizedBy],
    ["claimedBy", value.claimedBy],
    ["recordedBy", value.recordedBy],
  ]) {
    if (pointer && pointer.revision > stateRevision) {
      fail(
        "wakeflow-demand-core-delivery-event",
        `${errorPath}/${field}/revision`,
        "delivery event pointer cannot be newer than its containing state revision",
      );
    }
  }
  if (
    value.sendGeneration === 1
    && canonicalJson(value.preparedBy) !== canonicalJson(value.authorizedBy)
  ) {
    fail(
      "wakeflow-demand-core-delivery-event",
      `${errorPath}/authorizedBy`,
      "generation-one delivery preparation and authorization must name the same exact event",
    );
  }
  if (
    value.sendGeneration > 1
    && value.authorizedBy.revision <= value.preparedBy.revision
  ) {
    fail(
      "wakeflow-demand-core-delivery-event",
      `${errorPath}/authorizedBy/revision`,
      "rearmed delivery authorization must follow its original preparation event",
    );
  }
  const hasClaim = Object.hasOwn(value, "claimedBy");
  const hasRecord = Object.hasOwn(value, "recordedBy");
  const hasRun = Object.hasOwn(value, "latestRun");
  if (hasClaim) validateEventAuthority(value.claimedBy, `${errorPath}/claimedBy`);
  if (hasRecord) validateEventAuthority(value.recordedBy, `${errorPath}/recordedBy`);
  if (hasRun) validateDeliveryRunTuple(value.latestRun, `${errorPath}/latestRun`, demandId);
  if (Object.hasOwn(value, "rearmedFrom")) {
    validateDeliveryRunTuple(value.rearmedFrom, `${errorPath}/rearmedFrom`, demandId);
    if (value.rearmedFrom.transportStatus !== "rejected-before-send") {
      fail(
        "wakeflow-demand-core-delivery-rearm",
        `${errorPath}/rearmedFrom/transportStatus`,
        "delivery rearm must bind one rejected-before-send run",
      );
    }
    if (value.rearmedFrom.readbackStatus !== "unavailable") {
      fail(
        "wakeflow-demand-core-delivery-rearm",
        `${errorPath}/rearmedFrom/readbackStatus`,
        "delivery rearm requires a rejected run with unavailable readback",
      );
    }
    if (value.rearmedFrom.attemptOrdinal !== value.sendGeneration - 1) {
      fail(
        "wakeflow-demand-core-delivery-rearm",
        `${errorPath}/rearmedFrom/attemptOrdinal`,
        "rearm lineage must name the immediately preceding send generation",
      );
    }
  }
  if (value.sendGeneration === 1 && Object.hasOwn(value, "rearmedFrom")) {
    fail(
      "wakeflow-demand-core-delivery-rearm",
      `${errorPath}/rearmedFrom`,
      "initial send generation cannot be rearmed",
    );
  }
  if (value.sendGeneration > 1 && !Object.hasOwn(value, "rearmedFrom")) {
    fail(
      "wakeflow-demand-core-delivery-rearm",
      `${errorPath}/rearmedFrom`,
      "later send generation requires exact rejected run lineage",
    );
  }
  if (value.phase === "prepared") {
    if (hasClaim || hasRecord || hasRun) {
      fail(
        "wakeflow-demand-core-delivery-phase",
        errorPath,
        "prepared delivery cannot already contain claim or run settlement",
      );
    }
  } else if (value.phase === "send-claimed") {
    if (!hasClaim || hasRecord || hasRun) {
      fail(
        "wakeflow-demand-core-delivery-phase",
        errorPath,
        "send-claimed delivery requires one claim and no recorded run",
      );
    }
  } else {
    if (!hasClaim || !hasRecord || !hasRun || value.latestRun.transportStatus !== value.phase) {
      fail(
        "wakeflow-demand-core-delivery-phase",
        errorPath,
        "settled delivery phase must equal its exact recorded run verdict",
      );
    }
    if (value.latestRun.attemptOrdinal !== value.sendGeneration) {
      fail(
        "wakeflow-demand-core-delivery-phase",
        `${errorPath}/latestRun/attemptOrdinal`,
        "latest delivery run ordinal must equal current send generation",
      );
    }
    if (
      value.phase === "rejected-before-send"
      && value.latestRun.readbackStatus !== "unavailable"
    ) {
      fail(
        "wakeflow-demand-core-delivery-phase",
        `${errorPath}/latestRun/readbackStatus`,
        "rejected-before-send summary requires unavailable readback",
      );
    }
  }
  if (hasClaim && value.claimedBy.revision <= value.authorizedBy.revision) {
    fail(
      "wakeflow-demand-core-delivery-event",
      `${errorPath}/claimedBy/revision`,
      "delivery claim cannot precede current send authorization",
    );
  }
  if (hasRecord && value.recordedBy.revision <= value.claimedBy.revision) {
    fail(
      "wakeflow-demand-core-delivery-event",
      `${errorPath}/recordedBy/revision`,
      "delivery run settlement cannot precede its claim",
    );
  }
  if (Object.hasOwn(value, "testAttemptId")) {
    assertWakeflowTypedId(value.testAttemptId, "test-attempt", `${errorPath}/testAttemptId`);
  }
  return value;
}

function validateTargetTaskState(value, errorPath, demandId, stateRevision) {
  assertExactKeys(value, [
    "targetTaskId",
    "taskPackageId",
    "windowId",
    "lifecycleStatus",
  ], [
    "repositoryId",
    "currentResult",
    "testCard",
    "currentDelivery",
    "testAttempts",
  ], errorPath);
  assertWakeflowTypedId(value.targetTaskId, "target-task", `${errorPath}/targetTaskId`);
  assertWakeflowTypedId(value.taskPackageId, "task-package", `${errorPath}/taskPackageId`);
  assertWakeflowTypedId(value.windowId, "window", `${errorPath}/windowId`);
  if (Object.hasOwn(value, "repositoryId")) {
    assertWakeflowTypedId(value.repositoryId, "repository", `${errorPath}/repositoryId`);
  }
  assertLifecycle(
    value.lifecycleStatus,
    TARGET_TASK_LIFECYCLE_SET,
    `${errorPath}/lifecycleStatus`,
    "target task lifecycleStatus",
  );
  if (Object.hasOwn(value, "currentResult")) {
    validateCurrentResultTuple(value.currentResult, `${errorPath}/currentResult`, value.targetTaskId);
  }
  const hasTestCard = Object.hasOwn(value, "testCard");
  const hasTestAttempts = Object.hasOwn(value, "testAttempts");
  if (hasTestCard) validateTestCardTuple(value.testCard, `${errorPath}/testCard`);
  if (hasTestCard !== hasTestAttempts) {
    fail(
      "wakeflow-demand-core-test-attempt",
      errorPath,
      "TestCard tuple and Test attempt lineage must appear together",
    );
  }
  if (hasTestAttempts) {
    validateTestAttempts(value.testAttempts, `${errorPath}/testAttempts`, {
      demandId,
      targetTaskId: value.targetTaskId,
      testCard: value.testCard,
    });
  }
  if (Object.hasOwn(value, "currentDelivery")) {
    validateCurrentDelivery(value.currentDelivery, `${errorPath}/currentDelivery`, {
      demandId,
      windowId: value.windowId,
      stateRevision,
    });
    if (hasTestCard) {
      const latestAttempt = value.testAttempts.at(-1) ?? null;
      const latestAuthorization = latestAttempt?.deliveryAuthorizations.at(-1) ?? null;
      if (
        !latestAttempt
        || !latestAuthorization
        || value.currentDelivery.testAttemptId !== latestAttempt.testAttemptId
        || !sameTransportTuple(value.currentDelivery.group, latestAuthorization.group, "groupId")
        || !sameTransportTuple(value.currentDelivery.packet, latestAuthorization.packet, "packetId")
        || !sameTransportTuple(value.currentDelivery.envelope, latestAuthorization.envelope, "deliveryId")
      ) {
        fail(
          "wakeflow-demand-core-test-attempt",
          `${errorPath}/currentDelivery`,
          "current Test delivery must select the latest exact logical Test attempt",
        );
      }
    } else if (Object.hasOwn(value.currentDelivery, "testAttemptId")) {
      fail(
        "wakeflow-demand-core-test-attempt",
        `${errorPath}/currentDelivery/testAttemptId`,
        "non-Test delivery cannot name a logical Test attempt",
      );
    }
  }
  if (hasTestAttempts && value.testAttempts.length > 0 && !Object.hasOwn(value, "currentDelivery")) {
    fail(
      "wakeflow-demand-core-test-attempt",
      `${errorPath}/testAttempts`,
      "non-empty Test attempt lineage requires its selected currentDelivery summary",
    );
  }
  return value;
}

function validateTargetResultState(value, errorPath) {
  assertExactKeys(value, [
    "targetResultId",
    "targetTaskId",
    "ref",
    "digest",
    "lifecycleStatus",
  ], [], errorPath);
  assertWakeflowTypedId(value.targetResultId, "target-result", `${errorPath}/targetResultId`);
  assertWakeflowTypedId(value.targetTaskId, "target-task", `${errorPath}/targetTaskId`);
  const expectedRef = `target-results/${value.targetTaskId}/${value.targetResultId}.json`;
  if (value.ref !== expectedRef) {
    fail("wakeflow-demand-core-artifact-state", `${errorPath}/ref`, `target result state ref must be ${expectedRef}`);
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  assertLifecycle(
    value.lifecycleStatus,
    TARGET_RESULT_LIFECYCLE_SET,
    `${errorPath}/lifecycleStatus`,
    "target result lifecycleStatus",
  );
  return value;
}

function validatePendingCandidate(value, errorPath) {
  assertExactKeys(value, ["reviewCandidateId", "ref", "digest"], [], errorPath);
  assertWakeflowTypedId(value.reviewCandidateId, "review-candidate", `${errorPath}/reviewCandidateId`);
  const expectedRef = `review-candidates/${value.reviewCandidateId}.json`;
  if (value.ref !== expectedRef) {
    fail("wakeflow-demand-core-artifact-state", `${errorPath}/ref`, `pending review candidate ref must be ${expectedRef}`);
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateCanonicalTargetTaskIds(value, errorPath) {
  if (!Array.isArray(value)) {
    fail("wakeflow-demand-core-artifact-state", errorPath, "target task set must be an array");
  }
  value.forEach((id, index) => assertWakeflowTypedId(id, "target-task", `${errorPath}/${index}`));
  if (new Set(value).size !== value.length) {
    fail("wakeflow-demand-core-artifact-state", errorPath, "target task set must be unique");
  }
  const sorted = [...value].sort((left, right) => left.localeCompare(right));
  if (value.some((id, index) => id !== sorted[index])) {
    fail("wakeflow-demand-core-artifact-state", errorPath, "target task set must use lexical order");
  }
  return value;
}

function validateReviewState(value, errorPath) {
  assertExactKeys(value, [
    "status",
    "readyTargetTaskIds",
    "blockedTargetTaskIds",
    "missingTargetTaskIds",
  ], ["pendingCandidate"], errorPath);
  assertLifecycle(value.status, REVIEW_STATUS_SET, `${errorPath}/status`, "review status");
  const ready = validateCanonicalTargetTaskIds(value.readyTargetTaskIds, `${errorPath}/readyTargetTaskIds`);
  const blocked = validateCanonicalTargetTaskIds(value.blockedTargetTaskIds, `${errorPath}/blockedTargetTaskIds`);
  const missing = validateCanonicalTargetTaskIds(value.missingTargetTaskIds, `${errorPath}/missingTargetTaskIds`);
  const all = [...ready, ...blocked, ...missing];
  if (new Set(all).size !== all.length) {
    fail("wakeflow-demand-core-artifact-state", errorPath, "review ready/blocked/missing sets must be disjoint");
  }
  const hasCandidate = Object.hasOwn(value, "pendingCandidate");
  if ((value.status === "pending") !== hasCandidate) {
    fail("wakeflow-demand-core-artifact-state", errorPath, "review status=pending and pendingCandidate must appear together");
  }
  if (value.status === "idle" && all.length !== 0) {
    fail(
      "wakeflow-demand-core-artifact-state",
      errorPath,
      "idle review state cannot retain ready, blocked, or missing task classifications",
    );
  }
  if (hasCandidate) validatePendingCandidate(value.pendingCandidate, `${errorPath}/pendingCandidate`);
  return value;
}

function assertPodDomainId(value, pattern, errorPath, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail("wakeflow-demand-core-pod-state", errorPath, `${label} must be one typed opaque Pod ID`);
  }
  return value;
}

function assertPodBindingId(value, errorPath) {
  try {
    return assertWindowBindingId(value, errorPath);
  } catch (cause) {
    fail(
      "wakeflow-demand-core-pod-state",
      errorPath,
      "Pod member bindingId must use the exact window identity binding ID contract",
      {},
      cause,
    );
  }
}

function validatePodEvidenceTuple(value, errorPath, expectedRef) {
  assertExactKeys(value, ["ref", "digest"], [], errorPath);
  if (value.ref !== expectedRef) {
    fail("wakeflow-demand-core-pod-ref", `${errorPath}/ref`, `Pod evidence ref must be ${expectedRef}`);
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validatePodDesignArtifactTuple(value, errorPath, kind) {
  const contract = demandArtifactContractForKind(kind);
  const idField = contract?.idField;
  if (!contract || !idField) {
    fail("wakeflow-demand-core-pod-state", errorPath, "Pod Design artifact contract is unavailable");
  }
  assertExactKeys(value, [idField, "ref", "digest"], [], errorPath);
  assertWakeflowTypedId(value[idField], contract.idType, `${errorPath}/${idField}`);
  const expectedRef = contract.ref({ [idField]: value[idField] });
  if (value.ref !== expectedRef) {
    fail("wakeflow-demand-core-pod-ref", `${errorPath}/ref`, `Pod Design artifact ref must be ${expectedRef}`);
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validatePodMaterializationTuple(value, errorPath, { root, launchOperationId }) {
  assertExactKeys(value, ["eventId", "ref", "digest"], [], errorPath);
  assertPodDomainId(
    value.eventId,
    POD_MATERIALIZATION_EVENT_ID_RE,
    `${errorPath}/eventId`,
    "materialization event ID",
  );
  const expectedRef = `${root}/materialization/${launchOperationId}/events/${value.eventId}.json`;
  if (value.ref !== expectedRef) {
    fail("wakeflow-demand-core-pod-ref", `${errorPath}/ref`, `Pod materialization ref must be ${expectedRef}`);
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validatePodCloseTuple(value, errorPath, { root, windowId }) {
  assertExactKeys(value, ["closeOperationId", "intent"], ["receipt"], errorPath);
  assertPodDomainId(value.closeOperationId, POD_CLOSE_ID_RE, `${errorPath}/closeOperationId`, "close operation ID");
  const closeRoot = `${root}/close/${value.closeOperationId}`;
  validatePodEvidenceTuple(value.intent, `${errorPath}/intent`, `${closeRoot}/intent.json`);
  if (Object.hasOwn(value, "receipt")) {
    validatePodEvidenceTuple(value.receipt, `${errorPath}/receipt`, `${closeRoot}/receipt.json`);
  }
  if (!windowId) {
    fail("wakeflow-demand-core-pod-state", errorPath, "Pod close tuple requires its owning stable windowId");
  }
  return value;
}

function validatePodWindowState(value, errorPath, { root }) {
  assertExactKeys(value, [
    "windowId",
    "role",
    "launchOperationId",
    "bindingId",
    "launchIntent",
    "status",
  ], [
    "repositoryId",
    "materializationFinalEvent",
    "identityBindingDigest",
    "creationReceipt",
    "close",
    "resourceClaimStatus",
  ], errorPath);
  assertWakeflowTypedId(value.windowId, "window", `${errorPath}/windowId`);
  if (!POD_ROLE_SET.has(value.role)) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/role`, "Pod member role is unsupported");
  }
  assertPodDomainId(
    value.launchOperationId,
    POD_LAUNCH_ID_RE,
    `${errorPath}/launchOperationId`,
    "launch operation ID",
  );
  assertPodBindingId(value.bindingId, `${errorPath}/bindingId`);
  validatePodEvidenceTuple(
    value.launchIntent,
    `${errorPath}/launchIntent`,
    `${root}/launch-intents/${value.launchOperationId}.json`,
  );
  if (!POD_WINDOW_STATUS_SET.has(value.status)) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/status`, "Pod member logical status is unsupported");
  }

  const isProduct = value.role === "product";
  if (isProduct !== Object.hasOwn(value, "repositoryId")) {
    fail(
      "wakeflow-demand-core-pod-state",
      errorPath,
      "product Pod member and repositoryId must appear together",
    );
  }
  if (isProduct) {
    assertWakeflowTypedId(value.repositoryId, "repository", `${errorPath}/repositoryId`);
    if (!POD_RESOURCE_CLAIM_SET.has(value.resourceClaimStatus)) {
      fail("wakeflow-demand-core-pod-state", `${errorPath}/resourceClaimStatus`, "product resource claim status is unsupported");
    }
  } else if (Object.hasOwn(value, "resourceClaimStatus")) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/resourceClaimStatus`, "control Pod members do not own product resource claims");
  }

  const boundFields = ["materializationFinalEvent", "identityBindingDigest", "creationReceipt"];
  const boundFieldCount = boundFields.filter((field) => Object.hasOwn(value, field)).length;
  if (![0, boundFields.length].includes(boundFieldCount)) {
    fail("wakeflow-demand-core-pod-state", errorPath, "Pod materialization, identity, and creation receipt tuples must appear atomically");
  }
  if (boundFieldCount === boundFields.length) {
    validatePodMaterializationTuple(
      value.materializationFinalEvent,
      `${errorPath}/materializationFinalEvent`,
      { root, launchOperationId: value.launchOperationId },
    );
    assertDigest(value.identityBindingDigest, `${errorPath}/identityBindingDigest`);
    validatePodEvidenceTuple(
      value.creationReceipt,
      `${errorPath}/creationReceipt`,
      `${root}/bindings/${value.windowId}/creation-receipt.json`,
    );
  }

  const hasClose = Object.hasOwn(value, "close");
  if (hasClose) validatePodCloseTuple(value.close, `${errorPath}/close`, { root, windowId: value.windowId });
  if (value.status === "planned") {
    if (boundFieldCount !== 0 || hasClose || (isProduct && value.resourceClaimStatus !== "reserved")) {
      fail("wakeflow-demand-core-pod-state", errorPath, "planned Pod member may contain only its reserved product claim and launch intent");
    }
  } else if (value.status === "bound") {
    if (boundFieldCount !== boundFields.length || hasClose || (isProduct && value.resourceClaimStatus !== "active")) {
      fail("wakeflow-demand-core-pod-state", errorPath, "bound Pod member requires exact finalized/identity/creation authority and active product claim");
    }
  } else if (value.status === "closing") {
    if (!hasClose || Object.hasOwn(value.close, "receipt")) {
      fail("wakeflow-demand-core-pod-state", errorPath, "closing Pod member requires one receipt-free close intent");
    }
    if (isProduct) {
      const expectedClaim = boundFieldCount === boundFields.length ? "active" : "reserved";
      if (value.resourceClaimStatus !== expectedClaim) {
        fail("wakeflow-demand-core-pod-state", `${errorPath}/resourceClaimStatus`, "closing product must retain its pre-close resource claim");
      }
    }
  } else if (value.status === "closed") {
    if (!hasClose || !Object.hasOwn(value.close, "receipt")) {
      fail("wakeflow-demand-core-pod-state", errorPath, "closed Pod member requires its exact close intent and receipt");
    }
    if (isProduct && !["released", "retained", "unknown"].includes(value.resourceClaimStatus)) {
      fail("wakeflow-demand-core-pod-state", `${errorPath}/resourceClaimStatus`, "closed product claim must be released, retained, or unknown");
    }
  }
  return value;
}

function podBindingSetProjection(pod) {
  const observer = pod.windows.find((entry) => entry.role === "test");
  const targets = pod.windows.filter((entry) => entry.role === "product");
  if (
    !observer
    || !observer.identityBindingDigest
    || !observer.creationReceipt
    || targets.some((entry) => !entry.identityBindingDigest || !entry.creationReceipt)
  ) return null;
  return {
    observer: {
      windowId: observer.windowId,
      bindingId: observer.bindingId,
      identityBindingDigest: observer.identityBindingDigest,
      creationReceiptDigest: observer.creationReceipt.digest,
    },
    targets: targets.map((target) => ({
      windowId: target.windowId,
      repositoryId: target.repositoryId,
      bindingId: target.bindingId,
      identityBindingDigest: target.identityBindingDigest,
      creationReceiptDigest: target.creationReceipt.digest,
    })),
  };
}

function validatePodTestAccessState(value, errorPath, { root, pod }) {
  const baseFields = [
    "probeId",
    "attempt",
    "status",
    "bindingSetDigest",
    "productBindingCount",
    "plan",
    "plannedAt",
  ];
  const optional = value?.status === "pending"
    ? ["previousProbeId"]
    : value?.status === "validated"
      ? ["previousProbeId", "receipt", "capability", "observedAt", "recordedAt"]
      : ["previousProbeId", "receipt", "reasonCode", "observedAt", "recordedAt"];
  assertExactKeys(value, baseFields, optional, errorPath);
  assertPodDomainId(value.probeId, POD_TEST_PROBE_ID_RE, `${errorPath}/probeId`, "Test access probe ID");
  assertRevision(value.attempt, `${errorPath}/attempt`, { positive: true });
  if (value.attempt > 32) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/attempt`, "Pod Test access attempt exceeds the bounded limit");
  }
  const hasPrevious = Object.hasOwn(value, "previousProbeId");
  if ((value.attempt > 1) !== hasPrevious) {
    fail("wakeflow-demand-core-pod-state", errorPath, "Pod Test retry attempt and previousProbeId must appear together");
  }
  if (hasPrevious) {
    assertPodDomainId(value.previousProbeId, POD_TEST_PROBE_ID_RE, `${errorPath}/previousProbeId`, "previous Test access probe ID");
    if (value.previousProbeId === value.probeId) {
      fail("wakeflow-demand-core-pod-state", `${errorPath}/previousProbeId`, "Pod Test access retry cannot reference itself");
    }
  }
  if (!POD_TEST_ACCESS_STATUS_SET.has(value.status)) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/status`, "Pod Test access status is unsupported");
  }
  assertDigest(value.bindingSetDigest, `${errorPath}/bindingSetDigest`);
  if (!Number.isInteger(value.productBindingCount) || value.productBindingCount < 1) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/productBindingCount`, "Pod Test access requires at least one product binding");
  }
  const products = pod.windows.filter((entry) => entry.role === "product");
  if (value.productBindingCount !== products.length) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/productBindingCount`, "Pod Test access count must equal current product membership");
  }
  validatePodEvidenceTuple(value.plan, `${errorPath}/plan`, `${root}/test-access/${value.probeId}/plan.json`);
  assertTimestamp(value.plannedAt, `${errorPath}/plannedAt`);
  const projection = podBindingSetProjection(pod);
  if (projection === null || canonicalJsonDigest(projection) !== value.bindingSetDigest) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/bindingSetDigest`, "Pod Test access must bind the exact current identity/creation set");
  }
  if (value.status === "pending") return value;
  validatePodEvidenceTuple(value.receipt, `${errorPath}/receipt`, `${root}/test-access/${value.probeId}/receipt.json`);
  assertTimestamp(value.observedAt, `${errorPath}/observedAt`);
  assertTimestamp(value.recordedAt, `${errorPath}/recordedAt`);
  if (Date.parse(value.recordedAt) < Date.parse(value.observedAt)) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/recordedAt`, "Pod Test receipt cannot be recorded before observation");
  }
  if (value.status === "validated") {
    if (value.capability !== "direct-multi-root") {
      fail("wakeflow-demand-core-pod-state", `${errorPath}/capability`, "validated Pod Test access requires direct-multi-root");
    }
  } else if (!POD_TEST_BLOCK_REASON_SET.has(value.reasonCode)) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/reasonCode`, "blocked Pod Test access requires one bounded reason code");
  }
  return value;
}

function validatePodState(value, errorPath) {
  assertExactKeys(value, [
    "podId",
    "hostId",
    "placementAuthorizationDigest",
    "scope",
    "phase",
    "windows",
  ], ["designRequest", "designHandoff", "testAccess"], errorPath);
  assertWakeflowTypedId(value.podId, "pod", `${errorPath}/podId`);
  if (typeof value.hostId !== "string" || !POD_HOST_ID_RE.test(value.hostId)) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/hostId`, "Pod hostId must be one stable host capability ID");
  }
  assertDigest(value.placementAuthorizationDigest, `${errorPath}/placementAuthorizationDigest`);
  const root = `.wakeflow-local/runtime/hosts/${value.hostId}/evidence/pods/${value.podId}`;
  validatePodEvidenceTuple(value.scope, `${errorPath}/scope`, `${root}/pod-scope.json`);
  if (!POD_PHASE_SET.has(value.phase)) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/phase`, "Pod logical phase is unsupported");
  }
  if (!Array.isArray(value.windows) || value.windows.length < 3) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/windows`, "Pod state requires its controller, Design, and Test control members");
  }
  value.windows.forEach((entry, index) => validatePodWindowState(entry, `${errorPath}/windows/${index}`, { root }));
  const windowIds = value.windows.map((entry) => entry.windowId);
  if (new Set(windowIds).size !== windowIds.length) {
    fail("wakeflow-demand-core-pod-order", `${errorPath}/windows`, "Pod windowId values must be unique");
  }
  const sortedWindowIds = [...windowIds].sort((left, right) => left.localeCompare(right));
  if (windowIds.some((windowId, index) => windowId !== sortedWindowIds[index])) {
    fail("wakeflow-demand-core-pod-order", `${errorPath}/windows`, "Pod windows must use lexical windowId order");
  }
  for (const field of ["launchOperationId", "bindingId"] ) {
    const identities = value.windows.map((entry) => entry[field]);
    if (new Set(identities).size !== identities.length) {
      fail("wakeflow-demand-core-pod-state", `${errorPath}/windows`, `Pod member ${field} values must be unique`);
    }
  }
  const roleCounts = new Map([...POD_ROLE_SET].map((role) => [role, 0]));
  for (const entry of value.windows) roleCounts.set(entry.role, roleCounts.get(entry.role) + 1);
  for (const role of ["controller", "design", "test"]) {
    if (roleCounts.get(role) !== 1) {
      fail("wakeflow-demand-core-pod-state", `${errorPath}/windows`, `Pod state requires exactly one ${role} member`);
    }
  }
  const repositoryIds = value.windows
    .filter((entry) => entry.role === "product")
    .map((entry) => entry.repositoryId);
  if (new Set(repositoryIds).size !== repositoryIds.length) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/windows`, "Pod state cannot contain duplicate product repository membership");
  }
  const hasDesignRequest = Object.hasOwn(value, "designRequest");
  const hasDesignHandoff = Object.hasOwn(value, "designHandoff");
  if (hasDesignRequest) {
    validatePodDesignArtifactTuple(
      value.designRequest,
      `${errorPath}/designRequest`,
      "wakeflow-pod-design-request",
    );
  }
  if (hasDesignHandoff) {
    if (!hasDesignRequest) {
      fail(
        "wakeflow-demand-core-pod-state",
        `${errorPath}/designHandoff`,
        "Pod Design handoff requires its exact current request selector",
      );
    }
    validatePodDesignArtifactTuple(
      value.designHandoff,
      `${errorPath}/designHandoff`,
      "wakeflow-pod-design-handoff",
    );
  }
  if (["reserved", "creating-control", "control-ready"].includes(value.phase) && (hasDesignRequest || hasDesignHandoff)) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/phase`, "pre-Design Pod phases cannot select Design artifacts");
  }
  if (value.phase === "designing" && (!hasDesignRequest || hasDesignHandoff)) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/phase`, "designing requires one request and no handoff");
  }
  if (["creating-products", "execution-ready", "retryable", "blocked"].includes(value.phase) && (!hasDesignRequest || !hasDesignHandoff)) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/phase`, "post-Design Pod phases require exact request and handoff selectors");
  }
  if (value.phase === "reserved" && value.windows.some((entry) => entry.status !== "planned")) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/phase`, "reserved Pod phase requires every member planned");
  }
  if (value.phase === "execution-ready" && value.windows.some((entry) => entry.status !== "bound")) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/phase`, "execution-ready Pod phase requires every member bound");
  }
  if (value.phase === "closed" && value.windows.some((entry) => entry.status !== "closed")) {
    fail("wakeflow-demand-core-pod-state", `${errorPath}/phase`, "closed Pod phase requires every member closed");
  }
  if (
    value.phase === "closing"
    && (
      !value.windows.some((entry) => ["closing", "closed"].includes(entry.status))
      || value.windows.every((entry) => entry.status === "closed")
    )
  ) {
    fail(
      "wakeflow-demand-core-pod-state",
      `${errorPath}/phase`,
      "closing Pod phase requires an incomplete close acknowledgement set",
    );
  }
  if (Object.hasOwn(value, "testAccess")) {
    if (!["execution-ready", "retryable", "blocked"].includes(value.phase)) {
      fail("wakeflow-demand-core-pod-state", `${errorPath}/testAccess`, "Pod Test access is only valid for a fully bound execution surface");
    }
    validatePodTestAccessState(value.testAccess, `${errorPath}/testAccess`, { root, pod: value });
  }
  return value;
}

// 当前快照不仅校验各数组形状，也关闭 package/task/result/TestCard/review 的交叉引用。
function validateArtifactState(value) {
  if (!Array.isArray(value.taskPackages)) {
    fail("wakeflow-demand-core-artifact-state", "$/taskPackages", "taskPackages must be an array");
  }
  value.taskPackages.forEach((entry, index) => validateArtifactStateTuple(
    entry,
    `$/taskPackages/${index}`,
    {
      artifactKind: "wakeflow-task-package",
      idField: "taskPackageId",
      idType: "task-package",
      lifecycleSet: TASK_PACKAGE_LIFECYCLE_SET,
    },
  ));
  assertCanonicalIdOrder(value.taskPackages, "taskPackageId", "$/taskPackages");
  if (!Array.isArray(value.targetTasks)) {
    fail("wakeflow-demand-core-artifact-state", "$/targetTasks", "targetTasks must be an array");
  }
  value.targetTasks.forEach((entry, index) => validateTargetTaskState(
    entry,
    `$/targetTasks/${index}`,
    value.demandId,
    value.revision,
  ));
  assertCanonicalIdOrder(value.targetTasks, "targetTaskId", "$/targetTasks");
  if (!Array.isArray(value.targetResults)) {
    fail("wakeflow-demand-core-artifact-state", "$/targetResults", "targetResults must be an array");
  }
  value.targetResults.forEach((entry, index) => validateTargetResultState(entry, `$/targetResults/${index}`));
  assertCanonicalIdOrder(value.targetResults, "targetResultId", "$/targetResults");
  if (!Array.isArray(value.testCards)) {
    fail("wakeflow-demand-core-artifact-state", "$/testCards", "testCards must be an array");
  }
  value.testCards.forEach((entry, index) => validateArtifactStateTuple(
    entry,
    `$/testCards/${index}`,
    {
      artifactKind: "wakeflow-test-card",
      idField: "testCardId",
      idType: "test-card",
      lifecycleSet: TEST_CARD_LIFECYCLE_SET,
    },
  ));
  assertCanonicalIdOrder(value.testCards, "testCardId", "$/testCards");
  if (!Array.isArray(value.evidence)) {
    fail("wakeflow-demand-core-artifact-state", "$/evidence", "evidence must be an array");
  }
  value.evidence.forEach((entry, index) => validateEvidenceStateTuple(entry, `$/evidence/${index}`));
  assertCanonicalIdOrder(value.evidence, "evidenceId", "$/evidence");
  validateReviewState(value.review, "$/review");

  const packages = new Map(value.taskPackages.map((entry) => [entry.taskPackageId, entry]));
  const tasks = new Map(value.targetTasks.map((entry) => [entry.targetTaskId, entry]));
  const results = new Map(value.targetResults.map((entry) => [entry.targetResultId, entry]));
  const cards = new Map(value.testCards.map((entry) => [entry.testCardId, entry]));
  const selectedPackages = new Set();
  const selectedTestCards = new Set();
  for (const task of value.targetTasks) {
    if (!packages.has(task.taskPackageId)) {
      fail("wakeflow-demand-core-artifact-state", "$/targetTasks", `target task references missing package ${task.taskPackageId}`);
    }
    if (selectedPackages.has(task.taskPackageId)) {
      fail(
        "wakeflow-demand-core-artifact-state",
        "$/targetTasks",
        `task package ${task.taskPackageId} cannot be selected by more than one target task`,
      );
    }
    selectedPackages.add(task.taskPackageId);
    if (task.currentResult) {
      const result = results.get(task.currentResult.targetResultId);
      if (
        !result
        || result.targetTaskId !== task.targetTaskId
        || result.ref !== task.currentResult.ref
        || result.digest !== task.currentResult.digest
        || result.lifecycleStatus !== "current"
      ) {
        fail("wakeflow-demand-core-artifact-state", "$/targetTasks", `target task current result tuple is not the exact current inventory entry`);
      }
    }
    if (task.testCard) {
      if (selectedTestCards.has(task.testCard.testCardId)) {
        fail(
          "wakeflow-demand-core-artifact-state",
          "$/targetTasks",
          `Test card ${task.testCard.testCardId} cannot be selected by more than one target task`,
        );
      }
      selectedTestCards.add(task.testCard.testCardId);
      const card = cards.get(task.testCard.testCardId);
      if (!card || card.ref !== task.testCard.ref || card.digest !== task.testCard.digest) {
        fail("wakeflow-demand-core-artifact-state", "$/targetTasks", "target task Test card tuple must match the exact card inventory entry");
      }
      for (const attempt of task.testAttempts) {
        if (!Object.hasOwn(attempt, "previousResult")) continue;
        const result = results.get(attempt.previousResult.targetResultId);
        if (
          !result
          || result.targetTaskId !== task.targetTaskId
          || result.ref !== attempt.previousResult.ref
          || result.digest !== attempt.previousResult.digest
        ) {
          fail(
            "wakeflow-demand-core-test-attempt",
            "$/targetTasks",
            "Test attempt previousResult must match one exact retained TargetResult inventory entry",
          );
        }
      }
    }
  }
  const unselectedActivePackage = value.taskPackages.find((entry) => (
    entry.lifecycleStatus === "active"
    && !selectedPackages.has(entry.taskPackageId)
  ));
  if (unselectedActivePackage) {
    fail(
      "wakeflow-demand-core-artifact-state",
      "$/taskPackages",
      `active task package ${unselectedActivePackage.taskPackageId} must be selected by exactly one target task`,
    );
  }
  for (const result of value.targetResults) {
    if (!tasks.has(result.targetTaskId)) {
      fail("wakeflow-demand-core-artifact-state", "$/targetResults", `target result references missing task ${result.targetTaskId}`);
    }
    if (result.lifecycleStatus === "current") {
      const current = tasks.get(result.targetTaskId).currentResult;
      if (!current || current.targetResultId !== result.targetResultId) {
        fail("wakeflow-demand-core-artifact-state", "$/targetResults", "every current result must be selected by its target task");
      }
    }
  }

  const reviewLifecycleSets = [
    ["readyTargetTaskIds", new Set(["review-ready"])],
    ["blockedTargetTaskIds", new Set(["blocked"])],
    ["missingTargetTaskIds", new Set(["needs-rework", "planned", "dispatched", "waiting-result"])],
  ];
  for (const [field, admittedLifecycles] of reviewLifecycleSets) {
    for (const targetTaskId of value.review[field]) {
      const task = tasks.get(targetTaskId);
      if (!task || !admittedLifecycles.has(task.lifecycleStatus)) {
        fail(
          "wakeflow-demand-core-artifact-state",
          `$/review/${field}`,
          `review task ${targetTaskId} does not match its admitted target-task lifecycle`,
        );
      }
    }
  }
}

/** 校验当前状态快照及其 artifact、review、delivery、Test 和 Pod 交叉闭包。 */
export function validateDemandStateRecord(value) {
  value = canonicalDataSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "demandRef",
    "demandDigest",
    "revision",
    "state",
    "stateReason",
    "updatedAt",
    "lastEvent",
    ...ARTIFACT_STATE_KEYS,
  ], [
    "demandAuthorityRef",
    "demandAuthorityDigest",
    "pod",
  ], "$");
  assertSchemaAndKind(value, "wakeflow-state");
  assertWakeflowTypedId(value.programId, "program", "$/programId");
  assertWakeflowTypedId(value.demandId, "demand", "$/demandId");
  if (value.demandRef !== WAKEFLOW_DEMAND_FILE) {
    fail("wakeflow-demand-core-state-demand", "$/demandRef", `state demandRef must be ${WAKEFLOW_DEMAND_FILE}`);
  }
  assertDigest(value.demandDigest, "$/demandDigest");
  const hasAuthorityRef = Object.hasOwn(value, "demandAuthorityRef");
  const hasAuthorityDigest = Object.hasOwn(value, "demandAuthorityDigest");
  if (hasAuthorityRef !== hasAuthorityDigest) {
    fail("wakeflow-demand-core-state-authority", "$", "state authority ref and digest must appear together");
  }
  if (hasAuthorityRef) {
    if (value.demandAuthorityRef !== WAKEFLOW_DEMAND_AUTHORITY_FILE) {
      fail(
        "wakeflow-demand-core-state-authority",
        "$/demandAuthorityRef",
        `state demandAuthorityRef must be ${WAKEFLOW_DEMAND_AUTHORITY_FILE}`,
      );
    }
    assertDigest(value.demandAuthorityDigest, "$/demandAuthorityDigest");
  }
  assertRevision(value.revision, "$/revision", { positive: true });
  assertDemandState(value.state, "$/state");
  assertHumanText(value.stateReason, "$/stateReason");
  assertTimestamp(value.updatedAt, "$/updatedAt");
  validateLastEvent(value.lastEvent);
  validateArtifactState(value);
  if (Object.hasOwn(value, "pod")) validatePodState(value.pod, "$/pod");
  return frozenClone(value);
}

function validateChangedArtifact(value, errorPath) {
  const candidateContract = demandArtifactContractForKind(value?.artifactKind);
  const isEvidence = value?.artifactKind === "wakeflow-evidence";
  assertExactKeys(
    value,
    candidateContract || isEvidence
      ? ["artifactKind", "artifactId", "ref", "digest"]
      : ["artifactKind", "ref", "digest"],
    [],
    errorPath,
  );
  if (isEvidence) {
    assertWakeflowTypedId(value.artifactId, "evidence", `${errorPath}/artifactId`);
    const expectedRef = `evidence/${value.artifactId}/evidence.json`;
    if (value.ref !== expectedRef) {
      fail(
        "wakeflow-demand-core-changed-artifact",
        `${errorPath}/ref`,
        `wakeflow-evidence changed artifact ref must be ${expectedRef}`,
      );
    }
    assertDigest(value.digest, `${errorPath}/digest`);
    return frozenClone(value);
  }
  if (candidateContract) {
    assertWakeflowTypedId(value.artifactId, candidateContract.idType, `${errorPath}/artifactId`);
    const identity = { [candidateContract.idField]: value.artifactId };
    if (value.artifactKind === "wakeflow-target-result") {
      const match = value.ref.match(/^target-results\/(target-task_[^/]+)\/(target-result_[^/]+)\.json$/u);
      if (!match || match[2] !== value.artifactId) {
        fail(
          "wakeflow-demand-core-changed-artifact",
          `${errorPath}/ref`,
          "TargetResult changed ref must be target-results/{typed targetTaskId}/{artifactId}.json",
        );
      }
      assertWakeflowTypedId(match[1], "target-task", `${errorPath}/ref`);
    } else {
      const expected = candidateContract.ref(identity);
      if (value.ref !== expected) {
        fail(
          "wakeflow-demand-core-changed-artifact",
          `${errorPath}/ref`,
          `${value.artifactKind} changed artifact ref must be ${expected}`,
        );
      }
    }
    assertDigest(value.digest, `${errorPath}/digest`);
    return frozenClone(value);
  }
  const expectedRef = CHANGED_ARTIFACT_CONTRACTS[value.artifactKind];
  if (!expectedRef) {
    fail(
      "wakeflow-demand-core-changed-artifact",
      `${errorPath}/artifactKind`,
      `event cannot reference artifact kind ${String(value.artifactKind)}`,
    );
  }
  if (value.ref !== expectedRef) {
    fail(
      "wakeflow-demand-core-changed-artifact",
      `${errorPath}/ref`,
      `${value.artifactKind} changed artifact ref must be ${expectedRef}`,
    );
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return frozenClone(value);
}

function validateDeliveryTransition(value, errorPath, { event }) {
  assertExactKeys(value, [
    "targetTaskId",
    "deliveryId",
    "envelopeDigest",
    "sendGeneration",
    "fromPhase",
    "toPhase",
    "previousSummaryDigest",
    "nextSummaryDigest",
  ], ["run", "testAttemptId", "testLineageDigest"], errorPath);
  assertWakeflowTypedId(value.targetTaskId, "target-task", `${errorPath}/targetTaskId`);
  assertWakeflowTypedId(value.deliveryId, "delivery", `${errorPath}/deliveryId`);
  assertDigest(value.envelopeDigest, `${errorPath}/envelopeDigest`);
  assertRevision(value.sendGeneration, `${errorPath}/sendGeneration`, { positive: true });
  if (value.fromPhase !== null) {
    assertLifecycle(value.fromPhase, DELIVERY_PHASE_SET, `${errorPath}/fromPhase`, "delivery fromPhase");
  }
  assertLifecycle(value.toPhase, DELIVERY_PHASE_SET, `${errorPath}/toPhase`, "delivery toPhase");
  if (value.previousSummaryDigest !== null) {
    assertDigest(value.previousSummaryDigest, `${errorPath}/previousSummaryDigest`);
  }
  assertDigest(value.nextSummaryDigest, `${errorPath}/nextSummaryDigest`);
  const hasTestAttemptId = Object.hasOwn(value, "testAttemptId");
  const hasTestLineageDigest = Object.hasOwn(value, "testLineageDigest");
  if (hasTestAttemptId !== hasTestLineageDigest) {
    fail(
      "wakeflow-demand-core-test-attempt",
      errorPath,
      "Test attempt identity and lineage digest must appear together",
    );
  }
  if (hasTestAttemptId) {
    assertWakeflowTypedId(value.testAttemptId, "test-attempt", `${errorPath}/testAttemptId`);
    assertDigest(value.testLineageDigest, `${errorPath}/testLineageDigest`);
    if (event.command !== "prepare-target-delivery") {
      fail(
        "wakeflow-demand-core-test-attempt",
        errorPath,
        "only Test delivery preparation may carry Test attempt lineage",
      );
    }
  }
  if ((value.fromPhase === null) !== (value.previousSummaryDigest === null)) {
    fail(
      "wakeflow-demand-core-delivery-event",
      errorPath,
      "delivery fromPhase and previousSummaryDigest must be null together",
    );
  }
  if (value.previousSummaryDigest === value.nextSummaryDigest) {
    fail(
      "wakeflow-demand-core-delivery-event",
      `${errorPath}/nextSummaryDigest`,
      "delivery transition must change its canonical summary digest",
    );
  }
  const contract = DELIVERY_EVENT_CONTRACTS[event.command];
  if (!contract) {
    fail(
      "wakeflow-demand-core-delivery-event",
      errorPath,
      "only a delivery-owned command may carry deliveryTransition",
    );
  }
  if (
    event.actor !== "controller"
    || event.type !== contract.type
    || !contract.fromPhases.has(value.fromPhase)
    || !contract.toPhases.has(value.toPhase)
  ) {
    fail(
      "wakeflow-demand-core-delivery-event",
      errorPath,
      "delivery actor, command, type, and phase edge must match the fixed contract",
    );
  }
  if (event.changedArtifacts.length !== 0) {
    fail(
      "wakeflow-demand-core-delivery-event",
      "$/changedArtifacts",
      "delivery state transitions cannot name immutable artifact changes",
    );
  }
  const hasRun = Object.hasOwn(value, "run");
  if ((contract.run === "required") !== hasRun) {
    fail(
      "wakeflow-demand-core-delivery-event",
      `${errorPath}/run`,
      `delivery ${event.command} requires run=${contract.run}`,
    );
  }
  if (hasRun) {
    validateDeliveryRunTuple(value.run, `${errorPath}/run`, event.demandId);
    const expectedStatus = event.command === "rearm-target-delivery"
      ? "rejected-before-send"
      : value.toPhase;
    if (value.run.transportStatus !== expectedStatus) {
      fail(
        "wakeflow-demand-core-delivery-event",
        `${errorPath}/run/transportStatus`,
        `delivery run status must be ${expectedStatus}`,
      );
    }
  }
  if (event.command === "prepare-target-delivery" && value.sendGeneration !== 1) {
    fail(
      "wakeflow-demand-core-delivery-event",
      `${errorPath}/sendGeneration`,
      "a new delivery begins at send generation one",
    );
  }
  if (event.command === "rearm-target-delivery" && value.sendGeneration < 2) {
    fail(
      "wakeflow-demand-core-delivery-event",
      `${errorPath}/sendGeneration`,
      "rearmed delivery must advance beyond send generation one",
    );
  }
  return value;
}

function validateReviewDecision(value, errorPath, { event }) {
  assertExactKeys(value, [
    "candidate",
    "group",
    "resultSetDigest",
    "decision",
    "targetTaskIds",
    "previousReviewDigest",
    "nextReviewDigest",
  ], [], errorPath);
  validatePendingCandidate(value.candidate, `${errorPath}/candidate`);
  assertExactKeys(value.group, ["groupId", "ref", "digest"], [], `${errorPath}/group`);
  assertWakeflowTypedId(value.group.groupId, "dispatch-group", `${errorPath}/group/groupId`);
  const expectedGroupRef = `.wakeflow-local/runtime/shared/transport/demands/${event.demandId}`
    + `/groups/${value.group.groupId}.json`;
  if (value.group.ref !== expectedGroupRef) {
    fail(
      "wakeflow-demand-core-review-event",
      `${errorPath}/group/ref`,
      `review decision group ref must be ${expectedGroupRef}`,
    );
  }
  assertDigest(value.group.digest, `${errorPath}/group/digest`);
  assertDigest(value.resultSetDigest, `${errorPath}/resultSetDigest`);
  if (!Object.hasOwn(REVIEW_DECISION_EVENT_TYPES, value.decision)) {
    fail("wakeflow-demand-core-review-event", `${errorPath}/decision`, "review decision is unsupported");
  }
  const targetTaskIds = validateCanonicalTargetTaskIds(
    value.targetTaskIds,
    `${errorPath}/targetTaskIds`,
  );
  if (targetTaskIds.length === 0) {
    fail("wakeflow-demand-core-review-event", `${errorPath}/targetTaskIds`, "review decision scope cannot be empty");
  }
  assertDigest(value.previousReviewDigest, `${errorPath}/previousReviewDigest`);
  assertDigest(value.nextReviewDigest, `${errorPath}/nextReviewDigest`);
  if (
    event.actor !== "controller"
    || event.command !== REVIEW_DECISION_COMMAND
    || event.type !== REVIEW_DECISION_EVENT_TYPES[value.decision]
    || event.changedArtifacts.length !== 0
  ) {
    fail(
      "wakeflow-demand-core-review-event",
      errorPath,
      "review actor, command, type, decision, and empty changedArtifacts must match",
    );
  }
  return value;
}

function validatePodTransition(value, errorPath, { event }) {
  const contract = POD_EVENT_CONTRACTS[event.command] ?? null;
  const selectorFields = contract?.selector === "window"
    ? ["windowId"]
    : contract?.selector === "probe"
      ? ["probeId"]
      : contract?.selector === "close"
        ? ["windowId", "closeOperationId"]
        : contract?.selector === "design-request"
          ? ["podDesignRequestId"]
          : contract?.selector === "design-handoff"
            ? ["podDesignHandoffId"]
        : [];
  assertExactKeys(value, [
    "podId",
    "action",
    "previousPodDigest",
    "nextPodDigest",
    ...selectorFields,
  ], [], errorPath);
  assertWakeflowTypedId(value.podId, "pod", `${errorPath}/podId`);
  if (value.previousPodDigest !== null) assertDigest(value.previousPodDigest, `${errorPath}/previousPodDigest`);
  assertDigest(value.nextPodDigest, `${errorPath}/nextPodDigest`);
  if (selectorFields.includes("windowId")) {
    assertWakeflowTypedId(value.windowId, "window", `${errorPath}/windowId`);
  }
  if (selectorFields.includes("probeId")) {
    assertPodDomainId(value.probeId, POD_TEST_PROBE_ID_RE, `${errorPath}/probeId`, "Test access probe ID");
  }
  if (selectorFields.includes("closeOperationId")) {
    assertPodDomainId(value.closeOperationId, POD_CLOSE_ID_RE, `${errorPath}/closeOperationId`, "close operation ID");
  }
  if (selectorFields.includes("podDesignRequestId")) {
    assertWakeflowTypedId(
      value.podDesignRequestId,
      "pod-design-request",
      `${errorPath}/podDesignRequestId`,
    );
  }
  if (selectorFields.includes("podDesignHandoffId")) {
    assertWakeflowTypedId(
      value.podDesignHandoffId,
      "pod-design-handoff",
      `${errorPath}/podDesignHandoffId`,
    );
  }
  const expectedArtifactKind = contract?.artifactKind ?? null;
  const hasExactArtifactChange = expectedArtifactKind === null
    ? event.changedArtifacts.length === 0
    : event.changedArtifacts.length === 1
      && event.changedArtifacts[0].artifactKind === expectedArtifactKind;
  if (
    contract === null
    || value.action !== contract.action
    || event.actor !== "controller"
    || event.type !== contract.type
    || !hasExactArtifactChange
  ) {
    fail(
      "wakeflow-demand-core-pod-event",
      errorPath,
      "Pod actor, command, type, action, selector, and changed artifact must match its closed contract",
    );
  }
  return value;
}

function validateLifecycleTransition(value, errorPath, { event }) {
  assertExactKeys(value, ["action"], [], errorPath);
  const contract = LIFECYCLE_EVENT_CONTRACTS[event.command] ?? null;
  if (
    contract === null
    || value.action !== contract.action
    || event.actor !== "controller"
    || event.type !== contract.type
    || event.to !== contract.to
    || event.from === event.to
    || event.changedArtifacts.length !== 0
  ) {
    fail(
      "wakeflow-demand-core-lifecycle-event",
      errorPath,
      "lifecycle actor, command, type, action, terminal state, and empty changedArtifacts must match its closed contract",
    );
  }
  return value;
}

/** 校验单个 append-only controller event，并关闭各专用 transition owner 的字段合同。 */
export function validateControllerEventRecord(value) {
  value = canonicalDataSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "eventId",
    "demandId",
    "createdAt",
    "actor",
    "command",
    "type",
    "previousRevision",
    "nextRevision",
    "from",
    "to",
    "reason",
    "decisionSummary",
    "changedArtifacts",
  ], ["deliveryTransition", "reviewDecision", "podTransition", "lifecycleTransition"], "$");
  assertSchemaAndKind(value, "wakeflow-controller-event");
  assertToken(value.eventId, "$/eventId");
  assertWakeflowTypedId(value.demandId, "demand", "$/demandId");
  assertTimestamp(value.createdAt, "$/createdAt");
  assertToken(value.actor, "$/actor");
  assertToken(value.command, "$/command");
  assertToken(value.type, "$/type");
  assertRevision(value.previousRevision, "$/previousRevision");
  assertRevision(value.nextRevision, "$/nextRevision", { positive: true });
  if (value.nextRevision !== value.previousRevision + 1) {
    fail("wakeflow-demand-core-event-revision", "$/nextRevision", "event revisions must advance by exactly one");
  }
  assertDemandState(value.from, "$/from", { nullable: true });
  assertDemandState(value.to, "$/to");
  if ((value.previousRevision === 0) !== (value.from === null)) {
    fail("wakeflow-demand-core-event-revision", "$/from", "only the revision 0 to 1 initial event may have from=null");
  }
  if (value.previousRevision === 0 && (
    value.actor !== "controller"
    || value.command !== "init"
    || value.type !== "state.initialized"
    || value.to !== "intake"
  )) {
    fail(
      "wakeflow-demand-core-event-initial",
      "$",
      "revision 0 to 1 must be exactly controller/init/state.initialized from null to intake",
    );
  }
  assertHumanText(value.reason, "$/reason");
  assertHumanText(value.decisionSummary, "$/decisionSummary");
  if (!Array.isArray(value.changedArtifacts)) {
    fail("wakeflow-demand-core-changed-artifact", "$/changedArtifacts", "changedArtifacts must be an array");
  }
  const changedArtifacts = value.changedArtifacts.map((entry, index) => (
    validateChangedArtifact(entry, `$/changedArtifacts/${index}`)
  ));
  const maxChangedArtifacts = value.previousRevision === 0 ? 2 : 1;
  if (changedArtifacts.length > maxChangedArtifacts) {
    fail(
      "wakeflow-demand-core-changed-artifact",
      "$/changedArtifacts",
      value.previousRevision === 0
        ? "initial publication may change at most demand.json and demand-authority.json"
        : "one post-publication revision may change at most one immutable artifact",
    );
  }
  if (
    value.previousRevision === 0
    && changedArtifacts.some((entry) => ![
      "wakeflow-demand",
      "wakeflow-demand-authority",
    ].includes(entry.artifactKind))
  ) {
    fail(
      "wakeflow-demand-core-changed-artifact",
      "$/changedArtifacts",
      "initial publication may name only demand.json and optional demand-authority.json",
    );
  }
  const changedRefs = changedArtifacts.map((entry) => entry.ref);
  if (new Set(changedRefs).size !== changedRefs.length) {
    fail("wakeflow-demand-core-changed-artifact", "$/changedArtifacts", "changed artifact refs must be unique");
  }
  const hasDeliveryTransition = Object.hasOwn(value, "deliveryTransition");
  if (DELIVERY_COMMAND_SET.has(value.command) !== hasDeliveryTransition) {
    fail(
      "wakeflow-demand-core-delivery-event",
      "$/deliveryTransition",
      "delivery-owned commands and deliveryTransition must appear together",
    );
  }
  if (hasDeliveryTransition) {
    validateDeliveryTransition(value.deliveryTransition, "$/deliveryTransition", { event: value });
  }
  const hasReviewDecision = Object.hasOwn(value, "reviewDecision");
  if ((value.command === REVIEW_DECISION_COMMAND) !== hasReviewDecision) {
    fail(
      "wakeflow-demand-core-review-event",
      "$/reviewDecision",
      "review decision command and reviewDecision must appear together",
    );
  }
  if (hasDeliveryTransition && hasReviewDecision) {
    fail(
      "wakeflow-demand-core-event-owner",
      "$",
      "one controller event cannot combine delivery and review ownership",
    );
  }
  if (hasReviewDecision) {
    validateReviewDecision(value.reviewDecision, "$/reviewDecision", { event: value });
  }
  const hasPodTransition = Object.hasOwn(value, "podTransition");
  if (POD_COMMAND_SET.has(value.command) !== hasPodTransition) {
    fail(
      "wakeflow-demand-core-pod-event",
      "$/podTransition",
      "Pod-owned commands and podTransition must appear together",
    );
  }
  if (
    hasPodTransition
    && (hasDeliveryTransition || hasReviewDecision)
  ) {
    fail(
      "wakeflow-demand-core-event-owner",
      "$",
      "one controller event cannot combine Pod, delivery, or review ownership",
    );
  }
  if (hasPodTransition) validatePodTransition(value.podTransition, "$/podTransition", { event: value });
  const hasLifecycleTransition = Object.hasOwn(value, "lifecycleTransition");
  if (LIFECYCLE_COMMAND_SET.has(value.command) !== hasLifecycleTransition) {
    fail(
      "wakeflow-demand-core-lifecycle-event",
      "$/lifecycleTransition",
      "lifecycle-owned commands and lifecycleTransition must appear together",
    );
  }
  if (
    hasLifecycleTransition
    && (hasDeliveryTransition || hasReviewDecision || hasPodTransition)
  ) {
    fail(
      "wakeflow-demand-core-event-owner",
      "$",
      "one controller event cannot combine lifecycle, Pod, delivery, or review ownership",
    );
  }
  if (hasLifecycleTransition) {
    validateLifecycleTransition(value.lifecycleTransition, "$/lifecycleTransition", { event: value });
  }
  if (
    TERMINAL_DEMAND_STATE_SET.has(value.to)
    && value.from !== value.to
    && !hasLifecycleTransition
  ) {
    fail(
      "wakeflow-demand-core-lifecycle-event",
      "$/to",
      "only an exact lifecycle-owned event may enter completed or cancelled",
    );
  }
  return frozenClone(value);
}

function matchingChangedArtifacts(events, artifactKind) {
  return events.flatMap((event) => event.changedArtifacts.filter((entry) => entry.artifactKind === artifactKind));
}

function currentArtifactStateTuples(state) {
  if (!Object.hasOwn(state, "taskPackages")) return [];
  return [
    ...state.taskPackages.map((entry) => ({
      artifactKind: "wakeflow-task-package",
      artifactId: entry.taskPackageId,
      ref: entry.ref,
      digest: entry.digest,
    })),
    ...state.targetResults.map((entry) => ({
      artifactKind: "wakeflow-target-result",
      artifactId: entry.targetResultId,
      ref: entry.ref,
      digest: entry.digest,
    })),
    ...state.testCards.map((entry) => ({
      artifactKind: "wakeflow-test-card",
      artifactId: entry.testCardId,
      ref: entry.ref,
      digest: entry.digest,
    })),
    ...state.evidence.map((entry) => ({
      artifactKind: "wakeflow-evidence",
      artifactId: entry.evidenceId,
      ref: entry.ref,
      digest: entry.digest,
    })),
    ...(state.review.pendingCandidate ? [{
      artifactKind: "wakeflow-review-candidate",
      artifactId: state.review.pendingCandidate.reviewCandidateId,
      ref: state.review.pendingCandidate.ref,
      digest: state.review.pendingCandidate.digest,
    }] : []),
    ...(state.pod?.designRequest ? [{
      artifactKind: "wakeflow-pod-design-request",
      artifactId: state.pod.designRequest.podDesignRequestId,
      ref: state.pod.designRequest.ref,
      digest: state.pod.designRequest.digest,
    }] : []),
    ...(state.pod?.designHandoff ? [{
      artifactKind: "wakeflow-pod-design-handoff",
      artifactId: state.pod.designHandoff.podDesignHandoffId,
      ref: state.pod.designHandoff.ref,
      digest: state.pod.designHandoff.digest,
    }] : []),
  ];
}

function assertDeliveryTransitionIdentity(event, {
  task,
  envelope,
  command,
  sendGeneration,
  errorPath,
}) {
  const transition = event.deliveryTransition;
  if (
    event.command !== command
    || !transition
    || transition.targetTaskId !== task.targetTaskId
    || transition.deliveryId !== envelope.deliveryId
    || transition.envelopeDigest !== envelope.digest
    || transition.sendGeneration !== sendGeneration
  ) {
    fail(
      "wakeflow-demand-core-delivery-event",
      errorPath,
      `delivery event pointer must resolve to the exact ${command} transition`,
    );
  }
  return transition;
}

function assertDeliveryStackClosure(state, events) {
  for (const task of state.targetTasks) {
    const delivery = task.currentDelivery;
    if (!delivery) continue;
    exactEventForPointer(
      events,
      delivery.sourceState,
      `$/state/targetTasks/${task.targetTaskId}/currentDelivery/sourceState`,
    );
    const preparedEvent = exactEventForPointer(
      events,
      delivery.preparedBy,
      `$/state/targetTasks/${task.targetTaskId}/currentDelivery/preparedBy`,
    );
    assertDeliveryTransitionIdentity(preparedEvent, {
      task,
      envelope: delivery.envelope,
      command: "prepare-target-delivery",
      sendGeneration: 1,
      errorPath: `$/state/targetTasks/${task.targetTaskId}/currentDelivery/preparedBy`,
    });
    const authorizedEvent = exactEventForPointer(
      events,
      delivery.authorizedBy,
      `$/state/targetTasks/${task.targetTaskId}/currentDelivery/authorizedBy`,
    );
    const authorizationTransition = assertDeliveryTransitionIdentity(authorizedEvent, {
      task,
      envelope: delivery.envelope,
      command: delivery.sendGeneration === 1
        ? "prepare-target-delivery"
        : "rearm-target-delivery",
      sendGeneration: delivery.sendGeneration,
      errorPath: `$/state/targetTasks/${task.targetTaskId}/currentDelivery/authorizedBy`,
    });
    if (
      delivery.sendGeneration > 1
      && canonicalJson(authorizationTransition.run) !== canonicalJson(delivery.rearmedFrom)
    ) {
      fail(
        "wakeflow-demand-core-delivery-event",
        `$/state/targetTasks/${task.targetTaskId}/currentDelivery/rearmedFrom`,
        "rearm authorization event must bind the exact preceding rejected run",
      );
    }
    if (delivery.claimedBy) {
      const claimedEvent = exactEventForPointer(
        events,
        delivery.claimedBy,
        `$/state/targetTasks/${task.targetTaskId}/currentDelivery/claimedBy`,
      );
      assertDeliveryTransitionIdentity(claimedEvent, {
        task,
        envelope: delivery.envelope,
        command: "claim-target-delivery-send",
        sendGeneration: delivery.sendGeneration,
        errorPath: `$/state/targetTasks/${task.targetTaskId}/currentDelivery/claimedBy`,
      });
    }
    if (delivery.recordedBy) {
      const recordedEvent = exactEventForPointer(
        events,
        delivery.recordedBy,
        `$/state/targetTasks/${task.targetTaskId}/currentDelivery/recordedBy`,
      );
      const recordedTransition = assertDeliveryTransitionIdentity(recordedEvent, {
        task,
        envelope: delivery.envelope,
        command: "record-target-delivery-run",
        sendGeneration: delivery.sendGeneration,
        errorPath: `$/state/targetTasks/${task.targetTaskId}/currentDelivery/recordedBy`,
      });
      if (canonicalJson(recordedTransition.run) !== canonicalJson(delivery.latestRun)) {
        fail(
          "wakeflow-demand-core-delivery-event",
          `$/state/targetTasks/${task.targetTaskId}/currentDelivery/latestRun`,
          "recorded delivery event must bind the exact current run tuple",
        );
      }
    }
    const lastDeliveryEvent = events.findLast((event) => (
      event.deliveryTransition?.targetTaskId === task.targetTaskId
    ));
    const lastTransition = lastDeliveryEvent?.deliveryTransition;
    if (
      !lastTransition
      || lastTransition.deliveryId !== delivery.envelope.deliveryId
      || lastTransition.envelopeDigest !== delivery.envelope.digest
      || lastTransition.sendGeneration !== delivery.sendGeneration
      || lastTransition.toPhase !== delivery.phase
      || lastTransition.nextSummaryDigest !== demandDeliverySummaryDigest(delivery)
    ) {
      fail(
        "wakeflow-demand-core-delivery-summary",
        `$/state/targetTasks/${task.targetTaskId}/currentDelivery`,
        "current delivery must equal the exact last delivery event summary for its target",
      );
    }

    if (!Object.hasOwn(task, "testCard")) {
      const forgedTestLineageEvent = events.find((event) => (
        event.command === "prepare-target-delivery"
        && event.deliveryTransition?.targetTaskId === task.targetTaskId
        && (
          Object.hasOwn(event.deliveryTransition, "testAttemptId")
          || Object.hasOwn(event.deliveryTransition, "testLineageDigest")
        )
      ));
      if (forgedTestLineageEvent) {
        fail(
          "wakeflow-demand-core-test-attempt",
          `$/events/${forgedTestLineageEvent.nextRevision - 1}/deliveryTransition`,
          "non-Test delivery history cannot carry Test attempt lineage",
        );
      }
      continue;
    }
    const lastAttempt = task.testAttempts.at(-1);
    const lastAuthorization = lastAttempt.deliveryAuthorizations.at(-1);
    if (canonicalJson(delivery.preparedBy) !== canonicalJson(lastAuthorization.authorizedBy)) {
      fail(
        "wakeflow-demand-core-test-attempt",
        `$/state/targetTasks/${task.targetTaskId}/currentDelivery/preparedBy`,
        "current Test delivery must originate from its latest envelope authorization event",
      );
    }
    for (const [attemptIndex, attempt] of task.testAttempts.entries()) {
      for (const [authorizationIndex, authorization] of attempt.deliveryAuthorizations.entries()) {
        const authorizationPath = `$/state/targetTasks/${task.targetTaskId}`
          + `/testAttempts/${attemptIndex}/deliveryAuthorizations/${authorizationIndex}`;
        const event = exactEventForPointer(
          events,
          authorization.authorizedBy,
          `${authorizationPath}/authorizedBy`,
        );
        const transition = assertDeliveryTransitionIdentity(event, {
          task,
          envelope: authorization.envelope,
          command: "prepare-target-delivery",
          sendGeneration: 1,
          errorPath: `${authorizationPath}/authorizedBy`,
        });
        const lineagePrefix = structuredClone(task.testAttempts.slice(0, attemptIndex + 1));
        lineagePrefix[attemptIndex].deliveryAuthorizations = lineagePrefix[
          attemptIndex
        ].deliveryAuthorizations.slice(0, authorizationIndex + 1);
        if (
          transition.testAttemptId !== attempt.testAttemptId
          || transition.testLineageDigest !== demandTestLineageDigest(lineagePrefix)
        ) {
          fail(
            "wakeflow-demand-core-test-attempt",
            authorizationPath,
            "each Test envelope authorization event must bind its exact append-only lineage prefix",
          );
        }
        if (authorizationIndex === 0) continue;
        const previousAuthorization = attempt.deliveryAuthorizations[authorizationIndex - 1];
        const priorEnvelopeEvents = events.filter((candidate) => (
          candidate.nextRevision < authorization.authorizedBy.revision
          && candidate.deliveryTransition?.deliveryId
            === previousAuthorization.envelope.deliveryId
        ));
        const finalPriorEnvelopeEvent = priorEnvelopeEvents.at(-1);
        if (
          !finalPriorEnvelopeEvent
          || finalPriorEnvelopeEvent.command !== "record-target-delivery-run"
          || canonicalJson(finalPriorEnvelopeEvent.deliveryTransition?.run)
            !== canonicalJson(authorization.replacesRun)
        ) {
          fail(
            "wakeflow-demand-core-test-attempt",
            `${authorizationPath}/replacesRun`,
            "replacement Test authorization must bind the final rejected run of the immediately prior envelope",
          );
        }
      }
    }
  }
}

function assertPodStackClosure(state, events) {
  let currentDigest = null;
  let currentPodId = null;
  for (const [index, event] of events.entries()) {
    const transition = event.podTransition;
    if (!transition) continue;
    if (transition.previousPodDigest !== currentDigest) {
      fail(
        "wakeflow-demand-core-pod-event-chain",
        `$/events/${index}/podTransition/previousPodDigest`,
        "Pod event previous digest must equal the exact preceding Pod event result",
      );
    }
    if (currentPodId !== null && transition.podId !== currentPodId) {
      fail(
        "wakeflow-demand-core-pod-event-chain",
        `$/events/${index}/podTransition/podId`,
        "Pod event chain cannot replace its stable Pod identity",
      );
    }
    currentPodId = transition.podId;
    currentDigest = transition.nextPodDigest;
  }
  const stateDigest = Object.hasOwn(state, "pod") ? canonicalJsonDigest(state.pod) : null;
  if (stateDigest !== currentDigest || (state.pod?.podId ?? null) !== currentPodId) {
    fail(
      "wakeflow-demand-core-pod-event-chain",
      "$/state/pod",
      "current Pod state must equal the exact final Pod event digest and identity",
    );
  }
}

/** 将 demand、authority、state 与完整事件链闭合为一个可读取的权威快照。 */
export function validateDemandCoreStack({
  demand,
  authority = null,
  state,
  events,
  ledgerRoot = null,
} = {}) {
  const validDemand = validateDemandRecord(demand, { ledgerRoot });
  const validAuthority = authority === null
    ? null
    : validateDemandAuthorityRecord(authority, { demand: validDemand, ledgerRoot });
  const validState = validateDemandStateRecord(state);
  if (validState.programId !== validDemand.programId || validState.demandId !== validDemand.demandId) {
    fail("wakeflow-demand-core-stack-identity", "$/state", "state identity must match the immutable demand record");
  }
  assertPodPlacementAuthority(validDemand, validState);
  if (validState.demandDigest !== canonicalJsonDigest(validDemand)) {
    fail("wakeflow-demand-core-stack-demand", "$/state/demandDigest", "state demandDigest must match demand.json");
  }
  const hasStateAuthority = Object.hasOwn(validState, "demandAuthorityRef");
  if ((validAuthority !== null) !== hasStateAuthority) {
    fail(
      "wakeflow-demand-core-stack-authority",
      "$/state/demandAuthorityRef",
      "authority file presence must exactly match the state authority tuple",
    );
  }
  if (validAuthority && validState.demandAuthorityDigest !== canonicalJsonDigest(validAuthority)) {
    fail(
      "wakeflow-demand-core-stack-authority",
      "$/state/demandAuthorityDigest",
      "state authority digest must match the immutable authority record",
    );
  }
  if (!Array.isArray(events) || events.length === 0) {
    fail("wakeflow-demand-core-event-chain", "$/events", "demand event history must contain its revision 1 event");
  }
  const validEvents = events.map((event) => validateControllerEventRecord(event));
  const ids = new Set();
  for (let index = 0; index < validEvents.length; index += 1) {
    const event = validEvents[index];
    if (ids.has(event.eventId)) {
      fail("wakeflow-demand-core-event-chain", `$/events/${index}/eventId`, `duplicate eventId ${event.eventId}`);
    }
    ids.add(event.eventId);
    if (event.demandId !== validDemand.demandId) {
      fail("wakeflow-demand-core-event-chain", `$/events/${index}/demandId`, "event demandId must match demand.json");
    }
    const expectedPrevious = index;
    const expectedNext = index + 1;
    if (event.previousRevision !== expectedPrevious || event.nextRevision !== expectedNext) {
      fail(
        "wakeflow-demand-core-event-chain",
        `$/events/${index}`,
        `event ${index + 1} must describe revision ${expectedPrevious} to ${expectedNext}`,
      );
    }
    const expectedFrom = index === 0 ? null : validEvents[index - 1].to;
    if (event.from !== expectedFrom) {
      fail("wakeflow-demand-core-event-chain", `$/events/${index}/from`, "event from-state must match the prior event tail");
    }
  }
  const demandChanges = matchingChangedArtifacts(validEvents, "wakeflow-demand");
  if (
    demandChanges.length !== 1
    || validEvents[0].changedArtifacts.every((entry) => entry.artifactKind !== "wakeflow-demand")
    || demandChanges[0].digest !== canonicalJsonDigest(validDemand)
  ) {
    fail(
      "wakeflow-demand-core-event-chain",
      "$/events/0/changedArtifacts",
      "initial event must bind the one immutable demand record and no later event may rewrite it",
    );
  }
  const authorityChanges = matchingChangedArtifacts(validEvents, "wakeflow-demand-authority");
  if (validAuthority === null && authorityChanges.length !== 0) {
    fail("wakeflow-demand-core-event-chain", "$/events", "event history references authority but no authority file exists");
  }
  if (
    validAuthority !== null
    && (authorityChanges.length !== 1 || authorityChanges[0].digest !== canonicalJsonDigest(validAuthority))
  ) {
    fail(
      "wakeflow-demand-core-event-chain",
      "$/events",
      "event history must bind the immutable authority exactly once",
    );
  }
  for (const tuple of currentArtifactStateTuples(validState)) {
    const changes = matchingChangedArtifacts(validEvents, tuple.artifactKind)
      .filter((entry) => entry.artifactId === tuple.artifactId);
    if (
      changes.length !== 1
      || changes[0].ref !== tuple.ref
      || changes[0].digest !== tuple.digest
    ) {
      fail(
        "wakeflow-demand-core-artifact-state",
        "$/events",
        `state artifact ${tuple.artifactId} must be bound by exactly one matching controller event`,
      );
    }
  }
  const evidenceChanges = matchingChangedArtifacts(validEvents, "wakeflow-evidence");
  if (evidenceChanges.length !== validState.evidence.length) {
    fail(
      "wakeflow-demand-core-artifact-state",
      "$/events",
      "every managed evidence event must remain present as one exact state manifest identity",
    );
  }
  assertDeliveryStackClosure(validState, validEvents);
  assertPodStackClosure(validState, validEvents);
  const tail = validEvents.at(-1);
  if (
    validState.revision !== tail.nextRevision
    || validState.state !== tail.to
    || validState.stateReason !== tail.reason
    || validState.updatedAt !== tail.createdAt
    || validState.lastEvent.eventId !== tail.eventId
    || validState.lastEvent.eventDigest !== canonicalJsonDigest(tail)
  ) {
    fail(
      "wakeflow-demand-core-stack-tail",
      "$/state/lastEvent",
      "state snapshot must match the exact final event revision, state, timestamp, reason, ID, and digest",
    );
  }
  return deepFreeze({
    demand: validDemand,
    authority: validAuthority,
    state: validState,
    events: validEvents,
    digests: deepFreeze({
      demand: canonicalJsonDigest(validDemand),
      authority: validAuthority ? canonicalJsonDigest(validAuthority) : null,
      state: canonicalJsonDigest(validState),
      lastEvent: canonicalJsonDigest(tail),
    }),
  });
}

function validateArtifactWrite(value, errorPath, { demand, ledgerRoot }) {
  if (value?.artifactKind === "wakeflow-demand-authority") {
    assertExactKeys(value, ["artifactKind", "ref", "digest", "value"], [], errorPath);
    if (value.ref !== WAKEFLOW_DEMAND_AUTHORITY_FILE) {
      fail(
        "wakeflow-demand-core-transition-artifact",
        `${errorPath}/ref`,
        `authority write ref must be ${WAKEFLOW_DEMAND_AUTHORITY_FILE}`,
      );
    }
    const authority = validateDemandAuthorityRecord(value.value, { demand, ledgerRoot });
    if (value.digest !== canonicalJsonDigest(authority)) {
      fail("wakeflow-demand-core-transition-artifact", `${errorPath}/digest`, "artifact write digest must match its canonical value");
    }
    return frozenClone(value);
  }
  try {
    if (value?.artifactKind === "wakeflow-evidence") {
      return validateEvidenceWriteIntent(value, { demand });
    }
    return validateDemandArtifactWriteIntent(value, { demand });
  } catch (cause) {
    fail(
      "wakeflow-demand-core-transition-artifact",
      errorPath,
      "state transition artifact create intent is invalid",
      { causeCode: cause?.code ?? null },
      cause,
    );
  }
}

function artifactSummaryProjection(state) {
  return Object.fromEntries(ARTIFACT_STATE_KEYS.map((key) => [
    key,
    Object.hasOwn(state, key) ? state[key] : null,
  ]));
}

function artifactSummaryField(value) {
  if (value.artifactKind === "wakeflow-task-package") return ["taskPackages", "targetTasks"];
  if (value.artifactKind === "wakeflow-target-result") return ["targetResults", "targetTasks"];
  if (value.artifactKind === "wakeflow-review-candidate") return ["review"];
  if (value.artifactKind === "wakeflow-test-card") return ["testCards"];
  if (value.artifactKind === "wakeflow-evidence") return ["evidence"];
  return [];
}

function stateContainsArtifactIdentity(state, identity) {
  if (!Object.hasOwn(state, "taskPackages")) return false;
  if (identity.artifactKind === "wakeflow-task-package") {
    return state.taskPackages.some((entry) => (
      entry.taskPackageId === identity.artifactId
      && entry.ref === identity.ref
      && entry.digest === identity.digest
    ));
  }
  if (identity.artifactKind === "wakeflow-target-result") {
    return state.targetResults.some((entry) => (
      entry.targetResultId === identity.artifactId
      && entry.ref === identity.ref
      && entry.digest === identity.digest
    ));
  }
  if (identity.artifactKind === "wakeflow-test-card") {
    return state.testCards.some((entry) => (
      entry.testCardId === identity.artifactId
      && entry.ref === identity.ref
      && entry.digest === identity.digest
    ));
  }
  if (identity.artifactKind === "wakeflow-review-candidate") {
    return state.review.pendingCandidate?.reviewCandidateId === identity.artifactId
      && state.review.pendingCandidate.ref === identity.ref
      && state.review.pendingCandidate.digest === identity.digest;
  }
  if (identity.artifactKind === "wakeflow-evidence") {
    return state.evidence.some((entry) => (
      entry.evidenceId === identity.artifactId
      && entry.ref === identity.ref
      && entry.digest === identity.digest
    ));
  }
  if (identity.artifactKind === "wakeflow-pod-design-request") {
    return state.pod?.designRequest?.podDesignRequestId === identity.artifactId
      && state.pod.designRequest.ref === identity.ref
      && state.pod.designRequest.digest === identity.digest;
  }
  if (identity.artifactKind === "wakeflow-pod-design-handoff") {
    return state.pod?.designHandoff?.podDesignHandoffId === identity.artifactId
      && state.pod.designHandoff.ref === identity.ref
      && state.pod.designHandoff.digest === identity.digest;
  }
  return false;
}

function optionalCanonical(value) {
  return canonicalJson(value === undefined ? null : value);
}

function eventAuthorityFor(event) {
  return {
    revision: event.nextRevision,
    eventId: event.eventId,
    eventDigest: canonicalJsonDigest(event),
  };
}

function deliverySummaryProjection(delivery) {
  const projection = canonicalClone(delivery);
  for (const field of ["preparedBy", "authorizedBy", "claimedBy", "recordedBy"]) {
    if (!Object.hasOwn(projection, field)) continue;
    projection[field] = {
      revision: projection[field].revision,
      eventId: projection[field].eventId,
    };
  }
  return projection;
}

export function demandDeliverySummaryDigest(delivery) {
  return canonicalJsonDigest(deliverySummaryProjection(delivery));
}

function testLineageProjection(testAttempts) {
  return canonicalClone(testAttempts).map((attempt) => ({
    ...attempt,
    deliveryAuthorizations: attempt.deliveryAuthorizations.map((authorization) => ({
      ...authorization,
      authorizedBy: {
        revision: authorization.authorizedBy.revision,
        eventId: authorization.authorizedBy.eventId,
      },
    })),
  }));
}

export function demandTestLineageDigest(testAttempts) {
  return canonicalJsonDigest(testLineageProjection(testAttempts));
}

function deliveryStaticTaskProjection(task) {
  const projection = { ...task };
  delete projection.lifecycleStatus;
  delete projection.currentDelivery;
  delete projection.testAttempts;
  return projection;
}

function assertDeliveryAuthorityPreserved(previousState, nextState) {
  const previousTasks = new Map(previousState.targetTasks.map((task) => [task.targetTaskId, task]));
  const nextTasks = new Map(nextState.targetTasks.map((task) => [task.targetTaskId, task]));
  for (const previousTask of previousState.targetTasks) {
    const nextTask = nextTasks.get(previousTask.targetTaskId);
    if (!nextTask) {
      fail(
        "wakeflow-demand-core-delivery-authority",
        "$/nextState/targetTasks",
        `ordinary artifact transition cannot remove existing target task ${previousTask.targetTaskId}`,
      );
    }
    for (const field of ["currentDelivery", "testAttempts"]) {
      if (optionalCanonical(previousTask[field]) !== optionalCanonical(nextTask[field])) {
        fail(
          "wakeflow-demand-core-delivery-authority",
          `$/nextState/targetTasks/${previousTask.targetTaskId}/${field}`,
          `non-delivery transition cannot change target ${field}`,
        );
      }
    }
  }
  for (const nextTask of nextState.targetTasks) {
    if (previousTasks.has(nextTask.targetTaskId)) continue;
    if (
      Object.hasOwn(nextTask, "currentDelivery")
      || (Array.isArray(nextTask.testAttempts) && nextTask.testAttempts.length !== 0)
    ) {
      fail(
        "wakeflow-demand-core-delivery-authority",
        `$/nextState/targetTasks/${nextTask.targetTaskId}`,
        "a generic task-creation transition cannot inject delivery or Test-attempt authority",
      );
    }
  }
}

function exactEventForPointer(events, pointer, errorPath) {
  if (
    !Array.isArray(events)
    || pointer.revision < 1
    || pointer.revision > events.length
  ) {
    fail(
      "wakeflow-demand-core-delivery-event",
      errorPath,
      "delivery event pointer must resolve by exact revision in controller history",
    );
  }
  const event = validateControllerEventRecord(events[pointer.revision - 1]);
  if (
    event.nextRevision !== pointer.revision
    || event.eventId !== pointer.eventId
    || canonicalJsonDigest(event) !== pointer.eventDigest
  ) {
    fail(
      "wakeflow-demand-core-delivery-event",
      errorPath,
      "delivery event pointer must match the exact event revision, ID, and digest",
    );
  }
  return event;
}

function assertDeliverySourceState(
  sourceState,
  previousState,
  nextDelivery,
  targetTaskId,
  events,
) {
  const isImmediateSource = (
    sourceState.revision !== previousState.revision
    ? false
    : sourceState.stateDigest === canonicalJsonDigest(previousState)
      && sourceState.eventId === previousState.lastEvent.eventId
      && sourceState.eventDigest === previousState.lastEvent.eventDigest
  );
  if (isImmediateSource) return;
  if (
    sourceState.revision >= previousState.revision
    || !Array.isArray(events)
    || events.length !== previousState.revision
  ) {
    fail(
      "wakeflow-demand-core-delivery-source",
      "$/nextState/targetTasks/currentDelivery/sourceState",
      "non-immediate delivery source requires the exact complete previous event history",
    );
  }
  exactEventForPointer(events, sourceState, "$/nextState/targetTasks/currentDelivery/sourceState");
  exactEventForPointer(
    events,
    { revision: previousState.revision, ...previousState.lastEvent },
    "$/previousState/lastEvent",
  );
  const previousTask = previousState.targetTasks.find(
    (task) => task.targetTaskId === targetTaskId,
  );
  const rejectedSameGroupContinuation = (
    previousTask?.currentDelivery?.phase === "rejected-before-send"
    && sameTransportTuple(previousTask.currentDelivery.group, nextDelivery.group, "groupId")
    && canonicalJson(previousTask.currentDelivery.sourceState) === canonicalJson(sourceState)
  );
  if (rejectedSameGroupContinuation) {
    assertDeliveryStackClosure(previousState, events);
    for (const event of events.slice(previousTask.currentDelivery.authorizedBy.revision)) {
      if (!event.deliveryTransition || event.changedArtifacts.length !== 0) {
        fail(
          "wakeflow-demand-core-delivery-source",
          `$/events/${event.nextRevision - 1}`,
          "rejected same-group replacement cannot cross a non-delivery state transition",
        );
      }
    }
    return;
  }
  for (const [offset, rawEvent] of events
    .slice(sourceState.revision, previousState.revision)
    .entries()) {
    const event = validateControllerEventRecord(rawEvent);
    const expectedRevision = sourceState.revision + offset + 1;
    const sibling = previousState.targetTasks.find(
      (task) => task.targetTaskId === event.deliveryTransition?.targetTaskId,
    );
    if (
      event.nextRevision !== expectedRevision
      || event.command !== "prepare-target-delivery"
      || event.changedArtifacts.length !== 0
      || event.deliveryTransition.targetTaskId === targetTaskId
      || !sibling?.currentDelivery
      || !sameTransportTuple(sibling.currentDelivery.group, nextDelivery.group, "groupId")
      || canonicalJson(sibling.currentDelivery.sourceState) !== canonicalJson(sourceState)
      || canonicalJson(sibling.currentDelivery.preparedBy) !== canonicalJson(eventAuthorityFor(event))
    ) {
      fail(
        "wakeflow-demand-core-delivery-source",
        `$/events/${expectedRevision - 1}`,
        "shared-source preparation may cross only exact earlier-member prepare events from the same immutable dispatch group",
      );
    }
  }
}

function assertDeliveryEventSummary({ previousDelivery, nextDelivery, transition }) {
  const previousDigest = previousDelivery === null ? null : demandDeliverySummaryDigest(previousDelivery);
  const nextDigest = demandDeliverySummaryDigest(nextDelivery);
  if (
    transition.deliveryId !== nextDelivery.envelope.deliveryId
    || transition.envelopeDigest !== nextDelivery.envelope.digest
    || transition.sendGeneration !== nextDelivery.sendGeneration
    || transition.fromPhase !== (previousDelivery?.phase ?? null)
    || transition.toPhase !== nextDelivery.phase
    || transition.previousSummaryDigest !== previousDigest
    || transition.nextSummaryDigest !== nextDigest
  ) {
    fail(
      "wakeflow-demand-core-delivery-summary",
      "$/nextEvent/deliveryTransition",
      "delivery event must bind the exact previous and next currentDelivery summaries",
    );
  }
}

function assertExactTestDeliveryAuthorization({
  previousTask,
  nextTask,
  previousDelivery,
  nextDelivery,
  event,
}) {
  const previousAttempts = previousTask.testAttempts;
  const nextAttempts = nextTask.testAttempts;
  if (!Array.isArray(previousAttempts) || !Array.isArray(nextAttempts)) {
    fail(
      "wakeflow-demand-core-test-attempt",
      "$/nextState/targetTasks/testAttempts",
      "Test delivery preparation requires explicit Test attempt lineage",
    );
  }
  const authority = eventAuthorityFor(event);
  const matchesCurrentDelivery = (authorization) => (
    sameTransportTuple(authorization.group, nextDelivery.group, "groupId")
    && sameTransportTuple(authorization.packet, nextDelivery.packet, "packetId")
    && sameTransportTuple(authorization.envelope, nextDelivery.envelope, "deliveryId")
    && canonicalJson(authorization.authorizedBy) === canonicalJson(authority)
  );
  const appendsLogicalAttempt = (
    nextAttempts.length === previousAttempts.length + 1
    && canonicalJson(nextAttempts.slice(0, -1)) === canonicalJson(previousAttempts)
  );
  if (appendsLogicalAttempt) {
    const appended = nextAttempts.at(-1);
    const authorization = appended.deliveryAuthorizations[0];
    if (
      appended.deliveryAuthorizations.length !== 1
      || canonicalJson(appended.testCard) !== canonicalJson(nextTask.testCard)
      || !matchesCurrentDelivery(authorization)
      || Object.hasOwn(authorization, "replacesRun")
      || appended.testAttemptId !== nextDelivery.testAttemptId
    ) {
      fail(
        "wakeflow-demand-core-test-attempt",
        "$/nextState/targetTasks/testAttempts",
        "new logical Test attempt must begin with one exact delivery authorization",
      );
    }
    if (previousAttempts.length > 0) {
      if (
        !previousTask.currentResult
        || canonicalJson(appended.previousResult) !== canonicalJson(previousTask.currentResult)
      ) {
        fail(
          "wakeflow-demand-core-test-attempt",
          "$/nextState/targetTasks/testAttempts",
          "later Test attempt must bind the exact result current at authorization time",
        );
      }
    }
    return "new-attempt";
  }

  if (previousAttempts.length === 0 || nextAttempts.length !== previousAttempts.length) {
    fail(
      "wakeflow-demand-core-test-attempt",
      "$/nextState/targetTasks/testAttempts",
      "Test delivery preparation must append one logical attempt or one authorization",
    );
  }
  const previousAttempt = previousAttempts.at(-1);
  const nextAttempt = nextAttempts.at(-1);
  const previousAttemptStatic = { ...previousAttempt };
  const nextAttemptStatic = { ...nextAttempt };
  delete previousAttemptStatic.deliveryAuthorizations;
  delete nextAttemptStatic.deliveryAuthorizations;
  const previousAuthorizations = previousAttempt.deliveryAuthorizations;
  const nextAuthorizations = nextAttempt.deliveryAuthorizations;
  const appendedAuthorization = nextAuthorizations.at(-1);
  if (
    canonicalJson(nextAttempts.slice(0, -1)) !== canonicalJson(previousAttempts.slice(0, -1))
    || canonicalJson(nextAttemptStatic) !== canonicalJson(previousAttemptStatic)
    || nextAuthorizations.length !== previousAuthorizations.length + 1
    || canonicalJson(nextAuthorizations.slice(0, -1)) !== canonicalJson(previousAuthorizations)
    || !previousDelivery
    || previousDelivery.phase !== "rejected-before-send"
    || !previousDelivery.latestRun
    || !matchesCurrentDelivery(appendedAuthorization)
    || canonicalJson(appendedAuthorization.replacesRun) !== canonicalJson(previousDelivery.latestRun)
    || nextDelivery.testAttemptId !== previousAttempt.testAttemptId
  ) {
    fail(
      "wakeflow-demand-core-test-attempt",
      "$/nextState/targetTasks/testAttempts",
      "replacement Test envelope must append one exact authorization to the same rejected logical attempt",
    );
  }
  return "replacement-authorization";
}

function acceptedDemandState(targetTasks) {
  const hasUnsettledDispatch = targetTasks.some((task) => [
    "planned",
    "dispatched",
    "needs-rework",
  ].includes(task.lifecycleStatus));
  return hasUnsettledDispatch ? "dispatched" : "waiting-results";
}

function validateDeliveryTransitionDelta({
  previousState,
  nextState,
  nextEvent,
  artifactWrites,
  events,
}) {
  const transition = nextEvent.deliveryTransition;
  if (artifactWrites.length !== 0 || nextEvent.changedArtifacts.length !== 0) {
    fail(
      "wakeflow-demand-core-delivery-transition",
      "$",
      "delivery transition cannot create immutable artifacts or name changed artifacts",
    );
  }
  for (const key of ARTIFACT_STATE_KEYS) {
    if (key === "targetTasks") continue;
    if (canonicalJson(previousState[key]) !== canonicalJson(nextState[key])) {
      fail(
        "wakeflow-demand-core-delivery-transition",
        `$/nextState/${key}`,
        `delivery transition cannot change ${key}`,
      );
    }
  }
  if (previousState.targetTasks.length !== nextState.targetTasks.length) {
    fail(
      "wakeflow-demand-core-delivery-transition",
      "$/nextState/targetTasks",
      "delivery transition cannot add or remove target tasks",
    );
  }
  const previousTasks = new Map(previousState.targetTasks.map((task) => [task.targetTaskId, task]));
  const nextTasks = new Map(nextState.targetTasks.map((task) => [task.targetTaskId, task]));
  const changedTaskIds = previousState.targetTasks
    .filter((task) => optionalCanonical(task) !== optionalCanonical(nextTasks.get(task.targetTaskId)))
    .map((task) => task.targetTaskId);
  if (
    changedTaskIds.length !== 1
    || changedTaskIds[0] !== transition.targetTaskId
    || !nextTasks.has(transition.targetTaskId)
  ) {
    fail(
      "wakeflow-demand-core-delivery-transition",
      "$/nextState/targetTasks",
      "delivery transition must change exactly its named target task",
    );
  }
  const previousTask = previousTasks.get(transition.targetTaskId);
  const nextTask = nextTasks.get(transition.targetTaskId);
  if (
    !previousTask
    || canonicalJson(deliveryStaticTaskProjection(previousTask))
      !== canonicalJson(deliveryStaticTaskProjection(nextTask))
  ) {
    fail(
      "wakeflow-demand-core-delivery-transition",
      "$/nextState/targetTasks",
      "delivery transition cannot change target assignment, package, repository, result, or TestCard",
    );
  }
  const previousDelivery = previousTask.currentDelivery ?? null;
  const nextDelivery = nextTask.currentDelivery ?? null;
  if (!nextDelivery) {
    fail(
      "wakeflow-demand-core-delivery-transition",
      "$/nextState/targetTasks/currentDelivery",
      "delivery transition must publish one currentDelivery summary",
    );
  }
  assertDeliveryEventSummary({ previousDelivery, nextDelivery, transition });
  const authority = eventAuthorityFor(nextEvent);

  if (nextEvent.command === "prepare-target-delivery") {
    if (
      nextDelivery.sendGeneration !== 1
      || nextDelivery.phase !== "prepared"
      || canonicalJson(nextDelivery.preparedBy) !== canonicalJson(authority)
      || canonicalJson(nextDelivery.authorizedBy) !== canonicalJson(authority)
      || Object.hasOwn(nextDelivery, "claimedBy")
      || Object.hasOwn(nextDelivery, "recordedBy")
      || Object.hasOwn(nextDelivery, "latestRun")
      || Object.hasOwn(nextDelivery, "rearmedFrom")
    ) {
      fail(
        "wakeflow-demand-core-delivery-transition",
        "$/nextState/targetTasks/currentDelivery",
        "new delivery must publish one clean generation-one prepared summary authorized by this event",
      );
    }
    assertDeliverySourceState(
      nextDelivery.sourceState,
      previousState,
      nextDelivery,
      transition.targetTaskId,
      events,
    );
    if (previousDelivery === null) {
      if (previousTask.lifecycleStatus !== "planned") {
        fail(
          "wakeflow-demand-core-delivery-transition",
          "$/previousState/targetTasks/lifecycleStatus",
          "first delivery requires a planned target task",
        );
      }
    } else {
      const replacesRejectedEnvelope = previousDelivery.phase === "rejected-before-send"
        && ["dispatched", "needs-rework"].includes(previousTask.lifecycleStatus);
      const startsReworkDelivery = ["accepted", "ambiguous"].includes(previousDelivery.phase)
        && previousTask.lifecycleStatus === "needs-rework";
      if (
        (!replacesRejectedEnvelope && !startsReworkDelivery)
        || previousDelivery.envelope.deliveryId === nextDelivery.envelope.deliveryId
      ) {
        fail(
          "wakeflow-demand-core-delivery-transition",
          "$/previousState/targetTasks/currentDelivery",
          "new envelope requires a rejected prior authorization or needs-rework after an accepted/ambiguous delivery",
        );
      }
    }
    if (nextTask.lifecycleStatus !== "dispatched") {
      fail(
        "wakeflow-demand-core-delivery-transition",
        "$/nextState/targetTasks/lifecycleStatus",
        "prepared delivery must move its target task to dispatched",
      );
    }
    const expectedDemandState = ["planned", "needs-rework"].includes(previousState.state)
      ? "dispatched"
      : previousState.state;
    if (expectedDemandState !== "dispatched" || nextState.state !== expectedDemandState) {
      fail(
        "wakeflow-demand-core-delivery-transition",
        "$/nextState/state",
        "delivery preparation requires planned, needs-rework, or dispatched demand state and yields dispatched",
      );
    }
    if (Object.hasOwn(previousTask, "testCard")) {
      const testChange = assertExactTestDeliveryAuthorization({
        previousTask,
        nextTask,
        previousDelivery,
        nextDelivery,
        event: nextEvent,
      });
      if (
        (previousDelivery?.phase === "rejected-before-send")
          !== (testChange === "replacement-authorization")
      ) {
        fail(
          "wakeflow-demand-core-test-attempt",
          "$/nextState/targetTasks/testAttempts",
          "rejected Test delivery must retain its logical attempt; a new logical attempt requires a non-rejected predecessor",
        );
      }
      if (
        transition.testAttemptId !== nextDelivery.testAttemptId
        || transition.testLineageDigest !== demandTestLineageDigest(nextTask.testAttempts)
      ) {
        fail(
          "wakeflow-demand-core-test-attempt",
          "$/nextEvent/deliveryTransition",
          "Test delivery preparation must bind the exact selected attempt and append-only lineage digest",
        );
      }
    } else if (Object.hasOwn(nextTask, "testAttempts")) {
      fail(
        "wakeflow-demand-core-test-attempt",
        "$/nextState/targetTasks/testAttempts",
        "non-Test delivery cannot create logical Test attempt lineage",
      );
    } else if (
      Object.hasOwn(transition, "testAttemptId")
      || Object.hasOwn(transition, "testLineageDigest")
    ) {
      fail(
        "wakeflow-demand-core-test-attempt",
        "$/nextEvent/deliveryTransition",
        "non-Test delivery preparation cannot carry Test attempt lineage",
      );
    }
    return;
  }

  if (!previousDelivery) {
    fail(
      "wakeflow-demand-core-delivery-transition",
      "$/previousState/targetTasks/currentDelivery",
      "claim, settlement, and rearm require an existing currentDelivery summary",
    );
  }
  if (optionalCanonical(previousTask.testAttempts) !== optionalCanonical(nextTask.testAttempts)) {
    fail(
      "wakeflow-demand-core-test-attempt",
      "$/nextState/targetTasks/testAttempts",
      "same-envelope delivery transitions cannot change logical Test attempt lineage",
    );
  }
  if (nextEvent.command === "claim-target-delivery-send") {
    if (previousTask.lifecycleStatus !== "dispatched") {
      fail(
        "wakeflow-demand-core-delivery-transition",
        "$/previousState/targetTasks/lifecycleStatus",
        "pre-send claim requires a dispatched target task",
      );
    }
    const expected = structuredClone(previousDelivery);
    expected.phase = "send-claimed";
    expected.claimedBy = authority;
    if (
      canonicalJson(nextDelivery) !== canonicalJson(expected)
      || nextTask.lifecycleStatus !== previousTask.lifecycleStatus
      || nextState.state !== previousState.state
    ) {
      fail(
        "wakeflow-demand-core-delivery-transition",
        "$/nextState/targetTasks/currentDelivery",
        "send claim may change only prepared phase and exact claimedBy event pointer",
      );
    }
    return;
  }

  if (nextEvent.command === "record-target-delivery-run") {
    const expected = structuredClone(previousDelivery);
    expected.phase = transition.toPhase;
    expected.recordedBy = authority;
    expected.latestRun = transition.run;
    const advancesLifecycle = transition.toPhase === "accepted"
      && previousTask.lifecycleStatus === "dispatched"
      && previousState.state === "dispatched"
      && previousState.review.status === "idle";
    const expectedLifecycle = advancesLifecycle
      ? "waiting-result"
      : previousTask.lifecycleStatus;
    const expectedState = advancesLifecycle
      ? acceptedDemandState(nextState.targetTasks)
      : previousState.state;
    if (
      canonicalJson(nextDelivery) !== canonicalJson(expected)
      || nextTask.lifecycleStatus !== expectedLifecycle
      || nextState.state !== expectedState
    ) {
      fail(
        "wakeflow-demand-core-delivery-transition",
        "$/nextState/targetTasks/currentDelivery",
        "delivery run settlement may add only its exact run/event and deterministic lifecycle state",
      );
    }
    return;
  }

  if (nextEvent.command === "rearm-target-delivery") {
    if (previousTask.lifecycleStatus !== "dispatched") {
      fail(
        "wakeflow-demand-core-delivery-transition",
        "$/previousState/targetTasks/lifecycleStatus",
        "delivery rearm requires an active dispatched target task",
      );
    }
    const expected = structuredClone(previousDelivery);
    expected.phase = "prepared";
    expected.sendGeneration += 1;
    expected.lease = nextDelivery.lease;
    expected.authorizedBy = authority;
    expected.rearmedFrom = previousDelivery.latestRun;
    delete expected.claimedBy;
    delete expected.recordedBy;
    delete expected.latestRun;
    const renewsExactLease = (
      nextDelivery.lease.ref === previousDelivery.lease.ref
      && nextDelivery.lease.leaseId !== previousDelivery.lease.leaseId
      && nextDelivery.lease.digest !== previousDelivery.lease.digest
    );
    if (
      canonicalJson(transition.run) !== canonicalJson(previousDelivery.latestRun)
      || !renewsExactLease
      || canonicalJson(nextDelivery) !== canonicalJson(expected)
      || nextTask.lifecycleStatus !== previousTask.lifecycleStatus
      || nextState.state !== previousState.state
    ) {
      fail(
        "wakeflow-demand-core-delivery-transition",
        "$/nextState/targetTasks/currentDelivery",
        "rearm may only advance generation, replace the lease, bind the rejected run, and renew authorization",
      );
    }
  }
}

function reviewStaticTaskProjection(task) {
  const projection = { ...task };
  delete projection.lifecycleStatus;
  return projection;
}

function validateReviewDecisionDelta({
  previousState,
  nextState,
  nextEvent,
  artifactWrites,
}) {
  const transition = nextEvent.reviewDecision;
  if (artifactWrites.length !== 0 || nextEvent.changedArtifacts.length !== 0) {
    fail(
      "wakeflow-demand-core-review-transition",
      "$/artifactWrites",
      "review decision cannot create or name immutable artifact changes",
    );
  }
  if (
    previousState.state !== "review-ready"
    || previousState.review.status !== "pending"
    || previousState.review.missingTargetTaskIds.length !== 0
    || !previousState.review.pendingCandidate
  ) {
    fail(
      "wakeflow-demand-core-review-transition",
      "$/previousState/review",
      "review decision requires one pending complete review candidate",
    );
  }
  if (
    canonicalJson(previousState.review.pendingCandidate) !== canonicalJson(transition.candidate)
    || canonicalJsonDigest(previousState.review) !== transition.previousReviewDigest
  ) {
    fail(
      "wakeflow-demand-core-review-transition",
      "$/nextEvent/reviewDecision",
      "review decision must bind the exact pending candidate and previous review digest",
    );
  }
  const expectedTargetTaskIds = [
    ...previousState.review.readyTargetTaskIds,
    ...previousState.review.blockedTargetTaskIds,
  ].sort((left, right) => left.localeCompare(right));
  if (canonicalJson(expectedTargetTaskIds) !== canonicalJson(transition.targetTaskIds)) {
    fail(
      "wakeflow-demand-core-review-transition",
      "$/nextEvent/reviewDecision/targetTaskIds",
      "review decision target set must equal the exact pending review scope",
    );
  }
  const nextReview = {
    status: "idle",
    readyTargetTaskIds: [],
    blockedTargetTaskIds: [],
    missingTargetTaskIds: [],
  };
  if (
    canonicalJson(nextState.review) !== canonicalJson(nextReview)
    || canonicalJsonDigest(nextReview) !== transition.nextReviewDigest
  ) {
    fail(
      "wakeflow-demand-core-review-transition",
      "$/nextState/review",
      "review decision must clear only to the canonical idle review boundary",
    );
  }
  if (transition.decision === "accept" && previousState.review.blockedTargetTaskIds.length !== 0) {
    fail(
      "wakeflow-demand-core-review-transition",
      "$/nextEvent/reviewDecision/decision",
      "accept cannot select a review scope containing a blocked result",
    );
  }
  const expectedEventType = REVIEW_DECISION_EVENT_TYPES[transition.decision];
  const expectedDemandState = transition.decision === "accept"
    ? "planned"
    : transition.decision === "blocked"
      ? "blocked"
      : "needs-rework";
  if (
    nextEvent.type !== expectedEventType
    || nextEvent.from !== previousState.state
    || nextEvent.to !== expectedDemandState
    || nextState.state !== expectedDemandState
  ) {
    fail(
      "wakeflow-demand-core-review-transition",
      "$/nextEvent",
      "review decision type and demand-state edge must match the fixed decision contract",
    );
  }
  const scope = new Set(transition.targetTaskIds);
  if (previousState.targetTasks.length !== nextState.targetTasks.length) {
    fail(
      "wakeflow-demand-core-review-transition",
      "$/nextState/targetTasks",
      "review decision cannot add or remove target tasks",
    );
  }
  const previousTaskById = new Map(previousState.targetTasks.map((task) => [task.targetTaskId, task]));
  const nextTaskById = new Map(nextState.targetTasks.map((task) => [task.targetTaskId, task]));
  const scopedPackageIds = new Set();
  const scopedTestCardIds = new Set();
  for (const [targetTaskId, previousTask] of previousTaskById) {
    const nextTask = nextTaskById.get(targetTaskId);
    if (!nextTask) {
      fail("wakeflow-demand-core-review-transition", "$/nextState/targetTasks", "review task disappeared");
    }
    if (!scope.has(targetTaskId)) {
      if (canonicalJson(previousTask) !== canonicalJson(nextTask)) {
        fail(
          "wakeflow-demand-core-review-transition",
          `$/nextState/targetTasks/${targetTaskId}`,
          "review decision cannot change a task outside its exact scope",
        );
      }
      continue;
    }
    const wasReady = previousState.review.readyTargetTaskIds.includes(targetTaskId);
    const expectedPreviousLifecycle = wasReady ? "review-ready" : "blocked";
    const expectedNextLifecycle = transition.decision === "accept" ? "accepted" : "needs-rework";
    if (
      previousTask.lifecycleStatus !== expectedPreviousLifecycle
      || nextTask.lifecycleStatus !== expectedNextLifecycle
      || canonicalJson(reviewStaticTaskProjection(previousTask))
        !== canonicalJson(reviewStaticTaskProjection(nextTask))
    ) {
      fail(
        "wakeflow-demand-core-review-transition",
        `$/nextState/targetTasks/${targetTaskId}`,
        "review decision may change only the scoped task lifecycle while preserving result/delivery/Test authority",
      );
    }
    scopedPackageIds.add(previousTask.taskPackageId);
    if (previousTask.testCard) scopedTestCardIds.add(previousTask.testCard.testCardId);
    if (transition.decision === "redesign" && !Object.hasOwn(previousTask, "repositoryId")) {
      fail(
        "wakeflow-demand-core-review-transition",
        `$/previousState/targetTasks/${targetTaskId}`,
        "redesign is limited to repository-backed product targets",
      );
    }
  }
  if (previousState.taskPackages.length !== nextState.taskPackages.length) {
    fail(
      "wakeflow-demand-core-review-transition",
      "$/nextState/taskPackages",
      "review decision cannot add or remove task packages",
    );
  }
  const nextPackageById = new Map(nextState.taskPackages.map((entry) => [entry.taskPackageId, entry]));
  for (const previousPackage of previousState.taskPackages) {
    const nextPackage = nextPackageById.get(previousPackage.taskPackageId);
    const expected = structuredClone(previousPackage);
    if (scope.size > 0 && scopedPackageIds.has(previousPackage.taskPackageId)) {
      if (previousPackage.lifecycleStatus !== "active") {
        fail(
          "wakeflow-demand-core-review-transition",
          "$/previousState/taskPackages",
          "review decision requires active scoped task packages",
        );
      }
      if (transition.decision === "accept") expected.lifecycleStatus = "closed";
    }
    if (!nextPackage || canonicalJson(nextPackage) !== canonicalJson(expected)) {
      fail(
        "wakeflow-demand-core-review-transition",
        `$/nextState/taskPackages/${previousPackage.taskPackageId}`,
        "review decision task-package delta is invalid",
      );
    }
  }
  if (previousState.testCards.length !== nextState.testCards.length) {
    fail(
      "wakeflow-demand-core-review-transition",
      "$/nextState/testCards",
      "review decision cannot add or remove TestCards",
    );
  }
  const nextCardById = new Map(nextState.testCards.map((entry) => [entry.testCardId, entry]));
  for (const previousCard of previousState.testCards) {
    const nextCard = nextCardById.get(previousCard.testCardId);
    const expected = structuredClone(previousCard);
    if (scopedTestCardIds.has(previousCard.testCardId)) {
      if (previousCard.lifecycleStatus !== "active") {
        fail(
          "wakeflow-demand-core-review-transition",
          "$/previousState/testCards",
          "review decision requires active scoped TestCards",
        );
      }
      if (transition.decision === "accept") expected.lifecycleStatus = "closed";
    }
    if (!nextCard || canonicalJson(nextCard) !== canonicalJson(expected)) {
      fail(
        "wakeflow-demand-core-review-transition",
        `$/nextState/testCards/${previousCard.testCardId}`,
        "review decision TestCard delta is invalid",
      );
    }
  }
  for (const key of ["targetResults", "evidence"]) {
    if (canonicalJson(previousState[key]) !== canonicalJson(nextState[key])) {
      fail(
        "wakeflow-demand-core-review-transition",
        `$/nextState/${key}`,
        `review decision cannot change ${key}`,
      );
    }
  }
}

function lifecycleAuthorityTuple(state) {
  return Object.hasOwn(state, "demandAuthorityRef")
    ? `${state.demandAuthorityRef}\u0000${state.demandAuthorityDigest}`
    : null;
}

function canonicalIdleReview() {
  return {
    status: "idle",
    readyTargetTaskIds: [],
    blockedTargetTaskIds: [],
    missingTargetTaskIds: [],
  };
}

function lifecycleCancelledTask(task) {
  const expected = structuredClone(task);
  if (!["accepted", "cancelled", "superseded"].includes(expected.lifecycleStatus)) {
    expected.lifecycleStatus = "cancelled";
  }
  return expected;
}

function lifecycleClosedArtifact(entry) {
  const expected = structuredClone(entry);
  if (expected.lifecycleStatus === "active") expected.lifecycleStatus = "closed";
  return expected;
}

function validateLifecycleTransitionDelta({
  previousState,
  nextState,
  nextEvent,
  artifactWrites,
}) {
  const transition = nextEvent.lifecycleTransition;
  if (artifactWrites.length !== 0 || nextEvent.changedArtifacts.length !== 0) {
    fail(
      "wakeflow-demand-core-lifecycle-transition",
      "$/artifactWrites",
      "demand lifecycle transition cannot create or name immutable artifact changes",
    );
  }
  if (
    ["completed", "cancelled", "archived"].includes(previousState.state)
    || nextEvent.from !== previousState.state
  ) {
    fail(
      "wakeflow-demand-core-lifecycle-transition",
      "$/nextEvent",
      "demand lifecycle transition requires one exact nonterminal previous state",
    );
  }
  if (lifecycleAuthorityTuple(previousState) !== lifecycleAuthorityTuple(nextState)) {
    fail(
      "wakeflow-demand-core-lifecycle-transition",
      "$/nextState",
      "demand lifecycle transition cannot change frozen demand authority",
    );
  }
  for (const key of ["targetResults", "evidence"]) {
    if (canonicalJson(previousState[key]) !== canonicalJson(nextState[key])) {
      fail(
        "wakeflow-demand-core-lifecycle-transition",
        `$/nextState/${key}`,
        `demand lifecycle transition cannot change ${key}`,
      );
    }
  }
  const idleReview = canonicalIdleReview();
  if (canonicalJson(nextState.review) !== canonicalJson(idleReview)) {
    fail(
      "wakeflow-demand-core-lifecycle-transition",
      "$/nextState/review",
      "demand lifecycle transition must finish at the canonical idle review boundary",
    );
  }

  if (transition.action === "complete") {
    if (canonicalJson(previousState.review) !== canonicalJson(idleReview)) {
      fail(
        "wakeflow-demand-core-lifecycle-transition",
        "$/previousState/review",
        "completion requires the review authority to be idle before the terminal event",
      );
    }
    if (previousState.targetTasks.some((task) => !["accepted", "superseded"].includes(task.lifecycleStatus))) {
      fail(
        "wakeflow-demand-core-lifecycle-transition",
        "$/previousState/targetTasks",
        "completion requires every existing target task to be accepted or superseded",
      );
    }
    if (previousState.taskPackages.some((entry) => !["closed", "superseded"].includes(entry.lifecycleStatus))) {
      fail(
        "wakeflow-demand-core-lifecycle-transition",
        "$/previousState/taskPackages",
        "completion requires every existing task package to be closed or superseded",
      );
    }
    if (previousState.testCards.some((entry) => !["closed", "superseded"].includes(entry.lifecycleStatus))) {
      fail(
        "wakeflow-demand-core-lifecycle-transition",
        "$/previousState/testCards",
        "completion requires every existing TestCard to be closed or superseded",
      );
    }
    for (const key of ["targetTasks", "taskPackages", "testCards"]) {
      if (canonicalJson(previousState[key]) !== canonicalJson(nextState[key])) {
        fail(
          "wakeflow-demand-core-lifecycle-transition",
          `$/nextState/${key}`,
          `completion cannot change already-closed ${key}`,
        );
      }
    }
    return;
  }

  const expectedTasks = previousState.targetTasks.map(lifecycleCancelledTask);
  const expectedPackages = previousState.taskPackages.map(lifecycleClosedArtifact);
  const expectedCards = previousState.testCards.map(lifecycleClosedArtifact);
  for (const [key, expected] of [
    ["targetTasks", expectedTasks],
    ["taskPackages", expectedPackages],
    ["testCards", expectedCards],
  ]) {
    if (canonicalJson(nextState[key]) !== canonicalJson(expected)) {
      fail(
        "wakeflow-demand-core-lifecycle-transition",
        `$/nextState/${key}`,
        `cancellation may only close the exact current ${key} lifecycle while preserving its authority fields`,
      );
    }
  }
}

function optionalPodDigest(state) {
  return Object.hasOwn(state, "pod") ? canonicalJsonDigest(state.pod) : null;
}

function assertPodPlacementAuthority(demand, state, errorPath = "$/state/pod") {
  if (!Object.hasOwn(state, "pod")) return;
  if (demand.executionPlacement.mode !== "isolated") {
    fail("wakeflow-demand-core-pod-placement", errorPath, "only an explicitly isolated demand may own Pod authority");
  }
  const expected = canonicalJsonDigest(demand.executionPlacement.authorizationRef);
  if (state.pod.placementAuthorizationDigest !== expected) {
    fail(
      "wakeflow-demand-core-pod-placement",
      `${errorPath}/placementAuthorizationDigest`,
      "Pod state must bind the exact isolated placement authorization reference",
    );
  }
}

function podWindowStaticProjection(value) {
  const projection = { ...value };
  delete projection.status;
  delete projection.materializationFinalEvent;
  delete projection.identityBindingDigest;
  delete projection.creationReceipt;
  delete projection.close;
  delete projection.resourceClaimStatus;
  return projection;
}

function podWindowCloseStableProjection(value) {
  const projection = { ...value };
  delete projection.status;
  delete projection.close;
  delete projection.resourceClaimStatus;
  return projection;
}

function nextPodPhaseAfterBinding(pod) {
  const controls = pod.windows.filter((entry) => entry.role !== "product");
  if (!Object.hasOwn(pod, "designRequest")) {
    return controls.every((entry) => entry.status === "bound")
      ? "control-ready"
      : "creating-control";
  }
  if (!Object.hasOwn(pod, "designHandoff")) return "designing";
  return pod.windows.every((entry) => entry.status === "bound")
    ? "execution-ready"
    : "creating-products";
}

function podTestAccessPlanProjection(value) {
  return {
    probeId: value.probeId,
    attempt: value.attempt,
    ...(Object.hasOwn(value, "previousProbeId") ? { previousProbeId: value.previousProbeId } : {}),
    bindingSetDigest: value.bindingSetDigest,
    productBindingCount: value.productBindingCount,
    plan: value.plan,
    plannedAt: value.plannedAt,
  };
}

function assertPodStateOnlyDelta(previousState, nextState) {
  for (const key of ARTIFACT_STATE_KEYS) {
    if (canonicalJson(previousState[key]) !== canonicalJson(nextState[key])) {
      fail(
        "wakeflow-demand-core-pod-owner",
        `$/nextState/${key}`,
        `Pod transition cannot change ${key}`,
      );
    }
  }
  const beforeAuthority = Object.hasOwn(previousState, "demandAuthorityRef")
    ? `${previousState.demandAuthorityRef}\u0000${previousState.demandAuthorityDigest}`
    : null;
  const afterAuthority = Object.hasOwn(nextState, "demandAuthorityRef")
    ? `${nextState.demandAuthorityRef}\u0000${nextState.demandAuthorityDigest}`
    : null;
  if (beforeAuthority !== afterAuthority) {
    fail("wakeflow-demand-core-pod-owner", "$/nextState", "Pod transition cannot change frozen demand authority");
  }
}

function assertUnchangedPodWindows(previousPod, nextPod, excludedWindowId = null) {
  const nextById = new Map(nextPod.windows.map((entry) => [entry.windowId, entry]));
  for (const previous of previousPod.windows) {
    if (previous.windowId === excludedWindowId) continue;
    const next = nextById.get(previous.windowId);
    if (!next || canonicalJson(previous) !== canonicalJson(next)) {
      fail(
        "wakeflow-demand-core-pod-transition",
        `$/nextState/pod/windows/${previous.windowId}`,
        "Pod transition changed a member outside its exact selector",
      );
    }
  }
}

function validatePodTransitionDelta({ previousState, nextState, nextEvent, artifactWrites }) {
  const transition = nextEvent.podTransition;
  const designArtifactKind = transition.action === "record-design-request"
    ? "wakeflow-pod-design-request"
    : transition.action === "record-design-handoff"
      ? "wakeflow-pod-design-handoff"
      : null;
  if (designArtifactKind === null) {
    if (artifactWrites.length !== 0 || nextEvent.changedArtifacts.length !== 0) {
      fail("wakeflow-demand-core-pod-owner", "$", "this Pod state transition cannot create or name demand artifacts");
    }
  } else if (
    artifactWrites.length !== 1
    || artifactWrites[0].artifactKind !== designArtifactKind
    || nextEvent.changedArtifacts.length !== 1
    || nextEvent.changedArtifacts[0].artifactKind !== designArtifactKind
  ) {
    fail(
      "wakeflow-demand-core-pod-owner",
      "$",
      "Pod Design transition requires exactly one matching portable Design artifact",
    );
  }
  assertPodStateOnlyDelta(previousState, nextState);
  if (
    nextState.state !== previousState.state
    || nextEvent.from !== previousState.state
    || nextEvent.to !== previousState.state
  ) {
    fail(
      "wakeflow-demand-core-pod-owner",
      "$/nextEvent",
      "Pod transition must preserve the demand business state",
    );
  }
  const previousDigest = optionalPodDigest(previousState);
  const nextDigest = optionalPodDigest(nextState);
  if (
    transition.previousPodDigest !== previousDigest
    || transition.nextPodDigest !== nextDigest
    || nextDigest === null
    || nextState.pod.podId !== transition.podId
  ) {
    fail(
      "wakeflow-demand-core-pod-transition",
      "$/nextEvent/podTransition",
      "Pod transition must bind the exact previous and next Pod state digests",
    );
  }
  if (previousState.pod && (
    previousState.pod.podId !== nextState.pod.podId
    || previousState.pod.hostId !== nextState.pod.hostId
    || previousState.pod.placementAuthorizationDigest !== nextState.pod.placementAuthorizationDigest
    || canonicalJson(previousState.pod.scope) !== canonicalJson(nextState.pod.scope)
  )) {
    fail("wakeflow-demand-core-pod-transition", "$/nextState/pod", "Pod transition cannot replace immutable Pod identity or scope");
  }

  if (transition.action === "initialize") {
    if (previousDigest !== null || nextState.pod.phase !== "reserved") {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod", "Pod initialization requires absent authority and the reserved phase");
    }
    return;
  }
  if (!previousState.pod) {
    fail("wakeflow-demand-core-pod-transition", "$/previousState/pod", "non-initial Pod transition requires current Pod authority");
  }
  const previousPod = previousState.pod;
  const nextPod = nextState.pod;

  if (!new Set(["record-design-request", "record-design-handoff"]).has(transition.action)) {
    for (const field of ["designRequest", "designHandoff"]) {
      if (optionalCanonical(previousPod[field]) !== optionalCanonical(nextPod[field])) {
        fail(
          "wakeflow-demand-core-pod-transition",
          `$/nextState/pod/${field}`,
          `Pod ${transition.action} transition cannot change ${field}`,
        );
      }
    }
  }

  if (transition.action === "record-design-request") {
    const identity = demandArtifactIdentity(artifactWrites[0].value);
    if (
      previousPod.phase !== "control-ready"
      || nextPod.phase !== "designing"
      || Object.hasOwn(previousPod, "designRequest")
      || Object.hasOwn(previousPod, "designHandoff")
      || nextPod.designRequest?.podDesignRequestId !== transition.podDesignRequestId
      || nextPod.designRequest?.podDesignRequestId !== identity.artifactId
      || nextPod.designRequest?.ref !== identity.ref
      || nextPod.designRequest?.digest !== identity.digest
      || Object.hasOwn(nextPod, "designHandoff")
      || canonicalJson(previousPod.windows) !== canonicalJson(nextPod.windows)
      || optionalCanonical(previousPod.testAccess) !== optionalCanonical(nextPod.testAccess)
    ) {
      fail(
        "wakeflow-demand-core-pod-transition",
        "$/nextState/pod/designRequest",
        "Pod Design request must advance control-ready to designing with one exact request and unchanged membership",
      );
    }
    return;
  }

  if (transition.action === "record-design-handoff") {
    const identity = demandArtifactIdentity(artifactWrites[0].value);
    if (
      previousPod.phase !== "designing"
      || nextPod.phase !== "creating-products"
      || !previousPod.designRequest
      || canonicalJson(previousPod.designRequest) !== canonicalJson(nextPod.designRequest)
      || Object.hasOwn(previousPod, "designHandoff")
      || nextPod.designHandoff?.podDesignHandoffId !== transition.podDesignHandoffId
      || nextPod.designHandoff?.podDesignHandoffId !== identity.artifactId
      || nextPod.designHandoff?.ref !== identity.ref
      || nextPod.designHandoff?.digest !== identity.digest
      || canonicalJson(previousPod.windows) !== canonicalJson(nextPod.windows)
      || optionalCanonical(previousPod.testAccess) !== optionalCanonical(nextPod.testAccess)
    ) {
      fail(
        "wakeflow-demand-core-pod-transition",
        "$/nextState/pod/designHandoff",
        "Pod Design handoff must advance designing to creating-products with one exact handoff and unchanged membership",
      );
    }
    return;
  }

  if (transition.action === "add-members") {
    if (nextPod.windows.length <= previousPod.windows.length) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/windows", "add-members must append at least one stable member");
    }
    assertUnchangedPodWindows(previousPod, nextPod);
    const previousWindowIds = new Set(previousPod.windows.map((entry) => entry.windowId));
    const added = nextPod.windows.filter((entry) => !previousWindowIds.has(entry.windowId));
    if (
      previousPod.phase !== "creating-products"
      || nextPod.phase !== "creating-products"
      || previousPod.windows.some((entry) => entry.role === "product")
      || added.some((entry) => entry.role !== "product")
      || !previousPod.designRequest
      || !previousPod.designHandoff
    ) {
      fail(
        "wakeflow-demand-core-pod-transition",
        "$/nextState/pod/windows",
        "add-members may append one complete first product set only after the exact Design handoff",
      );
    }
    if (Object.hasOwn(nextPod, "testAccess")) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/testAccess", "membership change must invalidate current Test access");
    }
    return;
  }

  if (["bind-window", "plan-close", "settle-close"].includes(transition.action)) {
    if (previousPod.windows.length !== nextPod.windows.length) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/windows", "selected window transition cannot add or remove members");
    }
    assertUnchangedPodWindows(previousPod, nextPod, transition.windowId);
    const previousWindow = previousPod.windows.find((entry) => entry.windowId === transition.windowId);
    const nextWindow = nextPod.windows.find((entry) => entry.windowId === transition.windowId);
    const stableProjection = transition.action === "bind-window"
      ? podWindowStaticProjection
      : podWindowCloseStableProjection;
    if (
      !previousWindow
      || !nextWindow
      || canonicalJson(stableProjection(previousWindow))
        !== canonicalJson(stableProjection(nextWindow))
    ) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/windows", "selected window identity changed or is missing");
    }
    if (Object.hasOwn(nextPod, "testAccess")) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/testAccess", "window lifecycle change must invalidate current Test access");
    }
    if (transition.action === "bind-window") {
      const phaseAdmitsMember = previousWindow.role === "product"
        ? previousPod.phase === "creating-products"
        : ["reserved", "creating-control"].includes(previousPod.phase);
      if (
        previousWindow.status !== "planned"
        || nextWindow.status !== "bound"
        || !phaseAdmitsMember
        || nextPod.phase !== nextPodPhaseAfterBinding(nextPod)
      ) {
        fail(
          "wakeflow-demand-core-pod-transition",
          "$/nextState/pod/windows",
          "bind-window requires one admitted planned member to become bound and derive the exact next Pod phase",
        );
      }
    }
    if (transition.action === "plan-close") {
      const productClaimChanged = previousWindow.role === "product"
        && previousWindow.resourceClaimStatus !== nextWindow.resourceClaimStatus;
      if (
        !["completed", "cancelled"].includes(previousState.state)
        || nextState.state !== previousState.state
        || nextEvent.from !== previousState.state
        || nextEvent.to !== previousState.state
        || !["planned", "bound"].includes(previousWindow.status)
        || Object.hasOwn(previousWindow, "close")
        || nextWindow.status !== "closing"
        || nextWindow.close.closeOperationId !== transition.closeOperationId
        || Object.hasOwn(nextWindow.close, "receipt")
        || nextPod.phase !== "closing"
        || productClaimChanged
      ) {
        fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/windows", "plan-close requires one terminal-demand planned/bound member to retain its exact authority and select one closing intent");
      }
    }
    if (transition.action === "settle-close") {
      const expectedPhase = nextPod.windows.every((entry) => entry.status === "closed")
        ? "closed"
        : "closing";
      const productClaimValid = previousWindow.role !== "product"
        || ["released", "retained", "unknown"].includes(nextWindow.resourceClaimStatus);
      if (
        !["completed", "cancelled"].includes(previousState.state)
        || nextState.state !== previousState.state
        || nextEvent.from !== previousState.state
        || nextEvent.to !== previousState.state
        || previousPod.phase !== "closing"
        || nextPod.phase !== expectedPhase
        || previousWindow.status !== "closing"
        || nextWindow.status !== "closed"
        || previousWindow.close.closeOperationId !== transition.closeOperationId
        || nextWindow.close.closeOperationId !== transition.closeOperationId
        || canonicalJson(previousWindow.close.intent) !== canonicalJson(nextWindow.close.intent)
        || !Object.hasOwn(nextWindow.close, "receipt")
        || productClaimValid === false
      ) {
        fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/windows", "settle-close requires one terminal-demand closing member to retain its exact authority and add one close receipt");
      }
    }
    return;
  }

  if (["plan-test-access", "settle-test-access", "retry-test-access"].includes(transition.action)) {
    if (canonicalJson(previousPod.windows) !== canonicalJson(nextPod.windows)) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/windows", "Test access transition cannot change Pod members");
    }
    const previousAccess = previousPod.testAccess ?? null;
    const nextAccess = nextPod.testAccess ?? null;
    if (!nextAccess || nextAccess.probeId !== transition.probeId) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/testAccess", "Test access transition must select its exact probe");
    }
    if (transition.action === "plan-test-access" && (previousAccess !== null || nextAccess.status !== "pending")) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/testAccess", "initial Test access plan requires absent to pending");
    }
    if (
      transition.action === "plan-test-access"
      && (previousPod.phase !== "execution-ready" || nextPod.phase !== "execution-ready")
    ) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/phase", "initial Test access planning must preserve execution-ready");
    }
    if (transition.action === "settle-test-access" && (
      previousAccess?.status !== "pending"
      || previousAccess.probeId !== nextAccess.probeId
      || !["validated", "blocked"].includes(nextAccess.status)
      || canonicalJson(podTestAccessPlanProjection(previousAccess))
        !== canonicalJson(podTestAccessPlanProjection(nextAccess))
    )) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/testAccess", "Test access settlement requires the exact pending probe");
    }
    if (
      transition.action === "settle-test-access"
      && (
        !["execution-ready", "retryable"].includes(previousPod.phase)
        || nextPod.phase !== (nextAccess.status === "validated" ? "execution-ready" : "blocked")
      )
    ) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/phase", "Test access settlement phase must match its derived outcome");
    }
    if (transition.action === "retry-test-access" && (
      previousAccess?.status !== "blocked"
      || nextAccess.status !== "pending"
      || nextAccess.previousProbeId !== previousAccess.probeId
      || nextAccess.attempt !== previousAccess.attempt + 1
    )) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/testAccess", "Test access retry must advance one blocked attempt without overwrite");
    }
    if (
      transition.action === "retry-test-access"
      && (previousPod.phase !== "blocked" || nextPod.phase !== "retryable")
    ) {
      fail("wakeflow-demand-core-pod-transition", "$/nextState/pod/phase", "Test access retry must advance blocked to retryable pending");
    }
  }
}

/**
 * 校验一次 journal intent：CAS 前态、event、next state 与最多一个 immutable write
 * 必须形成同一修订；business archive 明确不属于该 journal。
 */
export function validateStateTransitionRecord(value, {
  demand,
  currentState = null,
  ledgerRoot = null,
  events = null,
} = {}) {
  value = canonicalDataSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "demandId",
    "command",
    "createdAt",
    "expectedPreviousRevision",
    "expectedPreviousStateDigest",
    "nextEvent",
    "nextEventDigest",
    "nextState",
    "nextStateDigest",
    "artifactWrites",
    "previousState",
  ], [], "$");
  assertSchemaAndKind(value, "wakeflow-state-transition");
  const validDemand = validateDemandRecord(demand, { ledgerRoot });
  assertWakeflowTypedId(value.demandId, "demand", "$/demandId");
  if (value.demandId !== validDemand.demandId) {
    fail("wakeflow-demand-core-transition", "$/demandId", "transition demandId must match demand.json");
  }
  assertToken(value.command, "$/command");
  assertTimestamp(value.createdAt, "$/createdAt");
  assertRevision(value.expectedPreviousRevision, "$/expectedPreviousRevision", { positive: true });
  assertDigest(value.expectedPreviousStateDigest, "$/expectedPreviousStateDigest");
  const nextEvent = validateControllerEventRecord(value.nextEvent);
  const nextState = validateDemandStateRecord(value.nextState);
  const previousState = validateDemandStateRecord(value.previousState);
  if (
    previousState.state === "archived"
    || nextState.state === "archived"
    || nextEvent.command === ARCHIVE_COMMAND
  ) {
    fail(
      "wakeflow-demand-core-archive-owner",
      "$",
      "business archive is published by archive.json and cannot use the state-transition journal",
    );
  }
  assertPodPlacementAuthority(validDemand, previousState, "$/previousState/pod");
  assertPodPlacementAuthority(validDemand, nextState, "$/nextState/pod");
  if (
    previousState.programId !== validDemand.programId
    || previousState.demandId !== validDemand.demandId
    || previousState.demandRef !== WAKEFLOW_DEMAND_FILE
    || previousState.demandDigest !== canonicalJsonDigest(validDemand)
    || previousState.revision !== value.expectedPreviousRevision
    || canonicalJsonDigest(previousState) !== value.expectedPreviousStateDigest
  ) {
    fail(
      "wakeflow-demand-core-revision-stale",
      "$/previousState",
      "journal previousState must bind the exact expected immutable demand snapshot",
    );
  }
  if (nextEvent.demandId !== validDemand.demandId) {
    fail("wakeflow-demand-core-transition", "$/nextEvent/demandId", "next event demandId must match demand.json");
  }
  if (
    nextState.programId !== validDemand.programId
    || nextState.demandId !== validDemand.demandId
    || nextState.demandRef !== WAKEFLOW_DEMAND_FILE
    || nextState.demandDigest !== canonicalJsonDigest(validDemand)
  ) {
    fail("wakeflow-demand-core-transition", "$/nextState", "next state must retain the exact immutable demand tuple");
  }
  if (value.command !== nextEvent.command || value.createdAt !== nextEvent.createdAt) {
    fail("wakeflow-demand-core-transition", "$/nextEvent", "journal command and createdAt must match its exact event");
  }
  if (
    nextEvent.previousRevision !== value.expectedPreviousRevision
    || nextEvent.nextRevision !== value.expectedPreviousRevision + 1
  ) {
    fail("wakeflow-demand-core-transition", "$/nextEvent", "journal event must advance the expected revision by one");
  }
  if (value.nextEventDigest !== canonicalJsonDigest(nextEvent)) {
    fail("wakeflow-demand-core-transition", "$/nextEventDigest", "nextEventDigest must match nextEvent");
  }
  if (value.nextStateDigest !== canonicalJsonDigest(nextState)) {
    fail("wakeflow-demand-core-transition", "$/nextStateDigest", "nextStateDigest must match nextState");
  }
  if (
    nextState.revision !== nextEvent.nextRevision
    || nextState.state !== nextEvent.to
    || nextState.stateReason !== nextEvent.reason
    || nextState.updatedAt !== nextEvent.createdAt
    || nextState.lastEvent.eventId !== nextEvent.eventId
    || nextState.lastEvent.eventDigest !== value.nextEventDigest
  ) {
    fail("wakeflow-demand-core-transition", "$/nextState", "next state must bind the exact next event tail");
  }
  if (!Array.isArray(value.artifactWrites)) {
    fail("wakeflow-demand-core-transition-artifact", "$/artifactWrites", "artifactWrites must be an array");
  }
  const artifactWrites = value.artifactWrites.map((entry, index) => validateArtifactWrite(
    entry,
    `$/artifactWrites/${index}`,
    { demand: validDemand, ledgerRoot },
  ));
  if (artifactWrites.length > 1) {
    fail("wakeflow-demand-core-transition-artifact", "$/artifactWrites", "one state revision may create at most one immutable artifact");
  }
  const authorityChange = nextEvent.changedArtifacts.find((entry) => entry.artifactKind === "wakeflow-demand-authority");
  if (nextEvent.changedArtifacts.some((entry) => entry.artifactKind === "wakeflow-demand")) {
    fail(
      "wakeflow-demand-core-transition-artifact",
      "$/nextEvent/changedArtifacts",
      "post-publication state transitions cannot rewrite immutable demand.json",
    );
  }
  const candidateChanges = nextEvent.changedArtifacts.filter((entry) => (
    entry.artifactKind === "wakeflow-evidence"
    || demandArtifactContractForKind(entry.artifactKind)
  ));
  if (candidateChanges.length > 1) {
    fail(
      "wakeflow-demand-core-transition-artifact",
      "$/nextEvent/changedArtifacts",
      "one state revision may name at most one immutable demand artifact or evidence change",
    );
  }
  const candidateChange = candidateChanges[0] ?? null;
  const authorityWrite = artifactWrites.find((entry) => entry.artifactKind === "wakeflow-demand-authority") ?? null;
  const candidateWrite = artifactWrites.find((entry) => (
    entry.artifactKind === "wakeflow-evidence"
    || demandArtifactContractForKind(entry.artifactKind)
  )) ?? null;
  if (authorityWrite && candidateWrite) {
    fail("wakeflow-demand-core-transition-artifact", "$/artifactWrites", "authority and managed artifact creation require separate revisions");
  }
  if (Boolean(authorityWrite) !== Boolean(authorityChange)) {
    fail(
      "wakeflow-demand-core-transition-artifact",
      "$/artifactWrites",
      "authority event change and authority write intent must appear together",
    );
  }
  if (authorityWrite && authorityChange.digest !== authorityWrite.digest) {
    fail("wakeflow-demand-core-transition-artifact", "$/nextEvent/changedArtifacts", "authority event digest must match its write intent");
  }
  if (authorityWrite && (
    nextState.demandAuthorityRef !== WAKEFLOW_DEMAND_AUTHORITY_FILE
    || nextState.demandAuthorityDigest !== authorityWrite.digest
  )) {
    fail(
      "wakeflow-demand-core-transition-artifact",
      "$/nextState/demandAuthorityDigest",
      "authority freeze must publish the exact authority tuple in next state",
    );
  }
  if (Boolean(candidateWrite) !== Boolean(candidateChange)) {
    fail(
      "wakeflow-demand-core-transition-artifact",
      "$/artifactWrites",
      "managed artifact event change and create intent must appear together",
    );
  }
  if (candidateWrite) {
    const identity = candidateWrite.artifactKind === "wakeflow-evidence"
      ? evidenceIdentity(candidateWrite.value)
      : demandArtifactIdentity(candidateWrite.value);
    if (
      candidateChange.artifactKind !== identity.artifactKind
      || candidateChange.artifactId !== identity.artifactId
      || candidateChange.ref !== identity.ref
      || candidateChange.digest !== identity.digest
    ) {
      fail(
        "wakeflow-demand-core-transition-artifact",
        "$/nextEvent/changedArtifacts",
        "managed artifact event tuple must match the exact create intent",
      );
    }
    if (!stateContainsArtifactIdentity(nextState, identity)) {
      fail(
        "wakeflow-demand-core-transition-artifact",
        "$/nextState",
        "next state must publish the exact created artifact tuple",
      );
    }
  }
  if (Object.hasOwn(nextEvent, "deliveryTransition")) {
    validateDeliveryTransitionDelta({
      previousState,
      nextState,
      nextEvent,
      artifactWrites,
      events,
    });
  }
  if (Object.hasOwn(nextEvent, "reviewDecision")) {
    validateReviewDecisionDelta({
      previousState,
      nextState,
      nextEvent,
      artifactWrites,
    });
  }
  if (Object.hasOwn(nextEvent, "podTransition")) {
    validatePodTransitionDelta({
      previousState,
      nextState,
      nextEvent,
      artifactWrites,
    });
  } else if (optionalCanonical(previousState.pod) !== optionalCanonical(nextState.pod)) {
    fail(
      "wakeflow-demand-core-pod-owner",
      "$/nextState/pod",
      "non-Pod transition cannot change Pod authority",
    );
  }
  if (Object.hasOwn(nextEvent, "lifecycleTransition")) {
    validateLifecycleTransitionDelta({
      previousState,
      nextState,
      nextEvent,
      artifactWrites,
    });
  }
  if (currentState !== null) {
    const validCurrent = validateDemandStateRecord(currentState);
    if (
      validCurrent.revision !== value.expectedPreviousRevision
      || canonicalJsonDigest(validCurrent) !== value.expectedPreviousStateDigest
    ) {
      fail("wakeflow-demand-core-revision-stale", "$", "transition expected revision/state digest is stale");
    }
    if (canonicalJson(previousState) !== canonicalJson(validCurrent)) {
      fail("wakeflow-demand-core-revision-stale", "$/previousState", "journal previousState must equal the exact current state");
    }
    if (nextEvent.from !== validCurrent.state) {
      fail("wakeflow-demand-core-transition", "$/nextEvent/from", "event from-state must match current state");
    }
    if (authorityWrite && Object.hasOwn(validCurrent, "demandAuthorityRef")) {
      fail(
        "wakeflow-demand-core-transition-artifact",
        "$/artifactWrites",
        "authority freeze requires a currently absent authority tuple",
      );
    }
    if (!authorityWrite) {
      const beforeAuthority = Object.hasOwn(validCurrent, "demandAuthorityRef")
        ? `${validCurrent.demandAuthorityRef}\u0000${validCurrent.demandAuthorityDigest}`
        : null;
      const afterAuthority = Object.hasOwn(nextState, "demandAuthorityRef")
        ? `${nextState.demandAuthorityRef}\u0000${nextState.demandAuthorityDigest}`
        : null;
      if (beforeAuthority !== afterAuthority) {
        fail("wakeflow-demand-core-transition", "$/nextState", "ordinary transition cannot change the frozen authority tuple");
      }
    }
    if (
      !Object.hasOwn(nextEvent, "deliveryTransition")
      && !Object.hasOwn(nextEvent, "reviewDecision")
      && !Object.hasOwn(nextEvent, "podTransition")
      && !Object.hasOwn(nextEvent, "lifecycleTransition")
    ) {
      assertDeliveryAuthorityPreserved(validCurrent, nextState);
      const allowedArtifactFields = new Set(candidateWrite ? artifactSummaryField(candidateWrite) : []);
      const beforeArtifacts = artifactSummaryProjection(validCurrent);
      const afterArtifacts = artifactSummaryProjection(nextState);
      for (const key of ARTIFACT_STATE_KEYS) {
        if (!allowedArtifactFields.has(key) && canonicalJson(beforeArtifacts[key]) !== canonicalJson(afterArtifacts[key])) {
          fail(
            "wakeflow-demand-core-transition-artifact",
            `$/nextState/${key}`,
            `${candidateWrite?.artifactKind ?? "ordinary transition"} cannot change ${key}`,
          );
        }
      }
    }
  }
  return frozenClone(value);
}

/** 按 artifactKind 分派五类 core record codec；输入先经过无行为数据快照。 */
export function validateDemandCoreRecord(value, expectations = {}) {
  value = canonicalDataSnapshot(value);
  assertPlainObject(value, "$");
  if (value.artifactKind === "wakeflow-demand") return validateDemandRecord(value, expectations);
  if (value.artifactKind === "wakeflow-demand-authority") return validateDemandAuthorityRecord(value, expectations);
  if (value.artifactKind === "wakeflow-state") return validateDemandStateRecord(value, expectations);
  if (value.artifactKind === "wakeflow-controller-event") return validateControllerEventRecord(value, expectations);
  if (value.artifactKind === "wakeflow-state-transition") return validateStateTransitionRecord(value, expectations);
  fail("wakeflow-demand-core-artifact-kind", "$/artifactKind", `unsupported demand core artifact ${String(value.artifactKind)}`);
}

export function demandCoreRecordDigest(value) {
  return canonicalJsonDigest(value);
}

export function demandCoreCanonicalBytes(value) {
  return Buffer.concat([canonicalJsonBytes(value), Buffer.from("\n", "utf8")]);
}

/** 只派生一个 demand state root 内的固定核心路径，不探测也不创建文件。 */
export function demandCorePaths(stateRoot) {
  const root = path.resolve(stateRoot);
  const transactions = path.join(root, WAKEFLOW_DEMAND_TRANSACTIONS_DIRECTORY);
  return Object.freeze({
    stateRoot: root,
    demand: path.join(root, WAKEFLOW_DEMAND_FILE),
    authority: path.join(root, WAKEFLOW_DEMAND_AUTHORITY_FILE),
    state: path.join(root, WAKEFLOW_DEMAND_STATE_FILE),
    events: path.join(root, WAKEFLOW_DEMAND_EVENTS_FILE),
    transactions,
    stateTransition: path.join(transactions, WAKEFLOW_DEMAND_STATE_TRANSITION_FILE),
    archiveTransaction: path.join(transactions, WAKEFLOW_DEMAND_ARCHIVE_TRANSACTION_FILE),
  });
}

function lstatIfPresent(candidate) {
  try {
    return lstatSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function currentEffectiveUid() {
  if (process.platform === "win32" || typeof process.geteuid !== "function") return null;
  return BigInt(process.geteuid());
}

function permissionBits(stat) {
  return Number(stat.mode & 0o777n);
}

function assertCurrentOwner(stat, errorPath, label, file) {
  const expectedUid = currentEffectiveUid();
  if (expectedUid !== null && stat.uid !== expectedUid) {
    fail("wakeflow-demand-core-owner", errorPath, `${label} must be owned by the current effective user`, {
      file,
      expectedUid: Number(expectedUid),
      actualUid: Number(stat.uid),
    });
  }
}

function sameStableFile(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function inspectStateRoot(stateRoot) {
  if (typeof stateRoot !== "string" || !stateRoot.trim()) {
    fail("wakeflow-demand-core-root", "$stateRoot", "stateRoot must be a non-empty path string");
  }
  const root = path.resolve(stateRoot);
  let stat;
  try {
    stat = lstatSync(root, { bigint: true });
  } catch (cause) {
    fail("wakeflow-demand-core-root", "$stateRoot", "stateRoot must already exist", { stateRoot: root }, cause);
  }
  if (stat.isSymbolicLink()) fail("wakeflow-demand-core-symlink", "$stateRoot", "stateRoot cannot be a symlink");
  if (!stat.isDirectory()) fail("wakeflow-demand-core-root", "$stateRoot", "stateRoot must be a directory");
  if (process.platform !== "win32" && permissionBits(stat) !== 0o700) {
    fail("wakeflow-demand-core-root-mode", "$stateRoot", "stateRoot must use mode 0700", {
      stateRoot: root,
      mode: permissionBits(stat),
    });
  }
  assertCurrentOwner(stat, "$stateRoot", "stateRoot", root);
  return { root, real: realpathSync(root) };
}

function assertDirectChild(rootInfo, file, basename, errorPath) {
  const expected = path.join(rootInfo.root, basename);
  if (path.resolve(file) !== expected) {
    fail("wakeflow-demand-core-ref", errorPath, `${basename} must be a direct child of stateRoot`);
  }
  const parentReal = realpathSync(path.dirname(file));
  if (parentReal !== rootInfo.real) {
    fail("wakeflow-demand-core-ref", errorPath, `${basename} parent must resolve to stateRoot`);
  }
}

function readRegularFileNoFollow(file, errorPath, label) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (cause) {
    fail("wakeflow-demand-core-file", errorPath, `${label} must exist as a regular file`, { file }, cause);
  }
  if (before.isSymbolicLink()) fail("wakeflow-demand-core-symlink", errorPath, `${label} cannot be a symlink`, { file });
  if (!before.isFile() || before.nlink !== 1n) {
    fail("wakeflow-demand-core-file", errorPath, `${label} must be a single-link regular file`, { file });
  }
  if (process.platform !== "win32" && permissionBits(before) !== 0o600) {
    fail("wakeflow-demand-core-file-mode", errorPath, `${label} must use mode 0600`, {
      file,
      mode: permissionBits(before),
    });
  }
  assertCurrentOwner(before, errorPath, label, file);
  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    fail("wakeflow-demand-core-file-race", errorPath, `${label} changed before it could be opened safely`, { file }, cause);
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile()
      || opened.nlink !== 1n
      || (process.platform !== "win32" && permissionBits(opened) !== 0o600)
      || !sameStableFile(before, opened)
      || opened.size > BigInt(MAX_DEMAND_CORE_FILE_BYTES)
    ) {
      fail("wakeflow-demand-core-file-race", errorPath, `${label} changed while opening`, { file });
    }
    assertCurrentOwner(opened, errorPath, label, file);
    const openedSize = Number(opened.size);
    const capture = Buffer.alloc(openedSize + 1);
    let offset = 0;
    while (offset < capture.length) {
      const count = readSync(descriptor, capture, offset, capture.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = lstatSync(file, { bigint: true });
    if (
      after.isSymbolicLink()
      || !after.isFile()
      || after.nlink !== 1n
      || (process.platform !== "win32" && permissionBits(after) !== 0o600)
      || !sameStableFile(after, opened)
      || offset !== openedSize
    ) {
      fail("wakeflow-demand-core-file-race", errorPath, `${label} changed while reading`, { file });
    }
    assertCurrentOwner(after, errorPath, label, file);
    return capture.subarray(0, offset);
  } finally {
    closeSync(descriptor);
  }
}

function readCanonicalJson(file, errorPath, label) {
  const bytes = readRegularFileNoFollow(file, errorPath, label);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    fail("wakeflow-demand-core-json", errorPath, `${label} must be valid JSON`, { file }, cause);
  }
  let canonical;
  try {
    canonical = demandCoreCanonicalBytes(value);
  } catch (cause) {
    fail("wakeflow-demand-core-json", errorPath, `${label} must be canonical JSON data`, { file }, cause);
  }
  if (!bytes.equals(canonical)) {
    fail("wakeflow-demand-core-encoding", errorPath, `${label} must use canonical JSON plus one LF`, { file });
  }
  return Object.freeze({
    value,
    bytes,
    byteDigest: sha256Bytes(bytes),
    digest: canonicalJsonDigest(value),
  });
}

function readCanonicalEvents(file) {
  const bytes = readRegularFileNoFollow(file, "$/events", "controller event log");
  const text = bytes.toString("utf8");
  if (!text || text.includes("\r") || !text.endsWith("\n")) {
    fail("wakeflow-demand-core-event-log", "$/events", "controller event log must be non-empty LF-only canonical JSONL");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.some((line) => !line)) {
    fail("wakeflow-demand-core-event-log", "$/events", "controller event log cannot contain blank lines");
  }
  const events = lines.map((line, index) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch (cause) {
      fail("wakeflow-demand-core-event-log", `$/events/${index}`, "controller event line must be valid JSON", {}, cause);
    }
    if (line !== canonicalJson(value)) {
      fail("wakeflow-demand-core-event-log", `$/events/${index}`, "controller event line must be canonical JSON");
    }
    return validateControllerEventRecord(value);
  });
  const canonicalBytes = Buffer.from(
    `${events.map((event) => canonicalJson(event)).join("\n")}\n`,
    "utf8",
  );
  if (!bytes.equals(canonicalBytes)) {
    fail(
      "wakeflow-demand-core-event-log",
      "$/events",
      "controller event log must be exact canonical UTF-8 JSONL bytes",
    );
  }
  return Object.freeze({
    events: deepFreeze(events),
    bytes,
    byteDigest: sha256Bytes(bytes),
  });
}

function assertNoKnownCoreStageResidue(rootInfo) {
  const residue = readdirSync(rootInfo.root, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort()
    .find((name) => CORE_ATOMIC_STAGE_PREFIXES.some((prefix) => name.startsWith(prefix)));
  if (residue) {
    fail(
      "wakeflow-demand-core-stage-residue",
      `$stateRoot/${residue}`,
      `interrupted atomic stage ${residue} must be resolved explicitly before demand core access`,
    );
  }
}

function assertTransactionsClean(rootInfo, paths) {
  let stat;
  try {
    stat = lstatSync(paths.transactions, { bigint: true });
  } catch (cause) {
    fail(
      "wakeflow-demand-core-transactions",
      "$/transactions",
      "published demand root must contain its existing transactions directory",
      {},
      cause,
    );
  }
  if (stat.isSymbolicLink()) fail("wakeflow-demand-core-symlink", "$/transactions", "transactions cannot be a symlink");
  if (!stat.isDirectory()) fail("wakeflow-demand-core-transactions", "$/transactions", "transactions must be a directory");
  if (process.platform !== "win32" && permissionBits(stat) !== 0o700) {
    fail("wakeflow-demand-core-transactions-mode", "$/transactions", "transactions must use mode 0700", {
      mode: permissionBits(stat),
    });
  }
  assertCurrentOwner(stat, "$/transactions", "transactions directory", paths.transactions);
  if (realpathSync(path.dirname(paths.transactions)) !== rootInfo.real) {
    fail("wakeflow-demand-core-ref", "$/transactions", "transactions must be a direct child of stateRoot");
  }
  const entries = readdirSync(paths.transactions, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > 0) {
    const transition = entries.find((entry) => entry.name === WAKEFLOW_DEMAND_STATE_TRANSITION_FILE);
    fail(
      transition ? "wakeflow-demand-core-journal-pending" : "wakeflow-demand-core-transaction-residue",
      `$/transactions/${entries[0].name}`,
      transition
        ? "pending state transition must be recovered explicitly before ordinary reads"
        : `unknown transaction residue ${entries[0].name} blocks ordinary reads`,
    );
  }
}

function loadDemandCoreRecordsUnlocked({
  stateRoot,
  expectedProgramId = null,
  ledgerRoot = null,
} = {}) {
  const rootInfo = inspectStateRoot(stateRoot);
  const paths = demandCorePaths(rootInfo.root);
  assertNoKnownCoreStageResidue(rootInfo);
  for (const [file, basename, errorPath] of [
    [paths.demand, WAKEFLOW_DEMAND_FILE, "$/demand"],
    [paths.authority, WAKEFLOW_DEMAND_AUTHORITY_FILE, "$/authority"],
    [paths.state, WAKEFLOW_DEMAND_STATE_FILE, "$/state"],
    [paths.events, WAKEFLOW_DEMAND_EVENTS_FILE, "$/events"],
  ]) {
    assertDirectChild(rootInfo, file, basename, errorPath);
  }
  assertTransactionsClean(rootInfo, paths);
  const rawDemand = readCanonicalJson(paths.demand, "$/demand", "demand identity");
  const demand = validateDemandRecord(rawDemand.value, { ledgerRoot });
  if (ledgerRoot === null && (
    demand.source.artifactKind === LEDGER_SOURCE_KIND
    || demand.executionPlacement.mode === "isolated"
  )) {
    fail(
      "wakeflow-demand-core-ledger-ref-unresolved",
      "$ledgerRoot",
      "strict loading of ledger-backed identity or isolated placement requires ledgerRoot",
    );
  }
  if (path.basename(rootInfo.root) !== demand.demandId) {
    fail("wakeflow-demand-core-root-identity", "$stateRoot", "stateRoot basename must equal demandId");
  }
  if (expectedProgramId !== null) {
    assertWakeflowTypedId(expectedProgramId, "program", "$expectedProgramId");
    if (demand.programId !== expectedProgramId) {
      fail("wakeflow-demand-core-program", "$/demand/programId", `demand belongs to ${demand.programId}, not ${expectedProgramId}`);
    }
  }
  const authorityStat = lstatIfPresent(paths.authority);
  if (authorityStat && ledgerRoot === null) {
    fail(
      "wakeflow-demand-core-ledger-ref-unresolved",
      "$ledgerRoot",
      "strict loading of frozen demand authority requires ledgerRoot",
    );
  }
  const rawAuthority = authorityStat
    ? readCanonicalJson(paths.authority, "$/authority", "demand authority")
    : null;
  const authority = rawAuthority
    ? validateDemandAuthorityRecord(rawAuthority.value, { demand, ledgerRoot })
    : null;
  const rawState = readCanonicalJson(paths.state, "$/state", "demand state");
  const eventsFile = readCanonicalEvents(paths.events);
  const stack = validateDemandCoreStack({
    demand,
    authority,
    state: rawState.value,
    events: eventsFile.events,
    ledgerRoot,
  });
  return deepFreeze({
    ...stack,
    paths,
    bytes: {
      demand: Buffer.from(rawDemand.bytes),
      authority: rawAuthority ? Buffer.from(rawAuthority.bytes) : null,
      state: Buffer.from(rawState.bytes),
      events: Buffer.from(eventsFile.bytes),
    },
    byteDigests: {
      demand: rawDemand.byteDigest,
      authority: rawAuthority?.byteDigest ?? null,
      state: rawState.byteDigest,
      events: eventsFile.byteDigest,
    },
  });
}

/**
 * 已持有 state-root lock 的内部读取缝。普通调用方必须改用 loadDemandCoreRecords，
 * 让读取与 transition writer 使用同一把跨进程锁。
 */
export function loadDemandCoreRecordsWhileLocked(options = {}) {
  return loadDemandCoreRecordsUnlocked(options);
}

/** 普通严格读取入口：先取得 state-root lock，再读取同一时刻的完整 core stack。 */
export function loadDemandCoreRecords(options = {}) {
  const rootInfo = inspectStateRoot(options.stateRoot);
  return withStateRootLock(rootInfo.root, () => loadDemandCoreRecordsUnlocked({
    ...options,
    stateRoot: rootInfo.root,
  }));
}

function assertExactRecoveryJournalInventory({
  rootInfo,
  paths,
  basename,
  errorCode,
  label,
}) {
  let transactionsStat;
  try {
    transactionsStat = lstatSync(paths.transactions, { bigint: true });
  } catch (cause) {
    fail("wakeflow-demand-core-transactions", "$/transactions", "transactions directory is missing", {}, cause);
  }
  if (transactionsStat.isSymbolicLink()) {
    fail("wakeflow-demand-core-symlink", "$/transactions", "transactions cannot be a symlink");
  }
  if (!transactionsStat.isDirectory() || realpathSync(path.dirname(paths.transactions)) !== rootInfo.real) {
    fail("wakeflow-demand-core-transactions", "$/transactions", "transactions must be a direct child directory of stateRoot");
  }
  if (process.platform !== "win32" && permissionBits(transactionsStat) !== 0o700) {
    fail("wakeflow-demand-core-transactions-mode", "$/transactions", "transactions must use mode 0700", {
      mode: permissionBits(transactionsStat),
    });
  }
  assertCurrentOwner(
    transactionsStat,
    "$/transactions",
    "transactions directory",
    paths.transactions,
  );
  const entries = readdirSync(paths.transactions, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length !== 1 || entries[0].name !== basename) {
    fail(
      errorCode,
      "$/transactions",
      `${label} requires exactly transactions/${basename} and no other residue`,
    );
  }
}

/**
 * business archive 的持锁恢复读取缝：只允许 transactions/archive.json。
 * 归档发布不会就地改 current core stack，因此 demand/state/events 必须仍完整健康；
 * 返回的防御性字节副本供 archive owner 重建 portable wrapper。
 */
export function loadDemandArchiveRecoveryRecordsWhileLocked({
  stateRoot,
  expectedProgramId = null,
  ledgerRoot = null,
} = {}) {
  const rootInfo = inspectStateRoot(stateRoot);
  const paths = demandCorePaths(rootInfo.root);
  assertNoKnownCoreStageResidue(rootInfo);
  for (const [file, basename, errorPath] of [
    [paths.demand, WAKEFLOW_DEMAND_FILE, "$/demand"],
    [paths.authority, WAKEFLOW_DEMAND_AUTHORITY_FILE, "$/authority"],
    [paths.state, WAKEFLOW_DEMAND_STATE_FILE, "$/state"],
    [paths.events, WAKEFLOW_DEMAND_EVENTS_FILE, "$/events"],
  ]) {
    assertDirectChild(rootInfo, file, basename, errorPath);
  }
  assertExactRecoveryJournalInventory({
    rootInfo,
    paths,
    basename: WAKEFLOW_DEMAND_ARCHIVE_TRANSACTION_FILE,
    errorCode: "wakeflow-demand-core-archive-recovery-journal",
    label: "explicit archive recovery",
  });

  const rawDemand = readCanonicalJson(paths.demand, "$/demand", "demand identity");
  const demand = validateDemandRecord(rawDemand.value, { ledgerRoot });
  if (path.basename(rootInfo.root) !== demand.demandId) {
    fail("wakeflow-demand-core-root-identity", "$stateRoot", "stateRoot basename must equal demandId");
  }
  if (expectedProgramId !== null) {
    assertWakeflowTypedId(expectedProgramId, "program", "$expectedProgramId");
    if (demand.programId !== expectedProgramId) {
      fail("wakeflow-demand-core-program", "$/demand/programId", `demand belongs to ${demand.programId}, not ${expectedProgramId}`);
    }
  }
  if (ledgerRoot === null && (
    demand.source.artifactKind === LEDGER_SOURCE_KIND
    || demand.executionPlacement.mode === "isolated"
  )) {
    fail(
      "wakeflow-demand-core-ledger-ref-unresolved",
      "$ledgerRoot",
      "archive recovery of ledger-backed identity or isolated placement requires ledgerRoot",
    );
  }

  const authorityStat = lstatIfPresent(paths.authority);
  if (authorityStat && ledgerRoot === null) {
    fail(
      "wakeflow-demand-core-ledger-ref-unresolved",
      "$ledgerRoot",
      "archive recovery with a frozen authority file requires ledgerRoot",
    );
  }
  const rawAuthority = authorityStat
    ? readCanonicalJson(paths.authority, "$/authority", "demand authority")
    : null;
  const authority = rawAuthority
    ? validateDemandAuthorityRecord(rawAuthority.value, { demand, ledgerRoot })
    : null;
  const rawState = readCanonicalJson(paths.state, "$/state", "demand state");
  const eventsFile = readCanonicalEvents(paths.events);
  const stack = validateDemandCoreStack({
    demand,
    authority,
    state: rawState.value,
    events: eventsFile.events,
    ledgerRoot,
  });
  const rawJournal = readCanonicalJson(
    paths.archiveTransaction,
    "$/transaction",
    "archive transaction journal",
  );
  return deepFreeze({
    ...stack,
    journal: rawJournal.value,
    paths,
    digests: {
      ...stack.digests,
      journal: rawJournal.digest,
    },
    bytes: {
      demand: Buffer.from(rawDemand.bytes),
      authority: rawAuthority ? Buffer.from(rawAuthority.bytes) : null,
      state: Buffer.from(rawState.bytes),
      events: Buffer.from(eventsFile.bytes),
      journal: Buffer.from(rawJournal.bytes),
    },
    byteDigests: {
      demand: rawDemand.byteDigest,
      authority: rawAuthority?.byteDigest ?? null,
      state: rawState.byteDigest,
      events: eventsFile.byteDigest,
      journal: rawJournal.byteDigest,
    },
  });
}

/**
 * state-transition 恢复专用读取缝。它允许 event/state 处于 journal 指定的中间边界，
 * 但不把部分提交当成健康 stack；调用方必须已持锁，普通读取仍拒绝全部事务残留。
 */
export function loadDemandCoreRecoveryRecordsWhileLocked({
  stateRoot,
  expectedProgramId = null,
  ledgerRoot = null,
} = {}) {
  const rootInfo = inspectStateRoot(stateRoot);
  const paths = demandCorePaths(rootInfo.root);
  assertNoKnownCoreStageResidue(rootInfo);
  for (const [file, basename, errorPath] of [
    [paths.demand, WAKEFLOW_DEMAND_FILE, "$/demand"],
    [paths.authority, WAKEFLOW_DEMAND_AUTHORITY_FILE, "$/authority"],
    [paths.state, WAKEFLOW_DEMAND_STATE_FILE, "$/state"],
    [paths.events, WAKEFLOW_DEMAND_EVENTS_FILE, "$/events"],
  ]) {
    assertDirectChild(rootInfo, file, basename, errorPath);
  }

  let transactionsStat;
  try {
    transactionsStat = lstatSync(paths.transactions, { bigint: true });
  } catch (cause) {
    fail("wakeflow-demand-core-transactions", "$/transactions", "transactions directory is missing", {}, cause);
  }
  if (transactionsStat.isSymbolicLink()) {
    fail("wakeflow-demand-core-symlink", "$/transactions", "transactions cannot be a symlink");
  }
  if (!transactionsStat.isDirectory() || realpathSync(path.dirname(paths.transactions)) !== rootInfo.real) {
    fail("wakeflow-demand-core-transactions", "$/transactions", "transactions must be a direct child directory of stateRoot");
  }
  if (process.platform !== "win32" && permissionBits(transactionsStat) !== 0o700) {
    fail("wakeflow-demand-core-transactions-mode", "$/transactions", "transactions must use mode 0700", {
      mode: permissionBits(transactionsStat),
    });
  }
  assertCurrentOwner(
    transactionsStat,
    "$/transactions",
    "transactions directory",
    paths.transactions,
  );
  const entries = readdirSync(paths.transactions, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length !== 1 || entries[0].name !== WAKEFLOW_DEMAND_STATE_TRANSITION_FILE) {
    fail(
      "wakeflow-demand-core-recovery-journal",
      "$/transactions",
      "explicit state recovery requires exactly transactions/state-transition.json and no other residue",
    );
  }

  const rawDemand = readCanonicalJson(paths.demand, "$/demand", "demand identity");
  const demand = validateDemandRecord(rawDemand.value, { ledgerRoot });
  if (path.basename(rootInfo.root) !== demand.demandId) {
    fail("wakeflow-demand-core-root-identity", "$stateRoot", "stateRoot basename must equal demandId");
  }
  if (expectedProgramId !== null) {
    assertWakeflowTypedId(expectedProgramId, "program", "$expectedProgramId");
    if (demand.programId !== expectedProgramId) {
      fail("wakeflow-demand-core-program", "$/demand/programId", `demand belongs to ${demand.programId}, not ${expectedProgramId}`);
    }
  }
  if (ledgerRoot === null && (
    demand.source.artifactKind === LEDGER_SOURCE_KIND
    || demand.executionPlacement.mode === "isolated"
  )) {
    fail(
      "wakeflow-demand-core-ledger-ref-unresolved",
      "$ledgerRoot",
      "recovery of ledger-backed identity or isolated placement requires ledgerRoot",
    );
  }

  const rawJournal = readCanonicalJson(paths.stateTransition, "$/transaction", "state transition journal");
  if (
    ledgerRoot === null
    && Array.isArray(rawJournal.value?.artifactWrites)
    && rawJournal.value.artifactWrites.some((entry) => entry?.artifactKind === "wakeflow-demand-authority")
  ) {
    fail(
      "wakeflow-demand-core-ledger-ref-unresolved",
      "$ledgerRoot",
      "recovery of an authority freeze requires ledgerRoot",
    );
  }
  const journal = validateStateTransitionRecord(rawJournal.value, { demand, ledgerRoot });

  const authorityStat = lstatIfPresent(paths.authority);
  if (authorityStat && ledgerRoot === null) {
    fail(
      "wakeflow-demand-core-ledger-ref-unresolved",
      "$ledgerRoot",
      "recovery with a frozen authority file requires ledgerRoot",
    );
  }
  const rawAuthority = authorityStat
    ? readCanonicalJson(paths.authority, "$/authority", "demand authority")
    : null;
  const authority = rawAuthority
    ? validateDemandAuthorityRecord(rawAuthority.value, { demand, ledgerRoot })
    : null;
  const rawState = readCanonicalJson(paths.state, "$/state", "demand state");
  const state = validateDemandStateRecord(rawState.value);
  if (
    state.programId !== demand.programId
    || state.demandId !== demand.demandId
    || state.demandDigest !== canonicalJsonDigest(demand)
  ) {
    fail("wakeflow-demand-core-stack-identity", "$/state", "recovery state must retain the exact immutable demand tuple");
  }
  const eventsFile = readCanonicalEvents(paths.events);
  return deepFreeze({
    demand,
    authority,
    state,
    events: eventsFile.events,
    journal,
    paths,
    digests: {
      demand: rawDemand.digest,
      authority: rawAuthority?.digest ?? null,
      state: rawState.digest,
      journal: rawJournal.digest,
    },
    byteDigests: {
      demand: rawDemand.byteDigest,
      authority: rawAuthority?.byteDigest ?? null,
      state: rawState.byteDigest,
      events: eventsFile.byteDigest,
      journal: rawJournal.byteDigest,
    },
  });
}
