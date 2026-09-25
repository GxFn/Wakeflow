import { deepEqual, equal, notEqual, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  executeDemandCancellationRequest,
  executeDemandCompletionRequest,
} from "../../../src/capabilities/demand/lifecycle.js";
import { executeDemandCreationRequest } from "../../../src/capabilities/demand/service.js";
import { executeWindowBindingRequest } from "../../../src/capabilities/endpoint/service.js";
import {
  executeStatusRequest,
  executeVerifyRequest,
  type ObservationHostFacade,
} from "../../../src/capabilities/observation/service.js";
import { executeRequirementPublicationRequest } from "../../../src/capabilities/requirement/service.js";
import {
  executeImplementationReviewDecisionRequest,
  executeTargetResultImportRequest,
} from "../../../src/capabilities/result-review/service.js";
import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { renderWakeflowConfig } from "../../../src/configuration/wakeflow-config-document.js";
import { readWakeflowConfigAuthoritySnapshot } from "../../../src/configuration/wakeflow-config-authority-snapshot.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DELIVERY_LANDING_SILENCE_MILLISECONDS } from "../../../src/governance/delivery/delivery-outcome.js";
import { DELIVERY_REARM_LIMIT } from "../../../src/governance/delivery/delivery-rearm.js";
import { DEMAND_REWORK_ESCALATION_THRESHOLD } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  buildActiveProjectionFacts,
  unmergedAcceptedFacts,
} from "../../../src/governance/observation/active-projection-facts.js";
import {
  ARCHIVED_DEMAND_SCAN_MAXIMUM,
  observeArchivedDemands,
} from "../../../src/governance/observation/archived-demand-observation.js";
import { WAKEFLOW_OBSERVATION_POLICY } from "../../../src/governance/observation/observation-policy.js";
import {
  type ObservedDemand,
  observeWorkspace,
} from "../../../src/governance/observation/workspace-observation.js";
import {
  TARGET_RESULT_CALLBACK_GENERATION_LIMIT,
  TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS,
} from "../../../src/governance/result/target-result-callback.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import {
  HOST_HOOK_RETENTION_MILLISECONDS,
  writeHostHookObservation,
} from "../../../src/kernel/hook-observations.js";
import {
  hostHookObservationsRootRef,
  podReceiptRootRef,
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
  WORK_CLAIMS_ROOT_REF,
} from "../../../src/kernel/layout.js";
import {
  MAXIMUM_WORK_CLAIM_GENERATION,
  WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS,
} from "../../../src/kernel/work-claims.js";
import { WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF } from "../../../src/workspace/maintenance/wakeflow-maintenance-resource-catalog.js";
import { publishFreshWakeflowWindowRuntime } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import { wakeflowWindowHostBindingRootRef } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-paths.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import {
  type DeliveryWorkspaceFixture,
  deliverFixtureTarget,
  registerFixtureWindowRoute,
} from "../../governance/delivery/delivery-workspace.fixture.js";
import {
  FIXTURE_LANDING_MARKDOWN,
  FIXTURE_REQUIREMENT_MARKDOWN,
} from "../../governance/ledger/requirement-package.fixture.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "../../governance/lifecycle/demand-completion-service.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "../../governance/result/implementation-target-result-report.fixture.js";
import {
  CODEX_REVIEW_FACADE,
  currentFixtureStreamRevision,
  fixtureImplementationDecisionRequest,
  inspectFixtureReview,
  landFixtureTargetCompletion,
  loadFixtureTaskPackage,
  REVIEW_DECIDED_AT,
  REVIEW_DECISION_UUID,
  REVIEW_FIXTURE_REPORTED_AT,
  recordFixtureEvidence,
  registerFixtureControllerWindow,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  PLANNING_POD_ID,
  PLANNING_REPOSITORY_ID,
  planFixtureTargetTask,
} from "../../governance/tasking/target-task-planning-service.fixture.js";
import { CODEX_OBSERVATION_FACADE } from "./observation-facade.fixture.js";

/**
 * 两个读工具的读路径（gate-log §13.94 D1、D2、D3、D4）：status 一次观察多域并给出下一步；
 * 带 demandId 附路由或归档回执；verify 十五门与汇总；hook 观察目录出现非法文件名即
 * host-hook-channel fail；结果不含私有路径与句柄。健康工作区经公共维护工具初始化。
 */

const CONTROLLER_HANDLE = "codex-host-thread:observation-controller";
/** 配置里的 tmux 容器名（旧实现 T08 把它们当私有值断言）：任何公共结果都不得回显。 */
const TMUX_SESSION_SECRET = "private-session-never-return-me";
const TMUX_SOCKET_SECRET = "private-socket-never-return-me";
const UNKNOWN_DEMAND_ID = "demand_ffffffff-ffff-4fff-8fff-ffffffffffff";
const GATE_NAMES = Object.freeze([
  "active-projection",
  "append-candidates-clear",
  "board-consistency",
  "config-authority",
  "demand-root-audit",
  "evidence-integrity",
  "host-hook-channel",
  "host-settings-assets",
  "ledger-layout",
  "local-layout",
  "pod-execution-location",
  "runtime-artifact",
  "window-identity",
  "window-runtime-projection",
  "work-claims",
]);
const CODEX_ENDPOINT_FACADE = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});
const CLOCK = { clock: () => parseUtcInstant("2026-09-18T09:00:00.000Z") };

