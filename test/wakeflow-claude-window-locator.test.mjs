import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  claudeWindowLocatorCanonicalBytes,
  claudeWindowLocatorDigest,
  claudeWindowLocatorRef,
  commitClaudeWindowLocator,
  createClaudeWindowLocatorRecord,
  generateClaudeWindowLocatorId,
  inspectClaudeWindowLocatorInventory,
  inspectClaudeWindowLocatorInventoryForLayout,
  inspectClaudeWindowLocatorObservation,
  recoverClaudeWindowOperationMutex,
  removeClaudeWindowLocator,
  resolveClaudeWindowOperationEndpoint,
  validateClaudeWindowLocatorRecord,
  withClaudeWindowOperationMutex,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-locator.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import { parseWakeflowConfigV3 } from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import { inspectWakeflowLocalLayout } from "../core/scripts/lib/wakeflow-local-layout-inspection.mjs";
import {
  registerWindowBinding,
  replaceWindowBinding,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-binding-service.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeRoot = path.join(repositoryRoot, "plugins/claude-code-wakeflow");
const codexRoot = path.join(repositoryRoot, "plugins/codex-wakeflow");
const schemaFile = path.join(
  claudeRoot,
  "schemas/wakeflow-claude-host/window-locator.schema.json",
);
const moduleFile = path.join(
  claudeRoot,
  "scripts/lib/wakeflow-claude-locator.mjs",
);
const configFixtureFile = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);

const PROGRAM_ID = "program_11111111-1111-4111-8111-111111111111";
const WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";
const HANDLE_A = "10000000-0000-4000-8000-000000000001";
const HANDLE_B = "20000000-0000-4000-8000-000000000002";
const LOCATOR_A = "locator_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCATOR_B = "locator_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOCATED_AT = "2026-08-09T08:00:00.000Z";

const LOCATOR_EXPORTS = Object.freeze([
  "WAKEFLOW_CLAUDE_WINDOW_LOCATOR_KIND",
  "WAKEFLOW_CLAUDE_WINDOW_LOCATOR_SCHEMA_VERSION",
  "WakeflowClaudeLocatorError",
  "claudeWindowLocatorCanonicalBytes",
  "claudeWindowLocatorDigest",
  "claudeWindowLocatorRef",
  "commitClaudeWindowLocator",
  "createClaudeWindowLocatorRecord",
  "generateClaudeWindowLocatorId",
  "inspectClaudeWindowLocatorInventory",
  "inspectClaudeWindowLocatorInventoryForLayout",
  "inspectClaudeWindowLocatorObservation",
  "recoverClaudeWindowOperationMutex",
  "removeClaudeWindowLocator",
  "resolveClaudeWindowOperationEndpoint",
  "validateClaudeWindowLocatorRecord",
  "withClaudeWindowOperationMutex",
]);

function ensurePrivateDirectory(root, ref) {
  let current = root;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    if (process.platform !== "win32") chmodSync(current, 0o700);
  }
  return current;
}

