import { Ajv2020 } from "ajv/dist/2020.js";

import {
  type JsonArray,
  type JsonObject,
  type JsonValue,
  JsonValueError,
  parseJsonValue,
} from "../data/json-value.js";
import { PassiveOwnDataError, parseDenseArray } from "../data/passive-own-data.js";

/**
 * Wakeflow Foundation / Schema：受信任本地 JSON Schema 的一次编译、多次验证入口。
 *
 * Schema 常量及其外部依赖先转换为 `JsonValue` 快照，再交给 Ajv 2020 严格模式
 * 编译。返回的校验器只接收已经由调用方准入为 `JsonValue` 的数据，并立即把 Ajv
 * 的可变错误列表转换为冻结的成功或失败结果。
 *
 * 本层不加载网络 Schema、不选择领域 Schema、不解释校验关键字、不移除字段，也不
 * 应用默认值或类型强制转换。Schema 校验通过不等同于领域关系成立、权威事实成立
 * 或获得写入授权。
 */

export interface RuntimeJsonSchemaValidationSuccess<Value> {
  readonly ok: true;
  readonly value: Value;
}

export interface RuntimeJsonSchemaValidationFailure {
  readonly ok: false;
  readonly path: string;
  /**
   * 第一条失败的规则，令牌形：`required:storage`、`additional:extra`、`enum`、`type:string`、`oneOf`…
   * 只含 `[A-Za-z0-9_.:-]`、不超过 128 字符，可以直接进公共错误的 details（§13.181 F-L1-1）。
   */
  readonly detail: string;
}

export type RuntimeJsonSchemaValidation<Value> =
  | Readonly<RuntimeJsonSchemaValidationSuccess<Value>>
  | Readonly<RuntimeJsonSchemaValidationFailure>;

export type RuntimeJsonSchemaValidator<Value> = (
  value: JsonValue,
) => RuntimeJsonSchemaValidation<Value>;

export type RuntimeJsonSchemaErrorReason = "schema-input" | "schema-dependency" | "schema-compile";

const ERROR_MESSAGES = {
  "schema-input": "Runtime JSON Schema input is invalid.",
  "schema-dependency": "Runtime JSON Schema dependency catalog is invalid.",
  "schema-compile": "Runtime JSON Schema catalog could not be compiled strictly.",
} as const satisfies Readonly<Record<RuntimeJsonSchemaErrorReason, string>>;

/** 运行时 Schema 目录构建或编译失败时返回的稳定、脱敏错误。 */
export class RuntimeJsonSchemaError extends Error {
  override readonly name = "RuntimeJsonSchemaError";
  readonly code = "wakeflow-runtime-json-schema" as const;
  readonly reason: RuntimeJsonSchemaErrorReason;
  readonly path: string;

  constructor(reason: RuntimeJsonSchemaErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: RuntimeJsonSchemaErrorReason, path: string): never {
  throw new RuntimeJsonSchemaError(reason, path);
}

function schemaObject(
  value: unknown,
  path: string,
  reason: "schema-input" | "schema-dependency",
): JsonObject {
  let admitted: JsonValue;
  try {
    admitted = parseJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail(reason, error.path);
    throw error;
  }
  if (admitted === null || Array.isArray(admitted) || typeof admitted !== "object") {
    fail(reason, path);
  }
  // 上述准入已经排除原始值和 JsonArray；此处恢复 TypeScript 无法保留的只读类型收窄。
  return admitted as JsonObject;
}

function dependencySchemas(value: unknown): readonly JsonObject[] {
  let dependencies: readonly unknown[];
  try {
    dependencies = parseDenseArray(value, 64, "$dependencies");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail("schema-dependency", error.path);
    }
    throw error;
  }
  const result: JsonObject[] = [];
  const ids = new Set<string>();
  for (const [index, dependency] of dependencies.entries()) {
    const path = `$dependencies/${index}`;
    const schema = schemaObject(dependency, path, "schema-dependency");
    const id = schema.$id;
    if (typeof id !== "string" || id.length === 0 || ids.has(id)) {
      fail("schema-dependency", `${path}/$id`);
    }
    ids.add(id);
    result.push(schema);
  }
  return Object.freeze(result);
}

const DETAIL_PATTERN = /[^A-Za-z0-9_.:-]+/gu;
const DETAIL_MAXIMUM = 128;

function detailToken(value: unknown): string {
  return String(value)
    .replace(DETAIL_PATTERN, "-")
    .replace(/^-+|-+$/gu, "");
}

/** 每个关键字最能定位的参数名：缺的属性、多出的属性、期望的类型或常量。 */
const DETAIL_PARAMETER_KEYS: Readonly<Record<string, string>> = Object.freeze({
  required: "missingProperty",
  additionalProperties: "additionalProperty",
  type: "type",
  const: "allowedValue",
});

