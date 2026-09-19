import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { executeWindowBindingRequest } from "../../../src/capabilities/endpoint/service.js";
import { executePodRequest, type PodHostFacade } from "../../../src/capabilities/pod/service.js";
import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { createPreparedWorkspaceStore } from "../../support/prepared-workspace.js";

/**
 * pod 切片效果（§13.91 D1 到 D7）：create preview 零写、apply 一次配置事务、同键重放、重名阻塞；
 * pod 窗口握手（产品窗口必须带 worktree 回执）后 ready；两段关闭：demand 归档与分支处置 →
 * closing → 窗口退役与检出处置 → closed，配置与回执目录都不再有该 pod。宿主由测试代替：
 * hook 记录直接写入，worktree 用真实 `git worktree add` 造出。
 */

const CODEX: PodHostFacade = {
  hostId: "codex",
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
};
const CLOCK = { clock: () => parseUtcInstant("2026-09-10T12:00:00.000Z") };

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
  return result.stdout;
}

interface Fixture {
  readonly base: string;
  readonly root: string;
  readonly product: string;
  readonly rooted: RootedDirectory;
}

/**
 * Fresh 初始化链只跑一次：两个测试都从同一个"工作区已初始化、产品仓已有首提交"的树出发，
 * 之前每个测试各跑一遍 `git init` 与 `fresh-initialize` 的 preview 与 apply。链留在基线里，
 * 每个测试仍按需复制一份自己的真实文件系统副本，并在 `t.after` 里删掉它。
 */
const podWorkspaceStore = createPreparedWorkspaceStore<undefined, null>({
  prefix: "wakeflow-pod-slice-",
  keyOf: () => "fresh",
  build: async (base) => {
    const root = path.join(base, "Workspace");
    const product = path.join(base, "ProductA");
    mkdirSync(root);
    mkdirSync(product);
    git(root, "init", "--quiet");
    git(product, "init", "--quiet");
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
    return null;
  },
});

async function fixture(t: TestContext): Promise<Fixture> {
  const prepared = await podWorkspaceStore.materialize(undefined);
  t.after(() => rmSync(prepared.fixtureRoot, { recursive: true, force: true }));
  const base = realpathSync(prepared.fixtureRoot);
  const root = path.join(base, "Workspace");
  const rooted = await RootedDirectory.open(root);
  t.after(() => rooted.close());
  return { base, root, product: path.join(base, "ProductA"), rooted };
}

function readConfig(fixture: Fixture) {
  return parseWakeflowConfigV3(
    JSON.parse(readFileSync(path.join(fixture.root, "wakeflow.config.json"), "utf8")),
  );
}

async function pod(fixture: Fixture, request: Readonly<Record<string, unknown>>) {
  return executePodRequest(CODEX, { root: fixture.root, ...request }, CLOCK);
}

function failsWith(code: string, reason: string) {
  return (error: unknown) =>
    error instanceof WakeflowError && error.code === code && error.reason === reason;
}

async function inspect(fixture: Fixture, windowId: string) {
  const result = await executeWindowBindingRequest(CODEX, {
    root: fixture.root,
    operation: "inspect",
    windowId,
  });
  if (result.kind !== "WakeflowWindowBindingInspection") throw new Error("Expected inspection.");
  return result;
}

async function register(
  fixture: Fixture,
  windowId: string,
  handleValue: string,
  cwd: string,
  worktree?: { readonly porcelain: string; readonly commonDir: string },
) {
  const inspection = await inspect(fixture, windowId);
  await writeHostHookObservation(fixture.rooted, {
    hostId: "codex",
    event: "session-start",
    sessionId: handleValue,
    cwd,
    recordedAt: parseUtcInstant("2026-09-10T11:59:00.000Z"),
  });
  const result = await executeWindowBindingRequest(
    CODEX,
    {
      root: fixture.root,
      operation: "register",
      windowId,
      observation: {
        handle: { kind: "codex-thread", value: handleValue },
        launchIntentDigest: inspection.launchIntent.intentDigest,
        observedAt: "2026-09-10T11:59:30.000Z",
        ...(worktree === undefined ? {} : { worktree }),
      },
    },
    CLOCK,
  );
  if (result.kind !== "WakeflowWindowBindingMutation" || result.binding === null) {
    throw new Error("Expected a registered binding.");
  }
  return result;
}

