import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  assertTargetDeliveryIntentMatchesTaskPackage,
  createTargetDeliveryIntent,
  parseTargetDeliveryIntent,
  projectTargetDeliveryProductDefectRemediationContext,
  projectTargetDeliveryReworkContext,
  renderTargetDeliveryPortablePrompt,
  targetDeliveryPurpose,
  TargetDeliveryIntentError,
} from "../../../src/governance/delivery/target-delivery-intent.js";
import {
  createTargetDeliveryReworkContext,
  TargetDeliveryReworkContextError,
} from "../../../src/governance/delivery/target-delivery-rework-context.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { createTaskPackage } from "../../../src/governance/tasking/task-package.js";
import {
  createTaskPackageFixture,
  taskPackageDraft,
  TASKING_CREATED_AT,
} from "../tasking/task-package.fixture.js";
import {
  createTargetDeliveryIntentFixture,
  TARGET_DELIVERY_BINDING_ID,
  TARGET_DELIVERY_ID,
  TARGET_DELIVERY_PREPARED_AT,
} from "./target-delivery-intent.fixture.js";
import { createTargetResultFixture } from "../result/target-result.fixture.js";
import { createControllerImplementationReviewDecision } from "../../../src/governance/review/controller-implementation-review-decision.js";
import {
  controllerImplementationReviewDecisionInput,
  createControllerImplementationReviewDecisionFixture,
} from "../review/controller-implementation-review-decision.fixture.js";

test("TargetDeliveryIntent 只冻结单目标路由、TaskPackage入口和轻量prompt", () => {
  const taskPackage = createTaskPackageFixture();
  const intent = createTargetDeliveryIntentFixture();
  equal(intent.targetDeliveryId, TARGET_DELIVERY_ID);
  equal(intent.target.taskPackageId, taskPackage.taskPackageId);
  equal(intent.route.windowId, taskPackage.assignment.windowId);
  equal(intent.route.bindingId, TARGET_DELIVERY_BINDING_ID);
  equal(intent.preparedAt, TARGET_DELIVERY_PREPARED_AT);
  equal(intent.preparedAt < taskPackage.createdAt, true);
  equal(Object.hasOwn(intent, "rework"), false);
  equal(Object.hasOwn(intent, "productDefectRemediation"), false);
  equal(targetDeliveryPurpose(intent), "initial");
  equal(
    intent.portablePrompt,
    renderTargetDeliveryPortablePrompt(taskPackage, "zh-Hans"),
  );
  equal(intent.portablePrompt.includes(taskPackage.objective), true);
  equal(intent.portablePrompt.includes(intent.target.taskPackageRef), true);
  equal(intent.portablePrompt.includes("投递成功不等于验收"), true);
  equal(
    /(?:rawHandle|threadId|sessionId|DispatchGroup|DispatchPacket|Envelope)/u.test(
      JSON.stringify(intent),
    ),
    false,
  );
  assertTargetDeliveryIntentMatchesTaskPackage(intent, taskPackage);
  equal(parseTargetDeliveryIntent(intent).intentDigest, intent.intentDigest);
});

