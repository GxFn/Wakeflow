/**
 * Wakeflow 需求执行 artifact 的领域准入与原子提交服务。
 *
 * 能力导航：
 * - TaskPackage：闭合 frozen authority、ledger requirement refs、拓扑分配、依赖与 lineage。
 * - TestCard：闭合 real-environment 决定、Test window、策略来源和产品任务完成 gate。
 * - TargetResult：闭合 package/assignment、证据映射、current/historical 与 correction lineage。
 * - ReviewCandidate：闭合当前 state selector、scope 分类和 immutable result tuple。
 * - 提交与库存：复用 demand state service 的单根 journal 事务，并诊断六类 artifact 文件。
 *
 * 本文件拥有“当前业务状态是否允许提交”的决定，但不拥有底层 journal effect、Pod Design 创建、
 * transport graph/lease authority 或 review 最终决定；这些分别留在 state、Pod、delivery/result-review owner。
 */

import path from "node:path";

import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import {
  buildWakeflowConfigV3Indexes,
  parseWakeflowConfigV3,
} from "./wakeflow-config-v3.mjs";
import {
  loadDemandCoreRecordsWhileLocked,
  validateControllerEventRecord,
  validateDemandStateRecord,
} from "./wakeflow-demand-core-records.mjs";
import {
  commitDemandArtifactTransition,
  loadDemandCoreRecordsWithArtifactClosure,
} from "./wakeflow-demand-state-service.mjs";
import {
  WAKEFLOW_DEMAND_ARTIFACT_KINDS,
  demandArtifactIdentity,
  inspectDemandArtifactInventory,
  loadDemandArtifactByRef,
  validateReviewCandidateArtifact,
  validateTargetResultArtifact,
  validateTaskPackageArtifact,
  validateTestCardArtifact,
} from "./wakeflow-demand-artifact-records.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { loadLedgerMemberBytes } from "./wakeflow-ledger-records.mjs";
import { withStateRootLock } from "./wakeflow-state-lock.mjs";

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TOKEN_CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/u;
const HUMAN_CONTROL_RE = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.[0-9]{1,9})?Z$/u;
const TERMINAL_DEMAND_STATES = new Set(["archived", "cancelled", "completed"]);
const ADMITTED_TEST_OPTIONAL_SKILLS = new Set();
const DEMAND_ARTIFACT_KIND_SET = new Set(WAKEFLOW_DEMAND_ARTIFACT_KINDS);
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

export class WakeflowDemandArtifactServiceError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowDemandArtifactServiceError";
    this.code = code;
    this.details = details;
  }
}

function serviceError(code, message, details = {}, cause = undefined) {
  return new WakeflowDemandArtifactServiceError(code, message, { details, cause });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalServiceSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    throw serviceError(
      "wakeflow-demand-artifact-service-input",
      `${label} must be canonical plain data without accessors, symbols, hidden fields, or cycles`,
      { causeCode: cause?.code ?? null },
      cause,
    );
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw serviceError("wakeflow-demand-artifact-service-input", `${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw serviceError("wakeflow-demand-artifact-service-input", `${label} must be a plain object`);
  }
  return value;
}

function assertExactKeys(value, required, label, optional = []) {
  assertPlainObject(value, label);
  const expected = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw serviceError("wakeflow-demand-artifact-service-input", `${label} contains unknown field ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw serviceError("wakeflow-demand-artifact-service-input", `${label} is missing ${key}`);
    }
  }
}

function normalizeServiceInput(value, required, optional, label) {
  const snapshot = canonicalServiceSnapshot(value, label);
  assertExactKeys(snapshot, required, label, optional);
  return snapshot;
}

// facade projection可携带未消费的方法；只以descriptor读取本函数真正使用的字段。
function exactDataProperties(value, required, optional, label) {
  assertPlainObject(value, label);
  const expected = new Set([...required, ...optional]);
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !expected.has(key)) {
      throw serviceError("wakeflow-demand-artifact-service-input", `${label} contains an unknown field`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw serviceError("wakeflow-demand-artifact-service-input", `${label}.${key} must be an enumerable data property`);
    }
    result[key] = descriptor.value;
  }
  for (const key of required) {
    if (!Object.hasOwn(result, key)) {
      throw serviceError("wakeflow-demand-artifact-service-input", `${label} is missing ${key}`);
    }
  }
  return result;
}

function ownDataProperty(value, key, label, { required = true } = {}) {
  assertPlainObject(value, label);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) {
    if (!required) return undefined;
    throw serviceError("wakeflow-demand-artifact-service-input", `${label} is missing ${key}`);
  }
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
    throw serviceError("wakeflow-demand-artifact-service-input", `${label}.${key} must be an enumerable data property`);
  }
  return descriptor.value;
}

function assertTypedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, label);
  } catch (cause) {
    throw serviceError("wakeflow-demand-artifact-service-id", `${label} must be a typed ${type} ID`, {}, cause);
  }
}

function normalizeExpectedPrevious(value) {
  assertExactKeys(value, ["revision", "stateDigest"], "expectedPrevious");
  if (!Number.isInteger(value.revision) || value.revision < 1 || !DIGEST_RE.test(value.stateDigest)) {
    throw serviceError(
      "wakeflow-demand-artifact-service-expected",
      "expectedPrevious must contain revision>=1 and stateDigest=sha256:<64 lowercase hex>",
    );
  }
  return Object.freeze({ revision: value.revision, stateDigest: value.stateDigest });
}

function assertTimestamp(value, label) {
  const match = typeof value === "string" ? value.match(TIMESTAMP_RE) : null;
  if (!match) throw serviceError("wakeflow-demand-artifact-service-time", `${label} must be a UTC RFC3339 timestamp`);
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
    throw serviceError("wakeflow-demand-artifact-service-time", `${label} must name a real UTC instant`);
  }
  return value;
}

function assertToken(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() || TOKEN_CONTROL_RE.test(value)) {
    throw serviceError("wakeflow-demand-artifact-service-token", `${label} must be non-empty, trimmed, single-line, and control-free`);
  }
  return value;
}

function assertHumanText(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() || HUMAN_CONTROL_RE.test(value)) {
    throw serviceError("wakeflow-demand-artifact-service-text", `${label} must be non-empty, trimmed, and control-free except line breaks`);
  }
  return value;
}

function normalizeTransition(value) {
  assertExactKeys(value, ["eventId", "createdAt", "reason", "decisionSummary"], "transition");
  return Object.freeze({
    eventId: assertToken(value.eventId, "transition.eventId"),
    createdAt: assertTimestamp(value.createdAt, "transition.createdAt"),
    reason: assertHumanText(value.reason, "transition.reason"),
    decisionSummary: assertHumanText(value.decisionSummary, "transition.decisionSummary"),
  });
}

function loadCurrent({ stateRoot, expectedProgramId, ledgerRoot, expectedPrevious }) {
  const programId = assertTypedId(expectedProgramId, "program", "expectedProgramId");
  const expected = normalizeExpectedPrevious(expectedPrevious);
  const loaded = loadDemandCoreRecordsWithArtifactClosure({
    stateRoot,
    expectedProgramId: programId,
    ledgerRoot,
  });
  return Object.freeze({ loaded, expected, programId });
}

function assertMutableDemandState(loaded, label) {
  if (TERMINAL_DEMAND_STATES.has(loaded.state.state)) {
    throw serviceError(
      "wakeflow-demand-artifact-service-state",
      `${label} cannot mutate terminal demand state ${loaded.state.state}`,
    );
  }
}

function assertExpectedPrevious({ loaded, expected }) {
  if (loaded.state.revision !== expected.revision || loaded.digests.state !== expected.stateDigest) {
    throw serviceError(
      "wakeflow-demand-artifact-service-stale",
      `expected state revision ${expected.revision}/${expected.stateDigest}, current is ${loaded.state.revision}/${loaded.digests.state}`,
      { expected, currentRevision: loaded.state.revision, currentStateDigest: loaded.digests.state },
    );
  }
}

