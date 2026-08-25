import { deepEqual, equal, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  readMonotonicClock,
  systemMonotonicClock,
  MonotonicClockError,
  type MonotonicClock,
  type MonotonicClockErrorReason,
  type MonotonicMoment,
} from "../../../src/foundation/time/monotonic-clock.js";

function expectMonotonicClockError(
  action: () => unknown,
  reason: MonotonicClockErrorReason,
  expectedPath: string,
): MonotonicClockError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof MonotonicClockError)) {
    throw new Error("Expected MonotonicClockError.");
  }
  equal(caught.name, "MonotonicClockError");
  equal(caught.code, "wakeflow-monotonic-clock");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asMonotonicClock(value: unknown): MonotonicClock {
  return value as MonotonicClock;
}

test("system monotonic clock returns non-negative branded bigint moments", () => {
  const direct = systemMonotonicClock();
  const first: MonotonicMoment = readMonotonicClock();
  const second: MonotonicMoment = readMonotonicClock();

  equal(typeof direct, "bigint");
  equal(direct >= 0n, true);
  equal(first >= 0n, true);
  equal(second >= first, true);
});

test("injected monotonic clocks are called exactly once", () => {
  let calls = 0;
  const clock: MonotonicClock = () => {
    calls += 1;
    return 123_456_789n;
  };

  const moment: MonotonicMoment = readMonotonicClock(clock);
  equal(moment, 123_456_789n);
  equal(calls, 1);
});

test("monotonic readings are uncached and preserve exact bigint values", () => {
  const readings = [0n, 5n, 5n, 9n];
  let calls = 0;
  const clock: MonotonicClock = () => {
    const value = readings[calls];
    calls += 1;
    if (value === undefined) throw new Error("Unexpected extra clock read.");
    return value;
  };

  equal(readMonotonicClock(clock), 0n);
  equal(readMonotonicClock(clock), 5n);
  equal(readMonotonicClock(clock), 5n);
  equal(readMonotonicClock(clock), 9n);
  equal(calls, 4);
});

test("clock type, execution, and result failures are distinct and sanitized", () => {
  expectMonotonicClockError(
    () => readMonotonicClock(asMonotonicClock(null)),
    "clock-type",
    "$clock",
  );

  const privateFailure = new Error("private monotonic failure");
  const executionError = expectMonotonicClockError(
    () => readMonotonicClock(() => {
      throw privateFailure;
    }),
    "clock-failure",
    "$clock",
  );
  equal(executionError.message.includes(privateFailure.message), false);
  equal("cause" in executionError, false);

  for (const value of [1, -1n, "1", null]) {
    const resultError = expectMonotonicClockError(
      () => readMonotonicClock(asMonotonicClock(() => value)),
      "clock-result",
      "$clockResult",
    );
    equal(resultError.message.includes(String(value)), false);
  }
});

test("clock results are not coerced through executable object behavior", () => {
  let conversionCalls = 0;
  const executableResult = {
    valueOf() {
      conversionCalls += 1;
      return 1n;
    },
    toString() {
      conversionCalls += 1;
      return "1";
    },
  };

  expectMonotonicClockError(
    () => readMonotonicClock(asMonotonicClock(() => executableResult)),
    "clock-result",
    "$clockResult",
  );
  equal(conversionCalls, 0);
});

test("MonotonicMoment cannot be obtained from an unchecked bigint", () => {
  const raw: bigint = 10n;
  // @ts-expect-error 未经 clock boundary 的 bigint 不能直接获得 moment 品牌。
  const unchecked: MonotonicMoment = raw;
  equal(unchecked, raw);

  const checked: MonotonicMoment = readMonotonicClock(() => raw);
  equal(checked, raw);
});

test("monotonic moments are not JSON-serializable wall timestamps", () => {
  const moment = readMonotonicClock(() => 42n);
  throws(() => JSON.stringify({ moment }), TypeError);
});

test("monotonic-clock has one Node dependency and no wall-time coupling", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/foundation/time/monotonic-clock.ts"),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((entry) => entry[1]);

  deepEqual(imports, ["node:process"]);
  equal(source.includes("hrtime.bigint()"), true);
  equal(source.includes("Date.now"), false);
  equal(source.includes("new Date"), false);
  equal(source.includes("performance"), false);
  equal(source.includes('from "./utc-instant'), false);
  equal(source.includes("setTimeout"), false);
});
