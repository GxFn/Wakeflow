import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  inspectWakeflowArtifactTree,
} from "../../core/scripts/lib/wakeflow-artifact-tree-identity.mjs";
import {
  WAKEFLOW_CONFIG_V3_KIND,
  WAKEFLOW_CONFIG_V3_SCHEMA_ID,
  WAKEFLOW_CONFIG_V3_VERSION,
} from "../../core/scripts/lib/wakeflow-config-v3.mjs";
import {
  inspectWakeflowMigrationInventory,
} from "../../core/scripts/lib/wakeflow-migration-inventory.mjs";
import {
  planWakeflowMigrationPreview,
} from "../../core/scripts/lib/wakeflow-migration-plan.mjs";

export const MIGRATION_FIXTURE_IDS = Object.freeze({
  controllerWindow: "window_55555555-5555-4555-8555-555555555555",
  designSurface: "surface_33333333-3333-4333-8333-333333333333",
  designWindow: "window_66666666-6666-4666-8666-666666666666",
  productWindow: "window_88888888-8888-4888-8888-888888888888",
  program: "program_11111111-1111-4111-8111-111111111111",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  testSurface: "surface_44444444-4444-4444-8444-444444444444",
  testWindow: "window_77777777-7777-4777-8777-777777777777",
});

export function migrationFixtureDesiredModel() {
  return {
    $schema: WAKEFLOW_CONFIG_V3_SCHEMA_ID,
    kind: WAKEFLOW_CONFIG_V3_KIND,
    schemaVersion: WAKEFLOW_CONFIG_V3_VERSION,
    program: {
      programId: MIGRATION_FIXTURE_IDS.program,
      displayName: "WakeflowFixture",
      interfaceLanguage: "en",
    },
    topology: {
      repositories: [{
        repositoryId: MIGRATION_FIXTURE_IDS.repository,
        path: "../ProductWorkspace",
        displayName: "ProductWindow",
        description: "Migration fixture product repository.",
        instructionManagement: "managed-block",
      }],
      supportSurfaces: [{
        surfaceId: MIGRATION_FIXTURE_IDS.designSurface,
        capability: "design",
        path: "Design",
        displayName: "Design",
        ownership: "wakeflow-managed",
      }, {
        surfaceId: MIGRATION_FIXTURE_IDS.testSurface,
        capability: "test",
        path: "Test",
        displayName: "Test",
        ownership: "wakeflow-managed",
      }],
      windows: [{
        windowId: MIGRATION_FIXTURE_IDS.controllerWindow,
        role: "controller",
        displayName: "WakeflowFixture",
        root: { kind: "program" },
      }, {
        windowId: MIGRATION_FIXTURE_IDS.designWindow,
        role: "design",
        displayName: "Design",
        root: { kind: "support-surface", surfaceId: MIGRATION_FIXTURE_IDS.designSurface },
      }, {
        windowId: MIGRATION_FIXTURE_IDS.testWindow,
        role: "test",
        displayName: "Test",
        root: { kind: "support-surface", surfaceId: MIGRATION_FIXTURE_IDS.testSurface },
      }, {
        windowId: MIGRATION_FIXTURE_IDS.productWindow,
        role: "product",
        displayName: "ProductWindow",
        root: { kind: "repository", repositoryId: MIGRATION_FIXTURE_IDS.repository },
      }],
    },
    storage: { ledgerRoot: "wakeflow-ledger" },
    governance: {
      validation: {
        runtimeResidue: {
          label: "configured",
          matchers: [{ kind: "substring", value: "wakeflow" }],
        },
      },
    },
    hosts: {},
  };
}

