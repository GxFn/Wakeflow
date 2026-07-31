#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function git(repoRoot, args) {
  const result = run("git", args, repoRoot);
  return result.ok ? result.stdout.trim() : null;
}

function versionSources(repoRoot) {
  return [
    ["codex package", "plugins/codex-wakeflow/package.json", (value) => value.version],
    ["codex plugin manifest", "plugins/codex-wakeflow/.codex-plugin/plugin.json", (value) => value.version],
    ["claude package", "plugins/claude-code-wakeflow/package.json", (value) => value.version],
    ["claude plugin manifest", "plugins/claude-code-wakeflow/.claude-plugin/plugin.json", (value) => value.version],
    ["claude marketplace", ".claude-plugin/marketplace.json", (value) => value.plugins?.[0]?.version],
  ].map(([label, relative, pick]) => {
    const file = path.join(repoRoot, relative);
    return { label, relative, value: existsSync(file) ? pick(readJson(file)) : null };
  });
}

function inspectPack({ repoRoot, workspace, version, requiredFiles }) {
  const result = run("npm", [
    "pack",
    "--workspace", workspace,
    "--dry-run",
    "--json",
    "--ignore-scripts",
  ], repoRoot);
  if (!result.ok) {
    return {
      ok: false,
      workspace,
      issues: [`npm pack --dry-run failed for ${workspace}: ${(result.stderr || result.stdout).trim()}`],
    };
  }
  try {
    const pack = JSON.parse(result.stdout)?.[0];
    const files = new Set((pack?.files ?? []).map((entry) => entry.path));
    const issues = [];
    if (pack?.version !== version) {
      issues.push(`${workspace} pack version ${pack?.version ?? "(missing)"} does not match ${version}`);
    }
    for (const required of requiredFiles) {
      if (!files.has(required)) issues.push(`${workspace} pack is missing ${required}`);
    }
    return {
      ok: issues.length === 0,
      workspace,
      name: pack?.name ?? null,
      version: pack?.version ?? null,
      entryCount: pack?.entryCount ?? files.size,
      issues,
    };
  } catch (error) {
    return { ok: false, workspace, issues: [`cannot parse ${workspace} pack report: ${error.message}`] };
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
  const sources = versionSources(root);
  for (const source of sources) {
    if (!source.value) issues.push(`${source.label} has no release version at ${source.relative}`);
  }
  const versions = new Set(sources.map((source) => source.value).filter(Boolean));
  if (versions.size > 1) {
    issues.push(`release version drift: ${sources.map((source) => `${source.label}=${source.value}`).join(", ")}`);
  }
  const version = versions.size === 1 ? [...versions][0] : null;

  const coreCheck = run(process.execPath, [path.join(root, "tools/sync-core.mjs"), "--check", "--repo-root", root], root);
  if (!coreCheck.ok) issues.push(`shared core check failed: ${(coreCheck.stderr || coreCheck.stdout).trim()}`);

  const branch = git(root, ["branch", "--show-current"]);
  const head = git(root, ["rev-parse", "HEAD"]);
  const status = git(root, ["status", "--porcelain=v1"]);
  const remoteMain = git(root, ["rev-parse", "--verify", "refs/remotes/origin/main"]);
  const tag = version ? `v${version}` : null;
  const tagCommit = tag ? git(root, ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]) : null;

  if (requireMain && branch !== "main") issues.push(`release branch must be main; got ${branch || "(detached)"}`);
  if (requireClean && status) issues.push("release worktree is not clean");
  if (requireTag && tagCommit !== head) {
    issues.push(`${tag ?? "release tag"} must exist and point at HEAD`);
  }
  if (requireRemote && remoteMain !== head) {
    issues.push(`local origin/main ${remoteMain ?? "(missing)"} does not point at HEAD ${head ?? "(missing)"}`);
  }
  if (!requireTag && tagCommit !== head) warnings.push(`${tag ?? "release tag"} does not currently point at HEAD`);
  if (!requireRemote && remoteMain !== head) warnings.push("local origin/main does not currently point at HEAD");
  if (!requireClean && status) warnings.push("worktree is dirty; strict release check would refuse it");

  const packs = inspectPacks && version
    ? [
        inspectPack({
          repoRoot: root,
          workspace: "wakeflow",
          version,
          requiredFiles: [
            "package.json",
            ".codex-plugin/plugin.json",
            ".mcp.json",
            "scripts/wakeflow-core-manifest.json",
            "skills/wakeflow-controller/SKILL.md",
            "templates/wakeflow-template-bundle.json",
          ],
        }),
        inspectPack({
          repoRoot: root,
          workspace: "claude-code-wakeflow",
          version,
          requiredFiles: [
            "package.json",
            ".claude-plugin/plugin.json",
            ".mcp.json",
            "scripts/wakeflow-core-manifest.json",
            "skills/wakeflow-controller/SKILL.md",
            "templates/wakeflow-template-bundle.json",
          ],
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
      clean: !status,
      tag,
      tagCommit,
      remoteMain,
      remoteStateSource: "local refs/remotes/origin/main (no network fetch)",
    },
    core: { ok: coreCheck.ok },
    packs,
    issues,
    warnings,
  };
}

function cliValue(name, fallback = null) {
  const args = process.argv.slice(2);
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : fallback;
}

function main() {
  const args = process.argv.slice(2);
  const result = checkReleaseConsistency({
    repoRoot: cliValue("--repo-root"),
    requireMain: args.includes("--require-main"),
    requireClean: args.includes("--require-clean"),
    requireTag: args.includes("--require-tag"),
    requireRemote: args.includes("--require-remote"),
    inspectPacks: !args.includes("--skip-pack"),
  });
  if (args.includes("--json")) {
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
