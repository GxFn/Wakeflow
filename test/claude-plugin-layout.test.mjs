import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRootUrl = new URL("../", import.meta.url);
const pluginRootUrl = new URL("../plugins/claude-code-wakeflow/", import.meta.url);
const marketplaceUrl = new URL("../.claude-plugin/marketplace.json", import.meta.url);

const bundledPluginEntries = [
  ".claude-plugin",
  ".mcp.json",
  "CLAUDE.md",
  "LICENSE",
  "README.md",
  "README.zh-CN.md",
  "assets",
  "commands",
  "lib",
  "mcp",
  "package.json",
  "schemas",
  "scripts",
  "skills",
  "templates",
  "wakeflow.config.example.json",
  "wakeflow.config.json",
];

const forbiddenPluginEntries = [
  ".agents",
  ".codex-plugin",
  "AGENTS.md",
  "agents",
  "docs",
  "node_modules",
  "test",
];

test("claude plugin artifact ships the expected top-level entries", async () => {
  const entries = await fs.readdir(pluginRootUrl);
  for (const expected of bundledPluginEntries) {
    assert.ok(entries.includes(expected), `claude plugin artifact must include ${expected}`);
  }
  for (const forbidden of forbiddenPluginEntries) {
    assert.ok(!entries.includes(forbidden), `claude plugin artifact must not include ${forbidden}`);
  }
});

test("claude plugin manifest is wired for Claude Code", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL(".claude-plugin/plugin.json", pluginRootUrl), "utf8"));
  assert.equal(manifest.name, "wakeflow");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.ok(manifest.keywords.includes("unattended"));

  const mcp = JSON.parse(await fs.readFile(new URL(".mcp.json", pluginRootUrl), "utf8"));
  const server = mcp.mcpServers?.wakeflow;
  assert.ok(server, ".mcp.json must expose mcpServers.wakeflow");
  assert.equal(server.command, "node");
  assert.equal(server.args[0], "${CLAUDE_PLUGIN_ROOT}/mcp/server.cjs");
  assert.equal(server.cwd, undefined, "claude MCP wiring must not rely on cwd");
});

test("repo-level claude marketplace lists the nested claude plugin artifact", async () => {
  const marketplace = JSON.parse(await fs.readFile(marketplaceUrl, "utf8"));
  assert.equal(marketplace.name, "gxfn");
  assert.ok(marketplace.owner?.name);
  const entry = (marketplace.plugins ?? []).find((plugin) => plugin?.name === "wakeflow");
  assert.ok(entry, "marketplace must include wakeflow");
  const source = typeof entry.source === "string" ? entry.source : entry.source?.source;
  assert.equal(source, "./plugins/claude-code-wakeflow");
  const resolved = path.resolve(new URL(".", repoRootUrl).pathname, source);
  assert.equal(resolved, new URL(".", pluginRootUrl).pathname.replace(/\/$/, ""));
});

test("claude slash commands exist with frontmatter descriptions", async () => {
  for (const command of ["init.md", "status.md", "dispatch.md", "review.md"]) {
    const text = await fs.readFile(new URL(`commands/${command}`, pluginRootUrl), "utf8");
    assert.match(text, /^---\n[\s\S]*?description:\s*\S[\s\S]*?\n---/, `${command} needs frontmatter description`);
  }
});
