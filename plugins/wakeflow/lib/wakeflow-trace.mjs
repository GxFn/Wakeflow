export function buildWakeflowTrace({
  artifactKind,
  args = [],
  candidateId,
  command,
  completedAt,
  createdAt,
  cwd,
  demandKey,
  deliveryFile,
  deliveryId,
  deliveryRunId,
  dispatchGroup,
  parsedJson,
  resultId,
  root,
  script,
  source,
  startedAt,
  stateRef,
  stateRevision,
  stateRoot,
  targetTaskId,
  targetWindow,
  taskPackageId,
} = {}) {
  const resolvedCommand = command || valueAt(parsedJson, "command") || inferWakeflowCommand(script, args);
  return pruneUndefined({
    kind: "WakeflowTrace",
    version: 1,
    artifactKind,
    source,
    script,
    command: resolvedCommand,
    cwd,
    root: root || argValue(args, "--root") || valueAt(parsedJson, "root") || valueAt(parsedJson, "workspaceRoot"),
    stateRoot: stateRoot || stateRef?.stateRoot || argValue(args, "--state-root") || valueAt(parsedJson, "stateRoot") || valueAt(parsedJson, "stateRef.stateRoot"),
    stateRevision: stateRevision ?? stateRef?.stateRevision ?? valueAt(parsedJson, "stateRevision") ?? valueAt(parsedJson, "stateRef.stateRevision"),
    demandKey: demandKey || stateRef?.demandKey || argValue(args, "--demand-key") || valueAt(parsedJson, "demandKey") || valueAt(parsedJson, "stateRef.demandKey"),
    taskPackageId: taskPackageId || stateRef?.taskPackageId || argValue(args, "--task-package-id") || valueAt(parsedJson, "taskPackageId") || valueAt(parsedJson, "stateRef.taskPackageId"),
    targetTaskId: targetTaskId || stateRef?.targetTaskId || argValue(args, "--target-task-id") || valueAt(parsedJson, "targetTaskId") || valueAt(parsedJson, "stateRef.targetTaskId"),
    targetWindow: targetWindow || argValue(args, "--target-window") || valueAt(parsedJson, "targetWindow"),
    dispatchGroup: dispatchGroup || argValue(args, "--group") || valueAt(parsedJson, "dispatchGroup") || valueAt(parsedJson, "group"),
    deliveryId: deliveryId || valueAt(parsedJson, "deliveryId"),
    deliveryFile: deliveryFile || argValue(args, "--delivery-file") || valueAt(parsedJson, "deliveryFile"),
    deliveryRunId: deliveryRunId || valueAt(parsedJson, "deliveryRunId"),
    resultId: resultId || argValue(args, "--result-id") || valueAt(parsedJson, "resultId"),
    candidateId: candidateId || argValue(args, "--candidate-id") || valueAt(parsedJson, "candidateId"),
    startedAt,
    completedAt,
    createdAt,
  });
}

export function inferWakeflowCommand(script, args = []) {
  if (script === "wakeflow-cli" && typeof args[0] === "string") return args[0];
  if (typeof args[0] === "string" && !args[0].startsWith("-")) return args[0];
  return script;
}

export function argValue(args = [], name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return typeof value === "string" && !value.startsWith("--") ? value : undefined;
}

export function valueAt(value, dottedPath) {
  if (!value || typeof value !== "object") return undefined;
  let current = value;
  for (const segment of dottedPath.split(".")) {
    if (!current || typeof current !== "object" || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current === "" || current === null ? undefined : current;
}

export function pruneUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function oneLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

export function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}