function git(cwd: string, ...args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

interface HealthyWorkspace {
  readonly base: string;
  readonly root: string;
  readonly product: string;
  readonly demandId: string;
  readonly requirementId: string;
  readonly controllerWindowId: string;
  readonly headCommit: string;
}

/**
 * 经公共工具建立的健康工作区：Codex fresh-initialize → 发布需求包 → 认领即创建 Demand →
 * 登记 Controller 窗口。兄弟产品仓库是带一个提交的真实 Git 仓库。
 */
async function createHealthyWorkspace(): Promise<HealthyWorkspace> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-observation-service-")));
  const root = path.join(base, "Workspace");
  const product = path.join(base, "ProductA");
  mkdirSync(root);
  mkdirSync(product);
  git(root, "init", "--quiet");
  git(product, "init", "--quiet", "--initial-branch=main");
  git(product, "commit", "--quiet", "--allow-empty", "-m", "init");
  const selection = createMinimalWakeflowFreshConfigSelection();
  (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  (selection as Record<string, unknown>).hosts = {
    "claude-code": {
      tmux: { sessionName: TMUX_SESSION_SECRET, socketName: TMUX_SOCKET_SECRET },
    },
  };
  const fresh = await executeCodexWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection },
  });
  if (fresh.mode !== "preview" || fresh.planDigest === null) {
    throw new Error("Expected a ready Fresh plan.");
  }
  await executeCodexWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "apply",
    request: { selection },
    planDigest: fresh.planDigest,
  });
  const config = parseWakeflowConfig(
    JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8")),
  );
  const design = config.topology.supportSurfaces.find((surface) => surface.capability === "design");
  const designWindow = config.topology.windows.find((window) => window.role === "design");
  const controllerWindow = config.topology.windows.find((window) => window.role === "controller");
  if (design === undefined || designWindow === undefined || controllerWindow === undefined) {
    throw new Error("Fresh config lacks the expected topology.");
  }
  const designPath = path.join(root, design.path);
  mkdirSync(path.join(designPath, "drafts"), { recursive: true });
  writeFileSync(path.join(designPath, "drafts", "requirement.md"), FIXTURE_REQUIREMENT_MARKDOWN);
  writeFileSync(path.join(designPath, "drafts", "landing.md"), FIXTURE_LANDING_MARKDOWN);
  const packageInput = {
    designSurfaceId: design.surfaceId,
    title: "示例需求",
    demandType: "requirement",
    priority: "P1",
    originWindowId: designWindow.windowId,
    testingDecision: { mode: "controller-only", summary: "聚焦测试加场景验收。" },
    requirementPath: "drafts/requirement.md",
    landingPath: "drafts/landing.md",
    confirmation: { confirmedAt: "2026-09-04T10:00:00.000Z" },
  };
  const publicationClock = { clock: () => parseUtcInstant("2026-09-04T10:05:00.000Z") };
  const ready = await executeRequirementPublicationRequest(
    { root, mode: "preview", action: "publish", package: packageInput },
    publicationClock,
  );
  if (ready.kind !== "WakeflowRequirementPublicationPreview" || ready.planDigest === null) {
    throw new Error("Expected a ready publication plan.");
  }
  const published = await executeRequirementPublicationRequest(
    { root, mode: "apply", action: "publish", package: packageInput, planDigest: ready.planDigest },
    publicationClock,
  );
  if (published.kind !== "WakeflowRequirementPublicationMutation") {
    throw new Error("Expected a publication mutation.");
  }
  const requirementId = published.package.requirementId;
  const demand = {
    title: "Observation demand",
    goal: "Implement the confirmed requirement.",
    completionDefinition: "The implementation is accepted.",
  };
  const demandPreview = await executeDemandCreationRequest({
    root,
    mode: "preview",
    requirementId,
    demand,
  });
  if (demandPreview.kind !== "WakeflowDemandCreationPreview" || demandPreview.planDigest === null) {
    throw new Error("Expected a ready Demand plan.");
  }
  const created = await executeDemandCreationRequest({
    root,
    mode: "apply",
    requirementId,
    demand,
    planDigest: demandPreview.planDigest,
  });
  if (created.kind !== "WakeflowDemandCreationMutation") throw new Error("Expected a Demand.");

  const inspection = await executeWindowBindingRequest(CODEX_ENDPOINT_FACADE, {
    root,
    operation: "inspect",
    windowId: controllerWindow.windowId,
  });
  if (inspection.kind !== "WakeflowWindowBindingInspection")
    throw new Error("Expected inspection.");
  const rooted = await RootedDirectory.open(root);
  try {
    await writeHostHookObservation(rooted, {
      hostId: "codex",
      event: "session-start",
      sessionId: CONTROLLER_HANDLE,
      cwd: root,
      recordedAt: parseUtcInstant("2026-09-18T08:59:00.000Z"),
    });
  } finally {
    await rooted.close();
  }
  const registered = await executeWindowBindingRequest(
    CODEX_ENDPOINT_FACADE,
    {
      root,
      operation: "register",
      windowId: controllerWindow.windowId,
      observation: {
        handle: { kind: "codex-thread", value: CONTROLLER_HANDLE },
        launchIntentDigest: inspection.launchIntent.intentDigest,
        observedAt: "2026-09-18T08:59:30.000Z",
      },
    },
    CLOCK,
  );
  if (registered.kind !== "WakeflowWindowBindingMutation" || registered.binding === null) {
    throw new Error("Expected a registered binding.");
  }
  return Object.freeze({
    base,
    root,
    product,
    demandId: created.publication.demandId,
    requirementId,
    controllerWindowId: controllerWindow.windowId,
    headCommit: git(product, "rev-parse", "HEAD"),
  });
}

let healthy: HealthyWorkspace;

before(async () => {
  healthy = await createHealthyWorkspace();
});

after(() => {
  if (healthy !== undefined) rmSync(healthy.base, { recursive: true, force: true });
});

