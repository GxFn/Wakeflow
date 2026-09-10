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
  productDefectRemediationAuthorizedEventId,
  renderControllerProductDefectRemediationAuthorization,
  ControllerProductDefectRemediationAuthorizationError,
  type CreateControllerProductDefectRemediationAuthorizationInput,
} from "../../../src/governance/review/controller-product-defect-remediation-authorization.js";
import {
  createControllerTestReviewDecision,
  type ControllerTestReviewDecision,
} from "../../../src/governance/review/controller-test-review-decision.js";
import type { TestImplementationBaseline } from "../../../src/governance/tasking/task-package.js";
import { testReviewDecisionBaseInput } from "./controller-test-review-decision.test.js";

const DECIDED_AT = parseUtcInstant("2026-08-29T12:35:00.000Z");
const AUTHORIZED_AT = parseUtcInstant("2026-08-29T12:33:00.000Z");
const DECISION_UUID = "e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5";
const AUTHORIZATION_UUID = "f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6";

function baseline(key: "a" | "b"): Readonly<TestImplementationBaseline> {
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
    taskPackageDigest: parseSha256Digest(`sha256:${first ? "8".repeat(64) : "9".repeat(64)}`),
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
    resultDigest: parseSha256Digest(`sha256:${first ? "a".repeat(64) : "b".repeat(64)}`),
    targetReviewDecisionId: parseWakeflowDurableIdOfKind(
      first
        ? "target-review-decision_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        : "target-review-decision_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "target-review-decision",
    ),
    decisionDigest: parseSha256Digest(`sha256:${first ? "c".repeat(64) : "d".repeat(64)}`),
  });
}

/** 两个产品目标分别对应一个失败步骤；决定里的顺序故意倒置，授权按 targetTaskId 排序。 */
function productDefectDecision(): Readonly<ControllerTestReviewDecision> {
  const base = testReviewDecisionBaseInput();
  return createControllerTestReviewDecision(
    {
      ...base,
      reviewed: { ...base.reviewed, targetResultOutcome: "needs-review" },
      decision: "escalate",
      assessment: { conclusion: "defect-observed", evidenceSufficiency: "sufficient" },
      independentChecks: [
        {
          checkId: "api-contract",
          method: "复验真实环境入口与返回合同。",
          outcome: "failed",
          observation: "产品入口在批准输入下返回错误状态。",
        },
      ],
      rationale: "充分Evidence证明已接受实现存在产品缺陷。",
      escalation: {
        classification: "product-defect",
        remediation: {
          affectedTargets: [
            {
              targetTaskId: baseline("b").targetTaskId,
              failedStepIds: ["ts-3"],
              correctionObjective: "在原TaskPackage边界内修复状态持久化。",
            },
            {
              targetTaskId: baseline("a").targetTaskId,
              failedStepIds: ["ts-1"],
              correctionObjective: "在原TaskPackage边界内恢复批准的入口合同。",
            },
          ],
          authorizationRationale: "两个产品Target分别拥有可定位且不跨包的修复责任。",
        },
      },
      targetCompletion: null,
    },
    { clock: () => DECIDED_AT, uuidFactory: () => DECISION_UUID },
  );
}

function input(): CreateControllerProductDefectRemediationAuthorizationInput {
  const decision = productDefectDecision();
  return {
    decision,
    routeSource: {
      reviewSnapshotDigest: decision.reviewed.snapshotDigest,
      stateDigest: parseSha256Digest(`sha256:${"0".repeat(64)}`),
      streamRevision: parseDemandEventStreamRevision(13),
    },
    testTaskPackage: {
      taskPackageId: parseWakeflowDurableIdOfKind(
        "task-package_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "task-package",
      ),
      taskPackageDigest: parseSha256Digest(`sha256:${"6".repeat(64)}`),
    },
    failedSteps: [
      { stepId: "ts-3", observed: "重启后产品状态没有保留已确认值。" },
      { stepId: "ts-1", observed: "产品入口在批准输入下返回错误状态。" },
    ],
    baselines: [baseline("b"), baseline("a")],
  };
}

function createAuthorization(value: CreateControllerProductDefectRemediationAuthorizationInput = input()) {
  return createControllerProductDefectRemediationAuthorization(value, {
    clock: () => AUTHORIZED_AT,
    uuidFactory: () => AUTHORIZATION_UUID,
  });
}

test("产品缺陷修复授权从决定的 remediation 与读侧基线派生失败步骤映射", () => {
  const authorization = createAuthorization();
  equal(authorization.kind, "WakeflowControllerProductDefectRemediationAuthorization");
  equal(authorization.productDefectRemediationId, `product-defect-remediation_${AUTHORIZATION_UUID}`);
  equal(
    parseWakeflowDurableId(authorization.productDefectRemediationId).kind,
    "product-defect-remediation",
  );
  equal(productDefectRemediationAuthorizedEventId(authorization), `demand-event_${AUTHORIZATION_UUID}`);
  equal(authorization.boundary, "existing-task-packages-only");
  equal(authorization.source.streamRevision, 13);
  equal(authorization.source.reviewSnapshotDigest, input().decision.reviewed.snapshotDigest);
  equal(Object.hasOwn(authorization.source, "postAcceptanceRouteDigest"), false);
  deepEqual(
    authorization.failedSteps.map((step) => step.stepId),
    ["ts-1", "ts-3"],
  );
  deepEqual(
    authorization.affectedTargets.map((target) => target.baseline.targetTaskId),
    [baseline("a").targetTaskId, baseline("b").targetTaskId],
  );
  deepEqual(authorization.affectedTargets[0]?.failedStepIds, ["ts-1"]);
  equal(
    authorization.authorizationRationale,
    "两个产品Target分别拥有可定位且不跨包的修复责任。",
  );
  equal(Object.isFrozen(authorization), true);
  equal(Object.isFrozen(authorization.source), true);
  equal(Object.isFrozen(authorization.affectedTargets[0]?.baseline), true);
  equal(
    parseControllerProductDefectRemediationAuthorizationDocument(
      renderControllerProductDefectRemediationAuthorization(authorization),
    ).authorizationDigest,
    authorization.authorizationDigest,
  );
});

test("修复授权在分配身份与时间前拒绝错误Decision、缺失基线与不闭合映射", () => {
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
    testReviewDecisionBaseInput(),
    { clock: () => DECIDED_AT, uuidFactory: () => DECISION_UUID },
  );
  throws(
    () =>
      createControllerProductDefectRemediationAuthorization(
        { ...valid, decision: acceptDecision },
        options,
      ),
    (error: unknown) =>
      error instanceof ControllerProductDefectRemediationAuthorizationError &&
      error.reason === "decision",
  );
  throws(
    () =>
      createControllerProductDefectRemediationAuthorization(
        { ...valid, baselines: [baseline("a")] },
        options,
      ),
    (error: unknown) =>
      error instanceof ControllerProductDefectRemediationAuthorizationError &&
      error.reason === "relation",
  );
  throws(
    () =>
      createControllerProductDefectRemediationAuthorization(
        { ...valid, failedSteps: [valid.failedSteps[1]!] },
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
          routeSource: { ...valid.routeSource, streamRevision: parseDemandEventStreamRevision(14) },
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
        failedSteps: [...authorization.failedSteps].reverse(),
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
