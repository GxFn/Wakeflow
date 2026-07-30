import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { appendControllerEventAtomic } from "./wakeflow-controller-events.mjs";
import { hostProfile } from "./wakeflow-host-profile.mjs";
import {
  createSanctionedStateRootResolver,
  WakeflowStatePathError,
} from "./wakeflow-state-paths.mjs";

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

// Resolve every existing path component (including symlinks), then append only
// the still-missing suffix. This covers both existing inputs and future output
// files: a symlinked parent cannot redirect a lexically in-workspace path.
function projectedRealPath(file) {
  const missing = [];
  let current = path.resolve(file);
  while (true) {
    try {
      lstatSync(current);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
      continue;
    }
    const resolved = realpathSync(current);
    return path.join(resolved, ...missing.reverse());
  }
}

function pathResolvesInside(root, file) {
  try {
    return pathIsInside(realpathSync(path.resolve(root)), projectedRealPath(file));
  } catch {
    return false;
  }
}

function inferredWorkspaceRootForRuntimeLock(lockFile) {
  const absolute = path.resolve(lockFile);
  const marker = `${path.sep}.wakeflow-local${path.sep}wakeflow-delivery${path.sep}locks${path.sep}`;
  const markerIndex = absolute.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  return absolute.slice(0, markerIndex) || path.parse(absolute).root;
}

