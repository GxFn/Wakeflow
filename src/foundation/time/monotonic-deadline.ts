import type { MonotonicMoment } from "./monotonic-clock.js";
import type { MonotonicDuration } from "./monotonic-duration.js";

/**
 * Wakeflow Foundation / Time：纯单调截止时刻算法。
 *
 * 本模块把同一时钟来源的起始时刻与非负时长组合为截止时刻，并在调用方显式提供
 * 当前读数后判断是否到期及计算剩余时长。它不读取时钟，
 * 因而不会在一次领域判断中隐藏第二次时间观察。
 *
 * 截止时刻、起始时刻和当前读数必须来自同一单调时钟来源。运行时 `bigint` 无法
 * 证明该关联，因此仍由构造当前操作上下文的调用方负责。截止时刻不得持久化。
 */

declare const MONOTONIC_DEADLINE_BRAND: unique symbol;

/** 由单调时刻和非负时长构造的进程内截止时刻。 */
export type MonotonicDeadline = bigint & {
  readonly [MONOTONIC_DEADLINE_BRAND]: "MonotonicDeadline";
};

/**
 * 从 `start` 和 `duration` 构造精确截止时刻。
 *
 * 零时长合法并产生立即到期的截止时刻；`bigint` 加法不会产生 `number` 溢出。两个输入的品牌
 * 就是准入的证明（时钟读数与时长构造器各自检查过），这里不再复验。
 */
export function monotonicDeadlineAfter(
  start: MonotonicMoment,
  duration: MonotonicDuration,
): MonotonicDeadline {
  return (start + duration) as MonotonicDeadline;
}

/** `now` 等于或晚于截止时刻时返回 `true`；本函数不读取时钟。 */
export function isMonotonicDeadlineReached(
  deadline: MonotonicDeadline,
  now: MonotonicMoment,
): boolean {
  return now >= deadline;
}

/**
 * 返回 `now` 到截止时刻的精确剩余时长；已经到期时固定返回零。
 *
 * 归零只表达“无需继续等待”，不决定调用方应报错、重试还是执行下一动作。
 */
export function monotonicDeadlineRemaining(
  deadline: MonotonicDeadline,
  now: MonotonicMoment,
): MonotonicDuration {
  return (now >= deadline ? 0n : deadline - now) as MonotonicDuration;
}
