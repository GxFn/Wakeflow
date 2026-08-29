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

test("public IDs map to deterministic fixed-length cross-platform storage keys", () => {
  const id = parseTodoItemId("TODO:RH1:001");
  const key = todoItemStorageKey(id);
  match(key, /^item-[0-9a-f]{64}$/u);
  equal(key.includes(":"), false);
  equal(key.includes(id), false);
  equal(todoItemStorageKey(id), key);
  notEqual(todoItemStorageKey("TODO:RH1:002"), key);
});

test("all aggregate refs stay under the fixed TODO root", () => {
  const id = parseTodoItemId("TODO-RH1-PATHS");
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

test("TODO item ID keeps one bounded case-sensitive opaque vocabulary", () => {
  equal(parseTodoItemId("A"), "A");
  equal(parseTodoItemId("A".repeat(128)), "A".repeat(128));
  for (const value of [
    "A".repeat(129),
    "-leading",
    "contains/slash",
    "contains space",
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
  notEqual(todoItemStorageKey("TODO-A"), todoItemStorageKey("todo-a"));
});
