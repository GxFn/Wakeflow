// "accept" is the only FINAL review decision. A "blocked" decision parks the
// task pending new evidence: once a fresh target result is imported the task
// must become reviewable again, otherwise the demand wedges permanently
// (add-task refuses while blockers exist, reduce sees no open tasks, and
// complete refuses open tasks - no escape).
export function hasFinalControllerDecision(task) {
  return task?.status === "accepted" || task?.reviewDecision === "accept";
}

export function hasPendingReworkDecision(task) {
  return task?.status === "needs-rework" || task?.reviewDecision === "rework";
}

export function isReworkRouteTask(task) {
  return hasPendingReworkDecision(task) || task?.reviewRoute === "rework";
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
  if (task?.reviewDecision === "rework") return "needs-rework";
  return result.status;
}
