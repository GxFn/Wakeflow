import { equal } from "node:assert/strict";
import { test } from "node:test";

import { worktreeDisposalGuidance } from "../../../src/governance/pod/worktree-disposal.js";

/**
 * closing pod 的检出处置引导（gate-log §13.94 D10）必须始终能进入 status 结果：
 * `wakeflow-status-result.schema.json` 的 `$defs.singleLineText` 要求无 Cc 控制字符、
 * 长度至多 512，所以异常检出路径只能让这一条建议命令降级，绝不能让整份 status 被拒。
 */

const SINGLE_LINE_TEXT_MAXIMUM_LENGTH = 512;
const REMOVE_COMMAND_PREFIX = "git worktree remove ";
const NO_CONTROL_CHARACTERS = /^\P{Cc}+$/u;

/** 一条足够长的真实形状相对路径素材，按需切到精确长度。 */
const DEEP_RELATIVE_PATH = "workspaces/product-alpha/".repeat(40);

test("建议命令在 singleLineText 上界处原样保留，越界时截断回上界之内", () => {
  const room = SINGLE_LINE_TEXT_MAXIMUM_LENGTH - REMOVE_COMMAND_PREFIX.length;

  const atBound = DEEP_RELATIVE_PATH.slice(0, room);
  const at = worktreeDisposalGuidance("codex", atBound);
  equal(at.suggested, `${REMOVE_COMMAND_PREFIX}${atBound}`);
  equal(at.suggested.length, SINGLE_LINE_TEXT_MAXIMUM_LENGTH);

  const overBound = DEEP_RELATIVE_PATH.slice(0, room + 1);
  const over = worktreeDisposalGuidance("codex", overBound);
  equal(over.suggested.length, SINGLE_LINE_TEXT_MAXIMUM_LENGTH);
  equal(over.suggested.startsWith(REMOVE_COMMAND_PREFIX), true);
  equal(over.suggested.endsWith("…"), true);
  equal(over.suggested.slice(REMOVE_COMMAND_PREFIX.length, -1), overBound.slice(0, room - 1));
});

test("控制字符与换行被单行化，建议与备选都留在 singleLineText 的字符集里", () => {
  const guidance = worktreeDisposalGuidance(
    "claude-code",
    "worktrees/product\nalpha\tbeta gamma",
  );

  equal(guidance.suggested, `${REMOVE_COMMAND_PREFIX}worktrees/ product alpha beta gamma`);
  equal(NO_CONTROL_CHARACTERS.test(guidance.suggested), true);
  equal(NO_CONTROL_CHARACTERS.test(guidance.alternative), true);
  equal(guidance.alternative.length <= SINGLE_LINE_TEXT_MAXIMUM_LENGTH, true);
});

test("越界截断按码位进行：不切断代理对，也不越过上界", () => {
  const astral = "𝔞".repeat(300);
  const guidance = worktreeDisposalGuidance("codex", astral);

  equal(guidance.suggested.length <= SINGLE_LINE_TEXT_MAXIMUM_LENGTH, true);
  equal(guidance.suggested, `${REMOVE_COMMAND_PREFIX}${"𝔞".repeat(245)}…`);
  equal(
    [...guidance.suggested].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0xd800 || codePoint > 0xdfff;
    }),
    true,
  );
});

test("清洗后为空的检出路径回落到工作区根，不产生带控制字符的空建议", () => {
  const guidance = worktreeDisposalGuidance("codex", "   \n\t  ");

  equal(guidance.suggested, `${REMOVE_COMMAND_PREFIX}.`);
  equal(NO_CONTROL_CHARACTERS.test(guidance.suggested), true);
});
