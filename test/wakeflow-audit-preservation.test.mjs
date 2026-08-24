import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyLocalPreservationPlan,
  createMigrationSourceRetainedPreservationParticipant,
  inspectLocalPreservationInventory,
  inspectLocalPreservationInventoryForLayout,
  localPreservationCanonicalBytes,
  planLocalPreservation,
  planLocalPreservationRelease,
  planMigrationSourceRetainedPreservation,
  recoverLocalPreservationMutation,
  validateLocalPreservationManifest,
} from "../core/scripts/lib/wakeflow-preservation.mjs";
import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  recoverWakeflowWorkspaceMutation,
  runWakeflowMaintenanceMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { hostProfile } from "../core/scripts/lib/wakeflow-host-profile.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import { inspectWakeflowLocalLayout } from "../core/scripts/lib/wakeflow-local-layout-inspection.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleFile = path.join(repoRoot, "core/scripts/lib/wakeflow-preservation.mjs");
const moduleUrl = pathToFileURL(moduleFile).href;
const mutationModuleUrl = pathToFileURL(path.join(
  repoRoot,
  "core/scripts/lib/wakeflow-workspace-mutation.mjs",
)).href;
const manifestSchemaFile = path.join(
  repoRoot,
  "core/schemas/wakeflow-maintenance/local-preservation.schema.json",
);
const planSchemaFile = path.join(
  repoRoot,
  "core/schemas/wakeflow-maintenance/local-preservation-plan.schema.json",
);
const configFixtureFile = path.join(
  repoRoot,
  "test/fixtures/wakeflow-config-v3/valid-full.json",
);
const PROGRAM_ID = "program_11111111-1111-4111-8111-111111111111";
const CREATED_AT = "2026-08-08T01:00:00.000Z";
const BEFORE_REVIEW = "2026-09-06T01:00:00.000Z";
const AT_REVIEW = "2026-09-07T01:00:00.000Z";
const MIGRATION_PRESERVATION_ID = "preservation_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const EXPECTED_EXPORTS = [
  "WakeflowPreservationError",
  "applyLocalPreservationPlan",
  "createMigrationSourceRetainedPreservationParticipant",
  "inspectLocalPreservationInventory",
  "inspectLocalPreservationInventoryForLayout",
  "localPreservationCanonicalBytes",
  "planLocalPreservation",
  "planLocalPreservationRelease",
  "planMigrationSourceRetainedPreservation",
  "recoverLocalPreservationMutation",
  "validateLocalPreservationManifest",
];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function privateDirectory(workspaceRoot, ref) {
  const absolute = path.join(workspaceRoot, ...ref.split("/"));
  mkdirSync(absolute, { recursive: true, mode: 0o700 });
  chmodSync(absolute, 0o700);
  return absolute;
}

function writePrivate(file, bytes, mode = 0o600) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, bytes, { mode });
  chmodSync(file, mode);
}

function fixtureModel() {
  const raw = readJson(configFixtureFile);
  raw.topology.repositories[0].path = "Product";
  raw.topology.supportSurfaces[0].path = "Design";
  raw.topology.supportSurfaces[1].path = "Test";
  raw.storage.ledgerRoot = "Ledger";
  return parseWakeflowConfigV3(raw);
}

function withWorkspace(t, prefix = "wakeflow-audit-preservation-") {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const model = fixtureModel();
  writePrivate(
    path.join(workspaceRoot, "wakeflow.config.json"),
    serializeWakeflowConfigV3(model),
  );
  for (const ref of [
    ".wakeflow-local/runtime/maintenance/transactions",
    ".wakeflow-local/audit/preserved",
    "Product",
    "Design",
    "Test",
  ]) privateDirectory(workspaceRoot, ref);
  mkdirSync(path.join(workspaceRoot, "Ledger"), { recursive: true, mode: 0o755 });
  chmodSync(path.join(workspaceRoot, "Ledger"), 0o755);
  return workspaceRoot;
}

function inspectLayout(workspaceRoot) {
  const model = fixtureModel();
  return inspectWakeflowLocalLayout({
    workspaceRoot,
    model,
    layoutDescriptor: createWakeflowLayoutDescriptor({ model, hostProfile }),
    hostProfile,
  });
}

