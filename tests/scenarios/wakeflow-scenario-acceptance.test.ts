import { equal } from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { CallToolResult } from "@modelcontextprotocol/client";

import { parseWakeflowConfigV3 } from "../../src/configuration/wakeflow-config-v3.js";
import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import {
  WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_ROUTE_INSPECTION_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/demand/contract.js";
import {
  WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
  WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/delivery/contract.js";
import { computeDeliveryPromptDigest } from "../../src/governance/delivery/delivery-envelope.js";
import { workClaimRef } from "../../src/kernel/layout.js";
import { DemandEventSourcingRepository } from "../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../src/governance/demand/publication/demand-publication-paths.js";
import { WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME } from "../../src/governance/result/target-result-import-public-contract.js";
import type { TaskPackage } from "../../src/governance/tasking/task-package.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-implementation-review-decision-public-contract.js";
import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-test-review-decision-public-contract.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME } from "../../src/governance/review/target-result-review-inspection-public-contract.js";
import { createImplementationTargetResultReportContentFixture } from "../governance/result/implementation-target-result-report.fixture.js";
import { controllerImplementationReviewDecisionInput } from "../governance/review/controller-implementation-review-decision.fixture.js";
import { WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME } from "../../src/capabilities/tasking/contract.js";
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
 * 十一个场景在同一个一次性工作区上顺序运行：初始化 → 窗口握手 → 窗口替换 → 需求包 → 创建 Demand →
 * 规划任务 → 投递准备与 indeterminate 结局 → 落地证据后 accepted → 实现接受后规划测试合同、投递测试并
 * 由 Controller 审查接受 → 完成即归档 → 续接与取消。所有调用都经过公共 MCP 工具，即 Agent 真实使用的入口；
 * 宿主效果不在本骨架内。
 */

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
  recordDigest?: string;
  demandId?: string;
  productBinding?: { readonly bindingId: string; readonly bindingDigest: string };
  productHandle?: string;
  targetTaskId?: string;
  taskPackageId?: string;
  delivery?: DeliveryPermit | undefined;
  deliveryAccepted?: boolean;
  targetAccepted?: boolean;
  testWindowId?: string;
  testHandle?: string;
  testTargetTaskId?: string;
}

interface DeliveryPermit {
  readonly deliveryId: string;
  readonly claimId: string;
  readonly claimDigest: string;
  readonly prompt: string;
  readonly issuedAt: string;
  readonly streamRevision: number;
}

