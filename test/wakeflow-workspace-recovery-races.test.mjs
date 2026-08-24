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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  recoverWakeflowWorkspaceMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";

const LOCAL_REF = ".wakeflow-local";
const RUNTIME_REF = `${LOCAL_REF}/runtime`;
const MAINTENANCE_REF = `${RUNTIME_REF}/maintenance`;
const TRANSACTIONS_REF = `${MAINTENANCE_REF}/transactions`;
const LOCK_REF = `${RUNTIME_REF}/maintenance.lock`;
const TIMESTAMP = "2026-08-08T00:00:00.000Z";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MUTATION_MANAGER_FILE = path.join(
  REPOSITORY_ROOT,
  "core/scripts/lib/wakeflow-workspace-mutation.mjs",
);
const CANONICAL_JSON_FILE = path.join(
  REPOSITORY_ROOT,
  "core/scripts/lib/wakeflow-canonical-json.mjs",
);

const settlementFaultPreloadSource = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");

const mode = process.env.WAKEFLOW_SETTLEMENT_FAULT;
const lockPath = path.resolve(process.env.WAKEFLOW_SETTLEMENT_LOCK);
const stagePath = process.env.WAKEFLOW_SETTLEMENT_STAGE
  ? path.resolve(process.env.WAKEFLOW_SETTLEMENT_STAGE)
  : null;
const eventFile = process.env.WAKEFLOW_SETTLEMENT_EVENTS;
const original = {
  appendFileSync: fs.appendFileSync,
  fstatSync: fs.fstatSync,
  fsyncSync: fs.fsyncSync,
  unlinkSync: fs.unlinkSync,
  writeFileSync: fs.writeFileSync,
};

let predecessorUnlinked = false;
let directoryFsyncCount = 0;

function mark(event) {
  original.appendFileSync(eventFile, event + "\n", "utf8");
}

function injectedFsyncFailure(count) {
  mark("post-unlink-directory-fsync-fault-" + count);
  const error = new Error("injected predecessor-gate parent fsync failure " + count);
  error.code = "EIO";
  throw error;
}

fs.unlinkSync = function patchedUnlink(candidate) {
  const resolved = path.resolve(String(candidate));
  const result = original.unlinkSync.apply(this, arguments);
  if (!predecessorUnlinked && resolved === lockPath) {
    predecessorUnlinked = true;
    mark("predecessor-gate-unlinked");
  }
  if (mode === "stage-null-to-foreign" && stagePath !== null && resolved === stagePath) {
    const bytes = Buffer.from(process.env.WAKEFLOW_SETTLEMENT_FOREIGN_GATE, "base64");
    original.writeFileSync(lockPath, bytes, { flag: "wx", mode: 0o600 });
    mark("foreign-gate-injected-after-stage-unlink");
  }
  return result;
};

fs.fsyncSync = function patchedFsync(descriptor) {
  if (predecessorUnlinked && original.fstatSync(descriptor).isDirectory()) {
    directoryFsyncCount += 1;
    if (directoryFsyncCount === 1) injectedFsyncFailure(directoryFsyncCount);
    if (mode === "parent-fsync-persistent" && directoryFsyncCount === 2) {
      injectedFsyncFailure(directoryFsyncCount);
    }
    const result = original.fsyncSync.apply(this, arguments);
    mark("post-unlink-directory-fsync-durable-" + directoryFsyncCount);
    return result;
  }
  return original.fsyncSync.apply(this, arguments);
};

syncBuiltinESMExports();
`;

const settlementFaultChildSource = String.raw`
const { createHash } = await import("node:crypto");
const {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} = await import("node:fs");
const path = await import("node:path");
const { pathToFileURL } = await import("node:url");

const manager = await import(pathToFileURL(process.env.WAKEFLOW_SETTLEMENT_MANAGER).href);
const canonical = await import(pathToFileURL(process.env.WAKEFLOW_SETTLEMENT_CANONICAL).href);
const workspaceRoot = process.env.WAKEFLOW_SETTLEMENT_WORKSPACE;
const operationId = process.env.WAKEFLOW_SETTLEMENT_OPERATION;
const journalFile = process.env.WAKEFLOW_SETTLEMENT_JOURNAL;
const transactionsRoot = process.env.WAKEFLOW_SETTLEMENT_TRANSACTIONS;
const lockFile = process.env.WAKEFLOW_SETTLEMENT_LOCK;
const plan = JSON.parse(process.env.WAKEFLOW_SETTLEMENT_PLAN);
const step = plan.payload.steps[0];
const retry = process.env.WAKEFLOW_SETTLEMENT_RETRY === "1";
let domainCallbackCount = 0;

