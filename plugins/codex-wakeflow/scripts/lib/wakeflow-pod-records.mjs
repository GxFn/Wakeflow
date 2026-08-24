import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { assertWindowBindingId } from "./wakeflow-window-binding-records.mjs";

/**
 * Pod portable evidence codec 的职责地图：
 * - scope、launch、materialization、creation 与 resume 固化窗口物化链的不可变事实；
 * - Test access 的 plan/receipt 固化多根直连探测的输入与结果，不代替宿主身份或业务验收；
 * - close intent/receipt 固化关闭授权与机器观察，不执行宿主关闭或binding清理；
 * - 本文件只负责闭合字段、交叉约束、canonical digest和portable ref，不读取workspace或推进demand state。
 */

// 九类kind是Pod证据树的portable taxonomy；producer与生命周期准入仍归Pod service。
export const WAKEFLOW_POD_SCHEMA_VERSION = 1;
export const WAKEFLOW_POD_SCOPE_KIND = "WakeflowPodEvidenceScope";
export const WAKEFLOW_POD_LAUNCH_INTENT_KIND = "WakeflowPodLaunchIntent";
export const WAKEFLOW_POD_MATERIALIZATION_EVENT_KIND = "WakeflowPodMaterializationEvent";
export const WAKEFLOW_POD_CREATION_RECEIPT_KIND = "WakeflowPodCreationReceipt";
export const WAKEFLOW_POD_RESUME_OBSERVATION_KIND = "WakeflowPodResumeObservation";
export const WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND = "WakeflowPodTestAccessPlan";
export const WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND = "WakeflowPodTestAccessReceipt";
export const WAKEFLOW_POD_CLOSE_INTENT_KIND = "WakeflowPodCloseIntent";
export const WAKEFLOW_POD_CLOSE_RECEIPT_KIND = "WakeflowPodCloseReceipt";

export const WAKEFLOW_POD_RECORD_KINDS = Object.freeze([
  WAKEFLOW_POD_SCOPE_KIND,
  WAKEFLOW_POD_LAUNCH_INTENT_KIND,
  WAKEFLOW_POD_MATERIALIZATION_EVENT_KIND,
  WAKEFLOW_POD_CREATION_RECEIPT_KIND,
  WAKEFLOW_POD_RESUME_OBSERVATION_KIND,
  WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND,
  WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND,
  WAKEFLOW_POD_CLOSE_INTENT_KIND,
  WAKEFLOW_POD_CLOSE_RECEIPT_KIND,
]);

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,9})?Z$/u;
const HOST_ID_RE = /^[a-z][a-z0-9-]{0,63}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const GIT_OBJECT_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const BOUNDED_CODE_RE = /^[a-z][a-z0-9-]{0,63}$/u;
const HOST_RESOURCE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const DOMAIN_ID_PATTERNS = Object.freeze({
  launchOperationId: new RegExp(`^pod-launch_${UUID_V4}$`, "u"),
  materializationAttemptId: new RegExp(`^pod-materialization-attempt_${UUID_V4}$`, "u"),
  materializationEventId: new RegExp(`^pod-materialization-event_${UUID_V4}$`, "u"),
  resumeObservationId: new RegExp(`^pod-resume-observation_${UUID_V4}$`, "u"),
  testAccessProbeId: new RegExp(`^pod-test-probe_${UUID_V4}$`, "u"),
  closeOperationId: new RegExp(`^pod-close_${UUID_V4}$`, "u"),
});
const ROLES = new Set(["controller", "design", "test", "product"]);
const MATERIALIZATION_STATUSES = new Set(["creating", "pending", "finalized", "failed"]);
const TEST_BLOCK_REASONS = new Set([
  "capability-unsupported",
  "git-identity-mismatch",
  "observer-identity-mismatch",
  "probe-execution-failed",
  "root-unreadable",
]);
const SESSION_STATUSES = new Set(["closed", "not-found"]);
const WORKTREE_STATUSES = new Set(["not-applicable", "removed", "retained", "unknown"]);
const CLOSE_VERIFICATION_STATUSES = new Set(["machine-verified", "unmaterialized-not-found"]);

