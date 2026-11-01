/**
 * Wakeflow Capabilities / Endpoint：Claude 桌面会话观察的分类器（ADR-0025 D3）。
 *
 * 输入是 Agent 交回的 `claude agents --json` 会话行，输出是封闭的状态词汇：绑定的句柄值（Claude 会话 id）
 * 在清单里即 present-busy / present-idle，不在即 absent。与 tmux pane 分类器同形：本模块是纯函数，
 * 不读文件、不执行 claude，Agent 不判存活。桌面 id（`local_…`）只在定位器里，不参与匹配。
 */
const DESKTOP_SESSION_STATUSES = Object.freeze(["present-busy", "present-idle", "absent"]);
/** 按会话 id 匹配清单；同一 id 出现多行时只要有一行 busy 就是 present-busy。 */
export function classifyDesktopSessions(sessionId, sessions) {
    const matching = sessions.filter((session) => session.sessionId === sessionId);
    if (matching.length === 0)
        return "absent";
    return matching.some((session) => session.status === "busy") ? "present-busy" : "present-idle";
}
