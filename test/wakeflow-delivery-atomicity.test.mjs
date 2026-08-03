#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
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
import { runWakeflowRuntime } from "../core/lib/wakeflow-runtime.mjs";
import { transportArtifactFileName } from "../core/scripts/lib/wakeflow-artifact-identity.mjs";
import {
  dispatchPacketDigest,
  dispatchPreparationDigest,
} from "../core/scripts/lib/wakeflow-idempotency.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const runtimeTemp = mkdtempSync(path.join(os.tmpdir(), "wakeflow-delivery-runtime-"));
const runtimeRoot = path.join(runtimeTemp, "runtime");

cpSync(path.join(repositoryRoot, "core"), runtimeRoot, { recursive: true });
cpSync(
  path.join(repositoryRoot, "plugins/codex-wakeflow/scripts/lib/wakeflow-host-send-adapter.mjs"),
  path.join(runtimeRoot, "scripts/lib/wakeflow-host-send-adapter.mjs"),
);

const deliveryScript = path.join(runtimeRoot, "scripts/wakeflow-delivery.mjs");
const stateScript = path.join(runtimeRoot, "scripts/wakeflow-state.mjs");
const renderScript = path.join(runtimeRoot, "scripts/wakeflow-render-progress.mjs");
const INITIAL_REVISION = 11;
const TASK_COUNT = 24;

test.after(() => {
  rmSync(runtimeTemp, { recursive: true, force: true });
});

test("a canonical late delivery cannot revive a superseded task or package", () => {
  const fixture = makeFixture(1);
  const state = readJson(fixture.stateFile);
  state.taskPackages[0].status = "superseded";
  state.targetTasks[0].status = "superseded";
  state.targetTasks[0].replacedByTargetTaskId = "ATOMIC-REPLACEMENT";
  writeJson(fixture.stateFile, state);
  const stateBefore = readFileSync(fixture.stateFile, "utf8");
  const eventsBefore = readFileSync(fixture.eventsFile, "utf8");

  const recorded = run(fixture.root, deliveryArgs(fixture.deliveries[0]));
  assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
  const payload = JSON.parse(recorded.stdout);
  assert.equal(payload.stateUpdate.updated, false);
  assert.equal(payload.stateUpdate.reason, "target-task-already-superseded");
  assert.equal(readFileSync(fixture.stateFile, "utf8"), stateBefore);
  assert.equal(readFileSync(fixture.eventsFile, "utf8"), eventsBefore);
});

