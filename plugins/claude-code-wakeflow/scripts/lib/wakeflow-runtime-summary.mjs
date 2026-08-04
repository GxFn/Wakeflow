import { buildHostSendResumeSteps } from "./wakeflow-host-send-adapter.mjs";

export function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

export function deriveRuntimeGroupStatus(counts) {
  const ready = (counts.completed || 0) + (counts["needs-review"] || 0);
  const blocked = counts.blocked || 0;
  const missing = counts.missing || 0;
  const pendingHostSend = counts["pending-host-send"] || 0;
  const pendingDispatch = counts["pending-dispatch"] || 0;
  if (pendingHostSend > 0) return "pending-host-send";
  if (missing > 0) return ready > 0 || blocked > 0 ? "partially-ready" : "waiting";
  if (ready > 0 || blocked > 0) return pendingDispatch > 0 ? "partially-ready" : blocked > 0 ? "blocked" : "ready";
  if (pendingDispatch > 0) return "pending-dispatch";
  return "waiting";
}

function currentControllerReturnDeliveries(groupSummaries, status) {
  return groupSummaries.flatMap((group) => (group.callbackPlan?.units || [])
    .filter((unit) => unit.status === status)
    .flatMap((unit) => (unit.existingDeliveries || [])
      .filter((item) => item.status === status)
      .map((item) => ({
        ...item,
        callbackScope: unit.scope,
        resultVersionKey: unit.resultVersionKey,
      }))));
}

export function summarizeRuntimeNextAction({ diagnostics, deliveryStatuses, groupSummaries, windowReadiness = {} }) {
  const controllerReturnPending = currentControllerReturnDeliveries(groupSummaries, "pending-host-send");
  const controllerReturnUnconfirmed = currentControllerReturnDeliveries(groupSummaries, "sent-unconfirmed");
  const targetPending = deliveryStatuses.filter((item) => item.kind === "DeliveryEnvelope" && item.status === "pending-host-send");
  const failedDeliveries = deliveryStatuses.filter((item) => item.status === "failed");
  const blockedDeliveries = deliveryStatuses.filter((item) => item.status === "blocked");
  const callbackReady = groupSummaries.filter((group) => (group.callbackPlan?.counts?.readyToBuildCount || 0) > 0);
  const reviewable = groupSummaries.filter((group) => ["ready", "blocked", "partially-ready"].includes(group.groupStatus));
  const waiting = groupSummaries.filter((group) => group.groupStatus === "waiting");
  const pendingDispatch = groupSummaries.filter((group) => group.groupStatus === "pending-dispatch");
  if (diagnostics.errors.length > 0) return "inspect-artifact-errors";
  if (failedDeliveries.length > 0) return "inspect-delivery-failures";
  if (blockedDeliveries.length > 0) return "review-delivery-blockers";
  if (controllerReturnPending.length > 0) return "send-controller-return";
  if (controllerReturnUnconfirmed.length > 0) return "inspect-controller-return-unconfirmed";
  if (targetPending.length > 0) return "send-target-delivery";
  if (callbackReady.length > 0) return "build-controller-return";
  if (reviewable.length > 0) return "review-target-results";
  if (waiting.length > 0) return "wait-for-target-result";
  if (pendingDispatch.length > 0) return "dispatch-pending-target";
  if ((windowReadiness.notReadyCount || 0) > 0) return "inspect-window-entry-sync";
  if ((windowReadiness.legacyAssumedReadyCount || 0) > 0) return "confirm-legacy-window-entry-sync";
  return "idle";
}

function issue(severity, code, message, detail = {}) {
  return {
    severity,
    code,
    message,
    ...detail,
  };
}

