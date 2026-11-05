import { parseWakeflowWorkspaceHostResourceProfile } from "../../workspace/workspace-host-resource-profile.js";
import type { WakeflowWorkspaceHostTransportTable } from "../../workspace/host-runtime/wakeflow-host-window-transport.js";

/**
 * Wakeflow Host / Claude Code：资源矩阵所需的 Claude Code 静态值，按窗口传输各一份（ADR-0025）。
 *
 * 本模块只提供宿主资源表面，不导入定位器、活动观察器、设置写入器、生命周期门面
 * 或任何副作用。助手脚本由 Node.js 调用，Profile 只声明普通文件名。tmux 与桌面两种传输并列
 * 一等（双传输规划原则 1）；配置 `hosts.claude-code.windowTransport` 选其一，缺省 tmux，
 * 共享层经 `selectWakeflowWorkspaceHostResourceProfile` 在门面准入时选出一份。
 */

export const CLAUDE_CODE_WINDOW_TRANSPORTS = Object.freeze(["tmux", "desktop"] as const);
export type ClaudeCodeWindowTransport = (typeof CLAUDE_CODE_WINDOW_TRANSPORTS)[number];
export const CLAUDE_CODE_DEFAULT_WINDOW_TRANSPORT: ClaudeCodeWindowTransport = "tmux";

const SHARED_SURFACES = {
  windowIdentity: true,
  podReceipts: true,
  worktree: {
    launch: "claude-worktree-flag",
    attachedDirectories: "add-dir-flag",
  },
  windowLocator: true,
  settingsIntegration: {
    portablePath: ".claude/settings.json",
    localPath: ".claude/settings.local.json",
  },
  // 制品在原路径就地更新：启动记录旧于磁盘制品的会话确定过期（两种传输同一规则）。
  runtimeStaleness: "session-start-observer-digest",
} as const;

/** tmux 传输：pane 里的 `claude`、tmux 助手与状态栏资产；Controller 用助手 `resume --in-place` 自己换代（§13.134）。 */
export const claudeCodeWorkspaceHostResourceProfile = parseWakeflowWorkspaceHostResourceProfile({
  kind: "WakeflowWorkspaceHostResourceProfile",
  hostId: "claude-code",
  runtimeDirectoryName: "claude-code",
  instructionFileName: "CLAUDE.md",
  surfaces: {
    ...SHARED_SURFACES,
    statuslineAsset: {
      fileName: "statusline.mjs",
    },
    helperAsset: {
      fileName: "tmux.mjs",
    },
    runtimeRefresh: "controller-in-place",
  },
  launch: {
    kind: "tmux-session",
    controllerEffort: "max",
    defaultEffort: "xhigh",
    // 缺省 auto：由 Claude Code 自己审每个动作，被引导的用户不必逐条批准常规工具调用；
    // 配置仍可显式选 acceptEdits 或 bypassPermissions（用户裁决 Q4，gate-log §13.134）。
    permissionMode: "auto",
    sessionName: "wakeflow",
  },
});

/**
 * 桌面传输：会话由桌面助手经 `claude --bg` → `claude stop` → `claude --desktop --resume` 送进 Code 标签；
 * 没有状态行（桌面不渲染）；换代由桌面 app 自己完成：空闲的会话进程被结束、下一条消息以当前制品重起，
 * 归档再取消归档可立即结束进程（E5，§13.225），所以过期窗口不由 Controller 重启（`host-next-turn`）。
 */
export const claudeCodeDesktopWorkspaceHostResourceProfile =
  parseWakeflowWorkspaceHostResourceProfile({
    kind: "WakeflowWorkspaceHostResourceProfile",
    hostId: "claude-code",
    runtimeDirectoryName: "claude-code",
    instructionFileName: "CLAUDE.md",
    surfaces: {
      ...SHARED_SURFACES,
      statuslineAsset: null,
      helperAsset: {
        fileName: "desktop.mjs",
      },
      runtimeRefresh: "host-next-turn",
    },
    launch: {
      kind: "desktop-session",
      controllerEffort: "max",
      defaultEffort: "xhigh",
      permissionMode: "auto",
    },
  });

/** 两种传输的 profile 表；共享层只按配置值索引，不认识键的含义。 */
export const claudeCodeWorkspaceHostTransportTable: Readonly<WakeflowWorkspaceHostTransportTable> =
  Object.freeze({
    defaultTransport: CLAUDE_CODE_DEFAULT_WINDOW_TRANSPORT,
    profiles: Object.freeze({
      tmux: claudeCodeWorkspaceHostResourceProfile,
      desktop: claudeCodeDesktopWorkspaceHostResourceProfile,
    }),
  });
