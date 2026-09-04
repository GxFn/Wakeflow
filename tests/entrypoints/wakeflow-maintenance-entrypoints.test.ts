import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { compileWakeflowFreshConfigSelection } from "../../src/configuration/wakeflow-fresh-config-selection.js";
import { executeClaudeCodeWakeflowMaintenance } from "../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { executeCodexWakeflowMaintenance } from "../../src/entrypoints/codex-wakeflow-maintenance.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { WINDOW_WORK_CLAIMS_ROOT_REF } from "../../src/governance/delivery/window-work-claim-resource-catalog.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { isWakeflowError } from "../../src/kernel/error.js";
import { createWakeflowMaintenanceExecutionIntent } from "../../src/workspace/maintenance/wakeflow-maintenance-execution-intent.js";
import { publishWakeflowMaintenanceExecutionIntent } from "../../src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.js";
import { parseWakeflowMaintenanceExecutionPlan } from "../../src/workspace/maintenance/wakeflow-maintenance-execution-plan.js";
import { withWakeflowMaintenanceGate } from "../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import { parseWakeflowMaintenanceOperationId } from "../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
import { createMinimalWakeflowFreshConfigSelection } from "../configuration/wakeflow-fresh-config-selection.fixture.js";

async function fixture(t: TestContext, label: string) {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), `wakeflow-public-${label}-`)),
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

const RECOVERY_OPERATION_ID = parseWakeflowMaintenanceOperationId(
  "maintenance_operation_11111111-1111-4111-8111-111111111111",
);

test("Codex public entrypoint completes Fresh preview/apply and a no-op reconcile", async (t) => {
  const root = await fixture(t, "codex");
  const before = readdirSync(root).sort();
  // apply 必须重发同一请求：同一 selection 才能重算出同一计划摘要。
  const selected = selection();
  const preview = await executeCodexWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selected },
  });

  equal(preview.mode, "preview");
  equal(preview.hostId, "codex");
  equal(preview.status, "ready");
  equal(preview.plan !== null, true);
  equal(preview.launchIntents.length, 4);
  equal(preview.next.frontier, "workspace-maintenance-apply");
  equal(preview.next.owner, "user");
  equal(JSON.stringify(preview).includes(root), false);
  deepEqual(readdirSync(root).sort(), before);
  if (preview.planDigest === null) {
    throw new Error("Expected a ready public plan digest.");
  }

  const applied = await executeCodexWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "apply",
    request: { selection: selected },
    planDigest: preview.planDigest,
  });
  equal(applied.mode, "apply");
  equal(applied.action, "fresh-initialize");
  equal(applied.status, "completed");
  equal(applied.planDigest, preview.planDigest);
  equal(applied.launchIntents.length, 4);
  equal(applied.next.frontier, "window-launch");
  equal(applied.next.suggestedTool, "wakeflow_register_window_binding");
  equal(existsSync(path.join(root, "wakeflow.config.json")), true);
  const claimRoot = path.join(root, ...WINDOW_WORK_CLAIMS_ROOT_REF.split("/"));
  equal(existsSync(claimRoot), true);
  equal(statSync(claimRoot).mode & 0o777, 0o700);
  equal(JSON.stringify(applied).includes(root), false);

  const reconcile = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  equal(reconcile.mode, "preview");
  equal(reconcile.status, "ready");
  equal(reconcile.launchIntents.length, 0);
  if (reconcile.planDigest === null) {
    throw new Error("Expected a ready reconcile plan digest.");
  }
  const reconciled = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: reconcile.planDigest,
  });
  equal(reconciled.mode, "apply");
  equal(reconciled.status, "no-op");
  equal(reconciled.operationId, null);
  equal(reconciled.next.frontier, null);
  equal(reconciled.next.owner, "none");
});

test("Claude entrypoint contributes settings and its plan digest is rejected by Codex", async (t) => {
  const root = await fixture(t, "claude");
  const selected = selection();
  const preview = await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selected },
  });
  equal(preview.mode, "preview");
  equal(preview.hostId, "claude-code");
  if (preview.planDigest === null || preview.plan === null) {
    throw new Error("Expected a ready Claude plan.");
  }
  const plan = parseWakeflowMaintenanceExecutionPlan(preview.plan);
  equal(plan.hostContribution?.operations.length, 3);

  let caught: unknown;
  try {
    await executeCodexWakeflowMaintenance({
      root,
      action: "fresh-initialize",
      mode: "apply",
      request: { selection: selected },
      planDigest: preview.planDigest,
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(isWakeflowError(caught), true);
  if (isWakeflowError(caught)) {
    equal(caught.code, "precondition-failed");
    equal(caught.reason, "plan-drift");
    equal(caught.path, "$request.planDigest");
  }
  equal(existsSync(path.join(root, "wakeflow.config.json")), false);
});

test("Public recovery consumes only an operation ID and its private intent", async (t) => {
  const absoluteRoot = await fixture(t, "recover");
  const selected = selection();
  const preview = await executeCodexWakeflowMaintenance({
    root: absoluteRoot,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selected },
  });
  if (preview.mode !== "preview" || preview.plan === null) {
    throw new Error("Expected a ready recovery fixture plan.");
  }
  const executionPlan = parseWakeflowMaintenanceExecutionPlan(preview.plan);
  const desiredConfig = compileWakeflowFreshConfigSelection(selected).config;
  const executionRequest = Object.freeze({
    action: "fresh-initialize" as const,
    desiredConfig,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: Object.freeze([
      codexWorkspaceHostResourceProfile,
      claudeCodeWorkspaceHostResourceProfile,
    ]),
  });
  const rooted = await RootedDirectory.open(absoluteRoot);
  const interrupted = new Error("intent-only test interruption");
  try {
    await withWakeflowMaintenanceGate(
      rooted,
      {
        expectedCoreLayoutInspectionDigest: executionPlan.sharedPreview.coreLayoutInspectionDigest,
        operationId: RECOVERY_OPERATION_ID,
      },
      async (context) => {
        await publishWakeflowMaintenanceExecutionIntent(
          rooted,
          context,
          createWakeflowMaintenanceExecutionIntent(
            context.operationId,
            executionPlan,
            executionRequest,
            desiredConfig,
          ),
        );
        throw interrupted;
      },
    );
  } catch (error: unknown) {
    equal(error, interrupted);
  } finally {
    await rooted.close();
  }

  const recovered = await executeCodexWakeflowMaintenance({
    root: absoluteRoot,
    mode: "recover",
    operationId: RECOVERY_OPERATION_ID,
  });
  equal(recovered.mode, "recover");
  equal(recovered.status, "recovered");
  equal(recovered.operationId, RECOVERY_OPERATION_ID);
  equal(recovered.action, null);
  equal(recovered.next.frontier, null);
  equal(existsSync(path.join(absoluteRoot, "wakeflow.config.json")), true);
  equal(JSON.stringify(recovered).includes(absoluteRoot), false);
});
