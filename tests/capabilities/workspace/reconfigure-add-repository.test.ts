import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  executeStatusRequest,
  executeVerifyRequest,
} from "../../../src/capabilities/observation/service.js";
import { executePodRequest, type PodHostFacade } from "../../../src/capabilities/pod/service.js";
import { executeClaudeCodeWakeflowMaintenance } from "../../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";

/**
 * reconfigure 的"先新增"（gate-log §13.124 D9，§13.130）：往运行中的工作区加一个产品仓库，连同它在
 * primary pod 的产品窗口，一次维护事务落地——配置、窗口运行投影与托管正文一起收敛，新窗口处于未登记
 * 状态等 Controller 起窗登记。删除与改动已有条目、给已有仓库加窗口、根不在或不是 Git 仓库在 preview
 * 里各自阻塞；新仓库带两个及以上新窗口、根是链接 worktree 或已配置仓库的物理别名也阻塞（§13.130）；
 * 缺配对窗口、有 worktree pod 时只给 primary pod 加窗口，由配置文法先拒绝。都零写。
 */

const CLOCK = { clock: () => parseUtcInstant("2026-09-25T12:00:00.000Z") };
const CODEX_POD: PodHostFacade = {
  hostId: "codex",
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
};
const NEW_REPOSITORY_ID = "repository_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEW_WINDOW_ID = "window_cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type ConfigDocument = Record<string, unknown> & {
  topology: {
    repositories: Record<string, unknown>[];
    supportSurfaces: Record<string, unknown>[];
    windows: Record<string, unknown>[];
  };
  pods: Record<string, unknown>[];
};

function git(cwd: string, ...args: readonly string[]): void {
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
}

interface Fixture {
  readonly base: string;
  readonly root: string;
}

/** 已初始化的工作区与兄弟目录：ProductA 在配置里，ProductB 是还不在配置里的 Git 仓库，另有一个普通目录。 */
async function fixture(
  t: TestContext,
  maintain: typeof executeCodexWakeflowMaintenance = executeCodexWakeflowMaintenance,
): Promise<Fixture> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-reconfigure-add-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "Workspace");
  mkdirSync(root);
  for (const name of ["ProductA", "ProductB"]) {
    const product = path.join(base, name);
    mkdirSync(product);
    git(product, "init", "--quiet");
    git(product, "commit", "--quiet", "--allow-empty", "-m", "init");
  }
  mkdirSync(path.join(base, "PlainDirectory"));
  git(root, "init", "--quiet");
  const selection = createMinimalWakeflowFreshConfigSelection();
  (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const preview = await maintain({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection },
  });
  if (preview.mode !== "preview" || preview.planDigest === null) {
    throw new Error("Expected a ready Fresh plan.");
  }
  await maintain({
    root,
    action: "fresh-initialize",
    mode: "apply",
    request: { selection },
    planDigest: preview.planDigest,
  });
  return Object.freeze({ base, root });
}

function configText(root: string): string {
  return readFileSync(path.join(root, "wakeflow.config.json"), "utf8");
}

function readConfig(root: string): ConfigDocument {
  return JSON.parse(configText(root)) as ConfigDocument;
}

function primaryPodId(config: ConfigDocument): string {
  const primary = config.pods.find((pod) => pod.placement === "primary");
  if (primary === undefined) throw new Error("config lacks the primary pod");
  return String(primary.podId);
}

/** 当前配置加一个仓库与它的 primary pod 产品窗口；`options` 用来造不合规的变体。 */
function withAddedRepository(
  current: ConfigDocument,
  options: {
    readonly path?: string;
    readonly window?: boolean;
    readonly instructionManagement?: string;
  } = {},
): ConfigDocument {
  const desired = structuredClone(current);
  desired.topology.repositories.push({
    repositoryId: NEW_REPOSITORY_ID,
    path: options.path ?? "../ProductB",
    displayName: "Product B",
    instructionManagement: options.instructionManagement ?? "owner-managed",
  });
  if (options.window !== false) {
    desired.topology.windows.push({
      windowId: NEW_WINDOW_ID,
      podId: primaryPodId(current),
      role: "product",
      displayName: "Product B",
      root: { kind: "repository", repositoryId: NEW_REPOSITORY_ID },
    });
  }
  return desired;
}

async function previewReconfigure(
  root: string,
  desiredConfig: ConfigDocument,
  maintain: typeof executeCodexWakeflowMaintenance = executeCodexWakeflowMaintenance,
) {
  const preview = await maintain({
    root,
    action: "reconfigure",
    mode: "preview",
    request: { desiredConfig },
  });
  if (preview.mode !== "preview") throw new Error("Expected a preview.");
  return preview;
}

async function blockersOf(root: string, desiredConfig: ConfigDocument): Promise<readonly string[]> {
  const preview = await previewReconfigure(root, desiredConfig);
  equal(preview.status, "blocked");
  equal(preview.planDigest, null);
  return [...preview.blockerCodes];
}

function refusedByConfigGrammar(error: unknown): boolean {
  return (
    isWakeflowError(error) && error.code === "invalid-request" && error.reason === "desired-config"
  );
}

