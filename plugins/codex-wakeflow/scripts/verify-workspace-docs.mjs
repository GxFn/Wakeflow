#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { workspaceLedgerPaths } from "./lib/wakeflow-config.mjs";
import { isCompletedState, stateIdFromText } from "./lib/wakeflow-status-machine.mjs";

const args = process.argv.slice(2);
const workspaceRoot = path.resolve(getArgValue("--root") || process.cwd());
const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args });
const indexPath = ledgerPaths.workspaceIndexPath;
const json = args.includes("--json");
const allWorkspace = args.includes("--all-workspace");

function getArgValue(name) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) {
    return eq.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }

  return null;
}

function read(relativeOrAbsolutePath) {
  const absolutePath = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(workspaceRoot, relativeOrAbsolutePath);
  return readFileSync(absolutePath, "utf8");
}

function stripMarkdownLinkTarget(target) {
  let clean = target.trim();
  if (clean.startsWith("<") && clean.endsWith(">")) {
    clean = clean.slice(1, -1);
  }
  const hashIndex = clean.indexOf("#");
  if (hashIndex >= 0) {
    clean = clean.slice(0, hashIndex);
  }
  try {
    clean = decodeURI(clean);
  } catch {
    // Keep the raw path if it is not URI-encoded cleanly.
  }
  return clean;
}

function isExternalTarget(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#");
}

function extractMarkdownLinks(content) {
  const links = [];
  const regex = /!?\[[^\]]*]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(content))) {
    links.push(match[1]);
  }
  return links;
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

function firstTableDataRow(section) {
  const rows = section
    .split("\n")
    .map(splitMarkdownRow)
    .filter((row) => row.length > 0);
  return rows.find((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)) && row[0] !== "Type");
}

function extractFirstLinkTarget(markdown) {
  const match = markdown.match(/\[[^\]]+]\(([^)]+)\)/);
  return match ? match[1] : null;
}

function currentPlanPathFromIndex(indexContent) {
  const currentSection = sectionContent(indexContent, "Current Controller Entry");
  const firstRow = firstTableDataRow(currentSection);
  if (!firstRow || firstRow.length < 2) {
    return null;
  }

  const target = extractFirstLinkTarget(firstRow[1]);
  if (!target) {
    return null;
  }

  return path.resolve(path.dirname(indexPath), stripMarkdownLinkTarget(target));
}

function listMarkdownFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolutePath = path.join(directory, entry);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      files.push(...listMarkdownFiles(absolutePath));
    } else if (entry.endsWith(".md")) {
      files.push(absolutePath);
    }
  }
  return files;
}

