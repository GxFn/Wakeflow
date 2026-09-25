import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { executeWakeflowMaintenancePublicRequest } from "../../../src/capabilities/workspace/maintain-workspace.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  executeCodexMaintenanceExecution,
  previewCodexMaintenanceExecution,
  recoverCodexMaintenanceExecution,
} from "../../../src/hosts/codex/codex-maintenance-execution.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";

/**
 * 效果型切片的 given-when-then：preview 零写并给出摘要；apply 重算计划，摘要漂移拒绝，
 * 相符执行；已初始化后旧摘要不再可用；reconcile 为 no-op；缺摘要与私有路径在边界拒绝。
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
