#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveWorkspaceRoot, workspaceLedgerPaths } from "./lib/wakeflow-config.mjs";

const args = process.argv.slice(2);
const workspaceRoot = resolveWorkspaceRoot(args);
const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args });
const workspaceDocsDir = ledgerPaths.workspaceDocsDir;
const archiveRoot = ledgerPaths.workspaceArchiveDir;
const recordMapPath = ledgerPaths.workspaceRecordMapPath;
const apply = args.includes("--apply");
const json = args.includes("--json");

function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
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

function readArchiveTopicDescriptions() {
  if (!existsSync(recordMapPath)) {
    return new Map();
  }

  const content = readFileSync(recordMapPath, "utf8");
  const range = sectionRange(content, "Archive Topics");
  if (!range) {
    return new Map();
  }

  const descriptions = new Map();
  for (const line of content.slice(range.start, range.end).split("\n")) {
    const cells = splitMarkdownRow(line);
    if (cells.length < 3 || cells[0] === "Archive Topic" || cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      continue;
    }
    const key = cells[0].replace(/`/g, "");
    descriptions.set(key, cells[2]);
  }
  return descriptions;
}

function archiveTopicDirs() {
  if (!existsSync(archiveRoot)) {
    return [];
  }

  const dirs = [];
  for (const monthEntry of readdirSync(archiveRoot, { withFileTypes: true })) {
    if (!monthEntry.isDirectory() || !/^\d{4}-\d{2}$/.test(monthEntry.name)) {
      continue;
    }
    const monthDir = path.join(archiveRoot, monthEntry.name);
    for (const topicEntry of readdirSync(monthDir, { withFileTypes: true })) {
      if (topicEntry.isDirectory()) {
        dirs.push({
          month: monthEntry.name,
          topic: topicEntry.name,
          dir: path.join(monthDir, topicEntry.name),
        });
      }
    }
  }
  return dirs.sort((left, right) => `${left.month}/${left.topic}`.localeCompare(`${right.month}/${right.topic}`));
}

function listMarkdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function inferKind(fileName) {
  if (fileName.includes("workspace-plan")) return "workspace plan";
  if (fileName.includes("goal-stage-confirmation")) return "goal confirmation";
  if (fileName.includes("real-code-analysis") || fileName.includes("deep-audit")) return "code analysis";
  if (fileName.includes("global-todo-completed")) return "completed TODO archive";
  if (fileName.includes("test-exchange")) return "test exchange history";
  if (fileName.includes("closure-standard")) return "standard history";
  if (fileName.includes("acceptance")) return "acceptance / next plan";
  if (fileName.includes("wave")) return "wave plan";
  return "archive document";
}

function humanizeFileName(fileName) {
  return fileName
    .replace(/\.md$/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-/g, " ");
}

function previousIndexRows(indexPath) {
  if (!existsSync(indexPath)) {
    return [];
  }

  const content = readFileSync(indexPath, "utf8");
  const range = sectionRange(content, "Index Rows");
  if (!range) {
    return [];
  }

  return content
    .slice(range.start, range.end)
    .split("\n")
    .filter((line) => line.trim().startsWith("|") || line.startsWith("## "));
}

const descriptions = readArchiveTopicDescriptions();
const dirs = archiveTopicDirs();
const changed = [];

function writeIfChanged(filePath, content) {
  const previous = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  if (content !== previous) {
    changed.push(relativePosix(workspaceRoot, filePath));
    if (apply) {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, content);
    }
  }
}

function topicRowsFor(parentDir, topics) {
  return topics.map(({ month, topic, dir }) => {
    const key = `${month}/${topic}`;
    const label = parentDir === path.join(archiveRoot, month) ? topic : key;
    return `| [${label}](${relativePosix(parentDir, dir)}/) | ${descriptions.get(key) ?? "Historical archive topic."} |`;
  });
}

if (existsSync(archiveRoot)) {
  const months = [...new Set(dirs.map(({ month }) => month))];
  const rootRows = months.map((month) => {
    const monthDir = path.join(archiveRoot, month);
    const topicCount = dirs.filter((item) => item.month === month).length;
    return `| [${month}](${relativePosix(archiveRoot, monthDir)}/) | ${topicCount} topic archive folders. |`;
  });
  const rootIndexContent = [
    "# Workspace Archive Summary",
    "",
    "Status: archive area summary",
    `Maintained Entry: [workspace-record-map.md](${relativePosix(archiveRoot, recordMapPath)})`,
    "",
    "## Summary",
    "",
    "This file is the archive area entrypoint. Archived body files preserve evidence snapshots; summaries and maps live in archive `index.md` files.",
    "",
    "## Month Map",
    "",
    "| Month | Notes |",
    "| --- | --- |",
    ...(rootRows.length > 0 ? rootRows : ["| None | No archive months yet. |"]),
    "",
  ].join("\n");
  writeIfChanged(path.join(archiveRoot, "index.md"), `${rootIndexContent.replace(/\s+$/, "")}\n`);

  for (const month of months) {
    const monthDir = path.join(archiveRoot, month);
    const topics = dirs.filter((item) => item.month === month);
    const monthIndexContent = [
      `# ${month} Archive Summary`,
      "",
      "Status: archive month summary",
      `Maintained Entry: [workspace-record-map.md](${relativePosix(monthDir, recordMapPath)})`,
      "",
      "## Summary",
      "",
      `This file summarizes ${month} workspace archive topics. Each topic folder keeps its own \`index.md\` summary and file map.`,
      "",
      "## Topic Map",
      "",
      "| Topic | Notes |",
      "| --- | --- |",
      ...topicRowsFor(monthDir, topics),
      "",
    ].join("\n");
    writeIfChanged(path.join(monthDir, "index.md"), `${monthIndexContent.replace(/\s+$/, "")}\n`);
  }
}

