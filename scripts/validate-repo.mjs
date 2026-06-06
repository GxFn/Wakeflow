#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "bin/wakeflow-mcp.mjs",
  "scripts/wakeflow.mjs",
  "lib/wakeflow-state.mjs",
  "skills/wakeflow/SKILL.md",
  "skills/wakeflow-control/SKILL.md",
  "skills/wakeflow-target/SKILL.md",
  "skills/wakeflow-install/SKILL.md",
  "skills/wakeflow-review/SKILL.md",
  "templates/delivery-prompt.md",
  "templates/developer-progress.md",
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
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checked: required.length }, null, 2));