function validateArtifactDemandBinding(artifact, loaded, transition) {
  if (
    artifact.programId !== loaded.demand.programId
    || artifact.demandId !== loaded.demand.demandId
    || artifact.demandRef !== "demand.json"
    || artifact.demandDigest !== loaded.digests.demand
  ) {
    throw serviceError(
      "wakeflow-demand-artifact-service-demand",
      "artifact must bind the exact immutable demand tuple",
      { artifactDemandId: artifact.demandId, currentDemandId: loaded.demand.demandId },
    );
  }
  if (artifact.createdAt !== transition.createdAt) {
    throw serviceError(
      "wakeflow-demand-artifact-service-time",
      "artifact createdAt must equal its exact controller event timestamp",
    );
  }
}

function normalizedConfig(config, expectedProgramId) {
  const model = parseWakeflowConfigV3(config);
  if (model.program.programId !== expectedProgramId) {
    throw serviceError(
      "wakeflow-demand-artifact-service-config",
      `candidate config belongs to ${model.program.programId}, not ${expectedProgramId}`,
    );
  }
  return Object.freeze({ model, indexes: buildWakeflowConfigV3Indexes(model) });
}

// ==================== 一、公开输入与配置拓扑准入 ====================

/**
 * 核对 artifact 的 window/repository assignment 与一次已解析配置快照。
 * 配置 facade 可以包含只读索引方法，但本函数只消费 indexes.windowById 中命中的纯 window 记录。
 */
export function validateDemandTaskAssignmentAgainstTopology(value) {
  const input = exactDataProperties(value, ["artifact", "config"], ["workType"], "topology assignment input");
  const artifact = canonicalServiceSnapshot(input.artifact, "topology assignment artifact");
  const workType = input.workType ?? null;
  const windowId = artifact.assignment?.windowId ?? artifact.windowId;
  const repositoryId = artifact.assignment?.repositoryId ?? artifact.repositoryId ?? null;
  const indexes = ownDataProperty(input.config, "indexes", "topology config");
  const windowById = ownDataProperty(indexes, "windowById", "topology config.indexes");
  const rawWindow = ownDataProperty(windowById, windowId, "topology config.indexes.windowById", { required: false });
  if (!rawWindow) {
    throw serviceError("wakeflow-demand-artifact-service-assignment", `configured window ${windowId} does not exist`);
  }
  const window = canonicalServiceSnapshot(rawWindow, `configured window ${windowId}`);
  const effectiveWorkType = workType ?? artifact.workType ?? null;
  if (window.role === "product") {
    if (effectiveWorkType === "test" || window.root.kind !== "repository" || window.root.repositoryId !== repositoryId) {
      throw serviceError(
        "wakeflow-demand-artifact-service-assignment",
        "product assignment must bind the exact configured repositoryId and cannot be a Test task",
      );
    }
    return window;
  }
  if (window.role === "test") {
    if (effectiveWorkType !== "test" || repositoryId !== null) {
      throw serviceError(
        "wakeflow-demand-artifact-service-assignment",
        "Test assignment must use the configured Test window and omit product repositoryId",
      );
    }
    return window;
  }
  throw serviceError(
    "wakeflow-demand-artifact-service-assignment",
    `task artifacts cannot target configured ${window.role} window ${windowId}`,
  );
}

// ==================== 二、state delta、幂等 replay 与单根事务 ====================

function artifactStateShape(state) {
  return {
    taskPackages: structuredClone(state.taskPackages),
    targetTasks: structuredClone(state.targetTasks),
    targetResults: structuredClone(state.targetResults),
    testCards: structuredClone(state.testCards),
    review: structuredClone(state.review),
  };
}

function sortBy(entries, field) {
  return entries.sort((left, right) => left[field].localeCompare(right[field]));
}

function buildEvent({ loaded, transition, identity, command, type, to }) {
  return validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: transition.eventId,
    demandId: loaded.demand.demandId,
    createdAt: transition.createdAt,
    actor: "controller",
    command,
    type,
    previousRevision: loaded.state.revision,
    nextRevision: loaded.state.revision + 1,
    from: loaded.state.state,
    to,
    reason: transition.reason,
    decisionSummary: transition.decisionSummary,
    changedArtifacts: [identity],
  });
}

function buildNextState({ loaded, event, artifacts }) {
  return validateDemandStateRecord({
    ...loaded.state,
    revision: event.nextRevision,
    state: event.to,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: {
      eventId: event.eventId,
      eventDigest: canonicalJsonDigest(event),
    },
    ...artifacts,
  });
}

function existingArtifactChange(loaded, identity) {
  for (const event of loaded.events) {
    const change = event.changedArtifacts.find((entry) => (
      entry.artifactKind === identity.artifactKind
      && entry.artifactId === identity.artifactId
    ));
    if (change) return { event, change };
  }
  return null;
}

// 幂等 replay必须同时匹配immutable bytes、完整Controller event intent及仍可读取的物理文件。
function existingArtifactResult({ loaded, identity, transition, command, type }) {
  const existing = existingArtifactChange(loaded, identity);
  if (!existing) return null;
  const { event, change } = existing;
  if (change.ref !== identity.ref || change.digest !== identity.digest) {
    throw serviceError(
      "wakeflow-demand-artifact-service-conflict",
      `immutable artifact ID ${identity.artifactId} is already bound to different canonical bytes`,
      { existing: change, proposed: identity },
    );
  }
  if (
    event.eventId !== transition.eventId
    || event.createdAt !== transition.createdAt
    || event.reason !== transition.reason
    || event.decisionSummary !== transition.decisionSummary
    || event.command !== command
    || event.type !== type
  ) {
    throw serviceError(
      "wakeflow-demand-artifact-service-conflict",
      `immutable artifact ID ${identity.artifactId} is already bound to a different controller event intent`,
      { existingEventId: event.eventId, proposedEventId: transition.eventId },
    );
  }
  loadDemandArtifactByRef({
    stateRoot: loaded.paths.stateRoot,
    ref: identity.ref,
    digest: identity.digest,
    expectedArtifactKind: identity.artifactKind,
    expectedArtifactId: identity.artifactId,
    expectedProgramId: loaded.demand.programId,
    expectedDemandId: loaded.demand.demandId,
  });
  return deepFreeze({
    created: false,
    demandId: loaded.demand.demandId,
    revision: loaded.state.revision,
    artifact: identity,
  });
}

// state service拥有journal effect；这里仅在CAS stale后重载并确认是否为同一intent的并发成功。
function commit({ loadedContext, artifact, transition, event, nextState }) {
  try {
    return commitDemandArtifactTransition({
      stateRoot: loadedContext.loaded.paths.stateRoot,
      expectedProgramId: loadedContext.programId,
      ledgerRoot: loadedContext.ledgerRoot,
      expectedPrevious: loadedContext.expected,
      artifact,
      event,
      nextState,
    });
  } catch (cause) {
    if (cause?.code !== "wakeflow-demand-state-stale") throw cause;
    const reloaded = loadDemandCoreRecordsWithArtifactClosure({
      stateRoot: loadedContext.loaded.paths.stateRoot,
      expectedProgramId: loadedContext.programId,
      ledgerRoot: loadedContext.ledgerRoot,
    });
    const idempotent = existingArtifactResult({
      loaded: reloaded,
      identity: demandArtifactIdentity(artifact),
      transition,
      command: event.command,
      type: event.type,
    });
    if (idempotent) return idempotent;
    throw cause;
  }
}

function contextWithLedger(context, ledgerRoot) {
  return Object.freeze({ ...context, ledgerRoot });
}

function loadExactStateArtifact(loaded, tuple, kind, id) {
  return loadDemandArtifactByRef({
    stateRoot: loaded.paths.stateRoot,
    ref: tuple.ref,
    digest: tuple.digest,
    expectedArtifactKind: kind,
    expectedArtifactId: id,
    expectedProgramId: loaded.demand.programId,
    expectedDemandId: loaded.demand.demandId,
  }).record;
}

