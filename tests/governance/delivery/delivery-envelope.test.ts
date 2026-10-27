import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  computeDeliveryPromptDigest,
  DeliveryEnvelopeError,
  parseDeliveryEnvelope,
  projectTargetDeliveryProductDefectRemediationContext,
  projectTargetDeliveryReworkContext,
} from "../../../src/governance/delivery/delivery-envelope.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { createDeliveryEnvelopeFixture } from "./delivery-records.fixture.js";

useDisposableDurability();

/**
 * 信封解析的摘要自洽：promptDigest 必须是 portablePrompt 的摘要，即使 envelopeDigest
 * 已按篡改后的字段重新计算，也不能让不匹配的提示摘要通过。
 * 返工与产品缺陷修复投影的文本按码点截断：上限处恰为 emoji 时不切开代理对（Codex 审阅 R-ROOT-05）。
 */

test("promptDigest 与 portablePrompt 不符时即使 envelopeDigest 重算也以 $/promptDigest 的 digest 拒绝", () => {
  const { envelopeDigest: _discarded, ...basis } = createDeliveryEnvelopeFixture();
  const tamperedBasis = { ...basis, promptDigest: computeDeliveryPromptDigest("other prompt") };
  const tampered = {
    ...tamperedBasis,
    envelopeDigest: computeCanonicalJsonSha256Digest(tamperedBasis),
  };

  throws(
    () => parseDeliveryEnvelope(tampered),
    (error: unknown) =>
      error instanceof DeliveryEnvelopeError &&
      error.reason === "digest" &&
      error.path === "$/promptDigest",
  );
});

/** 第 `maximum - 1` 个码点是 emoji，再超出上限：截断必须整个保留或整个去掉它。 */
function straddling(maximum: number, filler: string): string {
  return `${filler.repeat(maximum - 2)}😀${"x".repeat(8)}`;
}

test("返工与产品缺陷修复投影：文本在码点上限处恰为 emoji 时摘要仍 well-formed、恰为上限个码点并以省略号结尾（R-ROOT-05）", () => {
  const decision = {
    targetReviewDecisionId: parseWakeflowDurableIdOfKind(
      "target-review-decision_12121212-1212-4121-8121-121212121212",
      "target-review-decision",
    ),
    decisionDigest: parseSha256Digest(`sha256:${"1".repeat(64)}`),
  };
  const previousResult = {
    targetResultId: parseWakeflowDurableIdOfKind(
      "target-result_23232323-2323-4232-8232-232323232323",
      "target-result",
    ),
    resultDigest: parseSha256Digest(`sha256:${"2".repeat(64)}`),
  };
  const rework = projectTargetDeliveryReworkContext({
    decision,
    previousResult,
    rationale: straddling(1_024, "r"),
    requiredCorrections: [
      {
        checkId: "check-1",
        outcome: "failed",
        method: straddling(512, "m"),
        observation: straddling(1_024, "o"),
      },
    ],
  });
  const remediation = projectTargetDeliveryProductDefectRemediationContext({
    authorization: {
      productDefectRemediationId: parseWakeflowDurableIdOfKind(
        "product-defect-remediation_34343434-3434-4343-8343-343434343434",
        "product-defect-remediation",
      ),
      authorizationDigest: parseSha256Digest(`sha256:${"3".repeat(64)}`),
    },
    testReviewDecision: decision,
    previousResult,
    authorizationRationale: straddling(1_024, "a"),
    correctionObjective: straddling(1_024, "c"),
    requiredCorrections: [{ stepId: "ts-1", observed: straddling(1_024, "o") }],
  });
  for (const [text, maximum] of [
    [rework.rationaleSummary, 1_024],
    [rework.requiredCorrections[0].methodSummary, 512],
    [rework.requiredCorrections[0].observationSummary, 1_024],
    [remediation.authorizationRationaleSummary, 1_024],
    [remediation.correctionObjectiveSummary, 1_024],
    [remediation.requiredCorrections[0].observedSummary, 1_024],
  ] as const) {
    equal(text.isWellFormed(), true);
    equal([...text].length, maximum);
    equal(text.endsWith("😀…"), true);
  }
});
