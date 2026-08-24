import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const managerFile = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-workspace-mutation.mjs",
);
const schemaDirectory = path.join(repositoryRoot, "core/schemas/wakeflow-maintenance");
const schemaFiles = {
  lock: path.join(schemaDirectory, "workspace-mutation-lock.schema.json"),
  transaction: path.join(schemaDirectory, "maintenance-transaction.schema.json"),
  recoveryClaim: path.join(schemaDirectory, "recovery-claim.schema.json"),
};
const managerUrl = pathToFileURL(managerFile).href;

const localRelative = ".wakeflow-local";
const runtimeRelative = `${localRelative}/runtime`;
const maintenanceRelative = `${runtimeRelative}/maintenance`;
const transactionsRelative = `${maintenanceRelative}/transactions`;
const lockRelative = `${runtimeRelative}/maintenance.lock`;

async function mutationManager() {
  return import(managerUrl);
}

function withTempWorkspace(t, prefix = "wakeflow-maintenance-") {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(workspaceRoot, { force: true, recursive: true }));
  return workspaceRoot;
}

function protocolPath(workspaceRoot, relativePath) {
  return path.join(workspaceRoot, ...relativePath.split("/"));
}

function bootstrapProtocol(workspaceRoot) {
  mkdirSync(protocolPath(workspaceRoot, localRelative), { mode: 0o700 });
  mkdirSync(protocolPath(workspaceRoot, runtimeRelative), { mode: 0o700 });
  mkdirSync(protocolPath(workspaceRoot, maintenanceRelative), { mode: 0o700 });
  mkdirSync(protocolPath(workspaceRoot, transactionsRelative), { mode: 0o700 });
}

function maintenancePlan(steps = []) {
  return {
    schemaId: "urn:wakeflow:internal:test-maintenance-plan:v1",
    payload: { steps },
  };
}

function assertTestPlan(plan) {
  assert.equal(plan !== null && typeof plan === "object" && !Array.isArray(plan), true);
  assert.equal(Object.getPrototypeOf(plan), Object.prototype);
  assert.equal(Object.hasOwn(plan, "schemaId"), true);
  assert.equal(Object.hasOwn(plan, "payload"), true);
  assert.deepEqual(Object.keys(plan).sort(), ["payload", "schemaId"]);
  assert.equal(plan.schemaId, "urn:wakeflow:internal:test-maintenance-plan:v1");
  assert.equal(
    plan.payload !== null && typeof plan.payload === "object" && !Array.isArray(plan.payload),
    true,
  );
  assert.equal(Object.getPrototypeOf(plan.payload), Object.prototype);
  assert.equal(Object.hasOwn(plan.payload, "steps"), true);
  assert.equal(Array.isArray(plan.payload.steps), true);
  return plan;
}

async function validateTestPlan(input) {
  assert.equal(input !== null && typeof input === "object" && !Array.isArray(input), true);
  assert.equal(Object.getPrototypeOf(input), Object.prototype);
  assert.equal(Object.hasOwn(input, "plan"), true);
  assert.deepEqual(Object.keys(input), ["plan"]);
  assertTestPlan(input.plan);
  return { valid: true };
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function ownerEffectRecord(schemaId, payload) {
  return {
    schemaId,
    payload,
    recordDigest: canonicalJsonDigest({ schemaId, payload }),
  };
}

function ownerEffectStep(overrides = {}) {
  return {
    stepId: "host-decommission-effect",
    ordinal: 0,
    stepKind: "owner-effect",
    effectKind: "host-decommission",
    intentDigest: sha256("exact host decommission intent"),
    checkpointSchemaId: "urn:wakeflow:internal:test-effect-checkpoint:v1",
    resultSchemaId: "urn:wakeflow:internal:test-effect-result:v1",
    outcomeSchemaId: "urn:wakeflow:internal:test-effect-outcome:v1",
    ...overrides,
  };
}

function ownerToken() {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function operationId() {
  return `workspace-mutation_${randomUUID()}`;
}

function fileContract(relativePath, { type, mode = null, digest = null }) {
  if (type === "absent") return { ref: relativePath, type };
  return { ref: relativePath, type, mode, digest };
}

function modeString(mode) {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

function portablePath(workspaceRoot, ref) {
  assert.equal(path.isAbsolute(ref), false, "transaction refs must remain portable");
  const resolved = path.resolve(workspaceRoot, ...ref.split("/"));
  assert.ok(
    resolved.startsWith(`${path.resolve(workspaceRoot)}${path.sep}`),
    `transaction ref escaped its workspace: ${ref}`,
  );
  return resolved;
}

function observeRef(workspaceRoot, contract) {
  const target = portablePath(workspaceRoot, contract.ref);
  if (!existsSync(target)) return { ref: contract.ref, type: "absent" };
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) {
    return { ref: contract.ref, type: "symlink", mode: modeString(stat.mode), digest: null };
  }
  if (stat.isDirectory()) {
    return { ref: contract.ref, type: "directory", mode: modeString(stat.mode), digest: null };
  }
  assert.equal(stat.isFile(), true, `unsupported fixture type at ${target}`);
  return {
    ref: contract.ref,
    type: "file",
    mode: modeString(stat.mode),
    digest: sha256(readFileSync(target)),
  };
}

function stepObservation(workspaceRoot, step) {
  return {
    source: observeRef(workspaceRoot, step.source),
    staging: observeRef(workspaceRoot, step.staging),
    final: observeRef(workspaceRoot, step.final),
  };
}

function nullStagingDirectoryObservation(workspaceRoot, step) {
  assert.equal(step.stepKind, "create-or-update");
  assert.equal(step.staging, null);
  assert.equal(step.source.ref, step.final.ref);
  assert.equal(step.final.type, "directory");
  const target = portablePath(workspaceRoot, step.final.ref);
  const snapshot = existsSync(target)
    ? fileContract(step.final.ref, {
      type: "directory",
      mode: modeString(lstatSync(target).mode),
      digest: step.final.digest,
    })
    : fileContract(step.final.ref, { type: "absent" });
  return { source: snapshot, staging: null, final: snapshot };
}

function nullStagingDirectoryClosure(workspaceRoot) {
  return ({ plan, planDigest }) => {
    assertTestPlan(plan);
    assert.equal(plan.payload.steps.length, 1);
    return {
      planDigest,
      closureDigests: [{
        name: "static-directory-layout",
        digest: canonicalJsonDigest({
          planDigest,
          final: nullStagingDirectoryObservation(
            workspaceRoot,
            plan.payload.steps[0],
          ).final,
        }),
      }],
    };
  };
}

function deriveSyntheticTerminalClosure(workspaceRoot, { onDerive = () => {} } = {}) {
  return ({ plan }) => {
    assertTestPlan(plan);
    const planDigest = canonicalJsonDigest(plan);
    const closureDigests = plan.payload.steps.map((step) => {
      const observation = stepObservation(workspaceRoot, step);
      let resources;
      if (step.stepKind === "audit-publish") {
        resources = { source: observation.source, final: observation.final };
      } else {
        resources = { final: observation.final };
      }
      return {
        name: `test-domain-closure-${step.ordinal}`,
        digest: canonicalJsonDigest({
          planDigest,
          domain: "synthetic",
          stepId: step.stepId,
          stepKind: step.stepKind,
          resources,
        }),
      };
    });
    const closure = { planDigest, closureDigests };
    onDerive(closure);
    return closure;
  };
}

function singleJournalFile(workspaceRoot) {
  const directory = protocolPath(workspaceRoot, transactionsRelative);
  const entries = readdirSync(directory).filter((entry) => (
    entry.endsWith(".json") && !entry.includes(".recovery-")
  ));
  assert.equal(entries.length, 1, "exactly one in-flight transaction journal is expected");
  return path.join(directory, entries[0]);
}

function recoveryClaimFiles(workspaceRoot, expectedOperationId = null) {
  const prefix = expectedOperationId === null
    ? "workspace-mutation_"
    : `${expectedOperationId}.recovery-`;
  return readdirSync(protocolPath(workspaceRoot, transactionsRelative))
    .filter((entry) => entry.startsWith(prefix) && /\.recovery-[1-9][0-9]*\.json$/u.test(entry))
    .sort()
    .map((entry) => path.join(protocolPath(workspaceRoot, transactionsRelative), entry));
}

function assertNoMaintenanceResidue(workspaceRoot) {
  assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
  assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
}

function assertPrivateDirectory(target) {
  const stat = lstatSync(target);
  assert.equal(stat.isDirectory(), true);
  assert.equal(stat.isSymbolicLink(), false);
  assert.equal(stat.mode & 0o777, 0o700);
}

function assertPrivateRegularFile(target) {
  const stat = lstatSync(target);
  assert.equal(stat.isFile(), true);
  assert.equal(stat.isSymbolicLink(), false);
  assert.equal(stat.nlink, 1);
  assert.equal(stat.mode & 0o777, 0o600);
}

async function waitFor(predicate, message, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

function spawnModuleChild(source, args = [], { env = process.env } = {}) {
  return spawn(process.execPath, ["--input-type=module", "-e", source, ...args], {
    cwd: repositoryRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function collectChild(child) {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, "exit");
  return { code, signal, stdout, stderr };
}

function constValues(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) constValues(entry, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (Object.hasOwn(value, "const")) output.add(value.const);
  for (const entry of Object.values(value)) constValues(entry, output);
  return output;
}

test("workspace mutation inspection rejects hidden, symbol, and accessor options", async (t) => {
  const { inspectWakeflowWorkspaceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-option-contract-");

  const hidden = { workspaceRoot };
  Object.defineProperty(hidden, "hiddenAuthority", {
    value: true,
    enumerable: false,
  });
  assert.throws(
    () => inspectWakeflowWorkspaceMutation(hidden),
    /(?:field|contract|hidden|enumerable)/iu,
  );

  const symbolic = { workspaceRoot };
  symbolic[Symbol("hidden-authority")] = true;
  assert.throws(
    () => inspectWakeflowWorkspaceMutation(symbolic),
    /(?:field|contract|symbol)/iu,
  );

  let accessorCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "workspaceRoot", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return workspaceRoot;
    },
  });
  assert.throws(
    () => inspectWakeflowWorkspaceMutation(accessor),
    /(?:data property|contract|accessor)/iu,
  );
  assert.equal(accessorCalls, 0);
});

test("workspace mutation plan codec rejects a verdict accessor without invoking it", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-codec-verdict-");
  const plan = maintenancePlan();
  let accessorCalls = 0;

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "codec-verdict-contract",
      domainOwner: "maintenance-contract-test",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: async () => {
        const verdict = {};
        Object.defineProperty(verdict, "valid", {
          enumerable: true,
          get() {
            accessorCalls += 1;
            return true;
          },
        });
        return verdict;
      },
      deriveCurrentPlan: async () => plan,
      deriveTerminalClosure: null,
      stepHandlers: {},
    }),
    /(?:valid|verdict|data property|canonical)/iu,
  );
  assert.equal(accessorCalls, 0);
  assert.equal(existsSync(protocolPath(workspaceRoot, localRelative)), false);
});

test("workspace mutation rejects symbol-keyed zero-step handlers", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-symbol-handler-");
  const plan = maintenancePlan();
  const stepHandlers = {};
  stepHandlers[Symbol("hidden-handler-authority")] = Object.freeze({});

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "symbol-handler-contract",
      domainOwner: "maintenance-contract-test",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => plan,
      deriveTerminalClosure: null,
      stepHandlers,
    }),
    /(?:handler|field|symbol|coverage)/iu,
  );
  assert.equal(existsSync(protocolPath(workspaceRoot, localRelative)), false);
});

test("workspace mutation rejects a step callback accessor without invoking it", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-handler-accessor-");
  const finalRef = `${runtimeRelative}/shared`;
  const step = {
    stepId: "handler-accessor-contract",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(finalRef, { type: "absent" }),
    staging: null,
    final: fileContract(finalRef, {
      type: "directory",
      mode: "0700",
      digest: sha256("handler accessor directory contract"),
    }),
  };
  const plan = maintenancePlan([step]);
  let accessorCalls = 0;
  const handler = {
    prepare: async () => {},
    commit: async () => {
      mkdirSync(portablePath(workspaceRoot, finalRef), { mode: 0o700 });
    },
  };
  Object.defineProperty(handler, "observe", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return async () => nullStagingDirectoryObservation(workspaceRoot, step);
    },
  });

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "fresh-initialize",
      operationKind: "handler-accessor-contract",
      domainOwner: "maintenance-contract-test",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => plan,
      deriveTerminalClosure: nullStagingDirectoryClosure(workspaceRoot),
      stepHandlers: { [step.stepId]: handler },
    }),
    /(?:handler|observe|data property|callback)/iu,
  );
  assert.equal(accessorCalls, 0);
  assert.equal(existsSync(protocolPath(workspaceRoot, localRelative)), false);
});

test("workspace mutation snapshots step callbacks before asynchronous plan validation", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-handler-snapshot-");
  const finalRef = `${runtimeRelative}/shared`;
  const step = {
    stepId: "handler-snapshot-contract",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(finalRef, { type: "absent" }),
    staging: null,
    final: fileContract(finalRef, {
      type: "directory",
      mode: "0700",
      digest: sha256("handler snapshot directory contract"),
    }),
  };
  const plan = maintenancePlan([step]);
  let originalObserveCalls = 0;
  let replacementObserveCalls = 0;
  let codecCalls = 0;
  const handler = {
    prepare: async () => {},
    observe: async () => {
      originalObserveCalls += 1;
      return nullStagingDirectoryObservation(workspaceRoot, step);
    },
    commit: async () => {
      mkdirSync(portablePath(workspaceRoot, finalRef), { mode: 0o700 });
    },
  };

  const result = await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "fresh-initialize",
    operationKind: "handler-snapshot-contract",
    domainOwner: "maintenance-contract-test",
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    validatePlan: async ({ plan: candidate }) => {
      assertTestPlan(candidate);
      codecCalls += 1;
      if (codecCalls === 1) {
        handler.observe = async () => {
          replacementObserveCalls += 1;
          return nullStagingDirectoryObservation(workspaceRoot, step);
        };
      }
      return { valid: true };
    },
    deriveCurrentPlan: async () => plan,
    deriveTerminalClosure: nullStagingDirectoryClosure(workspaceRoot),
    stepHandlers: { [step.stepId]: handler },
  });

  assert.equal(result.status, "completed");
  assert.ok(originalObserveCalls > 0);
  assert.equal(replacementObserveCalls, 0);
  assertNoMaintenanceResidue(workspaceRoot);
});

test("runtime failure verifier rejects a disposition accessor without invoking it", async (t) => {
  const { withWakeflowRuntimeMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-runtime-verdict-accessor-");
  bootstrapProtocol(workspaceRoot);
  let accessorCalls = 0;

  await assert.rejects(
    () => withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "runtime-verdict-contract",
      domainOwner: "maintenance-contract-test",
      onCallbackFailure: async () => {
        const verdict = {
          closureDigests: [{
            name: "runtime-contract-proof",
            digest: sha256("runtime contract proof"),
          }],
        };
        Object.defineProperty(verdict, "disposition", {
          enumerable: true,
          get() {
            accessorCalls += 1;
            return "safe-to-release";
          },
        });
        return verdict;
      },
    }, async () => {
      throw new Error("synthetic runtime failure");
    }),
    (error) => {
      assert.equal(error?.code, "wakeflow-mutation-invalid-callback");
      return true;
    },
  );
  assert.equal(accessorCalls, 0);
});

