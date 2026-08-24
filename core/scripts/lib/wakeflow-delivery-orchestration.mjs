/**
 * Target delivery 编排边界。
 *
 * 本模块把一次目标投递拆成五个明确阶段：
 * 1. plan：联合 demand、artifact、binding、lease 与 transport authority 生成可重算计划；
 * 2. apply：先发布 immutable group/packet/envelope，再取得精确 lease，最后逐成员提交 prepared state；
 * 3. claim：提交唯一 send-claimed 状态，签发只允许一次宿主 effect 的 send permit；
 * 4. outcome：记录 immutable run，再提交 settlement state；仅 rejected-before-send 会释放 lease；
 * 5. rearm：证明精确 rejected tail 后复用原 envelope、换发 lease 并递增 send generation。
 *
 * 本模块不执行真实宿主发送，不拥有 transport/lease/state 的物理格式，也不把 transport accepted
 * 解释为 TargetResult、审查接受或需求完成。跨 owner 写入由既有 store/service 在 mutation gate 内完成。
 */
import { createHash } from "node:crypto";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import {
  demandDeliverySummaryDigest,
  demandTestLineageDigest,
} from "./wakeflow-demand-core-records.mjs";
import { loadDemandArtifactByRef } from "./wakeflow-demand-artifact-records.mjs";
import {
  commitDemandDeliveryTransitionWhileLocked,
  loadDemandCoreRecordsWithArtifactClosureWhileLocked,
  recoverDemandDeliveryTransitionWhileLocked,
} from "./wakeflow-demand-state-service.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  createDeliveryRunRecord,
  createDispatchGroupRecord,
  createDispatchPacketRecord,
  createTargetDeliveryEnvelopeRecord,
  deliveryEnvelopeRef,
  deliveryRunRef,
  dispatchGroupRef,
  dispatchPacketRef,
  validateDeliveryRunAgainstSources,
  validateDeliveryRunChain,
  validateTargetDeliveryEnvelopeAgainstSources,
} from "./wakeflow-transport-records.mjs";
import {
  appendDeliveryRunAdmitted,
  inspectTransportDemandAuthority,
  publishDeliveryEnvelopeAdmitted,
  publishDispatchGroupAdmitted,
  publishDispatchPacketAdmitted,
} from "./wakeflow-transport-store.mjs";
import { inspectWindowBindingInventory } from "./wakeflow-window-binding-service.mjs";
import {
  acquireWindowCoordinationLeaseAdmitted,
  inspectWindowCoordinationLeaseInventory,
  releaseWindowCoordinationLeaseAdmitted,
} from "./wakeflow-window-lease-service.mjs";
import { withStateRootLock } from "./wakeflow-state-lock.mjs";
import { withWakeflowRuntimeMutation } from "./wakeflow-workspace-mutation.mjs";

const PLAN_KIND = "WakeflowTargetDeliveryPlan";
const SEND_PERMIT_KIND = "WakeflowTargetDeliverySendPermit";
const SCHEMA_VERSION = 1;
const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;
const TRANSPORT_POLICY = Object.freeze({
  kind: "direct-thread",
  missingIdentity: "rejected-before-send",
});
const READBACK_POLICY = Object.freeze({ required: true, maxObservations: 1 });
const CONTEXT_POLICIES = new Set([
  "assumed-current",
  "force-refresh",
  "refresh-if-missing",
]);
const RETURN_POLICY_MODES = new Set(["group-ready", "per-target"]);
const TRANSPORT_STATUSES = new Set([
  "accepted",
  "ambiguous",
  "rejected-before-send",
]);
const TIMESTAMP_RE = /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,9})?Z$/u;

