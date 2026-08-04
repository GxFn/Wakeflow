import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const WAKEFLOW_CONFIG_SCHEMA_VERSION = 2;
export const WAKEFLOW_CONFIG_SCHEMA_URL = "https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json";

export const defaultWorkspaceConfig = {
  $schema: WAKEFLOW_CONFIG_SCHEMA_URL,
  schemaVersion: WAKEFLOW_CONFIG_SCHEMA_VERSION,
  workspaceName: "Wakeflow",
  controllerWindow: "Wakeflow",
  interfaceLanguage: "auto",
  designWindow: "Design",
  testWindow: "Test",
  realProjectWindow: "",
  baseWindow: "",
  workspaceRoot: "..",
  wakeflowRepoDir: "Wakeflow",
  activeLedgerRoot: ".wakeflow-active",
  projectLedgerRoot: "../wakeflow-ledger",
  windowLedgerRoot: "../wakeflow-ledger",
  windowLedgerDirs: {},
  workspaceDocsDir: ".wakeflow-active",
  workspaceCurrentDir: ".wakeflow-active/current",
  workspaceArchiveDir: "../wakeflow-ledger/workspace/archive",
  workspaceIndexPath: ".wakeflow-active/index.md",
  workspaceCurrentIndexPath: ".wakeflow-active/current/index.md",
  workspaceCurrentStatusPath: ".wakeflow-active/current/workspace-current-status.md",
  workspaceRecordMapPath: "../wakeflow-ledger/workspace/workspace-record-map.md",
  globalTodoPath: ".wakeflow-active/current/global-todo-board.md",
  requirementDesignsDir: "../wakeflow-ledger/requirement-designs",
  goalStageConfirmationDir: "../wakeflow-ledger/goal-stage-confirmation",
  internalDesignPath: "../Design",
  internalTestPath: "../Test",
  allowMissingRepos: true,
  dispatchWindows: [],
  requiredDispatchWindows: ["Design", "Test"],
  repoNames: [],
  testExchangePath: ".wakeflow-active/current/test-exchange.md",
  runtimeProcessMatchers: [],
  runtimeProcessLabel: "configured",
  repositoryRoles: {
    Design: "Requirement design, outcome redesign, and handoff",
    Test: "Real environment validation",
  },
  repositories: [
    { windowName: "Design", path: "../Design", role: "Internal requirement and outcome design workspace", managedAgents: false, mode: "internal" },
    { windowName: "Test", path: "../Test", role: "Internal test coordination workspace", managedAgents: false, mode: "internal" },
  ],
  protectedWorkspacePrefixes: [],
  disallowedTrackedPaths: [".DS_Store"],
  allowedRepositoryResiduePaths: [],
};

export function getArgValue(args, name, fallback = null) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) {
    return eq.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) {
    return args[index + 1];
  }

  return fallback;
}

// Resolve the workspace root the way EVERY entrypoint must: honor an explicit `--root`
// (this is how the MCP surface passes the workspace — the MCP server's cwd is the plugin
// cache, not the workspace), falling back to the process cwd for direct CLI use. Scripts
// that hardcode `process.cwd()` silently break every MCP-driven call because they then
// look for the workspace under the plugin cache instead of the real root.
export function resolveWorkspaceRoot(args = process.argv.slice(2), fallback = process.cwd()) {
  return path.resolve(getArgValue(args, "--root", fallback));
}

// Canonical config file name. The legacy "workspace.config.json" name keeps
// resolving READ-side so pre-rename workspaces never break; writers write to
// whichever file resolves (fresh workspaces get the new name), and
// check-workspace suggests the one-line rename.
export const WAKEFLOW_CONFIG_FILE = "wakeflow.config.json";
export const LEGACY_WORKSPACE_CONFIG_FILE = "workspace.config.json";

function preferExisting(preferred, legacy) {
  if (existsSync(preferred)) return preferred;
  if (existsSync(legacy)) return legacy;
  return preferred;
}

// The tracked (committed) Wakeflow config for a workspace.
export function trackedWorkspaceConfigPath(workspaceRoot = process.cwd()) {
  return preferExisting(
    path.join(workspaceRoot, WAKEFLOW_CONFIG_FILE),
    path.join(workspaceRoot, LEGACY_WORKSPACE_CONFIG_FILE),
  );
}

