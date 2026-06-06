#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const withRuntime = args.includes("--with-runtime");
const strictRuntime = args.includes("--strict-runtime");
const withScriptTests = args.includes("--with-script-tests");

const checks = [
  {
    label: "workspace boundary",
    command: "node",
    args: ["scripts/check-workspace-boundary.mjs"],
  },
  {
    label: "repository residue",
    command: "node",
    args: ["scripts/check-repository-residue.mjs"],
  },
  {
    label: "repo status",
    command: "node",
    args: ["scripts/collect-repo-status.mjs"],
  },
  {
    label: "workspace docs",
    command: "node",
    args: ["scripts/verify-workspace-docs.mjs", "--all-workspace"],
  },
  {
    label: "script docs",
    command: "node",
    args: ["scripts/check-script-docs.mjs"],
  },
  {
    label: "current layout",
    command: "node",
    args: ["scripts/check-workspace-current-layout.mjs"],
  },
  {
    label: "git diff whitespace",
    command: "git",
    args: ["diff", "--check"],
  },
];

if (withRuntime || strictRuntime) {
  checks.push({
    label: "runtime residue",
    command: "node",
    args: ["scripts/check-runtime-residue.mjs", ...(strictRuntime ? ["--strict"] : [])],
  });
}

if (withScriptTests) {
  checks.push({
    label: "workspace script tests",
    command: "node",
    args: [
      "--test",
      "scripts/archive-global-todo-board.test.mjs",
      "scripts/codex-automation-loop.test.mjs",
      "scripts/collect-repo-status.test.mjs",
      "scripts/controller-state.test.mjs",
      "scripts/control-state-machine-route-fixtures.test.mjs",
      "scripts/control-intake.test.mjs",
      "scripts/demand-sequence.test.mjs",
      "scripts/check-repository-residue.test.mjs",
      "scripts/check-script-docs.test.mjs",
      "scripts/control-workspace-install.test.mjs",
      "scripts/import-design-handoffs.test.mjs",
      "scripts/next-control-work.test.mjs",
      "scripts/workspace-control.test.mjs",
    ],
  });
}

function runCheck(check) {
  console.log(`\n## ${check.label}`);
  console.log(`$ ${[check.command, ...check.args].join(" ")}`);

  const result = spawnSync(check.command, check.args, {
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

console.log("Control workspace verification");
console.log(`Runtime residue check: ${withRuntime || strictRuntime ? (strictRuntime ? "strict" : "warning") : "skipped"}`);
console.log(`Workspace script tests: ${withScriptTests ? "yes" : "no"}`);

const results = checks.map(runCheck);
const failed = results.filter((result) => !result.ok);

console.log("\n## Summary");
for (const result of results) {
  console.log(`- ${result.ok ? "PASS" : "FAIL"} ${result.label}`);
}

if (failed.length > 0) {
  process.exitCode = 1;
}
