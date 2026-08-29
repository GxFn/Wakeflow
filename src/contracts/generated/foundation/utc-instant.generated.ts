/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/foundation/utc-instant.schema.json
 */

/** Wakeflow strict UTC instant profile 的 Schema 派生正则源。 */
export const UTC_INSTANT_PATTERN_SOURCE = "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,9})?Z$" as const;

/** Schema 层的 UTC 时刻文本；运行时解析后再授予品牌类型。 */
export type WakeflowUtcInstantText = string;

/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** 从 JSON 文本恢复 Schema，保留 `__proto__` 等普通 JSON 自有键。 */
function restoreGeneratedSchema(
  serialized: string,
): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(serialized);
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("Generated Schema must be an object.");
  }
  return freezeGeneratedSchema(value as Record<string, unknown>);
}

/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_UTC_INSTANT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:foundation:time:utc-instant:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_UTC_INSTANT_SCHEMA\",\"title\":\"WakeflowUtcInstantText\",\"description\":\"Wakeflow 持久记录与事件使用的严格 UTC instant 文本：四位年份、大写 T/Z，并允许省略小数秒或保留 1 至 9 位小数秒。\",\"$comment\":\"本 Schema 只拥有可移植词法。真实 Gregorian 日历、原文本保留和 epoch nanoseconds 转换由 foundation/time/utc-instant 复验；wall clock、monotonic timeout、时间顺序及领域有效期不属于本 Schema。\",\"type\":\"string\",\"minLength\":20,\"maxLength\":30,\"pattern\":\"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\\\.[0-9]{1,9})?Z$\",\"examples\":[\"2028-02-29T23:59:59Z\",\"2026-08-25T10:20:30.123Z\",\"2026-08-25T10:20:30.123456789Z\"]}");
