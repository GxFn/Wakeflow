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
   * 失败的那条规则，令牌形：`required:storage`、`additional:extra`、`enum:a.b`、`type:string`、`oneOf`…
   * 只含 `[A-Za-z0-9_.:-]`、不超过 128 字符，可以直接进公共错误的 details（§13.181 F-L1-1）。
   * 枚举带上允许的取值；判别联合报的是实例选中的那一支的规则，不是第一支的（ADR-0029：拒绝要可操作）。
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

/** 每个关键字最能定位的参数名：缺的属性、多出的属性、期望的类型、常量或允许的取值。 */
const DETAIL_PARAMETER_KEYS: Readonly<Record<string, string>> = Object.freeze({
  required: "missingProperty",
  additionalProperties: "additionalProperty",
  type: "type",
  const: "allowedValue",
  enum: "allowedValues",
});

const ENUM_VALUE_PATTERN = /^[A-Za-z0-9_-]+$/u;

/** 枚举的取值用 `.` 连成一个令牌；有一个取值不是短记号就不列（只报关键字）。 */
function detailParameter(parameter: unknown): string | undefined {
  if (parameter === undefined) return undefined;
  if (!Array.isArray(parameter)) return detailToken(parameter);
  const values = parameter.filter(
    (value): value is string => typeof value === "string" && ENUM_VALUE_PATTERN.test(value),
  );
  return values.length === parameter.length && values.length > 0 ? values.join(".") : undefined;
}

/** 把 Ajv 的第一条错误压成一个令牌：关键字加上最能定位的参数。 */
function validationDetail(
  error: Readonly<{ keyword?: string; params?: unknown }> | undefined,
): string {
  if (error === undefined) return "unknown";
  const keyword = detailToken(error.keyword ?? "unknown") || "unknown";
  const parameterKey = DETAIL_PARAMETER_KEYS[keyword];
  const params = (error.params ?? {}) as Readonly<Record<string, unknown>>;
  const parameter = detailParameter(parameterKey === undefined ? undefined : params[parameterKey]);
  const label = keyword === "additionalProperties" ? "additional" : keyword;
  const token = parameter === undefined ? label : `${label}:${parameter}`;
  // 取值太多装不下时只报关键字，不报被截断的半个取值。
  return (token.length > DETAIL_MAXIMUM ? label : token) || "unknown";
}

function validationPath(instancePath: string): string {
  return instancePath.length === 0 ? "$" : `$${instancePath}`;
}

interface ValidationError {
  readonly instancePath: string;
  readonly keyword?: string;
  readonly params?: unknown;
}

type SubValidator = ((value: unknown) => boolean) & { errors?: readonly ValidationError[] | null };

interface ResolvedSchemaNode {
  readonly pointer: string;
  readonly node: Readonly<Record<string, unknown>>;
}

interface UnionExplainerContext {
  readonly root: JsonObject;
  readonly subValidator: (pointer: string) => SubValidator | null;
}

