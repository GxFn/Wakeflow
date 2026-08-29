import { equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  parseWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3.js";
import {
  RootedDirectory,
} from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  executeCodexMaintenanceExecution,
  previewCodexMaintenanceExecution,
} from "../../../src/hosts/codex/codex-maintenance-execution.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

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
  const value = createMinimalWakeflowConfigV3();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return parseWakeflowConfigV3(value);
}

test("Codex fixed composition executes shared maintenance without a host capability", async (t) => {
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
  equal(plan.hostContribution, null);
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