function assertObservedEvent(loaded, observed, label) {
  const event = loaded.events[observed.revision - 1];
  if (
    !event
    || event.eventId !== observed.eventId
    || canonicalJsonDigest(event) !== observed.eventDigest
  ) {
    throw serviceError(
      "wakeflow-demand-artifact-service-observed-state",
      `${label} must bind an exact event in this demand history`,
    );
  }
  return event;
}

// ==================== 三、ledger requirement 与 immutable artifact 交叉引用 ====================

function ledgerLocationForRef(ref) {
  const segments = ref.split("/");
  if (segments[0] === "requirement-designs" && segments.length >= 3) {
    return { family: "requirement", relativeRoot: segments.slice(0, 2).join("/"), memberPath: segments.slice(2).join("/") };
  }
  if (segments[0] === "goal-stage-confirmation" && segments.length >= 3) {
    return { family: "confirmation", relativeRoot: segments.slice(0, 2).join("/"), memberPath: segments.slice(2).join("/") };
  }
  return null;
}

function markdownAnchor(value) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(value ?? ""));
  } catch {
    return null;
  }
  return decoded
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replace(/[\s_]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function markdownHasHeading(bytes, anchor) {
  let content;
  try {
    content = UTF8_FATAL.decode(bytes);
  } catch {
    return false;
  }
  const expected = markdownAnchor(anchor);
  if (!expected) return false;
  return content
    .split(/\r?\n/u)
    .map((line) => line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/u)?.[1])
    .filter(Boolean)
    .map(markdownAnchor)
    .includes(expected);
}

// requirement ref必须同时存在于ledger、frozen authority和Markdown heading三层事实中。
function validateTaskPackageRequirementRefs(taskPackage, {
  ledgerRoot,
  expectedProgramId,
  expectedDemandId,
  authorityRefs,
}) {
  for (const requirementRef of taskPackage.requirementRefs) {
    const location = ledgerLocationForRef(requirementRef.ref);
    if (!location || typeof ledgerRoot !== "string" || !ledgerRoot.trim()) {
      throw serviceError(
        "wakeflow-demand-artifact-service-requirement-ref",
        `requirement ref ${requirementRef.ref} must resolve inside the owning portable ledger`,
      );
    }
    let resolved;
    try {
      resolved = loadLedgerMemberBytes({
        ledgerRoot,
        root: path.join(path.resolve(ledgerRoot), ...location.relativeRoot.split("/")),
        expectedFamily: location.family,
        expectedProgramId,
        memberPath: location.memberPath,
      });
    } catch (cause) {
      throw serviceError(
        "wakeflow-demand-artifact-service-requirement-ref",
        `requirement ref ${requirementRef.ref} cannot be strict-loaded from the owning ledger`,
        {},
        cause,
      );
    }
    const { loaded, member, bytes } = resolved;
    if (!member || member.digest !== requirementRef.digest) {
      throw serviceError(
        "wakeflow-demand-artifact-service-requirement-ref",
        `requirement ref ${requirementRef.ref} does not match one exact ledger member digest`,
      );
    }
    if (loaded.family === "confirmation" && loaded.record.demandId !== expectedDemandId) {
      throw serviceError(
        "wakeflow-demand-artifact-service-requirement-ref",
        `confirmation ref ${requirementRef.ref} belongs to another demand`,
      );
    }
    if (!authorityRefs.some((entry) => (
      entry.memberRef === requirementRef.ref
      && entry.memberDigest === requirementRef.digest
    ))) {
      throw serviceError(
        "wakeflow-demand-artifact-service-requirement-ref",
        `requirement ref ${requirementRef.ref} is not part of the exact frozen demand authority`,
      );
    }
    if (
      requirementRef.role !== "evidence"
      && (member.mediaType !== "text/markdown" || !markdownHasHeading(bytes, requirementRef.anchor))
    ) {
      throw serviceError(
        "wakeflow-demand-artifact-service-requirement-anchor",
        `requirement ref ${requirementRef.ref} does not contain Markdown heading #${requirementRef.anchor}`,
      );
    }
  }
}

function loadTestCards(stateArtifacts, loaded) {
  return stateArtifacts.testCards.map((entry) => ({
    state: entry,
    record: loadExactStateArtifact(loaded, entry, "wakeflow-test-card", entry.testCardId),
  }));
}

// package准入保留completed continuation这一唯一重开例外，并阻止pending review期间扩张任务集。
function assertTaskPackageAdmission(taskPackage, loaded, stateArtifacts) {
  if (["archived", "cancelled", "review-ready", "waiting-results", "blocked"].includes(loaded.state.state)) {
    throw serviceError(
      "wakeflow-demand-artifact-service-state",
      `cannot create a task package while demand state is ${loaded.state.state}`,
    );
  }
  if ((loaded.state.state === "completed") !== Boolean(taskPackage.continuation)) {
    throw serviceError(
      "wakeflow-demand-artifact-service-continuation",
      taskPackage.continuation
        ? "continuation package creation requires a completed, unarchived demand"
        : "completed demand requires an explicit continuation package",
    );
  }
  if (taskPackage.continuation) {
    const completionEvent = loaded.events.at(-1);
    if (
      completionEvent?.type !== "demand.completed"
      || completionEvent.to !== "completed"
      || completionEvent.eventId !== loaded.state.lastEvent.eventId
    ) {
      throw serviceError(
        "wakeflow-demand-artifact-service-continuation",
        "continuation requires the exact current demand.completed event tail",
      );
    }
  }
  if (stateArtifacts.review.status === "pending") {
    throw serviceError(
      "wakeflow-demand-artifact-service-state",
      "cannot create a task package while a review candidate is pending",
    );
  }
  if (taskPackage.workType === "implementation") {
    if (!loaded.authority) {
      throw serviceError(
        "wakeflow-demand-artifact-service-authority",
        "implementation task packages require frozen demand authority",
      );
    }
    if (loaded.demand.demandType === "research") {
      throw serviceError(
        "wakeflow-demand-artifact-service-authority",
        "research demand authority cannot authorize an implementation task package",
      );
    }
  }
}

// ==================== 四、TaskPackage 准入与 lineage ====================

/**
 * 创建一个新任务合同，并在同一事务中登记 active package 与 planned target task。
 */