export class WakeflowDeliveryOrchestrationError extends Error {
  constructor(code, message, { cause, ...details } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowDeliveryOrchestrationError";
    this.code = code;
    this.details = Object.freeze({ code, ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowDeliveryOrchestrationError(code, message, { ...details, cause });
}

function wrap(scope, cause, message) {
  if (cause instanceof WakeflowDeliveryOrchestrationError) throw cause;
  const causeCode = typeof cause?.code === "string" ? cause.code : "unknown";
  const recoveryRequired = /(?:recovery|durability|journal|ambiguous)/u.test(causeCode);
  fail(
    recoveryRequired
      ? "wakeflow-delivery-orchestration-recovery-required"
      : `wakeflow-delivery-orchestration-${scope}`,
    message,
    { causeCode },
    cause,
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clone(value) {
  return JSON.parse(canonicalJson(value));
}

/**
 * 公开入口在读取任何业务字段前先取得无行为快照，拒绝 accessor、hidden/Symbol 字段和外来原型。
 */
function canonicalDeliveryInput(value, label) {
  try {
    return clone(value);
  } catch (cause) {
    fail(
      "wakeflow-delivery-orchestration-contract",
      `${label} must contain only canonical plain data`,
      { causeCode: typeof cause?.code === "string" ? cause.code : null },
      cause,
    );
  }
}

function frozen(value) {
  return deepFreeze(clone(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, required, optional, label) {
  if (!isPlainObject(value)) {
    fail("wakeflow-delivery-orchestration-contract", `${label} must be one plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) {
    fail("wakeflow-delivery-orchestration-contract", `${label} cannot contain symbol fields`);
  }
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unknown = actual.filter((key) => !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      "wakeflow-delivery-orchestration-contract",
      `${label} has an invalid field set`,
      { missing, unknown },
    );
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-delivery-orchestration-contract",
        `${label}.${key} must be an enumerable data field`,
      );
    }
  }
  return value;
}

function text(value, label, { maxLength = 65_536 } = {}) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || value.trim() !== value
    || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail(
      "wakeflow-delivery-orchestration-contract",
      `${label} must be bounded, trimmed text without disallowed controls`,
    );
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) {
    fail("wakeflow-delivery-orchestration-contract", `${label} must be one UTC timestamp`);
  }
  return value;
}

function typedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, label);
  } catch (cause) {
    wrap("contract", cause, `${label} must be one typed ${type} identity`);
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail("wakeflow-delivery-orchestration-contract", `${label} must be one sha256 digest`);
  }
  return value;
}

function normalizeRoot(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail("wakeflow-delivery-orchestration-contract", `${label} is required`);
  }
  return path.resolve(value);
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

// 会进入计划摘要或持久化记录的顺序统一按 Unicode code unit 比较，不能依赖进程 locale。
function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deterministicId(type, seed) {
  const bytes = createHash("sha256")
    .update(canonicalJson({ type, seed }))
    .digest();
  const uuidBytes = Buffer.from(bytes.subarray(0, 16));
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const hex = uuidBytes.toString("hex");
  return typedId(
    `${type}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`
      + `-${hex.slice(16, 20)}-${hex.slice(20)}`,
    type,
    `generated ${type}`,
  );
}

function deterministicEventId(seed) {
  const typed = deterministicId("delivery", { event: seed });
  return `delivery-event-${typed.slice("delivery_".length)}`;
}

function nextTimestamp(value, ordinal = 1) {
  const next = new Date(Date.parse(value) + ordinal);
  return next.toISOString();
}

function afterLatestTimestamp(...values) {
  return new Date(Math.max(...values.map((value) => Date.parse(value))) + 1).toISOString();
}

function eventAuthority(event) {
  return {
    revision: event.nextRevision,
    eventId: event.eventId,
    eventDigest: canonicalJsonDigest(event),
  };
}

function sourceStateTuple(state) {
  return {
    revision: state.revision,
    stateDigest: canonicalJsonDigest(state),
    eventId: state.lastEvent.eventId,
    eventDigest: state.lastEvent.eventDigest,
  };
}

function groupTuple(group) {
  return {
    groupId: group.groupId,
    ref: dispatchGroupRef({ demandId: group.demandId, groupId: group.groupId }),
    digest: group.groupDigest,
  };
}

function packetTuple(packet) {
  return {
    packetId: packet.packetId,
    ref: dispatchPacketRef({ demandId: packet.demandId, packetId: packet.packetId }),
    digest: packet.packetDigest,
  };
}

function envelopeTuple(envelope) {
  return {
    deliveryId: envelope.deliveryId,
    ref: deliveryEnvelopeRef({
      demandId: envelope.demandId,
      deliveryId: envelope.deliveryId,
    }),
    digest: envelope.envelopeDigest,
  };
}

function runTuple(run) {
  return {
    runId: run.runId,
    ref: deliveryRunRef({ demandId: run.demandId, runId: run.runId }),
    digest: run.runDigest,
    attemptOrdinal: run.attemptOrdinal,
    transportStatus: run.transportStatus,
    readbackStatus: run.readback.status,
  };
}

function leaseTuple(result) {
  return {
    leaseId: result.lease.leaseId,
    ref: result.leaseRef,
    digest: result.lease.leaseDigest,
  };
}

function bindingTuple(binding) {
  return {
    windowId: binding.windowId,
    bindingId: binding.bindingId,
    identityRef: binding.identityRef,
    identityBindingDigest: binding.identityBindingDigest,
  };
}

function deliveryRoutingProjection(envelope) {
  const projection = clone(envelope);
  for (const field of ["deliveryId", "envelopeRef", "envelopeDigest", "createdAt"]) {
    delete projection[field];
  }
  return projection;
}

// 将一个调用方 target request 收敛成计划真正消费的不可变字段集合。
function normalizeTargetRequest(value, index) {
  exactKeys(
    value,
    ["targetTaskId", "prompt", "contextPolicy", "automationRequested"],
    ["restart"],
    `targets[${index}]`,
  );
  const targetTaskId = typedId(value.targetTaskId, "target-task", `targets[${index}].targetTaskId`);
  const contextPolicy = value.contextPolicy;
  if (!CONTEXT_POLICIES.has(contextPolicy)) {
    fail(
      "wakeflow-delivery-orchestration-contract",
      `targets[${index}].contextPolicy is unsupported`,
    );
  }
  if (typeof value.automationRequested !== "boolean") {
    fail(
      "wakeflow-delivery-orchestration-contract",
      `targets[${index}].automationRequested must be boolean`,
    );
  }
  let restart;
  if (Object.hasOwn(value, "restart")) {
    exactKeys(
      value.restart,
      ["conditionIndex", "reason"],
      [],
      `targets[${index}].restart`,
    );
    if (!Number.isSafeInteger(value.restart.conditionIndex) || value.restart.conditionIndex < 0) {
      fail(
        "wakeflow-delivery-orchestration-contract",
        `targets[${index}].restart.conditionIndex must be a non-negative integer`,
      );
    }
    restart = {
      conditionIndex: value.restart.conditionIndex,
      reason: text(value.restart.reason, `targets[${index}].restart.reason`, { maxLength: 1024 }),
    };
  }
  return frozen({
    targetTaskId,
    prompt: text(value.prompt, `targets[${index}].prompt`),
    contextPolicy,
    automationRequested: value.automationRequested,
    ...(restart ? { restart } : {}),
  });
}

function normalizePlanInput(input) {
  exactKeys(
    input,
    [
      "workspaceRoot",
      "stateRoot",
      "expectedProgramId",
      "targets",
      "returnPolicy",
      "createdAt",
    ],
    [],
    "plan input",
  );
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    fail("wakeflow-delivery-orchestration-contract", "targets must be one non-empty array");
  }
  exactKeys(input.returnPolicy, ["mode"], [], "returnPolicy");
  if (!RETURN_POLICY_MODES.has(input.returnPolicy.mode)) {
    fail("wakeflow-delivery-orchestration-contract", "returnPolicy.mode is unsupported");
  }
  const targets = input.targets.map(normalizeTargetRequest).sort((left, right) => (
    lexicalCompare(left.targetTaskId, right.targetTaskId)
  ));
  if (new Set(targets.map((entry) => entry.targetTaskId)).size !== targets.length) {
    fail("wakeflow-delivery-orchestration-contract", "targets cannot repeat a target task");
  }
  return frozen({
    workspaceRoot: normalizeRoot(input.workspaceRoot, "workspaceRoot"),
    stateRoot: normalizeRoot(input.stateRoot, "stateRoot"),
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
    targets,
    returnPolicy: { mode: input.returnPolicy.mode },
    createdAt: timestamp(input.createdAt, "createdAt"),
  });
}

function loadConfig(input) {
  let snapshot;
  try {
    snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: input.workspaceRoot });
  } catch (cause) {
    wrap("config", cause, "strict Wakeflow v3 config is unavailable");
  }
  if (snapshot.model.program.programId !== input.expectedProgramId) {
    fail(
      "wakeflow-delivery-orchestration-config",
      "expectedProgramId does not own the current v3 config",
    );
  }
  if (!snapshot.indexes.controllerWindow) {
    fail("wakeflow-delivery-orchestration-config", "v3 config has no controller window");
  }
  return snapshot;
}

function loadStateWhileLocked(input, config) {
  try {
    return loadDemandCoreRecordsWithArtifactClosureWhileLocked({
      stateRoot: input.stateRoot,
      expectedProgramId: input.expectedProgramId,
      ledgerRoot: config.ledgerRoot,
    });
  } catch (cause) {
    wrap("state", cause, "strict demand state authority is unavailable");
  }
}

function loadBindingInventory(workspaceRoot, config) {
  let inventory;
  try {
    inventory = inspectWindowBindingInventory({ workspaceRoot });
  } catch (cause) {
    wrap("binding", cause, "strict current window binding inventory is unavailable");
  }
  if (
    inventory.programId !== config.model.program.programId
    || inventory.configDigest !== config.configDigest
  ) {
    fail(
      "wakeflow-delivery-orchestration-binding",
      "window binding inventory does not match the exact config authority",
    );
  }
  return inventory;
}

function loadLeaseInventory(workspaceRoot) {
  try {
    return inspectWindowCoordinationLeaseInventory({ workspaceRoot });
  } catch (cause) {
    wrap("lease", cause, "strict window coordination lease inventory is unavailable");
  }
}

function loadTransportInventory(workspaceRoot, programId, demandId) {
  try {
    return inspectTransportDemandAuthority({ workspaceRoot, programId, demandId });
  } catch (cause) {
    wrap("transport", cause, "strict demand transport inventory is unavailable");
  }
}

function exactArtifact(stateRoot, summary, expected) {
  try {
    return loadDemandArtifactByRef({
      stateRoot,
      ref: summary.ref,
      digest: summary.digest,
      expectedArtifactKind: expected.kind,
      expectedArtifactId: expected.id,
      expectedProgramId: expected.programId,
      expectedDemandId: expected.demandId,
    }).record;
  } catch (cause) {
    wrap("artifact", cause, `immutable ${expected.kind} source is unavailable`);
  }
}

function currentBinding(inventory, windowId) {
  const matches = inventory.bindings.filter((binding) => binding.windowId === windowId);
  if (matches.length !== 1) {
    fail(
      "wakeflow-delivery-orchestration-binding",
      `target window ${windowId} requires exactly one current redacted binding`,
    );
  }
  return matches[0];
}

function transportEntry(inventory, kind, idField, id) {
  return inventory.entries[kind].find((entry) => entry.record[idField] === id) ?? null;
}

function assertAvailableTransportRecord(inventory, kind, idField, record) {
  const existing = transportEntry(inventory, kind, idField, record[idField]);
  if (existing && !same(existing.record, record)) {
    fail(
      "wakeflow-delivery-orchestration-transport",
      `${kind} ${record[idField]} already exists with different immutable bytes`,
    );
  }
}

function packetFromPackage({
  packageRecord,
  testCard,
  group,
  packetId,
  request,
  createdAt,
}) {
  return createDispatchPacketRecord({
    programId: packageRecord.programId,
    demandId: packageRecord.demandId,
    groupId: group.groupId,
    groupDigest: group.groupDigest,
    packetId,
    windowId: packageRecord.windowId,
    targetTaskId: packageRecord.targetTaskId,
    taskPackageId: packageRecord.taskPackageId,
    taskPackageDigest: canonicalJsonDigest(packageRecord),
    objective: packageRecord.objective,
    taskBriefing: {
      workType: packageRecord.workType,
      confirmedContext: packageRecord.confirmedContext,
      completionExpectations: packageRecord.completionExpectations,
      requiredSkills: packageRecord.workType === "test"
        ? ["skills/wakeflow-target/SKILL.md", "skills/wakeflow-test/SKILL.md"]
        : ["skills/wakeflow-target/SKILL.md", "skills/wakeflow-target-craft/SKILL.md"],
      ...(packageRecord.workType === "test"
        ? {}
        : { commitExpectation: packageRecord.commitExpectation }),
    },
    boundaries: packageRecord.boundaries,
    acceptanceAnchors: packageRecord.acceptanceAnchors,
    ...(packageRecord.designIntent ? { designIntent: packageRecord.designIntent } : {}),
    reviewInputContract: packageRecord.reviewInputContract,
    resultContract: { artifactKind: "wakeflow-target-result", schemaVersion: 1 },
    ...(testCard ? {
      testContract: {
        testCard: packageRecord.testCard,
        executionContract: testCard.executionContract,
      },
    } : {}),
    contextPolicy: request.contextPolicy,
    prompt: request.prompt,
    createdAt,
  });
}

function validateAssignment(config, task, packageRecord) {
  const window = config.indexes.windowById[task.windowId];
  if (!window || window.windowId !== packageRecord.windowId) {
    fail("wakeflow-delivery-orchestration-config", "target assignment is absent from v3 topology");
  }
  if (packageRecord.workType === "test") {
    if (window.role !== "test" || Object.hasOwn(task, "repositoryId")) {
      fail("wakeflow-delivery-orchestration-config", "Test package must target the configured Test window");
    }
    return;
  }
  if (
    window.role !== "product"
    || window.root.kind !== "repository"
    || window.root.repositoryId !== packageRecord.repositoryId
    || task.repositoryId !== packageRecord.repositoryId
  ) {
    fail(
      "wakeflow-delivery-orchestration-config",
      "non-Test package must target its exact configured product repository window",
    );
  }
}

function assertSettledDeliveryRunTail(transportInventory, task) {
  const delivery = task.currentDelivery;
  if (!delivery || !TRANSPORT_STATUSES.has(delivery.phase) || delivery.phase === "send-claimed") {
    return;
  }
  const runs = transportInventory.entries.runs
    .map((entry) => entry.record)
    .filter((run) => run.deliveryId === delivery.envelope.deliveryId)
    .sort((left, right) => left.attemptOrdinal - right.attemptOrdinal);
  const tail = runs.at(-1) ?? null;
  if (
    !tail
    || !delivery.latestRun
    || !same(runTuple(tail), delivery.latestRun)
    || tail.envelopeDigest !== delivery.envelope.digest
    || tail.attemptOrdinal !== delivery.sendGeneration
    || tail.transportStatus !== delivery.phase
  ) {
    fail(
      "wakeflow-delivery-orchestration-transport",
      "settled current delivery does not retain its exact immutable run-chain tail",
    );
  }
}

function assertPreviousTestResultClosure({ stateRoot, programId, demandId, task }) {
  const result = exactArtifact(stateRoot, task.currentResult, {
    kind: "wakeflow-target-result",
    id: task.currentResult.targetResultId,
    programId,
    demandId,
  });
  const previousAttempt = task.testAttempts.at(-1);
  const previousAuthorization = previousAttempt?.deliveryAuthorizations.at(-1);
  const previousDelivery = task.currentDelivery;
  if (
    !previousAuthorization
    || !previousDelivery?.latestRun
    || !["accepted", "ambiguous"].includes(previousDelivery.latestRun.transportStatus)
    || result.targetTaskId !== task.targetTaskId
    || result.taskPackage.taskPackageId !== task.taskPackageId
    || result.assignment.windowId !== task.windowId
    || result.transport.group.id !== previousAuthorization.group.groupId
    || result.transport.group.ref !== previousAuthorization.group.ref
    || result.transport.group.digest !== previousAuthorization.group.digest
    || result.transport.envelope.id !== previousAuthorization.envelope.deliveryId
    || result.transport.envelope.ref !== previousAuthorization.envelope.ref
    || result.transport.envelope.digest !== previousAuthorization.envelope.digest
    || !same(previousDelivery.group, previousAuthorization.group)
    || !same(previousDelivery.packet, previousAuthorization.packet)
    || !same(previousDelivery.envelope, previousAuthorization.envelope)
  ) {
    fail(
      "wakeflow-delivery-orchestration-test-attempt",
      "later Test attempt requires the exact current result from the preceding authorization",
    );
  }
  return result;
}

function deriveTestIntent({
  task,
  card,
  request,
  seed,
  stateRoot,
  programId,
  demandId,
}) {
  if (!Object.hasOwn(task, "testCard")) return null;
  const attempts = task.testAttempts;
  const previousDelivery = task.currentDelivery ?? null;
  if (previousDelivery?.phase === "rejected-before-send") {
    if (Object.hasOwn(request, "restart")) {
      fail(
        "wakeflow-delivery-orchestration-test-attempt",
        "rejected-before-send envelope replacement cannot consume a new Test attempt",
      );
    }
    const currentAttempt = attempts.at(-1);
    if (!currentAttempt || currentAttempt.testAttemptId !== previousDelivery.testAttemptId) {
      fail(
        "wakeflow-delivery-orchestration-test-attempt",
        "rejected Test delivery has no exact current logical attempt",
      );
    }
    return frozen({
      kind: "replacement-authorization",
      testAttemptId: currentAttempt.testAttemptId,
    });
  }
  if (attempts.length >= card.executionContract.maxAttempts) {
    fail(
      "wakeflow-delivery-orchestration-test-attempt",
      "Test logical attempt limit is exhausted",
    );
  }
  if (attempts.length === 0) {
    if (Object.hasOwn(request, "restart")) {
      fail(
        "wakeflow-delivery-orchestration-test-attempt",
        "initial Test attempt cannot carry restart authorization",
      );
    }
    return frozen({
      kind: "new-attempt",
      testAttemptId: deterministicId("test-attempt", { seed, ordinal: 1 }),
      ordinal: 1,
      mode: "initial",
    });
  }
  if (
    !previousDelivery
    || !["accepted", "ambiguous"].includes(previousDelivery.phase)
    || task.lifecycleStatus !== "needs-rework"
    || !task.currentResult
  ) {
    fail(
      "wakeflow-delivery-orchestration-test-attempt",
      "later Test attempt requires accepted or ambiguous delivery plus exact current rework result",
    );
  }
  assertPreviousTestResultClosure({ stateRoot, programId, demandId, task });
  const ordinal = attempts.length + 1;
  if (card.executionContract.setupPolicy === "fresh-per-attempt") {
    if (!Object.hasOwn(request, "restart")) {
      fail(
        "wakeflow-delivery-orchestration-test-attempt",
        "fresh-per-attempt Test requires explicit indexed restart authorization",
      );
    }
    const condition = card.executionContract.restartConditions[request.restart.conditionIndex];
    if (condition === undefined) {
      fail(
        "wakeflow-delivery-orchestration-test-attempt",
        "Test restart condition index is outside the immutable TestCard",
      );
    }
    return frozen({
      kind: "new-attempt",
      testAttemptId: deterministicId("test-attempt", { seed, ordinal }),
      ordinal,
      mode: "restart",
      restart: {
        conditionIndex: request.restart.conditionIndex,
        condition,
        reason: request.restart.reason,
      },
    });
  }
  if (Object.hasOwn(request, "restart")) {
    fail(
      "wakeflow-delivery-orchestration-test-attempt",
      "non-fresh Test continuation uses resume and cannot invent restart authorization",
    );
  }
  return frozen({
    kind: "new-attempt",
    testAttemptId: deterministicId("test-attempt", { seed, ordinal }),
    ordinal,
    mode: "resume",
  });
}

/**
 * 从一个已持锁的 demand 快照推导完整计划。
 * 它闭合任务/包/TestCard、依赖、binding、旧投递尾链与现有 lease，但不产生任何写入。
 */
function derivePlanFromLoaded(input, config, loaded) {
  if (Date.parse(input.createdAt) <= Date.parse(loaded.state.updatedAt)) {
    fail(
      "wakeflow-delivery-orchestration-state",
      "delivery plan createdAt must be later than the current demand state",
    );
  }
  if (loaded.state.review.status !== "idle") {
    fail("wakeflow-delivery-orchestration-state", "delivery planning requires idle review authority");
  }
  if (!["planned", "dispatched", "needs-rework"].includes(loaded.state.state)) {
    fail(
      "wakeflow-delivery-orchestration-state",
      `demand state ${loaded.state.state} cannot prepare target delivery`,
    );
  }
  const bindingInventory = loadBindingInventory(input.workspaceRoot, config);
  const leaseInventory = loadLeaseInventory(input.workspaceRoot);
  const transportInventory = loadTransportInventory(
    input.workspaceRoot,
    input.expectedProgramId,
    loaded.demand.demandId,
  );
  const taskById = new Map(loaded.state.targetTasks.map((task) => [task.targetTaskId, task]));
  const packageById = new Map(loaded.state.taskPackages.map((entry) => [entry.taskPackageId, entry]));
  const contexts = [];
  for (const request of input.targets) {
    const task = taskById.get(request.targetTaskId);
    if (!task) {
      fail("wakeflow-delivery-orchestration-state", `unknown target task ${request.targetTaskId}`);
    }
    if (!task.currentDelivery && task.lifecycleStatus !== "planned") {
      fail(
        "wakeflow-delivery-orchestration-state",
        `first delivery for ${task.targetTaskId} requires planned lifecycle`,
      );
    }
    if (task.currentDelivery) {
      const replaceRejected = task.currentDelivery.phase === "rejected-before-send"
        && ["dispatched", "needs-rework"].includes(task.lifecycleStatus);
      const continueRework = ["accepted", "ambiguous"].includes(task.currentDelivery.phase)
        && task.lifecycleStatus === "needs-rework";
      if (!replaceRejected && !continueRework) {
        fail(
          "wakeflow-delivery-orchestration-state",
          `target ${task.targetTaskId} cannot authorize a new immutable envelope`,
        );
      }
    }
    if (!packageById.has(task.taskPackageId)) {
      fail(
        "wakeflow-delivery-orchestration-state",
        `missing active package ${task.taskPackageId}`,
      );
    }
    const packageSummary = packageById.get(task.taskPackageId);
    if (packageSummary.lifecycleStatus !== "active") {
      fail("wakeflow-delivery-orchestration-state", "target package is not active");
    }
    const packageRecord = exactArtifact(input.stateRoot, packageSummary, {
      kind: "wakeflow-task-package",
      id: task.taskPackageId,
      programId: input.expectedProgramId,
      demandId: loaded.demand.demandId,
    });
    if (
      packageRecord.targetTaskId !== task.targetTaskId
      || packageRecord.windowId !== task.windowId
    ) {
      fail("wakeflow-delivery-orchestration-artifact", "TaskPackage assignment differs from state");
    }
    for (const dependencyId of packageRecord.dependsOnTargetTaskIds) {
      if (taskById.get(dependencyId)?.lifecycleStatus !== "accepted") {
        fail(
          "wakeflow-delivery-orchestration-state",
          `target dependency ${dependencyId} is not accepted`,
        );
      }
    }
    validateAssignment(config, task, packageRecord);
    let card = null;
    if (packageRecord.workType === "test") {
      if (!task.testCard || !same(task.testCard, packageRecord.testCard)) {
        fail("wakeflow-delivery-orchestration-artifact", "Test task does not retain its exact TestCard tuple");
      }
      const cardSummary = loaded.state.testCards.find(
        (entry) => entry.testCardId === task.testCard.testCardId,
      );
      if (!cardSummary || cardSummary.lifecycleStatus !== "active" || !same(cardSummary, {
        ...task.testCard,
        lifecycleStatus: "active",
      })) {
        fail("wakeflow-delivery-orchestration-artifact", "TestCard state summary is not exact and active");
      }
      card = exactArtifact(input.stateRoot, task.testCard, {
        kind: "wakeflow-test-card",
        id: task.testCard.testCardId,
        programId: input.expectedProgramId,
        demandId: loaded.demand.demandId,
      });
      if (card.targetTaskId !== task.targetTaskId || card.windowId !== task.windowId) {
        fail("wakeflow-delivery-orchestration-artifact", "TestCard assignment differs from its Test task");
      }
    }
    const binding = currentBinding(bindingInventory, task.windowId);
    assertSettledDeliveryRunTail(transportInventory, task);
    contexts.push({ request, task, packageSummary, packageRecord, card, binding });
  }
  if (new Set(contexts.map((entry) => entry.task.windowId)).size !== contexts.length) {
    fail("wakeflow-delivery-orchestration-state", "one delivery plan cannot target a window twice");
  }
  const checkoutKeys = contexts
    .filter((entry) => entry.packageRecord.workType !== "test")
    .map((entry) => `main:${entry.packageRecord.repositoryId}`);
  if (new Set(checkoutKeys).size !== checkoutKeys.length) {
    fail(
      "wakeflow-delivery-orchestration-lease",
      "one delivery plan cannot reserve the same main checkout more than once",
    );
  }
  if (
    contexts.length > 1
    && contexts.some((entry) => Object.hasOwn(entry.task, "currentDelivery"))
  ) {
    fail(
      "wakeflow-delivery-orchestration-state",
      "multi-target plan is limited to one fresh immutable dispatch round",
    );
  }
  const source = sourceStateTuple(loaded.state);
  const seed = {
    programId: input.expectedProgramId,
    demandId: loaded.demand.demandId,
    configDigest: config.configDigest,
    source,
    createdAt: input.createdAt,
    returnPolicy: input.returnPolicy,
    targets: contexts.map((entry) => ({
      request: entry.request,
      taskPackageId: entry.packageRecord.taskPackageId,
      taskPackageDigest: canonicalJsonDigest(entry.packageRecord),
      binding: bindingTuple(entry.binding),
      previousDelivery: entry.task.currentDelivery ?? null,
    })),
  };
  const isRejectedReplacement = contexts.length === 1
    && contexts[0].task.currentDelivery?.phase === "rejected-before-send";
  let reusedGroup = null;
  let reusedPacket = null;
  let rejectedEnvelope = null;
  if (isRejectedReplacement) {
    const previous = contexts[0].task.currentDelivery;
    reusedGroup = transportEntry(
      transportInventory,
      "groups",
      "groupId",
      previous.group.groupId,
    )?.record ?? null;
    reusedPacket = transportEntry(
      transportInventory,
      "packets",
      "packetId",
      previous.packet.packetId,
    )?.record ?? null;
    rejectedEnvelope = transportEntry(
      transportInventory,
      "envelopes",
      "deliveryId",
      previous.envelope.deliveryId,
    )?.record ?? null;
    if (
      !reusedGroup
      || !reusedPacket
      || !rejectedEnvelope
      || reusedGroup.groupDigest !== previous.group.digest
      || reusedPacket.packetDigest !== previous.packet.digest
      || rejectedEnvelope.envelopeDigest !== previous.envelope.digest
    ) {
      fail(
        "wakeflow-delivery-orchestration-transport",
        "rejected delivery replacement requires its exact immutable transport sources",
      );
    }
    validateTargetDeliveryEnvelopeAgainstSources({
      envelope: rejectedEnvelope,
      group: reusedGroup,
      packet: reusedPacket,
    });
  }
  const rejectedMember = isRejectedReplacement
    ? reusedGroup.members.find((member) => (
      member.targetTaskId === contexts[0].task.targetTaskId
      && member.windowId === contexts[0].task.windowId
      && member.packetId === reusedPacket.packetId
    )) ?? null
    : null;
  const canReusePacket = isRejectedReplacement
    && rejectedMember !== null
    && deliveryOnlySuffixIsReusable(
      loaded,
      contexts[0].task.targetTaskId,
      contexts[0].task.currentDelivery.recordedBy.revision,
    )
    && reusedPacket.prompt === contexts[0].request.prompt
    && reusedPacket.contextPolicy === contexts[0].request.contextPolicy
    && same(reusedGroup.returnPolicy, input.returnPolicy);
  if (isRejectedReplacement && !canReusePacket && reusedGroup.members.some((member) => {
    if (member.targetTaskId === contexts[0].task.targetTaskId) return false;
    const sibling = loaded.state.targetTasks.find(
      (task) => task.targetTaskId === member.targetTaskId,
    );
    return sibling?.currentDelivery
      && same(sibling.currentDelivery.group, groupTuple(reusedGroup))
      && !["accepted", "ambiguous"].includes(sibling.currentDelivery.phase);
  })) {
    fail(
      "wakeflow-delivery-orchestration-state",
      "rejected member cannot leave a dispatch group while another member still needs that group",
    );
  }
  const groupId = canReusePacket
    ? reusedGroup.groupId
    : deterministicId("dispatch-group", seed);
  const packetIds = contexts.map((entry) => (
    canReusePacket
      ? reusedPacket.packetId
      : deterministicId("dispatch-packet", { seed, targetTaskId: entry.task.targetTaskId })
  ));
  const sortedMembers = contexts.map((entry, index) => ({
    windowId: entry.task.windowId,
    targetTaskId: entry.task.targetTaskId,
    packetId: packetIds[index],
  })).sort((left, right) => (
    lexicalCompare(left.windowId, right.windowId)
      || lexicalCompare(left.targetTaskId, right.targetTaskId)
  ));
  const group = canReusePacket
    ? reusedGroup
    : createDispatchGroupRecord({
      programId: input.expectedProgramId,
      demandId: loaded.demand.demandId,
      groupId,
      stateRevision: loaded.state.revision,
      controllerWindowId: config.indexes.controllerWindow.windowId,
      members: sortedMembers,
      returnPolicy: input.returnPolicy,
      createdAt: input.createdAt,
    });
  const members = [];
  const packets = [];
  const envelopes = [];
  for (const [memberIndex, context] of contexts.entries()) {
    const groupMember = group.members.find(
      (member) => member.targetTaskId === context.task.targetTaskId,
    );
    if (!groupMember) {
      fail(
        "wakeflow-delivery-orchestration-transport",
        "dispatch group does not contain the exact planned target member",
      );
    }
    const packet = canReusePacket
      ? reusedPacket
      : packetFromPackage({
        packageRecord: context.packageRecord,
        testCard: context.card,
        group,
        packetId: groupMember.packetId,
        request: context.request,
        createdAt: input.createdAt,
      });
    const deliveryId = deterministicId("delivery", {
      seed,
      targetTaskId: context.task.targetTaskId,
      envelopeOrdinal: (context.task.testAttempts?.at(-1)?.deliveryAuthorizations.length ?? 0) + 1,
    });
    const envelope = createTargetDeliveryEnvelopeRecord({
      programId: input.expectedProgramId,
      demandId: loaded.demand.demandId,
      deliveryId,
      groupId: group.groupId,
      groupDigest: group.groupDigest,
      packetId: packet.packetId,
      packetDigest: packet.packetDigest,
      preparedByHostId: bindingInventory.hostId,
      windowId: context.task.windowId,
      bindingId: context.binding.bindingId,
      identityBindingDigest: context.binding.identityBindingDigest,
      prompt: packet.prompt,
      oneShot: true,
      transportPolicy: TRANSPORT_POLICY,
      readbackPolicy: READBACK_POLICY,
      automationRequested: context.request.automationRequested,
      createdAt: input.createdAt,
    });
    validateTargetDeliveryEnvelopeAgainstSources({ envelope, group, packet });
    if (
      isRejectedReplacement
      && same(
        deliveryRoutingProjection(rejectedEnvelope),
        deliveryRoutingProjection(envelope),
      )
    ) {
      fail(
        "wakeflow-delivery-orchestration-state",
        "unchanged rejected envelope must use explicit same-envelope rearm",
      );
    }
    const testIntent = deriveTestIntent({
      task: context.task,
      card: context.card,
      request: context.request,
      seed: { seed, targetTaskId: context.task.targetTaskId },
      stateRoot: input.stateRoot,
      programId: input.expectedProgramId,
      demandId: loaded.demand.demandId,
    });
    members.push({
      targetTaskId: context.task.targetTaskId,
      windowId: context.task.windowId,
      taskPackage: {
        taskPackageId: context.packageRecord.taskPackageId,
        ref: context.packageSummary.ref,
        digest: context.packageSummary.digest,
      },
      binding: bindingTuple(context.binding),
      packetId: packet.packetId,
      deliveryId: envelope.deliveryId,
      preparedEventId: deterministicEventId({
        seed,
        targetTaskId: context.task.targetTaskId,
        deliveryId: envelope.deliveryId,
      }),
      eventCreatedAt: nextTimestamp(input.createdAt, memberIndex + 1),
      sourceState: canReusePacket && isRejectedReplacement
        ? context.task.currentDelivery.sourceState
        : source,
      ...(testIntent ? { testIntent } : {}),
    });
    packets.push(packet);
    envelopes.push(envelope);
  }
  assertAvailableTransportRecord(transportInventory, "groups", "groupId", group);
  for (const packet of packets) {
    assertAvailableTransportRecord(transportInventory, "packets", "packetId", packet);
  }
  for (const envelope of envelopes) {
    assertAvailableTransportRecord(transportInventory, "envelopes", "deliveryId", envelope);
  }
  for (const member of members) {
    const existing = leaseInventory.leases.find((entry) => entry.lease.windowId === member.windowId);
    const envelope = envelopes.find((entry) => entry.deliveryId === member.deliveryId);
    if (existing && ![
      ["demandId", loaded.demand.demandId],
      ["targetTaskId", member.targetTaskId],
      ["groupId", group.groupId],
      ["groupDigest", group.groupDigest],
      ["deliveryId", envelope.deliveryId],
      ["envelopeDigest", envelope.envelopeDigest],
      ["bindingId", member.binding.bindingId],
      ["identityBindingDigest", member.binding.identityBindingDigest],
    ].every(([key, expected]) => existing.lease[key] === expected)) {
      fail(
        "wakeflow-delivery-orchestration-lease",
        `target window ${member.windowId} has a different unresolved coordination lease`,
      );
    }
  }
  const unsigned = {
    kind: PLAN_KIND,
    schemaVersion: SCHEMA_VERSION,
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    programId: input.expectedProgramId,
    demandId: loaded.demand.demandId,
    config: { ref: config.ref, digest: config.configDigest },
    sourceState: { ...source, record: loaded.state },
    bindingInventoryDigest: bindingInventory.inventoryDigest,
    targetRequests: input.targets,
    group,
    packets,
    envelopes,
    members,
    createdAt: input.createdAt,
  };
  return frozen({ ...unsigned, planDigest: canonicalJsonDigest(unsigned) });
}

function derivePlanWhileLocked(input, config) {
  return derivePlanFromLoaded(input, config, loadStateWhileLocked(input, config));
}

/**
 * 只读生成 Target delivery 计划；返回值包含来源 authority 与完整 planDigest，不能直接授权发送。
 */
export function planTargetDelivery(input = {}) {
  const normalized = normalizePlanInput(canonicalDeliveryInput(input, "planTargetDelivery input"));
  const config = loadConfig(normalized);
  return withStateRootLock(normalized.stateRoot, () => (
    derivePlanWhileLocked(normalized, config)
  ));
}

// apply 前先验证 plan 自身摘要与显式 workspace/state/program authority，随后还会在锁内完整重算。
function validatePlanEnvelope(value, expected = {}) {
  if (!isPlainObject(value) || value.kind !== PLAN_KIND || value.schemaVersion !== SCHEMA_VERSION) {
    fail("wakeflow-delivery-orchestration-contract", "plan is not a Wakeflow target delivery plan");
  }
  digest(value.planDigest, "plan.planDigest");
  const unsigned = clone(value);
  delete unsigned.planDigest;
  if (canonicalJsonDigest(unsigned) !== value.planDigest) {
    fail("wakeflow-delivery-orchestration-contract", "planDigest does not cover the exact plan payload");
  }
  if (
    value.workspaceRoot !== expected.workspaceRoot
    || value.stateRoot !== expected.stateRoot
    || value.programId !== expected.expectedProgramId
  ) {
    fail("wakeflow-delivery-orchestration-stale-plan", "plan belongs to another explicit authority input");
  }
  return frozen(value);
}

function unwrapAdmitted(result, scope) {
  if (result?.outcome === "success") return result.value;
  if (result?.outcome === "rejected") {
    fail(
      `wakeflow-delivery-orchestration-${scope}`,
      result.message ?? `${scope} operation was rejected`,
      { causeCode: result.code ?? "unknown", ...(result.details ?? {}) },
    );
  }
  fail(
    "wakeflow-delivery-orchestration-recovery-required",
    `${scope} operation returned an invalid or ambiguous outcome`,
  );
}

// 调用跨 owner admitted effect，并把抛错/模糊回执标成需要事后 authority 闭包判断的区间。
function callAdmitted(call, scope, tracker, validateSuccess = () => true) {
  tracker.uncertain = true;
  let result;
  try {
    result = call();
  } catch (cause) {
    throw cause;
  }
  if (result?.outcome === "rejected") {
    tracker.uncertain = false;
    return unwrapAdmitted(result, scope);
  }
  if (result?.outcome !== "success") {
    return unwrapAdmitted(result, scope);
  }
  let successIsExact = false;
  try {
    successIsExact = isPlainObject(result.value) && validateSuccess(result.value) === true;
  } catch {
    successIsExact = false;
  }
  if (!successIsExact) {
    fail(
      "wakeflow-delivery-orchestration-recovery-required",
      `${scope} operation returned malformed success evidence`,
    );
  }
  tracker.uncertain = false;
  return result.value;
}

function exactPublicationSuccess(value, record) {
  return ["created", "replayed"].includes(value.status)
    && typeof value.ref === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(value.digest)
    && same(value.record, record);
}

function exactLeaseSuccess(value, statuses, expected) {
  return statuses.includes(value.status)
    && typeof value.leaseRef === "string"
    && isPlainObject(value.lease)
    && Object.entries(expected).every(([key, expectedValue]) => (
      value.lease[key] === expectedValue
    ));
}

// 为一个 plan member 构造 prepared event/state；只生成字节，不负责提交或宿主发送。
function prepareEventAndState({ previousState, member, group, packet, envelope, lease }) {
  const revision = previousState.revision + 1;
  const placeholder = {
    revision,
    eventId: member.preparedEventId,
    eventDigest: ZERO_DIGEST,
  };
  const previousTask = previousState.targetTasks.find(
    (task) => task.targetTaskId === member.targetTaskId,
  );
  if (!previousTask) {
    fail("wakeflow-delivery-orchestration-state", "plan member target disappeared before apply");
  }
  const previousDelivery = previousTask.currentDelivery ?? null;
  const currentDelivery = {
    sourceState: member.sourceState,
    group: groupTuple(group),
    packet: packetTuple(packet),
    envelope: envelopeTuple(envelope),
    lease: leaseTuple(lease),
    phase: "prepared",
    sendGeneration: 1,
    preparedBy: placeholder,
    authorizedBy: placeholder,
    ...(member.testIntent ? { testAttemptId: member.testIntent.testAttemptId } : {}),
  };
  const nextTask = clone(previousTask);
  nextTask.lifecycleStatus = "dispatched";
  nextTask.currentDelivery = currentDelivery;
  if (member.testIntent?.kind === "new-attempt") {
    const authorization = {
      ordinal: 1,
      group: groupTuple(group),
      packet: packetTuple(packet),
      envelope: envelopeTuple(envelope),
      authorizedBy: placeholder,
    };
    const attempt = {
      testAttemptId: member.testIntent.testAttemptId,
      ordinal: member.testIntent.ordinal,
      mode: member.testIntent.mode,
      testCard: nextTask.testCard,
      deliveryAuthorizations: [authorization],
      ...(member.testIntent.ordinal > 1 ? {
        previousAttemptId: previousTask.testAttempts.at(-1).testAttemptId,
        previousResult: previousTask.currentResult,
      } : {}),
      ...(member.testIntent.restart ? { restart: member.testIntent.restart } : {}),
    };
    nextTask.testAttempts = [...previousTask.testAttempts, attempt];
  } else if (member.testIntent?.kind === "replacement-authorization") {
    nextTask.testAttempts = clone(previousTask.testAttempts);
    const attempt = nextTask.testAttempts.at(-1);
    attempt.deliveryAuthorizations.push({
      ordinal: attempt.deliveryAuthorizations.length + 1,
      group: groupTuple(group),
      packet: packetTuple(packet),
      envelope: envelopeTuple(envelope),
      authorizedBy: placeholder,
      replacesRun: previousDelivery.latestRun,
    });
  }
  const nextState = clone(previousState);
  const taskIndex = nextState.targetTasks.findIndex(
    (task) => task.targetTaskId === member.targetTaskId,
  );
  nextState.targetTasks[taskIndex] = nextTask;
  nextState.revision = revision;
  nextState.state = "dispatched";
  nextState.stateReason = "Exact target delivery transport is frozen and authorized.";
  nextState.updatedAt = member.eventCreatedAt;
  const transition = {
    targetTaskId: member.targetTaskId,
    deliveryId: envelope.deliveryId,
    envelopeDigest: envelope.envelopeDigest,
    sendGeneration: 1,
    fromPhase: previousDelivery?.phase ?? null,
    toPhase: "prepared",
    previousSummaryDigest: previousDelivery
      ? demandDeliverySummaryDigest(previousDelivery)
      : null,
    nextSummaryDigest: demandDeliverySummaryDigest(currentDelivery),
    ...(member.testIntent ? {
      testAttemptId: member.testIntent.testAttemptId,
      testLineageDigest: demandTestLineageDigest(nextTask.testAttempts),
    } : {}),
  };
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: member.preparedEventId,
    demandId: envelope.demandId,
    createdAt: member.eventCreatedAt,
    actor: "controller",
    command: "prepare-target-delivery",
    type: "target-delivery.prepared",
    previousRevision: previousState.revision,
    nextRevision: revision,
    from: previousState.state,
    to: "dispatched",
    reason: nextState.stateReason,
    decisionSummary: "Authorize one immutable delivery envelope for pre-send claim.",
    changedArtifacts: [],
    deliveryTransition: transition,
  };
  const authority = eventAuthority(event);
  currentDelivery.preparedBy = authority;
  currentDelivery.authorizedBy = authority;
  if (member.testIntent) {
    nextTask.testAttempts.at(-1).deliveryAuthorizations.at(-1).authorizedBy = authority;
  }
  nextState.lastEvent = { eventId: event.eventId, eventDigest: authority.eventDigest };
  return frozen({ event, nextState, currentDelivery });
}

function normalizeApplyInput(input) {
  exactKeys(
    input,
    ["workspaceRoot", "stateRoot", "expectedProgramId", "plan", "planDigest"],
    [],
    "apply input",
  );
  const normalized = {
    workspaceRoot: normalizeRoot(input.workspaceRoot, "workspaceRoot"),
    stateRoot: normalizeRoot(input.stateRoot, "stateRoot"),
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
    planDigest: digest(input.planDigest, "planDigest"),
  };
  normalized.plan = validatePlanEnvelope(input.plan, normalized);
  if (normalized.plan.planDigest !== normalized.planDigest) {
    fail("wakeflow-delivery-orchestration-stale-plan", "expected planDigest differs from plan bytes");
  }
  return frozen(normalized);
}

function planSourceLoaded(input, loaded) {
  const { sourceState } = input.plan;
  if (
    !isPlainObject(sourceState)
    || !isPlainObject(sourceState.record)
    || !same(sourceStateTuple(sourceState.record), {
      revision: sourceState.revision,
      stateDigest: sourceState.stateDigest,
      eventId: sourceState.eventId,
      eventDigest: sourceState.eventDigest,
    })
  ) {
    fail(
      "wakeflow-delivery-orchestration-stale-plan",
      "plan sourceState tuple does not bind its exact embedded state snapshot",
    );
  }
  const events = loaded.events.slice(0, sourceState.revision);
  const tail = events.at(-1);
  if (
    events.length !== sourceState.revision
    || !tail
    || tail.eventId !== sourceState.eventId
    || canonicalJsonDigest(tail) !== sourceState.eventDigest
  ) {
    fail(
      "wakeflow-delivery-orchestration-stale-plan",
      "plan sourceState is not an exact prefix of current controller event authority",
    );
  }
  return {
    ...loaded,
    state: sourceState.record,
    events,
    digests: {
      ...loaded.digests,
      state: sourceState.stateDigest,
    },
  };
}

function assertPlanExactDerivation(input, config, loaded) {
  const reviewedInput = normalizePlanInput({
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    targets: input.plan.targetRequests,
    returnPolicy: input.plan.group.returnPolicy,
    createdAt: input.plan.createdAt,
  });
  const expected = derivePlanFromLoaded(
    reviewedInput,
    config,
    planSourceLoaded(input, loaded),
  );
  if (!same(expected, input.plan)) {
    fail(
      "wakeflow-delivery-orchestration-stale-plan",
      "plan payload is not the exact derivation of its reviewed inputs and source authority",
    );
  }
}

function assertPlanStaticSourcesWhileLocked(input, config, loaded) {
  const { plan } = input;
  assertPlanExactDerivation(input, config, loaded);
  if (
    config.configDigest !== plan.config.digest
    || config.ref !== plan.config.ref
    || loaded.demand.demandId !== plan.demandId
    || loaded.demand.programId !== plan.programId
  ) {
    fail("wakeflow-delivery-orchestration-stale-plan", "config or demand authority changed after preview");
  }
  const bindingInventory = loadBindingInventory(input.workspaceRoot, config);
  if (bindingInventory.inventoryDigest !== plan.bindingInventoryDigest) {
    fail("wakeflow-delivery-orchestration-stale-plan", "window binding inventory changed after preview");
  }
  const packetById = new Map(plan.packets.map((packet) => [packet.packetId, packet]));
  const envelopeById = new Map(plan.envelopes.map((envelope) => [envelope.deliveryId, envelope]));
  for (const member of plan.members) {
    const task = loaded.state.targetTasks.find(
      (entry) => entry.targetTaskId === member.targetTaskId,
    );
    const packageSummary = loaded.state.taskPackages.find(
      (entry) => entry.taskPackageId === member.taskPackage.taskPackageId,
    );
    if (
      !task
      || !packageSummary
      || packageSummary.ref !== member.taskPackage.ref
      || packageSummary.digest !== member.taskPackage.digest
      || task.taskPackageId !== member.taskPackage.taskPackageId
      || task.windowId !== member.windowId
    ) {
      fail("wakeflow-delivery-orchestration-stale-plan", "task/package assignment changed after preview");
    }
    const packageRecord = exactArtifact(input.stateRoot, member.taskPackage, {
      kind: "wakeflow-task-package",
      id: member.taskPackage.taskPackageId,
      programId: input.expectedProgramId,
      demandId: plan.demandId,
    });
    const packet = packetById.get(member.packetId);
    const envelope = envelopeById.get(member.deliveryId);
    if (
      !packet
      || !envelope
      || canonicalJsonDigest(packageRecord) !== packet.taskPackageDigest
      || packet.taskPackageDigest !== member.taskPackage.digest
      || packet.targetTaskId !== member.targetTaskId
      || envelope.windowId !== member.windowId
    ) {
      fail("wakeflow-delivery-orchestration-stale-plan", "packet/envelope sources changed after preview");
    }
    const binding = currentBinding(bindingInventory, member.windowId);
    if (!same(bindingTuple(binding), member.binding)) {
      fail("wakeflow-delivery-orchestration-stale-plan", "target binding changed after preview");
    }
    if (packet.testContract) {
      const testCard = exactArtifact(input.stateRoot, packet.testContract.testCard, {
        kind: "wakeflow-test-card",
        id: packet.testContract.testCard.testCardId,
        programId: input.expectedProgramId,
        demandId: plan.demandId,
      });
      if (!same(testCard.executionContract, packet.testContract.executionContract)) {
        fail("wakeflow-delivery-orchestration-stale-plan", "TestCard execution contract changed");
      }
    }
  }
  return { bindingInventory, packetById, envelopeById };
}

function admittedPublication(call, input, record, mutationContext, tracker, label) {
  const value = callAdmitted(() => call({
      workspaceRoot: input.workspaceRoot,
      programId: input.expectedProgramId,
      demandId: input.plan.demandId,
      record,
      mutationContext,
    }), "transport", tracker, (candidate) => exactPublicationSuccess(candidate, record));
  if (value.status === "created") tracker.committed = true;
  if (!same(value.record, record)) {
    fail(
      "wakeflow-delivery-orchestration-recovery-required",
      `${label} publication returned different immutable bytes`,
    );
  }
  return value;
}

function acquirePlanLease(input, member, envelope, mutationContext, tracker) {
  const value = callAdmitted(() => acquireWindowCoordinationLeaseAdmitted({
      workspaceRoot: input.workspaceRoot,
      windowId: member.windowId,
      demandId: input.plan.demandId,
      targetTaskId: member.targetTaskId,
      groupId: input.plan.group.groupId,
      groupDigest: input.plan.group.groupDigest,
      deliveryId: envelope.deliveryId,
      envelopeDigest: envelope.envelopeDigest,
      bindingId: member.binding.bindingId,
      identityBindingDigest: member.binding.identityBindingDigest,
      mutationContext,
    }), "lease", tracker, (candidate) => exactLeaseSuccess(
      candidate,
      ["created", "replayed"],
      {
        programId: input.expectedProgramId,
        hostId: envelope.preparedByHostId,
        windowId: member.windowId,
        demandId: input.plan.demandId,
        targetTaskId: member.targetTaskId,
        groupId: input.plan.group.groupId,
        groupDigest: input.plan.group.groupDigest,
        deliveryId: envelope.deliveryId,
        envelopeDigest: envelope.envelopeDigest,
        bindingId: member.binding.bindingId,
        identityBindingDigest: member.binding.identityBindingDigest,
      },
    ));
  if (value.status === "created") tracker.committed = true;
  return value;
}

function assertPlanTransportPrefix(plan, inventory) {
  const ordered = [
    ["groups", "groupId", plan.group],
    ...plan.packets.map((record) => ["packets", "packetId", record]),
    ...plan.envelopes.map((record) => ["envelopes", "deliveryId", record]),
  ];
  let gapSeen = false;
  for (const [kind, idField, record] of ordered) {
    const existing = transportEntry(inventory, kind, idField, record[idField]);
    if (existing && !same(existing.record, record)) {
      fail(
        "wakeflow-delivery-orchestration-transport",
        `${kind} ${record[idField]} already exists with different immutable bytes`,
      );
    }
    if (existing && gapSeen) {
      fail(
        "wakeflow-delivery-orchestration-recovery-required",
        "delivery transport records do not form the exact plan publication prefix",
      );
    }
    if (!existing) gapSeen = true;
  }
  return !gapSeen;
}

function exactPlanLeaseResult(
  input,
  member,
  envelope,
  inventory,
  { requireFresh = true } = {},
) {
  const entry = inventory.leases.find(
    (candidate) => candidate.lease.windowId === member.windowId,
  ) ?? null;
  if (!entry) return null;
  const expected = {
    programId: input.expectedProgramId,
    hostId: envelope.preparedByHostId,
    windowId: member.windowId,
    demandId: input.plan.demandId,
    targetTaskId: member.targetTaskId,
    groupId: input.plan.group.groupId,
    groupDigest: input.plan.group.groupDigest,
    deliveryId: envelope.deliveryId,
    envelopeDigest: envelope.envelopeDigest,
    bindingId: member.binding.bindingId,
    identityBindingDigest: member.binding.identityBindingDigest,
  };
  if (Object.entries(expected).some(([key, value]) => entry.lease[key] !== value)) {
    fail(
      "wakeflow-delivery-orchestration-lease",
      `target window ${member.windowId} has a different unresolved coordination lease`,
    );
  }
  if (requireFresh && Date.parse(entry.lease.expiresAt) <= Date.now()) {
    fail(
      "wakeflow-delivery-orchestration-lease",
      `target window ${member.windowId} has an expired plan coordination lease`,
    );
  }
  return frozen({ status: "replayed", leaseRef: entry.leaseRef, lease: entry.lease });
}

function buildPreparedPlanStates(input, sources, leases) {
  const expectedStates = [input.plan.sourceState.record];
  const prepared = [];
  for (const member of input.plan.members) {
    const lease = leases.get(member.targetTaskId);
    if (!lease) {
      fail(
        "wakeflow-delivery-orchestration-recovery-required",
        "prepared state reconstruction requires every exact plan lease",
      );
    }
    const transition = prepareEventAndState({
      previousState: expectedStates.at(-1),
      member,
      group: input.plan.group,
      packet: sources.packetById.get(member.packetId),
      envelope: sources.envelopeById.get(member.deliveryId),
      lease,
    });
    prepared.push(transition);
    expectedStates.push(transition.nextState);
  }
  return { expectedStates, prepared };
}

function assertPlanLeaseConflictsAbsent(input, config, leaseInventory) {
  for (const member of input.plan.members) {
    const deliveryConflict = leaseInventory.leases.find((entry) => (
      entry.lease.deliveryId === member.deliveryId
      && entry.lease.windowId !== member.windowId
    ));
    if (deliveryConflict) {
      fail(
        "wakeflow-delivery-orchestration-lease",
        `delivery ${member.deliveryId} is already reserved by another window`,
      );
    }
    const window = config.indexes.windowById[member.windowId];
    if (window?.role !== "product" || window.root?.kind !== "repository") continue;
    const checkoutResourceKey = `main:${window.root.repositoryId}`;
    const checkoutConflict = leaseInventory.leases.find((entry) => (
      entry.lease.checkoutResourceKey === checkoutResourceKey
      && entry.lease.windowId !== member.windowId
    ));
    if (checkoutConflict) {
      fail(
        "wakeflow-delivery-orchestration-lease",
        `checkout ${checkoutResourceKey} already has another unresolved coordination lease`,
      );
    }
  }
}

// 接受空前缀或严格的 group→packets→envelopes→leases→prepared-states 前缀，拒绝任何越序残留。
function assertPlanPrewritePrefix(input, loaded, sources, transport, leaseInventory) {
  const transportComplete = assertPlanTransportPrefix(input.plan, transport);
  const leases = new Map();
  let leaseGapSeen = false;
  for (const member of input.plan.members) {
    const lease = exactPlanLeaseResult(
      input,
      member,
      sources.envelopeById.get(member.deliveryId),
      leaseInventory,
    );
    if (lease && leaseGapSeen) {
      fail(
        "wakeflow-delivery-orchestration-recovery-required",
        "coordination leases do not form the exact plan acquisition prefix",
      );
    }
    if (!lease) leaseGapSeen = true;
    else leases.set(member.targetTaskId, lease);
  }
  if (!transportComplete && leases.size > 0) {
    fail(
      "wakeflow-delivery-orchestration-recovery-required",
      "a plan lease exists before the complete immutable transport prefix",
    );
  }
  if (same(loaded.state, input.plan.sourceState.record)) return;
  if (!transportComplete || leases.size !== input.plan.members.length) {
    fail(
      "wakeflow-delivery-orchestration-stale-plan",
      "advanced demand state has no complete local plan authority prefix",
    );
  }
  const { expectedStates } = buildPreparedPlanStates(input, sources, leases);
  const prefixIndex = expectedStates.findIndex((state) => same(state, loaded.state));
  if (prefixIndex < 1) {
    fail(
      "wakeflow-delivery-orchestration-stale-plan",
      "current demand state is not an exact prepared-member prefix of this plan",
    );
  }
}

/**
 * 在 state lock 与 workspace mutation gate 内执行计划。
 * 顺序固定为 transport publication、lease acquisition、逐成员 state commit，便于失败时按前缀恢复。
 */
function applyPlanWhileLocked(input, config, mutationContext, tracker) {
  const loaded = loadStateWhileLocked(input, config);
  rememberFailureBaseline(tracker, input, config, loaded);
  const sources = assertPlanStaticSourcesWhileLocked(input, config, loaded);
  const transport = loadTransportInventory(
    input.workspaceRoot,
    input.expectedProgramId,
    input.plan.demandId,
  );
  const leaseInventory = loadLeaseInventory(input.workspaceRoot);
  assertPlanLeaseConflictsAbsent(input, config, leaseInventory);
  assertPlanPrewritePrefix(input, loaded, sources, transport, leaseInventory);
  admittedPublication(
    publishDispatchGroupAdmitted,
    input,
    input.plan.group,
    mutationContext,
    tracker,
    "dispatch group",
  );
  for (const packet of input.plan.packets) {
    admittedPublication(
      publishDispatchPacketAdmitted,
      input,
      packet,
      mutationContext,
      tracker,
      "dispatch packet",
    );
  }
  for (const envelope of input.plan.envelopes) {
    admittedPublication(
      publishDeliveryEnvelopeAdmitted,
      input,
      envelope,
      mutationContext,
      tracker,
      "delivery envelope",
    );
  }
  const leases = new Map();
  for (const member of input.plan.members) {
    const envelope = sources.envelopeById.get(member.deliveryId);
    leases.set(
      member.targetTaskId,
      acquirePlanLease(input, member, envelope, mutationContext, tracker),
    );
  }
  const { expectedStates, prepared } = buildPreparedPlanStates(input, sources, leases);
  tracker.intendedTransitions = prepared;
  const prefixIndex = expectedStates.findIndex((state) => same(state, loaded.state));
  if (prefixIndex < 0) {
    fail(
      "wakeflow-delivery-orchestration-stale-plan",
      "current demand state is not the exact source or prepared-member prefix of this plan",
    );
  }
  let currentState = expectedStates[prefixIndex];
  for (let index = prefixIndex; index < prepared.length; index += 1) {
    const transition = prepared[index];
    tracker.uncertain = true;
    let commit;
    try {
      commit = commitDemandDeliveryTransitionWhileLocked({
        stateRoot: input.stateRoot,
        expectedProgramId: input.expectedProgramId,
        ledgerRoot: config.ledgerRoot,
        expectedPrevious: {
          revision: currentState.revision,
          stateDigest: canonicalJsonDigest(currentState),
        },
        event: transition.event,
        nextState: transition.nextState,
      });
    } finally {
      if (commit) tracker.uncertain = false;
    }
    tracker.committed = true;
    currentState = transition.nextState;
  }
  const resultMembers = input.plan.members.map((member) => {
    const task = currentState.targetTasks.find(
      (entry) => entry.targetTaskId === member.targetTaskId,
    );
    return {
      targetTaskId: member.targetTaskId,
      packet: packetTuple(sources.packetById.get(member.packetId)),
      envelope: envelopeTuple(sources.envelopeById.get(member.deliveryId)),
      lease: leaseTuple(leases.get(member.targetTaskId)),
      currentDelivery: task.currentDelivery,
    };
  });
  return frozen({
    status: prefixIndex === prepared.length ? "replayed" : "applied",
    planDigest: input.planDigest,
    demandId: input.plan.demandId,
    group: groupTuple(input.plan.group),
    members: resultMembers,
    revision: currentState.revision,
    stateDigest: canonicalJsonDigest(currentState),
  });
}

function safeReleaseVerdict(name, value) {
  return {
    disposition: "safe-to-release",
    closureDigests: [{ name, digest: canonicalJsonDigest(value) }],
  };
}

// 同时捕获 config/state/event/binding/transport/lease，用于证明失败后的跨 owner 最终闭包。
function deliveryFailureSnapshot(input, config, loaded) {
  return frozen({
    configDigest: config.configDigest,
    state: loaded.state,
    stateDigest: canonicalJsonDigest(loaded.state),
    eventsDigest: canonicalJsonDigest(loaded.events),
    bindingInventory: loadBindingInventory(input.workspaceRoot, config),
    transportInventory: loadTransportInventory(
      input.workspaceRoot,
      input.expectedProgramId,
      loaded.demand.demandId,
    ),
    leaseInventory: loadLeaseInventory(input.workspaceRoot),
  });
}

function rememberFailureBaseline(tracker, input, config, loaded) {
  if (tracker.baseline === null || tracker.baseline === undefined) {
    tracker.baseline = deliveryFailureSnapshot(input, config, loaded);
  }
  return tracker.baseline;
}

function assertFailureClosure(condition, message) {
  if (!condition) {
    fail("wakeflow-delivery-orchestration-recovery-required", message);
  }
}

function assertBindingClosure(baseline, current) {
  assertFailureClosure(
    same(baseline.bindingInventory, current.bindingInventory),
    "window binding authority changed across the delivery failure interval",
  );
}

function inventoryEntryByRef(inventory, kind, ref) {
  return inventory.entries[kind].find((entry) => entry.ref === ref) ?? null;
}

function assertTransportBaselinePlus(baseline, current, allowedRecords = []) {
  const allowed = new Set(allowedRecords.map((record) => canonicalJson(record)));
  for (const kind of ["groups", "packets", "envelopes", "runs"]) {
    for (const prior of baseline.transportInventory.entries[kind]) {
      const candidate = inventoryEntryByRef(current.transportInventory, kind, prior.ref);
      assertFailureClosure(
        candidate !== null && same(candidate, prior),
        `transport ${kind} baseline changed or disappeared during failure closure`,
      );
    }
    for (const candidate of current.transportInventory.entries[kind]) {
      const prior = inventoryEntryByRef(baseline.transportInventory, kind, candidate.ref);
      if (prior) continue;
      assertFailureClosure(
        allowed.has(canonicalJson(candidate.record)),
        `transport ${kind} gained an artifact outside the intended delivery operation`,
      );
    }
  }
}

function leaseEntryByWindow(inventory, windowId) {
  return inventory.leases.find((entry) => entry.lease.windowId === windowId) ?? null;
}

function assertUnchangedLeaseWindows(baseline, current, exceptWindowIds = new Set()) {
  const windows = new Set([
    ...baseline.leaseInventory.leases.map((entry) => entry.lease.windowId),
    ...current.leaseInventory.leases.map((entry) => entry.lease.windowId),
  ]);
  for (const windowId of windows) {
    if (exceptWindowIds.has(windowId)) continue;
    assertFailureClosure(
      same(
        leaseEntryByWindow(baseline.leaseInventory, windowId),
        leaseEntryByWindow(current.leaseInventory, windowId),
      ),
      `coordination lease ${windowId} changed outside the intended delivery operation`,
    );
  }
}

function exactPlanLeasePrefix(input, current, { requireComplete = false } = {}) {
  const leases = new Map();
  let gapSeen = false;
  for (const member of input.plan.members) {
    const envelope = input.plan.envelopes.find(
      (entry) => entry.deliveryId === member.deliveryId,
    );
    const lease = exactPlanLeaseResult(
      input,
      member,
      envelope,
      current.leaseInventory,
      { requireFresh: false },
    );
    if (lease && gapSeen) {
      fail(
        "wakeflow-delivery-orchestration-recovery-required",
        "plan lease failure closure contains a non-contiguous acquisition prefix",
      );
    }
    if (lease) leases.set(member.targetTaskId, lease);
    else gapSeen = true;
  }
  if (requireComplete) {
    assertFailureClosure(
      leases.size === input.plan.members.length,
      "delivery state journal requires the complete exact plan lease prefix",
    );
  }
  return leases;
}

function assertApplyLeaseClosure(input, baseline, current, transportComplete) {
  const plannedWindows = new Set(input.plan.members.map((member) => member.windowId));
  assertUnchangedLeaseWindows(baseline, current, plannedWindows);
  const leases = exactPlanLeasePrefix(input, current);
  for (const member of input.plan.members) {
    const prior = leaseEntryByWindow(baseline.leaseInventory, member.windowId);
    const candidate = leaseEntryByWindow(current.leaseInventory, member.windowId);
    if (prior) {
      assertFailureClosure(
        candidate !== null && same(candidate, prior),
        "apply changed a pre-existing exact plan lease generation",
      );
    }
  }
  if (!transportComplete) {
    assertFailureClosure(
      leases.size === 0,
      "plan lease exists before the immutable transport prefix is complete",
    );
  }
  return leases;
}

function expectedApplyStates(input, leases) {
  if (leases.size !== input.plan.members.length) return [input.plan.sourceState.record];
  const packetById = new Map(input.plan.packets.map((entry) => [entry.packetId, entry]));
  const envelopeById = new Map(input.plan.envelopes.map((entry) => [entry.deliveryId, entry]));
  return buildPreparedPlanStates(
    input,
    { packetById, envelopeById },
    leases,
  ).expectedStates;
}

function assertStateMonotonic(baselineState, currentState, allowedStates) {
  const baselineIndex = allowedStates.findIndex((state) => same(state, baselineState));
  const currentIndex = allowedStates.findIndex((state) => same(state, currentState));
  assertFailureClosure(
    baselineIndex >= 0 && currentIndex >= baselineIndex,
    "demand state is not an unchanged or exact forward delivery transition prefix",
  );
  return currentIndex === baselineIndex ? "unchanged" : "forward-complete";
}

function assertApplyFailureClosure(input, baseline, current) {
  assertBindingClosure(baseline, current);
  assertTransportBaselinePlus(
    baseline,
    current,
    [input.plan.group, ...input.plan.packets, ...input.plan.envelopes],
  );
  const transportComplete = assertPlanTransportPrefix(input.plan, current.transportInventory);
  const leases = assertApplyLeaseClosure(input, baseline, current, transportComplete);
  const allowedStates = expectedApplyStates(input, leases);
  return `apply-${assertStateMonotonic(baseline.state, current.state, allowedStates)}`;
}

function assertSimpleStateClosure(tracker, baseline, current) {
  const allowedStates = [
    baseline.state,
    ...tracker.intendedTransitions.map((entry) => entry.nextState),
  ];
  return assertStateMonotonic(baseline.state, current.state, allowedStates);
}

function assertClaimFailureClosure(tracker, baseline, current) {
  assertBindingClosure(baseline, current);
  assertTransportBaselinePlus(baseline, current);
  assertUnchangedLeaseWindows(baseline, current);
  return `claim-${assertSimpleStateClosure(tracker, baseline, current)}`;
}

function assertOutcomeFailureClosure(input, tracker, baseline, current) {
  assertBindingClosure(baseline, current);
  const allowedRuns = tracker.proposedRun ? [tracker.proposedRun] : [];
  assertTransportBaselinePlus(baseline, current, allowedRuns);
  const target = baseline.state.targetTasks.find(
    (task) => task.targetTaskId === input.targetTaskId,
  );
  const targetWindowId = target?.windowId;
  assertFailureClosure(Boolean(targetWindowId), "outcome baseline target disappeared");
  assertUnchangedLeaseWindows(baseline, current, new Set([targetWindowId]));
  const beforeLease = leaseEntryByWindow(baseline.leaseInventory, targetWindowId);
  const afterLease = leaseEntryByWindow(current.leaseInventory, targetWindowId);
  if (tracker.proposedRun?.transportStatus === "rejected-before-send") {
    assertFailureClosure(
      afterLease === null || same(afterLease, beforeLease),
      "rejected outcome lease closure is neither retained exact nor released",
    );
  } else {
    assertFailureClosure(
      same(afterLease, beforeLease),
      "accepted or ambiguous outcome changed its retained coordination lease",
    );
  }
  const stateClassification = assertSimpleStateClosure(tracker, baseline, current);
  if (
    tracker.proposedRun?.transportStatus === "rejected-before-send"
    && afterLease === null
    && target.currentDelivery?.phase === "send-claimed"
  ) {
    assertFailureClosure(
      stateClassification === "forward-complete",
      "rejected outcome released its coordination lease before exact state settlement",
    );
  }
  if (stateClassification === "forward-complete") {
    assertFailureClosure(
      tracker.proposedRun !== null
      && current.transportInventory.entries.runs.some(
        (entry) => same(entry.record, tracker.proposedRun),
      ),
      "delivery outcome state advanced before its exact immutable run",
    );
  }
  return `outcome-${stateClassification}`;
}

function exactRearmLeaseOwner(input, baseline, current) {
  const task = baseline.state.targetTasks.find(
    (entry) => entry.targetTaskId === input.targetTaskId,
  );
  const prior = task?.currentDelivery;
  const candidate = task
    ? leaseEntryByWindow(current.leaseInventory, task.windowId)
    : null;
  if (!candidate) return null;
  const envelope = current.transportInventory.entries.envelopes.find(
    (entry) => entry.record.deliveryId === input.deliveryId,
  )?.record;
  assertFailureClosure(Boolean(envelope), "rearm lease has no exact immutable envelope");
  const expected = {
    programId: input.expectedProgramId,
    hostId: envelope.preparedByHostId,
    windowId: task.windowId,
    demandId: baseline.state.demandId,
    targetTaskId: task.targetTaskId,
    groupId: prior.group.groupId,
    groupDigest: prior.group.digest,
    deliveryId: prior.envelope.deliveryId,
    envelopeDigest: prior.envelope.digest,
    bindingId: envelope.bindingId,
    identityBindingDigest: envelope.identityBindingDigest,
  };
  assertFailureClosure(
    Object.entries(expected).every(([key, value]) => candidate.lease[key] === value),
    "rearm lease differs from the exact rejected delivery owner",
  );
  assertFailureClosure(
    candidate.lease.leaseId !== prior.lease.leaseId
      && candidate.lease.leaseDigest !== prior.lease.digest,
    "rearm retained the released lease generation",
  );
  return candidate;
}

function assertRearmFailureClosure(input, tracker, baseline, current) {
  assertBindingClosure(baseline, current);
  assertTransportBaselinePlus(baseline, current);
  const task = baseline.state.targetTasks.find(
    (entry) => entry.targetTaskId === input.targetTaskId,
  );
  assertFailureClosure(Boolean(task), "rearm baseline target disappeared");
  assertUnchangedLeaseWindows(baseline, current, new Set([task.windowId]));
  const beforeLease = leaseEntryByWindow(baseline.leaseInventory, task.windowId);
  const afterLease = leaseEntryByWindow(current.leaseInventory, task.windowId);
  let intended = tracker.intendedTransitions;
  if (same(beforeLease, afterLease)) {
    const baselineAlreadyHasReplacement = beforeLease !== null
      && exactRearmLeaseOwner(input, baseline, current) !== null;
    assertFailureClosure(
      intended.length === 0
        || same(current.state, baseline.state)
        || baselineAlreadyHasReplacement,
      "rearm state advanced without a replacement coordination lease",
    );
  } else {
    const candidate = exactRearmLeaseOwner(input, baseline, current);
    if (intended.length === 0 && candidate) {
      const priorRun = current.transportInventory.entries.runs.find(
        (entry) => entry.record.runId === input.expectedRun.runId,
      )?.record;
      assertFailureClosure(Boolean(priorRun), "rearm replacement lease has no exact rejected run");
      intended = [rearmEventAndState({
        loaded: { state: baseline.state, demand: { demandId: baseline.state.demandId } },
        task,
        newLease: { leaseRef: candidate.leaseRef, lease: candidate.lease },
        createdAt: afterLatestTimestamp(
          baseline.state.updatedAt,
          priorRun.createdAt,
          candidate.lease.acquiredAt,
        ),
      })];
    }
  }
  return `rearm-${assertStateMonotonic(
    baseline.state,
    current.state,
    [baseline.state, ...intended.map((entry) => entry.nextState)],
  )}`;
}

function assertJournalLocalPrerequisites(kind, input, tracker, baseline, current) {
  assertBindingClosure(baseline, current);
  if (kind === "apply") {
    assertTransportBaselinePlus(
      baseline,
      current,
      [input.plan.group, ...input.plan.packets, ...input.plan.envelopes],
    );
    assertFailureClosure(
      assertPlanTransportPrefix(input.plan, current.transportInventory),
      "apply journal exists before the complete immutable transport prefix",
    );
    exactPlanLeasePrefix(input, current, { requireComplete: true });
    return;
  }
  if (kind === "outcome") {
    assertFailureClosure(Boolean(tracker.proposedRun), "outcome journal has no intended run");
    assertTransportBaselinePlus(baseline, current, [tracker.proposedRun]);
    assertFailureClosure(
      current.transportInventory.entries.runs.some(
        (entry) => same(entry.record, tracker.proposedRun),
      ),
      "outcome journal exists before its exact immutable run",
    );
    assertUnchangedLeaseWindows(baseline, current);
    return;
  }
  assertTransportBaselinePlus(baseline, current);
  if (kind === "claim") {
    assertUnchangedLeaseWindows(baseline, current);
    return;
  }
  const task = baseline.state.targetTasks.find(
    (entry) => entry.targetTaskId === input.targetTaskId,
  );
  assertUnchangedLeaseWindows(baseline, current, new Set([task.windowId]));
  assertFailureClosure(
    Boolean(exactRearmLeaseOwner(input, baseline, current)),
    "rearm journal exists before its distinct exact replacement lease",
  );
}

function assertUntouchedPreexistingJournalOwner(kind, tracker) {
  assertFailureClosure(
    tracker.uncertain === false
      && tracker.committed === false
      && tracker.intendedTransitions.length === 0
      && tracker.proposedRun === null
      && tracker.rearmLease === null,
    `only an untouched ${kind} owner may reconstruct a pre-existing delivery journal`,
  );
}

function previousLoadedForJournal({ loaded, journal, position }) {
  assertFailureClosure(
    journal.artifactWrites.length === 0 && isPlainObject(journal.previousState),
    "pre-existing delivery journal is not one state-only transition",
  );
  const previousEvents = position.eventIsWritten
    ? loaded.events.slice(0, -1)
    : loaded.events;
  const previousTail = previousEvents.at(-1) ?? null;
  assertFailureClosure(
    previousEvents.length === journal.expectedPreviousRevision
      && journal.previousState.revision === journal.expectedPreviousRevision
      && canonicalJsonDigest(journal.previousState) === journal.expectedPreviousStateDigest
      && previousTail !== null
      && previousTail.eventId === journal.previousState.lastEvent.eventId
      && canonicalJsonDigest(previousTail) === journal.previousState.lastEvent.eventDigest
      && (
        !position.eventIsWritten
        || same(loaded.events.at(-1), journal.nextEvent)
      ),
    "pre-existing delivery journal has no exact previous event/state authority prefix",
  );
  return {
    ...loaded,
    state: journal.previousState,
    events: previousEvents,
    digests: {
      ...loaded.digests,
      state: journal.expectedPreviousStateDigest,
    },
  };
}

function rehydratePreexistingApplyJournal({
  input,
  config,
  tracker,
  loaded,
  journal,
  previousLoaded,
}) {
  const journalTransition = journal.nextEvent.deliveryTransition;
  assertFailureClosure(
    journal.command === "prepare-target-delivery"
      && journalTransition?.sendGeneration === 1
      && input.plan.demandId === loaded.demand.demandId
      && input.plan.members.some((member) => (
        member.targetTaskId === journalTransition.targetTaskId
        && member.deliveryId === journalTransition.deliveryId
      )),
    "pre-existing apply journal does not select one exact plan member",
  );
  const sources = assertPlanStaticSourcesWhileLocked(input, config, previousLoaded);
  const transportInventory = loadTransportInventory(
    input.workspaceRoot,
    input.expectedProgramId,
    input.plan.demandId,
  );
  const leaseInventory = loadLeaseInventory(input.workspaceRoot);
  assertPlanLeaseConflictsAbsent(input, config, leaseInventory);
  assertFailureClosure(
    assertPlanTransportPrefix(input.plan, transportInventory),
    "pre-existing apply journal exists before the complete immutable transport prefix",
  );
  const leases = exactPlanLeasePrefix(
    input,
    { leaseInventory },
    { requireComplete: true },
  );
  const { expectedStates, prepared } = buildPreparedPlanStates(input, sources, leases);
  const prefixIndex = expectedStates.findIndex((state) => same(state, previousLoaded.state));
  assertFailureClosure(
    prefixIndex >= 0 && prefixIndex < prepared.length,
    "pre-existing apply journal previousState is not one exact plan member prefix",
  );
  rememberFailureBaseline(tracker, input, config, previousLoaded);
  return prepared[prefixIndex];
}

function rehydratePreexistingClaimJournal({
  input,
  config,
  tracker,
  journal,
  previousLoaded,
}) {
  assertFailureClosure(
    journal.command === "claim-target-delivery-send"
      && journal.nextEvent.deliveryTransition?.targetTaskId === input.targetTaskId
      && journal.nextEvent.deliveryTransition?.deliveryId === input.deliveryId
      && journal.nextEvent.deliveryTransition?.sendGeneration === input.sendGeneration,
    "pre-existing delivery journal does not match the exact requested claim generation",
  );
  rememberFailureBaseline(tracker, input, config, previousLoaded);
  return prepareClaimTransition(input, config, previousLoaded, {
    requireUnexpiredLease: false,
  }).transition;
}

function rehydratePreexistingOutcomeJournal({
  input,
  config,
  tracker,
  loaded,
  journal,
  previousLoaded,
}) {
  assertFailureClosure(
    journal.command === "record-target-delivery-run"
      && journal.nextEvent.deliveryTransition?.targetTaskId === input.targetTaskId
      && journal.nextEvent.deliveryTransition?.deliveryId === input.deliveryId
      && journal.nextEvent.deliveryTransition?.sendGeneration === input.sendGeneration,
    "pre-existing outcome journal does not match the exact requested delivery generation",
  );
  const task = previousLoaded.state.targetTasks.find(
    (entry) => entry.targetTaskId === input.targetTaskId,
  );
  assertFailureClosure(
    task?.currentDelivery?.phase === "send-claimed"
      && task.currentDelivery.envelope.deliveryId === input.deliveryId
      && task.currentDelivery.sendGeneration === input.sendGeneration,
    "pre-existing outcome journal previousState is not the exact send-claimed generation",
  );
  const sources = exactDeliverySources(input, previousLoaded, task, config, {
    requireLease: true,
    requireUnexpiredLease: false,
    requireActiveArtifact: false,
  });
  assertOutcomeFollowsExactClaim(previousLoaded, task, input.outcome.createdAt);
  const previousRun = input.sendGeneration > 1
    ? sources.runs.find(
      (run) => run.runId === task.currentDelivery.rearmedFrom?.runId,
    ) ?? null
    : null;
  assertFailureClosure(
    (input.sendGeneration > 1) === Boolean(previousRun),
    "pre-existing outcome journal has an incomplete delivery run prefix",
  );
  const runId = deterministicId("delivery-run", {
    deliveryId: input.deliveryId,
    sendGeneration: input.sendGeneration,
    outcome: input.outcome,
  });
  const proposedRun = createDeliveryRunRecord({
    programId: input.expectedProgramId,
    demandId: loaded.demand.demandId,
    runId,
    deliveryId: input.deliveryId,
    envelopeDigest: sources.envelope.envelopeDigest,
    hostId: sources.envelope.preparedByHostId,
    windowId: task.windowId,
    attemptOrdinal: input.sendGeneration,
    ...(previousRun ? {
      previousRun: {
        runId: previousRun.runId,
        ref: deliveryRunRef({ demandId: previousRun.demandId, runId: previousRun.runId }),
        digest: previousRun.runDigest,
      },
    } : {}),
    hostMethod: input.outcome.hostMethod,
    hostMode: input.outcome.hostMode,
    transportStatus: input.outcome.transportStatus,
    readback: input.outcome.readback,
    observedLease: {
      leaseId: sources.leaseEntry.lease.leaseId,
      leaseRef: sources.leaseEntry.leaseRef,
      leaseDigest: sources.leaseEntry.lease.leaseDigest,
    },
    ...(Object.hasOwn(input.outcome, "error") ? { error: input.outcome.error } : {}),
    createdAt: input.outcome.createdAt,
  });
  validateDeliveryRunAgainstSources({
    run: proposedRun,
    envelope: sources.envelope,
    ...(previousRun ? { previousRun } : {}),
    lease: sources.leaseEntry.lease,
  });
  const ordinalRun = sources.runs.find(
    (run) => run.attemptOrdinal === input.sendGeneration,
  ) ?? null;
  assertFailureClosure(
    ordinalRun !== null
      && same(ordinalRun, proposedRun)
      && sources.runs.length === input.sendGeneration
      && same(sources.runs.at(-1), proposedRun),
    "pre-existing outcome journal has no exact immutable run-chain tail",
  );
  const settlement = settlementEventAndState({
    loaded: previousLoaded,
    task,
    run: proposedRun,
  });
  rememberFailureBaseline(tracker, input, config, previousLoaded);
  tracker.proposedRun = proposedRun;
  return settlement;
}

function rehydratePreexistingRearmJournal({
  input,
  config,
  tracker,
  journal,
  previousLoaded,
}) {
  assertFailureClosure(
    journal.command === "rearm-target-delivery"
      && journal.nextEvent.deliveryTransition?.targetTaskId === input.targetTaskId
      && journal.nextEvent.deliveryTransition?.deliveryId === input.deliveryId,
    "pre-existing rearm journal does not match the exact requested delivery",
  );
  const task = previousLoaded.state.targetTasks.find(
    (entry) => entry.targetTaskId === input.targetTaskId,
  );
  const delivery = task?.currentDelivery;
  assertFailureClosure(
    delivery?.phase === "rejected-before-send"
      && task.lifecycleStatus === "dispatched"
      && previousLoaded.state.state === "dispatched"
      && previousLoaded.state.review.status === "idle"
      && delivery.envelope.deliveryId === input.deliveryId
      && delivery.latestRun?.runId === input.expectedRun.runId
      && delivery.latestRun.ref === input.expectedRun.ref
      && delivery.latestRun.digest === input.expectedRun.digest,
    "pre-existing rearm journal previousState is not the exact rejected delivery tail",
  );
  const sources = exactDeliverySources(input, previousLoaded, task, config, {
    requireLease: false,
    requireUnexpiredLease: false,
    allowReplacementLease: true,
  });
  const priorRun = sources.runs.find((run) => run.runId === input.expectedRun.runId) ?? null;
  assertFailureClosure(
    priorRun !== null
      && priorRun.runDigest === input.expectedRun.digest
      && deliveryRunRef({ demandId: priorRun.demandId, runId: priorRun.runId })
        === input.expectedRun.ref
      && priorRun.transportStatus === "rejected-before-send"
      && priorRun.readback.status === "unavailable"
      && priorRun.readback.attempts === 0
      && priorRun.readback.evidence.length === 0
      && priorRun.attemptOrdinal === delivery.sendGeneration
      && sources.runs.length === delivery.sendGeneration
      && sources.runs.at(-1)?.runId === priorRun.runId,
    "pre-existing rearm journal has no exact rejected run-chain tail",
  );
  assertDeliveryOnlySuffix(
    previousLoaded,
    task.targetTaskId,
    delivery.recordedBy.revision,
  );
  const replacementLease = sources.leaseEntry;
  assertFailureClosure(
    replacementLease !== null
      && replacementLease.lease.leaseId !== delivery.lease.leaseId
      && replacementLease.lease.leaseDigest !== delivery.lease.digest,
    "pre-existing rearm journal has no distinct exact replacement lease generation",
  );
  const newLease = frozen({
    status: "replayed",
    leaseRef: replacementLease.leaseRef,
    lease: replacementLease.lease,
  });
  const transition = rearmEventAndState({
    loaded: previousLoaded,
    task,
    newLease,
    createdAt: afterLatestTimestamp(
      previousLoaded.state.updatedAt,
      priorRun.createdAt,
      newLease.lease.acquiredAt,
    ),
  });
  rememberFailureBaseline(tracker, input, config, previousLoaded);
  tracker.rearmLease = newLease;
  return transition;
}

// 既有本域 journal 只有在当前精确输入可重建同一 event/state 时，才能加入本次恢复上下文。
function rehydratePreexistingDeliveryJournal({
  kind,
  input,
  config,
  tracker,
  loaded,
  journal,
  position,
}) {
  if (tracker.baseline !== null && tracker.baseline !== undefined) return;
  assertUntouchedPreexistingJournalOwner(kind, tracker);
  // state journal 只拥有精确 event/state transition，不是其他本地 owner 的历史快照。
  // 因此恢复基线来自当前严格 inventory，再由命令专属重建器证明其消费的 plan/target 事实。
  // 无关但合法的 owner 事实必须保留，却不能授权当前 journal 或改变本次恢复闭包。
  const previousLoaded = previousLoadedForJournal({ loaded, journal, position });
  let transition;
  if (kind === "apply") {
    transition = rehydratePreexistingApplyJournal({
      input,
      config,
      tracker,
      loaded,
      journal,
      previousLoaded,
    });
  } else if (kind === "claim") {
    transition = rehydratePreexistingClaimJournal({
      input,
      config,
      tracker,
      journal,
      previousLoaded,
    });
  } else if (kind === "outcome") {
    transition = rehydratePreexistingOutcomeJournal({
      input,
      config,
      tracker,
      loaded,
      journal,
      previousLoaded,
    });
  } else if (kind === "rearm") {
    transition = rehydratePreexistingRearmJournal({
      input,
      config,
      tracker,
      journal,
      previousLoaded,
    });
  } else {
    fail(
      "wakeflow-delivery-orchestration-recovery-required",
      "unknown pre-existing delivery journal owner",
    );
  }
  assertFailureClosure(
    same(transition.event, journal.nextEvent)
      && same(transition.nextState, journal.nextState),
    `pre-existing ${kind} journal cannot be deterministically reconstructed from current authority`,
  );
  tracker.intendedTransitions = [transition];
}

// 只恢复本次精确意图或经重建证明的既有 delivery journal，不消费其他 domain journal。
function recoverIntendedDeliveryJournal(kind, input, config, tracker) {
  return recoverDemandDeliveryTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: config.ledgerRoot,
    admitRecoveryWhileLocked: ({ journal, loaded, position }) => {
      rehydratePreexistingDeliveryJournal({
        kind,
        input,
        config,
        tracker,
        loaded,
        journal,
        position,
      });
      const intended = tracker.intendedTransitions.find((transition) => (
        same(transition.event, journal.nextEvent)
        && same(transition.nextState, journal.nextState)
      ));
      assertFailureClosure(
        Boolean(intended) && journal.artifactWrites.length === 0,
        "pending delivery state journal is not the exact intended transition",
      );
      const current = {
        bindingInventory: loadBindingInventory(input.workspaceRoot, config),
        transportInventory: loadTransportInventory(
          input.workspaceRoot,
          input.expectedProgramId,
          loaded.demand.demandId,
        ),
        leaseInventory: loadLeaseInventory(input.workspaceRoot),
      };
      assertJournalLocalPrerequisites(kind, input, tracker, tracker.baseline, current);
      return { admitted: true };
    },
  });
}

/**
 * mutation callback 失败后的总闭包：恢复精确 journal，再证明每个 owner 只处于允许的未变或前向状态。
 * 返回 safe-to-release 只解除 T02 gate，不代表本次业务操作成功。
 */
function verifyDeliveryFailureClosure(kind, input, config, tracker) {
  return withStateRootLock(input.stateRoot, () => {
    recoverIntendedDeliveryJournal(kind, input, config, tracker);
    assertFailureClosure(Boolean(tracker.baseline), "delivery failure has no strict prewrite baseline");
    const loaded = loadStateWhileLocked(input, config);
    const current = deliveryFailureSnapshot(input, config, loaded);
    let classification;
    if (same(current, tracker.baseline)) {
      classification = `${kind}-unchanged`;
    } else if (kind === "apply") {
      classification = assertApplyFailureClosure(input, tracker.baseline, current);
    } else if (kind === "claim") {
      classification = assertClaimFailureClosure(tracker, tracker.baseline, current);
    } else if (kind === "outcome") {
      classification = assertOutcomeFailureClosure(input, tracker, tracker.baseline, current);
    } else if (kind === "rearm") {
      classification = assertRearmFailureClosure(input, tracker, tracker.baseline, current);
    } else {
      fail("wakeflow-delivery-orchestration-recovery-required", "unknown delivery failure owner");
    }
    return safeReleaseVerdict("delivery-authority-closure", {
      kind,
      classification,
      configDigest: current.configDigest,
      stateDigest: current.stateDigest,
      eventsDigest: current.eventsDigest,
      bindingInventoryDigest: current.bindingInventory.inventoryDigest,
      transportInventoryDigest: current.transportInventory.inventoryDigest,
      leaseInventoryDigest: current.leaseInventory.inventoryDigest,
      journal: "absent",
    });
  });
}

/**
 * 应用一个经完整重算的 Target delivery 计划；只写 prepared authority，不跨越宿主发送边界。
 */
export async function applyTargetDeliveryPlan(input = {}) {
  const normalized = normalizeApplyInput(canonicalDeliveryInput(
    input,
    "applyTargetDeliveryPlan input",
  ));
  const config = loadConfig(normalized);
  const tracker = {
    uncertain: false,
    committed: false,
    baseline: null,
    intendedTransitions: [],
    proposedRun: null,
    rearmLease: null,
  };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: normalized.workspaceRoot,
      operationKind: "target-delivery-plan-apply",
      domainOwner: "delivery-runtime",
      onCallbackFailure: () => verifyDeliveryFailureClosure(
        "apply",
        normalized,
        config,
        tracker,
      ),
    }, (mutationContext) => withStateRootLock(normalized.stateRoot, () => (
      applyPlanWhileLocked(normalized, config, mutationContext, tracker)
    )));
  } catch (cause) {
    wrap("state", cause, "target delivery plan apply failed closed");
  }
}

function normalizeDeliveryOperationInput(input, label, { includeGeneration = true } = {}) {
  exactKeys(
    input,
    [
      "workspaceRoot",
      "stateRoot",
      "expectedProgramId",
      "targetTaskId",
      "deliveryId",
      ...(includeGeneration ? ["sendGeneration"] : []),
    ],
    [],
    label,
  );
  if (
    includeGeneration
    && (!Number.isSafeInteger(input.sendGeneration) || input.sendGeneration < 1)
  ) {
    fail("wakeflow-delivery-orchestration-contract", "sendGeneration must be a positive integer");
  }
  return frozen({
    workspaceRoot: normalizeRoot(input.workspaceRoot, "workspaceRoot"),
    stateRoot: normalizeRoot(input.stateRoot, "stateRoot"),
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
    targetTaskId: typedId(input.targetTaskId, "target-task", "targetTaskId"),
    deliveryId: typedId(input.deliveryId, "delivery", "deliveryId"),
    ...(includeGeneration ? { sendGeneration: input.sendGeneration } : {}),
  });
}

function assertTaskArtifactClosure(input, loaded, task, { requireActive = true } = {}) {
  const packageSummary = loaded.state.taskPackages.find(
    (entry) => entry.taskPackageId === task.taskPackageId,
  );
  if (!packageSummary || (requireActive && packageSummary.lifecycleStatus !== "active")) {
    fail(
      "wakeflow-delivery-orchestration-state",
      requireActive
        ? "delivery target has no active TaskPackage"
        : "delivery target has no retained TaskPackage summary",
    );
  }
  const packageRecord = exactArtifact(input.stateRoot, packageSummary, {
    kind: "wakeflow-task-package",
    id: task.taskPackageId,
    programId: input.expectedProgramId,
    demandId: loaded.demand.demandId,
  });
  if (packageRecord.targetTaskId !== task.targetTaskId || packageRecord.windowId !== task.windowId) {
    fail("wakeflow-delivery-orchestration-artifact", "TaskPackage no longer matches target assignment");
  }
  let testCard = null;
  if (Object.hasOwn(task, "testCard")) {
    testCard = exactArtifact(input.stateRoot, task.testCard, {
      kind: "wakeflow-test-card",
      id: task.testCard.testCardId,
      programId: input.expectedProgramId,
      demandId: loaded.demand.demandId,
    });
    if (
      packageRecord.workType !== "test"
      || !same(packageRecord.testCard, task.testCard)
      || testCard.targetTaskId !== task.targetTaskId
      || testCard.windowId !== task.windowId
    ) {
      fail("wakeflow-delivery-orchestration-artifact", "Test package/card closure changed");
    }
  }
  return { packageRecord, testCard };
}

// 重新闭合 currentDelivery 与 group/packet/envelope/run、binding、lease 及 active artifact 的精确来源。
function exactDeliverySources(input, loaded, task, config, {
  requireLease = true,
  requireUnexpiredLease = requireLease,
  allowReplacementLease = false,
  ignoreUnrelatedLease = false,
  requireActiveArtifact = true,
  requireCurrentBinding = true,
} = {}) {
  const delivery = task.currentDelivery;
  if (!delivery || delivery.envelope.deliveryId !== input.deliveryId) {
    fail("wakeflow-delivery-orchestration-state", "target currentDelivery differs from requested delivery");
  }
  assertTaskArtifactClosure(input, loaded, task, { requireActive: requireActiveArtifact });
  const inventory = loadTransportInventory(
    input.workspaceRoot,
    input.expectedProgramId,
    loaded.demand.demandId,
  );
  const groupEntry = transportEntry(inventory, "groups", "groupId", delivery.group.groupId);
  const packetEntry = transportEntry(inventory, "packets", "packetId", delivery.packet.packetId);
  const envelopeEntry = transportEntry(
    inventory,
    "envelopes",
    "deliveryId",
    delivery.envelope.deliveryId,
  );
  if (
    !groupEntry
    || !packetEntry
    || !envelopeEntry
    || groupEntry.ref !== delivery.group.ref
    || groupEntry.digest !== delivery.group.digest
    || packetEntry.ref !== delivery.packet.ref
    || packetEntry.digest !== delivery.packet.digest
    || envelopeEntry.ref !== delivery.envelope.ref
    || envelopeEntry.digest !== delivery.envelope.digest
  ) {
    fail("wakeflow-delivery-orchestration-transport", "current delivery transport tuple is incomplete or changed");
  }
  validateTargetDeliveryEnvelopeAgainstSources({
    envelope: envelopeEntry.record,
    group: groupEntry.record,
    packet: packetEntry.record,
  });
  let binding = null;
  if (requireCurrentBinding) {
    const bindingInventory = loadBindingInventory(input.workspaceRoot, config);
    binding = currentBinding(bindingInventory, task.windowId);
    if (
      bindingInventory.hostId !== envelopeEntry.record.preparedByHostId
      || binding.bindingId !== envelopeEntry.record.bindingId
      || binding.identityRef !== envelopeEntry.record.identityRef
      || binding.identityBindingDigest !== envelopeEntry.record.identityBindingDigest
    ) {
      fail("wakeflow-delivery-orchestration-binding", "delivery envelope binding is no longer current");
    }
  }
  const leaseInventory = loadLeaseInventory(input.workspaceRoot);
  let leaseEntry = leaseInventory.leases.find(
    (entry) => entry.lease.windowId === task.windowId,
  ) ?? null;
  const leaseMatchesDeliveryOwner = !leaseEntry || !(
    leaseEntry.lease.programId !== input.expectedProgramId
    || leaseEntry.lease.hostId !== envelopeEntry.record.preparedByHostId
    || leaseEntry.lease.windowId !== task.windowId
    || leaseEntry.lease.demandId !== loaded.demand.demandId
    || leaseEntry.lease.targetTaskId !== task.targetTaskId
    || leaseEntry.lease.groupId !== delivery.group.groupId
    || leaseEntry.lease.groupDigest !== delivery.group.digest
    || leaseEntry.lease.deliveryId !== delivery.envelope.deliveryId
    || leaseEntry.lease.envelopeDigest !== delivery.envelope.digest
    || leaseEntry.lease.bindingId !== envelopeEntry.record.bindingId
    || leaseEntry.lease.identityBindingDigest !== envelopeEntry.record.identityBindingDigest
  );
  if (leaseEntry && !leaseMatchesDeliveryOwner) {
    if (ignoreUnrelatedLease) leaseEntry = null;
    else {
      fail(
        "wakeflow-delivery-orchestration-lease",
        "coordination lease differs from current delivery authority",
      );
    }
  }
  if (requireLease && !leaseEntry) {
    fail("wakeflow-delivery-orchestration-lease", "current delivery coordination lease is absent");
  }
  if (leaseEntry && !allowReplacementLease && (
    leaseEntry.leaseRef !== delivery.lease.ref
    || leaseEntry.lease.leaseId !== delivery.lease.leaseId
    || leaseEntry.lease.leaseDigest !== delivery.lease.digest
  )) {
    fail("wakeflow-delivery-orchestration-lease", "coordination lease generation differs from current delivery authority");
  }
  if (
    leaseEntry
    && requireUnexpiredLease
    && Date.parse(leaseEntry.lease.expiresAt) <= Date.now()
  ) {
    fail("wakeflow-delivery-orchestration-lease", "coordination lease is expired");
  }
  const runs = inventory.entries.runs
    .map((entry) => entry.record)
    .filter((run) => run.deliveryId === delivery.envelope.deliveryId)
    .sort((left, right) => left.attemptOrdinal - right.attemptOrdinal);
  validateDeliveryRunChain({ runs });
  return {
    inventory,
    group: groupEntry.record,
    packet: packetEntry.record,
    envelope: envelopeEntry.record,
    runs,
    binding,
    leaseInventory,
    leaseEntry,
  };
}

// claim 只允许 prepared generation 的唯一 state transition；真正宿主 effect 必须消费其 permit。
function prepareClaimTransition(input, config, loaded, {
  requireUnexpiredLease = true,
} = {}) {
  const task = loaded.state.targetTasks.find(
    (entry) => entry.targetTaskId === input.targetTaskId,
  );
  if (
    !task
    || task.lifecycleStatus !== "dispatched"
    || loaded.state.state !== "dispatched"
    || loaded.state.review.status !== "idle"
    || task.currentDelivery?.phase !== "prepared"
    || task.currentDelivery.sendGeneration !== input.sendGeneration
  ) {
    fail(
      "wakeflow-delivery-orchestration-state",
      "pre-send claim requires one exact active prepared delivery generation",
    );
  }
  const sources = exactDeliverySources(input, loaded, task, config, {
    requireUnexpiredLease,
  });
  assertDispatchGroupFullyAuthorized(loaded, sources, task.currentDelivery.sourceState);
  assertDeliveryOnlySuffix(
    loaded,
    task.targetTaskId,
    task.currentDelivery.authorizedBy.revision,
  );
  const baseEvent = loaded.events[task.currentDelivery.authorizedBy.revision - 1];
  if (
    baseEvent.deliveryTransition?.nextSummaryDigest
      !== demandDeliverySummaryDigest(task.currentDelivery)
    || sources.runs.length !== input.sendGeneration - 1
  ) {
    fail("wakeflow-delivery-orchestration-state", "prepared authorization or run prefix is stale");
  }
  return {
    task,
    sources,
    transition: claimEventAndState({
      loaded,
      task,
      delivery: task.currentDelivery,
    }),
  };
}

function deliveryOnlySuffixIsReusable(loaded, targetTaskId, baseRevision) {
  return loaded.events.slice(baseRevision).every((event) => (
    event.deliveryTransition
      && event.changedArtifacts.length === 0
      && event.deliveryTransition.targetTaskId !== targetTaskId
  ));
}

function assertDeliveryOnlySuffix(loaded, targetTaskId, baseRevision) {
  const staleEvent = loaded.events.slice(baseRevision).find((event) => (
    !event.deliveryTransition
      || event.changedArtifacts.length !== 0
      || event.deliveryTransition.targetTaskId === targetTaskId
  ));
  if (staleEvent) {
    fail(
      "wakeflow-delivery-orchestration-state",
      "delivery authorization became stale across a business or same-target event suffix",
      { staleAtRevision: staleEvent.nextRevision },
    );
  }
}

function assertDispatchGroupFullyAuthorized(loaded, sources, sourceState) {
  const expectedGroup = groupTuple(sources.group);
  for (const member of sources.group.members) {
    const task = loaded.state.targetTasks.find(
      (entry) => entry.targetTaskId === member.targetTaskId,
    );
    const delivery = task?.currentDelivery;
    const packetEntry = delivery
      ? transportEntry(sources.inventory, "packets", "packetId", delivery.packet.packetId)
      : null;
    const envelopeEntry = delivery
      ? transportEntry(sources.inventory, "envelopes", "deliveryId", delivery.envelope.deliveryId)
      : null;
    if (
      !task
      || task.windowId !== member.windowId
      || !delivery
      || !same(delivery.group, expectedGroup)
      || !same(delivery.sourceState, sourceState)
      || delivery.packet.packetId !== member.packetId
      || !packetEntry
      || packetEntry.ref !== delivery.packet.ref
      || packetEntry.digest !== delivery.packet.digest
      || packetEntry.record.groupId !== sources.group.groupId
      || packetEntry.record.targetTaskId !== member.targetTaskId
      || packetEntry.record.windowId !== member.windowId
      || !envelopeEntry
      || envelopeEntry.ref !== delivery.envelope.ref
      || envelopeEntry.digest !== delivery.envelope.digest
    ) {
      fail(
        "wakeflow-delivery-orchestration-state",
        "dispatch group is not fully selected by every exact member delivery authority",
      );
    }
    validateTargetDeliveryEnvelopeAgainstSources({
      envelope: envelopeEntry.record,
      group: sources.group,
      packet: packetEntry.record,
    });
  }
}

// 所有 delivery-owned state 写入统一经过专属 commit seam，并在不确定区间保留恢复标记。
function commitDeliveryTransition(input, config, previousState, event, nextState, tracker) {
  tracker.uncertain = true;
  let commit;
  try {
    commit = commitDemandDeliveryTransitionWhileLocked({
      stateRoot: input.stateRoot,
      expectedProgramId: input.expectedProgramId,
      ledgerRoot: config.ledgerRoot,
      expectedPrevious: {
        revision: previousState.revision,
        stateDigest: canonicalJsonDigest(previousState),
      },
      event,
      nextState,
    });
  } finally {
    if (commit) tracker.uncertain = false;
  }
  tracker.committed = true;
  return commit;
}

// 为 claim/outcome/rearm 绑定同一 mutation gate、state lock 和失败闭包，但不合并各自业务规则。
async function runDeliveryMutation(input, operationKind, worker) {
  const config = loadConfig(input);
  const kind = operationKind.replace("target-delivery-", "");
  const tracker = {
    uncertain: false,
    committed: false,
    baseline: null,
    intendedTransitions: [],
    proposedRun: null,
    rearmLease: null,
  };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind,
      domainOwner: "delivery-runtime",
      onCallbackFailure: () => verifyDeliveryFailureClosure(
        kind,
        input,
        config,
        tracker,
      ),
    }, (mutationContext) => withStateRootLock(input.stateRoot, () => (
      worker({ config, mutationContext, tracker })
    )));
  } catch (cause) {
    wrap("state", cause, `${operationKind} failed closed`);
  }
}

// 构造 send-claimed event/state 与 authority pointer；不触发任何外部发送。
function claimEventAndState({ loaded, task, delivery }) {
  const previousState = loaded.state;
  const nextDelivery = clone(delivery);
  const eventId = deterministicEventId({
    command: "claim-target-delivery-send",
    demandId: loaded.demand.demandId,
    targetTaskId: task.targetTaskId,
    deliveryId: delivery.envelope.deliveryId,
    sendGeneration: delivery.sendGeneration,
    previousStateDigest: canonicalJsonDigest(previousState),
  });
  const createdAt = nextTimestamp(previousState.updatedAt);
  const placeholder = {
    revision: previousState.revision + 1,
    eventId,
    eventDigest: ZERO_DIGEST,
  };
  nextDelivery.phase = "send-claimed";
  nextDelivery.claimedBy = placeholder;
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId,
    demandId: loaded.demand.demandId,
    createdAt,
    actor: "controller",
    command: "claim-target-delivery-send",
    type: "target-delivery.send-claimed",
    previousRevision: previousState.revision,
    nextRevision: previousState.revision + 1,
    from: previousState.state,
    to: previousState.state,
    reason: "Claim the single external-send interval for this delivery generation.",
    decisionSummary: "Only this state revision may cross the host-effect boundary.",
    changedArtifacts: [],
    deliveryTransition: {
      targetTaskId: task.targetTaskId,
      deliveryId: delivery.envelope.deliveryId,
      envelopeDigest: delivery.envelope.digest,
      sendGeneration: delivery.sendGeneration,
      fromPhase: "prepared",
      toPhase: "send-claimed",
      previousSummaryDigest: demandDeliverySummaryDigest(delivery),
      nextSummaryDigest: demandDeliverySummaryDigest(nextDelivery),
    },
  };
  const authority = eventAuthority(event);
  nextDelivery.claimedBy = authority;
  const nextState = clone(previousState);
  nextState.revision = event.nextRevision;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = { eventId, eventDigest: authority.eventDigest };
  nextState.targetTasks.find(
    (entry) => entry.targetTaskId === task.targetTaskId,
  ).currentDelivery = nextDelivery;
  return frozen({ event, nextState, nextDelivery, authority });
}

/**
 * 原子 claim 当前 generation，并返回一次性 send permit；竞争调用只有一个能取得该 authority。
 */
export async function claimTargetDelivery(input = {}) {
  const normalized = normalizeDeliveryOperationInput(canonicalDeliveryInput(
    input,
    "claimTargetDelivery input",
  ), "claim input");
  return runDeliveryMutation(normalized, "target-delivery-claim", ({
    config,
    mutationContext: _mutationContext,
    tracker,
  }) => {
    const loaded = loadStateWhileLocked(normalized, config);
    rememberFailureBaseline(tracker, normalized, config, loaded);
    const { task, sources, transition } = prepareClaimTransition(
      normalized,
      config,
      loaded,
    );
    tracker.intendedTransitions = [transition];
    const commit = commitDeliveryTransition(
      normalized,
      config,
      loaded.state,
      transition.event,
      transition.nextState,
      tracker,
    );
    return frozen({
      kind: SEND_PERMIT_KIND,
      schemaVersion: SCHEMA_VERSION,
      programId: normalized.expectedProgramId,
      demandId: loaded.demand.demandId,
      targetTaskId: task.targetTaskId,
      windowId: task.windowId,
      hostId: sources.envelope.preparedByHostId,
      group: groupTuple(sources.group),
      packet: packetTuple(sources.packet),
      envelope: envelopeTuple(sources.envelope),
      lease: leaseTuple({ lease: sources.leaseEntry.lease, leaseRef: sources.leaseEntry.leaseRef }),
      binding: bindingTuple(sources.binding),
      prompt: sources.envelope.prompt,
      transportPolicy: sources.envelope.transportPolicy,
      readbackPolicy: sources.envelope.readbackPolicy,
      automationRequested: sources.envelope.automationRequested,
      sendGeneration: normalized.sendGeneration,
      claimedBy: transition.authority,
      state: { revision: commit.revision, digest: commit.stateDigest },
    });
  });
}

function normalizeOutcomeInput(input) {
  exactKeys(
    input,
    [
      "workspaceRoot",
      "stateRoot",
      "expectedProgramId",
      "targetTaskId",
      "deliveryId",
      "sendGeneration",
      "outcome",
    ],
    [],
    "outcome input",
  );
  const common = normalizeDeliveryOperationInput({
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    targetTaskId: input.targetTaskId,
    deliveryId: input.deliveryId,
    sendGeneration: input.sendGeneration,
  }, "outcome delivery input");
  exactKeys(
    input.outcome,
    ["hostMethod", "hostMode", "transportStatus", "readback", "createdAt"],
    ["error"],
    "outcome",
  );
  if (!TRANSPORT_STATUSES.has(input.outcome.transportStatus)) {
    fail("wakeflow-delivery-orchestration-contract", "outcome.transportStatus is unsupported");
  }
  return frozen({
    ...common,
    outcome: {
      hostMethod: text(input.outcome.hostMethod, "outcome.hostMethod", { maxLength: 64 }),
      hostMode: text(input.outcome.hostMode, "outcome.hostMode", { maxLength: 64 }),
      transportStatus: input.outcome.transportStatus,
      readback: input.outcome.readback,
      createdAt: timestamp(input.outcome.createdAt, "outcome.createdAt"),
      ...(Object.hasOwn(input.outcome, "error") ? { error: input.outcome.error } : {}),
    },
  });
}

function acceptedDemandState(targetTasks) {
  return targetTasks.some((task) => [
    "planned",
    "dispatched",
    "needs-rework",
  ].includes(task.lifecycleStatus))
    ? "dispatched"
    : "waiting-results";
}

// 将 immutable run 的 transport 事实投影为 delivery settlement state；不创建 TargetResult。
function settlementEventAndState({ loaded, task, run }) {
  const previousState = loaded.state;
  const delivery = task.currentDelivery;
  const nextDelivery = clone(delivery);
  const eventId = deterministicEventId({
    command: "record-target-delivery-run",
    runId: run.runId,
    previousStateDigest: canonicalJsonDigest(previousState),
  });
  const placeholder = {
    revision: previousState.revision + 1,
    eventId,
    eventDigest: ZERO_DIGEST,
  };
  const tuple = runTuple(run);
  nextDelivery.phase = run.transportStatus;
  nextDelivery.recordedBy = placeholder;
  nextDelivery.latestRun = tuple;
  const nextState = clone(previousState);
  const nextTask = nextState.targetTasks.find(
    (entry) => entry.targetTaskId === task.targetTaskId,
  );
  nextTask.currentDelivery = nextDelivery;
  const advancesLifecycle = run.transportStatus === "accepted"
    && task.lifecycleStatus === "dispatched"
    && previousState.state === "dispatched"
    && previousState.review.status === "idle";
  if (advancesLifecycle) nextTask.lifecycleStatus = "waiting-result";
  nextState.state = advancesLifecycle
    ? acceptedDemandState(nextState.targetTasks)
    : previousState.state;
  nextState.revision = previousState.revision + 1;
  nextState.stateReason = `Record exact ${run.transportStatus} delivery transport outcome.`;
  nextState.updatedAt = run.createdAt;
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId,
    demandId: loaded.demand.demandId,
    createdAt: run.createdAt,
    actor: "controller",
    command: "record-target-delivery-run",
    type: "target-delivery.run-recorded",
    previousRevision: previousState.revision,
    nextRevision: previousState.revision + 1,
    from: previousState.state,
    to: nextState.state,
    reason: nextState.stateReason,
    decisionSummary: "Persist host transport facts without inferring target completion or acceptance.",
    changedArtifacts: [],
    deliveryTransition: {
      targetTaskId: task.targetTaskId,
      deliveryId: delivery.envelope.deliveryId,
      envelopeDigest: delivery.envelope.digest,
      sendGeneration: delivery.sendGeneration,
      fromPhase: "send-claimed",
      toPhase: run.transportStatus,
      previousSummaryDigest: demandDeliverySummaryDigest(delivery),
      nextSummaryDigest: demandDeliverySummaryDigest(nextDelivery),
      run: tuple,
    },
  };
  const authority = eventAuthority(event);
  nextDelivery.recordedBy = authority;
  nextState.lastEvent = { eventId, eventDigest: authority.eventDigest };
  return frozen({ event, nextState, nextDelivery, authority });
}

function assertOutcomeFollowsExactClaim(loaded, task, createdAt) {
  const claimAuthority = task.currentDelivery.claimedBy;
  const claimEvent = claimAuthority
    ? loaded.events[claimAuthority.revision - 1]
    : null;
  if (
    !claimEvent
    || claimEvent.eventId !== claimAuthority.eventId
    || canonicalJsonDigest(claimEvent) !== claimAuthority.eventDigest
    || claimEvent.command !== "claim-target-delivery-send"
    || claimEvent.deliveryTransition?.targetTaskId !== task.targetTaskId
    || claimEvent.deliveryTransition?.deliveryId !== task.currentDelivery.envelope.deliveryId
    || claimEvent.deliveryTransition?.sendGeneration !== task.currentDelivery.sendGeneration
  ) {
    fail(
      "wakeflow-delivery-orchestration-state",
      "delivery outcome has no exact current send-claim event authority",
    );
  }
  if (Date.parse(createdAt) <= Date.parse(loaded.state.updatedAt)) {
    fail(
      "wakeflow-delivery-orchestration-state",
      "delivery outcome createdAt must be later than the current claimed state",
    );
  }
}

function outcomeResult(status, run, state, leaseStatus) {
  return frozen({
    status,
    run: runTuple(run),
    delivery: { phase: run.transportStatus, sendGeneration: run.attemptOrdinal },
    leaseStatus,
    revision: state.revision,
    stateDigest: canonicalJsonDigest(state),
  });
}

// 只有精确 rejected-before-send outcome 才在 settlement 之后释放本 generation lease。
function releaseDeliveryLease(
  input,
  task,
  delivery,
  bindingId,
  mutationContext,
  tracker,
) {
  const value = callAdmitted(() => releaseWindowCoordinationLeaseAdmitted({
      workspaceRoot: input.workspaceRoot,
      windowId: task.windowId,
      leaseId: delivery.lease.leaseId,
      deliveryId: delivery.envelope.deliveryId,
      bindingId,
      leaseDigest: delivery.lease.digest,
      mutationContext,
    }), "lease", tracker, (candidate) => exactLeaseSuccess(
      candidate,
      ["released"],
      {
        windowId: task.windowId,
        leaseId: delivery.lease.leaseId,
        deliveryId: delivery.envelope.deliveryId,
        bindingId,
        leaseDigest: delivery.lease.digest,
      },
    ));
  if (value.status === "released") tracker.committed = true;
  return value;
}

/**
 * 记录宿主 effect 的不可变 run 并提交 settlement；accepted/ambiguous 继续保留 lease 等待结果闭包。
 */
export async function recordTargetDeliveryOutcome(input = {}) {
  const normalized = normalizeOutcomeInput(canonicalDeliveryInput(
    input,
    "recordTargetDeliveryOutcome input",
  ));
  return runDeliveryMutation(normalized, "target-delivery-outcome", ({
    config,
    mutationContext,
    tracker,
  }) => {
    const loaded = loadStateWhileLocked(normalized, config);
    rememberFailureBaseline(tracker, normalized, config, loaded);
    const task = loaded.state.targetTasks.find(
      (entry) => entry.targetTaskId === normalized.targetTaskId,
    );
    if (!task?.currentDelivery || task.currentDelivery.sendGeneration !== normalized.sendGeneration) {
      fail("wakeflow-delivery-orchestration-state", "delivery outcome generation is not current");
    }
    const settledReplay = TRANSPORT_STATUSES.has(task.currentDelivery.phase)
      && task.currentDelivery.phase !== "send-claimed"
      && task.currentDelivery.latestRun;
    const sources = exactDeliverySources(normalized, loaded, task, config, {
      requireLease: !(
        settledReplay
        && task.currentDelivery.phase === "rejected-before-send"
      ),
      requireUnexpiredLease: false,
      ignoreUnrelatedLease: Boolean(
        settledReplay
        && task.currentDelivery.phase === "rejected-before-send"
      ),
      requireActiveArtifact: false,
      requireCurrentBinding: !settledReplay,
    });
    const previousRun = normalized.sendGeneration > 1
      ? sources.runs.find(
        (run) => run.runId === task.currentDelivery.rearmedFrom?.runId,
      ) ?? null
      : null;
    if ((normalized.sendGeneration > 1) !== Boolean(previousRun)) {
      fail("wakeflow-delivery-orchestration-transport", "delivery run prefix is incomplete");
    }
    const runId = deterministicId("delivery-run", {
      deliveryId: normalized.deliveryId,
      sendGeneration: normalized.sendGeneration,
      outcome: normalized.outcome,
    });
    let proposedRun;
    if (settledReplay) {
      proposedRun = sources.runs.find((run) => run.runId === runId) ?? null;
      if (
        !proposedRun
        || !same(runTuple(proposedRun), task.currentDelivery.latestRun)
        || proposedRun.transportStatus !== normalized.outcome.transportStatus
        || proposedRun.hostMethod !== normalized.outcome.hostMethod
        || proposedRun.hostMode !== normalized.outcome.hostMode
        || proposedRun.createdAt !== normalized.outcome.createdAt
        || !same(proposedRun.readback, normalized.outcome.readback)
        || !same(proposedRun.error ?? null, normalized.outcome.error ?? null)
      ) {
        fail("wakeflow-delivery-orchestration-transport", "settled run replay facts differ");
      }
      tracker.proposedRun = proposedRun;
      if (proposedRun.transportStatus === "rejected-before-send" && sources.leaseEntry) {
        releaseDeliveryLease(
          normalized,
          task,
          task.currentDelivery,
          sources.envelope.bindingId,
          mutationContext,
          tracker,
        );
      }
      return outcomeResult(
        "replayed",
        proposedRun,
        loaded.state,
        proposedRun.transportStatus === "rejected-before-send" ? "released" : "retained",
      );
    }
    if (task.currentDelivery.phase !== "send-claimed") {
      fail("wakeflow-delivery-orchestration-state", "delivery outcome requires exact send-claimed state");
    }
    assertOutcomeFollowsExactClaim(loaded, task, normalized.outcome.createdAt);
    proposedRun = createDeliveryRunRecord({
      programId: normalized.expectedProgramId,
      demandId: loaded.demand.demandId,
      runId,
      deliveryId: normalized.deliveryId,
      envelopeDigest: sources.envelope.envelopeDigest,
      hostId: sources.envelope.preparedByHostId,
      windowId: task.windowId,
      attemptOrdinal: normalized.sendGeneration,
      ...(previousRun ? {
        previousRun: {
          runId: previousRun.runId,
          ref: deliveryRunRef({ demandId: previousRun.demandId, runId: previousRun.runId }),
          digest: previousRun.runDigest,
        },
      } : {}),
      hostMethod: normalized.outcome.hostMethod,
      hostMode: normalized.outcome.hostMode,
      transportStatus: normalized.outcome.transportStatus,
      readback: normalized.outcome.readback,
      observedLease: {
        leaseId: sources.leaseEntry.lease.leaseId,
        leaseRef: sources.leaseEntry.leaseRef,
        leaseDigest: sources.leaseEntry.lease.leaseDigest,
      },
      ...(Object.hasOwn(normalized.outcome, "error") ? { error: normalized.outcome.error } : {}),
      createdAt: normalized.outcome.createdAt,
    });
    validateDeliveryRunAgainstSources({
      run: proposedRun,
      envelope: sources.envelope,
      ...(previousRun ? { previousRun } : {}),
      lease: sources.leaseEntry.lease,
    });
    const settlement = settlementEventAndState({ loaded, task, run: proposedRun });
    tracker.proposedRun = proposedRun;
    tracker.intendedTransitions = [settlement];
    const ordinalRun = sources.runs.find(
      (run) => run.attemptOrdinal === normalized.sendGeneration,
    );
    if (ordinalRun && !same(ordinalRun, proposedRun)) {
      fail("wakeflow-delivery-orchestration-transport", "delivery run ordinal already has different facts");
    }
    const publication = callAdmitted(() => appendDeliveryRunAdmitted({
        workspaceRoot: normalized.workspaceRoot,
        programId: normalized.expectedProgramId,
        demandId: loaded.demand.demandId,
        record: proposedRun,
        mutationContext,
      }), "transport", tracker, (candidate) => (
        exactPublicationSuccess(candidate, proposedRun)
      ));
    if (publication.status === "created") tracker.committed = true;
    commitDeliveryTransition(
      normalized,
      config,
      loaded.state,
      settlement.event,
      settlement.nextState,
      tracker,
    );
    let leaseStatus = "retained";
    if (proposedRun.transportStatus === "rejected-before-send") {
      releaseDeliveryLease(
        normalized,
        task,
        settlement.nextDelivery,
        sources.envelope.bindingId,
        mutationContext,
        tracker,
      );
      leaseStatus = "released";
    }
    return outcomeResult("recorded", proposedRun, settlement.nextState, leaseStatus);
  });
}

function normalizeRearmInput(input) {
  exactKeys(
    input,
    [
      "workspaceRoot",
      "stateRoot",
      "expectedProgramId",
      "targetTaskId",
      "deliveryId",
      "expectedRun",
    ],
    [],
    "rearm input",
  );
  const common = normalizeDeliveryOperationInput({
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    targetTaskId: input.targetTaskId,
    deliveryId: input.deliveryId,
  }, "rearm delivery input", { includeGeneration: false });
  exactKeys(input.expectedRun, ["runId", "ref", "digest"], [], "expectedRun");
  return frozen({
    ...common,
    expectedRun: {
      runId: typedId(input.expectedRun.runId, "delivery-run", "expectedRun.runId"),
      ref: text(input.expectedRun.ref, "expectedRun.ref", { maxLength: 1024 }),
      digest: digest(input.expectedRun.digest, "expectedRun.digest"),
    },
  });
}

// rearm 复用同一 envelope，只更新 lease、generation 与授权 event，并保留 rejected run 来源。
function rearmEventAndState({ loaded, task, newLease, createdAt }) {
  const previousState = loaded.state;
  const delivery = task.currentDelivery;
  const nextDelivery = clone(delivery);
  const eventId = deterministicEventId({
    command: "rearm-target-delivery",
    deliveryId: delivery.envelope.deliveryId,
    previousRun: delivery.latestRun,
    previousStateDigest: canonicalJsonDigest(previousState),
  });
  const placeholder = {
    revision: previousState.revision + 1,
    eventId,
    eventDigest: ZERO_DIGEST,
  };
  nextDelivery.phase = "prepared";
  nextDelivery.sendGeneration += 1;
  nextDelivery.lease = leaseTuple(newLease);
  nextDelivery.authorizedBy = placeholder;
  nextDelivery.rearmedFrom = delivery.latestRun;
  delete nextDelivery.claimedBy;
  delete nextDelivery.recordedBy;
  delete nextDelivery.latestRun;
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId,
    demandId: loaded.demand.demandId,
    createdAt,
    actor: "controller",
    command: "rearm-target-delivery",
    type: "target-delivery.rearmed",
    previousRevision: previousState.revision,
    nextRevision: previousState.revision + 1,
    from: previousState.state,
    to: previousState.state,
    reason: "Renew exact pre-send authorization after a proved rejected-before-send run.",
    decisionSummary: "Reuse the immutable envelope without consuming a logical Test attempt.",
    changedArtifacts: [],
    deliveryTransition: {
      targetTaskId: task.targetTaskId,
      deliveryId: delivery.envelope.deliveryId,
      envelopeDigest: delivery.envelope.digest,
      sendGeneration: nextDelivery.sendGeneration,
      fromPhase: "rejected-before-send",
      toPhase: "prepared",
      previousSummaryDigest: demandDeliverySummaryDigest(delivery),
      nextSummaryDigest: demandDeliverySummaryDigest(nextDelivery),
      run: delivery.latestRun,
    },
  };
  const authority = eventAuthority(event);
  nextDelivery.authorizedBy = authority;
  const nextState = clone(previousState);
  nextState.revision = event.nextRevision;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = { eventId, eventDigest: authority.eventDigest };
  nextState.targetTasks.find(
    (entry) => entry.targetTaskId === task.targetTaskId,
  ).currentDelivery = nextDelivery;
  return frozen({ event, nextState, nextDelivery });
}

/**
 * 为精确 rejected-before-send 尾链换发 lease 并递增 generation；不会新增逻辑 Test attempt。
 */
export async function rearmTargetDelivery(input = {}) {
  const normalized = normalizeRearmInput(canonicalDeliveryInput(
    input,
    "rearmTargetDelivery input",
  ));
  return runDeliveryMutation(normalized, "target-delivery-rearm", ({
    config,
    mutationContext,
    tracker,
  }) => {
    const loaded = loadStateWhileLocked(normalized, config);
    rememberFailureBaseline(tracker, normalized, config, loaded);
    const task = loaded.state.targetTasks.find(
      (entry) => entry.targetTaskId === normalized.targetTaskId,
    );
    if (!task?.currentDelivery) {
      fail("wakeflow-delivery-orchestration-state", "rearm target has no current delivery");
    }
    if (
      task.currentDelivery.phase === "prepared"
      && same(task.currentDelivery.rearmedFrom ?? null, {
        ...normalized.expectedRun,
        attemptOrdinal: task.currentDelivery.sendGeneration - 1,
        transportStatus: "rejected-before-send",
        readbackStatus: "unavailable",
      })
    ) {
      const sources = exactDeliverySources(normalized, loaded, task, config);
      return frozen({
        status: "replayed",
        deliveryId: normalized.deliveryId,
        sendGeneration: task.currentDelivery.sendGeneration,
        newLease: leaseTuple({ lease: sources.leaseEntry.lease, leaseRef: sources.leaseEntry.leaseRef }),
        currentDelivery: task.currentDelivery,
        revision: loaded.state.revision,
        stateDigest: loaded.digests.state,
      });
    }
    if (
      task.currentDelivery.phase !== "rejected-before-send"
      || task.lifecycleStatus !== "dispatched"
      || loaded.state.state !== "dispatched"
      || loaded.state.review.status !== "idle"
      || task.currentDelivery.latestRun.runId !== normalized.expectedRun.runId
      || task.currentDelivery.latestRun.ref !== normalized.expectedRun.ref
      || task.currentDelivery.latestRun.digest !== normalized.expectedRun.digest
    ) {
      fail("wakeflow-delivery-orchestration-state", "rearm requires exact active rejected delivery tail");
    }
    const sources = exactDeliverySources(normalized, loaded, task, config, {
      requireLease: false,
      allowReplacementLease: true,
    });
    const priorRun = sources.runs.find((run) => run.runId === normalized.expectedRun.runId);
    if (
      !priorRun
      || priorRun.runDigest !== normalized.expectedRun.digest
      || deliveryRunRef({ demandId: priorRun.demandId, runId: priorRun.runId })
        !== normalized.expectedRun.ref
      || priorRun.transportStatus !== "rejected-before-send"
      || priorRun.readback.status !== "unavailable"
      || priorRun.readback.attempts !== 0
      || priorRun.readback.evidence.length !== 0
      || priorRun.attemptOrdinal !== task.currentDelivery.sendGeneration
      || sources.runs.at(-1)?.runId !== priorRun.runId
    ) {
      fail("wakeflow-delivery-orchestration-transport", "rearm run is not the exact rejected chain tail");
    }
    assertDeliveryOnlySuffix(
      loaded,
      task.targetTaskId,
      task.currentDelivery.recordedBy.revision,
    );
    let newLease;
    if (sources.leaseEntry) {
      newLease = frozen({
        status: "replayed",
        leaseRef: sources.leaseEntry.leaseRef,
        lease: sources.leaseEntry.lease,
      });
      if (
        newLease.lease.leaseId === task.currentDelivery.lease.leaseId
        || newLease.lease.leaseDigest === task.currentDelivery.lease.digest
      ) {
        fail(
          "wakeflow-delivery-orchestration-lease",
          "rejected delivery still holds its released-generation coordination lease",
        );
      }
      if (Date.parse(newLease.lease.expiresAt) <= Date.now()) {
        fail(
          "wakeflow-delivery-orchestration-lease",
          "pending rearm coordination lease is expired",
        );
      }
    } else {
      newLease = callAdmitted(() => acquireWindowCoordinationLeaseAdmitted({
        workspaceRoot: normalized.workspaceRoot,
        windowId: task.windowId,
        demandId: loaded.demand.demandId,
        targetTaskId: task.targetTaskId,
        groupId: sources.group.groupId,
        groupDigest: sources.group.groupDigest,
        deliveryId: sources.envelope.deliveryId,
        envelopeDigest: sources.envelope.envelopeDigest,
        bindingId: sources.envelope.bindingId,
        identityBindingDigest: sources.envelope.identityBindingDigest,
        mutationContext,
      }), "lease", tracker, (candidate) => exactLeaseSuccess(
        candidate,
        ["created", "replayed"],
        {
          programId: normalized.expectedProgramId,
          hostId: sources.envelope.preparedByHostId,
          windowId: task.windowId,
          demandId: loaded.demand.demandId,
          targetTaskId: task.targetTaskId,
          groupId: sources.group.groupId,
          groupDigest: sources.group.groupDigest,
          deliveryId: sources.envelope.deliveryId,
          envelopeDigest: sources.envelope.envelopeDigest,
          bindingId: sources.envelope.bindingId,
          identityBindingDigest: sources.envelope.identityBindingDigest,
        },
      ));
    }
    if (newLease.status === "created") tracker.committed = true;
    const nextLeaseTuple = leaseTuple(newLease);
    if (
      nextLeaseTuple.leaseId === task.currentDelivery.lease.leaseId
      || nextLeaseTuple.digest === task.currentDelivery.lease.digest
    ) {
      fail(
        "wakeflow-delivery-orchestration-recovery-required",
        "rearm did not acquire a distinct coordination lease generation",
      );
    }
    const transition = rearmEventAndState({
      loaded,
      task,
      newLease,
      createdAt: afterLatestTimestamp(
        loaded.state.updatedAt,
        priorRun.createdAt,
        newLease.lease.acquiredAt,
      ),
    });
    tracker.rearmLease = newLease;
    tracker.intendedTransitions = [transition];
    commitDeliveryTransition(
      normalized,
      config,
      loaded.state,
      transition.event,
      transition.nextState,
      tracker,
    );
    return frozen({
      status: "rearmed",
      deliveryId: normalized.deliveryId,
      sendGeneration: transition.nextDelivery.sendGeneration,
      newLease: nextLeaseTuple,
      currentDelivery: transition.nextDelivery,
      revision: transition.nextState.revision,
      stateDigest: canonicalJsonDigest(transition.nextState),
    });
  });
}
