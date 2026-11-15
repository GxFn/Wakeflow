/**
 * 第 0 级纯逻辑测试：closing pod 的检出处置引导（gate-log §13.94 D10，§13.130 的加锁形式；
 * Codex 审阅 R-ROOT-08，open-items W15）。建议命令必须始终能进入 status 结果——
 * `wakeflow-status-result.schema.json` 的 `$defs.singleLineText` 要求无 Cc 控制字符、长度至多
 * 512——同时路径是身份：命令里的路径只做 POSIX 单引号引用、每个码位原样保留；不能原样写进
 * 一行的路径换成一句不含路径的说明，而不是折叠或截断出一条指向别处的命令。
 */
import { equal, notEqual } from "node:assert/strict";
import { test } from "node:test";

import { worktreeDisposalGuidance } from "../../../src/governance/pod/worktree-disposal.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";

const SINGLE_LINE_TEXT_MAXIMUM_LENGTH = 512;
/**
 * 命令从工作区根执行：`git -C <检出> worktree … .` 让 git 从检出找到它所属的产品仓库。此前的
 * `git worktree remove <路径>` 在工作区根上找不到这个检出（1.3.0 终验，open-items Z12）。
 */
const remove = (word: string) => `git -C ${word} worktree remove .`;
const unlock = (word: string) => `git -C ${word} worktree unlock .`;
const UNLOCK_SEPARATOR = "; ";
const NO_CONTROL_CHARACTERS = /^\P{Cc}+$/u;

/** 路径不可原样表示时的两句说明：不含路径，加锁的那句多出解锁步骤。 */
const UNREPRESENTABLE_UNLOCKED =
  "The checkout path cannot be quoted verbatim in a single-line suggestion. Run git worktree list in the product repository, confirm the checkout registered for this pod from that output, then remove it with git worktree remove.";
const UNREPRESENTABLE_LOCKED =
  "The checkout path cannot be quoted verbatim in a single-line suggestion. Run git worktree list in the product repository, confirm the checkout registered for this pod from that output, unlock it with git worktree unlock, then remove it with git worktree remove.";

/** 一条足够长的真实形状相对路径素材，按需切到精确长度。 */
const DEEP_RELATIVE_PATH = "workspaces/product-alpha/".repeat(40);

test("路径里的连续空白与首尾空白原样进入引用后的命令，不被压成一个空格（R-ROOT-08，W15）", () => {
  equal(
    worktreeDisposalGuidance("git-worktree", "worktree  alpha", false).suggested,
    remove("'worktree  alpha'"),
  );
  equal(worktreeDisposalGuidance("git-worktree", " a ", false).suggested, remove("' a '"));
  equal(
    worktreeDisposalGuidance("claude-worktree-flag", "worktree  alpha", true).suggested,
    `${unlock("'worktree  alpha'")}${UNLOCK_SEPARATOR}${remove("'worktree  alpha'")}`,
  );
});

test("建议命令在 singleLineText 上界处原样保留，越界时换成不含路径的说明而不是截断", () => {
  const room = SINGLE_LINE_TEXT_MAXIMUM_LENGTH - remove("").length;

  const atBound = DEEP_RELATIVE_PATH.slice(0, room);
  const at = worktreeDisposalGuidance("git-worktree", atBound, false);
  equal(at.suggested, remove(atBound));
  equal(at.suggested.length, SINGLE_LINE_TEXT_MAXIMUM_LENGTH);

  const overBound = DEEP_RELATIVE_PATH.slice(0, room + 1);
  const over = worktreeDisposalGuidance("git-worktree", overBound, false);
  equal(over.suggested, UNREPRESENTABLE_UNLOCKED);
  equal(over.suggested.includes("workspaces/product-alpha"), false);
  equal(over.suggested.includes("…"), false);
});

test("越界判断把引号与转义计入：恰好 512 的引用命令原样保留，再多一个码位就换成说明", () => {
  // 25（命令的固定部分）+ 2（引号）+ 1（a）+ 4（'\''）+ n（b）= 512 ⇒ n = 480。
  const atBound = `a'${"b".repeat(480)}`;
  const at = worktreeDisposalGuidance("git-worktree", atBound, false);
  equal(at.suggested, remove(`'a'\\''${"b".repeat(480)}'`));
  equal(at.suggested.length, SINGLE_LINE_TEXT_MAXIMUM_LENGTH);

  const overBound = `a'${"b".repeat(481)}`;
  equal(
    worktreeDisposalGuidance("git-worktree", overBound, false).suggested,
    UNREPRESENTABLE_UNLOCKED,
  );
});

test("含控制字符、换行或行分隔符的路径不给带路径的命令，建议与备选都留在 singleLineText 的字符集里", () => {
  const guidance = worktreeDisposalGuidance(
    "claude-worktree-flag",
    "worktrees/product\nalpha\tbeta gamma",
    false,
  );
  equal(guidance.suggested, UNREPRESENTABLE_UNLOCKED);
  equal(guidance.suggested.includes("worktrees/"), false);
  equal(NO_CONTROL_CHARACTERS.test(guidance.suggested), true);
  equal(NO_CONTROL_CHARACTERS.test(guidance.alternative), true);
  equal(guidance.alternative.length <= SINGLE_LINE_TEXT_MAXIMUM_LENGTH, true);

  for (const path of ["work\u007ftree", "work\u0085tree", "work\u2028tree", "work\u2029tree"]) {
    equal(
      worktreeDisposalGuidance("git-worktree", path, false).suggested,
      UNREPRESENTABLE_UNLOCKED,
    );
    equal(worktreeDisposalGuidance("git-worktree", path, true).suggested, UNREPRESENTABLE_LOCKED);
  }
});

