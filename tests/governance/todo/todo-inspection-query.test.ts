import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createTodoCollectionSnapshot,
  type TodoCollectionSnapshot,
} from "../../../src/governance/todo/todo-collection.js";
import {
  executeTodoInspectionQuery,
  parseTodoInspectionQuery,
  TODO_INSPECTION_DEFAULT_PAGE_SIZE,
  TODO_INSPECTION_MAXIMUM_PAGE_SIZE,
  TodoInspectionQueryError,
  type TodoInspectionQueryErrorReason,
} from "../../../src/governance/todo/todo-inspection-query.js";
import {
  computeTodoIntakeDigest,
  createTodoIntake,
} from "../../../src/governance/todo/todo-intake.js";
import {
  archiveTodoState,
  claimTodoState,
  computeTodoStateDigest,
  createInitialTodoState,
} from "../../../src/governance/todo/todo-state.js";
import {
  todoIntakeDraft,
  TODO_ORIGIN_WINDOW_ID,
} from "./todo-intake.fixture.js";

const FIRST_TIME = parseUtcInstant("2026-09-03T06:00:00.000Z");
const SECOND_TIME = parseUtcInstant("2026-09-03T06:00:01.000Z");
const THIRD_TIME = parseUtcInstant("2026-09-03T06:00:02.000Z");
const FOURTH_TIME = parseUtcInstant("2026-09-03T06:00:03.000Z");
const DEMAND_ID = "demand_77777777-7777-4777-8777-777777777777";

function item(
  todoId: string,
  createdAt = FIRST_TIME,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const intake = createTodoIntake(todoIntakeDraft(todoId, overrides), {
    clock: () => createdAt,
  });
  return { intake, state: createInitialTodoState(intake) };
}

function claimedItem(todoId: string) {
  const source = item(todoId, THIRD_TIME);
  return {
    intake: source.intake,
    state: claimTodoState(source.state, {
      demandId: DEMAND_ID,
      stateRootRef: `.wakeflow-active/current/${DEMAND_ID}`,
      identityDigest: `sha256:${"a".repeat(64)}`,
    }, { clock: () => FOURTH_TIME }),
  };
}

function archivedItem(todoId: string) {
  const claimed = claimedItem(todoId);
  return {
    intake: claimed.intake,
    state: archiveTodoState(claimed.state, {
      artifactKind: "wakeflow-business-archive-receipt",
      schemaVersion: 1,
      archiveId: "archive_88888888-8888-4888-8888-888888888888",
      demandId: DEMAND_ID,
      todoId,
      intakeDigest: computeTodoIntakeDigest(claimed.intake),
      claimedStateDigest: computeTodoStateDigest(claimed.state),
      manifestDigest: `sha256:${"b".repeat(64)}`,
    }, { clock: () => FOURTH_TIME }),
  };
}

function fixtureSnapshot(): Readonly<TodoCollectionSnapshot> {
  return createTodoCollectionSnapshot([
    item("todo_33333333-3333-4333-8333-333333333333", SECOND_TIME, {
      priority: "P0",
      autoClaim: false,
    }),
    item("todo_22222222-2222-4222-8222-222222222222", FIRST_TIME, {
      priority: "P0",
      readiness: {
        status: "parked",
        trigger: "Wait for the confirmed upstream decision.",
      },
      autoClaim: false,
    }),
    item("todo_11111111-1111-4111-8111-111111111111", FIRST_TIME, {
      priority: "P1",
    }),
    claimedItem("todo_44444444-4444-4444-8444-444444444444"),
    archivedItem("todo_55555555-5555-4555-8555-555555555555"),
  ]);
}

function expectQueryError(
  action: () => unknown,
  reason: TodoInspectionQueryErrorReason,
): TodoInspectionQueryError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof TodoInspectionQueryError)) {
    throw new Error("Expected TodoInspectionQueryError.");
  }
  equal(caught.reason, reason);
  return caught;
}

function inspect(
  snapshot: Readonly<TodoCollectionSnapshot>,
  query: unknown,
) {
  return executeTodoInspectionQuery(
    snapshot,
    parseTodoInspectionQuery(query),
  );
}

test("TODO Inspection list规范filter并在同一snapshot连续分页", () => {
  const snapshot = fixtureSnapshot();
  const first = inspect(snapshot, {
    view: "list",
    filter: {
      statuses: ["parked", "pending-claim"],
      priorities: ["P1", "P0"],
      originWindowId: TODO_ORIGIN_WINDOW_ID,
    },
    pageSize: 2,
  });
  if (first.view !== "list") throw new Error("Expected list result.");
  equal(first.totalMatched, 3);
  deepEqual(
    first.items.map((entry) => entry.todoId),
    [
      "todo_11111111-1111-4111-8111-111111111111",
      "todo_22222222-2222-4222-8222-222222222222",
    ],
  );
  equal(
    first.items[1]?.parkedTrigger,
    "Wait for the confirmed upstream decision.",
  );
  equal(first.nextPageToken.length > 0, true);
  equal(Object.isFrozen(first.items), true);
  equal(Object.isFrozen(first.items[0]), true);
  equal(JSON.stringify(first).includes("authorityRefs"), false);

  const second = inspect(snapshot, {
    view: "list",
    filter: {
      priorities: ["P0", "P1"],
      statuses: ["pending-claim", "parked"],
      originWindowId: TODO_ORIGIN_WINDOW_ID,
    },
    pageSize: 1,
    pageToken: first.nextPageToken,
  });
  if (second.view !== "list") throw new Error("Expected list result.");
  deepEqual(
    second.items.map((entry) => entry.todoId),
    ["todo_33333333-3333-4333-8333-333333333333"],
  );
  equal(second.nextPageToken, "");

  const autoClaim = inspect(snapshot, {
    view: "list",
    filter: {
      statuses: ["pending-claim"],
      demandTypes: ["requirement"],
      autoClaim: true,
    },
  });
  if (autoClaim.view !== "list") throw new Error("Expected list result.");
  deepEqual(
    autoClaim.items.map((entry) => entry.todoId),
    ["todo_11111111-1111-4111-8111-111111111111"],
  );
});

