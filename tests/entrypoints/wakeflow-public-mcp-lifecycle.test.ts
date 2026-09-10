import { equal } from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../src/foundation/time/utc-instant.js";
import {
  WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_ROUTE_INSPECTION_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/demand/contract.js";
import {
  WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
  WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/delivery/contract.js";
import { workClaimRef } from "../../src/kernel/layout.js";
import { DemandEventSourcingRepository } from "../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../src/governance/demand/publication/demand-publication-paths.js";
import { WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME } from "../../src/governance/result/target-result-import-public-contract.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-implementation-review-decision-public-contract.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME } from "../../src/governance/review/target-result-review-inspection-public-contract.js";
import type { TaskPackage } from "../../src/governance/tasking/task-package.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  DELIVERY_AUTHORED,
  landFixturePrompt,
} from "../governance/delivery/delivery-workspace.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "../governance/result/implementation-target-result-report.fixture.js";
import { controllerImplementationReviewDecisionInput } from "../governance/review/controller-implementation-review-decision.fixture.js";
import {
  connectWakeflowMcpServerForTest,
  wakeflowMcpTextContent as textContent,
} from "./wakeflow-public-mcp-server.fixture.js";

/**
 * 公共MCP只保留一条跨域真实生命周期链。
 *
 * 各owner的输入、状态转换、恢复和负例由相邻领域测试拥有；本文件仅证明官方Client
 * 能沿Route连接Execution与Review注册组，且一次性Action、隐私和幂等关系没有在组合层漂移。
 */

async function taskPackageForDelivery(
  workspacePath: string,
  demandId: string,
  deliveryId: string,
): Promise<Readonly<TaskPackage>> {
  const demandRoot = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    const repository = new DemandEventSourcingRepository(demandRoot);
    const prepared = await repository.findDeliveryPreparedEvent(deliveryId);
    if (prepared === null) throw new Error("Expected Delivery Prepared Event.");
    const planned = await repository.findTargetTaskPlannedEvent(
      prepared.event.data.envelope.target.taskPackageId,
    );
    if (planned === null) throw new Error("Expected Target Task Planned Event.");
    return planned.event.data.taskPackage;
  } finally {
    await demandRoot.close();
  }
}

