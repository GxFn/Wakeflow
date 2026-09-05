import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  markdownSectionBodyDigest,
  normalizeMarkdownAnchor,
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
