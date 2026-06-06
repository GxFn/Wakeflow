#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { workspaceLedgerPaths } from "./lib/workspace-config.mjs";

const workspaceRoot = process.cwd();
const args = process.argv.slice(2);
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
    if (cells.length < 3 || cells[0] === "归档主题" || cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
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
  const range = sectionRange(content, "索引行");
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
    return `| [${label}](${relativePosix(parentDir, dir)}/) | ${descriptions.get(key) ?? "历史归档主题。"} |`;
  });
}

if (existsSync(archiveRoot)) {
  const months = [...new Set(dirs.map(({ month }) => month))];
  const rootRows = months.map((month) => {
    const monthDir = path.join(archiveRoot, month);
    const topicCount = dirs.filter((item) => item.month === month).length;
    return `| [${month}](${relativePosix(archiveRoot, monthDir)}/) | ${topicCount} 个 topic 归档文件夹。 |`;
  });
  const rootIndexContent = [
    "# Workspace Archive Summary",
    "",
    "状态：归档区汇总",
    `维护入口：[workspace-record-map.md](${relativePosix(archiveRoot, recordMapPath)})`,
    "",
    "## 概括",
    "",
    "本文件是 workspace 归档区的总入口。归档正文文件保持当时证据快照；汇总说明和地图清单放在归档文件夹的 `index.md` 中。",
    "",
    "## 月份地图",
    "",
    "| 月份 | 说明 |",
    "| --- | --- |",
    ...(rootRows.length > 0 ? rootRows : ["| 无 | 当前没有归档月份。 |"]),
    "",
  ].join("\n");
  writeIfChanged(path.join(archiveRoot, "index.md"), `${rootIndexContent.replace(/\s+$/, "")}\n`);

  for (const month of months) {
    const monthDir = path.join(archiveRoot, month);
    const topics = dirs.filter((item) => item.month === month);
    const monthIndexContent = [
      `# ${month} Archive Summary`,
      "",
      "状态：归档月份汇总",
      `维护入口：[workspace-record-map.md](${relativePosix(monthDir, recordMapPath)})`,
      "",
      "## 概括",
      "",
      `本文件汇总 ${month} 的 workspace 归档 topic。每个 topic 文件夹的 \`index.md\` 继续提供该 topic 的概括和文件地图。`,
      "",
      "## Topic 地图",
      "",
      "| Topic | 说明 |",
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
  const description = descriptions.get(key) ?? "历史归档主题。";
  const files = listMarkdownFiles(dir);
  const mapRows = files.map((file) => {
    const name = path.basename(file);
    return `| [${name}](${relativePosix(dir, file)}) | ${inferKind(name)} | ${humanizeFileName(name)} |`;
  });
  const legacyRows = previousIndexRows(indexPath);

  const contentParts = [
    `# ${key} Archive Summary`,
    "",
    "状态：归档汇总",
    `归档主题：\`${key}\``,
    `维护入口：[workspace-record-map.md](${relativePosix(dir, recordMapPath)})`,
    "",
    "## 概括",
    "",
    description,
    "",
    "本文件是该归档文件夹的汇总说明和地图清单。历史正文文件作为当时证据快照保留；开发区长期文档只链接到记录地图或本归档目录，不直接散链到具体历史文件。",
    "",
    "## 地图清单",
    "",
    "| 文件 | 类型 | 说明 |",
    "| --- | --- | --- |",
    ...(mapRows.length > 0 ? mapRows : ["| 无 | 无 | 当前目录没有归档正文文件。 |"]),
    "",
  ];

  if (legacyRows.length > 0) {
    contentParts.push(
      "## 历史索引行",
      "",
      "以下内容是从旧活跃 workspace index 压缩下来的索引行，用于保留当时的开发者可读入口。",
      "",
      ...legacyRows.filter((line) => line !== "## 索引行"),
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
