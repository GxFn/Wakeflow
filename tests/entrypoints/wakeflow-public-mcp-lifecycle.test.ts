import { equal } from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME } from "../../src/governance/controller/demand-controller-route-public-contract.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME } from "../../src/governance/delivery/target-host-effect-claim-public-contract.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME } from "../../src/governance/delivery/target-host-effect-outcome-public-contract.js";
import { windowWorkClaimRef } from "../../src/governance/delivery/window-work-claim-resource-catalog.js";
import { DemandEventSourcingRepository } from "../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../src/governance/demand/publication/demand-publication-paths.js";
import { WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME } from "../../src/governance/lifecycle/demand-completion-public-contract.js";
import { WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME } from "../../src/governance/result/target-result-import-public-contract.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-implementation-review-decision-public-contract.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME } from "../../src/governance/review/target-result-review-inspection-public-contract.js";
import type { TaskPackage } from "../../src/governance/tasking/task-package.js";
import {
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
} from "../governance/delivery/target-host-effect-claim-service.fixture.js";
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

async function taskPackageForTargetDelivery(
  workspacePath: string,
  demandId: string,
  targetDeliveryId: string,
): Promise<Readonly<TaskPackage>> {
  const demandRoot = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    const repository = new DemandEventSourcingRepository(demandRoot);
    const prepared =
      await repository.findTargetDeliveryPreparedEvent(targetDeliveryId);
    if (prepared === null) {
      throw new Error("Expected Target Delivery Prepared Event.");
    }
    const planned = await repository.findTargetTaskPlannedEvent(
      prepared.event.data.intent.target.taskPackageId,
    );
    if (planned === null) {
      throw new Error("Expected Target Task Planned Event.");
    }
    return planned.event.data.taskPackage;
  } finally {
    await demandRoot.close();
  }
}

