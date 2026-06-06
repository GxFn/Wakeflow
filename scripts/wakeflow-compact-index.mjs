#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkspaceConfig, workspaceLedgerPaths } from "./lib/wakeflow-config.mjs";

const workspaceRoot = process.cwd();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const json = args.includes("--json");
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

function rewriteIndexRowLinksForManifest(row, manifestFilePath) {
  return row.replace(/(!?\[[^\]]*]\()([^)]+)(\))/g, (match, prefix, rawTarget, suffix) => {
    if (isExternalTarget(rawTarget)) {
      return match;
    }

    const { wrapped, pathPart, hashPart } = splitMarkdownLinkTarget(rawTarget);
    if (!pathPart || path.isAbsolute(pathPart)) {
      return match;
    }

    const oldAbsoluteTarget = path.resolve(workspaceDocsDir, pathPart);
    const nextRelativeTarget = relativePosix(path.dirname(manifestFilePath), oldAbsoluteTarget);
    const nextTarget = `${nextRelativeTarget}${hashPart}`;
    return `${prefix}${wrapped ? `<${nextTarget}>` : nextTarget}${suffix}`;
  });
}

function archiveKey(monthValue, topicValue) {
  return `${monthValue}/${topicValue}`;
}

function upsertArchiveSummary(content, row) {
  const heading = "Archive Topics";
  const section = sectionRange(content, heading);
  const summarySection = [
    `## ${heading}`,
    "",
    "| Archive Topic | Directory | Notes |",
    "| --- | --- | --- |",
    row,
    "",
  ].join("\n");

  if (!section) {
    const windowSection = sectionRange(content, "Window Coverage Status");
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
    "Status: long-term record map",
    `Maintained By: ${workspaceConfig.controllerWindow}`,
    `Updated Date: ${new Date().toISOString().slice(0, 10)}`,
    "",
    `This is the long-term record map for ${workspaceConfig.workspaceName}. The active workspace links to this map instead of scattering direct archive-file links.`,
    "",
    "## Archive Topics",
    "",
    "| Archive Topic | Directory | Notes |",
    "| --- | --- | --- |",
  ].join("\n");
}

