import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  parseWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
} from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { parseDemandEventStreamRevision } from "../../../src/governance/demand/event-sourcing/demand-event-stream-position.js";
import {
  createControllerProductDefectRemediationAuthorization,
  parseControllerProductDefectRemediationAuthorization,
  parseControllerProductDefectRemediationAuthorizationDocument,
  productDefectRemediationAuthorizedCommitId,
  productDefectRemediationAuthorizedEventId,
  renderControllerProductDefectRemediationAuthorization,
  ControllerProductDefectRemediationAuthorizationError,
  type CreateControllerProductDefectRemediationAuthorizationInput,
} from "../../../src/governance/review/controller-product-defect-remediation-authorization.js";
import {
  createControllerTestReviewDecision,
  type ControllerTestReviewDecision,
} from "../../../src/governance/review/controller-test-review-decision.js";
import type { TestCardImplementationBaseline } from "../../../src/governance/testing/test-card.js";

const REPORTED_AT = parseUtcInstant("2026-08-29T12:34:00.000Z");
const DECIDED_AT = parseUtcInstant("2026-08-29T12:35:00.000Z");
const AUTHORIZED_AT = parseUtcInstant("2026-08-29T12:33:00.000Z");
const DECISION_UUID = "e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5";
const AUTHORIZATION_UUID = "f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6";

function productDefectDecision(): Readonly<ControllerTestReviewDecision> {
  return createControllerTestReviewDecision(
    {
      programId: parseWakeflowDurableIdOfKind(
        "program_11111111-1111-4111-8111-111111111111",
        "program",
      ),
      demandId: parseWakeflowDurableIdOfKind(
        "demand_22222222-2222-4222-8222-222222222222",
        "demand",
      ),
      targetTaskId: parseWakeflowDurableIdOfKind(
        "target-task_33333333-3333-4333-8333-333333333333",
        "target-task",
      ),
      controllerWindowId: parseWakeflowDurableIdOfKind(
        "window_44444444-4444-4444-8444-444444444444",
        "window",
      ),
      reviewed: {
        snapshotDigest: parseSha256Digest(`sha256:${"1".repeat(64)}`),
        reviewUnitDigest: parseSha256Digest(`sha256:${"2".repeat(64)}`),
        stateDigest: parseSha256Digest(`sha256:${"3".repeat(64)}`),
        streamRevision: parseDemandEventStreamRevision(12),
        taskPackageId: parseWakeflowDurableIdOfKind(
          "task-package_55555555-5555-4555-8555-555555555555",
          "task-package",
        ),
        taskPackageDigest: parseSha256Digest(`sha256:${"4".repeat(64)}`),
        targetResultId: parseWakeflowDurableIdOfKind(
          "target-result_66666666-6666-4666-8666-666666666666",
          "target-result",
        ),
        targetResultDigest: parseSha256Digest(`sha256:${"5".repeat(64)}`),
        targetResultOutcome: "completed",
        targetResultReportedAt: REPORTED_AT,
      },
      testExecution: {
        testAttemptId: parseWakeflowDurableIdOfKind(
          "test-attempt_77777777-7777-4777-8777-777777777777",
          "test-attempt",
        ),
        testCard: {
          testCardId: parseWakeflowDurableIdOfKind(
            "test-card_88888888-8888-4888-8888-888888888888",
            "test-card",
          ),
          testCardDigest: parseSha256Digest(`sha256:${"6".repeat(64)}`),
        },
        testDispatchPacketDigest: parseSha256Digest(`sha256:${"7".repeat(64)}`),
      },
      decision: "escalate-product-defect",
      assessment: {
        conclusion: "defect-observed",
        evidenceSufficiency: "sufficient",
      },
      independentChecks: [
        {
          checkId: "api-contract",
          method: "复验真实环境入口与返回合同。",
          outcome: "failed",
          observation: "产品入口在批准输入下返回错误状态。",
        },
        {
          checkId: "diagnostic-log",
          method: "复验诊断日志是否足以定位执行边界。",
          outcome: "passed",
          observation: "诊断日志完整记录了当前执行边界。",
        },
        {
          checkId: "state-persistence",
          method: "重启后重新读取产品状态。",
          outcome: "failed",
          observation: "重启后产品状态没有保留已确认值。",
        },
      ],
      rationale: "充分Evidence证明已接受实现存在产品缺陷。",
      blockingReasons: [],
      residualRisks: ["修复后仍需创建新TestCard验证新基线。"],
    },
    {
      clock: () => DECIDED_AT,
      uuidFactory: () => DECISION_UUID,
    },
  );
}

