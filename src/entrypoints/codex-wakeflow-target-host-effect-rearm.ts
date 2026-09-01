import { executeTargetHostEffectRearmPublicRequest } from "../governance/delivery/target-host-effect-rearm-public-coordinator.js";
import { codexWindowHostIdentityProfile } from "../hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../hosts/codex/wakeflow-workspace-host-resource-profile.js";

/** Codex制品固定的Implementation Target Host Effect Rearm公共composition root。 */
const CODEX_TARGET_HOST_EFFECT_REARM_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});

/** 使用Codex Profile显式Rearm一个proved rejected-before-effect尾部。 */
export async function executeCodexTargetHostEffectRearm(value: unknown) {
  return executeTargetHostEffectRearmPublicRequest(
    CODEX_TARGET_HOST_EFFECT_REARM_FACADE,
    value,
  );
}
