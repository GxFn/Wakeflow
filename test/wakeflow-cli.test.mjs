import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { handlers, tools } from "../core/lib/wakeflow-mcp-tools.mjs";
import {
  WAKEFLOW_CLI_STDIN_LIMIT,
  parseWakeflowCliArgv,
  parseWakeflowCliRequest,
  runWakeflowCli,
  runWakeflowCliStdin,
} from "../core/scripts/wakeflow-cli.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicToolNames = Object.freeze(tools.map((tool) => tool.name));

test("public CLI accepts only the exact JSON stdin invocation", () => {
  assert.deepEqual(
    parseWakeflowCliArgv(["--request-stdin", "--json"]),
    { requestStdin: true, json: true },
  );
  for (const argv of [
    [],
    ["--json"],
    ["--request-stdin"],
    ["--json", "--json"],
    ["--request-stdin", "--json", "status"],
    ["--print", "status"],
  ]) {
    assert.throws(
      () => parseWakeflowCliArgv(argv),
      (error) => error?.code === "wakeflow-cli-invalid-argv",
    );
  }
});

test("public CLI request selects one exact 31-tool handler and freezes its arguments", async () => {
  assert.equal(publicToolNames.length, 31);
  const parsed = parseWakeflowCliRequest(JSON.stringify({
    tool: "wakeflow_verify",
    arguments: { root: "/tmp/Wakeflow", operation: "inspect", request: {} },
  }));
  assert.equal(parsed.tool, "wakeflow_verify");
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.arguments), true);
  assert.equal(Object.isFrozen(parsed.arguments.request), true);

  const calls = [];
  const result = await runWakeflowCli({
    argv: ["--request-stdin", "--json"],
    rawRequest: JSON.stringify({ tool: "wakeflow_verify", arguments: { marker: "exact" } }),
    toolHandlers: {
      wakeflow_verify: async (argumentsValue) => {
        calls.push(argumentsValue);
        return { verified: true };
      },
    },
  });
  assert.deepEqual(result, { verified: true });
  assert.deepEqual(calls, [{ marker: "exact" }]);
  assert.equal(Object.isFrozen(calls[0]), true);
});

test("public CLI rejects aliases, unknown fields, unknown tools, and oversized input", () => {
  for (const raw of [
    "",
    "not-json",
    "[]",
    JSON.stringify({ command: "status", arguments: {} }),
    JSON.stringify({ tool: "status", arguments: {} }),
    JSON.stringify({ tool: "wakeflow_status", arguments: {}, root: "/tmp/private" }),
  ]) {
    assert.throws(() => parseWakeflowCliRequest(raw));
  }
  assert.throws(
    () => parseWakeflowCliRequest(`${" ".repeat(WAKEFLOW_CLI_STDIN_LIMIT)}x`),
    (error) => error?.code === "wakeflow-cli-stdin-too-large",
  );
});

test("public CLI stdin writes one structured success result", async () => {
  let stdout = "";
  const completed = await runWakeflowCliStdin({
    argv: ["--request-stdin", "--json"],
    stdin: Readable.from([JSON.stringify({
      tool: "wakeflow_next_work",
      arguments: { marker: "portable" },
    })]),
    stdout: { write(chunk) { stdout += chunk; } },
    toolHandlers: {
      wakeflow_next_work: async (argumentsValue) => ({ marker: argumentsValue.marker }),
    },
  });
  assert.equal(completed.exitCode, 0);
  assert.deepEqual(JSON.parse(stdout), {
    ok: true,
    result: { marker: "portable" },
  });
});

test("public CLI rejects invalid UTF-8 before handler dispatch", async () => {
  const malformed = Buffer.concat([
    Buffer.from('{"tool":"wakeflow_status","arguments":{"marker":"', "utf8"),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('"}}', "utf8"),
  ]);
  let called = false;
  let stdout = "";
  const completed = await runWakeflowCliStdin({
    argv: ["--request-stdin", "--json"],
    stdin: Readable.from([malformed]),
    stdout: { write(chunk) { stdout += chunk; } },
    toolHandlers: {
      wakeflow_status: async () => {
        called = true;
        return {};
      },
    },
  });
  assert.equal(completed.exitCode, 1);
  assert.equal(called, false);
  assert.equal(JSON.parse(stdout).error.code, "wakeflow-cli-invalid-stdin");
  assert.equal(stdout.includes("�"), false);
});

test("public CLI selects only an own data-property handler", { concurrency: false }, async () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "wakeflow_status");
  Object.defineProperty(Object.prototype, "wakeflow_status", {
    configurable: true,
    value: async () => ({ inherited: true }),
  });
  try {
    await assert.rejects(
      runWakeflowCli({
        argv: ["--request-stdin", "--json"],
        rawRequest: JSON.stringify({ tool: "wakeflow_status", arguments: {} }),
        toolHandlers: {},
      }),
      (error) => error?.code === "wakeflow-cli-handler-missing",
    );
  } finally {
    if (previous) Object.defineProperty(Object.prototype, "wakeflow_status", previous);
    else delete Object.prototype.wakeflow_status;
  }

  let getterCalled = false;
  const accessorHandlers = {};
  Object.defineProperty(accessorHandlers, "wakeflow_status", {
    enumerable: true,
    get() {
      getterCalled = true;
      return async () => ({ accessor: true });
    },
  });
  await assert.rejects(
    runWakeflowCli({
      argv: ["--request-stdin", "--json"],
      rawRequest: JSON.stringify({ tool: "wakeflow_status", arguments: {} }),
      toolHandlers: accessorHandlers,
    }),
    (error) => error?.code === "wakeflow-cli-handler-missing",
  );
  assert.equal(getterCalled, false);
});

test("public CLI preserves trusted MCP error identity and cause code", async () => {
  let stdout = "";
  const completed = await runWakeflowCliStdin({
    argv: ["--request-stdin", "--json"],
    stdin: Readable.from([JSON.stringify({
      tool: "wakeflow_view",
      arguments: { root: repositoryRoot, operation: "not-valid", request: {} },
    })]),
    stdout: { write(chunk) { stdout += chunk; } },
    toolHandlers: handlers,
  });
  assert.equal(completed.exitCode, 1);
  assert.deepEqual(JSON.parse(stdout).error, {
    code: "wakeflow-public-mcp-domain",
    message: "wakeflow_view failed closed inside its v3 owner",
    causeCode: "wakeflow-public-v3-operation",
  });
  assert.equal(stdout.includes(repositoryRoot), false);
});

test("public CLI failures are bounded and never echo private handler details", async () => {
  const privateRoot = "/tmp/private-wakeflow-root";
  let stdout = "";
  const completed = await runWakeflowCliStdin({
    argv: ["--request-stdin", "--json"],
    stdin: Readable.from([JSON.stringify({
      tool: "wakeflow_status",
      arguments: {},
    })]),
    stdout: { write(chunk) { stdout += chunk; } },
    toolHandlers: {
      wakeflow_status: async () => {
        const error = new Error(`${privateRoot}: unavailable`);
        error.code = privateRoot;
        throw error;
      },
    },
  });
  assert.equal(completed.exitCode, 1);
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "wakeflow-cli-failed");
  assert.equal(stdout.includes(privateRoot), false);
});

test("direct CLI rejects the removed command surface through structured stdout only", () => {
  const script = path.join(repositoryRoot, "core/scripts/wakeflow-cli.mjs");
  const result = spawnSync(process.execPath, [script, "status", "--json"], {
    encoding: "utf8",
    input: "",
    shell: false,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "wakeflow-cli-invalid-argv");
});
