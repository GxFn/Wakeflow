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
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import type { TargetDeliveryHostEffectAttemptStatus } from "./target-delivery-host-effect-observation.js";
import {
  parseWindowWorkClaimId,
  WindowWorkClaimError,
  type WindowWorkClaimId,
} from "./window-work-claim.js";

/** Target Host Effect Outcome 的被动请求与可取消选项。 */

export interface TargetHostEffectOutcomeRequest {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly actionId: WindowWorkClaimId;
  readonly claimDigest: Sha256Digest;
  readonly attempt: Readonly<{
    readonly status: TargetDeliveryHostEffectAttemptStatus;
    readonly evidence: JsonValue;
  }>;
  readonly readback:
    | Readonly<{ readonly status: "unavailable" }>
    | Readonly<{
        readonly status: "confirmed" | "pending";
        readonly evidence: JsonValue;
      }>;
  readonly observedAt: UtcInstant;
}

export interface TargetHostEffectOutcomeOptions {
  readonly signal?: AbortSignal;
}

export interface ParsedTargetHostEffectOutcomeOptions {
  readonly signal: AbortSignal | undefined;
}

export type TargetHostEffectOutcomeInputErrorReason =
  "input" | "identity" | "digest" | "time" | "aborted";

const ERROR_MESSAGES = {
  input: "Target Host Effect Outcome input is invalid.",
  identity: "Target Host Effect Outcome contains an invalid identity.",
  digest: "Target Host Effect Outcome contains an invalid digest.",
  time: "Target Host Effect Outcome contains an invalid time.",
  aborted: "Target Host Effect Outcome input was aborted.",
} as const satisfies Readonly<
  Record<TargetHostEffectOutcomeInputErrorReason, string>
>;

/** Outcome 输入准入失败时的稳定、脱敏错误。 */
export class TargetHostEffectOutcomeInputError extends Error {
  override readonly name = "TargetHostEffectOutcomeInputError";
  readonly code = "wakeflow-target-host-effect-outcome-input" as const;
  readonly reason: TargetHostEffectOutcomeInputErrorReason;

  constructor(reason: TargetHostEffectOutcomeInputErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: TargetHostEffectOutcomeInputErrorReason): never {
  throw new TargetHostEffectOutcomeInputError(reason);
}

function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  const parsed = record(value, path);
  const keys = Object.keys(parsed).sort();
  const expected = [...fields].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    fail("input");
  }
  return parsed;
}

function demandId(value: unknown, path: string): WakeflowDurableId<"demand"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand", path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identity");
    throw error;
  }
}

function evidence(value: unknown, path: string): JsonValue {
  try {
    return parseJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input");
    throw error;
  }
}

export function parseTargetHostEffectOutcomeRequest(
  value: unknown,
): Readonly<TargetHostEffectOutcomeRequest> {
  const parsed = exactRecord(
    value,
    [
      "actionId",
      "attempt",
      "claimDigest",
      "demandId",
      "observedAt",
      "readback",
    ],
    "$request",
  );
  let actionId: WindowWorkClaimId;
  try {
    actionId = parseWindowWorkClaimId(parsed.actionId, "$/actionId");
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) fail("identity");
    throw error;
  }
  let claimDigest: Sha256Digest;
  try {
    claimDigest = parseSha256Digest(parsed.claimDigest, "$/claimDigest");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest");
    throw error;
  }
  const attempt = exactRecord(
    parsed.attempt,
    ["evidence", "status"],
    "$/attempt",
  );
  if (
    attempt.status !== "accepted" &&
    attempt.status !== "indeterminate" &&
    attempt.status !== "rejected-before-effect"
  ) {
    fail("input");
  }
  const readbackValue = record(parsed.readback, "$/readback");
  const readback =
    readbackValue.status === "unavailable"
      ? (() => {
          exactRecord(readbackValue, ["status"], "$/readback");
          return Object.freeze({ status: "unavailable" as const });
        })()
      : (() => {
          const observed = exactRecord(
            readbackValue,
            ["evidence", "status"],
            "$/readback",
          );
          if (
            observed.status !== "confirmed" &&
            observed.status !== "pending"
          ) {
            fail("input");
          }
          return Object.freeze({
            status: observed.status,
            evidence: evidence(observed.evidence, "$/readback/evidence"),
          });
        })();
  let observedAt: UtcInstant;
  try {
    observedAt = parseUtcInstant(parsed.observedAt, "$/observedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time");
    throw error;
  }
  return Object.freeze({
    demandId: demandId(parsed.demandId, "$/demandId"),
    actionId,
    claimDigest,
    attempt: Object.freeze({
      status: attempt.status,
      evidence: evidence(attempt.evidence, "$/attempt/evidence"),
    }),
    readback,
    observedAt,
  });
}

export function parseTargetHostEffectOutcomeOptions(
  value: unknown,
): Readonly<ParsedTargetHostEffectOutcomeOptions> {
  const parsed = record(value ?? {}, "$options");
  if (
    Object.keys(parsed).some((key) => key !== "signal") ||
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
  return Object.freeze({ signal });
}
