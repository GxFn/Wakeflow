import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { canonicalJson } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import { hostProfile } from "../core/scripts/lib/wakeflow-host-profile.mjs";
import {
  createKeepLiveControlRecord,
  createKeepLiveLeaseRecord,
  createKeepLiveManagerLockRecord,
  createKeepLiveProcessRecord,
  generateKeepLiveGenerationId,
  generateKeepLiveRequestId,
  keepLiveControlCanonicalBytes,
  keepLiveLeaseCanonicalBytes,
  keepLiveManagerLockCanonicalBytes,
  keepLiveProcessCanonicalBytes,
  validateKeepLiveLeaseRecord,
} from "../core/scripts/lib/wakeflow-keep-live-records.mjs";
import {
  ensureKeepLive,
  inspectKeepLive,
  reconcileKeepLive,
  recordKeepLiveStartOutcome,
  recordKeepLiveStopOutcome,
  releaseKeepLive,
  rollbackKeepLiveEnsure,
} from "../core/scripts/lib/wakeflow-keep-live-service.mjs";
import {
  captureWakeflowProcessIdentity,
  inspectWakeflowProcessSnapshot,
  probeWakeflowProcessIdentity,
  probeWakeflowProcessSubject,
} from "../core/scripts/lib/wakeflow-process-identity.mjs";
import { withWakeflowRuntimeMutation } from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const minimalConfigFile = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_12121212-1212-4212-8212-121212121212",
  demandTwo: "demand_13131313-1313-4313-8313-131313131313",
  group: "dispatch-group_14141414-1414-4414-8414-141414141414",
  groupTwo: "dispatch-group_15151515-1515-4515-8515-151515151515",
});

function ensurePrivateDirectory(root, ref) {
  let current = root;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    if (process.platform !== "win32") chmodSync(current, 0o700);
  }
  return current;
}

function writeCanonical(file, value) {
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(file, 0o600);
}

function fixtureTree(keepLive) {
  if (!existsSync(keepLive)) return [];
  const visit = (directory, prefix = "") => readdirSync(directory).sort().flatMap((name) => {
    const absolute = path.join(directory, name);
    const ref = prefix ? `${prefix}/${name}` : name;
    return readFileOrDirectory(absolute, ref, visit);
  });
  return visit(keepLive);
}

function readFileOrDirectory(absolute, ref, visit) {
  try {
    const entries = readdirSync(absolute);
    return [{ ref, type: "directory" }, ...visit(absolute, ref, entries)];
  } catch {
    return [{ ref, type: "file", bytes: readFileSync(absolute, "utf8") }];
  }
}

function createFixture(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-keep-live-v3-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspaceRoot = path.join(base, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  if (process.platform !== "win32") chmodSync(workspaceRoot, 0o700);
  const config = JSON.parse(readFileSync(minimalConfigFile, "utf8"));
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );
  for (const ref of [
    ".wakeflow-local/runtime/maintenance/transactions",
    ".wakeflow-local/runtime/hosts/codex/operations/keep-live/leases",
  ]) ensurePrivateDirectory(workspaceRoot, ref);
  return {
    workspaceRoot,
    keepLiveRoot: path.join(
      workspaceRoot,
      ".wakeflow-local/runtime/hosts/codex/operations/keep-live",
    ),
  };
}

function ensureInput(workspaceRoot, overrides = {}) {
  return {
    workspaceRoot,
    hostProfile,
    demandId: IDS.demand,
    automationRunId: IDS.group,
    capability: "macos-caffeinate",
    ...overrides,
  };
}

function leasePath(fixture, groupId = IDS.group) {
  return path.join(fixture.keepLiveRoot, "leases", `${groupId}.json`);
}

function processPath(fixture) {
  return path.join(fixture.keepLiveRoot, "process.json");
}

function controlPath(fixture) {
  return path.join(fixture.keepLiveRoot, "control.json");
}

