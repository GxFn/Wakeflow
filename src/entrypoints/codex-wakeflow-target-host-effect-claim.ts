import { executeTargetHostEffectClaimPublicRequest } from "../governance/delivery/target-host-effect-claim-public-coordinator.js";
import { codexWindowHostIdentityProfile } from "../hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../hosts/codex/wakeflow-workspace-host-resource-profile.js";

/** Codex制品固定的Target Host Effect Claim公共composition root。 */
const CODEX_TARGET_HOST_EFFECT_CLAIM_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});

/** 使用Codex Profile执行一个共享Implementation/Test Claim请求。 */
export async function executeCodexTargetHostEffectClaim(value: unknown) {
  return executeTargetHostEffectClaimPublicRequest(
    CODEX_TARGET_HOST_EFFECT_CLAIM_FACADE,
    value,
  );
}