function writeText(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2));
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readEvents(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeBaselineEvents(file, revision = INITIAL_REVISION, demandKey = "ATOMIC") {
  writeText(
    file,
    Array.from({ length: revision }, (_, index) => JSON.stringify({
      eventId: `evt-${demandKey.toLowerCase()}-baseline-${String(index + 1).padStart(4, "0")}`,
      createdAt: "2026-07-30T00:00:00.000Z",
      actor: "fixture",
      type: index === 0 ? "demand.initialized" : "fixture.revision-advanced",
      from: "planned",
      to: "planned",
      reason: "synthetic authority history for delivery atomicity fixture",
      stateRevision: index + 1,
    })).join("\n"),
  );
}

function makeFixture(taskCount = TASK_COUNT) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-delivery-atomicity-"));
  const stateRootRef = ".wakeflow-active/current/ATOMIC";
  const stateRoot = path.join(root, stateRootRef);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const groupId = "GROUP-ATOMIC";
  const tasks = Array.from({ length: taskCount }, (_, index) => ({
    targetTaskId: `ATOMIC-TASK-${index + 1}`,
    taskPackageId: `ATOMIC-PACKAGE-${index + 1}`,
    targetWindow: `AtomicRepo${index + 1}`,
    summary: `Parallel target ${index + 1}`,
    status: "pending",
    createdAt: "2026-07-30T00:00:00.000Z",
  }));
  const packages = tasks.map((task) => ({
    taskPackageId: task.taskPackageId,
    summary: `Package for ${task.targetTaskId}`,
    status: "pending",
    createdAt: task.createdAt,
  }));
  const windows = tasks.map((task) => ({
    windowName: task.targetWindow,
    windowState: "pending",
    taskPackageIds: [task.taskPackageId],
    targetTaskIds: [task.targetTaskId],
  }));

  writeJson(path.join(root, "wakeflow.config.json"), {
    workspaceName: "Atomic Delivery Fixture",
    controllerWindow: "Controller",
    repositories: [
      { windowName: "Controller", path: ".", role: "controller" },
      ...tasks.map((task) => ({
        windowName: task.targetWindow,
        path: `repos/${task.targetWindow}`,
        role: "product",
      })),
    ],
    dispatchWindows: tasks.map((task) => task.targetWindow),
  });
  writeJson(stateFile, {
    schemaVersion: 1,
    demandKey: "ATOMIC",
    title: "Atomic Delivery Fixture",
    state: "planned",
    stateReason: "parallel delivery test",
    revision: INITIAL_REVISION,
    controllerHost: "codex",
    activeStageId: null,
    updatedAt: "2026-07-30T00:00:00.000Z",
    allowedActions: [],
    blockers: [],
    decisionsRequired: [],
    stages: [],
    taskPackages: packages,
    targetTasks: tasks,
    windows,
    review: {
      status: "none",
      readyResultIds: [],
      blockedResultIds: [],
      missingResultIds: [],
    },
    automation: {
      enabled: false,
      activeRunIds: [],
      lastReviewPack: null,
    },
    projection: {
      status: "synced",
      lastRenderedAt: "2026-07-30T00:00:00.000Z",
      progressDoc: "developer-progress.md",
    },
  });
  writeBaselineEvents(eventsFile);
  writeText(path.join(stateRoot, "developer-progress.md"), [
    "# Atomic Delivery Fixture",
    "",
    "## Decisions And Append Log",
  ].join("\n"));

  const deliveryDir = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-envelopes");
  const groupStateRef = {
    stateRoot: stateRootRef,
    demandKey: "ATOMIC",
    stateRevision: INITIAL_REVISION,
  };
  const groupFile = path.join(
    root,
    ".wakeflow-local/wakeflow-delivery/dispatch-groups",
    transportArtifactFileName(groupId, groupStateRef),
  );
  const expectedTargets = tasks.map((task) => ({
    targetWindow: task.targetWindow,
    taskId: task.targetTaskId,
    packetId: `${groupId}__${task.targetWindow}__${task.targetTaskId}`,
  }));
  writeJson(groupFile, {
    kind: "DispatchGroup",
    version: 1,
    groupId,
    stateRef: groupStateRef,
    controllerWindow: "Controller",
    expectedTargets,
    membershipFinalized: true,
    returnPolicy: { mode: "group-ready" },
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  });

  const deliveries = tasks.map((task) => {
    const deliveryId = `delivery-${groupId}__${task.targetWindow}__${task.targetTaskId}`;
    const stateRef = {
      stateRoot: stateRootRef,
      demandKey: "ATOMIC",
      taskPackageId: task.taskPackageId,
      targetTaskId: task.targetTaskId,
      stateRevision: INITIAL_REVISION,
    };
    const packetId = `${groupId}__${task.targetWindow}__${task.targetTaskId}`;
    const packet = {
      kind: "ControllerDispatchPacket",
      version: 2,
      id: packetId,
      targetWindow: task.targetWindow,
      taskId: task.targetTaskId,
      dispatchGroup: groupId,
      controllerWindow: "Controller",
      stateRef,
      objective: task.summary,
      scope: [],
      outOfScope: [],
      forbidden: [],
      evidenceRequired: [],
      prompt: `Execute ${task.targetTaskId}.`,
    };
    packet.packetDigest = dispatchPacketDigest(packet);
    writeJson(path.join(
      root,
      ".wakeflow-local/wakeflow-delivery/dispatch-packets",
      transportArtifactFileName(packetId, stateRef),
    ), packet);
    const file = path.join(deliveryDir, transportArtifactFileName(deliveryId, stateRef));
    const envelope = {
      kind: "DeliveryEnvelope",
      version: 2,
      deliveryId,
      sourcePacketId: packetId,
      sourcePacketDigest: packet.packetDigest,
      targetWindow: task.targetWindow,
      taskId: task.targetTaskId,
      dispatchGroup: groupId,
      controllerWindow: "Controller",
      stateRef,
      prompt: packet.prompt,
      returnRoute: "controller",
      oneShot: true,
      automation: {
        enabled: false,
        keepLive: false,
      },
      createdAt: "2026-07-30T00:00:00.000Z",
    };
    envelope.preparationDigest = dispatchPreparationDigest({ packet, envelope });
    writeJson(file, envelope);
    return { ...task, deliveryId, file, stateRef };
  });

  return {
    root,
    stateRoot,
    stateFile,
    eventsFile,
    deliveries,
  };
}

