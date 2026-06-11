import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hostProfile } from "./wakeflow-host-profile.mjs";

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
    windowConfigFileFor,
    resultFileFor,
    supersededResultFileFor,
    listJsonFiles,
  };
}
