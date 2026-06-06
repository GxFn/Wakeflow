#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { workspaceLedgerPaths } from "./lib/workspace-config.mjs";
import { isCompletedState } from "./lib/status-machine.mjs";

const workspaceRoot = process.cwd();
const args = process.argv.slice(2);
const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args });
const workspaceDocsDir = ledgerPaths.workspaceDocsDir;
const todoPath = ledgerPaths.globalTodoPath;
const apply = args.includes("--apply");
const json = args.includes("--json");

function getArgValue(name) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) {
    return eq.slice(name.length + 1);
  }
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
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

function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function splitMarkdownLinkTarget(rawTarget) {
  const clean = rawTarget.trim();
  const wrapped = clean.startsWith("<") && clean.endsWith(">");
  const unwrapped = wrapped ? clean.slice(1, -1) : clean;
  const hashIndex = unwrapped.indexOf("#");
  return {
    wrapped,
    pathPart: hashIndex >= 0 ? unwrapped.slice(0, hashIndex) : unwrapped,
    hashPart: hashIndex >= 0 ? unwrapped.slice(hashIndex) : "",
  };
}

function isExternalTarget(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.trim().startsWith("#");
}

function rewriteTodoLinksForArchive(content, archiveFilePath) {
  return content.replace(/(!?\[[^\]]*]\()([^)]+)(\))/g, (match, prefix, rawTarget, suffix) => {
    if (isExternalTarget(rawTarget)) {
      return match;
    }

    const { wrapped, pathPart, hashPart } = splitMarkdownLinkTarget(rawTarget);
    if (!pathPart || path.isAbsolute(pathPart)) {
      return match;
    }

    const absoluteTarget = path.resolve(path.dirname(todoPath), pathPart);
    if (!existsSync(absoluteTarget)) {
      return match;
    }

    const nextTarget = `${relativePosix(path.dirname(archiveFilePath), absoluteTarget)}${hashPart}`;
    return `${prefix}${wrapped ? `<${nextTarget}>` : nextTarget}${suffix}`;
  });
}

function todoRowStatus(line) {
  const cells = splitMarkdownRow(line);
  if (cells.length < 2 || cells[0] === "ID" || cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return null;
  }
  return cells[1];
}

function upsertCompletedArchiveSection(content) {
  const heading = "已完成 TODO 和历史同步记录";
  const nextSection = [
    `## ${heading}`,
    "",
    "已完成 TODO、旧同步记录和来源归档统一从 [workspace-record-map.md](../workspace-record-map.md#todo-records) 查询。",
    "",
  ].join("\n");
  const range = sectionRange(content, heading);
  if (range) {
    return `${content.slice(0, range.start)}${nextSection}\n\n${content.slice(range.end).replace(/^\s*/, "")}`;
  }
  const legacyRange = sectionRange(content, "已完成 TODO 归档");
  if (legacyRange) {
    return `${content.slice(0, legacyRange.start)}${nextSection}\n\n${content.slice(legacyRange.end).replace(/^\s*/, "")}`;
  }
  const syncRange = sectionRange(content, "最近同步记录");
  if (!syncRange) {
    return `${content.replace(/\s*$/, "\n\n")}${nextSection}\n`;
  }
  return `${content.slice(0, syncRange.start)}${nextSection}\n\n${content.slice(syncRange.start)}`;
}

function isArchiveMarkerBullet(line) {
  return line.includes("更早的已完成 TODO 和同步记录已归档到");
}

const month = getArgValue("--month") ?? "2026-05";
const archiveDate = getArgValue("--date") ?? new Date().toISOString().slice(0, 10);
const keepCompleted = Number.parseInt(getArgValue("--keep-completed") ?? "0", 10);
const keepSync = Number.parseInt(getArgValue("--keep-sync") ?? "8", 10);

const issues = [];
if (!existsSync(todoPath)) {
  issues.push(`${relativePosix(workspaceRoot, todoPath)} is missing`);
}

let completedRows = [];
let archivedSync = [];
let archivePath = "";

