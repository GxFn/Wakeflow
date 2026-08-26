import { equal } from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  TODO_PROJECTION_MAXIMUM_BYTES,
  type TodoCollectionAuthoritySnapshot,
} from "../../../src/governance/todo/todo-collection-authority.js";
import { renderTodoBoardProjection } from "../../../src/governance/todo/todo-board-projection.js";
import { createTodoCollectionSnapshot } from "../../../src/governance/todo/todo-collection.js";
import { TodoCollectionServiceError } from "../../../src/governance/todo/todo-collection-service.js";
import { commitTodoCollectionTransaction } from "../../../src/governance/todo/todo-collection-transaction-storage.js";
import { createTodoIntake } from "../../../src/governance/todo/todo-intake.js";
import { createInitialTodoState } from "../../../src/governance/todo/todo-state.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";

const CREATED_AT = parseUtcInstant("2026-08-26T09:00:00.000Z");
const MAXIMUM_GOAL = "😀".repeat(8192);

function capacityItem(index: number) {
  const todoId = `TODO-CAPACITY-${String(index).padStart(4, "0")}`;
  const intake = createTodoIntake({
    todoId,
    initialStatus: "pending-claim",
    type: "requirement",
    priority: "P1",
    ownerWindowId: "window_11111111-1111-4111-8111-111111111111",
    goal: MAXIMUM_GOAL,
    affectsRetestOrDispatch: false,
    dependency: null,
    recommendedWindowId: "window_22222222-2222-4222-8222-222222222222",
    autoClaim: true,
    testingDecision: { mode: "controller-only", summary: "x" },
    documents: [{
      label: "plan",
      ref: `ledger/${todoId}.json`,
      anchor: null,
    }],
  }, { clock: () => CREATED_AT });
  return { intake, state: createInitialTodoState(intake) };
}

test("projection capacity rejects the first overflowing append before journal creation", async () => {
  const candidates = Array.from({ length: 255 }, (_, index) => capacityItem(index));
  const currentItems = candidates.slice(0, -1);
  const target = candidates.at(-1);
  if (target === undefined) throw new Error("Missing capacity target.");

  equal(
    encodeUtf8(renderTodoBoardProjection(currentItems).content).byteLength
      <= TODO_PROJECTION_MAXIMUM_BYTES,
    true,
  );
  const collection = createTodoCollectionSnapshot(currentItems);
  const current = {
    collection,
    // Storage 只消费由 authority 签发的领域 item 字段；本测试不伪造物理 source。
    items: collection.items,
    projection: null,
  } as unknown as Readonly<TodoCollectionAuthoritySnapshot>;
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-todo-capacity-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    let caught: unknown;
    try {
      await commitTodoCollectionTransaction(
        root,
        "append",
        current,
        target.intake,
        null,
        target.state,
        undefined,
      );
    } catch (error: unknown) {
      caught = error;
    }
    if (!(caught instanceof TodoCollectionServiceError)) {
      throw new Error("Expected TodoCollectionServiceError.");
    }
    equal(caught.reason, "capacity");
    equal(readdirSync(rootPath).length, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
