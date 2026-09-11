/**
 * Wakeflow Contracts / Vocabulary：宿主标识的封闭词汇。
 *
 * 两个宿主是 Wakeflow 制品的固定目标；内核与切片只用这份词汇，宿主 profile 数据
 * 在 hosts 层按同一标识登记。
 */

export const WAKEFLOW_HOST_IDS = Object.freeze(["codex", "claude-code"] as const);

export type WakeflowHostId = (typeof WAKEFLOW_HOST_IDS)[number];

export function isWakeflowHostId(value: unknown): value is WakeflowHostId {
  return typeof value === "string" && (WAKEFLOW_HOST_IDS as readonly string[]).includes(value);
}
