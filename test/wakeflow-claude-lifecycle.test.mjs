import assert from "node:assert/strict";
import {
  chmodSync,
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
import { fileURLToPath } from "node:url";

import {
  arrangeClaudeWindows,
  defaultClaudeLifecycleHostAdapter,
  inspectClaudeHostPreflight,
  inspectClaudeWindowFleet,
  launchClaudeWindow,
  resumeClaudeWindow,
  retitleClaudeWindow,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-lifecycle.mjs";
import {
  inspectWindowBindingInventory,
  withCurrentWindowBindingHandle,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-binding-service.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFixtureFile = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);
const PROGRAM_ID = "program_11111111-1111-4111-8111-111111111111";
const CONTROLLER_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";
const SESSION_ID = "10000000-0000-4000-8000-000000000001";
const LOCATOR_UUID_A = "20000000-0000-4000-8000-000000000002";
const LOCATOR_UUID_B = "30000000-0000-4000-8000-000000000003";

function ensurePrivateDirectory(root, ref) {
  let current = root;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    if (process.platform !== "win32") chmodSync(current, 0o700);
  }
}

function createFixture(t, mutateConfig = null) {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-lifecycle-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspaceRoot = path.join(base, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  mkdirSync(path.join(workspaceRoot, "Design"), { mode: 0o700 });
  mkdirSync(path.join(workspaceRoot, "Test"), { mode: 0o700 });
  mkdirSync(path.join(base, "ProductA"), { mode: 0o700 });
  mkdirSync(path.join(base, "wakeflow-ledger"), { mode: 0o700 });
  const config = JSON.parse(readFileSync(configFixtureFile, "utf8"));
  if (mutateConfig !== null) mutateConfig(config);
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );
  for (const ref of [
    ".wakeflow-local/runtime/maintenance/transactions",
    ".wakeflow-local/runtime/hosts/claude-code/identity/window-bindings",
    ".wakeflow-local/runtime/hosts/claude-code/operations/window-locators",
  ]) ensurePrivateDirectory(workspaceRoot, ref);
  return { workspaceRoot };
}

function fakeHost() {
  const panes = [];
  const calls = [];
  let coordinate = 0;
  const host = {
    probe() {
      calls.push(["probe"]);
      return { tmuxAvailable: true, claudeAvailable: true };
    },
    createWindow(input) {
      coordinate += 1;
      calls.push([
        "create",
        input.mode,
        input.windowId,
        input.sessionId,
        input.cwd,
        input.title,
        input.preferences,
        input.context,
      ]);
      const pane = {
        provider: "tmux",
        socketName: input.context.socketName,
        sessionName: input.context.sessionName,
        windowId: `@${coordinate}`,
        paneId: `%${coordinate}`,
        paneWindowId: `@${coordinate}`,
        paneDead: false,
        claudeProcess: true,
        metadata: {
          programId: "",
          hostId: "",
          windowId: "",
          bindingId: "",
          locatorId: "",
        },
      };
      panes.push(pane);
      return {
        socketName: input.context.socketName,
        sessionName: input.context.sessionName,
        windowId: pane.windowId,
        paneId: pane.paneId,
      };
    },
    writeMetadata({ coordinate: exact, metadata }) {
      calls.push(["metadata", metadata.windowId, metadata.bindingId, metadata.locatorId]);
      const pane = panes.find((entry) => entry.windowId === exact.windowId && entry.paneId === exact.paneId);
      assert.ok(pane);
      pane.metadata = { ...metadata };
      return { status: "written" };
    },
    listPanes() {
      calls.push(["observe"]);
      return panes.map((entry) => ({ ...entry, metadata: { ...entry.metadata } }));
    },
    renameWindow({ endpoint, title }) {
      calls.push(["rename", endpoint.windowId, title]);
      return { status: "renamed" };
    },
    arrangeWindows({ endpoints }) {
      calls.push(["arrange", ...endpoints.map((entry) => entry.windowId)]);
      return { status: "arranged" };
    },
    closeWindow() {
      calls.push(["close"]);
      return { status: "succeeded" };
    },
  };
  return {
    host,
    calls,
    clearPanes() {
      panes.splice(0, panes.length);
    },
  };
}

function adapters(hostState, uuids, times) {
  return {
    host: hostState.host,
    uuidFactory() {
      assert.ok(uuids.length > 0, "test UUID sequence exhausted");
      return uuids.shift();
    },
    clock() {
      assert.ok(times.length > 0, "test clock sequence exhausted");
      return times.shift();
    },
  };
}

function request(workspaceRoot) {
  return {
    workspaceRoot,
    expectedProgramId: PROGRAM_ID,
    windowId: CONTROLLER_WINDOW_ID,
    bootWaitMs: 0,
  };
}

test("M7A-T04 Claude lifecycle launches identity-first and never returns the raw session handle", async (t) => {
  const fixture = createFixture(t);
  const physical = fakeHost();
  const result = await launchClaudeWindow(
    request(fixture.workspaceRoot),
    adapters(
      physical,
      [SESSION_ID, LOCATOR_UUID_A],
      ["2026-08-11T08:00:00.000Z"],
    ),
  );
  assert.equal(result.action, "launch");
  assert.equal(result.windowId, CONTROLLER_WINDOW_ID);
  assert.match(result.binding.bindingId, /^binding_/u);
  assert.equal(result.locator.locatorId, `locator_${LOCATOR_UUID_A}`);
  assert.equal(JSON.stringify(result).includes(SESSION_ID), false);
  assert.deepEqual(physical.calls.map((entry) => entry[0]).filter((entry) => entry !== "observe"), [
    "create",
    "metadata",
  ]);
  const binding = inspectWindowBindingInventory({ workspaceRoot: fixture.workspaceRoot }).bindings[0];
  assert.equal(binding.windowId, CONTROLLER_WINDOW_ID);
  assert.equal(JSON.stringify(binding).includes(SESSION_ID), false);
  const fleet = await inspectClaudeWindowFleet(
    { workspaceRoot: fixture.workspaceRoot, expectedProgramId: PROGRAM_ID },
    { host: physical.host },
  );
  assert.equal(fleet.windows.find((entry) => entry.windowId === CONTROLLER_WINDOW_ID).authorityEligible, true);
  assert.equal(JSON.stringify(fleet).includes(SESSION_ID), false);
});

test("M7A-T04 lifecycle snapshots host callbacks before UUID and host awaits", async (t) => {
  const fixture = createFixture(t);
  const physical = fakeHost();
  const mutableHost = { ...physical.host };
  let replacementCreateCalls = 0;
  const uuids = [SESSION_ID, LOCATOR_UUID_A];
  const result = await launchClaudeWindow(request(fixture.workspaceRoot), {
    host: mutableHost,
    uuidFactory() {
      mutableHost.createWindow = () => {
        replacementCreateCalls += 1;
        throw new Error("replacement host callback must not run");
      };
      return uuids.shift();
    },
    clock: () => "2026-08-11T08:00:00.000Z",
  });
  assert.equal(result.status, "completed");
  assert.equal(replacementCreateCalls, 0);
  assert.equal(physical.calls.some((entry) => entry[0] === "create"), true);
});

test("M7A-T04 config drift after mutex admission is rejected before physical creation", async (t) => {
  const fixture = createFixture(t);
  const physical = fakeHost();
  const configFile = path.join(fixture.workspaceRoot, "wakeflow.config.json");
  const uuids = [SESSION_ID, LOCATOR_UUID_A];
  let mutated = false;
  await assert.rejects(
    launchClaudeWindow(request(fixture.workspaceRoot), {
      host: physical.host,
      uuidFactory() {
        if (!mutated) {
          mutated = true;
          const config = JSON.parse(readFileSync(configFile, "utf8"));
          config.program.displayName = "Changed During Admission";
          writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
        }
        return uuids.shift();
      },
      clock: () => "2026-08-11T08:00:00.000Z",
    }),
    (error) => error?.code === "wakeflow-claude-locator-callback-failed"
      && error?.cause?.code === "wakeflow-claude-lifecycle-authority-drift",
  );
  assert.equal(physical.calls.some((entry) => entry[0] === "create"), false);
});

test("M7A-T04 lifecycle inputs and pane inventories remain explicit passive data", async (t) => {
  const fixture = createFixture(t);
  const physical = fakeHost();
  await assert.rejects(
    inspectClaudeHostPreflight(
      { workspaceRoot: ".", expectedProgramId: PROGRAM_ID },
      { host: physical.host },
    ),
    { code: "wakeflow-claude-lifecycle-workspace" },
  );
  let paneReads = 0;
  const behavioralPanes = [];
  Object.defineProperty(behavioralPanes, "0", {
    enumerable: true,
    configurable: true,
    get() {
      paneReads += 1;
      return {};
    },
  });
  await assert.rejects(
    inspectClaudeWindowFleet(
      { workspaceRoot: fixture.workspaceRoot, expectedProgramId: PROGRAM_ID },
      { host: { ...physical.host, listPanes: () => behavioralPanes } },
    ),
    { code: "wakeflow-claude-lifecycle-observation" },
  );
  assert.equal(paneReads, 0, "behavioral pane entries must not execute");
});

test("M7A-T04 default pane observation never turns command failure into physical absence", () => {
  const previous = process.env.WAKEFLOW_TMUX_BIN;
  process.env.WAKEFLOW_TMUX_BIN = path.join(os.tmpdir(), "wakeflow-missing-tmux-binary");
  try {
    assert.throws(
      () => defaultClaudeLifecycleHostAdapter.listPanes({
        context: { socketName: null, sessionName: "wakeflow" },
      }),
      { code: "wakeflow-claude-lifecycle-host-observation" },
    );
  } finally {
    if (previous === undefined) delete process.env.WAKEFLOW_TMUX_BIN;
    else process.env.WAKEFLOW_TMUX_BIN = previous;
  }
});

test("M7A-T04 Claude lifecycle resolves durable launch and tmux preferences before host creation", async (t) => {
  const fixture = createFixture(t, (config) => {
    config.hosts["claude-code"] = {
      launch: {
        modelByRole: { default: "claude-configured" },
        reasoningEffortByRole: { controller: "xhigh", default: "high" },
        permissionMode: "bypassPermissions",
      },
      tmux: {
        sessionName: "wakeflow-configured",
        socketName: "wakeflow-configured",
      },
    };
  });
  const physical = fakeHost();
  await launchClaudeWindow(
    request(fixture.workspaceRoot),
    adapters(
      physical,
      [SESSION_ID, LOCATOR_UUID_A],
      ["2026-08-11T08:00:00.000Z"],
    ),
  );
  const createCall = physical.calls.find((entry) => entry[0] === "create");
  assert.deepEqual(createCall?.[6], {
    permissionMode: "bypassPermissions",
    effort: "xhigh",
    model: "claude-configured",
  });
  assert.deepEqual(createCall?.[7], {
    socketName: "wakeflow-configured",
    sessionName: "wakeflow-configured",
  });
});

test("M7A-T04 unsafe Claude tmux config is rejected before a physical host effect", async (t) => {
  const fixture = createFixture(t, (config) => {
    config.hosts["claude-code"] = {
      tmux: {
        sessionName: "wakeflow",
        socketName: "unsafe/socket",
      },
    };
  });
  const physical = fakeHost();
  await assert.rejects(
    launchClaudeWindow(
      request(fixture.workspaceRoot),
      adapters(
        physical,
        [SESSION_ID, LOCATOR_UUID_A],
        ["2026-08-11T08:00:00.000Z"],
      ),
    ),
    { code: "wakeflow-claude-lifecycle-config" },
  );
  assert.equal(physical.calls.some((entry) => entry[0] === "create"), false);
});

test("M7A-T04 resume consumes the exact private handle, preserves binding, and creates a new locator generation", async (t) => {
  const fixture = createFixture(t);
  const physical = fakeHost();
  const launched = await launchClaudeWindow(
    request(fixture.workspaceRoot),
    adapters(
      physical,
      [SESSION_ID, LOCATOR_UUID_A],
      ["2026-08-11T08:00:00.000Z"],
    ),
  );
  physical.clearPanes();
  const resumed = await resumeClaudeWindow(
    request(fixture.workspaceRoot),
    adapters(
      physical,
      [LOCATOR_UUID_B],
      ["2026-08-11T08:01:00.000Z"],
    ),
  );
  assert.equal(resumed.action, "resume");
  assert.equal(resumed.binding.bindingId, launched.binding.bindingId);
  assert.equal(resumed.binding.digest, launched.binding.digest);
  assert.equal(resumed.locator.locatorId, `locator_${LOCATOR_UUID_B}`);
  const createCalls = physical.calls.filter((entry) => entry[0] === "create");
  assert.equal(createCalls.length, 2);
  assert.deepEqual(createCalls.map((entry) => [entry[1], entry[3]]), [
    ["launch", SESSION_ID],
    ["resume", SESSION_ID],
  ]);
  assert.equal(JSON.stringify(resumed).includes(SESSION_ID), false);
});

test("M7A-T04 the identity owner exposes an exact callback-only handle and rejects result leakage", async (t) => {
  const fixture = createFixture(t);
  const physical = fakeHost();
  const launched = await launchClaudeWindow(
    request(fixture.workspaceRoot),
    adapters(
      physical,
      [SESSION_ID, LOCATOR_UUID_A],
      ["2026-08-11T08:00:00.000Z"],
    ),
  );
  const consumed = await withCurrentWindowBindingHandle({
    workspaceRoot: fixture.workspaceRoot,
    windowId: CONTROLLER_WINDOW_ID,
    expectedBindingId: launched.binding.bindingId,
    expectedBindingDigest: launched.binding.digest,
  }, async (handle) => {
    assert.deepEqual(handle, { kind: "claude-session", value: SESSION_ID });
    return { status: "used", handleRedacted: true };
  });
  assert.deepEqual(consumed, { status: "used", handleRedacted: true });
  await assert.rejects(
    withCurrentWindowBindingHandle({
      workspaceRoot: fixture.workspaceRoot,
      windowId: CONTROLLER_WINDOW_ID,
      expectedBindingId: launched.binding.bindingId,
      expectedBindingDigest: launched.binding.digest,
    }, async (handle) => ({ leaked: handle.value })),
    { code: "wakeflow-window-binding-handle-leak" },
  );
});

test("M7A-T04 preflight, retitle, and arrange remain exact-id host operations", async (t) => {
  const fixture = createFixture(t);
  const physical = fakeHost();
  const preflight = await inspectClaudeHostPreflight(
    { workspaceRoot: fixture.workspaceRoot, expectedProgramId: PROGRAM_ID },
    { host: physical.host },
  );
  assert.equal(preflight.status, "ready");
  await launchClaudeWindow(
    request(fixture.workspaceRoot),
    adapters(
      physical,
      [SESSION_ID, LOCATOR_UUID_A],
      ["2026-08-11T08:00:00.000Z"],
    ),
  );
  const listWakeflowPanes = physical.host.listPanes;
  const hostWithUnrelatedPane = {
    ...physical.host,
    listPanes() {
      return [{
        provider: "tmux",
        socketName: null,
        sessionName: "personal",
        windowId: "@999",
        paneId: "%999",
        paneWindowId: "@999",
        paneDead: false,
        claudeProcess: false,
        metadata: {
          programId: "",
          hostId: "",
          windowId: "",
          bindingId: "",
          locatorId: "",
        },
      }, ...listWakeflowPanes()];
    },
  };
  const retitled = await retitleClaudeWindow(
    { workspaceRoot: fixture.workspaceRoot, expectedProgramId: PROGRAM_ID, windowId: CONTROLLER_WINDOW_ID },
    { host: hostWithUnrelatedPane },
  );
  assert.equal(retitled.action, "retitle");
  assert.deepEqual(physical.calls.find((entry) => entry[0] === "rename")?.slice(2), ["Controller"]);
  await assert.rejects(
    arrangeClaudeWindows(
      { workspaceRoot: fixture.workspaceRoot, expectedProgramId: PROGRAM_ID },
      { host: physical.host },
    ),
    { code: "wakeflow-claude-lifecycle-binding" },
  );
  assert.equal(physical.calls.some((entry) => entry[0] === "arrange"), false);

  let receiptReads = 0;
  const behavioralReceiptHost = {
    ...physical.host,
    renameWindow() {
      const receipt = {};
      Object.defineProperty(receipt, "status", {
        enumerable: true,
        get() {
          receiptReads += 1;
          return "renamed";
        },
      });
      return receipt;
    },
  };
  await assert.rejects(
    retitleClaudeWindow(
      { workspaceRoot: fixture.workspaceRoot, expectedProgramId: PROGRAM_ID, windowId: CONTROLLER_WINDOW_ID },
      { host: behavioralReceiptHost },
    ),
    (error) => error?.code === "wakeflow-claude-locator-recovery-required"
      && error?.cause?.code === "wakeflow-claude-lifecycle-contract",
  );
  assert.equal(receiptReads, 0, "behavioral host receipts must not execute");
});

test("M7A-T04 resume refuses a still-live locator before creating another physical window", async (t) => {
  const fixture = createFixture(t);
  const physical = fakeHost();
  await launchClaudeWindow(
    request(fixture.workspaceRoot),
    adapters(
      physical,
      [SESSION_ID, LOCATOR_UUID_A],
      ["2026-08-11T08:00:00.000Z"],
    ),
  );
  const before = physical.calls.filter((entry) => entry[0] === "create").length;
  await assert.rejects(
    resumeClaudeWindow(
      request(fixture.workspaceRoot),
      adapters(
        physical,
        [LOCATOR_UUID_B],
        ["2026-08-11T08:01:00.000Z"],
      ),
    ),
    { code: "wakeflow-claude-lifecycle-resume-live" },
  );
  assert.equal(physical.calls.filter((entry) => entry[0] === "create").length, before);
});
