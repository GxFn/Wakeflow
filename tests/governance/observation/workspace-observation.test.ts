import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  readWakeflowConfigAuthoritySnapshot,
  type WakeflowConfigAuthoritySnapshot,
} from "../../../src/configuration/wakeflow-config-authority-snapshot.js";
import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
} from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import type { DemandControllerRoute } from "../../../src/governance/controller/demand-controller-route.js";
import {
  deriveOverallStatus,
  observeWorkspace,
  orphanWorkClaims,
  type WorkspaceObservation,
} from "../../../src/governance/observation/workspace-observation.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { REQUIREMENT_BOARD_ROOT_REF, WORK_CLAIMS_ROOT_REF } from "../../../src/kernel/layout.js";
import { createWorkClaim, takeWorkClaim } from "../../../src/kernel/work-claims.js";
import { createWakeflowWindowHostBindingId } from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-id.js";
import { CODEX_OBSERVATION_FACADE } from "../../capabilities/observation/observation-facade.fixture.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  prepareFixtureDelivery,
} from "../delivery/delivery-workspace.fixture.js";

/**
 * 一次观察多域（gate-log §13.94 D1、D4）：每个域独立读取并隔离失败，读不出只让该域
 * unavailable 并带 issue；中止一律上抛；宿主运行时未物化的宿主绑定为空而不是失败；
 * 孤儿声明与 overall 的五档派生只看观察记录。
 */

const OBSERVED_AT = parseUtcInstant("2026-09-18T08:00:00.000Z");
const CLAIMED_AT = parseUtcInstant("2026-09-18T07:59:00.000Z");
const CONTROLLER_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";
const DESIGN_WINDOW_ID = "window_66666666-6666-4666-8666-666666666666";

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

interface Workspace {
  readonly root: string;
  readonly rooted: RootedDirectory;
  readonly snapshot: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly ledgerRoot: RootedDirectory;
  readonly headCommit: string;
}

async function openLedger(snapshot: Readonly<WakeflowConfigAuthoritySnapshot>) {
  const placement = snapshot.placements.roots.find((entry) => entry.key === "ledger.root");
  if (placement === undefined) throw new Error("Expected a ledger placement.");
  return RootedDirectory.open(placement.absolutePath);
}

/** 经公共维护工具（Codex 制品）初始化的一次性工作区，兄弟产品仓库带一个提交。 */
async function maintainedWorkspace(t: TestContext): Promise<Workspace> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-observation-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "Workspace");
  const product = path.join(base, "ProductA");
  mkdirSync(root);
  mkdirSync(product);
  git(root, "init", "--quiet");
  git(product, "init", "--quiet", "--initial-branch=main");
  git(product, "commit", "--quiet", "--allow-empty", "-m", "init");
  const selection = createMinimalWakeflowFreshConfigSelection();
  (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const preview = await executeCodexWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection },
  });
  if (preview.mode !== "preview" || preview.planDigest === null) {
    throw new Error("Expected a ready Fresh plan.");
  }
  await executeCodexWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "apply",
    request: { selection },
    planDigest: preview.planDigest,
  });
  const rooted = await RootedDirectory.open(root);
  const snapshot = await readWakeflowConfigAuthoritySnapshot(rooted);
  const ledgerRoot = await openLedger(snapshot);
  t.after(async () => {
    await ledgerRoot.close();
    await rooted.close();
  });
  return { root, rooted, snapshot, ledgerRoot, headCommit: git(product, "rev-parse", "HEAD") };
}

async function observe(
  workspace: Pick<Workspace, "rooted" | "snapshot" | "ledgerRoot">,
  scope: "projection" | "full" = "full",
  signal?: AbortSignal,
): Promise<Readonly<WorkspaceObservation>> {
  return observeWorkspace(workspace.rooted, workspace.snapshot, workspace.ledgerRoot, {
    hosts: CODEX_OBSERVATION_FACADE.hosts,
    currentHostId: CODEX_OBSERVATION_FACADE.hostId,
    scope,
    clock: () => OBSERVED_AT,
    ...(signal === undefined ? {} : { signal }),
  });
}

function absolute(root: string, ref: string): string {
  return path.join(root, ...ref.split("/"));
}

