import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  executeCodexMaintenanceExecution,
  previewCodexMaintenanceExecution,
  recoverCodexMaintenanceExecution,
} from "../hosts/codex/codex-maintenance-execution.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  executeWakeflowMaintenancePublicRequest,
} from "../workspace/maintenance/wakeflow-maintenance-public-coordinator.js";
import type {
  WakeflowMaintenancePublicHostFacade,
} from "../workspace/maintenance/wakeflow-maintenance-public-host-facade.js";

/**
 * Wakeflow Entrypoint / Codex：Codex 制品的公共 Maintenance composition root。
 *
 * 当前宿主、完整 Profile 集与三项执行能力都在模块装载时固定；公共请求没有 capability
 * 名称、host selector 或 handler registry，因而不能把 Claude 行为注入 Codex 制品。
 */
const CODEX_MAINTENANCE_HOST_PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);

const CODEX_MAINTENANCE_PUBLIC_HOST_FACADE = Object.freeze({
  hostId: "codex",
  currentHostProfile: codexWorkspaceHostResourceProfile,
  hostProfiles: CODEX_MAINTENANCE_HOST_PROFILES,
  preview: previewCodexMaintenanceExecution,
  apply: executeCodexMaintenanceExecution,
  recover: recoverCodexMaintenanceExecution,
}) satisfies Readonly<WakeflowMaintenancePublicHostFacade>;

/** 执行一个经过公共合同准入的 Codex workspace Maintenance 请求。 */
export async function executeCodexWakeflowMaintenance(
  value: unknown,
) {
  return executeWakeflowMaintenancePublicRequest(
    CODEX_MAINTENANCE_PUBLIC_HOST_FACADE,
    value,
  );
}
