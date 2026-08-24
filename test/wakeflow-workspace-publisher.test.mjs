import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const managerFile = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-workspace-mutation.mjs",
);
const managerUrl = pathToFileURL(managerFile).href;

const localRelative = ".wakeflow-local";
const runtimeRelative = `${localRelative}/runtime`;
const maintenanceRelative = `${runtimeRelative}/maintenance`;
const transactionsRelative = `${maintenanceRelative}/transactions`;
const lockRelative = `${runtimeRelative}/maintenance.lock`;
const publisherPrefix = ".wakeflow-publish.";
const publisherPlatformSkip = ["darwin", "linux"].includes(process.platform)
  ? false
  : "publisher process identity supports Darwin and Linux";

const zeroPlan = Object.freeze({
  schemaId: "urn:wakeflow:internal:test-publisher-plan:v1",
  payload: Object.freeze({ steps: Object.freeze([]) }),
});

const preloadSource = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");

const mode = process.env.WAKEFLOW_PUBLISHER_FAULT;
const lockPath = path.resolve(process.env.WAKEFLOW_PUBLISHER_LOCK);
const eventFile = process.env.WAKEFLOW_PUBLISHER_EVENTS;
const publisherPrefix = ".wakeflow-publish.";
const original = {
  appendFileSync: fs.appendFileSync,
  fstatSync: fs.fstatSync,
  fsyncSync: fs.fsyncSync,
  linkSync: fs.linkSync,
  realpathSync: fs.realpathSync,
  unlinkSync: fs.unlinkSync,
};

let linked = false;
let stageUnlinked = false;
let targetFaults = 0;
let cleanupFaults = 0;
let scanStageRemoved = false;

function mark(event) {
  original.appendFileSync(eventFile, event + "\n", "utf8");
}

function killNow(event) {
  mark(event);
  process.kill(process.pid, "SIGKILL");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
}

function holdLive(event) {
  mark(event);
  const fence = new Int32Array(new SharedArrayBuffer(4));
  while (true) Atomics.wait(fence, 0, 0, 1_000);
}

fs.linkSync = function patchedLink(existingPath, targetPath) {
  if (path.resolve(String(targetPath)) !== lockPath) {
    return original.linkSync.apply(this, arguments);
  }
  if (mode === "pre-link-hold") holdLive("pre-link-hold");
  if (mode === "pre-link-kill") killNow("pre-link-kill");
  const result = original.linkSync.apply(this, arguments);
  linked = true;
  mark("linked");
  if (mode === "post-link-kill") killNow("post-link-kill");
  if (mode === "post-link-hold") holdLive("post-link-hold");
  return result;
};

fs.unlinkSync = function patchedUnlink(candidate) {
  const result = original.unlinkSync.apply(this, arguments);
  if (linked && path.basename(String(candidate)).startsWith(publisherPrefix)) {
    stageUnlinked = true;
    mark("publisher-unlinked");
    if (mode === "target-only-kill") killNow("target-only-kill");
  }
  return result;
};

fs.realpathSync = function patchedRealpath(candidate) {
  if (
    mode === "scan-stage-disappears"
    && !scanStageRemoved
    && path.basename(String(candidate)).startsWith(publisherPrefix)
  ) {
    scanStageRemoved = true;
    original.unlinkSync(candidate);
    mark("scan-stage-removed");
  }
  return original.realpathSync.apply(this, arguments);
};

fs.fsyncSync = function patchedFsync(descriptor) {
  const isDirectory = original.fstatSync(descriptor).isDirectory();
  if (isDirectory && linked && !stageUnlinked) {
    if (mode === "target-fsync-once" && targetFaults++ === 0) {
      mark("target-fsync-fault-once");
      const error = new Error("injected target-directory fsync failure");
      error.code = "EIO";
      throw error;
    }
    if (mode === "target-fsync-always") {
      targetFaults += 1;
      mark("target-fsync-fault-always");
      const error = new Error("injected persistent target-directory fsync failure");
      error.code = "EIO";
      throw error;
    }
    const result = original.fsyncSync.apply(this, arguments);
    mark("target-fsync-durable");
    return result;
  }
  if (isDirectory && linked && stageUnlinked) {
    if (mode === "cleanup-fsync-once" && cleanupFaults++ === 0) {
      mark("cleanup-fsync-fault-once");
      const error = new Error("injected publisher-cleanup fsync failure");
      error.code = "EIO";
      throw error;
    }
    const result = original.fsyncSync.apply(this, arguments);
    mark("cleanup-fsync-durable");
    return result;
  }
  return original.fsyncSync.apply(this, arguments);
};

