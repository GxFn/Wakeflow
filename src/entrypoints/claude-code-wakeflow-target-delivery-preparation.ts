import { executeTargetDeliveryPreparationPublicRequest } from "../governance/delivery/target-delivery-preparation-public-coordinator.js";
import { claudeCodeWindowHostIdentityProfile } from "../hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../hosts/claude-code/wakeflow-workspace-host-resource-profile.js";

/** Claude Code制品固定的Implementation Delivery Preparation公共composition root。 */
const CLAUDE_CODE_TARGET_DELIVERY_PREPARATION_FACADE = Object.freeze({
  hostId: "claude-code" as const,
  resourceProfile: claudeCodeWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
});

/** 使用Claude Code Profile执行一个公共Implementation Delivery Preparation请求。 */
export async function executeClaudeCodeTargetDeliveryPreparation(
  value: unknown,
) {
  return executeTargetDeliveryPreparationPublicRequest(
    CLAUDE_CODE_TARGET_DELIVERY_PREPARATION_FACADE,
    value,
  );
}
