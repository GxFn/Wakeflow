#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
const installScript = path.join(workspaceRoot, "scripts/control-workspace-install.mjs");

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
        controlWindow: "FixtureWorkspace",
        workspaceRoot: "..",
        controlRepoDir: "Wakeflow",
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
  return spawnSync("node", [installScript, ...args, "--root", fixture.control], {
    cwd: fixture.control,
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
  assert.equal(config.controlRepoDir, "Wakeflow");
  assert.deepEqual(config.repoNames, ["BaseWindow", "PluginWindow"]);
  assert.deepEqual(
    config.repositories.map((repo) => [repo.windowName, repo.path]),
    [
      ["BaseWindow", "../BaseWindow"],
      ["PluginWindow", "../PluginWindow"],
      ["DesignWindow", "../workspace-ledger/design"],
      ["TestWindow", "../workspace-ledger/testing"],
    ],
  );
  assert.equal(config.designHandoffBoard, ".workspace-active/workspace/current/design-handoff-board.md");
  assert.equal(config.testExchangePath, ".workspace-active/workspace/current/test-exchange.md");
});

test("initialize without selection returns discovery and writes nothing", () => {
  const fixture = makeFixture();
  const payload = runJson(fixture, ["initialize"]);
  assert.equal(payload.command, "initialize");
  assert.equal(payload.mode, "discovery");
  assert.equal(payload.requiresUserSelection, true);
  assert.equal(payload.wrote, false);
  assert.deepEqual(
    payload.discovery.discoveredRepositories.map((repo) => repo.name),
    ["BaseWindow", "PluginWindow"],
  );
  assert.equal(existsSync(path.join(fixture.parent, "AGENTS.md")), false);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/design/AGENTS.md")), false);
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
    "--thread-role",
    "FixtureWorkspace=controller",
    "--thread-title",
    "FixtureWorkspace=Fixture control",
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
  assert.equal(payload.steps.localWindows.results[0].threadIdRedacted, true);

  assert.equal(existsSync(path.join(fixture.parent, "AGENTS.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/design/AGENTS.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/testing/AGENTS.md")), true);
  assert.equal(existsSync(path.join(fixture.control, ".workspace-active/workspace/current/design-handoff-board.md")), true);
  assert.equal(existsSync(path.join(fixture.control, ".workspace-active/workspace/current/test-exchange.md")), true);

  const registryPath = path.join(fixture.control, ".workspace-local/codex-automation-loop/thread-registry/FixtureWorkspace.json");
  const windowConfigPath = path.join(fixture.control, ".workspace-local/codex-automation-loop/window-config/FixtureWorkspace.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const windowConfig = JSON.parse(readFileSync(windowConfigPath, "utf8"));
  assert.equal(registry.threadId, threadId);
  assert.equal(registry.deliveryRole, "controller");
  assert.equal(windowConfig.threadRegistered, true);
  assert.equal(windowConfig.deliveryRole, "controller");
  assert.equal(Object.hasOwn(windowConfig, "threadId"), false);
});

test("prompts use sibling control script paths for child windows", () => {
  const fixture = makeFixture();
  const payload = runJson(fixture, ["prompts", "--window", "BaseWindow"]);
  assert.equal(payload.prompts.length, 1);
  assert.match(payload.prompts[0].prompt, /你是 BaseWindow 子窗口/);
  assert.match(payload.prompts[0].prompt, /AGENTS\.md、\.\.\/AGENTS\.md、\.\.\/Wakeflow\/\.workspace-active\/workspace\/index\.md/);
  assert.match(payload.prompts[0].prompt, /node \.\.\/Wakeflow\/scripts\/control-workspace-install\.mjs status --json/);
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
  assert.match(baseAgents, /## Workspace 接入卡/);
  assert.match(baseAgents, /只记录本窗口接入坐标和自动化最小门禁/);
  assert.match(baseAgents, /Window name: `BaseWindow`/);
  assert.match(baseAgents, /Parent workspace AGENTS: `\.\.\/AGENTS\.md`/);
  assert.match(baseAgents, /Active workspace index: `\.\.\/Wakeflow\/\.workspace-active\/workspace\/index\.md`/);
  assert.match(baseAgents, /Current plan directory: `\.\.\/Wakeflow\/\.workspace-active\/workspace\/current`/);
  assert.match(baseAgents, /Window ledger: `\.\.\/workspace-ledger\/BaseWindow`/);
  assert.match(baseAgents, /Direct-thread delivery 是正常工作投递流水线/);
  assert.match(baseAgents, /Delivery prompt 只承载少量动态变量和 skill 指向/);
  assert.match(baseAgents, /可见变量只需要 `currentWindow` \/ `taskId` \/ `stateRoot` \/ 可选 `dispatchGroup`/);
  assert.match(baseAgents, /`controllerWindow`、`returnPolicy`、`humanContextRef`、`stateRevision` 等机器字段从 state root、dispatch group 和 delivery envelope 读取/);
  assert.match(baseAgents, /返回 `TargetResultEnvelope`/);
  assert.match(baseAgents, /完整 group snapshot 留在 controller-return envelope/);
  assert.doesNotMatch(baseAgents, /controlPlan/);
  assert.doesNotMatch(baseAgents, /回填必须包含完成范围/);
  assert.doesNotMatch(baseAgents, /可以在本窗口 \/ 本仓库边界内使用 Codex 子 agent/);
  assert.doesNotMatch(baseAgents, /完整能力改成薄实现/);

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
  assert.match(pluginAgents, /## Workspace 接入卡[\s\S]+Existing rule/);
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
  assert.equal(profile.coordinates.windowLedger, "../workspace-ledger/BaseWindow");
  assert.equal(profile.coordinateChecks.every((check) => check.ok), true);
  assert.equal(profile.automationChecks.every((check) => check.ok), true);
});

test("write-agents can explicitly include unmanaged Design/Test windows while skipping real projects", () => {
  const fixture = makeFixture();
  const design = path.join(fixture.parent, "DesignWindow");
  const testWindow = path.join(fixture.parent, "TestWindow");
  const realProject = path.join(fixture.parent, "RealTestProject");
  mkdirSync(design, { recursive: true });
  mkdirSync(testWindow, { recursive: true });
  mkdirSync(realProject, { recursive: true });

  runJson(fixture, [
    "configure",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--repo",
    "DesignWindow=../DesignWindow",
    "--repo",
    "TestWindow=../TestWindow",
    "--repo",
    "RealTestProject=../RealTestProject",
    "--write",
  ]);

  const payload = runJson(fixture, ["write-agents", "--all", "--include-unmanaged", "--write"]);
  assert.deepEqual(
    payload.results.map((result) => result.windowName),
    ["BaseWindow", "DesignWindow", "TestWindow"],
  );
  assert.equal(existsSync(path.join(realProject, "AGENTS.md")), false);

  const designAgents = readFileSync(path.join(design, "AGENTS.md"), "utf8");
  assert.match(designAgents, /Window name: `DesignWindow`/);
  assert.match(designAgents, /Design handoff board: `docs\/current\/workspace-handoff-board\.md`/);
  assert.doesNotMatch(designAgents, /不得派发实现/);

  const testAgents = readFileSync(path.join(testWindow, "AGENTS.md"), "utf8");
  assert.match(testAgents, /Window name: `TestWindow`/);
  assert.match(testAgents, /Test exchange projection: `\.\.\/Wakeflow\/\.workspace-active\/workspace\/current\/test-exchange\.md`/);
  assert.match(testAgents, /非测试窗口不得创建、处理或验证 TestWindow delivery/);
  assert.doesNotMatch(testAgents, /不得成为默认测试队列/);
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
  assert.match(sharedAgents, /`TestIDE`: `\.\.\/workspace-ledger\/TestIDE`/);
  assert.match(sharedAgents, /`TestWindow`: `\.\.\/workspace-ledger\/TestWindow`/);
  assert.match(sharedAgents, /只处理本接入卡列出的窗口 dispatch packet/);
  assert.match(sharedAgents, /非测试窗口不得创建、处理或验证 TestWindow \/ TestIDE delivery/);
  assert.match(sharedAgents, /currentWindow/);

  const ideProfile = runJson(fixture, ["access-profiles", "--window", "TestIDE"]).profiles[0];
  const testProfile = runJson(fixture, ["access-profiles", "--window", "TestWindow"]).profiles[0];
  assert.equal(ideProfile.ok, true);
  assert.equal(testProfile.ok, true);
});

test("sync-root-agents unpacks parent AGENTS with control-repo paths", () => {
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
  assert.match(rootAgents, /cd Wakeflow && node scripts\/control-workspace-install\.mjs sync-root-agents --write/);
  assert.match(rootAgents, /FixtureWorkspace 是跨仓库目标、边界、证据/);
  assert.doesNotMatch(rootAgents, /plugin form/);
  assert.doesNotMatch(rootAgents, /FixtureWorkspace 仓库/);
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
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/design/AGENTS.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/design/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/design/docs/design-window-operating-policy.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/design/docs/workspace-alignment-checklist.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/design/templates/original-plan-template.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/design/templates/requirement-design-template.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/design/templates/workspace-signal-template.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/design/templates/workspace-handoff-template.md")), true);
  assert.equal(existsSync(path.join(fixture.control, ".workspace-active/workspace/current/test-exchange.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/testing/AGENTS.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/testing/README.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/testing/docs/testing-operation-policy.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/testing/templates/test-handoff-template.md")), true);
  assert.equal(existsSync(path.join(fixture.parent, "workspace-ledger/BaseWindow/README.md")), true);
});

test("external Design and Test directories get only alignment templates", () => {
  const fixture = makeFixture();
  const design = path.join(fixture.parent, "DesignWindow");
  const testWindow = path.join(fixture.parent, "TestWindow");
  mkdirSync(design, { recursive: true });
  mkdirSync(testWindow, { recursive: true });
  runJson(fixture, [
    "configure",
    "--repo",
    "BaseWindow=../BaseWindow",
    "--repo",
    "DesignWindow=../DesignWindow",
    "--repo",
    "TestWindow=../TestWindow",
    "--write",
  ]);

  const config = JSON.parse(readFileSync(path.join(fixture.control, "workspace.config.json"), "utf8"));
  assert.equal(config.designHandoffBoard, "../DesignWindow/docs/current/workspace-handoff-board.md");

  const payload = runJson(fixture, ["sync-templates", "--all", "--write"]);
  assert.equal(payload.ok, true);
  assert.equal(existsSync(path.join(design, "docs/current/workspace-handoff-board.md")), true);
  assert.equal(existsSync(path.join(design, "docs/design-window-operating-policy.md")), true);
  assert.equal(existsSync(path.join(design, "docs/workspace-alignment-checklist.md")), true);
  assert.equal(existsSync(path.join(design, "templates/original-plan-template.md")), true);
  assert.equal(existsSync(path.join(design, "templates/requirement-design-template.md")), true);
  assert.equal(existsSync(path.join(design, "templates/workspace-signal-template.md")), true);
  assert.equal(existsSync(path.join(design, "templates/workspace-handoff-template.md")), true);
  assert.equal(existsSync(path.join(testWindow, "docs/current/test-window-alignment.md")), true);
  assert.equal(existsSync(path.join(testWindow, "docs/testing-operation-policy.md")), true);
  assert.equal(existsSync(path.join(testWindow, "templates/test-handoff-template.md")), true);
  assert.equal(existsSync(path.join(testWindow, "docs/current/test-exchange.md")), false);
});

test("ledger-paths reports per-window project ledger directories", () => {
  const fixture = makeFixture();
  const payload = runJson(fixture, ["ledger-paths"]);
  assert.equal(payload.command, "ledger-paths");
  assert.equal(payload.projectLedgerRoot, "../workspace-ledger");
  assert.equal(payload.windowLedgerRoot, "../workspace-ledger");
  assert.deepEqual(
    payload.repositories.map((repo) => [repo.windowName, repo.ledgerPath, repo.exampleDocument]),
    [
      ["BaseWindow", "../workspace-ledger/BaseWindow", "../workspace-ledger/BaseWindow/example-task-YYYY-MM-DD.md"],
    ],
  );
});
