#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const workspaceRoot = path.resolve(getArgValue("--root") || process.cwd());
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const wakeflowRoot = path.dirname(scriptsDir);
const rootArgs = ["--root", workspaceRoot];
const hasActiveWorkspaceDocs = existsSync(path.join(workspaceRoot, ".workspace-active/workspace"));
const withRuntime = args.includes("--with-runtime");
const strictRuntime = args.includes("--strict-runtime");
const withScriptTests = args.includes("--with-script-tests");

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

if (withScriptTests) {
  checks.push({
    label: "workspace script tests",
    command: process.execPath,
    args: [
      "--test",
      path.join(scriptsDir, "wakeflow-archive-todo.test.mjs"),
      path.join(scriptsDir, "wakeflow-delivery.test.mjs"),
      path.join(scriptsDir, "wakeflow-repo-status.test.mjs"),
      path.join(scriptsDir, "wakeflow-state.test.mjs"),
      path.join(scriptsDir, "wakeflow-state-machine-route-fixtures.test.mjs"),
      path.join(scriptsDir, "wakeflow-intake.test.mjs"),
      path.join(scriptsDir, "wakeflow-demand-sequence.test.mjs"),
      path.join(scriptsDir, "wakeflow-check-repository-residue.test.mjs"),
      path.join(scriptsDir, "wakeflow-check-layout.test.mjs"),
      path.join(scriptsDir, "wakeflow-check-scripts.test.mjs"),
      path.join(scriptsDir, "wakeflow-validate.test.mjs"),
      path.join(scriptsDir, "wakeflow-setup.test.mjs"),
      path.join(scriptsDir, "wakeflow-import-design-handoffs.test.mjs"),
      path.join(scriptsDir, "wakeflow-next-work.test.mjs"),
      path.join(scriptsDir, "wakeflow-cli.test.mjs"),
    ],
  });
}

function runCheck(check) {
  console.log(`\n## ${check.label}`);
  console.log(`$ ${[check.command, ...check.args].join(" ")}`);

  const result = spawnSync(check.command, check.args, {
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
console.log(`Workspace script tests: ${withScriptTests ? "yes" : "no"}`);
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
