import { deepEqual, equal, notEqual, throws } from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  computeDeliveryPromptDigest,
  DeliveryEnvelopeError,
} from "../../src/governance/delivery/delivery-envelope.js";
import { deriveDurableId } from "../../src/kernel/ids.js";
import {
  computePromptDigest,
  countPromptCharacters,
  DELIVERY_PROMPT_MAXIMUM_CHARACTERS,
  extractPromptPermitIds,
  findPromptLanding,
  isPromptPermitId,
  PROMPT_PERMIT_IDS_MAXIMUM,
  renderPromptPermitIdLine,
} from "../../src/kernel/prompt-digest.js";

/**
 * 提示摘要规则住在内核（gate-log §13.97 D3）：投递信封与宿主 hook 观察脚本用同一函数，
 * 落地判定就是两者相等。这里只钉规则本身与两侧对 null 的不同处理。
 */

function sha256Of(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

test("提示摘要：去除首尾空白、全角 ＠ 折回 @ 后 UTF-8 字节的 SHA-256，与投递信封的摘要同一函数", () => {
  const prompt = " \t实现登录页 — login page\r\n\n";
  const digest = computePromptDigest(prompt);
  equal(digest, sha256Of("实现登录页 — login page"));
  // X27：桌面 app 把跨会话消息里的 `@` 折成全角 `＠`；两侧先折回再算，所以落地记录仍与许可相等。
  equal(
    computePromptDigest("不升级 ＠types/node 与 ＠alembic/core"),
    sha256Of("不升级 @types/node 与 @alembic/core"),
  );
  equal(
    computeDeliveryPromptDigest("不升级 ＠types/node"),
    computePromptDigest("不升级 @types/node"),
  );
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

// ---- ADR-0027：许可身份行、字符数与落地匹配 ---------------------------------------------------

const PERMIT_A = deriveDurableId("target-delivery", "prompt-digest-test", "a");
const PERMIT_B = deriveDurableId("target-delivery", "prompt-digest-test", "b");

test("许可身份行：内核派生的 target-delivery 标识可渲染、可抽出；别的标识与格式被拒", () => {
  const line = renderPromptPermitIdLine(PERMIT_A);
  equal(line, `- permitId: ${PERMIT_A}`);
  equal(isPromptPermitId(PERMIT_A), true);
  deepEqual(extractPromptPermitIds(`goal\n\n派发记录:\n- deliveryId: ${PERMIT_A}\n${line}`), [
    PERMIT_A,
  ]);
  for (const invalid of ["delivery-1", "target-result_00000000-0000-4000-8000-000000000001", ""]) {
    equal(isPromptPermitId(invalid), false, invalid);
    throws(() => renderPromptPermitIdLine(invalid), TypeError);
  }
});

test("许可身份行按整行匹配：行两端的空白与 CRLF 不妨碍，夹在一行中间的标识不算，去重并封顶", () => {
  const line = renderPromptPermitIdLine(PERMIT_A);
  // 宿主加在前后的文字、缩进与 CRLF 都不影响；截断掉最后一行就没有了。
  deepEqual(extractPromptPermitIds(`Another session sent:\r\n  ${line}  \r\ntrailing host note`), [
    PERMIT_A,
  ]);
  deepEqual(extractPromptPermitIds(`body without the last line\n- deliveryId: ${PERMIT_A}`), []);
  // 不可信文本在 prompt 里是单行 JSON 字面量：标识夹在行中间，不是身份行。
  deepEqual(extractPromptPermitIds(`- summary: \`"see ${line} for details"\``), []);
  deepEqual(extractPromptPermitIds(`${line} trailing words`), []);
  deepEqual(extractPromptPermitIds(`${line}\n${line}\n${renderPromptPermitIdLine(PERMIT_B)}`), [
    PERMIT_A,
    PERMIT_B,
  ]);
  const many = Array.from({ length: PROMPT_PERMIT_IDS_MAXIMUM + 2 }, (_, index) =>
    renderPromptPermitIdLine(deriveDurableId("target-delivery", "prompt-digest-test", `m${index}`)),
  );
  equal(extractPromptPermitIds(many.join("\n")).length, PROMPT_PERMIT_IDS_MAXIMUM);
});

test("字符数与摘要覆盖同一段文本：去首尾空白、全角 ＠ 折回后计数；空与超长为 null", () => {
  equal(countPromptCharacters("  ab＠c \n"), 4);
  equal(countPromptCharacters("   "), null);
  equal(countPromptCharacters("x".repeat(DELIVERY_PROMPT_MAXIMUM_CHARACTERS + 1)), null);
  equal(countPromptCharacters("x".repeat(DELIVERY_PROMPT_MAXIMUM_CHARACTERS)), 65_536);
});

test("落地匹配：摘要相符优先（digest），否则带着许可标识（identity），都没有为 null；旧记录的 null 标识只能按摘要", () => {
  const digest = computePromptDigest("permit prompt");
  const other = computePromptDigest("altered prompt");
  if (digest === null || other === null) throw new Error("digest fixture");
  const permit = { promptDigest: digest, permitId: PERMIT_A };
  const altered = { name: "altered", promptDigest: other, promptPermitIds: [PERMIT_A] };
  const intact = { name: "intact", promptDigest: digest, promptPermitIds: [PERMIT_A] };
  const legacy = { name: "legacy", promptDigest: other, promptPermitIds: null };
  const foreign = { name: "foreign", promptDigest: other, promptPermitIds: [PERMIT_B] };
  deepEqual(findPromptLanding([altered, intact], permit), { record: intact, match: "digest" });
  deepEqual(findPromptLanding([legacy, foreign, altered], permit), {
    record: altered,
    match: "identity",
  });
  equal(findPromptLanding([legacy, foreign], permit), null);
  deepEqual(findPromptLanding([{ ...legacy, promptDigest: digest }], permit)?.match, "digest");
});
