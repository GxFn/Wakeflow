import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  previewWakeflowMaintenanceExecution,
} from "../../workspace/maintenance/wakeflow-maintenance-execution-preview.js";
import {
  executeWakeflowMaintenanceExecutionTransaction,
  recoverWakeflowMaintenanceExecutionTransaction,
  type WakeflowMaintenanceExecutionTransactionOptions,
} from "../../workspace/maintenance/wakeflow-maintenance-execution-transaction.js";
import type {
  WakeflowStaticMaterializationPreviewRequest,
} from "../../workspace/maintenance/wakeflow-static-materialization-preview-contract.js";
import {
  claudeCodeMaintenanceCapability,
} from "./claude-code-maintenance-capability.js";

/**
 * Wakeflow Host / Claude Code：Claude 维护执行的固定 composition root。
 *
 * 调用方无需也不能自行选择 capability；preview、normal execution 与 recovery 始终绑定
 * 同一个 Claude 闭合实现和共享唯一 journal。
 */

/** 构建包含 Claude portable settings 的零写入聚合计划。 */
export async function previewClaudeCodeMaintenanceExecution(
  root: RootedDirectory,
  request: WakeflowStaticMaterializationPreviewRequest,
) {
  return previewWakeflowMaintenanceExecution(
    root,
    request,
    claudeCodeMaintenanceCapability,
  );
}

/** 执行已经确认且重新验证后的 Claude 聚合维护计划。 */
export async function executeClaudeCodeMaintenanceExecution(
  root: RootedDirectory,
  plan: unknown,
  request: WakeflowStaticMaterializationPreviewRequest,
  options: WakeflowMaintenanceExecutionTransactionOptions = {},
) {
  return executeWakeflowMaintenanceExecutionTransaction(
    root,
    plan,
    request,
    claudeCodeMaintenanceCapability,
    options,
  );
}

/** 只凭operation ID与私有intent/journal恢复同一Claude维护事务。 */
export async function recoverClaudeCodeMaintenanceExecution(
  root: RootedDirectory,
  operationId: unknown,
  options: Omit<WakeflowMaintenanceExecutionTransactionOptions, "uuidFactory"> = {},
) {
  return recoverWakeflowMaintenanceExecutionTransaction(
    root,
    operationId,
    claudeCodeMaintenanceCapability,
    options,
  );
}