/** 把 Ajv 的第一条错误压成一个令牌：关键字加上最能定位的参数。 */
function validationDetail(
  error: Readonly<{ keyword?: string; params?: unknown }> | undefined,
): string {
  if (error === undefined) return "unknown";
  const keyword = detailToken(error.keyword ?? "unknown") || "unknown";
  const parameterKey = DETAIL_PARAMETER_KEYS[keyword];
  const params = (error.params ?? {}) as Readonly<Record<string, unknown>>;
  const parameter = parameterKey === undefined ? undefined : params[parameterKey];
  const label = keyword === "additionalProperties" ? "additional" : keyword;
  const token = parameter === undefined ? label : `${label}:${detailToken(parameter)}`;
  return token.slice(0, DETAIL_MAXIMUM) || "unknown";
}

function validationPath(instancePath: string): string {
  return instancePath.length === 0 ? "$" : `$${instancePath}`;
}

/** 不调用对象方法地比较两个已准入JSON值，成员顺序不影响对象相等性。 */
function sameJsonValue(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;
  if (leftIsArray) {
    const leftArray = left as JsonArray;
    const rightArray = right as JsonArray;
    return (
      leftArray.length === rightArray.length &&
      leftArray.every((entry, index) => {
        const other = rightArray[index];
        return other !== undefined && sameJsonValue(entry, other);
      })
    );
  }
  const leftRecord = left as JsonObject;
  const rightRecord = right as JsonObject;
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) return false;
  return leftKeys.every((key) => {
    if (!Object.hasOwn(rightRecord, key)) return false;
    const leftValue = leftRecord[key];
    const rightValue = rightRecord[key];
    return (
      leftValue !== undefined && rightValue !== undefined && sameJsonValue(leftValue, rightValue)
    );
  });
}

/** JSON Schema `uniqueItems`的无原型安全实现。 */
function uniqueJsonItems(enabled: boolean, value: unknown): boolean {
  if (!enabled || !Array.isArray(value)) return true;
  const items = value as JsonArray;
  for (let right = 1; right < items.length; right += 1) {
    const rightItem = items[right];
    if (rightItem === undefined) continue;
    for (let left = 0; left < right; left += 1) {
      const leftItem = items[left];
      if (leftItem !== undefined && sameJsonValue(leftItem, rightItem)) return false;
    }
  }
  return true;
}

/**
 * 为不访问网络的本地 Schema 目录返回可复用的校验器。
 *
 * Schema 目录的形状与 `$id` 在调用时立即准入；Ajv 实例与编译推迟到第一次校验，
 * 因此在模块初始化时创建校验器不再产生编译成本，未被使用的校验器永远不编译。
 * 每个校验器拥有独立的 Ajv 实例，避免不同领域 Schema 目录的 `$id`、格式或错误
 * 状态相互污染；编译失败在第一次校验时以 `schema-compile` 报出。
 */
export function createRuntimeJsonSchemaValidator<Value>(
  rootSchema: unknown,
  dependencies: readonly unknown[] = [],
): RuntimeJsonSchemaValidator<Value> {
  const root = schemaObject(rootSchema, "$schema", "schema-input");
  const admittedDependencies = dependencySchemas(dependencies);
  let compiled: ((value: JsonValue) => RuntimeJsonSchemaValidation<Value>) | null = null;
  return (value: JsonValue): RuntimeJsonSchemaValidation<Value> => {
    if (compiled === null) {
      compiled = compileRuntimeJsonSchemaValidator<Value>(root, admittedDependencies);
    }
    return compiled(value);
  };
}

function compileRuntimeJsonSchemaValidator<Value>(
  root: JsonObject,
  admittedDependencies: readonly JsonObject[],
): (value: JsonValue) => RuntimeJsonSchemaValidation<Value> {
  const ajv = new Ajv2020({
    allErrors: false,
    strict: true,
    validateSchema: true,
  });
  ajv.addFormat("regex", {
    type: "string",
    validate(value: string): boolean {
      try {
        new RegExp(value, "u");
        return true;
      } catch {
        return false;
      }
    },
  });
  ajv.removeKeyword("uniqueItems");
  ajv.addKeyword({
    keyword: "uniqueItems",
    type: "array",
    schemaType: "boolean",
    validate: uniqueJsonItems,
    errors: false,
  });
  ajv.addKeyword({
    keyword: "x-wakeflow-runtime-export",
    schemaType: "string",
    valid: true,
    errors: false,
  });

  let validate: ReturnType<Ajv2020["compile"]>;
  try {
    for (const dependency of admittedDependencies) {
      ajv.addSchema(dependency, dependency.$id as string);
    }
    validate = ajv.compile<Value>(root as unknown as object);
  } catch {
    fail("schema-compile", "$schema");
  }

  return (value: JsonValue): RuntimeJsonSchemaValidation<Value> => {
    if (validate(value)) {
      return Object.freeze({ ok: true, value: value as Value });
    }
    const first = validate.errors?.[0];
    return Object.freeze({
      ok: false,
      path: validationPath(first?.instancePath ?? ""),
      detail: validationDetail(first),
    });
  };
}