test("产品缺陷修复Intent显式绑定Authorization且不伪装普通rework", () => {
  const taskPackage = createTaskPackageFixture();
  const previousResult = createTargetResultFixture();
  const remediation = projectTargetDeliveryProductDefectRemediationContext({
    authorization: {
      productDefectRemediationId: parseWakeflowDurableIdOfKind(
        "product-defect-remediation_78787878-7878-4878-8878-787878787878",
        "product-defect-remediation",
      ),
      authorizationDigest: parseSha256Digest(`sha256:${"8".repeat(64)}`),
    },
    testReviewDecision: {
      targetReviewDecisionId: parseWakeflowDurableIdOfKind(
        "target-review-decision_79797979-7979-4979-8979-797979797979",
        "target-review-decision",
      ),
      decisionDigest: parseSha256Digest(`sha256:${"9".repeat(64)}`),
    },
    previousResult: {
      targetResultId: previousResult.targetResultId,
      resultDigest: previousResult.resultDigest,
    },
    authorizationRationale: "真实环境Test已充分证明产品缺陷。",
    correctionObjective: "在原TaskPackage边界内恢复批准行为。",
    requiredCorrections: [
      {
        checkId: "real-environment-defect",
        outcome: "failed",
        method: "复验真实环境入口。",
        observation: "产品行为与冻结目标不一致。",
      },
    ],
  });
  const intent = createTargetDeliveryIntent(
    {
      targetDeliveryId: parseWakeflowDurableIdOfKind(
        "target-delivery_80808080-8080-4080-8080-808080808080",
        "target-delivery",
      ),
      taskPackage,
      hostId: "codex",
      bindingId: TARGET_DELIVERY_BINDING_ID,
      language: "zh-Hans",
      productDefectRemediation: remediation,
    },
    {
      clock: () => parseUtcInstant("2026-08-29T12:17:00.000Z"),
    },
  );
  equal(targetDeliveryPurpose(intent), "product-defect-remediation");
  equal(Object.hasOwn(intent, "rework"), false);
  equal(
    intent.productDefectRemediation?.authorization.productDefectRemediationId,
    remediation.authorization.productDefectRemediationId,
  );
  equal(intent.portablePrompt.includes("产品缺陷修复依据"), true);
  equal(intent.portablePrompt.includes("real-environment-defect"), true);
  assertTargetDeliveryIntentMatchesTaskPackage(intent, taskPackage);
  equal(parseTargetDeliveryIntent(intent).intentDigest, intent.intentDigest);

  throws(
    () =>
      createTargetDeliveryIntent(
        {
          targetDeliveryId: intent.targetDeliveryId,
          taskPackage,
          hostId: "codex",
          bindingId: TARGET_DELIVERY_BINDING_ID,
          language: "zh-Hans",
          rework: createTargetDeliveryReworkContext({
            decision:
              createControllerImplementationReviewDecisionFixture("rework"),
            previousResult,
          }),
          productDefectRemediation: remediation,
        },
        {
          clock: () => parseUtcInstant("2026-08-29T12:18:00.000Z"),
        },
      ),
    (error: unknown) =>
      error instanceof TargetDeliveryIntentError && error.reason === "relation",
  );
});

test("返工Intent绑定精确Decision/Result并只携带有界修正投影", () => {
  const taskPackage = createTaskPackageFixture();
  const previousResult = createTargetResultFixture();
  const decision =
    createControllerImplementationReviewDecisionFixture("rework");
  const rework = createTargetDeliveryReworkContext({
    decision,
    previousResult,
  });
  const intent = createTargetDeliveryIntent(
    {
      targetDeliveryId: parseWakeflowDurableIdOfKind(
        "target-delivery_89898989-8989-4989-8989-898989898989",
        "target-delivery",
      ),
      taskPackage,
      hostId: "codex",
      bindingId: TARGET_DELIVERY_BINDING_ID,
      language: "zh-Hans",
      rework,
    },
    {
      clock: () => parseUtcInstant("2026-08-29T12:16:00.000Z"),
    },
  );
  equal(
    intent.rework?.decision.targetReviewDecisionId,
    decision.targetReviewDecisionId,
  );
  equal(
    intent.rework?.previousResult.targetResultId,
    previousResult.targetResultId,
  );
  equal(intent.rework?.requiredCorrections[0]?.outcome, "failed");
  equal(targetDeliveryPurpose(intent), "implementation-review-rework");
  equal(intent.portablePrompt.includes("继续执行同一 TaskPackage"), true);
  equal(intent.portablePrompt.includes(decision.targetReviewDecisionId), true);
  equal(intent.portablePrompt.includes(previousResult.targetResultId), true);
  equal(intent.portablePrompt.includes("controller-rework"), true);
  equal(Object.hasOwn(intent.rework ?? {}, "independentChecks"), false);
  equal(Object.hasOwn(intent.rework ?? {}, "report"), false);
  assertTargetDeliveryIntentMatchesTaskPackage(intent, taskPackage);
  equal(parseTargetDeliveryIntent(intent).intentDigest, intent.intentDigest);

  const bounded = projectTargetDeliveryReworkContext({
    decision: rework.decision,
    previousResult: rework.previousResult,
    rationale: "返工原因".repeat(1_000),
    requiredCorrections: [
      {
        checkId: "bounded-summary",
        outcome: "failed",
        method: "检查方法".repeat(200),
        observation: "已观察事实".repeat(200),
      },
    ],
  });
  equal(Array.from(bounded.rationaleSummary).length, 1_024);
  equal(Array.from(bounded.requiredCorrections[0].methodSummary).length, 128);
  equal(
    Array.from(bounded.requiredCorrections[0].observationSummary).length,
    256,
  );
  equal(bounded.rationaleSummary.endsWith("…"), true);

  const backClockDecision = createControllerImplementationReviewDecision(
    controllerImplementationReviewDecisionInput("rework"),
    {
      clock: () => parseUtcInstant("2026-08-29T12:05:00.000Z"),
      uuidFactory: () => "91919191-9191-4191-8191-919191919191",
    },
  );
  equal(
    createTargetDeliveryReworkContext({
      decision: backClockDecision,
      previousResult,
    }).decision.targetReviewDecisionId,
    backClockDecision.targetReviewDecisionId,
  );

  throws(
    () =>
      createTargetDeliveryReworkContext({
        decision: createControllerImplementationReviewDecisionFixture("accept"),
        previousResult,
      }),
    (error: unknown) =>
      error instanceof TargetDeliveryReworkContextError &&
      error.reason === "relation",
  );
});

