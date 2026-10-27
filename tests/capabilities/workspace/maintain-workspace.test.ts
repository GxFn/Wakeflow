import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { executeWakeflowMaintenancePublicRequest } from "../../../src/capabilities/workspace/maintain-workspace.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  executeCodexMaintenanceExecution,
  previewCodexMaintenanceExecution,
  recoverCodexMaintenanceExecution,
} from "../../../src/hosts/codex/codex-maintenance-execution.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import type { WakeflowMaintenancePublicHostFacade } from "../../../src/workspace/maintenance/wakeflow-maintenance-public-host-facade.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 效果型切片的 given-when-then：preview 零写并给出摘要；apply 重算计划，摘要漂移拒绝，
 * 相符执行；已初始化后旧摘要不再可用；reconcile 为 no-op；缺摘要与私有路径在边界拒绝；
 * 过期进程（有会话在更高版本的制品下启动过）的 preview 与 apply 被阻塞（1.2 计划 §3.6 C6）。
 */

async function fixture(t: TestContext): Promise<string> {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-maintain-slice-")),
  );
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: absolutePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize fixture Git.");
  t.after(() => rmSync(absolutePath, { recursive: true, force: true }));
  return absolutePath;
}

function selection() {
  const value = createMinimalWakeflowFreshConfigSelection();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return value;
}

function wakeflowFailure(code: string, reason: string, path?: string): (error: unknown) => boolean {
  return (error: unknown) =>
    isWakeflowError(error) &&
    error.code === code &&
    error.reason === reason &&
    (path === undefined || error.path === path);
}

test("maintain_workspace preview 零写给出摘要，apply 重算比对，漂移拒绝，reconcile no-op", async (t) => {
  const root = await fixture(t);
  const before = readdirSync(root).sort();
  const fresh = { root, action: "fresh-initialize", request: { selection: selection() } } as const;

  const preview = await executeCodexWakeflowMaintenance({ ...fresh, mode: "preview" });
  equal(preview.mode, "preview");
  equal(preview.status, "ready");
  equal(typeof preview.planDigest, "string");
  equal(preview.plan !== null, true);
  equal(preview.launchIntents.length, 4);
  deepEqual(
    { ...preview.next },
    {
      frontier: "workspace-maintenance-apply",
      owner: "user",
      suggestedTool: "wakeflow_maintain_workspace",
      blockers: [],
    },
  );
  deepEqual(readdirSync(root).sort(), before, "preview must not write");
  equal(JSON.stringify(preview).includes(root), false);
  const planDigest = preview.planDigest as string;

  await rejects(
    executeCodexWakeflowMaintenance({
      ...fresh,
      mode: "apply",
      planDigest: `sha256:${"0".repeat(64)}`,
    }),
    wakeflowFailure("precondition-failed", "plan-drift", "$request.planDigest"),
  );
  deepEqual(readdirSync(root).sort(), before, "rejected apply must not write");

  const applied = await executeCodexWakeflowMaintenance({ ...fresh, mode: "apply", planDigest });
  equal(applied.mode, "apply");
  equal(applied.status, "completed");
  equal(applied.planDigest, planDigest);
  equal(applied.next.frontier, "window-launch");
  equal(applied.next.owner, "user");
  equal(applied.next.suggestedTool, "wakeflow_register_window_binding");
  equal(existsSync(path.join(root, "wakeflow.config.json")), true);
  equal(JSON.stringify(applied).includes(root), false);

  // 初始化完成后，同一摘要不再对应当前工作区上重算的计划。
  await rejects(
    executeCodexWakeflowMaintenance({ ...fresh, mode: "apply", planDigest }),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "precondition-failed" &&
      (error.reason === "plan-drift" || error.reason === "plan-blocked"),
  );

  const reconcile = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  equal(reconcile.status, "ready");
  equal(reconcile.launchIntents.length, 0);
  const reconciled = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: reconcile.planDigest as string,
  });
  equal(reconciled.status, "no-op");
  equal(reconciled.operationId, null);
  deepEqual(
    { ...reconciled.next },
    { frontier: null, owner: "none", suggestedTool: null, blockers: [] },
  );
});