interface OutcomeResult {
  readonly status: string;
  readonly outcome: {
    readonly disposition: string;
    readonly evidenceKind: string;
    readonly claimHandling: string;
  };
  readonly target: { readonly phase: string };
  readonly event: { readonly streamRevision: number };
  readonly next: {
    readonly frontier: string | null;
    readonly owner: string | null;
    readonly blockers: readonly string[];
  };
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
  const testWindow = config.topology.windows.find((w) => w.role === "test");
  const repository = config.topology.repositories[0];
  if (!design || !designWindow || !productWindow || !testWindow || !repository) {
    throw new Error("fresh config lacks the expected topology");
  }
  context.designSurfaceId = design.surfaceId;
  context.designWindowId = designWindow.windowId;
  context.productWindowId = productWindow.windowId;
  context.testWindowId = testWindow.windowId;
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
  context.productHandle = handle.value;
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
      mode: "real-environment",
      summary: "Controller validates focused checks, then a test window runs the test contract.",
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
  const demandRequest = {
    root,
    requirementId: context.requirementId,
    demand: {
      title: "Scenario acceptance demand",
      goal: "Implement the confirmed requirement through the new TS chain.",
      completionDefinition: "The confirmed implementation and focused checks are accepted.",
      executionPlacement: { mode: "main" },
    },
  };
  const demandPreview = await call(context, WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME, {
    ...demandRequest,
    mode: "preview",
  });
  const demandPlan = demandPreview.structuredContent as {
    readonly status: string;
    readonly planDigest: string;
    readonly demandId: string;
  };
  equal(demandPlan.status, "ready");
  const demandApplied = await call(context, WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME, {
    ...demandRequest,
    mode: "apply",
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
      readonly recordDigest: string;
      readonly claim: { readonly demandId: string } | null;
    };
    readonly record: { readonly sections: readonly { readonly anchor: string }[] };
  };
  equal(view.package.status, "claimed");
  equal(view.package.claim?.demandId, context.demandId);
  context.recordDigest = view.package.recordDigest;
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
  const routeCall = await call(context, WAKEFLOW_DEMAND_ROUTE_INSPECTION_PUBLIC_TOOL_NAME, {
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
    !context.productWindowId ||
    !context.recordDigest
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
          requirementRef: {
            recordDigest: context.recordDigest,
            sectionAnchor: "acceptance-criteria",
            itemId: "ac-1",
          },
        },
      ],
      lineage: null,
      sectionAnchors: ["goal"],
    },
  };
  const invented = await context.connection.client.callTool({
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    arguments: {
      ...request,
      idempotencyKey: "scenario-plan-invented",
      taskPackage: {
        ...request.taskPackage,
        acceptanceAnchors: [
          {
            ...request.taskPackage.acceptanceAnchors[0],
            requirementRef: {
              ...request.taskPackage.acceptanceAnchors[0]?.requirementRef,
              itemId: "ac-9",
            },
          },
        ],
      },
    },
  });
  equal(invented.isError, true, "an invented acceptance anchor must be rejected");
  const committed = await call(context, WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME, request);
  assertNoPrivatePath(context, committed);
  const result = committed.structuredContent as {
    readonly status: string;
    readonly targetTask: {
      readonly phase: string;
      readonly targetTaskId: string;
      readonly taskPackageId: string;
    };
    readonly next: { readonly frontier: string | null; readonly suggestedTool: string | null };
  };
  equal(result.status, "committed");
  equal(result.targetTask.phase, "planned");
  equal(result.next.frontier, "implementation-delivery-planning");
  // 同仓库第二个包必须声明 replacement：旧目标进入 superseded，后续投递、评审与完成只针对新目标。
  const replacementRequest = {
    ...request,
    idempotencyKey: "scenario-plan-replacement",
    expectedStreamRevision: 2,
    taskPackage: {
      ...request.taskPackage,
      objective: "改按更小的切片实现场景验收需求",
      lineage: { kind: "replacement", replacesTargetTaskId: result.targetTask.targetTaskId },
    },
  };
  const replaced = await call(
    context,
    WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    replacementRequest,
  );
  assertNoPrivatePath(context, replaced);
  const replacement = replaced.structuredContent as typeof result & {
    readonly targetTask: { readonly lineage: { readonly replacesTargetTaskId?: string } | null };
  };
  equal(replacement.status, "committed");
  equal(replacement.targetTask.phase, "planned");
  equal(replacement.targetTask.lineage?.replacesTargetTaskId, result.targetTask.targetTaskId);
  context.targetTaskId = replacement.targetTask.targetTaskId;
  context.taskPackageId = replacement.targetTask.taskPackageId;
  const afterCommit = readdirSync(demandRoot, { recursive: true }).length;
  const replayed = await call(
    context,
    WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    replacementRequest,
  );
  const replay = replayed.structuredContent as { readonly status: string };
  equal(replay.status, "idempotent");
  equal(readdirSync(demandRoot, { recursive: true }).length, afterCommit, "replay wrote");
  const route = await routeFrontiers(context);
  equal(route.kinds.includes("implementation-delivery-planning"), true);
  return `invented-anchor=rejected; append=${result.status}; replacement=${replacement.status}; replay=${replay.status}; next=${replacement.next.suggestedTool}`;
}

interface RouteInspection {
  readonly status: string;
  readonly route?: {
    readonly lifecycle: string;
    readonly disposition: string;
    readonly frontiers: readonly { readonly kind: string }[];
    readonly observedEventStream: { readonly streamRevision: number };
  };
  readonly archive?: { readonly outcome: string; readonly archiveRef: string };
  readonly next: { readonly frontier: string | null; readonly suggestedTool: string | null };
}

async function inspectRoute(context: ScenarioContext): Promise<RouteInspection> {
  const call_ = await call(context, WAKEFLOW_DEMAND_ROUTE_INSPECTION_PUBLIC_TOOL_NAME, {
    root: context.workspace.workspacePath,
    demandId: context.demandId,
  });
  assertNoPrivatePath(context, call_);
  return call_.structuredContent as RouteInspection;
}

async function boardPackageStatus(context: ScenarioContext): Promise<string> {
  const board = await call(context, WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME, {
    root: context.workspace.workspacePath,
    view: "package",
    requirementId: context.requirementId,
  });
  return (board.structuredContent as { readonly package: { readonly status: string } }).package
    .status;
}