function addIndependentDelivery(fixture) {
  const stateRootRef = ".wakeflow-active/current/ATOMIC-B";
  const stateRoot = path.join(fixture.root, stateRootRef);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const task = {
    targetTaskId: "ATOMIC-B-TASK-1",
    taskPackageId: "ATOMIC-B-PACKAGE-1",
    targetWindow: "AtomicRepoB",
    summary: "Independent target",
    status: "pending",
    createdAt: "2026-07-30T00:00:00.000Z",
  };
  writeJson(stateFile, {
    schemaVersion: 1,
    demandKey: "ATOMIC-B",
    title: "Independent Atomic Delivery Fixture",
    state: "planned",
    stateReason: "cross-root run id test",
    revision: INITIAL_REVISION,
    controllerHost: "codex",
    activeStageId: null,
    updatedAt: "2026-07-30T00:00:00.000Z",
    allowedActions: [],
    blockers: [],
    decisionsRequired: [],
    stages: [],
    taskPackages: [{
      taskPackageId: task.taskPackageId,
      summary: `Package for ${task.targetTaskId}`,
      status: "pending",
      createdAt: task.createdAt,
    }],
    targetTasks: [task],
    windows: [{
      windowName: task.targetWindow,
      windowState: "pending",
      taskPackageIds: [task.taskPackageId],
      targetTaskIds: [task.targetTaskId],
    }],
    review: {
      status: "none",
      readyResultIds: [],
      blockedResultIds: [],
      missingResultIds: [],
    },
    automation: {
      enabled: false,
      activeRunIds: [],
      lastReviewPack: null,
    },
    projection: {
      status: "synced",
      lastRenderedAt: "2026-07-30T00:00:00.000Z",
      progressDoc: "developer-progress.md",
    },
  });
  writeBaselineEvents(path.join(stateRoot, "controller-events.jsonl"), INITIAL_REVISION, "ATOMIC-B");
  writeText(path.join(stateRoot, "developer-progress.md"), [
    "# Independent Atomic Delivery Fixture",
    "",
    "## Decisions And Append Log",
  ].join("\n"));
  const deliveryId = "delivery-ATOMIC-B";
  const stateRef = {
    stateRoot: stateRootRef,
    demandKey: "ATOMIC-B",
    taskPackageId: task.taskPackageId,
    targetTaskId: task.targetTaskId,
    stateRevision: INITIAL_REVISION,
  };
  const packet = {
    kind: "ControllerDispatchPacket",
    version: 2,
    id: "ATOMIC-B-PACKET",
    targetWindow: task.targetWindow,
    taskId: task.targetTaskId,
    controllerWindow: "Controller",
    stateRef,
    objective: task.summary,
    scope: [],
    outOfScope: [],
    forbidden: [],
    evidenceRequired: [],
    prompt: `Execute ${task.targetTaskId}.`,
  };
  packet.packetDigest = dispatchPacketDigest(packet);
  writeJson(path.join(
    fixture.root,
    ".wakeflow-local/wakeflow-delivery/dispatch-packets",
    transportArtifactFileName(packet.id, stateRef),
  ), packet);
  const file = path.join(
    fixture.root,
    ".wakeflow-local/wakeflow-delivery/delivery-envelopes",
    transportArtifactFileName(deliveryId, stateRef),
  );
  const envelope = {
    kind: "DeliveryEnvelope",
    version: 2,
    deliveryId,
    sourcePacketId: packet.id,
    sourcePacketDigest: packet.packetDigest,
    targetWindow: task.targetWindow,
    taskId: task.targetTaskId,
    controllerWindow: "Controller",
    stateRef,
    prompt: packet.prompt,
    returnRoute: "controller",
    oneShot: true,
    automation: {
      enabled: false,
      keepLive: false,
    },
    createdAt: "2026-07-30T00:00:00.000Z",
  };
  envelope.preparationDigest = dispatchPreparationDigest({ packet, envelope });
  writeJson(file, envelope);
  return {
    ...task,
    deliveryId,
    file,
    stateRef,
    stateRoot,
    stateFile,
  };
}

