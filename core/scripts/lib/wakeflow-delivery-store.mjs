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
import { randomUUID } from "node:crypto";
import {
  stableArtifactPart,
  transportArtifactFileName,
} from "./wakeflow-artifact-identity.mjs";
import { appendControllerEventAtomic } from "./wakeflow-controller-events.mjs";
import { hostProfile } from "./wakeflow-host-profile.mjs";
import { withFileLock } from "./wakeflow-state-lock.mjs";
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
  return withFileLock(`${lockFile}.guard`, () => {
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
  });
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

  function legacyArtifactFileFor(dir, logicalId) {
    return path.join(dir, `${slug(logicalId)}.json`);
  }

  function artifactFileFor(dir, logicalId, stateRef = null) {
    return path.join(dir, transportArtifactFileName(logicalId, stateRef));
  }

  function findArtifactFile(dir, logicalId, stateRef = null) {
    const canonical = artifactFileFor(dir, logicalId, stateRef);
    if (existsSync(canonical)) return canonical;
    const legacy = legacyArtifactFileFor(dir, logicalId);
    return existsSync(legacy) ? legacy : canonical;
  }

  function packetFileFor(packetId, stateRef = null) {
    return artifactFileFor(dirs.packets, packetId, stateRef);
  }

  function findPacketFile(packetId, stateRef = null) {
    return findArtifactFile(dirs.packets, packetId, stateRef);
  }

  function groupFileFor(groupId, stateRef = null) {
    return artifactFileFor(dirs.groups, groupId, stateRef);
  }

  function findGroupFile(groupId, stateRef = null) {
    return findArtifactFile(dirs.groups, groupId, stateRef);
  }

  function deliveryFileFor(deliveryId, stateRef = null) {
    return artifactFileFor(dirs.deliveries, deliveryId, stateRef);
  }

  function findDeliveryFile(deliveryId, stateRef = null) {
    return findArtifactFile(dirs.deliveries, deliveryId, stateRef);
  }

  function deliveryRunFileFor(deliveryRunId, stateRef = null) {
    return artifactFileFor(dirs.deliveryRuns, deliveryRunId, stateRef);
  }

  function findDeliveryRunFile(deliveryRunId, stateRef = null) {
    return findArtifactFile(dirs.deliveryRuns, deliveryRunId, stateRef);
  }

  function threadFileFor(windowName) {
    return path.join(dirs.registry, `${stableArtifactPart(windowName, { fallback: "window" })}.json`);
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
    return path.join(dirs.locks, `${stableArtifactPart(windowName, { fallback: "window" })}.json`);
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
    if (!deliveryId) fail(`window work lease for ${windowName} requires deliveryId.`);
    ensureStateDirs();
    const leaseFile = lockFileFor(windowName);
    return withFileLock(`${leaseFile}.guard`, () => {
      const existing = readWindowLock(windowName);
      if (windowLockFresh(existing)) {
        if (existing.deliveryId !== deliveryId) {
          fail(`Window ${windowName} already has a fresh in-flight delivery lease from host ${existing.host || "unknown"} (delivery ${existing.deliveryId || "unknown"}, expires ${existing.expiresAt}); wait for its matching result or release the stale lease explicitly.`);
        }
        return { acquired: false, replay: true, lease: existing };
      }
      const createdAt = nowIso();
      const lease = {
        kind: "WakeflowWindowDeliveryLock",
        version: 2,
        leaseId: randomUUID(),
        windowName,
        host: hostProfile.runtime.hostDirName,
        deliveryId,
        createdAt,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      };
      atomicWriteJson(leaseFile, lease);
      return { acquired: true, replay: false, lease };
    });
  }

  function removeWindowLock(windowName) {
    const file = lockFileFor(windowName);
    withFileLock(`${file}.guard`, () => {
      if (existsSync(file)) {
        ensureInsideWorkspace(file, "window delivery lock");
        unlinkSync(file);
      }
    });
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

  function dispatchPacketsForTask(targetWindow, taskId, dispatchGroup = "") {
    const packets = [];
    for (const file of listJsonFiles(dirs.packets)) {
      try {
        const packet = JSON.parse(readFileSync(file, "utf8"));
        if (packet.targetWindow === targetWindow
          && (packet.taskId === taskId || packet.targetTaskId === taskId || packet.stateRef?.targetTaskId === taskId)
          && (!dispatchGroup || packet.dispatchGroup === dispatchGroup)) {
          packets.push(packet);
        }
      } catch {
        // unreadable packets are skipped
      }
    }
    return packets;
  }

  function listDispatchGroupsForTask(targetWindow, taskId) {
    return [...new Set(dispatchPacketsForTask(targetWindow, taskId)
      .map((packet) => packet.dispatchGroup)
      .filter(Boolean))];
  }

  function windowConfigFileFor(windowName) {
    return path.join(dirs.windowConfig, `${stableArtifactPart(windowName, { fallback: "window" })}.json`);
  }

  function resultFileFor(targetWindow, taskId, dispatchGroup = "", stateRef = null) {
    const logicalId = [dispatchGroup, targetWindow, taskId].filter(Boolean).join("__");
    return artifactFileFor(dirs.results, logicalId, stateRef);
  }

  function findResultFile(targetWindow, taskId, dispatchGroup = "", stateRef = null) {
    const logicalId = [dispatchGroup, targetWindow, taskId].filter(Boolean).join("__");
    return findArtifactFile(dirs.results, logicalId, stateRef);
  }

  function supersededResultFileFor(
    targetWindow,
    taskId,
    dispatchGroup = "",
    supersededAt = nowIso(),
    resultRevision = null,
  ) {
    const parts = [dispatchGroup, targetWindow, taskId]
      .filter(Boolean)
      .map((value) => stableArtifactPart(value));
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
    findPacketFile,
    groupFileFor,
    findGroupFile,
    deliveryFileFor,
    findDeliveryFile,
    deliveryRunFileFor,
    findDeliveryRunFile,
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
    dispatchPacketsForTask,
    listDispatchGroupsForTask,
    windowConfigFileFor,
    resultFileFor,
    findResultFile,
    supersededResultFileFor,
    listJsonFiles,
  };
}
