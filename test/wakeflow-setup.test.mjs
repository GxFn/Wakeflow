#!/usr/bin/env node

import assert from "node:assert/strict";
import { handlers, tools } from "../plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const installScript = path.join(workspaceRoot, "scripts/wakeflow-setup.mjs");

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function makeFixture() {
  const parent = mkdtempSync(path.join(os.tmpdir(), "control-install-"));
  const control = path.join(parent, "Wakeflow");
  const base = path.join(parent, "BaseWindow");
  const plugin = path.join(parent, "PluginWindow");
  mkdirSync(path.join(control, "scripts"), { recursive: true });
  mkdirSync(path.join(base, ".git"), { recursive: true });
  mkdirSync(plugin, { recursive: true });
  writeFile(path.join(plugin, "AGENTS.md"), "# Plugin Instructions\n\nExisting rule.");
  writeFile(
    path.join(control, "wakeflow.config.json"),
    JSON.stringify(
      {
        workspaceName: "FixtureWorkspace",
        controllerWindow: "FixtureWorkspace",
        workspaceRoot: "..",
        wakeflowRepoDir: "Wakeflow",
        allowMissingRepos: true,
        repositoryRoles: {
          BaseWindow: "Base runtime",
          PluginWindow: "Plugin entry",
        },
        repositories: [
          { windowName: "BaseWindow", path: "../BaseWindow", role: "Base runtime", managedAgents: true },
        ],
      },
      null,
      2,
    ),
  );
  return { parent, control, base, plugin };
}

function run(fixture, args) {
  return runSync(process.execPath, [installScript, ...args, "--root", fixture.control], {
    cwd: fixture.control,
    encoding: "utf8",
  });
}

