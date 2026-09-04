import { equal } from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { CallToolResult } from "@modelcontextprotocol/client";

import { parseWakeflowConfigV3 } from "../../src/configuration/wakeflow-config-v3.js";
import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME } from "../../src/governance/controller/demand-controller-route-public-contract.js";
import { WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/demand/publication/demand-publication-public-contract.js";
import { WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/ledger/ledger-authority-public-contract.js";
import { WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME } from "../../src/governance/tasking/target-task-planning-public-contract.js";
import { WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/todo/todo-intake-publication-public-contract.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../src/capabilities/workspace/maintain-workspace.js";
import { createMinimalWakeflowFreshConfigSelection } from "../configuration/wakeflow-fresh-config-selection.fixture.js";
import {
  connectWakeflowMcpServerForTest,
  type ConnectedWakeflowMcpTestClient,
} from "../entrypoints/wakeflow-public-mcp-server.fixture.js";
import {
  cleanupScenarioWorkspace,
  createScenarioWorkspace,
  renderScenarioReport,
  SCENARIO_CATALOG,
  scenarioToolText,
  type ScenarioOutcome,
  type ScenarioWorkspace,
} from "./wakeflow-scenario-acceptance.fixture.js";

/**
 * 三个场景在同一个一次性工作区上顺序运行：初始化 → 创建 Demand → 规划任务。
 * 所有调用都经过公共 MCP 工具，即 Agent 真实使用的入口；宿主效果不在本骨架内。
 */

const REQUIREMENT_DOCUMENTS = Object.freeze([
  { role: "original-plan", path: "authority/original-plan.md" },
  { role: "requirement-design", path: "authority/requirement-design.md" },
  { role: "code-facts", path: "authority/code-facts.md" },
  { role: "landing-plan", path: "authority/landing-plan.md" },
  { role: "non-goals", path: "authority/non-goals.md" },
  { role: "user-confirmation", path: "authority/user-confirmation.md" },
] as const);

interface PreviewPlan {
  readonly plan: Readonly<Record<string, unknown>>;
  readonly planDigest: string;
}

interface ScenarioContext {
  readonly workspace: ScenarioWorkspace;
  readonly connection: ConnectedWakeflowMcpTestClient;
  designSurfaceId?: string;
  designWindowId?: string;
  productWindowId?: string;
  repositoryId?: string;
  designPath?: string;
  memberRefs?: readonly string[];
  demandId?: string;
}

async function call(
  context: ScenarioContext,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<CallToolResult> {
  const result = await context.connection.client.callTool({
    name,
    arguments: args,
  });
  if (result.isError === true) {
    throw new Error(`${name} failed: ${scenarioToolText(result)}`);
  }
  return result;
}

function assertNoPrivatePath(
  context: ScenarioContext,
  result: CallToolResult,
): void {
  equal(
    JSON.stringify(result.structuredContent).includes(context.workspace.fixtureRoot),
    false,
    "public result leaked the disposable workspace path",
  );
}

async function scenarioFreshInitialize(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  const selection = createMinimalWakeflowFreshConfigSelection();
  (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const before = readdirSync(root).sort();
  const preview = await call(context, WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, {
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection },
  });
  assertNoPrivatePath(context, preview);
  const previewed = preview.structuredContent as {
    readonly status: string;
    readonly planDigest: string | null;
    readonly launchIntents: readonly unknown[];
    readonly next: { readonly frontier: string | null };
  };
  equal(previewed.status, "ready");
  equal(previewed.next.frontier, "workspace-maintenance-apply");
  equal(readdirSync(root).sort().join(","), before.join(","), "preview wrote");
  const applied = await call(context, WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, {
    root,
    action: "fresh-initialize",
    mode: "apply",
    request: { selection },
    planDigest: previewed.planDigest,
  });
  assertNoPrivatePath(context, applied);
  const result = applied.structuredContent as { readonly status: string };
  equal(result.status, "completed");
  equal(existsSync(path.join(root, "wakeflow.config.json")), true);
  equal(existsSync(path.join(root, ".wakeflow-active")), true);

  const config = parseWakeflowConfigV3(
    JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8")),
  );
  const design = config.topology.supportSurfaces.find(
    (surface) => surface.capability === "design",
  );
  const designWindow = config.topology.windows.find((w) => w.role === "design");
  const productWindow = config.topology.windows.find((w) => w.role === "product");
  const repository = config.topology.repositories[0];
  if (!design || !designWindow || !productWindow || !repository) {
    throw new Error("fresh config lacks the expected topology");
  }
  context.designSurfaceId = design.surfaceId;
  context.designWindowId = designWindow.windowId;
  context.productWindowId = productWindow.windowId;
  context.repositoryId = repository.repositoryId;
  context.designPath = path.join(root, design.path);
  return `status=${result.status}; launchIntents=${previewed.launchIntents.length}; config+active present`;
}

async function scenarioCreateDemand(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (!context.designSurfaceId || !context.designWindowId || !context.designPath) {
    throw new Error("scenario ordering: fresh-initialize must run first");
  }
  mkdirSync(path.join(context.designPath, "authority"), { recursive: true });
  for (const document of REQUIREMENT_DOCUMENTS) {
    writeFileSync(
      path.join(context.designPath, document.path),
      `# ${document.role}\n`,
      { mode: 0o644 },
    );
  }
  const requirementPreview = await call(
    context,
    WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
    {
      root,
      mode: "preview",
      title: "Scenario acceptance requirement",
      designSurfaceId: context.designSurfaceId,
      documents: [...REQUIREMENT_DOCUMENTS],
    },
  );
  const requirementPlan = requirementPreview.structuredContent as PreviewPlan;
  const requirementApplied = await call(
    context,
    WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
    { root, mode: "apply", plan: requirementPlan.plan, planDigest: requirementPlan.planDigest },
  );
  assertNoPrivatePath(context, requirementApplied);
  const requirement = requirementApplied.structuredContent as {
    readonly publication: {
      readonly memberReferences: readonly {
        readonly recordId: string;
        readonly memberPath: string;
        readonly memberRef: string;
      }[];
    };
  };
  context.memberRefs = requirement.publication.memberReferences.map(
    (reference) => reference.memberRef,
  );

  const intakePreview = await call(
    context,
    WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
    {
      root,
      mode: "preview",
      intake: {
        demandType: "requirement",
        priority: "P1",
        originWindowId: context.designWindowId,
        summary: "Implement the scenario acceptance requirement",
        intakeRationale: "The confirmed requirement is ready for Demand publication.",
        readiness: { status: "ready" },
        autoClaim: false,
        testingDecision: {
          mode: "controller-only",
          summary: "Controller validates focused implementation checks.",
        },
        authorityMembers: requirement.publication.memberReferences.map(
          (reference) => ({
            recordId: reference.recordId,
            memberPath: reference.memberPath,
          }),
        ),
      },
    },
  );
  const intakePlan = intakePreview.structuredContent as PreviewPlan;
  const intakeApplied = await call(
    context,
    WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
    { root, mode: "apply", plan: intakePlan.plan, planDigest: intakePlan.planDigest },
  );
  const intake = intakeApplied.structuredContent as {
    readonly publication: { readonly todoId: string };
  };

  const demandPreview = await call(
    context,
    WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
    {
      root,
      mode: "preview",
      todoId: intake.publication.todoId,
      demand: {
        title: "Scenario acceptance demand",
        goal: "Implement the confirmed requirement through the new TS chain.",
        completionDefinition: "The confirmed implementation and focused checks are accepted.",
        executionPlacement: { mode: "main" },
      },
    },
  );
  const demandPlan = demandPreview.structuredContent as PreviewPlan;
  const demandApplied = await call(
    context,
    WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
    { root, mode: "apply", plan: demandPlan.plan, planDigest: demandPlan.planDigest },
  );
  assertNoPrivatePath(context, demandApplied);
  const demand = demandApplied.structuredContent as {
    readonly publication: { readonly demandId: string };
  };
  context.demandId = demand.publication.demandId;

  const route = await routeFrontiers(context);
  equal(route.disposition, "work-available");
  equal(route.kinds.includes("implementation-task-planning"), true);
  return `todo+demand published; route=${route.disposition}:${route.kinds.join("+")}`;
}

async function routeFrontiers(context: ScenarioContext) {
  const routeCall = await call(
    context,
    WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
    { root: context.workspace.workspacePath, demandId: context.demandId },
  );
  assertNoPrivatePath(context, routeCall);
  const route = routeCall.structuredContent as {
    readonly route: {
      readonly disposition: string;
      readonly frontiers: readonly { readonly kind: string }[];
    };
  };
  return {
    disposition: route.route.disposition,
    kinds: route.route.frontiers.map((frontier) => frontier.kind),
  };
}

async function scenarioPlanImplementationTask(
  context: ScenarioContext,
): Promise<string> {
  const root = context.workspace.workspacePath;
  if (!context.demandId || !context.memberRefs || !context.repositoryId || !context.productWindowId) {
    throw new Error("scenario ordering: create-demand must run first");
  }
  const demandRoot = path.join(root, ".wakeflow-active", "current");
  const request = {
    root,
    demandId: context.demandId,
    idempotencyKey: "scenario-plan-1",
    expectedStreamRevision: 1,
    taskPackage: {
      assignment: {
        repositoryId: context.repositoryId,
        windowId: context.productWindowId,
      },
      workType: "implementation",
      objective: "实现场景验收需求的最小切片",
      confirmedContext: ["Demand 权威已发布", "本轮只规划任务，不执行投递"],
      selectedAuthorityMemberRefs: [...context.memberRefs],
      boundaries: {
        inScope: ["按需求设计实现最小切片"],
        outOfScope: ["投递与宿主效果"],
        forbidden: ["直接调用宿主发送能力"],
      },
      completionExpectations: ["聚焦检查通过", "结果按合同回报"],
      commitExpectation: "leave-uncommitted",
      acceptanceAnchors: [{
        anchorId: "scenario-slice",
        claim: "最小切片满足需求设计",
        probe: "运行聚焦检查",
        expected: "检查通过且无越界改动",
      }],
    },
  };
  const committed = await call(context, WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME, request);
  assertNoPrivatePath(context, committed);
  const result = committed.structuredContent as {
    readonly status: string;
    readonly targetTask: { readonly phase: string };
    readonly next: { readonly frontier: string | null; readonly suggestedTool: string | null };
  };
  equal(result.status, "committed");
  equal(result.targetTask.phase, "planned");
  equal(result.next.frontier, "implementation-delivery-planning");
  const afterCommit = readdirSync(demandRoot, { recursive: true }).length;
  const replayed = await call(context, WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME, request);
  const replay = replayed.structuredContent as { readonly status: string };
  equal(replay.status, "idempotent");
  equal(readdirSync(demandRoot, { recursive: true }).length, afterCommit, "replay wrote");
  const route = await routeFrontiers(context);
  equal(route.kinds.includes("implementation-delivery-planning"), true);
  return `append=${result.status}; replay=${replay.status}; next=${result.next.suggestedTool}`;
}

const SCENARIO_RUNNERS: Readonly<
  Record<string, (context: ScenarioContext) => Promise<string>>
> = Object.freeze({
  "card-01/fresh-initialize": scenarioFreshInitialize,
  "card-04/create-demand": scenarioCreateDemand,
  "card-05/plan-implementation-task": scenarioPlanImplementationTask,
});

test("场景验收骨架在一次性工作区上运行初始化、创建 Demand、规划任务并报告结论", async () => {
  const workspace = createScenarioWorkspace();
  const connection = await connectWakeflowMcpServerForTest(
    createCodexWakeflowMcpServer("1.0.0-scenario"),
  );
  const context: ScenarioContext = { workspace, connection };
  const outcomes: ScenarioOutcome[] = [];
  let blocked = false;
  try {
    for (const scenario of SCENARIO_CATALOG) {
      const runner = SCENARIO_RUNNERS[scenario.scenarioId];
      if (runner === undefined) {
        outcomes.push({ ...scenario, verdict: "not-run", evidence: "no runner" });
        continue;
      }
      if (blocked) {
        outcomes.push({ ...scenario, verdict: "not-run", evidence: "earlier scenario failed" });
        continue;
      }
      try {
        const evidence = await runner(context);
        outcomes.push({ ...scenario, verdict: "pass", evidence });
      } catch (error: unknown) {
        blocked = true;
        const message = error instanceof Error ? error.message : String(error);
        outcomes.push({
          ...scenario,
          verdict: "defect",
          evidence: message.split(workspace.fixtureRoot).join("<workspace>").slice(0, 200),
        });
      }
    }
  } finally {
    await connection.close();
    cleanupScenarioWorkspace(workspace);
  }
  const report = renderScenarioReport(outcomes);
  process.stdout.write(`\n${report}\n`);
  equal(report.includes(workspace.fixtureRoot), false);
  equal(
    outcomes.every((outcome) => outcome.verdict === "pass"),
    true,
    `scenario acceptance did not fully pass:\n${report}`,
  );
});
