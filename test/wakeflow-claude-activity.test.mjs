import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { canonicalJson, canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import { parseWakeflowConfigV3 } from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import { inspectWakeflowLocalLayout } from "../core/scripts/lib/wakeflow-local-layout-inspection.mjs";
import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  deriveClaudeActivityServerContext,
  ensureClaudeActivityMonitor,
  inspectClaudeActivity,
  inspectClaudeActivityForLayout,
  inspectClaudePromptTemp,
  runClaudeActivityMonitorCycle,
  stopClaudeActivityMonitor,
  sweepClaudePromptTemp,
  withClaudePromptTransfer,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-activity.mjs";
import {
  commitClaudeWindowLocator,
  createClaudeWindowLocatorRecord,
  inspectClaudeWindowLocatorObservation,
  withClaudeWindowOperationMutex,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-locator.mjs";
import { loadWakeflowConfigV3Snapshot } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-config-v3-snapshot.mjs";
import { registerWindowBinding } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-binding-service.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeRoot = path.join(repositoryRoot, "plugins/claude-code-wakeflow");
const codexRoot = path.join(repositoryRoot, "plugins/codex-wakeflow");
const moduleRef = "scripts/lib/wakeflow-claude-activity.mjs";
const processSchemaRef = "schemas/wakeflow-claude-host/activity-monitor-process.schema.json";
const managerLockSchemaRef = "schemas/wakeflow-claude-host/activity-monitor-manager-lock.schema.json";
const configFixtureFile = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);
const PROGRAM_ID = "program_11111111-1111-4111-8111-111111111111";
const CONTROLLER_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";
const CLAUDE_HANDLE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LOCATOR_ID = "locator_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROMPT_ROOT_REF = ".wakeflow-local/runtime/hosts/claude-code/operations/temp/prompts";
const ACTIVITY_ROOT_REF = ".wakeflow-local/runtime/hosts/claude-code/operations/activity-monitor";

const ACTIVITY_EXPORTS = Object.freeze([
  "WAKEFLOW_CLAUDE_ACTIVITY_HOST_ID",
  "WAKEFLOW_CLAUDE_ACTIVITY_MANAGER_LOCK_KIND",
  "WAKEFLOW_CLAUDE_ACTIVITY_PROCESS_KIND",
  "WAKEFLOW_CLAUDE_ACTIVITY_SCHEMA_VERSION",
  "WakeflowClaudeActivityError",
  "deriveClaudeActivityServerContext",
  "ensureClaudeActivityMonitor",
  "inspectClaudeActivity",
  "inspectClaudeActivityForLayout",
  "inspectClaudePromptTemp",
  "runClaudeActivityMonitorCycle",
  "stopClaudeActivityMonitor",
  "sweepClaudePromptTemp",
  "withClaudePromptTransfer",
]);

const fakeTmuxSource = `#!/usr/bin/env node
import fs from "node:fs";

const stateFile = process.env.WAKEFLOW_TMUX_ACTIVITY_STATE;
if (
  process.env.WAKEFLOW_TMUX_ACTIVITY_REJECT_AMBIENT === "1"
  && (process.env.TMUX !== undefined || process.env.TMUX_PANE !== undefined)
) {
  process.exit(97);
}
const args = process.argv.slice(2);
if (args[0] === "-L") args.splice(0, 2);
const action = args[0];
const readState = () => JSON.parse(fs.readFileSync(stateFile, "utf8"));
const writeState = (state) => {
  const stage = stateFile + ".stage-" + process.pid;
  fs.writeFileSync(stage, JSON.stringify(state));
  fs.renameSync(stage, stateFile);
};
const state = readState();
if (action === "display-message") {
  if (args.at(-1) === "#{window_id}") process.stdout.write(args[args.indexOf("-t") + 1] + "\\n");
  else process.stdout.write(state.socketPath + "\\t" + state.sessionName + "\\n");
} else if (action === "has-session") {
  process.exitCode = state.alive ? 0 : 1;
} else if (action === "list-panes") {
  state.listPanesCount = (state.listPanesCount ?? 0) + 1;
  writeState(state);
  const rows = state.panes.map((pane) => [
    state.sessionName,
    pane.tmuxWindowId,
    pane.paneId,
    pane.paneDead ? "1" : "0",
    pane.paneCurrentCommand,
    pane.programId,
    pane.hostId,
    pane.windowId,
    pane.bindingId,
    pane.locatorId,
  ].join("\\t"));
  if (rows.length > 0) process.stdout.write(rows.join("\\n") + "\\n");
} else if (action === "capture-pane") {
  const pane = state.panes.find((entry) => entry.paneId === args.at(-1));
  if (!pane) process.exitCode = 1;
  else process.stdout.write(pane.text);
} else if (action === "show-options") {
  const windowId = args[args.indexOf("-t") + 1];
  const option = args.at(-1);
  const value = state.options[windowId]?.[option];
  if (typeof value !== "string") process.exitCode = 1;
  else process.stdout.write(value + "\\n");
} else if (action === "set-option") {
  const windowId = args[args.indexOf("-t") + 1];
  state.options[windowId] ??= {};
  if (args.includes("-u")) delete state.options[windowId][args.at(-1)];
  else state.options[windowId][args.at(-2)] = args.at(-1);
  writeState(state);
} else {
  process.exitCode = 2;
}
`;

function ensurePrivateDirectory(root, ref) {
  let current = root;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    if (process.platform !== "win32") chmodSync(current, 0o700);
  }
  return current;
}