async function currentStreamRevision(context: ScenarioContext): Promise<number> {
  const route = await inspectRoute(context);
  const revision = route.route?.observedEventStream.streamRevision;
  if (revision === undefined) throw new Error("expected an active route with a stream revision");
  return revision;
}

/** Controller 一次调用准备投递：取得声明、追加信封、拿到许可；宿主发送不在这里。 */
async function prepareDelivery(
  context: ScenarioContext,
  idempotencyKey: string,
  expectedStreamRevision: number,
  targetTaskId = context.targetTaskId,
): Promise<{ readonly status: string; readonly permit: DeliveryPermit }> {
  if (!context.demandId || !targetTaskId) {
    throw new Error("scenario ordering: plan-implementation-task must run first");
  }
  const prepared = await call(context, WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME, {
    root: context.workspace.workspacePath,
    demandId: context.demandId,
    idempotencyKey,
    expectedStreamRevision,
    targetTaskId,
    authored: {
      goal: "按任务包完成本轮工作，只动分配给你的范围。",
      focus: ["先读任务包与需求锚点", "验证通过后再回写结果"],
      boundary: "不触碰其他仓库；不自行提交。",
    },
    language: "en",
  });
  assertNoPrivatePath(context, prepared);
  const body = prepared.structuredContent as {
    readonly status: string;
    readonly delivery: { readonly deliveryId: string };
    readonly permit: {
      readonly prompt: string;
      readonly hostAction: { readonly effect: string };
      readonly fence: {
        readonly claimId: string;
        readonly claimDigest: string;
        readonly streamRevision: number;
      };
      readonly issuedAt: string;
    };
  };
  equal(body.permit.hostAction.effect, "send-prompt-to-window");
  return {
    status: body.status,
    permit: {
      deliveryId: body.delivery.deliveryId,
      claimId: body.permit.fence.claimId,
      claimDigest: body.permit.fence.claimDigest,
      prompt: body.permit.prompt,
      issuedAt: body.permit.issuedAt,
      streamRevision: body.permit.fence.streamRevision,
    },
  };
}

/** 目标窗口收到 prompt 后，宿主 hook 会留下 user-prompt-submit 记录；这里代替宿主写入。 */
async function landPrompt(
  context: ScenarioContext,
  prompt: string,
  windowId = context.productWindowId,
  handle = context.productHandle,
): Promise<void> {
  if (!windowId || !handle) {
    throw new Error("scenario ordering: window-handshake must run first");
  }
  const inspected = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root: context.workspace.workspacePath,
    operation: "inspect",
    windowId,
  });
  const placement = (
    inspected.structuredContent as {
      readonly launchIntent: { readonly root: { readonly configuredPlacement: string } };
    }
  ).launchIntent.root.configuredPlacement;
  const root = await RootedDirectory.open(context.workspace.workspacePath);
  try {
    await writeHostHookObservation(root, {
      hostId: "codex",
      event: "user-prompt-submit",
      sessionId: handle,
      cwd: path.resolve(context.workspace.workspacePath, placement),
      recordedAt: parseUtcInstant(new Date().toISOString()),
      promptDigest: computeDeliveryPromptDigest(prompt),
    });
  } finally {
    await root.close();
  }
}

/** Agent 记录一次发送尝试；处置由 Wakeflow 按证据派生，而不是由 Agent 宣称。 */
async function recordOutcome(
  context: ScenarioContext,
  permit: DeliveryPermit,
  idempotencyKey: string,
): Promise<OutcomeResult> {
  if (!context.demandId) throw new Error("scenario ordering: create-demand must run first");
  const recorded = await call(context, WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME, {
    root: context.workspace.workspacePath,
    demandId: context.demandId,
    idempotencyKey,
    expectedStreamRevision: await currentStreamRevision(context),
    deliveryId: permit.deliveryId,
    claimDigest: permit.claimDigest,
    attempt: { status: "sent" },
    readback: { status: "pending" },
    observedAt: new Date(Math.max(Date.now(), Date.parse(permit.issuedAt) + 1)).toISOString(),
  });
  assertNoPrivatePath(context, recorded);
  return recorded.structuredContent as OutcomeResult;
}

