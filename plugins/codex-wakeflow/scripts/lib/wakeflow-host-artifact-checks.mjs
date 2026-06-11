import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Host-specific plugin artifact checks consumed by wakeflow-validate.
 *
 * Each Wakeflow host artifact ships its own copy with the same factory shape:
 * - validatePluginManifest(): host plugin manifest rules.
 * - validateMarketplaceIfPresent(): host marketplace catalog rules.
 * - validateMcpServerWiring(server): host MCP server wiring rules for .mcp.json.
 */
export function createHostArtifactChecks({ root, errors, readJson, requireFile, requirePath, stripDotSlash }) {
  function validatePluginManifest() {
    const manifest = readJson(".codex-plugin/plugin.json");
    if (!manifest) return;
    if (manifest.name !== "wakeflow") errors.push("plugin name must be wakeflow");
    if (manifest.interface?.displayName !== "Wakeflow") errors.push("plugin displayName must be Wakeflow");
    if (manifest.author?.name !== "gaoxuefeng") errors.push("plugin author name must be gaoxuefeng");
    if (manifest.interface?.developerName !== "GxFn") errors.push("plugin developerName must be GxFn");
    if (manifest.skills !== "./skills/") errors.push("plugin skills path must be ./skills/");
    if (manifest.mcpServers !== "./.mcp.json") errors.push("plugin mcpServers path must be ./.mcp.json");
    if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("unattended")) {
      errors.push("plugin keywords must include unattended");
    }
    if (!Array.isArray(manifest.interface?.defaultPrompt) || manifest.interface.defaultPrompt.length === 0) {
      errors.push("plugin interface.defaultPrompt must be a non-empty array");
    } else {
      if (manifest.interface.defaultPrompt.length > 3) {
        errors.push("plugin interface.defaultPrompt must contain at most 3 prompts");
      }
      for (const [index, prompt] of manifest.interface.defaultPrompt.entries()) {
        if (typeof prompt !== "string" || prompt.trim() === "") {
          errors.push(`plugin interface.defaultPrompt[${index}] must be a non-empty string`);
        } else if (prompt.length > 128) {
          errors.push(`plugin interface.defaultPrompt[${index}] must be at most 128 characters`);
        }
      }
    }
    for (const relativePath of [
      manifest.skills,
      manifest.mcpServers,
      manifest.interface?.composerIcon,
      manifest.interface?.logo,
    ].filter(Boolean)) {
      requirePath(relativePath, `plugin manifest points to missing path: ${relativePath}`);
    }
  }

  function validateMarketplaceIfPresent() {
    if (!existsSync(path.join(root, ".agents/plugins/marketplace.json"))) return;
    const marketplace = readJson(".agents/plugins/marketplace.json");
    const manifest = readJson(".codex-plugin/plugin.json");
    if (!marketplace || !manifest) return;
    const entries = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
    const entry = entries.find((plugin) => plugin?.name === manifest.name);
    if (marketplace.name !== "gxfn") errors.push("marketplace name must be gxfn");
    if (marketplace.interface?.displayName !== "GxFn") {
      errors.push("marketplace displayName must be GxFn");
    }
    if (entries.length !== 1) errors.push("marketplace must list exactly one Wakeflow plugin");
    if (!entry) {
      errors.push("marketplace must include wakeflow");
      return;
    }
    if (entry.source?.source !== "local") errors.push("marketplace wakeflow source must be local");
    if (entry.source?.path !== ".") errors.push("marketplace wakeflow path must point to the plugin artifact root");
    if (path.resolve(root, entry.source?.path || "") !== root) {
      errors.push("marketplace wakeflow path must resolve to the plugin artifact root");
    }
    if (entry.policy?.installation !== "AVAILABLE") {
      errors.push("marketplace wakeflow installation policy must be AVAILABLE");
    }
    if (entry.policy?.authentication !== "ON_INSTALL") {
      errors.push("marketplace wakeflow authentication policy must be ON_INSTALL");
    }
    if (entry.category !== manifest.interface?.category) {
      errors.push("marketplace wakeflow category must match plugin interface category");
    }
  }

  function validateMcpServerWiring(server) {
    if (server.cwd !== ".") errors.push("wakeflow MCP cwd must be .");
    if (!Array.isArray(server.args) || server.args[0] !== "./mcp/server.cjs") {
      errors.push("wakeflow MCP args must start with ./mcp/server.cjs");
    }
    for (const arg of server.args || []) {
      if (arg.endsWith(".mjs") || arg.endsWith(".cjs")) requireFile(stripDotSlash(arg));
    }
  }

  return {
    validatePluginManifest,
    validateMarketplaceIfPresent,
    validateMcpServerWiring,
  };
}