/** 经 Schema 准入的结果是 null 原型对象；比较结构时先剥成普通 JSON 值。 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertPrivate(value: unknown, root: string, secrets: readonly string[]): void {
  const text = JSON.stringify(value);
  equal(text.includes(root), false, "result leaked the workspace path");
  for (const secret of secrets) equal(text.includes(secret), false, `result leaked ${secret}`);
}

test("status 不带 demandId：overall、看板计数、Demand、窗口身份、声明、pod、仓库指针、hook 通道、阈值与下一步全部来自同一次观察", {
  timeout: 120_000,
}, async () => {
  const status = await executeStatusRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  equal(status.kind, "WakeflowStatus");
  equal(status.observedAt, CLOCK.clock());
  equal(status.overall, "active");
  equal(status.config.language, "en");
  deepEqual([status.config.pods, status.config.windows, status.config.repositories], [1, 4, 1]);
  deepEqual(plain(status.board.counts), {
    pending: 0,
    parked: 0,
    claimed: 1,
    withdrawn: 0,
    archived: 0,
  });
  deepEqual(status.board.pending, []);
  deepEqual(
    status.demands.map((demand) => [
      demand.demandId,
      demand.status,
      demand.lifecycle,
      demand.disposition,
      demand.frontier,
      demand.owner,
      demand.suggestedTool,
      demand.blockerCount,
    ]),
    [
      [
        healthy.demandId,
        "observed",
        "active",
        "work-available",
        "implementation-task-planning",
        "controller",
        "wakeflow_plan_target_task",
        0,
      ],
    ],
  );

  const controller = status.windows.find(
    (window) => window.windowId === healthy.controllerWindowId,
  );
  if (controller === undefined) throw new Error("controller window missing");
  equal(controller.identity, "registered");
  equal(controller.hostId, "codex");
  equal(typeof controller.bindingId, "string");
  deepEqual(plain(controller.claim), {
    status: "free",
    demandId: null,
    deliveryId: null,
    generation: null,
  });
  deepEqual(plain(controller.lastObservation), {
    event: "session-start",
    recordedAt: "2026-09-18T08:59:00.000Z",
  });
  const unregistered = status.windows.filter(
    (window) => window.windowId !== healthy.controllerWindowId,
  );
  equal(unregistered.length, 3);
  deepEqual(
    unregistered.map((window) => [
      window.identity,
      window.hostId,
      window.bindingId,
      window.lastObservation,
    ]),
    unregistered.map(() => ["unregistered", null, null, null]),
  );

  const claimsPath = path.join(healthy.root, ...WORK_CLAIMS_ROOT_REF.split("/"));
  const claimFiles = existsSync(claimsPath)
    ? readdirSync(claimsPath).filter((name) => name.endsWith(".json"))
    : [];
  equal(status.claims.length, claimFiles.length);
  deepEqual(status.claims, []);

  equal(status.pods.length, 1);
  const pod = status.pods[0];
  if (pod === undefined) throw new Error("pod missing");
  deepEqual(plain(pod), {
    podId: pod.podId,
    name: "main",
    placement: "primary",
    lifecycle: "open",
    state: "creating",
    activeDemandId: healthy.demandId,
    windows: { total: 4, bound: 1 },
    worktrees: [],
  });
  deepEqual(
    status.repositories.map((repository) => [
      repository.status,
      repository.issue,
      repository.head,
      repository.branch,
      repository.detached,
      repository.branches,
      repository.worktrees,
    ]),
    [["observed", null, healthy.headCommit, "main", false, 1, []]],
  );
  deepEqual(
    status.hooks.map((host) => [
      host.hostId,
      host.status,
      host.directory,
      host.records,
      host.skipped,
    ]),
    [
      ["codex", "observed", "private", 1, 0],
      ["claude-code", "observed", "absent", 0, 0],
    ],
  );
  deepEqual(status.unmergedAccepted, []);
  equal(status.projection.status, "current");
  equal(status.projection.targets.length, 4);

  // 阈值原样报告生效常量（§13.94 D7）。
  deepEqual(plain(status.policy), { ...WAKEFLOW_OBSERVATION_POLICY });
  deepEqual(plain(status.policy), {
    deliveryLandingSilenceMilliseconds: DELIVERY_LANDING_SILENCE_MILLISECONDS,
    deliveryRearmLimit: DELIVERY_REARM_LIMIT,
    workClaimGenerationLimit: MAXIMUM_WORK_CLAIM_GENERATION,
    workClaimRecoveryWindowMilliseconds: WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS,
    targetResultCallbackSilenceMilliseconds: TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS,
    targetResultCallbackGenerationLimit: TARGET_RESULT_CALLBACK_GENERATION_LIMIT,
    demandReworkEscalationThreshold: DEMAND_REWORK_ESCALATION_THRESHOLD,
    // §13.97 D7e：hook 记录的保留期进 policy 段，等于内核导出的常量。
    hostHookRetentionMilliseconds: HOST_HOOK_RETENTION_MILLISECONDS,
  });
  equal(status.policy.hostHookRetentionMilliseconds, 30 * 24 * 60 * 60 * 1000);

  // next 取 nextActions 头项：primary pod 的未登记窗口先于 Demand 前沿。
  equal(status.route, null);
  equal(status.archive, null);
  const first = status.nextActions[0];
  if (first === undefined) throw new Error("nextActions is empty");
  deepEqual(
    [first.owner, first.tool, first.reason],
    ["controller", "wakeflow_register_window_binding", "pod-window-registration"],
  );
  equal(first.subject, [...unregistered.map((window) => window.windowId)].sort()[0]);
  deepEqual(plain(status.next), {
    frontier: first.reason,
    owner: first.owner,
    suggestedTool: first.tool,
    blockers: [],
  });
  const registrations = status.nextActions.filter(
    (action) => action.reason === "pod-window-registration",
  );
  equal(registrations.length, 3);
  const demandAction = status.nextActions.findIndex(
    (action) => action.subject === healthy.demandId,
  );
  equal(demandAction, 3);
  equal(status.nextActions[demandAction]?.reason, "implementation-task-planning");
  equal(status.nextActions[demandAction]?.tool, "wakeflow_plan_target_task");

  assertPrivate(status, healthy.root, [CONTROLLER_HANDLE]);
});

test("status 带 demandId：附当前 Route，next 来自 Route 且与 nextActions 里该 Demand 的条目一致；未知 demandId 为 not-found", {
  timeout: 120_000,
}, async () => {
  const status = await executeStatusRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root, demandId: healthy.demandId },
    CLOCK,
  );
  if (status.route === null) throw new Error("route missing");
  equal(status.route.disposition, "work-available");
  equal(status.archive, null);
  equal(status.next.frontier, "implementation-task-planning");
  const entry = status.nextActions.find((action) => action.subject === healthy.demandId);
  if (entry === undefined) throw new Error("demand action missing");
  deepEqual(
    [entry.owner, entry.reason, entry.tool],
    [status.next.owner, status.next.frontier, status.next.suggestedTool],
  );
  notEqual(
    status.next.frontier,
    status.nextActions[0]?.reason,
    "next follows the Route, not the head action",
  );
  assertPrivate(status, healthy.root, [CONTROLLER_HANDLE]);

  await rejects(
    executeStatusRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root, demandId: UNKNOWN_DEMAND_ID },
      CLOCK,
    ),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "not-found" &&
      error.reason === "demand-unknown",
  );
});

test("verify：健康工作区十五门全 pass；hook 观察目录出现非法文件名即 host-hook-channel fail、ok false；删除后恢复；带 demandId 给出 Demand 门", {
  timeout: 120_000,
}, async () => {
  const verified = await executeVerifyRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  equal(verified.kind, "WakeflowVerification");
  deepEqual(
    verified.gates.map((gate) => gate.name),
    GATE_NAMES,
  );
  deepEqual(
    verified.gates.map((gate) => gate.status),
    GATE_NAMES.map(() => "pass"),
  );
  equal(verified.ok, true);
  deepEqual(plain(verified.summary), { pass: 15, fail: 0, unavailable: 0 });
  equal(verified.repairsApplied, false);
  equal(verified.demand, null);
  equal(/^sha256:[0-9a-f]{64}$/u.test(verified.observationDigest), true);
  deepEqual(plain(verified.next), {
    frontier: null,
    owner: "none",
    suggestedTool: null,
    blockers: [],
  });
  equal(verified.gates.find((gate) => gate.name === "local-layout")?.code, null);
  equal(verified.gates.find((gate) => gate.name === "window-identity")?.code, "unregistered:3");
  // §13.97 D10：当前宿主（codex）有记录，同伴宿主（claude-code）的目录缺席保持沉默——code 为 null。
  equal(verified.gates.find((gate) => gate.name === "host-hook-channel")?.code, null);
  assertPrivate(verified, healthy.root, [CONTROLLER_HANDLE]);

  const hooksDirectory = path.join(
    healthy.root,
    ...hostHookObservationsRootRef("codex").split("/"),
  );
  const stray = path.join(hooksDirectory, "stray.json");
  writeFileSync(stray, "{}\n", { mode: 0o600 });
  try {
    const broken = await executeVerifyRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root },
      CLOCK,
    );
    const channel = broken.gates.find((gate) => gate.name === "host-hook-channel");
    deepEqual([channel?.status, channel?.code], ["fail", "codex:skipped-1"]);
    equal(broken.ok, false);
    deepEqual(plain(broken.summary), { pass: 14, fail: 1, unavailable: 0 });
    deepEqual(broken.next.blockers, ["host-hook-channel:fail"]);
    equal(broken.next.suggestedTool, "wakeflow_maintain_workspace");
    notEqual(broken.observationDigest, verified.observationDigest);
  } finally {
    unlinkSync(stray);
  }
  const restored = await executeVerifyRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  equal(restored.ok, true);
  equal(restored.observationDigest, verified.observationDigest);

  const withDemand = await executeVerifyRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root, demandId: healthy.demandId },
    CLOCK,
  );
  if (withDemand.demand === null) throw new Error("demand section missing");
  equal(withDemand.demand.demandId, healthy.demandId);
  equal(withDemand.demand.status, "current");
  deepEqual(
    withDemand.demand.gates.map((gate) => gate.gate),
    [
      "config-authority",
      "ledger-layout",
      "demand-root-audit",
      "board-claim",
      "work-claims-released",
      "append-candidates-clear",
      "evidence-integrity",
    ],
  );
  equal(
    withDemand.demand.gates.every((gate) => gate.status === "pass"),
    true,
  );
  equal(typeof withDemand.demand.observationDigest, "string");
  equal(withDemand.ok, true);
});

test("归档 Demand：完成即归档后带 demandId 的 status 给归档回执、route 为 null、next 指向 continue；verify 的 Demand 段为 archived", {
  timeout: 120_000,
}, async () => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    const root = fixture.workspacePath;
    const preview = await executeDemandCompletionRequest({
      root,
      mode: "preview",
      demandId: fixture.demandId,
    });
    if (preview.kind !== "WakeflowDemandCompletionPreview" || preview.planDigest === null) {
      throw new Error("Expected a ready completion plan.");
    }
    const completed = await executeDemandCompletionRequest({
      root,
      mode: "apply",
      demandId: fixture.demandId,
      planDigest: preview.planDigest,
    });
    if (completed.kind !== "WakeflowDemandCompletionMutation")
      throw new Error("Expected completion.");

    const status = await executeStatusRequest(
      CODEX_OBSERVATION_FACADE,
      { root, demandId: fixture.demandId },
      CLOCK,
    );
    equal(status.route, null);
    if (status.archive === null) throw new Error("archive receipt missing");
    equal(status.archive.demandId, fixture.demandId);
    equal(status.archive.outcome, "completed");
    equal(status.archive.archiveRef, completed.archive.archiveRef);
    equal(status.archive.terminalEvent.streamRevision >= 2, true);
    deepEqual(plain(status.next), {
      frontier: "demand-continuation",
      owner: "controller",
      suggestedTool: "wakeflow_continue_demand",
      blockers: [],
    });
    deepEqual(status.demands, []);
    equal(status.board.counts.archived, 1);
    equal(status.board.counts.claimed, 0);
    // 归档后没有 Demand 前沿；剩下的只是 primary pod 未登记窗口的登记引导（这个手搭的夹具的
    // `.wakeflow-local` 不是 0700，维护协议 conflict，所以 status 先指向维护，§13.129），next 仍来自归档回执。
    equal(
      status.nextActions.every(
        (action) =>
          action.reason === "pod-window-registration" || action.reason === "workspace-maintenance",
      ),
      true,
    );
    equal(
      status.nextActions.some((action) => action.subject === fixture.demandId),
      false,
    );
    assertPrivate(status, root, [fixture.route.rawHandle, fixture.bindingRootPath]);

    const verified = await executeVerifyRequest(
      CODEX_OBSERVATION_FACADE,
      { root, demandId: fixture.demandId },
      CLOCK,
    );
    deepEqual(plain(verified.demand), {
      demandId: fixture.demandId,
      status: "archived",
      gates: [],
      observationDigest: null,
    });
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});

interface AcceptedCommittedResult {
  readonly planning: Awaited<ReturnType<typeof createTargetTaskPlanningWorkspaceFixture>>;
  readonly fixture: Readonly<DeliveryWorkspaceFixture>;
  readonly root: string;
  readonly product: string;
  readonly reportedCommit: string;
}

/**
 * 一个已接受、带分支与提交（`feature/result`）的实现结果。投递夹具的任务包固定
 * leave-uncommitted，而带提交的报告要求 commit 期望：这里自行规划任务包。调用方负责清理 planning。
 */