async function decommission(
  fixture: Fixture,
  windowId: string,
  binding: { readonly bindingId: string; readonly bindingDigest: string },
) {
  const result = await executeWindowBindingRequest(
    CODEX,
    {
      root: fixture.root,
      operation: "decommission",
      windowId,
      expectedBindingId: binding.bindingId,
      expectedBindingDigest: binding.bindingDigest,
      closure: {
        preClose: { kind: "codex-thread", status: "active" },
        closeResult: { status: "closed" },
        postClose: { kind: "codex-thread", status: "archived" },
      },
    },
    CLOCK,
  );
  if (result.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(result.disposition, "decommissioned");
}

test("create：preview 零写、apply 一次配置事务派生四个窗口与一条 worktree 意图、同键重放、重名与 main 被拒", {
  timeout: 120_000,
}, async (t) => {
  const fx = await fixture(t);
  const before = readFileSync(path.join(fx.root, "wakeflow.config.json"), "utf8");
  const previewed = await pod(fx, {
    mode: "preview",
    intent: { kind: "create", name: "feature-x", idempotencyKey: "pod-1" },
  });
  if (previewed.kind !== "WakeflowPodPreview" || previewed.plan === null) {
    throw new Error("Expected a ready preview.");
  }
  equal(previewed.status, "ready");
  equal(previewed.plan.kind, "create");
  equal(previewed.plan.pod.name, "feature-x");
  equal(previewed.plan.pod.state, "creating");
  deepEqual(
    previewed.plan.windows.map((window) => window.role),
    ["controller", "design", "test", "product"],
  );
  equal(previewed.plan.worktrees[0]?.suggestedName, "wakeflow-feature-x");
  equal(previewed.next.frontier, "pod-create-apply");
  equal(readFileSync(path.join(fx.root, "wakeflow.config.json"), "utf8"), before, "preview wrote");
  equal(JSON.stringify(previewed).includes(fx.base), false);

  const created = await pod(fx, {
    mode: "apply",
    intent: { kind: "create", name: "feature-x", idempotencyKey: "pod-1" },
    planDigest: previewed.planDigest,
  });
  if (created.kind !== "WakeflowPodMutation" || created.pod === null)
    throw new Error("Expected pod.");
  equal(created.disposition, "created");
  equal(created.pod.state, "creating");
  equal(created.next.frontier, "pod-window-registration");
  equal(created.next.blockers.length, 5, "four unbound windows plus the missing worktree receipt");
  const config = readConfig(fx);
  equal(config.pods.length, 2);
  equal(config.topology.windows.length, 8);
  equal(config.pods[1]?.name, "feature-x");
  equal(config.pods[1]?.worktrees[0]?.suggestedName, "wakeflow-feature-x");

  const replayPreview = await pod(fx, {
    mode: "preview",
    intent: { kind: "create", name: "feature-x", idempotencyKey: "pod-1" },
  });
  if (replayPreview.kind !== "WakeflowPodPreview") throw new Error("Expected preview.");
  equal(replayPreview.status, "ready");
  const replayed = await pod(fx, {
    mode: "apply",
    intent: { kind: "create", name: "feature-x", idempotencyKey: "pod-1" },
    planDigest: replayPreview.planDigest,
  });
  if (replayed.kind !== "WakeflowPodMutation") throw new Error("Expected mutation.");
  equal(replayed.disposition, "already-created");
  equal(readConfig(fx).pods.length, 2);

  const taken = await pod(fx, {
    mode: "preview",
    intent: { kind: "create", name: "feature-x", idempotencyKey: "pod-2" },
  });
  if (taken.kind !== "WakeflowPodPreview") throw new Error("Expected preview.");
  deepEqual(taken.blockers, ["name-taken"]);
  equal(taken.plan, null);
  const reserved = await pod(fx, {
    mode: "preview",
    intent: { kind: "create", name: "main", idempotencyKey: "pod-3" },
  });
  if (reserved.kind !== "WakeflowPodPreview") throw new Error("Expected preview.");
  deepEqual(reserved.blockers, ["name-reserved:main", "name-taken"]);
  await rejects(
    pod(fx, {
      mode: "apply",
      intent: { kind: "create", name: "feature-y", idempotencyKey: "pod-4" },
      planDigest: `sha256:${"0".repeat(64)}`,
    }),
    failsWith("precondition-failed", "plan-drift"),
  );
});

test("生命周期：pod 窗口握手（产品窗口带 worktree 回执）到 ready，再两段关闭到 closed", {
  timeout: 180_000,
}, async (t) => {
  const fx = await fixture(t);
  const created = await pod(fx, {
    mode: "apply",
    intent: { kind: "create", name: "feature-x", idempotencyKey: "pod-1" },
    planDigest: (
      (await pod(fx, {
        mode: "preview",
        intent: { kind: "create", name: "feature-x", idempotencyKey: "pod-1" },
      })) as { readonly planDigest: string }
    ).planDigest,
  });
  if (created.kind !== "WakeflowPodMutation" || created.pod === null)
    throw new Error("Expected pod.");
  const podId = created.pod.podId;
  const windows = created.windows;
  const controller = windows.find((window) => window.role === "controller");
  const design = windows.find((window) => window.role === "design");
  const testWindow = windows.find((window) => window.role === "test");
  const product = windows.find((window) => window.role === "product");
  if (!controller || !design || !testWindow || !product) throw new Error("Expected four windows.");

  const productIntent = await inspect(fx, product.windowId);
  equal(productIntent.launchIntent.podId, podId);
  equal(productIntent.launchIntent.podPlacement, "worktree");
  equal(productIntent.launchIntent.worktree?.suggestedName, "wakeflow-feature-x");
  const execution = productIntent.launchIntent.execution as {
    readonly environment: string;
    readonly worktree: { readonly launch: string; readonly hostBranch: string | null };
  };
  equal(execution.environment, "worktree");
  equal(execution.worktree.launch, "codex-worktree-thread");
  equal(execution.worktree.hostBranch, null);
  equal(JSON.stringify(productIntent).includes(fx.base), false);

  // 产品窗口没有 worktree 观察即拒绝；主检出当作检出也拒绝。
  await rejects(
    register(fx, product.windowId, "codex-host-owned-thread:pod-product-nowt", fx.product),
    failsWith("invalid-request", "worktree-receipt-required"),
  );
  const checkout = path.join(fx.base, "wt-feature-x");
  git(fx.product, "worktree", "add", "--quiet", checkout, "-b", "wakeflow-feature-x");
  const worktree = {
    porcelain: git(checkout, "worktree", "list", "--porcelain"),
    commonDir: git(checkout, "rev-parse", "--git-common-dir").trim(),
  };
  await rejects(
    register(
      fx,
      product.windowId,
      "codex-host-owned-thread:pod-product-main",
      fx.product,
      worktree,
    ),
    failsWith("precondition-failed", "worktree-receipt"),
  );
  const productRegistered = await register(
    fx,
    product.windowId,
    "codex-host-owned-thread:pod-product",
    checkout,
    worktree,
  );
  deepEqual(JSON.parse(JSON.stringify(productRegistered.worktree)), {
    head: git(fx.product, "rev-parse", "HEAD").trim(),
    branch: "wakeflow-feature-x",
    detached: false,
    locked: false,
  });
  // 运行期泄露由这条看住；基线构建期烘进去的路径由 assertRelocatable 在基线落成时挡下。
  equal(JSON.stringify(productRegistered).includes(fx.base), false, "result leaked a path");
  const receiptFile = path.join(
    fx.root,
    ".wakeflow-local/runtime/hosts/codex/pods",
    podId,
    "worktrees",
    `${productIntent.launchIntent.worktree?.repositoryId}.json`,
  );
  equal(statSync(receiptFile).mode & 0o777, 0o600);
  equal(readFileSync(receiptFile, "utf8").includes(checkout), true);

  const testIntent = await inspect(fx, testWindow.windowId);
  const attached = (
    testIntent.launchIntent.execution as {
      readonly attachedWorktrees: readonly {
        readonly status: string;
        readonly pathFromWorkspaceRoot: string;
      }[];
    }
  ).attachedWorktrees;
  equal(attached[0]?.status, "receipt-present");
  equal(attached[0]?.pathFromWorkspaceRoot, path.relative(fx.root, checkout));
  const controllerRegistered = await register(
    fx,
    controller.windowId,
    "codex-host-owned-thread:pod-controller",
    fx.root,
  );
  equal(controllerRegistered.next.frontier, "window-registration");
  equal(controllerRegistered.next.blockers.length, 2, "only this pod's windows block");
  const designRegistered = await register(
    fx,
    design.windowId,
    "codex-host-owned-thread:pod-design",
    path.join(fx.root, "Design"),
  );
  const testRegistered = await register(
    fx,
    testWindow.windowId,
    "codex-host-owned-thread:pod-test",
    path.join(fx.root, "Test"),
  );
  const ready = await pod(fx, { mode: "recover", podId });
  if (ready.kind !== "WakeflowPodMutation") throw new Error("Expected mutation.");
  equal(ready.disposition, "healthy");
  equal(ready.pod?.state, "ready");
  equal(ready.worktrees[0]?.receipt, "present");
  equal(ready.next.frontier, null);

  // 第一段关闭：缺少分支处置阻塞；给出处置后进入 closing。
  const missing = await pod(fx, {
    mode: "preview",
    intent: { kind: "close", podId, branches: [] },
  });
  if (missing.kind !== "WakeflowPodPreview") throw new Error("Expected preview.");
  deepEqual(missing.blockers, [
    `branch-disposition-missing:${productIntent.launchIntent.worktree?.repositoryId}`,
  ]);
  const branches = [
    {
      repositoryId: productIntent.launchIntent.worktree?.repositoryId,
      disposition: "abandoned",
    },
  ];
  const closeRequest = await pod(fx, {
    mode: "preview",
    intent: { kind: "close", podId, branches },
  });
  if (closeRequest.kind !== "WakeflowPodPreview" || closeRequest.plan === null) {
    throw new Error("Expected a ready close preview.");
  }
  equal(closeRequest.plan.kind, "close-request");
  equal(closeRequest.next.frontier, "pod-close-apply");
  const closing = await pod(fx, {
    mode: "apply",
    intent: { kind: "close", podId, branches },
    planDigest: closeRequest.planDigest,
  });
  if (closing.kind !== "WakeflowPodMutation") throw new Error("Expected mutation.");
  equal(closing.disposition, "closing");
  equal(closing.pod?.state, "closing");
  equal(closing.next.frontier, "pod-window-decommission");
  equal(readConfig(fx).pods[1]?.closing?.branches[0]?.branch, "wakeflow-feature-x");

  // 第二段关闭：窗口仍绑定、检出仍在 → 阻塞；退役四窗口并移除检出后 → closed。
  const blockedClose = await pod(fx, {
    mode: "preview",
    intent: { kind: "close", podId, branches: [] },
  });
  if (blockedClose.kind !== "WakeflowPodPreview") throw new Error("Expected preview.");
  equal(blockedClose.blockers.filter((entry) => entry.startsWith("window-bound:")).length, 4);
  equal(
    blockedClose.blockers.some((entry) => entry.startsWith("worktree-present:")),
    true,
  );
  for (const [window, registered] of [
    [product, productRegistered],
    [controller, controllerRegistered],
    [design, designRegistered],
    [testWindow, testRegistered],
  ] as const) {
    if (registered.binding === null) throw new Error("Expected binding.");
    await decommission(fx, window.windowId, registered.binding);
  }
  const disposal = await pod(fx, {
    mode: "preview",
    intent: { kind: "close", podId, branches: [] },
  });
  if (disposal.kind !== "WakeflowPodPreview") throw new Error("Expected preview.");
  deepEqual(disposal.blockers, [
    `worktree-present:${productIntent.launchIntent.worktree?.repositoryId}`,
  ]);
  git(fx.product, "worktree", "remove", "--force", checkout);
  const completePreview = await pod(fx, {
    mode: "preview",
    intent: { kind: "close", podId, branches: [] },
  });
  if (completePreview.kind !== "WakeflowPodPreview" || completePreview.plan === null) {
    throw new Error("Expected a ready close-complete preview.");
  }
  equal(completePreview.plan.kind, "close-complete");
  equal(completePreview.plan.pod.state, "closed");
  const closed = await pod(fx, {
    mode: "apply",
    intent: { kind: "close", podId, branches: [] },
    planDigest: completePreview.planDigest,
  });
  if (closed.kind !== "WakeflowPodMutation") throw new Error("Expected mutation.");
  equal(closed.disposition, "closed");
  equal(closed.pod, null);
  equal(closed.retiredReceipts, 1);
  equal(closed.next.frontier, null);
  const finalConfig = readConfig(fx);
  equal(finalConfig.pods.length, 1);
  equal(finalConfig.topology.windows.length, 4);
  equal(existsSync(path.dirname(path.dirname(receiptFile))), false, "receipt directory survived");
  const unknown = await pod(fx, {
    mode: "preview",
    intent: { kind: "close", podId, branches: [] },
  });
  if (unknown.kind !== "WakeflowPodPreview") throw new Error("Expected preview.");
  deepEqual(unknown.blockers, [`pod-unknown:${podId}`]);
  const recovered = await pod(fx, { mode: "recover", podId });
  if (recovered.kind !== "WakeflowPodMutation") throw new Error("Expected mutation.");
  equal(recovered.disposition, "healthy");
  equal(recovered.pod, null);
});