export class WakeflowPodRecordError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowPodRecordError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, errorPath, message, details = {}, cause = undefined) {
  throw new WakeflowPodRecordError(code, message, {
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

function frozenClone(value) {
  return deepFreeze(structuredClone(value));
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, errorPath) {
  if (!plainObject(value)) {
    fail("wakeflow-pod-record-shape", errorPath, "Pod record value must be one plain data object");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      fail("wakeflow-pod-record-shape", errorPath, "Pod record cannot contain symbol keys");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-pod-record-shape", `${errorPath}/${key}`, "Pod record fields must be enumerable data properties");
    }
  }
}

function assertExactKeys(value, required, optional, errorPath) {
  assertPlainObject(value, errorPath);
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unknown = keys.filter((key) => !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      "wakeflow-pod-record-fields",
      errorPath,
      "Pod record has the wrong closed field set",
      { missing, unknown },
    );
  }
}

function assertDenseDataArray(value, errorPath, { minimum = 0 } = {}) {
  if (!Array.isArray(value) || value.length < minimum) {
    fail("wakeflow-pod-record-shape", errorPath, `Pod record requires an array with at least ${minimum} entries`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string") {
      fail("wakeflow-pod-record-shape", errorPath, "Pod record array cannot contain symbol keys");
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      fail("wakeflow-pod-record-shape", `${errorPath}/${key}`, "Pod record array cannot contain additional properties");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-pod-record-shape", `${errorPath}/${key}`, "Pod record array slots must be enumerable data properties");
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail("wakeflow-pod-record-shape", `${errorPath}/${index}`, "Pod record array cannot contain sparse slots");
    }
  }
  return value;
}

function assertBase(value, kind, required, optional = []) {
  assertExactKeys(value, ["kind", "schemaVersion", ...required], optional, "$" );
  if (value.kind !== kind || value.schemaVersion !== WAKEFLOW_POD_SCHEMA_VERSION) {
    fail("wakeflow-pod-record-kind", "$", `Pod record must be ${kind} schema version 1`);
  }
}

function assertTypedId(value, type, errorPath) {
  try {
    return assertWakeflowId(value, type, errorPath);
  } catch (cause) {
    fail("wakeflow-pod-record-id", errorPath, `Pod record requires one typed ${type} ID`, {}, cause);
  }
}

function assertDomainId(value, domain, errorPath) {
  if (typeof value !== "string" || !DOMAIN_ID_PATTERNS[domain]?.test(value)) {
    fail("wakeflow-pod-record-id", errorPath, `Pod record requires one typed ${domain} ID`);
  }
  return value;
}

function assertBindingId(value, errorPath) {
  try {
    return assertWindowBindingId(value, errorPath);
  } catch (cause) {
    fail("wakeflow-pod-record-binding-id", errorPath, "Pod record requires one typed window binding ID", {}, cause);
  }
}

function assertHostId(value, errorPath) {
  if (typeof value !== "string" || !HOST_ID_RE.test(value)) {
    fail("wakeflow-pod-record-host", errorPath, "hostId must be one stable lowercase host capability ID");
  }
  return value;
}

function assertDigest(value, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-pod-record-digest", errorPath, "Pod record digest must be sha256:<64 lowercase hex>");
  }
  return value;
}

function assertTimestamp(value, errorPath) {
  if (typeof value !== "string" || !TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) {
    fail("wakeflow-pod-record-timestamp", errorPath, "Pod record timestamp must be one valid UTC timestamp");
  }
  return value;
}

function assertCode(value, errorPath, allowed = null) {
  if (
    typeof value !== "string"
    || !BOUNDED_CODE_RE.test(value)
    || (allowed !== null && !allowed.has(value))
  ) {
    fail("wakeflow-pod-record-code", errorPath, "Pod record code is outside its closed bounded vocabulary");
  }
  return value;
}

function assertRole(value, errorPath) {
  if (!ROLES.has(value)) {
    fail("wakeflow-pod-record-role", errorPath, "Pod member role is unsupported");
  }
  return value;
}

function assertBoolean(value, errorPath) {
  if (typeof value !== "boolean") {
    fail("wakeflow-pod-record-boolean", errorPath, "Pod record field must be boolean");
  }
  return value;
}

