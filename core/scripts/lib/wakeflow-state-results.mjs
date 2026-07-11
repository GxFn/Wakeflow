import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export function readStateRootTargetResultItems(stateRoot, readJson) {
  const dir = path.join(stateRoot, "target-results");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const file = path.join(dir, name);
      return { file, result: readJson(file, "target result") };
    });
}

export function selectCurrentStateRootResults({ items, state, fail }) {
  const byTask = new Map();
  for (const item of items) {
    const targetTaskId = item.result?.targetTaskId || item.result?.taskId;
    if (!targetTaskId) continue;
    if (!byTask.has(targetTaskId)) byTask.set(targetTaskId, []);
    byTask.get(targetTaskId).push(item);
  }

  const selected = new Map();
  for (const [targetTaskId, candidates] of byTask) {
    const marked = candidates.filter((item) => item.result?.currentResult === true);
    if (marked.length > 1) {
      fail(`multiple current target results exist for ${targetTaskId}; repair the state root before reducing or reviewing.`);
    }
    if (marked.length === 1) {
      selected.set(targetTaskId, marked[0]);
      continue;
    }

    const task = (state?.targetTasks ?? []).find((item) => item.targetTaskId === targetTaskId);
    const currentGroup = task?.delivery?.dispatchGroup || "";
    if (currentGroup) {
      const matchingGroup = candidates.filter((item) => item.result?.dispatchGroup === currentGroup);
      if (matchingGroup.length > 1) {
        fail(`multiple legacy target results match current dispatch group ${currentGroup} for ${targetTaskId}; repair the state root before reducing or reviewing.`);
      }
      if (matchingGroup.length === 1) {
        selected.set(targetTaskId, matchingGroup[0]);
        continue;
      }
      const ungrouped = candidates.filter((item) => !item.result?.dispatchGroup);
      if (candidates.length === 1 && ungrouped.length === 1) {
        selected.set(targetTaskId, ungrouped[0]);
      }
      continue;
    }

    if (candidates.length > 1) {
      fail(`multiple unmarked legacy target results exist for ${targetTaskId}; repair the state root before reducing or reviewing.`);
    }
    selected.set(targetTaskId, candidates[0]);
  }
  return selected;
}

export function currentStateRootResults({ stateRoot, state, readJson, fail }) {
  return selectCurrentStateRootResults({
    items: readStateRootTargetResultItems(stateRoot, readJson),
    state,
    fail,
  });
}
