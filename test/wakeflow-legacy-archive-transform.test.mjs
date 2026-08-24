import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { hostProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import {
  loadLedgerRecord,
  validateLedgerRecord,
} from "../core/scripts/lib/wakeflow-ledger-records.mjs";
import {
  createWakeflowLegacyArchiveTransformOwnerResolution,
  createWakeflowLegacyArchiveTransformParticipant,
  planWakeflowLegacyArchiveTransform,
  validateWakeflowLegacyArchiveTransformPlan,
} from "../core/scripts/lib/wakeflow-legacy-archive-transform.mjs";
import {
  WAKEFLOW_LEGACY_ARCHIVE_TRANSPORT_SUMMARY_KIND,
  WakeflowLegacyArchiveRecordError,
  validateWakeflowLegacyEvidenceSummaries,
  validateWakeflowLegacyEvidenceSummary,
  validateWakeflowLegacyTransportSummary,
  wakeflowLegacyArchiveCanonicalBytes,
} from "../core/scripts/lib/wakeflow-legacy-archive-records.mjs";
import {
  inspectWakeflowLegacyArchiveImportInventory,
  inspectWakeflowLegacyOwnerDrain,
} from "../core/scripts/lib/wakeflow-legacy-owner-drain.mjs";
import { inspectWakeflowMigrationInventory } from "../core/scripts/lib/wakeflow-migration-inventory.mjs";
import {
  WAKEFLOW_MIGRATION_PLAN_SCHEMA_VERSION,
  planWakeflowMigrationPreview,
  validateWakeflowLegacyArchiveTransformOwnerResolution,
} from "../core/scripts/lib/wakeflow-migration-plan.mjs";
import {
  WAKEFLOW_MIGRATION_APPLY_PHASES,
  planWakeflowMigrationApply,
} from "../core/scripts/lib/wakeflow-migration-apply.mjs";
import {
  recoverWakeflowWorkspaceMutation,
  runWakeflowMaintenanceMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";
import {
  retiredV2DispatchPacketDigest,
  retiredV2DispatchPreparationDigest,
} from "./support/wakeflow-retired-v2-digests.mjs";
import { materializeWakeflowRetiredArchiveOutput } from "./support/wakeflow-retired-writer-fixture.mjs";
import { loadWakeflowHistoricalArtifactIdentity } from "./support/wakeflow-historical-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaRoot = path.join(repositoryRoot, "core/schemas/wakeflow-business-archive");
const maintenanceSchemaRoot = path.join(repositoryRoot, "core/schemas/wakeflow-maintenance");
const originsRoot = path.join(repositoryRoot, "test/fixtures/legacy-origins");
const codexArtifact = path.join(repositoryRoot, "plugins/codex-wakeflow");
const configV3Fixture = path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-full.json");

const IDS = Object.freeze({
  archive: "archive_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  demand: "demand_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  preservation: "preservation_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  program: "program_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
});

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const DIGESTS = Object.freeze({
  assessment: sha("owner drain assessment"),
  envelope: sha("legacy envelope"),
  group: sha("legacy group"),
  payload: sha("legacy payload"),
  plan: sha("legacy test access plan"),
  receipt: sha("legacy test access receipt"),
  result: sha("legacy result"),
  run: sha("legacy run"),
  source: sha("legacy source set"),
  tree: sha("preserved payload tree"),
});

function testAccessSummary(overrides = {}) {
  return {
    summarySchemaVersion: 1,
    sourceKind: "pod-test-access",
    sourceDigest: DIGESTS.source,
    outcome: "verified-closed-archived",
    coverage: [
      "binding-correlation",
      "close-chain",
      "observed-time",
      "plan-receipt-pair",
      "state-membership",
    ],
    artifactCount: 2,
    details: {
      kind: "pod-test-access",
      probeType: "direct-multi-root",
      probeOutcome: "validated",
      targetCount: 2,
      planDigest: DIGESTS.plan,
      receiptDigest: DIGESTS.receipt,
      legacyIdentityCoverage: "partial",
      observedAt: "2026-08-07T03:00:00.000Z",
      recordedAt: null,
    },
    rawDisposition: "release-after-wrapper",
    ...overrides,
  };
}

function closeSummary() {
  return {
    summarySchemaVersion: 1,
    sourceKind: "pod-close",
    sourceDigest: sha("legacy close source set"),
    outcome: "verified-closed-archived",
    coverage: [
      "binding-correlation",
      "close-chain",
      "host-resource-closure",
      "state-membership",
    ],
    artifactCount: 9,
    details: {
      kind: "pod-close",
      podCount: 1,
      manifestCount: 1,
      closeOperationCount: 4,
      closedBindingCount: 4,
      resourceCoverage: "complete",
    },
    rawDisposition: "preserved",
    preservation: {
      preservationId: IDS.preservation,
      payloadTreeDigest: {
        algorithm: "sha256",
        value: DIGESTS.tree,
        entries: 9,
      },
      retentionClass: "reviewable-local-audit",
    },
  };
}

function materializationSummary() {
  return {
    summarySchemaVersion: 1,
    sourceKind: "pod-materialization",
    sourceDigest: sha("legacy materialization source set"),
    outcome: "verified-closed-archived",
    coverage: ["binding-correlation", "launch-chain", "state-membership"],
    artifactCount: 9,
    details: {
      kind: "pod-materialization",
      podCount: 1,
      manifestCount: 1,
      launchOperationCount: 4,
      boundWindowCount: 4,
      latestPhase: "closed",
      historyComplete: false,
    },
    rawDisposition: "release-after-wrapper",
  };
}

function transportSummary(overrides = {}) {
  const inventory = {
    currentResultDigests: [DIGESTS.result],
    envelopeDigests: [DIGESTS.envelope],
    groupDigests: [DIGESTS.group],
    historicalResultDigests: [],
    packetDigests: [sha("legacy packet")],
    runDigests: [DIGESTS.run],
  };
  const inventoryDigest = canonicalJsonDigest(inventory);
  return {
    schemaVersion: 1,
    artifactKind: WAKEFLOW_LEGACY_ARCHIVE_TRANSPORT_SUMMARY_KIND,
    programId: IDS.program,
    demandId: IDS.demand,
    sourceStatus: "archived",
    ownerDrainAssessmentDigest: DIGESTS.assessment,
    sourceDigest: canonicalJsonDigest({ inventoryDigest, sourceStatus: "archived" }),
    inventoryDigest,
    ...inventory,
    ...overrides,
  };
}

function archiveManifest({ archiveKind = "demand", legacyEvidenceSummaries } = {}) {
  const transport = `${canonicalJson(transportSummary())}\n`;
  const source = archiveKind === "demand"
    ? {
        kind: "demand",
        demandId: IDS.demand,
        demandRef: "payload/data.json",
        demandDigest: DIGESTS.payload,
      }
    : {
        kind: "documents",
        documents: [{ ref: "payload/data.json", digest: DIGESTS.payload }],
      };
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-archive-manifest",
    archiveId: IDS.archive,
    programId: IDS.program,
    archiveKind,
    yearMonth: "2026-08",
    title: "Legacy import wrapper",
    conclusion: "Strict legacy evidence was wrapped without restoring active authority.",
    source,
    transport: archiveKind === "demand"
      ? {
          status: "archived",
          inventoryDigest: transportSummary().inventoryDigest,
          memberRefs: [{ ref: "transport-summary.json", digest: sha(transport) }],
        }
      : { status: "unsupported", memberRefs: [] },
    members: [
      {
        role: "payload",
        path: "payload/data.json",
        mediaType: "application/json",
        digest: DIGESTS.payload,
      },
      ...(archiveKind === "demand" ? [{
        role: "transport-summary",
        path: "transport-summary.json",
        mediaType: "application/json",
        digest: sha(transport),
      }] : []),
    ],
    ...(legacyEvidenceSummaries === undefined ? {} : { legacyEvidenceSummaries }),
  };
}

function assertLegacyError(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error instanceof WakeflowLegacyArchiveRecordError, true, error?.stack);
    assert.equal(error.code, code, error?.stack);
    assert.equal(typeof error.path, "string");
    return true;
  });
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function workspaceTree(root) {
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
    entries.push({
      ref,
      type,
      mode: stat.mode & 0o777,
      size: stat.size,
      digest: type === "file" ? sha(readFileSync(file)) : null,
    });
    if (type !== "directory") return;
    for (const name of readdirSync(file).sort()) {
      walk(path.join(file, name), ref ? `${ref}/${name}` : name);
    }
  }
  walk(root, "");
  return entries;
}

