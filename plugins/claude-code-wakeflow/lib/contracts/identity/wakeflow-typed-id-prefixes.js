import { WAKEFLOW_DURABLE_ID_KINDS } from "./wakeflow-durable-id.js";
/**
 * Wakeflow Contracts / Identity：所有 `<前缀><uuid>` 形式身份的前缀清单——唯一来源（§13.161 B9-1）。
 *
 * 持久业务身份的前缀由 durable ID kind 派生；窗口绑定与维护操作这两个运行时身份不是 durable
 * kind，却同样出现在公开结果、提示和技能文本里。隐私扫描只放行这里列出的前缀：新增一种带前缀
 * 的身份必须在此登记，否则它的输出会被当作裸 UUID 拒绝。
 */
export const WAKEFLOW_WINDOW_HOST_BINDING_ID_PREFIX = "window_binding_";
export const WAKEFLOW_MAINTENANCE_OPERATION_ID_PREFIX = "maintenance_operation_";
export const WAKEFLOW_TYPED_ID_PREFIXES = Object.freeze([
    ...WAKEFLOW_DURABLE_ID_KINDS.map((kind) => `${kind}_`),
    WAKEFLOW_WINDOW_HOST_BINDING_ID_PREFIX,
    WAKEFLOW_MAINTENANCE_OPERATION_ID_PREFIX,
]);
