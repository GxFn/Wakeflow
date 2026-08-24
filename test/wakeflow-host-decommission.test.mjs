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
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  createHostDecommissionResult,
  hostDecommissionResultToPodCloseObservation,
  validateHostDecommissionResult,
} from "../core/scripts/lib/wakeflow-host-decommission-result.mjs";
import {
  planCodexWindowDecommission,
  recordCodexWindowDecommissionObservation,
  validateCodexWindowDecommissionPlan,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-codex-decommission.mjs";
import {
  executeClaudeWindowDecommission,
  planClaudeWindowDecommission,
  recoverClaudeWindowDecommission,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-decommission.mjs";
import {
  claudeWindowLocatorRef,
  commitClaudeWindowLocator,
  createClaudeWindowLocatorRecord,
  inspectClaudeWindowLocatorInventory,
  inspectClaudeWindowLocatorObservation,
  withClaudeWindowOperationMutex,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-locator.mjs";
import {
  registerWindowBinding,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-window-binding-service.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreSchema = path.join(
  repositoryRoot,
  "core/schemas/wakeflow-window-identity/host-decommission-result.schema.json",
);
const coreModule = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-host-decommission-result.mjs",
);
const codexModule = path.join(
  repositoryRoot,
  "plugins/codex-wakeflow/scripts/lib/wakeflow-codex-decommission.mjs",
);
const claudeModule = path.join(
  repositoryRoot,
  "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-decommission.mjs",
);
const configFixture = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);

const PROGRAM_ID = "program_11111111-1111-4111-8111-111111111111";
const WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";
const HANDLE_ID = "10000000-0000-4000-8000-000000000001";
const LOCATOR_ID = "locator_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUBJECT_DIGEST = `sha256:${"c".repeat(64)}`;
const OBSERVED_AT = "2026-08-09T10:00:00.000Z";

const SHARED_EXPORTS = Object.freeze([
  "WAKEFLOW_HOST_DECOMMISSION_RESULT_KIND",
  "WAKEFLOW_HOST_DECOMMISSION_SCHEMA_VERSION",
  "WakeflowHostDecommissionResultError",
  "createHostDecommissionResult",
  "hostDecommissionResultCanonicalBytes",
  "hostDecommissionResultDigest",
  "hostDecommissionResultToPodCloseObservation",
  "validateHostDecommissionResult",
]);

const CODEX_EXPORTS = Object.freeze([
  "WAKEFLOW_CODEX_DECOMMISSION_HOST_ID",
  "WAKEFLOW_CODEX_DECOMMISSION_SCHEMA_VERSION",
  "WakeflowCodexDecommissionError",
  "planCodexWindowDecommission",
  "recordCodexWindowDecommissionObservation",
  "validateCodexWindowDecommissionPlan",
]);

const CLAUDE_EXPORTS = Object.freeze([
  "WAKEFLOW_CLAUDE_DECOMMISSION_HOST_ID",
  "WAKEFLOW_CLAUDE_DECOMMISSION_SCHEMA_VERSION",
  "WakeflowClaudeDecommissionError",
  "executeClaudeWindowDecommission",
  "planClaudeWindowDecommission",
  "recoverClaudeWindowDecommission",
  "validateClaudeWindowDecommissionPlan",
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

function createClaudeFixture(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-host-decommission-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspaceRoot = path.join(base, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  if (process.platform !== "win32") chmodSync(workspaceRoot, 0o700);
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    readFileSync(configFixture),
    { mode: 0o600 },
  );
  for (const ref of [
    ".wakeflow-local/runtime/maintenance/transactions",
    ".wakeflow-local/runtime/hosts/claude-code/identity/window-bindings",
    ".wakeflow-local/runtime/hosts/claude-code/operations/window-locators",
  ]) ensurePrivateDirectory(workspaceRoot, ref);
  return { workspaceRoot };
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

async function materializeClaudeEndpoint(t) {
  const fixture = createClaudeFixture(t);
  const binding = await registerWindowBinding({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    handle: { kind: "claude-session", value: HANDLE_ID },
  });
  const locator = createClaudeWindowLocatorRecord({
    programId: PROGRAM_ID,
    windowId: WINDOW_ID,
    bindingId: binding.bindingId,
    locatorId: LOCATOR_ID,
    tmux: {
      socketName: null,
      sessionName: "wakeflow",
      windowId: "@1",
      paneId: "%1",
    },
    locatedAt: "2026-08-09T09:00:00.000Z",
  });
  await withClaudeWindowOperationMutex({
    workspaceRoot: fixture.workspaceRoot,
    windowId: WINDOW_ID,
    operationKind: "launch",
    expectedBindingId: binding.bindingId,
    expectedLocatorId: null,
  }, async (operation) => commitClaudeWindowLocator({
    operation,
    locator,
    observation: inspectClaudeWindowLocatorObservation({
      locator,
      binding: bindingTuple(binding),
      expectedSocketName: null,
      observations: [liveObservation(locator)],
    }),
    expectedSocketName: null,
  }));
  const plan = planClaudeWindowDecommission({
    programId: PROGRAM_ID,
    windowId: WINDOW_ID,
    binding: {
      bindingId: binding.bindingId,
      digest: binding.identityBindingDigest,
    },
    locator,
    subjectDigest: SUBJECT_DIGEST,
    expectedSocketName: null,
    expectedSessionName: "wakeflow",
    postCloseAttemptLimit: 2,
  });
  return { ...fixture, binding, locator, plan };
}

function identityRef() {
  return `.wakeflow-local/runtime/hosts/claude-code/identity/window-bindings/${WINDOW_ID}.json`;
}

test("M4-T12 exposes one shared proof result and two asymmetric host decommission owners", async () => {
  await Promise.all([
    access(coreSchema),
    access(coreModule),
    access(codexModule),
    access(claudeModule),
  ]);
  const [shared, codex, claude] = await Promise.all([
    import(pathToFileURL(coreModule).href),
    import(pathToFileURL(codexModule).href),
    import(pathToFileURL(claudeModule).href),
  ]);
  assert.deepEqual(Object.keys(shared).sort(), [...SHARED_EXPORTS].sort());
  assert.deepEqual(Object.keys(codex).sort(), [...CODEX_EXPORTS].sort());
  assert.deepEqual(Object.keys(claude).sort(), [...CLAUDE_EXPORTS].sort());
});

test("M4-T12 Codex archive remains a manual gate and cannot be upgraded into machine proof", () => {
  const binding = {
    bindingId: "binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    digest: `sha256:${"a".repeat(64)}`,
  };
  const plan = planCodexWindowDecommission({
    programId: PROGRAM_ID,
    windowId: WINDOW_ID,
    binding,
    subjectDigest: SUBJECT_DIGEST,
  });
  assert.equal(plan.hostOperation.tool, "set_thread_archived");
  assert.equal(plan.machineVerificationAvailable, false);
  assert.equal(plan.requiresManualHostGate, true);
  assert.throws(
    () => validateCodexWindowDecommissionPlan({
      ...plan,
      machineVerificationAvailable: true,
    }),
    /machine|stale|modified|verification/iu,
  );
  const result = recordCodexWindowDecommissionObservation({
    plan,
    observation: { status: "archived", observedAt: OBSERVED_AT },
  });
  assert.equal(result.status, "manual-host-gate");
  assert.equal(result.session.status, "archived");
  assert.equal(result.session.proof, "archive-observed");
  assert.equal(result.routingRevocation, "pending-state-acknowledgement");
  assert.equal(result.manualAction.required, true);
  assert.equal(Object.isFrozen(result), true);
  const observation = hostDecommissionResultToPodCloseObservation(result, {
    worktreeStatus: "not-applicable",
  });
  assert.equal(observation.kind, "host-result");
  assert.equal(observation.hostResult.status, "manual-host-gate");
  assert.throws(
    () => validateHostDecommissionResult({ ...result, rawThreadId: HANDLE_ID }),
    /unknown|field|contract/iu,
  );
  assert.throws(
    () => validateHostDecommissionResult({
      ...result,
      status: "machine-verified",
      manualAction: null,
      reasonCode: null,
      hostAction: { kind: "close", status: "succeeded" },
      session: {
        status: "closed",
        proof: "exact-post-close-absence",
        postCloseAttempts: 1,
      },
    }),
    /Claude|machine|proof|locator/iu,
  );

  const payload = Object.fromEntries(
    Object.entries(result).filter(([key]) => !new Set(["kind", "schemaVersion"]).has(key)),
  );
  let getterCalls = 0;
  Object.defineProperty(payload, "programId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return PROGRAM_ID;
    },
  });
  assert.throws(
    () => createHostDecommissionResult(payload),
    (error) => error?.code === "wakeflow-host-decommission-contract",
  );
  assert.equal(getterCalls, 0);

  let optionGetterCalls = 0;
  const options = {};
  Object.defineProperty(options, "worktreeStatus", {
    enumerable: true,
    get() {
      optionGetterCalls += 1;
      return "not-applicable";
    },
  });
  assert.throws(
    () => hostDecommissionResultToPodCloseObservation(result, options),
    (error) => error?.code === "wakeflow-host-decommission-contract",
  );
  assert.equal(optionGetterCalls, 0);
  assert.throws(
    () => hostDecommissionResultToPodCloseObservation(result, {
      worktreeStatus: "not-applicable",
      acknowledgement: true,
    }),
    (error) => error?.code === "wakeflow-host-decommission-contract",
  );

  assert.throws(
    () => validateHostDecommissionResult({
      ...result,
      reasonCode: "codex-archive-unavailable",
    }),
    (error) => error?.code === "wakeflow-host-decommission-manual",
  );
  assert.throws(
    () => validateHostDecommissionResult({
      ...result,
      observedAt: "2026-02-31T10:00:00.000Z",
    }),
    (error) => error?.code === "wakeflow-host-decommission-time",
  );
  assert.throws(
    () => recordCodexWindowDecommissionObservation({
      plan,
      observation: {
        status: "archived",
        observedAt: "2026-02-31T10:00:00.000Z",
      },
    }),
    (error) => error?.code === "wakeflow-codex-decommission-time",
  );
});

test("M4-T12 Claude exact close is machine-verified only after bounded absence and retains identity plus locator", async (t) => {
  const fixture = await materializeClaudeEndpoint(t);
  let closeCalls = 0;
  const result = await executeClaudeWindowDecommission({
    workspaceRoot: fixture.workspaceRoot,
    plan: fixture.plan,
  }, {
    inspect: async ({ phase }) => phase === "pre-close"
      ? [liveObservation(fixture.locator)]
      : [],
    close: async () => {
      closeCalls += 1;
      return { status: "succeeded" };
    },
    clock: () => OBSERVED_AT,
  });
  assert.equal(closeCalls, 1);
  assert.equal(result.status, "machine-verified");
  assert.equal(result.hostAction.status, "succeeded");
  assert.equal(result.session.status, "closed");
  assert.equal(result.session.proof, "exact-post-close-absence");
  assert.equal(result.session.postCloseAttempts, 1);
  assert.equal(result.locator.locatorId, LOCATOR_ID);
  assert.equal(result.locatorDisposition, "retained-for-acknowledgement");
  assert.equal(result.routingRevocation, "pending-state-acknowledgement");
  assert.equal(JSON.stringify(result).includes(HANDLE_ID), false);
  assert.equal(JSON.stringify(result).includes("@1"), false);
  assert.equal(JSON.stringify(result).includes("%1"), false);
  assert.equal(existsSync(path.join(fixture.workspaceRoot, identityRef())), true);
  assert.equal(existsSync(path.join(
    fixture.workspaceRoot,
    claudeWindowLocatorRef({ windowId: WINDOW_ID }),
  )), true);
  const inventory = inspectClaudeWindowLocatorInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.equal(inventory.windows[0].operation, null);
  assert.equal(inventory.windows[0].locator.locatorId, LOCATOR_ID);

  const schema = JSON.parse(readFileSync(coreSchema, "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  const impossibleCodexMachine = { ...result, hostId: "codex", locator: null };
  assert.equal(validate(impossibleCodexMachine), false);

  const falsePreclose = {
    ...result,
    status: "blocked",
    hostAction: { kind: "close", status: "succeeded" },
    session: { status: "unknown", proof: "none", postCloseAttempts: 1 },
    reasonCode: "claude-preclose-not-live",
  };
  assert.throws(
    () => validateHostDecommissionResult(falsePreclose),
    (error) => error?.code === "wakeflow-host-decommission-blocked",
  );
  assert.equal(validate(falsePreclose), false);
});

test("M4-T12 Claude still-present close is blocked and never becomes a receipt proof", async (t) => {
  const fixture = await materializeClaudeEndpoint(t);
  const result = await executeClaudeWindowDecommission({
    workspaceRoot: fixture.workspaceRoot,
    plan: fixture.plan,
  }, {
    inspect: async () => [liveObservation(fixture.locator)],
    close: async () => ({ status: "succeeded" }),
    clock: () => OBSERVED_AT,
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "claude-postclose-still-present");
  assert.equal(result.session.status, "still-live");
  assert.equal(result.session.proof, "none");
  assert.equal(result.session.postCloseAttempts, 2);
  assert.equal(inspectClaudeWindowLocatorInventory({
    workspaceRoot: fixture.workspaceRoot,
  }).windows[0].operation, null);
  assert.equal(existsSync(path.join(fixture.workspaceRoot, identityRef())), true);
});

test("M4-T12 Claude snapshots host callbacks and rejects behavioral observation arrays", async (t) => {
  const fixture = await materializeClaudeEndpoint(t);
  let originalCloseCalls = 0;
  let replacementCloseCalls = 0;
  const adapters = {
    inspect: async ({ phase }) => {
      if (phase === "pre-close") {
        adapters.close = async () => {
          replacementCloseCalls += 1;
          return { status: "failed" };
        };
        return [liveObservation(fixture.locator)];
      }
      return [];
    },
    close: async () => {
      originalCloseCalls += 1;
      return { status: "succeeded" };
    },
    clock: () => OBSERVED_AT,
  };
  const result = await executeClaudeWindowDecommission({
    workspaceRoot: fixture.workspaceRoot,
    plan: fixture.plan,
  }, adapters);
  assert.equal(originalCloseCalls, 1);
  assert.equal(replacementCloseCalls, 0);
  assert.equal(result.status, "machine-verified");

  const second = await materializeClaudeEndpoint(t);
  let getterCalls = 0;
  let closeCalls = 0;
  const observations = new Array(1);
  Object.defineProperty(observations, "0", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return liveObservation(second.locator);
    },
  });
  const blocked = await executeClaudeWindowDecommission({
    workspaceRoot: second.workspaceRoot,
    plan: second.plan,
  }, {
    inspect: async () => observations,
    close: async () => {
      closeCalls += 1;
      return { status: "succeeded" };
    },
    clock: () => OBSERVED_AT,
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reasonCode, "claude-preclose-not-live");
  assert.equal(getterCalls, 0);
  assert.equal(closeCalls, 0);

  await assert.rejects(
    executeClaudeWindowDecommission({
      workspaceRoot: second.workspaceRoot,
      plan: second.plan,
    }, {
      inspect: async () => [],
      close: async () => ({ status: "succeeded" }),
      clock: () => "2026-02-31T10:00:00.000Z",
    }),
    (error) => {
      for (let current = error; current; current = current.cause) {
        if (current.code === "wakeflow-claude-decommission-time") return true;
      }
      return false;
    },
  );
});

test("M4-T12 Claude ambiguous post-effect observation retains the exact mutex until explicit recovery", async (t) => {
  const fixture = await materializeClaudeEndpoint(t);
  await assert.rejects(
    executeClaudeWindowDecommission({
      workspaceRoot: fixture.workspaceRoot,
      plan: fixture.plan,
    }, {
      inspect: async ({ phase }) => phase === "pre-close"
        ? [liveObservation(fixture.locator)]
        : [liveObservation(fixture.locator), liveObservation(fixture.locator)],
      close: async () => ({ status: "succeeded" }),
      clock: () => OBSERVED_AT,
    }),
    /recovery|mutex|operation|observation/iu,
  );
  let inventory = inspectClaudeWindowLocatorInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.equal(inventory.windows[0].operation.status, "active");
  const operationId = inventory.windows[0].operation.operationId;
  const recoveryInput = {
    workspaceRoot: fixture.workspaceRoot,
    plan: fixture.plan,
    operationId,
  };
  const recovery = await recoverClaudeWindowDecommission(recoveryInput, {
    inspect: async () => {
      recoveryInput.operationId = "mutated-after-admission";
      return [];
    },
    clock: () => OBSERVED_AT,
  });
  assert.equal(recovery.status, "released-without-machine-proof");
  assert.equal(recovery.operationId, operationId);
  assert.equal(recovery.result.status, "blocked");
  assert.equal(recovery.result.reasonCode, "claude-close-outcome-unrecoverable");
  inventory = inspectClaudeWindowLocatorInventory({ workspaceRoot: fixture.workspaceRoot });
  assert.equal(inventory.windows[0].operation, null);
  assert.equal(inventory.windows[0].locator.locatorId, LOCATOR_ID);
  assert.equal(existsSync(path.join(fixture.workspaceRoot, identityRef())), true);
});
