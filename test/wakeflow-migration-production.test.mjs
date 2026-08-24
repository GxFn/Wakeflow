import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hostProfile as codexHostProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  WAKEFLOW_PRODUCTION_MIGRATION_KIND,
  WAKEFLOW_PRODUCTION_MIGRATION_PHASE_SCHEMA_ID,
  WAKEFLOW_PRODUCTION_MIGRATION_SCHEMA_VERSION,
  WakeflowProductionMigrationError,
  createWakeflowProductionMigrationParticipant,
  planWakeflowProductionMigration,
  recoverWakeflowProductionMigration,
  restoreWakeflowProductionMigrationComposition,
  runWakeflowProductionMigrationApply,
} from "../core/scripts/lib/wakeflow-migration-production.mjs";
import {
  runWakeflowMigrationApply,
} from "../core/scripts/lib/wakeflow-migration-apply.mjs";
import {
  parseWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import {
  canonicalJson,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowAssetBundle,
} from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import {
  buildWakeflowAssetBundle,
} from "../tools/build-asset-bundle.mjs";
import {
  createMigrationFixturePlan,
} from "./support/wakeflow-migration-v3-fixture.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const ARTIFACT_ROOT = path.join(REPOSITORY_ROOT, "plugins/codex-wakeflow");
const LEGACY_CONFIG = path.join(
  REPOSITORY_ROOT,
  "test/fixtures/legacy-origins/codex-0.9.6-70d79d72/static/shared-setup/WakeflowFixture/wakeflow.config.json",
);
const BUNDLE = parseWakeflowAssetBundle(buildWakeflowAssetBundle({
  sourceRoot: path.join(REPOSITORY_ROOT, "core/template-sources"),
}));
const V3_CONFIG_LIMIT = 1024 * 1024;

function paddedLegacyConfig(byteLength) {
  const source = readFileSync(LEGACY_CONFIG);
  assert.ok(source.length <= byteLength);
  return Buffer.concat([source, Buffer.alloc(byteLength - source.length, 0x20)]);
}

function fixture(t, { opaqueSource = false, legacyConfigBytes = null } = {}) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-production-migration-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspaceRoot = path.join(base, "WakeflowFixture");
  const productRoot = path.join(base, "ProductWorkspace");
  mkdirSync(workspaceRoot, { mode: 0o755 });
  mkdirSync(productRoot, { mode: 0o755 });
  const configFile = path.join(workspaceRoot, "wakeflow.config.json");
  if (legacyConfigBytes === null) copyFileSync(LEGACY_CONFIG, configFile);
  else writeFileSync(configFile, legacyConfigBytes, { mode: 0o644 });
  chmodSync(configFile, 0o644);
  if (opaqueSource) {
    const unknownRoot = path.join(workspaceRoot, ".wakeflow-local", "unsupported-owner");
    mkdirSync(unknownRoot, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(unknownRoot, "opaque.bin"), Buffer.from([0xff, 0x00, 0x7f]));
  }
  const migrationPlan = createMigrationFixturePlan({
    bootstrapArtifactRoot: ARTIFACT_ROOT,
    hostProfile: codexHostProfile,
    legacyOwnerArtifactRoot: ARTIFACT_ROOT,
    workspaceRoot,
  });
  const plan = () => planWakeflowProductionMigration({
    workspaceRoot,
    migrationPlan,
    hostProfile: codexHostProfile,
    bundle: BUNDLE,
    hostSettingsAssetsAdapter: null,
  });
  return { workspaceRoot, productRoot, migrationPlan, plan };
}

function transactionRoot(workspaceRoot) {
  return path.join(workspaceRoot, ".wakeflow-local/runtime/maintenance/transactions");
}

function singleJournal(workspaceRoot) {
  const root = transactionRoot(workspaceRoot);
  const names = readdirSync(root).filter((name) => /^workspace-mutation_[0-9a-f-]+\.json$/u.test(name));
  assert.equal(names.length, 1);
  return JSON.parse(readFileSync(path.join(root, names[0]), "utf8"));
}