// Durable configuration is the setup/configure authority. It is the tracked
// workspace file unless the caller deliberately supplies --config.
export function durableWorkspaceConfigPath({
  workspaceRoot = process.cwd(),
  args = process.argv.slice(2),
} = {}) {
  const configArg = getArgValue(args, "--config", process.env.WAKEFLOW_CONFIG ?? null);
  if (configArg) {
    return path.isAbsolute(configArg) ? configArg : path.join(workspaceRoot, configArg);
  }
  return trackedWorkspaceConfigPath(workspaceRoot);
}

// The local (never committed) config under .wakeflow-local/ — normally the
// derived stream overlay, or a hand-maintained user override.
export function localWorkspaceConfigPath(workspaceRoot = process.cwd()) {
  return preferExisting(
    path.join(workspaceRoot, ".wakeflow-local", WAKEFLOW_CONFIG_FILE),
    path.join(workspaceRoot, ".wakeflow-local", LEGACY_WORKSPACE_CONFIG_FILE),
  );
}

export const derivedStreamOverlayConfigPath = localWorkspaceConfigPath;

export function effectiveWorkspaceConfigPath({ workspaceRoot = process.cwd(), args = process.argv.slice(2) } = {}) {
  const configArg = getArgValue(args, "--config", process.env.WAKEFLOW_CONFIG ?? null);
  if (configArg) {
    return path.isAbsolute(configArg) ? configArg : path.join(workspaceRoot, configArg);
  }

  const localConfig = localWorkspaceConfigPath(workspaceRoot);
  if (existsSync(localConfig)) {
    return localConfig;
  }

  return trackedWorkspaceConfigPath(workspaceRoot);
}

export const workspaceConfigPath = effectiveWorkspaceConfigPath;

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function readConfigFile(configPath, { onError = null } = {}) {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (onError) {
      onError(configPath, error);
      return {};
    }
    throw error;
  }
}

export function readWorkspaceConfig({ workspaceRoot = process.cwd(), args = process.argv.slice(2), onError = null } = {}) {
  const configPath = effectiveWorkspaceConfigPath({ workspaceRoot, args });
  const explicitConfig = Boolean(getArgValue(args, "--config", process.env.WAKEFLOW_CONFIG ?? null));
  try {
    const value = readConfigFile(configPath);
    const localPath = localWorkspaceConfigPath(workspaceRoot);
    if (!explicitConfig && path.resolve(configPath) === path.resolve(localPath) && existsSync(configPath)) {
      if (value?.derived?.kind !== "WakeflowLocalConfigOverlay") {
        throw new Error(
          `local Wakeflow config ${configPath} is not a derived stream overlay; `
          + "move durable settings into wakeflow.config.json or pass an explicit --config path",
        );
      }
      const durablePath = trackedWorkspaceConfigPath(workspaceRoot);
      if (!existsSync(durablePath)) {
        throw new Error(`derived stream overlay ${configPath} has no durable base config ${durablePath}`);
      }
      const durableRaw = readFileSync(durablePath, "utf8");
      if (value.derived.baseHash !== sha256(durableRaw)) {
        throw new Error(
          `derived stream overlay ${configPath} is stale relative to ${durablePath}; `
          + "resume pod/stream setup to regenerate it before running Wakeflow",
        );
      }
    }
    return value;
  } catch (error) {
    if (onError) {
      onError(configPath, error);
      return {};
    }
    throw error;
  }
}

export function readDurableWorkspaceConfig({
  workspaceRoot = process.cwd(),
  args = process.argv.slice(2),
  onError = null,
} = {}) {
  return readConfigFile(durableWorkspaceConfigPath({ workspaceRoot, args }), { onError });
}

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`wakeflow config v2 requires ${label} to be an object`);
  }
  return value;
}

function assertAllowedKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`wakeflow config v2 ${label} contains unsupported field(s): ${unknown.join(", ")}`);
  }
}

