import { equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME,
  WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/delivery/contract.js";
import {
  WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
  WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
  WAKEFLOW_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/result-review/contract.js";
import { computeSha256Digest } from "../../src/foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../src/foundation/text/utf8.js";
import { computeDeliveryPromptDigest } from "../../src/governance/delivery/delivery-envelope.js";
import { workClaimRef } from "../../src/kernel/layout.js";
import { DemandEventSourcingRepository } from "../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../src/governance/demand/publication/demand-publication-paths.js";
import { WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME } from "../../src/capabilities/evidence/contract.js";
import { WAKEFLOW_POD_PUBLIC_TOOL_NAME } from "../../src/capabilities/pod/contract.js";
import type { TaskPackage } from "../../src/governance/tasking/task-package.js";
import { createImplementationTargetResultReportContentFixture } from "../governance/result/implementation-target-result-report.fixture.js";
import {
  ESCALATION_OPTIONS,
  implementationReviewJudgmentWire,
} from "../governance/review/controller-implementation-review-decision.fixture.js";
import { WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME } from "../../src/capabilities/tasking/contract.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME } from "../../src/capabilities/endpoint/contract.js";
import {
  WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME,
  WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
} from "../../src/capabilities/requirement/contract.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../src/capabilities/workspace/maintain-workspace.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../src/foundation/time/utc-instant.js";
import {
  readHostHookObservations,
  writeHostHookObservation,
} from "../../src/kernel/hook-observations.js";
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
 * 十六个场景在同一个一次性工作区上顺序运行：初始化 → 窗口握手 → 窗口替换 → 需求包 → 创建 Demand →
 * 规划任务 → 投递准备与 indeterminate 结局 → 落地证据后 accepted → 四种来源的受管证据 → 结果导入与评审检查 → 回调落地 →
 * 升级、用户回答与带 resumption 的接受 → 实现接受后规划测试合同、投递测试并由 Controller 审查接受 →
 * 完成即归档 → 续接与取消 → pod 创建、握手、一 pod 一 Demand、worktree 投递与结果、两段关闭。所有调用都
 * 经过公共 MCP 工具，即 Agent 真实使用的入口；宿主效果不在本骨架内，宿主 hook 记录由场景代替宿主写入，
 * worktree 由场景用真实 git 造出。
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
  controllerWindowId?: string;
  controllerHandle?: string;
  evidence?: ScenarioEvidence;
  /** card-08 登记的支撑面目录树证据（kind document）：card-07 用它证明种类不一致被拒。 */
  documentEvidence?: ScenarioEvidence;
  callback?: CallbackPermit;
}

interface ScenarioEvidence {
  readonly evidenceId: string;
  readonly ref: string;
  readonly digest: string;
}

/** 结果导入签发的 wake-controller 回调许可；prompt 由目标 Agent 送进 Controller 窗口。 */
interface CallbackPermit {
  readonly callbackId: string;
  readonly prompt: string;
  readonly generation: number;
  readonly issuedAt: string;
}

interface ImportResult {
  readonly status: string;
  readonly result: { readonly targetResultId: string; readonly resultDigest: string };
  readonly callback: {
    readonly callbackId: string;
    readonly permit: {
      readonly prompt: string;
      readonly generation: number;
      readonly issuedAt: string;
      readonly hostAction: { readonly effect: string; readonly windowId: string };
    };
  };
  readonly event: { readonly streamRevision: number };
  readonly next: { readonly frontier: string | null };
}

interface ReviewInspection {
  readonly snapshotDigest: string;
  readonly reviewUnit: {
    readonly status: string;
    readonly workType: string;
    readonly reviewUnitDigest: string;
    readonly targetResult: { readonly targetResultId: string };
    readonly callback: {
      readonly status: string;
      readonly generation: number;
      readonly landedRecordId: string | null;
    };
    readonly targetCompletion: { readonly status: string };
    readonly allowedDecisions: readonly string[];
    readonly resumptionBasis: {
      readonly kind: string;
      readonly escalationEventId?: string;
      readonly answered?: boolean;
    } | null;
    readonly testSteps: readonly unknown[] | null;
  };
}

interface DecisionResult {
  readonly status: string;
  readonly decision: {
    readonly targetReviewDecisionId: string;
    readonly decision: string;
    readonly callbackLanding: string;
    readonly targetCompletion: string;
  };
  readonly target: { readonly phase: string };
  readonly attached: {
    readonly escalationEventId: string | null;
    readonly productDefectRemediationId?: string | null;
  };
  readonly next: { readonly frontier: string | null };
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
  const controllerWindow = config.topology.windows.find((w) => w.role === "controller");
  const repository = config.topology.repositories[0];
  if (
    !design ||
    !designWindow ||
    !productWindow ||
    !testWindow ||
    !controllerWindow ||
    !repository
  ) {
    throw new Error("fresh config lacks the expected topology");
  }
  context.designSurfaceId = design.surfaceId;
  context.designWindowId = designWindow.windowId;
  context.productWindowId = productWindow.windowId;
  context.testWindowId = testWindow.windowId;
  context.controllerWindowId = controllerWindow.windowId;
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

/**
 * 宿主 hook 在某个窗口的会话里留下一条记录；这里代替宿主写入。`user-prompt-submit` 证明 prompt 落地
 * （投递或回调），`stop` 证明目标会话在结果之后结束了本轮（accept 的完成证据，§13.87 D2）。
 */
async function recordSessionEvent(
  context: ScenarioContext,
  windowId: string | undefined,
  handle: string | undefined,
  event: "user-prompt-submit" | "stop",
  prompt: string | null = null,
): Promise<void> {
  if (!windowId || !handle) {
    throw new Error("scenario ordering: the window handshake must run first");
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
      event,
      sessionId: handle,
      cwd: path.resolve(context.workspace.workspacePath, placement),
      recordedAt: parseUtcInstant(new Date().toISOString()),
      ...(prompt === null ? {} : { promptDigest: computeDeliveryPromptDigest(prompt) }),
    });
  } finally {
    await root.close();
  }
}

/** 目标窗口收到 prompt 后，宿主 hook 会留下 user-prompt-submit 记录。 */
async function landPrompt(
  context: ScenarioContext,
  prompt: string,
  windowId = context.productWindowId,
  handle = context.productHandle,
): Promise<void> {
  await recordSessionEvent(context, windowId, handle, "user-prompt-submit", prompt);
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

/** 卡 5 与卡 8 依赖卡 7 已把实现目标推到 accepted；顺序错误直接报告，不重走链路。 */
function requireAcceptedImplementation(context: ScenarioContext): void {
  if (context.targetAccepted !== true) {
    throw new Error("scenario ordering: escalate-and-resume must run first");
  }
}

/** 窗口握手：Agent 启动窗口留下 session-start 记录后登记私有绑定（卡 2 的同一条链）。 */
async function registerWindow(
  context: ScenarioContext,
  windowId: string,
  handleValue: string,
): Promise<void> {
  const root = context.workspace.workspacePath;
  const inspected = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root,
    operation: "inspect",
    windowId,
  });
  const inspection = inspected.structuredContent as {
    readonly launchIntent: {
      readonly intentDigest: string;
      readonly root: { readonly configuredPlacement: string };
    };
  };
  const handle = { kind: "codex-thread", value: handleValue };
  await recordSessionStart(context, handle.value, inspection.launchIntent.root.configuredPlacement);
  const registered = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root,
    operation: "register",
    windowId,
    observation: {
      handle,
      launchIntentDigest: inspection.launchIntent.intentDigest,
      observedAt: new Date().toISOString(),
    },
  });
  equal((registered.structuredContent as BindingMutation).disposition, "registered");
}

