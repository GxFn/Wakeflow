import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hostProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  WAKEFLOW_CONFIG_V3_KIND,
  WAKEFLOW_CONFIG_V3_SCHEMA_ID,
  WAKEFLOW_CONFIG_V3_VERSION,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { inspectWakeflowArtifactTree } from "../core/scripts/lib/wakeflow-artifact-tree-identity.mjs";
import { inspectWakeflowMigrationInventory } from "../core/scripts/lib/wakeflow-migration-inventory.mjs";
import {
  WAKEFLOW_MIGRATION_PLAN_ACTIONS,
  WAKEFLOW_MIGRATION_PLAN_KIND,
  WAKEFLOW_MIGRATION_PLAN_SCHEMA_VERSION,
  WakeflowMigrationPlanError,
  isWakeflowMigrationPlanApplicable,
  planWakeflowMigrationPreview,
  validateWakeflowMigrationPlan,
  wakeflowMigrationPlanDigest,
} from "../core/scripts/lib/wakeflow-migration-plan.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const CURRENT_WORKSPACE = path.join(
  REPOSITORY_ROOT,
  "test/fixtures/legacy-origins/codex-0.9.6-70d79d72/static/shared-setup/WakeflowFixture",
);
const OLD_ROOT_WORKSPACE = path.join(
  REPOSITORY_ROOT,
  "test/fixtures/legacy-origins/codex-0.5.8-9564a798/static/shared-setup/WakeflowFixture",
);

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  designSurface: "surface_33333333-3333-4333-8333-333333333333",
  testSurface: "surface_44444444-4444-4444-8444-444444444444",
  controllerWindow: "window_55555555-5555-4555-8555-555555555555",
  designWindow: "window_66666666-6666-4666-8666-666666666666",
  testWindow: "window_77777777-7777-4777-8777-777777777777",
  productWindow: "window_88888888-8888-4888-8888-888888888888",
});

