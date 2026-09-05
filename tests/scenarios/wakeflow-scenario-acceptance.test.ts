import { equal } from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { CallToolResult } from "@modelcontextprotocol/client";

import { parseWakeflowConfigV3 } from "../../src/configuration/wakeflow-config-v3.js";
import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME } from "../../src/governance/controller/demand-controller-route-public-contract.js";
import { WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/demand/publication/demand-publication-public-contract.js";
import { WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME } from "../../src/governance/tasking/target-task-planning-public-contract.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME } from "../../src/capabilities/endpoint/contract.js";
import {
  WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME,
  WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/requirement/contract.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../src/capabilities/workspace/maintain-workspace.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../src/foundation/time/utc-instant.js";
import { writeHostHookObservation } from "../../src/kernel/hook-observations.js";
import { createMinimalWakeflowFreshConfigSelection } from "../configuration/wakeflow-fresh-config-selection.fixture.js";
import {
  FIXTURE_LANDING_MARKDOWN,
  FIXTURE_REQUIREMENT_MARKDOWN,
} from "../governance/ledger/requirement-package.fixture.js";
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
 * 六个场景在同一个一次性工作区上顺序运行：初始化 → 窗口握手 → 窗口替换 → 需求包 → 创建 Demand → 规划任务。
 * 所有调用都经过公共 MCP 工具，即 Agent 真实使用的入口；宿主效果不在本骨架内。
 */

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
  requirementId?: string;
  requirementStateDigest?: string;
  demandId?: string;
  productBinding?: { readonly bindingId: string; readonly bindingDigest: string };
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

function assertNoPrivatePath(context: ScenarioContext, result: CallToolResult): void {
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
  const design = config.topology.supportSurfaces.find((surface) => surface.capability === "design");
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

interface BindingMutation {
  readonly kind: string;
  readonly disposition: string;
  readonly binding: { readonly bindingId: string; readonly bindingDigest: string } | null;
  readonly next: { readonly frontier: string | null };
}

/** Agent 在宿主里启动窗口后，宿主 hook 会留下 session-start 记录；这里代替宿主写入。 */
async function recordSessionStart(context: ScenarioContext, sessionId: string, placement: string) {
  const root = await RootedDirectory.open(context.workspace.workspacePath);
  try {
    await writeHostHookObservation(root, {
      hostId: "codex",
      event: "session-start",
      sessionId,
      cwd: path.resolve(context.workspace.workspacePath, placement),
      recordedAt: parseUtcInstant(new Date().toISOString()),
    });
  } finally {
    await root.close();
  }
}

async function scenarioWindowHandshake(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (!context.productWindowId)
    throw new Error("scenario ordering: fresh-initialize must run first");
  const inspected = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root,
    operation: "inspect",
    windowId: context.productWindowId,
  });
  assertNoPrivatePath(context, inspected);
  const inspection = inspected.structuredContent as {
    readonly binding: { readonly status: string };
    readonly launchIntent: {
      readonly intentDigest: string;
      readonly root: { readonly configuredPlacement: string };
      readonly execution: { readonly kind: string; readonly tool: string };
    };
    readonly next: { readonly frontier: string | null };
  };
  equal(inspection.binding.status, "unregistered");
  equal(inspection.launchIntent.execution.kind, "codex");
  equal(inspection.launchIntent.execution.tool, "create_thread");
  equal(inspection.next.frontier, "window-registration");
  const handle = { kind: "codex-thread", value: "codex-host-owned-thread:scenario-1" };
  await recordSessionStart(context, handle.value, inspection.launchIntent.root.configuredPlacement);
  const observation = {
    handle,
    launchIntentDigest: inspection.launchIntent.intentDigest,
    observedAt: new Date().toISOString(),
  };
  const registered = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root,
    operation: "register",
    windowId: context.productWindowId,
    observation,
  });
  assertNoPrivatePath(context, registered);
  const mutation = registered.structuredContent as BindingMutation;
  equal(mutation.disposition, "registered");
  equal(
    JSON.stringify(registered.structuredContent).includes(handle.value),
    false,
    "raw handle leaked",
  );
  if (mutation.binding === null) throw new Error("registered binding missing");
  const replayed = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root,
    operation: "register",
    windowId: context.productWindowId,
    observation,
  });
  const replay = replayed.structuredContent as BindingMutation;
  equal(replay.disposition, "replayed");
  equal(replay.binding?.bindingId, mutation.binding.bindingId);
  const projection = readFileSync(
    path.join(
      root,
      ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
      `${context.productWindowId}.json`,
    ),
    "utf8",
  );
  equal(projection.includes('"status": "registered"'), true);
  equal(projection.includes(handle.value), false, "projection leaked the raw handle");
  context.productBinding = mutation.binding;
  return `inspect=${inspection.binding.status}; register=${mutation.disposition}; replay=${replay.disposition}; next=${mutation.next.frontier}`;
}

