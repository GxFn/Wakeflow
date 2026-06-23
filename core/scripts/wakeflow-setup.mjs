#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultWorkspaceConfig,
  loadWorkspaceConfig,
  readWorkspaceConfig,
  resolveConfigPath,
  windowLedgerDirFor,
  workspaceLedgerPaths,
  workspaceConfigPath,
} from "./lib/wakeflow-config.mjs";
import {
  detectInterfaceLanguage,
  normalizeInterfaceLanguage,
} from "./lib/wakeflow-language.mjs";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWakeflowRoot = path.dirname(path.dirname(scriptPath));
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] ?? "help";
const args = rawArgs.slice(1);
const json = args.includes("--json");
const write = args.includes("--write");
const templateBundleFile = "templates/wakeflow-template-bundle.json";
const templateBundleCache = new Map();

class CliExit extends Error {}

function fail(message) {
  if (json) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
  throw new CliExit(message);
}

function hasFlag(name) {
  return args.includes(name);
}

function getValue(name, fallback = null) {
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

function getAllValues(name) {
  const out = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(`${name}=`)) {
      out.push(arg.slice(name.length + 1));
    } else if (arg === name && args[index + 1] && !args[index + 1].startsWith("--")) {
      out.push(args[index + 1]);
      index += 1;
    }
  }
  return out;
}

function slash(value) {
  return value.split(path.sep).join("/");
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, prettyJson(value));
}

