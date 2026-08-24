import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pluginRoots = [
  path.join(repoRoot, "plugins/codex-wakeflow"),
  path.join(repoRoot, "plugins/claude-code-wakeflow"),
];

test("both plugin artifacts ship the same executable MCP launcher", async () => {
  const [codexLauncher, claudeLauncher] = await Promise.all(
    pluginRoots.map((root) => readFile(path.join(root, "bin/wakeflow-mcp"), "utf8")),
  );
  assert.equal(codexLauncher, claudeLauncher);
  for (const root of pluginRoots) {
    const result = spawnSync(path.join(root, "bin/wakeflow-mcp"), [], {
      cwd: root,
      env: { ...process.env, WAKEFLOW_NODE: process.execPath },
      encoding: "utf8",
      input: mcpProbeInput(),
      timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertMcpProbe(result.stdout);
  }
});

test("launcher discovers the Codex bundled Node beside its pnpm fallback without node on PATH", {
  skip: process.platform === "win32",
}, async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "wakeflow-mcp-launcher-"));
  try {
    const fallbackDir = path.join(fixture, "runtime/dependencies/bin/fallback");
    const nodeDir = path.join(fixture, "runtime/dependencies/node/bin");
    const home = path.join(fixture, "home");
    await mkdir(fallbackDir, { recursive: true });
    await mkdir(nodeDir, { recursive: true });
    await mkdir(home, { recursive: true });
    const pnpm = path.join(fallbackDir, "pnpm");
    await writeFile(pnpm, "#!/bin/sh\nexit 99\n");
    await chmod(pnpm, 0o755);
    await symlink(process.execPath, path.join(nodeDir, "node"));

    const pluginRoot = pluginRoots[0];
    const result = spawnSync(path.join(pluginRoot, "bin/wakeflow-mcp"), [], {
      cwd: pluginRoot,
      env: {
        HOME: home,
        PATH: `${fallbackDir}:/usr/bin:/bin`,
      },
      encoding: "utf8",
      input: mcpProbeInput(),
      timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertMcpProbe(result.stdout);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("launcher rejects argv and a missing or symlinked final server without leaking artifact paths", {
  skip: process.platform === "win32",
}, async () => {
  const liveLauncher = path.join(pluginRoots[0], "bin/wakeflow-mcp");
  const invalidArgv = spawnSync(liveLauncher, ["--server", "/private/replacement.cjs"], {
    env: { ...process.env, WAKEFLOW_NODE: process.execPath },
    encoding: "utf8",
  });
  assert.equal(invalidArgv.status, 64);
  assert.match(invalidArgv.stderr, /^wakeflow-mcp-invalid-argv:/);
  assert.doesNotMatch(invalidArgv.stderr, /private\/replacement/);

  const fixture = await mkdtemp(path.join(os.tmpdir(), "wakeflow-mcp-boundary-"));
  try {
    const binDir = path.join(fixture, "bin");
    const mcpDir = path.join(fixture, "mcp");
    await mkdir(binDir, { recursive: true });
    await mkdir(mcpDir, { recursive: true });
    const fixtureLauncher = path.join(binDir, "wakeflow-mcp");
    await copyFile(liveLauncher, fixtureLauncher);
    await chmod(fixtureLauncher, 0o755);

    const missing = spawnSync(fixtureLauncher, [], {
      env: { ...process.env, WAKEFLOW_NODE: process.execPath },
      encoding: "utf8",
    });
    assert.equal(missing.status, 127);
    assert.match(missing.stderr, /^wakeflow-mcp-server-missing:/);
    assert.equal(missing.stderr.includes(fixture), false);

    const serverLink = path.join(mcpDir, "server.cjs");
    await symlink(path.join(pluginRoots[0], "mcp/server.cjs"), serverLink);
    const symlinked = spawnSync(fixtureLauncher, [], {
      env: { ...process.env, WAKEFLOW_NODE: process.execPath },
      encoding: "utf8",
    });
    assert.equal(symlinked.status, 127);
    assert.match(symlinked.stderr, /^wakeflow-mcp-server-invalid:/);
    assert.equal(symlinked.stderr.includes(fixture), false);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

function mcpProbeInput() {
  const inheritedHandlerNames = ["constructor", "toString", "hasOwnProperty", "__proto__"];
  return [
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "wakeflow-launcher-test", version: "0.0.0" },
      },
    }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "wakeflow_render_progress", arguments: {} },
    }),
    ...inheritedHandlerNames.map((name, index) => JSON.stringify({
      jsonrpc: "2.0",
      id: 4 + index,
      method: "tools/call",
      params: {
        name,
        arguments: {
          sentinel: "must-not-echo",
          root: "/private/example",
        },
      },
    })),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "wakeflow_view",
        arguments: {
          root: repoRoot,
          operation: "not-valid",
          request: {},
        },
      },
    }),
    "",
  ].join("\n");
}