async function acceptCommittedResult(): Promise<AcceptedCommittedResult> {
  const planning = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const draft = planning.request.taskPackage;
    if (draft.workType !== "implementation") throw new Error("Expected an implementation draft.");
    const planned = await planFixtureTargetTask(planning, {
      taskPackage: { ...draft, commitExpectation: "commit" },
    });
    if (planned.targetTask.workType !== "implementation")
      throw new Error("Expected implementation.");
    mkdirSync(path.join(planning.workspacePath, ".wakeflow-local", "runtime"), { mode: 0o700 });
    await publishFreshWakeflowWindowRuntime(
      planning.workspaceRoot,
      parseWakeflowConfig(createMinimalWakeflowConfig()),
      codexWorkspaceHostResourceProfile,
      { recoveringFreshPublication: false },
    );
    const route = await registerFixtureWindowRoute(planning, planned.targetTask.windowId, {
      value: "codex-host-thread:observation-target",
      uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      observedAt: parseUtcInstant("2026-08-29T12:03:00.000Z"),
      registeredAt: parseUtcInstant("2026-08-29T12:02:00.000Z"),
    });
    const fixture: Readonly<DeliveryWorkspaceFixture> = {
      ...planning,
      demandId: planning.request.demandId,
      targetTaskId: planned.targetTask.targetTaskId,
      taskPackageId: planned.targetTask.taskPackageId,
      route,
      bindingRootPath: path.join(
        planning.workspacePath,
        ...wakeflowWindowHostBindingRootRef(codexWorkspaceHostResourceProfile).split("/"),
      ),
    };
    const root = fixture.workspacePath;
    const product = path.join(fixture.fixtureRoot, "ProductA");
    const reportedCommit = "a".repeat(40);
    await registerFixtureControllerWindow(fixture);
    const delivered = await deliverFixtureTarget(fixture);
    const evidence = await recordFixtureEvidence(fixture);
    const taskPackage = await loadFixtureTaskPackage(
      fixture,
      delivered.envelope.target.taskPackageId,
    );
    // 报告带分支与提交：夹具的内容生成器固定为 left-uncommitted，这里直接经导入切片提交。
    const content = {
      ...createImplementationTargetResultReportContentFixture(taskPackage, evidence),
      repositoryChange: {
        repositoryId: PLANNING_REPOSITORY_ID,
        disposition: "committed",
        branch: "feature/result",
        commits: [{ algorithm: "sha1", value: reportedCommit }],
      },
    };
    const imported = await executeTargetResultImportRequest(
      CODEX_REVIEW_FACADE,
      {
        root,
        demandId: fixture.demandId,
        idempotencyKey: "observation-import-1",
        expectedStreamRevision: await currentFixtureStreamRevision(fixture),
        deliveryId: delivered.prepared.delivery.deliveryId,
        claimDigest: delivered.prepared.permit.fence.claimDigest,
        report: { workType: "implementation", content },
      },
      { clock: () => REVIEW_FIXTURE_REPORTED_AT },
    );
    await landFixtureTargetCompletion(fixture, fixture.route);
    const inspection = await inspectFixtureReview(fixture, fixture.targetTaskId);
    const accepted = await executeImplementationReviewDecisionRequest(
      CODEX_REVIEW_FACADE,
      fixtureImplementationDecisionRequest(fixture, inspection, imported.event.streamRevision),
      { clock: () => REVIEW_DECIDED_AT, uuidFactory: () => REVIEW_DECISION_UUID },
    );
    equal(accepted.target.phase, "accepted");
    return { planning, fixture, root, product, reportedCommit };
  } catch (error: unknown) {
    await cleanupTargetTaskPlanningWorkspaceFixture(planning);
    throw error;
  }
}

/**
 * 把夹具 Demand 所在的 pod 改成活着的 worktree pod（§13.130）：原 pod 连同它的四个窗口改为
 * worktree、改名 feature，另立一个带四个新窗口的 primary pod。只改配置文件，账本不动。
 */
function turnFixturePodIntoWorktree(root: string): void {
  const file = path.join(root, "wakeflow.config.json");
  const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const topology = config.topology as { windows: Record<string, unknown>[] };
  const pods = config.pods as Record<string, unknown>[];
  const feature = pods.find((pod) => pod.podId === PLANNING_POD_ID);
  const product = topology.windows.find(
    (window) => window.podId === PLANNING_POD_ID && window.role === "product",
  );
  if (feature === undefined || product === undefined) throw new Error("fixture pod is missing");
  const repositoryId = (product.root as { repositoryId: string }).repositoryId;
  Object.assign(feature, {
    name: "feature",
    placement: "worktree",
    worktrees: [{ repositoryId, windowId: product.windowId, suggestedName: "wakeflow-feature" }],
  });
  const mainPodId = "pod_f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0";
  const copies = topology.windows
    .filter((window) => window.podId === PLANNING_POD_ID)
    .map((window, index) => ({
      ...window,
      windowId: `window_e${index}e${index}e${index}e${index}-e${index}e${index}-4e${index}e-8e${index}e-e${index}e${index}e${index}e${index}e${index}e${index}`,
      podId: mainPodId,
    }));
  topology.windows.push(...copies);
  pods.unshift({ ...feature, podId: mainPodId, name: "main", placement: "primary", worktrees: [] });
  writeFileSync(file, renderWakeflowConfig(parseWakeflowConfig(config)));
}

