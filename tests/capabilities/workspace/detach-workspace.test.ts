import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { wakeflowWindowRuntimeProjectionRef } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-paths.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { createDetachFixture, type DetachFixture } from "./detach-workspace.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：`detach-workspace`（ADR-0024）。preview 零写并给出"全部外部指令块与工作区根的两处托管块 →
 * 全部窗口投影退役 → retire-config"；apply 后 `wakeflow.config.json` 原样改名为 `wakeflow.detached.json`
 * （字节不变），`.gitignore` 与 `AGENTS.md` 只剩用户行，投影文件不在，结果列出不碰的东西；终态之后
 * reconcile / reconfigure / detach 阻塞 workspace-detached，fresh-initialize 阻塞 detached-file-present；
 * 带 repositoryId 的 detach-workspace 请求在边界拒绝。
 */

type PlanSteps = readonly {
  readonly boundary: string;
  readonly stepKind?: string;
  readonly operationKind?: string;
  readonly targetKey: string;
}[];

function stepsOf(plan: unknown): PlanSteps {
  return (plan as { readonly steps: PlanSteps }).steps;
}

function projectionPaths(fixture: DetachFixture): readonly string[] {
  return fixture.config.topology.windows.map((window) =>
    path.join(
      fixture.root,
      wakeflowWindowRuntimeProjectionRef(codexWorkspaceHostResourceProfile, window.windowId),
    ),
  );
}

