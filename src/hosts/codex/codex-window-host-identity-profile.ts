import {
  parseWakeflowWindowHostIdentityProfile,
} from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";

/** Codex thread ID 的 opaque Window Host Identity 准入画像。 */
export const codexWindowHostIdentityProfile =
  parseWakeflowWindowHostIdentityProfile({
    kind: "WakeflowWindowHostIdentityProfile",
    hostId: "codex",
    handleKind: "codex-thread",
    maximumHandleLength: 1024,
    reservedHandleValues: [
      "<thread id>",
      "current thread",
      "current-codex-thread",
      "unknown",
    ],
  });
