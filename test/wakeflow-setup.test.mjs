import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  WAKEFLOW_SETUP_STDIN_LIMIT,
  parseWakeflowSetupArgv,
  parseWakeflowSetupRequest,
  runWakeflowSetup,
  runWakeflowSetupStdin,
} from "../core/scripts/wakeflow-setup.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("public setup accepts only the exact JSON stdin invocation", () => {
  assert.deepEqual(
    parseWakeflowSetupArgv(["--request-stdin", "--json"]),
    { requestStdin: true, json: true },
  );
  for (const argv of [
    [],
    ["--json"],
    ["--request-stdin"],
    ["--request-stdin", "--json", "fresh-initialize"],
    ["init", "--json"],
  ]) {
    assert.throws(
      () => parseWakeflowSetupArgv(argv),
      (error) => error?.code === "wakeflow-setup-v3-invalid-argv",
    );
  }
});

test("public setup parses one bounded JSON object", () => {
  const request = {
    root: "/tmp/Wakeflow",
    action: "reconcile",
    mode: "preview",
    request: { language: "en", authorizedRepositoryIds: [] },
  };
  assert.deepEqual(parseWakeflowSetupRequest(JSON.stringify(request)), request);
  for (const raw of ["", "not-json", "[]", "null"]) {
    assert.throws(() => parseWakeflowSetupRequest(raw));
  }
  assert.throws(
    () => parseWakeflowSetupRequest(`${" ".repeat(WAKEFLOW_SETUP_STDIN_LIMIT)}x`),
    (error) => error?.code === "wakeflow-setup-v3-stdin-too-large",
  );
});

test("public setup delegates the exact request to the maintenance coordinator", async () => {
  const calls = [];
  const request = {
    root: "/tmp/Wakeflow",
    action: "reconcile",
    mode: "preview",
    request: { language: "en", authorizedRepositoryIds: [] },
  };
  const result = await runWakeflowSetup({
    argv: ["--request-stdin", "--json"],
    rawRequest: JSON.stringify(request),
    coordinator: {
      async execute(value) {
        calls.push(value);
        return { schemaVersion: 1, tool: "wakeflow_maintain_workspace", action: value.action, mode: value.mode, result: { status: "ready" } };
      },
    },
  });
  assert.deepEqual(calls, [request]);
  assert.equal(result.tool, "wakeflow_maintain_workspace");
  assert.equal(result.result.status, "ready");
});

test("public setup stdin emits one structured result", async () => {
  const request = {
    root: "/tmp/Wakeflow",
    action: "fresh-initialize",
    mode: "preview",
    request: {},
  };
  let stdout = "";
  const completed = await runWakeflowSetupStdin({
    argv: ["--request-stdin", "--json"],
    stdin: Readable.from([JSON.stringify(request)]),
    stdout: { write(chunk) { stdout += chunk; } },
    coordinator: {
      async execute() {
        return { schemaVersion: 1, tool: "wakeflow_maintain_workspace", action: "fresh-initialize", mode: "preview", result: { status: "ready" } };
      },
    },
  });
  assert.equal(completed.exitCode, 0);
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.tool, "wakeflow_maintain_workspace");
  assert.equal(payload.result.status, "ready");
});

test("public setup rejects invalid UTF-8 before coordinator dispatch", async () => {
  const malformed = Buffer.concat([
    Buffer.from('{"root":"/tmp/Wakeflow","action":"reconcile","mode":"preview","request":{"marker":"', "utf8"),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('"}}', "utf8"),
  ]);
  let called = false;
  let stdout = "";
  const completed = await runWakeflowSetupStdin({
    argv: ["--request-stdin", "--json"],
    stdin: Readable.from([malformed]),
    stdout: { write(chunk) { stdout += chunk; } },
    coordinator: {
      async execute() {
        called = true;
        return {};
      },
    },
  });
  assert.equal(completed.exitCode, 1);
  assert.equal(called, false);
  assert.equal(JSON.parse(stdout).error.code, "wakeflow-setup-v3-invalid-stdin");
  assert.equal(stdout.includes("�"), false);
});

test("public setup requires an own data-property coordinator method", async () => {
  const coordinator = Object.create({
    async execute() {
      return { inherited: true };
    },
  });
  await assert.rejects(
    runWakeflowSetup({
      argv: ["--request-stdin", "--json"],
      rawRequest: "{}",
      coordinator,
    }),
    (error) => error?.code === "wakeflow-setup-v3-invalid-coordinator",
  );

  let getterCalled = false;
  const accessorCoordinator = {};
  Object.defineProperty(accessorCoordinator, "execute", {
    enumerable: true,
    get() {
      getterCalled = true;
      return async () => ({ accessor: true });
    },
  });
  await assert.rejects(
    runWakeflowSetup({
      argv: ["--request-stdin", "--json"],
      rawRequest: "{}",
      coordinator: accessorCoordinator,
    }),
    (error) => error?.code === "wakeflow-setup-v3-invalid-coordinator",
  );
  assert.equal(getterCalled, false);
});

test("public setup failures are bounded and direct legacy argv stays disconnected", async () => {
  const privateRoot = "/tmp/private-wakeflow-root";
  let stdout = "";
  const completed = await runWakeflowSetupStdin({
    argv: ["--request-stdin", "--json"],
    stdin: Readable.from([JSON.stringify({ root: privateRoot })]),
    stdout: { write(chunk) { stdout += chunk; } },
    coordinator: {
      async execute() {
        const error = new Error(`${privateRoot}: private failure`);
        error.code = "wakeflow-maintenance-spoofed";
        throw error;
      },
    },
  });
  assert.equal(completed.exitCode, 1);
  assert.equal(JSON.parse(stdout).error.code, "wakeflow-setup-failed");
  assert.equal(stdout.includes(privateRoot), false);

  const script = path.join(repositoryRoot, "core/scripts/wakeflow-setup.mjs");
  const direct = spawnSync(process.execPath, [script, "init", "--json"], {
    encoding: "utf8",
    input: "",
    shell: false,
  });
  assert.equal(direct.status, 1);
  assert.equal(direct.stderr, "");
  assert.equal(JSON.parse(direct.stdout).error.code, "wakeflow-setup-v3-invalid-argv");
});