async function scenarioDeliveryChain(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (!context.productWindowId)
    throw new Error("scenario ordering: window-handshake must run first");
  const before = await inspectRoute(context);
  equal(before.route?.frontiers[0]?.kind, "implementation-delivery-planning");
  const expectedStreamRevision = await currentStreamRevision(context);
  const prepared = await prepareDelivery(context, "scenario-prepare-1", expectedStreamRevision);
  equal(prepared.status, "committed");
  equal(prepared.permit.prompt.includes(context.workspace.fixtureRoot), false);
  equal(prepared.permit.prompt.includes(prepared.permit.deliveryId), true);
  equal(prepared.permit.prompt.includes(prepared.permit.claimDigest), true);
  equal(existsSync(path.join(root, ...workClaimRef(context.productWindowId).split("/"))), true);
  const afterPrepare = await inspectRoute(context);
  equal(afterPrepare.route?.frontiers[0]?.kind, "implementation-host-effect-execution");
  const replayed = await prepareDelivery(context, "scenario-prepare-1", expectedStreamRevision);
  equal(replayed.status, "idempotent");
  equal(replayed.permit.deliveryId, prepared.permit.deliveryId);
  equal(replayed.permit.claimDigest, prepared.permit.claimDigest);

  // 发送已发出但目标会话还没有留下记录：结局是 indeterminate，声明保留，等待证据。
  const indeterminate = await recordOutcome(context, prepared.permit, "scenario-outcome-1");
  equal(indeterminate.status, "recorded");
  equal(indeterminate.outcome.disposition, "indeterminate");
  equal(indeterminate.outcome.claimHandling, "retain");
  equal(indeterminate.target.phase, "host-effect-indeterminate");
  equal(indeterminate.next.blockers.includes("landing-evidence-missing"), true);
  equal(existsSync(path.join(root, ...workClaimRef(context.productWindowId).split("/"))), true);
  context.delivery = prepared.permit;
  context.deliveryAccepted = false;
  return `prepare=${prepared.status}; replay=${replayed.status}; outcome=${indeterminate.outcome.disposition}; claim=${indeterminate.outcome.claimHandling}`;
}

async function scenarioAmbiguousResolution(context: ScenarioContext): Promise<string> {
  if (!context.delivery) throw new Error("scenario ordering: delivery-chain must run first");
  await landPrompt(context, context.delivery.prompt);
  const accepted = await recordOutcome(context, context.delivery, "scenario-outcome-2");
  equal(accepted.status, "recorded");
  equal(accepted.outcome.disposition, "accepted");
  equal(accepted.outcome.evidenceKind, "hook-record");
  equal(accepted.outcome.claimHandling, "retain");
  equal(accepted.target.phase, "host-effect-accepted");
  equal(accepted.next.frontier, "implementation-target-result-import");
  const route = await inspectRoute(context);
  equal(route.route?.frontiers[0]?.kind, "implementation-target-result-import");
  context.deliveryAccepted = true;
  return `outcome=${accepted.outcome.disposition}; evidence=${accepted.outcome.evidenceKind}; route=${route.route?.frontiers[0]?.kind}`;
}

