#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkspaceConfig, workspaceLedgerPaths } from "./lib/workspace-config.mjs";
import { isCompletedState } from "./lib/status-machine.mjs";

const workspaceRoot = process.cwd();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const json = args.includes("--json");
const trimIndex = !args.includes("--keep-index-rows");
const pruneIndexOnly = args.includes("--prune-index-only");
const workspaceConfig = loadWorkspaceConfig({ workspaceRoot, args });
const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args, config: workspaceConfig });
const workspaceDocsDir = ledgerPaths.workspaceDocsDir;
const indexPath = ledgerPaths.workspaceIndexPath;
const recordMapPath = ledgerPaths.workspaceRecordMapPath;

function getArgValues(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    } else if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1));
    }
  }
  return values;
}

function getArgValue(name) {
  return getArgValues(name).at(-1) ?? null;
}

function normalizeTopic(topic) {
  return topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  return clean;
}

function splitMarkdownLinkTarget(target) {
  let clean = target.trim();
  const wrapped = clean.startsWith("<") && clean.endsWith(">");
  if (wrapped) {
    clean = clean.slice(1, -1);
  }
  const hashIndex = clean.indexOf("#");
  return {
    wrapped,
    pathPart: hashIndex >= 0 ? clean.slice(0, hashIndex) : clean,
    hashPart: hashIndex >= 0 ? clean.slice(hashIndex) : "",
  };
}

function isExternalTarget(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.trim().startsWith("#");
}

function rewriteMovedMarkdownLinks(content, from, to) {
  return content.replace(/(!?\[[^\]]*]\()([^)]+)(\))/g, (match, prefix, rawTarget, suffix) => {
    if (isExternalTarget(rawTarget)) {
      return match;
    }

    const { wrapped, pathPart, hashPart } = splitMarkdownLinkTarget(rawTarget);
    if (!pathPart || path.isAbsolute(pathPart)) {
      return match;
    }

    const oldAbsoluteTarget = path.resolve(path.dirname(from), pathPart);
    const nextRelativeTarget = relativePosix(path.dirname(to), oldAbsoluteTarget);
    const nextTarget = `${nextRelativeTarget}${hashPart}`;
    return `${prefix}${wrapped ? `<${nextTarget}>` : nextTarget}${suffix}`;
  });
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

function sectionRange(content, heading) {
  const start = content.indexOf(`## ${heading}`);
  if (start < 0) {
    return null;
  }
  const rest = content.slice(start + 1);
  const next = rest.search(/\n## /);
  return {
    start,
    end: next >= 0 ? start + 1 + next : content.length,
  };
}

function firstCurrentPlanPath(indexContent) {
  const currentSection = sectionContent(indexContent, "当前总控入口");
  for (const line of currentSection.split("\n")) {
    const cells = splitMarkdownRow(line);
    if (cells.length < 2 || cells[0] === "类型" || cells[0].startsWith("---")) {
      continue;
    }
    if (isCompletedState(cells[2])) {
      continue;
    }
    const match = cells[1].match(/\[[^\]]+]\(([^)]+)\)/);
    if (match) {
      return path.resolve(workspaceDocsDir, stripMarkdownLinkTarget(match[1]));
    }
  }
  return null;
}

