import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
export const pluginRoot = path.dirname(path.dirname(modulePath));
export const wakeflowRuntimeRoot = pluginRoot;

const allowedScripts = new Map([
  ["wakeflow-progress-log", "wakeflow-progress-log.mjs"],
  ["wakeflow-archive-todo", "wakeflow-archive-todo.mjs"],
  ["wakeflow-archive-docs", "wakeflow-archive-docs.mjs"],
  ["wakeflow-check-repository-residue", "wakeflow-check-repository-residue.mjs"],
  ["wakeflow-check-runtime", "wakeflow-check-runtime.mjs"],
  ["wakeflow-check-scripts", "wakeflow-check-scripts.mjs"],
  ["wakeflow-check-boundary", "wakeflow-check-boundary.mjs"],
  ["wakeflow-check-layout", "wakeflow-check-layout.mjs"],
  ["wakeflow-delivery", "wakeflow-delivery.mjs"],
  ["wakeflow-repo-status", "wakeflow-repo-status.mjs"],
  ["wakeflow-compact-index", "wakeflow-compact-index.mjs"],
  ["wakeflow-intake", "wakeflow-intake.mjs"],
  ["wakeflow-setup", "wakeflow-setup.mjs"],
  ["wakeflow-state", "wakeflow-state.mjs"],
  ["wakeflow-demand-sequence", "wakeflow-demand-sequence.mjs"],
  ["wakeflow-archive-summaries", "wakeflow-archive-summaries.mjs"],
  ["wakeflow-import-design-handoffs", "wakeflow-import-design-handoffs.mjs"],
  ["wakeflow-next-work", "wakeflow-next-work.mjs"],
  ["wakeflow-render-progress", "wakeflow-render-progress.mjs"],
  ["smoke", "wakeflow-smoke.mjs"],
  ["wakeflow-validate", "wakeflow-validate.mjs"],
  ["wakeflow-verify", "wakeflow-verify.mjs"],
  ["verify-workspace-docs", "verify-workspace-docs.mjs"],
  ["wakeflow-runtime", "wakeflow-runtime.mjs"],
  ["wakeflow-cli", "wakeflow-cli.mjs"],
]);

export function listWakeflowRuntimeScripts() {
  return Array.from(allowedScripts.keys()).sort();
}

export async function runWakeflowRuntime({ script, args = [], cwd = wakeflowRuntimeRoot, timeoutMs = 120000 }) {
  const scriptFile = allowedScripts.get(script);
  if (!scriptFile) {
    throw new Error(`Unsupported Wakeflow runtime script: ${script}`);
  }
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw new Error("args must be an array of strings");
  }
  const effectiveCwd = resolveCwd(cwd);
  const scriptPath = path.join(wakeflowRuntimeRoot, "scripts", scriptFile);
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
