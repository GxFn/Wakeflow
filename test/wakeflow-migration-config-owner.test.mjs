import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  WAKEFLOW_MIGRATION_CONFIG_OWNER_KIND,
  WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_ID,
  WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_VERSION,
  WakeflowMigrationConfigOwnerError,
  assertWakeflowMigrationConfigOwnerPlanAgainstMigrationPlan,
  createWakeflowMigrationConfigOwnerParticipant,
  planWakeflowMigrationConfigOwner,
  validateWakeflowMigrationConfigOwnerPlan,
} from "../core/scripts/lib/wakeflow-migration-config-owner.mjs";
import {
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import {
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  withWakeflowRuntimeMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";
import {
  createCodexMigrationApplyFixture,
} from "./support/wakeflow-migration-apply-fixture.mjs";

const LEGACY_CONFIG_LIMIT = 8 * 1024 * 1024;

function ownerFixture(t) {
  const { migrationPlan, workspaceRoot } = createCodexMigrationApplyFixture(t);
  const plan = planWakeflowMigrationConfigOwner({ workspaceRoot, migrationPlan });
  return { migrationPlan, workspaceRoot, plan };
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function bootstrapRuntimeProtocol(workspaceRoot) {
  const refs = [
    ".wakeflow-local",
    ".wakeflow-local/runtime",
    ".wakeflow-local/runtime/maintenance",
    ".wakeflow-local/runtime/maintenance/transactions",
  ];
  for (const ref of refs) {
    const target = path.join(workspaceRoot, ...ref.split("/"));
    mkdirSync(target, { recursive: true, mode: 0o700 });
    chmodSync(target, 0o700);
  }
}

test("R46 exposes one deterministic config-only migration owner", (t) => {
  const { migrationPlan, workspaceRoot, plan } = ownerFixture(t);
  assert.equal(
    WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_ID,
    "urn:wakeflow:internal:migration-config-owner-plan:v1",
  );
  assert.equal(WAKEFLOW_MIGRATION_CONFIG_OWNER_KIND, "WakeflowMigrationConfigOwnerPlan");
  assert.equal(WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_VERSION, 1);
  assert.equal(typeof WakeflowMigrationConfigOwnerError, "function");
  assert.equal(typeof assertWakeflowMigrationConfigOwnerPlanAgainstMigrationPlan, "function");
  assert.deepEqual(
    planWakeflowMigrationConfigOwner({ workspaceRoot, migrationPlan }),
    plan,
  );
  assert.deepEqual(validateWakeflowMigrationConfigOwnerPlan(plan), plan);
  assert.equal(plan.payload.steps.length, 1);
  assert.equal(plan.payload.releaseStep.stepKind, "remove");
  assertDeepFrozen(plan);
});

test("config owner plan remains bound to the exact upstream migration authority", (t) => {
  const { migrationPlan, plan } = ownerFixture(t);
  assert.deepEqual(
    assertWakeflowMigrationConfigOwnerPlanAgainstMigrationPlan({ migrationPlan, plan }),
    plan,
  );
  const tampered = structuredClone(plan);
  tampered.payload.sourceAuthorityDigest = canonicalJsonDigest({ authority: "another" });
  assert.deepEqual(validateWakeflowMigrationConfigOwnerPlan(tampered), tampered);
  assert.throws(
    () => assertWakeflowMigrationConfigOwnerPlanAgainstMigrationPlan({
      migrationPlan,
      plan: tampered,
    }),
    (error) => error?.code === "wakeflow-migration-config-binding",
  );
});

test("config owner plan rejects non-digest source and unit identities", (t) => {
  const { plan } = ownerFixture(t);
  for (const field of ["sourceId", "unitId"]) {
    const tampered = structuredClone(plan);
    tampered.payload[field] = { privatePath: "/private/should-not-enter-a-plan" };
    assert.throws(
      () => validateWakeflowMigrationConfigOwnerPlan(tampered),
      (error) => error?.code === "wakeflow-migration-config-plan",
      field,
    );
  }
});

test("config owner rejects unknown files in its private migration residue namespace", (t) => {
  const { migrationPlan, workspaceRoot } = createCodexMigrationApplyFixture(t);
  const unknown = path.join(workspaceRoot, ".wakeflow.config.migration.unowned.stage");
  writeFileSync(unknown, "foreign residue\n", { mode: 0o644 });
  chmodSync(unknown, 0o644);

  assert.throws(
    () => planWakeflowMigrationConfigOwner({ workspaceRoot, migrationPlan }),
    (error) => error?.code === "wakeflow-migration-config-residue",
  );
  assert.equal(existsSync(unknown), true);
});

test("config owner rejects an oversized exact stage before reading it as migration state", (t) => {
  const { migrationPlan, workspaceRoot, plan } = ownerFixture(t);
  const stage = path.join(workspaceRoot, plan.payload.stageRef);
  writeFileSync(stage, Buffer.alloc(LEGACY_CONFIG_LIMIT + 1, 0x78), { mode: 0o644 });
  chmodSync(stage, 0o644);

  assert.throws(
    () => planWakeflowMigrationConfigOwner({ workspaceRoot, migrationPlan }),
    (error) => error?.code === "wakeflow-migration-config-inspection",
  );
});

test("config owner participant snapshots its recovery admission", (t) => {
  const { workspaceRoot, plan } = ownerFixture(t);
  const input = {
    workspaceRoot,
    confirmedPlan: plan,
    admission: "recovery",
  };
  const participant = createWakeflowMigrationConfigOwnerParticipant(input);
  const targetBytes = Buffer.from(serializeWakeflowConfigV3(plan.payload.desiredModel), "utf8");
  writeFileSync(path.join(workspaceRoot, plan.payload.stageRef), targetBytes, { mode: 0o644 });
  chmodSync(path.join(workspaceRoot, plan.payload.stageRef), 0o644);
  input.admission = "apply";

  assert.deepEqual(participant.deriveCurrentPlan({ context: null }), plan);
});

test("config owner callbacks reject a runtime-mutation context before writing a stage", async (t) => {
  const { workspaceRoot, plan } = ownerFixture(t);
  const participant = createWakeflowMigrationConfigOwnerParticipant({
    workspaceRoot,
    confirmedPlan: plan,
    admission: "apply",
  });
  const stepId = plan.payload.steps[0].stepId;
  bootstrapRuntimeProtocol(workspaceRoot);

  await assert.rejects(
    () => withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "migration-config-mode-test",
      domainOwner: "migration-config-owner",
      onCallbackFailure: () => ({
        disposition: "safe-to-release",
        closureDigests: [{
          name: "migration-config-mode-rejected",
          digest: canonicalJsonDigest({ rejected: true }),
        }],
      }),
    }, (context) => participant.stepHandlers[stepId].prepare({ context })),
    (error) => error?.code === "wakeflow-mutation-callback-failed",
  );
  assert.equal(existsSync(path.join(workspaceRoot, plan.payload.stageRef)), false);
});
