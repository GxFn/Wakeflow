import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  commitClaudeWindowLocator,
  createClaudeWindowLocatorRecord,
  inspectClaudeWindowLocatorObservation,
  withClaudeWindowOperationMutex,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-locator.mjs";
import {
  executeClaudeControllerReturn,
  executeClaudeTargetDelivery,
  recoverClaudeTransportOperation,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-transport.mjs";
import {
  applyTargetDeliveryPlan,
  claimTargetDelivery,
  planTargetDelivery,
  recordTargetDeliveryOutcome,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-delivery-orchestration.mjs";
import {
  inspectTransportDemandAuthority,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-transport-store.mjs";
import {
  applyControllerReturnDeliveryPlan,
  planControllerReturnDelivery,
  recordTargetResultFromTransport,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-result-review-orchestration.mjs";
import {
  inspectWindowBindingInventory,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-binding-service.mjs";
import {
  inspectWindowCoordinationLeaseInventory,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-lease-service.mjs";
import {
  INTEGRATION_IDS,
  createIntegrationFixture,
  loadIntegrationStack,
  timestampAfter,
} from "./support/wakeflow-delivery-v3-fixture.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeRoot = path.join(repositoryRoot, "plugins/claude-code-wakeflow");
const codexRoot = path.join(repositoryRoot, "plugins/codex-wakeflow");
const moduleFile = path.join(
  claudeRoot,
  "scripts/lib/wakeflow-claude-transport.mjs",
);

const TRANSPORT_EXPORTS = Object.freeze([
  "WAKEFLOW_CLAUDE_TRANSPORT_HOST_ID",
  "WAKEFLOW_CLAUDE_TRANSPORT_SCHEMA_VERSION",
  "WakeflowClaudeTransportError",
  "executeClaudeControllerReturn",
  "executeClaudeTargetDelivery",
  "recoverClaudeTransportOperation",
]);

const PRODUCT_LOCATOR_ID = "locator_41414141-4141-4141-8141-414141414141";

function ensurePrivateDirectory(root, ref) {
  let current = root;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    if (process.platform !== "win32") chmodSync(current, 0o700);
  }
  return current;
}

function bindingTuple(binding) {
  return {
    programId: binding.programId,
    hostId: binding.hostId,
    windowId: binding.windowId,
    bindingId: binding.bindingId,
  };
}

function liveObservation(locator, overrides = {}) {
  return {
    provider: "tmux",
    socketName: locator.tmux.socketName,
    sessionName: locator.tmux.sessionName,
    windowId: locator.tmux.windowId,
    paneId: locator.tmux.paneId,
    paneWindowId: locator.tmux.windowId,
    paneDead: false,
    claudeProcess: true,
    metadata: {
      programId: locator.programId,
      hostId: locator.hostId,
      windowId: locator.windowId,
      bindingId: locator.bindingId,
      locatorId: locator.locatorId,
    },
    ...overrides,
  };
}

async function installLocator(fixture, {
  windowId,
  locatorId,
  tmuxWindowId,
  paneId,
}) {
  ensurePrivateDirectory(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/hosts/claude-code/operations/window-locators",
  );
  const binding = inspectWindowBindingInventory({
    workspaceRoot: fixture.workspaceRoot,
  }).bindings.find((entry) => entry.windowId === windowId);
  const locator = createClaudeWindowLocatorRecord({
    programId: INTEGRATION_IDS.program,
    windowId,
    bindingId: binding.bindingId,
    locatorId,
    tmux: {
      socketName: null,
      sessionName: "wakeflow",
      windowId: tmuxWindowId,
      paneId,
    },
    locatedAt: "2026-08-09T10:00:00.000Z",
  });
  const observation = inspectClaudeWindowLocatorObservation({
    locator,
    binding: bindingTuple(binding),
    expectedSocketName: null,
    observations: [liveObservation(locator)],
  });
  await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: locator.windowId,
    operationKind: "launch",
    expectedBindingId: binding.bindingId,
    expectedLocatorId: null,
  }, (operation) => commitClaudeWindowLocator({
    operation,
    locator,
    observation,
    expectedSocketName: null,
  }));
  return { binding, locator };
}

async function installProductLocator(fixture) {
  return installLocator(fixture, {
    windowId: INTEGRATION_IDS.productWindow,
    locatorId: PRODUCT_LOCATOR_ID,
    tmuxWindowId: "@7",
    paneId: "%11",
  });
}

async function prepareTarget(t, prompt = "Execute the exact Claude transport fixture once.") {
  const fixture = await createIntegrationFixture(t, { hostId: "claude-code" });
  const { binding, locator } = await installProductLocator(fixture);
  const stack = loadIntegrationStack(fixture);
  const plan = planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt,
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(stack.state.updatedAt, new Date().toISOString()),
  });
  const applied = await applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  return {
    fixture,
    binding,
    locator,
    prompt,
    input: {
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      targetTaskId: INTEGRATION_IDS.targetTask,
      deliveryId: applied.members[0].envelope.deliveryId,
      sendGeneration: 1,
    },
  };
}

function buildProductResult(fixture, stack) {
  const targetResultId = "target-result_72727272-7272-4272-8272-727272727272";
  const task = stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.targetTask,
  );
  const evidence = {
    kind: "test-output",
    ref: `evidence/${targetResultId}.txt`,
    digest: `sha256:${"7".repeat(64)}`,
  };
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-target-result",
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt: timestampAfter(stack.state.updatedAt),
    targetResultId,
    targetTaskId: INTEGRATION_IDS.targetTask,
    taskPackage: {
      taskPackageId: fixture.packageRecord.taskPackageId,
      ref: `task-packages/${fixture.packageRecord.taskPackageId}.json`,
      digest: canonicalJsonDigest(fixture.packageRecord),
    },
    assignment: {
      windowId: fixture.packageRecord.windowId,
      repositoryId: fixture.packageRecord.repositoryId,
    },
    observedState: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    transport: {
      group: {
        id: task.currentDelivery.group.groupId,
        ref: task.currentDelivery.group.ref,
        digest: task.currentDelivery.group.digest,
      },
      envelope: {
        id: task.currentDelivery.envelope.deliveryId,
        ref: task.currentDelivery.envelope.ref,
        digest: task.currentDelivery.envelope.digest,
      },
    },
    outcome: "completed",
    summary: "The exact disposable Claude transport task completed.",
    repositoryChanges: [{
      repositoryId: fixture.packageRecord.repositoryId,
      disposition: "left-uncommitted",
      commits: [],
    }],
    evidenceLocators: [evidence],
    verification: ["The disposable Claude transport integration completed."],
    risks: [],
    craftMapping: [{
      kind: "acceptance-anchor",
      anchorId: "A1",
      evidenceRefs: [{ ref: evidence.ref, digest: evidence.digest }],
    }],
  };
}

