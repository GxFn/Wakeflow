/**
 * 第 0 级纯逻辑测试：按码点截断（Codex 审阅 S2、R-ROOT-05 的共享助手）。
 */
import { equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { truncateToCodePoints } from "../../../src/foundation/text/bounded-text.js";

test("不超过上限的文本原样返回；超过时结果恰为上限个码点并以省略号结尾", () => {
  equal(truncateToCodePoints("abc", 3), "abc");
  equal(truncateToCodePoints("", 0), "");
  equal(truncateToCodePoints("abcdef", 4), "abc…");
  equal([...truncateToCodePoints("abcdef", 4)].length, 4);
  equal(truncateToCodePoints("需求包的摘要文本", 5), "需求包的…");
});

test("代理对从不被切开：emoji 横跨截断点时整个保留或整个去掉，结果 well-formed", () => {
  const text = `${"a".repeat(3)}😀😀😀`;
  for (const maximum of [1, 2, 3, 4, 5, 6, 7]) {
    const bounded = truncateToCodePoints(text, maximum);
    equal(bounded.isWellFormed(), true, `maximum ${maximum}`);
    equal([...bounded].length <= maximum, true, `maximum ${maximum}`);
  }
  equal(truncateToCodePoints("ab😀", 2, { ellipsis: "" }), "ab");
  equal(truncateToCodePoints("ab😀cd", 3, { ellipsis: "" }), "ab😀");
});

test("省略号可定制并计入上限；上限小于省略号时只给省略号的前缀；非法上限抛 RangeError", () => {
  equal(truncateToCodePoints("abcdef", 5, { ellipsis: "..." }), "ab...");
  equal(truncateToCodePoints("abcdef", 2, { ellipsis: "..." }), "..");
  equal(truncateToCodePoints("abcdef", 0), "");
  throws(() => truncateToCodePoints("abc", -1), RangeError);
  throws(() => truncateToCodePoints("abc", 1.5), RangeError);
});
