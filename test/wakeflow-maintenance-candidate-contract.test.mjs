import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { tools as publicTools } from "../core/lib/wakeflow-mcp-tools.mjs";
import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  WAKEFLOW_MAINTENANCE_ACTIONS,
  WAKEFLOW_MAINTENANCE_MODES,
  WAKEFLOW_MAINTENANCE_TOOL_NAME,
  WakeflowMaintenanceCoordinatorError,
  createWakeflowMaintenanceCoordinator,
  validateWakeflowMaintenanceRequest,
} from "../core/scripts/lib/wakeflow-maintenance-coordinator.mjs";
import {
  WAKEFLOW_SETUP_STDIN_LIMIT,
  parseWakeflowSetupArgv,
  parseWakeflowSetupRequest,
  runWakeflowSetup,
  runWakeflowSetupStdin,
} from "../core/scripts/wakeflow-setup.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.join(os.tmpdir(), "wakeflow-maintenance-public-workspace");
const operationId = "workspace-mutation_11111111-1111-4111-8111-111111111111";

function testPlan(action) {
  return {
    schemaId: "urn:wakeflow:internal:test-maintenance-plan:v1",
    payload: { action, steps: [] },
  };
}

function handlerFixture({
  validatorVerdict = { valid: true },
  throwFrom = null,
  throwCoordinatorError = false,
} = {}) {
  const calls = [];
  function throwPrivateFailure(action, callback) {
    if (throwFrom !== `${action}:${callback}`) return;
    if (throwCoordinatorError) {
      throw new WakeflowMaintenanceCoordinatorError(
        "wakeflow-maintenance-private-owner-failure",
        `${workspaceRoot}: private failure`,
      );
    }
    throw new Error(`${workspaceRoot}: private failure`);
  }
  const actionHandlers = Object.fromEntries(
    WAKEFLOW_MAINTENANCE_ACTIONS.map((action) => [
      action,
      {
        async validatePreviewRequest(input) {
          calls.push({ action, callback: "validatePreviewRequest", input });
          throwPrivateFailure(action, "validatePreviewRequest");
          return validatorVerdict;
        },
        async validateConfirmedPlan(input) {
          calls.push({ action, callback: "validateConfirmedPlan", input });
          throwPrivateFailure(action, "validateConfirmedPlan");
          return validatorVerdict;
        },
        async preview(input) {
          calls.push({ action, callback: "preview", input });
          throwPrivateFailure(action, "preview");
          return { status: "planned", action, mode: "preview" };
        },
        async apply(input) {
          calls.push({ action, callback: "apply", input });
          throwPrivateFailure(action, "apply");
          return { status: "applied", action, mode: "apply" };
        },
        async recover(input) {
          calls.push({ action, callback: "recover", input });
          throwPrivateFailure(action, "recover");
          return { status: "recovered", action, mode: "recover" };
        },
      },
    ]),
  );
  return {
    calls,
    coordinator: createWakeflowMaintenanceCoordinator({ actionHandlers }),
  };
}

function requestFor(action, mode) {
  if (mode === "preview") {
    return { root: workspaceRoot, action, mode, request: { marker: action } };
  }
  const confirmedPlan = testPlan(action);
  const shared = {
    root: workspaceRoot,
    action,
    mode,
    confirmedPlan,
    planDigest: canonicalJsonDigest(confirmedPlan),
  };
  return mode === "recover" ? { ...shared, operationId } : shared;
}

