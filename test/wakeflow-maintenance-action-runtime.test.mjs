import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  loadWakeflowConfigV3Snapshot,
} from "../core/scripts/lib/wakeflow-config-v3-snapshot.mjs";
import { hostProfile } from "../core/scripts/lib/wakeflow-host-profile.mjs";
import {
  hostProfile as claudeHostProfile,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  createWakeflowConfirmedActionPlan,
} from "../core/scripts/lib/wakeflow-maintenance-action-composition.mjs";
import {
  createWakeflowMaintenanceActionHandlers,
} from "../core/scripts/lib/wakeflow-maintenance-action-runtime.mjs";
import {
  createWakeflowMaintenanceCoordinator,
} from "../core/scripts/lib/wakeflow-maintenance-coordinator.mjs";
import { parseWakeflowAssetBundle } from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import { buildWakeflowAssetBundle } from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({
  sourceRoot: path.join(repositoryRoot, "core/template-sources"),
}));

const UUIDS = Object.freeze([
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
]);

function selection() {
  return {
    program: {
      displayName: "Runtime Candidate",
      interfaceLanguage: "zh",
    },
    topology: {
      repositories: [{
        selectionKey: "product-a",
        path: "../ProductA",
        displayName: "Product A",
        instructionManagement: "owner-managed",
      }],
      supportSurfaces: [{
        selectionKey: "design-surface",
        capability: "design",
        path: "Design",
        displayName: "Design",
        ownership: "wakeflow-managed",
      }, {
        selectionKey: "test-surface",
        capability: "test",
        path: "Test",
        displayName: "Test",
        ownership: "wakeflow-managed",
      }],
      windows: [{
        role: "controller",
        displayName: "Controller",
        root: { kind: "program" },
      }, {
        role: "design",
        displayName: "Design",
        root: { kind: "support-surface", selectionKey: "design-surface" },
      }, {
        role: "test",
        displayName: "Test",
        root: { kind: "support-surface", selectionKey: "test-surface" },
      }, {
        role: "product",
        displayName: "Product A",
        root: { kind: "repository", selectionKey: "product-a" },
      }],
    },
    storage: { ledgerRoot: "../wakeflow-ledger" },
    governance: {},
    hosts: {},
  };
}

function physicalWorkspace(base, name) {
  const parent = path.join(base, name);
  const root = path.join(parent, "Program");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(path.join(parent, "ProductA"), { recursive: true, mode: 0o755 });
  return root;
}

function runtime(t) {
  let cursor = 0;
  const handlers = createWakeflowMaintenanceActionHandlers({
    hostProfile,
    bundle,
    hostSettingsAssetsAdapter: null,
    uuidFactory: () => UUIDS[cursor++],
  });
  t.after(() => assert.equal(cursor, UUIDS.length));
  return createWakeflowMaintenanceCoordinator({ actionHandlers: handlers });
}