async function registerTestWindow(context: ScenarioContext): Promise<void> {
  if (!context.testWindowId) throw new Error("scenario ordering: fresh-initialize must run first");
  const handle = "codex-host-owned-thread:scenario-test";
  await registerWindow(context, context.testWindowId, handle);
  context.testHandle = handle;
}

/** Controller 窗口的握手：回调许可指向它，落地记录也在它的会话里。 */
async function registerControllerWindow(context: ScenarioContext): Promise<void> {
  if (!context.controllerWindowId) {
    throw new Error("scenario ordering: fresh-initialize must run first");
  }
  const handle = "codex-host-owned-thread:scenario-controller";
  await registerWindow(context, context.controllerWindowId, handle);
  context.controllerHandle = handle;
}

interface EvidenceRecording {
  readonly disposition: string;
  readonly evidenceId: string;
  readonly planDigest: string;
  readonly plan: {
    readonly kind: string;
    readonly recorded: boolean;
    readonly contentReview: { readonly disposition: string; readonly opaqueFileCount: number };
  };
}

/** 经公共工具 preview 再 apply 一份受管证据；preview 阻塞是断言失败而不是分支。 */
async function recordEvidenceSelection(
  context: ScenarioContext,
  selection: Readonly<Record<string, unknown>>,
): Promise<EvidenceRecording> {
  const root = context.workspace.workspacePath;
  if (!context.demandId) throw new Error("scenario ordering: create-demand must run first");
  const preview = await call(context, WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME, {
    root,
    mode: "preview",
    demandId: context.demandId,
    selection,
  });
  assertNoPrivatePath(context, preview);
  const previewed = preview.structuredContent as {
    readonly status: string;
    readonly blockers: readonly string[];
    readonly planDigest: string | null;
    readonly plan: EvidenceRecording["plan"] | null;
  };
  if (previewed.planDigest === null || previewed.plan === null) {
    throw new Error(`evidence preview is not ready: ${previewed.blockers.join(",")}`);
  }
  const applied = await call(context, WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME, {
    root,
    mode: "apply",
    demandId: context.demandId,
    selection,
    planDigest: previewed.planDigest,
  });
  assertNoPrivatePath(context, applied);
  const mutation = applied.structuredContent as {
    readonly disposition: string;
    readonly publication: { readonly evidenceId: string } | null;
  };
  if (mutation.publication === null) throw new Error("evidence apply returned no publication");
  return {
    disposition: mutation.disposition,
    evidenceId: mutation.publication.evidenceId,
    planDigest: previewed.planDigest,
    plan: previewed.plan,
  };
}

/** 只 preview，返回阻塞项；用于断言内容审阅拒绝。 */
async function previewEvidenceBlockers(
  context: ScenarioContext,
  selection: Readonly<Record<string, unknown>>,
): Promise<readonly string[]> {
  const preview = await call(context, WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME, {
    root: context.workspace.workspacePath,
    mode: "preview",
    demandId: context.demandId,
    selection,
  });
  const previewed = preview.structuredContent as {
    readonly status: string;
    readonly blockers: readonly string[];
  };
  equal(previewed.status, "blocked");
  return previewed.blockers;
}

const EVIDENCE_FILE_PATH = "artifacts/review/verification.txt";
const EVIDENCE_FILE_CONTENT = "verification passed\n";

function productFileSelection(context: ScenarioContext) {
  return {
    kind: "test-output",
    source: {
      kind: "managed-path",
      root: { kind: "repository", repositoryId: context.repositoryId },
      path: EVIDENCE_FILE_PATH,
      resourceType: "file",
    },
    contentReview: "reject",
  };
}

/** 报告引用的证据必须先成为本 Demand 的受管证据记录（§13.87 D3）；这里从产品仓库登记一份。 */
async function recordEvidence(context: ScenarioContext): Promise<ScenarioEvidence> {
  if (!context.demandId || !context.repositoryId) {
    throw new Error("scenario ordering: create-demand must run first");
  }
  const filePath = path.join(context.workspace.productPath, ...EVIDENCE_FILE_PATH.split("/"));
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, EVIDENCE_FILE_CONTENT);
  const recording = await recordEvidenceSelection(context, productFileSelection(context));
  return {
    evidenceId: recording.evidenceId,
    ref: `artifacts/managed-evidence/${recording.evidenceId}/payload/content`,
    digest: computeSha256Digest(encodeUtf8(EVIDENCE_FILE_CONTENT)),
  };
}

async function loadTaskPackage(
  context: ScenarioContext,
  taskPackageId: string,
): Promise<TaskPackage> {
  if (!context.demandId) throw new Error("scenario ordering: create-demand must run first");
  const demandRoot = await RootedDirectory.open(
    path.join(context.workspace.workspacePath, ...demandFinalRootRef(context.demandId).split("/")),
  );
  try {
    const planned = await new DemandEventSourcingRepository(demandRoot).findTargetTaskPlannedEvent(
      taskPackageId,
    );
    if (planned === null) throw new Error("planned task package missing");
    return planned.event.data.taskPackage;
  } finally {
    await demandRoot.close();
  }
}

function importRequest(
  context: ScenarioContext,
  permit: DeliveryPermit,
  idempotencyKey: string,
  expectedStreamRevision: number,
  content: unknown,
): Readonly<Record<string, unknown>> {
  return {
    root: context.workspace.workspacePath,
    demandId: context.demandId,
    idempotencyKey,
    expectedStreamRevision,
    deliveryId: permit.deliveryId,
    claimDigest: permit.claimDigest,
    report: { workType: "implementation", content },
  };
}

async function inspectReview(
  context: ScenarioContext,
  targetTaskId: string,
): Promise<ReviewInspection> {
  const inspected = await call(context, WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME, {
    root: context.workspace.workspacePath,
    demandId: context.demandId,
    targetTaskId,
  });
  assertNoPrivatePath(context, inspected);
  equal(
    JSON.stringify(inspected.structuredContent).includes("codex-host-owned-thread"),
    false,
    "review inspection leaked a raw handle",
  );
  return inspected.structuredContent as ReviewInspection;
}

