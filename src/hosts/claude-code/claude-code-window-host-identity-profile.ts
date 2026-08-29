import {
  parseWakeflowWindowHostIdentityProfile,
} from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";

/** Claude Code session ID 的 opaque Window Host Identity 准入画像。 */
export const claudeCodeWindowHostIdentityProfile =
  parseWakeflowWindowHostIdentityProfile({
    kind: "WakeflowWindowHostIdentityProfile",
    hostId: "claude-code",
    handleKind: "claude-session",
    maximumHandleLength: 1024,
    reservedHandleValues: [
      "current-claude-session",
      "current session",
      "<session id>",
      "current-codex-thread",
      "current thread",
      "<thread id>",
      "unknown",
    ],
  });
