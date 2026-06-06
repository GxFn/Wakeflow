#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadWorkspaceConfig } from "./lib/workspace-config.mjs";

const workspaceRoot = process.cwd();
const args = process.argv.slice(2);
const json = args.includes("--json");

function getArgValue(name) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const workspaceConfig = loadWorkspaceConfig({ workspaceRoot, args });
const repoNames = workspaceConfig.repoNames;
const allowMissingRepos = workspaceConfig.allowMissingRepos === true;
const configuredRepositories = new Map(
  (workspaceConfig.repositories ?? []).map((repo) => [repo.windowName, repo]),
);

function runGit(repoPath, args, options = {}) {
  try {
    const output = execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (options.preserveStatusPrefix) {
      return output.replace(/\r?\n$/, "");
    }
    return output.trim();
  } catch {
    return null;
  }
}

function parseStatus(statusText) {
  const lines = statusText.split("\n").filter(Boolean);
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;

  for (const line of lines) {
    if (line.startsWith("??")) {
      untracked += 1;
      continue;
    }

    if (line[0] && line[0] !== " ") {
      staged += 1;
    }

    if (line[1] && line[1] !== " ") {
      unstaged += 1;
    }
  }

  return {
    dirty: lines.length > 0,
    staged,
    unstaged,
    untracked,
    totalChanges: lines.length,
  };
}

function repoPathForName(name) {
  const configured = configuredRepositories.get(name);
  return configured?.path ? path.resolve(workspaceRoot, configured.path) : path.join(workspaceRoot, name);
}

function inspectRepo(name) {
  const repoPath = repoPathForName(name);
  const relativePath = path.relative(workspaceRoot, repoPath) || ".";
  const exists = existsSync(repoPath);

  if (!exists) {
    return { name, path: relativePath, exists: false, git: false };
  }

  const insideWorkTree = runGit(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree !== "true") {
    return { name, path: relativePath, exists: true, git: false };
  }

  const branch = runGit(repoPath, ["branch", "--show-current"]) || "(detached)";
  const head = runGit(repoPath, ["rev-parse", "HEAD"]) || "";
  const upstream = runGit(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const aheadBehind = upstream ? runGit(repoPath, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]) : null;
  const [aheadText, behindText] = aheadBehind ? aheadBehind.split(/\s+/) : ["", ""];
  const ahead = Number.parseInt(aheadText, 10);
  const behind = Number.parseInt(behindText, 10);
  const latest = runGit(repoPath, ["log", "-1", "--format=%h %s"]) || "";
  const statusText = runGit(repoPath, ["status", "--porcelain=v1"], { preserveStatusPrefix: true }) || "";
  const status = parseStatus(statusText);

  return {
    name,
    path: relativePath,
    exists: true,
    git: true,
    branch,
    upstream: upstream || "",
    head: head.slice(0, 12),
    headFull: head,
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
    pushed: upstream ? ahead === 0 : null,
    latest,
    ...status,
  };
}

function cell(value) {
  return String(value ?? "").replaceAll("|", "\\|");
}

function printTable(rows) {
  console.log("| Repo | Branch | Upstream | Ahead | Behind | HEAD | Dirty | Staged | Unstaged | Untracked | Latest commit |");
  console.log("| --- | --- | --- | ---: | ---: | --- | --- | ---: | ---: | ---: | --- |");

  for (const row of rows) {
    if (!row.exists) {
      console.log(`| ${cell(row.name)} | missing | - | - | - | - | - | 0 | 0 | 0 | - |`);
      continue;
    }

    if (!row.git) {
      console.log(`| ${cell(row.name)} | not git repo | - | - | - | - | - | 0 | 0 | 0 | - |`);
      continue;
    }

    console.log(
      `| ${cell(row.name)} | ${cell(row.branch)} | ${cell(row.upstream || "-")} | ${
        row.ahead ?? "-"
      } | ${row.behind ?? "-"} | ${cell(row.head)} | ${
        row.dirty ? "yes" : "no"
      } | ${row.staged} | ${row.unstaged} | ${row.untracked} | ${cell(row.latest)} |`,
    );
  }
}

const rows = repoNames.map(inspectRepo);

if (json) {
  console.log(JSON.stringify({ workspaceRoot, repos: rows }, null, 2));
} else {
  printTable(rows);
}

const missing = rows.filter((row) => !row.exists || !row.git);
if (!allowMissingRepos && missing.length > 0) {
  process.exitCode = 1;
}
