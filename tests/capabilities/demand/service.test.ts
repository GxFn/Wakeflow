import { equal, rejects } from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  executeDemandCancellationRequest,
  executeDemandCompletionRequest,
  executeDemandContinuationRequest,
} from "../../../src/capabilities/demand/lifecycle.js";
import { executeDemandRouteInspectionRequest } from "../../../src/capabilities/demand/service.js";
import { executeTargetTaskPlanningPublicRequest } from "../../../src/capabilities/tasking/plan-target-task.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { TargetHostEffectClaimService } from "../../../src/governance/delivery/target-host-effect-claim-service.js";
import { windowWorkClaimRef } from "../../../src/governance/delivery/window-work-claim-resource-catalog.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { deriveDurableId } from "../../../src/kernel/ids.js";
import { demandLifecycleJournalRef } from "../../../src/kernel/layout.js";
import { readRequirementClaimState } from "../../../src/kernel/requirement-board.js";
import {
  CLAIMED_AT,
  claimUuidFactory,
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
} from "../../governance/delivery/target-host-effect-claim-service.fixture.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "../../governance/lifecycle/demand-completion-service.fixture.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  PLANNING_REPOSITORY_ID,
  PLANNING_REQUIREMENT_ID,
  PLANNING_WINDOW_ID,
} from "../../governance/tasking/target-task-planning-service.fixture.js";

/**
 * demand 切片效果：升级后路由 awaiting-decision 且完成被阻塞；记录决定后完成即归档
 * （终态事件、归档包、需求包 archived、活动根删除、日志清理、recover）；continue 从归档
 * 重开并要求先规划；取消释放声明并撤回需求包；取消后不能再 continue。
 */

const ESCALATED_AT = parseUtcInstant("2026-08-29T12:30:00.000Z");

async function demandRootExists(workspacePath: string, demandId: string): Promise<boolean> {
  return existsSync(path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")));
}

async function escalate(
  workspaceRoot: RootedDirectory,
  workspacePath: string,
  demandId: string,
  targetTaskId: string,
) {
  const demandRoot = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    const repository = new DemandEventSourcingRepository(demandRoot);
    const loaded = await repository.load();
    if (loaded === null) throw new Error("Expected a loaded aggregate.");
    const eventId = deriveDurableId("demand-event", "test-escalation", demandId);
    await executeDemandEventSourcingCommand(
      repository,
      {
        commandType: "lifecycle.escalate-demand",
        commandVersion: 1,
        demandId,
        eventId,
        recordedAt: ESCALATED_AT,
        escalation: {
          issue: "The accepted result leaves an open question about the rollout window.",
          requirementRefs: [],
          evidence: [],
          options: [
            { option: "Ship now", impact: "Rollout during business hours." },
            { option: "Wait for the window", impact: "One extra day." },
          ],
          recommendation: "Wait for the window.",
          source: {
            kind: "review-decision",
            targetTaskId,
            targetReviewDecisionId: `target-review-decision_${"1".repeat(8)}-1111-4111-8111-${"1".repeat(12)}`,
            decisionDigest: `sha256:${"1".repeat(64)}`,
          },
        },
      },
      {
        commitId: deriveDurableId("demand-event-commit", "test-escalation", demandId),
        expectedStreamRevision: loaded.aggregate.streamRevision,
      },
    );
    return eventId;
  } finally {
    await demandRoot.close();
    void workspaceRoot;
  }
}