function writeJson(file, value, mode = 0o600) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
  if (process.platform !== "win32") chmodSync(file, mode);
}

function createFixture(t) {
  const base = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-activity-")));
  const workspaceRoot = path.join(base, "Program");
  const productRoot = path.join(base, "ProductA");
  const designRoot = path.join(workspaceRoot, "Design");
  const testRoot = path.join(workspaceRoot, "Test");
  for (const root of [workspaceRoot, productRoot, designRoot, testRoot]) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(root, 0o700);
  }
  const config = JSON.parse(readFileSync(configFixtureFile, "utf8"));
  writeJson(path.join(workspaceRoot, "wakeflow.config.json"), config);
  for (const ref of [
    ".wakeflow-local/runtime/maintenance/transactions",
    ".wakeflow-local/runtime/hosts/claude-code/identity/window-bindings",
    ".wakeflow-local/runtime/hosts/claude-code/operations/window-locators",
    ACTIVITY_ROOT_REF,
    PROMPT_ROOT_REF,
  ]) ensurePrivateDirectory(workspaceRoot, ref);

  const tmuxFile = path.join(base, "fake-tmux.mjs");
  const stateFile = path.join(base, "tmux-state.json");
  writeFileSync(tmuxFile, fakeTmuxSource, { mode: 0o700 });
  if (process.platform !== "win32") chmodSync(tmuxFile, 0o700);
  const initialState = {
    socketPath: path.join(base, "tmux.sock"),
    sessionName: "wakeflow",
    alive: true,
    panes: [],
    options: {},
    listPanesCount: 0,
  };
  writeJson(stateFile, initialState);
  const previousTmuxBin = process.env.WAKEFLOW_TMUX_BIN;
  const previousTmuxState = process.env.WAKEFLOW_TMUX_ACTIVITY_STATE;
  process.env.WAKEFLOW_TMUX_BIN = tmuxFile;
  process.env.WAKEFLOW_TMUX_ACTIVITY_STATE = stateFile;
  t.after(() => {
    if (previousTmuxBin === undefined) delete process.env.WAKEFLOW_TMUX_BIN;
    else process.env.WAKEFLOW_TMUX_BIN = previousTmuxBin;
    if (previousTmuxState === undefined) delete process.env.WAKEFLOW_TMUX_ACTIVITY_STATE;
    else process.env.WAKEFLOW_TMUX_ACTIVITY_STATE = previousTmuxState;
    rmSync(base, { recursive: true, force: true });
  });
  return {
    base,
    workspaceRoot,
    stateFile,
    readState: () => JSON.parse(readFileSync(stateFile, "utf8")),
    writeState: (state) => writeJson(stateFile, state),
    waitForState: async (predicate) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() <= deadline) {
        const state = JSON.parse(readFileSync(stateFile, "utf8"));
        if (predicate(state)) return state;
        await delay(25);
      }
      assert.fail("fake tmux state did not reach the expected condition");
    },
  };
}

function monitorInput(fixture, pollMs = 60_000) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    socketName: null,
    sessionName: "wakeflow",
    pollMs,
  };
}

