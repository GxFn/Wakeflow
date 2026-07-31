#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveWorkspaceRoot, workspaceLedgerPaths } from "./lib/wakeflow-config.mjs";
import { WakeflowStateLockTimeoutError, withFileLock } from "./lib/wakeflow-state-lock.mjs";
import { isCompletedState } from "./lib/wakeflow-status-machine.mjs";
import {
  TODO_DIVIDER,
  TODO_HEADER,
  formatTodoRow,
  normalizeTodoBoard,
  parseMarkdownRow,
  replaceTodoSection,
  todoBoardLockPath,
} from "./lib/wakeflow-todo-table.mjs";

const args = process.argv.slice(2);
const workspaceRoot = resolveWorkspaceRoot(args);
const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args });
const todoPath = ledgerPaths.globalTodoPath;
const apply = args.includes("--apply");
const json = args.includes("--json");

function getArgValue(name) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function sectionRange(content, heading) {
  const start = content.indexOf(`## ${heading}`);
  if (start < 0) return null;
  const rest = content.slice(start + 1);
  const next = rest.search(/\n## /u);
  return { start, end: next >= 0 ? start + 1 + next : content.length };
}

function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, file);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
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
    if (isExternalTarget(rawTarget)) return match;
    const { wrapped, pathPart, hashPart } = splitMarkdownLinkTarget(rawTarget);
    if (!pathPart || path.isAbsolute(pathPart)) return match;
    const absoluteTarget = path.resolve(path.dirname(todoPath), pathPart);
    if (!existsSync(absoluteTarget)) return match;
    const nextTarget = `${relativePosix(path.dirname(archiveFilePath), absoluteTarget)}${hashPart}`;
    return `${prefix}${wrapped ? `<${nextTarget}>` : nextTarget}${suffix}`;
  });
}

function upsertCompletedArchiveSection(content, recordMapTarget) {
  const heading = "Completed TODOs and Historical Sync Records";
  const nextSection = [
    `## ${heading}`,
    "",
    `Completed TODOs, historical sync records, and source archives are queried from [workspace-record-map.md](${recordMapTarget}).`,
    "",
  ].join("\n");
  const range = sectionRange(content, heading);
  if (range) {
    return `${content.slice(0, range.start)}${nextSection}\n\n${content.slice(range.end).replace(/^\s*/, "")}`;
  }
  const legacyRange = sectionRange(content, "Completed TODO Archive");
  if (legacyRange) {
    return `${content.slice(0, legacyRange.start)}${nextSection}\n\n${content.slice(legacyRange.end).replace(/^\s*/, "")}`;
  }
  const syncRange = sectionRange(content, "Recent Sync Records");
  if (!syncRange) return `${content.replace(/\s*$/, "\n\n")}${nextSection}\n`;
  return `${content.slice(0, syncRange.start)}${nextSection}\n\n${content.slice(syncRange.start)}`;
}

function isArchiveMarkerBullet(line) {
  return line.includes("Older completed TODOs and sync records were archived to");
}

function archivedTodoIds(content) {
  const ids = new Set();
  for (const line of content.split("\n")) {
    const cells = parseMarkdownRow(line);
    if (cells.length > 0 && cells[0] && cells[0] !== "ID" && !/^:?-{3,}:?$/u.test(cells[0])) {
      ids.add(cells[0]);
    }
  }
  return ids;
}

const month = getArgValue("--month") ?? "2026-05";
const archiveDate = getArgValue("--date") ?? new Date().toISOString().slice(0, 10);
const keepCompleted = Number.parseInt(getArgValue("--keep-completed") ?? "0", 10);
const keepSync = Number.parseInt(getArgValue("--keep-sync") ?? "8", 10);