function resolveMaybeRelative(root, value) {
  if (!value) {
    return root;
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function relativeFromWakeflow(wakeflowRoot, absolutePath) {
  const relative = slash(path.relative(wakeflowRoot, absolutePath));
  return relative === "" ? "." : relative;
}

function relativeCommandPath(fromDir, absoluteScriptPath) {
  const relative = slash(path.relative(fromDir, absoluteScriptPath));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function relativePathFrom(fromDir, absolutePath) {
  const relative = slash(path.relative(fromDir, absolutePath));
  return relative === "" ? "." : relative;
}

function looksLikeWakeflowRuntimeRoot(root) {
  return existsSync(path.join(root, hostProfile.pluginManifestPath))
    && existsSync(path.join(root, "mcp/server.cjs"))
    && existsSync(path.join(root, "skills"));
}

function own(config, key) {
  return Object.prototype.hasOwnProperty.call(config, key);
}

function migratedInternalPath(value, kind, pluginTargetMode) {
  const next = kind === "design"
    ? (pluginTargetMode ? "Design" : "../Design")
    : (pluginTargetMode ? "Test" : "../Test");
  const oldValues = kind === "design"
    ? new Set(["wakeflow-ledger/design", "../wakeflow-ledger/design"])
    : new Set(["wakeflow-ledger/testing", "../wakeflow-ledger/testing"]);
  if (!value || oldValues.has(value)) {
    return next;
  }
  return value;
}

function applyPluginTargetDefaults(config, userConfig, workspaceRoot) {
  const workspaceName = own(userConfig, "workspaceName") ? userConfig.workspaceName : path.basename(workspaceRoot);
  const controllerWindow = own(userConfig, "controllerWindow") ? userConfig.controllerWindow : workspaceName;
  const designWindow = own(userConfig, "designWindow") ? userConfig.designWindow : config.designWindow;
  const testWindow = own(userConfig, "testWindow") ? userConfig.testWindow : config.testWindow;
  const internalDesignPath = migratedInternalPath(
    own(userConfig, "internalDesignPath") ? userConfig.internalDesignPath : "Design",
    "design",
    true,
  );
  const internalTestPath = migratedInternalPath(
    own(userConfig, "internalTestPath") ? userConfig.internalTestPath : "Test",
    "test",
    true,
  );
  return {
    ...config,
    workspaceName,
    controllerWindow,
    workspaceRoot: own(userConfig, "workspaceRoot") ? userConfig.workspaceRoot : ".",
    wakeflowRepoDir: own(userConfig, "wakeflowRepoDir") ? userConfig.wakeflowRepoDir : "",
    projectLedgerRoot: own(userConfig, "projectLedgerRoot") ? userConfig.projectLedgerRoot : "wakeflow-ledger",
    windowLedgerRoot: own(userConfig, "windowLedgerRoot") ? userConfig.windowLedgerRoot : "wakeflow-ledger",
    workspaceArchiveDir: own(userConfig, "workspaceArchiveDir") ? userConfig.workspaceArchiveDir : "wakeflow-ledger/workspace/archive",
    workspaceRecordMapPath: own(userConfig, "workspaceRecordMapPath") ? userConfig.workspaceRecordMapPath : "wakeflow-ledger/workspace/workspace-record-map.md",
    requirementDesignsDir: own(userConfig, "requirementDesignsDir") ? userConfig.requirementDesignsDir : "wakeflow-ledger/requirement-designs",
    goalStageConfirmationDir: own(userConfig, "goalStageConfirmationDir") ? userConfig.goalStageConfirmationDir : "wakeflow-ledger/goal-stage-confirmation",
    internalDesignPath,
    internalTestPath,
    repositories: own(userConfig, "repositories")
      ? config.repositories
      : [
          {
            windowName: designWindow,
            path: internalDesignPath,
            role: "Internal requirement design workspace",
            managedAgents: false,
            mode: "internal",
          },
          {
            windowName: testWindow,
            path: internalTestPath,
            role: "Internal test coordination workspace",
            managedAgents: false,
            mode: "internal",
          },
        ],
  };
}

function toWindowName(directoryName) {
  return directoryName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function slug(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function commandContext() {
  const rootArg = getValue("--root", null);
  const wakeflowRoot = rootArg
    ? (path.isAbsolute(rootArg) ? path.resolve(rootArg) : path.resolve(process.cwd(), rootArg))
    : defaultWakeflowRoot;
  const configPath = workspaceConfigPath({ workspaceRoot: wakeflowRoot, args });
  const userConfig = readWorkspaceConfig({ workspaceRoot: wakeflowRoot, args });
  const configuredRootExists = existsSync(configPath);
  const runtimeRoot = looksLikeWakeflowRuntimeRoot(wakeflowRoot);
  const configuredPluginTarget = configuredRootExists
    && !runtimeRoot
    && (userConfig.runtimeMode === "plugin" || userConfig.wakeflowRepoDir === "");
  const pluginTargetMode = (!configuredRootExists && !runtimeRoot) || configuredPluginTarget;
  const loadedConfig = loadWorkspaceConfig({ workspaceRoot: wakeflowRoot, args });
  const config = pluginTargetMode
    ? applyPluginTargetDefaults(loadedConfig, userConfig, wakeflowRoot)
    : loadedConfig;
  const parentRoot = resolveMaybeRelative(wakeflowRoot, getValue("--parent", config.workspaceRoot ?? ".."));
  const ledgerPaths = workspaceLedgerPaths({ workspaceRoot: wakeflowRoot, args, config });
  return {
    wakeflowRoot,
    templateRoot: defaultWakeflowRoot,
    pluginTargetMode,
    config,
    userConfig,
    configPath,
    parentRoot,
    ledgerPaths,
  };
}

function contextWithConfig(context, config) {
  return {
    ...context,
    config,
    userConfig: config,
    parentRoot: resolveMaybeRelative(context.wakeflowRoot, config.workspaceRoot ?? context.config.workspaceRoot ?? ".."),
    ledgerPaths: workspaceLedgerPaths({ workspaceRoot: context.wakeflowRoot, args, config }),
  };
}

function normalizedRepositories(config) {
  return (config.repositories ?? [])
    .filter((repo) => repo && repo.windowName && repo.path)
    .map((repo) => ({
      windowName: repo.windowName,
      path: slash(repo.path),
      mode: repo.mode ?? (repo.path.startsWith("../") ? "external" : "internal"),
      role: repo.role ?? config.repositoryRoles?.[repo.windowName] ?? "Configured repository",
      managedAgents: repo.managedAgents !== false,
    }));
}

function repositoryAbsPath(wakeflowRoot, repo) {
  return path.resolve(wakeflowRoot, repo.path);
}

function discoverSiblingRepositories({ wakeflowRoot, parentRoot, config }) {
  if (!existsSync(parentRoot)) {
    fail(`Parent workspace directory does not exist: ${parentRoot}`);
  }
  const wakeflowBasename = path.basename(wakeflowRoot);
  const configured = new Map(
    normalizedRepositories(config).map((repo) => [path.resolve(wakeflowRoot, repo.path), repo]),
  );
  const internalBasenames = normalizedRepositories(config)
    .filter((repo) => repo.mode === "internal")
    .map((repo) => path.basename(resolveMaybeRelative(wakeflowRoot, repo.path)));
  const ignore = new Set([
    wakeflowBasename,
    path.basename(resolveMaybeRelative(wakeflowRoot, config.projectLedgerRoot ?? "../wakeflow-ledger")),
    ...internalBasenames,
    ".git",
    ".wakeflow-local",
    ".wakeflow-active",
    "node_modules",
    ".DS_Store",
  ]);

  return readdirSync(parentRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !ignore.has(entry.name))
    .map((entry) => {
      const absolutePath = path.join(parentRoot, entry.name);
      const configuredRepo = configured.get(absolutePath);
      const suggestedWindowName = configuredRepo?.windowName ?? toWindowName(entry.name);
      const role = configuredRepo?.role
        ?? config.repositoryRoles?.[suggestedWindowName]
        ?? "Project repository; confirm scope and responsibility before enabling.";
      return {
        name: entry.name,
        path: relativeFromWakeflow(wakeflowRoot, absolutePath),
        absolutePath,
        suggestedWindowName,
        role,
        configured: Boolean(configuredRepo),
        isGitRepo: existsSync(path.join(absolutePath, ".git")),
        hasAgents: existsSync(path.join(absolutePath, hostProfile.memoryFile)),
        hasPackageJson: existsSync(path.join(absolutePath, "package.json")),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function redactAbsolutePaths(items) {
  return items.map(({ absolutePath, ...item }) => item);
}

function agentSelectionProtocol() {
  return {
    decisionOwner: hostProfile.decisionOwner,
    pluginDoesNotClassifyCleanOrMessy: true,
    safeDefault: "Discovery is read-only. Without explicit repository mappings, initialization returns discovery and writes nothing.",
    cleanWorkspaceAction: "If the agent judges every discovered directory that matters is an intended Wakeflow work window, rerun initialize with explicit repositories and the desired Design/Test mode; apply/write only after the user has allowed writing.",
    messyWorkspaceAction: "If the agent sees runtime/history/ledger/scratch/tooling directories, mixed product families, or uncertain ownership, ask the user which windows to manage before writing.",
    avoid: "Do not use --use-discovered in a messy workspace. Prefer explicit --repo Window=Path mappings from the agent/user-confirmed selection.",
  };
}

function statusPayload() {
  const context = commandContext();
  const configuredRepositories = normalizedRepositories(context.config).map((repo) => {
    const absolutePath = repositoryAbsPath(context.wakeflowRoot, repo);
    const ledgerPath = windowLedgerDirFor({
      workspaceRoot: context.wakeflowRoot,
      config: context.config,
      windowName: repo.windowName,
    });
    return {
      ...repo,
      absolutePath,
      ledgerPath: relativeFromWakeflow(context.wakeflowRoot, ledgerPath),
      exists: existsSync(absolutePath) && statSync(absolutePath).isDirectory(),
      hasAgents: existsSync(path.join(absolutePath, hostProfile.memoryFile)),
      withinParent: isInside(absolutePath, context.parentRoot),
      mode: repo.mode,
    };
  });
  const discovered = redactAbsolutePaths(discoverSiblingRepositories(context));
  const missing = configuredRepositories.filter((repo) => !repo.exists);
  const outsideParent = configuredRepositories.filter((repo) => !repo.withinParent);
  const defaultDesignWindow = defaultWorkspaceConfig.designWindow;
  const defaultTestWindow = defaultWorkspaceConfig.testWindow;
  return {
    ok: missing.length === 0 || context.config.allowMissingRepos === true,
    wakeflowRoot: context.wakeflowRoot,
    parentRoot: context.parentRoot,
    configPath: context.configPath,
    workspaceName: context.config.workspaceName,
    wakeflowRepoDir: context.config.wakeflowRepoDir,
    configuredRepositories: configuredRepositories.map(({ absolutePath, ...repo }) => repo),
    discoveredRepositories: discovered,
    agentSelectionProtocol: agentSelectionProtocol(),
    missingConfiguredRepositories: missing.map((repo) => repo.windowName),
    outsideParentRepositories: outsideParent.map((repo) => repo.windowName),
    setupQuestions: [
      {
        windowName: defaultDesignWindow,
        question: "Do you already have a requirement-design directory or repository? If yes, configure it as external; if no, use the internal workspace design board.",
        internalCommand: "node scripts/wakeflow-setup.mjs configure --internal-design --write",
        externalCommand: `node scripts/wakeflow-setup.mjs configure --design-window ${defaultDesignWindow} --repo ${defaultDesignWindow}=../YourDesignRepo --write`,
      },
      {
        windowName: defaultTestWindow,
        question: "Do you already have a real-test directory or repository? If yes, configure it as external; if no, use the internal workspace test exchange.",
        internalCommand: "node scripts/wakeflow-setup.mjs configure --internal-test --write",
        externalCommand: `node scripts/wakeflow-setup.mjs configure --test-window ${defaultTestWindow} --repo ${defaultTestWindow}=../YourTestRepo --write`,
      },
    ],
  };
}

function printResult(payload) {
  if (json) {
    console.log(prettyJson(payload));
    return;
  }
  if (payload.command === "discover" || payload.discoveredRepositories) {
    console.log(`${payload.workspaceName} install discovery`);
    console.log(`Wakeflow root: ${payload.wakeflowRoot}`);
    console.log(`Parent workspace: ${payload.parentRoot}`);
    for (const repo of payload.discoveredRepositories) {
      console.log(`- ${repo.suggestedWindowName}: ${repo.path}${repo.configured ? " (configured)" : ""}`);
    }
    return;
  }
  console.log(prettyJson(payload));
}

function parseKeyValueSpec(spec, kind) {
  const index = spec.indexOf("=");
  if (index <= 0 || index === spec.length - 1) {
    fail(`${kind} must use WindowName=value syntax: ${spec}`);
  }
  return [spec.slice(0, index), spec.slice(index + 1)];
}

function excludedWindows() {
  return new Set(
    getAllValues("--exclude-window")
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function replacementWindows() {
  if (!["replace-window", "replace-windows"].includes(command)) {
    return new Set();
  }
  return new Set(
    getAllValues("--window")
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function requestedInterfaceLanguage(context) {
  const requested = normalizeInterfaceLanguage(getValue("--language", context.config.interfaceLanguage ?? "auto"));
  if (requested) return requested;
  fail("--language must be auto, zh, or en.");
}

function interfaceLanguage(context) {
  const requested = requestedInterfaceLanguage(context);
  return detectInterfaceLanguage({ requested });
}

function parseRepoSpecs(context) {
  const roleOverrides = new Map(getAllValues("--role").map((spec) => parseKeyValueSpec(spec, "--role")));
  const repoSpecs = getAllValues("--repo");
  const excluded = excludedWindows();
  const internalOnly = hasFlag("--internal-design") || hasFlag("--internal-test");
  if (repoSpecs.length === 0 && !hasFlag("--use-discovered") && !internalOnly) {
    fail("configure requires at least one agent/user-confirmed --repo WindowName=../RepositoryPath. Use --use-discovered only after confirming every discovered directory is a work window.");
  }

  if (repoSpecs.length > 0) {
    return repoSpecs.map((spec) => {
      const [windowName, repoPath] = parseKeyValueSpec(spec, "--repo");
      const absolutePath = resolveMaybeRelative(context.wakeflowRoot, repoPath);
      if (!isInside(absolutePath, context.parentRoot)) {
        fail(`Repository path for ${windowName} is outside the parent workspace: ${repoPath}`);
      }
      return {
        windowName,
        path: slash(repoPath),
        mode: "external",
        role: roleOverrides.get(windowName)
          ?? context.config.repositoryRoles?.[windowName]
          ?? "Project repository; confirm scope and responsibility before enabling.",
        managedAgents: true,
      };
    }).filter((repo) => !excluded.has(repo.windowName));
  }

  return discoverSiblingRepositories(context)
    .filter((repo) => !excluded.has(repo.suggestedWindowName))
    .map((repo) => ({
    windowName: repo.suggestedWindowName,
    path: repo.path,
    mode: "external",
    role: repo.role,
    managedAgents: true,
  }));
}

function configurePayload(context = commandContext()) {
  const workspaceName = getValue("--workspace-name", context.config.workspaceName);
  const controllerWindow = getValue("--controller-window", workspaceName);
  const explicitRepositories = parseRepoSpecs(context);
  const explicitWindows = new Set(explicitRepositories.map((repo) => repo.windowName));
  const requestedDesignWindow = getValue("--design-window", null);
  const requestedTestWindow = getValue("--test-window", null);
  const requestedRealProjectWindow = getValue("--real-project-window", null);
  const requestedLanguage = requestedInterfaceLanguage(context);
  let designWindow = requestedDesignWindow ?? defaultWorkspaceConfig.designWindow;
  let testWindow = requestedTestWindow ?? defaultWorkspaceConfig.testWindow;
  let realProjectWindow = requestedRealProjectWindow ?? context.config.realProjectWindow;
  const internalDesignPath = context.pluginTargetMode ? designWindow : `../${designWindow}`;
  const internalTestPath = context.pluginTargetMode ? testWindow : `../${testWindow}`;
  const previousByWindow = new Map(normalizedRepositories(context.config).map((repo) => [repo.windowName, repo]));
  const repositories = explicitRepositories.length > 0
    ? [...explicitRepositories]
    : normalizedRepositories(context.config).filter((repo) => ![designWindow, testWindow].includes(repo.windowName));

  if (!explicitWindows.has(designWindow)) {
    const previous = previousByWindow.get(designWindow);
    repositories.push(hasFlag("--internal-design") || !previous
      ? {
          windowName: designWindow,
          path: internalDesignPath,
          mode: "internal",
          role: "Internal requirement design workspace",
          managedAgents: false,
        }
      : previous);
  }

  if (!explicitWindows.has(testWindow)) {
    const previous = previousByWindow.get(testWindow);
    repositories.push(hasFlag("--internal-test") || !previous
      ? {
          windowName: testWindow,
          path: internalTestPath,
          mode: "internal",
          role: "Internal test coordination workspace",
          managedAgents: false,
        }
      : previous);
  }

  if (!explicitWindows.has(realProjectWindow) && previousByWindow.has(realProjectWindow)) {
    repositories.push(previousByWindow.get(realProjectWindow));
  }

  const baseWindow = getValue("--base-window", context.config.baseWindow ?? repositories[0]?.windowName);
  const repositoryRoles = {};
  for (const repo of repositories) {
    repositoryRoles[repo.windowName] = repo.role;
  }
  const names = repositories.map((repo) => repo.windowName);
  const designRepo = repositories.find((repo) => repo.windowName === designWindow);
  const dispatchWindows = names.filter((name) => name !== designWindow && name !== realProjectWindow);
  const repoNames = names.filter((name) => ![designWindow, testWindow, realProjectWindow].includes(name));
  const protectedWorkspacePrefixes = repositories
    .filter((repo) => repo.mode !== "internal")
    .map((repo) => repo.path)
    .filter((repoPath) => !repoPath.startsWith("../") && repoPath !== ".")
    .map((repoPath) => `${repoPath.replace(/\/+$/, "")}/`);
  const nextConfig = {
    ...context.userConfig,
    workspaceName,
    runtimeMode: context.pluginTargetMode ? "plugin" : (context.config.runtimeMode ?? "repository"),
    interfaceLanguage: requestedLanguage,
    controllerWindow,
    designWindow,
    testWindow,
    realProjectWindow,
    baseWindow,
    workspaceRoot: slash(path.relative(context.wakeflowRoot, context.parentRoot)) || ".",
    wakeflowRepoDir: path.basename(context.wakeflowRoot),
    activeLedgerRoot: context.config.activeLedgerRoot,
    projectLedgerRoot: context.config.projectLedgerRoot,
    windowLedgerRoot: context.config.windowLedgerRoot,
    windowLedgerDirs: context.config.windowLedgerDirs,
    workspaceDocsDir: context.config.workspaceDocsDir,
    workspaceCurrentDir: context.config.workspaceCurrentDir,
    workspaceArchiveDir: context.config.workspaceArchiveDir,
    workspaceIndexPath: context.config.workspaceIndexPath,
    workspaceCurrentIndexPath: context.config.workspaceCurrentIndexPath,
    workspaceCurrentStatusPath: context.config.workspaceCurrentStatusPath,
    workspaceRecordMapPath: context.config.workspaceRecordMapPath,
    globalTodoPath: context.config.globalTodoPath,
    requirementDesignsDir: context.config.requirementDesignsDir,
    goalStageConfirmationDir: context.config.goalStageConfirmationDir,
    internalDesignPath,
    internalTestPath,
    testExchangePath: context.config.testExchangePath,
    dispatchWindows,
    requiredDispatchWindows: names,
    repoNames,
    protectedWorkspacePrefixes,
    repositoryRoles,
    repositories,
  };
  nextConfig.wakeflowRepoDir = context.pluginTargetMode
    ? context.config.wakeflowRepoDir
    : path.basename(context.wakeflowRoot);

  if (write) {
    writeJson(context.configPath, nextConfig);
  }

  return {
    ok: true,
    command: "configure",
    wrote: write,
    configPath: context.configPath,
    nextConfig,
  };
}

function buildChildPrompt(context, repo, language) {
  const absolutePath = repositoryAbsPath(context.wakeflowRoot, repo);
  const relativeScript = relativeCommandPath(absolutePath, path.join(context.wakeflowRoot, "scripts/wakeflow-setup.mjs"));
  const wakeflowPath = slash(path.relative(absolutePath, context.wakeflowRoot)) || ".";
  const parentAgents = relativePathFrom(absolutePath, path.join(context.parentRoot, hostProfile.memoryFile));
  const activeIndex = relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceIndexPath ?? ".wakeflow-active/index.md"));
  const activeStatus = relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceCurrentStatusPath ?? ".wakeflow-active/current/workspace-current-status.md"));
  const title = roleTitle(context, repo.windowName, defaultThreadRole(context, repo.windowName), language);
  if (language === "zh") {
    return `${title}：初始化入口同步，不是任务投递。
目标目录：${repo.path}
窗口职责：${repo.role}

先读取本目录 ${hostProfile.memoryFile}、${parentAgents}、${activeIndex} 和 ${activeStatus}。如果 Wakeflow access card 缺失，先确认目录范围，再做任何跨目录工作。

先运行：
node ${relativeScript} status --json

确认当前目录属于 ${repo.windowName} 后，只处理本窗口职责范围内的任务。需要写入或刷新本目录 ${hostProfile.memoryFile} 时运行：
node ${relativeScript} write-agents --window ${repo.windowName} --write

如果当前没有 active demand、state root、task package 或 dispatch packet，请报告“入口同步完成，等待总控任务”后停止。这是初始化后的正常 ready 状态，不是失败。
只有收到包含 currentWindow、taskId、stateRoot 的 Wakeflow task wakeup / delivery prompt 时，才执行本窗口任务。
${hostProfile.texts.subagentAssist.zh}

Wakeflow runtime 相对路径：${wakeflowPath}
如果目录、职责、stateRoot 或 Wakeflow 配置不一致，停止并回报总控。`;
  }
  return `${title}: initialization entry sync, not a task delivery.
Target directory: ${repo.path}
Responsibility: ${repo.role}

First read this directory ${hostProfile.memoryFile}, ${parentAgents}, ${activeIndex}, and ${activeStatus}. If the Wakeflow access card is missing, confirm the directory scope before doing any cross-directory work.

First run:
node ${relativeScript} status --json

After confirming this directory belongs to ${repo.windowName}, process only tasks inside this window responsibility. To write or refresh this directory ${hostProfile.memoryFile}, run:
node ${relativeScript} write-agents --window ${repo.windowName} --write

If there is no active demand, state root, task package, or dispatch packet, report "entry sync complete; waiting for controller task" and stop. This is the normal ready state after initialization, not a failure.
Execute window work only after receiving a Wakeflow task wakeup / delivery prompt containing currentWindow, taskId, and stateRoot.
${hostProfile.texts.subagentAssist.en}

Wakeflow runtime relative path: ${wakeflowPath}
If the directory, responsibility, stateRoot, or Wakeflow configuration is inconsistent, stop and report to the controller.`;
}

function promptsPayload() {
  const context = commandContext();
  const language = interfaceLanguage(context);
  const windowFilter = getValue("--window");
  const repositories = normalizedRepositories(context.config)
    .filter((repo) => repo.managedAgents !== false)
    .filter((repo) => !windowFilter || repo.windowName === windowFilter);
  if (windowFilter && repositories.length === 0) {
    fail(`No configured repository found for window: ${windowFilter}`);
  }
  return {
    ok: true,
    command: "prompts",
    language,
    prompts: repositories.map((repo) => ({
      windowName: repo.windowName,
      path: repo.path,
      displayTitle: roleTitle(context, repo.windowName, defaultThreadRole(context, repo.windowName), language),
      prompt: buildChildPrompt(context, repo, language),
    })),
  };
}

const AGENTS_START = "<!-- wakeflow:scope:start -->";
const AGENTS_END = "<!-- wakeflow:scope:end -->";
const ROOT_AGENTS_START = "<!-- wakeflow:root-agents:start -->";
const ROOT_AGENTS_END = "<!-- wakeflow:root-agents:end -->";
const RUNTIME_GITIGNORE_ENTRIES = [".wakeflow-active/", ".wakeflow-local/"];
const GITIGNORE_POLICY =
  "Wakeflow only manages its own runtime state entries in the workspace .gitignore. Do not add product repositories, Design/Test support directories, ledger directories, source folders, or generic local noise as Wakeflow-generated gitignore entries.";

function testWindowNamesForContext(context) {
  const configuredNames = [
    context.config.testWindow,
    context.config.ideTestWindow,
  ].filter(Boolean);
  const testRepo = configuredNames
    .map((name) => repoForWindow(context.config, name))
    .find(Boolean);
  if (!testRepo) {
    return [...new Set(configuredNames.length > 0 ? configuredNames : ["Test"])];
  }
  const testPath = repositoryAbsPath(context.wakeflowRoot, testRepo);
  const samePathNames = normalizedRepositories(context.config)
    .filter((candidate) => repositoryAbsPath(context.wakeflowRoot, candidate) === testPath)
    .map((candidate) => candidate.windowName);
  return [...new Set([...configuredNames, ...samePathNames])];
}

function testWindowDeliveryBoundaryLine(context) {
  const names = testWindowNamesForContext(context).join(" / ");
  return `- Non-Test windows must not create, process, or verify ${names} delivery unless both the current plan and delivery envelope explicitly authorize it.`;
}

function scopeBlock(context, repo) {
  const absolutePath = repositoryAbsPath(context.wakeflowRoot, repo);
  const samePathRepos = repositoriesSharingPath(context, repo);
  const primaryRepo = primaryRepositoryForScope(context, repo);
  const samePathWindowNames = samePathRepos.map((item) => item.windowName);
  const hasWindowAliases = samePathWindowNames.length > 1;
  const windowNamesInline = samePathWindowNames.map((name) => `\`${name}\``).join(" / ");
  const wakeflowRelative = slash(path.relative(absolutePath, context.wakeflowRoot)) || ".";
  const parentAgents = relativePathFrom(absolutePath, path.join(context.parentRoot, hostProfile.memoryFile));
  const activeIndex = relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceIndexPath ?? ".wakeflow-active/index.md"));
  const activeStatus = relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceCurrentStatusPath ?? ".wakeflow-active/current/workspace-current-status.md"));
  const currentDir = relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceCurrentDir ?? ".wakeflow-active/current"));
  const windowLedger = relativePathFrom(absolutePath, windowLedgerDirFor({
    workspaceRoot: context.wakeflowRoot,
    config: context.config,
    windowName: primaryRepo.windowName,
  }));
  const windowLedgerText = hasWindowAliases
    ? `- Window ledger: \`${windowLedger}\`
- Window ledgers for this repository:
${samePathRepos.map((item) => {
  const itemLedger = relativePathFrom(absolutePath, windowLedgerDirFor({
    workspaceRoot: context.wakeflowRoot,
    config: context.config,
    windowName: item.windowName,
  }));
  return `  - \`${item.windowName}\`: \`${itemLedger}\``;
}).join("\n")}`
    : `- Window ledger: \`${windowLedger}\``;
  const testExchange = relativePathFrom(
    absolutePath,
    resolveMaybeRelative(context.wakeflowRoot, context.config.testExchangePath ?? ".wakeflow-active/current/test-exchange.md"),
  );
  const isDesign = samePathWindowNames.includes(context.config.designWindow);
  const isTest = samePathWindowNames.includes(context.config.testWindow);
  const roleNote = [];
  if (isTest) {
    roleNote.push(`- Test exchange projection: \`${testExchange}\``);
  }
  const roleNoteText = roleNote.length > 0 ? `\n${roleNote.join("\n")}` : "";
  const windowNameText = hasWindowAliases
    ? `- Window name: \`${primaryRepo.windowName}\`
- Window aliases for this repository: ${windowNamesInline}`
    : `- Window name: \`${primaryRepo.windowName}\``;
  const taskTargetText = hasWindowAliases
    ? `one of the windows listed in this access card (${windowNamesInline})`
    : `\`${primaryRepo.windowName}\``;
  const dispatchPacketRule = hasWindowAliases
    ? `- This repository only handles dispatch packets for the windows listed in this access card (${windowNamesInline}). Before execution, route by \`currentWindow\` in the prompt, delivery envelope, or current plan, then return the matching \`TargetResultEnvelope\`. Do not claim, accept, or process other window tasks.`
    : `- This window only handles dispatch packets for \`${primaryRepo.windowName}\` and returns \`TargetResultEnvelope\`. Do not claim, accept, or process other window tasks.`;
  return `${AGENTS_START}
## Workspace Access Card

This section is maintained by the Wakeflow runtime installer. It records this window access coordinates and the minimum automation gate. Hard rules come from the parent AGENTS and this file; do not duplicate repository-specific rules here.

### Coordinates

- Wakeflow runtime: \`${wakeflowRelative}\`
${windowNameText}
- Parent workspace AGENTS: \`${parentAgents}\`
- Active workspace index: \`${activeIndex}\`
- Active workspace status: \`${activeStatus}\`
- Current plan directory: \`${currentDir}\`
${windowLedgerText}${roleNoteText}

### When claiming workspace work

1. Read this file first.
2. Then read parent \`${parentAgents}\`.
3. Then read \`${activeIndex}\` and \`${activeStatus}\`.
4. If there is a current plan, task package, or direct-thread delivery, execute only the content under \`${currentDir}\` explicitly assigned to ${taskTargetText}.
5. Goals, scope, forbidden actions, validation commands, and backfill fields come from the current plan, task package, and repository rules. Prompts are only wakeup entrypoints, not the full task specification.
6. If a keyword, familiar command, script hint, or urgency is pulling you into action before a safe operation, recovery boundary, and one-sentence plan are clear, stop and report the blocker.

### Direct Thread Dispatch Minimum Gate

- Direct-thread delivery is the normal work transport. It does not change this window responsibility or expand task scope. Specific work comes from the dispatch packet, current plan, and repository rules.
- Delivery prompts carry only a few dynamic variables and a skill pointer. Do not treat the prompt as a full command manual. State-machine routes need only visible \`currentWindow\` / \`taskId\` / \`stateRoot\` / optional \`dispatchGroup\`. Machine fields such as \`controllerWindow\`, \`returnPolicy\`, \`humanContextRef\`, and \`stateRevision\` are read from the state root, dispatch group, and delivery envelope. Stop and report if \`stateRoot\` is missing or variables conflict.
${dispatchPacketRule}
- Child windows do not create target-to-target next-hop delivery by default. Evidence repair, redispatch, and next phases are decided by controller review. If delivery has \`returnRoute=controller\` and \`review-results\` shows that \`DispatchGroup.returnPolicy\` allows a callback, create exactly one controller-return envelope with \`build-controller-return\`, returning by default to the original controller named by \`DispatchGroup.controllerWindow\`. Then complete the real direct-thread send, readback, and \`record-delivery-run\`. A controller return is complete only when a \`DirectThreadDeliveryRun\` exists with \`status=sent\` and \`readback.ok=true\`. The full group snapshot stays in the controller-return envelope; the visible prompt shows only non-empty exceptional targets and must not treat one target backfill as whole-group completion.
${testWindowDeliveryBoundaryLine(context)}
- Thread ids may only be written to Wakeflow local runtime. Do not write them to tracked documents, backfill text, or GitHub.
${skillAssistanceText(context, samePathWindowNames)}

### Functional Completeness Self-Check

Before returning a \`TargetResultEnvelope\` or handoff, this child window must self-check the assigned feature or evidence path for functional completeness. Do not rely on the controller to discover obvious gaps.

- Re-read the state root, task package, current plan, repository rules, and acceptance/evidence requirements.
- Verify the implementation or evidence covers the requested behavior end to end, including edge cases, integration boundaries, docs/config/API surfaces, and tests that the target window can reasonably run.
- Compare the final diff/evidence against the original user goal and explicit non-goals; do not downgrade a complete capability into a thin adapter, placeholder, mock-only flow, or partial scaffold.
- When recommending follow-up work, label whether it is authorized by the original requirement or only discovered by code/test inspection. Residual implementation fields, existing tests, old adapters, and target observations do not become new requirements unless the original plan, requirement design, or a user/controller decision allows them.
- If completeness cannot be proven inside this window boundary, return \`blocked\` or \`needs-review\` with the missing evidence and next recommendation instead of reporting \`completed\`.

### Document Destinations

- Long-term cross-repository collaboration docs, plans, acceptance records, scans, and boundary records go to \`${windowLedger}\`. This repository \`docs/\` is only for product, release, or user docs maintained with the source.
${AGENTS_END}`;
}

