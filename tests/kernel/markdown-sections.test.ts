import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  markdownSectionBodyDigest,
  normalizeMarkdownAnchor,
  parseMarkdownListItems,
  parseMarkdownSections,
} from "../../src/kernel/markdown-sections.js";

test("H2 切章：围栏代码块里的标题不算，H3 归入正文，H1 结束章节", () => {
  const text = [
    "# 标题",
    "",
    "## 目标",
    "",
    "让人看懂。",
    "",
    "### 子节",
    "细节。",
    "",
    "```md",
    "## 不是章节",
    "```",
    "",
    "## Non-Goals ##",
    "不做的事。",
    "",
    "# 附录",
    "尾巴",
  ].join("\n");
  const sections = parseMarkdownSections(text);
  deepEqual(
    sections.map((section) => [section.heading, section.anchor, section.line]),
    [
      ["目标", "目标", 3],
      ["Non-Goals", "non-goals", 14],
    ],
  );
  equal(sections[0]?.body, "让人看懂。\n\n### 子节\n细节。\n\n```md\n## 不是章节\n```");
  equal(sections[1]?.body, "不做的事。");
});

test("锚点规则沿用旧归档服务：小写、NFKC、去符号、空白折叠为连字符", () => {
  equal(normalizeMarkdownAnchor("  Landing Plan & Impact  "), "landing-plan-impact");
  equal(normalizeMarkdownAnchor("已核实的代码事实"), "已核实的代码事实");
  equal(normalizeMarkdownAnchor("A__b   c"), "a-b-c");
  equal(normalizeMarkdownAnchor("!!!"), null);
  equal(markdownSectionBodyDigest("x").startsWith("sha256:"), true);
  equal(markdownSectionBodyDigest("x"), markdownSectionBodyDigest("x"));
});

test("顶层列表项：标记可缩进至多三个空格，嵌套子项并入父项，序号只按位置，没有文字的标记不算（§13.161 B4-2/B4-5）", () => {
  const texts = (body: string) => parseMarkdownListItems(body, "ac").map((item) => item.text);
  // 缩进一个空格的顶层标记曾被当成续行并进前一项：三条标准数成一条。
  deepEqual(texts("- A\n - B\n - C\n"), ["A", "B", "C"]);
  // 缩进到前一项内容列之内的是嵌套子项，连同缩进续行一起并入父项。
  deepEqual(texts("- A\n  - a1\n  more\n- B\n"), ["A - a1 more", "B"]);
  deepEqual(texts("1. A\n   - a1\n2. B\n"), ["A - a1", "B"]);
  // `*`、`+`、`1)` 与 CRLF、列表内空行、列表前的段落都接受；写出来的数字不决定序号。
  deepEqual(
    parseMarkdownListItems("intro paragraph\r\n\r\n* A\r\n\r\n+ B\r\n3) C\r\n", "ac").map(
      (item) => [item.itemId, item.text],
    ),
    [
      ["ac-1", "A"],
      ["ac-2", "B"],
      ["ac-3", "C"],
    ],
  );
  // 只有标记没有文字的行不是条目；四个空格起的标记是缩进代码/续行，不是顶层条目。
  deepEqual(texts("-  \n- A\n    - deep\n"), ["A - deep"]);
  deepEqual(texts("    - not an item\n"), []);
  equal(parseMarkdownListItems("- A\n", "ac")[0]?.line, 1);
});
