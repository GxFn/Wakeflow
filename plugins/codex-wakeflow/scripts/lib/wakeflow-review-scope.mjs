// "accept" is the only FINAL review decision. A "blocked" decision parks the
// task pending new evidence: once a fresh target result is imported the task
// must become reviewable again, otherwise the demand wedges permanently
// (add-task refuses while blockers exist, reduce sees no open tasks, and
// complete refuses open tasks - no escape).
export function hasFinalControllerDecision(task) {
  return task?.status === "accepted" || task?.reviewDecision === "accept";
}

export function controllerReviewScope(targetTasks = []) {
  const reviewableTargetTasks = [];
  const excludedTargetTaskIds = [];

  for (const task of targetTasks) {
    if (hasFinalControllerDecision(task)) {
      excludedTargetTaskIds.push(task.targetTaskId);
    } else {
      reviewableTargetTasks.push(task);
    }
  }

  return {
    mode: "open-controller-review-targets",
    targetTaskIds: reviewableTargetTasks.map((task) => task.targetTaskId),
    excludedTargetTaskIds,
    reviewableTargetTasks,
  };
}

export function reductionStatusForTargetTask(task, result) {
  if (!result) return "missing-result";
  if (task?.reviewDecision === "rework") return "needs-rework";
  return result.status;
}