async function scenarioWindowReplace(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (!context.productWindowId || !context.productBinding) {
    throw new Error("scenario ordering: window-handshake must run first");
  }
  const inspected = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root,
    operation: "inspect",
    windowId: context.productWindowId,
  });
  const inspection = inspected.structuredContent as {
    readonly launchIntent: {
      readonly intentDigest: string;
      readonly root: { readonly configuredPlacement: string };
    };
  };
  const handle = { kind: "codex-thread", value: "codex-host-owned-thread:scenario-2" };
  await recordSessionStart(context, handle.value, inspection.launchIntent.root.configuredPlacement);
  const stale = await context.connection.client.callTool({
    name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    arguments: {
      root,
      operation: "replace",
      windowId: context.productWindowId,
      observation: {
        handle,
        launchIntentDigest: inspection.launchIntent.intentDigest,
        observedAt: new Date().toISOString(),
      },
      expectedBindingId: context.productBinding.bindingId,
      expectedBindingDigest: `sha256:${"0".repeat(64)}`,
    },
  });
  equal(stale.isError, true, "stale binding expectation must be rejected");
  const replaced = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root,
    operation: "replace",
    windowId: context.productWindowId,
    observation: {
      handle,
      launchIntentDigest: inspection.launchIntent.intentDigest,
      observedAt: new Date().toISOString(),
    },
    expectedBindingId: context.productBinding.bindingId,
    expectedBindingDigest: context.productBinding.bindingDigest,
  });
  assertNoPrivatePath(context, replaced);
  const mutation = replaced.structuredContent as BindingMutation;
  equal(mutation.disposition, "replaced");
  if (mutation.binding === null) throw new Error("replaced binding missing");
  equal(
    mutation.binding.bindingId === context.productBinding.bindingId,
    false,
    "binding generation did not change",
  );
  const bindingFile = readFileSync(
    path.join(
      root,
      ".wakeflow-local/runtime/hosts/codex/identity/window-bindings",
      `${context.productWindowId}.json`,
    ),
    "utf8",
  );
  equal(bindingFile.includes(handle.value), true);
  equal(bindingFile.includes("scenario-1"), false, "old generation still on disk");
  context.productBinding = mutation.binding;
  return `stale-cas=rejected; replace=${mutation.disposition}; generation changed`;
}

interface PublicationPreview {
  readonly status: string;
  readonly blockers: readonly string[];
  readonly planDigest: string | null;
  readonly requirementId: string | null;
  readonly summary: { readonly sections: readonly { readonly anchor: string }[] } | null;
  readonly next: { readonly frontier: string | null };
}

async function scenarioRequirementPackage(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (!context.designSurfaceId || !context.designWindowId || !context.designPath) {
    throw new Error("scenario ordering: fresh-initialize must run first");
  }
  mkdirSync(path.join(context.designPath, "drafts"), { recursive: true });
  writeFileSync(
    path.join(context.designPath, "drafts", "requirement.md"),
    FIXTURE_REQUIREMENT_MARKDOWN,
    { mode: 0o644 },
  );
  writeFileSync(path.join(context.designPath, "drafts", "landing.md"), FIXTURE_LANDING_MARKDOWN, {
    mode: 0o644,
  });
  const packageInput = {
    designSurfaceId: context.designSurfaceId,
    title: "Scenario acceptance requirement",
    demandType: "requirement",
    priority: "P1",
    originWindowId: context.designWindowId,
    testingDecision: {
      mode: "controller-only",
      summary: "Controller validates focused implementation checks.",
    },
    requirementPath: "drafts/requirement.md",
    landingPath: "drafts/landing.md",
  };
  const blocked = await call(context, WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "preview",
    action: "publish",
    package: packageInput,
  });
  assertNoPrivatePath(context, blocked);
  const blockedPreview = blocked.structuredContent as PublicationPreview;
  equal(blockedPreview.status, "blocked");
  equal(blockedPreview.blockers.includes("user-confirmation-missing"), true);
  equal(blockedPreview.next.frontier, "requirement-confirmation");
  equal((blockedPreview.summary?.sections.length ?? 0) > 0, true, "preview summary is empty");
  const confirmed = { ...packageInput, confirmation: { confirmedAt: new Date().toISOString() } };
  const before = readdirSync(root).sort();
  const ready = await call(context, WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "preview",
    action: "publish",
    package: confirmed,
  });
  const readyPreview = ready.structuredContent as PublicationPreview;
  equal(readyPreview.status, "ready");
  if (readyPreview.planDigest === null) throw new Error("ready preview lacks a plan digest");
  equal(readdirSync(root).sort().join(","), before.join(","), "preview wrote");
  const applied = await call(context, WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "apply",
    action: "publish",
    package: confirmed,
    planDigest: readyPreview.planDigest,
  });
  assertNoPrivatePath(context, applied);
  const mutation = applied.structuredContent as {
    readonly disposition: string;
    readonly package: {
      readonly requirementId: string;
      readonly status: string;
      readonly stateDigest: string;
    };
    readonly next: { readonly frontier: string | null; readonly suggestedTool: string | null };
  };
  equal(mutation.disposition, "published");
  equal(mutation.package.status, "pending");
  equal(mutation.next.frontier, "requirement-claim");
  const board = await call(context, WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME, {
    root,
    view: "list",
  });
  assertNoPrivatePath(context, board);
  const list = board.structuredContent as {
    readonly counts: { readonly pending: number };
    readonly packages: readonly { readonly requirementId: string; readonly status: string }[];
  };
  equal(list.counts.pending, 1);
  equal(list.packages[0]?.requirementId, mutation.package.requirementId);
  equal(
    existsSync(
      path.join(root, "Ledger", "requirements", mutation.package.requirementId, "record.json"),
    ),
    true,
  );
  context.requirementId = mutation.package.requirementId;
  context.requirementStateDigest = mutation.package.stateDigest;
  return `preview=blocked:${blockedPreview.blockers.length}; ready; apply=${mutation.disposition}; board pending=${list.counts.pending}`;
}