test("the three maintenance schemas close the canonical flat owner artifacts", () => {
  const lockSchema = JSON.parse(readFileSync(schemaFiles.lock, "utf8"));
  const transactionSchema = JSON.parse(readFileSync(schemaFiles.transaction, "utf8"));
  const claimSchema = JSON.parse(readFileSync(schemaFiles.recoveryClaim, "utf8"));

  assert.equal(lockSchema.$id, "urn:wakeflow:internal:maintenance:workspace-mutation-lock:v1");
  assert.equal(transactionSchema.$id, "urn:wakeflow:internal:maintenance:transaction:v1");
  assert.equal(claimSchema.$id, "urn:wakeflow:internal:maintenance:recovery-claim:v1");
  for (const schema of [lockSchema, transactionSchema, claimSchema]) {
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
  }
  assert.equal(lockSchema.properties.recoveryGeneration.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(lockSchema.$defs.recoveryClaimRef.properties.generation.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(lockSchema.$defs.processIdentity.properties.pid.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(transactionSchema.properties.recoveryGeneration.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(transactionSchema.properties.checkpoint.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(
    transactionSchema.$defs.recoveryClaimRef.properties.generation.maximum,
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(transactionSchema.$defs.processIdentity.properties.pid.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(transactionSchema.$defs.stepBase.properties.ordinal.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(
    transactionSchema.$defs.terminalClosure.properties.closureDigests.maxItems,
    1_024,
  );
  assert.equal(claimSchema.properties.recoveryGeneration.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(
    claimSchema.$defs.previousOwner.properties.recoveryGeneration.maximum,
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(claimSchema.$defs.nextOwner.properties.recoveryGeneration.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(claimSchema.$defs.processIdentity.properties.pid.maximum, Number.MAX_SAFE_INTEGER);

  assert.equal(
    lockSchema.properties.artifactKind.const,
    "wakeflow-workspace-mutation-lock",
  );
  assert.equal(
    transactionSchema.properties.artifactKind.const,
    "wakeflow-maintenance-transaction",
  );
  assert.equal(
    claimSchema.properties.artifactKind.const,
    "wakeflow-workspace-recovery-claim",
  );
  for (const flatOwnerKey of [
    "operationId",
    "operationKind",
    "domainOwner",
    "ownerToken",
    "recoveryGeneration",
    "processIdentity",
    "ownerDisposition",
  ]) {
    assert.equal(transactionSchema.required.includes(flatOwnerKey), true);
  }
  assert.equal(Object.hasOwn(transactionSchema.properties, "operation"), false);
  assert.equal(Object.hasOwn(transactionSchema.properties, "status"), false);
  assert.deepEqual(transactionSchema.properties.phase.enum, ["incomplete", "terminal"]);
  assert.deepEqual(
    transactionSchema.properties.ownerDisposition.enum,
    ["active", "relinquished"],
  );

  const values = constValues(transactionSchema);
  for (const stepKind of ["create-or-update", "remove", "audit-publish", "owner-effect"]) {
    assert.equal(values.has(stepKind), true, `transaction schema must close ${stepKind}`);
  }
  assert.ok(transactionSchema.$defs.ownerEffectStep);
  assert.ok(transactionSchema.$defs.ownerEffectRecord);
  assert.deepEqual(
    claimSchema.required.filter((key) => key.startsWith("previous")),
    ["previousOwner", "previousJournal", "previousLock", "previousClaim"],
  );
  assert.deepEqual(
    claimSchema.$defs.previousOwner.properties.ownerDisposition.enum,
    ["active", "relinquished"],
  );
  assert.deepEqual(
    lockSchema.properties.mode.enum,
    ["runtime-mutation", "maintenance", "recovery-cleanup"],
  );

  const lockGenerationFence = lockSchema.allOf.find(
    (entry) => entry.if?.properties?.recoveryGeneration?.const === 0,
  );
  assert.deepEqual(
    lockGenerationFence.then.properties.mode.enum,
    ["runtime-mutation", "maintenance"],
  );
  assert.equal(lockGenerationFence.else.properties.mode.const, "recovery-cleanup");

  const maintenancePurposeFence = transactionSchema.allOf.find(
    (entry) => entry.if?.properties?.purpose?.const === "maintenance-apply",
  );
  const lockOnlyPurposeFence = transactionSchema.allOf.find(
    (entry) => entry.if?.properties?.purpose?.const === "lock-only-recovery",
  );
  assert.deepEqual(
    maintenancePurposeFence.then.properties.action.enum,
    ["fresh-initialize", "reconfigure", "reconcile", "explicit-migration"],
  );
  assert.deepEqual(
    lockOnlyPurposeFence.then.properties.action.enum,
    ["runtime-mutation-recovery", "explicit-migration"],
  );
  assert.equal(lockOnlyPurposeFence.then.properties.recoveryGeneration.minimum, 1);
  assert.deepEqual(transactionSchema.$defs.plan.properties.payload.required, ["steps"]);
  assert.equal(transactionSchema.$defs.plan.properties.payload.properties.steps.type, "array");
  assert.deepEqual(
    transactionSchema.$defs.targetPresentResource.oneOf.map((entry) => ({
      type: entry.properties.type.const,
      modes: entry.properties.mode.enum,
    })),
    [
      { type: "file", modes: ["0600", "0644"] },
      { type: "directory", modes: ["0700", "0755"] },
    ],
  );
  assert.deepEqual(
    transactionSchema.$defs.targetDirectoryResource.properties.mode.enum,
    ["0700", "0755"],
  );
  assert.equal(
    transactionSchema.$defs.createOrUpdateStep.allOf[2].oneOf[2].properties.final.$ref,
    "#/$defs/privateDirectoryResource",
  );
  assert.deepEqual(
    transactionSchema.$defs.legacyLocalDirectoryResource.properties.mode.enum,
    [
      "0701", "0704", "0705", "0710", "0711", "0714", "0715",
      "0740", "0741", "0744", "0745", "0750", "0751", "0754", "0755",
    ],
  );
  for (const stepDefinition of ["removeStep", "auditPublishStep"]) {
    assert.equal(
      transactionSchema.$defs[stepDefinition].allOf[1].properties.staging.$ref,
      "#/$defs/targetPresentResource",
    );
  }
});

test("Draft 2020-12 validation accepts real maintenance records and rejects closed invalid shapes", () => {
  const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
  const validateLock = ajv.compile(JSON.parse(readFileSync(schemaFiles.lock, "utf8")));
  const validateTransaction = ajv.compile(
    JSON.parse(readFileSync(schemaFiles.transaction, "utf8")),
  );
  const validateClaim = ajv.compile(
    JSON.parse(readFileSync(schemaFiles.recoveryClaim, "utf8")),
  );
  const id = operationId();
  const timestamp = "2026-08-08T00:00:00.000Z";
  const processIdentity = {
    platform: "linux",
    pid: 4242,
    startIdentity: sha256("schema-process-identity"),
  };
  const planDigest = sha256("schema-plan");
  const claimReference = {
    ref: `${transactionsRelative}/${id}.recovery-1.json`,
    generation: 1,
    digest: sha256("schema-claim"),
  };
  const previousLock = {
    type: "file",
    ref: lockRelative,
    mode: "0600",
    digest: sha256("schema-old-lock"),
    deviceId: "1",
    inodeId: "2",
    linkCount: 1,
  };
  const previousOwner = {
    mode: "maintenance",
    operationKind: "schema-maintenance",
    domainOwner: "schema-test",
    ownerTokenDigest: sha256("schema-old-owner"),
    recoveryGeneration: 0,
    processIdentity,
    ownerDisposition: "active",
  };
  const nextOwnerToken = ownerToken();
  const claim = {
    schemaVersion: 1,
    artifactKind: "wakeflow-workspace-recovery-claim",
    operationId: id,
    recoveryGeneration: 1,
    planDigest,
    previousOwner,
    nextOwner: {
      mode: "recovery-cleanup",
      operationKind: "schema-maintenance",
      domainOwner: "schema-test",
      ownerToken: nextOwnerToken,
      recoveryGeneration: 1,
      processIdentity,
      acquiredAt: timestamp,
    },
    previousJournal: {
      type: "absent",
      ref: `${transactionsRelative}/${id}.json`,
    },
    previousLock,
    previousClaim: {
      type: "absent",
      ref: `${transactionsRelative}/${id}.recovery-0.json`,
    },
    createdAt: timestamp,
  };
  const generationZeroLock = {
    schemaVersion: 1,
    artifactKind: "wakeflow-workspace-mutation-lock",
    operationId: id,
    mode: "maintenance",
    operationKind: "schema-maintenance",
    domainOwner: "schema-test",
    ownerToken: ownerToken(),
    recoveryGeneration: 0,
    processIdentity,
    recoveryClaim: null,
    acquiredAt: timestamp,
  };
  const recoveryLock = {
    ...generationZeroLock,
    mode: "recovery-cleanup",
    ownerToken: nextOwnerToken,
    recoveryGeneration: 1,
    recoveryClaim: claimReference,
  };
  const targetDigest = sha256("schema-target");
  const createStep = {
    stepId: "schema-create",
    ordinal: 0,
    stepKind: "create-or-update",
    source: { ref: ".wakeflow-local/schema-target.json", type: "absent" },
    staging: {
      ref: ".wakeflow-local/.schema-target.stage",
      type: "file",
      mode: "0600",
      digest: targetDigest,
    },
    final: {
      ref: ".wakeflow-local/schema-target.json",
      type: "file",
      mode: "0600",
      digest: targetDigest,
    },
  };
  const normalPlan = maintenancePlan([createStep]);
  const normalJournal = {
    schemaVersion: 1,
    artifactKind: "wakeflow-maintenance-transaction",
    operationId: id,
    purpose: "maintenance-apply",
    action: "reconcile",
    operationKind: "schema-maintenance",
    domainOwner: "schema-test",
    ownerToken: generationZeroLock.ownerToken,
    recoveryGeneration: 0,
    processIdentity,
    ownerDisposition: "active",
    recoveryClaim: null,
    phase: "incomplete",
    plan: normalPlan,
    planDigest: canonicalJsonDigest(normalPlan),
    checkpoint: 0,
    steps: [{ ...createStep, status: "planned" }],
    terminalClosure: null,
  };
  const terminalJournal = {
    ...normalJournal,
    phase: "terminal",
    checkpoint: 3,
    steps: [{ ...createStep, status: "committed" }],
    terminalClosure: {
      planDigest: canonicalJsonDigest(normalPlan),
      closureDigests: [{ name: "schema-domain", digest: sha256("schema-closure") }],
    },
  };
  const lockOnlyPlan = maintenancePlan();
  const lockOnlyJournal = {
    ...normalJournal,
    purpose: "lock-only-recovery",
    action: "runtime-mutation-recovery",
    ownerToken: nextOwnerToken,
    recoveryGeneration: 1,
    recoveryClaim: claimReference,
    plan: lockOnlyPlan,
    planDigest: canonicalJsonDigest(lockOnlyPlan),
    steps: [],
  };
  const localDigest = sha256("schema-local-directory");
  const modeRepairStep = {
    stepId: "schema-mode-repair",
    ordinal: 0,
    stepKind: "create-or-update",
    source: { ref: localRelative, type: "directory", mode: "0755", digest: localDigest },
    staging: null,
    final: { ref: localRelative, type: "directory", mode: "0700", digest: localDigest },
  };
  const modeRepairPlan = maintenancePlan([modeRepairStep]);
  const modeRepairJournal = {
    ...normalJournal,
    action: "explicit-migration",
    plan: modeRepairPlan,
    planDigest: canonicalJsonDigest(modeRepairPlan),
    steps: [{ ...modeRepairStep, status: "planned" }],
  };
  const effectStep = ownerEffectStep();
  const effectPlan = maintenancePlan([effectStep]);
  const effectCheckpoint = ownerEffectRecord(
    effectStep.checkpointSchemaId,
    { intentObserved: effectStep.intentDigest },
  );
  const effectResult = ownerEffectRecord(
    effectStep.resultSchemaId,
    { effect: "completed" },
  );
  const effectOutcome = ownerEffectRecord(
    effectStep.outcomeSchemaId,
    { admission: "accepted" },
  );
  const plannedEffectJournal = {
    ...normalJournal,
    action: "explicit-migration",
    plan: effectPlan,
    planDigest: canonicalJsonDigest(effectPlan),
    steps: [{
      ...effectStep,
      status: "planned",
      effectCheckpoint: null,
      effectResult: null,
      effectOutcome: null,
    }],
  };
  const startedEffectJournal = {
    ...plannedEffectJournal,
    checkpoint: 1,
    steps: [{
      ...effectStep,
      status: "effect-started",
      effectCheckpoint,
      effectResult: null,
      effectOutcome: null,
    }],
  };
  const completedEffectJournal = {
    ...startedEffectJournal,
    checkpoint: 2,
    steps: [{
      ...effectStep,
      status: "effect-completed",
      effectCheckpoint,
      effectResult,
      effectOutcome: null,
    }],
  };
  const committedEffectJournal = {
    ...completedEffectJournal,
    checkpoint: 3,
    steps: [{
      ...effectStep,
      status: "committed",
      effectCheckpoint,
      effectResult,
      effectOutcome,
    }],
  };
  const secondCreateStep = {
    ...createStep,
    stepId: "schema-create-second",
    ordinal: 1,
    source: { ...createStep.source, ref: ".wakeflow-local/schema-target-second.json" },
    staging: { ...createStep.staging, ref: ".wakeflow-local/.schema-target-second.stage" },
    final: { ...createStep.final, ref: ".wakeflow-local/schema-target-second.json" },
  };
  const twoStepPlan = maintenancePlan([createStep, secondCreateStep]);

  function assertValid(validate, value, label) {
    assert.equal(validate(value), true, `${label}: ${JSON.stringify(validate.errors)}`);
  }
  function assertInvalid(validate, value, label) {
    assert.equal(validate(value), false, `${label} unexpectedly passed schema validation`);
  }

  for (const [label, value] of [
    ["generation-zero lock", generationZeroLock],
    ["recovery lock", recoveryLock],
  ]) assertValid(validateLock, value, label);
  assertValid(validateClaim, claim, "generation-one claim");
  for (const [label, value] of [
    ["normal journal", normalJournal],
    ["terminal journal", terminalJournal],
    ["lock-only journal", lockOnlyJournal],
    ["mode-repair journal", modeRepairJournal],
    ["planned owner-effect journal", plannedEffectJournal],
    ["started owner-effect journal", startedEffectJournal],
    ["completed owner-effect journal", completedEffectJournal],
    ["committed owner-effect journal", committedEffectJournal],
    ["legacy lock-only journal", { ...lockOnlyJournal, action: "explicit-migration" }],
  ]) assertValid(validateTransaction, value, label);

  assertInvalid(validateLock, { ...generationZeroLock, mode: "recovery-cleanup" }, "g0 cleanup lock");
  assertInvalid(validateLock, { ...recoveryLock, mode: "maintenance" }, "g1 maintenance lock");
  assertInvalid(
    validateLock,
    {
      ...generationZeroLock,
      processIdentity: { ...processIdentity, pid: Number.MAX_SAFE_INTEGER + 1 },
    },
    "unsafe-integer process PID",
  );
  assertInvalid(
    validateTransaction,
    { ...normalJournal, action: "runtime-mutation-recovery" },
    "maintenance/runtime-recovery action pair",
  );
  assertInvalid(
    validateTransaction,
    { ...lockOnlyJournal, action: "reconcile" },
    "lock-only/reconcile action pair",
  );
  assertInvalid(
    validateTransaction,
    { ...lockOnlyJournal, recoveryGeneration: 0, recoveryClaim: null },
    "generation-zero lock-only journal",
  );
  assertInvalid(
    validateTransaction,
    { ...normalJournal, plan: { schemaId: normalPlan.schemaId, payload: {} } },
    "plan without steps",
  );
  assertInvalid(
    validateTransaction,
    {
      ...normalJournal,
      steps: [{
        ...normalJournal.steps[0],
        staging: { ...normalJournal.steps[0].staging, mode: "0700" },
      }],
    },
    "file target with directory mode",
  );
  assertInvalid(
    validateTransaction,
    { ...normalJournal, checkpoint: Number.MAX_SAFE_INTEGER + 1 },
    "unsafe-integer checkpoint",
  );
  assertInvalid(
    validateTransaction,
    {
      ...normalJournal,
      plan: twoStepPlan,
      planDigest: canonicalJsonDigest(twoStepPlan),
      checkpoint: 2,
      steps: [
        { ...createStep, status: "prepared" },
        { ...secondCreateStep, status: "prepared" },
      ],
    },
    "multiple prepared steps",
  );
  assertInvalid(
    validateTransaction,
    {
      ...modeRepairJournal,
      action: "reconcile",
    },
    "local-root mode repair outside explicit migration",
  );
  assertInvalid(
    validateTransaction,
    { ...plannedEffectJournal, action: "reconcile" },
    "owner effect outside explicit migration",
  );
  assertInvalid(
    validateTransaction,
    {
      ...startedEffectJournal,
      steps: [{ ...startedEffectJournal.steps[0], effectCheckpoint: null }],
    },
    "effect-started without durable checkpoint",
  );
  assertInvalid(
    validateTransaction,
    {
      ...completedEffectJournal,
      steps: [{ ...completedEffectJournal.steps[0], effectOutcome }],
    },
    "effect-completed with premature outcome",
  );
  assertInvalid(
    validateTransaction,
    {
      ...committedEffectJournal,
      steps: [{
        ...committedEffectJournal.steps[0],
        effectOutcome: { ...effectOutcome, extra: true },
      }],
    },
    "owner effect record with an extension field",
  );
  assertInvalid(
    validateClaim,
    { ...claim, previousOwner: { ...previousOwner, mode: "recovery-cleanup" } },
    "generation-zero cleanup predecessor",
  );
  assertInvalid(
    validateClaim,
    {
      ...claim,
      previousOwner: {
        ...previousOwner,
        recoveryGeneration: 1,
        mode: "maintenance",
      },
    },
    "generation-one maintenance predecessor",
  );
  assertInvalid(
    validateClaim,
    {
      ...claim,
      previousOwner: { ...previousOwner, ownerDisposition: "relinquished" },
    },
    "file-lock predecessor marked relinquished",
  );
  assertValid(
    validateClaim,
    {
      ...claim,
      previousOwner: { ...previousOwner, ownerDisposition: "relinquished" },
      previousJournal: {
        ...previousLock,
        ref: `${transactionsRelative}/${id}.json`,
        digest: sha256("schema-old-journal"),
      },
      previousLock: { type: "absent", ref: lockRelative },
    },
    "lock-absent relinquished predecessor",
  );
  assertInvalid(
    validateClaim,
    {
      ...claim,
      previousLock: { type: "absent", ref: lockRelative },
    },
    "claim without predecessor journal or lock",
  );
});

test("transaction schema admits only the two closed null-staging directory variants", () => {
  const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
  const validateTransaction = ajv.compile(
    JSON.parse(readFileSync(schemaFiles.transaction, "utf8")),
  );
  const id = operationId();
  const directoryDigest = sha256("schema static directory node contract");
  const staticRef = `${runtimeRelative}/shared`;

  function journalFor(step, action) {
    const plan = maintenancePlan([step]);
    return {
      schemaVersion: 1,
      artifactKind: "wakeflow-maintenance-transaction",
      operationId: id,
      purpose: "maintenance-apply",
      action,
      operationKind: "static-layout-reconcile",
      domainOwner: "test-layout-manager",
      ownerToken: ownerToken(),
      recoveryGeneration: 0,
      processIdentity: {
        platform: "linux",
        pid: 4242,
        startIdentity: sha256("schema static directory owner"),
      },
      ownerDisposition: "active",
      recoveryClaim: null,
      phase: "incomplete",
      plan,
      planDigest: canonicalJsonDigest(plan),
      checkpoint: 0,
      steps: [{ ...step, status: "planned" }],
      terminalClosure: null,
    };
  }

  const atomicCreate = {
    stepId: "schema-atomic-directory-create",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(staticRef, { type: "absent" }),
    staging: null,
    final: fileContract(staticRef, {
      type: "directory",
      mode: "0700",
      digest: directoryDigest,
    }),
  };
  const safeModeRepair = {
    stepId: "schema-safe-directory-mode-repair",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(staticRef, {
      type: "directory",
      mode: "0755",
      digest: directoryDigest,
    }),
    staging: null,
    final: fileContract(staticRef, {
      type: "directory",
      mode: "0700",
      digest: directoryDigest,
    }),
  };

  for (const [label, journal] of [
    ["fresh atomic directory create", journalFor(atomicCreate, "fresh-initialize")],
    ["reconcile safe directory mode repair", journalFor(safeModeRepair, "reconcile")],
  ]) {
    assert.equal(
      validateTransaction(journal),
      true,
      `${label}: ${JSON.stringify(validateTransaction.errors)}`,
    );
  }

  const unsafeModeRepair = {
    ...safeModeRepair,
    source: { ...safeModeRepair.source, mode: "0775" },
  };
  const nullStagingFileCreate = {
    ...atomicCreate,
    stepId: "schema-null-staging-file-create",
    final: fileContract(staticRef, {
      type: "file",
      mode: "0600",
      digest: directoryDigest,
    }),
  };
  for (const [label, journal] of [
    ["group-writable source mode", journalFor(unsafeModeRepair, "reconcile")],
    ["null-staging file publication", journalFor(nullStagingFileCreate, "fresh-initialize")],
    ["safe mode repair during fresh initialization", journalFor(safeModeRepair, "fresh-initialize")],
    ["non-local mode repair during explicit migration", journalFor(safeModeRepair, "explicit-migration")],
  ]) {
    assert.equal(
      validateTransaction(journal),
      false,
      `${label} unexpectedly passed schema validation`,
    );
  }
});

test("the workspace mutation manager exposes only its six gate-private service APIs", async () => {
  const manager = await mutationManager();
  assert.deepEqual(
    Object.keys(manager).sort(),
    [
      "assertWakeflowMutationContext",
      "inspectWakeflowMaintenancePersistenceBudget",
      "inspectWakeflowWorkspaceMutation",
      "recoverWakeflowWorkspaceMutation",
      "runWakeflowMaintenanceMutation",
      "withWakeflowRuntimeMutation",
    ],
  );
});

test("an explicit-migration owner effect durably checkpoints intent, result, and outcome before admission", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-owner-effect-");
  bootstrapProtocol(workspaceRoot);
  const step = ownerEffectStep();
  const plan = maintenancePlan([step]);
  const checkpoint = ownerEffectRecord(step.checkpointSchemaId, {
    subjectId: "legacy-window-fixture",
    preflight: "exact",
  });
  const result = ownerEffectRecord(step.resultSchemaId, {
    subjectId: "legacy-window-fixture",
    effect: "completed",
  });
  const outcome = ownerEffectRecord(step.outcomeSchemaId, {
    subjectId: "legacy-window-fixture",
    postProbe: "absent",
  });
  const seenStatuses = [];
  let performCalls = 0;
  let recoveryCalls = 0;
  let assertionCalls = 0;

  await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "explicit-migration",
    operationKind: "explicit-migration",
    domainOwner: "migration-apply",
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    validatePlan: validateTestPlan,
    deriveCurrentPlan: async () => plan,
    deriveTerminalClosure: async ({ planDigest, effectRecords }) => {
      assert.deepEqual(effectRecords, [{
        stepId: step.stepId,
        ordinal: step.ordinal,
        effectKind: step.effectKind,
        intentDigest: step.intentDigest,
        checkpoint,
        result,
        outcome,
      }]);
      return {
        planDigest,
        closureDigests: [{
          name: "migration-effect-closure",
          digest: canonicalJsonDigest(effectRecords),
        }],
      };
    },
    stepHandlers: {
      [step.stepId]: {
        prepareEffect: async () => {
          const journal = JSON.parse(readFileSync(singleJournalFile(workspaceRoot), "utf8"));
          seenStatuses.push(journal.steps[0].status);
          assert.equal(journal.steps[0].effectCheckpoint, null);
          assert.equal(journal.steps[0].effectResult, null);
          assert.equal(journal.steps[0].effectOutcome, null);
          return checkpoint;
        },
        performEffect: async ({ checkpoint: durableCheckpoint }) => {
          performCalls += 1;
          assert.deepEqual(durableCheckpoint, checkpoint);
          const journal = JSON.parse(readFileSync(singleJournalFile(workspaceRoot), "utf8"));
          seenStatuses.push(journal.steps[0].status);
          assert.deepEqual(journal.steps[0].effectCheckpoint, checkpoint);
          assert.equal(journal.steps[0].effectResult, null);
          return result;
        },
        recoverEffect: async () => {
          recoveryCalls += 1;
          assert.fail("normal apply must not invoke the recovery-only effect probe");
        },
        observeEffect: async ({ checkpoint: durableCheckpoint, result: durableResult }) => {
          assert.deepEqual(durableCheckpoint, checkpoint);
          assert.deepEqual(durableResult, result);
          const journal = JSON.parse(readFileSync(singleJournalFile(workspaceRoot), "utf8"));
          seenStatuses.push(journal.steps[0].status);
          assert.deepEqual(journal.steps[0].effectResult, result);
          assert.equal(journal.steps[0].effectOutcome, null);
          return outcome;
        },
        validateEffectCheckpoint: async ({ record }) => {
          assert.deepEqual(record, checkpoint);
          return { valid: true };
        },
        validateEffectResult: async ({ record }) => {
          assert.deepEqual(record, result);
          return { valid: true };
        },
        validateEffectOutcome: async ({ record }) => {
          assert.deepEqual(record, outcome);
          return { valid: true };
        },
        assertEffectOutcome: async ({ checkpoint: durableCheckpoint, result: durableResult, outcome: durableOutcome }) => {
          assertionCalls += 1;
          assert.deepEqual(durableCheckpoint, checkpoint);
          assert.deepEqual(durableResult, result);
          assert.deepEqual(durableOutcome, outcome);
          const journal = JSON.parse(readFileSync(singleJournalFile(workspaceRoot), "utf8"));
          assert.equal(journal.steps[0].status, "committed");
          return { admitted: true };
        },
      },
    },
  });

  assert.deepEqual(seenStatuses, ["planned", "effect-started", "effect-completed"]);
  assert.equal(performCalls, 1);
  assert.equal(recoveryCalls, 0);
  assert.ok(assertionCalls >= 1);
  assertNoMaintenanceResidue(workspaceRoot);
});

test("owner-effect recovery never resends a possibly started effect and resumes only from durable records", async (t) => {
  const {
    recoverWakeflowWorkspaceMutation,
    runWakeflowMaintenanceMutation,
  } = await mutationManager();

  for (const crashBoundary of ["effect-started", "effect-completed"]) {
    await t.test(crashBoundary, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-owner-effect-${crashBoundary}-`);
      bootstrapProtocol(workspaceRoot);
      const step = ownerEffectStep();
      const plan = maintenancePlan([step]);
      const checkpoint = ownerEffectRecord(step.checkpointSchemaId, {
        subjectId: "legacy-window-recovery",
        preflight: "exact",
      });
      const result = ownerEffectRecord(step.resultSchemaId, {
        subjectId: "legacy-window-recovery",
        effect: crashBoundary === "effect-started" ? "unconfirmed-after-crash" : "completed",
      });
      const outcome = ownerEffectRecord(step.outcomeSchemaId, {
        subjectId: "legacy-window-recovery",
        postProbe: crashBoundary === "effect-started" ? "manual-host-gate" : "absent",
      });
      let initialPerformCalls = 0;
      let recoveryPerformCalls = 0;
      let recoveryProbeCalls = 0;
      let recoveryObserveCalls = 0;

      const validators = {
        validateEffectCheckpoint: async ({ record }) => {
          assert.deepEqual(record, checkpoint);
          return { valid: true };
        },
        validateEffectResult: async ({ record }) => {
          assert.deepEqual(record, result);
          return { valid: true };
        },
        validateEffectOutcome: async ({ record }) => {
          assert.deepEqual(record, outcome);
          return { valid: true };
        },
      };
      const terminalClosure = async ({ planDigest, effectRecords }) => ({
        planDigest,
        closureDigests: [{
          name: "migration-effect-recovery",
          digest: canonicalJsonDigest(effectRecords),
        }],
      });

      await assert.rejects(
        () => runWakeflowMaintenanceMutation({
          workspaceRoot,
          action: "explicit-migration",
          operationKind: "explicit-migration",
          domainOwner: "migration-apply",
          confirmedPlan: plan,
          planDigest: canonicalJsonDigest(plan),
          validatePlan: validateTestPlan,
          deriveCurrentPlan: async () => plan,
          deriveTerminalClosure: terminalClosure,
          stepHandlers: {
            [step.stepId]: {
              prepareEffect: async () => checkpoint,
              performEffect: async () => {
                initialPerformCalls += 1;
                if (crashBoundary === "effect-started") {
                  throw new Error("simulated lost callback result after effect start");
                }
                return result;
              },
              recoverEffect: async () => assert.fail("normal apply cannot use recovery probe"),
              observeEffect: async () => {
                throw new Error("simulated post-effect observation crash");
              },
              ...validators,
              assertEffectOutcome: async () => assert.fail("failed apply cannot reach admission"),
            },
          },
        }),
        (error) => error?.code === "wakeflow-mutation-recovery-required",
      );

      const journal = JSON.parse(readFileSync(singleJournalFile(workspaceRoot), "utf8"));
      assert.equal(journal.steps[0].status, crashBoundary);
      assert.equal(journal.ownerDisposition, "relinquished");
      assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);

      await recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId: journal.operationId,
        confirmedPlan: plan,
        planDigest: canonicalJsonDigest(plan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => plan,
        deriveTerminalClosure: terminalClosure,
        stepHandlers: {
          [step.stepId]: {
            prepareEffect: async () => assert.fail("durable effect checkpoint must not repeat preflight"),
            performEffect: async () => {
              recoveryPerformCalls += 1;
              assert.fail("recovery must never resend an already-started physical effect");
            },
            recoverEffect: async ({ checkpoint: durableCheckpoint }) => {
              recoveryProbeCalls += 1;
              assert.equal(crashBoundary, "effect-started");
              assert.deepEqual(durableCheckpoint, checkpoint);
              return result;
            },
            observeEffect: async ({ result: durableResult }) => {
              recoveryObserveCalls += 1;
              assert.deepEqual(durableResult, result);
              return outcome;
            },
            ...validators,
            assertEffectOutcome: async ({ outcome: durableOutcome }) => {
              assert.deepEqual(durableOutcome, outcome);
              return { admitted: true };
            },
          },
        },
      });

      assert.equal(initialPerformCalls, 1);
      assert.equal(recoveryPerformCalls, 0);
      assert.equal(recoveryProbeCalls, crashBoundary === "effect-started" ? 1 : 0);
      assert.equal(recoveryObserveCalls, 1);
      assertNoMaintenanceResidue(workspaceRoot);
    });
  }
});

test("a non-admitted owner outcome blocks every later filesystem boundary with its journal retained", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-owner-effect-blocked-");
  bootstrapProtocol(workspaceRoot);
  const effect = ownerEffectStep();
  const payload = Buffer.from("must never be published after a blocked host outcome\n");
  const targetRef = ".wakeflow-local/blocked-after-effect.txt";
  const stageRef = ".wakeflow-local/.blocked-after-effect.stage";
  const filesystem = {
    stepId: "blocked-filesystem-step",
    ordinal: 1,
    stepKind: "create-or-update",
    source: fileContract(targetRef, { type: "absent" }),
    staging: fileContract(stageRef, {
      type: "file",
      mode: "0600",
      digest: sha256(payload),
    }),
    final: fileContract(targetRef, {
      type: "file",
      mode: "0600",
      digest: sha256(payload),
    }),
  };
  const plan = maintenancePlan([effect, filesystem]);
  const checkpoint = ownerEffectRecord(effect.checkpointSchemaId, { preflight: "exact" });
  const result = ownerEffectRecord(effect.resultSchemaId, { effect: "unconfirmed" });
  const outcome = ownerEffectRecord(effect.outcomeSchemaId, { disposition: "manual-host-gate" });
  let filesystemCallbacks = 0;

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "explicit-migration",
      operationKind: "explicit-migration",
      domainOwner: "migration-apply",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => plan,
      deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
      stepHandlers: {
        [effect.stepId]: {
          prepareEffect: async () => checkpoint,
          performEffect: async () => result,
          recoverEffect: async () => assert.fail("normal apply cannot recover"),
          observeEffect: async () => outcome,
          validateEffectCheckpoint: async () => ({ valid: true }),
          validateEffectResult: async () => ({ valid: true }),
          validateEffectOutcome: async () => ({ valid: true }),
          assertEffectOutcome: async () => ({ admitted: false }),
        },
        [filesystem.stepId]: {
          prepare: async () => { filesystemCallbacks += 1; },
          observe: async () => {
            filesystemCallbacks += 1;
            return stepObservation(workspaceRoot, filesystem);
          },
          commit: async () => { filesystemCallbacks += 1; },
        },
      },
    }),
    (error) => error?.code === "wakeflow-mutation-recovery-required",
  );

  assert.equal(filesystemCallbacks, 0);
  assert.equal(existsSync(portablePath(workspaceRoot, targetRef)), false);
  assert.equal(existsSync(portablePath(workspaceRoot, stageRef)), false);
  const journal = JSON.parse(readFileSync(singleJournalFile(workspaceRoot), "utf8"));
  assert.deepEqual(journal.steps.map((step) => step.status), ["committed", "planned"]);
  assert.deepEqual(journal.steps[0].effectOutcome, outcome);
  assert.equal(journal.ownerDisposition, "relinquished");
  assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
});

test("inspection rejects an unknown maintenance sibling without changing it", async (t) => {
  const { inspectWakeflowWorkspaceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-inspect-maintenance-sibling-");
  bootstrapProtocol(workspaceRoot);
  const unknown = protocolPath(workspaceRoot, `${maintenanceRelative}/unknown-owner-file`);
  writeFileSync(unknown, "unknown maintenance sibling stays exact\n", { mode: 0o600 });
  chmodSync(unknown, 0o600);
  const before = captureExactFixtureFile(unknown);

  assert.throws(
    () => inspectWakeflowWorkspaceMutation({ workspaceRoot }),
    /(?:maintenance|manual|unknown|protocol)/iu,
  );

  assertExactFixtureFileUnchanged(before);
  assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
  assert.deepEqual(
    readdirSync(protocolPath(workspaceRoot, maintenanceRelative)).sort(),
    ["transactions", "unknown-owner-file"],
  );
});

test("an oversized confirmed plan is rejected before owner codec, gate, or journal creation", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-oversized-plan-");
  bootstrapProtocol(workspaceRoot);
  const plan = maintenancePlan();
  plan.payload.padding = "x".repeat((8 * 1024 * 1024) + 1);
  let codecCalls = 0;
  let deriveCalls = 0;

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "oversized-plan-fixture",
      domainOwner: "maintenance-red-test",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: async () => {
        codecCalls += 1;
        return { valid: true };
      },
      deriveCurrentPlan: async () => {
        deriveCalls += 1;
        return plan;
      },
      stepHandlers: {},
    }),
    /(?:bounded|size|plan)/iu,
  );

  assert.equal(codecCalls, 0, "size admission precedes the owner codec");
  assert.equal(deriveCalls, 0);
  assertNoMaintenanceResidue(workspaceRoot);
});

test("a near-limit plan that cannot fit every durable journal state is rejected before the gate", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-transaction-budget-");
  bootstrapProtocol(workspaceRoot);
  const targetBytes = Buffer.from("transaction budget target\n");
  const step = {
    stepId: "transaction-budget-step",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(".wakeflow-local/transaction-budget.txt", { type: "absent" }),
    staging: fileContract(".wakeflow-local/.transaction-budget.stage", {
      type: "file",
      mode: "0600",
      digest: sha256(targetBytes),
    }),
    final: fileContract(".wakeflow-local/transaction-budget.txt", {
      type: "file",
      mode: "0600",
      digest: sha256(targetBytes),
    }),
  };
  const plan = maintenancePlan([step]);
  plan.payload.padding = "";
  const baseSize = Buffer.byteLength(`${canonicalJson(plan)}\n`, "utf8");
  plan.payload.padding = "x".repeat((8 * 1024 * 1024) - baseSize - 64);
  assert.ok(Buffer.byteLength(`${canonicalJson(plan)}\n`, "utf8") <= 8 * 1024 * 1024);
  let codecCalls = 0;
  let deriveCalls = 0;
  let physicalCalls = 0;

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "transaction-budget-fixture",
      domainOwner: "maintenance-red-test",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: async ({ plan: candidate }) => {
        codecCalls += 1;
        assertTestPlan(candidate);
        return { valid: true };
      },
      deriveCurrentPlan: async () => {
        deriveCalls += 1;
        return plan;
      },
      deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
      stepHandlers: {
        [step.stepId]: {
          prepare: async () => { physicalCalls += 1; },
          observe: async () => stepObservation(workspaceRoot, step),
          commit: async () => { physicalCalls += 1; },
        },
      },
    }),
    /(?:budget|durable|plan|size)/iu,
  );

  assert.equal(codecCalls, 1);
  assert.equal(deriveCalls, 0);
  assert.equal(physicalCalls, 0);
  assertNoMaintenanceResidue(workspaceRoot);
});

test("a lock-only journal cannot exist without a recovery generation claim", async (t) => {
  const { inspectWakeflowWorkspaceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-lock-only-generation-");
  bootstrapProtocol(workspaceRoot);
  const id = operationId();
  const plan = maintenancePlan();
  writeCanonicalPrivateFile(
    workspaceRoot,
    `${transactionsRelative}/${id}.json`,
    {
      schemaVersion: 1,
      artifactKind: "wakeflow-maintenance-transaction",
      operationId: id,
      purpose: "lock-only-recovery",
      action: "runtime-mutation-recovery",
      operationKind: "lock-only-generation-fixture",
      domainOwner: "maintenance-red-test",
      ownerToken: ownerToken(),
      recoveryGeneration: 0,
      processIdentity: {
        platform: process.platform,
        pid: process.pid,
        startIdentity: sha256("generation-zero-lock-only-fixture"),
      },
      ownerDisposition: "relinquished",
      recoveryClaim: null,
      phase: "incomplete",
      plan,
      planDigest: canonicalJsonDigest(plan),
      checkpoint: 0,
      steps: [],
      terminalClosure: null,
    },
  );

  assert.throws(
    () => inspectWakeflowWorkspaceMutation({ workspaceRoot }),
    /(?:lock-only|generation|invalid-artifact|transaction)/iu,
  );
});

test("all maintenance actions bootstrap only the fixed private protocol roots without unsafe repair", async (t) => {
  const {
    inspectWakeflowWorkspaceMutation,
    runWakeflowMaintenanceMutation,
  } = await mutationManager();

  await t.test("fresh bootstrap creates the fixed roots and holds a private lock inside the fence", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-fresh-");
    const localRoot = protocolPath(workspaceRoot, localRelative);
    const lockFile = protocolPath(workspaceRoot, lockRelative);
    const plan = maintenancePlan();

    await inspectWakeflowWorkspaceMutation({ workspaceRoot });
    assert.equal(existsSync(localRoot), false, "inspection is read-only");

    let derivedInsideFence = false;
    await runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "fresh-initialize",
      operationKind: "fresh-initialize",
      domainOwner: "test-layout-manager",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => {
        derivedInsideFence = true;
        assertPrivateRegularFile(lockFile);
        assertPrivateDirectory(protocolPath(workspaceRoot, transactionsRelative));
        return plan;
      },
      stepHandlers: {},
    });

    assert.equal(derivedInsideFence, true);
    assertPrivateDirectory(localRoot);
    assertPrivateDirectory(protocolPath(workspaceRoot, runtimeRelative));
    assertPrivateDirectory(protocolPath(workspaceRoot, maintenanceRelative));
    assertPrivateDirectory(protocolPath(workspaceRoot, transactionsRelative));
    assert.equal(existsSync(lockFile), false, "healthy completion leaves no success lock");
    assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
  });

  await t.test("fresh bootstrap resumes an exact empty prefix left before lock acquisition", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-prefix-resume-");
    const localRoot = protocolPath(workspaceRoot, localRelative);
    mkdirSync(localRoot, { mode: 0o700 });
    chmodSync(localRoot, 0o700);
    const plan = maintenancePlan();

    await runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "fresh-initialize",
      operationKind: "fresh-initialize",
      domainOwner: "test-layout-manager",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => plan,
      stepHandlers: {},
    });

    assertPrivateDirectory(localRoot);
    assertPrivateDirectory(protocolPath(workspaceRoot, runtimeRelative));
    assertPrivateDirectory(protocolPath(workspaceRoot, maintenanceRelative));
    assertPrivateDirectory(protocolPath(workspaceRoot, transactionsRelative));
  });

  await t.test("a stale fresh plan removes only the exact prefix created by that admission", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-stale-bootstrap-");
    const confirmedPlan = maintenancePlan();
    const currentPlan = {
      ...confirmedPlan,
      payload: { steps: [], changedAfterConfirmation: true },
    };

    await assert.rejects(
      () => runWakeflowMaintenanceMutation({
        workspaceRoot,
        action: "fresh-initialize",
        operationKind: "fresh-initialize",
        domainOwner: "test-layout-manager",
        confirmedPlan,
        planDigest: canonicalJsonDigest(confirmedPlan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => currentPlan,
        stepHandlers: {},
      }),
      /plan[-_ ]?stale/iu,
    );

    assert.equal(
      existsSync(protocolPath(workspaceRoot, localRelative)),
      false,
      "clean stale admission leaves no initialized-looking prefix",
    );
  });

  await t.test("a symlinked local root is rejected without touching its target", {
    skip: process.platform === "win32" ? "directory symlink behavior differs on Windows" : false,
  }, async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-symlink-");
    const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-maintenance-outside-"));
    t.after(() => rmSync(outside, { force: true, recursive: true }));
    const sentinel = path.join(outside, "sentinel.txt");
    writeFileSync(sentinel, "outside\n");
    symlinkSync(outside, protocolPath(workspaceRoot, localRelative));
    const plan = maintenancePlan();

    await assert.rejects(() => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "fresh-initialize",
      operationKind: "fresh-initialize",
      domainOwner: "test-layout-manager",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => assert.fail("unsafe bootstrap must not derive a plan"),
      stepHandlers: {},
    }));

    assert.equal(readFileSync(sentinel, "utf8"), "outside\n");
    assert.equal(existsSync(path.join(outside, "runtime")), false);
  });

  await t.test("an existing wrong-mode local root is rejected, not chmod-repaired", {
    skip: process.platform === "win32" ? "POSIX modes are required by this contract" : false,
  }, async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-mode-");
    const localRoot = protocolPath(workspaceRoot, localRelative);
    mkdirSync(localRoot, { mode: 0o755 });
    chmodSync(localRoot, 0o755);
    const plan = maintenancePlan();

    await assert.rejects(() => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "fresh-initialize",
      operationKind: "fresh-initialize",
      domainOwner: "test-layout-manager",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => assert.fail("wrong-mode bootstrap must not derive a plan"),
      stepHandlers: {},
    }));

    assert.equal(lstatSync(localRoot).mode & 0o777, 0o755);
    assert.equal(existsSync(protocolPath(workspaceRoot, runtimeRelative)), false);
  });

  await t.test("explicit-migration may bootstrap the same fixed roots", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-migration-");
    const localRoot = protocolPath(workspaceRoot, localRelative);
    mkdirSync(localRoot, { mode: 0o755 });
    chmodSync(localRoot, 0o755);
    const plan = maintenancePlan();

    await runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "explicit-migration",
      operationKind: "explicit-migration",
      domainOwner: "test-migration-manager",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => plan,
      stepHandlers: {},
    });

    assert.equal(
      lstatSync(localRoot).mode & 0o777,
      0o755,
      "legacy local mode repair is a later journaled domain step, not bootstrap work",
    );
    assertPrivateDirectory(protocolPath(workspaceRoot, runtimeRelative));
    assertPrivateDirectory(protocolPath(workspaceRoot, maintenanceRelative));
    assertPrivateDirectory(protocolPath(workspaceRoot, transactionsRelative));
  });

  await t.test("stale explicit migration cleans its exact bootstrap below a safe legacy root", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-migration-stale-");
    const localRoot = protocolPath(workspaceRoot, localRelative);
    mkdirSync(localRoot, { mode: 0o755 });
    chmodSync(localRoot, 0o755);
    const plan = maintenancePlan();
    const stale = {
      schemaId: plan.schemaId,
      payload: { steps: [], changed: true },
    };

    await assert.rejects(
      () => runWakeflowMaintenanceMutation({
        workspaceRoot,
        action: "explicit-migration",
        operationKind: "explicit-migration",
        domainOwner: "test-migration-manager",
        confirmedPlan: plan,
        planDigest: canonicalJsonDigest(plan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => stale,
        stepHandlers: {},
      }),
      /(?:plan|stale)/iu,
    );

    assert.equal(lstatSync(localRoot).mode & 0o777, 0o755);
    assert.equal(existsSync(protocolPath(workspaceRoot, runtimeRelative)), false);
    assert.deepEqual(readdirSync(localRoot), []);
  });

  await t.test("reconfigure and reconcile bootstrap only the fixed protocol prefix", async (t) => {
    for (const action of ["reconfigure", "reconcile"]) {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-maintenance-${action}-`);
      const plan = maintenancePlan();

      const result = await runWakeflowMaintenanceMutation({
        workspaceRoot,
        action,
        operationKind: action,
        domainOwner: "maintenance-red-test",
        confirmedPlan: plan,
        planDigest: canonicalJsonDigest(plan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => plan,
        stepHandlers: {},
      });

      assert.equal(result.status, "no-op");
      for (const ref of [
        localRelative,
        runtimeRelative,
        maintenanceRelative,
        transactionsRelative,
      ]) assertPrivateDirectory(protocolPath(workspaceRoot, ref));
      assertNoMaintenanceResidue(workspaceRoot);
    }
  });

  await t.test("maintenance apply rejects actions outside the four-action input enum", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-invalid-action-");
    bootstrapProtocol(workspaceRoot);
    const plan = maintenancePlan();

    await assert.rejects(() => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "runtime-mutation-recovery",
      operationKind: "reconcile",
      domainOwner: "maintenance-red-test",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => assert.fail("invalid action fails before planning"),
      stepHandlers: {},
    }), /(?:action|enum|invalid)/iu);
  });
});

test("terminal journal removal never tears down bootstrap roots when final gate release is unresolved", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();

  for (const action of ["fresh-initialize", "explicit-migration"]) {
    await t.test(`${action} retains every protocol root and the replacement gate`, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-terminal-bootstrap-${action}-`);
      if (action === "explicit-migration") {
        mkdirSync(protocolPath(workspaceRoot, localRelative), { mode: 0o750 });
        chmodSync(protocolPath(workspaceRoot, localRelative), 0o750);
      }
      const payload = Buffer.from(`terminal bootstrap ${action}\n`);
      const finalRef = `.wakeflow-fixture/terminal-bootstrap-${action}/target.txt`;
      const stageRef = `${finalRef}.stage`;
      const step = {
        stepId: `terminal-bootstrap-${action}`,
        ordinal: 0,
        stepKind: "create-or-update",
        source: fileContract(finalRef, { type: "absent" }),
        staging: fileContract(stageRef, {
          type: "file",
          mode: "0600",
          digest: sha256(payload),
        }),
        final: fileContract(finalRef, {
          type: "file",
          mode: "0600",
          digest: sha256(payload),
        }),
      };
      const plan = maintenancePlan([step]);
      const rootSnapshots = [];
      let deriveCalls = 0;
      let closureCalls = 0;
      let prepareCalls = 0;
      let commitCalls = 0;
      let replacementGateSnapshot = null;
      const deriveTerminalClosure = ({ planDigest }) => {
        closureCalls += 1;
        if (closureCalls === 2) {
          const lockFile = protocolPath(workspaceRoot, lockRelative);
          replacePrivateJsonFixture(lockFile, JSON.parse(readFileSync(lockFile, "utf8")));
          replacementGateSnapshot = captureExactFixtureFile(lockFile);
        }
        return {
          planDigest,
          closureDigests: [{
            name: "terminal-bootstrap-target",
            digest: canonicalJsonDigest({
              planDigest,
              final: observeRef(workspaceRoot, step.final),
            }),
          }],
        };
      };

      await assert.rejects(
        () => runWakeflowMaintenanceMutation({
          workspaceRoot,
          action,
          operationKind: `terminal-bootstrap-${action}`,
          domainOwner: action === "explicit-migration"
            ? "test-migration-manager"
            : "test-layout-manager",
          confirmedPlan: plan,
          planDigest: canonicalJsonDigest(plan),
          validatePlan: validateTestPlan,
          deriveCurrentPlan: async () => {
            deriveCalls += 1;
            for (const relative of [localRelative, runtimeRelative, maintenanceRelative, transactionsRelative]) {
              rootSnapshots.push(capturePathIdentity(protocolPath(workspaceRoot, relative)));
            }
            return plan;
          },
          deriveTerminalClosure,
          stepHandlers: {
            [step.stepId]: {
              prepare: async () => {
                prepareCalls += 1;
                writeFixtureFile(workspaceRoot, stageRef, payload);
              },
              observe: async () => stepObservation(workspaceRoot, step),
              commit: async () => {
                commitCalls += 1;
                renameSync(
                  portablePath(workspaceRoot, stageRef),
                  portablePath(workspaceRoot, finalRef),
                );
              },
            },
          },
        }),
        /(?:gate|lock|release|recovery|required|path-race)/iu,
      );

      assert.equal(deriveCalls, 1);
      assert.equal(closureCalls, 2);
      assert.equal(prepareCalls, 1);
      assert.equal(commitCalls, 1);
      assert.ok(replacementGateSnapshot);
      assertExactFixtureFileUnchanged(replacementGateSnapshot);
      for (const snapshot of rootSnapshots) assertPathIdentityUnchanged(snapshot);
      assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
      assert.deepEqual(readFileSync(portablePath(workspaceRoot, finalRef)), payload);
    });
  }
});

test("in-place mode repair is restricted to explicit migration of the local root", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const directoryDigest = sha256("stable wakeflow-local directory identity");

  function bootstrapLegacyLocal(workspaceRoot) {
    const localRoot = protocolPath(workspaceRoot, localRelative);
    mkdirSync(localRoot, { mode: 0o755 });
    chmodSync(localRoot, 0o755);
    mkdirSync(protocolPath(workspaceRoot, runtimeRelative), { mode: 0o700 });
    mkdirSync(protocolPath(workspaceRoot, maintenanceRelative), { mode: 0o700 });
    mkdirSync(protocolPath(workspaceRoot, transactionsRelative), { mode: 0o700 });
    return localRoot;
  }

  function repairPlan(ref) {
    return maintenancePlan([{
      stepId: "repair-local-root-mode",
      ordinal: 0,
      stepKind: "create-or-update",
      source: fileContract(ref, {
        type: "directory",
        mode: "0755",
        digest: directoryDigest,
      }),
      staging: null,
      final: fileContract(ref, {
        type: "directory",
        mode: "0700",
        digest: directoryDigest,
      }),
    }]);
  }

  function observeRepair(workspaceRoot, step) {
    const target = portablePath(workspaceRoot, step.final.ref);
    const snapshot = fileContract(step.final.ref, {
      type: "directory",
      mode: modeString(lstatSync(target).mode),
      digest: directoryDigest,
    });
    return { source: snapshot, staging: null, final: snapshot };
  }

  function repairClosure(workspaceRoot) {
    return ({ plan, planDigest }) => ({
      planDigest,
      closureDigests: [{
        name: "local-root-mode",
        digest: canonicalJsonDigest({
          planDigest,
          final: observeRepair(workspaceRoot, plan.payload.steps[0]).final,
        }),
      }],
    });
  }

  await t.test("explicit migration journals and repairs local 0755 to 0700", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-migration-mode-repair-");
    const localRoot = bootstrapLegacyLocal(workspaceRoot);
    const plan = repairPlan(localRelative);
    const step = plan.payload.steps[0];
    let prepareCalls = 0;
    let commitCalls = 0;

    await runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "explicit-migration",
      operationKind: "explicit-migration",
      domainOwner: "test-migration-manager",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => plan,
      deriveTerminalClosure: repairClosure(workspaceRoot),
      stepHandlers: {
        [step.stepId]: {
          prepare: async () => { prepareCalls += 1; },
          observe: async () => observeRepair(workspaceRoot, step),
          commit: async () => {
            commitCalls += 1;
            chmodSync(localRoot, 0o700);
          },
        },
      },
    });

    assert.equal(prepareCalls, 1);
    assert.equal(commitCalls, 1);
    assert.equal(lstatSync(localRoot).mode & 0o777, 0o700);
    assertNoMaintenanceResidue(workspaceRoot);
  });

  await t.test("runtime rejects a schema-invalid legacy source mode before journaling", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-migration-schema-mode-parity-");
    const localRoot = bootstrapLegacyLocal(workspaceRoot);
    const plan = repairPlan(localRelative);
    plan.payload.steps[0].source.mode = "0600";
    let deriveCalls = 0;
    let callbackCount = 0;

    await assert.rejects(
      () => runWakeflowMaintenanceMutation({
        workspaceRoot,
        action: "explicit-migration",
        operationKind: "explicit-migration",
        domainOwner: "test-migration-manager",
        confirmedPlan: plan,
        planDigest: canonicalJsonDigest(plan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => {
          deriveCalls += 1;
          return plan;
        },
        deriveTerminalClosure: repairClosure(workspaceRoot),
        stepHandlers: {
          [plan.payload.steps[0].stepId]: {
            prepare: async () => { callbackCount += 1; },
            observe: async () => {
              callbackCount += 1;
              return observeRepair(workspaceRoot, plan.payload.steps[0]);
            },
            commit: async () => { callbackCount += 1; },
          },
        },
      }),
      /(?:mode|repair|migration|plan)/iu,
    );

    assert.equal(deriveCalls, 0, "manager plan validation precedes in-fence derivation");
    assert.equal(callbackCount, 0, "schema-invalid plans invoke no physical callback");
    assert.equal(lstatSync(localRoot).mode & 0o777, 0o755);
    assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
  });

  await t.test("the same null-staging repair is rejected for a non-migration action", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-reconcile-mode-repair-");
    bootstrapLegacyLocal(workspaceRoot);
    const plan = repairPlan(localRelative);
    const step = plan.payload.steps[0];
    let callbackCount = 0;

    await assert.rejects(
      () => runWakeflowMaintenanceMutation({
        workspaceRoot,
        action: "reconcile",
        operationKind: "reconcile",
        domainOwner: "maintenance-red-test",
        confirmedPlan: plan,
        planDigest: canonicalJsonDigest(plan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => {
          callbackCount += 1;
          return plan;
        },
        deriveTerminalClosure: repairClosure(workspaceRoot),
        stepHandlers: {
          [step.stepId]: {
            prepare: async () => { callbackCount += 1; },
            observe: async () => { callbackCount += 1; return observeRepair(workspaceRoot, step); },
            commit: async () => { callbackCount += 1; },
          },
        },
      }),
      /(?:migration|mode repair|invalid-plan|invalid|unsafe)/iu,
    );

    assert.equal(callbackCount, 0, "action/ref admission rejects before plan or step callbacks");
    assert.equal(lstatSync(protocolPath(workspaceRoot, localRelative)).mode & 0o777, 0o755);
    assertNoMaintenanceResidue(workspaceRoot);
  });

  await t.test("explicit migration cannot use null staging to chmod another directory", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-migration-other-mode-repair-");
    bootstrapProtocol(workspaceRoot);
    const otherRef = ".wakeflow-fixture/not-the-local-root";
    const otherRoot = portablePath(workspaceRoot, otherRef);
    mkdirSync(otherRoot, { mode: 0o755, recursive: true });
    chmodSync(otherRoot, 0o755);
    const plan = repairPlan(otherRef);
    const step = plan.payload.steps[0];
    let callbackCount = 0;

    await assert.rejects(
      () => runWakeflowMaintenanceMutation({
        workspaceRoot,
        action: "explicit-migration",
        operationKind: "explicit-migration",
        domainOwner: "test-migration-manager",
        confirmedPlan: plan,
        planDigest: canonicalJsonDigest(plan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => {
          callbackCount += 1;
          return plan;
        },
        deriveTerminalClosure: repairClosure(workspaceRoot),
        stepHandlers: {
          [step.stepId]: {
            prepare: async () => { callbackCount += 1; },
            observe: async () => { callbackCount += 1; return observeRepair(workspaceRoot, step); },
            commit: async () => { callbackCount += 1; },
          },
        },
      }),
    );

    assert.equal(callbackCount, 0, "the fixed local-root target is a pre-admission contract");
    assert.equal(lstatSync(otherRoot).mode & 0o777, 0o755);
    assertNoMaintenanceResidue(workspaceRoot);
  });
});

test("null-staging static directory create and mode repair are journaled maintenance steps", async (t) => {
  const {
    assertWakeflowMutationContext,
    runWakeflowMaintenanceMutation,
  } = await mutationManager();
  const directoryDigest = sha256("static directory node contract");
  const staticRef = `${runtimeRelative}/shared`;

  await t.test("fresh-initialize atomically creates an absent private directory", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-atomic-directory-create-");
    const step = {
      stepId: "atomic-directory-create",
      ordinal: 0,
      stepKind: "create-or-update",
      source: fileContract(staticRef, { type: "absent" }),
      staging: null,
      final: fileContract(staticRef, {
        type: "directory",
        mode: "0700",
        digest: directoryDigest,
      }),
    };
    const plan = maintenancePlan([step]);
    const deriveClosure = nullStagingDirectoryClosure(workspaceRoot);
    let prepareCalls = 0;
    let commitCalls = 0;

    await runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "fresh-initialize",
      operationKind: "static-layout-initialize",
      domainOwner: "test-layout-manager",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async ({ context }) => {
        assertWakeflowMutationContext({ workspaceRoot, context, mode: "maintenance" });
        return plan;
      },
      deriveTerminalClosure: async ({ context, ...input }) => {
        assertWakeflowMutationContext({ workspaceRoot, context, mode: "maintenance" });
        return deriveClosure(input);
      },
      stepHandlers: {
        [step.stepId]: {
          prepare: async ({ context }) => {
            prepareCalls += 1;
            assertWakeflowMutationContext({ workspaceRoot, context, mode: "maintenance" });
            assertPrivateRegularFile(singleJournalFile(workspaceRoot));
            assert.equal(existsSync(portablePath(workspaceRoot, staticRef)), false);
          },
          observe: async ({ context }) => {
            assertWakeflowMutationContext({ workspaceRoot, context, mode: "maintenance" });
            return nullStagingDirectoryObservation(workspaceRoot, step);
          },
          commit: async ({ context }) => {
            commitCalls += 1;
            assertWakeflowMutationContext({ workspaceRoot, context, mode: "maintenance" });
            const target = portablePath(workspaceRoot, staticRef);
            mkdirSync(target, { mode: 0o700 });
            chmodSync(target, 0o700);
          },
        },
      },
    });

    assert.equal(prepareCalls, 1);
    assert.equal(commitCalls, 1);
    assertPrivateDirectory(portablePath(workspaceRoot, staticRef));
    assertNoMaintenanceResidue(workspaceRoot);
  });

  await t.test("reconcile repairs a safe non-protocol static directory mode", {
    skip: process.platform === "win32" ? "POSIX directory modes are required" : false,
  }, async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-static-directory-mode-repair-");
    bootstrapProtocol(workspaceRoot);
    const target = portablePath(workspaceRoot, staticRef);
    mkdirSync(target, { mode: 0o755 });
    chmodSync(target, 0o755);
    const step = {
      stepId: "safe-directory-mode-repair",
      ordinal: 0,
      stepKind: "create-or-update",
      source: fileContract(staticRef, {
        type: "directory",
        mode: "0755",
        digest: directoryDigest,
      }),
      staging: null,
      final: fileContract(staticRef, {
        type: "directory",
        mode: "0700",
        digest: directoryDigest,
      }),
    };
    const plan = maintenancePlan([step]);
    const deriveClosure = nullStagingDirectoryClosure(workspaceRoot);
    let prepareCalls = 0;
    let commitCalls = 0;

    await runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "static-layout-reconcile",
      domainOwner: "test-layout-manager",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async ({ context }) => {
        assertWakeflowMutationContext({ workspaceRoot, context, mode: "maintenance" });
        return plan;
      },
      deriveTerminalClosure: async ({ context, ...input }) => {
        assertWakeflowMutationContext({ workspaceRoot, context, mode: "maintenance" });
        return deriveClosure(input);
      },
      stepHandlers: {
        [step.stepId]: {
          prepare: async ({ context }) => {
            prepareCalls += 1;
            assertWakeflowMutationContext({ workspaceRoot, context, mode: "maintenance" });
            assertPrivateRegularFile(singleJournalFile(workspaceRoot));
            assert.equal(lstatSync(target).mode & 0o777, 0o755);
          },
          observe: async ({ context }) => {
            assertWakeflowMutationContext({ workspaceRoot, context, mode: "maintenance" });
            return nullStagingDirectoryObservation(workspaceRoot, step);
          },
          commit: async ({ context }) => {
            commitCalls += 1;
            assertWakeflowMutationContext({ workspaceRoot, context, mode: "maintenance" });
            chmodSync(target, 0o700);
          },
        },
      },
    });

    assert.equal(prepareCalls, 1);
    assert.equal(commitCalls, 1);
    assertPrivateDirectory(target);
    assertNoMaintenanceResidue(workspaceRoot);
  });
});

test("null-staging directory admission rejects unsafe modes and non-directory shapes", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const directoryDigest = sha256("invalid static directory node contract");
  const staticRef = `${runtimeRelative}/shared`;

  for (const fixture of [
    {
      name: "group-writable-source-mode",
      setup(workspaceRoot) {
        const target = portablePath(workspaceRoot, staticRef);
        mkdirSync(target, { mode: 0o775 });
        chmodSync(target, 0o775);
      },
      step: {
        stepId: "unsafe-directory-mode-repair",
        ordinal: 0,
        stepKind: "create-or-update",
        source: fileContract(staticRef, {
          type: "directory",
          mode: "0775",
          digest: directoryDigest,
        }),
        staging: null,
        final: fileContract(staticRef, {
          type: "directory",
          mode: "0700",
          digest: directoryDigest,
        }),
      },
    },
    {
      name: "null-staging-file-publication",
      setup() {},
      step: {
        stepId: "null-staging-file-publication",
        ordinal: 0,
        stepKind: "create-or-update",
        source: fileContract(staticRef, { type: "absent" }),
        staging: null,
        final: fileContract(staticRef, {
          type: "file",
          mode: "0600",
          digest: directoryDigest,
        }),
      },
    },
    {
      name: "changed-directory-node-digest",
      setup(workspaceRoot) {
        const target = portablePath(workspaceRoot, staticRef);
        mkdirSync(target, { mode: 0o755 });
        chmodSync(target, 0o755);
      },
      step: {
        stepId: "changed-directory-node-digest",
        ordinal: 0,
        stepKind: "create-or-update",
        source: fileContract(staticRef, {
          type: "directory",
          mode: "0755",
          digest: directoryDigest,
        }),
        staging: null,
        final: fileContract(staticRef, {
          type: "directory",
          mode: "0700",
          digest: sha256("forged replacement directory node contract"),
        }),
      },
    },
  ]) {
    await t.test(fixture.name, {
      skip: process.platform === "win32" && fixture.name !== "null-staging-file-publication"
        ? "POSIX directory modes are required"
        : false,
    }, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-${fixture.name}-`);
      bootstrapProtocol(workspaceRoot);
      fixture.setup(workspaceRoot);
      const plan = maintenancePlan([fixture.step]);
      let deriveCalls = 0;
      let callbackCalls = 0;

      await assert.rejects(
        () => runWakeflowMaintenanceMutation({
          workspaceRoot,
          action: "reconcile",
          operationKind: "static-layout-reconcile",
          domainOwner: "test-layout-manager",
          confirmedPlan: plan,
          planDigest: canonicalJsonDigest(plan),
          validatePlan: validateTestPlan,
          deriveCurrentPlan: async () => {
            deriveCalls += 1;
            return plan;
          },
          deriveTerminalClosure: nullStagingDirectoryClosure(workspaceRoot),
          stepHandlers: {
            [fixture.step.stepId]: {
              prepare: async () => { callbackCalls += 1; },
              observe: async () => {
                callbackCalls += 1;
                return {
                  source: fileContract(fixture.step.source.ref, { type: "absent" }),
                  staging: null,
                  final: fileContract(fixture.step.final.ref, { type: "absent" }),
                };
              },
              commit: async () => { callbackCalls += 1; },
            },
          },
        }),
        /(?:invalid|mode|directory|digest|staging|plan)/iu,
      );

      assert.equal(deriveCalls, 0, "manager shape admission precedes in-gate re-derivation");
      assert.equal(callbackCalls, 0, "an unsafe null-staging shape invokes no domain callback");
      assertNoMaintenanceResidue(workspaceRoot);
    });
  }
});

test("null-staging directory prepare is preflight-only and cannot cross commit", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const directoryDigest = sha256("prepare boundary directory node contract");
  const staticRef = `${runtimeRelative}/shared`;

  for (const scenario of [
    { name: "atomic-create", action: "fresh-initialize", sourceMode: null },
    { name: "mode-repair", action: "reconcile", sourceMode: "0755" },
  ]) {
    await t.test(scenario.name, {
      skip: process.platform === "win32" && scenario.sourceMode !== null
        ? "POSIX directory modes are required"
        : false,
    }, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-prepare-overstep-${scenario.name}-`);
      if (scenario.action === "reconcile") bootstrapProtocol(workspaceRoot);
      const target = portablePath(workspaceRoot, staticRef);
      if (scenario.sourceMode !== null) {
        mkdirSync(target, { mode: 0o755 });
        chmodSync(target, 0o755);
      }
      const step = {
        stepId: `prepare-overstep-${scenario.name}`,
        ordinal: 0,
        stepKind: "create-or-update",
        source: scenario.sourceMode === null
          ? fileContract(staticRef, { type: "absent" })
          : fileContract(staticRef, {
            type: "directory",
            mode: scenario.sourceMode,
            digest: directoryDigest,
          }),
        staging: null,
        final: fileContract(staticRef, {
          type: "directory",
          mode: "0700",
          digest: directoryDigest,
        }),
      };
      const plan = maintenancePlan([step]);
      let prepareCalls = 0;
      let commitCalls = 0;

      await assert.rejects(
        () => runWakeflowMaintenanceMutation({
          workspaceRoot,
          action: scenario.action,
          operationKind: "static-layout-reconcile",
          domainOwner: "test-layout-manager",
          confirmedPlan: plan,
          planDigest: canonicalJsonDigest(plan),
          validatePlan: validateTestPlan,
          deriveCurrentPlan: async () => plan,
          deriveTerminalClosure: nullStagingDirectoryClosure(workspaceRoot),
          stepHandlers: {
            [step.stepId]: {
              observe: async () => nullStagingDirectoryObservation(workspaceRoot, step),
              prepare: async () => {
                prepareCalls += 1;
                if (scenario.sourceMode === null) {
                  mkdirSync(target, { mode: 0o700 });
                } else {
                  chmodSync(target, 0o700);
                }
              },
              commit: async () => { commitCalls += 1; },
            },
          },
        }),
        /(?:invalid|manual|prepare|boundary|recovery|required)/iu,
      );

      assert.equal(prepareCalls, 1, "the admitted prepare callback is what crosses the boundary");
      assert.equal(commitCalls, 0);
      const retained = JSON.parse(readFileSync(singleJournalFile(workspaceRoot), "utf8"));
      assert.equal(retained.phase, "incomplete");
      assert.equal(retained.ownerDisposition, "active");
      assert.equal(retained.checkpoint, 0);
      assert.equal(retained.steps[0].status, "planned");
      assertPrivateRegularFile(protocolPath(workspaceRoot, lockRelative));
    });
  }
});

test("the global mutation gate awaits async runtime owners and excludes runtime and maintenance across real processes", async (t) => {
  await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-process-");
  bootstrapProtocol(workspaceRoot);

  const firstEntered = path.join(workspaceRoot, "first-entered");
  const releaseFirst = path.join(workspaceRoot, "release-first");
  const secondEntered = path.join(workspaceRoot, "second-entered");
  const holderSource = `
    import { existsSync, writeFileSync } from "node:fs";
    import { withWakeflowRuntimeMutation } from ${JSON.stringify(managerUrl)};
    const [workspaceRoot, enteredFile, releaseFile] = process.argv.slice(1);
    await withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "child-runtime-holder",
      domainOwner: "maintenance-red-test",
      acquireTimeoutMs: 3000,
    }, async () => {
      writeFileSync(enteredFile, "entered\\n");
      while (!existsSync(releaseFile)) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });
  `;
  const waiterSource = `
    import { writeFileSync } from "node:fs";
    import { withWakeflowRuntimeMutation } from ${JSON.stringify(managerUrl)};
    const [workspaceRoot, enteredFile] = process.argv.slice(1);
    await withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "child-runtime-waiter",
      domainOwner: "maintenance-red-test",
      acquireTimeoutMs: 3000,
    }, async () => {
      writeFileSync(enteredFile, "entered\\n");
      await Promise.resolve();
    });
  `;

  const holder = spawnModuleChild(holderSource, [workspaceRoot, firstEntered, releaseFirst]);
  t.after(() => {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill("SIGKILL");
  });
  await waitFor(() => existsSync(firstEntered), "runtime holder never entered its callback");
  assertPrivateRegularFile(protocolPath(workspaceRoot, lockRelative));

  const waiter = spawnModuleChild(waiterSource, [workspaceRoot, secondEntered]);
  t.after(() => {
    if (waiter.exitCode === null && waiter.signalCode === null) waiter.kill("SIGKILL");
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(
    existsSync(secondEntered),
    false,
    "a promise-returning holder must retain the gate until its callback settles",
  );

  writeFileSync(releaseFirst, "release\n");
  const [holderResult, waiterResult] = await Promise.all([
    collectChild(holder),
    collectChild(waiter),
  ]);
  assert.deepEqual(holderResult, { code: 0, signal: null, stdout: "", stderr: "" });
  assert.deepEqual(waiterResult, { code: 0, signal: null, stdout: "", stderr: "" });
  assert.equal(existsSync(secondEntered), true);
  assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);

  const maintenanceRoot = withTempWorkspace(t, "wakeflow-maintenance-cross-mode-");
  bootstrapProtocol(maintenanceRoot);
  const runtimeEntered = path.join(maintenanceRoot, "runtime-entered");
  const releaseRuntime = path.join(maintenanceRoot, "release-runtime");
  const maintenanceDerived = path.join(maintenanceRoot, "maintenance-derived");
  const runtimeHolder = spawnModuleChild(holderSource, [
    maintenanceRoot,
    runtimeEntered,
    releaseRuntime,
  ]);
  t.after(() => {
    if (runtimeHolder.exitCode === null && runtimeHolder.signalCode === null) {
      runtimeHolder.kill("SIGKILL");
    }
  });
  await waitFor(() => existsSync(runtimeEntered), "cross-mode runtime holder never entered");

  const maintenanceSource = `
    import { writeFileSync } from "node:fs";
    import { canonicalJsonDigest } from ${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-canonical-json.mjs")).href)};
    import { runWakeflowMaintenanceMutation } from ${JSON.stringify(managerUrl)};
    const [workspaceRoot, derivedFile] = process.argv.slice(1);
    const plan = {
      schemaId: "urn:wakeflow:internal:test-maintenance-plan:v1",
      payload: { steps: [] },
    };
    const validatePlan = async (input) => {
      if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).join(",") !== "plan" || !Object.hasOwn(input, "plan")) {
        throw new Error("invalid test plan validation input");
      }
      const candidate = input.plan;
      if (!Object.hasOwn(candidate, "schemaId") || !Object.hasOwn(candidate, "payload")
        || Object.keys(candidate).sort().join(",") !== "payload,schemaId"
        || candidate.schemaId !== "urn:wakeflow:internal:test-maintenance-plan:v1"
        || !Object.hasOwn(candidate.payload, "steps")
        || !Array.isArray(candidate.payload.steps)) {
        throw new Error("invalid test maintenance plan");
      }
      return { valid: true };
    };
    try {
      await runWakeflowMaintenanceMutation({
        workspaceRoot,
        action: "reconcile",
        operationKind: "reconcile",
        domainOwner: "maintenance-red-test",
        acquireTimeoutMs: 120,
        confirmedPlan: plan,
        planDigest: canonicalJsonDigest(plan),
        validatePlan,
        deriveCurrentPlan: async () => {
          writeFileSync(derivedFile, "derived\\n");
          return plan;
        },
        stepHandlers: {},
      });
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(String(error?.code ?? error?.message ?? error));
      process.exitCode = 3;
    }
  `;
  const maintenance = spawnModuleChild(maintenanceSource, [maintenanceRoot, maintenanceDerived]);
  const maintenanceResult = await collectChild(maintenance);
  assert.equal(maintenanceResult.code, 3, maintenanceResult.stderr);
  assert.match(maintenanceResult.stderr, /(?:busy|lock|timeout|mutation)/iu);
  assert.equal(
    existsSync(maintenanceDerived),
    false,
    "maintenance must not derive a plan before owning the global gate",
  );

  writeFileSync(releaseRuntime, "release\n");
  const runtimeResult = await collectChild(runtimeHolder);
  assert.deepEqual(runtimeResult, { code: 0, signal: null, stdout: "", stderr: "" });
  assert.equal(existsSync(protocolPath(maintenanceRoot, lockRelative)), false);
});

test("Darwin process identity is invariant across caller timezone and locale", {
  skip: process.platform !== "darwin" ? "Darwin /bin/ps start identity is required" : false,
}, async (t) => {
  await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-darwin-process-environment-");
  bootstrapProtocol(workspaceRoot);
  const enteredFile = path.join(workspaceRoot, "holder-entered");
  const releaseFile = path.join(workspaceRoot, "release-holder");
  const deriveFile = path.join(workspaceRoot, "recovery-derived");
  const holderSource = `
    import { existsSync, writeFileSync } from "node:fs";
    import { withWakeflowRuntimeMutation } from ${JSON.stringify(managerUrl)};
    const [workspaceRoot, enteredFile, releaseFile] = process.argv.slice(1);
    await withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "darwin-environment-holder",
      domainOwner: "maintenance-red-test",
    }, async () => {
      writeFileSync(enteredFile, "entered\\n");
      while (!existsSync(releaseFile)) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });
  `;
  const holder = spawnModuleChild(holderSource, [workspaceRoot, enteredFile, releaseFile], {
    env: {
      ...process.env,
      TZ: "Asia/Shanghai",
      LC_ALL: "C",
      LANG: "C",
    },
  });
  t.after(() => {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill("SIGKILL");
  });
  await waitFor(() => existsSync(enteredFile), "Darwin environment holder never acquired the gate");

  const lockFile = protocolPath(workspaceRoot, lockRelative);
  const lockBefore = captureExactFixtureFile(lockFile);
  const lock = JSON.parse(lockBefore.bytes.toString("utf8"));
  const recoverySource = `
    import { writeFileSync } from "node:fs";
    import { canonicalJsonDigest } from ${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-canonical-json.mjs")).href)};
    import { recoverWakeflowWorkspaceMutation } from ${JSON.stringify(managerUrl)};
    const [workspaceRoot, operationId, deriveFile] = process.argv.slice(1);
    const plan = {
      schemaId: "urn:wakeflow:internal:test-maintenance-plan:v1",
      payload: { steps: [] },
    };
    const validatePlan = async ({ plan: candidate }) => {
      if (!candidate || candidate.schemaId !== plan.schemaId
        || !candidate.payload || !Array.isArray(candidate.payload.steps)) {
        throw new Error("invalid Darwin recovery plan");
      }
      return { valid: true };
    };
    try {
      await recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId,
        confirmedPlan: plan,
        planDigest: canonicalJsonDigest(plan),
        validatePlan,
        deriveCurrentPlan: async () => {
          writeFileSync(deriveFile, "derived\\n");
          return plan;
        },
        stepHandlers: {},
      });
      process.stdout.write("recovered");
    } catch (error) {
      process.stderr.write(String(error?.code ?? error?.message ?? error));
      process.exitCode = 3;
    }
  `;
  const recovery = spawnModuleChild(recoverySource, [workspaceRoot, lock.operationId, deriveFile], {
    env: {
      ...process.env,
      TZ: "UTC",
      LC_ALL: "zh_CN.UTF-8",
      LANG: "zh_CN.UTF-8",
    },
  });
  const recoveryResult = await collectChild(recovery);

  assert.equal(recoveryResult.code, 3, recoveryResult.stdout || recoveryResult.stderr);
  assert.match(recoveryResult.stderr, /(?:busy|same-live|owner|process|recovery)/iu);
  assert.equal(existsSync(deriveFile), false, "live-owner rejection precedes plan derivation");
  assertExactFixtureFileUnchanged(lockBefore);
  assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);

  writeFileSync(releaseFile, "release\n");
  const holderResult = await collectChild(holder);
  assert.deepEqual(holderResult, { code: 0, signal: null, stdout: "", stderr: "" });
  assertNoMaintenanceResidue(workspaceRoot);
});

test("runtime failure release is owner-proved and lock-only recovery remains explicit", async (t) => {
  const {
    recoverWakeflowWorkspaceMutation,
    withWakeflowRuntimeMutation,
  } = await mutationManager();

  async function leaveRelinquishedLockOnlyJournal(workspaceRoot) {
    const plan = maintenancePlan();
    const planDigest = canonicalJsonDigest(plan);
    const phases = [];
    const callbackError = new Error("synthetic runtime side-effect failure");
    let oldGateChecks = 0;
    let successorGateChecks = 0;

    function assertOriginalRuntimeGate(context) {
      const lock = JSON.parse(
        readFileSync(protocolPath(workspaceRoot, lockRelative), "utf8"),
      );
      assert.equal(lock.mode, "runtime-mutation");
      assert.equal(lock.operationId, context.operationId);
      assert.equal(lock.ownerToken, context.ownerToken);
      assert.equal(lock.recoveryGeneration, 0);
      assert.equal(lock.recoveryClaim, null);
      oldGateChecks += 1;
    }

    function assertSuccessorRecoveryGate(context) {
      const claims = recoveryClaimFiles(workspaceRoot, context.operationId);
      assert.equal(claims.length, 1);
      assertPrivateRegularFile(claims[0]);
      const claim = JSON.parse(readFileSync(claims[0], "utf8"));
      const lock = JSON.parse(
        readFileSync(protocolPath(workspaceRoot, lockRelative), "utf8"),
      );
      const journal = JSON.parse(readFileSync(singleJournalFile(workspaceRoot), "utf8"));
      const claimRef = path.relative(workspaceRoot, claims[0]).split(path.sep).join("/");
      const expectedClaimReference = {
        ref: claimRef,
        generation: 1,
        digest: canonicalJsonDigest(claim),
      };
      assert.equal(context.recoveryGeneration, 1);
      assert.equal(lock.mode, "recovery-cleanup");
      assert.equal(lock.operationId, context.operationId);
      assert.equal(lock.ownerToken, context.ownerToken);
      assert.equal(lock.recoveryGeneration, 1);
      assert.deepEqual(lock.recoveryClaim, expectedClaimReference);
      assert.equal(claim.recoveryGeneration, 1);
      assert.equal(claim.planDigest, planDigest);
      assert.equal(journal.ownerDisposition, "active");
      assert.equal(journal.recoveryGeneration, 1);
      assert.deepEqual(journal.recoveryClaim, expectedClaimReference);
      assert.equal(journal.ownerToken, lock.ownerToken);
      assert.deepEqual(journal.processIdentity, lock.processIdentity);
      successorGateChecks += 1;
    }

    await assert.rejects(
      () => withWakeflowRuntimeMutation({
        workspaceRoot,
        operationKind: "runtime-lock-only-fixture",
        domainOwner: "maintenance-red-test",
        validateRecoveryPlan: validateTestPlan,
        onCallbackFailure: async (input) => {
          assert.deepEqual(
            Object.keys(input).sort(),
            ["context", "error", "expectedPlanDigest", "phase"],
          );
          assert.equal(input.error, callbackError);
          assert.equal(Object.isFrozen(input.context), true);
          phases.push(input.phase);
          if (input.phase === "after-callback-settled") {
            assertOriginalRuntimeGate(input.context);
            assert.equal(input.expectedPlanDigest, null);
          } else {
            assert.equal(input.phase, "before-gate-release");
            assert.equal(input.expectedPlanDigest, planDigest);
            assertSuccessorRecoveryGate(input.context);
          }
          return { disposition: "lock-only-recovery", plan, planDigest };
        },
      }, async (context) => {
        assertOriginalRuntimeGate(context);
        throw callbackError;
      }),
      /(?:recovery-required|synthetic runtime side-effect failure)/iu,
    );

    assert.deepEqual(phases, ["after-callback-settled", "before-gate-release"]);
    assert.equal(oldGateChecks, 2, "the callback and first proof remain under generation zero");
    assert.equal(successorGateChecks, 1, "the second proof runs under the successor gate");
    const journalFile = singleJournalFile(workspaceRoot);
    const journal = JSON.parse(readFileSync(journalFile, "utf8"));
    assert.equal(journal.purpose, "lock-only-recovery");
    assert.equal(journal.action, "runtime-mutation-recovery");
    assert.equal(journal.ownerDisposition, "relinquished");
    assert.equal(journal.processIdentity.pid, process.pid);
    assert.equal(journal.phase, "incomplete");
    assert.deepEqual(journal.steps, []);
    assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
    const retainedClaims = recoveryClaimFiles(workspaceRoot, journal.operationId);
    assert.equal(retainedClaims.length, 1);
    assertPrivateRegularFile(retainedClaims[0]);
    const retainedClaim = JSON.parse(readFileSync(retainedClaims[0], "utf8"));
    assert.deepEqual(journal.recoveryClaim, {
      ref: path.relative(workspaceRoot, retainedClaims[0]).split(path.sep).join("/"),
      generation: retainedClaim.recoveryGeneration,
      digest: canonicalJsonDigest(retainedClaim),
    });
    return {
      journal,
      journalFile,
      plan,
      planDigest,
      retainedClaimFile: retainedClaims[0],
    };
  }

  await t.test("safe-to-release uses the exact verifier result and leaves zero residue", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-runtime-safe-release-");
    bootstrapProtocol(workspaceRoot);
    const callbackError = new Error("synthetic verified runtime failure");
    let verifierCalls = 0;

    await assert.rejects(
      () => withWakeflowRuntimeMutation({
        workspaceRoot,
        operationKind: "runtime-safe-release-fixture",
        domainOwner: "maintenance-red-test",
        onCallbackFailure: async (input) => {
          verifierCalls += 1;
          assert.deepEqual(
            Object.keys(input).sort(),
            ["context", "error", "expectedPlanDigest", "phase"],
          );
          assert.equal(input.error, callbackError);
          assert.equal(input.phase, "after-callback-settled");
          assert.equal(input.expectedPlanDigest, null);
          return {
            disposition: "safe-to-release",
            closureDigests: [{
              name: "runtime-safe-release",
              digest: sha256("verified runtime closure"),
            }],
          };
        },
      }, async () => {
        throw callbackError;
      }),
      /(?:callback-failed|synthetic verified runtime failure)/iu,
    );

    assert.equal(verifierCalls, 1);
    assertNoMaintenanceResidue(workspaceRoot);
  });

  await t.test("two lock-only proofs relinquish ownership and same-live explicit recovery succeeds", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-runtime-lock-only-");
    bootstrapProtocol(workspaceRoot);
    const fixture = await leaveRelinquishedLockOnlyJournal(workspaceRoot);
    let deriveCalls = 0;
    let observedClaimInsideRecovery = false;

    await recoverWakeflowWorkspaceMutation({
      workspaceRoot,
      operationId: fixture.journal.operationId,
      confirmedPlan: fixture.plan,
      planDigest: fixture.planDigest,
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => {
        deriveCalls += 1;
        if (deriveCalls === 2) {
          const claims = recoveryClaimFiles(workspaceRoot, fixture.journal.operationId);
          assert.equal(claims.length, 2, "explicit recovery extends the retained claim chain");
          assert.equal(claims[0], fixture.retainedClaimFile);
          assertPrivateRegularFile(claims[1]);
          const claim = JSON.parse(readFileSync(claims[1], "utf8"));
          const successor = JSON.parse(
            readFileSync(protocolPath(workspaceRoot, lockRelative), "utf8"),
          );
          const activeJournal = JSON.parse(readFileSync(fixture.journalFile, "utf8"));
          const claimRef = path.relative(workspaceRoot, claims[1]).split(path.sep).join("/");
          const expectedGeneration = fixture.journal.recoveryGeneration + 1;
          const expectedClaimReference = {
            ref: claimRef,
            generation: expectedGeneration,
            digest: canonicalJsonDigest(claim),
          };
          assert.equal(claim.recoveryGeneration, expectedGeneration);
          assert.equal(successor.mode, "recovery-cleanup");
          assert.equal(successor.recoveryGeneration, expectedGeneration);
          assert.deepEqual(successor.recoveryClaim, expectedClaimReference);
          assert.equal(activeJournal.ownerDisposition, "active");
          assert.equal(activeJournal.recoveryGeneration, expectedGeneration);
          assert.deepEqual(activeJournal.recoveryClaim, expectedClaimReference);
          assert.equal(successor.ownerToken, activeJournal.ownerToken);
          assert.deepEqual(successor.processIdentity, activeJournal.processIdentity);
          observedClaimInsideRecovery = true;
        }
        return fixture.plan;
      },
      stepHandlers: {},
    });

    assert.equal(deriveCalls, 2, "lock-only recovery proves the zero-step plan twice");
    assert.equal(observedClaimInsideRecovery, true);
    assertNoMaintenanceResidue(workspaceRoot);
  });

  await t.test("an active same-live lock-absent journal blocks before claim creation", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-runtime-active-same-live-");
    bootstrapProtocol(workspaceRoot);
    const fixture = await leaveRelinquishedLockOnlyJournal(workspaceRoot);
    const activeJournal = { ...fixture.journal, ownerDisposition: "active" };
    const replacement = `${fixture.journalFile}.active-fixture`;
    writeFileSync(replacement, `${canonicalJson(activeJournal)}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(replacement, 0o600);
    renameSync(replacement, fixture.journalFile);
    let deriveCalls = 0;
    const claimsBefore = recoveryClaimFiles(workspaceRoot, fixture.journal.operationId)
      .map((claimFile) => ({
        claimFile,
        bytes: readFileSync(claimFile),
        identity: lstatSync(claimFile),
      }));

    await assert.rejects(
      () => recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId: fixture.journal.operationId,
        confirmedPlan: fixture.plan,
        planDigest: fixture.planDigest,
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => {
          deriveCalls += 1;
          return fixture.plan;
        },
        stepHandlers: {},
      }),
      /(?:same-live|still live|recovery-busy|busy)/iu,
    );

    assert.equal(deriveCalls, 0, "live-owner arbitration happens before recovery planning");
    const claimsAfter = recoveryClaimFiles(workspaceRoot, fixture.journal.operationId);
    assert.deepEqual(claimsAfter, claimsBefore.map(({ claimFile }) => claimFile));
    for (const [index, claimFile] of claimsAfter.entries()) {
      const retained = lstatSync(claimFile);
      assert.equal(String(retained.dev), String(claimsBefore[index].identity.dev));
      assert.equal(String(retained.ino), String(claimsBefore[index].identity.ino));
      assert.deepEqual(readFileSync(claimFile), claimsBefore[index].bytes);
    }
    assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
    assert.equal(lstatSync(fixture.journalFile).isFile(), true);
    assert.equal(
      JSON.parse(readFileSync(fixture.journalFile, "utf8")).ownerDisposition,
      "active",
    );
  });
});

