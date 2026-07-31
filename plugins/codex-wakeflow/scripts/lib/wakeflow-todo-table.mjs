export const TODO_COLUMNS = Object.freeze([
  "ID",
  "Status",
  "Type",
  "Priority",
  "Owner",
  "Item / Goal",
  "Affects Retest / Dispatch",
  "Dependency / Trigger",
  "Recommended Window",
  "Current Mount",
  "Auto Claim",
  "Testing Decision",
  "Documents",
]);

export const TODO_HEADER = formatMarkdownRow(TODO_COLUMNS);
export const TODO_DIVIDER = formatMarkdownRow(TODO_COLUMNS.map(() => "---"));

export function todoBoardLockPath(boardPath) {
  return `${boardPath}.lock`;
}

export function encodeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n?|\n/g, "<br>");
}

export function decodeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n");
}

export function parseMarkdownRow(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  const source = trimmed.slice(1, -1);
  const cells = [];
  let cell = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && index + 1 < source.length) {
      const next = source[index + 1];
      if (next === "\\" || next === "|") {
        cell += next;
        index += 1;
        continue;
      }
    }
    if (character === "|") {
      cells.push(decodeMarkdownCell(cell.trim()));
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(decodeMarkdownCell(cell.trim()));
  return cells;
}

export function formatMarkdownRow(cells) {
  return `| ${cells.map(encodeMarkdownCell).join(" | ")} |`;
}

export function isMarkdownDivider(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

export function todoSectionRange(content) {
  const start = content.indexOf("## Global TODO");
  if (start < 0) return null;
  const rest = content.slice(start + 1);
  const next = rest.search(/\n## /u);
  return {
    start,
    end: next >= 0 ? start + 1 + next : content.length,
  };
}

function rowObject(header, cells) {
  return Object.fromEntries(header.map((column, index) => [column, cells[index] ?? ""]));
}

export function formatTodoRow(value) {
  return formatMarkdownRow(TODO_COLUMNS.map((column) => value[column] ?? ""));
}

export function parseTodoBoard(content) {
  const range = todoSectionRange(content);
  if (!range) {
    return { ok: false, issues: ["global TODO board is missing ## Global TODO"] };
  }
  const lines = content.slice(range.start, range.end).split("\n");
  const headerIndex = lines.findIndex((line) => {
    const cells = parseMarkdownRow(line);
    return cells.includes("ID") && cells.includes("Status");
  });
  if (headerIndex < 0) {
    return { ok: false, range, lines, issues: ["global TODO board is missing the ID/Status table header"] };
  }
  const header = parseMarkdownRow(lines[headerIndex]);
  const dividerIndex = headerIndex + 1;
  const divider = parseMarkdownRow(lines[dividerIndex]);
  const issues = [];
  if (!isMarkdownDivider(divider)) issues.push("global TODO table is missing its divider row");
  const rows = [];
  const ids = new Set();
  for (let lineIndex = headerIndex + 2; lineIndex < lines.length; lineIndex += 1) {
    const cells = parseMarkdownRow(lines[lineIndex]);
    if (cells.length === 0) continue;
    if (isMarkdownDivider(cells)) continue;
    const value = rowObject(header, cells);
    if (!value.ID) continue;
    if (ids.has(value.ID)) issues.push(`global TODO board contains duplicate ID: ${value.ID}`);
    ids.add(value.ID);
    rows.push({ lineIndex, cells, value });
  }
  return {
    ok: issues.length === 0,
    issues,
    range,
    lines,
    headerIndex,
    dividerIndex,
    header,
    rows,
    canonical: header.length === TODO_COLUMNS.length
      && header.every((column, index) => column === TODO_COLUMNS[index])
      && divider.length === TODO_COLUMNS.length,
  };
}

export function replaceTodoSection(content, parsed, nextLines) {
  return `${content.slice(0, parsed.range.start)}${nextLines.join("\n")}${content.slice(parsed.range.end)}`;
}

export function normalizeTodoBoard(content, { mapCell = null } = {}) {
  const parsed = parseTodoBoard(content);
  if (!parsed.range || parsed.headerIndex === undefined) return { ...parsed, content, changed: false };
  const lines = [...parsed.lines];
  lines[parsed.headerIndex] = TODO_HEADER;
  lines[parsed.dividerIndex] = TODO_DIVIDER;
  for (const row of parsed.rows) {
    const value = {};
    for (const column of TODO_COLUMNS) {
      const current = row.value[column] ?? "";
      value[column] = mapCell ? mapCell({ column, value: current, row: row.value }) : current;
    }
    lines[row.lineIndex] = formatTodoRow(value);
  }
  const nextContent = replaceTodoSection(content, parsed, lines);
  const normalized = parseTodoBoard(nextContent);
  return {
    ...normalized,
    content: nextContent,
    changed: nextContent !== content,
  };
}
