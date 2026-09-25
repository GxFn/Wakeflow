import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  parseWakeflowConfig,
} from "../../../src/configuration/wakeflow-config.js";
import {
  RootedDirectory,
} from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  CodexMaintenanceCapabilityError,
  codexMaintenanceCapability,
} from "../../../src/hosts/codex/codex-maintenance-capability.js";
import {
  executeCodexMaintenanceExecution,
  previewCodexMaintenanceExecution,
} from "../../../src/hosts/codex/codex-maintenance-execution.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import type { WakeflowHostMaintenanceOperation } from "../../../src/workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import {
  type WakeflowMaintenanceGateContext,
  withWakeflowMaintenanceGate,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import {
  createMinimalWakeflowConfig,
} from "../../configuration/wakeflow-config.fixture.js";

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-codex-maintenance-execution-",
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
  const value = createMinimalWakeflowConfig();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return parseWakeflowConfig(value);
}

test("Codex fixed composition executes shared maintenance with an empty projection contribution on fresh", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const request = Object.freeze({
    action: "fresh-initialize" as const,
    desiredConfig: desired,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
  const plan = await previewCodexMaintenanceExecution(workspace.root, request);

  equal(plan.status, "ready");
  // Codex 的唯一宿主贡献是对账时重建窗口运行投影；fresh 由共享步骤发布投影，贡献为空。
  equal(plan.hostContribution?.hostId, "codex");
  equal(plan.hostContribution?.capabilityId, "codex-maintenance");
  equal(plan.hostContribution?.status, "ready");
  deepEqual([...(plan.hostContribution?.operations ?? [{}])], []);
  equal(plan.steps.some((entry) => entry.boundary === "host-capability"), false);

  const receipt = await executeCodexMaintenanceExecution(
    workspace.root,
    plan,
    request,
    { uuidFactory: () => "11111111-1111-4111-8111-111111111111" },
  );
  equal(receipt.status, "completed");
  equal(existsSync(path.join(
    workspace.absolutePath,
    "wakeflow.config.json",
  )), true);
});

test("Codex maintenance capability maps a foreign gate context and a foreign operation to its own error", async (t) => {
  const workspace = await fixture(t);
  const desired = desiredConfig();
  const plan = await previewCodexMaintenanceExecution(workspace.root, {
    action: "fresh-initialize" as const,
    desiredConfig: desired,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
  const foreignOperation = Object.freeze({
    operationId: "claude-portable-settings:foreign",
    operationKind: "foreign-kind",
    ownerId: "foreign-owner",
    targetKey: "foreign",
    targetDigest: `sha256:${"0".repeat(64)}`,
  }) as unknown as WakeflowHostMaintenanceOperation;
  const failsWith = (reason: string, errorPath: string) => (error: unknown) => (
    error instanceof CodexMaintenanceCapabilityError
    && error.code === "wakeflow-codex-maintenance-capability"
    && error.reason === reason
    && error.path === errorPath
  );
  const forgedContext = Object.freeze({ operationId: "forged" }) as unknown as WakeflowMaintenanceGateContext;
  await rejects(
    codexMaintenanceCapability.executeOperation(workspace.root, forgedContext, {
      config: desired,
      profile: codexWorkspaceHostResourceProfile,
      operation: foreignOperation,
      recoveringAffectedOperation: false,
    }),
    failsWith("gate", "$context"),
  );
  await withWakeflowMaintenanceGate(
    workspace.root,
    { expectedCoreLayoutInspectionDigest: plan.sharedPreview.coreLayoutInspectionDigest },
    async (context) => {
      for (const profile of PROFILES) {
        await rejects(
          codexMaintenanceCapability.executeOperation(workspace.root, context, {
            config: desired,
            profile,
            operation: foreignOperation,
            recoveringAffectedOperation: false,
          }),
          failsWith("operation", "$operation"),
        );
      }
    },
  );
});