/** 实现评审决定请求：判断字段来自夹具，基线来自刚读取的检查投影。 */
function implementationDecisionRequest(
  context: ScenarioContext,
  inspection: ReviewInspection,
  decision: "accept" | "rework" | "blocked" | "escalate",
  idempotencyKey: string,
  expectedStreamRevision: number,
): Readonly<Record<string, unknown>> {
  return {
    root: context.workspace.workspacePath,
    demandId: context.demandId,
    idempotencyKey,
    expectedStreamRevision,
    targetResultId: inspection.reviewUnit.targetResult.targetResultId,
    snapshotDigest: inspection.snapshotDigest,
    reviewUnitDigest: inspection.reviewUnit.reviewUnitDigest,
    ...implementationReviewJudgmentWire(decision),
  };
}

/**
 * 卡 8：受管证据的四种来源、内容审阅与同内容幂等。产品仓库文件成为 card-07 引用的证据；
 * 支撑面目录树、产品会话的 hook 记录、https 链接与提交引用各成一份记录，结果不含句柄与路径。
 */
async function scenarioRecordEvidence(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (
    !context.demandId ||
    !context.repositoryId ||
    !context.designSurfaceId ||
    !context.designPath ||
    !context.productHandle
  ) {
    throw new Error("scenario ordering: ambiguous-resolution must run first");
  }
  const file = await recordEvidence(context);
  context.evidence = file;
  const replay = await recordEvidenceSelection(context, productFileSelection(context));
  equal(replay.disposition, "already-recorded");
  equal(replay.evidenceId, file.evidenceId);
  equal(replay.plan.recorded, true);

  mkdirSync(path.join(context.designPath, "reviews"), { recursive: true });
  writeFileSync(path.join(context.designPath, "reviews", "notes.md"), "design reviewed\n");
  writeFileSync(
    path.join(context.designPath, "reviews", "shot.bin"),
    Uint8Array.from([0x00, 0xff, 0x01, 0x02]),
  );
  const treeSelection = (contentReview: string) => ({
    kind: "document",
    source: {
      kind: "managed-path",
      root: { kind: "support-surface", surfaceId: context.designSurfaceId },
      path: "reviews",
      resourceType: "tree",
    },
    contentReview,
  });
  const opaqueBlockers = await previewEvidenceBlockers(context, treeSelection("reject"));
  equal(opaqueBlockers.includes("opaque-content:shot.bin"), true);
  const tree = await recordEvidenceSelection(context, treeSelection("controller-confirmed"));
  equal(tree.disposition, "recorded");
  equal(tree.plan.contentReview.disposition, "controller-confirmed");
  equal(tree.plan.contentReview.opaqueFileCount, 1);
  context.documentEvidence = {
    evidenceId: tree.evidenceId,
    ref: `artifacts/managed-evidence/${tree.evidenceId}/payload/notes.md`,
    digest: computeSha256Digest(encodeUtf8("design reviewed\n")),
  };

  writeFileSync(
    path.join(context.workspace.productPath, "artifacts", "review", "secret.txt"),
    "token = abcdefghijklmnop\n",
  );
  const credentialBlockers = await previewEvidenceBlockers(context, {
    ...productFileSelection(context),
    source: { ...productFileSelection(context).source, path: "artifacts/review/secret.txt" },
    contentReview: "controller-confirmed",
  });
  equal(credentialBlockers.includes("privacy:credential-assignment:content:1"), true);

  const workspaceRoot = await RootedDirectory.open(root);
  let recordId: string;
  try {
    const records = await readHostHookObservations(workspaceRoot, "codex", {
      sessionId: context.productHandle,
      event: "user-prompt-submit",
    });
    const record = records.records[0];
    if (record === undefined) throw new Error("expected a product session prompt record");
    recordId = record.recordId;
  } finally {
    await workspaceRoot.close();
  }
  const observation = await recordEvidenceSelection(context, {
    kind: "hook-observation",
    source: { kind: "observation", hostId: "codex", recordId },
    contentReview: "reject",
  });
  equal(observation.disposition, "recorded");
  equal(observation.plan.kind, "hook-observation");
  const link = await recordEvidenceSelection(context, {
    kind: "link",
    source: { kind: "link", url: "https://example.com/ci/runs/42" },
    contentReview: "reject",
  });
  const commit = await recordEvidenceSelection(context, {
    kind: "commit",
    source: { kind: "commit", repositoryId: context.repositoryId, commitOid: "c".repeat(40) },
    contentReview: "reject",
  });
  const recovered = await call(context, WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME, {
    root,
    mode: "recover",
    demandId: context.demandId,
  });
  const recovery = recovered.structuredContent as { readonly disposition: string };
  equal(recovery.disposition, "healthy");
  return `file=${file.evidenceId.slice(0, 17)}…; replay=${replay.disposition}; opaque-reject=blocked; tree=${tree.disposition}(confirmed); credential=blocked; observation=${observation.disposition}; link=${link.disposition}; commit=${commit.disposition}; recover=${recovery.disposition}`;
}

/**
 * 卡 7：导入只接受同 Demand 受管证据里能复验摘要的定位符，拒绝泄露隐私的报告文本；导入落账即释放
 * 声明并签发回调许可，重放幂等；完成证据到达前 accept 不在允许集合内，也会被记录工具拒绝。
 */