test("a dead zero-journal orphan gate requires two zero-step proofs and leaves zero residue", async (t) => {
  const { recoverWakeflowWorkspaceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-orphan-lock-recovery-");
  bootstrapProtocol(workspaceRoot);
  const orphanOperationId = operationId();
  const plan = maintenancePlan();
  const planDigest = canonicalJsonDigest(plan);
  const orphanLock = {
    schemaVersion: 1,
    artifactKind: "wakeflow-workspace-mutation-lock",
    operationId: orphanOperationId,
    mode: "runtime-mutation",
    operationKind: "orphan-runtime-fixture",
    domainOwner: "maintenance-red-test",
    ownerToken: ownerToken(),
    recoveryGeneration: 0,
    processIdentity: {
      platform: process.platform,
      pid: 2_147_483_647,
      startIdentity: sha256(`terminated-orphan-owner:${orphanOperationId}`),
    },
    recoveryClaim: null,
    acquiredAt: new Date().toISOString(),
  };
  const { target: orphanLockFile } = writeCanonicalPrivateFile(
    workspaceRoot,
    lockRelative,
    orphanLock,
  );
  assertPrivateRegularFile(orphanLockFile);
  assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
  let deriveCalls = 0;
  let durableRecoveryArtifactsObserved = false;

  await recoverWakeflowWorkspaceMutation({
    workspaceRoot,
    operationId: orphanOperationId,
    confirmedPlan: plan,
    planDigest,
    validatePlan: validateTestPlan,
    deriveCurrentPlan: async () => {
      deriveCalls += 1;
      if (deriveCalls === 2) {
        const names = readdirSync(protocolPath(workspaceRoot, transactionsRelative));
        assert.equal(names.includes(`${orphanOperationId}.json`), true);
        assert.equal(recoveryClaimFiles(workspaceRoot, orphanOperationId).length, 1);
        const successor = JSON.parse(
          readFileSync(protocolPath(workspaceRoot, lockRelative), "utf8"),
        );
        assert.equal(successor.mode, "recovery-cleanup");
        assert.equal(successor.recoveryGeneration, 1);
        durableRecoveryArtifactsObserved = true;
      }
      return plan;
    },
    stepHandlers: {},
  });

  assert.equal(deriveCalls, 2, "orphan-gate recovery proves no effect before and after takeover");
  assert.equal(durableRecoveryArtifactsObserved, true);
  assertNoMaintenanceResidue(workspaceRoot);
});

test("a maximum-safe cleanup-tail generation fails before publishing another claim", async (t) => {
  const { recoverWakeflowWorkspaceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-generation-overflow-");
  bootstrapProtocol(workspaceRoot);
  const id = operationId();
  const lock = {
    schemaVersion: 1,
    artifactKind: "wakeflow-workspace-mutation-lock",
    operationId: id,
    mode: "recovery-cleanup",
    operationKind: "generation-overflow-fixture",
    domainOwner: "maintenance-red-test",
    ownerToken: ownerToken(),
    recoveryGeneration: Number.MAX_SAFE_INTEGER,
    processIdentity: {
      platform: process.platform,
      pid: 2_147_483_645,
      startIdentity: sha256(`terminated-max-generation-owner:${id}`),
    },
    recoveryClaim: {
      ref: `${transactionsRelative}/${id}.recovery-${Number.MAX_SAFE_INTEGER}.json`,
      generation: Number.MAX_SAFE_INTEGER,
      digest: sha256(`cleaned-max-generation-claim:${id}`),
    },
    acquiredAt: "2026-08-08T00:00:00.000Z",
  };
  writeCanonicalPrivateFile(workspaceRoot, lockRelative, lock);
  const plan = maintenancePlan();
  const before = captureMutationEvidence(workspaceRoot);
  let deriveCalls = 0;

  await assert.rejects(
    () => recoverWakeflowWorkspaceMutation({
      workspaceRoot,
      operationId: id,
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => {
        deriveCalls += 1;
        return plan;
      },
      stepHandlers: {},
    }),
    /(?:generation|safe integer|advance|manual)/iu,
  );

  assert.equal(deriveCalls, 1, "overflow is detected after the first read-only zero-work proof");
  assertMutationEvidenceUnchanged(workspaceRoot, before);
});

test("maintenance re-derives inside the fence and a stale plan invokes zero domain callbacks", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-stale-");
  bootstrapProtocol(workspaceRoot);
  const targetRef = ".wakeflow-fixture/never-written.txt";
  const bytes = Buffer.from("confirmed\n");
  const step = {
    stepId: "stale-create",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(targetRef, { type: "absent" }),
    staging: fileContract(".wakeflow-fixture/.never-written.stage", {
      type: "file",
      mode: "0600",
      digest: sha256(bytes),
    }),
    final: fileContract(targetRef, { type: "file", mode: "0600", digest: sha256(bytes) }),
  };
  const confirmedPlan = maintenancePlan([step]);
  const currentPlan = {
    ...confirmedPlan,
    payload: {
      steps: [{ ...step, stepId: "changed-after-confirmation" }],
    },
  };
  let callbackCount = 0;

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "reconcile",
      domainOwner: "maintenance-red-test",
      confirmedPlan,
      planDigest: canonicalJsonDigest(confirmedPlan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => currentPlan,
      deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
      stepHandlers: {
        [step.stepId]: {
          prepare: async () => { callbackCount += 1; },
          commit: async () => { callbackCount += 1; },
          observe: async () => { callbackCount += 1; return stepObservation(workspaceRoot, step); },
        },
      },
    }),
    (error) => {
      assert.match(String(error?.code ?? error?.message), /plan[-_ ]?stale/iu);
      return true;
    },
  );

  assert.equal(callbackCount, 0);
  assert.equal(existsSync(portablePath(workspaceRoot, targetRef)), false);
  assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
  assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
});

