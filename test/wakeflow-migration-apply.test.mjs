import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  WAKEFLOW_MIGRATION_APPLY_PHASES,
  WAKEFLOW_MIGRATION_APPLY_PLAN_KIND,
  WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_ID,
  WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_VERSION,
  WakeflowMigrationApplyError,
  createWakeflowMigrationManualAcknowledgement,
  createWakeflowMigrationMutationParticipant,
  planWakeflowMigrationApply,
  runWakeflowMigrationApply,
  validateWakeflowMigrationApplyPlan,
  wakeflowMigrationApplyPlanDigest,
} from "../core/scripts/lib/wakeflow-migration-apply.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  createCodexMigrationApplyFixture,
  createMigrationApplyPhaseFixtures,
  createMigrationApplyPhaseParticipants,
} from "./support/wakeflow-migration-apply-fixture.mjs";

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function completeApplyFixture(t) {
  const { migrationPlan, workspaceRoot } = createCodexMigrationApplyFixture(t);
  const phase = createMigrationApplyPhaseFixtures(migrationPlan);
  const plan = planWakeflowMigrationApply({
    migrationPlan,
    hostPlans: [],
    hostEffectSnapshots: [],
    manualAcknowledgements: [],
    phaseSnapshots: phase.snapshots,
  });
  const phaseParticipants = createMigrationApplyPhaseParticipants({
    workspaceRoot,
    snapshots: phase.snapshots,
    step: phase.step,
    targetBytes: phase.targetBytes,
  });
  return { migrationPlan, workspaceRoot, plan, phaseParticipants, ...phase };
}

test("M6-T08 exposes one closed migration apply surface", () => {
  assert.equal(WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_ID, "urn:wakeflow:internal:migration-apply-plan:v1");
  assert.equal(WAKEFLOW_MIGRATION_APPLY_PLAN_KIND, "WakeflowMigrationApplyPlan");
  assert.equal(WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_VERSION, 1);
  assert.deepEqual(WAKEFLOW_MIGRATION_APPLY_PHASES, [
    "target-authority",
    "archive-or-preservation",
    "managed-surfaces",
    "derived-projections",
    "exact-source-release",
  ]);
  assert.equal(typeof WakeflowMigrationApplyError, "function");
  assert.equal(typeof createWakeflowMigrationManualAcknowledgement, "function");
  assert.equal(typeof createWakeflowMigrationMutationParticipant, "function");
});

test("apply planning remains blocked until all five owner phases and the complete target closure are covered", (t) => {
  const { migrationPlan, workspaceRoot } = createCodexMigrationApplyFixture(t);
  const before = readFileSync(path.join(workspaceRoot, "wakeflow.config.json"));
  const empty = planWakeflowMigrationApply({
    migrationPlan,
    hostPlans: [],
    hostEffectSnapshots: [],
    manualAcknowledgements: [],
    phaseSnapshots: [],
  });
  assert.equal(empty.payload.status, "blocked");
  assert.ok(empty.payload.issues.some((entry) => entry.code === "migration-apply-phase-missing"));
  assert.ok(empty.payload.issues.some((entry) => entry.code === "migration-apply-target-coverage-missing"));

  const { snapshots } = createMigrationApplyPhaseFixtures(migrationPlan);
  const incomplete = structuredClone(snapshots);
  incomplete[0].targetKeys = incomplete[0].targetKeys.slice(1);
  const targetGap = planWakeflowMigrationApply({
    migrationPlan,
    hostPlans: [],
    hostEffectSnapshots: [],
    manualAcknowledgements: [],
    phaseSnapshots: incomplete,
  });
  assert.equal(targetGap.payload.status, "blocked");
  assert.ok(targetGap.payload.issues.some((entry) => entry.code === "migration-apply-target-coverage-missing"));
  assert.deepEqual(readFileSync(path.join(workspaceRoot, "wakeflow.config.json")), before);
  assertDeepFrozen(empty);
  assertDeepFrozen(targetGap);
});