test("maintain_workspace 在边界拒绝缺摘要的 apply、未知模式与含私有路径的请求", async (t) => {
  const root = await fixture(t);
  await rejects(
    executeCodexWakeflowMaintenance({ root, action: "reconcile", mode: "apply", request: {} }),
    wakeflowFailure("invalid-request", "schema"),
  );
  await rejects(
    executeCodexWakeflowMaintenance({ root, mode: "recover", operationId: "not-an-operation" }),
    wakeflowFailure("invalid-request", "schema"),
  );
  await rejects(
    executeCodexWakeflowMaintenance({
      root,
      action: "reconfigure",
      mode: "preview",
      request: { desiredConfig: { note: `${root}/wakeflow.config.json` } },
    }),
    wakeflowFailure("privacy-violation", "private-value"),
  );
  await rejects(
    executeCodexWakeflowMaintenance({
      root: path.join(root, "missing"),
      action: "reconcile",
      mode: "preview",
      request: {},
    }),
    (error: unknown) => isWakeflowError(error) && error.code === "root-invalid",
  );
  deepEqual(readdirSync(root).sort(), [".git"]);
});

test("maintain_workspace 拒绝包含已装载制品、位于制品之内或配置根与制品重叠的工作区（§13.124）", async (t) => {
  const root = await fixture(t);
  const facadeWith = (artifactRoot: string | null) =>
    Object.freeze({
      hostId: "codex" as const,
      artifactRoot,
      currentHostProfile: codexWorkspaceHostResourceProfile,
      hostProfiles: Object.freeze([
        codexWorkspaceHostResourceProfile,
        claudeCodeWorkspaceHostResourceProfile,
      ]),
      preview: previewCodexMaintenanceExecution,
      apply: executeCodexMaintenanceExecution,
      recover: recoverCodexMaintenanceExecution,
    });
  const fresh = {
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selection() },
  } as const;
  const blockersOf = (result: unknown) =>
    result as { readonly status: string; readonly next: { readonly blockers: readonly string[] } };

  // 工作区根包含制品：把插件仓库当工作区的经典错误。
  const inside = path.join(root, "plugins", "codex-wakeflow");
  mkdirSync(inside, { recursive: true });
  const contained = blockersOf(
    await executeWakeflowMaintenancePublicRequest(facadeWith(inside), fresh),
  );
  equal(contained.status, "blocked");
  deepEqual(contained.next.blockers, ["workspace-root-overlaps-artifact"]);
  rmSync(path.join(root, "plugins"), { recursive: true, force: true });
  // 工作区位于制品之内。
  const parent = blockersOf(
    await executeWakeflowMaintenancePublicRequest(facadeWith(path.dirname(root)), fresh),
  );
  equal(parent.status, "blocked");
  // 上级目录同时包含 ../ProductA 与 Ledger 等配置根，所以两条阻塞都在。
  deepEqual(parent.next.blockers, [
    "workspace-root-overlaps-artifact",
    "configured-root-overlaps-artifact",
  ]);
  // 配置根与制品重叠：制品就是待配置的 ledger 根目录。
  const overlapping = blockersOf(
    await executeWakeflowMaintenancePublicRequest(facadeWith(path.join(root, "Ledger")), fresh),
  );
  equal(overlapping.status, "blocked");
  deepEqual(overlapping.next.blockers, [
    "workspace-root-overlaps-artifact",
    "configured-root-overlaps-artifact",
  ]);
  // 无关的制品根与未知制品根都不阻塞；reconcile 只查工作区根。
  const unrelated = path.join(realpathSync(os.tmpdir()), "wakeflow-unrelated-artifact-root");
  equal(
    blockersOf(await executeWakeflowMaintenancePublicRequest(facadeWith(unrelated), fresh)).status,
    "ready",
  );
  equal(
    blockersOf(await executeWakeflowMaintenancePublicRequest(facadeWith(null), fresh)).status,
    "ready",
  );
  const reconcile = { root, action: "reconcile", mode: "preview", request: {} } as const;
  const reconcileBlocked = blockersOf(
    await executeWakeflowMaintenancePublicRequest(facadeWith(path.dirname(root)), reconcile),
  );
  equal(reconcileBlocked.status, "blocked");
  deepEqual(reconcileBlocked.next.blockers, ["workspace-root-overlaps-artifact"]);
});

