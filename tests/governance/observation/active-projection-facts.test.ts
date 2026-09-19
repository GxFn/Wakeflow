import { deepEqual, equal, notEqual, rejects } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  readWakeflowConfigAuthoritySnapshot,
  type WakeflowConfigAuthoritySnapshot,
} from "../../../src/configuration/wakeflow-config-authority-snapshot.js";
import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { renderWakeflowConfig } from "../../../src/configuration/wakeflow-config-document.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { buildActiveProjectionFacts } from "../../../src/governance/observation/active-projection-facts.js";
import {
  afterMutationRefresh,
  refreshActiveProjection,
} from "../../../src/governance/observation/active-projection-refresh.js";
import { WAKEFLOW_OBSERVATION_POLICY } from "../../../src/governance/observation/observation-policy.js";
import type {
  ObservedDemand,
  ObservedDomain,
  ObservedPod,
  WorkspaceObservation,
} from "../../../src/governance/observation/workspace-observation.js";
import {
  materializeActiveLayout,
  renderActiveProjectionFiles,
} from "../../../src/kernel/active-projection.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF } from "../../../src/kernel/layout.js";
import { createPodWorktreeReceipt } from "../../../src/kernel/pod-worktree-receipts.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";

/**
 * 观察 → 投影事实 → 刷新（gate-log §13.94 D5、§13.96）：worktree 检出目录此刻在不在是本地
 * 运行时状态，不进事实与指纹；退休证据只在这一轮把活动 Demand 看全时为真；刷新是派生物，
 * 它的失败不能否定一次已经提交的变更。
 */

const OBSERVED_AT = parseUtcInstant("2026-09-18T08:00:00.000Z");
const REPOSITORY_ID = "repository_22222222-2222-4222-8222-222222222222";
const DESIGN_SURFACE_ID = "surface_33333333-3333-4333-8333-333333333333";
const TEST_SURFACE_ID = "surface_44444444-4444-4444-8444-444444444444";
const FEATURE_POD_ID = "pod_dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FEATURE_PRODUCT_WINDOW_ID = "window_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const BINDING_ID = "window_binding_ffffffff-ffff-4fff-8fff-ffffffffffff";
const HEAD_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const DEMAND_ID = "demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

interface Fixture {
  readonly base: string;
  readonly workspaceRoot: RootedDirectory;
  readonly snapshot: Readonly<WakeflowConfigAuthoritySnapshot>;
}

/** 最小公开配置加一个 worktree pod（自带 controller / design / test / product 四个窗口）。 */
function configWithWorktreePod(): Record<string, unknown> {
  const config = createMinimalWakeflowConfig();
  const topology = config.topology as Record<string, unknown>;
  const windows = topology.windows as Record<string, unknown>[];
  windows.push(
    {
      windowId: "window_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      podId: FEATURE_POD_ID,
      role: "controller",
      displayName: "feature Controller",
      root: { kind: "program" },
    },
    {
      windowId: "window_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      podId: FEATURE_POD_ID,
      role: "design",
      displayName: "feature Design",
      root: { kind: "support-surface", surfaceId: DESIGN_SURFACE_ID },
    },
    {
      windowId: "window_00000000-0000-4000-8000-000000000000",
      podId: FEATURE_POD_ID,
      role: "test",
      displayName: "feature Test",
      root: { kind: "support-surface", surfaceId: TEST_SURFACE_ID },
    },
    {
      windowId: FEATURE_PRODUCT_WINDOW_ID,
      podId: FEATURE_POD_ID,
      role: "product",
      displayName: "feature Product A",
      root: { kind: "repository", repositoryId: REPOSITORY_ID },
    },
  );
  (config.pods as Record<string, unknown>[]).push({
    podId: FEATURE_POD_ID,
    name: "feature",
    placement: "worktree",
    lifecycle: "open",
    worktrees: [
      {
        repositoryId: REPOSITORY_ID,
        windowId: FEATURE_PRODUCT_WINDOW_ID,
        suggestedName: "wakeflow-feature",
      },
    ],
    closing: null,
  });
  return config;
}