export function createTaskPackageArtifact(value = {}) {
  const input = normalizeServiceInput(value, [
    "stateRoot",
    "expectedProgramId",
    "config",
    "expectedPrevious",
    "artifact",
    "transition",
  ], ["ledgerRoot"], "createTaskPackageArtifact input");
  const {
    stateRoot,
    expectedProgramId,
    ledgerRoot = null,
    config,
    expectedPrevious,
    artifact,
    transition,
  } = input;
  const taskPackage = validateTaskPackageArtifact(artifact);
  const tx = normalizeTransition(transition);
  const loadedContext = contextWithLedger(loadCurrent({
    stateRoot,
    expectedProgramId,
    ledgerRoot,
    expectedPrevious,
  }), ledgerRoot);
  const { loaded } = loadedContext;
  const command = "create-task-package";
  const type = "task-package.created";
  validateArtifactDemandBinding(taskPackage, loaded, tx);
  const identity = demandArtifactIdentity(taskPackage);
  const existing = existingArtifactResult({ loaded, identity, transition: tx, command, type });
  if (existing) return existing;
  assertExpectedPrevious(loadedContext);
  if (
    !loaded.authority
    || taskPackage.demandAuthorityRef !== "demand-authority.json"
    || taskPackage.demandAuthorityDigest !== loaded.digests.authority
  ) {
    throw serviceError(
      "wakeflow-demand-artifact-service-authority",
      "task package must bind the exact frozen demand authority tuple",
    );
  }
  const configContext = normalizedConfig(config, loaded.demand.programId);
  validateDemandTaskAssignmentAgainstTopology({ artifact: taskPackage, config: configContext });
  const stateArtifacts = artifactStateShape(loaded.state);
  assertTaskPackageAdmission(taskPackage, loaded, stateArtifacts);
  validateTaskPackageRequirementRefs(taskPackage, {
    ledgerRoot,
    expectedProgramId: loaded.demand.programId,
    expectedDemandId: loaded.demand.demandId,
    authorityRefs: loaded.authority.authorityRefs,
  });
  if (stateArtifacts.taskPackages.some((entry) => entry.taskPackageId === taskPackage.taskPackageId)) {
    throw serviceError("wakeflow-demand-artifact-service-conflict", "task package ID is already present in state");
  }
  if (stateArtifacts.targetTasks.some((entry) => entry.targetTaskId === taskPackage.targetTaskId)) {
    throw serviceError("wakeflow-demand-artifact-service-conflict", "target task ID is already present in state");
  }
  for (const dependencyId of taskPackage.dependsOnTargetTaskIds) {
    const dependency = stateArtifacts.targetTasks.find((entry) => entry.targetTaskId === dependencyId);
    if (!dependency || dependency.lifecycleStatus !== "accepted") {
      throw serviceError(
        "wakeflow-demand-artifact-service-dependency",
        `dependency ${dependencyId} must exist and be accepted before package creation`,
      );
    }
  }
  if (taskPackage.workType === "test") {
    const unresolvedProductTask = stateArtifacts.targetTasks.find((entry) => (
      Object.hasOwn(entry, "repositoryId")
      && !["accepted", "superseded"].includes(entry.lifecycleStatus)
    ));
    if (unresolvedProductTask) {
      throw serviceError(
        "wakeflow-demand-artifact-service-test-gate",
        `Test package requires every non-Test target to be accepted or superseded; ${unresolvedProductTask.targetTaskId} is ${unresolvedProductTask.lifecycleStatus}`,
      );
    }
  }
  const replacementTask = taskPackage.replacesTargetTask
    ? stateArtifacts.targetTasks.find((entry) => entry.targetTaskId === taskPackage.replacesTargetTask.targetTaskId)
    : null;
  if (taskPackage.replacesTargetTask && !replacementTask) {
    throw serviceError("wakeflow-demand-artifact-service-replacement", "replacement target task does not exist in current state");
  }
  // replacement不是普通rework别名；它必须回溯到同一repository的exact redesign决定链。
  if (replacementTask) {
    const replacementPackageState = stateArtifacts.taskPackages.find(
      (entry) => entry.taskPackageId === replacementTask.taskPackageId,
    );
    const redesignEvent = [...loaded.events].reverse().find((event) => (
      event.reviewDecision?.targetTaskIds.includes(replacementTask.targetTaskId)
    ));
    let redesignAuthority = null;
    if (redesignEvent?.reviewDecision?.decision === "redesign") {
      try {
        const candidateTuple = redesignEvent.reviewDecision.candidate;
        const candidate = loadDemandArtifactByRef({
          stateRoot: loaded.paths.stateRoot,
          ref: candidateTuple.ref,
          digest: candidateTuple.digest,
          expectedArtifactKind: "wakeflow-review-candidate",
          expectedArtifactId: candidateTuple.reviewCandidateId,
          expectedProgramId: loaded.demand.programId,
          expectedDemandId: loaded.demand.demandId,
        }).record;
        const resultTuple = candidate.results.find((entry) => (
          entry.targetTaskId === replacementTask.targetTaskId
        ));
        const result = resultTuple && replacementTask.currentResult
          ? loadDemandArtifactByRef({
            stateRoot: loaded.paths.stateRoot,
            ref: resultTuple.ref,
            digest: resultTuple.digest,
            expectedArtifactKind: "wakeflow-target-result",
            expectedArtifactId: resultTuple.targetResultId,
            expectedProgramId: loaded.demand.programId,
            expectedDemandId: loaded.demand.demandId,
          }).record
          : null;
        const group = redesignEvent.reviewDecision.group;
        if (
          candidate.resultSetDigest === redesignEvent.reviewDecision.resultSetDigest
          && candidate.reviewScope.targetTaskIds.includes(replacementTask.targetTaskId)
          && candidate.allowedDecisions.includes("redesign")
          && candidate.missingTargetTaskIds.length === 0
          && resultTuple
          && resultTuple.targetResultId === replacementTask.currentResult?.targetResultId
          && resultTuple.ref === replacementTask.currentResult?.ref
          && resultTuple.digest === replacementTask.currentResult?.digest
          && result?.transport.group.id === group.groupId
          && result.transport.group.ref === group.ref
          && result.transport.group.digest === group.digest
        ) {
          redesignAuthority = { candidate, result };
        }
      } catch {
        redesignAuthority = null;
      }
    }
    if (
      redesignEvent?.type !== "review.redesign-requested"
      || redesignEvent.to !== "needs-rework"
      || redesignEvent.reviewDecision?.decision !== "redesign"
      || !redesignAuthority
      || replacementTask.lifecycleStatus !== "needs-rework"
      || taskPackage.workType !== "implementation"
      || replacementTask.repositoryId !== taskPackage.repositoryId
      || !replacementPackageState
      || replacementPackageState.ref !== taskPackage.replacesTargetTask.taskPackageRef
      || replacementPackageState.digest !== taskPackage.replacesTargetTask.taskPackageDigest
    ) {
      throw serviceError(
        "wakeflow-demand-artifact-service-replacement",
        "replacement must bind the exact needs-rework package in the same product repository",
      );
    }
    loadExactStateArtifact(
      loaded,
      replacementPackageState,
      "wakeflow-task-package",
      replacementPackageState.taskPackageId,
    );
  }
  let continuationTask = null;
  let continuationPackageState = null;
  let continuationPackage = null;
  // continuation只允许从completed tail延长当前accepted lineage head，历史分支不能再次成为前驱。
  if (taskPackage.continuation) {
    continuationPackageState = stateArtifacts.taskPackages.find(
      (entry) => entry.taskPackageId === taskPackage.continuation.previousTaskPackageId,
    );
    if (
      !continuationPackageState
      || continuationPackageState.ref !== taskPackage.continuation.ref
      || continuationPackageState.digest !== taskPackage.continuation.digest
    ) {
      throw serviceError(
        "wakeflow-demand-artifact-service-continuation",
        "continuation must bind one exact prior package in current state inventory",
      );
    }
    continuationPackage = loadExactStateArtifact(
      loaded,
      continuationPackageState,
      "wakeflow-task-package",
      continuationPackageState.taskPackageId,
    );
    continuationTask = stateArtifacts.targetTasks.find(
      (entry) => entry.taskPackageId === continuationPackageState.taskPackageId,
    );
    if (
      !continuationTask
      || continuationTask.lifecycleStatus !== "accepted"
      || continuationPackageState.lifecycleStatus !== "closed"
      || continuationPackage.repositoryId !== taskPackage.repositoryId
      || continuationPackage.workType !== taskPackage.workType
      || continuationPackage.windowId !== taskPackage.windowId
    ) {
      throw serviceError(
        "wakeflow-demand-artifact-service-continuation",
        "continuation must extend the exact accepted lineage head for the same repository and work type",
      );
    }
    const unresolvedPriorTask = stateArtifacts.targetTasks.find(
      (entry) => !["accepted", "superseded"].includes(entry.lifecycleStatus),
    );
    if (unresolvedPriorTask) {
      throw serviceError(
        "wakeflow-demand-artifact-service-continuation",
        `continuation requires all prior target tasks closed; ${unresolvedPriorTask.targetTaskId} is ${unresolvedPriorTask.lifecycleStatus}`,
      );
    }
    const unresolvedPriorPackage = stateArtifacts.taskPackages.find(
      (entry) => !["closed", "superseded"].includes(entry.lifecycleStatus),
    );
    if (unresolvedPriorPackage) {
      throw serviceError(
        "wakeflow-demand-artifact-service-continuation",
        `continuation requires all prior task packages closed; ${unresolvedPriorPackage.taskPackageId} is ${unresolvedPriorPackage.lifecycleStatus}`,
      );
    }
    for (const packageState of stateArtifacts.taskPackages) {
      if (packageState.taskPackageId === continuationPackageState.taskPackageId) continue;
      const packageRecord = loadExactStateArtifact(
        loaded,
        packageState,
        "wakeflow-task-package",
        packageState.taskPackageId,
      );
      if (packageRecord.continuation?.previousTaskPackageId === continuationPackageState.taskPackageId) {
        throw serviceError(
          "wakeflow-demand-artifact-service-continuation",
          "continuation predecessor is already closed by a later lineage package and is not the current head",
        );
      }
    }
  }
  const sameRepositoryTasks = taskPackage.repositoryId
    ? stateArtifacts.targetTasks.filter((entry) => entry.repositoryId === taskPackage.repositoryId)
    : [];
  const repositoryConflict = sameRepositoryTasks.some((entry) => {
    if (entry.targetTaskId === replacementTask?.targetTaskId) return false;
    if (entry.targetTaskId === continuationTask?.targetTaskId) return false;
    const packageState = stateArtifacts.taskPackages.find(
      (candidate) => candidate.taskPackageId === entry.taskPackageId,
    );
    if (entry.lifecycleStatus === "accepted" && packageState?.lifecycleStatus === "closed") return false;
    return !["cancelled", "superseded"].includes(entry.lifecycleStatus);
  });
  if (
    taskPackage.repositoryId
    && (
      repositoryConflict
      || (
        sameRepositoryTasks.length > 0
        && !replacementTask
        && !continuationTask
      )
    )
  ) {
    throw serviceError(
      "wakeflow-demand-artifact-service-repository-claim",
      `demand already has an active task lineage for repository ${taskPackage.repositoryId}`,
    );
  }
  let linkedTestCard = null;
  const cardsForTarget = loadTestCards(stateArtifacts, loaded)
    .filter((entry) => entry.record.targetTaskId === taskPackage.targetTaskId);
  if (!taskPackage.testCard && cardsForTarget.length > 0) {
    throw serviceError(
      "wakeflow-demand-artifact-service-test-card",
      "a target task ID reserved by a Test card can only be used by its exact Test package",
    );
  }
  if (taskPackage.testCard) {
    const cardState = stateArtifacts.testCards.find((entry) => entry.testCardId === taskPackage.testCard.testCardId);
    if (
      !cardState
      || cardState.ref !== taskPackage.testCard.ref
      || cardState.digest !== taskPackage.testCard.digest
      || cardState.lifecycleStatus !== "active"
    ) {
      throw serviceError("wakeflow-demand-artifact-service-test-card", "task package Test card tuple is not the exact active state entry");
    }
    const card = loadExactStateArtifact(
      loaded,
      taskPackage.testCard,
      "wakeflow-test-card",
      taskPackage.testCard.testCardId,
    );
    if (card.targetTaskId !== taskPackage.targetTaskId || card.windowId !== taskPackage.windowId) {
      throw serviceError("wakeflow-demand-artifact-service-test-card", "task package assignment differs from its exact Test card");
    }
    linkedTestCard = taskPackage.testCard;
  }
  if (replacementTask) {
    replacementTask.lifecycleStatus = "superseded";
    const replacementPackageState = stateArtifacts.taskPackages.find(
      (entry) => entry.taskPackageId === replacementTask.taskPackageId,
    );
    replacementPackageState.lifecycleStatus = "superseded";
  }
  stateArtifacts.taskPackages.push({
    taskPackageId: taskPackage.taskPackageId,
    ref: identity.ref,
    digest: identity.digest,
    lifecycleStatus: "active",
  });
  stateArtifacts.targetTasks.push({
    targetTaskId: taskPackage.targetTaskId,
    taskPackageId: taskPackage.taskPackageId,
    windowId: taskPackage.windowId,
    ...(taskPackage.repositoryId ? { repositoryId: taskPackage.repositoryId } : {}),
    lifecycleStatus: "planned",
    ...(linkedTestCard ? { testCard: linkedTestCard, testAttempts: [] } : {}),
  });
  sortBy(stateArtifacts.taskPackages, "taskPackageId");
  sortBy(stateArtifacts.targetTasks, "targetTaskId");
  const event = buildEvent({
    loaded,
    transition: tx,
    identity,
    command,
    type,
    to: ["intake", "needs-rework", "completed"].includes(loaded.state.state) ? "planned" : loaded.state.state,
  });
  const nextState = buildNextState({ loaded, event, artifacts: stateArtifacts });
  return commit({ loadedContext, artifact: taskPackage, transition: tx, event, nextState });
}