function materializeOrigin(t, originId = "codex-0.9.6-70d79d72") {
  const originRoot = path.join(originsRoot, originId);
  const origin = JSON.parse(readFileSync(path.join(originRoot, "origin.json"), "utf8"));
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "wakeflow-legacy-archive-transform-"));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  for (const layer of origin.staticLayers) {
    for (const entry of layer.expectedEntries) {
      const target = path.join(sandbox, ...entry.path.split("/"));
      if (entry.afterType === null) {
        rmSync(target, { recursive: true, force: true });
      } else if (entry.afterType === "directory") {
        mkdirSync(target, { recursive: true });
      } else {
        assert.equal(entry.afterType, "file");
        mkdirSync(path.dirname(target), { recursive: true });
        cpSync(path.join(originRoot, "static", layer.layerId, ...entry.path.split("/")), target);
      }
    }
  }
  return {
    originRoot,
    sandbox,
    workspaceRoot: path.join(sandbox, "WakeflowFixture"),
  };
}

function applyScenario(materialized, scenarioId) {
  const scenarioRoot = path.join(materialized.originRoot, "scenarios", scenarioId);
  const scenario = JSON.parse(readFileSync(path.join(scenarioRoot, "scenario.json"), "utf8"));
  for (const entry of scenario.deltaEntries) {
    const target = path.join(materialized.sandbox, ...entry.path.split("/"));
    if (entry.afterType === null) {
      rmSync(target, { recursive: true, force: true });
    } else if (entry.afterType === "directory") {
      mkdirSync(target, { recursive: true });
    } else {
      assert.equal(entry.afterType, "file");
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(scenarioRoot, "output", ...entry.path.split("/")), target);
    }
  }
  if (scenarioId === "transport-result-reviewed") {
    rehydrateTransportDigests(materialized.workspaceRoot);
  }
}

function rehydrateTransportDigests(workspaceRoot) {
  const transportRoot = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery");
  const packetRoot = path.join(transportRoot, "dispatch-packets");
  const envelopeRoot = path.join(transportRoot, "delivery-envelopes");
  const packets = new Map();
  for (const name of readdirSync(packetRoot).filter((entry) => entry.endsWith(".json"))) {
    const file = path.join(packetRoot, name);
    const packet = JSON.parse(readFileSync(file, "utf8"));
    packet.packetDigest = retiredV2DispatchPacketDigest(packet);
    writeFileSync(file, `${JSON.stringify(packet, null, 2)}\n`);
    packets.set(packet.id, packet);
  }
  for (const name of readdirSync(envelopeRoot).filter((entry) => entry.endsWith(".json"))) {
    const file = path.join(envelopeRoot, name);
    const envelope = JSON.parse(readFileSync(file, "utf8"));
    if (envelope.kind !== "DeliveryEnvelope") continue;
    const packet = packets.get(envelope.sourcePacketId);
    assert.ok(packet, `missing packet for ${envelope.deliveryId}`);
    envelope.sourcePacketDigest = packet.packetDigest;
    envelope.preparationDigest = retiredV2DispatchPreparationDigest({ packet, envelope });
    writeFileSync(file, `${JSON.stringify(envelope, null, 2)}\n`);
  }
}

function archiveReviewedTransport(workspaceRoot) {
  return materializeWakeflowRetiredArchiveOutput({
    disposableRoot: path.dirname(workspaceRoot),
    workspaceRoot,
    scenarioId: "transport-result-reviewed",
  }).archiveRef;
}

let currentOwnerArtifact;
function ownerArtifact() {
  currentOwnerArtifact ??= loadWakeflowHistoricalArtifactIdentity({ host: "codex" });
  return currentOwnerArtifact;
}

function desiredV3Model() {
  const value = JSON.parse(readFileSync(configV3Fixture, "utf8"));
  value.program.programId = IDS.program;
  value.topology.repositories[0].path = "../ProductWorkspace";
  value.topology.supportSurfaces[0].path = "Design";
  value.topology.supportSurfaces[0].ownership = "wakeflow-managed";
  delete value.topology.supportSurfaces[0].instructionManagement;
  value.topology.supportSurfaces[1].path = "Test";
  value.topology.supportSurfaces[1].ownership = "wakeflow-managed";
  delete value.topology.supportSurfaces[1].instructionManagement;
  value.storage.ledgerRoot = "wakeflow-ledger";
  return parseWakeflowConfigV3(value);
}