function desiredModel(overrides = {}) {
  const value = {
    $schema: WAKEFLOW_CONFIG_V3_SCHEMA_ID,
    kind: WAKEFLOW_CONFIG_V3_KIND,
    schemaVersion: WAKEFLOW_CONFIG_V3_VERSION,
    program: {
      programId: IDS.program,
      displayName: "WakeflowFixture",
      interfaceLanguage: "en",
    },
    topology: {
      repositories: [{
        repositoryId: IDS.repository,
        path: "../ProductWorkspace",
        displayName: "ProductWindow",
        description: "Project repository; confirm scope and responsibility before enabling.",
        instructionManagement: "managed-block",
      }],
      supportSurfaces: [{
        surfaceId: IDS.designSurface,
        capability: "design",
        path: "Design",
        displayName: "Design",
        ownership: "wakeflow-managed",
      }, {
        surfaceId: IDS.testSurface,
        capability: "test",
        path: "Test",
        displayName: "Test",
        ownership: "wakeflow-managed",
      }],
      windows: [{
        windowId: IDS.controllerWindow,
        role: "controller",
        displayName: "WakeflowFixture",
        root: { kind: "program" },
      }, {
        windowId: IDS.designWindow,
        role: "design",
        displayName: "Design",
        root: { kind: "support-surface", surfaceId: IDS.designSurface },
      }, {
        windowId: IDS.testWindow,
        role: "test",
        displayName: "Test",
        root: { kind: "support-surface", surfaceId: IDS.testSurface },
      }, {
        windowId: IDS.productWindow,
        role: "product",
        displayName: "ProductWindow",
        root: { kind: "repository", repositoryId: IDS.repository },
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
  return Object.assign(value, overrides);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function exactTree(root) {
  const entries = [];
  function walk(file, ref) {
    const stat = lstatSync(file);
    const type = stat.isDirectory()
      ? "directory"
      : stat.isFile()
        ? "file"
        : stat.isSymbolicLink()
          ? "symlink"
          : "special";
    const digest = type === "file"
      ? sha256(readFileSync(file))
      : type === "symlink"
        ? sha256(Buffer.from(readlinkSync(file), "utf8"))
        : null;
    entries.push({ ref, type, mode: stat.mode & 0o777, size: stat.size, digest });
    if (type !== "directory") return;
    for (const name of readdirSync(file).sort()) {
      walk(path.join(file, name), ref ? `${ref}/${name}` : name);
    }
  }
  walk(root, "");
  return entries;
}

function artifactIdentity(t, name) {
  const root = mkdtempSync(path.join(os.tmpdir(), `wakeflow-migration-${name}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name, private: true })}\n`);
  writeFileSync(path.join(root, "entry.mjs"), "export const ready = true;\n", { mode: 0o755 });
  if (process.platform !== "win32") chmodSync(path.join(root, "entry.mjs"), 0o755);
  return inspectWakeflowArtifactTree({ artifactRoot: root });
}

function slotEvidence(source, slotIds) {
  const byId = new Map(source.classification.typedSlots.map((slot) => [slot.id, slot]));
  return slotIds.map((slotId) => {
    const slot = byId.get(slotId);
    assert.ok(slot, `missing fixture slot ${slotId}`);
    return { slotId, valueDigest: slot.valueDigest };
  });
}

function identityMappings(inventory, model) {
  const config = inventory.configSources.find((entry) => entry.scope === "durable");
  assert.ok(config);
  const source = inventory.sources.find((entry) => entry.sourceId === config.sourceId);
  assert.ok(source?.classification);
  const availableSlots = new Set(source.classification.typedSlots.map((slot) => slot.id));
  const firstAvailable = (...slotIds) => {
    const slotId = slotIds.find((candidate) => availableSlots.has(candidate));
    assert.ok(slotId, `missing fixture slots ${slotIds.join(" or ")}`);
    return slotId;
  };
  const entries = [
    ["program", model.program.programId, [firstAvailable("config$.workspace.name", "config$.workspaceName")]],
    ["repository", model.topology.repositories[0].repositoryId, [
      "config$.repositories.0.path",
      "config$.repositories.0.windowName",
    ]],
    ["surface", model.topology.supportSurfaces[0].surfaceId, [
      "config$.repositories.1.path",
      firstAvailable("config$.roles.design", "config$.designWindow"),
    ]],
    ["surface", model.topology.supportSurfaces[1].surfaceId, [
      "config$.repositories.2.path",
      firstAvailable("config$.roles.test", "config$.testWindow"),
    ]],
    ["window", model.topology.windows[0].windowId, [firstAvailable("config$.roles.controller", "config$.controllerWindow")]],
    ["window", model.topology.windows[1].windowId, [firstAvailable("config$.roles.design", "config$.designWindow")]],
    ["window", model.topology.windows[2].windowId, [firstAvailable("config$.roles.test", "config$.testWindow")]],
    ["window", model.topology.windows[3].windowId, ["config$.repositories.0.windowName"]],
  ];
  return entries.map(([entityType, targetId, slots]) => ({
    entityType,
    targetId,
    sourceId: source.sourceId,
    slots: slotEvidence(source, slots).sort((left, right) => left.slotId.localeCompare(right.slotId)),
  })).sort((left, right) => (
    left.entityType.localeCompare(right.entityType) || left.targetId.localeCompare(right.targetId)
  ));
}

function rootTarget(root) {
  if (root.rootKind.includes("old-")) return { kind: "none", targetId: null };
  if (root.rootKind.includes("active-root")) return { kind: "active", targetId: null };
  if (root.rootKind.includes("local-root")) return { kind: "local", targetId: null };
  if (root.rootKind.includes("ledger")) return { kind: "ledger", targetId: null };
  if (root.surfaceKind === "design-support") return { kind: "surface", targetId: IDS.designSurface };
  if (root.surfaceKind === "test-support") return { kind: "surface", targetId: IDS.testSurface };
  if (root.surfaceKind === "product-repository") return { kind: "repository", targetId: IDS.repository };
  return { kind: "program", targetId: IDS.program };
}

function rootMappings(inventory) {
  return inventory.roots.map((root) => ({
    rootId: root.rootId,
    target: rootTarget(root),
  })).sort((left, right) => left.rootId.localeCompare(right.rootId));
}

function previewInput(t, workspaceRoot, overrides = {}) {
  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot });
  const model = overrides.desiredModel ?? desiredModel();
  return {
    workspaceRoot,
    artifactContext: overrides.artifactContext ?? {
      bootstrapArtifact: artifactIdentity(t, "bootstrap-artifact"),
      legacyOwnerArtifact: artifactIdentity(t, "legacy-owner-artifact"),
    },
    desiredModel: model,
    identityMappings: overrides.identityMappings ?? identityMappings(inventory, model),
    rootMappings: overrides.rootMappings ?? rootMappings(inventory),
    hostProfile,
    legacyArchiveTransformResolution: overrides.legacyArchiveTransformResolution ?? null,
  };
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function resignPlan(value) {
  const plan = structuredClone(value);
  plan.planDigest = canonicalJsonDigest({ schemaId: plan.schemaId, payload: plan.payload });
  return plan;
}

test("M6-T05 exposes one closed canonical migration-plan surface", () => {
  assert.equal(WAKEFLOW_MIGRATION_PLAN_KIND, "WakeflowExplicitMigrationPlan");
  assert.equal(WAKEFLOW_MIGRATION_PLAN_SCHEMA_VERSION, 3);
  assert.deepEqual(WAKEFLOW_MIGRATION_PLAN_ACTIONS, ["keep", "manual", "remove", "transform"]);
});

test("preview is deterministic, deeply frozen, read-only, private-path clean, and self-validating", (t) => {
  const before = exactTree(CURRENT_WORKSPACE);
  const input = previewInput(t, CURRENT_WORKSPACE);
  const first = planWakeflowMigrationPreview(input);
  const second = planWakeflowMigrationPreview(input);

  assert.deepEqual(second, first);
  assert.deepEqual(validateWakeflowMigrationPlan(first), first);
  assert.equal(wakeflowMigrationPlanDigest(first), first.planDigest);
  assert.equal(isWakeflowMigrationPlanApplicable(first), false);
  assert.equal(first.payload.action, "explicit-migration");
  assert.equal(first.payload.status, "blocked");
  assert.equal(first.payload.inventory.sourceCount, 111);
  assert.equal(first.payload.sources.length, first.payload.inventory.sourceCount);
  assert.equal(first.payload.ownerDrain.artifact.legacyOwnerArtifactDigest,
    first.payload.artifacts.legacyOwnerArtifactDigest);
  assert.equal(first.payload.ownerDrain.inventory.inventoryDigest,
    first.payload.inventory.inventoryDigest);
  assert.equal(first.payload.ownerDrain.inventory.sourceCount,
    first.payload.inventory.sourceCount);
  assert.equal(first.payload.ownerDrain.summary.ownerDrainSatisfied, true);
  const ownerDrainDependencies = first.payload.dependencies.filter((entry) => entry.kind === "owner-drain");
  assert.ok(ownerDrainDependencies.length > 0);
  assert.ok(ownerDrainDependencies.every((entry) => (
    entry.status === "satisfied"
    && entry.evidenceDigest === first.payload.ownerDrain.assessmentDigest
  )));
  assert.ok(first.payload.blockers.every((entry) => (
    !ownerDrainDependencies.some((dependency) => dependency.dependencyId === entry.dependencyId)
  )));
  assert.equal(first.payload.identityMappings.length, 8);
  assert.equal(first.payload.rootMappings.length, first.payload.inventory.rootCount);
  assert.equal(first.payload.target.desiredModel.program.programId, IDS.program);
  assert.ok(first.payload.sources.some((source) => (
    source.units.some((unit) => unit.action === "transform" && unit.route === "schema-map")
  )));
  assert.ok(first.payload.sources.some((source) => source.units.some((unit) => unit.action === "remove")));
  assert.ok(first.payload.sources.some((source) => source.units.some((unit) => unit.action === "manual")));
  assert.ok(first.payload.decommissionCoverage.length > 0);
  assert.ok(first.payload.decommissionCoverage.every((entry) => entry.status === "required"));
  assert.deepEqual(first.payload.decommissionCoverage.map((entry) => entry.hostId), ["codex"]);
  assert.deepEqual(first.payload.commitPhases.map((entry) => entry.phase), [
    "target-authority",
    "archive-or-preservation",
    "managed-surfaces",
    "derived-projections",
    "exact-source-release",
  ]);
  assert.deepEqual(first.payload.recoveryPhases, first.payload.commitPhases.map((entry) => ({
    ...entry,
    strategy: "resume-forward",
  })));
  assertDeepFrozen(first);
  assert.deepEqual(exactTree(CURRENT_WORKSPACE), before);

  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes(CURRENT_WORKSPACE), false);
  assert.equal(serialized.includes(REPOSITORY_ROOT), false);
  assert.equal(serialized.includes("randomUUID"), false);
  assert.equal(serialized.includes("generatedAt"), false);
  assert.equal(serialized.includes("private-thread"), false);
});

test("opaque ID mappings are complete, slot-bound, and canonical while target config rejects cross-type UUID reuse", (t) => {
  const input = previewInput(t, CURRENT_WORKSPACE);
  assert.throws(
    () => planWakeflowMigrationPreview({
      ...input,
      identityMappings: input.identityMappings.slice(1),
    }),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-identity-mapping",
  );

  const stale = structuredClone(input.identityMappings);
  stale[0].slots[0].valueDigest = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => planWakeflowMigrationPreview({ ...input, identityMappings: stale }),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-identity-mapping",
  );

  const collisionModel = structuredClone(input.desiredModel);
  const collidingRepository = `repository_${IDS.program.slice("program_".length)}`;
  collisionModel.topology.repositories[0].repositoryId = collidingRepository;
  collisionModel.topology.windows[3].root.repositoryId = collidingRepository;
  const collisionMappings = structuredClone(input.identityMappings);
  const repositoryMapping = collisionMappings.find((entry) => entry.entityType === "repository");
  repositoryMapping.targetId = collidingRepository;
  collisionMappings.sort((left, right) => (
    left.entityType.localeCompare(right.entityType) || left.targetId.localeCompare(right.targetId)
  ));
  assert.throws(
    () => planWakeflowMigrationPreview({
      ...input,
      desiredModel: collisionModel,
      identityMappings: collisionMappings,
    }),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-target"
      && error.path === "$/desiredModel"
      && error.cause?.code === "wakeflow-identifier-uuid-collision",
  );

  const wrongSlotType = structuredClone(input.identityMappings);
  const programMapping = wrongSlotType.find((entry) => entry.entityType === "program");
  const repositoryMappingWithPath = wrongSlotType.find((entry) => entry.entityType === "repository");
  programMapping.slots = [repositoryMappingWithPath.slots.find((slot) => slot.slotId.endsWith(".path"))];
  assert.throws(
    () => planWakeflowMigrationPreview({ ...input, identityMappings: wrongSlotType }),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-identity-mapping"
      && error.message.includes("slot type"),
  );

  const decoratedMappings = structuredClone(input.identityMappings);
  Object.defineProperty(decoratedMappings, "hidden", { value: true });
  assert.throws(
    () => planWakeflowMigrationPreview({ ...input, identityMappings: decoratedMappings }),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-identity-mapping"
      && error.message.includes("additional properties"),
  );
});

test("root mappings cover every inventory root and cannot silently remap overlapping claims", (t) => {
  const input = previewInput(t, CURRENT_WORKSPACE);
  assert.throws(
    () => planWakeflowMigrationPreview({
      ...input,
      rootMappings: input.rootMappings.slice(1),
    }),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-root-mapping",
  );

  const conflicting = structuredClone(input.rootMappings);
  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot: CURRENT_WORKSPACE });
  const active = conflicting.filter((mapping) => {
    const root = inventory.roots.find((candidate) => candidate.rootId === mapping.rootId);
    return root?.exists && root.rootKind.includes("active-root");
  });
  assert.ok(active.length >= 2);
  active[0].target = { kind: "none", targetId: null };
  assert.throws(
    () => planWakeflowMigrationPreview({ ...input, rootMappings: conflicting }),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-root-conflict",
  );

  const crossedResponsibility = structuredClone(input.rootMappings);
  for (const mapping of crossedResponsibility) {
    const root = inventory.roots.find((candidate) => candidate.rootId === mapping.rootId);
    if (root?.location.path === ".wakeflow-active") {
      mapping.target = { kind: "program", targetId: IDS.program };
    }
  }
  assert.throws(
    () => planWakeflowMigrationPreview({ ...input, rootMappings: crossedResponsibility }),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-root-mapping"
      && error.message.includes("physical responsibility"),
  );
});

test("mixed-owned user remainder stays keep while unresolved managed transformation is manual", (t) => {
  const plan = planWakeflowMigrationPreview(previewInput(t, CURRENT_WORKSPACE));
  const mixed = plan.payload.sources.flatMap((source) => source.units.map((unit) => ({ source, unit })))
    .filter(({ unit }) => unit.scope === "component");
  const userRemainder = mixed.find(({ unit }) => unit.selector === "outside-managed-component");
  assert.equal(userRemainder?.unit.suggestedAction, "keep");
  assert.equal(userRemainder?.unit.action, "keep");
  assert.equal(userRemainder?.unit.target.kind, "same-component");
  const managed = mixed.find(({ unit }) => unit.suggestedAction === "transform");
  assert.equal(managed?.unit.action, "manual");
  assert.equal(managed?.unit.target, null);
  assert.equal(managed?.unit.reasonCode, "migration-target-owner-unresolved");
});

test("private source hierarchy is closed by IDs and a directory never replaces its children", (t) => {
  const plan = planWakeflowMigrationPreview(previewInput(t, CURRENT_WORKSPACE));
  const privateChild = plan.payload.sources.find((source) => (
    source.path === null && source.parentSourceId !== null && source.source.type === "file"
  ));
  assert.ok(privateChild);
  const parent = plan.payload.sources.find((source) => source.sourceId === privateChild.parentSourceId);
  assert.ok(parent?.childSourceIds.includes(privateChild.sourceId));
  assert.equal(parent?.path, null);
  assert.equal(privateChild.units[0].action, "manual");
  assert.equal(privateChild.units[0].reasonCode, "migration-source-private-unlocatable");
  assert.notEqual(parent?.units[0].action, "remove", "parent release cannot swallow unresolved children");
});

test("old-root sources remain manual even when a caller supplies complete target mappings", (t) => {
  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot: OLD_ROOT_WORKSPACE });
  const oldRootIds = new Set(inventory.roots
    .filter((root) => root.exists && root.rootKind.startsWith("old-"))
    .map((root) => root.rootId));
  const oldPhysicalKeys = new Set(inventory.roots
    .filter((root) => oldRootIds.has(root.rootId))
    .map((root) => canonicalJson({ digest: root.digest, location: root.location, type: root.type })));
  const selectedRoots = rootMappings(inventory);
  for (const mapping of selectedRoots) {
    const root = inventory.roots.find((candidate) => candidate.rootId === mapping.rootId);
    const physicalKey = canonicalJson({ digest: root.digest, location: root.location, type: root.type });
    if (oldPhysicalKeys.has(physicalKey)) mapping.target = { kind: "none", targetId: null };
  }
  const plan = planWakeflowMigrationPreview(previewInput(t, OLD_ROOT_WORKSPACE, {
    rootMappings: selectedRoots,
  }));
  const oldSources = plan.payload.sources.filter((source) => source.rootIds.some((rootId) => oldRootIds.has(rootId)));
  assert.ok(oldSources.length > 0);
  assert.ok(oldSources.every((source) => source.units.every((unit) => unit.action === "manual")));
});

