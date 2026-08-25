import {
  UTC_INSTANT_PATTERN_SOURCE,
} from "../../contracts/generated/foundation/utc-instant.generated.js";

/**
 * Wakeflow Foundation / Time：严格 UTC instant 文本与纳秒时间线。
 *
 * 本文件消费 JSON Schema 派生的词法 pattern，复验真实 Gregorian 日历，并把
 * 已接纳文本转换为 Unix epoch nanoseconds。它保留调用方原始的无小数或
 * 1–9 位小数表示，不把同一 instant 的不同精度别名强制改写为另一段文本。
 *
 * 这里不读取当前时间、不执行日期算术、不拥有 timeout/lease 语义，也不把
 * wall clock 与 monotonic clock 混为一个来源。
 */

const UTC_INSTANT_PATTERN = new RegExp(UTC_INSTANT_PATTERN_SOURCE, "u");
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

declare const UTC_INSTANT_BRAND: unique symbol;

/** 已严格解析、保持原文本精度的 Wakeflow UTC instant。 */
export type UtcInstant = string & {
  readonly [UTC_INSTANT_BRAND]: "UtcInstant";
};

/** UTC instant 基础能力失败的稳定分类。 */
export type UtcInstantErrorReason = "format" | "calendar";

const ERROR_MESSAGES = {
  "format": "UTC instant must match the strict Wakeflow UTC timestamp profile.",
  "calendar": "UTC instant must name a real Gregorian calendar instant.",
} as const satisfies Readonly<Record<UtcInstantErrorReason, string>>;

/**
 * UTC instant 词法或日历失败的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和调用方路径，不回显时间文本、Date 内部异常或
 * cause。领域 owner 可以据此映射自己的稳定 record/public 错误。
 */
export class UtcInstantError extends Error {
  override readonly name = "UtcInstantError";
  readonly code = "wakeflow-utc-instant" as const;
  readonly reason: UtcInstantErrorReason;
  readonly path: string;

  constructor(reason: UtcInstantErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedUtcInstant {
  readonly value: UtcInstant;
  readonly epochNanoseconds: bigint;
}

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$";
}

function fail(reason: UtcInstantErrorReason, path: string): never {
  throw new UtcInstantError(reason, path);
}

/**
 * Schema pattern 已固定分隔符位置，因此组件读取无需维护第二份完整正则。
 * Date 只验证整秒 Gregorian 日历；小数秒由 BigInt 独立保留到纳秒。
 */
function parseUtcInstantParts(
  input: unknown,
  path: string,
): ParsedUtcInstant {
  if (typeof input !== "string" || !UTC_INSTANT_PATTERN.test(input)) {
    fail("format", path);
  }

  const year = Number(input.slice(0, 4));
  const month = Number(input.slice(5, 7));
  const day = Number(input.slice(8, 10));
  const hour = Number(input.slice(11, 13));
  const minute = Number(input.slice(14, 16));
  const second = Number(input.slice(17, 19));
  const fraction = input[19] === "." ? input.slice(20, -1) : "";

  // 从 epoch Date 再显式设置 full year，避免 Date.UTC 对 0–99 年的 1900 偏移规则。
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  const epochMilliseconds = calendar.getTime();
  if (
    Number.isNaN(epochMilliseconds)
    || calendar.getUTCFullYear() !== year
    || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day
    || calendar.getUTCHours() !== hour
    || calendar.getUTCMinutes() !== minute
    || calendar.getUTCSeconds() !== second
  ) {
    fail("calendar", path);
  }

  const fractionalNanoseconds = BigInt(fraction.padEnd(9, "0") || "0");
  return {
    value: input as UtcInstant,
    epochNanoseconds:
      BigInt(epochMilliseconds) * NANOSECONDS_PER_MILLISECOND
      + fractionalNanoseconds,
  };
}

/**
 * 严格解析 Wakeflow UTC instant，保留调用方提供的准确文本与小数位数。
 *
 * 本函数不接受 offset、lowercase t/z、空白、闰秒或 Date 可自动进位的日期。
 */
export function parseUtcInstant(
  value: unknown,
  errorPath?: string,
): UtcInstant {
  return parseUtcInstantParts(value, normalizeErrorPath(errorPath)).value;
}

/**
 * 把 UTC instant 转为 Unix epoch nanoseconds，并在运行时重新验证品牌输入。
 *
 * 结果可以为负数；例如 epoch 前 1 纳秒表示为 `-1n`。本转换不修改原文本。
 */
export function utcInstantToEpochNanoseconds(
  value: UtcInstant,
  errorPath?: string,
): bigint {
  return parseUtcInstantParts(
    value,
    normalizeErrorPath(errorPath),
  ).epochNanoseconds;
}

/**
 * 按真实纳秒时间线比较两个 UTC instant；不同精度文本可比较为相等。
 *
 * 参数虽然带品牌，仍分别以 `$left` 和 `$right` 重新完成运行时复验。
 */
export function compareUtcInstants(
  left: UtcInstant,
  right: UtcInstant,
): -1 | 0 | 1 {
  const leftNanoseconds = parseUtcInstantParts(
    left,
    "$left",
  ).epochNanoseconds;
  const rightNanoseconds = parseUtcInstantParts(
    right,
    "$right",
  ).epochNanoseconds;

  return leftNanoseconds < rightNanoseconds
    ? -1
    : leftNanoseconds > rightNanoseconds
      ? 1
      : 0;
}
