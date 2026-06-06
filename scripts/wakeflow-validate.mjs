#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { listWakeflowRuntimeScriptEntries } from "../lib/wakeflow-runtime.mjs";

const args = process.argv.slice(2);
const root = path.resolve(getArgValue("--root") || process.cwd());
const errors = [];
const placeholderToken = "[TO" + "DO:";
const oldWorkspaceToken = "codex-control" + "-workspace";
const ignoredDirectoryNames = new Set([".git", ".workspace-active", ".workspace-local", "coverage", "dist", "node_modules"]);
const localizedRuntimeTextFiles = new Set([
  "scripts/wakeflow-setup.mjs",
]);

const requiredFiles = [
  "AGENTS.md",
  "README.md",
  "LICENSE",
  "package.json",
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "bin/wakeflow-mcp.mjs",
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
  "skills/wakeflow-progressive-validation/SKILL.md",
  "assets/wakeflow-mark.svg",
  "assets/wakeflow-logo.svg",
];

for (const file of requiredFiles) {
  requireFile(file);
}

validatePackage();
validatePluginManifest();
validateMcpConfig();
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
  if (manifest.type !== "module") errors.push("package type must be module");
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
  if (manifest.skills !== "./skills/") errors.push("plugin skills path must be ./skills/");
  if (manifest.mcpServers !== "./.mcp.json") errors.push("plugin mcpServers path must be ./.mcp.json");
  if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("unattended")) {
    errors.push("plugin keywords must include unattended");
  }
  if (!Array.isArray(manifest.interface?.defaultPrompt) || manifest.interface.defaultPrompt.length === 0) {
    errors.push("plugin interface.defaultPrompt must be a non-empty array");
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

function validateMcpConfig() {
  const config = readJson(".mcp.json");
  if (!config) return;
  const server = config.mcpServers?.wakeflow;
  if (!server) {
    errors.push(".mcp.json must expose mcpServers.wakeflow");
    return;
  }
  if (server.command !== "node") errors.push("wakeflow MCP command must be node");
  if (server.cwd !== ".") errors.push("wakeflow MCP cwd must be .");
  if (!Array.isArray(server.args) || server.args[0] !== "./bin/wakeflow-mcp.mjs") {
    errors.push("wakeflow MCP args must start with ./bin/wakeflow-mcp.mjs");
  }
  for (const arg of server.args || []) {
    if (arg.endsWith(".mjs")) requireFile(stripDotSlash(arg));
  }

  const mcpText = readText("bin/wakeflow-mcp.mjs");
  for (const tool of [
    "wakeflow_initialize_workspace",
    "wakeflow_discover_workspace",
    "wakeflow_sync_agents",
    "wakeflow_init_demand",
    "wakeflow_add_task",
    "wakeflow_prepare_delivery",
    "wakeflow_record_delivery",
    "wakeflow_submit_result",
    "wakeflow_review_pack",
    "wakeflow_decide_review",
    "wakeflow_build_controller_return",
    "wakeflow_intake_design_handoff",
    "wakeflow_intake_test_card",
    "wakeflow_next_work",
    "wakeflow_full_verify",
  ]) {
    if (!mcpText.includes(`name: "${tool}"`)) errors.push(`MCP tool is missing: ${tool}`);
  }
  for (const forbidden of ["threadId", "promptFile", "prompt-file"]) {
    if (mcpText.includes(forbidden)) errors.push(`MCP surface must not expose ${forbidden}`);
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
  if (skillFiles.length < 4) errors.push("skills/ must expose controller, target, governance, and validation skills");
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
    const text = readFileSync(file, "utf8");
    const allowsLocalizedRuntimeText = localizedRuntimeTextFiles.has(relative(file));
    if (text.includes(placeholderToken)) errors.push(`placeholder remains in ${relative(file)}`);
    if (text.includes(oldWorkspaceToken)) {
      errors.push(`old workspace name remains in ${relative(file)}`);
    }
    if (!allowsLocalizedRuntimeText && /\p{Script=Han}/u.test(text)) {
      errors.push(`non-English Han text remains in ${relative(file)}`);
    }
    if (!allowsLocalizedRuntimeText && /[\u3000-\u303F\uFF00-\uFFEF]/u.test(text)) {
      errors.push(`fullwidth punctuation remains in ${relative(file)}`);
    }
  }
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
