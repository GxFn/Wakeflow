import {
  parseWakeflowWorkspaceHostResourceProfile,
} from "../../workspace/workspace-host-resource-profile.js";

/**
 * Wakeflow Host / Claude Code：资源矩阵所需的 Claude Code 静态值。
 *
 * 本模块只提供宿主资源表面，不导入定位器、活动观察器、设置写入器、生命周期门面
 * 或任何副作用。状态栏脚本由 Node.js 调用，Profile 只声明普通文件名。
 */
export const claudeCodeWorkspaceHostResourceProfile =
  parseWakeflowWorkspaceHostResourceProfile({
    kind: "WakeflowWorkspaceHostResourceProfile",
    hostId: "claude-code",
    runtimeDirectoryName: "claude-code",
    instructionFileName: "CLAUDE.md",
    surfaces: {
      windowIdentity: true,
      podEvidence: true,
      keepLive: true,
      windowLocator: true,
      settingsIntegration: {
        portablePath: ".claude/settings.json",
        localPath: ".claude/settings.local.json",
      },
      statuslineAsset: {
        fileName: "statusline.mjs",
      },
      activityMonitor: true,
      temporaryPrompts: true,
    },
  });