test("unmergedAccepted：已接受结果的分支仍在且尖端不等于 HEAD 尖端才列出并带 acceptedAt；仓库未观察或引用读不出时保留且 repositoryObserved 为 false；正检出在该分支上时不判已合并（§13.94 D2）", {
  timeout: 120_000,
}, async () => {
  const { planning, fixture, product, reportedCommit, root } = await acceptCommittedResult();
  try {
    const expected = {
      demandId: fixture.demandId,
      targetTaskId: fixture.targetTaskId,
      repositoryId: PLANNING_REPOSITORY_ID,
      branch: "feature/result",
      commit: reportedCommit,
      acceptedAt: REVIEW_DECIDED_AT,
      source: "active",
    };
    const unobserved = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
    equal(unobserved.repositories[0]?.status, "unavailable");
    deepEqual(plain(unobserved.unmergedAccepted), [{ ...expected, repositoryObserved: false }]);

    // 分支尖端等于 HEAD 尖端：已合并，不列出。
    git(product, "init", "--quiet", "--initial-branch=main");
    git(product, "commit", "--quiet", "--allow-empty", "-m", "c1");
    git(product, "branch", "feature/result");
    const merged = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
    equal(merged.repositories[0]?.status, "observed");
    deepEqual(merged.unmergedAccepted, []);

    // 分支前进：尖端不等于当前分支尖端，列出且 repositoryObserved 为 true。
    git(product, "checkout", "--quiet", "feature/result");
    git(product, "commit", "--quiet", "--allow-empty", "-m", "c2");
    git(product, "checkout", "--quiet", "main");
    const ahead = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
    deepEqual(plain(ahead.unmergedAccepted), [{ ...expected, repositoryObserved: true }]);
    assertPrivate(ahead, root, [fixture.route.rawHandle]);

    // 正检出在该分支上：尖端自然等于 HEAD 尖端，但当前分支就是它，不能判已合并，仍列出。
    git(product, "checkout", "--quiet", "feature/result");
    const checkedOut = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
    equal(checkedOut.repositories[0]?.branch, "feature/result");
    deepEqual(plain(checkedOut.unmergedAccepted), [{ ...expected, repositoryObserved: true }]);
    git(product, "checkout", "--quiet", "main");

    // 引用读不出：分支还在，只是这一轮没看见。仓库仍 observed 但带 branches-incomplete，
    // 条目保留且 repositoryObserved 为 false——读不出引用绝不能把未合并的分支悄悄抹掉。
    const heads = path.join(product, ".git", "refs", "heads");
    const savedMain = readFileSync(path.join(heads, "main"), "utf8");
    const savedFeature = readFileSync(path.join(heads, "feature", "result"), "utf8");
    rmSync(heads, { recursive: true, force: true });
    writeFileSync(heads, "not a directory\n", { mode: 0o600 });
    const unreadable = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
    equal(unreadable.repositories[0]?.status, "observed");
    equal(unreadable.repositories[0]?.issue, "branches-incomplete");
    equal(unreadable.repositories[0]?.branches, 0);
    deepEqual(plain(unreadable.unmergedAccepted), [{ ...expected, repositoryObserved: false }]);

    // 恢复引用：同一份事实又看得见了，核对照常。
    rmSync(heads, { force: true });
    mkdirSync(path.join(heads, "feature"), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(heads, "main"), savedMain, { mode: 0o600 });
    writeFileSync(path.join(heads, "feature", "result"), savedFeature, { mode: 0o600 });
    const restored = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
    equal(restored.repositories[0]?.issue, null);
    deepEqual(plain(restored.unmergedAccepted), [{ ...expected, repositoryObserved: true }]);

    // 分支删除：引用不在，不列出。
    git(product, "branch", "-D", "feature/result");
    const deleted = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
    deepEqual(deleted.unmergedAccepted, []);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(planning);
  }
});

const FAKE_DEMAND_ID = "demand_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function gateOf(gates: readonly Readonly<{ readonly name: string }>[], name: string) {
  const found = gates.find((gate) => gate.name === name);
  if (found === undefined) throw new Error(`gate ${name} missing`);
  return found as Readonly<{
    readonly name: string;
    readonly status: string;
    readonly code: string | null;
  }>;
}

test("claims 域读不出：status 用 domains.claims 报出 unavailable 与 issue（空列表不是“没有声明”），verify 的 work-claims 门是 unavailable 而不是 pass", {
  timeout: 120_000,
}, async () => {
  const claimsPath = path.join(healthy.root, ...WORK_CLAIMS_ROOT_REF.split("/"));
  const aside = `${claimsPath}-aside`;
  const existed = existsSync(claimsPath);
  if (existed) renameSync(claimsPath, aside);
  mkdirSync(path.dirname(claimsPath), { recursive: true });
  writeFileSync(claimsPath, "");
  try {
    const status = await executeStatusRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root },
      CLOCK,
    );
    deepEqual(plain(status.domains.claims), {
      status: "unavailable",
      issue: "claims:not-directory",
    });
    equal(status.domains.demands.status, "observed");
    equal(status.domains.pods.status, "observed");
    deepEqual(status.claims, []);
    equal(status.overall, "degraded");

    const verify = await executeVerifyRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root },
      CLOCK,
    );
    const claims = gateOf(verify.gates, "work-claims");
    deepEqual([claims.status, claims.code], ["unavailable", "claims:not-directory"]);
    equal(verify.ok, false);
  } finally {
    rmSync(claimsPath, { force: true });
    if (existed) renameSync(aside, claimsPath);
  }
});

test("demands 域读不出：status{demandId} 是 precondition-failed/demands-unavailable 而不是 not-found，verify 里依赖活动 Demand 集合的五道门都是 unavailable", {
  timeout: 120_000,
}, async () => {
  const currentPath = path.join(healthy.root, ...WAKEFLOW_ACTIVE_CURRENT_ROOT_REF.split("/"));
  const aside = `${currentPath}-aside`;
  renameSync(currentPath, aside);
  writeFileSync(currentPath, "");
  try {
    const status = await executeStatusRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root },
      CLOCK,
    );
    deepEqual(plain(status.domains.demands), {
      status: "unavailable",
      issue: "demands:not-directory",
    });
    deepEqual(status.demands, []);

    await rejects(
      executeStatusRequest(
        CODEX_OBSERVATION_FACADE,
        { root: healthy.root, demandId: healthy.demandId },
        CLOCK,
      ),
      (error: unknown) =>
        error instanceof WakeflowError &&
        error.code === "precondition-failed" &&
        error.reason === "demands-unavailable",
    );

    const verify = await executeVerifyRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root },
      CLOCK,
    );
    for (const name of [
      "demand-root-audit",
      "append-candidates-clear",
      "evidence-integrity",
      "work-claims",
    ]) {
      const gate = gateOf(verify.gates, name);
      deepEqual([gate.status, gate.code], ["unavailable", "demands:not-directory"], name);
    }
    // 看板根就在 `.wakeflow-active/current/board` 下，这一手同时让看板域读不出：
    // board-consistency 报的是它自己的不可用，而不是转报 demands 的 issue。
    equal(status.board.status, "unavailable");
    const board = gateOf(verify.gates, "board-consistency");
    deepEqual([board.status, board.code], ["unavailable", "unavailable"]);
    equal(verify.ok, false);
  } finally {
    rmSync(currentPath, { force: true });
    renameSync(aside, currentPath);
  }
});

test("活动但读不出的 Demand：verify{demandId} 报 current、门为空、observationDigest 为 null，而不是把它当成归档或未知", {
  timeout: 120_000,
}, async () => {
  const fakeRoot = path.join(
    healthy.root,
    ...WAKEFLOW_ACTIVE_CURRENT_ROOT_REF.split("/"),
    FAKE_DEMAND_ID,
  );
  mkdirSync(fakeRoot, { recursive: true });
  try {
    const status = await executeStatusRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root },
      CLOCK,
    );
    const summary = status.demands.find((demand) => demand.demandId === FAKE_DEMAND_ID);
    if (summary === undefined) throw new Error("the unreadable Demand left the listing");
    equal(summary.status, "unavailable");
    notEqual(summary.issue, null);

    const verify = await executeVerifyRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root, demandId: FAKE_DEMAND_ID },
      CLOCK,
    );
    deepEqual(plain(verify.demand), {
      demandId: FAKE_DEMAND_ID,
      status: "current",
      gates: [],
      observationDigest: null,
    });

    // 归档定位仍然只服务真正不在活动集合里的 demandId。
    const unknown = await executeVerifyRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root, demandId: UNKNOWN_DEMAND_ID },
      CLOCK,
    );
    equal(unknown.demand?.status, "unknown");
  } finally {
    rmSync(fakeRoot, { recursive: true, force: true });
  }
});

