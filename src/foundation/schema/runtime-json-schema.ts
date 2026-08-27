import { Ajv2020 } from "ajv/dist/2020.js";

import {
  JsonValueError,
  parseJsonValue,
  type JsonObject,
  type JsonValue,
} from "../data/json-value.js";
import {
  parseDenseArray,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";

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
}

export type RuntimeJsonSchemaValidation<Value> =
  | Readonly<RuntimeJsonSchemaValidationSuccess<Value>>
  | Readonly<RuntimeJsonSchemaValidationFailure>;

export type RuntimeJsonSchemaValidator<Value> = (
  value: JsonValue,
) => RuntimeJsonSchemaValidation<Value>;

export type RuntimeJsonSchemaErrorReason =
  | "schema-input"
  | "schema-dependency"
  | "schema-compile";

const ERROR_MESSAGES = {
  "schema-input": "Runtime JSON Schema input is invalid.",
  "schema-dependency": "Runtime JSON Schema dependency catalog is invalid.",
  "schema-compile": "Runtime JSON Schema catalog could not be compiled strictly.",
} as const satisfies Readonly<Record<
  RuntimeJsonSchemaErrorReason,
  string
>>;

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

function validationPath(instancePath: string): string {
  return instancePath.length === 0 ? "$" : `$${instancePath}`;
}

/**
 * 编译不访问网络的本地 Schema 目录，并返回可复用的校验器。
 *
 * 每次调用都创建独立的 Ajv 实例，避免不同领域 Schema 目录的 `$id`、格式或错误
 * 状态相互污染。调用方应在模块初始化时创建一次校验器，而不是为每次请求重新编译。
 */
export function createRuntimeJsonSchemaValidator<Value>(
  rootSchema: unknown,
  dependencies: readonly unknown[] = [],
): RuntimeJsonSchemaValidator<Value> {
  const root = schemaObject(rootSchema, "$schema", "schema-input");
  const admittedDependencies = dependencySchemas(dependencies);
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
    });
  };
}
