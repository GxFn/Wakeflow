#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspaceConfig } from "./lib/wakeflow-config.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rawArgs = process.argv.slice(2);
const wakeflowRoot = path.dirname(scriptsDir);
const targetRoot = path.resolve(getValue(rawArgs, "--root") || wakeflowRoot);
const printOnly = rawArgs.includes("--print");
const args = rawArgs.filter((arg) => arg !== "--print");
const command = args[0] ?? "help";
const commandArgs = args.slice(1);
const workspaceConfig = loadWorkspaceConfig({ workspaceRoot: targetRoot, args: rawArgs });

const testScripts = [
  "scripts/wakeflow-archive-todo.test.mjs",
  "scripts/wakeflow-delivery.test.mjs",
  "scripts/wakeflow-repo-status.test.mjs",
  "scripts/wakeflow-state.test.mjs",
  "scripts/wakeflow-state-machine-route-fixtures.test.mjs",
  "scripts/wakeflow-intake.test.mjs",
  "scripts/wakeflow-demand-sequence.test.mjs",
  "scripts/wakeflow-check-repository-residue.test.mjs",
  "scripts/wakeflow-check-scripts.test.mjs",
  "scripts/wakeflow-validate.test.mjs",
  "scripts/wakeflow-setup.test.mjs",
  "scripts/wakeflow-import-design-handoffs.test.mjs",
  "scripts/wakeflow-next-work.test.mjs",
  "scripts/wakeflow-cli.test.mjs",
];

const helpText = `
${workspaceConfig.workspaceName} script aggregator

Usage:
  node scripts/wakeflow-cli.mjs <command> [options]
  node scripts/wakeflow-cli.mjs --print <command> [options]

Commands:
  status      Show repo status and closed-loop machine health.
  verify      Run wakeflow-verify with common option aliases.
  sync        Render a controller state-root progress document.
  design      Refresh or validate Design handoff intake.
  intake      Attach Design/Test machine intake to a controller state root.
  runtime     Inspect runtime residue without mutating processes.
  install     Discover sibling repos, configure scope, and write child AGENTS blocks.
  scripts     Check script docs, optionally including script tests.
  loop        Operate the new Wakeflow Delivery Loop contract surface.
  sequence    Claim or sync ordered independent demand documents.
  next-work   Scan Design handoff and TODO ledgers for the next controller-ready candidate.
  help        Show this help.

Common examples:
  node scripts/wakeflow-cli.mjs status
  node scripts/wakeflow-cli.mjs status --json
  node scripts/wakeflow-cli.mjs status --root /path/to/Wakeflow --json
  node scripts/wakeflow-cli.mjs verify --script-tests
  node scripts/wakeflow-cli.mjs sync --state-root .workspace-active/workspace/current/<demand-key> --write
  node scripts/wakeflow-cli.mjs design --id design-handoff-2026-06-03 --json
  node scripts/wakeflow-cli.mjs intake design-handoff --state-root .workspace-active/workspace/current/<demand-key> --design-key design-handoff-2026-06-03 --write --json
  node scripts/wakeflow-cli.mjs install status --json
  node scripts/wakeflow-cli.mjs loop status --json
  node scripts/wakeflow-cli.mjs sequence status --manifest wakeflow-ledger/requirement-designs/<topic>/sequence.json --json
  node scripts/wakeflow-cli.mjs next-work --after-completion --json
  node scripts/wakeflow-cli.mjs next-work --id example-demand-2026-06-03 --json

Safety:
  This script only orchestrates existing workspace scripts. Write-capable flows
  still require explicit flags such as --write or --apply on the underlying
  script. Use --print to inspect the exact commands before running them. See
  skills/wakeflow-governance/references/script-pipeline.md for
  the full command catalog.
`.trim();

class CliExit extends Error {}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new CliExit(message);
}

function hasFlag(options, name) {
  return options.includes(name);
}

function getValue(options, name) {
  const eq = options.find((arg) => arg.startsWith(`${name}=`));
  if (eq) {
    return eq.slice(name.length + 1);
  }
  const index = options.indexOf(name);
  if (index >= 0 && options[index + 1] && !options[index + 1].startsWith("--")) {
    return options[index + 1];
  }
  return null;
}

