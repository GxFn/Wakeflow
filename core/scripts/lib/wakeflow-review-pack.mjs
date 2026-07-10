// ONE source for the pieces both review-pack constructors share (the
// group-snapshot pack below and the state-root pack in review-commands):
// the advisory texts, the common gate keys, and the raw-evidence projection.
// Keeping them here means the review judgment vocabulary cannot drift
// between the two entry points.

export function reviewAdvisories(targetResults) {
  return {
    // Review-time intent check: additive advisory, present only when any entry
    // carries a designIntent; gates and nextAction stay untouched by design.
    ...(targetResults.some((item) => item.designIntent)
      ? { intentCheck: "Compare designIntent / objective / delivered result per task. If the delivery departs from the design intent and the dispatch did not declare an intentional adaptation, run a requirement review (Original Plan / Requirement Design) first; if the requirement itself must change, decide redesign." }
      : {}),
    // B2 craft check: additive advisory, present only when a reviewable entry carries
    // advisory craft kinds. Required kinds are enforced at reduce-results; reminder only.
    ...(targetResults.some((item) => item.advisoryCraftKinds?.length)
      ? { craftCheck: "Some tasks declared advisory craft evidence (e.g. self-review, test-first); required craft kinds are already enforced at reduce-results. Reminder only (not a gate): when judging quality, check the target's self-review note and test-first commit history." }
      : {}),
  };
}

export function sharedReviewGates({
  reviewReady,
  missingCount,
  pendingDispatchCount,
  blockedCount,
  missingEvidenceRefsPresent,
  craftEvidenceGapsPresent,
  controllerReturnSent,
  controllerReturnReady,
  controllerReturnPendingHostSend,
}) {
  return {
    controllerReviewReady: reviewReady && !missingEvidenceRefsPresent && !craftEvidenceGapsPresent,
    waitForMissingResults: missingCount > 0,
    pendingDispatchTargetsPresent: pendingDispatchCount > 0,
    blockedResultsPresent: blockedCount > 0,
    missingEvidenceRefsPresent,
    evidenceRepairRequired: missingEvidenceRefsPresent,
    craftEvidenceGapsPresent,
    craftEvidenceRepairRequired: craftEvidenceGapsPresent,
    controllerReturnSent,
    controllerReturnReady,
    controllerReturnPendingHostSend,
    rawEvidencePullRequired: reviewReady,
    totalControlVerdictRequired: reviewReady && !missingEvidenceRefsPresent && !craftEvidenceGapsPresent,
  };
}

export function rawEvidenceRequiredFrom(targetResults) {
  return targetResults
    .filter((item) => item.resultStatus !== "missing")
    .map((item) => ({
      targetWindow: item.targetWindow,
      taskId: item.taskId,
      resultStatus: item.resultStatus,
      commits: item.commits,
      evidenceRefs: item.evidenceRefs,
      verificationSummary: item.verificationSummary,
      hasControllerReviewEvidence: item.hasControllerReviewEvidence,
      missingEvidenceRefs: item.missingEvidenceRefs,
      craftEvidenceGaps: item.craftEvidenceGaps ?? [],
    }));
}

export function buildControllerReviewPack({
  review,
  controllerReturnDelivery,
  callbackPlan,
  targetResults,
  generatedAt,
  wakeflowTrace,
  version = 1,
}) {
  const reviewReady = review.decision !== "wait";
  const missingEvidenceRefs = targetResults.flatMap((item) => item.missingEvidenceRefs.map((ref) => ({
    targetWindow: item.targetWindow,
    taskId: item.taskId,
    ref,
  })));
  const missingEvidenceRefsPresent = missingEvidenceRefs.length > 0;
  const craftEvidenceGaps = targetResults.flatMap((item) => item.craftEvidenceGaps ?? []);
  const craftEvidenceGapsPresent = craftEvidenceGaps.length > 0;
  const rawEvidenceRequired = rawEvidenceRequiredFrom(targetResults);
  const gates = sharedReviewGates({
    reviewReady,
    missingCount: review.groupSnapshot.missing.length,
    pendingDispatchCount: (review.groupSnapshot.pendingDispatch ?? []).length,
    blockedCount: review.blocked.length,
    missingEvidenceRefsPresent,
    craftEvidenceGapsPresent,
    controllerReturnSent: controllerReturnDelivery.status === "sent",
    controllerReturnReady: (callbackPlan?.counts?.readyToBuildCount || 0) > 0,
    controllerReturnPendingHostSend: (callbackPlan?.counts?.pendingHostSendCount || 0) > 0,
  });
  // Transport-facing next step for whoever SENDS the controller return (the target's sanctioned
  // self-check, or the controller for its own return). INDEPENDENT of evidence quality on purpose:
  // a recorded result must wake the controller even when its evidence refs do not resolve —
  // evidence sufficiency is the controller's POST-wake verdict (gates.controllerReviewReady /
  // nextAction), never a reason to withhold the wake-up. Without this split, a failed evidence-ref
  // existence check stalls the controller return and breaks the closed loop (the wake-up never fires).
  const controllerReturnNextStep = gates.controllerReturnSent
    ? "controller-return-already-sent"
    : gates.controllerReturnReady
      ? "send-controller-return"
      : gates.controllerReturnPendingHostSend
        ? "complete-controller-return-host-send"
        : gates.waitForMissingResults
          ? "wait-for-group-results"
          : "no-controller-return-needed";
  return {
    kind: "ControllerReviewPack",
    version,
    dispatchGroup: review.group || undefined,
    taskId: review.taskId || undefined,
    decision: review.decision,
    returnPolicy: review.returnPolicy,
    groupStatus: review.groupStatus,
    groupSnapshot: review.groupSnapshot,
    controllerReturnDelivery,
    callbackPlan,
    targetResults,
    rawEvidenceRequired,
    missingEvidenceRefs,
    craftEvidenceGaps,
    gates,
    ...reviewAdvisories(targetResults),
    nextAction: review.decision === "wait"
      ? "wait-for-target-result-envelope"
      : review.decision === "blocked"
        ? "pull-block-evidence-and-classify"
        : missingEvidenceRefsPresent
          ? "fix-missing-evidence-refs-before-controller-verdict"
          : craftEvidenceGapsPresent
            ? "fix-required-craft-evidence-before-controller-verdict"
          : (review.groupSnapshot.pendingDispatch ?? []).length > 0
            ? "pull-raw-evidence-and-continue-pending-dispatch"
            : "pull-raw-evidence-and-make-total-control-verdict",
    controllerReturnNextStep,
    wakeflowTrace,
    generatedAt,
  };
}