function managerLockPath(fixture) {
  return path.join(fixture.keepLiveRoot, "manager.lock");
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const RECORD_EXPORTS = Object.freeze([
  "WAKEFLOW_KEEP_LIVE_CONTROL_KIND",
  "WAKEFLOW_KEEP_LIVE_LEASE_KIND",
  "WAKEFLOW_KEEP_LIVE_MANAGER_LOCK_KIND",
  "WAKEFLOW_KEEP_LIVE_PROCESS_KIND",
  "createKeepLiveControlRecord",
  "createKeepLiveLeaseRecord",
  "createKeepLiveManagerLockRecord",
  "createKeepLiveProcessRecord",
  "generateKeepLiveGenerationId",
  "generateKeepLiveRequestId",
  "keepLiveControlCanonicalBytes",
  "keepLiveControlRef",
  "keepLiveLeaseCanonicalBytes",
  "keepLiveLeaseRef",
  "keepLiveManagerLockCanonicalBytes",
  "keepLiveManagerLockRef",
  "keepLiveProcessCanonicalBytes",
  "keepLiveProcessRef",
  "validateKeepLiveControlRecord",
  "validateKeepLiveLeaseRecord",
  "validateKeepLiveManagerLockRecord",
  "validateKeepLiveProcessRecord",
]);

const SERVICE_EXPORTS = Object.freeze([
  "WakeflowKeepLiveError",
  "ensureKeepLive",
  "inspectKeepLive",
  "inspectKeepLiveInventoryForLayout",
  "reconcileKeepLive",
  "recordKeepLiveStartOutcome",
  "recordKeepLiveStopOutcome",
  "releaseKeepLive",
  "rollbackKeepLiveEnsure",
]);

test("M4-T06 exposes one internal keep-live owner with four closed record families", async () => {
  const schemaFiles = [
    "lease.schema.json",
    "process.schema.json",
    "control.schema.json",
    "manager-lock.schema.json",
  ];
  await Promise.all(schemaFiles.map((name) => access(path.join(
    repositoryRoot,
    "core/schemas/wakeflow-keep-live",
    name,
  ))));

  const records = await import(pathToFileURL(path.join(
    repositoryRoot,
    "core/scripts/lib/wakeflow-keep-live-records.mjs",
  )).href);
  assert.deepEqual(Object.keys(records).sort(), [...RECORD_EXPORTS].sort());

  const service = await import(pathToFileURL(path.join(
    repositoryRoot,
    "core/scripts/lib/wakeflow-keep-live-service.mjs",
  )).href);
  assert.deepEqual(Object.keys(service).sort(), [...SERVICE_EXPORTS].sort());
});

test("M4-T06 record codecs and Draft 2020-12 schemas close exact canonical records", () => {
  const time = "2026-08-09T00:00:00.000Z";
  const generationId = generateKeepLiveGenerationId(
    () => "16161616-1616-4616-8616-161616161616",
  );
  const requestId = generateKeepLiveRequestId(
    () => "17171717-1717-4717-8717-171717171717",
  );
  const lease = createKeepLiveLeaseRecord({
    programId: IDS.program,
    hostId: "codex",
    demandId: IDS.demand,
    automationRunId: IDS.group,
    acquiredAt: time,
    lastConfirmedAt: time,
  });
  const processRecord = createKeepLiveProcessRecord({
    programId: IDS.program,
    hostId: "codex",
    generationId,
    capability: "macos-caffeinate",
    mechanism: "worker-caffeinate",
    status: "starting",
    worker: null,
    child: null,
    controlRequestId: requestId,
    controlRevision: 1,
    createdAt: time,
    startedAt: null,
    observedAt: time,
    stopRequestedAt: null,
    errorCode: null,
  });
  const control = createKeepLiveControlRecord({
    programId: IDS.program,
    hostId: "codex",
    generationId,
    requestId,
    action: "start",
    phase: "requested",
    revision: 1,
    requestedAt: time,
    updatedAt: time,
    errorCode: null,
  });
  const managerLock = createKeepLiveManagerLockRecord({
    programId: IDS.program,
    hostId: "codex",
    lockId: generateKeepLiveRequestId(
      () => "18181818-1818-4818-8818-181818181818",
    ),
    workspaceOperationId: "workspace-mutation_19191919-1919-4919-8919-191919191919",
    owner: captureWakeflowProcessIdentity(),
    acquiredAt: time,
  });
  const records = [lease, processRecord, control, managerLock];
  const byteFunctions = [
    keepLiveLeaseCanonicalBytes,
    keepLiveProcessCanonicalBytes,
    keepLiveControlCanonicalBytes,
    keepLiveManagerLockCanonicalBytes,
  ];
  const schemaNames = ["lease", "process", "control", "manager-lock"];
  for (const [index, record] of records.entries()) {
    const schema = JSON.parse(readFileSync(path.join(
      repositoryRoot,
      "core/schemas/wakeflow-keep-live",
      `${schemaNames[index]}.schema.json`,
    ), "utf8"));
    const validate = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    }).compile(schema);
    assert.equal(validate(record), true, JSON.stringify(validate.errors));
    assert.equal(byteFunctions[index](record).toString("utf8"), `${canonicalJson(record)}\n`);
    assert.equal(validate({ ...record, unexpected: true }), false);
  }
  assert.throws(() => createKeepLiveLeaseRecord({
    ...Object.fromEntries(Object.entries(lease).filter(([key]) => ![
      "schemaVersion",
      "artifactKind",
      "leaseDigest",
    ].includes(key))),
    automationRunId: "dispatch-packet_14141414-1414-4414-8414-141414141414",
  }));
});

