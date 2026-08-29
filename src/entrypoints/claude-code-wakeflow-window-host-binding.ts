import {
  claudeCodeWindowHostIdentityProfile,
} from "../hosts/claude-code/claude-code-window-host-identity-profile.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  executeWakeflowWindowHostBindingPublicRequest,
} from "../workspace/window-runtime/wakeflow-window-host-binding-public-coordinator.js";

/** Claude Code 制品固定的 Window Host Binding 公共 composition root。 */
const CLAUDE_CODE_WINDOW_HOST_BINDING_FACADE = Object.freeze({
  hostId: "claude-code" as const,
  resourceProfile: claudeCodeWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
});

/** 注册 Agent 从 Claude Code 建窗结果观察到的 opaque session ID。 */
export async function executeClaudeCodeWakeflowWindowHostBindingRegistration(
  value: unknown,
) {
  return executeWakeflowWindowHostBindingPublicRequest(
    CLAUDE_CODE_WINDOW_HOST_BINDING_FACADE,
    value,
  );
}
