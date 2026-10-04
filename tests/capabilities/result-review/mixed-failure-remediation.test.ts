import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import { executeDemandCompletionRequest } from "../../../src/capabilities/demand/lifecycle.js";
import {
  executeImplementationReviewDecisionRequest,
  executeTestReviewDecisionRequest,
} from "../../../src/capabilities/result-review/service.js";
import {
  deriveStepViews,
  deriveUnionVerdict,
} from "../../../src/capabilities/result-review/decide.js";
import { parseUuidV4 } from "../../../src/foundation/identity/uuid-v4.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import {
  prepareFixtureDelivery,
  recordFixtureDeliveryOutcome,
  landFixturePrompt,
  loadFixtureDeliveryEnvelope,
  withFixtureDemandRoot,
  type DeliveryWindowRoute,
} from "../../governance/delivery/delivery-workspace.fixture.js";
import {
  createTestDeliveryWorkspaceFixture,
  cleanupTestDeliveryWorkspaceFixture,
  deliverFixtureTestTarget,
  type TestDeliveryWorkspaceFixture,
} from "../../governance/delivery/test-delivery-workspace.fixture.js";
import {
  CODEX_REVIEW_FACADE,
  currentFixtureStreamRevision,
  fixtureImplementationDecisionRequest,
  importFixtureImplementationResult,
  inspectFixtureReview,
  landFixtureTargetCompletion,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import {
  failingStep,
  passingStep,
  fixtureTestDecisionRequest,
  importFixtureTestResult,
  TEST_REVIEW_DECIDED_AT,
  TEST_REVIEW_INSPECTED_AT,
  TEST_TARGET_STOPPED_AT,
} from "../../governance/review/controller-test-review-decision-service.fixture.js";
import { planFixtureTestTask } from "../../governance/tasking/test-task-planning.fixture.js";

const at = (time: string) => parseUtcInstant(`2026-08-29T${time}.000Z`);
const options = (time: string, sequence: number) => ({
  durability: "none" as const,
  clock: () => at(time),
  uuidFactory: () =>
    parseUuidV4(`00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`),
});

async function deliverLater(
  fixture: TestDeliveryWorkspaceFixture,
  targetTaskId: string,
  route: DeliveryWindowRoute,
  hour: string,
) {
  const prepared = await prepareFixtureDelivery(
    fixture,
    {
      targetTaskId,
      expectedStreamRevision: await currentFixtureStreamRevision(fixture),
      idempotencyKey: `mixed-prepare-${hour}`,
    },
    { clock: () => at(`${hour}:00:00`), durability: "none" },
  );
  const landed = await landFixturePrompt(
    fixture,
    route,
    prepared.permit.prompt,
    at(`${hour}:00:01`),
  );
  const recorded = await recordFixtureDeliveryOutcome(
    fixture,
    prepared,
    {
      idempotencyKey: `mixed-outcome-${hour}`,
      observedAt: at(`${hour}:00:02`),
    },
    { clock: () => at(`${hour}:00:02`), durability: "none" },
  );
  const envelope = await loadFixtureDeliveryEnvelope(fixture, prepared.delivery.deliveryId);
  return { prepared, landed, recorded, envelope };
}

/** Exercise the real public retest path; a non-product failure remains unaccepted. */
async function retestMixedFailure(
  fixture: TestDeliveryWorkspaceFixture,
  first: string,
  second: string,
) {
  const repair = await deliverLater(fixture, fixture.targetTaskId, fixture.route, "13");
  deepEqual(
    repair.envelope.productDefectRemediation?.requiredCorrections.map((step) => step.stepId),
    [first],
  );
  const imported = await importFixtureImplementationResult(fixture, repair, {
    idempotencyKey: "mixed-repaired-import",
    evidence: fixture.evidence,
    reportedAt: at("13:01:00"),
  });
  await landFixtureTargetCompletion(fixture, fixture.route, at("13:02:00"));
  const inspection = await inspectFixtureReview(fixture, fixture.targetTaskId, {
    clock: () => at("13:03:00"),
  });
  const accepted = await executeImplementationReviewDecisionRequest(
    CODEX_REVIEW_FACADE,
    fixtureImplementationDecisionRequest(
      fixture,
      inspection,
      imported.event.streamRevision,
      "accept",
      "mixed-repaired-accept",
    ),
    options("13:04:00", 2),
  );
  const planned = await planFixtureTestTask(
    fixture,
    accepted.event.streamRevision,
    {
      idempotencyKey: "mixed-retest-plan",
      taskPackage: { lineage: { kind: "retest", retestsTargetTaskId: fixture.testTargetTaskId } },
    },
    { clock: () => at("13:05:00"), durability: "none" },
  );
  const retest = {
    ...fixture,
    testTargetTaskId: planned.targetTask.targetTaskId,
    testTaskPackageId: planned.targetTask.taskPackageId,
  };
  const delivered = await deliverLater(retest, retest.testTargetTaskId, retest.testRoute, "14");
  equal(
    delivered.envelope.attempt?.mode,
    "initial",
    "the new retest starts with its whole contract",
  );
  const result = await importFixtureTestResult(retest, delivered, {
    idempotencyKey: "mixed-retest-import",
    reportedAt: at("14:01:00"),
    steps: [passingStep(first, fixture.evidence), failingStep(second, fixture.evidence, "flaky")],
  });
  await landFixtureTargetCompletion(retest, retest.testRoute, at("14:02:00"));
  const review = await inspectFixtureReview(retest, retest.testTargetTaskId, {
    clock: () => at("14:03:00"),
  });
  equal(review.reviewUnit.testSteps?.[1]?.verdict, "fail");
  equal(review.reviewUnit.testSteps?.[1]?.baseline, null);
  const base = fixtureTestDecisionRequest(
    retest,
    review,
    result.event.streamRevision,
    "mixed-retest-decision",
  );
  await rejects(
    executeTestReviewDecisionRequest(CODEX_REVIEW_FACADE, base, options("14:04:00", 3)),
    (error: unknown) => isWakeflowError(error) && error.reason === "verdict",
  );
  const rerun = await executeTestReviewDecisionRequest(
    CODEX_REVIEW_FACADE,
    {
      ...base,
      decision: "request-another-attempt",
      stepIds: [second],
      assessment: { conclusion: "inconclusive", evidenceSufficiency: "insufficient" },
      independentChecks: [
        {
          checkId: "mixed-flaky-check",
          method: "Repeat the flaky observation",
          outcome: "inconclusive",
          observation: "The product fix did not close the other failure.",
        },
      ],
    },
    options("14:04:00", 3),
  );
  equal(rerun.target.phase, "test-another-attempt-requested");
  const repeated = await deliverLater(retest, retest.testTargetTaskId, retest.testRoute, "15");
  if (repeated.envelope.attempt?.mode !== "rerun") throw new Error("Expected a scoped rerun");
  deepEqual(repeated.envelope.attempt.rerunSource.stepIds, [second]);
  const passed = await importFixtureTestResult(retest, repeated, {
    idempotencyKey: "mixed-rerun-import",
    reportedAt: at("15:01:00"),
    steps: [passingStep(second, fixture.evidence)],
  });
  await landFixtureTargetCompletion(retest, retest.testRoute, at("15:02:00"));
  const finalReview = await inspectFixtureReview(retest, retest.testTargetTaskId, {
    clock: () => at("15:03:00"),
  });
  equal(finalReview.reviewUnit.testSteps?.[0]?.baseline?.attemptOrdinal, 1);
  const final = await executeTestReviewDecisionRequest(
    CODEX_REVIEW_FACADE,
    fixtureTestDecisionRequest(
      retest,
      finalReview,
      passed.event.streamRevision,
      "mixed-retest-accept",
    ),
    options("15:04:00", 4),
  );
  equal(final.target.phase, "test-accepted");
  const complete = await executeDemandCompletionRequest(
    { root: fixture.workspacePath, demandId: fixture.demandId, mode: "preview" },
    { clock: () => at("15:05:00"), durability: "none" },
  );
  if (complete.kind !== "WakeflowDemandCompletionPreview")
    throw new Error("Expected completion preview");
  equal(complete.status, "ready", complete.blockers.join(","));
}

for (const other of ["flaky", "harness-defect", "missing-evidence", "environment"] as const) {
  test(`混合 product-defect + ${other}：仅授权产品步骤，其余失败保留`, {
    timeout: 240_000,
  }, async () => {
    const fixture = await createTestDeliveryWorkspaceFixture({ maxAttempts: 2 });
    try {
      const [first, second] = fixture.testStepIds;
      if (first === undefined || second === undefined) throw new Error("Expected two test steps");
      const delivered = await deliverFixtureTestTarget(fixture);
      const imported = await importFixtureTestResult(fixture, delivered, {
        steps: [
          failingStep(first, fixture.evidence, "product-defect"),
          failingStep(second, fixture.evidence, other),
        ],
      });
      await landFixtureTargetCompletion(fixture, fixture.testRoute, TEST_TARGET_STOPPED_AT);
      const inspection = await inspectFixtureReview(fixture, fixture.testTargetTaskId, {
        clock: () => TEST_REVIEW_INSPECTED_AT,
      });
      const request = {
        ...fixtureTestDecisionRequest(
          fixture,
          inspection,
          imported.event.streamRevision,
          "mixed-escalation",
        ),
        decision: "escalate" as const,
        assessment: {
          conclusion: "defect-observed" as const,
          evidenceSufficiency: "sufficient" as const,
        },
        independentChecks: [
          {
            checkId: "mixed-check",
            method: "Check failure ownership by step",
            outcome: "failed" as const,
            observation: "Only the first failed step requires product remediation.",
          },
        ],
        escalation: {
          classification: "product-defect" as const,
          remediation: {
            affectedTargets: [
              {
                targetTaskId: fixture.targetTaskId,
                failedStepIds: [first] as [string],
                correctionObjective: "Repair only the product failure.",
              },
            ],
            authorizationRationale: "The other failure retains its own classification.",
          },
        },
      };
      const escalated = await executeTestReviewDecisionRequest(CODEX_REVIEW_FACADE, request, {
        ...options("12:37:00", 1),
        clock: () => TEST_REVIEW_DECIDED_AT,
      });
      equal(escalated.target.phase, "test-product-defect");
      const replay = await executeTestReviewDecisionRequest(
        CODEX_REVIEW_FACADE,
        request,
        options("12:37:00", 1),
      );
      equal(replay.status, "idempotent");
      await withFixtureDemandRoot(fixture, async (root) => {
        const history = await new DemandEventSourcingRepository(root).auditTargetResultHistory();
        const authorization = history.productDefectRemediationAuthorizations.at(-1)?.authorization;
        deepEqual(
          authorization?.failedSteps.map((step) => step.stepId),
          [first],
        );
        deepEqual(authorization?.affectedTargets[0]?.failedStepIds, [first]);
        const source = history.targetResults.find(
          (entry) => entry.result.targetResultId === imported.result.targetResultId,
        )?.result;
        const pkg = history.taskPackages.find(
          (entry) => entry.taskPackage.targetTaskId === fixture.testTargetTaskId,
        )?.taskPackage;
        if (source?.workType !== "test" || pkg?.workType !== "test")
          throw new Error("Expected source test records");
        equal(source.report.steps[1]?.failure?.classification, other);
        const views = deriveStepViews(
          pkg.testContract.steps,
          { steps: [], stepIds: [] },
          [],
          [
            {
              targetTaskId: pkg.targetTaskId,
              attemptOrdinal: 1,
              steps: source.report.steps,
              itemIdByStepId: new Map(
                pkg.testContract.steps.map((step) => [step.stepId, step.requirementRef.itemId]),
              ),
            },
          ],
        );
        equal(
          deriveUnionVerdict(views),
          "cannot-conclude",
          "failed steps cannot become approved baselines",
        );
      });
      if (other === "flaky") await retestMixedFailure(fixture, first, second);
    } finally {
      await cleanupTestDeliveryWorkspaceFixture(fixture);
    }
  });
}
