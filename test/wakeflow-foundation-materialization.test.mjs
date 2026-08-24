import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import {
  createWakeflowLedgerMaterializationMutationParticipant,
  planWakeflowLedgerMaterialization,
  projectWakeflowLedgerMaterializationMaintenance,
  validateWakeflowLedgerMaterializationPlan,
} from "../core/scripts/lib/wakeflow-ledger-materialization.mjs";
import {
  createWakeflowManagedContentMutationParticipant,
  planWakeflowManagedContent,
} from "../core/scripts/lib/wakeflow-managed-content.mjs";
import { planWakeflowFreshInitializeBackbone } from "../core/scripts/lib/wakeflow-fresh-initialize.mjs";
import {
  createWakeflowSupportSurfaceMutationParticipant,
  planWakeflowSupportSurfaceOwner,
  projectWakeflowSupportSurfaceMaintenance,
  validateWakeflowSupportSurfaceOwnerPlan,
} from "../core/scripts/lib/wakeflow-support-surface-owner.mjs";
import {
  recoverWakeflowWorkspaceMutation,
  runWakeflowMaintenanceMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";
import { parseWakeflowAssetBundle } from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import { createWakeflowTrackedMaterializationParticipant } from "../core/scripts/lib/wakeflow-tracked-materialization.mjs";
import { buildWakeflowAssetBundle } from "../tools/build-asset-bundle.mjs";
import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetBundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({
  sourceRoot: path.join(repositoryRoot, "core/template-sources"),
}));
const fixtureValue = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json"),
  "utf8",
));
const supportOwnerUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-support-surface-owner.mjs",
)).href;
const ledgerOwnerUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-ledger-materialization.mjs",
)).href;
const layoutUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-layout-descriptor.mjs",
)).href;
const mutationUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-workspace-mutation.mjs",
)).href;
const canonicalUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-canonical-json.mjs",
)).href;

function model(mutator = null) {
  const value = structuredClone(fixtureValue);
  mutator?.(value);
  return parseWakeflowConfigV3(value);
}

function fixtureWorkspace(t, prefix = "wakeflow-foundation-") {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  return { fixtureRoot, workspaceRoot };
}

function supportInput(workspaceRoot, desiredModel, action = "fresh-initialize") {
  return {
    workspaceRoot,
    action,
    sourceModel: action === "fresh-initialize" ? null : desiredModel,
    desiredModel,
    layoutDescriptor: createWakeflowLayoutDescriptor({ model: desiredModel, hostProfile: codexProfile }),
    hostProfile: codexProfile,
  };
}

function ledgerInput(workspaceRoot, desiredModel, action = "fresh-initialize") {
  return {
    workspaceRoot,
    action,
    sourceModel: action === "fresh-initialize" ? null : desiredModel,
    desiredModel,
  };
}

