import { deepEqual, equal, rejects } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { ControllerImplementationReviewDecisionService } from "../../../src/governance/review/controller-implementation-review-decision-service.js";
import {
  ControllerTargetReviewResumeService,
  ControllerTargetReviewResumeServiceError,
} from "../../../src/governance/review/controller-target-review-resume-service.js";
import { ControllerTestReviewDecisionService } from "../../../src/governance/review/controller-test-review-decision-service.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import { executeTargetResultReviewInspectionPublicRequest } from "../../../src/governance/review/target-result-review-inspection-public-coordinator.js";
import { controllerImplementationReviewDecisionInput } from "./controller-implementation-review-decision.fixture.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
} from "./controller-test-review-decision-service.fixture.js";
import {
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
  readControllerImplementationReviewDecisionServiceSnapshot,
} from "./controller-implementation-review-decision-service.fixture.js";

const BLOCKED_AT = parseUtcInstant("2026-08-29T12:15:00.000Z");
const RESUMED_AT = parseUtcInstant("2026-08-29T12:20:00.000Z");
const ACCEPTED_AT = parseUtcInstant("2026-08-29T12:25:00.000Z");
const BLOCKED_UUID = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";
const RESUME_UUID = "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2";
const ACCEPT_UUID = "b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3";
const CONCURRENT_RESUME_UUID = "b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4";
const RETRY_UUID = "b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5";
const TEST_BLOCKED_AT = parseUtcInstant("2026-08-29T12:35:00.000Z");
const TEST_RESUMED_AT = parseUtcInstant("2026-08-29T12:36:00.000Z");
const TEST_ACCEPTED_AT = parseUtcInstant("2026-08-29T12:37:00.000Z");
const TEST_BLOCKED_UUID = "71717171-7171-4171-8171-717171717171";
const TEST_RESUME_UUID = "72727272-7272-4272-8272-727272727272";
const TEST_ACCEPT_UUID = "73737373-7373-4373-8373-737373737373";

async function readTestReviewSnapshot(workspacePath: string, demandId: string) {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return await readDemandResultReviewSnapshot(root);
  } finally {
    await root.close();
  }
}

