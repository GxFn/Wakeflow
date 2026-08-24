/**
 * 结果审查编排边界。
 *
 * 本模块把一条结果链拆成五个彼此可核验、但不互相冒充 authority 的步骤：
 * 1. 从已落盘 transport 导入 TargetResult，并在状态提交后释放精确 delivery lease；
 * 2. 联合 demand state、transport 与 TargetResult authority，生成只读 group/trace 视图；
 * 3. 固化 ReviewCandidate artifact，但不替 Controller 作决定；
 * 4. 把 Controller 决定作为独立 event/state transition 提交；
 * 5. 规划、发布并记录 Controller-return transport，且不把“已发送”解释为“已接受”。
 *
 * 写入职责仍由 demand artifact/state service、transport store 与 lease service 各自持有。
 * 本模块只证明跨 owner 的精确闭包与顺序，不拥有新的持久化格式，也不验证结果内容真假。
 */
import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import {
  createReviewCandidateArtifact,
  recordTargetResultArtifact,
} from "./wakeflow-demand-artifact-service.mjs";
import {
  demandArtifactIdentity,
  loadDemandArtifactByRef,
  validateReviewCandidateArtifact,
  validateTargetResultArtifact,
} from "./wakeflow-demand-artifact-records.mjs";
import {
  validateControllerEventRecord,
  validateDemandStateRecord,
} from "./wakeflow-demand-core-records.mjs";
import {
  commitDemandReviewDecisionWhileLocked,
  loadDemandCoreRecordsWithArtifactClosure,
  loadDemandCoreRecordsWithArtifactClosureWhileLocked,
  recoverDemandReviewDecisionWhileLocked,
  recoverDemandStateTransition,
} from "./wakeflow-demand-state-service.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  buildTargetResultAuthoritySnapshotFromLoaded,
} from "./wakeflow-target-result-authority.mjs";
import {
  createControllerReturnEnvelopeRecord,
  createDeliveryRunRecord,
  deliveryEnvelopeRef,
  deliveryRunRef,
  WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND,
  WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND,
} from "./wakeflow-transport-records.mjs";
import {
  appendDeliveryRunAdmitted,
  inspectTransportDemandAuthority,
  inspectTransportDemandForLayout,
  publishDeliveryEnvelopeAdmitted,
} from "./wakeflow-transport-store.mjs";
import { inspectWindowBindingInventory } from "./wakeflow-window-binding-service.mjs";
import {
  inspectWindowCoordinationLeaseInventory,
  releaseWindowCoordinationLeaseAdmitted,
} from "./wakeflow-window-lease-service.mjs";
import { withStateRootLock } from "./wakeflow-state-lock.mjs";
import { withWakeflowRuntimeMutation } from "./wakeflow-workspace-mutation.mjs";

const TERMINAL_DEMAND_STATES = new Set(["archived", "cancelled", "completed"]);
const CLOSED_TASK_STATES = new Set(["accepted", "cancelled", "superseded"]);
const RESULT_SELECTION_BY_COMMAND = Object.freeze({
  "record-target-result-current": "current",
  "record-target-result-historical": "historical",
});
const HUMAN_CONTROL_RE = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