async function prepareControllerReturn(t) {
  const target = await prepareTarget(
    t,
    "M4-T08 settle one target before the Controller callback.",
  );
  const targetHost = installFakeTmux(t, target);
  const targetExecution = await executeClaudeTargetDelivery(target.input);
  assert.equal(targetExecution.transportStatus, "accepted");
  assert.equal(targetHost.commands().filter((entry) => entry.command === "paste-buffer").length, 1);

  let stack = loadIntegrationStack(target.fixture);
  const result = buildProductResult(target.fixture, stack);
  await recordTargetResultFromTransport({
    workspaceRoot: target.fixture.workspaceRoot,
    stateRoot: target.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    artifact: result,
    transition: {
      eventId: "event-t08-claude-controller-result-0001",
      createdAt: result.createdAt,
      reason: "Import the exact target result before the Claude Controller callback.",
      decisionSummary: "Select the immutable result and release only its target lease.",
    },
  });
  const controller = await installLocator(target.fixture, {
    windowId: INTEGRATION_IDS.controllerWindow,
    locatorId: "locator_75757575-7575-4575-8575-757575757575",
    tmuxWindowId: "@1",
    paneId: "%1",
  });
  stack = loadIntegrationStack(target.fixture);
  const groupId = stack.state.targetTasks[0].currentDelivery.group.groupId;
  const deliveryId = "delivery_73737373-7373-4373-8373-737373737373";
  const runId = "delivery-run_74747474-7474-4474-8474-747474747474";
  const plan = planControllerReturnDelivery({
    workspaceRoot: target.fixture.workspaceRoot,
    stateRoot: target.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId,
    deliveryId,
    createdAt: timestampAfter(stack.state.updatedAt),
  });
  await applyControllerReturnDeliveryPlan({
    workspaceRoot: target.fixture.workspaceRoot,
    stateRoot: target.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  return {
    fixture: target.fixture,
    locator: controller.locator,
    binding: controller.binding,
    plan,
    input: {
      workspaceRoot: target.fixture.workspaceRoot,
      stateRoot: target.fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      deliveryId,
      runId,
    },
  };
}

function fakePane(locator, overrides = {}) {
  return {
    sessionName: locator.tmux.sessionName,
    tmuxWindowId: locator.tmux.windowId,
    paneId: locator.tmux.paneId,
    paneDead: "0",
    paneCurrentCommand: "claude",
    programId: locator.programId,
    hostId: locator.hostId,
    windowId: locator.windowId,
    bindingId: locator.bindingId,
    locatorId: locator.locatorId,
    ...overrides,
  };
}

function installFakeTmux(t, prepared, options = {}) {
  const hostRoot = path.join(path.dirname(prepared.fixture.workspaceRoot), "fake-tmux");
  mkdirSync(hostRoot, { recursive: true, mode: 0o700 });
  const scriptFile = path.join(hostRoot, "tmux-fake.mjs");
  const stateFile = path.join(hostRoot, "state.json");
  const logFile = path.join(hostRoot, "commands.jsonl");
  writeFileSync(logFile, "", { mode: 0o600 });
  const script = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const stateFile = process.env.WAKEFLOW_TMUX_FAKE_STATE;
const logFile = process.env.WAKEFLOW_TMUX_FAKE_LOG;
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const originalArgs = process.argv.slice(2);
const offset = originalArgs[0] === "-L" ? 2 : 0;
const command = originalArgs[offset];
const args = originalArgs.slice(offset + 1);
let phase = null;
try {
  const wakeflowState = JSON.parse(readFileSync(process.env.WAKEFLOW_TMUX_FAKE_WAKEFLOW_STATE, "utf8"));
  phase = wakeflowState.targetTasks?.[0]?.currentDelivery?.phase ?? null;
} catch {}
const log = {
  command,
  args,
  phase,
  inheritedTmux: process.env.TMUX ?? null,
  inheritedTmuxPane: process.env.TMUX_PANE ?? null,
  operationLockPresent: existsSync(process.env.WAKEFLOW_TMUX_FAKE_OPERATION_LOCK),
};
if (state.mutateConfigAt === command && !state.configMutated) {
  const config = JSON.parse(readFileSync(process.env.WAKEFLOW_TMUX_FAKE_CONFIG, "utf8"));
  config.program.displayName = config.program.displayName + " drift";
  writeFileSync(process.env.WAKEFLOW_TMUX_FAKE_CONFIG, JSON.stringify(config, null, 2) + "\\n");
  state.configMutated = true;
  writeFileSync(stateFile, JSON.stringify(state));
}
if (state.failAt === command) {
  appendFileSync(logFile, JSON.stringify(log) + "\\n");
  process.exit(17);
}
if (command === "list-panes") {
  for (const pane of state.panes ?? []) {
    process.stdout.write([
      pane.sessionName,
      pane.tmuxWindowId,
      pane.paneId,
      pane.paneDead,
      pane.paneCurrentCommand,
      pane.programId,
      pane.hostId,
      pane.windowId,
      pane.bindingId,
      pane.locatorId,
    ].join("\\t") + "\\n");
  }
} else if (command === "load-buffer") {
  state.lastPrompt = readFileSync(0, "utf8");
  log.stdinLength = state.lastPrompt.length;
  writeFileSync(stateFile, JSON.stringify(state));
} else if (command === "capture-pane") {
  if (state.captureMode === "unavailable") {
    appendFileSync(logFile, JSON.stringify(log) + "\\n");
    process.exit(18);
  }
  process.stdout.write(state.captureMode === "echo" ? (state.lastPrompt ?? "") : "stable pane output\\n");
}
appendFileSync(logFile, JSON.stringify(log) + "\\n");
`;
  writeFileSync(scriptFile, script, { mode: 0o700 });
  if (process.platform !== "win32") chmodSync(scriptFile, 0o700);
  const state = {
    panes: options.panes ?? [
      {
        sessionName: "personal",
        tmuxWindowId: "@99",
        paneId: "%99",
        paneDead: "0",
        paneCurrentCommand: "zsh",
        programId: "",
        hostId: "",
        windowId: "",
        bindingId: "",
        locatorId: "",
      },
      fakePane(prepared.locator),
    ],
    captureMode: options.captureMode ?? "echo",
    ...(options.mutateConfigAt ? { mutateConfigAt: options.mutateConfigAt } : {}),
    ...(options.failAt ? { failAt: options.failAt } : {}),
  };
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  const previous = {
    bin: process.env.WAKEFLOW_TMUX_BIN,
    state: process.env.WAKEFLOW_TMUX_FAKE_STATE,
    log: process.env.WAKEFLOW_TMUX_FAKE_LOG,
    wakeflowState: process.env.WAKEFLOW_TMUX_FAKE_WAKEFLOW_STATE,
    config: process.env.WAKEFLOW_TMUX_FAKE_CONFIG,
    operationLock: process.env.WAKEFLOW_TMUX_FAKE_OPERATION_LOCK,
  };
  process.env.WAKEFLOW_TMUX_BIN = scriptFile;
  process.env.WAKEFLOW_TMUX_FAKE_STATE = stateFile;
  process.env.WAKEFLOW_TMUX_FAKE_LOG = logFile;
  process.env.WAKEFLOW_TMUX_FAKE_WAKEFLOW_STATE = path.join(
    prepared.fixture.stateRoot,
    "wakeflow-state.json",
  );
  process.env.WAKEFLOW_TMUX_FAKE_CONFIG = path.join(
    prepared.fixture.workspaceRoot,
    "wakeflow.config.json",
  );
  process.env.WAKEFLOW_TMUX_FAKE_OPERATION_LOCK = path.join(
    prepared.fixture.workspaceRoot,
    ".wakeflow-local/runtime/hosts/claude-code/operations/window-locators",
    `${prepared.locator.windowId}.lock`,
  );
  t.after(() => {
    for (const [key, value] of Object.entries({
      WAKEFLOW_TMUX_BIN: previous.bin,
      WAKEFLOW_TMUX_FAKE_STATE: previous.state,
      WAKEFLOW_TMUX_FAKE_LOG: previous.log,
      WAKEFLOW_TMUX_FAKE_WAKEFLOW_STATE: previous.wakeflowState,
      WAKEFLOW_TMUX_FAKE_CONFIG: previous.config,
      WAKEFLOW_TMUX_FAKE_OPERATION_LOCK: previous.operationLock,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return {
    logFile,
    commands() {
      if (!existsSync(logFile)) return [];
      return readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    },
  };
}

test("M4-T08 exposes one Claude-only transport owner and issued locator endpoint seam", async () => {
  await access(moduleFile);
  const transport = await import(pathToFileURL(moduleFile).href);
  assert.deepEqual(Object.keys(transport).sort(), [...TRANSPORT_EXPORTS].sort());
  assert.equal(transport.WAKEFLOW_CLAUDE_TRANSPORT_HOST_ID, "claude-code");
  assert.equal(transport.WAKEFLOW_CLAUDE_TRANSPORT_SCHEMA_VERSION, 1);

  const locator = await import(
    pathToFileURL(path.join(
      claudeRoot,
      "scripts/lib/wakeflow-claude-locator.mjs",
    )).href
  );
  assert.equal(typeof locator.resolveClaudeWindowOperationEndpoint, "function");

  await assert.rejects(
    access(path.join(codexRoot, "scripts/lib/wakeflow-claude-transport.mjs")),
    { code: "ENOENT" },
  );
});

test("M4-T08 target send holds the operation mutex through claim, exact pane paste, one readback, and M3 settlement", async (t) => {
  const prompt = "M4-T08 unique target prompt marker 81818181; execute exactly once.";
  const prepared = await prepareTarget(t, prompt);
  const fake = installFakeTmux(t, prepared);
  const previousTmux = process.env.TMUX;
  const previousTmuxPane = process.env.TMUX_PANE;
  process.env.TMUX = "/tmp/unrelated-client,123,0";
  process.env.TMUX_PANE = "%999";
  t.after(() => {
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
    if (previousTmuxPane === undefined) delete process.env.TMUX_PANE;
    else process.env.TMUX_PANE = previousTmuxPane;
  });

  const result = await executeClaudeTargetDelivery(prepared.input);
  assert.equal(result.kind, "WakeflowClaudeTargetDeliveryExecution");
  assert.equal(result.status, "recorded");
  assert.equal(result.transportStatus, "accepted");
  assert.equal(result.readbackStatus, "confirmed");
  assert.equal(result.leaseStatus, "retained");
  assert.match(result.operationSubjectDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(result).includes(prompt), false);
  assert.equal(JSON.stringify(result).includes("@7"), false);
  assert.equal(JSON.stringify(result).includes("%11"), false);
  assert.equal(JSON.stringify(result).includes(INTEGRATION_IDS.handle), false);

  const stack = loadIntegrationStack(prepared.fixture);
  const delivery = stack.state.targetTasks[0].currentDelivery;
  assert.equal(delivery.phase, "accepted");
  assert.equal(delivery.sendGeneration, 1);
  assert.equal(stack.events.at(-1).command, "record-target-delivery-run");
  const leases = inspectWindowCoordinationLeaseInventory({
    workspaceRoot: prepared.fixture.workspaceRoot,
  });
  assert.equal(leases.leases.length, 1);
  assert.equal(leases.leases[0].lease.deliveryId, prepared.input.deliveryId);

  const transport = inspectTransportDemandAuthority({
    workspaceRoot: prepared.fixture.workspaceRoot,
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
  });
  const run = transport.entries.runs.find(
    (entry) => entry.record.deliveryId === prepared.input.deliveryId,
  ).record;
  assert.equal(run.transportStatus, "accepted");
  assert.deepEqual(run.readback, {
    status: "confirmed",
    attempts: 1,
    evidence: [{
      kind: "tmux-pane-observation",
      digest: run.readback.evidence[0].digest,
    }],
  });
  assert.match(run.readback.evidence[0].digest, /^sha256:[0-9a-f]{64}$/u);
  const durableRun = JSON.stringify(run);
  assert.equal(durableRun.includes(prompt), false);
  assert.equal(durableRun.includes("stable pane output"), false);
  assert.equal(durableRun.includes("@7"), false);
  assert.equal(durableRun.includes("%11"), false);

  const commands = fake.commands();
  assert.deepEqual(commands.map((entry) => entry.command), [
    "list-panes",
    "load-buffer",
    "paste-buffer",
    "send-keys",
    "capture-pane",
  ]);
  assert.equal(commands[0].phase, "send-claimed");
  assert.equal(commands.every((entry) => entry.operationLockPresent), true);
  assert.equal(commands.every((entry) => entry.inheritedTmux === null), true);
  assert.equal(commands.every((entry) => entry.inheritedTmuxPane === null), true);
  assert.equal(commands.filter((entry) => entry.command === "capture-pane").length, 1);
  assert.equal(commands.find((entry) => entry.command === "paste-buffer").args.at(-1), "%11");
  const bufferName = commands.find((entry) => entry.command === "load-buffer").args[1];
  assert.match(bufferName, /^wakeflow-claude-operation_[0-9a-f-]+$/u);
  assert.equal(
    commands.find((entry) => entry.command === "paste-buffer").args[2],
    bufferName,
  );
  assert.equal(commands.some((entry) => JSON.stringify(entry.args).includes(prompt)), false);
  assert.equal(
    existsSync(path.join(
      prepared.fixture.workspaceRoot,
      ".wakeflow-local/runtime/hosts/claude-code/operations/window-locators",
      `${prepared.locator.windowId}.lock`,
    )),
    false,
  );

  const commandCount = commands.length;
  const replay = await executeClaudeTargetDelivery(prepared.input);
  assert.equal(replay.status, "already-settled");
  assert.equal(replay.transportStatus, "accepted");
  assert.equal(fake.commands().length, commandCount);
});

test("M4-T08 missing live metadata rejects before paste and lets only M3 release the exact lease", async (t) => {
  const prepared = await prepareTarget(t);
  const fake = installFakeTmux(t, prepared, { panes: [] });

  const result = await executeClaudeTargetDelivery(prepared.input);
  assert.equal(result.transportStatus, "rejected-before-send");
  assert.equal(result.readbackStatus, "unavailable");
  assert.equal(result.leaseStatus, "released");
  assert.equal(loadIntegrationStack(prepared.fixture).state.targetTasks[0].currentDelivery.phase, "rejected-before-send");
  assert.equal(
    inspectWindowCoordinationLeaseInventory({
      workspaceRoot: prepared.fixture.workspaceRoot,
    }).leases.length,
    0,
  );
  assert.deepEqual(fake.commands().map((entry) => entry.command), ["list-panes"]);
  const transport = inspectTransportDemandAuthority({
    workspaceRoot: prepared.fixture.workspaceRoot,
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
  });
  const run = transport.entries.runs.at(-1).record;
  assert.equal(run.transportStatus, "rejected-before-send");
  assert.deepEqual(run.readback, { status: "unavailable", attempts: 0, evidence: [] });
  assert.equal(run.error.code, "claude-send-rejected");
});

test("M4-T08 paste uncertainty records ambiguous once, retains the lease, and never resends", async (t) => {
  const prepared = await prepareTarget(t);
  const fake = installFakeTmux(t, prepared, { failAt: "paste-buffer" });

  const result = await executeClaudeTargetDelivery(prepared.input);
  assert.equal(result.transportStatus, "ambiguous");
  assert.equal(result.readbackStatus, "unavailable");
  assert.equal(result.leaseStatus, "retained");
  assert.equal(loadIntegrationStack(prepared.fixture).state.targetTasks[0].currentDelivery.phase, "ambiguous");
  assert.equal(
    inspectWindowCoordinationLeaseInventory({
      workspaceRoot: prepared.fixture.workspaceRoot,
    }).leases.length,
    1,
  );
  const firstCommands = fake.commands();
  assert.deepEqual(firstCommands.map((entry) => entry.command), [
    "list-panes",
    "load-buffer",
    "paste-buffer",
    "delete-buffer",
  ]);
  assert.equal(firstCommands.some((entry) => entry.command === "capture-pane"), false);
  const replay = await executeClaudeTargetDelivery(prepared.input);
  assert.equal(replay.status, "already-settled");
  assert.equal(replay.transportStatus, "ambiguous");
  assert.deepEqual(fake.commands(), firstCommands);
});

test("M4-T08 distinguishes load rejection from Enter uncertainty at the exact paste boundary", async (t) => {
  for (const scenario of [
    {
      label: "load-buffer",
      expectedTransportStatus: "rejected-before-send",
      expectedLeaseStatus: "released",
      expectedCommands: ["list-panes", "load-buffer", "delete-buffer"],
    },
    {
      label: "send-keys",
      expectedTransportStatus: "ambiguous",
      expectedLeaseStatus: "retained",
      expectedCommands: ["list-panes", "load-buffer", "paste-buffer", "send-keys"],
    },
  ]) {
    await t.test(scenario.label, async (subtest) => {
      const prepared = await prepareTarget(
        subtest,
        `M4-T08 ${scenario.label} effect-boundary fixture.`,
      );
      const fake = installFakeTmux(subtest, prepared, { failAt: scenario.label });
      const result = await executeClaudeTargetDelivery(prepared.input);
      assert.equal(result.transportStatus, scenario.expectedTransportStatus);
      assert.equal(result.leaseStatus, scenario.expectedLeaseStatus);
      assert.deepEqual(
        fake.commands().map((entry) => entry.command),
        scenario.expectedCommands,
      );
      assert.equal(
        fake.commands().some((entry) => entry.command === "capture-pane"),
        false,
      );
    });
  }
});

test("M4-T08 rejects dead, wrong-process, or duplicate matching pane authority before paste", async (t) => {
  for (const scenario of [
    {
      label: "dead-pane",
      panes(prepared) { return [fakePane(prepared.locator, { paneDead: "1" })]; },
    },
    {
      label: "wrong-process",
      panes(prepared) { return [fakePane(prepared.locator, { paneCurrentCommand: "zsh" })]; },
    },
    {
      label: "duplicate-metadata",
      panes(prepared) {
        return [
          fakePane(prepared.locator),
          fakePane(prepared.locator, { tmuxWindowId: "@8", paneId: "%12" }),
        ];
      },
    },
    {
      label: "coordinate-reuse",
      panes(prepared) {
        return [
          fakePane(prepared.locator),
          fakePane(prepared.locator, { bindingId: INTEGRATION_IDS.bindingTwo }),
        ];
      },
    },
  ]) {
    await t.test(scenario.label, async (subtest) => {
      const prepared = await prepareTarget(
        subtest,
        `M4-T08 ${scenario.label} endpoint-authority fixture.`,
      );
      const fake = installFakeTmux(subtest, prepared, {
        panes: scenario.panes(prepared),
      });
      const result = await executeClaudeTargetDelivery(prepared.input);
      assert.equal(result.transportStatus, "rejected-before-send");
      assert.equal(result.leaseStatus, "released");
      assert.deepEqual(fake.commands().map((entry) => entry.command), ["list-panes"]);
    });
  }
});

test("M4-T08 preserves one digest-only pending or unavailable readback without polling", async (t) => {
  for (const [captureMode, expectedStatus] of [
    ["pending", "pending"],
    ["unavailable", "unavailable"],
  ]) {
    await t.test(captureMode, async (subtest) => {
      const prepared = await prepareTarget(subtest, `M4-T08 ${captureMode} readback fixture marker.`);
      const fake = installFakeTmux(subtest, prepared, { captureMode });
      const result = await executeClaudeTargetDelivery(prepared.input);
      assert.equal(result.transportStatus, "accepted");
      assert.equal(result.readbackStatus, expectedStatus);
      const transport = inspectTransportDemandAuthority({
        workspaceRoot: prepared.fixture.workspaceRoot,
        programId: INTEGRATION_IDS.program,
        demandId: INTEGRATION_IDS.demand,
      });
      const run = transport.entries.runs.at(-1).record;
      assert.equal(run.readback.status, expectedStatus);
      assert.equal(run.readback.attempts, 1);
      assert.equal(run.readback.evidence.length, 1);
      assert.equal(fake.commands().filter((entry) => entry.command === "capture-pane").length, 1);
    });
  }
});

test("M4-T08 rejects config drift observed after pane resolution before paste", async (t) => {
  const prepared = await prepareTarget(t, "M4-T08 config-drift transport fixture.");
  const fake = installFakeTmux(t, prepared, { mutateConfigAt: "list-panes" });

  const result = await executeClaudeTargetDelivery(prepared.input);
  assert.equal(result.transportStatus, "rejected-before-send");
  assert.equal(result.leaseStatus, "released");
  assert.deepEqual(fake.commands().map((entry) => entry.command), ["list-panes"]);
});

test("M4-T08 Controller return uses the same physical fence while writing no target lease or business state", async (t) => {
  const prepared = await prepareControllerReturn(t);
  const fake = installFakeTmux(t, prepared);
  const before = loadIntegrationStack(prepared.fixture);
  const beforeLeases = inspectWindowCoordinationLeaseInventory({
    workspaceRoot: prepared.fixture.workspaceRoot,
  });
  const beforeTransport = inspectTransportDemandAuthority({
    workspaceRoot: prepared.fixture.workspaceRoot,
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
  });

  const result = await executeClaudeControllerReturn(prepared.input);
  assert.equal(result.kind, "WakeflowClaudeControllerReturnExecution");
  assert.equal(result.status, "recorded");
  assert.equal(result.transportStatus, "accepted");
  assert.equal(result.readbackStatus, "confirmed");
  assert.equal(JSON.stringify(result).includes(prepared.plan.envelope.prompt), false);
  assert.equal(JSON.stringify(result).includes("@1"), false);
  assert.equal(JSON.stringify(result).includes("%1"), false);
  assert.equal(JSON.stringify(result).includes(INTEGRATION_IDS.controllerHandle), false);

  assert.deepEqual(loadIntegrationStack(prepared.fixture).state, before.state);
  assert.deepEqual(loadIntegrationStack(prepared.fixture).events, before.events);
  assert.equal(
    inspectWindowCoordinationLeaseInventory({
      workspaceRoot: prepared.fixture.workspaceRoot,
    }).inventoryDigest,
    beforeLeases.inventoryDigest,
  );
  const afterTransport = inspectTransportDemandAuthority({
    workspaceRoot: prepared.fixture.workspaceRoot,
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
  });
  assert.equal(afterTransport.entries.runs.length, beforeTransport.entries.runs.length + 1);
  const run = afterTransport.entries.runs.find(
    (entry) => entry.record.runId === prepared.input.runId,
  ).record;
  assert.equal(Object.hasOwn(run, "observedLease"), false);
  assert.equal(run.readback.status, "confirmed");
  assert.equal(JSON.stringify(run).includes(prepared.plan.envelope.prompt), false);

  const commands = fake.commands();
  assert.deepEqual(commands.map((entry) => entry.command), [
    "list-panes",
    "load-buffer",
    "paste-buffer",
    "send-keys",
    "capture-pane",
  ]);
  assert.equal(commands.every((entry) => entry.operationLockPresent), true);
  const replay = await executeClaudeControllerReturn(prepared.input);
  assert.equal(replay.status, "already-sent");
  assert.deepEqual(fake.commands(), commands);
});

test("M4-T08 rejects a Controller run ID already bound to another delivery before host effects", async (t) => {
  const prepared = await prepareControllerReturn(t);
  const inventory = inspectTransportDemandAuthority({
    workspaceRoot: prepared.fixture.workspaceRoot,
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
  });
  const conflictingRunId = inventory.entries.runs.find(
    (entry) => entry.record.deliveryId !== prepared.input.deliveryId,
  ).record.runId;
  const fake = installFakeTmux(t, prepared);

  await assert.rejects(
    executeClaudeControllerReturn({ ...prepared.input, runId: conflictingRunId }),
    (error) => error?.code === "wakeflow-claude-transport-authority",
  );
  assert.deepEqual(fake.commands(), []);
});

test("M4-T08 rejected Controller return records explicit rearm authority without state or lease mutation", async (t) => {
  const prepared = await prepareControllerReturn(t);
  const fake = installFakeTmux(t, prepared, { panes: [] });
  const before = loadIntegrationStack(prepared.fixture);
  const beforeLeases = inspectWindowCoordinationLeaseInventory({
    workspaceRoot: prepared.fixture.workspaceRoot,
  });

  const result = await executeClaudeControllerReturn(prepared.input);
  assert.equal(result.transportStatus, "rejected-before-send");
  assert.equal(result.readbackStatus, "unavailable");
  assert.deepEqual(fake.commands().map((entry) => entry.command), ["list-panes"]);
  assert.deepEqual(loadIntegrationStack(prepared.fixture).state, before.state);
  assert.deepEqual(loadIntegrationStack(prepared.fixture).events, before.events);
  assert.equal(
    inspectWindowCoordinationLeaseInventory({
      workspaceRoot: prepared.fixture.workspaceRoot,
    }).inventoryDigest,
    beforeLeases.inventoryDigest,
  );
  const replay = await executeClaudeControllerReturn(prepared.input);
  assert.equal(replay.status, "explicit-rearm-required");
  assert.deepEqual(fake.commands().map((entry) => entry.command), ["list-panes"]);
});

test("M4-T08 rejects relative roots and recovery accessors before filesystem or host effects", async (t) => {
  const prepared = await prepareTarget(t, "M4-T08 passive transport input fixture.");
  await assert.rejects(
    executeClaudeTargetDelivery({ ...prepared.input, workspaceRoot: "." }),
    (error) => error?.code === "wakeflow-claude-transport-contract",
  );

  let kindReads = 0;
  const subject = {
    targetTaskId: prepared.input.targetTaskId,
    deliveryId: prepared.input.deliveryId,
    sendGeneration: prepared.input.sendGeneration,
  };
  Object.defineProperty(subject, "kind", {
    enumerable: true,
    get() {
      kindReads += 1;
      return "target";
    },
  });
  await assert.rejects(
    recoverClaudeTransportOperation({
      workspaceRoot: prepared.fixture.workspaceRoot,
      stateRoot: prepared.fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      windowId: prepared.locator.windowId,
      operationId: "claude-operation_81818181-8181-4181-8181-818181818181",
      subject,
    }),
    (error) => error?.code === "wakeflow-claude-transport-contract",
  );
  assert.equal(kindReads, 0);
});

test("M4-T08 automatically releases an unclaimed operation after exact claim rejection", async (t) => {
  const prepared = await prepareTarget(t, "M4-T08 automatic safe-release fixture.");
  const lease = inspectWindowCoordinationLeaseInventory({
    workspaceRoot: prepared.fixture.workspaceRoot,
  }).leases[0];
  unlinkSync(path.join(prepared.fixture.workspaceRoot, lease.leaseRef));

  await assert.rejects(
    executeClaudeTargetDelivery(prepared.input),
    (error) => error?.code === "wakeflow-claude-transport",
  );
  assert.equal(
    existsSync(path.join(
      prepared.fixture.workspaceRoot,
      ".wakeflow-local/runtime/hosts/claude-code/operations/window-locators",
      `${prepared.locator.windowId}.lock`,
    )),
    false,
  );
  assert.equal(
    loadIntegrationStack(prepared.fixture).events.some(
      (event) => event.command === "claim-target-delivery-send",
    ),
    false,
  );
});

test("M4-T08 recovery releases exact unclaimed or settled subjects and retains a claimed send without a run", async (t) => {
  const unclaimed = await prepareTarget(t, "M4-T08 unclaimed recovery subject.");
  const unclaimedSubject = {
    kind: "target",
    targetTaskId: unclaimed.input.targetTaskId,
    deliveryId: unclaimed.input.deliveryId,
    sendGeneration: unclaimed.input.sendGeneration,
  };
  const unclaimedDigest = canonicalJsonDigest({
    schemaVersion: 1,
    hostId: "claude-code",
    programId: INTEGRATION_IDS.program,
    subject: unclaimedSubject,
  });
  let unclaimedOperationId;
  await assert.rejects(
    withClaudeWindowOperationMutex({
      workspaceRoot: unclaimed.fixture.workspaceRoot,
      windowId: unclaimed.locator.windowId,
      operationKind: "send",
      operationSubjectDigest: unclaimedDigest,
      expectedBindingId: unclaimed.binding.bindingId,
      expectedLocatorId: unclaimed.locator.locatorId,
    }, (operation) => {
      unclaimedOperationId = operation.operationId;
      throw new Error("retain the exact unclaimed operation for recovery");
    }),
    /retained|recovery/iu,
  );
  await assert.rejects(
    recoverClaudeTransportOperation({
      workspaceRoot: unclaimed.fixture.workspaceRoot,
      stateRoot: unclaimed.fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      windowId: unclaimed.locator.windowId,
      operationId: unclaimedOperationId,
      subject: { ...unclaimedSubject, deliveryId: "delivery_91919191-9191-4191-8191-919191919191" },
    }),
    /subject|recovery/iu,
  );
  const released = await recoverClaudeTransportOperation({
    workspaceRoot: unclaimed.fixture.workspaceRoot,
    stateRoot: unclaimed.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    windowId: unclaimed.locator.windowId,
    operationId: unclaimedOperationId,
    subject: unclaimedSubject,
  });
  assert.equal(released.status, "released");

  const claimed = await prepareTarget(t, "M4-T08 claimed recovery subject.");
  const claimedSubject = {
    kind: "target",
    targetTaskId: claimed.input.targetTaskId,
    deliveryId: claimed.input.deliveryId,
    sendGeneration: claimed.input.sendGeneration,
  };
  const claimedDigest = canonicalJsonDigest({
    schemaVersion: 1,
    hostId: "claude-code",
    programId: INTEGRATION_IDS.program,
    subject: claimedSubject,
  });
  let claimedOperationId;
  await assert.rejects(
    withClaudeWindowOperationMutex({
      workspaceRoot: claimed.fixture.workspaceRoot,
      windowId: claimed.locator.windowId,
      operationKind: "send",
      operationSubjectDigest: claimedDigest,
      expectedBindingId: claimed.binding.bindingId,
      expectedLocatorId: claimed.locator.locatorId,
    }, async (operation) => {
      claimedOperationId = operation.operationId;
      await claimTargetDelivery(claimed.input);
      throw new Error("retain the exact claimed operation without a run");
    }),
    /retained|recovery/iu,
  );
  const retained = await recoverClaudeTransportOperation({
    workspaceRoot: claimed.fixture.workspaceRoot,
    stateRoot: claimed.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    windowId: claimed.locator.windowId,
    operationId: claimedOperationId,
    subject: claimedSubject,
  });
  assert.equal(retained.status, "retained-for-recovery");

  const settled = await prepareTarget(t, "M4-T08 settled recovery subject.");
  const settledSubject = {
    kind: "target",
    targetTaskId: settled.input.targetTaskId,
    deliveryId: settled.input.deliveryId,
    sendGeneration: settled.input.sendGeneration,
  };
  const settledDigest = canonicalJsonDigest({
    schemaVersion: 1,
    hostId: "claude-code",
    programId: INTEGRATION_IDS.program,
    subject: settledSubject,
  });
  let settledOperationId;
  let settledFailure;
  try {
    await withClaudeWindowOperationMutex({
      workspaceRoot: settled.fixture.workspaceRoot,
      windowId: settled.locator.windowId,
      operationKind: "send",
      operationSubjectDigest: settledDigest,
      expectedBindingId: settled.binding.bindingId,
      expectedLocatorId: settled.locator.locatorId,
    }, async (operation) => {
      settledOperationId = operation.operationId;
      await claimTargetDelivery(settled.input);
      const settledStack = loadIntegrationStack(settled.fixture);
      await recordTargetDeliveryOutcome({
        ...settled.input,
        outcome: {
          hostMethod: "tmux-paste",
          hostMode: "direct-thread",
          transportStatus: "accepted",
          readback: {
            status: "pending",
            attempts: 1,
            evidence: [{
              kind: "tmux-pane-observation",
              digest: canonicalJsonDigest({ fixture: "settled retained operation" }),
            }],
          },
          createdAt: timestampAfter(settledStack.state.updatedAt, new Date().toISOString()),
        },
      });
      throw new Error("retain the settled operation after its exact run and event commit");
    });
  } catch (error) {
    settledFailure = error;
  }
  assert.match(settledFailure?.message ?? "", /retained|recovery/iu);
  assert.equal(
    settledFailure?.cause?.message,
    "retain the settled operation after its exact run and event commit",
  );
  const settledStack = loadIntegrationStack(settled.fixture);
  const settledTransport = inspectTransportDemandAuthority({
    workspaceRoot: settled.fixture.workspaceRoot,
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
  });
  const settledRun = settledTransport.entries.runs.find((entry) => (
    entry.record.deliveryId === settledSubject.deliveryId
    && entry.record.attemptOrdinal === settledSubject.sendGeneration
  ));
  const settledEvent = settledStack.events.find((event) => (
    event.command === "record-target-delivery-run"
    && event.deliveryTransition?.deliveryId === settledSubject.deliveryId
  ));
  assert.ok(settledRun);
  assert.ok(settledEvent);
  assert.equal(settledEvent.deliveryTransition.run.runId, settledRun.record.runId);
  assert.equal(settledEvent.deliveryTransition.run.digest, settledRun.digest);
  const settledRecovery = await recoverClaudeTransportOperation({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    windowId: settled.locator.windowId,
    operationId: settledOperationId,
    subject: settledSubject,
  });
  assert.equal(settledRecovery.status, "released");
});
