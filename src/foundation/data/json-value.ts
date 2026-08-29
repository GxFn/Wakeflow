import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
  type PassiveOwnDataErrorReason,
} from "./passive-own-data.js";

/**
 * Wakeflow Foundation / Data：递归 JSON 值准入。
 *
 * 本模块把任意进程内输入转换为与源容器解除引用关系、递归冻结的 JSON 数据树。
 * 它通过 `passive-own-data` 无副作用地检查每一层自有属性，再验证 JSON 原始类型、
 * Unicode、循环引用和嵌套深度。RFC 8785 排序、UTF-8 编码、摘要和领域字段关系
 * 不属于本模块职责。
 *
 * 该快照既是后续 `canonicalize` 依赖的可信输入，也是领域职责所有者创建独立
 * JSON 副本的统一入口。对象使用 `null` 原型，数组保持标准 `Array` 原型。
 */

/** 根值深度为 0；深度 128 的成员仍被接受。 */
export const JSON_VALUE_MAXIMUM_DEPTH = 128;

const JAVASCRIPT_MAXIMUM_ARRAY_LENGTH = 0xffff_ffff;

/** JSON 原始值。 */
export type JsonPrimitive = null | boolean | number | string;

/** 递归冻结的 JSON 数组。 */
export type JsonArray = readonly JsonValue[];

/** 递归冻结、无原型的 JSON 对象。 */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** Wakeflow 基础层接受的完整 JSON 数据域。 */
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/** JSON 值准入失败的稳定分类。 */
export type JsonValueErrorReason =
  | "unsupported-type"
  | "non-finite-number"
  | "negative-zero"
  | "lone-surrogate"
  | "cycle"
  | "maximum-depth"
  | "invalid-container"
  | "proxy"
  | "record-prototype"
  | "symbol-key"
  | "non-enumerable-property"
  | "accessor-property"
  | "array-prototype"
  | "array-slot"
  | "array-extra-property";

const ERROR_MESSAGES = {
  "unsupported-type": "The value is not part of the JSON data model.",
  "non-finite-number": "JSON numbers must be finite IEEE 754 values.",
  "negative-zero": "Negative zero is not accepted as Wakeflow JSON data.",
  "lone-surrogate": "JSON strings must not contain lone Unicode surrogates.",
  "cycle": "JSON values must not contain circular references.",
  "maximum-depth": "The JSON value exceeds the structural depth limit.",
  "invalid-container": "The JSON container is not structurally valid.",
  "proxy": "Proxy values are not accepted as JSON data.",
  "record-prototype": "JSON objects require a plain or null prototype.",
  "symbol-key": "JSON containers must not contain symbol-keyed properties.",
  "non-enumerable-property": "JSON containers must not contain hidden properties.",
  "accessor-property": "JSON containers must not contain accessor properties.",
  "array-prototype": "JSON arrays require the standard Array prototype.",
  "array-slot": "JSON arrays must be dense own-data arrays.",
  "array-extra-property": "JSON arrays must not contain additional own properties.",
} as const satisfies Readonly<Record<JsonValueErrorReason, string>>;

const PASSIVE_REASON_MAP = {
  "proxy": "proxy",
  "value-type": "invalid-container",
  "record-prototype": "record-prototype",
  "symbol-key": "symbol-key",
  "non-enumerable-property": "non-enumerable-property",
  "accessor-property": "accessor-property",
  "property-selection": "invalid-container",
  "array-prototype": "array-prototype",
  "array-length": "invalid-container",
  "array-slot": "array-slot",
  "array-extra-property": "array-extra-property",
} as const satisfies Readonly<
  Record<PassiveOwnDataErrorReason, JsonValueErrorReason>
>;

/**
 * JSON 值准入的稳定错误。
 *
 * 错误只暴露能力代码、失败分类和结构路径；原始成员值与下层异常消息不会进入
 * 公共字段，领域职责所有者可据此映射自己的错误合同。
 */
export class JsonValueError extends Error {
  override readonly name = "JsonValueError";
  readonly code = "wakeflow-json-value" as const;
  readonly reason: JsonValueErrorReason;
  readonly path: string;

  constructor(reason: JsonValueErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: JsonValueErrorReason, path: string): never {
  throw new JsonValueError(reason, path);
}

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$";
}

function appendPropertyPath(basePath: string, key: string): string {
  const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
  return `${basePath}/${escaped}`;
}

function readPassiveSnapshot<Result>(operation: () => Result): Result {
  try {
    return operation();
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail(PASSIVE_REASON_MAP[error.reason], error.path);
    }
    throw error;
  }
}

function defineJsonProperty(
  snapshot: Record<string, JsonValue>,
  key: string,
  value: JsonValue,
): void {
  Object.defineProperty(snapshot, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function parseArrayValue(
  sourceValue: object,
  path: string,
  ancestors: Set<object>,
  depth: number,
): JsonArray {
  const source = readPassiveSnapshot(() => parseDenseArray(
    sourceValue,
    JAVASCRIPT_MAXIMUM_ARRAY_LENGTH,
    path,
  ));

  ancestors.add(sourceValue);
  try {
    const snapshot: JsonValue[] = [];
    for (let index = 0; index < source.length; index += 1) {
      snapshot.push(parseValue(
        source[index],
        appendPropertyPath(path, String(index)),
        ancestors,
        depth + 1,
      ));
    }
    return Object.freeze(snapshot);
  } finally {
    ancestors.delete(sourceValue);
  }
}

function parseObjectValue(
  sourceValue: object,
  path: string,
  ancestors: Set<object>,
  depth: number,
): JsonObject {
  const source = readPassiveSnapshot(() => parsePlainRecord(sourceValue, path));

  ancestors.add(sourceValue);
  try {
    const snapshot: Record<string, JsonValue> = Object.create(null);
    for (const key of Object.keys(source)) {
      if (!key.isWellFormed()) fail("lone-surrogate", path);
      const childPath = appendPropertyPath(path, key);
      defineJsonProperty(
        snapshot,
        key,
        parseValue(source[key], childPath, ancestors, depth + 1),
      );
    }
    return Object.freeze(snapshot);
  } finally {
    ancestors.delete(sourceValue);
  }
}

function parseValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  depth: number,
): JsonValue {
  if (depth > JSON_VALUE_MAXIMUM_DEPTH) fail("maximum-depth", path);
  if (value === null || typeof value === "boolean") return value;

  if (typeof value === "string") {
    if (!value.isWellFormed()) fail("lone-surrogate", path);
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("non-finite-number", path);
    if (Object.is(value, -0)) fail("negative-zero", path);
    return value;
  }

  if (typeof value !== "object") fail("unsupported-type", path);

  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    // 这里只可能因为已经撤销的 Proxy 而失败；不得读取代理目标或向外暴露原始异常。
    fail("proxy", path);
  }

  if (ancestors.has(value)) fail("cycle", path);
  return isArray
    ? parseArrayValue(value, path, ancestors, depth)
    : parseObjectValue(value, path, ancestors, depth);
}

/**
 * 将任意输入解析为独立、递归冻结的 JSON 值。
 *
 * 本函数不做字符串、数字或字段语义的隐式转换。共享引用按 JSON 值语义分别
 * 复制，循环引用会失败；调用方提供的 `errorPath` 只作为安全的结构路径前缀。
 */
export function parseJsonValue(
  value: unknown,
  errorPath?: string,
): JsonValue {
  return parseValue(value, normalizeErrorPath(errorPath), new Set<object>(), 0);
}