async function rejectedCode(callback, code) {
  await assert.rejects(callback, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

test("public contract freezes the confirmed tool name, admitted actions, and modes", () => {
  assert.equal(WAKEFLOW_MAINTENANCE_TOOL_NAME, "wakeflow_maintain_workspace");
  assert.deepEqual(WAKEFLOW_MAINTENANCE_ACTIONS, [
    "fresh-initialize",
    "reconfigure",
    "reconcile",
  ]);
  assert.deepEqual(WAKEFLOW_MAINTENANCE_MODES, ["preview", "apply", "recover"]);
  assert.equal(Object.isFrozen(WAKEFLOW_MAINTENANCE_ACTIONS), true);
  assert.equal(Object.isFrozen(WAKEFLOW_MAINTENANCE_MODES), true);
  assert.equal(WAKEFLOW_MAINTENANCE_ACTIONS.includes("explicit-migration"), false);
  for (const alias of ["initialize", "reset", "repair", "refresh", "migrate"]) {
    assert.equal(WAKEFLOW_MAINTENANCE_ACTIONS.includes(alias), false);
  }
});

test("all public action and mode pairs use only their action-specific validator and callback", async () => {
  const fixture = handlerFixture();
  for (const action of WAKEFLOW_MAINTENANCE_ACTIONS) {
    for (const mode of WAKEFLOW_MAINTENANCE_MODES) {
      const before = fixture.calls.length;
      const request = requestFor(action, mode);
      const result = await fixture.coordinator.execute(request);
      assert.equal(result.tool, "wakeflow_maintain_workspace");
      assert.equal(Object.hasOwn(result, "candidate"), false);
      assert.equal(result.action, action);
      assert.equal(result.mode, mode);
      assert.equal(result.result.action, action);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.isFrozen(result.result), true);
      const selected = fixture.calls.slice(before);
      assert.equal(selected.length, 2);
      assert.equal(selected[0].action, action);
      assert.equal(
        selected[0].callback,
        mode === "preview" ? "validatePreviewRequest" : "validateConfirmedPlan",
      );
      assert.equal(selected[1].action, action);
      assert.equal(selected[1].callback, mode);
      if (mode === "preview") {
        assert.deepEqual(Object.keys(selected[1].input).sort(), ["request", "root"]);
      } else if (mode === "apply") {
        assert.deepEqual(Object.keys(selected[1].input).sort(), [
          "confirmedPlan",
          "planDigest",
          "root",
        ]);
      } else {
        assert.deepEqual(Object.keys(selected[1].input).sort(), [
          "confirmedPlan",
          "operationId",
          "planDigest",
          "root",
        ]);
      }
    }
  }
});

test("closed top-level mode branches reject aliases, migration placeholders, cross-fields, and stale digests before owner callbacks", async () => {
  const fixture = handlerFixture();
  const plan = testPlan("reconcile");
  const digest = canonicalJsonDigest(plan);
  const invalid = [
    { code: "wakeflow-maintenance-invalid-action", value: { root: workspaceRoot, mode: "preview", request: {} } },
    { code: "wakeflow-maintenance-invalid-action", value: { ...requestFor("reconcile", "preview"), action: "reset" } },
    { code: "wakeflow-maintenance-invalid-action", value: { ...requestFor("reconcile", "preview"), action: "explicit-migration" } },
    { code: "wakeflow-maintenance-invalid-mode", value: { root: workspaceRoot, action: "reconcile", request: {} } },
    { code: "wakeflow-maintenance-invalid-mode", value: { ...requestFor("reconcile", "preview"), mode: "dry-run" } },
    { code: "wakeflow-maintenance-invalid-root", value: { ...requestFor("reconcile", "preview"), root: "relative/root" } },
    { code: "wakeflow-maintenance-invalid-contract", value: { ...requestFor("reconcile", "preview"), apply: true } },
    { code: "wakeflow-maintenance-invalid-contract", value: { ...requestFor("reconcile", "preview"), planDigest: digest } },
    { code: "wakeflow-maintenance-invalid-contract", value: { ...requestFor("reconcile", "apply"), request: {} } },
    { code: "wakeflow-maintenance-invalid-contract", value: { ...requestFor("reconcile", "recover"), request: {} } },
    { code: "wakeflow-maintenance-invalid-contract", value: { ...requestFor("reconcile", "apply"), operationId } },
    { code: "wakeflow-maintenance-plan-digest-mismatch", value: { ...requestFor("reconcile", "apply"), planDigest: `sha256:${"f".repeat(64)}` } },
    { code: "wakeflow-maintenance-invalid-operation-id", value: { root: workspaceRoot, action: "reconcile", mode: "recover", operationId: "semantic-title", confirmedPlan: plan, planDigest: digest } },
  ];
  for (const entry of invalid) {
    await rejectedCode(() => fixture.coordinator.execute(entry.value), entry.code);
  }
  assert.deepEqual(fixture.calls, []);
});

test("maintenance request admission rejects hidden and symbol-keyed top-level authority", () => {
  const hidden = requestFor("reconcile", "preview");
  Object.defineProperty(hidden, "hiddenAuthority", {
    value: true,
    enumerable: false,
  });
  assert.throws(
    () => validateWakeflowMaintenanceRequest(hidden),
    (error) => error?.code === "wakeflow-maintenance-invalid-contract",
  );

  const symbolKeyed = requestFor("reconcile", "preview");
  symbolKeyed[Symbol("hidden-authority")] = true;
  assert.throws(
    () => validateWakeflowMaintenanceRequest(symbolKeyed),
    (error) => error?.code === "wakeflow-maintenance-invalid-contract",
  );
});

test("maintenance request admission rejects an action accessor without invoking it", () => {
  let getterCalls = 0;
  const request = requestFor("reconcile", "preview");
  Object.defineProperty(request, "action", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      return "reconcile";
    },
  });
  assert.throws(
    () => validateWakeflowMaintenanceRequest(request),
    (error) => error?.code === "wakeflow-maintenance-invalid-contract",
  );
  assert.equal(getterCalls, 0);
});