test("validator rejects re-signed semantic tampering instead of trusting planDigest", (t) => {
  const plan = planWakeflowMigrationPreview(previewInput(t, CURRENT_WORKSPACE));

  const keepTamper = structuredClone(plan);
  const keep = keepTamper.payload.sources.flatMap((source) => source.units)
    .find((unit) => unit.action === "keep");
  keep.target.digest = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => validateWakeflowMigrationPlan(resignPlan(keepTamper)),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-target",
  );

  const sourceTamper = structuredClone(plan);
  sourceTamper.payload.sources[0].resource.unowned = true;
  assert.throws(
    () => validateWakeflowMigrationPlan(resignPlan(sourceTamper)),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-contract",
  );

  const hostProofTamper = structuredClone(plan);
  assert.ok(hostProofTamper.payload.decommissionCoverage.length > 0);
  hostProofTamper.payload.decommissionCoverage[0].status = "satisfied";
  hostProofTamper.payload.decommissionCoverage[0].evidenceDigest = hostProofTamper.payload.inventory.inventoryDigest;
  hostProofTamper.payload.decommissionCoverage[0].coverageId = canonicalJsonDigest({
    evidenceDigest: hostProofTamper.payload.decommissionCoverage[0].evidenceDigest,
    hostId: hostProofTamper.payload.decommissionCoverage[0].hostId,
    sourceIds: hostProofTamper.payload.decommissionCoverage[0].sourceIds,
    status: "satisfied",
  });
  hostProofTamper.payload.decommissionCoverage.sort((left, right) => left.coverageId.localeCompare(right.coverageId));
  assert.throws(
    () => validateWakeflowMigrationPlan(resignPlan(hostProofTamper)),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-order",
  );

  const drainArtifactTamper = structuredClone(plan);
  drainArtifactTamper.payload.ownerDrain.artifact.legacyOwnerArtifactDigest = `sha256:${"e".repeat(64)}`;
  const drainUnsigned = {
    artifactKind: drainArtifactTamper.payload.ownerDrain.artifactKind,
    artifact: drainArtifactTamper.payload.ownerDrain.artifact,
    domains: drainArtifactTamper.payload.ownerDrain.domains,
    inventory: drainArtifactTamper.payload.ownerDrain.inventory,
    schemaVersion: drainArtifactTamper.payload.ownerDrain.schemaVersion,
    summary: drainArtifactTamper.payload.ownerDrain.summary,
  };
  drainArtifactTamper.payload.ownerDrain.assessmentDigest = canonicalJsonDigest(drainUnsigned);
  assert.throws(
    () => validateWakeflowMigrationPlan(resignPlan(drainArtifactTamper)),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-owner-drain",
  );

  const layoutTamper = structuredClone(plan);
  layoutTamper.payload.target.layoutEntries[0].owner = "tampered-owner";
  assert.throws(
    () => validateWakeflowMigrationPlan(resignPlan(layoutTamper)),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-target"
      && error.message.includes("recomputable snapshot"),
  );

  const hostTamper = structuredClone(plan);
  hostTamper.payload.target.hostProfile.memoryFile = "CLAUDE.md";
  assert.throws(
    () => validateWakeflowMigrationPlan(resignPlan(hostTamper)),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-target",
  );

  const sourceIdentityTamper = structuredClone(plan);
  const trackedConfig = sourceIdentityTamper.payload.sources.find((source) => source.path === "wakeflow.config.json");
  trackedConfig.path = "workspace.config.json";
  assert.throws(
    () => validateWakeflowMigrationPlan(resignPlan(sourceIdentityTamper)),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-source"
      && error.message.includes("physical identity"),
  );

  const classifierTamper = structuredClone(plan);
  const classified = classifierTamper.payload.sources.find((source) => (
    source.classification !== null && source.classification.confidence !== "unknown"
  ));
  classified.classification.confidence = "unknown";
  assert.throws(
    () => validateWakeflowMigrationPlan(resignPlan(classifierTamper)),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-source"
      && error.message.includes("fail-closed"),
  );

  const cycleTamper = structuredClone(plan);
  const roots = cycleTamper.payload.sources.filter((source) => (
    source.source.type === "directory" && source.parentSourceId === null
  )).slice(0, 2);
  assert.equal(roots.length, 2);
  roots[0].parentSourceId = roots[1].sourceId;
  roots[1].parentSourceId = roots[0].sourceId;
  roots[0].childSourceIds.push(roots[1].sourceId);
  roots[1].childSourceIds.push(roots[0].sourceId);
  roots[0].childSourceIds.sort();
  roots[1].childSourceIds.sort();
  assert.throws(
    () => validateWakeflowMigrationPlan(resignPlan(cycleTamper)),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-source"
      && error.message.includes("cycle"),
  );
});

