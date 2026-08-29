/**
 * Wakeflow Foundation / Text：把外部文本渲染为 Markdown 内的 JSON 字符串字面量。
 *
 * 返回值使用 inline-code 外壳和 JSON 字符串表示。换行与控制字符不会形成 Markdown
 * 结构；反引号、GFM 表格分隔符、HTML 边界字符、`&` 和显式双向控制字符使用
 * Unicode escape，不能闭合 code span、拆分表格单元、形成 HTML comment、视觉重排或
 * 注入 Wakeflow marker。输入必须是结构完整且已采用 NFC 的原始字符串，本能力不执行
 * trim、Unicode 规范化或非字符串强制转换。
 *
 * 本模块只处理一个内联数据值，不声称是通用 Markdown sanitizer，也不渲染标题、链接、
 * 列表或完整文档。
 */

export type MarkdownJsonStringLiteralErrorReason = "input" | "unicode";

const ERROR_MESSAGES = {
  input: "Markdown JSON string literal input must be a primitive string.",
  unicode:
    "Markdown JSON string literal input must be well-formed NFC Unicode.",
} as const satisfies Readonly<Record<
  MarkdownJsonStringLiteralErrorReason,
  string
>>;

/** Markdown JSON 数据字面量准入失败的稳定、脱敏错误。 */
export class MarkdownJsonStringLiteralError extends Error {
  override readonly name = "MarkdownJsonStringLiteralError";
  readonly code = "wakeflow-markdown-json-string-literal" as const;
  readonly reason: MarkdownJsonStringLiteralErrorReason;
  readonly path: string;

  constructor(reason: MarkdownJsonStringLiteralErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

/** `JSON.stringify` 已处理 C0、引号和反斜杠；这里只补充 Markdown 与显示边界。 */
const MARKDOWN_LITERAL_ESCAPE_PATTERN =
  /[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069&<>`|]/gu;

function normalizedPath(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "$";
}

function escapeBmpCodeUnit(character: string): string {
  return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
}

/** 把一个严格 Unicode 字符串渲染为不会改变 Markdown 结构的内联 JSON 数据。 */
export function renderMarkdownJsonStringLiteral(
  value: unknown,
  errorPath?: string,
): string {
  const path = normalizedPath(errorPath);
  if (typeof value !== "string") {
    throw new MarkdownJsonStringLiteralError("input", path);
  }
  if (!value.isWellFormed() || value.normalize("NFC") !== value) {
    throw new MarkdownJsonStringLiteralError("unicode", path);
  }
  const literal = JSON.stringify(value).replace(
    MARKDOWN_LITERAL_ESCAPE_PATTERN,
    escapeBmpCodeUnit,
  );
  return `\`${literal}\``;
}