// Durable v2 is intentionally compact and nested. Runtime scripts continue to
// consume one flat effective view so the on-disk migration does not fork every
// existing producer/consumer. This is the only v2 -> effective translation.
export function normalizeWorkspaceConfigInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("wakeflow config must be a JSON object");
  }
  if (input.schemaVersion !== WAKEFLOW_CONFIG_SCHEMA_VERSION) {
    return { ...input };
  }
  const workspace = objectValue(input.workspace, "workspace");
  const roles = objectValue(input.roles, "roles");
  const storage = objectValue(input.storage, "storage");
  const storagePaths = storage.paths === undefined ? {} : objectValue(storage.paths, "storage.paths");
  const policy = input.policy === undefined ? {} : objectValue(input.policy, "policy");
  const hosts = objectValue(input.hosts, "hosts");
  assertAllowedKeys(input, new Set([
    "$schema", "schemaVersion", "workspace", "roles", "storage", "policy", "repositories", "hosts", "derived",
  ]), "root");
  assertAllowedKeys(workspace, new Set(["name", "language", "runtimeMode", "root", "wakeflowRepoDir"]), "workspace");
  assertAllowedKeys(roles, new Set(["controller", "design", "test", "realProject", "base"]), "roles");
  assertAllowedKeys(storage, new Set(["activeRoot", "localRoot", "ledgerRoot", "windowLedgerRoot", "windowLedgerDirs", "paths"]), "storage");
  assertAllowedKeys(storagePaths, new Set([
    "workspaceDocsDir", "workspaceCurrentDir", "workspaceArchiveDir", "workspaceIndexPath",
    "workspaceCurrentIndexPath", "workspaceCurrentStatusPath", "workspaceRecordMapPath",
    "globalTodoPath", "requirementDesignsDir", "goalStageConfirmationDir", "testExchangePath",
  ]), "storage.paths");
  assertAllowedKeys(policy, new Set([
    "allowMissingRepos", "preservedRetentionDays", "disallowedTrackedPaths",
    "allowedRepositoryResiduePaths", "runtimeProcessMatchers", "runtimeProcessLabel",
  ]), "policy");
  if (!Array.isArray(input.repositories)) {
    throw new Error("wakeflow config v2 requires repositories to be an array");
  }
  for (const [label, value] of [
    ["workspace.name", workspace.name],
    ["workspace.root", workspace.root],
    ["roles.controller", roles.controller],
    ["roles.design", roles.design],
    ["roles.test", roles.test],
    ["storage.activeRoot", storage.activeRoot],
    ["storage.ledgerRoot", storage.ledgerRoot],
  ]) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`wakeflow config v2 requires non-empty ${label}`);
    }
  }
  if (!["auto", "zh", "en"].includes(workspace.language)) {
    throw new Error("wakeflow config v2 workspace.language must be auto, zh, or en");
  }
  if (!["plugin", "repository"].includes(workspace.runtimeMode)) {
    throw new Error("wakeflow config v2 workspace.runtimeMode must be plugin or repository");
  }
  if (typeof workspace.wakeflowRepoDir !== "string") {
    throw new Error("wakeflow config v2 requires workspace.wakeflowRepoDir to be a string");
  }
  if (storage.localRoot !== ".wakeflow-local") {
    throw new Error("wakeflow config v2 storage.localRoot must equal .wakeflow-local");
  }
  input.repositories.forEach((repo, index) => {
    if (!repo || typeof repo !== "object" || Array.isArray(repo)) {
      throw new Error(`wakeflow config v2 repositories[${index}] must be an object`);
    }
    if (typeof repo.windowName !== "string" || !repo.windowName.trim()
      || typeof repo.path !== "string" || !repo.path.trim()) {
      throw new Error(`wakeflow config v2 repositories[${index}] requires non-empty windowName and path`);
    }
  });
  const repositoryForRole = (windowName) => input.repositories.find((repo) => repo?.windowName === windowName);
  return Object.fromEntries(Object.entries({
    $schema: input.$schema,
    schemaVersion: input.schemaVersion,
    workspaceName: workspace.name,
    interfaceLanguage: workspace.language,
    runtimeMode: workspace.runtimeMode,
    workspaceRoot: workspace.root,
    wakeflowRepoDir: workspace.wakeflowRepoDir,
    controllerWindow: roles.controller,
    designWindow: roles.design,
    testWindow: roles.test,
    realProjectWindow: roles.realProject ?? "",
    baseWindow: roles.base ?? "",
    activeLedgerRoot: storage.activeRoot,
    projectLedgerRoot: storage.ledgerRoot,
    windowLedgerRoot: storage.windowLedgerRoot,
    windowLedgerDirs: storage.windowLedgerDirs,
    workspaceDocsDir: storagePaths.workspaceDocsDir,
    workspaceCurrentDir: storagePaths.workspaceCurrentDir,
    workspaceArchiveDir: storagePaths.workspaceArchiveDir,
    workspaceIndexPath: storagePaths.workspaceIndexPath,
    workspaceCurrentIndexPath: storagePaths.workspaceCurrentIndexPath,
    workspaceCurrentStatusPath: storagePaths.workspaceCurrentStatusPath,
    workspaceRecordMapPath: storagePaths.workspaceRecordMapPath,
    globalTodoPath: storagePaths.globalTodoPath,
    requirementDesignsDir: storagePaths.requirementDesignsDir,
    goalStageConfirmationDir: storagePaths.goalStageConfirmationDir,
    testExchangePath: storagePaths.testExchangePath,
    internalDesignPath: repositoryForRole(roles.design)?.path,
    internalTestPath: repositoryForRole(roles.test)?.path,
    allowMissingRepos: policy.allowMissingRepos,
    preservedRetentionDays: policy.preservedRetentionDays,
    disallowedTrackedPaths: policy.disallowedTrackedPaths,
    allowedRepositoryResiduePaths: policy.allowedRepositoryResiduePaths,
    runtimeProcessMatchers: policy.runtimeProcessMatchers,
    runtimeProcessLabel: policy.runtimeProcessLabel,
    repositories: input.repositories,
    hosts,
    ...(input.derived === undefined ? {} : { derived: input.derived }),
  }).filter(([, value]) => value !== undefined));
}

