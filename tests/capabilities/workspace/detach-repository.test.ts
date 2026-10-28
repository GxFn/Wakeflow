import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { executePodRequest } from "../../../src/capabilities/pod/service.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { wakeflowExternalInstructionTargetKey } from "../../../src/workspace/managed-integration/wakeflow-external-instruction-body-authority.js";
import { recomposeWakeflowManagedTextEnvelope } from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import { wakeflowWindowRuntimeProjectionRef } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-paths.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  PLANNING_REPOSITORY_ID,
  planFixtureTargetTask,
} from "../../governance/tasking/target-task-planning-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  createDetachFixture,
  DETACH_POD_FACADE,
  type DetachFixture,
  readDetachConfig,
} from "./detach-workspace.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：`detach-repository`（ADR-0024）。preview 零写并给出"删该仓库的外部指令块 → 退役它的
 * 窗口投影 → 发布去掉它的 Config"；apply 落地后仓库与窗口离开配置、托管块随文件一起删掉、投影文件不在；
 * 未知仓库、最后一个仓库、正文未知的托管块、含该仓库检出的 worktree pod 与有该仓库目标的活动 Demand
 * 各以自己的码阻塞；缺 repositoryId 在边界拒绝。
 */

const CLOCK = { clock: () => parseUtcInstant("2026-10-26T12:00:00.000Z") };

type PlanSteps = readonly {
  readonly boundary: string;
  readonly stepKind?: string;
  readonly operationKind?: string;
  readonly targetKey: string;
  readonly stepId: string;
}[];

function stepsOf(plan: unknown): PlanSteps {
  return (plan as { readonly steps: PlanSteps }).steps;
}

function windowIdsOf(fixture: DetachFixture, repositoryId: string): readonly string[] {
  return fixture.config.topology.windows
    .filter(
      (window) => window.root.kind === "repository" && window.root.repositoryId === repositoryId,
    )
    .map((window) => window.windowId);
}

function projectionPath(fixture: DetachFixture, windowId: string): string {
  return path.join(
    fixture.root,
    wakeflowWindowRuntimeProjectionRef(codexWorkspaceHostResourceProfile, windowId),
  );
}

async function preview(root: string, repositoryId: string) {
  const result = await executeCodexWakeflowMaintenance({
    root,
    action: "detach-repository",
    mode: "preview",
    request: { repositoryId },
  });
  if (result.mode !== "preview") throw new Error("Expected a preview result.");
  return result;
}

function wakeflowFailure(code: string, reason: string, path?: string): (error: unknown) => boolean {
  return (error: unknown) =>
    isWakeflowError(error) &&
    error.code === code &&
    error.reason === reason &&
    (path === undefined || error.path === path);
}

test("detach-repository：preview 零写给出三类步骤，apply 删块、退役投影并发布去掉仓库的 Config", async (t: TestContext) => {
  const fixture = await createDetachFixture(t);
  const agents = path.join(fixture.productB, "AGENTS.md");
  equal(readFileSync(agents, "utf8").includes("wakeflow:managed-content"), true);
  const configBefore = readFileSync(path.join(fixture.root, "wakeflow.config.json"));
  const agentsBefore = readFileSync(agents);
  const windowB = windowIdsOf(fixture, fixture.repositoryB);
  equal(windowB.length, 1);
  equal(existsSync(projectionPath(fixture, windowB[0] ?? "")), true);

  const previewed = await preview(fixture.root, fixture.repositoryB);
  equal(previewed.status, "ready");
  deepEqual([...previewed.blockerCodes], []);
  equal(typeof previewed.planDigest, "string");
  const steps = stepsOf(previewed.plan);
  deepEqual(
    steps.map((step) => step.stepKind),
    ["remove-managed-block", "retire-window-projections", "publish-config"],
  );
  equal(
    steps[0]?.targetKey,
    wakeflowExternalInstructionTargetKey({
      kind: "repository",
      repositoryId: parseWakeflowDurableIdOfKind(fixture.repositoryB, "repository"),
    }),
  );
  equal(steps[1]?.targetKey, fixture.repositoryB);
  deepEqual(
    readFileSync(path.join(fixture.root, "wakeflow.config.json")),
    configBefore,
    "preview must not write",
  );
  deepEqual(readFileSync(agents), agentsBefore, "preview must not write");
  equal(JSON.stringify(previewed).includes(fixture.base), false);

  const applied = await executeCodexWakeflowMaintenance({
    root: fixture.root,
    action: "detach-repository",
    mode: "apply",
    request: { repositoryId: fixture.repositoryB },
    planDigest: previewed.planDigest,
  });
  if (applied.mode !== "apply") throw new Error("Expected an apply result.");
  equal(applied.status, "completed");
  equal(applied.action, "detach-repository");
  equal("leftBehind" in applied, false);
  const after = readDetachConfig(fixture.root);
  deepEqual(
    after.topology.repositories.map((entry) => entry.repositoryId),
    [fixture.repositoryA],
  );
  equal(
    after.topology.windows.some((window) => window.root.repositoryId === fixture.repositoryB),
    false,
  );
  equal(after.topology.windows.length, fixture.config.topology.windows.length - 1);
  // 文件只含托管块：块删掉后文件为空即删文件；仓库本身与它的 Git 历史不碰。
  equal(existsSync(agents), false);
  equal(existsSync(path.join(fixture.productB, ".git")), true);
  equal(existsSync(projectionPath(fixture, windowB[0] ?? "")), false);
  for (const windowId of windowIdsOf(fixture, fixture.repositoryA)) {
    equal(existsSync(projectionPath(fixture, windowId)), true);
  }

  // 同一摘要不再可用；已离开配置的仓库是 unknown；最后一个仓库不能单独分离。
  await rejects(
    executeCodexWakeflowMaintenance({
      root: fixture.root,
      action: "detach-repository",
      mode: "apply",
      request: { repositoryId: fixture.repositoryB },
      planDigest: previewed.planDigest,
    }),
    wakeflowFailure("precondition-failed", "plan-blocked", "$request.planDigest"),
  );
  const unknown = await preview(fixture.root, fixture.repositoryB);
  equal(unknown.status, "blocked");
  deepEqual([...unknown.blockerCodes], ["detach-repository-unknown"]);
  equal(unknown.planDigest, null);
  const last = await preview(fixture.root, fixture.repositoryA);
  deepEqual([...last.blockerCodes], ["detach-repository-last"]);
});

