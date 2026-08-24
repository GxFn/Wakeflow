import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { hostProfile } from "../../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  WAKEFLOW_MIGRATION_APPLY_PHASES,
} from "../../core/scripts/lib/wakeflow-migration-apply.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  createMigrationFixturePlan,
} from "./wakeflow-migration-v3-fixture.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");
const CODEX_ARTIFACT = path.join(REPOSITORY_ROOT, "plugins/codex-wakeflow");
const LEGACY_CONFIG = path.join(
  REPOSITORY_ROOT,
  "test/fixtures/legacy-origins/codex-0.9.6-70d79d72/static/shared-setup/WakeflowFixture/wakeflow.config.json",
);

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fileContract(ref, type, mode = null, digest = null) {
  return type === "absent" ? { ref, type } : { ref, type, mode, digest };
}

export function createCodexMigrationApplyFixture(t, { prepareWorkspace = () => {} } = {}) {
  const workspaceRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-migration-apply-")));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  copyFileSync(LEGACY_CONFIG, path.join(workspaceRoot, "wakeflow.config.json"));
  prepareWorkspace(workspaceRoot);
  const migrationPlan = createMigrationFixturePlan({
    bootstrapArtifactRoot: CODEX_ARTIFACT,
    hostProfile,
    legacyOwnerArtifactRoot: CODEX_ARTIFACT,
    workspaceRoot,
  });
  return { migrationPlan, workspaceRoot };
}

export function observeMigrationApplyFixtureResource(workspaceRoot, contract) {
  const target = path.join(workspaceRoot, ...contract.ref.split("/"));
  if (!existsSync(target)) return { ref: contract.ref, type: "absent" };
  const stat = lstatSync(target);
  if (!stat.isFile()) throw new Error(`${contract.ref} must remain one regular fixture file`);
  return {
    ref: contract.ref,
    type: "file",
    mode: `0${(stat.mode & 0o777).toString(8).padStart(3, "0")}`,
    digest: sha256(readFileSync(target)),
  };
}

export function createMigrationApplyPhaseFixtures(
  migrationPlan,
  { includePhysicalStep = true } = {},
) {
  const targetBytes = Buffer.from("migration target authority fixture\n");
  const finalRef = ".wakeflow-local/migration-target-authority.fixture";
  const stageRef = ".wakeflow-local/.migration-target-authority.fixture.stage";
  const step = {
    stepId: "migration-target-authority-fixture",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(finalRef, "absent"),
    staging: fileContract(stageRef, "file", "0600", sha256(targetBytes)),
    final: fileContract(finalRef, "file", "0600", sha256(targetBytes)),
  };
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
  const byPhase = new Map(migrationPlan.payload.commitPhases.map((entry) => [entry.phase, entry]));
  const snapshots = WAKEFLOW_MIGRATION_APPLY_PHASES.map((phase) => ({
    phase,
    ownerId: `test-${phase}`,
    snapshot: {
      schemaId: `urn:wakeflow:internal:test-migration-${phase}-plan:v1`,
      payload: {
        steps: phase === "target-authority" && includePhysicalStep ? [step] : [],
      },
    },
    unitIds: byPhase.get(phase).unitIds,
    targetKeys: phase === "target-authority" ? targetKeys : [],
    blockerIds: phase === "target-authority" ? blockers : [],
    dependencyIds: phase === "target-authority" ? dependencies : [],
    manualUnitIds: phase === "target-authority" ? manualUnits : [],
  }));
  return { snapshots, step, targetBytes };
}

export function createMigrationApplyPhaseParticipants({
  workspaceRoot,
  snapshots,
  step,
  targetBytes,
  targetHandler = {},
}) {
  return snapshots.map((entry) => ({
    phase: entry.phase,
    snapshotDigest: canonicalJsonDigest(entry.snapshot),
    participant: {
      validatePlan: ({ plan: candidate }) => {
        if (canonicalJson(candidate) !== canonicalJson(entry.snapshot)) {
          throw new Error(`${entry.phase} received another owner plan`);
        }
        return { valid: true };
      },
      deriveCurrentPlan: async () => entry.snapshot,
      deriveTerminalClosure: async ({ planDigest }) => ({
        planDigest,
        closureDigests: [{
          name: `test-${entry.phase}`,
          digest: canonicalJsonDigest({ phase: entry.phase, planDigest }),
        }],
      }),
      stepHandlers: entry.phase === "target-authority" ? {
        [step.stepId]: {
          prepare: async () => {
            const stage = path.join(workspaceRoot, ...step.staging.ref.split("/"));
            mkdirSync(path.dirname(stage), { recursive: true, mode: 0o700 });
            writeFileSync(stage, targetBytes, { mode: 0o600 });
            chmodSync(stage, 0o600);
          },
          observe: async () => ({
            source: observeMigrationApplyFixtureResource(workspaceRoot, step.source),
            staging: observeMigrationApplyFixtureResource(workspaceRoot, step.staging),
            final: observeMigrationApplyFixtureResource(workspaceRoot, step.final),
          }),
          commit: async () => renameSync(
            path.join(workspaceRoot, ...step.staging.ref.split("/")),
            path.join(workspaceRoot, ...step.final.ref.split("/")),
          ),
          ...targetHandler,
        },
      } : {},
    },
  }));
}