function createFixture(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-locator-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspaceRoot = path.join(base, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  if (process.platform !== "win32") chmodSync(workspaceRoot, 0o700);
  const config = JSON.parse(readFileSync(configFixtureFile, "utf8"));
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
  return { workspaceRoot, config };
}

async function registerFixtureBinding(workspaceRoot, handle = HANDLE_A) {
  return registerWindowBinding({
    workspaceRoot,
    windowId: WINDOW_ID,
    handle: { kind: "claude-session", value: handle },
  });
}

function locatorFixture(bindingId, overrides = {}) {
  return createClaudeWindowLocatorRecord({
    programId: PROGRAM_ID,
    windowId: WINDOW_ID,
    bindingId,
    locatorId: LOCATOR_A,
    tmux: {
      socketName: null,
      sessionName: "wakeflow",
      windowId: "@1",
      paneId: "%1",
    },
    locatedAt: LOCATED_AT,
    ...overrides,
  });
}

test("M4-T07 Claude locator and tracked config share the Unicode session-name bound", () => {
  const bindingId = "binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const accepted = "😀".repeat(128);
  assert.equal(locatorFixture(bindingId, {
    tmux: {
      socketName: null,
      sessionName: accepted,
      windowId: "@1",
      paneId: "%1",
    },
  }).tmux.sessionName, accepted);
  assert.throws(
    () => locatorFixture(bindingId, {
      tmux: {
        socketName: null,
        sessionName: "😀".repeat(129),
        windowId: "@1",
        paneId: "%1",
      },
    }),
    { code: "wakeflow-claude-locator-coordinate" },
  );
});

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

function issuedObservation(locator, binding, observations = [liveObservation(locator)], expectedSocketName = null) {
  return inspectClaudeWindowLocatorObservation({
    locator,
    binding: bindingTuple(binding),
    expectedSocketName,
    observations,
  });
}

test("M4-T07 exposes one Claude-only locator owner without a Codex mirror", async () => {
  await access(schemaFile);
  await access(moduleFile);
  const locator = await import(pathToFileURL(moduleFile).href);
  assert.deepEqual(Object.keys(locator).sort(), [...LOCATOR_EXPORTS].sort());
  await assert.rejects(
    access(path.join(codexRoot, "schemas/wakeflow-claude-host/window-locator.schema.json")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    access(path.join(codexRoot, "scripts/lib/wakeflow-claude-locator.mjs")),
    { code: "ENOENT" },
  );
});

test("M4-T07 schema and codec close the minimal locator without identity or business leakage", () => {
  const bindingId = "binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const locator = locatorFixture(bindingId);
  const schema = JSON.parse(readFileSync(schemaFile, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat("date-time", { type: "string", validate: () => true });
  const validateSchema = ajv.compile(schema);
  assert.equal(validateSchema(locator), true, JSON.stringify(validateSchema.errors));
  assert.equal(Object.isFrozen(locator), true);
  assert.equal(Object.isFrozen(locator.tmux), true);
  assert.deepEqual(Object.keys(locator), [
    "kind",
    "schemaVersion",
    "programId",
    "hostId",
    "windowId",
    "bindingId",
    "locatorId",
    "provider",
    "tmux",
    "locatedAt",
  ]);
  assert.deepEqual(Object.keys(locator.tmux), ["socketName", "sessionName", "windowId", "paneId"]);
  const bytes = claudeWindowLocatorCanonicalBytes(locator);
  assert.equal(bytes.toString("utf8"), `${canonicalJson(locator)}\n`);
  assert.match(claudeWindowLocatorDigest(locator), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    claudeWindowLocatorRef({ windowId: WINDOW_ID }),
    `.wakeflow-local/runtime/hosts/claude-code/operations/window-locators/${WINDOW_ID}.json`,
  );
  assert.equal(
    generateClaudeWindowLocatorId(() => "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
    "locator_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );
  for (const forbidden of [
    ["threadId", HANDLE_A],
    ["cwd", "/private/worktree"],
    ["title", "Controller"],
    ["role", "controller"],
    ["podId", "pod_hidden"],
    ["deliveryId", "delivery_hidden"],
  ]) {
    assert.throws(
      () => validateClaudeWindowLocatorRecord({ ...locator, [forbidden[0]]: forbidden[1] }),
      { code: "wakeflow-claude-locator-contract" },
    );
  }
  assert.throws(
    () => locatorFixture(bindingId, { tmux: { ...locator.tmux, paneId: "active-pane" } }),
    { code: "wakeflow-claude-locator-coordinate" },
  );
  assert.throws(
    () => locatorFixture(bindingId, { tmux: { ...locator.tmux, socketName: "/tmp/tmux.sock" } }),
    { code: "wakeflow-claude-locator-coordinate" },
  );
});

test("M4-T07 observation validates exact socket, session, window, pane, process and live metadata", () => {
  const binding = {
    programId: PROGRAM_ID,
    hostId: "claude-code",
    windowId: WINDOW_ID,
    bindingId: "binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
  const locator = locatorFixture(binding.bindingId);
  const inspect = (observations, overrides = {}) => inspectClaudeWindowLocatorObservation({
    locator,
    binding: overrides.binding ?? binding,
    expectedSocketName: Object.hasOwn(overrides, "expectedSocketName")
      ? overrides.expectedSocketName
      : null,
    observations,
  });
  assert.equal(inspect([liveObservation(locator)]).status, "live");
  assert.equal(inspect([]).status, "missing");
  assert.equal(inspect([liveObservation(locator), liveObservation(locator)]).status, "duplicate");
  assert.equal(inspect([liveObservation(locator, { paneWindowId: "@2" })]).status, "pane-window-mismatch");
  assert.equal(inspect([liveObservation(locator, { paneDead: true })]).status, "pane-dead");
  assert.equal(inspect([liveObservation(locator, { claudeProcess: false })]).status, "process-mismatch");
  assert.equal(inspect([liveObservation(locator, { paneId: "%2" })]).status, "coordinate-mismatch");
  assert.equal(inspect([liveObservation(locator, {
    metadata: { ...liveObservation(locator).metadata, locatorId: LOCATOR_B },
  })]).status, "metadata-mismatch");
  assert.equal(inspect([liveObservation(locator)], { expectedSocketName: "wakeflow-private" }).status, "host-context-drift");
  assert.equal(inspect([liveObservation(locator)], {
    binding: { ...binding, bindingId: "binding_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  }).status, "binding-mismatch");
  assert.deepEqual(Object.keys(inspect([liveObservation(locator)])).sort(), [
    "authorityEligible",
    "bindingId",
    "kind",
    "locatorId",
    "schemaVersion",
    "status",
    "windowId",
  ]);
  assert.equal(JSON.stringify(inspect([liveObservation(locator)])).includes("@1"), false);
  assert.equal(JSON.stringify(inspect([liveObservation(locator)])).includes("%1"), false);

  let observationReads = 0;
  const behavioralObservations = [];
  Object.defineProperty(behavioralObservations, "0", {
    enumerable: true,
    configurable: true,
    get() {
      observationReads += 1;
      return liveObservation(locator);
    },
  });
  assert.throws(
    () => inspect(behavioralObservations),
    { code: "wakeflow-claude-locator-observation" },
  );
  assert.equal(observationReads, 0, "behavioral observation entries must not execute");
});

test("M4-T07 public roots and layout arrays remain passive and explicit", (t) => {
  const fixture = createFixture(t);
  assert.throws(
    () => inspectClaudeWindowLocatorInventory({ workspaceRoot: "." }),
    { code: "wakeflow-claude-locator-input" },
  );
  let windowIdReads = 0;
  const behavioralWindowIds = [];
  Object.defineProperty(behavioralWindowIds, "0", {
    enumerable: true,
    configurable: true,
    get() {
      windowIdReads += 1;
      return WINDOW_ID;
    },
  });
  assert.throws(
    () => inspectClaudeWindowLocatorInventoryForLayout({
      workspaceRoot: fixture.workspaceRoot,
      programId: PROGRAM_ID,
      hostId: "claude-code",
      configDigest: `sha256:${"0".repeat(64)}`,
      windowIds: behavioralWindowIds,
    }),
    { code: "wakeflow-claude-locator-input" },
  );
  assert.equal(windowIdReads, 0, "behavioral window IDs must not execute");
});

test("M4-T07 operation mutex commits and removes one exact locator generation", async (t) => {
  const fixture = createFixture(t);
  const binding = await registerFixtureBinding(fixture.workspaceRoot);
  const initial = inspectClaudeWindowLocatorInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.equal(initial.windows[0].locator, null);
  assert.deepEqual(initial.issues, [`${WINDOW_ID}:identity-without-locator`]);
  const locator = locatorFixture(binding.bindingId);
  let releasedOperation;
  let committedObservation;
  const committed = await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationKind: "launch",
    expectedBindingId: binding.bindingId,
    expectedLocatorId: null,
  }, async (operation) => {
    releasedOperation = operation;
    await assert.rejects(
      withClaudeWindowOperationMutex({
        workspaceRoot: fixture.workspaceRoot,
        windowId: WINDOW_ID,
        operationKind: "readback",
        expectedBindingId: binding.bindingId,
        expectedLocatorId: null,
      }, async () => null),
      { code: "wakeflow-claude-locator-busy" },
    );
    const observation = issuedObservation(locator, binding);
    committedObservation = observation;
    await assert.rejects(
      commitClaudeWindowLocator({
        operation: { ...operation },
        locator,
        observation,
        expectedSocketName: null,
      }),
      { code: "wakeflow-claude-locator-operation-context" },
    );
    await assert.rejects(
      commitClaudeWindowLocator({
        operation,
        locator,
        observation: { ...observation },
        expectedSocketName: null,
      }),
      { code: "wakeflow-claude-locator-observation" },
    );
    return commitClaudeWindowLocator({
      operation,
      locator,
      observation,
      expectedSocketName: null,
    });
  });
  assert.equal(committed.status, "created");
  await assert.rejects(
    commitClaudeWindowLocator({
      operation: releasedOperation,
      locator,
      observation: committedObservation,
      expectedSocketName: null,
    }),
    { code: "wakeflow-claude-locator-operation-context" },
  );
  assert.equal(JSON.stringify(committed).includes("@1"), false);
  const current = inspectClaudeWindowLocatorInventory({
    workspaceRoot: fixture.workspaceRoot,
    expectedSocketName: null,
    observe: (record) => [liveObservation(record)],
  });
  assert.equal(current.status, "current");
  assert.equal(current.windows[0].locator.status, "live");
  assert.equal(current.windows[0].operation, null);

  const removal = await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationKind: "close",
    expectedBindingId: binding.bindingId,
    expectedLocatorId: locator.locatorId,
  }, async (operation) => removeClaudeWindowLocator({
    operation,
    expectedLocatorId: locator.locatorId,
    observation: issuedObservation(locator, binding, []),
  }));
  assert.equal(removal.status, "removed");
  assert.equal(inspectClaudeWindowLocatorInventory({
    workspaceRoot: fixture.workspaceRoot,
  }).windows[0].locator, null);
});

test("M4-T07 issued observations prove the complete locator payload", async (t) => {
  const fixture = createFixture(t);
  const binding = await registerFixtureBinding(fixture.workspaceRoot);
  const locator = locatorFixture(binding.bindingId);
  const differentCoordinates = locatorFixture(binding.bindingId, {
    tmux: {
      socketName: null,
      sessionName: "wakeflow",
      windowId: "@2",
      paneId: "%2",
    },
  });
  const liveForOriginal = issuedObservation(locator, binding);
  await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationKind: "launch",
    expectedBindingId: binding.bindingId,
    expectedLocatorId: null,
  }, async (operation) => {
    await assert.rejects(
      commitClaudeWindowLocator({
        operation,
        locator: differentCoordinates,
        observation: liveForOriginal,
        expectedSocketName: null,
      }),
      { code: "wakeflow-claude-locator-observation" },
    );
    return commitClaudeWindowLocator({
      operation,
      locator,
      observation: liveForOriginal,
      expectedSocketName: null,
    });
  });

  const missingForDifferentCoordinates = issuedObservation(
    differentCoordinates,
    binding,
    [],
  );
  await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationKind: "close",
    expectedBindingId: binding.bindingId,
    expectedLocatorId: locator.locatorId,
  }, async (operation) => {
    await assert.rejects(
      removeClaudeWindowLocator({
        operation,
        expectedLocatorId: locator.locatorId,
        observation: missingForDifferentCoordinates,
      }),
      { code: "wakeflow-claude-locator-observation" },
    );
  });
  assert.equal(
    inspectClaudeWindowLocatorInventory({ workspaceRoot: fixture.workspaceRoot })
      .windows[0].locator.locatorId,
    locator.locatorId,
  );
});

test("M4-T07 read/send contexts cannot mutate locator lifecycle state", async (t) => {
  const fixture = createFixture(t);
  const binding = await registerFixtureBinding(fixture.workspaceRoot);
  const locator = locatorFixture(binding.bindingId);
  await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationKind: "launch",
    expectedBindingId: binding.bindingId,
    expectedLocatorId: null,
  }, async (operation) => commitClaudeWindowLocator({
    operation,
    locator,
    observation: issuedObservation(locator, binding),
    expectedSocketName: null,
  }));

  await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationKind: "send",
    expectedBindingId: binding.bindingId,
    expectedLocatorId: locator.locatorId,
  }, async (operation) => {
    await assert.rejects(
      commitClaudeWindowLocator({
        operation,
        locator,
        observation: issuedObservation(locator, binding),
        expectedSocketName: null,
      }),
      { code: "wakeflow-claude-locator-operation-authority" },
    );
  });

  await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationKind: "readback",
    expectedBindingId: binding.bindingId,
    expectedLocatorId: locator.locatorId,
  }, async (operation) => {
    await assert.rejects(
      removeClaudeWindowLocator({
        operation,
        expectedLocatorId: locator.locatorId,
        observation: issuedObservation(locator, binding, []),
      }),
      { code: "wakeflow-claude-locator-operation-authority" },
    );
  });
});

