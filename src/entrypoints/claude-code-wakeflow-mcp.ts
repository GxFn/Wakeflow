import type { McpServer } from "@modelcontextprotocol/server";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import { executeClaudeCodeWakeflowMaintenance } from "./claude-code-wakeflow-maintenance.js";
import { executeClaudeCodeTargetDeliveryPreparation } from "./claude-code-wakeflow-target-delivery-preparation.js";
import { executeClaudeCodeTargetHostEffectClaim } from "./claude-code-wakeflow-target-host-effect-claim.js";
import { executeClaudeCodeTargetHostEffectOutcome } from "./claude-code-wakeflow-target-host-effect-outcome.js";
import { executeClaudeCodeTargetHostEffectRearm } from "./claude-code-wakeflow-target-host-effect-rearm.js";
import { executeClaudeCodeTargetResultImport } from "./claude-code-wakeflow-target-result-import.js";
import { executeClaudeCodeTargetResultReviewInspection } from "./claude-code-wakeflow-target-result-review-inspection.js";
import { executeClaudeCodeTestDeliveryPreparation } from "./claude-code-wakeflow-test-delivery-preparation.js";
import { executeClaudeCodeControllerImplementationReviewDecision } from "./claude-code-wakeflow-controller-implementation-review-decision.js";
import { executeClaudeCodeControllerProductDefectRemediation } from "./claude-code-wakeflow-controller-product-defect-remediation.js";
import { executeClaudeCodeControllerTestReviewDecision } from "./claude-code-wakeflow-controller-test-review-decision.js";
import { executeClaudeCodeWakeflowWindowHostBindingRegistration } from "./claude-code-wakeflow-window-host-binding.js";
import { createWakeflowPublicMcpServer } from "./wakeflow-public-mcp-server.js";
import { executeTargetTaskPlanningPublicRequest } from "../governance/tasking/target-task-planning-public-coordinator.js";
import { executeDemandControllerRoutePublicRequest } from "../governance/controller/demand-controller-route-public-coordinator.js";
import { executeDemandCompletionPublicRequest } from "../governance/lifecycle/demand-completion-public-coordinator.js";
import { executeTargetResultReviewResumePublicRequest } from "../governance/review/target-result-review-resume-public-coordinator.js";
import { executeTestCardPlanningPublicRequest } from "../governance/testing/test-card-planning-public-coordinator.js";
import { runWakeflowMcpStdio } from "./wakeflow-mcp-stdio.js";

/** Claude Code 制品内固定的 MCP server identity；版本由制品装配入口注入。 */
const CLAUDE_CODE_WAKEFLOW_MCP_SERVER_NAME = "wakeflow-claude-code" as const;

/** 创建固定组合Maintenance、Controller Route、Tasking、Delivery与Binding的Claude MCP server。 */
export function createClaudeCodeWakeflowMcpServer(
  serverVersion: string,
): McpServer {
  return createWakeflowPublicMcpServer({
    serverName: CLAUDE_CODE_WAKEFLOW_MCP_SERVER_NAME,
    serverVersion,
    executeMaintenance: executeClaudeCodeWakeflowMaintenance,
    completeDemand: executeDemandCompletionPublicRequest,
    inspectDemandRoute: executeDemandControllerRoutePublicRequest,
    importTargetResult: executeClaudeCodeTargetResultImport,
    inspectTargetResultReview: executeClaudeCodeTargetResultReviewInspection,
    resumeTargetResultReview: executeTargetResultReviewResumePublicRequest,
    planTargetTask: executeTargetTaskPlanningPublicRequest,
    planTestCard: executeTestCardPlanningPublicRequest,
    prepareImplementationDelivery: executeClaudeCodeTargetDeliveryPreparation,
    prepareTestDelivery: executeClaudeCodeTestDeliveryPreparation,
    claimTargetHostEffect: executeClaudeCodeTargetHostEffectClaim,
    recordTargetHostEffectOutcome: executeClaudeCodeTargetHostEffectOutcome,
    rearmTargetHostEffect: executeClaudeCodeTargetHostEffectRearm,
    recordControllerImplementationReviewDecision:
      executeClaudeCodeControllerImplementationReviewDecision,
    recordControllerTestReviewDecision:
      executeClaudeCodeControllerTestReviewDecision,
    authorizeProductDefectRemediation:
      executeClaudeCodeControllerProductDefectRemediation,
    registerWindowHostBinding:
      executeClaudeCodeWakeflowWindowHostBindingRegistration,
  });
}

/** 通过官方 stdio transport 运行 Claude Code MCP composition root。 */
export function runClaudeCodeWakeflowMcpStdio(
  serverVersion: string,
): StdioServerHandle {
  return runWakeflowMcpStdio(() =>
    createClaudeCodeWakeflowMcpServer(serverVersion),
  );
}