test("detach-repository：正文未知的托管块阻塞 detach-unknown-managed-body:<targetKey>，文件不碰", async (t: TestContext) => {
  const fixture = await createDetachFixture(t);
  const agents = path.join(fixture.productB, "AGENTS.md");
  const foreign = recomposeWakeflowManagedTextEnvelope(Buffer.from("", "utf8"), {
    component: "repository-instruction",
    owner: "host-instruction-integration",
    body: "Another workspace's block.\n",
  });
  writeFileSync(agents, foreign.bytes);
  const targetKey = wakeflowExternalInstructionTargetKey({
    kind: "repository",
    repositoryId: parseWakeflowDurableIdOfKind(fixture.repositoryB, "repository"),
  });
  const previewed = await preview(fixture.root, fixture.repositoryB);
  equal(previewed.status, "blocked");
  deepEqual([...previewed.blockerCodes], [`detach-unknown-managed-body:${targetKey}`]);
  equal(previewed.planDigest, null);
  deepEqual(readFileSync(agents), Buffer.from(foreign.bytes));
  // owner-managed 的仓库没有托管块：没有阻塞，没有 remove-managed-block 步。
  const other = await preview(fixture.root, fixture.repositoryA);
  equal(other.status, "ready");
  deepEqual(
    stepsOf(other.plan).map((step) => step.stepKind),
    ["retire-window-projections", "publish-config"],
  );
});

test("detach-repository 与 detach-workspace：含该仓库检出的 worktree pod 未关闭即 detach-pod-open:<podId>", async (t: TestContext) => {
  const fixture = await createDetachFixture(t);
  const podPreview = await executePodRequest(
    DETACH_POD_FACADE,
    {
      root: fixture.root,
      mode: "preview",
      intent: { kind: "create", name: "feature-x", idempotencyKey: "pod-1" },
    },
    CLOCK,
  );
  if (podPreview.kind !== "WakeflowPodPreview" || podPreview.planDigest === null) {
    throw new Error("Expected a ready pod preview.");
  }
  const created = await executePodRequest(
    DETACH_POD_FACADE,
    {
      root: fixture.root,
      mode: "apply",
      intent: { kind: "create", name: "feature-x", idempotencyKey: "pod-1" },
      planDigest: podPreview.planDigest,
    },
    CLOCK,
  );
  if (created.kind !== "WakeflowPodMutation" || created.pod === null)
    throw new Error("Expected a pod.");
  const blocker = `detach-pod-open:${created.pod.podId}`;
  const repository = await preview(fixture.root, fixture.repositoryA);
  equal(repository.status, "blocked");
  deepEqual([...repository.blockerCodes], [blocker]);
  const workspace = await executeCodexWakeflowMaintenance({
    root: fixture.root,
    action: "detach-workspace",
    mode: "preview",
    request: {},
  });
  if (workspace.mode !== "preview") throw new Error("Expected a preview result.");
  deepEqual([...workspace.blockerCodes], [blocker]);
  equal(workspace.planDigest, null);
});

test("detach-repository 与 detach-workspace：有该仓库目标的活动 Demand 即 detach-demand-active:<demandId>", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    await planFixtureTargetTask(fixture);
    const blocker = `detach-demand-active:${fixture.request.demandId}`;
    const repository = await preview(fixture.workspacePath, PLANNING_REPOSITORY_ID);
    equal(repository.status, "blocked");
    equal(repository.blockerCodes.includes(blocker), true, repository.blockerCodes.join(","));
    const workspace = await executeCodexWakeflowMaintenance({
      root: fixture.workspacePath,
      action: "detach-workspace",
      mode: "preview",
      request: {},
    });
    if (workspace.mode !== "preview") throw new Error("Expected a preview result.");
    equal(workspace.blockerCodes.includes(blocker), true, workspace.blockerCodes.join(","));
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("detach-repository 的请求体缺 repositoryId 在边界拒绝", async (t: TestContext) => {
  const fixture = await createDetachFixture(t);
  await rejects(
    executeCodexWakeflowMaintenance({
      root: fixture.root,
      action: "detach-repository",
      mode: "preview",
      request: {},
    }),
    wakeflowFailure("invalid-request", "repository-id-required", "$request.request.repositoryId"),
  );
  await rejects(
    executeCodexWakeflowMaintenance({
      root: fixture.root,
      action: "detach-repository",
      mode: "preview",
      request: { repositoryId: "not-a-repository-id" },
    }),
    wakeflowFailure("invalid-request", "schema"),
  );
});