test("physical maintenance requires an explicit plan codec and terminal closure verifier", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();

  for (const missing of ["validatePlan", "deriveTerminalClosure"]) {
    await t.test(`missing ${missing} rejects before any physical callback`, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-maintenance-missing-${missing}-`);
      bootstrapProtocol(workspaceRoot);
      const payload = Buffer.from(`must-not-write-${missing}\n`);
      const finalRef = `.wakeflow-fixture/missing-${missing}/final.txt`;
      const step = {
        stepId: `missing-${missing.toLowerCase()}`,
        ordinal: 0,
        stepKind: "create-or-update",
        source: fileContract(finalRef, { type: "absent" }),
        staging: fileContract(`.wakeflow-fixture/missing-${missing}/final.stage`, {
          type: "file",
          mode: "0600",
          digest: sha256(payload),
        }),
        final: fileContract(finalRef, {
          type: "file",
          mode: "0600",
          digest: sha256(payload),
        }),
      };
      const plan = maintenancePlan([step]);
      let callbackCount = 0;
      const options = {
        workspaceRoot,
        action: "reconcile",
        operationKind: "reconcile",
        domainOwner: "maintenance-red-test",
        confirmedPlan: plan,
        planDigest: canonicalJsonDigest(plan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => plan,
        deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
        stepHandlers: {
          [step.stepId]: {
            prepare: async () => { callbackCount += 1; },
            observe: async () => { callbackCount += 1; return stepObservation(workspaceRoot, step); },
            commit: async () => { callbackCount += 1; },
          },
        },
      };
      delete options[missing];

      await assert.rejects(
        () => runWakeflowMaintenanceMutation(options),
        new RegExp(`(?:${missing}|plan codec|terminal closure|required)`, "iu"),
      );

      assert.equal(callbackCount, 0);
      assert.equal(existsSync(portablePath(workspaceRoot, finalRef)), false);
      assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
      assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
    });
  }
});

test("exclusive journal creation failure executes no physical callback and writes no domain bytes", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-journal-create-failure-");
  bootstrapProtocol(workspaceRoot);
  const payload = Buffer.from("must never become domain bytes\n");
  const finalRef = ".wakeflow-fixture/journal-create-failure/final.txt";
  const stageRef = ".wakeflow-fixture/journal-create-failure/final.stage";
  const step = {
    stepId: "journal-create-failure",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(finalRef, { type: "absent" }),
    staging: fileContract(stageRef, {
      type: "file",
      mode: "0600",
      digest: sha256(payload),
    }),
    final: fileContract(finalRef, {
      type: "file",
      mode: "0600",
      digest: sha256(payload),
    }),
  };
  const plan = maintenancePlan([step]);
  let deriveCalls = 0;
  let callbackCount = 0;
  let occupiedJournal;

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "reconcile",
      domainOwner: "maintenance-red-test",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async ({ context }) => {
        deriveCalls += 1;
        const journalFile = protocolPath(
          workspaceRoot,
          `${transactionsRelative}/${context.operationId}.json`,
        );
        writeFileSync(journalFile, "occupied after residue scan\n", {
          flag: "wx",
          mode: 0o600,
        });
        chmodSync(journalFile, 0o600);
        occupiedJournal = captureExactFixtureFile(journalFile);
        return plan;
      },
      deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
      stepHandlers: {
        [step.stepId]: {
          prepare: async () => { callbackCount += 1; },
          observe: async () => {
            callbackCount += 1;
            return stepObservation(workspaceRoot, step);
          },
          commit: async () => { callbackCount += 1; },
        },
      },
    }),
    (error) => {
      assert.equal(
        error?.code,
        "wakeflow-mutation-exclusive-conflict",
        "the injected conflict must reach createTransaction after the residue scan",
      );
      return true;
    },
  );

  assert.equal(deriveCalls, 1);
  assert.equal(callbackCount, 0);
  assert.ok(occupiedJournal);
  assertExactFixtureFileUnchanged(occupiedJournal);
  assert.equal(existsSync(portablePath(workspaceRoot, finalRef)), false);
  assert.equal(existsSync(portablePath(workspaceRoot, stageRef)), false);
  assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
  assert.deepEqual(
    readdirSync(protocolPath(workspaceRoot, transactionsRelative)),
    [path.basename(occupiedJournal.target)],
    "the manager neither overwrites nor deletes the conflicting foreign inode",
  );
});

test("every physical maintenance step journals first, checkpoints each boundary, and cleans terminal residue", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-journal-");
  bootstrapProtocol(workspaceRoot);
  const payload = Buffer.from("new canonical payload\n");
  const targetRef = ".wakeflow-fixture/published.txt";
  const stageRef = `.wakeflow-fixture/.published.${randomUUID()}.stage`;
  const step = {
    stepId: "publish-fixture",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(targetRef, { type: "absent" }),
    staging: fileContract(stageRef, {
      type: "file",
      mode: "0600",
      digest: sha256(payload),
    }),
    final: fileContract(targetRef, {
      type: "file",
      mode: "0600",
      digest: sha256(payload),
    }),
  };
  const plan = maintenancePlan([step]);
  let journalFile = null;
  let checkpointAfterPrepare = null;
  const terminalClosures = [];

  await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "reconcile",
    operationKind: "reconcile",
    domainOwner: "maintenance-red-test",
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    validatePlan: validateTestPlan,
    deriveCurrentPlan: async () => plan,
    deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot, {
      onDerive: (closure) => terminalClosures.push(closure),
    }),
    stepHandlers: {
      [step.stepId]: {
        prepare: async ({ context }) => {
          assert.ok(context, "domain work receives the branded mutation context");
          journalFile = singleJournalFile(workspaceRoot);
          assertPrivateRegularFile(journalFile);
          const journal = JSON.parse(readFileSync(journalFile, "utf8"));
          assert.equal(journal.artifactKind, "wakeflow-maintenance-transaction");
          assert.equal(journal.phase, "incomplete");
          assert.equal(journal.action, "reconcile");
          assert.equal(Object.hasOwn(journal, "operation"), false);
          assert.equal(typeof journal.ownerToken, "string");
          assert.equal(journal.checkpoint, 0);
          assert.equal(journal.steps[0].status, "planned");

          const stageFile = portablePath(workspaceRoot, stageRef);
          mkdirSync(path.dirname(stageFile), { mode: 0o700, recursive: true });
          writeFileSync(stageFile, payload, { mode: 0o600 });
          chmodSync(stageFile, 0o600);
        },
        observe: async () => stepObservation(workspaceRoot, step),
        commit: async () => {
          assert.ok(journalFile);
          const journal = JSON.parse(readFileSync(journalFile, "utf8"));
          assert.equal(journal.steps[0].status, "prepared");
          assert.ok(journal.checkpoint > 0);
          checkpointAfterPrepare = journal.checkpoint;
          renameSync(
            portablePath(workspaceRoot, stageRef),
            portablePath(workspaceRoot, targetRef),
          );
        },
      },
    },
  });

  assert.ok(checkpointAfterPrepare > 0);
  assert.equal(terminalClosures.length, 2, "terminal closure is re-derived after cleanup");
  assert.deepEqual(terminalClosures[1], terminalClosures[0]);
  assert.equal(readFileSync(portablePath(workspaceRoot, targetRef), "utf8"), payload.toString());
  assert.equal(existsSync(portablePath(workspaceRoot, stageRef)), false);
  assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
  assert.deepEqual(
    readdirSync(protocolPath(workspaceRoot, transactionsRelative)),
    [],
    "terminal checkpoint and exact cleanup remove the success journal",
  );
  assert.equal(
    readdirSync(protocolPath(workspaceRoot, runtimeRelative)).includes("maintenance.success.json"),
    false,
    "healthy operations do not leave a success stamp",
  );
});

test("a failed physical callback is observed into an incomplete journal before the gate is released", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-callback-failure-");
  bootstrapProtocol(workspaceRoot);
  const payload = Buffer.from("prepared but not committed\n");
  const finalRef = ".wakeflow-fixture/callback-failure/final.txt";
  const stageRef = ".wakeflow-fixture/callback-failure/final.stage";
  const step = {
    stepId: "prepare-then-fail",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(finalRef, { type: "absent" }),
    staging: fileContract(stageRef, {
      type: "file",
      mode: "0600",
      digest: sha256(payload),
    }),
    final: fileContract(finalRef, {
      type: "file",
      mode: "0600",
      digest: sha256(payload),
    }),
  };
  const plan = maintenancePlan([step]);

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "reconcile",
      domainOwner: "maintenance-red-test",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => plan,
      deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
      stepHandlers: {
        [step.stepId]: {
          prepare: async () => {
            singleJournalFile(workspaceRoot);
            writeFixtureFile(workspaceRoot, stageRef, payload);
            throw new Error("synthetic owner prepare failure");
          },
          observe: async () => stepObservation(workspaceRoot, step),
          commit: async () => assert.fail("commit cannot follow a failed prepare boundary"),
        },
      },
    }),
    /(?:recovery-required|synthetic owner prepare failure)/iu,
  );

  const journal = JSON.parse(readFileSync(singleJournalFile(workspaceRoot), "utf8"));
  assert.equal(journal.artifactKind, "wakeflow-maintenance-transaction");
  assert.equal(journal.phase, "incomplete");
  assert.equal(journal.ownerDisposition, "relinquished");
  assert.equal(journal.steps[0].status, "prepared");
  assert.equal(existsSync(portablePath(workspaceRoot, finalRef)), false);
  assert.equal(existsSync(portablePath(workspaceRoot, stageRef)), true);
  assert.equal(
    existsSync(protocolPath(workspaceRoot, lockRelative)),
    false,
    "stable incomplete journal, not a live lock, blocks normal admission",
  );
});

test("checkpoint CAS rejects a same-bytes journal inode replacement without deleting it", {
  skip: process.platform === "win32" ? "atomic replacement and POSIX inode identity are required" : false,
}, async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-journal-inode-race-");
  bootstrapProtocol(workspaceRoot);
  const payload = Buffer.from("prepared across a journal inode race\n");
  const finalRef = ".wakeflow-fixture/inode-race/final.txt";
  const stageRef = ".wakeflow-fixture/inode-race/final.stage";
  const step = {
    stepId: "inode-race-create",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(finalRef, { type: "absent" }),
    staging: fileContract(stageRef, {
      type: "file",
      mode: "0600",
      digest: sha256(payload),
    }),
    final: fileContract(finalRef, {
      type: "file",
      mode: "0600",
      digest: sha256(payload),
    }),
  };
  const plan = maintenancePlan([step]);
  let journalFile;
  let replacementIdentity;
  let replacementBytes;

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "reconcile",
      domainOwner: "maintenance-red-test",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => plan,
      deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
      stepHandlers: {
        [step.stepId]: {
          prepare: async () => {
            journalFile = singleJournalFile(workspaceRoot);
            const originalIdentity = lstatSync(journalFile);
            replacementBytes = readFileSync(journalFile);
            const replacement = `${journalFile}.same-bytes-fixture`;
            writeFileSync(replacement, replacementBytes, { flag: "wx", mode: 0o600 });
            chmodSync(replacement, 0o600);
            replacementIdentity = lstatSync(replacement);
            assert.notEqual(String(replacementIdentity.ino), String(originalIdentity.ino));
            renameSync(replacement, journalFile);
            writeFixtureFile(workspaceRoot, stageRef, payload);
          },
          observe: async () => stepObservation(workspaceRoot, step),
          commit: async () => assert.fail("an inode-raced journal cannot reach commit"),
        },
      },
    }),
    /(?:path-race|changed|recovery-required)/iu,
  );

  assert.ok(journalFile);
  const retained = lstatSync(journalFile);
  assert.equal(String(retained.dev), String(replacementIdentity.dev));
  assert.equal(String(retained.ino), String(replacementIdentity.ino));
  assert.deepEqual(readFileSync(journalFile), replacementBytes);
  assert.equal(
    JSON.parse(readFileSync(journalFile, "utf8")).ownerDisposition,
    "active",
    "the manager must not overwrite the replacement to manufacture a releasable checkpoint",
  );
  assertPrivateRegularFile(protocolPath(workspaceRoot, lockRelative));
  assert.equal(existsSync(portablePath(workspaceRoot, stageRef)), true);
  assert.equal(existsSync(portablePath(workspaceRoot, finalRef)), false);
});

test("normal create and audit plans reject preexisting exact staging before journaling", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();

  for (const stepKind of ["create-or-update", "audit-publish"]) {
    await t.test(`${stepKind} preexisting stage is not adopted as this operation's prepare`, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-preexisting-stage-${stepKind}-`);
      bootstrapProtocol(workspaceRoot);
      const prefix = `.wakeflow-fixture/preexisting-${stepKind}`;
      const sourceRef = stepKind === "audit-publish" ? `${prefix}/source.json` : `${prefix}/final.json`;
      const stageRef = `${prefix}/final.stage`;
      const finalRef = `${prefix}/final.json`;
      const sourceBytes = Buffer.from("preserved audit source\n");
      const publishBytes = Buffer.from(`preexisting ${stepKind} stage\n`);
      const step = {
        stepId: `reject-preexisting-${stepKind}`,
        ordinal: 0,
        stepKind,
        source: stepKind === "audit-publish"
          ? fileContract(sourceRef, {
            type: "file",
            mode: "0600",
            digest: sha256(sourceBytes),
          })
          : fileContract(finalRef, { type: "absent" }),
        staging: fileContract(stageRef, {
          type: "file",
          mode: "0600",
          digest: sha256(publishBytes),
        }),
        final: fileContract(finalRef, {
          type: "file",
          mode: "0600",
          digest: sha256(publishBytes),
        }),
      };
      const plan = maintenancePlan([step]);
      if (stepKind === "audit-publish") {
        writeFixtureFile(workspaceRoot, sourceRef, sourceBytes);
      }
      const stageFile = writeFixtureFile(workspaceRoot, stageRef, publishBytes);
      const stageIdentity = lstatSync(stageFile);
      let observations = 0;
      let physicalCallbacks = 0;

      await assert.rejects(
        () => runWakeflowMaintenanceMutation({
          workspaceRoot,
          action: "reconcile",
          operationKind: "reconcile",
          domainOwner: "maintenance-red-test",
          confirmedPlan: plan,
          planDigest: canonicalJsonDigest(plan),
          validatePlan: validateTestPlan,
          deriveCurrentPlan: async () => plan,
          deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
          stepHandlers: {
            [step.stepId]: {
              prepare: async () => { physicalCallbacks += 1; },
              observe: async () => {
                observations += 1;
                assert.deepEqual(
                  readdirSync(protocolPath(workspaceRoot, transactionsRelative)),
                  [],
                  "preexisting staging must be classified before journal creation",
                );
                return stepObservation(workspaceRoot, step);
              },
              commit: async () => { physicalCallbacks += 1; },
            },
          },
        }),
        /(?:preexisting|changed before|manual|artifact|recovery)/iu,
      );

      assert.ok(observations > 0, "the owner observer proves that staging predates this journal");
      assert.equal(physicalCallbacks, 0);
      assert.equal(String(lstatSync(stageFile).ino), String(stageIdentity.ino));
      assert.deepEqual(readFileSync(stageFile), publishBytes);
      assert.equal(existsSync(portablePath(workspaceRoot, finalRef)), false);
      if (stepKind === "audit-publish") {
        assert.deepEqual(readFileSync(portablePath(workspaceRoot, sourceRef)), sourceBytes);
      }
      assertNoMaintenanceResidue(workspaceRoot);
    });
  }
});

