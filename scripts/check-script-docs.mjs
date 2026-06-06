#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const json = args.includes("--json");

function getArgValue(name, fallback) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) {
    return eq.slice(name.length + 1);
  }
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  return fallback;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function read(file) {
  return readFileSync(file, "utf8");
}

function hasReadmeReference(content, scriptName) {
  const escaped = escapeRegExp(scriptName);
  return new RegExp(`\`${escaped}\``).test(content) || new RegExp(`scripts/${escaped}\\b`).test(content);
}

function referencedScriptNames(content) {
  const names = new Set();
  const patterns = [
    /`([A-Za-z0-9._-]+\.mjs)`/g,
    /\bscripts\/([A-Za-z0-9._-]+\.mjs)\b/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content))) {
      names.add(match[1]);
    }
  }
  return names;
}

const allowedProcessExitLines = new Map();

function processExitIssues(scriptName, content) {
  const allowed = allowedProcessExitLines.get(scriptName) ?? [];
  const issues = [];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!/^\s*process\.exit\(/.test(line)) {
      continue;
    }
    if (allowed.some((pattern) => pattern.test(line))) {
      continue;
    }
    issues.push(`${scriptName}:${index + 1} uses process.exit(); use process.exitCode and a controlled return/CLI exception instead.`);
  }
  return issues;
}

const workspaceRoot = path.resolve(getArgValue("--root", process.cwd()));
const scriptsDir = path.join(workspaceRoot, "scripts");
const readmePath = path.join(scriptsDir, "README.md");
const verifierPath = path.join(scriptsDir, "verify-control-center.mjs");
const issues = [];
const warnings = [];

if (!existsSync(scriptsDir)) {
  issues.push("scripts directory is missing.");
}
if (!existsSync(readmePath)) {
  issues.push("scripts/README.md is missing.");
}

const scriptNames = existsSync(scriptsDir)
  ? readdirSync(scriptsDir)
      .filter((name) => name.endsWith(".mjs"))
      .sort()
  : [];
const testScripts = scriptNames.filter((name) => name.endsWith(".test.mjs"));
const runtimeScripts = scriptNames.filter((name) => !name.endsWith(".test.mjs"));
const readmeContent = existsSync(readmePath) ? read(readmePath) : "";
const verifierContent = existsSync(verifierPath) ? read(verifierPath) : "";

if (readmeContent) {
  if (!/Current scripts:/i.test(readmeContent)) {
    issues.push("scripts/README.md is missing the `Current scripts:` catalog heading.");
  }
  if (testScripts.length > 0 && !/Workspace script tests:/i.test(readmeContent)) {
    issues.push("scripts/README.md is missing the `Workspace script tests:` heading.");
  }

  for (const scriptName of runtimeScripts) {
    if (!hasReadmeReference(readmeContent, scriptName)) {
      issues.push(`${scriptName} is not documented in scripts/README.md.`);
    }
  }
  for (const scriptName of testScripts) {
    if (!hasReadmeReference(readmeContent, scriptName)) {
      issues.push(`${scriptName} is not listed in the workspace script test instructions.`);
    }
  }

  const known = new Set(scriptNames);
  for (const referenced of referencedScriptNames(readmeContent)) {
    if (!known.has(referenced)) {
      warnings.push(`scripts/README.md references ${referenced}, but that file is not present in scripts/.`);
    }
  }
}

if (testScripts.length > 0 && !existsSync(verifierPath)) {
  issues.push("scripts/verify-control-center.mjs is missing; script tests cannot be wired into the verification pipeline.");
}

for (const scriptName of testScripts) {
  if (verifierContent && !verifierContent.includes(`scripts/${scriptName}`)) {
    issues.push(`${scriptName} is not included in verify-control-center --with-script-tests.`);
  }
}

for (const scriptName of scriptNames) {
  const scriptPath = path.join(scriptsDir, scriptName);
  if (existsSync(scriptPath)) {
    issues.push(...processExitIssues(scriptName, read(scriptPath)));
  }
}

const result = {
  ok: issues.length === 0,
  scriptCount: scriptNames.length,
  runtimeScriptCount: runtimeScripts.length,
  testScriptCount: testScripts.length,
  scripts: scriptNames,
  issues,
  warnings,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log("Script documentation check passed.");
  console.log(`Scripts: ${scriptNames.length} (${runtimeScripts.length} runtime, ${testScripts.length} tests)`);
  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
} else {
  console.error("Script documentation check failed.");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  for (const warning of warnings) {
    console.error(`- warning: ${warning}`);
  }
}

if (!result.ok) {
  process.exitCode = 1;
}