function repositoriesSharingPath(context, repo) {
  const absolutePath = repositoryAbsPath(context.wakeflowRoot, repo);
  return normalizedRepositories(context.config).filter((candidate) => {
    return repositoryAbsPath(context.wakeflowRoot, candidate) === absolutePath;
  });
}

function primaryRepositoryForScope(context, repo) {
  const samePathRepos = repositoriesSharingPath(context, repo);
  return samePathRepos.find((candidate) => candidate.windowName === context.config.testWindow)
    ?? samePathRepos.find((candidate) => candidate.windowName === context.config.designWindow)
    ?? samePathRepos.find((candidate) => candidate.managedAgents !== false)
    ?? samePathRepos[0]
    ?? repo;
}

function skillAssistanceText(context, samePathWindowNames) {
  const roleLines = [
    hostProfile.texts.skillAssistanceLine,
  ];
  if (samePathWindowNames.includes(context.config.designWindow)) {
    roleLines.push(`- Design work should proactively surface relevant local Design skills while the user is clarifying requirements, comparing options, writing a requirement design, redesigning a non-bug outcome mismatch, slicing work, or preparing a handoff. Read \`skills/README.md\` when available, name the smallest matching skill, explain why it helps, and use it in conversation before writing tracked Design artifacts. If no skill is genuinely needed, say so briefly and answer directly.`);
  }
  if (samePathWindowNames.includes(context.config.testWindow)) {
    roleLines.push(`- Test work should proactively surface relevant local Test skills while planning validation, reproducing or triaging failures, designing regressions, reviewing evidence, or validating long chains. Read \`skills/README.md\` when available, name the smallest matching skill, explain why it helps, and use it to shape evidence before running or recording test work. If no skill is genuinely needed, say so briefly and proceed with the assigned test boundary.`);
  }
  return `
### Skill Assistance

${roleLines.join("\n")}`;
}

function scopeBlockContent(existing) {
  const start = existing.indexOf(AGENTS_START);
  const end = existing.indexOf(AGENTS_END);
  if (start >= 0 && end > start) {
    return existing.slice(start, end + AGENTS_END.length);
  }
  return "";
}

function expectedScopeCoordinates(context, repo) {
  const absolutePath = repositoryAbsPath(context.wakeflowRoot, repo);
  const samePathRepos = repositoriesSharingPath(context, repo);
  const samePathWindowNames = samePathRepos.map((item) => item.windowName);
  const ledgerByWindow = Object.fromEntries(samePathRepos.map((item) => [
    item.windowName,
    relativePathFrom(absolutePath, windowLedgerDirFor({
      workspaceRoot: context.wakeflowRoot,
      config: context.config,
      windowName: item.windowName,
    })),
  ]));
  const coordinate = {
    wakeflowRuntime: slash(path.relative(absolutePath, context.wakeflowRoot)) || ".",
    windowName: repo.windowName,
    windowNames: samePathWindowNames,
    parentAgents: relativePathFrom(absolutePath, path.join(context.parentRoot, hostProfile.memoryFile)),
    activeIndex: relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceIndexPath ?? ".wakeflow-active/index.md")),
    activeStatus: relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceCurrentStatusPath ?? ".wakeflow-active/current/workspace-current-status.md")),
    currentPlanDirectory: relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceCurrentDir ?? ".wakeflow-active/current")),
    windowLedger: relativePathFrom(absolutePath, windowLedgerDirFor({
      workspaceRoot: context.wakeflowRoot,
      config: context.config,
      windowName: repo.windowName,
    })),
    ledgerByWindow,
  };
  if (repo.windowName === context.config.testWindow) {
    coordinate.testExchangeProjection = relativePathFrom(
      absolutePath,
      resolveMaybeRelative(context.wakeflowRoot, context.config.testExchangePath ?? ".wakeflow-active/current/test-exchange.md"),
    );
  }
  return coordinate;
}

function coordinateChecks(block, coordinates) {
  const checks = [
    ["wakeflowRuntime", `- Wakeflow runtime: \`${coordinates.wakeflowRuntime}\``],
    ["parentAgents", `- Parent workspace AGENTS: \`${coordinates.parentAgents}\``],
    ["activeIndex", `- Active workspace index: \`${coordinates.activeIndex}\``],
    ["activeStatus", `- Active workspace status: \`${coordinates.activeStatus}\``],
    ["currentPlanDirectory", `- Current plan directory: \`${coordinates.currentPlanDirectory}\``],
  ];
  if (coordinates.windowNames.length > 1) {
    checks.push([
      "windowName",
      (content) => content.includes("- Window aliases for this repository:")
        && coordinates.windowNames.every((name) => content.includes(`\`${name}\``)),
    ]);
    checks.push([
      "windowLedger",
      (content) => Object.entries(coordinates.ledgerByWindow)
        .every(([name, ledger]) => content.includes(`  - \`${name}\`: \`${ledger}\``)),
    ]);
  } else {
    checks.push(["windowName", `- Window name: \`${coordinates.windowName}\``]);
    checks.push(["windowLedger", `- Window ledger: \`${coordinates.windowLedger}\``]);
  }
  if (coordinates.testExchangeProjection) {
    checks.push(["testExchangeProjection", `- Test exchange projection: \`${coordinates.testExchangeProjection}\``]);
  }
  return checks.map(([key, expected]) => {
    const ok = typeof expected === "function" ? expected(block) : block.includes(expected);
    return { key, expected: typeof expected === "function" ? "<predicate>" : expected, ok };
  });
}

function accessProfileFor(context, repo) {
  const absolutePath = repositoryAbsPath(context.wakeflowRoot, repo);
  const agentsPath = path.join(absolutePath, hostProfile.memoryFile);
  const exists = existsSync(absolutePath) && statSync(absolutePath).isDirectory();
  const hasAgents = existsSync(agentsPath);
  const agents = hasAgents ? readFileSync(agentsPath, "utf8") : "";
  const block = scopeBlockContent(agents);
  const coordinates = expectedScopeCoordinates(context, repo);
  const checks = coordinateChecks(block, coordinates);
  const hasWindowAliases = coordinates.windowNames.length > 1;
  const automationChecks = [
    {
      key: "targetResultEnvelope",
      ok: block.includes("TargetResultEnvelope"),
    },
    {
      key: "singleWindowDispatchPacket",
      ok: hasWindowAliases
        ? block.includes("This repository only handles dispatch packets for the windows listed in this access card")
          && coordinates.windowNames.every((name) => block.includes(`\`${name}\``))
        : block.includes(`This window only handles dispatch packets for \`${repo.windowName}\``),
    },
    {
      key: "noTargetNextHop",
      ok: block.includes("Child windows do not create target-to-target next-hop delivery by default"),
    },
    {
      key: "testWindowBoundary",
      ok: block.includes(testWindowDeliveryBoundaryLine(context)),
    },
    {
      key: "threadIdLocalOnly",
      ok: block.includes("Thread ids may only be written to Wakeflow local runtime"),
    },
    {
      key: "functionalCompletenessSelfCheck",
      ok: block.includes("Functional Completeness Self-Check")
        && block.includes("Do not rely on the controller to discover obvious gaps")
        && block.includes("do not downgrade a complete capability into a thin adapter"),
    },
  ];
  const required = repo.managedAgents !== false;
  const issues = [];
  if (required && !exists) {
    issues.push("managed repository directory missing");
  }
  if (required && !hasAgents) {
    issues.push(`managed repository ${hostProfile.memoryFile} missing`);
  }
  if (required && !block) {
    issues.push("managed access card missing");
  }
  if (block) {
    for (const check of [...checks, ...automationChecks]) {
      if (!check.ok) {
        issues.push(`access card check failed: ${check.key}`);
      }
    }
  }
  return {
    windowName: repo.windowName,
    path: repo.path,
    role: repo.role,
    mode: repo.mode,
    managedAgents: repo.managedAgents,
    required,
    exists,
    hasAgents,
    hasManagedBlock: Boolean(block),
    coordinates,
    coordinateChecks: checks,
    automationChecks,
    ok: issues.length === 0,
    issues,
  };
}

function accessProfilesPayload(context = commandContext(), options = {}) {
  const windowFilter = options.window ?? getValue("--window");
  const includeRealProject = options.includeRealProject ?? hasFlag("--include-real-project");
  const repositories = normalizedRepositories(context.config)
    .filter((repo) => includeRealProject || repo.windowName !== context.config.realProjectWindow)
    .filter((repo) => !windowFilter || repo.windowName === windowFilter);
  if (windowFilter && repositories.length === 0) {
    fail(`No configured repository found for window: ${windowFilter}`);
  }
  const profiles = repositories.map((repo) => accessProfileFor(context, repo));
  return {
    ok: profiles.every((profile) => profile.ok || !profile.required),
    command: "access-profiles",
    profiles,
  };
}