test("M4-T06 record and process identity admission never executes accessors or ignores hidden fields", () => {
  const time = "2026-08-09T00:00:00.000Z";
  const leaseInput = {
    programId: IDS.program,
    hostId: "codex",
    demandId: IDS.demand,
    automationRunId: IDS.group,
    acquiredAt: time,
    lastConfirmedAt: time,
  };
  let reads = 0;
  Object.defineProperty(leaseInput, "programId", {
    enumerable: true,
    get() {
      reads += 1;
      return IDS.program;
    },
  });
  assert.throws(() => createKeepLiveLeaseRecord(leaseInput));
  assert.equal(reads, 0);

  const lease = createKeepLiveLeaseRecord({
    programId: IDS.program,
    hostId: "codex",
    demandId: IDS.demand,
    automationRunId: IDS.group,
    acquiredAt: time,
    lastConfirmedAt: time,
  });
  const hiddenLease = { ...lease };
  Object.defineProperty(hiddenLease, "hidden", { value: true });
  assert.throws(() => validateKeepLiveLeaseRecord(hiddenLease));
  const symbolLease = { ...lease, [Symbol("hidden")]: true };
  assert.throws(() => validateKeepLiveLeaseRecord(symbolLease));

  const identity = {
    platform: process.platform,
    pid: process.pid,
    startIdentity: captureWakeflowProcessIdentity().startIdentity,
  };
  Object.defineProperty(identity, "platform", {
    enumerable: true,
    get() {
      reads += 1;
      return process.platform;
    },
  });
  reads = 0;
  assert.throws(() => probeWakeflowProcessIdentity(identity));
  assert.equal(reads, 0);

  const snapshot = inspectWakeflowProcessSnapshot(process.pid);
  const hiddenSubject = { ...snapshot };
  Object.defineProperty(hiddenSubject, "hidden", { value: true });
  assert.throws(() => probeWakeflowProcessSubject(hiddenSubject));
});

test("M4-T06 ensure creates one exact lease and one recoverable start generation", async (t) => {
  const fixture = createFixture(t);
  const first = await ensureKeepLive(ensureInput(fixture.workspaceRoot));
  assert.equal(first.leaseCreated, true);
  assert.equal(first.lease.automationRunId, IDS.group);
  assert.equal(first.status, "host-operation-required");
  assert.equal(first.hostOperation.kind, "start-keep-live-generation");
  assert.equal(existsSync(managerLockPath(fixture)), false);

  const second = await ensureKeepLive(ensureInput(fixture.workspaceRoot, {
    demandId: IDS.demandTwo,
    automationRunId: IDS.groupTwo,
  }));
  assert.equal(second.leaseCreated, true);
  assert.equal(second.lease.automationRunId, IDS.groupTwo);
  assert.equal(second.generationId, first.generationId);
  assert.deepEqual(second.hostOperation, first.hostOperation);

  const replay = await ensureKeepLive(ensureInput(fixture.workspaceRoot));
  assert.equal(replay.leaseCreated, false);
  assert.equal(replay.lease.automationRunId, IDS.group);
  assert.equal(replay.generationId, first.generationId);
  const inventory = inspectKeepLive({ workspaceRoot: fixture.workspaceRoot, hostProfile });
  assert.equal(inventory.leaseCount, 2);
  assert.equal(inventory.process.status, "starting");
  assert.equal(inventory.control.action, "start");
  assert.equal(JSON.stringify(inventory).includes('"pid"'), false);
  assert.equal(JSON.stringify(inventory).includes(fixture.workspaceRoot), false);

  await assert.rejects(() => rollbackKeepLiveEnsure({ result: replay }), {
    code: "wakeflow-keep-live-rollback-proof",
  });
  await assert.rejects(() => rollbackKeepLiveEnsure({ result: first }), {
    code: "wakeflow-keep-live-cas-mismatch",
  });
});

