#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  evaluateWakeflowPackageReport,
  wakeflowReleasePackagingContract,
} from "./lib/wakeflow-release-packaging-contract.mjs";

const MAX_RELEASE_JSON_BYTES = 2 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 8 * 1024 * 1024;
const RELEASE_FIXTURE_ROOT = "test/fixtures/legacy-origins";
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

/** 发布版本证据只接受稳定、单链接、有限大小的真实JSON文件。 */
function readJson(file, label) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} is missing`);
    throw new Error(`${label} cannot be inspected: ${error.message}`);
  }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n) {
    throw new Error(`${label} must be one regular non-symlink single-link file`);
  }
  if (before.size > BigInt(MAX_RELEASE_JSON_BYTES)) {
    throw new Error(`${label} exceeds ${MAX_RELEASE_JSON_BYTES} bytes`);
  }

  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFileIdentity(before, opened)) {
      throw new Error(`${label} changed before it could be read`);
    }
    const bytes = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    if (!sameFileIdentity(opened, afterRead) || !sameFileIdentity(opened, afterPath)) {
      throw new Error(`${label} changed while it was being read`);
    }
    try {
      return JSON.parse(utf8Decoder.decode(bytes));
    } catch (error) {
      throw new Error(`${label} is not valid UTF-8 JSON: ${error.message}`);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: 120000,
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? null,
  };
}

function git(repoRoot, args) {
  const result = run("git", args, repoRoot);
  return {
    ...result,
    value: result.ok ? result.stdout.trim() : null,
  };
}

/** Git使用NUL分隔返回路径，避免特殊文件名破坏source-closure计数。 */
function countNulSeparatedPaths(value) {
  if (!value) return 0;
  return value.split("\0").filter(Boolean).length;
}

export function collectReleaseVersionSources(repoRoot) {
  const definitions = [
    ["codex package", "plugins/codex-wakeflow/package.json", (value) => value.version],
    ["codex plugin manifest", "plugins/codex-wakeflow/.codex-plugin/plugin.json", (value) => value.version],
    ["claude package", "plugins/claude-code-wakeflow/package.json", (value) => value.version],
    ["claude plugin manifest", "plugins/claude-code-wakeflow/.claude-plugin/plugin.json", (value) => value.version],
    ["claude marketplace", ".claude-plugin/marketplace.json", (value) => {
      const matches = Array.isArray(value.plugins)
        ? value.plugins.filter((entry) => entry?.name === "wakeflow")
        : [];
      if (matches.length !== 1) throw new Error("must contain exactly one plugin named wakeflow");
      return matches[0].version;
    }],
  ];
  return definitions.map(([label, relative, pick]) => {
    const file = path.join(repoRoot, relative);
    try {
      const value = pick(readJson(file, relative));
      if (typeof value !== "string" || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value)) {
        throw new Error("release version must be one explicit semantic version string");
      }
      return { label, relative, value, error: null };
    } catch (error) {
      return { label, relative, value: null, error: error.message };
    }
  });
}

function commandFailure(result) {
  return (result.error || result.stderr || result.stdout || `exit status ${result.status ?? "unknown"}`).trim();
}

function inspectPack({ repoRoot, hostId, version }) {
  const contract = wakeflowReleasePackagingContract(hostId);
  const result = run("npm", [
    "pack",
    "--workspace", contract.workspace,
    "--dry-run",
    "--json",
    "--ignore-scripts",
  ], repoRoot);
  if (!result.ok) {
    return {
      ok: false,
      hostId,
      workspace: contract.workspace,
      issues: [`npm pack --dry-run failed for ${contract.workspace}: ${commandFailure(result)}`],
    };
  }
  try {
    const pack = JSON.parse(result.stdout)?.[0];
    return evaluateWakeflowPackageReport({ hostId, expectedVersion: version, report: pack });
  } catch (error) {
    return {
      ok: false,
      hostId,
      workspace: contract.workspace,
      issues: [`cannot parse ${contract.workspace} pack report: ${error.message}`],
    };
  }
}

export function checkReleaseConsistency({
  repoRoot,
  requireMain = false,
  requireClean = false,
  requireTag = false,
  requireRemote = false,
  inspectPacks = true,
} = {}) {
  const root = path.resolve(repoRoot ?? path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const issues = [];
  const warnings = [];
  const sources = collectReleaseVersionSources(root);
  for (const source of sources) {
    if (!source.value) {
      issues.push(`${source.label} has no trustworthy release version at ${source.relative}: ${source.error ?? "missing value"}`);
    }
  }
  const versions = new Set(sources.map((source) => source.value).filter(Boolean));
  if (versions.size > 1) {
    issues.push(`release version drift: ${sources.map((source) => `${source.label}=${source.value}`).join(", ")}`);
  }
  const version = versions.size === 1 ? [...versions][0] : null;

  const coreCheck = run(process.execPath, [path.join(root, "tools/sync-core.mjs"), "--check", "--repo-root", root], root);
  if (!coreCheck.ok) issues.push(`shared core check failed: ${commandFailure(coreCheck)}`);

  const branchCheck = git(root, ["branch", "--show-current"]);
  const headCheck = git(root, ["rev-parse", "HEAD"]);
  const statusCheck = git(root, ["status", "--porcelain=v1"]);
  const remoteMainCheck = git(root, ["rev-parse", "--verify", "refs/remotes/origin/main"]);
  // 历史fixture会故意携带`.gitignore`、`.wakeflow-local`和Claude本地设置。
  // 普通status会隐藏未跟踪的这些字节，因此release必须单独检查Git source closure。
  const ignoredFixtureCheck = git(root, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "-z",
    "--",
    RELEASE_FIXTURE_ROOT,
  ]);
  const branch = branchCheck.value;
  const head = headCheck.value;
  const status = statusCheck.value;
  const remoteMain = remoteMainCheck.value;
  const tag = version ? `v${version}` : null;
  const tagCommitCheck = tag ? git(root, ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]) : null;
  const tagCommit = tagCommitCheck?.value ?? null;

  for (const [label, evidence] of [
    ["branch", branchCheck],
    ["HEAD", headCheck],
    ["worktree status", statusCheck],
    ["historical fixture source closure", ignoredFixtureCheck],
  ]) {
    if (!evidence.ok) issues.push(`git ${label} inspection failed: ${commandFailure(evidence)}`);
  }
  if (remoteMainCheck.error) issues.push(`git origin/main inspection failed: ${commandFailure(remoteMainCheck)}`);
  if (tagCommitCheck?.error) issues.push(`git ${tag} inspection failed: ${commandFailure(tagCommitCheck)}`);

  const clean = statusCheck.ok ? status === "" : null;
  const ignoredUntrackedFixtureFiles = ignoredFixtureCheck.ok
    ? countNulSeparatedPaths(ignoredFixtureCheck.value)
    : null;
  const tagMatchesHead = Boolean(headCheck.ok && tagCommitCheck?.ok && tagCommit === head);
  const remoteMatchesHead = Boolean(headCheck.ok && remoteMainCheck.ok && remoteMain === head);

  if (requireMain && branch !== "main") issues.push(`release branch must be main; got ${branch || "(detached)"}`);
  if (requireClean && clean !== true) issues.push("release worktree must be verified clean");
  if (ignoredUntrackedFixtureFiles > 0) {
    const message = `${ignoredUntrackedFixtureFiles} historical fixture files are physically present but excluded from the Git source closure; stage the exact fixture tree explicitly before release`;
    if (requireClean) issues.push(message);
    else warnings.push(message);
  }
  if (requireTag && !tagMatchesHead) {
    issues.push(`${tag ?? "release tag"} must exist and point at HEAD`);
  }
  if (requireRemote && !remoteMatchesHead) {
    issues.push(`local origin/main ${remoteMain ?? "(missing)"} does not point at HEAD ${head ?? "(missing)"}`);
  }
  if (!requireTag && !tagMatchesHead) warnings.push(`${tag ?? "release tag"} does not currently point at HEAD`);
  if (!requireRemote && !remoteMatchesHead) warnings.push("local origin/main does not currently point at HEAD");
  if (!requireClean && clean === false) warnings.push("worktree is dirty; strict release check would refuse it");
  if (!requireClean && clean === null) warnings.push("worktree cleanliness could not be verified");

  const packs = inspectPacks && version
    ? [
        inspectPack({
          repoRoot: root,
          hostId: "codex",
          version,
        }),
        inspectPack({
          repoRoot: root,
          hostId: "claude-code",
          version,
        }),
      ]
    : [];
  for (const pack of packs) issues.push(...pack.issues);

  return {
    ok: issues.length === 0,
    version,
    versions: sources,
    git: {
      branch,
      head,
      clean,
      tag,
      tagCommit,
      remoteMain,
      remoteStateSource: "local refs/remotes/origin/main (no network fetch)",
      evidence: {
        branch: { ok: branchCheck.ok, status: branchCheck.status },
        head: { ok: headCheck.ok, status: headCheck.status },
        status: { ok: statusCheck.ok, status: statusCheck.status },
        tag: tagCommitCheck ? { ok: tagCommitCheck.ok, status: tagCommitCheck.status } : null,
        remoteMain: { ok: remoteMainCheck.ok, status: remoteMainCheck.status },
        historicalFixtureSourceClosure: {
          ok: ignoredFixtureCheck.ok,
          status: ignoredFixtureCheck.status,
        },
      },
    },
    sourceClosure: {
      fixtureRoot: RELEASE_FIXTURE_ROOT,
      ignoredUntrackedFixtureFiles,
    },
    core: { ok: coreCheck.ok },
    packs,
    issues,
    warnings,
  };
}

function parseCliArgs(args) {
  const parsed = {
    repoRoot: null,
    requireMain: false,
    requireClean: false,
    requireTag: false,
    requireRemote: false,
    inspectPacks: true,
    json: false,
  };
  const seen = new Set();
  const booleanOptions = new Map([
    ["--require-main", ["requireMain", true]],
    ["--require-clean", ["requireClean", true]],
    ["--require-tag", ["requireTag", true]],
    ["--require-remote", ["requireRemote", true]],
    ["--skip-pack", ["inspectPacks", false]],
    ["--json", ["json", true]],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (booleanOptions.has(arg)) {
      if (seen.has(arg)) cliFailure(`${arg} may be provided only once`);
      seen.add(arg);
      const [key, value] = booleanOptions.get(arg);
      parsed[key] = value;
      continue;
    }
    if (arg === "--repo-root" || arg.startsWith("--repo-root=")) {
      if (seen.has("--repo-root")) cliFailure("--repo-root may be provided only once");
      seen.add("--repo-root");
      const value = arg === "--repo-root" ? args[++index] : arg.slice("--repo-root=".length);
      if (!value || value.startsWith("--")) cliFailure("--repo-root requires one non-option path");
      parsed.repoRoot = value;
      continue;
    }
    cliFailure(`unknown argument: ${arg}`);
  }
  return parsed;
}

function cliFailure(message) {
  console.error(JSON.stringify({
    ok: false,
    error: { code: "wakeflow-release-check-argv", message },
  }));
  process.exit(64);
}

function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const result = checkReleaseConsistency({
    repoRoot: cli.repoRoot,
    requireMain: cli.requireMain,
    requireClean: cli.requireClean,
    requireTag: cli.requireTag,
    requireRemote: cli.requireRemote,
    inspectPacks: cli.inspectPacks,
  });
  if (cli.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`Wakeflow ${result.version} release consistency check passed.`);
    for (const warning of result.warnings) console.log(`Warning: ${warning}`);
  } else {
    console.error("Wakeflow release consistency check failed:");
    for (const issue of result.issues) console.error(`- ${issue}`);
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
