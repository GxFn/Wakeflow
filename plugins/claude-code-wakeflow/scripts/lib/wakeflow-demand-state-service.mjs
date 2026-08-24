/**
 * Wakeflow 需求状态的单根事务服务。
 *
 * 固定提交顺序为 journal → immutable artifact/evidence → event log → state snapshot
 * → closure check → journal cleanup；恢复只能继续同一份已验证 intent。这里拥有锁、CAS、
 * journal 和 owner 路由，不拥有 lifecycle/review/delivery/Pod 的业务准入决定，也不替代
 * business archive 的 archive.json 事务。
 */

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

import { atomicWriteFile, sha256Bytes } from "./wakeflow-atomic-write.mjs";
import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import {
  demandCoreCanonicalBytes,
  demandCorePaths,
  loadDemandCoreRecordsWhileLocked,
  loadDemandCoreRecoveryRecordsWhileLocked,
  validateDemandAuthorityRecord,
  validateDemandCoreStack,
  validateStateTransitionRecord,
  WAKEFLOW_DEMAND_AUTHORITY_FILE,
} from "./wakeflow-demand-core-records.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  demandArtifactCanonicalBytes,
  demandArtifactIdentity,
  inspectDemandArtifactInventory,
  loadDemandArtifactByRef,
  validateDemandArtifactWriteIntent,
} from "./wakeflow-demand-artifact-records.mjs";
import {
  evidenceIdentity,
  inspectManagedEvidenceInventory,
  loadManagedEvidenceByRef,
  validateEvidenceWriteIntent,
} from "./wakeflow-evidence-records.mjs";
import {
  assertNoEvidenceStageResidue,
  evidenceRootPath,
  evidenceStagePath,
  inspectEvidenceFinalWrite,
  inspectEvidenceStage,
  materializeEvidenceStage,
  publishEvidenceStage,
} from "./wakeflow-evidence-tree.mjs";
import { withStateRootLock } from "./wakeflow-state-lock.mjs";

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const DELIVERY_COMMAND_SET = new Set([
  "prepare-target-delivery",
  "claim-target-delivery-send",
  "record-target-delivery-run",
  "rearm-target-delivery",
]);
const REVIEW_DECISION_COMMAND = "decide-review-candidate";
const LIFECYCLE_COMMAND_SET = new Set(["complete-demand", "cancel-demand"]);
const TERMINAL_DEMAND_STATE_SET = new Set(["completed", "cancelled"]);
const ARCHIVE_COMMAND = "archive-demand";
const POD_COMMAND_SET = new Set([
  "initialize-pod",
  "add-pod-members",
  "record-pod-design-request",
  "record-pod-design-handoff",
  "bind-pod-window",
  "plan-pod-test-access",
  "record-pod-test-access",
  "retry-pod-test-access",
  "plan-pod-close",
  "record-pod-close",
]);

export class WakeflowDemandStateServiceError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowDemandStateServiceError";
    this.code = code;
    this.details = details;
  }
}

function serviceError(code, message, details = {}, cause = undefined) {
  return new WakeflowDemandStateServiceError(code, message, { details, cause });
}

// service 边界先复制纯 JSON 数据，owner 判断和回调准入都不得执行调用方 accessor。
function canonicalServiceSnapshot(value, code, message) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    throw serviceError(code, message, { causeCode: cause?.code ?? null }, cause);
  }
}

function currentEffectiveUid() {
  if (process.platform === "win32" || typeof process.geteuid !== "function") return null;
  return BigInt(process.geteuid());
}

function permissionBits(stat) {
  return Number(stat.mode & 0o777n);
}

function journalNodeIsStable(left, right) {
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

function journalOwnedByCurrentUser(stat) {
  const expectedUid = currentEffectiveUid();
  return expectedUid === null || stat.uid === expectedUid;
}

function normalizeExpectedPrevious(value) {
  value = canonicalServiceSnapshot(
    value,
    "wakeflow-demand-state-expected-previous",
    "expectedPrevious must be canonical plain data without accessors or hidden fields",
  );
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw serviceError(
      "wakeflow-demand-state-expected-previous",
      "expectedPrevious must contain the exact current revision and canonical state digest",
    );
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 2
    || keys[0] !== "revision"
    || keys[1] !== "stateDigest"
    || !Number.isInteger(value.revision)
    || value.revision < 1
    || typeof value.stateDigest !== "string"
    || !DIGEST_RE.test(value.stateDigest)
  ) {
    throw serviceError(
      "wakeflow-demand-state-expected-previous",
      "expectedPrevious must contain only revision>=1 and stateDigest=sha256:<64 lowercase hex>",
    );
  }
  return Object.freeze({ revision: value.revision, stateDigest: value.stateDigest });
}

function normalizeExpectedProgramId(value) {
  try {
    return assertWakeflowId(value, "program", "$expectedProgramId");
  } catch (cause) {
    throw serviceError(
      "wakeflow-demand-state-program-required",
      "demand state mutation requires the exact owning typed programId",
      { expectedProgramId: value ?? null },
      cause,
    );
  }
}

function isDeliveryOwnedEvent(event) {
  return Boolean(
    event
    && typeof event === "object"
    && !Array.isArray(event)
    && DELIVERY_COMMAND_SET.has(event.command)
    && Object.hasOwn(event, "deliveryTransition"),
  );
}

function isReviewOwnedEvent(event) {
  return Boolean(
    event
    && typeof event === "object"
    && !Array.isArray(event)
    && event.command === REVIEW_DECISION_COMMAND
    && Object.hasOwn(event, "reviewDecision"),
  );
}

function isPodOwnedEvent(event) {
  return Boolean(
    event
    && typeof event === "object"
    && !Array.isArray(event)
    && POD_COMMAND_SET.has(event.command)
    && Object.hasOwn(event, "podTransition"),
  );
}

function isLifecycleOwnedEvent(event) {
  return Boolean(
    event
    && typeof event === "object"
    && !Array.isArray(event)
    && LIFECYCLE_COMMAND_SET.has(event.command)
    && Object.hasOwn(event, "lifecycleTransition"),
  );
}

function assertGenericTransitionOwner(event) {
  event = canonicalServiceSnapshot(
    event,
    "wakeflow-demand-state-event",
    "state transition event must be canonical plain data without accessors or hidden fields",
  );
  if (POD_COMMAND_SET.has(event.command) || Object.hasOwn(event, "podTransition")) {
    throw serviceError(
      "wakeflow-demand-state-pod-owner",
      "Pod-owned state transition requires its dedicated locked commit seam",
    );
  }
  if (
    DELIVERY_COMMAND_SET.has(event.command)
    || Object.hasOwn(event, "deliveryTransition")
  ) {
    throw serviceError(
      "wakeflow-demand-state-delivery-owner",
      "delivery-owned state transition requires its dedicated locked commit seam",
    );
  }
  if (
    event.command === REVIEW_DECISION_COMMAND
    || Object.hasOwn(event, "reviewDecision")
  ) {
    throw serviceError(
      "wakeflow-demand-state-review-owner",
      "review-owned state transition requires its dedicated locked commit seam",
    );
  }
  if (
    LIFECYCLE_COMMAND_SET.has(event.command)
    || Object.hasOwn(event, "lifecycleTransition")
    || (
      TERMINAL_DEMAND_STATE_SET.has(event.to)
      && event.from !== event.to
    )
  ) {
    throw serviceError(
      "wakeflow-demand-state-lifecycle-owner",
      "demand completion/cancellation requires its dedicated locked lifecycle commit seam",
    );
  }
  if (
    event.command === ARCHIVE_COMMAND
    || event.type === "demand.archived"
    || event.from === "archived"
    || event.to === "archived"
  ) {
    throw serviceError(
      "wakeflow-demand-state-archive-owner",
      "business archive requires its dedicated archive.json transaction owner",
    );
  }
  return event;
}


function assertReviewDecisionOwner(event) {
  event = canonicalServiceSnapshot(
    event,
    "wakeflow-demand-state-event",
    "review event must be canonical plain data without accessors or hidden fields",
  );
  if (!isReviewOwnedEvent(event)) {
    throw serviceError(
      "wakeflow-demand-state-review-owner",
      "review locked commit accepts only one exact review-decision event",
    );
  }
  return event;
}

function assertDeliveryTransitionOwner(event) {
  event = canonicalServiceSnapshot(
    event,
    "wakeflow-demand-state-event",
    "delivery event must be canonical plain data without accessors or hidden fields",
  );
  if (!isDeliveryOwnedEvent(event)) {
    throw serviceError(
      "wakeflow-demand-state-delivery-owner",
      "delivery locked commit accepts only one exact delivery-owned event",
    );
  }
  return event;
}

function assertPodTransitionOwner(event) {
  event = canonicalServiceSnapshot(
    event,
    "wakeflow-demand-state-event",
    "Pod event must be canonical plain data without accessors or hidden fields",
  );
  if (!isPodOwnedEvent(event)) {
    throw serviceError(
      "wakeflow-demand-state-pod-owner",
      "Pod locked commit accepts only one exact Pod-owned event",
    );
  }
  return event;
}