test("reconfigure 新增产品仓库与它的 primary pod 窗口：preview 零写，apply 一次事务落地，新窗口未登记而投影与门都收敛；之后删除与改动仍被拒绝", {
  timeout: 180_000,
}, async (t) => {
  const { base, root } = await fixture(t);
  const current = readConfig(root);
  const before = readdirSync(root).sort();
  const beforeConfig = configText(root);

  const desired = withAddedRepository(current);
  const preview = await previewReconfigure(root, desired);
  equal(preview.status, "ready", JSON.stringify(preview.blockerCodes));
  equal(typeof preview.planDigest, "string");
  deepEqual(readdirSync(root).sort(), before, "preview must not write");
  equal(configText(root), beforeConfig);
  equal(JSON.stringify(preview).includes(base), false);

  const applied = await executeCodexWakeflowMaintenance({
    root,
    action: "reconfigure",
    mode: "apply",
    request: { desiredConfig: desired },
    planDigest: preview.planDigest as string,
  });
  equal(applied.status, "completed");
  const after = readConfig(root);
  deepEqual(
    after.topology.repositories.map((entry) => entry.repositoryId),
    [...current.topology.repositories.map((entry) => entry.repositoryId), NEW_REPOSITORY_ID],
  );
  equal(
    after.topology.windows.some((entry) => entry.windowId === NEW_WINDOW_ID),
    true,
  );

  // 新窗口在 status 里是未登记的 primary pod 窗口，下一步指向它的登记；投影随事务写好，门全过。
  const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
  const added = status.windows.find((window) => window.windowId === NEW_WINDOW_ID);
  equal(added?.identity, "unregistered");
  equal(added?.projection, "current");
  equal(status.config.repositories, 2);
  equal(
    status.nextActions.some(
      (action) => action.reason === "pod-window-registration" && action.subject === NEW_WINDOW_ID,
    ),
    true,
  );
  const verify = await executeVerifyRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
  deepEqual(
    verify.gates
      .filter((gate) => gate.status !== "pass")
      .map((gate) => `${gate.name}:${gate.code}`),
    [],
  );

  // 事务之后没有漂移：reconcile 的 preview 就绪且零步骤。
  const reconcile = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  equal(reconcile.status, "ready");
  equal((reconcile.plan as { readonly steps?: readonly unknown[] } | null)?.steps?.length ?? 0, 0);

  // 删除仍被拒绝（要先退役窗口）；已有仓库的改动也被拒绝。两者都零写。
  const afterText = configText(root);
  const removed = structuredClone(after);
  removed.topology.repositories = removed.topology.repositories.filter(
    (entry) => entry.repositoryId !== NEW_REPOSITORY_ID,
  );
  removed.topology.windows = removed.topology.windows.filter(
    (entry) => entry.windowId !== NEW_WINDOW_ID,
  );
  const removal = await blockersOf(root, removed);
  equal(removal.includes("reconfigure-repository-removal-unsupported"), true, removal.join(","));
  equal(removal.includes("reconfigure-window-removal-unsupported"), true, removal.join(","));
  const renamed = structuredClone(after);
  const first = renamed.topology.repositories[0];
  if (first === undefined) throw new Error("config lacks a repository");
  first.displayName = "Renamed Product";
  equal(
    (await blockersOf(root, renamed)).includes("reconfigure-repository-change-unsupported"),
    true,
  );
  equal(configText(root), afterText);
});

test("reconfigure 新增仓库的根必须在且是 Git 仓库；给已有仓库加窗口阻塞；缺配对窗口、有 worktree pod 时只给 primary pod 加窗口由配置文法拒绝；都零写", {
  timeout: 180_000,
}, async (t) => {
  const { root } = await fixture(t);
  const current = readConfig(root);
  const beforeConfig = configText(root);

  equal(
    (await blockersOf(root, withAddedRepository(current, { path: "../Missing" }))).includes(
      "reconfigure-repository-root-missing",
    ),
    true,
  );
  equal(
    (await blockersOf(root, withAddedRepository(current, { path: "../PlainDirectory" }))).includes(
      "reconfigure-repository-not-git",
    ),
    true,
  );
  await rejects(
    previewReconfigure(root, withAddedRepository(current, { window: false })),
    refusedByConfigGrammar,
  );
  const extraWindow = structuredClone(current);
  extraWindow.topology.windows.push({
    windowId: NEW_WINDOW_ID,
    podId: primaryPodId(current),
    role: "product",
    displayName: "Second window on Product A",
    root: {
      kind: "repository",
      repositoryId: String(current.topology.repositories[0]?.repositoryId),
    },
  });
  // primary pod 允许一个仓库多个产品窗口（配置文法收它），但 reconfigure 只收新仓库的窗口。
  equal(
    (await blockersOf(root, extraWindow)).includes("reconfigure-window-addition-unsupported"),
    true,
  );
  equal(configText(root), beforeConfig);

  // 有 worktree pod 时：那个 pod 也要为新仓库带产品窗口与 worktree 意图，只给 primary pod 加不成立。
  const intent = { kind: "create", name: "feature-x", idempotencyKey: "pod-1" } as const;
  const podPreview = await executePodRequest(CODEX_POD, { root, mode: "preview", intent }, CLOCK);
  if (podPreview.kind !== "WakeflowPodPreview" || podPreview.planDigest === null) {
    throw new Error("Expected a ready pod preview.");
  }
  await executePodRequest(
    CODEX_POD,
    { root, mode: "apply", intent, planDigest: podPreview.planDigest },
    CLOCK,
  );
  const withPod = readConfig(root);
  const withPodText = configText(root);
  // 拒绝点名文法原因与 pod 条目（§13.130 审查 D9-2），不是笼统的"配置坏了"。
  await rejects(
    previewReconfigure(root, withAddedRepository(withPod)),
    (error: unknown) =>
      refusedByConfigGrammar(error) &&
      isWakeflowError(error) &&
      error.details?.configReason === "topology" &&
      error.path.startsWith("$request.request.desiredConfig/pods/"),
  );
  equal(configText(root), withPodText);
});