function removeScopeBlock(existing) {
  const start = existing.indexOf(AGENTS_START);
  const end = existing.indexOf(AGENTS_END);
  if (start >= 0 && end > start) {
    return `${existing.slice(0, start).trimEnd()}\n\n${existing.slice(end + AGENTS_END.length).trimStart()}`.trim();
  }
  return existing.trim();
}

function upsertScopeBlock(existing, block) {
  if (!existing.trim()) {
    return `# Repository Agent Instructions\n\n${block}\n`;
  }
  const withoutBlock = removeScopeBlock(existing);
  const titleMatch = withoutBlock.match(/^# .+\n/);
  if (titleMatch) {
    return `${titleMatch[0].trimEnd()}\n\n${block}\n\n${withoutBlock.slice(titleMatch[0].length).trimStart()}\n`;
  }
  return `${block}\n\n${withoutBlock}\n`;
}

function replaceAllLiteral(content, from, to) {
  return content.split(from).join(to);
}

function pluginRootScriptGuidance(content) {
  return content
    .replace(
      /- `scripts\/README\.md` is the script index\. After adding, renaming, or deleting\s+`scripts\/\*\.mjs`, update the index and run\s+`node scripts\/wakeflow-check-scripts\.mjs`\./,
      `- In installed parent workspaces, Wakeflow runtime scripts are backend
  implementation details. Use Wakeflow MCP tools for setup, status, state
  roots, delivery, review, archive, next-work scans, and verification. Do not
  call installed plugin-cache scripts directly from total control.`,
    )
    .replace(
      /- `node scripts\/wakeflow-verify\.mjs` is the default verification orchestrator\./,
      `- Use the Wakeflow verification MCP capability as the default
  verification orchestrator. If the MCP surface is unavailable, stop and report
  that the Wakeflow plugin must be reloaded or reinstalled; do not fall back to
  installed runtime scripts.`,
    )
    .replace(
      /- After creating or activating a phase confirmation or execution wave, run\s+`node scripts\/wakeflow-verify\.mjs`\./,
      `- After creating or activating a phase confirmation or execution wave,
  run Wakeflow verification through the MCP capability. If that capability is
  unavailable, stop and report the plugin-surface blocker.`,
    )
    .replace(
      /- If scripts, script README, or script skills change, run\s+`node scripts\/wakeflow-verify\.mjs --with-script-tests`\./,
      `- If Wakeflow scripts, script index, or installed skills change, run
  Wakeflow source verification with script tests before refreshing the plugin
  cache.`,
    );
}

function pluginRootCapabilityReferences(content) {
  return content
    .replace(/`node scripts\/([^`]+)`/g, "`Wakeflow MCP tool surface`")
    .replace(/`scripts\/([^`]+)`/g, "`Wakeflow source-maintenance script $1`")
    .replace(/`skills\/([^`]+)`/g, "`installed Wakeflow skill $1`")
    .replace(/`templates\/([^`]+)`/g, "`installed Wakeflow template $1`");
}

function rootAgentsContent(context) {
  const wakeflowRel = slash(path.relative(context.parentRoot, context.wakeflowRoot)) || ".";
  const wakeflowPrefix = wakeflowRel === "." ? "" : `${wakeflowRel}/`;
  const runtimePrefix = context.pluginTargetMode ? "" : wakeflowPrefix;
  const ledgerRel = slash(path.relative(context.parentRoot, context.ledgerPaths.projectLedgerRoot)) || "wakeflow-ledger";
  let content = readWakeflowFile(context.templateRoot, hostProfile.memoryFile);
  content = replaceAllLiteral(content, "Wakeflow is the controller workspace", `${context.config.workspaceName} is the controller workspace`);
  content = replaceAllLiteral(content, "Wakeflow controller", `${context.config.workspaceName} controller`);

  const localConfigPlaceholder = "__WAKEFLOW_LOCAL_CONFIG__";
  content = replaceAllLiteral(content, ".wakeflow-local/workspace.config.json", localConfigPlaceholder);
  content = replaceAllLiteral(content, ".wakeflow-active/", `${runtimePrefix}.wakeflow-active/`);
  content = replaceAllLiteral(content, ".wakeflow-local/", `${runtimePrefix}.wakeflow-local/`);
  content = replaceAllLiteral(content, "../wakeflow-ledger/", `${ledgerRel}/`);
  content = replaceAllLiteral(content, "../wakeflow-ledger", ledgerRel);
  content = content.replace(/(?<![\w./-])workspace\.config\.json/g, `${runtimePrefix}workspace.config.json`);
  content = replaceAllLiteral(content, localConfigPlaceholder, `${runtimePrefix}.wakeflow-local/workspace.config.json`);

  if (context.pluginTargetMode) {
    content = pluginRootScriptGuidance(content);
    content = pluginRootCapabilityReferences(content);
  } else {
    content = replaceAllLiteral(content, "skills/", `${wakeflowPrefix}skills/`);
    content = replaceAllLiteral(content, "templates/", `${wakeflowPrefix}templates/`);
    content = replaceAllLiteral(content, "scripts/", `${wakeflowPrefix}scripts/`);
    content = replaceAllLiteral(content, `node ${wakeflowPrefix}scripts/`, `cd ${wakeflowRel} && node scripts/`);
  }

  content = content.replace(/^# .+$/m, `# ${context.config.workspaceName} Agent Instructions`);
  content = content.replace(
    /^# .+$/m,
    (heading) => `${heading}\n\n${hostProfile.texts.rootGeneratedFromBanner(wakeflowRel)}`,
  );
  if (context.pluginTargetMode) {
    content = content.replace(
      /> This file is generated from[\s\S]*?before execution\./,
      hostProfile.texts.rootPluginGeneratedBanner,
    );
    content = content.replace(
      /^# .+?\n\n/s,
      (heading) => `${heading}${hostProfile.texts.rootPluginUsageBanner}`,
    );
  }

  return `${ROOT_AGENTS_START}\n${content.trimEnd()}\n${ROOT_AGENTS_END}`;
}

function upsertRootAgents(existing, block) {
  const start = existing.indexOf(ROOT_AGENTS_START);
  const end = existing.indexOf(ROOT_AGENTS_END);
  if (start >= 0 && end > start) {
    return `${existing.slice(0, start).trimEnd()}\n\n${block}\n\n${existing.slice(end + ROOT_AGENTS_END.length).trimStart()}`.trim() + "\n";
  }
  if (!existing.trim()) {
    return `${block}\n`;
  }
  return `${block}\n\n<!-- wakeflow:root-agents:preserved-existing -->\n\n${existing.trimEnd()}\n`;
}

function syncRootAgentsPayload(context = commandContext()) {
  const target = resolveMaybeRelative(context.parentRoot, getValue("--target", hostProfile.memoryFile));
  if (!isInside(target, context.parentRoot)) {
    fail(`Refusing to write root AGENTS outside parent workspace: ${target}`);
  }
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  const block = rootAgentsContent(context);
  const next = upsertRootAgents(existing, block);
  const changed = next !== existing;
  if (write && changed) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, next);
  }
  return {
    ok: true,
    command: "sync-root-agents",
    wrote: write && changed,
    changed,
    target,
    source: path.join(context.templateRoot, hostProfile.memoryFile),
    parentRoot: context.parentRoot,
    wakeflowRoot: context.wakeflowRoot,
  };
}

function gitignoreHasRuntimeEntry(existing, entry) {
  const expected = entry.replace(/^\/+/, "").replace(/\/+$/, "");
  return existing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .some((line) => line.replace(/^\/+/, "").replace(/\/+$/, "") === expected);
}

function syncGitignorePayload(context = commandContext()) {
  const target = path.join(context.wakeflowRoot, ".gitignore");
  if (!isInside(target, context.wakeflowRoot)) {
    fail(`Refusing to write .gitignore outside workspace root: ${target}`);
  }
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  const missing = RUNTIME_GITIGNORE_ENTRIES.filter((entry) => !gitignoreHasRuntimeEntry(existing, entry));
  const changed = missing.length > 0;
  let next = existing;
  if (changed) {
    const prefix = existing.trim() ? `${existing.trimEnd()}\n\n# Wakeflow runtime state\n` : "# Wakeflow runtime state\n";
    next = `${prefix}${missing.join("\n")}\n`;
  }
  if (write && changed) {
    writeFileSync(target, next);
  }
  return {
    ok: true,
    command: "sync-gitignore",
    wrote: write && changed,
    changed,
    target,
    policy: GITIGNORE_POLICY,
    entries: RUNTIME_GITIGNORE_ENTRIES,
    missing,
    wakeflowManagedOnly: true,
    forbiddenGeneratedEntries: [
      "product repositories",
      "Design/",
      "Test/",
      "wakeflow-ledger/",
      ".DS_Store",
    ],
  };
}

function writeAgentsPayload(context = commandContext(), options = {}) {
  const windowFilter = options.window ?? getValue("--window");
  const all = options.all ?? hasFlag("--all");
  const includeUnmanaged = options.includeUnmanaged ?? hasFlag("--include-unmanaged");
  const includeRealProject = options.includeRealProject ?? hasFlag("--include-real-project");
  if (!windowFilter && !all) {
    fail("write-agents requires --window <WindowName> or --all.");
  }
  const targets = normalizedRepositories(context.config)
    .filter((repo) => repo.managedAgents !== false || includeUnmanaged)
    .filter((repo) => includeRealProject || repo.windowName !== context.config.realProjectWindow)
    .filter((repo) => all || repo.windowName === windowFilter);
  if (targets.length === 0) {
    fail(`No managed repository found${windowFilter ? ` for ${windowFilter}` : ""}.`);
  }

  const results = targets.map((repo) => {
    const absolutePath = repositoryAbsPath(context.wakeflowRoot, repo);
    if (!isInside(absolutePath, context.parentRoot)) {
      fail(`Refusing to write outside parent workspace for ${repo.windowName}: ${repo.path}`);
    }
    if (!existsSync(absolutePath) || !statSync(absolutePath).isDirectory()) {
      return { windowName: repo.windowName, path: repo.path, ok: false, issue: "directory missing", wrote: false };
    }
    const agentsPath = path.join(absolutePath, hostProfile.memoryFile);
    const existing = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";
    const next = upsertScopeBlock(existing, scopeBlock(context, repo));
    const changed = next !== existing;
    if (write && changed) {
      writeFileSync(agentsPath, next);
    }
    return {
      windowName: repo.windowName,
      path: repo.path,
      agentsPath,
      ok: true,
      changed,
      wrote: write && changed,
    };
  });
  return { ok: results.every((result) => result.ok), command: "write-agents", wrote: write, results };
}

function internalDesignReadme(config) {
  return `# Internal Design Workspace

Use this directory when the user does not have an external ${config.designWindow} repository.

- Local rules: \`${hostProfile.memoryFile}\`
- Documentation index: \`docs/index.md\`
- Current Design work: \`docs/current/\`
- Operating policy: \`docs/design-window-operating-policy.md\`
- Alignment checklist: \`docs/workspace-alignment-checklist.md\`
- Templates: \`templates/original-plan-template.md\`, \`templates/requirement-design-template.md\`, \`templates/workspace-signal-template.md\`, and \`templates/workspace-handoff-template.md\`
- Design skill map: \`skills/README.md\`
- Design skills are conversational methods first. Use them to clarify, compare,
  draft, redesign non-bug outcome mismatches, slice, and prepare handoff
  recommendations with the user before writing tracked documents.
- Discovery and intake are performed by the controller through the Wakeflow MCP
  surface. Design does not run plugin-cache runtime scripts or update intake
  state directly.
`;
}

function internalTestingReadme(config) {
  return `# Internal Test Coordination Workspace

Use this directory when the user does not have an external ${config.testWindow} repository.

- Test boundary machine cards: \`<state-root>/test-cards/*.json\`
- Test exchange projection: \`${config.testExchangePath}\`
- Local rules: \`${hostProfile.memoryFile}\`
- Documentation index: \`docs/README.md\`
- Current Test work: \`docs/current/\`
- Default config: \`config/defaults.json\`
- Test-owned scripts: \`scripts/\`
- Test skill map: \`skills/README.md\`
- Test skills are evidence methods first. Use them proactively to plan
  validation, triage failures, design regressions, review evidence, and handle
  long-chain validation before recording backfill.
- Testing operation policy: \`docs/testing-operation-policy.md\`
- Test handoff template: \`templates/test-handoff-template.md\`
- Rule: only run real test work when a controller state root assigns a matching task package and test card.
`;
}

function testExchangeTemplate() {
  return `# Test Exchange Projection

This file is a short human-readable projection for real-scenario validation handoffs.
Machine authority lives under the active controller state root in \`test-cards/*.json\`,
\`task-packages/*.json\`, and \`target-results/*.json\`.

## Active Test Projection

None.

## History

- Template initialized.
`;
}

function externalTestAlignment(repo, config) {
  return `# ${repo.windowName} Alignment

This repository can act as an external test window for ${config.workspaceName}.

- Wakeflow runtime test exchange projection: \`${config.testExchangePath}\`
- Fill state-root test cards in the Wakeflow runtime first.
- Keep probe scripts and real-environment evidence in this repository only when the test really needs this external environment.
`;
}

function readWakeflowFile(wakeflowRoot, relativePath) {
  const normalizedPath = slash(relativePath);
  const targetFile = path.join(wakeflowRoot, relativePath);
  if (existsSync(targetFile)) {
    return readFileSync(targetFile, "utf8");
  }
  const bundled = readBundledWakeflowFile(wakeflowRoot, normalizedPath);
  if (bundled !== null) {
    return bundled;
  }
  const defaultFile = path.join(defaultWakeflowRoot, relativePath);
  if (existsSync(defaultFile)) {
    return readFileSync(defaultFile, "utf8");
  }
  const fallbackBundled = readBundledWakeflowFile(defaultWakeflowRoot, normalizedPath);
  if (fallbackBundled !== null) {
    return fallbackBundled;
  }
  return readFileSync(defaultFile, "utf8");
}

function readBundledWakeflowFile(wakeflowRoot, relativePath) {
  const bundle = readTemplateBundle(wakeflowRoot);
  const content = bundle?.files?.[relativePath];
  return typeof content === "string" ? content : null;
}

