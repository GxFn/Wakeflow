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
  const rawEvidenceRequired = targetResults
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
    }));
  const gates = {
    controllerReviewReady: reviewReady && !missingEvidenceRefsPresent,
    waitForMissingResults: review.groupSnapshot.missing.length > 0,
    pendingDispatchTargetsPresent: (review.groupSnapshot.pendingDispatch ?? []).length > 0,
    blockedResultsPresent: review.blocked.length > 0,
    missingEvidenceRefsPresent,
    evidenceRepairRequired: missingEvidenceRefsPresent,
    controllerReturnSent: controllerReturnDelivery.status === "sent",
    controllerReturnReady: (callbackPlan?.counts?.readyToBuildCount || 0) > 0,
    controllerReturnPendingHostSend: (callbackPlan?.counts?.pendingHostSendCount || 0) > 0,
    rawEvidencePullRequired: reviewReady,
    totalControlVerdictRequired: reviewReady && !missingEvidenceRefsPresent,
  };
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
    gates,
    nextAction: review.decision === "wait"
      ? "wait-for-target-result-envelope"
      : review.decision === "blocked"
        ? "pull-block-evidence-and-classify"
        : missingEvidenceRefsPresent
          ? "fix-missing-evidence-refs-before-controller-verdict"
          : (review.groupSnapshot.pendingDispatch ?? []).length > 0
            ? "pull-raw-evidence-and-continue-pending-dispatch"
            : "pull-raw-evidence-and-make-total-control-verdict",
    wakeflowTrace,
    generatedAt,
  };
}
