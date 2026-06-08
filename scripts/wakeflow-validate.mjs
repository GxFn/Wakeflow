#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listWakeflowRuntimeScriptEntries } from "../lib/wakeflow-runtime.mjs";

const args = process.argv.slice(2);
const root = path.resolve(getArgValue("--root") || process.cwd());
const errors = [];
const placeholderToken = "[TO" + "DO:";
const oldWorkspaceToken = "codex-control" + "-workspace";
const oldLedgerToken = "workspace-" + "ledger";
const oldLedgerReferenceFile = path.join("skills", "wakeflow-governance", "references", "workspace-" + "ledgers.md");
const projectSpecificTokens = [
  "AFA" + "PI",
  "Al" + "embic" + "Workspace",
  "Al" + "embic" + "Plugin",
  "Al" + "embic" + "Core",
];
const ignoredDirectoryNames = new Set([".git", ".workspace-active", ".workspace-local", "coverage", "dist", "node_modules"]);
const localizedRuntimeTextFiles = new Set([
  "scripts/wakeflow-setup.mjs",
]);
const localizedDocumentationTextFiles = new Set([
  "README.zh-CN.md",
]);

const requiredFiles = [
  "AGENTS.md",
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "package.json",
  ".codex-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  ".mcp.json",
  "bin/wakeflow-mcp.mjs",
  "mcp/server.cjs",
  "lib/wakeflow-mcp-tools.mjs",
  "scripts/wakeflow-runtime.mjs",
  "lib/wakeflow-runtime.mjs",
  "scripts/wakeflow-cli.mjs",
  "scripts/wakeflow-state.mjs",
  "scripts/wakeflow-delivery.mjs",
  "scripts/wakeflow-intake.mjs",
  "scripts/wakeflow-setup.mjs",
  "scripts/wakeflow-validate.mjs",
  "scripts/wakeflow-smoke.mjs",
  "scripts/wakeflow-verify.mjs",
  "templates/wakeflow-state-machine/developer-progress.template.md",
  "templates/wakeflow-state-machine/unified-status.template.md",
  "templates/wakeflow-state-machine/decision-log-entry.template.md",
  "templates/wakeflow-state-machine/task-package-entry.template.md",
  "templates/wakeflow-state-machine/backfill-summary-entry.template.md",
  "templates/starter-workspace/workspace/index.md",
  "templates/starter-workspace/workspace/current/workspace-current-status.md",
  "templates/starter-workspace/workspace/current/global-todo-board.md",
  "templates/starter-workspace/workspace/current/design-handoff-board.md",
  "templates/starter-workspace/workspace/current/design-handoff-inbox.md",
  "templates/starter-workspace/workspace/current/test-exchange.md",
  "templates/starter-workspace/workspace/workspace-record-map.md",
  "templates/starter-workspace/ledger/requirement-designs/README.md",
  "templates/starter-workspace/ledger/goal-stage-confirmation/README.md",
  "templates/starter-workspace/ledger/goal-stage-confirmation/process.md",
  "templates/starter-workspace/ledger/workspace/requirement-to-wave-execution-flow.md",
  "templates/starter-workspace/ledger/workspace/todo-window-scheduling-policy.md",
  "templates/starter-workspace/ledger/workspace/workspace-doc-archive-policy.md",
  "templates/starter-workspace/ledger/workspace/archive/index.md",
  "templates/window-support/design/AGENTS.md",
  "templates/window-support/testing/AGENTS.md",
  "schemas/wakeflow-state-machine/wakeflow-state.schema.json",
  "schemas/wakeflow-state-machine/task-package.schema.json",
  "schemas/wakeflow-state-machine/target-result.schema.json",
  "schemas/wakeflow-state-machine/transition-candidate.schema.json",
  "schemas/wakeflow-state-machine/automation-dispatch.schema.json",
  "skills/wakeflow-controller/SKILL.md",
  "skills/wakeflow-target/SKILL.md",
  "skills/wakeflow-governance/SKILL.md",
  "skills/wakeflow-governance/references/agents-rule-map.md",
  "skills/wakeflow-governance/references/wakeflow-ledgers.md",
  "templates/window-support/testing/skills/progressive-chain-validation/SKILL.md",
  "templates/window-support/testing/skills/progressive-chain-validation/references/metrics-contract.md",
  "templates/window-support/testing/skills/progressive-chain-validation/templates/plan.md",
  "assets/wakeflow-mark.svg",
  "assets/wakeflow-logo.svg",
];

