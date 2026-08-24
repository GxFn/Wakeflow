import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createWakeflowActiveFoundationMutationParticipant } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-active-foundation.mjs";
import { createWakeflowActiveProjectionMutationParticipant } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-active-projector.mjs";
import { canonicalJsonDigest } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-canonical-json.mjs";
import {
  createWakeflowConfigV3OwnerMutationParticipant,
  createWakeflowConfigV3ReconfigureMutationParticipant,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-config-v3-owner.mjs";
import { parseWakeflowConfigV3 } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-config-v3.mjs";
import { planWakeflowFreshInitializeBackbone } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-fresh-initialize.mjs";
import {
  createWakeflowHostSettingsAssetsOwnerMutationParticipant,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-settings-assets-owner.mjs";
import { createWakeflowLayoutDescriptor } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-layout-descriptor.mjs";
import { createWakeflowLedgerMaterializationMutationParticipant } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-ledger-materialization.mjs";
import { createWakeflowLocalLayoutMutationParticipant } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-local-layout-realization.mjs";
import { createWakeflowMaintenanceActionMutationParticipant } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-maintenance-action-composition.mjs";
import { createWakeflowMaintenanceActionHandlers } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-maintenance-action-runtime.mjs";
import { createWakeflowManagedContentMutationParticipant } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-managed-content.mjs";
import { planWakeflowReconcileBackbone } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-reconcile.mjs";
import { planWakeflowReconfigureBackbone } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-reconfigure.mjs";
import { createWakeflowSupportSurfaceMutationParticipant } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-support-surface-owner.mjs";
import { parseWakeflowAssetBundle } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-template-renderer.mjs";
import { createWindowRuntimeProjectionMutationParticipant } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-runtime-projector.mjs";
import {
  runWakeflowMaintenanceMutation,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-workspace-mutation.mjs";
import {
  wakeflowHostSettingsAssetsAdapter,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-settings.mjs";
import { hostProfile as claudeHostProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { buildWakeflowAssetBundle } from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({
  sourceRoot: path.join(repositoryRoot, "core/template-sources"),
}));
const fixture = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json"),
  "utf8",
));
const hostAdapter = wakeflowHostSettingsAssetsAdapter;
const crashWorkspaceRoot = process.env.WAKEFLOW_CLAUDE_COMPOSITION_CRASH_ROOT ?? null;

function initializeGit(root) {
  const result = spawnSync("git", ["-C", root, "init", "--quiet"], {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function workspace(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-composition-"));
  const workspaceRoot = path.join(base, "Program");
  const productRoot = path.join(base, "ProductA");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  mkdirSync(productRoot, { mode: 0o755 });
  if (process.platform !== "win32") chmodSync(workspaceRoot, 0o700);
  initializeGit(workspaceRoot);
  initializeGit(productRoot);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { workspaceRoot, productRoot };
}

function planningInput(workspaceRoot, desiredModel) {
  return {
    workspaceRoot,
    desiredModel,
    hostProfile: claudeHostProfile,
    bundle,
    language: "zh",
    hostSettingsAssetsAdapter: hostAdapter,
  };
}

function snapshots(actionPlan) {
  return new Map(actionPlan.payload.ownerSnapshots.map((entry) => [entry.componentId, entry]));
}

function actionOwnerParticipants({
  workspaceRoot,
  desiredModel,
  actionPlan,
  action = "fresh-initialize",
  sourceModel = action === "fresh-initialize" ? null : desiredModel,
  authorizedRepositoryIds = [],
}) {
  const byComponent = snapshots(actionPlan);
  const descriptor = createWakeflowLayoutDescriptor({
    model: desiredModel,
    hostProfile: claudeHostProfile,
  });
  const localPlan = byComponent.get("local-layout")?.snapshot ?? null;
  const supportPlan = byComponent.get("support-surface").snapshot;
  const managedPlan = byComponent.get("ignore").snapshot;
  const configParticipant = action === "fresh-initialize"
    ? createWakeflowConfigV3OwnerMutationParticipant({
        workspaceRoot,
        model: desiredModel,
        confirmedPlan: byComponent.get("config").snapshot,
      })
    : createWakeflowConfigV3ReconfigureMutationParticipant({
        workspaceRoot,
        desiredModel,
        confirmedPlan: byComponent.get("config").snapshot,
      });
  const definitions = [
    ["config", configParticipant],
    ["support-surface", createWakeflowSupportSurfaceMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      layoutDescriptor: descriptor,
      hostProfile: claudeHostProfile,
      confirmedPlan: supportPlan,
    })],
    ["ledger-layout", createWakeflowLedgerMaterializationMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      confirmedPlan: byComponent.get("ledger-layout").snapshot,
    })],
    ["ignore", createWakeflowManagedContentMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      hostProfile: claudeHostProfile,
      authorizedRepositoryIds,
      plannedSupportSurfaceIds: supportPlan.payload.plannedSupportSurfaceIds,
      confirmedPlan: managedPlan,
    })],
    ["active-layout", createWakeflowActiveFoundationMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      confirmedPlan: byComponent.get("active-layout").snapshot,
    })],
    ["active-projection", createWakeflowActiveProjectionMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      bundle,
      language: "zh",
      confirmedPlan: byComponent.get("active-projection").snapshot,
    })],
    ["window-runtime-projection", createWindowRuntimeProjectionMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      hostProfile: claudeHostProfile,
      confirmedPlan: byComponent.get("window-runtime-projection").snapshot,
    })],
    ["host-settings-assets", createWakeflowHostSettingsAssetsOwnerMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      hostProfile: claudeHostProfile,
      authorizedRepositoryIds,
      localPlan,
      supportPlan,
      managedPlan,
      adapter: hostAdapter,
      confirmedPlan: byComponent.get("host-settings-assets").snapshot,
    })],
  ];
  if (localPlan !== null) {
    definitions.push(["local-layout", createWakeflowLocalLayoutMutationParticipant({
      workspaceRoot,
      confirmedPlan: localPlan,
      model: desiredModel,
      layoutDescriptor: descriptor,
      hostProfile: claudeHostProfile,
    })]);
  }
  return definitions.map(([componentId, participant]) => ({
    snapshotDigest: byComponent.get(componentId).snapshotDigest,
    participant,
  }));
}

