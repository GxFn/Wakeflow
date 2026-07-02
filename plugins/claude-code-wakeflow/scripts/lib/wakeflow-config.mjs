import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const defaultWorkspaceConfig = {
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

// The local (never committed) config under .wakeflow-local/ — normally the
// derived stream overlay, or a hand-maintained user override.
export function localWorkspaceConfigPath(workspaceRoot = process.cwd()) {
  return preferExisting(
    path.join(workspaceRoot, ".wakeflow-local", WAKEFLOW_CONFIG_FILE),
    path.join(workspaceRoot, ".wakeflow-local", LEGACY_WORKSPACE_CONFIG_FILE),
  );
}

export function workspaceConfigPath({ workspaceRoot = process.cwd(), args = process.argv.slice(2) } = {}) {
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

export function readWorkspaceConfig({ workspaceRoot = process.cwd(), args = process.argv.slice(2), onError = null } = {}) {
  const configPath = workspaceConfigPath({ workspaceRoot, args });
  if (!existsSync(configPath)) {
    return {};
  }

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

export function loadWorkspaceConfig(options = {}) {
  const userConfig = readWorkspaceConfig(options);
  const merged = { ...defaultWorkspaceConfig, ...userConfig };
  const repositoryRoles = {
    ...defaultWorkspaceConfig.repositoryRoles,
    ...(userConfig.repositoryRoles ?? {}),
  };
  const repositories = Array.isArray(userConfig.repositories)
    ? userConfig.repositories
        .filter((repo) => repo && repo.windowName && repo.path)
        .map((repo) => ({
          ...repo,
          mode: repo.mode ?? (repo.path.startsWith("../") ? "external" : "internal"),
          role: repo.role ?? repositoryRoles[repo.windowName] ?? "Configured repository",
          managedAgents: repo.managedAgents !== false,
        }))
    : defaultWorkspaceConfig.repositories;
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

  return {
    ...merged,
    dispatchWindows,
    requiredDispatchWindows,
    repoNames,
    testWindow,
    realProjectWindow,
    repositoryRoles,
    repositories,
  };
}

// The window names that count as "Test" targets. Used to derive retest churn — how
// many rounds a task was dispatched to a Test window (test -> fix -> test again) —
// from dispatch history, so the count stays consistent with dispatchCount/reworkCount
// instead of depending on one-shot draft test-card files. Pass a merged config
// (loadWorkspaceConfig) so testWindow is always populated.
export function testWindowNames(config = {}) {
  return [config.testWindow, config.ideTestWindow].filter(Boolean);
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
