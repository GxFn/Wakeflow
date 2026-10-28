import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { createWakeflowMaintenanceExecutionIntent } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent.js";
import { publishWakeflowMaintenanceExecutionIntent } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.js";
import { createWakeflowMaintenanceExecutionPlan } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-plan.js";
import {
  executeWakeflowMaintenanceExecutionTransaction,
  recoverWakeflowMaintenanceExecutionTransaction,
  WakeflowMaintenanceExecutionTransactionError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-transaction.js";
import { withWakeflowMaintenanceGate } from "../../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import {
  beginWakeflowMaintenanceJournalStep,
  completeWakeflowMaintenanceJournalStep,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal.js";
import {
  checkpointWakeflowMaintenanceJournal,
  publishPreparedWakeflowMaintenanceJournal,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-journal-store.js";
import { parseWakeflowMaintenanceOperationId } from "../../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
import { previewWakeflowStaticMaterialization } from "../../../src/workspace/maintenance/wakeflow-static-materialization-preview.js";
import { executeWakeflowStaticMaterializationStep } from "../../../src/workspace/maintenance/wakeflow-static-materialization-step-executor.js";
import { wakeflowWindowRuntimeProjectionRef } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-paths.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 2 级（能力）：detach-workspace 走同一维护事务（ADR-0024）。shared-only 的退出计划按"托管块 →
 * 窗口投影 → retire-config"执行；retire-config 把 `wakeflow.config.json` 原样改名为
 * `wakeflow.detached.json`（字节不变）；退役步落盘后、checkpoint 之前中断，recover 从退役文件读回源
 * Config 并收尾；已退役的工作区再预览 detach-workspace 以 current-config-unavailable 阻塞。
 */

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);
const UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";
const OPERATION_ID = parseWakeflowMaintenanceOperationId(`maintenance_operation_${OTHER_UUID}`);

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-detach-workspace-transaction-")),
  );
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
  const value = createMinimalWakeflowConfig();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return parseWakeflowConfig(value);
}

