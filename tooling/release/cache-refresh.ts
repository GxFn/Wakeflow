import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyArtifactAgainstManifest } from "../artifacts/check-plugin-artifacts.js";
import { PLUGIN_NAME, pluginDirectoryName } from "../artifacts/plugin-metadata.js";
import { sha256 } from "../verification/files.js";

/**
 * Wakeflow Tooling / Cache refresh：把已提交的 Claude Code 制品重新装进宿主的插件缓存，并核对宿主
 * 实际加载的位置。
 *
 * `claude plugin update` 在版本号不变时报告"已是最新"，所以刷新是 `uninstall` 再 `install` 两步
 * （memory：test workspace）。本命令只在 `--yes` 下执行宿主 CLI；前后各核对一次缓存目录里的制品
 * 清单摘要，并与已提交制品比较。缓存刷新不等于窗口已重载：hook 立即生效，MCP 服务与技能要等
 * 窗口重启或 resume。Codex 的缓存路径未在本仓库确认，按 unavailable 报告。
 *
 * 加载位置（§13.183 F-L1-10）：marketplace 是 `directory` 源时，Claude Code 从该目录里的
 * `plugins/<dir>` 就地加载插件（MCP 服务与 hook 的进程路径都在检出里），缓存目录只是登记用的副本；
 * 于是一次 `build:artifacts:committed` 就已经换掉了现场的插件字节，卸载再安装只刷新副本与登记版本。
 * 其他源（github、git）才从缓存加载。`passed` 以加载位置的清单与已提交一致为准，不看副本。
 */

export interface CacheRefreshRequest {
  readonly hostId: string;
  readonly yes: boolean;
  /** 宿主 CLI 可执行文件；缺省 `claude`，测试注入桩。 */
  readonly cli?: string;
  /** 缓存里的版本目录；缺省 `~/.claude/plugins/cache/<marketplace>/wakeflow/<version>`。 */
  readonly installed?: string;
  /** 宿主的 marketplace 登记文件；缺省 `~/.claude/plugins/known_marketplaces.json`，测试注入夹具。 */
  readonly knownMarketplaces?: string;
}

/** 宿主实际加载插件的位置：directory 源就地加载检出里的制品目录，其他源加载缓存副本。 */
export interface CacheLoadPath {
  readonly kind: "directory-marketplace" | "cache" | "unknown";
  readonly path: string | null;
  readonly manifestDigest: string | null;
  readonly matchesCommitted: boolean;
  readonly reason: string | null;
}

interface CacheState {
  readonly present: boolean;
  readonly manifestDigest: string | null;
  readonly matchesCommitted: boolean;
  readonly reason: string | null;
}

export interface CacheRefreshResult {
  readonly kind: "WakeflowCacheRefresh";
  readonly schemaVersion: 1;
  readonly status: "passed" | "failed" | "unavailable";
  readonly hostId: string;
  readonly version: string;
  readonly committedManifestDigest: string;
  readonly installed: string;
  readonly commands: readonly Readonly<{ args: readonly string[]; exitCode: number | null }>[];
  readonly before: CacheState;
  readonly after: CacheState | null;
  readonly loadPath: CacheLoadPath;
  readonly changesApplied: boolean;
  readonly nextSteps: readonly string[];
  readonly exitCode: 0 | 1 | 2;
}

function marketplaceEntry(root: string): Readonly<{ name: string; pluginSource: string }> {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(root, ".claude-plugin/marketplace.json"), "utf8"),
  );
  const record =
    parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const name = record.name;
  if (typeof name !== "string" || !/^[a-z0-9-]{1,64}$/u.test(name))
    throw new Error("The Claude marketplace has no usable name.");
  const plugins = Array.isArray(record.plugins) ? (record.plugins as unknown[]) : [];
  const entry = plugins.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      (candidate as Record<string, unknown>).name === PLUGIN_NAME,
  ) as Record<string, unknown> | undefined;
  const pluginSource = entry?.source;
  if (typeof pluginSource !== "string" || !pluginSource.startsWith("./"))
    throw new Error("The Claude marketplace entry for wakeflow has no relative source path.");
  return { name, pluginSource };
}

/**
 * 宿主从哪里加载这个插件：读 `known_marketplaces.json` 里本 marketplace 的源。`directory` 源 =
 * 该目录加上 marketplace.json 里插件的相对 `source`（就地加载）；其他源 = 缓存目录；文件缺失或
 * 没有本 marketplace 的登记 = unknown（不能宣称刷新成功）。
 */
function loadPathState(
  knownMarketplaces: string,
  marketplace: string,
  pluginSource: string,
  installed: string,
  committedDigest: string,
): CacheLoadPath {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(knownMarketplaces, "utf8"));
  } catch {
    return {
      kind: "unknown",
      path: null,
      manifestDigest: null,
      matchesCommitted: false,
      reason: "known-marketplaces-unreadable",
    };
  }
  const entry =
    parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)[marketplace]
      : undefined;
  const source =
    entry !== null && typeof entry === "object"
      ? (entry as Record<string, unknown>).source
      : undefined;
  const sourceKind =
    source !== null && typeof source === "object"
      ? (source as Record<string, unknown>).source
      : undefined;
  if (typeof sourceKind !== "string") {
    return {
      kind: "unknown",
      path: null,
      manifestDigest: null,
      matchesCommitted: false,
      reason: "marketplace-unregistered",
    };
  }
  if (sourceKind === "directory") {
    const directory = (source as Record<string, unknown>).path;
    if (typeof directory !== "string" || directory.length === 0) {
      return {
        kind: "unknown",
        path: null,
        manifestDigest: null,
        matchesCommitted: false,
        reason: "directory-source-without-path",
      };
    }
    const loadRoot = path.resolve(directory, pluginSource);
    const state = cacheState(loadRoot, committedDigest);
    return {
      kind: "directory-marketplace",
      path: loadRoot,
      manifestDigest: state.manifestDigest,
      matchesCommitted: state.matchesCommitted,
      reason: state.present ? state.reason : "load-path-missing",
    };
  }
  const state = cacheState(installed, committedDigest);
  return {
    kind: "cache",
    path: installed,
    manifestDigest: state.manifestDigest,
    matchesCommitted: state.matchesCommitted,
    reason: state.present ? state.reason : "cache-missing",
  };
}