function ownValue(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key) && object[key] !== undefined;
}

function differingPathOverrides(config) {
  const activeRoot = config.activeLedgerRoot ?? defaultWorkspaceConfig.activeLedgerRoot;
  const ledgerRoot = config.projectLedgerRoot ?? defaultWorkspaceConfig.projectLedgerRoot;
  const docsDir = activeRoot;
  const currentDir = path.join(docsDir, "current");
  const derived = {
    workspaceDocsDir: docsDir,
    workspaceCurrentDir: currentDir,
    workspaceArchiveDir: path.join(ledgerRoot, "workspace/archive"),
    workspaceIndexPath: path.join(docsDir, "index.md"),
    workspaceCurrentIndexPath: path.join(currentDir, "index.md"),
    workspaceCurrentStatusPath: path.join(currentDir, "workspace-current-status.md"),
    workspaceRecordMapPath: path.join(ledgerRoot, "workspace/workspace-record-map.md"),
    globalTodoPath: path.join(currentDir, "global-todo-board.md"),
    requirementDesignsDir: path.join(ledgerRoot, "requirement-designs"),
    goalStageConfirmationDir: path.join(ledgerRoot, "goal-stage-confirmation"),
    testExchangePath: path.join(currentDir, "test-exchange.md"),
  };
  return Object.fromEntries(Object.entries(derived)
    .filter(([key, expected]) => ownValue(config, key) && config[key] !== expected)
    .map(([key]) => [key, config[key]]));
}

// Serialize only durable user intent. Derived window lists, role maps, and
// standard leaf paths never return to disk. Advanced path overrides are kept
// only when they differ from the deterministic roots.
export function workspaceConfigV2FromEffective(config = {}) {
  const pathOverrides = differingPathOverrides(config);
  const policy = Object.fromEntries([
    ["allowMissingRepos", config.allowMissingRepos],
    ["preservedRetentionDays", config.preservedRetentionDays],
    ["disallowedTrackedPaths", config.disallowedTrackedPaths],
    ["allowedRepositoryResiduePaths", config.allowedRepositoryResiduePaths],
    ["runtimeProcessMatchers", config.runtimeProcessMatchers],
    ["runtimeProcessLabel", config.runtimeProcessLabel],
  ].filter(([, value]) => value !== undefined));
  const storage = {
    activeRoot: config.activeLedgerRoot ?? defaultWorkspaceConfig.activeLedgerRoot,
    localRoot: ".wakeflow-local",
    ledgerRoot: config.projectLedgerRoot ?? defaultWorkspaceConfig.projectLedgerRoot,
    ...(config.windowLedgerRoot && config.windowLedgerRoot !== config.projectLedgerRoot
      ? { windowLedgerRoot: config.windowLedgerRoot }
      : {}),
    ...(config.windowLedgerDirs && Object.keys(config.windowLedgerDirs).length > 0
      ? { windowLedgerDirs: config.windowLedgerDirs }
      : {}),
    ...(Object.keys(pathOverrides).length > 0 ? { paths: pathOverrides } : {}),
  };
  return {
    $schema: WAKEFLOW_CONFIG_SCHEMA_URL,
    schemaVersion: WAKEFLOW_CONFIG_SCHEMA_VERSION,
    workspace: {
      name: config.workspaceName ?? defaultWorkspaceConfig.workspaceName,
      language: config.interfaceLanguage ?? defaultWorkspaceConfig.interfaceLanguage,
      runtimeMode: config.runtimeMode ?? "plugin",
      root: config.workspaceRoot ?? ".",
      wakeflowRepoDir: config.wakeflowRepoDir ?? "",
    },
    roles: {
      controller: config.controllerWindow ?? config.workspaceName ?? defaultWorkspaceConfig.controllerWindow,
      design: config.designWindow ?? defaultWorkspaceConfig.designWindow,
      test: config.testWindow ?? defaultWorkspaceConfig.testWindow,
      ...(config.realProjectWindow ? { realProject: config.realProjectWindow } : {}),
      ...(config.baseWindow ? { base: config.baseWindow } : {}),
    },
    storage,
    ...(Object.keys(policy).length > 0 ? { policy } : {}),
    repositories: Array.isArray(config.repositories) ? config.repositories : [],
    hosts: config.hosts && typeof config.hosts === "object" ? config.hosts : {},
  };
}

