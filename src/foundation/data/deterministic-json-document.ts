import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
  type JsonValueErrorReason,
} from "./json-value.js";

/**
 * Wakeflow Foundation / Data：确定性格式化 JSON 文档表示。
 *
 * 本模块把已经按领域顺序构造的 JSON 数据树渲染为使用 2 个空格缩进、只含 LF
 * 换行符且末尾恰好保留一个 LF 的文本。反向解析会拒绝重复键，以及空白、缩进、
 * 换行符或数字表示发生漂移。输入先转换为 `JsonValue` 快照，因此不会执行访问器、
 * `toJSON` 或代理陷阱。
 *
 * 对象字段的领域顺序不属于本层：解析器只能证明文本对于当前键顺序具有唯一表示。
 * Config、TODO、Demand 等职责所有者必须先把数据重建为各自的规范化模型，再比较
 * 磁盘文本与模型渲染结果。RFC 8785 Canonical JSON 继续独立负责语义摘要。
 */

export type DeterministicJsonDocumentErrorReason =
  | "input"
  | "json-syntax"
  | "non-deterministic"
  | "render-failure"
  | JsonValueErrorReason;

const ERROR_MESSAGES = {
  "input": "Deterministic JSON document input is invalid.",
  "json-syntax": "Deterministic JSON document syntax is invalid.",
  "non-deterministic": "JSON text does not use the deterministic pretty representation.",
  "render-failure": "Deterministic JSON document rendering failed after JSON admission.",
  "unsupported-type": "Deterministic JSON value contains an unsupported type.",
  "non-finite-number": "Deterministic JSON numbers must be finite.",
  "negative-zero": "Deterministic JSON does not accept negative zero.",
  "lone-surrogate": "Deterministic JSON text contains invalid Unicode.",
  "cycle": "Deterministic JSON values cannot contain cycles.",
  "maximum-depth": "Deterministic JSON exceeds its structural depth limit.",
  "invalid-container": "Deterministic JSON contains an invalid container.",
  "proxy": "Deterministic JSON does not accept Proxy values.",
  "record-prototype": "Deterministic JSON objects require a plain prototype.",
  "symbol-key": "Deterministic JSON objects cannot contain symbol keys.",
  "non-enumerable-property": "Deterministic JSON cannot contain hidden properties.",
  "accessor-property": "Deterministic JSON cannot contain accessors.",
  "array-prototype": "Deterministic JSON arrays require the standard prototype.",
  "array-slot": "Deterministic JSON arrays must be dense.",
  "array-extra-property": "Deterministic JSON arrays cannot contain extra properties.",
} as const satisfies Readonly<Record<
  DeterministicJsonDocumentErrorReason,
  string
>>;

/** 确定性格式化 JSON 准入或渲染失败时返回的稳定、脱敏错误。 */
export class DeterministicJsonDocumentError extends Error {
  override readonly name = "DeterministicJsonDocumentError";
  readonly code = "wakeflow-deterministic-json-document" as const;
  readonly reason: DeterministicJsonDocumentErrorReason;
  readonly path: string;

  constructor(reason: DeterministicJsonDocumentErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: DeterministicJsonDocumentErrorReason,
  path: string,
): never {
  throw new DeterministicJsonDocumentError(reason, path);
}

function normalizePath(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "$document";
}

function admitJsonValue(value: unknown, path: string): JsonValue {
  try {
    return parseJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail(error.reason, error.path);
    throw error;
  }
}

function renderAdmitted(value: JsonValue, path: string): string {
  let rendered: string | undefined;
  try {
    rendered = JSON.stringify(value, null, 2);
  } catch {
    fail("render-failure", path);
  }
  if (typeof rendered !== "string") fail("render-failure", path);
  return `${rendered}\n`;
}

/**
 * 将任意无副作用 JSON 数据值渲染为确定性格式化文本。
 *
 * 调用方如果要求特定领域字段顺序，必须先传入按该顺序重建的模型。本函数不会根据
 * 字典序、Schema 的 `properties` 或历史输入顺序替调用方决定领域表示。
 */
export function renderDeterministicJsonDocument(
  value: unknown,
  errorPath?: string,
): string {
  const path = normalizePath(errorPath);
  return renderAdmitted(admitJsonValue(value, path), path);
}

/**
 * 解析并验证确定性格式化 JSON 文本。
 *
 * 成功结果是与输入容器解除引用关系、递归冻结的 `JsonValue`。重复键会在重新渲染
 * 时消失，因此与其他表示漂移一样被拒绝；本函数不执行自动格式化或兼容修复。
 */
export function parseDeterministicJsonDocument(
  text: unknown,
  errorPath?: string,
): JsonValue {
  const path = normalizePath(errorPath);
  if (typeof text !== "string") fail("input", path);
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    fail("json-syntax", path);
  }
  const value = admitJsonValue(decoded, path);
  if (renderAdmitted(value, path) !== text) fail("non-deterministic", path);
  return value;
}
