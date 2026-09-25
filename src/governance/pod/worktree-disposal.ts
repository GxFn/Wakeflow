import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";

/**
 * Wakeflow Governance / Pod：closing pod 仍在的检出的处置引导（gate-log §13.94 D10）。
 *
 * Wakeflow 从不删除 worktree（ADR-0010 D4）：这里只给 Agent 一条建议命令与一条宿主备选，
 * pod 关闭结果与 status 的 pod 段共用。路径是相对工作区根的相对路径，不含绝对路径。
 *
 * 建议命令会进入 status 结果的 `singleLineText` 字段（无控制字符、至多 512），所以路径在
 * 这里就按投影 `inline()` 的同一套规则单行化并有界化：异常路径只让这一条命令降级，
 * 绝不能让整份 status 结果被准入拒绝——恰恰是操作者最需要这条引导的时刻。含 shell 元字符或
 * 空白的路径按 POSIX 单引号引用，Agent 照原样执行时 git 只收到这一个路径参数。
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

export interface WorktreeDisposalGuidance {
  readonly suggested: string;
  readonly alternative: string;
}

function isControlCodePoint(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

/** 单行化：控制码位换成空格，压缩空白并去掉首尾空白；清洗后为空则回落到工作区根。 */
function singleLinePath(value: string): string {
  let stripped = "";
  for (const character of value) {
    stripped += isControlCodePoint(character.codePointAt(0) ?? 0) ? " " : character;
  }
  const cleaned = stripped.replace(/\s+/gu, " ").trim();
  return cleaned.length === 0 ? "." : cleaned;
}

/**
 * 需要 shell 引用的路径：含 [A-Za-z0-9._/@+-] 之外的 ASCII 字符（空格、`;`、`$`、反引号、引号……）。
 * 非 ASCII 码位（含截断用的省略号）不是 shell 元字符，不触发引用。
 */
const SHELL_UNSAFE_PATH = /[^A-Za-z0-9._/@+\-\u0080-\u{10ffff}]/u;

/** POSIX 单引号引用中一个码位的写法：`'` 写成 `'\''`。 */
function quotedPiece(character: string): string {
  return character === "'" ? "'\\''" : character;
}

/**
 * 按码位截到预算内并加省略号，永不切断代理对；需要引用时整体包进 POSIX 单引号，
 * 引号与转义都计入预算，结果长度永不越过 `budget`。
 */
function shellPathWord(relativePath: string, budget: number): string {
  const quoted = SHELL_UNSAFE_PATH.test(relativePath);
  const wrap = quoted ? 2 : 0;
  const body = (value: string): string => (quoted ? [...value].map(quotedPiece).join("") : value);
  const whole = body(relativePath);
  const word = (value: string): string => (quoted ? `'${value}'` : value);
  if (whole.length + wrap <= budget) return word(whole);
  const room = budget - wrap - TRUNCATION_MARK.length;
  let kept = "";
  for (const character of relativePath) {
    const piece = quoted ? quotedPiece(character) : character;
    if (kept.length + piece.length > room) break;
    kept += piece;
  }
  return word(`${kept}${TRUNCATION_MARK}`);
}

/**
 * 有界化：路径在命令里出现一次（remove）或两次（unlock 再 remove）；两处用同一个截断结果，
 * 整条命令永不越过上界。
 */
function removeCommand(relativePath: string, locked: boolean): string {
  if (!locked) {
    const budget = SUGGESTED_MAXIMUM_LENGTH - REMOVE_COMMAND_PREFIX.length;
    return `${REMOVE_COMMAND_PREFIX}${shellPathWord(relativePath, budget)}`;
  }
  const fixed = UNLOCK_COMMAND_PREFIX.length + UNLOCK_SEPARATOR.length + REMOVE_COMMAND_PREFIX.length;
  const shown = shellPathWord(relativePath, Math.floor((SUGGESTED_MAXIMUM_LENGTH - fixed) / 2));
  return `${UNLOCK_COMMAND_PREFIX}${shown}${UNLOCK_SEPARATOR}${REMOVE_COMMAND_PREFIX}${shown}`;
}

/** `locked` 是登记时回执记下的锁状态（`git worktree list --porcelain` 的 locked 行）。 */
export function worktreeDisposalGuidance(
  hostId: WakeflowHostId,
  relativeCheckoutPath: string,
  locked: boolean,
): Readonly<WorktreeDisposalGuidance> {
  return Object.freeze({
    suggested: removeCommand(singleLinePath(relativeCheckoutPath), locked),
    alternative:
      hostId === "claude-code"
        ? "End the Claude Code worktree session; Claude Code removes a worktree it created when the session ends, then run git worktree prune in the repository."
        : "Archive the Codex thread that owns the worktree environment, then run git worktree prune in the repository.",
  });
}
