import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Host-specific plugin artifact checks consumed by wakeflow-validate.
 *
 * Claude Code edition: validates .claude-plugin/plugin.json, the repo-level
 * .claude-plugin/marketplace.json catalog when developing inside the Wakeflow
 * source repository, and the ${CLAUDE_PLUGIN_ROOT}-based MCP wiring.
 */
export function createHostArtifactChecks({ root, errors, readJson, requireFile, requirePath, stripDotSlash }) {
  const PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}";

  function validatePluginManifest() {
    const manifest = readJson(".claude-plugin/plugin.json");
    if (!manifest) return;
    if (manifest.name !== "wakeflow") errors.push("plugin name must be wakeflow");
    if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
      errors.push("plugin version must be a non-empty string");
    }
    if (typeof manifest.description !== "string" || manifest.description.trim() === "") {
      errors.push("plugin description must be a non-empty string");
    }
    if (manifest.author?.name !== "gaoxuefeng") errors.push("plugin author name must be gaoxuefeng");
    if (manifest.mcpServers !== "./.mcp.json") errors.push("plugin mcpServers path must be ./.mcp.json");
    if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("unattended")) {
      errors.push("plugin keywords must include unattended");
    }
    for (const requiredDir of ["skills", "commands"]) {
      const absolute = path.join(root, requiredDir);
      if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
        errors.push(`plugin must ship a ${requiredDir}/ directory`);
      }
    }
    if (manifest.mcpServers) {
      requirePath(manifest.mcpServers, `plugin manifest points to missing path: ${manifest.mcpServers}`);
    }
  }

  function validateMarketplaceIfPresent() {
    const marketplaceFile = path.resolve(root, "../../.claude-plugin/marketplace.json");
    if (!existsSync(marketplaceFile)) return;
    const marketplace = readJson(path.relative(root, marketplaceFile));
    const manifest = readJson(".claude-plugin/plugin.json");
    if (!marketplace || !manifest) return;
    const entries = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
    const entry = entries.find((plugin) => plugin?.name === manifest.name);
    if (marketplace.name !== "gxfn") errors.push("marketplace name must be gxfn");
    if (!marketplace.owner?.name) errors.push("marketplace owner name must be set");
    if (!entry) {
      errors.push("marketplace must include wakeflow");
      return;
    }
    const source = typeof entry.source === "string" ? entry.source : entry.source?.source;
    if (source !== "./plugins/claude-code-wakeflow") {
      errors.push("marketplace wakeflow source must point at ./plugins/claude-code-wakeflow");
    }
  }

  function validateMcpServerWiring(server) {
    if (server.command !== `${PLUGIN_ROOT_VAR}/bin/wakeflow-mcp`) {
      errors.push("wakeflow MCP command must use ${CLAUDE_PLUGIN_ROOT}/bin/wakeflow-mcp");
    } else {
      requireFile(stripDotSlash(server.command.replace(`${PLUGIN_ROOT_VAR}/`, "")));
    }
    if (server.cwd !== undefined) {
      errors.push("wakeflow MCP server must not set cwd; use ${CLAUDE_PLUGIN_ROOT} paths instead");
    }
    if (!Array.isArray(server.args) || server.args.length !== 0) {
      errors.push("wakeflow MCP launcher must not receive config arguments");
    }
  }

  return {
    validatePluginManifest,
    validateMarketplaceIfPresent,
    validateMcpServerWiring,
  };
}