if (issues.length === 0) {
  const content = readFileSync(todoPath, "utf8");
  const todoRange = sectionRange(content, "全局 TODO");
  const syncRange = sectionRange(content, "最近同步记录");
  if (!todoRange) {
    issues.push("global TODO board is missing ## 全局 TODO");
  }

  if (issues.length === 0) {
    const todoSection = content.slice(todoRange.start, todoRange.end);
    const todoLines = todoSection.split("\n");
    const completedCandidates = todoLines.filter((line) => isCompletedState(todoRowStatus(line)));
    const keepCompletedRows = keepCompleted > 0 ? completedCandidates.slice(-keepCompleted) : [];
    const keepCompletedSet = new Set(keepCompletedRows);
    completedRows = completedCandidates.filter((line) => !keepCompletedSet.has(line));
    const nextTodoLines = todoLines.filter((line) => !isCompletedState(todoRowStatus(line)) || keepCompletedSet.has(line));

    const syncSection = syncRange ? content.slice(syncRange.start, syncRange.end) : "";
    const syncLines = syncSection ? syncSection.split("\n") : [];
    const syncHeader = syncLines.filter((line) => !line.trim().startsWith("- "));
    const syncBullets = syncLines.filter((line) => line.trim().startsWith("- "));
    const realSyncBullets = syncBullets.filter((line) => !isArchiveMarkerBullet(line));
    archivedSync = keepSync > 0 ? realSyncBullets.slice(0, Math.max(0, realSyncBullets.length - keepSync)) : realSyncBullets;
    const keptSync = keepSync > 0 ? realSyncBullets.slice(-keepSync) : [];
    const nextSyncLines =
      syncRange && (keptSync.length > 0 || archivedSync.length > 0)
        ? [
            ...syncHeader.filter((line, index) => index === 0 || line.trim().length > 0),
            "",
            `- ${archiveDate}：更早的已完成 TODO 和同步记录已归档到 [workspace-record-map.md](../workspace-record-map.md#todo-records)。`,
            ...keptSync,
            "",
          ]
        : null;

    const archiveDir = path.join(ledgerPaths.workspaceArchiveDir, month, "global-todo");
    archivePath = path.join(archiveDir, `global-todo-completed-${archiveDate}.md`);
    const archiveCompletedRows = completedRows.map((line) => rewriteTodoLinksForArchive(line, archivePath));
    const archiveSyncRows = archivedSync.map((line) => rewriteTodoLinksForArchive(line, archivePath));
    const baseArchiveContent = [
      "# Global TODO Completed Archive",
      "",
      `归档日期：${archiveDate}`,
      `来源：${relativePosix(path.dirname(archivePath), todoPath)}`,
      "",
      `本文件保存从 \`${relativePosix(workspaceRoot, todoPath)}\` 压缩下来的已完成 TODO 和旧同步记录。活动项和观察项仍留在全局 TODO 列表。`,
      "",
      "## 已完成 TODO",
      "",
      "| ID | 状态 | 类型 | 优先级 | 归属 | 事项 / 目标 | 影响复测 / 派发 | 依赖 / 触发 | 推荐窗口 | 当前挂载 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...archiveCompletedRows,
      "",
      "## 旧同步记录",
      "",
      ...archiveSyncRows,
      "",
    ].join("\n");

    const existingArchiveContent = existsSync(archivePath) ? readFileSync(archivePath, "utf8") : "";
    let archiveContent = baseArchiveContent;

    if (existingArchiveContent) {
      const appendSections = [];
      if (completedRows.length > 0) {
        appendSections.push(
          [
            `## 追加已完成 TODO（${archiveDate}）`,
            "",
            "| ID | 状态 | 类型 | 优先级 | 归属 | 事项 / 目标 | 影响复测 / 派发 | 依赖 / 触发 | 推荐窗口 | 当前挂载 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
            ...archiveCompletedRows,
            "",
          ].join("\n"),
        );
      }
      if (archivedSync.length > 0) {
        appendSections.push(
          [
            `## 追加旧同步记录（${archiveDate}）`,
            "",
            ...archiveSyncRows,
            "",
          ].join("\n"),
        );
      }
      archiveContent = `${existingArchiveContent.replace(/\s*$/, "\n\n")}${appendSections.join("\n")}`;
    }

    let nextContent = `${content.slice(0, todoRange.start)}${nextTodoLines.join("\n")}${content.slice(todoRange.end)}`;
    if (nextSyncLines) {
      const nextSyncRange = sectionRange(nextContent, "最近同步记录");
      nextContent = `${nextContent.slice(0, nextSyncRange.start)}${nextSyncLines.join("\n")}${nextContent.slice(nextSyncRange.end)}`;
    }
    nextContent = upsertCompletedArchiveSection(nextContent);

    if (apply && (completedRows.length > 0 || archivedSync.length > 0)) {
      mkdirSync(archiveDir, { recursive: true });
      writeFileSync(archivePath, archiveContent);
      writeFileSync(todoPath, nextContent);
    }
  }
}

const result = {
  ok: issues.length === 0,
  applied: apply,
  completedRows: completedRows.length,
  archivedSync: archivedSync.length,
  archive: archivePath ? relativePosix(workspaceRoot, archivePath) : null,
  issues,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(apply ? "Global TODO archive applied." : "Global TODO archive dry-run passed.");
  console.log(`Completed rows to archive: ${completedRows.length}`);
  console.log(`Sync records to archive: ${archivedSync.length}`);
  if (archivePath) {
    console.log(`Archive: ${relativePosix(workspaceRoot, archivePath)}`);
  }
  if (!apply && (completedRows.length > 0 || archivedSync.length > 0)) {
    console.log("Re-run with --apply to update the TODO board and write the archive.");
  }
} else {
  console.error("Global TODO archive failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
}

if (!result.ok) {
  process.exitCode = 1;
}