test("phase coverage cannot launder an upstream manual or non-dependency blocker", (t) => {
  const { migrationPlan, workspaceRoot } = createCodexMigrationApplyFixture(t, {
    prepareWorkspace(root) {
      const unknownRoot = path.join(root, ".wakeflow-local", "unsupported-owner");
      mkdirSync(unknownRoot, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(unknownRoot, "opaque.bin"), Buffer.from([0xff, 0x00, 0x7f]), {
        mode: 0o600,
      });
    },
  });
  assert.equal(migrationPlan.payload.status, "blocked");
  const { snapshots } = createMigrationApplyPhaseFixtures(migrationPlan);
  const plan = planWakeflowMigrationApply({
    migrationPlan,
    hostPlans: [],
    hostEffectSnapshots: [],
    manualAcknowledgements: [],
    phaseSnapshots: snapshots,
  });
  assert.equal(plan.payload.status, "blocked");
  assert.ok(plan.payload.issues.some((entry) => (
    entry.code === "migration-apply-upstream-manual-unit-unresolved"
  )));
  assert.ok(plan.payload.issues.some((entry) => (
    entry.code === "migration-apply-upstream-blocker-unresolved"
  )));
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local", "runtime")), false);
});

test("apply preview blocks a plan that fits alone but cannot fit every durable effect checkpoint", (t) => {
  const { migrationPlan } = createCodexMigrationApplyFixture(t);
  const { snapshots } = createMigrationApplyPhaseFixtures(migrationPlan);
  const owner = snapshots[0].snapshot.payload;
  owner.padding = "x".repeat(7_920_000);
  owner.steps.push({
    stepId: "migration-budget-effect",
    ordinal: 1,
    stepKind: "owner-effect",
    effectKind: "migration-budget-proof",
    intentDigest: `sha256:${"a".repeat(64)}`,
    checkpointSchemaId: "urn:wakeflow:internal:test-budget-checkpoint:v1",
    resultSchemaId: "urn:wakeflow:internal:test-budget-result:v1",
    outcomeSchemaId: "urn:wakeflow:internal:test-budget-outcome:v1",
  });
  const plan = planWakeflowMigrationApply({
    migrationPlan,
    hostPlans: [],
    hostEffectSnapshots: [],
    manualAcknowledgements: [],
    phaseSnapshots: snapshots,
  });
  assert.ok(Buffer.byteLength(canonicalJson(plan), "utf8") < 8 * 1024 * 1024);
  assert.equal(plan.payload.status, "blocked");
  assert.ok(plan.payload.issues.some((entry) => (
    entry.code === "migration-apply-persistence-budget-exceeded"
  )));
});

test("apply planning rejects an owner step that the shared mutation contract cannot execute", (t) => {
  const { migrationPlan } = createCodexMigrationApplyFixture(t);
  const { snapshots } = createMigrationApplyPhaseFixtures(migrationPlan);
  delete snapshots[0].snapshot.payload.steps[0].final;

  assert.throws(
    () => planWakeflowMigrationApply({
      migrationPlan,
      hostPlans: [],
      hostEffectSnapshots: [],
      manualAcknowledgements: [],
      phaseSnapshots: snapshots,
    }),
    (error) => error?.code === "wakeflow-migration-apply-owner-snapshot",
  );
});

test("apply planning rejects a behavioral phase registry without invoking its getter", (t) => {
  const { migrationPlan } = createCodexMigrationApplyFixture(t);
  const { snapshots } = createMigrationApplyPhaseFixtures(migrationPlan);
  const behavioral = [...snapshots];
  let getterCalls = 0;
  Object.defineProperty(behavioral, "0", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return snapshots[0];
    },
  });

  assert.throws(
    () => planWakeflowMigrationApply({
      migrationPlan,
      hostPlans: [],
      hostEffectSnapshots: [],
      manualAcknowledgements: [],
      phaseSnapshots: behavioral,
    }),
    (error) => error?.code === "wakeflow-migration-apply-contract",
  );
  assert.equal(getterCalls, 0);
});

