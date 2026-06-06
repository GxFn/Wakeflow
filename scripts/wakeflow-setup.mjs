#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadWorkspaceConfig,
  readWorkspaceConfig,
  resolveConfigPath,
  windowLedgerDirFor,
  workspaceLedgerPaths,
  workspaceConfigPath,
} from "./lib/wakeflow-config.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultControlRoot = path.dirname(path.dirname(scriptPath));
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] ?? "help";
const args = rawArgs.slice(1);
const json = args.includes("--json");
const write = args.includes("--write");

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
  const wakeflowRoot = resolveMaybeRelative(defaultControlRoot, getValue("--root", "."));
  const config = loadWorkspaceConfig({ workspaceRoot: wakeflowRoot, args });
  const userConfig = readWorkspaceConfig({ workspaceRoot: wakeflowRoot, args });
  const configPath = workspaceConfigPath({ workspaceRoot: wakeflowRoot, args });
  const parentRoot = resolveMaybeRelative(wakeflowRoot, getValue("--parent", config.workspaceRoot ?? ".."));
  const ledgerPaths = workspaceLedgerPaths({ workspaceRoot: wakeflowRoot, args, config });
  return { wakeflowRoot, config, userConfig, configPath, parentRoot, ledgerPaths };
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
  const ignore = new Set([
    wakeflowBasename,
    path.basename(resolveMaybeRelative(wakeflowRoot, config.projectLedgerRoot ?? "../workspace-ledger")),
    ".git",
    ".workspace-local",
    ".workspace-active",
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
        hasAgents: existsSync(path.join(absolutePath, "AGENTS.md")),
        hasPackageJson: existsSync(path.join(absolutePath, "package.json")),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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
      hasAgents: existsSync(path.join(absolutePath, "AGENTS.md")),
      withinParent: isInside(absolutePath, context.parentRoot),
      mode: repo.mode,
    };
  });
  const discovered = discoverSiblingRepositories(context).map(({ absolutePath, ...item }) => item);
  const missing = configuredRepositories.filter((repo) => !repo.exists);
  const outsideParent = configuredRepositories.filter((repo) => !repo.withinParent);
  return {
    ok: missing.length === 0 || context.config.allowMissingRepos === true,
    wakeflowRoot: context.wakeflowRoot,
    parentRoot: context.parentRoot,
    configPath: context.configPath,
    workspaceName: context.config.workspaceName,
    wakeflowRepoDir: context.config.wakeflowRepoDir,
    configuredRepositories: configuredRepositories.map(({ absolutePath, ...repo }) => repo),
    discoveredRepositories: discovered,
    missingConfiguredRepositories: missing.map((repo) => repo.windowName),
    outsideParentRepositories: outsideParent.map((repo) => repo.windowName),
    setupQuestions: [
      {
        windowName: context.config.designWindow,
        question: "Do you already have a requirement-design directory or repository? If yes, configure it as external; if no, use the internal workspace design board.",
        internalCommand: "node scripts/wakeflow-setup.mjs configure --internal-design --write",
        externalCommand: `node scripts/wakeflow-setup.mjs configure --repo ${context.config.designWindow}=../YourDesignRepo --write`,
      },
      {
        windowName: context.config.testWindow,
        question: "Do you already have a real-test directory or repository? If yes, configure it as external; if no, use the internal workspace test exchange.",
        internalCommand: "node scripts/wakeflow-setup.mjs configure --internal-test --write",
        externalCommand: `node scripts/wakeflow-setup.mjs configure --repo ${context.config.testWindow}=../YourTestRepo --write`,
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

function parseRepoSpecs(context) {
  const roleOverrides = new Map(getAllValues("--role").map((spec) => parseKeyValueSpec(spec, "--role")));
  const repoSpecs = getAllValues("--repo");
  const internalOnly = hasFlag("--internal-design") || hasFlag("--internal-test");
  if (repoSpecs.length === 0 && !hasFlag("--use-discovered") && !internalOnly) {
    fail("configure requires at least one --repo WindowName=../RepositoryPath, or --use-discovered for a dry-run proposal.");
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
    });
  }

  return discoverSiblingRepositories(context).map((repo) => ({
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
  let designWindow = requestedDesignWindow ?? context.config.designWindow;
  let testWindow = requestedTestWindow ?? context.config.testWindow;
  let realProjectWindow = requestedRealProjectWindow ?? context.config.realProjectWindow;
  const previousByWindow = new Map(normalizedRepositories(context.config).map((repo) => [repo.windowName, repo]));
  const repositories = explicitRepositories.length > 0
    ? [...explicitRepositories]
    : normalizedRepositories(context.config).filter((repo) => ![designWindow, testWindow].includes(repo.windowName));

  if (!explicitWindows.has(designWindow)) {
    const previous = previousByWindow.get(designWindow);
    repositories.push(hasFlag("--internal-design") || !previous
      ? {
          windowName: designWindow,
          path: context.config.internalDesignPath ?? "../workspace-ledger/design",
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
          path: context.config.internalTestPath ?? "../workspace-ledger/testing",
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
  const repositoryRoles = { ...context.config.repositoryRoles };
  for (const repo of repositories) {
    repositoryRoles[repo.windowName] = repo.role;
  }
  const names = repositories.map((repo) => repo.windowName);
  const designRepo = repositories.find((repo) => repo.windowName === designWindow);
  const dispatchWindows = names.filter((name) => name !== designWindow && name !== realProjectWindow);
  const repoNames = names.filter((name) => ![designWindow, testWindow, realProjectWindow].includes(name));
  const protectedWorkspacePrefixes = repositories
    .map((repo) => repo.path)
    .filter((repoPath) => !repoPath.startsWith("../") && repoPath !== ".")
    .map((repoPath) => `${repoPath.replace(/\/+$/, "")}/`);
  const nextConfig = {
    ...context.userConfig,
    workspaceName,
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
    internalDesignPath: context.config.internalDesignPath,
    internalTestPath: context.config.internalTestPath,
    designHandoffBoard: designRepo?.mode === "external"
      ? `${designRepo.path.replace(/\/+$/, "")}/docs/current/workspace-handoff-board.md`
      : context.config.designHandoffBoard,
    testExchangePath: context.config.testExchangePath,
    dispatchWindows,
    requiredDispatchWindows: names,
    repoNames,
    protectedWorkspacePrefixes,
    repositoryRoles,
    repositories,
  };

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

function buildChildPrompt(context, repo) {
  const absolutePath = repositoryAbsPath(context.wakeflowRoot, repo);
  const relativeScript = relativeCommandPath(absolutePath, path.join(context.wakeflowRoot, "scripts/wakeflow-setup.mjs"));
  const wakeflowPath = slash(path.relative(absolutePath, context.wakeflowRoot)) || ".";
  const parentAgents = relativePathFrom(absolutePath, path.join(context.parentRoot, "AGENTS.md"));
  const activeIndex = relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceIndexPath ?? ".workspace-active/workspace/index.md"));
  const activeStatus = relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceCurrentStatusPath ?? ".workspace-active/workspace/current/workspace-current-status.md"));
  return `你是 ${repo.windowName} 子窗口，目标目录是 ${repo.path}，职责是：${repo.role}。

先读取本目录 AGENTS.md、${parentAgents}、${activeIndex}、${activeStatus}；如果缺少 Wakeflow 接入卡，先确认目录范围，不要跨目录工作。

请先运行：
node ${relativeScript} status --json

确认当前目录属于 ${repo.windowName} 后，只处理本窗口职责内任务；需要写入或刷新本目录 AGENTS.md 时运行：
node ${relativeScript} write-agents --window ${repo.windowName} --write

Wakeflow 运行时相对路径：${wakeflowPath}
如目录、职责或 stateRoot / Wakeflow 配置不一致，停止并回报总控。`;
}

function promptsPayload() {
  const context = commandContext();
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
    prompts: repositories.map((repo) => ({
      windowName: repo.windowName,
      path: repo.path,
      prompt: buildChildPrompt(context, repo),
    })),
  };
}

const AGENTS_START = "<!-- wakeflow:scope:start -->";
const AGENTS_END = "<!-- wakeflow:scope:end -->";
const ROOT_AGENTS_START = "<!-- wakeflow:root-agents:start -->";
const ROOT_AGENTS_END = "<!-- wakeflow:root-agents:end -->";

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
  return `- 非测试窗口不得创建、处理或验证 ${names} delivery，除非当前计划和 delivery envelope 同时显式授权。`;
}

function scopeBlock(context, repo) {
  const absolutePath = repositoryAbsPath(context.wakeflowRoot, repo);
  const samePathRepos = repositoriesSharingPath(context, repo);
  const primaryRepo = primaryRepositoryForScope(context, repo);
  const samePathWindowNames = samePathRepos.map((item) => item.windowName);
  const hasWindowAliases = samePathWindowNames.length > 1;
  const windowNamesInline = samePathWindowNames.map((name) => `\`${name}\``).join(" / ");
  const wakeflowRelative = slash(path.relative(absolutePath, context.wakeflowRoot)) || ".";
  const parentAgents = relativePathFrom(absolutePath, path.join(context.parentRoot, "AGENTS.md"));
  const activeIndex = relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceIndexPath ?? ".workspace-active/workspace/index.md"));
  const activeStatus = relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceCurrentStatusPath ?? ".workspace-active/workspace/current/workspace-current-status.md"));
  const currentDir = relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceCurrentDir ?? ".workspace-active/workspace/current"));
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
  const designBoard = relativePathFrom(
    absolutePath,
    resolveMaybeRelative(context.wakeflowRoot, context.config.designHandoffBoard ?? ".workspace-active/workspace/current/design-handoff-board.md"),
  );
  const testExchange = relativePathFrom(
    absolutePath,
    resolveMaybeRelative(context.wakeflowRoot, context.config.testExchangePath ?? ".workspace-active/workspace/current/test-exchange.md"),
  );
  const isDesign = samePathWindowNames.includes(context.config.designWindow);
  const isTest = samePathWindowNames.includes(context.config.testWindow);
  const roleNote = [];
  if (isDesign) {
    roleNote.push(`- Design handoff board: \`${designBoard}\``);
  }
  if (isTest) {
    roleNote.push(`- Test exchange projection: \`${testExchange}\``);
  }
  const roleNoteText = roleNote.length > 0 ? `\n${roleNote.join("\n")}` : "";
  const windowNameText = hasWindowAliases
    ? `- Window name: \`${primaryRepo.windowName}\`
- Window aliases for this repository: ${windowNamesInline}`
    : `- Window name: \`${primaryRepo.windowName}\``;
  const taskTargetText = hasWindowAliases
    ? `本接入卡列出的窗口之一（${windowNamesInline}）`
    : `\`${primaryRepo.windowName}\``;
  const dispatchPacketRule = hasWindowAliases
    ? `- 本仓库只处理本接入卡列出的窗口 dispatch packet（${windowNamesInline}）；执行前必须按提示词、delivery envelope 或当前计划里的 \`currentWindow\` 分流，并返回对应窗口的 \`TargetResultEnvelope\`；不得代领、代验或处理其它窗口任务。`
    : `- 本窗口只处理 \`${primaryRepo.windowName}\` 对应的 dispatch packet，并返回 \`TargetResultEnvelope\`；不得代领、代验或处理其它窗口任务。`;
  return `${AGENTS_START}
## Workspace 接入卡

本节由 Wakeflow runtime 安装脚本维护，只记录本窗口接入坐标和自动化最小门禁。硬规则以父级 AGENTS 与本文件的“本窗口最高停止卡”为准；不要在这里重复仓库专属规则。

### 坐标

- Wakeflow runtime: \`${wakeflowRelative}\`
${windowNameText}
- Parent workspace AGENTS: \`${parentAgents}\`
- Active workspace index: \`${activeIndex}\`
- Active workspace status: \`${activeStatus}\`
- Current plan directory: \`${currentDir}\`
${windowLedgerText}${roleNoteText}

### 领取 workspace 任务时

1. 先读本文件。
2. 再读父级 \`${parentAgents}\`。
3. 再读 \`${activeIndex}\` 和 \`${activeStatus}\`。
4. 如果有当前计划、任务包或 direct-thread delivery，只按 \`${currentDir}\` 中明确分配给${taskTargetText}的内容执行。
5. 目标、范围、禁止事项、验证命令和回填字段以当前计划 / 任务包和本仓库规则为准；提示词只是唤醒入口，不是唯一任务说明。

### Direct Thread Dispatch 最小门禁

- Direct-thread delivery 是正常工作投递流水线，不改变本窗口职责，也不扩大任务范围；具体任务以 dispatch packet、当前计划和本仓库规则为准。
- Delivery prompt 只承载少量动态变量和 skill 指向；不得把提示词当成完整命令手册。状态机路线的可见变量只需要 \`currentWindow\` / \`taskId\` / \`stateRoot\` / 可选 \`dispatchGroup\`；\`controllerWindow\`、\`returnPolicy\`、\`humanContextRef\`、\`stateRevision\` 等机器字段从 state root、dispatch group 和 delivery envelope 读取。缺少 \`stateRoot\` 或变量冲突时停止回报。
${dispatchPacketRule}
- 子窗口默认不创建目标窗口下一跳 delivery；补证、重派和下一阶段都由总控 review 后决定。若 delivery \`returnRoute=controller\` 且 \`review-results\` 显示 \`DispatchGroup.returnPolicy\` 允许回调，只允许通过 \`build-controller-return\` 创建一次总控回跳 envelope，并默认回到 \`DispatchGroup.controllerWindow\` 指定的原发起总控；之后必须继续完成真实 direct-thread send、readback 和 \`record-delivery-run\`。只有存在 \`status=sent\` 且 \`readback.ok=true\` 的 \`DirectThreadDeliveryRun\`，才算真实回跳完成。完整 group snapshot 留在 controller-return envelope；可见 prompt 只显示非空异常 targets，不能把单个回填误判为整组完成。
${testWindowDeliveryBoundaryLine(context)}
- Thread id 只能写入 Wakeflow runtime 的本地 runtime；不得写入 tracked 文档、回填正文或 GitHub。

### 文档落点

- 长期跨仓库协作文档、计划、验收、扫描和边界记录写入 \`${windowLedger}\`；本仓库 \`docs/\` 只放随源码维护的产品、发布或用户文档。
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
    parentAgents: relativePathFrom(absolutePath, path.join(context.parentRoot, "AGENTS.md")),
    activeIndex: relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceIndexPath ?? ".workspace-active/workspace/index.md")),
    activeStatus: relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceCurrentStatusPath ?? ".workspace-active/workspace/current/workspace-current-status.md")),
    currentPlanDirectory: relativePathFrom(absolutePath, path.resolve(context.wakeflowRoot, context.config.workspaceCurrentDir ?? ".workspace-active/workspace/current")),
    windowLedger: relativePathFrom(absolutePath, windowLedgerDirFor({
      workspaceRoot: context.wakeflowRoot,
      config: context.config,
      windowName: repo.windowName,
    })),
    ledgerByWindow,
  };
  if (repo.windowName === context.config.designWindow) {
    coordinate.designHandoffBoard = relativePathFrom(
      absolutePath,
      resolveMaybeRelative(context.wakeflowRoot, context.config.designHandoffBoard ?? ".workspace-active/workspace/current/design-handoff-board.md"),
    );
  }
  if (repo.windowName === context.config.testWindow) {
    coordinate.testExchangeProjection = relativePathFrom(
      absolutePath,
      resolveMaybeRelative(context.wakeflowRoot, context.config.testExchangePath ?? ".workspace-active/workspace/current/test-exchange.md"),
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
  if (coordinates.designHandoffBoard) {
    checks.push(["designHandoffBoard", `- Design handoff board: \`${coordinates.designHandoffBoard}\``]);
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
  const agentsPath = path.join(absolutePath, "AGENTS.md");
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
        ? block.includes("只处理本接入卡列出的窗口 dispatch packet")
          && coordinates.windowNames.every((name) => block.includes(`\`${name}\``))
        : block.includes(`只处理 \`${repo.windowName}\` 对应的 dispatch packet`),
    },
    {
      key: "noTargetNextHop",
      ok: block.includes("子窗口默认不创建目标窗口下一跳 delivery"),
    },
    {
      key: "testWindowBoundary",
      ok: block.includes(testWindowDeliveryBoundaryLine(context)),
    },
    {
      key: "threadIdLocalOnly",
      ok: block.includes("Thread id 只能写入 Wakeflow runtime 的本地 runtime"),
    },
  ];
  const required = repo.managedAgents !== false;
  const issues = [];
  if (required && !exists) {
    issues.push("managed repository directory missing");
  }
  if (required && !hasAgents) {
    issues.push("managed repository AGENTS.md missing");
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

function rootAgentsContent(context) {
  const wakeflowRel = slash(path.relative(context.parentRoot, context.wakeflowRoot)) || ".";
  const ledgerRel = slash(path.relative(context.parentRoot, context.ledgerPaths.projectLedgerRoot)) || "workspace-ledger";
  let content = readWakeflowFile(context.wakeflowRoot, "AGENTS.md");
  content = replaceAllLiteral(
    content,
    "本仓库是 Wakeflow 能力仓库",
    `本 workspace 使用 \`${wakeflowRel}/\` 作为 Wakeflow 能力入口`,
  );
  content = replaceAllLiteral(content, "Wakeflow 总控", `${context.config.workspaceName} 总控`);

  const localConfigPlaceholder = "__WAKEFLOW_LOCAL_CONFIG__";
  content = replaceAllLiteral(content, ".workspace-local/workspace.config.json", localConfigPlaceholder);
  content = replaceAllLiteral(content, ".workspace-active/", `${wakeflowRel}/.workspace-active/`);
  content = replaceAllLiteral(content, ".workspace-local/", `${wakeflowRel}/.workspace-local/`);
  content = replaceAllLiteral(content, "../workspace-ledger/", `${ledgerRel}/`);
  content = replaceAllLiteral(content, "../workspace-ledger", ledgerRel);
  content = replaceAllLiteral(content, "scripts/", `${wakeflowRel}/scripts/`);
  content = replaceAllLiteral(content, "skills/", `${wakeflowRel}/skills/`);
  content = replaceAllLiteral(content, "templates/", `${wakeflowRel}/templates/`);
  content = content.replace(/(?<![\w./-])workspace\.config\.json/g, `${wakeflowRel}/workspace.config.json`);
  content = replaceAllLiteral(content, `node ${wakeflowRel}/scripts/`, `cd ${wakeflowRel} && node scripts/`);
  content = replaceAllLiteral(content, localConfigPlaceholder, `${wakeflowRel}/.workspace-local/workspace.config.json`);

  content = content.replace(/^# .+$/m, `# ${context.config.workspaceName} Agent Instructions`);
  content = content.replace(
    /^# .+$/m,
    (heading) => `${heading}\n\n> 本文件由 \`${wakeflowRel}/AGENTS.md\` 解包生成，是父级工作区的 Codex 自动读取入口。不要手工长期维护；修改源文件后运行 \`cd ${wakeflowRel} && node scripts/wakeflow-setup.mjs sync-root-agents --write\` 刷新。脚本命令默认进入 \`${wakeflowRel}/\` 后执行。`,
  );

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
  const target = resolveMaybeRelative(context.parentRoot, getValue("--target", "AGENTS.md"));
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
    source: path.join(context.wakeflowRoot, "AGENTS.md"),
    parentRoot: context.parentRoot,
    wakeflowRoot: context.wakeflowRoot,
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
    const agentsPath = path.join(absolutePath, "AGENTS.md");
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

function designBoardTemplate() {
  return `# Workspace Handoff Board

This board is intentionally small. Design records completed requirement design handoffs here; Wakeflow imports ready rows with \`scripts/wakeflow-import-design-handoffs.mjs\`.

## Handoff 清单

| ID | 状态 | 标题 | 原始计划 | 需求设计 | Handoff | 用户确认状态 | 用户确认 | 主线关系状态 | 当前主线关系 | 建议 TODO | 优先级枚举 | 优先级 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
`;
}

function internalDesignReadme(config) {
  return `# Internal Design Workspace

Use this directory when the user does not have an external ${config.designWindow} repository.

- Handoff board: \`${config.designHandoffBoard}\`
- Local rules: \`AGENTS.md\`
- Operating policy: \`docs/design-window-operating-policy.md\`
- Alignment checklist: \`docs/workspace-alignment-checklist.md\`
- Templates: \`templates/original-plan-template.md\`, \`templates/requirement-design-template.md\`, \`templates/workspace-signal-template.md\`, and \`templates/workspace-handoff-template.md\`
- Wakeflow imports: \`node scripts/wakeflow-import-design-handoffs.mjs --write\`
`;
}

function internalTestingReadme(config) {
  return `# Internal Test Coordination Workspace

Use this directory when the user does not have an external ${config.testWindow} repository.

- Test boundary machine cards: \`<state-root>/test-cards/*.json\`
- Test exchange projection: \`${config.testExchangePath}\`
- Local rules: \`AGENTS.md\`
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
  const targetFile = path.join(wakeflowRoot, relativePath);
  if (existsSync(targetFile)) {
    return readFileSync(targetFile, "utf8");
  }
  return readFileSync(path.join(defaultControlRoot, relativePath), "utf8");
}

function ensureTextFile(file, content, label) {
  const exists = existsSync(file);
  const changed = !exists;
  if (write && changed) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${content.trimEnd()}\n`);
  }
  return {
    label,
    path: file,
    exists,
    changed,
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

function syncDesignSupportFiles(context, repoRoot, mode) {
  const prefix = mode === "internal" ? "internal design" : "external design";
  const files = [
    ...(mode === "internal"
      ? [
          ensureTextFile(path.join(repoRoot, "AGENTS.md"), readWakeflowFile(context.wakeflowRoot, "templates/window-support/design/AGENTS.md"), `${prefix} agents`),
          ensureTextFile(path.join(repoRoot, "README.md"), internalDesignReadme(context.config), `${prefix} readme`),
        ]
      : []),
    ensureTextFile(
      path.join(repoRoot, "docs/design-window-operating-policy.md"),
      readWakeflowFile(context.wakeflowRoot, "templates/window-support/design/docs/design-window-operating-policy.md"),
      `${prefix} operating policy`,
    ),
    ensureTextFile(
      path.join(repoRoot, "docs/workspace-alignment-checklist.md"),
      readWakeflowFile(context.wakeflowRoot, "templates/window-support/design/docs/workspace-alignment-checklist.md"),
      `${prefix} alignment checklist`,
    ),
    syncRelativeFile(context.wakeflowRoot, repoRoot, "templates/original-plan-template.md", `${prefix} original plan template`),
    syncRelativeFile(context.wakeflowRoot, repoRoot, "templates/requirement-design-template.md", `${prefix} requirement design template`),
    syncRelativeFile(context.wakeflowRoot, repoRoot, "templates/workspace-signal-template.md", `${prefix} workspace signal template`),
    syncRelativeFile(context.wakeflowRoot, repoRoot, "templates/workspace-handoff-template.md", `${prefix} workspace handoff template`),
  ];
  return files;
}

function syncTestSupportFiles(context, repoRoot, mode) {
  const prefix = mode === "internal" ? "internal test" : "external test";
  const files = [
    ...(mode === "internal"
      ? [
          ensureTextFile(path.join(repoRoot, "AGENTS.md"), readWakeflowFile(context.wakeflowRoot, "templates/window-support/testing/AGENTS.md"), `${prefix} agents`),
          ensureTextFile(path.join(repoRoot, "README.md"), internalTestingReadme(context.config), `${prefix} readme`),
        ]
      : []),
    ensureTextFile(
      path.join(repoRoot, "docs/testing-operation-policy.md"),
      readWakeflowFile(context.wakeflowRoot, "templates/window-support/testing/docs/testing-operation-policy.md"),
      `${prefix} testing operation policy`,
    ),
    syncRelativeFile(context.wakeflowRoot, repoRoot, "templates/test-handoff-template.md", `${prefix} test handoff template`),
  ];
  if (mode === "external") {
    files.push(ensureTextFile(path.join(repoRoot, "docs/current/test-window-alignment.md"), externalTestAlignment({ windowName: context.config.testWindow }, context.config), "external test alignment"));
  }
  return files;
}

function syncStarterLedgerFiles(context) {
  const sourceRoot = "templates/starter-workspace/workspace";
  return [
    ensureTextFile(context.ledgerPaths.workspaceIndexPath, readWakeflowFile(context.wakeflowRoot, `${sourceRoot}/index.md`), "active workspace index"),
    ensureTextFile(context.ledgerPaths.workspaceCurrentIndexPath, readWakeflowFile(context.wakeflowRoot, `${sourceRoot}/current/index.md`), "active current index"),
    ensureTextFile(context.ledgerPaths.workspaceCurrentStatusPath, readWakeflowFile(context.wakeflowRoot, `${sourceRoot}/current/workspace-current-status.md`), "active current status"),
    ensureTextFile(context.ledgerPaths.globalTodoPath, readWakeflowFile(context.wakeflowRoot, `${sourceRoot}/current/global-todo-board.md`), "active global TODO board"),
    ensureTextFile(resolveConfigPath(context.wakeflowRoot, context.config.designHandoffBoard), readWakeflowFile(context.wakeflowRoot, `${sourceRoot}/current/design-handoff-board.md`), "active design handoff board"),
    ensureTextFile(resolveConfigPath(context.wakeflowRoot, context.config.testExchangePath), readWakeflowFile(context.wakeflowRoot, `${sourceRoot}/current/test-exchange.md`), "active test exchange projection"),
    ensureTextFile(context.ledgerPaths.workspaceRecordMapPath, readWakeflowFile(context.wakeflowRoot, `${sourceRoot}/workspace-record-map.md`), "project workspace record map"),
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
        path: context.config.internalDesignPath ?? "../workspace-ledger/design",
        mode: "internal",
        role: "Internal requirement design workspace",
        managedAgents: false,
      };
      const repoRoot = repositoryAbsPath(context.wakeflowRoot, repo);
      const boardPath = resolveConfigPath(context.wakeflowRoot, context.config.designHandoffBoard);
      if (repo.mode === "external" && (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory())) {
        results.push({ windowName, mode: repo.mode, ok: false, issue: "external design directory missing", path: repo.path });
        continue;
      }
      results.push({ windowName, mode: repo.mode, ok: true, ...ensureTextFile(boardPath, designBoardTemplate(), "design handoff board") });
      for (const result of syncDesignSupportFiles(context, repoRoot, repo.mode)) {
        results.push({ windowName, mode: repo.mode, ok: true, ...result });
      }
    }

    if (windowName === context.config.testWindow) {
      const repo = repoForWindow(context.config, windowName) ?? {
        windowName,
        path: context.config.internalTestPath ?? "../workspace-ledger/testing",
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
  return getAllValues("--window").length > 0 || getAllValues("--thread").length > 0;
}

function hasInitializeSelection() {
  return hasConfigSelection() || hasLocalWindowSelection();
}

function parseSpecMap(flag) {
  return new Map(getAllValues(flag).map((spec) => parseKeyValueSpec(spec, flag)));
}

function automationStateDir(context) {
  return path.join(context.wakeflowRoot, ".workspace-local/wakeflow-delivery");
}

function threadRegistryFile(context, windowName) {
  return path.join(automationStateDir(context), "thread-registry", `${slug(windowName)}.json`);
}

function windowConfigFile(context, windowName) {
  return path.join(automationStateDir(context), "window-config", `${slug(windowName)}.json`);
}

function validateThreadId(value) {
  const threadId = String(value ?? "").trim();
  const placeholders = new Set(["current-codex-thread", "current thread", "<thread id>", "unknown", ""]);
  if (placeholders.has(threadId.toLowerCase())) {
    fail("--thread must contain a real Codex thread id, not a placeholder.");
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

function buildLocalWindowConfig(context, registration) {
  const windowName = registration.windowName;
  const { path: repoPath, role } = localWindowRoot(context, windowName);
  const dispatchWindows = new Set([
    ...(Array.isArray(context.config.dispatchWindows) ? context.config.dispatchWindows : []),
    ...(Array.isArray(context.config.requiredDispatchWindows) ? context.config.requiredDispatchWindows : []),
    context.config.controllerWindow,
  ].filter(Boolean));
  const dispatchable = ["controller", "target", "test-target"].includes(registration.deliveryRole)
    && (dispatchWindows.size === 0 || dispatchWindows.has(windowName) || registration.threadRegistered);
  return {
    kind: "CodexSubwindowDispatchConfig",
    version: 1,
    windowName,
    repositoryPath: repoPath || undefined,
    responsibility: role,
    dispatchable,
    threadRegistered: registration.threadRegistered,
    threadRegistryFile: slash(path.relative(automationStateDir(context), threadRegistryFile(context, windowName))),
    cwd: registration.cwd || repoPath || undefined,
    responsibilityRoot: registration.responsibilityRoot || registration.cwd || repoPath || undefined,
    deliveryRole: registration.deliveryRole,
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

function localWindowRegistrationPayload(context) {
  const threadSpecs = parseSpecMap("--thread");
  const roleSpecs = parseSpecMap("--thread-role");
  const titleSpecs = parseSpecMap("--thread-title");
  const canonicalUseSpecs = parseSpecMap("--thread-use");
  const cwdSpecs = parseSpecMap("--thread-cwd");
  const responsibilitySpecs = parseSpecMap("--thread-responsibility-root");
  const windowSpecs = new Set([
    ...getAllValues("--window"),
    ...threadSpecs.keys(),
  ]);
  const results = [];

  for (const windowName of [...windowSpecs].sort()) {
    const localRoot = localWindowRoot(context, windowName);
    const hasThread = threadSpecs.has(windowName);
    const deliveryRole = validateThreadRole(roleSpecs.get(windowName) ?? defaultThreadRole(context, windowName));
    const cwd = cwdSpecs.get(windowName) ?? localRoot.absolutePath;
    const responsibilityRoot = responsibilitySpecs.get(windowName) ?? localRoot.absolutePath;
    const registration = {
      kind: "CodexWindowThreadRegistration",
      version: 2,
      windowName,
      displayTitle: titleSpecs.get(windowName) || undefined,
      deliveryRole,
      ...(hasThread ? { threadId: validateThreadId(threadSpecs.get(windowName)) } : {}),
      cwd,
      responsibilityRoot,
      writeBoundary: [],
      canonicalUse: canonicalUseSpecs.get(windowName) || undefined,
      supersedesWindowNames: [],
      registeredAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
    };
    const windowConfig = buildLocalWindowConfig(context, {
      ...registration,
      threadRegistered: hasThread,
    });
    const registryPath = threadRegistryFile(context, windowName);
    const configPath = windowConfigFile(context, windowName);

    if (write) {
      if (hasThread) writeJson(registryPath, registration);
      writeJson(configPath, windowConfig);
    }

    results.push({
      windowName,
      deliveryRole,
      repositoryPath: localRoot.path || ".",
      registryFile: hasThread ? slash(path.relative(context.wakeflowRoot, registryPath)) : null,
      windowConfigFile: slash(path.relative(context.wakeflowRoot, configPath)),
      threadRegistered: hasThread,
      threadIdRedacted: hasThread,
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
  const discovery = {
    workspaceName: context.config.workspaceName,
    wakeflowRoot: context.wakeflowRoot,
    parentRoot: context.parentRoot,
    discoveredRepositories: discoverSiblingRepositories(context).map(({ absolutePath, ...item }) => item),
    configuredRepositories: normalizedRepositories(context.config).map((repo) => ({
      windowName: repo.windowName,
      path: repo.path,
      role: repo.role,
      mode: repo.mode,
      managedAgents: repo.managedAgents,
    })),
    setupQuestions: statusPayload().setupQuestions,
  };

  if (!hasInitializeSelection()) {
    return {
      ok: true,
      command: "initialize",
      mode: "discovery",
      wrote: false,
      requiresUserSelection: true,
      discovery,
      nextAction: "Choose repositories/windows with --repo Window=../Repo or --use-discovered, choose internal/external Design/Test, then rerun initialize with --write when ready.",
    };
  }

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
  const templates = syncTemplatesPayload(installContext, { all: true });
  const rootAgents = syncRootAgentsPayload(installContext);
  const childAgents = writeAgentsPayload(installContext, {
    all: true,
    includeUnmanaged: true,
    includeRealProject: hasFlag("--include-real-project"),
  });
  const localWindows = localWindowRegistrationPayload(installContext);
  const accessProfiles = accessProfilesPayload(installContext, {
    includeRealProject: hasFlag("--include-real-project"),
  });

  const ok = [configured, templates, rootAgents, childAgents, localWindows, accessProfiles]
    .every((item) => item.ok !== false);

  return {
    ok,
    command: "initialize",
    mode: write ? "apply" : "plan",
    wrote: write,
    discovery,
    steps: {
      configure: configured,
      syncTemplates: templates,
      syncRootAgents: rootAgents,
      writeAgents: childAgents,
      localWindows,
      accessProfiles,
    },
    nextAction: write
      ? "Review the generated workspace config, AGENTS blocks, Design/Test surfaces, and local window runtime files before dispatching any work."
      : "Dry-run only. Rerun with --write after confirming repositories, Design/Test mode, and optional thread registrations.",
  };
}

function help() {
  return {
    ok: true,
    commands: {
      initialize: "One workflow for discovery, config generation, AGENTS install, Design/Test setup, and local window/thread runtime registration.",
      discover: "List sibling repository candidates under the parent workspace.",
      status: "Show configured repositories, discovered siblings, and scope issues.",
      configure: "Write workspace.config.json after user-confirmed --repo mappings.",
      prompts: "Print child-window prompts for confirming scope and refreshing AGENTS.md.",
      "sync-root-agents": "Unpack the control AGENTS.md into the parent workspace AGENTS.md so Codex auto-loads total-control rules at the outer workspace root.",
      "write-agents": "Append or refresh managed access-card blocks in configured child AGENTS.md files.",
      "access-profiles": "Print a read-only ChildWindowAccessProfile view from workspace.config plus child AGENTS managed blocks.",
      "sync-templates": "Create missing internal Design/Test templates or minimal external alignment templates.",
      "ledger-paths": "Show project ledger directories for configured windows.",
    },
    examples: [
      "node scripts/wakeflow-setup.mjs initialize --json",
      "node scripts/wakeflow-setup.mjs initialize --repo AppWindow=../MyApp --internal-design --internal-test --write --json",
      "node scripts/wakeflow-setup.mjs initialize --use-discovered --thread Wakeflow=<realThreadId> --write --json",
      "node scripts/wakeflow-setup.mjs discover --json",
      "node scripts/wakeflow-setup.mjs configure --repo AppWindow=../MyApp --repo ServiceWindow=../MyService --write",
      "node scripts/wakeflow-setup.mjs prompts --window AppWindow",
      "node scripts/wakeflow-setup.mjs sync-root-agents --write",
      "node scripts/wakeflow-setup.mjs write-agents --all --write",
      "node scripts/wakeflow-setup.mjs access-profiles --json",
      "node scripts/wakeflow-setup.mjs ledger-paths --json",
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
    case "discover": {
      const context = commandContext();
      printResult({
        ok: true,
        command: "discover",
        workspaceName: context.config.workspaceName,
        wakeflowRoot: context.wakeflowRoot,
        parentRoot: context.parentRoot,
        discoveredRepositories: discoverSiblingRepositories(context).map(({ absolutePath, ...item }) => item),
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
