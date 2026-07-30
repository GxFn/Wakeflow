import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { appendControllerEventAtomic } from "./wakeflow-controller-events.mjs";

export const PENDING_STATE_TRANSITION_FILE = "wakeflow-state.pending-transition.json";

export class WakeflowPendingTransitionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "WakeflowPendingTransitionError";
    this.details = details;
  }
}

export function pendingStateTransitionFile(stateRoot) {
  return path.join(stateRoot, PENDING_STATE_TRANSITION_FILE);
}

export function readPendingStateTransition(stateRoot) {
  const file = pendingStateTransitionFile(stateRoot);
  if (!existsSync(file)) return null;
  assertStateAuthorityPaths({ stateRoot });
  let pending;
  try {
    pending = JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    throw new WakeflowPendingTransitionError(
      `pending state transition is malformed: ${cause.message}`,
      { file, cause },
    );
  }
  validatePendingTransition(pending, stateRoot);
  return pending;
}

// Persist the intended state/event pair before either authoritative write.
// If the process stops after this point, the next state-writing command can
// replay the exact pair instead of duplicating the event or guessing state.
export function commitStateTransition({
  stateRoot,
  stateFile,
  eventsFile,
  event,
  nextState,
  jsonArtifacts = [],
  command = null,
}) {
  assertStateAuthorityPaths({ stateRoot, stateFile, eventsFile });
  const pendingFile = pendingStateTransitionFile(stateRoot);
  if (existsSync(pendingFile)) {
    throw new WakeflowPendingTransitionError(
      `cannot start a new state transition while ${PENDING_STATE_TRANSITION_FILE} exists`,
      { pendingFile },
    );
  }
  const artifacts = jsonArtifacts.map(({ file, value }) => ({
    path: relativeInsideStateRoot(stateRoot, file),
    value,
  }));
  const pending = {
    kind: "WakeflowPendingStateTransition",
    version: 1,
    command,
    createdAt: new Date().toISOString(),
    event,
    nextState,
    artifacts,
  };
  validatePendingTransition(pending, stateRoot);
  writeJsonAtomic(pendingFile, pending);
  for (const artifact of artifacts) {
    writeJsonAtomic(path.join(stateRoot, artifact.path), artifact.value);
  }
  appendControllerEventAtomic(eventsFile, event);
  writeJsonAtomic(stateFile, nextState);
  unlinkIfExists(pendingFile);
}