function mergeWorkspaceConfig(userConfig) {
  const configMigrationWarnings = [];
  const suppliedConfig = userConfig ?? {};
  const declaredSchemaVersion = suppliedConfig.schemaVersion;
  if (declaredSchemaVersion !== undefined
    && declaredSchemaVersion !== 1
    && declaredSchemaVersion !== WAKEFLOW_CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `wakeflow config schemaVersion ${declaredSchemaVersion} is not supported; expected 1 or ${WAKEFLOW_CONFIG_SCHEMA_VERSION}`,
    );
  }
  if (Object.keys(suppliedConfig).length > 0 && declaredSchemaVersion !== WAKEFLOW_CONFIG_SCHEMA_VERSION) {
    configMigrationWarnings.push("legacy flat Wakeflow config is supported read-only; run workspace setup/configure to write canonical schemaVersion 2");
  }
  if (suppliedConfig.derived?.kind === "WakeflowLocalConfigOverlay") {
    configMigrationWarnings.push(
      "legacy .wakeflow-local config overlay is compatibility-only; current Pod placement is host-owned and new durable configuration must remain in wakeflow.config.json",
    );
  }
  const normalizedInput = normalizeWorkspaceConfigInput(suppliedConfig);
  const {
    maxActiveDemands: legacyMaxActiveDemands,
    configMigrationWarnings: _legacyWarnings,
    ...withoutTopLevelCapacity
  } = normalizedInput;
  if (legacyMaxActiveDemands !== undefined) {
    configMigrationWarnings.push(
      "maxActiveDemands is deprecated and has no admission effect; ordinary work uses the mainline lane and explicitly authorized pods use isolated placement.",
    );
  }
  const hosts = withoutTopLevelCapacity.hosts && typeof withoutTopLevelCapacity.hosts === "object"
    ? Object.fromEntries(Object.entries(withoutTopLevelCapacity.hosts).map(([hostName, hostConfig]) => {
        if (!hostConfig || typeof hostConfig !== "object" || Array.isArray(hostConfig)) {
          return [hostName, hostConfig];
        }
        const { maxStreamsPerRepo, ...rest } = hostConfig;
        if (maxStreamsPerRepo !== undefined) {
          configMigrationWarnings.push(
            `hosts.${hostName}.maxStreamsPerRepo is deprecated and has no admission effect.`,
          );
        }
        return [hostName, rest];
      }))
    : withoutTopLevelCapacity.hosts;
  const configuredRepositories = Array.isArray(withoutTopLevelCapacity.repositories)
    ? withoutTopLevelCapacity.repositories.map((repo) => {
        if (!repo || typeof repo !== "object" || Array.isArray(repo)) return repo;
        const { maxStreams, maxStreamsPerRepo, ...rest } = repo;
        if (maxStreams !== undefined || maxStreamsPerRepo !== undefined) {
          configMigrationWarnings.push(
            `repositories.${repo.windowName ?? repo.path ?? "unknown"}.maxStreams is deprecated and has no admission effect.`,
          );
        }
        return rest;
      })
    : withoutTopLevelCapacity.repositories;
  userConfig = {
    ...withoutTopLevelCapacity,
    ...(hosts === undefined ? {} : { hosts }),
    ...(configuredRepositories === undefined ? {} : { repositories: configuredRepositories }),
  };
  const merged = { ...defaultWorkspaceConfig, ...userConfig };
  const configuredRoles = {
    ...defaultWorkspaceConfig.repositoryRoles,
    ...(userConfig.repositoryRoles ?? {}),
  };
  const repositories = Array.isArray(userConfig.repositories)
    ? userConfig.repositories
        .filter((repo) => repo && repo.windowName && repo.path)
        .map((repo) => ({
          ...repo,
          mode: repo.mode ?? (repo.path.startsWith("../") ? "external" : "internal"),
          role: repo.role ?? configuredRoles[repo.windowName] ?? "Configured repository",
          managedAgents: repo.managedAgents !== false,
        }))
    : defaultWorkspaceConfig.repositories;
  const derivedProtectedWorkspacePrefixes = repositories
    .filter((repo) => repo.mode !== "internal")
    .map((repo) => repo.path)
    .filter((repoPath) => !repoPath.startsWith("../") && repoPath !== ".")
    .map((repoPath) => `${repoPath.replace(/\/+$/, "")}/`);
  // repositoryRoles is a derived VIEW of repositories[].role (slim configs no
  // longer persist it); an explicit legacy map still wins per window.
  const repositoryRoles = {
    ...defaultWorkspaceConfig.repositoryRoles,
    ...Object.fromEntries(repositories.map((repo) => [repo.windowName, repo.role])),
    ...(userConfig.repositoryRoles ?? {}),
  };
  const repositoryWindowNames = repositories.map((repo) => repo.windowName);
  const hasConfiguredRepositories = Array.isArray(userConfig.repositories) && repositoryWindowNames.length > 0;
  const dispatchWindows = Array.isArray(userConfig.dispatchWindows)
    ? userConfig.dispatchWindows
    : Array.isArray(userConfig.windows)
      ? userConfig.windows
      : hasConfiguredRepositories
        ? repositoryWindowNames.filter((name) => name !== merged.designWindow && name !== merged.realProjectWindow)
        : defaultWorkspaceConfig.dispatchWindows;
  const testWindow = userConfig.testWindow ?? merged.testWindow;
  const realProjectWindow = userConfig.realProjectWindow ?? merged.realProjectWindow;
  const requiredDispatchWindows = Array.isArray(userConfig.requiredDispatchWindows)
    ? userConfig.requiredDispatchWindows
    : hasConfiguredRepositories
      ? repositoryWindowNames
      : [...dispatchWindows, realProjectWindow].filter(Boolean);
  const repoNames = Array.isArray(userConfig.repoNames)
    ? userConfig.repoNames
    : hasConfiguredRepositories
      ? repositoryWindowNames.filter((name) => ![merged.designWindow, testWindow, realProjectWindow].includes(name))
      : dispatchWindows.filter((name) => name !== testWindow);
  // Path topology is derived from the two actual roots unless the user
  // explicitly overrides one leaf. This keeps slim configs coherent when the
  // ledger root changes and prevents stale default paths from pointing at a
  // second, unintended ledger.
  const activeLedgerRoot = userConfig.activeLedgerRoot ?? defaultWorkspaceConfig.activeLedgerRoot;
  const projectLedgerRoot = userConfig.projectLedgerRoot ?? defaultWorkspaceConfig.projectLedgerRoot;
  const workspaceDocsDir = userConfig.workspaceDocsDir ?? activeLedgerRoot;
  const workspaceCurrentDir = userConfig.workspaceCurrentDir ?? path.join(workspaceDocsDir, "current");

  return {
    ...merged,
    activeLedgerRoot,
    projectLedgerRoot,
    windowLedgerRoot: userConfig.windowLedgerRoot ?? projectLedgerRoot,
    workspaceDocsDir,
    workspaceCurrentDir,
    workspaceArchiveDir: userConfig.workspaceArchiveDir ?? path.join(projectLedgerRoot, "workspace/archive"),
    workspaceIndexPath: userConfig.workspaceIndexPath ?? path.join(workspaceDocsDir, "index.md"),
    workspaceCurrentIndexPath: userConfig.workspaceCurrentIndexPath ?? path.join(workspaceCurrentDir, "index.md"),
    workspaceCurrentStatusPath: userConfig.workspaceCurrentStatusPath ?? path.join(workspaceCurrentDir, "workspace-current-status.md"),
    workspaceRecordMapPath: userConfig.workspaceRecordMapPath ?? path.join(projectLedgerRoot, "workspace/workspace-record-map.md"),
    globalTodoPath: userConfig.globalTodoPath ?? path.join(workspaceCurrentDir, "global-todo-board.md"),
    requirementDesignsDir: userConfig.requirementDesignsDir ?? path.join(projectLedgerRoot, "requirement-designs"),
    goalStageConfirmationDir: userConfig.goalStageConfirmationDir ?? path.join(projectLedgerRoot, "goal-stage-confirmation"),
    testExchangePath: userConfig.testExchangePath ?? path.join(workspaceCurrentDir, "test-exchange.md"),
    dispatchWindows,
    requiredDispatchWindows,
    repoNames,
    testWindow,
    realProjectWindow,
    repositoryRoles,
    repositories,
    protectedWorkspacePrefixes: Array.isArray(userConfig.protectedWorkspacePrefixes)
      ? userConfig.protectedWorkspacePrefixes
      : derivedProtectedWorkspacePrefixes,
    configSourceSchemaVersion: declaredSchemaVersion ?? (Object.keys(suppliedConfig).length > 0 ? 1 : WAKEFLOW_CONFIG_SCHEMA_VERSION),
    configSourceShape: Object.keys(suppliedConfig).length === 0
      ? "implicit-defaults"
      : declaredSchemaVersion === WAKEFLOW_CONFIG_SCHEMA_VERSION
        ? "nested-v2"
        : "legacy-flat",
    configMigrationWarnings,
  };
}

