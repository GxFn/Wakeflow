#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { workspaceLedgerPaths } from "./lib/workspace-config.mjs";
import { isCompletedState, stateIdFromText } from "./lib/status-machine.mjs";

const workspaceRoot = process.cwd();
const args = process.argv.slice(2);
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
  return rows.find((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)) && row[0] !== "类型");
}

function extractFirstLinkTarget(markdown) {
  const match = markdown.match(/\[[^\]]+]\(([^)]+)\)/);
  return match ? match[1] : null;
}

function currentPlanPathFromIndex(indexContent) {
  const currentSection = sectionContent(indexContent, "当前总控入口");
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
  // 归档文档是历史快照，允许保留当时的相对链接和旧验证命令；当前入口、长期规则和模板才参与严格链接校验。
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
  const dispatch = sectionContent(planContent, "窗口分派");
  const rows = [];
  for (const line of dispatch.split("\n")) {
    const cells = splitMarkdownRow(line);
    if (
      cells.length < 2 ||
      cells[0] === "窗口" ||
      cells[0] === "窗口 / 状态" ||
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
    const expectsExistingDoc = isCompletedState(row.status) || row.docAction === "已新建";
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

if (indexContent) {
  issues.push(
    ...checkRequiredSections(path.relative(workspaceRoot, indexPath), indexContent, [
      { name: "当前总控入口", regex: /^## 当前总控入口/m },
      { name: "窗口覆盖状态", regex: /^## 窗口覆盖状态/m },
      { name: "状态枚举", regex: /^## 状态枚举/m },
    ]),
  );
}

let planContent = "";
if (currentPlanPath && existsSync(currentPlanPath)) {
  planContent = read(currentPlanPath);
  issues.push(
    ...checkRequiredSections(path.relative(workspaceRoot, currentPlanPath), planContent, [
      { name: "窗口分派", regex: /^## .*窗口分派/m },
      { name: "可复制提示词", regex: /^## .*可复制/m },
      { name: "回填区", regex: /^## .*回填区/m },
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