test("TODO Inspection page token绑定query与collection snapshot", () => {
  const snapshot = fixtureSnapshot();
  const first = inspect(snapshot, {
    view: "list",
    pageSize: 1,
  });
  if (first.view !== "list") throw new Error("Expected list result.");

  expectQueryError(
    () => inspect(snapshot, {
      view: "list",
      filter: { statuses: ["pending-claim"] },
      pageToken: first.nextPageToken,
    }),
    "page-token-mismatch",
  );

  const changed = createTodoCollectionSnapshot([
    ...snapshot.items.map((entry) => ({
      intake: entry.intake,
      state: entry.state,
    })),
    item("todo_66666666-6666-4666-8666-666666666666", FOURTH_TIME),
  ]);
  expectQueryError(
    () => inspect(changed, {
      view: "list",
      pageToken: first.nextPageToken,
    }),
    "stale-page-token",
  );

  const finalCharacter = first.nextPageToken.at(-1);
  const tampered = `${first.nextPageToken.slice(0, -1)}${
    finalCharacter === "A" ? "B" : "A"
  }`;
  expectQueryError(
    () => inspect(snapshot, {
      view: "list",
      pageToken: tampered,
    }),
    "page-token",
  );
});

test("TODO Inspection item返回完整业务Intake与脱敏State", () => {
  const snapshot = fixtureSnapshot();
  const result = inspect(snapshot, {
    view: "item",
    todoId: "todo_55555555-5555-4555-8555-555555555555",
  });
  if (result.view !== "item") throw new Error("Expected item result.");
  equal(result.item.intake.authorityRefs.length > 0, true);
  equal(result.item.state.status, "archived");
  equal(result.item.state.mountedDemandId, DEMAND_ID);
  equal(
    result.item.state.archive?.archiveId,
    "archive_88888888-8888-4888-8888-888888888888",
  );
  equal(Object.isFrozen(result.item), true);
  equal(Object.isFrozen(result.item.state), true);
  const serialized = JSON.stringify(result);
  equal(serialized.includes(".wakeflow-active"), false);
  equal(serialized.includes("identityDigest"), false);
  equal(serialized.includes("storageKey"), false);
  equal(serialized.includes("intakeSource"), false);
  equal(serialized.includes("projection"), false);

  expectQueryError(
    () => inspect(snapshot, {
      view: "item",
      todoId: "todo_99999999-9999-4999-8999-999999999999",
    }),
    "not-found",
  );
});

test("TODO Inspection request关闭容量、枚举与被动数据边界", () => {
  const normalized = parseTodoInspectionQuery({
    view: "list",
    filter: {
      statuses: ["archived", "pending-claim"],
      priorities: ["P3", "P0"],
    },
    pageSize: 1_000,
  });
  if (normalized.view !== "list") throw new Error("Expected list query.");
  equal(normalized.pageSize, TODO_INSPECTION_MAXIMUM_PAGE_SIZE);
  deepEqual(normalized.filter.statuses, ["pending-claim", "archived"]);
  deepEqual(normalized.filter.priorities, ["P0", "P3"]);
  equal(Object.isFrozen(normalized.filter.statuses), true);
  const defaulted = parseTodoInspectionQuery({
    view: "list",
    pageSize: 0,
  });
  if (defaulted.view !== "list") throw new Error("Expected list query.");
  equal(defaulted.pageSize, TODO_INSPECTION_DEFAULT_PAGE_SIZE);

  expectQueryError(
    () => parseTodoInspectionQuery({ view: "list", pageSize: undefined }),
    "page-size",
  );
  expectQueryError(
    () => parseTodoInspectionQuery({
      view: "list",
      filter: { statuses: [] },
    }),
    "input",
  );
  expectQueryError(
    () => parseTodoInspectionQuery({
      view: "list",
      filter: { statuses: ["parked", "parked"] },
    }),
    "input",
  );
  expectQueryError(
    () => parseTodoInspectionQuery({
      view: "item",
      todoId: "TODO-legacy",
    }),
    "identifier",
  );
  expectQueryError(
    () => parseTodoInspectionQuery({ view: "item", todoId: "todo", extra: true }),
    "input",
  );

  let getterCalls = 0;
  const accessor: Record<string, unknown> = { view: "list" };
  Object.defineProperty(accessor, "filter", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return {};
    },
  });
  expectQueryError(() => parseTodoInspectionQuery(accessor), "input");
  equal(getterCalls, 0);
});