function assertLifecycleTransitionOwner(event) {
  event = canonicalServiceSnapshot(
    event,
    "wakeflow-demand-state-event",
    "lifecycle event must be canonical plain data without accessors or hidden fields",
  );
  if (!isLifecycleOwnedEvent(event)) {
    throw serviceError(
      "wakeflow-demand-state-lifecycle-owner",
      "lifecycle locked commit accepts only one exact complete/cancel event",
    );
  }
  return event;
}

function assertCurrentSnapshot(loaded, expectedPrevious) {
  if (
    loaded.state.revision !== expectedPrevious.revision
    || loaded.digests.state !== expectedPrevious.stateDigest
  ) {
    throw serviceError(
      "wakeflow-demand-state-stale",
      `state transition expected revision ${expectedPrevious.revision} and digest ${expectedPrevious.stateDigest}, but current state is revision ${loaded.state.revision} and digest ${loaded.digests.state}`,
      {
        expectedRevision: expectedPrevious.revision,
        expectedStateDigest: expectedPrevious.stateDigest,
        currentRevision: loaded.state.revision,
        currentStateDigest: loaded.digests.state,
      },
    );
  }
}

function assertExactAuthorityFreezeReplay({
  loaded,
  expectedPrevious,
  authority,
  authorityDigest,
  event,
  nextState,
  ledgerRoot,
}) {
  const committedEvent = loaded.events.at(-1);
  const authorityChange = committedEvent?.changedArtifacts.find((change) => (
    change.artifactKind === "wakeflow-demand-authority"
  ));
  if (
    loaded.events.length < 2
    || authorityChange?.ref !== WAKEFLOW_DEMAND_AUTHORITY_FILE
    || authorityChange.digest !== authorityDigest
    || canonicalJson(event) !== canonicalJson(committedEvent)
    || canonicalJson(nextState) !== canonicalJson(loaded.state)
  ) {
    throw serviceError(
      "wakeflow-demand-state-authority-conflict",
      "same authority bytes are idempotent only for the exact latest committed freeze event and state",
      { committedEventId: committedEvent.eventId, proposedEventId: event?.eventId ?? null },
    );
  }
  const previousEvents = loaded.events.slice(0, -1);
  const previousTail = previousEvents.at(-1);
  const previousState = structuredClone(loaded.state);
  delete previousState.demandAuthorityRef;
  delete previousState.demandAuthorityDigest;
  previousState.revision = previousTail.nextRevision;
  previousState.state = previousTail.to;
  previousState.stateReason = previousTail.reason;
  previousState.updatedAt = previousTail.createdAt;
  previousState.lastEvent = {
    eventId: previousTail.eventId,
    eventDigest: canonicalJsonDigest(previousTail),
  };
  try {
    const validatedPrevious = validateDemandCoreStack({
      demand: loaded.demand,
      authority: null,
      state: previousState,
      events: previousEvents,
      ledgerRoot,
    });
    if (
      expectedPrevious.revision !== validatedPrevious.state.revision
      || expectedPrevious.stateDigest !== validatedPrevious.digests.state
    ) {
      throw serviceError(
        "wakeflow-demand-state-authority-conflict",
        "authority replay must retain the exact original previous revision and state digest",
        {
          expectedRevision: expectedPrevious.revision,
          expectedStateDigest: expectedPrevious.stateDigest,
          originalRevision: validatedPrevious.state.revision,
          originalStateDigest: validatedPrevious.digests.state,
        },
      );
    }
    validateStateTransitionRecord({
      schemaVersion: 1,
      artifactKind: "wakeflow-state-transition",
      demandId: loaded.demand.demandId,
      command: event.command,
      createdAt: event.createdAt,
      expectedPreviousRevision: expectedPrevious.revision,
      expectedPreviousStateDigest: expectedPrevious.stateDigest,
      previousState: validatedPrevious.state,
      nextEvent: event,
      nextEventDigest: canonicalJsonDigest(event),
      nextState,
      nextStateDigest: canonicalJsonDigest(nextState),
      artifactWrites: [{
        artifactKind: "wakeflow-demand-authority",
        ref: WAKEFLOW_DEMAND_AUTHORITY_FILE,
        digest: authorityDigest,
        value: authority,
      }],
    }, {
      demand: loaded.demand,
      currentState: validatedPrevious.state,
      ledgerRoot,
    });
  } catch (cause) {
    if (cause?.code === "wakeflow-demand-state-authority-conflict") throw cause;
    throw serviceError(
      "wakeflow-demand-state-authority-conflict",
      "committed authority freeze cannot prove the exact original transaction intent",
      { causeCode: cause?.code ?? null },
      cause,
    );
  }
  return Object.freeze({
    created: false,
    demandId: loaded.demand.demandId,
    revision: loaded.state.revision,
    authorityDigest,
  });
}

function assertExactEvidenceReplay({
  loaded,
  expectedPrevious,
  evidence,
  evidenceWrite,
  event,
  nextState,
  ledgerRoot,
}) {
  const committedEvent = loaded.events.find((entry) => entry.eventId === event.eventId) ?? null;
  if (!committedEvent) return null;
  if (canonicalJson(committedEvent) !== canonicalJson(event)) {
    throw serviceError(
      "wakeflow-demand-state-evidence-conflict",
      "committed evidence event ID is already bound to different canonical bytes",
    );
  }
  const currentTuple = loaded.state.evidence.find(
    (entry) => entry.evidenceId === evidenceWrite.artifactId,
  );
  if (
    !currentTuple
    || currentTuple.ref !== evidenceWrite.ref
    || currentTuple.digest !== evidenceWrite.digest
  ) {
    throw serviceError(
      "wakeflow-demand-state-evidence-conflict",
      "committed evidence replay is not retained by the current exact state tuple",
    );
  }
  const previousEvents = loaded.events.slice(0, event.previousRevision);
  const previousTail = previousEvents.at(-1);
  if (!previousTail || previousEvents.length !== expectedPrevious.revision) {
    throw serviceError(
      "wakeflow-demand-state-evidence-conflict",
      "committed evidence replay cannot reconstruct its exact previous event prefix",
    );
  }
  const previousState = structuredClone(nextState);
  previousState.evidence = previousState.evidence.filter(
    (entry) => entry.evidenceId !== evidenceWrite.artifactId,
  );
  previousState.revision = previousTail.nextRevision;
  previousState.state = previousTail.to;
  previousState.stateReason = previousTail.reason;
  previousState.updatedAt = previousTail.createdAt;
  previousState.lastEvent = {
    eventId: previousTail.eventId,
    eventDigest: canonicalJsonDigest(previousTail),
  };
  let validatedPrevious;
  try {
    const authorityAtPrevious = Object.hasOwn(previousState, "demandAuthorityRef")
      ? loaded.authority
      : null;
    validatedPrevious = validateDemandCoreStack({
      demand: loaded.demand,
      authority: authorityAtPrevious,
      state: previousState,
      events: previousEvents,
      ledgerRoot,
    });
    if (
      validatedPrevious.state.revision !== expectedPrevious.revision
      || validatedPrevious.digests.state !== expectedPrevious.stateDigest
    ) {
      throw serviceError(
        "wakeflow-demand-state-evidence-conflict",
        "committed evidence replay differs from the exact original previous state",
      );
    }
    validateStateTransitionRecord({
      schemaVersion: 1,
      artifactKind: "wakeflow-state-transition",
      demandId: loaded.demand.demandId,
      command: event.command,
      createdAt: event.createdAt,
      expectedPreviousRevision: expectedPrevious.revision,
      expectedPreviousStateDigest: expectedPrevious.stateDigest,
      previousState: validatedPrevious.state,
      nextEvent: event,
      nextEventDigest: canonicalJsonDigest(event),
      nextState,
      nextStateDigest: canonicalJsonDigest(nextState),
      artifactWrites: [evidenceWrite],
    }, {
      demand: loaded.demand,
      currentState: validatedPrevious.state,
      ledgerRoot,
    });
    loadManagedEvidenceByRef({
      stateRoot: loaded.paths.stateRoot,
      ref: evidenceWrite.ref,
      digest: evidenceWrite.digest,
      expectedEvidenceId: evidenceWrite.artifactId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
      expectedDemandDigest: loaded.digests.demand,
    });
    assertCommittedCandidateArtifactClosure(loaded);
  } catch (cause) {
    if (cause?.code === "wakeflow-demand-state-evidence-conflict") throw cause;
    throw serviceError(
      "wakeflow-demand-state-evidence-conflict",
      "committed evidence cannot prove the exact original transition intent",
      { causeCode: cause?.code ?? null },
      cause,
    );
  }
  return Object.freeze({
    created: false,
    demandId: loaded.demand.demandId,
    previousRevision: expectedPrevious.revision,
    revision: loaded.state.revision,
    eventId: committedEvent.eventId,
    eventDigest: canonicalJsonDigest(committedEvent),
    stateDigest: loaded.digests.state,
    authorityDigest: loaded.digests.authority,
    artifact: evidenceIdentity(evidence),
  });
}

