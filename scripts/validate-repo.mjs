#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "bin/wakeflow-mcp.mjs",
  "scripts/wakeflow-control.mjs",
  "lib/control-runtime.mjs",
  "scripts/workspace-control.mjs",
  "scripts/controller-state.mjs",
  "scripts/codex-automation-loop.mjs",
  "scripts/control-intake.mjs",
  "scripts/control-workspace-install.mjs",
  "templates/control-state-machine/developer-progress.template.md",
  "schemas/control-state-machine/controller-state.schema.json",
  "skills/codex-automation-controller/SKILL.md",
  "skills/codex-automation-target/SKILL.md",
  "skills/control-workspace-governance/SKILL.md",
  "skills/progressive-chain-validation/SKILL.md",
  "assets/wakeflow-mark.svg",
  "assets/wakeflow-logo.svg",
];
const errors = [];
for (const file of required) {
  if (!existsSync(path.join(root, file))) errors.push(`Missing ${file}`);
}

const manifestPath = path.join(root, ".codex-plugin/plugin.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.name !== "wakeflow") errors.push("plugin name must be wakeflow");
  if (manifest.interface?.displayName !== "Wakeflow") errors.push("displayName must be Wakeflow");
}

for (const file of required.filter((item) => item.endsWith(".md") || item.endsWith(".json"))) {
  if (!existsSync(path.join(root, file))) continue;
  const text = readFileSync(path.join(root, file), "utf8");
  if (text.includes("[TODO:")) errors.push(`Placeholder remains in ${file}`);
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, checked: required.length }, null, 2));
}
