import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import type { MonotonicMoment } from "./monotonic-clock.js";

/**
 * Wakeflow Foundation / Time：单调时长的无损纳秒表示。
 *
 * 本模块只计算同一单调时钟来源上两个时刻的非负差值，并把协议使用的非负整数毫秒
 * 无损转换为纳秒时长。它不读取时钟，也无法在运行时证明两个品牌时刻来自同一来源；
 * 调用方仍负责保证来源一致。
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
export type MonotonicDurationErrorReason = "moment-type" | "moment-order" | "milliseconds";

/**
 * 单调时刻差值或时长转换失败时返回的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和参数路径，不回显时刻、时长或毫秒值。
 */
export class MonotonicDurationError extends ModuleError<MonotonicDurationErrorReason> {
  static override readonly code = "wakeflow-monotonic-duration";
}

const fail: Fail<MonotonicDurationErrorReason> = failWith(MonotonicDurationError);

/**
 * 计算同一时钟来源中 `start` 到 `end` 的精确纳秒差值。
 *
 * 零时长合法；反向顺序会被稳定拒绝，避免负数被误当成剩余等待或已经过时长。两个时刻的品牌
 * 就是准入的证明（时钟读数检查过非负），这里只判断顺序。
 */
export function monotonicDurationBetween(
  start: MonotonicMoment,
  end: MonotonicMoment,
): MonotonicDuration {
  if (end < start) {
    fail("moment-order", "$end");
  }
  return (end - start) as MonotonicDuration;
}

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
