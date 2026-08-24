/**
 * TODO authority表格的一行级Markdown codec。
 *
 * 本模块只固定13列顺序以及pipe、backslash、newline的可逆表示；完整文档形状、
 * 字段语义、容量、lineage、锁、CAS和archive权限全部属于wakeflow-todo-service。
 */
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

function stringValue(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

function encodeMarkdownCell(value) {
  return stringValue(value, "Markdown cell")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n?|\n/g, "<br>");
}

function decodeMarkdownCell(value) {
  return stringValue(value, "Markdown cell")
    .replace(/<br\s*\/?>/gi, "\n");
}

/** 把一行canonical Markdown table bytes解码为cell字符串；非表格行返回空数组。 */
export function parseMarkdownRow(line) {
  const trimmed = stringValue(line, "Markdown row").trim();
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

function formatMarkdownRow(cells) {
  return `| ${cells.map(encodeMarkdownCell).join(" | ")} |`;
}

/** 从被动、闭合的13字段行对象生成唯一canonical Markdown row bytes。 */
export function formatTodoRow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("TODO row must be a plain data object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("TODO row must be a plain data object");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== TODO_COLUMNS.length
    || keys.some((key) => typeof key !== "string" || !TODO_COLUMNS.includes(key))
    || TODO_COLUMNS.some((column) => !keys.includes(column))
  ) {
    throw new TypeError("TODO row must contain exactly the canonical 13 columns");
  }
  const cells = [];
  for (const column of TODO_COLUMNS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, column);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`TODO row ${column} must be an enumerable data property`);
    }
    cells.push(stringValue(descriptor.value, `TODO row ${column}`));
  }
  return formatMarkdownRow(cells);
}