async function scenarioImportAndReview(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (
    !context.demandId ||
    !context.targetTaskId ||
    !context.taskPackageId ||
    !context.productWindowId ||
    !context.delivery ||
    context.deliveryAccepted !== true
  ) {
    throw new Error("scenario ordering: ambiguous-resolution must run first");
  }
  await registerControllerWindow(context);
  const evidence = context.evidence ?? (await recordEvidence(context));
  context.evidence = evidence;
  const taskPackage = await loadTaskPackage(context, context.taskPackageId);
  const content = createImplementationTargetResultReportContentFixture(taskPackage, evidence);
  const permit = context.delivery;
  const revision = await currentStreamRevision(context);

  const wrongDigest = await context.connection.client.callTool({
    name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    arguments: importRequest(
      context,
      permit,
      "scenario-import-wrong-digest",
      revision,
      createImplementationTargetResultReportContentFixture(taskPackage, {
        ref: evidence.ref,
        digest: `sha256:${"f".repeat(64)}`,
      }),
    ),
  });
  equal(wrongDigest.isError, true, "a locator whose digest does not match must be rejected");
  equal(scenarioToolText(wrongDigest).includes("evidence-unresolved"), true);
  const leaking = await context.connection.client.callTool({
    name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    arguments: importRequest(context, permit, "scenario-import-private-path", revision, {
      ...content,
      summary: `${content.summary} 详见 /Users/example/private-notes/review.txt`,
    }),
  });
  equal(leaking.isError, true, "a report carrying an unlisted absolute path must be rejected");
  equal(scenarioToolText(leaking).includes("privacy:unlisted-absolute-path"), true);
  if (context.documentEvidence !== undefined) {
    // 定位符种类必须等于记录种类（切片 8 D5）：把 document 记录当 test-output 引用被拒。
    const mismatched = await context.connection.client.callTool({
      name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
      arguments: importRequest(context, permit, "scenario-import-kind-mismatch", revision, {
        ...content,
        evidenceLocators: [
          ...content.evidenceLocators,
          {
            kind: "test-output",
            ref: context.documentEvidence.ref,
            digest: context.documentEvidence.digest,
          },
        ],
      }),
    });
    equal(
      mismatched.isError,
      true,
      "a locator whose kind differs from the record must be rejected",
    );
    equal(scenarioToolText(mismatched).includes("evidence-kind-mismatch"), true);
  }
  equal(
    existsSync(path.join(root, ...workClaimRef(context.productWindowId).split("/"))),
    true,
    "a rejected import must not release the claim",
  );

  const imported = await call(
    context,
    WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    importRequest(context, permit, "scenario-import-1", revision, content),
  );
  assertNoPrivatePath(context, imported);
  const importResult = imported.structuredContent as ImportResult;
  equal(importResult.status, "committed");
  equal(importResult.callback.permit.hostAction.effect, "send-prompt-to-window");
  equal(importResult.callback.permit.hostAction.windowId, context.controllerWindowId);
  equal(importResult.callback.permit.generation, 1);
  equal(
    importResult.callback.permit.prompt.includes(
      WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    ),
    true,
    "the callback prompt must point the Controller at the review inspection tool",
  );
  equal(importResult.callback.permit.prompt.includes(context.workspace.fixtureRoot), false);
  equal(importResult.next.frontier, "implementation-result-review");
  equal(existsSync(path.join(root, ...workClaimRef(context.productWindowId).split("/"))), false);
  const replayed = await call(
    context,
    WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    importRequest(context, permit, "scenario-import-1", revision, content),
  );
  const replay = replayed.structuredContent as ImportResult;
  equal(replay.status, "idempotent");
  equal(replay.callback.callbackId, importResult.callback.callbackId);
  equal(replay.result.resultDigest, importResult.result.resultDigest);

  const pending = await inspectReview(context, context.targetTaskId);
  equal(pending.reviewUnit.status, "reported");
  equal(pending.reviewUnit.callback.status, "pending");
  equal(pending.reviewUnit.targetCompletion.status, "pending");
  equal(pending.reviewUnit.allowedDecisions.includes("accept"), false);
  equal(pending.reviewUnit.allowedDecisions.includes("rework"), true);
  const premature = await context.connection.client.callTool({
    name: WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    arguments: implementationDecisionRequest(
      context,
      pending,
      "accept",
      "scenario-decision-premature",
      await currentStreamRevision(context),
    ),
  });
  equal(premature.isError, true, "accept without completion evidence must be rejected");
  equal(scenarioToolText(premature).includes("target-completion-pending"), true);

  await recordSessionEvent(context, context.productWindowId, context.productHandle, "stop");
  const confirmed = await inspectReview(context, context.targetTaskId);
  equal(confirmed.reviewUnit.targetCompletion.status, "confirmed");
  equal(confirmed.reviewUnit.allowedDecisions.includes("accept"), true);
  context.callback = {
    callbackId: importResult.callback.callbackId,
    prompt: importResult.callback.permit.prompt,
    generation: importResult.callback.permit.generation,
    issuedAt: importResult.callback.permit.issuedAt,
  };
  return `wrong-digest=rejected; private-path=rejected; kind-mismatch=${context.documentEvidence === undefined ? "skipped" : "rejected"}; import=${importResult.status}; replay=${replay.status}; claim=released; callback=${pending.reviewUnit.callback.status}; completion=${pending.reviewUnit.targetCompletion.status}->${confirmed.reviewUnit.targetCompletion.status}; accept-before-stop=rejected; allowed=${confirmed.reviewUnit.allowedDecisions.join("|")}`;
}

/**
 * 卡 6 回调：许可 prompt 落进 Controller 会话即 landed；未静默与已落地的回调都不能重臂。静默后重发
 * 需要注入时钟，由 tests/capabilities/result-review/service.test.ts 覆盖。
 */
async function scenarioWakeController(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (!context.callback || !context.targetTaskId) {
    throw new Error("scenario ordering: import-and-review must run first");
  }
  const rearmRequest = (idempotencyKey: string, expectedStreamRevision: number) => ({
    root,
    demandId: context.demandId,
    idempotencyKey,
    expectedStreamRevision,
    deliveryId: context.callback?.callbackId,
  });
  const early = await context.connection.client.callTool({
    name: WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME,
    arguments: rearmRequest("scenario-callback-rearm-early", await currentStreamRevision(context)),
  });
  equal(early.isError, true, "a callback that is not silent yet must not be re-issued");
  equal(scenarioToolText(early).includes("callback-pending"), true);

  await landPrompt(
    context,
    context.callback.prompt,
    context.controllerWindowId,
    context.controllerHandle,
  );
  const landed = await inspectReview(context, context.targetTaskId);
  equal(landed.reviewUnit.callback.status, "landed");
  equal(typeof landed.reviewUnit.callback.landedRecordId, "string");
  equal(landed.reviewUnit.callback.generation, 1);
  const afterLanding = await context.connection.client.callTool({
    name: WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME,
    arguments: rearmRequest("scenario-callback-rearm-landed", await currentStreamRevision(context)),
  });
  equal(afterLanding.isError, true, "a landed callback must not be re-issued");
  equal(scenarioToolText(afterLanding).includes("callback-landed"), true);
  return `rearm-before-silence=callback-pending; landing=${landed.reviewUnit.callback.status}; rearm-after-landing=callback-landed; silence-reissue=service-test-with-injected-clock`;
}

/**
 * 卡 7：escalate 在同一提交附带升级事件并把 Route 交给用户；用户经 continue_demand record-decision
 * 回答后，带 resumption 的 accept 回到同一结果，目标 accepted，Route 前进到测试规划。
 */
