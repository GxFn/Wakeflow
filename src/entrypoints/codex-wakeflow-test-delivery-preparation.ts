import { executeTestDeliveryPreparationPublicRequest } from "../governance/testing/test-delivery-preparation-public-coordinator.js";
import { codexWindowHostIdentityProfile } from "../hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../hosts/codex/wakeflow-workspace-host-resource-profile.js";

/** Codex制品固定的Test Delivery Preparation公共composition root。 */
const CODEX_TEST_DELIVERY_PREPARATION_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});

/** 使用Codex Profile执行一个公共Test Delivery Preparation请求。 */
export async function executeCodexTestDeliveryPreparation(value: unknown) {
  return executeTestDeliveryPreparationPublicRequest(
    CODEX_TEST_DELIVERY_PREPARATION_FACADE,
    value,
  );
}
