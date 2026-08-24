import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
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

import {
  createWakeflowActiveFoundationMutationParticipant,
  planWakeflowActiveFoundation,
} from "../core/scripts/lib/wakeflow-active-foundation.mjs";
import {
  WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_KIND,
  WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_SCHEMA_ID,
  createWakeflowActiveProjectionMutationParticipant,
  planWakeflowActiveProjectionMaintenance,
  projectWakeflowActiveProjectionMaintenance,
  validateWakeflowActiveProjectionMaintenancePlan,
} from "../core/scripts/lib/wakeflow-active-projector.mjs";
import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import {
  parseWakeflowAssetBundle,
} from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import {
  recoverWakeflowWorkspaceMutation,
  runWakeflowMaintenanceMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";
import { buildWakeflowAssetBundle } from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repositoryRoot, "core/template-sources");
const fixture = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json"),
  "utf8",
));
const bundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({ sourceRoot }));

function model() {
  return parseWakeflowConfigV3(structuredClone(fixture));
}

function workspace(t) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-active-projection-maintenance-"));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function foundationInput(workspaceRoot, desiredModel) {
  return {
    workspaceRoot,
    action: "fresh-initialize",
    sourceModel: null,
    desiredModel,
  };
}

function projectionInput(workspaceRoot, desiredModel, action = "fresh-initialize") {
  return {
    workspaceRoot,
    action,
    sourceModel: action === "fresh-initialize" ? null : desiredModel,
    desiredModel,
    bundle,
    language: "zh",
  };
}

