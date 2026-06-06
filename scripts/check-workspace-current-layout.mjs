#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { loadWorkspaceConfig, workspaceLedgerPaths } from "./lib/workspace-config.mjs";

const workspaceRoot = process.cwd();
const args = process.argv.slice(2);
const json = args.includes("--json");
const workspaceConfig = loadWorkspaceConfig({ workspaceRoot, args });
const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args, config: workspaceConfig });
const workspaceDocsDir = ledgerPaths.workspaceDocsDir;
const currentDir = ledgerPaths.workspaceCurrentDir;
const indexPath = ledgerPaths.workspaceIndexPath;
const configuredTestExchangeFile = path.basename(workspaceConfig.testExchangePath);

const requiredCurrentFiles = [
  "index.md",
  "workspace-current-status.md",
  "global-todo-board.md",
  configuredTestExchangeFile,
];

const forbiddenRootFiles = [
  "workspace-current-status.md",
  "global-todo-board.md",
  configuredTestExchangeFile,
];

const oldShortPathPattern = new RegExp(
  `docs/workspace/(?:workspace-current-status\\.md|global-todo-board\\.md|${escapeRegExp(configuredTestExchangeFile)})`,
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relative(file) {
  return path.relative(workspaceRoot, file).split(path.sep).join("/");
}

function read(file) {
  return readFileSync(file, "utf8");
}

function listFiles(dir, predicate = () => true) {
  if (!existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...listFiles(absolute, predicate));
    } else if (predicate(absolute)) {
      files.push(absolute);
    }
  }
  return files;
}

function splitMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return [];
  }
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function sectionContent(content, heading) {
  const start = content.indexOf(`## ${heading}`);
  if (start < 0) {
    return "";
  }
  const rest = content.slice(start);
  const next = rest.slice(1).search(/\n## /);
  return next >= 0 ? rest.slice(0, next + 1) : rest;
}

function extractFirstLinkTarget(markdown) {
  const match = markdown.match(/\[[^\]]+]\(([^)]+)\)/);
  return match ? match[1].split("#")[0] : null;
}

function currentPlanTarget(indexContent) {
  const section = sectionContent(indexContent, "当前总控入口");
  const rows = section
    .split("\n")
    .map(splitMarkdownRow)
    .filter((row) => row.length > 0);
  const row = rows.find((candidate) => candidate[0] !== "类型" && !candidate.every((cell) => /^:?-{3,}:?$/.test(cell)));
  return row && row.length >= 2 ? extractFirstLinkTarget(row[1]) : null;
}

const issues = [];
const warnings = [];

for (const file of requiredCurrentFiles) {
  const absolute = path.join(currentDir, file);
  if (!existsSync(absolute)) {
    issues.push(`missing current workspace file: ${relative(absolute)}`);
  }
}

for (const file of forbiddenRootFiles) {
  const absolute = path.join(workspaceDocsDir, file);
  if (existsSync(absolute)) {
    issues.push(`short-term workspace file must live under ${relative(currentDir)}/: ${relative(absolute)}`);
  }
}

if (!existsSync(indexPath)) {
  issues.push(`${relative(indexPath)} is missing`);
} else {
  const indexContent = read(indexPath);
  const target = currentPlanTarget(indexContent);
  if (!target) {
    issues.push(`${relative(indexPath)} current entry could not be resolved`);
  } else if (!target.startsWith("current/")) {
    issues.push(`current workspace plan must live under ${relative(currentDir)}/: ${target}`);
  }

  if (!indexContent.includes("[current/](current/)")) {
    warnings.push(`${relative(indexPath)} should expose ${relative(currentDir)}/ as the short-term work area`);
  }
}

const activeFiles = [
  path.join(workspaceRoot, "AGENTS.md"),
  ...listFiles(workspaceDocsDir, (file) => file.endsWith(".md") && !file.startsWith(`${ledgerPaths.workspaceArchiveDir}${path.sep}`)),
];

for (const file of activeFiles) {
  const content = read(file);
  if (oldShortPathPattern.test(content)) {
    issues.push(`${relative(file)} references old root-level short-term workspace doc path`);
  }
}

const result = {
  ok: issues.length === 0,
  issues,
  warnings,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log("Workspace current layout check passed.");
  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
} else {
  console.error("Workspace current layout check failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  if (warnings.length > 0) {
    console.error("Warnings:");
    for (const warning of warnings) {
      console.error(`- ${warning}`);
    }
  }
}

if (!result.ok) {
  process.exitCode = 1;
}