test("pods 域读不出：status 用 domains.pods 报出 issue，未登记窗口不再被当成活动 pod 的登记动作，verify 的 pod-execution-location 是 unavailable", {
  timeout: 120_000,
}, async () => {
  const before = await executeStatusRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  const podId = before.pods[0]?.podId;
  if (podId === undefined) throw new Error("the healthy workspace lost its pod");
  equal(
    before.nextActions.some((action) => action.reason === "pod-window-registration"),
    true,
    "the healthy workspace should still have registration actions",
  );

  const podRoot = path.join(healthy.root, ...podReceiptRootRef("codex", podId).split("/"));
  const existed = existsSync(podRoot);
  mkdirSync(podRoot, { recursive: true });
  const worktreesPath = path.join(podRoot, "worktrees");
  writeFileSync(worktreesPath, "");
  try {
    const status = await executeStatusRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root },
      CLOCK,
    );
    deepEqual(plain(status.domains.pods), {
      status: "unavailable",
      issue: "pods:receipt-listing-not-directory",
    });
    deepEqual(status.pods, []);
    deepEqual(
      status.nextActions.filter((action) => action.reason === "pod-window-registration"),
      [],
    );

    const verify = await executeVerifyRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root },
      CLOCK,
    );
    const pods = gateOf(verify.gates, "pod-execution-location");
    deepEqual([pods.status, pods.code], ["unavailable", "pods:receipt-listing-not-directory"]);
  } finally {
    rmSync(worktreesPath, { force: true });
    if (!existed) rmSync(podRoot, { recursive: true, force: true });
  }
});

test("仓库指针的分支名按 git 的 ref 文法收：`release/2.0+hotfix` 照常报出，而不是让整次 status 被输出边界挡下", {
  timeout: 120_000,
}, async () => {
  const branch = "release/2.0+hotfix";
  git(healthy.product, "branch", branch);
  git(healthy.product, "checkout", "--quiet", branch);
  try {
    const status = await executeStatusRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root },
      CLOCK,
    );
    const repository = status.repositories[0];
    if (repository === undefined) throw new Error("repository missing");
    deepEqual(
      [repository.status, repository.branch, repository.detached],
      ["observed", branch, false],
    );
  } finally {
    git(healthy.product, "checkout", "--quiet", "main");
    git(healthy.product, "branch", "-D", branch);
  }
});