for (const file of requiredFiles) {
  requireFile(file);
}

if (existsSync(path.join(root, oldLedgerReferenceFile))) {
  errors.push(`old ledger reference file remains: ${oldLedgerReferenceFile}`);
}

validatePackage();
validatePluginManifest();
validateMarketplace();
validateMcpConfig();
await validateMcpToolDeclarations();
validateRuntimeWhitelist();
validateSkillSurface();
validateTextSurface();

const payload = {
  ok: errors.length === 0,
  root,
  checked: {
    requiredFiles: requiredFiles.length,
    runtimeScripts: listWakeflowRuntimeScriptEntries().length,
    skills: countSkillFiles(),
  },
  errors,
};

if (errors.length) {
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(payload, null, 2));
}

function validatePackage() {
  const manifest = readJson("package.json");
  if (!manifest) return;
  if (manifest.name !== "wakeflow") errors.push("package name must be wakeflow");
  if (manifest.private === true) errors.push("package.json must not be private for release packaging");
  if (manifest.type !== "module") errors.push("package type must be module");
  if (manifest.license !== "MIT") errors.push("package license must be MIT");
  if (manifest.homepage !== "https://github.com/GxFn/Wakeflow#readme") {
    errors.push("package homepage must point at the public Wakeflow README");
  }
  if (manifest.repository?.url !== "https://github.com/GxFn/Wakeflow.git") {
    errors.push("package repository URL must point at the public Wakeflow source");
  }
  if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("unattended")) {
    errors.push("package keywords must include unattended");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    errors.push("package files must declare the plugin release surface");
  } else {
    for (const expected of [".codex-plugin/", ".agents/plugins/marketplace.json", ".mcp.json", "README.zh-CN.md", "mcp/", "skills/", "scripts/", "templates/"]) {
      if (!manifest.files.includes(expected)) errors.push(`package files must include ${expected}`);
    }
  }
  if (manifest.scripts?.validate !== "node scripts/wakeflow-validate.mjs") {
    errors.push("package validate script must run scripts/wakeflow-validate.mjs");
  }
  if (manifest.scripts?.smoke !== "node scripts/wakeflow-smoke.mjs") {
    errors.push("package smoke script must run scripts/wakeflow-smoke.mjs");
  }
  if (!manifest.scripts?.test?.includes("npm run validate")) {
    errors.push("package test script must include npm run validate");
  }
  if (!manifest.scripts?.test?.includes("npm run smoke")) {
    errors.push("package test script must include npm run smoke");
  }
}

