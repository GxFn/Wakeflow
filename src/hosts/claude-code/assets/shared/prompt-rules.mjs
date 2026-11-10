// prompt 规则（两个助手共用）：摘要与许可身份行必须与内核 kernel/prompt-digest.ts 同一条，
// tests/hosts/claude-code/claude-code-helper-prompt-rules.test.ts 用同一组向量核对两边。

import { sha256 } from "./text.mjs";

export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

// 摘要规则与内核同一条（kernel/prompt-digest.ts）：去首尾空白、全角 ＠（U+FF20）折回 @ 之后的 UTF-8 SHA-256。
// 桌面 app 把跨会话消息里的 @ 折成全角（X27）；许可文件里真写了全角的也按折回后的文本算。
/** @param {string} prompt */
export function promptDigestOf(prompt) {
  return sha256(prompt.trim().replace(/＠/gu, "@"));
}

// 许可身份行（ADR-0027）：prompt 最后一行 "- permitId: <target-delivery 标识>"，按整行匹配；规则与内核同一条。
export const PERMIT_ID_LINE_PATTERN =
  /^- permitId: (target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;

export const PERMIT_IDS_MAXIMUM = 4;

/**
 * prompt 里出现的许可标识，按出现顺序去重，最多 PERMIT_IDS_MAXIMUM 个。
 * @param {string} prompt
 */
export function promptPermitIdsOf(prompt) {
  /** @type {string[]} */
  const found = [];
  for (const line of prompt.split("\n")) {
    const match = PERMIT_ID_LINE_PATTERN.exec(line.trim());
    if (match === null || found.includes(match[1])) continue;
    found.push(match[1]);
    if (found.length === PERMIT_IDS_MAXIMUM) break;
  }
  return found;
}

// K6：许可 prompt 由 Wakeflow 落在 Demand 根下的 artifacts/permits/<kind>/<id>.txt；按引用读取并核对摘要，
// Agent 不再把 prompt 从 stdin 重打一遍，也不用去读事件溯源文件。路径只认工作区根下的许可目录。
export const PERMIT_PROMPT_REF_PATTERN =
  /^\.wakeflow-active\/current\/demand_[0-9a-f-]{36}\/artifacts\/permits\/(delivery|callback)\/target-delivery_[0-9a-f-]{36}\.txt$/u;