test("Codex MCP完成真实Claim、Outcome、TargetResult、Controller Review与Completion且不执行宿主发送", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  const server = createCodexWakeflowMcpServer("1.0.0-test");
  const { client, close } = await connectWakeflowMcpServerForTest(server);
  try {
    const before = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.claimRequest.demandId,
      },
    });
    equal(before.isError, undefined);
    equal(
      (
        before.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-host-effect-claim",
    );

    const request = {
      root: fixture.workspacePath,
      ...fixture.claimRequest,
      observation: {
        ...fixture.claimRequest.observation,
        observedAt: new Date().toISOString(),
      },
    } as const;
    const issuedCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
      arguments: request,
    });
    equal(issuedCall.isError, undefined);
    const issued = issuedCall.structuredContent as {
      readonly status: string;
      readonly claim: {
        readonly claimId: string;
        readonly claimDigest: string;
        readonly route: { readonly windowId: string };
      };
      readonly action: null | {
        readonly effect: string;
        readonly prompt: string;
        readonly issuedAt: string;
      };
    };
    equal(issued.status, "issued");
    equal(issued.action?.effect, "send-message-to-observed-target-window");
    equal(issued.action?.prompt.includes(fixture.workspacePath), true);
    if (issued.action === null) {
      throw new Error("Expected one host action for the issued Claim.");
    }
    equal(textContent(issuedCall).includes(fixture.rawHandle), false);
    const claimPath = path.join(
      fixture.workspacePath,
      ...windowWorkClaimRef(issued.claim.route.windowId).split("/"),
    );
    equal(existsSync(claimPath), true);

    const after = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.claimRequest.demandId,
      },
    });
    equal(after.isError, undefined);
    equal(
      (
        after.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-host-effect-execution",
    );

    const replayedCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
      arguments: request,
    });
    equal(replayedCall.isError, undefined);
    const replayed = replayedCall.structuredContent as {
      readonly status: string;
      readonly action: unknown;
      readonly claim: { readonly claimId: string };
    };
    equal(replayed.status, "already-claimed");
    equal(replayed.action, null);
    equal(replayed.claim.claimId, issued.claim.claimId);
    equal(textContent(replayedCall).includes(fixture.workspacePath), false);
    equal(textContent(replayedCall).includes(fixture.rawHandle), false);

    const outcomeRequest = {
      root: fixture.workspacePath,
      demandId: fixture.claimRequest.demandId,
      actionId: issued.claim.claimId,
      claimDigest: issued.claim.claimDigest,
      attempt: {
        status: "accepted" as const,
        evidence: { sourceTestHostResult: "accepted" },
      },
      readback: {
        status: "pending" as const,
        evidence: { sourceTestVisible: false },
      },
      observedAt: new Date(
        Math.max(Date.now(), Date.parse(issued.action.issuedAt) + 1),
      ).toISOString(),
    };
    const outcomeCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
      arguments: outcomeRequest,
    });
    equal(outcomeCall.isError, undefined);
    const outcome = outcomeCall.structuredContent as {
      readonly status: string;
      readonly effectDisposition: string;
      readonly claimAuthority: string;
      readonly observation: { readonly observationDigest: string };
      readonly event: { readonly eventId: string };
    };
    equal(outcome.status, "recorded");
    equal(outcome.effectDisposition, "accepted");
    equal(outcome.claimAuthority, "current");
    equal(textContent(outcomeCall).includes(fixture.workspacePath), false);
    equal(textContent(outcomeCall).includes(fixture.rawHandle), false);
    equal(textContent(outcomeCall).includes("sourceTestHostResult"), false);

    const afterOutcome = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.claimRequest.demandId,
      },
    });
    equal(afterOutcome.isError, undefined);
    equal(
      (
        afterOutcome.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-target-result-import",
    );

    const replayedOutcomeCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
      arguments: outcomeRequest,
    });
    equal(replayedOutcomeCall.isError, undefined);
    const replayedOutcome = replayedOutcomeCall.structuredContent as {
      readonly status: string;
      readonly observation: { readonly observationDigest: string };
      readonly event: { readonly eventId: string };
    };
    equal(replayedOutcome.status, "already-recorded");
    equal(
      replayedOutcome.observation.observationDigest,
      outcome.observation.observationDigest,
    );
    equal(replayedOutcome.event.eventId, outcome.event.eventId);

    const taskPackage = await taskPackageForTargetDelivery(
      fixture.workspacePath,
      fixture.intent.demandId,
      fixture.intent.targetDeliveryId,
    );
    const resultRequest = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      actionId: issued.claim.claimId,
      observationDigest: outcome.observation.observationDigest,
      report: {
        workType: "implementation" as const,
        content:
          createImplementationTargetResultReportContentFixture(taskPackage),
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
        readonly targetDeliveryId: string;
        readonly hostEffect: {
          readonly actionId: string;
          readonly observationDigest: string;
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
    equal(imported.result.demandId, fixture.intent.demandId);
    equal(imported.result.targetDeliveryId, fixture.intent.targetDeliveryId);
    equal(imported.result.hostEffect.actionId, issued.claim.claimId);
    equal(
      imported.result.hostEffect.observationDigest,
      outcome.observation.observationDigest,
    );
    equal(imported.result.report.outcome, "completed");
    equal(existsSync(claimPath), false);
    equal(textContent(importedCall).includes(fixture.workspacePath), false);
    equal(textContent(importedCall).includes(fixture.rawHandle), false);

    const afterResult = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.claimRequest.demandId,
      },
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
    equal(
      replayedResultCall.isError,
      undefined,
      textContent(replayedResultCall),
    );
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
      demandId: fixture.intent.demandId,
      targetTaskId: fixture.intent.target.targetTaskId,
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
    equal(
      inspection.reviewUnit.targetResult.resultDigest,
      imported.result.resultDigest,
    );
    equal(Object.hasOwn(inspection, "decision"), false);
    equal(textContent(inspectionCall).includes(fixture.workspacePath), false);

    const judgment = controllerImplementationReviewDecisionInput("accept");
    const decisionRequest = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
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
    equal(textContent(decisionCall).includes(fixture.rawHandle), false);

    const afterDecision = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
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
    equal(
      replayedDecisionCall.isError,
      undefined,
      textContent(replayedDecisionCall),
    );
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
        demandId: fixture.intent.demandId,
      },
    });
    equal(
      completionPreviewCall.isError,
      undefined,
      textContent(completionPreviewCall),
    );
    const completionPreview = completionPreviewCall.structuredContent as {
      readonly mode: string;
      readonly status: string;
      readonly plan: Readonly<Record<string, unknown>> & {
        readonly demandId: string;
      };
      readonly planDigest: string;
    };
    equal(completionPreview.mode, "preview");
    equal(completionPreview.status, "ready");
    equal(completionPreview.plan.demandId, fixture.intent.demandId);
    equal(
      textContent(completionPreviewCall).includes(fixture.workspacePath),
      false,
    );
    equal(
      textContent(completionPreviewCall).includes(fixture.rawHandle),
      false,
    );

    const completionApplyRequest = {
      root: fixture.workspacePath,
      mode: "apply",
      plan: completionPreview.plan,
      planDigest: completionPreview.planDigest,
    } as const;
    const completionCall = await client.callTool({
      name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
      arguments: completionApplyRequest,
    });
    equal(completionCall.isError, undefined, textContent(completionCall));
    const completion = completionCall.structuredContent as {
      readonly status: string;
      readonly disposition: string;
      readonly eventAuthority: string;
      readonly completion: {
        readonly demandId: string;
        readonly testingMode: string;
      };
      readonly event: { readonly eventId: string };
      readonly stateDigest: string;
    };
    equal(completion.status, "completed");
    equal(completion.disposition, "committed");
    equal(completion.eventAuthority, "current");
    equal(completion.completion.demandId, fixture.intent.demandId);
    equal(completion.completion.testingMode, "controller-only");
    equal(textContent(completionCall).includes(fixture.workspacePath), false);
    equal(textContent(completionCall).includes(fixture.rawHandle), false);

    const terminalRouteCall = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
      },
    });
    equal(terminalRouteCall.isError, undefined, textContent(terminalRouteCall));
    const terminalRoute = terminalRouteCall.structuredContent as {
      readonly route: {
        readonly lifecycle: string;
        readonly disposition: string;
        readonly frontiers: readonly unknown[];
      };
    };
    equal(terminalRoute.route.lifecycle, "completed");
    equal(terminalRoute.route.disposition, "terminal");
    equal(terminalRoute.route.frontiers.length, 0);

    const replayedCompletionCall = await client.callTool({
      name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
      arguments: completionApplyRequest,
    });
    equal(
      replayedCompletionCall.isError,
      undefined,
      textContent(replayedCompletionCall),
    );
    const replayedCompletion = replayedCompletionCall.structuredContent as {
      readonly status: string;
      readonly disposition: string;
      readonly event: { readonly eventId: string };
      readonly stateDigest: string;
    };
    equal(replayedCompletion.status, "already-completed");
    equal(replayedCompletion.disposition, "idempotent");
    equal(replayedCompletion.event.eventId, completion.event.eventId);
    equal(replayedCompletion.stateDigest, completion.stateDigest);
  } finally {
    await close();
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});