test("coordinator construction rejects action-registry accessors without invoking them", () => {
  let getterCalls = 0;
  const handler = {
    validatePreviewRequest: async () => ({ valid: true }),
    validateConfirmedPlan: async () => ({ valid: true }),
    preview: async () => ({}),
    apply: async () => ({}),
    recover: async () => ({}),
  };
  const actionHandlers = {
    "fresh-initialize": handler,
    reconfigure: handler,
  };
  Object.defineProperty(actionHandlers, "reconcile", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return handler;
    },
  });
  assert.throws(
    () => createWakeflowMaintenanceCoordinator({ actionHandlers }),
    (error) => error?.code === "wakeflow-maintenance-invalid-contract",
  );
  assert.equal(getterCalls, 0);
});

test("coordinator construction rejects handler-method accessors without invoking them", () => {
  let getterCalls = 0;
  const accessorHandler = {
    validatePreviewRequest: async () => ({ valid: true }),
    validateConfirmedPlan: async () => ({ valid: true }),
    apply: async () => ({}),
    recover: async () => ({}),
  };
  Object.defineProperty(accessorHandler, "preview", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return async () => ({});
    },
  });
  const plainHandler = {
    validatePreviewRequest: async () => ({ valid: true }),
    validateConfirmedPlan: async () => ({ valid: true }),
    preview: async () => ({}),
    apply: async () => ({}),
    recover: async () => ({}),
  };
  assert.throws(
    () => createWakeflowMaintenanceCoordinator({
      actionHandlers: {
        "fresh-initialize": accessorHandler,
        reconfigure: plainHandler,
        reconcile: plainHandler,
      },
    }),
    (error) => error?.code === "wakeflow-maintenance-invalid-contract",
  );
  assert.equal(getterCalls, 0);
});

test("action validator verdict rejects an accessor without invoking it", async () => {
  let getterCalls = 0;
  const verdict = {};
  Object.defineProperty(verdict, "valid", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return true;
    },
  });
  const fixture = handlerFixture({ validatorVerdict: verdict });
  await rejectedCode(
    () => fixture.coordinator.execute(requestFor("fresh-initialize", "preview")),
    "wakeflow-maintenance-invalid-action-validator",
  );
  assert.equal(getterCalls, 0);
  assert.deepEqual(
    fixture.calls.map((call) => call.callback),
    ["validatePreviewRequest"],
  );
});

test("action validators are mandatory exact gates and a rejected validator cannot reach an action callback", async () => {
  const fixture = handlerFixture({ validatorVerdict: { valid: true, extra: true } });
  await rejectedCode(
    () => fixture.coordinator.execute(requestFor("fresh-initialize", "preview")),
    "wakeflow-maintenance-invalid-action-validator",
  );
  assert.deepEqual(
    fixture.calls.map((call) => call.callback),
    ["validatePreviewRequest"],
  );

  assert.throws(
    () => createWakeflowMaintenanceCoordinator({
      actionHandlers: {
        "fresh-initialize": {},
        reconfigure: {},
        reconcile: {},
      },
    }),
    (error) => error?.code === "wakeflow-maintenance-invalid-contract"
      || error?.code === "wakeflow-maintenance-invalid-action-handler",
  );
});

test("structural validation returns a frozen canonical clone and never treats a digest as authorization", () => {
  const request = requestFor("reconfigure", "apply");
  const normalized = validateWakeflowMaintenanceRequest(request);
  assert.notEqual(normalized, request);
  assert.notEqual(normalized.confirmedPlan, request.confirmedPlan);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.confirmedPlan), true);
  request.confirmedPlan.payload.action = "changed-after-validation";
  assert.equal(normalized.confirmedPlan.payload.action, "reconfigure");
});

test("public setup accepts only the exact stdin JSON invocation and emits one structured JSON result", async () => {
  const fixture = handlerFixture();
  assert.deepEqual(
    parseWakeflowSetupArgv(["--request-stdin", "--json"]),
    { requestStdin: true, json: true },
  );
  for (const argv of [[], ["--json"], ["--request-stdin"], ["--json", "--json"], ["--request-stdin", "--json", "--root", workspaceRoot]]) {
    assert.throws(
      () => parseWakeflowSetupArgv(argv),
      (error) => error?.code === "wakeflow-setup-v3-invalid-argv",
    );
  }

  const request = requestFor("reconcile", "preview");
  assert.deepEqual(parseWakeflowSetupRequest(JSON.stringify(request)), request);
  const direct = await runWakeflowSetup({
    argv: ["--request-stdin", "--json"],
    rawRequest: JSON.stringify(request),
    coordinator: fixture.coordinator,
  });
  assert.equal(direct.action, "reconcile");

  let stdout = "";
  const streamed = await runWakeflowSetupStdin({
    argv: ["--request-stdin", "--json"],
    stdin: Readable.from([JSON.stringify(request)]),
    stdout: { write(chunk) { stdout += chunk; } },
    coordinator: fixture.coordinator,
  });
  assert.equal(streamed.exitCode, 0);
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.tool, "wakeflow_maintain_workspace");
  assert.equal(payload.action, "reconcile");
  assert.equal(payload.mode, "preview");
  assert.equal(stdout.trim().split("\n").filter((line) => line === "{").length, 1);
});