// 组装 journal 后立即交给 core codec，并用追加 event 后的完整 stack 做第二次闭包验证。
function buildTransitionRecord({
  loaded,
  expectedPrevious,
  event,
  nextState,
  artifactWrites,
  ledgerRoot,
}) {
  const transition = {
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: loaded.demand.demandId,
    command: event?.command,
    createdAt: event?.createdAt,
    expectedPreviousRevision: expectedPrevious.revision,
    expectedPreviousStateDigest: expectedPrevious.stateDigest,
    nextEvent: event,
    nextEventDigest: canonicalJsonDigest(event),
    nextState,
    nextStateDigest: canonicalJsonDigest(nextState),
    artifactWrites,
    previousState: loaded.state,
  };
  const validated = validateStateTransitionRecord(transition, {
    demand: loaded.demand,
    currentState: loaded.state,
    ledgerRoot,
    events: loaded.events,
  });
  const authorityWrite = validated.artifactWrites.find(
    (write) => write.artifactKind === "wakeflow-demand-authority",
  ) ?? null;
  validateDemandCoreStack({
    demand: loaded.demand,
    authority: authorityWrite?.value ?? loaded.authority,
    state: validated.nextState,
    events: [...loaded.events, validated.nextEvent],
    ledgerRoot,
  });
  return validated;
}

function renderEventLog(events) {
  return Buffer.from(`${events.map((event) => canonicalJson(event)).join("\n")}\n`, "utf8");
}

function atomicCreate({ root, target, value, label }) {
  return atomicWriteFile({
    root,
    target,
    content: demandCoreCanonicalBytes(value),
    expectation: { type: "absent" },
    mode: 0o600,
    ownership: "whole-file",
    label,
  });
}

function candidateArtifactTarget(stateRoot, write) {
  const validated = validateDemandArtifactWriteIntent(write);
  return Object.freeze({
    write: validated,
    target: path.join(stateRoot, ...validated.ref.split("/")),
  });
}

function lstatIfPresent(target) {
  try {
    return lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isEvidenceWrite(write) {
  return write?.artifactKind === "wakeflow-evidence";
}

function evidenceArtifactPaths(stateRoot, write) {
  const validated = validateEvidenceWriteIntent(write);
  return Object.freeze({
    write: validated,
    root: evidenceRootPath({ stateRoot, evidenceId: validated.artifactId }),
    stage: evidenceStagePath({ stateRoot, evidenceId: validated.artifactId }),
  });
}

function assertPrivateCandidateDirectory(directory, label) {
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw serviceError(
      "wakeflow-demand-state-artifact-parent",
      `${label} must be a real directory`,
      { directory },
    );
  }
  if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o700) {
    throw serviceError(
      "wakeflow-demand-state-artifact-parent",
      `${label} must use mode 0700`,
      { directory, mode: stat.mode & 0o777 },
    );
  }
  return stat;
}

