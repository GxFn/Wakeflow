import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { hostProfile } from "../core/scripts/lib/wakeflow-host-profile.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import { planWakeflowLocalLayout } from "../core/scripts/lib/wakeflow-local-layout.mjs";
import { registerWindowBinding } from "../core/scripts/lib/wakeflow-window-binding-service.mjs";
import {
  WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_KIND,
  WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_SCHEMA_ID,
  createWindowRuntimeProjectionMutationParticipant,
  planWindowRuntimeProjectionMaintenance,
  projectWindowRuntimeProjectionMaintenance,
  validateWindowRuntimeProjectionMaintenancePlan,
} from "../core/scripts/lib/wakeflow-window-runtime-projector.mjs";
import { validateWindowRuntimeProjection } from "../core/scripts/lib/wakeflow-window-runtime-records.mjs";
import { runWakeflowMaintenanceMutation } from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json"),
  "utf8",
));
const HANDLE = "10000000-0000-4000-8000-000000000001";

function model() {
  return parseWakeflowConfigV3(structuredClone(fixture));
}

function workspace(t) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-window-runtime-maintenance-"));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function materializeLocalLayout(workspaceRoot, desiredModel) {
  const descriptor = createWakeflowLayoutDescriptor({ model: desiredModel, hostProfile });
  const layout = planWakeflowLocalLayout({ model: desiredModel, layoutDescriptor: descriptor, hostProfile });
  for (const entry of layout.staticDirectories) {
    const candidate = path.join(workspaceRoot, ...entry.path.split("/"));
    mkdirSync(candidate, { recursive: true, mode: 0o700 });
    chmodSync(candidate, 0o700);
  }
}

function input(workspaceRoot, desiredModel, action = "fresh-initialize") {
  return {
    workspaceRoot,
    action,
    sourceModel: action === "fresh-initialize" ? null : desiredModel,
    desiredModel,
    hostProfile,
  };
}

async function applyOwner(workspaceRoot, action, plan, participant) {
  return runWakeflowMaintenanceMutation({
    workspaceRoot,
    action,
    operationKind: "window-runtime-projection-materialization",
    domainOwner: "runtime-projection-builder",
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
}

test("T08 fresh window-runtime maintenance plan freezes only portable unregistered projections", (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  const ownerInput = input(workspaceRoot, desiredModel);
  const first = planWindowRuntimeProjectionMaintenance(ownerInput);
  const second = planWindowRuntimeProjectionMaintenance(ownerInput);

  assert.equal(
    WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_SCHEMA_ID,
    "urn:wakeflow:internal:window-runtime-maintenance-plan:v1",
  );
  assert.equal(WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_KIND, "WakeflowWindowRuntimeMaintenancePlan");
  assert.deepEqual(first, second);
  assert.deepEqual(validateWindowRuntimeProjectionMaintenancePlan(first), first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.payload.status, "ready");
  assert.equal(first.payload.operations.length, desiredModel.topology.windows.length);
  assert.equal(first.payload.operations.every((entry) => entry.action === "create-managed"), true);
  assert.equal(first.payload.steps.length, desiredModel.topology.windows.length);
  assert.equal(JSON.stringify(first).includes(workspaceRoot), false);
  assert.equal(JSON.stringify(first).includes("projectionDigest"), true);
  assert.equal(JSON.stringify(first).includes("resolvedRoot"), false);
  assert.equal(JSON.stringify(first).includes("identityBindingDigest"), false);

  const projected = projectWindowRuntimeProjectionMaintenance({ plan: first, transactionOffset: 13 });
  assert.deepEqual(projected.steps.map((entry) => entry.ordinal), [13, 14, 15, 16]);
  assert.deepEqual(projected.components, [{
    componentId: "window-runtime-projection",
    owner: "runtime-projection-builder",
    ownerPlanDigest: canonicalJsonDigest(first),
  }]);
});

test("T08 window-runtime maintenance codec rejects forged operation semantics and blockers", (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  const plan = planWindowRuntimeProjectionMaintenance(input(workspaceRoot, desiredModel));

  const forgedOperation = structuredClone(plan);
  forgedOperation.payload.operations[0].classification = "managed-current";
  forgedOperation.payload.operations[0].reasonCode = "window-runtime-current";
  assert.throws(
    () => validateWindowRuntimeProjectionMaintenancePlan(forgedOperation),
    /maintenance operation|semantics|classification|reason/iu,
  );

  const forgedBlocker = structuredClone(plan);
  forgedBlocker.payload.blockers.push({
    blockerId: "forged-blocker",
    operationId: null,
    resourceRef: ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
    code: "forged-code",
  });
  forgedBlocker.payload.status = "blocked";
  assert.throws(
    () => validateWindowRuntimeProjectionMaintenancePlan(forgedBlocker),
    /maintenance blocker|blockers|derived/iu,
  );
});

test("T08 window-runtime participant materializes unobserved records and converges to current", async (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  materializeLocalLayout(workspaceRoot, desiredModel);
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    serializeWakeflowConfigV3(desiredModel),
    { mode: 0o644 },
  );
  chmodSync(path.join(workspaceRoot, "wakeflow.config.json"), 0o644);
  const ownerInput = input(workspaceRoot, desiredModel, "reconcile");
  const plan = planWindowRuntimeProjectionMaintenance(ownerInput);
  const participant = createWindowRuntimeProjectionMutationParticipant({
    ...ownerInput,
    confirmedPlan: plan,
  });
  const applied = await applyOwner(workspaceRoot, ownerInput.action, plan, participant);
  assert.equal(applied.status, "completed");

  for (const operation of plan.payload.operations) {
    const file = path.join(workspaceRoot, ...operation.ref.split("/"));
    assert.equal(existsSync(file), true);
    const record = validateWindowRuntimeProjection(JSON.parse(readFileSync(file, "utf8")));
    assert.equal(record.identity.status, "unregistered");
    assert.equal(record.resolvedRoot.status, "unobserved");
    assert.equal(record.projectionDigest, operation.projectionDigest);
  }

  const current = planWindowRuntimeProjectionMaintenance(input(workspaceRoot, desiredModel, "reconcile"));
  assert.equal(current.payload.status, "ready");
  assert.deepEqual(current.payload.steps, []);
  assert.equal(current.payload.operations.every((entry) => entry.action === "current"), true);
});

test("T08 a binding created after confirmation invalidates fresh window-runtime apply", async (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  materializeLocalLayout(workspaceRoot, desiredModel);
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    serializeWakeflowConfigV3(desiredModel),
    { mode: 0o644 },
  );
  chmodSync(path.join(workspaceRoot, "wakeflow.config.json"), 0o644);
  const ownerInput = input(workspaceRoot, desiredModel, "reconcile");
  const plan = planWindowRuntimeProjectionMaintenance(ownerInput);
  const participant = createWindowRuntimeProjectionMutationParticipant({
    ...ownerInput,
    confirmedPlan: plan,
  });
  await registerWindowBinding({
    workspaceRoot,
    windowId: desiredModel.topology.windows[0].windowId,
    handle: { kind: "codex-thread", value: HANDLE },
  });

  await assert.rejects(
    () => applyOwner(workspaceRoot, ownerInput.action, plan, participant),
    /identity|binding|source|stale|runtime|mutation/iu,
  );
  assert.equal(plan.payload.operations.every((entry) => (
    !existsSync(path.join(workspaceRoot, ...entry.ref.split("/")))
  )), true);
});
