import { deepEqual, equal, notEqual, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { executeDemandCompletionRequest } from "../../../src/capabilities/demand/lifecycle.js";
import { executeDemandCreationRequest } from "../../../src/capabilities/demand/service.js";
import { executeWindowBindingRequest } from "../../../src/capabilities/endpoint/service.js";
import {
  executeStatusRequest,
  executeVerifyRequest,
} from "../../../src/capabilities/observation/service.js";
import { executeRequirementPublicationRequest } from "../../../src/capabilities/requirement/service.js";
import {
  executeImplementationReviewDecisionRequest,
  executeTargetResultImportRequest,
} from "../../../src/capabilities/result-review/service.js";
import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DELIVERY_LANDING_SILENCE_MILLISECONDS } from "../../../src/governance/delivery/delivery-outcome.js";
import { DELIVERY_REARM_LIMIT } from "../../../src/governance/delivery/delivery-rearm.js";
import { DEMAND_REWORK_ESCALATION_THRESHOLD } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import { WAKEFLOW_OBSERVATION_POLICY } from "../../../src/governance/observation/observation-policy.js";
import {
  TARGET_RESULT_CALLBACK_GENERATION_LIMIT,
  TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS,
} from "../../../src/governance/result/target-result-callback.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { hostHookObservationsRootRef, WORK_CLAIMS_ROOT_REF } from "../../../src/kernel/layout.js";
import {
  MAXIMUM_WORK_CLAIM_GENERATION,
  WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS,
} from "../../../src/kernel/work-claims.js";
import { publishFreshWakeflowWindowRuntime } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import { wakeflowWindowHostBindingRootRef } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-paths.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import {
  deliverFixtureTarget,
  registerFixtureWindowRoute,
  type DeliveryWorkspaceFixture,
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
  recordFixtureEvidence,
  registerFixtureControllerWindow,
  REVIEW_DECIDED_AT,
  REVIEW_DECISION_UUID,
  REVIEW_FIXTURE_REPORTED_AT,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  PLANNING_REPOSITORY_ID,
  planFixtureTargetTask,
} from "../../governance/tasking/target-task-planning-service.fixture.js";
import { CODEX_OBSERVATION_FACADE } from "./observation-facade.fixture.js";

/**
 * 两个读工具的读路径（gate-log §13.94 D1、D2、D3、D4）：status 一次观察多域并给出下一步；
 * 带 demandId 附路由或归档回执；verify 十三门与汇总；hook 观察目录出现非法文件名即
 * host-hook-channel fail；结果不含私有路径与句柄。健康工作区经公共维护工具初始化。
 */

const CONTROLLER_HANDLE = "codex-host-thread:observation-controller";
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
  "window-identity",
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
  const config = parseWakeflowConfigV3(
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
  });

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

test("verify：健康工作区十三门全 pass；hook 观察目录出现非法文件名即 host-hook-channel fail、ok false；删除后恢复；带 demandId 给出 Demand 门", {
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
  deepEqual(plain(verified.summary), { pass: 13, fail: 0, unavailable: 0 });
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
    deepEqual(plain(broken.summary), { pass: 12, fail: 1, unavailable: 0 });
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
    // 归档后没有 Demand 前沿；剩下的只是 primary pod 未登记窗口的登记引导，next 仍来自归档回执。
    equal(
      status.nextActions.every((action) => action.reason === "pod-window-registration"),
      true,
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

test("unmergedAccepted：已接受结果的分支仍在且尖端不等于 HEAD 尖端才列出并带 acceptedAt；仓库未观察时保留且 repositoryObserved 为 false；正检出在该分支上时不判已合并（§13.94 D2）", {
  timeout: 120_000,
}, async () => {
  // 投递夹具的任务包固定 leave-uncommitted，而带提交的报告要求 commit 期望：这里自行规划任务包。
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
      parseWakeflowConfigV3(createMinimalWakeflowConfigV3()),
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

    const expected = {
      demandId: fixture.demandId,
      targetTaskId: fixture.targetTaskId,
      repositoryId: PLANNING_REPOSITORY_ID,
      branch: "feature/result",
      commit: reportedCommit,
      acceptedAt: REVIEW_DECIDED_AT,
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

    // 分支删除：引用不在，不列出。
    git(product, "branch", "-D", "feature/result");
    const deleted = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
    deepEqual(deleted.unmergedAccepted, []);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(planning);
  }
});
