import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export class WakeflowControllerEventLogError extends Error {
  constructor({ file, lineNumber, cause }) {
    super(`controller event log is malformed at line ${lineNumber}: ${cause.message}`);
    this.name = "WakeflowControllerEventLogError";
    this.file = file;
    this.lineNumber = lineNumber;
    this.cause = cause;
  }
}

export function readControllerEventsStrict(file) {
  if (!existsSync(file)) return [];
  try {
    if (lstatSync(file).isSymbolicLink()) {
      throw new Error("controller event log must not be a symbolic link");
    }
  } catch (cause) {
    throw new WakeflowControllerEventLogError({
      file,
      lineNumber: 0,
      cause,
    });
  }
  const events = [];
  const eventIds = new Set();
  const revisions = new Set();
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      validateControllerEvent(event, {
        eventIds,
        revisions,
        previousRevision: events.at(-1)?.stateRevision ?? null,
      });
      events.push(event);
      eventIds.add(event.eventId);
      revisions.add(event.stateRevision);
    } catch (cause) {
      throw new WakeflowControllerEventLogError({
        file,
        lineNumber: index + 1,
        cause,
      });
    }
  }
  return events;
}

/**
 * Publish one controller event without ever exposing a partially appended JSON
 * line. Callers already serialize state-root writers; this helper preserves the
 * complete existing log in a sibling temp file and makes the rename the only
 * authority publication point.
 */
export function appendControllerEventAtomic(file, event) {
  const events = readControllerEventsStrict(file);
  validateControllerEvent(event, {
    eventIds: new Set(events.map((item) => item.eventId)),
    revisions: new Set(events.map((item) => item.stateRevision)),
    previousRevision: events.at(-1)?.stateRevision ?? null,
  });

  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const separator = existing.length > 0 && !/[\r\n]$/.test(existing) ? "\n" : "";
  const content = `${existing}${separator}${JSON.stringify(event)}\n`;
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, content, { flag: "wx", mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
}

export function controllerEventStateAlignment(events, stateRevision) {
  if (typeof stateRevision !== "number" || !Number.isInteger(stateRevision) || stateRevision < 0) {
    throw new TypeError("controller state revision must be a non-negative integer");
  }
  const latestEventRevision = events.at(-1)?.stateRevision ?? 0;
  return {
    status: latestEventRevision === stateRevision
      ? "aligned"
      : latestEventRevision > stateRevision
        ? "event-ahead"
        : "state-ahead",
    stateRevision,
    latestEventRevision,
    latestEvent: events.at(-1) ?? null,
  };
}

export function futureControllerEvents(events, stateRevision) {
  const revision = stateRevision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    return [];
  }
  return events.filter((event) => (
    typeof event?.stateRevision === "number"
    && Number.isInteger(event.stateRevision)
    && event.stateRevision > revision
  ));
}

function validateControllerEvent(event, {
  eventIds,
  revisions,
  previousRevision,
}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("controller event must be a JSON object");
  }
  if (typeof event.eventId !== "string" || !event.eventId.trim()) {
    throw new Error("controller eventId must be a non-empty string");
  }
  if (typeof event.stateRevision !== "number"
    || !Number.isInteger(event.stateRevision)
    || event.stateRevision < 1) {
    throw new Error("controller event stateRevision must be a positive integer");
  }
  if (eventIds.has(event.eventId)) {
    throw new Error(`duplicate controller eventId: ${event.eventId}`);
  }
  if (revisions.has(event.stateRevision)) {
    throw new Error(`duplicate controller event revision: ${event.stateRevision}`);
  }
  if (previousRevision === null && event.stateRevision !== 1) {
    throw new Error(
      `controller event history must begin at revision 1, got ${event.stateRevision}`,
    );
  }
  if (previousRevision !== null && event.stateRevision !== previousRevision + 1) {
    throw new Error(
      `controller event revisions must be contiguous: expected ${previousRevision + 1}, got ${event.stateRevision}`,
    );
  }
}