function isArchivedWorkspaceDoc(file) {
  const relativePath = path.relative(ledgerPaths.workspaceArchiveDir, file);
  // Archive documents are historical snapshots. Allow old relative links and
  // validation commands there; strict link checks apply only to current
  // entries, long-term rules, and templates.
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function checkLinks(files) {
  const issues = [];
  let checked = 0;

  for (const file of files) {
    const content = read(file);
    const links = extractMarkdownLinks(content);
    for (const rawTarget of links) {
      const target = stripMarkdownLinkTarget(rawTarget);
      if (!target || isExternalTarget(target)) {
        continue;
      }
      checked += 1;
      const absoluteTarget = path.resolve(path.dirname(file), target);
      if (!existsSync(absoluteTarget)) {
        issues.push(
          `${path.relative(workspaceRoot, file)} links to missing ${path.relative(
            workspaceRoot,
            absoluteTarget,
          )}`,
        );
      }
    }
  }

  return { checked, issues };
}

function checkRequiredSections(label, content, requiredSections) {
  const issues = [];
  for (const section of requiredSections) {
    if (!section.regex.test(content)) {
      issues.push(`${label} is missing required section: ${section.name}`);
    }
  }
  return issues;
}

function parseDispatchRows(planContent) {
  const dispatch = sectionContent(planContent, "Window Dispatch");
  const rows = [];
  for (const line of dispatch.split("\n")) {
    const cells = splitMarkdownRow(line);
    if (
      cells.length < 2 ||
      cells[0] === "Window" ||
      cells[0] === "Window / Status" ||
      cells[0].startsWith("---")
    ) {
      continue;
    }

    if (cells.length === 2) {
      rows.push({
        window: cells[0].match(/`([^`]+)`/)?.[1] ?? cells[0].replace(/<br\s*\/?>/gi, " ").trim(),
        status: stateIdFromText(cells[0]) ?? "",
        docAction: "",
        savePath: "",
      });
      continue;
    }

    rows.push({
      window: cells[0].replaceAll("`", ""),
      status: cells[1],
      docAction: cells[3] ?? "",
      savePath: (cells[4] ?? "").replaceAll("`", ""),
    });
  }
  return rows;
}

function checkCompletedDocsExist(planContent) {
  const issues = [];
  const rows = parseDispatchRows(planContent);
  for (const row of rows) {
    const expectsExistingDoc = isCompletedState(row.status) || row.docAction === "created";
    const savePath = row.savePath.trim();
    if (!expectsExistingDoc || !savePath.startsWith("docs/")) {
      continue;
    }
    const absolutePath = path.join(workspaceRoot, savePath);
    if (!existsSync(absolutePath)) {
      issues.push(`${row.window} is marked ${row.status}/${row.docAction} but ${savePath} is missing`);
    }
  }
  return issues;
}

const explicitPlan = getArgValue("--plan");
const indexContent = existsSync(indexPath) ? read(indexPath) : "";
const currentPlanPath = explicitPlan
  ? path.resolve(workspaceRoot, explicitPlan)
  : indexContent
    ? currentPlanPathFromIndex(indexContent)
    : null;

const issues = [];
if (!existsSync(indexPath)) {
  issues.push(`${path.relative(workspaceRoot, indexPath)} is missing`);
}

if (!currentPlanPath || !existsSync(currentPlanPath)) {
  issues.push(
    currentPlanPath
      ? `current workspace plan is missing: ${path.relative(workspaceRoot, currentPlanPath)}`
      : `current workspace plan could not be resolved from ${path.relative(workspaceRoot, indexPath)}`,
  );
}

// Thin-entry governance: a workspace may keep its active entry docs as
// pointer-only surfaces (current state + navigation; demand history lives in
// its ledger, dispatch truth in state-root projections). The doc opts in with
// an EXPLICIT machine-readable marker, so default workspaces keep the full
// section contract and a thin doc is a decision, never an accident.
const THIN_DOC_CONTRACT = /<!--\s*wakeflow:doc-contract:\s*thin\s*-->/;

if (indexContent) {
  issues.push(
    ...checkRequiredSections(path.relative(workspaceRoot, indexPath), indexContent, THIN_DOC_CONTRACT.test(indexContent)
      ? [
        { name: "Status line", regex: /^Status:\s*.+$/m },
        { name: "Current Controller Entry", regex: /^## Current Controller Entry/m },
      ]
      : [
        { name: "Current Controller Entry", regex: /^## Current Controller Entry/m },
        { name: "Window Coverage Status", regex: /^## Window Coverage Status/m },
        { name: "Status Enum", regex: /^## Status Enum/m },
      ]),
  );
}

let planContent = "";
if (currentPlanPath && existsSync(currentPlanPath)) {
  planContent = read(currentPlanPath);
  issues.push(
    ...checkRequiredSections(path.relative(workspaceRoot, currentPlanPath), planContent, THIN_DOC_CONTRACT.test(planContent)
      ? [
        { name: "Current Controller Status", regex: /^## Current Controller Status/m },
      ]
      : [
        { name: "Window Dispatch", regex: /^## .*Window Dispatch/m },
        { name: "Copyable Prompt", regex: /^## .*Copyable/m },
        { name: "Backfill Area", regex: /^## .*Backfill Area/m },
      ]),
  );
  issues.push(...checkCompletedDocsExist(planContent));
}

const linkFiles = allWorkspace
  ? listMarkdownFiles(ledgerPaths.workspaceDocsDir).filter((file) => !isArchivedWorkspaceDoc(file))
  : [indexPath, currentPlanPath].filter(Boolean);
const linkResult = checkLinks([...new Set(linkFiles)]);
issues.push(...linkResult.issues);

const result = {
  ok: issues.length === 0,
  currentPlan: currentPlanPath ? path.relative(workspaceRoot, currentPlanPath) : null,
  checkedLinks: linkResult.checked,
  issues,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log("Workspace docs verification passed.");
  console.log(`Current plan: ${result.currentPlan}`);
  console.log(`Markdown links checked: ${result.checkedLinks}`);
} else {
  console.error("Workspace docs verification failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
}

if (!result.ok) {
  process.exitCode = 1;
}
