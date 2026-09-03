import { deepEqual, equal } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  appendTodoItem,
  initializeTodoCollection,
} from "../../../src/governance/todo/todo-collection-service.js";
import {
  executeTodoInspectionPublicRequest,
  TodoInspectionPublicContractError,
  TodoInspectionPublicCoordinatorError,
} from "../../../src/governance/todo/todo-inspection-public-coordinator.js";
import { parseTodoInspectionPublicRequest } from "../../../src/governance/todo/todo-inspection-public-contract.js";
import { materializeWakeflowActiveLayout } from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";
import { todoIntakeDraft } from "./todo-intake.fixture.js";

const FIRST_TODO_ID = "todo_a1111111-1111-4111-8111-111111111111";
const SECOND_TODO_ID = "todo_a2222222-2222-4222-8222-222222222222";
const THIRD_TODO_ID = "todo_a3333333-3333-4333-8333-333333333333";

async function createFixture() {
  const rootPath = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-todo-inspection-public-"),
  );
  const root = await RootedDirectory.open(rootPath);
  try {
    await materializeWakeflowActiveLayout(root, {
      recoveringFreshLayout: false,
    });
    await initializeTodoCollection(root, { freshWorkspace: true });
    await appendTodoItem(root, todoIntakeDraft(FIRST_TODO_ID), {
      clock: () => parseUtcInstant("2026-09-03T08:00:00.000Z"),
    });
    await appendTodoItem(root, todoIntakeDraft(SECOND_TODO_ID, {
      priority: "P0",
      autoClaim: false,
    }), {
      clock: () => parseUtcInstant("2026-09-03T08:00:01.000Z"),
    });
  } finally {
    await root.close();
  }
  return rootPath;
}

async function appendThird(
  rootPath: string,
  summary?: string,
): Promise<void> {
  const root = await RootedDirectory.open(rootPath);
  try {
    await appendTodoItem(root, todoIntakeDraft(THIRD_TODO_ID, {
      ...(summary === undefined ? {} : { summary }),
    }), {
      clock: () => parseUtcInstant("2026-09-03T08:00:02.000Z"),
    });
  } finally {
    await root.close();
  }
}

function expectContractError(
  action: () => unknown,
  reason: TodoInspectionPublicContractError["reason"],
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof TodoInspectionPublicContractError)) {
    throw new Error("Expected TodoInspectionPublicContractError.");
  }
  equal(caught.reason, reason);
}

test("TODO Inspection Public Contract重建规范query且拒绝非被动wire", () => {
  const request = parseTodoInspectionPublicRequest({
    root: "/workspace/todo",
    view: "list",
    filter: {
      statuses: ["archived", "pending-claim"],
      priorities: ["P3", "P0"],
    },
    pageSize: 1_000,
  });
  equal(request.query.view, "list");
  if (request.query.view !== "list") throw new Error("Expected list query.");
  deepEqual(request.query.filter.statuses, ["pending-claim", "archived"]);
  deepEqual(request.query.filter.priorities, ["P0", "P3"]);
  equal(request.query.pageSize, 100);

  expectContractError(
    () => parseTodoInspectionPublicRequest({
      root: "x".repeat(129 * 1024),
      view: "list",
    }),
    "capacity",
  );
  expectContractError(
    () => parseTodoInspectionPublicRequest({
      root: "/workspace/todo",
      view: "list",
      eligible: true,
    }),
    "schema",
  );

  let getterCalls = 0;
  const accessor: Record<string, unknown> = {
    root: "/workspace/todo",
    view: "list",
  };
  Object.defineProperty(accessor, "filter", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return {};
    },
  });
  expectContractError(
    () => parseTodoInspectionPublicRequest(accessor),
    "json",
  );
  equal(getterCalls, 0);
});

test("TODO Inspection Public Coordinator真实分页与item结果不泄漏物理事实", async () => {
  const rootPath = await createFixture();
  try {
    const first = await executeTodoInspectionPublicRequest({
      root: rootPath,
      view: "list",
      pageSize: 1,
    });
    if (first.view !== "list") throw new Error("Expected list result.");
    equal(first.tool, "wakeflow_inspect_todo");
    equal(first.items[0]?.todoId, FIRST_TODO_ID);
    equal(first.nextPageToken.length > 0, true);

    const second = await executeTodoInspectionPublicRequest({
      root: rootPath,
      view: "list",
      pageSize: 2,
      pageToken: first.nextPageToken,
    });
    if (second.view !== "list") throw new Error("Expected list result.");
    deepEqual(second.items.map((entry) => entry.todoId), [SECOND_TODO_ID]);
    equal(second.nextPageToken, "");

    const item = await executeTodoInspectionPublicRequest({
      root: rootPath,
      view: "item",
      todoId: FIRST_TODO_ID,
    });
    if (item.view !== "item") throw new Error("Expected item result.");
    equal(item.item.intake.authorityRefs.length > 0, true);
    const serialized = JSON.stringify({ first, item });
    equal(serialized.includes(rootPath), false);
    equal(serialized.includes("intakeSource"), false);
    equal(serialized.includes("stateSource"), false);
    equal(serialized.includes("projection"), false);
    equal(serialized.includes("storageKey"), false);
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("TODO Inspection Public Coordinator保留stale token分类并阻止root回显", async () => {
  const rootPath = await createFixture();
  try {
    const first = await executeTodoInspectionPublicRequest({
      root: rootPath,
      view: "list",
      pageSize: 1,
    });
    if (first.view !== "list") throw new Error("Expected list result.");
    await appendThird(rootPath);

    let caught: unknown;
    try {
      await executeTodoInspectionPublicRequest({
        root: rootPath,
        view: "list",
        pageToken: first.nextPageToken,
      });
    } catch (error: unknown) {
      caught = error;
    }
    if (!(caught instanceof TodoInspectionPublicCoordinatorError)) {
      throw new Error("Expected TodoInspectionPublicCoordinatorError.");
    }
    equal(caught.reason, "inspection");
    equal(caught.causeCode, "wakeflow-todo-inspection-query");
    equal(caught.causeReason, "stale-page-token");
    equal(JSON.stringify(caught).includes(rootPath), false);
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("TODO Inspection Public Coordinator拒绝业务文本中的私有root", async () => {
  const rootPath = await createFixture();
  try {
    await appendThird(rootPath, `Do not expose ${rootPath}`);
    let caught: unknown;
    try {
      await executeTodoInspectionPublicRequest({
        root: rootPath,
        view: "list",
      });
    } catch (error: unknown) {
      caught = error;
    }
    if (!(caught instanceof TodoInspectionPublicCoordinatorError)) {
      throw new Error("Expected TodoInspectionPublicCoordinatorError.");
    }
    equal(caught.reason, "output");
    equal(JSON.stringify(caught).includes(rootPath), false);
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});