function preserveInput(workspaceRoot, overrides = {}) {
  return {
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    producer: "storage-preserve",
    sourceRef: ".wakeflow-local/runtime-quarantine",
    storageClass: "legacy",
    reason: { code: "retired-quarantine", note: "Controller-confirmed inactive legacy bytes." },
    links: { demandId: null, archiveManifestDigest: null, migrationId: null },
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function migrationHoldInput(workspaceRoot, overrides = {}) {
  return {
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    preservationId: MIGRATION_PRESERVATION_ID,
    sourceRef: ".wakeflow-local/preserved/legacy-entry",
    migrationId: "explicit-migration-v3",
    reasonCode: "legacy-preservation-migration",
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function createLegacyPreservedEntry(workspaceRoot) {
  const source = privateDirectory(workspaceRoot, ".wakeflow-local/preserved/legacy-entry");
  writePrivate(path.join(source, "MANIFEST.md"), Buffer.from("legacy preserved manifest\n"), 0o400);
  writePrivate(path.join(source, "payload.bin"), Buffer.from([0, 1, 2, 255]), 0o600);
  return source;
}

function createLegacySource(workspaceRoot) {
  const source = privateDirectory(workspaceRoot, ".wakeflow-local/runtime-quarantine");
  writePrivate(path.join(source, "MANIFEST.md"), Buffer.from("legacy manifest bytes\n"));
  writePrivate(path.join(source, "preservation.json"), Buffer.from("legacy payload name\n"), 0o400);
  const nested = privateDirectory(workspaceRoot, ".wakeflow-local/runtime-quarantine/nested");
  chmodSync(nested, 0o750);
  writePrivate(path.join(nested, "payload.txt"), Buffer.from("protected payload\n"), 0o640);
  symlinkSync("MANIFEST.md", path.join(source, "manifest-link"));
  return source;
}

function maintenanceTransactionsRoot(workspaceRoot) {
  return path.join(workspaceRoot, ".wakeflow-local/runtime/maintenance/transactions");
}

async function runMigrationHold(workspaceRoot, planned, admission = "apply") {
  const participant = createMigrationSourceRetainedPreservationParticipant({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    admission,
    confirmedPlan: planned.plan,
  });
  return runWakeflowMaintenanceMutation({
    workspaceRoot,
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

function interruptedOperationId(workspaceRoot) {
  const journals = readdirSync(maintenanceTransactionsRoot(workspaceRoot))
    .filter((name) => /^workspace-mutation_[0-9a-f-]+\.json$/u.test(name));
  assert.equal(journals.length, 1);
  return journals[0].slice(0, -".json".length);
}

function interruptPreservationMutation(workspaceRoot, planned, fault) {
  const childSource = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { applyLocalPreservationPlan } from ${JSON.stringify(moduleUrl)};
    const [workspaceRoot, planJson, planDigest, fault] = process.argv.slice(1);
    const plan = JSON.parse(planJson);
    if (fault === "publish-exdev") {
      const originalRenameSync = fs.renameSync;
      fs.renameSync = function injectedPreservationPublishExdev(source, destination) {
        if (String(source).includes("." + plan.payload.preservationId + ".wakeflow-publish-stage")) {
          const error = new Error("synthetic same-parent preservation publish EXDEV");
          error.code = "EXDEV";
          throw error;
        }
        return originalRenameSync.apply(this, arguments);
      };
    } else if (fault === "cleanup-eio") {
      const originalRmdirSync = fs.rmdirSync;
      let interrupted = false;
      fs.rmdirSync = function injectedPreservationCleanupFailure(target) {
        if (!interrupted && /wakeflow-(?:detach|release)-stage/u.test(String(target))) {
          interrupted = true;
          const error = new Error("synthetic preservation cleanup interruption");
          error.code = "EIO";
          throw error;
        }
        return originalRmdirSync.apply(this, arguments);
      };
    } else {
      throw new Error("unknown preservation fault fixture");
    }
    syncBuiltinESMExports();
    try {
      await applyLocalPreservationPlan({
        workspaceRoot,
        expectedProgramId: ${JSON.stringify(PROGRAM_ID)},
        plan,
        planDigest,
      });
      process.stderr.write("preservation interruption fixture unexpectedly completed");
      process.exitCode = 4;
    } catch (error) {
      process.stderr.write(String(error?.code ?? error?.message ?? error));
      process.exitCode = error?.code === "wakeflow-preservation-recovery-required" ? 3 : 5;
    }
  `;
  const child = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    childSource,
    workspaceRoot,
    JSON.stringify(planned.plan),
    planned.planDigest,
    fault,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(child.status, 3, child.stderr);
  assert.match(child.stderr, /wakeflow-preservation-recovery-required/u);
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local/audit/manager.lock")), true);
  return interruptedOperationId(workspaceRoot);
}

function interruptMigrationHoldPublish(workspaceRoot, planned) {
  const childSource = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import {
      createMigrationSourceRetainedPreservationParticipant,
    } from ${JSON.stringify(moduleUrl)};
    import { runWakeflowMaintenanceMutation } from ${JSON.stringify(mutationModuleUrl)};
    const [workspaceRoot, planJson, planDigest] = process.argv.slice(1);
    const plan = JSON.parse(planJson);
    const originalRenameSync = fs.renameSync;
    fs.renameSync = function injectedMigrationHoldPublishFailure(source, destination) {
      if (String(source).includes("." + plan.payload.preservationId + ".wakeflow-publish-stage")) {
        const error = new Error("synthetic migration hold publish interruption");
        error.code = "EXDEV";
        throw error;
      }
      return originalRenameSync.apply(this, arguments);
    };
    syncBuiltinESMExports();
    const participant = createMigrationSourceRetainedPreservationParticipant({
      workspaceRoot,
      expectedProgramId: ${JSON.stringify(PROGRAM_ID)},
      admission: "apply",
      confirmedPlan: plan,
    });
    try {
      await runWakeflowMaintenanceMutation({
        workspaceRoot,
        action: "explicit-migration",
        operationKind: "explicit-migration",
        domainOwner: "migration-archive-transform",
        confirmedPlan: plan,
        planDigest,
        validatePlan: participant.validatePlan,
        deriveCurrentPlan: participant.deriveCurrentPlan,
        deriveTerminalClosure: participant.deriveTerminalClosure,
        stepHandlers: participant.stepHandlers,
      });
      process.stderr.write("migration hold interruption fixture unexpectedly completed");
      process.exitCode = 7;
    } catch (error) {
      process.stderr.write(String(error?.code ?? error));
      process.exitCode = 3;
    }
  `;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", childSource, workspaceRoot, JSON.stringify(planned.plan), planned.planDigest],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(child.status, 3, child.stderr || child.stdout);
  return interruptedOperationId(workspaceRoot);
}

test("retired preservation writers are absent and unrelated current owners do not bypass preservation", () => {
  for (const relative of [
    "core/scripts/wakeflow-state.mjs",
    "core/scripts/wakeflow-storage.mjs",
    "core/scripts/lib/wakeflow-redaction.mjs",
    "core/scripts/lib/wakeflow-storage-map.mjs",
  ]) {
    assert.equal(existsSync(path.join(repoRoot, relative)), false, relative);
  }

  for (const relative of [
    "core/scripts/lib/wakeflow-config-v3-snapshot.mjs",
    "core/scripts/lib/wakeflow-business-archive-service.mjs",
    "core/scripts/lib/wakeflow-demand-state-service.mjs",
    "core/scripts/lib/wakeflow-target-result-authority.mjs",
    "core/scripts/lib/wakeflow-transport-store.mjs",
    "core/scripts/lib/wakeflow-window-binding-service.mjs",
    "core/scripts/lib/wakeflow-window-lease-service.mjs",
    "core/scripts/lib/wakeflow-window-runtime-projector.mjs",
  ]) {
    const source = readFileSync(path.join(repoRoot, relative), "utf8");
    assert.equal(source.includes("wakeflow-preservation.mjs"), false, relative);
    assert.equal(source.includes(".wakeflow-local/audit/preserved"), false, relative);
  }
  assert.equal(existsSync(path.join(repoRoot, "core/scripts/lib/wakeflow-pod-runtime.mjs")), false);
});

test("local preservation manifest and maintenance plan schemas are strict candidate contracts", () => {
  assert.equal(existsSync(manifestSchemaFile), true, "local preservation manifest schema is required");
  assert.equal(existsSync(planSchemaFile), true, "local preservation plan schema is required");

  const manifest = readJson(manifestSchemaFile);
  assert.equal(manifest.$id, "urn:wakeflow:internal:audit:local-preservation:v1");
  assert.equal(manifest.additionalProperties, false);
  assert.equal(manifest.properties.kind.const, "WakeflowLocalPreservation");
  assert.equal(manifest.properties.schemaVersion.const, 1);
  assert.deepEqual(manifest.properties.producer.enum, [
    "archive-demand",
    "migration",
    "sanitize-archive",
    "storage-preserve",
  ]);

  const plan = readJson(planSchemaFile);
  assert.equal(plan.$id, "urn:wakeflow:internal:maintenance:local-preservation-plan:v1");
  assert.equal(plan.additionalProperties, false);
  assert.deepEqual(plan.required, ["schemaId", "payload"]);
  assert.equal(plan.properties.schemaId.const, plan.$id);
  assert.equal(plan.$defs.payload.properties.artifactKind.const, "wakeflow-local-preservation-plan");
  assert.deepEqual(plan.$defs.payload.properties.operation.enum, [
    "migration-hold",
    "preserve",
    "release",
  ]);
});

test("local preservation module exposes one closed internal manager surface", async () => {
  assert.equal(existsSync(moduleFile), true, "local preservation manager module is required");
  const module = await import(`${pathToFileURL(moduleFile).href}?candidate-contract=${Date.now()}`);
  assert.deepEqual(Object.keys(module).sort(), EXPECTED_EXPORTS);

  const identifiers = await import("../core/scripts/lib/wakeflow-identifiers.mjs");
  assert.equal(identifiers.WAKEFLOW_ID_TYPES.includes("preservation"), true);
  const id = identifiers.generateWakeflowId("preservation");
  assert.match(
    id,
    /^preservation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  const source = readFileSync(moduleFile, "utf8");
  assert.equal(source.includes("fs.readFileSync("), false, "authority files require bounded descriptor reads");
  assert.equal(source.includes("{ bigint: true }"), true, "filesystem identity must retain nanosecond stats");
});

test("source admission blocks active, unknown, and archive sources without writing", (t) => {
  const workspaceRoot = withWorkspace(t);
  privateDirectory(workspaceRoot, ".wakeflow-local/runtime/shared/active-fixture");
    const active = planLocalPreservation(preserveInput(workspaceRoot, {
      sourceRef: ".wakeflow-local/runtime/shared/active-fixture",
    }));
    assert.equal(active.plan.payload.disposition, "blocked");
    assert.deepEqual(active.plan.payload.blockers, [
      { code: "active-or-unknown-source", scope: "source" },
    ]);

    createLegacySource(workspaceRoot);
    const unknown = planLocalPreservation(preserveInput(workspaceRoot, {
      storageClass: "unknown",
    }));
    assert.equal(unknown.plan.payload.disposition, "blocked");
    assert.deepEqual(unknown.plan.payload.blockers, [
      { code: "inactive-source-unproven", scope: "source" },
    ]);

    const archive = planLocalPreservation(preserveInput(workspaceRoot, {
      producer: "archive-demand",
      storageClass: "archive-original",
      links: {
        demandId: "demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        archiveManifestDigest: `sha256:${"a".repeat(64)}`,
        migrationId: null,
      },
    }));
    assert.equal(archive.plan.payload.disposition, "blocked");
    assert.deepEqual(archive.plan.payload.blockers, [
      { code: "producer-closure-unavailable", scope: "producer" },
    ]);
  assert.deepEqual(readdirSync(path.join(workspaceRoot, ".wakeflow-local/audit/preserved")), []);
});

test("preservation public boundaries reject behavioral input without executing it", (t) => {
  const workspaceRoot = withWorkspace(t, "wakeflow-audit-behavioral-input-");
  let reads = 0;
  const manifest = {};
  Object.defineProperty(manifest, "kind", {
    enumerable: true,
    get() {
      reads += 1;
      return "WakeflowLocalPreservation";
    },
  });
  assert.throws(
    () => validateLocalPreservationManifest(manifest),
    /canonical JSON cannot evaluate an accessor property/u,
  );
  assert.equal(reads, 0);

  const reason = { note: null };
  Object.defineProperty(reason, "code", {
    enumerable: true,
    get() {
      reads += 1;
      return "retired-quarantine";
    },
  });
  assert.throws(
    () => planLocalPreservation(preserveInput(workspaceRoot, { reason })),
    (error) => error?.code === "wakeflow-preservation-contract",
  );
  assert.equal(reads, 0);
});

test("manifest time ordering preserves the declared RFC3339 nanoseconds", () => {
  const base = {
    kind: "WakeflowLocalPreservation",
    schemaVersion: 1,
    programId: PROGRAM_ID,
    preservationId: MIGRATION_PRESERVATION_ID,
    producer: "migration",
    createdAt: "2026-08-08T01:00:00.000000001Z",
    source: {
      relativePath: ".wakeflow-local/preserved/legacy-entry",
      storageClass: "migration-preimage",
      type: "directory",
    },
    reason: { code: "legacy-preservation-migration", note: null },
    payload: {
      treeDigest: { algorithm: "sha256", value: `sha256:${"a".repeat(64)}`, entries: 0 },
      bytes: 0,
    },
    retention: {
      class: "reviewable-local-audit",
      reviewAfter: "2026-08-08T01:00:00.000000002Z",
      requiresExplicitRelease: true,
    },
    links: { demandId: null, archiveManifestDigest: null, migrationId: "migration-ns" },
  };
  assert.doesNotThrow(() => validateLocalPreservationManifest(base));
  assert.throws(
    () => validateLocalPreservationManifest({
      ...base,
      retention: { ...base.retention, reviewAfter: "2026-08-08T01:00:00.000000000Z" },
    }),
    /reviewAfter must follow createdAt/u,
  );
});

test("oversized manifest and manager lock remain bounded corrupt observations", (t) => {
  const workspaceRoot = withWorkspace(t, "wakeflow-audit-bounded-read-");
  const preservationId = "preservation_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const entry = privateDirectory(
    workspaceRoot,
    `.wakeflow-local/audit/preserved/${preservationId}`,
  );
  privateDirectory(workspaceRoot, `.wakeflow-local/audit/preserved/${preservationId}/payload`);
  writePrivate(path.join(entry, "preservation.json"), Buffer.alloc(1024 * 1024 + 1, 0x20));
  writePrivate(
    path.join(workspaceRoot, ".wakeflow-local/audit/manager.lock"),
    Buffer.alloc(64 * 1024 + 1, 0x20),
  );

  const inventory = inspectLocalPreservationInventory({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
  });
  assert.equal(inventory.status, "corrupt");
  assert.equal(inventory.entries.length, 0);
  assert.equal(inventory.managerLock.status, "invalid");
  assert.ok(inventory.issues.some((issue) => issue.code === "wakeflow-preservation-corrupt-manifest"));
  assert.ok(inventory.issues.some((issue) => issue.code === "wakeflow-preservation-manager-lock"));
});

test("single-file preservation publishes and detaches the exact file source", async (t) => {
  const workspaceRoot = withWorkspace(t, "wakeflow-audit-single-file-");
  privateDirectory(workspaceRoot, ".wakeflow-local/runtime-quarantine");
  const source = path.join(workspaceRoot, ".wakeflow-local/runtime-quarantine/source.bin");
  const sourceBytes = Buffer.from([0, 1, 2, 3, 255]);
  writePrivate(source, sourceBytes);
  const planned = planLocalPreservation(preserveInput(workspaceRoot, {
    sourceRef: ".wakeflow-local/runtime-quarantine/source.bin",
  }));
  assert.equal(planned.plan.payload.disposition, "eligible");
  assert.equal(planned.plan.payload.manifest.source.type, "file");
  assert.equal(planned.plan.payload.manifest.payload.treeDigest.entries, 1);
  assert.equal(planned.plan.payload.cleanupInventory.length, 1);

  const result = await applyLocalPreservationPlan({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    ...planned,
  });
  assert.equal(result.status, "completed");
  assert.equal(existsSync(source), false);
  assert.deepEqual(readFileSync(path.join(
    workspaceRoot,
    ...planned.plan.payload.entryRef.split("/"),
    "payload/source.bin",
  )), sourceBytes);
});

test("apply rejects a self-consistent ordinary plan that forges migration producer authority", async (t) => {
  const workspaceRoot = withWorkspace(t, "wakeflow-audit-forged-migration-");
  createLegacySource(workspaceRoot);
  const planned = planLocalPreservation(preserveInput(workspaceRoot));
  const forged = structuredClone(planned.plan);
  forged.payload.manifest.producer = "migration";
  forged.payload.manifest.source.storageClass = "migration-preimage";
  forged.payload.manifest.reason = { code: "forged-migration", note: null };
  forged.payload.manifest.links = {
    demandId: null,
    archiveManifestDigest: null,
    migrationId: "forged-migration",
  };
  forged.payload.manifestDigest = `sha256:${createHash("sha256")
    .update(localPreservationCanonicalBytes(forged.payload.manifest))
    .digest("hex")}`;
  forged.payload.entryDigest = canonicalJsonDigest({
    manifestDigest: forged.payload.manifestDigest,
    payloadTreeDigest: forged.payload.expectedTreeDigest,
  });
  forged.payload.steps[0].staging.digest = forged.payload.entryDigest;
  forged.payload.steps[0].final.digest = forged.payload.entryDigest;

  await assert.rejects(
    () => applyLocalPreservationPlan({
      workspaceRoot,
      expectedProgramId: PROGRAM_ID,
      plan: forged,
      planDigest: canonicalJsonDigest(forged),
    }),
    (error) => error?.code === "wakeflow-preservation-plan",
  );
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local/runtime-quarantine")), true);
  assert.deepEqual(readdirSync(path.join(workspaceRoot, ".wakeflow-local/audit/preserved")), []);
});

test("preserve publishes an isolated exact payload before detaching its legacy source", async (t) => {
  const workspaceRoot = withWorkspace(t);
  const source = createLegacySource(workspaceRoot);
  const planned = planLocalPreservation(preserveInput(workspaceRoot));
  const { payload } = planned.plan;
  assert.equal(payload.disposition, "eligible");
  assert.match(payload.preservationId, /^preservation_[0-9a-f-]+$/u);
  assert.deepEqual(payload.steps.map((step) => step.stepKind), ["audit-publish", "remove"]);
  assert.equal(payload.manifest.source.relativePath, ".wakeflow-local/runtime-quarantine");
  assert.equal(payload.manifest.payload.treeDigest.entries, 5);
  assert.equal(payload.manifest.retention.reviewAfter, AT_REVIEW);
  assert.equal(payload.manifest.reason.note.includes(workspaceRoot), false);
  assert.equal(localPreservationCanonicalBytes(payload.manifest).includes(Buffer.from(workspaceRoot)), false);

  const result = await applyLocalPreservationPlan({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    plan: planned.plan,
    planDigest: planned.planDigest,
  });
  assert.equal(result.status, "completed");
  assert.equal(existsSync(source), false, "source detaches only after the verified entry is published");
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local/audit/manager.lock")), false);

  const entry = path.join(workspaceRoot, ...payload.entryRef.split("/"));
  const preservedPayload = path.join(entry, "payload");
  assert.deepEqual(readFileSync(path.join(preservedPayload, "MANIFEST.md")), Buffer.from("legacy manifest bytes\n"));
  assert.deepEqual(readFileSync(path.join(preservedPayload, "preservation.json")), Buffer.from("legacy payload name\n"));
  assert.equal(lstatSync(path.join(preservedPayload, "preservation.json")).mode & 0o777, 0o400);
  assert.equal(lstatSync(path.join(preservedPayload, "nested")).mode & 0o777, 0o750);
  assert.equal(lstatSync(path.join(preservedPayload, "nested/payload.txt")).mode & 0o777, 0o640);
  assert.equal(lstatSync(path.join(preservedPayload, "manifest-link")).isSymbolicLink(), true);
  assert.equal(readlinkSync(path.join(preservedPayload, "manifest-link")), "MANIFEST.md");
  assert.doesNotThrow(() => validateLocalPreservationManifest(
    JSON.parse(readFileSync(path.join(entry, "preservation.json"), "utf8")),
  ));

  const beforeReview = inspectLocalPreservationInventory({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    reviewedAt: BEFORE_REVIEW,
  });
  assert.equal(beforeReview.status, "current");
  assert.equal(beforeReview.entries[0].status, "valid");
  assert.equal(Object.hasOwn(beforeReview.entries[0], "source"), false);
  assert.equal(Object.hasOwn(beforeReview.entries[0], "note"), false);

  const atReview = inspectLocalPreservationInventory({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    reviewedAt: AT_REVIEW,
  });
  assert.equal(atReview.entries[0].status, "review-eligible");
  assert.equal(atReview.entries[0].payloadTreeDigest, payload.expectedTreeDigest);

  const layoutInventory = inspectLocalPreservationInventoryForLayout({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
  });
  const layout = inspectLayout(workspaceRoot);
  const ownedEvents = layout.items.events.filter((event) => (
    event.preservationId === payload.preservationId
  ));
  assert.equal(ownedEvents.length, 8);
  assert.ok(ownedEvents.every((event) => event.classification === "owner-validated"));
  assert.ok(ownedEvents.every((event) => (
    event.preservationManifestDigest === payload.manifestDigest
    && event.preservationPayloadTreeDigest === payload.expectedTreeDigest
    && event.preservationInventoryDigest === layoutInventory.inventoryDigest
    && event.path === null
    && /^sha256:[0-9a-f]{64}$/u.test(event.pathDigest)
  )));
});

test("release requires exact digest, review time, and explicit per-entry decision", async (t) => {
  const workspaceRoot = withWorkspace(t, "wakeflow-audit-release-");
  createLegacySource(workspaceRoot);
  const preservation = planLocalPreservation(preserveInput(workspaceRoot));
  await applyLocalPreservationPlan({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    plan: preservation.plan,
    planDigest: preservation.planDigest,
  });
  const id = preservation.plan.payload.preservationId;
  const digest = preservation.plan.payload.expectedTreeDigest;

  const early = planLocalPreservationRelease({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    preservationId: id,
    expectedTreeDigest: digest,
    reviewedAt: BEFORE_REVIEW,
    decision: "explicit-release",
  });
  assert.equal(early.plan.payload.disposition, "blocked");
  assert.deepEqual(early.plan.payload.blockers, [{ code: "review-not-eligible", scope: "review" }]);

  const wrongDigest = planLocalPreservationRelease({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    preservationId: id,
    expectedTreeDigest: `sha256:${"f".repeat(64)}`,
    reviewedAt: AT_REVIEW,
    decision: "explicit-release",
  });
  assert.equal(wrongDigest.plan.payload.disposition, "blocked");
  assert.deepEqual(wrongDigest.plan.payload.blockers, [
    { code: "expected-tree-digest-mismatch", scope: "payload" },
  ]);

  const release = planLocalPreservationRelease({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    preservationId: id,
    expectedTreeDigest: digest,
    reviewedAt: AT_REVIEW,
    decision: "explicit-release",
  });
  assert.equal(release.plan.payload.disposition, "eligible");
  assert.equal(release.plan.payload.steps.length, 1);
  assert.equal(release.plan.payload.steps[0].stepKind, "remove");
  const result = await applyLocalPreservationPlan({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    plan: release.plan,
    planDigest: release.planDigest,
  });
  assert.equal(result.status, "completed");
  assert.equal(existsSync(path.join(workspaceRoot, ...release.plan.payload.entryRef.split("/"))), false);
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local/audit/manager.lock")), false);
  const inventory = inspectLocalPreservationInventory({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    reviewedAt: AT_REVIEW,
  });
  assert.equal(inventory.status, "empty");
});

test("source drift and concurrent duplicate apply fail closed around one create-only entry", async (t) => {
  const driftRoot = withWorkspace(t, "wakeflow-audit-drift-");
  createLegacySource(driftRoot);
  const driftPlan = planLocalPreservation(preserveInput(driftRoot));
  const driftFile = path.join(driftRoot, ".wakeflow-local/runtime-quarantine/nested/payload.txt");
  writeFileSync(driftFile, "changed after plan\n");
  chmodSync(driftFile, 0o640);
  await assert.rejects(
    () => applyLocalPreservationPlan({
      workspaceRoot: driftRoot,
      expectedProgramId: PROGRAM_ID,
      ...driftPlan,
    }),
    (error) => /^wakeflow-preservation-(?:blocked|stale)$/u.test(error?.code ?? ""),
  );
  assert.equal(existsSync(path.join(driftRoot, ...driftPlan.plan.payload.entryRef.split("/"))), false);
  assert.equal(existsSync(path.join(driftRoot, ".wakeflow-local/runtime-quarantine")), true);
  assert.equal(existsSync(path.join(driftRoot, ".wakeflow-local/audit/manager.lock")), false);
  assert.deepEqual(readdirSync(maintenanceTransactionsRoot(driftRoot)), []);

  const concurrentRoot = withWorkspace(t, "wakeflow-audit-concurrent-");
  createLegacySource(concurrentRoot);
  const concurrentPlan = planLocalPreservation(preserveInput(concurrentRoot));
  const attempts = await Promise.allSettled([
    applyLocalPreservationPlan({
      workspaceRoot: concurrentRoot,
      expectedProgramId: PROGRAM_ID,
      ...concurrentPlan,
    }),
    applyLocalPreservationPlan({
      workspaceRoot: concurrentRoot,
      expectedProgramId: PROGRAM_ID,
      ...concurrentPlan,
    }),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
  assert.match(
    attempts.find((attempt) => attempt.status === "rejected").reason?.code ?? "",
    /^wakeflow-preservation-(?:blocked|stale|recovery-required)$/u,
  );
  assert.equal(existsSync(path.join(concurrentRoot, ".wakeflow-local/runtime-quarantine")), false);
  assert.deepEqual(readdirSync(path.join(concurrentRoot, ".wakeflow-local/audit/preserved")), [
    concurrentPlan.plan.payload.preservationId,
  ]);
  assert.deepEqual(readdirSync(maintenanceTransactionsRoot(concurrentRoot)), []);
  assert.equal(existsSync(path.join(concurrentRoot, ".wakeflow-local/audit/manager.lock")), false);
});

test("T02 recovery resumes a same-parent publish EXDEV without copy-delete fallback", async (t) => {
  const workspaceRoot = withWorkspace(t, "wakeflow-audit-publish-recovery-");
  const source = createLegacySource(workspaceRoot);
  const planned = planLocalPreservation(preserveInput(workspaceRoot));
  const operationId = interruptPreservationMutation(workspaceRoot, planned, "publish-exdev");
  const publishStage = path.join(
    workspaceRoot,
    ...planned.plan.payload.steps[0].staging.ref.split("/"),
  );
  const finalEntry = path.join(workspaceRoot, ...planned.plan.payload.entryRef.split("/"));
  assert.equal(existsSync(source), true, "EXDEV must never trigger copy-delete of the source");
  assert.equal(existsSync(publishStage), true);
  assert.equal(existsSync(finalEntry), false);

  const recovered = await recoverLocalPreservationMutation({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    operationId,
    ...planned,
  });
  assert.equal(recovered.operationId, operationId);
  assert.ok(recovered.recoveryGeneration >= 1);
  assert.match(recovered.status, /recovered|completed/u);
  assert.equal(existsSync(source), false);
  assert.equal(existsSync(publishStage), false);
  assert.equal(existsSync(finalEntry), true);
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local/audit/manager.lock")), false);
  assert.deepEqual(readdirSync(maintenanceTransactionsRoot(workspaceRoot)), []);
});

test("T02 recovery completes deterministic partial cleanup for preserve and release", async (t) => {
  const preserveRoot = withWorkspace(t, "wakeflow-audit-detach-recovery-");
  createLegacySource(preserveRoot);
  const preservePlan = planLocalPreservation(preserveInput(preserveRoot));
  const preserveOperationId = interruptPreservationMutation(
    preserveRoot,
    preservePlan,
    "cleanup-eio",
  );
  const detachStage = path.join(
    preserveRoot,
    ...preservePlan.plan.payload.steps[1].staging.ref.split("/"),
  );
  assert.equal(existsSync(path.join(preserveRoot, ".wakeflow-local/runtime-quarantine")), false);
  assert.equal(existsSync(detachStage), true);
  assert.equal(existsSync(path.join(preserveRoot, ...preservePlan.plan.payload.entryRef.split("/"))), true);
  const preserveRecovered = await recoverLocalPreservationMutation({
    workspaceRoot: preserveRoot,
    expectedProgramId: PROGRAM_ID,
    operationId: preserveOperationId,
    ...preservePlan,
  });
  assert.equal(preserveRecovered.operationId, preserveOperationId);
  assert.match(preserveRecovered.status, /recovered|completed/u);
  assert.equal(existsSync(detachStage), false);
  assert.equal(existsSync(path.join(preserveRoot, ".wakeflow-local/audit/manager.lock")), false);
  assert.deepEqual(readdirSync(maintenanceTransactionsRoot(preserveRoot)), []);

  const releaseRoot = withWorkspace(t, "wakeflow-audit-release-recovery-");
  createLegacySource(releaseRoot);
  const preserved = planLocalPreservation(preserveInput(releaseRoot));
  await applyLocalPreservationPlan({
    workspaceRoot: releaseRoot,
    expectedProgramId: PROGRAM_ID,
    ...preserved,
  });
  const releasePlan = planLocalPreservationRelease({
    workspaceRoot: releaseRoot,
    expectedProgramId: PROGRAM_ID,
    preservationId: preserved.plan.payload.preservationId,
    expectedTreeDigest: preserved.plan.payload.expectedTreeDigest,
    reviewedAt: AT_REVIEW,
    decision: "explicit-release",
  });
  const releaseOperationId = interruptPreservationMutation(
    releaseRoot,
    releasePlan,
    "cleanup-eio",
  );
  const releaseStage = path.join(
    releaseRoot,
    ...releasePlan.plan.payload.steps[0].staging.ref.split("/"),
  );
  assert.equal(existsSync(path.join(releaseRoot, ...releasePlan.plan.payload.entryRef.split("/"))), false);
  assert.equal(existsSync(releaseStage), true);
  const releaseRecovered = await recoverLocalPreservationMutation({
    workspaceRoot: releaseRoot,
    expectedProgramId: PROGRAM_ID,
    operationId: releaseOperationId,
    ...releasePlan,
  });
  assert.equal(releaseRecovered.operationId, releaseOperationId);
  assert.match(releaseRecovered.status, /recovered|completed/u);
  assert.equal(existsSync(releaseStage), false);
  assert.equal(existsSync(path.join(releaseRoot, ".wakeflow-local/audit/manager.lock")), false);
  assert.deepEqual(readdirSync(maintenanceTransactionsRoot(releaseRoot)), []);
});

test("migration hold planning is deterministic, caller-ID bound, private, and zero-write", (t) => {
  const workspaceRoot = withWorkspace(t, "wakeflow-audit-migration-hold-plan-");
  createLegacyPreservedEntry(workspaceRoot);
  const preservedRoot = path.join(workspaceRoot, ".wakeflow-local/audit/preserved");
  const first = planMigrationSourceRetainedPreservation(migrationHoldInput(workspaceRoot));
  const second = planMigrationSourceRetainedPreservation(migrationHoldInput(workspaceRoot));

  assert.deepEqual(second, first);
  assert.equal(first.plan.payload.operation, "migration-hold");
  assert.equal(first.plan.payload.preservationId, MIGRATION_PRESERVATION_ID);
  assert.equal(first.plan.payload.manifest.producer, "migration");
  assert.equal(first.plan.payload.manifest.reason.note, null);
  assert.equal(first.plan.payload.steps.length, 1);
  assert.equal(first.plan.payload.steps[0].stepKind, "audit-publish");
  assert.equal(first.plan.payload.retainedSource.ref, migrationHoldInput(workspaceRoot).sourceRef);
  assert.equal(first.plan.payload.retainedSource.digest, first.plan.payload.expectedTreeDigest);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.plan.payload.retainedSource), true);
  assert.deepEqual(readdirSync(preservedRoot), []);
  assert.equal(JSON.stringify(first).includes(workspaceRoot), false);
});

test("migration hold publishes exact payload while retaining the exact source and replans identically", async (t) => {
  const workspaceRoot = withWorkspace(t, "wakeflow-audit-migration-hold-apply-");
  const source = createLegacyPreservedEntry(workspaceRoot);
  const sourceManifest = readFileSync(path.join(source, "MANIFEST.md"));
  const sourcePayload = readFileSync(path.join(source, "payload.bin"));
  const planned = planMigrationSourceRetainedPreservation(migrationHoldInput(workspaceRoot));

  await assert.rejects(
    applyLocalPreservationPlan({
      workspaceRoot,
      expectedProgramId: PROGRAM_ID,
      ...planned,
    }),
    (error) => error?.code === "wakeflow-preservation-contract",
  );

  const applied = await runMigrationHold(workspaceRoot, planned);
  assert.equal(applied.status, "completed");
  assert.deepEqual(readFileSync(path.join(source, "MANIFEST.md")), sourceManifest);
  assert.deepEqual(readFileSync(path.join(source, "payload.bin")), sourcePayload);
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local/audit/manager.lock")), false);
  const entry = path.join(workspaceRoot, ...planned.plan.payload.entryRef.split("/"));
  assert.deepEqual(readFileSync(path.join(entry, "payload/MANIFEST.md")), sourceManifest);
  assert.deepEqual(readFileSync(path.join(entry, "payload/payload.bin")), sourcePayload);

  const replayPlan = planMigrationSourceRetainedPreservation(migrationHoldInput(workspaceRoot));
  assert.deepEqual(replayPlan, planned);
  const replayParticipant = createMigrationSourceRetainedPreservationParticipant({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    admission: "apply",
    confirmedPlan: replayPlan.plan,
  });
  assert.deepEqual(await replayParticipant.deriveCurrentPlan(), planned.plan);
  assert.deepEqual(readFileSync(path.join(source, "payload.bin")), sourcePayload);
  assert.deepEqual(readdirSync(maintenanceTransactionsRoot(workspaceRoot)), []);
});

test("migration hold source drift fails before audit publication", async (t) => {
  const workspaceRoot = withWorkspace(t, "wakeflow-audit-migration-hold-drift-");
  const source = createLegacyPreservedEntry(workspaceRoot);
  const planned = planMigrationSourceRetainedPreservation(migrationHoldInput(workspaceRoot));
  writePrivate(path.join(source, "late.txt"), Buffer.from("late drift\n"));

  await assert.rejects(
    runMigrationHold(workspaceRoot, planned),
    (error) => /(?:stale|authority|plan)/u.test(error?.code ?? ""),
  );
  assert.equal(existsSync(path.join(workspaceRoot, ...planned.plan.payload.entryRef.split("/"))), false);
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local/audit/manager.lock")), false);
});

test("migration hold recovery resumes the exact publish stage without detaching source", async (t) => {
  const workspaceRoot = withWorkspace(t, "wakeflow-audit-migration-hold-recovery-");
  const source = createLegacyPreservedEntry(workspaceRoot);
  const sourcePayload = readFileSync(path.join(source, "payload.bin"));
  const planned = planMigrationSourceRetainedPreservation(migrationHoldInput(workspaceRoot));
  const operationId = interruptMigrationHoldPublish(workspaceRoot, planned);
  const publishStage = path.join(workspaceRoot, ...planned.plan.payload.steps[0].staging.ref.split("/"));
  assert.equal(existsSync(publishStage), true);
  assert.equal(existsSync(source), true);

  const participant = createMigrationSourceRetainedPreservationParticipant({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    admission: "recovery",
    confirmedPlan: planned.plan,
  });
  const recovered = await recoverWakeflowWorkspaceMutation({
    workspaceRoot,
    operationId,
    confirmedPlan: planned.plan,
    planDigest: planned.planDigest,
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
  assert.match(recovered.status, /recovered|completed/u);
  assert.equal(existsSync(publishStage), false);
  assert.equal(existsSync(path.join(workspaceRoot, ...planned.plan.payload.entryRef.split("/"))), true);
  assert.deepEqual(readFileSync(path.join(source, "payload.bin")), sourcePayload);
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local/audit/manager.lock")), false);
  assert.deepEqual(readdirSync(maintenanceTransactionsRoot(workspaceRoot)), []);
});

test("ordinary preservation cannot impersonate the migration-only retained-hold owner", (t) => {
  const workspaceRoot = withWorkspace(t, "wakeflow-audit-migration-");
  const legacyEntry = privateDirectory(workspaceRoot, ".wakeflow-local/preserved/legacy-entry");
  const oldManifest = Buffer.from("# Legacy preservation manifest\n\nExact historical bytes.\n");
  writePrivate(path.join(legacyEntry, "MANIFEST.md"), oldManifest, 0o400);
  writePrivate(path.join(legacyEntry, "payload.bin"), Buffer.from([0, 1, 2, 255]), 0o600);
  assert.throws(
    () => planLocalPreservation(preserveInput(workspaceRoot, {
      producer: "migration",
      sourceRef: ".wakeflow-local/preserved/legacy-entry",
      storageClass: "migration-preimage",
      reason: { code: "legacy-preservation-migration", note: null },
      links: {
        demandId: null,
        archiveManifestDigest: null,
        migrationId: "local-preservation-v2",
      },
    })),
    (error) => error?.code === "wakeflow-preservation-contract",
  );
  assert.equal(existsSync(legacyEntry), true);
  assert.deepEqual(readFileSync(path.join(legacyEntry, "MANIFEST.md")), oldManifest);
  assert.deepEqual(readdirSync(path.join(workspaceRoot, ".wakeflow-local/audit/preserved")), []);
});

test("hard-linked sources and payload drift fail closed without automatic release", async (t) => {
  const workspaceRoot = withWorkspace(t, "wakeflow-audit-tamper-");
  const source = privateDirectory(workspaceRoot, ".wakeflow-local/runtime-quarantine");
  const first = path.join(source, "first.txt");
  writePrivate(first, Buffer.from("same inode\n"));
  linkSync(first, path.join(source, "second.txt"));
  const blocked = planLocalPreservation(preserveInput(workspaceRoot));
  assert.equal(blocked.plan.payload.disposition, "blocked");
  assert.deepEqual(blocked.plan.payload.blockers, [
    { code: "unsupported-entry", scope: "source" },
  ]);

  rmSync(source, { recursive: true, force: true });
  createLegacySource(workspaceRoot);
  const planned = planLocalPreservation(preserveInput(workspaceRoot));
  await applyLocalPreservationPlan({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    plan: planned.plan,
    planDigest: planned.planDigest,
  });
  const payloadFile = path.join(
    workspaceRoot,
    ...planned.plan.payload.entryRef.split("/"),
    "payload/nested/payload.txt",
  );
  chmodSync(payloadFile, 0o600);
  writeFileSync(payloadFile, "tampered\n");
  chmodSync(payloadFile, 0o640);
  const inventory = inspectLocalPreservationInventory({
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    reviewedAt: AT_REVIEW,
  });
  assert.equal(inventory.status, "corrupt");
  assert.equal(inventory.entries.length, 0);
  assert.equal(inventory.issues.length, 1);
  const layout = inspectLayout(workspaceRoot);
  assert.ok(layout.items.events.some((event) => (
    event.classification === "owner-validator-invalid"
    && event.ownerValidationCode === "wakeflow-preservation-digest-mismatch"
  )));
  assert.equal(existsSync(path.dirname(path.dirname(payloadFile))), true);
  assert.throws(
    () => planLocalPreservationRelease({
      workspaceRoot,
      expectedProgramId: PROGRAM_ID,
      preservationId: planned.plan.payload.preservationId,
      expectedTreeDigest: planned.plan.payload.expectedTreeDigest,
      reviewedAt: AT_REVIEW,
      decision: "explicit-release",
    }),
    /(?:digest|preservation|authority)/iu,
  );
});