function assertInteger(value, errorPath, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("wakeflow-pod-record-integer", errorPath, `Pod record integer must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function assertGitObject(value, errorPath) {
  if (typeof value !== "string" || !GIT_OBJECT_RE.test(value)) {
    fail("wakeflow-pod-record-git-object", errorPath, "Git object ID must be 40 or 64 lowercase hex characters");
  }
  return value;
}

function assertBranch(value, errorPath) {
  if (value === null) return value;
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > 512
    || CONTROL_RE.test(value)
  ) {
    fail("wakeflow-pod-record-branch", errorPath, "Git branch must be null or one bounded control-free string");
  }
  return value;
}

function assertAbsolutePath(value, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || CONTROL_RE.test(value)
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
  ) {
    fail("wakeflow-pod-record-path", errorPath, "Pod resource path must be one normalized absolute host-local path");
  }
  return value;
}

function assertIdentity(value, { demand = true, window = false } = {}) {
  assertTypedId(value.programId, "program", "$/programId");
  assertHostId(value.hostId, "$/hostId");
  assertTypedId(value.podId, "pod", "$/podId");
  if (demand) assertTypedId(value.demandId, "demand", "$/demandId");
  if (window) assertTypedId(value.windowId, "window", "$/windowId");
}

function assertCanonicalOrder(values, keyOf, errorPath) {
  const keys = values.map(keyOf);
  if (new Set(keys).size !== keys.length) {
    fail("wakeflow-pod-record-order", errorPath, "Pod record collection identities must be unique");
  }
  const sorted = [...keys].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (keys.some((key, index) => key !== sorted[index])) {
    fail("wakeflow-pod-record-order", errorPath, "Pod record collection must use canonical lexical order");
  }
}

function validatePodScope(value) {
  assertBase(value, WAKEFLOW_POD_SCOPE_KIND, [
    "programId",
    "hostId",
    "podId",
    "demandId",
    "placementAuthorizationDigest",
    "createdAt",
  ]);
  assertIdentity(value);
  assertDigest(value.placementAuthorizationDigest, "$/placementAuthorizationDigest");
  assertTimestamp(value.createdAt, "$/createdAt");
  return frozenClone(value);
}

function validateLaunchIntent(value) {
  assertBase(value, WAKEFLOW_POD_LAUNCH_INTENT_KIND, [
    "programId",
    "hostId",
    "podId",
    "demandId",
    "windowId",
    "launchOperationId",
    "bindingId",
    "role",
    "environmentIntent",
    "createdAt",
  ], [
    "repositoryId",
    "responsibilityWindowId",
    "repositorySourceDigest",
    "basePolicy",
    "expectedBaseHead",
    "hostResourceKey",
  ]);
  assertIdentity(value, { window: true });
  assertDomainId(value.launchOperationId, "launchOperationId", "$/launchOperationId");
  assertBindingId(value.bindingId, "$/bindingId");
  const role = assertRole(value.role, "$/role");
  const productFields = ["repositoryId", "repositorySourceDigest", "basePolicy", "expectedBaseHead"];
  if (role === "product") {
    for (const field of productFields) {
      if (!Object.hasOwn(value, field)) {
        fail("wakeflow-pod-record-launch-product", `$/${field}`, `product launch intent requires ${field}`);
      }
    }
    assertTypedId(value.repositoryId, "repository", "$/repositoryId");
    if (Object.hasOwn(value, "responsibilityWindowId")) {
      assertTypedId(value.responsibilityWindowId, "window", "$/responsibilityWindowId");
    }
    assertDigest(value.repositorySourceDigest, "$/repositorySourceDigest");
    if (value.basePolicy !== "local-head") {
      fail("wakeflow-pod-record-launch-product", "$/basePolicy", "product basePolicy must be local-head");
    }
    assertGitObject(value.expectedBaseHead, "$/expectedBaseHead");
    if (value.environmentIntent !== "host-worktree") {
      fail("wakeflow-pod-record-launch-product", "$/environmentIntent", "product environmentIntent must be host-worktree");
    }
  } else {
    if ([...productFields, "responsibilityWindowId"].some((field) => Object.hasOwn(value, field))) {
      fail("wakeflow-pod-record-launch-control", "$", "control launch intent cannot contain product repository fields");
    }
    if (value.environmentIntent !== "host-local") {
      fail("wakeflow-pod-record-launch-control", "$/environmentIntent", "control environmentIntent must be host-local");
    }
  }
  if (
    Object.hasOwn(value, "hostResourceKey")
    && (typeof value.hostResourceKey !== "string" || !HOST_RESOURCE_KEY_RE.test(value.hostResourceKey))
  ) {
    fail("wakeflow-pod-record-host-resource", "$/hostResourceKey", "hostResourceKey must use the bounded stable key contract");
  }
  assertTimestamp(value.createdAt, "$/createdAt");
  return frozenClone(value);
}

function validateMaterializationEvent(value) {
  assertBase(value, WAKEFLOW_POD_MATERIALIZATION_EVENT_KIND, [
    "programId",
    "hostId",
    "podId",
    "windowId",
    "launchOperationId",
    "attemptId",
    "eventId",
    "previousEventDigest",
    "status",
    "observedAt",
  ], [
    "hostRequestIdDigest",
    "failureCode",
    "failureDetailDigest",
    "retryAuthorizationDigest",
  ]);
  assertIdentity(value, { demand: false, window: true });
  assertDomainId(value.launchOperationId, "launchOperationId", "$/launchOperationId");
  assertDomainId(value.attemptId, "materializationAttemptId", "$/attemptId");
  assertDomainId(value.eventId, "materializationEventId", "$/eventId");
  if (value.previousEventDigest !== null) assertDigest(value.previousEventDigest, "$/previousEventDigest");
  if (!MATERIALIZATION_STATUSES.has(value.status)) {
    fail("wakeflow-pod-record-materialization-status", "$/status", "materialization status is unsupported");
  }
  const hasRequest = Object.hasOwn(value, "hostRequestIdDigest");
  const hasFailureCode = Object.hasOwn(value, "failureCode");
  const hasFailureDetail = Object.hasOwn(value, "failureDetailDigest");
  const hasRetry = Object.hasOwn(value, "retryAuthorizationDigest");
  if (value.status === "pending") {
    if (!hasRequest || hasFailureCode || hasFailureDetail || hasRetry) {
      fail("wakeflow-pod-record-materialization-fields", "$", "pending materialization requires only hostRequestIdDigest");
    }
    assertDigest(value.hostRequestIdDigest, "$/hostRequestIdDigest");
  } else if (value.status === "failed") {
    if (hasRequest || !hasFailureCode || hasRetry) {
      fail("wakeflow-pod-record-materialization-fields", "$", "failed materialization requires failureCode and optional failureDetailDigest");
    }
    assertCode(value.failureCode, "$/failureCode");
    if (hasFailureDetail) assertDigest(value.failureDetailDigest, "$/failureDetailDigest");
  } else if (value.status === "creating") {
    if (hasRequest || hasFailureCode || hasFailureDetail) {
      fail("wakeflow-pod-record-materialization-fields", "$", "creating materialization cannot carry request or failure fields");
    }
    if (hasRetry) assertDigest(value.retryAuthorizationDigest, "$/retryAuthorizationDigest");
  } else if (hasRequest || hasFailureCode || hasFailureDetail || hasRetry) {
    fail("wakeflow-pod-record-materialization-fields", "$", "finalized materialization cannot carry request, failure, or retry fields");
  }
  assertTimestamp(value.observedAt, "$/observedAt");
  return frozenClone(value);
}

function validateResource(value, errorPath) {
  assertPlainObject(value, errorPath);
  if (value.kind === "program-root") {
    assertExactKeys(value, ["kind", "actualCwd"], [], errorPath);
    assertAbsolutePath(value.actualCwd, `${errorPath}/actualCwd`);
    return value;
  }
  if (value.kind === "git-worktree") {
    assertExactKeys(value, [
      "kind",
      "actualCwd",
      "gitTopLevel",
      "gitCommonDir",
      "head",
      "branch",
      "detached",
      "mainCheckout",
    ], [], errorPath);
    assertAbsolutePath(value.actualCwd, `${errorPath}/actualCwd`);
    assertAbsolutePath(value.gitTopLevel, `${errorPath}/gitTopLevel`);
    assertAbsolutePath(value.gitCommonDir, `${errorPath}/gitCommonDir`);
    if (value.gitTopLevel !== value.actualCwd) {
      fail("wakeflow-pod-record-resource", `${errorPath}/gitTopLevel`, "git worktree top-level must equal actualCwd");
    }
    assertGitObject(value.head, `${errorPath}/head`);
    assertBranch(value.branch, `${errorPath}/branch`);
    assertBoolean(value.detached, `${errorPath}/detached`);
    if (value.mainCheckout !== false) {
      fail("wakeflow-pod-record-resource", `${errorPath}/mainCheckout`, "Pod product resource cannot be the main checkout");
    }
    return value;
  }
  fail("wakeflow-pod-record-resource", `${errorPath}/kind`, "Pod creation resource kind is unsupported");
}

function validateCreationReceipt(value) {
  assertBase(value, WAKEFLOW_POD_CREATION_RECEIPT_KIND, [
    "programId",
    "hostId",
    "podId",
    "demandId",
    "windowId",
    "launchOperationId",
    "bindingId",
    "launchIntentDigest",
    "materializationFinalEventDigest",
    "identityBindingDigest",
    "resource",
    "verifiedAt",
  ], ["hostCreatedAt"]);
  assertIdentity(value, { window: true });
  assertDomainId(value.launchOperationId, "launchOperationId", "$/launchOperationId");
  assertBindingId(value.bindingId, "$/bindingId");
  assertDigest(value.launchIntentDigest, "$/launchIntentDigest");
  assertDigest(value.materializationFinalEventDigest, "$/materializationFinalEventDigest");
  assertDigest(value.identityBindingDigest, "$/identityBindingDigest");
  validateResource(value.resource, "$/resource");
  if (Object.hasOwn(value, "hostCreatedAt")) assertTimestamp(value.hostCreatedAt, "$/hostCreatedAt");
  assertTimestamp(value.verifiedAt, "$/verifiedAt");
  return frozenClone(value);
}

function validateResumeObservation(value) {
  assertBase(value, WAKEFLOW_POD_RESUME_OBSERVATION_KIND, [
    "programId",
    "hostId",
    "podId",
    "demandId",
    "windowId",
    "observationId",
    "bindingId",
    "creationReceiptDigest",
    "identityBindingDigest",
    "liveness",
    "cwdMatch",
    "observedAt",
  ], ["currentHead", "branch", "detached", "dirty"]);
  assertIdentity(value, { window: true });
  assertDomainId(value.observationId, "resumeObservationId", "$/observationId");
  assertBindingId(value.bindingId, "$/bindingId");
  assertDigest(value.creationReceiptDigest, "$/creationReceiptDigest");
  assertDigest(value.identityBindingDigest, "$/identityBindingDigest");
  if (!["ambiguous", "live", "unavailable"].includes(value.liveness)) {
    fail("wakeflow-pod-record-resume", "$/liveness", "resume liveness observation is unsupported");
  }
  assertBoolean(value.cwdMatch, "$/cwdMatch");
  const gitFields = ["currentHead", "branch", "detached", "dirty"];
  if (value.liveness !== "live" && gitFields.some((field) => Object.hasOwn(value, field))) {
    fail("wakeflow-pod-record-resume", "$", "non-live observation cannot claim Git state");
  }
  if (Object.hasOwn(value, "currentHead")) assertGitObject(value.currentHead, "$/currentHead");
  if (Object.hasOwn(value, "branch")) assertBranch(value.branch, "$/branch");
  if (Object.hasOwn(value, "detached")) assertBoolean(value.detached, "$/detached");
  if (Object.hasOwn(value, "dirty")) assertBoolean(value.dirty, "$/dirty");
  assertTimestamp(value.observedAt, "$/observedAt");
  return frozenClone(value);
}

function validateTestObserver(value, errorPath) {
  assertExactKeys(value, [
    "windowId",
    "bindingId",
    "identityBindingDigest",
    "creationReceiptDigest",
  ], [], errorPath);
  assertTypedId(value.windowId, "window", `${errorPath}/windowId`);
  assertBindingId(value.bindingId, `${errorPath}/bindingId`);
  assertDigest(value.identityBindingDigest, `${errorPath}/identityBindingDigest`);
  assertDigest(value.creationReceiptDigest, `${errorPath}/creationReceiptDigest`);
  return value;
}

function validateTestTarget(value, errorPath) {
  assertExactKeys(value, [
    "windowId",
    "repositoryId",
    "bindingId",
    "identityBindingDigest",
    "creationReceiptDigest",
    "actualRoot",
    "expectedRootDigest",
    "expectedGitTopLevelDigest",
    "expectedGitCommonDirDigest",
  ], [], errorPath);
  assertTypedId(value.windowId, "window", `${errorPath}/windowId`);
  assertTypedId(value.repositoryId, "repository", `${errorPath}/repositoryId`);
  assertBindingId(value.bindingId, `${errorPath}/bindingId`);
  assertDigest(value.identityBindingDigest, `${errorPath}/identityBindingDigest`);
  assertDigest(value.creationReceiptDigest, `${errorPath}/creationReceiptDigest`);
  assertAbsolutePath(value.actualRoot, `${errorPath}/actualRoot`);
  assertDigest(value.expectedRootDigest, `${errorPath}/expectedRootDigest`);
  assertDigest(value.expectedGitTopLevelDigest, `${errorPath}/expectedGitTopLevelDigest`);
  assertDigest(value.expectedGitCommonDirDigest, `${errorPath}/expectedGitCommonDirDigest`);
  return value;
}

function bindingSetProjection(value) {
  return {
    observer: {
      windowId: value.observer.windowId,
      bindingId: value.observer.bindingId,
      identityBindingDigest: value.observer.identityBindingDigest,
      creationReceiptDigest: value.observer.creationReceiptDigest,
    },
    targets: value.targets.map((target) => ({
      windowId: target.windowId,
      repositoryId: target.repositoryId,
      bindingId: target.bindingId,
      identityBindingDigest: target.identityBindingDigest,
      creationReceiptDigest: target.creationReceiptDigest,
    })),
  };
}

// 只摘要Test观察者与目标binding闭包，供plan/receipt交叉比对；digest本身不证明访问成功。
export function podTestAccessBindingSetDigest(value) {
  assertPlainObject(value, "$input");
  validateTestObserver(value.observer, "$input/observer");
  assertDenseDataArray(value.targets, "$input/targets", { minimum: 1 });
  value.targets.forEach((target, index) => validateTestTarget(target, `$input/targets/${index}`));
  assertCanonicalOrder(
    value.targets,
    (target) => `${target.repositoryId}\u0000${target.windowId}`,
    "$input/targets",
  );
  return canonicalJsonDigest(bindingSetProjection(value));
}

function validateTestAccessPlan(value) {
  assertBase(value, WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND, [
    "programId",
    "hostId",
    "podId",
    "demandId",
    "probeId",
    "attempt",
    "probeType",
    "bindingSetDigest",
    "observer",
    "targets",
    "createdAt",
  ], ["previousProbeId"]);
  assertIdentity(value);
  assertDomainId(value.probeId, "testAccessProbeId", "$/probeId");
  const attempt = assertInteger(value.attempt, "$/attempt", { minimum: 1, maximum: 32 });
  const hasPrevious = Object.hasOwn(value, "previousProbeId");
  if ((attempt > 1) !== hasPrevious) {
    fail("wakeflow-pod-record-test-attempt", "$", "retry attempt and previousProbeId must appear together");
  }
  if (hasPrevious) {
    assertDomainId(value.previousProbeId, "testAccessProbeId", "$/previousProbeId");
    if (value.previousProbeId === value.probeId) {
      fail("wakeflow-pod-record-test-attempt", "$/previousProbeId", "Test access retry cannot reference itself");
    }
  }
  if (value.probeType !== "direct-multi-root") {
    fail("wakeflow-pod-record-test-probe", "$/probeType", "Test access probeType must be direct-multi-root");
  }
  validateTestObserver(value.observer, "$/observer");
  assertDenseDataArray(value.targets, "$/targets", { minimum: 1 });
  value.targets.forEach((target, index) => validateTestTarget(target, `$/targets/${index}`));
  assertCanonicalOrder(
    value.targets,
    (target) => `${target.repositoryId}\u0000${target.windowId}`,
    "$/targets",
  );
  assertDigest(value.bindingSetDigest, "$/bindingSetDigest");
  const expectedBindingSetDigest = canonicalJsonDigest(bindingSetProjection(value));
  if (value.bindingSetDigest !== expectedBindingSetDigest) {
    fail(
      "wakeflow-pod-record-test-binding-set",
      "$/bindingSetDigest",
      "Test access bindingSetDigest must match the canonical stable binding set",
      { expectedBindingSetDigest },
    );
  }
  assertTimestamp(value.createdAt, "$/createdAt");
  return frozenClone(value);
}

function validateTargetObservation(value, errorPath) {
  assertExactKeys(value, [
    "windowId",
    "repositoryId",
    "bindingId",
    "creationReceiptDigest",
    "accessResult",
  ], [
    "observedRootDigest",
    "observedGitTopLevelDigest",
    "observedGitCommonDirDigest",
    "currentHead",
  ], errorPath);
  assertTypedId(value.windowId, "window", `${errorPath}/windowId`);
  assertTypedId(value.repositoryId, "repository", `${errorPath}/repositoryId`);
  assertBindingId(value.bindingId, `${errorPath}/bindingId`);
  assertDigest(value.creationReceiptDigest, `${errorPath}/creationReceiptDigest`);
  const observationFields = [
    "observedRootDigest",
    "observedGitTopLevelDigest",
    "observedGitCommonDirDigest",
    "currentHead",
  ];
  if (value.accessResult === "readable") {
    if (observationFields.some((field) => !Object.hasOwn(value, field))) {
      fail("wakeflow-pod-record-test-observation", errorPath, "readable target requires all redacted Git observations");
    }
    assertDigest(value.observedRootDigest, `${errorPath}/observedRootDigest`);
    assertDigest(value.observedGitTopLevelDigest, `${errorPath}/observedGitTopLevelDigest`);
    assertDigest(value.observedGitCommonDirDigest, `${errorPath}/observedGitCommonDirDigest`);
    assertGitObject(value.currentHead, `${errorPath}/currentHead`);
  } else if (value.accessResult === "unreadable") {
    if (observationFields.some((field) => Object.hasOwn(value, field))) {
      fail("wakeflow-pod-record-test-observation", errorPath, "unreadable target cannot fabricate Git observations");
    }
  } else {
    fail("wakeflow-pod-record-test-observation", `${errorPath}/accessResult`, "target accessResult is unsupported");
  }
  return value;
}

function validateTestAccessReceipt(value) {
  assertBase(value, WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND, [
    "programId",
    "hostId",
    "podId",
    "demandId",
    "probeId",
    "planDigest",
    "bindingSetDigest",
    "observerBindingId",
    "observerIdentityBindingDigest",
    "status",
    "capability",
    "targetObservations",
    "observedAt",
    "recordedAt",
  ], ["reasonCode"]);
  assertIdentity(value);
  assertDomainId(value.probeId, "testAccessProbeId", "$/probeId");
  assertDigest(value.planDigest, "$/planDigest");
  assertDigest(value.bindingSetDigest, "$/bindingSetDigest");
  assertBindingId(value.observerBindingId, "$/observerBindingId");
  assertDigest(value.observerIdentityBindingDigest, "$/observerIdentityBindingDigest");
  if (value.capability !== "direct-multi-root") {
    fail("wakeflow-pod-record-test-capability", "$/capability", "Test access receipt capability must be direct-multi-root");
  }
  assertDenseDataArray(value.targetObservations, "$/targetObservations");
  value.targetObservations.forEach((entry, index) => validateTargetObservation(
    entry,
    `$/targetObservations/${index}`,
  ));
  assertCanonicalOrder(
    value.targetObservations,
    (target) => `${target.repositoryId}\u0000${target.windowId}`,
    "$/targetObservations",
  );
  const hasReason = Object.hasOwn(value, "reasonCode");
  if (value.status === "validated") {
    if (
      hasReason
      || value.targetObservations.length === 0
      || value.targetObservations.some((entry) => entry.accessResult !== "readable")
    ) {
      fail("wakeflow-pod-record-test-status", "$", "validated receipt requires every target readable and no reasonCode");
    }
  } else if (value.status === "blocked") {
    if (!hasReason) {
      fail("wakeflow-pod-record-test-status", "$/reasonCode", "blocked receipt requires one bounded reasonCode");
    }
    assertCode(value.reasonCode, "$/reasonCode", TEST_BLOCK_REASONS);
  } else {
    fail("wakeflow-pod-record-test-status", "$/status", "Test receipt status is unsupported");
  }
  assertTimestamp(value.observedAt, "$/observedAt");
  assertTimestamp(value.recordedAt, "$/recordedAt");
  if (Date.parse(value.recordedAt) < Date.parse(value.observedAt)) {
    fail("wakeflow-pod-record-test-time", "$/recordedAt", "Test receipt cannot be recorded before its observation");
  }
  return frozenClone(value);
}

function validateCloseIntent(value) {
  assertBase(value, WAKEFLOW_POD_CLOSE_INTENT_KIND, [
    "programId",
    "hostId",
    "podId",
    "demandId",
    "windowId",
    "launchOperationId",
    "bindingId",
    "closeOperationId",
    "role",
    "sessionIntent",
    "worktreeReportingPolicy",
    "createdAt",
  ], ["creationReceiptDigest"]);
  assertIdentity(value, { window: true });
  assertDomainId(value.launchOperationId, "launchOperationId", "$/launchOperationId");
  assertBindingId(value.bindingId, "$/bindingId");
  assertDomainId(value.closeOperationId, "closeOperationId", "$/closeOperationId");
  assertRole(value.role, "$/role");
  if (Object.hasOwn(value, "creationReceiptDigest")) {
    assertDigest(value.creationReceiptDigest, "$/creationReceiptDigest");
  }
  if (value.sessionIntent !== "close") {
    fail("wakeflow-pod-record-close-intent", "$/sessionIntent", "Pod close sessionIntent must be close");
  }
  if (value.worktreeReportingPolicy !== "observe-only") {
    fail("wakeflow-pod-record-close-intent", "$/worktreeReportingPolicy", "Wakeflow close can only observe host-owned worktree disposition");
  }
  assertTimestamp(value.createdAt, "$/createdAt");
  return frozenClone(value);
}

function validateCloseReceipt(value) {
  assertBase(value, WAKEFLOW_POD_CLOSE_RECEIPT_KIND, [
    "programId",
    "hostId",
    "podId",
    "demandId",
    "windowId",
    "closeOperationId",
    "bindingId",
    "closeIntentDigest",
    "verificationStatus",
    "sessionStatus",
    "worktreeStatus",
    "confirmedAt",
    "recordedAt",
  ], ["hostResultDigest"]);
  assertIdentity(value, { window: true });
  assertDomainId(value.closeOperationId, "closeOperationId", "$/closeOperationId");
  assertBindingId(value.bindingId, "$/bindingId");
  assertDigest(value.closeIntentDigest, "$/closeIntentDigest");
  if (!CLOSE_VERIFICATION_STATUSES.has(value.verificationStatus)) {
    fail(
      "wakeflow-pod-record-close-verification",
      "$/verificationStatus",
      "close receipt verificationStatus is unsupported",
    );
  }
  if (!SESSION_STATUSES.has(value.sessionStatus)) {
    fail("wakeflow-pod-record-close-status", "$/sessionStatus", "sessionStatus is unsupported");
  }
  if (!WORKTREE_STATUSES.has(value.worktreeStatus)) {
    fail("wakeflow-pod-record-close-status", "$/worktreeStatus", "worktreeStatus is unsupported");
  }
  if (value.verificationStatus === "machine-verified") {
    if (
      value.hostId !== "claude-code"
      || value.sessionStatus !== "closed"
      || !Object.hasOwn(value, "hostResultDigest")
    ) {
      fail(
        "wakeflow-pod-record-close-verification",
        "$",
        "machine-verified close receipt requires Claude exact close, closed session status, and its host result digest",
      );
    }
    assertDigest(value.hostResultDigest, "$/hostResultDigest");
  } else if (
    value.sessionStatus !== "not-found"
    || value.worktreeStatus !== "not-applicable"
    || Object.hasOwn(value, "hostResultDigest")
  ) {
    fail(
      "wakeflow-pod-record-close-verification",
      "$",
      "unmaterialized close receipt must remain an exact not-found observation without a host result",
    );
  }
  assertTimestamp(value.confirmedAt, "$/confirmedAt");
  assertTimestamp(value.recordedAt, "$/recordedAt");
  if (Date.parse(value.recordedAt) < Date.parse(value.confirmedAt)) {
    fail("wakeflow-pod-record-close-time", "$/recordedAt", "Pod close receipt cannot be recorded before host confirmation");
  }
  return frozenClone(value);
}

// 按kind派发到唯一闭合codec，并返回与调用方隔离的冻结数据。
export function validatePodRecord(value) {
  assertPlainObject(value, "$" );
  switch (value.kind) {
    case WAKEFLOW_POD_SCOPE_KIND: return validatePodScope(value);
    case WAKEFLOW_POD_LAUNCH_INTENT_KIND: return validateLaunchIntent(value);
    case WAKEFLOW_POD_MATERIALIZATION_EVENT_KIND: return validateMaterializationEvent(value);
    case WAKEFLOW_POD_CREATION_RECEIPT_KIND: return validateCreationReceipt(value);
    case WAKEFLOW_POD_RESUME_OBSERVATION_KIND: return validateResumeObservation(value);
    case WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND: return validateTestAccessPlan(value);
    case WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND: return validateTestAccessReceipt(value);
    case WAKEFLOW_POD_CLOSE_INTENT_KIND: return validateCloseIntent(value);
    case WAKEFLOW_POD_CLOSE_RECEIPT_KIND: return validateCloseReceipt(value);
    default:
      fail("wakeflow-pod-record-kind", "$/kind", `unsupported Pod record kind ${String(value.kind)}`);
  }
}

// 具名creator让各producer明确声明要写入的证据种类，同时复用同一闭合校验。
export function createPodScopeRecord(value = {}) {
  return validatePodScope(value);
}

export function createPodLaunchIntentRecord(value = {}) {
  return validateLaunchIntent(value);
}

export function createPodMaterializationEventRecord(value = {}) {
  return validateMaterializationEvent(value);
}

export function createPodCreationReceiptRecord(value = {}) {
  return validateCreationReceipt(value);
}

export function createPodResumeObservationRecord(value = {}) {
  return validateResumeObservation(value);
}

export function createPodTestAccessPlanRecord(value = {}) {
  return validateTestAccessPlan(value);
}

export function createPodTestAccessReceiptRecord(value = {}) {
  return validateTestAccessReceipt(value);
}

export function createPodCloseIntentRecord(value = {}) {
  return validateCloseIntent(value);
}

export function createPodCloseReceiptRecord(value = {}) {
  return validateCloseReceipt(value);
}

// canonical bytes是immutable文件的唯一编码；尾随换行属于物理文件合同。
export function podRecordCanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(validatePodRecord(value))}\n`, "utf8");
}

