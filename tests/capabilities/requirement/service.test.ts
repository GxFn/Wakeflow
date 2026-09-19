import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  executeBoardInspectionRequest,
  executeRequirementPublicationRequest,
} from "../../../src/capabilities/requirement/service.js";
import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { executeDemandCreationRequest } from "../../../src/capabilities/demand/service.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import {
  FIXTURE_LANDING_MARKDOWN,
  FIXTURE_REQUIREMENT_MARKDOWN,
} from "../../governance/ledger/requirement-package.fixture.js";
import { createPreparedWorkspaceStore } from "../../support/prepared-workspace.js";

/**
 * requirement 切片测试：一次性工作区经 Fresh 初始化后，走两段 preview、apply、重放、
 * supersedes、activate、withdraw、recover 与看板查询；隐私命中与缺章在 preview 阻塞。
 */

interface Workspace {
  readonly root: string;
  readonly designSurfaceId: string;
  readonly designPath: string;
  readonly designWindowId: string;
}

interface WorkspaceFacts {
  readonly designSurfaceId: string;
  readonly designRelativePath: string;
  readonly designWindowId: string;
}

/**
 * Fresh 初始化链只跑一次：本文件四个测试都从同一个"已初始化、草稿目录已建好"的工作区出发，
 * 之前每个测试各跑一遍 `fresh-initialize` 的 preview 与 apply。链留在基线里，每个测试仍然
 * 按需复制到自己的临时目录，仍是真实文件系统工作区，仍在 `t.after` 里删掉自己的副本。
 */
