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

/** Test Delivery Preparation的无文件副作用输入准入与身份分配。 */

export interface TestDeliveryPreparationPreviewRequest {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
}

export interface TestDeliveryPreparationPreviewOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface TestDeliveryPreparationApplyOptions {
  readonly signal?: AbortSignal;
}

export interface ParsedTestDeliveryPreparationPreviewOptions {
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly signal: AbortSignal | undefined;
}

export interface AllocatedInitialTestDeliveryPreparationIds {
  readonly testAttemptId: WakeflowDurableId<"test-attempt">;
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
}

export interface AllocatedReplacementTestDeliveryPreparationIds {
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
}

export type AllocatedRerunTestDeliveryPreparationIds =
  AllocatedInitialTestDeliveryPreparationIds;

export type TestDeliveryPreparationInputErrorReason =
  "input" | "identity" | "aborted";

const ERROR_MESSAGES = {
  input: "Test Delivery Preparation input is invalid.",
  identity: "Test Delivery Preparation identity allocation failed.",
  aborted: "Test Delivery Preparation input was aborted.",
} as const satisfies Readonly<
  Record<TestDeliveryPreparationInputErrorReason, string>
>;

export class TestDeliveryPreparationInputError extends Error {
  override readonly name = "TestDeliveryPreparationInputError";
  readonly code = "wakeflow-test-delivery-preparation-input" as const;
  readonly reason: TestDeliveryPreparationInputErrorReason;

  constructor(reason: TestDeliveryPreparationInputErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: TestDeliveryPreparationInputErrorReason): never {
  throw new TestDeliveryPreparationInputError(reason);
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

export function parseTestDeliveryPreparationPreviewRequest(
  value: unknown,
): Readonly<TestDeliveryPreparationPreviewRequest> {
  const parsed = record(value);
  const expected = ["demandId", "targetTaskId"];
  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
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
    if (error instanceof WakeflowDurableIdError) fail("identity");
    throw error;
  }
}

export function parseTestDeliveryPreparationPreviewOptions(
  value: unknown,
): Readonly<ParsedTestDeliveryPreparationPreviewOptions> {
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

export function parseTestDeliveryPreparationApplyOptions(
  value: unknown,
): Readonly<{ readonly signal: AbortSignal | undefined }> {
  const parsed = record(value);
  if (Object.keys(parsed).some((key) => key !== "signal")) fail("input");
  return Object.freeze({ signal: parseSignal(parsed.signal) });
}

export function assertTestDeliveryPreparationNotAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted === true) fail("aborted");
}

function identityAllocator(
  factory: UuidV4Factory | undefined,
): <
  Kind extends
    "test-attempt" | "target-delivery" | "demand-event" | "demand-event-commit",
>(
  kind: Kind,
) => WakeflowDurableId<Kind> {
  const seen = new Set<string>();
  return function allocate<
    Kind extends
      | "test-attempt"
      | "target-delivery"
      | "demand-event"
      | "demand-event-commit",
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
  };
}

/** Initial授权同时分配logical attempt；替代授权不得调用此函数。 */
export function allocateInitialTestDeliveryPreparationIds(
  factory: UuidV4Factory | undefined,
): Readonly<AllocatedInitialTestDeliveryPreparationIds> {
  const allocate = identityAllocator(factory);
  return Object.freeze({
    testAttemptId: allocate("test-attempt"),
    targetDeliveryId: allocate("target-delivery"),
    eventId: allocate("demand-event"),
    commitId: allocate("demand-event-commit"),
  });
}

/** Rerun与initial一样创建新logical attempt和首份Delivery授权。 */
export function allocateRerunTestDeliveryPreparationIds(
  factory: UuidV4Factory | undefined,
): Readonly<AllocatedRerunTestDeliveryPreparationIds> {
  return allocateInitialTestDeliveryPreparationIds(factory);
}

/** 替代授权只分配新的Delivery与Event身份，继续沿用既有logical attempt。 */
export function allocateReplacementTestDeliveryPreparationIds(
  factory: UuidV4Factory | undefined,
): Readonly<AllocatedReplacementTestDeliveryPreparationIds> {
  const allocate = identityAllocator(factory);
  return Object.freeze({
    targetDeliveryId: allocate("target-delivery"),
    eventId: allocate("demand-event"),
    commitId: allocate("demand-event-commit"),
  });
}