function requireWorkspaceDoc(input) {
  const normalized = input
    .replace(/^docs\/workspace\//, "")
    .replace(/^\.workspace-active\/workspace\//, "");
  const directPath = path.resolve(workspaceRoot, input);
  const absolutePath = directPath.startsWith(`${workspaceDocsDir}${path.sep}`)
    ? directPath
    : path.resolve(workspaceDocsDir, normalized);

  if (!absolutePath.startsWith(`${workspaceDocsDir}${path.sep}`)) {
    throw new Error(`Refusing to archive path outside active workspace docs: ${input}`);
  }

  if (!existsSync(absolutePath)) {
    throw new Error(`Workspace doc does not exist: ${input}`);
  }

  if (!absolutePath.endsWith(".md")) {
    throw new Error(`Only Markdown workspace docs can be archived: ${input}`);
  }

  if (path.basename(absolutePath) === "index.md") {
    throw new Error("Refusing to archive active workspace index.md");
  }

  if (statSync(absolutePath).isDirectory()) {
    throw new Error(`Refusing to archive directory: ${input}`);
  }

  return absolutePath;
}

function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function replaceAllLiteral(content, from, to) {
  return content.split(from).join(to);
}

function archiveKey(monthValue, topicValue) {
  return `${monthValue}/${topicValue}`;
}

function archiveGroupFromLinkTarget(target) {
  const clean = stripMarkdownLinkTarget(target).replace(/^docs\/workspace\//, "");
  const absoluteTarget = path.resolve(workspaceDocsDir, clean);
  const relativeArchiveTarget = path.relative(ledgerPaths.workspaceArchiveDir, absoluteTarget);
  if (relativeArchiveTarget.startsWith("..") || path.isAbsolute(relativeArchiveTarget)) {
    return null;
  }
  const parts = relativeArchiveTarget.split(path.sep);
  if (parts.length < 3) {
    return null;
  }
  return {
    key: archiveKey(parts[0], parts[1]),
    monthValue: parts[0],
    topicValue: parts[1],
    archiveDir: path.join(ledgerPaths.workspaceArchiveDir, parts[0], parts[1]),
  };
}

function addArchiveSummaryGroup(groups, group, count = 1) {
  if (!group) {
    return;
  }
  const previous = groups.get(group.key);
  groups.set(group.key, {
    ...group,
    fileCount: (previous?.fileCount ?? 0) + count,
  });
}

function trimArchivedRowsFromIndex(content, archivedTargets) {
  const range = sectionRange(content, "当前总控入口");
  if (!range) {
    return { content, removedRows: [], summaryGroups: [] };
  }

  const section = content.slice(range.start, range.end);
  const removedRows = [];
  const summaryGroups = new Map();
  const nextLines = [];

  for (const line of section.split("\n")) {
    const cells = splitMarkdownRow(line);
    if (cells.length < 2 || cells[0] === "类型" || cells[0].startsWith("---")) {
      nextLines.push(line);
      continue;
    }

    const match = cells[1].match(/\[[^\]]+]\(([^)]+)\)/);
    if (!match) {
      nextLines.push(line);
      continue;
    }

    const absoluteTarget = path.resolve(workspaceDocsDir, stripMarkdownLinkTarget(match[1]));
    const archiveGroup = archiveGroupFromLinkTarget(match[1]);
    if (archivedTargets.has(absoluteTarget) || archiveGroup) {
      removedRows.push(line);
      addArchiveSummaryGroup(summaryGroups, archiveGroup);
      continue;
    }

    nextLines.push(line);
  }

  return {
    content: `${content.slice(0, range.start)}${nextLines.join("\n")}${content.slice(range.end)}`,
    removedRows,
    summaryGroups: [...summaryGroups.values()],
  };
}

function archiveSummaryRow({ monthValue, topicValue, archiveDir, fileCount, baseDir = workspaceDocsDir }) {
  const key = archiveKey(monthValue, topicValue);
  const archiveTarget = relativePosix(baseDir, archiveDir);
  return `| \`${key}\` | [${topicValue}](${archiveTarget}/) | 已归档 ${fileCount} 个 workspace 文档；当前索引只保留目录入口。 |`;
}

function countMarkdownFiles(directory) {
  if (!existsSync(directory)) {
    return 0;
  }
  let count = 0;
  for (const entry of readdirSync(directory)) {
    const absolutePath = path.join(directory, entry);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      count += countMarkdownFiles(absolutePath);
    } else if (entry.endsWith(".md")) {
      count += 1;
    }
  }
  return count;
}