test("migration composition rejects an owner method accessor without invoking it", (t) => {
  const {
    workspaceRoot,
    plan,
    phaseParticipants,
  } = completeApplyFixture(t);
  const target = phaseParticipants[0];
  const owner = { ...target.participant };
  const deriveCurrentPlan = owner.deriveCurrentPlan;
  delete owner.deriveCurrentPlan;
  let getterCalls = 0;
  Object.defineProperty(owner, "deriveCurrentPlan", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return deriveCurrentPlan;
    },
  });

  assert.throws(
    () => createWakeflowMigrationMutationParticipant({
      workspaceRoot,
      admission: "apply",
      confirmedPlan: plan,
      hostEffectParticipants: [],
      phaseParticipants: phaseParticipants.map((entry) => (
        entry === target ? { ...entry, participant: owner } : entry
      )),
      replan: async () => plan,
    }),
    (error) => error?.code === "wakeflow-migration-apply-contract",
  );
  assert.equal(getterCalls, 0);
});

test("migration composition rejects a step callback accessor without invoking it", (t) => {
  const {
    workspaceRoot,
    plan,
    phaseParticipants,
    step,
  } = completeApplyFixture(t);
  const target = phaseParticipants[0];
  const handler = { ...target.participant.stepHandlers[step.stepId] };
  const observe = handler.observe;
  delete handler.observe;
  let getterCalls = 0;
  Object.defineProperty(handler, "observe", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return observe;
    },
  });
  const owner = {
    ...target.participant,
    stepHandlers: { [step.stepId]: handler },
  };

  assert.throws(
    () => createWakeflowMigrationMutationParticipant({
      workspaceRoot,
      admission: "apply",
      confirmedPlan: plan,
      hostEffectParticipants: [],
      phaseParticipants: phaseParticipants.map((entry) => (
        entry === target ? { ...entry, participant: owner } : entry
      )),
      replan: async () => plan,
    }),
    (error) => error?.code === "wakeflow-migration-apply-contract",
  );
  assert.equal(getterCalls, 0);
});

test("migration composition requires cleanup authority for every remove step", (t) => {
  const { migrationPlan, workspaceRoot } = createCodexMigrationApplyFixture(t);
  const { snapshots, step, targetBytes } = createMigrationApplyPhaseFixtures(migrationPlan);
  const removeStep = snapshots[0].snapshot.payload.steps[0];
  removeStep.stepKind = "remove";
  removeStep.source = {
    ref: removeStep.final.ref,
    type: "file",
    mode: "0600",
    digest: removeStep.staging.digest,
  };
  removeStep.final = { ref: removeStep.source.ref, type: "absent" };
  const plan = planWakeflowMigrationApply({
    migrationPlan,
    hostPlans: [],
    hostEffectSnapshots: [],
    manualAcknowledgements: [],
    phaseSnapshots: snapshots,
  });
  const phaseParticipants = createMigrationApplyPhaseParticipants({
    workspaceRoot,
    snapshots,
    step,
    targetBytes,
  });

  assert.throws(
    () => createWakeflowMigrationMutationParticipant({
      workspaceRoot,
      admission: "apply",
      confirmedPlan: plan,
      hostEffectParticipants: [],
      phaseParticipants,
      replan: async () => plan,
    }),
    (error) => error?.code === "wakeflow-migration-apply-participant",
  );
});

