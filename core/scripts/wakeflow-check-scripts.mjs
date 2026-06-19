#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const installedScriptsDir = path.dirname(fileURLToPath(import.meta.url));
const targetScriptsDir = path.join(workspaceRoot, "scripts");
const targetReadmePath = path.join(targetScriptsDir, "README.md");
const targetScriptNames = existsSync(targetScriptsDir)
  ? readdirSync(targetScriptsDir)
      .filter((name) => name.endsWith(".mjs"))
      .sort()
  : [];
const useWorkspaceScripts = targetScriptNames.length > 0 || existsSync(targetReadmePath);
const scriptsDir = useWorkspaceScripts ? targetScriptsDir : installedScriptsDir;
const readmePath = useWorkspaceScripts ? targetReadmePath : path.join(installedScriptsDir, "README.md");
const verifierPath = useWorkspaceScripts
  ? path.join(targetScriptsDir, "wakeflow-verify.mjs")
  : path.join(installedScriptsDir, "wakeflow-verify.mjs");
const issues = [];
const warnings = [];

if (useWorkspaceScripts && !existsSync(scriptsDir)) {
  issues.push("scripts directory is missing.");
}
if (!existsSync(readmePath)) {
  issues.push(useWorkspaceScripts ? "scripts/README.md is missing." : "installed Wakeflow scripts/README.md is missing.");
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
  issues.push("scripts/wakeflow-verify.mjs is missing; script tests cannot be wired into the verification pipeline.");
}

for (const scriptName of testScripts) {
  if (verifierContent && !verifierContent.includes(scriptName)) {
    issues.push(`${scriptName} is not included in wakeflow-verify --with-script-tests.`);
  }
}

for (const scriptName of scriptNames) {
  const scriptPath = path.join(scriptsDir, scriptName);
  if (existsSync(scriptPath)) {
    issues.push(...processExitIssues(scriptName, read(scriptPath)));
  }
}

// Allow-list <-> caller cross-check (source / installed-runtime only): every runtime
// allow-list entry should have at least one real caller — an MCP runWakeflowRuntime script
// arg, an intra-script spawn, a package.json npm script, or a verify path.join spawn. An
// entry with no detected caller is surfaced as a WARNING (not a failing issue) so a
// retired-but-still-listed script stays visible without breaking the pipeline before its
// scheduled removal. Only runs where the runtime registry is present (the source repo or an
// installed plugin runtime), never in a managed workspace that ships no runtime lib.
const runtimeRegistryPath = path.join(scriptsDir, "..", "lib", "wakeflow-runtime.mjs");
if (existsSync(scriptsDir) && existsSync(runtimeRegistryPath)) {
  const registry = read(runtimeRegistryPath);
  const allowListEntries = [...registry.matchAll(/\["([a-z0-9-]+)",\s*"([a-z0-9.-]+\.mjs)"\]/g)]
    .map((match) => ({ logical: match[1], file: match[2] }));
  const callerCorpus = [];
  for (const name of runtimeScripts) {
    callerCorpus.push({ base: name, text: read(path.join(scriptsDir, name)) });
  }
  const libDir = path.join(scriptsDir, "..", "lib");
  if (existsSync(libDir)) {
    for (const name of readdirSync(libDir).filter((entry) => entry.endsWith(".mjs"))) {
      callerCorpus.push({ base: name, text: read(path.join(libDir, name)) });
    }
  }
  const packageJsonPath = path.join(scriptsDir, "..", "package.json");
  if (existsSync(packageJsonPath)) {
    callerCorpus.push({ base: "package.json", text: read(packageJsonPath) });
  }
  for (const entry of allowListEntries) {
    const called = callerCorpus.some((source) => {
      if (source.base === entry.file) return false; // the entry's own file
      if (source.base === "wakeflow-runtime.mjs") return false; // the allow-list registry itself
      return (
        source.text.includes(`"${entry.logical}"`)
        || source.text.includes(`'${entry.logical}'`)
        || source.text.includes(entry.file)
      );
    });
    if (!called) {
      warnings.push(
        `runtime allow-list entry '${entry.logical}' (${entry.file}) has no detected caller `
          + "(MCP runWakeflowRuntime, intra-script spawn, package.json script, or verify spawn) — "
          + "wire it or retire it from the allow-list.",
      );
    }
  }
}

const result = {
  ok: issues.length === 0,
  scriptSource: useWorkspaceScripts ? "workspace-local" : "installed-runtime",
  workspaceScriptsDir: targetScriptsDir,
  runtimeScriptsDir: installedScriptsDir,
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
