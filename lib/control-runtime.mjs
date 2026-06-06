import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
export const pluginRoot = path.dirname(path.dirname(modulePath));
export const controlRuntimeRoot = pluginRoot;

const allowedScripts = new Map([
  ["append-progress-log", "append-progress-log.mjs"],
  ["archive-global-todo-board", "archive-global-todo-board.mjs"],
  ["archive-workspace-docs", "archive-workspace-docs.mjs"],
  ["check-repository-residue", "check-repository-residue.mjs"],
  ["check-runtime-residue", "check-runtime-residue.mjs"],
  ["check-script-docs", "check-script-docs.mjs"],
  ["check-workspace-boundary", "check-workspace-boundary.mjs"],
  ["check-workspace-current-layout", "check-workspace-current-layout.mjs"],
  ["codex-automation-loop", "codex-automation-loop.mjs"],
  ["collect-repo-status", "collect-repo-status.mjs"],
  ["compact-workspace-index", "compact-workspace-index.mjs"],
  ["control-intake", "control-intake.mjs"],
  ["control-workspace-install", "control-workspace-install.mjs"],
  ["controller-state", "controller-state.mjs"],
  ["demand-sequence", "demand-sequence.mjs"],
  ["generate-archive-topic-summaries", "generate-archive-topic-summaries.mjs"],
  ["import-design-handoffs", "import-design-handoffs.mjs"],
  ["next-control-work", "next-control-work.mjs"],
  ["render-progress-doc", "render-progress-doc.mjs"],
  ["smoke", "smoke.mjs"],
  ["validate-repo", "validate-repo.mjs"],
  ["verify-control-center", "verify-control-center.mjs"],
  ["verify-workspace-docs", "verify-workspace-docs.mjs"],
  ["wakeflow-control", "wakeflow-control.mjs"],
  ["workspace-control", "workspace-control.mjs"],
]);

export function listControlRuntimeScripts() {
  return Array.from(allowedScripts.keys()).sort();
}

export async function runControlRuntime({ script, args = [], cwd = controlRuntimeRoot, timeoutMs = 120000 }) {
  const scriptFile = allowedScripts.get(script);
  if (!scriptFile) {
    throw new Error(`Unsupported Wakeflow control runtime script: ${script}`);
  }
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw new Error("args must be an array of strings");
  }
  const effectiveCwd = resolveCwd(cwd);
  const scriptPath = path.join(controlRuntimeRoot, "scripts", scriptFile);
  const startedAt = new Date().toISOString();
  const output = await spawnNode({
    command: process.execPath,
    args: [scriptPath, ...args],
    cwd: effectiveCwd,
    timeoutMs,
  });
  return {
    ok: output.exitCode === 0,
    script,
    args,
    cwd: effectiveCwd,
    startedAt,
    completedAt: new Date().toISOString(),
    ...output,
  };
}

function resolveCwd(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) {
    throw new Error("cwd must be a non-empty string");
  }
  const resolved = path.resolve(cwd);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`cwd must be an existing directory: ${resolved}`);
  }
  return resolved;
}

function spawnNode({ command, args, cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        WAKEFLOW_CONTROL_RUNTIME: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        stdout,
        stderr,
        parsedJson: parseLastJson(stdout),
      });
    });
  });
}

function parseLastJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed.endsWith("}")) return null;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== "{") continue;
    try {
      return JSON.parse(trimmed.slice(index));
    } catch {
      // Try the next opening brace.
    }
  }
  return null;
}