test("M4-T06 exact release preserves other owners and the last owner creates only a fenced stop request", async (t) => {
  const fixture = createFixture(t);
  const first = await ensureKeepLive(ensureInput(fixture.workspaceRoot));
  const second = await ensureKeepLive(ensureInput(fixture.workspaceRoot, {
    demandId: IDS.demandTwo,
    automationRunId: IDS.groupTwo,
  }));
  const retained = await releaseKeepLive({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    automationRunId: IDS.group,
    leaseDigest: first.lease.digest,
  });
  assert.equal(retained.status, "retained-by-other-runs");
  assert.equal(retained.remainingLeaseCount, 1);
  assert.equal(retained.hostOperation, null);
  assert.equal(existsSync(leasePath(fixture)), false);
  assert.equal(existsSync(leasePath(fixture, IDS.groupTwo)), true);

  await assert.rejects(() => releaseKeepLive({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    automationRunId: IDS.groupTwo,
    leaseDigest: `sha256:${"f".repeat(64)}`,
  }), { code: "wakeflow-keep-live-cas-mismatch" });
  const last = await releaseKeepLive({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    automationRunId: IDS.groupTwo,
    leaseDigest: second.lease.digest,
  });
  assert.equal(last.status, "host-operation-required");
  assert.equal(last.hostOperation.kind, "stop-keep-live-generation");
  assert.equal(last.remainingLeaseCount, 0);
  assert.equal(JSON.parse(readFileSync(processPath(fixture), "utf8")).status, "stopping");
  assert.equal(JSON.parse(readFileSync(controlPath(fixture), "utf8")).action, "stop");

  rmSync(controlPath(fixture), { force: true });
  const repairedStop = await reconcileKeepLive({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    capability: "macos-caffeinate",
  });
  assert.equal(repairedStop.status, "host-operation-required");
  assert.equal(repairedStop.hostOperation.kind, "stop-keep-live-generation");
  assert.equal(repairedStop.hostOperation.generationId, last.hostOperation.generationId);
  assert.notEqual(repairedStop.hostOperation.requestId, last.hostOperation.requestId);
  assert.equal(repairedStop.hostOperation.revision, last.hostOperation.revision + 1);
  assert.equal(repairedStop.inventory.managerLock, null);

  const beforeOldStop = fixtureTree(fixture.keepLiveRoot);
  await assert.rejects(() => recordKeepLiveStopOutcome({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    generationId: last.hostOperation.generationId,
    requestId: last.hostOperation.requestId,
    outcome: { status: "stopped", observedAt: new Date().toISOString(), errorCode: null },
  }), { code: "wakeflow-keep-live-stale" });
  assert.deepEqual(fixtureTree(fixture.keepLiveRoot), beforeOldStop);

  const stopped = await recordKeepLiveStopOutcome({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    generationId: repairedStop.hostOperation.generationId,
    requestId: repairedStop.hostOperation.requestId,
    outcome: { status: "stopped", observedAt: new Date().toISOString(), errorCode: null },
  });
  assert.equal(stopped.process, null);
  assert.equal(stopped.control, null);
  assert.equal(stopped.managerLock, null);
  assert.equal(existsSync(processPath(fixture)), false);
  assert.equal(existsSync(controlPath(fixture)), false);
});

test("M4-T06 failed start keeps ownership and reconcile creates a fresh generation", async (t) => {
  const fixture = createFixture(t);
  const ensured = await ensureKeepLive(ensureInput(fixture.workspaceRoot));
  const failed = await recordKeepLiveStartOutcome({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    generationId: ensured.hostOperation.generationId,
    requestId: ensured.hostOperation.requestId,
    outcome: {
      status: "failed",
      worker: null,
      child: null,
      observedAt: new Date().toISOString(),
      errorCode: "worker-start-failed",
    },
  });
  assert.equal(failed.leaseCount, 1);
  assert.equal(failed.process.status, "failed");
  assert.equal(failed.control, null);
  assert.equal(failed.managerLock, null);

  const reconciled = await reconcileKeepLive({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    capability: "macos-caffeinate",
  });
  assert.equal(reconciled.status, "host-operation-required");
  assert.equal(reconciled.hostOperation.kind, "start-keep-live-generation");
  assert.notEqual(reconciled.hostOperation.generationId, ensured.generationId);
  assert.equal(reconciled.inventory.managerLock, null);
  assert.equal(inspectKeepLive({ workspaceRoot: fixture.workspaceRoot, hostProfile }).leaseCount, 1);

  const beforeOldOutcome = fixtureTree(fixture.keepLiveRoot);
  await assert.rejects(() => recordKeepLiveStartOutcome({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    generationId: ensured.hostOperation.generationId,
    requestId: ensured.hostOperation.requestId,
    outcome: {
      status: "failed",
      worker: null,
      child: null,
      observedAt: new Date().toISOString(),
      errorCode: "worker-start-failed",
    },
  }), { code: "wakeflow-keep-live-stale" });
  assert.deepEqual(fixtureTree(fixture.keepLiveRoot), beforeOldOutcome);

  const staleControl = createKeepLiveControlRecord({
    programId: IDS.program,
    hostId: "codex",
    generationId: ensured.hostOperation.generationId,
    requestId: ensured.hostOperation.requestId,
    action: "start",
    phase: "requested",
    revision: ensured.hostOperation.revision,
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    errorCode: null,
  });
  writeFileSync(controlPath(fixture), keepLiveControlCanonicalBytes(staleControl), { mode: 0o600 });
  const beforeStaleControl = fixtureTree(fixture.keepLiveRoot);
  await assert.rejects(() => ensureKeepLive(ensureInput(fixture.workspaceRoot)), {
    code: "wakeflow-keep-live-control-lineage",
  });
  await assert.rejects(() => reconcileKeepLive({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    capability: "macos-caffeinate",
  }), { code: "wakeflow-keep-live-control-lineage" });
  assert.deepEqual(fixtureTree(fixture.keepLiveRoot), beforeStaleControl);
});

