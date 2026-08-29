import {
  executeClaudeCodeMaintenanceExecution,
  previewClaudeCodeMaintenanceExecution,
  recoverClaudeCodeMaintenanceExecution,
} from "../hosts/claude-code/claude-code-maintenance-execution.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
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
 * Wakeflow Entrypoint / Claude Code：Claude Code 制品的公共 Maintenance composition root。
 *
 * 本入口固定组合 Claude portable settings capability；共享协调器只看单宿主端口，
 * 不知道 `.claude` 文件、权限规则或宿主 operation 的含义。
 */
const CLAUDE_CODE_MAINTENANCE_HOST_PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);

const CLAUDE_CODE_MAINTENANCE_PUBLIC_HOST_FACADE = Object.freeze({
  hostId: "claude-code",
  currentHostProfile: claudeCodeWorkspaceHostResourceProfile,
  hostProfiles: CLAUDE_CODE_MAINTENANCE_HOST_PROFILES,
  preview: previewClaudeCodeMaintenanceExecution,
  apply: executeClaudeCodeMaintenanceExecution,
  recover: recoverClaudeCodeMaintenanceExecution,
}) satisfies Readonly<WakeflowMaintenancePublicHostFacade>;

/** 执行一个经过公共合同准入的 Claude Code workspace Maintenance 请求。 */
export async function executeClaudeCodeWakeflowMaintenance(
  value: unknown,
) {
  return executeWakeflowMaintenancePublicRequest(
    CLAUDE_CODE_MAINTENANCE_PUBLIC_HOST_FACADE,
    value,
  );
}