test("T07 ledger planning rejects behavioral input and semantically forged operations", (t) => {
  const { workspaceRoot } = fixtureWorkspace(t, "wakeflow-ledger-contract-");
  const desiredModel = model();
  let calls = 0;
  const behavioral = ledgerInput(workspaceRoot, desiredModel);
  Object.defineProperty(behavioral, "action", {
    enumerable: true,
    get() {
      calls += 1;
      return "fresh-initialize";
    },
  });
  assert.throws(
    () => planWakeflowLedgerMaterialization(behavioral),
    (error) => /^wakeflow-ledger-materialization-/u.test(error?.code),
  );
  assert.equal(calls, 0);

  const plan = planWakeflowLedgerMaterialization(ledgerInput(workspaceRoot, desiredModel));
  const forgedPlans = [];
  const forgedRoot = structuredClone(plan);
  forgedRoot.payload.operations[0].root.configuredPath = "forged-ledger-root";
  forgedPlans.push(forgedRoot);
  const forgedOwner = structuredClone(plan);
  forgedOwner.payload.operations[0].owner = "ledger-projector";
  forgedPlans.push(forgedOwner);
  const forgedStage = structuredClone(plan);
  forgedStage.payload.operations.at(-1).stageRef = "workspace/archive/../forged.stage";
  forgedPlans.push(forgedStage);
  const omittedOperation = structuredClone(plan);
  const removed = omittedOperation.payload.operations.pop();
  omittedOperation.payload.steps = omittedOperation.payload.steps.filter((step) => step.stepId !== removed.operationId);
  forgedPlans.push(omittedOperation);
  for (const forged of forgedPlans) {
    assert.throws(
      () => validateWakeflowLedgerMaterializationPlan(forged),
      (error) => error?.code === "wakeflow-ledger-materialization-plan",
    );
  }

  let projectionCalls = 0;
  const behavioralProjection = { transactionOffset: 0 };
  Object.defineProperty(behavioralProjection, "plan", {
    enumerable: true,
    get() {
      projectionCalls += 1;
      return plan;
    },
  });
  assert.throws(
    () => projectWakeflowLedgerMaterializationMaintenance(behavioralProjection),
    (error) => /^wakeflow-ledger-materialization-/u.test(error?.code),
  );
  assert.equal(projectionCalls, 0);
});

test("T07 ledger fresh represents an unavailable configured parent as a closed blocked plan", (t) => {
  const { workspaceRoot } = fixtureWorkspace(t, "wakeflow-ledger-parent-");
  const desiredModel = model((value) => {
    value.storage.ledgerRoot = "../missing-parent/wakeflow-ledger";
  });
  const plan = planWakeflowLedgerMaterialization(ledgerInput(workspaceRoot, desiredModel));
  assert.equal(plan.payload.status, "blocked");
  assert.deepEqual(
    plan.payload.operations.map((operation) => operation.ref),
    [".", "requirement-designs", "goal-stage-confirmation", "workspace", "workspace/archive"],
  );
  assert.equal(plan.payload.operations.every((operation) => (
    operation.action === "blocked"
    && operation.reasonCode === "ledger-directory-parent-unavailable"
  )), true);
});

async function applyOwner({ workspaceRoot, action, owner, plan, operationKind, domainOwner }) {
  return runWakeflowMaintenanceMutation({
    workspaceRoot,
    action,
    operationKind,
    domainOwner,
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    validatePlan: owner.validatePlan,
    deriveCurrentPlan: owner.deriveCurrentPlan,
    deriveTerminalClosure: owner.deriveTerminalClosure,
    stepHandlers: owner.stepHandlers,
  });
}

function mode(candidate) {
  return `0${(lstatSync(candidate).mode & 0o777).toString(8).padStart(3, "0")}`;
}

function pendingMutation(workspaceRoot) {
  const transactionRoot = path.join(
    workspaceRoot,
    ".wakeflow-local/runtime/maintenance/transactions",
  );
  const journalName = readdirSync(transactionRoot).find((name) => (
    /^workspace-mutation_[0-9a-f-]+\.json$/u.test(name)
  ));
  assert.equal(typeof journalName, "string");
  const journal = JSON.parse(readFileSync(path.join(transactionRoot, journalName), "utf8"));
  return {
    transactionRoot,
    operationId: journalName.slice(0, -".json".length),
    plan: journal.plan,
  };
}