test("mutation contexts are frozen, non-serializable capabilities with anti-forgery and expiry", async (t) => {
  const {
    assertWakeflowMutationContext,
    inspectWakeflowWorkspaceMutation,
    withWakeflowRuntimeMutation,
  } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-context-");
  const otherWorkspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-context-other-");
  bootstrapProtocol(workspaceRoot);
  bootstrapProtocol(otherWorkspaceRoot);
  let expiredContext;

  await withWakeflowRuntimeMutation({
    workspaceRoot,
    operationKind: "context-contract",
    domainOwner: "maintenance-red-test",
  }, async (context) => {
    expiredContext = context;
    assert.equal(Object.isFrozen(context), true);
    for (const key of ["operationId", "ownerToken", "recoveryGeneration"]) {
      assert.equal(typeof context[key] === "string" || typeof context[key] === "number", true);
      assert.equal(Object.getOwnPropertyDescriptor(context, key)?.enumerable, false);
    }
    assert.equal(JSON.stringify(context).includes(context.ownerToken), false);
    assertWakeflowMutationContext({
      workspaceRoot,
      context,
      mode: "runtime-mutation",
    });
    assert.throws(
      () => assertWakeflowMutationContext({
        workspaceRoot: otherWorkspaceRoot,
        context,
        mode: "runtime-mutation",
      }),
      /(?:workspace|mismatch|another)/iu,
    );
    assert.throws(
      () => assertWakeflowMutationContext({
        workspaceRoot,
        context,
        mode: "maintenance",
      }),
      /(?:mode|mismatch|differs)/iu,
    );
    assert.throws(
      () => assertWakeflowMutationContext({
        workspaceRoot,
        context,
        mode: "runtime-mutation",
        unknown: true,
      }),
      /(?:unknown|unexpected|contract|key)/iu,
    );

    const forged = {};
    for (const key of ["operationId", "ownerToken", "recoveryGeneration"]) {
      Object.defineProperty(forged, key, {
        value: context[key],
        enumerable: false,
      });
    }
    Object.freeze(forged);
    assert.throws(
      () => assertWakeflowMutationContext({
        workspaceRoot,
        context: forged,
        mode: "runtime-mutation",
      }),
      /(?:context|forg|brand|capability)/iu,
    );

    await assert.rejects(
      () => withWakeflowRuntimeMutation({
        workspaceRoot,
        operationKind: "forbidden-reentrant-runtime",
        domainOwner: "maintenance-red-test",
        acquireTimeoutMs: 50,
      }, async () => assert.fail("reentrant mutation must not enter")),
      /(?:reentrant|nested|context|mutation)/iu,
    );
    await Promise.resolve();
    assertWakeflowMutationContext({
      workspaceRoot,
      context,
      mode: "runtime-mutation",
    });
  });

  assert.throws(
    () => assertWakeflowMutationContext({
      workspaceRoot,
      context: expiredContext,
      mode: "runtime-mutation",
    }),
    /(?:expired|inactive|context|capability)/iu,
  );
  assert.throws(
    () => inspectWakeflowWorkspaceMutation({
      workspaceRoot,
      unknown: true,
    }),
    /(?:unknown|unexpected|contract|key)/iu,
  );
  let unexpectedRuntimeCallback = false;
  await assert.rejects(
    () => withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "unknown-input-rejection",
      domainOwner: "maintenance-red-test",
      unknown: true,
    }, async () => { unexpectedRuntimeCallback = true; }),
    /(?:unknown|unexpected|contract|key)/iu,
  );
  assert.equal(unexpectedRuntimeCallback, false);
});

test("a branded context rejects a same-bytes replacement of its owning lock inode", {
  skip: process.platform === "win32" ? "POSIX inode identity and atomic replacement are required" : false,
}, async (t) => {
  const {
    assertWakeflowMutationContext,
    withWakeflowRuntimeMutation,
  } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-context-lock-race-");
  bootstrapProtocol(workspaceRoot);
  const lockFile = protocolPath(workspaceRoot, lockRelative);
  let replacementSnapshot;

  await assert.rejects(
    () => withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "context-lock-inode-race",
      domainOwner: "maintenance-red-test",
    }, async (context) => {
      assertWakeflowMutationContext({
        workspaceRoot,
        context,
        mode: "runtime-mutation",
      });
      const original = lstatSync(lockFile);
      const bytes = readFileSync(lockFile);
      const replacement = `${lockFile}.same-bytes-fixture`;
      writeFileSync(replacement, bytes, { flag: "wx", mode: 0o600 });
      chmodSync(replacement, 0o600);
      const replacementStat = lstatSync(replacement);
      assert.notEqual(String(replacementStat.ino), String(original.ino));
      renameSync(replacement, lockFile);
      replacementSnapshot = captureExactFixtureFile(lockFile);

      assert.throws(
        () => assertWakeflowMutationContext({
          workspaceRoot,
          context,
          mode: "runtime-mutation",
        }),
        /(?:expired|changed|context|path-race)/iu,
      );
    }),
    /(?:release|recovery-required|changed|owned|path-race)/iu,
  );

  assert.ok(replacementSnapshot);
  assertExactFixtureFileUnchanged(replacementSnapshot);
  assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
});

test("runtime ancestor replacement cannot redirect checkpoint or cleanup outside the workspace", {
  skip: process.platform === "win32" ? "POSIX directory replacement and symlink behavior are required" : false,
}, async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-maintenance-runtime-ancestor-race-");
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-maintenance-runtime-outside-"));
  t.after(() => rmSync(outside, { force: true, recursive: true }));
  bootstrapProtocol(workspaceRoot);
  const outsideTransactions = path.join(outside, "maintenance", "transactions");
  mkdirSync(outsideTransactions, { mode: 0o700, recursive: true });
  const outsideSentinel = path.join(outside, "sentinel.txt");
  const outsideTransactionSentinel = path.join(outsideTransactions, "sentinel.txt");
  writeFileSync(outsideSentinel, "outside-root-sentinel\n", { mode: 0o600 });
  writeFileSync(outsideTransactionSentinel, "outside-transaction-sentinel\n", { mode: 0o600 });

  const payload = Buffer.from("prepared before runtime ancestor replacement\n");
  const finalRef = ".wakeflow-fixture/runtime-ancestor-race/final.txt";
  const stageRef = ".wakeflow-fixture/runtime-ancestor-race/final.stage";
  const step = {
    stepId: "runtime-ancestor-race",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(finalRef, { type: "absent" }),
    staging: fileContract(stageRef, {
      type: "file",
      mode: "0600",
      digest: sha256(payload),
    }),
    final: fileContract(finalRef, {
      type: "file",
      mode: "0600",
      digest: sha256(payload),
    }),
  };
  const plan = maintenancePlan([step]);
  const runtimeRoot = protocolPath(workspaceRoot, runtimeRelative);
  const displacedRuntime = protocolPath(
    workspaceRoot,
    `${localRelative}/runtime.displaced-${randomUUID()}`,
  );
  let prepareCalls = 0;
  let commitCalls = 0;

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "reconcile",
      domainOwner: "maintenance-red-test",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => plan,
      deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
      stepHandlers: {
        [step.stepId]: {
          prepare: async () => {
            prepareCalls += 1;
            writeFixtureFile(workspaceRoot, stageRef, payload);
            renameSync(runtimeRoot, displacedRuntime);
            symlinkSync(outside, runtimeRoot, "dir");
          },
          observe: async () => stepObservation(workspaceRoot, step),
          commit: async () => { commitCalls += 1; },
        },
      },
    }),
    /(?:ancestor|directory|path-race|recovery-required|symlink|changed)/iu,
  );

  assert.equal(prepareCalls, 1);
  assert.equal(commitCalls, 0);
  assert.equal(readFileSync(outsideSentinel, "utf8"), "outside-root-sentinel\n");
  assert.equal(
    readFileSync(outsideTransactionSentinel, "utf8"),
    "outside-transaction-sentinel\n",
  );
  assert.deepEqual(readdirSync(outside).sort(), ["maintenance", "sentinel.txt"]);
  assert.deepEqual(readdirSync(path.join(outside, "maintenance")), ["transactions"]);
  assert.deepEqual(readdirSync(outsideTransactions), ["sentinel.txt"]);
  assertPrivateRegularFile(path.join(displacedRuntime, "maintenance.lock"));
  const displacedJournals = readdirSync(path.join(displacedRuntime, "maintenance", "transactions"));
  assert.equal(displacedJournals.filter((entry) => entry.endsWith(".json")).length, 1);
  assert.equal(existsSync(portablePath(workspaceRoot, finalRef)), false);
  assert.equal(existsSync(portablePath(workspaceRoot, stageRef)), true);
});

function writeFixtureFile(workspaceRoot, ref, bytes, mode = 0o600) {
  const target = portablePath(workspaceRoot, ref);
  mkdirSync(path.dirname(target), { mode: 0o700, recursive: true });
  writeFileSync(target, bytes, { mode });
  chmodSync(target, mode);
  return target;
}

function makeRecoveryFixture(
  workspaceRoot,
  stepKind,
  { illegal = false, processIdentity = null } = {},
) {
  const fixtureOperationId = operationId();
  const prefix = `.wakeflow-fixture/recovery-${stepKind}-${fixtureOperationId}`;
  const oldBytes = Buffer.from(`old ${stepKind}\n`);
  const newBytes = Buffer.from(`new ${stepKind}\n`);
  let step;

  if (stepKind === "create-or-update") {
    const finalRef = `${prefix}/target.txt`;
    const stageRef = `${prefix}/target.stage`;
    step = {
      stepId: "recover-create-or-update",
      ordinal: 0,
      stepKind,
      source: fileContract(finalRef, { type: "absent" }),
      staging: fileContract(stageRef, {
        type: "file",
        mode: "0600",
        digest: sha256(newBytes),
      }),
      final: fileContract(finalRef, {
        type: "file",
        mode: "0600",
        digest: sha256(newBytes),
      }),
    };
    writeFixtureFile(workspaceRoot, finalRef, newBytes);
    if (illegal) writeFixtureFile(workspaceRoot, stageRef, newBytes);
  } else if (stepKind === "remove") {
    const finalRef = `${prefix}/obsolete.txt`;
    const tombstoneRef = `${prefix}/obsolete.tombstone`;
    step = {
      stepId: "recover-remove",
      ordinal: 0,
      stepKind,
      source: fileContract(finalRef, {
        type: "file",
        mode: "0600",
        digest: sha256(oldBytes),
      }),
      staging: fileContract(tombstoneRef, {
        type: "file",
        mode: "0600",
        digest: sha256(oldBytes),
      }),
      final: fileContract(finalRef, { type: "absent" }),
    };
    writeFixtureFile(workspaceRoot, tombstoneRef, oldBytes);
    if (illegal) writeFixtureFile(workspaceRoot, finalRef, oldBytes);
  } else {
    assert.equal(stepKind, "audit-publish");
    const sourceRef = `${prefix}/raw-event.json`;
    const stageRef = `${prefix}/event.stage`;
    const finalRef = `${prefix}/event.json`;
    step = {
      stepId: "recover-audit-publish",
      ordinal: 0,
      stepKind,
      source: fileContract(sourceRef, {
        type: "file",
        mode: "0600",
        digest: sha256(oldBytes),
      }),
      staging: fileContract(stageRef, {
        type: "file",
        mode: "0600",
        digest: sha256(newBytes),
      }),
      final: fileContract(finalRef, {
        type: "file",
        mode: "0600",
        digest: sha256(newBytes),
      }),
    };
    if (!illegal) writeFixtureFile(workspaceRoot, sourceRef, oldBytes);
    writeFixtureFile(workspaceRoot, finalRef, newBytes);
  }

  const plan = maintenancePlan([step]);
  const journal = {
    schemaVersion: 1,
    artifactKind: "wakeflow-maintenance-transaction",
    operationId: fixtureOperationId,
    purpose: "maintenance-apply",
    action: "reconcile",
    operationKind: "reconcile",
    domainOwner: "maintenance-red-test",
    ownerToken: ownerToken(),
    recoveryGeneration: 0,
    processIdentity: processIdentity ?? {
      platform: process.platform,
      pid: 2_147_483_647,
      startIdentity: sha256(`terminated-test-owner:${fixtureOperationId}`),
    },
    ownerDisposition: "active",
    recoveryClaim: null,
    phase: "incomplete",
    plan,
    planDigest: canonicalJsonDigest(plan),
    checkpoint: 1,
    steps: [{ ...step, status: "prepared" }],
    terminalClosure: null,
  };
  const journalFile = path.join(
    protocolPath(workspaceRoot, transactionsRelative),
    `${fixtureOperationId}.json`,
  );
  writeFileSync(journalFile, `${canonicalJson(journal)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(journalFile, 0o600);

  return {
    journal,
    journalFile,
    newBytes,
    oldBytes,
    operationId: fixtureOperationId,
    plan,
    step,
  };
}

function makeRecoveryBoundaryFixture(workspaceRoot, stepKind, boundary, options = {}) {
  assert.ok(
    new Set(["prepared", "uncheckpointed", "committed"]).has(boundary),
    `unsupported recovery boundary fixture: ${boundary}`,
  );
  const fixture = makeRecoveryFixture(workspaceRoot, stepKind, options);
  const { step } = fixture;

  if (boundary === "prepared") {
    if (stepKind === "create-or-update") {
      unlinkSync(portablePath(workspaceRoot, step.final.ref));
      writeFixtureFile(workspaceRoot, step.staging.ref, fixture.newBytes);
    } else if (stepKind === "remove") {
      unlinkSync(portablePath(workspaceRoot, step.staging.ref));
      writeFixtureFile(workspaceRoot, step.final.ref, fixture.oldBytes);
    } else {
      assert.equal(stepKind, "audit-publish");
      unlinkSync(portablePath(workspaceRoot, step.final.ref));
      writeFixtureFile(workspaceRoot, step.staging.ref, fixture.newBytes);
    }
  }

  const recordedStatus = boundary === "committed" ? "committed" : "prepared";
  const journal = {
    ...fixture.journal,
    checkpoint: recordedStatus === "committed" ? 2 : 1,
    steps: [{ ...step, status: recordedStatus }],
  };
  writeFileSync(fixture.journalFile, `${canonicalJson(journal)}\n`, { mode: 0o600 });
  chmodSync(fixture.journalFile, 0o600);
  return { ...fixture, boundary, journal };
}

function commitPreparedRecoveryFixture(workspaceRoot, fixture) {
  const { step } = fixture;
  if (step.stepKind === "remove") {
    renameSync(
      portablePath(workspaceRoot, step.final.ref),
      portablePath(workspaceRoot, step.staging.ref),
    );
    return;
  }
  renameSync(
    portablePath(workspaceRoot, step.staging.ref),
    portablePath(workspaceRoot, step.final.ref),
  );
}

function makeModeRepairRecoveryFixture(workspaceRoot, physicalMode) {
  assert.ok(new Set([0o755, 0o700]).has(physicalMode));
  const fixtureOperationId = operationId();
  const localRoot = protocolPath(workspaceRoot, localRelative);
  const directoryDigest = sha256(`mode-repair-directory:${fixtureOperationId}`);
  chmodSync(localRoot, physicalMode);
  const step = {
    stepId: "recover-local-root-mode",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(localRelative, {
      type: "directory",
      mode: "0755",
      digest: directoryDigest,
    }),
    staging: null,
    final: fileContract(localRelative, {
      type: "directory",
      mode: "0700",
      digest: directoryDigest,
    }),
  };
  const plan = maintenancePlan([step]);
  const journal = {
    schemaVersion: 1,
    artifactKind: "wakeflow-maintenance-transaction",
    operationId: fixtureOperationId,
    purpose: "maintenance-apply",
    action: "explicit-migration",
    operationKind: "explicit-migration",
    domainOwner: "test-migration-manager",
    ownerToken: ownerToken(),
    recoveryGeneration: 0,
    processIdentity: {
      platform: process.platform,
      pid: 2_147_483_647,
      startIdentity: sha256(`terminated-mode-repair-owner:${fixtureOperationId}`),
    },
    ownerDisposition: "active",
    recoveryClaim: null,
    phase: "incomplete",
    plan,
    planDigest: canonicalJsonDigest(plan),
    checkpoint: 1,
    steps: [{ ...step, status: "prepared" }],
    terminalClosure: null,
  };
  const journalFile = protocolPath(
    workspaceRoot,
    `${transactionsRelative}/${fixtureOperationId}.json`,
  );
  writeFileSync(journalFile, `${canonicalJson(journal)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(journalFile, 0o600);

  const observe = () => {
    const snapshot = fileContract(localRelative, {
      type: "directory",
      mode: modeString(lstatSync(localRoot).mode),
      digest: directoryDigest,
    });
    return { source: snapshot, staging: null, final: snapshot };
  };
  const deriveTerminalClosure = ({ planDigest }) => ({
    planDigest,
    closureDigests: [{
      name: "local-root-mode",
      digest: canonicalJsonDigest({ planDigest, final: observe().final }),
    }],
  });
  return {
    deriveTerminalClosure,
    journal,
    journalFile,
    localRoot,
    observe,
    operationId: fixtureOperationId,
    plan,
    step,
  };
}

function makeNullStagingDirectoryRecoveryFixture(
  workspaceRoot,
  { action, ref, sourceMode = null },
) {
  assert.ok(new Set(["fresh-initialize", "reconcile"]).has(action));
  assert.ok(sourceMode === null || sourceMode === "0755");
  const fixtureOperationId = operationId();
  const target = portablePath(workspaceRoot, ref);
  const directoryDigest = sha256(`static-directory-recovery:${fixtureOperationId}`);
  if (sourceMode !== null) {
    mkdirSync(target, { mode: Number.parseInt(sourceMode, 8) });
    chmodSync(target, Number.parseInt(sourceMode, 8));
  }
  const step = {
    stepId: sourceMode === null
      ? "recover-atomic-directory-create"
      : "recover-static-directory-mode",
    ordinal: 0,
    stepKind: "create-or-update",
    source: sourceMode === null
      ? fileContract(ref, { type: "absent" })
      : fileContract(ref, {
        type: "directory",
        mode: sourceMode,
        digest: directoryDigest,
      }),
    staging: null,
    final: fileContract(ref, {
      type: "directory",
      mode: "0700",
      digest: directoryDigest,
    }),
  };
  const plan = maintenancePlan([step]);
  const journal = {
    schemaVersion: 1,
    artifactKind: "wakeflow-maintenance-transaction",
    operationId: fixtureOperationId,
    purpose: "maintenance-apply",
    action,
    operationKind: action === "fresh-initialize"
      ? "static-layout-initialize"
      : "static-layout-reconcile",
    domainOwner: "test-layout-manager",
    ownerToken: ownerToken(),
    recoveryGeneration: 0,
    processIdentity: {
      platform: process.platform,
      pid: 2_147_483_647,
      startIdentity: sha256(`terminated-static-directory-owner:${fixtureOperationId}`),
    },
    ownerDisposition: "active",
    recoveryClaim: null,
    phase: "incomplete",
    plan,
    planDigest: canonicalJsonDigest(plan),
    checkpoint: 1,
    steps: [{ ...step, status: "prepared" }],
    terminalClosure: null,
  };
  const journalFile = protocolPath(
    workspaceRoot,
    `${transactionsRelative}/${fixtureOperationId}.json`,
  );
  writeFileSync(journalFile, `${canonicalJson(journal)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(journalFile, 0o600);
  return {
    action,
    deriveTerminalClosure: nullStagingDirectoryClosure(workspaceRoot),
    journal,
    journalFile,
    operationId: fixtureOperationId,
    plan,
    step,
    target,
  };
}

function portableFileArtifact(workspaceRoot, ref) {
  const target = portablePath(workspaceRoot, ref);
  const stat = lstatSync(target);
  assert.equal(stat.isFile(), true);
  return {
    type: "file",
    ref,
    mode: modeString(stat.mode),
    digest: sha256(readFileSync(target)),
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
    linkCount: stat.nlink,
  };
}

function absentArtifact(ref) {
  return { type: "absent", ref };
}

function writeCanonicalPrivateFile(workspaceRoot, ref, value) {
  const bytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  const target = portablePath(workspaceRoot, ref);
  writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
  chmodSync(target, 0o600);
  return { bytes, target };
}

function seedGenerationZeroMaintenanceGate(workspaceRoot, fixture) {
  assert.equal(fixture.journal.recoveryGeneration, 0);
  assert.equal(fixture.journal.recoveryClaim, null);
  assert.equal(fixture.journal.ownerDisposition, "active");
  const lock = {
    schemaVersion: 1,
    artifactKind: "wakeflow-workspace-mutation-lock",
    operationId: fixture.operationId,
    mode: "maintenance",
    operationKind: fixture.journal.operationKind,
    domainOwner: fixture.journal.domainOwner,
    ownerToken: fixture.journal.ownerToken,
    recoveryGeneration: 0,
    processIdentity: fixture.journal.processIdentity,
    recoveryClaim: null,
    acquiredAt: "2026-08-08T00:00:00.000Z",
  };
  const { bytes, target: lockFile } = writeCanonicalPrivateFile(
    workspaceRoot,
    lockRelative,
    lock,
  );
  assertPrivateRegularFile(lockFile);
  return { bytes, lock, lockFile };
}

function seedClaimLockOldJournalTransition(workspaceRoot, fixture) {
  const generation = 1;
  const claimRef = `${transactionsRelative}/${fixture.operationId}.recovery-${generation}.json`;
  const previousClaimRef = `${transactionsRelative}/${fixture.operationId}.recovery-0.json`;
  const nextToken = ownerToken();
  const nextProcessIdentity = {
    platform: process.platform,
    pid: 2_147_483_646,
    startIdentity: sha256(`terminated-recovery-owner:${fixture.operationId}`),
  };
  const acquiredAt = "2026-08-07T00:00:00.000Z";
  const claim = {
    schemaVersion: 1,
    artifactKind: "wakeflow-workspace-recovery-claim",
    operationId: fixture.operationId,
    recoveryGeneration: generation,
    planDigest: fixture.journal.planDigest,
    previousOwner: {
      mode: "maintenance",
      operationKind: fixture.journal.operationKind,
      domainOwner: fixture.journal.domainOwner,
      ownerTokenDigest: sha256(fixture.journal.ownerToken),
      recoveryGeneration: fixture.journal.recoveryGeneration,
      processIdentity: fixture.journal.processIdentity,
      ownerDisposition: fixture.journal.ownerDisposition,
    },
    nextOwner: {
      mode: "recovery-cleanup",
      operationKind: fixture.journal.operationKind,
      domainOwner: fixture.journal.domainOwner,
      ownerToken: nextToken,
      recoveryGeneration: generation,
      processIdentity: nextProcessIdentity,
      acquiredAt,
    },
    previousJournal: portableFileArtifact(
      workspaceRoot,
      `${transactionsRelative}/${fixture.operationId}.json`,
    ),
    previousLock: absentArtifact(lockRelative),
    previousClaim: absentArtifact(previousClaimRef),
    createdAt: acquiredAt,
  };
  const { target: claimFile } = writeCanonicalPrivateFile(workspaceRoot, claimRef, claim);
  const claimDigest = canonicalJsonDigest(claim);
  const lock = {
    schemaVersion: 1,
    artifactKind: "wakeflow-workspace-mutation-lock",
    operationId: fixture.operationId,
    mode: "recovery-cleanup",
    operationKind: fixture.journal.operationKind,
    domainOwner: fixture.journal.domainOwner,
    ownerToken: nextToken,
    recoveryGeneration: generation,
    processIdentity: nextProcessIdentity,
    recoveryClaim: {
      ref: claimRef,
      generation,
      digest: claimDigest,
    },
    acquiredAt,
  };
  const { target: lockFile } = writeCanonicalPrivateFile(workspaceRoot, lockRelative, lock);
  return { claim, claimFile, lock, lockFile };
}

function assertRecoveredFixture(workspaceRoot, fixture, stepKind) {
  const { step, newBytes, oldBytes } = fixture;
  if (stepKind === "create-or-update") {
    assert.equal(
      readFileSync(portablePath(workspaceRoot, step.final.ref), "utf8"),
      newBytes.toString(),
    );
    assert.equal(existsSync(portablePath(workspaceRoot, step.staging.ref)), false);
    return;
  }
  if (stepKind === "remove") {
    assert.equal(existsSync(portablePath(workspaceRoot, step.final.ref)), false);
    assert.equal(
      existsSync(portablePath(workspaceRoot, step.staging.ref)),
      false,
      "terminal remove recovery cleans the exact tombstone",
    );
    return;
  }
  assert.equal(
    readFileSync(portablePath(workspaceRoot, step.source.ref), "utf8"),
    oldBytes.toString(),
  );
  assert.equal(
    readFileSync(portablePath(workspaceRoot, step.final.ref), "utf8"),
    newBytes.toString(),
  );
  assert.equal(existsSync(portablePath(workspaceRoot, step.staging.ref)), false);
}

test("recovery classifies each step matrix forward and rejects each illegal artifact combination", async (t) => {
  const { recoverWakeflowWorkspaceMutation } = await mutationManager();

  for (const stepKind of ["create-or-update", "remove", "audit-publish"]) {
    for (const boundary of ["prepared", "uncheckpointed", "committed"]) {
      await t.test(`${stepKind}: ${boundary} recovery advances exactly once`, async (t) => {
        const workspaceRoot = withTempWorkspace(
          t,
          `wakeflow-recovery-${stepKind}-${boundary}-`,
        );
        bootstrapProtocol(workspaceRoot);
        const fixture = makeRecoveryBoundaryFixture(workspaceRoot, stepKind, boundary);
        let observations = 0;
        let prepareCalls = 0;
        let commitCalls = 0;
        let cleanupCalls = 0;
        let recoveryClaimObserved = false;

        await recoverWakeflowWorkspaceMutation({
          workspaceRoot,
          operationId: fixture.operationId,
          confirmedPlan: fixture.plan,
          planDigest: canonicalJsonDigest(fixture.plan),
          validatePlan: validateTestPlan,
          deriveCurrentPlan: async () => fixture.plan,
          deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
          stepHandlers: {
            [fixture.step.stepId]: {
              observe: async () => {
                observations += 1;
                const claims = recoveryClaimFiles(workspaceRoot, fixture.operationId);
                assert.equal(claims.length, 1);
                assertPrivateRegularFile(claims[0]);
                recoveryClaimObserved = true;
                return stepObservation(workspaceRoot, fixture.step);
              },
              prepare: async () => { prepareCalls += 1; },
              commit: async () => {
                commitCalls += 1;
                assert.equal(boundary, "prepared", "only prepared physical state may commit");
                commitPreparedRecoveryFixture(workspaceRoot, fixture);
              },
              ...(stepKind === "remove" ? {
                cleanup: async () => {
                  cleanupCalls += 1;
                  assert.deepEqual(
                    observeRef(workspaceRoot, fixture.step.staging),
                    fixture.step.staging,
                  );
                  unlinkSync(portablePath(workspaceRoot, fixture.step.staging.ref));
                },
              } : {}),
            },
          },
        });

        assert.ok(observations > 0, "recovery uses the owner-provided strict observer");
        assert.equal(recoveryClaimObserved, true, "recovery observes under a durable generation claim");
        assert.equal(prepareCalls, 0, "a prepared-or-later journal never repeats prepare");
        assert.equal(commitCalls, boundary === "prepared" ? 1 : 0);
        assert.equal(cleanupCalls, stepKind === "remove" ? 1 : 0);
        assertRecoveredFixture(workspaceRoot, fixture, stepKind);
        assert.equal(existsSync(fixture.journalFile), false);
        assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
        assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
      });
    }

    await t.test(`${stepKind}: impossible artifact combination is manual-recovery`, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-recovery-illegal-${stepKind}-`);
      bootstrapProtocol(workspaceRoot);
      const fixture = makeRecoveryFixture(workspaceRoot, stepKind, { illegal: true });
      const before = stepObservation(workspaceRoot, fixture.step);
      let recoveryClaimObserved = false;

      await assert.rejects(
        () => recoverWakeflowWorkspaceMutation({
          workspaceRoot,
          operationId: fixture.operationId,
          confirmedPlan: fixture.plan,
          planDigest: canonicalJsonDigest(fixture.plan),
          validatePlan: validateTestPlan,
          deriveCurrentPlan: async () => fixture.plan,
          deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
          stepHandlers: {
            [fixture.step.stepId]: {
              observe: async () => {
                const claims = recoveryClaimFiles(workspaceRoot, fixture.operationId);
                assert.equal(claims.length, 1);
                assertPrivateRegularFile(claims[0]);
                recoveryClaimObserved = true;
                return stepObservation(workspaceRoot, fixture.step);
              },
              prepare: async () => assert.fail("illegal recovery must not prepare"),
              commit: async () => assert.fail("illegal recovery must not commit"),
              ...(stepKind === "remove" ? {
                cleanup: async () => assert.fail("illegal remove recovery must not clean up"),
              } : {}),
            },
          },
        }),
        (error) => {
          assert.match(
            String(error?.code ?? error?.message),
            /(?:manual|illegal|artifact|recovery)/iu,
          );
          return true;
        },
      );

      assert.equal(existsSync(fixture.journalFile), true, "manual recovery retains evidence");
      const retained = JSON.parse(readFileSync(fixture.journalFile, "utf8"));
      assert.equal(retained.operationId, fixture.operationId);
      assert.equal(retained.phase, "incomplete");
      assert.deepEqual(stepObservation(workspaceRoot, fixture.step), before);
      assert.equal(recoveryClaimObserved, true);
      assert.equal(
        recoveryClaimFiles(workspaceRoot, fixture.operationId).length,
        1,
        "manual recovery retains the exact generation claim with its evidence",
      );
    });
  }
});