test("config correlation stays blocked for mismatched overlays and safety-only config facts", (t) => {
  const mismatchSandbox = mkdtempSync(path.join(os.tmpdir(), "wakeflow-migration-plan-overlay-"));
  t.after(() => rmSync(mismatchSandbox, { recursive: true, force: true }));
  const mismatchRoot = path.join(mismatchSandbox, "WakeflowFixture");
  cpSync(CURRENT_WORKSPACE, mismatchRoot, { recursive: true });
  const durableFile = path.join(mismatchRoot, "wakeflow.config.json");
  const durableBytes = readFileSync(durableFile);
  const overlay = JSON.parse(durableBytes.toString("utf8"));
  overlay.storage.activeRoot = "silently-diverged-active";
  overlay.derived = {
    kind: "WakeflowLocalConfigOverlay",
    version: 1,
    from: "wakeflow.config.json",
    baseHash: sha256(durableBytes).slice("sha256:".length),
    generatedAt: "2026-08-24T00:00:00.000Z",
    streamWindows: [],
  };
  writeJson(path.join(mismatchRoot, ".wakeflow-local/wakeflow.config.json"), overlay);
  const mismatchPlan = planWakeflowMigrationPreview(previewInput(t, mismatchRoot));
  const mismatchFact = mismatchPlan.payload.inventory.configSources.find((entry) => (
    entry.scope === "local-overlay" && entry.baseEvidence === "mismatched-durable-intent"
  ));
  assert.ok(mismatchFact?.blockerCodes.includes("migration-overlay-intent-mismatch"));
  const mismatchSource = mismatchPlan.payload.sources.find((source) => source.sourceId === mismatchFact.sourceId);
  assert.ok(mismatchSource?.units.every((unit) => unit.action === "manual"));
  assert.ok(mismatchSource?.units.every((unit) => unit.reasonCode === "migration-overlay-intent-mismatch"));
  assert.ok(mismatchPlan.payload.dependencies.some((entry) => (
    entry.code === "config-source-set-correlation" && entry.status === "required"
  )));

  const unsafeSandbox = mkdtempSync(path.join(os.tmpdir(), "wakeflow-migration-plan-config-safety-"));
  t.after(() => rmSync(unsafeSandbox, { recursive: true, force: true }));
  const unsafeRoot = path.join(unsafeSandbox, "WakeflowFixture");
  cpSync(CURRENT_WORKSPACE, unsafeRoot, { recursive: true });
  symlinkSync("missing-local-target", path.join(unsafeRoot, ".workspace-local"));
  const unsafePlan = planWakeflowMigrationPreview(previewInput(t, unsafeRoot));
  const physicalSourceIds = new Set(unsafePlan.payload.sources.map((source) => source.sourceId));
  const safetyOnlyFacts = unsafePlan.payload.inventory.configSources.filter((entry) => (
    !physicalSourceIds.has(entry.sourceId)
  ));
  assert.ok(safetyOnlyFacts.length > 0);
  assert.ok(safetyOnlyFacts.every((entry) => (
    entry.rawDigest === null
    && entry.intentDigest === null
    && entry.topologyDigest === null
    && entry.blockerCodes.length > 0
  )));
  assert.ok(unsafePlan.payload.blockers.some((entry) => (
    entry.code === "migration-source-symlink-ancestor" && entry.sourceId === null
  )));
});

