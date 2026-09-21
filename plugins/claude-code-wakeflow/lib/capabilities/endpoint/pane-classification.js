/**
 * Wakeflow Capabilities / Endpoint：Claude tmux pane 观察的分类器（能力卡 2.3，ADR-0009）。
 *
 * 输入是 Agent 交回的 `tmux list-panes -a` 行与写在窗口选项里的五个 Wakeflow 标识，
 * 输出是封闭的状态词汇。判定顺序与旧实现一致；只有 `live` 可派发。本模块是纯函数，
 * 不读文件、不执行 tmux。
 */
const TMUX_PANE_STATUSES = Object.freeze([
    "binding-mismatch",
    "host-context-drift",
    "missing",
    "duplicate",
    "coordinate-mismatch",
    "pane-window-mismatch",
    "pane-dead",
    "process-mismatch",
    "metadata-mismatch",
    "live",
]);
const CLAUDE_COMMAND_PATTERN = /(^|[\s/])claude(\s|$)/u;
function sameCoordinates(left, right) {
    return (left.socketName === right.socketName &&
        left.sessionName === right.sessionName &&
        left.windowId === right.windowId &&
        left.paneId === right.paneId);
}
function relatesToLocator(pane, locator) {
    return (pane.options.locatorId === locator.identity.locatorId ||
        pane.options.bindingId === locator.identity.bindingId ||
        sameCoordinates(pane, locator));
}
/** 按固定顺序分类；`live` 之外的每个状态都说明了为什么不能把它当作活着的端点。 */
export function classifyTmuxPanes(locator, expectation, panes) {
    if (locator.identity.bindingId !== expectation.bindingId)
        return "binding-mismatch";
    if (locator.socketName !== expectation.socketName)
        return "host-context-drift";
    const related = panes.filter((pane) => relatesToLocator(pane, locator));
    if (related.length === 0)
        return "missing";
    if (related.length > 1)
        return "duplicate";
    const observed = related[0];
    if (!sameCoordinates(observed, locator))
        return "coordinate-mismatch";
    if (observed.paneWindowId !== locator.windowId)
        return "pane-window-mismatch";
    if (observed.paneDead)
        return "pane-dead";
    if (!CLAUDE_COMMAND_PATTERN.test(observed.currentCommand))
        return "process-mismatch";
    const identity = locator.identity;
    if (observed.options.programId !== identity.programId ||
        observed.options.hostId !== identity.hostId ||
        observed.options.windowId !== identity.windowId ||
        observed.options.bindingId !== identity.bindingId ||
        observed.options.locatorId !== identity.locatorId) {
        return "metadata-mismatch";
    }
    return "live";
}
