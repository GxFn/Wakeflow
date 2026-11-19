/**
 * Wakeflow Contracts / Identity：不是 durable ID kind、却同样以 `<前缀><uuid>` 出现在公开结果、提示和
 * 技能文本里的运行时身份的前缀。
 *
 * 1.3 之前这里还有一张汇总所有前缀的清单，是隐私扫描放行 UUID 的白名单（§13.161 B9-1）；那条规则随
 * 1.4 第 5 段删除（ADR-0031），清单没有别的读者，一并删掉。
 */
export const WAKEFLOW_WINDOW_HOST_BINDING_ID_PREFIX = "window_binding_" as const;
export const WAKEFLOW_MAINTENANCE_OPERATION_ID_PREFIX = "maintenance_operation_" as const;
/** 边界事故记录的 id 前缀（§13.166 G1）：出现在公共错误信封里，所以是登记过的典型化身份。 */
export const WAKEFLOW_INCIDENT_ID_PREFIX = "incident_" as const;