test("M4-T07 identity replacement invalidates the old locator and only issued replace lineage can adopt a new one", async (t) => {
  const fixture = createFixture(t);
  const firstBinding = await registerFixtureBinding(fixture.workspaceRoot);
  const firstLocator = locatorFixture(firstBinding.bindingId);
  await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationKind: "launch",
    expectedBindingId: firstBinding.bindingId,
    expectedLocatorId: null,
  }, async (operation) => commitClaudeWindowLocator({
    operation,
    locator: firstLocator,
    observation: issuedObservation(firstLocator, firstBinding),
    expectedSocketName: null,
  }));

  let secondBinding;
  const secondLocator = await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationKind: "replace",
    expectedBindingId: firstBinding.bindingId,
    expectedLocatorId: firstLocator.locatorId,
  }, async (operation) => {
    secondBinding = await replaceWindowBinding({
      workspaceRoot: fixture.workspaceRoot,
      windowId: WINDOW_ID,
      expectedBindingId: firstBinding.bindingId,
      expectedBindingDigest: firstBinding.identityBindingDigest,
      handle: { kind: "claude-session", value: HANDLE_B },
    });
    const mismatched = inspectClaudeWindowLocatorInventory({
      workspaceRoot: fixture.workspaceRoot,
      expectedSocketName: null,
    });
    assert.equal(mismatched.windows[0].locator.status, "binding-mismatch");
    assert.equal(mismatched.windows[0].operation.status, "active");
    const candidate = locatorFixture(secondBinding.bindingId, {
      locatorId: LOCATOR_B,
      tmux: {
        socketName: "wakeflow-private",
        sessionName: "wakeflow",
        windowId: "@9",
        paneId: "%9",
      },
      locatedAt: "2026-08-09T08:01:00.000Z",
    });
    const result = await commitClaudeWindowLocator({
      operation,
      locator: candidate,
      observation: issuedObservation(candidate, secondBinding, [liveObservation(candidate)], "wakeflow-private"),
      expectedSocketName: "wakeflow-private",
    });
    assert.equal(result.status, "replaced");
    return candidate;
  });
  const inventory = inspectClaudeWindowLocatorInventory({
    workspaceRoot: fixture.workspaceRoot,
    expectedSocketName: "wakeflow-private",
  });
  assert.equal(inventory.windows[0].bindingId, secondBinding.bindingId);
  assert.equal(inventory.windows[0].locator.locatorId, secondLocator.locatorId);
  assert.equal(inventory.windows[0].locator.status, "current");
});

