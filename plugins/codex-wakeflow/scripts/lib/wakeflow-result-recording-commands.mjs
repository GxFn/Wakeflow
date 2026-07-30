import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  annotateDeliveryRunIdempotency,
  annotateTargetResultIdempotency,
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
    deliveryRunFileFor,
    keepLiveStateFile,
    resultFileFor,
    supersededResultFileFor,
    readWindowLock,
    windowLockFresh,
    writeWindowLock,
    removeWindowLock,
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
    }
    return entries;
  }

  function lockPathNote(windowName) {
    return path.join(stateDir, "locks", `${slug(windowName)}.json`);
  }

  function markStateRootDeliverySent(envelope, run, { apply = true, stateRoot: resolvedStateRoot = null } = {}) {
    if (envelope.kind !== "DeliveryEnvelope" || run.status !== "sent") {
      return { updated: false, reason: "not-a-sent-target-delivery" };
    }
    if (envelope.dispatchGroup) {
      const group = loadDispatchGroup(envelope.dispatchGroup);
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
      return { updated: false, reason: "missing-state-ref" };
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
    if (["accepted", "completed", "blocked", "needs-review"].includes(targetTask.status)) {
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
            deliveryFile: path.relative(workspaceRoot, deliveryFileFor(envelope.deliveryId)),
            deliveryRunId: run.deliveryRunId,
            dispatchGroup: envelope.dispatchGroup,
            sentAt: run.createdAt,
            readbackOk: Boolean(run.readback?.ok),
          },
        }
      : item);
    const nextTaskPackages = (state.taskPackages ?? []).map((item) => item.taskPackageId === taskPackageId
      ? { ...item, status: item.status === "accepted" ? item.status : "sent" }
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
      evidenceRefs: [path.relative(workspaceRoot, deliveryRunFileFor(run.deliveryRunId))],
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
        deliveryFile: path.relative(workspaceRoot, deliveryFileFor(envelope.deliveryId)),
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
    const status = validateDeliveryRunStatus(requireValue("--status"));
    const readbackOk = parseBoolean(getValue("--readback-ok", ""), status === "sent");
    const evidence = getValue("--evidence", "");
    const error = getValue("--error", "");
    if (status === "sent" && (!readbackOk || !evidence.trim())) {
      fail("sent delivery runs require --readback-ok true and --evidence.");
    }
    if (status !== "sent" && !error.trim()) {
      fail("blocked/failed delivery runs require --error.");
    }
    const deliveryRunId = getValue("--delivery-run-id", `run-${envelope.deliveryId}`);
    const keepLiveState = envelope.automation?.keepLive ? path.relative(stateDir, keepLiveStateFile()) : null;
    const deliveryWindow = envelope.targetWindow || envelope.targetThread?.windowName || envelope.controllerWindow;
    const createdAt = nowIso();
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
      status,
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
        checked: status === "sent" || getValue("--readback-ok", "") !== "",
        ok: readbackOk,
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
    function refreshSentWindowLock(runStatus) {
      // The prepare-time lock may have expired before a crashed record was
      // replayed; (re)write it on every sent record so the in-flight delivery
      // is never unlocked.
      if (runStatus === "sent" && envelope.kind === "DeliveryEnvelope" && envelope.targetWindow) {
        writeWindowLock(envelope.targetWindow, { deliveryId: envelope.deliveryId });
        return path.relative(workspaceRoot, lockPathNote(envelope.targetWindow));
      }
      return undefined;
    }

    const runFile = deliveryRunFileFor(deliveryRunId);
    const recordTransaction = (lockedStateRoot = null) => {
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
        const windowLock = refreshSentWindowLock(existingRun.status);
        output(
          {
            ok: true,
            command: "record-delivery-run",
            wrote: false,
            duplicate: true,
            idempotentReplay: true,
            status: existingRun.status,
            ...(hasFlag("--compact")
              ? { compact: true, deliveryRunId: existingRun.deliveryRunId, deliveryId: existingRun.deliveryId, targetWindow: existingRun.targetWindow }
              : { run: existingRun }),
            runFile: path.relative(workspaceRoot, runFile),
            stateUpdate,
            windowLock,
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
      const windowLock = refreshSentWindowLock(run.status);
      output(
        {
          ok: true,
          command: "record-delivery-run",
          wrote: true,
          status,
          // --compact: the run record is on disk at runFile; echoing it back was
          // pure context burn
          ...(hasFlag("--compact")
            ? { compact: true, deliveryRunId: run.deliveryRunId, deliveryId: run.deliveryId, targetWindow: run.targetWindow }
            : { run }),
          runFile: path.relative(workspaceRoot, runFile),
          stateUpdate,
          windowLock,
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
    const evidenceRefs = getAllValues("--evidence-ref");
    const verificationSummary = getAllValues("--verification");
    const commits = getAllValues("--commit");
    const craftEvidence = parseCraftEvidence();
    const supersedeResult = hasFlag("--supersede-result");
    if (status === "completed" && evidenceRefs.length === 0 && verificationSummary.length === 0 && commits.length === 0 && craftEvidence.length === 0) {
      fail("completed results require --evidence-ref, --verification, --commit, or --craft-evidence.");
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
      status,
      changedRepos: getAllValues("--changed-repo"),
      commits,
      evidenceRefs,
      verificationSummary,
      riskSummary: getAllValues("--risk"),
      ...(craftEvidence.length ? { craftEvidence } : {}),
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

    const resultFile = resultFileFor(targetWindow, taskId, dispatchGroup);
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
        const lockFile = path.join(stateDir, "locks", `${slug(targetWindow)}.json`);
        const belongsHere = (lock) => {
          if (!lock.deliveryId) return true;
          const matchRun = (run) => {
            if (!run || run.deliveryId !== lock.deliveryId) return false;
            const runTaskId = run.taskId || run.targetTaskId;
            return run.targetWindow === targetWindow && (!runTaskId || runTaskId === taskId);
          };
          const guessedFile = deliveryRunFileFor(`run-${lock.deliveryId}`);
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