async function scenarioEscalateAndResume(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (!context.demandId || !context.targetTaskId || !context.callback) {
    throw new Error("scenario ordering: wake-controller must run first");
  }
  const before = await inspectReview(context, context.targetTaskId);
  const escalateRequest = implementationDecisionRequest(
    context,
    before,
    "escalate",
    "scenario-decision-escalate",
    await currentStreamRevision(context),
  );
  const escalatedCall = await call(
    context,
    WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    escalateRequest,
  );
  assertNoPrivatePath(context, escalatedCall);
  const escalated = escalatedCall.structuredContent as DecisionResult;
  equal(escalated.status, "committed");
  equal(escalated.target.phase, "escalated");
  equal(escalated.decision.callbackLanding, "landed");
  equal(escalated.decision.targetCompletion, "confirmed");
  const escalationEventId = escalated.attached.escalationEventId;
  if (escalationEventId === null) throw new Error("escalate must attach the escalation event");
  const replayed = await call(
    context,
    WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    escalateRequest,
  );
  const replay = replayed.structuredContent as DecisionResult;
  equal(replay.status, "idempotent");
  equal(replay.decision.targetReviewDecisionId, escalated.decision.targetReviewDecisionId);
  const awaiting = await inspectRoute(context);
  equal(awaiting.route?.disposition, "awaiting-decision");
  equal(awaiting.route?.frontiers[0]?.kind, "decision-required");

  const waiting = await inspectReview(context, context.targetTaskId);
  equal(waiting.reviewUnit.status, "escalated");
  equal(waiting.reviewUnit.callback.status, "acknowledged");
  equal(waiting.reviewUnit.resumptionBasis?.kind, "decision-recorded");
  equal(waiting.reviewUnit.resumptionBasis?.escalationEventId, escalationEventId);
  equal(waiting.reviewUnit.resumptionBasis?.answered, false);
  equal(waiting.reviewUnit.allowedDecisions.length, 0);

  const decision = {
    text: "按当前实现接受，需求补充由设计侧另行提交。",
    chosenOption: ESCALATION_OPTIONS[0].option,
  };
  const decisionPreview = await call(context, WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "preview",
    demandId: context.demandId,
    action: "record-decision",
    decision,
  });
  const previewed = decisionPreview.structuredContent as {
    readonly status: string;
    readonly blockers: readonly string[];
    readonly planDigest: string | null;
  };
  equal(previewed.status, "ready", previewed.blockers.join(","));
  const recorded = await call(context, WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "apply",
    demandId: context.demandId,
    action: "record-decision",
    decision,
    planDigest: previewed.planDigest,
  });
  assertNoPrivatePath(context, recorded);
  const recording = recorded.structuredContent as {
    readonly disposition: string;
    readonly next: { readonly frontier: string | null };
  };
  equal(recording.disposition, "decision-recorded");
  equal(recording.next.frontier, "implementation-result-review");

  const answered = await inspectReview(context, context.targetTaskId);
  equal(answered.reviewUnit.resumptionBasis?.answered, true);
  equal(answered.reviewUnit.allowedDecisions.includes("accept"), true);
  const withoutResumption = await context.connection.client.callTool({
    name: WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    arguments: implementationDecisionRequest(
      context,
      answered,
      "accept",
      "scenario-decision-no-resumption",
      await currentStreamRevision(context),
    ),
  });
  equal(withoutResumption.isError, true, "re-deciding an escalated unit needs a resumption");
  equal(scenarioToolText(withoutResumption).includes("resumption-missing"), true);
  const acceptedCall = await call(
    context,
    WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    {
      ...implementationDecisionRequest(
        context,
        answered,
        "accept",
        "scenario-decision-accept",
        await currentStreamRevision(context),
      ),
      resumption: {
        previousDecisionId: escalated.decision.targetReviewDecisionId,
        basis: { kind: "decision-recorded", escalationEventId },
        summary: "用户已回答升级问题：按当前实现接受。",
      },
    },
  );
  assertNoPrivatePath(context, acceptedCall);
  const accepted = acceptedCall.structuredContent as DecisionResult;
  equal(accepted.status, "committed");
  equal(accepted.target.phase, "accepted");
  equal(accepted.attached.escalationEventId, null);
  equal(accepted.next.frontier, "test-task-planning");
  context.delivery = undefined;
  context.deliveryAccepted = false;
  context.targetAccepted = true;
  return `escalate=${escalated.status}; replay=${replay.status}; route=${awaiting.route?.disposition}; callback=${waiting.reviewUnit.callback.status}; record-decision=${recording.disposition}; accept-without-resumption=rejected; resumed-accept=${accepted.status}; phase=${accepted.target.phase}; next=${accepted.next.frontier}`;
}

/**
 * 卡 5 修订 5.2：实现接受后 Controller 撰写测试合同追加 test 任务包，Wakeflow 派生窗口、环境与基线；
 * 测试投递、逐步证据导入与 Controller 测试审查走同一批公共工具，接受后 Route 到完成预检。
 */
