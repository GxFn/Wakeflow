import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyArtifactAgainstManifest } from "../artifacts/check-plugin-artifacts.js";
import { PLUGIN_NAME, pluginDirectoryName } from "../artifacts/plugin-metadata.js";
import { sha256 } from "../verification/files.js";

/**
 * Wakeflow Tooling / Cache refresh：把已提交的 Claude Code 制品重新装进宿主的插件缓存。
 *
 * `claude plugin update` 在版本号不变时报告"已是最新"，所以刷新是 `uninstall` 再 `install` 两步
 * （memory：test workspace）。本命令只在 `--yes` 下执行宿主 CLI；前后各核对一次缓存目录里的制品
 * 清单摘要，并与已提交制品比较。缓存刷新不等于窗口已重载：hook 立即生效，MCP 服务与技能要等
 * 窗口重启或 resume。Codex 的缓存路径未在本仓库确认，按 unavailable 报告。
 */

export interface CacheRefreshRequest {
  readonly hostId: string;
  readonly yes: boolean;
  /** 宿主 CLI 可执行文件；缺省 `claude`，测试注入桩。 */
  readonly cli?: string;
  /** 缓存里的版本目录；缺省 `~/.claude/plugins/cache/<marketplace>/wakeflow/<version>`。 */
  readonly installed?: string;
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
  readonly changesApplied: boolean;
  readonly nextSteps: readonly string[];
  readonly exitCode: 0 | 1 | 2;
}

function marketplaceName(root: string): string {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(root, ".claude-plugin/marketplace.json"), "utf8"),
  );
  const name =
    parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>).name : null;
  if (typeof name !== "string" || !/^[a-z0-9-]{1,64}$/u.test(name))
    throw new Error("The Claude marketplace has no usable name.");
  return name;
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
  const marketplace = marketplaceName(root);
  const installed =
    request.installed === undefined
      ? path.join(os.homedir(), ".claude", "plugins", "cache", marketplace, PLUGIN_NAME, version)
      : path.resolve(root, request.installed);
  if (path.basename(installed) !== version)
    throw new Error("The installed directory must be the artifact's version directory.");
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
    return Object.freeze({
      ...base,
      status: "passed",
      commands: planned.map((args) => ({ args, exitCode: null })),
      after: null,
      changesApplied: false,
      nextSteps: [
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
  const installExit = commands.find((entry) => entry.args[1] === "install")?.exitCode ?? null;
  const status =
    installExit === null
      ? "unavailable"
      : installExit === 0 && after.matchesCommitted
        ? "passed"
        : "failed";
  return Object.freeze({
    ...base,
    status,
    commands,
    after,
    changesApplied: true,
    nextSteps: [
      "restart or resume every window so its MCP server and skills reload; hooks already run the new bytes",
      "confirm with wakeflow_status that runtime.artifactManifestDigest equals the committed manifest digest",
    ],
    exitCode: status === "passed" ? 0 : status === "failed" ? 1 : 2,
  });
}
