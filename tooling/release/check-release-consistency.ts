import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PLUGIN_ENGINES_NODE,
  PLUGIN_NAME,
  isReleaseSeries,
  parseSemanticVersion,
  pluginDirectoryName,
  pluginManifestPath,
  readReleaseVersion,
} from "../artifacts/plugin-metadata.js";

/**
 * Wakeflow Tooling / Release：发布一致性门，`npm run release:check`（能力卡 10 Q5–Q7，场景
 * `card-10/release-consistency`）。
 *
 * 五个版本源——两个插件 `package.json`、两个插件清单、Claude marketplace 唯一的 `wakeflow`
 * 条目——必须等于唯一的版本输入 `assets/release/version.json`，且属于新序列（主版本号不低于 1）；
 * Codex marketplace 无版本字段（Q6）。两个插件与仓库根的 Node 引擎下限相同（Q7），并且本次运行
 * 的 Node 就在该范围内——没有门只靠文本核对引擎。两份 committed 清单必须 `releaseEligible` 且版本
 * 一致。Git 门按标志逐项开启：分支是 main、工作树干净、标签 `v<version>` 指向 HEAD、本地
 * `origin/main` 与 HEAD 同一提交——不取网络，本地远端引用过期则由推送流程负责刷新。这是提交后
 * 的严格门，不为让一次不完整的发布看起来合法而放宽。
 */

const CLAUDE_MARKETPLACE_PATH = ".claude-plugin/marketplace.json";
const MANIFEST_FILE = "artifact-manifest.json";
const MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;
const ENGINES_PATTERN = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/u;

export interface ReleaseCheckOptions {
  readonly requireMain?: boolean;
  readonly requireClean?: boolean;
  readonly requireTag?: boolean;
  readonly requireRemote?: boolean;
  /** committed 制品根；缺省 `plugins`。 */
  readonly committedRoot?: string;
  /** 本次运行的 Node 版本；缺省 `process.versions.node`，测试注入。 */
  readonly nodeVersion?: string;
}

export interface ReleaseVersionSource {
  readonly label: string;
  readonly path: string;
  readonly version: string;
}

export interface ReleaseCheckResult {
  readonly kind: "WakeflowReleaseCheckResult";
  readonly schemaVersion: 1;
  readonly version: string;
  readonly sources: readonly Readonly<ReleaseVersionSource>[];
  readonly enginesNode: string;
  readonly git: Readonly<{
    readonly branch: string | null;
    readonly clean: boolean | null;
    readonly tag: string | null;
    readonly remote: string | null;
  }>;
}