test("T07 support owner rejects behavioral input and semantically forged plans", (t) => {
  const { workspaceRoot } = fixtureWorkspace(t, "wakeflow-support-contract-");
  const desiredModel = model();
  const input = supportInput(workspaceRoot, desiredModel);

  let inputReads = 0;
  const behavioral = { ...input };
  Object.defineProperty(behavioral, "action", {
    enumerable: true,
    get() {
      inputReads += 1;
      return "fresh-initialize";
    },
  });
  assert.throws(
    () => planWakeflowSupportSurfaceOwner(behavioral),
    (error) => /^wakeflow-support-surface-/u.test(error?.code),
  );
  assert.equal(inputReads, 0, "support owner input must reject accessors without invoking them");
  assert.throws(
    () => planWakeflowSupportSurfaceOwner({ ...input, [Symbol("hidden")]: true }),
    (error) => error?.code === "wakeflow-support-surface-contract",
  );

  const plan = planWakeflowSupportSurfaceOwner(input);
  const forgedPlans = [];
  const forgedRoot = structuredClone(plan);
  forgedRoot.payload.operations[0].root.configuredPath = "forged/support";
  forgedPlans.push(forgedRoot);
  const forgedReason = structuredClone(plan);
  forgedReason.payload.operations[0].reasonCode = "forged-reason";
  forgedPlans.push(forgedReason);
  const forgedSurface = structuredClone(plan);
  forgedSurface.payload.operations[0].surfaceId = "surface-forged";
  forgedPlans.push(forgedSurface);
  for (const forged of forgedPlans) {
    assert.throws(
      () => validateWakeflowSupportSurfaceOwnerPlan(forged),
      (error) => /^wakeflow-support-surface-/u.test(error?.code),
    );
  }

  let projectionReads = 0;
  const behavioralProjection = { transactionOffset: 0 };
  Object.defineProperty(behavioralProjection, "plan", {
    enumerable: true,
    get() {
      projectionReads += 1;
      return plan;
    },
  });
  assert.throws(
    () => projectWakeflowSupportSurfaceMaintenance(behavioralProjection),
    (error) => /^wakeflow-support-surface-/u.test(error?.code),
  );
  assert.equal(projectionReads, 0, "support maintenance projection must reject accessors without invoking them");

  assert.throws(
    () => planWakeflowSupportSurfaceOwner({ ...input, workspaceRoot: "relative-workspace" }),
    (error) => error?.code === "wakeflow-support-surface-input",
  );
});

test("tracked materialization freezes callback authority and rejects behavioral private seams", (t) => {
  const { workspaceRoot } = fixtureWorkspace(t, "wakeflow-tracked-contract-");
  const confirmedPlan = {
    schemaId: "urn:wakeflow:test:tracked-materialization:v1",
    payload: { steps: [] },
  };
  let originalAuthorityCalls = 0;
  const mutableOptions = {
    workspaceRoot,
    confirmedPlan,
    validatePlan(plan) {
      mutableOptions.validateAuthority = () => ({ valid: true });
      return plan;
    },
    deriveCurrentPlan() {
      return confirmedPlan;
    },
    validateAuthority() {
      originalAuthorityCalls += 1;
      throw new Error("original tracked authority");
    },
    privateOperations: [],
    closureName: "tracked-contract",
  };
  const callbackParticipant = createWakeflowTrackedMaterializationParticipant(mutableOptions);
  assert.throws(
    () => callbackParticipant.deriveCurrentPlan({ context: null }),
    /original tracked authority/u,
  );
  assert.equal(originalAuthorityCalls, 1, "validated callback references must not be replaceable");

  let verdictReads = 0;
  const verdictParticipant = createWakeflowTrackedMaterializationParticipant({
    workspaceRoot,
    confirmedPlan,
    validatePlan: (plan) => plan,
    deriveCurrentPlan: () => confirmedPlan,
    validateAuthority() {
      const verdict = {};
      Object.defineProperty(verdict, "valid", {
        enumerable: true,
        get() {
          verdictReads += 1;
          return true;
        },
      });
      return verdict;
    },
    privateOperations: [],
    closureName: "tracked-verdict",
  });
  assert.throws(() => verdictParticipant.deriveCurrentPlan({ context: null }));
  assert.equal(verdictReads, 0, "authority verdict accessors must be rejected without execution");

  const hiddenOperations = [];
  hiddenOperations[Symbol("hidden")] = true;
  assert.throws(
    () => createWakeflowTrackedMaterializationParticipant({
      workspaceRoot,
      confirmedPlan,
      validatePlan: (plan) => plan,
      deriveCurrentPlan: () => confirmedPlan,
      validateAuthority: () => ({ valid: true }),
      privateOperations: hiddenOperations,
      closureName: "tracked-hidden",
    }),
    (error) => error?.code === "wakeflow-tracked-materialization-contract",
  );

  const passiveParticipant = createWakeflowTrackedMaterializationParticipant({
    workspaceRoot,
    confirmedPlan,
    validatePlan: (plan) => plan,
    deriveCurrentPlan: () => confirmedPlan,
    validateAuthority: () => ({ valid: true }),
    privateOperations: [],
    closureName: "tracked-passive",
  });
  let planReads = 0;
  const behavioralArgs = {};
  Object.defineProperty(behavioralArgs, "plan", {
    enumerable: true,
    get() {
      planReads += 1;
      return confirmedPlan;
    },
  });
  assert.throws(() => passiveParticipant.validatePlan(behavioralArgs));
  assert.equal(planReads, 0, "participant callback arguments must remain passive");

  let recoveryGenerationReads = 0;
  const forgedContext = {};
  Object.defineProperty(forgedContext, "recoveryGeneration", {
    enumerable: true,
    get() {
      recoveryGenerationReads += 1;
      return 0;
    },
  });
  assert.throws(
    () => passiveParticipant.deriveCurrentPlan({ context: forgedContext }),
    (error) => error?.code === "wakeflow-mutation-context-forgery",
  );
  assert.equal(
    recoveryGenerationReads,
    0,
    "forged mutation contexts must be rejected by brand before any behavioral field is read",
  );
});

