import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import {
  annotateDeliveryRunIdempotency,
  annotateTargetResultIdempotency,
  deliveryReadbackStatus,
  deliveryTransportAccepted,
  deliveryTransportStatus,
  dispatchPacketDigest,
  dispatchPreparationDigest,
  sameDeliveryRunContent,
  sameTargetResultContent,
} from "./wakeflow-idempotency.mjs";
import { hostProfile } from "./wakeflow-host-profile.mjs";
import { releaseWindowLockForResult } from "./wakeflow-delivery-store.mjs";
import { PROGRESS_SECTIONS, appendProgressTimeline } from "./wakeflow-progress-appends.mjs";
import {
  controllerEventStateAlignment,
  futureControllerEvents,
  readControllerEventsStrict,
  WakeflowControllerEventLogError,
} from "./wakeflow-controller-events.mjs";
import {
  assertStateAuthorityPaths,
  readPendingStateTransition,
  WakeflowPendingTransitionError,
} from "./wakeflow-state-transition.mjs";
import {
  COMMIT_DISPOSITIONS,
  evaluateTargetResultContract,
  targetResultContractIssueMessage,
} from "./wakeflow-result-contract.mjs";

function eventIdFor(createdAt, revision) {
  return `evt-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${String(revision).padStart(4, "0")}`;
}

