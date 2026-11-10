// 文本规整与摘要（两个助手共用）。

import { createHash } from "node:crypto";

export const MAX_LABEL = 128;

/** @param {number} codePoint */
export function isControl(codePoint) {
  return (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

/**
 * 把宿主给的文本收成一行有界的标签：控制字符换成空格、空白折叠、截到上限。
 * @template {string | null} Fallback
 * @param {unknown} value
 * @param {Fallback} fallback
 * @param {number} [maximum]
 * @returns {string | Fallback}
 */
export function cleanLabel(value, fallback, maximum) {
  if (typeof value !== "string") return fallback;
  let text = "";
  for (const character of value) text += isControl(character.codePointAt(0) ?? 0) ? " " : character;
  const cleaned = text.replace(/\s+/gu, " ").trim();
  return cleaned.length === 0 ? fallback : cleaned.slice(0, maximum ?? MAX_LABEL);
}

/** @param {string} text */
export function sha256(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

// 终端的 SGR 属性序列（颜色、粗细）：宿主命令的输出与 tmux 截屏都可能带着，判断文字之前先去掉。
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the terminal escape character is the purpose of this pattern
export const SGR_PATTERN = /\u001b\[[0-9;]*m/gu;