function installV3Config(workspaceRoot, model = desiredV3Model()) {
  const file = path.join(workspaceRoot, "wakeflow.config.json");
  writeFileSync(file, serializeWakeflowConfigV3(model));
  chmodSync(file, 0o644);
  // The archive phase runs after target-authority. This fixture must model
  // that phase's private local-root realization, not merely replace config.
  for (const ref of [
    ".wakeflow-local",
    ".wakeflow-local/audit",
    ".wakeflow-local/audit/preserved",
    ".wakeflow-local/runtime",
    ".wakeflow-local/runtime/maintenance",
    ".wakeflow-local/runtime/maintenance/transactions",
  ]) {
    const directory = path.join(workspaceRoot, ...ref.split("/"));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  return model;
}

function migrationIdentityMappings(inventory, model) {
  const config = inventory.configSources.find((entry) => entry.scope === "durable");
  const source = inventory.sources.find((entry) => entry.sourceId === config?.sourceId);
  assert.ok(source?.classification, "migration fixture requires one classified durable config");
  const slots = new Map(source.classification.typedSlots.map((slot) => [slot.id, slot]));
  const first = (...ids) => {
    const selected = ids.find((id) => slots.has(id));
    assert.ok(selected, `missing fixture slots ${ids.join(" or ")}`);
    return selected;
  };
  const evidence = (ids) => ids.map((slotId) => ({
    slotId,
    valueDigest: slots.get(slotId).valueDigest,
  })).sort((left, right) => left.slotId.localeCompare(right.slotId));
  const entries = [
    ["program", model.program.programId, [first("config$.workspace.name", "config$.workspaceName")]],
    ...model.topology.repositories.map((repository, index) => [
      "repository",
      repository.repositoryId,
      [`config$.repositories.${index}.path`, `config$.repositories.${index}.windowName`],
    ]),
    ...model.topology.supportSurfaces.map((surface, index) => [
      "surface",
      surface.surfaceId,
      [
        `config$.repositories.${index + model.topology.repositories.length}.path`,
        surface.capability === "design"
          ? first("config$.roles.design", "config$.designWindow")
          : first("config$.roles.test", "config$.testWindow"),
      ],
    ]),
    ...model.topology.windows.map((window) => [
      "window",
      window.windowId,
      [window.role === "controller"
        ? first("config$.roles.controller", "config$.controllerWindow")
        : window.role === "design"
          ? first("config$.roles.design", "config$.designWindow")
          : window.role === "test"
            ? first("config$.roles.test", "config$.testWindow")
            : "config$.repositories.0.windowName"],
    ]),
  ];
  return entries.map(([entityType, targetId, slotIds]) => ({
    entityType,
    targetId,
    sourceId: source.sourceId,
    slots: evidence(slotIds),
  })).sort((left, right) => (
    left.entityType.localeCompare(right.entityType)
    || left.targetId.localeCompare(right.targetId)
  ));
}

function migrationRootMappings(inventory, model) {
  const repositoryId = model.topology.repositories[0].repositoryId;
  const designSurface = model.topology.supportSurfaces.find((entry) => entry.capability === "design");
  const testSurface = model.topology.supportSurfaces.find((entry) => entry.capability === "test");
  return inventory.roots.map((root) => {
    let target;
    if (root.rootKind.includes("old-")) target = { kind: "none", targetId: null };
    else if (root.rootKind.includes("active-root")) target = { kind: "active", targetId: null };
    else if (root.rootKind.includes("local-root")) target = { kind: "local", targetId: null };
    else if (root.rootKind.includes("ledger")) target = { kind: "ledger", targetId: null };
    else if (root.surfaceKind === "design-support") target = { kind: "surface", targetId: designSurface.surfaceId };
    else if (root.surfaceKind === "test-support") target = { kind: "surface", targetId: testSurface.surfaceId };
    else if (root.surfaceKind === "product-repository") target = { kind: "repository", targetId: repositoryId };
    else target = { kind: "program", targetId: model.program.programId };
    return { rootId: root.rootId, target };
  }).sort((left, right) => left.rootId.localeCompare(right.rootId));
}

function migrationPreviewInput(fixture, resolution) {
  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot: fixture.workspaceRoot });
  return {
    workspaceRoot: fixture.workspaceRoot,
    artifactContext: {
      bootstrapArtifact: ownerArtifact(),
      legacyOwnerArtifact: ownerArtifact(),
    },
    desiredModel: fixture.desiredModel,
    identityMappings: migrationIdentityMappings(inventory, fixture.desiredModel),
    rootMappings: migrationRootMappings(inventory, fixture.desiredModel),
    hostProfile,
    legacyArchiveTransformResolution: resolution,
  };
}

function migrationApplySnapshots(migrationPlan, archiveOwnerPlan) {
  const byPhase = new Map(migrationPlan.payload.commitPhases.map((entry) => [entry.phase, entry]));
  const blockers = migrationPlan.payload.blockers.map((entry) => entry.blockerId).sort();
  const dependencies = migrationPlan.payload.dependencies
    .filter((entry) => entry.status !== "satisfied")
    .map((entry) => entry.dependencyId)
    .sort();
  const manualUnits = migrationPlan.payload.sources
    .flatMap((source) => source.units)
    .filter((unit) => unit.action === "manual")
    .map((unit) => unit.unitId)
    .sort();
  const targetKeys = migrationPlan.payload.target.layoutEntries.map((entry) => entry.key).sort();
  return WAKEFLOW_MIGRATION_APPLY_PHASES.map((phase) => ({
    phase,
    ownerId: phase === "archive-or-preservation"
      ? "migration-archive-transform"
      : `test-${phase}`,
    snapshot: phase === "archive-or-preservation"
      ? archiveOwnerPlan
      : {
          schemaId: `urn:wakeflow:internal:test-migration-${phase}-plan:v1`,
          payload: { steps: [] },
        },
    unitIds: byPhase.get(phase).unitIds,
    targetKeys: phase === "target-authority" ? targetKeys : [],
    blockerIds: phase === "target-authority" ? blockers : [],
    dependencyIds: phase === "target-authority" ? dependencies : [],
    manualUnitIds: phase === "target-authority" ? manualUnits : [],
  }));
}