/** 发布一致性不成立时返回的稳定工具错误；`code` 指明哪一道门。 */
export class ReleaseCheckError extends Error {
  override readonly name = "ReleaseCheckError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new ReleaseCheckError(code, message);
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

function readJsonFile(repositoryRoot: string, relative: string): JsonRecord {
  const file = path.join(repositoryRoot, relative);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (
    stat === undefined ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size > MAXIMUM_JSON_BYTES
  ) {
    fail("wakeflow-release-source-missing", `${relative} is not one bounded regular file`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail("wakeflow-release-source-json", `${relative} is not valid JSON`);
  }
  if (!isPlainRecord(parsed))
    fail("wakeflow-release-source-json", `${relative} must be one object`);
  return parsed;
}

function marketplaceVersion(document: JsonRecord): unknown {
  if (!Array.isArray(document.plugins)) {
    fail("wakeflow-release-source-json", `${CLAUDE_MARKETPLACE_PATH} has no plugins array`);
  }
  const entries = document.plugins.filter(
    (entry: unknown) => isPlainRecord(entry) && entry.name === PLUGIN_NAME,
  );
  const [entry] = entries;
  if (entries.length !== 1 || !isPlainRecord(entry)) {
    fail(
      "wakeflow-release-source-json",
      `${CLAUDE_MARKETPLACE_PATH} must list exactly one ${PLUGIN_NAME} entry`,
    );
  }
  return entry.version;
}

/** 五个版本源，按固定顺序；每个都必须是 semver 且等于版本输入。 */
function collectVersionSources(
  repositoryRoot: string,
  committedRoot: string,
): readonly Readonly<ReleaseVersionSource>[] {
  const codex = pluginDirectoryName("codex");
  const claude = pluginDirectoryName("claude-code");
  const relativeCommitted = path.relative(repositoryRoot, committedRoot).split(path.sep).join("/");
  const definitions: readonly Readonly<{
    label: string;
    path: string;
    pick: (value: JsonRecord) => unknown;
  }>[] = [
    {
      label: "codex package",
      path: `${relativeCommitted}/${codex}/package.json`,
      pick: (v) => v.version,
    },
    {
      label: "codex plugin manifest",
      path: `${relativeCommitted}/${codex}/${pluginManifestPath("codex")}`,
      pick: (v) => v.version,
    },
    {
      label: "claude package",
      path: `${relativeCommitted}/${claude}/package.json`,
      pick: (v) => v.version,
    },
    {
      label: "claude plugin manifest",
      path: `${relativeCommitted}/${claude}/${pluginManifestPath("claude-code")}`,
      pick: (v) => v.version,
    },
    { label: "claude marketplace", path: CLAUDE_MARKETPLACE_PATH, pick: marketplaceVersion },
  ];
  return Object.freeze(
    definitions.map((definition) =>
      Object.freeze({
        label: definition.label,
        path: definition.path,
        version: parseSemanticVersion(
          definition.pick(readJsonFile(repositoryRoot, definition.path)),
          definition.label,
        ),
      }),
    ),
  );
}

function checkEngines(repositoryRoot: string, committedRoot: string, nodeVersion: string): void {
  const bounds = ENGINES_PATTERN.exec(PLUGIN_ENGINES_NODE);
  if (bounds === null) fail("wakeflow-release-engines", "the plugin engines range is malformed");
  const relativeCommitted = path.relative(repositoryRoot, committedRoot).split(path.sep).join("/");
  for (const relative of [
    "package.json",
    `${relativeCommitted}/${pluginDirectoryName("codex")}/package.json`,
    `${relativeCommitted}/${pluginDirectoryName("claude-code")}/package.json`,
  ]) {
    const engines = readJsonFile(repositoryRoot, relative).engines;
    if (!isPlainRecord(engines) || engines.node !== PLUGIN_ENGINES_NODE) {
      fail(
        "wakeflow-release-engines",
        `${relative} does not pin engines.node to ${PLUGIN_ENGINES_NODE}`,
      );
    }
  }
  const running = /^(\d+)\.(\d+)\.(\d+)/u.exec(nodeVersion);
  if (running === null) fail("wakeflow-release-node", "the running Node version is unreadable");
  const major = Number.parseInt(running[1] ?? "", 10);
  const minor = Number.parseInt(running[2] ?? "", 10);
  const patch = Number.parseInt(running[3] ?? "", 10);
  const minimumMajor = Number.parseInt(bounds[1] ?? "", 10);
  const minimumMinor = Number.parseInt(bounds[2] ?? "", 10);
  const minimumPatch = Number.parseInt(bounds[3] ?? "", 10);
  const exclusiveMajor = Number.parseInt(bounds[4] ?? "", 10);
  const atLeastMinimum =
    major > minimumMajor ||
    (major === minimumMajor &&
      (minor > minimumMinor || (minor === minimumMinor && patch >= minimumPatch)));
  if (!atLeastMinimum || major >= exclusiveMajor) {
    fail(
      "wakeflow-release-node",
      `Node ${nodeVersion} is outside ${PLUGIN_ENGINES_NODE}; the gate must run on the release runtime`,
    );
  }
}

function checkManifests(repositoryRoot: string, committedRoot: string, version: string): void {
  for (const hostId of ["codex", "claude-code"] as const) {
    const relative = `${path.relative(repositoryRoot, committedRoot).split(path.sep).join("/")}/${pluginDirectoryName(hostId)}/${MANIFEST_FILE}`;
    const manifest = readJsonFile(repositoryRoot, relative);
    if (manifest.kind !== "WakeflowPluginArtifactManifest" || manifest.version !== version) {
      fail("wakeflow-release-manifest", `${relative} is not the plugin manifest for ${version}`);
    }
    if (manifest.releaseEligible !== true) {
      fail("wakeflow-release-manifest", `${relative} is not release eligible`);
    }
  }
}

/**
 * 清单里的每个路径都必须被 Git 跟踪。`build:check` 对比的是工作树，抓不到"文件在磁盘上却没进
 * Git"——2026-09-20 切换时根 `.gitignore` 的 `dist/` 就漏掉了 314 个运行时依赖文件；干净树也证明
 * 不了这一点，因为被忽略的文件既不算未跟踪也不算已跟踪。
 */
function checkArtifactTracking(repositoryRoot: string, committedRoot: string): void {
  for (const hostId of ["codex", "claude-code"] as const) {
    const directory = `${path.relative(repositoryRoot, committedRoot).split(path.sep).join("/")}/${pluginDirectoryName(hostId)}`;
    const listed = git(repositoryRoot, ["ls-files", "-z", "--", directory]);
    if (listed === null) fail("wakeflow-release-git", `git ls-files failed for ${directory}`);
    const tracked = new Set(listed.split("\0").filter((entry) => entry.length > 0));
    const manifest = readJsonFile(repositoryRoot, `${directory}/${MANIFEST_FILE}`);
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    for (const relative of [
      MANIFEST_FILE,
      ...files.map((entry: unknown) => (isPlainRecord(entry) ? entry.path : undefined)),
    ]) {
      if (typeof relative !== "string" || !tracked.has(`${directory}/${relative}`)) {
        fail(
          "wakeflow-release-untracked",
          `${directory}/${String(relative)} is listed in the manifest but not tracked by Git`,
        );
      }
    }
  }
}

/** 一次切换提交前后的 `git status` 可以有上万行，缓冲区按此上限给足；超出即当作 Git 失败。 */
const MAXIMUM_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

function git(repositoryRoot: string, args: readonly string[]): string | null {
  const result = spawnSync("git", [...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    shell: false,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: MAXIMUM_GIT_OUTPUT_BYTES,
  });
  if (result.error !== undefined || result.status !== 0) return null;
  return result.stdout;
}

function checkGit(
  repositoryRoot: string,
  version: string,
  options: Readonly<ReleaseCheckOptions>,
): ReleaseCheckResult["git"] {
  const head = git(repositoryRoot, ["rev-parse", "--verify", "HEAD"])?.trim() ?? null;
  if (head === null) fail("wakeflow-release-git", "the repository has no HEAD commit");
  let branch: string | null = null;
  if (options.requireMain === true) {
    branch = git(repositoryRoot, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim() ?? null;
    if (branch !== "main")
      fail(
        "wakeflow-release-branch",
        `release must be checked on main, not ${branch ?? "<detached>"}`,
      );
  }
  let clean: boolean | null = null;
  if (options.requireClean === true) {
    const status = git(repositoryRoot, ["status", "--porcelain", "--untracked-files=all"]);
    if (status === null) fail("wakeflow-release-git", "git status failed");
    clean = status.trim().length === 0;
    if (!clean) fail("wakeflow-release-dirty", "the working tree is not clean");
  }
  let tag: string | null = null;
  if (options.requireTag === true) {
    tag = `v${version}`;
    const tagged =
      git(repositoryRoot, ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`])?.trim() ?? null;
    if (tagged !== head) fail("wakeflow-release-tag", `tag ${tag} does not point at HEAD`);
  }
  let remote: string | null = null;
  if (options.requireRemote === true) {
    remote =
      git(repositoryRoot, ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"])?.trim() ??
      null;
    if (remote !== head)
      fail("wakeflow-release-remote", "local origin/main is not at HEAD; push or fetch first");
  }
  return Object.freeze({ branch, clean, tag, remote });
}

export function checkWakeflowReleaseConsistency(
  repositoryRootInput: string,
  options: Readonly<ReleaseCheckOptions> = {},
): Readonly<ReleaseCheckResult> {
  const repositoryRoot = path.resolve(repositoryRootInput);
  const committedRoot = path.resolve(repositoryRoot, options.committedRoot ?? "plugins");
  const release = readReleaseVersion(repositoryRoot);
  if (!isReleaseSeries(release.version)) {
    fail("wakeflow-release-series", `${release.version} is not in the release series (major >= 1)`);
  }
  const sources = collectVersionSources(repositoryRoot, committedRoot);
  for (const source of sources) {
    if (source.version !== release.version) {
      fail(
        "wakeflow-release-version-drift",
        `${source.label} (${source.path}) is ${source.version}, expected ${release.version}`,
      );
    }
  }
  checkEngines(repositoryRoot, committedRoot, options.nodeVersion ?? process.versions.node);
  checkManifests(repositoryRoot, committedRoot, release.version);
  const gitFacts = checkGit(repositoryRoot, release.version, options);
  checkArtifactTracking(repositoryRoot, committedRoot);
  return Object.freeze({
    kind: "WakeflowReleaseCheckResult",
    schemaVersion: 1,
    version: release.version,
    sources,
    enginesNode: PLUGIN_ENGINES_NODE,
    git: gitFacts,
  });
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && path.resolve(invoked) === fileURLToPath(import.meta.url);
}

function parseCommandLine(values: readonly string[]): Readonly<ReleaseCheckOptions> {
  const options = {
    requireMain: false,
    requireClean: false,
    requireTag: false,
    requireRemote: false,
  };
  for (const value of values) {
    if (value === "--require-main") options.requireMain = true;
    else if (value === "--require-clean") options.requireClean = true;
    else if (value === "--require-tag") options.requireTag = true;
    else if (value === "--require-remote") options.requireRemote = true;
    else fail("wakeflow-release-argv", `unknown option ${value}`);
  }
  return Object.freeze(options);
}

function runAsMain(): void {
  try {
    const result = checkWakeflowReleaseConsistency(
      process.cwd(),
      parseCommandLine(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write("wakeflow-release-unexpected: release consistency check failed\n");
    }
    process.exitCode = 1;
  }
}

if (isMainModule()) runAsMain();