function validatePluginManifest() {
  const manifest = readJson(".codex-plugin/plugin.json");
  if (!manifest) return;
  if (manifest.name !== "wakeflow") errors.push("plugin name must be wakeflow");
  if (manifest.interface?.displayName !== "Wakeflow") errors.push("plugin displayName must be Wakeflow");
  if (manifest.author?.name !== "gaoxuefeng") errors.push("plugin author name must be gaoxuefeng");
  if (manifest.interface?.developerName !== "GxFn") errors.push("plugin developerName must be GxFn");
  if (manifest.skills !== "./skills/") errors.push("plugin skills path must be ./skills/");
  if (manifest.mcpServers !== "./.mcp.json") errors.push("plugin mcpServers path must be ./.mcp.json");
  if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("unattended")) {
    errors.push("plugin keywords must include unattended");
  }
  if (!Array.isArray(manifest.interface?.defaultPrompt) || manifest.interface.defaultPrompt.length === 0) {
    errors.push("plugin interface.defaultPrompt must be a non-empty array");
  } else {
    if (manifest.interface.defaultPrompt.length > 3) {
      errors.push("plugin interface.defaultPrompt must contain at most 3 prompts");
    }
    for (const [index, prompt] of manifest.interface.defaultPrompt.entries()) {
      if (typeof prompt !== "string" || prompt.trim() === "") {
        errors.push(`plugin interface.defaultPrompt[${index}] must be a non-empty string`);
      } else if (prompt.length > 128) {
        errors.push(`plugin interface.defaultPrompt[${index}] must be at most 128 characters`);
      }
    }
  }
  for (const relativePath of [
    manifest.skills,
    manifest.mcpServers,
    manifest.interface?.composerIcon,
    manifest.interface?.logo,
  ].filter(Boolean)) {
    requirePath(relativePath, `plugin manifest points to missing path: ${relativePath}`);
  }
}

function validateMarketplace() {
  const marketplace = readJson(".agents/plugins/marketplace.json");
  const manifest = readJson(".codex-plugin/plugin.json");
  if (!marketplace || !manifest) return;
  const entries = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const entry = entries.find((plugin) => plugin?.name === manifest.name);
  if (marketplace.name !== "gxfn") errors.push("marketplace name must be gxfn");
  if (marketplace.interface?.displayName !== "GxFn") {
    errors.push("marketplace displayName must be GxFn");
  }
  if (entries.length !== 1) errors.push("marketplace must list exactly one Wakeflow plugin");
  if (!entry) {
    errors.push("marketplace must include wakeflow");
    return;
  }
  if (entry.source?.source !== "local") errors.push("marketplace wakeflow source must be local");
  if (entry.source?.path !== ".") errors.push("marketplace wakeflow path must point to repository root");
  if (path.resolve(root, entry.source?.path || "") !== root) {
    errors.push("marketplace wakeflow path must resolve to the repository root");
  }
  if (entry.policy?.installation !== "AVAILABLE") {
    errors.push("marketplace wakeflow installation policy must be AVAILABLE");
  }
  if (entry.policy?.authentication !== "ON_INSTALL") {
    errors.push("marketplace wakeflow authentication policy must be ON_INSTALL");
  }
  if (entry.category !== manifest.interface?.category) {
    errors.push("marketplace wakeflow category must match plugin interface category");
  }
}