test("T09 production runtime applies one portable confirmed plan only through the exact target root", async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-action-runtime-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const previewRoot = physicalWorkspace(base, "preview");
  const equivalentRoot = physicalWorkspace(base, "equivalent");
  const staleRoot = physicalWorkspace(base, "stale");
  writeFileSync(path.join(staleRoot, "user-owned.txt"), "preserve\n", { mode: 0o600 });
  mkdirSync(path.join(staleRoot, ".wakeflow-active"), { mode: 0o700 });
  writeFileSync(
    path.join(staleRoot, ".wakeflow-active", "index.md"),
    "unowned active residue\n",
    { mode: 0o600 },
  );

  const coordinator = runtime(t);
  const preview = await coordinator.execute({
    root: previewRoot,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selection(), language: "zh" },
  });
  assert.equal(preview.result.status, "ready", JSON.stringify(preview.result.blockers));
  assert.equal(preview.result.confirmedActionPlan.payload.action, "fresh-initialize");
  assert.equal(JSON.stringify(preview).includes(previewRoot), false);
  assert.equal(JSON.stringify(preview).includes(equivalentRoot), false);
  assert.equal(existsSync(path.join(previewRoot, "wakeflow.config.json")), false);

  const confirmedPlan = preview.result.confirmedActionPlan;
  const aggregateWithUnknownAlias = structuredClone(confirmedPlan.payload.aggregatePlan);
  const knownAliasComponent = aggregateWithUnknownAlias.payload.components.find(
    (entry) => entry.componentId === "ledger-projection",
  );
  aggregateWithUnknownAlias.payload.components.push({
    ...knownAliasComponent,
    componentId: "unknown-owner-alias",
    owner: "unknown-owner",
  });
  aggregateWithUnknownAlias.payload.components.sort((left, right) => (
    left.componentId < right.componentId ? -1 : left.componentId > right.componentId ? 1 : 0
  ));
  const knownAliasSnapshot = confirmedPlan.payload.ownerSnapshots.find(
    (entry) => entry.componentId === "ledger-projection",
  );
  const planWithUnknownAlias = createWakeflowConfirmedActionPlan({
    aggregatePlan: aggregateWithUnknownAlias,
    ownerSnapshots: [
      ...confirmedPlan.payload.ownerSnapshots.map(({ componentId, owner, snapshot }) => ({
        componentId,
        owner,
        snapshot,
      })),
      {
        componentId: "unknown-owner-alias",
        owner: "unknown-owner",
        snapshot: knownAliasSnapshot.snapshot,
      },
    ],
  });
  await assert.rejects(
    () => coordinator.execute({
      root: equivalentRoot,
      action: "fresh-initialize",
      mode: "apply",
      confirmedPlan: planWithUnknownAlias,
      planDigest: canonicalJsonDigest(planWithUnknownAlias),
    }),
    (error) => error?.code === "wakeflow-maintenance-action-failed"
      && error?.cause?.code === "wakeflow-maintenance-runtime-owner",
  );
  assert.equal(existsSync(path.join(equivalentRoot, "wakeflow.config.json")), false);

  const applied = await coordinator.execute({
    root: equivalentRoot,
    action: "fresh-initialize",
    mode: "apply",
    confirmedPlan,
    planDigest: canonicalJsonDigest(confirmedPlan),
  });
  assert.equal(applied.result.status, "completed");
  assert.equal(existsSync(path.join(equivalentRoot, "wakeflow.config.json")), true);
  assert.equal(existsSync(path.join(previewRoot, "wakeflow.config.json")), false);
  assert.equal(JSON.stringify(applied).includes(equivalentRoot), false);

  await assert.rejects(
    () => coordinator.execute({
      root: staleRoot,
      action: "fresh-initialize",
      mode: "apply",
      confirmedPlan,
      planDigest: canonicalJsonDigest(confirmedPlan),
    }),
    (error) => error?.code === "wakeflow-maintenance-action-failed",
  );
  assert.equal(existsSync(path.join(staleRoot, "wakeflow.config.json")), false);
  assert.equal(readFileSync(path.join(staleRoot, "user-owned.txt"), "utf8"), "preserve\n");

  const reconcile = await coordinator.execute({
    root: equivalentRoot,
    action: "reconcile",
    mode: "preview",
    request: { language: "zh", authorizedRepositoryIds: [] },
  });
  assert.equal(reconcile.result.status, "ready", JSON.stringify(reconcile.result.blockers));
  assert.equal(reconcile.result.confirmedActionPlan.payload.aggregatePlan.payload.steps.length, 0);
  const noOpPlan = reconcile.result.confirmedActionPlan;
  const noOp = await coordinator.execute({
    root: equivalentRoot,
    action: "reconcile",
    mode: "apply",
    confirmedPlan: noOpPlan,
    planDigest: canonicalJsonDigest(noOpPlan),
  });
  assert.equal(noOp.result.status, "no-op");

  const projectionRoot = path.join(
    equivalentRoot,
    ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
  );
  const missingProjectionName = readdirSync(projectionRoot)
    .filter((name) => name.endsWith(".json"))
    .sort()[0];
  const missingProjection = path.join(projectionRoot, missingProjectionName);
  const expectedProjectionBytes = readFileSync(missingProjection);
  unlinkSync(missingProjection);

  const repair = await coordinator.execute({
    root: equivalentRoot,
    action: "reconcile",
    mode: "preview",
    request: { language: "zh", authorizedRepositoryIds: [] },
  });
  assert.equal(repair.result.status, "ready", JSON.stringify(repair.result.blockers));
  assert.equal(repair.result.confirmedActionPlan.payload.aggregatePlan.payload.steps.length, 1);
  const repairPlan = repair.result.confirmedActionPlan;
  const repaired = await coordinator.execute({
    root: equivalentRoot,
    action: "reconcile",
    mode: "apply",
    confirmedPlan: repairPlan,
    planDigest: canonicalJsonDigest(repairPlan),
  });
  assert.equal(repaired.result.status, "completed");
  assert.deepEqual(readFileSync(missingProjection), expectedProjectionBytes);
  assert.deepEqual(
    readdirSync(projectionRoot).filter((name) => name.includes(".wakeflow-maintenance-")),
    [],
  );
  assert.deepEqual(
    readdirSync(path.join(equivalentRoot, ".wakeflow-local/runtime/maintenance/transactions")),
    [],
  );

  const settledRepair = await coordinator.execute({
    root: equivalentRoot,
    action: "reconcile",
    mode: "preview",
    request: { language: "zh", authorizedRepositoryIds: [] },
  });
  assert.equal(settledRepair.result.status, "ready");
  assert.equal(settledRepair.result.confirmedActionPlan.payload.aggregatePlan.payload.steps.length, 0);

  const beforeMetadata = loadWakeflowConfigV3Snapshot({ workspaceRoot: equivalentRoot });
  const desiredModel = structuredClone(beforeMetadata.model);
  desiredModel.program.displayName = "Runtime Candidate Renamed";
  desiredModel.topology.repositories[0].displayName = "Product A Renamed";
  desiredModel.topology.windows.find((entry) => entry.role === "product").displayName = "Product A Renamed";
  const metadataPreview = await coordinator.execute({
    root: equivalentRoot,
    action: "reconfigure",
    mode: "preview",
    request: { desiredModel, language: "zh", authorizedRepositoryIds: [] },
  });
  assert.equal(
    metadataPreview.result.status,
    "ready",
    JSON.stringify(metadataPreview.result.blockers),
  );
  const metadataPlan = metadataPreview.result.confirmedActionPlan;
  const metadataApplied = await coordinator.execute({
    root: equivalentRoot,
    action: "reconfigure",
    mode: "apply",
    confirmedPlan: metadataPlan,
    planDigest: canonicalJsonDigest(metadataPlan),
  });
  assert.equal(metadataApplied.result.status, "completed");
  const afterMetadata = loadWakeflowConfigV3Snapshot({ workspaceRoot: equivalentRoot });
  assert.deepEqual(
    afterMetadata.model.topology.repositories.map((entry) => entry.repositoryId),
    beforeMetadata.model.topology.repositories.map((entry) => entry.repositoryId),
  );
  assert.deepEqual(
    afterMetadata.model.topology.windows.map((entry) => entry.windowId),
    beforeMetadata.model.topology.windows.map((entry) => entry.windowId),
  );
  assert.equal(afterMetadata.model.program.displayName, "Runtime Candidate Renamed");
  assert.equal(afterMetadata.model.topology.repositories[0].displayName, "Product A Renamed");

  const settledMetadata = await coordinator.execute({
    root: equivalentRoot,
    action: "reconcile",
    mode: "preview",
    request: { language: "zh", authorizedRepositoryIds: [] },
  });
  assert.equal(settledMetadata.result.status, "ready");
  assert.equal(settledMetadata.result.confirmedActionPlan.payload.aggregatePlan.payload.steps.length, 0);
  assert.deepEqual(
    [
      ...readdirSync(path.join(equivalentRoot, ".wakeflow-active")),
      ...readdirSync(path.join(equivalentRoot, ".wakeflow-active/current")),
    ].filter((name) => name.includes(".wakeflow-maintenance-")),
    [],
  );
  assert.deepEqual(
    readdirSync(path.join(equivalentRoot, ".wakeflow-local/runtime/maintenance/transactions")),
    [],
  );
});

