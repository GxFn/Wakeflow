/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/foundation/utc-instant.schema.json
 */

/** Wakeflow strict UTC instant profile 的 Schema 派生正则源。 */
export const UTC_INSTANT_PATTERN_SOURCE = "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,9})?Z$" as const;

/** Schema 层的 UTC instant 文本；运行时解析后再授予品牌类型。 */
export type WakeflowUtcInstantText = string;
