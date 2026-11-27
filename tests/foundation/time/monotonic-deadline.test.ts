import { equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { readMonotonicClock } from "../../../src/foundation/time/monotonic-clock.js";
import {
  isMonotonicDeadlineReached,
  type MonotonicDeadline,
  monotonicDeadlineAfter,
  monotonicDeadlineRemaining,
} from "../../../src/foundation/time/monotonic-deadline.js";
import {
  type MonotonicDuration,
  monotonicDurationFromMilliseconds,
} from "../../../src/foundation/time/monotonic-duration.js";

function asMonotonicDuration(value: unknown): MonotonicDuration {
  return value as MonotonicDuration;
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
    isMonotonicDeadlineReached(
      deadline,
      readMonotonicClock(() => 14n),
    ),
    false,
  );
  equal(
    isMonotonicDeadlineReached(
      deadline,
      readMonotonicClock(() => 15n),
    ),
    true,
  );
  equal(
    isMonotonicDeadlineReached(
      deadline,
      readMonotonicClock(() => 16n),
    ),
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
