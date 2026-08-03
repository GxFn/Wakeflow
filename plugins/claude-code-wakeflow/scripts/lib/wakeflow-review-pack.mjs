// ONE source for the pieces both review-pack constructors share (the
// group-snapshot pack below and the state-root pack in review-commands):
// the advisory texts, the common gate keys, and the target-review-input projection.
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
      ? { craftCheck: "Some tasks declared advisory craft inputs (e.g. self-review, test-first); required craft kinds are already enforced structurally at reduce-results. Reminder only (not a gate): when judging quality, inspect and independently challenge the target's self-review note and test-first commit history." }
      : {}),
    ...(targetResults.some((item) => item.acceptanceAnchors?.length)
      ? { acceptanceAnchorCheck: "For each controller-authored acceptanceAnchor, inspect the target's RED/GREEN mapping and independently rerun or challenge the named probe. An anchor is requirement authority, but the target's mapping is still review input rather than acceptance proof." }
      : {}),
    ...(targetResults.some((item) => item.testExecution)
      ? {
          controllerAcceptanceBoundary: "Functional completeness and correctness remain total control's pre-Test validation and acceptance responsibility. Test inputs may expose an environment-specific edge or hidden defect, but a Test pass cannot complete unfinished controller validation and a Test failure must be classified against the confirmed goal before rework.",
          testAlignmentCheck: "Before accepting Test evidence or creating any follow-up, compare the returned step-to-anchor map against testExecution.requirementGoal and approvedPlan. Reject Test-invented goals, gates, skills, restarts, or unmapped steps; do not copy them into rework.",
        }
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
  resultContractGapsPresent,
  controllerReturnSent,
  controllerReturnReady,
  controllerReturnPendingHostSend,
}) {
  return {
    reviewInputsComplete: reviewReady && !missingEvidenceRefsPresent && !craftEvidenceGapsPresent && !resultContractGapsPresent,
    waitForMissingResults: missingCount > 0,
    pendingDispatchTargetsPresent: pendingDispatchCount > 0,
    blockedResultsPresent: blockedCount > 0,
    missingEvidenceRefsPresent,
    reviewInputRepairRequired: missingEvidenceRefsPresent,
    craftEvidenceGapsPresent,
    craftEvidenceRepairRequired: craftEvidenceGapsPresent,
    resultContractGapsPresent,
    resultContractRepairRequired: resultContractGapsPresent,
    controllerReturnSent,
    controllerReturnReady,
    controllerReturnPendingHostSend,
    reviewInputInspectionRequired: reviewReady,
    totalControlVerdictRequired: reviewReady && !missingEvidenceRefsPresent && !craftEvidenceGapsPresent && !resultContractGapsPresent,
  };
}

export function targetReviewInputsFrom(targetResults) {
  return targetResults
    .filter((item) => item.resultStatus !== "missing")
    .map((item) => ({
      targetWindow: item.targetWindow,
      taskId: item.taskId,
      resultStatus: item.resultStatus,
      commits: item.commits,
      evidenceRefs: item.evidenceRefs,
      verificationSummary: item.verificationSummary,
      hasReviewInputs: item.hasReviewInputs,
      missingEvidenceRefs: item.missingEvidenceRefs,
      craftEvidenceGaps: item.craftEvidenceGaps ?? [],
      resultContractGaps: item.resultContractGaps ?? [],
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
  const resultContractGaps = targetResults.flatMap((item) => item.resultContractGaps ?? []);
  const resultContractGapsPresent = resultContractGaps.length > 0;
  const targetReviewInputs = targetReviewInputsFrom(targetResults);
  const gates = sharedReviewGates({
    reviewReady,
    missingCount: review.groupSnapshot.missing.length,
    pendingDispatchCount: (review.groupSnapshot.pendingDispatch ?? []).length,
    blockedCount: review.blocked.length,
    missingEvidenceRefsPresent,
    craftEvidenceGapsPresent,
    resultContractGapsPresent,
    controllerReturnSent: (callbackPlan?.counts?.sentCount || 0) > 0,
    controllerReturnReady: (callbackPlan?.counts?.readyToBuildCount || 0) > 0,
    controllerReturnPendingHostSend: (callbackPlan?.counts?.pendingHostSendCount || 0) > 0,
  });
  // Transport-facing next step for whoever SENDS the controller return (the target's sanctioned
  // self-check, or the controller for its own return). INDEPENDENT of review-input quality on purpose:
  // a recorded result must wake the controller even when its declared review-input refs do not resolve —
  // review-input completeness is the controller's POST-wake starting point
  // (gates.reviewInputsComplete / nextAction), never a reason to withhold the wake-up. Without this split, a failed
  // review-input-ref existence check stalls the controller return and breaks the closed loop (the wake-up never fires).
  const controllerReturnNextStep = gates.controllerReturnReady
    ? "build-controller-return"
    : gates.controllerReturnPendingHostSend
      ? "send-controller-return-and-record-delivery"
      : gates.controllerReturnSent
        ? "controller-return-already-sent"
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
    targetReviewInputs,
    missingEvidenceRefs,
    craftEvidenceGaps,
    resultContractGaps,
    gates,
    ...reviewAdvisories(targetResults),
    nextAction: review.decision === "wait"
      ? "wait-for-target-result-envelope"
      : review.decision === "blocked"
        ? "inspect-block-review-inputs-and-classify"
        : missingEvidenceRefsPresent
          ? "fix-missing-review-input-refs-before-controller-verdict"
          : craftEvidenceGapsPresent
            ? "fix-required-craft-review-inputs-before-controller-verdict"
          : resultContractGapsPresent
            ? "fix-target-result-contract-before-controller-verdict"
          : (review.groupSnapshot.pendingDispatch ?? []).length > 0
            ? "inspect-target-review-inputs-and-continue-pending-dispatch"
            : "inspect-target-review-inputs-and-make-total-control-verdict",
    controllerReturnNextStep,
    wakeflowTrace,
    generatedAt,
  };
}