test("带空格或 shell 元字符的检出路径整体加单引号，单引号写成 '\\''，加锁时 unlock 与 remove 用同一个引用（§13.130 审查）", () => {
  equal(
    worktreeDisposalGuidance("git-worktree", "work trees/a b", false).suggested,
    "git -C 'work trees/a b' worktree remove .",
  );
  equal(
    worktreeDisposalGuidance("git-worktree", "it's/here", false).suggested,
    "git -C 'it'\\''s/here' worktree remove .",
  );
  equal(
    worktreeDisposalGuidance("git-worktree", "x;rm -rf $(y)", true).suggested,
    "git -C 'x;rm -rf $(y)' worktree unlock .; git -C 'x;rm -rf $(y)' worktree remove .",
  );
});

test("长度按 UTF-16 码元计（比 Schema 的码位数保守）：星号面路径放得下时原样保留，放不下时整条换成说明而不是按码位截断", () => {
  // 25 + 2n ≤ 512 ⇒ n ≤ 243（511 个码元）；244 个就是 513。
  const atBound = "𝔞".repeat(243);
  const at = worktreeDisposalGuidance("git-worktree", atBound, false);
  equal(at.suggested, remove(atBound));
  equal(at.suggested.length, SINGLE_LINE_TEXT_MAXIMUM_LENGTH - 1);

  const over = worktreeDisposalGuidance("git-worktree", "𝔞".repeat(244), false);
  equal(over.suggested, UNREPRESENTABLE_UNLOCKED);
  equal(over.suggested.includes("𝔞"), false);
});

test("空路径与只含控制字符的路径不产生命令；只含空格的路径按原样引用", () => {
  equal(worktreeDisposalGuidance("git-worktree", "", false).suggested, UNREPRESENTABLE_UNLOCKED);
  equal(worktreeDisposalGuidance("git-worktree", "", true).suggested, UNREPRESENTABLE_LOCKED);
  equal(
    worktreeDisposalGuidance("git-worktree", "   \n\t  ", false).suggested,
    UNREPRESENTABLE_UNLOCKED,
  );
  equal(worktreeDisposalGuidance("git-worktree", "   ", false).suggested, remove("'   '"));
});

test("不可表示时的两句说明本身满足 singleLineText、不是命令，加锁的那句多出解锁步骤", () => {
  for (const sentence of [UNREPRESENTABLE_UNLOCKED, UNREPRESENTABLE_LOCKED]) {
    equal(NO_CONTROL_CHARACTERS.test(sentence), true);
    equal(sentence.length <= SINGLE_LINE_TEXT_MAXIMUM_LENGTH, true);
    equal(sentence.startsWith("git "), false);
    equal(sentence.includes("git worktree list"), true);
  }
  notEqual(UNREPRESENTABLE_LOCKED, UNREPRESENTABLE_UNLOCKED);
  equal(UNREPRESENTABLE_UNLOCKED.includes("git worktree unlock"), false);
  equal(UNREPRESENTABLE_LOCKED.includes("git worktree unlock"), true);
});

test("登记时加锁的检出先解锁再删（§13.130）：同一路径出现两次，用 ; 连接，未加锁仍是单条 remove", () => {
  const checkout = "Alembic/.claude/worktrees/wakeflow-round7";
  const locked = worktreeDisposalGuidance("claude-worktree-flag", checkout, true);
  equal(locked.suggested, `${unlock(checkout)}${UNLOCK_SEPARATOR}${remove(checkout)}`);
  equal(
    locked.suggested,
    "git -C Alembic/.claude/worktrees/wakeflow-round7 worktree unlock .; git -C Alembic/.claude/worktrees/wakeflow-round7 worktree remove .",
  );
  const unlocked = worktreeDisposalGuidance("claude-worktree-flag", checkout, false);
  equal(unlocked.suggested, remove(checkout));
  equal(locked.alternative, unlocked.alternative);
});

test("加锁形式的上界：两处路径都放得下时原样保留，放不下时换成带解锁步骤的说明", () => {
  const fixed = unlock("").length + UNLOCK_SEPARATOR.length + remove("").length;
  const room = Math.floor((SINGLE_LINE_TEXT_MAXIMUM_LENGTH - fixed) / 2);

  const atBound = DEEP_RELATIVE_PATH.slice(0, room);
  const at = worktreeDisposalGuidance("claude-worktree-flag", atBound, true);
  equal(at.suggested, `${unlock(atBound)}${UNLOCK_SEPARATOR}${remove(atBound)}`);
  equal(at.suggested.length, SINGLE_LINE_TEXT_MAXIMUM_LENGTH);

  const over = worktreeDisposalGuidance("claude-worktree-flag", DEEP_RELATIVE_PATH, true);
  equal(over.suggested, UNREPRESENTABLE_LOCKED);
  equal(over.suggested.includes("workspaces/product-alpha"), false);
  equal(NO_CONTROL_CHARACTERS.test(over.suggested), true);
});

test("宿主备选由宿主 Profile 的 worktree 启动方式选出，文本逐字不变", () => {
  equal(
    worktreeDisposalGuidance(
      claudeCodeWorkspaceHostResourceProfile.surfaces.worktree.launch,
      "w",
      false,
    ).alternative,
    "End the Claude Code worktree session; Claude Code removes a worktree it created when the session ends, then run git worktree prune in the repository.",
  );
  equal(
    worktreeDisposalGuidance(codexWorkspaceHostResourceProfile.surfaces.worktree.launch, "w", false)
      .alternative,
    "Retire the window, remove its assigned checkout with git worktree remove, then prune in the product repository. Archiving its project chat does not remove this checkout.",
  );
});