function prepareArchivedTransportFixture(t) {
  const fixture = materializeOrigin(t);
  applyScenario(fixture, "transport-result-reviewed");
  const legacyArchiveRef = archiveReviewedTransport(fixture.workspaceRoot);
  const legacyArchiveRoot = path.resolve(fixture.workspaceRoot, legacyArchiveRef);
  assert.equal(existsSync(legacyArchiveRoot), true);
  const desiredModel = desiredV3Model();
  const assessment = inspectWakeflowLegacyOwnerDrain({
    workspaceRoot: fixture.workspaceRoot,
    legacyOwnerArtifact: ownerArtifact(),
  });
  assert.equal(
    assessment.summary.ownerDrainSatisfied,
    true,
    JSON.stringify(assessment.domains, null, 2),
  );
  const importInventory = inspectWakeflowLegacyArchiveImportInventory({
    workspaceRoot: fixture.workspaceRoot,
    legacyOwnerArtifact: ownerArtifact(),
  });
  assert.equal(importInventory.demands.length, 1);
  const imported = importInventory.demands[0];
  const input = {
    workspaceRoot: fixture.workspaceRoot,
    expectedProgramId: IDS.program,
    legacyOwnerArtifact: ownerArtifact(),
    desiredModel,
    migrationId: "explicit-migration-v3",
    createdAt: "2026-08-11T00:00:00.000Z",
    archiveMappings: [{
      archiveImportId: imported.archiveImportId,
      demandId: IDS.demand,
      archiveId: IDS.archive,
      yearMonth: "2026-08",
      rawPayloadDisposition: "preserved",
      rawPayloadPreservationId: IDS.preservation,
      evidenceDispositions: imported.legacyEvidenceFacts.map((fact) => ({
        sourceKind: fact.sourceKind,
        sourceDigest: fact.sourceDigest,
        rawDisposition: "release-after-wrapper",
        preservationId: null,
      })),
    }],
    preservationMappings: [{
      sourceId: imported.archive.archiveSourceId,
      preservationId: IDS.preservation,
      reasonCode: "legacy-archive-private-payload",
    }],
  };
  return { ...fixture, desiredModel, input, importInventory, legacyArchiveRoot };
}