function assertMcpProbe(stdout) {
  const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
  const initialized = messages.find((message) => message.id === 1);
  const listed = messages.find((message) => message.id === 2);
  const retiredCall = messages.find((message) => message.id === 3);
  const invalidDomainCall = messages.find((message) => message.id === 8);
  assert.equal(initialized?.result?.protocolVersion, "2024-11-05");
  assert.equal(listed?.result?.tools?.length, 31);
  assert.ok(
    listed?.result?.tools?.some((tool) => tool.name === "wakeflow_storage_preserve"),
    "storage preserve must be reachable through the launched MCP server",
  );
  assert.ok(
    listed?.result?.tools?.some((tool) => tool.name === "wakeflow_recover_state_transition"),
    "the explicit state-transition recovery tool must be discoverable",
  );
  for (const toolName of [
    "wakeflow_pod_open",
    "wakeflow_pod_bind",
    "wakeflow_pod_plan",
    "wakeflow_pod_record",
  ]) {
    assert.ok(
      listed?.result?.tools?.some((tool) => tool.name === toolName),
      `${toolName} must be discoverable`,
    );
  }
  for (const retired of [
    "wakeflow_render_progress",
    "wakeflow_sanitize_archive",
    "wakeflow_pod_record_materialization",
    "wakeflow_pod_prepare_design_request",
    "wakeflow_pod_record_design_handoff",
    "wakeflow_pod_prepare_test_access",
    "wakeflow_pod_record_test_access",
    "wakeflow_pod_close",
    "wakeflow_pod_record_close_receipt",
    "wakeflow_pod_list",
  ]) {
    assert.equal(
      listed?.result?.tools?.some((tool) => tool.name === retired),
      false,
      `${retired} must not remain on the public MCP surface`,
    );
  }
  assert.equal(retiredCall?.result?.isError, true);
  assert.deepEqual(toolPayload(retiredCall), {
    ok: false,
    error: {
      code: "wakeflow-mcp-unknown-tool",
      message: "Unknown Wakeflow tool",
    },
  });

  for (const [index, inheritedName] of ["constructor", "toString", "hasOwnProperty", "__proto__"].entries()) {
    const response = messages.find((message) => message.id === 4 + index);
    const responseText = response?.result?.content?.[0]?.text ?? "";
    assert.equal(response?.result?.isError, true, `${inheritedName} must not be callable`);
    assert.deepEqual(toolPayload(response), {
      ok: false,
      error: {
        code: "wakeflow-mcp-unknown-tool",
        message: "Unknown Wakeflow tool",
      },
    });
    assert.equal(responseText.includes("must-not-echo"), false, inheritedName);
    assert.equal(responseText.includes("/private/example"), false, inheritedName);
  }

  const invalidDomainPayload = toolPayload(invalidDomainCall);
  assert.equal(invalidDomainCall?.result?.isError, true);
  assert.deepEqual(invalidDomainPayload, {
    ok: false,
    error: {
      code: "wakeflow-public-mcp-domain",
      message: "wakeflow_view failed closed inside its v3 owner",
      causeCode: "wakeflow-public-v3-operation",
    },
  });
  assert.equal(
    invalidDomainCall?.result?.content?.[0]?.text?.includes(repoRoot),
    false,
    "public MCP errors must not reveal the caller's workspace root",
  );
}

function toolPayload(message) {
  return JSON.parse(message?.result?.content?.[0]?.text ?? "null");
}