async function scenarioTestContract(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (
    !context.demandId ||
    !context.memberRefs ||
    !context.recordDigest ||
    !context.testWindowId ||
    !context.evidence
  ) {
    throw new Error("scenario ordering: create-demand and import-and-review must run first");
  }
  requireAcceptedImplementation(context);
  const evidence = context.evidence;
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
  const steps = ["ts-1", "ts-2"].map((stepId) => ({
    stepId,
    observed: `${stepId} 在已确认环境中观察到合同所述行为。`,
    evidence: { ref: evidence.ref, digest: evidence.digest },
    verdict: "pass",
  }));
  const imported = await call(context, WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME, {
    root,
    demandId: context.demandId,
    idempotencyKey: "scenario-test-import-1",
    expectedStreamRevision: await currentStreamRevision(context),
    deliveryId: prepared.permit.deliveryId,
    claimDigest: prepared.permit.claimDigest,
    report: {
      workType: "test",
      content: {
        outcome: "completed",
        summary: "已按测试合同执行两步并返回逐步证据。",
        evidenceLocators: [{ kind: "test-output", ref: evidence.ref, digest: evidence.digest }],
        verification: ["逐项复验 Evidence ref 与 digest。"],
        risks: ["结果仍需 Controller 独立审查。"],
        steps,
      },
    },
  });
  assertNoPrivatePath(context, imported);
  const importResult = imported.structuredContent as ImportResult;
  equal(importResult.status, "committed");
  equal(importResult.callback.permit.hostAction.windowId, context.controllerWindowId);
  // 测试会话留下 Stop 记录后，accept 才进入允许集合。
  await recordSessionEvent(context, context.testWindowId, context.testHandle, "stop");
  const inspection = await inspectReview(context, planned.targetTask.targetTaskId);
  equal(inspection.reviewUnit.workType, "test");
  equal(inspection.reviewUnit.testSteps?.length, 2);
  equal(inspection.reviewUnit.allowedDecisions.includes("accept"), true);
  const decided = await call(context, WAKEFLOW_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME, {
    root,
    demandId: context.demandId,
    idempotencyKey: "scenario-test-decision-1",
    expectedStreamRevision: await currentStreamRevision(context),
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
  const decision = decided.structuredContent as DecisionResult;
  equal(decision.status, "committed");
  equal(decision.target.phase, "test-accepted");
  equal(decision.attached.productDefectRemediationId, null);
  const route = await inspectRoute(context);
  equal(route.route?.frontiers[0]?.kind, "demand-completion-preflight");
  return `invented-step=rejected; plan=${planned.status}; second-open=rejected; delivery=${accepted.outcome.disposition}; import=${importResult.status}; review=${decision.status}; next=${route.route?.frontiers[0]?.kind}`;
}

async function scenarioCompleteAndArchive(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  requireAcceptedImplementation(context);
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
  return `complete=${completed.disposition}; archive files=${completed.archive.fileCount}; package=${completed.package.status}; recover=${recovery.disposition}`;
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

// ---- card-10/pod-lifecycle（ADR-0010，§13.91 D7） --------------------------------------------

interface PodMutation {
  readonly disposition: string;
  readonly pod: { readonly podId: string; readonly name: string; readonly state: string } | null;
  readonly windows: readonly {
    readonly windowId: string;
    readonly role: string;
    readonly bound: boolean;
  }[];
  readonly worktrees: readonly { readonly repositoryId: string; readonly receipt: string }[];
  readonly retiredReceipts: number;
  readonly next: { readonly frontier: string | null; readonly blockers: readonly string[] };
}

interface PodPreview {
  readonly status: string;
  readonly blockers: readonly string[];
  readonly planDigest: string | null;
  readonly plan: { readonly kind: string; readonly pod: { readonly state: string } } | null;
  readonly next: { readonly frontier: string | null };
}

function gitInProduct(context: ScenarioContext, ...args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd: context.workspace.productPath,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "scenario",
      GIT_AUTHOR_EMAIL: "scenario@example.invalid",
      GIT_COMMITTER_NAME: "scenario",
      GIT_COMMITTER_EMAIL: "scenario@example.invalid",
    },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

async function podPreview(context: ScenarioContext, intent: Readonly<Record<string, unknown>>) {
  const result = await call(context, WAKEFLOW_POD_PUBLIC_TOOL_NAME, {
    root: context.workspace.workspacePath,
    mode: "preview",
    intent,
  });
  assertNoPrivatePath(context, result);
  return result.structuredContent as PodPreview;
}

async function podApply(context: ScenarioContext, intent: Readonly<Record<string, unknown>>) {
  const previewed = await podPreview(context, intent);
  if (previewed.planDigest === null) {
    throw new Error(`pod preview is not ready: ${previewed.blockers.join(",")}`);
  }
  const result = await call(context, WAKEFLOW_POD_PUBLIC_TOOL_NAME, {
    root: context.workspace.workspacePath,
    mode: "apply",
    intent,
    planDigest: previewed.planDigest,
  });
  assertNoPrivatePath(context, result);
  return result.structuredContent as PodMutation;
}

/** 再发布一个需求包：同一份草稿、不同标题得到不同的需求标识。 */
async function publishScenarioPackage(context: ScenarioContext, title: string) {
  const root = context.workspace.workspacePath;
  if (!context.designSurfaceId || !context.designWindowId) {
    throw new Error("scenario ordering: requirement-package must run first");
  }
  const packageInput = {
    designSurfaceId: context.designSurfaceId,
    title,
    demandType: "requirement",
    priority: "P2",
    originWindowId: context.designWindowId,
    testingDecision: { mode: "controller-only", summary: "Controller validates focused checks." },
    requirementPath: "drafts/requirement.md",
    landingPath: "drafts/landing.md",
    confirmation: { confirmedAt: new Date().toISOString() },
  };
  const ready = await call(context, WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "preview",
    action: "publish",
    package: packageInput,
  });
  const readyPreview = ready.structuredContent as PublicationPreview;
  if (readyPreview.planDigest === null) throw new Error("package preview is not ready");
  const applied = await call(context, WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "apply",
    action: "publish",
    package: packageInput,
    planDigest: readyPreview.planDigest,
  });
  const mutation = applied.structuredContent as {
    readonly package: { readonly requirementId: string };
  };
  const board = await call(context, WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME, {
    root,
    view: "package",
    requirementId: mutation.package.requirementId,
  });
  const view = board.structuredContent as { readonly package: { readonly recordDigest: string } };
  const requirementId = mutation.package.requirementId;
  return {
    requirementId,
    recordDigest: view.package.recordDigest,
    memberRefs: [
      `requirements/${requirementId}/requirement.md`,
      `requirements/${requirementId}/landing.md`,
    ],
  };
}

async function previewDemandOn(context: ScenarioContext, requirementId: string, podId?: string) {
  const preview = await call(context, WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME, {
    root: context.workspace.workspacePath,
    mode: "preview",
    requirementId,
    ...(podId === undefined ? {} : { podId }),
    demand: {
      title: "Pod scenario demand",
      goal: "Advance one requirement inside a worktree pod.",
      completionDefinition: "The implementation result is imported from the pod's worktree.",
    },
  });
  assertNoPrivatePath(context, preview);
  return preview.structuredContent as {
    readonly status: string;
    readonly blockers: readonly string[];
    readonly planDigest: string | null;
  };
}

/** pod 窗口握手：返回绑定，供退役用；产品窗口另带 worktree 观察。 */
async function registerPodWindow(
  context: ScenarioContext,
  windowId: string,
  handleValue: string,
  cwd: string,
  worktree?: { readonly porcelain: string; readonly commonDir: string },
) {
  const root = context.workspace.workspacePath;
  const inspected = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root,
    operation: "inspect",
    windowId,
  });
  assertNoPrivatePath(context, inspected);
  const inspection = inspected.structuredContent as {
    readonly launchIntent: { readonly intentDigest: string; readonly podName: string };
  };
  const rooted = await RootedDirectory.open(root);
  try {
    await writeHostHookObservation(rooted, {
      hostId: "codex",
      event: "session-start",
      sessionId: handleValue,
      cwd,
      recordedAt: parseUtcInstant(new Date().toISOString()),
    });
  } finally {
    await rooted.close();
  }
  const registered = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root,
    operation: "register",
    windowId,
    observation: {
      handle: { kind: "codex-thread", value: handleValue },
      launchIntentDigest: inspection.launchIntent.intentDigest,
      observedAt: new Date().toISOString(),
      ...(worktree === undefined ? {} : { worktree }),
    },
  });
  assertNoPrivatePath(context, registered);
  const mutation = registered.structuredContent as BindingMutation & {
    readonly worktree: { readonly branch: string | null } | null;
  };
  equal(mutation.disposition, "registered");
  if (mutation.binding === null) throw new Error("pod window binding missing");
  return {
    binding: mutation.binding,
    worktree: mutation.worktree,
    podName: inspection.launchIntent.podName,
  };
}

async function decommissionPodWindow(
  context: ScenarioContext,
  windowId: string,
  binding: { readonly bindingId: string; readonly bindingDigest: string },
) {
  const result = await call(context, WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME, {
    root: context.workspace.workspacePath,
    operation: "decommission",
    windowId,
    expectedBindingId: binding.bindingId,
    expectedBindingDigest: binding.bindingDigest,
    closure: {
      preClose: { kind: "codex-thread", status: "active" },
      closeResult: { status: "closed" },
      postClose: { kind: "codex-thread", status: "archived" },
    },
  });
  equal((result.structuredContent as BindingMutation).disposition, "decommissioned");
}