function assertTerminalWorkspace(fixtureValue, composition) {
  const model = parseWakeflowConfigV3(JSON.parse(readFileSync(
    path.join(fixtureValue.workspaceRoot, "wakeflow.config.json"),
    "utf8",
  )));
  assert.deepEqual(model, composition.migrationApplyPlan.payload.migrationPlan.payload.target.desiredModel);
  assert.equal(existsSync(path.join(fixtureValue.workspaceRoot, ".wakeflow-active/index.md")), true);
  assert.equal(existsSync(path.join(fixtureValue.workspaceRoot, ".wakeflow-local/runtime")), true);
  assert.equal(existsSync(path.join(fixtureValue.workspaceRoot, "wakeflow-ledger")), true);
  assert.equal(existsSync(path.join(fixtureValue.workspaceRoot, composition.configOwnerPlan.payload.stageRef)), false);
  assert.equal(existsSync(path.join(fixtureValue.workspaceRoot, composition.configOwnerPlan.payload.predecessorRef)), false);
  assert.equal(existsSync(path.join(fixtureValue.workspaceRoot, composition.configOwnerPlan.payload.releaseRef)), false);
  assert.equal(existsSync(path.join(fixtureValue.workspaceRoot, ".wakeflow-local/runtime/maintenance.lock")), false);
  assert.deepEqual(readdirSync(transactionRoot(fixtureValue.workspaceRoot)), []);
  assert.deepEqual(readdirSync(fixtureValue.productRoot), ["AGENTS.md"]);
}

function crashingParticipant(participant, stepId) {
  const original = participant.stepHandlers[stepId];
  assert.ok(original);
  assert.equal(typeof original.commit, "function");
  return Object.freeze({
    ...participant,
    stepHandlers: Object.freeze({
      ...participant.stepHandlers,
      [stepId]: Object.freeze({
        ...original,
        async commit(value) {
          await original.commit(value);
          throw new Error(`simulated process loss after ${stepId}`);
        },
      }),
    }),
  });
}

function crashingPrepareParticipant(participant, stepId) {
  const original = participant.stepHandlers[stepId];
  assert.ok(original);
  assert.equal(typeof original.prepare, "function");
  return Object.freeze({
    ...participant,
    stepHandlers: Object.freeze({
      ...participant.stepHandlers,
      [stepId]: Object.freeze({
        ...original,
        async prepare(value) {
          await original.prepare(value);
          throw new Error(`simulated process loss after preparing ${stepId}`);
        },
      }),
    }),
  });
}

test("M6-T10 production migration exposes one five-phase, restorable owner composition", () => {
  assert.equal(WAKEFLOW_PRODUCTION_MIGRATION_KIND, "WakeflowProductionMigrationComposition");
  assert.equal(WAKEFLOW_PRODUCTION_MIGRATION_SCHEMA_VERSION, 1);
  assert.equal(
    WAKEFLOW_PRODUCTION_MIGRATION_PHASE_SCHEMA_ID,
    "urn:wakeflow:internal:migration-production-phase-plan:v1",
  );
  assert.equal(typeof WakeflowProductionMigrationError, "function");
  assert.equal(typeof planWakeflowProductionMigration, "function");
  assert.equal(typeof restoreWakeflowProductionMigrationComposition, "function");
  assert.equal(typeof runWakeflowProductionMigrationApply, "function");
  assert.equal(typeof recoverWakeflowProductionMigration, "function");
});

test("config-only preview is zero-write, complete, deterministic, and self-sufficient for recovery", (t) => {
  const value = fixture(t);
  const before = readFileSync(path.join(value.workspaceRoot, "wakeflow.config.json"));
  const first = value.plan();
  const second = value.plan();
  assert.equal(first.status, "ready");
  assert.deepEqual(second, first);
  assert.deepEqual(readFileSync(path.join(value.workspaceRoot, "wakeflow.config.json")), before);
  assert.deepEqual(readdirSync(value.workspaceRoot), ["wakeflow.config.json"]);
  assert.equal(first.migrationApplyPlan.payload.status, "ready");
  assert.deepEqual(
    first.migrationApplyPlan.payload.phaseSnapshots.map((entry) => entry.phase),
    [
      "target-authority",
      "archive-or-preservation",
      "managed-surfaces",
      "derived-projections",
      "exact-source-release",
    ],
  );
  const phases = new Map(first.migrationApplyPlan.payload.phaseSnapshots.map((entry) => [entry.phase, entry]));
  assert.equal(phases.get("target-authority").snapshot.payload.steps.length, 1);
  assert.equal(phases.get("archive-or-preservation").snapshot.payload.steps.length, 0);
  assert.ok(phases.get("managed-surfaces").snapshot.payload.steps.length > 0);
  assert.ok(phases.get("derived-projections").snapshot.payload.steps.length > 0);
  assert.equal(phases.get("exact-source-release").snapshot.payload.steps.length, 1);
  assert.ok(phases.get("target-authority").snapshot.payload.recoverySeed);
  for (const phase of ["archive-or-preservation", "managed-surfaces", "derived-projections", "exact-source-release"]) {
    assert.equal(phases.get(phase).snapshot.payload.recoverySeed, null);
  }
  assert.deepEqual(
    restoreWakeflowProductionMigrationComposition({ migrationApplyPlan: first.migrationApplyPlan }),
    first,
  );
  assert.equal(canonicalJson(first).includes(value.workspaceRoot), false);
  assert.equal(canonicalJson(first).includes(ARTIFACT_ROOT), false);
});

