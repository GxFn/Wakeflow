import { deepEqual, equal, match, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { executeVerifyRequest } from "../../../src/capabilities/observation/service.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";

/**
 * 私有模式的安全漂移由 reconcile 收回（gate-log §13.124 D8，§13.130）：`chmod -R go+rX` 之后，
 * verify 的 local-layout 门按区域点名，其余意图以 `private-mode-drift` 拒绝，reconcile 的 preview
 * 给出收敛计划，apply 把每个节点收回 0700 / 0600，再预览 reconcile 就回到零步骤。别人可写的节点
 * 只报告为 `private-mode-unsafe:<区域>`，整个收敛都不做。
 */

const CLOCK = { clock: () => parseUtcInstant("2026-09-25T12:00:00.000Z") };
const PRIVATE_TREES = [".wakeflow-local", ".wakeflow-active"] as const;
const skipOnWindows = process.platform === "win32" || typeof process.geteuid !== "function";

async function initializedWorkspace(t: TestContext): Promise<string> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-private-mode-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "Workspace");
  mkdirSync(root);
  if (spawnSync("git", ["init", "--quiet"], { cwd: root, shell: false }).status !== 0) {
    throw new Error("git init failed");
  }
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
  return root;
}

/** 私有树里的每个目录与文件（相对路径 → 模式位）。 */
function privateModes(root: string): Map<string, { readonly kind: string; readonly mode: number }> {
  const modes = new Map<string, { readonly kind: string; readonly mode: number }>();
  const walk = (relative: string): void => {
    const stats = lstatSync(path.join(root, relative));
    modes.set(relative, {
      kind: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
      mode: stats.mode & 0o7777,
    });
    if (!stats.isDirectory()) return;
    for (const name of readdirSync(path.join(root, relative))) walk(path.join(relative, name));
  };
  for (const tree of PRIVATE_TREES) walk(tree);
  return modes;
}

/** `chmod -R go+rX`：目录加 group / other 的读与执行，文件加读。 */
function widen(root: string): number {
  let count = 0;
  for (const [relative, entry] of privateModes(root)) {
    const widened = entry.mode | (entry.kind === "directory" ? 0o055 : 0o044);
    if (widened === entry.mode) continue;
    chmodSync(path.join(root, relative), widened);
    count += 1;
  }
  return count;
}

function assertPrivate(root: string): void {
  for (const [relative, entry] of privateModes(root)) {
    equal(entry.mode, entry.kind === "directory" ? 0o700 : 0o600, relative);
  }
}

async function localLayoutCode(root: string): Promise<string | null> {
  const verify = await executeVerifyRequest(CODEX_OBSERVATION_FACADE, { root }, CLOCK);
  const gate = verify.gates.find((entry) => entry.name === "local-layout");
  if (gate === undefined) throw new Error("verify lacks the local-layout gate");
  return gate.status === "pass" ? null : `${gate.status}|${gate.code}`;
}

type MaintenanceResult = Awaited<ReturnType<typeof executeCodexWakeflowMaintenance>>;
type PreviewResult = Extract<MaintenanceResult, { readonly mode: "preview" }>;

function asPreview(result: MaintenanceResult): PreviewResult {
  if (result.mode !== "preview") throw new Error("Expected a preview result.");
  return result;
}

async function previewReconcile(root: string): Promise<PreviewResult> {
  return asPreview(
    await executeCodexWakeflowMaintenance({
      root,
      action: "reconcile",
      mode: "preview",
      request: {},
    }),
  );
}

