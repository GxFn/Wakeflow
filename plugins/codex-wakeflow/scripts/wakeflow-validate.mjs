#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listWakeflowRuntimeScriptEntries } from "../lib/wakeflow-runtime.mjs";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";
import {
  normalizeWorkspaceConfigInput,
  WAKEFLOW_CONFIG_SCHEMA_URL,
  WAKEFLOW_CONFIG_SCHEMA_VERSION,
} from "./lib/wakeflow-config.mjs";
// host-artifact-checks is host-local (one per edition) and is not present in core/. Import
// it dynamically so a core/-rooted dev run gets a clear message instead of a bare
// ERR_MODULE_NOT_FOUND; the host-artifact validation is then no-op'd for that dev run. A
// synced edition resolves the real module normally.
let createHostArtifactChecks;
try {
  ({ createHostArtifactChecks } = await import(new URL("./lib/wakeflow-host-artifact-checks.mjs", import.meta.url).href));
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
  console.error(
    "wakeflow-validate: host-artifact checks skipped — wakeflow-host-artifact-checks.mjs is host-local "
      + "and absent from core/. Run from a synced edition (plugins/codex-wakeflow or "
      + "plugins/claude-code-wakeflow) for full validation.",
  );
  createHostArtifactChecks = () => ({
    validatePluginManifest() {},
    validateMarketplaceIfPresent() {},
    validateMcpServerWiring() {},
  });
}

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
const ignoredDirectoryNames = new Set([".git", ".wakeflow-active", ".wakeflow-local", "coverage", "dist", "node_modules"]);
const localizedRuntimeTextFiles = new Set([
  "scripts/lib/wakeflow-language.mjs",
  "scripts/lib/wakeflow-host-profile.mjs",
  "scripts/wakeflow-setup.mjs",
  "scripts/lib/wakeflow-rule-model.mjs",
]);
const localizedDocumentationTextFiles = new Set([
  "README.zh-CN.md",
  "templates/wakeflow-template-bundle.json",
]);

const requiredFiles = [
  hostProfile.memoryFile,
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "package.json",
  hostProfile.pluginManifestPath,
  ".mcp.json",
  "bin/wakeflow-mcp",
  "mcp/server.cjs",
  "lib/wakeflow-mcp-tools.mjs",
  "lib/wakeflow-process.mjs",
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
  "templates/wakeflow-template-bundle.json",
  "wakeflow.config.json",
  "wakeflow.config.example.json",
  "schemas/wakeflow-config.schema.json",
  "schemas/wakeflow-state-machine/wakeflow-state.schema.json",
  "schemas/wakeflow-state-machine/demand-authority.schema.json",
  "schemas/wakeflow-state-machine/task-package.schema.json",
  "schemas/wakeflow-state-machine/target-result.schema.json",
  "schemas/wakeflow-state-machine/transition-candidate.schema.json",
  "schemas/wakeflow-state-machine/automation-dispatch.schema.json",
  "skills/wakeflow-controller/SKILL.md",
  "skills/wakeflow-target/SKILL.md",
  "skills/wakeflow-governance/SKILL.md",
  "skills/wakeflow-governance/references/agents-rule-map.md",
  "skills/wakeflow-governance/references/wakeflow-ledgers.md",
  "assets/wakeflow-mark.svg",
  "assets/wakeflow-logo.svg",
];

const hostArtifactChecks = createHostArtifactChecks({
  root,
  errors,
  readJson,
  requireFile,
  requirePath,
  stripDotSlash,
});

for (const file of requiredFiles) {
  requireFile(file);
}

if (existsSync(path.join(root, oldLedgerReferenceFile))) {
  errors.push(`old ledger reference file remains: ${oldLedgerReferenceFile}`);
}

validatePackage();
validatePluginManifest();
validateMarketplaceIfPresent();
validateMcpConfig();
validateWorkspaceConfigs();
await validateMcpToolDeclarations();
validateRuntimeWhitelist();
validateSkillSurface();
validateTemplateBundle();
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
  if (manifest.name !== hostProfile.artifact.packageName) errors.push(`package name must be ${hostProfile.artifact.packageName}`);
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
    for (const expected of hostProfile.artifact.packagedEntries) {
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
  hostArtifactChecks.validatePluginManifest();
}

