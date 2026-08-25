import type { MonotonicMoment } from "./monotonic-clock.js";

/**
 * Wakeflow Foundation / Time：monotonic duration 的无损纳秒表示。
 *
 * 本文件只计算同一 monotonic clock source 上两个 moment 的非负差值，并把现有
 * 协议使用的非负整数毫秒无损转换为纳秒 duration。它不读取 clock，也无法在
 * 运行时证明两个 branded moment 确实来自同一 source；该配对责任仍属于调用方。
 *
 * duration 不得转为 UTC 时间或持久化。deadline、剩余等待、舍入、sleep 与
 * timeout policy 由后续独立能力或领域 owner 决定。
 */

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

declare const MONOTONIC_DURATION_BRAND: unique symbol;

/** 已验证的非负 monotonic nanoseconds duration。 */
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
 * moment 差值或 duration 转换失败的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和参数路径，不回显 moment、duration 或毫秒值。
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
 * 计算同一 clock source 中 start 到 end 的准确纳秒差值。
 *
 * 零 duration 合法；反向顺序稳定拒绝，避免负数被误当成剩余等待或 elapsed。
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
 * 把非负整数毫秒无损转换为 monotonic nanoseconds duration。
 *
 * 本层不设置领域最大 timeout；每个 owner 继续拥有自己的容量上限。
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