export function createResultRecordingCommands(ctx) {
  const {
    workspaceRoot,
    stateDir,
    write,
    hasFlag,
    getValue,
    getAllValues,
    requireValue,
    fail,
    output,
    slug,
    nowIso,
    version,
    deliveryRunVersion,
    readJson,
    readStateRootJson,
    atomicWriteStateRootJson,
    appendStateRootJsonLine,
    ensureStateDirs,
    atomicWriteJson,
    resolveInputPath,
    resolveStateRoot,
    deliveryFileFor,
    findDeliveryFile,
    findPacketFile,
    deliveryRunFileFor,
    findDeliveryRunFile,
    keepLiveStateFile,
    resultFileFor,
    findResultFile,
    supersededResultFileFor,
    lockFileFor,
    readWindowLock,
    windowLockFresh,
    writeWindowLock,
    removeWindowLock,
    dispatchPacketsForTask,
    listDispatchGroupsForTask,
    loadDispatchGroup,
    artifactTrace,
    withFileLock,
    withStateRootLock,
    WakeflowStateLockTimeoutError,
  } = ctx;

  function validateResultStatus(value) {
    const allowed = new Set(["completed", "blocked", "needs-review"]);
    if (!allowed.has(value)) {
      fail(`--status must be one of: ${[...allowed].join(", ")}`);
    }
    return value;
  }

  function validateDeliveryRunStatus(value) {
    const allowed = new Set(["sent", "blocked", "failed"]);
    if (!allowed.has(value)) {
      fail(`--status must be one of: ${[...allowed].join(", ")}`);
    }
    return value;
  }

  function validateDeliveryTransportStatus(value) {
    const allowed = new Set(["accepted", "rejected-before-send", "ambiguous"]);
    if (!allowed.has(value)) {
      fail(`--transport-status must be one of: ${[...allowed].join(", ")}`);
    }
    return value;
  }

  function validateDeliveryReadbackStatus(value) {
    const allowed = new Set(["confirmed", "pending", "unavailable"]);
    if (!allowed.has(value)) {
      fail(`--readback-status must be one of: ${[...allowed].join(", ")}`);
    }
    return value;
  }

  function validateHostMode(value) {
    const allowed = new Set(["new-turn", "unknown"]);
    if (!allowed.has(value)) {
      fail(`--host-mode must be one of: ${[...allowed].join(", ")}`);
    }
    return value;
  }

  function parseBoolean(value, fallback = false) {
    if (value === null || value === undefined || value === "") return fallback;
    if (value === true || value === false) return value;
    const normalized = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
    fail(`Boolean value expected, got: ${value}`);
  }

  function parseCraftEvidence() {
    const raw = getValue("--craft-evidence", "");
    if (!raw) return [];
    let entries;
    try {
      entries = JSON.parse(raw);
    } catch (error) {
      fail(`--craft-evidence must be a JSON array: ${error.message}`);
    }
    if (!Array.isArray(entries)) fail("--craft-evidence must be a JSON array.");
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || typeof entry.kind !== "string" || !entry.kind.trim()) {
        fail("--craft-evidence entries must be objects with a non-empty string kind.");
      }
      const proofFields = ["ref", "value", "commit"];
      for (const field of proofFields) {
        if (entry[field] !== undefined && (typeof entry[field] !== "string" || !entry[field].trim())) {
          fail(`--craft-evidence ${field} must be a non-empty string when provided.`);
        }
      }
      if (!proofFields.some((field) => typeof entry[field] === "string" && entry[field].trim())) {
        fail("--craft-evidence entries must carry reviewable proof in at least one of ref, value, or commit.");
      }
      if (entry.verify !== undefined && (typeof entry.verify !== "string" || !entry.verify.trim())) {
        fail("--craft-evidence verify must be a non-empty string when provided.");
      }
      for (const field of ["anchorId", "red", "green", "step"]) {
        if (entry[field] !== undefined && (typeof entry[field] !== "string" || !entry[field].trim())) {
          fail(`--craft-evidence ${field} must be a non-empty string when provided.`);
        }
      }
      if (entry.planIndex !== undefined && (!Number.isInteger(entry.planIndex) || entry.planIndex < 0)) {
        fail("--craft-evidence planIndex must be a non-negative integer when provided.");
      }
    }
    return entries;
  }

  function lockPathNote(windowName) {
    return lockFileFor(windowName);
  }

  function markStateRootDeliverySent(envelope, run, { apply = true, stateRoot: resolvedStateRoot = null } = {}) {
    if (envelope.kind !== "DeliveryEnvelope") {
      return { updated: false, reason: "not-a-target-delivery" };
    }
    if (envelope.dispatchGroup) {
      const group = loadDispatchGroup(envelope.dispatchGroup, envelope.stateRef);
      if (!group?.membershipFinalized) {
        fail(`delivery ${envelope.deliveryId} belongs to dispatch group ${envelope.dispatchGroup}, whose membership is not finalized.`);
      }
      const envelopeTaskId = envelope.taskId || envelope.stateRef?.targetTaskId;
      const member = (group.expectedTargets ?? []).some((target) => target.targetWindow === envelope.targetWindow
        && target.taskId === envelopeTaskId);
      if (!member) {
        fail(`delivery ${envelope.deliveryId} target ${envelope.targetWindow} / ${envelopeTaskId} is not a finalized member of dispatch group ${envelope.dispatchGroup}.`);
      }
    }
    const stateRootRef = envelope.stateRef?.stateRoot;
    const targetTaskId = envelope.stateRef?.targetTaskId || envelope.taskId;
    const taskPackageId = envelope.stateRef?.taskPackageId;
    if (!stateRootRef || !targetTaskId || !taskPackageId) {
      fail(`target delivery ${envelope.deliveryId} is missing its authoritative state/task/package reference.`);
    }

    const stateRoot = resolvedStateRoot ?? resolveStateRoot(stateRootRef);
    const stateFile = path.join(stateRoot, "wakeflow-state.json");
    const eventsFile = path.join(stateRoot, "controller-events.jsonl");
    try {
      assertStateAuthorityPaths({ stateRoot, stateFile, eventsFile });
    } catch (error) {
      if (error instanceof WakeflowPendingTransitionError) {
        fail(`${error.message}. Refusing to record delivery through a non-canonical state authority path.`);
      }
      throw error;
    }
    const state = readStateRootJson(stateRoot, "wakeflow-state.json", "controller state");
    if (state.controllerHost && state.controllerHost !== hostProfile.runtime.hostDirName) {
      fail(`demand ${state.demandKey} is owned by controller host ${state.controllerHost}; this runtime is ${hostProfile.runtime.hostDirName}. Record this delivery on the owning host.`);
    }
    // Failed/blocked transport records do not advance controller state, but
    // they still belong to this demand and can release a shared window lease.
    // Validate host ownership before allowing either side effect.
    if (run.status !== "sent") {
      return {
        updated: false,
        reason: "non-sent-target-delivery-validated",
        stateRoot: path.relative(workspaceRoot, stateRoot),
      };
    }
    let controllerEvents = [];
    if (apply) {
      try {
        controllerEvents = readControllerEventsStrict(eventsFile);
      } catch (error) {
        if (error instanceof WakeflowControllerEventLogError) {
          fail(
            `${error.message} (${path.relative(workspaceRoot, eventsFile)}). Repair the event log without discarding valid audit entries, then replay the same delivery run ${run.deliveryRunId}; state was not changed.`,
            {
              errorCode: "delivery-event-log-repair-required",
              retryable: true,
              recovery: {
                strategy: "repair-event-log-then-replay",
                stateRoot: path.relative(workspaceRoot, stateRoot),
                eventsFile: path.relative(workspaceRoot, eventsFile),
                stateRevision: state.revision,
                lineNumber: error.lineNumber,
                deliveryRunId: run.deliveryRunId,
              },
            },
          );
        }
        throw error;
      }
      try {
        const pending = readPendingStateTransition(stateRoot);
        if (pending) {
          fail(
            `pending controller transition ${pending.event?.eventId ?? "(unknown)"} must be recovered explicitly before recording delivery run ${run.deliveryRunId}; state was not changed.`,
            {
              errorCode: "state-transition-recovery-required",
              retryable: true,
              recovery: {
                strategy: "run-recover-state-transition",
                stateRoot: path.relative(workspaceRoot, stateRoot),
                eventsFile: path.relative(workspaceRoot, eventsFile),
                stateRevision: state.revision,
                reservedRevision: pending.nextState?.revision,
                eventId: pending.event?.eventId,
                deliveryRunId: run.deliveryRunId,
              },
            },
          );
        }
      } catch (error) {
        if (error instanceof WakeflowPendingTransitionError) {
          fail(
            `${error.message}. Inspect ${path.relative(workspaceRoot, stateRoot)} before recording delivery run ${run.deliveryRunId}; state was not changed.`,
            {
              errorCode: "controller-event-manual-recovery-required",
              retryable: false,
              recovery: {
                strategy: "inspect-state-event-transition-journal",
                stateRoot: path.relative(workspaceRoot, stateRoot),
                eventsFile: path.relative(workspaceRoot, eventsFile),
                stateRevision: state.revision,
                deliveryRunId: run.deliveryRunId,
              },
            },
          );
        }
        throw error;
      }
      const alignment = controllerEventStateAlignment(controllerEvents, state.revision);
      if (alignment.status === "state-ahead") {
        fail(
          `controller state revision ${state.revision} is ahead of event log revision ${alignment.latestEventRevision}; manual recovery is required before recording delivery run ${run.deliveryRunId}. State was not changed.`,
          {
            errorCode: "controller-event-manual-recovery-required",
            retryable: false,
            recovery: {
              strategy: "inspect-state-event-transition-journal",
              stateRoot: path.relative(workspaceRoot, stateRoot),
              eventsFile: path.relative(workspaceRoot, eventsFile),
              stateRevision: state.revision,
              latestEventRevision: alignment.latestEventRevision,
              deliveryRunId: run.deliveryRunId,
            },
          },
        );
      }
    }
    // A closed demand never resurrects to "dispatched": an envelope prepared
    // before cancel/completion may still be sent by a slow host, but recording
    // it must not reopen the flow (cancel stays sticky). Authority is checked
    // first so this history-only path cannot hide a damaged state/event pair.
    if (["completed", "archived", "cancelled"].includes(state.state)) {
      return { updated: false, reason: `demand-${state.state}` };
    }
    const targetTask = (state.targetTasks ?? []).find((item) => item.targetTaskId === targetTaskId);
    if (!targetTask) {
      fail(`delivery run targets unknown state task: ${targetTaskId}`);
    }
    if (envelope.targetWindow && targetTask.targetWindow !== envelope.targetWindow) {
      fail(`delivery run target window mismatch: state has ${targetTask.targetWindow}, envelope has ${envelope.targetWindow}`);
    }
    if (targetTask.taskPackageId !== taskPackageId) {
      fail(`delivery run task package mismatch: state has ${targetTask.taskPackageId}, envelope has ${taskPackageId}`);
    }
    if (!apply) {
      return { updated: false, reason: "validated" };
    }
    if (targetTask.status === "sent") {
      if (targetTask.delivery?.deliveryId && targetTask.delivery.deliveryId !== envelope.deliveryId) {
        fail(`target task ${targetTaskId} was already sent via delivery ${targetTask.delivery.deliveryId}; refusing conflicting delivery ${envelope.deliveryId}.`);
      }
      return {
        updated: false,
        reason: "target-task-already-sent",
        idempotentReplay: true,
        stateRoot: path.relative(workspaceRoot, stateRoot),
        targetTaskId,
        taskPackageId,
        stateRevision: state.revision,
        existingDeliveryRunId: targetTask.delivery?.deliveryRunId,
        replayedDeliveryRunId: run.deliveryRunId,
      };
    }
    if (["accepted", "superseded", "completed", "blocked", "needs-review"].includes(targetTask.status)) {
      return { updated: false, reason: `target-task-already-${targetTask.status}` };
    }
    const nextRevision = Number(state.revision ?? 0) + 1;
    // F41 recovery: controller events reserve their revision because the
    // append happens before the authoritative state snapshot. Only the exact
    // immutable delivery run that created a single R+1 event may consume that
    // reservation. Every other writer fails closed and replays later.
    const exactRunEvent = (event) => event?.type === "delivery.sent"
      && event.wakeflowTrace?.deliveryRunId === run.deliveryRunId
      && event.wakeflowTrace?.deliveryId === envelope.deliveryId
      && event.wakeflowTrace?.targetTaskId === targetTaskId
      && path.resolve(workspaceRoot, event.wakeflowTrace?.stateRoot || "") === stateRoot;
    const reservedEvents = futureControllerEvents(controllerEvents, state.revision);
    const recoverableEvent = reservedEvents.length === 1
      && reservedEvents[0].stateRevision === nextRevision
      && exactRunEvent(reservedEvents[0])
      ? reservedEvents[0]
      : null;
    if (reservedEvents.length > 0 && !recoverableEvent) {
      const firstReserved = reservedEvents[0];
      fail(
        `controller event revision ${firstReserved.stateRevision} is reserved ahead of state revision ${state.revision}; recover or replay delivery run ${firstReserved.wakeflowTrace?.deliveryRunId || "recorded in the event log"} before replaying ${run.deliveryRunId}. State was not changed.`,
        {
          errorCode: "delivery-state-recovery-required",
          retryable: true,
          recovery: {
            strategy: "replay-reserved-delivery-run-first",
            stateRoot: path.relative(workspaceRoot, stateRoot),
            eventsFile: path.relative(workspaceRoot, eventsFile),
            stateRevision: state.revision,
            reservedRevision: firstReserved.stateRevision,
            reservedDeliveryRunId: firstReserved.wakeflowTrace?.deliveryRunId,
            deliveryRunId: run.deliveryRunId,
          },
        },
      );
    }
    const existingDeliveryEvent = recoverableEvent
      ?? controllerEvents.find((event) => exactRunEvent(event));
    if (existingDeliveryEvent && existingDeliveryEvent.stateRevision !== nextRevision) {
      fail(`delivery run ${run.deliveryRunId} has an orphan event at state revision ${existingDeliveryEvent.stateRevision}, but recovery requires revision ${nextRevision}; inspect the state/event audit trail.`);
    }
    const createdAt = existingDeliveryEvent?.createdAt || nowIso();
    const eventId = existingDeliveryEvent?.eventId || eventIdFor(createdAt, nextRevision);
    const nextTargetTasks = (state.targetTasks ?? []).map((item) => item.targetTaskId === targetTaskId
      ? {
          ...item,
          status: "sent",
          // F18: re-dispatch resolves any prior rework decision; clear the stale
          // reviewDecision so a fresh result is mapped from its own status at reduce
          // instead of being stuck as needs-rework.
          reviewDecision: null,
          reviewRoute: item.reviewDecision === "rework" || item.status === "needs-rework"
            ? "rework"
            : item.reviewRoute,
          // RA2: per-task handling count. Sits AFTER the already-sent idempotent-replay
          // early-return above, so a replay of the same delivery never double-counts.
          counts: { ...(item.counts ?? {}), dispatchCount: (item.counts?.dispatchCount ?? 0) + 1 },
          delivery: {
            deliveryId: envelope.deliveryId,
            deliveryFile: path.relative(workspaceRoot, deliveryFileFor(envelope.deliveryId, envelope.stateRef)),
            deliveryRunId: run.deliveryRunId,
            dispatchGroup: envelope.dispatchGroup,
            sentAt: run.createdAt,
            readbackOk: Boolean(run.readback?.ok),
            readbackStatus: deliveryReadbackStatus(run),
            transportStatus: deliveryTransportStatus(run),
          },
        }
      : item);
    const nextTaskPackages = (state.taskPackages ?? []).map((item) => item.taskPackageId === taskPackageId
      ? { ...item, status: ["accepted", "superseded"].includes(item.status) ? item.status : "sent" }
      : item);
    const nextWindows = (state.windows ?? []).map((item) => item.windowName === targetTask.targetWindow
      ? { ...item, windowState: "active" }
      : item);
    const nextState = {
      ...state,
      controllerHost: state.controllerHost ?? hostProfile.runtime.hostDirName,
      state: "dispatched",
      stateReason: `delivery sent: ${targetTaskId}`,
      revision: nextRevision,
      updatedAt: createdAt,
      allowedActions: ["import-target-result", "reduce-results", "wakeflow-render-progress"],
      taskPackages: nextTaskPackages,
      targetTasks: nextTargetTasks,
      windows: nextWindows,
      delivery: {
        ...(state.delivery ?? {}),
        lastDeliveryId: envelope.deliveryId,
        lastDeliveryRunId: run.deliveryRunId,
        lastDispatchGroup: envelope.dispatchGroup,
        lastTargetTaskId: targetTaskId,
        lastStatus: "sent",
        updatedAt: createdAt,
      },
      projection: {
        ...(state.projection ?? {}),
        status: "stale",
      },
    };
    const event = {
      eventId,
      createdAt,
      actor: "delivery-runtime",
      type: "delivery.sent",
      from: state.state,
      to: "dispatched",
      reason: `delivery run recorded as sent: ${run.deliveryRunId}`,
      evidenceRefs: [path.relative(workspaceRoot, deliveryRunFileFor(run.deliveryRunId, envelope.stateRef))],
      allowedWrites: [
        "wakeflow-state.json",
        "controller-events.jsonl",
      ],
      forbiddenConclusions: [
        "delivery-sent-is-target-result",
        "delivery-sent-is-controller-acceptance",
        "delivery-sent-starts-polling",
      ],
      stateRevision: nextRevision,
      wakeflowTrace: artifactTrace({
        artifactKind: "controller-event",
        createdAt,
        deliveryFile: path.relative(workspaceRoot, deliveryFileFor(envelope.deliveryId, envelope.stateRef)),
        deliveryId: envelope.deliveryId,
        deliveryRunId: run.deliveryRunId,
        dispatchGroup: envelope.dispatchGroup,
        stateRef: envelope.stateRef,
        stateRevision: nextRevision,
        targetTaskId,
        targetWindow: targetTask.targetWindow,
      }),
    };

    // F41: publish the event first and state.json (the authoritative snapshot)
    // last. A crash can reserve one event revision, which replaying this exact
    // immutable delivery run completes; it cannot create a revision-without-event
    // audit gap.
    try {
      if (!existingDeliveryEvent) {
        appendStateRootJsonLine(
          stateRoot,
          "controller-events.jsonl",
          event,
          "controller event log",
        );
      }
      atomicWriteStateRootJson(
        stateRoot,
        "wakeflow-state.json",
        nextState,
        "controller state",
      );
    } catch (error) {
      fail(
        `delivery run ${run.deliveryRunId} is persisted, but its controller state transition did not finish: ${error.message}`,
        {
          errorCode: "delivery-state-recovery-required",
          retryable: true,
          recovery: {
            strategy: "replay-delivery-run",
            stateRoot: path.relative(workspaceRoot, stateRoot),
            eventsFile: path.relative(workspaceRoot, eventsFile),
            stateRevision: state.revision,
            reservedRevision: nextRevision,
            reservedDeliveryRunId: run.deliveryRunId,
            deliveryRunId: run.deliveryRunId,
          },
        },
      );
    }
    appendProgressTimeline(stateRoot, nextState, PROGRESS_SECTIONS.decisions,
      `${createdAt} dispatched ${targetTaskId} → ${targetTask.targetWindow} (delivery ${envelope.deliveryId})`);
    return {
      updated: true,
      stateRoot: path.relative(workspaceRoot, stateRoot),
      targetTaskId,
      taskPackageId,
      stateRevision: nextRevision,
      eventId,
      projectionStatus: "stale",
    };
  }

  function commandRecordDeliveryRun() {
    if (!write) fail("record-delivery-run requires --write.");
    const deliveryFile = resolveInputPath(requireValue("--delivery-file"), "--delivery-file");
    const envelope = readJson(deliveryFile, "delivery envelope");
    if (!["DeliveryEnvelope", "ControllerReturnEnvelope"].includes(envelope.kind)) {
      fail("Delivery file must contain a DeliveryEnvelope or ControllerReturnEnvelope.");
    }
    if (typeof envelope.deliveryId !== "string" || !envelope.deliveryId.trim()) {
      fail("Delivery envelope is missing deliveryId.");
    }
    const canonicalDeliveryFile = findDeliveryFile(envelope.deliveryId, envelope.stateRef);
    if (!existsSync(canonicalDeliveryFile)) {
      fail(`canonical delivery envelope does not exist for ${envelope.deliveryId}: ${path.relative(workspaceRoot, canonicalDeliveryFile)}`);
    }
    if (lstatSync(deliveryFile).isSymbolicLink() || lstatSync(canonicalDeliveryFile).isSymbolicLink()) {
      fail("record-delivery-run requires a canonical regular delivery envelope, not a symlink.");
    }
    if (
      path.resolve(deliveryFile) !== path.resolve(canonicalDeliveryFile)
      || realpathSync(deliveryFile) !== realpathSync(canonicalDeliveryFile)
    ) {
      fail(`--delivery-file must be the canonical envelope for ${envelope.deliveryId}: ${path.relative(workspaceRoot, canonicalDeliveryFile)}`);
    }
    if (envelope.kind === "DeliveryEnvelope") {
      if (!envelope.sourcePacketId || !envelope.sourcePacketDigest || !envelope.preparationDigest) {
        fail(`Delivery envelope ${envelope.deliveryId} is missing its packet/preparation digest chain.`);
      }
      const sourcePacketFile = findPacketFile(envelope.sourcePacketId, envelope.stateRef);
      if (!existsSync(sourcePacketFile)) {
        fail(`canonical dispatch packet does not exist for ${envelope.sourcePacketId}: ${path.relative(workspaceRoot, sourcePacketFile)}`);
      }
      const sourcePacket = readJson(sourcePacketFile, "canonical dispatch packet");
      const computedPacketDigest = dispatchPacketDigest(sourcePacket);
      if (
        sourcePacket.packetDigest !== computedPacketDigest
        || envelope.sourcePacketDigest !== computedPacketDigest
      ) {
        fail(`Delivery envelope ${envelope.deliveryId} does not match canonical packet ${envelope.sourcePacketId}.`);
      }
      if (dispatchPreparationDigest({ packet: sourcePacket, envelope }) !== envelope.preparationDigest) {
        fail(`Delivery envelope ${envelope.deliveryId} preparation digest does not match its canonical packet, thread binding, and transport configuration.`);
      }
    }
    const status = validateDeliveryRunStatus(requireValue("--status"));
    const readbackOkInput = getValue("--readback-ok", "");
    const explicitReadbackStatus = getValue("--readback-status", "");
    const transportStatusInput = getValue("--transport-status", "");
    const transportStatus = validateDeliveryTransportStatus(
      transportStatusInput || (status === "sent" ? "accepted" : "ambiguous"),
    );
    const readbackStatus = validateDeliveryReadbackStatus(
      explicitReadbackStatus
        || (readbackOkInput !== ""
          ? (parseBoolean(readbackOkInput) ? "confirmed" : "pending")
          : status === "sent" && !transportStatusInput ? "confirmed" : "unavailable"),
    );
    const readbackOk = readbackStatus === "confirmed";
    if (readbackOkInput !== "" && parseBoolean(readbackOkInput) !== readbackOk) {
      fail("--readback-ok conflicts with --readback-status.");
    }
    const readbackAttemptsRaw = getValue("--readback-attempts", "");
    const readbackAttempts = readbackAttemptsRaw === "" ? null : Number(readbackAttemptsRaw);
    if (readbackAttempts !== null && (!Number.isInteger(readbackAttempts) || readbackAttempts < 0)) {
      fail("--readback-attempts must be a non-negative integer.");
    }
    const evidence = getValue("--evidence", "");
    const error = getValue("--error", "");
    if (status === "sent" && transportStatus !== "accepted") {
      fail("sent delivery runs require --transport-status accepted.");
    }
    if (status !== "sent" && transportStatus === "accepted") {
      fail("accepted host transport must be recorded with --status sent so the same prompt is not resent.");
    }
    if (transportStatus === "rejected-before-send" && readbackStatus !== "unavailable") {
      fail("rejected-before-send delivery runs require --readback-status unavailable.");
    }
    if (status === "sent" && !evidence.trim()) {
      fail("sent delivery runs require --evidence describing host acceptance and the readback observation.");
    }
    if (status !== "sent" && !error.trim()) {
      fail("blocked/failed delivery runs require --error.");
    }
    const deliveryRunId = getValue("--delivery-run-id", `run-${envelope.deliveryId}`);
    const keepLiveState = envelope.automation?.keepLive ? path.relative(stateDir, keepLiveStateFile()) : null;
    const deliveryWindow = envelope.targetWindow || envelope.targetThread?.windowName || envelope.controllerWindow;
    const createdAt = nowIso();
    const observedWindowLease = envelope.kind === "DeliveryEnvelope" && envelope.targetWindow
      ? readWindowLock(envelope.targetWindow)
      : null;
    const windowLease = observedWindowLease?.deliveryId === envelope.deliveryId
      && typeof observedWindowLease.leaseId === "string"
      && observedWindowLease.leaseId
      ? {
          leaseId: observedWindowLease.leaseId,
          deliveryId: observedWindowLease.deliveryId,
        }
      : null;
    const run = annotateDeliveryRunIdempotency({
      kind: "DirectThreadDeliveryRun",
      version: deliveryRunVersion,
      deliveryRunId,
      deliveryId: envelope.deliveryId,
      targetWindow: deliveryWindow,
      taskId: envelope.taskId || envelope.triggerTaskId,
      dispatchGroup: envelope.dispatchGroup,
      triggerTarget: envelope.triggerTarget,
      triggerTaskId: envelope.triggerTaskId,
      reviewScope: envelope.reviewScope,
      transport: "direct-thread",
      transportStatus,
      status,
      ...(windowLease ? { windowLease } : {}),
      thread: {
        windowName: deliveryWindow,
        threadIdRedacted: true,
        threadRegistryFile: envelope.transport?.threadRegistryFile || envelope.targetThread?.threadRegistryFile,
      },
      hostAction: {
        method: getValue("--host-method", hostProfile.hostTools.sendToWindow),
        mode: validateHostMode(getValue("--host-mode", "unknown")),
      },
      readback: {
        checked: readbackStatus !== "unavailable",
        ok: readbackOk,
        status: readbackStatus,
        ...(readbackAttempts !== null ? { attempts: readbackAttempts } : {}),
        evidence: evidence || undefined,
      },
      keepLive: {
        enabledForRun: Boolean(envelope.automation?.keepLive),
        stateFile: keepLiveState,
      },
      error: error || undefined,
      wakeflowTrace: artifactTrace({
        artifactKind: "delivery-run",
        createdAt,
        deliveryFile: path.relative(workspaceRoot, deliveryFile),
        deliveryId: envelope.deliveryId,
        deliveryRunId,
        dispatchGroup: envelope.dispatchGroup,
        stateRef: envelope.stateRef,
        targetTaskId: envelope.taskId || envelope.triggerTaskId,
        targetWindow: deliveryWindow,
      }),
      createdAt,
    });
    function matchingTargetResultExists() {
      if (envelope.kind !== "DeliveryEnvelope" || !envelope.targetWindow) return false;
      const resultFile = findResultFile(
        envelope.targetWindow,
        envelope.taskId || envelope.stateRef?.targetTaskId,
        envelope.dispatchGroup,
        envelope.stateRef,
      );
      return existsSync(resultFile);
    }

    function refreshSentWindowLock(runStatus, stateUpdate) {
      // The prepare-time lock may have expired before a crashed record was
      // replayed. Refresh only while the delivery is still in flight: a
      // matching result or terminal/reviewed task has already released the
      // lease and an old run replay must never recreate it.
      const activeState = stateUpdate?.updated === true
        || stateUpdate?.reason === "target-task-already-sent";
      if (
        deliveryTransportAccepted(runStatus)
        && envelope.kind === "DeliveryEnvelope"
        && envelope.targetWindow
        && activeState
        && !matchingTargetResultExists()
      ) {
        writeWindowLock(envelope.targetWindow, { deliveryId: envelope.deliveryId });
        return path.relative(workspaceRoot, lockPathNote(envelope.targetWindow));
      }
      return undefined;
    }

    function releaseRejectedWindowLock(runStatus) {
      if (
        envelope.kind !== "DeliveryEnvelope"
        || !envelope.targetWindow
        || deliveryTransportStatus(runStatus) !== "rejected-before-send"
        || !runStatus.windowLease?.leaseId
      ) {
        return false;
      }
      return releaseWindowLockForResult(
        lockFileFor(envelope.targetWindow),
        (lock) => lock.deliveryId === envelope.deliveryId
          && lock.leaseId === runStatus.windowLease.leaseId,
      );
    }

    const runFile = findDeliveryRunFile(deliveryRunId, envelope.stateRef);
    const recordTransaction = (lockedStateRoot = null) => {
      // The host may have supplied the path before waiting on run/state locks.
      // Re-read the canonical artifact inside the critical section so a
      // workspace-local copy or a file swap cannot advance state.
      const lockedEnvelope = readJson(canonicalDeliveryFile, "canonical delivery envelope");
      if (JSON.stringify(lockedEnvelope) !== JSON.stringify(envelope)) {
        fail(`canonical delivery envelope ${envelope.deliveryId} changed before recording; prepare and send the current envelope again.`);
      }
      if (existsSync(runFile)) {
        const existingRun = readJson(runFile, "delivery run");
        const existingStateRootRef = existingRun.wakeflowTrace?.stateRoot;
        if (
          lockedStateRoot
          && existingStateRootRef
          && path.resolve(workspaceRoot, existingStateRootRef) !== lockedStateRoot
        ) {
          fail(`Delivery run ${deliveryRunId} already belongs to a different state root; use a globally unique --delivery-run-id.`);
        }
        if (!sameDeliveryRunContent(existingRun, run)) {
          fail(`Delivery run ${deliveryRunId} already exists with different content; use a new --delivery-run-id for a distinct retry attempt.`);
        }
        // Recovery replay is intentional: a crash may have persisted the run
        // before the state snapshot. Replaying the same run while holding the
        // state-root lock completes that missing state/event update exactly once.
        const stateUpdate = markStateRootDeliverySent(envelope, existingRun, { stateRoot: lockedStateRoot });
        const windowLock = refreshSentWindowLock(existingRun, stateUpdate);
        const windowLockReleased = releaseRejectedWindowLock(existingRun);
        output(
          {
            ok: true,
            command: "record-delivery-run",
            wrote: false,
            duplicate: true,
            idempotentReplay: true,
            status: existingRun.status,
            transportStatus: deliveryTransportStatus(existingRun),
            readbackStatus: deliveryReadbackStatus(existingRun),
            readbackAttempts: existingRun.readback?.attempts,
            ...(hasFlag("--compact")
              ? { compact: true, deliveryRunId: existingRun.deliveryRunId, deliveryId: existingRun.deliveryId, targetWindow: existingRun.targetWindow }
              : { run: existingRun }),
            runFile: path.relative(workspaceRoot, runFile),
            stateUpdate,
            windowLock,
            windowLockReleased,
          },
          [
            `Delivery run ${deliveryRunId} already recorded; treated as idempotent replay.`,
            `Status: ${existingRun.status}`,
          ],
        );
        return;
      }
      ensureStateDirs();
      // Validation, run persistence, and the authoritative state/event update
      // are one state-root critical section for target deliveries. This keeps
      // parallel window sends from reading the same revision and dropping one
      // another's updates.
      markStateRootDeliverySent(envelope, run, { apply: false, stateRoot: lockedStateRoot });
      atomicWriteJson(runFile, run);
      const stateUpdate = markStateRootDeliverySent(envelope, run, { stateRoot: lockedStateRoot });
      const windowLock = refreshSentWindowLock(run, stateUpdate);
      const windowLockReleased = releaseRejectedWindowLock(run);
      output(
        {
          ok: true,
          command: "record-delivery-run",
          wrote: true,
          status,
          transportStatus,
          readbackStatus,
          readbackAttempts: readbackAttempts ?? undefined,
          // --compact: the run record is on disk at runFile; echoing it back was
          // pure context burn
          ...(hasFlag("--compact")
            ? { compact: true, deliveryRunId: run.deliveryRunId, deliveryId: run.deliveryId, targetWindow: run.targetWindow }
            : { run }),
          runFile: path.relative(workspaceRoot, runFile),
          stateUpdate,
          windowLock,
          windowLockReleased,
        },
        [
          `Recorded direct-thread delivery run ${deliveryRunId}.`,
          `Status: ${status}`,
        ],
      );
    };

    ensureStateDirs();
    // Delivery-run ids share one workspace-wide namespace. Serialize that
    // immutable record before taking a target's state lock so two independent
    // demands cannot concurrently claim the same explicit run id.
    const runLockFile = `${runFile}.record-lock`;
    try {
      withFileLock(runLockFile, () => {
        if (envelope.kind !== "DeliveryEnvelope") {
          // Controller-return is transport-only and has no target-task state
          // mutation, so it must not acquire an unrelated demand state lock.
          recordTransaction();
          return;
        }
        const stateRootRef = envelope.stateRef?.stateRoot;
        if (!stateRootRef) {
          fail(`Delivery envelope ${envelope.deliveryId} is missing stateRef.stateRoot; cannot record a target delivery without its canonical state root.`);
        }
        const stateRoot = resolveStateRoot(stateRootRef);
        withStateRootLock(stateRoot, () => recordTransaction(stateRoot), {
          onWarn: (message) => process.stderr.write(`wakeflow-delivery: ${message}\n`),
        });
      }, {
        onWarn: (message) => process.stderr.write(`wakeflow-delivery: ${message}\n`),
      });
    } catch (error) {
      if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
      throw error;
    }
  }

  function commandRecordTargetResult() {
    const targetWindow = requireValue("--target-window");
    const taskId = requireValue("--task-id");
    const status = validateResultStatus(requireValue("--status"));
    let dispatchGroup = getValue("--group", "");
    // The result filename is keyed by dispatch group; a wrong or missing group
    // makes review-results report this target as missing even though the
    // result exists. Resolve/validate against the known dispatch packets.
    const knownGroups = listDispatchGroupsForTask(targetWindow, taskId);
    if (dispatchGroup && knownGroups.length > 0 && !knownGroups.includes(dispatchGroup)) {
      fail(`--group ${dispatchGroup} does not match any dispatch packet for ${targetWindow} / ${taskId}; known groups: ${knownGroups.join(", ")}.`);
    }
    if (!dispatchGroup && knownGroups.length > 0) {
      fail(`--group is required for ${targetWindow} / ${taskId}; known dispatch groups: ${knownGroups.join(", ")}.`);
    }
    const matchingPackets = dispatchPacketsForTask(targetWindow, taskId, dispatchGroup);
    const matchingStateRoots = new Set(matchingPackets.map((packet) => packet.stateRef?.stateRoot).filter(Boolean));
    if (matchingStateRoots.size > 1) {
      fail(`Target ${targetWindow} / ${taskId}${dispatchGroup ? ` in group ${dispatchGroup}` : ""} exists in multiple demands; use the state-root target result API so the result cannot be attached to the wrong demand.`);
    }
    const resultStateRef = matchingPackets[0]?.stateRef || null;
    const evidenceRefs = getAllValues("--evidence-ref");
    const verificationSummary = getAllValues("--verification");
    const commits = getAllValues("--commit");
    const craftEvidence = parseCraftEvidence();
    const summary = (getValue("--summary", "") || "").trim();
    const commitDisposition = (getValue("--commit-disposition", "") || "").trim();
    if (commitDisposition && !COMMIT_DISPOSITIONS.includes(commitDisposition)) {
      fail(`--commit-disposition must be one of: ${COMMIT_DISPOSITIONS.join(", ")}.`);
    }
    const supersedeResult = hasFlag("--supersede-result");
    if (status === "completed" && evidenceRefs.length === 0 && verificationSummary.length === 0 && commits.length === 0 && craftEvidence.length === 0) {
      fail("completed results require --evidence-ref, --verification, --commit, or --craft-evidence.");
    }
    const changedRepos = getAllValues("--changed-repo");
    const resultContract = evaluateTargetResultContract({
      packet: matchingPackets[0] ?? null,
      result: {
        status,
        summary,
        changedRepos,
        commits,
        commitDisposition: commitDisposition || undefined,
        evidenceRefs,
        verificationSummary,
        craftEvidence,
      },
    });
    if (resultContract.recordIssues.length > 0) {
      fail(`target result does not satisfy ${resultContract.contract}: ${targetResultContractIssueMessage(resultContract.recordIssues)}.`);
    }

    const reportedAt = nowIso();
    const resultId = `target-result-${slug(targetWindow)}__${slug(taskId)}${dispatchGroup ? `__${slug(dispatchGroup)}` : ""}`;
    const result = annotateTargetResultIdempotency({
      kind: "TargetResultEnvelope",
      version,
      resultId,
      targetWindow,
      taskId,
      dispatchGroup: dispatchGroup || undefined,
      stateRef: resultStateRef || undefined,
      status,
      summary,
      changedRepos,
      commits,
      ...(commitDisposition ? { commitDisposition } : {}),
      evidenceRefs,
      verificationSummary,
      riskSummary: getAllValues("--risk"),
      ...(craftEvidence.length ? { craftEvidence } : {}),
      resultMapping: resultContract.mapping,
      nextSuggestion: getValue("--next-suggestion", "") || undefined,
      wakeflowTrace: artifactTrace({
        artifactKind: "target-result",
        createdAt: reportedAt,
        dispatchGroup: dispatchGroup || undefined,
        resultId,
        targetTaskId: taskId,
        targetWindow,
      }),
      reportedAt,
    });

    const resultFile = findResultFile(targetWindow, taskId, dispatchGroup, resultStateRef);
    const recordTransaction = () => {
      let supersededFile = "";
      if (existsSync(resultFile)) {
        const existingResult = readJson(resultFile, "target result");
        if (sameTargetResultContent(existingResult, result)) {
          output(
            {
              ok: true,
              command: "record-target-result",
              wrote: false,
              duplicate: true,
              idempotentReplay: true,
              result: existingResult,
              resultFile: path.relative(workspaceRoot, resultFile),
            },
            [
              `Target result for ${targetWindow} / ${taskId} already recorded; treated as idempotent replay.`,
              `Status: ${existingResult.status}`,
            ],
          );
          return;
        }
        if (!supersedeResult) {
          fail(`Target result already exists for ${targetWindow} / ${taskId}${dispatchGroup ? ` in group ${dispatchGroup}` : ""}; use --supersede-result to replace it explicitly.`);
        }
        const archivedRevision = Number(existingResult.resultRevision ?? 1);
        supersededFile = supersededResultFileFor(
          targetWindow,
          taskId,
          dispatchGroup,
          reportedAt,
          archivedRevision,
        );
        result.resultRevision = archivedRevision + 1;
        result.supersedes = {
          resultFile: path.relative(workspaceRoot, resultFile),
          archivedResultFile: path.relative(workspaceRoot, supersededFile),
          resultId: existingResult.resultId,
          status: existingResult.status,
          reportedAt: existingResult.reportedAt,
          supersededAt: reportedAt,
        };
        if (write) {
          atomicWriteJson(supersededFile, {
            ...existingResult,
            supersededBy: {
              resultId: result.resultId,
              resultFile: path.relative(workspaceRoot, resultFile),
              supersededAt: reportedAt,
            },
          });
        }
      } else {
        result.resultRevision = 1;
      }
      if (write) {
        atomicWriteJson(resultFile, result);
      }
      // Release the shared in-flight window lock when it belongs to the delivery
      // this result answers; a lock for a different (newer) delivery survives.
      // Release through the shared releaseWindowLockForResult authority (same contract as the
      // state script). The belongsHere predicate keeps the run-scan that handles custom
      // --delivery-run-id retries; freshness is no longer a gate (unified release policy).
      let lockReleased = false;
      if (write) {
        const lockFile = lockFileFor(targetWindow);
        const belongsHere = (lock) => {
          if (!lock.deliveryId) return true;
          const matchRun = (run) => {
            if (!run || run.deliveryId !== lock.deliveryId) return false;
            const runTaskId = run.taskId || run.targetTaskId;
            return run.targetWindow === targetWindow && (!runTaskId || runTaskId === taskId);
          };
          const guessedFile = findDeliveryRunFile(`run-${lock.deliveryId}`);
          if (existsSync(guessedFile)) {
            try {
              if (matchRun(JSON.parse(readFileSync(guessedFile, "utf8")))) return true;
            } catch {
              // fall through to the directory scan
            }
          }
          // custom --delivery-run-id retries do not follow the run-<deliveryId> naming;
          // scan the runs directory for the matching delivery id.
          const runsDir = path.dirname(guessedFile);
          if (existsSync(runsDir)) {
            for (const name of readdirSync(runsDir)) {
              if (!name.endsWith(".json")) continue;
              try {
                if (matchRun(JSON.parse(readFileSync(path.join(runsDir, name), "utf8")))) return true;
              } catch {
                // skip unreadable run files
              }
            }
          }
          return false;
        };
        lockReleased = releaseWindowLockForResult(lockFile, belongsHere);
      }
      output(
        {
          ok: true,
          command: "record-target-result",
          lockReleased,
          wrote: write,
          superseded: Boolean(supersededFile),
          // --compact: the envelope is on disk at resultFile
          ...(hasFlag("--compact")
            ? { compact: true, resultId: result.resultId, status: result.status, dispatchGroup: result.dispatchGroup, targetWindow: result.targetWindow, taskId: result.taskId }
            : { result }),
          resultFile: write ? path.relative(workspaceRoot, resultFile) : "",
          supersededFile: supersededFile && write ? path.relative(workspaceRoot, supersededFile) : undefined,
        },
        [
          `${write ? "Recorded" : "Would record"} result envelope for ${targetWindow} / ${taskId}.`,
          `Status: ${status}`,
        ],
      );
    };

    if (!write) {
      recordTransaction();
      return;
    }

    ensureStateDirs();
    try {
      withFileLock(`${resultFile}.record-lock`, recordTransaction, {
        onWarn: (message) => process.stderr.write(`wakeflow-delivery: ${message}\n`),
      });
    } catch (error) {
      if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
      throw error;
    }
  }

  return {
    commandRecordDeliveryRun,
    commandRecordTargetResult,
  };
}
