/**
 * Wakeflow Governance / Pod：closing pod 仍在的检出的处置引导（gate-log §13.94 D10）。
 *
 * Wakeflow 从不删除 worktree（ADR-0010 D4）：这里只给 Agent 一条建议命令与一条宿主备选，
 * pod 关闭结果与 status 的 pod 段共用。路径是相对工作区根的相对路径，不含绝对路径。
 *
 * 建议命令会进入 status 结果的 `singleLineText` 字段（无控制字符、至多 512），所以路径在
 * 这里就按投影 `inline()` 的同一套规则单行化并有界化：异常路径只让这一条命令降级，
 * 绝不能让整份 status 结果被准入拒绝——恰恰是操作者最需要这条引导的时刻。
 */
/** 与 `wakeflow-status-result.schema.json` 的 `$defs.singleLineText.maxLength` 一致。 */
const SUGGESTED_MAXIMUM_LENGTH = 512;
const REMOVE_COMMAND_PREFIX = "git worktree remove ";
const TRUNCATION_MARK = "…";
function isControlCodePoint(codePoint) {
    return (codePoint < 0x20 ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029);
}
/** 单行化：控制码位换成空格，压缩空白并去掉首尾空白；清洗后为空则回落到工作区根。 */
function singleLinePath(value) {
    let stripped = "";
    for (const character of value) {
        stripped += isControlCodePoint(character.codePointAt(0) ?? 0) ? " " : character;
    }
    const cleaned = stripped.replace(/\s+/gu, " ").trim();
    return cleaned.length === 0 ? "." : cleaned;
}
/** 有界化：越界时按码位截断路径并加省略号，永不切断代理对，永不越过上界。 */
function removeCommand(relativePath) {
    const command = `${REMOVE_COMMAND_PREFIX}${relativePath}`;
    if (command.length <= SUGGESTED_MAXIMUM_LENGTH)
        return command;
    const budget = SUGGESTED_MAXIMUM_LENGTH - REMOVE_COMMAND_PREFIX.length - TRUNCATION_MARK.length;
    let kept = "";
    for (const character of relativePath) {
        if (kept.length + character.length > budget)
            break;
        kept += character;
    }
    return `${REMOVE_COMMAND_PREFIX}${kept}${TRUNCATION_MARK}`;
}
export function worktreeDisposalGuidance(hostId, relativeCheckoutPath) {
    return Object.freeze({
        suggested: removeCommand(singleLinePath(relativeCheckoutPath)),
        alternative: hostId === "claude-code"
            ? "End the Claude Code worktree session; Claude Code removes a worktree it created when the session ends, then run git worktree prune in the repository."
            : "Archive the Codex thread that owns the worktree environment, then run git worktree prune in the repository.",
    });
}
