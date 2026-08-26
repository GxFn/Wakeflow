import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  isMonotonicDeadlineReached,
  monotonicDeadlineAfter,
  monotonicDeadlineRemaining,
  MonotonicDeadlineError,
  type MonotonicDeadline,
  type MonotonicDeadlineErrorReason,
} from "../../../src/foundation/time/monotonic-deadline.js";
import {
  readMonotonicClock,
  type MonotonicMoment,
} from "../../../src/foundation/time/monotonic-clock.js";
import {
  monotonicDurationFromMilliseconds,
  type MonotonicDuration,
} from "../../../src/foundation/time/monotonic-duration.js";

function expectMonotonicDeadlineError(
  action: () => unknown,
  reason: MonotonicDeadlineErrorReason,
  expectedPath: string,
): MonotonicDeadlineError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof MonotonicDeadlineError)) {
    throw new Error("Expected MonotonicDeadlineError.");
  }
  equal(caught.name, "MonotonicDeadlineError");
  equal(caught.code, "wakeflow-monotonic-deadline");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asMonotonicMoment(value: unknown): MonotonicMoment {
  return value as MonotonicMoment;
}

function asMonotonicDuration(value: unknown): MonotonicDuration {
  return value as MonotonicDuration;
}

function asMonotonicDeadline(value: unknown): MonotonicDeadline {
  return value as MonotonicDeadline;
}

test("deadline construction adds exact moment and duration nanoseconds", () => {
  const start = readMonotonicClock(() => 1_000_000_000n);
  const duration = monotonicDurationFromMilliseconds(5_000);
  const deadline: MonotonicDeadline = monotonicDeadlineAfter(start, duration);

  equal(deadline, 6_000_000_000n);
});

test("zero duration produces a deadline reached at the start moment", () => {
  const start = readMonotonicClock(() => 42n);
  const zero = monotonicDurationFromMilliseconds(0);
  const deadline = monotonicDeadlineAfter(start, zero);

  equal(deadline, 42n);
  equal(isMonotonicDeadlineReached(deadline, start), true);
  equal(monotonicDeadlineRemaining(deadline, start), 0n);
});

test("deadline equality is reached and later moments remain reached", () => {
  const deadline = monotonicDeadlineAfter(
    readMonotonicClock(() => 10n),
    asMonotonicDuration(5n),
  );

  equal(
    isMonotonicDeadlineReached(deadline, readMonotonicClock(() => 14n)),
    false,
  );
  equal(
    isMonotonicDeadlineReached(deadline, readMonotonicClock(() => 15n)),
    true,
  );
  equal(
    isMonotonicDeadlineReached(deadline, readMonotonicClock(() => 16n)),
    true,
  );
});

test("remaining duration is exact before expiry and clamps to zero after", () => {
  const deadline = monotonicDeadlineAfter(
    readMonotonicClock(() => 100n),
    asMonotonicDuration(50n),
  );

  const before: MonotonicDuration = monotonicDeadlineRemaining(
    deadline,
    readMonotonicClock(() => 125n),
  );
  const equalTime: MonotonicDuration = monotonicDeadlineRemaining(
    deadline,
    readMonotonicClock(() => 150n),
  );
  const after: MonotonicDuration = monotonicDeadlineRemaining(
    deadline,
    readMonotonicClock(() => 200n),
  );

  equal(before, 25n);
  equal(equalTime, 0n);
  equal(after, 0n);
});

test("deadline construction revalidates moment and duration brands", () => {
  expectMonotonicDeadlineError(
    () => monotonicDeadlineAfter(
      asMonotonicMoment(-1n),
      monotonicDurationFromMilliseconds(1),
    ),
    "moment-type",
    "$start",
  );
  expectMonotonicDeadlineError(
    () => monotonicDeadlineAfter(
      readMonotonicClock(() => 0n),
      asMonotonicDuration(-1n),
    ),
    "duration-type",
    "$duration",
  );
  expectMonotonicDeadlineError(
    () => monotonicDeadlineAfter(
      readMonotonicClock(() => 0n),
      asMonotonicDuration(1),
    ),
    "duration-type",
    "$duration",
  );
});

test("deadline queries revalidate deadline and now inputs", () => {
  const now = readMonotonicClock(() => 10n);
  for (const operation of [
    () => isMonotonicDeadlineReached(asMonotonicDeadline(-1n), now),
    () => monotonicDeadlineRemaining(asMonotonicDeadline(-1n), now),
  ]) {
    expectMonotonicDeadlineError(
      operation,
      "deadline-type",
      "$deadline",
    );
  }

  const deadline = monotonicDeadlineAfter(
    readMonotonicClock(() => 0n),
    monotonicDurationFromMilliseconds(1),
  );
  expectMonotonicDeadlineError(
    () => isMonotonicDeadlineReached(deadline, asMonotonicMoment(-1n)),
    "moment-type",
    "$now",
  );
  expectMonotonicDeadlineError(
    () => monotonicDeadlineRemaining(deadline, asMonotonicMoment(1)),
    "moment-type",
    "$now",
  );
});

test("deadline is a distinct non-serializable bigint brand", () => {
  const moment = readMonotonicClock(() => 1n);
  const duration = monotonicDurationFromMilliseconds(0);
  const deadline = monotonicDeadlineAfter(moment, duration);

  // @ts-expect-error moment 不能直接充当 deadline。
  const uncheckedMoment: MonotonicDeadline = moment;
  // @ts-expect-error duration 不能直接充当 deadline。
  const uncheckedDuration: MonotonicDeadline = duration;
  equal(uncheckedMoment, moment);
  equal(uncheckedDuration, duration);
  throws(() => JSON.stringify({ deadline }), TypeError);
});