for (const { month, topic, dir } of dirs) {
  const key = `${month}/${topic}`;
  const indexPath = path.join(dir, "index.md");
  const description = descriptions.get(key) ?? "Historical archive topic.";
  const files = listMarkdownFiles(dir);
  const mapRows = files.map((file) => {
    const name = path.basename(file);
    return `| [${name}](${relativePosix(dir, file)}) | ${inferKind(name)} | ${humanizeFileName(name)} |`;
  });
  const legacyRows = previousIndexRows(indexPath);

  const contentParts = [
    `# ${key} Archive Summary`,
    "",
    "Status: archive summary",
    `Archive Topic: \`${key}\``,
    `Maintained Entry: [workspace-record-map.md](${relativePosix(dir, recordMapPath)})`,
    "",
    "## Summary",
    "",
    description,
    "",
    "This file summarizes the archive folder and map. Historical body files remain evidence snapshots; active docs should link to the record map or archive directory instead of scattering direct historical file links.",
    "",
    "## Map",
    "",
    "| File | Type | Notes |",
    "| --- | --- | --- |",
    ...(mapRows.length > 0 ? mapRows : ["| None | None | This directory has no archived body files. |"]),
    "",
  ];

  if (legacyRows.length > 0) {
    contentParts.push(
      "## Historical Index Rows",
      "",
      "The following rows were compacted from a previous active workspace index to preserve historical developer-facing entrypoints.",
      "",
      ...legacyRows.filter((line) => line !== "## Index Rows"),
      "",
    );
  }

  const nextContent = `${contentParts.join("\n").replace(/\s+$/, "")}\n`;
  writeIfChanged(indexPath, nextContent);
}

const result = {
  ok: true,
  applied: apply,
  topics: dirs.length,
  changed: changed.length,
  files: changed,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(apply ? "Archive topic summaries generated." : "Archive topic summaries dry-run passed.");
  console.log(`Topics: ${dirs.length}`);
  console.log(`Summaries to update: ${changed.length}`);
  if (!apply && changed.length > 0) {
    console.log("Re-run with --apply to write index.md summaries.");
  }
}