test("production composition and replan admission stay passive and exact", async (t) => {
  const value = fixture(t);
  const composition = value.plan();
  let lengthReads = 0;
  const behavioral = { ...composition, reasonCodes: {} };
  Object.defineProperty(behavioral.reasonCodes, "length", {
    enumerable: true,
    get() {
      lengthReads += 1;
      return 0;
    },
  });
  assert.throws(
    () => createWakeflowProductionMigrationParticipant({
      workspaceRoot: value.workspaceRoot,
      composition: behavioral,
      hostProfile: codexHostProfile,
      bundle: BUNDLE,
      hostSettingsAssetsAdapter: null,
      admission: "apply",
      replan: value.plan,
    }),
    (error) => error?.code === "wakeflow-production-migration-plan",
  );
  assert.equal(lengthReads, 0);

  assert.throws(
    () => createWakeflowProductionMigrationParticipant({
      workspaceRoot: value.workspaceRoot,
      composition,
      hostProfile: codexHostProfile,
      bundle: BUNDLE,
      hostSettingsAssetsAdapter: null,
      admission: "apply",
      replan: () => ({ ...value.plan(), unownedField: true }),
    }),
    (error) => error?.code === "wakeflow-production-migration-stale",
  );

  const mutableInput = {
    workspaceRoot: value.workspaceRoot,
    composition,
    hostProfile: codexHostProfile,
    bundle: BUNDLE,
    hostSettingsAssetsAdapter: null,
    admission: "apply",
    replan: null,
  };
  mutableInput.replan = () => {
    mutableInput.admission = "recovery";
    mutableInput.replan = null;
    return value.plan();
  };
  const participant = createWakeflowProductionMigrationParticipant(mutableInput);
  await assert.rejects(
    () => participant.deriveCurrentPlan({ context: null }),
    (error) => error?.code === "wakeflow-migration-apply-admission",
  );
});

test("production preview admits an exact legacy source above the new v3 config limit", (t) => {
  const value = fixture(t, {
    legacyConfigBytes: paddedLegacyConfig(V3_CONFIG_LIMIT + 1),
  });
  assert.equal(value.migrationPlan.payload.status, "ready");
  assert.deepEqual(value.migrationPlan.payload.blockers, []);
  const composition = value.plan();
  assert.equal(composition.status, "ready");
  assert.deepEqual(composition.reasonCodes, []);
});

