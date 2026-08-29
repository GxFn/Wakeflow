/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/identity/wakeflow-durable-id-kind.schema.json
 */

/** Wakeflow 持久类型化身份的 Schema 派生运行时词汇。 */
export const WAKEFLOW_DURABLE_ID_KINDS = Object.freeze([
  "archive",
  "confirmation",
  "demand",
  "demand-event",
  "demand-event-commit",
  "program",
  "repository",
  "requirement",
  "surface",
  "window"
] as const);

/** 从同一 Schema 枚举派生的持久标识类别联合类型。 */
export type WakeflowDurableIdKind =
  (typeof WAKEFLOW_DURABLE_ID_KINDS)[number];
