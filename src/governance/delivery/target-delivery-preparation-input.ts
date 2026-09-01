import { types } from "node:util";

import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
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

/** Target Delivery Preparation的无文件副作用输入准入与身份分配。 */

export interface TargetDeliveryPreparationPreviewRequest {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
}

export interface TargetDeliveryPreparationPreviewOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface TargetDeliveryPreparationApplyOptions {
  readonly signal?: AbortSignal;
}

export interface ParsedTargetDeliveryPreparationPreviewOptions {
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly signal: AbortSignal | undefined;
}

export interface AllocatedTargetDeliveryPreparationIds {
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
}

export type TargetDeliveryPreparationInputErrorReason =
  "input" | "identity" | "aborted";

const ERROR_MESSAGES = {
  input: "Target Delivery Preparation input is invalid.",
  identity: "Target Delivery Preparation identity allocation failed.",
  aborted: "Target Delivery Preparation input was aborted.",
} as const satisfies Readonly<
  Record<TargetDeliveryPreparationInputErrorReason, string>
>;

/** Preparation输入、注入依赖或身份分配失败时的稳定错误。 */
export class TargetDeliveryPreparationInputError extends Error {
  override readonly name = "TargetDeliveryPreparationInputError";
  readonly code = "wakeflow-target-delivery-preparation-input" as const;
  readonly reason: TargetDeliveryPreparationInputErrorReason;

  constructor(reason: TargetDeliveryPreparationInputErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: TargetDeliveryPreparationInputErrorReason): never {
  throw new TargetDeliveryPreparationInputError(reason);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value ?? {}, "$input");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
}

function parseSignal(value: unknown): AbortSignal | undefined {
  if (
    value !== undefined &&
    (typeof value !== "object" ||
      value === null ||
      types.isProxy(value) ||
      !(value instanceof AbortSignal))
  ) {
    fail("input");
  }
  return value as AbortSignal | undefined;
}

export function parseTargetDeliveryPreparationPreviewRequest(
  value: unknown,
): Readonly<TargetDeliveryPreparationPreviewRequest> {
  const parsed = record(value);
  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "demandId" ||
    keys[1] !== "targetTaskId"
  ) {
    fail("input");
  }
  try {
    return Object.freeze({
      demandId: parseWakeflowDurableIdOfKind(
        parsed.demandId,
        "demand",
        "$/demandId",
      ),
      targetTaskId: parseWakeflowDurableIdOfKind(
        parsed.targetTaskId,
        "target-task",
        "$/targetTaskId",
      ),
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input");
    throw error;
  }
}

export function parseTargetDeliveryPreparationPreviewOptions(
  value: unknown,
): Readonly<ParsedTargetDeliveryPreparationPreviewOptions> {
  const parsed = record(value);
  if (
    Object.keys(parsed).some(
      (key) => key !== "clock" && key !== "signal" && key !== "uuidFactory",
    ) ||
    (parsed.clock !== undefined &&
      (typeof parsed.clock !== "function" || types.isProxy(parsed.clock))) ||
    (parsed.uuidFactory !== undefined &&
      (typeof parsed.uuidFactory !== "function" ||
        types.isProxy(parsed.uuidFactory)))
  ) {
    fail("input");
  }
  return Object.freeze({
    clock: parsed.clock as UtcWallClock | undefined,
    uuidFactory: parsed.uuidFactory as UuidV4Factory | undefined,
    signal: parseSignal(parsed.signal),
  });
}

export function parseTargetDeliveryPreparationApplyOptions(
  value: unknown,
): Readonly<{ readonly signal: AbortSignal | undefined }> {
  const parsed = record(value);
  if (Object.keys(parsed).some((key) => key !== "signal")) fail("input");
  return Object.freeze({ signal: parseSignal(parsed.signal) });
}

export function assertTargetDeliveryPreparationNotAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted === true) fail("aborted");
}

export function allocateTargetDeliveryPreparationIds(
  factory: UuidV4Factory | undefined,
): Readonly<AllocatedTargetDeliveryPreparationIds> {
  const seen = new Set<string>();
  function allocate<
    Kind extends "target-delivery" | "demand-event" | "demand-event-commit",
  >(kind: Kind): WakeflowDurableId<Kind> {
    let uuid;
    try {
      uuid = createUuidV4(factory);
    } catch (error: unknown) {
      if (error instanceof UuidV4Error) fail("identity");
      throw error;
    }
    if (seen.has(uuid)) fail("identity");
    seen.add(uuid);
    return createWakeflowDurableId(kind, uuid);
  }
  return Object.freeze({
    targetDeliveryId: allocate("target-delivery"),
    eventId: allocate("demand-event"),
    commitId: allocate("demand-event-commit"),
  });
}
