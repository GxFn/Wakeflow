import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hostProfile } from "./wakeflow-host-profile.mjs";

// F25: single authority for releasing a window delivery lock when a result answers it — read
// the lock file, apply the caller's matches(lock) decision, unlink on a match. Both the
// state-script (import-target-result) and the delivery-script (record-target-result) route
// their release through here, so the lock-file operation lives in one place and the release
// contract is identical. Freshness is NOT a gate: an own/matching lock clears whether fresh
// or stale (a stale lock is ignored by dispatch anyway); a different-delivery lock survives.
export function releaseWindowLockForResult(lockFile, matches) {
  if (!existsSync(lockFile)) return false;
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockFile, "utf8"));
  } catch {
    return false; // unreadable lock: leave it for release-window-lock recovery
  }
  if (!matches(lock)) return false;
  unlinkSync(lockFile);
  return true;
}

export function createDeliveryStore({
  workspaceRoot,
  stateDir,
  slug,
  nowIso,
  fail,
}) {
  const hostRuntimeDir = path.join(stateDir, "hosts", hostProfile.runtime.hostDirName);
  const legacyRegistryDir = path.join(stateDir, "thread-registry");
  const dirs = {
    packets: path.join(stateDir, "dispatch-packets"),
    groups: path.join(stateDir, "dispatch-groups"),
    deliveries: path.join(stateDir, "delivery-envelopes"),
    deliveryRuns: path.join(stateDir, "delivery-runs"),
    results: path.join(stateDir, "target-results"),
    locks: path.join(stateDir, "locks"),
    registry: path.join(hostRuntimeDir, "thread-registry"),
    windowConfig: path.join(hostRuntimeDir, "window-config"),
    keepLive: path.join(hostRuntimeDir, "keep-live"),
  };

  function ensureInsideWorkspace(file, label) {
    const relative = path.relative(workspaceRoot, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      fail(`${label} must stay inside workspace: ${file}`);
    }
  }

  function ensureStateDirs() {
    for (const dir of Object.values(dirs)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  function atomicWriteJson(file, value) {
    ensureInsideWorkspace(file, "closed-loop state");
    mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
      renameSync(temp, file);
    } catch (error) {
      if (existsSync(temp)) unlinkSync(temp);
      throw error;
    }
  }

  function appendJsonLine(file, value) {
    ensureInsideWorkspace(file, "controller event log");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value)}\n`, { flag: "a" });
  }

  function readJson(file, label = "JSON file") {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      fail(`Invalid ${label} ${file}: ${error.message}`);
    }
  }

  function resolveInputPath(value, label) {
    if (!value) fail(`${label} is required.`);
    const file = path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
    if (!existsSync(file)) fail(`${label} does not exist: ${value}`);
    return file;
  }

  function resolveStateRoot(value) {
    const stateRoot = resolveInputPath(value, "--state-root");
    ensureInsideWorkspace(stateRoot, "state root");
    const stateFile = path.join(stateRoot, "wakeflow-state.json");
    if (!existsSync(stateFile)) fail(`--state-root is missing wakeflow-state.json: ${value}`);
    return stateRoot;
  }

  function readControllerStateRoot(stateRoot) {
    const state = readJson(path.join(stateRoot, "wakeflow-state.json"), "controller state");
    return {
      state,
      stateRootRef: path.relative(workspaceRoot, stateRoot),
    };
  }

  function readTaskPackageFromStateRoot(stateRoot, taskPackageId) {
    const file = path.join(stateRoot, "task-packages", `${slug(taskPackageId)}.json`);
    if (!existsSync(file)) fail(`task package does not exist in state root: ${taskPackageId}`);
    return readJson(file, "task package");
  }

  function packetFileFor(packetId) {
    return path.join(dirs.packets, `${slug(packetId)}.json`);
  }

  function groupFileFor(groupId) {
    return path.join(dirs.groups, `${slug(groupId)}.json`);
  }

  function deliveryFileFor(deliveryId) {
    return path.join(dirs.deliveries, `${slug(deliveryId)}.json`);
  }

  function deliveryRunFileFor(deliveryRunId) {
    return path.join(dirs.deliveryRuns, `${slug(deliveryRunId)}.json`);
  }

  function threadFileFor(windowName) {
    return path.join(dirs.registry, `${slug(windowName)}.json`);
  }

  function findThreadFile(windowName) {
    const hostFile = threadFileFor(windowName);
    if (existsSync(hostFile)) return hostFile;
    if (hostProfile.runtime.legacyRegistryFallback) {
      const legacyFile = path.join(legacyRegistryDir, `${slug(windowName)}.json`);
      if (existsSync(legacyFile)) return legacyFile;
    }
    return hostFile;
  }

  function legacyThreadRegistryEntries() {
    if (!hostProfile.runtime.legacyRegistryFallback || !existsSync(legacyRegistryDir)) return [];
    return readdirSync(legacyRegistryDir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => path.join(legacyRegistryDir, name));
  }

  function lockFileFor(windowName) {
    return path.join(dirs.locks, `${slug(windowName)}.json`);
  }

  function readWindowLock(windowName) {
    const file = lockFileFor(windowName);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  function windowLockFresh(lock) {
    if (!lock?.expiresAt) return false;
    return Date.parse(lock.expiresAt) > Date.now();
  }

  function writeWindowLock(windowName, { deliveryId, ttlSeconds = 7200 } = {}) {
    // Shared cross-host advisory lock: one in-flight delivery per window. Both
    // host editions write it on record-delivery-run (status=sent) and check it
    // before dispatching into the same repository working tree.
    atomicWriteJson(lockFileFor(windowName), {
      kind: "WakeflowWindowDeliveryLock",
      version: 1,
      windowName,
      host: hostProfile.runtime.hostDirName,
      deliveryId: deliveryId || undefined,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    });
  }

  function removeWindowLock(windowName) {
    const file = lockFileFor(windowName);
    if (existsSync(file)) unlinkSync(file);
  }

  function listFreshWindowLocks() {
    return listJsonFiles(dirs.locks)
      .map((file) => {
        try {
          return JSON.parse(readFileSync(file, "utf8"));
        } catch {
          return null;
        }
      })
      .filter((lock) => windowLockFresh(lock));
  }

  function listHostRuntimes() {
    // Cross-host visibility: enumerate every host runtime under hosts/ so a
    // controller can see the other host's registrations (read-only).
    const hostsDir = path.join(stateDir, "hosts");
    if (!existsSync(hostsDir)) return [];
    return readdirSync(hostsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      // a host runtime dir carries at least one known runtime surface; stray
      // directories under hosts/ are not hosts
      .filter((entry) => ["thread-registry", "window-config", "keep-live", "window-host"]
        .some((marker) => existsSync(path.join(hostsDir, entry.name, marker))))
      .map((entry) => {
        const registry = path.join(hostsDir, entry.name, "thread-registry");
        const registeredWindows = existsSync(registry)
          ? readdirSync(registry).filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, "")).sort()
          : [];
        return { host: entry.name, registeredWindows };
      });
  }

  function listDispatchGroupsForTask(targetWindow, taskId) {
    const groups = new Set();
    for (const file of listJsonFiles(dirs.packets)) {
      try {
        const packet = JSON.parse(readFileSync(file, "utf8"));
        if (packet.targetWindow === targetWindow
          && (packet.taskId === taskId || packet.targetTaskId === taskId || packet.stateRef?.targetTaskId === taskId)
          && packet.dispatchGroup) {
          groups.add(packet.dispatchGroup);
        }
      } catch {
        // unreadable packets are skipped
      }
    }
    return [...groups];
  }

  function windowConfigFileFor(windowName) {
    return path.join(dirs.windowConfig, `${slug(windowName)}.json`);
  }

  function resultFileFor(targetWindow, taskId, dispatchGroup = "") {
    const parts = [dispatchGroup, targetWindow, taskId].filter(Boolean).map(slug);
    return path.join(dirs.results, `${parts.join("__")}.json`);
  }

  function supersededResultFileFor(targetWindow, taskId, dispatchGroup = "", supersededAt = nowIso()) {
    const parts = [dispatchGroup, targetWindow, taskId].filter(Boolean).map(slug);
    const stamp = supersededAt.replace(/[-:.TZ]/g, "").slice(0, 14);
    return path.join(dirs.results, "superseded", `${parts.join("__")}__superseded-${stamp}.json`);
  }

  function listJsonFiles(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => path.join(dir, name));
  }

  return {
    dirs,
    ensureInsideWorkspace,
    ensureStateDirs,
    atomicWriteJson,
    appendJsonLine,
    readJson,
    resolveInputPath,
    resolveStateRoot,
    readControllerStateRoot,
    readTaskPackageFromStateRoot,
    packetFileFor,
    groupFileFor,
    deliveryFileFor,
    deliveryRunFileFor,
    threadFileFor,
    findThreadFile,
    legacyThreadRegistryEntries,
    lockFileFor,
    readWindowLock,
    windowLockFresh,
    writeWindowLock,
    removeWindowLock,
    listFreshWindowLocks,
    listHostRuntimes,
    listDispatchGroupsForTask,
    windowConfigFileFor,
    resultFileFor,
    supersededResultFileFor,
    listJsonFiles,
  };
}
