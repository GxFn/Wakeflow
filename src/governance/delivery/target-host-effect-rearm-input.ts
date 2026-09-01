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
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  parseWindowWorkClaimId,
  WindowWorkClaimError,
  type WindowWorkClaimId,
} from "./window-work-claim.js";

/** Target Host Effect Rearm 的严格请求与可注入选项。 */

export interface TargetHostEffectRearmRequest {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly actionId: WindowWorkClaimId;
  readonly observationDigest: Sha256Digest;
}

export interface TargetHostEffectRearmOptions {
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
}

export interface ParsedTargetHostEffectRearmOptions {
  readonly clock: UtcWallClock | undefined;
  readonly signal: AbortSignal | undefined;
}

export type TargetHostEffectRearmInputErrorReason =
  "input" | "identity" | "digest" | "aborted";

const ERROR_MESSAGES = {
  input: "Target Host Effect Rearm input is invalid.",
  identity: "Target Host Effect Rearm contains an invalid identity.",
  digest: "Target Host Effect Rearm contains an invalid observation digest.",
  aborted: "Target Host Effect Rearm input was aborted.",
} as const satisfies Readonly<
  Record<TargetHostEffectRearmInputErrorReason, string>
>;

export class TargetHostEffectRearmInputError extends Error {
  override readonly name = "TargetHostEffectRearmInputError";
  readonly code = "wakeflow-target-host-effect-rearm-input" as const;
  readonly reason: TargetHostEffectRearmInputErrorReason;

  constructor(reason: TargetHostEffectRearmInputErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: TargetHostEffectRearmInputErrorReason): never {
  throw new TargetHostEffectRearmInputError(reason);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value ?? {}, "$input");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
}

function demandId(value: unknown): WakeflowDurableId<"demand"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identity");
    throw error;
  }
}

export function parseTargetHostEffectRearmRequest(
  value: unknown,
): Readonly<TargetHostEffectRearmRequest> {
  const parsed = record(value);
  const expected = ["actionId", "demandId", "observationDigest"];
  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    fail("input");
  }
  let actionId: WindowWorkClaimId;
  try {
    actionId = parseWindowWorkClaimId(parsed.actionId);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) fail("identity");
    throw error;
  }
  let observationDigest: Sha256Digest;
  try {
    observationDigest = parseSha256Digest(parsed.observationDigest);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest");
    throw error;
  }
  return Object.freeze({
    demandId: demandId(parsed.demandId),
    actionId,
    observationDigest,
  });
}

export function parseTargetHostEffectRearmOptions(
  value: unknown,
): Readonly<ParsedTargetHostEffectRearmOptions> {
  const parsed = record(value);
  if (
    Object.keys(parsed).some((key) => key !== "clock" && key !== "signal") ||
    (parsed.clock !== undefined &&
      (typeof parsed.clock !== "function" || types.isProxy(parsed.clock))) ||
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
    signal,
  });
}