function sha256(value) {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}

function resolveRef(ref) {
  return path.resolve(workspaceRoot, ...ref.split("/"));
}

function modeString(stat) {
  return "0" + (stat.mode & 0o777).toString(8).padStart(3, "0");
}

function observe(ref) {
  const candidate = resolveRef(ref);
  if (!existsSync(candidate)) return { ref, type: "absent" };
  const stat = lstatSync(candidate);
  return {
    ref,
    type: "file",
    mode: modeString(stat),
    digest: sha256(readFileSync(candidate)),
  };
}

function snapshot() {
  const names = readdirSync(transactionsRoot).sort();
  return {
    journal: existsSync(journalFile) ? JSON.parse(readFileSync(journalFile, "utf8")) : null,
    claims: names.filter((name) => name.startsWith(operationId + ".recovery-") && name.endsWith(".json")),
    stages: names.filter((name) => name.startsWith("." + operationId) && name.endsWith(".checkpoint-stage")),
    lock: existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, "utf8")) : null,
  };
}

const options = {
  workspaceRoot,
  operationId,
  confirmedPlan: plan,
  planDigest: canonical.canonicalJsonDigest(plan),
  validatePlan: async ({ plan: candidate }) => {
    if (canonical.canonicalJsonDigest(candidate) !== canonical.canonicalJsonDigest(plan)) {
      throw new Error("unexpected recovery plan");
    }
    return { valid: true };
  },
  deriveCurrentPlan: async () => plan,
  deriveTerminalClosure: async ({ planDigest }) => {
    domainCallbackCount += 1;
    return {
      planDigest,
      closureDigests: [{
        name: "recovery-race-closure",
        digest: sha256(readFileSync(resolveRef(step.final.ref))),
      }],
    };
  },
  stepHandlers: {
    [step.stepId]: {
      prepare: async () => {
        domainCallbackCount += 1;
        throw new Error("committed recovery must not prepare again");
      },
      observe: async () => {
        domainCallbackCount += 1;
        return {
          source: observe(step.source.ref),
          staging: observe(step.staging.ref),
          final: observe(step.final.ref),
        };
      },
      commit: async () => {
        domainCallbackCount += 1;
        throw new Error("committed recovery must not commit again");
      },
    },
  },
};

let firstError = null;
try {
  await manager.recoverWakeflowWorkspaceMutation(options);
} catch (error) {
  firstError = {
    code: error?.code ?? null,
    message: String(error?.message ?? error),
  };
}
const afterFirst = snapshot();
let retryResult = null;
let retryError = null;
if (retry) {
  try {
    retryResult = await manager.recoverWakeflowWorkspaceMutation(options);
  } catch (error) {
    retryError = {
      code: error?.code ?? null,
      message: String(error?.message ?? error),
    };
  }
}

process.stdout.write(JSON.stringify({
  pid: process.pid,
  firstError,
  afterFirst,
  retryResult,
  retryError,
  domainCallbackCount,
}) + "\n");
`;

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function operationId() {
  return `workspace-mutation_${randomUUID()}`;
}

function ownerToken() {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function deadProcessIdentity(label) {
  return {
    platform: process.platform,
    pid: 2_147_483_647,
    startIdentity: sha256(`terminated-recovery-race-owner:${label}`),
  };
}

function workspacePath(workspaceRoot, ref) {
  assert.equal(path.isAbsolute(ref), false);
  const target = path.resolve(workspaceRoot, ...ref.split("/"));
  assert.ok(target.startsWith(`${path.resolve(workspaceRoot)}${path.sep}`));
  return target;
}

function temporaryWorkspace(t, label) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), `wakeflow-${label}-`));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function bootstrapProtocol(workspaceRoot) {
  for (const ref of [LOCAL_REF, RUNTIME_REF, MAINTENANCE_REF, TRANSACTIONS_REF]) {
    mkdirSync(workspacePath(workspaceRoot, ref), { mode: 0o700 });
    chmodSync(workspacePath(workspaceRoot, ref), 0o700);
  }
}

function writeCanonicalPrivateFile(workspaceRoot, ref, value) {
  const target = workspacePath(workspaceRoot, ref);
  writeFileSync(target, `${canonicalJson(value)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(target, 0o600);
  return target;
}

