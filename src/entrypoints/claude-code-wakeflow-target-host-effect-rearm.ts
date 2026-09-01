import { executeTargetHostEffectRearmPublicRequest } from "../governance/delivery/target-host-effect-rearm-public-coordinator.js";
import { claudeCodeWindowHostIdentityProfile } from "../hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../hosts/claude-code/wakeflow-workspace-host-resource-profile.js";

/** Claude Code制品固定的Implementation Target Host Effect Rearm公共composition root。 */
const CLAUDE_CODE_TARGET_HOST_EFFECT_REARM_FACADE = Object.freeze({
  hostId: "claude-code" as const,
  resourceProfile: claudeCodeWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
});

/** 使用Claude Code Profile显式Rearm一个proved rejected-before-effect尾部。 */
export async function executeClaudeCodeTargetHostEffectRearm(value: unknown) {
  return executeTargetHostEffectRearmPublicRequest(
    CLAUDE_CODE_TARGET_HOST_EFFECT_REARM_FACADE,
    value,
  );
}
