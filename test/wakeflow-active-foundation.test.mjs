import assert from "node:assert/strict";
import {
  chmodSync,
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

import {
  WAKEFLOW_ACTIVE_FOUNDATION_KIND,
  WAKEFLOW_ACTIVE_FOUNDATION_SCHEMA_ID,
  WAKEFLOW_ACTIVE_FOUNDATION_SCHEMA_VERSION,
  createWakeflowActiveFoundationMutationParticipant,
  planWakeflowActiveFoundation,
  projectWakeflowActiveFoundationMaintenance,
  validateWakeflowActiveFoundationPlan,
} from "../core/scripts/lib/wakeflow-active-foundation.mjs";
import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import {
  EMPTY_TODO_BOARD,
  TODO_BOARD_REF,
  scanTodoBoard,
} from "../core/scripts/lib/wakeflow-todo-service.mjs";
import { runWakeflowMaintenanceMutation } from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json"),
  "utf8",
));

function model() {
  return parseWakeflowConfigV3(structuredClone(fixture));
}

function workspace(t) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-active-foundation-"));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function input(workspaceRoot, desiredModel, action = "fresh-initialize") {
  return {
    workspaceRoot,
    action,
    sourceModel: action === "fresh-initialize" ? null : desiredModel,
    desiredModel,
  };
}

function mode(candidate) {
  return `0${(lstatSync(candidate).mode & 0o777).toString(8).padStart(3, "0")}`;
}

function snapshot(root) {
  const visit = (absolute, prefix = "") => readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .flatMap((entry) => {
      const candidate = path.join(absolute, entry.name);
      const ref = prefix ? `${prefix}/${entry.name}` : entry.name;
      const record = {
        ref,
        mode: mode(candidate),
        type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
        bytes: entry.isFile() ? readFileSync(candidate, "base64") : null,
      };
      return entry.isDirectory() ? [record, ...visit(candidate, ref)] : [record];
    });
  return visit(root);
}

