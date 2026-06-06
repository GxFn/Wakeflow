#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { getArgValue, loadWorkspaceConfig, resolveConfigPath } from "./lib/workspace-config.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const fix = args.includes("--fix");
const workspaceRoot = path.resolve(getArgValue(args, "--root", process.cwd()));
const workspaceConfig = loadWorkspaceConfig({ workspaceRoot, args });

const residueRules = [
  {
    relPath: ".asd",
    kind: "alembic-runtime-data",
    message: "Alembic runtime data must not live in workspace source repositories.",
  },
  {
    relPath: ".cursor/skills",
    kind: "cursor-skill-projection",
    message: "Editor skill projections must not be generated into source repositories.",
  },
  {
    relPath: ".agents/skills",
    kind: "codex-project-skill-projection",
    message: "Codex project skill projections require explicit current-plan authorization.",
  },
  {
    relPath: ".agents/.DS_Store",
    kind: "os-noise",
    message: "OS noise under local agent folders should not remain in workspace repositories.",
  },
];

const allowedResiduePaths = new Set(
  [
    ...(Array.isArray(workspaceConfig.allowedRepositoryResiduePaths)
      ? workspaceConfig.allowedRepositoryResiduePaths
      : []),
  ].filter(Boolean)
);

function isAllowed(repo, relPath) {
  const candidates = [
    relPath,
    `${repo.windowName}:${relPath}`,
    `${path.basename(repo.path)}:${relPath}`,
  ];
  return candidates.some((candidate) => allowedResiduePaths.has(candidate));
}

function isDirectory(value) {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function gitTrackedPaths(repoRoot, relPath) {
  if (!isDirectory(path.join(repoRoot, ".git"))) {
    return [];
  }
  try {
    return execFileSync("git", ["-C", repoRoot, "ls-files", relPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function removeEmptyDir(dir) {
  if (!isDirectory(dir)) {
    return false;
  }
  if (readdirSync(dir).length > 0) {
    return false;
  }
  rmSync(dir, { recursive: true, force: true });
  return true;
}

function cleanupEmptyParents(repoRoot, relPath, fixed) {
  const segments = relPath.split("/");
  while (segments.length > 1) {
    segments.pop();
    const parentRel = segments.join("/");
    const parentAbs = path.join(repoRoot, parentRel);
    if (!removeEmptyDir(parentAbs)) {
      return;
    }
    fixed.push(parentRel);
  }
}

function scanRepository(repo) {
  const repoRoot = resolveConfigPath(workspaceRoot, repo.path);
  const entries = [];
  const fixed = [];
  const missing = !isDirectory(repoRoot);
  if (missing) {
    return { repo, repoRoot, missing, entries, fixed };
  }

  const repoAllow = new Set(Array.isArray(repo.allowedResiduePaths) ? repo.allowedResiduePaths : []);
  for (const rule of residueRules) {
    if (repoAllow.has(rule.relPath) || isAllowed(repo, rule.relPath)) {
      continue;
    }

    const absPath = path.join(repoRoot, rule.relPath);
    if (!existsSync(absPath)) {
      continue;
    }

    const trackedPaths = gitTrackedPaths(repoRoot, rule.relPath);
    const tracked = trackedPaths.length > 0;
    const fixable = !tracked;
    const entry = {
      windowName: repo.windowName,
      repoPath: repo.path,
      absolutePath: absPath,
      relPath: rule.relPath,
      kind: rule.kind,
      message: rule.message,
      tracked,
      trackedPaths,
      fixable,
      fixed: false,
    };

    if (fix && fixable) {
      rmSync(absPath, { recursive: true, force: true });
      entry.fixed = true;
      fixed.push(rule.relPath);
      cleanupEmptyParents(repoRoot, rule.relPath, fixed);
    }

    entries.push(entry);
  }

  return { repo, repoRoot, missing, entries, fixed };
}

const repositories = Array.isArray(workspaceConfig.repositories) ? workspaceConfig.repositories : [];
const scanned = repositories.map(scanRepository);
const residue = scanned.flatMap((result) => result.entries);
const blocking = residue.filter((entry) => !entry.fixed);
const result = {
  ok: blocking.length === 0,
  fix,
  residueCount: residue.length,
  blockingCount: blocking.length,
  residue,
  fixed: scanned.flatMap((item) =>
    item.fixed.map((relPath) => ({
      windowName: item.repo.windowName,
      repoPath: item.repo.path,
      relPath,
    }))
  ),
  missingRepositories: scanned
    .filter((item) => item.missing)
    .map((item) => ({ windowName: item.repo.windowName, repoPath: item.repo.path })),
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("Repository residue check completed.");
  console.log(`Fix mode: ${fix ? "yes" : "no"}`);
  console.log(`Residue entries: ${residue.length}`);
  console.log(`Blocking entries: ${blocking.length}`);

  if (residue.length > 0) {
    console.log("");
    console.log("| Window | Path | Kind | State |");
    console.log("| --- | --- | --- | --- |");
    for (const entry of residue) {
      const state = entry.fixed ? "fixed" : entry.tracked ? "tracked-blocked" : "needs-cleanup";
      console.log(
        `| ${entry.windowName} | ${entry.relPath.replaceAll("|", "\\|")} | ${entry.kind} | ${state} |`
      );
    }
  }

  if (result.missingRepositories.length > 0) {
    console.log("");
    console.log("Missing repositories:");
    for (const repo of result.missingRepositories) {
      console.log(`- ${repo.windowName}: ${repo.repoPath}`);
    }
  }
}

if (!result.ok) {
  process.exitCode = 1;
}