test("M4-T07 callback uncertainty retains the exact mutex until explicit owner recovery", async (t) => {
  const fixture = createFixture(t);
  const binding = await registerFixtureBinding(fixture.workspaceRoot);
  let operationId;
  await assert.rejects(
    withClaudeWindowOperationMutex({
      workspaceRoot: fixture.workspaceRoot,
      windowId: WINDOW_ID,
      operationKind: "launch",
      expectedBindingId: binding.bindingId,
      expectedLocatorId: null,
    }, async (operation) => {
      operationId = operation.operationId;
      throw new Error("injected uncertain host effect");
    }),
    { code: "wakeflow-claude-locator-recovery-required" },
  );
  let inventory = inspectClaudeWindowLocatorInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.equal(inventory.windows[0].operation.status, "active");
  assert.equal(inventory.windows[0].operation.operationId, operationId);
  const retained = await recoverClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationId,
  }, async () => ({ disposition: "retain-for-recovery" }));
  assert.equal(retained.status, "retained-for-recovery");
  inventory = inspectClaudeWindowLocatorInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.equal(inventory.windows[0].operation.status, "active");
  const released = await recoverClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationId,
  }, async () => ({ disposition: "safe-to-release" }));
  assert.equal(released.status, "released");
  assert.equal(inspectClaudeWindowLocatorInventory({
    workspaceRoot: fixture.workspaceRoot,
  }).windows[0].operation, null);

  let staleOperationId;
  await assert.rejects(
    withClaudeWindowOperationMutex({
      workspaceRoot: fixture.workspaceRoot,
      windowId: WINDOW_ID,
      operationKind: "launch",
      expectedBindingId: binding.bindingId,
      expectedLocatorId: null,
    }, async (operation) => {
      staleOperationId = operation.operationId;
      throw new Error("injected process death residue");
    }),
    { code: "wakeflow-claude-locator-recovery-required" },
  );
  const lockFile = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/hosts/claude-code/operations/window-locators",
    `${WINDOW_ID}.lock`,
  );
  const staleLock = JSON.parse(readFileSync(lockFile, "utf8"));
  staleLock.owner = {
    platform: process.platform,
    pid: 2_147_483_647,
    startIdentity: `sha256:${"0".repeat(64)}`,
  };
  const { lockDigest: ignoredLockDigest, ...unsignedLock } = staleLock;
  staleLock.lockDigest = canonicalJsonDigest(unsignedLock);
  writeFileSync(lockFile, `${canonicalJson(staleLock)}\n`, { mode: 0o600 });
  assert.equal(
    inspectClaudeWindowLocatorInventory({ workspaceRoot: fixture.workspaceRoot }).windows[0].operation.status,
    "stale",
  );
  const staleReleased = await recoverClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationId: staleOperationId,
  }, async () => ({ disposition: "safe-to-release" }));
  assert.equal(staleReleased.status, "released");
});