// ==================== 五、TestCard 准入 ====================

/**
 * 创建一个尚未占用 targetTaskId 的真实环境 Test 合同；不创建对应 TaskPackage。
 */
export function createTestCardArtifact(value = {}) {
  const input = normalizeServiceInput(value, [
    "stateRoot",
    "expectedProgramId",
    "config",
    "expectedPrevious",
    "artifact",
    "transition",
  ], ["ledgerRoot"], "createTestCardArtifact input");
  const {
    stateRoot,
    expectedProgramId,
    ledgerRoot = null,
    config,
    expectedPrevious,
    artifact,
    transition,
  } = input;
  const testCard = validateTestCardArtifact(artifact);
  const tx = normalizeTransition(transition);
  const loadedContext = contextWithLedger(loadCurrent({
    stateRoot,
    expectedProgramId,
    ledgerRoot,
    expectedPrevious,
  }), ledgerRoot);
  const { loaded } = loadedContext;
  const command = "create-test-card";
  const type = "test-card.created";
  validateArtifactDemandBinding(testCard, loaded, tx);
  const identity = demandArtifactIdentity(testCard);
  const existing = existingArtifactResult({ loaded, identity, transition: tx, command, type });
  if (existing) return existing;
  assertExpectedPrevious(loadedContext);
  assertMutableDemandState(loaded, "Test card creation");
  if (loaded.state.review.status === "pending") {
    throw serviceError(
      "wakeflow-demand-artifact-service-review",
      "Test card creation cannot advance state while a review candidate is pending",
    );
  }
  if (!loaded.authority || loaded.digests.authority !== testCard.demandAuthorityDigest) {
    throw serviceError("wakeflow-demand-artifact-service-authority", "Test card requires the exact frozen demand authority");
  }
  if (loaded.authority.testDecision.mode !== "real-environment") {
    throw serviceError(
      "wakeflow-demand-artifact-service-authority",
      "Test card creation requires authority.testDecision.mode=real-environment",
    );
  }
  if (testCard.executionContract.requirementGoal !== loaded.demand.goal) {
    throw serviceError(
      "wakeflow-demand-artifact-service-test-goal",
      "Test card requirementGoal must equal the exact immutable demand goal",
    );
  }
  const unsupportedSkill = testCard.executionContract.allowedSkills.find(
    (skill) => !ADMITTED_TEST_OPTIONAL_SKILLS.has(skill),
  );
  if (unsupportedSkill) {
    throw serviceError(
      "wakeflow-demand-artifact-service-test-skill",
      `Test card optional skill ${unsupportedSkill} is not admitted by the current candidate capability registry`,
    );
  }
  const strategyAuthorityRef = loaded.authority.authorityRefs.find((entry) => (
    entry.memberRef === testCard.strategySource.ref
    && entry.memberDigest === testCard.strategySource.digest
  ));
  if (
    !strategyAuthorityRef
  ) {
    throw serviceError(
      "wakeflow-demand-artifact-service-authority",
      "Test card strategySource must bind one exact frozen authority member",
    );
  }
  if (
    testCard.observedState.revision !== loaded.state.revision
    || testCard.observedState.eventId !== loaded.state.lastEvent.eventId
    || testCard.observedState.eventDigest !== loaded.state.lastEvent.eventDigest
  ) {
    throw serviceError("wakeflow-demand-artifact-service-observed-state", "Test card must observe the exact current state/event tail");
  }
  const configContext = normalizedConfig(config, loaded.demand.programId);
  validateDemandTaskAssignmentAgainstTopology({ artifact: testCard, config: configContext, workType: "test" });
  const stateArtifacts = artifactStateShape(loaded.state);
  const openProductTask = stateArtifacts.targetTasks.find((entry) => (
    Object.hasOwn(entry, "repositoryId")
    && !["accepted", "superseded"].includes(entry.lifecycleStatus)
  ));
  if (openProductTask) {
    throw serviceError(
      "wakeflow-demand-artifact-service-test-gate",
      `Test card requires every non-Test target to be accepted or superseded; ${openProductTask.targetTaskId} is ${openProductTask.lifecycleStatus}`,
    );
  }
  if (stateArtifacts.targetTasks.some((entry) => entry.targetTaskId === testCard.targetTaskId)) {
    throw serviceError("wakeflow-demand-artifact-service-test-card", "Test card target task ID is already occupied");
  }
  for (const existingCard of loadTestCards(stateArtifacts, loaded)) {
    if (existingCard.record.targetTaskId === testCard.targetTaskId) {
      throw serviceError("wakeflow-demand-artifact-service-test-card", "target task already has a Test card");
    }
  }
  stateArtifacts.testCards.push({
    testCardId: testCard.testCardId,
    ref: identity.ref,
    digest: identity.digest,
    lifecycleStatus: "active",
  });
  sortBy(stateArtifacts.testCards, "testCardId");
  const event = buildEvent({
    loaded,
    transition: tx,
    identity,
    command,
    type,
    to: loaded.state.state,
  });
  const nextState = buildNextState({ loaded, event, artifacts: stateArtifacts });
  return commit({ loadedContext, artifact: testCard, transition: tx, event, nextState });
}