async function runCrashProducer(workspaceRoot) {
  const desiredModel = parseWakeflowConfigV3(structuredClone(fixture));
  const input = planningInput(workspaceRoot, desiredModel);
  const actionPlan = planWakeflowFreshInitializeBackbone(input).confirmedActionPlan;
  const participant = createWakeflowMaintenanceActionMutationParticipant({
    workspaceRoot,
    admission: "apply",
    confirmedActionPlan: actionPlan,
    ownerParticipants: actionOwnerParticipants({ workspaceRoot, desiredModel, actionPlan }),
    replan: () => planWakeflowFreshInitializeBackbone(input).confirmedActionPlan,
  });
  const hostStepId = snapshots(actionPlan).get("host-settings-assets").snapshot.payload.steps[0].stepId;
  const hostHandler = participant.stepHandlers[hostStepId];
  await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "fresh-initialize",
    operationKind: "fresh-initialize-v3",
    domainOwner: "maintenance-action-coordinator",
    confirmedPlan: actionPlan.payload.aggregatePlan,
    planDigest: actionPlan.payload.aggregatePlanDigest,
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: {
      ...participant.stepHandlers,
      [hostStepId]: {
        ...hostHandler,
        async commit(value) {
          await hostHandler.commit(value);
          process.kill(process.pid, "SIGKILL");
        },
      },
    },
  });
  throw new Error("SIGKILL producer unexpectedly completed");
}

if (crashWorkspaceRoot !== null) await runCrashProducer(crashWorkspaceRoot);