test("健康工作区：各域 observed；未物化的宿主运行时给出空绑定而不是不可用；projection 作用域不读宿主域；overall idle", { timeout: 120_000 }, async (t) => {
  const workspace = await maintainedWorkspace(t);
  const full = await observe(workspace);
  equal(full.observedAt, OBSERVED_AT);
  equal(full.scope, "full");
  equal(full.configDigest, workspace.snapshot.configDigest);
  equal(full.layout.status, "observed");
  equal(full.layout.value?.status, "current");
  equal(full.board.status, "observed");
  deepEqual(full.board.value?.counts, { pending: 0, parked: 0, claimed: 0, withdrawn: 0, archived: 0 });
  equal(full.board.value?.indexDigest, full.board.value?.expectedIndexDigest);
  deepEqual(full.demands, { status: "observed", issue: null, value: [] });
  equal(full.claims.status, "observed");
  deepEqual(full.claims.value, { claims: [], unreadable: 0 });
  // Codex 制品初始化的工作区没有 Claude Code 的宿主运行时：那是"没有绑定"，不是读失败。
  deepEqual(
    full.bindings.map((host) => [host.hostId, host.status, host.issue, host.bindings.length]),
    [
      ["codex", "observed", null, 0],
      ["claude-code", "observed", null, 0],
    ],
  );
  deepEqual(
    full.hooks.map((host) => [host.hostId, host.status, host.directory, host.records, host.skipped]),
    [
      ["codex", "observed", "absent", 0, 0],
      ["claude-code", "observed", "absent", 0, 0],
    ],
  );
  equal(full.pods.status, "observed");
  deepEqual(
    full.pods.value?.map((pod) => [pod.pod.placement, pod.state, pod.activeDemandId, pod.receipts.length, pod.windowIds.length, pod.boundWindowIds.length]),
    [["primary", "creating", null, 0, 4, 0]],
  );
  equal(full.repositories.status, "observed");
  deepEqual(
    full.repositories.value?.map((repository) => [repository.status, repository.head, repository.branch, repository.detached]),
    [["observed", workspace.headCommit, "main", false]],
  );
  deepEqual(
    full.assets.map((asset) => [asset.hostId, asset.status]),
    [
      ["codex", "not-applicable"],
      ["claude-code", "not-applicable"],
    ],
  );
  deepEqual(orphanWorkClaims(full), []);
  equal(deriveOverallStatus(full), "idle");

  const projection = await observe(workspace, "projection");
  equal(projection.scope, "projection");
  deepEqual(projection.bindings, []);
  deepEqual(projection.hooks, []);
  deepEqual(projection.assets, []);
  deepEqual(projection.repositories, { status: "unavailable", issue: "scope:projection", value: null });
  equal(projection.pods.value?.[0]?.state, null);
  equal(deriveOverallStatus(projection), "idle");
});

test("域隔离：看板目录被文件顶替只让 board 不可用；声明目录被文件顶替只让 claims 不可用；非法声明文件只计 unreadable", { timeout: 120_000 }, async (t) => {
  const workspace = await maintainedWorkspace(t);
  const boardPath = absolute(workspace.root, REQUIREMENT_BOARD_ROOT_REF);
  rmSync(boardPath, { recursive: true, force: true });
  writeFileSync(boardPath, "not a directory\n", { mode: 0o600 });
  const boardBroken = await observe(workspace);
  equal(boardBroken.board.status, "unavailable");
  equal(boardBroken.board.issue?.startsWith("board:"), true, boardBroken.board.issue ?? "");
  equal(boardBroken.board.value, null);
  equal(boardBroken.layout.status, "observed");
  equal(boardBroken.demands.status, "observed");
  equal(boardBroken.claims.status, "observed");
  equal(boardBroken.pods.status, "observed");
  equal(boardBroken.repositories.status, "observed");
  equal(deriveOverallStatus(boardBroken), "degraded");
  rmSync(boardPath);
  mkdirSync(boardPath, { mode: 0o700 });

  const claimsPath = absolute(workspace.root, WORK_CLAIMS_ROOT_REF);
  rmSync(claimsPath, { recursive: true, force: true });
  mkdirSync(path.dirname(claimsPath), { recursive: true, mode: 0o700 });
  writeFileSync(claimsPath, "not a directory\n", { mode: 0o600 });
  const claimsBroken = await observe(workspace);
  equal(claimsBroken.claims.status, "unavailable");
  equal(claimsBroken.claims.issue?.startsWith("claims:"), true, claimsBroken.claims.issue ?? "");
  equal(claimsBroken.board.status, "observed");
  equal(claimsBroken.demands.status, "observed");
  equal(deriveOverallStatus(claimsBroken), "degraded");
  rmSync(claimsPath);

  mkdirSync(claimsPath, { mode: 0o700 });
  writeFileSync(path.join(claimsPath, `${createWakeflowDurableId("window")}.json`), "{not json", {
    mode: 0o600,
  });
  writeFileSync(path.join(claimsPath, "stray.txt"), "x\n", { mode: 0o600 });
  const unreadable = await observe(workspace);
  equal(unreadable.claims.status, "observed");
  deepEqual(unreadable.claims.value, { claims: [], unreadable: 2 });
  equal(deriveOverallStatus(unreadable), "idle");
});

test("中止信号从任一域上抛，不被隔离成 unavailable", { timeout: 120_000 }, async (t) => {
  const workspace = await maintainedWorkspace(t);
  await rejects(
    observe(workspace, "full", AbortSignal.abort()),
    (error: unknown) =>
      error instanceof WakeflowError && error.code === "io-failure" && error.reason === "aborted",
  );
});