test("仓库登记的 worktree 超过 wire 上限：截到 64 条并在 truncated.worktrees 报出略去的条数，而不是让整次 status 失败", {
  timeout: 120_000,
}, async () => {
  const worktreesRoot = path.join(healthy.product, ".git", "worktrees");
  const existed = existsSync(worktreesRoot);
  mkdirSync(worktreesRoot, { recursive: true });
  const created: string[] = [];
  for (let index = 0; index < 65; index += 1) {
    const directory = path.join(worktreesRoot, `wt-${String(index).padStart(3, "0")}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "HEAD"), "ref: refs/heads/main\n");
    created.push(directory);
  }
  try {
    const status = await executeStatusRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root },
      CLOCK,
    );
    const repository = status.repositories[0];
    if (repository === undefined) throw new Error("repository missing");
    equal(repository.worktrees.length, 64);
    equal(repository.worktrees[0]?.name, "wt-000");
    equal(repository.worktrees[63]?.name, "wt-063");
    // 每个有 wire 上限的数组都有自己的略去计数：这里只有 worktree 越界，其余为 0。
    deepEqual(plain(status.truncated), {
      demands: 0,
      windows: 0,
      claims: 0,
      pods: 0,
      repositories: 0,
      worktrees: 1,
      unmergedAccepted: 0,
      archives: 0,
    });
  } finally {
    if (existed)
      for (const directory of created) rmSync(directory, { recursive: true, force: true });
    else rmSync(worktreesRoot, { recursive: true, force: true });
  }
});

test("verify 的加读阶段被中止：错误收敛为 io-failure/aborted，而不是 unexpected/unhandled", {
  timeout: 120_000,
}, async () => {
  const controller = new AbortController();
  let reads = 0;
  // facade.hosts 第一次被读是建观察上下文；之后再被读已经是 verify 的工作区加读
  // （local-layout），在那一刻中止就落在加读的 catch 分支上。
  const facade: Readonly<ObservationHostFacade> = {
    hostId: CODEX_OBSERVATION_FACADE.hostId,
    get hosts() {
      reads += 1;
      if (reads > 1) controller.abort();
      return CODEX_OBSERVATION_FACADE.hosts;
    },
  };
  await rejects(
    executeVerifyRequest(
      facade,
      { root: healthy.root },
      { clock: CLOCK.clock, signal: controller.signal },
    ),
    (error: unknown) =>
      error instanceof WakeflowError && error.code === "io-failure" && error.reason === "aborted",
  );
  equal(reads > 1, true, "the verify reads never reached the facade");
});

test("制品身份（§13.127）：没有 manifest 的门面一律 unknown；带门面时窗口按 session-start 记录里的摘要判 current / stale，磁盘上的 manifest 变了报 changed，verify 与 nextActions 都能看到", {
  timeout: 120_000,
}, async () => {
  const plainStatus = await executeStatusRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  deepEqual(plain(plainStatus.runtime), {
    artifactManifestDigest: null,
    artifactOnDisk: "unknown",
  });
  equal(
    plainStatus.windows.every((window) => window.artifact === "unknown"),
    true,
  );
  const current = `sha256:${"d".repeat(64)}`;
  const other = `sha256:${"e".repeat(64)}`;
  const facadeWith = (onDisk: string) =>
    Object.freeze({
      ...CODEX_OBSERVATION_FACADE,
      artifact: Object.freeze({ manifestDigest: current, readCurrentManifestDigest: () => onDisk }),
    }) as typeof CODEX_OBSERVATION_FACADE;
  // 绑定会话在同一份制品下启动：current。
  const rooted = await RootedDirectory.open(healthy.root);
  try {
    await writeHostHookObservation(rooted, {
      hostId: "codex",
      event: "session-start",
      sessionId: CONTROLLER_HANDLE,
      cwd: healthy.root,
      recordedAt: parseUtcInstant("2026-09-18T08:59:30.000Z"),
      artifactManifestDigest: current as never,
    });
  } finally {
    await rooted.close();
  }
  const same = await executeStatusRequest(facadeWith(current), { root: healthy.root }, CLOCK);
  deepEqual(plain(same.runtime), { artifactManifestDigest: current, artifactOnDisk: "same" });
  const controller = same.windows.find((window) => window.role === "controller");
  equal(controller?.artifact, "current");
  equal(
    same.nextActions.some((action) => action.reason === "window-artifact-stale"),
    false,
  );
  // 更晚的 session-start 在另一份制品下：stale；磁盘上的 manifest 也换了：changed。
  const rootedAgain = await RootedDirectory.open(healthy.root);
  try {
    await writeHostHookObservation(rootedAgain, {
      hostId: "codex",
      event: "session-start",
      sessionId: CONTROLLER_HANDLE,
      cwd: healthy.root,
      recordedAt: parseUtcInstant("2026-09-18T08:59:45.000Z"),
      artifactManifestDigest: other as never,
    });
  } finally {
    await rootedAgain.close();
  }
  const stale = await executeStatusRequest(facadeWith(other), { root: healthy.root }, CLOCK);
  deepEqual(plain(stale.runtime), { artifactManifestDigest: current, artifactOnDisk: "changed" });
  equal(stale.windows.find((window) => window.role === "controller")?.artifact, "stale");
  deepEqual(
    stale.nextActions
      .filter(
        (action) =>
          action.reason === "window-artifact-stale" ||
          action.reason === "runtime-artifact-outdated",
      )
      .map((action) => [action.owner, action.reason, action.subject]),
    [
      ["user", "runtime-artifact-outdated", null],
      ["controller", "window-artifact-stale", controller?.windowId ?? null],
    ],
  );
  const verified = await executeVerifyRequest(facadeWith(other), { root: healthy.root }, CLOCK);
  const gate = verified.gates.find((entry) => entry.name === "runtime-artifact");
  deepEqual([gate?.status, gate?.code], ["fail", "server-outdated,windows-stale:1"]);
});

/** 旧实现 T08 的零写断言：逐节点的类型、模式、大小与 mtime/ctime（不含 atime：只读也会更新它）。 */
function snapshotTree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (current: string, ref: string): void => {
    const stat = lstatSync(current, { bigint: true });
    const type = stat.isSymbolicLink()
      ? "symlink"
      : stat.isDirectory()
        ? "directory"
        : stat.isFile()
          ? "file"
          : "other";
    result[ref] = [type, Number(stat.mode & 0o777n), stat.size, stat.mtimeNs, stat.ctimeNs].join(
      ":",
    );
    if (type !== "directory") return;
    for (const name of readdirSync(current).sort())
      visit(path.join(current, name), `${ref}/${name}`);
  };
  visit(root, ".");
  return result;
}

test("观察零写且确定（旧实现 T08）：status 与 verify 前后工作区与产品仓库逐节点相同；同一时钟下两次结果逐字节相同", {
  timeout: 120_000,
}, async () => {
  const before = { root: snapshotTree(healthy.root), product: snapshotTree(healthy.product) };
  const status = await executeStatusRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  const verify = await executeVerifyRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  deepEqual(snapshotTree(healthy.root), before.root, "status/verify wrote into the workspace");
  deepEqual(
    snapshotTree(healthy.product),
    before.product,
    "status/verify wrote into the product repository",
  );
  const statusAgain = await executeStatusRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  const verifyAgain = await executeVerifyRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  deepEqual(plain(statusAgain), plain(status));
  deepEqual(plain(verifyAgain), plain(verify));
  equal(verify.repairsApplied, false);
});

test("私有值不出结果（旧实现 T08）：配置里的 tmux 会话名与 socket 名、绑定句柄、一次性目录与工作区根都不进 status 与 verify", {
  timeout: 120_000,
}, async () => {
  const config = readFileSync(path.join(healthy.root, "wakeflow.config.json"), "utf8");
  equal(
    config.includes(TMUX_SESSION_SECRET) && config.includes(TMUX_SOCKET_SECRET),
    true,
    "the fixture config must carry the tmux names for the assertion to mean anything",
  );
  const status = await executeStatusRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  const verify = await executeVerifyRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  const secrets = [CONTROLLER_HANDLE, TMUX_SESSION_SECRET, TMUX_SOCKET_SECRET, healthy.base];
  assertPrivate(status, healthy.root, secrets);
  assertPrivate(verify, healthy.root, secrets);
});

test("不是工作区的目录（旧实现 T08）：status 是 precondition-failed/config-authority，零写", async () => {
  const empty = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-observation-empty-")));
  try {
    const before = snapshotTree(empty);
    await rejects(
      executeStatusRequest(CODEX_OBSERVATION_FACADE, { root: empty }, CLOCK),
      (error: unknown) =>
        error instanceof WakeflowError &&
        error.code === "precondition-failed" &&
        error.reason === "config-authority",
    );
    deepEqual(snapshotTree(empty), before);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("被打断的维护事务（旧实现 maintenance-gate，§13.129）：transactions 残留让 verify 的 local-layout 失败、status 记 maintenance 并指向维护；清掉后恢复", {
  timeout: 120_000,
}, async () => {
  const before = await executeStatusRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  deepEqual(plain(before.maintenance), {
    status: "observed",
    protocol: "idle",
    residues: [],
    residuesOmitted: 0,
  });
  const transactions = path.join(
    healthy.root,
    ...WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF.split("/"),
  );
  mkdirSync(transactions, { recursive: true, mode: 0o700 });
  const residue = path.join(
    transactions,
    "operation_00000000-0000-4000-8000-000000000000.intent.json",
  );
  writeFileSync(residue, "{}\n", { mode: 0o600 });
  try {
    const status = await executeStatusRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root },
      CLOCK,
    );
    equal(status.overall, "maintenance");
    // 名字不合 `maintenance_operation_<uuid>` 约定：recover 找不到它，status 如实说（§13.130）。
    deepEqual(plain(status.maintenance), {
      status: "observed",
      protocol: "recovery-required",
      residues: [
        {
          name: "operation_00000000-0000-4000-8000-000000000000.intent.json",
          kind: "unknown",
          operationId: null,
          recoverable: false,
        },
      ],
      residuesOmitted: 0,
    });
    equal(status.next.frontier, "workspace-maintenance");
    equal(status.nextActions[0]?.reason, "workspace-maintenance");
    const verify = await executeVerifyRequest(
      CODEX_OBSERVATION_FACADE,
      { root: healthy.root },
      CLOCK,
    );
    const gate = verify.gates.find((entry) => entry.name === "local-layout");
    equal(gate?.status, "fail");
    equal(gate?.code?.includes("maintenance-protocol-recovery-required"), true, gate?.code ?? "");
    equal(verify.ok, false);
  } finally {
    unlinkSync(residue);
  }
  const after = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root: healthy.root }, CLOCK);
  equal(after.overall, before.overall);
  deepEqual(plain(after.maintenance), {
    status: "observed",
    protocol: "idle",
    residues: [],
    residuesOmitted: 0,
  });
  const verified = await executeVerifyRequest(
    CODEX_OBSERVATION_FACADE,
    { root: healthy.root },
    CLOCK,
  );
  equal(verified.gates.find((entry) => entry.name === "local-layout")?.status, "pass");
});

test("unmergedAccepted 跨过归档（§13.130）：worktree pod 的已归档 Demand 的已接受分支以 source archived 列出且投影不含；primary pod 的归档不读；扫描有上限", {
  timeout: 180_000,
}, async () => {
  const { planning, fixture, product, reportedCommit, root } = await acceptCommittedResult();
  const ledgerPath = path.join(planning.fixtureRoot, "wakeflow-ledger");
  try {
    git(product, "init", "--quiet", "--initial-branch=main");
    git(product, "commit", "--quiet", "--allow-empty", "-m", "c1");
    git(product, "checkout", "--quiet", "-b", "feature/result");
    git(product, "commit", "--quiet", "--allow-empty", "-m", "c2");
    git(product, "checkout", "--quiet", "main");

    const preview = await executeDemandCompletionRequest({
      root,
      mode: "preview",
      demandId: fixture.demandId,
    });
    if (preview.kind !== "WakeflowDemandCompletionPreview" || preview.planDigest === null) {
      throw new Error(`Expected a ready completion plan: ${JSON.stringify(preview).slice(0, 600)}`);
    }
    await executeDemandCompletionRequest({
      root,
      mode: "apply",
      demandId: fixture.demandId,
      planDigest: preview.planDigest,
    });

    // 这个 Demand 在 primary pod：归档后它的已接受分支不再列出，归档域读得出且什么都没读。
    const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
    deepEqual(status.demands, []);
    deepEqual(status.unmergedAccepted, []);
    deepEqual(plain(status.domains.archives), { status: "observed", issue: null });
    equal(status.truncated.archives, 0);

    // 归档读取端到端：把它所在的 pod 当成活着的 worktree pod，真实的归档清单与 payload 读得出评审快照。
    const ledgerRoot = await RootedDirectory.open(ledgerPath);
    const workspaceRoot = await RootedDirectory.open(root);
    try {
      const candidate = { demandId: fixture.demandId, archivedAt: "2026-09-25T00:00:00.000Z" };
      const archived = await observeArchivedDemands(
        ledgerRoot,
        [candidate],
        new Set([PLANNING_POD_ID]),
        undefined,
      );
      deepEqual([archived.scanned, archived.skipped, archived.unreadable], [1, 0, 0]);
      deepEqual(
        archived.demands.map((demand) => [demand.demandId, demand.podId]),
        [[fixture.demandId, PLANNING_POD_ID]],
      );
      // 没有活着的 worktree pod：一个归档都不读。
      deepEqual(
        { ...(await observeArchivedDemands(ledgerRoot, [candidate], new Set(), undefined)) },
        { demands: [], scanned: 0, skipped: 0, unreadable: 0 },
      );

      // 合并：带着这份归档域的 full 观察把分支以 source archived 列出；投影事实不含它。
      const snapshot = await readWakeflowConfigAuthoritySnapshot(workspaceRoot);
      const observation = await observeWorkspace(workspaceRoot, snapshot, ledgerRoot, {
        hosts: CODEX_OBSERVATION_FACADE.hosts,
        currentHostId: CODEX_OBSERVATION_FACADE.hostId,
        scope: "full",
      });
      const withArchive = Object.freeze({
        ...observation,
        archives: Object.freeze({ status: "observed" as const, issue: null, value: archived }),
      });
      deepEqual(
        unmergedAcceptedFacts(withArchive).map((fact) => ({ ...fact })),
        [
          {
            demandId: fixture.demandId,
            targetTaskId: fixture.targetTaskId,
            repositoryId: PLANNING_REPOSITORY_ID,
            branch: "feature/result",
            commit: reportedCommit,
            acceptedAt: REVIEW_DECIDED_AT,
            repositoryObserved: true,
            source: "archived",
          },
        ],
      );
      deepEqual(buildActiveProjectionFacts(withArchive).unmergedAccepted, []);
      // 同一 Demand 又是活动的（续做后重开）：归档那一份不再列出，不看看板状态（§13.130）。
      const reopened = Object.freeze({
        ...withArchive,
        demands: Object.freeze({
          status: "observed" as const,
          issue: null,
          value: Object.freeze([
            { demandId: fixture.demandId, reviewSnapshot: null } as unknown as ObservedDemand,
          ]),
        }),
      });
      deepEqual(unmergedAcceptedFacts(reopened), []);

      // 分支合并掉（当前分支尖端等于它的尖端）之后，归档里的这一条也不再列出。
      git(product, "merge", "--quiet", "--ff-only", "feature/result");
      const merged = await observeWorkspace(workspaceRoot, snapshot, ledgerRoot, {
        hosts: CODEX_OBSERVATION_FACADE.hosts,
        currentHostId: CODEX_OBSERVATION_FACADE.hostId,
        scope: "full",
      });
      deepEqual(
        unmergedAcceptedFacts(
          Object.freeze({
            ...merged,
            archives: Object.freeze({ status: "observed" as const, issue: null, value: archived }),
          }),
        ),
        [],
      );

      // 扫描上限（§13.130）：候选按终态时间新到旧；清单上限截掉较旧的候选并计入 skipped，
      // 找不到归档的候选不算读不出。
      const newer = [1, 2].map((index) => ({
        demandId: `demand_${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
        archivedAt: `2026-09-2${5 + index}T00:00:00.000Z`,
      }));
      const worktreeIds = new Set([PLANNING_POD_ID]);
      const capped = await observeArchivedDemands(
        ledgerRoot,
        [candidate, ...newer],
        worktreeIds,
        undefined,
        { manifests: 2, snapshots: ARCHIVED_DEMAND_SCAN_MAXIMUM },
      );
      deepEqual(
        [capped.scanned, capped.skipped, capped.unreadable, capped.demands.length],
        [0, 1, 0, 0],
      );
      const reached = await observeArchivedDemands(
        ledgerRoot,
        [...newer, candidate],
        worktreeIds,
        undefined,
        { manifests: 3, snapshots: ARCHIVED_DEMAND_SCAN_MAXIMUM },
      );
      deepEqual(
        reached.demands.map((demand) => demand.demandId),
        [fixture.demandId],
      );
      // 快照上限只数 worktree pod 的归档：别的 pod 的归档（这里当作 primary）不占预算。
      const noBudget = { manifests: 3, snapshots: 0 };
      const overSnapshots = await observeArchivedDemands(
        ledgerRoot,
        [candidate],
        worktreeIds,
        undefined,
        noBudget,
      );
      deepEqual([overSnapshots.scanned, overSnapshots.skipped], [0, 1]);
      const otherPod = await observeArchivedDemands(
        ledgerRoot,
        [candidate],
        new Set(["pod_f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0"]),
        undefined,
        noBudget,
      );
      deepEqual([otherPod.scanned, otherPod.skipped, otherPod.demands.length], [0, 0, 0]);
    } finally {
      await workspaceRoot.close();
      await ledgerRoot.close();
    }
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(planning);
  }
});