function modeString(stat) {
  return `0${(stat.mode & 0o777).toString(8).padStart(3, "0")}`;
}

function fileArtifact(workspaceRoot, ref) {
  const target = workspacePath(workspaceRoot, ref);
  const stat = lstatSync(target);
  return {
    type: "file",
    ref,
    mode: modeString(stat),
    digest: sha256(readFileSync(target)),
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
    linkCount: stat.nlink,
  };
}

function absentArtifact(ref) {
  return { type: "absent", ref };
}

function captureExactFile(target) {
  const stat = lstatSync(target);
  return {
    target,
    bytes: readFileSync(target),
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
    linkCount: stat.nlink,
    mode: stat.mode & 0o777,
  };
}

function assertExactFile(snapshot) {
  const stat = lstatSync(snapshot.target);
  assert.equal(String(stat.dev), snapshot.deviceId);
  assert.equal(String(stat.ino), snapshot.inodeId);
  assert.equal(stat.nlink, snapshot.linkCount);
  assert.equal(stat.mode & 0o777, snapshot.mode);
  assert.deepEqual(readFileSync(snapshot.target), snapshot.bytes);
}

function observeResource(workspaceRoot, contract) {
  const target = workspacePath(workspaceRoot, contract.ref);
  if (!existsSync(target)) return { ref: contract.ref, type: "absent" };
  const stat = lstatSync(target);
  assert.equal(stat.isFile(), true);
  return {
    ref: contract.ref,
    type: "file",
    mode: modeString(stat),
    digest: sha256(readFileSync(target)),
  };
}

function committedJournalFixture(t, {
  label,
  ownerDisposition = "relinquished",
  withMatchingLock = false,
} = {}) {
  const workspaceRoot = temporaryWorkspace(t, label);
  bootstrapProtocol(workspaceRoot);
  const id = operationId();
  const finalRef = `${LOCAL_REF}/${label}.txt`;
  const stagingRef = `${LOCAL_REF}/.${label}.stage`;
  const finalBytes = Buffer.from(`${label} committed bytes\n`, "utf8");
  writeFileSync(workspacePath(workspaceRoot, finalRef), finalBytes, { flag: "wx", mode: 0o600 });
  chmodSync(workspacePath(workspaceRoot, finalRef), 0o600);
  const finalDigest = sha256(finalBytes);
  const step = {
    stepId: "recovery-race-step",
    ordinal: 0,
    stepKind: "create-or-update",
    source: { ref: finalRef, type: "absent" },
    staging: { ref: stagingRef, type: "file", mode: "0600", digest: finalDigest },
    final: { ref: finalRef, type: "file", mode: "0600", digest: finalDigest },
  };
  const plan = {
    schemaId: "urn:wakeflow:internal:recovery-race-plan:v1",
    payload: { steps: [step] },
  };
  const identity = deadProcessIdentity(id);
  const journal = {
    schemaVersion: 1,
    artifactKind: "wakeflow-maintenance-transaction",
    operationId: id,
    purpose: "maintenance-apply",
    action: "reconcile",
    operationKind: "recovery-race",
    domainOwner: "recovery-race-test",
    ownerToken: ownerToken(),
    recoveryGeneration: 0,
    processIdentity: identity,
    ownerDisposition,
    recoveryClaim: null,
    phase: "incomplete",
    plan,
    planDigest: canonicalJsonDigest(plan),
    checkpoint: ownerDisposition === "relinquished" ? 3 : 2,
    steps: [{ ...step, status: "committed" }],
    terminalClosure: null,
  };
  const journalRef = `${TRANSACTIONS_REF}/${id}.json`;
  const journalFile = writeCanonicalPrivateFile(workspaceRoot, journalRef, journal);
  let matchingLock = null;
  if (withMatchingLock) {
    matchingLock = generationZeroLock({
      id,
      operationKind: journal.operationKind,
      domainOwner: journal.domainOwner,
      token: journal.ownerToken,
      processIdentity: journal.processIdentity,
    });
    writeCanonicalPrivateFile(workspaceRoot, LOCK_REF, matchingLock);
  }
  return {
    workspaceRoot,
    id,
    plan,
    step,
    journal,
    journalRef,
    journalFile,
    matchingLock,
  };
}

