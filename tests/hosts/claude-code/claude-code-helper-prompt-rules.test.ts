import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  PERMIT_ID_LINE_PATTERN,
  PERMIT_IDS_MAXIMUM,
  promptDigestOf,
  promptPermitIdsOf,
} from "../../../src/hosts/claude-code/assets/shared/prompt-rules.mjs";
import {
  computePromptDigest,
  extractPromptPermitIds,
  PROMPT_PERMIT_ID_LINE,
  PROMPT_PERMIT_IDS_MAXIMUM,
} from "../../../src/kernel/prompt-digest.js";

/**
 * 级别 0（纯逻辑；`tests/hosts` 的缺省是 2 级）：助手片段的 prompt 规则与内核同一条。
 *
 * 助手是自包含脚本，不能 import 运行时，所以摘要规则与许可身份行在 `assets/shared/prompt-rules.mjs` 里
 * 另写了一份（两个助手共用这一份）。落地判定要求两边算出同一个摘要、认出同一组许可标识——1.3.0 第一批
 * 改这条规则时动了三处，Y17 就是漏改留下的。这里用同一组向量把片段钉在内核上：谁改了规则而没改另一边，
 * 这里失败。
 */

const ID_A = "target-delivery_11111111-1111-4111-8111-111111111111";
const ID_B = "target-delivery_22222222-2222-4222-9222-222222222222";
const ID_C = "target-delivery_33333333-3333-4333-a333-333333333333";
const ID_D = "target-delivery_44444444-4444-4444-b444-444444444444";
const ID_E = "target-delivery_55555555-5555-4555-8555-555555555555";

const PROMPTS: readonly string[] = [
  "plain prompt",
  "  surrounded by blank space \n\n",
  "Read @docs/plan.md then continue",
  "Read ＠docs/plan.md then continue",
  "mixed @one and ＠two",
  "多行\n第二行 — 带标点，和 emoji 🙂\n",
  `Wakeflow delivery\n- generation: 1\n- permitId: ${ID_A}`,
  `Wakeflow delivery\n  - permitId: ${ID_A}  \n`,
  `- permitId: ${ID_A}\n- permitId: ${ID_A}\n- permitId: ${ID_B}`,
  `- permitId: ${ID_A}\n- permitId: ${ID_B}\n- permitId: ${ID_C}\n- permitId: ${ID_D}\n- permitId: ${ID_E}`,
  `{"note":"- permitId: ${ID_A}"}`,
  `prefix - permitId: ${ID_A}`,
  `- permitId: ${ID_A} trailing`,
  "- permitId: target-delivery_not-a-uuid",
  "- permitId: target-delivery_11111111-1111-1111-8111-111111111111",
  `- permitid: ${ID_A}`,
  `\r\n- permitId: ${ID_B}\r\n`,
];

test("摘要规则与内核同一条：去首尾空白、全角 ＠ 折回 @ 之后的 UTF-8 SHA-256", () => {
  for (const prompt of PROMPTS) {
    equal(promptDigestOf(prompt), computePromptDigest(prompt), JSON.stringify(prompt));
  }
  equal(
    promptDigestOf("Read ＠docs/plan.md then continue"),
    promptDigestOf("Read @docs/plan.md then continue"),
  );
});

test("许可身份行与内核同一条：同一个正则、同一个上限，同一组向量抽出同一组标识", () => {
  equal(PERMIT_ID_LINE_PATTERN.source, PROMPT_PERMIT_ID_LINE.source);
  equal(PERMIT_ID_LINE_PATTERN.flags, PROMPT_PERMIT_ID_LINE.flags);
  equal(PERMIT_IDS_MAXIMUM, PROMPT_PERMIT_IDS_MAXIMUM);
  for (const prompt of PROMPTS) {
    deepEqual(
      promptPermitIdsOf(prompt),
      [...extractPromptPermitIds(prompt)],
      JSON.stringify(prompt),
    );
  }
  // 向量确实覆盖了规则的每一面：整行匹配、行两端空白、去重、上限、夹在一行里的不算。
  deepEqual(promptPermitIdsOf(PROMPTS[7] ?? ""), [ID_A]);
  deepEqual(promptPermitIdsOf(PROMPTS[8] ?? ""), [ID_A, ID_B]);
  deepEqual(promptPermitIdsOf(PROMPTS[9] ?? ""), [ID_A, ID_B, ID_C, ID_D]);
  deepEqual(promptPermitIdsOf(PROMPTS[10] ?? ""), []);
  deepEqual(promptPermitIdsOf(PROMPTS[16] ?? ""), [ID_B]);
});