/** 卡 7 的工具链把已 accepted 的投递推到评审 accept；未投递时先走完整投递链；已接受则不再动。 */
async function driveTargetToAcceptance(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (
    !context.demandId ||
    !context.targetTaskId ||
    !context.taskPackageId ||
    !context.productWindowId
  ) {
    throw new Error("scenario ordering: plan-implementation-task must run first");
  }
  if (context.targetAccepted === true) return "implementation already accepted";
  if (!context.delivery || context.deliveryAccepted !== true) {
    const revision = await currentStreamRevision(context);
    const prepared = await prepareDelivery(context, `scenario-prepare-r${revision}`, revision);
    await landPrompt(context, prepared.permit.prompt);
    const accepted = await recordOutcome(context, prepared.permit, `scenario-outcome-r${revision}`);
    equal(accepted.outcome.disposition, "accepted");
    context.delivery = prepared.permit;
    context.deliveryAccepted = true;
  }
  const permit = context.delivery;
  const demandRoot = await RootedDirectory.open(
    path.join(root, ...demandFinalRootRef(context.demandId).split("/")),
  );
  let taskPackage: TaskPackage;
  try {
    const planned = await new DemandEventSourcingRepository(demandRoot).findTargetTaskPlannedEvent(
      context.taskPackageId,
    );
    if (planned === null) throw new Error("planned task package missing");
    taskPackage = planned.event.data.taskPackage;
  } finally {
    await demandRoot.close();
  }
  const imported = await call(context, WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME, {
    root,
    demandId: context.demandId,
    deliveryId: permit.deliveryId,
    claimDigest: permit.claimDigest,
    report: {
      workType: "implementation",
      content: createImplementationTargetResultReportContentFixture(taskPackage),
    },
  });
  assertNoPrivatePath(context, imported);
  const importStatus = (imported.structuredContent as { readonly status: string }).status;
  equal(existsSync(path.join(root, ...workClaimRef(context.productWindowId).split("/"))), false);
  const inspectionCall = await call(
    context,
    WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    { root, demandId: context.demandId, targetTaskId: context.targetTaskId },
  );
  const inspection = inspectionCall.structuredContent as {
    readonly snapshotDigest: string;
    readonly reviewUnit: {
      readonly reviewUnitDigest: string;
      readonly targetResult: { readonly targetResultId: string };
    };
  };
  const judgment = controllerImplementationReviewDecisionInput("accept");
  const decided = await call(
    context,
    WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    {
      root,
      demandId: context.demandId,
      targetResultId: inspection.reviewUnit.targetResult.targetResultId,
      snapshotDigest: inspection.snapshotDigest,
      reviewUnitDigest: inspection.reviewUnit.reviewUnitDigest,
      decision: judgment.decision,
      assessment: judgment.assessment,
      independentChecks: judgment.independentChecks,
      rationale: judgment.rationale,
      blockingReasons: judgment.blockingReasons,
      residualRisks: judgment.residualRisks,
    },
  );
  const decision = decided.structuredContent as { readonly status: string };
  equal(decision.status, "decided");
  context.delivery = undefined;
  context.deliveryAccepted = false;
  context.targetAccepted = true;
  return `import=${importStatus}; review=${decision.status}`;
}

/** 测试窗口的握手：Agent 启动窗口留下 session-start 记录后登记私有绑定（卡 2 的同一条链）。 */
async function registerTestWindow(context: ScenarioContext): Promise<void> {
  const root = context.workspace.workspacePath;
  if (!context.testWindowId) throw new Error("scenario ordering: fresh-initialize must run first");
  const inspected = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root,
    operation: "inspect",
    windowId: context.testWindowId,
  });
  const inspection = inspected.structuredContent as {
    readonly launchIntent: {
      readonly intentDigest: string;
      readonly root: { readonly configuredPlacement: string };
    };
  };
  const handle = { kind: "codex-thread", value: "codex-host-owned-thread:scenario-test" };
  await recordSessionStart(context, handle.value, inspection.launchIntent.root.configuredPlacement);
  const registered = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root,
    operation: "register",
    windowId: context.testWindowId,
    observation: {
      handle,
      launchIntentDigest: inspection.launchIntent.intentDigest,
      observedAt: new Date().toISOString(),
    },
  });
  equal((registered.structuredContent as BindingMutation).disposition, "registered");
  context.testHandle = handle.value;
}

/**
 * 卡 5 修订 5.2：实现接受后 Controller 撰写测试合同追加 test 任务包，Wakeflow 派生窗口、环境与基线；
 * 测试投递、逐步证据导入与 Controller 测试审查走同一批公共工具，接受后 Route 到完成预检。
 */