test("M4-T07 mutex freezes its failure verifier and never reuses an uncertain released context", async (t) => {
  const fixture = createFixture(t);
  const binding = await registerFixtureBinding(fixture.workspaceRoot);
  let originalFailureVerifierCalls = 0;
  let replacementFailureVerifierCalls = 0;
  const options = {
    onFailure() {
      originalFailureVerifierCalls += 1;
      return { disposition: "safe-to-release" };
    },
  };
  await assert.rejects(
    withClaudeWindowOperationMutex({
      workspaceRoot: fixture.workspaceRoot,
      windowId: WINDOW_ID,
      operationKind: "launch",
      expectedBindingId: binding.bindingId,
      expectedLocatorId: null,
    }, async () => {
      options.onFailure = () => {
        replacementFailureVerifierCalls += 1;
        return { disposition: "retain-for-recovery" };
      };
      throw new Error("expected callback failure");
    }, options),
    { code: "wakeflow-claude-locator-callback-failed" },
  );
  assert.equal(originalFailureVerifierCalls, 1);
  assert.equal(replacementFailureVerifierCalls, 0);

  let invalidatedOperation;
  const lockFile = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/hosts/claude-code/operations/window-locators",
    `${WINDOW_ID}.lock`,
  );
  await assert.rejects(
    withClaudeWindowOperationMutex({
      workspaceRoot: fixture.workspaceRoot,
      windowId: WINDOW_ID,
      operationKind: "launch",
      expectedBindingId: binding.bindingId,
      expectedLocatorId: null,
    }, async (operation) => {
      invalidatedOperation = operation;
      chmodSync(lockFile, 0o644);
    }),
    { code: "wakeflow-claude-locator-recovery-required" },
  );
  const locator = locatorFixture(binding.bindingId);
  await assert.rejects(
    commitClaudeWindowLocator({
      operation: invalidatedOperation,
      locator,
      observation: issuedObservation(locator, binding),
      expectedSocketName: null,
    }),
    { code: "wakeflow-claude-locator-operation-context" },
  );
});

