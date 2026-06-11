import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  annotateDeliveryRunIdempotency,
  annotateTargetResultIdempotency,
  sameDeliveryRunContent,
  sameTargetResultContent,
} from "./wakeflow-idempotency.mjs";
import { hostProfile } from "./wakeflow-host-profile.mjs";

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
    ensureStateDirs,
    atomicWriteJson,
    appendJsonLine,
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
    artifactTrace,
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

  function lockPathNote(windowName) {
    return path.join(stateDir, "locks", `${slug(windowName)}.json`);
  }

  function markStateRootDeliverySent(envelope, run, { apply = true } = {}) {
    if (envelope.kind !== "DeliveryEnvelope" || run.status !== "sent") {
      return { updated: false, reason: "not-a-sent-target-delivery" };
    }
    const stateRootRef = envelope.stateRef?.stateRoot;
    const targetTaskId = envelope.stateRef?.targetTaskId || envelope.taskId;
    const taskPackageId = envelope.stateRef?.taskPackageId;
    if (!stateRootRef || !targetTaskId || !taskPackageId) {
      return { updated: false, reason: "missing-state-ref" };
    }

    const stateRoot = resolveStateRoot(stateRootRef);
    const stateFile = path.join(stateRoot, "wakeflow-state.json");
    const eventsFile = path.join(stateRoot, "controller-events.jsonl");
    const state = readJson(stateFile, "controller state");
    if (state.controllerHost && state.controllerHost !== hostProfile.runtime.hostDirName) {
      fail(`demand ${state.demandKey} is owned by controller host ${state.controllerHost}; this runtime is ${hostProfile.runtime.hostDirName}. Record this delivery on the owning host.`);
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
    if (!apply) {
      // Validation pass: all envelope-vs-state consistency checks above ran
      // and passed; the caller may now durably record the run file knowing the
      // state advance cannot fail on a mismatch afterwards.
      return { updated: false, reason: "validated" };
    }

    const createdAt = nowIso();
    const nextRevision = Number(state.revision ?? 0) + 1;
    const eventId = eventIdFor(createdAt, nextRevision);
    const nextTargetTasks = (state.targetTasks ?? []).map((item) => item.targetTaskId === targetTaskId
      ? {
          ...item,
          status: "sent",
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

    atomicWriteJson(stateFile, nextState);
    appendJsonLine(eventsFile, event);
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
    const runFile = deliveryRunFileFor(deliveryRunId);
    if (existsSync(runFile)) {
      const existingRun = readJson(runFile, "delivery run");
      if (!sameDeliveryRunContent(existingRun, run)) {
        fail(`Delivery run ${deliveryRunId} already exists with different content; use a new --delivery-run-id for a distinct retry attempt.`);
      }
      const stateUpdate = markStateRootDeliverySent(envelope, existingRun);
      output(
        {
          ok: true,
          command: "record-delivery-run",
          wrote: false,
          duplicate: true,
          idempotentReplay: true,
          status: existingRun.status,
          run: existingRun,
          runFile: path.relative(workspaceRoot, runFile),
          stateUpdate,
        },
        [
          `Delivery run ${deliveryRunId} already recorded; treated as idempotent replay.`,
          `Status: ${existingRun.status}`,
        ],
      );
      return;
    }
    ensureStateDirs();
    // Validate the envelope-state consistency BEFORE the run file exists: a
    // mismatch must fail cleanly instead of leaving a recorded-but-unapplied
    // run that wedges every retry.
    markStateRootDeliverySent(envelope, run, { apply: false });
    atomicWriteJson(runFile, run);
    const stateUpdate = markStateRootDeliverySent(envelope, run);
    let windowLock;
    if (run.status === "sent" && envelope.kind === "DeliveryEnvelope" && envelope.targetWindow) {
      writeWindowLock(envelope.targetWindow, { deliveryId: envelope.deliveryId });
      windowLock = path.relative(workspaceRoot, lockPathNote(envelope.targetWindow));
    }
    output(
      {
        ok: true,
        command: "record-delivery-run",
        wrote: true,
        status,
        run,
        runFile: path.relative(workspaceRoot, runFile),
        stateUpdate,
        windowLock,
      },
      [
        `Recorded direct-thread delivery run ${deliveryRunId}.`,
        `Status: ${status}`,
      ],
    );
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
    if (!dispatchGroup && knownGroups.length === 1) {
      dispatchGroup = knownGroups[0];
    } else if (!dispatchGroup && knownGroups.length > 1) {
      fail(`Multiple dispatch groups exist for ${targetWindow} / ${taskId} (${knownGroups.join(", ")}); pass --group explicitly.`);
    }
    const evidenceRefs = getAllValues("--evidence-ref");
    const verificationSummary = getAllValues("--verification");
    const commits = getAllValues("--commit");
    const supersedeResult = hasFlag("--supersede-result");
    if (status === "completed" && evidenceRefs.length === 0 && verificationSummary.length === 0 && commits.length === 0) {
      fail("completed results require --evidence-ref, --verification, or --commit.");
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
      supersededFile = supersededResultFileFor(targetWindow, taskId, dispatchGroup, reportedAt);
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
    }
    if (write) {
      ensureStateDirs();
      atomicWriteJson(resultFile, result);
    }
    // Release the shared in-flight window lock when it belongs to the delivery
    // this result answers; a lock for a different (newer) delivery survives.
    let lockReleased = false;
    if (write) {
      const lock = readWindowLock(targetWindow);
      if (lock && windowLockFresh(lock)) {
        let belongsHere = !lock.deliveryId;
        if (!belongsHere) {
          const runFile = deliveryRunFileFor(`run-${lock.deliveryId}`);
          if (existsSync(runFile)) {
            try {
              const run = JSON.parse(readFileSync(runFile, "utf8"));
              belongsHere = run.targetWindow === targetWindow
                && (run.targetTaskId === taskId || !run.targetTaskId);
            } catch {
              belongsHere = false;
            }
          }
        }
        if (belongsHere) {
          removeWindowLock(targetWindow);
          lockReleased = true;
        }
      }
    }
    output(
      {
        ok: true,
        command: "record-target-result",
        lockReleased,
        wrote: write,
        superseded: Boolean(supersededFile),
        result,
        resultFile: write ? path.relative(workspaceRoot, resultFile) : "",
        supersededFile: supersededFile && write ? path.relative(workspaceRoot, supersededFile) : undefined,
      },
      [
        `${write ? "Recorded" : "Would record"} result envelope for ${targetWindow} / ${taskId}.`,
        `Status: ${status}`,
      ],
    );
  }

  return {
    commandRecordDeliveryRun,
    commandRecordTargetResult,
  };
}
