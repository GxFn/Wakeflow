import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  monotonicDurationBetween,
  monotonicDurationFromMilliseconds,
  MonotonicDurationError,
  type MonotonicDuration,
  type MonotonicDurationErrorReason,
} from "../../../src/foundation/time/monotonic-duration.js";
import {
  readMonotonicClock,
  type MonotonicMoment,
} from "../../../src/foundation/time/monotonic-clock.js";

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

function asMonotonicMoment(value: unknown): MonotonicMoment {
  return value as MonotonicMoment;
}

function asMilliseconds(value: unknown): number {
  return value as number;
}

test("duration between ordered moments preserves exact nanoseconds", () => {
  const cases = [
    [0n, 0n, 0n],
    [0n, 1n, 1n],
    [10n, 15n, 5n],
    [1_000_000_000n, 1_000_000_001n, 1n],
  ] as const;

  for (const [startValue, endValue, expected] of cases) {
    const start = readMonotonicClock(() => startValue);
    const end = readMonotonicClock(() => endValue);
    const duration: MonotonicDuration = monotonicDurationBetween(start, end);
    equal(duration, expected);
  }
});

test("non-negative safe integer milliseconds convert without loss", () => {
  const cases = [
    [0, 0n],
    [1, 1_000_000n],
    [5_000, 5_000_000_000n],
    [300_000, 300_000_000_000n],
    [Number.MAX_SAFE_INTEGER, BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n],
  ] as const;

  for (const [milliseconds, expected] of cases) {
    const duration: MonotonicDuration =
      monotonicDurationFromMilliseconds(milliseconds);
    equal(duration, expected);
  }
});

test("moment inputs are revalidated despite their compile-time brand", () => {
  for (const [value, pathValue] of [
    [-1n, "$start"],
    [1, "$start"],
    [null, "$start"],
  ] as const) {
    expectMonotonicDurationError(
      () => monotonicDurationBetween(
        asMonotonicMoment(value),
        readMonotonicClock(() => 10n),
      ),
      "moment-type",
      pathValue,
    );
  }

  expectMonotonicDurationError(
    () => monotonicDurationBetween(
      readMonotonicClock(() => 0n),
      asMonotonicMoment(-1n),
    ),
    "moment-type",
    "$end",
  );
});

test("an end moment before start is rejected as an ordering error", () => {
  const start = readMonotonicClock(() => 11n);
  const end = readMonotonicClock(() => 10n);
  const error = expectMonotonicDurationError(
    () => monotonicDurationBetween(start, end),
    "moment-order",
    "$end",
  );

  equal(error.message.includes("11"), false);
  equal(error.message.includes("10"), false);
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

  const checked: MonotonicDuration = monotonicDurationBetween(moment, moment);
  equal(checked, 0n);
});

test("monotonic durations remain outside JSON and wire contracts", () => {
  const duration = monotonicDurationFromMilliseconds(1);
  throws(() => JSON.stringify({ duration }), TypeError);
});
