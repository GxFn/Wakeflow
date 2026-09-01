/** shared-only 路径也必须经过唯一聚合 maintenance transaction。 */
import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { withWakeflowMaintenanceGate } from "../../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import { parseWakeflowMaintenanceOperationId } from "../../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
import {
  beginWakeflowMaintenanceJournalStep,
  completeWakeflowMaintenanceJournalStep,
  terminalizeWakeflowMaintenanceJournal,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal.js";
import {
  checkpointWakeflowMaintenanceJournal,
  publishPreparedWakeflowMaintenanceJournal,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal-store.js";
import { createWakeflowMaintenanceExecutionIntent } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent.js";
import {
  publishWakeflowMaintenanceExecutionIntent,
  retireWakeflowMaintenanceExecutionIntent,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.js";
import { createWakeflowMaintenanceExecutionPlan } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-plan.js";
import {
  executeWakeflowMaintenanceExecutionTransaction,
  recoverWakeflowMaintenanceExecutionTransaction,
  WakeflowMaintenanceExecutionTransactionError,
  type WakeflowMaintenanceExecutionTransactionOptions,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-transaction.js";
import { previewWakeflowStaticMaterialization } from "../../../src/workspace/maintenance/wakeflow-static-materialization-preview.js";
import { executeWakeflowStaticMaterializationStep } from "../../../src/workspace/maintenance/wakeflow-static-materialization-step-executor.js";
import { inspectWakeflowWorkspaceCoreLayout } from "../../../src/workspace/maintenance/wakeflow-workspace-core-layout-inspection.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);
const UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";
const OPERATION_ID = parseWakeflowMaintenanceOperationId(
  `maintenance_operation_${UUID}`,
);

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(
    mkdtempSync(
      path.join(os.tmpdir(), "wakeflow-maintenance-execution-transaction-"),
    ),
  );
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: absolutePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (initialized.status !== 0)
    throw new Error("Cannot initialize fixture Git.");
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function request(
  desiredConfig: unknown,
  action: "fresh-initialize" | "reconfigure" | "reconcile" = "fresh-initialize",
) {
  return Object.freeze({
    action,
    desiredConfig: action === "reconcile" ? null : desiredConfig,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
}

function configValue(): Record<string, unknown> {
  const value = createMinimalWakeflowConfigV3();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return value;
}

function desiredConfig() {
  return parseWakeflowConfigV3(configValue());
}

function sharedExecutionPlan(preview: unknown) {
  return createWakeflowMaintenanceExecutionPlan(
    preview,
    codexWorkspaceHostResourceProfile,
    null,
  );
}

async function executeSharedMaintenanceTransaction(
  root: RootedDirectory,
  preview: unknown,
  input: ReturnType<typeof request>,
  options: WakeflowMaintenanceExecutionTransactionOptions = {},
) {
  return executeWakeflowMaintenanceExecutionTransaction(
    root,
    sharedExecutionPlan(preview),
    input,
    undefined,
    options,
  );
}

async function recoverSharedMaintenanceTransaction(
  root: RootedDirectory,
  operationId: unknown,
  options: Omit<
    WakeflowMaintenanceExecutionTransactionOptions,
    "uuidFactory"
  > = {},
) {
  return recoverWakeflowMaintenanceExecutionTransaction(
    root,
    operationId,
    undefined,
    options,
  );
}

async function publishPreparedSharedTransaction(
  root: RootedDirectory,
  context: Parameters<typeof publishPreparedWakeflowMaintenanceJournal>[1],
  preview: unknown,
  input: ReturnType<typeof request>,
  desired: ReturnType<typeof desiredConfig>,
) {
  const plan = sharedExecutionPlan(preview);
  const intent = createWakeflowMaintenanceExecutionIntent(
    context.operationId,
    plan,
    input,
    desired,
  );
  const intentSource = await publishWakeflowMaintenanceExecutionIntent(
    root,
    context,
    intent,
  );
  const journalSource = await publishPreparedWakeflowMaintenanceJournal(
    root,
    context,
    intentSource,
    plan,
  );
  return Object.freeze({ intentSource, journalSource });
}

test("shared maintenance transaction executes all steps and retires terminal journal", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const completed = await executeSharedMaintenanceTransaction(
    workspace.root,
    preview,
    input,
    { uuidFactory: () => UUID },
  );
  equal(completed.status, "completed");
  equal(completed.operationId, OPERATION_ID);
  equal(completed.stepReceipts.length, preview.steps.length);
  equal(completed.stepReceipts.at(-1)?.stepId, "authority:config");
  equal(
    existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")),
    true,
  );
  equal(
    existsSync(path.join(workspace.absolutePath, "Ledger", "requirements")),
    true,
  );
  equal(
    existsSync(path.join(workspace.absolutePath, "Ledger", "confirmations")),
    true,
  );
  equal(
    existsSync(path.join(workspace.absolutePath, "Ledger", "transactions")),
    true,
  );
  equal(
    existsSync(
      path.join(
        workspace.absolutePath,
        ".wakeflow-active",
        "current",
        "todo",
        "global-todo-board.md",
      ),
    ),
    true,
  );
  const activeIndexPath = path.join(
    workspace.absolutePath,
    ".wakeflow-active/index.md",
  );
  const activeStatusPath = path.join(
    workspace.absolutePath,
    ".wakeflow-active/current/workspace-current-status.md",
  );
  equal(existsSync(activeIndexPath), true);
  equal(existsSync(activeStatusPath), true);
  equal(statSync(activeIndexPath).mode & 0o777, 0o600);
  equal(statSync(activeStatusPath).mode & 0o777, 0o600);
  equal(
    readFileSync(activeIndexPath, "utf8").includes(
      "current/todo/global-todo-board.md",
    ),
    true,
  );
  equal(
    readFileSync(activeIndexPath, "utf8").includes("workspace-record-map.md"),
    false,
  );
  equal(
    existsSync(
      path.join(
        workspace.absolutePath,
        ".wakeflow-local",
        "runtime",
        "hosts",
        "codex",
        "operations",
        "keep-live",
        "leases",
      ),
    ),
    true,
  );
  equal(
    existsSync(
      path.join(
        workspace.absolutePath,
        ".wakeflow-local",
        "runtime",
        "hosts",
        "codex",
        "projections",
        "window-runtime",
        `${desired.topology.windows[0]?.windowId}.json`,
      ),
    ),
    true,
  );
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  equal(core.local.status, "idle");
  equal(core.active.status, "present");

  const reconcileInput = request(null, "reconcile");
  const reconcilePreview = await previewWakeflowStaticMaterialization(
    workspace.root,
    reconcileInput,
  );
  const noOp = await executeSharedMaintenanceTransaction(
    workspace.root,
    reconcilePreview,
    reconcileInput,
  );
  equal(noOp.status, "no-op");
  equal(noOp.operationId, null);
});

test("gate-bound preview rejects drift introduced after the pre-gate preview", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  let caught: unknown;
  try {
    await executeSharedMaintenanceTransaction(workspace.root, preview, input, {
      uuidFactory: () => {
        writeFileSync(
          path.join(workspace.absolutePath, ".gitignore"),
          "# concurrent user change\n",
          { mode: 0o644 },
        );
        return UUID;
      },
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceExecutionTransactionError, true);
  if (caught instanceof WakeflowMaintenanceExecutionTransactionError) {
    equal(caught.reason, "plan-stale");
    equal(caught.operationId, null);
  }
  equal(
    existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")),
    false,
  );
  deepEqual(
    readdirSync(
      path.join(
        workspace.absolutePath,
        ".wakeflow-local",
        "runtime",
        "maintenance",
        "transactions",
      ),
    ),
    [],
  );
});

test("maintenance transaction preserves cancellation before durable work", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const controller = new AbortController();
  controller.abort();
  let caught: unknown;
  try {
    await executeSharedMaintenanceTransaction(workspace.root, preview, input, {
      signal: controller.signal,
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceExecutionTransactionError, true);
  if (caught instanceof WakeflowMaintenanceExecutionTransactionError) {
    equal(caught.reason, "aborted");
    equal(caught.operationId, null);
  }
  equal(
    existsSync(path.join(workspace.absolutePath, ".wakeflow-local")),
    false,
  );

  caught = undefined;
  try {
    await recoverSharedMaintenanceTransaction(workspace.root, OPERATION_ID, {
      signal: controller.signal,
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceExecutionTransactionError, true);
  if (caught instanceof WakeflowMaintenanceExecutionTransactionError) {
    equal(caught.reason, "aborted");
    equal(caught.operationId, OPERATION_ID);
  }
});

test("placement-stable reconfigure updates derived memories before Config", async (t) => {
  const workspace = await fixture(t);
  const current = desiredConfig();
  const freshInput = request(current);
  const freshPreview = await previewWakeflowStaticMaterialization(
    workspace.root,
    freshInput,
  );
  await executeSharedMaintenanceTransaction(
    workspace.root,
    freshPreview,
    freshInput,
    { uuidFactory: () => UUID },
  );

  const changed = configValue();
  (changed.presentation as Record<string, unknown>).language = "zh-Hans";
  const desired = parseWakeflowConfigV3(changed);
  const reconfigureInput = request(desired, "reconfigure");
  const reconfigurePreview = await previewWakeflowStaticMaterialization(
    workspace.root,
    reconfigureInput,
  );
  const beforeConfig = statSync(
    path.join(workspace.absolutePath, "wakeflow.config.json"),
    { bigint: true },
  );
  const reconfigured = await executeSharedMaintenanceTransaction(
    workspace.root,
    reconfigurePreview,
    reconfigureInput,
    { uuidFactory: () => OTHER_UUID },
  );
  equal(reconfigured.status, "completed");
  equal(reconfigured.stepReceipts.length, 5);
  equal(reconfigured.stepReceipts.at(-1)?.stepId, "authority:config");
  equal(
    readFileSync(
      path.join(workspace.absolutePath, "AGENTS.md"),
      "utf8",
    ).includes("Wakeflow 程序指令"),
    true,
  );
  equal(
    readFileSync(
      path.join(workspace.absolutePath, "Design", "AGENTS.md"),
      "utf8",
    ).includes("Wakeflow Design 支持窗口"),
    true,
  );
  equal(
    statSync(path.join(workspace.absolutePath, "wakeflow.config.json"), {
      bigint: true,
    }).ino === beforeConfig.ino,
    false,
  );
});

test("recovery replays an affected whole-owned root after effect-before-checkpoint", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const plan = sharedExecutionPlan(preview);
  const privateError = new Error("interrupt after Active effect");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: preview.coreLayoutInspectionDigest,
        operationId: OPERATION_ID,
      },
      async (context) => {
        const prepared = await publishPreparedSharedTransaction(
          workspace.root,
          context,
          preview,
          input,
          desired,
        );
        let source = prepared.journalSource;
        for (const step of plan.steps) {
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            beginWakeflowMaintenanceJournalStep(source.journal),
          );
          equal(source.journal.affectedStepId, step.stepId);
          await executeWakeflowStaticMaterializationStep(
            workspace.root,
            context,
            preview,
            input,
            source.journal.affectedStepId,
            { sourceConfig: null, recoveringAffectedStep: false },
          );
          if (step.stepId === "core:active-layout") throw privateError;
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            completeWakeflowMaintenanceJournalStep(source.journal),
          );
        }
        throw new Error("Expected the Active layout step.");
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }
  equal(
    existsSync(path.join(workspace.absolutePath, ".wakeflow-active")),
    true,
  );

  const recovered = await recoverSharedMaintenanceTransaction(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.status, "recovered");
  equal(recovered.operationId, OPERATION_ID);
  equal(
    existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")),
    true,
  );
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  equal(core.local.status, "idle");
  equal(core.active.status, "present");
});

test("recovery creates the journal from an intent-only durable prefix", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const plan = sharedExecutionPlan(preview);
  const privateError = new Error("interrupt after intent publication");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: preview.coreLayoutInspectionDigest,
        operationId: OPERATION_ID,
      },
      async (context) => {
        await publishWakeflowMaintenanceExecutionIntent(
          workspace.root,
          context,
          createWakeflowMaintenanceExecutionIntent(
            context.operationId,
            plan,
            input,
            desired,
          ),
        );
        throw privateError;
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }
  const transactionRoot = path.join(
    workspace.absolutePath,
    ".wakeflow-local/runtime/maintenance/transactions",
  );
  equal(
    existsSync(path.join(transactionRoot, `${OPERATION_ID}.intent.json`)),
    true,
  );
  equal(
    existsSync(path.join(transactionRoot, `${OPERATION_ID}.journal.json`)),
    false,
  );

  const recovered = await recoverSharedMaintenanceTransaction(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.status, "recovered");
  equal(recovered.stepReceipts.length, plan.steps.length);
  equal(
    existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")),
    true,
  );
  equal(
    (await inspectWakeflowWorkspaceCoreLayout(workspace.root)).local.status,
    "idle",
  );
});

test("recovery reuses the exact empty TODO collection after effect-before-checkpoint", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const privateError = new Error("interrupt after TODO initialization effect");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: preview.coreLayoutInspectionDigest,
        operationId: OPERATION_ID,
      },
      async (context) => {
        const prepared = await publishPreparedSharedTransaction(
          workspace.root,
          context,
          preview,
          input,
          desired,
        );
        let source = prepared.journalSource;
        for (const step of preview.steps) {
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            beginWakeflowMaintenanceJournalStep(source.journal),
          );
          await executeWakeflowStaticMaterializationStep(
            workspace.root,
            context,
            preview,
            input,
            step.stepId,
            { sourceConfig: null, recoveringAffectedStep: false },
          );
          if (step.kind === "initialize-todo-collection") throw privateError;
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            completeWakeflowMaintenanceJournalStep(source.journal),
          );
        }
        throw new Error("Expected TODO initialization step.");
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }
  const boardPath = path.join(
    workspace.absolutePath,
    ".wakeflow-active",
    "current",
    "todo",
    "global-todo-board.md",
  );
  equal(readFileSync(boardPath, "utf8").includes("# Global TODO Board"), true);

  const recovered = await recoverSharedMaintenanceTransaction(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.status, "recovered");
  equal(recovered.stepReceipts[0]?.stepId, "active:todo-collection");
  equal(recovered.stepReceipts[0]?.disposition, "current");
  equal(
    existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")),
    true,
  );
});