syncBuiltinESMExports();
`;

const childSource = String.raw`
const { appendFileSync } = await import("node:fs");
const { pathToFileURL } = await import("node:url");
const manager = await import(pathToFileURL(process.env.WAKEFLOW_PUBLISHER_MANAGER).href);
let callbackCount = 0;
try {
  const result = await manager.withWakeflowRuntimeMutation({
    workspaceRoot: process.env.WAKEFLOW_PUBLISHER_WORKSPACE,
    operationKind: "publisher-fault-fixture",
    domainOwner: "publisher-fault-test",
    acquireTimeoutMs: 0,
  }, async () => {
    callbackCount += 1;
    appendFileSync(process.env.WAKEFLOW_PUBLISHER_CALLBACKS, "callback\n", "utf8");
    return { callbackCount };
  });
  process.stdout.write(JSON.stringify({ ok: true, callbackCount, result }) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    callbackCount,
    code: error?.code ?? null,
    message: String(error?.message ?? error),
  }) + "\n");
  process.exitCode = 23;
}
`;

function protocolPath(workspaceRoot, relativePath) {
  return path.join(workspaceRoot, ...relativePath.split("/"));
}

function bootstrapProtocol(workspaceRoot) {
  for (const relative of [
    localRelative,
    runtimeRelative,
    maintenanceRelative,
    transactionsRelative,
  ]) {
    const candidate = protocolPath(workspaceRoot, relative);
    mkdirSync(candidate, { mode: 0o700 });
    chmodSync(candidate, 0o700);
  }
}

function fixture(t, prefix) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  const harnessRoot = mkdtempSync(path.join(os.tmpdir(), `${prefix}harness-`));
  bootstrapProtocol(workspaceRoot);
  const preloadFile = path.join(harnessRoot, "publisher-fault-preload.cjs");
  const eventFile = path.join(harnessRoot, "events.log");
  const callbackFile = path.join(harnessRoot, "callbacks.log");
  writeFileSync(preloadFile, preloadSource, { mode: 0o600 });
  t.after(() => {
    rmSync(workspaceRoot, { force: true, recursive: true });
    rmSync(harnessRoot, { force: true, recursive: true });
  });
  return { workspaceRoot, harnessRoot, preloadFile, eventFile, callbackFile };
}

function spawnFaultChild(current, fault) {
  const child = spawn(process.execPath, [
    "--require",
    current.preloadFile,
    "--input-type=module",
    "-e",
    childSource,
  ], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      WAKEFLOW_PUBLISHER_CALLBACKS: current.callbackFile,
      WAKEFLOW_PUBLISHER_EVENTS: current.eventFile,
      WAKEFLOW_PUBLISHER_FAULT: fault,
      WAKEFLOW_PUBLISHER_LOCK: protocolPath(current.workspaceRoot, lockRelative),
      WAKEFLOW_PUBLISHER_MANAGER: managerFile,
      WAKEFLOW_PUBLISHER_WORKSPACE: current.workspaceRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const done = once(child, "exit").then(([code, signal]) => ({ code, signal, stdout, stderr }));
  return { child, done };
}

function callbackCount(current) {
  if (!existsSync(current.callbackFile)) return 0;
  return readFileSync(current.callbackFile, "utf8").trim().split("\n").filter(Boolean).length;
}

function events(current) {
  if (!existsSync(current.eventFile)) return [];
  return readFileSync(current.eventFile, "utf8").trim().split("\n").filter(Boolean);
}

function publisherFiles(workspaceRoot) {
  const runtimeRoot = protocolPath(workspaceRoot, runtimeRelative);
  return readdirSync(runtimeRoot)
    .filter((name) => name.startsWith(publisherPrefix))
    .sort()
    .map((name) => path.join(runtimeRoot, name));
}

function readCanonical(candidate) {
  return JSON.parse(readFileSync(candidate, "utf8"));
}

function residueOperationId(workspaceRoot) {
  const lockFile = protocolPath(workspaceRoot, lockRelative);
  if (existsSync(lockFile)) return readCanonical(lockFile).operationId;
  const stages = publisherFiles(workspaceRoot);
  assert.equal(stages.length, 1, "one publisher stage must identify the interrupted operation");
  return readCanonical(stages[0]).operationId;
}

function digest(candidate) {
  return createHash("sha256").update(readFileSync(candidate)).digest("hex");
}

function publicationSnapshot(workspaceRoot) {
  const runtimeRoot = protocolPath(workspaceRoot, runtimeRelative);
  const names = readdirSync(runtimeRoot)
    .filter((name) => name === "maintenance.lock" || name.startsWith(publisherPrefix))
    .sort();
  return names.map((name) => {
    const candidate = path.join(runtimeRoot, name);
    const stat = lstatSync(candidate);
    return {
      name,
      device: String(stat.dev),
      inode: String(stat.ino),
      links: stat.nlink,
      mode: stat.mode & 0o777,
      size: stat.size,
      digest: digest(candidate),
    };
  });
}

function assertStageOnly(workspaceRoot) {
  const stages = publisherFiles(workspaceRoot);
  assert.equal(stages.length, 1);
  const stage = lstatSync(stages[0]);
  assert.equal(stage.isFile(), true);
  assert.equal(stage.nlink, 1);
  assert.equal(stage.mode & 0o777, 0o600);
  assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
}

function assertPublicationPair(workspaceRoot) {
  const stages = publisherFiles(workspaceRoot);
  const lockFile = protocolPath(workspaceRoot, lockRelative);
  assert.equal(stages.length, 1);
  assert.equal(existsSync(lockFile), true);
  const stage = lstatSync(stages[0]);
  const lock = lstatSync(lockFile);
  assert.equal(stage.nlink, 2);
  assert.equal(lock.nlink, 2);
  assert.equal(stage.mode & 0o777, 0o600);
  assert.equal(lock.mode & 0o777, 0o600);
  assert.equal(String(stage.dev), String(lock.dev));
  assert.equal(String(stage.ino), String(lock.ino));
  assert.equal(readFileSync(stages[0]).equals(readFileSync(lockFile)), true);
}

function assertTargetOnly(workspaceRoot) {
  assert.deepEqual(publisherFiles(workspaceRoot), []);
  const lock = lstatSync(protocolPath(workspaceRoot, lockRelative));
  assert.equal(lock.isFile(), true);
  assert.equal(lock.nlink, 1);
  assert.equal(lock.mode & 0o777, 0o600);
}

function assertClean(workspaceRoot) {
  assert.equal(existsSync(protocolPath(workspaceRoot, lockRelative)), false);
  assert.deepEqual(publisherFiles(workspaceRoot), []);
  assert.deepEqual(readdirSync(protocolPath(workspaceRoot, transactionsRelative)), []);
}

async function validatePlan({ plan }) {
  assert.equal(plan !== null && typeof plan === "object" && !Array.isArray(plan), true);
  assert.equal(typeof plan.schemaId, "string");
  assert.equal(Array.isArray(plan.payload?.steps), true);
  return { valid: true };
}

async function recoverZeroStep(workspaceRoot, operationId) {
  const { recoverWakeflowWorkspaceMutation } = await import(managerUrl);
  return recoverWakeflowWorkspaceMutation({
    workspaceRoot,
    operationId,
    confirmedPlan: zeroPlan,
    planDigest: canonicalJsonDigest(zeroPlan),
    validatePlan,
    deriveCurrentPlan: async () => zeroPlan,
    stepHandlers: {},
  });
}

async function waitFor(predicate, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

function parseChildResult(result) {
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, `unexpected child stdout; stderr=${result.stderr}`);
  return JSON.parse(lines[0]);
}

test("publisher SIGKILL before link leaves only a recoverable durable stage", {
  skip: publisherPlatformSkip,
}, async (t) => {
  const current = fixture(t, "wakeflow-publisher-pre-link-");
  const running = spawnFaultChild(current, "pre-link-kill");
  const result = await running.done;
  assert.equal(result.signal, "SIGKILL", result.stderr);
  assert.equal(callbackCount(current), 0);
  assert.deepEqual(events(current), ["pre-link-kill"]);
  assertStageOnly(current.workspaceRoot);

  const before = publicationSnapshot(current.workspaceRoot);
  const { withWakeflowRuntimeMutation } = await import(managerUrl);
  let contenderCalls = 0;
  await assert.rejects(
    () => withWakeflowRuntimeMutation({
      workspaceRoot: current.workspaceRoot,
      operationKind: "publisher-dead-stage-contender",
      domainOwner: "publisher-fault-test",
      acquireTimeoutMs: 0,
    }, async () => {
      contenderCalls += 1;
    }),
    (error) => error?.code === "wakeflow-mutation-recovery-required",
  );
  assert.equal(contenderCalls, 0);
  assert.deepEqual(publicationSnapshot(current.workspaceRoot), before);

  await recoverZeroStep(current.workspaceRoot, residueOperationId(current.workspaceRoot));
  assertClean(current.workspaceRoot);
});

test("a live pre-link gate publisher is an admission contender, not recovery residue", {
  skip: publisherPlatformSkip,
}, async (t) => {
  const current = fixture(t, "wakeflow-publisher-live-pre-link-");
  const running = spawnFaultChild(current, "pre-link-hold");
  t.after(() => {
    if (running.child.exitCode === null && running.child.signalCode === null) {
      running.child.kill("SIGKILL");
    }
  });
  await waitFor(
    () => events(current).includes("pre-link-hold"),
    "publisher child did not stop before linking the gate",
  );
  assertStageOnly(current.workspaceRoot);

  const { withWakeflowRuntimeMutation } = await import(managerUrl);
  let contenderCalls = 0;
  const result = await withWakeflowRuntimeMutation({
    workspaceRoot: current.workspaceRoot,
    operationKind: "publisher-live-stage-contender",
    domainOwner: "publisher-fault-test",
    acquireTimeoutMs: 1_000,
  }, async () => {
    contenderCalls += 1;
    return "admitted";
  });
  assert.equal(result, "admitted");
  assert.equal(contenderCalls, 1);
  assertStageOnly(current.workspaceRoot);

  running.child.kill("SIGKILL");
  const childResult = await running.done;
  assert.equal(childResult.signal, "SIGKILL", childResult.stderr);
  await recoverZeroStep(current.workspaceRoot, residueOperationId(current.workspaceRoot));
  assertClean(current.workspaceRoot);
});

test("a live gate publisher that disappears during admission inspection defers to gate acquisition", {
  skip: publisherPlatformSkip,
}, async (t) => {
  const current = fixture(t, "wakeflow-publisher-live-disappears-");
  const running = spawnFaultChild(current, "pre-link-hold");
  t.after(() => {
    if (running.child.exitCode === null && running.child.signalCode === null) {
      running.child.kill("SIGKILL");
    }
  });
  await waitFor(
    () => events(current).includes("pre-link-hold"),
    "publisher child did not stop before linking the gate",
  );
  assertStageOnly(current.workspaceRoot);

  const contender = spawnFaultChild(current, "scan-stage-disappears");
  const contenderResult = await contender.done;
  assert.equal(contenderResult.code, 0, contenderResult.stderr);
  assert.equal(contenderResult.signal, null);
  assert.equal(parseChildResult(contenderResult).ok, true);
  assert.equal(callbackCount(current), 1);
  assert.equal(events(current).includes("scan-stage-removed"), true);
  assertClean(current.workspaceRoot);

  running.child.kill("SIGKILL");
  const publisherResult = await running.done;
  assert.equal(publisherResult.signal, "SIGKILL", publisherResult.stderr);
  assertClean(current.workspaceRoot);
});

test("publisher SIGKILL after link leaves an exact pair and rejects a nonzero recovery plan without mutation", {
  skip: publisherPlatformSkip,
}, async (t) => {
  const current = fixture(t, "wakeflow-publisher-post-link-");
  const running = spawnFaultChild(current, "post-link-kill");
  const result = await running.done;
  assert.equal(result.signal, "SIGKILL", result.stderr);
  assert.equal(callbackCount(current), 0);
  assert.deepEqual(events(current), ["linked", "post-link-kill"]);
  assertPublicationPair(current.workspaceRoot);

  const operationId = residueOperationId(current.workspaceRoot);
  const before = publicationSnapshot(current.workspaceRoot);
  const nonzeroPlan = {
    schemaId: zeroPlan.schemaId,
    payload: { steps: [{ stepId: "must-not-run" }] },
  };
  const { recoverWakeflowWorkspaceMutation } = await import(managerUrl);
  await assert.rejects(
    () => recoverWakeflowWorkspaceMutation({
      workspaceRoot: current.workspaceRoot,
      operationId,
      confirmedPlan: nonzeroPlan,
      planDigest: canonicalJsonDigest(nonzeroPlan),
      validatePlan,
      deriveCurrentPlan: async () => nonzeroPlan,
      stepHandlers: {},
    }),
    (error) => error?.code === "wakeflow-mutation-invalid-plan"
      && /publisher-only/u.test(error.message),
  );
  assert.deepEqual(publicationSnapshot(current.workspaceRoot), before);

  await recoverZeroStep(current.workspaceRoot, operationId);
  assertClean(current.workspaceRoot);
});

test("publisher SIGKILL after durable target and stage unlink leaves only the recoverable target", {
  skip: publisherPlatformSkip,
}, async (t) => {
  const current = fixture(t, "wakeflow-publisher-target-only-");
  const running = spawnFaultChild(current, "target-only-kill");
  const result = await running.done;
  assert.equal(result.signal, "SIGKILL", result.stderr);
  assert.equal(callbackCount(current), 0);
  assert.equal(events(current).includes("target-fsync-durable"), true);
  assert.equal(events(current).includes("publisher-unlinked"), true);
  assert.equal(events(current).includes("cleanup-fsync-durable"), false);
  assertTargetOnly(current.workspaceRoot);

  await recoverZeroStep(current.workspaceRoot, residueOperationId(current.workspaceRoot));
  assertClean(current.workspaceRoot);
});

for (const scenario of [
  {
    name: "a one-shot target-directory fsync failure is reconciled before callback",
    fault: "target-fsync-once",
    event: "target-fsync-fault-once",
  },
  {
    name: "a one-shot publisher-cleanup fsync failure succeeds from the exact target",
    fault: "cleanup-fsync-once",
    event: "cleanup-fsync-fault-once",
  },
]) {
  test(scenario.name, {
    skip: publisherPlatformSkip,
  }, async (t) => {
    const current = fixture(t, `wakeflow-publisher-${scenario.fault}-`);
    const running = spawnFaultChild(current, scenario.fault);
    const result = await running.done;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(parseChildResult(result).ok, true);
    assert.equal(callbackCount(current), 1);
    assert.equal(events(current).includes(scenario.event), true);
    assert.equal(events(current).includes("target-fsync-durable"), true);
    assertClean(current.workspaceRoot);
  });
}

test("persistent target-directory fsync failure invokes no callback and retains the exact pair", {
  skip: publisherPlatformSkip,
}, async (t) => {
  const current = fixture(t, "wakeflow-publisher-target-fsync-always-");
  const running = spawnFaultChild(current, "target-fsync-always");
  const result = await running.done;
  assert.equal(result.code, 23, result.stderr);
  assert.equal(result.signal, null);
  const report = parseChildResult(result);
  assert.equal(report.ok, false);
  assert.equal(report.callbackCount, 0);
  assert.equal(report.code, "wakeflow-mutation-durability-unknown");
  assert.equal(callbackCount(current), 0);
  assert.ok(events(current).filter((event) => event === "target-fsync-fault-always").length >= 2);
  assert.equal(events(current).includes("target-fsync-durable"), false);
  assert.equal(events(current).includes("publisher-unlinked"), false);
  assertPublicationPair(current.workspaceRoot);

  await recoverZeroStep(current.workspaceRoot, residueOperationId(current.workspaceRoot));
  assertClean(current.workspaceRoot);
});

test("same-live publisher owner is busy and its pair remains byte-for-byte unchanged", {
  skip: publisherPlatformSkip,
}, async (t) => {
  const current = fixture(t, "wakeflow-publisher-same-live-");
  const running = spawnFaultChild(current, "post-link-hold");
  t.after(() => {
    if (running.child.exitCode === null && running.child.signalCode === null) {
      running.child.kill("SIGKILL");
    }
  });
  await waitFor(
    () => events(current).includes("post-link-hold"),
    "publisher child did not stop on its live hard-link pair",
  );
  assert.deepEqual(events(current), ["linked", "post-link-hold"]);
  assert.equal(callbackCount(current), 0);
  assertPublicationPair(current.workspaceRoot);
  const operationId = residueOperationId(current.workspaceRoot);
  const before = publicationSnapshot(current.workspaceRoot);

  const { recoverWakeflowWorkspaceMutation } = await import(managerUrl);
  await assert.rejects(
    () => recoverWakeflowWorkspaceMutation({
      workspaceRoot: current.workspaceRoot,
      operationId,
      confirmedPlan: zeroPlan,
      planDigest: canonicalJsonDigest(zeroPlan),
      validatePlan,
      deriveCurrentPlan: async () => zeroPlan,
      stepHandlers: {},
    }),
    (error) => error?.code === "wakeflow-mutation-recovery-busy",
  );
  assert.deepEqual(publicationSnapshot(current.workspaceRoot), before);
  assert.equal(callbackCount(current), 0);

  running.child.kill("SIGKILL");
  const result = await running.done;
  assert.equal(result.signal, "SIGKILL", result.stderr);
  await recoverZeroStep(current.workspaceRoot, operationId);
  assertClean(current.workspaceRoot);
});
