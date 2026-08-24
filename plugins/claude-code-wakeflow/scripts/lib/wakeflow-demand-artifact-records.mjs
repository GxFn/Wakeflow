/**
 * Wakeflow 需求执行 artifact 的可移植记录合同与物理证据读取器。
 *
 * 能力导航：
 * - 六类 codec：Pod Design Request/Handoff、TaskPackage、TargetResult、ReviewCandidate、TestCard。
 * - 身份合同：从已验证记录唯一派生 typed ID、portable ref、canonical digest 与写入 intent。
 * - 精确读取：在私有 state root 内执行 no-follow、single-link、owner、mode 与稳定身份复验。
 * - 库存诊断：把 Controller event 中的预期 tuple 与实际文件分类为 committed/orphan/conflict/invalid。
 *
 * 本文件只拥有记录格式、不可变身份和物理文件证据，不决定 artifact 是否应在当前业务状态创建；
 * TaskPackage/TestCard/TargetResult/ReviewCandidate 的准入归 artifact service，Pod Design 创建归 Pod service。
 */

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { sha256Bytes } from "./wakeflow-atomic-write.mjs";
import { canonicalJson, canonicalJsonBytes, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";

export const WAKEFLOW_DEMAND_ARTIFACT_SCHEMA_VERSION = 1;
export const WAKEFLOW_DEMAND_ARTIFACT_KINDS = Object.freeze([
  "wakeflow-pod-design-handoff",
  "wakeflow-pod-design-request",
  "wakeflow-review-candidate",
  "wakeflow-target-result",
  "wakeflow-task-package",
  "wakeflow-test-card",
]);

const KIND_SET = new Set(WAKEFLOW_DEMAND_ARTIFACT_KINDS);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.[0-9]{1,9})?Z$/u;
const TOKEN_CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/u;
const HUMAN_CONTROL_RE = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const WORK_TYPES = new Set(["documentation", "implementation", "research", "test"]);
const REQUIREMENT_ROLES = new Set(["completion", "constraint", "design", "evidence", "goal", "validation"]);
const COMMIT_EXPECTATIONS = new Set(["commit", "leave-uncommitted"]);
const RESULT_OUTCOMES = new Set(["blocked", "completed", "needs-review"]);
const REPOSITORY_DISPOSITIONS = new Set(["committed", "left-uncommitted", "no-changes"]);
const REVIEW_DECISIONS = new Set(["accept", "blocked", "redesign", "rework"]);
const SETUP_POLICIES = new Set(["fresh-once", "fresh-per-attempt", "reuse-existing"]);
const POD_DESIGN_REQUEST_TYPES = new Set(["initial-design", "redesign", "supplement"]);
const DEMAND_TYPES = new Set(["bug", "requirement", "research", "supplement"]);
const TEST_MODES = new Set(["controller-only", "not-applicable", "real-environment"]);
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

const KIND_CONTRACTS = Object.freeze({
  "wakeflow-pod-design-request": Object.freeze({
    idField: "podDesignRequestId",
    idType: "pod-design-request",
    ref(record) {
      return `pod/design-requests/${record.podDesignRequestId}.json`;
    },
  }),
  "wakeflow-pod-design-handoff": Object.freeze({
    idField: "podDesignHandoffId",
    idType: "pod-design-handoff",
    ref(record) {
      return `pod/design-handoffs/${record.podDesignHandoffId}.json`;
    },
  }),
  "wakeflow-task-package": Object.freeze({
    idField: "taskPackageId",
    idType: "task-package",
    ref(record) {
      return `task-packages/${record.taskPackageId}.json`;
    },
  }),
  "wakeflow-target-result": Object.freeze({
    idField: "targetResultId",
    idType: "target-result",
    ref(record) {
      return `target-results/${record.targetTaskId}/${record.targetResultId}.json`;
    },
  }),
  "wakeflow-review-candidate": Object.freeze({
    idField: "reviewCandidateId",
    idType: "review-candidate",
    ref(record) {
      return `review-candidates/${record.reviewCandidateId}.json`;
    },
  }),
  "wakeflow-test-card": Object.freeze({
    idField: "testCardId",
    idType: "test-card",
    ref(record) {
      return `test-cards/${record.testCardId}.json`;
    },
  }),
});

export class WakeflowDemandArtifactError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowDemandArtifactError";
    this.code = code;
    this.path = errorPath;
    this.details = details;
  }
}