function readTemplateBundle(wakeflowRoot) {
  const bundlePath = path.join(wakeflowRoot, templateBundleFile);
  if (templateBundleCache.has(bundlePath)) {
    return templateBundleCache.get(bundlePath);
  }
  if (!existsSync(bundlePath)) {
    templateBundleCache.set(bundlePath, null);
    return null;
  }
  const bundle = readJson(bundlePath);
  if (!bundle || typeof bundle.files !== "object" || Array.isArray(bundle.files)) {
    fail(`${templateBundleFile} must contain a files object.`);
  }
  templateBundleCache.set(bundlePath, bundle);
  return bundle;
}

function isStarterGeneratedContent(existing) {
  return [
    "Status: starter template",
    "Status: starter inbox",
    "Status: starter long-term map",
    "Status: idle / no active demand",
    "Status: idle / initialization ready",
    "Fresh template status",
    "Initialization ready state",
    "Template initialized.",
    "TODO-EXAMPLE-001",
  ].some((marker) => existing.includes(marker));
}

function hasNonStarterActiveDemand(existing) {
  const match = existing.match(/^- Active demand:\s*(.+)$/im);
  if (!match) return false;
  const activeDemand = match[1].trim().replace(/[.;]$/, "").toLowerCase();
  return activeDemand !== "" && activeDemand !== "none";
}

function hasNonStarterStatus(existing) {
  const match = existing.match(/^Status:\s*(.+)$/im);
  if (!match) return false;
  const status = match[1].trim().replace(/[.;]$/, "").toLowerCase();
  return !new Set([
    "starter template",
    "starter inbox",
    "starter long-term map",
    "idle / no active demand",
    "idle / initialization ready",
    "idle / initialization ready / waiting for controller task",
  ]).has(status);
}

function ensureTextFile(file, content, label, options = {}) {
  const exists = existsSync(file);
  const next = `${content.trimEnd()}\n`;
  const existing = exists ? readFileSync(file, "utf8") : "";
  const refreshStarter = Boolean(
    exists
      && options.refreshStarter
      && existing !== next
      && isStarterGeneratedContent(existing)
      && !hasNonStarterActiveDemand(existing)
      && !hasNonStarterStatus(existing),
  );
  const changed = !exists || refreshStarter;
  if (write && changed) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, next);
  }
  return {
    label,
    path: file,
    exists,
    changed,
    refreshedStarter: refreshStarter,
    wrote: write && changed,
  };
}

function repoForWindow(config, windowName) {
  return normalizedRepositories(config).find((repo) => repo.windowName === windowName) ?? null;
}

function syncRelativeFile(wakeflowRoot, targetRoot, relativePath, label) {
  return ensureTextFile(
    path.join(targetRoot, relativePath),
    readWakeflowFile(wakeflowRoot, relativePath),
    label,
  );
}

function relativeFromWorkspaceRoot(context, absolutePath) {
  const relative = slash(path.relative(context.wakeflowRoot, absolutePath));
  return relative === "" ? "." : relative;
}

function configuredStarterContent(context, relativePath) {
  const workspaceName = context.config.workspaceName ?? "Wakeflow";
  const controllerWindow = context.config.controllerWindow ?? workspaceName;
  const updated = new Date().toISOString().slice(0, 10);
  const projectLedgerRel = relativeFromWorkspaceRoot(context, context.ledgerPaths.projectLedgerRoot);
  const requirementDesignsRel = relativeFromWorkspaceRoot(context, context.ledgerPaths.requirementDesignsDir);
  const goalStageConfirmationRel = relativeFromWorkspaceRoot(
    context,
    resolveConfigPath(
      context.wakeflowRoot,
      context.config.goalStageConfirmationDir ?? path.join(context.config.projectLedgerRoot ?? "wakeflow-ledger", "goal-stage-confirmation"),
    ),
  );
  const workspaceRecordMapRel = relativeFromWorkspaceRoot(context, context.ledgerPaths.workspaceRecordMapPath);
  const workspaceArchiveRel = relativeFromWorkspaceRoot(context, context.ledgerPaths.workspaceArchiveDir);

  let content = readWakeflowFile(context.templateRoot, relativePath);
  content = replaceAllLiteral(content, "# Wakeflow Workspace Index", `# ${workspaceName} Workspace Index`);
  content = replaceAllLiteral(content, "# Wakeflow Current Status", `# ${workspaceName} Current Status`);
  content = replaceAllLiteral(content, "Updated: 2026-05-27", `Updated: ${updated}`);
  content = replaceAllLiteral(content, "Controller window: Wakeflow", `Controller window: ${controllerWindow}`);
  content = replaceAllLiteral(content, "Maintained Window: Wakeflow controller", `Maintained Window: ${controllerWindow} controller`);
  content = replaceAllLiteral(content, "Maintained By: Wakeflow controller", `Maintained By: ${controllerWindow} controller`);
  content = replaceAllLiteral(
    content,
    "This repository is a freshly extracted Wakeflow runtime template.",
    `This workspace is a freshly initialized Wakeflow controller surface for ${workspaceName}.`,
  );
  if (context.pluginTargetMode) {
    content = replaceAllLiteral(
      content,
      "Create a real active demand with `node scripts/wakeflow-state.mjs init --write`; then read the generated `developer-progress.md`.",
      "Create a real active demand with the Wakeflow MCP `wakeflow_create_demand` tool; then read the generated `developer-progress.md`.",
    );
  }
  content = replaceAllLiteral(content, "| Controller | idle | No active demand has been initialized; entry-sync windows should report ready and stop. |", `| ${controllerWindow} | idle | No active demand has been initialized; entry-sync windows should report ready and stop. |`);
  content = replaceAllLiteral(content, "| Controller | idle | No active demand; waiting for controller task. | Initialization ready state. |", `| ${controllerWindow} | idle | No active demand; waiting for controller task. | Initialization ready state. |`);
  content = replaceAllLiteral(content, "| Controller | idle | No active demand has been initialized. |", `| ${controllerWindow} | idle | No active demand has been initialized; entry-sync windows should report ready and stop. |`);
  content = replaceAllLiteral(content, "| Controller | idle | No active demand. | Starter status only. |", `| ${controllerWindow} | idle | No active demand; waiting for controller task. | Initialization ready state. |`);
  content = replaceAllLiteral(content, "| TODO-EXAMPLE-001 | parked | template | P3 | Wakeflow |", `| TODO-EXAMPLE-001 | parked | template | P3 | ${controllerWindow} |`);
  content = replaceAllLiteral(content, "| New project setup. | Wakeflow | none |", `| New project setup. | ${controllerWindow} | none |`);
  content = replaceAllLiteral(content, "`../wakeflow-ledger/workspace/workspace-record-map.md`", `\`${workspaceRecordMapRel}\``);
  content = replaceAllLiteral(content, "`../wakeflow-ledger/requirement-designs/`", `\`${requirementDesignsRel}/\``);
  content = replaceAllLiteral(content, "`../wakeflow-ledger/goal-stage-confirmation/`", `\`${goalStageConfirmationRel}/\``);
  content = replaceAllLiteral(content, "`../wakeflow-ledger/`", `\`${projectLedgerRel}/\``);
  content = replaceAllLiteral(content, "../wakeflow-ledger/workspace/workspace-record-map.md", workspaceRecordMapRel);
  content = replaceAllLiteral(content, "../wakeflow-ledger/requirement-designs/", `${requirementDesignsRel}/`);
  content = replaceAllLiteral(content, "../wakeflow-ledger/goal-stage-confirmation/", `${goalStageConfirmationRel}/`);
  content = replaceAllLiteral(content, "../wakeflow-ledger/workspace/archive/", `${workspaceArchiveRel}/`);
  content = replaceAllLiteral(content, "../wakeflow-ledger/", `${projectLedgerRel}/`);
  content = replaceAllLiteral(content, "../wakeflow-ledger", projectLedgerRel);
  return content;
}

const designDefaultSkillPaths = [
  "skills/README.md",
  "skills/requirement-clarification/SKILL.md",
  "skills/option-planning/SKILL.md",
  "skills/requirement-design/SKILL.md",
  "skills/work-slicing/SKILL.md",
  "skills/design-handoff/SKILL.md",
];

const testDefaultSkillPaths = [
  "skills/README.md",
  "skills/test-strategy/SKILL.md",
  "skills/debugging-and-triage/SKILL.md",
  "skills/regression-design/SKILL.md",
  "skills/evidence-review/SKILL.md",
  "skills/progressive-chain-validation/SKILL.md",
  "skills/progressive-chain-validation/references/artifact-layout.md",
  "skills/progressive-chain-validation/references/chain-plan-generation.md",
  "skills/progressive-chain-validation/references/data-location-preflight.md",
  "skills/progressive-chain-validation/references/local-chain-optimization.md",
  "skills/progressive-chain-validation/references/metrics-contract.md",
  "skills/progressive-chain-validation/references/plan-quality-standard.md",
  "skills/progressive-chain-validation/references/round-model.md",
  "skills/progressive-chain-validation/references/safety-boundaries.md",
  "skills/progressive-chain-validation/templates/plan.md",
];

function syncWindowSupportFile(context, repoRoot, supportName, relativePath, label) {
  return ensureTextFile(
    path.join(repoRoot, relativePath),
    readWakeflowFile(context.templateRoot, `templates/window-support/${supportName}/${relativePath}`),
    label,
  );
}

function syncWindowSupportFiles(context, repoRoot, supportName, relativePaths, prefix) {
  return relativePaths.map((relativePath) =>
    syncWindowSupportFile(context, repoRoot, supportName, relativePath, `${prefix} ${relativePath}`),
  );
}

function syncDesignSupportFiles(context, repoRoot, mode) {
  const prefix = mode === "internal" ? "internal design" : "external design";
  const files = [
    ...(mode === "internal"
      ? [
          ensureTextFile(path.join(repoRoot, ".gitignore"), readWakeflowFile(context.templateRoot, "templates/window-support/design/.gitignore"), `${prefix} gitignore`),
          ensureTextFile(path.join(repoRoot, hostProfile.memoryFile), readWakeflowFile(context.templateRoot, `templates/window-support/design/${hostProfile.memoryFile}`), `${prefix} agents`),
          ensureTextFile(path.join(repoRoot, "README.md"), internalDesignReadme(context.config), `${prefix} readme`),
        ]
      : []),
    ensureTextFile(path.join(repoRoot, "docs/index.md"), readWakeflowFile(context.templateRoot, "templates/window-support/design/docs/index.md"), `${prefix} docs index`),
    ensureTextFile(path.join(repoRoot, "docs/current/README.md"), readWakeflowFile(context.templateRoot, "templates/window-support/design/docs/current/README.md"), `${prefix} current readme`),
    ensureTextFile(
      path.join(repoRoot, "docs/design-window-operating-policy.md"),
      readWakeflowFile(context.templateRoot, "templates/window-support/design/docs/design-window-operating-policy.md"),
      `${prefix} operating policy`,
    ),
    ensureTextFile(
      path.join(repoRoot, "docs/workspace-alignment-checklist.md"),
      readWakeflowFile(context.templateRoot, "templates/window-support/design/docs/workspace-alignment-checklist.md"),
      `${prefix} alignment checklist`,
    ),
    syncRelativeFile(context.templateRoot, repoRoot, "templates/original-plan-template.md", `${prefix} original plan template`),
    syncRelativeFile(context.templateRoot, repoRoot, "templates/requirement-design-template.md", `${prefix} requirement design template`),
    syncRelativeFile(context.templateRoot, repoRoot, "templates/workspace-signal-template.md", `${prefix} workspace signal template`),
    syncRelativeFile(context.templateRoot, repoRoot, "templates/workspace-handoff-template.md", `${prefix} workspace handoff template`),
    ...syncWindowSupportFiles(context, repoRoot, "design", designDefaultSkillPaths, prefix),
  ];
  return files;
}

function syncTestSupportFiles(context, repoRoot, mode) {
  const prefix = mode === "internal" ? "internal test" : "external test";
  const files = [
    ...(mode === "internal"
      ? [
          ensureTextFile(path.join(repoRoot, ".gitignore"), readWakeflowFile(context.templateRoot, "templates/window-support/testing/.gitignore"), `${prefix} gitignore`),
          ensureTextFile(path.join(repoRoot, hostProfile.memoryFile), readWakeflowFile(context.templateRoot, `templates/window-support/testing/${hostProfile.memoryFile}`), `${prefix} agents`),
          ensureTextFile(path.join(repoRoot, "README.md"), internalTestingReadme(context.config), `${prefix} readme`),
        ]
      : []),
    ensureTextFile(path.join(repoRoot, "docs/README.md"), readWakeflowFile(context.templateRoot, "templates/window-support/testing/docs/README.md"), `${prefix} docs readme`),
    ensureTextFile(path.join(repoRoot, "docs/current/README.md"), readWakeflowFile(context.templateRoot, "templates/window-support/testing/docs/current/README.md"), `${prefix} current readme`),
    ensureTextFile(path.join(repoRoot, "docs/current/test-window-alignment.md"), readWakeflowFile(context.templateRoot, "templates/window-support/testing/docs/current/test-window-alignment.md"), `${prefix} test alignment`),
    ensureTextFile(path.join(repoRoot, "config/README.md"), readWakeflowFile(context.templateRoot, "templates/window-support/testing/config/README.md"), `${prefix} config readme`),
    ensureTextFile(path.join(repoRoot, "config/defaults.json"), readWakeflowFile(context.templateRoot, "templates/window-support/testing/config/defaults.json"), `${prefix} default config`),
    ensureTextFile(path.join(repoRoot, "scripts/README.md"), readWakeflowFile(context.templateRoot, "templates/window-support/testing/scripts/README.md"), `${prefix} scripts readme`),
    ...syncWindowSupportFiles(context, repoRoot, "testing", testDefaultSkillPaths, prefix),
    ensureTextFile(
      path.join(repoRoot, "docs/testing-operation-policy.md"),
      readWakeflowFile(context.templateRoot, "templates/window-support/testing/docs/testing-operation-policy.md"),
      `${prefix} testing operation policy`,
    ),
    syncRelativeFile(context.templateRoot, repoRoot, "templates/test-handoff-template.md", `${prefix} test handoff template`),
  ];
  if (mode === "external") {
    files.push(ensureTextFile(path.join(repoRoot, "docs/current/test-window-alignment.md"), externalTestAlignment({ windowName: context.config.testWindow }, context.config), "external test alignment"));
  }
  return files;
}