test("升级阻塞完成；记录决定后完成即归档、recover 幂等、continue 重开、取消撤回需求包", async () => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    const root = fixture.workspacePath;
    const demandId = fixture.intent.demandId;
    const ledgerArchives = path.join(fixture.fixtureRoot, "wakeflow-ledger", "archives", demandId);

    await escalate(fixture.workspaceRoot, root, demandId, fixture.intent.target.targetTaskId);
    const awaiting = await executeDemandRouteInspectionRequest({ root, demandId });
    if (awaiting.status !== "current") throw new Error("Expected an active route.");
    equal(awaiting.route.disposition, "awaiting-decision");
    equal(awaiting.next.owner, "user");
    equal(awaiting.next.suggestedTool, "wakeflow_continue_demand");

    const blockedCompletion = await executeDemandCompletionRequest({
      root,
      mode: "preview",
      demandId,
    });
    if (blockedCompletion.kind !== "WakeflowDemandCompletionPreview")
      throw new Error("Expected a preview.");
    equal(blockedCompletion.status, "blocked");
    equal(blockedCompletion.blockers.includes("awaiting-decision"), true);

    const decisionPreview = await executeDemandContinuationRequest({
      root,
      mode: "preview",
      demandId,
      action: "record-decision",
      decision: { text: "Wait for the window.", chosenOption: "Wait for the window" },
    });
    if (
      decisionPreview.kind !== "WakeflowDemandContinuationPreview" ||
      decisionPreview.planDigest === null
    )
      throw new Error("Expected a ready decision plan.");
    const decided = await executeDemandContinuationRequest({
      root,
      mode: "apply",
      demandId,
      action: "record-decision",
      decision: { text: "Wait for the window.", chosenOption: "Wait for the window" },
      planDigest: decisionPreview.planDigest,
    });
    if (decided.kind !== "WakeflowDemandContinuationMutation")
      throw new Error("Expected a mutation.");
    equal(decided.disposition, "decision-recorded");
    equal(decided.next.frontier, "demand-completion-preflight");

    const beforeApply = readdirSync(root, { recursive: true }).length;
    const preview = await executeDemandCompletionRequest({ root, mode: "preview", demandId });
    if (preview.kind !== "WakeflowDemandCompletionPreview") throw new Error("Expected a preview.");
    if (preview.planDigest === null) throw new Error(preview.blockers.join(","));
    equal(
      preview.verify?.gates.every((gate) => gate.status === "pass"),
      true,
    );
    equal(readdirSync(root, { recursive: true }).length, beforeApply, "preview wrote");
    equal(existsSync(ledgerArchives), false);

    await rejects(
      executeDemandCompletionRequest({
        root,
        mode: "apply",
        demandId,
        planDigest: `sha256:${"f".repeat(64)}`,
      }),
      (error: unknown) => error instanceof WakeflowError && error.reason === "plan-drift",
    );
    const completed = await executeDemandCompletionRequest({
      root,
      mode: "apply",
      demandId,
      planDigest: preview.planDigest,
    });
    if (completed.kind !== "WakeflowDemandCompletionMutation")
      throw new Error("Expected a mutation.");
    equal(completed.disposition, "completed");
    equal(completed.package.status, "archived");
    equal(completed.releasedClaims, 0);
    equal(completed.next.frontier, "demand-continuation");
    equal(await demandRootExists(root, demandId), false, "active root survived");
    equal(
      existsSync(path.join(root, ...demandLifecycleJournalRef(demandId).split("/"))),
      false,
      "journal survived",
    );
    equal(readdirSync(ledgerArchives).length, 1);
    const archiveDirectory = path.join(
      fixture.fixtureRoot,
      "wakeflow-ledger",
      ...completed.archive.archiveRef.split("/"),
    );
    equal(existsSync(path.join(archiveDirectory, "manifest.json")), true);
    equal(existsSync(path.join(archiveDirectory, "verify-report.json")), true);
    equal(existsSync(path.join(archiveDirectory, "payload", "identity.json")), true);
    equal(existsSync(path.join(archiveDirectory, "payload", "event-sourcing", "snapshots")), false);
    const claim = await readRequirementClaimState(fixture.workspaceRoot, PLANNING_REQUIREMENT_ID);
    equal(claim?.state.status, "archived");
    equal(claim?.state.archive?.demandId, demandId);

    const archivedRoute = await executeDemandRouteInspectionRequest({ root, demandId });
    if (archivedRoute.status !== "archived") throw new Error("Expected an archived route.");
    equal(archivedRoute.archive.outcome, "completed");

    const recovered = await executeDemandCompletionRequest({
      root,
      mode: "recover",
      operationId: demandId,
    });
    if (recovered.kind !== "WakeflowDemandCompletionMutation")
      throw new Error("Expected a mutation.");
    equal(recovered.disposition, "recovered");
    equal(recovered.terminalEvent.eventId, completed.terminalEvent.eventId);

    const continuePreview = await executeDemandContinuationRequest({
      root,
      mode: "preview",
      demandId,
      action: "continue",
      continuation: { kind: "optimization", summary: "Tighten the focused checks." },
    });
    if (continuePreview.kind !== "WakeflowDemandContinuationPreview")
      throw new Error("Expected a preview.");
    if (continuePreview.planDigest === null) throw new Error(continuePreview.blockers.join(","));
    const continued = await executeDemandContinuationRequest({
      root,
      mode: "apply",
      demandId,
      action: "continue",
      continuation: { kind: "optimization", summary: "Tighten the focused checks." },
      planDigest: continuePreview.planDigest,
    });
    if (continued.kind !== "WakeflowDemandContinuationMutation")
      throw new Error("Expected a mutation.");
    equal(continued.disposition, "continued");
    equal(continued.package?.status, "claimed");
    equal(continued.next.frontier, "implementation-task-planning");
    equal(await demandRootExists(root, demandId), true);
    const reopened = await executeDemandRouteInspectionRequest({ root, demandId });
    if (reopened.status !== "current") throw new Error("Expected an active route.");
    equal(reopened.route.lifecycle, "active");
    equal(reopened.route.disposition, "work-available");

    const planned = await executeTargetTaskPlanningPublicRequest({
      root,
      demandId,
      idempotencyKey: "continue-plan-1",
      expectedStreamRevision: reopened.route.observedEventStream.streamRevision,
      taskPackage: {
        assignment: { repositoryId: PLANNING_REPOSITORY_ID, windowId: PLANNING_WINDOW_ID },
        workType: "implementation",
        objective: "续接后的优化任务",
        confirmedContext: ["Demand 已从归档重开"],
        selectedAuthorityMemberRefs: [
          `requirements/${PLANNING_REQUIREMENT_ID}/requirement.md`,
          `requirements/${PLANNING_REQUIREMENT_ID}/landing.md`,
        ],
        boundaries: { inScope: ["优化"], outOfScope: ["投递"], forbidden: ["宿主发送"] },
        completionExpectations: ["聚焦检查通过"],
        commitExpectation: "leave-uncommitted",
        acceptanceAnchors: [
          { anchorId: "opt", claim: "优化生效", probe: "运行检查", expected: "通过" },
        ],
      },
    });
    equal(planned.status, "committed");
    equal(planned.next.frontier, "implementation-delivery-planning");

    const cancelPreview = await executeDemandCancellationRequest({
      root,
      mode: "preview",
      demandId,
      reason: "The optimization is no longer wanted.",
    });
    if (cancelPreview.kind !== "WakeflowDemandCancellationPreview")
      throw new Error("Expected a preview.");
    if (cancelPreview.planDigest === null) throw new Error(cancelPreview.blockers.join(","));
    const cancelled = await executeDemandCancellationRequest({
      root,
      mode: "apply",
      demandId,
      reason: "The optimization is no longer wanted.",
      planDigest: cancelPreview.planDigest,
    });
    if (cancelled.kind !== "WakeflowDemandCancellationMutation")
      throw new Error("Expected a mutation.");
    equal(cancelled.disposition, "cancelled");
    equal(cancelled.package.status, "withdrawn");
    equal(cancelled.next.frontier, null);
    equal(await demandRootExists(root, demandId), false);
    equal(readdirSync(ledgerArchives).length, 2);

    const afterCancel = await executeDemandContinuationRequest({
      root,
      mode: "preview",
      demandId,
      action: "continue",
      continuation: { kind: "verified-bug", summary: "x" },
    });
    if (afterCancel.kind !== "WakeflowDemandContinuationPreview")
      throw new Error("Expected a preview.");
    equal(afterCancel.status, "blocked");
    equal(afterCancel.blockers.includes("archive-outcome:cancelled"), true);
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});

