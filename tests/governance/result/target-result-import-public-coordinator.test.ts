import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { executeDemandControllerRoutePublicRequest } from "../../../src/governance/controller/demand-controller-route-public-coordinator.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { executeTargetHostEffectClaimPublicRequest } from "../../../src/governance/delivery/target-host-effect-claim-public-coordinator.js";
import { executeTargetHostEffectOutcomePublicRequest } from "../../../src/governance/delivery/target-host-effect-outcome-public-coordinator.js";
import { WINDOW_WORK_CLAIMS_ROOT_REF } from "../../../src/governance/delivery/window-work-claim-resource-catalog.js";
import { WINDOW_WORK_CLAIM_DIRECTORY_MODE } from "../../../src/governance/delivery/window-work-claim-store.js";
import {
  parseTargetResultImportPublicRequest,
  TargetResultImportPublicContractError,
} from "../../../src/governance/result/target-result-import-public-contract.js";
import {
  executeTargetResultImportPublicRequest,
  TargetResultImportPublicCoordinatorError,
} from "../../../src/governance/result/target-result-import-public-coordinator.js";
import type { TaskPackage } from "../../../src/governance/tasking/task-package.js";
import {
  CLAIMED_AT,
  claimUuidFactory,
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
} from "../delivery/target-host-effect-claim-service.fixture.js";
import {
  cleanupTestHostEffectClaimWorkspaceFixture,
  createTestHostEffectClaimWorkspaceFixture,
  TEST_CLAIMED_AT,
  testClaimUuidFactory,
} from "../testing/test-host-effect-claim-service.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "./implementation-target-result-report.fixture.js";

const CODEX_CLAIM_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});
const CODEX_OUTCOME_FACADE = Object.freeze({ hostId: "codex" as const });
const CODEX_RESULT_FACADE = Object.freeze({ hostId: "codex" as const });
const CLAUDE_CODE_RESULT_FACADE = Object.freeze({
  hostId: "claude-code" as const,
});
const IMPLEMENTATION_OUTCOME_AT = parseUtcInstant("2026-08-29T12:06:00.000Z");
const IMPLEMENTATION_REPORTED_AT = parseUtcInstant("2026-08-29T12:03:00.000Z");
const TEST_OUTCOME_AT = parseUtcInstant("2026-08-29T12:33:00.000Z");
const TEST_REPORTED_AT = parseUtcInstant("2026-08-29T12:30:00.000Z");

async function taskPackageForDelivery(
  workspacePath: string,
  demandId: string,
  targetDeliveryId: string,
): Promise<Readonly<TaskPackage>> {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    const repository = new DemandEventSourcingRepository(root);
    const implementation =
      await repository.findTargetDeliveryPreparedEvent(targetDeliveryId);
    const testing =
      implementation === null
        ? await repository.findTestDeliveryPreparedEvent(targetDeliveryId)
        : null;
    const taskPackageId =
      implementation?.event.data.intent.target.taskPackageId ??
      testing?.event.data.intent.target.taskPackageId;
    if (taskPackageId === undefined) {
      throw new Error("Expected Delivery Preparation Event.");
    }
    const task = await repository.findTargetTaskPlannedEvent(taskPackageId);
    if (task === null) throw new Error("Expected TaskPackage Event.");
    return task.event.data.taskPackage;
  } finally {
    await root.close();
  }
}