function baseline(key: "a" | "b"): Readonly<TestCardImplementationBaseline> {
  const first = key === "a";
  return Object.freeze({
    targetTaskId: parseWakeflowDurableIdOfKind(
      first
        ? "target-task_99999999-9999-4999-8999-999999999999"
        : "target-task_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "target-task",
    ),
    taskPackageId: parseWakeflowDurableIdOfKind(
      first
        ? "task-package_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        : "task-package_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "task-package",
    ),
    taskPackageDigest: parseSha256Digest(
      `sha256:${first ? "8".repeat(64) : "9".repeat(64)}`,
    ),
    repositoryId: parseWakeflowDurableIdOfKind(
      first
        ? "repository_dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        : "repository_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "repository",
    ),
    windowId: parseWakeflowDurableIdOfKind(
      first
        ? "window_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        : "window_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "window",
    ),
    targetResultId: parseWakeflowDurableIdOfKind(
      first
        ? "target-result_dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        : "target-result_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "target-result",
    ),
    resultDigest: parseSha256Digest(
      `sha256:${first ? "a".repeat(64) : "b".repeat(64)}`,
    ),
    targetReviewDecisionId: parseWakeflowDurableIdOfKind(
      first
        ? "target-review-decision_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        : "target-review-decision_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "target-review-decision",
    ),
    decisionDigest: parseSha256Digest(
      `sha256:${first ? "c".repeat(64) : "d".repeat(64)}`,
    ),
  });
}

function input(): CreateControllerProductDefectRemediationAuthorizationInput {
  return {
    decision: productDefectDecision(),
    routeSource: {
      postAcceptanceRouteDigest: parseSha256Digest(`sha256:${"e".repeat(64)}`),
      reviewSnapshotDigest: parseSha256Digest(`sha256:${"f".repeat(64)}`),
      stateDigest: parseSha256Digest(`sha256:${"0".repeat(64)}`),
      streamRevision: parseDemandEventStreamRevision(13),
    },
    affectedTargets: [
      {
        baseline: baseline("b"),
        failedCheckIds: ["state-persistence"],
        correctionObjective: "在原TaskPackage边界内修复状态持久化。",
      },
      {
        baseline: baseline("a"),
        failedCheckIds: ["api-contract"],
        correctionObjective: "在原TaskPackage边界内恢复批准的入口合同。",
      },
    ],
    authorizationRationale: "两个产品Target分别拥有可定位且不跨包的修复责任。",
  };
}

function createAuthorization(
  value: CreateControllerProductDefectRemediationAuthorizationInput = input(),
) {
  return createControllerProductDefectRemediationAuthorization(value, {
    clock: () => AUTHORIZED_AT,
    uuidFactory: () => AUTHORIZATION_UUID,
  });
}