test("TargetDeliveryIntent 支持配置语言但不复制完整TaskPackage", () => {
  const taskPackage = createTaskPackageFixture();
  const english = createTargetDeliveryIntent(
    {
      targetDeliveryId: TARGET_DELIVERY_ID,
      taskPackage,
      hostId: "codex",
      bindingId: TARGET_DELIVERY_BINDING_ID,
      language: "en",
    },
    {
      clock: () => TARGET_DELIVERY_PREPARED_AT,
    },
  );
  equal(english.portablePrompt.startsWith("Wakeflow Target Task"), true);
  equal(english.portablePrompt.includes("delivery is not acceptance"), true);
  equal(Object.hasOwn(english, "taskPackage"), false);
  equal(Object.hasOwn(english, "boundaries"), false);
  equal(Object.hasOwn(english, "acceptanceAnchors"), false);
});

test("TargetDeliveryIntent 对长目标只生成确定性摘要并保留完整TaskPackage入口", () => {
  const longObjective = "目标🙂".repeat(3_000);
  const taskPackage = createTaskPackage(
    {
      ...taskPackageDraft(),
      objective: longObjective,
    },
    {
      clock: () => TASKING_CREATED_AT,
    },
  );
  const intent = createTargetDeliveryIntent(
    {
      targetDeliveryId: TARGET_DELIVERY_ID,
      taskPackage,
      hostId: "codex",
      bindingId: TARGET_DELIVERY_BINDING_ID,
      language: "zh-Hans",
    },
    {
      clock: () => TARGET_DELIVERY_PREPARED_AT,
    },
  );
  equal(intent.portablePrompt.includes(longObjective), false);
  equal(intent.portablePrompt.includes("…"), true);
  equal(intent.portablePrompt.includes(intent.target.taskPackageRef), true);
  assertTargetDeliveryIntentMatchesTaskPackage(intent, taskPackage);
});

test("TargetDeliveryIntent拒绝摘要漂移与错误来源并允许相同准备时间", () => {
  const intent = createTargetDeliveryIntentFixture();
  throws(
    () =>
      parseTargetDeliveryIntent({
        ...intent,
        portablePrompt: `${intent.portablePrompt}\n额外未授权内容`,
      }),
    (error: unknown) =>
      error instanceof TargetDeliveryIntentError && error.reason === "digest",
  );
  const taskPackage = createTaskPackageFixture();
  throws(
    () =>
      assertTargetDeliveryIntentMatchesTaskPackage(intent, {
        ...taskPackage,
        objective: "另一项任务",
      }),
    (error: unknown) =>
      error instanceof TargetDeliveryIntentError && error.reason === "relation",
  );
  const equalTime = createTargetDeliveryIntent(
    {
      targetDeliveryId: parseWakeflowDurableIdOfKind(
        "target-delivery_92929292-9292-4292-8292-929292929292",
        "target-delivery",
      ),
      taskPackage,
      hostId: "codex",
      bindingId: TARGET_DELIVERY_BINDING_ID,
      language: "zh-Hans",
    },
    {
      clock: () => TASKING_CREATED_AT,
    },
  );
  equal(equalTime.preparedAt, taskPackage.createdAt);
  assertTargetDeliveryIntentMatchesTaskPackage(equalTime, taskPackage);
});