async function previewDetach(root: string) {
  const result = await executeCodexWakeflowMaintenance({
    root,
    action: "detach-workspace",
    mode: "preview",
    request: {},
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

/** 分离一个两仓库工作区：返回原配置字节与用户自己写进去的两行。 */
async function detachFixtureWorkspace(fixture: DetachFixture) {
  const gitignore = path.join(fixture.root, ".gitignore");
  writeFileSync(gitignore, `${readFileSync(gitignore, "utf8")}node_modules/\n`);
  const agents = path.join(fixture.root, "AGENTS.md");
  writeFileSync(agents, `# My notes\n\n${readFileSync(agents, "utf8")}`);
  const configBytes = readFileSync(path.join(fixture.root, "wakeflow.config.json"));
  const previewed = await previewDetach(fixture.root);
  if (previewed.planDigest === null) throw new Error(previewed.blockerCodes.join(","));
  const applied = await executeCodexWakeflowMaintenance({
    root: fixture.root,
    action: "detach-workspace",
    mode: "apply",
    request: {},
    planDigest: previewed.planDigest,
  });
  if (applied.mode !== "apply") throw new Error("Expected an apply result.");
  return Object.freeze({ previewed, applied, configBytes });
}

test("detach-workspace：preview 零写，apply 删托管块、退役投影、原样改名配置并列出不碰的东西", async (t: TestContext) => {
  const fixture = await createDetachFixture(t);
  for (const projection of projectionPaths(fixture)) equal(existsSync(projection), true);
  const productAgents = path.join(fixture.productB, "AGENTS.md");
  const gitignoreBefore = readFileSync(path.join(fixture.root, ".gitignore"), "utf8");
  equal(gitignoreBefore.includes(".wakeflow-local"), true);

  const previewed = await previewDetach(fixture.root);
  equal(previewed.status, "ready");
  deepEqual([...previewed.blockerCodes], []);
  const steps = stepsOf(previewed.plan);
  deepEqual(
    steps.map((step) => step.stepKind),
    [
      "remove-managed-block",
      "remove-managed-block",
      "remove-managed-block",
      "retire-window-projections",
      "retire-config",
    ],
  );
  deepEqual(
    steps
      .slice(0, 4)
      .map((step) => step.targetKey)
      .sort(),
    [
      "program-instruction",
      "workspace",
      "workspace.ignore-integration",
      steps.find((step) => step.targetKey.includes(fixture.repositoryB))?.targetKey ?? "missing",
    ].sort(),
  );
  equal(
    existsSync(path.join(fixture.root, "wakeflow.config.json")),
    true,
    "preview must not write",
  );
  equal(
    existsSync(path.join(fixture.root, "wakeflow.detached.json")),
    false,
    "preview must not write",
  );
  equal(readFileSync(path.join(fixture.root, ".gitignore"), "utf8"), gitignoreBefore);
  equal(JSON.stringify(previewed).includes(fixture.base), false);

  const { applied, configBytes } = await detachFixtureWorkspace(fixture);
  equal(applied.status, "completed");
  equal(applied.action, "detach-workspace");
  equal(existsSync(path.join(fixture.root, "wakeflow.config.json")), false);
  deepEqual(readFileSync(path.join(fixture.root, "wakeflow.detached.json")), configBytes);
  const gitignore = readFileSync(path.join(fixture.root, ".gitignore"), "utf8");
  equal(gitignore.includes(".wakeflow-local"), false);
  equal(gitignore.includes("wakeflow:managed-content"), false);
  equal(gitignore.includes("node_modules/"), true);
  const agents = readFileSync(path.join(fixture.root, "AGENTS.md"), "utf8");
  equal(agents.includes("wakeflow:managed-content"), false);
  equal(agents.includes("# My notes"), true);
  equal(existsSync(productAgents), false);
  for (const projection of projectionPaths(fixture)) equal(existsSync(projection), false);
  // 不碰并列出：协议根、账本、支撑面目录、检出、分支、插件级 hooks。
  const leftBehind = (applied as { readonly leftBehind?: readonly string[] }).leftBehind ?? [];
  deepEqual(
    [...leftBehind],
    [
      ".wakeflow-active",
      ".wakeflow-local",
      "ledger-root:Ledger",
      "support-surface:Design",
      "support-surface:Test",
      "worktree-checkouts",
      "branches",
      "plugin-hooks",
    ],
  );
  equal(
    leftBehind.some((entry) => /ledger/u.test(entry)),
    true,
  );
  equal(
    leftBehind.some((entry) => /active/u.test(entry)),
    true,
  );
  equal(
    leftBehind.some((entry) => /local/u.test(entry)),
    true,
  );
  equal(
    leftBehind.some((entry) => path.isAbsolute(entry)),
    false,
  );
  for (const relative of [".wakeflow-active", ".wakeflow-local", "Ledger", "Design", "Test"]) {
    equal(existsSync(path.join(fixture.root, relative)), true, relative);
  }
  deepEqual(
    { ...applied.next },
    { frontier: null, owner: "none", suggestedTool: null, blockers: [] },
  );
});

test("detach-workspace：终态之后 reconcile / reconfigure / detach 阻塞 workspace-detached，fresh 阻塞 detached-file-present", async (t: TestContext) => {
  const fixture = await createDetachFixture(t);
  const { configBytes } = await detachFixtureWorkspace(fixture);
  const detachedConfig = JSON.parse(configBytes.toString("utf8")) as Record<string, unknown>;

  for (const request of [
    { action: "reconcile", request: {} },
    { action: "reconfigure", request: { desiredConfig: detachedConfig } },
    { action: "detach-workspace", request: {} },
    { action: "detach-repository", request: { repositoryId: fixture.repositoryB } },
  ] as const) {
    const previewed = await executeCodexWakeflowMaintenance({
      root: fixture.root,
      mode: "preview",
      ...request,
    });
    if (previewed.mode !== "preview") throw new Error("Expected a preview result.");
    equal(previewed.status, "blocked", request.action);
    deepEqual([...previewed.blockerCodes], ["workspace-detached"], request.action);
    equal(previewed.planDigest, null);
  }
  // 退役文件在，fresh 的 preview 以 detached-file-present 阻塞：用户先把它移走，再重新启用。
  const selection = createMinimalWakeflowFreshConfigSelection();
  (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const fresh = await executeCodexWakeflowMaintenance({
    root: fixture.root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection },
  });
  if (fresh.mode !== "preview") throw new Error("Expected a preview result.");
  equal(fresh.status, "blocked");
  deepEqual([...fresh.blockerCodes], ["detached-file-present"]);
  equal(fresh.planDigest, null);
  equal(existsSync(path.join(fixture.root, "wakeflow.config.json")), false);
  deepEqual(readFileSync(path.join(fixture.root, "wakeflow.detached.json")), configBytes);
});

test("detach-workspace 带 repositoryId 的请求在边界拒绝；再 apply 旧摘要是 plan-blocked", async (t: TestContext) => {
  const fixture = await createDetachFixture(t);
  await rejects(
    executeCodexWakeflowMaintenance({
      root: fixture.root,
      action: "detach-workspace",
      mode: "preview",
      request: { repositoryId: fixture.repositoryB },
    }),
    wakeflowFailure("invalid-request", "repository-id-unexpected", "$request.request.repositoryId"),
  );
  const { previewed } = await detachFixtureWorkspace(fixture);
  await rejects(
    executeCodexWakeflowMaintenance({
      root: fixture.root,
      action: "detach-workspace",
      mode: "apply",
      request: {},
      planDigest: previewed.planDigest,
    }),
    wakeflowFailure("precondition-failed", "plan-blocked", "$request.planDigest"),
  );
});