function validateMcpConfig() {
  const packageJson = readJson("package.json");
  if (packageJson?.bin?.["wakeflow-mcp"] !== "./mcp/server.cjs") {
    errors.push("package.json must expose wakeflow-mcp bin at ./mcp/server.cjs");
  }
  if (packageJson?.scripts?.mcp !== "node ./mcp/server.cjs") {
    errors.push("package.json must expose an mcp script for the Wakeflow MCP entrypoint");
  }
  if (packageJson?.dependencies?.["@modelcontextprotocol/sdk"] || packageJson?.devDependencies?.["@modelcontextprotocol/sdk"]) {
    errors.push("package.json must not depend on @modelcontextprotocol/sdk; Wakeflow MCP is a standalone stdio server");
  }

  const config = readJson(".mcp.json");
  if (!config) return;
  const server = config.mcpServers?.wakeflow;
  if (!server) {
    errors.push(".mcp.json must expose mcpServers.wakeflow");
    return;
  }
  if (server.command !== "node") errors.push("wakeflow MCP command must be node");
  if (server.cwd !== ".") errors.push("wakeflow MCP cwd must be .");
  if (!Array.isArray(server.args) || server.args[0] !== "./mcp/server.cjs") {
    errors.push("wakeflow MCP args must start with ./mcp/server.cjs");
  }
  for (const arg of server.args || []) {
    if (arg.endsWith(".mjs") || arg.endsWith(".cjs")) requireFile(stripDotSlash(arg));
  }

  const serverText = readText("mcp/server.cjs");
  for (const required of [
    "initialize",
    "notifications/initialized",
    "tools/list",
    "tools/call",
    "process.stdin",
    "process.stdout",
  ]) {
    if (!serverText.includes(required)) errors.push(`standalone MCP server is missing: ${required}`);
  }
  for (const required of [
    "@modelcontextprotocol/sdk",
    "node_modules",
  ]) {
    if (serverText.includes(required)) errors.push(`standalone MCP server must not depend on ${required}`);
  }
  const mcpText = readText("lib/wakeflow-mcp-tools.mjs");
  for (const tool of [
    "wakeflow_initialize_workspace",
    "wakeflow_status",
    "wakeflow_init_demand",
    "wakeflow_add_task",
    "wakeflow_next_work",
    "wakeflow_prepare_delivery",
    "wakeflow_record_delivery",
    "wakeflow_record_target_result",
    "wakeflow_review_pack",
    "wakeflow_decide_review",
    "wakeflow_complete_demand",
    "wakeflow_intake_design_handoff",
    "wakeflow_intake_test_card",
    "wakeflow_archive_todo",
    "wakeflow_archive_workspace_docs",
    "wakeflow_verify",
  ]) {
    if (!mcpText.includes(`name: "${tool}"`)) errors.push(`MCP tool is missing: ${tool}`);
  }
  for (const tool of [
    "wakeflow_discover_workspace",
    "wakeflow_access_profiles",
    "wakeflow_sync_agents",
    "wakeflow_review",
    "wakeflow_build_controller_return",
    "wakeflow_stop_loop",
    "wakeflow_keep_live_state",
    "wakeflow_run_backend",
    "wakeflow_full_status",
    "wakeflow_full_verify",
  ]) {
    if (mcpText.includes(`name: "${tool}"`)) errors.push(`internal tool must not be public MCP: ${tool}`);
  }
  for (const forbidden of ["threadId", "promptFile", "prompt-file"]) {
    if (mcpText.includes(forbidden)) errors.push(`MCP surface must not expose ${forbidden}`);
  }
}

async function validateMcpToolDeclarations() {
  const toolModule = path.join(root, "lib/wakeflow-mcp-tools.mjs");
  if (!existsSync(toolModule)) return;
  let tools;
  try {
    ({ tools } = await import(pathToFileURL(toolModule).href));
  } catch (error) {
    errors.push(`failed to load Wakeflow MCP tools: ${error.message}`);
    return;
  }
  if (!Array.isArray(tools) || tools.length === 0) {
    errors.push("Wakeflow MCP tools export must be a non-empty array");
    return;
  }
  const readOnlyTools = new Set([
    "wakeflow_status",
    "wakeflow_review_pack",
    "wakeflow_verify",
  ]);
  for (const tool of tools) {
    if (!tool?.name) {
      errors.push("Wakeflow MCP tool declaration is missing name");
      continue;
    }
    const annotations = tool.annotations;
    if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) {
      errors.push(`MCP tool ${tool.name} must declare annotations`);
      continue;
    }
    for (const field of ["title", "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      if (!(field in annotations)) errors.push(`MCP tool ${tool.name} annotations missing ${field}`);
    }
    if (annotations.destructiveHint !== false) {
      errors.push(`MCP tool ${tool.name} must not be destructive by default`);
    }
    if (annotations.openWorldHint !== false) {
      errors.push(`MCP tool ${tool.name} must stay local; openWorldHint must be false`);
    }
    if (readOnlyTools.has(tool.name) && annotations.readOnlyHint !== true) {
      errors.push(`MCP tool ${tool.name} must be declared read-only`);
    }
  }
}