function syncStarterLedgerFiles(context) {
  const sourceRoot = "templates/starter-workspace/workspace";
  const ledgerRoot = "templates/starter-workspace/ledger";
  const workspaceLedgerDir = path.dirname(context.ledgerPaths.workspaceRecordMapPath);
  const goalStageConfirmationDir = resolveConfigPath(
    context.wakeflowRoot,
    context.config.goalStageConfirmationDir ?? path.join(context.config.projectLedgerRoot ?? "wakeflow-ledger", "goal-stage-confirmation"),
  );
  return [
    ensureTextFile(context.ledgerPaths.workspaceIndexPath, configuredStarterContent(context, `${sourceRoot}/index.md`), "active workspace index", { refreshStarter: true }),
    ensureTextFile(context.ledgerPaths.workspaceCurrentIndexPath, configuredStarterContent(context, `${sourceRoot}/current/index.md`), "active current index", { refreshStarter: true }),
    ensureTextFile(context.ledgerPaths.workspaceCurrentStatusPath, configuredStarterContent(context, `${sourceRoot}/current/workspace-current-status.md`), "active current status", { refreshStarter: true }),
    ensureTextFile(context.ledgerPaths.globalTodoPath, configuredStarterContent(context, `${sourceRoot}/current/global-todo-board.md`), "active global TODO board", { refreshStarter: true }),
    ensureTextFile(resolveConfigPath(context.wakeflowRoot, context.config.testExchangePath), configuredStarterContent(context, `${sourceRoot}/current/test-exchange.md`), "active test exchange projection", { refreshStarter: true }),
    ensureTextFile(context.ledgerPaths.workspaceRecordMapPath, configuredStarterContent(context, `${sourceRoot}/workspace-record-map.md`), "project workspace record map"),
    ensureTextFile(path.join(context.ledgerPaths.requirementDesignsDir, "README.md"), configuredStarterContent(context, `${ledgerRoot}/requirement-designs/README.md`), "requirement designs readme"),
    ensureTextFile(path.join(goalStageConfirmationDir, "README.md"), configuredStarterContent(context, `${ledgerRoot}/goal-stage-confirmation/README.md`), "goal-stage confirmation readme"),
    ensureTextFile(path.join(goalStageConfirmationDir, "process.md"), configuredStarterContent(context, `${ledgerRoot}/goal-stage-confirmation/process.md`), "goal-stage confirmation process"),
    ensureTextFile(path.join(workspaceLedgerDir, "requirement-to-wave-execution-flow.md"), configuredStarterContent(context, `${ledgerRoot}/workspace/requirement-to-wave-execution-flow.md`), "requirement to wave flow"),
    ensureTextFile(path.join(workspaceLedgerDir, "todo-window-scheduling-policy.md"), configuredStarterContent(context, `${ledgerRoot}/workspace/todo-window-scheduling-policy.md`), "TODO and window scheduling policy"),
    ensureTextFile(path.join(workspaceLedgerDir, "workspace-doc-archive-policy.md"), configuredStarterContent(context, `${ledgerRoot}/workspace/workspace-doc-archive-policy.md`), "workspace doc archive policy"),
    ensureTextFile(path.join(context.ledgerPaths.workspaceArchiveDir, "index.md"), configuredStarterContent(context, `${ledgerRoot}/workspace/archive/index.md`), "workspace archive index"),
  ];
}

function windowLedgerReadme(context, repo) {
  return `# ${repo.windowName}

This directory stores project-specific coordination records for ${repo.windowName}.

- Window responsibility: ${repo.role}
- Source repository scope: \`${repo.path}\`
- Keep source code changes in the source repository.
- Keep cross-window task records, backfills, acceptance notes, and handoff evidence here.
`;
}

function syncWindowLedgerDirs(context) {
  return normalizedRepositories(context.config)
    .filter((repo) => repo.windowName !== context.config.realProjectWindow)
    .filter((repo) => repo.mode !== "internal")
    .map((repo) => {
      const ledgerDir = windowLedgerDirFor({
        workspaceRoot: context.wakeflowRoot,
        config: context.config,
        windowName: repo.windowName,
      });
      return ensureTextFile(
        path.join(ledgerDir, "README.md"),
        windowLedgerReadme(context, repo),
        `${repo.windowName} window ledger`,
      );
    });
}

function syncTemplatesPayload(context = commandContext(), options = {}) {
  const windowFilter = options.window ?? getValue("--window");
  const all = options.all ?? (hasFlag("--all") || !windowFilter);
  const windows = [
    context.config.designWindow,
    context.config.testWindow,
  ].filter((name) => all || name === windowFilter);
  if (windows.length === 0) {
    fail(`sync-templates only supports ${context.config.designWindow} or ${context.config.testWindow}.`);
  }

  const results = [];
  for (const result of syncStarterLedgerFiles(context)) {
    results.push({ windowName: context.config.controllerWindow, mode: "active-ledger", ok: true, ...result });
  }
  for (const result of syncWindowLedgerDirs(context)) {
    results.push({ windowName: context.config.controllerWindow, mode: "window-ledger", ok: true, ...result });
  }
  for (const windowName of windows) {
    if (windowName === context.config.designWindow) {
      const repo = repoForWindow(context.config, windowName) ?? {
        windowName,
        path: context.config.internalDesignPath ?? "../Design",
        mode: "internal",
        role: "Internal requirement design workspace",
        managedAgents: false,
      };
      const repoRoot = repositoryAbsPath(context.wakeflowRoot, repo);
      if (repo.mode === "external" && (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory())) {
        results.push({ windowName, mode: repo.mode, ok: false, issue: "external design directory missing", path: repo.path });
        continue;
      }
      for (const result of syncDesignSupportFiles(context, repoRoot, repo.mode)) {
        results.push({ windowName, mode: repo.mode, ok: true, ...result });
      }
    }

    if (windowName === context.config.testWindow) {
      const repo = repoForWindow(context.config, windowName) ?? {
        windowName,
        path: context.config.internalTestPath ?? "../Test",
        mode: "internal",
        role: "Internal test coordination workspace",
        managedAgents: false,
      };
      const repoRoot = repositoryAbsPath(context.wakeflowRoot, repo);
      if (repo.mode === "external" && (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory())) {
        results.push({ windowName, mode: repo.mode, ok: false, issue: "external test directory missing", path: repo.path });
        continue;
      }
      results.push({ windowName, mode: repo.mode, ok: true, ...ensureTextFile(resolveConfigPath(context.wakeflowRoot, context.config.testExchangePath), testExchangeTemplate(), "test exchange projection") });
      for (const result of syncTestSupportFiles(context, repoRoot, repo.mode)) {
        results.push({ windowName, mode: repo.mode, ok: true, ...result });
      }
    }
  }

  return {
    ok: results.every((result) => result.ok),
    command: "sync-templates",
    wrote: write,
    results,
  };
}

function hasConfigSelection() {
  return getAllValues("--repo").length > 0 || hasFlag("--use-discovered") || hasFlag("--internal-design") || hasFlag("--internal-test");
}

function hasLocalWindowSelection() {
  return getAllValues("--thread").length > 0
    || (["replace-window", "replace-windows"].includes(command) && getAllValues("--window").length > 0);
}

function hasInitializeSelection() {
  return hasConfigSelection() || hasLocalWindowSelection();
}

function parseSpecMap(flag, fallbackKeys = []) {
  return new Map(getAllValues(flag).map((spec) => {
    if (!spec.includes("=") && fallbackKeys.length === 1) {
      return [fallbackKeys[0], spec];
    }
    return parseKeyValueSpec(spec, flag);
  }));
}

function initializedWorkspaceFootprint(context) {
  const runtimeFootprint = [];
  const configExists = existsSync(context.configPath);
  for (const [kind, configuredPath] of [
    ["workspace-index", context.config.workspaceIndexPath ?? ".wakeflow-active/index.md"],
    ["workspace-status", context.config.workspaceCurrentStatusPath ?? ".wakeflow-active/current/workspace-current-status.md"],
    ["delivery-runtime", ".wakeflow-local/wakeflow-delivery"],
  ]) {
    const absolute = path.resolve(context.wakeflowRoot, configuredPath);
    if (existsSync(absolute)) {
      runtimeFootprint.push({ kind, path: slash(path.relative(context.wakeflowRoot, absolute)) || "." });
    }
  }
  const rootMemoryFile = path.join(context.parentRoot, hostProfile.memoryFile);
  if (existsSync(rootMemoryFile)) {
    const text = readFileSync(rootMemoryFile, "utf8");
    if (text.includes(ROOT_AGENTS_START) && text.includes(ROOT_AGENTS_END)) {
      runtimeFootprint.push({ kind: "root-memory", path: slash(path.relative(context.wakeflowRoot, rootMemoryFile)) });
    }
  }
  for (const repo of normalizedRepositories(context.userConfig)) {
    const memoryFile = path.join(repositoryAbsPath(context.wakeflowRoot, repo), hostProfile.memoryFile);
    if (!existsSync(memoryFile)) continue;
    const text = readFileSync(memoryFile, "utf8");
    if (text.includes(AGENTS_START) && text.includes(AGENTS_END)) {
      runtimeFootprint.push({
        kind: "child-memory",
        path: slash(path.relative(context.wakeflowRoot, memoryFile)),
        windowName: repo.windowName,
      });
    }
  }
  if (!configExists || normalizedRepositories(context.userConfig).length === 0) {
    return runtimeFootprint;
  }
  if (runtimeFootprint.length === 0) {
    return runtimeFootprint;
  }
  return [
    { kind: "config", path: slash(path.relative(context.wakeflowRoot, context.configPath)) || "workspace.config.json" },
    ...runtimeFootprint,
  ];
}

function initializedWorkspaceResetRequested() {
  return hasFlag("--reset-initialization");
}

function assertInitializeDoesNotUseReplacementFlags() {
  if (command === "initialize" && getAllValues("--replace-window").length > 0) {
    fail("initialize no longer accepts --replace-window. Use replace-window for one existing window or replace-windows for a selected group; replacement routes validate thread ids before any write and do not refresh initialization docs.");
  }
}

function assertInitializeWriteAllowed(context) {
  // A pure local registration follow-up (thread ids only, no config/scope
  // selection, no reset) is the EXPECTED step after windows are created —
  // including the first-time setup, whose own launch plan emits
  // `initialize --thread X=<id> --write`. The footprint guard only protects
  // against re-scaffolding config/docs/scope, so never let it block thread
  // registration. Reset always runs the gate so its dedicated errors fire.
  if (!hasConfigSelection() && !initializedWorkspaceResetRequested()) return null;
  // Compute the gate in BOTH dry-run and apply so the plan a dry-run shows
  // agrees with what apply does (no green plan that then fails on --write),
  // and so a dry-run reset can preview the cleanup. Hard failures only on write.
  const footprint = initializedWorkspaceFootprint(context);
  const alreadyInitialized = footprint.length > 0;
  const resetRequested = initializedWorkspaceResetRequested();
  const reInitBlocked = alreadyInitialized && hasConfigSelection() && !resetRequested;
  if (write && reInitBlocked) {
    fail(`initialize --write found an existing Wakeflow initialization footprint (${footprint.map((item) => `${item.kind}:${item.path}`).join(", ")}). Re-run only after the user explicitly requests reset initialization, then pass --reset-initialization with explicit --repo mappings. For heavy/stale windows, use replace-window or replace-windows instead.`);
  }
  if (write && alreadyInitialized && resetRequested && hasFlag("--use-discovered")) {
    fail("reset initialization cannot use --use-discovered. Reconfirm intended work directories and pass explicit --repo Window=Path mappings so scratch/history/ledger directories are not added to Wakeflow scope.");
  }
  if (write && alreadyInitialized && resetRequested && getAllValues("--repo").length === 0) {
    fail("reset initialization requires explicit --repo Window=Path mappings when changing configuration. Do not reuse the old config or discovered directories implicitly.");
  }
  return { alreadyInitialized, resetRequested, footprint, reInitBlocked };
}

function assertReplacementWriteThreads(replacements, commandName) {
  if (!write || replacements.size === 0) return;
  const threadSpecs = parseSpecMap("--thread");
  const missingThread = [...replacements].filter((windowName) => !threadSpecs.has(windowName));
  if (missingThread.length > 0) {
    fail(`${commandName} with --write requires a new --thread Window=<realThreadId> for: ${missingThread.join(", ")}`);
  }
}

function automationStateDir(context) {
  return path.join(context.wakeflowRoot, ".wakeflow-local/wakeflow-delivery");
}

function hostRuntimeDir(context) {
  return path.join(automationStateDir(context), "hosts", hostProfile.runtime.hostDirName);
}

function threadRegistryFile(context, windowName) {
  return path.join(hostRuntimeDir(context), "thread-registry", `${slug(windowName)}.json`);
}

function findThreadRegistryFile(context, windowName) {
  const hostFile = threadRegistryFile(context, windowName);
  if (existsSync(hostFile)) return hostFile;
  if (hostProfile.runtime.legacyRegistryFallback) {
    const legacyFile = path.join(automationStateDir(context), "thread-registry", `${slug(windowName)}.json`);
    if (existsSync(legacyFile)) return legacyFile;
  }
  return hostFile;
}

function windowConfigFile(context, windowName) {
  return path.join(hostRuntimeDir(context), "window-config", `${slug(windowName)}.json`);
}

function validateThreadId(value) {
  const threadId = String(value ?? "").trim();
  const placeholders = new Set(hostProfile.handleId.placeholders);
  if (placeholders.has(threadId.toLowerCase())) {
    fail(`--thread must contain ${hostProfile.handleId.realIdRequirement}, not a placeholder.`);
  }
  if (/\s/.test(threadId)) {
    fail("--thread id must not contain whitespace.");
  }
  return threadId;
}

function validateThreadRole(value) {
  const role = String(value ?? "target").trim();
  if (!["controller", "target", "test-target", "design", "observer"].includes(role)) {
    fail(`Invalid thread role: ${role}`);
  }
  return role;
}

function defaultThreadRole(context, windowName) {
  if (windowName === context.config.controllerWindow) return "controller";
  if (windowName === context.config.designWindow) return "design";
  if (windowName === context.config.testWindow) return "test-target";
  return "target";
}