test("T08 active foundation fresh plan is closed, deterministic, and zero-write", (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  const before = snapshot(workspaceRoot);
  const first = planWakeflowActiveFoundation(input(workspaceRoot, desiredModel));
  const second = planWakeflowActiveFoundation(input(workspaceRoot, desiredModel));

  assert.equal(WAKEFLOW_ACTIVE_FOUNDATION_SCHEMA_ID, "urn:wakeflow:internal:active-foundation-plan:v1");
  assert.equal(WAKEFLOW_ACTIVE_FOUNDATION_KIND, "WakeflowActiveFoundationPlan");
  assert.equal(WAKEFLOW_ACTIVE_FOUNDATION_SCHEMA_VERSION, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(validateWakeflowActiveFoundationPlan(first), first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.payload.status, "ready");
  assert.deepEqual(first.payload.operations.map((entry) => [entry.componentId, entry.ref, entry.action]), [
    ["active-layout", ".wakeflow-active", "create-managed"],
    ["active-layout", ".wakeflow-active/current", "create-managed"],
    ["todo-authority", TODO_BOARD_REF, "create-managed"],
  ]);
  assert.equal(first.payload.steps.length, 3);
  assert.deepEqual(snapshot(workspaceRoot), before);
  assert.equal(JSON.stringify(first).includes(workspaceRoot), false);

  const projected = projectWakeflowActiveFoundationMaintenance({ plan: first, transactionOffset: 7 });
  assert.deepEqual(projected.components.map((entry) => entry.componentId), [
    "active-layout",
    "todo-authority",
  ]);
  assert.deepEqual(projected.steps.map((entry) => entry.ordinal), [7, 8, 9]);
});

test("T08 active foundation rejects truncated ownership and participant model drift", (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  const ownerInput = input(workspaceRoot, desiredModel);
  const plan = planWakeflowActiveFoundation(ownerInput);

  const truncated = structuredClone(plan);
  truncated.payload.operations = [];
  truncated.payload.blockers = [];
  truncated.payload.steps = [];
  assert.throws(
    () => validateWakeflowActiveFoundationPlan(truncated),
    /roster|operation|foundation/iu,
  );

  const remapped = structuredClone(plan);
  remapped.payload.operations[0].owner = "todo-service";
  assert.throws(
    () => validateWakeflowActiveFoundationPlan(remapped),
    /ownership|operation|foundation/iu,
  );

  const foreignModel = structuredClone(plan);
  foreignModel.payload.desiredModelDigest = `sha256:${"f".repeat(64)}`;
  assert.deepEqual(validateWakeflowActiveFoundationPlan(foreignModel), foreignModel);
  assert.throws(
    () => createWakeflowActiveFoundationMutationParticipant({
      ...ownerInput,
      confirmedPlan: foreignModel,
    }),
    /participant input|plan differs/iu,
  );
});

test("T08 active foundation creates only static roots and the canonical empty TODO authority", async (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  const ownerInput = input(workspaceRoot, desiredModel);
  const plan = planWakeflowActiveFoundation(ownerInput);
  const participant = createWakeflowActiveFoundationMutationParticipant({
    ...ownerInput,
    confirmedPlan: plan,
  });
  const result = await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "fresh-initialize",
    operationKind: "active-foundation-materialization",
    domainOwner: "active-foundation-owner",
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
  assert.equal(result.status, "completed");
  assert.equal(mode(path.join(workspaceRoot, ".wakeflow-active")), "0755");
  assert.equal(mode(path.join(workspaceRoot, ".wakeflow-active/current")), "0755");
  const board = path.join(workspaceRoot, ...TODO_BOARD_REF.split("/"));
  assert.equal(mode(board), "0644");
  assert.equal(readFileSync(board, "utf8"), EMPTY_TODO_BOARD);
  assert.equal(scanTodoBoard(readFileSync(board, "utf8")).rowCount, 0);
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-active/README.md")), false);
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-active/current/workspace-current-status.md")), false);

  const repeated = planWakeflowActiveFoundation(ownerInput);
  assert.equal(repeated.payload.status, "blocked");
  assert.equal(repeated.payload.blockers.some((entry) => entry.code === "fresh-active-footprint-present"), true);
});

test("T08 non-fresh active foundation validates TODO authority and never recreates it", async (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = model();
  const freshInput = input(workspaceRoot, desiredModel);
  const freshPlan = planWakeflowActiveFoundation(freshInput);
  const participant = createWakeflowActiveFoundationMutationParticipant({
    ...freshInput,
    confirmedPlan: freshPlan,
  });
  await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "fresh-initialize",
    operationKind: "active-foundation-materialization",
    domainOwner: "active-foundation-owner",
    confirmedPlan: freshPlan,
    planDigest: canonicalJsonDigest(freshPlan),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    serializeWakeflowConfigV3(desiredModel),
    { mode: 0o644 },
  );
  chmodSync(path.join(workspaceRoot, "wakeflow.config.json"), 0o644);

  for (const action of ["reconfigure", "reconcile"]) {
    const current = planWakeflowActiveFoundation(input(workspaceRoot, desiredModel, action));
    assert.equal(current.payload.status, "ready");
    assert.deepEqual(current.payload.steps, []);
    assert.equal(current.payload.operations.every((entry) => entry.action === "current"), true);
  }

  const board = path.join(workspaceRoot, ...TODO_BOARD_REF.split("/"));
  rmSync(board);
  const missingBefore = snapshot(workspaceRoot);
  const missing = planWakeflowActiveFoundation(input(workspaceRoot, desiredModel, "reconcile"));
  assert.equal(missing.payload.status, "blocked");
  assert.equal(missing.payload.blockers.some((entry) => entry.code === "todo-authority-missing"), true);
  assert.deepEqual(missing.payload.steps, []);
  assert.deepEqual(snapshot(workspaceRoot), missingBefore);

  writeFileSync(board, "# corrupt\n", { mode: 0o644 });
  chmodSync(board, 0o644);
  const corruptBefore = snapshot(workspaceRoot);
  const corrupt = planWakeflowActiveFoundation(input(workspaceRoot, desiredModel, "reconfigure"));
  assert.equal(corrupt.payload.status, "blocked");
  assert.equal(corrupt.payload.blockers.some((entry) => entry.code === "todo-authority-invalid"), true);
  assert.deepEqual(corrupt.payload.steps, []);
  assert.deepEqual(snapshot(workspaceRoot), corruptBefore);
});