test("M4-T06 reconcile repairs lease-only, process-only, and orphan-control crash prefixes", async (t) => {
  const leaseOnly = createFixture(t);
  const leaseTime = new Date().toISOString();
  const lease = createKeepLiveLeaseRecord({
    programId: IDS.program,
    hostId: "codex",
    demandId: IDS.demand,
    automationRunId: IDS.group,
    acquiredAt: leaseTime,
    lastConfirmedAt: leaseTime,
  });
  writeFileSync(leasePath(leaseOnly), keepLiveLeaseCanonicalBytes(lease), { mode: 0o600 });
  const repairedLeaseOnly = await reconcileKeepLive({
    workspaceRoot: leaseOnly.workspaceRoot,
    hostProfile,
    capability: "macos-caffeinate",
  });
  assert.equal(repairedLeaseOnly.status, "host-operation-required");
  assert.equal(repairedLeaseOnly.hostOperation.kind, "start-keep-live-generation");
  assert.equal(repairedLeaseOnly.inventory.leaseCount, 1);
  assert.equal(repairedLeaseOnly.inventory.managerLock, null);
  assert.equal(JSON.parse(readFileSync(leasePath(leaseOnly), "utf8")).leaseDigest, lease.leaseDigest);

  const processOnly = createFixture(t);
  const ensured = await ensureKeepLive(ensureInput(processOnly.workspaceRoot));
  const originalProcess = JSON.parse(readFileSync(processPath(processOnly), "utf8"));
  rmSync(controlPath(processOnly), { force: true });
  const repairedProcessOnly = await reconcileKeepLive({
    workspaceRoot: processOnly.workspaceRoot,
    hostProfile,
    capability: "macos-caffeinate",
  });
  assert.equal(repairedProcessOnly.status, "host-operation-required");
  assert.equal(repairedProcessOnly.hostOperation.kind, "start-keep-live-generation");
  assert.equal(repairedProcessOnly.hostOperation.generationId, originalProcess.generationId);
  assert.notEqual(repairedProcessOnly.hostOperation.requestId, originalProcess.controlRequestId);
  assert.equal(repairedProcessOnly.hostOperation.revision, originalProcess.controlRevision + 1);
  assert.equal(repairedProcessOnly.inventory.managerLock, null);

  const beforeOldRequest = fixtureTree(processOnly.keepLiveRoot);
  await assert.rejects(() => recordKeepLiveStartOutcome({
    workspaceRoot: processOnly.workspaceRoot,
    hostProfile,
    generationId: ensured.hostOperation.generationId,
    requestId: ensured.hostOperation.requestId,
    outcome: {
      status: "failed",
      worker: null,
      child: null,
      observedAt: new Date().toISOString(),
      errorCode: "stale-worker-result",
    },
  }), { code: "wakeflow-keep-live-stale" });
  assert.deepEqual(fixtureTree(processOnly.keepLiveRoot), beforeOldRequest);

  const controlOnly = createFixture(t);
  const orphanTime = new Date().toISOString();
  const orphanControl = createKeepLiveControlRecord({
    programId: IDS.program,
    hostId: "codex",
    generationId: generateKeepLiveGenerationId(),
    requestId: generateKeepLiveRequestId(),
    action: "start",
    phase: "requested",
    revision: 1,
    requestedAt: orphanTime,
    updatedAt: orphanTime,
    errorCode: null,
  });
  writeFileSync(controlPath(controlOnly), keepLiveControlCanonicalBytes(orphanControl), { mode: 0o600 });
  const cleanedControl = await reconcileKeepLive({
    workspaceRoot: controlOnly.workspaceRoot,
    hostProfile,
    capability: "macos-caffeinate",
  });
  assert.equal(cleanedControl.status, "current");
  assert.equal(cleanedControl.inventory.control, null);
  assert.equal(cleanedControl.inventory.process, null);
  assert.equal(cleanedControl.inventory.managerLock, null);
  assert.equal(existsSync(controlPath(controlOnly)), false);
});