test("tracked file admission rejects a staging resource that differs from the target bytes", (t) => {
  const { workspaceRoot } = fixtureWorkspace(t, "wakeflow-tracked-stage-");
  const targetBytes = Buffer.from("tracked target\n", "utf8");
  const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const confirmedPlan = {
    schemaId: "urn:wakeflow:test:tracked-materialization:v1",
    payload: {
      steps: [{
        stepId: "tracked-file-step",
        ordinal: 0,
        stepKind: "create-or-update",
        source: { ref: "target", type: "absent" },
        staging: { ref: "stage", type: "file", mode: "0644", digest: digest(Buffer.from("other")) },
        final: { ref: "target", type: "file", mode: "0644", digest: digest(targetBytes) },
      }],
    },
  };
  assert.throws(
    () => createWakeflowTrackedMaterializationParticipant({
      workspaceRoot,
      confirmedPlan,
      validatePlan: (plan) => plan,
      deriveCurrentPlan: () => confirmedPlan,
      validateAuthority: () => ({ valid: true }),
      privateOperations: [{
        stepId: "tracked-file-step",
        kind: "file",
        targetPath: path.join(workspaceRoot, "target"),
        stagePath: path.join(workspaceRoot, ".target.stage"),
        targetBytes,
        maxFileBytes: 1024,
      }],
      closureName: "tracked-stage",
    }),
    (error) => error?.code === "wakeflow-tracked-materialization-operation",
  );
});

test("T07 support owner creates only internal support roots and capability directories", async (t) => {
  const { workspaceRoot } = fixtureWorkspace(t, "wakeflow-support-owner-");
  const desiredModel = model();
  const input = supportInput(workspaceRoot, desiredModel);
  const before = readdirSync(workspaceRoot);
  const plan = planWakeflowSupportSurfaceOwner(input);

  assert.equal(plan.payload.status, "ready");
  assert.equal(plan.payload.steps.length, 5);
  assert.deepEqual(readdirSync(workspaceRoot), before, "support preview must be zero-write");
  for (const surfaceId of plan.payload.plannedSupportSurfaceIds) {
    const operations = plan.payload.operations.filter((entry) => entry.surfaceId === surfaceId);
    assert.equal(operations[0].ref, ".", "support root must commit before its capabilities");
  }

  const owner = createWakeflowSupportSurfaceMutationParticipant({ ...input, confirmedPlan: plan });
  const previousUmask = process.umask(0o077);
  try {
    await applyOwner({
      workspaceRoot,
      action: input.action,
      owner,
      plan,
      operationKind: "support-surface-materialization",
      domainOwner: "support-materializer",
    });
  } finally {
    process.umask(previousUmask);
  }

  for (const ref of ["Design", "Design/drafts", "Test", "Test/harnesses", "Test/fixtures"]) {
    assert.equal(mode(path.join(workspaceRoot, ...ref.split("/"))), "0755");
  }
  for (const forbidden of ["Design/README.md", "Test/README.md", "Design/AGENTS.md", "Test/AGENTS.md"]) {
    assert.equal(existsSync(path.join(workspaceRoot, ...forbidden.split("/"))), false);
  }
});