test("migration composition snapshots admission and replan authority at creation", async (t) => {
  const {
    workspaceRoot,
    plan,
    phaseParticipants,
  } = completeApplyFixture(t);
  let replacementCalls = 0;
  const input = {
    workspaceRoot,
    admission: "apply",
    confirmedPlan: plan,
    hostEffectParticipants: [],
    phaseParticipants,
    replan: async () => plan,
  };
  const participant = createWakeflowMigrationMutationParticipant(input);
  input.admission = "recovery";
  input.replan = async () => {
    replacementCalls += 1;
    throw new Error("replacement replan must not run");
  };

  const result = await runWakeflowMigrationApply({
    workspaceRoot,
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    participant,
  });
  assert.equal(result.status, "completed");
  assert.equal(replacementCalls, 0);
});

test("migration composition snapshots owner and step callbacks before execution", async (t) => {
  const {
    workspaceRoot,
    plan,
    phaseParticipants,
    step,
  } = completeApplyFixture(t);
  let replacementOwnerCalls = 0;
  let replacementStepCalls = 0;
  const participant = createWakeflowMigrationMutationParticipant({
    workspaceRoot,
    admission: "apply",
    confirmedPlan: plan,
    hostEffectParticipants: [],
    phaseParticipants,
    replan: async () => plan,
  });
  phaseParticipants[0].participant.deriveCurrentPlan = async () => {
    replacementOwnerCalls += 1;
    throw new Error("replacement owner callback must not run");
  };
  phaseParticipants[0].participant.stepHandlers[step.stepId].commit = async () => {
    replacementStepCalls += 1;
    throw new Error("replacement step callback must not run");
  };

  const result = await runWakeflowMigrationApply({
    workspaceRoot,
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    participant,
  });
  assert.equal(result.status, "completed");
  assert.equal(replacementOwnerCalls, 0);
  assert.equal(replacementStepCalls, 0);
});

test("migration composition snapshots every owner before invoking the first owner codec", async (t) => {
  const {
    workspaceRoot,
    plan,
    phaseParticipants,
  } = completeApplyFixture(t);
  const first = phaseParticipants[0].participant;
  const later = phaseParticipants[1].participant;
  const firstValidatePlan = first.validatePlan;
  let replacementCalls = 0;
  first.validatePlan = (args) => {
    later.deriveCurrentPlan = async () => {
      replacementCalls += 1;
      throw new Error("an earlier owner codec must not rewrite a later owner");
    };
    return firstValidatePlan(args);
  };

  const participant = createWakeflowMigrationMutationParticipant({
    workspaceRoot,
    admission: "apply",
    confirmedPlan: plan,
    hostEffectParticipants: [],
    phaseParticipants,
    replan: async () => plan,
  });
  const result = await runWakeflowMigrationApply({
    workspaceRoot,
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    participant,
  });
  assert.equal(result.status, "completed");
  assert.equal(replacementCalls, 0);
});

test("migration composition rejects behavioral closure arrays without invoking them", async (t) => {
  const {
    workspaceRoot,
    plan,
    phaseParticipants,
  } = completeApplyFixture(t);
  const target = phaseParticipants[0];
  let getterCalls = 0;
  const owner = {
    ...target.participant,
    async deriveTerminalClosure({ planDigest }) {
      const closureDigests = [];
      Object.defineProperty(closureDigests, "0", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return {
            name: "behavioral-owner-closure",
            digest: canonicalJsonDigest({ planDigest }),
          };
        },
      });
      closureDigests.length = 1;
      return { planDigest, closureDigests };
    },
  };
  const participant = createWakeflowMigrationMutationParticipant({
    workspaceRoot,
    admission: "recovery",
    confirmedPlan: plan,
    hostEffectParticipants: [],
    phaseParticipants: phaseParticipants.map((entry) => (
      entry === target ? { ...entry, participant: owner } : entry
    )),
    replan: null,
  });

  await assert.rejects(
    () => participant.deriveTerminalClosure({
      context: null,
      plan,
      planDigest: canonicalJsonDigest(plan),
      effectRecords: [],
    }),
    (error) => error?.code === "wakeflow-migration-apply-contract",
  );
  assert.equal(getterCalls, 0);
});