test("unmergedAccepted 跨过取消（§13.130）：worktree pod 的 Demand 接受分支后取消，status 以 source archived 列出；归档 payload 坏了只计数", {
  timeout: 180_000,
}, async () => {
  const { planning, fixture, product, reportedCommit, root } = await acceptCommittedResult();
  try {
    git(product, "init", "--quiet", "--initial-branch=main");
    git(product, "commit", "--quiet", "--allow-empty", "-m", "c1");
    git(product, "checkout", "--quiet", "-b", "feature/result");
    git(product, "commit", "--quiet", "--allow-empty", "-m", "c2");
    git(product, "checkout", "--quiet", "main");
    const request = { root, demandId: fixture.demandId, reason: "No longer wanted." };
    const preview = await executeDemandCancellationRequest({ ...request, mode: "preview" });
    if (preview.kind !== "WakeflowDemandCancellationPreview" || preview.planDigest === null) {
      throw new Error(
        `Expected a ready cancellation plan: ${JSON.stringify(preview).slice(0, 600)}`,
      );
    }
    await executeDemandCancellationRequest({
      ...request,
      mode: "apply",
      planDigest: preview.planDigest,
    });
    turnFixturePodIntoWorktree(root);

    // 端到端：配置里有活着的 worktree pod，取消归档的 Demand 的已接受分支经 schema 准入列出。
    const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
    deepEqual(status.demands, []);
    deepEqual(plain(status.unmergedAccepted), [
      {
        demandId: fixture.demandId,
        targetTaskId: fixture.targetTaskId,
        repositoryId: PLANNING_REPOSITORY_ID,
        branch: "feature/result",
        commit: reportedCommit,
        acceptedAt: REVIEW_DECIDED_AT,
        repositoryObserved: true,
        source: "archived",
      },
    ]);
    deepEqual(plain(status.domains.archives), { status: "observed", issue: null });
    equal(status.truncated.archives, 0);

    // 归档 payload 坏了：status 照常返回，这一条不列出，归档域给出读不出的计数。
    const archives = path.join(
      planning.fixtureRoot,
      "wakeflow-ledger",
      "archives",
      fixture.demandId,
    );
    for (const file of readdirSync(archives, { recursive: true, encoding: "utf8" })) {
      const full = path.join(archives, file);
      if (file.includes("payload") && file.endsWith(".json") && lstatSync(full).isFile()) {
        writeFileSync(full, "{");
      }
    }
    const corrupt = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
    deepEqual(corrupt.unmergedAccepted, []);
    deepEqual(plain(corrupt.domains.archives), {
      status: "observed",
      issue: "archives:unreadable-1",
    });
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(planning);
  }
});
