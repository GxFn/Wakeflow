import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";

import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME } from "../../src/governance/controller/demand-controller-route-public-contract.js";
import { WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME } from "../../src/governance/delivery/target-delivery-preparation-public-contract.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME } from "../../src/governance/delivery/target-host-effect-claim-public-contract.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME } from "../../src/governance/delivery/target-host-effect-outcome-public-contract.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME } from "../../src/governance/delivery/target-host-effect-rearm-public-contract.js";
import { WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/demand/publication/demand-publication-public-contract.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME } from "../../src/governance/evidence/managed-evidence-public-contract.js";
import { WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME } from "../../src/governance/lifecycle/demand-completion-public-contract.js";
import {
  WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
} from "../../src/governance/ledger/ledger-authority-public-contract.js";
import { WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME } from "../../src/governance/result/target-result-import-public-contract.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-implementation-review-decision-public-contract.js";
import { WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-product-defect-remediation-public-contract.js";
import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-test-review-decision-public-contract.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME } from "../../src/governance/review/target-result-review-inspection-public-contract.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME } from "../../src/governance/review/target-result-review-resume-public-contract.js";
import { WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME } from "../../src/governance/tasking/target-task-planning-public-contract.js";
import { WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME } from "../../src/governance/testing/test-card-planning-public-contract.js";
import { WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME } from "../../src/governance/testing/test-delivery-preparation-public-contract.js";
import { WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME } from "../../src/governance/todo/todo-inspection-public-contract.js";
import { WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/todo/todo-intake-publication-public-contract.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../src/workspace/maintenance/wakeflow-maintenance-public-contract.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME } from "../../src/workspace/window-runtime/wakeflow-window-host-binding-public-contract.js";
import {
  registerWakeflowPublicMcpAuthorityTools,
} from "../../src/entrypoints/wakeflow-public-mcp-authority-tools.js";
import {
  registerWakeflowPublicMcpExecutionTools,
} from "../../src/entrypoints/wakeflow-public-mcp-execution-tools.js";
import {
  registerWakeflowPublicMcpReviewTools,
} from "../../src/entrypoints/wakeflow-public-mcp-review-tools.js";
import {
  registerWakeflowPublicMcpWorkspaceTools,
} from "../../src/entrypoints/wakeflow-public-mcp-workspace-tools.js";

type CapturedHandler = (request: unknown) => Promise<CallToolResult>;

const TOOL_EXECUTOR_PAIRS = Object.freeze([
  [WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, "executeMaintenance"],
  [WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, "registerWindowHostBinding"],
  [WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME, "publishRequirement"],
  [WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME, "publishConfirmation"],
  [WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME, "createDemand"],
  [WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME, "recordManagedEvidence"],
  [WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME, "inspectTodo"],
  [WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME, "intakeTodo"],
  [WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME, "inspectDemandRoute"],
  [WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME, "planTestCard"],
  [WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME, "planTargetTask"],
  [
    WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    "prepareImplementationDelivery",
  ],
  [WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME, "prepareTestDelivery"],
  [WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME, "claimTargetHostEffect"],
  [
    WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
    "recordTargetHostEffectOutcome",
  ],
  [WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME, "rearmTargetHostEffect"],
  [WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME, "importTargetResult"],
  [
    WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    "inspectTargetResultReview",
  ],
  [
    WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
    "resumeTargetResultReview",
  ],
  [
    WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    "recordControllerImplementationReviewDecision",
  ],
  [
    WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    "recordControllerTestReviewDecision",
  ],
  [
    WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
    "authorizeProductDefectRemediation",
  ],
  [WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME, "completeDemand"],
] as const);

test("四个静态注册组把二十三个工具绑定到同名executor", async () => {
  const handlers = new Map<string, CapturedHandler>();
  const server = new McpServer({ name: "registration-test", version: "1" });
  server.registerTool = ((
    name: string,
    _configuration: unknown,
    callback: (
      request: never,
      context: never,
    ) => CallToolResult | Promise<CallToolResult>,
  ) => {
    handlers.set(
      name,
      async (request: unknown) =>
        callback(request as never, undefined as never) as Promise<CallToolResult>,
    );
    return Object.freeze({}) as never;
  }) as typeof server.registerTool;

  const calls: Array<Readonly<{ field: string; request: unknown }>> = [];
  const executor = (field: string) => async (request: unknown): Promise<never> => {
    calls.push(Object.freeze({ field, request }));
    throw new Error(`sentinel:${field}`);
  };

  registerWakeflowPublicMcpWorkspaceTools(server, {
    executeMaintenance: executor("executeMaintenance"),
    registerWindowHostBinding: executor("registerWindowHostBinding"),
  });
  registerWakeflowPublicMcpAuthorityTools(server, {
    createDemand: executor("createDemand"),
    inspectDemandRoute: executor("inspectDemandRoute"),
    inspectTodo: executor("inspectTodo"),
    intakeTodo: executor("intakeTodo"),
    publishConfirmation: executor("publishConfirmation"),
    publishRequirement: executor("publishRequirement"),
    recordManagedEvidence: executor("recordManagedEvidence"),
  });
  registerWakeflowPublicMcpExecutionTools(server, {
    claimTargetHostEffect: executor("claimTargetHostEffect"),
    importTargetResult: executor("importTargetResult"),
    planTargetTask: executor("planTargetTask"),
    planTestCard: executor("planTestCard"),
    prepareImplementationDelivery: executor("prepareImplementationDelivery"),
    prepareTestDelivery: executor("prepareTestDelivery"),
    rearmTargetHostEffect: executor("rearmTargetHostEffect"),
    recordTargetHostEffectOutcome: executor("recordTargetHostEffectOutcome"),
  });
  registerWakeflowPublicMcpReviewTools(server, {
    authorizeProductDefectRemediation: executor(
      "authorizeProductDefectRemediation",
    ),
    completeDemand: executor("completeDemand"),
    inspectTargetResultReview: executor("inspectTargetResultReview"),
    recordControllerImplementationReviewDecision: executor(
      "recordControllerImplementationReviewDecision",
    ),
    recordControllerTestReviewDecision: executor(
      "recordControllerTestReviewDecision",
    ),
    resumeTargetResultReview: executor("resumeTargetResultReview"),
  });

  deepEqual(
    [...handlers.keys()],
    TOOL_EXECUTOR_PAIRS.map(([tool]) => tool),
  );
  for (const [tool, field] of TOOL_EXECUTOR_PAIRS) {
    const handler = handlers.get(tool);
    if (handler === undefined) throw new Error(`Missing handler for ${tool}.`);
    const request = Object.freeze({ tool });
    const result = await handler(request);
    equal(result.isError, true);
    deepEqual(calls.at(-1), { field, request });
  }
  equal(calls.length, TOOL_EXECUTOR_PAIRS.length);
});
