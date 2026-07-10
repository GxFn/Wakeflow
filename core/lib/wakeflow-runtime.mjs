import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnProcess } from "./wakeflow-process.mjs";
import {
  buildWakeflowTrace,
  firstString,
  numberOrZero,
  oneLine,
  pruneUndefined,
  valueAt,
} from "./wakeflow-trace.mjs";

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
  ["wakeflow-intake", "wakeflow-intake.mjs"],
  ["wakeflow-setup", "wakeflow-setup.mjs"],
  ["wakeflow-state", "wakeflow-state.mjs"],
  ["wakeflow-demand-sequence", "wakeflow-demand-sequence.mjs"],
  ["wakeflow-archive-summaries", "wakeflow-archive-summaries.mjs"],
  ["wakeflow-next-work", "wakeflow-next-work.mjs"],
  ["wakeflow-todo", "wakeflow-todo.mjs"],
  ["wakeflow-storage", "wakeflow-storage.mjs"],
  ["wakeflow-render-progress", "wakeflow-render-progress.mjs"],
  ["wakeflow-smoke", "wakeflow-smoke.mjs"],
  ["wakeflow-validate", "wakeflow-validate.mjs"],
  ["wakeflow-verify", "wakeflow-verify.mjs"],
  ["verify-workspace-docs", "verify-workspace-docs.mjs"],
  ["wakeflow-runtime", "wakeflow-runtime.mjs"],
  ["wakeflow-cli", "wakeflow-cli.mjs"],
]);

export function listWakeflowRuntimeScripts() {
  return Array.from(allowedScripts.keys()).sort();
}

