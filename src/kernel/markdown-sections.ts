import { computeSha256Digest, type Sha256Digest } from "../foundation/crypto/sha256.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";

/**
 * Wakeflow Kernel / Markdown Sections：需求包文档的章节切分与锚点（ADR-0011 D3，能力卡 5）。
 *
 * 只认一个标题层级（缺省 H2），围栏代码块里的标题不算；锚点规则沿用旧归档服务的
 * `normalizedMarkdownAnchor`：trim、小写、NFKC、去掉字母数字空白与 `_-` 以外的字符、
 * 空白与下划线折叠为 `-`。记录里的章节锚点是语言无关的键；这里的锚点只用于未识别标题。
 */

export interface MarkdownSection {
  /** 标题原文（去掉 `#` 与两端空白）。 */
  readonly heading: string;
  /** 由标题派生的锚点；无法派生时为 `null`。 */
  readonly anchor: string | null;
  /** 标题所在行，从 1 起。 */
  readonly line: number;
  /** 标题之后到下一同级或更高级标题之前的正文，已去掉首尾空行。 */
  readonly body: string;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/u;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/u;

/** 旧归档服务的锚点规则，逐字保留。 */
export function normalizeMarkdownAnchor(value: string): string | null {
  const anchor = value
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replace(/[\s_]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return anchor.length === 0 ? null : anchor;
}

function trimBlankEdges(lines: readonly string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start += 1;
  while (end > start && lines[end - 1]?.trim() === "") end -= 1;
  return lines.slice(start, end).join("\n");
}

interface OpenSection {
  readonly heading: string;
  readonly line: number;
  readonly body: string[];
}

function sealSection(open: OpenSection): MarkdownSection {
  return Object.freeze({
    heading: open.heading,
    anchor: normalizeMarkdownAnchor(open.heading),
    line: open.line,
    body: trimBlankEdges(open.body),
  });
}

/** 围栏状态机：进入围栏记下标记，遇到同类且不短于它的标记退出。 */
function nextFence(
  fence: string | null,
  line: string,
): { readonly fence: string | null; readonly hit: boolean } {
  const match = FENCE_PATTERN.exec(line);
  if (match === null) return { fence, hit: false };
  const marker = match[1] ?? "";
  if (fence === null) return { fence: marker, hit: true };
  const closes = marker.startsWith(fence[0] ?? "") && marker.length >= fence.length;
  return { fence: closes ? null : fence, hit: true };
}

/** 按给定层级切分章节；层级更高的标题结束当前章节，更低的标题归入正文。 */
export function parseMarkdownSections(text: string, level = 2): readonly MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let open: OpenSection | null = null;
  let fence: string | null = null;
  text.split(/\r?\n/u).forEach((line, index) => {
    const fenced = nextFence(fence, line);
    fence = fenced.fence;
    const heading = fenced.hit || fence !== null ? null : HEADING_PATTERN.exec(line);
    const depth = heading?.[1]?.length ?? 0;
    if (heading !== null && depth <= level) {
      if (open !== null) sections.push(sealSection(open));
      open = depth === level ? { heading: heading[2] ?? "", line: index + 1, body: [] } : null;
      return;
    }
    open?.body.push(line);
  });
  if (open !== null) sections.push(sealSection(open));
  return Object.freeze(sections);
}

export interface MarkdownListItem {
  /** `<prefix>-<序号>`，序号从 1 起，只数顶层列表项。 */
  readonly itemId: string;
  readonly ordinal: number;
  /** 列表项首行所在行，相对章节正文从 1 起。 */
  readonly line: number;
  /** 去掉列表标记的项文本；缩进续行以空格并入。 */
  readonly text: string;
}

const LIST_ITEM_PATTERN = /^(?:[-*+]|[0-9]{1,3}[.)])\s+(.+?)\s*$/u;
const CONTINUATION_PATTERN = /^\s+(\S.*?)\s*$/u;

/**
 * 章节正文里的顶层列表项（`-`、`*`、`+` 或 `1.`），围栏代码块里的行不算；
 * 缩进的续行并入前一项。任务包的验收锚点以 `itemId` 引用需求包验收标准的一条。
 */
export function parseMarkdownListItems(body: string, prefix = "item"): readonly MarkdownListItem[] {
  const items: { itemId: string; ordinal: number; line: number; text: string }[] = [];
  let fence: string | null = null;
  body.split(/\r?\n/u).forEach((line, index) => {
    const fenced = nextFence(fence, line);
    fence = fenced.fence;
    if (fenced.hit || fence !== null) return;
    const item = LIST_ITEM_PATTERN.exec(line);
    if (item !== null) {
      const ordinal = items.length + 1;
      items.push({ itemId: `${prefix}-${ordinal}`, ordinal, line: index + 1, text: item[1] ?? "" });
      return;
    }
    const continuation = CONTINUATION_PATTERN.exec(line);
    const last = items.at(-1);
    if (continuation !== null && last !== undefined) {
      last.text = `${last.text} ${continuation[1] ?? ""}`;
    }
  });
  return Object.freeze(items.map((item) => Object.freeze({ ...item })));
}

/** 章节正文的摘要：按 UTF-8 字节计算，供记录绑定章节内容。 */
export function markdownSectionBodyDigest(body: string): Sha256Digest {
  return computeSha256Digest(encodeUtf8(body, "$section"));
}
