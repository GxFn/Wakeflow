import {
  codexWindowHostIdentityProfile,
} from "../hosts/codex/codex-window-host-identity-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  executeWakeflowWindowHostBindingPublicRequest,
} from "../workspace/window-runtime/wakeflow-window-host-binding-public-coordinator.js";

/** Codex 制品固定的 Window Host Binding 公共 composition root。 */
const CODEX_WINDOW_HOST_BINDING_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});

/** 注册 Agent 从 Codex `create_thread` 结果观察到的 opaque thread ID。 */
export async function executeCodexWakeflowWindowHostBindingRegistration(
  value: unknown,
) {
  return executeWakeflowWindowHostBindingPublicRequest(
    CODEX_WINDOW_HOST_BINDING_FACADE,
    value,
  );
}