const REPOSITORY_BLOCK =
  "<!-- wakeflow:managed-content:v1:begin component=repository-instruction owner=host-instruction-integration";

/** preview 就绪后按 planDigest apply，返回 apply 结果的状态。 */
async function applyReconfigure(
  root: string,
  desiredConfig: ConfigDocument,
  maintain: typeof executeCodexWakeflowMaintenance = executeCodexWakeflowMaintenance,
): Promise<string> {
  const preview = await previewReconfigure(root, desiredConfig, maintain);
  equal(preview.status, "ready", JSON.stringify(preview.blockerCodes));
  const applied = await maintain({
    root,
    action: "reconfigure",
    mode: "apply",
    request: { desiredConfig },
    planDigest: preview.planDigest as string,
  });
  return applied.status;
}

test("reconfigure 新增 managed-block 仓库：apply 把 Wakeflow 托管块写进新仓库的 AGENTS.md，已有窗口投影仍 current（§13.130）", {
  timeout: 180_000,
}, async (t) => {
  const { base, root } = await fixture(t);
  const current = readConfig(root);
  const desired = withAddedRepository(current, { instructionManagement: "managed-block" });
  equal(await applyReconfigure(root, desired), "completed");
  const instruction = readFileSync(path.join(base, "ProductB", "AGENTS.md"), "utf8");
  equal(instruction.includes(REPOSITORY_BLOCK), true);
  equal(instruction.includes("## Wakeflow Repository Instructions"), true);

  const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
  const existing = current.topology.windows.filter((window) => window.role === "product");
  equal(existing.length > 0, true);
  for (const window of existing) {
    const observed = status.windows.find((entry) => entry.windowId === window.windowId);
    equal(observed?.projection, "current", String(window.windowId));
  }
});

test("reconfigure 新增 managed-block 仓库在 Claude Code 宿主：托管块写进新仓库的 CLAUDE.md（§13.130）", {
  timeout: 180_000,
}, async (t) => {
  const maintain = executeClaudeCodeWakeflowMaintenance;
  const { base, root } = await fixture(t, maintain);
  const desired = withAddedRepository(readConfig(root), { instructionManagement: "managed-block" });
  equal(await applyReconfigure(root, desired, maintain), "completed");
  const instruction = readFileSync(path.join(base, "ProductB", "CLAUDE.md"), "utf8");
  equal(instruction.includes(REPOSITORY_BLOCK), true);
});

test("reconfigure 新增仓库恰好带一个新 primary pod 产品窗口：两个阻塞；根是链接 worktree 或已配置仓库的别名也阻塞；都零写（§13.130）", {
  timeout: 180_000,
}, async (t) => {
  const { base, root } = await fixture(t);
  const current = readConfig(root);
  const beforeConfig = configText(root);

  const twoWindows = withAddedRepository(current);
  twoWindows.topology.windows.push({
    windowId: "window_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    podId: primaryPodId(current),
    role: "product",
    displayName: "Product B second",
    root: { kind: "repository", repositoryId: NEW_REPOSITORY_ID },
  });
  const twoWindowBlockers = await blockersOf(root, twoWindows);
  equal(twoWindowBlockers.includes("reconfigure-window-addition-unsupported"), true);

  // ProductA 的链接 worktree：根下的 .git 是指针文件，与 ProductA 共用对象库。
  git(path.join(base, "ProductA"), "worktree", "add", "--quiet", "-b", "side", "../LinkedA");
  const worktree = await blockersOf(root, withAddedRepository(current, { path: "../LinkedA" }));
  equal(worktree.includes("reconfigure-repository-root-worktree"), true, worktree.join(","));

  // ProductA 的符号链接别名：物理身份与已配置仓库相同。
  symlinkSync(path.join(base, "ProductA"), path.join(base, "AliasA"));
  const alias = await blockersOf(root, withAddedRepository(current, { path: "../AliasA" }));
  equal(alias.includes("reconfigure-repository-root-duplicate"), true, alias.join(","));
  for (const codes of [twoWindowBlockers, worktree, alias]) {
    for (const code of codes) equal(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(code), true, code);
  }
  equal(configText(root), beforeConfig);
});
