import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  compareUtcInstants,
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
  type UtcInstantErrorReason,
} from "../../../src/foundation/time/utc-instant.js";

function expectUtcInstantError(
  action: () => unknown,
  reason: UtcInstantErrorReason,
  expectedPath: string,
): UtcInstantError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof UtcInstantError)) {
    throw new Error("Expected UtcInstantError.");
  }
  equal(caught.name, "UtcInstantError");
  equal(caught.code, "wakeflow-utc-instant");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asUtcInstant(value: unknown): UtcInstant {
  return value as UtcInstant;
}

test("strict UTC texts preserve their original precision and receive a brand", () => {
  const values = [
    "0000-01-01T00:00:00Z",
    "1970-01-01T00:00:00Z",
    "2000-02-29T12:34:56.1Z",
    "2028-02-29T23:59:59.123Z",
    "2028-02-29T23:59:59.123456789Z",
    "9999-12-31T23:59:59.999999999Z",
  ] as const;

  for (const value of values) {
    const instant: UtcInstant = parseUtcInstant(value);
    equal(instant, value);
  }

  const uncheckedText: string = values[1];
  // @ts-expect-error 未经解析的普通 string 不能直接获得 UtcInstant 品牌。
  const uncheckedInstant: UtcInstant = uncheckedText;
  equal(uncheckedInstant, uncheckedText);
});

test("lexical parsing rejects aliases, offsets, leap seconds, and non-strings", () => {
  const invalid: readonly unknown[] = [
    null,
    1,
    {},
    "2026-08-25t10:20:30Z",
    "2026-08-25T10:20:30z",
    "2026-08-25 10:20:30Z",
    "2026-08-25T10:20:30+00:00",
    "2026-08-25T10:20:30.123+00:00",
    "2026-08-25T24:00:00Z",
    "2026-08-25T10:60:00Z",
    "2026-08-25T10:20:60Z",
    "2026-00-25T10:20:30Z",
    "2026-13-25T10:20:30Z",
    "2026-08-00T10:20:30Z",
    "2026-08-32T10:20:30Z",
    "2026-08-25T10:20:30.Z",
    "2026-08-25T10:20:30.1234567890Z",
    "+2026-08-25T10:20:30Z",
    " 2026-08-25T10:20:30Z",
    "2026-08-25T10:20:30Z\n",
  ];

  for (const value of invalid) {
    expectUtcInstantError(
      () => parseUtcInstant(value, "$.createdAt"),
      "format",
      "$.createdAt",
    );
  }
});

test("calendar parsing rejects Date rollover while preserving Gregorian leap years", () => {
  for (const value of [
    "1900-02-29T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-04-31T00:00:00Z",
  ]) {
    expectUtcInstantError(
      () => parseUtcInstant(value, "$.observedAt"),
      "calendar",
      "$.observedAt",
    );
  }

  equal(parseUtcInstant("2000-02-29T00:00:00Z"), "2000-02-29T00:00:00Z");
  equal(parseUtcInstant("2028-02-29T00:00:00Z"), "2028-02-29T00:00:00Z");
});

test("comparison uses the nanosecond timeline rather than lexical text", () => {
  const beforeEpoch = parseUtcInstant("1969-12-31T23:59:59.999999999Z");
  const epoch = parseUtcInstant("1970-01-01T00:00:00Z");
  const afterEpoch = parseUtcInstant("1970-01-01T00:00:00.000000001Z");
  const whole = parseUtcInstant("2026-08-25T10:20:30Z");
  const zeroFraction = parseUtcInstant("2026-08-25T10:20:30.000000000Z");
  const shortFraction = parseUtcInstant("2026-08-25T10:20:30.1Z");
  const longFraction = parseUtcInstant("2026-08-25T10:20:30.100000000Z");
  const nextNanosecond = parseUtcInstant("2026-08-25T10:20:30.100000001Z");

  equal(compareUtcInstants(beforeEpoch, epoch), -1);
  equal(compareUtcInstants(epoch, afterEpoch), -1);
  equal(compareUtcInstants(beforeEpoch, afterEpoch), -1);
  equal(compareUtcInstants(whole, zeroFraction), 0);
  equal(compareUtcInstants(shortFraction, longFraction), 0);
  equal(compareUtcInstants(whole, shortFraction), -1);
  equal(compareUtcInstants(nextNanosecond, longFraction), 1);
});

test("branded comparison still revalidates both runtime values", () => {
  expectUtcInstantError(
    () => compareUtcInstants(
      asUtcInstant("2026-02-30T00:00:00Z"),
      parseUtcInstant("2026-08-25T10:20:30Z"),
    ),
    "calendar",
    "$left",
  );
  expectUtcInstantError(
    () => compareUtcInstants(
      asUtcInstant("not-an-instant"),
      parseUtcInstant("2026-08-25T10:20:30Z"),
    ),
    "format",
    "$left",
  );
  expectUtcInstantError(
    () => compareUtcInstants(
      parseUtcInstant("2026-08-25T10:20:30Z"),
      asUtcInstant("not-an-instant"),
    ),
    "format",
    "$right",
  );
});

test("parsing is non-coercive and errors do not disclose rejected text", () => {
  let conversionCalls = 0;
  const executableValue = {
    toString() {
      conversionCalls += 1;
      return "2026-08-25T10:20:30Z";
    },
  };
  const rejected = "private-invalid-instant";
  expectUtcInstantError(
    () => parseUtcInstant(executableValue, "$.time"),
    "format",
    "$.time",
  );
  const error = expectUtcInstantError(
    () => parseUtcInstant(rejected, ""),
    "format",
    "$",
  );

  equal(conversionCalls, 0);
  equal(error.message.includes(rejected), false);
  equal("cause" in error, false);
});