async function applyArchiveTransform(fixture, planned, admission = "apply") {
  const participant = createWakeflowLegacyArchiveTransformParticipant({
    workspaceRoot: fixture.workspaceRoot,
    expectedProgramId: IDS.program,
    legacyOwnerArtifact: ownerArtifact(),
    admission,
    confirmedPlan: planned.plan,
  });
  return runWakeflowMaintenanceMutation({
    workspaceRoot: fixture.workspaceRoot,
    action: "explicit-migration",
    operationKind: "explicit-migration",
    domainOwner: "migration-archive-transform",
    confirmedPlan: planned.plan,
    planDigest: planned.planDigest,
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
}

function typedArchiveRoot(workspaceRoot) {
  return path.join(
    workspaceRoot,
    "wakeflow-ledger/workspace/archive/2026-08",
    IDS.archive,
  );
}

function maintenanceTransactionFiles(workspaceRoot) {
  const root = path.join(
    workspaceRoot,
    ".wakeflow-local/runtime/maintenance/transactions",
  );
  return existsSync(root)
    ? readdirSync(root).map((name) => path.join(root, name)).sort()
    : [];
}

test("M6-T09 legacy archive schemas are closed migration-only contracts", () => {
  const evidence = JSON.parse(readFileSync(
    path.join(schemaRoot, "legacy-evidence-summary.schema.json"),
    "utf8",
  ));
  const transport = JSON.parse(readFileSync(
    path.join(schemaRoot, "legacy-transport-summary.schema.json"),
    "utf8",
  ));
  const descriptor = JSON.parse(readFileSync(
    path.join(schemaRoot, "legacy-source-descriptor.schema.json"),
    "utf8",
  ));
  const transformPlan = JSON.parse(readFileSync(
    path.join(maintenanceSchemaRoot, "legacy-archive-transform-plan.schema.json"),
    "utf8",
  ));
  for (const schema of [evidence, transport, descriptor, transformPlan]) {
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.match(schema.$comment, /migration-only/i);
    assert.match(schema.$comment, /runtime validation is mandatory/i);
  }
  assert.deepEqual(evidence.properties.sourceKind.enum, [
    "pod-close",
    "pod-materialization",
    "pod-test-access",
  ]);
  assert.equal(
    evidence.$defs.podMaterializationDetails.properties.historyComplete.const,
    false,
  );
  assert.equal(
    transport.properties.artifactKind.const,
    WAKEFLOW_LEGACY_ARCHIVE_TRANSPORT_SUMMARY_KIND,
  );
  assert.equal(
    descriptor.properties.artifactKind.const,
    "wakeflow-legacy-demand-archive-source",
  );
  assert.equal(
    transformPlan.properties.schemaId.const,
    "urn:wakeflow:internal:migration:legacy-archive-transform-plan:v1",
  );
  const manifest = JSON.parse(readFileSync(
    path.join(repositoryRoot, "core/schemas/wakeflow-ledger/archive-manifest.schema.json"),
    "utf8",
  ));
  assert.equal(
    manifest.properties.legacyEvidenceSummaries.items.$ref,
    evidence.$id,
  );
});

test("M6-T09 evidence codec admits only bounded discriminated summaries and freezes them", () => {
  const summaries = validateWakeflowLegacyEvidenceSummaries([
    closeSummary(),
    materializationSummary(),
    testAccessSummary(),
  ]);
  assert.deepEqual(summaries.map((entry) => entry.sourceKind), [
    "pod-close",
    "pod-materialization",
    "pod-test-access",
  ]);
  assert.equal(summaries[1].details.historyComplete, false);
  assert.equal(summaries[2].details.recordedAt, null);
  assertDeepFrozen(summaries);
  const bytes = wakeflowLegacyArchiveCanonicalBytes(summaries[2]);
  assert.equal(bytes.at(-1), 0x0a);
  assert.deepEqual(JSON.parse(bytes), summaries[2]);
});

test("M6-T09 legacy archive codecs reject decorated and behavioral data without executing it", () => {
  for (const decorate of [
    (value) => Object.defineProperty(value, "hiddenAuthority", { value: true }),
    (value) => Object.defineProperty(value, Symbol("authority"), { value: true }),
  ]) {
    const summaries = [testAccessSummary()];
    decorate(summaries);
    assertLegacyError(
      () => validateWakeflowLegacyEvidenceSummaries(summaries),
      "wakeflow-legacy-archive-record-array",
    );
  }

  let slotExecutions = 0;
  const behavioral = [];
  Object.defineProperty(behavioral, "0", {
    enumerable: true,
    get() {
      slotExecutions += 1;
      return testAccessSummary();
    },
  });
  assertLegacyError(
    () => validateWakeflowLegacyEvidenceSummaries(behavioral),
    "wakeflow-legacy-archive-record-array",
  );
  assert.equal(slotExecutions, 0);

  let prototypeExecutions = 0;
  const behavioralPrototype = [testAccessSummary()];
  Object.setPrototypeOf(behavioralPrototype, {
    map() {
      prototypeExecutions += 1;
      return [testAccessSummary()];
    },
  });
  assertLegacyError(
    () => validateWakeflowLegacyEvidenceSummaries(behavioralPrototype),
    "wakeflow-legacy-archive-record-array",
  );
  assert.equal(prototypeExecutions, 0);

  let discriminatorExecutions = 0;
  const behavioralDiscriminator = testAccessSummary();
  Object.defineProperty(behavioralDiscriminator, "artifactKind", {
    enumerable: true,
    get() {
      discriminatorExecutions += 1;
      return WAKEFLOW_LEGACY_ARCHIVE_TRANSPORT_SUMMARY_KIND;
    },
  });
  assertLegacyError(
    () => wakeflowLegacyArchiveCanonicalBytes(behavioralDiscriminator),
    "wakeflow-legacy-archive-record-field",
  );
  assert.equal(discriminatorExecutions, 0);
});

test("M6-T09 evidence codec rejects discriminator, caveat, coverage, and disposition drift", () => {
  const wrongKind = materializationSummary();
  wrongKind.details.kind = "pod-close";
  assertLegacyError(
    () => validateWakeflowLegacyEvidenceSummary(wrongKind),
    "wakeflow-legacy-archive-record-details",
  );

  const inventedHistory = materializationSummary();
  inventedHistory.details.historyComplete = true;
  assertLegacyError(
    () => validateWakeflowLegacyEvidenceSummary(inventedHistory),
    "wakeflow-legacy-archive-record-details",
  );

  const inventedRecordedTime = testAccessSummary();
  inventedRecordedTime.details.recordedAt = "2026-08-07T03:01:00.000Z";
  assertLegacyError(
    () => validateWakeflowLegacyEvidenceSummary(inventedRecordedTime),
    "wakeflow-legacy-archive-record-coverage",
  );

  const prematureRelease = testAccessSummary({
    preservation: closeSummary().preservation,
  });
  assertLegacyError(
    () => validateWakeflowLegacyEvidenceSummary(prematureRelease),
    "wakeflow-legacy-archive-record-preservation",
  );

  const unboundPreserved = testAccessSummary({ rawDisposition: "preserved" });
  assertLegacyError(
    () => validateWakeflowLegacyEvidenceSummary(unboundPreserved),
    "wakeflow-legacy-archive-record-preservation",
  );
});

test("M6-T09 record errors and records do not admit private host material", () => {
  const secret = "/Users/private/worktree/secret";
  const unsafe = testAccessSummary();
  unsafe.details.rawHandle = secret;
  let captured = null;
  try {
    validateWakeflowLegacyEvidenceSummary(unsafe);
  } catch (error) {
    captured = error;
  }
  assert.equal(captured instanceof WakeflowLegacyArchiveRecordError, true);
  assert.equal(JSON.stringify({
    code: captured.code,
    message: captured.message,
    path: captured.path,
    details: captured.details,
  }).includes(secret), false);
  for (const value of [
    closeSummary(),
    materializationSummary(),
    testAccessSummary(),
    transportSummary(),
  ]) {
    assert.equal(canonicalJson(value).includes("/Users/"), false);
    assert.equal(canonicalJson(value).includes("windowName"), false);
    assert.equal(canonicalJson(value).includes("prompt"), false);
  }
});

test("M6-T09 transport codec binds sorted digest sets to derived inventory and source digests", () => {
  const validated = validateWakeflowLegacyTransportSummary(transportSummary());
  assert.equal(validated.sourceStatus, "archived");
  assertDeepFrozen(validated);

  const driftedInventory = transportSummary({ inventoryDigest: sha("invented inventory") });
  assertLegacyError(
    () => validateWakeflowLegacyTransportSummary(driftedInventory),
    "wakeflow-legacy-archive-record-transport",
  );

  const unsorted = transportSummary();
  unsorted.groupDigests = [sha("z group"), sha("a group")].sort().reverse();
  assertLegacyError(
    () => validateWakeflowLegacyTransportSummary(unsorted),
    "wakeflow-legacy-archive-record-order",
  );

  const falseAbsence = transportSummary({ sourceStatus: "absent" });
  assertLegacyError(
    () => validateWakeflowLegacyTransportSummary(falseAbsence),
    "wakeflow-legacy-archive-record-transport",
  );
});

test("M6-T09 ledger extension is demand-only while ordinary M2 archive bytes stay unchanged", () => {
  const ordinary = archiveManifest();
  const before = canonicalJson(ordinary);
  const ordinaryValidation = validateLedgerRecord(ordinary);
  assert.equal(canonicalJson(ordinaryValidation.record), before);
  assert.equal(Object.hasOwn(ordinaryValidation.record, "legacyEvidenceSummaries"), false);

  const summaries = [closeSummary(), materializationSummary(), testAccessSummary()];
  const migrated = validateLedgerRecord(archiveManifest({ legacyEvidenceSummaries: summaries }));
  assert.deepEqual(migrated.record.legacyEvidenceSummaries, summaries);
  assertDeepFrozen(migrated.record.legacyEvidenceSummaries);

  const documents = archiveManifest({
    archiveKind: "documents",
    legacyEvidenceSummaries: summaries,
  });
  assert.throws(
    () => validateLedgerRecord(documents),
    (error) => error?.code === "wakeflow-ledger-legacy-evidence",
  );

  const unsorted = archiveManifest({
    legacyEvidenceSummaries: [testAccessSummary(), closeSummary()],
  });
  assert.throws(
    () => validateLedgerRecord(unsorted),
    (error) => error?.code === "wakeflow-ledger-legacy-evidence",
  );
});

test("M6-T09 archive transform planning is deterministic, private, frozen, and zero-write", (t) => {
  const fixture = prepareArchivedTransportFixture(t);
  const before = workspaceTree(fixture.workspaceRoot);
  const first = planWakeflowLegacyArchiveTransform(fixture.input);
  const second = planWakeflowLegacyArchiveTransform(fixture.input);

  assert.deepEqual(second, first);
  assert.deepEqual(validateWakeflowLegacyArchiveTransformPlan(first.plan), first.plan);
  assertDeepFrozen(first);
  assert.equal(first.plan.payload.status, "ready");
  assert.equal(first.plan.payload.holds.length, 1);
  assert.equal(first.plan.payload.archives.length, 1);
  assert.equal(first.plan.payload.steps.length, 2);
  assert.deepEqual(first.plan.payload.steps.map((step) => step.stepKind), [
    "audit-publish",
    "owner-effect",
  ]);
  assert.equal(
    first.plan.payload.holds[0].sourceId,
    fixture.importInventory.demands[0].archive.archiveSourceId,
  );
  assert.equal(first.plan.payload.archives[0].sourceAuthority.archiveImportId,
    fixture.importInventory.demands[0].archiveImportId);
  assert.equal(first.plan.payload.archives[0].record.archiveId, IDS.archive);
  assert.equal(first.plan.payload.archives[0].record.source.demandId, IDS.demand);
  assert.equal(first.plan.payload.archives[0].descriptor.rawPayload.disposition, "preserved");
  assert.equal(first.plan.payload.archives[0].descriptor.rawPayload.retainedMemberCount > 0, true);
  const encoded = canonicalJson(first);
  for (const forbidden of [
    fixture.workspaceRoot,
    fixture.legacyArchiveRoot,
    os.homedir(),
    "windowName",
    "rawHandle",
  ]) {
    assert.equal(encoded.includes(forbidden), false, `plan leaked ${forbidden}`);
  }
  const businessArchive = canonicalJson({
    descriptor: first.plan.payload.archives[0].descriptor,
    record: first.plan.payload.archives[0].record,
  });
  for (const forbidden of ["SCENARIO-TRANSPORT", "ProductWindow", "windowName", "rawHandle"]) {
    assert.equal(businessArchive.includes(forbidden), false, `business archive leaked ${forbidden}`);
  }
  assert.deepEqual(workspaceTree(fixture.workspaceRoot), before);
});

test("M6-T09 archive transform rejects behavioral collections and invalid roots or instants at admission", (t) => {
  const fixture = prepareArchivedTransportFixture(t);

  const decorated = structuredClone(fixture.input);
  Object.defineProperty(decorated.archiveMappings, Symbol("authority"), { value: true });
  assert.throws(
    () => planWakeflowLegacyArchiveTransform(decorated),
    (error) => error?.code === "wakeflow-legacy-archive-transform-contract",
  );

  let prototypeExecutions = 0;
  const behavioralPrototype = structuredClone(fixture.input);
  Object.setPrototypeOf(behavioralPrototype.archiveMappings, {
    map() {
      prototypeExecutions += 1;
      return [];
    },
  });
  assert.throws(
    () => planWakeflowLegacyArchiveTransform(behavioralPrototype),
    (error) => error?.code === "wakeflow-legacy-archive-transform-contract",
  );
  assert.equal(prototypeExecutions, 0);

  const invalidInstant = structuredClone(fixture.input);
  invalidInstant.createdAt = "2026-02-31T00:00:00.000Z";
  assert.throws(
    () => planWakeflowLegacyArchiveTransform(invalidInstant),
    (error) => error?.code === "wakeflow-legacy-archive-transform-contract",
  );

  const nulRoot = structuredClone(fixture.input);
  nulRoot.workspaceRoot = `${fixture.workspaceRoot}\0suffix`;
  assert.throws(
    () => planWakeflowLegacyArchiveTransform(nulRoot),
    (error) => error?.code === "wakeflow-legacy-archive-transform-contract",
  );
});

test("M6-T09 T05 resolves only exact T06 archive-wrap units and T08 binds their Task D owner", (t) => {
  const fixture = prepareArchivedTransportFixture(t);
  const planned = planWakeflowLegacyArchiveTransform(fixture.input);
  const resolution = createWakeflowLegacyArchiveTransformOwnerResolution({
    plan: planned.plan,
  });
  assert.deepEqual(validateWakeflowLegacyArchiveTransformOwnerResolution(resolution), resolution);

  const withoutOwner = planWakeflowMigrationPreview(migrationPreviewInput(fixture, null));
  const withOwner = planWakeflowMigrationPreview(migrationPreviewInput(fixture, resolution));
  assert.equal(WAKEFLOW_MIGRATION_PLAN_SCHEMA_VERSION, 3);
  assert.equal(withOwner.payload.legacyArchiveTransform.ownerPlanDigest, planned.planDigest);
  assert.equal(
    withOwner.payload.legacyArchiveTransform.resolutionDigest,
    resolution.resolutionDigest,
  );
  const overbroad = structuredClone(resolution);
  const configSource = inspectWakeflowMigrationInventory({
    workspaceRoot: fixture.workspaceRoot,
  }).sources.find((source) => source.resource.kind === "config-source");
  assert.ok(configSource);
  overbroad.coveredSourceIds.push(configSource.sourceId);
  overbroad.coveredSourceIds.sort();
  const { resolutionDigest: _oldResolutionDigest, ...overbroadUnsigned } = overbroad;
  overbroad.resolutionDigest = canonicalJsonDigest(overbroadUnsigned);
  assert.throws(
    () => planWakeflowMigrationPreview(migrationPreviewInput(fixture, overbroad)),
    (error) => error?.code === "wakeflow-migration-plan-transform-owner",
  );

  const exactArchiveSourceIds = new Set(resolution.coveredSourceIds);
  const candidates = withoutOwner.payload.sources.flatMap((source) => source.units
    .filter((unit) => (
      unit.suggestedAction === "transform"
      && unit.suggestedRoute === "archive-wrap"
      && exactArchiveSourceIds.has(source.sourceId)
    ))
    .map((unit) => ({ sourceId: source.sourceId, unit })));
  assert.ok(candidates.length > 0);
  const withUnits = new Map(withOwner.payload.sources.flatMap((source) => (
    source.units.map((unit) => [unit.unitId, { source, unit }])
  )));
  for (const candidate of candidates) {
    assert.equal(candidate.unit.action, "manual");
    assert.equal(candidate.unit.reasonCode, "migration-target-owner-unresolved");
    const resolved = withUnits.get(candidate.unit.unitId);
    assert.equal(resolved.source.sourceId, candidate.sourceId);
    assert.equal(resolved.unit.action, "transform");
    assert.equal(resolved.unit.route, "archive-wrap");
    assert.equal(resolved.unit.reasonCode, "migration-legacy-archive-transform-owner-resolved");
    assert.deepEqual(resolved.unit.target, {
      kind: "migration-transform-owner",
      ownerId: "migration-archive-transform",
      ownerPlanDigest: planned.planDigest,
      resolutionDigest: resolution.resolutionDigest,
    });
  }
  const resolvedUnitIds = new Set(candidates.map((entry) => entry.unit.unitId));
  const correlations = withOwner.payload.dependencies.filter((dependency) => (
    dependency.unitIds.some((unitId) => resolvedUnitIds.has(unitId))
    && dependency.code.includes("correlation")
  ));
  assert.ok(correlations.length > 0);
  assert.ok(correlations.every((dependency) => (
    dependency.status === "satisfied"
    && dependency.evidenceDigest === resolution.resolutionDigest
  )));

  const targetResult = withOwner.payload.sources.flatMap((source) => source.units.map((unit) => ({
    artifactKind: source.classification?.artifact.kind,
    unit,
  }))).find((entry) => entry.artifactKind === "TargetResultEnvelope");
  assert.equal(targetResult.unit.suggestedRoute, "schema-map");
  assert.equal(targetResult.unit.action, "manual");
  assert.equal(targetResult.unit.target, null);
  const snapshots = migrationApplySnapshots(withOwner, planned.plan);
  const applyPlan = planWakeflowMigrationApply({
    migrationPlan: withOwner,
    hostPlans: [],
    hostEffectSnapshots: [],
    manualAcknowledgements: [],
    phaseSnapshots: snapshots,
  });
  assert.equal(applyPlan.payload.status, "blocked", "unrelated T05 manual owners remain explicit");
  const wrongOwner = structuredClone(snapshots);
  const archivePhase = wrongOwner.find((entry) => entry.phase === "archive-or-preservation");
  archivePhase.snapshot = {
    schemaId: "urn:wakeflow:internal:test-wrong-archive-owner:v1",
    payload: { steps: [] },
  };
  assert.throws(
    () => planWakeflowMigrationApply({
      migrationPlan: withOwner,
      hostPlans: [],
      hostEffectSnapshots: [],
      manualAcknowledgements: [],
      phaseSnapshots: wrongOwner,
    }),
    (error) => error?.code === "wakeflow-migration-apply-phase-owner",
  );
});

test("M6-T09 exact import source coverage rejects an ambiguous transport-shaped copy", (t) => {
  const fixture = prepareArchivedTransportFixture(t);
  const packetRoot = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/dispatch-packets",
  );
  const packetName = readdirSync(packetRoot).find((entry) => entry.endsWith(".json"));
  assert.ok(packetName);
  const duplicateRoot = path.join(
    fixture.workspaceRoot,
    "Design/fake-wakeflow-delivery/dispatch-packets",
  );
  mkdirSync(duplicateRoot, { recursive: true });
  cpSync(path.join(packetRoot, packetName), path.join(duplicateRoot, "duplicate.json"));

  assert.throws(
    () => inspectWakeflowLegacyArchiveImportInventory({
      workspaceRoot: fixture.workspaceRoot,
      legacyOwnerArtifact: ownerArtifact(),
    }),
    (error) => (
      error?.code === "wakeflow-legacy-owner-drain-import-blocked"
      && error.details.reasonCode === "owner-drain-incomplete"
    ),
  );
});

test("M6-T09 archive transform publishes one typed wrapper and retains exact legacy source", async (t) => {
  const fixture = prepareArchivedTransportFixture(t);
  const legacyBefore = workspaceTree(fixture.legacyArchiveRoot);
  const planned = planWakeflowLegacyArchiveTransform(fixture.input);
  installV3Config(fixture.workspaceRoot, fixture.desiredModel);
  assert.equal(
    `0${(lstatSync(fixture.legacyArchiveRoot).mode & 0o777).toString(8).padStart(3, "0")}`,
    planned.plan.payload.holds[0].plan.payload.retainedSource.mode,
  );
  const applied = await applyArchiveTransform(fixture, planned);

  assert.equal(applied.status, "completed");
  assert.equal(applied.planDigest, planned.planDigest);
  assert.deepEqual(
    workspaceTree(fixture.legacyArchiveRoot),
    legacyBefore,
    "archive-or-preservation never releases the legacy source",
  );
  const archive = planned.plan.payload.archives[0];
  const typedRoot = typedArchiveRoot(fixture.workspaceRoot);
  const loaded = loadLedgerRecord({
    ledgerRoot: path.join(fixture.workspaceRoot, "wakeflow-ledger"),
    root: typedRoot,
    expectedFamily: "archive",
    expectedProgramId: IDS.program,
  });
  assert.deepEqual(loaded.record, archive.record);
  assert.equal(loaded.recordDigest, archive.recordDigest);
  assert.deepEqual(
    loaded.members.map(({ role, path: memberPath, mediaType, digest }) => ({
      role,
      path: memberPath,
      mediaType,
      digest,
    })),
    archive.record.members,
  );
  assert.deepEqual(
    archive.sourceMembers
      .filter((entry) => entry.portableDisposition === "portable-member")
      .map((entry) => entry.digest)
      .sort(),
    loaded.members
      .filter((entry) => /^payload\/legacy\/member-[0-9]{5}\.bin$/u.test(entry.path))
      .map((entry) => entry.digest)
      .sort(),
  );
  const descriptor = JSON.parse(readFileSync(
    path.join(typedRoot, "payload/legacy-source.json"),
    "utf8",
  ));
  assert.deepEqual(descriptor, archive.descriptor);
  assert.equal(JSON.stringify(descriptor).includes(fixture.workspaceRoot), false);
  assert.equal(existsSync(path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/maintenance.lock",
  )), false);
  assert.deepEqual(
    readdirSync(path.join(
      fixture.workspaceRoot,
      ".wakeflow-local/runtime/maintenance/transactions",
    )),
    [],
  );
});

