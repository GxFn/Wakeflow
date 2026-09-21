/**
 * Wakeflow Contracts / Vocabulary：宿主标识的封闭词汇。
 *
 * 两个宿主是 Wakeflow 制品的固定目标；内核与切片只用这份词汇，宿主 profile 数据
 * 在 hosts 层按同一标识登记。
 */
export const WAKEFLOW_HOST_IDS = Object.freeze(["codex", "claude-code"]);
export function isWakeflowHostId(value) {
    return typeof value === "string" && WAKEFLOW_HOST_IDS.includes(value);
}
