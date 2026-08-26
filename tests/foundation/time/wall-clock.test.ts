import { equal, match } from "node:assert/strict";
import { test } from "node:test";

import {
  readUtcWallClock,
  systemUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
  type UtcWallClockErrorReason,
} from "../../../src/foundation/time/wall-clock.js";
import {
  compareUtcInstants,
  parseUtcInstant,
  type UtcInstant,
} from "../../../src/foundation/time/utc-instant.js";

function expectUtcWallClockError(
  action: () => unknown,
  reason: UtcWallClockErrorReason,
  expectedPath: string,
): UtcWallClockError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof UtcWallClockError)) {
    throw new Error("Expected UtcWallClockError.");
  }
  equal(caught.name, "UtcWallClockError");
  equal(caught.code, "wakeflow-utc-wall-clock");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asUtcWallClock(value: unknown): UtcWallClock {
  return value as UtcWallClock;
}

test("system wall clock returns a branded three-digit UTC instant", () => {
  const direct: UtcInstant = systemUtcWallClock();
  const guarded: UtcInstant = readUtcWallClock();

  equal(parseUtcInstant(direct), direct);
  equal(parseUtcInstant(guarded), guarded);
  match(direct, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u);
  match(guarded, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u);
});

test("injected wall clocks are called exactly once and retain their precision", () => {
  const expected = parseUtcInstant("2026-08-25T10:20:30.123456789Z");
  let calls = 0;
  const clock: UtcWallClock = () => {
    calls += 1;
    return expected;
  };

  equal(readUtcWallClock(clock), expected);
  equal(calls, 1);
});

test("wall clock readings are uncached and may move backwards", () => {
  const later = parseUtcInstant("2026-08-25T10:20:31.000Z");
  const earlier = parseUtcInstant("2026-08-25T10:20:30.000Z");
  const readings = [later, earlier];
  let calls = 0;
  const clock: UtcWallClock = () => {
    const value = readings[calls];
    calls += 1;
    if (value === undefined) throw new Error("Unexpected extra clock read.");
    return value;
  };

  const first = readUtcWallClock(clock);
  const second = readUtcWallClock(clock);
  equal(first, later);
  equal(second, earlier);
  equal(compareUtcInstants(first, second), 1);
  equal(calls, 2);
});

test("clock type, execution, and result failures are distinct and sanitized", () => {
  expectUtcWallClockError(
    () => readUtcWallClock(asUtcWallClock(null)),
    "clock-type",
    "$clock",
  );

  const privateFailure = new Error("private clock failure");
  const executionError = expectUtcWallClockError(
    () => readUtcWallClock(() => {
      throw privateFailure;
    }),
    "clock-failure",
    "$clock",
  );
  equal(executionError.message.includes(privateFailure.message), false);
  equal("cause" in executionError, false);

  const resultError = expectUtcWallClockError(
    () => readUtcWallClock(asUtcWallClock(() => "private-invalid-time")),
    "clock-result",
    "$clockResult",
  );
  equal(resultError.message.includes("private-invalid-time"), false);
  equal("cause" in resultError, false);
});

test("clock results are not coerced through executable object behavior", () => {
  let conversionCalls = 0;
  const executableResult = {
    toString() {
      conversionCalls += 1;
      return "2026-08-25T10:20:30.000Z";
    },
  };

  expectUtcWallClockError(
    () => readUtcWallClock(asUtcWallClock(() => executableResult)),
    "clock-result",
    "$clockResult",
  );
  equal(conversionCalls, 0);
});

test("UtcWallClock requires branded results at compile time", () => {
  const accepted: UtcWallClock = () => (
    parseUtcInstant("2026-08-25T10:20:30.000Z")
  );
  equal(readUtcWallClock(accepted), "2026-08-25T10:20:30.000Z");

  // @ts-expect-error 普通 string 结果不能充当 UtcWallClock 合同。
  const unchecked: UtcWallClock = () => "2026-08-25T10:20:30.000Z";
  equal(typeof unchecked, "function");
});