test("recovery never adopts a committed physical state from a planned journal", async (t) => {
  const { recoverWakeflowWorkspaceMutation } = await mutationManager();

  for (const stepKind of ["create-or-update", "remove", "audit-publish"]) {
    await t.test(`${stepKind}: planned plus committed is manual-recovery`, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-planned-committed-${stepKind}-`);
      bootstrapProtocol(workspaceRoot);
      const fixture = makeRecoveryFixture(workspaceRoot, stepKind);
      const plannedJournal = {
        ...fixture.journal,
        checkpoint: 0,
        steps: [{ ...fixture.step, status: "planned" }],
      };
      writeFileSync(fixture.journalFile, `${canonicalJson(plannedJournal)}\n`, { mode: 0o600 });
      chmodSync(fixture.journalFile, 0o600);
      const physicalBefore = stepObservation(workspaceRoot, fixture.step);
      let observeCalls = 0;

      await assert.rejects(
        () => recoverWakeflowWorkspaceMutation({
          workspaceRoot,
          operationId: fixture.operationId,
          confirmedPlan: fixture.plan,
          planDigest: canonicalJsonDigest(fixture.plan),
          validatePlan: validateTestPlan,
          deriveCurrentPlan: async () => fixture.plan,
          deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
          stepHandlers: {
            [fixture.step.stepId]: {
              observe: async () => {
                observeCalls += 1;
                return stepObservation(workspaceRoot, fixture.step);
              },
              prepare: async () => assert.fail("planned+committed recovery must not prepare"),
              commit: async () => assert.fail("planned+committed recovery must not commit"),
              ...(stepKind === "remove" ? {
                cleanup: async () => assert.fail("planned+committed recovery must not clean up"),
              } : {}),
            },
          },
        }),
        /(?:manual|planned|committed|boundary|recovery)/iu,
      );

      assert.ok(observeCalls > 0);
      assert.deepEqual(stepObservation(workspaceRoot, fixture.step), physicalBefore);
      const retained = JSON.parse(readFileSync(fixture.journalFile, "utf8"));
      assert.equal(retained.phase, "incomplete");
      assert.equal(retained.steps[0].status, "planned");
      assert.equal(
        retained.ownerDisposition,
        "relinquished",
        "the failed recovery owner must durably relinquish before releasing its successor gate",
      );
      assert.equal(
        existsSync(protocolPath(workspaceRoot, lockRelative)),
        false,
        "a safely relinquished incomplete recovery leaves no live gate that would block a same-process retry",
      );
      assert.equal(recoveryClaimFiles(workspaceRoot, fixture.operationId).length, 1);
    });
  }
});

test("successive relinquished recovery owners preserve one recoverable claim chain", async (t) => {
  const { recoverWakeflowWorkspaceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-recovery-relinquished-chain-");
  bootstrapProtocol(workspaceRoot);
  const fixture = makeRecoveryBoundaryFixture(
    workspaceRoot,
    "create-or-update",
    "committed",
  );

  for (const expectedGeneration of [1, 2]) {
    let deriveCalls = 0;
    await assert.rejects(
      () => recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId: fixture.operationId,
        confirmedPlan: fixture.plan,
        planDigest: canonicalJsonDigest(fixture.plan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => {
          deriveCalls += 1;
          if (deriveCalls === 2) throw new Error("synthetic post-claim owner drift");
          return fixture.plan;
        },
        deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
        stepHandlers: {
          [fixture.step.stepId]: {
            observe: async () => stepObservation(workspaceRoot, fixture.step),
            prepare: async () => assert.fail("committed recovery must not prepare"),
            commit: async () => assert.fail("committed recovery must not commit"),
          },
        },
      }),
      /(?:recovery|required|derive|drift)/iu,
    );
    assert.equal(deriveCalls, 2);
    const journal = JSON.parse(readFileSync(fixture.journalFile, "utf8"));
    assert.equal(journal.ownerDisposition, "relinquished");
    assert.equal(journal.recoveryGeneration, expectedGeneration);
    assert.equal(
      recoveryClaimFiles(workspaceRoot, fixture.operationId).length,
      expectedGeneration,
    );
  }

  const recovered = await recoverWakeflowWorkspaceMutation({
    workspaceRoot,
    operationId: fixture.operationId,
    confirmedPlan: fixture.plan,
    planDigest: canonicalJsonDigest(fixture.plan),
    validatePlan: validateTestPlan,
    deriveCurrentPlan: async () => fixture.plan,
    deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
    stepHandlers: {
      [fixture.step.stepId]: {
        observe: async () => stepObservation(workspaceRoot, fixture.step),
        prepare: async () => assert.fail("committed recovery must not prepare"),
        commit: async () => assert.fail("committed recovery must not commit"),
      },
    },
  });

  assert.equal(recovered.status, "recovered");
  assert.equal(recovered.recoveryGeneration, 3);
  assertRecoveredFixture(workspaceRoot, fixture, "create-or-update");
  assertNoMaintenanceResidue(workspaceRoot);
});

test("a normal prepare callback that crosses commit retains its planned journal and exact gate", async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-normal-prepare-crosses-commit-");
  bootstrapProtocol(workspaceRoot);
  const bytes = Buffer.from("prepare illegally crossed the commit boundary\n");
  const finalRef = ".wakeflow-fixture/overstep/final.txt";
  const stagingRef = ".wakeflow-fixture/overstep/final.stage";
  const step = {
    stepId: "prepare-crosses-commit",
    ordinal: 0,
    stepKind: "create-or-update",
    source: fileContract(finalRef, { type: "absent" }),
    staging: fileContract(stagingRef, {
      type: "file",
      mode: "0600",
      digest: sha256(bytes),
    }),
    final: fileContract(finalRef, {
      type: "file",
      mode: "0600",
      digest: sha256(bytes),
    }),
  };
  const plan = maintenancePlan([step]);
  let prepareCalls = 0;
  let commitCalls = 0;

  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "reconcile",
      domainOwner: "maintenance-red-test",
      confirmedPlan: plan,
      planDigest: canonicalJsonDigest(plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => plan,
      deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
      stepHandlers: {
        [step.stepId]: {
          observe: async () => stepObservation(workspaceRoot, step),
          prepare: async () => {
            prepareCalls += 1;
            writeFixtureFile(workspaceRoot, finalRef, bytes);
          },
          commit: async () => { commitCalls += 1; },
        },
      },
    }),
    /(?:manual|prepare|boundary|recovery|required)/iu,
  );

  assert.equal(prepareCalls, 1);
  assert.equal(commitCalls, 0);
  assert.equal(existsSync(portablePath(workspaceRoot, finalRef)), true);
  assert.equal(existsSync(portablePath(workspaceRoot, stagingRef)), false);
  const retained = JSON.parse(readFileSync(singleJournalFile(workspaceRoot), "utf8"));
  assert.equal(retained.phase, "incomplete");
  assert.equal(retained.ownerDisposition, "active");
  assert.equal(retained.checkpoint, 0);
  assert.equal(retained.steps[0].status, "planned");
  assertPrivateRegularFile(protocolPath(workspaceRoot, lockRelative));
});

test("explicit-migration mode repair recovers old-mode prepare and new-mode uncheckpointed commit", async (t) => {
  const { recoverWakeflowWorkspaceMutation } = await mutationManager();

  for (const scenario of [
    { name: "old-mode-prepared", physicalMode: 0o755, expectedCommits: 1 },
    { name: "new-mode-uncheckpointed", physicalMode: 0o700, expectedCommits: 0 },
  ]) {
    await t.test(scenario.name, {
      skip: process.platform === "win32" ? "POSIX mode recovery is required" : false,
    }, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-recovery-${scenario.name}-`);
      bootstrapProtocol(workspaceRoot);
      const fixture = makeModeRepairRecoveryFixture(workspaceRoot, scenario.physicalMode);
      let prepareCalls = 0;
      let commitCalls = 0;

      await recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId: fixture.operationId,
        confirmedPlan: fixture.plan,
        planDigest: canonicalJsonDigest(fixture.plan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => fixture.plan,
        deriveTerminalClosure: fixture.deriveTerminalClosure,
        stepHandlers: {
          [fixture.step.stepId]: {
            observe: async () => fixture.observe(),
            prepare: async () => { prepareCalls += 1; },
            commit: async () => {
              commitCalls += 1;
              chmodSync(fixture.localRoot, 0o700);
            },
          },
        },
      });

      assert.equal(prepareCalls, 0, "a prepared journal never repeats mode-repair prepare");
      assert.equal(commitCalls, scenario.expectedCommits);
      assert.equal(lstatSync(fixture.localRoot).mode & 0o777, 0o700);
      assertNoMaintenanceResidue(workspaceRoot);
    });
  }
});