test("recovery reuses published Active workspace projection without replacement", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const privateError = new Error("interrupt after Active projection effect");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: preview.coreLayoutInspectionDigest,
        operationId: OPERATION_ID,
      },
      async (context) => {
        const prepared = await publishPreparedSharedTransaction(
          workspace.root,
          context,
          preview,
          input,
          desired,
        );
        let source = prepared.journalSource;
        for (const step of preview.steps) {
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            beginWakeflowMaintenanceJournalStep(source.journal),
          );
          await executeWakeflowStaticMaterializationStep(
            workspace.root,
            context,
            preview,
            input,
            step.stepId,
            { sourceConfig: null, recoveringAffectedStep: false },
          );
          if (step.kind === "publish-fresh-active-workspace-projection") {
            throw privateError;
          }
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            completeWakeflowMaintenanceJournalStep(source.journal),
          );
        }
        throw new Error("Expected Active workspace projection step.");
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }
  const indexPath = path.join(
    workspace.absolutePath,
    ".wakeflow-active/index.md",
  );
  const statusPath = path.join(
    workspace.absolutePath,
    ".wakeflow-active/current/workspace-current-status.md",
  );
  const before = [indexPath, statusPath].map(
    (entry) => statSync(entry, { bigint: true }).ino,
  );

  const recovered = await recoverSharedMaintenanceTransaction(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.status, "recovered");
  equal(recovered.stepReceipts[0]?.stepId, "active:workspace-projection");
  equal(recovered.stepReceipts[0]?.disposition, "current");
  deepEqual(
    [indexPath, statusPath].map(
      (entry) => statSync(entry, { bigint: true }).ino,
    ),
    before,
  );
  equal(
    existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")),
    true,
  );
});