/** 只写配置与放置根的一次性工作区：事实与刷新策略都不需要账本内容。 */
async function fixture(t: TestContext, options: { readonly ledger: boolean } = { ledger: true }) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-projection-facts-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspacePath = path.join(base, "Workspace");
  mkdirSync(workspacePath, { mode: 0o755 });
  mkdirSync(path.join(base, "ProductA"), { mode: 0o755 });
  if (options.ledger) mkdirSync(path.join(base, "wakeflow-ledger"), { mode: 0o755 });
  for (const relative of [".wakeflow-local", "Design", "Test"]) {
    mkdirSync(path.join(workspacePath, relative), { mode: 0o755 });
  }
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfig(parseWakeflowConfig(configWithWorktreePod())),
    { mode: 0o644 },
  );
  const workspaceRoot = await RootedDirectory.open(workspacePath);
  t.after(async () => {
    await workspaceRoot.close();
  });
  const snapshot = await readWakeflowConfigAuthoritySnapshot(workspaceRoot);
  return Object.freeze({ base, workspaceRoot, snapshot }) satisfies Fixture;
}

function unavailable<Value = never>(): ObservedDomain<Value> {
  return Object.freeze({ status: "unavailable" as const, issue: "fixture:unused", value: null });
}

function observedDemands(
  demands: readonly Readonly<ObservedDemand>[],
): ObservedDomain<readonly Readonly<ObservedDemand>[]> {
  return Object.freeze({ status: "observed" as const, issue: null, value: demands });
}

/** 配置里的 worktree pod 加一份回执；`checkoutPresent` 是那次 stat 的结果。 */
function worktreePod(
  fixtureValue: Readonly<Fixture>,
  receipts: readonly boolean[],
): Readonly<ObservedPod> {
  const pod = fixtureValue.snapshot.model.pods.find((entry) => entry.placement === "worktree");
  const worktree = pod?.worktrees[0];
  if (pod === undefined || worktree === undefined) throw new Error("fixture pod is missing");
  return Object.freeze({
    pod,
    windowIds: [],
    boundWindowIds: [],
    receipts: Object.freeze(
      receipts.map((checkoutPresent) =>
        Object.freeze({
          receipt: createPodWorktreeReceipt({
            hostId: "codex",
            podId: pod.podId,
            windowId: worktree.windowId,
            repositoryId: worktree.repositoryId,
            bindingId: BINDING_ID,
            worktree: {
              path: path.join(fixtureValue.base, "wakeflow-feature"),
              head: HEAD_COMMIT,
              branch: "wakeflow-feature",
              locked: false,
            },
            observedAt: OBSERVED_AT,
          }),
          checkoutPresent,
        }),
      ),
    ),
    state: null,
    activeDemandId: null,
  });
}

function observationOf(
  fixtureValue: Readonly<Fixture>,
  scope: "projection" | "full",
  pods: readonly Readonly<ObservedPod>[],
  demands: ObservedDomain<readonly Readonly<ObservedDemand>[]>,
): Readonly<WorkspaceObservation> {
  return Object.freeze({
    observedAt: OBSERVED_AT,
    scope,
    snapshot: fixtureValue.snapshot,
    configDigest: fixtureValue.snapshot.configDigest,
    policy: WAKEFLOW_OBSERVATION_POLICY,
    layout: unavailable(),
    board: unavailable(),
    demands,
    claims: unavailable(),
    bindings: Object.freeze([]),
    hooks: Object.freeze([]),
    pods: Object.freeze({ status: "observed" as const, issue: null, value: pods }),
    repositories: unavailable(),
    assets: Object.freeze([]),
  });
}

function projectionOf(
  fixtureValue: Readonly<Fixture>,
  scope: "projection" | "full",
  receipts: readonly boolean[],
) {
  return renderActiveProjectionFiles(
    buildActiveProjectionFacts(
      observationOf(fixtureValue, scope, [worktreePod(fixtureValue, receipts)], observedDemands([])),
    ),
  );
}

test("检出目录此刻在不在不进投影：指纹与页面字节只认回执有没有，full 与 projection 算出同一份", async (t) => {
  const workspace = await fixture(t);
  const present = projectionOf(workspace, "full", [true]);
  const checkoutRemoved = projectionOf(workspace, "full", [false]);

  // 工作区外的一次 `git worktree remove` 不是 Wakeflow 变更，没有刷新能修复它带来的 stale。
  equal(checkoutRemoved[0]?.fingerprint, present[0]?.fingerprint);
  deepEqual(
    checkoutRemoved.map((entry) => entry.digest),
    present.map((entry) => entry.digest),
  );

  // 变更后的刷新用 projection 作用域，status 与 verify 用 full：两边必须算出同一份指纹。
  equal(projectionOf(workspace, "projection", [false])[0]?.fingerprint, present[0]?.fingerprint);

  // 回执本身是 Wakeflow 的变更写下的事实：有没有回执仍然改变指纹与页面。
  const withoutReceipt = projectionOf(workspace, "full", []);
  notEqual(withoutReceipt[0]?.fingerprint, present[0]?.fingerprint);

  const status = present[1]?.content ?? "";
  equal(status.includes("Product A: present"), true, status);
  equal(status.includes("checkout-missing"), false, status);
  equal((withoutReceipt[1]?.content ?? "").includes("Product A: absent"), true);
});

