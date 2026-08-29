import { equal } from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { renderTodoBoardProjection } from "../../../src/governance/todo/todo-board-projection.js";
import {
  inspectTodoCollectionAuthority,
  TodoCollectionAuthorityError,
  type TodoCollectionAuthorityErrorReason,
} from "../../../src/governance/todo/todo-collection-authority.js";
import { createTodoIntake, renderTodoIntake } from "../../../src/governance/todo/todo-intake.js";
import { todoItemStorageKey } from "../../../src/governance/todo/todo-paths.js";
import { createInitialTodoState, renderTodoState } from "../../../src/governance/todo/todo-state.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";

interface Fixture {
  readonly rootPath: string;
  readonly todoRoot: string;
  readonly itemsRoot: string;
  readonly transactionsRoot: string;
  readonly projectionPath: string;
}

const CREATED_AT = parseUtcInstant("2026-08-26T09:00:00.000Z");

function fixture(): Fixture {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-todo-authority-"));
  const todoRoot = path.join(rootPath, ".wakeflow-active", "current", "todo");
  const itemsRoot = path.join(todoRoot, "items");
  const transactionsRoot = path.join(todoRoot, "transactions");
  mkdirSync(itemsRoot, { recursive: true, mode: 0o700 });
  mkdirSync(transactionsRoot, { mode: 0o700 });
  chmodSync(todoRoot, 0o700);
  chmodSync(itemsRoot, 0o700);
  chmodSync(transactionsRoot, 0o700);
  return {
    rootPath,
    todoRoot,
    itemsRoot,
    transactionsRoot,
    projectionPath: path.join(todoRoot, "global-todo-board.md"),
  };
}

function createItem(todoId: string) {
  const intake = createTodoIntake({
    todoId,
    initialStatus: "pending-claim",
    type: "requirement",
    priority: "P1",
    ownerWindowId: "window_11111111-1111-4111-8111-111111111111",
    goal: `Implement ${todoId}`,
    affectsRetestOrDispatch: false,
    dependency: null,
    recommendedWindowId: "window_22222222-2222-4222-8222-222222222222",
    autoClaim: true,
    testingDecision: {
      mode: "controller-only",
      summary: "Focused tests",
    },
    documents: [{
      label: "plan",
      ref: `ledger/requirements/${todoId}/record.json`,
      anchor: null,
    }],
  }, { clock: () => CREATED_AT });
  return { intake, state: createInitialTodoState(intake) };
}

function writeItem(target: Fixture, todoId: string, directoryKey?: string) {
  const item = createItem(todoId);
  const itemRoot = path.join(
    target.itemsRoot,
    directoryKey ?? todoItemStorageKey(todoId),
  );
  mkdirSync(itemRoot, { mode: 0o700 });
  writeFileSync(path.join(itemRoot, "intake.json"), renderTodoIntake(item.intake), {
    mode: 0o600,
  });
  writeFileSync(path.join(itemRoot, "state.json"), renderTodoState(item.state), {
    mode: 0o600,
  });
  return item;
}

async function expectAuthorityError(
  action: () => unknown | Promise<unknown>,
  reason: TodoCollectionAuthorityErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof TodoCollectionAuthorityError)) {
    throw new Error("Expected TodoCollectionAuthorityError.");
  }
  equal(caught.reason, reason);
}

test("empty initialized authority is valid and projection may be missing", async () => {
  const target = fixture();
  const root = await RootedDirectory.open(target.rootPath);
  try {
    const snapshot = await inspectTodoCollectionAuthority(root);
    equal(snapshot.collection.itemCount, 0);
    equal(snapshot.collection.activeItemCount, 0);
    equal(snapshot.projection.status, "missing");
    equal(snapshot.projection.expected.rowCount, 0);
  } finally {
    await root.close();
    rmSync(target.rootPath, { recursive: true, force: true });
  }
});