test("M6-T09 non-portable legacy bytes require one exact source-retained hold", (t) => {
  const fixture = prepareArchivedTransportFixture(t);
  const input = JSON.parse(canonicalJson(fixture.input));
  input.archiveMappings[0].rawPayloadDisposition = "portable";
  input.archiveMappings[0].rawPayloadPreservationId = null;
  input.preservationMappings = [];
  assert.throws(
    () => planWakeflowLegacyArchiveTransform(input),
    (error) => error?.code === "wakeflow-legacy-archive-transform-privacy",
  );
  assert.equal(existsSync(typedArchiveRoot(fixture.workspaceRoot)), false);
});

test("M6-T09 archive transform rejects source drift before every owner effect", async (t) => {
  const fixture = prepareArchivedTransportFixture(t);
  const planned = planWakeflowLegacyArchiveTransform(fixture.input);
  installV3Config(fixture.workspaceRoot, fixture.desiredModel);
  const driftFile = path.join(fixture.legacyArchiveRoot, "post-confirmation-drift.txt");
  writeFileSync(driftFile, "drift after confirmation\n", { mode: 0o644 });
  chmodSync(driftFile, 0o644);

  await assert.rejects(
    () => applyArchiveTransform(fixture, planned),
    (error) => (
      error?.code === "wakeflow-mutation-plan-blocked"
      && new Set([
        "wakeflow-legacy-archive-transform-stale",
        "wakeflow-preservation-stale",
      ]).has(error.cause?.code)
    ),
  );
  assert.equal(existsSync(typedArchiveRoot(fixture.workspaceRoot)), false);
  assert.equal(existsSync(path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/audit/preserved",
    IDS.preservation,
  )), false);
  assert.deepEqual(maintenanceTransactionFiles(fixture.workspaceRoot), []);
});

