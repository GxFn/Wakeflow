import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA,
  type WakeflowControllerProductDefectRemediationRequestV1 as RemediationRequestWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-controller-product-defect-remediation-request.generated.js";
import {
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA,
  type WakeflowControllerProductDefectRemediationResultV1 as RemediationResultWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-controller-product-defect-remediation-result.generated.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";

const validateRequest =
  createRuntimeJsonSchemaValidator<RemediationRequestWire>(
    WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA,
  );
const validateResult = createRuntimeJsonSchemaValidator<RemediationResultWire>(
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA,
);

const DIGEST = `sha256:${"0".repeat(64)}`;
const DEMAND_ID = "demand_11111111-1111-4111-8111-111111111111";
const TEST_DECISION_ID =
  "target-review-decision_22222222-2222-4222-8222-222222222222";
const PRODUCT_TARGET_ID = "target-task_33333333-3333-4333-8333-333333333333";

function request() {
  return {
    root: "/workspace",
    demandId: DEMAND_ID,
    testReviewDecisionId: TEST_DECISION_ID,
    postAcceptanceRouteDigest: DIGEST,
    affectedTargets: [
      {
        targetTaskId: PRODUCT_TARGET_ID,
        failedCheckIds: ["product-contract"],
        correctionObjective: "在原TaskPackage边界内恢复批准的产品合同。",
      },
    ],
    authorizationRationale: "缺陷已映射到唯一产品Target和冻结baseline。",
  } as const;
}

function result() {
  return {
    kind: "WakeflowControllerProductDefectRemediationResult",
    schemaVersion: 1,
    tool: "wakeflow_authorize_product_defect_remediation",
    status: "authorized",
    disposition: "committed",
    eventAuthority: "current",
    authorization: {
      kind: "WakeflowControllerProductDefectRemediationAuthorization",
      schemaVersion: 1,
      productDefectRemediationId:
        "product-defect-remediation_44444444-4444-4444-8444-444444444444",
      programId: "program_55555555-5555-4555-8555-555555555555",
      demandId: DEMAND_ID,
      controllerWindowId: "window_66666666-6666-4666-8666-666666666666",
      source: {
        postAcceptanceRouteDigest: DIGEST,
        reviewSnapshotDigest: DIGEST,
        stateDigest: DIGEST,
        streamRevision: 12,
        testTargetTaskId: "target-task_77777777-7777-4777-8777-777777777777",
        testCard: {
          testCardId: "test-card_88888888-8888-4888-8888-888888888888",
          testCardDigest: DIGEST,
        },
        testAttemptId: "test-attempt_99999999-9999-4999-8999-999999999999",
        testDispatchPacketDigest: DIGEST,
        targetResult: {
          targetResultId: "target-result_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          resultDigest: DIGEST,
        },
        testReviewDecision: {
          targetReviewDecisionId: TEST_DECISION_ID,
          decisionDigest: DIGEST,
          decidedAt: "2026-08-29T12:35:00.000Z",
        },
      },
      failedChecks: [
        {
          checkId: "product-contract",
          outcome: "failed",
          method: "复验真实环境产品入口。",
          observation: "冻结实现基线稳定复现错误状态。",
        },
      ],
      affectedTargets: [
        {
          baseline: {
            targetTaskId: PRODUCT_TARGET_ID,
            taskPackageId: "task-package_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            taskPackageDigest: DIGEST,
            repositoryId: "repository_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            windowId: "window_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            targetResultId:
              "target-result_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            resultDigest: DIGEST,
            targetReviewDecisionId:
              "target-review-decision_ffffffff-ffff-4fff-8fff-ffffffffffff",
            decisionDigest: DIGEST,
          },
          failedCheckIds: ["product-contract"],
          correctionObjective: "在原TaskPackage边界内恢复批准的产品合同。",
        },
      ],
      boundary: "existing-task-packages-only",
      authorizationRationale: "缺陷已映射到唯一产品Target和冻结baseline。",
      authorizedAt: "2026-08-29T12:10:00.000Z",
      authorizationDigest: DIGEST,
    },
    event: {
      eventId: "demand-event_44444444-4444-4444-8444-444444444444",
      streamRevision: 13,
    },
    commit: {
      commitId: "demand-event-commit_44444444-4444-4444-8444-444444444444",
      commitSequence: 13,
      commitDigest: DIGEST,
    },
    stateDigest: DIGEST,
  } as const;
}

test("Product Remediation Request只接受Decision、route fence与产品映射", () => {
  const value = request();
  equal(validateRequest(value).ok, true);
  equal(
    validateRequest({
      ...value,
      testTargetTaskId: "target-task_77777777-7777-4777-8777-777777777777",
    }).ok,
    false,
  );
  equal(
    validateRequest({
      ...value,
      affectedTargets: [
        {
          ...value.affectedTargets[0],
          failedCheckIds: ["product-contract", "product-contract"],
        },
      ],
    }).ok,
    false,
  );
});

test("Product Remediation Result关闭Authorization与Event回执且不携带Delivery", () => {
  const value = result();
  equal(validateResult(value).ok, true);
  equal(
    validateResult({
      ...value,
      status: "already-authorized",
      disposition: "idempotent",
    }).ok,
    true,
  );
  equal(validateResult({ ...value, disposition: "idempotent" }).ok, false);
  equal(validateResult({ ...value, targetDelivery: {} }).ok, false);
  equal(validateResult({ ...value, root: "/workspace" }).ok, false);
});