function roleTitle(context, windowName, deliveryRole, language) {
  const workspaceName = context.config.workspaceName || path.basename(context.wakeflowRoot);
  if (language === "zh") {
    if (deliveryRole === "controller") return `${windowName} 总控`;
    if (deliveryRole === "design") return `${windowName} 需求窗口`;
    if (deliveryRole === "test-target") return `${windowName} 测试窗口`;
    if (deliveryRole === "observer") return `${windowName} 观察窗口`;
    return `${windowName} 职责窗口`;
  }
  if (deliveryRole === "controller") {
    return titleWithRole({
      workspaceName,
      windowName,
      role: "Controller",
      genericWindowNames: ["controller", "totalcontrol", "total-control"],
    });
  }
  if (deliveryRole === "design") {
    return titleWithRole({
      workspaceName,
      windowName,
      role: "Design",
      genericWindowNames: ["design"],
    });
  }
  if (deliveryRole === "test-target") {
    return titleWithRole({
      workspaceName,
      windowName,
      role: "Test",
      genericWindowNames: ["test", "testing"],
    });
  }
  if (deliveryRole === "observer") return `${windowName} Observer`;
  return `${windowName} Work`;
}

function titleWithRole({ workspaceName, windowName, role, genericWindowNames }) {
  const normalizedWindow = normalizeTitleToken(windowName);
  const normalizedRole = normalizeTitleToken(role);
  const normalizedWorkspace = normalizeTitleToken(workspaceName);
  const isGeneric = genericWindowNames.includes(normalizedWindow);
  if (isGeneric && normalizedWorkspace && normalizedWorkspace !== normalizedWindow) {
    return `${workspaceName} ${role}`;
  }
  if (normalizedWindow === normalizedRole || normalizedWindow.endsWith(normalizedRole)) {
    return windowName;
  }
  return `${windowName} ${role}`;
}

function normalizeTitleToken(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function uniqueReadRefs(...refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    if (!ref || seen.has(ref)) return false;
    seen.add(ref);
    return true;
  });
}

function formatReadRefs(refs, language) {
  if (refs.length <= 1) return refs[0] ?? "";
  if (language === "zh") {
    return `${refs.slice(0, -1).join("、")} 和 ${refs.at(-1)}`;
  }
  if (refs.length === 2) return `${refs[0]} and ${refs[1]}`;
  return `${refs.slice(0, -1).join(", ")}, and ${refs.at(-1)}`;
}

function localWindowPrompt(context, windowName, deliveryRole, language) {
  const localRoot = localWindowRoot(context, windowName);
  const parentAgents = relativePathFrom(localRoot.absolutePath, path.join(context.parentRoot, hostProfile.memoryFile));
  const activeIndex = relativePathFrom(localRoot.absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceIndexPath ?? ".wakeflow-active/index.md"));
  const activeStatus = relativePathFrom(localRoot.absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceCurrentStatusPath ?? ".wakeflow-active/current/workspace-current-status.md"));
  const ownAgents = path.join(localRoot.absolutePath, hostProfile.memoryFile);
  const ownAgentsRef = existsSync(ownAgents) ? hostProfile.memoryFile : parentAgents;
  const title = roleTitle(context, windowName, deliveryRole, language);
  const readRefs = formatReadRefs(uniqueReadRefs(ownAgentsRef, parentAgents, activeIndex, activeStatus), language);
  if (language === "zh") {
    return [
      `${title}：初始化入口同步，不是任务投递。`,
      `责任目录：${localRoot.absolutePath}`,
      `窗口职责：${localRoot.role}`,
      "",
      `先读取 ${readRefs}。`,
      "如果当前没有 active demand、state root、task package 或 dispatch packet，请报告“入口同步完成，等待总控任务”后停止。这是初始化后的正常 ready 状态，不是失败。",
      "只有收到包含 currentWindow、taskId、stateRoot 的 Wakeflow task wakeup / delivery prompt 时，才执行本窗口任务。",
      hostProfile.texts.subagentAssist.zh,
      "如果窗口身份、仓库路径、state root 或 Wakeflow 配置不一致，停止并回报总控。",
    ].join("\n");
  }
  return [
    `${title}: initialization entry sync, not a task delivery.`,
    `Working directory: ${localRoot.absolutePath}`,
    `Responsibility: ${localRoot.role}`,
    "",
    `First read ${readRefs}.`,
    "If there is no active demand, state root, task package, or dispatch packet, report \"entry sync complete; waiting for controller task\" and stop. This is the normal ready state after initialization, not a failure.",
    "Execute window work only after receiving a Wakeflow task wakeup / delivery prompt containing currentWindow, taskId, and stateRoot.",
    hostProfile.texts.subagentAssist.en,
    "If the window identity, repository path, state root, or Wakeflow configuration is inconsistent, stop and report to the controller.",
  ].join("\n");
}

function windowLaunchEntries(context, options = {}) {
  const includeRealProject = options.includeRealProject ?? hasFlag("--include-real-project");
  const excluded = options.excluded ?? excludedWindows();
  const replacements = options.replacements ?? replacementWindows();
  const language = options.language ?? interfaceLanguage(context);
  const entries = [{
    windowName: context.config.controllerWindow,
    deliveryRole: "controller",
  }];
  for (const repo of normalizedRepositories(context.config)) {
    if (!includeRealProject && repo.windowName === context.config.realProjectWindow) continue;
    entries.push({
      windowName: repo.windowName,
      deliveryRole: defaultThreadRole(context, repo.windowName),
    });
  }
  const seen = new Set();
  return entries
    .filter((entry) => entry.windowName && !excluded.has(entry.windowName))
    .filter((entry) => replacements.size === 0 || replacements.has(entry.windowName))
    .filter((entry) => {
      if (seen.has(entry.windowName)) return false;
      seen.add(entry.windowName);
      return true;
    })
    .map((entry) => {
      const localRoot = localWindowRoot(context, entry.windowName);
      return {
        windowName: entry.windowName,
        deliveryRole: entry.deliveryRole,
        cwd: localRoot.absolutePath,
        responsibilityRoot: localRoot.absolutePath,
        repositoryPath: localRoot.path || ".",
        responsibility: localRoot.role,
        displayTitle: roleTitle(context, entry.windowName, entry.deliveryRole, language),
        promptPurpose: "initialization-entry-sync",
        createThreadPrompt: localWindowPrompt(context, entry.windowName, entry.deliveryRole, language),
      };
    });
}

function windowLaunchPlanPayload(context, entries, options = {}) {
  const replacements = options.replacements ?? replacementWindows();
  const language = options.language ?? interfaceLanguage(context);
  const registrationArgvCommand = options.registrationCommand
    ?? (replacements.size > 0 ? "replace-windows" : "initialize");
  const registrationCommand = `wakeflow-setup ${registrationArgvCommand}`;
  return {
    ok: true,
    command: "window-launch-plan",
    ...hostProfile.launch.planFlags,
    language,
    replacementMode: replacements.size > 0,
    replaceWindows: [...replacements],
    threadIdStorage: `.wakeflow-local/wakeflow-delivery/hosts/${hostProfile.runtime.hostDirName}/thread-registry/<window>.json`,
    trackedDocsContainThreadIds: false,
    hostWorkflow: hostProfile.launch.workflowSteps(language),
    windows: entries.map((entry) => ({
      windowName: entry.windowName,
      deliveryRole: entry.deliveryRole,
      cwd: entry.cwd,
      responsibilityRoot: entry.responsibilityRoot,
      repositoryPath: entry.repositoryPath,
      displayTitle: entry.displayTitle,
      promptPurpose: entry.promptPurpose,
      titleReset: hostProfile.launch.titleReset(entry.displayTitle),
      ...(typeof hostProfile.launch.entryExtras === "function" ? hostProfile.launch.entryExtras(entry, context) : {}),
      localRegistration: {
        required: true,
        command: registrationCommand,
        threadIdAuthority: `.wakeflow-local/wakeflow-delivery/hosts/${hostProfile.runtime.hostDirName}/thread-registry/${slug(entry.windowName)}.json`,
        derivedStatusView: `.wakeflow-local/wakeflow-delivery/hosts/${hostProfile.runtime.hostDirName}/window-config/${slug(entry.windowName)}.json`,
        trackedDocsContainThreadIds: false,
        argvTemplate: [
          registrationArgvCommand,
          "--root",
          context.wakeflowRoot,
          ...(replacements.size > 0 ? ["--window", entry.windowName] : []),
          "--thread",
          `${entry.windowName}=<createdThreadId>`,
          "--write",
          "--json",
        ],
      },
      createThreadPrompt: entry.createThreadPrompt,
    })),
  };
}

function assertReplacementLaunchEntries(replacements, launchEntries, commandName) {
  if (replacements.size === 0) {
    fail(`${commandName} requires at least one --window <WindowName>.`);
  }
  const available = new Set(launchEntries.map((entry) => entry.windowName));
  const missing = [...replacements].filter((windowName) => !available.has(windowName));
  if (missing.length > 0) {
    fail(`${commandName} requested window(s) not present in the current launch plan: ${missing.join(", ")}. Check workspace.config.json, or pass --include-real-project when replacing the real-project window.`);
  }
}

function configuredWindowSet(config) {
  return new Set([
    config.controllerWindow,
    ...normalizedRepositories(config).map((repo) => repo.windowName),
  ].filter(Boolean));
}

function resetInitializationCleanupPayload(previousContext, nextContext, gate) {
  const resetRequested = Boolean(gate?.resetRequested);
  if (!resetRequested) {
    return {
      ok: true,
      command: "reset-initialization-cleanup",
      skipped: true,
      wrote: false,
      reason: "reset initialization was not requested",
      staleWindows: [],
      results: [],
    };
  }

  const nextWindows = configuredWindowSet(nextContext.config);
  const previousRepos = normalizedRepositories(previousContext.config);
  const staleRepos = previousRepos.filter((repo) => !nextWindows.has(repo.windowName));
  const staleWindows = [...configuredWindowSet(previousContext.config)].filter((windowName) => !nextWindows.has(windowName));
  const results = [];

  for (const repo of staleRepos) {
    const repoRoot = repositoryAbsPath(previousContext.wakeflowRoot, repo);
    const agentsPath = path.join(repoRoot, hostProfile.memoryFile);
    if (!existsSync(agentsPath)) {
      results.push({
        kind: "memory-file",
        windowName: repo.windowName,
        path: slash(path.relative(previousContext.wakeflowRoot, agentsPath)),
        changed: false,
        reason: "missing",
      });
      continue;
    }
    const existing = readFileSync(agentsPath, "utf8");
    const next = removeScopeBlock(existing);
    const changed = next !== existing.trim();
    if (write && changed) {
      writeFileSync(agentsPath, `${next.trimEnd()}\n`);
    }
    results.push({
      kind: "memory-file",
      windowName: repo.windowName,
      path: slash(path.relative(previousContext.wakeflowRoot, agentsPath)),
      changed,
      wrote: write && changed,
      cleanup: "removed Wakeflow managed access card only",
    });
  }

  for (const windowName of staleWindows) {
    const cleanupTargets = [
      ["thread-registry", threadRegistryFile(previousContext, windowName)],
      ["window-config", windowConfigFile(previousContext, windowName)],
    ];
    // Codex-style hosts keep a legacy flat registry that findThreadRegistryFile
    // still falls back to; a reset that drops a window must clear it too, or a
    // stale thread id survives the reset on migrated workspaces.
    if (hostProfile.runtime.legacyRegistryFallback) {
      cleanupTargets.push([
        "thread-registry-legacy",
        path.join(automationStateDir(previousContext), "thread-registry", `${slug(windowName)}.json`),
      ]);
    }
    for (const [kind, file] of cleanupTargets) {
      const existed = existsSync(file);
      if (write && existed) rmSync(file, { force: true });
      results.push({
        kind,
        windowName,
        path: slash(path.relative(previousContext.wakeflowRoot, file)),
        changed: existed,
        wrote: write && existed,
      });
    }
  }

  return {
    ok: true,
    command: "reset-initialization-cleanup",
    resetRequested: true,
    wrote: write,
    previousFootprint: gate?.footprint ?? [],
    staleWindows,
    results,
  };
}

function localWindowRoot(context, windowName) {
  if (windowName === context.config.controllerWindow) {
    return {
      path: ".",
      absolutePath: context.wakeflowRoot,
      role: "Wakeflow runtime controller",
    };
  }
  const repo = normalizedRepositories(context.config).find((item) => item.windowName === windowName);
  if (!repo) {
    return {
      path: "",
      absolutePath: context.wakeflowRoot,
      role: "Unconfigured window; confirm workspace.config.json before dispatch.",
    };
  }
  return {
    path: repo.path,
    absolutePath: repositoryAbsPath(context.wakeflowRoot, repo),
    role: repo.role,
  };
}

function buildLocalWindowConfig(context, descriptor) {
  const windowName = descriptor.windowName;
  const { path: repoPath, role } = localWindowRoot(context, windowName);
  const dispatchWindows = new Set([
    ...(Array.isArray(context.config.dispatchWindows) ? context.config.dispatchWindows : []),
    ...(Array.isArray(context.config.requiredDispatchWindows) ? context.config.requiredDispatchWindows : []),
    context.config.controllerWindow,
  ].filter(Boolean));
  const dispatchable = ["controller", "target", "test-target"].includes(descriptor.deliveryRole)
    && (dispatchWindows.size === 0 || dispatchWindows.has(windowName) || descriptor.threadRegistered);
  return {
    kind: hostProfile.kinds.windowDispatchConfig,
    version: 1,
    windowName,
    repositoryPath: repoPath || undefined,
    responsibility: role,
    dispatchable,
    threadRegistered: descriptor.threadRegistered,
    threadRegistryFile: slash(path.relative(automationStateDir(context), threadRegistryFile(context, windowName))),
    cwd: descriptor.cwd || repoPath || undefined,
    responsibilityRoot: descriptor.responsibilityRoot || descriptor.cwd || repoPath || undefined,
    deliveryRole: descriptor.deliveryRole,
    delivery: {
      transport: "direct-thread",
      requireThread: true,
      missingThread: "fail-closed",
      readbackRequired: true,
    },
    automation: {
      mode: "manual-or-unattended",
      continuousWhenEnabled: true,
      keepLive: "required-when-automation-enabled",
    },
    result: {
      returnRoute: "controller",
      resultEnvelopeRequired: true,
    },
    generatedAt: new Date().toISOString(),
  };
}

