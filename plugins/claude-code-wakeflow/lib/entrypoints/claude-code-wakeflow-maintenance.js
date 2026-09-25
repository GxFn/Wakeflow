import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeWakeflowMaintenancePublicRequest } from "../capabilities/workspace/maintain-workspace.js";
import { executeClaudeCodeMaintenanceExecution, previewClaudeCodeMaintenanceExecution, recoverClaudeCodeMaintenanceExecution, } from "../hosts/claude-code/claude-code-maintenance-execution.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../hosts/codex/wakeflow-workspace-host-resource-profile.js";
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
/** 制品根：lib/entrypoints/<this>.js 的上两级；测试构建里是 .build。 */
const CLAUDE_CODE_ARTIFACT_ROOT = (() => {
    try {
        return realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
    }
    catch {
        return null;
    }
})();
const CLAUDE_CODE_MAINTENANCE_PUBLIC_HOST_FACADE = Object.freeze({
    hostId: "claude-code",
    artifactRoot: CLAUDE_CODE_ARTIFACT_ROOT,
    currentHostProfile: claudeCodeWorkspaceHostResourceProfile,
    hostProfiles: CLAUDE_CODE_MAINTENANCE_HOST_PROFILES,
    preview: previewClaudeCodeMaintenanceExecution,
    apply: executeClaudeCodeMaintenanceExecution,
    recover: recoverClaudeCodeMaintenanceExecution,
});
/** 执行一个经过公共合同准入的 Claude Code workspace Maintenance 请求。 */
export async function executeClaudeCodeWakeflowMaintenance(value) {
    return executeWakeflowMaintenancePublicRequest(CLAUDE_CODE_MAINTENANCE_PUBLIC_HOST_FACADE, value);
}