export function buildRuntimeHealth({
  diagnostics = { errors: [] },
  deliveryStatuses = [],
  groupSummaries = [],
  replaySummary = {},
  projectionHealth = [],
  keepLive = {},
  windowReadiness = {},
} = {}) {
  const artifactErrorCount = diagnostics.errors?.length || 0;
  const pendingHostSend = deliveryStatuses.filter((item) => item.status === "pending-host-send");
  const controllerReturnUnconfirmed = currentControllerReturnDeliveries(groupSummaries, "sent-unconfirmed");
  const failedDeliveries = deliveryStatuses.filter((item) => item.status === "failed");
  const blockedDeliveries = deliveryStatuses.filter((item) => item.status === "blocked");
  const reviewableGroups = groupSummaries.filter((group) => ["ready", "blocked", "partially-ready"].includes(group.groupStatus));
  const callbackReadyUnits = groupSummaries.flatMap((group) => (group.callbackPlan?.units || []).filter((unit) => unit.buildAllowed));
  const callbackWaitingForSentResults = groupSummaries.flatMap((group) => (group.callbackPlan?.units || []).filter((unit) => unit.status === "waiting-for-sent-results"));
  const waitingTargets = groupSummaries.flatMap((group) => group.targets
    .filter((target) => target.status === "missing")
    .map((target) => ({
      dispatchGroup: group.groupId,
      stateRoot: group.stateRoot,
      targetWindow: target.targetWindow,
      taskId: target.taskId,
    })));
  const pendingDispatchTargets = groupSummaries.flatMap((group) => group.targets
    .filter((target) => target.status === "pending-dispatch")
    .map((target) => ({
      dispatchGroup: group.groupId,
      stateRoot: group.stateRoot,
      targetWindow: target.targetWindow,
      taskId: target.taskId,
    })));
  const staleProjections = projectionHealth.filter((item) => item.projectionStatus === "stale");
  const missingIdempotencyKeyCount = replaySummary.missingIdempotencyKeyCount || 0;
  const notReadyWindows = Array.isArray(windowReadiness.notReady)
    ? windowReadiness.notReady
    : [];
  const legacyAssumedReadyWindows = Array.isArray(windowReadiness.legacyAssumedReady)
    ? windowReadiness.legacyAssumedReady
    : [];
  const issues = [
    ...(artifactErrorCount > 0
      ? [issue("error", "artifact-errors", "Runtime artifacts contain unreadable JSON or unsafe paths.", { count: artifactErrorCount })]
      : []),
    ...(failedDeliveries.length > 0
      ? [issue("error", "delivery-failed", "At least one delivery run failed.", { count: failedDeliveries.length })]
      : []),
    ...(blockedDeliveries.length > 0
      ? [issue("warning", "delivery-blocked", "At least one delivery is blocked and needs controller review.", { count: blockedDeliveries.length })]
      : []),
    ...(pendingHostSend.length > 0
      ? [issue("info", "host-send-pending", "Delivery envelopes are built and waiting for host send/readback.", { count: pendingHostSend.length })]
      : []),
    ...(controllerReturnUnconfirmed.length > 0
      ? [issue("warning", "controller-return-unconfirmed", "Controller-return transport was accepted, but the one bounded destination observation did not confirm visibility. Do not resend automatically.", { count: controllerReturnUnconfirmed.length })]
      : []),
    ...(reviewableGroups.length > 0
      ? [issue("info", "controller-review-ready", "Target review inputs are present and require controller inspection and validation.", { count: reviewableGroups.length })]
      : []),
    ...(callbackReadyUnits.length > 0
      ? [issue("info", "controller-return-ready", "Return policy permits controller-return envelope creation.", { count: callbackReadyUnits.length })]
      : []),
    ...(callbackWaitingForSentResults.length > 0
      ? [issue("info", "controller-return-waiting-for-group", "Group-ready callback is waiting for sent target results.", { count: callbackWaitingForSentResults.length })]
      : []),
    ...(waitingTargets.length > 0
      ? [issue("info", "target-result-missing", "Sent target deliveries are still missing target results.", { count: waitingTargets.length })]
      : []),
    ...(pendingDispatchTargets.length > 0
      ? [issue("info", "dispatch-pending", "Known target tasks have not yet been prepared for delivery.", { count: pendingDispatchTargets.length })]
      : []),
    ...(staleProjections.length > 0
      ? [issue("info", "projection-stale", "Controller progress projections need refresh from state roots.", { count: staleProjections.length })]
      : []),
    ...(missingIdempotencyKeyCount > 0
      ? [issue("warning", "replay-idempotency-missing", "Replay audit found artifacts without idempotency keys.", { count: missingIdempotencyKeyCount })]
      : []),
    ...(notReadyWindows.length > 0
      ? [issue("warning", "window-entry-sync-not-ready", "Registered host windows are waiting for entry-sync confirmation or reported an explicit failure; they are not dispatchable.", {
          count: notReadyWindows.length,
          windows: notReadyWindows.map((item) => ({ windowName: item.windowName, entrySyncStatus: item.entrySyncStatus })),
        })]
      : []),
    ...(legacyAssumedReadyWindows.length > 0
      ? [issue("warning", "window-entry-sync-legacy-assumed-ready", "Legacy window registrations remain dispatch-compatible, but their entry-sync readiness was never recorded explicitly. Observe each destination once and re-register the same handle as ready.", {
          count: legacyAssumedReadyWindows.length,
          windows: legacyAssumedReadyWindows.map((item) => ({ windowName: item.windowName })),
        })]
      : []),
  ];
  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.filter((item) => item.severity === "warning").length;
  const infoCount = issues.filter((item) => item.severity === "info").length;
  return {
    kind: "WakeflowRuntimeHealth",
    version: 1,
    status: errorCount > 0 ? "blocked" : issues.length > 0 ? "attention" : "healthy",
    summary: {
      errorCount,
      warningCount,
      infoCount,
      issueCount: issues.length,
    },
    checks: {
      artifacts: {
        status: artifactErrorCount > 0 ? "blocked" : "ok",
        errorCount: artifactErrorCount,
      },
      hostSend: {
        status: pendingHostSend.length > 0 ? "pending" : "ok",
        pendingCount: pendingHostSend.length,
      },
      controllerReview: {
        status: reviewableGroups.length > 0 ? "ready" : "ok",
        readyGroupCount: reviewableGroups.length,
      },
      controllerCallback: {
        status: controllerReturnUnconfirmed.length > 0 ? "unconfirmed" : callbackReadyUnits.length > 0 ? "ready" : callbackWaitingForSentResults.length > 0 ? "waiting" : "ok",
        readyUnitCount: callbackReadyUnits.length,
        unconfirmedCount: controllerReturnUnconfirmed.length,
        waitingForSentResultsCount: callbackWaitingForSentResults.length,
      },
      targetResults: {
        status: waitingTargets.length > 0 ? "waiting" : "ok",
        missingCount: waitingTargets.length,
      },
      pendingDispatch: {
        status: pendingDispatchTargets.length > 0 ? "ready" : "ok",
        targetCount: pendingDispatchTargets.length,
      },
      projection: {
        status: staleProjections.length > 0 ? "stale" : "ok",
        stateRootCount: projectionHealth.length,
        staleCount: staleProjections.length,
        staleStateRoots: staleProjections.map((item) => item.stateRoot),
      },
      replay: {
        status: missingIdempotencyKeyCount > 0 ? "needs-audit" : replaySummary.status || "unknown",
        missingIdempotencyKeyCount,
        repeatedDeliveryAttemptCount: replaySummary.repeatedDeliveryAttemptCount || 0,
        supersededTargetResultCount: replaySummary.supersededTargetResultCount || 0,
      },
      keepLive: {
        active: Boolean(keepLive.active),
        status: keepLive.status || "unknown",
      },
      windowEntrySync: {
        status: notReadyWindows.length > 0 ? "not-ready" : legacyAssumedReadyWindows.length > 0 ? "legacy-needs-confirmation" : "ok",
        registeredCount: windowReadiness.registeredCount || 0,
        readyCount: windowReadiness.readyCount || 0,
        explicitReadyCount: windowReadiness.explicitReadyCount || 0,
        notReadyCount: notReadyWindows.length,
        legacyAssumedReadyCount: legacyAssumedReadyWindows.length,
      },
    },
    issues,
    forbiddenConclusions: [
      "runtime-health-is-controller-acceptance",
      "runtime-health-sends-host-message",
      "runtime-health-creates-target-result",
    ],
  };
}