test("the production composition applies the complete v3 tree and releases only its exact legacy source", async (t) => {
  const value = fixture(t);
  const composition = value.plan();
  let replanCalls = 0;
  const result = await runWakeflowProductionMigrationApply({
    workspaceRoot: value.workspaceRoot,
    composition,
    hostProfile: codexHostProfile,
    bundle: BUNDLE,
    hostSettingsAssetsAdapter: null,
    replan: () => {
      replanCalls += 1;
      return value.plan();
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(replanCalls, 1);
  assertTerminalWorkspace(value, composition);
});

test("recovery stops at future-owner drift without rolling back an earlier confirmed phase", async (t) => {
  const value = fixture(t);
  const composition = value.plan();
  const before = readFileSync(path.join(value.workspaceRoot, "wakeflow.config.json"));
  const targetPhase = composition.migrationApplyPlan.payload.phaseSnapshots.find(
    (entry) => entry.phase === "target-authority",
  );
  const stepId = targetPhase.snapshot.payload.steps[0].stepId;
  const participant = createWakeflowProductionMigrationParticipant({
    workspaceRoot: value.workspaceRoot,
    composition,
    hostProfile: codexHostProfile,
    bundle: BUNDLE,
    hostSettingsAssetsAdapter: null,
    admission: "apply",
    replan: value.plan,
  });
  await assert.rejects(
    () => runWakeflowMigrationApply({
      workspaceRoot: value.workspaceRoot,
      confirmedPlan: composition.migrationApplyPlan,
      planDigest: composition.migrationApplyPlanDigest,
      participant: crashingPrepareParticipant(participant, stepId),
    }),
    (error) => error?.code === "wakeflow-mutation-recovery-required",
  );
  const journal = singleJournal(value.workspaceRoot);
  const futureOwnerPath = path.join(value.workspaceRoot, ".wakeflow-local/audit");
  writeFileSync(futureOwnerPath, "foreign future-owner state\n", { mode: 0o600 });
  chmodSync(futureOwnerPath, 0o600);

  await assert.rejects(
    () => recoverWakeflowProductionMigration({
      workspaceRoot: value.workspaceRoot,
      operationId: journal.operationId,
      composition: restoreWakeflowProductionMigrationComposition({
        migrationApplyPlan: composition.migrationApplyPlan,
      }),
      hostProfile: codexHostProfile,
      bundle: BUNDLE,
      hostSettingsAssetsAdapter: null,
    }),
  );
  assert.notDeepEqual(readFileSync(path.join(value.workspaceRoot, "wakeflow.config.json")), before);
  assert.deepEqual(
    parseWakeflowConfigV3(JSON.parse(readFileSync(
      path.join(value.workspaceRoot, "wakeflow.config.json"),
      "utf8",
    ))),
    composition.migrationApplyPlan.payload.migrationPlan.payload.target.desiredModel,
  );
  assert.equal(readFileSync(futureOwnerPath, "utf8"), "foreign future-owner state\n");
});

test("every physical production phase resumes forward from the same confirmed plan", async (t) => {
  for (const phase of ["target-authority", "managed-surfaces", "derived-projections", "exact-source-release"]) {
    await t.test(phase, async (t) => {
      const value = fixture(t);
      const composition = value.plan();
      const phasePlan = composition.migrationApplyPlan.payload.phaseSnapshots.find((entry) => entry.phase === phase);
      assert.ok(phasePlan.snapshot.payload.steps.length > 0);
      const stepId = phasePlan.snapshot.payload.steps[0].stepId;
      const participant = createWakeflowProductionMigrationParticipant({
        workspaceRoot: value.workspaceRoot,
        composition,
        hostProfile: codexHostProfile,
        bundle: BUNDLE,
        hostSettingsAssetsAdapter: null,
        admission: "apply",
        replan: value.plan,
      });
      await assert.rejects(
        () => runWakeflowMigrationApply({
          workspaceRoot: value.workspaceRoot,
          confirmedPlan: composition.migrationApplyPlan,
          planDigest: composition.migrationApplyPlanDigest,
          participant: crashingParticipant(participant, stepId),
        }),
        (error) => error?.code === "wakeflow-mutation-recovery-required",
      );
      const journal = singleJournal(value.workspaceRoot);
      const restored = restoreWakeflowProductionMigrationComposition({
        migrationApplyPlan: composition.migrationApplyPlan,
      });
      const recovered = await recoverWakeflowProductionMigration({
        workspaceRoot: value.workspaceRoot,
        operationId: journal.operationId,
        composition: restored,
        hostProfile: codexHostProfile,
        bundle: BUNDLE,
        hostSettingsAssetsAdapter: null,
      });
      assert.equal(recovered.status, "recovered");
      assertTerminalWorkspace(value, composition);
    });
  }
});

test("source drift and unsupported source cohorts stay blocked without a Wakeflow mutation", (t) => {
  const drift = fixture(t);
  const composition = drift.plan();
  const configFile = path.join(drift.workspaceRoot, "wakeflow.config.json");
  writeFileSync(configFile, Buffer.concat([readFileSync(configFile), Buffer.from("\n")]));
  assert.throws(
    () => createWakeflowProductionMigrationParticipant({
      workspaceRoot: drift.workspaceRoot,
      composition,
      hostProfile: codexHostProfile,
      bundle: BUNDLE,
      hostSettingsAssetsAdapter: null,
      admission: "apply",
      replan: drift.plan,
    }),
    (error) => error?.code === "wakeflow-production-migration-stale",
  );
  assert.equal(existsSync(path.join(drift.workspaceRoot, ".wakeflow-local")), false);

  const unsupported = fixture(t, { opaqueSource: true });
  const before = readdirSync(unsupported.workspaceRoot);
  const blocked = unsupported.plan();
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.reasonCodes.length > 0);
  assert.deepEqual(readdirSync(unsupported.workspaceRoot), before);
  assert.deepEqual(
    readFileSync(path.join(unsupported.workspaceRoot, ".wakeflow-local/unsupported-owner/opaque.bin")),
    Buffer.from([0xff, 0x00, 0x7f]),
  );
});