function generationZeroLock({
  id = operationId(),
  operationKind = "foreign-race",
  domainOwner = "foreign-race-test",
  token = ownerToken(),
  processIdentity = deadProcessIdentity(id),
} = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-workspace-mutation-lock",
    operationId: id,
    mode: "maintenance",
    operationKind,
    domainOwner,
    ownerToken: token,
    recoveryGeneration: 0,
    processIdentity,
    recoveryClaim: null,
    acquiredAt: TIMESTAMP,
  };
}

function seedForeignGate(fixture, { lock = generationZeroLock() } = {}) {
  const lockFile = writeCanonicalPrivateFile(fixture.workspaceRoot, LOCK_REF, lock);
  return { lock, lockFile };
}

async function validateRacePlan({ plan }) {
  assert.equal(plan.schemaId, "urn:wakeflow:internal:recovery-race-plan:v1");
  assert.equal(Array.isArray(plan.payload?.steps), true);
  return { valid: true };
}

function recoveryOptions(fixture, overrides = {}) {
  const deriveTerminalClosure = async ({ planDigest }) => ({
    planDigest,
    closureDigests: [{
      name: "recovery-race-closure",
      digest: sha256(readFileSync(workspacePath(fixture.workspaceRoot, fixture.step.final.ref))),
    }],
  });
  return {
    workspaceRoot: fixture.workspaceRoot,
    operationId: fixture.id,
    confirmedPlan: fixture.plan,
    planDigest: canonicalJsonDigest(fixture.plan),
    validatePlan: validateRacePlan,
    deriveCurrentPlan: async () => fixture.plan,
    deriveTerminalClosure,
    stepHandlers: {
      [fixture.step.stepId]: {
        prepare: async () => assert.fail("committed recovery must not prepare again"),
        observe: async () => ({
          source: observeResource(fixture.workspaceRoot, fixture.step.source),
          staging: observeResource(fixture.workspaceRoot, fixture.step.staging),
          final: observeResource(fixture.workspaceRoot, fixture.step.final),
        }),
        commit: async () => assert.fail("committed recovery must not commit again"),
      },
    },
    ...overrides,
  };
}

function claimFiles(fixture) {
  return readdirSync(workspacePath(fixture.workspaceRoot, TRANSACTIONS_REF))
    .filter((name) => name.startsWith(`${fixture.id}.recovery-`) && name.endsWith(".json"))
    .sort();
}

function assertNoProtocolResidue(fixture) {
  assert.equal(existsSync(workspacePath(fixture.workspaceRoot, LOCK_REF)), false);
  assert.deepEqual(readdirSync(workspacePath(fixture.workspaceRoot, TRANSACTIONS_REF)), []);
}

function assertManualOrRace(error) {
  assert.match(String(error?.code), /(?:manual-recovery|recovery-race)/u);
  return true;
}

function settlementEvents(eventFile) {
  if (!existsSync(eventFile)) return [];
  return readFileSync(eventFile, "utf8").trim().split("\n").filter(Boolean);
}

async function runSettlementFaultChild(t, fixture, {
  fault,
  retry = false,
  stageFile = null,
  foreignLock = null,
}) {
  const harnessId = randomUUID();
  const preloadFile = path.join(fixture.workspaceRoot, `.settlement-fault-${harnessId}.cjs`);
  const eventFile = path.join(fixture.workspaceRoot, `.settlement-events-${harnessId}.log`);
  writeFileSync(preloadFile, settlementFaultPreloadSource, { mode: 0o600 });
  const child = spawn(process.execPath, [
    "--require",
    preloadFile,
    "--input-type=module",
    "-e",
    settlementFaultChildSource,
  ], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      WAKEFLOW_SETTLEMENT_CANONICAL: CANONICAL_JSON_FILE,
      WAKEFLOW_SETTLEMENT_EVENTS: eventFile,
      WAKEFLOW_SETTLEMENT_FAULT: fault,
      WAKEFLOW_SETTLEMENT_FOREIGN_GATE: foreignLock === null
        ? ""
        : Buffer.from(`${canonicalJson(foreignLock)}\n`, "utf8").toString("base64"),
      WAKEFLOW_SETTLEMENT_JOURNAL: fixture.journalFile,
      WAKEFLOW_SETTLEMENT_LOCK: workspacePath(fixture.workspaceRoot, LOCK_REF),
      WAKEFLOW_SETTLEMENT_MANAGER: MUTATION_MANAGER_FILE,
      WAKEFLOW_SETTLEMENT_OPERATION: fixture.id,
      WAKEFLOW_SETTLEMENT_PLAN: JSON.stringify(fixture.plan),
      WAKEFLOW_SETTLEMENT_RETRY: retry ? "1" : "0",
      WAKEFLOW_SETTLEMENT_STAGE: stageFile ?? "",
      WAKEFLOW_SETTLEMENT_TRANSACTIONS: workspacePath(
        fixture.workspaceRoot,
        TRANSACTIONS_REF,
      ),
      WAKEFLOW_SETTLEMENT_WORKSPACE: fixture.workspaceRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, "exit");
  const lines = stdout.trim().split("\n").filter(Boolean);
  assert.equal(code, 0, stderr);
  assert.equal(signal, null, stderr);
  assert.equal(lines.length, 1, `unexpected child stdout; stderr=${stderr}`);
  return {
    events: settlementEvents(eventFile),
    report: JSON.parse(lines[0]),
  };
}

