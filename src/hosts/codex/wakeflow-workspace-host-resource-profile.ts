import {
  parseWakeflowWorkspaceHostResourceProfile,
} from "../../workspace/workspace-host-resource-profile.js";

/**
 * Wakeflow Host / Codex：资源矩阵所需的 Codex 静态值。
 *
 * 本模块只提供宿主静态值，不实现共享解析器、宿主适配器、窗口观察或任何副作用。
 * `keepLive: true` 只表示 Codex 具有该资源表面，不证明真实自动化当前可用。
 */
export const codexWorkspaceHostResourceProfile =
  parseWakeflowWorkspaceHostResourceProfile({
    kind: "WakeflowWorkspaceHostResourceProfile",
    hostId: "codex",
    runtimeDirectoryName: "codex",
    instructionFileName: "AGENTS.md",
    surfaces: {
      windowIdentity: true,
      podEvidence: true,
      keepLive: true,
      windowLocator: false,
      settingsIntegration: null,
      statuslineAsset: null,
      activityMonitor: false,
      temporaryPrompts: false,
    },
  });