function contextTuple(result) {
  return {
    serverContextId: result.serverContextId,
    serverContextDigest: result.serverContextDigest,
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function inspectLocalLayout(fixture) {
  const model = parseWakeflowConfigV3(
    JSON.parse(readFileSync(path.join(fixture.workspaceRoot, "wakeflow.config.json"), "utf8")),
  );
  return inspectWakeflowLocalLayout({
    workspaceRoot: fixture.workspaceRoot,
    model,
    layoutDescriptor: createWakeflowLayoutDescriptor({ model, hostProfile: claudeProfile }),
    hostProfile: claudeProfile,
  });
}

test("M4-T10 exposes one Claude-only activity/temp owner without a Codex mirror", async () => {
  const moduleFile = path.join(claudeRoot, moduleRef);
  assert.equal(existsSync(moduleFile), true, "Claude activity/temp owner must exist");
  assert.equal(existsSync(path.join(claudeRoot, processSchemaRef)), true);
  assert.equal(existsSync(path.join(claudeRoot, managerLockSchemaRef)), true);
  const activity = await import(pathToFileURL(moduleFile).href);
  assert.deepEqual(Object.keys(activity).sort(), [...ACTIVITY_EXPORTS].sort());

  assert.equal(existsSync(path.join(codexRoot, moduleRef)), false);
  assert.equal(existsSync(path.join(codexRoot, processSchemaRef)), false);
  assert.equal(existsSync(path.join(codexRoot, managerLockSchemaRef)), false);
});

test("M4-T10 schemas close canonical process and manager generations", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat("date-time", { type: "string", validate: () => true });
  for (const ref of [processSchemaRef, managerLockSchemaRef]) {
    const schema = JSON.parse(readFileSync(path.join(claudeRoot, ref), "utf8"));
    const validate = ajv.compile(schema);
    assert.equal(validate({}), false);
    assert.equal(schema.additionalProperties, false);
  }
});

test("server context identity is deterministic, opaque, and separates socket plus session", () => {
  const first = deriveClaudeActivityServerContext({
    programId: PROGRAM_ID,
    socketPath: "/private/tmp/tmux-a/default",
    sessionName: "wakeflow",
  });
  const replay = deriveClaudeActivityServerContext({
    programId: PROGRAM_ID,
    socketPath: "/private/tmp/tmux-a/default",
    sessionName: "wakeflow",
  });
  const otherSocket = deriveClaudeActivityServerContext({
    programId: PROGRAM_ID,
    socketPath: "/private/tmp/tmux-b/default",
    sessionName: "wakeflow",
  });
  const otherSession = deriveClaudeActivityServerContext({
    programId: PROGRAM_ID,
    socketPath: "/private/tmp/tmux-a/default",
    sessionName: "wakeflow-2",
  });
  assert.deepEqual(first, replay);
  assert.notEqual(first.serverContextId, otherSocket.serverContextId);
  assert.notEqual(first.serverContextId, otherSession.serverContextId);
  assert.equal(JSON.stringify(first).includes("/private/tmp"), false);
  assert.equal(JSON.stringify(first).includes("wakeflow-2"), false);
  assert.equal(Object.isFrozen(first), true);
  assert.throws(
    () => deriveClaudeActivityServerContext({
      programId: PROGRAM_ID,
      socketPath: "/private/tmp/tmux-a/../tmux-a/default",
      sessionName: "wakeflow",
    }),
    { code: "wakeflow-claude-activity-context" },
  );
});

test("activity inputs reject relative roots and fabricated server-context tuples", (t) => {
  const fixture = createFixture(t);
  const context = deriveClaudeActivityServerContext({
    programId: PROGRAM_ID,
    socketPath: fixture.readState().socketPath,
    sessionName: "wakeflow",
  });
  assert.throws(
    () => inspectClaudeActivity({
      workspaceRoot: path.relative(process.cwd(), fixture.workspaceRoot),
      serverContext: contextTuple(context),
    }),
    { code: "wakeflow-claude-activity-workspace" },
  );
  const replacement = context.serverContextId.endsWith("0") ? "1" : "0";
  assert.throws(
    () => inspectClaudeActivity({
      workspaceRoot: fixture.workspaceRoot,
      serverContext: {
        serverContextId: `${context.serverContextId.slice(0, -1)}${replacement}`,
        serverContextDigest: context.serverContextDigest,
      },
    }),
    { code: "wakeflow-claude-activity-context" },
  );
});

test("activity tmux calls ignore ambient client targeting for the default server", async (t) => {
  const fixture = createFixture(t);
  const previousTmux = process.env.TMUX;
  const previousPane = process.env.TMUX_PANE;
  const previousReject = process.env.WAKEFLOW_TMUX_ACTIVITY_REJECT_AMBIENT;
  process.env.TMUX = "/tmp/unrelated-client,123,0";
  process.env.TMUX_PANE = "%999";
  process.env.WAKEFLOW_TMUX_ACTIVITY_REJECT_AMBIENT = "1";
  t.after(() => {
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
    if (previousPane === undefined) delete process.env.TMUX_PANE;
    else process.env.TMUX_PANE = previousPane;
    if (previousReject === undefined) delete process.env.WAKEFLOW_TMUX_ACTIVITY_REJECT_AMBIENT;
    else process.env.WAKEFLOW_TMUX_ACTIVITY_REJECT_AMBIENT = previousReject;
  });
  let current = null;
  try {
    const started = await ensureClaudeActivityMonitor(monitorInput(fixture));
    current = contextTuple(started);
    assert.equal(started.status, "started");
  } finally {
    if (current) {
      fixture.writeState({ ...fixture.readState(), alive: false });
      await stopClaudeActivityMonitor({
        workspaceRoot: fixture.workspaceRoot,
        serverContext: current,
      }).catch(() => {});
    }
  }
});

test("activity manager starts one exact generation, replays it, and stops without live tmux discovery", async (t) => {
  const fixture = createFixture(t);
  let current = null;
  try {
    const started = await ensureClaudeActivityMonitor(monitorInput(fixture));
    current = contextTuple(started);
    assert.equal(started.status, "started");
    assert.equal(started.created, true);
    assert.equal(started.process.health, "running");

    const replay = await ensureClaudeActivityMonitor(monitorInput(fixture));
    assert.equal(replay.status, "current");
    assert.equal(replay.created, false);
    assert.equal(replay.process.monitorId, started.process.monitorId);
    assert.equal(replay.process.processDigest, started.process.processDigest);

    const processFile = path.join(
      fixture.workspaceRoot,
      ACTIVITY_ROOT_REF,
      started.serverContextId,
      "process.json",
    );
    const record = JSON.parse(readFileSync(processFile, "utf8"));
    const schema = JSON.parse(readFileSync(path.join(claudeRoot, processSchemaRef), "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    ajv.addFormat("date-time", { type: "string", validate: () => true });
    const validate = ajv.compile(schema);
    assert.equal(validate(record), true, JSON.stringify(validate.errors));
    assert.equal(statSync(processFile).mode & 0o777, 0o600);
    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes(fixture.base), false);
    assert.equal(serialized.includes("wakeflow"), false);
    assert.equal(Object.hasOwn(record.processIdentity, "parentPid"), false);

    const inspection = inspectClaudeActivity({
      workspaceRoot: fixture.workspaceRoot,
      serverContext: current,
    });
    assert.equal(inspection.status, "running");
    assert.equal(JSON.stringify(inspection).includes(String(record.processIdentity.pid)), false);
    assert.equal(JSON.stringify(inspection).includes(fixture.base), false);
    const layout = inspectLocalLayout(fixture);
    const processEvent = layout.items.events.find((event) => (
      event.matchedKeys?.includes("event.host.activity-process")
    ));
    assert.equal(processEvent.classification, "owner-validated");
    assert.equal(processEvent.path, null);
    assert.match(processEvent.recordDigest, /^sha256:[0-9a-f]{64}$/u);

    fixture.writeState({ ...fixture.readState(), alive: false });
    const stopped = await stopClaudeActivityMonitor({
      workspaceRoot: fixture.workspaceRoot,
      serverContext: current,
    });
    current = null;
    assert.equal(stopped.status, "stopped");
    assert.equal(existsSync(processFile), false);
    assert.equal(
      existsSync(path.join(fixture.workspaceRoot, ACTIVITY_ROOT_REF, started.serverContextId)),
      false,
    );
    const repeated = await stopClaudeActivityMonitor({
      workspaceRoot: fixture.workspaceRoot,
      serverContext: contextTuple(started),
    });
    assert.equal(repeated.status, "already-stopped");
  } finally {
    if (current) {
      await stopClaudeActivityMonitor({
        workspaceRoot: fixture.workspaceRoot,
        serverContext: current,
      }).catch(() => {});
    }
  }
});

test("activity monitor overlays only running and restores the exact prior glyph", async (t) => {
  const fixture = createFixture(t);
  let current = null;
  try {
    const started = await ensureClaudeActivityMonitor(monitorInput(fixture));
    current = contextTuple(started);
    await fixture.waitForState((state) => state.listPanesCount > 0);
    const binding = await registerWindowBinding({
      workspaceRoot: fixture.workspaceRoot,
      windowId: CONTROLLER_WINDOW_ID,
      handle: { kind: "claude-session", value: CLAUDE_HANDLE },
    });
    const locator = createClaudeWindowLocatorRecord({
      programId: PROGRAM_ID,
      windowId: CONTROLLER_WINDOW_ID,
      bindingId: binding.bindingId,
      locatorId: LOCATOR_ID,
      tmux: {
        socketName: null,
        sessionName: "wakeflow",
        windowId: "@1",
        paneId: "%1",
      },
      locatedAt: "2026-08-09T12:00:00.000Z",
    });
    const observation = inspectClaudeWindowLocatorObservation({
      locator,
      binding: {
        programId: binding.programId,
        hostId: binding.hostId,
        windowId: binding.windowId,
        bindingId: binding.bindingId,
      },
      expectedSocketName: null,
      observations: [{
        provider: "tmux",
        socketName: null,
        sessionName: "wakeflow",
        windowId: "@1",
        paneId: "%1",
        paneWindowId: "@1",
        paneDead: false,
        claudeProcess: true,
        metadata: {
          programId: PROGRAM_ID,
          hostId: "claude-code",
          windowId: CONTROLLER_WINDOW_ID,
          bindingId: binding.bindingId,
          locatorId: LOCATOR_ID,
        },
      }],
    });
    await withClaudeWindowOperationMutex({
      workspaceRoot: fixture.workspaceRoot,
      windowId: CONTROLLER_WINDOW_ID,
      operationKind: "launch",
      expectedBindingId: binding.bindingId,
      expectedLocatorId: null,
    }, (operation) => commitClaudeWindowLocator({
      operation,
      locator,
      observation,
      expectedSocketName: null,
    }));

    const state = fixture.readState();
    state.panes = [{
      tmuxWindowId: "@1",
      paneId: "%1",
      paneDead: false,
      paneCurrentCommand: "claude",
      programId: PROGRAM_ID,
      hostId: "claude-code",
      windowId: CONTROLLER_WINDOW_ID,
      bindingId: binding.bindingId,
      locatorId: LOCATOR_ID,
      text: "Building feature… Esc to interrupt",
    }];
    state.options = { "@1": { "@wakeflow_state": "ready" } };
    fixture.writeState(state);
    const cycleInput = {
      workspaceRoot: fixture.workspaceRoot,
      socketName: null,
      sessionName: "wakeflow",
      serverContext: current,
      monitorId: started.process.monitorId,
    };
    const running = runClaudeActivityMonitorCycle(cycleInput);
    assert.deepEqual(running.windows, [{ windowId: CONTROLLER_WINDOW_ID, status: "running" }]);
    assert.deepEqual(fixture.readState().options["@1"], {
      "@wakeflow_state": "running",
      "@wakeflow_prev_state": "ready",
    });

    const idleState = fixture.readState();
    idleState.panes[0].text = "Ready for the next prompt";
    fixture.writeState(idleState);
    runClaudeActivityMonitorCycle(cycleInput);
    const idle = runClaudeActivityMonitorCycle(cycleInput);
    assert.deepEqual(idle.windows, [{ windowId: CONTROLLER_WINDOW_ID, status: "idle" }]);
    assert.deepEqual(fixture.readState().options["@1"], { "@wakeflow_state": "ready" });

    const externalRunning = fixture.readState();
    externalRunning.options["@1"] = { "@wakeflow_state": "running" };
    fixture.writeState(externalRunning);
    runClaudeActivityMonitorCycle(cycleInput);
    assert.deepEqual(fixture.readState().options["@1"], { "@wakeflow_state": "running" });

    const redirected = fixture.readState();
    redirected.panes[0].tmuxWindowId = "@9";
    redirected.panes[0].paneId = "%9";
    redirected.panes[0].text = "Building elsewhere… Esc to interrupt";
    redirected.options["@9"] = { "@wakeflow_state": "untouched" };
    fixture.writeState(redirected);
    const mismatched = runClaudeActivityMonitorCycle(cycleInput);
    assert.deepEqual(mismatched.windows, [{
      windowId: CONTROLLER_WINDOW_ID,
      status: "unavailable",
    }]);
    assert.equal(mismatched.status, "attention-required");
    assert.deepEqual(fixture.readState().options["@9"], { "@wakeflow_state": "untouched" });
  } finally {
    if (current) {
      await stopClaudeActivityMonitor({
        workspaceRoot: fixture.workspaceRoot,
        serverContext: current,
      }).catch(() => {});
    }
  }
});

test("activity identity mismatch, unsafe mode, and unknown residue fail closed without signaling", async (t) => {
  const fixture = createFixture(t);
  let current = null;
  try {
    const started = await ensureClaudeActivityMonitor(monitorInput(fixture));
    current = contextTuple(started);
    await fixture.waitForState((state) => state.listPanesCount > 0);
    const contextRoot = path.join(fixture.workspaceRoot, ACTIVITY_ROOT_REF, started.serverContextId);
    const processFile = path.join(contextRoot, "process.json");
    const originalBytes = readFileSync(processFile);
    const record = JSON.parse(originalBytes);
    const { processDigest: _ignored, ...unsigned } = record;
    const impossibleTimeUnsigned = {
      ...unsigned,
      startedAt: "2026-02-31T12:00:00.000Z",
    };
    writeFileSync(processFile, `${canonicalJson({
      ...impossibleTimeUnsigned,
      processDigest: canonicalJsonDigest(impossibleTimeUnsigned),
    })}\n`, { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(processFile, 0o600);
    assert.throws(
      () => inspectClaudeActivity({ workspaceRoot: fixture.workspaceRoot, serverContext: current }),
      { code: "wakeflow-claude-activity-time" },
    );

    const tamperedUnsigned = {
      ...unsigned,
      executableDigest: `sha256:${"0".repeat(64)}`,
    };
    const tampered = {
      ...tamperedUnsigned,
      processDigest: canonicalJsonDigest(tamperedUnsigned),
    };
    writeFileSync(processFile, `${canonicalJson(tampered)}\n`, { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(processFile, 0o600);
    await assert.rejects(
      ensureClaudeActivityMonitor(monitorInput(fixture)),
      { code: "wakeflow-claude-activity-process-identity" },
    );
    assert.doesNotThrow(() => process.kill(record.processIdentity.pid, 0));

    writeFileSync(processFile, originalBytes, { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(processFile, 0o600);
    if (process.platform !== "win32") {
      chmodSync(processFile, 0o644);
      assert.throws(
        () => inspectClaudeActivity({ workspaceRoot: fixture.workspaceRoot, serverContext: current }),
        { code: "wakeflow-claude-activity-storage" },
      );
      chmodSync(processFile, 0o600);
    }
    const unknownFile = path.join(contextRoot, "unexpected.json");
    writeFileSync(unknownFile, "{}\n", { mode: 0o600 });
    assert.throws(
      () => inspectClaudeActivity({ workspaceRoot: fixture.workspaceRoot, serverContext: current }),
      { code: "wakeflow-claude-activity-unknown" },
    );
    rmSync(unknownFile);

    const boundedResidue = Array.from({ length: 16 }, (_, index) => path.join(
      contextRoot,
      `residue-${String(index).padStart(2, "0")}`,
    ));
    for (const file of boundedResidue) writeFileSync(file, "x", { mode: 0o600 });
    assert.throws(
      () => inspectClaudeActivity({ workspaceRoot: fixture.workspaceRoot, serverContext: current }),
      { code: "wakeflow-claude-activity-inventory-limit" },
    );
    for (const file of boundedResidue) rmSync(file);
  } finally {
    if (current) {
      await stopClaudeActivityMonitor({
        workspaceRoot: fixture.workspaceRoot,
        serverContext: current,
      }).catch(() => {});
    }
  }
});

test("prompt transfer is memory-first and cleans its 0600 fallback on success and error", async (t) => {
  const fixture = createFixture(t);
  const promptRoot = path.join(fixture.workspaceRoot, PROMPT_ROOT_REF);
  const secret = "sensitive prompt body";
  const memory = await withClaudePromptTransfer({
    workspaceRoot: fixture.workspaceRoot,
    prompt: secret,
    requiresPath: false,
  }, (transfer) => {
    assert.deepEqual(transfer, { kind: "memory", prompt: secret });
    assert.deepEqual(readdirSync(promptRoot), []);
    return "memory-ok";
  });
  assert.equal(memory, "memory-ok");
  await assert.rejects(
    withClaudePromptTransfer({
      workspaceRoot: fixture.workspaceRoot,
      prompt: secret,
      requiresPath: false,
    }, () => {
      throw new Error("memory consumer failed");
    }),
    { code: "wakeflow-claude-activity-prompt-callback" },
  );

  const fileResult = await withClaudePromptTransfer({
    workspaceRoot: fixture.workspaceRoot,
    prompt: secret,
    requiresPath: true,
  }, (transfer) => {
    assert.equal(transfer.kind, "file");
    assert.match(path.basename(transfer.path), /^workspace-mutation_[0-9a-f-]+\.txt$/u);
    assert.equal(statSync(transfer.path).mode & 0o777, 0o600);
    assert.equal(readFileSync(transfer.path, "utf8"), secret);
    const promptEvent = inspectLocalLayout(fixture).items.events.find((event) => (
      event.matchedKeys?.includes("event.host.temp-prompt")
    ));
    assert.equal(promptEvent.classification, "owner-validated-active-operation");
    return path.basename(transfer.path);
  });
  assert.match(fileResult, /^workspace-mutation_/u);
  assert.deepEqual(readdirSync(promptRoot), []);

  await assert.rejects(
    withClaudePromptTransfer({
      workspaceRoot: fixture.workspaceRoot,
      prompt: secret,
      requiresPath: true,
    }, () => {
      throw new Error("consumer failed");
    }),
    { code: "wakeflow-claude-activity-prompt-callback" },
  );
  assert.deepEqual(readdirSync(promptRoot), []);
});

test("prompt inspection is redacted and sweeper removes only strict expired residue", async (t) => {
  const fixture = createFixture(t);
  const promptRoot = path.join(fixture.workspaceRoot, PROMPT_ROOT_REF);
  const expiredName = "workspace-mutation_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.txt";
  const freshName = "workspace-mutation_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.txt";
  const expiredFile = path.join(promptRoot, expiredName);
  const freshFile = path.join(promptRoot, freshName);
  writeFileSync(expiredFile, "expired secret", { mode: 0o600 });
  writeFileSync(freshFile, "fresh secret", { mode: 0o600 });
  if (process.platform !== "win32") {
    chmodSync(expiredFile, 0o600);
    chmodSync(freshFile, 0o600);
  }
  const now = Date.now();
  const observedAt = new Date(now).toISOString();
  utimesSync(expiredFile, new Date(now - (3 * 60 * 60 * 1000)), new Date(now - (3 * 60 * 60 * 1000)));
  utimesSync(freshFile, new Date(now - (30 * 60 * 1000)), new Date(now - (30 * 60 * 1000)));
  const inspection = inspectClaudePromptTemp({
    workspaceRoot: fixture.workspaceRoot,
    observedAt,
    expiryMs: 60 * 60 * 1000,
  });
  assert.equal(inspection.counts.expired, 1);
  assert.equal(inspection.counts.orphan, 1);
  const serialized = JSON.stringify(inspection);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes(expiredName), false);
  assert.equal(serialized.includes(fixture.workspaceRoot), false);

  const swept = await sweepClaudePromptTemp({
    workspaceRoot: fixture.workspaceRoot,
    expiryMs: 60 * 60 * 1000,
  });
  assert.equal(swept.removed, 1);
  assert.equal(existsSync(expiredFile), false);
  assert.equal(existsSync(freshFile), true);

  await assert.rejects(
    sweepClaudePromptTemp({
      workspaceRoot: fixture.workspaceRoot,
      observedAt: "2099-01-01T00:00:00.000Z",
      expiryMs: 60 * 60 * 1000,
    }),
    { code: "wakeflow-claude-activity-contract" },
  );

  const oversizedName = "workspace-mutation_cccccccc-cccc-4ccc-8ccc-cccccccccccc.txt";
  const oversizedFile = path.join(promptRoot, oversizedName);
  writeFileSync(oversizedFile, Buffer.alloc((1024 * 1024) + 1), { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(oversizedFile, 0o600);
  utimesSync(oversizedFile, new Date(now - (3 * 60 * 60 * 1000)), new Date(now - (3 * 60 * 60 * 1000)));
  const oversizedInspection = inspectClaudePromptTemp({
    workspaceRoot: fixture.workspaceRoot,
    observedAt,
    expiryMs: 60 * 60 * 1000,
  });
  assert.equal(oversizedInspection.counts.invalid, 1);
  await assert.rejects(
    sweepClaudePromptTemp({
      workspaceRoot: fixture.workspaceRoot,
      expiryMs: 60 * 60 * 1000,
    }),
    { code: "wakeflow-claude-activity-prompt-sweep" },
  );
  assert.equal(existsSync(oversizedFile), true);
  rmSync(oversizedFile);

  const invalidFile = path.join(promptRoot, "unexpected.txt");
  writeFileSync(invalidFile, "invalid secret", { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(invalidFile, 0o600);
  await assert.rejects(
    sweepClaudePromptTemp({
      workspaceRoot: fixture.workspaceRoot,
      expiryMs: 60 * 60 * 1000,
    }),
    { code: "wakeflow-claude-activity-prompt-sweep" },
  );
  assert.equal(existsSync(freshFile), true);
  assert.equal(existsSync(invalidFile), true);
});

test("layout activity inspection is config-bound, redacted, and immutable", async (t) => {
  const fixture = createFixture(t);
  const snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: fixture.workspaceRoot });
  const inspection = inspectClaudeActivityForLayout({
    workspaceRoot: fixture.workspaceRoot,
    programId: snapshot.model.program.programId,
    hostId: "claude-code",
    configDigest: snapshot.configDigest,
    windowIds: snapshot.model.topology.windows.map((entry) => entry.windowId),
  });
  assert.equal(inspection.status, "current");
  assert.equal(Object.isFrozen(inspection), true);
  assert.equal(Object.isFrozen(inspection.entries), true);
  assert.equal(JSON.stringify(inspection).includes(fixture.workspaceRoot), false);
  assert.equal(JSON.stringify(inspection).includes("prompt"), false);

  let getterCalls = 0;
  const accessorWindowIds = [];
  Object.defineProperty(accessorWindowIds, "0", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return CONTROLLER_WINDOW_ID;
    },
  });
  accessorWindowIds.length = 1;
  assert.throws(
    () => inspectClaudeActivityForLayout({
      workspaceRoot: fixture.workspaceRoot,
      programId: snapshot.model.program.programId,
      hostId: "claude-code",
      configDigest: snapshot.configDigest,
      windowIds: accessorWindowIds,
    }),
    { code: "wakeflow-claude-activity-contract" },
  );
  assert.equal(getterCalls, 0);
});

test("activity and temp ownership remains Claude-only and disconnected from frozen public v2", () => {
  assert.deepEqual(claudeProfile.capabilities.activity, { applicable: true, realization: "current" });
  assert.deepEqual(claudeProfile.capabilities.temp, { applicable: true, realization: "current" });
  assert.deepEqual(codexProfile.capabilities.activity, { applicable: false, realization: "not-applicable" });
  assert.deepEqual(codexProfile.capabilities.temp, { applicable: false, realization: "not-applicable" });
  const source = readFileSync(path.join(claudeRoot, moduleRef), "utf8");
  for (const forbidden of [
    "wakeflow-claude-host.mjs",
    "wakeflow-host-send-adapter.mjs",
    "wakeflow-thread-registry.mjs",
    "wakeflow-window-runtime.mjs",
    "wakeflow-delivery",
    "window-host",
    "runtime-meta",
    "paste.lock",
  ]) {
    assert.equal(source.includes(forbidden), false, `activity candidate must not consume ${forbidden}`);
  }
  for (const relative of claudeProfile.artifact.activityFrozenPublicFiles) {
    const publicSource = readFileSync(path.join(claudeRoot, relative), "utf8");
    assert.equal(publicSource.includes("wakeflow-claude-activity.mjs"), false, `${relative} must remain frozen`);
  }
});