test("M4-T06 running settlement consumes control and only exact process identities replay", async (t) => {
  const fixture = createFixture(t);
  const ensured = await ensureKeepLive(ensureInput(fixture.workspaceRoot));
  const requestedControl = JSON.parse(readFileSync(controlPath(fixture), "utf8"));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  t.after(() => {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  });
  await sleep(50);
  const worker = inspectWakeflowProcessSnapshot(process.pid);
  const childSubject = inspectWakeflowProcessSnapshot(child.pid);
  assert.ok(worker);
  assert.ok(childSubject);
  assert.equal(childSubject.parentPid, worker.identity.pid);
  const outcome = {
    status: "running",
    worker,
    child: childSubject,
    observedAt: new Date().toISOString(),
    errorCode: null,
  };
  const running = await recordKeepLiveStartOutcome({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    generationId: ensured.hostOperation.generationId,
    requestId: ensured.hostOperation.requestId,
    outcome,
  });
  assert.equal(running.process.status, "running");
  assert.equal(running.process.health, "running");
  assert.equal(running.control, null);
  assert.equal(running.managerLock, null);
  assert.equal(existsSync(controlPath(fixture)), false);

  const replay = await recordKeepLiveStartOutcome({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    generationId: ensured.hostOperation.generationId,
    requestId: ensured.hostOperation.requestId,
    outcome,
  });
  assert.equal(replay.process.digest, running.process.digest);
  assert.equal(replay.managerLock, null);

  const beforeConflict = fixtureTree(fixture.keepLiveRoot);
  await assert.rejects(() => recordKeepLiveStartOutcome({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    generationId: ensured.hostOperation.generationId,
    requestId: ensured.hostOperation.requestId,
    outcome: {
      status: "failed",
      worker: null,
      child: null,
      observedAt: new Date().toISOString(),
      errorCode: "conflicting-worker-result",
    },
  }), { code: "wakeflow-keep-live-conflict" });
  assert.deepEqual(fixtureTree(fixture.keepLiveRoot), beforeConflict);

  const acknowledgedAt = new Date().toISOString();
  const acknowledgedResidue = createKeepLiveControlRecord({
    programId: requestedControl.programId,
    hostId: requestedControl.hostId,
    generationId: requestedControl.generationId,
    requestId: requestedControl.requestId,
    action: "start",
    phase: "acknowledged",
    revision: requestedControl.revision,
    requestedAt: requestedControl.requestedAt,
    updatedAt: acknowledgedAt,
    errorCode: null,
  });
  writeFileSync(
    controlPath(fixture),
    keepLiveControlCanonicalBytes(acknowledgedResidue),
    { mode: 0o600 },
  );
  const reconciled = await reconcileKeepLive({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    capability: "macos-caffeinate",
  });
  assert.equal(reconciled.status, "current");
  assert.equal(reconciled.inventory.process.digest, running.process.digest);
  assert.equal(reconciled.inventory.control, null);
  assert.equal(reconciled.inventory.managerLock, null);
  assert.equal(existsSync(controlPath(fixture)), false);
});

test("M4-T06 async outcome settlement uses the validated call-time snapshot", async (t) => {
  const fixture = createFixture(t);
  const ensured = await ensureKeepLive(ensureInput(fixture.workspaceRoot));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  t.after(() => {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  });
  await sleep(50);

  let enteredGate;
  let releaseGate;
  const gateEntered = new Promise((resolve) => {
    enteredGate = resolve;
  });
  const gateRelease = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const holder = withWakeflowRuntimeMutation({
    workspaceRoot: fixture.workspaceRoot,
    operationKind: "keep-live-snapshot-test",
    domainOwner: "keep-live-test",
  }, async () => {
    enteredGate();
    await gateRelease;
  });
  await gateEntered;

  const outcome = {
    status: "running",
    worker: inspectWakeflowProcessSnapshot(process.pid),
    child: inspectWakeflowProcessSnapshot(child.pid),
    observedAt: new Date().toISOString(),
    errorCode: null,
  };
  const settlement = recordKeepLiveStartOutcome({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    generationId: ensured.hostOperation.generationId,
    requestId: ensured.hostOperation.requestId,
    outcome,
  });
  outcome.status = "failed";
  outcome.worker = null;
  outcome.child = null;
  outcome.errorCode = "mutated-after-admission";
  releaseGate();
  await holder;

  const settled = await settlement;
  assert.equal(settled.process.status, "running");
  assert.equal(settled.process.health, "running");
});

test("M4-T06 ensure rejects a failed generation with live subjects before creating a lease", async (t) => {
  const fixture = createFixture(t);
  const ensured = await ensureKeepLive(ensureInput(fixture.workspaceRoot));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  t.after(() => {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  });
  await sleep(50);
  const worker = inspectWakeflowProcessSnapshot(process.pid);
  const childSubject = inspectWakeflowProcessSnapshot(child.pid);
  await recordKeepLiveStartOutcome({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    generationId: ensured.hostOperation.generationId,
    requestId: ensured.hostOperation.requestId,
    outcome: {
      status: "running",
      worker,
      child: childSubject,
      observedAt: new Date().toISOString(),
      errorCode: null,
    },
  });
  const released = await releaseKeepLive({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    automationRunId: IDS.group,
    leaseDigest: ensured.lease.digest,
  });
  await recordKeepLiveStopOutcome({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    generationId: released.hostOperation.generationId,
    requestId: released.hostOperation.requestId,
    outcome: {
      status: "failed",
      observedAt: new Date().toISOString(),
      errorCode: "stop-failed",
    },
  });
  assert.equal(
    inspectKeepLive({ workspaceRoot: fixture.workspaceRoot, hostProfile }).process.health,
    "failed",
  );

  const before = fixtureTree(fixture.keepLiveRoot);
  await assert.rejects(
    () => ensureKeepLive(ensureInput(fixture.workspaceRoot, {
      demandId: IDS.demandTwo,
      automationRunId: IDS.groupTwo,
    })),
    { code: "wakeflow-keep-live-process-identity" },
  );
  assert.deepEqual(fixtureTree(fixture.keepLiveRoot), before);
});

