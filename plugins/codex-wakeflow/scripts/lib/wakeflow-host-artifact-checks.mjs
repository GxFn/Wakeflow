import { existsSync, lstatSync } from "node:fs";
import path from "node:path";

/**
 * Codex 发布产物的宿主专属校验接缝。
 *
 * shared validator 只依赖四个固定方法，不理解 Codex manifest、仓库级
 * marketplace 或 MCP 启动路径；本文件只校验这些发布 wiring，不读取工作区
 * authority，也不拥有运行时 host capability。
 */
export function createHostArtifactChecks({ root, errors, readJson, requireFile, requirePath, stripDotSlash }) {
  // manifest 指向的发布节点必须留在 artifact 内，并且是预期类型的真实节点。
  function requireRealArtifactPath(relativePath, expectedType, message) {
    const portablePath = stripDotSlash(relativePath);
    const absolute = path.resolve(root, portablePath);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      errors.push(`${message}: path escapes the plugin artifact`);
      return;
    }
    if (!existsSync(absolute)) {
      requirePath(relativePath, message);
      return;
    }
    const node = lstatSync(absolute);
    const matchesType = expectedType === "directory" ? node.isDirectory() : node.isFile();
    if (node.isSymbolicLink() || !matchesType) {
      errors.push(`${message}: expected a real ${expectedType}`);
    }
  }

  // 校验 Codex plugin manifest 的固定身份、入口和 UI 资产引用。
  function validatePluginManifest() {
    const manifest = readJson(".codex-plugin/plugin.json");
    if (!manifest) return;
    if (manifest.name !== "wakeflow") errors.push("plugin name must be wakeflow");
    if (manifest.interface?.displayName !== "Wakeflow") errors.push("plugin displayName must be Wakeflow");
    if (manifest.author?.name !== "gaoxuefeng") errors.push("plugin author name must be gaoxuefeng");
    if (manifest.interface?.developerName !== "GxFn") errors.push("plugin developerName must be GxFn");
    if (manifest.skills !== "./skills/") errors.push("plugin skills path must be ./skills/");
    if (manifest.mcpServers !== "./.mcp.json") errors.push("plugin mcpServers path must be ./.mcp.json");
    if (manifest.interface?.composerIcon !== "./assets/wakeflow-mark.svg") {
      errors.push("plugin composerIcon must be ./assets/wakeflow-mark.svg");
    }
    if (manifest.interface?.logo !== "./assets/wakeflow-logo.svg") {
      errors.push("plugin logo must be ./assets/wakeflow-logo.svg");
    }
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
    for (const [relativePath, expectedType] of [
      [manifest.skills, "directory"],
      [manifest.mcpServers, "file"],
      [manifest.interface?.composerIcon, "file"],
      [manifest.interface?.logo, "file"],
    ]) {
      if (!relativePath) continue;
      requireRealArtifactPath(
        relativePath,
        expectedType,
        `plugin manifest points to an invalid path: ${relativePath}`,
      );
    }
  }

  // 仅在 Wakeflow 源仓库布局中校验仓库级 Codex marketplace；安装缓存中安全跳过。
  function validateMarketplaceIfPresent() {
    const repositoryRoot = path.resolve(root, "../..");
    const marketplaceFile = path.join(repositoryRoot, ".agents/plugins/marketplace.json");
    if (!existsSync(marketplaceFile)) return;
    const marketplace = readJson(path.relative(root, marketplaceFile));
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
    if (entry.source?.path !== "./plugins/codex-wakeflow") {
      errors.push("marketplace wakeflow path must point to ./plugins/codex-wakeflow");
    }
    if (path.resolve(repositoryRoot, entry.source?.path || "") !== root) {
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

  // MCP 必须从 artifact 根启动唯一入口；所有公共调用都显式携带 workspace root。
  function validateMcpServerWiring(server) {
    if (server.command !== "./bin/wakeflow-mcp") {
      errors.push("wakeflow MCP command must use ./bin/wakeflow-mcp");
    } else {
      requireFile(stripDotSlash(server.command));
    }
    if (server.cwd !== ".") errors.push("wakeflow MCP cwd must be .");
    if (!Array.isArray(server.args) || server.args.length !== 0) {
      errors.push("wakeflow MCP launcher must not receive config arguments");
    }
    if (server.env !== undefined) {
      errors.push("wakeflow MCP server must not inject a default workspace root; public requests carry explicit root");
    }
  }

  return {
    validatePluginManifest,
    validateMarketplaceIfPresent,
    validateMcpServerWiring,
    validateRetiredRuntimeMetaSurface() {},
  };
}
