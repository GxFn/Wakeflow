import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { createClaudeCodeWakeflowMcpServer } from "../../src/entrypoints/claude-code-wakeflow-mcp.js";
import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import {
  createWakeflowPublicMcpServer,
  WakeflowPublicMcpServerConfigurationError,
} from "../../src/entrypoints/wakeflow-public-mcp-server.js";
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
import { WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME } from "../../src/governance/todo/todo-inspection-public-contract.js";
import { WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/todo/todo-intake-publication-public-contract.js";
import { WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME } from "../../src/governance/result/target-result-import-public-contract.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-implementation-review-decision-public-contract.js";
import { WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-product-defect-remediation-public-contract.js";
import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-test-review-decision-public-contract.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME } from "../../src/governance/review/target-result-review-inspection-public-contract.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME } from "../../src/governance/review/target-result-review-resume-public-contract.js";
import { WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME } from "../../src/governance/tasking/target-task-planning-public-contract.js";
import { WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME } from "../../src/governance/testing/test-card-planning-public-contract.js";
import { WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME } from "../../src/governance/testing/test-delivery-preparation-public-contract.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../src/workspace/maintenance/wakeflow-maintenance-public-contract.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME } from "../../src/workspace/window-runtime/wakeflow-window-host-binding-public-contract.js";
import {
  connectWakeflowMcpServerForTest,
  connectWakeflowMcpTestClient,
} from "./wakeflow-public-mcp-server.fixture.js";

/**
 * Public MCP catalog是组合根的横切合同，不承载任何领域成功样例。
 *
 * 真实调用、恢复、错误信封与业务状态转换留在各owner测试；本文件只证明固定executor
 * 配置、工具Schema/annotations和Codex/Claude集合一致，避免新增工具时运行全部生命周期纵切。
 */

type PublicServerOptions = Parameters<typeof createWakeflowPublicMcpServer>[0];
type ExecutorField = Exclude<
  keyof PublicServerOptions,
  "serverName" | "serverVersion"
>;

interface ExpectedPublicTool {
  readonly name: string;
  readonly inputId: string;
  readonly outputId: string;
  readonly annotations: Readonly<{
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: false;
  }>;
  readonly descriptionFragments?: readonly string[];
}

const CLOSED_WORLD = false as const;

function expectedTool(
  name: string,
  schemaStem: string,
  annotations: Omit<ExpectedPublicTool["annotations"], "openWorldHint">,
  descriptionFragments?: readonly string[],
): Readonly<ExpectedPublicTool> {
  return Object.freeze({
    name,
    inputId: `urn:wakeflow:entrypoints:${schemaStem}-request:v1`,
    outputId: `urn:wakeflow:entrypoints:${schemaStem}-result:v1`,
    annotations: Object.freeze({
      ...annotations,
      openWorldHint: CLOSED_WORLD,
    }),
    ...(descriptionFragments === undefined
      ? {}
      : { descriptionFragments: Object.freeze([...descriptionFragments]) }),
  });
}

const READ_ONLY = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
});
const ADDITIVE = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
});
const DESTRUCTIVE = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
});

