import type { MonotonicMoment } from "./monotonic-clock.js";

/**
 * Wakeflow Foundation / Time：单调时长的无损纳秒表示。
 *
 * 本模块只计算同一单调时钟来源上两个时刻的非负差值，并把协议使用的非负整数毫秒
 * 无损转换为纳秒时长。它不读取时钟，也无法在运行时证明两个品牌时刻来自同一来源；
 * 调用方仍负责保证来源一致。
 *
 * 单调时长不得转换为 UTC 时间或持久化。截止时刻、剩余等待、舍入、休眠和超时策略
 * 由后续独立能力或领域职责所有者决定。
 */

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

declare const MONOTONIC_DURATION_BRAND: unique symbol;

/** 已验证的非负单调纳秒时长。 */
export type MonotonicDuration = bigint & {
  readonly [MONOTONIC_DURATION_BRAND]: "MonotonicDuration";
};

/** monotonic duration 失败的稳定分类。 */
export type MonotonicDurationErrorReason =
  | "moment-type"
  | "moment-order"
  | "milliseconds";

const ERROR_MESSAGES = {
  "moment-type": "Monotonic moment must be non-negative nanoseconds as bigint.",
  "moment-order": "Monotonic end moment must not precede the start moment.",
  "milliseconds": "Monotonic milliseconds must be a non-negative safe integer.",
} as const satisfies Readonly<Record<MonotonicDurationErrorReason, string>>;

/**
 * 单调时刻差值或时长转换失败时返回的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和参数路径，不回显时刻、时长或毫秒值。
 */
export class MonotonicDurationError extends Error {
  override readonly name = "MonotonicDurationError";
  readonly code = "wakeflow-monotonic-duration" as const;
  readonly reason: MonotonicDurationErrorReason;
  readonly path: string;

  constructor(reason: MonotonicDurationErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: MonotonicDurationErrorReason, path: string): never {
  throw new MonotonicDurationError(reason, path);
}

function parseMoment(value: unknown, path: string): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    fail("moment-type", path);
  }
  return value;
}

/**
 * 计算同一时钟来源中 `start` 到 `end` 的精确纳秒差值。
 *
 * 零时长合法；反向顺序会被稳定拒绝，避免负数被误当成剩余等待或已经过时长。
 */
export function monotonicDurationBetween(
  start: MonotonicMoment,
  end: MonotonicMoment,
): MonotonicDuration {
  const startNanoseconds = parseMoment(start, "$start");
  const endNanoseconds = parseMoment(end, "$end");
  if (endNanoseconds < startNanoseconds) {
    fail("moment-order", "$end");
  }
  return (endNanoseconds - startNanoseconds) as MonotonicDuration;
}

/**
 * 把非负整数毫秒无损转换为单调纳秒时长。
 *
 * 本层不设置领域最大超时时长；每个职责所有者继续定义自己的容量上限。
 */
export function monotonicDurationFromMilliseconds(
  milliseconds: number,
): MonotonicDuration {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    fail("milliseconds", "$milliseconds");
  }
  return (
    BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND
  ) as MonotonicDuration;
}