function loadPathSteps(loadPath: CacheLoadPath): readonly string[] {
  if (loadPath.kind === "directory-marketplace") {
    return [
      "the host loads this plugin in place from the checkout's artifact directory: a rebuild already changes the installed bytes (live sessions report runtime-artifact-outdated), and uninstall/install only refreshes the cache copy and the registered version",
    ];
  }
  if (loadPath.kind === "unknown")
    return [
      "the host's marketplace registration could not be read, so the loaded artifact is unverified",
    ];
  return [];
}

function cacheState(installed: string, committedDigest: string): CacheState {
  const stat = lstatSync(installed, { throwIfNoEntry: false });
  if (stat === undefined)
    return { present: false, manifestDigest: null, matchesCommitted: false, reason: null };
  try {
    const digest = sha256(verifyArtifactAgainstManifest(installed).manifestBytes);
    return {
      present: true,
      manifestDigest: digest,
      matchesCommitted: digest === committedDigest,
      reason: null,
    };
  } catch (error: unknown) {
    const reason =
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "installed-artifact-unreadable";
    return { present: true, manifestDigest: null, matchesCommitted: false, reason };
  }
}

function runHostCli(root: string, cli: string, args: readonly string[]): number | null {
  const result = spawnSync(cli, [...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  });
  if (result.error !== undefined) return null;
  return result.status;
}

export function refreshPluginCache(
  rootInput: string,
  request: CacheRefreshRequest,
): Readonly<CacheRefreshResult> {
  const root = path.resolve(rootInput);
  if (request.hostId !== "claude-code")
    throw new Error(
      "Only the claude-code cache refresh is supported; the Codex cache path is not confirmed in this repository.",
    );
  const committedRoot = path.join(root, "plugins", pluginDirectoryName("claude-code"));
  const committed = verifyArtifactAgainstManifest(committedRoot);
  const version = committed.manifest.version;
  if (typeof version !== "string") throw new Error("Committed artifact has no version.");
  const committedDigest = sha256(committed.manifestBytes);
  const { name: marketplace, pluginSource } = marketplaceEntry(root);
  const installed =
    request.installed === undefined
      ? path.join(os.homedir(), ".claude", "plugins", "cache", marketplace, PLUGIN_NAME, version)
      : path.resolve(root, request.installed);
  if (path.basename(installed) !== version)
    throw new Error("The installed directory must be the artifact's version directory.");
  const knownMarketplaces =
    request.knownMarketplaces === undefined
      ? path.join(os.homedir(), ".claude", "plugins", "known_marketplaces.json")
      : path.resolve(root, request.knownMarketplaces);
  const spec = `${PLUGIN_NAME}@${marketplace}`;
  const planned = [
    ["plugin", "uninstall", spec],
    ["plugin", "install", spec],
  ] as const;
  const before = cacheState(installed, committedDigest);
  const base = {
    kind: "WakeflowCacheRefresh" as const,
    schemaVersion: 1 as const,
    hostId: request.hostId,
    version,
    committedManifestDigest: committedDigest,
    installed,
    before,
  };
  if (!request.yes) {
    const loadPath = loadPathState(
      knownMarketplaces,
      marketplace,
      pluginSource,
      installed,
      committedDigest,
    );
    return Object.freeze({
      ...base,
      status: "passed",
      commands: planned.map((args) => ({ args, exitCode: null })),
      after: null,
      loadPath,
      changesApplied: false,
      nextSteps: [
        ...loadPathSteps(loadPath),
        "re-run with --yes to run the two host CLI commands",
        "then restart or resume every window so its MCP server and skills reload; hooks pick up the new bytes immediately",
      ],
      exitCode: 0,
    });
  }
  const cli = request.cli ?? "claude";
  const commands: Array<{ args: readonly string[]; exitCode: number | null }> = [];
  for (const args of planned) {
    const exitCode = runHostCli(root, cli, args);
    commands.push({ args, exitCode });
    // An uninstall of a plugin that is not installed may fail; the install result is what counts.
    if (args[1] === "install" && exitCode !== 0) break;
  }
  const after = cacheState(installed, committedDigest);
  const loadPath = loadPathState(
    knownMarketplaces,
    marketplace,
    pluginSource,
    installed,
    committedDigest,
  );
  const installExit = commands.find((entry) => entry.args[1] === "install")?.exitCode ?? null;
  // 成功的标准是宿主加载位置的清单与已提交一致；缓存副本一致只是登记正确。
  const status =
    installExit === null
      ? "unavailable"
      : installExit === 0 && after.matchesCommitted && loadPath.matchesCommitted
        ? "passed"
        : "failed";
  return Object.freeze({
    ...base,
    status,
    commands,
    after,
    loadPath,
    changesApplied: true,
    nextSteps: [
      ...loadPathSteps(loadPath),
      "restart or resume every window so its MCP server and skills reload; hooks already run the new bytes",
      "confirm with wakeflow_status that runtime.artifactManifestDigest equals the committed manifest digest",
    ],
    exitCode: status === "passed" ? 0 : status === "failed" ? 1 : 2,
  });
}
