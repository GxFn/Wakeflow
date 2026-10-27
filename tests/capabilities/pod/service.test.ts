import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import {
  executeWindowBindingRequest,
  type WindowBindingHostFacade,
} from "../../../src/capabilities/endpoint/service.js";
import { executeVerifyRequest } from "../../../src/capabilities/observation/service.js";
import { executePodRequest, type PodHostFacade } from "../../../src/capabilities/pod/service.js";
import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { executeClaudeCodeWakeflowMaintenance } from "../../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { claudeCodeWindowHostIdentityProfile } from "../../../src/hosts/claude-code/claude-code-window-host-identity-profile.js";
import { renderClaudeCodeWindowLaunchInstructions } from "../../../src/hosts/claude-code/claude-code-window-launch-instructions.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { renderCodexWindowLaunchInstructions } from "../../../src/hosts/codex/codex-window-launch-instructions.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { inspectWakeflowWindowRuntimeProjectionSet } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-projection-inspection.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { createPreparedWorkspaceStore } from "../../support/prepared-workspace.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：pod 切片效果（§13.91 D1 到 D7）：create preview 零写、apply 一次配置事务、同键重放、
 * 重名阻塞；pod 窗口握手（产品窗口必须带 worktree 回执）后 ready；两段关闭：demand 归档与分支处置 →
 * closing → 窗口退役与检出处置 → closed，配置与回执目录都不再有该 pod；双宿主初始化的工作区里对端
 * 宿主仍握着的窗口绑定也阻塞关闭完成，两宿主的投影与回执一并清理（open-items W7）。宿主由测试代替：
 * hook 记录直接写入，worktree 用真实 `git worktree add` 造出。
 */

