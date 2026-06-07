#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { loadWorkspaceConfig } from "./lib/wakeflow-config.mjs";

const args = process.argv.slice(2);
const workspaceRoot = getArgValue("--root") || process.cwd();
const workspaceConfig = loadWorkspaceConfig({ workspaceRoot, args });
const protectedWorkspacePrefixes = workspaceConfig.protectedWorkspacePrefixes;
const disallowedTrackedPaths = workspaceConfig.disallowedTrackedPaths;
const internalWorkspacePrefixes = new Set(
  (workspaceConfig.repositories ?? [])
    .filter((repo) => repo.mode === "internal")
    .map((repo) => `${String(repo.path ?? "").replace(/\/+$/, "")}/`),
);

function git(args) {
  return execFileSync("git", ["-C", workspaceRoot, ...args], { encoding: "utf8" }).trim();
}

const tracked = git(["ls-files", "-s"])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const tabIndex = line.indexOf("\t");
    return tabIndex >= 0 ? line.slice(tabIndex + 1) : line;
  });

const violations = [];

for (const path of tracked) {
  if (
    protectedWorkspacePrefixes.some((prefix) => path.startsWith(prefix))
    && ![...internalWorkspacePrefixes].some((prefix) => path.startsWith(prefix))
  ) {
    violations.push(`protected workspace path is tracked: ${path}`);
  }

  if (disallowedTrackedPaths.includes(path) || path.endsWith("/.DS_Store")) {
    violations.push(`local noise path is tracked: ${path}`);
  }
}

if (violations.length > 0) {
  console.error("Workspace boundary check failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}

console.log("Workspace boundary check passed.");
console.log(`Tracked workspace files: ${tracked.length}`);

function getArgValue(name) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