test("recovery reuses the exact Ledger layout after effect-before-checkpoint", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const privateError = new Error("interrupt after Ledger layout effect");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: preview.coreLayoutInspectionDigest,
        operationId: OPERATION_ID,
      },
      async (context) => {
        const prepared = await publishPreparedSharedTransaction(
          workspace.root,
          context,
          preview,
          input,
          desired,
        );
        let source = prepared.journalSource;
        for (const step of preview.steps) {
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            beginWakeflowMaintenanceJournalStep(source.journal),
          );
          await executeWakeflowStaticMaterializationStep(
            workspace.root,
            context,
            preview,
            input,
            step.stepId,
            { sourceConfig: null, recoveringAffectedStep: false },
          );
          if (step.kind === "materialize-ledger-layout") throw privateError;
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            completeWakeflowMaintenanceJournalStep(source.journal),
          );
        }
        throw new Error("Expected Ledger step.");
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }
  equal(
    statSync(path.join(workspace.absolutePath, "Ledger", "requirements")).mode &
      0o777,
    0o755,
  );
  equal(
    statSync(path.join(workspace.absolutePath, "Ledger", "transactions")).mode &
      0o777,
    0o700,
  );

  const recovered = await recoverSharedMaintenanceTransaction(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.status, "recovered");
  equal(recovered.stepReceipts[0]?.stepId, "ledger:layout");
  equal(recovered.stepReceipts[0]?.disposition, "current");
  equal(
    existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")),
    true,
  );
});

