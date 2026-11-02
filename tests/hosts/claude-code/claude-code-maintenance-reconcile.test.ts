import { deepEqual, equal, notEqual } from "node:assert/strict";
import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { executeClaudeCodeWakeflowMaintenance } from "../../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  CLAUDE_CODE_TMUX_ASSET_CONTENT,
  CLAUDE_CODE_TMUX_ASSET_DIGEST,
  CLAUDE_CODE_TMUX_ASSET_REF,
} from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
import { CLAUDE_CODE_TMUX_ASSET_OPERATION_ID } from "../../../src/hosts/claude-code/claude-code-tmux-asset-operation.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { runGit } from "../../support/git-fixture.js";
import { disposableRoot } from "../../support/temp-root.js";

useDisposableDurability();

/**
 * 2 级（能力）：插件更新后的 reconcile 重写过期的 tmux 助手副本与陈旧的看板索引（open-items W38，gate-log
 * §13.218 L16 准备）。在一次性 Git 工作区上经 Claude 组合根 fresh-initialize（tmux 传输），把助手副本换成
 * 旧字节、看板索引换成 v1 渲染：一次 preview + apply 就把两者都重写。L16 里"第一次 apply 报 completed 却
 * 什么都没改"不是丢步：那个工作区的私有模式同时有安全漂移，第一份计划是 `WakeflowPrivateModeConvergencePlan`
 * （只收回模式，next 指回再预览），第二份才是带 tmux-asset 操作的物化计划——这里把两段的顺序与各自的效果钉住。
 */

const BOARD_INDEX = [".wakeflow-active", "current", "board", "index.md"] as const;

function selection() {
  const value = createMinimalWakeflowFreshConfigSelection();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return value;
}

/** tmux 传输的工作区；返回根与助手副本、看板索引的绝对路径。 */
async function initialized(t: TestContext) {
  const root = disposableRoot(t, "wakeflow-claude-reconcile-");
  runGit(root, "init", "--quiet");
  const fresh = { root, action: "fresh-initialize", request: { selection: selection() } } as const;
  const preview = await executeClaudeCodeWakeflowMaintenance({ ...fresh, mode: "preview" });
  const applied = await executeClaudeCodeWakeflowMaintenance({
    ...fresh,
    mode: "apply",
    planDigest: preview.planDigest as string,
  });
  equal(applied.status, "completed");
  return Object.freeze({
    root,
    asset: path.join(root, ...CLAUDE_CODE_TMUX_ASSET_REF.split("/")),
    index: path.join(root, ...BOARD_INDEX),
  });
}

/** 上一版制品留下的状态：助手副本是旧字节（模式仍是 0600），看板索引是 v1 渲染。 */
function outdate(asset: string, index: string): Readonly<{ assetDigest: string; index: string }> {
  writeFileSync(asset, `${CLAUDE_CODE_TMUX_ASSET_CONTENT}\n// previous artifact\n`);
  chmodSync(asset, 0o600);
  const current = readFileSync(index, "utf8");
  writeFileSync(index, current.replace("board-projection:v2", "board-projection:v1"));
  return Object.freeze({ assetDigest: computeSha256Digest(readFileSync(asset)), index: current });
}

function reconcile(root: string, planDigest?: string) {
  return executeClaudeCodeWakeflowMaintenance({
    root,
    action: "reconcile",
    request: {},
    ...(planDigest === undefined ? { mode: "preview" } : { mode: "apply", planDigest }),
  });
}

function hostOperationIds(plan: unknown): readonly string[] {
  const contribution = (plan as { hostContribution?: { operations: { operationId: string }[] } })
    .hostContribution;
  return (contribution?.operations ?? []).map((entry) => entry.operationId);
}

test("an outdated tmux helper copy and a stale board index are both rewritten by one reconcile preview and apply", async (t) => {
  const { root, asset, index } = await initialized(t);
  const before = outdate(asset, index);
  notEqual(before.assetDigest, CLAUDE_CODE_TMUX_ASSET_DIGEST);

  const preview = await reconcile(root);
  equal(preview.status, "ready");
  deepEqual(hostOperationIds(preview.plan), [CLAUDE_CODE_TMUX_ASSET_OPERATION_ID]);
  equal(computeSha256Digest(readFileSync(asset)), before.assetDigest, "preview writes nothing");

  const applied = await reconcile(root, preview.planDigest as string);
  equal(applied.status, "completed");
  deepEqual(
    (applied.stepReceipts as unknown as readonly { stepId: string; disposition: string }[]).map(
      (entry) => [entry.stepId, entry.disposition],
    ),
    [[`host-effect:${CLAUDE_CODE_TMUX_ASSET_OPERATION_ID}`, "updated"]],
  );
  equal(computeSha256Digest(readFileSync(asset)), CLAUDE_CODE_TMUX_ASSET_DIGEST);
  equal(statSync(asset).mode & 0o777, 0o600);
  equal(readFileSync(index, "utf8"), before.index);

  const again = await reconcile(root);
  deepEqual(hostOperationIds(again.plan), []);
});

test("with private modes drifted as well, the first reconcile converges only the modes and points back to a fresh preview; the second rewrites the helper and the index (W38)", async (t) => {
  const { root, asset, index } = await initialized(t);
  const before = outdate(asset, index);
  // 私有运行时目录被放宽成 0755：安全漂移，reconcile 的第一份计划是模式收敛（§13.130 D8）。
  const runtime = path.join(root, ".wakeflow-local", "runtime");
  chmodSync(runtime, 0o755);

  const modes = await reconcile(root);
  equal(modes.status, "ready");
  equal((modes.plan as { kind: string }).kind, "WakeflowPrivateModeConvergencePlan");
  deepEqual(hostOperationIds(modes.plan), []);
  const converged = await reconcile(root, modes.planDigest as string);
  equal(converged.status, "completed");
  deepEqual(
    (converged.stepReceipts as unknown as readonly { kind: string }[]).map((entry) => entry.kind),
    ["WakeflowPrivateModeConvergenceReceipt"],
  );
  deepEqual(
    [converged.next.frontier, converged.next.suggestedTool],
    ["workspace-maintenance", "wakeflow_maintain_workspace"],
  );
  equal(statSync(runtime).mode & 0o777, 0o700);
  // 这一段只收回模式：助手副本与看板索引留给下一份计划，与 L16 第一次 apply 的观察一致。
  equal(computeSha256Digest(readFileSync(asset)), before.assetDigest);
  equal(readFileSync(index, "utf8").includes("board-projection:v1"), true);

  const materialization = await reconcile(root);
  equal(materialization.status, "ready");
  notEqual(materialization.planDigest, modes.planDigest);
  deepEqual(hostOperationIds(materialization.plan), [CLAUDE_CODE_TMUX_ASSET_OPERATION_ID]);
  const applied = await reconcile(root, materialization.planDigest as string);
  equal(applied.status, "completed");
  equal(computeSha256Digest(readFileSync(asset)), CLAUDE_CODE_TMUX_ASSET_DIGEST);
  equal(readFileSync(index, "utf8"), before.index);
  deepEqual(hostOperationIds((await reconcile(root)).plan), []);
});