function artifactIdentity(name) {
  const root = mkdtempSync(path.join(os.tmpdir(), `wakeflow-${name}-`));
  writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name, private: true })}\n`);
  writeFileSync(path.join(root, "entry.mjs"), "export const ready = true;\n", { mode: 0o755 });
  return { identity: inspectWakeflowArtifactTree({ artifactRoot: root }), root };
}

function slotEvidence(source, slotIds) {
  const byId = new Map(source.classification.typedSlots.map((slot) => [slot.id, slot]));
  return slotIds.map((slotId) => {
    const slot = byId.get(slotId);
    if (!slot) throw new Error(`missing migration fixture slot ${slotId}`);
    return { slotId, valueDigest: slot.valueDigest };
  });
}

function identityMappings(inventory, model) {
  const config = inventory.configSources.find((entry) => entry.scope === "durable");
  const source = inventory.sources.find((entry) => entry.sourceId === config?.sourceId);
  if (!source?.classification) throw new Error("migration fixture requires one classified durable config");
  const available = new Set(source.classification.typedSlots.map((slot) => slot.id));
  const first = (...slotIds) => {
    const selected = slotIds.find((slotId) => available.has(slotId));
    if (!selected) throw new Error(`missing migration fixture slot ${slotIds.join(" or ")}`);
    return selected;
  };
  return [
    ["program", model.program.programId, [first("config$.workspace.name", "config$.workspaceName")]],
    ["repository", model.topology.repositories[0].repositoryId, ["config$.repositories.0.path", "config$.repositories.0.windowName"]],
    ["surface", model.topology.supportSurfaces[0].surfaceId, ["config$.repositories.1.path", first("config$.roles.design", "config$.designWindow")]],
    ["surface", model.topology.supportSurfaces[1].surfaceId, ["config$.repositories.2.path", first("config$.roles.test", "config$.testWindow")]],
    ["window", model.topology.windows[0].windowId, [first("config$.roles.controller", "config$.controllerWindow")]],
    ["window", model.topology.windows[1].windowId, [first("config$.roles.design", "config$.designWindow")]],
    ["window", model.topology.windows[2].windowId, [first("config$.roles.test", "config$.testWindow")]],
    ["window", model.topology.windows[3].windowId, ["config$.repositories.0.windowName"]],
  ].map(([entityType, targetId, slots]) => ({
    entityType,
    sourceId: source.sourceId,
    slots: slotEvidence(source, slots).sort((left, right) => left.slotId.localeCompare(right.slotId)),
    targetId,
  })).sort((left, right) => left.entityType.localeCompare(right.entityType) || left.targetId.localeCompare(right.targetId));
}

function rootTarget(root) {
  if (root.rootKind.includes("old-")) return { kind: "none", targetId: null };
  if (root.rootKind.includes("active-root")) return { kind: "active", targetId: null };
  if (root.rootKind.includes("local-root")) return { kind: "local", targetId: null };
  if (root.rootKind.includes("ledger")) return { kind: "ledger", targetId: null };
  if (root.surfaceKind === "design-support") return { kind: "surface", targetId: MIGRATION_FIXTURE_IDS.designSurface };
  if (root.surfaceKind === "test-support") return { kind: "surface", targetId: MIGRATION_FIXTURE_IDS.testSurface };
  if (root.surfaceKind === "product-repository") return { kind: "repository", targetId: MIGRATION_FIXTURE_IDS.repository };
  return { kind: "program", targetId: MIGRATION_FIXTURE_IDS.program };
}

export function createMigrationFixturePlan({
  bootstrapArtifactRoot = null,
  hostProfile,
  legacyOwnerArtifact = null,
  legacyOwnerArtifactRoot = null,
  workspaceRoot,
  onCleanup = () => {},
}) {
  if (legacyOwnerArtifact !== null && legacyOwnerArtifactRoot !== null) {
    throw new Error("migration fixture accepts legacyOwnerArtifact or legacyOwnerArtifactRoot, not both");
  }
  const bootstrap = bootstrapArtifactRoot === null
    ? artifactIdentity("migration-bootstrap")
    : { identity: inspectWakeflowArtifactTree({ artifactRoot: bootstrapArtifactRoot }), root: null };
  const legacy = legacyOwnerArtifact !== null
    ? { identity: legacyOwnerArtifact, root: null }
    : legacyOwnerArtifactRoot === null
      ? artifactIdentity("migration-legacy-owner")
      : { identity: inspectWakeflowArtifactTree({ artifactRoot: legacyOwnerArtifactRoot }), root: null };
  if (bootstrap.root !== null) onCleanup(() => rmSync(bootstrap.root, { recursive: true, force: true }));
  if (legacy.root !== null) onCleanup(() => rmSync(legacy.root, { recursive: true, force: true }));
  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot });
  const desiredModel = migrationFixtureDesiredModel();
  return planWakeflowMigrationPreview({
    artifactContext: {
      bootstrapArtifact: bootstrap.identity,
      legacyOwnerArtifact: legacy.identity,
    },
    desiredModel,
    hostProfile,
    identityMappings: identityMappings(inventory, desiredModel),
    rootMappings: inventory.roots.map((root) => ({
      rootId: root.rootId,
      target: rootTarget(root),
    })).sort((left, right) => left.rootId.localeCompare(right.rootId)),
    workspaceRoot,
    legacyArchiveTransformResolution: null,
  });
}
