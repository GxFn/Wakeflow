import { throws } from "node:assert/strict";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import {
  computeDeliveryPromptDigest,
  DeliveryEnvelopeError,
  parseDeliveryEnvelope,
} from "../../../src/governance/delivery/delivery-envelope.js";
import { createDeliveryEnvelopeFixture } from "./delivery-records.fixture.js";

/**
 * 信封解析的摘要自洽：promptDigest 必须是 portablePrompt 的摘要，即使 envelopeDigest
 * 已按篡改后的字段重新计算，也不能让不匹配的提示摘要通过。
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