function upsertArchiveSummary(content, row) {
  const heading = "Archive Topics";
  const section = sectionRange(content, heading);
  const summarySection = [
    `## ${heading}`,
    "",
    "| 归档主题 | 目录 | 说明 |",
    "| --- | --- | --- |",
    row,
    "",
  ].join("\n");

  if (!section) {
    const windowSection = sectionRange(content, "窗口覆盖状态");
    const insertAt = windowSection?.start ?? content.length;
    const prefix = content.slice(0, insertAt).replace(/\s*$/, "\n\n");
    const suffix = content.slice(insertAt).replace(/^\s*/, "");
    return `${prefix}${summarySection}${suffix ? `\n${suffix}` : ""}`;
  }

  const lines = content
    .slice(section.start, section.end)
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const keyMatch = row.match(/\| `([^`]+)` \|/);
  const key = keyMatch?.[1] ?? "";
  let replaced = false;
  let separatorIndex = -1;
  const nextLines = lines.map((line, index) => {
    const cells = splitMarkdownRow(line);
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      separatorIndex = index;
    }
    if (key && cells[0] === `\`${key}\``) {
      replaced = true;
      return row;
    }
    return line;
  });

  if (!replaced) {
    const insertAt = separatorIndex >= 0 ? separatorIndex + 1 : nextLines.length;
    nextLines.splice(insertAt, 0, row);
  }

  return `${content.slice(0, section.start)}${nextLines.join("\n")}\n\n${content
    .slice(section.end)
    .replace(/^\s*/, "")}`;
}

function recordMapSkeleton() {
  return [
    "# Workspace Record Map",
    "",
    "状态：长期记录清单",
    `维护窗口：${workspaceConfig.controlWindow}`,
    `更新日期：${new Date().toISOString().slice(0, 10)}`,
    "",
    `本文是 ${workspaceConfig.workspaceName} 的长期记录地图。当前开发区不直接散链到具体归档文件；需要历史细节时，从本文查询。`,
    "",
    "## Archive Topics",
    "",
    "| 归档主题 | 目录 | 说明 |",
    "| --- | --- | --- |",
  ].join("\n");
}

