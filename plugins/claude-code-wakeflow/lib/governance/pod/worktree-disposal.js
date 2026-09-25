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
/**
 * 登记时已加锁的检出（Claude Code 给它用的检出加锁，会话结束后锁仍在）先解锁再删（§13.130）。
 * 用 `;` 而不是 `&&`：锁在登记之后已被释放时 unlock 会失败，remove 仍要照做。
 */
const UNLOCK_COMMAND_PREFIX = "git worktree unlock ";
const UNLOCK_SEPARATOR = "; ";
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
/** 按码位截到预算内并加省略号，永不切断代理对；放得下就原样返回。 */
function boundedPath(relativePath, budget) {
    if (relativePath.length <= budget)
        return relativePath;
    const room = budget - TRUNCATION_MARK.length;
    let kept = "";
    for (const character of relativePath) {
        if (kept.length + character.length > room)
            break;
        kept += character;
    }
    return `${kept}${TRUNCATION_MARK}`;
}
/**
 * 有界化：路径在命令里出现一次（remove）或两次（unlock 再 remove）；两处用同一个截断结果，
 * 整条命令永不越过上界。
 */
function removeCommand(relativePath, locked) {
    if (!locked) {
        const budget = SUGGESTED_MAXIMUM_LENGTH - REMOVE_COMMAND_PREFIX.length;
        return `${REMOVE_COMMAND_PREFIX}${boundedPath(relativePath, budget)}`;
    }
    const fixed = UNLOCK_COMMAND_PREFIX.length + UNLOCK_SEPARATOR.length + REMOVE_COMMAND_PREFIX.length;
    const shown = boundedPath(relativePath, Math.floor((SUGGESTED_MAXIMUM_LENGTH - fixed) / 2));
    return `${UNLOCK_COMMAND_PREFIX}${shown}${UNLOCK_SEPARATOR}${REMOVE_COMMAND_PREFIX}${shown}`;
}
/** `locked` 是登记时回执记下的锁状态（`git worktree list --porcelain` 的 locked 行）。 */
export function worktreeDisposalGuidance(hostId, relativeCheckoutPath, locked) {
    return Object.freeze({
        suggested: removeCommand(singleLinePath(relativeCheckoutPath), locked),
        alternative: hostId === "claude-code"
            ? "End the Claude Code worktree session; Claude Code removes a worktree it created when the session ends, then run git worktree prune in the repository."
            : "Archive the Codex thread that owns the worktree environment, then run git worktree prune in the repository.",
    });
}