function localWindowRegistrationPayload(context, options = {}) {
  const threadSpecs = parseSpecMap("--thread");
  const replacements = options.replacements ?? replacementWindows();
  assertReplacementWriteThreads(replacements, "replacement window registration");
  const windowSpecs = new Set([
    ...(options.windows ?? []).map((item) => item.windowName),
    ...threadSpecs.keys(),
  ]);
  const results = [];

  for (const windowName of [...windowSpecs].sort()) {
    const localRoot = localWindowRoot(context, windowName);
    const registryPath = threadRegistryFile(context, windowName);
    const existingRegistrationPath = findThreadRegistryFile(context, windowName);
    const existingRegistration = existsSync(existingRegistrationPath) ? readJson(existingRegistrationPath) : null;
    const hasThread = threadSpecs.has(windowName);
    const existingThreadRegistered = Boolean(existingRegistration?.threadId);
    const threadRegistered = hasThread || existingThreadRegistered;
    const deliveryRole = validateThreadRole(defaultThreadRole(context, windowName));
    const cwd = localRoot.absolutePath;
    const responsibilityRoot = localRoot.absolutePath;
    const registration = {
      kind: hostProfile.kinds.windowRegistration,
      version: 2,
      windowName,
      ...(hasThread ? { threadId: validateThreadId(threadSpecs.get(windowName)) } : {}),
      registeredAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
    };
    const windowConfig = buildLocalWindowConfig(context, {
      windowName,
      deliveryRole,
      cwd,
      responsibilityRoot,
      threadRegistered,
    });
    const configPath = windowConfigFile(context, windowName);
    let replacedExistingThread = false;
    if (hasThread && existsSync(existingRegistrationPath)) {
      const previous = readJson(existingRegistrationPath);
      replacedExistingThread = Boolean(previous.threadId && previous.threadId !== registration.threadId);
    }

    if (write) {
      if (hasThread) writeJson(registryPath, registration);
      writeJson(configPath, windowConfig);
    }

    results.push({
      windowName,
      deliveryRole,
      repositoryPath: localRoot.path || ".",
      registryFile: threadRegistered ? slash(path.relative(context.wakeflowRoot, registryPath)) : null,
      windowConfigFile: slash(path.relative(context.wakeflowRoot, configPath)),
      threadRegistered,
      threadIdRedacted: threadRegistered,
      replaceRequested: replacements.has(windowName),
      replacedExistingThread,
      wroteRegistry: write && hasThread,
      wroteWindowConfig: write,
    });
  }

  return {
    ok: true,
    command: "local-window-runtime",
    wrote: write,
    results,
  };
}

function initializePayload() {
  const context = commandContext();
  assertInitializeDoesNotUseReplacementFlags();
  const writeGate = assertInitializeWriteAllowed(context);
  const discovered = redactAbsolutePaths(discoverSiblingRepositories(context));
  const discovery = {
    workspaceName: context.config.workspaceName,
    wakeflowRoot: context.wakeflowRoot,
    parentRoot: context.parentRoot,
    discoveredRepositories: discovered,
    configuredRepositories: normalizedRepositories(context.config).map((repo) => ({
      windowName: repo.windowName,
      path: repo.path,
      role: repo.role,
      mode: repo.mode,
      managedAgents: repo.managedAgents,
    })),
    agentSelectionProtocol: agentSelectionProtocol(),
    setupQuestions: statusPayload().setupQuestions,
  };

  if (write && writeGate?.resetRequested && !hasInitializeSelection()) {
    fail("reset initialization requires explicit --repo mappings plus Design/Test mode confirmation; use replace-window or replace-windows for window-only recreation.");
  }

  // Dry-run honesty: if applying THIS selection would be blocked by the
  // footprint guard, say so now instead of returning a green plan that fails
  // on --write. The agent should switch to replace-window(s) or reset.
  if (!write && writeGate?.reInitBlocked) {
    return {
      ok: true,
      command: "initialize",
      mode: "blocked-already-initialized",
      wrote: false,
      alreadyInitialized: true,
      initializationFootprint: writeGate.footprint,
      discovery,
      nextAction: "This workspace is already initialized. Do not re-run initialize. Use replace-windows (wakeflow_replace_windows; pass a single window name for one) for heavy or stale windows, or only on explicit user request re-run with --reset-initialization and explicit --repo mappings.",
    };
  }

  if (!hasInitializeSelection()) {
    return {
      ok: true,
      command: "initialize",
      mode: "discovery",
      wrote: false,
      requiresUserSelection: true,
      discovery,
      nextAction: "Agent must judge whether the workspace is clean. If clean, rerun initialize with explicit repositories. If messy, ask the user which windows to manage before writing.",
    };
  }

  const replacements = new Set();

  const configured = hasConfigSelection()
    ? configurePayload(context)
    : {
        ok: true,
        command: "configure",
        skipped: true,
        wrote: false,
        configPath: context.configPath,
        nextConfig: context.config,
      };
  const installContext = contextWithConfig(context, configured.nextConfig);
  const language = interfaceLanguage(installContext);
  const launchEntries = windowLaunchEntries(installContext, {
    includeRealProject: hasFlag("--include-real-project"),
    replacements,
    language,
  });
  const windowLaunchPlan = windowLaunchPlanPayload(installContext, launchEntries, {
    replacements,
    language,
  });
  const gitignore = syncGitignorePayload(installContext);
  const templates = syncTemplatesPayload(installContext, { all: true });
  const rootAgents = syncRootAgentsPayload(installContext);
  const childAgents = writeAgentsPayload(installContext, {
    all: true,
    includeUnmanaged: false,
    includeRealProject: hasFlag("--include-real-project"),
  });
  const localWindows = localWindowRegistrationPayload(installContext, { windows: launchEntries, replacements });
  const accessProfiles = accessProfilesPayload(installContext, {
    includeRealProject: hasFlag("--include-real-project"),
  });
  const resetCleanup = resetInitializationCleanupPayload(context, installContext, writeGate);

  const okItems = write
    ? [configured, resetCleanup, gitignore, templates, rootAgents, childAgents, localWindows, accessProfiles]
    : [configured, gitignore, templates, rootAgents, childAgents, localWindows];
  const ok = okItems
    .every((item) => item.ok !== false);

  return {
    ok,
    command: "initialize",
    mode: write ? "apply" : "plan",
    wrote: write,
    discovery,
    steps: {
      configure: configured,
      resetInitializationCleanup: resetCleanup,
      gitignore,
      syncTemplates: templates,
      syncRootAgents: rootAgents,
      writeAgents: childAgents,
      windowLaunchPlan,
      localWindows,
      accessProfiles,
    },
    nextAction: write
      ? hostProfile.texts.initializeApplyNextAction
      : "Dry-run only. Rerun with --write after confirming repositories, Design/Test mode, excluded windows, and optional thread registrations.",
  };
}

function replaceWindowsPayload(options = {}) {
  const context = commandContext();
  const commandName = options.single ? "replace-window" : "replace-windows";
  if (!existsSync(context.configPath)) {
    fail(`${commandName} requires an initialized workspace (workspace.config.json not found). Run initialize first; replacement only recreates an existing window.`);
  }
  const replacements = replacementWindows();
  if (options.single && replacements.size !== 1) {
    fail("replace-window requires exactly one --window <WindowName>.");
  }
  assertReplacementWriteThreads(replacements, commandName);
  const language = interfaceLanguage(context);
  const launchEntries = windowLaunchEntries(context, {
    includeRealProject: hasFlag("--include-real-project"),
    replacements,
    language,
  });
  assertReplacementLaunchEntries(replacements, launchEntries, commandName);
  const windowLaunchPlan = windowLaunchPlanPayload(context, launchEntries, {
    replacements,
    language,
    registrationCommand: commandName,
  });
  const localWindows = localWindowRegistrationPayload(context, { windows: launchEntries, replacements });
  const ok = [windowLaunchPlan, localWindows].every((item) => item.ok !== false);

  return {
    ok,
    command: commandName,
    mode: write ? "apply" : "plan",
    wrote: write,
    configuredRepositories: normalizedRepositories(context.config).map((repo) => ({
      windowName: repo.windowName,
      path: repo.path,
      role: repo.role,
      mode: repo.mode,
      managedAgents: repo.managedAgents,
    })),
    steps: {
      windowLaunchPlan,
      localWindows,
    },
    nextAction: write
      ? "Replacement thread registry and derived local window config were updated only for the selected windows. Do not treat this as workspace initialization or task delivery."
      : "Create only the returned replacement windows, then register each real thread id with the returned localRegistration argvTemplate. Do not rewrite unrelated window registrations.",
  };
}

function help() {
  return {
    ok: true,
    commands: {
      initialize: "One workflow for discovery, config generation, AGENTS install, Design/Test setup, and local window/thread runtime registration.",
      "replace-window": "Regenerate one existing responsibility-window launch prompt and replace only its local thread registry/window-config records; preferred for a heavy/stale single window.",
      "replace-windows": "Regenerate selected responsibility-window launch prompts and replace only their local thread registry/window-config records; does not refresh workspace initialization docs.",
      discover: "List sibling repository candidates under the parent workspace.",
      status: "Show configured repositories, discovered siblings, and scope issues.",
      configure: "Write workspace.config.json after user-confirmed --repo mappings.",
      prompts: `Print child-window prompts for confirming scope and refreshing ${hostProfile.memoryFile}.`,
      "sync-root-agents": `Unpack the control ${hostProfile.memoryFile} into the parent workspace ${hostProfile.memoryFile} so ${hostProfile.hostName} auto-loads total-control rules at the outer workspace root.`,
      "sync-gitignore": "Ensure only Wakeflow runtime entries .wakeflow-active/ and .wakeflow-local/ are ignored in the target workspace .gitignore; do not add product repositories, Design/Test, ledger directories, or generic local noise.",
      "write-agents": `Append or refresh managed access-card blocks in configured child ${hostProfile.memoryFile} files.`,
      "access-profiles": "Print a read-only ChildWindowAccessProfile view from workspace.config plus child AGENTS managed blocks.",
      "sync-templates": "Create missing internal Design/Test templates or minimal external alignment templates.",
      "ledger-paths": "Show project ledger directories for configured windows.",
    },
    examples: [
      "node scripts/wakeflow-setup.mjs initialize --json",
      "node scripts/wakeflow-setup.mjs initialize --repo AppWindow=../MyApp --internal-design --internal-test --write --json  # fresh workspace only",
      "node scripts/wakeflow-setup.mjs initialize --reset-initialization --repo AppWindow=../MyApp --repo ServiceWindow=../MyService --internal-design --internal-test --write --json",
      "node scripts/wakeflow-setup.mjs replace-window --window AppWindow --thread AppWindow=<newRealThreadId> --write --json",
      "node scripts/wakeflow-setup.mjs replace-windows --window AppWindow --thread AppWindow=<newRealThreadId> --write --json",
      "node scripts/wakeflow-setup.mjs initialize --use-discovered --thread Wakeflow=<realThreadId> --write --json  # fresh workspace only after confirming all discovered directories",
      "node scripts/wakeflow-setup.mjs discover --json",
      "node scripts/wakeflow-setup.mjs configure --repo AppWindow=../MyApp --repo ServiceWindow=../MyService --write",
      "node scripts/wakeflow-setup.mjs prompts --window AppWindow",
      "node scripts/wakeflow-setup.mjs sync-root-agents --write",
      "node scripts/wakeflow-setup.mjs write-agents --all --write",
      "node scripts/wakeflow-setup.mjs access-profiles --json",
      "node scripts/wakeflow-setup.mjs ledger-paths --json",
      "node scripts/wakeflow-setup.mjs sync-gitignore --write --json",
      "node scripts/wakeflow-setup.mjs sync-templates --all --write",
    ],
  };
}

function main() {
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      printResult(help());
      break;
    case "initialize":
      printResult(initializePayload());
      break;
    case "replace-window":
      printResult(replaceWindowsPayload({ single: true }));
      break;
    case "replace-windows":
      printResult(replaceWindowsPayload());
      break;
    case "discover": {
      const context = commandContext();
      const discovered = redactAbsolutePaths(discoverSiblingRepositories(context));
      printResult({
        ok: true,
        command: "discover",
        workspaceName: context.config.workspaceName,
        wakeflowRoot: context.wakeflowRoot,
        parentRoot: context.parentRoot,
        discoveredRepositories: discovered,
        agentSelectionProtocol: agentSelectionProtocol(),
      });
      break;
    }
    case "status":
      printResult(statusPayload());
      break;
    case "configure":
      printResult(configurePayload());
      break;
    case "prompts":
      printResult(promptsPayload());
      break;
    case "write-agents":
      printResult(writeAgentsPayload());
      break;
    case "access-profiles":
      printResult(accessProfilesPayload());
      break;
    case "sync-root-agents":
      printResult(syncRootAgentsPayload());
      break;
    case "sync-gitignore":
      printResult(syncGitignorePayload());
      break;
    case "ledger-paths": {
      const context = commandContext();
      const repositories = normalizedRepositories(context.config)
        .filter((repo) => repo.windowName !== context.config.realProjectWindow)
        .map((repo) => {
          const ledgerDir = windowLedgerDirFor({
            workspaceRoot: context.wakeflowRoot,
            config: context.config,
            windowName: repo.windowName,
          });
          return {
            windowName: repo.windowName,
            repositoryPath: repo.path,
            ledgerPath: relativeFromWakeflow(context.wakeflowRoot, ledgerDir),
            exampleDocument: `${relativeFromWakeflow(context.wakeflowRoot, ledgerDir)}/example-task-YYYY-MM-DD.md`,
          };
        });
      printResult({
        ok: true,
        command: "ledger-paths",
        projectLedgerRoot: relativeFromWakeflow(context.wakeflowRoot, context.ledgerPaths.projectLedgerRoot),
        windowLedgerRoot: relativeFromWakeflow(context.wakeflowRoot, context.ledgerPaths.windowLedgerRoot),
        repositories,
      });
      break;
    }
    case "sync-templates":
      printResult(syncTemplatesPayload());
      break;
    default:
      fail(`Unknown install command: ${command}`);
  }
}

try {
  main();
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
