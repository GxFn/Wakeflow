import path from "node:path";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { TargetHostEffectOutcomeService } from "../../../src/governance/delivery/target-host-effect-outcome-service.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { TargetResultImportService } from "../../../src/governance/result/target-result-import-service.js";
import {
  readDemandResultReviewSnapshot,
  type DemandResultReviewSnapshot,
} from "../../../src/governance/review/demand-result-review-snapshot.js";
import {
  parseControllerTestReviewDecisionRequest,
  type ControllerTestReviewDecisionRequest,
} from "../../../src/governance/review/controller-test-review-decision-input.js";
import {
  TEST_CLAIMED_AT,
  cleanupTestHostEffectClaimWorkspaceFixture,
  createTestHostEffectClaimWorkspaceFixture,
  testClaimUuidFactory,
  type TestHostEffectClaimWorkspaceFixture,
} from "../testing/test-host-effect-claim-service.fixture.js";
import type { TestCardPlanningWorkspaceFixtureOptions } from "../testing/test-card-planning-service.fixture.js";

const TEST_OUTCOME_OBSERVED_AT = parseUtcInstant("2026-08-29T12:33:00.000Z");
const TEST_RESULT_REPORTED_AT = parseUtcInstant("2026-08-29T12:34:00.000Z");

export interface ControllerTestReviewDecisionServiceFixture extends TestHostEffectClaimWorkspaceFixture {
  readonly reviewSnapshot: Readonly<DemandResultReviewSnapshot>;
  readonly testDecisionRequest: Readonly<ControllerTestReviewDecisionRequest>;
}

async function readSnapshot(
  fixture: Readonly<TestHostEffectClaimWorkspaceFixture>,
): Promise<Readonly<DemandResultReviewSnapshot>> {
  const root = await RootedDirectory.open(
    path.join(
      fixture.workspacePath,
      ...demandFinalRootRef(fixture.testClaimRequest.demandId).split("/"),
    ),
  );
  try {
    return await readDemandResultReviewSnapshot(root);
  } finally {
    await root.close();
  }
}

export async function createControllerTestReviewDecisionServiceFixture(
  options: TestCardPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<ControllerTestReviewDecisionServiceFixture>> {
  const fixture = await createTestHostEffectClaimWorkspaceFixture(options);
  try {
    const claimed = await new TargetHostEffectClaimService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    ).claim(fixture.testClaimRequest, {
      clock: () => TEST_CLAIMED_AT,
      uuidFactory: testClaimUuidFactory(),
    });
    if (claimed.action?.kind !== "WakeflowTestDeliveryAgentHostAction") {
      throw new Error("Expected Test Agent Host Action fixture.");
    }
    const action = claimed.action;
    const outcome = await new TargetHostEffectOutcomeService(
      fixture.workspaceRoot,
      "codex",
    ).record({
      demandId: fixture.testClaimRequest.demandId,
      actionId: action.actionId,
      claimDigest: action.workClaim.claimDigest,
      attempt: {
        status: "accepted",
        evidence: { transport: "accepted" },
      },
      readback: {
        status: "pending",
        evidence: { visible: false },
      },
      observedAt: TEST_OUTCOME_OBSERVED_AT,
    });
    const evidenceLocators = fixture.testCard.approvedPlan.map((_step, index) =>
      Object.freeze({
        kind: "test-step-report" as const,
        ref: `evidence/test-runs/step-${index}.json`,
        digest: `sha256:${String(index + 1).repeat(64)}`,
      }),
    );
    await new TargetResultImportService(fixture.workspaceRoot, "codex").import(
      {
        demandId: fixture.testClaimRequest.demandId,
        actionId: action.actionId,
        observationDigest: outcome.observation.observationDigest,
        report: {
          workType: "test",
          content: {
            outcome: "completed",
            summary: "已执行全部Controller批准步骤并返回逐步事实。",
            evidenceLocators,
            verification: ["逐项复验Evidence ref与digest。"],
            risks: ["Result仍需Controller独立审查。"],
            stepEvidence: fixture.testCard.approvedPlan.map((step, index) => ({
              planIndex: index,
              step,
              evidence: {
                ref: evidenceLocators[index]!.ref,
                digest: evidenceLocators[index]!.digest,
              },
            })),
          },
        },
      },
      { clock: () => TEST_RESULT_REPORTED_AT },
    );
    const reviewSnapshot = await readSnapshot(fixture);
    const target = reviewSnapshot.targets.find(
      (entry) => entry.targetTaskId === fixture.testTargetTaskId,
    );
    if (
      target?.status !== "reported" ||
      target.targetResult.workType !== "test"
    ) {
      throw new Error("Expected reported Test review target fixture.");
    }
    const testDecisionRequest = parseControllerTestReviewDecisionRequest({
      demandId: fixture.testClaimRequest.demandId,
      targetResultId: target.targetResult.targetResultId,
      snapshotDigest: reviewSnapshot.snapshotDigest,
      reviewUnitDigest: target.reviewUnitDigest,
      decision: "accept" as const,
      assessment: Object.freeze({
        conclusion: "satisfied" as const,
        evidenceSufficiency: "sufficient" as const,
      }),
      independentChecks: Object.freeze([
        Object.freeze({
          checkId: "controller-test-evidence",
          method: "重新读取逐步Evidence并复验冻结Test问题。",
          outcome: "passed" as const,
          observation: "全部批准步骤的Evidence闭合且未观察到产品缺陷。",
        }),
      ] as const),
      rationale: "Controller独立检查已关闭当前真实环境风险。",
      blockingReasons: Object.freeze([]),
      residualRisks: Object.freeze(["该决定不替代后续Demand completion检查。"]),
    });
    return Object.freeze({
      ...fixture,
      reviewSnapshot,
      testDecisionRequest,
    });
  } catch (error: unknown) {
    await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
    throw error;
  }
}

export async function cleanupControllerTestReviewDecisionServiceFixture(
  fixture: Readonly<ControllerTestReviewDecisionServiceFixture>,
): Promise<void> {
  await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
}
