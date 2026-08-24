import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Claude Code 发布产物的宿主专属校验接缝。
 *
 * shared validator 只依赖四个固定方法，不理解 Claude manifest、仓库级
 * marketplace、命令目录或 `${CLAUDE_PLUGIN_ROOT}` 启动语义；本文件只校验
 * 这些发布 wiring，不读取目标工作区或 tmux 运行状态。
 */
export function createHostArtifactChecks({ root, errors, readJson, requireFile, requirePath, stripDotSlash }) {
  const PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}";

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

  // 校验 Claude plugin manifest 的固定身份、MCP 引用和宿主目录表面。
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
      requireRealArtifactPath(
        requiredDir,
        "directory",
        `plugin must ship a real ${requiredDir}/ directory`,
      );
    }
    if (manifest.mcpServers) {
      requireRealArtifactPath(
        manifest.mcpServers,
        "file",
        `plugin manifest points to an invalid path: ${manifest.mcpServers}`,
      );
    }
  }

  // 仅在 Wakeflow 源仓库布局中校验仓库级 Claude marketplace；安装缓存中安全跳过。
  function validateMarketplaceIfPresent() {
    const repositoryRoot = path.resolve(root, "../..");
    const marketplaceFile = path.join(repositoryRoot, ".claude-plugin/marketplace.json");
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
    if (path.resolve(repositoryRoot, source || "") !== root) {
      errors.push("marketplace wakeflow source must resolve to the plugin artifact root");
    }
  }

  // Claude 只用插件根变量定位入口；workspace root 由每个公共请求显式提供。
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
    if (server.env !== undefined) {
      errors.push("wakeflow MCP server must not inject a default workspace root; public requests carry explicit root");
    }
  }

  // 防止已退役 runtime-meta 写入面从 Claude 专属代码、命令或说明中回流。
  function validateRetiredRuntimeMetaSurface() {
    const forbiddenByFile = new Map([
      ["scripts/lib/wakeflow-claude-host.mjs", [
        "runtime-meta",
        "ClaudeHostRuntimeMeta",
        "stamp-runtime",
        "plugin-version",
      ]],
      ["commands/check.md", ["runtime-meta", "stamp-runtime", "plugin-version", "--fix"]],
      ["README.md", ["runtime-meta", "stamp-runtime"]],
      ["README.zh-CN.md", ["runtime-meta", "stamp-runtime"]],
      ["scripts/README.md", ["runtime-meta", "stamp-runtime"]],
      ["skills/wakeflow-governance/references/stage-route-map.md", ["stamp-runtime"]],
    ]);
    for (const [relativePath, forbiddenTokens] of forbiddenByFile) {
      requireFile(relativePath);
      requireRealArtifactPath(
        relativePath,
        "file",
        `retired-surface scan requires a real file: ${relativePath}`,
      );
      let source;
      try {
        source = readFileSync(path.join(root, relativePath), "utf8");
      } catch {
        continue;
      }
      for (const token of forbiddenTokens) {
        if (source.includes(token)) {
          errors.push(`retired runtime-meta surface reintroduced in ${relativePath}: ${token}`);
        }
      }
    }
  }

  return {
    validatePluginManifest,
    validateMarketplaceIfPresent,
    validateMcpServerWiring,
    validateRetiredRuntimeMetaSurface,
  };
}