function fail(code, errorPath, message, details = {}, cause = undefined) {
  throw new WakeflowDemandArtifactError(code, `${message} at ${errorPath}`, {
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

function canonicalDataSnapshot(value, errorPath = "$") {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(
      "wakeflow-demand-artifact-data",
      errorPath,
      "artifact input must be canonical plain data without accessors, symbols, hidden fields, or cycles",
      { causeCode: cause?.code ?? null },
      cause,
    );
  }
}

function frozenClone(value) {
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function assertPlainObject(value, errorPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-demand-artifact-type", errorPath, "artifact value must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-demand-artifact-type", errorPath, "artifact value must be a plain object");
  }
  return value;
}

function assertExactKeys(value, required, optional, errorPath) {
  assertPlainObject(value, errorPath);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("wakeflow-demand-artifact-unknown-field", `${errorPath}/${key}`, `unknown artifact field ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-demand-artifact-required-field", `${errorPath}/${key}`, `missing required artifact field ${key}`);
    }
  }
}

function assertTypedId(value, type, errorPath) {
  try {
    return assertWakeflowId(value, type, errorPath);
  } catch (cause) {
    fail("wakeflow-demand-artifact-id", errorPath, `expected one typed ${type} ID`, {}, cause);
  }
}

function assertDigest(value, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-demand-artifact-digest", errorPath, "digest must be sha256:<64 lowercase hex>");
  }
  return value;
}

function assertTimestamp(value, errorPath) {
  const match = typeof value === "string" ? value.match(TIMESTAMP_RE) : null;
  if (!match) fail("wakeflow-demand-artifact-timestamp", errorPath, "timestamp must be a UTC RFC3339 value");
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
    fail("wakeflow-demand-artifact-timestamp", errorPath, "timestamp must name a real UTC instant");
  }
  return value;
}

function assertToken(value, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || TOKEN_CONTROL_RE.test(value)
  ) {
    fail("wakeflow-demand-artifact-token", errorPath, "token must be non-empty, trimmed, single-line, and control-free");
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
    fail("wakeflow-demand-artifact-text", errorPath, "text must be non-empty, trimmed, and control-free except line breaks");
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
    || /^[a-z][a-z0-9+.-]*:/iu.test(value)
  ) {
    fail("wakeflow-demand-artifact-ref", errorPath, "ref must be a canonical portable relative path");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("wakeflow-demand-artifact-ref", errorPath, "ref cannot contain dot segments");
  }
  if (path.posix.normalize(value) !== value) {
    fail("wakeflow-demand-artifact-ref", errorPath, "ref must already be normalized");
  }
  return value;
}

function assertInteger(value, errorPath, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("wakeflow-demand-artifact-integer", errorPath, `integer must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function assertEnum(value, values, errorPath, label) {
  if (!values.has(value)) {
    fail("wakeflow-demand-artifact-enum", errorPath, `${label} must be one of: ${[...values].join(", ")}`);
  }
  return value;
}

function validateArray(value, errorPath, validator, { min = 0, unique = false, sorted = false } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    fail("wakeflow-demand-artifact-array", errorPath, `array must contain at least ${min} item(s)`);
  }
  const result = value.map((entry, index) => validator(entry, `${errorPath}/${index}`));
  if (unique || sorted) {
    const serialized = result.map((entry) => canonicalJson(entry));
    if (unique && new Set(serialized).size !== serialized.length) {
      fail("wakeflow-demand-artifact-array", errorPath, "array entries must be unique");
    }
    if (sorted && serialized.some((entry, index) => index > 0 && serialized[index - 1].localeCompare(entry) > 0)) {
      fail("wakeflow-demand-artifact-array", errorPath, "array entries must use canonical lexical order");
    }
  }
  return result;
}

function validateStringArray(value, errorPath, options = {}) {
  return validateArray(value, errorPath, assertHumanText, options);
}

function validateTypedIdArray(value, type, errorPath, options = {}) {
  return validateArray(value, errorPath, (entry, entryPath) => assertTypedId(entry, type, entryPath), options);
}

function validateCommon(value, artifactKind, idField, idType) {
  if (value.schemaVersion !== WAKEFLOW_DEMAND_ARTIFACT_SCHEMA_VERSION) {
    fail("wakeflow-demand-artifact-schema", "$/schemaVersion", "artifact schemaVersion must be 1");
  }
  if (value.artifactKind !== artifactKind) {
    fail("wakeflow-demand-artifact-kind", "$/artifactKind", `artifactKind must be ${artifactKind}`);
  }
  assertTypedId(value.programId, "program", "$/programId");
  assertTypedId(value.demandId, "demand", "$/demandId");
  if (value.demandRef !== "demand.json") {
    fail("wakeflow-demand-artifact-demand", "$/demandRef", "demandRef must be demand.json");
  }
  assertDigest(value.demandDigest, "$/demandDigest");
  assertTimestamp(value.createdAt, "$/createdAt");
  assertTypedId(value[idField], idType, `$/${idField}`);
}

function validateRequirementRef(value, errorPath) {
  assertExactKeys(value, ["role", "ref", "digest"], ["anchor"], errorPath);
  assertEnum(value.role, REQUIREMENT_ROLES, `${errorPath}/role`, "requirement role");
  assertPortableRef(value.ref, `${errorPath}/ref`);
  assertDigest(value.digest, `${errorPath}/digest`);
  if (Object.hasOwn(value, "anchor")) assertToken(value.anchor, `${errorPath}/anchor`);
  if (value.role !== "evidence" && !Object.hasOwn(value, "anchor")) {
    fail("wakeflow-demand-artifact-requirement", `${errorPath}/anchor`, "non-evidence requirement refs must name an exact anchor");
  }
  return value;
}

function validateBoundaries(value, errorPath) {
  assertExactKeys(value, ["inScope", "outOfScope", "forbidden"], [], errorPath);
  validateStringArray(value.inScope, `${errorPath}/inScope`, { min: 1, unique: true });
  validateStringArray(value.outOfScope, `${errorPath}/outOfScope`, { unique: true });
  validateStringArray(value.forbidden, `${errorPath}/forbidden`, { unique: true });
  return value;
}

function validateAcceptanceAnchor(value, errorPath) {
  assertExactKeys(value, ["anchorId", "claim", "probe", "expected"], [], errorPath);
  assertToken(value.anchorId, `${errorPath}/anchorId`);
  assertHumanText(value.claim, `${errorPath}/claim`);
  assertHumanText(value.probe, `${errorPath}/probe`);
  assertHumanText(value.expected, `${errorPath}/expected`);
  return value;
}

function validateReviewInputContract(value, errorPath) {
  assertExactKeys(value, ["requiredKinds", "requiredAcceptanceAnchorIds"], [], errorPath);
  validateArray(value.requiredKinds, `${errorPath}/requiredKinds`, assertToken, { unique: true, sorted: true });
  validateArray(value.requiredAcceptanceAnchorIds, `${errorPath}/requiredAcceptanceAnchorIds`, assertToken, { unique: true, sorted: true });
  return value;
}

function validateArtifactTuple(value, errorPath, { kind }) {
  const contract = KIND_CONTRACTS[kind];
  if (!contract) fail("wakeflow-demand-artifact-kind", errorPath, `unsupported tuple kind ${kind}`);
  assertExactKeys(value, [contract.idField, "ref", "digest"], [], errorPath);
  assertTypedId(value[contract.idField], contract.idType, `${errorPath}/${contract.idField}`);
  assertPortableRef(value.ref, `${errorPath}/ref`);
  assertDigest(value.digest, `${errorPath}/digest`);
  const identity = { [contract.idField]: value[contract.idField] };
  if (kind === "wakeflow-target-result") {
    // Result refs require targetTaskId and are therefore checked by the caller.
    return value;
  }
  const expected = contract.ref(identity);
  if (value.ref !== expected) {
    fail("wakeflow-demand-artifact-ref", `${errorPath}/ref`, `${kind} tuple ref must be ${expected}`);
  }
  return value;
}

function validateOptionalLineageTuple(value, errorPath, { idField, idType, refField, digestField }) {
  assertExactKeys(value, [idField, refField, digestField], [], errorPath);
  assertTypedId(value[idField], idType, `${errorPath}/${idField}`);
  assertPortableRef(value[refField], `${errorPath}/${refField}`);
  assertDigest(value[digestField], `${errorPath}/${digestField}`);
  return value;
}

function validatePodDesignRequestTuple(value, errorPath) {
  assertExactKeys(value, ["podDesignRequestId", "ref", "digest"], [], errorPath);
  assertTypedId(value.podDesignRequestId, "pod-design-request", `${errorPath}/podDesignRequestId`);
  const expectedRef = KIND_CONTRACTS["wakeflow-pod-design-request"].ref(value);
  if (value.ref !== expectedRef) {
    fail(
      "wakeflow-demand-artifact-ref",
      `${errorPath}/ref`,
      `Pod Design request tuple ref must be ${expectedRef}`,
    );
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateDemandAuthorityTuple(value, errorPath) {
  assertExactKeys(value, ["ref", "digest"], [], errorPath);
  if (value.ref !== "demand-authority.json") {
    fail(
      "wakeflow-demand-artifact-authority",
      `${errorPath}/ref`,
      "Pod Design handoff authority ref must be demand-authority.json",
    );
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validatePodDesignTestDecision(value, errorPath) {
  assertExactKeys(value, ["mode", "summary"], ["environmentSpecRef"], errorPath);
  assertEnum(value.mode, TEST_MODES, `${errorPath}/mode`, "Pod Design Test mode");
  assertHumanText(value.summary, `${errorPath}/summary`);
  const hasEnvironment = Object.hasOwn(value, "environmentSpecRef");
  if ((value.mode === "real-environment") !== hasEnvironment) {
    fail(
      "wakeflow-demand-artifact-test-decision",
      errorPath,
      "real-environment and environmentSpecRef must appear together",
    );
  }
  if (hasEnvironment) assertPortableRef(value.environmentSpecRef, `${errorPath}/environmentSpecRef`);
  return value;
}

function validatePodLandingEntry(value, errorPath) {
  assertExactKeys(value, ["repositoryId", "responsibilityWindowId", "workScope"], [], errorPath);
  assertTypedId(value.repositoryId, "repository", `${errorPath}/repositoryId`);
  assertTypedId(value.responsibilityWindowId, "window", `${errorPath}/responsibilityWindowId`);
  assertHumanText(value.workScope, `${errorPath}/workScope`);
  return value;
}

// ==================== 一、六类不可变 artifact codec ====================

/**
 * 校验 Pod service 生成的设计请求；这里只确认可移植内容，不推进 Pod phase。
 */
export function validatePodDesignRequestArtifact(value) {
  value = canonicalDataSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "podDesignRequestId",
    "programId",
    "demandId",
    "demandRef",
    "demandDigest",
    "podId",
    "requestType",
    "demandType",
    "originalGoal",
    "completionDefinition",
    "requirementRefs",
    "nonGoals",
    "decisionsRequired",
    "createdAt",
  ], [], "$" );
  validateCommon(value, "wakeflow-pod-design-request", "podDesignRequestId", "pod-design-request");
  assertTypedId(value.podId, "pod", "$/podId");
  assertEnum(value.requestType, POD_DESIGN_REQUEST_TYPES, "$/requestType", "Pod Design request type");
  assertEnum(value.demandType, DEMAND_TYPES, "$/demandType", "demand type");
  assertHumanText(value.originalGoal, "$/originalGoal");
  assertHumanText(value.completionDefinition, "$/completionDefinition");
  validateArray(value.requirementRefs, "$/requirementRefs", validateRequirementRef, { unique: true, sorted: true });
  validateStringArray(value.nonGoals, "$/nonGoals", { unique: true });
  validateStringArray(value.decisionsRequired, "$/decisionsRequired", { unique: true });
  return frozenClone(value);
}

/**
 * 校验 Pod service 生成的设计交付，并闭合 request、authority 与 repository landing tuple。
 */
export function validatePodDesignHandoffArtifact(value) {
  value = canonicalDataSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "podDesignHandoffId",
    "programId",
    "demandId",
    "demandRef",
    "demandDigest",
    "podId",
    "designRequest",
    "demandAuthority",
    "preservesOriginalGoal",
    "requirementRefs",
    "designIntent",
    "landingPlan",
    "testDecision",
    "nonGoals",
    "risks",
    "createdAt",
  ], [], "$" );
  validateCommon(value, "wakeflow-pod-design-handoff", "podDesignHandoffId", "pod-design-handoff");
  assertTypedId(value.podId, "pod", "$/podId");
  validatePodDesignRequestTuple(value.designRequest, "$/designRequest");
  validateDemandAuthorityTuple(value.demandAuthority, "$/demandAuthority");
  if (value.preservesOriginalGoal !== true) {
    fail(
      "wakeflow-demand-artifact-pod-design",
      "$/preservesOriginalGoal",
      "Pod Design handoff must explicitly preserve the original goal",
    );
  }
  validateArray(value.requirementRefs, "$/requirementRefs", validateRequirementRef, { unique: true, sorted: true });
  assertHumanText(value.designIntent, "$/designIntent");
  const landingPlan = validateArray(value.landingPlan, "$/landingPlan", validatePodLandingEntry, {
    min: 1,
  });
  const repositoryIds = landingPlan.map((entry) => entry.repositoryId);
  if (new Set(repositoryIds).size !== repositoryIds.length) {
    fail("wakeflow-demand-artifact-array", "$/landingPlan", "Pod landing repositoryId values must be unique");
  }
  const sortedRepositoryIds = [...repositoryIds].sort((left, right) => left.localeCompare(right));
  if (repositoryIds.some((repositoryId, index) => repositoryId !== sortedRepositoryIds[index])) {
    fail("wakeflow-demand-artifact-array", "$/landingPlan", "Pod landing plan must use lexical repositoryId order");
  }
  validatePodDesignTestDecision(value.testDecision, "$/testDecision");
  validateStringArray(value.nonGoals, "$/nonGoals", { unique: true });
  validateStringArray(value.risks, "$/risks", { unique: true });
  return frozenClone(value);
}

/**
 * 校验 Controller 发给一个 Target/Test 任务的完整执行合同；不判断当前 state 是否允许创建。
 */
export function validateTaskPackageArtifact(value) {
  value = canonicalDataSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "demandRef",
    "demandDigest",
    "demandAuthorityRef",
    "demandAuthorityDigest",
    "createdAt",
    "taskPackageId",
    "targetTaskId",
    "windowId",
    "workType",
    "objective",
    "confirmedContext",
    "requirementRefs",
    "boundaries",
    "completionExpectations",
    "dependsOnTargetTaskIds",
    "acceptanceAnchors",
    "reviewInputContract",
  ], ["repositoryId", "commitExpectation", "designIntent", "testCard", "continuation", "replacesTargetTask"], "$");
  validateCommon(value, "wakeflow-task-package", "taskPackageId", "task-package");
  if (value.demandAuthorityRef !== "demand-authority.json") {
    fail(
      "wakeflow-demand-artifact-authority",
      "$/demandAuthorityRef",
      "task package authority ref must be demand-authority.json",
    );
  }
  assertDigest(value.demandAuthorityDigest, "$/demandAuthorityDigest");
  assertTypedId(value.targetTaskId, "target-task", "$/targetTaskId");
  assertTypedId(value.windowId, "window", "$/windowId");
  if (Object.hasOwn(value, "repositoryId")) assertTypedId(value.repositoryId, "repository", "$/repositoryId");
  assertEnum(value.workType, WORK_TYPES, "$/workType", "workType");
  if ((value.workType === "test") === Object.hasOwn(value, "repositoryId")) {
    fail(
      "wakeflow-demand-artifact-assignment",
      "$/repositoryId",
      "non-Test packages require repositoryId and Test packages must omit it",
    );
  }
  assertHumanText(value.objective, "$/objective");
  validateStringArray(value.confirmedContext, "$/confirmedContext", { min: 1 });
  const requirementRefs = validateArray(value.requirementRefs, "$/requirementRefs", validateRequirementRef, { min: 1, unique: true });
  if (!requirementRefs.some((entry) => entry.role === "goal")) {
    fail("wakeflow-demand-artifact-requirement", "$/requirementRefs", "task package requires at least one goal ref");
  }
  validateBoundaries(value.boundaries, "$/boundaries");
  validateStringArray(value.completionExpectations, "$/completionExpectations", { min: 1, unique: true });
  validateTypedIdArray(value.dependsOnTargetTaskIds, "target-task", "$/dependsOnTargetTaskIds", { unique: true, sorted: true });
  if (value.dependsOnTargetTaskIds.includes(value.targetTaskId)) {
    fail("wakeflow-demand-artifact-dependency", "$/dependsOnTargetTaskIds", "target task cannot depend on itself");
  }
  if (value.workType === "test") {
    if (Object.hasOwn(value, "commitExpectation")) {
      fail(
        "wakeflow-demand-artifact-test-contract",
        "$/commitExpectation",
        "Test packages have no repository commit disposition and must omit commitExpectation",
      );
    }
  } else {
    if (!Object.hasOwn(value, "commitExpectation")) {
      fail(
        "wakeflow-demand-artifact-repository",
        "$/commitExpectation",
        "non-Test packages require one explicit commit expectation",
      );
    }
    assertEnum(value.commitExpectation, COMMIT_EXPECTATIONS, "$/commitExpectation", "commit expectation");
  }
  const anchors = validateArray(value.acceptanceAnchors, "$/acceptanceAnchors", validateAcceptanceAnchor, {
    min: value.workType === "implementation" ? 1 : 0,
    unique: true,
  });
  const anchorIds = anchors.map((entry) => entry.anchorId);
  if (new Set(anchorIds).size !== anchorIds.length) {
    fail("wakeflow-demand-artifact-anchor", "$/acceptanceAnchors", "acceptance anchor IDs must be unique");
  }
  validateReviewInputContract(value.reviewInputContract, "$/reviewInputContract");
  for (const anchorId of value.reviewInputContract.requiredAcceptanceAnchorIds) {
    if (!anchorIds.includes(anchorId)) {
      fail("wakeflow-demand-artifact-anchor", "$/reviewInputContract", `unknown required acceptance anchor ${anchorId}`);
    }
  }
  if (value.workType === "test") {
    if (anchors.length !== 0 || value.reviewInputContract.requiredAcceptanceAnchorIds.length !== 0) {
      fail(
        "wakeflow-demand-artifact-test-contract",
        "$/acceptanceAnchors",
        "Test packages must use approved-plan test-step mapping and cannot define acceptance anchors",
      );
    }
  } else {
    const requiredAnchorIds = value.reviewInputContract.requiredAcceptanceAnchorIds;
    const sortedAnchorIds = [...anchorIds].sort((left, right) => left.localeCompare(right));
    if (
      requiredAnchorIds.length !== sortedAnchorIds.length
      || requiredAnchorIds.some((anchorId, index) => anchorId !== sortedAnchorIds[index])
    ) {
      fail(
        "wakeflow-demand-artifact-anchor",
        "$/reviewInputContract/requiredAcceptanceAnchorIds",
        "non-Test review contract must require the exact authored acceptance-anchor set",
      );
    }
  }
  if (Object.hasOwn(value, "designIntent")) assertHumanText(value.designIntent, "$/designIntent");
  if (Object.hasOwn(value, "testCard")) {
    validateArtifactTuple(value.testCard, "$/testCard", { kind: "wakeflow-test-card" });
  }
  if ((value.workType === "test") !== Object.hasOwn(value, "testCard")) {
    fail("wakeflow-demand-artifact-test-contract", "$/testCard", "workType=test and exact testCard tuple must appear together");
  }
  if (Object.hasOwn(value, "continuation")) {
    assertExactKeys(value.continuation, ["kind", "previousTaskPackageId", "ref", "digest", "reason"], [], "$/continuation");
    assertEnum(value.continuation.kind, new Set(["optimization", "requirement-supplement", "verified-bug"]), "$/continuation/kind", "continuation kind");
    assertTypedId(value.continuation.previousTaskPackageId, "task-package", "$/continuation/previousTaskPackageId");
    assertPortableRef(value.continuation.ref, "$/continuation/ref");
    const expectedContinuationRef = `task-packages/${value.continuation.previousTaskPackageId}.json`;
    if (value.continuation.ref !== expectedContinuationRef) {
      fail(
        "wakeflow-demand-artifact-ref",
        "$/continuation/ref",
        `continuation ref must be ${expectedContinuationRef}`,
      );
    }
    assertDigest(value.continuation.digest, "$/continuation/digest");
    assertHumanText(value.continuation.reason, "$/continuation/reason");
  }
  if (Object.hasOwn(value, "replacesTargetTask")) {
    validateOptionalLineageTuple(value.replacesTargetTask, "$/replacesTargetTask", {
      idField: "targetTaskId",
      idType: "target-task",
      refField: "taskPackageRef",
      digestField: "taskPackageDigest",
    });
    const replacementMatch = value.replacesTargetTask.taskPackageRef.match(/^task-packages\/(task-package_[^/]+)\.json$/u);
    if (!replacementMatch) {
      fail(
        "wakeflow-demand-artifact-ref",
        "$/replacesTargetTask/taskPackageRef",
        "replacement package ref must be one canonical typed task-packages/{taskPackageId}.json path",
      );
    }
    assertTypedId(replacementMatch[1], "task-package", "$/replacesTargetTask/taskPackageRef");
  }
  if (Object.hasOwn(value, "continuation") && Object.hasOwn(value, "replacesTargetTask")) {
    fail(
      "wakeflow-demand-artifact-lineage",
      "$",
      "one task package cannot be both a continuation and a replacement",
    );
  }
  return frozenClone(value);
}

function validateObservedState(value, errorPath) {
  assertExactKeys(value, ["revision", "eventId", "eventDigest"], [], errorPath);
  assertInteger(value.revision, `${errorPath}/revision`, { minimum: 1 });
  assertToken(value.eventId, `${errorPath}/eventId`);
  assertDigest(value.eventDigest, `${errorPath}/eventDigest`);
  return value;
}

function validateTransportRef(value, errorPath) {
  assertExactKeys(value, ["id", "ref", "digest"], [], errorPath);
  assertToken(value.id, `${errorPath}/id`);
  assertPortableRef(value.ref, `${errorPath}/ref`);
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateAssignment(value, errorPath) {
  assertExactKeys(value, ["windowId"], ["repositoryId"], errorPath);
  assertTypedId(value.windowId, "window", `${errorPath}/windowId`);
  if (Object.hasOwn(value, "repositoryId")) assertTypedId(value.repositoryId, "repository", `${errorPath}/repositoryId`);
  return value;
}

function validateRepositoryChange(value, errorPath) {
  assertExactKeys(value, ["repositoryId", "disposition", "commits"], [], errorPath);
  assertTypedId(value.repositoryId, "repository", `${errorPath}/repositoryId`);
  assertEnum(value.disposition, REPOSITORY_DISPOSITIONS, `${errorPath}/disposition`, "repository disposition");
  validateArray(value.commits, `${errorPath}/commits`, assertToken, { unique: true, sorted: true });
  if ((value.disposition === "committed") !== (value.commits.length > 0)) {
    fail("wakeflow-demand-artifact-commit", errorPath, "committed disposition requires commits and other dispositions forbid them");
  }
  return value;
}

function validatePortableDigestRef(value, errorPath) {
  assertExactKeys(value, ["ref", "digest"], [], errorPath);
  assertPortableRef(value.ref, `${errorPath}/ref`);
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateEvidenceLocator(value, errorPath) {
  assertExactKeys(value, ["kind", "ref", "digest"], [], errorPath);
  assertToken(value.kind, `${errorPath}/kind`);
  assertPortableRef(value.ref, `${errorPath}/ref`);
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateCraftMapping(value, errorPath) {
  assertPlainObject(value, errorPath);
  if (value.kind === "acceptance-anchor") {
    assertExactKeys(value, ["kind", "anchorId", "evidenceRefs"], [], errorPath);
    assertToken(value.anchorId, `${errorPath}/anchorId`);
    validateArray(value.evidenceRefs, `${errorPath}/evidenceRefs`, validatePortableDigestRef, { min: 1, unique: true, sorted: true });
    return value;
  }
  if (value.kind === "test-step") {
    assertExactKeys(value, ["kind", "planIndex", "step", "ref"], [], errorPath);
    assertInteger(value.planIndex, `${errorPath}/planIndex`, { minimum: 0 });
    assertHumanText(value.step, `${errorPath}/step`);
    assertPortableRef(value.ref, `${errorPath}/ref`);
    return value;
  }
  fail(
    "wakeflow-demand-artifact-craft",
    `${errorPath}/kind`,
    "craft mapping kind must be acceptance-anchor or test-step",
  );
}

/**
 * 校验 Target 返回的结果证据、repository disposition 与 craft mapping；current 选择由 service 决定。
 */
export function validateTargetResultArtifact(value) {
  value = canonicalDataSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "demandRef",
    "demandDigest",
    "createdAt",
    "targetResultId",
    "targetTaskId",
    "taskPackage",
    "assignment",
    "observedState",
    "transport",
    "outcome",
    "summary",
    "repositoryChanges",
    "evidenceLocators",
    "verification",
    "risks",
    "craftMapping",
  ], ["supersedes"], "$");
  validateCommon(value, "wakeflow-target-result", "targetResultId", "target-result");
  assertTypedId(value.targetTaskId, "target-task", "$/targetTaskId");
  validateArtifactTuple(value.taskPackage, "$/taskPackage", { kind: "wakeflow-task-package" });
  validateAssignment(value.assignment, "$/assignment");
  validateObservedState(value.observedState, "$/observedState");
  assertExactKeys(value.transport, ["group", "envelope"], [], "$/transport");
  validateTransportRef(value.transport.group, "$/transport/group");
  validateTransportRef(value.transport.envelope, "$/transport/envelope");
  assertEnum(value.outcome, RESULT_OUTCOMES, "$/outcome", "result outcome");
  assertHumanText(value.summary, "$/summary");
  const changes = validateArray(value.repositoryChanges, "$/repositoryChanges", validateRepositoryChange, { unique: true });
  const repositories = changes.map((entry) => entry.repositoryId);
  if (new Set(repositories).size !== repositories.length) {
    fail("wakeflow-demand-artifact-repository", "$/repositoryChanges", "repository changes must be unique by repositoryId");
  }
  validateArray(value.evidenceLocators, "$/evidenceLocators", validateEvidenceLocator, { unique: true, sorted: true });
  validateStringArray(value.verification, "$/verification", { unique: true });
  validateStringArray(value.risks, "$/risks", { unique: true });
  validateArray(value.craftMapping, "$/craftMapping", validateCraftMapping, { unique: true });
  if (Object.hasOwn(value, "supersedes")) {
    assertExactKeys(value.supersedes, ["targetResultId", "ref", "digest"], [], "$/supersedes");
    assertTypedId(value.supersedes.targetResultId, "target-result", "$/supersedes/targetResultId");
    assertPortableRef(value.supersedes.ref, "$/supersedes/ref");
    const expectedSupersedesRef = `target-results/${value.targetTaskId}/${value.supersedes.targetResultId}.json`;
    if (value.supersedes.ref !== expectedSupersedesRef) {
      fail(
        "wakeflow-demand-artifact-ref",
        "$/supersedes/ref",
        `supersedes ref must be ${expectedSupersedesRef}`,
      );
    }
    assertDigest(value.supersedes.digest, "$/supersedes/digest");
    if (value.supersedes.targetResultId === value.targetResultId) {
      fail("wakeflow-demand-artifact-supersedes", "$/supersedes", "result cannot supersede itself");
    }
  }
  return frozenClone(value);
}

function validateReviewResult(value, errorPath) {
  assertExactKeys(value, ["targetTaskId", "targetResultId", "ref", "digest", "outcome"], [], errorPath);
  assertTypedId(value.targetTaskId, "target-task", `${errorPath}/targetTaskId`);
  assertTypedId(value.targetResultId, "target-result", `${errorPath}/targetResultId`);
  const expectedRef = `target-results/${value.targetTaskId}/${value.targetResultId}.json`;
  if (value.ref !== expectedRef) {
    fail("wakeflow-demand-artifact-ref", `${errorPath}/ref`, `review result ref must be ${expectedRef}`);
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  assertEnum(value.outcome, RESULT_OUTCOMES, `${errorPath}/outcome`, "result outcome");
  return value;
}

/**
 * 校验一次 review 输入快照的结果集合、scope 分区与可声明决定集合。
 */
export function validateReviewCandidateArtifact(value) {
  value = canonicalDataSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "demandRef",
    "demandDigest",
    "createdAt",
    "reviewCandidateId",
    "fromState",
    "reviewScope",
    "results",
    "resultSetDigest",
    "readyTargetTaskIds",
    "blockedTargetTaskIds",
    "missingTargetTaskIds",
    "allowedDecisions",
    "structuralGaps",
  ], [], "$");
  validateCommon(value, "wakeflow-review-candidate", "reviewCandidateId", "review-candidate");
  assertExactKeys(value.fromState, ["revision", "stateDigest", "eventId", "eventDigest"], [], "$/fromState");
  assertInteger(value.fromState.revision, "$/fromState/revision", { minimum: 1 });
  assertDigest(value.fromState.stateDigest, "$/fromState/stateDigest");
  assertToken(value.fromState.eventId, "$/fromState/eventId");
  assertDigest(value.fromState.eventDigest, "$/fromState/eventDigest");
  assertExactKeys(value.reviewScope, ["targetTaskIds", "excludedTargetTaskIds"], [], "$/reviewScope");
  const scope = validateTypedIdArray(value.reviewScope.targetTaskIds, "target-task", "$/reviewScope/targetTaskIds", { min: 1, unique: true, sorted: true });
  const excluded = validateTypedIdArray(value.reviewScope.excludedTargetTaskIds, "target-task", "$/reviewScope/excludedTargetTaskIds", { unique: true, sorted: true });
  if (excluded.some((id) => scope.includes(id))) {
    fail("wakeflow-demand-artifact-review-scope", "$/reviewScope", "included and excluded task sets must be disjoint");
  }
  const results = validateArray(value.results, "$/results", validateReviewResult, { unique: true });
  if (results.some((entry, index) => (
    index > 0
    && results[index - 1].targetTaskId.localeCompare(entry.targetTaskId) > 0
  ))) {
    fail(
      "wakeflow-demand-artifact-array",
      "$/results",
      "review results must use canonical targetTaskId order",
    );
  }
  assertDigest(value.resultSetDigest, "$/resultSetDigest");
  if (value.resultSetDigest !== canonicalJsonDigest(results)) {
    fail("wakeflow-demand-artifact-result-set", "$/resultSetDigest", "resultSetDigest must bind the ordered exact result tuples");
  }
  const ready = validateTypedIdArray(value.readyTargetTaskIds, "target-task", "$/readyTargetTaskIds", { unique: true, sorted: true });
  const blocked = validateTypedIdArray(value.blockedTargetTaskIds, "target-task", "$/blockedTargetTaskIds", { unique: true, sorted: true });
  const missing = validateTypedIdArray(value.missingTargetTaskIds, "target-task", "$/missingTargetTaskIds", { unique: true, sorted: true });
  const partition = [...ready, ...blocked, ...missing];
  if (
    new Set(partition).size !== partition.length
    || partition.length !== scope.length
    || [...partition].sort().some((id, index) => id !== [...scope].sort()[index])
  ) {
    fail("wakeflow-demand-artifact-review-scope", "$", "ready/blocked/missing must partition the exact review scope");
  }
  const resultTasks = results.map((entry) => entry.targetTaskId);
  if (new Set(resultTasks).size !== resultTasks.length) {
    fail("wakeflow-demand-artifact-result-set", "$/results", "review candidate may bind at most one result per task");
  }
  if (results.some((entry) => !ready.includes(entry.targetTaskId) && !blocked.includes(entry.targetTaskId))) {
    fail("wakeflow-demand-artifact-result-set", "$/results", "results may appear only for ready or blocked tasks");
  }
  if ([...ready, ...blocked].some((id) => !resultTasks.includes(id))) {
    fail("wakeflow-demand-artifact-result-set", "$/results", "each ready or blocked task requires its exact result tuple");
  }
  validateArray(value.allowedDecisions, "$/allowedDecisions", (entry, entryPath) => assertEnum(entry, REVIEW_DECISIONS, entryPath, "review decision"), { min: 1, unique: true, sorted: true });
  validateStringArray(value.structuralGaps, "$/structuralGaps", { unique: true });
  return frozenClone(value);
}

function validateChangeControl(value, errorPath) {
  assertExactKeys(value, [
    "testMayChangeApproach",
    "testMayChangeGoal",
    "testMayAddUnmappedSteps",
    "testMayUseUnlistedSkills",
    "route",
  ], [], errorPath);
  for (const field of [
    "testMayChangeApproach",
    "testMayChangeGoal",
    "testMayAddUnmappedSteps",
    "testMayUseUnlistedSkills",
  ]) {
    if (value[field] !== false) fail("wakeflow-demand-artifact-test-change", `${errorPath}/${field}`, `${field} must remain false`);
  }
  if (value.route !== "return-blocked-to-controller") {
    fail("wakeflow-demand-artifact-test-change", `${errorPath}/route`, "Test change route must return blocked to Controller");
  }
  return value;
}

function validateTestExecutionContract(value, errorPath) {
  assertExactKeys(value, [
    "requirementGoal",
    "approvedPlan",
    "allowedSkills",
    "setupPolicy",
    "maxAttempts",
    "restartConditions",
    "changeControl",
  ], [], errorPath);
  assertHumanText(value.requirementGoal, `${errorPath}/requirementGoal`);
  validateStringArray(value.approvedPlan, `${errorPath}/approvedPlan`, { min: 1 });
  validateArray(value.allowedSkills, `${errorPath}/allowedSkills`, assertToken, { unique: true, sorted: true });
  assertEnum(value.setupPolicy, SETUP_POLICIES, `${errorPath}/setupPolicy`, "setup policy");
  assertInteger(value.maxAttempts, `${errorPath}/maxAttempts`, { minimum: 1, maximum: 10 });
  validateStringArray(value.restartConditions, `${errorPath}/restartConditions`, { unique: true });
  if (value.setupPolicy === "fresh-per-attempt" && value.restartConditions.length === 0) {
    fail("wakeflow-demand-artifact-test-restart", `${errorPath}/restartConditions`, "fresh-per-attempt requires explicit restart conditions");
  }
  validateChangeControl(value.changeControl, `${errorPath}/changeControl`);
  return value;
}

function validateBoundaryGate(value, errorPath) {
  assertExactKeys(value, [
    "question",
    "objectBoundary",
    "controllerSelfChecks",
    "realScenarioConditions",
    "successMeans",
    "failureMeans",
    "cannotConclude",
    "stopConditions",
  ], [], errorPath);
  assertHumanText(value.question, `${errorPath}/question`);
  assertHumanText(value.objectBoundary, `${errorPath}/objectBoundary`);
  for (const field of [
    "controllerSelfChecks",
    "realScenarioConditions",
    "successMeans",
    "failureMeans",
    "cannotConclude",
    "stopConditions",
  ]) {
    validateStringArray(value[field], `${errorPath}/${field}`, { min: 1, unique: true });
  }
  return value;
}

/**
 * 校验 Controller 冻结的真实环境 Test 合同；它不创建 Test task 或执行测试。
 */
export function validateTestCardArtifact(value) {
  value = canonicalDataSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "demandRef",
    "demandDigest",
    "createdAt",
    "testCardId",
    "targetTaskId",
    "windowId",
    "demandAuthorityRef",
    "demandAuthorityDigest",
    "strategySource",
    "observedState",
    "executionContract",
    "boundaryGate",
    "evidenceRequired",
    "allowedOperations",
    "forbiddenOperations",
  ], [], "$");
  validateCommon(value, "wakeflow-test-card", "testCardId", "test-card");
  assertTypedId(value.targetTaskId, "target-task", "$/targetTaskId");
  assertTypedId(value.windowId, "window", "$/windowId");
  if (value.demandAuthorityRef !== "demand-authority.json") {
    fail("wakeflow-demand-artifact-authority", "$/demandAuthorityRef", "Test card authority ref must be demand-authority.json");
  }
  assertDigest(value.demandAuthorityDigest, "$/demandAuthorityDigest");
  validatePortableDigestRef(value.strategySource, "$/strategySource");
  validateObservedState(value.observedState, "$/observedState");
  validateTestExecutionContract(value.executionContract, "$/executionContract");
  validateBoundaryGate(value.boundaryGate, "$/boundaryGate");
  validateStringArray(value.evidenceRequired, "$/evidenceRequired", { unique: true });
  validateStringArray(value.allowedOperations, "$/allowedOperations", { unique: true });
  validateStringArray(value.forbiddenOperations, "$/forbiddenOperations", { min: 1, unique: true });
  return frozenClone(value);
}