test("M6-T09 archive owner-effect recovery reuses the published exact wrapper", async (t) => {
  const fixture = prepareArchivedTransportFixture(t);
  const sourceBefore = workspaceTree(fixture.legacyArchiveRoot);
  const planned = planWakeflowLegacyArchiveTransform(fixture.input);
  installV3Config(fixture.workspaceRoot, fixture.desiredModel);
  const initial = createWakeflowLegacyArchiveTransformParticipant({
    workspaceRoot: fixture.workspaceRoot,
    expectedProgramId: IDS.program,
    legacyOwnerArtifact: ownerArtifact(),
    admission: "apply",
    confirmedPlan: planned.plan,
  });
  const archiveStep = planned.plan.payload.steps.find((step) => step.stepKind === "owner-effect");
  const archiveHandler = initial.stepHandlers[archiveStep.stepId];
  let physicalEffectCalls = 0;

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot: fixture.workspaceRoot,
      action: "explicit-migration",
      operationKind: "explicit-migration",
      domainOwner: "migration-archive-transform",
      confirmedPlan: planned.plan,
      planDigest: planned.planDigest,
      validatePlan: initial.validatePlan,
      deriveCurrentPlan: initial.deriveCurrentPlan,
      deriveTerminalClosure: initial.deriveTerminalClosure,
      stepHandlers: {
        ...initial.stepHandlers,
        [archiveStep.stepId]: {
          ...archiveHandler,
          async performEffect(args) {
            physicalEffectCalls += 1;
            await archiveHandler.performEffect(args);
            throw new Error("simulated lost archive callback result");
          },
        },
      },
    }),
    (error) => error?.code === "wakeflow-mutation-recovery-required",
  );
  assert.equal(physicalEffectCalls, 1);
  assert.equal(existsSync(typedArchiveRoot(fixture.workspaceRoot)), true);
  assert.deepEqual(workspaceTree(fixture.legacyArchiveRoot), sourceBefore);
  const transactionFiles = maintenanceTransactionFiles(fixture.workspaceRoot);
  assert.equal(transactionFiles.length, 1);
  const journal = JSON.parse(readFileSync(transactionFiles[0], "utf8"));
  assert.equal(
    journal.steps.find((step) => step.stepId === archiveStep.stepId).status,
    "effect-started",
  );

  const recovery = createWakeflowLegacyArchiveTransformParticipant({
    workspaceRoot: fixture.workspaceRoot,
    expectedProgramId: IDS.program,
    legacyOwnerArtifact: ownerArtifact(),
    admission: "recovery",
    confirmedPlan: planned.plan,
  });
  const recovered = await recoverWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
    operationId: journal.operationId,
    confirmedPlan: planned.plan,
    planDigest: planned.planDigest,
    validatePlan: recovery.validatePlan,
    deriveCurrentPlan: recovery.deriveCurrentPlan,
    deriveTerminalClosure: recovery.deriveTerminalClosure,
    stepHandlers: recovery.stepHandlers,
  });
  assert.equal(recovered.status, "recovered");
  assert.deepEqual(workspaceTree(fixture.legacyArchiveRoot), sourceBefore);
  assert.deepEqual(maintenanceTransactionFiles(fixture.workspaceRoot), []);
  const archive = planned.plan.payload.archives[0];
  const loaded = loadLedgerRecord({
    ledgerRoot: path.join(fixture.workspaceRoot, "wakeflow-ledger"),
    root: typedArchiveRoot(fixture.workspaceRoot),
    expectedFamily: "archive",
    expectedProgramId: IDS.program,
  });
  assert.equal(loaded.recordDigest, archive.recordDigest);
});