const requirementWorkspaceStore = createPreparedWorkspaceStore<undefined, Readonly<WorkspaceFacts>>(
  {
    prefix: "wakeflow-requirement-slice-",
    keyOf: () => "fresh",
    build: async (fixtureRoot) => {
      const initialized = spawnSync("git", ["init", "--quiet"], {
        cwd: fixtureRoot,
        encoding: "utf8",
        shell: false,
      });
      if (initialized.status !== 0) throw new Error("Cannot initialize fixture Git.");
      const selection = createMinimalWakeflowFreshConfigSelection();
      (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
      const preview = await executeCodexWakeflowMaintenance({
        root: fixtureRoot,
        action: "fresh-initialize",
        mode: "preview",
        request: { selection },
      });
      if (preview.mode !== "preview" || preview.planDigest === null)
        throw new Error("Expected a ready Fresh plan.");
      await executeCodexWakeflowMaintenance({
        root: fixtureRoot,
        action: "fresh-initialize",
        mode: "apply",
        request: { selection },
        planDigest: preview.planDigest,
      });
      const config = parseWakeflowConfig(
        JSON.parse(readFileSync(path.join(fixtureRoot, "wakeflow.config.json"), "utf8")),
      );
      const design = config.topology.supportSurfaces.find(
        (surface) => surface.capability === "design",
      );
      const designWindow = config.topology.windows.find((window) => window.role === "design");
      if (design === undefined || designWindow === undefined)
        throw new Error("Fresh config lacks a design surface.");
      mkdirSync(path.join(fixtureRoot, design.path, "drafts"), { recursive: true });
      return Object.freeze({
        designSurfaceId: design.surfaceId,
        designRelativePath: design.path,
        designWindowId: designWindow.windowId,
      });
    },
  },
);

async function fixture(t: TestContext): Promise<Workspace> {
  const prepared = await requirementWorkspaceStore.materialize(undefined);
  t.after(() => rmSync(prepared.fixtureRoot, { recursive: true, force: true }));
  const root = realpathSync(prepared.fixtureRoot);
  return {
    root,
    designSurfaceId: prepared.facts.designSurfaceId,
    designPath: path.join(root, prepared.facts.designRelativePath),
    designWindowId: prepared.facts.designWindowId,
  };
}

function writeDrafts(
  workspace: Workspace,
  requirement = FIXTURE_REQUIREMENT_MARKDOWN,
  landing = FIXTURE_LANDING_MARKDOWN,
) {
  writeFileSync(path.join(workspace.designPath, "drafts", "requirement.md"), requirement, {
    mode: 0o644,
  });
  writeFileSync(path.join(workspace.designPath, "drafts", "landing.md"), landing, { mode: 0o644 });
}

function packageInput(workspace: Workspace, overrides: Record<string, unknown> = {}) {
  return {
    designSurfaceId: workspace.designSurfaceId,
    title: "示例需求",
    demandType: "requirement",
    priority: "P1",
    originWindowId: workspace.designWindowId,
    testingDecision: { mode: "controller-only", summary: "聚焦测试加场景验收。" },
    requirementPath: "drafts/requirement.md",
    landingPath: "drafts/landing.md",
    ...overrides,
  };
}

const CONFIRMED_AT = "2026-09-04T10:00:00.000Z";
const clock = () => parseUtcInstant("2026-09-04T10:05:00.000Z");

async function expectFailure(
  promise: Promise<unknown>,
  code: string,
  reason: string,
): Promise<void> {
  await rejects(promise, (error: unknown) => {
    if (!(error instanceof WakeflowError)) return false;
    equal(`${error.code}/${error.reason}`, `${code}/${reason}`);
    return true;
  });
}

test("发布：缺确认阻塞并给摘要，确认后 ready，apply 写记录并上板，同内容重发为 current", {
  timeout: 60_000,
}, async (t) => {
  const workspace = await fixture(t);
  const root = workspace.root;
  writeDrafts(workspace);
  const blocked = await executeRequirementPublicationRequest(
    { root, mode: "preview", action: "publish", package: packageInput(workspace) },
    { clock },
  );
  if (blocked.kind !== "WakeflowRequirementPublicationPreview")
    throw new Error("Expected a preview.");
  equal(blocked.status, "blocked");
  deepEqual(blocked.blockers, ["user-confirmation-missing"]);
  equal(blocked.next.frontier, "requirement-confirmation");
  deepEqual(
    blocked.summary?.sections.map((section) => section.anchor),
    ["goal", "completion-definition", "non-goals", "testing-decision"],
  );
  equal(JSON.stringify(blocked).includes(root), false, "preview leaked the workspace path");

  const request = {
    root,
    mode: "preview",
    action: "publish",
    package: packageInput(workspace, { confirmation: { confirmedAt: CONFIRMED_AT } }),
  };
  const ready = await executeRequirementPublicationRequest(request, { clock });
  if (ready.kind !== "WakeflowRequirementPublicationPreview" || ready.planDigest === null)
    throw new Error("Expected a ready preview.");
  equal(ready.status, "ready");
  equal(ready.next.frontier, "requirement-publication-apply");
  equal(ready.requirementId?.startsWith("requirement_"), true);

  const applied = await executeRequirementPublicationRequest(
    { ...request, mode: "apply", planDigest: ready.planDigest },
    { clock },
  );
  if (applied.kind !== "WakeflowRequirementPublicationMutation")
    throw new Error("Expected a mutation.");
  equal(applied.disposition, "published");
  equal(applied.package.requirementId, ready.requirementId);
  equal(applied.package.status, "pending");
  equal(applied.package.revision, 1);
  equal(applied.next.frontier, "requirement-claim");
  equal(applied.next.suggestedTool, "wakeflow_create_demand");
  const recordDir = path.join(root, "Ledger", "requirements", applied.package.requirementId);
  equal(existsSync(path.join(recordDir, "record.json")), true);
  equal(existsSync(path.join(recordDir, "requirement.md")), true);
  equal(existsSync(path.join(recordDir, "landing.md")), true);
  const record = JSON.parse(readFileSync(path.join(recordDir, "record.json"), "utf8")) as {
    recordedAt: string;
    sections: readonly { anchor: string }[];
    confirmation: { confirmedAt: string };
  };
  equal(
    record.recordedAt,
    CONFIRMED_AT,
    "recordedAt is the confirmation time so record bytes follow the request",
  );
  equal(record.confirmation.confirmedAt, CONFIRMED_AT);
  equal(record.sections.length, 8);
  const stateFile = path.join(
    root,
    ".wakeflow-active/current/board",
    `${applied.package.requirementId}.json`,
  );
  equal(statSync(stateFile).mode & 0o777, 0o600);
  equal(
    readFileSync(path.join(root, ".wakeflow-active/current/board/index.md"), "utf8").includes(
      applied.package.requirementId,
    ),
    true,
  );

  const again = await executeRequirementPublicationRequest(
    { ...request, mode: "apply", planDigest: ready.planDigest },
    { clock: () => parseUtcInstant("2026-09-04T11:00:00.000Z") },
  );
  if (again.kind !== "WakeflowRequirementPublicationMutation")
    throw new Error("Expected a mutation.");
  equal(again.disposition, "current");
  equal(again.package.stateDigest, applied.package.stateDigest);

  await expectFailure(
    executeRequirementPublicationRequest(
      { ...request, mode: "apply", planDigest: `sha256:${"0".repeat(64)}` },
      { clock },
    ),
    "precondition-failed",
    "plan-drift",
  );

  const list = await executeBoardInspectionRequest({ root, view: "list" });
  if (list.kind !== "WakeflowBoardList") throw new Error("Expected a list.");
  deepEqual({ ...list.counts }, { pending: 1, parked: 0, claimed: 0, withdrawn: 0, archived: 0 });
  equal(list.packages[0]?.requirementId, applied.package.requirementId);
  equal(list.truncated, false);
  const view = await executeBoardInspectionRequest({
    root,
    view: "package",
    requirementId: applied.package.requirementId,
  });
  if (view.kind !== "WakeflowBoardPackage") throw new Error("Expected a package view.");
  equal(
    view.record.sections.some((section) => section.anchor === "acceptance-criteria"),
    true,
  );
  equal(view.record.confirmedAt, CONFIRMED_AT);
  equal(JSON.stringify(view).includes(root), false, "package view leaked the workspace path");
  equal(
    JSON.stringify(view).includes(path.join(root, "Ledger")),
    false,
    "package view leaked the ledger path",
  );

  const recovered = await executeRequirementPublicationRequest(
    { root, mode: "recover", operationId: applied.package.requirementId },
    { clock },
  );
  if (recovered.kind !== "WakeflowRequirementPublicationMutation")
    throw new Error("Expected a mutation.");
  equal(recovered.disposition, "recovered");
  equal(recovered.package.stateDigest, applied.package.stateDigest);
});

test("阻塞：缺章、隐私命中、测试决策与类型不符；未知窗口与设计面是错误", {
  timeout: 60_000,
}, async (t) => {
  const workspace = await fixture(t);
  const root = workspace.root;
  writeDrafts(
    workspace,
    `${FIXTURE_REQUIREMENT_MARKDOWN}\n## 附注\n\n密钥 sk-ant-abcdefghijklmnopqrstuvwxyz0123456789\n`,
    "## 已核实的代码事实\n\nx\n",
  );
  const preview = await executeRequirementPublicationRequest(
    {
      root,
      mode: "preview",
      action: "publish",
      package: packageInput(workspace, {
        confirmation: { confirmedAt: CONFIRMED_AT },
        testingDecision: { mode: "not-applicable", summary: "无" },
      }),
    },
    { clock },
  );
  if (preview.kind !== "WakeflowRequirementPublicationPreview")
    throw new Error("Expected a preview.");
  equal(preview.status, "blocked");
  equal(
    preview.blockers.some((blocker) => blocker.startsWith("privacy-violation:requirement.md:")),
    true,
  );
  equal(preview.blockers.includes("missing-section:landing.md#landing-plan"), true);
  equal(preview.blockers.includes("missing-section:landing.md#testing-decision"), true);
  equal(preview.blockers.includes("testing-decision-mode"), true);
  equal(JSON.stringify(preview).includes("sk-ant-"), false, "preview echoed a credential");
  await expectFailure(
    executeRequirementPublicationRequest(
      {
        root,
        mode: "preview",
        action: "publish",
        package: packageInput(workspace, {
          originWindowId: "window_00000000-0000-4000-8000-000000000000",
        }),
      },
      { clock },
    ),
    "not-found",
    "origin-window",
  );
  await expectFailure(
    executeRequirementPublicationRequest(
      {
        root,
        mode: "preview",
        action: "publish",
        package: packageInput(workspace, {
          designSurfaceId: "surface_00000000-0000-4000-8000-000000000000",
        }),
      },
      { clock },
    ),
    "not-found",
    "design-surface",
  );
});

test("parked 包 activate 回到 pending，withdraw 用 CAS，supersedes 撤回旧包", {
  timeout: 60_000,
}, async (t) => {
  const workspace = await fixture(t);
  const root = workspace.root;
  writeDrafts(workspace);
  const parkedRequest = {
    root,
    mode: "preview",
    action: "publish",
    package: packageInput(workspace, {
      confirmation: { confirmedAt: CONFIRMED_AT },
      parked: { trigger: "等待接口冻结" },
    }),
  };
  const parkedPreview = await executeRequirementPublicationRequest(parkedRequest, { clock });
  if (
    parkedPreview.kind !== "WakeflowRequirementPublicationPreview" ||
    parkedPreview.planDigest === null
  )
    throw new Error("Expected ready.");
  const parked = await executeRequirementPublicationRequest(
    { ...parkedRequest, mode: "apply", planDigest: parkedPreview.planDigest },
    { clock },
  );
  if (parked.kind !== "WakeflowRequirementPublicationMutation")
    throw new Error("Expected a mutation.");
  equal(parked.package.status, "parked");

  const activateRequest = {
    root,
    mode: "preview",
    action: "activate",
    requirementId: parked.package.requirementId,
    expectedStateDigest: parked.package.stateDigest,
  };
  const activatePreview = await executeRequirementPublicationRequest(activateRequest, { clock });
  if (
    activatePreview.kind !== "WakeflowRequirementPublicationPreview" ||
    activatePreview.planDigest === null
  )
    throw new Error("Expected ready.");
  const activated = await executeRequirementPublicationRequest(
    { ...activateRequest, mode: "apply", planDigest: activatePreview.planDigest },
    { clock },
  );
  if (activated.kind !== "WakeflowRequirementPublicationMutation")
    throw new Error("Expected a mutation.");
  equal(activated.disposition, "activated");
  equal(activated.package.status, "pending");
  equal(activated.package.revision, 2);

  const stale = await executeRequirementPublicationRequest(
    { ...activateRequest, action: "withdraw", reason: "过时" },
    { clock },
  );
  if (stale.kind !== "WakeflowRequirementPublicationPreview")
    throw new Error("Expected a preview.");
  deepEqual(stale.blockers, ["claim-state-drift"]);

  // 改内容重发：新包 supersedes 旧包，旧包自动撤回。
  writeDrafts(
    workspace,
    FIXTURE_REQUIREMENT_MARKDOWN.replace(
      "让 Controller 能从需求包创建 Demand。",
      "让 Controller 能从需求包创建 Demand，并看到看板。",
    ),
  );
  const successorRequest = {
    root,
    mode: "preview",
    action: "publish",
    package: packageInput(workspace, {
      confirmation: { confirmedAt: CONFIRMED_AT },
      supersedes: parked.package.requirementId,
    }),
  };
  const successorPreview = await executeRequirementPublicationRequest(successorRequest, { clock });
  if (
    successorPreview.kind !== "WakeflowRequirementPublicationPreview" ||
    successorPreview.planDigest === null
  )
    throw new Error("Expected ready.");
  equal(successorPreview.requirementId === parked.package.requirementId, false);
  const successor = await executeRequirementPublicationRequest(
    { ...successorRequest, mode: "apply", planDigest: successorPreview.planDigest },
    { clock: () => parseUtcInstant("2026-09-04T12:00:00.000Z") },
  );
  if (successor.kind !== "WakeflowRequirementPublicationMutation")
    throw new Error("Expected a mutation.");
  equal(successor.disposition, "published");
  equal(successor.superseded?.status, "withdrawn");
  equal(successor.superseded?.requirementId, parked.package.requirementId);
  const list = await executeBoardInspectionRequest({
    root,
    view: "list",
    filter: { statuses: ["pending"] },
  });
  if (list.kind !== "WakeflowBoardList") throw new Error("Expected a list.");
  deepEqual(
    list.packages.map((entry) => entry.requirementId),
    [successor.package.requirementId],
  );
  deepEqual({ ...list.counts }, { pending: 1, parked: 0, claimed: 0, withdrawn: 1, archived: 0 });

  const withdrawRequest = {
    root,
    mode: "preview",
    action: "withdraw",
    requirementId: successor.package.requirementId,
    expectedStateDigest: successor.package.stateDigest,
    reason: "范围合并",
  };
  const withdrawPreview = await executeRequirementPublicationRequest(withdrawRequest, { clock });
  if (
    withdrawPreview.kind !== "WakeflowRequirementPublicationPreview" ||
    withdrawPreview.planDigest === null
  )
    throw new Error("Expected ready.");
  const withdrawn = await executeRequirementPublicationRequest(
    { ...withdrawRequest, mode: "apply", planDigest: withdrawPreview.planDigest },
    { clock },
  );
  if (withdrawn.kind !== "WakeflowRequirementPublicationMutation")
    throw new Error("Expected a mutation.");
  equal(withdrawn.disposition, "withdrawn");
  equal(withdrawn.next.frontier, null);
  const index = readFileSync(path.join(root, ".wakeflow-active/current/board/index.md"), "utf8");
  equal(index.includes(successor.package.requirementId), false, "withdrawn package still listed");
});

test("parked 包激活后被认领：create_demand 根先建后 CAS 认领，回执修订为 3，第二个活动 Demand 被拒", {
  timeout: 90_000,
}, async (t) => {
  const workspace = await fixture(t);
  const root = workspace.root;
  writeDrafts(workspace);
  const parkedRequest = {
    root,
    mode: "preview",
    action: "publish",
    package: packageInput(workspace, {
      confirmation: { confirmedAt: CONFIRMED_AT },
      parked: { trigger: "等待接口冻结" },
    }),
  };
  const parkedPreview = await executeRequirementPublicationRequest(parkedRequest, { clock });
  if (
    parkedPreview.kind !== "WakeflowRequirementPublicationPreview" ||
    parkedPreview.planDigest === null
  )
    throw new Error("Expected ready.");
  const parked = await executeRequirementPublicationRequest(
    { ...parkedRequest, mode: "apply", planDigest: parkedPreview.planDigest },
    { clock },
  );
  if (parked.kind !== "WakeflowRequirementPublicationMutation")
    throw new Error("Expected a mutation.");
  const activateRequest = {
    root,
    mode: "preview",
    action: "activate",
    requirementId: parked.package.requirementId,
    expectedStateDigest: parked.package.stateDigest,
  };
  const activatePreview = await executeRequirementPublicationRequest(activateRequest, { clock });
  if (
    activatePreview.kind !== "WakeflowRequirementPublicationPreview" ||
    activatePreview.planDigest === null
  )
    throw new Error("Expected ready.");
  await executeRequirementPublicationRequest(
    { ...activateRequest, mode: "apply", planDigest: activatePreview.planDigest },
    { clock },
  );

  const demand = {
    title: "从激活的包创建",
    goal: "验证认领修订链。",
    completionDefinition: "回执带修订 3。",
  };
  const demandPreview = await executeDemandCreationRequest({
    root,
    mode: "preview",
    requirementId: parked.package.requirementId,
    demand,
  });
  if (demandPreview.kind !== "WakeflowDemandCreationPreview" || demandPreview.planDigest === null)
    throw new Error("Expected a ready Demand plan.");
  const applied = await executeDemandCreationRequest({
    root,
    mode: "apply",
    requirementId: parked.package.requirementId,
    demand,
    planDigest: demandPreview.planDigest,
  });
  if (applied.kind !== "WakeflowDemandCreationMutation") throw new Error("Expected a mutation.");
  equal(applied.publication.claim.requirementId, parked.package.requirementId);
  equal(applied.publication.claim.stateRevision, 3);
  const view = await executeBoardInspectionRequest({
    root,
    view: "package",
    requirementId: parked.package.requirementId,
  });
  if (view.kind !== "WakeflowBoardPackage") throw new Error("Expected a package view.");
  equal(view.package.status, "claimed");
  equal(view.package.claim?.demandId, applied.publication.demandId);
  equal(view.package.revision, 3);

  // 总控已有活动 Demand：再发布一个包可以，再认领被拒（ADR-0011 D7）。
  writeDrafts(
    workspace,
    FIXTURE_REQUIREMENT_MARKDOWN.replace("让 Controller 能从需求包创建 Demand。", "第二个需求。"),
  );
  const secondRequest = {
    root,
    mode: "preview",
    action: "publish",
    package: packageInput(workspace, { confirmation: { confirmedAt: CONFIRMED_AT } }),
  };
  const secondPreview = await executeRequirementPublicationRequest(secondRequest, { clock });
  if (
    secondPreview.kind !== "WakeflowRequirementPublicationPreview" ||
    secondPreview.planDigest === null
  )
    throw new Error("Expected ready.");
  const second = await executeRequirementPublicationRequest(
    { ...secondRequest, mode: "apply", planDigest: secondPreview.planDigest },
    { clock },
  );
  if (second.kind !== "WakeflowRequirementPublicationMutation")
    throw new Error("Expected a mutation.");
  const secondDemandPreview = await executeDemandCreationRequest({
    root,
    mode: "preview",
    requirementId: second.package.requirementId,
    demand,
  });
  if (secondDemandPreview.kind !== "WakeflowDemandCreationPreview")
    throw new Error("Expected a preview.");
  equal(secondDemandPreview.status, "blocked");
  equal(
    secondDemandPreview.blockers.some((blocker) => blocker.startsWith("pod-busy:demand_")),
    true,
    secondDemandPreview.blockers.join(","),
  );
  await rejects(
    Promise.reject(new WakeflowError("precondition-failed", "pod-busy", "$board")),
    (error: unknown) => error instanceof WakeflowError && error.reason === "pod-busy",
  );
});