export function loadWorkspaceConfig(options = {}) {
  return mergeWorkspaceConfig(readWorkspaceConfig(options));
}

export function loadDurableWorkspaceConfig(options = {}) {
  return mergeWorkspaceConfig(readDurableWorkspaceConfig(options));
}

// One stable comparison surface for tools that must explain what the user
// actually stored versus what Wakeflow deterministically derived. Keep this
// projection here so status, storage, and future diagnostics cannot invent
// different meanings for "effective layout".
export function workspaceConfigDiagnostics({
  workspaceRoot = process.cwd(),
  args = process.argv.slice(2),
  durableInput = null,
  effectiveConfig = null,
} = {}) {
  const durable = durableInput ?? readDurableWorkspaceConfig({ workspaceRoot, args });
  const effective = effectiveConfig ?? loadWorkspaceConfig({ workspaceRoot, args });
  return {
    sourceSchemaVersion: effective.configSourceSchemaVersion,
    sourceShape: effective.configSourceShape,
    durableInput: durable,
    effectiveLayout: {
      workspace: {
        name: effective.workspaceName,
        language: effective.interfaceLanguage,
        runtimeMode: effective.runtimeMode,
        root: effective.workspaceRoot,
        wakeflowRepoDir: effective.wakeflowRepoDir,
      },
      roles: {
        controller: effective.controllerWindow,
        design: effective.designWindow,
        test: effective.testWindow,
        realProject: effective.realProjectWindow,
        base: effective.baseWindow,
      },
      storage: {
        activeRoot: effective.activeLedgerRoot,
        ledgerRoot: effective.projectLedgerRoot,
        windowLedgerRoot: effective.windowLedgerRoot,
        workspaceDocsDir: effective.workspaceDocsDir,
        workspaceCurrentDir: effective.workspaceCurrentDir,
        workspaceArchiveDir: effective.workspaceArchiveDir,
        workspaceIndexPath: effective.workspaceIndexPath,
        workspaceCurrentIndexPath: effective.workspaceCurrentIndexPath,
        workspaceCurrentStatusPath: effective.workspaceCurrentStatusPath,
        workspaceRecordMapPath: effective.workspaceRecordMapPath,
        globalTodoPath: effective.globalTodoPath,
        requirementDesignsDir: effective.requirementDesignsDir,
        goalStageConfirmationDir: effective.goalStageConfirmationDir,
        testExchangePath: effective.testExchangePath,
      },
      windows: {
        dispatch: effective.dispatchWindows,
        required: effective.requiredDispatchWindows,
        repositories: effective.repoNames,
        roles: effective.repositoryRoles,
        protectedWorkspacePrefixes: effective.protectedWorkspacePrefixes,
      },
    },
    migrationWarnings: effective.configMigrationWarnings ?? [],
  };
}