test("public setup failures remain bounded and do not echo private roots", async () => {
  const fixture = handlerFixture({
    throwFrom: "reconcile:preview",
    throwCoordinatorError: true,
  });
  for (const raw of ["", "not-json", "[]", `${" ".repeat(WAKEFLOW_SETUP_STDIN_LIMIT)}x`]) {
    assert.throws(() => parseWakeflowSetupRequest(raw));
  }

  let stdout = "";
  const failed = await runWakeflowSetupStdin({
    argv: ["--request-stdin", "--json"],
    stdin: Readable.from([JSON.stringify(requestFor("reconcile", "preview"))]),
    stdout: { write(chunk) { stdout += chunk; } },
    coordinator: fixture.coordinator,
  });
  assert.equal(failed.exitCode, 1);
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "wakeflow-maintenance-action-failed");
  assert.equal(stdout.includes(workspaceRoot), false);
});

test("source-tree direct public setup fails closed without an installed artifact bundle", () => {
  const script = path.join(repositoryRoot, "core/scripts/wakeflow-setup.mjs");
  const result = spawnSync(
    process.execPath,
    [script, "--request-stdin", "--json"],
    {
      encoding: "utf8",
      input: JSON.stringify(requestFor("fresh-initialize", "preview")),
      shell: false,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "wakeflow-maintenance-runtime-bundle");
  assert.equal(result.stdout.includes(workspaceRoot), false);
});

test("public v3 is the normal surface and removed candidate entrypoints stay absent", () => {
  const publicNames = publicTools.map((tool) => tool.name);
  assert.equal(publicNames.length, 31);
  assert.equal(publicNames[1], "wakeflow_maintain_workspace");
  assert.equal(publicNames.includes("wakeflow_initialize_workspace"), false);

  const candidateBasenames = [
    "wakeflow-mcp-tools-v3-candidate.mjs",
    "wakeflow-maintenance-action-runtime.mjs",
    "wakeflow-maintenance-coordinator.mjs",
    "wakeflow-setup-v3-candidate.mjs",
  ];
  for (const relative of [
    "core/lib/wakeflow-mcp-tools-v3-candidate.mjs",
    "core/scripts/wakeflow-setup-v3-candidate.mjs",
    "core/scripts/wakeflow-smoke-v3-candidate.mjs",
    "core/scripts/wakeflow-validate-v3-candidate.mjs",
  ]) assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);
  const publicFiles = [
    "core/lib/wakeflow-mcp-tools.mjs",
    "core/mcp/server.cjs",
    "core/scripts/wakeflow-cli.mjs",
    "core/scripts/wakeflow-setup.mjs",
  ];
  for (const relative of publicFiles) {
    const source = readFileSync(path.join(repositoryRoot, relative), "utf8");
    for (const basename of candidateBasenames.filter((basename) => basename.includes("candidate"))) {
      assert.equal(source.includes(basename), false, `${relative} must not import ${basename}`);
    }
  }

  const coordinatorSource = readFileSync(
    path.join(repositoryRoot, "core/scripts/lib/wakeflow-maintenance-coordinator.mjs"),
    "utf8",
  );
  assert.equal(coordinatorSource.includes("wakeflow-workspace-mutation.mjs"), false);
  assert.equal(coordinatorSource.includes("repairWorkspace"), false);
});

test("coordinator construction rejects missing or extra action branches", () => {
  const fixture = handlerFixture();
  const complete = Object.fromEntries(
    WAKEFLOW_MAINTENANCE_ACTIONS.map((action) => [
      action,
      {
        validatePreviewRequest: async () => ({ valid: true }),
        validateConfirmedPlan: async () => ({ valid: true }),
        preview: async () => ({}),
        apply: async () => ({}),
        recover: async () => ({}),
      },
    ]),
  );
  assert.ok(fixture.coordinator);
  assert.throws(
    () => createWakeflowMaintenanceCoordinator({
      actionHandlers: { ...complete, reconcile: undefined },
    }),
    WakeflowMaintenanceCoordinatorError,
  );
  assert.throws(
    () => createWakeflowMaintenanceCoordinator({
      actionHandlers: { ...complete, "explicit-migration": complete.reconcile },
    }),
    WakeflowMaintenanceCoordinatorError,
  );
});
