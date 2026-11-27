import { UTC_INSTANT_PATTERN_SOURCE } from "../../contracts/generated/foundation/utc-instant.generated.js";

/**
 * Wakeflow Foundation / Time：严格 UTC 时刻文本。
 *
 * 本模块使用 JSON Schema 派生的词法模式并复验真实公历日期。它保留调用方提供的
 * 无小数或 1–9 位小数表示，不会把同一时刻的不同精度文本强制改写为另一种形式。
 *
 * 本模块不读取当前时间、不执行日期算术、不定义超时或租约语义，也不会混淆墙上
 * 时钟与单调时钟。
 */

const UTC_INSTANT_PATTERN = new RegExp(UTC_INSTANT_PATTERN_SOURCE, "u");

declare const UTC_INSTANT_BRAND: unique symbol;

/** 已严格解析并保留原始文本精度的 Wakeflow UTC 时刻。 */
export type UtcInstant = string & {
  readonly [UTC_INSTANT_BRAND]: "UtcInstant";
};

/** UTC instant 基础能力失败的稳定分类。 */
export type UtcInstantErrorReason = "format" | "calendar";

const ERROR_MESSAGES = {
  format: "UTC instant must match the strict Wakeflow UTC timestamp profile.",
  calendar: "UTC instant must name a real Gregorian calendar instant.",
} as const satisfies Readonly<Record<UtcInstantErrorReason, string>>;

/**
 * UTC 时刻词法或日历验证失败时返回的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和调用方路径，不回显时间文本、Date 内部异常或
 * 原因链。领域职责所有者可以据此映射自己的稳定记录或公共错误。
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

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$";
}

function fail(reason: UtcInstantErrorReason, path: string): never {
  throw new UtcInstantError(reason, path);
}

/**
 * Schema 词法模式已经固定分隔符位置，因此组件读取无需维护第二份完整正则。
 * `Date` 只验证整秒公历日期；小数秒的文本原样保留。
 */
function parseUtcInstantParts(input: unknown, path: string): UtcInstant {
  if (typeof input !== "string" || !UTC_INSTANT_PATTERN.test(input)) {
    fail("format", path);
  }

  const year = Number(input.slice(0, 4));
  const month = Number(input.slice(5, 7));
  const day = Number(input.slice(8, 10));
  const hour = Number(input.slice(11, 13));
  const minute = Number(input.slice(14, 16));
  const second = Number(input.slice(17, 19));

  // 从纪元 Date 再显式设置完整年份，避免 Date.UTC 对 0–99 年应用 1900 年偏移规则。
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  if (
    Number.isNaN(calendar.getTime()) ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second
  ) {
    fail("calendar", path);
  }

  return input as UtcInstant;
}

/**
 * 严格解析 Wakeflow UTC 时刻，保留调用方提供的精确文本和小数位数。
 *
 * 本函数不接受时区偏移、小写 `t`/`z`、空白、闰秒或 `Date` 可自动进位的日期。
 */
export function parseUtcInstant(value: unknown, errorPath?: string): UtcInstant {
  return parseUtcInstantParts(value, normalizeErrorPath(errorPath));
}
