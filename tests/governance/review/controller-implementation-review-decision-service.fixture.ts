import path from "node:path";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { TargetHostEffectOutcomeService } from "../../../src/governance/delivery/target-host-effect-outcome-service.js";
import {
  readDemandResultReviewSnapshot,
  type DemandResultReviewSnapshot,
} from "../../../src/governance/review/demand-result-review-snapshot.js";
import type { ControllerImplementationReviewDecisionRequest } from "../../../src/governance/review/controller-implementation-review-decision-input.js";
import { TargetResultImportService } from "../../../src/governance/result/target-result-import-service.js";
import { TaskPackageProjectionStore } from "../../../src/governance/tasking/task-package-projection-store.js";
import {
  CLAIMED_AT,
  claimUuidFactory,
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
  type TargetHostEffectClaimWorkspaceFixture,
} from "../delivery/target-host-effect-claim-service.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "../result/implementation-target-result-report.fixture.js";
import { controllerImplementationReviewDecisionInput } from "./controller-implementation-review-decision.fixture.js";
import type { TargetTaskPlanningWorkspaceFixtureOptions } from "../tasking/target-task-planning-service.fixture.js";

const OUTCOME_AT = parseUtcInstant("2026-08-29T12:06:00.000Z");
const REPORTED_AT = parseUtcInstant("2026-08-29T12:10:00.000Z");

export interface ControllerImplementationReviewDecisionServiceFixture extends TargetHostEffectClaimWorkspaceFixture {
  readonly reviewSnapshot: Readonly<DemandResultReviewSnapshot>;
  readonly decisionRequest: Readonly<ControllerImplementationReviewDecisionRequest>;
}

async function withDemandRoot<Result>(
  fixture: Readonly<TargetHostEffectClaimWorkspaceFixture>,
  use: (root: RootedDirectory) => Promise<Result>,
): Promise<Result> {
  const root = await RootedDirectory.open(
    path.join(
      fixture.workspacePath,
      ...demandFinalRootRef(fixture.intent.demandId).split("/"),
    ),
  );
  try {
    return await use(root);
  } finally {
    await root.close();
  }
}

export async function readControllerImplementationReviewDecisionServiceSnapshot(
  fixture: Readonly<TargetHostEffectClaimWorkspaceFixture>,
): Promise<Readonly<DemandResultReviewSnapshot>> {
  return withDemandRoot(fixture, readDemandResultReviewSnapshot);
}

export async function createControllerImplementationReviewDecisionServiceFixture(
  options: TargetTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<ControllerImplementationReviewDecisionServiceFixture>> {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture(options);
  try {
    const taskPackage = await withDemandRoot(fixture, async (root) => {
      const snapshot = await readDemandResultReviewSnapshot(root);
      const target = snapshot.targets[0];
      if (target?.status !== "awaiting-result") {
        throw new Error("Expected awaiting-result fixture target.");
      }
      return (
        await new TaskPackageProjectionStore(root).load(
          target.taskPackage.taskPackageId,
          { expectedTaskPackageDigest: target.taskPackage.digest },
        )
      ).taskPackage;
    });
    const claimed = await new TargetHostEffectClaimService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    ).claim(fixture.claimRequest, {
      clock: () => CLAIMED_AT,
      uuidFactory: claimUuidFactory(),
    });
    if (claimed.action === null) throw new Error("Expected issued action.");
    const outcome = await new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    ).record({
      demandId: fixture.intent.demandId,
      actionId: claimed.action.actionId,
      claimDigest: claimed.action.workClaim.claimDigest,
      attempt: { status: "accepted", evidence: { fixture: "review-service" } },
      readback: { status: "pending", evidence: { visible: false } },
      observedAt: OUTCOME_AT,
    });
    await new TargetResultImportService(fixture.workspaceRoot, "codex").import(
      {
        demandId: fixture.intent.demandId,
        actionId: claimed.action.actionId,
        observationDigest: outcome.observation.observationDigest,
        report: {
          workType: "implementation",
          content:
            createImplementationTargetResultReportContentFixture(taskPackage),
        },
      },
      { clock: () => REPORTED_AT },
    );
    const reviewSnapshot =
      await readControllerImplementationReviewDecisionServiceSnapshot(fixture);
    const target = reviewSnapshot.targets[0];
    if (target?.status !== "reported") {
      throw new Error("Expected reported fixture target.");
    }
    const judgment = controllerImplementationReviewDecisionInput();
    return Object.freeze({
      ...fixture,
      reviewSnapshot,
      decisionRequest: Object.freeze({
        demandId: fixture.intent.demandId,
        targetResultId: target.targetResult.targetResultId,
        snapshotDigest: reviewSnapshot.snapshotDigest,
        reviewUnitDigest: target.reviewUnitDigest,
        decision: judgment.decision,
        assessment: judgment.assessment,
        independentChecks: judgment.independentChecks,
        rationale: judgment.rationale,
        blockingReasons: judgment.blockingReasons,
        residualRisks: judgment.residualRisks,
      }),
    });
  } catch (error: unknown) {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
    throw error;
  }
}

export async function cleanupControllerImplementationReviewDecisionServiceFixture(
  fixture: Readonly<ControllerImplementationReviewDecisionServiceFixture>,
): Promise<void> {
  await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
}