export function listWakeflowRuntimeScriptEntries() {
  return Array.from(allowedScripts.entries())
    .map(([name, file]) => ({ name, file }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function runWakeflowRuntime({
  script,
  args = [],
  cwd = wakeflowRuntimeRoot,
  timeoutMs = 120000,
  sensitiveValues = [],
}) {
  const scriptFile = allowedScripts.get(script);
  if (!scriptFile) {
    throw new Error(`Unsupported Wakeflow runtime script: ${script}`);
  }
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw new Error("args must be an array of strings");
  }
  if (!Array.isArray(sensitiveValues) || !sensitiveValues.every((value) => typeof value === "string")) {
    throw new Error("sensitiveValues must be an array of strings");
  }
  const secrets = [...new Set(sensitiveValues.map((value) => value.trim()).filter(Boolean))];
  const effectiveCwd = resolveCwd(cwd);
  const scriptPath = path.join(wakeflowRuntimeRoot, "scripts", scriptFile);
  const startedAt = new Date().toISOString();
  const output = await spawnNode({
    command: process.execPath,
    args: [scriptPath, ...args],
    cwd: effectiveCwd,
    timeoutMs,
  });
  const completedAt = new Date().toISOString();
  const safeArgs = redactSensitive(args, secrets);
  const safeOutput = redactSensitive(output, secrets);
  const wakeflowTrace = buildWakeflowTrace({
    script,
    args: safeArgs,
    cwd: effectiveCwd,
    startedAt,
    completedAt,
    parsedJson: safeOutput.parsedJson,
  });
  const wakeflowRuntimeStatus = buildWakeflowRuntimeStatus(safeOutput, wakeflowTrace);
  const wakeflowError = classifyWakeflowError(safeOutput, wakeflowRuntimeStatus);
  const wakeflowHealth = buildWakeflowHealth({
    script,
    args: safeArgs,
    cwd: effectiveCwd,
    parsedJson: safeOutput.parsedJson,
    trace: wakeflowTrace,
  });
  return {
    ok: safeOutput.exitCode === 0,
    script,
    args: safeArgs,
    cwd: effectiveCwd,
    startedAt,
    completedAt,
    wakeflowTrace,
    wakeflowRuntimeStatus,
    ...(wakeflowError ? { wakeflowError } : {}),
    ...(wakeflowHealth ? { wakeflowHealth } : {}),
    ...safeOutput,
  };
}

function redactSensitive(value, secrets) {
  if (secrets.length === 0 || value === null || value === undefined) return value;
  if (typeof value === "string") {
    return secrets.reduce((text, secret) => text.split(secret).join("<redacted>"), value);
  }
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, secrets));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactSensitive(item, secrets)]),
    );
  }
  return value;
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
    const child = spawnProcess(command, args, {
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
    let timer = null;
    let killTimer = null;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Escalate to SIGKILL if the child ignores SIGTERM, so timeoutMs is a hard cap.
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // child already exited
        }
      }, 2000);
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    // A spawn-launch failure (EAGAIN/EMFILE/ENOENT) would otherwise throw uncaught and crash
    // the whole MCP stdio server; resolve it as a transient spawn failure instead.
    child.on("error", (error) => {
      finish({
        exitCode: null,
        signal: null,
        timedOut,
        stdout,
        stderr,
        spawnError: error?.message ?? String(error),
        parsedJson: null,
      });
    });
    child.on("close", (exitCode, signal) => {
      finish({
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

function buildWakeflowRuntimeStatus(output, trace) {
  const processOk = output.exitCode === 0 && !output.timedOut;
  const parsedOk = typeof output.parsedJson?.ok === "boolean" ? output.parsedJson.ok : null;
  return pruneUndefined({
    kind: "WakeflowRuntimeStatus",
    version: 1,
    processOk,
    parsedOk,
    semanticOk: processOk && parsedOk !== false,
    exitCode: output.exitCode,
    signal: output.signal,
    timedOut: output.timedOut,
    scriptComplete: typeof output.parsedJson?.scriptComplete === "boolean" ? output.parsedJson.scriptComplete : undefined,
    command: trace.command,
  });
}

function classifyWakeflowError(output, runtimeStatus) {
  if (runtimeStatus.semanticOk) return null;
  const parsed = output.parsedJson || {};
  const message = firstString(
    parsed.error,
    parsed.message,
    parsed.agentNext,
    output.stderr,
    output.stdout,
    "Wakeflow runtime command did not complete successfully.",
  );
  const code = classifyErrorCode({ output, parsed, message });
  return {
    kind: "WakeflowError",
    version: 1,
    code,
    category: errorCategory(code),
    retryable: retryableError(code),
    message: oneLine(message),
  };
}

function classifyErrorCode({ output, parsed, message }) {
  const text = `${parsed.code || ""} ${parsed.errorCode || ""} ${message || ""}`.toLowerCase();
  if (output.timedOut) return "runtime-timeout";
  if (output.spawnError) return "runtime-spawn-failed";
  if (/unknown wakeflow-cli command|unsupported wakeflow runtime script|unknown wakeflow tool/.test(text)) return "unsupported-command";
  if (/state root|state-root/.test(text)) return "state-root-missing";
  if (/state revision|revision conflict|stale/.test(text)) return "state-revision-conflict";
  if (/thread registry|registered thread|thread id/.test(text)) return "thread-registry-missing";
  if (/delivery envelope|delivery file/.test(text)) return "delivery-envelope-missing";
  if (/target result/.test(text)) return "target-result-missing";
  if (/schema|invalid json|validation/.test(text)) return "schema-invalid";
  if (/group.*not ready|missing result|wait.*result/.test(text)) return "group-not-ready";
  if (/controller decision|controller judgment|review candidate/.test(text)) return "controller-decision-required";
  if (/scope|boundary|outside workspace|outside.*ledger/.test(text)) return "scope-boundary-violation";
  if (output.exitCode !== 0) return "process-exit-nonzero";
  return "semantic-error";
}

function errorCategory(code) {
  if (["runtime-timeout", "runtime-spawn-failed", "process-exit-nonzero", "unsupported-command"].includes(code)) return "runtime";
  if (["state-root-missing", "state-revision-conflict", "group-not-ready", "controller-decision-required"].includes(code)) return "state";
  if (["thread-registry-missing", "delivery-envelope-missing"].includes(code)) return "transport";
  if (["target-result-missing", "schema-invalid"].includes(code)) return "evidence";
  if (code === "scope-boundary-violation") return "boundary";
  return "semantic";
}

function retryableError(code) {
  return ["runtime-timeout", "runtime-spawn-failed"].includes(code);
}

function buildWakeflowHealth({ script, args, cwd, parsedJson, trace }) {
  if (script !== "wakeflow-cli" || trace.command !== "status" || !Array.isArray(parsedJson?.checks)) {
    return null;
  }
  const repoStatus = parsedJson.checks.find((check) => check.key === "repoStatus");
  const closedLoopStatus = parsedJson.checks.find((check) => check.key === "closedLoopStatus");
  const closedLoop = closedLoopStatus?.payload || {};
  const runtimeSummary = closedLoop.runtimeSummary || {};
  const failedChecks = parsedJson.checks
    .filter((check) => !check.ok)
    .map((check) => check.key);
  const activity = {
    packetCount: numberOrZero(closedLoop.packetCount),
    groupCount: numberOrZero(closedLoop.groupCount),
    deliveryCount: numberOrZero(closedLoop.deliveryCount),
    deliveryRunCount: numberOrZero(closedLoop.deliveryRunCount),
    resultCount: numberOrZero(closedLoop.resultCount),
    registeredThreadCount: numberOrZero(closedLoop.registeredThreadCount),
    windowConfigCount: numberOrZero(closedLoop.windowConfigCount),
    keepLiveActive: Boolean(closedLoop.keepLive?.active),
  };
  const status = failedChecks.length > 0
    ? "blocked"
    : runtimeSummary.status || (activity.keepLiveActive
      ? "active"
      : hasRuntimeEvidence(activity)
        ? "has-runtime-evidence"
        : "idle");
  return {
    kind: "WakeflowStatusHealth",
    version: 1,
    status,
    summary: summarizeHealthStatus(status, activity, failedChecks, runtimeSummary),
    root: trace.root || cwd,
    nextAction: runtimeSummary.nextAction,
    checks: {
      repoStatus: Boolean(repoStatus?.ok),
      closedLoopStatus: Boolean(closedLoopStatus?.ok),
      failed: failedChecks,
    },
    signals: {
      traffic: activity,
      runtimeSummary: runtimeSummary.kind === "WakeflowClosedLoopRuntimeSummary" ? runtimeSummary : undefined,
      errors: {
        failedCheckCount: failedChecks.length,
        failedChecks,
      },
      saturation: {
        pendingDispatchArtifacts: activity.packetCount + activity.groupCount + activity.deliveryCount,
        missingThreadRegistrations: activity.deliveryCount > 0 && activity.registeredThreadCount === 0,
      },
    },
  };
}

function summarizeHealthStatus(status, activity, failedChecks, runtimeSummary = {}) {
  if (failedChecks.length > 0) return `Blocked: failed checks ${failedChecks.join(", ")}.`;
  if (runtimeSummary.nextAction) return `Runtime next action: ${runtimeSummary.nextAction}.`;
  if (status === "blocked") return "Blocked: inspect Wakeflow runtime diagnostics.";
  if (status === "active") return "Active: keep-live worker is running.";
  if (status === "has-runtime-evidence") {
    return `Runtime evidence present: ${activity.deliveryRunCount} delivery runs and ${activity.resultCount} target results.`;
  }
  return "Idle: no delivery-loop runtime artifacts are active.";
}

function hasRuntimeEvidence(activity) {
  return activity.packetCount > 0
    || activity.groupCount > 0
    || activity.deliveryCount > 0
    || activity.deliveryRunCount > 0
    || activity.resultCount > 0;
}
