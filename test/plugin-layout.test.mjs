import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRootUrl = new URL("../", import.meta.url);
const pluginRootUrl = new URL("../plugins/codex-wakeflow/", import.meta.url);
const marketplaceUrl = new URL("../.agents/plugins/marketplace.json", import.meta.url);

const bundledPluginEntries = [
  ".codex-plugin",
  ".mcp.json",
  "AGENTS.md",
  "LICENSE",
  "README.md",
  "README.zh-CN.md",
  "assets",
  "lib",
  "mcp",
  "package.json",
  "schemas",
  "scripts",
  "skills",
  "templates",
  "workspace.config.example.json",
  "workspace.config.json",
];

const forbiddenPluginEntries = [
  ".agents",
  "docs",
  "node_modules",
  "runtime.tgz",
  "test",
];

const forbiddenRootPluginEntries = [
  ".codex-plugin",
  ".mcp.json",
  "AGENTS.md",
  "assets",
  "lib",
  "mcp",
  "schemas",
  "scripts",
  "skills",
  "templates",
  "workspace.config.example.json",
  "workspace.config.json",
  "runtime.tgz",
];

test("keeps repository-local marketplace metadata pointed at the nested plugin bundle", async () => {
  const marketplace = JSON.parse(await fs.readFile(marketplaceUrl, "utf8"));
  assert.equal(marketplace.name, "gxfn");
  assert.equal(marketplace.interface?.displayName, "GxFn");
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0]?.name, "wakeflow");
  assert.equal(marketplace.plugins[0]?.source?.source, "local");
  assert.equal(marketplace.plugins[0]?.source?.path, "./plugins/codex-wakeflow");
});

test("keeps the marketplace scan surface limited to the nested plugin bundle", async () => {
  const pluginRootStat = await fs.lstat(pluginRootUrl);
  assert.equal(pluginRootStat.isDirectory(), true, "plugin bundle must live under plugins/codex-wakeflow");
  assert.equal(pluginRootStat.isSymbolicLink(), false, "plugin bundle must be a real directory");

  for (const entry of bundledPluginEntries) {
    const bundledPath = path.join(pluginRootUrl.pathname, entry);
    const bundledStat = await fs.lstat(bundledPath);
    assert.equal(bundledStat.isSymbolicLink(), false, `${entry} must be a real bundled file or directory`);
  }

  for (const entry of forbiddenPluginEntries) {
    const bundledPath = path.join(pluginRootUrl.pathname, entry);
    await assert.rejects(fs.lstat(bundledPath), { code: "ENOENT" }, `${entry} must not ship in the plugin bundle`);
  }

  for (const entry of forbiddenRootPluginEntries) {
    const rootPath = path.join(repoRootUrl.pathname, entry);
    await assert.rejects(fs.lstat(rootPath), { code: "ENOENT" }, `${entry} should not exist at repo root`);
  }
});

test("keeps plugin metadata aligned with repository-local marketplace conventions", async () => {
  const manifest = JSON.parse(
    await fs.readFile(new URL("../plugins/codex-wakeflow/.codex-plugin/plugin.json", import.meta.url), "utf8"),
  );
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../plugins/codex-wakeflow/package.json", import.meta.url), "utf8"),
  );
  const rootPackageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(rootPackageJson.name, "wakeflow-repo");
  assert.equal(rootPackageJson.private, true);
  assert.deepEqual(rootPackageJson.workspaces, ["plugins/codex-wakeflow", "plugins/claude-code-wakeflow"]);

  assert.equal(manifest.name, "wakeflow");
  assert.equal(packageJson.name, "wakeflow");
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.author?.name, "gaoxuefeng");
  assert.equal(manifest.author?.url, "https://github.com/GxFn");
  assert.equal(manifest.homepage, "https://github.com/GxFn/Wakeflow#readme");
  assert.equal(manifest.repository, "https://github.com/GxFn/Wakeflow");
  assert.equal(manifest.interface?.developerName, "GxFn");
  assert.equal(manifest.interface?.websiteURL, "https://github.com/GxFn/Wakeflow#readme");
  assert.deepEqual(manifest.interface?.capabilities, ["Interactive", "Read", "Write"]);
  assert.ok(manifest.keywords.includes("unattended"));

  assert.equal(packageJson.homepage, manifest.homepage);
  assert.equal(packageJson.repository.url, "https://github.com/GxFn/Wakeflow.git");
});

test("keeps development tests outside the plugin artifact", async () => {
  const testRootStat = await fs.lstat(new URL("../test/", import.meta.url));
  assert.equal(testRootStat.isDirectory(), true);

  const pluginScripts = await fs.readdir(new URL("../plugins/codex-wakeflow/scripts/", import.meta.url));
  assert.equal(pluginScripts.some((name) => name.endsWith(".test.mjs")), false);
  assert.equal(pluginScripts.includes("fixtures"), false);
});