export class WakeflowResultReviewOrchestrationError extends Error {
  constructor(code, message, { cause, ...details } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowResultReviewOrchestrationError";
    this.code = code;
    this.details = Object.freeze({ code, ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowResultReviewOrchestrationError(code, message, {
    ...details,
    cause,
  });
}

function boundary(scope, cause, message) {
  if (cause instanceof WakeflowResultReviewOrchestrationError) throw cause;
  fail(`wakeflow-result-review-${scope}`, message, {
    causeCode: typeof cause?.code === "string" ? cause.code : null,
  }, cause);
}

/**
 * 在读取任何业务字段前，把公开入口参数收敛为无行为的 canonical plain-data 快照。
 * 这样 accessor、不可枚举字段、Symbol 与外来原型都不能绕过 exact-key 合同。
 */
function canonicalReviewInput(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-result-review-contract", `${label} must contain only canonical plain data`, {
      causeCode: typeof cause?.code === "string" ? cause.code : null,
    }, cause);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozen(value) {
  return deepFreeze(structuredClone(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, required, optional, label) {
  if (!isPlainObject(value)) {
    fail("wakeflow-result-review-contract", `${label} must be one plain object`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("wakeflow-result-review-contract", `${label} contains unknown field ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-result-review-contract", `${label} is missing ${key}`);
    }
  }
  return value;
}

function root(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    fail("wakeflow-result-review-contract", `${label} is required`);
  }
  return value;
}

function typedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, label);
  } catch (cause) {
    boundary("contract", cause, `${label} must be one typed ${type} ID`);
  }
}

function token(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || /[\u0000-\u001F\u007F-\u009F]/u.test(value)
  ) {
    fail("wakeflow-result-review-contract", `${label} must be one trimmed control-free token`);
  }
  return value;
}

function humanText(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || HUMAN_CONTROL_RE.test(value)
  ) {
    fail(
      "wakeflow-result-review-contract",
      `${label} must be non-empty, trimmed, and control-free except line breaks`,
    );
  }
  return value;
}

function loadConfig(input) {
  let config;
  try {
    config = loadWakeflowConfigV3Snapshot({ workspaceRoot: input.workspaceRoot });
  } catch (cause) {
    boundary("config", cause, "strict Wakeflow v3 config is unavailable");
  }
  if (config.model.program.programId !== input.expectedProgramId) {
    fail("wakeflow-result-review-config", "expectedProgramId does not own wakeflow.config.json");
  }
  return config;
}

function loadState(input, config) {
  try {
    return loadDemandCoreRecordsWithArtifactClosure({
      stateRoot: input.stateRoot,
      expectedProgramId: input.expectedProgramId,
      ledgerRoot: config.ledgerRoot,
    });
  } catch (cause) {
    boundary("state", cause, "strict demand state authority is unavailable");
  }
}

function loadStateWhileLocked(input, config) {
  try {
    return loadDemandCoreRecordsWithArtifactClosureWhileLocked({
      stateRoot: input.stateRoot,
      expectedProgramId: input.expectedProgramId,
      ledgerRoot: config.ledgerRoot,
    });
  } catch (cause) {
    boundary("state", cause, "strict locked demand state authority is unavailable");
  }
}

function loadTransport(input, loaded) {
  try {
    return inspectTransportDemandAuthority({
      workspaceRoot: input.workspaceRoot,
      programId: input.expectedProgramId,
      demandId: loaded.demand.demandId,
    });
  } catch (cause) {
    boundary("transport", cause, "strict delivery transport authority is unavailable");
  }
}

function loadLeases(input) {
  try {
    return inspectWindowCoordinationLeaseInventory({ workspaceRoot: input.workspaceRoot });
  } catch (cause) {
    boundary("lease", cause, "strict coordination lease authority is unavailable");
  }
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

// authority 数组必须按 Unicode code unit 稳定排序，不能依赖进程 locale。
function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameGroupTuple(resultTuple, stateTuple) {
  return Boolean(
    resultTuple
    && stateTuple
    && resultTuple.id === stateTuple.groupId
    && resultTuple.ref === stateTuple.ref
    && resultTuple.digest === stateTuple.digest
  );
}

function samePacketTuple(record, stateTuple) {
  return Boolean(
    record
    && stateTuple
    && record.packetId === stateTuple.packetId
    && record.packetRef === stateTuple.ref
    && record.packetDigest === stateTuple.digest
  );
}

function sameEnvelopeTuple(resultTuple, stateTuple) {
  return Boolean(
    resultTuple
    && stateTuple
    && resultTuple.id === stateTuple.deliveryId
    && resultTuple.ref === stateTuple.ref
    && resultTuple.digest === stateTuple.digest
  );
}

function resultTuple(record, identity = demandArtifactIdentity(record)) {
  return frozen({
    targetTaskId: record.targetTaskId,
    targetResultId: record.targetResultId,
    ref: identity.ref,
    digest: identity.digest,
    outcome: record.outcome,
  });
}

function runTuple(entry) {
  return frozen({
    runId: entry.record.runId,
    ref: entry.ref,
    digest: entry.digest,
    attemptOrdinal: entry.record.attemptOrdinal,
    transportStatus: entry.record.transportStatus,
    readbackStatus: entry.record.readback.status,
  });
}

function exactCommittedResult(loaded, identity, transition) {
  const matches = loaded.events.filter((event) => event.changedArtifacts.some((change) => (
    change.artifactKind === "wakeflow-target-result"
    && change.artifactId === identity.artifactId
  )));
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    fail("wakeflow-result-review-result-closure", "one TargetResult ID has multiple committing events");
  }
  const event = matches[0];
  const change = event.changedArtifacts.find((entry) => (
    entry.artifactKind === "wakeflow-target-result"
    && entry.artifactId === identity.artifactId
  ));
  if (change.ref !== identity.ref || change.digest !== identity.digest) {
    fail("wakeflow-result-review-result-conflict", "TargetResult ID is already bound to different bytes");
  }
  const selection = RESULT_SELECTION_BY_COMMAND[event.command];
  if (
    !selection
    || event.type !== "target-result.recorded"
    || event.eventId !== transition.eventId
    || event.createdAt !== transition.createdAt
    || event.reason !== transition.reason
    || event.decisionSummary !== transition.decisionSummary
  ) {
    fail("wakeflow-result-review-result-conflict", "TargetResult is already bound to a different event intent");
  }
  const stateTuple = loaded.state.targetResults.find((entry) => (
    entry.targetResultId === identity.artifactId
    && entry.ref === identity.ref
    && entry.digest === identity.digest
  ));
  if (!stateTuple) {
    fail("wakeflow-result-review-result-closure", "committed TargetResult is absent from state inventory");
  }
  return frozen({ event, selection, stateTuple });
}

// 证明结果引用的 group、packet、envelope、run 与 settlement event 构成同一条不可变 transport 尾链。
function exactTargetTransportClosure({ input, loaded, inventory, artifact }) {
  const groupEntry = inventory.entries.groups.find((entry) => (
    entry.record.groupId === artifact.transport.group.id
    && entry.ref === artifact.transport.group.ref
    && entry.digest === artifact.transport.group.digest
  ));
  if (!groupEntry) {
    fail("wakeflow-result-review-result-transport", "TargetResult group tuple is not exact T06 authority");
  }
  const member = groupEntry.record.members.find((entry) => (
    entry.targetTaskId === artifact.targetTaskId
  ));
  if (!member) {
    fail("wakeflow-result-review-result-transport", "TargetResult target is not a dispatch-group member");
  }
  const packetEntry = inventory.entries.packets.find((entry) => (
    entry.record.packetId === member.packetId
    && entry.record.groupId === groupEntry.record.groupId
  ));
  if (!packetEntry) {
    fail("wakeflow-result-review-result-transport", "TargetResult has no exact group member packet");
  }
  const envelopeEntry = inventory.entries.envelopes.find((entry) => (
    entry.record.deliveryId === artifact.transport.envelope.id
    && entry.ref === artifact.transport.envelope.ref
    && entry.digest === artifact.transport.envelope.digest
  ));
  if (
    !envelopeEntry
    || envelopeEntry.record.artifactKind !== WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND
    || envelopeEntry.record.groupId !== groupEntry.record.groupId
    || envelopeEntry.record.groupRef !== groupEntry.ref
    || envelopeEntry.record.groupDigest !== groupEntry.digest
    || envelopeEntry.record.packetId !== packetEntry.record.packetId
    || envelopeEntry.record.packetRef !== packetEntry.ref
    || envelopeEntry.record.packetDigest !== packetEntry.digest
  ) {
    fail("wakeflow-result-review-result-transport", "TargetResult envelope is not the exact target group/packet envelope");
  }
  const task = loaded.state.targetTasks.find((entry) => entry.targetTaskId === artifact.targetTaskId);
  if (!task || ["cancelled", "superseded"].includes(task.lifecycleStatus)) {
    fail("wakeflow-result-review-result-task", "TargetResult requires one existing non-cancelled target task");
  }
  const packageState = loaded.state.taskPackages.find((entry) => (
    entry.taskPackageId === task.taskPackageId
  ));
  if (
    !packageState
    || artifact.taskPackage.taskPackageId !== packageState.taskPackageId
    || artifact.taskPackage.ref !== packageState.ref
    || artifact.taskPackage.digest !== packageState.digest
    || packetEntry.record.taskPackageId !== packageState.taskPackageId
    || packetEntry.record.taskPackageRef !== packageState.ref
    || packetEntry.record.taskPackageDigest !== packageState.digest
    || packetEntry.record.targetTaskId !== task.targetTaskId
    || packetEntry.record.windowId !== task.windowId
    || member.windowId !== task.windowId
    || artifact.assignment.windowId !== task.windowId
    || (artifact.assignment.repositoryId ?? null) !== (task.repositoryId ?? null)
  ) {
    fail("wakeflow-result-review-result-package", "TargetResult task/package/assignment differs from T06 and state authority");
  }
  const runs = inventory.entries.runs
    .filter((entry) => entry.record.deliveryId === envelopeEntry.record.deliveryId)
    .sort((left, right) => left.record.attemptOrdinal - right.record.attemptOrdinal);
  const tail = runs.at(-1) ?? null;
  if (!tail || !["accepted", "ambiguous"].includes(tail.record.transportStatus)) {
    fail("wakeflow-result-review-result-run", "TargetResult requires an accepted or ambiguous delivery run tail");
  }
  const tailTuple = runTuple(tail);
  const settlementEvents = loaded.events.filter((event) => (
    event.command === "record-target-delivery-run"
    && event.type === "target-delivery.run-recorded"
    && event.deliveryTransition?.targetTaskId === task.targetTaskId
    && event.deliveryTransition?.deliveryId === envelopeEntry.record.deliveryId
    && event.deliveryTransition?.envelopeDigest === envelopeEntry.digest
    && same(event.deliveryTransition?.run, tailTuple)
  ));
  if (settlementEvents.length !== 1) {
    fail("wakeflow-result-review-result-settlement", "TargetResult run has no unique T07 state settlement event");
  }
  const currentDeliveryMatch = Boolean(
    task.currentDelivery
    && sameGroupTuple(artifact.transport.group, task.currentDelivery.group)
    && task.currentDelivery.packet.packetId === packetEntry.record.packetId
    && task.currentDelivery.packet.ref === packetEntry.ref
    && task.currentDelivery.packet.digest === packetEntry.digest
    && sameEnvelopeTuple(artifact.transport.envelope, task.currentDelivery.envelope)
  );
  if (currentDeliveryMatch) {
    if (
      !["accepted", "ambiguous"].includes(task.currentDelivery.phase)
      || !same(task.currentDelivery.latestRun, tailTuple)
      || task.currentDelivery.recordedBy.eventId !== settlementEvents[0].eventId
      || task.currentDelivery.recordedBy.eventDigest !== canonicalJsonDigest(settlementEvents[0])
    ) {
      fail("wakeflow-result-review-result-settlement", "current result envelope is not exact settled currentDelivery authority");
    }
  }
  if (Array.isArray(task.testAttempts)) {
    const authorizations = task.testAttempts.flatMap((attempt) => (
      attempt.deliveryAuthorizations.map((authorization) => ({ attempt, authorization }))
    ));
    const matching = authorizations.filter(({ authorization }) => (
      authorization.group.groupId === groupEntry.record.groupId
      && authorization.group.ref === groupEntry.ref
      && authorization.group.digest === groupEntry.digest
      && authorization.packet.packetId === packetEntry.record.packetId
      && authorization.packet.ref === packetEntry.ref
      && authorization.packet.digest === packetEntry.digest
      && authorization.envelope.deliveryId === envelopeEntry.record.deliveryId
      && authorization.envelope.ref === envelopeEntry.ref
      && authorization.envelope.digest === envelopeEntry.digest
    ));
    if (matching.length !== 1) {
      fail("wakeflow-result-review-result-test-attempt", "Test TargetResult must match one exact delivery authorization");
    }
    if (currentDeliveryMatch) {
      const latestAttempt = task.testAttempts.at(-1);
      const latestAuthorization = latestAttempt.deliveryAuthorizations.at(-1);
      if (
        matching[0].attempt.testAttemptId !== latestAttempt.testAttemptId
        || matching[0].authorization.ordinal !== latestAuthorization.ordinal
        || task.currentDelivery.testAttemptId !== latestAttempt.testAttemptId
      ) {
        fail("wakeflow-result-review-result-test-attempt", "current Test result must select the latest exact attempt authorization");
      }
    }
  }
  return frozen({
    groupEntry,
    member,
    packetEntry,
    envelopeEntry,
    runs,
    tail,
    tailTuple,
    settlementEvent: settlementEvents[0],
    task,
    packageState,
    currentDeliveryMatch,
  });
}

function loadCurrentResult(loaded, task) {
  if (!task.currentResult) return null;
  try {
    return loadDemandArtifactByRef({
      stateRoot: loaded.paths.stateRoot,
      ref: task.currentResult.ref,
      digest: task.currentResult.digest,
      expectedArtifactKind: "wakeflow-target-result",
      expectedArtifactId: task.currentResult.targetResultId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
    }).record;
  } catch (cause) {
    boundary("result", cause, "state-selected current TargetResult is unavailable");
  }
}

function sameResultRound(left, right) {
  return Boolean(
    left
    && right
    && left.taskPackage.taskPackageId === right.taskPackage.taskPackageId
    && left.taskPackage.ref === right.taskPackage.ref
    && left.taskPackage.digest === right.taskPackage.digest
    && left.transport.group.id === right.transport.group.id
    && left.transport.group.ref === right.transport.group.ref
    && left.transport.group.digest === right.transport.group.digest
    && left.transport.envelope.id === right.transport.envelope.id
    && left.transport.envelope.ref === right.transport.envelope.ref
    && left.transport.envelope.digest === right.transport.envelope.digest
  );
}

function findExactLease(leaseInventory, closure, loaded) {
  const delivery = closure.task.currentDelivery;
  if (!delivery || !closure.currentDeliveryMatch) return null;
  const matches = leaseInventory.leases.filter((entry) => (
    entry.lease.programId === loaded.demand.programId
    && entry.lease.windowId === closure.task.windowId
    && entry.lease.demandId === loaded.demand.demandId
    && entry.lease.targetTaskId === closure.task.targetTaskId
    && entry.lease.groupId === closure.groupEntry.record.groupId
    && entry.lease.groupRef === closure.groupEntry.ref
    && entry.lease.groupDigest === closure.groupEntry.digest
    && entry.lease.deliveryId === closure.envelopeEntry.record.deliveryId
    && entry.lease.envelopeRef === closure.envelopeEntry.ref
    && entry.lease.envelopeDigest === closure.envelopeEntry.digest
    && entry.lease.bindingId === closure.envelopeEntry.record.bindingId
    && entry.lease.identityBindingDigest === closure.envelopeEntry.record.identityBindingDigest
    && entry.lease.leaseId === delivery.lease.leaseId
    && entry.leaseRef === delivery.lease.ref
    && entry.lease.leaseDigest === delivery.lease.digest
  ));
  if (matches.length > 1) {
    fail("wakeflow-result-review-lease", "current result envelope has multiple exact coordination leases");
  }
  return matches[0] ?? null;
}

function normalizeTransition(value) {
  exactKeys(value, ["eventId", "createdAt", "reason", "decisionSummary"], [], "transition");
  return frozen({
    eventId: token(value.eventId, "transition.eventId"),
    createdAt: token(value.createdAt, "transition.createdAt"),
    reason: humanText(value.reason, "transition.reason"),
    decisionSummary: humanText(value.decisionSummary, "transition.decisionSummary"),
  });
}

function normalizeRecordResultInput(value) {
  exactKeys(value, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "artifact",
    "transition",
  ], [], "recordTargetResultFromTransport input");
  let artifact;
  try {
    artifact = validateTargetResultArtifact(value.artifact);
  } catch (cause) {
    boundary("contract", cause, "TargetResult artifact is invalid");
  }
  return frozen({
    workspaceRoot: root(value.workspaceRoot, "workspaceRoot"),
    stateRoot: root(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    artifact,
    transition: normalizeTransition(value.transition),
  });
}

// 在写入前分类首次结果、同轮修正、新一轮结果与迟到历史结果，并冻结全部跨 owner 基线。
function deriveResultPreflight(input, config) {
  const loaded = loadState(input, config);
  if (TERMINAL_DEMAND_STATES.has(loaded.state.state)) {
    fail("wakeflow-result-review-state", `TargetResult cannot mutate terminal demand ${loaded.state.state}`);
  }
  if (
    input.artifact.programId !== loaded.demand.programId
    || input.artifact.demandId !== loaded.demand.demandId
    || input.artifact.demandRef !== "demand.json"
    || input.artifact.demandDigest !== loaded.digests.demand
  ) {
    fail("wakeflow-result-review-result-demand", "TargetResult does not bind the exact demand authority");
  }
  const identity = demandArtifactIdentity(input.artifact);
  const committed = exactCommittedResult(loaded, identity, input.transition);
  const transport = loadTransport(input, loaded);
  const closure = exactTargetTransportClosure({
    input,
    loaded,
    inventory: transport,
    artifact: input.artifact,
  });
  const currentRecord = loadCurrentResult(loaded, closure.task);
  let selection;
  let roundRelation;
  if (committed) {
    selection = committed.selection;
    roundRelation = "exact-replay";
  } else if (!closure.currentDeliveryMatch) {
    selection = "historical";
    roundRelation = "late-envelope";
  } else if (!currentRecord) {
    selection = "current";
    roundRelation = "first-current";
  } else if (sameResultRound(currentRecord, input.artifact)) {
    selection = "current";
    roundRelation = "same-envelope-correction";
  } else {
    selection = "current";
    roundRelation = "new-envelope-round";
  }
  if (!committed && selection === "historical" && input.artifact.supersedes) {
    const superseded = loaded.state.targetResults.find((entry) => (
      entry.targetResultId === input.artifact.supersedes.targetResultId
      && entry.ref === input.artifact.supersedes.ref
      && entry.digest === input.artifact.supersedes.digest
      && entry.lifecycleStatus === "historical"
    ));
    if (!superseded) {
      fail("wakeflow-result-review-result-supersedes", "historical correction must name an exact historical result");
    }
  }
  if (!committed && CLOSED_TASK_STATES.has(closure.task.lifecycleStatus) && selection !== "historical") {
    fail("wakeflow-result-review-result-task", "a closed target task cannot select a new current result");
  }
  const leases = loadLeases(input);
  const exactLease = findExactLease(leases, closure, loaded);
  if (
    !committed
    && selection === "current"
    && ["first-current", "new-envelope-round"].includes(roundRelation)
    && !exactLease
  ) {
    fail("wakeflow-result-review-lease", "a new current result requires its exact retained delivery lease");
  }
  return frozen({
    configDigest: config.configDigest,
    loaded,
    identity,
    committed,
    transport,
    closure,
    currentRecord,
    selection,
    roundRelation,
    leases,
    exactLease,
  });
}

function failureSnapshot(preflight) {
  return frozen({
    configDigest: preflight.configDigest,
    stateDigest: preflight.loaded.digests.state,
    eventsDigest: canonicalJsonDigest(preflight.loaded.events),
    transportDigest: preflight.transport.inventoryDigest,
    leaseDigest: preflight.leases.inventoryDigest,
  });
}

function safeReleaseVerdict(name, value) {
  return {
    disposition: "safe-to-release",
    closureDigests: [{ name, digest: canonicalJsonDigest(value) }],
  };
}

function assertLeaseForwardClosure(baseline, current, preflight) {
  if (baseline.inventoryDigest === current.leases.inventoryDigest) return "lease-retained";
  if (preflight.selection !== "current" || !preflight.exactLease) {
    fail("wakeflow-result-review-recovery-required", "result failure changed a non-applicable lease inventory");
  }
  const expected = baseline.leases.filter((entry) => (
    entry.leaseRef !== preflight.exactLease.leaseRef
  ));
  if (!same(expected, current.leases.leases)) {
    fail("wakeflow-result-review-recovery-required", "result failure changed a successor or unrelated lease");
  }
  return "lease-released";
}

// callback 失败后只接受“完全未写”或“精确结果已提交且精确 lease 已前进”两种闭包。
function verifyResultFailureClosure(input, config, tracker) {
  if (!tracker.baseline || !tracker.preflight) {
    fail("wakeflow-result-review-recovery-required", "result failure has no strict prewrite baseline");
  }
  try {
    recoverDemandStateTransition({
      stateRoot: input.stateRoot,
      expectedProgramId: input.expectedProgramId,
      ledgerRoot: config.ledgerRoot,
      admitRecoveryWhileLocked: ({ loaded, candidateWrite }) => {
        if (
          candidateWrite?.artifactKind !== "wakeflow-target-result"
          || candidateWrite.ref !== tracker.preflight.identity.ref
          || candidateWrite.digest !== tracker.preflight.identity.digest
          || !same(candidateWrite.value, input.artifact)
          || loaded.journal.nextEvent.command
            !== (tracker.preflight.selection === "current"
              ? "record-target-result-current"
              : "record-target-result-historical")
        ) {
          fail("wakeflow-result-review-recovery-required", "pending state journal is not the intended TargetResult transition");
        }
      },
    });
  } catch (cause) {
    boundary("recovery-required", cause, "TargetResult state journal cannot be closed exactly");
  }
  const current = deriveResultPreflight(input, config);
  if (
    current.configDigest !== tracker.baseline.configDigest
    || current.transport.inventoryDigest !== tracker.preflight.transport.inventoryDigest
  ) {
    fail("wakeflow-result-review-recovery-required", "result failure changed config or transport authority");
  }
  const currentSnapshot = failureSnapshot(current);
  const stateUnchanged = (
    currentSnapshot.stateDigest === tracker.baseline.stateDigest
    && currentSnapshot.eventsDigest === tracker.baseline.eventsDigest
  );
  const exactCommitted = Boolean(current.committed);
  if (!stateUnchanged && !exactCommitted) {
    fail("wakeflow-result-review-recovery-required", "result failure is neither unchanged nor exact committed state");
  }
  if (stateUnchanged && currentSnapshot.leaseDigest !== tracker.baseline.leaseDigest) {
    fail("wakeflow-result-review-recovery-required", "lease changed before TargetResult state authority committed");
  }
  const leaseStatus = stateUnchanged
    ? "lease-unchanged"
    : assertLeaseForwardClosure({
      inventoryDigest: tracker.baseline.leaseDigest,
      leases: tracker.preflight.leases.leases,
    }, current, tracker.preflight);
  return safeReleaseVerdict("target-result-authority-closure", {
    state: stateUnchanged ? "unchanged" : "committed",
    leaseStatus,
    stateDigest: current.loaded.digests.state,
    eventsDigest: canonicalJsonDigest(current.loaded.events),
    transportDigest: current.transport.inventoryDigest,
    leaseDigest: current.leases.inventoryDigest,
  });
}

/**
 * 导入一个已有严格 transport 证据的 TargetResult；状态提交成功后才释放对应 delivery lease。
 */
export async function recordTargetResultFromTransport(value = {}) {
  const input = normalizeRecordResultInput(canonicalReviewInput(
    value,
    "recordTargetResultFromTransport input",
  ));
  const config = loadConfig(input);
  deriveResultPreflight(input, config);
  const tracker = { baseline: null, preflight: null };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "target-result-import",
      domainOwner: "result-review-runtime",
      onCallbackFailure: () => verifyResultFailureClosure(input, config, tracker),
    }, (mutationContext) => {
      const preflight = deriveResultPreflight(input, config);
      tracker.preflight = preflight;
      tracker.baseline = failureSnapshot(preflight);
      const commit = recordTargetResultArtifact({
        stateRoot: input.stateRoot,
        expectedProgramId: input.expectedProgramId,
        ledgerRoot: config.ledgerRoot,
        config: config.model,
        expectedPrevious: {
          revision: preflight.loaded.state.revision,
          stateDigest: preflight.loaded.digests.state,
        },
        artifact: input.artifact,
        transition: input.transition,
        selection: preflight.selection,
      });
      const after = deriveResultPreflight(input, config);
      if (!after.committed) {
        fail("wakeflow-result-review-result-closure", "TargetResult commit did not become exact state authority");
      }
      let leaseStatus = "not-applicable";
      if (after.selection === "current" && after.closure.currentDeliveryMatch) {
        const currentLease = findExactLease(after.leases, after.closure, after.loaded);
        if (currentLease) {
          const release = releaseWindowCoordinationLeaseAdmitted({
            workspaceRoot: input.workspaceRoot,
            windowId: after.closure.task.windowId,
            leaseId: currentLease.lease.leaseId,
            deliveryId: currentLease.lease.deliveryId,
            bindingId: currentLease.lease.bindingId,
            leaseDigest: currentLease.lease.leaseDigest,
            mutationContext,
          });
          if (release.outcome !== "success") {
            fail("wakeflow-result-review-lease", release.message, release.details);
          }
          leaseStatus = "released";
        } else {
          leaseStatus = "already-released";
        }
      }
      const closed = loadState(input, config);
      const stateTuple = closed.state.targetResults.find((entry) => (
        entry.targetResultId === preflight.identity.artifactId
        && entry.ref === preflight.identity.ref
        && entry.digest === preflight.identity.digest
      ));
      if (!stateTuple) {
        fail("wakeflow-result-review-result-closure", "committed TargetResult disappeared before return");
      }
      return frozen({
        status: preflight.committed ? "replayed" : "recorded",
        disposition: after.committed.selection,
        roundRelation: preflight.roundRelation,
        leaseStatus,
        artifact: preflight.identity,
        revision: closed.state.revision,
        stateDigest: closed.digests.state,
      });
    });
  } catch (cause) {
    boundary("record", cause, "TargetResult transport import failed closed");
  }
}

function normalizeGroupInspectInput(value, { allowMode = false } = {}) {
  exactKeys(value, ["workspaceRoot", "stateRoot", "expectedProgramId"], [
    "groupId",
    ...(allowMode ? ["mode"] : []),
  ], "dispatch-group review input");
  return frozen({
    workspaceRoot: root(value.workspaceRoot, "workspaceRoot"),
    stateRoot: root(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    ...(value.groupId === undefined
      ? {}
      : { groupId: typedId(value.groupId, "dispatch-group", "groupId") }),
    ...(allowMode ? { mode: value.mode ?? "strict" } : {}),
  });
}

// 把 state、transport 与结果 authority 联结成 group review 快照；它只分类，不产生审查决定。
function buildGroupReviewSnapshot(input, config, loaded, transport, groupId) {
  const groupEntry = transport.entries.groups.find((entry) => entry.record.groupId === groupId);
  if (!groupEntry) {
    fail("wakeflow-result-review-group", `dispatch group ${groupId} is absent from strict transport authority`);
  }
  const authority = buildTargetResultAuthoritySnapshotFromLoaded(loaded);
  const artifactById = new Map(authority.artifacts.map((entry) => [entry.targetResultId, entry]));
  const members = groupEntry.record.members.map((member) => {
    const task = loaded.state.targetTasks.find((entry) => entry.targetTaskId === member.targetTaskId);
    const packet = transport.entries.packets.find((entry) => entry.record.packetId === member.packetId);
    if (!task || !packet) {
      fail("wakeflow-result-review-group", "dispatch group member lacks exact state task or packet authority");
    }
    let status = "pending-dispatch";
    let envelopeTuple = null;
    let run = null;
    let selectedResult = null;
    if (task.currentDelivery && task.currentDelivery.group.groupId === groupId) {
      if (
        task.currentDelivery.group.ref !== groupEntry.ref
        || task.currentDelivery.group.digest !== groupEntry.digest
        || task.currentDelivery.packet.packetId !== packet.record.packetId
        || task.currentDelivery.packet.ref !== packet.ref
        || task.currentDelivery.packet.digest !== packet.digest
      ) {
        fail("wakeflow-result-review-group", "state currentDelivery differs from exact group/packet authority");
      }
      const envelope = transport.entries.envelopes.find((entry) => (
        entry.record.deliveryId === task.currentDelivery.envelope.deliveryId
        && entry.ref === task.currentDelivery.envelope.ref
        && entry.digest === task.currentDelivery.envelope.digest
      ));
      if (!envelope || envelope.record.artifactKind !== WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND) {
        fail("wakeflow-result-review-group", "state currentDelivery envelope is absent from strict target transport");
      }
      envelopeTuple = {
        deliveryId: envelope.record.deliveryId,
        ref: envelope.ref,
        digest: envelope.digest,
      };
      const runs = transport.entries.runs
        .filter((entry) => entry.record.deliveryId === envelope.record.deliveryId)
        .sort((left, right) => left.record.attemptOrdinal - right.record.attemptOrdinal);
      const tail = runs.at(-1) ?? null;
      run = tail ? runTuple(tail) : null;
      if (task.currentResult) {
        const artifact = artifactById.get(task.currentResult.targetResultId);
        if (
          artifact
          && sameGroupTuple(artifact.record.transport.group, task.currentDelivery.group)
          && sameEnvelopeTuple(artifact.record.transport.envelope, task.currentDelivery.envelope)
        ) {
          selectedResult = resultTuple(artifact.record, {
            ref: artifact.ref,
            digest: artifact.digest,
          });
          status = artifact.record.outcome === "blocked" ? "blocked" : "ready";
        }
      }
      if (!selectedResult) {
        if (["prepared", "send-claimed"].includes(task.currentDelivery.phase)) {
          status = "pending-host-send";
        } else if (task.currentDelivery.phase === "accepted") {
          status = "waiting-result";
        } else {
          status = "transport-review";
        }
      }
      if (CLOSED_TASK_STATES.has(task.lifecycleStatus)) status = "closed";
    } else if (CLOSED_TASK_STATES.has(task.lifecycleStatus)) {
      status = "closed";
    }
    return frozen({
      targetTaskId: member.targetTaskId,
      windowId: member.windowId,
      packet: { packetId: packet.record.packetId, ref: packet.ref, digest: packet.digest },
      envelope: envelopeTuple,
      run,
      status,
      result: selectedResult,
    });
  });
  const results = members
    .filter((entry) => entry.result)
    .map((entry) => entry.result)
    .sort((left, right) => lexicalCompare(left.targetTaskId, right.targetTaskId));
  const resultSetDigest = canonicalJsonDigest(results);
  const core = {
    schemaVersion: 1,
    kind: "WakeflowDispatchGroupReviewSnapshot",
    demand: {
      programId: loaded.demand.programId,
      demandId: loaded.demand.demandId,
      ref: "demand.json",
      digest: loaded.digests.demand,
    },
    state: {
      revision: loaded.state.revision,
      digest: loaded.digests.state,
      eventId: loaded.state.lastEvent.eventId,
      eventDigest: loaded.state.lastEvent.eventDigest,
    },
    group: { groupId, ref: groupEntry.ref, digest: groupEntry.digest },
    returnPolicy: groupEntry.record.returnPolicy,
    members,
    results,
    resultSetDigest,
  };
  const reviewSnapshotDigest = canonicalJsonDigest(core);
  const ready = members.filter((entry) => entry.status === "ready").map((entry) => entry.targetTaskId);
  const blocked = members.filter((entry) => entry.status === "blocked").map((entry) => entry.targetTaskId);
  const incomplete = members.filter((entry) => !["ready", "blocked", "closed"].includes(entry.status));
  const reviewEligible = incomplete.length === 0 && (ready.length + blocked.length > 0);
  const callbackUnits = groupEntry.record.returnPolicy.mode === "per-target"
    ? members.filter((entry) => ["ready", "blocked"].includes(entry.status)).map((entry) => ({
      targetTaskIds: [entry.targetTaskId],
      resultSetDigest: canonicalJsonDigest([entry.result]),
    }))
    : reviewEligible || blocked.length > 0
      ? [{ targetTaskIds: [...ready, ...blocked].sort(), resultSetDigest }]
      : [];
  return frozen({
    ...core,
    reviewSnapshotDigest,
    classification: {
      readyTargetTaskIds: ready,
      blockedTargetTaskIds: blocked,
      incompleteTargetTaskIds: incomplete.map((entry) => entry.targetTaskId),
      reviewEligible,
      callbackUnits,
      nextAction: reviewEligible ? "create-review-candidate" : null,
    },
  });
}

/**
 * 读取一个 dispatch group 的严格审查快照，用于判断是否具备创建候选的结构条件。
 */
export function inspectDispatchGroupReview(value = {}) {
  const input = normalizeGroupInspectInput(canonicalReviewInput(
    value,
    "inspectDispatchGroupReview input",
  ));
  if (!input.groupId) {
    fail("wakeflow-result-review-contract", "inspectDispatchGroupReview requires groupId");
  }
  const config = loadConfig(input);
  try {
    return withStateRootLock(input.stateRoot, () => {
      const loaded = loadStateWhileLocked(input, config);
      const transport = loadTransport(input, loaded);
      return buildGroupReviewSnapshot(input, config, loaded, transport, input.groupId);
    });
  } catch (cause) {
    boundary("inspect", cause, "dispatch-group review inspection failed closed");
  }
}

/**
 * 读取整个 demand 的结果审查轨迹；diagnostic 模式明确不具备 authority 资格。
 */
export function inspectDemandResultReviewTrace(value = {}) {
  const input = normalizeGroupInspectInput(canonicalReviewInput(
    value,
    "inspectDemandResultReviewTrace input",
  ), { allowMode: true });
  if (!new Set(["strict", "diagnostic"]).has(input.mode)) {
    fail("wakeflow-result-review-contract", "trace mode must be strict or diagnostic");
  }
  const config = loadConfig(input);
  if (input.mode === "diagnostic") {
    const loaded = loadState(input, config);
    const diagnostic = inspectTransportDemandForLayout({
      workspaceRoot: input.workspaceRoot,
      programId: input.expectedProgramId,
      demandId: loaded.demand.demandId,
    });
    return frozen({
      schemaVersion: 1,
      kind: "WakeflowDemandResultReviewTrace",
      mode: "diagnostic",
      authorityEligible: false,
      nextAction: null,
      state: { revision: loaded.state.revision, digest: loaded.digests.state },
      transport: diagnostic,
    });
  }
  return withStateRootLock(input.stateRoot, () => {
    const loaded = loadStateWhileLocked(input, config);
    const transport = loadTransport(input, loaded);
    const authority = buildTargetResultAuthoritySnapshotFromLoaded(loaded);
    const groups = transport.entries.groups.map((entry) => (
      buildGroupReviewSnapshot(input, config, loaded, transport, entry.record.groupId)
    ));
    return frozen({
      schemaVersion: 1,
      kind: "WakeflowDemandResultReviewTrace",
      mode: "strict",
      authorityEligible: true,
      nextAction: groups.some((entry) => entry.classification.reviewEligible)
        ? "create-review-candidate"
        : null,
      state: authority.state,
      results: authority.artifacts.map((entry) => ({
        targetTaskId: entry.targetTaskId,
        targetResultId: entry.targetResultId,
        ref: entry.ref,
        digest: entry.digest,
        lifecycleStatus: entry.lifecycleStatus,
        transport: entry.record.transport,
      })),
      groups,
      transportInventoryDigest: transport.inventoryDigest,
    });
  });
}

function loadExactTaskPackage(loaded, task) {
  const tuple = loaded.state.taskPackages.find((entry) => (
    entry.taskPackageId === task.taskPackageId
  ));
  if (!tuple) {
    fail("wakeflow-result-review-candidate", "review task has no exact task-package state tuple");
  }
  try {
    return loadDemandArtifactByRef({
      stateRoot: loaded.paths.stateRoot,
      ref: tuple.ref,
      digest: tuple.digest,
      expectedArtifactKind: "wakeflow-task-package",
      expectedArtifactId: tuple.taskPackageId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
    }).record;
  } catch (cause) {
    boundary("candidate", cause, "review task package is unavailable");
  }
}

// 从 return policy 与当前结果集合导出候选 scope、排除项和允许决定；这里不执行决定。
function candidateSemantics({ loaded, snapshot, requestedTargetTaskId = null }) {
  const available = snapshot.members.filter((entry) => ["ready", "blocked"].includes(entry.status));
  let scope;
  if (snapshot.returnPolicy.mode === "group-ready") {
    if (!snapshot.classification.reviewEligible) {
      fail("wakeflow-result-review-candidate", "group-ready candidate requires every current group member to be review-complete");
    }
    if (requestedTargetTaskId !== null) {
      fail("wakeflow-result-review-candidate", "group-ready candidate cannot narrow to one target task");
    }
    scope = available.map((entry) => entry.targetTaskId).sort();
  } else {
    if (requestedTargetTaskId === null) {
      fail("wakeflow-result-review-candidate", "per-target candidate requires targetTaskId");
    }
    const member = available.find((entry) => entry.targetTaskId === requestedTargetTaskId);
    if (!member) {
      fail("wakeflow-result-review-candidate", "per-target candidate requires one ready or blocked current group member");
    }
    scope = [requestedTargetTaskId];
  }
  if (scope.length === 0) {
    fail("wakeflow-result-review-candidate", "review candidate scope cannot be empty");
  }
  const resultByTask = new Map(snapshot.results.map((entry) => [entry.targetTaskId, entry]));
  const results = scope.map((targetTaskId) => {
    const result = resultByTask.get(targetTaskId);
    if (!result) {
      fail("wakeflow-result-review-candidate", "review scope lacks an exact current result tuple");
    }
    return result;
  });
  const readyTargetTaskIds = available
    .filter((entry) => entry.status === "ready" && scope.includes(entry.targetTaskId))
    .map((entry) => entry.targetTaskId)
    .sort();
  const blockedTargetTaskIds = available
    .filter((entry) => entry.status === "blocked" && scope.includes(entry.targetTaskId))
    .map((entry) => entry.targetTaskId)
    .sort();
  const eligibleTaskIds = loaded.state.targetTasks
    .filter((entry) => !CLOSED_TASK_STATES.has(entry.lifecycleStatus))
    .map((entry) => entry.targetTaskId)
    .sort();
  const excludedTargetTaskIds = eligibleTaskIds.filter((targetTaskId) => !scope.includes(targetTaskId));
  const scopedTasks = scope.map((targetTaskId) => {
    const task = loaded.state.targetTasks.find((entry) => entry.targetTaskId === targetTaskId);
    if (!task) fail("wakeflow-result-review-candidate", "review scope task is absent from state");
    return task;
  });
  const redesignAllowed = scopedTasks.every((task) => (
    Object.hasOwn(task, "repositoryId")
    && loadExactTaskPackage(loaded, task).workType === "implementation"
  ));
  const allowedDecisions = ["blocked", "rework"];
  if (blockedTargetTaskIds.length === 0) allowedDecisions.push("accept");
  if (redesignAllowed) allowedDecisions.push("redesign");
  allowedDecisions.sort(lexicalCompare);
  return frozen({
    scope,
    excludedTargetTaskIds,
    results,
    resultSetDigest: canonicalJsonDigest(results),
    readyTargetTaskIds,
    blockedTargetTaskIds,
    missingTargetTaskIds: [],
    allowedDecisions,
  });
}

function normalizeCandidateInput(value) {
  exactKeys(value, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "groupId",
    "reviewCandidateId",
    "transition",
  ], ["targetTaskId"], "createDispatchGroupReviewCandidate input");
  return frozen({
    workspaceRoot: root(value.workspaceRoot, "workspaceRoot"),
    stateRoot: root(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    groupId: typedId(value.groupId, "dispatch-group", "groupId"),
    reviewCandidateId: typedId(value.reviewCandidateId, "review-candidate", "reviewCandidateId"),
    transition: normalizeTransition(value.transition),
    ...(value.targetTaskId === undefined
      ? {}
      : { targetTaskId: typedId(value.targetTaskId, "target-task", "targetTaskId") }),
  });
}

// 生成可重算的候选 artifact 与全部 authority 基线，供写入和失败闭包共同使用。
function deriveCandidatePreflight(input, config) {
  const loaded = loadState(input, config);
  if (loaded.state.review.status !== "idle") {
    fail("wakeflow-result-review-candidate", "one pending review candidate must be decided first");
  }
  const transport = loadTransport(input, loaded);
  const snapshot = buildGroupReviewSnapshot(input, config, loaded, transport, input.groupId);
  const semantics = candidateSemantics({
    loaded,
    snapshot,
    requestedTargetTaskId: input.targetTaskId ?? null,
  });
  const artifact = validateReviewCandidateArtifact({
    schemaVersion: 1,
    artifactKind: "wakeflow-review-candidate",
    programId: loaded.demand.programId,
    demandId: loaded.demand.demandId,
    demandRef: "demand.json",
    demandDigest: loaded.digests.demand,
    createdAt: input.transition.createdAt,
    reviewCandidateId: input.reviewCandidateId,
    fromState: {
      revision: loaded.state.revision,
      stateDigest: loaded.digests.state,
      eventId: loaded.state.lastEvent.eventId,
      eventDigest: loaded.state.lastEvent.eventDigest,
    },
    reviewScope: {
      targetTaskIds: semantics.scope,
      excludedTargetTaskIds: semantics.excludedTargetTaskIds,
    },
    results: semantics.results,
    resultSetDigest: semantics.resultSetDigest,
    readyTargetTaskIds: semantics.readyTargetTaskIds,
    blockedTargetTaskIds: semantics.blockedTargetTaskIds,
    missingTargetTaskIds: [],
    allowedDecisions: semantics.allowedDecisions,
    structuralGaps: [],
  });
  return Object.freeze({
    loaded,
    transport,
    snapshot,
    semantics,
    artifact,
    identity: demandArtifactIdentity(artifact),
    leases: loadLeases(input),
  });
}

function exactCommittedCandidate(loaded, identity, transition) {
  const events = loaded.events.filter((event) => event.changedArtifacts.some((change) => (
    change.artifactKind === "wakeflow-review-candidate"
    && change.artifactId === identity.artifactId
  )));
  if (events.length === 0) return null;
  if (events.length !== 1) {
    fail("wakeflow-result-review-candidate-closure", "review candidate has multiple committing events");
  }
  const event = events[0];
  const change = event.changedArtifacts.find((entry) => (
    entry.artifactKind === "wakeflow-review-candidate"
    && entry.artifactId === identity.artifactId
  ));
  if (
    !change
    || change.ref !== identity.ref
    || change.digest !== identity.digest
    || event.command !== "create-review-candidate"
    || event.type !== "review-candidate.created"
    || event.eventId !== transition.eventId
    || event.createdAt !== transition.createdAt
    || event.reason !== transition.reason
    || event.decisionSummary !== transition.decisionSummary
  ) {
    fail("wakeflow-result-review-candidate-conflict", "review candidate is committed with different bytes or event intent");
  }
  return event;
}

function exactPendingCandidateReplay(input, config, loaded) {
  const tuple = loaded.state.review.pendingCandidate;
  if (
    loaded.state.review.status !== "pending"
    || !tuple
    || tuple.reviewCandidateId !== input.reviewCandidateId
  ) {
    return null;
  }
  let artifact;
  try {
    artifact = loadDemandArtifactByRef({
      stateRoot: loaded.paths.stateRoot,
      ref: tuple.ref,
      digest: tuple.digest,
      expectedArtifactKind: "wakeflow-review-candidate",
      expectedArtifactId: tuple.reviewCandidateId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
    }).record;
  } catch (cause) {
    boundary("candidate", cause, "pending review candidate bytes are unavailable");
  }
  const identity = demandArtifactIdentity(artifact);
  const event = exactCommittedCandidate(loaded, identity, input.transition);
  if (
    !event
    || event.nextRevision !== loaded.state.revision
    || loaded.state.lastEvent.eventId !== event.eventId
    || loaded.state.lastEvent.eventDigest !== canonicalJsonDigest(event)
    || artifact.fromState.revision !== event.previousRevision
  ) {
    fail(
      "wakeflow-result-review-candidate-conflict",
      "pending review candidate is not the exact current create-event tail",
    );
  }
  const transport = loadTransport(input, loaded);
  const snapshot = buildGroupReviewSnapshot(input, config, loaded, transport, input.groupId);
  const semantics = candidateSemantics({
    loaded,
    snapshot,
    requestedTargetTaskId: input.targetTaskId ?? null,
  });
  const expected = {
    reviewScope: {
      targetTaskIds: semantics.scope,
      excludedTargetTaskIds: semantics.excludedTargetTaskIds,
    },
    results: semantics.results,
    resultSetDigest: semantics.resultSetDigest,
    readyTargetTaskIds: semantics.readyTargetTaskIds,
    blockedTargetTaskIds: semantics.blockedTargetTaskIds,
    missingTargetTaskIds: [],
    allowedDecisions: semantics.allowedDecisions,
    structuralGaps: [],
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!same(artifact[key], expectedValue)) {
      fail(
        "wakeflow-result-review-candidate-conflict",
        `pending review candidate ${key} differs from the requested current group authority`,
      );
    }
  }
  return Object.freeze({ loaded, transport, snapshot, semantics, artifact, identity, event });
}

function candidateResult(status, preflight) {
  return frozen({
    status,
    candidate: preflight.identity,
    group: preflight.snapshot.group,
    resultSetDigest: preflight.artifact.resultSetDigest,
    allowedDecisions: preflight.artifact.allowedDecisions,
    revision: preflight.loaded.state.revision,
    stateDigest: preflight.loaded.digests.state,
  });
}

// 候选创建失败只允许原 authority 不变，或同字节候选恰好成为唯一 pending 尾部。
function verifyCandidateFailureClosure(input, config, tracker) {
  if (!tracker.preflight) {
    fail("wakeflow-result-review-recovery-required", "candidate failure has no strict prewrite baseline");
  }
  recoverDemandStateTransition({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: config.ledgerRoot,
    admitRecoveryWhileLocked: ({ candidateWrite }) => {
      if (
        candidateWrite?.artifactKind !== "wakeflow-review-candidate"
        || candidateWrite.ref !== tracker.preflight.identity.ref
        || candidateWrite.digest !== tracker.preflight.identity.digest
        || !same(candidateWrite.value, tracker.preflight.artifact)
      ) {
        fail("wakeflow-result-review-recovery-required", "pending journal is not the intended review candidate");
      }
    },
  });
  const loaded = loadState(input, config);
  const transport = loadTransport(input, loaded);
  const leases = loadLeases(input);
  if (
    transport.inventoryDigest !== tracker.preflight.transport.inventoryDigest
    || leases.inventoryDigest !== tracker.preflight.leases.inventoryDigest
  ) {
    fail("wakeflow-result-review-recovery-required", "candidate failure changed transport or lease authority");
  }
  const unchanged = (
    loaded.digests.state === tracker.preflight.loaded.digests.state
    && canonicalJsonDigest(loaded.events) === canonicalJsonDigest(tracker.preflight.loaded.events)
  );
  const committed = exactCommittedCandidate(
    loaded,
    tracker.preflight.identity,
    input.transition,
  );
  if (!unchanged && !committed) {
    fail("wakeflow-result-review-recovery-required", "candidate failure is neither unchanged nor exact committed state");
  }
  return safeReleaseVerdict("review-candidate-authority-closure", {
    state: unchanged ? "unchanged" : "committed",
    stateDigest: loaded.digests.state,
    transportDigest: transport.inventoryDigest,
    leaseDigest: leases.inventoryDigest,
  });
}

/**
 * 为一个可审查 group（或 per-target 单元）创建不可变 ReviewCandidate，不代替 Controller 决策。
 */
export async function createDispatchGroupReviewCandidate(value = {}) {
  const input = normalizeCandidateInput(canonicalReviewInput(
    value,
    "createDispatchGroupReviewCandidate input",
  ));
  const config = loadConfig(input);
  const initial = loadState(input, config);
  const initialReplay = exactPendingCandidateReplay(input, config, initial);
  if (initialReplay) return candidateResult("replayed", initialReplay);
  deriveCandidatePreflight(input, config);
  const tracker = { preflight: null };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "review-candidate-create",
      domainOwner: "result-review-runtime",
      onCallbackFailure: () => verifyCandidateFailureClosure(input, config, tracker),
    }, () => {
      const current = loadState(input, config);
      const replay = exactPendingCandidateReplay(input, config, current);
      if (replay) return candidateResult("replayed", replay);
      const preflight = deriveCandidatePreflight(input, config);
      tracker.preflight = preflight;
      createReviewCandidateArtifact({
        stateRoot: input.stateRoot,
        expectedProgramId: input.expectedProgramId,
        ledgerRoot: config.ledgerRoot,
        expectedPrevious: {
          revision: preflight.loaded.state.revision,
          stateDigest: preflight.loaded.digests.state,
        },
        artifact: preflight.artifact,
        transition: input.transition,
      });
      const after = loadState(input, config);
      const event = exactCommittedCandidate(after, preflight.identity, input.transition);
      if (!event || !same(after.state.review.pendingCandidate, {
        reviewCandidateId: input.reviewCandidateId,
        ref: preflight.identity.ref,
        digest: preflight.identity.digest,
      })) {
        fail("wakeflow-result-review-candidate-closure", "review candidate did not become exact pending state authority");
      }
      return candidateResult("created", { ...preflight, loaded: after });
    });
  } catch (cause) {
    boundary("candidate", cause, "review candidate creation failed closed");
  }
}

function normalizeDecisionInput(value) {
  exactKeys(value, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "groupId",
    "reviewCandidateId",
    "decision",
    "transition",
  ], [], "decideDispatchGroupReviewCandidate input");
  if (!new Set(["accept", "blocked", "redesign", "rework"]).has(value.decision)) {
    fail("wakeflow-result-review-contract", "review decision is unsupported");
  }
  return frozen({
    workspaceRoot: root(value.workspaceRoot, "workspaceRoot"),
    stateRoot: root(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    groupId: typedId(value.groupId, "dispatch-group", "groupId"),
    reviewCandidateId: typedId(value.reviewCandidateId, "review-candidate", "reviewCandidateId"),
    decision: value.decision,
    transition: normalizeTransition(value.transition),
  });
}

function loadPendingCandidate(loaded, reviewCandidateId) {
  const tuple = loaded.state.review.pendingCandidate;
  if (
    loaded.state.review.status !== "pending"
    || !tuple
    || tuple.reviewCandidateId !== reviewCandidateId
  ) {
    fail("wakeflow-result-review-decision-stale", "review decision does not name the exact pending candidate");
  }
  try {
    return loadDemandArtifactByRef({
      stateRoot: loaded.paths.stateRoot,
      ref: tuple.ref,
      digest: tuple.digest,
      expectedArtifactKind: "wakeflow-review-candidate",
      expectedArtifactId: tuple.reviewCandidateId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
    }).record;
  } catch (cause) {
    boundary("decision", cause, "pending review candidate bytes are unavailable");
  }
}

// 决策前重新证明 pending candidate 仍绑定当前 state、group 与结果集合，拒绝陈旧候选。
function assertCandidateStillExact({ loaded, snapshot, candidate }) {
  const createEvent = loaded.events.find((event) => event.changedArtifacts.some((change) => (
    change.artifactKind === "wakeflow-review-candidate"
    && change.artifactId === candidate.reviewCandidateId
    && change.ref === loaded.state.review.pendingCandidate.ref
    && change.digest === loaded.state.review.pendingCandidate.digest
  )));
  if (
    !createEvent
    || createEvent.command !== "create-review-candidate"
    || createEvent.type !== "review-candidate.created"
    || createEvent.nextRevision !== loaded.state.revision
    || createEvent.previousRevision !== candidate.fromState.revision
    || candidate.fromState.eventId !== loaded.events[candidate.fromState.revision - 1]?.eventId
    || candidate.fromState.eventDigest
      !== canonicalJsonDigest(loaded.events[candidate.fromState.revision - 1])
  ) {
    fail("wakeflow-result-review-decision-stale", "pending candidate is not the exact current create-event tail");
  }
  const requestedTargetTaskId = snapshot.returnPolicy.mode === "per-target"
    ? candidate.reviewScope.targetTaskIds[0] ?? null
    : null;
  const semantics = candidateSemantics({ loaded, snapshot, requestedTargetTaskId });
  const expected = {
    reviewScope: {
      targetTaskIds: semantics.scope,
      excludedTargetTaskIds: semantics.excludedTargetTaskIds,
    },
    results: semantics.results,
    resultSetDigest: semantics.resultSetDigest,
    readyTargetTaskIds: semantics.readyTargetTaskIds,
    blockedTargetTaskIds: semantics.blockedTargetTaskIds,
    missingTargetTaskIds: [],
    allowedDecisions: semantics.allowedDecisions,
    structuralGaps: [],
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!same(candidate[key], expectedValue)) {
      fail("wakeflow-result-review-decision-stale", `pending candidate ${key} differs from current group/result authority`);
    }
  }
  return semantics;
}

// 构造独立的 reviewDecision event 与下一状态；candidate artifact 本身保持不可变。
function decisionEventAndState({ loaded, snapshot, candidate, input }) {
  const previousReviewDigest = canonicalJsonDigest(loaded.state.review);
  const nextReview = {
    status: "idle",
    readyTargetTaskIds: [],
    blockedTargetTaskIds: [],
    missingTargetTaskIds: [],
  };
  const nextReviewDigest = canonicalJsonDigest(nextReview);
  const to = input.decision === "accept"
    ? "planned"
    : input.decision === "blocked"
      ? "blocked"
      : "needs-rework";
  const type = {
    accept: "review.accepted",
    blocked: "review.blocked",
    redesign: "review.redesign-requested",
    rework: "review.rework-requested",
  }[input.decision];
  const event = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: input.transition.eventId,
    demandId: loaded.demand.demandId,
    createdAt: input.transition.createdAt,
    actor: "controller",
    command: "decide-review-candidate",
    type,
    previousRevision: loaded.state.revision,
    nextRevision: loaded.state.revision + 1,
    from: loaded.state.state,
    to,
    reason: input.transition.reason,
    decisionSummary: input.transition.decisionSummary,
    changedArtifacts: [],
    reviewDecision: {
      candidate: {
        reviewCandidateId: candidate.reviewCandidateId,
        ref: loaded.state.review.pendingCandidate.ref,
        digest: loaded.state.review.pendingCandidate.digest,
      },
      group: snapshot.group,
      resultSetDigest: candidate.resultSetDigest,
      decision: input.decision,
      targetTaskIds: candidate.reviewScope.targetTaskIds,
      previousReviewDigest,
      nextReviewDigest,
    },
  });
  const nextState = structuredClone(loaded.state);
  nextState.revision = event.nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = {
    eventId: event.eventId,
    eventDigest: canonicalJsonDigest(event),
  };
  nextState.review = nextReview;
  const scope = new Set(candidate.reviewScope.targetTaskIds);
  const scopedPackageIds = new Set();
  const scopedTestCardIds = new Set();
  for (const task of nextState.targetTasks) {
    if (!scope.has(task.targetTaskId)) continue;
    task.lifecycleStatus = input.decision === "accept" ? "accepted" : "needs-rework";
    scopedPackageIds.add(task.taskPackageId);
    if (task.testCard) scopedTestCardIds.add(task.testCard.testCardId);
  }
  if (input.decision === "accept") {
    for (const taskPackage of nextState.taskPackages) {
      if (scopedPackageIds.has(taskPackage.taskPackageId)) taskPackage.lifecycleStatus = "closed";
    }
    for (const testCard of nextState.testCards) {
      if (scopedTestCardIds.has(testCard.testCardId)) testCard.lifecycleStatus = "closed";
    }
  }
  return frozen({ event, nextState: validateDemandStateRecord(nextState) });
}

function exactCommittedDecision(loaded, input) {
  const events = loaded.events.filter((event) => (
    event.reviewDecision?.candidate.reviewCandidateId === input.reviewCandidateId
  ));
  if (events.length === 0) return null;
  if (events.length !== 1) {
    fail("wakeflow-result-review-decision-conflict", "review candidate has multiple decision events");
  }
  const event = events[0];
  if (
    event.command !== "decide-review-candidate"
    || event.reviewDecision.decision !== input.decision
    || event.reviewDecision.group.groupId !== input.groupId
    || event.eventId !== input.transition.eventId
    || event.createdAt !== input.transition.createdAt
    || event.reason !== input.transition.reason
    || event.decisionSummary !== input.transition.decisionSummary
  ) {
    fail("wakeflow-result-review-decision-conflict", "review candidate is already bound to a different decision intent");
  }
  return event;
}

function decisionReplayResult(input, loaded, event) {
  return frozen({
    status: "replayed",
    decision: input.decision,
    eventId: event.eventId,
    revision: loaded.state.revision,
    stateDigest: loaded.digests.state,
  });
}

// 在持锁或非持锁读取下重算同一个决策意图，并识别精确 replay。
function deriveDecisionPreflight(
  input,
  config,
  { whileLocked = false, tracker = null } = {},
) {
  const loaded = whileLocked ? loadStateWhileLocked(input, config) : loadState(input, config);
  const replay = exactCommittedDecision(loaded, input);
  if (replay) return Object.freeze({ loaded, replay });
  const transport = loadTransport(input, loaded);
  const leases = loadLeases(input);
  if (tracker) {
    tracker.baseline = {
      stateDigest: loaded.digests.state,
      eventsDigest: canonicalJsonDigest(loaded.events),
      transportDigest: transport.inventoryDigest,
      leaseDigest: leases.inventoryDigest,
    };
  }
  const snapshot = buildGroupReviewSnapshot(input, config, loaded, transport, input.groupId);
  const candidate = loadPendingCandidate(loaded, input.reviewCandidateId);
  const semantics = assertCandidateStillExact({ loaded, snapshot, candidate });
  if (!semantics.allowedDecisions.includes(input.decision)) {
    fail("wakeflow-result-review-decision", `candidate does not allow ${input.decision}`);
  }
  const transition = decisionEventAndState({ loaded, snapshot, candidate, input });
  if (tracker) tracker.transition = transition;
  return Object.freeze({
    loaded,
    transport,
    leases,
    snapshot,
    candidate,
    semantics,
    transition,
    replay: null,
  });
}

// 决策写入失败时恢复专属 journal，只接受未变或精确 decision event 已提交。
function verifyDecisionFailureClosure(input, config, tracker) {
  if (!tracker.baseline) {
    fail("wakeflow-result-review-recovery-required", "review decision failure has no exact baseline");
  }
  return withStateRootLock(input.stateRoot, () => {
    if (tracker.transition) {
      recoverDemandReviewDecisionWhileLocked({
        stateRoot: input.stateRoot,
        expectedProgramId: input.expectedProgramId,
        ledgerRoot: config.ledgerRoot,
        admitRecoveryWhileLocked: ({ journal }) => {
          if (
            !same(journal.nextEvent, tracker.transition.event)
            || !same(journal.nextState, tracker.transition.nextState)
            || journal.artifactWrites.length !== 0
          ) {
            fail("wakeflow-result-review-recovery-required", "pending journal is not the intended review decision");
          }
          return { admitted: true };
        },
      });
    }
    const loaded = loadStateWhileLocked(input, config);
    const transport = loadTransport(input, loaded);
    const leases = loadLeases(input);
    if (
      transport.inventoryDigest !== tracker.baseline.transportDigest
      || leases.inventoryDigest !== tracker.baseline.leaseDigest
    ) {
      fail("wakeflow-result-review-recovery-required", "review decision changed transport or lease authority");
    }
    const unchanged = (
      loaded.digests.state === tracker.baseline.stateDigest
      && canonicalJsonDigest(loaded.events) === tracker.baseline.eventsDigest
    );
    const committed = tracker.transition ? exactCommittedDecision(loaded, input) : null;
    if (!unchanged && !committed) {
      fail("wakeflow-result-review-recovery-required", "review decision failure is neither unchanged nor exact committed state");
    }
    return safeReleaseVerdict("review-decision-authority-closure", {
      state: unchanged ? "unchanged" : "committed",
      stateDigest: loaded.digests.state,
      transportDigest: transport.inventoryDigest,
      leaseDigest: leases.inventoryDigest,
    });
  });
}

/**
 * 提交 Controller 对当前 ReviewCandidate 的独立决定；不会创建 rework/redesign 后续任务。
 */
export async function decideDispatchGroupReviewCandidate(value = {}) {
  const input = normalizeDecisionInput(canonicalReviewInput(
    value,
    "decideDispatchGroupReviewCandidate input",
  ));
  const config = loadConfig(input);
  const initial = deriveDecisionPreflight(input, config);
  if (initial.replay) return decisionReplayResult(input, initial.loaded, initial.replay);
  const tracker = { baseline: null, transition: null };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "review-candidate-decision",
      domainOwner: "result-review-runtime",
      onCallbackFailure: () => verifyDecisionFailureClosure(input, config, tracker),
    }, () => withStateRootLock(input.stateRoot, () => {
      const preflight = deriveDecisionPreflight(input, config, {
        whileLocked: true,
        tracker,
      });
      if (preflight.replay) {
        return decisionReplayResult(input, preflight.loaded, preflight.replay);
      }
      const { loaded, transition } = preflight;
      commitDemandReviewDecisionWhileLocked({
        stateRoot: input.stateRoot,
        expectedProgramId: input.expectedProgramId,
        ledgerRoot: config.ledgerRoot,
        expectedPrevious: {
          revision: loaded.state.revision,
          stateDigest: loaded.digests.state,
        },
        event: transition.event,
        nextState: transition.nextState,
      });
      const after = loadStateWhileLocked(input, config);
      const committed = exactCommittedDecision(after, input);
      if (!committed || after.state.review.status !== "idle") {
        fail("wakeflow-result-review-decision-closure", "review decision did not close exact state authority");
      }
      return frozen({
        status: "decided",
        decision: input.decision,
        eventId: transition.event.eventId,
        targetTaskIds: transition.event.reviewDecision.targetTaskIds,
        revision: after.state.revision,
        stateDigest: after.digests.state,
      });
    }));
  } catch (cause) {
    boundary("decision", cause, "review decision failed closed");
  }
}

function loadBindings(input, config) {
  let inventory;
  try {
    inventory = inspectWindowBindingInventory({ workspaceRoot: input.workspaceRoot });
  } catch (cause) {
    boundary("binding", cause, "strict current window binding inventory is unavailable");
  }
  if (
    inventory.programId !== input.expectedProgramId
    || inventory.configDigest !== config.configDigest
  ) {
    fail("wakeflow-result-review-binding", "binding inventory does not match current config authority");
  }
  return inventory;
}

function normalizeReturnPlanInput(value) {
  exactKeys(value, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "groupId",
    "deliveryId",
    "createdAt",
  ], ["targetTaskId"], "planControllerReturnDelivery input");
  return frozen({
    workspaceRoot: root(value.workspaceRoot, "workspaceRoot"),
    stateRoot: root(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    groupId: typedId(value.groupId, "dispatch-group", "groupId"),
    deliveryId: typedId(value.deliveryId, "delivery", "deliveryId"),
    createdAt: token(value.createdAt, "createdAt"),
    ...(value.targetTaskId === undefined
      ? {}
      : { targetTaskId: typedId(value.targetTaskId, "target-task", "targetTaskId") }),
  });
}

function selectControllerReturnUnit(snapshot, requestedTargetTaskId = null) {
  if (snapshot.returnPolicy.mode === "group-ready") {
    if (requestedTargetTaskId !== null) {
      fail("wakeflow-result-review-return", "group-ready Controller return cannot narrow targetTaskId");
    }
    if (snapshot.classification.callbackUnits.length !== 1) {
      fail("wakeflow-result-review-return", "group-ready Controller return is not eligible yet");
    }
    return snapshot.classification.callbackUnits[0];
  }
  if (requestedTargetTaskId === null) {
    fail("wakeflow-result-review-return", "per-target Controller return requires targetTaskId");
  }
  const unit = snapshot.classification.callbackUnits.find((entry) => (
    entry.targetTaskIds.length === 1 && entry.targetTaskIds[0] === requestedTargetTaskId
  ));
  if (!unit) {
    fail("wakeflow-result-review-return", "per-target Controller return has no matching ready unit");
  }
  return unit;
}

function controllerReturnPrompt(snapshot, unit) {
  return [
    `Wakeflow Controller return for dispatch group ${snapshot.group.groupId}.`,
    `Review only target tasks ${unit.targetTaskIds.join(", ")}.`,
    `Load the exact state-root result set ${unit.resultSetDigest}`,
    `and group review snapshot ${snapshot.reviewSnapshotDigest} before deciding.`,
    "This callback is transport evidence only and does not accept or rework the result.",
  ].join(" ");
}

function controllerRuns(transport, deliveryId) {
  return transport.entries.runs
    .filter((entry) => entry.record.deliveryId === deliveryId)
    .sort((left, right) => left.record.attemptOrdinal - right.record.attemptOrdinal);
}

function assertNoCompletedLogicalReturn(transport, groupId, resultSetDigest) {
  const envelopes = transport.entries.envelopes.filter((entry) => (
    entry.record.artifactKind === WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND
    && entry.record.groupId === groupId
    && entry.record.resultSetDigest === resultSetDigest
  ));
  for (const envelope of envelopes) {
    const runs = controllerRuns(transport, envelope.record.deliveryId);
    const tail = runs.at(-1) ?? null;
    if (!tail) continue;
    if (["accepted", "ambiguous"].includes(tail.record.transportStatus)) {
      fail(
        "wakeflow-result-review-return-already-sent",
        "this exact dispatch-group result set already has an accepted or ambiguous Controller return",
      );
    }
    fail(
      "wakeflow-result-review-return-rearm-required",
      "rejected Controller return requires an explicit future rearm authority",
    );
  }
  return envelopes;
}

function controllerReturnTransportBaselineDigest(transport, deliveryId) {
  const entries = Object.fromEntries(
    ["groups", "packets", "envelopes", "runs"].map((kind) => [
      kind,
      transport.entries[kind]
        .filter((entry) => (
          kind === "envelopes"
            ? entry.record.deliveryId !== deliveryId
            : kind === "runs"
              ? entry.record.deliveryId !== deliveryId
              : true
        ))
        .map(({ ref, digest }) => ({ ref, digest })),
    ]),
  );
  return canonicalJsonDigest({
    programId: transport.programId,
    demandId: transport.demandId,
    entries,
  });
}

// 只读生成 Controller-return envelope 与来源摘要；计划阶段绝不写 transport。
function deriveControllerReturnPlan(input, config, { whileLocked = false } = {}) {
  const loaded = whileLocked ? loadStateWhileLocked(input, config) : loadState(input, config);
  if (TERMINAL_DEMAND_STATES.has(loaded.state.state)) {
    fail("wakeflow-result-review-return", "terminal demand cannot create a Controller return");
  }
  const transport = loadTransport(input, loaded);
  const snapshot = buildGroupReviewSnapshot(input, config, loaded, transport, input.groupId);
  const unit = selectControllerReturnUnit(snapshot, input.targetTaskId ?? null);
  const bindings = loadBindings(input, config);
  const groupEntry = transport.entries.groups.find((entry) => entry.record.groupId === input.groupId);
  const binding = bindings.bindings.find((entry) => (
    entry.windowId === groupEntry.record.controllerWindowId
  ));
  if (!binding) {
    fail("wakeflow-result-review-binding", "dispatch group Controller window has no current binding");
  }
  const prompt = controllerReturnPrompt(snapshot, unit);
  const existing = assertNoCompletedLogicalReturn(
    transport,
    input.groupId,
    unit.resultSetDigest,
  );
  const reusable = existing.filter((entry) => (
    entry.record.reviewSnapshotDigest === snapshot.reviewSnapshotDigest
    && entry.record.preparedByHostId === binding.hostId
    && entry.record.windowId === binding.windowId
    && entry.record.identityRef === binding.identityRef
    && entry.record.bindingId === binding.bindingId
    && entry.record.identityBindingDigest === binding.identityBindingDigest
    && entry.record.prompt === prompt
  ));
  if (reusable.length > 1) {
    fail("wakeflow-result-review-return-conflict", "multiple unsent envelopes claim the same Controller return snapshot");
  }
  const envelope = reusable[0]?.record ?? createControllerReturnEnvelopeRecord({
    programId: loaded.demand.programId,
    demandId: loaded.demand.demandId,
    deliveryId: input.deliveryId,
    groupId: groupEntry.record.groupId,
    groupDigest: groupEntry.digest,
    resultSetDigest: unit.resultSetDigest,
    reviewSnapshotDigest: snapshot.reviewSnapshotDigest,
    preparedByHostId: binding.hostId,
    windowId: binding.windowId,
    bindingId: binding.bindingId,
    identityBindingDigest: binding.identityBindingDigest,
    prompt,
    oneShot: true,
    transportPolicy: { kind: "direct-thread", missingIdentity: "rejected-before-send" },
    readbackPolicy: { required: true, maxObservations: 1 },
    automationRequested: false,
    createdAt: input.createdAt,
  });
  const source = {
    configDigest: config.configDigest,
    stateRevision: loaded.state.revision,
    stateDigest: loaded.digests.state,
    transportBaselineDigest: controllerReturnTransportBaselineDigest(
      transport,
      envelope.deliveryId,
    ),
    bindingInventoryDigest: bindings.inventoryDigest,
  };
  const unsigned = {
    schemaVersion: 1,
    kind: "WakeflowControllerReturnDeliveryPlan",
    request: {
      groupId: input.groupId,
      deliveryId: input.deliveryId,
      createdAt: input.createdAt,
      ...(input.targetTaskId ? { targetTaskId: input.targetTaskId } : {}),
    },
    source,
    group: snapshot.group,
    unit,
    reviewSnapshotDigest: snapshot.reviewSnapshotDigest,
    binding,
    envelope,
  };
  return frozen({ ...unsigned, planDigest: canonicalJsonDigest(unsigned) });
}

/**
 * 基于当前结果快照和 Controller binding 生成可重算、带摘要的 return 计划。
 */
export function planControllerReturnDelivery(value = {}) {
  const input = normalizeReturnPlanInput(canonicalReviewInput(
    value,
    "planControllerReturnDelivery input",
  ));
  const config = loadConfig(input);
  try {
    return withStateRootLock(input.stateRoot, () => (
      deriveControllerReturnPlan(input, config, { whileLocked: true })
    ));
  } catch (cause) {
    boundary("return-plan", cause, "Controller-return plan failed closed");
  }
}

function normalizeReturnApplyInput(value) {
  exactKeys(value, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "plan",
    "planDigest",
  ], [], "applyControllerReturnDeliveryPlan input");
  if (
    !isPlainObject(value.plan)
    || value.plan.kind !== "WakeflowControllerReturnDeliveryPlan"
    || value.plan.schemaVersion !== 1
    || value.plan.planDigest !== value.planDigest
  ) {
    fail("wakeflow-result-review-contract", "Controller-return apply requires one exact candidate plan and digest");
  }
  const unsigned = { ...value.plan };
  delete unsigned.planDigest;
  if (canonicalJsonDigest(unsigned) !== value.planDigest) {
    fail("wakeflow-result-review-contract", "Controller-return plan digest differs from its complete payload");
  }
  return Object.freeze({
    workspaceRoot: root(value.workspaceRoot, "workspaceRoot"),
    stateRoot: root(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    plan: value.plan,
    planDigest: value.planDigest,
  });
}

function returnPlanRequest(input) {
  return frozen({
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    groupId: input.plan.request.groupId,
    deliveryId: input.plan.request.deliveryId,
    createdAt: input.plan.request.createdAt,
    ...(input.plan.request.targetTaskId
      ? { targetTaskId: input.plan.request.targetTaskId }
      : {}),
  });
}

function transportWithoutEnvelope(transport, deliveryId) {
  return frozen({
    ...transport.entries,
    envelopes: transport.entries.envelopes.filter((entry) => (
      entry.record.deliveryId !== deliveryId
    )),
  });
}

// envelope 发布失败只接受 transport 未变或目标 envelope 精确落盘，state/lease 必须不变。
function verifyReturnApplyFailure(input, config, tracker) {
  if (!tracker.baseline || !tracker.expectedEnvelope) {
    fail("wakeflow-result-review-recovery-required", "Controller-return apply has no strict baseline");
  }
  const loaded = loadState(input, config);
  const transport = loadTransport(input, loaded);
  const leases = loadLeases(input);
  if (
    loaded.digests.state !== tracker.baseline.stateDigest
    || canonicalJsonDigest(loaded.events) !== tracker.baseline.eventsDigest
    || leases.inventoryDigest !== tracker.baseline.leaseDigest
  ) {
    fail("wakeflow-result-review-recovery-required", "Controller-return apply changed state or lease authority");
  }
  const entry = transport.entries.envelopes.find((candidate) => (
    candidate.record.deliveryId === tracker.expectedEnvelope.deliveryId
  ));
  const unchanged = transport.inventoryDigest === tracker.baseline.transportDigest;
  const exactPublished = Boolean(entry && same(entry.record, tracker.expectedEnvelope));
  if (
    !unchanged
    && (
      !exactPublished
      || !same(
        transportWithoutEnvelope(transport, tracker.expectedEnvelope.deliveryId),
        tracker.baseline.entries,
      )
    )
  ) {
    fail("wakeflow-result-review-recovery-required", "Controller-return apply left an unknown transport transition");
  }
  return safeReleaseVerdict("controller-return-envelope-closure", {
    transport: unchanged ? "unchanged" : "published",
    stateDigest: loaded.digests.state,
    transportDigest: transport.inventoryDigest,
    leaseDigest: leases.inventoryDigest,
  });
}

/**
 * 在 mutation gate 内复算并发布 Controller-return envelope；不执行宿主发送。
 */
export async function applyControllerReturnDeliveryPlan(value = {}) {
  const input = normalizeReturnApplyInput(canonicalReviewInput(
    value,
    "applyControllerReturnDeliveryPlan input",
  ));
  const config = loadConfig(input);
  const request = returnPlanRequest(input);
  const preview = planControllerReturnDelivery(request);
  if (!same(preview, input.plan)) {
    fail("wakeflow-result-review-return-stale", "Controller-return plan is stale before apply");
  }
  const tracker = { baseline: null, expectedEnvelope: null };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "controller-return-envelope-publish",
      domainOwner: "result-review-runtime",
      onCallbackFailure: () => verifyReturnApplyFailure(input, config, tracker),
    }, (mutationContext) => withStateRootLock(input.stateRoot, () => {
      const recomputed = deriveControllerReturnPlan(request, config, { whileLocked: true });
      if (!same(recomputed, input.plan)) {
        fail("wakeflow-result-review-return-stale", "Controller-return plan changed under apply gate");
      }
      const loaded = loadStateWhileLocked(input, config);
      const transport = loadTransport(input, loaded);
      const leases = loadLeases(input);
      tracker.baseline = {
        stateDigest: loaded.digests.state,
        eventsDigest: canonicalJsonDigest(loaded.events),
        transportDigest: transport.inventoryDigest,
        leaseDigest: leases.inventoryDigest,
        entries: transport.entries,
      };
      tracker.expectedEnvelope = recomputed.envelope;
      const published = publishDeliveryEnvelopeAdmitted({
        workspaceRoot: input.workspaceRoot,
        programId: input.expectedProgramId,
        demandId: loaded.demand.demandId,
        record: recomputed.envelope,
        mutationContext,
      });
      if (published.outcome !== "success") {
        fail("wakeflow-result-review-return", published.message, published.details);
      }
      const afterState = loadStateWhileLocked(input, config);
      const afterLeases = loadLeases(input);
      if (
        afterState.digests.state !== tracker.baseline.stateDigest
        || canonicalJsonDigest(afterState.events) !== tracker.baseline.eventsDigest
        || afterLeases.inventoryDigest !== tracker.baseline.leaseDigest
      ) {
        fail("wakeflow-result-review-return-closure", "Controller-return envelope changed state or lease authority");
      }
      return frozen({
        status: published.value.status,
        envelope: {
          deliveryId: recomputed.envelope.deliveryId,
          ref: deliveryEnvelopeRef({
            demandId: recomputed.envelope.demandId,
            deliveryId: recomputed.envelope.deliveryId,
          }),
          digest: recomputed.envelope.envelopeDigest,
        },
        resultSetDigest: recomputed.envelope.resultSetDigest,
        reviewSnapshotDigest: recomputed.envelope.reviewSnapshotDigest,
        transportInventoryDigest: published.value.inventoryDigest,
      });
    }));
  } catch (cause) {
    boundary("return-apply", cause, "Controller-return apply failed closed");
  }
}

function normalizeReturnInspectInput(value) {
  exactKeys(value, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "deliveryId",
  ], [], "inspectControllerReturnPreSend input");
  return frozen({
    workspaceRoot: root(value.workspaceRoot, "workspaceRoot"),
    stateRoot: root(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    deliveryId: typedId(value.deliveryId, "delivery", "deliveryId"),
  });
}

// 宿主发送前复核结果快照、binding 与单次发送历史，返回可发送或需显式 rearm 的状态。
function inspectReturnPreSendWhileLocked(input, config) {
  const loaded = loadStateWhileLocked(input, config);
  if (TERMINAL_DEMAND_STATES.has(loaded.state.state)) {
    fail("wakeflow-result-review-return-stale", "terminal demand invalidates Controller-return pre-send");
  }
  const transport = loadTransport(input, loaded);
  const envelopeEntry = transport.entries.envelopes.find((entry) => (
    entry.record.deliveryId === input.deliveryId
  ));
  if (!envelopeEntry || envelopeEntry.record.artifactKind !== WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND) {
    fail("wakeflow-result-review-return", "Controller-return envelope is absent from strict transport authority");
  }
  const envelope = envelopeEntry.record;
  const snapshot = buildGroupReviewSnapshot(input, config, loaded, transport, envelope.groupId);
  const matchingUnits = snapshot.classification.callbackUnits.filter((entry) => (
    entry.resultSetDigest === envelope.resultSetDigest
  ));
  if (
    matchingUnits.length !== 1
    || snapshot.reviewSnapshotDigest !== envelope.reviewSnapshotDigest
  ) {
    fail("wakeflow-result-review-return-stale", "Controller-return result/review snapshot is stale");
  }
  const bindings = loadBindings(input, config);
  const binding = bindings.bindings.find((entry) => entry.windowId === envelope.windowId);
  if (
    !binding
    || binding.hostId !== envelope.preparedByHostId
    || binding.identityRef !== envelope.identityRef
    || binding.bindingId !== envelope.bindingId
    || binding.identityBindingDigest !== envelope.identityBindingDigest
  ) {
    fail("wakeflow-result-review-return-stale", "Controller-return binding is no longer current");
  }
  const runs = controllerRuns(transport, envelope.deliveryId);
  const tail = runs.at(-1) ?? null;
  const status = !tail
    ? "ready"
    : tail.record.transportStatus === "rejected-before-send"
      ? "explicit-rearm-required"
      : "already-sent";
  return frozen({
    schemaVersion: 1,
    kind: "WakeflowControllerReturnPreSend",
    status,
    requiresHostOperationFence: true,
    envelope,
    binding,
    resultSetDigest: envelope.resultSetDigest,
    reviewSnapshotDigest: envelope.reviewSnapshotDigest,
    run: tail ? runTuple(tail) : null,
  });
}

/**
 * 在宿主动作前重新检查 Controller-return 是否仍精确、未发送且绑定有效。
 */
export function inspectControllerReturnPreSend(value = {}) {
  const input = normalizeReturnInspectInput(canonicalReviewInput(
    value,
    "inspectControllerReturnPreSend input",
  ));
  const config = loadConfig(input);
  try {
    return withStateRootLock(input.stateRoot, () => (
      inspectReturnPreSendWhileLocked(input, config)
    ));
  } catch (cause) {
    boundary("return-pre-send", cause, "Controller-return pre-send inspection failed closed");
  }
}

function normalizeReturnOutcomeInput(value) {
  exactKeys(value, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "deliveryId",
    "runId",
    "outcome",
  ], [], "recordControllerReturnOutcome input");
  exactKeys(value.outcome, [
    "hostMethod",
    "hostMode",
    "transportStatus",
    "readback",
    "createdAt",
  ], ["error"], "Controller-return outcome");
  return frozen({
    workspaceRoot: root(value.workspaceRoot, "workspaceRoot"),
    stateRoot: root(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    deliveryId: typedId(value.deliveryId, "delivery", "deliveryId"),
    runId: typedId(value.runId, "delivery-run", "runId"),
    outcome: value.outcome,
  });
}

// 把宿主返回的事实构造成唯一 attempt-1 run；拒绝隐式重试和不同字节 replay。
function deriveControllerReturnRun(input, config) {
  const loaded = loadState(input, config);
  const transport = loadTransport(input, loaded);
  const envelopeEntry = transport.entries.envelopes.find((entry) => (
    entry.record.deliveryId === input.deliveryId
  ));
  if (!envelopeEntry || envelopeEntry.record.artifactKind !== WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND) {
    fail("wakeflow-result-review-return", "Controller-return outcome has no exact envelope");
  }
  const existingRuns = controllerRuns(transport, input.deliveryId);
  if (existingRuns.length > 1) {
    fail("wakeflow-result-review-return", "Controller-return cannot have an implicit retry chain");
  }
  const envelope = envelopeEntry.record;
  const run = createDeliveryRunRecord({
    programId: envelope.programId,
    demandId: envelope.demandId,
    runId: input.runId,
    deliveryId: envelope.deliveryId,
    envelopeDigest: envelope.envelopeDigest,
    hostId: envelope.preparedByHostId,
    windowId: envelope.windowId,
    attemptOrdinal: 1,
    hostMethod: input.outcome.hostMethod,
    hostMode: input.outcome.hostMode,
    transportStatus: input.outcome.transportStatus,
    readback: input.outcome.readback,
    ...(input.outcome.error ? { error: input.outcome.error } : {}),
    createdAt: input.outcome.createdAt,
  });
  if (existingRuns.length === 1 && !same(existingRuns[0].record, run)) {
    fail("wakeflow-result-review-return-already-sent", "Controller-return already has a different immutable run");
  }
  return Object.freeze({ loaded, transport, envelopeEntry, run, existingRuns, leases: loadLeases(input) });
}

// outcome 写入失败只允许 transport 未变或同一 immutable run 已写入，state/lease 不得变化。
function verifyReturnOutcomeFailure(input, config, tracker) {
  if (!tracker.preflight) {
    fail("wakeflow-result-review-recovery-required", "Controller-return outcome has no strict baseline");
  }
  const current = deriveControllerReturnRun(input, config);
  if (
    current.loaded.digests.state !== tracker.preflight.loaded.digests.state
    || canonicalJsonDigest(current.loaded.events) !== canonicalJsonDigest(tracker.preflight.loaded.events)
    || current.leases.inventoryDigest !== tracker.preflight.leases.inventoryDigest
  ) {
    fail("wakeflow-result-review-recovery-required", "Controller-return outcome changed state or lease authority");
  }
  const unchanged = current.transport.inventoryDigest === tracker.preflight.transport.inventoryDigest;
  const exactRun = current.existingRuns.find((entry) => same(entry.record, tracker.preflight.run));
  if (!unchanged && !exactRun) {
    fail("wakeflow-result-review-recovery-required", "Controller-return outcome left an unknown run transition");
  }
  return safeReleaseVerdict("controller-return-run-closure", {
    transport: unchanged ? "unchanged" : "recorded",
    stateDigest: current.loaded.digests.state,
    transportDigest: current.transport.inventoryDigest,
    leaseDigest: current.leases.inventoryDigest,
  });
}

/**
 * 记录一次 Controller-return 宿主发送结果；transport accepted 仍不等同于业务审查接受。
 */
export async function recordControllerReturnOutcome(value = {}) {
  const input = normalizeReturnOutcomeInput(canonicalReviewInput(
    value,
    "recordControllerReturnOutcome input",
  ));
  const config = loadConfig(input);
  deriveControllerReturnRun(input, config);
  const tracker = { preflight: null };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "controller-return-run-record",
      domainOwner: "result-review-runtime",
      onCallbackFailure: () => verifyReturnOutcomeFailure(input, config, tracker),
    }, (mutationContext) => {
      const preflight = deriveControllerReturnRun(input, config);
      tracker.preflight = preflight;
      const appended = appendDeliveryRunAdmitted({
        workspaceRoot: input.workspaceRoot,
        programId: input.expectedProgramId,
        demandId: preflight.loaded.demand.demandId,
        record: preflight.run,
        mutationContext,
      });
      if (appended.outcome !== "success") {
        fail("wakeflow-result-review-return", appended.message, appended.details);
      }
      const after = deriveControllerReturnRun(input, config);
      if (
        after.loaded.digests.state !== preflight.loaded.digests.state
        || canonicalJsonDigest(after.loaded.events) !== canonicalJsonDigest(preflight.loaded.events)
        || after.leases.inventoryDigest !== preflight.leases.inventoryDigest
        || !after.existingRuns.some((entry) => same(entry.record, preflight.run))
      ) {
        fail("wakeflow-result-review-return-closure", "Controller-return run did not close transport-only authority");
      }
      return frozen({
        status: appended.value.status === "replayed" ? "replayed" : "recorded",
        run: {
          runId: preflight.run.runId,
          ref: deliveryRunRef({
            demandId: preflight.run.demandId,
            runId: preflight.run.runId,
          }),
          digest: preflight.run.runDigest,
        },
        transportStatus: preflight.run.transportStatus,
        readbackStatus: preflight.run.readback.status,
        transportInventoryDigest: appended.value.inventoryDigest,
      });
    });
  } catch (cause) {
    boundary("return-outcome", cause, "Controller-return outcome recording failed closed");
  }
}