test("M4-T07 corrupt, noncanonical, linked, wrong-mode and unknown locator storage fail closed", async (t) => {
  const scenarios = [
    {
      name: "corrupt JSON",
      mutate(file) { writeFileSync(file, "{\n", { mode: 0o600 }); },
      code: "wakeflow-claude-locator-storage",
    },
    {
      name: "noncanonical bytes",
      mutate(file) {
        const value = JSON.parse(readFileSync(file, "utf8"));
        writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      },
      code: "wakeflow-claude-locator-storage",
    },
    {
      name: "symbolic link",
      mutate(file) {
        const target = path.join(path.dirname(file), "..", "locator-symlink-target.json");
        writeFileSync(target, readFileSync(file), { mode: 0o600 });
        rmSync(file);
        symlinkSync(target, file);
      },
      code: "wakeflow-claude-locator-storage",
    },
    {
      name: "hard link",
      mutate(file) {
        const target = path.join(path.dirname(file), "..", "locator-hardlink-target.json");
        linkSync(file, target);
      },
      code: "wakeflow-claude-locator-storage",
    },
    {
      name: "wrong mode",
      mutate(file) { chmodSync(file, 0o644); },
      code: "wakeflow-claude-locator-storage",
    },
    {
      name: "oversized record",
      mutate(file) { writeFileSync(file, Buffer.alloc(65_537, 0x20), { mode: 0o600 }); },
      code: "wakeflow-claude-locator-storage",
    },
    {
      name: "unknown sibling",
      mutate(file) { writeFileSync(path.join(path.dirname(file), "surprise.tmp"), "x", { mode: 0o600 }); },
      code: "wakeflow-claude-locator-unknown",
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const fixture = createFixture(subtest);
      const binding = await registerFixtureBinding(fixture.workspaceRoot);
      const locator = locatorFixture(binding.bindingId);
      await withClaudeWindowOperationMutex({
        workspaceRoot: fixture.workspaceRoot,
        windowId: WINDOW_ID,
        operationKind: "launch",
        expectedBindingId: binding.bindingId,
        expectedLocatorId: null,
      }, async (operation) => commitClaudeWindowLocator({
        operation,
        locator,
        observation: issuedObservation(locator, binding),
        expectedSocketName: null,
      }));
      const file = path.join(
        fixture.workspaceRoot,
        ...claudeWindowLocatorRef({ windowId: WINDOW_ID }).split("/"),
      );
      scenario.mutate(file);
      assert.throws(
        () => inspectClaudeWindowLocatorInventory({ workspaceRoot: fixture.workspaceRoot }),
        { code: scenario.code },
      );
    });
  }
});

