import { executeTargetHostEffectClaimPublicRequest } from "../governance/delivery/target-host-effect-claim-public-coordinator.js";
import { claudeCodeWindowHostIdentityProfile } from "../hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../hosts/claude-code/wakeflow-workspace-host-resource-profile.js";

/** Claude Code制品固定的Target Host Effect Claim公共composition root。 */
const CLAUDE_CODE_TARGET_HOST_EFFECT_CLAIM_FACADE = Object.freeze({
  hostId: "claude-code" as const,
  resourceProfile: claudeCodeWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
});

/** 使用Claude Code Profile执行一个共享Implementation/Test Claim请求。 */
export async function executeClaudeCodeTargetHostEffectClaim(value: unknown) {
  return executeTargetHostEffectClaimPublicRequest(
    CLAUDE_CODE_TARGET_HOST_EFFECT_CLAIM_FACADE,
    value,
  );
}
