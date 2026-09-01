import { types } from "node:util";

import {
  createWakeflowDurableId,
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
  parseJsonValue,
  JsonValueError,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  createUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../../foundation/identity/uuid-v4.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  parseWindowWorkClaimId,
  WindowWorkClaimError,
  type WindowWorkClaimId,
} from "./window-work-claim.js";

/** Target Host Effect Claim 的被动请求、可注入选项与身份分配。 */

interface TargetHostEffectClaimRequestBase {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly intentDigest: Sha256Digest;
  readonly observation: Readonly<JsonValue>;
}

export interface ImplementationHostEffectClaimRequest extends TargetHostEffectClaimRequestBase {
  readonly workType: "implementation";
}

export interface TestHostEffectClaimRequest extends TargetHostEffectClaimRequestBase {
  readonly workType: "test";
  readonly testDispatchPacketDigest: Sha256Digest;
}

export type TargetHostEffectClaimRequest =
  ImplementationHostEffectClaimRequest | TestHostEffectClaimRequest;

export interface TargetHostEffectClaimOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface ParsedTargetHostEffectClaimOptions {
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly signal: AbortSignal | undefined;
}

export interface AllocatedTargetHostEffectClaimIds {
  readonly claimId: WindowWorkClaimId;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
}

export type TargetHostEffectClaimInputErrorReason =
  "input" | "identity" | "digest" | "aborted";

const ERROR_MESSAGES = {
  input: "Target Host Effect Claim input is invalid.",
  identity: "Target Host Effect Claim identity allocation failed.",
  digest: "Target Host Effect Claim contains an invalid digest.",
  aborted: "Target Host Effect Claim input was aborted.",
} as const satisfies Readonly<
  Record<TargetHostEffectClaimInputErrorReason, string>
>;

/** Claim 输入或身份分配失败时的稳定、脱敏错误。 */
export class TargetHostEffectClaimInputError extends Error {
  override readonly name = "TargetHostEffectClaimInputError";
  readonly code = "wakeflow-target-host-effect-claim-input" as const;
  readonly reason: TargetHostEffectClaimInputErrorReason;

  constructor(reason: TargetHostEffectClaimInputErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: TargetHostEffectClaimInputErrorReason): never {
  throw new TargetHostEffectClaimInputError(reason);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value ?? {}, "$input");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
}

function id<Kind extends "demand" | "target-task" | "target-delivery">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identity");
    throw error;
  }
}

export function parseTargetHostEffectClaimRequest(
  value: unknown,
): Readonly<TargetHostEffectClaimRequest> {
  const parsed = record(value);
  if (parsed.workType !== "implementation" && parsed.workType !== "test") {
    fail("input");
  }
  const expected = [
    "demandId",
    "intentDigest",
    "observation",
    "targetDeliveryId",
    "targetTaskId",
    ...(parsed.workType === "test" ? ["testDispatchPacketDigest"] : []),
    "workType",
  ];
  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    fail("input");
  }
  let intentDigest: Sha256Digest;
  let testDispatchPacketDigest: Sha256Digest | undefined;
  try {
    intentDigest = parseSha256Digest(parsed.intentDigest, "$/intentDigest");
    testDispatchPacketDigest =
      parsed.workType === "test"
        ? parseSha256Digest(
            parsed.testDispatchPacketDigest,
            "$/testDispatchPacketDigest",
          )
        : undefined;
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest");
    throw error;
  }
  let observation: JsonValue;
  try {
    observation = parseJsonValue(parsed.observation, "$/observation");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input");
    throw error;
  }
  const base = {
    demandId: id(parsed.demandId, "demand", "$/demandId"),
    targetTaskId: id(parsed.targetTaskId, "target-task", "$/targetTaskId"),
    targetDeliveryId: id(
      parsed.targetDeliveryId,
      "target-delivery",
      "$/targetDeliveryId",
    ),
    intentDigest,
    observation,
  } as const;
  return parsed.workType === "test"
    ? Object.freeze({
        ...base,
        workType: "test" as const,
        testDispatchPacketDigest: testDispatchPacketDigest!,
      })
    : Object.freeze({
        ...base,
        workType: "implementation" as const,
      });
}

export function parseTargetHostEffectClaimOptions(
  value: unknown,
): Readonly<ParsedTargetHostEffectClaimOptions> {
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
  if ((parsed.signal as AbortSignal | undefined)?.aborted === true) {
    fail("aborted");
  }
  return Object.freeze({
    clock: parsed.clock as UtcWallClock | undefined,
    uuidFactory: parsed.uuidFactory as UuidV4Factory | undefined,
    signal: parsed.signal as AbortSignal | undefined,
  });
}

export function allocateTargetHostEffectClaimIds(
  factory: UuidV4Factory | undefined,
): Readonly<AllocatedTargetHostEffectClaimIds> {
  const seen = new Set<string>();
  function uuid(): ReturnType<typeof createUuidV4> {
    try {
      const value = createUuidV4(factory);
      if (seen.has(value)) fail("identity");
      seen.add(value);
      return value;
    } catch (error: unknown) {
      if (error instanceof UuidV4Error) fail("identity");
      throw error;
    }
  }
  try {
    return Object.freeze({
      claimId: parseWindowWorkClaimId(`window_work_claim_${uuid()}`),
      eventId: createWakeflowDurableId("demand-event", uuid()),
      commitId: createWakeflowDurableId("demand-event-commit", uuid()),
    });
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) fail("identity");
    throw error;
  }
}