test("M4-T07 closes T01b locator ownership and exposes a live mutex as an active-operation blocker", async (t) => {
  const fixture = createFixture(t);
  const binding = await registerFixtureBinding(fixture.workspaceRoot);
  const locator = locatorFixture(binding.bindingId);
  await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationKind: "launch",
    expectedBindingId: binding.bindingId,
    expectedLocatorId: null,
  }, async (operation) => commitClaudeWindowLocator({
    operation,
    locator,
    observation: issuedObservation(locator, binding),
    expectedSocketName: null,
  }));
  const model = parseWakeflowConfigV3(fixture.config);
  const layoutDescriptor = createWakeflowLayoutDescriptor({ model, hostProfile: claudeProfile });
  const inspectLayout = () => inspectWakeflowLocalLayout({
    workspaceRoot: fixture.workspaceRoot,
    model,
    layoutDescriptor,
    hostProfile: claudeProfile,
  });
  let layout = inspectLayout();
  const locatorEvent = layout.items.events.find((event) => event.matchedKeys?.includes("event.host.locator"));
  assert.equal(locatorEvent.classification, "owner-validated");
  assert.match(locatorEvent.locatorDigest, /^sha256:[0-9a-f]{64}$/u);

  await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationKind: "readback",
    expectedBindingId: binding.bindingId,
    expectedLocatorId: locator.locatorId,
  }, async () => {
    layout = inspectLayout();
    const lockEvent = layout.items.events.find((event) => event.matchedKeys?.includes("event.host.locator-lock"));
    assert.equal(lockEvent.classification, "owner-validated-active-operation");
    assert.equal(layout.overall, "blocked");
    assert.equal(
      layout.blockers.some((blocker) => blocker.classification === "owner-validated-active-operation"),
      true,
    );
  });
  layout = inspectLayout();
  assert.equal(
    layout.items.events.some((event) => event.matchedKeys?.includes("event.host.locator-lock")),
    false,
  );
});

test("M4-T07/M7A capability and source graph keep locator ownership Claude-only behind lifecycle", () => {
  assert.deepEqual(claudeProfile.capabilities.locator, { applicable: true, realization: "current" });
  assert.deepEqual(codexProfile.capabilities.locator, { applicable: false, realization: "not-applicable" });
  const locatorSource = readFileSync(moduleFile, "utf8");
  for (const forbidden of [
    "wakeflow-claude-host.mjs",
    "wakeflow-host-send-adapter.mjs",
    "wakeflow-delivery-store.mjs",
    "wakeflow-thread-registry.mjs",
    "wakeflow-window-runtime.mjs",
  ]) {
    assert.equal(locatorSource.includes(forbidden), false, `locator owner must not import ${forbidden}`);
  }
  const facade = readFileSync(
    path.join(claudeRoot, "scripts/lib/wakeflow-claude-host.mjs"),
    "utf8",
  );
  const lifecycle = readFileSync(
    path.join(claudeRoot, "scripts/lib/wakeflow-claude-lifecycle.mjs"),
    "utf8",
  );
  assert.equal(facade.includes("wakeflow-claude-lifecycle.mjs"), true);
  assert.equal(facade.includes("wakeflow-claude-locator.mjs"), false);
  assert.equal(lifecycle.includes("wakeflow-claude-locator.mjs"), true);
});
