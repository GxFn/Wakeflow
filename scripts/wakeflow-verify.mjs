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
    args: ["scripts/wakeflow-check-boundary.mjs"],
  },
  {
    label: "repository residue",
    command: "node",
    args: ["scripts/wakeflow-check-repository-residue.mjs"],
  },
  {
    label: "repo status",
    command: "node",
    args: ["scripts/wakeflow-repo-status.mjs"],
  },
  {
    label: "workspace docs",
    command: "node",
    args: ["scripts/verify-workspace-docs.mjs", "--all-workspace"],
  },
  {
    label: "script docs",
    command: "node",
    args: ["scripts/wakeflow-check-scripts.mjs"],
  },
  {
    label: "current layout",
    command: "node",
    args: ["scripts/wakeflow-check-layout.mjs"],
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
    args: ["scripts/wakeflow-check-runtime.mjs", ...(strictRuntime ? ["--strict"] : [])],
  });
}

if (withScriptTests) {
  checks.push({
    label: "workspace script tests",
    command: "node",
    args: [
      "--test",
      "scripts/wakeflow-archive-todo.test.mjs",
      "scripts/wakeflow-delivery.test.mjs",
      "scripts/wakeflow-repo-status.test.mjs",
      "scripts/wakeflow-state.test.mjs",
      "scripts/wakeflow-state-machine-route-fixtures.test.mjs",
      "scripts/wakeflow-intake.test.mjs",
      "scripts/wakeflow-demand-sequence.test.mjs",
      "scripts/wakeflow-check-repository-residue.test.mjs",
      "scripts/wakeflow-check-scripts.test.mjs",
      "scripts/wakeflow-setup.test.mjs",
      "scripts/wakeflow-import-design-handoffs.test.mjs",
      "scripts/wakeflow-next-work.test.mjs",
      "scripts/wakeflow-cli.test.mjs",
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

console.log("Wakeflow verification");
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
