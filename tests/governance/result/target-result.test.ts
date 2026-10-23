import { equal, notEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  createImplementationTargetResult,
  ImplementationTargetResultError,
} from "../../../src/governance/result/implementation-target-result.js";
import { createImplementationTargetResultReport } from "../../../src/governance/result/implementation-target-result-report.js";
import {
  parseTargetResult,
  parseTargetResultDocument,
  renderTargetResult,
  type TargetResultDeliveryBinding,
  TargetResultError,
  targetResultIdForClaim,
  targetResultRecordedCommitIdFromResult,
  targetResultRecordedEventIdFromResult,
} from "../../../src/governance/result/target-result.js";
import { deriveDurableId } from "../../../src/kernel/ids.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  createDeliveryEnvelopeFixture,
  createDeliveryOutcomeFixture,
  createWorkClaimFixture,
  OTHER_DELIVERY_CLAIM_ID,
} from "../delivery/delivery-records.fixture.js";
import { createTaskPackageFixture } from "../tasking/task-package.fixture.js";
import {
  createImplementationTargetResultReportContentFixture,
  createImplementationTargetResultReportFixture,
  TARGET_RESULT_REPORTED_AT,
} from "./implementation-target-result-report.fixture.js";
import { createTargetResultFixture, deliveryBindingFromOutcome } from "./target-result.fixture.js";

useDisposableDurability();

function implementationTaskPackageFixture() {
  const taskPackage = createTaskPackageFixture();
  if (taskPackage.workType !== "implementation") {
    throw new Error("Expected implementation TaskPackage fixture.");
  }
  return taskPackage;
}

test("TargetResult闭合TaskPackage、投递信封、结局与Agent Report但不表示acceptance", () => {
  const claim = createWorkClaimFixture();
  const envelope = createDeliveryEnvelopeFixture({ claim });
  const outcome = createDeliveryOutcomeFixture({ claim, envelope });
  const result = createTargetResultFixture({ claim, envelope, outcome });
  equal(result.workType, "implementation");
  equal(Object.hasOwn(result, "testExecution"), false);
  equal(result.deliveryId, envelope.deliveryId);
  equal(result.targetResultId, targetResultIdForClaim(claim.claimId));
  equal(result.delivery.fence.claimId, claim.claimId);
  equal(result.delivery.fence.claimDigest, claim.claimDigest);
  equal(result.delivery.outcomeDigest, outcome.outcomeDigest);
  equal(result.delivery.disposition, "accepted");
  equal(result.delivery.generation, 1);
  equal(result.report.outcome, "completed");
  equal(Object.hasOwn(result, "controllerDecision"), false);
  equal(Object.hasOwn(result, "hostEffect"), false);
  equal(
    targetResultRecordedEventIdFromResult(result),
    deriveDurableId("demand-event", "target-result", claim.claimId),
  );
  equal(
    targetResultRecordedCommitIdFromResult(result),
    deriveDurableId("demand-event-commit", "target-result", claim.claimId),
  );
  const document = renderTargetResult(result);
  equal(parseTargetResultDocument(document).resultDigest, result.resultDigest);
});

test("completed TargetResult要求完整anchor mapping与TaskPackage commit policy", () => {
  const taskPackage = implementationTaskPackageFixture();
  const claim = createWorkClaimFixture();
  const envelope = createDeliveryEnvelopeFixture({ claim });
  const delivery = deliveryBindingFromOutcome(createDeliveryOutcomeFixture({ claim, envelope }));
  throws(
    () =>
      createImplementationTargetResult({
        taskPackage,
        envelope,
        delivery,
        report: createImplementationTargetResultReport(
          {
            ...createImplementationTargetResultReportContentFixture(),
            anchorEvidence: [],
          },
          { clock: () => TARGET_RESULT_REPORTED_AT },
        ),
      }),
    (error: unknown) =>
      error instanceof ImplementationTargetResultError && error.reason === "relation",
  );
  throws(
    () =>
      createImplementationTargetResult({
        taskPackage,
        envelope,
        delivery,
        report: createImplementationTargetResultReport(
          {
            ...createImplementationTargetResultReportContentFixture(),
            repositoryChange: {
              repositoryId: taskPackage.assignment.repositoryId,
              disposition: "committed",
              branch: null,
              commits: [{ algorithm: "sha1", value: "a".repeat(40) }],
            },
          },
          { clock: () => TARGET_RESULT_REPORTED_AT },
        ),
      }),
    (error: unknown) =>
      error instanceof ImplementationTargetResultError && error.reason === "relation",
  );
});

