// "accept" is the only FINAL review decision. A "blocked" decision parks the
// task pending a corrected result: once a fresh target result is imported the task
// must become reviewable again, otherwise the demand wedges permanently
// (add-task refuses while blockers exist, reduce sees no open tasks, and
// complete refuses open tasks - no escape).
export function hasFinalControllerDecision(task) {
  return ["accepted", "superseded"].includes(task?.status) || task?.reviewDecision === "accept";
}

export function hasPendingReworkDecision(task) {
  return task?.status === "needs-rework" || task?.reviewDecision === "rework";
}

export function isReworkRouteTask(task) {
  // Once redesign has an explicit replacement, only that replacement remains
  // in the active review route. The old task stays as immutable lineage until
  // the replacement is accepted, when it becomes superseded.
  if (task?.replacedByTargetTaskId) return false;
  return hasPendingReworkDecision(task)
    || ["rework", "redesign-replacement"].includes(task?.reviewRoute);
}

export function taskExpectsTargetResult(task) {
  if (task?.delivery?.deliveryRunId) return true;
  return ["sent", "active", "completed", "blocked", "needs-review"].includes(task?.status || "");
}

export function controllerReviewScope(targetTasks = []) {
  const openTargetTasks = [];
  const excludedTargetTaskIds = [];

  for (const task of targetTasks) {
    if (hasFinalControllerDecision(task)) {
      excludedTargetTaskIds.push(task.targetTaskId);
    } else {
      openTargetTasks.push(task);
    }
  }

  const reworkRouteTargetTasks = openTargetTasks.filter((task) => isReworkRouteTask(task));
  if (reworkRouteTargetTasks.length > 0) {
    const reworkRouteIds = new Set(reworkRouteTargetTasks.map((task) => task.targetTaskId));
    return {
      mode: "rework-first-controller-review-targets",
      targetTaskIds: reworkRouteTargetTasks.map((task) => task.targetTaskId),
      excludedTargetTaskIds: [
        ...excludedTargetTaskIds,
        ...openTargetTasks
          .filter((task) => !reworkRouteIds.has(task.targetTaskId))
          .map((task) => task.targetTaskId),
      ],
      reviewableTargetTasks: reworkRouteTargetTasks,
    };
  }

  return {
    mode: "open-controller-review-targets",
    targetTaskIds: openTargetTasks.map((task) => task.targetTaskId),
    excludedTargetTaskIds,
    reviewableTargetTasks: openTargetTasks,
  };
}

export function controllerReductionScope(targetTasks = [], currentResultTaskIds = []) {
  const resultTaskIds = new Set(currentResultTaskIds);
  const reductionCandidates = targetTasks.filter((task) => (
    hasFinalControllerDecision(task)
    || isReworkRouteTask(task)
    || resultTaskIds.has(task.targetTaskId)
    || taskExpectsTargetResult(task)
  ));
  const scope = controllerReviewScope(reductionCandidates);
  const targetTaskIds = new Set(scope.targetTaskIds);

  return {
    ...scope,
    excludedTargetTaskIds: targetTasks
      .filter((task) => !targetTaskIds.has(task.targetTaskId))
      .map((task) => task.targetTaskId),
  };
}

export function reductionStatusForTargetTask(task, result) {
  if (!result) return "missing-result";
  // Both controller revision routes park the prior result. A redesign does
  // not make that historical result current again while the corrected task
  // package is being prepared and reviewed.
  if (["rework", "redesign"].includes(task?.reviewDecision)) return "needs-rework";
  return result.status;
}
