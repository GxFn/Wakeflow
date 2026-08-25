import { hrtime } from "node:process";

/**
 * Wakeflow Foundation / Time：进程内 monotonic clock 来源。
 *
 * 本文件只读取与真实日期无关、不会受系统校时影响的高分辨率 monotonic moment，
 * 并为确定性测试提供同步注入 seam。读数以任意过去时刻为 origin，只能在同一
 * clock source 的执行上下文内用于 elapsed/deadline 计算。
 *
 * monotonic moment 不得转成 UtcInstant、写入 JSON/Schema/日志或跨进程比较。
 * duration、deadline、timeout policy 和 sleep 调度属于后续独立能力或领域 owner。
 */

/** 返回原始 monotonic nanoseconds 的同步来源。 */
export type MonotonicClock = () => bigint;

declare const MONOTONIC_MOMENT_BRAND: unique symbol;

/** 已从一个受验证 clock source 读取的进程内 monotonic moment。 */
export type MonotonicMoment = bigint & {
  readonly [MONOTONIC_MOMENT_BRAND]: "MonotonicMoment";
};

/** monotonic clock 来源失败的稳定分类。 */
export type MonotonicClockErrorReason =
  | "clock-type"
  | "clock-failure"
  | "clock-result";

const ERROR_MESSAGES = {
  "clock-type": "Monotonic clock must be a function.",
  "clock-failure": "Monotonic clock failed while reading a moment.",
  "clock-result": "Monotonic clock must return non-negative nanoseconds as bigint.",
} as const satisfies Readonly<Record<MonotonicClockErrorReason, string>>;

/**
 * monotonic clock 来源或结果失败的稳定错误。
 *
 * 错误不会透传注入函数的 message、stack、cause 或返回值，也不会把任意 origin
 * 数值写入诊断文本。
 */
export class MonotonicClockError extends Error {
  override readonly name = "MonotonicClockError";
  readonly code = "wakeflow-monotonic-clock" as const;
  readonly reason: MonotonicClockErrorReason;
  readonly path: string;

  constructor(reason: MonotonicClockErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: MonotonicClockErrorReason, path: string): never {
  throw new MonotonicClockError(reason, path);
}

/**
 * Node.js 默认 monotonic source，精度和 origin 由 `process.hrtime.bigint()` 拥有。
 * 本函数不缓存或转换读数。
 */
export const systemMonotonicClock: MonotonicClock = () => hrtime.bigint();

/**
 * 读取一次 monotonic clock，并把非负 bigint 授予 MonotonicMoment 品牌。
 *
 * 注入函数恰好调用一次；本层无法也不会凭单个读数证明多次调用的递增关系。
 */
export function readMonotonicClock(
  clock: MonotonicClock = systemMonotonicClock,
): MonotonicMoment {
  if (typeof clock !== "function") fail("clock-type", "$clock");

  let value: unknown;
  try {
    value = clock();
  } catch {
    fail("clock-failure", "$clock");
  }

  if (typeof value !== "bigint" || value < 0n) {
    fail("clock-result", "$clockResult");
  }
  return value as MonotonicMoment;
}