function reviewResumeSteps(groups) {
  return groups.map((group) => ({
    kind: "review-pack",
    tool: "wakeflow_review_pack",
    arguments: group.stateRoot
      ? { stateRoot: group.stateRoot }
      : { dispatchGroup: group.groupId },
    dispatchGroup: group.groupId,
    stateRoot: group.stateRoot,
    reason: "Target results are present or blocked; total control must inspect target review inputs and independently validate relevant behavior before reduce/decision.",
  }));
}

function deliveryFailureResumeSteps(deliveryStatuses) {
  return deliveryStatuses
    .filter((item) => ["failed", "blocked"].includes(item.status))
    .map((item) => ({
      kind: "inspect-delivery-run",
      deliveryKind: item.kind,
      deliveryStatus: item.status,
      deliveryFile: item.file,
      deliveryId: item.deliveryId,
      dispatchGroup: item.dispatchGroup,
      targetWindow: item.targetWindow,
      taskId: item.taskId,
      latestRunFile: item.latestRunFile,
      reason: "A delivery transport attempt was not recorded as host-accepted; total control must inspect its transportStatus before any retry. Readback visibility alone never authorizes resend.",
    }));
}

function controllerReturnBuildResumeSteps(groups) {
  return groups.flatMap((group) => (group.callbackPlan?.units || [])
    .filter((unit) => unit.buildAllowed)
    .map((unit) => ({
      kind: "prepare-controller-return",
      tool: "wakeflow_prepare_delivery",
      arguments: {
        direction: "controller-return",
        dispatchGroup: group.groupId,
        triggerTarget: unit.triggerTarget,
        triggerTaskId: unit.triggerTaskId,
      },
      dispatchGroup: group.groupId,
      stateRoot: group.stateRoot,
      triggerTarget: unit.triggerTarget,
      triggerTaskId: unit.triggerTaskId,
      returnPolicy: group.returnPolicy,
      callbackScope: unit.scope,
      reason: "A target result is present and the dispatch group's return policy allows a controller-return envelope.",
    })));
}