function freshRequest(desired: ReturnType<typeof desiredConfig>) {
  return Object.freeze({
    action: "fresh-initialize" as const,
    desiredConfig: desired,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
}

const DETACH_REQUEST = Object.freeze({
  action: "detach-workspace" as const,
  desiredConfig: null,
  currentHostProfile: codexWorkspaceHostResourceProfile,
  hostProfiles: PROFILES,
});

/** fresh-initialize 之后再加一行用户自己的 `.gitignore` 规则与一段用户文字，分离必须只删托管块。 */
async function initializedWorkspace(t: TestContext) {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const request = freshRequest(desired);
  const preview = await previewWakeflowStaticMaterialization(workspace.root, request);
  const fresh = await executeWakeflowMaintenanceExecutionTransaction(
    workspace.root,
    createWakeflowMaintenanceExecutionPlan(preview, codexWorkspaceHostResourceProfile, null),
    request,
    undefined,
    { uuidFactory: () => UUID },
  );
  equal(fresh.status, "completed");
  const gitignore = path.join(workspace.absolutePath, ".gitignore");
  writeFileSync(gitignore, `${readFileSync(gitignore, "utf8")}node_modules/\n`);
  const agents = path.join(workspace.absolutePath, "AGENTS.md");
  writeFileSync(agents, `# My notes\n\n${readFileSync(agents, "utf8")}`);
  return Object.freeze({
    ...workspace,
    desired,
    configBytes: readFileSync(path.join(workspace.absolutePath, "wakeflow.config.json")),
  });
}

function projectionPaths(absolutePath: string, desired: ReturnType<typeof desiredConfig>) {
  return desired.topology.windows.map((window) =>
    path.join(
      absolutePath,
      wakeflowWindowRuntimeProjectionRef(codexWorkspaceHostResourceProfile, window.windowId),
    ),
  );
}

test("detach-workspace 的共享计划按托管块、窗口投影、retire-config 的顺序执行，配置文件原样改名", async (t) => {
  const workspace = await initializedWorkspace(t);
  const preview = await previewWakeflowStaticMaterialization(workspace.root, DETACH_REQUEST);
  equal(preview.status, "ready");
  equal(preview.desiredConfigDigest, preview.currentConfigDigest);
  deepEqual(
    preview.steps.map((step) => step.kind),
    ["remove-managed-block", "remove-managed-block", "retire-window-projections", "retire-config"],
  );
  deepEqual(preview.steps.map((step) => step.targetKey).slice(0, 3), [
    "workspace.ignore-integration",
    "program-instruction",
    "workspace",
  ]);
  equal(preview.steps.at(-1)?.dependsOn.length, preview.steps.length - 1);
  for (const projection of projectionPaths(workspace.absolutePath, workspace.desired)) {
    equal(existsSync(projection), true);
  }

  const completed = await executeWakeflowMaintenanceExecutionTransaction(
    workspace.root,
    createWakeflowMaintenanceExecutionPlan(preview, codexWorkspaceHostResourceProfile, null),
    DETACH_REQUEST,
    undefined,
    { uuidFactory: () => OTHER_UUID },
  );
  equal(completed.status, "completed");
  equal(completed.stepReceipts.at(-1)?.stepId, "authority:retire-config");
  equal(completed.stepReceipts.at(-1)?.disposition, "updated");
  equal(existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")), false);
  deepEqual(
    readFileSync(path.join(workspace.absolutePath, "wakeflow.detached.json")),
    workspace.configBytes,
  );
  const gitignore = readFileSync(path.join(workspace.absolutePath, ".gitignore"), "utf8");
  equal(gitignore.includes(".wakeflow-local"), false);
  equal(gitignore.includes("node_modules/"), true);
  equal(gitignore.includes("wakeflow:managed-content"), false);
  const agents = readFileSync(path.join(workspace.absolutePath, "AGENTS.md"), "utf8");
  equal(agents.includes("# My notes"), true);
  equal(agents.includes("wakeflow:managed-content"), false);
  for (const projection of projectionPaths(workspace.absolutePath, workspace.desired)) {
    equal(existsSync(projection), false);
  }
  equal(existsSync(path.join(workspace.absolutePath, ".wakeflow-active")), true);
  equal(existsSync(path.join(workspace.absolutePath, "Ledger")), true);

  // 终态之后：没有配置文件，退出路径的共享预览以 current-config-unavailable 阻塞。
  const after = await previewWakeflowStaticMaterialization(workspace.root, DETACH_REQUEST);
  equal(after.status, "blocked");
  deepEqual([...after.blockerCodes], ["current-config-unavailable"]);
});

test("retire-config 落盘后、checkpoint 之前中断，recover 从退役文件读回源 Config 并收尾", async (t) => {
  const workspace = await initializedWorkspace(t);
  const preview = await previewWakeflowStaticMaterialization(workspace.root, DETACH_REQUEST);
  const plan = createWakeflowMaintenanceExecutionPlan(
    preview,
    codexWorkspaceHostResourceProfile,
    null,
  );
  const interrupt = new Error("interrupt after retire-config effect");
  try {
    await withWakeflowMaintenanceGate(
      workspace.root,
      {
        expectedCoreLayoutInspectionDigest: preview.coreLayoutInspectionDigest,
        operationId: OPERATION_ID,
      },
      async (context) => {
        const intent = createWakeflowMaintenanceExecutionIntent(
          OPERATION_ID,
          plan,
          DETACH_REQUEST,
          workspace.desired,
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
          await executeWakeflowStaticMaterializationStep(
            workspace.root,
            context,
            preview,
            DETACH_REQUEST,
            step.stepId,
            { sourceConfig: workspace.desired, recoveringAffectedStep: false },
          );
          if (step.stepId === "authority:retire-config") throw interrupt;
          source = await checkpointWakeflowMaintenanceJournal(
            workspace.root,
            context,
            intentSource,
            source,
            completeWakeflowMaintenanceJournalStep(source.journal),
          );
        }
        throw new Error("Expected the retire-config step.");
      },
    );
  } catch (error: unknown) {
    equal(error, interrupt);
  }
  equal(existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")), false);
  equal(existsSync(path.join(workspace.absolutePath, "wakeflow.detached.json")), true);

  const recovered = await recoverWakeflowMaintenanceExecutionTransaction(
    workspace.root,
    OPERATION_ID,
  );
  equal(recovered.status, "recovered");
  equal(recovered.operationId, OPERATION_ID);
  equal(recovered.stepReceipts.length, 1);
  equal(recovered.stepReceipts[0]?.stepId, "authority:retire-config");
  equal(recovered.stepReceipts[0]?.disposition, "current");
  deepEqual(
    readFileSync(path.join(workspace.absolutePath, "wakeflow.detached.json")),
    workspace.configBytes,
  );
  await rejects(
    recoverWakeflowMaintenanceExecutionTransaction(workspace.root, OPERATION_ID),
    (error: unknown) =>
      error instanceof WakeflowMaintenanceExecutionTransactionError && error.reason === "intent",
  );
});
