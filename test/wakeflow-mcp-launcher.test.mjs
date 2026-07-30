import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

function mcpProbeInput() {
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
    "",
  ].join("\n");
}

function assertMcpProbe(stdout) {
  const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
  const initialized = messages.find((message) => message.id === 1);
  const listed = messages.find((message) => message.id === 2);
  assert.equal(initialized?.result?.protocolVersion, "2024-11-05");
  assert.equal(listed?.result?.tools?.length, 31);
  assert.ok(
    listed?.result?.tools?.some((tool) => tool.name === "wakeflow_recover_state_transition"),
    "the explicit state-transition recovery tool must be discoverable",
  );
}
