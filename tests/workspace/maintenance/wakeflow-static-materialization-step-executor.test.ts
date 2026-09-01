import { equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { withWakeflowMaintenanceGate } from "../../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import { previewWakeflowStaticMaterialization } from "../../../src/workspace/maintenance/wakeflow-static-materialization-preview.js";
import {
  executeWakeflowStaticMaterializationStep,
  WakeflowStaticMaterializationStepExecutionError,
} from "../../../src/workspace/maintenance/wakeflow-static-materialization-step-executor.js";
import { inspectWakeflowWorkspaceCoreLayout } from "../../../src/workspace/maintenance/wakeflow-workspace-core-layout-inspection.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);
const UUID = "11111111-1111-4111-8111-111111111111";

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-static-step-executor-")),
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

function request(desiredConfig: unknown) {
  return Object.freeze({
    action: "fresh-initialize" as const,
    desiredConfig,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
}

function desiredConfig() {
  const value = createMinimalWakeflowConfigV3();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return parseWakeflowConfigV3(value);
}

test("closed dispatcher executes the fresh preview in Config-last order", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const receipts = await withWakeflowMaintenanceGate(
    workspace.root,
    {
      expectedCoreLayoutInspectionDigest: preview.coreLayoutInspectionDigest,
      uuidFactory: () => UUID,
    },
    async (context) => {
      const values = [];
      for (const step of preview.steps) {
        values.push(
          await executeWakeflowStaticMaterializationStep(
            workspace.root,
            context,
            preview,
            input,
            step.stepId,
            { sourceConfig: null, recoveringAffectedStep: false },
          ),
        );
      }
      return values;
    },
  );
  equal(receipts.length, 15);
  equal(receipts.at(-1)?.stepId, "authority:config");
  equal(
    existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")),
    true,
  );
  equal(
    existsSync(path.join(workspace.absolutePath, ".wakeflow-active")),
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
  equal(
    existsSync(
      path.join(
        workspace.absolutePath,
        ".wakeflow-local",
        "runtime",
        "hosts",
        "codex",
        "evidence",
        "pods",
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
        "operations",
        "keep-live",
        "leases",
      ),
    ),
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
  equal(existsSync(path.join(workspace.absolutePath, "AGENTS.md")), true);
  equal(
    existsSync(path.join(workspace.absolutePath, "Design", "AGENTS.md")),
    true,
  );
  equal(
    existsSync(path.join(workspace.absolutePath, "Test", "AGENTS.md")),
    true,
  );
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  equal(core.local.status, "idle");
  equal(core.active.status, "present");
});

test("whole-owned root accepts existing only while replaying an affected step", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const input = request(desired);
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    input,
  );
  const activeStep = preview.steps.find(
    (entry) => entry.kind === "materialize-active-layout",
  );
  if (activeStep === undefined) throw new Error("Expected Active root step.");

  await withWakeflowMaintenanceGate(
    workspace.root,
    {
      expectedCoreLayoutInspectionDigest: preview.coreLayoutInspectionDigest,
      uuidFactory: () => UUID,
    },
    async (context) => {
      const created = await executeWakeflowStaticMaterializationStep(
        workspace.root,
        context,
        preview,
        input,
        activeStep.stepId,
        { sourceConfig: null, recoveringAffectedStep: false },
      );
      equal(created.disposition, "created");

      let normalError: unknown;
      try {
        await executeWakeflowStaticMaterializationStep(
          workspace.root,
          context,
          preview,
          input,
          activeStep.stepId,
          { sourceConfig: null, recoveringAffectedStep: false },
        );
      } catch (error: unknown) {
        normalError = error;
      }
      equal(
        normalError instanceof WakeflowStaticMaterializationStepExecutionError,
        true,
      );
      if (
        normalError instanceof WakeflowStaticMaterializationStepExecutionError
      ) {
        equal(normalError.reason, "strict-absent");
      }

      const recovered = await executeWakeflowStaticMaterializationStep(
        workspace.root,
        context,
        preview,
        input,
        activeStep.stepId,
        { sourceConfig: null, recoveringAffectedStep: true },
      );
      equal(recovered.disposition, "current");
    },
  );
});

test("step executor observes cancellation before decoding plan payloads", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const core = await inspectWakeflowWorkspaceCoreLayout(workspace.root);
  await withWakeflowMaintenanceGate(
    workspace.root,
    {
      expectedCoreLayoutInspectionDigest: core.inspectionDigest,
      uuidFactory: () => UUID,
    },
    async (context) => {
      const controller = new AbortController();
      controller.abort();
      let caught: unknown;
      try {
        await executeWakeflowStaticMaterializationStep(
          workspace.root,
          context,
          { invalid: true },
          request(desired),
          "invalid:step",
          {
            sourceConfig: null,
            recoveringAffectedStep: false,
            signal: controller.signal,
          },
        );
      } catch (error: unknown) {
        caught = error;
      }
      equal(
        caught instanceof WakeflowStaticMaterializationStepExecutionError,
        true,
      );
      if (caught instanceof WakeflowStaticMaterializationStepExecutionError) {
        equal(caught.reason, "aborted");
      }
    },
  );
});
