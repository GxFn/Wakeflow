import type { MonotonicMoment } from "./monotonic-clock.js";
import type { MonotonicDuration } from "./monotonic-duration.js";

/**
 * Wakeflow Foundation / Time：纯 monotonic deadline 算法。
 *
 * 本文件把同一 clock source 的 start moment 与非负 duration 组合为 deadline，
 * 并在调用方显式提供 now 后判断是否到期及计算剩余 duration。它不读取 clock，
 * 因而不会在一次领域判断中隐藏第二次时间观察。
 *
 * deadline、start 和 now 必须来自同一 monotonic source；该关联无法由运行时
 * bigint 证明，仍由构造当前操作上下文的调用方负责。deadline 不得持久化。
 */

declare const MONOTONIC_DEADLINE_BRAND: unique symbol;

/** 已由 monotonic moment 加非负 duration 构造的进程内 deadline。 */
export type MonotonicDeadline = bigint & {
  readonly [MONOTONIC_DEADLINE_BRAND]: "MonotonicDeadline";
};

/** monotonic deadline 失败的稳定分类。 */
export type MonotonicDeadlineErrorReason =
  | "moment-type"
  | "duration-type"
  | "deadline-type";

const ERROR_MESSAGES = {
  "moment-type": "Monotonic moment must be non-negative nanoseconds as bigint.",
  "duration-type": "Monotonic duration must be non-negative nanoseconds as bigint.",
  "deadline-type": "Monotonic deadline must be non-negative nanoseconds as bigint.",
} as const satisfies Readonly<Record<MonotonicDeadlineErrorReason, string>>;

/**
 * deadline 构造或查询输入失败的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和参数路径，不回显 origin、moment、deadline 或
 * duration 数值。
 */
export class MonotonicDeadlineError extends Error {
  override readonly name = "MonotonicDeadlineError";
  readonly code = "wakeflow-monotonic-deadline" as const;
  readonly reason: MonotonicDeadlineErrorReason;
  readonly path: string;

  constructor(reason: MonotonicDeadlineErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: MonotonicDeadlineErrorReason, path: string): never {
  throw new MonotonicDeadlineError(reason, path);
}

function parseNonNegativeBigint(
  value: unknown,
  reason: MonotonicDeadlineErrorReason,
  path: string,
): bigint {
  if (typeof value !== "bigint" || value < 0n) fail(reason, path);
  return value;
}

/**
 * 从 start 和 duration 构造准确 deadline。
 *
 * 零 duration 合法并产生立即到期的 deadline；BigInt 加法没有 Number 溢出。
 */
export function monotonicDeadlineAfter(
  start: MonotonicMoment,
  duration: MonotonicDuration,
): MonotonicDeadline {
  const startNanoseconds = parseNonNegativeBigint(
    start,
    "moment-type",
    "$start",
  );
  const durationNanoseconds = parseNonNegativeBigint(
    duration,
    "duration-type",
    "$duration",
  );
  return (startNanoseconds + durationNanoseconds) as MonotonicDeadline;
}

/** now 等于或晚于 deadline 时返回 true；本函数不读取 clock。 */
export function isMonotonicDeadlineReached(
  deadline: MonotonicDeadline,
  now: MonotonicMoment,
): boolean {
  const deadlineNanoseconds = parseNonNegativeBigint(
    deadline,
    "deadline-type",
    "$deadline",
  );
  const nowNanoseconds = parseNonNegativeBigint(
    now,
    "moment-type",
    "$now",
  );
  return nowNanoseconds >= deadlineNanoseconds;
}

/**
 * 返回 now 到 deadline 的准确剩余 duration；已经到期时固定返回零。
 *
 * 归零只表达“无需继续等待”，不决定调用方应报错、重试还是执行下一动作。
 */
export function monotonicDeadlineRemaining(
  deadline: MonotonicDeadline,
  now: MonotonicMoment,
): MonotonicDuration {
  const deadlineNanoseconds = parseNonNegativeBigint(
    deadline,
    "deadline-type",
    "$deadline",
  );
  const nowNanoseconds = parseNonNegativeBigint(
    now,
    "moment-type",
    "$now",
  );
  return (
    nowNanoseconds >= deadlineNanoseconds
      ? 0n
      : deadlineNanoseconds - nowNanoseconds
  ) as MonotonicDuration;
}