// ==================== 二、统一 kind 分派与不可变身份 ====================

/**
 * 按 artifactKind 分派六类 codec；调用方不能用额外字段或行为型对象扩展记录。
 */
export function validateDemandArtifactRecord(value) {
  value = canonicalDataSnapshot(value);
  assertPlainObject(value, "$");
  if (value.artifactKind === "wakeflow-pod-design-request") return validatePodDesignRequestArtifact(value);
  if (value.artifactKind === "wakeflow-pod-design-handoff") return validatePodDesignHandoffArtifact(value);
  if (value.artifactKind === "wakeflow-task-package") return validateTaskPackageArtifact(value);
  if (value.artifactKind === "wakeflow-target-result") return validateTargetResultArtifact(value);
  if (value.artifactKind === "wakeflow-review-candidate") return validateReviewCandidateArtifact(value);
  if (value.artifactKind === "wakeflow-test-card") return validateTestCardArtifact(value);
  fail("wakeflow-demand-artifact-kind", "$/artifactKind", `unsupported artifact kind ${String(value.artifactKind)}`);
}

/**
 * 从已验证记录派生其唯一 portable ref。
 */
export function demandArtifactRef(value) {
  const record = validateDemandArtifactRecord(value);
  return KIND_CONTRACTS[record.artifactKind].ref(record);
}