function assertNoCandidateArtifactStageResidue(stateRoot, write) {
  const { target } = candidateArtifactTarget(stateRoot, write);
  const parent = path.dirname(target);
  let entries;
  try {
    entries = readdirSync(parent, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const prefix = `.${path.basename(target)}.wakeflow-stage-`;
  const residue = entries.map((entry) => entry.name).sort().find((name) => name.startsWith(prefix));
  if (residue) {
    throw serviceError(
      "wakeflow-demand-state-artifact-stage-residue",
      `interrupted artifact stage ${residue} must be resolved explicitly before mutation or recovery`,
      { parent, residue, artifactKind: write.artifactKind, artifactId: write.artifactId },
    );
  }
}

function ensureCandidateArtifactParent(stateRoot, write) {
  const { target } = candidateArtifactTarget(stateRoot, write);
  const parent = path.dirname(target);
  const grandparent = path.dirname(parent);
  if (write.artifactKind === "wakeflow-target-result") {
    assertPrivateCandidateDirectory(grandparent, "TargetResult capability root");
  }
  let parentStat;
  try {
    parentStat = lstatSync(parent);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (write.artifactKind !== "wakeflow-target-result") {
      throw serviceError(
        "wakeflow-demand-state-artifact-parent",
        "published demand capability directory is missing and cannot be created as an artifact side effect",
        { parent, artifactKind: write.artifactKind },
      );
    }
    mkdirSync(parent, { mode: 0o700 });
    parentStat = lstatSync(parent);
  }
  assertPrivateCandidateDirectory(parent, "candidate artifact parent");
  return target;
}

function assertCandidateArtifactDestinationAbsent(stateRoot, write) {
  if (isEvidenceWrite(write)) {
    const targets = evidenceArtifactPaths(stateRoot, write);
    assertPrivateCandidateDirectory(path.dirname(targets.root), "evidence capability root");
    if (lstatIfPresent(targets.root) || lstatIfPresent(targets.stage)) {
      throw serviceError(
        "wakeflow-demand-state-artifact-conflict",
        "immutable evidence root or deterministic stage already exists outside the requested transition",
        { artifactKind: write.artifactKind, artifactId: write.artifactId },
      );
    }
    assertNoEvidenceStageResidue({ stateRoot });
    return;
  }
  const { target } = candidateArtifactTarget(stateRoot, write);
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    stat = null;
  }
  if (stat) {
    throw serviceError(
      "wakeflow-demand-state-artifact-conflict",
      "immutable demand artifact target already exists outside the requested state transition",
      { target, artifactKind: write.artifactKind, artifactId: write.artifactId },
    );
  }
  const parent = path.dirname(target);
  const grandparent = path.dirname(parent);
  if (write.artifactKind === "wakeflow-target-result") {
    assertPrivateCandidateDirectory(grandparent, "TargetResult capability root");
  }
  let parentStat;
  try {
    parentStat = lstatSync(parent);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (write.artifactKind !== "wakeflow-target-result") {
      throw serviceError(
        "wakeflow-demand-state-artifact-parent",
        "published demand capability directory is missing",
        { parent, artifactKind: write.artifactKind },
      );
    }
    return;
  }
  assertPrivateCandidateDirectory(parent, "candidate artifact parent");
  assertNoCandidateArtifactStageResidue(stateRoot, write);
}

function assertCommittedCandidateArtifactClosure(
  loaded,
  events = loaded.events,
  { allowPendingEvidenceId = null } = {},
) {
  const expectedArtifacts = events.flatMap((event) => event.changedArtifacts.filter(
    (entry) => [
      "wakeflow-task-package",
      "wakeflow-target-result",
      "wakeflow-review-candidate",
      "wakeflow-test-card",
      "wakeflow-pod-design-request",
      "wakeflow-pod-design-handoff",
    ].includes(entry.artifactKind),
  ));
  const inventory = inspectDemandArtifactInventory({
    stateRoot: loaded.paths.stateRoot,
    expectedProgramId: loaded.demand.programId,
    expectedDemandId: loaded.demand.demandId,
    expectedArtifacts,
  });
  const expectedRefs = new Set(expectedArtifacts.map((entry) => entry.ref));
  const blockingIssues = inventory.issues.filter((issue) => (
    expectedRefs.has(issue.ref)
    || issue.classification === "missing"
    || issue.code === "wakeflow-demand-artifact-inventory-duplicate-identity"
  ));
  if (blockingIssues.length > 0) {
    throw serviceError(
      "wakeflow-demand-state-artifact-inventory",
      "candidate artifact mutation requires exact closure for every committed event artifact",
      { issues: blockingIssues },
    );
  }

  const expectedEvidence = events.flatMap((event) => event.changedArtifacts.filter(
    (entry) => entry.artifactKind === "wakeflow-evidence",
  )).sort((left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0);
  const evidenceInventory = inspectManagedEvidenceInventory({
    stateRoot: loaded.paths.stateRoot,
    expectedProgramId: loaded.demand.programId,
    expectedDemandId: loaded.demand.demandId,
    expectedDemandDigest: loaded.digests.demand,
    expectedEvidence,
  });
  const allowedStageRef = allowPendingEvidenceId === null
    ? null
    : `evidence/.${allowPendingEvidenceId}.wakeflow-stage`;
  const allowedRootRef = allowPendingEvidenceId === null
    ? null
    : `evidence/${allowPendingEvidenceId}/evidence.json`;
  const evidenceIssues = evidenceInventory.issues.filter((issue) => !(
    (
      issue.code === "wakeflow-evidence-inventory-stage-residue"
      && issue.ref === allowedStageRef
    ) || (
      issue.classification === "orphan"
      && issue.ref === allowedRootRef
    )
  ));
  if (evidenceIssues.length > 0) {
    throw serviceError(
      "wakeflow-demand-state-evidence-inventory",
      "candidate mutation requires exact closure for every committed managed evidence root",
      { issues: evidenceIssues },
    );
  }
}

function assertRecoveryCandidateArtifactClosure(
  loaded,
  events,
  phase,
  { allowPendingEvidenceId = null } = {},
) {
  try {
    assertCommittedCandidateArtifactClosure(loaded, events, { allowPendingEvidenceId });
  } catch (cause) {
    recoveryConflict(
      `journal recovery requires exact committed artifact closure ${phase}`,
      { causeCode: cause?.code ?? null, issues: cause?.details?.issues ?? [] },
      cause,
    );
  }
}

function atomicCreateCandidateArtifact({ loaded, write, label }) {
  const target = ensureCandidateArtifactParent(loaded.paths.stateRoot, write);
  return atomicWriteFile({
    root: loaded.paths.stateRoot,
    target,
    content: demandArtifactCanonicalBytes(write.value),
    expectation: { type: "absent" },
    mode: 0o600,
    ownership: "whole-file",
    label,
  });
}

function atomicReplace({ root, target, value, expectedByteDigest, label }) {
  return atomicWriteFile({
    root,
    target,
    content: demandCoreCanonicalBytes(value),
    expectation: { type: "file", sha256: expectedByteDigest },
    mode: 0o600,
    ownership: "whole-file",
    label,
  });
}

function atomicReplaceEventLog({ loaded, event }) {
  const content = renderEventLog([...loaded.events, event]);
  return atomicWriteFile({
    root: loaded.paths.stateRoot,
    target: loaded.paths.events,
    content,
    expectation: { type: "file", sha256: loaded.byteDigests.events },
    mode: 0o600,
    ownership: "whole-file",
    label: "candidate controller event log",
  });
}

// journal 删除前用 no-follow、当前 owner、纳秒级稳定身份和 exact bytes 再验一次。
function inspectExactJournal(file, expectedBytes) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (cause) {
    throw serviceError(
      "wakeflow-demand-state-journal-cleanup",
      "state transition journal disappeared before its verified cleanup",
      { file },
      cause,
    );
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || (process.platform !== "win32" && permissionBits(before) !== 0o600)
    || !journalOwnedByCurrentUser(before)
  ) {
    throw serviceError(
      "wakeflow-demand-state-journal-cleanup",
      "state transition journal must remain the regular file created by this transition",
      { file },
    );
  }
  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    throw serviceError(
      "wakeflow-demand-state-journal-cleanup",
      "state transition journal cannot be opened safely for cleanup",
      { file },
      cause,
    );
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    const expectedSize = BigInt(expectedBytes.length);
    if (
      !opened.isFile()
      || opened.nlink !== 1n
      || (process.platform !== "win32" && permissionBits(opened) !== 0o600)
      || !journalOwnedByCurrentUser(opened)
      || !journalNodeIsStable(before, opened)
      || opened.size !== expectedSize
    ) {
      throw serviceError(
        "wakeflow-demand-state-journal-cleanup",
        "state transition journal changed before cleanup",
        { file },
      );
    }
    const actual = Buffer.alloc(expectedBytes.length + 1);
    let offset = 0;
    while (offset < actual.length) {
      const count = readSync(descriptor, actual, offset, actual.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = lstatSync(file, { bigint: true });
    if (
      after.isSymbolicLink()
      || !after.isFile()
      || after.nlink !== 1n
      || (process.platform !== "win32" && permissionBits(after) !== 0o600)
      || !journalOwnedByCurrentUser(after)
      || !journalNodeIsStable(after, opened)
      || offset !== expectedBytes.length
      || !actual.subarray(0, offset).equals(expectedBytes)
    ) {
      throw serviceError(
        "wakeflow-demand-state-journal-cleanup",
        "state transition journal bytes changed before cleanup",
        {
          file,
          expectedByteDigest: sha256Bytes(expectedBytes),
          actualByteDigest: sha256Bytes(actual.subarray(0, offset)),
        },
      );
    }
    return opened;
  } finally {
    closeSync(descriptor);
  }
}

function unlinkExactJournal(file, expectedBytes) {
  const inspected = inspectExactJournal(file, expectedBytes);
  const final = lstatSync(file, { bigint: true });
  if (
    final.isSymbolicLink()
    || !final.isFile()
    || final.nlink !== 1n
    || (process.platform !== "win32" && permissionBits(final) !== 0o600)
    || !journalOwnedByCurrentUser(final)
    || !journalNodeIsStable(final, inspected)
  ) {
    throw serviceError(
      "wakeflow-demand-state-journal-cleanup",
      "state transition journal changed at the cleanup boundary",
      { file },
    );
  }
  unlinkSync(file);
}

// 任何一步崩溃都保留 journal；成功只有在新 stack 闭包通过后才清理 intent。
function commitTransitionRecord({ loaded, transition, resolvedEvidenceSourceRoot = null }) {
  const journalBytes = demandCoreCanonicalBytes(transition);
  atomicWriteFile({
    root: loaded.paths.stateRoot,
    target: loaded.paths.stateTransition,
    content: journalBytes,
    expectation: { type: "absent" },
    mode: 0o600,
    ownership: "whole-file",
    label: "candidate state transition journal",
  });

  for (const write of transition.artifactWrites) {
    if (write.artifactKind === "wakeflow-demand-authority") {
      atomicCreate({
        root: loaded.paths.stateRoot,
        target: loaded.paths.authority,
        value: write.value,
        label: "immutable candidate demand authority",
      });
    } else if (isEvidenceWrite(write)) {
      materializeEvidenceStage({
        stateRoot: loaded.paths.stateRoot,
        write,
        resolvedSourceRoot: resolvedEvidenceSourceRoot,
      });
      publishEvidenceStage({ stateRoot: loaded.paths.stateRoot, write });
    } else {
      atomicCreateCandidateArtifact({
        loaded,
        write,
        label: `immutable ${write.artifactKind}`,
      });
    }
  }
  atomicReplaceEventLog({ loaded, event: transition.nextEvent });
  atomicReplace({
    root: loaded.paths.stateRoot,
    target: loaded.paths.state,
    value: transition.nextState,
    expectedByteDigest: loaded.byteDigests.state,
    label: "candidate demand state snapshot",
  });
  assertCommittedCandidateArtifactClosure(loaded, [...loaded.events, transition.nextEvent]);
  unlinkExactJournal(loaded.paths.stateTransition, journalBytes);

  return Object.freeze({
    created: true,
    demandId: loaded.demand.demandId,
    previousRevision: transition.expectedPreviousRevision,
    revision: transition.nextState.revision,
    eventId: transition.nextEvent.eventId,
    eventDigest: transition.nextEventDigest,
    stateDigest: transition.nextStateDigest,
    authorityDigest: transition.artifactWrites.find((entry) => entry.artifactKind === "wakeflow-demand-authority")?.digest
      ?? loaded.digests.authority,
    artifact: transition.artifactWrites[0]
      ? Object.freeze({
        artifactKind: transition.artifactWrites[0].artifactKind,
        artifactId: transition.artifactWrites[0].artifactId ?? null,
        ref: transition.artifactWrites[0].ref,
        digest: transition.artifactWrites[0].digest,
      })
      : null,
  });
}

function recoveryConflict(message, details = {}, cause = undefined) {
  throw serviceError("wakeflow-demand-state-recovery-conflict", message, details, cause);
}

function validateExactRecoveryAdmission(rawAdmission, owner) {
  const admission = canonicalServiceSnapshot(
    rawAdmission,
    "wakeflow-demand-state-recovery-conflict",
    `${owner} recovery admission must return canonical plain data`,
  );
  if (
    !admission
    || typeof admission !== "object"
    || Array.isArray(admission)
    || Object.keys(admission).length !== 1
    || admission.admitted !== true
  ) {
    recoveryConflict(`${owner} recovery admission must synchronously return only { admitted: true }`);
  }
  return admission;
}

function stateHasAuthority(state) {
  return Object.hasOwn(state, "demandAuthorityRef");
}

function eventDigest(event) {
  return canonicalJsonDigest(event);
}

function validateRecoveryStack(stack, message) {
  try {
    return validateDemandCoreStack(stack);
  } catch (cause) {
    recoveryConflict(message, { causeCode: cause?.code ?? null }, cause);
  }
}

function reconstructRecoveryPrevious({ loaded, journal, authorityWrite, eventIsWritten }) {
  const events = eventIsWritten ? loaded.events.slice(0, -1) : loaded.events;
  const tail = events.at(-1);
  if (!tail || events.length !== journal.expectedPreviousRevision) {
    recoveryConflict("controller event prefix cannot reconstruct the journal's previous revision", {
      eventCount: events.length,
      expectedPreviousRevision: journal.expectedPreviousRevision,
    });
  }
  if (journal.previousState) {
    const state = journal.previousState;
    const digest = canonicalJsonDigest(state);
    if (
      digest !== journal.expectedPreviousStateDigest
      || state.revision !== journal.expectedPreviousRevision
      || state.lastEvent.eventId !== tail.eventId
      || state.lastEvent.eventDigest !== eventDigest(tail)
      || state.state !== tail.to
      || state.stateReason !== tail.reason
      || state.updatedAt !== tail.createdAt
    ) {
      recoveryConflict("journal previousState does not bind the exact previous event tail", {
        previousStateDigest: digest,
        journalPreviousStateDigest: journal.expectedPreviousStateDigest,
      });
    }
    const stateNamesAuthority = stateHasAuthority(state);
    const authority = stateNamesAuthority ? loaded.authority : null;
    if (stateNamesAuthority && !authority) {
      recoveryConflict("journal previousState names authority but the immutable authority file is missing");
    }
    if (!stateNamesAuthority && loaded.authority && !authorityWrite) {
      recoveryConflict("authority file exists outside the journal previousState");
    }
    return Object.freeze({ authority, events, state });
  }
  const authority = authorityWrite ? null : loaded.authority;
  const state = {
    schemaVersion: 1,
    artifactKind: "wakeflow-state",
    programId: loaded.demand.programId,
    demandId: loaded.demand.demandId,
    demandRef: journal.nextState.demandRef,
    demandDigest: canonicalJsonDigest(loaded.demand),
    ...(authority === null ? {} : {
      demandAuthorityRef: WAKEFLOW_DEMAND_AUTHORITY_FILE,
      demandAuthorityDigest: canonicalJsonDigest(authority),
    }),
    revision: journal.expectedPreviousRevision,
    state: journal.nextEvent.from,
    stateReason: tail.reason,
    updatedAt: tail.createdAt,
    lastEvent: {
      eventId: tail.eventId,
      eventDigest: eventDigest(tail),
    },
  };
  const digest = canonicalJsonDigest(state);
  if (digest !== journal.expectedPreviousStateDigest) {
    recoveryConflict("journal previous-state digest does not match the state reconstructed from its exact event prefix", {
      reconstructedPreviousStateDigest: digest,
      journalPreviousStateDigest: journal.expectedPreviousStateDigest,
    });
  }
  return Object.freeze({ authority, events, state });
}

function inspectCandidateArtifactWrite(loaded, write) {
  if (!write) return true;
  if (isEvidenceWrite(write)) {
    const { root, stage } = evidenceArtifactPaths(loaded.paths.stateRoot, write);
    const rootStat = lstatIfPresent(root);
    const stageStat = lstatIfPresent(stage);
    if (rootStat && stageStat) {
      recoveryConflict("journaled evidence final root and deterministic stage cannot coexist", {
        artifactId: write.artifactId,
      });
    }
    if (!rootStat) {
      if (stageStat) {
        try {
          inspectEvidenceStage({ stateRoot: loaded.paths.stateRoot, write, allowMissing: false });
        } catch (cause) {
          recoveryConflict(
            "journaled evidence stage conflicts with its exact immutable intent",
            { artifactId: write.artifactId, causeCode: cause?.code ?? null },
            cause,
          );
        }
      }
      return false;
    }
    try {
      inspectEvidenceFinalWrite({ stateRoot: loaded.paths.stateRoot, write });
      loadManagedEvidenceByRef({
        stateRoot: loaded.paths.stateRoot,
        ref: write.ref,
        digest: write.digest,
        expectedEvidenceId: write.artifactId,
        expectedProgramId: loaded.demand.programId,
        expectedDemandId: loaded.demand.demandId,
        expectedDemandDigest: loaded.digests.demand,
      });
    } catch (cause) {
      recoveryConflict(
        "journaled evidence root conflicts with its exact immutable create intent",
        { artifactId: write.artifactId, causeCode: cause?.code ?? null },
        cause,
      );
    }
    return true;
  }
  assertNoCandidateArtifactStageResidue(loaded.paths.stateRoot, write);
  const { target } = candidateArtifactTarget(loaded.paths.stateRoot, write);
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    recoveryConflict("journaled demand artifact cannot be inspected", { target }, error);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    recoveryConflict("journaled demand artifact target must be a regular non-symlink file", { target });
  }
  try {
    const identity = demandArtifactIdentity(write.value);
    loadDemandArtifactByRef({
      stateRoot: loaded.paths.stateRoot,
      ref: identity.ref,
      digest: identity.digest,
      expectedArtifactKind: identity.artifactKind,
      expectedArtifactId: identity.artifactId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
    });
  } catch (cause) {
    recoveryConflict(
      "journaled demand artifact conflicts with the exact immutable create intent",
      { target, causeCode: cause?.code ?? null },
      cause,
    );
  }
  return true;
}

function validateRecoveryPosition(loaded, ledgerRoot) {
  const { journal } = loaded;
  const currentDigest = canonicalJsonDigest(loaded.state);
  const stateIsPrevious = (
    loaded.state.revision === journal.expectedPreviousRevision
    && currentDigest === journal.expectedPreviousStateDigest
  );
  const stateIsNext = (
    loaded.state.revision === journal.nextState.revision
    && currentDigest === journal.nextStateDigest
    && canonicalJson(loaded.state) === canonicalJson(journal.nextState)
  );
  if (!stateIsPrevious && !stateIsNext) {
    recoveryConflict(
      "current state is neither the journal's exact expected snapshot nor its exact next snapshot",
      {
        currentRevision: loaded.state.revision,
        currentStateDigest: currentDigest,
        expectedPreviousRevision: journal.expectedPreviousRevision,
        expectedPreviousStateDigest: journal.expectedPreviousStateDigest,
        nextRevision: journal.nextState.revision,
        nextStateDigest: journal.nextStateDigest,
      },
    );
  }

  const authorityWrite = journal.artifactWrites.find((entry) => entry.artifactKind === "wakeflow-demand-authority") ?? null;
  const candidateWrite = journal.artifactWrites.find((entry) => entry.artifactKind !== "wakeflow-demand-authority") ?? null;
  const candidateIsWritten = inspectCandidateArtifactWrite(loaded, candidateWrite);
  if (authorityWrite) {
    if (loaded.authority && (
      canonicalJsonDigest(loaded.authority) !== authorityWrite.digest
      || canonicalJson(loaded.authority) !== canonicalJson(authorityWrite.value)
    )) {
      recoveryConflict("authority file conflicts with the exact journaled authority bytes", {
        currentAuthorityDigest: canonicalJsonDigest(loaded.authority),
        intendedAuthorityDigest: authorityWrite.digest,
      });
    }
    if (stateIsPrevious && stateHasAuthority(loaded.state)) {
      recoveryConflict("authority-freeze journal cannot start from a state that already names authority");
    }
  } else {
    const stateNamesAuthority = stateHasAuthority(loaded.state);
    if (stateNamesAuthority !== Boolean(loaded.authority)) {
      recoveryConflict(
        stateNamesAuthority
          ? "state names frozen authority but its exact file is missing"
          : "authority file exists without state or journal authority",
      );
    }
    if (
      stateNamesAuthority
      && loaded.state.demandAuthorityDigest !== canonicalJsonDigest(loaded.authority)
    ) {
      recoveryConflict("state authority digest does not match the exact frozen authority file", {
        stateAuthorityDigest: loaded.state.demandAuthorityDigest,
        currentAuthorityDigest: canonicalJsonDigest(loaded.authority),
      });
    }
  }
  const previousEventCount = journal.expectedPreviousRevision;
  const nextEventCount = journal.nextEvent.nextRevision;
  let eventIsWritten = false;
  if (loaded.events.length === previousEventCount) {
    if (stateIsNext) {
      recoveryConflict("next state is visible before its required controller event");
    }
  } else if (loaded.events.length === nextEventCount) {
    const tail = loaded.events.at(-1);
    if (
      tail.eventId !== journal.nextEvent.eventId
      || eventDigest(tail) !== journal.nextEventDigest
      || canonicalJson(tail) !== canonicalJson(journal.nextEvent)
    ) {
      recoveryConflict("controller event revision is occupied by bytes different from the journaled event", {
        intendedEventId: journal.nextEvent.eventId,
        actualEventId: tail.eventId,
        intendedEventDigest: journal.nextEventDigest,
        actualEventDigest: eventDigest(tail),
      });
    }
    eventIsWritten = true;
  } else {
    recoveryConflict("controller event history length is incompatible with the pending transition", {
      eventCount: loaded.events.length,
      expectedPreviousCount: previousEventCount,
      expectedNextCount: nextEventCount,
    });
  }
  if (authorityWrite && !loaded.authority && (eventIsWritten || stateIsNext)) {
    recoveryConflict("journaled authority event or next state is visible but its immutable authority file is missing");
  }
  if (candidateWrite && !candidateIsWritten && (eventIsWritten || stateIsNext)) {
    recoveryConflict("journaled artifact event or next state is visible but its immutable demand artifact is missing");
  }

  const previous = reconstructRecoveryPrevious({
    loaded,
    journal,
    authorityWrite,
    eventIsWritten,
  });
  validateRecoveryStack({
    demand: loaded.demand,
    authority: previous.authority,
    state: previous.state,
    events: previous.events,
    ledgerRoot,
  }, "journal recovery event prefix is not one healthy exact previous stack");
  assertRecoveryCandidateArtifactClosure(loaded, previous.events, "before replay", {
    allowPendingEvidenceId: isEvidenceWrite(candidateWrite) ? candidateWrite.artifactId : null,
  });
  try {
    validateStateTransitionRecord(journal, {
      demand: loaded.demand,
      currentState: previous.state,
      ledgerRoot,
      events: previous.events,
    });
  } catch (cause) {
    recoveryConflict(
      "state transition journal is not valid against its reconstructed exact previous snapshot",
      { causeCode: cause?.code ?? null },
      cause,
    );
  }
  if (stateIsPrevious && canonicalJson(loaded.state) !== canonicalJson(previous.state)) {
    recoveryConflict("visible previous state bytes differ from the exact state reconstructed from event history");
  }
  if (stateIsNext && !eventIsWritten) recoveryConflict("next state requires the exact next controller event");

  validateRecoveryStack({
    demand: loaded.demand,
    authority: authorityWrite?.value ?? loaded.authority,
    state: journal.nextState,
    events: eventIsWritten ? loaded.events : [...loaded.events, journal.nextEvent],
    ledgerRoot,
  }, "journaled transition would not produce one valid final demand stack");

  return Object.freeze({
    stateIsPrevious,
    stateIsNext,
    eventIsWritten,
    authorityIsWritten: authorityWrite ? loaded.authority !== null : true,
    candidateIsWritten,
  });
}

function replayRecovery({
  loaded,
  position,
  ledgerRoot,
  expectedProgramId,
  resolveEvidenceSource = null,
}) {
  const { journal } = loaded;
  const authorityWrite = journal.artifactWrites.find((entry) => entry.artifactKind === "wakeflow-demand-authority") ?? null;
  const candidateWrite = journal.artifactWrites.find((entry) => entry.artifactKind !== "wakeflow-demand-authority") ?? null;
  let resolvedPendingEvidenceSourceRoot = null;
  if (isEvidenceWrite(candidateWrite) && !position.candidateIsWritten) {
    if (typeof resolveEvidenceSource !== "function") {
      recoveryConflict("managed evidence recovery must use the config-aware evidence recovery entrypoint");
    }
    try {
      resolvedPendingEvidenceSourceRoot = resolveEvidenceSource(
        candidateWrite,
        Object.freeze({ loaded, position }),
      );
    } catch (cause) {
      if (cause?.code === "wakeflow-demand-state-recovery-conflict") throw cause;
      recoveryConflict(
        "pending evidence recovery no longer has the exact config/controller admission",
        { artifactId: candidateWrite.artifactId, causeCode: cause?.code ?? null },
        cause,
      );
    }
  }
  if (authorityWrite && !position.authorityIsWritten) {
    atomicCreate({
      root: loaded.paths.stateRoot,
      target: loaded.paths.authority,
      value: authorityWrite.value,
      label: "recovered immutable candidate demand authority",
    });
  }
  if (candidateWrite && !position.candidateIsWritten) {
    if (isEvidenceWrite(candidateWrite)) {
      try {
        materializeEvidenceStage({
          stateRoot: loaded.paths.stateRoot,
          write: candidateWrite,
          resolvedSourceRoot: resolvedPendingEvidenceSourceRoot,
        });
        publishEvidenceStage({ stateRoot: loaded.paths.stateRoot, write: candidateWrite });
      } catch (cause) {
        if (cause?.code === "wakeflow-demand-state-recovery-conflict") throw cause;
        recoveryConflict(
          "journaled evidence source or stage cannot forward-complete the exact immutable root",
          { artifactId: candidateWrite.artifactId, causeCode: cause?.code ?? null },
          cause,
        );
      }
    } else {
      atomicCreateCandidateArtifact({
        loaded,
        write: candidateWrite,
        label: `recovered immutable ${candidateWrite.artifactKind}`,
      });
    }
  }
  if (!position.eventIsWritten) {
    atomicReplaceEventLog({ loaded, event: journal.nextEvent });
  }
  if (position.stateIsPrevious) {
    atomicReplace({
      root: loaded.paths.stateRoot,
      target: loaded.paths.state,
      value: journal.nextState,
      expectedByteDigest: loaded.byteDigests.state,
      label: "recovered candidate demand state snapshot",
    });
  }

  const final = loadDemandCoreRecoveryRecordsWhileLocked({
    stateRoot: loaded.paths.stateRoot,
    expectedProgramId,
    ledgerRoot,
  });
  if (
    final.byteDigests.journal !== loaded.byteDigests.journal
    || canonicalJson(final.journal) !== canonicalJson(journal)
  ) {
    recoveryConflict("state transition journal changed while its exact intent was being recovered", {
      expectedJournalByteDigest: loaded.byteDigests.journal,
      actualJournalByteDigest: final.byteDigests.journal,
    });
  }
  if (
    final.digests.state !== journal.nextStateDigest
    || final.events.length !== journal.nextEvent.nextRevision
    || final.events.at(-1).eventId !== journal.nextEvent.eventId
    || eventDigest(final.events.at(-1)) !== journal.nextEventDigest
  ) {
    recoveryConflict("replayed transition does not match its exact journaled state/event pair");
  }
  if (candidateWrite) inspectCandidateArtifactWrite(final, candidateWrite);
  validateDemandCoreStack({
    demand: final.demand,
    authority: final.authority,
    state: final.state,
    events: final.events,
    ledgerRoot,
  });
  assertRecoveryCandidateArtifactClosure(final, final.events, "after replay");
  unlinkExactJournal(
    final.paths.stateTransition,
    demandCoreCanonicalBytes(final.journal),
  );
  return Object.freeze({
    status: "recovered",
    demandId: final.demand.demandId,
    revision: final.state.revision,
    eventId: final.events.at(-1).eventId,
    eventDigest: journal.nextEventDigest,
    stateDigest: journal.nextStateDigest,
    authorityDigest: final.digests.authority,
    artifact: candidateWrite
      ? (isEvidenceWrite(candidateWrite)
        ? evidenceIdentity(candidateWrite.value)
        : demandArtifactIdentity(candidateWrite.value))
      : null,
  });
}

/** 提交不创建 artifact、且不属于专用 owner 的普通状态修订。 */
export function commitDemandStateTransition({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
  expectedPrevious,
  event,
  nextState,
} = {}) {
  event = assertGenericTransitionOwner(event);
  const programId = normalizeExpectedProgramId(expectedProgramId);
  const expected = normalizeExpectedPrevious(expectedPrevious);
  return withStateRootLock(stateRoot, () => {
    const loaded = loadDemandCoreRecordsWhileLocked({
      stateRoot,
      expectedProgramId: programId,
      ledgerRoot,
    });
    assertCommittedCandidateArtifactClosure(loaded);
    assertCurrentSnapshot(loaded, expected);
    const transition = buildTransitionRecord({
      loaded,
      expectedPrevious: expected,
      event,
      nextState,
      artifactWrites: [],
      ledgerRoot,
    });
    return commitTransitionRecord({ loaded, transition });
  });
}

/** 已持锁读取 core stack，并核对磁盘上全部已提交 artifact/evidence 闭包。 */
export function loadDemandCoreRecordsWithArtifactClosureWhileLocked({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
} = {}) {
  const programId = normalizeExpectedProgramId(expectedProgramId);
  const loaded = loadDemandCoreRecordsWhileLocked({
    stateRoot,
    expectedProgramId: programId,
    ledgerRoot,
  });
  assertCommittedCandidateArtifactClosure(loaded);
  return loaded;
}

/** 自动持锁的完整 artifact-closure 读取入口。 */
export function loadDemandCoreRecordsWithArtifactClosure({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
} = {}) {
  return withStateRootLock(stateRoot, () => (
    loadDemandCoreRecordsWithArtifactClosureWhileLocked({
      stateRoot,
      expectedProgramId,
      ledgerRoot,
    })
  ));
}

/** delivery owner 的持锁提交缝；业务编排必须在调用前完成 transport 准入。 */
export function commitDemandDeliveryTransitionWhileLocked({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
  expectedPrevious,
  event,
  nextState,
} = {}) {
  event = assertDeliveryTransitionOwner(event);
  const programId = normalizeExpectedProgramId(expectedProgramId);
  const expected = normalizeExpectedPrevious(expectedPrevious);
  const loaded = loadDemandCoreRecordsWithArtifactClosureWhileLocked({
    stateRoot,
    expectedProgramId: programId,
    ledgerRoot,
  });
  assertCurrentSnapshot(loaded, expected);
  const transition = buildTransitionRecord({
    loaded,
    expectedPrevious: expected,
    event,
    nextState,
    artifactWrites: [],
    ledgerRoot,
  });
  return commitTransitionRecord({ loaded, transition });
}

/** review owner 的持锁提交缝，只接受 exact reviewDecision event。 */
export function commitDemandReviewDecisionWhileLocked({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
  expectedPrevious,
  event,
  nextState,
} = {}) {
  event = assertReviewDecisionOwner(event);
  const programId = normalizeExpectedProgramId(expectedProgramId);
  const expected = normalizeExpectedPrevious(expectedPrevious);
  const loaded = loadDemandCoreRecordsWithArtifactClosureWhileLocked({
    stateRoot,
    expectedProgramId: programId,
    ledgerRoot,
  });
  assertCurrentSnapshot(loaded, expected);
  const transition = buildTransitionRecord({
    loaded,
    expectedPrevious: expected,
    event,
    nextState,
    artifactWrites: [],
    ledgerRoot,
  });
  return commitTransitionRecord({ loaded, transition });
}

/** lifecycle owner 的持锁提交缝，只负责 complete/cancel 的原子落盘。 */
export function commitDemandLifecycleTransitionWhileLocked({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
  expectedPrevious,
  event,
  nextState,
} = {}) {
  event = assertLifecycleTransitionOwner(event);
  const programId = normalizeExpectedProgramId(expectedProgramId);
  const expected = normalizeExpectedPrevious(expectedPrevious);
  const loaded = loadDemandCoreRecordsWithArtifactClosureWhileLocked({
    stateRoot,
    expectedProgramId: programId,
    ledgerRoot,
  });
  assertCurrentSnapshot(loaded, expected);
  const transition = buildTransitionRecord({
    loaded,
    expectedPrevious: expected,
    event,
    nextState,
    artifactWrites: [],
    ledgerRoot,
  });
  return commitTransitionRecord({ loaded, transition });
}

/** Pod owner 的持锁提交缝；可附带唯一一份 portable Pod Design artifact。 */
export function commitDemandPodTransitionWhileLocked({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
  expectedPrevious,
  event,
  nextState,
  artifact = null,
} = {}) {
  event = assertPodTransitionOwner(event);
  const programId = normalizeExpectedProgramId(expectedProgramId);
  const expected = normalizeExpectedPrevious(expectedPrevious);
  const loaded = loadDemandCoreRecordsWithArtifactClosureWhileLocked({
    stateRoot,
    expectedProgramId: programId,
    ledgerRoot,
  });
  assertCurrentSnapshot(loaded, expected);
  const artifactWrite = artifact === null
    ? null
    : validateDemandArtifactWriteIntent({
      ...demandArtifactIdentity(artifact),
      value: artifact,
    }, { demand: loaded.demand });
  if (artifactWrite !== null) {
    assertCandidateArtifactDestinationAbsent(loaded.paths.stateRoot, artifactWrite);
  }
  const transition = buildTransitionRecord({
    loaded,
    expectedPrevious: expected,
    event,
    nextState,
    artifactWrites: artifactWrite === null ? [] : [artifactWrite],
    ledgerRoot,
  });
  return commitTransitionRecord({ loaded, transition });
}

/** 创建一份 immutable demand artifact，并在同一修订发布 event/state 选择器。 */
export function commitDemandArtifactTransition({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
  expectedPrevious,
  artifact,
  event,
  nextState,
} = {}) {
  event = assertGenericTransitionOwner(event);
  const programId = normalizeExpectedProgramId(expectedProgramId);
  const expected = normalizeExpectedPrevious(expectedPrevious);
  const identity = demandArtifactIdentity(artifact);
  const artifactWrite = validateDemandArtifactWriteIntent({
    ...identity,
    value: artifact,
  });
  return withStateRootLock(stateRoot, () => {
    const loaded = loadDemandCoreRecordsWhileLocked({
      stateRoot,
      expectedProgramId: programId,
      ledgerRoot,
    });
    assertCommittedCandidateArtifactClosure(loaded);
    assertCurrentSnapshot(loaded, expected);
    assertCandidateArtifactDestinationAbsent(loaded.paths.stateRoot, artifactWrite);
    const transition = buildTransitionRecord({
      loaded,
      expectedPrevious: expected,
      event,
      nextState,
      artifactWrites: [artifactWrite],
      ledgerRoot,
    });
    return commitTransitionRecord({ loaded, transition });
  });
}

/** 经 config-aware 持锁准入后，发布一份 managed evidence tree 与状态选择器。 */
export function commitDemandEvidenceTransition({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
  expectedPrevious,
  evidence,
  event,
  nextState,
  admitWhileLocked,
} = {}) {
  event = assertGenericTransitionOwner(event);
  const programId = normalizeExpectedProgramId(expectedProgramId);
  const expected = normalizeExpectedPrevious(expectedPrevious);
  const identity = evidenceIdentity(evidence);
  const evidenceWrite = validateEvidenceWriteIntent({
    ...identity,
    value: evidence,
  });
  if (typeof admitWhileLocked !== "function") {
    throw serviceError(
      "wakeflow-demand-state-evidence-admission",
      "evidence transition requires one config-aware admission callback executed under the state-root lock",
    );
  }
  return withStateRootLock(stateRoot, () => {
    const loaded = loadDemandCoreRecordsWhileLocked({
      stateRoot,
      expectedProgramId: programId,
      ledgerRoot,
    });
    assertCommittedCandidateArtifactClosure(loaded);
    const replayCandidate = loaded.events.some((entry) => entry.eventId === event.eventId);
    const rawAdmission = admitWhileLocked(Object.freeze({
      loaded,
      replayCandidate,
    }));
    const admission = canonicalServiceSnapshot(
      rawAdmission,
      "wakeflow-demand-state-evidence-admission",
      "evidence admission must return canonical plain data",
    );
    if (
      !admission
      || typeof admission !== "object"
      || Array.isArray(admission)
      || Object.keys(admission).length !== 1
      || !Object.hasOwn(admission, "resolvedSourceRoot")
    ) {
      throw serviceError(
        "wakeflow-demand-state-evidence-admission",
        "evidence admission must return only resolvedSourceRoot",
      );
    }
    const replay = assertExactEvidenceReplay({
      loaded,
      expectedPrevious: expected,
      evidence,
      evidenceWrite,
      event,
      nextState,
      ledgerRoot,
    });
    if (replay) return replay;
    const resolvedSourceRoot = admission.resolvedSourceRoot;
    if (
      evidenceWrite.value.source.kind === "managed-path"
      && (typeof resolvedSourceRoot !== "string" || !resolvedSourceRoot.trim())
    ) {
      throw serviceError(
        "wakeflow-demand-state-evidence-source",
        "managed evidence transition requires its exact resolved configured source root",
      );
    }
    if (
      evidenceWrite.value.source.kind !== "managed-path"
      && resolvedSourceRoot !== null
    ) {
      throw serviceError(
        "wakeflow-demand-state-evidence-source",
        "locator-only evidence transition cannot carry a filesystem source root",
      );
    }
    assertCurrentSnapshot(loaded, expected);
    assertCandidateArtifactDestinationAbsent(loaded.paths.stateRoot, evidenceWrite);
    const transition = buildTransitionRecord({
      loaded,
      expectedPrevious: expected,
      event,
      nextState,
      artifactWrites: [evidenceWrite],
      ledgerRoot,
    });
    return commitTransitionRecord({
      loaded,
      transition,
      resolvedEvidenceSourceRoot: resolvedSourceRoot,
    });
  });
}

/** create-once 冻结 demand-authority.json；精确重放只接受原始 event/state intent。 */
export function freezeDemandAuthority({
  stateRoot,
  expectedProgramId,
  ledgerRoot,
  expectedPrevious,
  authority,
  event,
  nextState,
} = {}) {
  event = assertGenericTransitionOwner(event);
  const programId = normalizeExpectedProgramId(expectedProgramId);
  const expected = normalizeExpectedPrevious(expectedPrevious);
  if (typeof ledgerRoot !== "string" || !ledgerRoot.trim()) {
    throw serviceError(
      "wakeflow-demand-state-ledger-required",
      "authority freeze requires the owning ledgerRoot so every T01 member ref is resolved",
    );
  }
  return withStateRootLock(stateRoot, () => {
    const loaded = loadDemandCoreRecordsWhileLocked({
      stateRoot,
      expectedProgramId: programId,
      ledgerRoot,
    });
    assertCommittedCandidateArtifactClosure(loaded);
    const validatedAuthority = validateDemandAuthorityRecord(authority, {
      demand: loaded.demand,
      ledgerRoot,
    });
    const authorityDigest = canonicalJsonDigest(validatedAuthority);
    if (loaded.authority !== null) {
      if (loaded.digests.authority !== authorityDigest) {
        throw serviceError(
          "wakeflow-demand-state-authority-conflict",
          "immutable demand authority already exists with different canonical bytes",
          {
            currentAuthorityDigest: loaded.digests.authority,
            proposedAuthorityDigest: authorityDigest,
          },
        );
      }
      return assertExactAuthorityFreezeReplay({
        loaded,
        expectedPrevious: expected,
        authority: validatedAuthority,
        authorityDigest,
        event,
        nextState,
        ledgerRoot,
      });
    }
    assertCurrentSnapshot(loaded, expected);
    const artifactWrite = {
      artifactKind: "wakeflow-demand-authority",
      ref: WAKEFLOW_DEMAND_AUTHORITY_FILE,
      digest: authorityDigest,
      value: validatedAuthority,
    };
    const transition = buildTransitionRecord({
      loaded,
      expectedPrevious: expected,
      event,
      nextState,
      artifactWrites: [artifactWrite],
      ledgerRoot,
    });
    return commitTransitionRecord({ loaded, transition });
  });
}

// 恢复先按 event discriminator 识别唯一 owner，再验证当前 durable boundary 并只向前完成。
function recoverDemandTransitionWhileLocked({
  stateRoot,
  programId,
  ledgerRoot = null,
  resolveEvidenceSource = null,
  expectedArtifactKind = null,
  admitRecoveryWhileLocked = null,
  owner = "generic",
} = {}) {
  const paths = demandCorePaths(stateRoot);
  let journalStat;
  try {
    journalStat = lstatSync(paths.stateTransition);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const healthy = loadDemandCoreRecordsWithArtifactClosureWhileLocked({
      stateRoot,
      expectedProgramId: programId,
      ledgerRoot,
    });
    return Object.freeze({
      status: "none",
      demandId: healthy.demand.demandId,
      revision: healthy.state.revision,
    });
  }
  if (journalStat.isSymbolicLink() || !journalStat.isFile()) {
    throw serviceError(
      "wakeflow-demand-state-recovery-unsafe",
      "state transition journal must be an exact regular file and cannot be a symlink",
      { file: paths.stateTransition },
    );
  }
  let loaded;
  try {
    loaded = loadDemandCoreRecoveryRecordsWhileLocked({
      stateRoot,
      expectedProgramId: programId,
      ledgerRoot,
    });
  } catch (cause) {
    if (cause?.code === "wakeflow-demand-core-stage-residue") throw cause;
    recoveryConflict(
      "state transition journal or its visible recovery stack is invalid",
      { causeCode: cause?.code ?? null },
      cause,
    );
  }
  const candidateWrite = loaded.journal.artifactWrites.find(
    (entry) => entry.artifactKind !== "wakeflow-demand-authority",
  ) ?? null;
  const journalOwner = isDeliveryOwnedEvent(loaded.journal.nextEvent)
    ? "delivery"
    : isReviewOwnedEvent(loaded.journal.nextEvent)
      ? "review"
      : isPodOwnedEvent(loaded.journal.nextEvent)
        ? "pod"
        : isLifecycleOwnedEvent(loaded.journal.nextEvent)
          ? "lifecycle"
          : isEvidenceWrite(candidateWrite)
            ? "evidence"
            : "generic";
  if (owner !== journalOwner) {
    recoveryConflict(
      `${owner} recovery cannot take ownership of a ${journalOwner} state transition journal`,
    );
  }
  if (
    expectedArtifactKind !== null
    && candidateWrite?.artifactKind !== expectedArtifactKind
  ) {
    recoveryConflict(
      `recovery entrypoint expected ${expectedArtifactKind}, but the pending transition owns ${candidateWrite?.artifactKind ?? "no candidate artifact"}`,
    );
  }
  if (isEvidenceWrite(candidateWrite) && typeof resolveEvidenceSource !== "function") {
    recoveryConflict(
      "managed evidence recovery requires the typed config-aware evidence entrypoint",
    );
  }
  if (isEvidenceWrite(candidateWrite) && typeof admitRecoveryWhileLocked !== "function") {
    recoveryConflict(
      "managed evidence recovery requires config admission inside the state-root lock",
    );
  }
  if (owner === "generic" && admitRecoveryWhileLocked !== null) {
    admitRecoveryWhileLocked(Object.freeze({ loaded, candidateWrite }));
  }
  const position = validateRecoveryPosition(loaded, ledgerRoot);
  if (owner === "evidence") {
    const rawAdmission = admitRecoveryWhileLocked(Object.freeze({
      loaded,
      journal: loaded.journal,
      candidateWrite,
      position,
    }));
    validateExactRecoveryAdmission(rawAdmission, owner);
  }
  if (owner === "delivery" || owner === "review" || owner === "pod" || owner === "lifecycle") {
    const ownerTransition = owner === "delivery"
      ? { deliveryTransition: loaded.journal.nextEvent.deliveryTransition }
      : owner === "review"
        ? { reviewDecision: loaded.journal.nextEvent.reviewDecision }
        : owner === "pod"
          ? { podTransition: loaded.journal.nextEvent.podTransition }
          : { lifecycleTransition: loaded.journal.nextEvent.lifecycleTransition };
    const rawAdmission = admitRecoveryWhileLocked(Object.freeze({
      loaded,
      journal: loaded.journal,
      position,
      ...ownerTransition,
    }));
    validateExactRecoveryAdmission(rawAdmission, owner);
  }
  return replayRecovery({
    loaded,
    position,
    ledgerRoot,
    expectedProgramId: programId,
    resolveEvidenceSource,
  });
}

/** delivery owner 的持锁恢复入口，要求同步回调重验外部 transport authority。 */
export function recoverDemandDeliveryTransitionWhileLocked({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
  admitRecoveryWhileLocked,
} = {}) {
  if (typeof admitRecoveryWhileLocked !== "function") {
    throw serviceError(
      "wakeflow-demand-state-delivery-recovery-admission",
      "delivery recovery requires a synchronous locked admission callback",
    );
  }
  const programId = normalizeExpectedProgramId(expectedProgramId);
  return recoverDemandTransitionWhileLocked({
    stateRoot,
    programId,
    ledgerRoot,
    admitRecoveryWhileLocked,
    owner: "delivery",
  });
}

/** review owner 的持锁恢复入口，要求同步回调重验当前 candidate authority。 */
export function recoverDemandReviewDecisionWhileLocked({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
  admitRecoveryWhileLocked,
} = {}) {
  if (typeof admitRecoveryWhileLocked !== "function") {
    throw serviceError(
      "wakeflow-demand-state-review-recovery-admission",
      "review recovery requires a synchronous locked admission callback",
    );
  }
  const programId = normalizeExpectedProgramId(expectedProgramId);
  return recoverDemandTransitionWhileLocked({
    stateRoot,
    programId,
    ledgerRoot,
    admitRecoveryWhileLocked,
    owner: "review",
  });
}

/** lifecycle owner 的持锁恢复入口，要求同步回调重验 complete/cancel 前置条件。 */
export function recoverDemandLifecycleTransitionWhileLocked({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
  admitRecoveryWhileLocked,
} = {}) {
  if (typeof admitRecoveryWhileLocked !== "function") {
    throw serviceError(
      "wakeflow-demand-state-lifecycle-recovery-admission",
      "lifecycle recovery requires a synchronous locked admission callback",
    );
  }
  const programId = normalizeExpectedProgramId(expectedProgramId);
  return recoverDemandTransitionWhileLocked({
    stateRoot,
    programId,
    ledgerRoot,
    admitRecoveryWhileLocked,
    owner: "lifecycle",
  });
}

/** Pod owner 的持锁恢复入口，要求同步回调重验 local evidence 与 Pod authority。 */
export function recoverDemandPodTransitionWhileLocked({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
  admitRecoveryWhileLocked,
} = {}) {
  if (typeof admitRecoveryWhileLocked !== "function") {
    throw serviceError(
      "wakeflow-demand-state-pod-recovery-admission",
      "Pod recovery requires a synchronous locked admission callback",
    );
  }
  const programId = normalizeExpectedProgramId(expectedProgramId);
  return recoverDemandTransitionWhileLocked({
    stateRoot,
    programId,
    ledgerRoot,
    admitRecoveryWhileLocked,
    owner: "pod",
  });
}

/** public generic/evidence 恢复入口；专用 owner 的 journal 会被明确拒绝。 */
export function recoverDemandStateTransition({
  stateRoot,
  expectedProgramId,
  ledgerRoot = null,
  resolveEvidenceSource = null,
  expectedArtifactKind = null,
  admitRecoveryWhileLocked = null,
} = {}) {
  if (resolveEvidenceSource !== null && typeof resolveEvidenceSource !== "function") {
    throw serviceError(
      "wakeflow-demand-state-recovery-source",
      "resolveEvidenceSource must be a function when provided",
    );
  }
  if (
    expectedArtifactKind !== null
    && expectedArtifactKind !== "wakeflow-evidence"
  ) {
    throw serviceError(
      "wakeflow-demand-state-recovery-artifact-kind",
      "expectedArtifactKind, when provided, must be wakeflow-evidence",
    );
  }
  if (admitRecoveryWhileLocked !== null && typeof admitRecoveryWhileLocked !== "function") {
    throw serviceError(
      "wakeflow-demand-state-recovery-admission",
      "admitRecoveryWhileLocked must be a function when provided",
    );
  }
  const programId = normalizeExpectedProgramId(expectedProgramId);
  return withStateRootLock(stateRoot, () => recoverDemandTransitionWhileLocked({
    stateRoot,
    programId,
    ledgerRoot,
    resolveEvidenceSource,
    expectedArtifactKind,
    admitRecoveryWhileLocked,
    owner: expectedArtifactKind === "wakeflow-evidence" ? "evidence" : "generic",
  }));
}