test("claimless relinquished generation-zero journal removes only a dead foreign interloper", async (t) => {
  const fixture = committedJournalFixture(t, { label: "claimless-interloper" });
  seedForeignGate(fixture);

  const result = await recoverWakeflowWorkspaceMutation(recoveryOptions(fixture));

  assert.equal(result.operationId, fixture.id);
  assert.equal(result.status, "recovered");
  assertNoProtocolResidue(fixture);
});

test("claimless active journal preserves itself and a foreign gate on manual recovery", async (t) => {
  const fixture = committedJournalFixture(t, {
    label: "active-claimless-interloper",
    ownerDisposition: "active",
  });
  const { lockFile } = seedForeignGate(fixture);
  const journalBefore = captureExactFile(fixture.journalFile);
  const lockBefore = captureExactFile(lockFile);

  await assert.rejects(
    () => recoverWakeflowWorkspaceMutation(recoveryOptions(fixture)),
    assertManualOrRace,
  );

  assertExactFile(journalBefore);
  assertExactFile(lockBefore);
  assert.deepEqual(claimFiles(fixture), []);
});

test("a claim that explicitly binds the foreign gate never permits interloper deletion", async (t) => {
  const fixture = committedJournalFixture(t, { label: "bound-foreign-gate" });
  const { lock, lockFile } = seedForeignGate(fixture);
  const generation = 1;
  const claimRef = `${TRANSACTIONS_REF}/${fixture.id}.recovery-${generation}.json`;
  const nextToken = ownerToken();
  const claim = {
    schemaVersion: 1,
    artifactKind: "wakeflow-workspace-recovery-claim",
    operationId: fixture.id,
    recoveryGeneration: generation,
    planDigest: fixture.journal.planDigest,
    previousOwner: {
      mode: "maintenance",
      operationKind: fixture.journal.operationKind,
      domainOwner: fixture.journal.domainOwner,
      ownerTokenDigest: sha256(fixture.journal.ownerToken),
      recoveryGeneration: 0,
      processIdentity: fixture.journal.processIdentity,
      ownerDisposition: "active",
    },
    nextOwner: {
      mode: "recovery-cleanup",
      operationKind: fixture.journal.operationKind,
      domainOwner: fixture.journal.domainOwner,
      ownerToken: nextToken,
      recoveryGeneration: generation,
      processIdentity: deadProcessIdentity(`bound-claim:${fixture.id}`),
      acquiredAt: TIMESTAMP,
    },
    previousJournal: fileArtifact(fixture.workspaceRoot, fixture.journalRef),
    previousLock: fileArtifact(fixture.workspaceRoot, LOCK_REF),
    previousClaim: absentArtifact(`${TRANSACTIONS_REF}/${fixture.id}.recovery-0.json`),
    createdAt: TIMESTAMP,
  };
  assert.equal(claim.previousLock.digest, sha256(Buffer.from(`${canonicalJson(lock)}\n`, "utf8")));
  const claimFile = writeCanonicalPrivateFile(fixture.workspaceRoot, claimRef, claim);
  const evidence = [fixture.journalFile, claimFile, lockFile].map(captureExactFile);

  await assert.rejects(
    () => recoverWakeflowWorkspaceMutation(recoveryOptions(fixture)),
    assertManualOrRace,
  );

  for (const snapshot of evidence) assertExactFile(snapshot);
  assert.deepEqual(claimFiles(fixture), [path.basename(claimFile)]);
});