/**
 * 从已验证记录的 canonical JSON 语义派生 SHA-256 digest。
 */
export function demandArtifactDigest(value) {
  return canonicalJsonDigest(validateDemandArtifactRecord(value));
}

/**
 * 生成 immutable 文件唯一允许的 canonical JSON 加单个 LF 字节。
 */
export function demandArtifactCanonicalBytes(value) {
  const record = validateDemandArtifactRecord(value);
  return Buffer.concat([canonicalJsonBytes(record), Buffer.from("\n", "utf8")]);
}

/**
 * 返回 event/state/write intent 共用的 kind、typed ID、ref 与 digest tuple。
 */
export function demandArtifactIdentity(value) {
  const record = validateDemandArtifactRecord(value);
  const contract = KIND_CONTRACTS[record.artifactKind];
  return deepFreeze({
    artifactKind: record.artifactKind,
    artifactId: record[contract.idField],
    ref: contract.ref(record),
    digest: canonicalJsonDigest(record),
  });
}

/**
 * 只读查询 kind 对应的 ID 字段、ID 类型和 ref 派生器；未知 kind 返回 null。
 */
export function demandArtifactContractForKind(kind) {
  if (!KIND_SET.has(kind)) return null;
  return KIND_CONTRACTS[kind];
}

/**
 * 闭合事务 writer 的 metadata 与 canonical artifact identity，并可选绑定不可变 demand。
 */
