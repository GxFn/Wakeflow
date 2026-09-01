import { executeTargetHostEffectOutcomePublicRequest } from "../governance/delivery/target-host-effect-outcome-public-coordinator.js";

/** Codex制品固定的Target Host Effect Outcome公共composition root。 */
const CODEX_TARGET_HOST_EFFECT_OUTCOME_FACADE = Object.freeze({
  hostId: "codex" as const,
});

/** 使用Codex Host身份记录一个共享Implementation/Test Outcome请求。 */
export async function executeCodexTargetHostEffectOutcome(value: unknown) {
  return executeTargetHostEffectOutcomePublicRequest(
    CODEX_TARGET_HOST_EFFECT_OUTCOME_FACADE,
    value,
  );
}