test("T09 action validators keep all three preview branches closed before planning", async () => {
  let cursor = 0;
  const handlers = createWakeflowMaintenanceActionHandlers({
    hostProfile,
    bundle,
    hostSettingsAssetsAdapter: null,
    uuidFactory: () => UUIDS[cursor++],
  });
  await assert.rejects(
    () => handlers["fresh-initialize"].validatePreviewRequest({
      request: { selection: selection(), language: "auto" },
    }),
    /language|en|zh/iu,
  );
  await assert.rejects(
    () => handlers.reconcile.validatePreviewRequest({
      request: { language: "zh", authorizedRepositoryIds: [], repair: true },
    }),
    /field|contract|request/iu,
  );
  await assert.rejects(
    () => handlers.reconfigure.validatePreviewRequest({
      request: {
        desiredModel: {},
        language: "zh",
        authorizedRepositoryIds: [
          "repository_22222222-2222-4222-8222-222222222222",
          "repository_11111111-1111-4111-8111-111111111111",
        ],
      },
    }),
    /config|repository|authorization|model/iu,
  );
  assert.equal(cursor, 0, "validation must not consume the runtime UUID source");
  assert.throws(
    () => createWakeflowMaintenanceActionHandlers({
      hostProfile,
      bundle,
      hostSettingsAssetsAdapter: {
        hostId: "claude-code",
        planMaintenance() {},
        createMutationParticipant() {},
      },
      uuidFactory: () => UUIDS[0],
    }),
    (error) => error?.code === "wakeflow-maintenance-runtime-host",
  );
  assert.throws(
    () => createWakeflowMaintenanceActionHandlers({
      hostProfile: claudeHostProfile,
      bundle,
      hostSettingsAssetsAdapter: null,
      uuidFactory: () => UUIDS[0],
    }),
    (error) => error?.code === "wakeflow-maintenance-runtime-host",
  );
});