async function applyOwner(workspaceRoot, action, plan, participant, owner) {
  return runWakeflowMaintenanceMutation({
    workspaceRoot,
    action,
    operationKind: `${owner}-materialization`,
    domainOwner: owner,
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
}

async function materializeFoundation(workspaceRoot, desiredModel) {
  const input = foundationInput(workspaceRoot, desiredModel);
  const plan = planWakeflowActiveFoundation(input);
  const participant = createWakeflowActiveFoundationMutationParticipant({ ...input, confirmedPlan: plan });
  await applyOwner(workspaceRoot, input.action, plan, participant, "active-foundation-owner");
}

test("T08 active projection maintenance plan reuses the renderer without embedding content", async (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  await materializeFoundation(workspaceRoot, desiredModel);
  const input = projectionInput(workspaceRoot, desiredModel);
  const first = planWakeflowActiveProjectionMaintenance(input);
  const second = planWakeflowActiveProjectionMaintenance(input);

  assert.equal(
    WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_SCHEMA_ID,
    "urn:wakeflow:internal:active-projection-maintenance-plan:v1",
  );
  assert.equal(WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_KIND, "WakeflowActiveProjectionMaintenancePlan");
  assert.deepEqual(first, second);
  assert.deepEqual(validateWakeflowActiveProjectionMaintenancePlan(first), first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.payload.status, "ready");
  assert.deepEqual(first.payload.operations.map((entry) => entry.ref), [
    ".wakeflow-active/current/workspace-current-status.md",
    ".wakeflow-active/index.md",
  ]);
  assert.equal(first.payload.operations.every((entry) => entry.action === "create-managed"), true);
  assert.equal(first.payload.steps.length, 2);
  assert.equal(JSON.stringify(first).includes(workspaceRoot), false);
  assert.equal(JSON.stringify(first).includes("content"), false);
  assert.equal(JSON.stringify(first).includes("No active demand roots"), false);

  const projection = projectWakeflowActiveProjectionMaintenance({ plan: first, transactionOffset: 11 });
  assert.deepEqual(projection.steps.map((entry) => entry.ordinal), [11, 12]);
  assert.deepEqual(projection.components, [{
    componentId: "active-projection",
    owner: "active-projector",
    ownerPlanDigest: canonicalJsonDigest(first),
  }]);
});

test("T08 active projection maintenance rejects a truncated workspace pair and model drift", async (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  await materializeFoundation(workspaceRoot, desiredModel);
  const input = projectionInput(workspaceRoot, desiredModel);
  const plan = planWakeflowActiveProjectionMaintenance(input);

  const truncated = structuredClone(plan);
  truncated.payload.operations = truncated.payload.operations.slice(0, 1);
  truncated.payload.steps = truncated.payload.steps.slice(0, 1);
  assert.throws(
    () => validateWakeflowActiveProjectionMaintenancePlan(truncated),
    /roster|workspace projection|maintenance/iu,
  );

  const foreignModel = structuredClone(plan);
  foreignModel.payload.desiredModelDigest = `sha256:${"f".repeat(64)}`;
  assert.deepEqual(validateWakeflowActiveProjectionMaintenancePlan(foreignModel), foreignModel);
  assert.throws(
    () => createWakeflowActiveProjectionMutationParticipant({
      ...input,
      confirmedPlan: foreignModel,
    }),
    /current authority source|differs/iu,
  );
});

test("T08 active projection participant writes exact workspace projections and converges", async (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  await materializeFoundation(workspaceRoot, desiredModel);
  const input = projectionInput(workspaceRoot, desiredModel);
  const plan = planWakeflowActiveProjectionMaintenance(input);
  const participant = createWakeflowActiveProjectionMutationParticipant({ ...input, confirmedPlan: plan });
  const applied = await applyOwner(workspaceRoot, input.action, plan, participant, "active-projector");
  assert.equal(applied.status, "completed");

  const index = path.join(workspaceRoot, ".wakeflow-active/index.md");
  const status = path.join(workspaceRoot, ".wakeflow-active/current/workspace-current-status.md");
  assert.equal(existsSync(index), true);
  assert.equal(existsSync(status), true);
  assert.match(readFileSync(index, "utf8"), /wakeflow:active-projection:v1/iu);
  assert.match(readFileSync(status, "utf8"), /wakeflow:active-projection:v1/iu);
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-active/current/index.md")), false);

  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    serializeWakeflowConfigV3(desiredModel),
    { mode: 0o644 },
  );
  chmodSync(path.join(workspaceRoot, "wakeflow.config.json"), 0o644);
  const current = planWakeflowActiveProjectionMaintenance(
    projectionInput(workspaceRoot, desiredModel, "reconcile"),
  );
  assert.equal(current.payload.status, "ready");
  assert.deepEqual(current.payload.steps, []);
  assert.equal(current.payload.operations.every((entry) => entry.action === "current"), true);
});

test("T08 active projection recovery accepts its exact committed pair and rejects a foreign pair", async (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  await materializeFoundation(workspaceRoot, desiredModel);
  const input = projectionInput(workspaceRoot, desiredModel);
  const plan = planWakeflowActiveProjectionMaintenance(input);
  const participant = createWakeflowActiveProjectionMutationParticipant({ ...input, confirmedPlan: plan });
  const firstStep = plan.payload.steps[0];
  const firstHandler = participant.stepHandlers[firstStep.stepId];
  const crashing = Object.freeze({
    ...participant,
    stepHandlers: Object.freeze({
      ...participant.stepHandlers,
      [firstStep.stepId]: Object.freeze({
        ...firstHandler,
        commit(value) {
          firstHandler.commit(value);
          throw new Error("simulated loss after active projection commit");
        },
      }),
    }),
  });
  await assert.rejects(
    () => applyOwner(workspaceRoot, input.action, plan, crashing, "active-projector"),
    (error) => error?.code === "wakeflow-mutation-recovery-required",
  );

  const operation = plan.payload.operations[0];
  const target = path.join(workspaceRoot, ...operation.ref.split("/"));
  const stage = path.join(
    path.dirname(target),
    `.${path.basename(target)}.wakeflow-maintenance-${operation.operationId.slice("active-projection-".length, "active-projection-".length + 16)}`,
  );
  assert.equal(existsSync(stage), true);
  const transactionRoot = path.join(workspaceRoot, ".wakeflow-local/runtime/maintenance/transactions");
  const journalName = readdirSync(transactionRoot).find((name) => (
    /^workspace-mutation_[0-9a-f-]+\.json$/u.test(name)
  ));
  assert.equal(typeof journalName, "string");
  const journal = JSON.parse(readFileSync(path.join(transactionRoot, journalName), "utf8"));
  const durablePlan = journal.plan;
  const recovering = createWakeflowActiveProjectionMutationParticipant({
    ...input,
    confirmedPlan: durablePlan,
  });
  const recovered = await recoverWakeflowWorkspaceMutation({
    workspaceRoot,
    operationId: journal.operationId,
    confirmedPlan: durablePlan,
    planDigest: canonicalJsonDigest(durablePlan),
    validatePlan: recovering.validatePlan,
    deriveCurrentPlan: recovering.deriveCurrentPlan,
    deriveTerminalClosure: recovering.deriveTerminalClosure,
    stepHandlers: recovering.stepHandlers,
  });
  assert.equal(recovered.status, "recovered");
  assert.equal(existsSync(stage), false);

  const foreignStage = `${stage}-foreign`;
  linkSync(target, foreignStage);
  const unsafe = createWakeflowActiveProjectionMutationParticipant({ ...input, confirmedPlan: durablePlan });
  await assert.rejects(
    () => applyOwner(workspaceRoot, input.action, durablePlan, unsafe, "active-projector-foreign-pair"),
    /projection|residue|source|stale|authority|recovery|blocked/iu,
  );
  assert.equal(existsSync(foreignStage), true);
});

test("T08 active projection source drift makes apply fail before any projection write", async (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  await materializeFoundation(workspaceRoot, desiredModel);
  const input = projectionInput(workspaceRoot, desiredModel);
  const plan = planWakeflowActiveProjectionMaintenance(input);
  const participant = createWakeflowActiveProjectionMutationParticipant({ ...input, confirmedPlan: plan });
  const unknown = path.join(workspaceRoot, ".wakeflow-active/current/private-residue.txt");
  writeFileSync(unknown, "unowned\n", { mode: 0o600 });
  chmodSync(unknown, 0o600);

  await assert.rejects(
    () => applyOwner(workspaceRoot, input.action, plan, participant, "active-projector"),
    /source|stale|authority|projection|mutation/iu,
  );
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-active/index.md")), false);
  assert.equal(
    existsSync(path.join(workspaceRoot, ".wakeflow-active/current/workspace-current-status.md")),
    false,
  );
  assert.equal(readFileSync(unknown, "utf8"), "unowned\n");
});