function runAt(root, args) {
  return runSync(process.execPath, [installScript, ...args, "--root", root], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

function runJson(fixture, args) {
  const result = run(fixture, [...args, "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("discover lists sibling repositories and marks configured scopes", () => {
  const fixture = makeFixture();
  const payload = runJson(fixture, ["discover"]);
  assert.equal(payload.ok, true);
  assert.deepEqual(
    payload.discoveredRepositories.map((repo) => [repo.name, repo.path, repo.configured]),
    [
      ["BaseWindow", "../BaseWindow", true],
      ["PluginWindow", "../PluginWindow", false],
    ],
  );
  assert.equal(payload.agentSelectionProtocol.decisionOwner, "codex-agent");
  assert.equal(payload.agentSelectionProtocol.pluginDoesNotClassifyCleanOrMessy, true);
});

test("configure writes user-confirmed sibling mappings into wakeflow.config.json", () => {
  const fixture = makeFixture();
  const payload = runJson(fixture, [
    "configure",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--repo",
    "PluginWindow=../PluginWindow",
    "--write",
  ]);
  assert.equal(payload.wrote, true);
  const config = JSON.parse(readFileSync(path.join(fixture.control, "wakeflow.config.json"), "utf8"));
  assert.equal(config.workspaceRoot, "..");
  assert.equal(config.wakeflowRepoDir, "Wakeflow");
  assert.deepEqual(config.repoNames, ["BaseWindow", "PluginWindow"]);
  assert.deepEqual(
    config.repositories.map((repo) => [repo.windowName, repo.path]),
    [
      ["BaseWindow", "../BaseWindow"],
      ["PluginWindow", "../PluginWindow"],
      ["Design", "../Design"],
      ["Test", "../Test"],
    ],
  );
  assert.equal(config.testExchangePath, ".wakeflow-active/current/test-exchange.md");
  assert.equal(config.goalStageConfirmationDir, "../wakeflow-ledger/goal-stage-confirmation");
  assert.deepEqual(config.protectedWorkspacePrefixes, []);
});

test("sync-gitignore adds Wakeflow runtime entries idempotently", () => {
  const fixture = makeFixture();
  writeFile(path.join(fixture.control, ".gitignore"), ".wakeflow-local\nnode_modules/");

  const dryRun = runJson(fixture, ["sync-gitignore"]);
  assert.equal(dryRun.changed, true);
  assert.deepEqual(dryRun.missing, [".wakeflow-active/"]);
  assert.equal(dryRun.wakeflowManagedOnly, true);
  assert.match(dryRun.policy, /only manages its own runtime state entries/);
  assert.deepEqual(dryRun.entries, [".wakeflow-active/", ".wakeflow-local/"]);
  assert.ok(dryRun.forbiddenGeneratedEntries.includes("product repositories"));

  const first = runJson(fixture, ["sync-gitignore", "--write"]);
  assert.equal(first.wrote, true);
  const content = readFileSync(path.join(fixture.control, ".gitignore"), "utf8");
  assert.match(content, /^\.wakeflow-local$/m);
  assert.match(content, /^\.wakeflow-active\/$/m);
  assert.doesNotMatch(content, /^\.DS_Store$/m);
  assert.doesNotMatch(content, /^BaseWindow\/$/m);
  assert.doesNotMatch(content, /^PluginWindow\/$/m);

  const second = runJson(fixture, ["sync-gitignore", "--write"]);
  assert.equal(second.changed, false);
  assert.equal(second.wrote, false);
});

test("initialize without selection returns discovery and writes nothing", () => {
  const fixture = makeFixture();
  const payload = runJson(fixture, ["initialize"]);
  assert.equal(payload.command, "initialize");
  assert.equal(payload.mode, "discovery");
  assert.equal(payload.requiresUserSelection, true);
  assert.equal(payload.wrote, false);
  assert.equal(payload.discovery.agentSelectionProtocol.decisionOwner, "codex-agent");
  assert.match(payload.nextAction, /Agent must judge/);
  assert.deepEqual(
    payload.discovery.discoveredRepositories.map((repo) => repo.name),
    ["BaseWindow", "PluginWindow"],
  );
  assert.equal(existsSync(path.join(fixture.parent, "AGENTS.md")), false);
  assert.equal(existsSync(path.join(fixture.parent, "Design/AGENTS.md")), false);
});

test("initialize previews a plugin-managed target workspace without a local Wakeflow repo", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-target-workspace-"));
  mkdirSync(path.join(parent, "AppRepo", ".git"), { recursive: true });
  writeFile(path.join(parent, "AppRepo", "AGENTS.md"), "# App Repo\n");

  let result = runAt(parent, ["initialize", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  let payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "discovery");
  assert.equal(payload.discovery.workspaceName, path.basename(parent));
  assert.equal(payload.discovery.discoveredRepositories[0].path, "AppRepo");
  assert.equal(payload.discovery.configuredRepositories[0].path, "Design");
  assert.equal(existsSync(path.join(parent, "AGENTS.md")), false);

  result = runAt(parent, ["initialize", "--use-discovered", "--internal-design", "--internal-test", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "plan");
  assert.equal(payload.steps.configure.nextConfig.workspaceRoot, ".");
  assert.equal(payload.steps.configure.nextConfig.projectLedgerRoot, "wakeflow-ledger");
  assert.equal(payload.steps.configure.nextConfig.repositories[0].path, "AppRepo");
  assert.equal(payload.steps.syncRootAgents.source, path.join(workspaceRoot, "AGENTS.md"));
  assert.equal(payload.steps.writeAgents.ok, true);
  assert.equal(existsSync(path.join(parent, "AGENTS.md")), false);
  assert.equal(existsSync(path.join(parent, "Design/AGENTS.md")), false);
});

test("explicit relative --root resolves from the caller cwd", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-relative-root-"));
  mkdirSync(path.join(parent, "AppRepo", ".git"), { recursive: true });

  const result = runSync(process.execPath, [installScript, "initialize", "--root", ".", "--json"], {
    cwd: parent,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "discovery");
  assert.equal(payload.discovery.workspaceName, path.basename(parent));
  assert.deepEqual(
    payload.discovery.discoveredRepositories.map((repo) => repo.path),
    ["AppRepo"],
  );
  assert.equal(existsSync(path.join(parent, "AGENTS.md")), false);
});

test("initialize localizes launch titles and prompts with the window name first", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-target-language-"));
  mkdirSync(path.join(parent, "AppRepo", ".git"), { recursive: true });
  const result = runAt(parent, ["initialize", "--use-discovered", "--internal-design", "--internal-test", "--language", "zh", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const windows = payload.steps.windowLaunchPlan.windows;
  const controller = windows.find((item) => item.windowName === path.basename(parent));
  const app = windows.find((item) => item.windowName === "AppRepo");
  const design = windows.find((item) => item.windowName === "Design");

  const zhControllerRole = "\u603b\u63a7";
  const zhDutyWindow = "\u804c\u8d23\u7a97\u53e3";
  const zhDesignWindow = "\u9700\u6c42\u7a97\u53e3";
  const zhFirstRead = "\u5148\u8bfb\u53d6";
  const zhColon = "\uff1a";
  const zhReadyWait = "\u5165\u53e3\u540c\u6b65\u5b8c\u6210\uff0c\u7b49\u5f85\u603b\u63a7\u4efb\u52a1";

  assert.equal(payload.steps.windowLaunchPlan.language, "zh");
  assert.equal(payload.steps.windowLaunchPlan.requiresHostTitleReset, true);
  assert.equal(payload.steps.windowLaunchPlan.includesHostCreateThreadSettings, true);
  assert.match(payload.steps.windowLaunchPlan.hostWorkflow.join("\n"), /set_thread_title/);
  assert.match(payload.steps.windowLaunchPlan.hostWorkflow.join("\n"), /hostCreateThread settings/);
  assert.match(payload.steps.windowLaunchPlan.hostWorkflow.join("\n"), /not task deliveries/);
  assert.match(payload.steps.windowLaunchPlan.hostWorkflow.join("\n"), /wakeflow_register_window/);
  assert.match(payload.steps.windowLaunchPlan.hostWorkflow.join("\n"), /create_thread\.threadId/);
  assert.match(payload.steps.windowLaunchPlan.hostWorkflow.join("\n"), /stores the id only in thread-registry/);
  assert.match(payload.steps.windowLaunchPlan.hostWorkflow.join("\n"), /\u5b50 agent/);
  assert.equal(controller.displayTitle, `${path.basename(parent)} ${zhControllerRole}`);
  assert.equal(app.displayTitle, `AppRepo ${zhDutyWindow}`);
  assert.equal(design.displayTitle, `Design ${zhDesignWindow}`);
  assert.equal(app.promptPurpose, "initialization-entry-sync");
  assert.deepEqual(app.hostCreateThread, {
    required: true,
    hostTool: "create_thread",
    promptField: "createThreadPrompt",
    targetPolicy: "Use the saved Codex project for this cwd with environment { type: \"local\" }; do not create a worktree unless the user explicitly asks.",
    cwd: app.cwd,
    title: `AppRepo ${zhDutyWindow}`,
    thinking: "xhigh",
    thinkingSource: "wakeflow.config.json hosts.codex.thinkingByRole, falling back to the Wakeflow Codex profile",
    model: null,
    modelPolicy: "inherit the current Codex model; omit create_thread.model unless workspace config pins hosts.codex.modelByRole",
  });
  assert.deepEqual(app.titleReset, {
    required: true,
    hostTool: "set_thread_title",
    title: `AppRepo ${zhDutyWindow}`,
  });
  assert.equal(app.localRegistration.required, true);
  assert.equal(app.localRegistration.hostTool, "wakeflow_register_window");
  assert.equal(app.localRegistration.applyRequired, true);
  assert.equal(app.localRegistration.handleSource, "create_thread.threadId");
  assert.equal(app.localRegistration.threadIdAuthority, ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/AppRepo.json");
  assert.equal(app.localRegistration.derivedStatusView, ".wakeflow-local/wakeflow-delivery/hosts/codex/window-config/AppRepo.json");
  assert.equal(app.localRegistration.trackedDocsContainThreadIds, false);
  assert.deepEqual(app.localRegistration.callTemplate, {
    root: parent,
    window: "AppRepo",
    windowHandle: "<create_thread.threadId>",
    apply: true,
  });
  assert.equal(app.createThreadPrompt.split("\n")[0], `AppRepo ${zhDutyWindow}${zhColon}\u521d\u59cb\u5316\u5165\u53e3\u540c\u6b65\uff0c\u4e0d\u662f\u4efb\u52a1\u6295\u9012\u3002`);
  assert.match(app.createThreadPrompt, new RegExp(zhFirstRead));
  assert.match(app.createThreadPrompt, new RegExp(zhReadyWait));
  assert.match(app.createThreadPrompt, /\u5b50 agent/);
  assert.match(app.createThreadPrompt, /currentWindow.*taskId.*stateRoot/);
  assert.doesNotMatch(controller.createThreadPrompt, /AGENTS\.md\u3001AGENTS\.md/);
  assert.doesNotMatch(design.createThreadPrompt, /\.\.\/AGENTS\.md\u3001\.\.\/AGENTS\.md/);
});

test("initialize applies a plugin-managed target workspace without copying Wakeflow source", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-target-apply-"));
  mkdirSync(path.join(parent, "AppRepo", ".git"), { recursive: true });
  writeFile(path.join(parent, "AppRepo", "AGENTS.md"), "# App Repo\n\nExisting app rule.");

  const result = runAt(parent, ["initialize", "--use-discovered", "--internal-design", "--internal-test", "--write", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "apply");
  assert.equal(payload.steps.gitignore.wakeflowManagedOnly, true);
  assert.match(payload.steps.gitignore.policy, /Do not add product repositories/);
  assert.equal(payload.steps.configure.nextConfig.workspaceRoot, ".");
  assert.equal(payload.steps.configure.nextConfig.projectLedgerRoot, "wakeflow-ledger");

  const config = JSON.parse(readFileSync(path.join(parent, "wakeflow.config.json"), "utf8"));
  assert.equal(config.workspaceRoot, ".");
  assert.equal(config.runtimeMode, "plugin");
  assert.equal(config.projectLedgerRoot, "wakeflow-ledger");
  assert.deepEqual(config.protectedWorkspacePrefixes, ["AppRepo/"]);
  assert.equal(payload.steps.gitignore.wrote, true);
  const gitignore = readFileSync(path.join(parent, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.wakeflow-active\/$/m);
  assert.match(gitignore, /^\.wakeflow-local\/$/m);
  assert.doesNotMatch(gitignore, /^\.DS_Store$/m);
  assert.doesNotMatch(gitignore, /^AppRepo\/$/m);
  assert.doesNotMatch(gitignore, /^Design\/$/m);
  assert.doesNotMatch(gitignore, /^Test\/$/m);
  assert.equal(config.goalStageConfirmationDir, "wakeflow-ledger/goal-stage-confirmation");
  assert.equal(config.wakeflowRepoDir, "");
  assert.equal(config.repositories[0].path, "AppRepo");
  assert.equal(config.repositories.find((repo) => repo.windowName === "Design").path, "Design");
  assert.equal(config.repositories.find((repo) => repo.windowName === "Test").path, "Test");

  const rootAgents = readFileSync(path.join(parent, "AGENTS.md"), "utf8");
  assert.match(rootAgents, /Wakeflow is installed as a Codex plugin for this workspace/);
  assert.match(rootAgents, /Use Wakeflow MCP tools/);
  assert.match(rootAgents, /Do not call installed runtime scripts directly/);
  assert.match(rootAgents, /Wakeflow verification MCP capability/);
  assert.match(rootAgents, /wakeflow\.config\.json/);
  assert.doesNotMatch(rootAgents, /node scripts\/wakeflow-setup\.mjs/);
  assert.doesNotMatch(rootAgents, /installed runtime fallback/);
  assert.doesNotMatch(rootAgents, /installed Wakeflow runtime/);
  assert.doesNotMatch(rootAgents, /wakeflow-verify\.mjs/);
  assert.doesNotMatch(rootAgents, /plugins\/cache/);
  assert.doesNotMatch(rootAgents, /use the matching Wakeflow MCP tool/);
  assert.doesNotMatch(rootAgents, /the installed Wakeflow script index is the script index/);

  const appAgents = readFileSync(path.join(parent, "AppRepo", "AGENTS.md"), "utf8");
  assert.match(appAgents, /## Workspace Access Card/);
  assert.match(appAgents, /Existing app rule/);
  assert.match(appAgents, /Active workspace index: `\.\.\/\.wakeflow-active\/index\.md`/);
  assert.equal(existsSync(path.join(parent, "Design/AGENTS.md")), true);
  assert.equal(existsSync(path.join(parent, "Test/AGENTS.md")), true);
  assert.equal(existsSync(path.join(parent, "scripts/README.md")), false);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/requirement-designs/README.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/goal-stage-confirmation/README.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/goal-stage-confirmation/process.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/workspace/requirement-to-wave-execution-flow.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/workspace/todo-window-scheduling-policy.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/workspace/workspace-doc-archive-policy.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/workspace/archive/index.md")), true);
  assert.equal(existsSync(path.join(parent, "Wakeflow")), false);
  const currentStatus = readFileSync(path.join(parent, ".wakeflow-active/current/workspace-current-status.md"), "utf8");
  assert.match(currentStatus, new RegExp(`# ${path.basename(parent)} Current Status`));
  assert.match(currentStatus, new RegExp(`Controller window: ${path.basename(parent)}`));
  assert.doesNotMatch(currentStatus, /Controller window: Wakeflow/);
  assert.match(currentStatus, /Wakeflow MCP `wakeflow_create_demand` tool/);
  assert.doesNotMatch(currentStatus, /node scripts\/wakeflow-state\.mjs/);
  assert.match(currentStatus, /Status: idle \/ initialization ready \/ waiting for controller task/);
  assert.match(currentStatus, /Entry-sync windows should report readiness and stop/);
  assert.match(currentStatus, new RegExp(`\\| ${path.basename(parent)} \\| idle \\| No active demand; waiting for controller task\\. \\| Initialization ready state\\. \\|`));
  const workspaceIndex = readFileSync(path.join(parent, ".wakeflow-active/index.md"), "utf8");
  assert.match(workspaceIndex, new RegExp(`# ${path.basename(parent)} Workspace Index`));
  assert.match(workspaceIndex, /`wakeflow-ledger\/workspace\/workspace-record-map\.md`/);
  assert.deepEqual(
    payload.steps.windowLaunchPlan.windows.map((item) => item.windowName),
    [path.basename(parent), "AppRepo", "Design", "Test"],
  );

  const synced = runAt(parent, ["sync-root-agents", "--write", "--json"]);
  assert.equal(synced.status, 0, synced.stderr || synced.stdout);
  const rootAgentsAfterSync = readFileSync(path.join(parent, "AGENTS.md"), "utf8");
  assert.match(rootAgentsAfterSync, /Wakeflow is installed as a Codex plugin for this workspace/);
  assert.match(rootAgentsAfterSync, /Wakeflow verification MCP capability/);
  assert.match(rootAgentsAfterSync, /Do not call installed runtime scripts directly/);
  assert.doesNotMatch(rootAgentsAfterSync, /node scripts\/wakeflow-setup\.mjs/);
  assert.doesNotMatch(rootAgentsAfterSync, /installed runtime fallback/);
  assert.doesNotMatch(rootAgentsAfterSync, /installed Wakeflow runtime/);
  assert.doesNotMatch(rootAgentsAfterSync, /wakeflow-verify\.mjs/);
  assert.doesNotMatch(rootAgentsAfterSync, /plugins\/cache/);
  assert.doesNotMatch(rootAgentsAfterSync, /use the matching Wakeflow MCP tool/);
});

test("initialize does not reuse similar Design/Test directories unless explicitly mapped", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "plugin-target-legacy-design-"));
  mkdirSync(path.join(parent, "Alembic", ".git"), { recursive: true });
  mkdirSync(path.join(parent, "AlembicDesign", ".git"), { recursive: true });
  mkdirSync(path.join(parent, "AlembicTest", ".git"), { recursive: true });
  writeFile(
    path.join(parent, "wakeflow.config.json"),
    JSON.stringify(
      {
        runtimeMode: "plugin",
        workspaceName: "AlembicWorkspace",
        controllerWindow: "AlembicWorkspace",
        designWindow: "AlembicDesign",
        testWindow: "AlembicTest",
        repositories: [
          { windowName: "Alembic", path: "Alembic", role: "Product repository" },
          { windowName: "AlembicDesign", path: "AlembicDesign", role: "Legacy design-like repository" },
          { windowName: "AlembicTest", path: "AlembicTest", role: "Legacy test-like repository" },
        ],
      },
      null,
      2,
    ),
  );

  const result = runAt(parent, [
    "initialize",
    "--repo",
    "Alembic=Alembic",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const config = JSON.parse(readFileSync(path.join(parent, "wakeflow.config.json"), "utf8"));
  assert.equal(config.designWindow, "Design");
  assert.equal(config.testWindow, "Test");
  assert.equal(config.internalDesignPath, "Design");
  assert.equal(config.internalTestPath, "Test");
  assert.deepEqual(
    config.repositories.map((repo) => [repo.windowName, repo.path, repo.mode]),
    [
      ["Alembic", "Alembic", "external"],
      ["Design", "Design", "internal"],
      ["Test", "Test", "internal"],
    ],
  );
  assert.deepEqual(
    Object.keys(config.repositoryRoles).sort(),
    ["Alembic", "Design", "Test"],
  );
  assert.deepEqual(
    payload.steps.windowLaunchPlan.windows.map((item) => item.windowName),
    ["AlembicWorkspace", "Alembic", "Design", "Test"],
  );
  assert.equal(existsSync(path.join(parent, "Design/AGENTS.md")), true);
  assert.equal(existsSync(path.join(parent, "Test/AGENTS.md")), true);
  assert.equal(existsSync(path.join(parent, "AlembicDesign/AGENTS.md")), false);
  assert.equal(existsSync(path.join(parent, "AlembicTest/AGENTS.md")), false);
  const currentStatus = readFileSync(path.join(parent, ".wakeflow-active/current/workspace-current-status.md"), "utf8");
  assert.match(currentStatus, /# AlembicWorkspace Current Status/);
  assert.match(currentStatus, /Controller window: AlembicWorkspace/);
  assert.doesNotMatch(currentStatus, /Controller window: Wakeflow/);
});

test("initialize refreshes stale starter controller identity without overwriting active demand status", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stale-status-"));
  mkdirSync(path.join(parent, "AppRepo", ".git"), { recursive: true });
  writeFile(
    path.join(parent, ".wakeflow-active/current/workspace-current-status.md"),
    `# Wakeflow Current Status

Updated: 2026-05-27
Controller window: Wakeflow
Status: idle / no active demand

## Status Summary

- Active demand: none.
- This repository is a freshly extracted Wakeflow runtime template.

## Window Dispatch

| Window | Status | Assigned Work | Evidence |
| --- | --- | --- | --- |
| Controller | idle | No active demand. | Starter status only. |`,
  );

  const result = runAt(parent, [
    "initialize",
    "--reset-initialization",
    "--repo",
    "AppRepo=AppRepo",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const statusResult = payload.steps.syncTemplates.results.find((item) => item.label === "active current status");
  assert.equal(statusResult.refreshedStarter, true);

  const currentStatus = readFileSync(path.join(parent, ".wakeflow-active/current/workspace-current-status.md"), "utf8");
  assert.match(currentStatus, new RegExp(`# ${path.basename(parent)} Current Status`));
  assert.match(currentStatus, new RegExp(`Controller window: ${path.basename(parent)}`));
  assert.match(currentStatus, /Status: idle \/ initialization ready \/ waiting for controller task/);
  assert.match(currentStatus, new RegExp(`\\| ${path.basename(parent)} \\| idle \\| No active demand; waiting for controller task\\. \\| Initialization ready state\\. \\|`));
  assert.match(currentStatus, /Wakeflow MCP `wakeflow_create_demand` tool/);
  assert.doesNotMatch(currentStatus, /node scripts\/wakeflow-state\.mjs/);
  assert.doesNotMatch(currentStatus, /Controller window: Wakeflow/);

  writeFile(
    path.join(parent, ".wakeflow-active/current/workspace-current-status.md"),
    `# Custom Current Status

Controller window: Wakeflow
Status: active

## Status Summary

- Active demand: REAL-DEMAND
- Keep this active status.`,
  );

  const activeResult = runAt(parent, [
    "initialize",
    "--reset-initialization",
    "--repo",
    "AppRepo=AppRepo",
    "--write",
    "--json",
  ]);
  assert.equal(activeResult.status, 0, activeResult.stderr || activeResult.stdout);
  const activeStatus = readFileSync(path.join(parent, ".wakeflow-active/current/workspace-current-status.md"), "utf8");
  assert.match(activeStatus, /# Custom Current Status/);
  assert.match(activeStatus, /Active demand: REAL-DEMAND/);

  writeFile(
    path.join(parent, ".wakeflow-active/current/workspace-current-status.md"),
    `# Queue Current Status

Controller window: QueueWorkspace
Status: idle / local demand queue ready / waiting for claim

## Status Summary

- Active demand: none.
- Local demand definitions have been rebuilt for this workspace.
- Next claimable demand: LOCAL-REQ-08.`,
  );
  writeFile(
    path.join(parent, "wakeflow-ledger/workspace/workspace-record-map.md"),
    `# Workspace Record Map

Status: starter long-term map

## Current Entries

| Type | Entry | Description |
| --- | --- | --- |
| Active workspace | ../../.wakeflow-active/ | Current index. |
| Local demand queue | ../requirement-designs/local-demand/ | Local rebuilt queue that must survive template sync. |`,
  );

  const queueResult = runAt(parent, [
    "initialize",
    "--reset-initialization",
    "--repo",
    "AppRepo=AppRepo",
    "--write",
    "--json",
  ]);
  assert.equal(queueResult.status, 0, queueResult.stderr || queueResult.stdout);
  const queueStatus = readFileSync(path.join(parent, ".wakeflow-active/current/workspace-current-status.md"), "utf8");
  assert.match(queueStatus, /# Queue Current Status/);
  assert.match(queueStatus, /Next claimable demand: LOCAL-REQ-08/);
  assert.doesNotMatch(queueStatus, /Create a real active demand with the Wakeflow MCP/);
  const recordMap = readFileSync(path.join(parent, "wakeflow-ledger/workspace/workspace-record-map.md"), "utf8");
  assert.match(recordMap, /Local demand queue/);
  assert.match(recordMap, /local rebuilt queue that must survive template sync/i);
});

test("initialize applies workspace config, AGENTS, Design/Test surfaces, and local thread runtime", () => {
  const fixture = makeFixture();
  const threadId = "019e7e06-e64c-7e42-9dc3-ca1633bdeed7";
  const result = run(fixture, [
    "initialize",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--repo",
    "PluginWindow=../PluginWindow",
    "--internal-design",
    "--internal-test",
    "--thread",
    `FixtureWorkspace=${threadId}`,
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, new RegExp(threadId));
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "initialize");
  assert.equal(payload.mode, "apply");
  assert.equal(payload.steps.configure.wrote, true);
  assert.equal(payload.steps.syncRootAgents.wrote, true);
  assert.equal(payload.steps.writeAgents.results.some((item) => item.windowName === "BaseWindow" && item.wrote), true);
  assert.equal(payload.steps.writeAgents.results.some((item) => item.windowName === "PluginWindow" && item.wrote), true);
  const controllerLocalWindow = payload.steps.localWindows.results.find((item) => item.windowName === "FixtureWorkspace");
  assert.equal(controllerLocalWindow.threadIdRedacted, true);

  assert.equal(existsSync(path.join(fixture.parent, "AGENTS.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/AGENTS.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/AGENTS.md")), true);
  assert.equal(existsSync(path.join(fixture.control, ".wakeflow-active/current/test-exchange.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/requirement-designs/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/goal-stage-confirmation/process.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/workspace/requirement-to-wave-execution-flow.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/workspace/archive/index.md")), true);

  const registryPath = path.join(fixture.control, ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/FixtureWorkspace.json");
  const windowConfigPath = path.join(fixture.control, ".wakeflow-local/wakeflow-delivery/hosts/codex/window-config/FixtureWorkspace.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const windowConfig = JSON.parse(readFileSync(windowConfigPath, "utf8"));
  assert.equal(registry.threadId, threadId);
  assert.equal(Object.hasOwn(registry, "displayTitle"), false);
  assert.equal(Object.hasOwn(registry, "deliveryRole"), false);
  assert.equal(Object.hasOwn(registry, "cwd"), false);
  assert.equal(Object.hasOwn(registry, "responsibilityRoot"), false);
  assert.equal(windowConfig.threadRegistered, true);
  assert.equal(windowConfig.deliveryRole, "controller");
  assert.equal(Object.hasOwn(windowConfig, "threadId"), false);

  const baseWindowConfigPath = path.join(fixture.control, ".wakeflow-local/wakeflow-delivery/hosts/codex/window-config/BaseWindow.json");
  const baseWindowConfig = JSON.parse(readFileSync(baseWindowConfigPath, "utf8"));
  assert.equal(baseWindowConfig.threadRegistered, false);
  assert.equal(baseWindowConfig.deliveryRole, "target");
  const currentStatus = readFileSync(path.join(fixture.control, ".wakeflow-active/current/workspace-current-status.md"), "utf8");
  assert.match(currentStatus, /# FixtureWorkspace Current Status/);
  assert.match(currentStatus, /Controller window: FixtureWorkspace/);
  assert.doesNotMatch(currentStatus, /Controller window: Wakeflow/);

  writeFileSync(
    registryPath,
    `${JSON.stringify({
      ...registry,
      displayTitle: "Stale title",
      deliveryRole: "observer",
      cwd: "/stale/cwd",
      responsibilityRoot: "/stale/responsibility",
    }, null, 2)}\n`,
  );

  const rerun = run(fixture, [
    "initialize",
    "--reset-initialization",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--repo",
    "PluginWindow=../PluginWindow",
    "--internal-design",
    "--internal-test",
    "--write",
    "--json",
  ]);
  assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
  assert.doesNotMatch(rerun.stdout, new RegExp(threadId));
  const rerunPayload = JSON.parse(rerun.stdout);
  const rerunControllerWindow = rerunPayload.steps.localWindows.results.find((item) => item.windowName === "FixtureWorkspace");
  assert.equal(rerunControllerWindow.threadRegistered, true);
  assert.equal(rerunControllerWindow.threadIdRedacted, true);
  assert.equal(rerunControllerWindow.wroteRegistry, false);
  const rerunWindowConfig = JSON.parse(readFileSync(windowConfigPath, "utf8"));
  assert.equal(rerunWindowConfig.threadRegistered, true);
  assert.equal(rerunWindowConfig.deliveryRole, "controller");
  assert.equal(rerunWindowConfig.cwd, fixture.control);
  assert.equal(rerunWindowConfig.responsibilityRoot, fixture.control);
  assert.equal(Object.hasOwn(rerunWindowConfig, "threadId"), false);
});

test("replace-window replaces one registered window thread without initialization writes", () => {
  const fixture = makeFixture();
  const oldThreadId = "019e7e06-e64c-7e42-9dc3-ca1633bdeed7";
  const newThreadId = "019e7e07-4c52-7752-8ca6-5e8033bf3fb9";
  const zhDutyWindow = "\u804c\u8d23\u7a97\u53e3";

  let result = run(fixture, [
    "initialize",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--internal-design",
    "--internal-test",
    "--thread",
    `BaseWindow=${oldThreadId}`,
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = run(fixture, [
    "replace-window",
    "--window",
    "BaseWindow",
    "--language",
    "zh",
    "--thread",
    `BaseWindow=${newThreadId}`,
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, new RegExp(newThreadId));
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "replace-window");
  assert.equal(payload.mode, "apply");
  assert.equal(payload.steps.windowLaunchPlan.replacementMode, true);
  assert.deepEqual(payload.steps.windowLaunchPlan.replaceWindows, ["BaseWindow"]);
  assert.deepEqual(payload.steps.windowLaunchPlan.windows.map((item) => item.windowName), ["BaseWindow"]);
  assert.equal(payload.steps.windowLaunchPlan.windows[0].displayTitle, `BaseWindow ${zhDutyWindow}`);
  assert.equal(payload.steps.windowLaunchPlan.windows[0].titleReset.title, `BaseWindow ${zhDutyWindow}`);
  assert.equal(payload.steps.windowLaunchPlan.windows[0].hostCreateThread.required, true);
  assert.equal(payload.steps.windowLaunchPlan.windows[0].hostCreateThread.promptField, "createThreadPrompt");
  assert.equal(payload.steps.windowLaunchPlan.windows[0].hostCreateThread.title, `BaseWindow ${zhDutyWindow}`);
  assert.equal(payload.steps.windowLaunchPlan.windows[0].hostCreateThread.thinking, "xhigh");
  assert.equal(payload.steps.windowLaunchPlan.windows[0].hostCreateThread.model, null);
  assert.match(payload.steps.windowLaunchPlan.windows[0].hostCreateThread.modelPolicy, /inherit the current Codex model/);
  assert.equal(payload.steps.windowLaunchPlan.windows[0].localRegistration.hostTool, "wakeflow_register_window");
  assert.equal(payload.steps.windowLaunchPlan.windows[0].localRegistration.handleSource, "create_thread.threadId");
  assert.deepEqual(payload.steps.windowLaunchPlan.windows[0].localRegistration.callTemplate, {
    root: fixture.control,
    window: "BaseWindow",
    windowHandle: "<create_thread.threadId>",
    apply: true,
  });

  const replaced = payload.steps.localWindows.results.find((item) => item.windowName === "BaseWindow");
  assert.equal(replaced.replaceRequested, true);
  assert.equal(replaced.replacedExistingThread, true);
  assert.equal(replaced.threadIdRedacted, true);

  const registryPath = path.join(fixture.control, ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/BaseWindow.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  assert.equal(registry.threadId, newThreadId);
  assert.equal(Object.hasOwn(registry, "displayTitle"), false);
  assert.equal(Object.hasOwn(registry, "deliveryRole"), false);
});

test("replace-windows regenerates only selected responsibility windows without initialization writes", () => {
  const fixture = makeFixture();
  const oldThreadId = "019e7e06-e64c-7e42-9dc3-ca1633bdeed7";
  const newThreadId = "019e7e07-4c52-7752-8ca6-5e8033bf3fb9";

  let result = run(fixture, [
    "initialize",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--internal-design",
    "--internal-test",
    "--thread",
    `BaseWindow=${oldThreadId}`,
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = run(fixture, [
    "replace-windows",
    "--window",
    "BaseWindow",
    "--language",
    "zh",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.command, "replace-windows");
  assert.equal(plan.mode, "plan");
  assert.equal(plan.wrote, false);
  assert.equal(Object.hasOwn(plan.steps, "syncTemplates"), false);
  assert.equal(Object.hasOwn(plan.steps, "syncRootAgents"), false);
  assert.equal(Object.hasOwn(plan.steps, "writeAgents"), false);
  assert.deepEqual(plan.steps.windowLaunchPlan.replaceWindows, ["BaseWindow"]);
  assert.deepEqual(plan.steps.windowLaunchPlan.windows.map((item) => item.windowName), ["BaseWindow"]);
  assert.equal(plan.steps.windowLaunchPlan.windows[0].localRegistration.hostTool, "wakeflow_register_window");
  assert.equal(plan.steps.windowLaunchPlan.windows[0].localRegistration.handleSource, "create_thread.threadId");
  assert.deepEqual(plan.steps.windowLaunchPlan.windows[0].localRegistration.callTemplate, {
    root: fixture.control,
    window: "BaseWindow",
    windowHandle: "<create_thread.threadId>",
    apply: true,
  });

  result = run(fixture, [
    "replace-windows",
    "--window",
    "BaseWindow",
    "--thread",
    `BaseWindow=${newThreadId}`,
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const applied = JSON.parse(result.stdout);
  assert.equal(applied.command, "replace-windows");
  assert.equal(applied.mode, "apply");
  assert.equal(applied.steps.localWindows.results[0].replaceRequested, true);
  assert.equal(applied.steps.localWindows.results[0].replacedExistingThread, true);

  const registryPath = path.join(fixture.control, ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/BaseWindow.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  assert.equal(registry.threadId, newThreadId);
});

test("replace-window carries Codex create_thread model and thinking overrides from workspace config", () => {
  const fixture = makeFixture();
  const configPath = path.join(fixture.control, "wakeflow.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.hosts = {
    codex: {
      modelByRole: { default: "gpt-5.5" },
      thinkingByRole: { product: "high", default: "medium" },
    },
  };
  writeFile(configPath, JSON.stringify(config, null, 2));

  const plan = runJson(fixture, [
    "replace-window",
    "--window",
    "BaseWindow",
  ]);
  const entry = plan.steps.windowLaunchPlan.windows[0];
  assert.equal(entry.windowName, "BaseWindow");
  assert.equal(entry.hostCreateThread.required, true);
  assert.equal(entry.hostCreateThread.hostTool, "create_thread");
  assert.equal(entry.hostCreateThread.promptField, "createThreadPrompt");
  assert.equal(entry.hostCreateThread.thinking, "high");
  assert.equal(entry.hostCreateThread.thinkingSource, "wakeflow.config.json hosts.codex.thinkingByRole, falling back to the Wakeflow Codex profile");
  assert.equal(entry.hostCreateThread.model, "gpt-5.5");
  assert.equal(entry.hostCreateThread.modelSource, "wakeflow.config.json hosts.codex.modelByRole");
});

test("wakeflow_replace_windows MCP wrapper returns a scoped replacement plan", async () => {
  const fixture = makeFixture();
  const result = await handlers.wakeflow_replace_windows({
    root: fixture.control,
    windows: ["BaseWindow"],
    language: "zh",
  });

  assert.equal(result.ok, true, result.stderr || result.stdout);
  assert.equal(result.parsedJson.command, "replace-windows");
  assert.equal(result.parsedJson.mode, "plan");
  assert.deepEqual(result.parsedJson.steps.windowLaunchPlan.windows.map((item) => item.windowName), ["BaseWindow"]);
});

test("wakeflow_replace_windows(window) MCP wrapper returns one scoped replacement plan", async () => {
  const fixture = makeFixture();
  const result = await handlers.wakeflow_replace_windows({
    root: fixture.control,
    window: "BaseWindow",
    language: "zh",
  });

  assert.equal(result.ok, true, result.stderr || result.stdout);
  assert.equal(result.parsedJson.command, "replace-window");
  assert.equal(result.parsedJson.mode, "plan");
  assert.deepEqual(result.parsedJson.steps.windowLaunchPlan.windows.map((item) => item.windowName), ["BaseWindow"]);
  assert.equal(result.parsedJson.steps.windowLaunchPlan.windows[0].localRegistration.hostTool, "wakeflow_register_window");
  assert.deepEqual(result.parsedJson.steps.windowLaunchPlan.windows[0].localRegistration.callTemplate, {
    root: fixture.control,
    window: "BaseWindow",
    windowHandle: "<create_thread.threadId>",
    apply: true,
  });
});

test("wakeflow_register_window writes host-local registration atomically without exposing the handle", async () => {
  const fixture = makeFixture();
  const registryPath = path.join(
    fixture.control,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/BaseWindow.json",
  );
  const windowConfigPath = path.join(
    fixture.control,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/window-config/BaseWindow.json",
  );
  const firstHandle = "019e7e08-2078-7ec2-b1bf-a64d5adcd371";
  const secondHandle = "019e7e09-6da8-78d3-af4a-7ae8ad1a927b";

  const dryRun = await handlers.wakeflow_register_window({
    root: fixture.control,
    window: "BaseWindow",
    windowHandle: firstHandle,
    apply: false,
  });
  assert.equal(dryRun.ok, true, dryRun.stderr || dryRun.stdout);
  assert.equal(dryRun.parsedJson.wrote, false);
  assert.equal(dryRun.parsedJson.windowConfigWritten, false);
  assert.equal(existsSync(registryPath), false);
  assert.equal(existsSync(windowConfigPath), false);
  assert.doesNotMatch(JSON.stringify(dryRun), new RegExp(firstHandle));

  const applied = await handlers.wakeflow_register_window({
    root: fixture.control,
    window: "BaseWindow",
    windowHandle: firstHandle,
    apply: true,
  });
  assert.equal(applied.ok, true, applied.stderr || applied.stdout);
  assert.equal(applied.parsedJson.wrote, true);
  assert.equal(applied.parsedJson.threadRegistered, true);
  assert.equal(applied.parsedJson.registrationValid, true);
  assert.equal(applied.parsedJson.windowConfigWritten, true);
  assert.equal(applied.parsedJson.replacedExistingThread, false);
  assert.doesNotMatch(JSON.stringify(applied), new RegExp(firstHandle));
  assert.ok(applied.args.includes("<redacted>"));
  assert.equal(JSON.parse(readFileSync(registryPath, "utf8")).threadId, firstHandle);
  const windowConfig = JSON.parse(readFileSync(windowConfigPath, "utf8"));
  assert.equal(windowConfig.threadRegistered, true);
  assert.equal(windowConfig.dispatchable, true);
  assert.equal(Object.hasOwn(windowConfig, "threadId"), false);

  const replaced = await handlers.wakeflow_register_window({
    root: fixture.control,
    window: "BaseWindow",
    windowHandle: secondHandle,
    apply: true,
  });
  assert.equal(replaced.ok, true, replaced.stderr || replaced.stdout);
  assert.equal(replaced.parsedJson.replacedExistingThread, true);
  assert.doesNotMatch(JSON.stringify(replaced), new RegExp(secondHandle));
  assert.equal(JSON.parse(readFileSync(registryPath, "utf8")).threadId, secondHandle);
});

test("MCP tool order keeps controller review loop inside the host-visible prefix", () => {
  assert.deepEqual(tools.slice(0, 13).map((tool) => tool.name), [
    "wakeflow_status",
    "wakeflow_initialize_workspace",
    "wakeflow_replace_windows",
    "wakeflow_register_window",
    "wakeflow_create_demand",
    "wakeflow_add_task",
    "wakeflow_prepare_delivery",
    "wakeflow_record_delivery",
    "wakeflow_record_target_result",
    "wakeflow_review_pack",
    "wakeflow_reduce_results",
    "wakeflow_decide_review",
    "wakeflow_complete_demand",
  ]);
});

test("initialize MCP schema does not expose replacement-window compatibility input", () => {
  const initializeTool = tools.find((tool) => tool.name === "wakeflow_initialize_workspace");
  assert.ok(initializeTool);
  assert.equal(Object.hasOwn(initializeTool.inputSchema.properties, "replaceWindows"), false);
});

test("initialize rejects obsolete replacement-window flag before writing", () => {
  const fixture = makeFixture();
  const configPath = path.join(fixture.control, "wakeflow.config.json");
  const beforeConfig = readFileSync(configPath, "utf8");
  const result = run(fixture, [
    "initialize",
    "--replace-window",
    "BaseWindow",
    "--repo",
    "PluginWindow=../PluginWindow",
    "--thread",
    "BaseWindow=019e7e07-4c52-7752-8ca6-5e8033bf3fb9",
    "--write",
    "--json",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /initialize no longer accepts --replace-window/);
  assert.match(`${result.stdout}\n${result.stderr}`, /Use replace-window for one existing window/);
  assert.equal(readFileSync(configPath, "utf8"), beforeConfig);
  assert.equal(existsSync(path.join(fixture.parent, "AGENTS.md")), false);
});

test("initialized workspace requires explicit reset initialization and cleans stale managed windows", () => {
  const fixture = makeFixture();
  let result = run(fixture, [
    "initialize",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--repo",
    "PluginWindow=../PluginWindow",
    "--internal-design",
    "--internal-test",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const pluginAgentsPath = path.join(fixture.plugin, "AGENTS.md");
  const staleWindowConfigPath = path.join(fixture.control, ".wakeflow-local/wakeflow-delivery/hosts/codex/window-config/PluginWindow.json");
  assert.match(readFileSync(pluginAgentsPath, "utf8"), /wakeflow:scope:start/);
  assert.equal(existsSync(staleWindowConfigPath), true);

  result = run(fixture, [
    "initialize",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--internal-design",
    "--internal-test",
    "--write",
    "--json",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /existing Wakeflow initialization footprint/);
  assert.match(`${result.stdout}\n${result.stderr}`, /--reset-initialization/);
  assert.match(readFileSync(path.join(fixture.control, "wakeflow.config.json"), "utf8"), /PluginWindow/);
  assert.match(readFileSync(pluginAgentsPath, "utf8"), /wakeflow:scope:start/);

  result = run(fixture, [
    "initialize",
    "--reset-initialization",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--internal-design",
    "--internal-test",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.steps.resetInitializationCleanup.resetRequested, true);
  assert.deepEqual(payload.steps.resetInitializationCleanup.staleWindows, ["PluginWindow"]);
  const pluginAgents = readFileSync(pluginAgentsPath, "utf8");
  assert.match(pluginAgents, /Existing rule/);
  assert.doesNotMatch(pluginAgents, /wakeflow:scope:start/);
  assert.doesNotMatch(readFileSync(path.join(fixture.control, "wakeflow.config.json"), "utf8"), /PluginWindow/);
  assert.equal(existsSync(staleWindowConfigPath), false);
});

test("thread registration follow-up is allowed on an already-initialized workspace (no footprint block)", () => {
  const fixture = makeFixture();
  let result = run(fixture, [
    "initialize",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--internal-design",
    "--internal-test",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  // The launch plan's own registration argvTemplate is `initialize --thread
  // <window>=<id> --write`; it MUST succeed after init created the footprint,
  // otherwise no created window can ever register its thread id.
  result = run(fixture, [
    "initialize",
    "--thread",
    "BaseWindow=thread-real-001",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  const registryPath = path.join(fixture.control, ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/BaseWindow.json");
  assert.equal(existsSync(registryPath), true, "thread id is registered into the local registry");

  // a config-bearing re-init on the same workspace is still blocked
  const reinit = run(fixture, [
    "initialize",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--write",
    "--json",
  ]);
  assert.notEqual(reinit.status, 0, "config re-init stays guarded");
  assert.match(`${reinit.stdout}\n${reinit.stderr}`, /existing Wakeflow initialization footprint/);
});

test("dry-run initialize on an already-initialized workspace reports blocked instead of a green plan", () => {
  const fixture = makeFixture();
  run(fixture, ["initialize", "--repo", "BaseWindow=../BaseWindow", "--internal-design", "--internal-test", "--write", "--json"]);

  // dry-run with config selection must agree with what --write would do
  const dry = run(fixture, ["initialize", "--repo", "BaseWindow=../BaseWindow", "--json"]);
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const payload = JSON.parse(dry.stdout);
  assert.equal(payload.mode, "blocked-already-initialized");
  assert.equal(payload.alreadyInitialized, true);
  assert.match(payload.nextAction, /replace-window|reset-initialization/);
});

test("dry-run reset previews stale windows without deleting anything", () => {
  const fixture = makeFixture();
  run(fixture, ["initialize", "--repo", "BaseWindow=../BaseWindow", "--repo", "PluginWindow=../PluginWindow", "--internal-design", "--internal-test", "--write", "--json"]);
  const staleConfig = path.join(fixture.control, ".wakeflow-local/wakeflow-delivery/hosts/codex/window-config/PluginWindow.json");
  assert.equal(existsSync(staleConfig), true);

  const dry = run(fixture, ["initialize", "--reset-initialization", "--repo", "BaseWindow=../BaseWindow", "--internal-design", "--internal-test", "--json"]);
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const cleanup = JSON.parse(dry.stdout).steps.resetInitializationCleanup;
  assert.deepEqual(cleanup.staleWindows, ["PluginWindow"], "preview names the window apply would drop");
  assert.equal(cleanup.wrote, false);
  assert.equal(existsSync(staleConfig), true, "dry-run must not delete the stale window config");
});

test("reset cleanup also removes a legacy flat thread-registry entry (codex fallback)", () => {
  const fixture = makeFixture();
  run(fixture, ["initialize", "--repo", "BaseWindow=../BaseWindow", "--repo", "PluginWindow=../PluginWindow", "--internal-design", "--internal-test", "--write", "--json"]);
  const legacyDir = path.join(fixture.control, ".wakeflow-local/wakeflow-delivery/thread-registry");
  mkdirSync(legacyDir, { recursive: true });
  const legacyFile = path.join(legacyDir, "PluginWindow.json");
  writeFileSync(legacyFile, JSON.stringify({ threadId: "stale-legacy-id" }));

  run(fixture, ["initialize", "--reset-initialization", "--repo", "BaseWindow=../BaseWindow", "--internal-design", "--internal-test", "--write", "--json"]);
  assert.equal(existsSync(legacyFile), false, "reset clears the legacy registry so no stale id survives the fallback");
});

test("replace-window requires an initialized workspace", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wf-uninit-"));
  const control = path.join(parent, "Wakeflow");
  mkdirSync(path.join(control, "scripts"), { recursive: true });
  const result = run({ control }, ["replace-window", "--window", "Design", "--write", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /requires an initialized workspace/);
});

test("initialize use-discovered supports excluding product windows before config and launch plan", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-target-exclude-"));
  mkdirSync(path.join(parent, "AppRepo", ".git"), { recursive: true });
  mkdirSync(path.join(parent, "ScratchRepo", ".git"), { recursive: true });

  const result = runAt(parent, [
    "initialize",
    "--use-discovered",
    "--exclude-window",
    "ScratchRepo",
    "--internal-design",
    "--internal-test",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const config = JSON.parse(readFileSync(path.join(parent, "wakeflow.config.json"), "utf8"));
  assert.deepEqual(
    config.repositories.map((repo) => repo.windowName),
    ["AppRepo", "Design", "Test"],
  );
  assert.deepEqual(
    payload.steps.windowLaunchPlan.windows.map((item) => item.windowName),
    [path.basename(parent), "AppRepo", "Design", "Test"],
  );
});

test("prompts use sibling Wakeflow script paths for child windows", () => {
  const fixture = makeFixture();
  const payload = runJson(fixture, ["prompts", "--window", "BaseWindow"]);
  assert.equal(payload.prompts.length, 1);
  assert.equal(payload.prompts[0].displayTitle, "BaseWindow Work");
  assert.match(payload.prompts[0].prompt, /BaseWindow Work: initialization entry sync, not a task delivery/);
  assert.match(payload.prompts[0].prompt, /entry sync complete; waiting for controller task/);
  assert.match(payload.prompts[0].prompt, /AGENTS\.md, \.\.\/AGENTS\.md, \.\.\/Wakeflow\/\.wakeflow-active\/index\.md/);
  assert.match(payload.prompts[0].prompt, /node \.\.\/Wakeflow\/scripts\/wakeflow-setup\.mjs status --json/);

  const zhDutyWindow = "\u804c\u8d23\u7a97\u53e3";
  const zhFirstRead = "\u5148\u8bfb\u53d6";
  const zhPayload = runJson(fixture, ["prompts", "--window", "BaseWindow", "--language", "zh"]);
  assert.equal(zhPayload.language, "zh");
  assert.equal(zhPayload.prompts[0].displayTitle, `BaseWindow ${zhDutyWindow}`);
  assert.match(zhPayload.prompts[0].prompt, new RegExp(`^BaseWindow ${zhDutyWindow}`));
  assert.match(zhPayload.prompts[0].prompt, new RegExp(zhFirstRead));
});

test("English launch titles avoid repeated role words", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-title-en-"));
  mkdirSync(path.join(parent, "Alembic", ".git"), { recursive: true });
  const result = runAt(parent, [
    "initialize",
    "--repo",
    "Controller=.",
    "--repo",
    "Alembic=Alembic",
    "--internal-design",
    "--internal-test",
    "--controller-window",
    "Controller",
    "--language",
    "en",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const titles = Object.fromEntries(
    payload.steps.windowLaunchPlan.windows.map((item) => [item.windowName, item.displayTitle]),
  );
  assert.equal(titles.Controller, `${path.basename(parent)} Controller`);
  assert.equal(titles.Alembic, "Alembic Work");
  assert.equal(titles.Design, `${path.basename(parent)} Design`);
  assert.equal(titles.Test, `${path.basename(parent)} Test`);
  assert.doesNotMatch(JSON.stringify(titles), /Controller Controller|Design Design|Test Test|Responsibility Window/);
});

test("write-agents is dry-run by default and writes managed access cards with --write", () => {
  const fixture = makeFixture();
  let payload = runJson(fixture, ["write-agents", "--window", "BaseWindow"]);
  assert.equal(payload.results[0].changed, true);
  assert.equal(payload.results[0].wrote, false);
  assert.equal(existsSync(path.join(fixture.base, "AGENTS.md")), false);

  payload = runJson(fixture, ["write-agents", "--window", "BaseWindow", "--write"]);
  assert.equal(payload.results[0].wrote, true);
  const baseAgents = readFileSync(path.join(fixture.base, "AGENTS.md"), "utf8");
  assert.match(baseAgents, /wakeflow:scope:start/);
  assert.match(baseAgents, /## Workspace Access Card/);
  assert.match(baseAgents, /records this window access coordinates and the minimum automation gate/);
  assert.match(baseAgents, /Window name: `BaseWindow`/);
  assert.match(baseAgents, /Parent workspace AGENTS: `\.\.\/AGENTS\.md`/);
  assert.match(baseAgents, /Active workspace index: `\.\.\/Wakeflow\/\.wakeflow-active\/index\.md`/);
  assert.match(baseAgents, /Current plan directory: `\.\.\/Wakeflow\/\.wakeflow-active\/current`/);
  assert.match(baseAgents, /Window ledger: `\.\.\/wakeflow-ledger\/BaseWindow`/);
  assert.match(baseAgents, /Direct-thread delivery is the normal work transport/);
  assert.match(baseAgents, /Delivery prompts carry only a few dynamic variables and a skill pointer/);
  assert.match(baseAgents, /visible `currentWindow` \/ `taskId` \/ `stateRoot` \/ optional `dispatchGroup`/);
  assert.match(baseAgents, /Machine fields such as `controllerWindow`, `returnPolicy`, `humanContextRef`, and `stateRevision`/);
  assert.match(baseAgents, /returns `TargetResultEnvelope`/);
  assert.match(baseAgents, /The full group snapshot stays in the controller-return envelope/);
  assert.match(baseAgents, /Codex subagents are recommended for bounded parallel assistance/);
  assert.match(baseAgents, /Functional Completeness Self-Check/);
  assert.match(baseAgents, /Do not rely on the controller to discover obvious gaps/);
  assert.match(baseAgents, /do not downgrade a complete capability into a thin adapter/);
  assert.match(baseAgents, /return `blocked` or `needs-review`/);
  assert.doesNotMatch(baseAgents, /controlPlan/);
  assert.doesNotMatch(baseAgents, /backfill must include completion scope/);
  assert.doesNotMatch(baseAgents, /downgrade complete capability into thin implementation/);

  runJson(fixture, [
    "configure",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--repo",
    "PluginWindow=../PluginWindow",
    "--write",
  ]);
  payload = runJson(fixture, ["write-agents", "--window", "PluginWindow", "--write"]);
  assert.equal(payload.results[0].wrote, true);
  const pluginAgents = readFileSync(path.join(fixture.plugin, "AGENTS.md"), "utf8");
  assert.match(pluginAgents, /Existing rule/);
  assert.match(pluginAgents, /## Workspace Access Card[\s\S]+Existing rule/);
  assert.match(pluginAgents, /Window name: `PluginWindow`/);
});

test("access-profiles reports managed child access-card coordinates and automation gates", () => {
  const fixture = makeFixture();
  let payload = runJson(fixture, ["access-profiles", "--window", "BaseWindow"]);
  assert.equal(payload.command, "access-profiles");
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.profiles[0].issues, [
    "managed repository AGENTS.md missing",
    "managed access card missing",
  ]);

  runJson(fixture, ["write-agents", "--window", "BaseWindow", "--write"]);
  payload = runJson(fixture, ["access-profiles", "--window", "BaseWindow"]);
  const profile = payload.profiles[0];
  assert.equal(payload.ok, true);
  assert.equal(profile.ok, true);
  assert.equal(profile.windowName, "BaseWindow");
  assert.equal(profile.coordinates.parentAgents, "../AGENTS.md");
  assert.equal(profile.coordinates.activeIndex, "../Wakeflow/.wakeflow-active/index.md");
  assert.equal(profile.coordinates.windowLedger, "../wakeflow-ledger/BaseWindow");
  assert.equal(profile.coordinateChecks.every((check) => check.ok), true);
  assert.equal(profile.automationChecks.every((check) => check.ok), true);
});

test("write-agents can explicitly include unmanaged Design/Test windows while skipping real projects", () => {
  const fixture = makeFixture();
  const design = path.join(fixture.parent, "Design");
  const testWindow = path.join(fixture.parent, "Test");
  const realProject = path.join(fixture.parent, "SampleProject");
  mkdirSync(design, { recursive: true });
  mkdirSync(testWindow, { recursive: true });
  mkdirSync(realProject, { recursive: true });

  runJson(fixture, [
    "configure",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--repo",
    "Design=../Design",
    "--repo",
    "Test=../Test",
    "--repo",
    "SampleProject=../SampleProject",
    "--real-project-window",
    "SampleProject",
    "--write",
  ]);

  const payload = runJson(fixture, ["write-agents", "--all", "--include-unmanaged", "--write"]);
  assert.deepEqual(
    payload.results.map((result) => result.windowName),
    ["BaseWindow", "Design", "Test"],
  );
  assert.equal(existsSync(path.join(realProject, "AGENTS.md")), false);

  const designAgents = readFileSync(path.join(design, "AGENTS.md"), "utf8");
  assert.match(designAgents, /Window name: `Design`/);
  assert.match(designAgents, /### Skill Assistance/);
  assert.match(designAgents, /Design work should proactively surface relevant local Design skills/);
  assert.match(designAgents, /name the smallest matching skill/);
  assert.match(designAgents, /Functional Completeness Self-Check/);
  assert.match(designAgents, /Do not rely on the controller to discover obvious gaps/);
  assert.doesNotMatch(designAgents, /must not dispatch implementation/);

  const testAgents = readFileSync(path.join(testWindow, "AGENTS.md"), "utf8");
  assert.match(testAgents, /Window name: `Test`/);
  assert.match(testAgents, /Test exchange projection: `\.\.\/Wakeflow\/\.wakeflow-active\/current\/test-exchange\.md`/);
  assert.match(testAgents, /Non-Test windows must not create, process, or verify Test delivery/);
  assert.match(testAgents, /### Skill Assistance/);
  assert.match(testAgents, /Test work should proactively surface relevant local Test skills/);
  assert.match(testAgents, /validating long chains/);
  assert.match(testAgents, /Functional Completeness Self-Check/);
  assert.match(testAgents, /Do not rely on the controller to discover obvious gaps/);
  assert.doesNotMatch(testAgents, /default test queue/);
});

test("write-agents supports multiple workspace windows sharing one AGENTS.md", () => {
  const fixture = makeFixture();
  const sharedTest = path.join(fixture.parent, "SharedTest");
  mkdirSync(sharedTest, { recursive: true });
  const configPath = path.join(fixture.control, "wakeflow.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.testWindow = "TestWindow";
  config.repositories = [
    { windowName: "BaseWindow", path: "../BaseWindow", role: "Base runtime", managedAgents: true },
    { windowName: "TestIDE", path: "../SharedTest", role: "IDE test", managedAgents: false },
    { windowName: "TestWindow", path: "../SharedTest", role: "Real test", managedAgents: false },
  ];
  writeFile(configPath, JSON.stringify(config, null, 2));

  const payload = runJson(fixture, ["write-agents", "--all", "--include-unmanaged", "--write"]);
  assert.deepEqual(
    payload.results.map((result) => result.windowName),
    ["BaseWindow", "TestIDE", "TestWindow"],
  );

  const sharedAgents = readFileSync(path.join(sharedTest, "AGENTS.md"), "utf8");
  assert.match(sharedAgents, /Window aliases for this repository: `TestIDE` \/ `TestWindow`/);
  assert.match(sharedAgents, /Window ledgers for this repository:/);
  assert.match(sharedAgents, /`TestIDE`: `\.\.\/wakeflow-ledger\/TestIDE`/);
  assert.match(sharedAgents, /`TestWindow`: `\.\.\/wakeflow-ledger\/TestWindow`/);
  assert.match(sharedAgents, /only handles dispatch packets for the windows listed in this access card/);
  assert.match(sharedAgents, /Non-Test windows must not create, process, or verify TestWindow \/ TestIDE delivery/);
  assert.match(sharedAgents, /currentWindow/);
  assert.match(sharedAgents, /### Skill Assistance/);
  assert.match(sharedAgents, /Test work should proactively surface relevant local Test skills/);

  const ideProfile = runJson(fixture, ["access-profiles", "--window", "TestIDE"]).profiles[0];
  const testProfile = runJson(fixture, ["access-profiles", "--window", "TestWindow"]).profiles[0];
  assert.equal(ideProfile.ok, true);
  assert.equal(testProfile.ok, true);
});

test("sync-root-agents unpacks parent AGENTS with Wakeflow repo paths", () => {
  const fixture = makeFixture();
  let payload = runJson(fixture, ["sync-root-agents"]);
  assert.equal(payload.command, "sync-root-agents");
  assert.equal(payload.changed, true);
  assert.equal(payload.wrote, false);
  assert.equal(existsSync(path.join(fixture.parent, "AGENTS.md")), false);

  payload = runJson(fixture, ["sync-root-agents", "--write"]);
  assert.equal(payload.wrote, true);
  const rootAgents = readFileSync(path.join(fixture.parent, "AGENTS.md"), "utf8");
  assert.match(rootAgents, /wakeflow:root-agents:start/);
  assert.match(rootAgents, /# FixtureWorkspace Agent Instructions/);
  assert.match(rootAgents, /Wakeflow\/\.wakeflow-active\/index\.md|controller state roots/);
  assert.match(rootAgents, /cd Wakeflow && node scripts\/wakeflow-setup\.mjs sync-root-agents --write/);
  assert.match(rootAgents, /Wakeflow\/wakeflow\.config\.json/);
  assert.match(rootAgents, /## Controller Posture/);
  assert.match(rootAgents, /## Role Map/);
  assert.match(rootAgents, /The controller workspace owns cross-repository goal intake/);
  // The operator's stop-card / confirmation-gate discipline is no longer baked into the
  // reusable render; it lives in each workspace's own preserved Personal Operating Constraints.
  assert.doesNotMatch(rootAgents, /## Highest Stop Card/);
  assert.doesNotMatch(rootAgents, /## Confirmation Gates/);
  assert.doesNotMatch(rootAgents, /FixtureWorkspace is the controller workspace/);
  assert.doesNotMatch(rootAgents, /plugin form/);
  assert.doesNotMatch(rootAgents, /FixtureWorkspace repository/);
});

test("sync-templates creates internal Design and Test surfaces when no external directories exist", () => {
  const fixture = makeFixture();
  runJson(fixture, [
    "configure",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--internal-design",
    "--internal-test",
    "--write",
  ]);
  const dryRun = runJson(fixture, ["sync-templates", "--all"]);
  assert.equal(dryRun.wrote, false);
  assert.equal(dryRun.results.some((result) => result.changed), true);

  const payload = runJson(fixture, ["sync-templates", "--all", "--write"]);
  assert.equal(payload.ok, true);
  assert.equal(payload.wrote, true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/AGENTS.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/.gitignore")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/docs/index.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/docs/current/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/docs/design-window-operating-policy.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/docs/workspace-alignment-checklist.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/templates/original-plan-template.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/templates/requirement-design-template.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/templates/workspace-signal-template.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/templates/workspace-handoff-template.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/skills/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/skills/requirement-clarification/SKILL.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/skills/option-planning/SKILL.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/skills/requirement-design/SKILL.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/skills/work-slicing/SKILL.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/skills/design-handoff/SKILL.md")), true);
  const designAgents = readFileSync(path.join(fixture.parent, "Design/AGENTS.md"), "utf8");
  assert.match(designAgents, /`skills\/README\.md`/);
  assert.match(designAgents, /skill-fit check/);
  assert.match(designAgents, /Default to chat first/);
  assert.match(designAgents, /not automatic file writers/);
  assert.match(designAgents, /whenever a requirement conversation matches a skill purpose/);
  assert.match(designAgents, /Functional Completeness Self-Check/);
  assert.match(designAgents, /Do not rely on the controller to discover obvious gaps/);
  assert.match(designAgents, /downgrade a complete/);
  assert.doesNotMatch(designAgents, /optional Design-local methods/);
  const designReadme = readFileSync(path.join(fixture.parent, "Design/README.md"), "utf8");
  assert.match(designReadme, /Design skill map: `skills\/README\.md`/);
  assert.match(designReadme, /conversational methods first/);
  assert.match(designReadme, /Wakeflow MCP/);
  assert.doesNotMatch(designReadme, /installed runtime import command/);
  assert.doesNotMatch(designReadme, /Default Design skills/);
  const designSkills = readFileSync(path.join(fixture.parent, "Design/skills/README.md"), "utf8");
  assert.match(designSkills, /Interaction Contract/);
  assert.match(designSkills, /Before selecting a skill, do a skill-fit check/);
  assert.match(designSkills, /proactively name the relevant skill/);
  assert.match(designSkills, /Do not create or update tracked Design documents/);
  const requirementClarification = readFileSync(path.join(fixture.parent, "Design/skills/requirement-clarification/SKILL.md"), "utf8");
  assert.match(requirementClarification, /Interaction First/);
  assert.match(requirementClarification, /Default to conversation/);
  assert.equal(existsSync(path.join(fixture.control, ".wakeflow-active/current/test-exchange.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/requirement-designs/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/goal-stage-confirmation/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/goal-stage-confirmation/process.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/workspace/todo-window-scheduling-policy.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/workspace/workspace-doc-archive-policy.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/workspace/archive/index.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/AGENTS.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/.gitignore")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/config/defaults.json")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/config/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/docs/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/docs/current/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/docs/current/test-window-alignment.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/scripts/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/skills/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/skills/test-strategy/SKILL.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/skills/debugging-and-triage/SKILL.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/skills/regression-design/SKILL.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/skills/evidence-review/SKILL.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/skills/progressive-chain-validation/SKILL.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/skills/progressive-chain-validation/references/metrics-contract.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/skills/progressive-chain-validation/templates/plan.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/docs/testing-operation-policy.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Test/templates/test-handoff-template.md")), true);
  const testAgents = readFileSync(path.join(fixture.parent, "Test/AGENTS.md"), "utf8");
  assert.match(testAgents, /`skills\/README\.md`/);
  assert.match(testAgents, /Skill Routing/);
  assert.match(testAgents, /proactively recommend the smallest matching Test skill/);
  assert.match(testAgents, /skills\/evidence-review\/SKILL\.md/);
  assert.match(testAgents, /Functional Completeness Self-Check/);
  assert.match(testAgents, /Do not rely on the controller to discover obvious gaps/);
  assert.match(testAgents, /downgrade a complete/);
  const testReadme = readFileSync(path.join(fixture.parent, "Test/README.md"), "utf8");
  assert.match(testReadme, /Test skill map: `skills\/README\.md`/);
  assert.match(testReadme, /Test skills are evidence methods first/);
  const testSkills = readFileSync(path.join(fixture.parent, "Test/skills/README.md"), "utf8");
  assert.match(testSkills, /How To Use These Skills/);
  assert.match(testSkills, /Use these skills proactively/);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/BaseWindow/README.md")), true);
});

test("external Design and Test directories get only alignment templates", () => {
  const fixture = makeFixture();
  const design = path.join(fixture.parent, "Design");
  const testWindow = path.join(fixture.parent, "Test");
  mkdirSync(design, { recursive: true });
  mkdirSync(testWindow, { recursive: true });
  runJson(fixture, [
    "configure",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--repo",
    "Design=../Design",
    "--repo",
    "Test=../Test",
    "--write",
  ]);

  const config = JSON.parse(readFileSync(path.join(fixture.control, "wakeflow.config.json"), "utf8"));

  const payload = runJson(fixture, ["sync-templates", "--all", "--write"]);
  assert.equal(payload.ok, true);
  assert.equal(existsSync(path.join(design, "docs/current/README.md")), true);
  assert.equal(existsSync(path.join(design, "docs/index.md")), true);
  assert.equal(existsSync(path.join(design, "docs/design-window-operating-policy.md")), true);
  assert.equal(existsSync(path.join(design, "docs/workspace-alignment-checklist.md")), true);
  assert.equal(existsSync(path.join(design, "templates/original-plan-template.md")), true);
  assert.equal(existsSync(path.join(design, "templates/requirement-design-template.md")), true);
  assert.equal(existsSync(path.join(design, "templates/workspace-signal-template.md")), true);
  assert.equal(existsSync(path.join(design, "templates/workspace-handoff-template.md")), true);
  assert.equal(existsSync(path.join(design, "skills/README.md")), true);
  assert.equal(existsSync(path.join(design, "skills/requirement-clarification/SKILL.md")), true);
  assert.equal(existsSync(path.join(design, "skills/option-planning/SKILL.md")), true);
  assert.equal(existsSync(path.join(design, "skills/requirement-design/SKILL.md")), true);
  assert.equal(existsSync(path.join(design, "skills/work-slicing/SKILL.md")), true);
  assert.equal(existsSync(path.join(design, "skills/design-handoff/SKILL.md")), true);
  assert.equal(existsSync(path.join(testWindow, "docs/current/test-window-alignment.md")), true);
  assert.equal(existsSync(path.join(testWindow, "docs/current/README.md")), true);
  assert.equal(existsSync(path.join(testWindow, "docs/README.md")), true);
  assert.equal(existsSync(path.join(testWindow, "config/defaults.json")), true);
  assert.equal(existsSync(path.join(testWindow, "scripts/README.md")), true);
  assert.equal(existsSync(path.join(testWindow, "skills/README.md")), true);
  assert.equal(existsSync(path.join(testWindow, "skills/test-strategy/SKILL.md")), true);
  assert.equal(existsSync(path.join(testWindow, "skills/debugging-and-triage/SKILL.md")), true);
  assert.equal(existsSync(path.join(testWindow, "skills/regression-design/SKILL.md")), true);
  assert.equal(existsSync(path.join(testWindow, "skills/evidence-review/SKILL.md")), true);
  assert.equal(existsSync(path.join(testWindow, "skills/progressive-chain-validation/SKILL.md")), true);
  assert.equal(existsSync(path.join(testWindow, "skills/progressive-chain-validation/references/metrics-contract.md")), true);
  assert.equal(existsSync(path.join(testWindow, "skills/progressive-chain-validation/templates/plan.md")), true);
  assert.equal(existsSync(path.join(testWindow, "docs/testing-operation-policy.md")), true);
  assert.equal(existsSync(path.join(testWindow, "templates/test-handoff-template.md")), true);
  assert.equal(existsSync(path.join(testWindow, "docs/current/test-exchange.md")), false);
});

test("ledger-paths reports per-window project ledger directories", () => {
  const fixture = makeFixture();
  const payload = runJson(fixture, ["ledger-paths"]);
  assert.equal(payload.command, "ledger-paths");
  assert.equal(payload.projectLedgerRoot, "../wakeflow-ledger");
  assert.equal(payload.windowLedgerRoot, "../wakeflow-ledger");
  assert.deepEqual(
    payload.repositories.map((repo) => [repo.windowName, repo.ledgerPath, repo.exampleDocument]),
    [
      ["BaseWindow", "../wakeflow-ledger/BaseWindow", "../wakeflow-ledger/BaseWindow/example-task-YYYY-MM-DD.md"],
    ],
  );
});