function assertKnownOptions(options, knownFlags, knownValues = []) {
  const valueNames = new Set(knownValues);
  const known = new Set([...knownFlags, ...knownValues]);
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (!option.startsWith("--")) {
      fail(`Unexpected positional argument: ${option}`);
    }
    const name = option.includes("=") ? option.slice(0, option.indexOf("=")) : option;
    if (!known.has(name)) {
      fail(`Unsupported option for ${command}: ${option}`);
    }
    if (valueNames.has(name) && !option.includes("=")) {
      if (!options[index + 1] || options[index + 1].startsWith("--")) {
        fail(`Missing value for ${name}.`);
      }
      index += 1;
    }
  }
}

function nodeScript(script, argsForScript = []) {
  return {
    command: process.execPath,
    displayCommand: "node",
    args: [`scripts/${script}`, ...argsForScript],
  };
}

function shellDisplay(step) {
  return [step.displayCommand ?? step.command, ...step.args].join(" ");
}

function verifyArgs(options) {
  const out = [];
  if (hasFlag(options, "--runtime") || hasFlag(options, "--with-runtime")) {
    out.push("--with-runtime");
  }
  if (hasFlag(options, "--strict-runtime")) {
    out.push("--strict-runtime");
  }
  if (hasFlag(options, "--script-tests") || hasFlag(options, "--with-script-tests")) {
    out.push("--with-script-tests");
  }
  return [...new Set(out)];
}

function buildStatus(options) {
  assertKnownOptions(options, ["--json"], ["--root"]);
  const json = hasFlag(options, "--json");
  const root = getValue(options, "--root");
  return [
    {
      label: "repo status",
      key: "repoStatus",
      ...nodeScript("wakeflow-repo-status.mjs", [...optionalRoot(root), ...(json ? ["--json"] : [])]),
    },
    {
      label: "closed-loop status",
      key: "closedLoopStatus",
      ...nodeScript("wakeflow-delivery.mjs", ["status", ...optionalRoot(root), ...(json ? ["--json"] : [])]),
    },
  ];
}

function buildVerify(options) {
  assertKnownOptions(options, [
    "--json",
    "--runtime",
    "--with-runtime",
    "--strict-runtime",
    "--script-tests",
    "--with-script-tests",
  ], ["--root"]);
  return [{
    label: "Wakeflow verification",
    ...nodeScript("wakeflow-verify.mjs", [...optionalRoot(getValue(options, "--root")), ...verifyArgs(options)]),
  }];
}

function buildSync(options) {
  assertKnownOptions(options, ["--write", "--json"], ["--state-root", "--root"]);
  const stateRoot = getValue(options, "--state-root");
  if (!stateRoot) {
    fail("sync requires --state-root for the controller state-machine route.");
  }
  const out = ["--state-root", stateRoot];
  const root = getValue(options, "--root");
  if (root) out.push("--root", root);
  if (hasFlag(options, "--write")) out.push("--write");
  if (hasFlag(options, "--json")) out.push("--json");
  return [{ label: "render controller progress doc", key: "controllerProgressRender", ...nodeScript("wakeflow-render-progress.mjs", out) }];
}

function buildDesign(options) {
  assertKnownOptions(options, ["--write", "--json"], ["--id", "--board", "--inbox"]);
  const out = [];
  for (const flag of ["--write", "--json"]) {
    if (hasFlag(options, flag)) {
      out.push(flag);
    }
  }
  for (const valueFlag of ["--id", "--board", "--inbox"]) {
    const value = getValue(options, valueFlag);
    if (value) {
      out.push(valueFlag, value);
    }
  }
  return [{ label: "Design handoff intake", ...nodeScript("wakeflow-import-design-handoffs.mjs", out) }];
}

function buildIntake(options) {
  const subcommand = options[0] ?? "help";
  const rest = options.slice(1);
  return [{ label: "Design/Test state-root intake", ...nodeScript("wakeflow-intake.mjs", [subcommand, ...rest]) }];
}

function buildRuntime(options) {
  assertKnownOptions(options, ["--strict"]);
  return [{ label: "runtime residue", ...nodeScript("wakeflow-check-runtime.mjs", hasFlag(options, "--strict") ? ["--strict"] : []) }];
}