test("recovery reuses unregistered Window Runtime after effect-before-checkpoint", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const privateError = new Error("interrupt after Window Runtime effect");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: preview.coreLayoutInspectionDigest,
        operationId: OPERATION_ID,
      },
      async (context) => {
        const prepared = await publishPreparedSharedTransaction(
          workspace.root,
          context,
          preview,
          input,
          desired,
        );
        let source = prepared.journalSource;
        for (const step of preview.steps) {
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            beginWakeflowMaintenanceJournalStep(source.journal),
          );
          await executeWakeflowStaticMaterializationStep(
            workspace.root,
            context,
            preview,
            input,
            step.stepId,
            { sourceConfig: null, recoveringAffectedStep: false },
          );
          if (step.kind === "publish-unregistered-window-runtime") {
            throw privateError;
          }
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            completeWakeflowMaintenanceJournalStep(source.journal),
          );
        }
        throw new Error("Expected Window Runtime step.");
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }
  const hostRoot = path.join(
    workspace.absolutePath,
    ".wakeflow-local",
    "runtime",
    "hosts",
    "codex",
  );
  equal(
    readdirSync(path.join(hostRoot, "identity", "window-bindings")).length,
    0,
  );
  equal(
    readdirSync(path.join(hostRoot, "projections", "window-runtime")).length,
    desired.topology.windows.length,
  );

  const recovered = await recoverSharedMaintenanceTransaction(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.status, "recovered");
  equal(recovered.stepReceipts[0]?.stepId, "host:window-runtime");
  equal(recovered.stepReceipts[0]?.disposition, "current");
  equal(
    existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")),
    true,
  );
});