// Called while holding the state-root lock. It either returns a clean state,
// reports that a dry-run cannot recover, or completes the exact durable intent
// written by commitStateTransition. No inference from event type is needed.
export function recoverPendingStateTransition({
  stateRoot,
  state,
  events,
  write,
}) {
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  assertStateAuthorityPaths({ stateRoot, stateFile, eventsFile });
  const pending = readPendingStateTransition(stateRoot);
  if (!pending) return { status: "none" };

  const pendingFile = pendingStateTransitionFile(stateRoot);
  const currentRevision = integerRevision(state?.revision, "current state");
  const targetRevision = integerRevision(pending.nextState?.revision, "pending next state");
  const eventRevision = integerRevision(pending.event?.stateRevision, "pending event");
  const eventId = nonEmptyString(pending.event?.eventId, "pending eventId");
  if (targetRevision !== eventRevision) {
    throw new WakeflowPendingTransitionError(
      `pending transition state revision ${targetRevision} does not match event revision ${eventRevision}`,
      { pendingFile, currentRevision, targetRevision, eventRevision, eventId },
    );
  }
  if (pending.nextState?.demandKey !== state?.demandKey) {
    throw new WakeflowPendingTransitionError(
      `pending transition demand ${pending.nextState?.demandKey ?? "(missing)"} does not match current demand ${state?.demandKey ?? "(missing)"}`,
      { pendingFile, currentRevision, targetRevision, eventId },
    );
  }

  const matchingEvents = events.filter((event) => event?.eventId === eventId);
  if (matchingEvents.some((event) => Number(event?.stateRevision) !== targetRevision)) {
    throw new WakeflowPendingTransitionError(
      `pending eventId ${eventId} is already recorded at a different revision`,
      { pendingFile, currentRevision, targetRevision, eventId },
    );
  }
  if (matchingEvents.some((event) => !isDeepStrictEqual(event, pending.event))) {
    throw new WakeflowPendingTransitionError(
      `pending eventId ${eventId} is already recorded with different content`,
      { pendingFile, currentRevision, targetRevision, eventId },
    );
  }
  const competingTargetEvents = events.filter((event) => (
    Number(event?.stateRevision) === targetRevision
    && event?.eventId !== eventId
  ));
  if (competingTargetEvents.length > 0) {
    throw new WakeflowPendingTransitionError(
      `pending revision ${targetRevision} is already occupied by controller event ${competingTargetEvents[0].eventId ?? "(unknown)"}`,
      {
        pendingFile,
        currentRevision,
        targetRevision,
        eventId,
        conflictingEventId: competingTargetEvents[0].eventId ?? null,
        conflictingRevision: targetRevision,
      },
    );
  }
  if (matchingEvents.length > 1) {
    throw new WakeflowPendingTransitionError(
      `pending eventId ${eventId} is duplicated in the controller event log`,
      { pendingFile, currentRevision, targetRevision, eventId },
    );
  }

  const eventsWithoutPending = events.filter((event) => event?.eventId !== eventId);
  const priorRevision = eventsWithoutPending.at(-1)?.stateRevision ?? 0;
  const expectedPriorRevision = targetRevision - 1;
  if (priorRevision !== expectedPriorRevision) {
    throw new WakeflowPendingTransitionError(
      `pending transition cannot repair controller event history: state revision ${currentRevision} requires prior event revision ${expectedPriorRevision}, but the log ends at ${priorRevision}`,
      {
        pendingFile,
        currentRevision,
        targetRevision,
        eventId,
        latestEventRevision: events.at(-1)?.stateRevision ?? 0,
      },
    );
  }

  const conflictingFuture = events.filter((event) => (
    Number.isInteger(event?.stateRevision)
    && event.stateRevision > currentRevision
    && event.eventId !== eventId
  ));
  if (conflictingFuture.length > 0) {
    throw new WakeflowPendingTransitionError(
      `pending transition conflicts with controller event ${conflictingFuture[0].eventId ?? "(unknown)"} at revision ${conflictingFuture[0].stateRevision}`,
      {
        pendingFile,
        currentRevision,
        targetRevision,
        eventId,
        conflictingEventId: conflictingFuture[0].eventId ?? null,
        conflictingRevision: conflictingFuture[0].stateRevision,
      },
    );
  }

  if (currentRevision === targetRevision) {
    if (!isDeepStrictEqual(state, pending.nextState)) {
      throw new WakeflowPendingTransitionError(
        `pending revision ${targetRevision} is already occupied by different state content`,
        { pendingFile, currentRevision, targetRevision, eventId },
      );
    }
    if (matchingEvents.length === 0) {
      if (!write) {
        return {
          status: "write-required",
          pendingFile,
          currentRevision,
          targetRevision,
          eventId,
          reason: "state-written-event-missing",
        };
      }
      appendControllerEventAtomic(eventsFile, pending.event);
    }
    if (write) unlinkIfExists(pendingFile);
    return {
      status: write ? "recovered" : "already-applied",
      currentRevision,
      targetRevision,
      eventId,
    };
  }

  if (currentRevision !== targetRevision - 1) {
    throw new WakeflowPendingTransitionError(
      `pending transition expects state revision ${targetRevision - 1}, but current state is revision ${currentRevision}`,
      { pendingFile, currentRevision, targetRevision, eventId },
    );
  }
  if (!write) {
    return {
      status: "write-required",
      pendingFile,
      currentRevision,
      targetRevision,
      eventId,
      reason: matchingEvents.length ? "event-written-state-missing" : "transition-not-finished",
    };
  }

  for (const artifact of pending.artifacts ?? []) {
    assertArtifactPathHasNoSymlink(stateRoot, artifact.path);
    writeJsonAtomic(path.join(stateRoot, artifact.path), artifact.value);
  }
  if (matchingEvents.length === 0) {
    appendControllerEventAtomic(eventsFile, pending.event);
  }
  writeJsonAtomic(stateFile, pending.nextState);
  unlinkIfExists(pendingFile);
  return {
    status: "recovered",
    currentRevision,
    targetRevision,
    eventId,
  };
}

export function assertStateAuthorityPaths({
  stateRoot,
  stateFile = path.join(stateRoot, "wakeflow-state.json"),
  eventsFile = path.join(stateRoot, "controller-events.jsonl"),
}) {
  const root = path.resolve(stateRoot);
  assertExactAuthorityChild(root, stateFile, "wakeflow-state.json");
  assertExactAuthorityChild(root, eventsFile, "controller-events.jsonl");
  assertNotSymlink(root, "state root");
  for (const [file, label] of [
    [stateFile, "controller state"],
    [eventsFile, "controller event log"],
    [pendingStateTransitionFile(root), "pending state transition"],
  ]) {
    if (existsSync(file)) assertNotSymlink(file, label);
  }
  const rootReal = realpathSync(root);
  for (const file of [stateFile, eventsFile, pendingStateTransitionFile(root)]) {
    const parentReal = realpathSync(path.dirname(file));
    if (parentReal !== rootReal) {
      throw new WakeflowPendingTransitionError(
        `state authority path resolves outside its state root: ${file}`,
        { stateRoot: root, file },
      );
    }
  }
}