test("退休证据：域与其中每个 Demand 都读得出才算看全，任一读不出这一轮就不得退休", async (t) => {
  const workspace = await fixture(t);
  const evidenceOf = (demands: ObservedDomain<readonly Readonly<ObservedDemand>[]>) =>
    buildActiveProjectionFacts(observationOf(workspace, "projection", [], demands)).activeDemands;

  deepEqual(evidenceOf(observedDemands([])), { observed: true, activeDemandIds: [] });

  // 单个 Demand 读不出：它仍是活动的（目录还在），但这一轮不算看全。
  const unreadable: Readonly<ObservedDemand> = Object.freeze({
    demandId: DEMAND_ID,
    status: "unavailable" as const,
    issue: "stream-read",
    loaded: null,
    reviewSnapshot: null,
    route: null,
  });
  deepEqual(evidenceOf(observedDemands([unreadable])), {
    observed: false,
    activeDemandIds: [DEMAND_ID],
  });

  // 域本身读不出（`.wakeflow-active/current` 列不出来）：既没有 id，也不算看全。
  deepEqual(evidenceOf(unavailable()), { observed: false, activeDemandIds: [] });
});

test("刷新是派生物：非 io 的 Wakeflow 失败被静默吞下，已经提交的变更照常返回", async (t) => {
  // 账本放置根不存在：刷新以 precondition-failed 失败，那不是 io-failure。
  const workspace = await fixture(t, { ledger: false });
  await rejects(
    refreshActiveProjection(workspace.workspaceRoot),
    (error: unknown) =>
      error instanceof WakeflowError
      && error.code === "precondition-failed"
      && error.reason === "ledger-root-missing",
  );

  let mutations = 0;
  const result = await afterMutationRefresh(workspace.workspaceRoot, undefined, async () => {
    mutations += 1;
    return "committed" as const;
  });
  equal(result, "committed");
  equal(mutations, 1);

  // 中止仍然上抛：调用方自己要求停下，不是派生物的失败。
  await rejects(
    afterMutationRefresh(workspace.workspaceRoot, AbortSignal.abort(), async () => "committed"),
    (error: unknown) => error instanceof WakeflowError && error.reason === "aborted",
  );
});

test("刷新这条路也在锁内：锁被别人持有时这一轮以 projection-contended 失败，一个字节都不写", async (t) => {
  // §13.98 F3：内核测试证明渲染闭包在锁内执行；这里证明 refreshActiveProjection 走的就是那条路，
  // 而不是在锁外渲染完再去发布——锁被占住时它必须失败，且不得留下任何投影字节。
  const workspace = await fixture(t);
  const root = workspace.workspaceRoot;
  await materializeActiveLayout(root, { recovering: false });
  const activeRoot = path.join(root.absolutePath, ".wakeflow-active");
  const lockPath = path.join(root.absolutePath, ...WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF.split("/"));
  writeFileSync(
    lockPath,
    rootedExclusiveFileLockRecordTextForTest({
      pid: process.ppid,
      tokenUuid: "11111111-1111-4111-8111-111111111111",
    }),
    { mode: 0o600 },
  );
  // 锁种下之后再取快照：比较的是"这一轮有没有写投影"，不是我们自己种的锁。
  const before = readdirSync(activeRoot).sort();

  await rejects(
    refreshActiveProjection(root, { acquireTimeoutMilliseconds: 50 }),
    (error: unknown) =>
      error instanceof WakeflowError
      && error.code === "io-failure"
      && error.reason === "projection-contended"
      && error.retryable,
  );

  deepEqual(readdirSync(activeRoot).sort(), before, "争用的一轮不得新建任何投影文件");
  equal(
    readFileSync(lockPath, "utf8").length > 0,
    true,
    "争用的一轮不得夺走别人的锁",
  );
});