/** 与 Codex 组合根一致的 pod facade：本宿主 Codex，两个宿主的 profile 都在（W7）。 */
const CODEX: PodHostFacade & {
  readonly renderLaunchInstructions: typeof renderCodexWindowLaunchInstructions;
} = {
  hostId: "codex",
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
  renderLaunchInstructions: renderCodexWindowLaunchInstructions,
  hosts: CODEX_OBSERVATION_FACADE.hosts,
};
const CLAUDE: WindowBindingHostFacade = {
  hostId: "claude-code",
  resourceProfile: claudeCodeWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
  renderLaunchInstructions: renderClaudeCodeWindowLaunchInstructions,
};
const CLAUDE_TMUX = { socketName: null, sessionName: "wakeflow", windowId: "@3", paneId: "%7" };
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
  return parseWakeflowConfig(
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
    cwd: fixture.root,
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
        ...(worktree === undefined ? {} : { worktree: { ...worktree, executionRoot: cwd } }),
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

/** 把 Claude 宿主也初始化到同一个工作区：reconcile 补齐它的运行时根、投影与资产（双宿主工作区）。 */
async function initializeClaudeHost(fixture: Fixture): Promise<void> {
  const preview = await executeClaudeCodeWakeflowMaintenance({
    root: fixture.root,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  if (preview.mode !== "preview" || preview.planDigest === null) {
    throw new Error("Expected a ready Claude reconcile plan.");
  }
  await executeClaudeCodeWakeflowMaintenance({
    root: fixture.root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: preview.planDigest,
  });
}

function claudeLocatorFile(fixture: Fixture, windowId: string): string {
  return path.join(
    fixture.root,
    ".wakeflow-local/runtime/hosts/claude-code/identity/window-locators",
    `${windowId}.json`,
  );
}

/** 在 Claude 宿主登记一个 pod 窗口：该宿主的 session-start 记录加 tmux 坐标。 */
async function registerOnClaude(
  fixture: Fixture,
  windowId: string,
  sessionId: string,
  cwd: string,
) {
  const inspection = await executeWindowBindingRequest(CLAUDE, {
    root: fixture.root,
    operation: "inspect",
    windowId,
  });
  if (inspection.kind !== "WakeflowWindowBindingInspection")
    throw new Error("Expected inspection.");
  await writeHostHookObservation(fixture.rooted, {
    hostId: "claude-code",
    event: "session-start",
    sessionId,
    cwd,
    recordedAt: parseUtcInstant("2026-09-10T11:59:00.000Z"),
  });
  const result = await executeWindowBindingRequest(
    CLAUDE,
    {
      root: fixture.root,
      operation: "register",
      windowId,
      observation: {
        handle: { kind: "claude-session", value: sessionId },
        launchIntentDigest: inspection.launchIntent.intentDigest,
        observedAt: "2026-09-10T11:59:30.000Z",
        tmux: CLAUDE_TMUX,
      },
    },
    CLOCK,
  );
  if (result.kind !== "WakeflowWindowBindingMutation" || result.binding === null) {
    throw new Error("Expected a registered Claude binding.");
  }
  return result;
}

/** 从 Claude 宿主退役：关前 pane 在、关后 pane 不在，没有 session-end 记录即 manual-host-gate。 */
async function decommissionOnClaude(
  fixture: Fixture,
  windowId: string,
  binding: { readonly bindingId: string; readonly bindingDigest: string },
) {
  const locator = JSON.parse(readFileSync(claudeLocatorFile(fixture, windowId), "utf8")) as {
    readonly locatorId: string;
    readonly programId: string;
  };
  const pane = {
    ...CLAUDE_TMUX,
    paneWindowId: "@3",
    paneDead: false,
    currentCommand: "claude",
    options: {
      programId: locator.programId,
      hostId: "claude-code",
      windowId,
      bindingId: binding.bindingId,
      locatorId: locator.locatorId,
    },
  };
  const result = await executeWindowBindingRequest(
    CLAUDE,
    {
      root: fixture.root,
      operation: "decommission",
      windowId,
      expectedBindingId: binding.bindingId,
      expectedBindingDigest: binding.bindingDigest,
      closure: {
        preClose: { kind: "tmux-panes", panes: [pane] },
        closeResult: { status: "closed" },
        postClose: { kind: "tmux-panes", panes: [] },
      },
    },
    CLOCK,
  );
  if (result.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(result.disposition, "decommissioned");
}

function projectionFile(fixture: Fixture, hostId: "codex" | "claude-code", windowId: string) {
  return path.join(
    fixture.root,
    ".wakeflow-local/runtime/hosts",
    hostId,
    "projections/window-runtime",
    `${windowId}.json`,
  );
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
  // 窗口集变了：本宿主的窗口运行投影随配置事务收敛（G6，§13.111 D5）——四个新窗口有未登记投影，
  // 原有四个窗口的投影不因拓扑指纹变化而过期。
  const rooted = await RootedDirectory.open(fx.root);
  try {
    const projections = await inspectWakeflowWindowRuntimeProjectionSet(rooted, {
      config,
      resourceProfile: codexWorkspaceHostResourceProfile,
      identityProfile: codexWindowHostIdentityProfile,
    });
    if (projections.status !== "observed") throw new Error(`projections ${projections.status}`);
    deepEqual(
      projections.windows.map((window) => window.status),
      Array.from({ length: 8 }, () => "current"),
    );
  } finally {
    await rooted.close();
  }

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
    readonly target: { readonly environment: { readonly type: string } };
    readonly worktree: { readonly launch: string; readonly hostBranch: string | null };
  };
  equal(execution.target.environment.type, "local");
  equal(execution.worktree.launch, "git-worktree");
  equal(execution.worktree.hostBranch, "wakeflow-feature-x");
  equal(JSON.stringify(productIntent).includes(fx.base), false);

  // 产品窗口没有 worktree 观察即拒绝；主检出当作检出也拒绝。
  await rejects(
    register(fx, product.windowId, "codex-host-owned-thread:pod-product-nowt", fx.product),
    failsWith("invalid-request", "worktree-receipt-required"),
  );
  // 真实宿主上检出在工作区根之下（Claude 建在仓库内的 .claude/worktrees/）：porcelain 含根路径，
  // 靠请求隐私扫描对 observation.worktree 的豁免才能登记（§13.128）。
  const checkout = path.join(fx.root, ".wakeflow-test-worktrees", "wt-feature-x");
  git(fx.product, "worktree", "add", "--quiet", checkout, "-b", "wakeflow-feature-x");
  const worktree = {
    porcelain: git(checkout, "worktree", "list", "--porcelain"),
    commonDir: git(checkout, "rev-parse", "--git-common-dir").trim(),
  };
  // A project-root SessionStart cannot silently select a product checkout.
  const missingRootHandle = "project-chat:missing-execution-root";
  await writeHostHookObservation(fx.rooted, {
    hostId: "codex",
    event: "session-start",
    sessionId: missingRootHandle,
    cwd: fx.root,
    recordedAt: parseUtcInstant("2026-09-10T11:59:00.000Z"),
  });
  for (const extra of [{}, { executionRoot: "." }]) {
    await rejects(
      executeWindowBindingRequest(
        CODEX,
        {
          root: fx.root,
          operation: "register",
          windowId: product.windowId,
          observation: {
            handle: { kind: "codex-thread", value: missingRootHandle },
            launchIntentDigest: productIntent.launchIntent.intentDigest,
            observedAt: "2026-09-10T11:59:30.000Z",
            worktree: { ...worktree, ...extra },
          },
        },
        CLOCK,
      ),
      failsWith("invalid-request", "worktree-execution-root-required"),
    );
  }
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
  // 工作区根、它的父目录和产品仓库之外的检出被拒：公开结果只写相对工作区的路径，不能写成
  // `../../...`（§13.161 B5-3）。
  const far = mkdtempSync(path.join(os.tmpdir(), "wakeflow-far-checkout-"));
  const outside = path.join(far, "wt-feature-x");
  try {
    git(fx.product, "worktree", "add", "--quiet", outside, "-b", "wakeflow-outside-x");
    await rejects(
      register(fx, product.windowId, "codex-host-owned-thread:pod-product-outside", outside, {
        porcelain: git(outside, "worktree", "list", "--porcelain"),
        commonDir: git(outside, "rev-parse", "--git-common-dir").trim(),
      }),
      failsWith("precondition-failed", "worktree-outside-workspace"),
    );
    git(fx.product, "worktree", "remove", "--force", outside);
  } finally {
    rmSync(far, { recursive: true, force: true });
  }
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
  // 一个检出同一时刻只属于一个 pod（§13.128）：第二个 pod 的产品窗口拿同一检出登记被拒。
  const rival = await pod(fx, {
    mode: "apply",
    intent: { kind: "create", name: "feature-y", idempotencyKey: "pod-2" },
    planDigest: (
      (await pod(fx, {
        mode: "preview",
        intent: { kind: "create", name: "feature-y", idempotencyKey: "pod-2" },
      })) as { readonly planDigest: string }
    ).planDigest,
  });
  if (rival.kind !== "WakeflowPodMutation") throw new Error("Expected rival pod.");
  const rivalProduct = rival.windows.find((window) => window.role === "product");
  if (!rivalProduct) throw new Error("Expected rival product window.");
  await rejects(
    register(
      fx,
      rivalProduct.windowId,
      "codex-host-owned-thread:pod-product-rival",
      checkout,
      worktree,
    ),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "precondition-failed" &&
      error.reason === "worktree-occupied" &&
      error.details?.podId === podId,
  );
  // 没有任何登记与回执的 pod 直接两段关闭：不需要分支处置，也没有要退役的窗口与检出。
  const closeRival = async () => {
    const intent = { kind: "close", podId: rival.pod?.podId ?? "", branches: [] };
    const preview = (await pod(fx, { mode: "preview", intent })) as { readonly planDigest: string };
    return pod(fx, { mode: "apply", intent, planDigest: preview.planDigest });
  };
  const rivalClosing = (await closeRival()) as {
    readonly disposition: string;
    readonly pod: { readonly state: string } | null;
    readonly next: { readonly frontier: string | null; readonly owner: string };
  };
  equal(rivalClosing.disposition, "closing");
  // 无绑定无检出即派生为 closed，但 pod 仍在配置里：next 必须指回第二段 close apply。
  equal(rivalClosing.pod?.state, "closed");
  equal(rivalClosing.next.frontier, "pod-close-apply");
  equal(rivalClosing.next.owner, "controller");
  equal(((await closeRival()) as { readonly disposition: string }).disposition, "closed");
  equal(readConfig(fx).pods.length, 2);
  const receiptFile = path.join(
    fx.root,
    ".wakeflow-local/runtime/hosts/codex/pods",
    podId,
    "worktrees",
    `${productIntent.launchIntent.worktree?.repositoryId}.json`,
  );
  equal(statSync(receiptFile).mode & 0o777, 0o600);
  equal(readFileSync(receiptFile, "utf8").includes(checkout), true);
  // 登记写了 worktree 回执，pod 的投影事实变了：绑定变更提交后活动投影必须已重算（§13.128）。
  const verifiedAfterRegister = await executeVerifyRequest(CODEX_OBSERVATION_FACADE, {
    root: fx.root,
  });
  equal(
    verifiedAfterRegister.gates.find((gate) => gate.name === "active-projection")?.status,
    "pass",
    JSON.stringify(verifiedAfterRegister.gates.filter((gate) => gate.status !== "pass")),
  );

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
  const duplicated = await pod(fx, {
    mode: "preview",
    intent: { kind: "close", podId, branches: [...branches, ...branches] },
  });
  if (duplicated.kind !== "WakeflowPodPreview") throw new Error("Expected preview.");
  deepEqual(duplicated.blockers, [
    `branch-disposition-duplicate:${productIntent.launchIntent.worktree?.repositoryId}`,
  ]);
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
  // 被关闭 pod 的四个窗口投影文件随配置事务退役（§13.114 D3）；primary pod 的四个仍在。
  const projectionsRoot = path.join(
    fx.root,
    ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
  );
  for (const window of [product, controller, design, testWindow]) {
    equal(
      existsSync(path.join(projectionsRoot, `${window.windowId}.json`)),
      false,
      `projection of ${window.windowId} survived the pod close`,
    );
  }
  for (const window of finalConfig.topology.windows) {
    equal(existsSync(path.join(projectionsRoot, `${window.windowId}.json`)), true);
  }
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

test("跨宿主关闭：Claude 登记的 Controller 绑定阻塞 Codex 的 close-complete，退役后两宿主的投影与回执一并清理（W7）", {
  timeout: 180_000,
}, async (t) => {
  const fx = await fixture(t);
  await initializeClaudeHost(fx);
  const intent = { kind: "create", name: "cross-host", idempotencyKey: "pod-x" };
  const created = await pod(fx, {
    mode: "apply",
    intent,
    planDigest: ((await pod(fx, { mode: "preview", intent })) as { readonly planDigest: string })
      .planDigest,
  });
  if (created.kind !== "WakeflowPodMutation" || created.pod === null)
    throw new Error("Expected pod.");
  const podId = created.pod.podId;
  const controller = created.windows.find((window) => window.role === "controller");
  const product = created.windows.find((window) => window.role === "product");
  if (!controller || !product) throw new Error("Expected controller and product windows.");
  const productIntent = await inspect(fx, product.windowId);
  const repositoryId = productIntent.launchIntent.worktree?.repositoryId;
  if (repositoryId === undefined) throw new Error("Expected a worktree intent.");

  // 产品窗口在 Codex 登记（带 worktree 回执），Controller 在 Claude 登记：同一个 pod 跨两个宿主。
  const checkout = path.join(fx.root, ".wakeflow-test-worktrees", "wt-cross-host");
  git(fx.product, "worktree", "add", "--quiet", checkout, "-b", "wakeflow-cross-host");
  const productRegistered = await register(
    fx,
    product.windowId,
    "codex-host-owned-thread:cross-host-product",
    checkout,
    {
      porcelain: git(checkout, "worktree", "list", "--porcelain"),
      commonDir: git(checkout, "rev-parse", "--git-common-dir").trim(),
    },
  );
  const controllerRegistered = await registerOnClaude(
    fx,
    controller.windowId,
    "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    fx.root,
  );
  const claudeControllerProjection = projectionFile(fx, "claude-code", controller.windowId);
  equal(existsSync(claudeControllerProjection), true, "Claude registration published a projection");
  // Codex 的 pod 视图看到对端的绑定：Controller 已绑定，design 与 test 未绑定即 creating。
  const observed = await pod(fx, { mode: "recover", podId });
  if (observed.kind !== "WakeflowPodMutation") throw new Error("Expected mutation.");
  equal(observed.disposition, "healthy");
  equal(observed.pod?.state, "creating");
  deepEqual(
    observed.windows.filter((window) => window.bound).map((window) => window.windowId),
    [controller.windowId, product.windowId],
  );

  const branches = [{ repositoryId, disposition: "abandoned" }];
  const closeRequest = await pod(fx, {
    mode: "preview",
    intent: { kind: "close", podId, branches },
  });
  if (closeRequest.kind !== "WakeflowPodPreview" || closeRequest.plan === null) {
    throw new Error("Expected a ready close preview.");
  }
  const closing = await pod(fx, {
    mode: "apply",
    intent: { kind: "close", podId, branches },
    planDigest: closeRequest.planDigest,
  });
  if (closing.kind !== "WakeflowPodMutation") throw new Error("Expected mutation.");
  equal(closing.pod?.state, "closing");
  equal(closing.next.frontier, "pod-window-decommission");
  deepEqual(closing.next.blockers, [
    `window-bound:${controller.windowId}`,
    `window-bound:${product.windowId}`,
  ]);

  // 本宿主的窗口已退役、检出已移除：只剩 Claude 握着的 Controller 绑定，它必须阻塞 close-complete
  // （此前 Codex 看不到它，pod 会被删出配置，留下无工具可退的孤儿绑定）。
  if (productRegistered.binding === null) throw new Error("Expected binding.");
  await decommission(fx, product.windowId, productRegistered.binding);
  git(fx.product, "worktree", "remove", "--force", checkout);
  const blockedByClaude = await pod(fx, {
    mode: "preview",
    intent: { kind: "close", podId, branches: [] },
  });
  if (blockedByClaude.kind !== "WakeflowPodPreview") throw new Error("Expected preview.");
  equal(blockedByClaude.status, "blocked");
  deepEqual(blockedByClaude.blockers, [`window-bound:${controller.windowId}`]);
  const routed = await pod(fx, { mode: "recover", podId });
  if (routed.kind !== "WakeflowPodMutation") throw new Error("Expected mutation.");
  equal(routed.pod?.state, "closing");
  equal(routed.next.frontier, "pod-window-decommission");
  deepEqual(routed.next.blockers, [`window-bound:${controller.windowId}`]);
  // 对账顺带退休了与已退役绑定不同代、检出已不在的 Codex 回执（既有规则）；关闭完成时只剩目录要清。
  equal(routed.disposition, "retired");
  equal(routed.retiredReceipts, 1);
  equal(readConfig(fx).pods.length, 2, "the pod must still be in the config");

  // 从 Claude 退役 Controller 后关闭完成：两宿主的 pod 窗口投影与 Codex 的回执目录都被清理，
  // primary pod 的投影在两宿主都仍在。
  if (controllerRegistered.binding === null) throw new Error("Expected Claude binding.");
  await decommissionOnClaude(fx, controller.windowId, controllerRegistered.binding);
  equal(existsSync(claudeControllerProjection), true, "decommission republishes the projection");
  const completePreview = await pod(fx, {
    mode: "preview",
    intent: { kind: "close", podId, branches: [] },
  });
  if (completePreview.kind !== "WakeflowPodPreview" || completePreview.plan === null) {
    throw new Error("Expected a ready close-complete preview.");
  }
  equal(completePreview.plan.kind, "close-complete");
  const closed = await pod(fx, {
    mode: "apply",
    intent: { kind: "close", podId, branches: [] },
    planDigest: completePreview.planDigest,
  });
  if (closed.kind !== "WakeflowPodMutation") throw new Error("Expected mutation.");
  equal(closed.disposition, "closed");
  equal(closed.retiredReceipts, 0);
  const finalConfig = readConfig(fx);
  equal(finalConfig.pods.length, 1);
  for (const hostId of ["codex", "claude-code"] as const) {
    for (const window of created.windows) {
      equal(
        existsSync(projectionFile(fx, hostId, window.windowId)),
        false,
        `${hostId} projection of ${window.windowId} survived the pod close`,
      );
    }
    for (const window of finalConfig.topology.windows) {
      equal(existsSync(projectionFile(fx, hostId, window.windowId)), true);
    }
    equal(
      existsSync(path.join(fx.root, ".wakeflow-local/runtime/hosts", hostId, "pods", podId)),
      false,
      `${hostId} receipt directory survived the pod close`,
    );
  }
});