export function podRecordDigest(value) {
  return canonicalJsonDigest(validatePodRecord(value));
}

// portable ref只由已验证record派生，不接受调用方提供的物理路径。
export function podRecordRef(value) {
  const record = validatePodRecord(value);
  const root = `.wakeflow-local/runtime/hosts/${record.hostId}/evidence/pods/${record.podId}`;
  switch (record.kind) {
    case WAKEFLOW_POD_SCOPE_KIND:
      return `${root}/pod-scope.json`;
    case WAKEFLOW_POD_LAUNCH_INTENT_KIND:
      return `${root}/launch-intents/${record.launchOperationId}.json`;
    case WAKEFLOW_POD_MATERIALIZATION_EVENT_KIND:
      return `${root}/materialization/${record.launchOperationId}/events/${record.eventId}.json`;
    case WAKEFLOW_POD_CREATION_RECEIPT_KIND:
      return `${root}/bindings/${record.windowId}/creation-receipt.json`;
    case WAKEFLOW_POD_RESUME_OBSERVATION_KIND:
      return `${root}/bindings/${record.windowId}/resume-observations/${record.observationId}.json`;
    case WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND:
      return `${root}/test-access/${record.probeId}/plan.json`;
    case WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND:
      return `${root}/test-access/${record.probeId}/receipt.json`;
    case WAKEFLOW_POD_CLOSE_INTENT_KIND:
      return `${root}/close/${record.closeOperationId}/intent.json`;
    case WAKEFLOW_POD_CLOSE_RECEIPT_KIND:
      return `${root}/close/${record.closeOperationId}/receipt.json`;
    default:
      fail("wakeflow-pod-record-kind", "$/kind", "unsupported Pod record kind");
  }
}