const UNION_KEYWORDS: readonly string[] = Object.freeze(["oneOf", "anyOf"]);
const EXPLAIN_MAXIMUM_DEPTH = 8;

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointerSegment(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

function pointerKey(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function childOf(node: unknown, key: string): unknown {
  if (Array.isArray(node)) return node[Number(key)];
  return isPlainObject(node) && Object.hasOwn(node, key) ? node[key] : undefined;
}

function valueAt(start: unknown, keys: readonly string[]): unknown {
  let value = start;
  for (const key of keys) value = childOf(value, key);
  return value;
}

/** 取 JSON 指针指向的 Schema 节点并跟随本文档内的 `$ref`；走不到、或引用指向文档之外，返回 null。 */
function resolveNode(root: JsonObject, pointer: string): ResolvedSchemaNode | null {
  let current = pointer;
  for (let hop = 0; hop < EXPLAIN_MAXIMUM_DEPTH; hop += 1) {
    const node = valueAt(root, current.split("/").slice(1).map(pointerKey));
    if (!isPlainObject(node)) return null;
    const reference = node.$ref;
    if (reference === undefined) return { pointer: current, node };
    if (typeof reference !== "string" || !reference.startsWith("#/")) return null;
    current = reference.slice(1);
  }
  return null;
}

/** 一支里取值固定的成员及其允许的取值。 */
function fixedMembers(
  branch: Readonly<Record<string, unknown>>,
): readonly (readonly [string, readonly unknown[]])[] {
  const properties = isPlainObject(branch.properties) ? branch.properties : {};
  return Object.entries(properties).flatMap(([name, schema]) => {
    const allowed = fixedValues(schema);
    return allowed === null ? [] : [[name, allowed] as const];
  });
}

/** 一个成员 Schema 固定下来的取值：`const` 或 `enum`；都没有返回 null。 */
function fixedValues(schema: unknown): readonly unknown[] | null {
  if (!isPlainObject(schema)) return null;
  if (Object.hasOwn(schema, "const")) return [schema.const];
  return Array.isArray(schema.enum) ? schema.enum : null;
}

/** 这一支里取值固定的成员是否都与实例相符；没有这类成员的一支不算相符。 */
function branchSelected(
  branch: Readonly<Record<string, unknown>>,
  instance: Readonly<Record<string, unknown>>,
): boolean {
  const fixed = fixedMembers(branch);
  return (
    fixed.length > 0 &&
    fixed.every(
      ([name, allowed]) => Object.hasOwn(instance, name) && allowed.includes(instance[name]),
    )
  );
}

/** 实例选中的那一支的指针：恰好一支相符时才有。 */
function selectedBranch(
  context: UnionExplainerContext,
  resolved: ResolvedSchemaNode,
  union: string,
  instance: unknown,
): string | null {
  if (!isPlainObject(instance)) return null;
  const branches = resolved.node[union] as readonly unknown[];
  const selected = branches.flatMap((_branch, index) => {
    const branch = resolveNode(context.root, `${resolved.pointer}/${union}/${index}`);
    return branch !== null && branchSelected(branch.node, instance) ? [branch.pointer] : [];
  });
  return selected.length === 1 ? (selected[0] ?? null) : null;
}

/**
 * 没有一支相符时，说出区分各支的那个成员该取什么：每一支都把同一个成员固定了取值、而实例给的不在其中，
 * 就报这个成员的枚举错误（`kind` 写成了哪一支都不认的词）。各支不是靠同一个成员区分的返回 null。
 */
function unmatchedDiscriminator(
  context: UnionExplainerContext,
  resolved: ResolvedSchemaNode,
  union: string,
  instance: unknown,
  instancePath: string,
): Readonly<ValidationError> | null {
  if (!isPlainObject(instance)) return null;
  const branches = (resolved.node[union] as readonly unknown[]).map((_branch, index) =>
    resolveNode(context.root, `${resolved.pointer}/${union}/${index}`),
  );
  const first = branches[0];
  if (first === undefined || first === null) return null;
  for (const [name] of fixedMembers(first.node)) {
    const allowed = branches.map((branch) =>
      branch === null
        ? undefined
        : fixedMembers(branch.node).find(([member]) => member === name)?.[1],
    );
    if (allowed.some((values) => values === undefined)) continue;
    const values = allowed.flatMap((entry) => entry ?? []);
    if (Object.hasOwn(instance, name) && values.includes(instance[name])) continue;
    return Object.freeze({
      instancePath: `${instancePath}/${pointerSegment(name)}`,
      keyword: Object.hasOwn(instance, name) ? "enum" : "required",
      params: Object.hasOwn(instance, name) ? { allowedValues: values } : { missingProperty: name },
    });
  }
  return null;
}

/** 沿实例路径在 Schema 里往里走一步：对象成员走 `properties`，数组元素走 `items`。 */
function descendStep(root: JsonObject, pointer: string, key: string): string | null {
  const resolved = resolveNode(root, pointer);
  if (resolved === null) return null;
  const { node } = resolved;
  if (isPlainObject(node.properties) && Object.hasOwn(node.properties, key)) {
    return `${resolved.pointer}/properties/${pointerSegment(key)}`;
  }
  return isPlainObject(node.items) && /^[0-9]+$/u.test(key) ? `${resolved.pointer}/items` : null;
}

/** 这一支里还有一层联合没过：沿它的实例路径往里走，报更里面那一支的规则。 */
function explainNested(
  context: UnionExplainerContext,
  pointer: string,
  instance: unknown,
  instancePath: string,
  errors: readonly ValidationError[],
  depth: number,
): Readonly<ValidationError> | null {
  const nested = errors.find((error) => UNION_KEYWORDS.includes(error.keyword ?? ""));
  if (nested === undefined) return null;
  const keys = nested.instancePath.split("/").slice(1).map(pointerKey);
  let inner: string | null = pointer;
  for (const key of keys) {
    if (inner === null) return null;
    inner = descendStep(context.root, inner, key);
  }
  if (inner === null) return null;
  return explainNode(
    context,
    inner,
    valueAt(instance, keys),
    `${instancePath}${nested.instancePath}`,
    depth + 1,
  );
}

function explainNode(
  context: UnionExplainerContext,
  pointer: string,
  instance: unknown,
  instancePath: string,
  depth: number,
): Readonly<ValidationError> | null {
  if (depth > EXPLAIN_MAXIMUM_DEPTH) return null;
  const resolved = resolveNode(context.root, pointer);
  if (resolved === null) return null;
  const union = UNION_KEYWORDS.find((keyword) => Array.isArray(resolved.node[keyword]));
  if (union !== undefined) {
    const branch = selectedBranch(context, resolved, union, instance);
    return branch === null
      ? unmatchedDiscriminator(context, resolved, union, instance, instancePath)
      : explainNode(context, branch, instance, instancePath, depth + 1);
  }
  const validate = context.subValidator(resolved.pointer);
  if (validate === null || validate(instance)) return null;
  const errors = validate.errors ?? [];
  const first = errors[0];
  if (first === undefined) return null;
  return (
    explainNested(context, resolved.pointer, instance, instancePath, errors, depth) ??
    Object.freeze({
      instancePath: `${instancePath}${first.instancePath}`,
      ...(first.keyword === undefined ? {} : { keyword: first.keyword }),
      params: first.params,
    })
  );
}

/**
 * 判别联合的失败说清是哪一支（ADR-0029：拒绝要可操作）。
 *
 * Ajv 对 oneOf / anyOf 报的是每一支各自的第一条错误，排在最前面的往往来自调用方根本没想用的那一支：
 * 提交来源缺 `commitOid` 被报成"缺 root"（那是受管路径那一支的规则）。请求里的联合都靠取值固定的成员
 * 区分（`mode`、`operation`、`kind`…）：实例与恰好一支的这类成员全部相符时，那一支就是调用方想用的，
 * 单独按它再校验一次、报它的错误，并沿着实例路径往里继续找。认不出唯一的一支、走到本文档之外的引用、
 * 或子 Schema 取不出来，都返回 null——调用方照旧报 Ajv 的第一条错误，所以它只会更准，不会更糟。
 */
function createUnionExplainer(
  root: JsonObject,
  subValidator: (pointer: string) => SubValidator | null,
): (value: JsonValue) => Readonly<ValidationError> | null {
  const context: UnionExplainerContext = { root, subValidator };
  return (value) => explainNode(context, "", value, "", 0);
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

  const rootId = typeof root.$id === "string" ? root.$id : null;
  const explainUnion = createUnionExplainer(root, (pointer) => {
    if (pointer === "") return validate as SubValidator;
    if (rootId === null) return null;
    try {
      return (ajv.getSchema(`${rootId}#${pointer}`) as SubValidator | undefined) ?? null;
    } catch {
      return null;
    }
  });

  return (value: JsonValue): RuntimeJsonSchemaValidation<Value> => {
    if (validate(value)) {
      return Object.freeze({ ok: true, value: value as Value });
    }
    const errors = validate.errors ?? [];
    const first = explainUnion(value) ?? errors[0];
    return Object.freeze({
      ok: false,
      path: validationPath(first?.instancePath ?? ""),
      detail: validationDetail(first),
    });
  };
}
