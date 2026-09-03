import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_TODO_INSPECTION_REQUEST_SCHEMA,
} from "../../../src/contracts/generated/entrypoints/wakeflow-todo-inspection-request.generated.js";
import {
  WAKEFLOW_TODO_INSPECTION_RESULT_SCHEMA,
} from "../../../src/contracts/generated/entrypoints/wakeflow-todo-inspection-result.generated.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createTodoCollectionSnapshot } from "../../../src/governance/todo/todo-collection.js";
import {
  executeTodoInspectionQuery,
  parseTodoInspectionQuery,
} from "../../../src/governance/todo/todo-inspection-query.js";
import { createTodoIntake } from "../../../src/governance/todo/todo-intake.js";
import { createInitialTodoState } from "../../../src/governance/todo/todo-state.js";
import { todoIntakeDraft } from "./todo-intake.fixture.js";

const TODO_ID = "todo_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOT = "/workspace/private-todo-inspection";
const validateRequest = createRuntimeJsonSchemaValidator(
  WAKEFLOW_TODO_INSPECTION_REQUEST_SCHEMA,
);
const validateResult = createRuntimeJsonSchemaValidator(
  WAKEFLOW_TODO_INSPECTION_RESULT_SCHEMA,
);

function snapshot() {
  const intake = createTodoIntake(todoIntakeDraft(TODO_ID), {
    clock: () => parseUtcInstant("2026-09-03T07:00:00.000Z"),
  });
  return createTodoCollectionSnapshot([{
    intake,
    state: createInitialTodoState(intake),
  }]);
}

test("TODO Inspection request Schema关闭双view与非查询字段", () => {
  for (const value of [
    { root: ROOT, view: "list" },
    {
      root: ROOT,
      view: "list",
      filter: {
        statuses: ["pending-claim", "parked"],
        priorities: ["P0"],
        demandTypes: ["requirement"],
        autoClaim: true,
        originWindowId: "window_22222222-2222-4222-8222-222222222222",
      },
      pageSize: 1_000,
      pageToken: "",
    },
    { root: ROOT, view: "item", todoId: TODO_ID },
  ]) {
    equal(validateRequest(value).ok, true);
  }

  for (const value of [
    { root: ROOT, view: "list", eligible: true },
    { root: ROOT, view: "list", sort: "priority" },
    { root: ROOT, view: "list", filter: { statuses: [] } },
    {
      root: ROOT,
      view: "list",
      filter: { statuses: ["parked", "parked"] },
    },
    { root: ROOT, view: "item", todoId: TODO_ID, filter: {} },
    { root: ROOT, view: "item", todoId: "TODO-legacy" },
  ]) {
    equal(validateRequest(value).ok, false);
  }
});

test("TODO Inspection result Schema接受纯Query投影并拒绝权限或物理泄漏", () => {
  const source = snapshot();
  const list = executeTodoInspectionQuery(
    source,
    parseTodoInspectionQuery({ view: "list" }),
  );
  if (list.view !== "list") throw new Error("Expected list result.");
  const listWire = {
    ...list,
    tool: "wakeflow_inspect_todo",
    status: "current",
  };
  const item = executeTodoInspectionQuery(
    source,
    parseTodoInspectionQuery({
      view: "item",
      todoId: TODO_ID,
    }),
  );
  if (item.view !== "item") throw new Error("Expected item result.");
  const itemWire = {
    ...item,
    tool: "wakeflow_inspect_todo",
    status: "current",
  };
  equal(validateResult(listWire).ok, true);
  equal(validateResult(itemWire).ok, true);
  deepEqual(Object.keys(listWire).sort(), [
    "collection",
    "items",
    "kind",
    "nextPageToken",
    "schemaVersion",
    "status",
    "tool",
    "totalMatched",
    "view",
  ]);

  equal(validateResult({ ...listWire, eligibleTodoId: TODO_ID }).ok, false);
  equal(validateResult({
    ...listWire,
    items: [{ ...list.items[0], parkedTrigger: "not parked" }],
  }).ok, false);
  equal(validateResult({
    ...itemWire,
    item: {
      ...item.item,
      state: {
        ...item.item.state,
        stateRootRef: `.wakeflow-active/current/demand_private`,
      },
    },
  }).ok, false);
});
