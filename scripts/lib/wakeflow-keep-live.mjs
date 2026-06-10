import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnProcess } from "../../lib/wakeflow-process.mjs";

export function createKeepLiveManager({
  version,
  workspaceRoot,
  stateDir,
  scriptPath,
  hasFlag,
  getValue,
  getAllValues,
  nowIso,
  fail,
  ensureStateDirs,
  atomicWriteJson,
}) {
  const keepLiveDir = path.join(stateDir, "keep-live");

  function keepLiveStateFile() {
    return path.join(keepLiveDir, "state.json");
  }

  function keepLiveControlFile() {
    return path.join(keepLiveDir, "control.json");
  }

  function keepLiveCommand() {
    return getValue(
      "--keep-live-command",
      process.env.CODEX_AUTOMATION_KEEP_LIVE_COMMAND || "caffeinate",
    );
  }

  function keepLiveArgs() {
    const explicitArgs = getAllValues("--keep-live-arg");
    if (explicitArgs.length > 0) return explicitArgs;
    const jsonArgs = process.env.CODEX_AUTOMATION_KEEP_LIVE_ARGS_JSON;
    if (jsonArgs) {
      try {
        const parsed = JSON.parse(jsonArgs);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
      } catch {
        return ["-dims"];
      }
    }
    return ["-dims"];
  }

  function keepLiveEnabled() {
    if (hasFlag("--no-keep-live")) return false;
    if (process.env.CODEX_AUTOMATION_KEEP_LIVE === "0") return false;
    return true;
  }

  function keepLiveMechanism(commandName = keepLiveCommand()) {
    return process.platform === "darwin" && path.basename(commandName) === "caffeinate" ? "macos-caffeinate" : "process-watch";
  }

  function readOptionalJson(file) {
    if (!existsSync(file)) return {};
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }

  function isPidRunning(pid) {
    const numericPid = Number(pid);
    if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
    try {
      process.kill(numericPid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  }

  function sleepSync(ms) {
    const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(waitBuffer, 0, 0, ms);
  }

  function waitForPidExit(pid, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isPidRunning(pid)) return true;
      sleepSync(50);
    }
    return !isPidRunning(pid);
  }

  function normalizeKeepLiveState(state = {}) {
    const commandName = state.command || keepLiveCommand();
    const args = Array.isArray(state.args) && state.args.every((item) => typeof item === "string") ? state.args : keepLiveArgs();
    const workerPid = Number.isInteger(Number(state.workerPid)) ? Number(state.workerPid) : Number(state.pid) || 0;
    const childPid = Number.isInteger(Number(state.childPid)) ? Number(state.childPid) : 0;
    const leases = normalizeKeepLiveLeases(state.leases, state.automationRunId, state);
    return {
      kind: "AutomationKeepLiveState",
      version,
      enabled: keepLiveEnabled(),
      automationRunId: state.automationRunId || "",
      leases,
      activeAutomationRunIds: Object.keys(leases).sort(),
      activeRunCount: Object.keys(leases).length,
      mechanism: state.mechanism || keepLiveMechanism(commandName),
      strategy: state.strategy || "watcher",
      platform: process.platform,
      command: commandName,
      args,
      token: typeof state.token === "string" ? state.token : "",
      pid: workerPid,
      workerPid,
      childPid,
      status: state.status || "missing",
      startedAt: state.startedAt,
      stoppedAt: state.stoppedAt,
      stopReason: state.stopReason || "",
      lastCheckedAt: nowIso(),
      error: state.error || null,
    };
  }

  function normalizeKeepLiveLeases(rawLeases, legacyAutomationRunId = "", state = {}) {
    const leases = {};
    if (rawLeases && typeof rawLeases === "object" && !Array.isArray(rawLeases)) {
      for (const [rawId, rawLease] of Object.entries(rawLeases)) {
        const automationRunId = String(rawId || "").trim();
        if (!automationRunId) continue;
        const lease = rawLease && typeof rawLease === "object" ? rawLease : {};
        leases[automationRunId] = {
          automationRunId,
          startedAt: typeof lease.startedAt === "string" ? lease.startedAt : nowIso(),
          lastSeenAt: typeof lease.lastSeenAt === "string" ? lease.lastSeenAt : nowIso(),
        };
      }
    }
    const legacyId = String(legacyAutomationRunId || "").trim();
    const legacyStateIsRunning = state.status === "running" || state.active === true;
    if (legacyId && legacyStateIsRunning && Object.keys(leases).length === 0) {
      leases[legacyId] = {
        automationRunId: legacyId,
        startedAt: nowIso(),
        lastSeenAt: nowIso(),
      };
    }
    return leases;
  }

  function keepLiveLeaseIds(leases = {}) {
    return Object.keys(leases).sort();
  }

  function touchKeepLiveLease(leases, automationRunId) {
    const id = String(automationRunId || "").trim();
    if (!id) fail("--automation-run-id is required for keep-live lease ownership.");
    const now = nowIso();
    return {
      ...leases,
      [id]: {
        automationRunId: id,
        startedAt: leases[id]?.startedAt || now,
        lastSeenAt: now,
      },
    };
  }

  function releaseKeepLiveLease(leases, automationRunId) {
    const ids = keepLiveLeaseIds(leases);
    if (ids.length === 0) return { leases, releasedAutomationRunId: "", remainingIds: [] };
    const id = String(automationRunId || "").trim();
    const releaseId = id || (ids.length === 1 ? ids[0] : "");
    if (!releaseId || !leases[releaseId]) {
      return { leases, releasedAutomationRunId: "", remainingIds: ids };
    }
    const nextLeases = { ...leases };
    delete nextLeases[releaseId];
    return {
      leases: nextLeases,
      releasedAutomationRunId: releaseId,
      remainingIds: keepLiveLeaseIds(nextLeases),
    };
  }

  function keepLiveStatus(extra = {}) {
    const state = normalizeKeepLiveState(readOptionalJson(keepLiveStateFile()));
    const workerActive = isPidRunning(state.workerPid);
    const childActive = isPidRunning(state.childPid);
    const active = workerActive || childActive;
    const status = active ? "running" : state.status === "failed" ? "failed" : state.status === "stopped" ? "stopped" : "missing";
    return {
      ...state,
      ...extra,
      active,
      workerActive,
      childActive,
      status: extra.status || status,
      lastCheckedAt: nowIso(),
    };
  }

  function writeKeepLiveControl(value) {
    atomicWriteJson(keepLiveControlFile(), value);
  }

  function readKeepLiveControl() {
    return readOptionalJson(keepLiveControlFile());
  }

  function keepLiveWorkerArgs(status, token, automationRunId) {
    return [
      scriptPath,
      "keep-live-worker",
      "--root",
      workspaceRoot,
      "--state-dir",
      stateDir,
      "--automation-run-id",
      automationRunId,
      "--token",
      token,
      "--keep-live-command",
      status.command,
      ...status.args.flatMap((arg) => ["--keep-live-arg", arg]),
    ];
  }

  function readWorkerControl(token, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const control = readKeepLiveControl();
      if (control.token === token && (Number(control.childPid) > 0 || control.action === "failed")) return control;
      sleepSync(25);
    }
    return readKeepLiveControl();
  }

  function writeKeepLiveState(state) {
    ensureStateDirs();
    atomicWriteJson(keepLiveStateFile(), state);
  }

  function startKeepLive({ automationRunId }) {
    const current = keepLiveStatus({
      automationRunId,
      command: keepLiveCommand(),
      args: keepLiveArgs(),
    });
    const leases = touchKeepLiveLease(current.leases, automationRunId);
    if (!current.enabled) {
      const state = { ...current, leases: {}, activeAutomationRunIds: [], activeRunCount: 0, active: false, status: "stopped", stopReason: "disabled", pid: 0, workerPid: 0, childPid: 0 };
      writeKeepLiveState(state);
      return { ...state, message: "disabled" };
    }
    if (current.platform !== "darwin") {
      const state = { ...current, leases: {}, activeAutomationRunIds: [], activeRunCount: 0, active: false, status: "stopped", stopReason: "non-darwin", pid: 0, workerPid: 0, childPid: 0 };
      writeKeepLiveState(state);
      return { ...state, message: "macOS only" };
    }
    if (current.active) {
      const activeAutomationRunIds = keepLiveLeaseIds(leases);
      const state = {
        ...current,
        automationRunId: current.automationRunId || automationRunId,
        requestedAutomationRunId: automationRunId,
        leases,
        activeAutomationRunIds,
        activeRunCount: activeAutomationRunIds.length,
        status: "running",
      };
      writeKeepLiveState(state);
      return { ...state, message: "already running" };
    }

    const token = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
    writeKeepLiveControl({
      version,
      action: "run",
      token,
      automationRunId,
      requestedAt: nowIso(),
      command: current.command,
      args: current.args,
      workerPid: 0,
      childPid: 0,
    });

    try {
      const worker = spawnProcess(process.execPath, keepLiveWorkerArgs(current, token, automationRunId), {
        detached: true,
        stdio: "ignore",
      });
      worker.unref?.();
      const control = readWorkerControl(token);
      if (!worker.pid || control.action === "failed") {
        const state = {
          ...current,
          automationRunId,
          active: false,
          status: "failed",
          token,
          pid: 0,
          workerPid: 0,
          childPid: 0,
          error: control.error || "worker did not start",
        };
        writeKeepLiveState(state);
        return { ...state, message: "failed" };
      }
      const state = {
        ...current,
        automationRunId,
        active: true,
        workerActive: true,
        childActive: Number(control.childPid) > 0,
        leases,
        activeAutomationRunIds: keepLiveLeaseIds(leases),
        activeRunCount: keepLiveLeaseIds(leases).length,
        status: "running",
        token,
        pid: worker.pid,
        workerPid: worker.pid,
        childPid: Number(control.childPid) || 0,
        startedAt: nowIso(),
        stoppedAt: undefined,
        stopReason: "",
        error: null,
      };
      writeKeepLiveState(state);
      return { ...state, message: "started" };
    } catch (error) {
      const state = {
        ...current,
        automationRunId,
        active: false,
        status: "failed",
        token,
        pid: 0,
        workerPid: 0,
        childPid: 0,
        error: error.message,
      };
      writeKeepLiveState(state);
      return { ...state, message: "failed" };
    }
  }

  function stopKeepLive({ automationRunId = "", reason = "" } = {}) {
    const current = keepLiveStatus();
    const stopReason = reason || "stopped";
    const release = releaseKeepLiveLease(current.leases, automationRunId);
    const remainingIds = release.remainingIds;
    if (!current.active) {
      const state = {
        ...current,
        automationRunId: automationRunId || current.automationRunId,
        requestedAutomationRunId: automationRunId || undefined,
        leases: {},
        activeAutomationRunIds: [],
        activeRunCount: 0,
        active: false,
        workerActive: false,
        childActive: false,
        status: "stopped",
        pid: 0,
        workerPid: 0,
        childPid: 0,
        token: "",
        stoppedAt: current.stoppedAt || nowIso(),
        stopReason,
        error: null,
      };
      writeKeepLiveState(state);
      return { ...state, message: current.status === "missing" ? "not started" : "not running" };
    }

    if (remainingIds.length > 0) {
      const state = {
        ...current,
        requestedAutomationRunId: automationRunId || undefined,
        releasedAutomationRunId: release.releasedAutomationRunId,
        leases: release.leases,
        activeAutomationRunIds: remainingIds,
        activeRunCount: remainingIds.length,
        active: true,
        status: "running",
        stopReason: `released ${release.releasedAutomationRunId || "no matching lease"}: ${stopReason}`,
        lastCheckedAt: nowIso(),
      };
      writeKeepLiveState(state);
      return {
        ...state,
        message: release.releasedAutomationRunId ? "lease released; keep-live still needed" : "keep-live still needed",
        retainedByOtherRuns: true,
      };
    }

    if (current.strategy === "watcher" && current.token) {
      writeKeepLiveControl({
        version,
        action: "stop",
        token: current.token,
        automationRunId: automationRunId || current.automationRunId,
        requestedAt: nowIso(),
        reason: stopReason,
        workerPid: current.workerPid,
        childPid: current.childPid,
      });
      const workerExited = waitForPidExit(current.workerPid, 5000);
      const childExited = waitForPidExit(current.childPid, 3000);
      const workerActive = isPidRunning(current.workerPid);
      const childActive = isPidRunning(current.childPid);
      const state = {
        ...current,
        automationRunId: automationRunId || current.automationRunId,
        active: workerActive || childActive,
        workerActive,
        childActive,
        leases: {},
        activeAutomationRunIds: [],
        activeRunCount: 0,
        releasedAutomationRunId: release.releasedAutomationRunId,
        status: workerActive || childActive ? "failed" : "stopped",
        pid: workerActive ? current.workerPid : 0,
        workerPid: workerActive ? current.workerPid : 0,
        childPid: childActive ? current.childPid : 0,
        token: workerActive || childActive ? current.token : "",
        stoppedAt: workerActive || childActive ? undefined : nowIso(),
        stopReason,
        error: [
          workerExited ? "" : `worker pid ${current.workerPid} did not exit after stop marker`,
          childExited ? "" : `keep-live child pid ${current.childPid} did not exit after worker stop`,
        ].filter(Boolean).join("; ") || null,
      };
      writeKeepLiveState(state);
      return { ...state, message: state.active ? "stop failed" : "stopped" };
    }

    try {
      process.kill(current.workerPid, "SIGTERM");
    } catch (error) {
      const state = { ...current, status: "failed", error: error.message };
      writeKeepLiveState(state);
      return { ...state, message: "stop failed" };
    }
    const stopped = waitForPidExit(current.workerPid, 3000);
    const active = !stopped && isPidRunning(current.workerPid);
    const state = {
      ...current,
      automationRunId: automationRunId || current.automationRunId,
      leases: {},
      activeAutomationRunIds: [],
      activeRunCount: 0,
      releasedAutomationRunId: release.releasedAutomationRunId,
      active,
      workerActive: active,
      childActive: false,
      status: active ? "failed" : "stopped",
      pid: active ? current.workerPid : 0,
      workerPid: active ? current.workerPid : 0,
      childPid: 0,
      token: active ? current.token : "",
      stoppedAt: active ? undefined : nowIso(),
      stopReason,
      error: active ? `pid ${current.workerPid} did not exit after SIGTERM` : null,
    };
    writeKeepLiveState(state);
    return { ...state, message: active ? "stop failed" : "stopped" };
  }

  function keepLiveWorkerCommandArgs(commandName, args) {
    if (process.platform === "darwin" && path.basename(commandName) === "caffeinate" && !args.includes("-w")) {
      return [...args, "-w", String(process.pid)];
    }
    return args;
  }

  function runKeepLiveWorker({ automationRunId, token }) {
    const commandName = keepLiveCommand();
    const childArgs = keepLiveWorkerCommandArgs(commandName, keepLiveArgs());
    let child = null;
    let exiting = false;
    let pollTimer = null;

    const writeWorkerState = (state) => {
      writeKeepLiveState({
        kind: "AutomationKeepLiveState",
        version,
        enabled: true,
        automationRunId,
        mechanism: keepLiveMechanism(commandName),
        strategy: "watcher",
        platform: process.platform,
        command: commandName,
        args: childArgs,
        token,
        pid: process.pid,
        workerPid: process.pid,
        childPid: child?.pid || 0,
        lastCheckedAt: nowIso(),
        ...state,
      });
    };

    const stopChild = () => {
      if (!child?.pid || !isPidRunning(child.pid)) return;
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        return;
      }
      if (!waitForPidExit(child.pid, 1200)) {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {
          // Residual process state is surfaced by the parent stop command.
        }
      }
    };

    const exitWorker = (code = 0, state = {}) => {
      if (exiting) return;
      exiting = true;
      stopChild();
      writeWorkerState({
        active: false,
        workerActive: false,
        childActive: false,
        status: state.status || "stopped",
        stoppedAt: nowIso(),
        stopReason: state.stopReason || "worker exit",
        error: state.error || null,
      });
      if (pollTimer) clearInterval(pollTimer);
      process.exitCode = code;
    };

    try {
      child = spawnProcess(commandName, childArgs, { stdio: "ignore" });
    } catch (error) {
      writeKeepLiveControl({
        version,
        action: "failed",
        token,
        automationRunId,
        workerPid: process.pid,
        childPid: 0,
        updatedAt: nowIso(),
        error: error.message,
      });
      writeWorkerState({ active: false, status: "failed", error: error.message });
      process.exitCode = 1;
      return;
    }

    writeKeepLiveControl({
      version,
      action: "run",
      token,
      automationRunId,
      workerPid: process.pid,
      childPid: child.pid || 0,
      updatedAt: nowIso(),
      command: commandName,
      args: childArgs,
    });
    writeWorkerState({
      active: true,
      workerActive: true,
      childActive: Boolean(child.pid),
      status: "running",
      startedAt: nowIso(),
      error: null,
    });

    child.on("exit", () => exitWorker(0, { stopReason: "keep-live child exited" }));
    process.on("SIGTERM", () => exitWorker(0, { stopReason: "worker SIGTERM" }));
    process.on("SIGINT", () => exitWorker(0, { stopReason: "worker SIGINT" }));

    pollTimer = setInterval(() => {
      const control = readKeepLiveControl();
      if (control.token === token && control.action === "stop") {
        exitWorker(0, { stopReason: control.reason || "stop marker" });
      }
      const state = readOptionalJson(keepLiveStateFile());
      if (state.token === token && state.status === "stopped") {
        exitWorker(0, { stopReason: state.stopReason || "state stopped" });
      }
    }, 500).unref?.();
  }

  return {
    keepLiveStateFile,
    keepLiveControlFile,
    keepLiveStatus,
    startKeepLive,
    stopKeepLive,
    runKeepLiveWorker,
  };
}
