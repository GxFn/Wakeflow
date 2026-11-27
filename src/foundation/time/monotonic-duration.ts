import { type Fail, failWith, ModuleError } from "../error/module-error.js";

/**
 * Wakeflow Foundation / Time：单调时长的无损纳秒表示。
 *
 * 本模块把协议使用的非负整数毫秒无损转换为纳秒时长。它不读取时钟。
 *
 * 单调时长不得转换为 UTC 时间或持久化。截止时刻与剩余等待由 monotonic-deadline 提供；
 * 舍入、休眠和超时策略由领域职责所有者决定。
 */

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

declare const MONOTONIC_DURATION_BRAND: unique symbol;

/** 已验证的非负单调纳秒时长。 */
export type MonotonicDuration = bigint & {
  readonly [MONOTONIC_DURATION_BRAND]: "MonotonicDuration";
};

/** monotonic duration 失败的稳定分类。 */
export type MonotonicDurationErrorReason = "milliseconds";

/**
 * 时长转换失败时返回的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和参数路径，不回显时刻、时长或毫秒值。
 */
export class MonotonicDurationError extends ModuleError<MonotonicDurationErrorReason> {
  static override readonly code = "wakeflow-monotonic-duration";
}

const fail: Fail<MonotonicDurationErrorReason> = failWith(MonotonicDurationError);

/**
 * 把非负整数毫秒无损转换为单调纳秒时长。
 *
 * 本层不设置领域最大超时时长；每个职责所有者继续定义自己的容量上限。
 */
export function monotonicDurationFromMilliseconds(milliseconds: number): MonotonicDuration {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    fail("milliseconds", "$milliseconds");
  }
  return (BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND) as MonotonicDuration;
}