// ==================== 六、TargetResult current/historical 准入 ====================

/**
 * 记录已经由 result-review orchestration 推导为 current 或 historical 的结果。
 * 本层重验 state/package/craft/lineage；transport graph 与 lease 的事实推导仍归上层 owner。
 */
export function recordTargetResultArtifact(value = {}) {
  const input = normalizeServiceInput(value, [
    "stateRoot",
    "expectedProgramId",
    "config",
    "expectedPrevious",
    "artifact",
    "transition",
    "selection",
  ], ["ledgerRoot"], "recordTargetResultArtifact input");
  const {
    stateRoot,
    expectedProgramId,
    ledgerRoot = null,
    config,
    expectedPrevious,
    artifact,
    transition,
    selection,
  } = input;
  if (!["current", "historical"].includes(selection)) {
    throw serviceError("wakeflow-demand-artifact-service-selection", "TargetResult selection must be current or historical");
  }
  const targetResult = validateTargetResultArtifact(artifact);
  const tx = normalizeTransition(transition);
  const loadedContext = contextWithLedger(loadCurrent({
    stateRoot,
    expectedProgramId,
    ledgerRoot,
    expectedPrevious,
  }), ledgerRoot);
  const { loaded } = loadedContext;
  const command = selection === "current"
    ? "record-target-result-current"
    : "record-target-result-historical";
  const type = "target-result.recorded";
  validateArtifactDemandBinding(targetResult, loaded, tx);
  const identity = demandArtifactIdentity(targetResult);
  const existing = existingArtifactResult({ loaded, identity, transition: tx, command, type });
  if (existing) return existing;
  assertExpectedPrevious(loadedContext);
  assertMutableDemandState(loaded, "TargetResult recording");
  const configContext = normalizedConfig(config, loaded.demand.programId);
  const stateArtifacts = artifactStateShape(loaded.state);
  const task = stateArtifacts.targetTasks.find((entry) => entry.targetTaskId === targetResult.targetTaskId);
  if (!task || ["cancelled", "superseded"].includes(task.lifecycleStatus)) {
    throw serviceError("wakeflow-demand-artifact-service-target-task", "TargetResult requires one existing non-cancelled target task");
  }
  if (stateArtifacts.review.status === "pending") {
    throw serviceError(
      "wakeflow-demand-artifact-service-review",
      "TargetResult cannot advance the state revision while a review candidate is pending",
    );
  }
  const packageState = stateArtifacts.taskPackages.find((entry) => entry.taskPackageId === task.taskPackageId);
  if (
    !packageState
    || packageState.taskPackageId !== targetResult.taskPackage.taskPackageId
    || packageState.ref !== targetResult.taskPackage.ref
    || packageState.digest !== targetResult.taskPackage.digest
  ) {
    throw serviceError("wakeflow-demand-artifact-service-package", "TargetResult package tuple must equal the target task package state tuple");
  }
  const taskPackage = loadExactStateArtifact(
    loaded,
    packageState,
    "wakeflow-task-package",
    packageState.taskPackageId,
  );
  validateDemandTaskAssignmentAgainstTopology({ artifact: taskPackage, config: configContext });
  if (
    targetResult.assignment.windowId !== task.windowId
    || (targetResult.assignment.repositoryId ?? null) !== (task.repositoryId ?? null)
    || targetResult.assignment.windowId !== taskPackage.windowId
    || (targetResult.assignment.repositoryId ?? null) !== (taskPackage.repositoryId ?? null)
  ) {
    throw serviceError("wakeflow-demand-artifact-service-assignment", "TargetResult assignment must echo the exact task package and target task");
  }
  const assignedRepositoryId = targetResult.assignment.repositoryId ?? null;
  if (assignedRepositoryId === null && targetResult.repositoryChanges.length !== 0) {
    throw serviceError(
      "wakeflow-demand-artifact-service-repository",
      "Test TargetResult cannot claim product repository changes",
    );
  }
  if (
    assignedRepositoryId !== null
    && (
      targetResult.repositoryChanges.length !== 1
      || targetResult.repositoryChanges[0].repositoryId !== assignedRepositoryId
    )
  ) {
    throw serviceError(
      "wakeflow-demand-artifact-service-repository",
      "product TargetResult must report exactly its assigned repository disposition",
    );
  }
  const requiredEvidenceKinds = taskPackage.reviewInputContract.requiredKinds;
  const evidenceKinds = targetResult.evidenceLocators.map((entry) => entry.kind);
  const evidenceRefs = targetResult.evidenceLocators.map((entry) => entry.ref);
  if (
    new Set(evidenceRefs).size !== evidenceRefs.length
    || (
      targetResult.outcome === "completed"
      && requiredEvidenceKinds.some((kind) => !evidenceKinds.includes(kind))
    )
  ) {
    throw serviceError(
      "wakeflow-demand-artifact-service-review-input",
      "completed TargetResult must provide every package-required typed review input kind",
    );
  }
  const acceptanceMappings = targetResult.craftMapping.filter((entry) => entry.kind === "acceptance-anchor");
  const testStepMappings = targetResult.craftMapping.filter((entry) => entry.kind === "test-step");
  const evidenceTupleKeys = new Set(targetResult.evidenceLocators.map(
    (entry) => `${entry.ref}\u0000${entry.digest}`,
  ));
  if (acceptanceMappings.some((mapping) => mapping.evidenceRefs.some(
    (entry) => !evidenceTupleKeys.has(`${entry.ref}\u0000${entry.digest}`),
  ))) {
    throw serviceError(
      "wakeflow-demand-artifact-service-craft",
      "acceptance-anchor mappings may reference only exact declared evidence locator tuples",
    );
  }
  if (testStepMappings.some((mapping) => (
    targetResult.evidenceLocators.filter((entry) => entry.ref === mapping.ref).length !== 1
  ))) {
    throw serviceError(
      "wakeflow-demand-artifact-service-craft",
      "test-step mappings must reference exactly one declared evidence locator",
    );
  }
  if (taskPackage.workType === "test") {
    if (acceptanceMappings.length > 0 || !taskPackage.testCard) {
      throw serviceError(
        "wakeflow-demand-artifact-service-craft",
        "Test TargetResult can contain only approved-plan test-step mappings",
      );
    }
    const testCard = loadDemandArtifactByRef({
      stateRoot: loaded.paths.stateRoot,
      ref: taskPackage.testCard.ref,
      digest: taskPackage.testCard.digest,
      expectedArtifactKind: "wakeflow-test-card",
      expectedArtifactId: taskPackage.testCard.testCardId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
    }).record;
    const approvedPlan = testCard.executionContract.approvedPlan;
    const planIndices = testStepMappings.map((entry) => entry.planIndex);
    const sortedPlanIndices = [...planIndices].sort((left, right) => left - right);
    if (
      new Set(planIndices).size !== planIndices.length
      || planIndices.some((planIndex, index) => planIndex !== sortedPlanIndices[index])
      || testStepMappings.some((entry) => (
        entry.planIndex >= approvedPlan.length
        || entry.step !== approvedPlan[entry.planIndex]
      ))
      || (
        targetResult.outcome === "completed"
        && (
          testStepMappings.length !== approvedPlan.length
          || approvedPlan.some((_step, planIndex) => !planIndices.includes(planIndex))
        )
      )
    ) {
      throw serviceError(
        "wakeflow-demand-artifact-service-craft",
        "completed Test TargetResult must map every approved Test plan step exactly once and in order",
      );
    }
  } else {
    if (testStepMappings.length > 0) {
      throw serviceError(
        "wakeflow-demand-artifact-service-craft",
        "non-Test TargetResult cannot contain test-step mappings",
      );
    }
    const packageAnchorIds = new Set(taskPackage.acceptanceAnchors.map((entry) => entry.anchorId));
    const mappingAnchorIds = acceptanceMappings.map((entry) => entry.anchorId);
    const sortedMappingAnchorIds = [...mappingAnchorIds].sort((left, right) => left.localeCompare(right));
    if (
      new Set(mappingAnchorIds).size !== mappingAnchorIds.length
      || mappingAnchorIds.some((anchorId, index) => (
        !packageAnchorIds.has(anchorId)
        || anchorId !== sortedMappingAnchorIds[index]
      ))
      || (
        targetResult.outcome === "completed"
        && taskPackage.acceptanceAnchors.some(
          (anchor) => !mappingAnchorIds.includes(anchor.anchorId),
        )
      )
    ) {
      throw serviceError(
        "wakeflow-demand-artifact-service-craft",
        "completed non-Test TargetResult must map every package-required acceptance anchor exactly once",
      );
    }
  }
  if (targetResult.outcome === "completed" && assignedRepositoryId !== null) {
    const disposition = targetResult.repositoryChanges[0].disposition;
    if (
      (taskPackage.commitExpectation === "commit" && disposition !== "committed")
      || (taskPackage.commitExpectation === "leave-uncommitted" && disposition === "committed")
    ) {
      throw serviceError(
        "wakeflow-demand-artifact-service-repository",
        "completed TargetResult repository disposition must satisfy the task package commit expectation",
      );
    }
  }
  assertObservedEvent(loaded, targetResult.observedState, "TargetResult observedState");
  const current = task.currentResult ?? null;
  // current会改变state selector；historical只保留迟到/更正证据，不能接管任务当前结果。
  if (selection === "current") {
    if (current) {
      if (!["blocked", "dispatched", "needs-rework", "review-ready", "waiting-result"].includes(task.lifecycleStatus)) {
        throw serviceError(
          "wakeflow-demand-artifact-service-target-task",
          `corrected current result is not admissible while target task is ${task.lifecycleStatus}`,
        );
      }
      const currentRecord = loadDemandArtifactByRef({
        stateRoot: loaded.paths.stateRoot,
        ref: current.ref,
        digest: current.digest,
        expectedArtifactKind: "wakeflow-target-result",
        expectedArtifactId: current.targetResultId,
        expectedProgramId: loaded.demand.programId,
        expectedDemandId: loaded.demand.demandId,
      }).record;
      const sameEnvelopeRound = (
        currentRecord.taskPackage.taskPackageId === targetResult.taskPackage.taskPackageId
        && currentRecord.taskPackage.ref === targetResult.taskPackage.ref
        && currentRecord.taskPackage.digest === targetResult.taskPackage.digest
        && currentRecord.transport.group.id === targetResult.transport.group.id
        && currentRecord.transport.group.ref === targetResult.transport.group.ref
        && currentRecord.transport.group.digest === targetResult.transport.group.digest
        && currentRecord.transport.envelope.id === targetResult.transport.envelope.id
        && currentRecord.transport.envelope.ref === targetResult.transport.envelope.ref
        && currentRecord.transport.envelope.digest === targetResult.transport.envelope.digest
      );
      if (sameEnvelopeRound) {
        if (
          !targetResult.supersedes
          || targetResult.supersedes.targetResultId !== current.targetResultId
          || targetResult.supersedes.ref !== current.ref
          || targetResult.supersedes.digest !== current.digest
        ) {
          throw serviceError("wakeflow-demand-artifact-service-supersedes", "same-envelope corrected current result must supersede the exact selected result tuple");
        }
      } else if (targetResult.supersedes) {
        throw serviceError(
          "wakeflow-demand-artifact-service-supersedes",
          "a new delivery-envelope round must not supersede the prior round result",
        );
      }
      const prior = stateArtifacts.targetResults.find((entry) => entry.targetResultId === current.targetResultId);
      prior.lifecycleStatus = "historical";
    } else {
      if (!["dispatched", "waiting-result"].includes(task.lifecycleStatus)) {
        throw serviceError(
          "wakeflow-demand-artifact-service-target-task",
          `first current result requires dispatched/waiting-result task, not ${task.lifecycleStatus}`,
        );
      }
      if (targetResult.supersedes) {
        throw serviceError("wakeflow-demand-artifact-service-supersedes", "first current result cannot declare supersedes");
      }
    }
  } else if (targetResult.supersedes) {
    const supersededState = stateArtifacts.targetResults.find((entry) => (
      entry.targetResultId === targetResult.supersedes.targetResultId
      && entry.targetTaskId === targetResult.targetTaskId
      && entry.ref === targetResult.supersedes.ref
      && entry.digest === targetResult.supersedes.digest
    ));
    if (!supersededState || supersededState.lifecycleStatus !== "historical") {
      throw serviceError(
        "wakeflow-demand-artifact-service-supersedes",
        "historical result may supersede only an exact committed historical result tuple",
      );
    }
    const superseded = loadDemandArtifactByRef({
      stateRoot: loaded.paths.stateRoot,
      ref: targetResult.supersedes.ref,
      digest: targetResult.supersedes.digest,
      expectedArtifactKind: "wakeflow-target-result",
      expectedArtifactId: targetResult.supersedes.targetResultId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
    }).record;
    if (superseded.targetTaskId !== targetResult.targetTaskId) {
      throw serviceError(
        "wakeflow-demand-artifact-service-supersedes",
        "historical result may supersede only a result for the same target task",
      );
    }
    if (
      superseded.taskPackage.taskPackageId !== targetResult.taskPackage.taskPackageId
      || superseded.taskPackage.ref !== targetResult.taskPackage.ref
      || superseded.taskPackage.digest !== targetResult.taskPackage.digest
      || superseded.transport.group.id !== targetResult.transport.group.id
      || superseded.transport.group.ref !== targetResult.transport.group.ref
      || superseded.transport.group.digest !== targetResult.transport.group.digest
      || superseded.transport.envelope.id !== targetResult.transport.envelope.id
      || superseded.transport.envelope.ref !== targetResult.transport.envelope.ref
      || superseded.transport.envelope.digest !== targetResult.transport.envelope.digest
    ) {
      throw serviceError(
        "wakeflow-demand-artifact-service-supersedes",
        "historical correction must remain in the exact same package, group, and envelope round",
      );
    }
  }
  stateArtifacts.targetResults.push({
    targetResultId: targetResult.targetResultId,
    targetTaskId: targetResult.targetTaskId,
    ref: identity.ref,
    digest: identity.digest,
    lifecycleStatus: selection,
  });
  sortBy(stateArtifacts.targetResults, "targetResultId");
  if (selection === "current") {
    task.currentResult = {
      targetResultId: targetResult.targetResultId,
      ref: identity.ref,
      digest: identity.digest,
    };
    task.lifecycleStatus = targetResult.outcome === "blocked" ? "blocked" : "review-ready";
  }
  const event = buildEvent({
    loaded,
    transition: tx,
    identity,
    command,
    type,
    to: loaded.state.state,
  });
  const nextState = buildNextState({ loaded, event, artifacts: stateArtifacts });
  return commit({ loadedContext, artifact: targetResult, transition: tx, event, nextState });
}

