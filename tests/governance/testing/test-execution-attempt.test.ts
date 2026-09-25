import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  parseTaskPackage,
  type TestSetupPolicy,
  type TestTaskPackage,
} from "../../../src/governance/tasking/task-package.js";
import {
  assertTestExecutionAttemptMatchesPackage,
  createInitialTestExecutionAttempt,
  createRerunTestExecutionAttempt,
  parseTestExecutionAttempt,
  TestExecutionAttemptError,
} from "../../../src/governance/testing/test-execution-attempt.js";
import {
  createTaskPackageFixture,
  SELECTED_AUTHORITY_REF,
  TASKING_REPOSITORY_ID,
  TASKING_WINDOW_ID,
} from "../tasking/task-package.fixture.js";

function testPackage(setupPolicy: TestSetupPolicy): Readonly<TestTaskPackage> {
  const implementation = createTaskPackageFixture();
  if (implementation.workType !== "implementation") {
    throw new Error("Expected implementation fixture.");
  }
  const {
    assignment: _assignment,
    commitExpectation: _commitExpectation,
    acceptanceAnchors,
    lineage: _lineage,
    planReview: _planReview,
    sectionAnchors: _sectionAnchors,
    ...common
  } = implementation;
  const requirementRef = acceptanceAnchors[0]?.requirementRef;
  const parsed = parseTaskPackage({
    ...common,
    assignment: { windowId: TASKING_WINDOW_ID },
    workType: "test",
    acceptanceAnchors: [],
    testContract: {
      question: "已接受实现能否在真实环境保持目标行为？",
      objectBoundary: "只观察当前 Demand 的产品入口",
      steps: [{
        stepId: "ts-1",
        given: "已确认的真实环境",
        when: "执行冷启动",
        // biome-ignore lint/suspicious/noThenProperty: Given/When/Then 合同步骤字段
        then: "入口按需求响应",
        requirementRef,
      }],
      environment: SELECTED_AUTHORITY_REF,
      allowedSkills: ["skills/real-environment-test/SKILL.md"],
      setupPolicy,
      maxAttempts: 2,
      stopConditions: ["需要未批准操作时停止"],
    },
    implementationBaselines: [{
      targetTaskId: "target-task_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      taskPackageId: "task-package_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      taskPackageDigest: `sha256:${"d".repeat(64)}`,
      repositoryId: TASKING_REPOSITORY_ID,
      windowId: TASKING_WINDOW_ID,
      targetResultId: "target-result_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      resultDigest: `sha256:${"e".repeat(64)}`,
      targetReviewDecisionId: "target-review-decision_ffffffff-ffff-4fff-8fff-ffffffffffff",
      decisionDigest: `sha256:${"f".repeat(64)}`,
    }],
    lineage: null,
  });
  if (parsed.workType !== "test") throw new Error("Expected Test variant.");
  return parsed;
}

const INITIAL_ATTEMPT_ID = parseWakeflowDurableIdOfKind(
  "test-attempt_a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1",
  "test-attempt",
);
const RERUN_ATTEMPT_ID = parseWakeflowDurableIdOfKind(
  "test-attempt_a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2",
  "test-attempt",
);

function attempts(setupPolicy: TestSetupPolicy) {
  const taskPackage = testPackage(setupPolicy);
  const initial = createInitialTestExecutionAttempt({
    testAttemptId: INITIAL_ATTEMPT_ID,
    taskPackage,
  });
  const rerun = createRerunTestExecutionAttempt({
    testAttemptId: RERUN_ATTEMPT_ID,
    taskPackage,
    previousAttempt: initial,
    previousResult: {
      targetResultId: parseWakeflowDurableIdOfKind(
        "target-result_a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3",
        "target-result",
      ),
      resultDigest: parseSha256Digest(`sha256:${"a".repeat(64)}`),
    },
    reviewDecision: {
      targetReviewDecisionId: parseWakeflowDurableIdOfKind(
        "target-review-decision_a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4",
        "target-review-decision",
      ),
      decisionDigest: parseSha256Digest(`sha256:${"b".repeat(64)}`),
    },
    stepIds: null,
  });
  return { taskPackage, initial, rerun };
}

const EXPECTED_DIRECTIVES: Readonly<Record<TestSetupPolicy, readonly [string, string]>> = {
  "fresh-per-attempt": ["prepare-fresh-environment", "prepare-fresh-environment"],
  "fresh-once": ["prepare-fresh-environment", "reuse-confirmed-environment"],
  "reuse-existing": ["reuse-confirmed-environment", "reuse-confirmed-environment"],
};

function isReason(reason: string) {
  return (error: unknown) =>
    error instanceof TestExecutionAttemptError && error.reason === reason;
}

test("each setup policy maps initial and rerun attempts to a pinned directive", () => {
  for (const [policy, [initialDirective, rerunDirective]] of Object.entries(EXPECTED_DIRECTIVES)) {
    const { taskPackage, initial, rerun } = attempts(policy as TestSetupPolicy);
    equal(initial.environmentSetup.policy, policy);
    equal(initial.environmentSetup.directive, initialDirective);
    equal(rerun.environmentSetup.directive, rerunDirective);
    for (const attempt of [initial, rerun]) {
      assertTestExecutionAttemptMatchesPackage(attempt, taskPackage);
      const other = attempt.environmentSetup.directive === "prepare-fresh-environment"
        ? "reuse-confirmed-environment"
        : "prepare-fresh-environment";
      const tampered = {
        ...attempt,
        environmentSetup: { policy, directive: other },
      };
      throws(() => parseTestExecutionAttempt(tampered), isReason("schema"));
      throws(
        () => assertTestExecutionAttemptMatchesPackage(tampered, taskPackage),
        isReason("schema"),
      );
    }
  }
});

test("an attempt made under one setup policy does not match a package with another", () => {
  const { initial } = attempts("fresh-once");
  throws(
    () => assertTestExecutionAttemptMatchesPackage(initial, testPackage("reuse-existing")),
    isReason("relation"),
  );
});