function dispatchPendingResumeSteps(groups) {
  return groups.flatMap((group) => group.targets
    .filter((target) => target.status === "pending-dispatch")
    .map((target) => ({
      kind: "prepare-target-delivery",
      tool: "wakeflow_prepare_delivery",
      arguments: {
        direction: "target",
        stateRoot: target.stateRoot,
        taskId: target.taskId,
        dispatchGroup: group.groupId,
      },
      dispatchGroup: group.groupId,
      stateRoot: target.stateRoot,
      targetWindow: target.targetWindow,
      reason: "A target task is known but has no sent delivery yet.",
    })));
}

function waitForResultResumeSteps(groups) {
  return groups.flatMap((group) => group.targets
    .filter((target) => target.status === "missing")
    .map((target) => ({
      kind: "stop-and-wait",
      dispatchGroup: group.groupId,
      targetWindow: target.targetWindow,
      taskId: target.taskId,
      deliveryStatus: target.deliveryStatus,
      reason: "Target delivery was sent and no target result envelope is present yet; do not poll or fabricate a result.",
    })));
}

export function buildRuntimeResumePlan({ nextAction, diagnostics, deliveryStatuses, groupSummaries, windowReadiness = {} }) {
  const controllerReturnPending = currentControllerReturnDeliveries(groupSummaries, "pending-host-send");
  const controllerReturnUnconfirmed = currentControllerReturnDeliveries(groupSummaries, "sent-unconfirmed");
  const targetPending = deliveryStatuses.filter((item) => item.kind === "DeliveryEnvelope" && item.status === "pending-host-send");
  const failedDeliveries = deliveryStatuses.filter((item) => item.status === "failed");
  const blockedDeliveries = deliveryStatuses.filter((item) => item.status === "blocked");
  const callbackReady = groupSummaries.filter((group) => (group.callbackPlan?.counts?.readyToBuildCount || 0) > 0);
  const reviewable = groupSummaries.filter((group) => ["ready", "blocked", "partially-ready"].includes(group.groupStatus));
  const waiting = groupSummaries.filter((group) => group.groupStatus === "waiting");
  const pendingDispatch = groupSummaries.filter((group) => group.groupStatus === "pending-dispatch");

  const base = {
    kind: "WakeflowRuntimeResumePlan",
    version: 1,
    nextAction,
    autoExecute: false,
    controllerDecisionRequired: false,
    hostSendRequired: false,
    stopRequired: false,
    steps: [],
    forbiddenConclusions: [
      "resume-plan-is-controller-acceptance",
      "resume-plan-sends-host-message",
      "resume-plan-creates-target-result",
    ],
  };

  if (diagnostics.errors.length > 0) {
    return {
      ...base,
      status: "blocked",
      stopRequired: true,
      reason: "Runtime artifacts have unreadable or unsafe state.",
      steps: diagnostics.errors.map((item) => ({
        kind: "inspect-artifact-error",
        file: item.file,
        error: item.error,
      })),
    };
  }
  if (failedDeliveries.length > 0 || blockedDeliveries.length > 0) {
    return {
      ...base,
      status: "blocked",
      stopRequired: true,
      reason: "One or more delivery transport attempts failed or were blocked; inspect run evidence before retrying.",
      steps: deliveryFailureResumeSteps(deliveryStatuses),
    };
  }
  if (controllerReturnPending.length > 0) {
    return {
      ...base,
      status: "ready",
      hostSendRequired: true,
      reason: "Controller-return envelopes are built but not sent/readback-recorded.",
      steps: buildHostSendResumeSteps(controllerReturnPending),
    };
  }
  if (controllerReturnUnconfirmed.length > 0) {
    return {
      ...base,
      status: "needs-observation-review",
      stopRequired: true,
      reason: "Controller-return transport was accepted, but the single bounded readback did not confirm destination visibility. Preserve the record and do not resend automatically.",
      steps: controllerReturnUnconfirmed.map((item) => ({
        kind: "stop-with-unconfirmed-controller-return",
        deliveryFile: item.file,
        deliveryId: item.deliveryId,
        dispatchGroup: item.dispatchGroup,
        targetWindow: item.targetWindow,
        readbackStatus: item.readbackStatus,
        reason: "The callback is sent-unconfirmed, not successful and not eligible for automatic resend.",
      })),
    };
  }
  if (targetPending.length > 0) {
    return {
      ...base,
      status: "ready",
      hostSendRequired: true,
      reason: "Target delivery envelopes are built but not sent/readback-recorded.",
      steps: buildHostSendResumeSteps(targetPending),
    };
  }
  if (callbackReady.length > 0) {
    return {
      ...base,
      status: "ready",
      reason: "Return policy permits controller-return envelope creation for completed or blocked target results.",
      steps: controllerReturnBuildResumeSteps(callbackReady),
    };
  }
  if (reviewable.length > 0) {
    return {
      ...base,
      status: "needs-controller-review",
      controllerDecisionRequired: true,
      reason: "Target results are available; total control must inspect target review inputs and independently validate relevant behavior before reducing or deciding.",
      steps: reviewResumeSteps(reviewable),
    };
  }
  if (waiting.length > 0) {
    return {
      ...base,
      status: "waiting",
      stopRequired: true,
      reason: "Sent target deliveries are still missing target results.",
      steps: waitForResultResumeSteps(waiting),
    };
  }
  if (pendingDispatch.length > 0) {
    return {
      ...base,
      status: "ready",
      reason: "Known target tasks have not yet been prepared/sent.",
      steps: dispatchPendingResumeSteps(pendingDispatch),
    };
  }
  if ((windowReadiness.notReadyCount || 0) > 0) {
    return {
      ...base,
      status: "needs-window-entry-sync",
      stopRequired: true,
      reason: "One or more registered windows are not entry-sync ready. Observe each destination once; do not resend automatically.",
      steps: (windowReadiness.notReady || []).map((item) => ({
        kind: "observe-window-entry-sync",
        windowName: item.windowName,
        entrySyncStatus: item.entrySyncStatus,
        attempts: 1,
        automaticResend: false,
        reason: "Promote the same registered handle to ready only after the expected entry-sync reply is visible.",
      })),
    };
  }
  if ((windowReadiness.legacyAssumedReadyCount || 0) > 0) {
    return {
      ...base,
      status: "needs-window-entry-sync-confirmation",
      stopRequired: true,
      reason: "Legacy registrations are dispatch-compatible, but their entry-sync reply was never recorded explicitly. Confirm rather than infer readiness.",
      steps: (windowReadiness.legacyAssumedReady || []).map((item) => ({
        kind: "confirm-legacy-window-entry-sync",
        windowName: item.windowName,
        entrySyncStatus: item.entrySyncStatus,
        attempts: 1,
        automaticResend: false,
        reason: "Observe the existing destination once and re-register the same handle as ready only when the expected entry-sync reply is visible.",
      })),
    };
  }
  return {
    ...base,
    status: "idle",
    reason: "No resumable delivery-loop runtime work is present.",
  };
}