test("未接受的目标让完成在 preview 阻塞；取消释放本 Demand 的窗口工作声明", async () => {
  const planning = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const blocked = await executeDemandCompletionRequest({
      root: planning.workspacePath,
      mode: "preview",
      demandId: planning.request.demandId,
    });
    if (blocked.kind !== "WakeflowDemandCompletionPreview") throw new Error("Expected a preview.");
    equal(blocked.status, "blocked");
    equal(blocked.blockers.includes("route:not-ready"), true);
    equal(blocked.planDigest, null);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(planning);
  }

  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  try {
    const root = fixture.workspacePath;
    const demandId = fixture.intent.demandId;
    const claimed = await new TargetHostEffectClaimService(
      fixture.workspaceRoot,
      codexWorkspaceHostResourceProfile,
      codexWindowHostIdentityProfile,
    ).claim(fixture.claimRequest, { clock: () => CLAIMED_AT, uuidFactory: claimUuidFactory() });
    if (claimed.action === null) throw new Error("Expected an issued claim.");
    const claimPath = path.join(
      root,
      ...windowWorkClaimRef(fixture.intent.route.windowId).split("/"),
    );
    equal(existsSync(claimPath), true);

    const reason = "Cancelled while the window still holds the claim.";
    const preview = await executeDemandCancellationRequest({
      root,
      mode: "preview",
      demandId,
      reason,
    });
    if (preview.kind !== "WakeflowDemandCancellationPreview")
      throw new Error("Expected a preview.");
    if (preview.planDigest === null) throw new Error(preview.blockers.join(","));
    equal(
      preview.verify?.gates.find((gate) => gate.gate === "work-claims-released")?.status,
      "fail",
    );
    const cancelled = await executeDemandCancellationRequest({
      root,
      mode: "apply",
      demandId,
      reason,
      planDigest: preview.planDigest,
    });
    if (cancelled.kind !== "WakeflowDemandCancellationMutation")
      throw new Error("Expected a mutation.");
    equal(cancelled.disposition, "cancelled");
    equal(cancelled.releasedClaims, 1);
    equal(existsSync(claimPath), false, "claim survived cancellation");
    equal(cancelled.package.status, "withdrawn");
    equal(await demandRootExists(root, demandId), false);
  } finally {
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});