function validateMarketplaceIfPresent() {
  hostArtifactChecks.validateMarketplaceIfPresent();
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
  hostArtifactChecks.validateMcpServerWiring(server);

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
    "wakeflow_replace_windows",
    "wakeflow_register_window",
    "wakeflow_status",
    "wakeflow_create_demand",
    "wakeflow_add_task",
    "wakeflow_deliver",
    "wakeflow_next_work",
    "wakeflow_prepare_delivery",
    "wakeflow_record_delivery",
    "wakeflow_record_target_result",
    "wakeflow_review_pack",
    "wakeflow_view",
    "wakeflow_storage_preserve",
    "wakeflow_reduce_results",
    "wakeflow_decide_review",
    "wakeflow_complete_demand",
    "wakeflow_continue_demand",
    "wakeflow_intake_test_card",
    "wakeflow_archive",
    "wakeflow_pod_open",
    "wakeflow_pod_bind",
    "wakeflow_pod_plan",
    "wakeflow_pod_record",
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

function validateWorkspaceConfigs() {
  for (const file of ["wakeflow.config.json", "wakeflow.config.example.json"]) {
    const config = readJson(file);
    if (!config) continue;
    if (config.$schema !== WAKEFLOW_CONFIG_SCHEMA_URL) {
      errors.push(`${file} must reference ${WAKEFLOW_CONFIG_SCHEMA_URL}`);
    }
    if (config.schemaVersion !== WAKEFLOW_CONFIG_SCHEMA_VERSION) {
      errors.push(`${file} must use schemaVersion ${WAKEFLOW_CONFIG_SCHEMA_VERSION}`);
      continue;
    }
    try {
      normalizeWorkspaceConfigInput(config);
    } catch (error) {
      errors.push(`${file} does not satisfy the runtime v2 contract: ${error.message}`);
    }
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
  if (tools.length !== 31) {
    errors.push(`Wakeflow MCP public surface must contain exactly 31 tools, found ${tools.length}`);
  }
  const publicNames = new Set(tools.map((tool) => tool?.name).filter(Boolean));
  for (const retired of [
    "wakeflow_render_progress",
    "wakeflow_pod_list",
    "wakeflow_sanitize_archive",
    "wakeflow_pod_prepare_design_request",
    "wakeflow_pod_prepare_test_access",
    "wakeflow_pod_close",
    "wakeflow_pod_record_materialization",
    "wakeflow_pod_record_design_handoff",
    "wakeflow_pod_record_test_access",
    "wakeflow_pod_record_close_receipt",
  ]) {
    if (publicNames.has(retired)) errors.push(`retired MCP tool must not be public: ${retired}`);
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
    "wakeflow_replace_windows",
    "wakeflow_register_window",
    "apply: false",
    "MCP server is unavailable",
  ]) {
    if (!governance.includes(required)) {
      errors.push(`wakeflow-governance skill must direct initialization through MCP: ${required}`);
    }
  }
}

function validateTemplateBundle() {
  const bundle = readJson("templates/wakeflow-template-bundle.json");
  if (!bundle) return;
  if (bundle.version !== 1) {
    errors.push("template bundle version must be 1");
  }
  if (!bundle.files || typeof bundle.files !== "object" || Array.isArray(bundle.files)) {
    errors.push("template bundle must contain a files object");
    return;
  }
  for (const required of [
    "templates/wakeflow-state-machine/developer-progress.template.md",
    "templates/wakeflow-state-machine/developer-progress.zh-CN.template.md",
    "templates/wakeflow-state-machine/unified-status.template.md",
    "templates/wakeflow-state-machine/unified-status.zh-CN.template.md",
    "templates/wakeflow-state-machine/decision-log-entry.template.md",
    "templates/wakeflow-state-machine/task-package-entry.template.md",
    "templates/wakeflow-state-machine/backfill-summary-entry.template.md",
    "templates/starter-workspace/workspace/index.md",
    "templates/starter-workspace/workspace/current/workspace-current-status.md",
    "templates/starter-workspace/workspace/current/global-todo-board.md",
    "templates/starter-workspace/workspace/current/test-exchange.md",
    "templates/starter-workspace/workspace/workspace-record-map.md",
    "templates/starter-workspace/ledger/requirement-designs/README.md",
    "templates/starter-workspace/ledger/goal-stage-confirmation/README.md",
    "templates/starter-workspace/ledger/goal-stage-confirmation/process.md",
    "templates/starter-workspace/ledger/workspace/requirement-to-wave-execution-flow.md",
    "templates/starter-workspace/ledger/workspace/todo-window-scheduling-policy.md",
    "templates/starter-workspace/ledger/workspace/workspace-doc-archive-policy.md",
    "templates/starter-workspace/ledger/workspace/archive/index.md",
    "templates/window-support/design/skills/requirement-clarification/SKILL.md",
    "templates/window-support/design/skills/option-planning/SKILL.md",
    "templates/window-support/design/skills/requirement-design/SKILL.md",
    "templates/window-support/design/skills/work-slicing/SKILL.md",
    "templates/window-support/design/skills/design-handoff/SKILL.md",
    "templates/window-support/testing/skills/test-strategy/SKILL.md",
    "templates/window-support/testing/skills/debugging-and-triage/SKILL.md",
    "templates/window-support/testing/skills/regression-design/SKILL.md",
    "templates/window-support/testing/skills/evidence-review/SKILL.md",
    "templates/window-support/testing/skills/progressive-chain-validation/SKILL.md",
    "templates/window-support/testing/skills/progressive-chain-validation/references/metrics-contract.md",
    "templates/window-support/testing/skills/progressive-chain-validation/templates/plan.md",
  ]) {
    if (typeof bundle.files[required] !== "string" || bundle.files[required].trim() === "") {
      errors.push(`template bundle missing ${required}`);
    }
  }
  for (const obsolete of [
    `templates/window-support/design/${hostProfile.memoryFile}`,
    `templates/window-support/testing/${hostProfile.memoryFile}`,
  ]) {
    if (Object.hasOwn(bundle.files, obsolete)) {
      errors.push(`template bundle must not duplicate generated role memory: ${obsolete}`);
    }
  }
  const designSkills = bundle.files["templates/window-support/design/skills/README.md"] ?? "";
  const testSkills = bundle.files["templates/window-support/testing/skills/README.md"] ?? "";
  const testStrategy = bundle.files["templates/window-support/testing/skills/test-strategy/SKILL.md"] ?? "";
  const progressive = bundle.files["templates/window-support/testing/skills/progressive-chain-validation/SKILL.md"] ?? "";
  const testPolicy = bundle.files["templates/window-support/testing/docs/testing-operation-policy.md"] ?? "";
  if (/edit product code unless|authorizes\s+an exception/u.test(designSkills)) {
    errors.push("Design skill template must not let controller state override the no-product-implementation boundary");
  }
  if (/take over product implementation unless|explicitly authorizes it/u.test(testSkills)) {
    errors.push("Test skill template must not let a test card or state root grant product implementation ownership");
  }
  if (!testSkills.includes("Progressive Chain Validation is unavailable unless")) {
    errors.push("Test skill template must require explicit test-card authorization for progressive-chain-validation");
  }
  if (/validate or repair|Product source edits are allowed/u.test(progressive)) {
    errors.push("progressive-chain-validation must validate only and return repair work to the owning product window");
  }
  if (!progressive.includes("DO NOT USE THIS SKILL UNLESS THE CURRENT TEST CARD EXPLICITLY LISTS")) {
    errors.push("progressive-chain-validation is missing its explicit test-card gate");
  }
  if (/if it is improvised, say so and justify/u.test(testStrategy)) {
    errors.push("Test strategy must block unmapped methods instead of authorizing improvised execution");
  }
  if (!testPolicy.includes("Durable conclusion") && !testPolicy.includes("durable conclusion")) {
    errors.push("Test operation policy must separate active Test working material from durable ledger conclusions");
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
