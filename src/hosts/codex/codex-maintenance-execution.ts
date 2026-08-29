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

/**
 * Wakeflow Host / Codex：Codex 维护执行的固定 composition root。
 *
 * Codex 当前没有静态 workspace 文件贡献，因此只组合共享 Maintenance owner。调用方
 * 无法注入或选择 host capability；将来新增 Codex 专属能力时，也只能在本文件固定接入。
 */

/** 构建仅包含共享静态资源的零写入 Codex 聚合计划。 */
export async function previewCodexMaintenanceExecution(
  root: RootedDirectory,
  request: WakeflowStaticMaterializationPreviewRequest,
) {
  return previewWakeflowMaintenanceExecution(root, request);
}

/** 执行已经确认且重新验证后的 Codex 聚合维护计划。 */
export async function executeCodexMaintenanceExecution(
  root: RootedDirectory,
  plan: unknown,
  request: WakeflowStaticMaterializationPreviewRequest,
  options: WakeflowMaintenanceExecutionTransactionOptions = {},
) {
  return executeWakeflowMaintenanceExecutionTransaction(
    root,
    plan,
    request,
    undefined,
    options,
  );
}

/** 只凭 operation ID 与私有 intent/journal 恢复同一 Codex 维护事务。 */
export async function recoverCodexMaintenanceExecution(
  root: RootedDirectory,
  operationId: unknown,
  options: Omit<WakeflowMaintenanceExecutionTransactionOptions, "uuidFactory"> = {},
) {
  return recoverWakeflowMaintenanceExecutionTransaction(
    root,
    operationId,
    undefined,
    options,
  );
}
