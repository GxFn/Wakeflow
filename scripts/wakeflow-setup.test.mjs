#!/usr/bin/env node

import assert from "node:assert/strict";
import { runSync } from "../lib/wakeflow-process.mjs";
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

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
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
    path.join(control, "workspace.config.json"),
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
  return runSync("node", [installScript, ...args, "--root", fixture.control], {
    cwd: fixture.control,
    encoding: "utf8",
  });
}

function runAt(root, args) {
  return runSync("node", [installScript, ...args, "--root", root], {
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

test("configure writes user-confirmed sibling mappings into workspace.config.json", () => {
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
  const config = JSON.parse(readFileSync(path.join(fixture.control, "workspace.config.json"), "utf8"));
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
  assert.equal(config.designHandoffBoard, ".workspace-active/workspace/current/design-handoff-board.md");
  assert.equal(config.designHandoffInbox, ".workspace-active/workspace/current/design-handoff-inbox.md");
  assert.equal(config.testExchangePath, ".workspace-active/workspace/current/test-exchange.md");
  assert.equal(config.goalStageConfirmationDir, "../wakeflow-ledger/goal-stage-confirmation");
  assert.deepEqual(config.protectedWorkspacePrefixes, []);
});

test("sync-gitignore adds Wakeflow runtime entries idempotently", () => {
  const fixture = makeFixture();
  writeFile(path.join(fixture.control, ".gitignore"), ".workspace-local\nnode_modules/");

  const dryRun = runJson(fixture, ["sync-gitignore"]);
  assert.equal(dryRun.changed, true);
  assert.deepEqual(dryRun.missing, [".workspace-active/"]);
  assert.equal(dryRun.wakeflowManagedOnly, true);
  assert.match(dryRun.policy, /only manages its own runtime state entries/);
  assert.deepEqual(dryRun.entries, [".workspace-active/", ".workspace-local/"]);
  assert.ok(dryRun.forbiddenGeneratedEntries.includes("product repositories"));

  const first = runJson(fixture, ["sync-gitignore", "--write"]);
  assert.equal(first.wrote, true);
  const content = readFileSync(path.join(fixture.control, ".gitignore"), "utf8");
  assert.match(content, /^\.workspace-local$/m);
  assert.match(content, /^\.workspace-active\/$/m);
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

  const result = runSync("node", [installScript, "initialize", "--root", ".", "--json"], {
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
  assert.match(payload.steps.windowLaunchPlan.hostWorkflow.join("\n"), /set_thread_title/);
  assert.match(payload.steps.windowLaunchPlan.hostWorkflow.join("\n"), /not task deliveries/);
  assert.match(payload.steps.windowLaunchPlan.hostWorkflow.join("\n"), /Pass each returned real thread id once/);
  assert.match(payload.steps.windowLaunchPlan.hostWorkflow.join("\n"), /stores the id only in thread-registry/);
  assert.match(payload.steps.windowLaunchPlan.hostWorkflow.join("\n"), /\u5b50 agent/);
  assert.equal(controller.displayTitle, `${path.basename(parent)} ${zhControllerRole}`);
  assert.equal(app.displayTitle, `AppRepo ${zhDutyWindow}`);
  assert.equal(design.displayTitle, `Design ${zhDesignWindow}`);
  assert.equal(app.promptPurpose, "initialization-entry-sync");
  assert.deepEqual(app.titleReset, {
    required: true,
    hostTool: "set_thread_title",
    title: `AppRepo ${zhDutyWindow}`,
  });
  assert.equal(app.localRegistration.required, true);
  assert.equal(app.localRegistration.command, "wakeflow-setup initialize");
  assert.equal(app.localRegistration.threadIdAuthority, ".workspace-local/wakeflow-delivery/thread-registry/AppRepo.json");
  assert.equal(app.localRegistration.derivedStatusView, ".workspace-local/wakeflow-delivery/window-config/AppRepo.json");
  assert.equal(app.localRegistration.trackedDocsContainThreadIds, false);
  assert.ok(app.localRegistration.argvTemplate.includes("--thread"));
  assert.ok(app.localRegistration.argvTemplate.includes("AppRepo=<createdThreadId>"));
  assert.equal(app.localRegistration.argvTemplate.includes("--thread-title"), false);
  assert.equal(app.localRegistration.argvTemplate.includes("--thread-role"), false);
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

  const config = JSON.parse(readFileSync(path.join(parent, "workspace.config.json"), "utf8"));
  assert.equal(config.workspaceRoot, ".");
  assert.equal(config.runtimeMode, "plugin");
  assert.equal(config.projectLedgerRoot, "wakeflow-ledger");
  assert.deepEqual(config.protectedWorkspacePrefixes, ["AppRepo/"]);
  assert.equal(payload.steps.gitignore.wrote, true);
  const gitignore = readFileSync(path.join(parent, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.workspace-active\/$/m);
  assert.match(gitignore, /^\.workspace-local\/$/m);
  assert.doesNotMatch(gitignore, /^\.DS_Store$/m);
  assert.doesNotMatch(gitignore, /^AppRepo\/$/m);
  assert.doesNotMatch(gitignore, /^Design\/$/m);
  assert.doesNotMatch(gitignore, /^Test\/$/m);
  assert.equal(config.designHandoffInbox, ".workspace-active/workspace/current/design-handoff-inbox.md");
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
  assert.match(rootAgents, /workspace\.config\.json/);
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
  assert.match(appAgents, /Active workspace index: `\.\.\/\.workspace-active\/workspace\/index\.md`/);
  assert.equal(existsSync(path.join(parent, "Design/AGENTS.md")), true);
  assert.equal(existsSync(path.join(parent, "Test/AGENTS.md")), true);
  assert.equal(existsSync(path.join(parent, "scripts/README.md")), false);
  assert.equal(existsSync(path.join(parent, ".workspace-active/workspace/current/design-handoff-inbox.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/requirement-designs/README.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/goal-stage-confirmation/README.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/goal-stage-confirmation/process.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/workspace/requirement-to-wave-execution-flow.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/workspace/todo-window-scheduling-policy.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/workspace/workspace-doc-archive-policy.md")), true);
  assert.equal(existsSync(path.join(parent, "wakeflow-ledger/workspace/archive/index.md")), true);
  assert.equal(existsSync(path.join(parent, "Wakeflow")), false);
  const currentStatus = readFileSync(path.join(parent, ".workspace-active/workspace/current/workspace-current-status.md"), "utf8");
  assert.match(currentStatus, new RegExp(`# ${path.basename(parent)} Current Status`));
  assert.match(currentStatus, new RegExp(`Controller window: ${path.basename(parent)}`));
  assert.doesNotMatch(currentStatus, /Controller window: Wakeflow/);
  assert.match(currentStatus, /Wakeflow MCP `wakeflow_init_demand` tool/);
  assert.doesNotMatch(currentStatus, /node scripts\/wakeflow-state\.mjs/);
  assert.match(currentStatus, /Status: idle \/ initialization ready \/ waiting for controller task/);
  assert.match(currentStatus, /Entry-sync windows should report readiness and stop/);
  assert.match(currentStatus, new RegExp(`\\| ${path.basename(parent)} \\| idle \\| No active demand; waiting for controller task\\. \\| Initialization ready state\\. \\|`));
  const workspaceIndex = readFileSync(path.join(parent, ".workspace-active/workspace/index.md"), "utf8");
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
    path.join(parent, "workspace.config.json"),
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
  const config = JSON.parse(readFileSync(path.join(parent, "workspace.config.json"), "utf8"));
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
  const currentStatus = readFileSync(path.join(parent, ".workspace-active/workspace/current/workspace-current-status.md"), "utf8");
  assert.match(currentStatus, /# AlembicWorkspace Current Status/);
  assert.match(currentStatus, /Controller window: AlembicWorkspace/);
  assert.doesNotMatch(currentStatus, /Controller window: Wakeflow/);
});

test("initialize refreshes stale starter controller identity without overwriting active demand status", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stale-status-"));
  mkdirSync(path.join(parent, "AppRepo", ".git"), { recursive: true });
  writeFile(
    path.join(parent, ".workspace-active/workspace/current/workspace-current-status.md"),
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
    "--repo",
    "AppRepo=AppRepo",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const statusResult = payload.steps.syncTemplates.results.find((item) => item.label === "active current status");
  assert.equal(statusResult.refreshedStarter, true);

  const currentStatus = readFileSync(path.join(parent, ".workspace-active/workspace/current/workspace-current-status.md"), "utf8");
  assert.match(currentStatus, new RegExp(`# ${path.basename(parent)} Current Status`));
  assert.match(currentStatus, new RegExp(`Controller window: ${path.basename(parent)}`));
  assert.match(currentStatus, /Status: idle \/ initialization ready \/ waiting for controller task/);
  assert.match(currentStatus, new RegExp(`\\| ${path.basename(parent)} \\| idle \\| No active demand; waiting for controller task\\. \\| Initialization ready state\\. \\|`));
  assert.match(currentStatus, /Wakeflow MCP `wakeflow_init_demand` tool/);
  assert.doesNotMatch(currentStatus, /node scripts\/wakeflow-state\.mjs/);
  assert.doesNotMatch(currentStatus, /Controller window: Wakeflow/);

  writeFile(
    path.join(parent, ".workspace-active/workspace/current/workspace-current-status.md"),
    `# Custom Current Status

Controller window: Wakeflow
Status: active

## Status Summary

- Active demand: REAL-DEMAND
- Keep this active status.`,
  );

  const activeResult = runAt(parent, [
    "initialize",
    "--repo",
    "AppRepo=AppRepo",
    "--write",
    "--json",
  ]);
  assert.equal(activeResult.status, 0, activeResult.stderr || activeResult.stdout);
  const activeStatus = readFileSync(path.join(parent, ".workspace-active/workspace/current/workspace-current-status.md"), "utf8");
  assert.match(activeStatus, /# Custom Current Status/);
  assert.match(activeStatus, /Active demand: REAL-DEMAND/);

  writeFile(
    path.join(parent, ".workspace-active/workspace/current/workspace-current-status.md"),
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
| Active workspace | ../../.workspace-active/workspace/ | Current index. |
| Local demand queue | ../requirement-designs/local-demand/ | Local rebuilt queue that must survive template sync. |`,
  );

  const queueResult = runAt(parent, [
    "initialize",
    "--repo",
    "AppRepo=AppRepo",
    "--write",
    "--json",
  ]);
  assert.equal(queueResult.status, 0, queueResult.stderr || queueResult.stdout);
  const queueStatus = readFileSync(path.join(parent, ".workspace-active/workspace/current/workspace-current-status.md"), "utf8");
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
  assert.equal(existsSync(path.join(fixture.control, ".workspace-active/workspace/current/design-handoff-board.md")), true);
  assert.equal(existsSync(path.join(fixture.control, ".workspace-active/workspace/current/design-handoff-inbox.md")), true);
  assert.equal(existsSync(path.join(fixture.control, ".workspace-active/workspace/current/test-exchange.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/requirement-designs/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/goal-stage-confirmation/process.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/workspace/requirement-to-wave-execution-flow.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "wakeflow-ledger/workspace/archive/index.md")), true);

  const registryPath = path.join(fixture.control, ".workspace-local/wakeflow-delivery/thread-registry/FixtureWorkspace.json");
  const windowConfigPath = path.join(fixture.control, ".workspace-local/wakeflow-delivery/window-config/FixtureWorkspace.json");
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

  const baseWindowConfigPath = path.join(fixture.control, ".workspace-local/wakeflow-delivery/window-config/BaseWindow.json");
  const baseWindowConfig = JSON.parse(readFileSync(baseWindowConfigPath, "utf8"));
  assert.equal(baseWindowConfig.threadRegistered, false);
  assert.equal(baseWindowConfig.deliveryRole, "target");
  const currentStatus = readFileSync(path.join(fixture.control, ".workspace-active/workspace/current/workspace-current-status.md"), "utf8");
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

test("initialize can replace one registered window thread without rebuilding every window", () => {
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
    "initialize",
    "--replace-window",
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
  assert.equal(payload.steps.windowLaunchPlan.replacementMode, true);
  assert.deepEqual(payload.steps.windowLaunchPlan.replaceWindows, ["BaseWindow"]);
  assert.deepEqual(payload.steps.windowLaunchPlan.windows.map((item) => item.windowName), ["BaseWindow"]);
  assert.equal(payload.steps.windowLaunchPlan.windows[0].displayTitle, `BaseWindow ${zhDutyWindow}`);
  assert.equal(payload.steps.windowLaunchPlan.windows[0].titleReset.title, `BaseWindow ${zhDutyWindow}`);

  const replaced = payload.steps.localWindows.results.find((item) => item.windowName === "BaseWindow");
  assert.equal(replaced.replaceRequested, true);
  assert.equal(replaced.replacedExistingThread, true);
  assert.equal(replaced.threadIdRedacted, true);

  const registryPath = path.join(fixture.control, ".workspace-local/wakeflow-delivery/thread-registry/BaseWindow.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  assert.equal(registry.threadId, newThreadId);
  assert.equal(Object.hasOwn(registry, "displayTitle"), false);
  assert.equal(Object.hasOwn(registry, "deliveryRole"), false);
});

test("initialize replacement apply fails closed until the new real thread id is registered locally", () => {
  const fixture = makeFixture();
  const result = run(fixture, ["initialize", "--replace-window", "BaseWindow", "--write", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /requires a new --thread Window=<realThreadId>/);
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
  const config = JSON.parse(readFileSync(path.join(parent, "workspace.config.json"), "utf8"));
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
  assert.match(payload.prompts[0].prompt, /AGENTS\.md, \.\.\/AGENTS\.md, \.\.\/Wakeflow\/\.workspace-active\/workspace\/index\.md/);
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
  assert.match(baseAgents, /Active workspace index: `\.\.\/Wakeflow\/\.workspace-active\/workspace\/index\.md`/);
  assert.match(baseAgents, /Current plan directory: `\.\.\/Wakeflow\/\.workspace-active\/workspace\/current`/);
  assert.match(baseAgents, /Window ledger: `\.\.\/wakeflow-ledger\/BaseWindow`/);
  assert.match(baseAgents, /Direct-thread delivery is the normal work transport/);
  assert.match(baseAgents, /Delivery prompts carry only a few dynamic variables and a skill pointer/);
  assert.match(baseAgents, /visible `currentWindow` \/ `taskId` \/ `stateRoot` \/ optional `dispatchGroup`/);
  assert.match(baseAgents, /Machine fields such as `controllerWindow`, `returnPolicy`, `humanContextRef`, and `stateRevision`/);
  assert.match(baseAgents, /returns `TargetResultEnvelope`/);
  assert.match(baseAgents, /The full group snapshot stays in the controller-return envelope/);
  assert.match(baseAgents, /Codex subagents are recommended for bounded parallel assistance/);
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
  assert.equal(profile.coordinates.activeIndex, "../Wakeflow/.workspace-active/workspace/index.md");
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
  assert.match(designAgents, /Design handoff board: `docs\/current\/workspace-handoff-board\.md`/);
  assert.match(designAgents, /### Skill Assistance/);
  assert.match(designAgents, /Design work should proactively surface relevant local Design skills/);
  assert.match(designAgents, /name the smallest matching skill/);
  assert.doesNotMatch(designAgents, /must not dispatch implementation/);

  const testAgents = readFileSync(path.join(testWindow, "AGENTS.md"), "utf8");
  assert.match(testAgents, /Window name: `Test`/);
  assert.match(testAgents, /Test exchange projection: `\.\.\/Wakeflow\/\.workspace-active\/workspace\/current\/test-exchange\.md`/);
  assert.match(testAgents, /Non-Test windows must not create, process, or verify Test delivery/);
  assert.match(testAgents, /### Skill Assistance/);
  assert.match(testAgents, /Test work should proactively surface relevant local Test skills/);
  assert.match(testAgents, /validating long chains/);
  assert.doesNotMatch(testAgents, /default test queue/);
});

test("write-agents supports multiple workspace windows sharing one AGENTS.md", () => {
  const fixture = makeFixture();
  const sharedTest = path.join(fixture.parent, "SharedTest");
  mkdirSync(sharedTest, { recursive: true });
  const configPath = path.join(fixture.control, "workspace.config.json");
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
  assert.match(rootAgents, /Wakeflow\/\.workspace-active\/workspace\/index\.md|controller state roots/);
  assert.match(rootAgents, /cd Wakeflow && node scripts\/wakeflow-setup\.mjs sync-root-agents --write/);
  assert.match(rootAgents, /Wakeflow\/workspace\.config\.json/);
  assert.match(rootAgents, /## Gate Flow/);
  assert.match(rootAgents, /## Role Map/);
  assert.match(rootAgents, /The controller workspace owns cross-repository goal intake/);
  assert.match(rootAgents, /## Highest Stop Card/);
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
  assert.equal(existsSync(path.join(fixture.control, ".workspace-active/workspace/current/design-handoff-board.md")), true);
  assert.equal(existsSync(path.join(fixture.control, ".workspace-active/workspace/current/design-handoff-inbox.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/AGENTS.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/.gitignore")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/docs/index.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/docs/current/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "Design/docs/current/workspace-handoff-board.md")), true);
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
  assert.doesNotMatch(designAgents, /optional Design-local methods/);
  const designReadme = readFileSync(path.join(fixture.parent, "Design/README.md"), "utf8");
  assert.match(designReadme, /Design skill map: `skills\/README\.md`/);
  assert.match(designReadme, /conversational methods first/);
  assert.match(designReadme, /Wakeflow MCP/);
  assert.doesNotMatch(designReadme, /installed runtime import command/);
  assert.doesNotMatch(designReadme, /Default Design skills/);
  const designBoard = readFileSync(path.join(fixture.parent, "Design/docs/current/workspace-handoff-board.md"), "utf8");
  assert.match(designBoard, /controller MCP intake\s+surface/);
  const designSkills = readFileSync(path.join(fixture.parent, "Design/skills/README.md"), "utf8");
  assert.match(designSkills, /Interaction Contract/);
  assert.match(designSkills, /Before selecting a skill, do a skill-fit check/);
  assert.match(designSkills, /proactively name the relevant skill/);
  assert.match(designSkills, /Do not create or update tracked Design documents/);
  const requirementClarification = readFileSync(path.join(fixture.parent, "Design/skills/requirement-clarification/SKILL.md"), "utf8");
  assert.match(requirementClarification, /Interaction First/);
  assert.match(requirementClarification, /Default to conversation/);
  assert.equal(existsSync(path.join(fixture.control, ".workspace-active/workspace/current/test-exchange.md")), true);
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

  const config = JSON.parse(readFileSync(path.join(fixture.control, "workspace.config.json"), "utf8"));
  assert.equal(config.designHandoffBoard, "../Design/docs/current/workspace-handoff-board.md");

  const payload = runJson(fixture, ["sync-templates", "--all", "--write"]);
  assert.equal(payload.ok, true);
  assert.equal(existsSync(path.join(design, "docs/current/workspace-handoff-board.md")), true);
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