test("recovery reuses exact Host capability layout after effect-before-checkpoint", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const privateError = new Error("interrupt after Host capability effect");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: preview.coreLayoutInspectionDigest,
        operationId: OPERATION_ID,
      },
      async (context) => {
        const prepared = await publishPreparedSharedTransaction(
          workspace.root,
          context,
          preview,
          input,
          desired,
        );
        let source = prepared.journalSource;
        for (const step of preview.steps) {
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            beginWakeflowMaintenanceJournalStep(source.journal),
          );
          await executeWakeflowStaticMaterializationStep(
            workspace.root,
            context,
            preview,
            input,
            step.stepId,
            { sourceConfig: null, recoveringAffectedStep: false },
          );
          if (step.kind === "materialize-host-capability-layout") {
            throw privateError;
          }
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            completeWakeflowMaintenanceJournalStep(source.journal),
          );
        }
        throw new Error("Expected Host capability layout step.");
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }
  const hostRoot = path.join(
    workspace.absolutePath,
    ".wakeflow-local",
    "runtime",
    "hosts",
    "codex",
  );
  equal(readdirSync(path.join(hostRoot, "evidence", "pods")).length, 0);
  equal(
    readdirSync(path.join(hostRoot, "operations", "keep-live", "leases"))
      .length,
    0,
  );

  const recovered = await recoverSharedMaintenanceTransaction(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.status, "recovered");
  equal(recovered.stepReceipts[0]?.stepId, "host:capability-layout");
  equal(recovered.stepReceipts[0]?.disposition, "current");
  equal(
    existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")),
    true,
  );
});