function deliveryArgs(delivery, extra = []) {
  return [
    "record-delivery-run",
    "--delivery-file",
    delivery.file,
    "--status",
    "sent",
    "--readback-ok",
    "true",
    "--evidence",
    `host readback confirmed ${delivery.targetTaskId}`,
    "--write",
    ...extra,
  ];
}

function deliveryRunFile(root, delivery, runId = `run-${delivery.deliveryId}`) {
  return path.join(
    root,
    ".wakeflow-local/wakeflow-delivery/delivery-runs",
    transportArtifactFileName(runId, delivery.stateRef),
  );
}

function run(root, args) {
  return spawnSync(process.execPath, [deliveryScript, ...args, "--root", root, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

function runState(root, args) {
  return spawnSync(process.execPath, [stateScript, ...args, "--root", root, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

function runRender(root, args) {
  return spawnSync(process.execPath, [renderScript, ...args, "--root", root, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

function runAsync(root, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [deliveryScript, ...args, "--root", root, "--json"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function parseOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function parseStructuredRetryableFailure(result) {
  assert.notEqual(result.status, 0, "the unsafe state transition must fail closed");
  let payload;
  assert.doesNotThrow(() => {
    payload = JSON.parse(result.stdout);
  }, `failure must be structured JSON, not a raw exception:\n${result.stderr || result.stdout}`);
  assert.equal(payload.ok, false);
  assert.equal(
    payload.diagnostics?.retryable,
    true,
    `the failure must tell the caller that the same immutable run can be retried: ${result.stdout}`,
  );
  return payload;
}

test("parallel delivery records serialize state and event revisions", async () => {
  const fixture = makeFixture();
  try {
    const results = await Promise.all(
      fixture.deliveries.map((delivery) => runAsync(fixture.root, deliveryArgs(delivery))),
    );
    const payloads = results.map(parseOk);
    assert.equal(payloads.length, TASK_COUNT);
    assert.ok(payloads.every((payload) => payload.wrote === true));
    assert.ok(payloads.every((payload) => payload.status === "sent"));
    assert.ok(payloads.every((payload) => payload.stateUpdate?.updated === true));

    const state = readJson(fixture.stateFile);
    assert.equal(state.revision, INITIAL_REVISION + TASK_COUNT);
    assert.equal(state.state, "dispatched");
    for (const task of state.targetTasks) {
      assert.equal(task.status, "sent", `${task.targetTaskId} should be sent`);
      assert.equal(task.counts?.dispatchCount, 1, `${task.targetTaskId} should be counted once`);
      assert.ok(task.delivery?.deliveryRunId, `${task.targetTaskId} should retain its run`);
    }

    const deliveryEvents = readEvents(fixture.eventsFile)
      .filter((event) => event.type === "delivery.sent");
    assert.equal(deliveryEvents.length, TASK_COUNT);
    const revisions = deliveryEvents.map((event) => event.stateRevision).sort((a, b) => a - b);
    assert.deepEqual(
      revisions,
      Array.from({ length: TASK_COUNT }, (_, index) => INITIAL_REVISION + index + 1),
    );
    assert.equal(new Set(revisions).size, TASK_COUNT);
    assert.equal(existsSync(`${fixture.stateRoot}.state-lock`), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a workspace-local copied envelope cannot advance delivery state", () => {
  const fixture = makeFixture(1);
  try {
    const delivery = fixture.deliveries[0];
    const forgedFile = path.join(fixture.root, "copied-envelope.json");
    writeJson(forgedFile, readJson(delivery.file));
    const stateBefore = readFileSync(fixture.stateFile, "utf8");
    const eventsBefore = readFileSync(fixture.eventsFile, "utf8");
    const forged = run(fixture.root, deliveryArgs({ ...delivery, file: forgedFile }));
    assert.notEqual(forged.status, 0);
    assert.match(forged.stdout + forged.stderr, /canonical envelope/i);
    assert.equal(readFileSync(fixture.stateFile, "utf8"), stateBefore);
    assert.equal(readFileSync(fixture.eventsFile, "utf8"), eventsBefore);
    const runFile = deliveryRunFile(fixture.root, delivery);
    assert.equal(existsSync(runFile), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("same delivery-run replay is idempotent and repairs an interrupted state update", () => {
  const fixture = makeFixture(1);
  try {
    const delivery = fixture.deliveries[0];
    const initialState = readJson(fixture.stateFile);
    const first = parseOk(run(fixture.root, deliveryArgs(delivery)));
    assert.equal(first.wrote, true);
    assert.equal(first.stateUpdate.updated, true);

    const sentState = readJson(fixture.stateFile);
    const sentEvents = readEvents(fixture.eventsFile);
    const duplicate = parseOk(run(fixture.root, deliveryArgs(delivery)));
    assert.equal(duplicate.wrote, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.stateUpdate.updated, false);
    assert.equal(duplicate.stateUpdate.reason, "target-task-already-sent");
    assert.equal(readJson(fixture.stateFile).revision, sentState.revision);
    assert.equal(readEvents(fixture.eventsFile).length, sentEvents.length);
    assert.equal(readJson(fixture.stateFile).targetTasks[0].counts?.dispatchCount, 1);

    // Simulate the supported event-first crash window: the immutable run and
    // delivery event survived, but the authoritative state snapshot did not.
    writeJson(fixture.stateFile, initialState);
    const recovered = parseOk(run(fixture.root, deliveryArgs(delivery)));
    assert.equal(recovered.wrote, false);
    assert.equal(recovered.duplicate, true);
    assert.equal(recovered.stateUpdate.updated, true);
    assert.equal(readJson(fixture.stateFile).revision, INITIAL_REVISION + 1);
    assert.equal(readJson(fixture.stateFile).targetTasks[0].counts?.dispatchCount, 1);
    assert.equal(
      readEvents(fixture.eventsFile).filter((event) => event.type === "delivery.sent").length,
      1,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("delivery event publication failure leaves no partial tail and replay completes once", {
  skip: typeof process.getuid === "function" && process.getuid() === 0
    ? "chmod is bypassed when running as root"
    : false,
}, () => {
  const fixture = makeFixture(1);
  try {
    const delivery = fixture.deliveries[0];
    const beforeState = readJson(fixture.stateFile);
    const beforeEvents = readFileSync(fixture.eventsFile, "utf8");
    chmodSync(fixture.stateRoot, 0o500);
    let failed;
    try {
      failed = run(fixture.root, deliveryArgs(delivery));
    } finally {
      chmodSync(fixture.stateRoot, 0o700);
    }

    const failure = parseStructuredRetryableFailure(failed);
    assert.equal(failure.errorCode, "delivery-state-recovery-required");
    assert.equal(failure.diagnostics?.recovery?.strategy, "replay-delivery-run");
    assert.deepEqual(readJson(fixture.stateFile), beforeState);
    assert.equal(
      readFileSync(fixture.eventsFile, "utf8"),
      beforeEvents,
      "failed publication must leave no partial JSONL tail",
    );
    const runFile = deliveryRunFile(fixture.root, delivery);
    assert.equal(existsSync(runFile), true, "the immutable host-send run remains the replay journal");

    const recovered = parseOk(run(fixture.root, deliveryArgs(delivery)));
    assert.equal(recovered.duplicate, true);
    assert.equal(recovered.stateUpdate.updated, true);
    assert.equal(readJson(fixture.stateFile).revision, INITIAL_REVISION + 1);
    assert.equal(
      readEvents(fixture.eventsFile).filter((event) => event.type === "delivery.sent").length,
      1,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("the same logical delivery-run id is isolated by demand state root", async () => {
  const fixture = makeFixture(1);
  try {
    const independent = addIndependentDelivery(fixture);
    const sharedRun = ["--delivery-run-id", "run-shared-across-state-roots"];
    const results = await Promise.all([
      runAsync(fixture.root, deliveryArgs(fixture.deliveries[0], sharedRun)),
      runAsync(fixture.root, deliveryArgs(independent, sharedRun)),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [0, 0]);

    const states = [readJson(fixture.stateFile), readJson(independent.stateFile)];
    assert.equal(states.filter((state) => state.state === "dispatched").length, 2);
    assert.equal(
      states.reduce((sum, state) => sum + state.revision, 0),
      (INITIAL_REVISION * 2) + 2,
    );
    const runFiles = [
      deliveryRunFile(fixture.root, fixture.deliveries[0], "run-shared-across-state-roots"),
      deliveryRunFile(fixture.root, independent, "run-shared-across-state-roots"),
    ];
    assert.notEqual(runFiles[0], runFiles[1]);
    assert.ok(runFiles.every((file) => existsSync(file)));
    assert.ok(runFiles.every((file) => !existsSync(`${file}.record-lock`)));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("controller-return delivery remains transport-only and needs no state-root lock", () => {
  const fixture = makeFixture(1);
  try {
    const deliveryFile = path.join(
      fixture.root,
      ".wakeflow-local/wakeflow-delivery/delivery-envelopes/controller-return-atomic.json",
    );
    writeJson(deliveryFile, {
      kind: "ControllerReturnEnvelope",
      version: 1,
      deliveryId: "controller-return-atomic",
      controllerWindow: "Controller",
      triggerTarget: "AtomicRepo1",
      triggerTaskId: "ATOMIC-TASK-1",
      reviewScope: {
        mode: "group-ready",
        dispatchGroup: "GROUP-ATOMIC",
      },
      prompt: "Inspect the returned target inputs and validate independently.",
      automation: {
        enabled: false,
        keepLive: false,
      },
      createdAt: "2026-07-30T00:00:00.000Z",
    });
    const recorded = parseOk(run(fixture.root, [
      "record-delivery-run",
      "--delivery-file",
      deliveryFile,
      "--status",
      "sent",
      "--readback-ok",
      "true",
      "--evidence",
      "controller readback confirmed",
      "--write",
    ]));
    assert.equal(recorded.wrote, true);
    assert.equal(recorded.stateUpdate.updated, false);
    assert.equal(recorded.stateUpdate.reason, "not-a-target-delivery");
    assert.equal(readJson(fixture.stateFile).revision, INITIAL_REVISION);
    assert.equal(existsSync(`${fixture.stateRoot}.state-lock`), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("target result must name its dispatch group even when exactly one is known", () => {
  const fixture = makeFixture(1);
  try {
    const delivery = fixture.deliveries[0];
    writeJson(path.join(
      fixture.root,
      ".wakeflow-local/wakeflow-delivery/dispatch-packets/GROUP-ATOMIC__AtomicRepo1__ATOMIC-TASK-1.json",
    ), {
      kind: "ControllerDispatchPacket",
      version: 1,
      id: "GROUP-ATOMIC__AtomicRepo1__ATOMIC-TASK-1",
      targetWindow: delivery.targetWindow,
      taskId: delivery.targetTaskId,
      dispatchGroup: "GROUP-ATOMIC",
    });
    const omitted = run(fixture.root, [
      "record-target-result",
      "--target-window",
      delivery.targetWindow,
      "--task-id",
      delivery.targetTaskId,
      "--status",
      "completed",
      "--evidence-ref",
      "evidence/result.json",
      "--write",
    ]);
    assert.notEqual(omitted.status, 0);
    assert.match(omitted.stdout + omitted.stderr, /--group is required/);

    const explicit = parseOk(run(fixture.root, [
      "record-target-result",
      "--target-window",
      delivery.targetWindow,
      "--task-id",
      delivery.targetTaskId,
      "--group",
      "GROUP-ATOMIC",
      "--status",
      "completed",
      "--evidence-ref",
      "evidence/result.json",
      "--write",
    ]));
    assert.equal(explicit.wrote, true);
    assert.equal(explicit.result.dispatchGroup, "GROUP-ATOMIC");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a delayed sent record cannot resurrect a cancelled demand", () => {
  const fixture = makeFixture(1);
  try {
    const cancelledState = readJson(fixture.stateFile);
    cancelledState.state = "cancelled";
    cancelledState.stateReason = "cancelled before delayed host readback";
    cancelledState.revision += 1;
    writeJson(fixture.stateFile, cancelledState);
    writeFileSync(fixture.eventsFile, `${JSON.stringify({
      eventId: "evt-atomic-cancelled-0012",
      createdAt: "2026-07-30T00:00:01.000Z",
      actor: "fixture",
      type: "demand.cancelled",
      from: "planned",
      to: "cancelled",
      reason: cancelledState.stateReason,
      stateRevision: cancelledState.revision,
    })}\n`, { flag: "a" });

    const delivery = fixture.deliveries[0];
    const recorded = parseOk(run(fixture.root, deliveryArgs(delivery)));
    assert.equal(recorded.wrote, true);
    assert.equal(recorded.stateUpdate.updated, false);
    assert.equal(recorded.stateUpdate.reason, "demand-cancelled");

    const after = readJson(fixture.stateFile);
    assert.equal(after.state, "cancelled");
    assert.equal(after.revision, cancelledState.revision);
    assert.equal(after.targetTasks[0].status, "pending");
    assert.equal(after.targetTasks[0].counts?.dispatchCount, undefined);
    assert.equal(
      readEvents(fixture.eventsFile).filter((event) => event.type === "delivery.sent").length,
      0,
    );

    const replay = parseOk(run(fixture.root, deliveryArgs(delivery)));
    assert.equal(replay.wrote, false);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.stateUpdate.reason, "demand-cancelled");
    assert.equal(readJson(fixture.stateFile).revision, cancelledState.revision);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("P1: an orphan delivery event reserves its revision until its run repairs state", async () => {
  const fixture = makeFixture(2);
  try {
    const [firstDelivery, secondDelivery] = fixture.deliveries;
    const initialState = readJson(fixture.stateFile);

    // Produce the exact event-first crash residue: the immutable run and its
    // delivery.sent event survived, while wakeflow-state.json did not.
    parseOk(run(fixture.root, deliveryArgs(firstDelivery)));
    writeJson(fixture.stateFile, initialState);
    const orphanEvents = readEvents(fixture.eventsFile)
      .filter((event) => event.type === "delivery.sent");
    assert.deepEqual(orphanEvents.map((event) => event.stateRevision), [INITIAL_REVISION + 1]);

    const blockedProjection = runRender(fixture.root, [
      "--state-root",
      fixture.stateRoot,
      "--write",
    ]);
    assert.notEqual(blockedProjection.status, 0);
    const blockedProjectionPayload = JSON.parse(blockedProjection.stdout);
    assert.equal(blockedProjectionPayload.errorCode, "delivery-state-recovery-required");
    assert.equal(blockedProjectionPayload.diagnostics?.retryable, true);
    assert.equal(existsSync(path.join(fixture.stateRoot, "projection.json")), false);

    const blockedStateWriter = runState(fixture.root, [
      "cancel-demand",
      "--state-root",
      fixture.stateRoot,
      "--reason",
      "must not take a revision reserved by the interrupted delivery",
      "--write",
    ]);
    assert.notEqual(blockedStateWriter.status, 0);
    assert.match(blockedStateWriter.stdout + blockedStateWriter.stderr, /reserved.*revision|replay delivery run/i);
    const blockedStatePayload = JSON.parse(blockedStateWriter.stdout);
    assert.equal(blockedStatePayload.errorCode, "delivery-state-recovery-required");
    assert.equal(blockedStatePayload.diagnostics?.retryable, true);
    assert.equal(readJson(fixture.stateFile).revision, INITIAL_REVISION);
    const runtimeFailure = await runWakeflowRuntime({
      script: "wakeflow-state",
      args: [
        "cancel-demand",
        "--root",
        fixture.root,
        "--state-root",
        fixture.stateRoot,
        "--reason",
        "runtime wrapper must preserve recovery semantics",
        "--write",
        "--json",
      ],
      cwd: fixture.root,
    });
    assert.equal(runtimeFailure.wakeflowError?.code, "delivery-state-recovery-required");
    assert.equal(runtimeFailure.wakeflowError?.retryable, true);

    // Minimal safe behavior: a different delivery may preserve its immutable
    // run evidence, but it must fail closed before advancing state or appending
    // another event at the orphan's reserved revision. The structured,
    // retryable error directs the controller to replay the orphan run first.
    const blockedSecond = parseStructuredRetryableFailure(
      run(fixture.root, deliveryArgs(secondDelivery)),
    );
    assert.match(
      blockedSecond.error,
      /event|revision|recover|replay/i,
      "the failure must identify the event/state recovery boundary",
    );
    assert.equal(readJson(fixture.stateFile).revision, INITIAL_REVISION);
    assert.ok(readJson(fixture.stateFile).targetTasks.every((task) => task.status === "pending"));
    assert.deepEqual(
      readEvents(fixture.eventsFile)
        .filter((event) => event.type === "delivery.sent")
        .map((event) => event.stateRevision),
      [INITIAL_REVISION + 1],
    );

    const recoveredFirst = parseOk(run(fixture.root, deliveryArgs(firstDelivery)));
    assert.equal(recoveredFirst.duplicate, true);
    assert.equal(recoveredFirst.stateUpdate.updated, true);
    assert.equal(recoveredFirst.stateUpdate.stateRevision, INITIAL_REVISION + 1);

    // The second command may now replay a run file retained by its failed
    // attempt, or create it if the implementation failed before persistence.
    const recoveredSecond = parseOk(run(fixture.root, deliveryArgs(secondDelivery)));
    assert.equal(recoveredSecond.stateUpdate.updated, true);
    assert.equal(recoveredSecond.stateUpdate.stateRevision, INITIAL_REVISION + 2);

    const finalState = readJson(fixture.stateFile);
    assert.equal(finalState.revision, INITIAL_REVISION + 2);
    assert.ok(finalState.targetTasks.every((task) => task.status === "sent"));
    const finalRevisions = readEvents(fixture.eventsFile)
      .filter((event) => event.type === "delivery.sent")
      .map((event) => event.stateRevision);
    assert.deepEqual(finalRevisions, [INITIAL_REVISION + 1, INITIAL_REVISION + 2]);
    assert.equal(new Set(finalRevisions).size, finalRevisions.length);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("P1: a truncated events tail returns a structured retryable error and replay recovers", async () => {
  const fixture = makeFixture(1);
  try {
    const delivery = fixture.deliveries[0];
    writeFileSync(
      fixture.eventsFile,
      '{"eventId":"truncated-delivery-event"',
    );

    const projectionFailure = runRender(fixture.root, [
      "--state-root",
      fixture.stateRoot,
      "--write",
    ]);
    assert.notEqual(projectionFailure.status, 0);
    const projectionFailurePayload = JSON.parse(projectionFailure.stdout);
    assert.equal(projectionFailurePayload.errorCode, "delivery-event-log-repair-required");
    assert.equal(projectionFailurePayload.diagnostics?.retryable, true);
    assert.equal(existsSync(path.join(fixture.stateRoot, "projection.json")), false);

    const stateFailure = runState(fixture.root, [
      "cancel-demand",
      "--state-root",
      fixture.stateRoot,
      "--reason",
      "must not mutate through a malformed event log",
      "--write",
    ]);
    assert.notEqual(stateFailure.status, 0);
    const stateFailurePayload = JSON.parse(stateFailure.stdout);
    assert.equal(stateFailurePayload.errorCode, "delivery-event-log-repair-required");
    assert.equal(stateFailurePayload.diagnostics?.retryable, true);
    assert.equal(readJson(fixture.stateFile).revision, INITIAL_REVISION);
    const runtimeFailure = await runWakeflowRuntime({
      script: "wakeflow-state",
      args: [
        "cancel-demand",
        "--root",
        fixture.root,
        "--state-root",
        fixture.stateRoot,
        "--reason",
        "runtime wrapper must preserve event-log recovery semantics",
        "--write",
        "--json",
      ],
      cwd: fixture.root,
    });
    assert.equal(runtimeFailure.wakeflowError?.code, "delivery-event-log-repair-required");
    assert.equal(runtimeFailure.wakeflowError?.retryable, true);

    const firstFailure = parseStructuredRetryableFailure(
      run(fixture.root, deliveryArgs(delivery)),
    );
    assert.match(
      firstFailure.error,
      /controller-events|event log|JSON|truncat|malformed/i,
      "the error must name the damaged event-log boundary",
    );
    assert.equal(readJson(fixture.stateFile).revision, INITIAL_REVISION);
    assert.equal(readJson(fixture.stateFile).targetTasks[0].status, "pending");
    const runFile = deliveryRunFile(fixture.root, delivery);
    assert.equal(
      existsSync(runFile),
      true,
      "host-send evidence already persisted before event parsing must survive for replay",
    );

    const replayFailure = parseStructuredRetryableFailure(
      run(fixture.root, deliveryArgs(delivery)),
    );
    assert.match(replayFailure.error, /controller-events|event log|JSON|truncat|malformed/i);
    assert.equal(readJson(fixture.stateFile).revision, INITIAL_REVISION);

    // Explicitly repairing the incomplete tail is the minimum safe operator
    // action. Replaying the SAME immutable run must then complete exactly once.
    writeBaselineEvents(fixture.eventsFile);
    const recovered = parseOk(run(fixture.root, deliveryArgs(delivery)));
    assert.equal(recovered.duplicate, true);
    assert.equal(recovered.stateUpdate.updated, true);
    assert.equal(readJson(fixture.stateFile).revision, INITIAL_REVISION + 1);
    const events = readEvents(fixture.eventsFile)
      .filter((event) => event.type === "delivery.sent");
    assert.equal(events.length, 1);
    assert.equal(events[0].stateRevision, INITIAL_REVISION + 1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