function buildInstall(options) {
  const subcommand = options[0] ?? "status";
  const rest = options.slice(1);
  assertKnownOptions(
    rest,
    [
      "--json",
      "--write",
      "--all",
      "--use-discovered",
      "--internal-design",
      "--internal-test",
      "--include-unmanaged",
      "--include-real-project",
    ],
    [
      "--root",
      "--parent",
      "--config",
      "--repo",
      "--role",
      "--window",
      "--workspace-name",
      "--controller-window",
      "--design-window",
      "--test-window",
      "--real-project-window",
      "--base-window",
    ],
  );
  return [{ label: "Wakeflow runtime install", ...nodeScript("wakeflow-setup.mjs", [subcommand, ...rest]) }];
}

function buildScripts(options) {
  assertKnownOptions(options, ["--tests"]);
  const steps = [{ label: "script docs", ...nodeScript("wakeflow-check-scripts.mjs") }];
  if (hasFlag(options, "--tests")) {
    steps.push({
      label: "workspace script tests",
      command: process.execPath,
      displayCommand: "node",
      args: ["--test", ...testScripts],
    });
  }
  return steps;
}

function optionalRoot(root) {
  return root ? ["--root", root] : [];
}

function buildLoop(options) {
  const subcommand = options[0] ?? "status";
  const rest = options.slice(1);
  return [{ label: "Wakeflow delivery loop", ...nodeScript("wakeflow-delivery.mjs", [subcommand, ...rest]) }];
}

function buildSequence(options) {
  const subcommand = options[0] ?? "status";
  const rest = options.slice(1);
  return [{ label: "ordered demand sequence", ...nodeScript("wakeflow-demand-sequence.mjs", [subcommand, ...rest]) }];
}

function buildNextWork(options) {
  assertKnownOptions(options, ["--after-completion", "--write", "--json"], ["--id", "--source", "--limit", "--board", "--todo", "--status", "--out"]);
  return [{ label: "next Wakeflow work candidate scan", ...nodeScript("wakeflow-next-work.mjs", options) }];
}

function buildSteps() {
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      console.log(helpText);
      return [];
    case "status":
      return buildStatus(commandArgs);
    case "verify":
      return buildVerify(commandArgs);
    case "sync":
      return buildSync(commandArgs);
    case "design":
      return buildDesign(commandArgs);
    case "intake":
      return buildIntake(commandArgs);
    case "runtime":
      return buildRuntime(commandArgs);
    case "install":
      return buildInstall(commandArgs);
    case "scripts":
      return buildScripts(commandArgs);
    case "loop":
      return buildLoop(commandArgs);
    case "sequence":
      return buildSequence(commandArgs);
    case "next-work":
      return buildNextWork(commandArgs);
    default:
      fail(`Unknown wakeflow-cli command: ${command}\n\n${helpText}`);
  }
}

function runStep(step) {
  console.log(`\n## ${step.label}`);
  console.log(`$ ${shellDisplay(step)}`);
  const result = spawnSync(step.command, step.args, {
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
  return result.status ?? 1;
}

function runStatusJson(steps) {
  const checks = [];
  let ok = true;

  for (const step of steps) {
    const result = spawnSync(step.command, step.args, {
      cwd: wakeflowRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const status = result.status ?? 1;
    let payload = null;
    if (result.stdout) {
      try {
        payload = JSON.parse(result.stdout);
      } catch {
        ok = false;
      }
    }
    if (status !== 0) {
      ok = false;
    }
    checks.push({
      key: step.key ?? step.label,
      label: step.label,
      command: shellDisplay(step),
      status,
      ok: status === 0 && payload !== null,
      payload,
      stderr: result.stderr || "",
    });
  }

  console.log(JSON.stringify({ ok, command: "status", checks }, null, 2));
  process.exitCode = ok ? 0 : 1;
}

function main() {
  const steps = buildSteps();

  if (printOnly && steps.length > 0) {
    console.log(`Wakeflow command plan: ${command}`);
    for (const step of steps) {
      console.log(`$ ${shellDisplay(step)}`);
    }
    return;
  }

  if (command === "status" && hasFlag(commandArgs, "--json")) {
    runStatusJson(steps);
    return;
  }

  for (const step of steps) {
    const status = runStep(step);
    if (status !== 0) {
      process.exitCode = status;
      return;
    }
  }
}

try {
  main();
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
