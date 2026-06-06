#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { loadWorkspaceConfig } from "./lib/workspace-config.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const strict = args.includes("--strict");
const workspaceConfig = loadWorkspaceConfig({ args });
const processMatchers = Array.isArray(workspaceConfig.runtimeProcessMatchers)
  ? workspaceConfig.runtimeProcessMatchers
  : [];
const processLabel = workspaceConfig.runtimeProcessLabel ?? "configured";

function parsePsLine(line) {
  const match = line.trim().match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return null;
  }
  return {
    pid: Number.parseInt(match[1], 10),
    command: match[2],
  };
}

function classify(command) {
  const matched = processMatchers.some((matcher) => {
    if (typeof matcher !== "string" || matcher.length === 0) {
      return false;
    }
    if (matcher.startsWith("/") && matcher.endsWith("/") && matcher.length > 2) {
      try {
        return new RegExp(matcher.slice(1, -1)).test(command);
      } catch {
        return command.includes(matcher);
      }
    }
    return command.includes(matcher);
  });
  return matched ? "configured-runtime" : null;
}

function readProcesses() {
  const output = execFileSync("ps", ["-axo", "pid,command"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output
    .split("\n")
    .slice(1)
    .map(parsePsLine)
    .filter(Boolean)
    .map((processInfo) => ({ ...processInfo, kind: classify(processInfo.command) }))
    .filter((processInfo) => processInfo.kind);
}

function shortCommand(command) {
  return command.length > 180 ? `${command.slice(0, 177)}...` : command;
}

let processes = [];
let readError = "";
try {
  processes = readProcesses();
} catch (error) {
  readError = error instanceof Error ? error.message : String(error);
}

const blockingKinds = new Set(["configured-runtime"]);
const blocking = processes.filter((processInfo) => blockingKinds.has(processInfo.kind));
const result = {
  ok: !strict || (!readError && blocking.length === 0),
  strict,
  readError,
  blocking,
  processes,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (readError) {
  console.log("Runtime residue check could not inspect processes.");
  console.log(`Reason: ${readError}`);
} else {
  console.log("Runtime residue check completed.");
  console.log(`Strict mode: ${strict ? "yes" : "no"}`);
  console.log(`Blocking residues: ${blocking.length}`);
  console.log(`Known ${processLabel} processes: ${processes.length}`);

  if (processes.length > 0) {
    console.log("");
    console.log("| Kind | PID | Command |");
    console.log("| --- | ---: | --- |");
    for (const processInfo of processes) {
      console.log(`| ${processInfo.kind} | ${processInfo.pid} | ${shortCommand(processInfo.command).replaceAll("|", "\\|")} |`);
    }
  }
}

if (!result.ok) {
  process.exitCode = 1;
}