const PUBLIC_TOOL_CATALOG = Object.freeze([
  expectedTool(
    WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
    "controller-product-defect-remediation",
    DESTRUCTIVE,
    ["does not create Delivery", "let Test modify product code"],
  ),
  expectedTool(
    WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
    "target-host-effect-claim",
    ADDITIVE,
  ),
  expectedTool(
    WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
    "demand-completion",
    DESTRUCTIVE,
    ["Completion is not Archive"],
  ),
  expectedTool(
    WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
    "demand-publication",
    DESTRUCTIVE,
    ["performs no host effect"],
  ),
  expectedTool(
    WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
    "requirement-publication",
    ADDITIVE,
    ["source bytes", "host effect"],
  ),
  expectedTool(
    WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
    "confirmation-publication",
    ADDITIVE,
    ["future isolated Demand identity", "creates no Demand"],
  ),
  expectedTool(
    WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    "target-result-import",
    DESTRUCTIVE,
  ),
  expectedTool(
    WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
    "demand-controller-route",
    READ_ONLY,
  ),
  expectedTool(
    WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    "target-result-review-inspection",
    READ_ONLY,
  ),
  expectedTool(
    WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME,
    "todo-inspection",
    READ_ONLY,
    ["does not derive eligibility", "state-root ref"],
  ),
  expectedTool(
    WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
    "todo-intake-publication",
    ADDITIVE,
    ["creates no Demand", "does not execute Auto Claim"],
  ),
  expectedTool(
    WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    "maintenance-public",
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  ),
  expectedTool(
    WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    "target-task-planning",
    ADDITIVE,
  ),
  expectedTool(
    WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
    "test-card-planning",
    ADDITIVE,
    ["creates no Test Task", "runs no Test"],
  ),
  expectedTool(
    WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    "target-delivery-preparation",
    ADDITIVE,
  ),
  expectedTool(
    WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    "test-delivery-preparation",
    ADDITIVE,
    ["derives initial, rerun, or replacement mode", "creates no Dispatch Packet"],
  ),
  expectedTool(
    WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
    "target-host-effect-rearm",
    ADDITIVE,
  ),
  expectedTool(
    WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    "controller-implementation-review-decision",
    DESTRUCTIVE,
  ),
  expectedTool(
    WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    "controller-test-review-decision",
    DESTRUCTIVE,
    ["does not run checks", "create another attempt"],
  ),
  expectedTool(
    WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
    "managed-evidence-publication",
    ADDITIVE,
    ["payload bytes"],
  ),
  expectedTool(
    WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
    "target-host-effect-outcome",
    DESTRUCTIVE,
  ),
  expectedTool(
    WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    "window-host-binding-registration",
    ADDITIVE,
  ),
  expectedTool(
    WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
    "target-result-review-resume",
    ADDITIVE,
    ["runs no checks", "grants no accept"],
  ),
] satisfies readonly Readonly<ExpectedPublicTool>[]);

function unavailableExecutor(): Promise<never> {
  return Promise.reject(new Error("Catalog test executors must not run."));
}

function validPublicServerOptions(): PublicServerOptions {
  return Object.freeze({
    serverName: "wakeflow-public-catalog-test",
    serverVersion: "1.0.0-test",
    authorizeProductDefectRemediation: unavailableExecutor,
    claimTargetHostEffect: unavailableExecutor,
    completeDemand: unavailableExecutor,
    createDemand: unavailableExecutor,
    recordManagedEvidence: unavailableExecutor,
    publishConfirmation: unavailableExecutor,
    publishRequirement: unavailableExecutor,
    executeMaintenance: unavailableExecutor,
    importTargetResult: unavailableExecutor,
    inspectDemandRoute: unavailableExecutor,
    inspectTargetResultReview: unavailableExecutor,
    inspectTodo: unavailableExecutor,
    intakeTodo: unavailableExecutor,
    planTargetTask: unavailableExecutor,
    planTestCard: unavailableExecutor,
    prepareImplementationDelivery: unavailableExecutor,
    prepareTestDelivery: unavailableExecutor,
    rearmTargetHostEffect: unavailableExecutor,
    recordControllerImplementationReviewDecision: unavailableExecutor,
    recordControllerTestReviewDecision: unavailableExecutor,
    recordTargetHostEffectOutcome: unavailableExecutor,
    registerWindowHostBinding: unavailableExecutor,
    resumeTargetResultReview: unavailableExecutor,
  });
}