test("孤儿声明与 overall：持有者不是活动 Demand 或绑定不是当前代即孤儿；active / degraded / blocked / maintenance 只看观察记录", { timeout: 120_000 }, async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    git(path.join(fixture.fixtureRoot, "ProductA"), "init", "--quiet", "--initial-branch=main");
    const snapshot = await readWakeflowConfigAuthoritySnapshot(fixture.workspaceRoot);
    const ledgerRoot = await openLedger(snapshot);
    try {
      const workspace = { rooted: fixture.workspaceRoot, snapshot, ledgerRoot };
      const idle = await observe(workspace);
      equal(idle.demands.value?.[0]?.loaded?.aggregate.state.lifecycle, "active");
      equal(idle.repositories.value?.[0]?.status, "observed");
      deepEqual(orphanWorkClaims(idle), []);
      equal(deriveOverallStatus(idle), "active");

      // 经切片取得的声明：活动 Demand 加当前绑定，不是孤儿。
      await prepareFixtureDelivery(fixture);
      const held = await observe(workspace);
      equal(held.claims.value?.claims.length, 1);
      equal(held.claims.value?.claims[0]?.bindingId, fixture.route.bindingId);
      deepEqual(orphanWorkClaims(held), []);
      equal(deriveOverallStatus(held), "active");

      // 绑定不是当前代：孤儿；持有者不是活动 Demand：孤儿。
      const staleBinding = createWorkClaim({
        claimId: createWakeflowDurableId("work-claim"),
        hostId: "codex",
        windowId: parseWakeflowDurableIdOfKind(CONTROLLER_WINDOW_ID, "window"),
        bindingId: createWakeflowWindowHostBindingId(),
        holder: {
          demandId: parseWakeflowDurableIdOfKind(fixture.demandId, "demand"),
          targetTaskId: parseWakeflowDurableIdOfKind(fixture.targetTaskId, "target-task"),
          deliveryId: createWakeflowDurableId("target-delivery"),
          generation: 1,
        },
        claimedAt: CLAIMED_AT,
      });
      const foreignDemand = createWorkClaim({
        claimId: createWakeflowDurableId("work-claim"),
        hostId: "codex",
        windowId: parseWakeflowDurableIdOfKind(DESIGN_WINDOW_ID, "window"),
        bindingId: fixture.route.bindingId,
        holder: {
          demandId: createWakeflowDurableId("demand"),
          targetTaskId: createWakeflowDurableId("target-task"),
          deliveryId: createWakeflowDurableId("target-delivery"),
          generation: 1,
        },
        claimedAt: CLAIMED_AT,
      });
      equal((await takeWorkClaim(fixture.workspaceRoot, staleBinding)).disposition, "created");
      equal((await takeWorkClaim(fixture.workspaceRoot, foreignDemand)).disposition, "created");
      const orphaned = await observe(workspace);
      deepEqual(
        orphanWorkClaims(orphaned)
          .map((claim) => claim.windowId)
          .sort(),
        [CONTROLLER_WINDOW_ID, DESIGN_WINDOW_ID],
      );
      equal(deriveOverallStatus(orphaned), "degraded");
      // projection 作用域不核对绑定代际，只核对活动 Demand。
      deepEqual(
        orphanWorkClaims(await observe(workspace, "projection")).map((claim) => claim.windowId),
        [DESIGN_WINDOW_ID],
      );

      // blocked：活动 Demand 路由 blocked / awaiting-decision，或 closing 中的 pod。
      const demands = held.demands.value ?? [];
      for (const disposition of ["blocked", "awaiting-decision"] as const) {
        const rerouted: Readonly<WorkspaceObservation> = {
          ...held,
          demands: {
            status: "observed",
            issue: null,
            value: demands.map((demand) => ({
              ...demand,
              route:
                demand.route === null
                  ? null
                  : ({ ...demand.route, disposition } as Readonly<DemandControllerRoute>),
            })),
          },
        };
        equal(deriveOverallStatus(rerouted), "blocked", disposition);
      }
      const closingPod: Readonly<WorkspaceObservation> = {
        ...held,
        pods: {
          status: "observed",
          issue: null,
          value: (held.pods.value ?? []).map((pod) => ({ ...pod, state: "closing" as const })),
        },
      };
      equal(deriveOverallStatus(closingPod), "blocked");

      // maintenance：配置或活动布局读不到，压过其他一切。
      const layoutUnavailable: Readonly<WorkspaceObservation> = {
        ...closingPod,
        layout: { status: "unavailable", issue: "layout:root-scope", value: null },
      };
      equal(deriveOverallStatus(layoutUnavailable), "maintenance");
      const layoutValue = held.layout.value;
      if (layoutValue === null) throw new Error("Expected an observed active layout.");
      const layoutIncomplete: Readonly<WorkspaceObservation> = {
        ...held,
        layout: {
          status: "observed",
          issue: null,
          value: { ...layoutValue, status: "incomplete" as const },
        },
      };
      equal(deriveOverallStatus(layoutIncomplete), "maintenance");

      // degraded：任一域不可用或 hook 通道有读不出的记录。
      const hooksSkipped: Readonly<WorkspaceObservation> = {
        ...held,
        hooks: held.hooks.map((host) => ({ ...host, skipped: 1 })),
      };
      equal(deriveOverallStatus(hooksSkipped), "degraded");
    } finally {
      await ledgerRoot.close();
    }
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});
