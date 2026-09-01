import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  parseTargetResultDocument,
  renderTargetResult,
  targetResultIdForAction,
  targetResultRecordedCommitId,
  targetResultRecordedEventId,
} from "../../../src/governance/result/target-result.js";
import {
  createImplementationTargetResult,
  ImplementationTargetResultError,
} from "../../../src/governance/result/implementation-target-result.js";
import { createImplementationTargetResultReport } from "../../../src/governance/result/implementation-target-result-report.js";
import { createTargetDeliveryHostEffectObservationFixture } from "../delivery/target-delivery-host-effect-observation.fixture.js";
import { createTargetDeliveryIntentFixture } from "../delivery/target-delivery-intent.fixture.js";
import { createWindowWorkClaimFixture } from "../delivery/window-work-claim.fixture.js";
import { createTaskPackageFixture } from "../tasking/task-package.fixture.js";
import { createTargetResultFixture } from "./target-result.fixture.js";
import {
  createImplementationTargetResultReportContentFixture,
  createImplementationTargetResultReportFixture,
  TARGET_RESULT_REPORTED_AT,
} from "./implementation-target-result-report.fixture.js";

function implementationTaskPackageFixture() {
  const taskPackage = createTaskPackageFixture();
  if (taskPackage.workType !== "implementation") {
    throw new Error("Expected implementation TaskPackage fixture.");
  }
  return taskPackage;
}

test("TargetResult闭合TaskPackage、Host Effect与Agent Report但不表示acceptance", () => {
  const result = createTargetResultFixture();
  equal(result.workType, "implementation");
  equal(Object.hasOwn(result, "testExecution"), false);
  equal(
    result.targetResultId,
    targetResultIdForAction(result.hostEffect.actionId),
  );
  equal(result.report.outcome, "completed");
  equal(result.report.reportedAt < result.hostEffect.observedAt, true);
  equal(Object.hasOwn(result, "controllerDecision"), false);
  equal(Object.hasOwn(result, "transportGroup"), false);
  const claim = createWindowWorkClaimFixture();
  equal(
    targetResultRecordedEventId(claim),
    `demand-event_${claim.claimTransition.commitId.slice("demand-event-commit_".length)}`,
  );
  equal(
    targetResultRecordedCommitId(claim),
    `demand-event-commit_${claim.claimTransition.eventId.slice("demand-event_".length)}`,
  );
  const document = renderTargetResult(result);
  equal(parseTargetResultDocument(document).resultDigest, result.resultDigest);
});

test("completed TargetResult要求完整anchor mapping与TaskPackage commit policy", () => {
  const taskPackage = implementationTaskPackageFixture();
  const intent = createTargetDeliveryIntentFixture();
  const claim = createWindowWorkClaimFixture();
  const observation = createTargetDeliveryHostEffectObservationFixture({
    claim,
  });
  throws(
    () =>
      createImplementationTargetResult({
        taskPackage,
        intent,
        claim,
        observation,
        report: createImplementationTargetResultReport(
          {
            ...createImplementationTargetResultReportContentFixture(),
            anchorEvidence: [],
          },
          { clock: () => TARGET_RESULT_REPORTED_AT },
        ),
      }),
    (error: unknown) =>
      error instanceof ImplementationTargetResultError &&
      error.reason === "relation",
  );
  throws(
    () =>
      createImplementationTargetResult({
        taskPackage,
        intent,
        claim,
        observation,
        report: createImplementationTargetResultReport(
          {
            ...createImplementationTargetResultReportContentFixture(),
            repositoryChange: {
              repositoryId: taskPackage.assignment.repositoryId,
              disposition: "committed",
              commits: [{ algorithm: "sha1", value: "a".repeat(40) }],
            },
          },
          { clock: () => TARGET_RESULT_REPORTED_AT },
        ),
      }),
    (error: unknown) =>
      error instanceof ImplementationTargetResultError &&
      error.reason === "relation",
  );
});

test("rejected-before-effect不能产生TargetResult", () => {
  const claim = createWindowWorkClaimFixture();
  throws(
    () =>
      createImplementationTargetResult({
        taskPackage: implementationTaskPackageFixture(),
        intent: createTargetDeliveryIntentFixture(),
        claim,
        observation: createTargetDeliveryHostEffectObservationFixture({
          claim,
          attemptStatus: "rejected-before-effect",
          readbackStatus: "unavailable",
        }),
        report: createImplementationTargetResultReportFixture(),
      }),
    (error: unknown) =>
      error instanceof ImplementationTargetResultError &&
      error.reason === "relation",
  );
});

test("blocked TargetResult允许部分或空anchor evidence且仍不是acceptance", () => {
  const claim = createWindowWorkClaimFixture();
  const report = createImplementationTargetResultReport(
    {
      ...createImplementationTargetResultReportContentFixture(),
      outcome: "blocked",
      summary: "缺少外部授权，当前任务无法继续。",
      anchorEvidence: [],
    },
    { clock: () => TARGET_RESULT_REPORTED_AT },
  );
  const result = createImplementationTargetResult({
    taskPackage: implementationTaskPackageFixture(),
    intent: createTargetDeliveryIntentFixture(),
    claim,
    observation: createTargetDeliveryHostEffectObservationFixture({ claim }),
    report,
  });
  equal(result.report.outcome, "blocked");
  equal(Object.hasOwn(result, "accepted"), false);
});