test("maintain_workspace 的过期进程守卫（§3.6 C6）：任一宿主的会话曾在更高版本的制品下启动，preview 以 runtime-artifact-outdated:<版本> 阻塞、apply 以 plan-blocked 拒绝；同一会话更晚的启动记录决定版本；相同或更低的版本、未知制品根与没有版本的 manifest 都不阻塞", async (t) => {
  const root = await fixture(t);
  const fresh = { root, action: "fresh-initialize", request: { selection: selection() } } as const;
  const preview = await executeCodexWakeflowMaintenance({ ...fresh, mode: "preview" });
  await executeCodexWakeflowMaintenance({
    ...fresh,
    mode: "apply",
    planDigest: preview.planDigest as string,
  });
  const artifactRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-artifact-")));
  t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));
  const manifest = path.join(artifactRoot, "artifact-manifest.json");
  writeFileSync(
    manifest,
    JSON.stringify({ kind: "WakeflowPluginArtifactManifest", version: "1.2.0" }),
  );
  const facadeWith = (artifact: string | null) =>
    Object.freeze({
      hostId: "codex" as const,
      artifactRoot: artifact,
      currentHostProfile: codexWorkspaceHostResourceProfile,
      hostProfiles: Object.freeze([
        codexWorkspaceHostResourceProfile,
        claudeCodeWorkspaceHostResourceProfile,
      ]),
      preview: previewCodexMaintenanceExecution,
      apply: executeCodexMaintenanceExecution,
      recover: recoverCodexMaintenanceExecution,
    });
  const reconcile = { root, action: "reconcile", mode: "preview", request: {} } as const;
  const previewWith = async (artifact: string | null) =>
    (await executeWakeflowMaintenancePublicRequest(facadeWith(artifact), reconcile)) as {
      readonly status: string;
      readonly planDigest: string | null;
      readonly next: { readonly blockers: readonly string[] };
    };
  const startRecord = async (
    hostId: "codex" | "claude-code",
    sessionId: string,
    recordedAt: string,
    artifactVersion: string | null,
  ) => {
    const rooted = await RootedDirectory.open(root);
    try {
      await writeHostHookObservation(rooted, {
        hostId,
        event: "session-start",
        sessionId,
        cwd: root,
        recordedAt: parseUtcInstant(recordedAt),
        artifactVersion,
      });
    } finally {
      await rooted.close();
    }
  };

  // 没有任何启动记录：不阻塞。
  equal((await previewWith(artifactRoot)).status, "ready");
  // 对端宿主（claude-code）的会话在 1.3.0 下启动过：本进程（1.2.0）的 preview 阻塞，apply 同样被挡。
  await startRecord("claude-code", "peer-session", "2026-10-26T09:00:00.000Z", "1.3.0");
  const blocked = await previewWith(artifactRoot);
  equal(blocked.status, "blocked");
  deepEqual(blocked.next.blockers, ["runtime-artifact-outdated:1.3.0"]);
  await rejects(
    executeWakeflowMaintenancePublicRequest(facadeWith(artifactRoot), {
      ...reconcile,
      mode: "apply",
      planDigest: `sha256:${"0".repeat(64)}`,
    }),
    wakeflowFailure("precondition-failed", "plan-blocked", "$request.planDigest"),
  );
  // 同一会话更晚的启动记录回到 1.2.0（窗口在当前版本下重启）：最新的启动记录决定，不再阻塞。
  await startRecord("claude-code", "peer-session", "2026-10-26T09:05:00.000Z", "1.2.0");
  equal((await previewWith(artifactRoot)).status, "ready");
  // 更低的版本与没有版本的旧记录都不阻塞；更高的版本在哪个宿主都阻塞。
  await startRecord("codex", "older-session", "2026-10-26T09:06:00.000Z", "1.1.0");
  await startRecord("codex", "legacy-session", "2026-10-26T09:07:00.000Z", null);
  equal((await previewWith(artifactRoot)).status, "ready");
  await startRecord("codex", "newer-session", "2026-10-26T09:08:00.000Z", "1.10.0");
  deepEqual((await previewWith(artifactRoot)).next.blockers, ["runtime-artifact-outdated:1.10.0"]);
  // 制品根未知、manifest 读不出或没有版本：不知道不阻塞（同路径覆盖由入口的 assertUnchanged 守）。
  equal((await previewWith(null)).status, "ready");
  equal(
    (await previewWith(path.join(realpathSync(os.tmpdir()), "wakeflow-missing-artifact-root")))
      .status,
    "ready",
  );
  writeFileSync(manifest, JSON.stringify({ kind: "WakeflowPluginArtifactManifest" }));
  equal((await previewWith(artifactRoot)).status, "ready");
});