// ==================== 七、ReviewCandidate 准入 ====================

/**
 * 把当前 state 已选择的结果与完整 eligible scope 冻结为唯一 pending review candidate。
 */
export function createReviewCandidateArtifact(value = {}) {
  const input = normalizeServiceInput(value, [
    "stateRoot",
    "expectedProgramId",
    "expectedPrevious",
    "artifact",
    "transition",
  ], ["ledgerRoot"], "createReviewCandidateArtifact input");
  const {
    stateRoot,
    expectedProgramId,
    ledgerRoot = null,
    expectedPrevious,
    artifact,
    transition,
  } = input;
  const reviewCandidate = validateReviewCandidateArtifact(artifact);
  const tx = normalizeTransition(transition);
  const loadedContext = contextWithLedger(loadCurrent({
    stateRoot,
    expectedProgramId,
    ledgerRoot,
    expectedPrevious,
  }), ledgerRoot);
  const { loaded } = loadedContext;
  const command = "create-review-candidate";
  const type = "review-candidate.created";
  validateArtifactDemandBinding(reviewCandidate, loaded, tx);
  const identity = demandArtifactIdentity(reviewCandidate);
  const existing = existingArtifactResult({ loaded, identity, transition: tx, command, type });
  if (existing) return existing;
  assertExpectedPrevious(loadedContext);
  assertMutableDemandState(loaded, "review candidate creation");
  if (
    reviewCandidate.fromState.revision !== loaded.state.revision
    || reviewCandidate.fromState.stateDigest !== loaded.digests.state
    || reviewCandidate.fromState.eventId !== loaded.state.lastEvent.eventId
    || reviewCandidate.fromState.eventDigest !== loaded.state.lastEvent.eventDigest
  ) {
    throw serviceError("wakeflow-demand-artifact-service-stale-candidate", "review candidate must bind the exact current state and event tail");
  }
  const stateArtifacts = artifactStateShape(loaded.state);
  if (stateArtifacts.review.status === "pending") {
    throw serviceError("wakeflow-demand-artifact-service-review", "one pending review candidate must be decided before another is created");
  }
  const tasks = new Map(stateArtifacts.targetTasks.map((entry) => [entry.targetTaskId, entry]));
  const eligibleTaskIds = stateArtifacts.targetTasks
    .filter((entry) => !["accepted", "cancelled", "superseded"].includes(entry.lifecycleStatus))
    .map((entry) => entry.targetTaskId)
    .sort((left, right) => left.localeCompare(right));
  const declaredTaskIds = [
    ...reviewCandidate.reviewScope.targetTaskIds,
    ...reviewCandidate.reviewScope.excludedTargetTaskIds,
  ].sort((left, right) => left.localeCompare(right));
  if (
    eligibleTaskIds.length !== declaredTaskIds.length
    || eligibleTaskIds.some((targetTaskId, index) => targetTaskId !== declaredTaskIds[index])
  ) {
    throw serviceError(
      "wakeflow-demand-artifact-service-review",
      "review scope plus excluded tasks must cover the exact current eligible target-task set",
    );
  }
  for (const targetTaskId of reviewCandidate.reviewScope.targetTaskIds) {
    if (!tasks.has(targetTaskId)) {
      throw serviceError("wakeflow-demand-artifact-service-review", `review scope contains missing target task ${targetTaskId}`);
    }
  }
  for (const resultTuple of reviewCandidate.results) {
    const task = tasks.get(resultTuple.targetTaskId);
    if (
      !task?.currentResult
      || !["blocked", "review-ready"].includes(task.lifecycleStatus)
      || task.currentResult.targetResultId !== resultTuple.targetResultId
      || task.currentResult.ref !== resultTuple.ref
      || task.currentResult.digest !== resultTuple.digest
    ) {
      throw serviceError("wakeflow-demand-artifact-service-review", "review candidate result set must equal state-selected current result tuples");
    }
    const result = loadDemandArtifactByRef({
      stateRoot: loaded.paths.stateRoot,
      ref: resultTuple.ref,
      digest: resultTuple.digest,
      expectedArtifactKind: "wakeflow-target-result",
      expectedArtifactId: resultTuple.targetResultId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
    }).record;
    if (result.targetTaskId !== resultTuple.targetTaskId || result.outcome !== resultTuple.outcome) {
      throw serviceError("wakeflow-demand-artifact-service-review", "review candidate result tuple differs from immutable result bytes");
    }
  }
  for (const targetTaskId of reviewCandidate.missingTargetTaskIds) {
    const task = tasks.get(targetTaskId);
    if (!task || !["needs-rework", "planned", "dispatched", "waiting-result"].includes(task.lifecycleStatus)) {
      throw serviceError(
        "wakeflow-demand-artifact-service-review",
        `missing task ${targetTaskId} must be awaiting a newly admissible result`,
      );
    }
  }
  for (const targetTaskId of reviewCandidate.readyTargetTaskIds) {
    const tuple = reviewCandidate.results.find((entry) => entry.targetTaskId === targetTaskId);
    if (!tuple || tuple.outcome === "blocked" || tasks.get(targetTaskId)?.lifecycleStatus !== "review-ready") {
      throw serviceError(
        "wakeflow-demand-artifact-service-review",
        `ready task ${targetTaskId} must have a non-blocked immutable result`,
      );
    }
  }
  for (const targetTaskId of reviewCandidate.blockedTargetTaskIds) {
    const tuple = reviewCandidate.results.find((entry) => entry.targetTaskId === targetTaskId);
    if (!tuple || tuple.outcome !== "blocked" || tasks.get(targetTaskId)?.lifecycleStatus !== "blocked") {
      throw serviceError(
        "wakeflow-demand-artifact-service-review",
        `blocked task ${targetTaskId} must have a blocked immutable result`,
      );
    }
  }
  stateArtifacts.review = {
    status: "pending",
    readyTargetTaskIds: [...reviewCandidate.readyTargetTaskIds],
    blockedTargetTaskIds: [...reviewCandidate.blockedTargetTaskIds],
    missingTargetTaskIds: [...reviewCandidate.missingTargetTaskIds],
    pendingCandidate: {
      reviewCandidateId: reviewCandidate.reviewCandidateId,
      ref: identity.ref,
      digest: identity.digest,
    },
  };
  const event = buildEvent({
    loaded,
    transition: tx,
    identity,
    command,
    type,
    to: "review-ready",
  });
  const nextState = buildNextState({ loaded, event, artifacts: stateArtifacts });
  return commit({ loadedContext, artifact: reviewCandidate, transition: tx, event, nextState });
}

// ==================== 八、全部六类 artifact 的事件闭包库存 ====================

/**
 * 在 state-root lock 内以 Controller event 为预期来源诊断全部六类 artifact。
 */
export function inventoryDemandArtifacts(value = {}) {
  const input = normalizeServiceInput(value, [
    "stateRoot",
    "expectedProgramId",
  ], ["ledgerRoot"], "inventoryDemandArtifacts input");
  const {
    stateRoot,
    expectedProgramId,
    ledgerRoot = null,
  } = input;
  const programId = assertTypedId(expectedProgramId, "program", "expectedProgramId");
  return withStateRootLock(stateRoot, () => {
    const loaded = loadDemandCoreRecordsWhileLocked({
      stateRoot,
      expectedProgramId: programId,
      ledgerRoot,
    });
    const expectedArtifacts = loaded.events.flatMap((event) => event.changedArtifacts.filter(
      (entry) => DEMAND_ARTIFACT_KIND_SET.has(entry.artifactKind),
    ));
    return inspectDemandArtifactInventory({
      stateRoot: loaded.paths.stateRoot,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
      expectedArtifacts,
    });
  });
}