function validatePendingTransition(pending, stateRoot) {
  if (!pending || typeof pending !== "object" || Array.isArray(pending)) {
    throw new WakeflowPendingTransitionError("pending state transition must be a JSON object");
  }
  if (pending.kind !== "WakeflowPendingStateTransition" || pending.version !== 1) {
    throw new WakeflowPendingTransitionError("pending state transition kind/version is unsupported");
  }
  if (!pending.event || typeof pending.event !== "object" || Array.isArray(pending.event)) {
    throw new WakeflowPendingTransitionError("pending state transition is missing its event");
  }
  if (!pending.nextState || typeof pending.nextState !== "object" || Array.isArray(pending.nextState)) {
    throw new WakeflowPendingTransitionError("pending state transition is missing its next state");
  }
  const eventRevision = integerRevision(pending.event.stateRevision, "pending event");
  const stateRevision = integerRevision(pending.nextState.revision, "pending next state");
  nonEmptyString(pending.event.eventId, "pending eventId");
  nonEmptyString(pending.nextState.demandKey, "pending demandKey");
  if (eventRevision !== stateRevision) {
    throw new WakeflowPendingTransitionError(
      `pending transition state revision ${stateRevision} does not match event revision ${eventRevision}`,
      { eventRevision, targetRevision: stateRevision, eventId: pending.event.eventId },
    );
  }
  if (!Array.isArray(pending.artifacts ?? [])) {
    throw new WakeflowPendingTransitionError("pending state transition artifacts must be an array");
  }
  for (const artifact of pending.artifacts ?? []) {
    if (!artifact || typeof artifact !== "object" || typeof artifact.path !== "string") {
      throw new WakeflowPendingTransitionError("pending state transition artifact is invalid");
    }
    if (path.isAbsolute(artifact.path)) {
      throw new WakeflowPendingTransitionError(
        `pending transition artifact path must be relative: ${artifact.path}`,
      );
    }
    const relative = relativeInsideStateRoot(stateRoot, path.join(stateRoot, artifact.path));
    assertArtifactPathHasNoSymlink(stateRoot, relative);
  }
}

function relativeInsideStateRoot(stateRoot, file) {
  const root = path.resolve(stateRoot);
  const absolute = path.resolve(file);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new WakeflowPendingTransitionError(
      `pending transition artifact must be a file below the state root: ${absolute}`,
    );
  }
  if ([
    "wakeflow-state.json",
    "controller-events.jsonl",
    PENDING_STATE_TRANSITION_FILE,
  ].includes(relative.toLowerCase())) {
    throw new WakeflowPendingTransitionError(
      `pending transition artifact cannot replace an authority file: ${relative}`,
    );
  }
  return relative;
}

function assertArtifactPathHasNoSymlink(stateRoot, relative) {
  let rootReal;
  try {
    if (lstatSync(stateRoot).isSymbolicLink()) {
      throw new WakeflowPendingTransitionError(
        `state root must not be a symbolic link while recovering transition artifacts: ${stateRoot}`,
      );
    }
    rootReal = realpathSync(stateRoot);
  } catch (error) {
    if (error instanceof WakeflowPendingTransitionError) throw error;
    throw new WakeflowPendingTransitionError(
      `cannot resolve state root while validating transition artifacts: ${error.message}`,
    );
  }
  let current = stateRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw new WakeflowPendingTransitionError(
        `cannot inspect transition artifact path ${current}: ${error.message}`,
      );
    }
    if (stat.isSymbolicLink()) {
      throw new WakeflowPendingTransitionError(
        `pending transition artifact path crosses a symbolic link: ${relative}`,
      );
    }
    const currentReal = realpathSync(current);
    const realRelative = path.relative(rootReal, currentReal);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new WakeflowPendingTransitionError(
        `pending transition artifact resolves outside the state root: ${relative}`,
      );
    }
  }
}

function integerRevision(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new WakeflowPendingTransitionError(`${label} revision must be a non-negative integer`);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new WakeflowPendingTransitionError(`${label} must be a non-empty string`);
  }
  return value;
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temp, file);
  } catch (error) {
    unlinkIfExists(temp);
    throw error;
  }
}

function unlinkIfExists(file) {
  try {
    unlinkSync(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function assertExactAuthorityChild(stateRoot, file, basename) {
  const expected = path.join(stateRoot, basename);
  if (path.resolve(file) !== expected) {
    throw new WakeflowPendingTransitionError(
      `${basename} must be the canonical authority file directly under its state root`,
      { stateRoot, file: path.resolve(file), expected },
    );
  }
}

function assertNotSymlink(file, label) {
  let stat;
  try {
    stat = lstatSync(file);
  } catch (cause) {
    throw new WakeflowPendingTransitionError(
      `cannot inspect ${label} path ${file}: ${cause.message}`,
      { file, cause },
    );
  }
  if (stat.isSymbolicLink()) {
    throw new WakeflowPendingTransitionError(
      `${label} must not be a symbolic link: ${file}`,
      { file },
    );
  }
}
