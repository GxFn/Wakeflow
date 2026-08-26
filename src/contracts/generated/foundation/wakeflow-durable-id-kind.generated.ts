/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/foundation/wakeflow-durable-id-kind.schema.json
 */

/** Wakeflow 持久类型化身份的 Schema 派生运行时词汇。 */
export const WAKEFLOW_DURABLE_ID_KINDS = Object.freeze([
  "archive",
  "confirmation",
  "demand",
  "demand-event",
  "demand-event-commit",
  "delivery",
  "delivery-run",
  "dispatch-group",
  "dispatch-packet",
  "evidence",
  "pod",
  "pod-design-handoff",
  "pod-design-request",
  "program",
  "preservation",
  "repository",
  "requirement",
  "review-candidate",
  "surface",
  "target-result",
  "target-task",
  "task-package",
  "test-attempt",
  "test-card",
  "window"
] as const);

/** 从同一 Schema enum 派生的持久身份 kind 联合类型。 */
export type WakeflowDurableIdKind =
  (typeof WAKEFLOW_DURABLE_ID_KINDS)[number];
