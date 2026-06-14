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
  activeLedgerRoot: ".workspace-active",
  projectLedgerRoot: "../wakeflow-ledger",
  windowLedgerRoot: "../wakeflow-ledger",
  windowLedgerDirs: {},
  workspaceDocsDir: ".workspace-active/workspace",
  workspaceCurrentDir: ".workspace-active/workspace/current",
  workspaceArchiveDir: "../wakeflow-ledger/workspace/archive",
  workspaceIndexPath: ".workspace-active/workspace/index.md",
  workspaceCurrentIndexPath: ".workspace-active/workspace/current/index.md",
  workspaceCurrentStatusPath: ".workspace-active/workspace/current/workspace-current-status.md",
  workspaceRecordMapPath: "../wakeflow-ledger/workspace/workspace-record-map.md",
  globalTodoPath: ".workspace-active/workspace/current/global-todo-board.md",
  requirementDesignsDir: "../wakeflow-ledger/requirement-designs",
  goalStageConfirmationDir: "../wakeflow-ledger/goal-stage-confirmation",
  internalDesignPath: "../Design",
  internalTestPath: "../Test",
  allowMissingRepos: true,
  dispatchWindows: [],
  requiredDispatchWindows: ["Design", "Test"],
  repoNames: [],
  testExchangePath: ".workspace-active/workspace/current/test-exchange.md",
  designHandoffBoard: ".workspace-active/workspace/current/design-handoff-board.md",
  designHandoffInbox: ".workspace-active/workspace/current/design-handoff-inbox.md",
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

export function workspaceConfigPath({ workspaceRoot = process.cwd(), args = process.argv.slice(2) } = {}) {
  const configArg = getArgValue(args, "--config", process.env.WAKEFLOW_CONFIG ?? null);
  if (configArg) {
    return path.isAbsolute(configArg) ? configArg : path.join(workspaceRoot, configArg);
  }

  const localConfig = path.join(workspaceRoot, ".workspace-local/workspace.config.json");
  if (existsSync(localConfig)) {
    return localConfig;
  }

  return path.join(workspaceRoot, "workspace.config.json");
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
  const activeLedgerRoot = loaded.activeLedgerRoot ?? ".workspace-active";
  const workspaceDocsDir = loaded.workspaceDocsDir ?? path.join(activeLedgerRoot, "workspace");
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
