/**
 * Wakeflow Governance / Pod：closing pod 仍在的检出的处置引导（gate-log §13.94 D10）。
 *
 * Wakeflow 从不删除 worktree（ADR-0010 D4）：这里只给 Agent 一条建议命令与一条宿主备选，
 * pod 关闭结果与 status 的 pod 段共用。路径是相对工作区根的相对路径，不含绝对路径。
 *
 * 建议命令会进入 status 结果的 `singleLineText` 字段（无 Cc 控制字符、至多 512），而路径是
 * 身份：Agent 照原样执行时 git 只收到这一个路径参数，所以命令里的路径必须是回执路径的每个
 * 码位——含连续与首尾空白——只做 POSIX 单引号引用，从不折叠、截断或替换（Codex 审阅
 * R-ROOT-08，open-items W15：此前先单行化再引用，`worktree  alpha` 的建议指向不存在的
 * `worktree alpha`）。路径无法原样写进一行（含控制字符、为空，或连引号后越过预算）时，
 * `suggested` 退成一句不含路径的说明，让操作者按 `git worktree list` 的输出自行确认；
 * 异常路径只让这一条建议降级，绝不能让整份 status 结果被准入拒绝——恰恰是操作者最需要
 * 这条引导的时刻。
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
/**
 * 路径不可原样表示时的说明：不含路径、不是命令，本身满足 `singleLineText`；
 * 加锁与否各一句，解锁步骤不因降级而丢失。
 */
const UNREPRESENTABLE_PATH_GUIDANCE = Object.freeze({
    unlocked: "The checkout path cannot be quoted verbatim in a single-line suggestion. Run git worktree list in the product repository, confirm the checkout registered for this pod from that output, then remove it with git worktree remove.",
    locked: "The checkout path cannot be quoted verbatim in a single-line suggestion. Run git worktree list in the product repository, confirm the checkout registered for this pod from that output, unlock it with git worktree unlock, then remove it with git worktree remove.",
});
/** Cc 控制码位（`singleLineText` 拒绝）加上会把一行拆成两行的 U+2028 / U+2029。 */
function isControlCodePoint(codePoint) {
    return (codePoint < 0x20 ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029);
}
/** 能原样写进一行的路径：非空，且没有一个控制码位。空白（含连续空白）不是障碍，照原样保留。 */
function isSingleLinePath(value) {
    if (value.length === 0)
        return false;
    for (const character of value) {
        if (isControlCodePoint(character.codePointAt(0) ?? 0))
            return false;
    }
    return true;
}
/**
 * 需要 shell 引用的路径：含 [A-Za-z0-9._/@+-] 之外的 ASCII 字符（空格、`;`、`$`、反引号、引号……）。
 * 非 ASCII 码位不是 shell 元字符，不触发引用。
 */
const SHELL_UNSAFE_PATH = /[^A-Za-z0-9._/@+\-\u0080-\u{10ffff}]/u;
/** POSIX 单引号引用中一个码位的写法：`'` 写成 `'\''`。 */
function quotedPiece(character) {
    return character === "'" ? "'\\''" : character;
}
/** 路径在命令里的写法：需要引用时整体包进 POSIX 单引号，每个码位原样保留，不截断。 */
function shellPathWord(relativePath) {
    if (!SHELL_UNSAFE_PATH.test(relativePath))
        return relativePath;
    return `'${[...relativePath].map(quotedPiece).join("")}'`;
}
/**
 * 可执行命令：路径出现一次（remove）或两次（unlock 再 remove）。路径不可原样表示、或整条命令
 * （引号与转义都计入，按 UTF-16 码元数，比 Schema 的码位数保守）越过上界时返回 null——
 * 不折叠、不截断，由调用方换成不含路径的说明。
 */
function removeCommand(relativePath, locked) {
    if (!isSingleLinePath(relativePath))
        return null;
    const word = shellPathWord(relativePath);
    const command = locked
        ? `${UNLOCK_COMMAND_PREFIX}${word}${UNLOCK_SEPARATOR}${REMOVE_COMMAND_PREFIX}${word}`
        : `${REMOVE_COMMAND_PREFIX}${word}`;
    return command.length <= SUGGESTED_MAXIMUM_LENGTH ? command : null;
}
/**
 * 宿主备选按宿主资源 Profile 的 worktree 启动方式选择（`surfaces.worktree.launch`），
 * 共享代码不做宿主 id 判断。
 */
const HOST_ALTERNATIVES = Object.freeze({
    "claude-worktree-flag": "End the Claude Code worktree session; Claude Code removes a worktree it created when the session ends, then run git worktree prune in the repository.",
    "git-worktree": "Retire the window, remove its assigned checkout with git worktree remove, then prune in the product repository. Archiving its project chat does not remove this checkout.",
});
/**
 * `worktreeLaunch` 是当前宿主 Profile 的 `surfaces.worktree.launch`；
 * `locked` 是登记时回执记下的锁状态（`git worktree list --porcelain` 的 locked 行）。
 */
export function worktreeDisposalGuidance(worktreeLaunch, relativeCheckoutPath, locked) {
    return Object.freeze({
        suggested: removeCommand(relativeCheckoutPath, locked) ??
            UNREPRESENTABLE_PATH_GUIDANCE[locked ? "locked" : "unlocked"],
        alternative: HOST_ALTERNATIVES[worktreeLaunch],
    });
}
