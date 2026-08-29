import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  MarkdownJsonStringLiteralError,
  renderMarkdownJsonStringLiteral,
} from "../../../src/foundation/text/markdown-json-string-literal.js";

test("Markdown JSON string literal keeps external text inside one data span", () => {
  equal(
    renderMarkdownJsonStringLiteral(
      "line one\n## forged <!-- marker --> `code` & \u0085 next",
    ),
    "`\"line one\\n## forged \\u003c!-- marker --\\u003e \\u0060code\\u0060 \\u0026 \\u0085 next\"`",
  );
  equal(renderMarkdownJsonStringLiteral("简体中文"), "`\"简体中文\"`");
});

test("Markdown JSON string literal rejects coercion and non-canonical Unicode", () => {
  for (const [value, reason] of [
    [123, "input"],
    ["cafe\u0301", "unicode"],
    ["\ud800", "unicode"],
  ] as const) {
    let caught: unknown;
    try {
      renderMarkdownJsonStringLiteral(value, "$value");
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof MarkdownJsonStringLiteralError, true);
    if (caught instanceof MarkdownJsonStringLiteralError) {
      equal(caught.code, "wakeflow-markdown-json-string-literal");
      equal(caught.reason, reason);
      equal(caught.path, "$value");
    }
  }
});