function ensureIndexArchiveCatalogEntry(content) {
  if (content.includes("workspace-record-map.md")) {
    return content;
  }

  const range = sectionRange(content, "Current Controller Entry");
  if (!range) {
    return content;
  }

  const lines = content.slice(range.start, range.end).split("\n");
  const recordMapLink = relativePosix(workspaceDocsDir, recordMapPath);
  const row = `| Long-Term Record Map | [workspace-record-map.md](${recordMapLink}) | Long-Term Map | Query historical plans, archived topics, completed TODOs, test history, and evidence entrypoints. |`;
  const separatorIndex = lines.findIndex((line) => {
    const cells = splitMarkdownRow(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  });
  const insertAt = separatorIndex >= 0 ? separatorIndex + 1 : lines.length;
  lines.splice(insertAt, 0, row);
  return `${content.slice(0, range.start)}${lines.join("\n")}${content.slice(range.end)}`;
}

function compileMatchers(values) {
  return values.map((value) => new RegExp(value, "i"));
}

function rowIsData(line) {
  const cells = splitMarkdownRow(line);
  return cells.length >= 2 && cells[0] !== "Type" && !cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function rowIsProtectedCurrentEntry(line) {
  const cells = splitMarkdownRow(line);
  const type = cells[0] ?? "";
  const status = cells[2] ?? "";
  return (
    type.includes("Current Plan") ||
    type.includes("Current Status") ||
    type.includes("Current Work Area") ||
    type.includes("Long-Term") ||
    status.includes("Long-Term") ||
    status === "active"
  );
}

const month = getArgValue("--month") ?? "2026-05";
const topic = normalizeTopic(getArgValue("--topic") ?? "");
const matchers = compileMatchers(getArgValues("--match"));
const excludeMatchers = compileMatchers(getArgValues("--exclude-match"));
const title = getArgValue("--title") ?? topic;

const issues = [];
if (!topic) {
  issues.push("Missing --topic <name>");
}
if (matchers.length === 0) {
  issues.push("Missing --match <regex>; repeat --match for multiple patterns");
}
if (!existsSync(indexPath)) {
  issues.push(`${path.relative(workspaceRoot, indexPath)} is missing`);
}

let removedRows = [];
let manifestPath = "";

if (issues.length === 0) {
  const content = readFileSync(indexPath, "utf8");
  const range = sectionRange(content, "Current Controller Entry");
  if (!range) {
    issues.push("index.md is missing ## Current Controller Entry");
  } else {
    const section = content.slice(range.start, range.end);
    const nextLines = [];
    for (const line of section.split("\n")) {
      if (
        rowIsData(line) &&
        !rowIsProtectedCurrentEntry(line) &&
        matchers.some((matcher) => matcher.test(line)) &&
        !excludeMatchers.some((matcher) => matcher.test(line))
      ) {
        removedRows.push(line);
      } else {
        nextLines.push(line);
      }
    }

    const archiveDir = path.join(ledgerPaths.workspaceArchiveDir, month, topic);
    manifestPath = path.join(archiveDir, "index.md");
    const manifestRows = [
      "# Archived Workspace Index Rows",
      "",
      `Archive Topic: ${archiveKey(month, topic)}`,
      `Title: ${title}`,
      `Generated Date: ${new Date().toISOString().slice(0, 10)}`,
      "",
      `This file preserves historical index rows compacted from \`${path.relative(workspaceRoot, indexPath).split(path.sep).join("/")}\`. Original evidence documents remain in their original directories or topic archive directories.`,
      "",
      "## Index Rows",
      "",
      "| Type | Document | Status | Notes |",
      "| --- | --- | --- | --- |",
      ...removedRows.map((row) => rewriteIndexRowLinksForManifest(row, manifestPath)),
      "",
    ].join("\n");

    let nextContent = `${content.slice(0, range.start)}${nextLines.join("\n")}${content.slice(range.end)}`;
    let nextArchiveCatalogContent = existsSync(recordMapPath)
      ? readFileSync(recordMapPath, "utf8")
      : recordMapSkeleton();
    const archiveTarget = relativePosix(path.dirname(recordMapPath), path.dirname(manifestPath));
    const summaryRow = `| \`${archiveKey(month, topic)}\` | [${topic}](${archiveTarget}/) | Compacted ${removedRows.length} historical index rows into the topic manifest; the current index keeps only the directory entry. |`;
    if (removedRows.length > 0) {
      nextArchiveCatalogContent = upsertArchiveSummary(nextArchiveCatalogContent, summaryRow);
      nextContent = ensureIndexArchiveCatalogEntry(nextContent);
    }

    if (apply && removedRows.length > 0) {
      mkdirSync(archiveDir, { recursive: true });
      writeFileSync(manifestPath, manifestRows);
      mkdirSync(path.dirname(recordMapPath), { recursive: true });
      writeFileSync(recordMapPath, nextArchiveCatalogContent);
      writeFileSync(indexPath, nextContent);
    }
  }
}

const result = {
  ok: issues.length === 0,
  applied: apply,
  topic,
  month,
  removedRows: removedRows.length,
  manifest: manifestPath ? relativePosix(workspaceRoot, manifestPath) : null,
  issues,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(apply ? "Workspace index compaction applied." : "Workspace index compaction dry-run passed.");
  console.log(`Topic: ${archiveKey(month, topic)}`);
  console.log(`Rows to compact: ${removedRows.length}`);
  if (manifestPath) {
    console.log(`Manifest: ${relativePosix(workspaceRoot, manifestPath)}`);
  }
  if (!apply && removedRows.length > 0) {
    console.log("Re-run with --apply to update index.md and write the topic manifest.");
  }
} else {
  console.error("Workspace index compaction failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
}

if (!result.ok) {
  process.exitCode = 1;
}
