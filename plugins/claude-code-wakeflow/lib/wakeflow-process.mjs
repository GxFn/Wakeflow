import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const defaultSpawnSyncMaxBuffer = 64 * 1024 * 1024;

const allowedGitSubcommands = new Set([
  "add",
  "branch",
  "commit",
  "config",
  "diff",
  "init",
  "log",
  "ls-files",
  "rev-list",
  "rev-parse",
  "status",
  // Isolation worktrees are first-class core capability (demand pods): the
  // host-neutral pod runner adds/removes/prunes them through this guard.
  "worktree",
]);

const blockedNodeFlags = new Set([
  "-e",
  "--eval",
  "-p",
  "--print",
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "--input-type",
]);

// Central OS-process boundary for Wakeflow. This module intentionally keeps the
// subprocess primitive in one audited place and rejects shell execution or
// commands outside Wakeflow's fixed runtime/git/process/keep-live needs.
export function execFileText(command, args, options = {}) {
  const prepared = prepareWakeflowCommand(command, args, options);
  const result = spawnSync(prepared.command, prepared.args, withSpawnSyncDefaults(options));
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = stringifyOutput(result.stderr);
    const stdout = stringifyOutput(result.stdout);
    throw new Error(stderr || stdout || `Wakeflow command failed: ${prepared.kind}`);
  }
  return result.stdout;
}

export function runSync(command, args, options = {}) {
  const prepared = prepareWakeflowCommand(command, args, options);
  return spawnSync(prepared.command, prepared.args, withSpawnSyncDefaults(options));
}

export function spawnProcess(command, args, options = {}) {
  const prepared = prepareWakeflowCommand(command, args, options);
  return spawn(prepared.command, prepared.args, options);
}

export function prepareWakeflowCommand(command, args, options = {}) {
  assertSafeOptions(options);
  assertStringArray(args, "args");
  if (command === process.execPath || command === "node") {
    assertNodeArgs(args);
    return { kind: "node", command: process.execPath, args };
  }
  if (command === "git") {
    assertGitArgs(args);
    return { kind: "git", command, args };
  }
  if (command === "ps") {
    assertExactArgs(args, ["-axo", "pid,command"], "ps");
    return { kind: "ps", command, args };
  }
  if (process.platform === "darwin" && path.basename(command) === "caffeinate") {
    assertCaffeinateArgs(args);
    return { kind: "caffeinate", command, args };
  }
  throw new Error(`Unsupported Wakeflow process command: ${command}`);
}

function assertSafeOptions(options) {
  if (options?.shell) {
    throw new Error("Wakeflow process execution forbids shell mode");
  }
}

function withSpawnSyncDefaults(options = {}) {
  const merged = { ...options };
  if (merged.maxBuffer === undefined) {
    merged.maxBuffer = defaultSpawnSyncMaxBuffer;
  }
  return merged;
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
}

function assertNodeArgs(args) {
  for (const arg of args) {
    if (arg === "--") {
      return;
    }
    if (!arg.startsWith("-")) {
      return;
    }
    const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (blockedNodeFlags.has(flag)) {
      throw new Error(`Unsupported Wakeflow node flag: ${flag}`);
    }
  }
}

function assertGitArgs(args) {
  if (args.length === 0) {
    throw new Error("git command requires a subcommand");
  }
  if (args.length === 1 && args[0] === "--version") {
    return;
  }
  const subcommand = args[0] === "-C" ? args[2] : args[0];
  if (!allowedGitSubcommands.has(subcommand)) {
    throw new Error(`Unsupported Wakeflow git subcommand: ${subcommand || "(missing)"}`);
  }
}

function assertExactArgs(args, expected, label) {
  if (args.length !== expected.length || args.some((arg, index) => arg !== expected[index])) {
    throw new Error(`Unsupported Wakeflow ${label} arguments`);
  }
}

function assertCaffeinateArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (/^-[dimsu]+$/.test(arg)) continue;
    if (arg === "-w" || arg === "-t") {
      const value = args[index + 1];
      if (!/^\d+$/.test(value ?? "")) {
        throw new Error(`Wakeflow caffeinate ${arg} requires a numeric value`);
      }
      index += 1;
      continue;
    }
    throw new Error(`Unsupported Wakeflow caffeinate argument: ${arg}`);
  }
}

function stringifyOutput(value) {
  if (typeof value === "string") return value.trim();
  if (Buffer.isBuffer(value)) return value.toString("utf8").trim();
  return "";
}