test("M6-T09 archive transform validator rejects cross-authority drift", (t) => {
  const fixture = prepareArchivedTransportFixture(t);
  const planned = planWakeflowLegacyArchiveTransform(fixture.input);

  const inventoryDrift = JSON.parse(canonicalJson(planned.plan));
  inventoryDrift.payload.archiveImportInventoryDigest = sha("invented import inventory");
  assert.throws(
    () => validateWakeflowLegacyArchiveTransformPlan(inventoryDrift),
    (error) => error?.code === "wakeflow-legacy-archive-transform-plan",
  );

  const mappingDrift = JSON.parse(canonicalJson(planned.plan));
  mappingDrift.payload.request.archiveMappings[0].yearMonth = "2026-09";
  assert.throws(
    () => validateWakeflowLegacyArchiveTransformPlan(mappingDrift),
    (error) => error?.code === "wakeflow-legacy-archive-transform-plan",
  );

  const sourceRefDrift = JSON.parse(canonicalJson(planned.plan));
  sourceRefDrift.payload.archives[0].sourceRef = "wakeflow-ledger/workspace/archive/other";
  assert.throws(
    () => validateWakeflowLegacyArchiveTransformPlan(sourceRefDrift),
    (error) => error?.code === "wakeflow-legacy-archive-transform-plan",
  );
});