async function scenarioTestContract(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (!context.demandId || !context.memberRefs || !context.recordDigest || !context.testWindowId) {
    throw new Error("scenario ordering: create-demand must run first");
  }
  const chain = await driveTargetToAcceptance(context);
  const afterAccept = await inspectRoute(context);
  equal(afterAccept.route?.frontiers[0]?.kind, "test-task-planning");
  await registerTestWindow(context);
  const revision = await currentStreamRevision(context);
  const requirementRef = (itemId: string) => ({
    recordDigest: context.recordDigest,
    sectionAnchor: "acceptance-criteria",
    itemId,
  });
  const request = {
    root,
    demandId: context.demandId,
    idempotencyKey: "scenario-test-plan-1",
    expectedStreamRevision: revision,
    taskPackage: {
      workType: "test",
      objective: "在已确认真实环境中验证已接受实现",
      confirmedContext: ["全部实现目标已被 Controller 接受", "测试环境由需求包 landing 成员描述"],
      selectedAuthorityMemberRefs: [...context.memberRefs],
      boundaries: {
        inScope: ["执行测试合同的批准步骤"],
        outOfScope: ["修改产品代码"],
        forbidden: ["创建未批准环境或配置"],
      },
      completionExpectations: ["每一步都返回可复核证据"],
      testContract: {
        question: "已接受实现能否在真实环境中保持目标行为？",
        objectBoundary: "只观察当前 Demand 的产品入口与已确认测试环境",
        steps: [
          {
            given: "已确认的真实环境与冻结实现基线",
            when: "发布需求包并查看看板",
            // biome-ignore lint/suspicious/noThenProperty: Given/When/Then 合同步骤字段（§13.85 D1）
            then: "看板列出该包为 pending",
            requirementRef: requirementRef("ac-1"),
          },
          {
            given: "需求包已在看板",
            when: "创建 Demand",
            // biome-ignore lint/suspicious/noThenProperty: Given/When/Then 合同步骤字段（§13.85 D1）
            then: "看板状态变为 claimed",
            requirementRef: requirementRef("ac-2"),
          },
        ],
        allowedSkills: [],
        setupPolicy: "reuse-existing",
        maxAttempts: 1,
        stopConditions: ["环境与冻结 Authority 不一致时立即停止"],
      },
      lineage: null,
    },
  };
  const invented = await context.connection.client.callTool({
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    arguments: {
      ...request,
      idempotencyKey: "scenario-test-plan-invented",
      taskPackage: {
        ...request.taskPackage,
        testContract: {
          ...request.taskPackage.testContract,
          steps: [
            {
              ...request.taskPackage.testContract.steps[0],
              requirementRef: requirementRef("ac-9"),
            },
          ],
        },
      },
    },
  });
  equal(
    invented.isError,
    true,
    "a test step bound to an invented acceptance item must be rejected",
  );
  const committed = await call(context, WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME, request);
  assertNoPrivatePath(context, committed);
  const planned = committed.structuredContent as {
    readonly status: string;
    readonly targetTask: {
      readonly workType: string;
      readonly targetTaskId: string;
      readonly windowId: string;
      readonly lineage: unknown;
      readonly testContract: { readonly stepCount: number; readonly environmentMemberRef: string };
    };
    readonly next: { readonly frontier: string | null };
  };
  equal(planned.status, "committed");
  equal(planned.targetTask.workType, "test");
  equal(planned.targetTask.windowId, context.testWindowId);
  equal(planned.targetTask.testContract.stepCount, 2);
  equal(planned.targetTask.testContract.environmentMemberRef.endsWith("landing.md"), true);
  equal(planned.targetTask.lineage, null);
  equal(planned.next.frontier, "test-delivery-planning");
  context.testTargetTaskId = planned.targetTask.targetTaskId;
  const second = await context.connection.client.callTool({
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    arguments: {
      ...request,
      idempotencyKey: "scenario-test-plan-2",
      expectedStreamRevision: revision + 1,
    },
  });
  equal(second.isError, true, "a second open test target must be rejected");

  const prepared = await prepareDelivery(
    context,
    "scenario-test-prepare-1",
    revision + 1,
    planned.targetTask.targetTaskId,
  );
  equal(prepared.status, "committed");
  equal(prepared.permit.prompt.includes("ts-1"), true, "prompt must carry the contract steps");
  equal(prepared.permit.prompt.includes(context.workspace.fixtureRoot), false);
  await landPrompt(context, prepared.permit.prompt, context.testWindowId, context.testHandle);
  const accepted = await recordOutcome(context, prepared.permit, "scenario-test-outcome-1");
  equal(accepted.outcome.disposition, "accepted");
  equal(accepted.target.phase, "test-host-effect-accepted");
  const stepEvidence = ["ts-1", "ts-2"].map((stepId, index) => ({
    stepId,
    evidence: {
      ref: `evidence/test-runs/${stepId}.json`,
      digest: `sha256:${String(index + 1).repeat(64)}`,
    },
  }));
  const imported = await call(context, WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME, {
    root,
    demandId: context.demandId,
    deliveryId: prepared.permit.deliveryId,
    claimDigest: prepared.permit.claimDigest,
    report: {
      workType: "test",
      content: {
        outcome: "completed",
        summary: "已按测试合同执行两步并返回逐步证据。",
        evidenceLocators: stepEvidence.map((entry) => ({
          kind: "test-step-report",
          ...entry.evidence,
        })),
        verification: ["逐项复验 Evidence ref 与 digest。"],
        risks: ["结果仍需 Controller 独立审查。"],
        stepEvidence,
      },
    },
  });
  assertNoPrivatePath(context, imported);
  const importStatus = (imported.structuredContent as { readonly status: string }).status;
  equal(importStatus, "recorded");
  const inspectionCall = await call(
    context,
    WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    { root, demandId: context.demandId, targetTaskId: planned.targetTask.targetTaskId },
  );
  const inspection = inspectionCall.structuredContent as {
    readonly snapshotDigest: string;
    readonly reviewUnit: {
      readonly reviewUnitDigest: string;
      readonly targetResult: { readonly targetResultId: string };
    };
  };
  const decided = await call(context, WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME, {
    root,
    demandId: context.demandId,
    targetResultId: inspection.reviewUnit.targetResult.targetResultId,
    snapshotDigest: inspection.snapshotDigest,
    reviewUnitDigest: inspection.reviewUnit.reviewUnitDigest,
    decision: "accept",
    assessment: { conclusion: "satisfied", evidenceSufficiency: "sufficient" },
    independentChecks: [
      {
        checkId: "controller-test-evidence",
        method: "重新读取逐步 Evidence 并复验冻结测试问题。",
        outcome: "passed",
        observation: "全部合同步骤的 Evidence 闭合且未观察到产品缺陷。",
      },
    ],
    rationale: "Controller 独立检查已关闭当前真实环境风险。",
    blockingReasons: [],
    residualRisks: ["该决定不替代后续 Demand completion 检查。"],
  });
  assertNoPrivatePath(context, decided);
  const decision = decided.structuredContent as { readonly status: string };
  equal(decision.status, "decided");
  const route = await inspectRoute(context);
  equal(route.route?.frontiers[0]?.kind, "demand-completion-preflight");
  return `${chain}; invented-step=rejected; plan=${planned.status}; second-open=rejected; delivery=${accepted.outcome.disposition}; import=${importStatus}; review=${decision.status}; next=${route.route?.frontiers[0]?.kind}`;
}

