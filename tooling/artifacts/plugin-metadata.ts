import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Wakeflow Tooling / Artifacts：插件制品的元数据（gate-log §13.101 D3、D4、D6）。
 *
 * 版本只有一个输入：`assets/release/version.json`。构建器把它盖进两个插件的 `package.json` 与
 * 插件清单，`release:check` 再核对这四处加 Claude marketplace 条目五源一致（能力卡 10 Q5–Q7）。
 * 插件名沿用 `wakeflow`，两个宿主的清单差异是宿主平台的事实：Codex 声明 `skills` 路径、
 * `mcpServers` 路径与 `interface` 段，Claude Code 靠目录发现技能、命令与 hook，只声明
 * `mcpServers`。这里的文本是清单与 marketplace 的描述，不是 agent 面文本；agent 面文本在
 * `assets/agent-text/`。
 */

const RELEASE_VERSION_SOURCE = "assets/release/version.json";
export const PLUGIN_NAME = "wakeflow";
const PLUGIN_LICENSE = "MIT";
export const PLUGIN_ENGINES_NODE = ">=24.19.0 <25";
const PLUGIN_HOMEPAGE = "https://github.com/GxFn/Wakeflow#readme";
const PLUGIN_REPOSITORY = "https://github.com/GxFn/Wakeflow";
const PLUGIN_AUTHOR = Object.freeze({
  name: "gaoxuefeng",
  url: "https://github.com/GxFn",
});
const PLUGIN_KEYWORDS: readonly string[] = Object.freeze([
  "agent-workflow",
  "control-plane",
  "multi-window",
  "local-first",
  "evidence-review",
  "mcp",
]);

export type PluginHostId = "codex" | "claude-code";

/** 新版本序列从 `1.0.0` 起（ADR-0008 决定 6，能力卡 10 Q5）；主版本号为 0 的版本永不可发布。 */
const RELEASE_SERIES_MINIMUM_MAJOR = 1;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/u;
const MAXIMUM_VERSION_FILE_BYTES = 4096;

export interface ReleaseVersion {
  readonly version: string;
  /** 版本属于新序列（主版本号不低于 1）；`releaseEligible` 的第一个条件。 */
  readonly releaseSeries: boolean;
}

/** 元数据输入不满足约束时返回的稳定工具错误；调用方与测试按 `name` 与 `code` 断言。 */
class PluginMetadataError extends Error {
  override readonly name = "PluginMetadataError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new PluginMetadataError(code, message);
}

type JsonRecord = Readonly<Record<string, unknown>>;

function isPlainRecord(value: unknown): value is JsonRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** 解析一个 semver 文本；形状不对即失败。导出供 `release:check` 复用同一条规则。 */
export function parseSemanticVersion(value: unknown, label: string): string {
  if (typeof value !== "string" || !SEMVER_PATTERN.test(value)) {
    fail("wakeflow-release-version", `${label} is not one semantic version`);
  }
  return value;
}

export function isReleaseSeries(version: string): boolean {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isInteger(major) && major >= RELEASE_SERIES_MINIMUM_MAJOR;
}