function validateRuntimeWhitelist() {
  const entries = listWakeflowRuntimeScriptEntries();
  const names = new Set(entries.map((entry) => entry.name));
  for (const expected of [
    "wakeflow-cli",
    "wakeflow-setup",
    "wakeflow-state",
    "wakeflow-delivery",
    "wakeflow-intake",
    "wakeflow-smoke",
    "wakeflow-validate",
    "wakeflow-verify",
  ]) {
    if (!names.has(expected)) errors.push(`runtime whitelist is missing ${expected}`);
  }
  for (const entry of entries) {
    requireFile(path.join("scripts", entry.file));
  }
}

function validateSkillSurface() {
  const skillsRoot = path.join(root, "skills");
  if (!existsSync(skillsRoot)) return;
  const skillFiles = listFiles(skillsRoot).filter((file) => path.basename(file) === "SKILL.md");
  if (skillFiles.length < 3) errors.push("skills/ must expose controller, target, and governance skills");
  for (const file of skillFiles) {
    const text = readFileSync(file, "utf8");
    if (!/^---\n[\s\S]*?\n---/.test(text)) {
      errors.push(`${relative(file)} is missing skill frontmatter`);
    }
    if (!/description:\s*\S/.test(text)) {
      errors.push(`${relative(file)} is missing a description`);
    }
  }
  const governance = readText("skills/wakeflow-governance/SKILL.md");
  for (const required of [
    "workspace initialization",
    "wakeflow_initialize_workspace",
    "apply: false",
    "MCP server is unavailable",
  ]) {
    if (!governance.includes(required)) {
      errors.push(`wakeflow-governance skill must direct initialization through MCP: ${required}`);
    }
  }
}

function validateTextSurface() {
  for (const file of listTextFiles(root)) {
    const rel = relative(file);
    const text = readFileSync(file, "utf8");
    const allowsLocalizedRuntimeText = localizedRuntimeTextFiles.has(rel);
    const allowsLocalizedDocumentationText = localizedDocumentationTextFiles.has(rel);
    const allowsLocalizedText = allowsLocalizedRuntimeText || allowsLocalizedDocumentationText;
    if (text.includes(placeholderToken)) errors.push(`placeholder remains in ${rel}`);
    if (text.includes(oldWorkspaceToken)) {
      errors.push(`old workspace name remains in ${rel}`);
    }
    if (text.includes(oldLedgerToken)) {
      errors.push(`old ledger directory name remains in ${rel}`);
    }
    if (!allowsProjectSpecificFixtureText(rel)) {
      for (const token of projectSpecificTokens) {
        if (text.includes(token)) errors.push(`project-specific token ${token} remains in ${rel}`);
      }
    }
    if (!allowsLocalizedText && /\p{Script=Han}/u.test(text)) {
      errors.push(`non-English Han text remains in ${rel}`);
    }
    if (!allowsLocalizedText && /[\u3000-\u303F\uFF00-\uFFEF]/u.test(text)) {
      errors.push(`fullwidth punctuation remains in ${rel}`);
    }
  }
}

function allowsProjectSpecificFixtureText(relativePath) {
  return relativePath.startsWith("scripts/fixtures/") || /\.test\.mjs$/u.test(relativePath);
}

function requireFile(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    errors.push(`missing file: ${relativePath}`);
  }
}

function requirePath(relativePath, message) {
  const absolute = path.join(root, stripDotSlash(relativePath));
  if (!existsSync(absolute)) errors.push(message);
}

function readJson(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!existsSync(absolute)) return null;
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    errors.push(`invalid JSON in ${relativePath}: ${error.message}`);
    return null;
  }
}

function readText(relativePath) {
  const absolute = path.join(root, relativePath);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

function listTextFiles(directory) {
  return listFiles(directory).filter((file) => {
    return /\.(md|json|mjs|js|ts|tsx|yaml|yml)$/.test(file);
  });
}

function listFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectoryNames.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function countSkillFiles() {
  return listFiles(path.join(root, "skills")).filter((file) => path.basename(file) === "SKILL.md").length;
}

function getArgValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function stripDotSlash(value) {
  return String(value).replace(/^\.\//, "");
}

function relative(absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}
