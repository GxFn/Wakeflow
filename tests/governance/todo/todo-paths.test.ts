import { equal, match, notEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  parseTodoItemId,
  TodoItemIdError,
} from "../../../src/governance/todo/todo-item-id.js";
import {
  TODO_BOARD_PROJECTION_REF,
  TODO_COLLECTION_LOCK_REF,
  TODO_COLLECTION_ROOT_REF,
  todoAppendStageRef,
  todoIntakeRef,
  todoItemRootRef,
  todoItemStorageKey,
  todoStateRef,
  todoTransactionRef,
} from "../../../src/governance/todo/todo-paths.js";

test("typed TODO IDs map to deterministic fixed-length storage keys", () => {
  const id = parseTodoItemId(
    "todo_11111111-1111-4111-8111-111111111111",
  );
  const key = todoItemStorageKey(id);
  match(key, /^item-[0-9a-f]{64}$/u);
  equal(key.includes(":"), false);
  equal(key.includes(id), false);
  equal(todoItemStorageKey(id), key);
  notEqual(
    todoItemStorageKey("todo_22222222-2222-4222-8222-222222222222"),
    key,
  );
});

test("all aggregate refs stay under the fixed TODO root", () => {
  const id = parseTodoItemId("todo_b59554ae-ab64-4d37-8716-ec4ace2c1c78");
  for (const ref of [
    todoItemRootRef(id),
    todoIntakeRef(id),
    todoStateRef(id),
    todoTransactionRef(id),
    todoAppendStageRef(id),
    TODO_COLLECTION_LOCK_REF,
    TODO_BOARD_PROJECTION_REF,
  ]) {
    equal(ref.startsWith(`${TODO_COLLECTION_ROOT_REF}/`), true);
    equal(ref.includes("\\"), false);
    equal(ref.includes(".."), false);
  }
  equal(todoIntakeRef(id).endsWith("/intake.json"), true);
  equal(todoStateRef(id).endsWith("/state.json"), true);
  equal(todoTransactionRef(id).endsWith(".json"), true);
  equal(todoAppendStageRef(id).endsWith(".stage"), true);
});

test("TODO item ID delegates the closed durable todo kind", () => {
  const valid = "todo_33333333-3333-4333-8333-333333333333";
  equal(parseTodoItemId(valid), valid);
  for (const value of [
    "TODO-M2-T09",
    "demand_33333333-3333-4333-8333-333333333333",
    "todo_33333333-3333-3333-8333-333333333333",
    "todo_33333333-3333-4333-7333-333333333333",
    "todo_33333333-3333-4333-8333-33333333333A",
    "todo_33333333-3333-4333-8333-333333333333_extra",
    "contains\ud800surrogate",
  ]) {
    let caught: unknown;
    try {
      parseTodoItemId(value, "$candidate");
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof TodoItemIdError, true);
    if (caught instanceof TodoItemIdError) equal(caught.path, "$candidate");
  }
  notEqual(
    todoItemStorageKey(valid),
    todoItemStorageKey("todo_44444444-4444-4444-8444-444444444444"),
  );
});
