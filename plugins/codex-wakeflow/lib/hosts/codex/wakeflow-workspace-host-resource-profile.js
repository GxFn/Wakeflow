import { parseWakeflowWorkspaceHostResourceProfile } from "../../workspace/workspace-host-resource-profile.js";
/**
 * Wakeflow Host / Codex：资源矩阵所需的 Codex 静态值。
 *
 * 本模块只提供宿主静态值，不实现共享解析器、宿主适配器、窗口观察或任何副作用。
 */
export const codexWorkspaceHostResourceProfile = parseWakeflowWorkspaceHostResourceProfile({
    kind: "WakeflowWorkspaceHostResourceProfile",
    hostId: "codex",
    runtimeDirectoryName: "codex",
    instructionFileName: "AGENTS.md",
    surfaces: {
        windowIdentity: true,
        podReceipts: true,
        worktree: {
            launch: "git-worktree",
            attachedDirectories: "prompt-path",
        },
        windowLocator: false,
        settingsIntegration: null,
        statuslineAsset: null,
        tmuxAsset: null,
        // 安装按版本目录并存，没有可信的窗口到 MCP 关联：只报 unverified（ADR-0017 D3）。
        runtimeStaleness: "unverified",
        // 只有用户重启 Codex 应用才重载 MCP（§13.142/§13.148）。
        runtimeRefresh: "user-app-restart",
    },
    launch: { kind: "project-thread" },
});
