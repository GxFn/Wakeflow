/**
 * Wakeflow Foundation / Numeric：可安全参与文件 I/O 的字节数量。
 *
 * 本模块只表示 `0` 至 `Number.MAX_SAFE_INTEGER` 范围内的整数字节数，并提供从
 * `number`、`bigint` 准入以及不会静默越界的加减运算。它不定义任何文件、目录树
 * 或协议的容量上限，也不把字节数解释为偏移量、索引或权限。
 *
 * Node.js `bigint` Stats 必须先通过 `byteCountFromBigInt`，才能用于 Buffer 分配、
 * 循环计数或基于 `number` 的 API。领域职责所有者仍须设置更严格的容量预算。
 */

declare const BYTE_COUNT_BRAND: unique symbol;

/** 已验证为非负安全整数的字节数量。 */
export type ByteCount = number & {
  readonly [BYTE_COUNT_BRAND]: "ByteCount";
};

/** `ByteCount` 可表达的最大值；它不是 Wakeflow 的领域容量默认值。 */
export const MAX_SAFE_BYTE_COUNT = Number.MAX_SAFE_INTEGER as ByteCount;

/** 字节数准入或运算失败的稳定分类。 */
export type ByteCountErrorReason =
  | "number-range"
  | "bigint-range"
  | "addition-overflow"
  | "subtraction-underflow";

const ERROR_MESSAGES = {
  "number-range": "Byte count must be a non-negative safe integer number.",
  "bigint-range": "BigInt byte count must fit a non-negative safe integer number.",
  "addition-overflow": "Byte count addition exceeds the safe integer range.",
  "subtraction-underflow": "Byte count subtraction would produce a negative result.",
} as const satisfies Readonly<Record<ByteCountErrorReason, string>>;

/**
 * 字节数准入或运算失败时返回的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和调用方路径，不回显输入数量、文件大小、累计值
 * 或领域容量，避免诊断文本意外携带敏感结构信息。
 */
export class ByteCountError extends Error {
  override readonly name = "ByteCountError";
  readonly code = "wakeflow-byte-count" as const;
  readonly reason: ByteCountErrorReason;
  readonly path: string;

  constructor(reason: ByteCountErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$";
}

function memberPath(basePath: string, member: string): string {
  return basePath === "$" ? `$${member}` : `${basePath}.${member}`;
}

function fail(reason: ByteCountErrorReason, path: string): never {
  throw new ByteCountError(reason, path);
}

function parseNumberByteCount(value: unknown, path: string): ByteCount {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    fail("number-range", path);
  }
  return value as ByteCount;
}

/**
 * 从未知值严格解析字节数，不接受 `bigint`、字符串或数值强制转换。
 *
 * `Number.MAX_SAFE_INTEGER` 是合法值；具体文件或目录树通常应由领域职责所有者
 * 使用更小的上限。
 */
export function parseByteCount(
  value: unknown,
  errorPath?: string,
): ByteCount {
  return parseNumberByteCount(value, normalizeErrorPath(errorPath));
}

/**
 * 把 Node.js `bigint` Stats 等来源转换为可安全使用的 `number` 字节数。
 *
 * 只有非负且不超过 `Number.MAX_SAFE_INTEGER` 的 `bigint` 才会转换，因此不会丢失
 * 整数精度。`number` 输入必须显式使用 `parseByteCount`，避免混淆数据来源。
 */
export function byteCountFromBigInt(
  value: bigint,
  errorPath?: string,
): ByteCount {
  const path = normalizeErrorPath(errorPath);
  if (
    typeof value !== "bigint"
    || value < 0n
    || value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    fail("bigint-range", path);
  }
  return Number(value) as ByteCount;
}

/**
 * 精确相加两个字节数；任何伪造的品牌类型输入都会先重新准入。
 *
 * 溢出在执行加法前判断，不允许超过安全整数范围的近似 Number 进入结果。
 */
export function addByteCounts(
  left: ByteCount,
  right: ByteCount,
  errorPath?: string,
): ByteCount {
  const path = normalizeErrorPath(errorPath);
  const admittedLeft = parseNumberByteCount(left, memberPath(path, "left"));
  const admittedRight = parseNumberByteCount(right, memberPath(path, "right"));
  if (admittedRight > MAX_SAFE_BYTE_COUNT - admittedLeft) {
    fail("addition-overflow", path);
  }
  return (admittedLeft + admittedRight) as ByteCount;
}

/**
 * 从 `total` 中精确扣除 `part`；结果不得为负数。
 *
 * 本函数适合计算剩余读取预算或未消费字节，但不会赋予 `part`“属于 `total`”的
 * 领域语义。
 */
export function subtractByteCounts(
  total: ByteCount,
  part: ByteCount,
  errorPath?: string,
): ByteCount {
  const path = normalizeErrorPath(errorPath);
  const admittedTotal = parseNumberByteCount(total, memberPath(path, "total"));
  const admittedPart = parseNumberByteCount(part, memberPath(path, "part"));
  if (admittedPart > admittedTotal) fail("subtraction-underflow", path);
  return (admittedTotal - admittedPart) as ByteCount;
}
