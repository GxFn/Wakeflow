import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { createClaudeCodeWakeflowMcpServer } from "../../src/entrypoints/claude-code-wakeflow-mcp.js";
import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import {
  createWakeflowPublicMcpServer,
  WakeflowPublicMcpServerConfigurationError,
} from "../../src/entrypoints/wakeflow-public-mcp-server.js";
import {
  WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/demand/contract.js";
import {
  WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
  WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME,
  WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/delivery/contract.js";
import { WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME } from "../../src/capabilities/evidence/contract.js";
import {
  WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
  WAKEFLOW_VERIFY_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/observation/contract.js";
import { WAKEFLOW_POD_PUBLIC_TOOL_NAME } from "../../src/capabilities/pod/contract.js";
import {
  WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME,
  WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/requirement/contract.js";
import {
  WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
  WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
  WAKEFLOW_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/result-review/contract.js";
import { WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME } from "../../src/capabilities/tasking/contract.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../src/capabilities/workspace/maintain-workspace.js";
import { WAKEFLOW_PUBLIC_TOOL_CATALOG } from "../../src/entrypoints/wakeflow-public-mcp-catalog.js";
import {
  findWakeflowToolRegistration,
  measureWakeflowToolCatalogBytes,
} from "../../src/kernel/tool-registry.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME } from "../../src/capabilities/endpoint/contract.js";
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
type ExecutorField = Exclude<keyof PublicServerOptions, "serverName" | "serverVersion">;

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
  expectedTool(WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME, "prepare-delivery", ADDITIVE, [
    "takes the window work claim",
    "Sending is the Agent host effect",
  ]),
  expectedTool(WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME, "demand-completion", DESTRUCTIVE, [
    "seals the archive package",
    "deletes the active root",
  ]),
  expectedTool(WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME, "demand-publication", DESTRUCTIVE, [
    "Only one active Demand per controller",
  ]),
  expectedTool(WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME, "demand-cancellation", DESTRUCTIVE, [
    "withdraws the requirement package",
  ]),
  expectedTool(WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME, "demand-continuation", DESTRUCTIVE, [
    "re-opens a completed Demand from its archive",
    "record-decision answers an escalation",
  ]),
  expectedTool(
    WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
    "requirement-publication",
    DESTRUCTIVE,
    ["confirmation point 1", "never creates a Demand"],
  ),
  expectedTool(WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME, "board-inspection", READ_ONLY, [
    "sorted by priority",
    "never claims",
  ]),
  expectedTool(WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME, "target-result-import", ADDITIVE, [
    "managed evidence records",
    "wake-controller callback permit",
    "never acceptance",
  ]),
  expectedTool(WAKEFLOW_STATUS_PUBLIC_TOOL_NAME, "status", READ_ONLY),
  expectedTool(WAKEFLOW_VERIFY_PUBLIC_TOOL_NAME, "verify", READ_ONLY),
  expectedTool(
    WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    "target-result-review-inspection",
    READ_ONLY,
    ["decisions the rules allow", "records nothing"],
  ),
  expectedTool(WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, "maintenance-public", {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  }),
  expectedTool(WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME, "target-task-planning", ADDITIVE),
  expectedTool(WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME, "rearm-delivery", ADDITIVE, [
    "At most three rearms per envelope",
    "Never performs the host effect",
  ]),
  expectedTool(
    WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    "implementation-review-decision",
    ADDITIVE,
    ["completion record", "carries resumption"],
  ),
  expectedTool(WAKEFLOW_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME, "test-review-decision", ADDITIVE, [
    "step failure classifications gate the decision",
    "remediation authorization",
  ]),
  expectedTool(WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME, "record-evidence", ADDITIVE, [
    "closed vocabulary",
    "already-recorded",
    "Credential findings always block",
  ]),
  expectedTool(WAKEFLOW_POD_PUBLIC_TOOL_NAME, "pod", DESTRUCTIVE, [
    "one config transaction",
    "close is two-phase",
  ]),
  expectedTool(
    WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
    "record-delivery-outcome",
    DESTRUCTIVE,
    ["user-prompt-submit hook record", "everything else stays indeterminate"],
  ),
  expectedTool(
    WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    "window-host-binding-registration",
    DESTRUCTIVE,
    ["never creates, inspects, or closes host windows", "raw handles never leave"],
  ),
] satisfies readonly Readonly<ExpectedPublicTool>[]);

const WAKEFLOW_PUBLIC_TOOL_LIST_INTERIM_BUDGET_BYTES = 128 * 1024;

function unavailableExecutor(): Promise<never> {
  return Promise.reject(new Error("Catalog test executors must not run."));
}

function validPublicServerOptions(): PublicServerOptions {
  return Object.freeze({
    serverName: "wakeflow-public-catalog-test",
    serverVersion: "1.0.0-test",
    cancelDemand: unavailableExecutor,
    completeDemand: unavailableExecutor,
    continueDemand: unavailableExecutor,
    createDemand: unavailableExecutor,
    recordEvidence: unavailableExecutor,
    managePod: unavailableExecutor,
    publishRequirement: unavailableExecutor,
    executeMaintenance: unavailableExecutor,
    importTargetResult: unavailableExecutor,
    inspectStatus: unavailableExecutor,
    verifyWorkspace: unavailableExecutor,
    inspectTargetResultReview: unavailableExecutor,
    inspectBoard: unavailableExecutor,
    planTargetTask: unavailableExecutor,
    prepareDelivery: unavailableExecutor,
    rearmDelivery: unavailableExecutor,
    recordImplementationReviewDecision: unavailableExecutor,
    recordTestReviewDecision: unavailableExecutor,
    recordDeliveryOutcome: unavailableExecutor,
    registerWindowHostBinding: unavailableExecutor,
  });
}

const EXECUTOR_CONFIGURATION_FIELDS = Object.freeze([
  "executeMaintenance",
  "cancelDemand",
  "completeDemand",
  "continueDemand",
  "createDemand",
  "recordEvidence",
  "managePod",
  "publishRequirement",
  "registerWindowHostBinding",
  "inspectStatus",
  "verifyWorkspace",
  "planTargetTask",
  "prepareDelivery",
  "recordDeliveryOutcome",
  "rearmDelivery",
  "importTargetResult",
  "inspectTargetResultReview",
  "inspectBoard",
  "recordImplementationReviewDecision",
  "recordTestReviewDecision",
] as const satisfies readonly ExecutorField[]);

test("MCP composition拒绝Proxy executor与额外配置字段", () => {
  const valid = validPublicServerOptions();
  const configuredExecutorFields = Object.keys(valid)
    .filter((field) => field !== "serverName" && field !== "serverVersion")
    .sort();
  const exercisedExecutorFields = [...EXECUTOR_CONFIGURATION_FIELDS].sort();
  deepEqual(exercisedExecutorFields, configuredExecutorFields);
  equal(new Set(exercisedExecutorFields).size, exercisedExecutorFields.length);
  for (const field of EXECUTOR_CONFIGURATION_FIELDS) {
    const executor = valid[field];
    throws(
      () =>
        createWakeflowPublicMcpServer({
          ...valid,
          [field]: new Proxy(executor, {}),
        }),
      (error: unknown) =>
        error instanceof WakeflowPublicMcpServerConfigurationError &&
        error.reason === "executor" &&
        error.field === field,
    );
  }
  throws(
    () =>
      createWakeflowPublicMcpServer({
        ...valid,
        extra: true,
      } as never),
    (error: unknown) =>
      error instanceof WakeflowPublicMcpServerConfigurationError && error.reason === "options",
  );
});

test("官方MCP server只发布十八个闭合Schema工具", async (t) => {
  const client = await connectWakeflowMcpTestClient(t);
  const instructions = client.getInstructions();
  equal(typeof instructions, "string");
  equal(Buffer.byteLength(instructions ?? "", "utf8") <= 1_024, true);
  equal(instructions?.includes("never performs Agent host effects"), true);
  equal(instructions?.includes(WAKEFLOW_STATUS_PUBLIC_TOOL_NAME), true);
  const listed = await client.listTools();
  const actualByName = new Map(listed.tools.map((tool) => [tool.name, tool] as const));
  deepEqual([...actualByName.keys()].sort(), PUBLIC_TOOL_CATALOG.map((tool) => tool.name).sort());

  for (const expected of PUBLIC_TOOL_CATALOG) {
    const actual = actualByName.get(expected.name);
    equal(actual?.inputSchema.$id, expected.inputId);
    // ADR-0004 选项 A：结果 Schema 只在服务端校验，不进 tools/list。
    equal(actual?.outputSchema, undefined);
    equal(
      findWakeflowToolRegistration(WAKEFLOW_PUBLIC_TOOL_CATALOG, expected.name)?.resultSchema.$id,
      expected.outputId,
    );
    deepEqual(actual?.annotations, expected.annotations);
    equal(JSON.stringify(actual?.inputSchema).includes('"$ref":"urn:'), false);
    for (const fragment of expected.descriptionFragments ?? []) {
      equal(actual?.description?.includes(fragment), true, `${expected.name}: ${fragment}`);
    }
  }
  // 体积预算：ADR-0004 的 60 KB 目标在 L1 合同收敛后复测；这里先锁住不回退。
  const listBytes = Buffer.byteLength(JSON.stringify(listed.tools), "utf8");
  equal(listBytes <= WAKEFLOW_PUBLIC_TOOL_LIST_INTERIM_BUDGET_BYTES, true);
  equal(
    measureWakeflowToolCatalogBytes(WAKEFLOW_PUBLIC_TOOL_CATALOG) <=
      WAKEFLOW_PUBLIC_TOOL_LIST_INTERIM_BUDGET_BYTES,
    true,
  );
});

test("Codex与Claude Code composition root发布同一十八工具集合", async () => {
  const listedNames: string[][] = [];
  for (const createServer of [createCodexWakeflowMcpServer, createClaudeCodeWakeflowMcpServer]) {
    const server = createServer("1.0.0-test");
    const { client, close } = await connectWakeflowMcpServerForTest(server);
    try {
      listedNames.push((await client.listTools()).tools.map((entry) => entry.name).sort());
    } finally {
      await close();
    }
  }
  deepEqual(listedNames[0], listedNames[1]);
  deepEqual(listedNames[0], PUBLIC_TOOL_CATALOG.map((tool) => tool.name).sort());
});

/** 持久化级别是注入值：它不属于线格式，任何公共工具的请求 Schema 都不得出现它（§13.99 同批确认）。 */
test("公共工具的请求 Schema 里没有持久化级别字段", () => {
  for (const tool of WAKEFLOW_PUBLIC_TOOL_CATALOG.tools) {
    equal(
      JSON.stringify(tool.requestSchema).includes("durability"),
      false,
      `${tool.name} 的请求 Schema 泄露了持久化级别`,
    );
  }
});