async function scenarioCompleteAndArchive(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  const chain = await driveTargetToAcceptance(context);
  const beforeCompletion = await inspectRoute(context);
  equal(beforeCompletion.route?.frontiers[0]?.kind, "demand-completion-preflight");
  const before = readdirSync(root, { recursive: true }).length;
  const preview = await call(context, WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME, {
    root,
    mode: "preview",
    demandId: context.demandId,
  });
  assertNoPrivatePath(context, preview);
  const previewed = preview.structuredContent as {
    readonly status: string;
    readonly blockers: readonly string[];
    readonly planDigest: string | null;
    readonly verify: { readonly gates: readonly { readonly status: string }[] } | null;
  };
  equal(previewed.status, "ready", previewed.blockers.join(","));
  equal(
    previewed.verify?.gates.every((gate) => gate.status === "pass"),
    true,
  );
  equal(readdirSync(root, { recursive: true }).length, before, "preview wrote");
  const applied = await call(context, WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME, {
    root,
    mode: "apply",
    demandId: context.demandId,
    planDigest: previewed.planDigest,
  });
  assertNoPrivatePath(context, applied);
  const completed = applied.structuredContent as {
    readonly disposition: string;
    readonly archive: { readonly archiveRef: string; readonly fileCount: number };
    readonly package: { readonly status: string };
    readonly terminalEvent: { readonly eventId: string };
    readonly next: { readonly frontier: string | null };
  };
  equal(completed.disposition, "completed");
  equal(completed.package.status, "archived");
  equal(completed.next.frontier, "demand-continuation");
  if (!context.demandId) throw new Error("demand missing");
  equal(
    existsSync(path.join(root, ...demandFinalRootRef(context.demandId).split("/"))),
    false,
    "active root survived completion",
  );
  equal(
    existsSync(
      path.join(root, "Ledger", ...completed.archive.archiveRef.split("/"), "manifest.json"),
    ),
    true,
  );
  equal(await boardPackageStatus(context), "archived");
  const archived = await inspectRoute(context);
  equal(archived.status, "archived");
  equal(archived.archive?.outcome, "completed");
  const recovered = await call(context, WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME, {
    root,
    mode: "recover",
    operationId: context.demandId,
  });
  const recovery = recovered.structuredContent as {
    readonly disposition: string;
    readonly terminalEvent: { readonly eventId: string };
  };
  equal(recovery.disposition, "recovered");
  equal(recovery.terminalEvent.eventId, completed.terminalEvent.eventId);
  return `${chain}; complete=${completed.disposition}; archive files=${completed.archive.fileCount}; package=${completed.package.status}; recover=${recovery.disposition}`;
}