test("T07 support owner is absent-only for fresh and emits zero operations for external surfaces", () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-support-footprint-"));
  try {
    const workspaceRoot = path.join(fixtureRoot, "Program");
    mkdirSync(path.join(workspaceRoot, "Design"), { recursive: true, mode: 0o755 });
    writeFileSync(path.join(workspaceRoot, "Design", "README.md"), "legacy\n", { mode: 0o644 });
    const blocked = planWakeflowSupportSurfaceOwner(supportInput(workspaceRoot, model()));
    assert.equal(blocked.payload.status, "blocked");
    assert.equal(blocked.payload.blockers.some((entry) => entry.code === "fresh-support-root-present"), true);

    rmSync(path.join(workspaceRoot, "Design"), { recursive: true, force: true });
    const external = model((value) => {
      for (const surface of value.topology.supportSurfaces) {
        surface.ownership = "external-owned";
        surface.instructionManagement = "owner-managed";
        surface.path = surface.capability === "design" ? "../ExternalDesign" : "../ExternalTest";
      }
    });
    const externalPlan = planWakeflowSupportSurfaceOwner(supportInput(workspaceRoot, external));
    assert.deepEqual(externalPlan.payload.operations, []);
    assert.deepEqual(externalPlan.payload.steps, []);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("T07 planned support roots let the existing memory owner participate after directory commit", async (t) => {
  const { workspaceRoot } = fixtureWorkspace(t, "wakeflow-planned-support-memory-");
  const desiredModel = model();
  const support = supportInput(workspaceRoot, desiredModel);
  const supportPlan = planWakeflowSupportSurfaceOwner(support);
  const managedInput = {
    workspaceRoot,
    action: "fresh-initialize",
    sourceModel: null,
    desiredModel,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
    plannedSupportSurfaceIds: supportPlan.payload.plannedSupportSurfaceIds,
  };
  const managedPlan = planWakeflowManagedContent(managedInput);
  assert.equal(managedPlan.payload.operations.some((entry) => (
    entry.root.kind === "surface" && entry.reasonCode === "managed-root-missing"
  )), false);
  assert.equal(managedPlan.payload.operations.filter((entry) => (
    entry.root.kind === "surface" && entry.action === "create-managed"
  )).length, 2);

  const supportOwner = createWakeflowSupportSurfaceMutationParticipant({
    ...support,
    confirmedPlan: supportPlan,
  });
  await applyOwner({
    workspaceRoot,
    action: support.action,
    owner: supportOwner,
    plan: supportPlan,
    operationKind: "support-surface-materialization",
    domainOwner: "support-materializer",
  });

  const managedOwner = createWakeflowManagedContentMutationParticipant({
    ...managedInput,
    confirmedPlan: managedPlan,
  });
  await applyOwner({
    workspaceRoot,
    action: managedInput.action,
    owner: managedOwner,
    plan: managedPlan,
    operationKind: "managed-content",
    domainOwner: "managed-content-owner",
  });
  assert.equal(existsSync(path.join(workspaceRoot, "Design", codexProfile.memoryFile)), true);
  assert.equal(existsSync(path.join(workspaceRoot, "Test", codexProfile.memoryFile)), true);

  const repeatedFresh = planWakeflowFreshInitializeBackbone({
    workspaceRoot,
    desiredModel,
    hostProfile: codexProfile,
    bundle: assetBundle,
    language: "zh",
  });
  assert.equal(repeatedFresh.aggregatePlan.payload.status, "blocked");
  assert.equal(repeatedFresh.blockers.some((entry) => (
    entry.code === "fresh-managed-footprint-present"
  )), true);
});

test("T07 ledger owner creates the exact durable layout and four derived projections", async (t) => {
  const { workspaceRoot } = fixtureWorkspace(t, "wakeflow-ledger-owner-");
  const desiredModel = model();
  const input = ledgerInput(workspaceRoot, desiredModel);
  const ledgerRoot = path.resolve(workspaceRoot, desiredModel.storage.ledgerRoot);
  const before = readdirSync(path.dirname(workspaceRoot));
  const plan = planWakeflowLedgerMaterialization(input);

  assert.equal(plan.payload.status, "ready");
  assert.equal(plan.payload.steps.length, 9);
  assert.deepEqual(readdirSync(path.dirname(workspaceRoot)), before, "ledger preview must be zero-write");
  const owner = createWakeflowLedgerMaterializationMutationParticipant({ ...input, confirmedPlan: plan });
  await applyOwner({
    workspaceRoot,
    action: input.action,
    owner,
    plan,
    operationKind: "ledger-materialization",
    domainOwner: "ledger-service",
  });

  for (const ref of [".", "requirement-designs", "goal-stage-confirmation", "workspace", "workspace/archive"]) {
    assert.equal(mode(ref === "." ? ledgerRoot : path.join(ledgerRoot, ...ref.split("/"))), "0755");
  }
  for (const ref of [
    "requirement-designs/index.md",
    "goal-stage-confirmation/index.md",
    "workspace/workspace-record-map.md",
    "workspace/archive/index.md",
  ]) {
    const target = path.join(ledgerRoot, ...ref.split("/"));
    assert.equal(mode(target), "0644");
    assert.match(readFileSync(target, "utf8"), /wakeflow:ledger-projection:v1/u);
  }
  assert.equal(existsSync(path.join(ledgerRoot, "README.md")), false);
});

test("T07 ledger fresh is root-absent-only and reconcile never fabricates missing authority directories", async (t) => {
  const { workspaceRoot } = fixtureWorkspace(t, "wakeflow-ledger-strict-");
  const desiredModel = model();
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    serializeWakeflowConfigV3(desiredModel),
    { mode: 0o644 },
  );
  const ledgerRoot = path.resolve(workspaceRoot, desiredModel.storage.ledgerRoot);
  mkdirSync(ledgerRoot, { recursive: true, mode: 0o755 });
  chmodSync(ledgerRoot, 0o755);
  const fresh = planWakeflowLedgerMaterialization(ledgerInput(workspaceRoot, desiredModel));
  assert.equal(fresh.payload.status, "blocked");
  assert.equal(fresh.payload.blockers[0].code, "fresh-ledger-root-present");

  const reconcile = planWakeflowLedgerMaterialization(ledgerInput(workspaceRoot, desiredModel, "reconcile"));
  assert.equal(reconcile.payload.status, "blocked");
  assert.equal(reconcile.payload.blockers.some((entry) => entry.code === "ledger-authority-directory-missing"), true);

  for (const ref of ["requirement-designs", "goal-stage-confirmation", "workspace", "workspace/archive"]) {
    const target = path.join(ledgerRoot, ...ref.split("/"));
    mkdirSync(target, { recursive: true, mode: 0o755 });
    chmodSync(target, 0o755);
  }
  const indexes = planWakeflowLedgerMaterialization(ledgerInput(workspaceRoot, desiredModel, "reconcile"));
  assert.equal(indexes.payload.status, "ready");
  assert.equal(indexes.payload.steps.length, 4);
  const owner = createWakeflowLedgerMaterializationMutationParticipant({
    ...ledgerInput(workspaceRoot, desiredModel, "reconcile"),
    confirmedPlan: indexes,
  });
  await applyOwner({
    workspaceRoot,
    action: "reconcile",
    owner,
    plan: indexes,
    operationKind: "ledger-materialization",
    domainOwner: "ledger-service",
  });

  unlinkSync(path.join(ledgerRoot, "requirement-designs", "index.md"));
  writeFileSync(path.join(ledgerRoot, "unknown.txt"), "owner residue\n", { mode: 0o644 });
  const unsafe = planWakeflowLedgerMaterialization(ledgerInput(workspaceRoot, desiredModel, "reconcile"));
  assert.equal(unsafe.payload.status, "blocked");
  assert.equal(unsafe.payload.blockers.some((entry) => entry.code === "ledger-authority-inventory-unsafe"), true);
});

test("T07 tracked support and ledger materialization recover exact process-death boundaries", {
  skip: !new Set(["darwin", "linux"]).has(process.platform)
    ? "M3 process-identity recovery is supported on Darwin and Linux"
    : false,
  timeout: 120_000,
}, async (t) => {
  await t.test("support-directory-commit", { timeout: 30_000 }, async (subtest) => {
    const { workspaceRoot } = fixtureWorkspace(subtest, "wakeflow-support-recovery-");
    const desiredModel = model();
    const childSource = `
      const owner = await import(${JSON.stringify(supportOwnerUrl)});
      const layout = await import(${JSON.stringify(layoutUrl)});
      const manager = await import(${JSON.stringify(mutationUrl)});
      const canonical = await import(${JSON.stringify(canonicalUrl)});
      const workspaceRoot = ${JSON.stringify(workspaceRoot)};
      const desiredModel = ${JSON.stringify(desiredModel)};
      const hostProfile = ${JSON.stringify(codexProfile)};
      const input = {
        workspaceRoot,
        action: "fresh-initialize",
        sourceModel: null,
        desiredModel,
        layoutDescriptor: layout.createWakeflowLayoutDescriptor({ model: desiredModel, hostProfile }),
        hostProfile,
      };
      const plan = owner.planWakeflowSupportSurfaceOwner(input);
      const participant = owner.createWakeflowSupportSurfaceMutationParticipant({ ...input, confirmedPlan: plan });
      const step = plan.payload.steps[0];
      const real = participant.stepHandlers[step.stepId];
      const stepHandlers = { ...participant.stepHandlers, [step.stepId]: { ...real,
        commit(...args) { real.commit(...args); process.kill(process.pid, "SIGKILL"); },
      } };
      await manager.runWakeflowMaintenanceMutation({
        workspaceRoot,
        action: input.action,
        operationKind: "support-surface-materialization",
        domainOwner: "support-materializer",
        confirmedPlan: plan,
        planDigest: canonical.canonicalJsonDigest(plan),
        validatePlan: participant.validatePlan,
        deriveCurrentPlan: participant.deriveCurrentPlan,
        deriveTerminalClosure: participant.deriveTerminalClosure,
        stepHandlers,
      });
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let childError = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { childError += chunk; });
    const [exitCode, signal] = await once(child, "exit");
    assert.equal(exitCode, null, childError);
    assert.equal(signal, "SIGKILL", childError);

    const pending = pendingMutation(workspaceRoot);
    const input = supportInput(workspaceRoot, desiredModel);
    const participant = createWakeflowSupportSurfaceMutationParticipant({
      ...input,
      confirmedPlan: pending.plan,
    });
    const recovered = await recoverWakeflowWorkspaceMutation({
      workspaceRoot,
      operationId: pending.operationId,
      confirmedPlan: pending.plan,
      planDigest: canonicalJsonDigest(pending.plan),
      validatePlan: participant.validatePlan,
      deriveCurrentPlan: participant.deriveCurrentPlan,
      deriveTerminalClosure: participant.deriveTerminalClosure,
      stepHandlers: participant.stepHandlers,
    });
    assert.equal(recovered.status, "recovered");
    assert.deepEqual(readdirSync(pending.transactionRoot), []);
    assert.equal(planWakeflowSupportSurfaceOwner(input).payload.steps.length, 0);
  });

  for (const boundary of ["prepare", "commit", "cleanup"]) {
    await t.test(`ledger-file-${boundary}`, { timeout: 30_000 }, async (subtest) => {
      const { workspaceRoot } = fixtureWorkspace(subtest, `wakeflow-ledger-${boundary}-recovery-`);
      const desiredModel = model();
      const childSource = `
        const owner = await import(${JSON.stringify(ledgerOwnerUrl)});
        const manager = await import(${JSON.stringify(mutationUrl)});
        const canonical = await import(${JSON.stringify(canonicalUrl)});
        const workspaceRoot = ${JSON.stringify(workspaceRoot)};
        const desiredModel = ${JSON.stringify(desiredModel)};
        const input = {
          workspaceRoot,
          action: "fresh-initialize",
          sourceModel: null,
          desiredModel,
        };
        const plan = owner.planWakeflowLedgerMaterialization(input);
        const participant = owner.createWakeflowLedgerMaterializationMutationParticipant({ ...input, confirmedPlan: plan });
        const step = plan.payload.steps.find((entry) => entry.staging !== null);
        const real = participant.stepHandlers[step.stepId];
        const stepHandlers = { ...participant.stepHandlers, [step.stepId]: { ...real,
          ${boundary}(...args) { real.${boundary}(...args); process.kill(process.pid, "SIGKILL"); },
        } };
        await manager.runWakeflowMaintenanceMutation({
          workspaceRoot,
          action: input.action,
          operationKind: "ledger-materialization",
          domainOwner: "ledger-service",
          confirmedPlan: plan,
          planDigest: canonical.canonicalJsonDigest(plan),
          validatePlan: participant.validatePlan,
          deriveCurrentPlan: participant.deriveCurrentPlan,
          deriveTerminalClosure: participant.deriveTerminalClosure,
          stepHandlers,
        });
      `;
      const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let childError = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { childError += chunk; });
      const [exitCode, signal] = await once(child, "exit");
      assert.equal(exitCode, null, childError);
      assert.equal(signal, "SIGKILL", childError);

      const pending = pendingMutation(workspaceRoot);
      const input = ledgerInput(workspaceRoot, desiredModel);
      const participant = createWakeflowLedgerMaterializationMutationParticipant({
        ...input,
        confirmedPlan: pending.plan,
      });
      const recovered = await recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId: pending.operationId,
        confirmedPlan: pending.plan,
        planDigest: canonicalJsonDigest(pending.plan),
        validatePlan: participant.validatePlan,
        deriveCurrentPlan: participant.deriveCurrentPlan,
        deriveTerminalClosure: participant.deriveTerminalClosure,
        stepHandlers: participant.stepHandlers,
      });
      assert.equal(
        recovered.status,
        boundary === "cleanup" ? "terminal-cleanup-recovered" : "recovered",
      );
      assert.deepEqual(readdirSync(pending.transactionRoot), []);
      const ledgerRoot = path.resolve(workspaceRoot, desiredModel.storage.ledgerRoot);
      for (const ref of [
        "requirement-designs/index.md",
        "goal-stage-confirmation/index.md",
        "workspace/workspace-record-map.md",
        "workspace/archive/index.md",
      ]) {
        const final = path.join(ledgerRoot, ...ref.split("/"));
        assert.equal(lstatSync(final).nlink, 1);
        assert.equal(readdirSync(path.dirname(final)).some((name) => name.endsWith(".stage")), false);
      }
    });
  }
});