test("M4-T06 concurrent owners do not lose leases and exact rollback is receipt-fenced", async (t) => {
  const fixture = createFixture(t);
  const [first, second] = await Promise.all([
    ensureKeepLive(ensureInput(fixture.workspaceRoot)),
    ensureKeepLive(ensureInput(fixture.workspaceRoot, {
      demandId: IDS.demandTwo,
      automationRunId: IDS.groupTwo,
    })),
  ]);
  assert.equal(inspectKeepLive({ workspaceRoot: fixture.workspaceRoot, hostProfile }).leaseCount, 2);
  const releases = await Promise.all([
    releaseKeepLive({
      workspaceRoot: fixture.workspaceRoot,
      hostProfile,
      automationRunId: IDS.group,
      leaseDigest: first.lease.digest,
    }),
    releaseKeepLive({
      workspaceRoot: fixture.workspaceRoot,
      hostProfile,
      automationRunId: IDS.groupTwo,
      leaseDigest: second.lease.digest,
    }),
  ]);
  assert.deepEqual(
    releases.map((value) => value.status).sort(),
    ["host-operation-required", "retained-by-other-runs"],
  );
  const stop = releases.find((value) => value.hostOperation !== null).hostOperation;
  assert.equal(inspectKeepLive({ workspaceRoot: fixture.workspaceRoot, hostProfile }).leaseCount, 0);
  await recordKeepLiveStopOutcome({
    workspaceRoot: fixture.workspaceRoot,
    hostProfile,
    generationId: stop.generationId,
    requestId: stop.requestId,
    outcome: { status: "stopped", observedAt: new Date().toISOString(), errorCode: null },
  });

  const rollbackFixture = createFixture(t);
  const created = await ensureKeepLive(ensureInput(rollbackFixture.workspaceRoot));
  const rolledBack = await rollbackKeepLiveEnsure({ result: created });
  assert.equal(rolledBack.status, "host-operation-required");
  assert.equal(rolledBack.releasedLease.digest, created.lease.digest);
  assert.equal(existsSync(leasePath(rollbackFixture)), false);
  await recordKeepLiveStopOutcome({
    workspaceRoot: rollbackFixture.workspaceRoot,
    hostProfile,
    generationId: rolledBack.hostOperation.generationId,
    requestId: rolledBack.hostOperation.requestId,
    outcome: { status: "stopped", observedAt: new Date().toISOString(), errorCode: null },
  });
  const replayedRollback = await rollbackKeepLiveEnsure({ result: created });
  assert.equal(replayedRollback.status, "already-released");

  const mutableFixture = createFixture(t);
  const mutableProfile = structuredClone(hostProfile);
  const mutableResult = await ensureKeepLive(ensureInput(mutableFixture.workspaceRoot, {
    hostProfile: mutableProfile,
  }));
  mutableProfile.capabilities.keepLive.applicable = false;
  const mutationSafeRollback = await rollbackKeepLiveEnsure({ result: mutableResult });
  assert.equal(mutationSafeRollback.releasedLease.digest, mutableResult.lease.digest);
});

test("M4-T06 disabled and unavailable capability create no event facts", async (t) => {
  for (const requestedCapability of ["disabled", "unavailable"]) {
    const fixture = createFixture(t);
    const before = fixtureTree(fixture.keepLiveRoot);
    const result = await ensureKeepLive(ensureInput(fixture.workspaceRoot, {
      capability: requestedCapability,
    }));
    assert.equal(result.status, "risk");
    assert.equal(result.leaseCreated, false);
    assert.equal(result.lease, null);
    assert.deepEqual(fixtureTree(fixture.keepLiveRoot), before);
  }
});

test("M4-T06 corrupt, schema-mismatched, and unknown residue fail closed without overwrite", async (t) => {
  for (const mutation of [
    (fixture) => writeFileSync(leasePath(fixture), "{not-json\n", { mode: 0o600 }),
    (fixture) => writeCanonical(leasePath(fixture), { schemaVersion: 1 }),
    (fixture) => writeFileSync(path.join(fixture.keepLiveRoot, "mystery.json"), "{}\n", { mode: 0o600 }),
  ]) {
    const fixture = createFixture(t);
    mutation(fixture);
    const before = fixtureTree(fixture.keepLiveRoot);
    assert.throws(
      () => inspectKeepLive({ workspaceRoot: fixture.workspaceRoot, hostProfile }),
      /failed closed|valid JSON|closed record|unknown entry/u,
    );
    await assert.rejects(() => ensureKeepLive(ensureInput(fixture.workspaceRoot)));
    assert.deepEqual(fixtureTree(fixture.keepLiveRoot), before);
  }
});

