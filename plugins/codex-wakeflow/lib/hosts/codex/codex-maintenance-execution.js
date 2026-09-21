import { previewWakeflowMaintenanceExecution, } from "../../workspace/maintenance/wakeflow-maintenance-execution-preview.js";
import { executeWakeflowMaintenanceExecutionTransaction, recoverWakeflowMaintenanceExecutionTransaction, } from "../../workspace/maintenance/wakeflow-maintenance-execution-transaction.js";
import { codexMaintenanceCapability } from "./codex-maintenance-capability.js";
/**
 * Wakeflow Host / Codex：Codex 维护执行的固定 composition root。
 *
 * Codex 没有 settings 或 statusline 这类宿主文件；它唯一的宿主贡献是对账时重建缺失或过期
 * 的窗口运行投影（`codex-maintenance-capability.ts`）。调用方无法注入或选择 host
 * capability；将来新增 Codex 专属能力时，也只能在本文件固定接入。
 */
/** 构建共享静态资源加 Codex 窗口运行投影对账贡献的零写入聚合计划。 */
export async function previewCodexMaintenanceExecution(root, request) {
    return previewWakeflowMaintenanceExecution(root, request, codexMaintenanceCapability);
}
/** 执行已经确认且重新验证后的 Codex 聚合维护计划。 */
export async function executeCodexMaintenanceExecution(root, plan, request, options = {}) {
    return executeWakeflowMaintenanceExecutionTransaction(root, plan, request, codexMaintenanceCapability, options);
}
/** 只凭 operation ID 与私有 intent/journal 恢复同一 Codex 维护事务。 */
export async function recoverCodexMaintenanceExecution(root, operationId, options = {}) {
    return recoverWakeflowMaintenanceExecutionTransaction(root, operationId, codexMaintenanceCapability, options);
}