/** 读取唯一的版本输入；文件形状、版本形状与序列都在这里核对。 */
export function readReleaseVersion(repositoryRoot: string): Readonly<ReleaseVersion> {
  const file = path.join(repositoryRoot, RELEASE_VERSION_SOURCE);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (
    stat === undefined ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size > MAXIMUM_VERSION_FILE_BYTES
  ) {
    fail("wakeflow-release-version", `${RELEASE_VERSION_SOURCE} must be one small regular file`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail("wakeflow-release-version", `${RELEASE_VERSION_SOURCE} is not valid JSON`);
  }
  if (
    !isPlainRecord(parsed) ||
    parsed.kind !== "WakeflowReleaseVersion" ||
    parsed.schemaVersion !== 1
  ) {
    fail("wakeflow-release-version", `${RELEASE_VERSION_SOURCE} is not one release version record`);
  }
  const version = parseSemanticVersion(parsed.version, RELEASE_VERSION_SOURCE);
  return Object.freeze({ version, releaseSeries: isReleaseSeries(version) });
}

export function pluginPackageName(hostId: PluginHostId): string {
  return hostId === "codex" ? "wakeflow" : "claude-code-wakeflow";
}

export function pluginDirectoryName(
  hostId: PluginHostId,
): "codex-wakeflow" | "claude-code-wakeflow" {
  return hostId === "codex" ? "codex-wakeflow" : "claude-code-wakeflow";
}

export function pluginManifestPath(hostId: PluginHostId): string {
  return hostId === "codex" ? ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json";
}

/** 清单与 marketplace 共用的一句描述：按宿主点名它的窗口机制，不承诺已放弃的 unattended。 */
function pluginDescription(hostId: PluginHostId): string {
  const windows =
    hostId === "codex"
      ? "a fleet of Codex threads"
      : "a tmux-resident fleet of Claude Code sessions";
  return (
    `A disciplined control loop for multi-window agent work across ${windows}: ` +
    "a Controller window claims requirement packages, plans task packages, prepares deliveries, " +
    "imports immutable target results, obtains independent Test validation and reviews the " +
    "evidence before completing and archiving a Demand. Explicit on-disk state roots keep every " +
    "step auditable; Agents perform the host actions, Wakeflow owns the content and the verification."
  );
}

const CODEX_INTERFACE = Object.freeze({
  displayName: "Wakeflow",
  shortDescription: "Dual-host control loops for agent work",
  longDescription:
    "Wakeflow ships Codex and Claude Code editions of the same local-first control model. " +
    "This Codex edition packages the controller state roots, requirement board, Demand event " +
    "stream, task packages, delivery envelopes with hook-observed landing evidence, immutable " +
    "target results, review decisions, managed evidence, pods with worktree execution, status " +
    "and verify projections, and the Controller, Design, Target and Test skills for Codex " +
    "workspaces. It never sends prompts or performs host actions by itself.",
  developerName: "GxFn",
  category: "Productivity",
  capabilities: Object.freeze(["Interactive", "Read", "Write"]),
  websiteURL: PLUGIN_HOMEPAGE,
  defaultPrompt: Object.freeze([
    "Initialize this directory as a Wakeflow controller workspace",
    "Show the Wakeflow workspace status",
    "Claim the next requirement package and create a Demand",
  ]),
  brandColor: "#0F766E",
  composerIcon: "./assets/wakeflow-mark.svg",
  logo: "./assets/wakeflow-logo.svg",
});

/** 插件清单：键序固定，宿主差异只在这里。 */
export function renderPluginManifest(hostId: PluginHostId, version: string): JsonRecord {
  const shared = {
    name: PLUGIN_NAME,
    version,
    description: pluginDescription(hostId),
  };
  if (hostId === "codex") {
    return {
      ...shared,
      category: "workflow",
      author: PLUGIN_AUTHOR,
      homepage: PLUGIN_HOMEPAGE,
      repository: PLUGIN_REPOSITORY,
      license: PLUGIN_LICENSE,
      keywords: PLUGIN_KEYWORDS,
      skills: "./skills/",
      mcpServers: "./.mcp.json",
      interface: CODEX_INTERFACE,
    };
  }
  return {
    ...shared,
    author: PLUGIN_AUTHOR,
    homepage: PLUGIN_HOMEPAGE,
    repository: PLUGIN_REPOSITORY,
    license: PLUGIN_LICENSE,
    keywords: PLUGIN_KEYWORDS,
    mcpServers: "./.mcp.json",
  };
}

/** 制品的 `package.json`：运行时依赖按锁文件的精确版本声明，制品自带它们的闭包。 */
export function renderPackageJson(
  hostId: PluginHostId,
  version: string,
  dependencies: Readonly<Record<string, string>>,
): JsonRecord {
  return {
    name: pluginPackageName(hostId),
    version,
    type: "module",
    description: pluginDescription(hostId),
    license: PLUGIN_LICENSE,
    homepage: PLUGIN_HOMEPAGE,
    repository: { type: "git", url: `${PLUGIN_REPOSITORY}.git` },
    keywords: PLUGIN_KEYWORDS,
    bin: { "wakeflow-mcp": "./mcp/server.mjs" },
    scripts: { mcp: "node ./mcp/server.mjs" },
    engines: { node: PLUGIN_ENGINES_NODE },
    dependencies,
  };
}

/** Claude marketplace 里唯一的 `wakeflow` 条目应有的形状；`release:check` 与制品校验按它核对。 */
export function expectedClaudeMarketplaceEntry(version: string): JsonRecord {
  return {
    name: PLUGIN_NAME,
    source: `./plugins/${pluginDirectoryName("claude-code")}`,
    description: pluginDescription("claude-code"),
    version,
    author: PLUGIN_AUTHOR,
    homepage: PLUGIN_HOMEPAGE,
    license: PLUGIN_LICENSE,
    keywords: PLUGIN_KEYWORDS,
    category: "productivity",
  };
}

/** Codex marketplace 条目无版本字段（能力卡 10 Q6）；名称、来源路径、policy 与类别按结构核对。 */
export function expectedCodexMarketplaceEntry(): JsonRecord {
  return {
    name: PLUGIN_NAME,
    source: { source: "local", path: `./plugins/${pluginDirectoryName("codex")}` },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Productivity",
  };
}
