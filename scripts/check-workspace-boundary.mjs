#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { loadWorkspaceConfig } from "./lib/workspace-config.mjs";

const workspaceConfig = loadWorkspaceConfig();
const protectedWorkspacePrefixes = workspaceConfig.protectedWorkspacePrefixes;
const disallowedTrackedPaths = workspaceConfig.disallowedTrackedPaths;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
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
  if (protectedWorkspacePrefixes.some((prefix) => path.startsWith(prefix))) {
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