function archiveTodoUnlocked() {
  const issues = [];
  if (!existsSync(todoPath)) {
    issues.push(`${relativePosix(workspaceRoot, todoPath)} is missing`);
    return { ok: false, applied: apply, completedRows: 0, archivedSync: 0, archive: null, issues };
  }

  const originalContent = readFileSync(todoPath, "utf8");
  const recordMapTarget = `${relativePosix(path.dirname(todoPath), ledgerPaths.workspaceRecordMapPath)}#todo-records`;
  const normalized = normalizeTodoBoard(originalContent);
  if (!normalized.range || normalized.headerIndex === undefined || normalized.issues.length > 0) {
    return {
      ok: false,
      applied: apply,
      completedRows: 0,
      archivedSync: 0,
      archive: null,
      issues: normalized.issues,
    };
  }

  const completedCandidates = normalized.rows.filter((row) => isCompletedState(row.value.Status));
  const retained = keepCompleted > 0 ? completedCandidates.slice(-keepCompleted) : [];
  const retainedIndexes = new Set(retained.map((row) => row.lineIndex));
  const completedRows = completedCandidates.filter((row) => !retainedIndexes.has(row.lineIndex));
  const removedIndexes = new Set(completedRows.map((row) => row.lineIndex));
  const nextTodoLines = normalized.lines.filter((_line, index) => !removedIndexes.has(index));

  const syncRange = sectionRange(normalized.content, "Recent Sync Records");
  const syncSection = syncRange ? normalized.content.slice(syncRange.start, syncRange.end) : "";
  const syncLines = syncSection ? syncSection.split("\n") : [];
  const syncHeader = syncLines.filter((line) => !line.trim().startsWith("- "));
  const syncBullets = syncLines.filter((line) => line.trim().startsWith("- "));
  const realSyncBullets = syncBullets.filter((line) => !isArchiveMarkerBullet(line));
  const archivedSync = keepSync > 0
    ? realSyncBullets.slice(0, Math.max(0, realSyncBullets.length - keepSync))
    : realSyncBullets;
  const keptSync = keepSync > 0 ? realSyncBullets.slice(-keepSync) : [];
  const nextSyncLines =
    syncRange && (keptSync.length > 0 || archivedSync.length > 0)
      ? [
          ...syncHeader.filter((line, index) => index === 0 || line.trim().length > 0),
          "",
          `- ${archiveDate}: Older completed TODOs and sync records were archived to [workspace-record-map.md](${recordMapTarget}).`,
          ...keptSync,
          "",
        ]
      : null;

  const archiveDir = path.join(ledgerPaths.workspaceArchiveDir, month, "global-todo");
  const archivePath = path.join(archiveDir, `global-todo-completed-${archiveDate}.md`);
  const existingArchiveContent = existsSync(archivePath) ? readFileSync(archivePath, "utf8") : "";
  const existingIds = archivedTodoIds(existingArchiveContent);
  const newCompletedRows = completedRows.filter((row) => !existingIds.has(row.value.ID));
  const archiveCompletedRows = newCompletedRows.map((row) => (
    rewriteTodoLinksForArchive(formatTodoRow(row.value), archivePath)
  ));
  const archiveSyncRows = archivedSync
    .map((line) => rewriteTodoLinksForArchive(line, archivePath))
    .filter((line) => !existingArchiveContent.includes(line));

  const baseArchiveContent = [
    "# Global TODO Completed Archive",
    "",
    `Archive Date: ${archiveDate}`,
    `Source: ${relativePosix(path.dirname(archivePath), todoPath)}`,
    "",
    `This file preserves completed TODOs and historical sync records compacted from \`${relativePosix(workspaceRoot, todoPath)}\` . Active and observing items remain on the global TODO board.`,
    "",
    "## Completed TODOs",
    "",
    TODO_HEADER,
    TODO_DIVIDER,
    ...archiveCompletedRows,
    "",
    "## Historical Sync Records",
    "",
    ...archiveSyncRows,
    "",
  ].join("\n");

  let archiveContent = baseArchiveContent;
  if (existingArchiveContent) {
    const appendSections = [];
    if (archiveCompletedRows.length > 0) {
      appendSections.push([
        `## Appended Completed TODOs (${archiveDate})`,
        "",
        TODO_HEADER,
        TODO_DIVIDER,
        ...archiveCompletedRows,
        "",
      ].join("\n"));
    }
    if (archiveSyncRows.length > 0) {
      appendSections.push([
        `## Appended Historical Sync Records (${archiveDate})`,
        "",
        ...archiveSyncRows,
        "",
      ].join("\n"));
    }
    archiveContent = `${existingArchiveContent.replace(/\s*$/, "\n\n")}${appendSections.join("\n")}`;
  }

  let nextContent = replaceTodoSection(normalized.content, normalized, nextTodoLines);
  if (nextSyncLines) {
    const nextSyncRange = sectionRange(nextContent, "Recent Sync Records");
    nextContent = `${nextContent.slice(0, nextSyncRange.start)}${nextSyncLines.join("\n")}${nextContent.slice(nextSyncRange.end)}`;
  }
  nextContent = upsertCompletedArchiveSection(nextContent, recordMapTarget);

  if (apply) {
    if (archiveCompletedRows.length > 0 || archiveSyncRows.length > 0) {
      atomicWrite(archivePath, archiveContent);
    }
    if (nextContent !== originalContent) atomicWrite(todoPath, nextContent);
  }

  return {
    ok: true,
    applied: apply,
    completedRows: completedRows.length,
    archivedSync: archivedSync.length,
    archive: relativePosix(workspaceRoot, archivePath),
    issues: [],
  };
}

let result;
try {
  result = withFileLock(todoBoardLockPath(todoPath), archiveTodoUnlocked);
} catch (error) {
  if (!(error instanceof WakeflowStateLockTimeoutError)) throw error;
  result = {
    ok: false,
    applied: false,
    completedRows: 0,
    archivedSync: 0,
    archive: null,
    issues: [error.message],
  };
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(apply ? "Global TODO archive applied." : "Global TODO archive dry-run passed.");
  console.log(`Completed rows to archive: ${result.completedRows}`);
  console.log(`Sync records to archive: ${result.archivedSync}`);
  if (result.archive) console.log(`Archive: ${result.archive}`);
  if (!apply && (result.completedRows > 0 || result.archivedSync > 0)) {
    console.log("Re-run with --apply to update the TODO board and write the archive.");
  }
} else {
  console.error("Global TODO archive failed:");
  for (const issue of result.issues) console.error(`- ${issue}`);
}

if (!result.ok) process.exitCode = 1;