test("migration composition requires one durable closure digest from every owner", async (t) => {
  const {
    workspaceRoot,
    plan,
    phaseParticipants,
  } = completeApplyFixture(t);
  const target = phaseParticipants[0];
  const owner = {
    ...target.participant,
    async deriveTerminalClosure({ planDigest }) {
      return { planDigest, closureDigests: [] };
    },
  };
  const participant = createWakeflowMigrationMutationParticipant({
    workspaceRoot,
    admission: "recovery",
    confirmedPlan: plan,
    hostEffectParticipants: [],
    phaseParticipants: phaseParticipants.map((entry) => (
      entry === target ? { ...entry, participant: owner } : entry
    )),
    replan: null,
  });

  await assert.rejects(
    () => participant.deriveTerminalClosure({
      context: null,
      plan,
      planDigest: canonicalJsonDigest(plan),
      effectRecords: [],
    }),
    (error) => error?.code === "wakeflow-migration-apply-closure",
  );
});

test("migration apply rejects a behavioral composed participant without invoking it", async (t) => {
  const {
    workspaceRoot,
    plan,
    phaseParticipants,
  } = completeApplyFixture(t);
  const legitimate = createWakeflowMigrationMutationParticipant({
    workspaceRoot,
    admission: "apply",
    confirmedPlan: plan,
    hostEffectParticipants: [],
    phaseParticipants,
    replan: async () => plan,
  });
  const behavioral = { ...legitimate };
  delete behavioral.validatePlan;
  let getterCalls = 0;
  Object.defineProperty(behavioral, "validatePlan", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return legitimate.validatePlan;
    },
  });

  await assert.rejects(
    () => runWakeflowMigrationApply({
      workspaceRoot,
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      participant: behavioral,
    }),
    (error) => error?.code === "wakeflow-migration-apply-contract",
  );
  assert.equal(getterCalls, 0);
});

test("a complete confirmed apply plan is deterministic and executes only through the shared maintenance journal", async (t) => {
  const { migrationPlan, workspaceRoot } = createCodexMigrationApplyFixture(t);
  const { snapshots, step, targetBytes } = createMigrationApplyPhaseFixtures(migrationPlan);
  const input = {
    migrationPlan,
    hostPlans: [],
    hostEffectSnapshots: [],
    manualAcknowledgements: [],
    phaseSnapshots: snapshots,
  };
  const plan = planWakeflowMigrationApply(input);
  assert.equal(plan.payload.status, "ready");
  assert.deepEqual(planWakeflowMigrationApply(input), plan);
  assert.deepEqual(validateWakeflowMigrationApplyPlan(plan), plan);
  assert.equal(wakeflowMigrationApplyPlanDigest(plan), canonicalJsonDigest(plan));
  assert.equal(plan.payload.steps.length, 1);
  assert.equal(plan.payload.steps[0].ordinal, 0);
  assertDeepFrozen(plan);

  const phaseParticipants = createMigrationApplyPhaseParticipants({
    workspaceRoot,
    snapshots,
    step,
    targetBytes,
  });
  const participant = createWakeflowMigrationMutationParticipant({
    workspaceRoot,
    admission: "apply",
    confirmedPlan: plan,
    hostEffectParticipants: [],
    phaseParticipants,
    replan: async () => plan,
  });
  const result = await runWakeflowMigrationApply({
    workspaceRoot,
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    participant,
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(
    readFileSync(path.join(workspaceRoot, ...step.final.ref.split("/"))),
    targetBytes,
  );
  assert.equal(existsSync(path.join(workspaceRoot, ...step.staging.ref.split("/"))), false);
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local/runtime/maintenance.lock")), false);
  assert.deepEqual(
    Object.keys(participant).sort(),
    ["deriveCurrentPlan", "deriveTerminalClosure", "stepHandlers", "validatePlan"],
  );
});