// F25: single authority for releasing a window delivery lock when a result answers it — read
// the lock file, apply the caller's matches(lock) decision, unlink on a match. Both the
// state-script (import-target-result) and the delivery-script (record-target-result) route
// their release through here, so the lock-file operation lives in one place and the release
// contract is identical. Freshness is NOT a gate: an own/matching lock clears whether fresh
// or stale (a stale lock is ignored by dispatch anyway); a different-delivery lock survives.
export function releaseWindowLockForResult(lockFile, matches) {
  if (!existsSync(lockFile)) return false;
  const inferredWorkspaceRoot = inferredWorkspaceRootForRuntimeLock(lockFile);
  if (inferredWorkspaceRoot && !pathResolvesInside(inferredWorkspaceRoot, lockFile)) return false;
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
  sanctionedStateRoots = [],
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
  const realWorkspaceRoot = realpathSync(path.resolve(workspaceRoot));
  const stateRootResolver = createSanctionedStateRootResolver({
    workspaceRoot,
    sanctionedRoots: sanctionedStateRoots,
  });

  function ensureInsideWorkspace(file, label) {
    let realCandidate;
    try {
      realCandidate = projectedRealPath(file);
    } catch {
      fail(`${label} must stay inside workspace: ${file}`);
      return;
    }
    if (!pathIsInside(realWorkspaceRoot, realCandidate)) {
      fail(`${label} must stay inside workspace: ${file}`);
    }
  }

  function ensureStateDirs() {
    for (const dir of Object.values(dirs)) {
      ensureInsideWorkspace(dir, "closed-loop state directory");
      mkdirSync(dir, { recursive: true });
    }
  }

  function atomicWriteJsonUnchecked(file, value) {
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

  function atomicWriteJson(file, value) {
    ensureInsideWorkspace(file, "closed-loop state");
    atomicWriteJsonUnchecked(file, value);
  }

  function appendJsonLineUnchecked(file, value) {
    mkdirSync(path.dirname(file), { recursive: true });
    let fd;
    try {
      fd = openSync(
        file,
        constants.O_WRONLY
          | constants.O_APPEND
          | constants.O_CREAT
          | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      writeFileSync(fd, `${JSON.stringify(value)}\n`);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  function appendJsonLine(file, value) {
    ensureInsideWorkspace(file, "controller event log");
    appendJsonLineUnchecked(file, value);
  }

  function readJsonUnchecked(file, label = "JSON file") {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      fail(`Invalid ${label} ${file}: ${error.message}`);
    }
  }

  function readJson(file, label = "JSON file") {
    ensureInsideWorkspace(file, label);
    return readJsonUnchecked(file, label);
  }

  function resolveInputPath(value, label) {
    if (!value) fail(`${label} is required.`);
    const file = path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
    if (!existsSync(file)) fail(`${label} does not exist: ${value}`);
    ensureInsideWorkspace(file, label);
    return file;
  }

  function resolveStateRoot(value) {
    try {
      return stateRootResolver.resolveStateRoot(value);
    } catch (error) {
      if (error instanceof WakeflowStatePathError) {
        fail(error.message);
      }
      throw error;
    }
  }

  function resolveStateFile(stateRoot, relativePath, {
    label = "state-root file",
    requireExisting = false,
  } = {}) {
    try {
      return stateRootResolver.resolveStateRootFile(stateRoot, relativePath, {
        label,
        requireExisting,
      });
    } catch (error) {
      if (error instanceof WakeflowStatePathError) {
        fail(error.message);
      }
      throw error;
    }
  }

  function readStateRootJson(stateRoot, relativePath, label = "state-root JSON file") {
    const file = resolveStateFile(stateRoot, relativePath, {
      label,
      requireExisting: true,
    });
    return readJsonUnchecked(file, label);
  }

  function atomicWriteStateRootJson(stateRoot, relativePath, value, label = "state-root JSON file") {
    const file = resolveStateFile(stateRoot, relativePath, {
      label,
      requireExisting: existsSync(path.join(stateRoot, relativePath)),
    });
    atomicWriteJsonUnchecked(file, value);
  }

  function appendStateRootJsonLine(stateRoot, relativePath, value, label = "state-root JSONL file") {
    const file = resolveStateFile(stateRoot, relativePath, {
      label,
      requireExisting: existsSync(path.join(stateRoot, relativePath)),
    });
    appendControllerEventAtomic(file, value);
  }

  function readControllerStateRoot(stateRoot) {
    const state = readStateRootJson(stateRoot, "wakeflow-state.json", "controller state");
    return {
      state,
      stateRootRef: path.relative(workspaceRoot, stateRoot),
    };
  }

  function readTaskPackageFromStateRoot(stateRoot, taskPackageId) {
    const relativePath = path.join("task-packages", `${slug(taskPackageId)}.json`);
    const file = path.join(stateRoot, relativePath);
    if (!existsSync(file)) fail(`task package does not exist in state root: ${taskPackageId}`);
    return readStateRootJson(stateRoot, relativePath, "task package");
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
    ensureInsideWorkspace(legacyRegistryDir, "legacy thread registry");
    return readdirSync(legacyRegistryDir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => {
        const file = path.join(legacyRegistryDir, name);
        ensureInsideWorkspace(file, "legacy thread registration");
        return file;
      });
  }

  function lockFileFor(windowName) {
    return path.join(dirs.locks, `${slug(windowName)}.json`);
  }

  function readWindowLock(windowName) {
    const file = lockFileFor(windowName);
    if (!existsSync(file)) return null;
    ensureInsideWorkspace(file, "window delivery lock");
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
    if (existsSync(file)) {
      ensureInsideWorkspace(file, "window delivery lock");
      unlinkSync(file);
    }
  }

  // Generic prune helper: unlink one runtime transport file (e.g. a delivery-run). Returns
  // whether the file existed and was removed. Used by prune-runtime.
  function removeRuntimeFile(file) {
    if (!existsSync(file)) return false;
    ensureInsideWorkspace(file, "runtime transport file");
    unlinkSync(file);
    return true;
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
    ensureInsideWorkspace(hostsDir, "host runtime directory");
    return readdirSync(hostsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      // a host runtime dir carries at least one known runtime surface; stray
      // directories under hosts/ are not hosts
      .filter((entry) => ["thread-registry", "window-config", "keep-live", "window-host"]
        .some((marker) => existsSync(path.join(hostsDir, entry.name, marker))))
      .map((entry) => {
        const registry = path.join(hostsDir, entry.name, "thread-registry");
        let registeredWindows = [];
        if (existsSync(registry)) {
          ensureInsideWorkspace(registry, "host thread registry");
          registeredWindows = readdirSync(registry)
            .filter((name) => name.endsWith(".json"))
            .map((name) => name.replace(/\.json$/, ""))
            .sort();
        }
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

  function supersededResultFileFor(
    targetWindow,
    taskId,
    dispatchGroup = "",
    supersededAt = nowIso(),
    resultRevision = null,
  ) {
    const parts = [dispatchGroup, targetWindow, taskId].filter(Boolean).map(slug);
    const stamp = supersededAt.replace(/[-:.TZ]/g, "").slice(0, 14);
    const revisionSuffix = Number.isInteger(resultRevision) && resultRevision > 0
      ? `__revision-${String(resultRevision).padStart(4, "0")}`
      : "";
    return path.join(
      dirs.results,
      "superseded",
      `${parts.join("__")}__superseded-${stamp}${revisionSuffix}.json`,
    );
  }

  function listJsonFiles(dir) {
    if (!existsSync(dir)) return [];
    ensureInsideWorkspace(dir, "runtime JSON directory");
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => {
        const file = path.join(dir, name);
        ensureInsideWorkspace(file, "runtime JSON file");
        return file;
      });
  }

  return {
    dirs,
    ensureInsideWorkspace,
    ensureStateDirs,
    atomicWriteJson,
    appendJsonLine,
    readJson,
    readStateRootJson,
    atomicWriteStateRootJson,
    appendStateRootJsonLine,
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
    removeRuntimeFile,
    listFreshWindowLocks,
    listHostRuntimes,
    listDispatchGroupsForTask,
    windowConfigFileFor,
    resultFileFor,
    supersededResultFileFor,
    listJsonFiles,
  };
}
