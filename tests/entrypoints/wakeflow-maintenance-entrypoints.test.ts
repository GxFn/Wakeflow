import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { executeClaudeCodeWakeflowMaintenance } from "../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { executeCodexWakeflowMaintenance } from "../../src/entrypoints/codex-wakeflow-maintenance.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { WINDOW_WORK_CLAIMS_ROOT_REF } from "../../src/governance/delivery/window-work-claim-resource-catalog.js";
import { createWakeflowMaintenanceExecutionIntent } from "../../src/workspace/maintenance/wakeflow-maintenance-execution-intent.js";
import { publishWakeflowMaintenanceExecutionIntent } from "../../src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.js";
import { withWakeflowMaintenanceGate } from "../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import { parseWakeflowMaintenanceOperationId } from "../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
import { WakeflowMaintenancePublicCoordinatorError } from "../../src/workspace/maintenance/wakeflow-maintenance-public-coordinator.js";
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
  if (initialized.status !== 0)
    throw new Error("Cannot initialize fixture Git.");
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
  const preview = await executeCodexWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selection() },
  });

  equal(preview.mode, "preview");
  equal(preview.hostId, "codex");
  equal(preview.status, "ready");
  equal(preview.confirmation !== null, true);
  equal(preview.launchIntents.length, 4);
  equal(JSON.stringify(preview).includes(root), false);
  deepEqual(readdirSync(root).sort(), before);
  if (preview.confirmation === null || preview.confirmationDigest === null) {
    throw new Error("Expected a ready public confirmation.");
  }

  const applied = await executeCodexWakeflowMaintenance({
    root,
    mode: "apply",
    confirmation: preview.confirmation,
    confirmationDigest: preview.confirmationDigest,
  });
  equal(applied.mode, "apply");
  equal(applied.action, "fresh-initialize");
  equal(applied.status, "completed");
  equal(applied.launchIntents.length, 4);
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
  if (
    reconcile.confirmation === null ||
    reconcile.confirmationDigest === null
  ) {
    throw new Error("Expected a ready reconcile confirmation.");
  }
  const reconciled = await executeCodexWakeflowMaintenance({
    root,
    mode: "apply",
    confirmation: reconcile.confirmation,
    confirmationDigest: reconcile.confirmationDigest,
  });
  equal(reconciled.mode, "apply");
  equal(reconciled.status, "no-op");
  equal(reconciled.operationId, null);
});

test("Claude entrypoint contributes settings and its confirmation is rejected by Codex", async (t) => {
  const root = await fixture(t, "claude");
  const preview = await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selection() },
  });
  equal(preview.mode, "preview");
  equal(preview.hostId, "claude-code");
  equal(
    preview.confirmation?.executionPlan.hostContribution?.operations.length,
    3,
  );
  if (preview.confirmation === null || preview.confirmationDigest === null) {
    throw new Error("Expected a ready Claude confirmation.");
  }

  let caught: unknown;
  try {
    await executeCodexWakeflowMaintenance({
      root,
      mode: "apply",
      confirmation: preview.confirmation,
      confirmationDigest: preview.confirmationDigest,
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenancePublicCoordinatorError, true);
  if (caught instanceof WakeflowMaintenancePublicCoordinatorError) {
    equal(caught.reason, "confirmation");
  }
  equal(existsSync(path.join(root, "wakeflow.config.json")), false);
});

test("Public recovery consumes only an operation ID and its private intent", async (t) => {
  const absoluteRoot = await fixture(t, "recover");
  const preview = await executeCodexWakeflowMaintenance({
    root: absoluteRoot,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selection() },
  });
  if (preview.mode !== "preview" || preview.confirmation === null) {
    throw new Error("Expected a ready recovery fixture confirmation.");
  }
  const confirmation = preview.confirmation;
  const rooted = await RootedDirectory.open(absoluteRoot);
  const interrupted = new Error("intent-only test interruption");
  try {
    await withWakeflowMaintenanceGate(
      rooted,
      {
        expectedCoreLayoutInspectionDigest:
          confirmation.executionPlan.sharedPreview.coreLayoutInspectionDigest,
        operationId: RECOVERY_OPERATION_ID,
      },
      async (context) => {
        await publishWakeflowMaintenanceExecutionIntent(
          rooted,
          context,
          createWakeflowMaintenanceExecutionIntent(
            context.operationId,
            confirmation.executionPlan,
            confirmation.executionRequest,
            confirmation.executionRequest.desiredConfig,
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
  equal(existsSync(path.join(absoluteRoot, "wakeflow.config.json")), true);
  equal(JSON.stringify(recovered).includes(absoluteRoot), false);
});