function ensureIndexArchiveCatalogEntry(content) {
  if (content.includes("workspace-record-map.md")) {
    return content;
  }

  const range = sectionRange(content, "当前总控入口");
  if (!range) {
    return content;
  }

  const lines = content.slice(range.start, range.end).split("\n");
  const recordMapLink = relativePosix(workspaceDocsDir, recordMapPath);
  const row = `| 长期记录地图 | [workspace-record-map.md](${recordMapLink}) | 长期地图 | 查询历史计划、归档 topic、已完成 TODO、测试历史和证据入口。 |`;
  const separatorIndex = lines.findIndex((line) => {
    const cells = splitMarkdownRow(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  });
  const insertAt = separatorIndex >= 0 ? separatorIndex + 1 : lines.length;
  lines.splice(insertAt, 0, row);
  return `${content.slice(0, range.start)}${lines.join("\n")}${content.slice(range.end)}`;
}

const topic = normalizeTopic(getArgValue("--topic") ?? "");
const month = getArgValue("--month") ?? "2026-05";
const files = getArgValues("--file");

const issues = [];
const operations = [];
let removedIndexRows = [];

if (!topic && files.length > 0) {
  issues.push("Missing --topic <name>");
}

if (files.length === 0 && !pruneIndexOnly) {
  issues.push("Missing --file <.workspace-active/workspace/current/file.md>; repeat --file for multiple docs");
}

const indexContent = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
const currentPlan = indexContent ? firstCurrentPlanPath(indexContent) : null;

if (!indexContent) {
  issues.push(`${relativePosix(workspaceRoot, indexPath)} is missing`);
}

let targetDir = "";
if (topic) {
  targetDir = path.join(ledgerPaths.workspaceArchiveDir, month, topic);
}

const plannedMoves = [];
for (const file of files) {
  try {
    const from = requireWorkspaceDoc(file);
    if (currentPlan && from === currentPlan) {
      throw new Error(`Refusing to archive current plan: ${relativePosix(workspaceRoot, from)}`);
    }

    const to = path.join(targetDir, path.basename(from));
    if (existsSync(to)) {
      throw new Error(`Archive target already exists: ${relativePosix(workspaceRoot, to)}`);
    }

    plannedMoves.push({ from, to });
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
}

if (issues.length === 0) {
  let nextIndexContent = indexContent;
  let nextArchiveCatalogContent = existsSync(recordMapPath)
    ? readFileSync(recordMapPath, "utf8")
    : recordMapSkeleton();
  const archivedTargets = new Set(plannedMoves.map(({ to }) => to));
  const summaryGroups = new Map();

  for (const { from, to } of plannedMoves) {
    const oldFromIndex = relativePosix(workspaceDocsDir, from);
    const newFromIndex = relativePosix(workspaceDocsDir, to);
    const oldFromRoot = relativePosix(workspaceRoot, from);
    const newFromRoot = relativePosix(workspaceRoot, to);

    nextIndexContent = replaceAllLiteral(nextIndexContent, `](${oldFromIndex})`, `](${newFromIndex})`);
    nextIndexContent = replaceAllLiteral(nextIndexContent, `](${oldFromRoot})`, `](${newFromRoot})`);

    operations.push({
      from: oldFromRoot,
      to: newFromRoot,
      indexRewrites: [oldFromIndex, oldFromRoot],
    });
  }

  if (trimIndex) {
    const trimResult = trimArchivedRowsFromIndex(nextIndexContent, archivedTargets);
    nextIndexContent = trimResult.content;
    removedIndexRows = trimResult.removedRows;
    for (const group of trimResult.summaryGroups) {
      addArchiveSummaryGroup(summaryGroups, group, group.fileCount);
    }
    if (plannedMoves.length > 0) {
      const key = archiveKey(month, topic);
      if (!summaryGroups.has(key)) {
        addArchiveSummaryGroup(summaryGroups, {
          key,
          monthValue: month,
          topicValue: topic,
          archiveDir: targetDir,
        }, plannedMoves.length);
      }
    }
    for (const group of summaryGroups.values()) {
      const pendingMoves = plannedMoves.filter(({ to }) => path.dirname(to) === group.archiveDir).length;
      const fileCount = Math.max(countMarkdownFiles(group.archiveDir) + pendingMoves, group.fileCount ?? 0);
      nextArchiveCatalogContent = upsertArchiveSummary(
        nextArchiveCatalogContent,
        archiveSummaryRow({ ...group, fileCount, baseDir: path.dirname(recordMapPath) }),
      );
    }
    if (summaryGroups.size > 0) {
      nextIndexContent = ensureIndexArchiveCatalogEntry(nextIndexContent);
    }
  }

  if (apply) {
    if (plannedMoves.length > 0) {
      mkdirSync(targetDir, { recursive: true });
    }
    for (const { from, to } of plannedMoves) {
      const movedContent = rewriteMovedMarkdownLinks(readFileSync(from, "utf8"), from, to);
      writeFileSync(to, movedContent);
      unlinkSync(from);
    }
    writeFileSync(indexPath, nextIndexContent);
    if (trimIndex && summaryGroups.size > 0) {
      mkdirSync(path.dirname(recordMapPath), { recursive: true });
      writeFileSync(recordMapPath, nextArchiveCatalogContent);
    }
  }
}

const result = {
  ok: issues.length === 0,
  applied: apply,
  archiveDir: targetDir ? relativePosix(workspaceRoot, targetDir) : null,
  currentPlan: currentPlan ? relativePosix(workspaceRoot, currentPlan) : null,
  trimIndex,
  pruneIndexOnly,
  operations,
  removedIndexRows,
  issues,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(apply ? "Workspace archive applied." : "Workspace archive dry-run passed.");
  if (result.archiveDir) {
    console.log(`Archive dir: ${result.archiveDir}`);
  }
  for (const operation of operations) {
    console.log(`- ${operation.from} -> ${operation.to}`);
  }
  if (trimIndex) {
    console.log(`Index rows removed: ${removedIndexRows.length}`);
  } else {
    console.log("Index row trimming disabled by --keep-index-rows.");
  }
  if (!apply) {
    console.log("Re-run with --apply to move files, rewrite links, and trim index rows.");
  }
} else {
  console.error("Workspace archive check failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
}

if (!result.ok) {
  process.exitCode = 1;
}