test("blocked Review经显式Resume形成新generation并允许第二代Decision", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const decisionService = new ControllerImplementationReviewDecisionService(
      fixture.workspaceRoot,
    );
    const blockedJudgment =
      controllerImplementationReviewDecisionInput("blocked");
    const blockedRequest = Object.freeze({
      ...fixture.decisionRequest,
      decision: blockedJudgment.decision,
      assessment: blockedJudgment.assessment,
      independentChecks: blockedJudgment.independentChecks,
      rationale: blockedJudgment.rationale,
      blockingReasons: blockedJudgment.blockingReasons,
      residualRisks: blockedJudgment.residualRisks,
    });
    const blocked = await decisionService.decide(blockedRequest, {
      clock: () => BLOCKED_AT,
      uuidFactory: () => BLOCKED_UUID,
    });
    const blockedSnapshot =
      await readControllerImplementationReviewDecisionServiceSnapshot(fixture);
    const blockedTarget = blockedSnapshot.targets[0];
    if (
      blockedTarget?.status !== "review-decided" ||
      blockedTarget.phase !== "review-blocked"
    ) {
      throw new Error("Expected review-blocked target.");
    }
    const resumeRequest = Object.freeze({
      demandId: fixture.intent.demandId,
      targetTaskId: fixture.intent.target.targetTaskId,
      expectedBlockedState: Object.freeze({
        streamRevision: blockedSnapshot.eventStream.streamRevision,
        stateDigest: blockedSnapshot.eventStream.stateDigest,
      }),
      resolutionSummary: "用户已补充缺失决定，Controller可以重新执行独立审查。",
    });
    let clockReads = 0;
    let uuidReads = 0;
    const resumeService = new ControllerTargetReviewResumeService(
      fixture.workspaceRoot,
    );
    await rejects(
      resumeService.resume(
        {
          ...resumeRequest,
          expectedBlockedState: {
            ...resumeRequest.expectedBlockedState,
            stateDigest: `sha256:${"0".repeat(64)}`,
          },
        },
        {
          clock: () => {
            clockReads += 1;
            return RESUMED_AT;
          },
          uuidFactory: () => {
            uuidReads += 1;
            return RESUME_UUID;
          },
        },
      ),
      (error: unknown) =>
        error instanceof ControllerTargetReviewResumeServiceError &&
        error.reason === "review-snapshot",
    );
    equal(clockReads, 0);
    equal(uuidReads, 0);

    await rejects(
      resumeService.resume({
        ...resumeRequest,
        targetResultId: blockedTarget.targetResult.targetResultId,
      }),
      (error: unknown) =>
        error instanceof ControllerTargetReviewResumeServiceError &&
        error.reason === "input",
    );

    const concurrent = await Promise.all([
      resumeService.resume(resumeRequest, {
        clock: () => RESUMED_AT,
        uuidFactory: () => RESUME_UUID,
      }),
      resumeService.resume(resumeRequest, {
        clock: () => RESUMED_AT,
        uuidFactory: () => CONCURRENT_RESUME_UUID,
      }),
    ]);
    deepEqual(concurrent.map((result) => result.disposition).sort(), [
      "committed",
      "idempotent",
    ]);
    const resumed = concurrent.find(
      (result) => result.disposition === "committed",
    );
    if (resumed === undefined) {
      throw new Error("Expected one committed Resume winner.");
    }
    equal(resumed.status, "resumed");
    equal(resumed.disposition, "committed");
    equal(
      resumed.resume.blockedDecision.targetReviewDecisionId,
      blocked.decision.targetReviewDecisionId,
    );
    equal(
      resumed.resume.blockedDecision.decisionDigest,
      blocked.decision.decisionDigest,
    );
    equal(
      resumed.resume.blockedDecision.targetResultId,
      blockedTarget.targetResult.targetResultId,
    );
    equal(
      resumed.resume.blockedSource.snapshotDigest,
      blockedSnapshot.snapshotDigest,
    );
    const reportedSnapshot =
      await readControllerImplementationReviewDecisionServiceSnapshot(fixture);
    const reportedTarget = reportedSnapshot.targets[0];
    if (reportedTarget?.status !== "reported") {
      throw new Error("Expected resumed reported target.");
    }
    deepEqual(
      reportedTarget.priorReviewHistory.map((entry) => entry.kind),
      ["decision", "resume"],
    );
    const inspected = await executeTargetResultReviewInspectionPublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      targetTaskId: fixture.intent.target.targetTaskId,
    });
    deepEqual(
      inspected.reviewUnit.priorReviewHistory.map((entry) => entry.kind),
      ["decision", "resume"],
    );
    const priorDecision = inspected.reviewUnit.priorReviewHistory[0];
    const priorResume = inspected.reviewUnit.priorReviewHistory[1];
    if (priorDecision?.kind !== "decision" || priorResume?.kind !== "resume") {
      throw new Error("Expected public Decision/Resume history summaries.");
    }
    equal(priorDecision.decision.workType, "implementation");
    equal(priorDecision.decision.decision, "blocked");
    equal(
      priorResume.resume.targetReviewResumeId,
      resumed.resume.targetReviewResumeId,
    );
    const initialTarget = fixture.reviewSnapshot.targets[0];
    if (initialTarget?.status !== "reported") {
      throw new Error("Expected initial reported target.");
    }
    equal(
      reportedTarget.reviewUnitDigest === initialTarget.reviewUnitDigest,
      false,
    );

    const replayed = await resumeService.resume(resumeRequest, {
      clock: () => ACCEPTED_AT,
      uuidFactory: () => RETRY_UUID,
    });
    equal(replayed.status, "already-resumed");
    equal(
      replayed.resume.targetReviewResumeId,
      resumed.resume.targetReviewResumeId,
    );
    equal(replayed.resume.resumedAt, RESUMED_AT);

    const acceptedRequest = Object.freeze({
      ...fixture.decisionRequest,
      snapshotDigest: reportedSnapshot.snapshotDigest,
      reviewUnitDigest: reportedTarget.reviewUnitDigest,
    });
    const accepted = await decisionService.decide(acceptedRequest, {
      clock: () => ACCEPTED_AT,
      uuidFactory: () => ACCEPT_UUID,
    });
    equal(accepted.status, "decided");
    equal(accepted.decision.decision, "accept");
    equal(
      accepted.decision.targetReviewDecisionId ===
        blocked.decision.targetReviewDecisionId,
      false,
    );
    const finalSnapshot =
      await readControllerImplementationReviewDecisionServiceSnapshot(fixture);
    const finalTarget = finalSnapshot.targets[0];
    if (finalTarget?.status !== "review-decided") {
      throw new Error("Expected final review-decided target.");
    }
    equal(finalTarget.phase, "accepted");
    deepEqual(
      finalTarget.priorReviewHistory.map((entry) => entry.kind),
      ["decision", "resume"],
    );
    equal(finalTarget.reviewDecision.decision, "accept");
    equal(
      finalSnapshot.eventStream.streamRevision,
      fixture.reviewSnapshot.eventStream.streamRevision + 3,
    );
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("Test blocked Resume重新开放同一Result且不创建attempt", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  try {
    const decisionService = new ControllerTestReviewDecisionService(
      fixture.workspaceRoot,
    );
    const blocked = await decisionService.decide(
      {
        ...fixture.testDecisionRequest,
        decision: "blocked",
        assessment: {
          conclusion: "inconclusive",
          evidenceSufficiency: "insufficient",
        },
        independentChecks: [
          {
            checkId: "controller-test-external-blocker",
            method: "复验Test Evidence与当前外部确认状态。",
            outcome: "inconclusive",
            observation: "Evidence可读，但缺少用户对环境例外的确认。",
          },
        ],
        rationale: "等待外部确认后重新审阅同一Test Result。",
        blockingReasons: ["用户尚未确认环境例外是否可接受。"],
      },
      {
        clock: () => TEST_BLOCKED_AT,
        uuidFactory: () => TEST_BLOCKED_UUID,
      },
    );
    const blockedStateTarget =
      blocked.commandResult.aggregate.state.targetTasks.find(
        (target) => target.targetTaskId === fixture.testTargetTaskId,
      );
    if (
      blockedStateTarget?.workType !== "test" ||
      blockedStateTarget.phase !== "test-review-blocked"
    ) {
      throw new Error("Expected blocked Test target.");
    }
    const blockedAttempts = blockedStateTarget.testAttempts;
    const blockedSnapshot = await readTestReviewSnapshot(
      fixture.workspacePath,
      fixture.testClaimRequest.demandId,
    );
    const blockedTarget = blockedSnapshot.targets.find(
      (target) => target.targetTaskId === fixture.testTargetTaskId,
    );
    if (
      blockedTarget?.status !== "review-decided" ||
      blockedTarget.phase !== "test-review-blocked"
    ) {
      throw new Error("Expected Test review-blocked snapshot.");
    }
    const resumeRequest = {
      demandId: fixture.testClaimRequest.demandId,
      targetTaskId: fixture.testTargetTaskId,
      expectedBlockedState: {
        streamRevision: blockedSnapshot.eventStream.streamRevision,
        stateDigest: blockedSnapshot.eventStream.stateDigest,
      },
      resolutionSummary:
        "用户已确认环境例外，Controller可以重新审阅同一Result。",
    } as const;
    const resumed = await new ControllerTargetReviewResumeService(
      fixture.workspaceRoot,
    ).resume(resumeRequest, {
      clock: () => TEST_RESUMED_AT,
      uuidFactory: () => TEST_RESUME_UUID,
    });
    const resumedTarget =
      resumed.commandResult.aggregate.state.targetTasks.find(
        (target) => target.targetTaskId === fixture.testTargetTaskId,
      );
    if (
      resumedTarget?.workType !== "test" ||
      resumedTarget.phase !== "test-result-reported"
    ) {
      throw new Error("Expected resumed Test Result review.");
    }
    deepEqual(resumedTarget.testAttempts, blockedAttempts);
    equal(
      resumedTarget.currentDelivery.targetResult.targetResultId,
      blockedTarget.targetResult.targetResultId,
    );

    const reportedSnapshot = await readTestReviewSnapshot(
      fixture.workspacePath,
      fixture.testClaimRequest.demandId,
    );
    const reportedTarget = reportedSnapshot.targets.find(
      (target) => target.targetTaskId === fixture.testTargetTaskId,
    );
    if (
      reportedTarget?.status !== "reported" ||
      reportedTarget.targetResult.workType !== "test"
    ) {
      throw new Error("Expected resumed reported Test target.");
    }
    deepEqual(
      reportedTarget.priorReviewHistory.map((entry) => entry.kind),
      ["decision", "resume"],
    );
    equal(
      reportedTarget.targetResult.testExecution.testAttemptId,
      fixture.testAttemptId,
    );
    equal(
      reportedTarget.reviewUnitDigest ===
        fixture.testDecisionRequest.reviewUnitDigest,
      false,
    );

    const accepted = await decisionService.decide(
      {
        ...fixture.testDecisionRequest,
        snapshotDigest: reportedSnapshot.snapshotDigest,
        reviewUnitDigest: reportedTarget.reviewUnitDigest,
      },
      {
        clock: () => TEST_ACCEPTED_AT,
        uuidFactory: () => TEST_ACCEPT_UUID,
      },
    );
    equal(accepted.decision.decision, "accept");
    const finalTarget = accepted.commandResult.aggregate.state.targetTasks.find(
      (target) => target.targetTaskId === fixture.testTargetTaskId,
    );
    equal(finalTarget?.phase, "test-accepted");
    if (finalTarget?.workType !== "test" || !("testAttempts" in finalTarget)) {
      throw new Error("Expected accepted Test target with retained lineage.");
    }
    deepEqual(finalTarget.testAttempts, blockedAttempts);
    equal(
      accepted.commandResult.aggregate.streamRevision,
      fixture.reviewSnapshot.eventStream.streamRevision + 3,
    );
  } finally {
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});