export function validateDemandArtifactWriteIntent(value, options = {}) {
  value = canonicalDataSnapshot(value);
  options = canonicalDataSnapshot(options, "$options");
  assertExactKeys(options, [], ["demand"], "$options");
  const demand = options.demand ?? null;
  assertExactKeys(value, ["artifactKind", "artifactId", "ref", "digest", "value"], [], "$");
  if (!KIND_SET.has(value.artifactKind)) {
    fail("wakeflow-demand-artifact-kind", "$/artifactKind", `unsupported write artifact ${String(value.artifactKind)}`);
  }
  const record = validateDemandArtifactRecord(value.value);
  const identity = demandArtifactIdentity(record);
  for (const field of ["artifactKind", "artifactId", "ref", "digest"]) {
    if (value[field] !== identity[field]) {
      fail("wakeflow-demand-artifact-write", `$/${field}`, `write ${field} must match the exact canonical artifact identity`);
    }
  }
  if (demand !== null && (
    record.programId !== demand.programId
    || record.demandId !== demand.demandId
    || record.demandRef !== "demand.json"
    || record.demandDigest !== canonicalJsonDigest(demand)
  )) {
    fail("wakeflow-demand-artifact-demand", "$/value", "artifact must bind the exact immutable demand identity");
  }
  return frozenClone(value);
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

// ==================== 三、私有 state root 内的精确物理读取 ====================

function currentEffectiveUid() {
  if (process.platform === "win32" || typeof process.geteuid !== "function") return null;
  return BigInt(process.geteuid());
}

function permissionBits(stat) {
  return Number(stat.mode & 0o777n);
}

function nodeOwnedByCurrentUser(stat) {
  const expectedUid = currentEffectiveUid();
  return expectedUid === null || stat.uid === expectedUid;
}

function sameStableNode(left, right) {
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
    fail("wakeflow-demand-artifact-root", "$stateRoot", "stateRoot must be a non-empty path");
  }
  const root = path.resolve(stateRoot);
  let stat;
  try {
    stat = lstatSync(root, { bigint: true });
  } catch (cause) {
    fail("wakeflow-demand-artifact-root", "$stateRoot", "stateRoot must exist", { root }, cause);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-demand-artifact-root", "$stateRoot", "stateRoot must be a real directory", { root });
  }
  if (process.platform !== "win32" && permissionBits(stat) !== 0o700) {
    fail("wakeflow-demand-artifact-mode", "$stateRoot", "stateRoot must use mode 0700", {
      root,
      mode: permissionBits(stat),
    });
  }
  if (!nodeOwnedByCurrentUser(stat)) {
    fail("wakeflow-demand-artifact-owner", "$stateRoot", "stateRoot must be owned by the current effective user", { root });
  }
  let real;
  let after;
  try {
    real = realpathSync(root);
    after = lstatSync(root, { bigint: true });
  } catch (cause) {
    fail("wakeflow-demand-artifact-root-race", "$stateRoot", "stateRoot changed while resolving", { root }, cause);
  }
  if (!after.isDirectory() || after.isSymbolicLink() || !sameStableNode(stat, after)) {
    fail("wakeflow-demand-artifact-root-race", "$stateRoot", "stateRoot changed while resolving", { root });
  }
  return Object.freeze({ root, real });
}