// The window names that count as "Test" targets. Used to derive retest churn — how
// many rounds a task was dispatched to a Test window (test -> fix -> test again) —
// from dispatch history, so the count stays consistent with dispatchCount/reworkCount
// instead of depending on one-shot draft test-card files. Pass a merged config
// (loadWorkspaceConfig) so testWindow is always populated.
export function testWindowNames(config = {}) {
  return [config.testWindow].filter(Boolean);
}

export function resolveConfigPath(workspaceRoot, value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
}

export function ledgerSegment(value) {
  return String(value ?? "window")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "window";
}

export function windowLedgerDirFor({ workspaceRoot = process.cwd(), config = null, windowName }) {
  const loaded = config ?? loadWorkspaceConfig({ workspaceRoot });
  const configured = loaded.windowLedgerDirs?.[windowName];
  if (configured) {
    return resolveConfigPath(workspaceRoot, configured);
  }
  const root = loaded.windowLedgerRoot ?? loaded.projectLedgerRoot ?? "../wakeflow-ledger";
  return resolveConfigPath(workspaceRoot, path.join(root, ledgerSegment(windowName)));
}

export function windowLedgerDirsFor({ workspaceRoot = process.cwd(), args = process.argv.slice(2), config = null } = {}) {
  const loaded = config ?? loadWorkspaceConfig({ workspaceRoot, args });
  const entries = {};
  for (const repo of loaded.repositories ?? []) {
    if (!repo?.windowName) {
      continue;
    }
    entries[repo.windowName] = windowLedgerDirFor({ workspaceRoot, config: loaded, windowName: repo.windowName });
  }
  return entries;
}