test("T09 action runtime rejects a mutable full host profile", () => {
  const mutableProfile = structuredClone(hostProfile);
  assert.throws(
    () => createWakeflowMaintenanceActionHandlers({
      hostProfile: mutableProfile,
      bundle,
      hostSettingsAssetsAdapter: null,
      uuidFactory: () => UUIDS[0],
    }),
    (error) => error?.code === "wakeflow-maintenance-runtime-host",
  );
});

test("T09 action runtime rejects a mutable settings/assets adapter", () => {
  const mutableAdapter = {
    hostId: "claude-code",
    planMaintenance() {},
    createMutationParticipant() {},
  };
  assert.throws(
    () => createWakeflowMaintenanceActionHandlers({
      hostProfile: claudeHostProfile,
      bundle,
      hostSettingsAssetsAdapter: mutableAdapter,
      uuidFactory: () => UUIDS[0],
    }),
    (error) => error?.code === "wakeflow-maintenance-runtime-host",
  );
});

test("T09 action runtime rejects a frozen but widened settings/assets adapter", () => {
  const widenedAdapter = Object.freeze({
    hostId: "claude-code",
    planMaintenance() {},
    createMutationParticipant() {},
    hiddenAuthority() {},
  });
  assert.throws(
    () => createWakeflowMaintenanceActionHandlers({
      hostProfile: claudeHostProfile,
      bundle,
      hostSettingsAssetsAdapter: widenedAdapter,
      uuidFactory: () => UUIDS[0],
    }),
    (error) => error?.code === "wakeflow-maintenance-runtime-host",
  );
});

test("T09 action runtime rejects adapter accessors without invoking them", () => {
  let getterCalls = 0;
  const accessorAdapter = {
    planMaintenance() {},
    createMutationParticipant() {},
  };
  Object.defineProperty(accessorAdapter, "hostId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "claude-code";
    },
  });
  Object.freeze(accessorAdapter);
  assert.throws(
    () => createWakeflowMaintenanceActionHandlers({
      hostProfile: claudeHostProfile,
      bundle,
      hostSettingsAssetsAdapter: accessorAdapter,
      uuidFactory: () => UUIDS[0],
    }),
    (error) => error?.code === "wakeflow-maintenance-runtime-host",
  );
  assert.equal(getterCalls, 0);
});