async function scenarioCreateDemand(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (!context.requirementId)
    throw new Error("scenario ordering: requirement-package must run first");
  const demandPreview = await call(context, WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "preview",
    requirementId: context.requirementId,
    demand: {
      title: "Scenario acceptance demand",
      goal: "Implement the confirmed requirement through the new TS chain.",
      completionDefinition: "The confirmed implementation and focused checks are accepted.",
      executionPlacement: { mode: "main" },
    },
  });
  const demandPlan = demandPreview.structuredContent as PreviewPlan;
  const demandApplied = await call(context, WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "apply",
    plan: demandPlan.plan,
    planDigest: demandPlan.planDigest,
  });
  assertNoPrivatePath(context, demandApplied);
  const demand = demandApplied.structuredContent as {
    readonly publication: {
      readonly demandId: string;
      readonly claim: { readonly requirementId: string; readonly stateRevision: number };
    };
  };
  context.demandId = demand.publication.demandId;
  equal(demand.publication.claim.requirementId, context.requirementId);
  equal(demand.publication.claim.stateRevision, 2);
  const board = await call(context, WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME, {
    root,
    view: "package",
    requirementId: context.requirementId,
  });
  const view = board.structuredContent as {
    readonly package: {
      readonly status: string;
      readonly claim: { readonly demandId: string } | null;
    };
    readonly record: { readonly sections: readonly { readonly anchor: string }[] };
  };
  equal(view.package.status, "claimed");
  equal(view.package.claim?.demandId, context.demandId);
  context.memberRefs = [
    `requirements/${context.requirementId}/requirement.md`,
    `requirements/${context.requirementId}/landing.md`,
  ];
  const route = await routeFrontiers(context);
  equal(route.disposition, "work-available");
  equal(route.kinds.includes("implementation-task-planning"), true);
  return `claim=claimed rev2; route=${route.disposition}:${route.kinds.join("+")}`;
}

async function routeFrontiers(context: ScenarioContext) {
  const routeCall = await call(context, WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME, {
    root: context.workspace.workspacePath,
    demandId: context.demandId,
  });
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

async function scenarioPlanImplementationTask(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (
    !context.demandId ||
    !context.memberRefs ||
    !context.repositoryId ||
    !context.productWindowId
  ) {
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
      acceptanceAnchors: [
        {
          anchorId: "scenario-slice",
          claim: "最小切片满足需求设计",
          probe: "运行聚焦检查",
          expected: "检查通过且无越界改动",
        },
      ],
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

const SCENARIO_RUNNERS: Readonly<Record<string, (context: ScenarioContext) => Promise<string>>> =
  Object.freeze({
    "card-01/fresh-initialize": scenarioFreshInitialize,
    "card-02/window-handshake": scenarioWindowHandshake,
    "card-02/window-replace": scenarioWindowReplace,
    "card-03/requirement-package": scenarioRequirementPackage,
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
