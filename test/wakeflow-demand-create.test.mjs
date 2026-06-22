import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";

const script = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../plugins/codex-wakeflow/scripts/wakeflow-demand-sequence.mjs",
);

const HEADER =
  "| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount | Auto Claim | Documents |";
const DIVIDER = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
// A delivered, controller-recommended, auto-claimable requirement row.
const DELIVERED_ROW =
  "| feat-2026-06-21 | pending-claim | requirement | P1 | Design | Build the feature | no | none | Wakeflow | none | yes | [plan](plan.md) [design](design.md) |";
// Eligible but NOT auto-claimable (Auto Claim = no): claimable only with an explicit key.
const MANUAL_ROW =
  "| manual-2026-06-21 | pending-claim | bug | P2 | Design | Fix the bug | no | none | Wakeflow | none | no |  |";

function makeWorkspace(rows = "") {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-create-"));
  const boardPath = path.join(root, ".wakeflow-active/current/global-todo-board.md");
  mkdirSync(path.dirname(boardPath), { recursive: true });
  writeFileSync(boardPath, `${`# Global TODO\n\n## Global TODO\n\n${HEADER}\n${DIVIDER}\n${rows}`.trimEnd()}\n`);
  return { root, boardPath };
}

function run(root, args) {
  return runSync(process.execPath, [script, ...args, "--root", root, "--json"], { cwd: root, encoding: "utf8" });
}
const parse = (result) => JSON.parse(result.stdout);
const statePath = (root, key) => path.join(root, `.wakeflow-active/current/${key}/wakeflow-state.json`);

test("create-demand from a delivered TODO row: inits, adopts host, renders, consumes the row", () => {
  const { root, boardPath } = makeWorkspace(DELIVERED_ROW);
  const payload = parse(run(root, ["create-demand", "--todo-id", "feat-2026-06-21", "--write"]));
  assert.equal(payload.ok, true);
  assert.equal(payload.wrote, true);
  assert.equal(payload.created.demandKey, "feat-2026-06-21");
  assert.equal(payload.created.consumedTodoId, "feat-2026-06-21");

  // The state root exists with the demand identity and an adopted controller host.
  const file = statePath(root, "feat-2026-06-21");
  assert.equal(existsSync(file), true);
  const state = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(state.demandKey, "feat-2026-06-21");
  assert.ok(state.controllerHost, "controllerHost is adopted by create-demand");

  // The TODO row is consumed: claimed and linked to the state root.
  const board = readFileSync(boardPath, "utf8");
  assert.match(board, /feat-2026-06-21 \| completed \/ claimed \|/);
  assert.match(board, /\.wakeflow-active\/current\/feat-2026-06-21 \| yes \|/);
});

test("create-demand with initial task packages adds them and plans the demand", () => {
  const { root } = makeWorkspace(DELIVERED_ROW);
  const taskPackages = JSON.stringify([
    { taskPackageId: "TP-1", summary: "First package", targetWindow: "Design", targetTaskId: "T-1" },
  ]);
  const payload = parse(run(root, ["create-demand", "--todo-id", "feat-2026-06-21", "--task-packages", taskPackages, "--write"]));
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.created.taskPackages, ["TP-1"]);
  const state = JSON.parse(readFileSync(statePath(root, "feat-2026-06-21"), "utf8"));
  // add-task-package moves the demand out of intake into planned.
  assert.equal(state.state, "planned");
});

test("create-demand inline (demandKey + title) inits without a TODO row", () => {
  const { root } = makeWorkspace();
  const payload = parse(run(root, [
    "create-demand", "--demand-key", "inline-2026-06-21", "--title", "Inline demand",
    "--goal", "Do the thing", "--completion-definition", "Thing is done", "--write",
  ]));
  assert.equal(payload.ok, true);
  assert.equal(payload.created.consumedTodoId, null);
  assert.equal(existsSync(statePath(root, "inline-2026-06-21")), true);
});

test("create-demand dry-run does not create a state root", () => {
  const { root } = makeWorkspace(DELIVERED_ROW);
  const payload = parse(run(root, ["create-demand", "--todo-id", "feat-2026-06-21"]));
  assert.equal(payload.wrote, false);
  assert.equal(existsSync(statePath(root, "feat-2026-06-21")), false);
});

test("create-demand refuses an ineligible / unknown TODO row", () => {
  const { root } = makeWorkspace();
  const result = run(root, ["create-demand", "--todo-id", "missing-2026-06-21", "--write"]);
  assert.notEqual(result.status, 0);
  assert.match(parse(result).error ?? "", /not an eligible candidate/);
});

test("create-demand refuses to re-create an existing demand state root", () => {
  const { root } = makeWorkspace(DELIVERED_ROW);
  assert.equal(run(root, ["create-demand", "--todo-id", "feat-2026-06-21", "--write"]).status, 0);
  // The row is consumed now; an inline retry on the same key hits the state-root guard.
  const second = run(root, ["create-demand", "--demand-key", "feat-2026-06-21", "--title", "Dup", "--write"]);
  assert.notEqual(second.status, 0);
  assert.match(parse(second).error ?? "", /already exists/);
});

test("claim-todo auto-claims the single controller-claimable row and consumes it", () => {
  const { root, boardPath } = makeWorkspace(DELIVERED_ROW);
  const payload = parse(run(root, ["claim-todo", "--write"]));
  assert.equal(payload.ok, true);
  assert.equal(payload.claimed.id, "feat-2026-06-21");
  assert.equal(payload.claimMode, "auto-claimable-todo");
  assert.equal(existsSync(statePath(root, "feat-2026-06-21")), true);
  assert.match(readFileSync(boardPath, "utf8"), /feat-2026-06-21 \| completed \/ claimed \|/);
});

test("claim-todo with no auto-claimable row reports nothing to claim", () => {
  const { root } = makeWorkspace(MANUAL_ROW);
  const payload = parse(run(root, ["claim-todo", "--write"]));
  assert.equal(payload.ok, true);
  assert.equal(payload.wrote, false);
  assert.equal(payload.claimed, null);
  assert.equal(existsSync(statePath(root, "manual-2026-06-21")), false);
});

test("claim-todo claims an explicit eligible row even when not auto-claimable", () => {
  const { root } = makeWorkspace(MANUAL_ROW);
  const payload = parse(run(root, ["claim-todo", "--design-key", "manual-2026-06-21", "--write"]));
  assert.equal(payload.ok, true);
  assert.equal(payload.claimMode, "explicit-eligible-todo");
  assert.equal(existsSync(statePath(root, "manual-2026-06-21")), true);
});

test("claim-todo refuses when multiple rows are controller-claimable", () => {
  const second =
    "| feat2-2026-06-21 | pending-claim | requirement | P1 | Design | Second | no | none | Wakeflow | none | yes | [plan](p.md) [design](d.md) |";
  const { root } = makeWorkspace(`${DELIVERED_ROW}\n${second}`);
  const result = run(root, ["claim-todo", "--write"]);
  assert.notEqual(result.status, 0);
  assert.match(parse(result).error ?? "", /multiple controller-claimable/);
});