test("complete items produce exact physical sources and a current projection", async () => {
  const target = fixture();
  const first = writeItem(target, "TODO-AUTHORITY-A");
  const second = writeItem(target, "TODO-AUTHORITY-B");
  const projection = renderTodoBoardProjection([first, second]);
  writeFileSync(target.projectionPath, projection.content, { mode: 0o600 });
  const root = await RootedDirectory.open(target.rootPath);
  try {
    const snapshot = await inspectTodoCollectionAuthority(root);
    equal(snapshot.collection.itemCount, 2);
    equal(snapshot.items.length, 2);
    equal(snapshot.items.every((item) => item.intakeSource.node.kind === "file"), true);
    equal(snapshot.items.every((item) => item.stateSource.node.linkCount === 1n), true);
    equal(snapshot.projection.status, "current");
    equal(snapshot.projection.source?.digest, projection.sourceDigest);
  } finally {
    await root.close();
    rmSync(target.rootPath, { recursive: true, force: true });
  }
});

test("projection drift is diagnostic and never corrupts JSON authority", async () => {
  const target = fixture();
  writeItem(target, "TODO-AUTHORITY-STALE");
  writeFileSync(target.projectionPath, "stale projection\n", { mode: 0o600 });
  const root = await RootedDirectory.open(target.rootPath);
  try {
    const snapshot = await inspectTodoCollectionAuthority(root);
    equal(snapshot.collection.itemCount, 1);
    equal(snapshot.projection.status, "stale");
    equal(snapshot.projection.expected.content.includes("TODO-AUTHORITY-STALE"), true);
  } finally {
    await root.close();
    rmSync(target.rootPath, { recursive: true, force: true });
  }
});

test("pending transaction blocks normal authority inspection", async () => {
  const target = fixture();
  writeFileSync(
    path.join(target.transactionsRoot, `${todoItemStorageKey("TODO-RECOVERY")}.json`),
    "{}\n",
    { mode: 0o600 },
  );
  const root = await RootedDirectory.open(target.rootPath);
  try {
    await expectAuthorityError(
      () => inspectTodoCollectionAuthority(root),
      "recovery-required",
    );
  } finally {
    await root.close();
    rmSync(target.rootPath, { recursive: true, force: true });
  }
});

test("incomplete, misplaced, linked, and extra layout resources fail closed", async () => {
  const scenarios: Array<(target: Fixture) => void> = [
    (target) => {
      const key = todoItemStorageKey("TODO-INCOMPLETE");
      mkdirSync(path.join(target.itemsRoot, key), { mode: 0o700 });
    },
    (target) => {
      writeItem(target, "TODO-MISPLACED", todoItemStorageKey("TODO-OTHER"));
    },
    (target) => {
      const item = writeItem(target, "TODO-LINKED");
      const itemRoot = path.join(target.itemsRoot, todoItemStorageKey(item.intake.todoId));
      const statePath = path.join(itemRoot, "state.json");
      rmSync(statePath);
      symlinkSync("intake.json", statePath);
    },
    (target) => {
      const item = writeItem(target, "TODO-EXTRA");
      const itemRoot = path.join(target.itemsRoot, todoItemStorageKey(item.intake.todoId));
      writeFileSync(path.join(itemRoot, "extra.json"), "{}\n", { mode: 0o600 });
    },
    (target) => {
      writeFileSync(
        path.join(target.todoRoot, "foreign.json"),
        "{}\n",
        { mode: 0o600 },
      );
    },
  ];
  for (const prepare of scenarios) {
    const target = fixture();
    prepare(target);
    const root = await RootedDirectory.open(target.rootPath);
    try {
      await expectAuthorityError(
        () => inspectTodoCollectionAuthority(root),
        "tree-shape",
      );
    } finally {
      await root.close();
      rmSync(target.rootPath, { recursive: true, force: true });
    }
  }
});

test("options are passive and cancellation is cooperative", async () => {
  const target = fixture();
  const root = await RootedDirectory.open(target.rootPath);
  try {
    await expectAuthorityError(
      () => inspectTodoCollectionAuthority(root, null as never),
      "input",
    );
    const controller = new AbortController();
    controller.abort();
    await expectAuthorityError(
      () => inspectTodoCollectionAuthority(root, { signal: controller.signal }),
      "aborted",
    );
  } finally {
    await root.close();
    rmSync(target.rootPath, { recursive: true, force: true });
  }
});
