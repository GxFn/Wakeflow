import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  parseTestCardGenerationSource,
  TestCardGenerationSourceError,
} from "../../../src/governance/testing/test-card-generation-source.js";

test("TestCard generation source区分initial与产品缺陷retest", () => {
  const initial = parseTestCardGenerationSource({ kind: "initial" });
  deepEqual(initial, { kind: "initial" });
  equal(Object.isFrozen(initial), true);

  const retest = parseTestCardGenerationSource({
    kind: "product-defect-retest",
    previousTestCard: {
      testCardId: "test-card_11111111-1111-4111-8111-111111111111",
      testCardDigest: `sha256:${"1".repeat(64)}`,
    },
    testReviewDecision: {
      targetReviewDecisionId:
        "target-review-decision_22222222-2222-4222-8222-222222222222",
      decisionDigest: `sha256:${"2".repeat(64)}`,
    },
    productDefectRemediation: {
      productDefectRemediationId:
        "product-defect-remediation_33333333-3333-4333-8333-333333333333",
      authorizationDigest: `sha256:${"3".repeat(64)}`,
    },
  });
  equal(retest.kind, "product-defect-retest");
  if (retest.kind !== "product-defect-retest") {
    throw new Error("Expected product-defect retest source.");
  }
  equal(
    retest.productDefectRemediation.productDefectRemediationId,
    "product-defect-remediation_33333333-3333-4333-8333-333333333333",
  );
  equal(Object.isFrozen(retest.previousTestCard), true);
});

test("TestCard generation source拒绝缺失lineage与额外字段", () => {
  for (const value of [
    {
      kind: "product-defect-retest",
    },
    {
      kind: "initial",
      previousTestCard: {},
    },
  ]) {
    throws(
      () => parseTestCardGenerationSource(value),
      (error: unknown) =>
        error instanceof TestCardGenerationSourceError &&
        error.reason === "schema",
    );
  }
});