async function scenarioCompleteAndContinue(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (!context.demandId) throw new Error("scenario ordering: complete-and-archive must run first");
  const continuation = { kind: "optimization", summary: "Tighten the focused checks." };
  const preview = await call(context, WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "preview",
    demandId: context.demandId,
    action: "continue",
    continuation,
  });
  const previewed = preview.structuredContent as {
    readonly status: string;
    readonly blockers: readonly string[];
    readonly planDigest: string | null;
  };
  equal(previewed.status, "ready", previewed.blockers.join(","));
  const applied = await call(context, WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "apply",
    demandId: context.demandId,
    action: "continue",
    continuation,
    planDigest: previewed.planDigest,
  });
  assertNoPrivatePath(context, applied);
  const continued = applied.structuredContent as {
    readonly disposition: string;
    readonly package: { readonly status: string } | null;
    readonly next: { readonly frontier: string | null };
  };
  equal(continued.disposition, "continued");
  equal(continued.package?.status, "claimed");
  equal(continued.next.frontier, "implementation-task-planning");
  const reopened = await inspectRoute(context);
  equal(reopened.status, "current");
  equal(reopened.route?.lifecycle, "active");
  equal(reopened.route?.disposition, "work-available");

  const reason = "Scenario acceptance cancels the continued Demand.";
  const cancelPreview = await call(context, WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "preview",
    demandId: context.demandId,
    reason,
  });
  const cancelPlanned = cancelPreview.structuredContent as {
    readonly status: string;
    readonly blockers: readonly string[];
    readonly planDigest: string | null;
  };
  equal(cancelPlanned.status, "ready", cancelPlanned.blockers.join(","));
  const cancelled = await call(context, WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "apply",
    demandId: context.demandId,
    reason,
    planDigest: cancelPlanned.planDigest,
  });
  assertNoPrivatePath(context, cancelled);
  const cancellation = cancelled.structuredContent as {
    readonly disposition: string;
    readonly package: { readonly status: string };
    readonly releasedClaims: number;
  };
  equal(cancellation.disposition, "cancelled");
  equal(cancellation.package.status, "withdrawn");
  equal(await boardPackageStatus(context), "withdrawn");
  equal(
    existsSync(path.join(root, ...demandFinalRootRef(context.demandId).split("/"))),
    false,
    "active root survived cancellation",
  );
  const afterCancel = await context.connection.client.callTool({
    name: WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
    arguments: {
      root,
      mode: "preview",
      demandId: context.demandId,
      action: "continue",
      continuation,
    },
  });
  const blocked = afterCancel.structuredContent as {
    readonly status: string;
    readonly blockers: readonly string[];
  };
  equal(blocked.status, "blocked");
  equal(blocked.blockers.includes("archive-outcome:cancelled"), true);
  return `continue=${continued.disposition}; route=${reopened.route?.disposition}; cancel=${cancellation.disposition}; package=${cancellation.package.status}; continue-after-cancel=blocked`;
}

const SCENARIO_RUNNERS: Readonly<Record<string, (context: ScenarioContext) => Promise<string>>> =
  Object.freeze({
    "card-01/fresh-initialize": scenarioFreshInitialize,
    "card-02/window-handshake": scenarioWindowHandshake,
    "card-02/window-replace": scenarioWindowReplace,
    "card-03/requirement-package": scenarioRequirementPackage,
    "card-04/create-demand": scenarioCreateDemand,
    "card-05/plan-implementation-task": scenarioPlanImplementationTask,
    "card-06/delivery-chain": scenarioDeliveryChain,
    "card-06/ambiguous-resolution": scenarioAmbiguousResolution,
    "card-05/test-contract": scenarioTestContract,
    "card-08/complete-and-archive": scenarioCompleteAndArchive,
    "card-04/complete-and-continue": scenarioCompleteAndContinue,
  });

test("场景验收骨架在一次性工作区上运行初始化、创建 Demand、规划任务、测试合同、完成即归档、续接与取消并报告结论", async () => {
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