test("Codex MCP完成真实投递准备、结局记录、TargetResult、Controller Review与Completion且不执行宿主发送", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  const server = createCodexWakeflowMcpServer("1.0.0-test");
  const { client, close } = await connectWakeflowMcpServerForTest(server);
  try {
    const before = await client.callTool({
      name: WAKEFLOW_DEMAND_ROUTE_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: { root: fixture.workspacePath, demandId: fixture.demandId },
    });
    equal(before.isError, undefined);
    equal(
      (before.structuredContent as { route: { frontiers: { kind: string }[] } }).route.frontiers[0]
        ?.kind,
      "implementation-delivery-planning",
    );

    const prepareRequest = {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey: "mcp-prepare-1",
      expectedStreamRevision: 2,
      targetTaskId: fixture.targetTaskId,
      authored: DELIVERY_AUTHORED,
      language: "en",
    } as const;
    const preparedCall = await client.callTool({
      name: WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
      arguments: prepareRequest,
    });
    equal(preparedCall.isError, undefined, textContent(preparedCall));
    const prepared = preparedCall.structuredContent as {
      readonly status: string;
      readonly delivery: {
        readonly deliveryId: string;
        readonly windowId: string;
        readonly phase: string;
      };
      readonly permit: {
        readonly prompt: string;
        readonly hostAction: { readonly effect: string; readonly handleDigest: string };
        readonly fence: {
          readonly claimId: string;
          readonly claimDigest: string;
          readonly streamRevision: number;
        };
        readonly issuedAt: string;
      };
      readonly event: { readonly eventId: string; readonly streamRevision: number };
    };
    equal(prepared.status, "committed");
    equal(prepared.delivery.phase, "delivery-prepared");
    equal(prepared.permit.hostAction.effect, "send-prompt-to-window");
    equal(prepared.permit.prompt.includes(fixture.workspacePath), false);
    equal(prepared.permit.prompt.includes(prepared.delivery.deliveryId), true);
    equal(textContent(preparedCall).includes(fixture.route.rawHandle), false);
    const claimPath = path.join(
      fixture.workspacePath,
      ...workClaimRef(prepared.delivery.windowId).split("/"),
    );
    equal(existsSync(claimPath), true);

    const after = await client.callTool({
      name: WAKEFLOW_DEMAND_ROUTE_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: { root: fixture.workspacePath, demandId: fixture.demandId },
    });
    equal(after.isError, undefined);
    equal(
      (after.structuredContent as { route: { frontiers: { kind: string }[] } }).route.frontiers[0]
        ?.kind,
      "implementation-host-effect-execution",
    );

    const replayedCall = await client.callTool({
      name: WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
      arguments: prepareRequest,
    });
    equal(replayedCall.isError, undefined, textContent(replayedCall));
    const replayed = replayedCall.structuredContent as {
      readonly status: string;
      readonly delivery: { readonly deliveryId: string };
      readonly permit: { readonly fence: { readonly claimDigest: string } };
    };
    equal(replayed.status, "idempotent");
    equal(replayed.delivery.deliveryId, prepared.delivery.deliveryId);
    equal(replayed.permit.fence.claimDigest, prepared.permit.fence.claimDigest);
    equal(textContent(replayedCall).includes(fixture.workspacePath), false);
    equal(textContent(replayedCall).includes(fixture.route.rawHandle), false);

    await landFixturePrompt(
      fixture,
      fixture.route,
      prepared.permit.prompt,
      parseUtcInstant(new Date().toISOString()),
    );
    const outcomeRequest = {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey: "mcp-outcome-1",
      expectedStreamRevision: prepared.event.streamRevision,
      deliveryId: prepared.delivery.deliveryId,
      claimDigest: prepared.permit.fence.claimDigest,
      attempt: { status: "sent" as const },
      readback: { status: "pending" as const },
      observedAt: new Date(
        Math.max(Date.now(), Date.parse(prepared.permit.issuedAt) + 1),
      ).toISOString(),
    };
    const outcomeCall = await client.callTool({
      name: WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
      arguments: outcomeRequest,
    });
    equal(outcomeCall.isError, undefined, textContent(outcomeCall));
    const outcome = outcomeCall.structuredContent as {
      readonly status: string;
      readonly outcome: {
        readonly disposition: string;
        readonly evidenceKind: string;
        readonly claimHandling: string;
        readonly outcomeDigest: string;
      };
      readonly target: { readonly phase: string };
      readonly event: { readonly eventId: string };
    };
    equal(outcome.status, "recorded");
    equal(outcome.outcome.disposition, "accepted");
    equal(outcome.outcome.evidenceKind, "hook-record");
    equal(outcome.outcome.claimHandling, "retain");
    equal(outcome.target.phase, "host-effect-accepted");
    equal(textContent(outcomeCall).includes(fixture.workspacePath), false);
    equal(textContent(outcomeCall).includes(fixture.route.rawHandle), false);

    const afterOutcome = await client.callTool({
      name: WAKEFLOW_DEMAND_ROUTE_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: { root: fixture.workspacePath, demandId: fixture.demandId },
    });
    equal(afterOutcome.isError, undefined);
    equal(
      (afterOutcome.structuredContent as { route: { frontiers: { kind: string }[] } }).route
        .frontiers[0]?.kind,
      "implementation-target-result-import",
    );

    const replayedOutcomeCall = await client.callTool({
      name: WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
      arguments: outcomeRequest,
    });
    equal(replayedOutcomeCall.isError, undefined, textContent(replayedOutcomeCall));
    const replayedOutcome = replayedOutcomeCall.structuredContent as {
      readonly status: string;
      readonly outcome: { readonly outcomeDigest: string };
      readonly event: { readonly eventId: string };
    };
    equal(replayedOutcome.status, "idempotent");
    equal(replayedOutcome.outcome.outcomeDigest, outcome.outcome.outcomeDigest);
    equal(replayedOutcome.event.eventId, outcome.event.eventId);

    const taskPackage = await taskPackageForDelivery(
      fixture.workspacePath,
      fixture.demandId,
      prepared.delivery.deliveryId,
    );
    const resultRequest = {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      deliveryId: prepared.delivery.deliveryId,
      claimDigest: prepared.permit.fence.claimDigest,
      report: {
        workType: "implementation" as const,
        content: createImplementationTargetResultReportContentFixture(taskPackage),
      },
    };
    const importedCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
      arguments: resultRequest,
    });
    equal(importedCall.isError, undefined, textContent(importedCall));
    const imported = importedCall.structuredContent as {
      readonly status: string;
      readonly disposition: string;
      readonly claimAuthority: string;
      readonly eventAuthority: string;
      readonly result: {
        readonly workType: string;
        readonly demandId: string;
        readonly deliveryId: string;
        readonly delivery: {
          readonly fence: { readonly claimId: string };
          readonly outcomeDigest: string;
        };
        readonly report: { readonly outcome: string };
        readonly resultDigest: string;
      };
      readonly event: { readonly eventId: string };
    };
    equal(imported.status, "recorded");
    equal(imported.disposition, "committed");
    equal(imported.claimAuthority, "released");
    equal(imported.eventAuthority, "current");
    equal(imported.result.workType, "implementation");
    equal(imported.result.demandId, fixture.demandId);
    equal(imported.result.deliveryId, prepared.delivery.deliveryId);
    equal(imported.result.delivery.fence.claimId, prepared.permit.fence.claimId);
    equal(imported.result.delivery.outcomeDigest, outcome.outcome.outcomeDigest);
    equal(imported.result.report.outcome, "completed");
    equal(existsSync(claimPath), false);
    equal(textContent(importedCall).includes(fixture.workspacePath), false);
    equal(textContent(importedCall).includes(fixture.route.rawHandle), false);

    const afterResult = await client.callTool({
      name: WAKEFLOW_DEMAND_ROUTE_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: { root: fixture.workspacePath, demandId: fixture.demandId },
    });
    equal(afterResult.isError, undefined);
    equal(
      (
        afterResult.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-result-review",
    );

    const replayedResultCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
      arguments: resultRequest,
    });
    equal(replayedResultCall.isError, undefined, textContent(replayedResultCall));
    const replayedResult = replayedResultCall.structuredContent as {
      readonly status: string;
      readonly result: { readonly resultDigest: string };
      readonly event: { readonly eventId: string };
    };
    equal(replayedResult.status, "already-recorded");
    equal(replayedResult.result.resultDigest, imported.result.resultDigest);
    equal(replayedResult.event.eventId, imported.event.eventId);
    equal(existsSync(claimPath), false);

    const inspectionRequest = {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      targetTaskId: fixture.targetTaskId,
    };
    const inspectionCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: inspectionRequest,
    });
    equal(inspectionCall.isError, undefined, textContent(inspectionCall));
    const inspection = inspectionCall.structuredContent as {
      readonly snapshotDigest: string;
      readonly reviewUnit: {
        readonly workType: string;
        readonly reviewUnitDigest: string;
        readonly targetResult: {
          readonly targetResultId: string;
          readonly resultDigest: string;
        };
      };
    };
    equal(inspection.reviewUnit.workType, "implementation");
    equal(inspection.reviewUnit.targetResult.resultDigest, imported.result.resultDigest);
    equal(Object.hasOwn(inspection, "decision"), false);
    equal(textContent(inspectionCall).includes(fixture.workspacePath), false);

    const judgment = controllerImplementationReviewDecisionInput("accept");
    const decisionRequest = {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      targetResultId: inspection.reviewUnit.targetResult.targetResultId,
      snapshotDigest: inspection.snapshotDigest,
      reviewUnitDigest: inspection.reviewUnit.reviewUnitDigest,
      decision: judgment.decision,
      assessment: judgment.assessment,
      independentChecks: judgment.independentChecks,
      rationale: judgment.rationale,
      blockingReasons: judgment.blockingReasons,
      residualRisks: judgment.residualRisks,
    };
    const decisionCall = await client.callTool({
      name: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      arguments: decisionRequest,
    });
    equal(decisionCall.isError, undefined, textContent(decisionCall));
    const decision = decisionCall.structuredContent as {
      readonly status: string;
      readonly eventAuthority: string;
      readonly decision: {
        readonly decision: string;
        readonly targetReviewDecisionId: string;
        readonly decisionDigest: string;
      };
      readonly event: { readonly eventId: string };
    };
    equal(decision.status, "decided");
    equal(decision.eventAuthority, "current");
    equal(decision.decision.decision, "accept");
    equal(textContent(decisionCall).includes(fixture.workspacePath), false);
    equal(textContent(decisionCall).includes(fixture.route.rawHandle), false);

    const afterDecision = await client.callTool({
      name: WAKEFLOW_DEMAND_ROUTE_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.demandId,
      },
    });
    equal(afterDecision.isError, undefined);
    equal(
      (
        afterDecision.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "demand-completion-preflight",
    );

    const replayedDecisionCall = await client.callTool({
      name: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      arguments: decisionRequest,
    });
    equal(replayedDecisionCall.isError, undefined, textContent(replayedDecisionCall));
    const replayedDecision = replayedDecisionCall.structuredContent as {
      readonly status: string;
      readonly decision: { readonly targetReviewDecisionId: string };
      readonly event: { readonly eventId: string };
    };
    equal(replayedDecision.status, "already-decided");
    equal(
      replayedDecision.decision.targetReviewDecisionId,
      decision.decision.targetReviewDecisionId,
    );
    equal(replayedDecision.event.eventId, decision.event.eventId);

    const completionPreviewCall = await client.callTool({
      name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.demandId,
      },
    });
    equal(completionPreviewCall.isError, undefined, textContent(completionPreviewCall));
    const completionPreview = completionPreviewCall.structuredContent as {
      readonly mode: string;
      readonly status: string;
      readonly blockers: readonly string[];
      readonly planDigest: string | null;
      readonly demandId: string;
      readonly verify: { readonly gates: readonly { readonly status: string }[] } | null;
    };
    equal(completionPreview.mode, "preview");
    equal(completionPreview.status, "ready", completionPreview.blockers.join(","));
    equal(completionPreview.demandId, fixture.demandId);
    equal(
      completionPreview.verify?.gates.every((gate) => gate.status === "pass"),
      true,
    );
    equal(textContent(completionPreviewCall).includes(fixture.workspacePath), false);
    equal(textContent(completionPreviewCall).includes(fixture.route.rawHandle), false);

    const completionCall = await client.callTool({
      name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "apply",
        demandId: fixture.demandId,
        planDigest: completionPreview.planDigest,
      },
    });
    equal(completionCall.isError, undefined, textContent(completionCall));
    const completion = completionCall.structuredContent as {
      readonly disposition: string;
      readonly terminalEvent: { readonly eventId: string; readonly streamRevision: number };
      readonly archive: { readonly archiveRef: string; readonly fileCount: number };
      readonly package: { readonly status: string };
      readonly next: { readonly frontier: string | null; readonly suggestedTool: string | null };
    };
    equal(completion.disposition, "completed");
    equal(completion.package.status, "archived");
    equal(completion.next.frontier, "demand-continuation");
    equal(textContent(completionCall).includes(fixture.workspacePath), false);
    equal(textContent(completionCall).includes(fixture.route.rawHandle), false);
    equal(
      existsSync(
        path.join(fixture.workspacePath, ...demandFinalRootRef(fixture.demandId).split("/")),
      ),
      false,
      "active root survived completion",
    );

    const terminalRouteCall = await client.callTool({
      name: WAKEFLOW_DEMAND_ROUTE_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.demandId,
      },
    });
    equal(terminalRouteCall.isError, undefined, textContent(terminalRouteCall));
    const terminalRoute = terminalRouteCall.structuredContent as {
      readonly status: string;
      readonly archive: { readonly outcome: string; readonly archiveRef: string };
    };
    equal(terminalRoute.status, "archived");
    equal(terminalRoute.archive.outcome, "completed");
    equal(terminalRoute.archive.archiveRef, completion.archive.archiveRef);

    const recoveredCall = await client.callTool({
      name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "recover",
        operationId: fixture.demandId,
      },
    });
    equal(recoveredCall.isError, undefined, textContent(recoveredCall));
    const recovered = recoveredCall.structuredContent as {
      readonly disposition: string;
      readonly terminalEvent: { readonly eventId: string };
      readonly archive: { readonly archiveRef: string };
    };
    equal(recovered.disposition, "recovered");
    equal(recovered.terminalEvent.eventId, completion.terminalEvent.eventId);
    equal(recovered.archive.archiveRef, completion.archive.archiveRef);
  } finally {
    await close();
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});