test("a dead foreign hard-link publisher pair is reduced and its generation-zero gate is recovered", async (t) => {
  const fixture = committedJournalFixture(t, { label: "foreign-publisher-pair" });
  const lock = generationZeroLock();
  const identityHex = lock.processIdentity.startIdentity.slice("sha256:".length);
  const publisherName = [
    "",
    "wakeflow-publish",
    "lock",
    lock.operationId,
    "0",
    lock.processIdentity.platform,
    String(lock.processIdentity.pid),
    identityHex,
    "a".repeat(32),
    "stage",
  ].join(".");
  const publisherRef = `${RUNTIME_REF}/${publisherName}`;
  const publisherFile = writeCanonicalPrivateFile(fixture.workspaceRoot, publisherRef, lock);
  const lockFile = workspacePath(fixture.workspaceRoot, LOCK_REF);
  linkSync(publisherFile, lockFile);
  assert.equal(lstatSync(publisherFile).nlink, 2);
  assert.equal(lstatSync(lockFile).nlink, 2);
  assert.equal(String(lstatSync(publisherFile).ino), String(lstatSync(lockFile).ino));

  const result = await recoverWakeflowWorkspaceMutation(recoveryOptions(fixture));

  assert.equal(result.status, "recovered");
  assert.equal(existsSync(publisherFile), false);
  assertNoProtocolResidue(fixture);
});

for (const injectionKind of ["same-name-journal-replacement", "new-checkpoint-stage"]) {
  test(`interloper pre-delete refresh rejects ${injectionKind} without deleting the foreign gate`, async (t) => {
    const fixture = committedJournalFixture(t, { label: injectionKind });
    const { lockFile } = seedForeignGate(fixture);
    const lockBefore = captureExactFile(lockFile);
    const journalBefore = captureExactFile(fixture.journalFile);
    let validatorCalls = 0;
    let injectedTarget = null;
    const validatePlan = async ({ plan }) => {
      await validateRacePlan({ plan });
      validatorCalls += 1;
      if (validatorCalls === 2) {
        if (injectionKind === "same-name-journal-replacement") {
          const replacement = `${fixture.journalFile}.replacement`;
          writeFileSync(replacement, journalBefore.bytes, { flag: "wx", mode: 0o600 });
          chmodSync(replacement, 0o600);
          renameSync(replacement, fixture.journalFile);
          injectedTarget = fixture.journalFile;
        } else {
          const stageRef = `${TRANSACTIONS_REF}/.${fixture.id}.0.checkpoint-stage`;
          injectedTarget = writeCanonicalPrivateFile(fixture.workspaceRoot, stageRef, fixture.journal);
        }
      }
      return { valid: true };
    };

    await assert.rejects(
      () => recoverWakeflowWorkspaceMutation(recoveryOptions(fixture, { validatePlan })),
      (error) => {
        assert.match(String(error?.code), /recovery-race/u);
        return true;
      },
    );

    assert.equal(validatorCalls, 2);
    assert.notEqual(injectedTarget, null);
    assertExactFile(lockBefore);
    assert.deepEqual(claimFiles(fixture), []);
    if (injectionKind === "same-name-journal-replacement") {
      const current = captureExactFile(fixture.journalFile);
      assert.deepEqual(current.bytes, journalBefore.bytes);
      assert.notEqual(current.inodeId, journalBefore.inodeId);
    } else {
      assertExactFile(journalBefore);
      assert.equal(existsSync(injectedTarget), true);
    }
  });
}

