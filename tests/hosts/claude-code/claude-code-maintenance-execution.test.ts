import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  claudeCodeMaintenanceCapability,
} from "../../../src/hosts/claude-code/claude-code-maintenance-capability.js";
import {
  executeClaudeCodeMaintenanceExecution,
  previewClaudeCodeMaintenanceExecution,
  recoverClaudeCodeMaintenanceExecution,
} from "../../../src/hosts/claude-code/claude-code-maintenance-execution.js";
import {
  WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-transition.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  withWakeflowMaintenanceGate,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import {
  beginWakeflowMaintenanceJournalStep,
  completeWakeflowMaintenanceJournalStep,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal.js";
import {
  checkpointWakeflowMaintenanceJournal,
  publishPreparedWakeflowMaintenanceJournal,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal-store.js";
import {
  WakeflowMaintenanceExecutionPreviewError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-preview.js";
import {
  createWakeflowMaintenanceExecutionIntent,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent.js";
import {
  publishWakeflowMaintenanceExecutionIntent,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.js";
import {
  WakeflowMaintenanceExecutionTransactionError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-transaction.js";
import {
  parseWakeflowMaintenanceOperationId,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
import {
  executeWakeflowStaticMaterializationStep,
} from "../../../src/workspace/maintenance/wakeflow-static-materialization-step-executor.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);
const UUID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = parseWakeflowMaintenanceOperationId(
  `maintenance_operation_${UUID}`,
);

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-claude-maintenance-execution-",
  )));
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: absolutePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize fixture Git.");
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function desiredConfig() {
  const value = createMinimalWakeflowConfigV3();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return parseWakeflowConfigV3(value);
}

function request(config: ReturnType<typeof desiredConfig>) {
  return Object.freeze({
    action: "fresh-initialize" as const,
    desiredConfig: config,
    currentHostProfile: claudeCodeWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
}

function settingsPermission(absoluteRoot: string): readonly string[] {
  const value = JSON.parse(readFileSync(
    path.join(absoluteRoot, ".claude", "settings.json"),
    "utf8",
  )) as { permissions: { allow: string[] } };
  return value.permissions.allow;
}

test("Claude aggregate preview preserves cancellation as an operation outcome", async (t) => {
  const workspace = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await rejects(
    previewClaudeCodeMaintenanceExecution(workspace.root, {
      ...request(desiredConfig()),
      signal: controller.signal,
    }),
    (error: unknown) => (
      error instanceof WakeflowMaintenanceExecutionPreviewError
      && error.reason === "aborted"
    ),
  );
});

test("Claude aggregate transaction publishes three portable settings before Config", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const plan = await previewClaudeCodeMaintenanceExecution(
    workspace.root,
    input,
  );
  equal(plan.status, "ready");
  equal(plan.hostContribution?.operations.length, 3);
  equal(plan.steps.at(-1)?.stepId, "authority:config");
  equal(plan.steps.filter((entry) => (
    entry.boundary === "host-capability"
  )).length, 3);

  const completed = await executeClaudeCodeMaintenanceExecution(
    workspace.root,
    plan,
    input,
    { uuidFactory: () => UUID },
  );
  equal(completed.status, "completed");
  equal(completed.operationId, OPERATION_ID);
  equal(completed.stepReceipts.filter((entry) => (
    entry.boundary === "host-capability"
  )).length, 3);
  for (const root of [workspace.absolutePath, "Design", "Test"].map((entry) => (
    path.isAbsolute(entry) ? entry : path.join(workspace.absolutePath, entry)
  ))) {
    deepEqual(settingsPermission(root), [
      WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
    ]);
    equal(readFileSync(
      path.join(root, ".claude", "settings.json"),
      "utf8",
    ).includes("Bash("), false);
  }
  equal(existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")), true);

  const reconcileInput = Object.freeze({
    action: "reconcile" as const,
    desiredConfig: null,
    currentHostProfile: claudeCodeWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
  const reconcilePlan = await previewClaudeCodeMaintenanceExecution(
    workspace.root,
    reconcileInput,
  );
  equal(reconcilePlan.steps.length, 0);
  const noOp = await executeClaudeCodeMaintenanceExecution(
    workspace.root,
    reconcilePlan,
    reconcileInput,
  );
  equal(noOp.status, "no-op");
  equal(noOp.operationId, null);
});

test("recovery replays only the affected Claude operation from the exact journal", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const plan = await previewClaudeCodeMaintenanceExecution(
    workspace.root,
    input,
  );
  const privateError = new Error("interrupt after first Claude host effect");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest:
          plan.sharedPreview.coreLayoutInspectionDigest,
        operationId: OPERATION_ID,
      },
      async (context) => {
        const intent = createWakeflowMaintenanceExecutionIntent(
          context.operationId,
          plan,
          input,
          desired,
        );
        const intentSource = await publishWakeflowMaintenanceExecutionIntent(
          workspace.root,
          context,
          intent,
        );
        let source = await publishPreparedWakeflowMaintenanceJournal(
          workspace.root,
          context,
          intentSource,
          plan,
        );
        for (const step of plan.steps) {
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            intentSource,
            source,
            beginWakeflowMaintenanceJournalStep(source.journal),
          );
          if (step.boundary === "shared-static") {
            await executeWakeflowStaticMaterializationStep(
              workspace.root,
              context,
              plan.sharedPreview,
              input,
              step.stepId,
              { sourceConfig: null, recoveringAffectedStep: false },
            );
          } else {
            const operation = plan.hostContribution?.operations.find((entry) => (
              entry.operationId === step.operationId
            ));
            if (operation === undefined) {
              throw new Error("Missing host operation.");
            }
            await claudeCodeMaintenanceCapability.executeOperation(
              workspace.root,
              context,
              {
                config: desired,
                profile: claudeCodeWorkspaceHostResourceProfile,
                operation,
                recoveringAffectedOperation: false,
              },
            );
            throw privateError;
          }
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            intentSource,
            source,
            completeWakeflowMaintenanceJournalStep(source.journal),
          );
        }
        throw new Error("Expected a Claude host operation.");
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }
  equal(existsSync(path.join(
    workspace.absolutePath,
    ".claude",
    "settings.json",
  )), true);
  equal(existsSync(path.join(
    workspace.absolutePath,
    "Design",
    ".claude",
    "settings.json",
  )), false);
  equal(existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")), false);

  const recovered = await recoverClaudeCodeMaintenanceExecution(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.status, "recovered");
  equal(recovered.stepReceipts[0]?.boundary, "host-capability");
  equal(recovered.stepReceipts[0]?.disposition, "current");
  equal(recovered.stepReceipts.at(-1)?.stepId, "authority:config");
  equal(existsSync(path.join(
    workspace.absolutePath,
    "Design",
    ".claude",
    "settings.json",
  )), true);
  equal(existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")), true);
});

test("Claude aggregate execution rejects settings drift before acquiring the gate", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const plan = await previewClaudeCodeMaintenanceExecution(
    workspace.root,
    input,
  );
  mkdirSync(path.join(workspace.absolutePath, ".claude"), { mode: 0o755 });
  writeFileSync(
    path.join(workspace.absolutePath, ".claude", "settings.json"),
    "{\n  \"theme\": \"dark\"\n}\n",
    { mode: 0o644 },
  );
  let caught: unknown;
  try {
    await executeClaudeCodeMaintenanceExecution(
      workspace.root,
      plan,
      input,
      { uuidFactory: () => UUID },
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceExecutionTransactionError, true);
  if (caught instanceof WakeflowMaintenanceExecutionTransactionError) {
    equal(caught.reason, "plan-stale");
    equal(caught.operationId, null);
  }
  equal(existsSync(path.join(workspace.absolutePath, ".wakeflow-local")), false);
  equal(existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")), false);
});
