import assert from "node:assert/strict";
import test from "node:test";
import * as todoTable from "../plugins/codex-wakeflow/scripts/lib/wakeflow-todo-table.mjs";

const {
  TODO_COLUMNS,
  formatTodoRow,
  parseMarkdownRow,
} = todoTable;

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

  let rowReads = 0;
  const accessorRow = { ...value };
  Object.defineProperty(accessorRow, "ID", {
    enumerable: true,
    get() {
      rowReads += 1;
      return value.ID;
    },
  });
  assert.throws(() => formatTodoRow(accessorRow), TypeError);
  assert.equal(rowReads, 0, "row formatting must reject accessors without invoking them");

  let stringReads = 0;
  assert.throws(() => parseMarkdownRow({
    toString() {
      stringReads += 1;
      return line;
    },
  }), TypeError);
  assert.equal(stringReads, 0, "row parsing must not coerce behavior-bearing values");
});

test("the public TODO service renders the exact canonical 13-column board", async () => {
  assert.deepEqual(Object.keys(todoTable).sort(), [
    "TODO_COLUMNS",
    "TODO_DIVIDER",
    "TODO_HEADER",
    "formatTodoRow",
    "parseMarkdownRow",
  ]);
  for (const relative of [
    "../plugins/codex-wakeflow/scripts/lib/wakeflow-todo-service.mjs",
    "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-todo-service.mjs",
  ]) {
    const service = await import(relative);
    const board = service.renderTodoBoard();
    const scanned = service.scanTodoBoard(board);
    const headerLine = board.split("\n").find((line) => line.startsWith("| ID |"));
    assert.deepEqual(parseMarkdownRow(headerLine), TODO_COLUMNS, relative);
    assert.deepEqual(scanned.rows, []);
    assert.deepEqual(service.TODO_BOARD_COLUMNS, TODO_COLUMNS);
  }
});
