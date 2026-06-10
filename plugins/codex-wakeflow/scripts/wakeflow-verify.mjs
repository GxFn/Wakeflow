#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSync } from "../lib/wakeflow-process.mjs";

const args = process.argv.slice(2);
const workspaceRoot = path.resolve(getArgValue("--root") || process.cwd());
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const wakeflowRoot = path.dirname(scriptsDir);
const rootArgs = ["--root", workspaceRoot];
const hasActiveWorkspaceDocs = existsSync(path.join(workspaceRoot, ".workspace-active/workspace"));
const withRuntime = args.includes("--with-runtime");
const strictRuntime = args.includes("--strict-runtime");
const withScriptTests = args.includes("--with-script-tests");
const repositoryTestFiles = listRepositoryTests();

const checks = [
  {
    label: "workspace boundary",
    command: process.execPath,
    args: [path.join(scriptsDir, "wakeflow-check-boundary.mjs"), ...rootArgs],
  },
  {
    label: "repository residue",
    command: process.execPath,
    args: [path.join(scriptsDir, "wakeflow-check-repository-residue.mjs"), ...rootArgs],
  },
  {
    label: "repo status",
    command: process.execPath,
    args: [path.join(scriptsDir, "wakeflow-repo-status.mjs"), ...rootArgs],
  },
  {
    label: "script docs",
    command: process.execPath,
    args: [path.join(scriptsDir, "wakeflow-check-scripts.mjs"), ...rootArgs],
  },
  {
    label: "git diff whitespace",
    command: "git",
    args: ["-C", workspaceRoot, "diff", "--check"],
  },
];

if (hasActiveWorkspaceDocs) {
  checks.splice(
    3,
    0,
    {
      label: "workspace docs",
      command: process.execPath,
      args: [path.join(scriptsDir, "verify-workspace-docs.mjs"), ...rootArgs, "--all-workspace"],
    },
  );
  checks.splice(
    5,
    0,
    {
      label: "current layout",
      command: process.execPath,
      args: [path.join(scriptsDir, "wakeflow-check-layout.mjs"), ...rootArgs],
    },
  );
}

if (withRuntime || strictRuntime) {
  checks.push({
    label: "runtime residue",
    command: process.execPath,
    args: [path.join(scriptsDir, "wakeflow-check-runtime.mjs"), ...rootArgs, ...(strictRuntime ? ["--strict"] : [])],
  });
}

if (withScriptTests && repositoryTestFiles.length > 0) {
  checks.push({
    label: "workspace script tests",
    command: process.execPath,
    args: ["--test", ...repositoryTestFiles],
  });
}

function listRepositoryTests() {
  for (const candidate of [
    path.join(wakeflowRoot, "test"),
    path.resolve(wakeflowRoot, "../../test"),
  ]) {
    if (!existsSync(candidate)) continue;
    return readdirSync(candidate)
      .filter((name) => name.endsWith(".test.mjs"))
      .sort()
      .map((name) => path.join(candidate, name));
  }
  return [];
}

function runCheck(check) {
  console.log(`\n## ${check.label}`);
  console.log(`$ ${[check.command, ...check.args].join(" ")}`);

  const result = runSync(check.command, check.args, {
    cwd: wakeflowRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return {
    ...check,
    status: result.status ?? 1,
    signal: result.signal ?? "",
    ok: result.status === 0,
  };
}

function getArgValue(name) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

console.log("Wakeflow verification");
console.log(`Runtime residue check: ${withRuntime || strictRuntime ? (strictRuntime ? "strict" : "warning") : "skipped"}`);
console.log(`Workspace script tests: ${withScriptTests ? (repositoryTestFiles.length > 0 ? "yes" : "not available") : "no"}`);
console.log(`Active workspace docs: ${hasActiveWorkspaceDocs ? "yes" : "not initialized"}`);

const results = checks.map(runCheck);
const failed = results.filter((result) => !result.ok);

console.log("\n## Summary");
for (const result of results) {
  console.log(`- ${result.ok ? "PASS" : "FAIL"} ${result.label}`);
}

if (failed.length > 0) {
  process.exitCode = 1;
}
