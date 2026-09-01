import { equal, rejects, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandControllerRoutePublicRequest } from "../../../src/governance/controller/demand-controller-route-public-coordinator.js";
import {
  parseControllerProductDefectRemediationPublicRequest,
  ControllerProductDefectRemediationPublicContractError,
} from "../../../src/governance/review/controller-product-defect-remediation-public-contract.js";
import {
  executeControllerProductDefectRemediationPublicRequest,
  ControllerProductDefectRemediationPublicCoordinatorError,
} from "../../../src/governance/review/controller-product-defect-remediation-public-coordinator.js";
import { executeControllerTestReviewDecisionPublicRequest } from "../../../src/governance/review/controller-test-review-decision-public-coordinator.js";
import { executeTargetResultReviewInspectionPublicRequest } from "../../../src/governance/review/target-result-review-inspection-public-coordinator.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
} from "./controller-test-review-decision-service.fixture.js";

const TEST_DECIDED_AT = parseUtcInstant("2026-08-29T12:35:00.000Z");
const REMEDIATION_AUTHORIZED_AT = parseUtcInstant("2026-08-29T12:10:00.000Z");
const TEST_DECISION_UUID = "a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6";
const REMEDIATION_UUID = "b7b7b7b7-b7b7-47b7-87b7-b7b7b7b7b7b7";

function containsText(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, needle));
}

test("Product Remediation Public Coordinator闭合Test缺陷到既有产品返工", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  try {
    const inspection = await executeTargetResultReviewInspectionPublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
      targetTaskId: fixture.testTargetTaskId,
    });
    if (
      inspection.reviewUnit.status !== "reported" ||
      inspection.reviewUnit.workType !== "test"
    ) {
      throw new Error("Expected one reported Test review unit.");
    }
    const testDecision = await executeControllerTestReviewDecisionPublicRequest(
      {
        root: fixture.workspacePath,
        demandId: fixture.testClaimRequest.demandId,
        targetResultId: inspection.reviewUnit.targetResult.targetResultId,
        snapshotDigest: inspection.snapshotDigest,
        reviewUnitDigest: inspection.reviewUnit.reviewUnitDigest,
        decision: "escalate-product-defect",
        assessment: {
          conclusion: "defect-observed",
          evidenceSufficiency: "sufficient",
        },
        independentChecks: [
          {
            checkId: "controller-product-defect",
            method: "复验真实环境Evidence并定位产品行为偏差。",
            outcome: "failed",
            observation: "冻结实现基线在批准场景中稳定复现产品缺陷。",
          },
        ],
        rationale: "当前Test代际已充分证明产品缺陷。",
        blockingReasons: [],
        residualRisks: ["修复后仍需创建新TestCard。"],
      },
      {
        decision: {
          clock: () => TEST_DECIDED_AT,
          uuidFactory: () => TEST_DECISION_UUID,
        },
      },
    );
    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
    });
    equal(
      route.route.frontiers[0]?.kind,
      "product-defect-remediation-authorization",
    );
    const postAcceptanceRouteDigest = route.route.postAcceptanceRouteDigest;
    if (postAcceptanceRouteDigest === undefined) {
      throw new Error("Expected current post-acceptance route digest.");
    }
    const baseline = fixture.testCard.implementationBaselines[0];
    if (baseline === undefined) throw new Error("Expected product baseline.");
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
      testReviewDecisionId: testDecision.decision.targetReviewDecisionId,
      postAcceptanceRouteDigest,
      affectedTargets: [
        {
          targetTaskId: baseline.targetTaskId,
          failedCheckIds: ["controller-product-defect"],
          correctionObjective: "在原TaskPackage边界内修复已复现产品缺陷。",
        },
      ],
      authorizationRationale: "缺陷已映射到唯一产品Target及原包边界。",
    };
    const parsed =
      parseControllerProductDefectRemediationPublicRequest(request);
    equal(Object.isFrozen(parsed), true);
    throws(
      () =>
        parseControllerProductDefectRemediationPublicRequest(
          new Proxy(request, {}),
        ),
      (error: unknown) =>
        error instanceof
          ControllerProductDefectRemediationPublicContractError &&
        error.reason === "json",
    );
    throws(
      () =>
        parseControllerProductDefectRemediationPublicRequest({
          ...request,
          testTargetTaskId: fixture.testTargetTaskId,
        }),
      (error: unknown) =>
        error instanceof
          ControllerProductDefectRemediationPublicContractError &&
        error.reason === "schema",
    );
    throws(
      () =>
        parseControllerProductDefectRemediationPublicRequest({
          ...request,
          authorizationRationale: fixture.workspacePath,
        }),
      (error: unknown) =>
        error instanceof
          ControllerProductDefectRemediationPublicContractError &&
        error.reason === "privacy",
    );

    const authorized =
      await executeControllerProductDefectRemediationPublicRequest(request, {
        remediation: {
          clock: () => REMEDIATION_AUTHORIZED_AT,
          uuidFactory: () => REMEDIATION_UUID,
        },
      });
    equal(authorized.status, "authorized");
    equal(authorized.disposition, "committed");
    equal(authorized.eventAuthority, "current");
    equal(
      authorized.authorization.source.testReviewDecision.targetReviewDecisionId,
      testDecision.decision.targetReviewDecisionId,
    );
    equal(
      authorized.authorization.affectedTargets[0]?.baseline.targetTaskId,
      baseline.targetTaskId,
    );
    equal(authorized.authorization.boundary, "existing-task-packages-only");
    equal(containsText(authorized, fixture.workspacePath), false);
    equal(containsText(authorized, fixture.testRawHandle), false);
    equal(Object.hasOwn(authorized, "targetDelivery"), false);

    const after = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
    });
    equal(after.route.frontiers[0]?.kind, "implementation-delivery-planning");
    equal(after.route.frontiers[0]?.scope, "target");
    if (after.route.frontiers[0]?.scope === "target") {
      equal(
        after.route.frontiers[0].target.targetTaskId,
        baseline.targetTaskId,
      );
    }

    const replayed =
      await executeControllerProductDefectRemediationPublicRequest(request);
    equal(replayed.status, "already-authorized");
    equal(replayed.disposition, "idempotent");
    equal(
      replayed.authorization.productDefectRemediationId,
      authorized.authorization.productDefectRemediationId,
    );
    equal(replayed.event.eventId, authorized.event.eventId);

    await rejects(
      executeControllerProductDefectRemediationPublicRequest({
        ...request,
        authorizationRationale: "试图覆盖同一Test Decision的既有授权。",
      }),
      (error: unknown) =>
        error instanceof
          ControllerProductDefectRemediationPublicCoordinatorError &&
        error.reason === "remediation" &&
        error.causeReason === "state" &&
        error.eventAuthority === "current",
    );
  } finally {
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});
