const FINAL_CONTROLLER_DECISIONS = new Set(["accept", "blocked"]);

export function hasFinalControllerDecision(task) {
  return task?.status === "accepted" || FINAL_CONTROLLER_DECISIONS.has(task?.reviewDecision);
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