export function workspaceLedgerPaths({ workspaceRoot = process.cwd(), args = process.argv.slice(2), config = null } = {}) {
  const loaded = config ?? loadWorkspaceConfig({ workspaceRoot, args });
  const activeLedgerRoot = loaded.activeLedgerRoot ?? ".wakeflow-active";
  const workspaceDocsDir = loaded.workspaceDocsDir ?? activeLedgerRoot;
  const workspaceCurrentDir = loaded.workspaceCurrentDir ?? path.join(workspaceDocsDir, "current");
  const workspaceArchiveDir = loaded.workspaceArchiveDir ?? "../wakeflow-ledger/workspace/archive";
  const workspaceIndexPath = loaded.workspaceIndexPath ?? path.join(workspaceDocsDir, "index.md");
  const workspaceCurrentIndexPath = loaded.workspaceCurrentIndexPath ?? path.join(workspaceCurrentDir, "index.md");
  const workspaceCurrentStatusPath = loaded.workspaceCurrentStatusPath
    ?? path.join(workspaceCurrentDir, "workspace-current-status.md");
  const workspaceRecordMapPath = loaded.workspaceRecordMapPath
    ?? path.join(workspaceDocsDir, "workspace-record-map.md");
  const globalTodoPath = loaded.globalTodoPath ?? path.join(workspaceCurrentDir, "global-todo-board.md");

  return {
    activeLedgerRoot: resolveConfigPath(workspaceRoot, activeLedgerRoot),
    projectLedgerRoot: resolveConfigPath(workspaceRoot, loaded.projectLedgerRoot ?? "../wakeflow-ledger"),
    windowLedgerRoot: resolveConfigPath(workspaceRoot, loaded.windowLedgerRoot ?? loaded.projectLedgerRoot ?? "../wakeflow-ledger"),
    windowLedgerDirs: windowLedgerDirsFor({ workspaceRoot, args, config: loaded }),
    workspaceDocsDir: resolveConfigPath(workspaceRoot, workspaceDocsDir),
    workspaceCurrentDir: resolveConfigPath(workspaceRoot, workspaceCurrentDir),
    workspaceArchiveDir: resolveConfigPath(workspaceRoot, workspaceArchiveDir),
    workspaceIndexPath: resolveConfigPath(workspaceRoot, workspaceIndexPath),
    workspaceCurrentIndexPath: resolveConfigPath(workspaceRoot, workspaceCurrentIndexPath),
    workspaceCurrentStatusPath: resolveConfigPath(workspaceRoot, workspaceCurrentStatusPath),
    workspaceRecordMapPath: resolveConfigPath(workspaceRoot, workspaceRecordMapPath),
    globalTodoPath: resolveConfigPath(workspaceRoot, globalTodoPath),
    requirementDesignsDir: resolveConfigPath(workspaceRoot, loaded.requirementDesignsDir ?? "../wakeflow-ledger/requirement-designs"),
  };
}
