import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";

const script = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../plugins/codex-wakeflow/scripts/wakeflow-todo.mjs",
);

const UNIFIED_HEADER =
  "| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount | Auto Claim | Documents |";
const DIVIDER = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
const LEGACY_HEADER =
  "| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount |";

function makeBoard(rows = "", header = UNIFIED_HEADER, divider = DIVIDER) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-todo-"));
  const boardPath = path.join(root, ".wakeflow-active/current/global-todo-board.md");
  mkdirSync(path.dirname(boardPath), { recursive: true });
  writeFileSync(boardPath, `${`# Global TODO\n\n## Global TODO\n\n${header}\n${divider}\n${rows}`.trimEnd()}\n`);
  return { root, boardPath };
}

function run(root, args) {
  return runSync(process.execPath, [script, ...args, "--json"], { cwd: root, encoding: "utf8" });
}
const parse = (result) => JSON.parse(result.stdout);

test("deliver appends a pending-claim row carrying the immutable Auto Claim property", () => {
  const { root, boardPath } = makeBoard();
  const payload = parse(run(root, [
    "deliver", "--type", "requirement", "--design-key", "feat-2026-06-21", "--title", "Feature",
    "--auto-claim", "--original-plan", "plan.md", "--requirement-design", "design.md", "--priority", "P1", "--apply",
  ]));
  assert.equal(payload.ok, true);
  assert.equal(payload.wrote, true);
  assert.equal(payload.autoClaim, true);
  const board = readFileSync(boardPath, "utf8");
  assert.match(board, /\| feat-2026-06-21 \| pending-claim \| requirement \|/);
  assert.match(board, /\| yes \| \[plan\]\(plan\.md\) \[design\]\(design\.md\) \|/);
});

test("requirement + auto-claim without both design docs is refused", () => {
  const { root } = makeBoard();
  const result = run(root, ["deliver", "--type", "requirement", "--design-key", "x-2026-06-21", "--title", "X", "--auto-claim", "--apply"]);
  assert.notEqual(result.status, 0);
  assert.match(parse(result).error, /requires --original-plan/);
});

test("bug delivery needs no design docs and defaults to not auto-claimable", () => {
  const { root, boardPath } = makeBoard();
  const payload = parse(run(root, ["deliver", "--type", "bug", "--design-key", "crash-2026-06-21", "--title", "Crash", "--apply"]));
  assert.equal(payload.ok, true);
  assert.equal(payload.autoClaim, false);
  assert.match(readFileSync(boardPath, "utf8"), /\| crash-2026-06-21 \| pending-claim \| bug \|/);
});

test("dry-run does not write and a duplicate ID is refused", () => {
  const { root, boardPath } = makeBoard(
    "| dup-2026-06-21 | pending-claim | bug | P2 | Design | existing | no | none | Wakeflow | none | no |  |",
  );
  const dry = parse(run(root, ["deliver", "--type", "bug", "--design-key", "new-2026-06-21", "--title", "New"]));
  assert.equal(dry.wrote, false);
  assert.equal(readFileSync(boardPath, "utf8").includes("new-2026-06-21"), false);
  const dupe = run(root, ["deliver", "--type", "bug", "--design-key", "dup-2026-06-21", "--title", "Dup", "--apply"]);
  assert.notEqual(dupe.status, 0);
  assert.match(parse(dupe).error, /already on the board/);
});

test("a legacy board missing the Auto Claim column is refused (must migrate first)", () => {
  const { root } = makeBoard("", LEGACY_HEADER, "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  const result = run(root, ["deliver", "--type", "bug", "--design-key", "x-2026-06-21", "--title", "X", "--apply"]);
  assert.notEqual(result.status, 0);
  assert.match(parse(result).error, /missing the 'Auto Claim' column/);
});

test("consume marks a delivered row claimed and links the demand state root", () => {
  const { root, boardPath } = makeBoard(
    "| feat-2026-06-21 | pending-claim | requirement | P1 | Design | F | no | none | Wakeflow | none | yes | [plan](p.md) |",
  );
  const payload = parse(run(root, [
    "consume", "--design-key", "feat-2026-06-21", "--mount", ".wakeflow-active/current/feat-2026-06-21", "--apply",
  ]));
  assert.equal(payload.ok, true);
  const board = readFileSync(boardPath, "utf8");
  assert.match(board, /feat-2026-06-21 \| completed \/ claimed \|/);
  assert.match(board, /\.wakeflow-active\/current\/feat-2026-06-21 \| yes \|/);
});

test("consume refuses an unknown ID", () => {
  const { root } = makeBoard();
  const result = run(root, ["consume", "--design-key", "missing-2026-06-21", "--mount", "x", "--apply"]);
  assert.notEqual(result.status, 0);
  assert.match(parse(result).error, /no TODO row with ID/);
});