test("maintain_workspace 把执行上下文带来的写者戳交给宿主 facade 的 apply 与 recover（C11）；preview 零写不碰它，省略即 null", async (t) => {
  const root = await fixture(t);
  const seen: Array<readonly [string, unknown]> = [];
  // 协调器要求 facade 已冻结；先按端口类型写出字面量让 lambda 拿到参数类型，再冻结。
  const recording: WakeflowMaintenancePublicHostFacade = {
    hostId: "codex",
    artifactRoot: null,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: Object.freeze([
      codexWorkspaceHostResourceProfile,
      claudeCodeWorkspaceHostResourceProfile,
    ]),
    preview: previewCodexMaintenanceExecution,
    apply: (workspace, plan, request, options) => {
      seen.push(["apply", options?.writer]);
      return executeCodexMaintenanceExecution(workspace, plan, request, options);
    },
    recover: (workspace, operationId, options) => {
      seen.push(["recover", options?.writer]);
      return recoverCodexMaintenanceExecution(workspace, operationId, options);
    },
  };
  const facade = Object.freeze(recording);
  const writer = Object.freeze({
    version: "1.2.0",
    manifestDigest: parseSha256Digest(`sha256:${"b".repeat(64)}`),
  });
  const fresh = { root, action: "fresh-initialize", request: { selection: selection() } } as const;
  const preview = await executeWakeflowMaintenancePublicRequest(
    facade,
    { ...fresh, mode: "preview" },
    { writer },
  );
  equal(preview.mode, "preview");
  const planDigest = preview.planDigest as string;
  deepEqual(seen, [], "preview never reaches apply or recover");
  const applied = await executeWakeflowMaintenancePublicRequest(
    facade,
    { ...fresh, mode: "apply", planDigest },
    { writer },
  );
  equal(applied.mode, "apply");
  equal(applied.status, "completed");
  deepEqual(seen, [["apply", writer]]);
  // 已完成的操作没有事务可恢复，宿主事务照常拒绝；但戳已经交到了 facade（省略即 null）。
  await rejects(
    executeWakeflowMaintenancePublicRequest(facade, {
      root,
      mode: "recover",
      operationId: applied.operationId,
    }),
    (error: unknown) => isWakeflowError(error),
  );
  deepEqual(seen[1], ["recover", null]);
});