test("T08 Claude settings/assets joins the exact fresh M3 transaction", async (t) => {
  const { workspaceRoot, productRoot } = workspace(t);
  const desiredModel = parseWakeflowConfigV3(structuredClone(fixture));
  const input = planningInput(workspaceRoot, desiredModel);
  const backbone = planWakeflowFreshInitializeBackbone(input);
  assert.equal(backbone.status, "ready", JSON.stringify(backbone.blockers));
  assert.equal(backbone.ownerGraph.find((entry) => entry.componentId === "host-settings-assets")?.availability, "available");
  assert.equal(JSON.stringify(backbone).includes(workspaceRoot), false);

  const actionPlan = backbone.confirmedActionPlan;
  const actionHandlers = createWakeflowMaintenanceActionHandlers({
    hostProfile: claudeHostProfile,
    bundle,
    hostSettingsAssetsAdapter: hostAdapter,
    uuidFactory: randomUUID,
  });
  const result = await actionHandlers["fresh-initialize"].apply({
    root: workspaceRoot,
    confirmedPlan: actionPlan,
    planDigest: canonicalJsonDigest(actionPlan),
  });
  assert.equal(result.status, "completed");

  for (const root of [workspaceRoot, path.join(workspaceRoot, "Design"), path.join(workspaceRoot, "Test")]) {
    assert.equal(existsSync(path.join(root, ".claude/settings.json")), true, root);
    assert.equal(existsSync(path.join(root, ".claude/settings.local.json")), true, root);
  }
  assert.equal(
    existsSync(path.join(workspaceRoot, ".wakeflow-local/runtime/hosts/claude-code/operations/assets/statusline.mjs")),
    true,
  );
  assert.equal(existsSync(path.join(productRoot, ".claude")), false);

  const reconcile = planWakeflowReconcileBackbone({
    workspaceRoot,
    hostProfile: claudeHostProfile,
    bundle,
    language: "zh",
    authorizedRepositoryIds: [],
    hostSettingsAssetsAdapter: hostAdapter,
  });
  assert.equal(reconcile.status, "ready", JSON.stringify(reconcile.blockers));
  assert.equal(reconcile.confirmedActionPlan.payload.aggregatePlan.payload.steps.length, 0);

  const reconfigure = planWakeflowReconfigureBackbone({
    workspaceRoot,
    desiredModel,
    hostProfile: claudeHostProfile,
    bundle,
    language: "zh",
    authorizedRepositoryIds: [],
    hostSettingsAssetsAdapter: hostAdapter,
  });
  assert.equal(reconfigure.status, "ready", JSON.stringify(reconfigure.blockers));
  assert.equal(reconfigure.confirmedActionPlan.payload.aggregatePlan.payload.steps.length, 0);

  const repositoryId = desiredModel.topology.repositories[0].repositoryId;
  const authorizedRepositoryIds = [repositoryId];
  const authorized = planWakeflowReconfigureBackbone({
    workspaceRoot,
    desiredModel,
    hostProfile: claudeHostProfile,
    bundle,
    language: "zh",
    authorizedRepositoryIds,
    hostSettingsAssetsAdapter: hostAdapter,
  });
  assert.equal(authorized.status, "ready", JSON.stringify(authorized.blockers));
  assert.equal(authorized.confirmedActionPlan.payload.aggregatePlan.payload.steps.length > 0, true);
  const authorizedResult = await actionHandlers.reconfigure.apply({
    root: workspaceRoot,
    confirmedPlan: authorized.confirmedActionPlan,
    planDigest: canonicalJsonDigest(authorized.confirmedActionPlan),
  });
  assert.equal(authorizedResult.status, "completed");
  assert.equal(existsSync(path.join(productRoot, ".claude/settings.json")), true);
  assert.equal(existsSync(path.join(productRoot, ".claude/settings.local.json")), true);
  assert.equal(
    planWakeflowReconcileBackbone({
      workspaceRoot,
      hostProfile: claudeHostProfile,
      bundle,
      language: "zh",
      authorizedRepositoryIds,
      hostSettingsAssetsAdapter: hostAdapter,
    }).confirmedActionPlan.payload.aggregatePlan.payload.steps.length,
    0,
  );
});

test("T08 Claude composed recovery consumes the original confirmed owner snapshots", {
  skip: !new Set(["darwin", "linux"]).has(process.platform)
    ? "M3 process-identity recovery is supported on Darwin and Linux"
    : false,
  timeout: 120_000,
}, async (t) => {
  const { workspaceRoot } = workspace(t);
  const desiredModel = parseWakeflowConfigV3(structuredClone(fixture));
  const input = planningInput(workspaceRoot, desiredModel);
  const actionPlan = planWakeflowFreshInitializeBackbone(input).confirmedActionPlan;
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    env: {
      ...process.env,
      WAKEFLOW_CLAUDE_COMPOSITION_CRASH_ROOT: workspaceRoot,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let childError = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { childError += chunk; });
  const [exitCode, signal] = await once(child, "exit");
  assert.equal(exitCode, null, childError);
  assert.equal(signal, "SIGKILL", childError);

  const transactionRoot = path.join(
    workspaceRoot,
    ".wakeflow-local/runtime/maintenance/transactions",
  );
  const journalName = readdirSync(transactionRoot).find((name) => (
    /^workspace-mutation_[0-9a-f-]+\.json$/u.test(name)
  ));
  assert.equal(typeof journalName, "string");
  const operationId = journalName.slice(0, -".json".length);
  const actionHandlers = createWakeflowMaintenanceActionHandlers({
    hostProfile: claudeHostProfile,
    bundle,
    hostSettingsAssetsAdapter: hostAdapter,
    uuidFactory: randomUUID,
  });
  const recovered = await actionHandlers["fresh-initialize"].recover({
    root: workspaceRoot,
    operationId,
    confirmedPlan: actionPlan,
    planDigest: canonicalJsonDigest(actionPlan),
  });
  assert.equal(recovered.status, "recovered");
  assert.deepEqual(readdirSync(transactionRoot), []);
  assert.equal(
    planWakeflowReconcileBackbone({
      workspaceRoot,
      hostProfile: claudeHostProfile,
      bundle,
      language: "zh",
      authorizedRepositoryIds: [],
      hostSettingsAssetsAdapter: hostAdapter,
    }).confirmedActionPlan.payload.aggregatePlan.payload.steps.length,
    0,
  );
});