test("prepared null-staging directory steps recover by committing exactly once", {
  skip: !new Set(["darwin", "linux"]).has(process.platform)
    ? "production recovery process identity supports Darwin and Linux"
    : false,
}, async (t) => {
  const {
    assertWakeflowMutationContext,
    recoverWakeflowWorkspaceMutation,
  } = await mutationManager();
  const staticRef = `${runtimeRelative}/shared`;

  for (const scenario of [
    { name: "atomic-directory-create", action: "fresh-initialize", sourceMode: null },
    { name: "safe-directory-mode-repair", action: "reconcile", sourceMode: "0755" },
  ]) {
    await t.test(scenario.name, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-recover-${scenario.name}-`);
      bootstrapProtocol(workspaceRoot);
      const fixture = makeNullStagingDirectoryRecoveryFixture(workspaceRoot, {
        action: scenario.action,
        ref: staticRef,
        sourceMode: scenario.sourceMode,
      });
      let readOnlyDerivations = 0;
      let fencedDerivations = 0;
      let prepareCalls = 0;
      let commitCalls = 0;

      await recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId: fixture.operationId,
        confirmedPlan: fixture.plan,
        planDigest: canonicalJsonDigest(fixture.plan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async ({ context }) => {
          if (context === null) {
            readOnlyDerivations += 1;
          } else {
            fencedDerivations += 1;
            assertWakeflowMutationContext({
              workspaceRoot,
              context,
              mode: "recovery-cleanup",
            });
          }
          return fixture.plan;
        },
        deriveTerminalClosure: async ({ context, ...input }) => {
          assertWakeflowMutationContext({
            workspaceRoot,
            context,
            mode: "recovery-cleanup",
          });
          return fixture.deriveTerminalClosure(input);
        },
        stepHandlers: {
          [fixture.step.stepId]: {
            observe: async ({ context }) => {
              assertWakeflowMutationContext({
                workspaceRoot,
                context,
                mode: "recovery-cleanup",
              });
              return nullStagingDirectoryObservation(workspaceRoot, fixture.step);
            },
            prepare: async () => {
              prepareCalls += 1;
              assert.fail("a prepared null-staging step must never repeat prepare");
            },
            commit: async ({ context }) => {
              commitCalls += 1;
              assertWakeflowMutationContext({
                workspaceRoot,
                context,
                mode: "recovery-cleanup",
              });
              if (scenario.sourceMode === null) {
                mkdirSync(fixture.target, { mode: 0o700 });
              } else {
                chmodSync(fixture.target, 0o700);
              }
              chmodSync(fixture.target, 0o700);
            },
          },
        },
      });

      assert.equal(readOnlyDerivations, 1, "recovery proves the plan once before takeover");
      assert.equal(fencedDerivations, 1, "recovery re-proves the plan under its successor gate");
      assert.equal(prepareCalls, 0);
      assert.equal(commitCalls, 1);
      assertPrivateDirectory(fixture.target);
      assertNoMaintenanceResidue(workspaceRoot);
    });
  }
});

test("recovery arbitration binds a PID to its exact platform process-start identity", {
  skip: !new Set(["darwin", "linux"]).has(process.platform)
    ? "the production process-identity contract supports Darwin and Linux"
    : false,
}, async (t) => {
  const { recoverWakeflowWorkspaceMutation } = await mutationManager();

  await t.test("a live PID with a different same-platform start identity is recoverable", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-reused-process-identity-");
    bootstrapProtocol(workspaceRoot);
    const recordedIdentity = {
      platform: process.platform,
      pid: process.pid,
      startIdentity: sha256(`deliberately-not-this-process:${randomUUID()}`),
    };
    const fixture = makeRecoveryBoundaryFixture(
      workspaceRoot,
      "create-or-update",
      "committed",
      { processIdentity: recordedIdentity },
    );
    seedGenerationZeroMaintenanceGate(workspaceRoot, fixture);
    let deriveCalls = 0;
    let claimObserved = false;

    await recoverWakeflowWorkspaceMutation({
      workspaceRoot,
      operationId: fixture.operationId,
      confirmedPlan: fixture.plan,
      planDigest: canonicalJsonDigest(fixture.plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => {
        deriveCalls += 1;
        return fixture.plan;
      },
      deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
      stepHandlers: {
        [fixture.step.stepId]: {
          observe: async () => {
            const claims = recoveryClaimFiles(workspaceRoot, fixture.operationId);
            assert.equal(claims.length, 1, "the reused identity is claimed before domain recovery");
            assertPrivateRegularFile(claims[0]);
            claimObserved = true;
            return stepObservation(workspaceRoot, fixture.step);
          },
          prepare: async () => assert.fail("committed recovery must not repeat prepare"),
          commit: async () => assert.fail("committed recovery must not repeat commit"),
        },
      },
    });

    assert.equal(deriveCalls, 2, "recovery proves the same plan before and after takeover");
    assert.equal(claimObserved, true);
    assertRecoveredFixture(workspaceRoot, fixture, "create-or-update");
    assertNoMaintenanceResidue(workspaceRoot);
  });

  await t.test("an opposite-platform owner is unverifiable before claim or plan derivation", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-unverifiable-process-identity-");
    bootstrapProtocol(workspaceRoot);
    const recordedIdentity = {
      platform: process.platform === "darwin" ? "linux" : "darwin",
      pid: process.pid,
      startIdentity: sha256(`opposite-platform-process:${randomUUID()}`),
    };
    const fixture = makeRecoveryBoundaryFixture(
      workspaceRoot,
      "create-or-update",
      "committed",
      { processIdentity: recordedIdentity },
    );
    seedGenerationZeroMaintenanceGate(workspaceRoot, fixture);
    const evidenceBefore = captureMutationEvidence(workspaceRoot);
    let deriveCalls = 0;
    let observeCalls = 0;

    await assert.rejects(
      () => recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId: fixture.operationId,
        confirmedPlan: fixture.plan,
        planDigest: canonicalJsonDigest(fixture.plan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => {
          deriveCalls += 1;
          return fixture.plan;
        },
        deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
        stepHandlers: {
          [fixture.step.stepId]: {
            observe: async () => {
              observeCalls += 1;
              return stepObservation(workspaceRoot, fixture.step);
            },
            prepare: async () => assert.fail("unverifiable ownership must not prepare"),
            commit: async () => assert.fail("unverifiable ownership must not commit"),
          },
        },
      }),
      /(?:manual|unverifiable|verified|process|owner|recovery)/iu,
    );

    assert.equal(deriveCalls, 0, "ownership arbitration precedes recovery plan derivation");
    assert.equal(observeCalls, 0, "ownership arbitration precedes domain observation");
    assert.deepEqual(recoveryClaimFiles(workspaceRoot, fixture.operationId), []);
    assertMutationEvidenceUnchanged(workspaceRoot, evidenceBefore);
  });
});

test("recovery generations admit one claimant and resume claim plus successor-lock crash state", async (t) => {
  const { recoverWakeflowWorkspaceMutation } = await mutationManager();

  await t.test("claim + generation-1 successor lock + generation-0 journal advances safely", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-recovery-transition-");
    bootstrapProtocol(workspaceRoot);
    const fixture = makeRecoveryFixture(workspaceRoot, "create-or-update");
    const transition = seedClaimLockOldJournalTransition(workspaceRoot, fixture);
    let activeGenerationJournalChecks = 0;

    assertPrivateRegularFile(transition.claimFile);
    assertPrivateRegularFile(transition.lockFile);
    assert.equal(JSON.parse(readFileSync(transition.lockFile, "utf8")).recoveryGeneration, 1);
    assert.equal(JSON.parse(readFileSync(fixture.journalFile, "utf8")).recoveryGeneration, 0);

    await recoverWakeflowWorkspaceMutation({
      workspaceRoot,
      operationId: fixture.operationId,
      confirmedPlan: fixture.plan,
      planDigest: canonicalJsonDigest(fixture.plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => fixture.plan,
      deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot, {
        onDerive: () => {
          const journal = JSON.parse(readFileSync(fixture.journalFile, "utf8"));
          assert.equal(journal.ownerDisposition, "active");
          assert.equal(journal.recoveryGeneration, 2);
          activeGenerationJournalChecks += 1;
        },
      }),
      stepHandlers: {
        [fixture.step.stepId]: {
          observe: async () => stepObservation(workspaceRoot, fixture.step),
          prepare: async () => assert.fail("observed committed bytes must not be prepared again"),
          commit: async () => assert.fail("observed committed bytes must not be committed again"),
        },
      },
    });

    assertRecoveredFixture(workspaceRoot, fixture, "create-or-update");
    assert.equal(activeGenerationJournalChecks, 2);
    assert.equal(existsSync(transition.claimFile), false);
    assert.equal(existsSync(fixture.journalFile), false);
    assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
    assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
  });

  await t.test("two generation-1 contenders produce exactly one recovery winner", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-recovery-race-");
    bootstrapProtocol(workspaceRoot);
    const fixture = makeRecoveryFixture(workspaceRoot, "create-or-update");
    const childSource = `
      import { createHash } from "node:crypto";
      import { existsSync, lstatSync, readFileSync } from "node:fs";
      import path from "node:path";
      import { canonicalJsonDigest } from ${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-canonical-json.mjs")).href)};
      import { recoverWakeflowWorkspaceMutation } from ${JSON.stringify(managerUrl)};
      const [workspaceRoot, operationId, planJson, stepJson] = process.argv.slice(1);
      const plan = JSON.parse(planJson);
      const step = JSON.parse(stepJson);
      const validatePlan = async (input) => {
        if (!input || typeof input !== "object" || Array.isArray(input)
          || Object.keys(input).join(",") !== "plan" || !Object.hasOwn(input, "plan")) {
          throw new Error("invalid test plan validation input");
        }
        const candidate = input.plan;
        if (!Object.hasOwn(candidate, "schemaId") || !Object.hasOwn(candidate, "payload")
          || Object.keys(candidate).sort().join(",") !== "payload,schemaId"
          || candidate.schemaId !== "urn:wakeflow:internal:test-maintenance-plan:v1"
          || !Object.hasOwn(candidate.payload, "steps")
          || !Array.isArray(candidate.payload.steps)) {
          throw new Error("invalid test maintenance plan");
        }
        return { valid: true };
      };
      const observe = (contract) => {
        const target = path.resolve(workspaceRoot, ...contract.ref.split("/"));
        if (!existsSync(target)) return { ref: contract.ref, type: "absent" };
        const stat = lstatSync(target);
        const mode = "0" + (stat.mode & 0o777).toString(8).padStart(3, "0");
        return {
          ref: contract.ref,
          type: stat.isDirectory() ? "directory" : "file",
          mode,
          digest: stat.isDirectory()
            ? contract.digest
            : "sha256:" + createHash("sha256").update(readFileSync(target)).digest("hex"),
        };
      };
      const deriveTerminalClosure = ({ plan: currentPlan }) => {
        const planDigest = canonicalJsonDigest(currentPlan);
        return {
          planDigest,
          closureDigests: [{
            name: "test-domain-closure-" + step.ordinal,
            digest: canonicalJsonDigest({
              planDigest,
              domain: "synthetic",
              stepId: step.stepId,
              stepKind: step.stepKind,
              resources: { final: observe(step.final) },
            }),
          }],
        };
      };
      try {
        await recoverWakeflowWorkspaceMutation({
          workspaceRoot,
          operationId,
          confirmedPlan: plan,
          planDigest: canonicalJsonDigest(plan),
          validatePlan,
          deriveCurrentPlan: async () => plan,
          deriveTerminalClosure,
          stepHandlers: {
            [step.stepId]: {
              observe: async () => {
                await new Promise((resolve) => setTimeout(resolve, 120));
                return {
                  source: observe(step.source),
                  staging: observe(step.staging),
                  final: observe(step.final),
                };
              },
              prepare: async () => { throw new Error("unexpected prepare"); },
              commit: async () => { throw new Error("unexpected commit"); },
            },
          },
        });
        process.stdout.write("winner");
      } catch (error) {
        process.stderr.write(String(error?.code ?? error?.message ?? error));
        process.exitCode = 3;
      }
    `;
    const args = [
      workspaceRoot,
      fixture.operationId,
      JSON.stringify(fixture.plan),
      JSON.stringify(fixture.step),
    ];
    const contenders = [spawnModuleChild(childSource, args), spawnModuleChild(childSource, args)];
    for (const contender of contenders) {
      t.after(() => {
        if (contender.exitCode === null && contender.signalCode === null) contender.kill("SIGKILL");
      });
    }
    const results = await Promise.all(contenders.map((contender) => collectChild(contender)));

    assert.deepEqual(results.map(({ code }) => code).sort(), [0, 3]);
    assert.equal(results.filter(({ stdout }) => stdout === "winner").length, 1);
    const loser = results.find(({ code }) => code === 3);
    assert.match(loser.stderr, /(?:claim|recovery|busy|journal|not-found)/iu);
    assertRecoveredFixture(workspaceRoot, fixture, "create-or-update");
    assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
    assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
  });
});

function captureExactFixtureFile(target) {
  const stat = lstatSync(target);
  return {
    target,
    bytes: readFileSync(target),
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
    mode: stat.mode & 0o777,
    linkCount: stat.nlink,
  };
}

function assertExactFixtureFileUnchanged(snapshot) {
  const current = lstatSync(snapshot.target);
  assert.equal(String(current.dev), snapshot.deviceId);
  assert.equal(String(current.ino), snapshot.inodeId);
  assert.equal(current.mode & 0o777, snapshot.mode);
  assert.equal(current.nlink, snapshot.linkCount);
  assert.deepEqual(readFileSync(snapshot.target), snapshot.bytes);
}

function captureMutationEvidence(workspaceRoot) {
  const transactionRoot = protocolPath(workspaceRoot, transactionsRelative);
  const targets = readdirSync(transactionRoot)
    .sort()
    .map((entry) => path.join(transactionRoot, entry));
  if (existsSync(protocolPath(workspaceRoot, lockRelative))) {
    targets.push(protocolPath(workspaceRoot, lockRelative));
  }
  return targets.map(captureExactFixtureFile);
}

function assertMutationEvidenceUnchanged(workspaceRoot, snapshots) {
  const currentTargets = captureMutationEvidence(workspaceRoot).map(({ target }) => target).sort();
  assert.deepEqual(currentTargets, snapshots.map(({ target }) => target).sort());
  for (const snapshot of snapshots) assertExactFixtureFileUnchanged(snapshot);
}

function replacePrivateJsonFixture(target, value) {
  const replacement = `${target}.fixture-replacement-${randomUUID()}`;
  writeFileSync(replacement, `${canonicalJson(value)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(replacement, 0o600);
  renameSync(replacement, target);
}

function lockOnlyCleanupCrashChildSource() {
  return `
    import { randomUUID } from "node:crypto";
    import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
    import path from "node:path";
    import { canonicalJsonDigest } from ${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-canonical-json.mjs")).href)};
    import { withWakeflowRuntimeMutation } from ${JSON.stringify(managerUrl)};
    const [workspaceRoot, markerFile] = process.argv.slice(1);
    const plan = {
      schemaId: "urn:wakeflow:internal:test-maintenance-plan:v1",
      payload: { steps: [] },
    };
    const planDigest = canonicalJsonDigest(plan);
    const validatePlan = async ({ plan: candidate }) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
        || Object.keys(candidate).sort().join(",") !== "payload,schemaId"
        || candidate.schemaId !== plan.schemaId
        || !candidate.payload || !Array.isArray(candidate.payload.steps)) {
        throw new Error("invalid child recovery plan");
      }
      return { valid: true };
    };
    try {
      await withWakeflowRuntimeMutation({
        workspaceRoot,
        operationKind: "dead-lock-only-cleanup-fixture",
        domainOwner: "maintenance-red-test",
        validateRecoveryPlan: validatePlan,
        onCallbackFailure: async ({ phase }) => {
          if (phase === "before-gate-release") {
            const lockFile = path.join(workspaceRoot, ".wakeflow-local", "runtime", "maintenance.lock");
            const replacement = lockFile + ".same-bytes-" + randomUUID();
            writeFileSync(replacement, readFileSync(lockFile), { flag: "wx", mode: 0o600 });
            chmodSync(replacement, 0o600);
            renameSync(replacement, lockFile);
          }
          return { disposition: "lock-only-recovery", plan, planDigest };
        },
      }, async () => {
        throw new Error("synthetic child runtime failure");
      });
      throw new Error("runtime crash fixture unexpectedly completed");
    } catch (error) {
      writeFileSync(markerFile, "failed\\n");
      process.stderr.write(String(error?.code ?? error?.message ?? error));
      process.exitCode = 3;
    }
  `;
}

async function createDeadLockOnlyCleanupState(t, workspaceRoot) {
  bootstrapProtocol(workspaceRoot);
  const markerFile = path.join(workspaceRoot, "lock-only-child-failed");
  const child = spawnModuleChild(lockOnlyCleanupCrashChildSource(), [workspaceRoot, markerFile]);
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  const result = await collectChild(child);
  chmodSync(protocolPath(workspaceRoot, runtimeRelative), 0o700);
  assert.equal(result.code, 3, result.stderr);
  assert.equal(existsSync(markerFile), true);
  assert.match(result.stderr, /(?:recovery|required|release|durability|lock|path-race)/iu);

  const journalFile = singleJournalFile(workspaceRoot);
  const journal = JSON.parse(readFileSync(journalFile, "utf8"));
  const lockFile = protocolPath(workspaceRoot, lockRelative);
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  const claims = recoveryClaimFiles(workspaceRoot, journal.operationId);
  assert.equal(claims.length, 1);
  const claim = JSON.parse(readFileSync(claims[0], "utf8"));
  const expectedClaimReference = {
    ref: path.relative(workspaceRoot, claims[0]).split(path.sep).join("/"),
    generation: claim.recoveryGeneration,
    digest: canonicalJsonDigest(claim),
  };
  assert.equal(journal.purpose, "lock-only-recovery");
  assert.equal(journal.ownerDisposition, "relinquished");
  assert.equal(journal.recoveryGeneration, 1);
  assert.equal(lock.mode, "recovery-cleanup");
  assert.equal(lock.recoveryGeneration, 1);
  assert.equal(lock.processIdentity.pid, child.pid);
  assert.equal(journal.processIdentity.pid, child.pid);
  assert.deepEqual(lock.recoveryClaim, expectedClaimReference);
  assert.deepEqual(journal.recoveryClaim, expectedClaimReference);
  assertPrivateRegularFile(lockFile);
  assertPrivateRegularFile(journalFile);
  assertPrivateRegularFile(claims[0]);
  const plan = maintenancePlan();
  return {
    claimFile: claims[0],
    journal,
    journalFile,
    lock,
    lockFile,
    plan,
    planDigest: canonicalJsonDigest(plan),
  };
}

function terminalCrashChildSource() {
  return `
    import { createHash, randomUUID } from "node:crypto";
    import {
      chmodSync,
      existsSync,
      lstatSync,
      readFileSync,
      readdirSync,
      renameSync,
      unlinkSync,
      writeFileSync,
    } from "node:fs";
    import path from "node:path";
    import { canonicalJson, canonicalJsonDigest } from ${JSON.stringify(pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/wakeflow-canonical-json.mjs")).href)};
    import {
      recoverWakeflowWorkspaceMutation,
      runWakeflowMaintenanceMutation,
    } from ${JSON.stringify(managerUrl)};
    const [workspaceRoot, mode, operationId, planJson, stepJson, markerFile] = process.argv.slice(1);
    const plan = JSON.parse(planJson);
    const step = JSON.parse(stepJson);
    const transactionsRoot = path.join(workspaceRoot, ".wakeflow-local", "runtime", "maintenance", "transactions");
    const resolveRef = (ref) => path.resolve(workspaceRoot, ...ref.split("/"));
    const digest = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
    const observe = (contract) => {
      const target = resolveRef(contract.ref);
      if (!existsSync(target)) return { ref: contract.ref, type: "absent" };
      const stat = lstatSync(target);
      return {
        ref: contract.ref,
        type: stat.isDirectory() ? "directory" : "file",
        mode: "0" + (stat.mode & 0o777).toString(8).padStart(3, "0"),
        digest: stat.isDirectory() ? contract.digest : digest(readFileSync(target)),
      };
    };
    const observation = () => ({
      source: observe(step.source),
      staging: observe(step.staging),
      final: observe(step.final),
    });
    const deriveTerminalClosure = ({ plan: currentPlan }) => {
      const planDigest = canonicalJsonDigest(currentPlan);
      return {
        planDigest,
        closureDigests: [{
          name: "test-domain-closure-" + step.ordinal,
          digest: canonicalJsonDigest({
            planDigest,
            domain: "synthetic",
            stepId: step.stepId,
            stepKind: step.stepKind,
            resources: { final: observation().final },
          }),
        }],
      };
    };
    const validatePlan = async ({ plan: candidate }) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
        || Object.keys(candidate).sort().join(",") !== "payload,schemaId"
        || candidate.schemaId !== plan.schemaId
        || !candidate.payload || !Array.isArray(candidate.payload.steps)) {
        throw new Error("invalid child terminal plan");
      }
      return { valid: true };
    };
    const replaceSameBytes = (target) => {
      const replacement = target + ".same-bytes-" + randomUUID();
      writeFileSync(replacement, readFileSync(target), { flag: "wx", mode: 0o600 });
      chmodSync(replacement, 0o600);
      renameSync(replacement, target);
    };
    let deriveCalls = 0;
    const deriveCurrentPlan = async () => {
      deriveCalls += 1;
      if (deriveCalls === 2 && mode === "recover-sabotage-latest-claim") {
        const claims = readdirSync(transactionsRoot)
          .filter((entry) => entry.includes(".recovery-") && entry.endsWith(".json"))
          .sort((left, right) => {
            const generation = (entry) => Number(entry.match(/\\.recovery-([0-9]+)\\.json$/u)[1]);
            return generation(left) - generation(right);
          });
        replaceSameBytes(path.join(transactionsRoot, claims.at(-1)));
      }
      if (deriveCalls === 2 && mode === "recover-sabotage-journal") {
        replaceSameBytes(path.join(transactionsRoot, operationId + ".json"));
      }
      if (deriveCalls === 2 && mode === "recover-sabotage-gate") {
        replaceSameBytes(path.join(workspaceRoot, ".wakeflow-local", "runtime", "maintenance.lock"));
      }
      return plan;
    };
    const recoveryHandlers = {
      [step.stepId]: {
        prepare: async () => { throw new Error("terminal recovery must not prepare"); },
        observe: async () => observation(),
        commit: async () => { throw new Error("terminal recovery must not commit"); },
        cleanup: async () => {
          if (mode === "recover-fail-cleanup") {
            throw new Error("synthetic terminal recovery cleanup failure");
          }
          const tombstone = resolveRef(step.staging.ref);
          if (existsSync(tombstone)) unlinkSync(tombstone);
        },
      },
    };
    try {
      if (mode === "initial-terminal") {
        await runWakeflowMaintenanceMutation({
          workspaceRoot,
          action: "reconcile",
          operationKind: "terminal-cleanup-fixture",
          domainOwner: "maintenance-red-test",
          confirmedPlan: plan,
          planDigest: canonicalJsonDigest(plan),
          validatePlan,
          deriveCurrentPlan: async () => plan,
          deriveTerminalClosure,
          stepHandlers: {
            [step.stepId]: {
              prepare: async () => {},
              observe: async () => observation(),
              commit: async () => {
                renameSync(resolveRef(step.final.ref), resolveRef(step.staging.ref));
              },
              cleanup: async () => {
                throw new Error("synthetic initial terminal cleanup failure");
              },
            },
          },
        });
      } else {
        await recoverWakeflowWorkspaceMutation({
          workspaceRoot,
          operationId,
          confirmedPlan: plan,
          planDigest: canonicalJsonDigest(plan),
          validatePlan,
          deriveCurrentPlan,
          deriveTerminalClosure,
          stepHandlers: recoveryHandlers,
        });
      }
      throw new Error("terminal crash fixture unexpectedly completed");
    } catch (error) {
      writeFileSync(markerFile, mode + "\\n");
      process.stderr.write(String(error?.code ?? error?.message ?? error));
      process.exitCode = 3;
    }
  `;
}

async function runTerminalCrashChild(t, {
  workspaceRoot,
  mode,
  operationId: requestedOperationId = "unused",
  plan,
  step,
}) {
  const markerFile = path.join(workspaceRoot, `terminal-child-${mode}-${randomUUID()}`);
  const child = spawnModuleChild(terminalCrashChildSource(), [
    workspaceRoot,
    mode,
    requestedOperationId,
    JSON.stringify(plan),
    JSON.stringify(step),
    markerFile,
  ]);
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  const result = await collectChild(child);
  assert.equal(result.code, 3, result.stderr);
  assert.equal(existsSync(markerFile), true);
  assert.match(result.stderr, /(?:recovery|required|manual|cleanup|path-race)/iu);
  return { child, result };
}

function terminalRemoveFixture(workspaceRoot) {
  const oldBytes = Buffer.from("terminal cleanup fixture\n");
  const prefix = `.wakeflow-fixture/terminal-${randomUUID()}`;
  const finalRef = `${prefix}/obsolete.txt`;
  const tombstoneRef = `${prefix}/obsolete.tombstone`;
  const step = {
    stepId: "terminal-remove-fixture",
    ordinal: 0,
    stepKind: "remove",
    source: fileContract(finalRef, {
      type: "file",
      mode: "0600",
      digest: sha256(oldBytes),
    }),
    staging: fileContract(tombstoneRef, {
      type: "file",
      mode: "0600",
      digest: sha256(oldBytes),
    }),
    final: fileContract(finalRef, { type: "absent" }),
  };
  writeFixtureFile(workspaceRoot, finalRef, oldBytes);
  return { plan: maintenancePlan([step]), step };
}

async function createDeadTerminalState(t, workspaceRoot) {
  bootstrapProtocol(workspaceRoot);
  const fixture = terminalRemoveFixture(workspaceRoot);
  const initial = await runTerminalCrashChild(t, {
    workspaceRoot,
    mode: "initial-terminal",
    plan: fixture.plan,
    step: fixture.step,
  });
  const journalFile = singleJournalFile(workspaceRoot);
  const journal = JSON.parse(readFileSync(journalFile, "utf8"));
  const lockFile = protocolPath(workspaceRoot, lockRelative);
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  assert.equal(journal.phase, "terminal");
  assert.equal(journal.ownerDisposition, "active");
  assert.equal(journal.recoveryGeneration, 0);
  assert.equal(lock.recoveryGeneration, 0);
  assert.equal(lock.processIdentity.pid, initial.child.pid);
  assert.deepEqual(recoveryClaimFiles(workspaceRoot, journal.operationId), []);
  assert.equal(existsSync(portablePath(workspaceRoot, fixture.step.final.ref)), false);
  assert.equal(existsSync(portablePath(workspaceRoot, fixture.step.staging.ref)), true);
  return { ...fixture, journal, journalFile, lock, lockFile };
}

test("lock-only cleanup-ready crash states resume through the next generation", {
  skip: process.platform === "win32" ? "POSIX directory permissions form the real release crash" : false,
}, async (t) => {
  const { recoverWakeflowWorkspaceMutation } = await mutationManager();

  for (const claimState of ["claim-suffix", "zero-claim"]) {
    await t.test(`${claimState} cleanup state is recoverable`, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-lock-only-${claimState}-`);
      const fixture = await createDeadLockOnlyCleanupState(t, workspaceRoot);
      if (claimState === "zero-claim") {
        unlinkSync(fixture.claimFile);
        assert.deepEqual(recoveryClaimFiles(workspaceRoot, fixture.journal.operationId), []);
      }
      let deriveCalls = 0;

      const result = await recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId: fixture.journal.operationId,
        confirmedPlan: fixture.plan,
        planDigest: fixture.planDigest,
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => {
          deriveCalls += 1;
          return fixture.plan;
        },
        stepHandlers: {},
      });

      assert.equal(deriveCalls, 2);
      assert.equal(result.status, "lock-only-recovered");
      assert.equal(result.recoveryGeneration, 2);
      assertNoMaintenanceResidue(workspaceRoot);
    });
  }
});

test("terminal cleanup resumes from real partial-claim and zero-claim crash states", async (t) => {
  const {
    recoverWakeflowWorkspaceMutation,
    withWakeflowRuntimeMutation,
  } = await mutationManager();

  async function finishTerminalCleanup(workspaceRoot, fixture, expectedGeneration) {
    let deriveCalls = 0;
    let prepareCalls = 0;
    let commitCalls = 0;
    let observeCalls = 0;
    let cleanupCalls = 0;
    let closureCalls = 0;
    const result = await recoverWakeflowWorkspaceMutation({
      workspaceRoot,
      operationId: fixture.journal.operationId,
      confirmedPlan: fixture.plan,
      planDigest: canonicalJsonDigest(fixture.plan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => {
        deriveCalls += 1;
        return fixture.plan;
      },
      deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot, {
        onDerive: () => { closureCalls += 1; },
      }),
      stepHandlers: {
        [fixture.step.stepId]: {
          prepare: async () => { prepareCalls += 1; },
          observe: async () => {
            observeCalls += 1;
            return stepObservation(workspaceRoot, fixture.step);
          },
          commit: async () => { commitCalls += 1; },
          cleanup: async () => {
            cleanupCalls += 1;
            const tombstone = portablePath(workspaceRoot, fixture.step.staging.ref);
            if (existsSync(tombstone)) unlinkSync(tombstone);
          },
        },
      },
    });

    assert.equal(result.status, "terminal-cleanup-recovered");
    assert.equal(result.recoveryGeneration, expectedGeneration);
    assert.equal(deriveCalls, 2);
    assert.equal(prepareCalls, 0, "terminal recovery never repeats prepare");
    assert.equal(commitCalls, 0, "terminal recovery never repeats commit");
    assert.equal(cleanupCalls, 1);
    assert.ok(observeCalls > 0);
    assert.equal(closureCalls, 2, "terminal closure is checked before and after cleanup");
    assertNoMaintenanceResidue(workspaceRoot);
  }

  await t.test("a retained claim suffix continues after older claims were durably removed", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-terminal-claim-suffix-");
    const fixture = await createDeadTerminalState(t, workspaceRoot);

    const firstRecovery = await runTerminalCrashChild(t, {
      workspaceRoot,
      mode: "recover-fail-cleanup",
      operationId: fixture.journal.operationId,
      plan: fixture.plan,
      step: fixture.step,
    });
    let journal = JSON.parse(readFileSync(fixture.journalFile, "utf8"));
    let lock = JSON.parse(readFileSync(fixture.lockFile, "utf8"));
    assert.equal(journal.phase, "terminal");
    assert.equal(journal.recoveryGeneration, 1);
    assert.equal(lock.processIdentity.pid, firstRecovery.child.pid);
    assert.equal(recoveryClaimFiles(workspaceRoot, fixture.journal.operationId).length, 1);

    const partialCleanup = await runTerminalCrashChild(t, {
      workspaceRoot,
      mode: "recover-sabotage-latest-claim",
      operationId: fixture.journal.operationId,
      plan: fixture.plan,
      step: fixture.step,
    });
    journal = JSON.parse(readFileSync(fixture.journalFile, "utf8"));
    lock = JSON.parse(readFileSync(fixture.lockFile, "utf8"));
    const suffix = recoveryClaimFiles(workspaceRoot, fixture.journal.operationId);
    assert.equal(suffix.length, 1, "manager removed generation one before exact generation-two CAS failed");
    assert.match(path.basename(suffix[0]), /\.recovery-2\.json$/u);
    assert.equal(journal.recoveryGeneration, 2);
    assert.equal(lock.recoveryGeneration, 2);
    assert.equal(lock.processIdentity.pid, partialCleanup.child.pid);
    assert.equal(existsSync(portablePath(workspaceRoot, fixture.step.staging.ref)), false);

    await finishTerminalCleanup(workspaceRoot, fixture, 3);
  });

  await t.test("terminal journal and dead gate continue after claim cleanup reached zero", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-terminal-zero-claim-");
    const fixture = await createDeadTerminalState(t, workspaceRoot);

    const zeroClaimCleanup = await runTerminalCrashChild(t, {
      workspaceRoot,
      mode: "recover-sabotage-journal",
      operationId: fixture.journal.operationId,
      plan: fixture.plan,
      step: fixture.step,
    });
    const journal = JSON.parse(readFileSync(fixture.journalFile, "utf8"));
    const lock = JSON.parse(readFileSync(fixture.lockFile, "utf8"));
    assert.equal(journal.phase, "terminal");
    assert.equal(journal.recoveryGeneration, 1);
    assert.equal(lock.recoveryGeneration, 1);
    assert.equal(lock.processIdentity.pid, zeroClaimCleanup.child.pid);
    assert.deepEqual(recoveryClaimFiles(workspaceRoot, fixture.journal.operationId), []);
    assert.equal(existsSync(portablePath(workspaceRoot, fixture.step.staging.ref)), false);

    await finishTerminalCleanup(workspaceRoot, fixture, 2);
  });

  await t.test("a lone high-generation gate resumes only as a zero-step cleanup tail", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-terminal-gate-only-tail-");
    const fixture = await createDeadTerminalState(t, workspaceRoot);

    const gateTail = await runTerminalCrashChild(t, {
      workspaceRoot,
      mode: "recover-sabotage-gate",
      operationId: fixture.journal.operationId,
      plan: fixture.plan,
      step: fixture.step,
    });
    const lockFile = protocolPath(workspaceRoot, lockRelative);
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    assert.equal(lock.mode, "recovery-cleanup");
    assert.equal(lock.recoveryGeneration, 1);
    assert.equal(lock.processIdentity.pid, gateTail.child.pid);
    assert.equal(existsSync(fixture.journalFile), false, "terminal journal was durably removed");
    assert.deepEqual(recoveryClaimFiles(workspaceRoot, fixture.journal.operationId), []);
    assert.equal(existsSync(portablePath(workspaceRoot, fixture.step.final.ref)), false);
    assert.equal(existsSync(portablePath(workspaceRoot, fixture.step.staging.ref)), false);

    const cleanupPlan = maintenancePlan();
    let deriveCalls = 0;
    const result = await recoverWakeflowWorkspaceMutation({
      workspaceRoot,
      operationId: fixture.journal.operationId,
      confirmedPlan: cleanupPlan,
      planDigest: canonicalJsonDigest(cleanupPlan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => {
        deriveCalls += 1;
        return cleanupPlan;
      },
      stepHandlers: {},
    });

    assert.equal(result.status, "orphan-lock-recovered");
    assert.equal(result.recoveryGeneration, 2);
    assert.equal(deriveCalls, 2, "cleanup-tail recovery proves zero work before and after takeover");
    assertNoMaintenanceResidue(workspaceRoot);
  });

  await t.test("a cleanup-tail claim published before its journal is arbitrated and resumed exactly", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-terminal-gate-claim-tail-");
    const fixture = await createDeadTerminalState(t, workspaceRoot);
    const gateTail = await runTerminalCrashChild(t, {
      workspaceRoot,
      mode: "recover-sabotage-gate",
      operationId: fixture.journal.operationId,
      plan: fixture.plan,
      step: fixture.step,
    });
    const lockFile = protocolPath(workspaceRoot, lockRelative);
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    assert.equal(lock.recoveryGeneration, 1);
    assert.equal(lock.processIdentity.pid, gateTail.child.pid);
    assert.deepEqual(recoveryClaimFiles(workspaceRoot, fixture.journal.operationId), []);

    const holderWorkspace = withTempWorkspace(t, "wakeflow-live-claimant-identity-");
    bootstrapProtocol(holderWorkspace);
    let resolveEntered;
    let resolveRelease;
    const entered = new Promise((resolve) => { resolveEntered = resolve; });
    const release = new Promise((resolve) => { resolveRelease = resolve; });
    const holder = withWakeflowRuntimeMutation({
      workspaceRoot: holderWorkspace,
      operationKind: "live-claimant-identity",
      domainOwner: "maintenance-red-test",
    }, async () => {
      const holderLock = JSON.parse(readFileSync(
        protocolPath(holderWorkspace, lockRelative),
        "utf8",
      ));
      resolveEntered(holderLock.processIdentity);
      await release;
    });
    const liveClaimantIdentity = await entered;
    t.after(() => resolveRelease());

    const cleanupPlan = maintenancePlan();
    const claimGeneration = 2;
    const acquiredAt = "2026-08-08T00:00:00.000Z";
    const claimRef = `${transactionsRelative}/${fixture.journal.operationId}.recovery-${claimGeneration}.json`;
    const claim = {
      schemaVersion: 1,
      artifactKind: "wakeflow-workspace-recovery-claim",
      operationId: fixture.journal.operationId,
      recoveryGeneration: claimGeneration,
      planDigest: canonicalJsonDigest(cleanupPlan),
      previousOwner: {
        mode: "recovery-cleanup",
        operationKind: lock.operationKind,
        domainOwner: lock.domainOwner,
        ownerTokenDigest: sha256(lock.ownerToken),
        recoveryGeneration: lock.recoveryGeneration,
        processIdentity: lock.processIdentity,
        ownerDisposition: "active",
      },
      nextOwner: {
        mode: "recovery-cleanup",
        operationKind: lock.operationKind,
        domainOwner: lock.domainOwner,
        ownerToken: ownerToken(),
        recoveryGeneration: claimGeneration,
        processIdentity: liveClaimantIdentity,
        acquiredAt,
      },
      previousJournal: absentArtifact(`${transactionsRelative}/${fixture.journal.operationId}.json`),
      previousLock: portableFileArtifact(workspaceRoot, lockRelative),
      previousClaim: absentArtifact(
        `${transactionsRelative}/${fixture.journal.operationId}.recovery-1.json`,
      ),
      createdAt: acquiredAt,
    };
    const { target: claimFile } = writeCanonicalPrivateFile(workspaceRoot, claimRef, claim);
    let deriveCalls = 0;
    let before = captureMutationEvidence(workspaceRoot);
    await assert.rejects(
      () => recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId: fixture.journal.operationId,
        confirmedPlan: cleanupPlan,
        planDigest: canonicalJsonDigest(cleanupPlan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => {
          deriveCalls += 1;
          return cleanupPlan;
        },
        stepHandlers: {},
      }),
      /(?:busy|live|claimant|recovery)/iu,
    );
    assert.equal(deriveCalls, 0, "same-live claimant blocks before plan proof");
    assertMutationEvidenceUnchanged(workspaceRoot, before);

    resolveRelease();
    await holder;
    const deadClaim = {
      ...claim,
      nextOwner: {
        ...claim.nextOwner,
        processIdentity: {
          platform: process.platform,
          pid: 2_147_483_645,
          startIdentity: sha256(`terminated-tail-claimant:${fixture.journal.operationId}`),
        },
      },
    };
    replacePrivateJsonFixture(claimFile, {
      ...deadClaim,
      previousLock: {
        ...deadClaim.previousLock,
        inodeId: String(BigInt(deadClaim.previousLock.inodeId) + 1n),
      },
    });
    before = captureMutationEvidence(workspaceRoot);
    await assert.rejects(
      () => recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId: fixture.journal.operationId,
        confirmedPlan: cleanupPlan,
        planDigest: canonicalJsonDigest(cleanupPlan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => {
          deriveCalls += 1;
          return cleanupPlan;
        },
        stepHandlers: {},
      }),
      /(?:claim|gate|lock|manual|exact)/iu,
    );
    assert.equal(deriveCalls, 0, "tampered orphan claim blocks before plan proof");
    assertMutationEvidenceUnchanged(workspaceRoot, before);

    replacePrivateJsonFixture(claimFile, deadClaim);
    const result = await recoverWakeflowWorkspaceMutation({
      workspaceRoot,
      operationId: fixture.journal.operationId,
      confirmedPlan: cleanupPlan,
      planDigest: canonicalJsonDigest(cleanupPlan),
      validatePlan: validateTestPlan,
      deriveCurrentPlan: async () => {
        deriveCalls += 1;
        return cleanupPlan;
      },
      stepHandlers: {},
    });

    assert.equal(result.status, "orphan-lock-recovered");
    assert.equal(result.recoveryGeneration, 3);
    assert.equal(deriveCalls, 2);
    assertNoMaintenanceResidue(workspaceRoot);
  });
});

test("runtime verifier failures retain the exact owning gate and any durable recovery evidence", async (t) => {
  const { withWakeflowRuntimeMutation } = await mutationManager();

  for (const firstFailure of ["throws", "invalid-disposition"]) {
    await t.test(`first verifier ${firstFailure} retains the generation-zero gate`, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-runtime-first-${firstFailure}-`);
      bootstrapProtocol(workspaceRoot);
      const callbackError = new Error(`runtime first verifier ${firstFailure}`);
      let gateSnapshot;

      await assert.rejects(
        () => withWakeflowRuntimeMutation({
          workspaceRoot,
          operationKind: "runtime-verifier-first-failure",
          domainOwner: "maintenance-red-test",
          onCallbackFailure: async ({ phase }) => {
            assert.equal(phase, "after-callback-settled");
            const lockFile = protocolPath(workspaceRoot, lockRelative);
            gateSnapshot = captureExactFixtureFile(lockFile);
            const lock = JSON.parse(gateSnapshot.bytes.toString("utf8"));
            assert.equal(lock.mode, "runtime-mutation");
            assert.equal(lock.recoveryGeneration, 0);
            assert.equal(lock.processIdentity.pid, process.pid);
            if (firstFailure === "throws") throw new Error("synthetic first verifier failure");
            return { disposition: "unsupported-verifier-disposition" };
          },
        }, async () => {
          throw callbackError;
        }),
        /(?:recovery|required|verifier|disposition|callback)/iu,
      );

      assert.ok(gateSnapshot);
      assertExactFixtureFileUnchanged(gateSnapshot);
      assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
    });
  }

  for (const secondFailure of ["plan-drift", "throws"]) {
    await t.test(`second verifier ${secondFailure} retains generation-one evidence`, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-runtime-second-${secondFailure}-`);
      bootstrapProtocol(workspaceRoot);
      const plan = maintenancePlan();
      const planDigest = canonicalJsonDigest(plan);
      const driftedPlan = {
        schemaId: plan.schemaId,
        payload: { steps: [], fixtureRevision: "changed-before-release" },
      };
      let secondPhaseEvidence;

      await assert.rejects(
        () => withWakeflowRuntimeMutation({
          workspaceRoot,
          operationKind: "runtime-verifier-second-failure",
          domainOwner: "maintenance-red-test",
          validateRecoveryPlan: validateTestPlan,
          onCallbackFailure: async ({ phase, expectedPlanDigest }) => {
            if (phase === "after-callback-settled") {
              assert.equal(expectedPlanDigest, null);
              return { disposition: "lock-only-recovery", plan, planDigest };
            }
            assert.equal(phase, "before-gate-release");
            assert.equal(expectedPlanDigest, planDigest);
            secondPhaseEvidence = captureMutationEvidence(workspaceRoot);
            const lock = JSON.parse(
              readFileSync(protocolPath(workspaceRoot, lockRelative), "utf8"),
            );
            const journal = JSON.parse(readFileSync(singleJournalFile(workspaceRoot), "utf8"));
            assert.equal(lock.mode, "recovery-cleanup");
            assert.equal(lock.recoveryGeneration, 1);
            assert.equal(lock.processIdentity.pid, process.pid);
            assert.equal(journal.ownerDisposition, "active");
            assert.equal(journal.recoveryGeneration, 1);
            assert.equal(recoveryClaimFiles(workspaceRoot, journal.operationId).length, 1);
            if (secondFailure === "throws") {
              throw new Error("synthetic second verifier failure");
            }
            return {
              disposition: "lock-only-recovery",
              plan: driftedPlan,
              planDigest: canonicalJsonDigest(driftedPlan),
            };
          },
        }, async () => {
          throw new Error("synthetic runtime callback failure");
        }),
        /(?:recovery|required|proof|plan|verifier)/iu,
      );

      assert.ok(secondPhaseEvidence);
      assertMutationEvidenceUnchanged(workspaceRoot, secondPhaseEvidence);
      const retained = JSON.parse(readFileSync(singleJournalFile(workspaceRoot), "utf8"));
      assert.equal(retained.ownerDisposition, "active");
      assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), true);
      assert.equal(recoveryClaimFiles(workspaceRoot, retained.operationId).length, 1);
    });
  }
});

test("recovery rejects minimally tampered claim fields without changing existing evidence", {
  skip: process.platform === "win32" ? "POSIX inode evidence and release crash are required" : false,
}, async (t) => {
  const { recoverWakeflowWorkspaceMutation } = await mutationManager();
  const tamperCases = {
    previousOwner: (claim) => ({
      ...claim,
      previousOwner: {
        ...claim.previousOwner,
        ownerTokenDigest: sha256("tampered previous owner token"),
      },
    }),
    planDigest: (claim) => ({
      ...claim,
      planDigest: sha256("tampered recovery plan"),
    }),
    previousLock: (claim) => ({
      ...claim,
      previousLock: {
        ...claim.previousLock,
        inodeId: String(BigInt(claim.previousLock.inodeId) + 1n),
      },
    }),
    previousOwnerModeGeneration: (claim) => ({
      ...claim,
      previousOwner: {
        ...claim.previousOwner,
        mode: "recovery-cleanup",
      },
    }),
    fileLockRelinquishedOwner: (claim) => ({
      ...claim,
      previousOwner: {
        ...claim.previousOwner,
        ownerDisposition: "relinquished",
      },
    }),
    unboundPredecessor: (claim) => ({
      ...claim,
      previousLock: { type: "absent", ref: lockRelative },
    }),
  };

  for (const [field, tamper] of Object.entries(tamperCases)) {
    await t.test(`${field} tamper is manual and evidence-preserving`, async (t) => {
      const workspaceRoot = withTempWorkspace(t, `wakeflow-claim-tamper-${field}-`);
      const fixture = await createDeadLockOnlyCleanupState(t, workspaceRoot);
      const originalClaim = JSON.parse(readFileSync(fixture.claimFile, "utf8"));
      replacePrivateJsonFixture(fixture.claimFile, tamper(originalClaim));
      const before = captureMutationEvidence(workspaceRoot);
      let deriveCalls = 0;

      await assert.rejects(
        () => recoverWakeflowWorkspaceMutation({
          workspaceRoot,
          operationId: fixture.journal.operationId,
          confirmedPlan: fixture.plan,
          planDigest: fixture.planDigest,
          validatePlan: validateTestPlan,
          deriveCurrentPlan: async () => {
            deriveCalls += 1;
            return fixture.plan;
          },
          stepHandlers: {},
        }),
        /(?:manual|claim|artifact|digest|recovery)/iu,
      );

      assert.equal(deriveCalls, 0, "claim-chain integrity is checked before recovery planning");
      assertMutationEvidenceUnchanged(workspaceRoot, before);
    });
  }
});

test("recovery rejects impossible owner tuples and checkpoint states before claim or evidence change", async (t) => {
  const { recoverWakeflowWorkspaceMutation } = await mutationManager();

  function handlersFor(workspaceRoot, steps) {
    return Object.fromEntries(steps.map((step) => [step.stepId, {
      prepare: async () => {},
      observe: async () => stepObservation(workspaceRoot, step),
      commit: async () => {},
    }]));
  }

  async function expectEvidencePreservingRejection(workspaceRoot, fixture) {
    const before = captureMutationEvidence(workspaceRoot);
    let deriveCalls = 0;
    await assert.rejects(
      () => recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId: fixture.operationId,
        confirmedPlan: fixture.plan,
        planDigest: canonicalJsonDigest(fixture.plan),
        validatePlan: validateTestPlan,
        deriveCurrentPlan: async () => {
          deriveCalls += 1;
          return fixture.plan;
        },
        deriveTerminalClosure: deriveSyntheticTerminalClosure(workspaceRoot),
        stepHandlers: handlersFor(workspaceRoot, fixture.plan.payload.steps),
      }),
      /(?:artifact|checkpoint|manual|mode|owner|prepared|safe integer)/iu,
    );
    assert.equal(deriveCalls, 0);
    assertMutationEvidenceUnchanged(workspaceRoot, before);
  }

  await t.test("generation-zero maintenance journal rejects a runtime-mode matching gate", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-owner-mode-mismatch-");
    bootstrapProtocol(workspaceRoot);
    const fixture = makeRecoveryFixture(workspaceRoot, "create-or-update");
    const gate = seedGenerationZeroMaintenanceGate(workspaceRoot, fixture);
    replacePrivateJsonFixture(gate.lockFile, { ...gate.lock, mode: "runtime-mutation" });
    await expectEvidencePreservingRejection(workspaceRoot, fixture);
  });

  await t.test("two prepared steps are not a producer-reachable journal", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-multiple-prepared-");
    bootstrapProtocol(workspaceRoot);
    const fixture = makeRecoveryFixture(workspaceRoot, "create-or-update");
    const secondStep = {
      ...fixture.step,
      stepId: "recover-create-second",
      ordinal: 1,
      source: { ...fixture.step.source, ref: `${fixture.step.source.ref}.second` },
      staging: { ...fixture.step.staging, ref: `${fixture.step.staging.ref}.second` },
      final: { ...fixture.step.final, ref: `${fixture.step.final.ref}.second` },
    };
    const plan = maintenancePlan([fixture.step, secondStep]);
    const journal = {
      ...fixture.journal,
      plan,
      planDigest: canonicalJsonDigest(plan),
      checkpoint: 2,
      steps: [
        { ...fixture.step, status: "prepared" },
        { ...secondStep, status: "prepared" },
      ],
    };
    replacePrivateJsonFixture(fixture.journalFile, journal);
    await expectEvidencePreservingRejection(workspaceRoot, {
      ...fixture,
      journal,
      plan,
    });
  });

  await t.test("maximum-safe checkpoint cannot publish a recovery claim", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-checkpoint-overflow-");
    bootstrapProtocol(workspaceRoot);
    const fixture = makeRecoveryFixture(workspaceRoot, "create-or-update");
    const journal = { ...fixture.journal, checkpoint: Number.MAX_SAFE_INTEGER };
    replacePrivateJsonFixture(fixture.journalFile, journal);
    await expectEvidencePreservingRejection(workspaceRoot, { ...fixture, journal });
  });

  await t.test("checkpoint capacity covers takeover plus terminalization before any claim", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-checkpoint-capacity-");
    bootstrapProtocol(workspaceRoot);
    const fixture = makeRecoveryFixture(workspaceRoot, "create-or-update");
    const journal = {
      ...fixture.journal,
      checkpoint: Number.MAX_SAFE_INTEGER - 1,
      steps: [{ ...fixture.step, status: "committed" }],
    };
    replacePrivateJsonFixture(fixture.journalFile, journal);
    await expectEvidencePreservingRejection(workspaceRoot, { ...fixture, journal });
  });
});

async function seedAdmissionBlockingResidue(workspaceRoot, residueKind) {
  const { withWakeflowRuntimeMutation } = await mutationManager();
  const plan = maintenancePlan();
  const planDigest = canonicalJsonDigest(plan);
  await assert.rejects(
    () => withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "admission-residue-fixture",
      domainOwner: "maintenance-red-test",
      validateRecoveryPlan: validateTestPlan,
      onCallbackFailure: async () => ({
        disposition: "lock-only-recovery",
        plan,
        planDigest,
      }),
    }, async () => {
      throw new Error("synthetic residue seed failure");
    }),
    /(?:recovery|required|synthetic residue seed failure)/iu,
  );

  const journalFile = singleJournalFile(workspaceRoot);
  const journal = JSON.parse(readFileSync(journalFile, "utf8"));
  const [claimFile] = recoveryClaimFiles(workspaceRoot, journal.operationId);
  assert.ok(claimFile, "the seed must publish its generation claim before relinquishing");
  if (residueKind === "journal") unlinkSync(claimFile);
  else if (residueKind === "claim") unlinkSync(journalFile);
  else assert.fail(`unsupported admission residue fixture: ${residueKind}`);
  assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
  return journal.operationId;
}

async function inspectMutationFromChild(workspaceRoot) {
  const source = `
    import { inspectWakeflowWorkspaceMutation } from ${JSON.stringify(managerUrl)};
    const [workspaceRoot] = process.argv.slice(1);
    process.stdout.write(JSON.stringify(inspectWakeflowWorkspaceMutation({ workspaceRoot })));
  `;
  const result = await collectChild(spawnModuleChild(source, [workspaceRoot]));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function writeSyntheticOwnerRecord(workspaceRoot, ref, value) {
  const target = portablePath(workspaceRoot, ref);
  mkdirSync(path.dirname(target), { mode: 0o700, recursive: true });
  writeFileSync(target, `${canonicalJson(value)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(target, 0o600);
  return captureExactFixtureFile(target);
}

function replaceSyntheticOwnerRecord(snapshot, value) {
  assertExactFixtureFileUnchanged(snapshot);
  const stage = `${snapshot.target}.owner-cas-${randomUUID()}`;
  writeFileSync(stage, `${canonicalJson(value)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(stage, 0o600);
  try {
    assertExactFixtureFileUnchanged(snapshot);
    renameSync(stage, snapshot.target);
  } finally {
    if (existsSync(stage)) unlinkSync(stage);
  }
  assertPrivateRegularFile(snapshot.target);
  return captureExactFixtureFile(snapshot.target);
}

test("journal or claim residue outside the gate blocks every normal admission before owner work", async (t) => {
  const {
    inspectWakeflowWorkspaceMutation,
    runWakeflowMaintenanceMutation,
    withWakeflowRuntimeMutation,
  } = await mutationManager();

  for (const residueKind of ["journal", "claim"]) {
    for (const admissionKind of ["runtime", "maintenance"]) {
      await t.test(`${residueKind} blocks ${admissionKind} owner work`, async (t) => {
        const workspaceRoot = withTempWorkspace(
          t,
          `wakeflow-${residueKind}-${admissionKind}-admission-`,
        );
        bootstrapProtocol(workspaceRoot);
        const residueOperationId = await seedAdmissionBlockingResidue(
          workspaceRoot,
          residueKind,
        );
        const before = captureMutationEvidence(workspaceRoot);
        assert.deepEqual(inspectWakeflowWorkspaceMutation({ workspaceRoot }), {
          state: "recovery-required",
          lock: null,
          operations: [residueOperationId],
        });

        let ownerWorkCalls = 0;
        if (admissionKind === "runtime") {
          await assert.rejects(
            () => withWakeflowRuntimeMutation({
              workspaceRoot,
              operationKind: "blocked-runtime-owner",
              domainOwner: "maintenance-red-test",
              acquireTimeoutMs: 0,
            }, async () => {
              ownerWorkCalls += 1;
            }),
            /(?:residue|recovery|required)/iu,
          );
        } else {
          const plan = maintenancePlan();
          await assert.rejects(
            () => runWakeflowMaintenanceMutation({
              workspaceRoot,
              action: "reconcile",
              operationKind: "blocked-maintenance-owner",
              domainOwner: "maintenance-red-test",
              acquireTimeoutMs: 0,
              confirmedPlan: plan,
              planDigest: canonicalJsonDigest(plan),
              validatePlan: validateTestPlan,
              deriveCurrentPlan: async () => {
                ownerWorkCalls += 1;
                return plan;
              },
              stepHandlers: {},
            }),
            /(?:residue|recovery|required)/iu,
          );
        }

        assert.equal(ownerWorkCalls, 0, "strict residue scan precedes every domain callback");
        assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
        assertMutationEvidenceUnchanged(workspaceRoot, before);
      });
    }
  }
});

test("the post-publication transaction scan rejects residue injected after gate creation", {
  skip: !new Set(["darwin", "linux"]).has(process.platform)
    ? "the production process-identity contract supports Darwin and Linux"
    : false,
}, async (t) => {
  const { withWakeflowRuntimeMutation } = await mutationManager();
  let provedPostAcquireScan = false;

  for (let attempt = 0; attempt < 16 && !provedPostAcquireScan; attempt += 1) {
    const workspaceRoot = withTempWorkspace(t, `wakeflow-post-o-excl-${attempt}-`);
    bootstrapProtocol(workspaceRoot);
    const readyFile = path.join(workspaceRoot, "watcher-ready");
    const residueFile = path.join(
      protocolPath(workspaceRoot, transactionsRelative),
      `late-residue-${attempt}`,
    );
    const source = `
      import {
        closeSync,
        constants,
        existsSync,
        openSync,
        writeFileSync,
      } from "node:fs";
      const [lockFile, residueFile, readyFile] = process.argv.slice(1);
      writeFileSync(readyFile, "ready\\n", { flag: "wx", mode: 0o600 });
      const deadline = Date.now() + 5000;
      while (!existsSync(lockFile) && Date.now() < deadline) {}
      if (!existsSync(lockFile)) {
        process.stderr.write("gate-not-observed");
        process.exitCode = 4;
      } else {
        const descriptor = openSync(
          residueFile,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
          0o600,
        );
        writeFileSync(descriptor, "late transaction residue\\n");
        closeSync(descriptor);
        process.stdout.write(JSON.stringify({ gateStillPresent: existsSync(lockFile) }));
      }
    `;
    const watcher = spawnModuleChild(source, [
      protocolPath(workspaceRoot, lockRelative),
      residueFile,
      readyFile,
    ]);
    t.after(() => {
      if (watcher.exitCode === null && watcher.signalCode === null) watcher.kill("SIGKILL");
    });
    await waitFor(() => existsSync(readyFile), "late-residue watcher did not become ready");

    let callbackCalls = 0;
    let admissionError = null;
    try {
      await withWakeflowRuntimeMutation({
        workspaceRoot,
        operationKind: "post-o-excl-scan",
        domainOwner: "maintenance-red-test",
        acquireTimeoutMs: 0,
      }, async () => {
        callbackCalls += 1;
      });
    } catch (error) {
      admissionError = error;
    }
    const watcherResult = await collectChild(watcher);
    if (watcherResult.code !== 0 || watcherResult.signal !== null) continue;
    const watcherEvidence = JSON.parse(watcherResult.stdout);
    if (!watcherEvidence.gateStillPresent) continue;

    assert.ok(admissionError, "residue visible under the acquired gate must reject admission");
    assert.match(
      String(admissionError.code ?? admissionError.message ?? admissionError),
      /(?:residue|recovery|required)/iu,
    );
    assert.equal(callbackCalls, 0, "the post-publication scan is before owner authorization");
    assert.equal(existsSync(residueFile), true);
    assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
    provedPostAcquireScan = true;
  }

  assert.equal(
    provedPostAcquireScan,
    true,
    "an independent watcher must win at least one lock-create/readback window",
  );
});

test("external effects follow the two owner-defined admission orderings", async (t) => {
  const { withWakeflowRuntimeMutation } = await mutationManager();

  await t.test("durable intent releases the gate before the effect and final exact CAS", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-effect-intent-order-");
    bootstrapProtocol(workspaceRoot);
    const intentRef = ".wakeflow-fixture/effect-order/operation.json";
    const effectRef = ".wakeflow-fixture/effect-order/external-receipt.json";
    const intent = {
      effectId: "synthetic-effect-intent-first",
      revision: 1,
      status: "pending",
    };
    let pendingSnapshot;

    await withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "effect-intent-create",
      domainOwner: "synthetic-effect-owner",
    }, async () => {
      pendingSnapshot = writeSyntheticOwnerRecord(workspaceRoot, intentRef, intent);
      assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "busy");
    });
    assert.ok(pendingSnapshot);
    assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "idle");

    let effectCallCount = 0;
    effectCallCount += 1;
    writeSyntheticOwnerRecord(workspaceRoot, effectRef, {
      effectId: intent.effectId,
      receipt: "synthetic-receipt-one",
    });
    assert.equal(
      (await inspectMutationFromChild(workspaceRoot)).state,
      "idle",
      "the durable pending fact makes the long external effect gate-free",
    );

    await withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "effect-final-record",
      domainOwner: "synthetic-effect-owner",
    }, async () => {
      assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "busy");
      pendingSnapshot = replaceSyntheticOwnerRecord(pendingSnapshot, {
        effectId: intent.effectId,
        receipt: "synthetic-receipt-one",
        revision: 2,
        status: "completed",
      });
      assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "busy");
    });

    assert.equal(effectCallCount, 1);
    assert.deepEqual(JSON.parse(readFileSync(pendingSnapshot.target, "utf8")), {
      effectId: intent.effectId,
      receipt: "synthetic-receipt-one",
      revision: 2,
      status: "completed",
    });
    assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "idle");
    assertNoMaintenanceResidue(workspaceRoot);
  });

  await t.test("a bounded effect without prior fact stays admitted through its record", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-effect-bounded-record-");
    bootstrapProtocol(workspaceRoot);
    const effectRef = ".wakeflow-fixture/bounded-effect/external-receipt.json";
    const recordRef = ".wakeflow-fixture/bounded-effect/operation.json";
    assert.equal(existsSync(portablePath(workspaceRoot, recordRef)), false);
    let effectCallCount = 0;

    await withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "bounded-effect-record",
      domainOwner: "synthetic-effect-owner",
    }, async () => {
      assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "busy");
      effectCallCount += 1;
      writeSyntheticOwnerRecord(workspaceRoot, effectRef, {
        effectId: "synthetic-bounded-effect",
        receipt: "synthetic-bounded-receipt",
      });
      assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "busy");
      writeSyntheticOwnerRecord(workspaceRoot, recordRef, {
        effectId: "synthetic-bounded-effect",
        receipt: "synthetic-bounded-receipt",
        status: "completed",
      });
      assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "busy");
    });

    assert.equal(effectCallCount, 1);
    assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "idle");
    assertNoMaintenanceResidue(workspaceRoot);
  });

  await t.test("a bounded effect failure is cleaned before its safe release", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-effect-bounded-cleanup-");
    bootstrapProtocol(workspaceRoot);
    const effectRef = ".wakeflow-fixture/bounded-cleanup/external-receipt.json";
    const recordRef = ".wakeflow-fixture/bounded-cleanup/operation.json";
    let cleanupCompletedInsideAdmission = false;
    let verifierCalls = 0;

    await assert.rejects(
      () => withWakeflowRuntimeMutation({
        workspaceRoot,
        operationKind: "bounded-effect-cleanup",
        domainOwner: "synthetic-effect-owner",
        onCallbackFailure: async ({ phase }) => {
          verifierCalls += 1;
          assert.equal(phase, "after-callback-settled");
          assert.equal(cleanupCompletedInsideAdmission, true);
          assert.equal(existsSync(portablePath(workspaceRoot, effectRef)), false);
          assert.equal(existsSync(portablePath(workspaceRoot, recordRef)), false);
          assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "busy");
          return {
            disposition: "safe-to-release",
            closureDigests: [{
              name: "bounded-effect-cleanup",
              digest: canonicalJsonDigest({ effect: "absent", record: "absent" }),
            }],
          };
        },
      }, async () => {
        writeSyntheticOwnerRecord(workspaceRoot, effectRef, {
          effectId: "synthetic-cleaned-effect",
          receipt: "temporary-receipt",
        });
        assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "busy");
        unlinkSync(portablePath(workspaceRoot, effectRef));
        cleanupCompletedInsideAdmission = true;
        assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "busy");
        throw new Error("synthetic bounded record failure");
      }),
      /(?:callback-failed|synthetic bounded record failure)/iu,
    );

    assert.equal(verifierCalls, 1);
    assert.equal((await inspectMutationFromChild(workspaceRoot)).state, "idle");
    assertNoMaintenanceResidue(workspaceRoot);
  });
});

test("an owner-specific retry does not resend an effect completed before final-record failure", async (t) => {
  const { withWakeflowRuntimeMutation } = await mutationManager();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-effect-owner-retry-");
  bootstrapProtocol(workspaceRoot);
  const operationRef = ".wakeflow-fixture/effect-retry/operation.json";
  const externalReceiptRef = ".wakeflow-fixture/effect-retry/external-receipt.json";
  const pending = {
    effectId: "synthetic-idempotent-effect",
    revision: 1,
    status: "pending",
  };
  let pendingSnapshot;
  let effectCallCount = 0;

  await withWakeflowRuntimeMutation({
    workspaceRoot,
    operationKind: "retry-intent-create",
    domainOwner: "synthetic-retry-owner",
  }, async () => {
    pendingSnapshot = writeSyntheticOwnerRecord(workspaceRoot, operationRef, pending);
  });

  const emitSyntheticExternalEffect = () => {
    effectCallCount += 1;
    writeSyntheticOwnerRecord(workspaceRoot, externalReceiptRef, {
      effectId: pending.effectId,
      receipt: "synthetic-idempotency-receipt",
    });
  };
  emitSyntheticExternalEffect();
  assert.equal(effectCallCount, 1);

  await assert.rejects(
    () => withWakeflowRuntimeMutation({
      workspaceRoot,
      operationKind: "retry-final-record",
      domainOwner: "synthetic-retry-owner",
      onCallbackFailure: async ({ phase }) => {
        assert.equal(phase, "after-callback-settled");
        assertExactFixtureFileUnchanged(pendingSnapshot);
        const receiptBytes = readFileSync(portablePath(workspaceRoot, externalReceiptRef));
        return {
          disposition: "safe-to-release",
          closureDigests: [{
            name: "retryable-effect-closure",
            digest: canonicalJsonDigest({
              intentDigest: sha256(pendingSnapshot.bytes),
              receiptDigest: sha256(receiptBytes),
            }),
          }],
        };
      },
    }, async () => {
      assertExactFixtureFileUnchanged(pendingSnapshot);
      assert.equal(existsSync(portablePath(workspaceRoot, externalReceiptRef)), true);
      throw new Error("synthetic final-record CAS failure");
    }),
    /(?:callback-failed|synthetic final-record CAS failure)/iu,
  );
  assert.equal(effectCallCount, 1);
  assertNoMaintenanceResidue(workspaceRoot);

  const ownerState = JSON.parse(readFileSync(pendingSnapshot.target, "utf8"));
  assert.deepEqual(ownerState, pending);
  const externalReceipt = JSON.parse(
    readFileSync(portablePath(workspaceRoot, externalReceiptRef), "utf8"),
  );
  if (!externalReceipt || externalReceipt.effectId !== pending.effectId) {
    emitSyntheticExternalEffect();
  }
  assert.equal(
    effectCallCount,
    1,
    "the domain owner recognizes its durable external receipt and skips resend",
  );

  await withWakeflowRuntimeMutation({
    workspaceRoot,
    operationKind: "retry-final-record",
    domainOwner: "synthetic-retry-owner",
  }, async () => {
    pendingSnapshot = replaceSyntheticOwnerRecord(pendingSnapshot, {
      effectId: pending.effectId,
      receipt: externalReceipt.receipt,
      revision: 2,
      status: "completed",
    });
  });

  assert.equal(effectCallCount, 1);
  assert.deepEqual(JSON.parse(readFileSync(pendingSnapshot.target, "utf8")), {
    effectId: pending.effectId,
    receipt: "synthetic-idempotency-receipt",
    revision: 2,
    status: "completed",
  });
  assertNoMaintenanceResidue(workspaceRoot);
});

test("normal v3 facades do not directly import the gate-private workspace mutation manager", () => {
  const publicFacades = [
    "core/lib/wakeflow-mcp-tools.mjs",
    "core/scripts/wakeflow-cli.mjs",
    "core/scripts/wakeflow-setup.mjs",
    "core/scripts/wakeflow-smoke.mjs",
    "plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-cli.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-setup.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-smoke.mjs",
    "plugins/claude-code-wakeflow/lib/wakeflow-mcp-tools.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs",
    "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-lifecycle.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-cli.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-setup.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-smoke.mjs",
  ];

  for (const relativeFile of publicFacades) {
    const source = readFileSync(path.join(repositoryRoot, relativeFile), "utf8");
    assert.doesNotMatch(
      source,
      /wakeflow-workspace-mutation\.mjs/u,
      `${relativeFile} must remain outside the M3 private mutation-manager seam`,
    );
  }
});

function capturePathIdentity(target) {
  const stat = lstatSync(target);
  return {
    target,
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
    mode: stat.mode & 0o777,
    linkCount: stat.nlink,
    kind: stat.isSymbolicLink()
      ? "symlink"
      : stat.isDirectory()
        ? "directory"
        : stat.isFile()
          ? "file"
          : "other",
  };
}

function assertPathIdentityUnchanged(snapshot) {
  const current = capturePathIdentity(snapshot.target);
  assert.deepEqual(current, snapshot);
}

function zeroStepMaintenanceOptions(workspaceRoot, action, deriveCurrentPlan) {
  const plan = maintenancePlan();
  return {
    workspaceRoot,
    action,
    operationKind: action,
    domainOwner: action === "explicit-migration"
      ? "test-migration-manager"
      : "test-layout-manager",
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    validatePlan: validateTestPlan,
    deriveCurrentPlan,
    stepHandlers: {},
  };
}

test("explicit migration admits safe legacy 0750 and never chmods unsafe writable local roots", {
  skip: process.platform === "win32" ? "POSIX modes are required by this contract" : false,
}, async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();

  await t.test("safe legacy 0750 is admitted without implicit local-root repair", async (t) => {
    const workspaceRoot = withTempWorkspace(t, "wakeflow-migration-safe-0750-");
    const localRoot = protocolPath(workspaceRoot, localRelative);
    mkdirSync(localRoot, { mode: 0o750 });
    chmodSync(localRoot, 0o750);
    let deriveCalls = 0;

    await runWakeflowMaintenanceMutation(
      zeroStepMaintenanceOptions(workspaceRoot, "explicit-migration", async () => {
        deriveCalls += 1;
        return maintenancePlan();
      }),
    );

    assert.equal(deriveCalls, 1);
    assert.equal(lstatSync(localRoot).mode & 0o777, 0o750);
    assertPrivateDirectory(protocolPath(workspaceRoot, runtimeRelative));
    assertPrivateDirectory(protocolPath(workspaceRoot, maintenanceRelative));
    assertPrivateDirectory(protocolPath(workspaceRoot, transactionsRelative));
    assertNoMaintenanceResidue(workspaceRoot);
  });

  for (const unsafeMode of [0o775, 0o777]) {
    await t.test(`unsafe legacy 0${unsafeMode.toString(8)} is rejected without chmod or bootstrap`, async (t) => {
      const workspaceRoot = withTempWorkspace(
        t,
        `wakeflow-migration-unsafe-${unsafeMode.toString(8)}-`,
      );
      const localRoot = protocolPath(workspaceRoot, localRelative);
      mkdirSync(localRoot, { mode: unsafeMode });
      chmodSync(localRoot, unsafeMode);
      const sentinel = path.join(localRoot, "owner-sentinel.txt");
      writeFileSync(sentinel, "owner bytes stay exact\n", { mode: 0o600 });
      chmodSync(sentinel, 0o600);
      const localBefore = capturePathIdentity(localRoot);
      const sentinelBefore = captureExactFixtureFile(sentinel);
      let deriveCalls = 0;

      await assert.rejects(() => runWakeflowMaintenanceMutation(
        zeroStepMaintenanceOptions(workspaceRoot, "explicit-migration", async () => {
          deriveCalls += 1;
          return maintenancePlan();
        }),
      ));

      assert.equal(deriveCalls, 0, "unsafe mode fails before owner planning");
      assertPathIdentityUnchanged(localBefore);
      assertExactFixtureFileUnchanged(sentinelBefore);
      assert.equal(existsSync(protocolPath(workspaceRoot, runtimeRelative)), false);
    });
  }
});

test("fresh and explicit migration resume exact empty bootstrap prefixes at either deep boundary", {
  skip: process.platform === "win32" ? "POSIX modes are required by this contract" : false,
}, async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const cases = [
    { action: "fresh-initialize", missing: "maintenance", localMode: 0o700 },
    { action: "fresh-initialize", missing: "transactions", localMode: 0o700 },
    { action: "explicit-migration", missing: "maintenance", localMode: 0o750 },
    { action: "explicit-migration", missing: "transactions", localMode: 0o750 },
  ];

  for (const fixture of cases) {
    await t.test(`${fixture.action} resumes when ${fixture.missing} is the first missing root`, async (t) => {
      const workspaceRoot = withTempWorkspace(
        t,
        `wakeflow-deep-prefix-${fixture.action}-${fixture.missing}-`,
      );
      const localRoot = protocolPath(workspaceRoot, localRelative);
      mkdirSync(localRoot, { mode: fixture.localMode });
      chmodSync(localRoot, fixture.localMode);
      mkdirSync(protocolPath(workspaceRoot, runtimeRelative), { mode: 0o700 });
      chmodSync(protocolPath(workspaceRoot, runtimeRelative), 0o700);
      if (fixture.missing === "transactions") {
        mkdirSync(protocolPath(workspaceRoot, maintenanceRelative), { mode: 0o700 });
        chmodSync(protocolPath(workspaceRoot, maintenanceRelative), 0o700);
      }
      let deriveCalls = 0;

      await runWakeflowMaintenanceMutation(
        zeroStepMaintenanceOptions(workspaceRoot, fixture.action, async () => {
          deriveCalls += 1;
          return maintenancePlan();
        }),
      );

      assert.equal(deriveCalls, 1);
      assert.equal(lstatSync(localRoot).mode & 0o777, fixture.localMode);
      assertPrivateDirectory(protocolPath(workspaceRoot, runtimeRelative));
      assertPrivateDirectory(protocolPath(workspaceRoot, maintenanceRelative));
      assertPrivateDirectory(protocolPath(workspaceRoot, transactionsRelative));
      assertNoMaintenanceResidue(workspaceRoot);
    });
  }
});

test("bootstrap root type and symlink hazards fail closed at every protocol depth", {
  skip: process.platform === "win32" ? "POSIX symlink and inode evidence are required" : false,
}, async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const hazards = [
    {
      name: "local wrong-type file",
      materialize(workspaceRoot) {
        const target = protocolPath(workspaceRoot, localRelative);
        writeFileSync(target, "not a local directory\n", { mode: 0o600 });
        chmodSync(target, 0o600);
        return { target, file: true };
      },
    },
    {
      name: "runtime directory symlink",
      materialize(workspaceRoot, outsideRoot) {
        mkdirSync(protocolPath(workspaceRoot, localRelative), { mode: 0o700 });
        const target = protocolPath(workspaceRoot, runtimeRelative);
        symlinkSync(outsideRoot, target, "dir");
        return { target, file: false };
      },
    },
    {
      name: "maintenance wrong-type file",
      materialize(workspaceRoot) {
        mkdirSync(protocolPath(workspaceRoot, runtimeRelative), {
          mode: 0o700,
          recursive: true,
        });
        chmodSync(protocolPath(workspaceRoot, localRelative), 0o700);
        chmodSync(protocolPath(workspaceRoot, runtimeRelative), 0o700);
        const target = protocolPath(workspaceRoot, maintenanceRelative);
        writeFileSync(target, "not a maintenance directory\n", { mode: 0o600 });
        chmodSync(target, 0o600);
        return { target, file: true };
      },
    },
    {
      name: "transactions directory symlink",
      materialize(workspaceRoot, outsideRoot) {
        mkdirSync(protocolPath(workspaceRoot, maintenanceRelative), {
          mode: 0o700,
          recursive: true,
        });
        chmodSync(protocolPath(workspaceRoot, localRelative), 0o700);
        chmodSync(protocolPath(workspaceRoot, runtimeRelative), 0o700);
        chmodSync(protocolPath(workspaceRoot, maintenanceRelative), 0o700);
        const target = protocolPath(workspaceRoot, transactionsRelative);
        symlinkSync(outsideRoot, target, "dir");
        return { target, file: false };
      },
    },
  ];

  for (const hazard of hazards) {
    await t.test(hazard.name, async (t) => {
      const workspaceRoot = withTempWorkspace(t, "wakeflow-bootstrap-root-hazard-");
      const outsideRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-root-hazard-outside-"));
      t.after(() => rmSync(outsideRoot, { force: true, recursive: true }));
      const outsideSentinel = path.join(outsideRoot, "outside-sentinel.txt");
      writeFileSync(outsideSentinel, "outside bytes stay exact\n", { mode: 0o600 });
      chmodSync(outsideSentinel, 0o600);
      const outsideBefore = captureExactFixtureFile(outsideSentinel);
      const guarded = hazard.materialize(workspaceRoot, outsideRoot);
      const pathBefore = capturePathIdentity(guarded.target);
      const fileBefore = guarded.file ? captureExactFixtureFile(guarded.target) : null;
      const outsideEntriesBefore = readdirSync(outsideRoot).sort();
      let deriveCalls = 0;

      await assert.rejects(() => runWakeflowMaintenanceMutation(
        zeroStepMaintenanceOptions(workspaceRoot, "fresh-initialize", async () => {
          deriveCalls += 1;
          return maintenancePlan();
        }),
      ));

      assert.equal(deriveCalls, 0, "unsafe root fails before owner planning");
      assertPathIdentityUnchanged(pathBefore);
      if (fileBefore) assertExactFixtureFileUnchanged(fileBefore);
      assertExactFixtureFileUnchanged(outsideBefore);
      assert.deepEqual(readdirSync(outsideRoot).sort(), outsideEntriesBefore);
      assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
    });
  }
});

test("strict transaction residue rejects unknown, corrupt, wrong-mode, and hardlinked artifacts without mutation", {
  skip: process.platform === "win32" ? "POSIX mode and hardlink evidence are required" : false,
}, async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const residueCases = [
    {
      name: "unknown artifact",
      materialize(workspaceRoot) {
        const target = protocolPath(workspaceRoot, `${transactionsRelative}/unknown.residue`);
        writeFileSync(target, "unknown protocol bytes\n", { mode: 0o600 });
        chmodSync(target, 0o600);
        return [];
      },
    },
    {
      name: "corrupt journal",
      materialize(workspaceRoot) {
        const target = protocolPath(
          workspaceRoot,
          `${transactionsRelative}/${operationId()}.json`,
        );
        writeFileSync(target, "{\"broken\":\n", { mode: 0o600 });
        chmodSync(target, 0o600);
        return [];
      },
    },
    {
      name: "wrong-mode journal",
      materialize(workspaceRoot) {
        const fixture = makeRecoveryFixture(workspaceRoot, "create-or-update");
        chmodSync(fixture.journalFile, 0o644);
        return [];
      },
    },
    {
      name: "hardlinked journal",
      materialize(workspaceRoot, outsideRoot) {
        const fixture = makeRecoveryFixture(workspaceRoot, "create-or-update");
        const original = path.join(outsideRoot, "original-journal.json");
        linkSync(fixture.journalFile, original);
        return [captureExactFixtureFile(original)];
      },
    },
    {
      name: "noncanonical checkpoint-stage generation alias",
      materialize(workspaceRoot) {
        const target = protocolPath(
          workspaceRoot,
          `${transactionsRelative}/.${operationId()}.01.checkpoint-stage`,
        );
        writeFileSync(target, "noncanonical checkpoint stage stays exact\n", { mode: 0o600 });
        chmodSync(target, 0o600);
        return [];
      },
    },
    {
      name: "unsafe-integer recovery-claim filename",
      materialize(workspaceRoot) {
        const target = protocolPath(
          workspaceRoot,
          `${transactionsRelative}/${operationId()}.recovery-9007199254740992.json`,
        );
        writeFileSync(target, "unsafe generation claim stays exact\n", { mode: 0o600 });
        chmodSync(target, 0o600);
        return [];
      },
    },
  ];

  for (const residue of residueCases) {
    await t.test(residue.name, async (t) => {
      const workspaceRoot = withTempWorkspace(t, "wakeflow-strict-residue-");
      bootstrapProtocol(workspaceRoot);
      const outsideRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-residue-outside-"));
      t.after(() => rmSync(outsideRoot, { force: true, recursive: true }));
      const outsideSentinel = path.join(outsideRoot, "outside-sentinel.txt");
      writeFileSync(outsideSentinel, "outside bytes stay exact\n", { mode: 0o600 });
      chmodSync(outsideSentinel, 0o600);
      const outsideBefore = captureExactFixtureFile(outsideSentinel);
      const extraOutsideEvidence = residue.materialize(workspaceRoot, outsideRoot);
      const evidenceBefore = captureMutationEvidence(workspaceRoot);
      const transactionEntriesBefore = readdirSync(
        protocolPath(workspaceRoot, transactionsRelative),
      ).sort();
      const outsideEntriesBefore = readdirSync(outsideRoot).sort();
      let deriveCalls = 0;

      await assert.rejects(() => runWakeflowMaintenanceMutation(
        zeroStepMaintenanceOptions(workspaceRoot, "reconcile", async () => {
          deriveCalls += 1;
          return maintenancePlan();
        }),
      ));

      assert.equal(deriveCalls, 0, "strict residue fails before owner planning");
      assertMutationEvidenceUnchanged(workspaceRoot, evidenceBefore);
      for (const snapshot of extraOutsideEvidence) assertExactFixtureFileUnchanged(snapshot);
      assertExactFixtureFileUnchanged(outsideBefore);
      assert.deepEqual(
        readdirSync(protocolPath(workspaceRoot, transactionsRelative)).sort(),
        transactionEntriesBefore,
      );
      assert.deepEqual(readdirSync(outsideRoot).sort(), outsideEntriesBefore);
      assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
    });
  }
});