test("M4-T06 manager mutex recovers only an exact dead-or-reused process identity", async (t) => {
  const fixture = createFixture(t);
  const now = new Date().toISOString();
  const reused = createKeepLiveManagerLockRecord({
    programId: IDS.program,
    hostId: "codex",
    lockId: generateKeepLiveRequestId(),
    workspaceOperationId: `workspace-mutation_${generateKeepLiveRequestId().slice("keep-live-request_".length)}`,
    owner: {
      ...captureWakeflowProcessIdentity(),
      startIdentity: `sha256:${"0".repeat(64)}`,
    },
    acquiredAt: now,
  });
  writeFileSync(managerLockPath(fixture), keepLiveManagerLockCanonicalBytes(reused), { mode: 0o600 });
  const recovered = await ensureKeepLive(ensureInput(fixture.workspaceRoot));
  assert.equal(recovered.leaseCreated, true);
  assert.equal(existsSync(managerLockPath(fixture)), false);

  const live = createKeepLiveManagerLockRecord({
    programId: IDS.program,
    hostId: "codex",
    lockId: generateKeepLiveRequestId(),
    workspaceOperationId: `workspace-mutation_${generateKeepLiveRequestId().slice("keep-live-request_".length)}`,
    owner: captureWakeflowProcessIdentity(),
    acquiredAt: new Date().toISOString(),
  });
  writeFileSync(managerLockPath(fixture), keepLiveManagerLockCanonicalBytes(live), { mode: 0o600 });
  const bytes = readFileSync(managerLockPath(fixture));
  await assert.rejects(() => ensureKeepLive(ensureInput(fixture.workspaceRoot)), {
    code: "wakeflow-keep-live-manager-busy",
  });
  assert.deepEqual(readFileSync(managerLockPath(fixture)), bytes);
});

test("M4-T06 process lifetime, executable, argv, and parent mismatch block reuse and signaling", async (t) => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  t.after(() => {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  });
  await sleep(50);
  const worker = inspectWakeflowProcessSnapshot(process.pid);
  const childSubject = inspectWakeflowProcessSnapshot(child.pid);
  assert.ok(worker);
  assert.ok(childSubject);
  assert.equal(childSubject.parentPid, worker.identity.pid);
  const mismatches = [
    {
      name: "process-lifetime",
      mutate: (subject) => ({
        ...subject,
        identity: { ...subject.identity, startIdentity: `sha256:${"0".repeat(64)}` },
      }),
    },
    {
      name: "executable",
      mutate: (subject) => ({ ...subject, executableDigest: `sha256:${"1".repeat(64)}` }),
    },
    {
      name: "argv",
      mutate: (subject) => ({ ...subject, argvDigest: `sha256:${"2".repeat(64)}` }),
    },
    {
      name: "parent",
      mutate: (subject) => ({ ...subject, parentPid: subject.parentPid + 1 }),
    },
  ];
  for (const mismatch of mismatches) {
    const fixture = createFixture(t);
    const time = new Date().toISOString();
    const generationId = generateKeepLiveGenerationId();
    const requestId = generateKeepLiveRequestId();
    const lease = createKeepLiveLeaseRecord({
      programId: IDS.program,
      hostId: "codex",
      demandId: IDS.demand,
      automationRunId: IDS.group,
      acquiredAt: time,
      lastConfirmedAt: time,
    });
    const processRecord = createKeepLiveProcessRecord({
      programId: IDS.program,
      hostId: "codex",
      generationId,
      capability: "macos-caffeinate",
      mechanism: "worker-caffeinate",
      status: "running",
      worker: mismatch.mutate(worker),
      child: childSubject,
      controlRequestId: requestId,
      controlRevision: 1,
      createdAt: time,
      startedAt: time,
      observedAt: time,
      stopRequestedAt: null,
      errorCode: null,
    });
    writeFileSync(leasePath(fixture), keepLiveLeaseCanonicalBytes(lease), { mode: 0o600 });
    writeFileSync(processPath(fixture), keepLiveProcessCanonicalBytes(processRecord), { mode: 0o600 });
    const before = readFileSync(processPath(fixture));
    await assert.rejects(() => ensureKeepLive(ensureInput(fixture.workspaceRoot)), {
      code: "wakeflow-keep-live-process-identity",
    }, mismatch.name);
    assert.deepEqual(readFileSync(processPath(fixture)), before, mismatch.name);
    const released = await releaseKeepLive({
      workspaceRoot: fixture.workspaceRoot,
      hostProfile,
      automationRunId: IDS.group,
      leaseDigest: lease.leaseDigest,
    });
    assert.equal(released.status, "manual-reconcile-required", mismatch.name);
    assert.equal(existsSync(leasePath(fixture)), false, mismatch.name);
    assert.deepEqual(readFileSync(processPath(fixture)), before, mismatch.name);
    assert.equal(child.killed, false, mismatch.name);
  }
});