function resolveExactRef(rootInfo, ref) {
  assertPortableRef(ref, "$ref");
  const candidate = path.resolve(rootInfo.root, ...ref.split("/"));
  if (!pathInside(rootInfo.root, candidate)) {
    fail("wakeflow-demand-artifact-ref", "$ref", "artifact ref escapes stateRoot", { ref });
  }
  let current = rootInfo.root;
  for (const segment of ref.split("/").slice(0, -1)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = lstatSync(current, { bigint: true });
    } catch (cause) {
      fail("wakeflow-demand-artifact-parent", "$ref", "artifact parent directory is missing", { ref, current }, cause);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("wakeflow-demand-artifact-parent", "$ref", "artifact parent must be a real directory", { ref, current });
    }
    if (process.platform !== "win32" && permissionBits(stat) !== 0o700) {
      fail("wakeflow-demand-artifact-mode", "$ref", "artifact parent directories must use mode 0700", {
        ref,
        current,
        mode: permissionBits(stat),
      });
    }
    if (!nodeOwnedByCurrentUser(stat)) {
      fail("wakeflow-demand-artifact-owner", "$ref", "artifact parent must be owned by the current effective user", {
        ref,
        current,
      });
    }
    let currentReal;
    let after;
    try {
      currentReal = realpathSync(current);
      after = lstatSync(current, { bigint: true });
    } catch (cause) {
      fail("wakeflow-demand-artifact-parent-race", "$ref", "artifact parent changed while resolving", { ref, current }, cause);
    }
    if (!after.isDirectory() || after.isSymbolicLink() || !sameStableNode(stat, after)) {
      fail("wakeflow-demand-artifact-parent-race", "$ref", "artifact parent changed while resolving", { ref, current });
    }
    if (!pathInside(rootInfo.real, currentReal)) {
      fail("wakeflow-demand-artifact-parent", "$ref", "artifact parent resolves outside stateRoot", { ref, current });
    }
  }
  return candidate;
}

