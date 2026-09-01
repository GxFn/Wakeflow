import { executeTargetHostEffectOutcomePublicRequest } from "../governance/delivery/target-host-effect-outcome-public-coordinator.js";

/** Claude Code制品固定的Target Host Effect Outcome公共composition root。 */
const CLAUDE_CODE_TARGET_HOST_EFFECT_OUTCOME_FACADE = Object.freeze({
  hostId: "claude-code" as const,
});

/** 使用Claude Code Host身份记录一个共享Implementation/Test Outcome请求。 */
export async function executeClaudeCodeTargetHostEffectOutcome(value: unknown) {
  return executeTargetHostEffectOutcomePublicRequest(
    CLAUDE_CODE_TARGET_HOST_EFFECT_OUTCOME_FACADE,
    value,
  );
}