function stringPathsContaining(
  value: unknown,
  needle: string,
  pathValue = "$",
  result: string[] = [],
): readonly string[] {
  if (typeof value === "string") {
    if (value.includes(needle)) result.push(pathValue);
    return result;
  }
  if (value === null || typeof value !== "object") return result;
  for (const [key, entry] of Object.entries(value)) {
    stringPathsContaining(
      entry,
      needle,
      `${pathValue}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      result,
    );
  }
  return result;
}

test("Result Import Public Coordinator生成Implementation TargetResult并释放Claim", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  const claimRootPath = path.join(
    fixture.workspacePath,
    ...WINDOW_WORK_CLAIMS_ROOT_REF.split("/"),
  );
  let claimRootRestricted = false;
  try {
    const claimed = await executeTargetHostEffectClaimPublicRequest(
      CODEX_CLAIM_FACADE,
      { root: fixture.workspacePath, ...fixture.claimRequest },
      {
        claim: {
          clock: () => CLAIMED_AT,
          uuidFactory: claimUuidFactory(),
        },
      },
    );
    const outcome = await executeTargetHostEffectOutcomePublicRequest(
      CODEX_OUTCOME_FACADE,
      {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
        actionId: claimed.claim.claimId,
        claimDigest: claimed.claim.claimDigest,
        attempt: {
          status: "accepted",
          evidence: { transport: "accepted" },
        },
        readback: {
          status: "pending",
          evidence: { visible: false },
        },
        observedAt: IMPLEMENTATION_OUTCOME_AT,
      },
    );
    const taskPackage = await taskPackageForDelivery(
      fixture.workspacePath,
      fixture.intent.demandId,
      fixture.intent.targetDeliveryId,
    );
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      actionId: claimed.claim.claimId,
      observationDigest: outcome.observation.observationDigest,
      report: {
        workType: "implementation" as const,
        content:
          createImplementationTargetResultReportContentFixture(taskPackage),
      },
    };
    const parsed = parseTargetResultImportPublicRequest(request);
    equal(Object.isFrozen(parsed), true);
    equal(Object.isFrozen(parsed.report.content), true);
    throws(
      () => parseTargetResultImportPublicRequest(new Proxy(request, {})),
      (error: unknown) =>
        error instanceof TargetResultImportPublicContractError &&
        error.reason === "json",
    );
    throws(
      () =>
        parseTargetResultImportPublicRequest({
          ...request,
          report: {
            ...request.report,
            content: {
              ...request.report.content,
              summary: fixture.workspacePath,
            },
          },
        }),
      (error: unknown) =>
        error instanceof TargetResultImportPublicContractError &&
        error.reason === "privacy",
    );

    await rejects(
      executeTargetResultImportPublicRequest(
        { ...CODEX_RESULT_FACADE },
        request,
      ),
      (error: unknown) =>
        error instanceof TargetResultImportPublicCoordinatorError &&
        error.reason === "host" &&
        error.eventAuthority === "unchanged",
    );
    await rejects(
      executeTargetResultImportPublicRequest(
        CLAUDE_CODE_RESULT_FACADE,
        request,
      ),
      (error: unknown) =>
        error instanceof TargetResultImportPublicCoordinatorError &&
        error.reason === "host" &&
        error.causeReason === "host" &&
        error.eventAuthority === "unchanged",
    );

    const imported = await executeTargetResultImportPublicRequest(
      CODEX_RESULT_FACADE,
      request,
      { resultImport: { clock: () => IMPLEMENTATION_REPORTED_AT } },
    );
    equal(imported.status, "recorded");
    equal(imported.result.workType, "implementation");
    equal(imported.result.report.outcome, "completed");
    equal(
      imported.result.report.reportedAt < imported.result.hostEffect.observedAt,
      true,
    );
    equal(imported.claimAuthority, "released");
    equal(imported.eventAuthority, "current");
    equal(Object.hasOwn(imported, "controllerAccepted"), false);
    deepEqual(stringPathsContaining(imported, fixture.workspacePath), []);
    deepEqual(stringPathsContaining(imported, fixture.rawHandle), []);

    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
    });
    equal(route.route.frontiers[0]?.kind, "implementation-result-review");

    await rejects(
      executeTargetResultImportPublicRequest(
        CLAUDE_CODE_RESULT_FACADE,
        request,
      ),
      (error: unknown) =>
        error instanceof TargetResultImportPublicCoordinatorError &&
        error.reason === "host" &&
        error.eventAuthority === "current",
    );

    await chmod(claimRootPath, 0o500);
    claimRootRestricted = true;
    await rejects(
      executeTargetResultImportPublicRequest(CODEX_RESULT_FACADE, request),
      (error: unknown) =>
        error instanceof TargetResultImportPublicCoordinatorError &&
        error.reason === "result-import" &&
        error.causeReason === "claim" &&
        error.eventAuthority === "current" &&
        error.claimAuthority === "unknown",
    );
    await chmod(claimRootPath, WINDOW_WORK_CLAIM_DIRECTORY_MODE);
    claimRootRestricted = false;

    const replayed = await executeTargetResultImportPublicRequest(
      CODEX_RESULT_FACADE,
      request,
    );
    equal(replayed.status, "already-recorded");
    equal(replayed.result.resultDigest, imported.result.resultDigest);
    equal(replayed.event.eventId, imported.event.eventId);
  } finally {
    if (claimRootRestricted) {
      await chmod(claimRootPath, WINDOW_WORK_CLAIM_DIRECTORY_MODE);
    }
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Result Import Public Coordinator从Test Report生成共享TargetResult", async () => {
  const fixture = await createTestHostEffectClaimWorkspaceFixture();
  try {
    const claimed = await executeTargetHostEffectClaimPublicRequest(
      CODEX_CLAIM_FACADE,
      { root: fixture.workspacePath, ...fixture.testClaimRequest },
      {
        claim: {
          clock: () => TEST_CLAIMED_AT,
          uuidFactory: testClaimUuidFactory(),
        },
      },
    );
    const outcome = await executeTargetHostEffectOutcomePublicRequest(
      CODEX_OUTCOME_FACADE,
      {
        root: fixture.workspacePath,
        demandId: fixture.testClaimRequest.demandId,
        actionId: claimed.claim.claimId,
        claimDigest: claimed.claim.claimDigest,
        attempt: {
          status: "accepted",
          evidence: { transport: "accepted" },
        },
        readback: {
          status: "pending",
          evidence: { visible: false },
        },
        observedAt: TEST_OUTCOME_AT,
      },
    );
    const evidenceLocators = fixture.testCard.approvedPlan.map((_step, index) =>
      Object.freeze({
        kind: "test-step-report" as const,
        ref: `evidence/test-runs/step-${index}.json`,
        digest: `sha256:${String(index + 1).repeat(64)}`,
      }),
    );
    const request = {
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
      actionId: claimed.claim.claimId,
      observationDigest: outcome.observation.observationDigest,
      report: {
        workType: "test" as const,
        content: {
          outcome: "completed" as const,
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
    };
    const imported = await executeTargetResultImportPublicRequest(
      CODEX_RESULT_FACADE,
      request,
      { resultImport: { clock: () => TEST_REPORTED_AT } },
    );
    equal(imported.result.workType, "test");
    if (imported.result.workType !== "test") {
      throw new Error("Expected public Test TargetResult.");
    }
    equal(imported.result.testExecution?.testAttemptId, fixture.testAttemptId);
    equal(
      imported.result.testExecution?.testDispatchPacketDigest,
      fixture.testDispatchPacketDigest,
    );
    equal(imported.result.report.kind, "WakeflowTestTargetResultReport");
    equal(
      imported.result.report.reportedAt < imported.result.hostEffect.observedAt,
      true,
    );
    equal(imported.claimAuthority, "released");

    const route = await executeDemandControllerRoutePublicRequest({
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
    });
    equal(route.route.frontiers[0]?.kind, "test-result-review");

    const replayed = await executeTargetResultImportPublicRequest(
      CODEX_RESULT_FACADE,
      request,
    );
    equal(replayed.status, "already-recorded");
    equal(replayed.result.resultDigest, imported.result.resultDigest);
  } finally {
    await cleanupTestHostEffectClaimWorkspaceFixture(fixture);
  }
});