test("投递绑定必须跟随信封：另一把声明的围栏或 rejected 结局都不能产生 TargetResult", () => {
  const claim = createWorkClaimFixture();
  const envelope = createDeliveryEnvelopeFixture({ claim });
  const foreignClaim = createWorkClaimFixture({ claimId: OTHER_DELIVERY_CLAIM_ID });
  throws(
    () =>
      createImplementationTargetResult({
        taskPackage: implementationTaskPackageFixture(),
        envelope,
        delivery: deliveryBindingFromOutcome(
          createDeliveryOutcomeFixture({ claim: foreignClaim, envelope }),
        ),
        report: createImplementationTargetResultReportFixture(),
      }),
    (error: unknown) =>
      error instanceof ImplementationTargetResultError && error.reason === "delivery",
  );
  const rejected = {
    ...deliveryBindingFromOutcome(createDeliveryOutcomeFixture({ claim, envelope })),
    disposition: "rejected-before-send",
  } as unknown as TargetResultDeliveryBinding;
  throws(
    () =>
      createImplementationTargetResult({
        taskPackage: implementationTaskPackageFixture(),
        envelope,
        delivery: rejected,
        report: createImplementationTargetResultReportFixture(),
      }),
    (error: unknown) =>
      error instanceof ImplementationTargetResultError && error.reason === "delivery",
  );
});

test("blocked TargetResult允许部分或空anchor evidence且仍不是acceptance", () => {
  const claim = createWorkClaimFixture();
  const envelope = createDeliveryEnvelopeFixture({ claim });
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
    envelope,
    delivery: deliveryBindingFromOutcome(
      createDeliveryOutcomeFixture({
        claim,
        envelope,
        disposition: "indeterminate",
        readbackStatus: "unavailable",
      }),
    ),
    report,
  });
  equal(result.report.outcome, "blocked");
  equal(result.delivery.disposition, "indeterminate");
  equal(Object.hasOwn(result, "accepted"), false);
});

test("R5（§13.210）：取代的结果由同一声明的第二序号派生身份并点名第一份；第一份带 supersedes、第二份不带、点错对象都是 relation 错", () => {
  const claim = createWorkClaimFixture();
  const envelope = createDeliveryEnvelopeFixture({ claim });
  const outcome = createDeliveryOutcomeFixture({ claim, envelope });
  const first = createTargetResultFixture({ claim, envelope, outcome });
  const taskPackage = createTaskPackageFixture();
  if (taskPackage.workType !== "implementation") throw new Error("Expected implementation.");
  const second = createImplementationTargetResult({
    taskPackage,
    envelope,
    delivery: deliveryBindingFromOutcome(outcome),
    report: createImplementationTargetResultReportFixture(),
    supersedes: first.targetResultId,
  });
  equal(second.targetResultId, targetResultIdForClaim(claim.claimId, 2));
  notEqual(second.targetResultId, first.targetResultId);
  equal(second.supersedes, first.targetResultId);
  notEqual(second.resultDigest, first.resultDigest);
  equal(
    targetResultRecordedEventIdFromResult(second),
    deriveDurableId("demand-event", "target-result-supersede", claim.claimId),
  );
  equal(
    targetResultRecordedCommitIdFromResult(second),
    deriveDurableId("demand-event-commit", "target-result-supersede", claim.claimId),
  );
  equal(parseTargetResultDocument(renderTargetResult(second)).supersedes, first.targetResultId);
  const relation = (error: unknown) =>
    error instanceof TargetResultError && error.reason === "relation";
  throws(() => parseTargetResult({ ...first, supersedes: first.targetResultId }), relation);
  const { supersedes: _dropped, ...withoutSupersedes } = second;
  throws(() => parseTargetResult(withoutSupersedes), relation);
  throws(
    () => parseTargetResult({ ...second, supersedes: targetResultIdForClaim(claim.claimId, 2) }),
    relation,
  );
});
