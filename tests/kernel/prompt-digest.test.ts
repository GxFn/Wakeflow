import { equal, notEqual, throws } from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  computeDeliveryPromptDigest,
  DeliveryEnvelopeError,
} from "../../src/governance/delivery/delivery-envelope.js";
import {
  computePromptDigest,
  DELIVERY_PROMPT_MAXIMUM_CHARACTERS,
} from "../../src/kernel/prompt-digest.js";

/**
 * 提示摘要规则住在内核（gate-log §13.97 D3）：投递信封与宿主 hook 观察脚本用同一函数，
 * 落地判定就是两者相等。这里只钉规则本身与两侧对 null 的不同处理。
 */

function sha256Of(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

test("提示摘要：去除首尾空白后 UTF-8 字节的 SHA-256，与投递信封的摘要同一函数", () => {
  const prompt = " \t实现登录页 — login page\r\n\n";
  const digest = computePromptDigest(prompt);
  equal(digest, sha256Of("实现登录页 — login page"));
  // D3：`promptDigest` 等于 `computeDeliveryPromptDigest`——同一内核函数，不是两份规则的巧合相等。
  equal(digest, computeDeliveryPromptDigest(prompt));
  equal(computePromptDigest("实现登录页 — login page"), digest);
  notEqual(computePromptDigest("实现登录页 — login page."), digest);
});

test("提示摘要：空、只有空白、去空白后超过 65,536 字符为 null；信封侧对同样的输入抛 prompt 错误", () => {
  equal(DELIVERY_PROMPT_MAXIMUM_CHARACTERS, 65_536);
  const maximal = "a".repeat(DELIVERY_PROMPT_MAXIMUM_CHARACTERS);
  notEqual(computePromptDigest(maximal), null);
  // 上界作用于 trim 之后：两侧空白不占配额。
  equal(computePromptDigest(`  ${maximal}\n`), computePromptDigest(maximal));
  for (const prompt of ["", "   \n\t", `${maximal}b`]) {
    equal(computePromptDigest(prompt), null);
    throws(
      () => computeDeliveryPromptDigest(prompt),
      (error: unknown) => error instanceof DeliveryEnvelopeError && error.reason === "prompt",
    );
  }
});