test("recovery checkpoints an already-published Config without replacing it", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const privateError = new Error("interrupt after Config effect");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: preview.coreLayoutInspectionDigest,
        operationId: OPERATION_ID,
      },
      async (context) => {
        const prepared = await publishPreparedSharedTransaction(
          workspace.root,
          context,
          preview,
          input,
          desired,
        );
        let source = prepared.journalSource;
        for (const step of preview.steps) {
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            beginWakeflowMaintenanceJournalStep(source.journal),
          );
          await executeWakeflowStaticMaterializationStep(
            workspace.root,
            context,
            preview,
            input,
            step.stepId,
            { sourceConfig: null, recoveringAffectedStep: false },
          );
          if (step.kind === "publish-config") throw privateError;
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            completeWakeflowMaintenanceJournalStep(source.journal),
          );
        }
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }
  const configPath = path.join(workspace.absolutePath, "wakeflow.config.json");
  const publishedNode = statSync(configPath, { bigint: true });
  const recovered = await recoverSharedMaintenanceTransaction(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.status, "recovered");
  equal(recovered.stepReceipts.length, 1);
  equal(recovered.stepReceipts[0]?.stepId, "authority:config");
  equal(recovered.stepReceipts[0]?.disposition, "current");
  equal(statSync(configPath, { bigint: true }).ino, publishedNode.ino);
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  equal(core.local.status, "idle");
});

test("recovery retires a terminal journal after intent retirement", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const privateError = new Error("interrupt after intent retirement");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: preview.coreLayoutInspectionDigest,
        operationId: OPERATION_ID,
      },
      async (context) => {
        const prepared = await publishPreparedSharedTransaction(
          workspace.root,
          context,
          preview,
          input,
          desired,
        );
        let source = prepared.journalSource;
        for (const step of preview.steps) {
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            beginWakeflowMaintenanceJournalStep(source.journal),
          );
          await executeWakeflowStaticMaterializationStep(
            workspace.root,
            context,
            preview,
            input,
            step.stepId,
            { sourceConfig: null, recoveringAffectedStep: false },
          );
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            prepared.intentSource,
            source,
            completeWakeflowMaintenanceJournalStep(source.journal),
          );
        }
        source = await checkpointWakeflowMaintenanceJournal(
          workspace.root,
          context,
          prepared.intentSource,
          source,
          terminalizeWakeflowMaintenanceJournal(source.journal),
        );
        equal(source.journal.state, "terminal");
        await retireWakeflowMaintenanceExecutionIntent(
          workspace.root,
          context,
          prepared.intentSource,
        );
        throw privateError;
      },
    );
  } catch (error: unknown) {
    equal(error, privateError);
  }

  const recovered = await recoverSharedMaintenanceTransaction(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.status, "recovered");
  equal(recovered.stepReceipts.length, 0);
  equal(
    (await inspectWakeflowWorkspaceCoreLayout(workspace.root)).local.status,
    "idle",
  );
});
