import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
  type JsonValueErrorReason,
} from "./json-value.js";

/**
 * Wakeflow Foundation / Data：确定性 pretty JSON 文档表示。
 *
 * 本文件把已经按调用方领域顺序构造的 JSON 数据树渲染为 2 空格缩进、LF-only、
 * 恰好一个末尾 LF 的文本，并可反向拒绝重复键、空白、缩进、换行或数字表示漂移。
 * 输入会先经过 JsonValue 被动快照，因此不会执行 getter、toJSON 或 Proxy 行为。
 *
 * 对象字段的领域顺序不属于本层：parser 只能证明文本对“当前键顺序”是确定表示；
 * Config、TODO、Demand 等 owner 必须把 value 重建为自己的规范化模型，再把本文本
 * 与该模型的 render 结果比较。RFC 8785 canonical JSON 继续独立拥有 semantic digest。
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

/** 确定性 pretty JSON 准入或渲染失败的稳定、脱敏错误。 */
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
 * 将任意被动 JSON 数据值渲染为确定性 pretty 文本。
 *
 * 调用方若要求领域字段顺序，必须先传入已经按该顺序重建的 model；本函数不会按
 * 字典序、Schema properties 或历史输入顺序替调用方决定领域 representation。
 */
export function renderDeterministicJsonDocument(
  value: unknown,
  errorPath?: string,
): string {
  const path = normalizePath(errorPath);
  return renderAdmitted(admitJsonValue(value, path), path);
}

/**
 * 解析并验证一个确定性 pretty JSON 文本。
 *
 * 成功结果是解除输入别名、递归冻结的 JsonValue。重复键会在重新渲染时消失，因此
 * 和其他 representation 漂移一样被拒绝；函数不执行自动格式化或兼容修复。
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