function readExactRegularFile(file, ref) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (cause) {
    fail("wakeflow-demand-artifact-file", "$ref", "referenced artifact file is missing", { ref, file }, cause);
  }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n) {
    fail("wakeflow-demand-artifact-file", "$ref", "referenced artifact must be a regular non-symlink file", { ref, file });
  }
  if (process.platform !== "win32" && permissionBits(before) !== 0o600) {
    fail("wakeflow-demand-artifact-mode", "$ref", "artifact files must use mode 0600", {
      ref,
      file,
      mode: permissionBits(before),
    });
  }
  if (!nodeOwnedByCurrentUser(before)) {
    fail("wakeflow-demand-artifact-owner", "$ref", "artifact file must be owned by the current effective user", { ref, file });
  }
  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    fail("wakeflow-demand-artifact-file-race", "$ref", "artifact changed before safe open", { ref, file }, cause);
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile()
      || opened.nlink !== 1n
      || (process.platform !== "win32" && permissionBits(opened) !== 0o600)
      || !nodeOwnedByCurrentUser(opened)
      || !sameStableNode(before, opened)
    ) {
      fail("wakeflow-demand-artifact-file-race", "$ref", "artifact changed while opening", { ref, file });
    }
    let bytes;
    let afterDescriptor;
    let afterPath;
    try {
      bytes = readFileSync(descriptor);
      afterDescriptor = fstatSync(descriptor, { bigint: true });
      afterPath = lstatSync(file, { bigint: true });
    } catch (cause) {
      fail("wakeflow-demand-artifact-file-race", "$ref", "artifact changed while reading", { ref, file }, cause);
    }
    if (
      afterPath.isSymbolicLink()
      || !afterPath.isFile()
      || afterPath.nlink !== 1n
      || (process.platform !== "win32" && permissionBits(afterPath) !== 0o600)
      || !nodeOwnedByCurrentUser(afterPath)
      || !sameStableNode(opened, afterDescriptor)
      || !sameStableNode(afterDescriptor, afterPath)
      || BigInt(bytes.length) !== afterDescriptor.size
    ) {
      fail("wakeflow-demand-artifact-file-race", "$ref", "artifact changed while reading", { ref, file });
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * 从显式 stateRoot/ref 读取一份 canonical artifact，并复验调用方提供的全部 identity 期望。
 */
export function loadDemandArtifactByRef(input = {}) {
  input = canonicalDataSnapshot(input, "$input");
  assertExactKeys(input, ["stateRoot", "ref"], [
    "digest",
    "expectedArtifactKind",
    "expectedArtifactId",
    "expectedProgramId",
    "expectedDemandId",
  ], "$input");
  const {
    stateRoot,
    ref,
    digest = null,
    expectedArtifactKind = null,
    expectedArtifactId = null,
    expectedProgramId = null,
    expectedDemandId = null,
  } = input;
  const rootInfo = inspectStateRoot(stateRoot);
  const file = resolveExactRef(rootInfo, ref);
  const bytes = readExactRegularFile(file, ref);
  let text;
  try {
    text = UTF8_FATAL.decode(bytes);
  } catch (cause) {
    fail("wakeflow-demand-artifact-encoding", "$ref", "artifact must be valid UTF-8", { ref, file }, cause);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    fail("wakeflow-demand-artifact-json", "$ref", "artifact must be valid JSON", { ref, file }, cause);
  }
  const record = validateDemandArtifactRecord(raw);
  const canonicalBytes = demandArtifactCanonicalBytes(record);
  if (!bytes.equals(canonicalBytes)) {
    fail("wakeflow-demand-artifact-encoding", "$ref", "artifact must use canonical JSON plus one LF", { ref, file });
  }
  const identity = demandArtifactIdentity(record);
  if (identity.ref !== ref) {
    fail("wakeflow-demand-artifact-ref", "$ref", `artifact bytes require canonical ref ${identity.ref}`, { ref, expectedRef: identity.ref });
  }
  if (digest !== null) {
    assertDigest(digest, "$digest");
    if (identity.digest !== digest) {
      fail("wakeflow-demand-artifact-digest", "$digest", "artifact digest does not match exact canonical bytes", {
        expectedDigest: digest,
        actualDigest: identity.digest,
      });
    }
  }
  if (expectedArtifactKind !== null && identity.artifactKind !== expectedArtifactKind) {
    fail("wakeflow-demand-artifact-kind", "$expectedArtifactKind", `artifact kind is ${identity.artifactKind}, not ${expectedArtifactKind}`);
  }
  if (expectedArtifactId !== null && identity.artifactId !== expectedArtifactId) {
    fail("wakeflow-demand-artifact-id", "$expectedArtifactId", `artifact ID is ${identity.artifactId}, not ${expectedArtifactId}`);
  }
  if (expectedProgramId !== null) {
    assertTypedId(expectedProgramId, "program", "$expectedProgramId");
    if (record.programId !== expectedProgramId) {
      fail("wakeflow-demand-artifact-program", "$/programId", "artifact belongs to another program");
    }
  }
  if (expectedDemandId !== null) {
    assertTypedId(expectedDemandId, "demand", "$expectedDemandId");
    if (record.demandId !== expectedDemandId) {
      fail("wakeflow-demand-artifact-demand", "$/demandId", "artifact belongs to another demand");
    }
  }
  // Buffer instances cannot be frozen in Node.js. Freeze the metadata wrapper
  // and all semantic records, but return a defensive byte copy whose mutation
  // cannot affect the validated record or any later filesystem read.
  return Object.freeze({
    record,
    identity,
    ref,
    file,
    bytes: Buffer.from(bytes),
    byteDigest: `sha256:${sha256Bytes(bytes)}`,
  });
}

function validateExpectedInventoryIdentity(value, index) {
  const errorPath = `$expectedArtifacts/${index}`;
  assertExactKeys(value, ["artifactKind", "artifactId", "ref", "digest"], [], errorPath);
  const contract = KIND_CONTRACTS[value.artifactKind];
  if (!contract) fail("wakeflow-demand-artifact-kind", `${errorPath}/artifactKind`, "inventory expectation has unsupported kind");
  assertTypedId(value.artifactId, contract.idType, `${errorPath}/artifactId`);
  assertPortableRef(value.ref, `${errorPath}/ref`);
  assertDigest(value.digest, `${errorPath}/digest`);
  if (value.artifactKind === "wakeflow-target-result") {
    const match = value.ref.match(/^target-results\/(target-task_[^/]+)\/(target-result_[^/]+)\.json$/u);
    if (!match || match[2] !== value.artifactId) {
      fail("wakeflow-demand-artifact-ref", `${errorPath}/ref`, "TargetResult inventory ref must bind its exact artifact ID");
    }
    assertTypedId(match[1], "target-task", `${errorPath}/ref`);
  } else if (value.ref !== contract.ref({ [contract.idField]: value.artifactId })) {
    fail("wakeflow-demand-artifact-ref", `${errorPath}/ref`, "inventory ref must be the canonical artifact path");
  }
  return frozenClone(value);
}

function inventoryDirectoryIssue(ref, code) {
  return Object.freeze({ ref, classification: "invalid", code });
}

function opaqueInventoryChildRef(capabilityRootRef, basename) {
  const digest = sha256Bytes(Buffer.from(basename, "utf8"));
  return `${capabilityRootRef}unknown-sha256-${digest}`;
}

function inventoryUnknownEntryIssue(capabilityRootRef, basename) {
  return inventoryDirectoryIssue(
    opaqueInventoryChildRef(capabilityRootRef, basename),
    "wakeflow-demand-artifact-inventory-unknown-entry",
  );
}

// ==================== 四、Controller event 期望与物理库存诊断 ====================

/**
 * 扫描六类 artifact capability roots，并只返回稳定、脱敏的分类与 identity。
 */
export function inspectDemandArtifactInventory(input = {}) {
  input = canonicalDataSnapshot(input, "$input");
  assertExactKeys(input, ["stateRoot"], [
    "expectedProgramId",
    "expectedDemandId",
    "expectedArtifacts",
  ], "$input");
  const {
    stateRoot,
    expectedProgramId = null,
    expectedDemandId = null,
    expectedArtifacts = [],
  } = input;
  const rootInfo = inspectStateRoot(stateRoot);
  if (expectedProgramId !== null) assertTypedId(expectedProgramId, "program", "$expectedProgramId");
  if (expectedDemandId !== null) assertTypedId(expectedDemandId, "demand", "$expectedDemandId");
  if (!Array.isArray(expectedArtifacts)) {
    fail("wakeflow-demand-artifact-inventory", "$expectedArtifacts", "expectedArtifacts must be an array");
  }
  const expected = expectedArtifacts.map(validateExpectedInventoryIdentity);
  const expectedByRef = new Map();
  const expectedByIdentity = new Map();
  for (const identity of expected) {
    if (expectedByRef.has(identity.ref)) {
      fail("wakeflow-demand-artifact-inventory", "$expectedArtifacts", `duplicate expected artifact ref ${identity.ref}`);
    }
    expectedByRef.set(identity.ref, identity);
    const identityKey = `${identity.artifactKind}\u0000${identity.artifactId}`;
    const priorRef = expectedByIdentity.get(identityKey);
    if (priorRef && priorRef !== identity.ref) {
      fail(
        "wakeflow-demand-artifact-inventory",
        "$expectedArtifacts",
        `duplicate expected artifact identity ${identity.artifactKind}/${identity.artifactId}`,
      );
    }
    expectedByIdentity.set(identityKey, identity.ref);
  }

  const entries = [];
  const issues = [];
  const observedRefs = new Set();
  const observedByIdentity = new Map();
  const inspectRef = (ref) => {
    observedRefs.add(ref);
    try {
      const loaded = loadDemandArtifactByRef({
        stateRoot: rootInfo.root,
        ref,
        expectedProgramId,
        expectedDemandId,
      });
      const expectedIdentity = expectedByRef.get(ref) ?? null;
      const identityKey = `${loaded.identity.artifactKind}\u0000${loaded.identity.artifactId}`;
      const priorRef = observedByIdentity.get(identityKey);
      if (priorRef && priorRef !== ref) {
        issues.push(Object.freeze({
          ref,
          classification: "conflict",
          code: "wakeflow-demand-artifact-inventory-duplicate-identity",
        }));
      } else {
        observedByIdentity.set(identityKey, ref);
      }
      if (expectedIdentity && (
        expectedIdentity.artifactKind !== loaded.identity.artifactKind
        || expectedIdentity.artifactId !== loaded.identity.artifactId
        || expectedIdentity.digest !== loaded.identity.digest
      )) {
        issues.push(Object.freeze({
          ref,
          classification: "conflict",
          code: "wakeflow-demand-artifact-inventory-conflict",
        }));
        return;
      }
      entries.push(Object.freeze({
        ...loaded.identity,
        classification: expectedIdentity ? "committed" : "orphan",
      }));
      if (!expectedIdentity) {
        issues.push(Object.freeze({
          ref,
          classification: "orphan",
          code: "wakeflow-demand-artifact-inventory-orphan",
        }));
      }
    } catch (cause) {
      issues.push(Object.freeze({
        ref,
        classification: "invalid",
        code: cause?.code ?? "wakeflow-demand-artifact-inventory-invalid",
      }));
    }
  };
  const inspectPrivateDirectoryNode = (directory, ref, {
    missingCode,
    unsafeCode,
    unreadableCode,
  }) => {
    if (!pathInside(rootInfo.root, directory)) {
      issues.push(inventoryDirectoryIssue(ref, unsafeCode));
      return null;
    }
    const relative = path.relative(rootInfo.root, directory);
    let current = rootInfo.root;
    let finalStat = null;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      let before;
      try {
        before = lstatSync(current, { bigint: true });
      } catch (cause) {
        issues.push(inventoryDirectoryIssue(ref, cause?.code === "ENOENT" ? missingCode : unreadableCode));
        return null;
      }
      if (
        before.isSymbolicLink()
        || !before.isDirectory()
        || !nodeOwnedByCurrentUser(before)
        || (process.platform !== "win32" && permissionBits(before) !== 0o700)
      ) {
        issues.push(inventoryDirectoryIssue(ref, unsafeCode));
        return null;
      }
      let currentReal;
      let after;
      try {
        currentReal = realpathSync(current);
        after = lstatSync(current, { bigint: true });
      } catch {
        issues.push(inventoryDirectoryIssue(ref, unreadableCode));
        return null;
      }
      if (
        !after.isDirectory()
        || after.isSymbolicLink()
        || !sameStableNode(before, after)
        || !pathInside(rootInfo.real, currentReal)
      ) {
        issues.push(inventoryDirectoryIssue(ref, unsafeCode));
        return null;
      }
      finalStat = after;
    }
    return finalStat;
  };
  const readPrivateDirectory = (directory, ref, codes) => {
    const before = inspectPrivateDirectoryNode(directory, ref, codes);
    if (!before) return null;
    let directoryEntries;
    try {
      directoryEntries = readdirSync(directory, { withFileTypes: true });
    } catch {
      issues.push(inventoryDirectoryIssue(ref, codes.unreadableCode));
      return null;
    }
    let after;
    let afterReal;
    try {
      after = lstatSync(directory, { bigint: true });
      afterReal = realpathSync(directory);
    } catch {
      issues.push(inventoryDirectoryIssue(ref, codes.unreadableCode));
      return null;
    }
    if (
      after.isSymbolicLink()
      || !after.isDirectory()
      || !sameStableNode(before, after)
      || !nodeOwnedByCurrentUser(after)
      || !pathInside(rootInfo.real, afterReal)
      || (process.platform !== "win32" && permissionBits(after) !== 0o700)
    ) {
      issues.push(inventoryDirectoryIssue(ref, codes.unsafeCode));
      return null;
    }
    return directoryEntries.sort((left, right) => left.name.localeCompare(right.name));
  };
  const inspectFlatRoot = (directoryName, prefix, idType) => {
    const directory = path.join(rootInfo.root, directoryName);
    const capabilityRootRef = `${directoryName}/`;
    const directoryEntries = readPrivateDirectory(directory, `${directoryName}/`, {
      missingCode: "wakeflow-demand-artifact-inventory-root-missing",
      unsafeCode: "wakeflow-demand-artifact-inventory-root-unsafe",
      unreadableCode: "wakeflow-demand-artifact-inventory-root-unreadable",
    });
    if (!directoryEntries) return;
    for (const entry of directoryEntries) {
      if (entry.name.startsWith(`.${prefix}`) && entry.name.includes(".wakeflow-stage-")) {
        const ref = `${directoryName}/${entry.name}`;
        issues.push(Object.freeze({ ref, classification: "stage-residue", code: "wakeflow-demand-artifact-inventory-stage-residue" }));
      } else if (!entry.name.startsWith(prefix) || !entry.name.endsWith(".json")) {
        issues.push(inventoryUnknownEntryIssue(capabilityRootRef, entry.name));
      } else {
        const artifactId = entry.name.slice(0, -".json".length);
        try {
          assertTypedId(artifactId, idType, "$inventory/artifactId");
        } catch {
          issues.push(inventoryUnknownEntryIssue(capabilityRootRef, entry.name));
          continue;
        }
        inspectRef(`${directoryName}/${entry.name}`);
      }
    }
  };

  inspectFlatRoot("task-packages", "task-package_", "task-package");
  inspectFlatRoot("review-candidates", "review-candidate_", "review-candidate");
  inspectFlatRoot("test-cards", "test-card_", "test-card");

  const podCapabilityRoot = path.join(rootInfo.root, "pod");
  let hasPodCapabilityNode = false;
  try {
    hasPodCapabilityNode = lstatSync(podCapabilityRoot, { bigint: true }) !== null;
  } catch (cause) {
    hasPodCapabilityNode = cause?.code !== "ENOENT";
  }
  const expectsPodDesign = expected.some((entry) => (
    entry.artifactKind === "wakeflow-pod-design-request"
    || entry.artifactKind === "wakeflow-pod-design-handoff"
  ));
  if (hasPodCapabilityNode || expectsPodDesign) {
    const podRoot = inspectPrivateDirectoryNode(podCapabilityRoot, "pod/", {
      missingCode: "wakeflow-demand-artifact-inventory-root-missing",
      unsafeCode: "wakeflow-demand-artifact-inventory-root-unsafe",
      unreadableCode: "wakeflow-demand-artifact-inventory-root-unreadable",
    });
    if (podRoot) {
      inspectFlatRoot("pod/design-requests", "pod-design-request_", "pod-design-request");
      inspectFlatRoot("pod/design-handoffs", "pod-design-handoff_", "pod-design-handoff");
    }
  }

  const resultsRoot = path.join(rootInfo.root, "target-results");
  const resultTaskEntries = readPrivateDirectory(resultsRoot, "target-results/", {
    missingCode: "wakeflow-demand-artifact-inventory-root-missing",
    unsafeCode: "wakeflow-demand-artifact-inventory-root-unsafe",
    unreadableCode: "wakeflow-demand-artifact-inventory-root-unreadable",
  });
  if (resultTaskEntries) {
      for (const taskEntry of resultTaskEntries) {
        const taskRef = `target-results/${taskEntry.name}`;
        try {
          assertTypedId(taskEntry.name, "target-task", "$inventory/targetTaskId");
        } catch {
          issues.push(inventoryUnknownEntryIssue("target-results/", taskEntry.name));
          continue;
        }
        const taskDirectory = path.join(resultsRoot, taskEntry.name);
        const resultEntries = readPrivateDirectory(taskDirectory, `${taskRef}/`, {
          missingCode: "wakeflow-demand-artifact-inventory-target-root-unreadable",
          unsafeCode: "wakeflow-demand-artifact-inventory-target-root-unsafe",
          unreadableCode: "wakeflow-demand-artifact-inventory-target-root-unreadable",
        });
        if (!resultEntries) continue;
        if (resultEntries.length === 0) {
          issues.push(Object.freeze({
            ref: `${taskRef}/`,
            classification: "orphan",
            code: "wakeflow-demand-artifact-inventory-empty-target-root",
          }));
        }
        for (const resultEntry of resultEntries) {
          const ref = `${taskRef}/${resultEntry.name}`;
          if (resultEntry.name.startsWith(".target-result_") && resultEntry.name.includes(".wakeflow-stage-")) {
            issues.push(Object.freeze({ ref, classification: "stage-residue", code: "wakeflow-demand-artifact-inventory-stage-residue" }));
          } else if (!resultEntry.name.startsWith("target-result_") || !resultEntry.name.endsWith(".json")) {
            issues.push(inventoryUnknownEntryIssue(`${taskRef}/`, resultEntry.name));
          } else {
            const targetResultId = resultEntry.name.slice(0, -".json".length);
            try {
              assertTypedId(targetResultId, "target-result", "$inventory/targetResultId");
            } catch {
              issues.push(inventoryUnknownEntryIssue(`${taskRef}/`, resultEntry.name));
              continue;
            }
            inspectRef(ref);
          }
        }
      }
  }

  for (const identity of expected) {
    if (!observedRefs.has(identity.ref)) {
      issues.push(Object.freeze({
        ref: identity.ref,
        classification: "missing",
        code: "wakeflow-demand-artifact-inventory-missing",
      }));
    }
  }
  entries.sort((left, right) => left.ref.localeCompare(right.ref));
  issues.sort((left, right) => left.ref.localeCompare(right.ref) || left.code.localeCompare(right.code));
  return deepFreeze({
    status: issues.length === 0 ? "healthy" : "degraded",
    entries,
    issues,
  });
}