test("a mapped legacy directory is retained only when it is an actual target path", (t) => {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "wakeflow-migration-plan-placement-"));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const workspaceRoot = path.join(sandbox, "WakeflowFixture");
  cpSync(CURRENT_WORKSPACE, workspaceRoot, { recursive: true });
  cpSync(path.join(workspaceRoot, "Design"), path.join(workspaceRoot, "DesignLegacy"), { recursive: true });
  const configFile = path.join(workspaceRoot, "wakeflow.config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.repositories[1].path = "DesignLegacy";
  writeJson(configFile, config);

  const plan = planWakeflowMigrationPreview(previewInput(t, workspaceRoot));
  const legacyRoot = plan.payload.rootDiff.find((root) => (
    root.rootKind === "configured-internal-support" && root.location.path === "DesignLegacy"
  ));
  assert.ok(legacyRoot);
  const source = plan.payload.sources.find((entry) => (
    entry.parentSourceId === null && entry.rootIds.includes(legacyRoot.rootId)
  ));
  assert.ok(source);
  assert.notEqual(source.units[0].reasonCode, "migration-target-directory-retained");
  assert.equal(source.units[0].action, "manual");
  assert.equal(source.units[0].reasonCode, "migration-child-release-unresolved");
});

test("legacy owner null, physical anomalies, and artifact digest tampering stay blocked", (t) => {
  const withoutOwner = previewInput(t, CURRENT_WORKSPACE);
  withoutOwner.artifactContext = {
    bootstrapArtifact: withoutOwner.artifactContext.bootstrapArtifact,
    legacyOwnerArtifact: null,
  };
  const ownerless = planWakeflowMigrationPreview(withoutOwner);
  assert.equal(ownerless.payload.artifacts.legacyOwnerArtifactDigest, null);
  assert.equal(ownerless.payload.ownerDrain, null);
  assert.ok(ownerless.payload.blockers.some((entry) => entry.code === "migration-legacy-owner-required"));

  const tampered = previewInput(t, CURRENT_WORKSPACE);
  tampered.artifactContext = structuredClone(tampered.artifactContext);
  tampered.artifactContext.bootstrapArtifact.artifactDigest = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => planWakeflowMigrationPreview(tampered),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-artifact",
  );

  const sandbox = mkdtempSync(path.join(os.tmpdir(), "wakeflow-migration-plan-anomaly-"));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const workspaceRoot = path.join(sandbox, "WakeflowFixture");
  cpSync(CURRENT_WORKSPACE, workspaceRoot, { recursive: true });
  symlinkSync("missing-target", path.join(workspaceRoot, ".wakeflow-local/private-link"));
  const anomalous = planWakeflowMigrationPreview(previewInput(t, workspaceRoot));
  const link = anomalous.payload.sources.find((source) => source.source.type === "symlink");
  assert.equal(link?.units[0].action, "manual");
  assert.ok(anomalous.payload.blockers.some((entry) => entry.sourceId === link.sourceId));
});

test("preview rejects unknown input fields instead of accepting caller action or inventory overrides", (t) => {
  const input = previewInput(t, CURRENT_WORKSPACE);
  assert.throws(
    () => planWakeflowMigrationPreview({ ...input, actions: [], inventory: {} }),
    (error) => error instanceof WakeflowMigrationPlanError
      && error.code === "wakeflow-migration-plan-input",
  );
  assert.equal(input.workspaceRoot, CURRENT_WORKSPACE, "workspace root remains execution-only input");
});
