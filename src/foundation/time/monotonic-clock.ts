import { hrtime } from "node:process";

/**
 * Wakeflow Foundation / Time：进程内单调时钟来源。
 *
 * 本模块只读取与真实日期无关、不会受系统校时影响的高分辨率单调时刻，并为确定性
 * 测试提供同步注入点。读数以任意过去时刻为原点，只能在同一时钟来源的执行上下文
 * 内用于计算经过时长和截止时刻。
 *
 * 单调时刻不得转换为 `UtcInstant`、写入 JSON、Schema 或日志，也不得跨进程比较。
 * 时长、截止时刻、超时策略和休眠调度属于后续独立能力或领域职责所有者。
 */

/** 返回原始单调纳秒读数的同步来源。 */
export type MonotonicClock = () => bigint;

declare const MONOTONIC_MOMENT_BRAND: unique symbol;

/** 已从受验证时钟来源读取的进程内单调时刻。 */
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
 * 错误不会透传注入函数的消息、调用栈、原因链或返回值，也不会把任意原点
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
 * Node.js 默认单调时钟来源，其精度和原点由 `process.hrtime.bigint()` 决定。
 * 本函数不缓存或转换读数。
 */
const systemMonotonicClock: MonotonicClock = () => hrtime.bigint();

/**
 * 读取一次单调时钟，并把非负 `bigint` 授予 `MonotonicMoment` 品牌类型。
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
