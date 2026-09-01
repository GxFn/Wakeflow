import { types } from "node:util";

import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type { UuidV4Factory } from "../../foundation/identity/uuid-v4.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  parseDemandEventStreamRevision,
  DemandEventStreamPositionError,
  type DemandEventStreamRevision,
} from "../demand/event-sourcing/demand-event-stream-position.js";

/** Controller Target Review Resume Service的严格请求与可注入选项。 */

export interface ControllerTargetReviewResumeRequest {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly expectedBlockedState: Readonly<{
    readonly streamRevision: DemandEventStreamRevision;
    readonly stateDigest: Sha256Digest;
  }>;
  readonly resolutionSummary: string;
}

export interface ControllerTargetReviewResumeOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface ParsedControllerTargetReviewResumeOptions {
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly signal: AbortSignal | undefined;
}

export type ControllerTargetReviewResumeInputErrorReason =
  "input" | "identity" | "position" | "digest" | "text" | "aborted";

const ERROR_MESSAGES = {
  input: "Controller Target Review Resume input is invalid.",
  identity:
    "Controller Target Review Resume input contains an invalid identity.",
  position:
    "Controller Target Review Resume input contains an invalid Event Stream position.",
  digest: "Controller Target Review Resume input contains an invalid digest.",
  text: "Controller Target Review Resume input contains invalid resolution text.",
  aborted: "Controller Target Review Resume input was aborted.",
} as const satisfies Readonly<
  Record<ControllerTargetReviewResumeInputErrorReason, string>
>;

export class ControllerTargetReviewResumeInputError extends Error {
  override readonly name = "ControllerTargetReviewResumeInputError";
  readonly code = "wakeflow-controller-target-review-resume-input" as const;
  readonly reason: ControllerTargetReviewResumeInputErrorReason;

  constructor(reason: ControllerTargetReviewResumeInputErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

const REQUEST_FIELDS = Object.freeze([
  "demandId",
  "expectedBlockedState",
  "resolutionSummary",
  "targetTaskId",
] as const);
const EXPECTED_BLOCKED_STATE_FIELDS = Object.freeze([
  "stateDigest",
  "streamRevision",
] as const);
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

function fail(reason: ControllerTargetReviewResumeInputErrorReason): never {
  throw new ControllerTargetReviewResumeInputError(reason);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value ?? {}, "$input");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
}

function id<Kind extends "demand" | "target-task">(
  value: unknown,
  kind: Kind,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identity");
    throw error;
  }
}

function parseExpectedBlockedState(
  value: unknown,
): ControllerTargetReviewResumeRequest["expectedBlockedState"] {
  let parsed: Readonly<Record<string, unknown>>;
  try {
    parsed = parsePlainRecord(value, "$input.expectedBlockedState");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== EXPECTED_BLOCKED_STATE_FIELDS.length ||
    keys.some((key, index) => key !== EXPECTED_BLOCKED_STATE_FIELDS[index])
  ) {
    fail("input");
  }
  let streamRevision: DemandEventStreamRevision;
  try {
    streamRevision = parseDemandEventStreamRevision(parsed.streamRevision);
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) fail("position");
    throw error;
  }
  return Object.freeze({
    streamRevision,
    stateDigest: digest(parsed.stateDigest),
  });
}

function digest(value: unknown): Sha256Digest {
  try {
    return parseSha256Digest(value);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest");
    throw error;
  }
}

function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8192 ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text");
  }
  return value;
}

export function parseControllerTargetReviewResumeRequest(
  value: unknown,
): Readonly<ControllerTargetReviewResumeRequest> {
  const parsed = record(value);
  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== REQUEST_FIELDS.length ||
    keys.some((key, index) => key !== REQUEST_FIELDS[index])
  ) {
    fail("input");
  }
  return Object.freeze({
    demandId: id(parsed.demandId, "demand"),
    targetTaskId: id(parsed.targetTaskId, "target-task"),
    expectedBlockedState: parseExpectedBlockedState(
      parsed.expectedBlockedState,
    ),
    resolutionSummary: text(parsed.resolutionSummary),
  });
}

export function parseControllerTargetReviewResumeOptions(
  value: unknown,
): Readonly<ParsedControllerTargetReviewResumeOptions> {
  const parsed = record(value);
  if (
    Object.keys(parsed).some(
      (key) => key !== "clock" && key !== "signal" && key !== "uuidFactory",
    ) ||
    (parsed.clock !== undefined &&
      (typeof parsed.clock !== "function" || types.isProxy(parsed.clock))) ||
    (parsed.uuidFactory !== undefined &&
      (typeof parsed.uuidFactory !== "function" ||
        types.isProxy(parsed.uuidFactory))) ||
    (parsed.signal !== undefined &&
      (typeof parsed.signal !== "object" ||
        parsed.signal === null ||
        types.isProxy(parsed.signal) ||
        !(parsed.signal instanceof AbortSignal)))
  ) {
    fail("input");
  }
  const signal = parsed.signal as AbortSignal | undefined;
  if (signal?.aborted === true) fail("aborted");
  return Object.freeze({
    clock: parsed.clock as UtcWallClock | undefined,
    uuidFactory: parsed.uuidFactory as UuidV4Factory | undefined,
    signal,
  });
}
