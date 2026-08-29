import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "./utc-instant.js";

/**
 * Wakeflow Foundation / Time：可持久化的 UTC 墙上时钟来源。
 *
 * 本模块只回答“当前系统时间应记录为哪个 `UtcInstant`”，并提供明确的同步测试
 * 注入点。系统来源保持 JavaScript `Date` 的毫秒精度；注入来源可以返回
 * `utc-instant` 已接纳的其他精度，但每次结果仍会重新接受运行时验证。
 *
 * 墙上时钟可能重复、回拨或被操作系统校时。本能力不制造严格递增时间、不计算经过
 * 时长，也不负责超时、租约过期或事件顺序策略。
 */

/** 返回已经通过基础时间合同验证的当前 UTC 时刻。 */
export type UtcWallClock = () => UtcInstant;

/** UTC wall clock 来源失败的稳定分类。 */
export type UtcWallClockErrorReason =
  | "clock-type"
  | "clock-failure"
  | "clock-result";

const ERROR_MESSAGES = {
  "clock-type": "UTC wall clock must be a function.",
  "clock-failure": "UTC wall clock failed while reading the current time.",
  "clock-result": "UTC wall clock returned an invalid UTC instant.",
} as const satisfies Readonly<Record<UtcWallClockErrorReason, string>>;

/**
 * UTC wall clock 来源或结果失败的稳定错误。
 *
 * 错误不会透传注入函数的消息、调用栈、原因链或返回值。领域职责所有者可以根据
 * 失败分类把错误映射为自己的记录或公共错误。
 */
export class UtcWallClockError extends Error {
  override readonly name = "UtcWallClockError";
  readonly code = "wakeflow-utc-wall-clock" as const;
  readonly reason: UtcWallClockErrorReason;
  readonly path: string;

  constructor(reason: UtcWallClockErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: UtcWallClockErrorReason, path: string): never {
  throw new UtcWallClockError(reason, path);
}

/**
 * Node.js 系统墙上时钟的默认来源。
 *
 * `Date` 只生成当前 UTC 毫秒文本，最终仍交给 `utc-instant` 授予品牌类型。函数不
 * 缓存 `Date` 或上一次结果，因此每次调用都是一次新的系统时间观察。
 */
const systemUtcWallClock: UtcWallClock = () => (
  parseUtcInstant(new Date().toISOString(), "$systemUtcWallClock")
);

/**
 * 读取一次 UTC 墙上时钟，并对可注入来源实行稳定错误映射和结果复验。
 *
 * 注入函数是明确允许执行的依赖；本函数恰好调用一次。有效但早于前次调用的
 * 结果会原样返回，严格递增策略必须由了解领域历史的职责所有者另行决定。
 */
export function readUtcWallClock(
  clock: UtcWallClock = systemUtcWallClock,
): UtcInstant {
  if (typeof clock !== "function") fail("clock-type", "$clock");

  let value: unknown;
  try {
    value = clock();
  } catch {
    fail("clock-failure", "$clock");
  }

  try {
    return parseUtcInstant(value, "$clockResult");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) {
      fail("clock-result", "$clockResult");
    }
    throw error;
  }
}