function startForeignGateRacer(t, fixture, lock) {
  const preparedFile = path.join(fixture.workspaceRoot, `.prepared-${lock.operationId}.json`);
  writeFileSync(preparedFile, `${canonicalJson(lock)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(preparedFile, 0o600);
  const armedFile = path.join(fixture.workspaceRoot, `.armed-${lock.operationId}`);
  const doneFile = path.join(fixture.workspaceRoot, `.done-${lock.operationId}`);
  const childSource = `
    import { linkSync, unlinkSync, writeFileSync } from "node:fs";
    const [preparedFile, lockFile, armedFile, doneFile] = process.argv.slice(1);
    writeFileSync(armedFile, "armed\\n", { flag: "wx" });
    while (true) {
      try {
        linkSync(preparedFile, lockFile);
        unlinkSync(preparedFile);
        writeFileSync(doneFile, "published\\n", { flag: "wx" });
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
  `;
  const child = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    childSource,
    preparedFile,
    workspacePath(fixture.workspaceRoot, LOCK_REF),
    armedFile,
    doneFile,
  ], {
    cwd: fixture.workspaceRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  return { armedFile, child, doneFile };
}

async function waitForFile(target, message) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (existsSync(target)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

test("pre-successor conflict durably relinquishes the new claimant and the same PID can retry", async (t) => {
  const fixture = committedJournalFixture(t, {
    label: "pre-successor-relinquish",
    withMatchingLock: true,
  });
  const oldCheckpoint = fixture.journal.checkpoint;
  const oldStageRef = `${TRANSACTIONS_REF}/.${fixture.id}.0.checkpoint-stage`;
  const oldStageFile = writeCanonicalPrivateFile(
    fixture.workspaceRoot,
    oldStageRef,
    fixture.journal,
  );
  assert.deepEqual(readFileSync(oldStageFile), readFileSync(fixture.journalFile));
  const foreignLock = generationZeroLock();
  const racer = startForeignGateRacer(t, fixture, foreignLock);
  await waitForFile(racer.armedFile, "foreign gate racer did not arm");

  await assert.rejects(
    () => recoverWakeflowWorkspaceMutation(recoveryOptions(fixture)),
    (error) => {
      assert.match(
        String(error?.code),
        /(?:manual-recovery|recovery-required|recovery-race|busy)/u,
      );
      return true;
    },
  );
  await waitForFile(racer.doneFile, "foreign gate racer did not publish");
  const [childCode] = await once(racer.child, "exit");
  assert.equal(childCode, 0);

  const claims = claimFiles(fixture);
  assert.equal(claims.length, 1);
  const claimRef = `${TRANSACTIONS_REF}/${claims[0]}`;
  const claim = JSON.parse(readFileSync(workspacePath(fixture.workspaceRoot, claimRef), "utf8"));
  const journal = JSON.parse(readFileSync(fixture.journalFile, "utf8"));
  assert.equal(journal.phase, "incomplete");
  assert.equal(journal.ownerDisposition, "relinquished");
  assert.equal(journal.recoveryGeneration, claim.recoveryGeneration);
  assert.equal(journal.ownerToken, claim.nextOwner.ownerToken);
  assert.deepEqual(journal.processIdentity, claim.nextOwner.processIdentity);
  assert.equal(journal.checkpoint, oldCheckpoint + 1);
  assert.deepEqual(journal.recoveryClaim, {
    ref: claimRef,
    generation: claim.recoveryGeneration,
    digest: canonicalJsonDigest(claim),
  });
  assert.equal(
    existsSync(oldStageFile),
    false,
    "the exact-current predecessor stage must not poison the relinquished successor journal",
  );
  const retainedForeignLock = JSON.parse(
    readFileSync(workspacePath(fixture.workspaceRoot, LOCK_REF), "utf8"),
  );
  assert.equal(retainedForeignLock.operationId, foreignLock.operationId);

  const result = await recoverWakeflowWorkspaceMutation(recoveryOptions(fixture));
  assert.equal(result.status, "recovered");
  assertNoProtocolResidue(fixture);
});

test("a one-shot predecessor-unlink parent fsync failure is settled before same-PID retry", async (t) => {
  const fixture = committedJournalFixture(t, {
    label: "predecessor-unlink-fsync-once",
    withMatchingLock: true,
  });
  const oldCheckpoint = fixture.journal.checkpoint;

  const { events, report } = await runSettlementFaultChild(t, fixture, {
    fault: "parent-fsync-once",
    retry: true,
  });

  assert.equal(report.firstError?.code, "wakeflow-mutation-recovery-required");
  assert.equal(report.afterFirst.journal.phase, "incomplete");
  assert.equal(report.afterFirst.journal.ownerDisposition, "relinquished");
  assert.equal(report.afterFirst.journal.recoveryGeneration, 1);
  assert.equal(report.afterFirst.journal.processIdentity.pid, report.pid);
  assert.equal(report.afterFirst.journal.checkpoint, oldCheckpoint + 1);
  assert.equal(report.afterFirst.claims.length, 1);
  assert.equal(
    report.afterFirst.journal.recoveryClaim.ref,
    `${TRANSACTIONS_REF}/${report.afterFirst.claims[0]}`,
  );
  assert.deepEqual(report.afterFirst.stages, []);
  assert.equal(report.afterFirst.lock, null);
  assert.equal(report.retryError, null);
  assert.equal(report.retryResult?.status, "recovered");
  assert.ok(report.domainCallbackCount > 0);
  assert.equal(events[0], "predecessor-gate-unlinked");
  assert.equal(events.includes("post-unlink-directory-fsync-fault-1"), true);
  assert.equal(events.includes("post-unlink-directory-fsync-durable-2"), true);
  assertNoProtocolResidue(fixture);
});

test("persistent predecessor-unlink parent fsync failure preserves the old journal without callbacks", async (t) => {
  const fixture = committedJournalFixture(t, {
    label: "predecessor-unlink-fsync-persistent",
    withMatchingLock: true,
  });
  const journalBefore = captureExactFile(fixture.journalFile);

  const { events, report } = await runSettlementFaultChild(t, fixture, {
    fault: "parent-fsync-persistent",
  });

  assert.equal(report.firstError?.code, "wakeflow-mutation-recovery-required");
  assert.equal(report.domainCallbackCount, 0);
  assert.equal(report.afterFirst.journal.recoveryGeneration, fixture.journal.recoveryGeneration);
  assert.equal(report.afterFirst.journal.ownerToken, fixture.journal.ownerToken);
  assert.equal(report.afterFirst.journal.checkpoint, fixture.journal.checkpoint);
  assert.equal(report.afterFirst.claims.length, 1);
  assert.deepEqual(report.afterFirst.stages, []);
  assert.equal(report.afterFirst.lock, null);
  assertExactFile(journalBefore);
  assert.equal(existsSync(workspacePath(fixture.workspaceRoot, LOCK_REF)), false);
  assert.equal(claimFiles(fixture).length, 1);
  assert.deepEqual(events.slice(0, 3), [
    "predecessor-gate-unlinked",
    "post-unlink-directory-fsync-fault-1",
    "post-unlink-directory-fsync-fault-2",
  ]);
  assert.equal(events.some((event) => event.includes("directory-fsync-durable")), false);
});

test("a gate appearing during pre-successor stage cleanup prevents the relinquished checkpoint", async (t) => {
  const fixture = committedJournalFixture(t, {
    label: "stage-cleanup-null-to-foreign",
    withMatchingLock: true,
  });
  const journalBefore = captureExactFile(fixture.journalFile);
  const oldStageRef = `${TRANSACTIONS_REF}/.${fixture.id}.0.checkpoint-stage`;
  const oldStageFile = writeCanonicalPrivateFile(
    fixture.workspaceRoot,
    oldStageRef,
    fixture.journal,
  );
  const foreignLock = generationZeroLock();

  const { events, report } = await runSettlementFaultChild(t, fixture, {
    fault: "stage-null-to-foreign",
    stageFile: oldStageFile,
    foreignLock,
  });

  assert.equal(report.firstError?.code, "wakeflow-mutation-recovery-required");
  assert.equal(report.domainCallbackCount, 0);
  assert.equal(report.afterFirst.journal.recoveryGeneration, fixture.journal.recoveryGeneration);
  assert.equal(report.afterFirst.journal.ownerToken, fixture.journal.ownerToken);
  assert.equal(report.afterFirst.journal.checkpoint, fixture.journal.checkpoint);
  assert.equal(report.afterFirst.claims.length, 1);
  assert.deepEqual(report.afterFirst.stages, []);
  assert.equal(report.afterFirst.lock.operationId, foreignLock.operationId);
  assertExactFile(journalBefore);
  assert.equal(existsSync(oldStageFile), false);
  assert.deepEqual(
    JSON.parse(readFileSync(workspacePath(fixture.workspaceRoot, LOCK_REF), "utf8")),
    foreignLock,
  );
  assert.equal(events.includes("post-unlink-directory-fsync-fault-1"), true);
  assert.equal(events.includes("post-unlink-directory-fsync-durable-2"), true);
  assert.equal(events.includes("foreign-gate-injected-after-stage-unlink"), true);
});