test("reconcile 把 chmod -R go+rX 之后的私有树收回 0700 / 0600（§13.130 D8）", {
  skip: skipOnWindows,
}, async (t) => {
  const root = await initializedWorkspace(t);
  equal(await localLayoutCode(root), null);
  const widened = widen(root);
  equal(widened > 0, true);

  // verify 按数量与区域点名：整棵树漂移时区域就是两棵树的根（最小覆盖）。
  match(
    (await localLayoutCode(root)) ?? "",
    new RegExp(
      `^fail\\|local:blocked,private-mode-drift-${widened}:\\.wakeflow-active,\\.wakeflow-local(,|$)`,
      "u",
    ),
  );

  // reconfigure 先要 reconcile：以 private-mode-drift 阻塞，零写。
  const config = JSON.parse(
    readFileSync(path.join(root, "wakeflow.config.json"), "utf8"),
  ) as Record<string, unknown>;
  const reconfigure = asPreview(
    await executeCodexWakeflowMaintenance({
      root,
      action: "reconfigure",
      mode: "preview",
      request: { desiredConfig: config },
    }),
  );
  deepEqual(reconfigure.blockerCodes, ["private-mode-drift"]);

  // reconcile 的 preview 是收敛计划；中途再有漂移，旧摘要的 apply 被拒绝。
  const preview = await previewReconcile(root);
  equal(preview.mode, "preview");
  equal(preview.status, "ready");
  const plan = preview.plan as {
    readonly kind: string;
    readonly driftedDirectories: number;
    readonly driftedFiles: number;
    readonly areas: readonly string[];
  };
  equal(plan.kind, "WakeflowPrivateModeConvergencePlan");
  equal(plan.driftedDirectories + plan.driftedFiles, widened);
  equal(plan.areas.length > 0 && plan.areas.length <= 3, true);
  deepEqual(preview.launchIntents, []);
  equal(preview.next.suggestedTool, "wakeflow_maintain_workspace");
  if (preview.planDigest === null) throw new Error("Expected a plan digest.");

  const stray = path.join(root, ".wakeflow-local", "runtime", "stray-note");
  writeFileSync(stray, "x", { mode: 0o644 });
  await rejects(
    executeCodexWakeflowMaintenance({
      root,
      action: "reconcile",
      mode: "apply",
      request: {},
      planDigest: preview.planDigest,
    }),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "precondition-failed" &&
      error.reason === "plan-drift" &&
      error.path === "$request.planDigest",
  );
  rmSync(stray);

  const applied = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: preview.planDigest,
  });
  equal(applied.mode, "apply");
  equal(applied.status, "completed");
  if (applied.mode !== "apply") throw new Error("Expected an apply result.");
  equal(applied.operationId, null);
  deepEqual(
    applied.stepReceipts.map((receipt) => ({ ...receipt })),
    [{ kind: "WakeflowPrivateModeConvergenceReceipt", converged: widened, current: 0, changed: 0 }],
  );
  deepEqual(
    { ...applied.next, blockers: [...applied.next.blockers] },
    {
      frontier: "workspace-maintenance",
      owner: "controller",
      suggestedTool: "wakeflow_maintain_workspace",
      blockers: [],
    },
  );
  assertPrivate(root);

  // 收回之后 reconcile 回到普通预览：就绪、零步骤；verify 的 local-layout 门通过。
  const after = await previewReconcile(root);
  equal(after.status, "ready");
  equal(
    (after.plan as { readonly kind?: string } | null)?.kind,
    "WakeflowMaintenanceExecutionPlan",
  );
  equal((after.plan as { readonly steps?: readonly unknown[] } | null)?.steps?.length ?? 0, 0);
  equal(await localLayoutCode(root), null);
});

test("别人可写的私有节点只报告为 private-mode-unsafe，整个收敛都不做（§13.130 D8）", {
  skip: skipOnWindows,
}, async (t) => {
  const root = await initializedWorkspace(t);
  const runtime = path.join(root, ".wakeflow-local", "runtime");
  const board = path.join(root, ".wakeflow-active", "current", "board");
  chmodSync(runtime, 0o777);
  chmodSync(board, 0o755);

  const preview = await previewReconcile(root);
  equal(preview.status, "blocked");
  equal(preview.plan, null);
  deepEqual(preview.blockerCodes, ["private-mode-unsafe:.wakeflow-local/runtime"]);
  deepEqual(preview.next.blockers, ["private-mode-unsafe:.wakeflow-local/runtime"]);
  equal(lstatSync(runtime).mode & 0o777, 0o777);
  equal(lstatSync(board).mode & 0o777, 0o755);
  equal(
    await localLayoutCode(root),
    "fail|local:blocked,private-mode-unsafe-1:.wakeflow-local/runtime",
  );

  // 用户自己收回不安全节点之后，剩下的安全漂移照常由 reconcile 收回。
  chmodSync(runtime, 0o700);
  const convergence = await previewReconcile(root);
  equal(
    (convergence.plan as { readonly kind?: string } | null)?.kind,
    "WakeflowPrivateModeConvergencePlan",
  );
  if (convergence.planDigest === null) throw new Error("Expected a plan digest.");
  await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: convergence.planDigest,
  });
  assertPrivate(root);
});
