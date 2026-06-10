import { execFileSync, spawn, spawnSync } from "node:child_process";

// Central OS-process boundary for Wakeflow's whitelisted runtime scripts and
// local git/process inspection. Callers choose fixed commands and validated args.
export function execFileText(command, args, options = {}) {
  return execFileSync(command, args, options);
}

export function runSync(command, args, options = {}) {
  return spawnSync(command, args, options);
}

export function spawnProcess(command, args, options = {}) {
  return spawn(command, args, options);
}
