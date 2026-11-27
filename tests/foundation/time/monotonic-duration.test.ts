import { equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { readMonotonicClock } from "../../../src/foundation/time/monotonic-clock.js";
import {
  type MonotonicDuration,
  MonotonicDurationError,
  type MonotonicDurationErrorReason,
  monotonicDurationFromMilliseconds,
} from "../../../src/foundation/time/monotonic-duration.js";

function expectMonotonicDurationError(
  action: () => unknown,
  reason: MonotonicDurationErrorReason,
  expectedPath: string,
): MonotonicDurationError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof MonotonicDurationError)) {
    throw new Error("Expected MonotonicDurationError.");
  }
  equal(caught.name, "MonotonicDurationError");
  equal(caught.code, "wakeflow-monotonic-duration");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asMilliseconds(value: unknown): number {
  return value as number;
}

test("non-negative safe integer milliseconds convert without loss", () => {
  const cases = [
    [0, 0n],
    [1, 1_000_000n],
    [5_000, 5_000_000_000n],
    [300_000, 300_000_000_000n],
    [Number.MAX_SAFE_INTEGER, BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n],
  ] as const;

  for (const [milliseconds, expected] of cases) {
    const duration: MonotonicDuration = monotonicDurationFromMilliseconds(milliseconds);
    equal(duration, expected);
  }
});

test("millisecond conversion rejects negative, fractional, and unsafe values", () => {
  const invalid: readonly unknown[] = [
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "1",
    null,
  ];

  for (const value of invalid) {
    expectMonotonicDurationError(
      () => monotonicDurationFromMilliseconds(asMilliseconds(value)),
      "milliseconds",
      "$milliseconds",
    );
  }
});

test("MonotonicDuration is distinct from raw bigint and MonotonicMoment", () => {
  const raw: bigint = 10n;
  const moment = readMonotonicClock(() => raw);

  // @ts-expect-error 未经转换的 bigint 不能直接获得 duration 品牌。
  const uncheckedRaw: MonotonicDuration = raw;
  // @ts-expect-error moment 与 duration 使用不同品牌，不能相互赋值。
  const uncheckedMoment: MonotonicDuration = moment;
  equal(uncheckedRaw, raw);
  equal(uncheckedMoment, moment);

  const checked: MonotonicDuration = monotonicDurationFromMilliseconds(0);
  equal(checked, 0n);
});

test("monotonic durations remain outside JSON and wire contracts", () => {
  const duration = monotonicDurationFromMilliseconds(1);
  throws(() => JSON.stringify({ duration }), TypeError);
});