const EXECUTOR_CONFIGURATION_CASES = Object.freeze([
  ["executeMaintenance", "maintenance-executor"],
  ["completeDemand", "demand-completion-executor"],
  ["createDemand", "demand-publication-executor"],
  ["recordManagedEvidence", "managed-evidence-executor"],
  ["publishConfirmation", "confirmation-publication-executor"],
  ["publishRequirement", "requirement-publication-executor"],
  ["resumeTargetResultReview", "target-result-review-resume-executor"],
  ["registerWindowHostBinding", "window-host-binding-executor"],
  ["claimTargetHostEffect", "target-host-effect-claim-executor"],
  ["inspectDemandRoute", "demand-controller-route-executor"],
  ["planTargetTask", "target-task-planning-executor"],
  ["planTestCard", "test-card-planning-executor"],
  ["prepareImplementationDelivery", "target-delivery-preparation-executor"],
  ["prepareTestDelivery", "test-delivery-preparation-executor"],
  ["recordTargetHostEffectOutcome", "target-host-effect-outcome-executor"],
  ["rearmTargetHostEffect", "target-host-effect-rearm-executor"],
  ["importTargetResult", "target-result-import-executor"],
  ["inspectTargetResultReview", "target-result-review-inspection-executor"],
  ["inspectTodo", "todo-inspection-executor"],
  ["intakeTodo", "todo-intake-publication-executor"],
  [
    "recordControllerImplementationReviewDecision",
    "controller-implementation-review-decision-executor",
  ],
  [
    "recordControllerTestReviewDecision",
    "controller-test-review-decision-executor",
  ],
  [
    "authorizeProductDefectRemediation",
    "controller-product-defect-remediation-executor",
  ],
] as const satisfies readonly (readonly [ExecutorField, string])[]);

test("MCP composition拒绝Proxy executor与额外配置字段", () => {
  const valid = validPublicServerOptions();
  const configuredExecutorFields = Object.keys(valid)
    .filter((field) => field !== "serverName" && field !== "serverVersion")
    .sort();
  const exercisedExecutorFields = EXECUTOR_CONFIGURATION_CASES.map(
    ([field]) => field,
  ).sort();
  deepEqual(exercisedExecutorFields, configuredExecutorFields);
  equal(new Set(exercisedExecutorFields).size, exercisedExecutorFields.length);
  for (const [field, reason] of EXECUTOR_CONFIGURATION_CASES) {
    const executor = valid[field];
    throws(
      () =>
        createWakeflowPublicMcpServer({
          ...valid,
          [field]: new Proxy(executor, {}),
        }),
      (error: unknown) =>
        error instanceof WakeflowPublicMcpServerConfigurationError &&
        error.reason === reason,
    );
  }
  throws(
    () =>
      createWakeflowPublicMcpServer({
        ...valid,
        extra: true,
      } as never),
    (error: unknown) =>
      error instanceof WakeflowPublicMcpServerConfigurationError &&
      error.reason === "options",
  );
});

test("官方MCP server只发布二十三个闭合Schema工具", async (t) => {
  const client = await connectWakeflowMcpTestClient(t);
  const instructions = client.getInstructions();
  equal(typeof instructions, "string");
  equal(Buffer.byteLength(instructions ?? "", "utf8") <= 1_024, true);
  equal(instructions?.includes("never performs Agent host effects"), true);
  equal(
    instructions?.includes(WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME),
    true,
  );
  const listed = await client.listTools();
  const actualByName = new Map(
    listed.tools.map((tool) => [tool.name, tool] as const),
  );
  deepEqual(
    [...actualByName.keys()].sort(),
    PUBLIC_TOOL_CATALOG.map((tool) => tool.name).sort(),
  );

  for (const expected of PUBLIC_TOOL_CATALOG) {
    const actual = actualByName.get(expected.name);
    equal(actual?.inputSchema.$id, expected.inputId);
    equal(actual?.outputSchema?.$id, expected.outputId);
    deepEqual(actual?.annotations, expected.annotations);
    equal(
      JSON.stringify(actual?.inputSchema).includes('"$ref":"urn:'),
      false,
    );
    equal(
      JSON.stringify(actual?.outputSchema).includes('"$ref":"urn:'),
      false,
    );
    for (const fragment of expected.descriptionFragments ?? []) {
      equal(actual?.description?.includes(fragment), true);
    }
  }
});

test("Codex与Claude Code composition root发布同一二十三工具集合", async () => {
  const listedNames: string[][] = [];
  for (const createServer of [
    createCodexWakeflowMcpServer,
    createClaudeCodeWakeflowMcpServer,
  ]) {
    const server = createServer("1.0.0-test");
    const { client, close } = await connectWakeflowMcpServerForTest(server);
    try {
      listedNames.push(
        (await client.listTools()).tools.map((entry) => entry.name).sort(),
      );
    } finally {
      await close();
    }
  }
  deepEqual(listedNames[0], listedNames[1]);
  deepEqual(
    listedNames[0],
    PUBLIC_TOOL_CATALOG.map((tool) => tool.name).sort(),
  );
});
