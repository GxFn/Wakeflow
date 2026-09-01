import { deepEqual, equal, rejects } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { inspectDemandEventSourcingRootInventory } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { TargetHostEffectOutcomeService } from "../../../src/governance/delivery/target-host-effect-outcome-service.js";
import {
  readDemandResultReviewSnapshot,
  DemandResultReviewSnapshotError,
} from "../../../src/governance/review/demand-result-review-snapshot.js";
import { TargetResultImportService } from "../../../src/governance/result/target-result-import-service.js";
import { TaskPackageProjectionStore } from "../../../src/governance/tasking/task-package-projection-store.js";
import {
  CLAIMED_AT,
  claimUuidFactory,
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
} from "../delivery/target-host-effect-claim-service.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "../result/implementation-target-result-report.fixture.js";

const OUTCOME_AT = parseUtcInstant("2026-08-29T12:06:00.000Z");
const REPORTED_AT = parseUtcInstant("2026-08-29T12:10:00.000Z");

async function openDemandRoot(
  workspacePath: string,
  demandId: string,
): Promise<RootedDirectory> {
  return RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
}

async function withDemandRoot<Result>(
  workspacePath: string,
  demandId: string,
  use: (root: RootedDirectory) => Promise<Result>,
): Promise<Result> {
  const root = await openDemandRoot(workspacePath, demandId);
  try {
    return await use(root);
  } finally {
    await root.close();
  }
}

test("Demand Result Review Snapshot从同一Event Stream零写重建当前审查输入", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const prepared = await withDemandRoot(
      fixture.workspacePath,
      fixture.intent.demandId,
      async (demandRoot) => {
        const awaiting = await readDemandResultReviewSnapshot(demandRoot);
        const awaitingTarget = awaiting.targets[0];
        if (awaitingTarget?.status !== "awaiting-result") {
          throw new Error("Expected awaiting-result review target.");
        }
        const loadedTaskPackage = await new TaskPackageProjectionStore(
          demandRoot,
        ).load(awaitingTarget.taskPackage.taskPackageId, {
          expectedTaskPackageDigest: awaitingTarget.taskPackage.digest,
        });
        return { awaitingTarget, loadedTaskPackage };
      },
    );
    equal(prepared.awaitingTarget.phase, "delivery-prepared");
    equal(Object.hasOwn(prepared.awaitingTarget, "targetResult"), false);
    equal(
      Object.hasOwn(prepared.awaitingTarget.taskPackage, "objective"),
      false,
    );

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
      attempt: { status: "accepted", evidence: { fixture: "review" } },
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
          content: createImplementationTargetResultReportContentFixture(
            prepared.loadedTaskPackage.taskPackage,
          ),
        },
      },
      { clock: () => REPORTED_AT },
    );

    const observed = await withDemandRoot(
      fixture.workspacePath,
      fixture.intent.demandId,
      async (demandRoot) => {
        const before =
          await inspectDemandEventSourcingRootInventory(demandRoot);
        const first = await readDemandResultReviewSnapshot(demandRoot);
        const second = await readDemandResultReviewSnapshot(demandRoot);
        const after = await inspectDemandEventSourcingRootInventory(demandRoot);
        return { before, first, second, after };
      },
    );
    const { before, first, second, after } = observed;

    deepEqual(second, first);
    equal(Object.isFrozen(first), true);
    equal(Object.isFrozen(first.targets), true);
    equal(first.targets.length, 1);
    const target = first.targets[0];
    if (target?.status !== "reported") {
      throw new Error("Expected reported review target.");
    }
    equal(Object.isFrozen(target), true);
    equal(target.outcome, "completed");
    equal(target.taskPackage.taskPackageId, fixture.taskPackageId);
    equal(target.targetResult.targetTaskId, fixture.targetTaskId);
    equal(
      target.taskPackageSourceEvent.streamRevision <
        target.targetResultSourceEvent.streamRevision,
      true,
    );
    const { reviewUnitDigest, ...unitBasis } = target;
    equal(reviewUnitDigest, computeCanonicalJsonSha256Digest(unitBasis));
    const { snapshotDigest, ...snapshotBasis } = first;
    equal(snapshotDigest, computeCanonicalJsonSha256Digest(snapshotBasis));
    equal(Object.hasOwn(first, "allowedDecisions"), false);
    equal(Object.hasOwn(first, "reviewCandidate"), false);
    equal(Object.hasOwn(first, "nextAction"), false);
    equal(after.commitCount, before.commitCount);
    equal(after.snapshotCount, before.snapshotCount);
    equal(after.artifactCount, before.artifactCount);
    equal(after.transactionCount, before.transactionCount);
    equal(after.appendCandidateCount, before.appendCandidateCount);
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Demand Result Review Snapshot拒绝非RootedDirectory和额外选项", async () => {
  await rejects(
    readDemandResultReviewSnapshot({}),
    (error: unknown) =>
      error instanceof DemandResultReviewSnapshotError &&
      error.reason === "input",
  );
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-result-review-input-"),
  );
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    await rejects(
      readDemandResultReviewSnapshot(root, { extra: true } as never),
      (error: unknown) =>
        error instanceof DemandResultReviewSnapshotError &&
        error.reason === "input",
    );
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