async function scenarioPodLifecycle(context: ScenarioContext): Promise<string> {
  const root = context.workspace.workspacePath;
  if (!context.repositoryId || !context.productWindowId) {
    throw new Error("scenario ordering: fresh-initialize must run first");
  }
  const configPath = path.join(root, "wakeflow.config.json");
  const before = readFileSync(configPath, "utf8");
  const createIntent = { kind: "create", name: "feature-pod", idempotencyKey: "scenario-pod-1" };
  const previewed = await podPreview(context, createIntent);
  equal(previewed.status, "ready", previewed.blockers.join(","));
  equal(previewed.plan?.kind, "create");
  equal(previewed.next.frontier, "pod-create-apply");
  equal(readFileSync(configPath, "utf8"), before, "pod preview wrote the config");
  const created = await podApply(context, createIntent);
  equal(created.disposition, "created");
  equal(created.pod?.state, "creating");
  equal(created.next.frontier, "pod-window-registration");
  const replayed = await podApply(context, createIntent);
  equal(replayed.disposition, "already-created");
  const taken = await podPreview(context, { ...createIntent, idempotencyKey: "scenario-pod-2" });
  equal(taken.status, "blocked");
  equal(taken.blockers.includes("name-taken"), true, "name-taken blocker");
  const config = parseWakeflowConfigV3(JSON.parse(readFileSync(configPath, "utf8")));
  equal(config.pods.length, 2);
  equal(config.topology.windows.length, 8);
  if (created.pod === null) throw new Error("created pod missing");
  const podId = created.pod.podId;
  const windowOf = (role: string) => {
    const window = created.windows.find((entry) => entry.role === role);
    if (window === undefined) throw new Error(`pod window ${role} missing`);
    return window.windowId;
  };

  // 握手：controller、design、test 按各自根登记；产品窗口在真实 worktree 里登记并交回 git 事实。
  const controllerBinding = await registerPodWindow(
    context,
    windowOf("controller"),
    "codex-host-owned-thread:pod-controller",
    root,
  );
  equal(controllerBinding.podName, "feature-pod");
  const designBinding = await registerPodWindow(
    context,
    windowOf("design"),
    "codex-host-owned-thread:pod-design",
    path.join(root, "Design"),
  );
  const testBinding = await registerPodWindow(
    context,
    windowOf("test"),
    "codex-host-owned-thread:pod-test",
    path.join(root, "Test"),
  );
  const missingWorktree = await context.connection.client.callTool({
    name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    arguments: {
      root,
      operation: "register",
      windowId: windowOf("product"),
      observation: {
        handle: { kind: "codex-thread", value: "codex-host-owned-thread:pod-product-nowt" },
        launchIntentDigest: `sha256:${"0".repeat(64)}`,
        observedAt: new Date().toISOString(),
      },
    },
  });
  equal(missingWorktree.isError, true, "a worktree pod product window needs git facts");
  const checkout = path.join(context.workspace.fixtureRoot, "wt-feature-pod");
  gitInProduct(context, "commit", "--quiet", "--allow-empty", "-m", "pod baseline");
  gitInProduct(context, "worktree", "add", "--quiet", checkout, "-b", "wakeflow-feature-pod");
  const worktree = {
    porcelain: gitInProduct(context, "-C", checkout, "worktree", "list", "--porcelain"),
    commonDir: gitInProduct(context, "-C", checkout, "rev-parse", "--git-common-dir").trim(),
  };
  const productHandle = "codex-host-owned-thread:pod-product";
  const productBinding = await registerPodWindow(
    context,
    windowOf("product"),
    productHandle,
    checkout,
    worktree,
  );
  equal(productBinding.worktree?.branch, "wakeflow-feature-pod");
  const readyState = await call(context, WAKEFLOW_POD_PUBLIC_TOOL_NAME, {
    root,
    mode: "recover",
    podId,
  });
  assertNoPrivatePath(context, readyState);
  const ready = readyState.structuredContent as PodMutation;
  equal(ready.disposition, "healthy");
  equal(ready.pod?.state, "ready");
  equal(ready.worktrees[0]?.receipt, "present");

  // 一 pod 一 Demand：第二个包在同一 pod 上被拒，primary 上仍可创建。
  const first = await publishScenarioPackage(context, "Pod scenario requirement");
  const second = await publishScenarioPackage(context, "Pod scenario second requirement");
  const demandPreview = await previewDemandOn(context, first.requirementId, podId);
  equal(demandPreview.status, "ready", demandPreview.blockers.join(","));
  const demandApplied = await call(context, WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "apply",
    requirementId: first.requirementId,
    podId,
    demand: {
      title: "Pod scenario demand",
      goal: "Advance one requirement inside a worktree pod.",
      completionDefinition: "The implementation result is imported from the pod's worktree.",
    },
    planDigest: demandPreview.planDigest,
  });
  const podDemandId = (
    demandApplied.structuredContent as { readonly publication: { readonly demandId: string } }
  ).publication.demandId;
  const busy = await previewDemandOn(context, second.requirementId, podId);
  equal(busy.status, "blocked");
  equal(busy.blockers.includes(`pod-busy:${podDemandId}`), true, busy.blockers.join(","));
  const primaryFree = await previewDemandOn(context, second.requirementId);
  equal(primaryFree.status, "ready", primaryFree.blockers.join(","));

  // 任务只能派给本 pod 的产品窗口；投递 prompt 带 pod 名与相对 worktree 的工作区根。
  context.demandId = podDemandId;
  const planRequest = {
    root,
    demandId: podDemandId,
    idempotencyKey: "scenario-pod-plan-1",
    expectedStreamRevision: 1,
    taskPackage: {
      assignment: { repositoryId: context.repositoryId, windowId: windowOf("product") },
      workType: "implementation",
      objective: "在 pod 的 worktree 里实现最小切片",
      confirmedContext: ["Demand 权威已发布"],
      selectedAuthorityMemberRefs: first.memberRefs,
      boundaries: { inScope: ["最小切片"], outOfScope: ["合并回主线"], forbidden: ["动主检出"] },
      completionExpectations: ["聚焦检查通过"],
      commitExpectation: "leave-uncommitted",
      acceptanceAnchors: [
        {
          anchorId: "pod-slice",
          claim: "最小切片满足需求设计",
          probe: "运行聚焦检查",
          expected: "检查通过",
          requirementRef: {
            recordDigest: first.recordDigest,
            sectionAnchor: "acceptance-criteria",
            itemId: "ac-1",
          },
        },
      ],
      lineage: null,
      sectionAnchors: ["goal"],
    },
  };
  const mismatched = await context.connection.client.callTool({
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    arguments: {
      ...planRequest,
      idempotencyKey: "scenario-pod-plan-mismatch",
      taskPackage: {
        ...planRequest.taskPackage,
        assignment: { repositoryId: context.repositoryId, windowId: context.productWindowId },
      },
    },
  });
  equal(mismatched.isError, true, "a primary product window cannot serve a pod Demand");
  equal(
    scenarioToolText(mismatched).includes("assignment-window-pod-mismatch"),
    true,
    `pod mismatch rejection: ${scenarioToolText(mismatched).slice(0, 180)}`,
  );
  const planned = await call(context, WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME, planRequest);
  const plannedResult = planned.structuredContent as {
    readonly targetTask: { readonly targetTaskId: string; readonly taskPackageId: string };
  };
  const targetTaskId = plannedResult.targetTask.targetTaskId;
  const prepared = await prepareDelivery(
    context,
    "scenario-pod-prepare-1",
    await currentStreamRevision(context),
    targetTaskId,
  );
  equal(prepared.permit.prompt.includes(`feature-pod (${podId})`), true, "prompt names the pod");
  equal(prepared.permit.prompt.includes("../Workspace/"), true, "worktree-relative workspace root");
  equal(
    prepared.permit.prompt.includes(context.workspace.fixtureRoot),
    false,
    "prompt leaked a private path",
  );
  await recordSessionEvent(
    context,
    windowOf("product"),
    productHandle,
    "user-prompt-submit",
    prepared.permit.prompt,
  );
  const outcome = await recordOutcome(context, prepared.permit, "scenario-pod-outcome-1");
  equal(outcome.outcome.disposition, "accepted");

  // worktree pod 的实现结果必须带分支（Codex 的 detached HEAD 规则）；回调落到 pod 的 Controller。
  mkdirSync(path.join(checkout, "artifacts", "pod"), { recursive: true });
  writeFileSync(path.join(checkout, "artifacts", "pod", "verification.txt"), "pod checks passed\n");
  const podEvidence = await recordEvidenceSelection(context, {
    kind: "test-output",
    source: {
      kind: "managed-path",
      root: { kind: "pod-worktree", podId, repositoryId: context.repositoryId },
      path: "artifacts/pod/verification.txt",
      resourceType: "file",
    },
    contentReview: "reject",
  });
  equal(podEvidence.disposition, "recorded");
  const evidence = {
    ref: `artifacts/managed-evidence/${podEvidence.evidenceId}/payload/content`,
    digest: computeSha256Digest(encodeUtf8("pod checks passed\n")),
  };
  const taskPackage = await loadTaskPackage(context, plannedResult.targetTask.taskPackageId);
  const content = createImplementationTargetResultReportContentFixture(taskPackage, evidence);
  const revision = await currentStreamRevision(context);
  const detached = await context.connection.client.callTool({
    name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    arguments: importRequest(
      context,
      prepared.permit,
      "scenario-pod-import-detached",
      revision,
      content,
    ),
  });
  equal(detached.isError, true, "a worktree pod result without a branch must be rejected");
  equal(
    scenarioToolText(detached).includes("worktree-branch-required"),
    true,
    `detached rejection: ${scenarioToolText(detached).slice(0, 180)}`,
  );
  const imported = await call(
    context,
    WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    importRequest(context, prepared.permit, "scenario-pod-import-1", revision, {
      ...content,
      repositoryChange: { ...content.repositoryChange, branch: "wakeflow-feature-pod" },
    }),
  );
  const importResult = imported.structuredContent as ImportResult;
  equal(importResult.status, "committed");
  equal(importResult.callback.permit.hostAction.windowId, windowOf("controller"));
  equal(
    importResult.callback.permit.prompt.includes("feature-pod"),
    true,
    "callback names the pod",
  );

  // 取消前先把待评审的结果评掉（F5.5）：返工决定不需要完成证据。
  const pendingReview = await inspectReview(context, targetTaskId);
  equal(pendingReview.reviewUnit.allowedDecisions.includes("rework"), true, "rework allowed");
  const reworked = await call(
    context,
    WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    implementationDecisionRequest(
      context,
      pendingReview,
      "rework",
      "scenario-pod-rework",
      await currentStreamRevision(context),
    ),
  );
  equal((reworked.structuredContent as DecisionResult).decision.decision, "rework");

  // 关闭第一段：Demand 仍活动 → 阻塞；取消归档后带分支处置 → closing。
  const closeIntent = (branches: readonly unknown[]) => ({ kind: "close", podId, branches });
  const active = await podPreview(context, closeIntent([]));
  equal(active.status, "blocked");
  equal(active.blockers.includes(`demand-active:${podDemandId}`), true, active.blockers.join(","));
  const reason = "Pod scenario cancels its Demand before closing the pod.";
  const cancelPreview = await call(context, WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME, {
    root,
    mode: "preview",
    demandId: podDemandId,
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
    demandId: podDemandId,
    reason,
    planDigest: cancelPlanned.planDigest,
  });
  equal((cancelled.structuredContent as { readonly disposition: string }).disposition, "cancelled");
  const missingDisposition = await podPreview(context, closeIntent([]));
  equal(
    missingDisposition.blockers.includes(`branch-disposition-missing:${context.repositoryId}`),
    true,
    "branch disposition required",
  );
  const closing = await podApply(
    context,
    closeIntent([{ repositoryId: context.repositoryId, disposition: "abandoned" }]),
  );
  equal(closing.disposition, "closing");
  equal(closing.pod?.state, "closing");
  equal(closing.next.frontier, "pod-window-decommission");

  // 关闭第二段：退役四个窗口、处置检出，然后 closed；配置与回执目录都不再有该 pod。
  const boundBlocked = await podPreview(context, closeIntent([]));
  equal(boundBlocked.blockers.filter((entry) => entry.startsWith("window-bound:")).length, 4);
  for (const [role, binding] of [
    ["product", productBinding.binding],
    ["controller", controllerBinding.binding],
    ["design", designBinding.binding],
    ["test", testBinding.binding],
  ] as const) {
    await decommissionPodWindow(context, windowOf(role), binding);
  }
  const disposal = await podPreview(context, closeIntent([]));
  equal(
    disposal.blockers.includes(`worktree-present:${context.repositoryId}`),
    true,
    "checkout still present",
  );
  gitInProduct(context, "worktree", "remove", "--force", checkout);
  const closed = await podApply(context, closeIntent([]));
  equal(closed.disposition, "closed");
  equal(closed.pod, null);
  equal(closed.retiredReceipts, 1);
  const finalConfig = parseWakeflowConfigV3(JSON.parse(readFileSync(configPath, "utf8")));
  equal(finalConfig.pods.length, 1);
  equal(finalConfig.topology.windows.length, 4);
  equal(
    existsSync(path.join(root, ".wakeflow-local", "runtime", "hosts", "codex", "pods", podId)),
    false,
    "receipt directory survived pod closure",
  );
  const unknown = await podPreview(context, closeIntent([]));
  equal(unknown.blockers.includes(`pod-unknown:${podId}`), true, "pod removed from config");
  return `create=${created.disposition}; replay=${replayed.disposition}; ready; pod-busy; plan-mismatch=rejected; prompt=worktree-relative; import=branch-required→${importResult.status}; close=${closing.disposition}→${closed.disposition}`;
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
    "card-08/evidence": scenarioRecordEvidence,
    "card-07/import-and-review": scenarioImportAndReview,
    "card-06/wake-controller": scenarioWakeController,
    "card-07/escalate-and-resume": scenarioEscalateAndResume,
    "card-05/test-contract": scenarioTestContract,
    "card-08/complete-and-archive": scenarioCompleteAndArchive,
    "card-04/complete-and-continue": scenarioCompleteAndContinue,
    "card-10/pod-lifecycle": scenarioPodLifecycle,
  });

test("场景验收骨架在一次性工作区上运行初始化、创建 Demand、规划任务、投递、结果导入与评审、回调、升级续审、测试合同、完成即归档、续接与取消、pod 生命周期并报告结论", async () => {
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
