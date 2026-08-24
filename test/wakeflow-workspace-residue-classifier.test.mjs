import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const managerUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-workspace-mutation.mjs",
)).href;

const localRef = ".wakeflow-local";
const runtimeRef = `${localRef}/runtime`;
const maintenanceRef = `${runtimeRef}/maintenance`;
const transactionsRef = `${maintenanceRef}/transactions`;
const lockRef = `${runtimeRef}/maintenance.lock`;
const supportedPlatform = process.platform === "darwin" || process.platform === "linux";
const platformTest = {
  skip: supportedPlatform ? false : "the workspace mutation protocol supports Darwin and Linux",
};

async function mutationManager() {
  return import(managerUrl);
}

function tempWorkspace(t, prefix) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(workspaceRoot, { force: true, recursive: true }));
  return workspaceRoot;
}

function portablePath(workspaceRoot, ref) {
  assert.equal(path.isAbsolute(ref), false);
  const target = path.resolve(workspaceRoot, ...ref.split("/"));
  assert.ok(target.startsWith(`${path.resolve(workspaceRoot)}${path.sep}`));
  return target;
}

function bootstrapProtocol(workspaceRoot, { maintenance = true, transactions = true } = {}) {
  mkdirSync(portablePath(workspaceRoot, localRef), { mode: 0o700 });
  mkdirSync(portablePath(workspaceRoot, runtimeRef), { mode: 0o700 });
  if (maintenance) {
    mkdirSync(portablePath(workspaceRoot, maintenanceRef), { mode: 0o700 });
  }
  if (transactions) {
    assert.equal(maintenance, true, "transactions require their maintenance parent");
    mkdirSync(portablePath(workspaceRoot, transactionsRef), { mode: 0o700 });
  }
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function operationId() {
  return `workspace-mutation_${randomUUID()}`;
}

function ownerToken() {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function maintenancePlan(steps = []) {
  return {
    schemaId: "urn:wakeflow:internal:test-residue-classifier-plan:v1",
    payload: { steps },
  };
}

async function validateTestPlan(input) {
  assert.deepEqual(Object.keys(input), ["plan"]);
  assert.deepEqual(Object.keys(input.plan).sort(), ["payload", "schemaId"]);
  assert.equal(input.plan.schemaId, "urn:wakeflow:internal:test-residue-classifier-plan:v1");
  assert.deepEqual(Object.keys(input.plan.payload), ["steps"]);
  assert.equal(Array.isArray(input.plan.payload.steps), true);
  return { valid: true };
}

function modeString(mode) {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

function resource(ref, type, { mode = null, digest = null } = {}) {
  return type === "absent" ? { ref, type } : { ref, type, mode, digest };
}

function observeResource(workspaceRoot, contract) {
  const target = portablePath(workspaceRoot, contract.ref);
  if (!existsSync(target)) return { ref: contract.ref, type: "absent" };
  const stat = lstatSync(target);
  assert.equal(stat.isSymbolicLink(), false);
  if (stat.isDirectory()) {
    return { ref: contract.ref, type: "directory", mode: modeString(stat.mode), digest: null };
  }
  assert.equal(stat.isFile(), true);
  return {
    ref: contract.ref,
    type: "file",
    mode: modeString(stat.mode),
    digest: sha256(readFileSync(target)),
  };
}

function observeStep(workspaceRoot, step) {
  return {
    source: observeResource(workspaceRoot, step.source),
    staging: step.staging === null ? null : observeResource(workspaceRoot, step.staging),
    final: observeResource(workspaceRoot, step.final),
  };
}

function writePrivateFile(workspaceRoot, ref, bytes, { exclusive = true } = {}) {
  const target = portablePath(workspaceRoot, ref);
  mkdirSync(path.dirname(target), { mode: 0o700, recursive: true });
  writeFileSync(target, bytes, {
    flag: exclusive ? "wx" : "w",
    mode: 0o600,
  });
  chmodSync(target, 0o600);
  return target;
}

function writeCanonicalPrivateFile(workspaceRoot, ref, value) {
  return writePrivateFile(workspaceRoot, ref, Buffer.from(`${canonicalJson(value)}\n`, "utf8"));
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

function treeEvidence(workspaceRoot) {
  const evidence = [];
  function visit(target, ref) {
    const stat = lstatSync(target, { bigint: true });
    const entry = {
      ref,
      deviceId: String(stat.dev),
      inodeId: String(stat.ino),
      mode: String(stat.mode & 0o777n),
      linkCount: String(stat.nlink),
      size: String(stat.size),
      mtimeNs: String(stat.mtimeNs),
      ctimeNs: String(stat.ctimeNs),
      type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
    };
    if (stat.isFile()) entry.digest = sha256(readFileSync(target));
    evidence.push(entry);
    if (!stat.isDirectory()) return;
    for (const name of readdirSync(target).sort()) {
      visit(path.join(target, name), ref === "." ? name : `${ref}/${name}`);
    }
  }
  visit(workspaceRoot, ".");
  return evidence;
}

async function rejectedWithCode(run, expectedCode) {
  let rejection = null;
  try {
    await run();
  } catch (error) {
    rejection = error;
  }
  assert.ok(rejection, `expected ${expectedCode}`);
  assert.equal(rejection.code, expectedCode, rejection.stack ?? rejection.message);
  return rejection;
}

function inspectRejectedWithCode(run, expectedCode) {
  let rejection = null;
  try {
    run();
  } catch (error) {
    rejection = error;
  }
  assert.ok(rejection, `expected ${expectedCode}`);
  assert.equal(rejection.code, expectedCode, rejection.stack ?? rejection.message);
  return rejection;
}

function emptyMaintenanceOptions(workspaceRoot, action, onDerive) {
  const plan = maintenancePlan();
  return {
    workspaceRoot,
    action,
    operationKind: action,
    domainOwner: "residue-classifier-test",
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    validatePlan: validateTestPlan,
    deriveCurrentPlan: async () => {
      onDerive();
      return plan;
    },
    stepHandlers: {},
  };
}

async function seedRelinquishedJournal(t, prefix) {
  const { runWakeflowMaintenanceMutation } = await mutationManager();
  const workspaceRoot = tempWorkspace(t, prefix);
  bootstrapProtocol(workspaceRoot);
  const payload = Buffer.from(`classifier payload ${randomUUID()}\n`, "utf8");
  const fixtureRoot = `.wakeflow-fixture/residue-classifier-${randomUUID()}`;
  const finalRef = `${fixtureRoot}/final.txt`;
  const stageRef = `${fixtureRoot}/final.stage`;
  const step = {
    stepId: "classifier-create",
    ordinal: 0,
    stepKind: "create-or-update",
    source: resource(finalRef, "absent"),
    staging: resource(stageRef, "file", { mode: "0600", digest: sha256(payload) }),
    final: resource(finalRef, "file", { mode: "0600", digest: sha256(payload) }),
  };
  const plan = maintenancePlan([step]);
  const state = { failCommit: true };
  const stepHandlers = {
    [step.stepId]: {
      prepare: async () => {
        writePrivateFile(workspaceRoot, stageRef, payload);
      },
      observe: async () => observeStep(workspaceRoot, step),
      commit: async () => {
        if (state.failCommit) throw new Error("intentional classifier fixture commit stop");
        renameSync(portablePath(workspaceRoot, stageRef), portablePath(workspaceRoot, finalRef));
      },
    },
  };
  const deriveTerminalClosure = ({ planDigest }) => ({
    planDigest,
    closureDigests: [{
      name: "classifier-fixture",
      digest: canonicalJsonDigest({
        planDigest,
        final: observeResource(workspaceRoot, step.final),
      }),
    }],
  });

  await rejectedWithCode(() => runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "reconcile",
    operationKind: "reconcile",
    domainOwner: "residue-classifier-test",
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    validatePlan: validateTestPlan,
    deriveCurrentPlan: async () => plan,
    deriveTerminalClosure,
    stepHandlers,
  }), "wakeflow-mutation-recovery-required");

  const journalNames = readdirSync(portablePath(workspaceRoot, transactionsRef)).filter(
    (name) => name.endsWith(".json") && !name.includes(".recovery-"),
  );
  assert.equal(journalNames.length, 1);
  const journalRef = `${transactionsRef}/${journalNames[0]}`;
  const journalFile = portablePath(workspaceRoot, journalRef);
  const journal = JSON.parse(readFileSync(journalFile, "utf8"));
  assert.equal(journal.ownerDisposition, "relinquished");
  assert.equal(journal.phase, "incomplete");
  assert.equal(journal.recoveryGeneration, 0);
  assert.equal(existsSync(portablePath(workspaceRoot, lockRef)), false);

  return {
    deriveTerminalClosure,
    finalRef,
    journal,
    journalFile,
    journalRef,
    operationId: journal.operationId,
    payload,
    plan,
    stageRef,
    state,
    stepHandlers,
    workspaceRoot,
  };
}

async function seedExactCurrentCheckpointStage(t, prefix) {
  const fixture = await seedRelinquishedJournal(t, prefix);
  const checkpointRef = `${transactionsRef}/.${fixture.operationId}.${fixture.journal.recoveryGeneration}.checkpoint-stage`;
  writePrivateFile(fixture.workspaceRoot, checkpointRef, readFileSync(fixture.journalFile));
  return { ...fixture, checkpointRef };
}

const interruptCheckpointPublicationChild = String.raw`
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const config = JSON.parse(process.argv[1]);
const payload = Buffer.from(config.payloadBase64, "base64");
const step = config.plan.payload.steps[0];
const originalRenameSync = fs.renameSync;

function target(ref) {
  return path.resolve(config.workspaceRoot, ...ref.split("/"));
}

function sha256(value) {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}

function modeString(mode) {
  return "0" + (mode & 0o777).toString(8).padStart(3, "0");
}

function observe(contract) {
  const candidate = target(contract.ref);
  if (!fs.existsSync(candidate)) return { ref: contract.ref, type: "absent" };
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unexpected fixture artifact: " + contract.ref);
  return {
    ref: contract.ref,
    type: "file",
    mode: modeString(stat.mode),
    digest: sha256(fs.readFileSync(candidate)),
  };
}

fs.renameSync = (source, destination) => {
  const sourcePath = String(source);
  const destinationPath = String(destination);
  const isCheckpointPublication = path.dirname(sourcePath) === path.dirname(destinationPath)
    && /^\.workspace-mutation_[0-9a-f-]+\.(?:0|[1-9][0-9]*)\.checkpoint-stage$/u.test(path.basename(sourcePath))
    && /^workspace-mutation_[0-9a-f-]+\.json$/u.test(path.basename(destinationPath));
  if (isCheckpointPublication) {
    fs.writeFileSync(config.markerFile, "checkpoint-stage-published\n", {
      flag: "wx",
      mode: 0o600,
    });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    throw new Error("checkpoint publication interruption was not terminated");
  }
  return originalRenameSync(source, destination);
};
syncBuiltinESMExports();

const { runWakeflowMaintenanceMutation } = await import(config.managerUrl);
await runWakeflowMaintenanceMutation({
  workspaceRoot: config.workspaceRoot,
  action: "reconcile",
  operationKind: "reconcile",
  domainOwner: "residue-classifier-test",
  acquireTimeoutMs: 0,
  confirmedPlan: config.plan,
  planDigest: config.planDigest,
  validatePlan: async () => ({ valid: true }),
  deriveCurrentPlan: async () => config.plan,
  deriveTerminalClosure: ({ planDigest }) => ({
    planDigest,
    closureDigests: [{
      name: "classifier-fixture",
      digest: "sha256:" + "0".repeat(64),
    }],
  }),
  stepHandlers: {
    [step.stepId]: {
      prepare: async () => {
        fs.mkdirSync(path.dirname(target(step.staging.ref)), { mode: 0o700, recursive: true });
        fs.writeFileSync(target(step.staging.ref), payload, { flag: "wx", mode: 0o600 });
        fs.chmodSync(target(step.staging.ref), 0o600);
      },
      observe: async () => ({
        source: observe(step.source),
        staging: observe(step.staging),
        final: observe(step.final),
      }),
      commit: async () => {
        fs.renameSync(target(step.staging.ref), target(step.final.ref));
      },
    },
  },
});
`;

async function waitForCheckpointPublication(child, markerFile, diagnostics) {
  const deadline = Date.now() + 10_000;
  while (!existsSync(markerFile)) {
    if (child.exitCode !== null || child.signalCode !== null) {
      assert.fail(`checkpoint fixture producer exited before publication interruption\n${diagnostics()}`);
    }
    if (Date.now() >= deadline) {
      assert.fail(`checkpoint fixture producer did not reach publication interruption\n${diagnostics()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function seedProducerInterruptedCheckpointSuccessor(t, prefix) {
  const workspaceRoot = tempWorkspace(t, prefix);
  bootstrapProtocol(workspaceRoot);
  const payload = Buffer.from(`classifier producer payload ${randomUUID()}\n`, "utf8");
  const fixtureRoot = `.wakeflow-fixture/residue-classifier-${randomUUID()}`;
  const finalRef = `${fixtureRoot}/final.txt`;
  const stageRef = `${fixtureRoot}/final.stage`;
  const step = {
    stepId: "classifier-create",
    ordinal: 0,
    stepKind: "create-or-update",
    source: resource(finalRef, "absent"),
    staging: resource(stageRef, "file", { mode: "0600", digest: sha256(payload) }),
    final: resource(finalRef, "file", { mode: "0600", digest: sha256(payload) }),
  };
  const plan = maintenancePlan([step]);
  const markerFile = path.join(os.tmpdir(), `wakeflow-checkpoint-publication-${randomUUID()}.ready`);
  let stdout = "";
  let stderr = "";
  const child = spawn(process.execPath, [
    "--input-type=module",
    "--eval",
    interruptCheckpointPublicationChild,
    JSON.stringify({
      managerUrl,
      markerFile,
      payloadBase64: payload.toString("base64"),
      plan,
      planDigest: canonicalJsonDigest(plan),
      workspaceRoot,
    }),
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exit = once(child, "exit");
  const diagnostics = () => [
    `exitCode=${child.exitCode} signalCode=${child.signalCode}`,
    stdout ? `stdout:\n${stdout}` : "stdout: <empty>",
    stderr ? `stderr:\n${stderr}` : "stderr: <empty>",
  ].join("\n");
  t.after(async () => {
    if (existsSync(markerFile)) unlinkSync(markerFile);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exit.catch(() => {});
  });

  await waitForCheckpointPublication(child, markerFile, diagnostics);
  unlinkSync(markerFile);
  assert.equal(child.kill("SIGKILL"), true, diagnostics());
  const [exitCode, signalCode] = await exit;
  assert.equal(exitCode, null, diagnostics());
  assert.equal(signalCode, "SIGKILL", diagnostics());

  const names = readdirSync(portablePath(workspaceRoot, transactionsRef)).sort();
  const journalNames = names.filter((name) => !name.startsWith(".") && name.endsWith(".json"));
  const checkpointNames = names.filter((name) => name.endsWith(".checkpoint-stage"));
  assert.equal(journalNames.length, 1);
  assert.equal(checkpointNames.length, 1);
  assert.deepEqual(names, [...journalNames, ...checkpointNames].sort());
  const journalRef = `${transactionsRef}/${journalNames[0]}`;
  const checkpointRef = `${transactionsRef}/${checkpointNames[0]}`;
  const journalFile = portablePath(workspaceRoot, journalRef);
  const checkpointFile = portablePath(workspaceRoot, checkpointRef);
  const journal = JSON.parse(readFileSync(journalFile, "utf8"));
  const checkpoint = JSON.parse(readFileSync(checkpointFile, "utf8"));
  const lock = JSON.parse(readFileSync(portablePath(workspaceRoot, lockRef), "utf8"));

  assert.equal(journal.ownerDisposition, "active");
  assert.equal(journal.phase, "incomplete");
  assert.equal(journal.recoveryGeneration, 0);
  assert.equal(journal.checkpoint, 0);
  assert.equal(journal.steps[0].status, "planned");
  assert.equal(checkpoint.ownerToken, journal.ownerToken);
  assert.equal(checkpoint.recoveryGeneration, journal.recoveryGeneration);
  assert.deepEqual(checkpoint.processIdentity, journal.processIdentity);
  assert.equal(checkpoint.ownerDisposition, journal.ownerDisposition);
  assert.equal(checkpoint.phase, journal.phase);
  assert.equal(checkpoint.checkpoint, journal.checkpoint + 1);
  assert.equal(checkpoint.steps[0].status, "prepared");
  assert.notDeepEqual(readFileSync(checkpointFile), readFileSync(journalFile));
  assert.equal(lock.operationId, journal.operationId);
  assert.equal(lock.ownerToken, journal.ownerToken);
  assert.deepEqual(lock.processIdentity, journal.processIdentity);
  assert.equal(lock.processIdentity.pid, child.pid);
  assert.equal(
    treeEvidence(workspaceRoot).some((entry) => path.basename(entry.ref).startsWith(".wakeflow-publish.")),
    false,
  );

  const state = { commitCalls: 0, prepareCalls: 0 };
  const stepHandlers = {
    [step.stepId]: {
      prepare: async () => {
        state.prepareCalls += 1;
        assert.fail("recovery must adopt the producer-created prepared artifact");
      },
      observe: async () => observeStep(workspaceRoot, step),
      commit: async () => {
        state.commitCalls += 1;
        renameSync(portablePath(workspaceRoot, stageRef), portablePath(workspaceRoot, finalRef));
      },
    },
  };
  const deriveTerminalClosure = ({ planDigest }) => ({
    planDigest,
    closureDigests: [{
      name: "classifier-fixture",
      digest: canonicalJsonDigest({
        planDigest,
        final: observeResource(workspaceRoot, step.final),
      }),
    }],
  });

  return {
    checkpoint,
    checkpointRef,
    deriveTerminalClosure,
    finalRef,
    journal,
    journalFile,
    journalRef,
    operationId: journal.operationId,
    payload,
    plan,
    stageRef,
    state,
    stepHandlers,
    workspaceRoot,
  };
}

function recoveryOptions(fixture, onDerive = () => {}) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    operationId: fixture.operationId,
    confirmedPlan: fixture.plan,
    planDigest: canonicalJsonDigest(fixture.plan),
    validatePlan: validateTestPlan,
    deriveCurrentPlan: async () => {
      onDerive();
      return fixture.plan;
    },
    deriveTerminalClosure: fixture.deriveTerminalClosure,
    stepHandlers: fixture.stepHandlers,
  };
}

function seedSecondExactCheckpointStage(fixture) {
  const generation = 1;
  const claimRef = `${transactionsRef}/${fixture.operationId}.recovery-${generation}.json`;
  const nextOwnerToken = ownerToken();
  const nextProcessIdentity = {
    platform: process.platform,
    pid: 2_147_483_646,
    startIdentity: sha256(`classifier-next-owner-${fixture.operationId}`),
  };
  const acquiredAt = "2026-08-08T00:00:00.000Z";
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
      ownerToken: nextOwnerToken,
      recoveryGeneration: generation,
      processIdentity: nextProcessIdentity,
      acquiredAt,
    },
    previousJournal: portableFileArtifact(fixture.workspaceRoot, fixture.journalRef),
    previousLock: absentArtifact(lockRef),
    previousClaim: absentArtifact(`${transactionsRef}/${fixture.operationId}.recovery-0.json`),
    createdAt: acquiredAt,
  };
  writeCanonicalPrivateFile(fixture.workspaceRoot, claimRef, claim);
  const recoveryClaim = {
    ref: claimRef,
    generation,
    digest: canonicalJsonDigest(claim),
  };
  const successor = {
    ...fixture.journal,
    ownerToken: nextOwnerToken,
    recoveryGeneration: generation,
    processIdentity: nextProcessIdentity,
    ownerDisposition: "active",
    recoveryClaim,
    checkpoint: fixture.journal.checkpoint + 1,
  };
  const checkpointRef = `${transactionsRef}/.${fixture.operationId}.${generation}.checkpoint-stage`;
  writeCanonicalPrivateFile(fixture.workspaceRoot, checkpointRef, successor);
  return { checkpointRef, claimRef };
}

function publisherStageRef(id) {
  const startIdentity = sha256(`publisher-${id}`).slice("sha256:".length);
  const nonce = createHash("sha256").update(randomUUID()).digest("hex").slice(0, 32);
  return `${runtimeRef}/.wakeflow-publish.lock.${id}.0.${process.platform}.2147483647.${startIdentity}.${nonce}.stage`;
}

test("an exact current checkpoint stage is reported as recovery-required without inspection writes", platformTest, async (t) => {
  const { inspectWakeflowWorkspaceMutation } = await mutationManager();
  const fixture = await seedExactCurrentCheckpointStage(t, "wakeflow-residue-inspect-");
  const before = treeEvidence(fixture.workspaceRoot);

  assert.deepEqual(inspectWakeflowWorkspaceMutation({ workspaceRoot: fixture.workspaceRoot }), {
    state: "recovery-required",
    lock: null,
    operations: [fixture.operationId],
  });
  assert.deepEqual(treeEvidence(fixture.workspaceRoot), before);
});

test("an exact current checkpoint stage blocks every normal admission before gate creation", platformTest, async (t) => {
  const {
    runWakeflowMaintenanceMutation,
    withWakeflowRuntimeMutation,
  } = await mutationManager();

  for (const admission of ["runtime", "maintenance", "fresh"]) {
    await t.test(admission, async (t) => {
      const fixture = await seedExactCurrentCheckpointStage(t, `wakeflow-residue-${admission}-`);
      const before = treeEvidence(fixture.workspaceRoot);
      let callbackCalls = 0;
      let deriveCalls = 0;

      if (admission === "runtime") {
        await rejectedWithCode(() => withWakeflowRuntimeMutation({
          workspaceRoot: fixture.workspaceRoot,
          operationKind: "classifier-runtime",
          domainOwner: "residue-classifier-test",
          acquireTimeoutMs: 0,
        }, async () => {
          callbackCalls += 1;
        }), "wakeflow-mutation-recovery-required");
      } else {
        const action = admission === "fresh" ? "fresh-initialize" : "reconcile";
        await rejectedWithCode(() => runWakeflowMaintenanceMutation(
          emptyMaintenanceOptions(fixture.workspaceRoot, action, () => {
            deriveCalls += 1;
          }),
        ), "wakeflow-mutation-recovery-required");
      }

      assert.equal(callbackCalls, 0);
      assert.equal(deriveCalls, 0);
      assert.deepEqual(treeEvidence(fixture.workspaceRoot), before);
    });
  }
});

test("explicit recovery consumes one exact current checkpoint stage and completes the journal", platformTest, async (t) => {
  const {
    inspectWakeflowWorkspaceMutation,
    recoverWakeflowWorkspaceMutation,
  } = await mutationManager();
  const fixture = await seedExactCurrentCheckpointStage(t, "wakeflow-residue-recover-");
  fixture.state.failCommit = false;

  const result = await recoverWakeflowWorkspaceMutation(recoveryOptions(fixture));

  assert.equal(result.status, "recovered");
  assert.equal(readFileSync(portablePath(fixture.workspaceRoot, fixture.finalRef), "utf8"), fixture.payload.toString());
  assert.equal(existsSync(portablePath(fixture.workspaceRoot, fixture.stageRef)), false);
  assert.equal(existsSync(portablePath(fixture.workspaceRoot, fixture.checkpointRef)), false);
  assert.equal(existsSync(portablePath(fixture.workspaceRoot, lockRef)), false);
  assert.deepEqual(readdirSync(portablePath(fixture.workspaceRoot, transactionsRef)), []);
  assert.deepEqual(inspectWakeflowWorkspaceMutation({ workspaceRoot: fixture.workspaceRoot }), {
    state: "idle",
    lock: null,
    operations: [],
  });
});

test("a producer-interrupted exact checkpoint successor blocks admissions and recovers", platformTest, async (t) => {
  const {
    inspectWakeflowWorkspaceMutation,
    recoverWakeflowWorkspaceMutation,
    runWakeflowMaintenanceMutation,
    withWakeflowRuntimeMutation,
  } = await mutationManager();
  const fixture = await seedProducerInterruptedCheckpointSuccessor(
    t,
    "wakeflow-residue-producer-successor-",
  );
  const before = treeEvidence(fixture.workspaceRoot);
  let callbackCalls = 0;
  let deriveCalls = 0;

  assert.deepEqual(inspectWakeflowWorkspaceMutation({ workspaceRoot: fixture.workspaceRoot }), {
    state: "recovery-required",
    lock: {
      operationId: fixture.operationId,
      mode: "maintenance",
      operationKind: "reconcile",
      domainOwner: "residue-classifier-test",
      recoveryGeneration: 0,
    },
    operations: [fixture.operationId],
  });
  assert.deepEqual(treeEvidence(fixture.workspaceRoot), before);

  await rejectedWithCode(() => withWakeflowRuntimeMutation({
    workspaceRoot: fixture.workspaceRoot,
    operationKind: "classifier-runtime",
    domainOwner: "residue-classifier-test",
    acquireTimeoutMs: 0,
  }, async () => {
    callbackCalls += 1;
  }), "wakeflow-mutation-recovery-required");
  assert.deepEqual(treeEvidence(fixture.workspaceRoot), before);

  for (const action of ["reconcile", "fresh-initialize"]) {
    await rejectedWithCode(() => runWakeflowMaintenanceMutation(
      emptyMaintenanceOptions(fixture.workspaceRoot, action, () => {
        deriveCalls += 1;
      }),
    ), "wakeflow-mutation-recovery-required");
    assert.deepEqual(treeEvidence(fixture.workspaceRoot), before);
  }
  assert.equal(callbackCalls, 0);
  assert.equal(deriveCalls, 0);

  const result = await recoverWakeflowWorkspaceMutation(recoveryOptions(fixture));

  assert.equal(result.status, "recovered");
  assert.equal(fixture.state.prepareCalls, 0);
  assert.equal(fixture.state.commitCalls, 1);
  assert.equal(
    readFileSync(portablePath(fixture.workspaceRoot, fixture.finalRef), "utf8"),
    fixture.payload.toString(),
  );
  assert.equal(existsSync(portablePath(fixture.workspaceRoot, fixture.stageRef)), false);
  assert.equal(existsSync(portablePath(fixture.workspaceRoot, fixture.checkpointRef)), false);
  assert.equal(existsSync(portablePath(fixture.workspaceRoot, lockRef)), false);
  assert.deepEqual(readdirSync(portablePath(fixture.workspaceRoot, transactionsRef)), []);
  assert.deepEqual(inspectWakeflowWorkspaceMutation({ workspaceRoot: fixture.workspaceRoot }), {
    state: "idle",
    lock: null,
    operations: [],
  });
});

test("stage-only and multiple exact checkpoint stages are manual and evidence-preserving", platformTest, async (t) => {
  const {
    inspectWakeflowWorkspaceMutation,
    recoverWakeflowWorkspaceMutation,
    runWakeflowMaintenanceMutation,
    withWakeflowRuntimeMutation,
  } = await mutationManager();

  for (const residue of ["stage-only", "multiple-exact-stages"]) {
    await t.test(residue, async (t) => {
      const fixture = await seedExactCurrentCheckpointStage(t, `wakeflow-residue-${residue}-`);
      if (residue === "stage-only") unlinkSync(fixture.journalFile);
      else seedSecondExactCheckpointStage(fixture);
      const before = treeEvidence(fixture.workspaceRoot);
      let callbackCalls = 0;
      let deriveCalls = 0;

      inspectRejectedWithCode(
        () => inspectWakeflowWorkspaceMutation({ workspaceRoot: fixture.workspaceRoot }),
        "wakeflow-mutation-manual-recovery",
      );
      await rejectedWithCode(() => withWakeflowRuntimeMutation({
        workspaceRoot: fixture.workspaceRoot,
        operationKind: "classifier-runtime",
        domainOwner: "residue-classifier-test",
        acquireTimeoutMs: 0,
      }, async () => {
        callbackCalls += 1;
      }), "wakeflow-mutation-manual-recovery");
      await rejectedWithCode(() => runWakeflowMaintenanceMutation(
        emptyMaintenanceOptions(fixture.workspaceRoot, "reconcile", () => {
          deriveCalls += 1;
        }),
      ), "wakeflow-mutation-manual-recovery");
      await rejectedWithCode(() => recoverWakeflowWorkspaceMutation(
        recoveryOptions(fixture, () => {
          deriveCalls += 1;
        }),
      ), "wakeflow-mutation-manual-recovery");

      assert.equal(callbackCalls, 0);
      assert.equal(deriveCalls, 0);
      assert.deepEqual(treeEvidence(fixture.workspaceRoot), before);
    });
  }
});

test("a runtime publisher blocks deep bootstrap before transactions or a gate are created", platformTest, async (t) => {
  const {
    inspectWakeflowWorkspaceMutation,
    runWakeflowMaintenanceMutation,
  } = await mutationManager();
  const workspaceRoot = tempWorkspace(t, "wakeflow-residue-missing-transactions-");
  bootstrapProtocol(workspaceRoot, { transactions: false });
  const id = operationId();
  const publisherRef = publisherStageRef(id);
  writePrivateFile(workspaceRoot, publisherRef, Buffer.from("partial publisher stage\n", "utf8"));
  const before = treeEvidence(workspaceRoot);
  let deriveCalls = 0;

  assert.deepEqual(inspectWakeflowWorkspaceMutation({ workspaceRoot }), {
    state: "recovery-required",
    lock: null,
    operations: [id],
  });
  await rejectedWithCode(() => runWakeflowMaintenanceMutation(
    emptyMaintenanceOptions(workspaceRoot, "explicit-migration", () => {
      deriveCalls += 1;
    }),
  ), "wakeflow-mutation-recovery-required");

  assert.equal(deriveCalls, 0);
  assert.equal(existsSync(portablePath(workspaceRoot, maintenanceRef)), true);
  assert.equal(existsSync(portablePath(workspaceRoot, transactionsRef)), false);
  assert.equal(existsSync(portablePath(workspaceRoot, lockRef)), false);
  assert.deepEqual(treeEvidence(workspaceRoot), before);
});

test("fresh initialization routes protocol residue through the shared classifier", platformTest, async (t) => {
  const { runWakeflowMaintenanceMutation } = await mutationManager();

  await t.test("canonical journal is recovery-required", async (t) => {
    const fixture = await seedRelinquishedJournal(t, "wakeflow-fresh-journal-residue-");
    const before = treeEvidence(fixture.workspaceRoot);
    let deriveCalls = 0;
    const error = await rejectedWithCode(() => runWakeflowMaintenanceMutation(
      emptyMaintenanceOptions(fixture.workspaceRoot, "fresh-initialize", () => {
        deriveCalls += 1;
      }),
    ), "wakeflow-mutation-recovery-required");
    assert.notEqual(error.code, "wakeflow-mutation-fresh-footprint");
    assert.equal(deriveCalls, 0);
    assert.deepEqual(treeEvidence(fixture.workspaceRoot), before);
  });

  await t.test("canonical publisher is recovery-required", async (t) => {
    const workspaceRoot = tempWorkspace(t, "wakeflow-fresh-publisher-residue-");
    bootstrapProtocol(workspaceRoot, { transactions: false });
    const id = operationId();
    writePrivateFile(
      workspaceRoot,
      publisherStageRef(id),
      Buffer.from("partial fresh publisher stage\n", "utf8"),
    );
    const before = treeEvidence(workspaceRoot);
    let deriveCalls = 0;
    const error = await rejectedWithCode(() => runWakeflowMaintenanceMutation(
      emptyMaintenanceOptions(workspaceRoot, "fresh-initialize", () => {
        deriveCalls += 1;
      }),
    ), "wakeflow-mutation-recovery-required");
    assert.notEqual(error.code, "wakeflow-mutation-fresh-footprint");
    assert.equal(deriveCalls, 0);
    assert.deepEqual(treeEvidence(workspaceRoot), before);
  });

  await t.test("noncanonical checkpoint stage is manual", async (t) => {
    const workspaceRoot = tempWorkspace(t, "wakeflow-fresh-noncanonical-stage-");
    bootstrapProtocol(workspaceRoot);
    const id = operationId();
    writePrivateFile(
      workspaceRoot,
      `${transactionsRef}/.${id}.01.checkpoint-stage`,
      Buffer.from("noncanonical checkpoint stage\n", "utf8"),
    );
    const before = treeEvidence(workspaceRoot);
    let deriveCalls = 0;
    const error = await rejectedWithCode(() => runWakeflowMaintenanceMutation(
      emptyMaintenanceOptions(workspaceRoot, "fresh-initialize", () => {
        deriveCalls += 1;
      }),
    ), "wakeflow-mutation-manual-recovery");
    assert.notEqual(error.code, "wakeflow-mutation-fresh-footprint");
    assert.equal(deriveCalls, 0);
    assert.deepEqual(treeEvidence(workspaceRoot), before);
  });
});
