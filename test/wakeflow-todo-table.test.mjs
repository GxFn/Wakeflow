import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TODO_COLUMNS,
  formatTodoRow,
  parseMarkdownRow,
  parseTodoBoard,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-todo-table.mjs";

test("TODO row codec round-trips pipes, backslashes, and newlines", () => {
  const value = Object.fromEntries(TODO_COLUMNS.map((column) => [column, ""]));
  value.ID = "codec-2026-07-30";
  value.Status = "pending-claim";
  value["Item / Goal"] = "left | right\nC:\\work";
  const line = formatTodoRow(value);
  assert.match(line, /left \\\| right<br>C:\\\\work/);
  const parsed = parseMarkdownRow(line);
  assert.equal(parsed.length, 13);
  assert.equal(parsed[TODO_COLUMNS.indexOf("Item / Goal")], value["Item / Goal"]);
});

test("both template bundles ship the exact canonical 13-column TODO header and divider", () => {
  for (const relative of [
    "../plugins/codex-wakeflow/templates/wakeflow-template-bundle.json",
    "../plugins/claude-code-wakeflow/templates/wakeflow-template-bundle.json",
  ]) {
    const bundle = JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
    const board = bundle.files["templates/starter-workspace/workspace/current/global-todo-board.md"];
    const parsed = parseTodoBoard(board);
    assert.equal(parsed.ok, true, `${relative}: ${parsed.issues.join("; ")}`);
    assert.equal(parsed.canonical, true, relative);
    assert.deepEqual(parsed.header, TODO_COLUMNS, relative);
    assert.equal(parseMarkdownRow(parsed.lines[parsed.dividerIndex]).length, 13, relative);
  }
});