test("产品缺陷修复授权冻结原包baseline与失败检查映射", () => {
  const authorization = createAuthorization();
  equal(
    authorization.kind,
    "WakeflowControllerProductDefectRemediationAuthorization",
  );
  equal(
    authorization.productDefectRemediationId,
    `product-defect-remediation_${AUTHORIZATION_UUID}`,
  );
  equal(
    parseWakeflowDurableId(authorization.productDefectRemediationId).kind,
    "product-defect-remediation",
  );
  equal(
    productDefectRemediationAuthorizedEventId(authorization),
    `demand-event_${AUTHORIZATION_UUID}`,
  );
  equal(
    productDefectRemediationAuthorizedCommitId(authorization),
    `demand-event-commit_${AUTHORIZATION_UUID}`,
  );
  equal(authorization.boundary, "existing-task-packages-only");
  equal(
    authorization.authorizedAt <
      authorization.source.testReviewDecision.decidedAt,
    true,
  );
  deepEqual(
    authorization.failedChecks.map((check) => check.checkId),
    ["api-contract", "state-persistence"],
  );
  deepEqual(
    authorization.affectedTargets.map((target) => target.baseline.targetTaskId),
    [baseline("a").targetTaskId, baseline("b").targetTaskId],
  );
  equal(Object.isFrozen(authorization), true);
  equal(Object.isFrozen(authorization.source), true);
  equal(Object.isFrozen(authorization.affectedTargets[0]?.baseline), true);
  equal(Object.hasOwn(authorization, "aggregateMutation"), false);
  equal(Object.hasOwn(authorization, "targetDelivery"), false);
  equal(
    parseControllerProductDefectRemediationAuthorizationDocument(
      renderControllerProductDefectRemediationAuthorization(authorization),
    ).authorizationDigest,
    authorization.authorizationDigest,
  );
});

test("修复授权在分配身份与时间前拒绝错误Decision和不闭合映射", () => {
  let uuidReads = 0;
  let clockReads = 0;
  const options = {
    uuidFactory: () => {
      uuidReads += 1;
      return AUTHORIZATION_UUID;
    },
    clock: () => {
      clockReads += 1;
      return AUTHORIZED_AT;
    },
  };
  const valid = input();
  const acceptDecision = createControllerTestReviewDecision(
    {
      ...valid.decision,
      decision: "accept",
      assessment: {
        conclusion: "satisfied",
        evidenceSufficiency: "sufficient",
      },
      independentChecks: [
        {
          checkId: "accepted",
          method: "复验全部Test Evidence。",
          outcome: "passed",
          observation: "未观察到产品缺陷。",
        },
      ],
    },
    {
      clock: () => DECIDED_AT,
      uuidFactory: () => DECISION_UUID,
    },
  );
  throws(
    () =>
      createControllerProductDefectRemediationAuthorization(
        {
          ...valid,
          decision: acceptDecision,
        },
        options,
      ),
    (error: unknown) =>
      error instanceof ControllerProductDefectRemediationAuthorizationError &&
      error.reason === "decision",
  );
  throws(
    () =>
      createControllerProductDefectRemediationAuthorization(
        {
          ...valid,
          affectedTargets: [
            {
              ...valid.affectedTargets[0],
              failedCheckIds: ["api-contract"],
            },
          ],
        },
        options,
      ),
    (error: unknown) =>
      error instanceof ControllerProductDefectRemediationAuthorizationError &&
      error.reason === "relation",
  );
  throws(
    () =>
      createControllerProductDefectRemediationAuthorization(
        {
          ...valid,
          routeSource: {
            ...valid.routeSource,
            streamRevision: parseDemandEventStreamRevision(14),
          },
        },
        options,
      ),
    (error: unknown) =>
      error instanceof ControllerProductDefectRemediationAuthorizationError &&
      error.reason === "relation",
  );
  equal(uuidReads, 0);
  equal(clockReads, 0);
});

test("修复授权拒绝顺序漂移与摘要篡改", () => {
  const authorization = createAuthorization();
  throws(
    () =>
      parseControllerProductDefectRemediationAuthorization({
        ...authorization,
        affectedTargets: [...authorization.affectedTargets].reverse(),
      }),
    (error: unknown) =>
      error instanceof ControllerProductDefectRemediationAuthorizationError &&
      error.reason === "relation",
  );
  throws(
    () =>
      parseControllerProductDefectRemediationAuthorization({
        ...authorization,
        authorizationDigest: `sha256:${"0".repeat(64)}`,
      }),
    (error: unknown) =>
      error instanceof ControllerProductDefectRemediationAuthorizationError &&
      error.reason === "digest",
  );
});
