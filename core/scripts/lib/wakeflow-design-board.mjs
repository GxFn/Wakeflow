import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

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

function formatCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function renderMarkdownRow(cells) {
  return `| ${cells.map(formatCell).join(" | ")} |`;
}

function atomicWriteText(file, content) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, content);
    renameSync(temp, file);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

function findHandoffTable(lines) {
  const headerIndex = lines.findIndex((line) => {
    const row = splitMarkdownRow(line);
    return row.includes("ID") && row.includes("Status");
  });
  if (headerIndex < 0) {
    return { headerIndex: -1, header: [], rowStart: -1, rowEnd: -1 };
  }
  let rowEnd = lines.length;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index])) {
      rowEnd = index;
      break;
    }
  }
  return {
    headerIndex,
    header: splitMarkdownRow(lines[headerIndex]),
    rowStart: headerIndex + 1,
    rowEnd,
  };
}

export function updateDesignHandoffStatus({
  boardPath,
  designKey,
  nextStatus,
  expectedStatuses = [],
  nextStepNote = "",
  write = false,
  workspaceRoot = process.cwd(),
} = {}) {
  if (!boardPath || !designKey || !nextStatus) {
    throw new Error("updateDesignHandoffStatus requires boardPath, designKey, and nextStatus.");
  }
  const absoluteBoardPath = path.resolve(workspaceRoot, boardPath);
  if (!existsSync(absoluteBoardPath)) {
    return {
      ok: false,
      updated: false,
      reason: "board-missing",
      board: path.relative(workspaceRoot, absoluteBoardPath).split(path.sep).join("/"),
    };
  }

  const previous = readFileSync(absoluteBoardPath, "utf8");
  const lines = previous.split(/\n/u);
  const table = findHandoffTable(lines);
  if (table.headerIndex < 0) {
    return {
      ok: false,
      updated: false,
      reason: "table-missing",
      board: path.relative(workspaceRoot, absoluteBoardPath).split(path.sep).join("/"),
    };
  }

  const idIndex = table.header.indexOf("ID");
  const statusIndex = table.header.indexOf("Status");
  const nextStepIndex = table.header.indexOf("Next Step");
  if (idIndex < 0 || statusIndex < 0) {
    return {
      ok: false,
      updated: false,
      reason: "columns-missing",
      board: path.relative(workspaceRoot, absoluteBoardPath).split(path.sep).join("/"),
    };
  }

  const allowedPrevious = new Set(expectedStatuses.filter(Boolean));
  for (let index = table.rowStart; index < table.rowEnd; index += 1) {
    const row = splitMarkdownRow(lines[index]);
    if (row.length === 0 || row.every((cell) => /^:?-{3,}:?$/u.test(cell))) {
      continue;
    }
    if (row[idIndex] !== designKey) {
      continue;
    }
    const previousStatus = row[statusIndex] ?? "";
    if (previousStatus === nextStatus) {
      return {
        ok: true,
        updated: false,
        alreadyCurrent: true,
        designKey,
        previousStatus,
        nextStatus,
        board: path.relative(workspaceRoot, absoluteBoardPath).split(path.sep).join("/"),
      };
    }
    if (allowedPrevious.size > 0 && !allowedPrevious.has(previousStatus)) {
      return {
        ok: false,
        updated: false,
        reason: "unexpected-status",
        designKey,
        previousStatus,
        expectedStatuses: [...allowedPrevious],
        nextStatus,
        board: path.relative(workspaceRoot, absoluteBoardPath).split(path.sep).join("/"),
      };
    }

    const nextRow = [...row];
    nextRow[statusIndex] = nextStatus;
    if (nextStepIndex >= 0 && nextStepNote) {
      nextRow[nextStepIndex] = nextStepNote;
    }
    lines[index] = renderMarkdownRow(nextRow);
    const next = lines.join("\n");
    if (write) {
      atomicWriteText(absoluteBoardPath, next.endsWith("\n") ? next : `${next}\n`);
    }
    return {
      ok: true,
      updated: true,
      wrote: write,
      designKey,
      previousStatus,
      nextStatus,
      board: path.relative(workspaceRoot, absoluteBoardPath).split(path.sep).join("/"),
    };
  }

  return {
    ok: false,
    updated: false,
    reason: "row-missing",
    designKey,
    board: path.relative(workspaceRoot, absoluteBoardPath).split(path.sep).join("/"),
  };
}
