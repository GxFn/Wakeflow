import type { McpServer } from "@modelcontextprotocol/server";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import { executeCodexWakeflowMaintenance } from "./codex-wakeflow-maintenance.js";
import { executeCodexTargetDeliveryPreparation } from "./codex-wakeflow-target-delivery-preparation.js";
import { executeCodexTargetHostEffectClaim } from "./codex-wakeflow-target-host-effect-claim.js";
import { executeCodexTargetHostEffectOutcome } from "./codex-wakeflow-target-host-effect-outcome.js";
import { executeCodexTargetHostEffectRearm } from "./codex-wakeflow-target-host-effect-rearm.js";
import { executeCodexTargetResultImport } from "./codex-wakeflow-target-result-import.js";
import { executeCodexTargetResultReviewInspection } from "./codex-wakeflow-target-result-review-inspection.js";
import { executeCodexTestDeliveryPreparation } from "./codex-wakeflow-test-delivery-preparation.js";
import { executeCodexControllerImplementationReviewDecision } from "./codex-wakeflow-controller-implementation-review-decision.js";
import { executeCodexControllerProductDefectRemediation } from "./codex-wakeflow-controller-product-defect-remediation.js";
import { executeCodexControllerTestReviewDecision } from "./codex-wakeflow-controller-test-review-decision.js";
import { executeCodexWakeflowWindowHostBindingRegistration } from "./codex-wakeflow-window-host-binding.js";
import { createWakeflowPublicMcpServer } from "./wakeflow-public-mcp-server.js";
import { executeTargetTaskPlanningPublicRequest } from "../governance/tasking/target-task-planning-public-coordinator.js";
import { executeDemandControllerRoutePublicRequest } from "../governance/controller/demand-controller-route-public-coordinator.js";
import { executeDemandCompletionPublicRequest } from "../governance/lifecycle/demand-completion-public-coordinator.js";
import { executeDemandPublicationPublicRequest } from "../governance/demand/publication/demand-publication-public-coordinator.js";
import { executeTargetResultReviewResumePublicRequest } from "../governance/review/target-result-review-resume-public-coordinator.js";
import { executeTestCardPlanningPublicRequest } from "../governance/testing/test-card-planning-public-coordinator.js";
import { runWakeflowMcpStdio } from "./wakeflow-mcp-stdio.js";

/** Codex 制品内固定的 MCP server identity；版本由制品装配入口注入。 */
const CODEX_WAKEFLOW_MCP_SERVER_NAME = "wakeflow-codex" as const;

/** 创建固定组合Maintenance、Controller Route、Tasking、Delivery与Binding的Codex MCP server。 */
export function createCodexWakeflowMcpServer(serverVersion: string): McpServer {
  return createWakeflowPublicMcpServer({
    serverName: CODEX_WAKEFLOW_MCP_SERVER_NAME,
    serverVersion,
    executeMaintenance: executeCodexWakeflowMaintenance,
    completeDemand: executeDemandCompletionPublicRequest,
    createDemand: executeDemandPublicationPublicRequest,
    inspectDemandRoute: executeDemandControllerRoutePublicRequest,
    importTargetResult: executeCodexTargetResultImport,
    inspectTargetResultReview: executeCodexTargetResultReviewInspection,
    resumeTargetResultReview: executeTargetResultReviewResumePublicRequest,
    planTargetTask: executeTargetTaskPlanningPublicRequest,
    planTestCard: executeTestCardPlanningPublicRequest,
    prepareImplementationDelivery: executeCodexTargetDeliveryPreparation,
    prepareTestDelivery: executeCodexTestDeliveryPreparation,
    claimTargetHostEffect: executeCodexTargetHostEffectClaim,
    recordTargetHostEffectOutcome: executeCodexTargetHostEffectOutcome,
    rearmTargetHostEffect: executeCodexTargetHostEffectRearm,
    recordControllerImplementationReviewDecision:
      executeCodexControllerImplementationReviewDecision,
    recordControllerTestReviewDecision:
      executeCodexControllerTestReviewDecision,
    authorizeProductDefectRemediation:
      executeCodexControllerProductDefectRemediation,
    registerWindowHostBinding:
      executeCodexWakeflowWindowHostBindingRegistration,
  });
}

/** 通过官方 stdio transport 运行 Codex MCP composition root。 */
export function runCodexWakeflowMcpStdio(
  serverVersion: string,
): StdioServerHandle {
  return runWakeflowMcpStdio(() => createCodexWakeflowMcpServer(serverVersion));
}
