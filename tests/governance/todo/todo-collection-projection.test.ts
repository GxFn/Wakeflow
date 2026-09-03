import { equal, notEqual } from "node:assert/strict";
import { test } from "node:test";

import { renderTodoBoardProjection } from "../../../src/governance/todo/todo-board-projection.js";
import {
  createTodoCollectionSnapshot,
  isTodoCollectionStatusActive,
  TodoCollectionError,
  type TodoCollectionErrorReason,
} from "../../../src/governance/todo/todo-collection.js";
import {
  computeTodoIntakeDigest,
  createTodoIntake,
} from "../../../src/governance/todo/todo-intake.js";
import {
  activateTodoState,
  archiveTodoState,
  claimTodoState,
  computeTodoStateDigest,
  createInitialTodoState,
  withdrawTodoState,
} from "../../../src/governance/todo/todo-state.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { todoIntakeDraft } from "./todo-intake.fixture.js";

const BASE_TIME = parseUtcInstant("2026-08-26T09:00:00.000Z");
const LATER_TIME = parseUtcInstant("2026-08-26T09:00:01.000Z");
const DEMAND_ID = "demand_33333333-3333-4333-8333-333333333333";

function item(
  todoId: string,
  createdAt = BASE_TIME,
  summary = `Implement ${todoId}`,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const intake = createTodoIntake(todoIntakeDraft(todoId, {
    summary,
    ...overrides,
  }), {
    clock: () => createdAt,
  });
  return { intake, state: createInitialTodoState(intake) };
}

function expectCollectionError(
  action: () => unknown,
  reason: TodoCollectionErrorReason,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof TodoCollectionError)) {
    throw new Error("Expected TodoCollectionError.");
  }
  equal(caught.reason, reason);
}

test("collection order is createdAt then TODO ID and independent of input order", () => {
  const first = item("todo_22222222-2222-4222-8222-222222222222", BASE_TIME);
  const second = item("todo_11111111-1111-4111-8111-111111111111", BASE_TIME);
  const third = item("todo_33333333-3333-4333-8333-333333333333", LATER_TIME);
  const left = createTodoCollectionSnapshot([third, first, second]);
  const right = createTodoCollectionSnapshot([second, third, first]);

  equal(
    left.items.map((entry) => entry.todoId).join(","),
    [second.intake.todoId, first.intake.todoId, third.intake.todoId].join(","),
  );
  equal(left.collectionDigest, right.collectionDigest);
  equal(left.itemCount, 3);
  equal(left.activeItemCount, 3);
  equal(Object.isFrozen(left.items), true);
});

test("collection activity classification keeps schedulable states only", () => {
  equal(isTodoCollectionStatusActive("pending-claim"), true);
  equal(isTodoCollectionStatusActive("parked"), true);
  equal(isTodoCollectionStatusActive("claimed"), true);
  equal(isTodoCollectionStatusActive("withdrawn"), false);
  equal(isTodoCollectionStatusActive("archived"), false);
});

test("parked intake follows the exact reachable revision sequence", () => {
  const source = item(
    "todo_0a14ffb3-cdbf-455c-a099-748a2d2e2e06",
    BASE_TIME,
    "Follow the parked lifecycle",
    {
      readiness: {
        status: "parked",
        trigger: "Wait for the confirmed upstream decision.",
      },
      autoClaim: false,
    },
  );
  const activated = activateTodoState(source.state, {
    clock: () => LATER_TIME,
  });
  const claimed = claimTodoState(activated, {
    demandId: DEMAND_ID,
    stateRootRef: `.wakeflow-active/current/${DEMAND_ID}`,
    identityDigest: `sha256:${"a".repeat(64)}`,
  }, { clock: () => LATER_TIME });
  const archived = archiveTodoState(claimed, {
    artifactKind: "wakeflow-business-archive-receipt",
    schemaVersion: 1,
    archiveId: "archive_66666666-6666-4666-8666-666666666666",
    demandId: DEMAND_ID,
    todoId: source.intake.todoId,
    intakeDigest: computeTodoIntakeDigest(source.intake),
    claimedStateDigest: computeTodoStateDigest(claimed),
    manifestDigest: `sha256:${"b".repeat(64)}`,
  }, { clock: () => parseUtcInstant("2026-08-26T09:00:02.000Z") });

  for (const [state, revision] of [
    [source.state, 1],
    [activated, 2],
    [claimed, 3],
    [archived, 4],
  ] as const) {
    const snapshot = createTodoCollectionSnapshot([{
      intake: source.intake,
      state,
    }]);
    equal(snapshot.items[0]?.state.revision, revision);
  }
});

test("projection exposes current rows and declares itself non-authoritative", () => {
  const pending = item("todo_b012c2b6-96dd-4830-8278-8fdd0c00eefc");
  const claimedBase = item("todo_77c88ece-1b0e-4e40-87cc-62f6e4b551af", LATER_TIME);
  const claimed = {
    intake: claimedBase.intake,
    state: claimTodoState(claimedBase.state, {
      demandId: DEMAND_ID,
      stateRootRef: `.wakeflow-active/current/${DEMAND_ID}`,
      identityDigest: `sha256:${"a".repeat(64)}`,
    }, { clock: () => LATER_TIME }),
  };
  const projection = renderTodoBoardProjection([claimed, pending]);

  equal(projection.rowCount, 2);
  equal(projection.content.includes("deterministic projection"), true);
  equal(projection.content.includes("todo_b012c2b6-96dd-4830-8278-8fdd0c00eefc"), true);
  equal(projection.content.includes("todo_77c88ece-1b0e-4e40-87cc-62f6e4b551af"), true);
  equal(projection.content.includes(`.wakeflow-active/current/${DEMAND_ID}`), true);
  equal(projection.content.endsWith("\n"), true);
  equal(projection.content.endsWith("\n\n"), false);
});

test("projection escapes Markdown cells without defining a reverse input format", () => {
  const source = item(
    "todo_01d9c6ca-bce8-41a5-814e-f892fadcbb11",
    BASE_TIME,
    "Line 1 \\ path | pipe\nLine 2",
  );
  const projection = renderTodoBoardProjection([source]);

  equal(
    projection.content.includes(
      "Line 1 &#92; path &#124; pipe<br>Line 2",
    ),
    true,
  );
});

test("projection neutralizes HTML and bidi controls and renders validated authority links", () => {
  const source = item(
    "todo_84a3d5dc-8db6-420c-87d3-a0c283eeb88a",
    BASE_TIME,
    "<script>`move`\u202e",
  );
  const content = renderTodoBoardProjection([source]).content;
  equal(content.includes("<script>"), false);
  equal(content.includes("&lt;script&gt;&#96;move&#96;&#92;u202e"), true);
  equal(content.includes(
    "[original-plan](requirements/requirement_44444444-4444-4444-8444-444444444444/authority/00-original-plan.md)",
  ), true);
});

test("terminal items remain in authority digest but disappear from projection", () => {
  const withdrawalSource = item("todo_1e5d916d-a51c-4285-82d8-84d700024956");
  const withdrawn = withdrawTodoState(withdrawalSource.state, {
    reason: "The confirmed work is no longer planned.",
  }, { clock: () => LATER_TIME });

  const archiveSource = item("todo_3671e39d-f703-417d-8ca6-a2c54157bf30");
  const claimed = claimTodoState(archiveSource.state, {
    demandId: DEMAND_ID,
    stateRootRef: `.wakeflow-active/current/${DEMAND_ID}`,
    identityDigest: `sha256:${"a".repeat(64)}`,
  }, { clock: () => LATER_TIME });
  const archived = archiveTodoState(claimed, {
    artifactKind: "wakeflow-business-archive-receipt",
    schemaVersion: 1,
    archiveId: "archive_44444444-4444-4444-8444-444444444444",
    demandId: DEMAND_ID,
    todoId: archiveSource.intake.todoId,
    intakeDigest: computeTodoIntakeDigest(archiveSource.intake),
    claimedStateDigest: computeTodoStateDigest(claimed),
    manifestDigest: `sha256:${"b".repeat(64)}`,
  }, { clock: () => parseUtcInstant("2026-08-26T10:00:00.000Z") });

  const active = createTodoCollectionSnapshot([
    withdrawalSource,
    { intake: archiveSource.intake, state: claimed },
  ]);
  const terminalItems = [
    { intake: withdrawalSource.intake, state: withdrawn },
    { intake: archiveSource.intake, state: archived },
  ];
  const terminal = createTodoCollectionSnapshot(terminalItems);
  equal(terminal.itemCount, 2);
  equal(terminal.activeItemCount, 0);
  notEqual(terminal.collectionDigest, active.collectionDigest);
  const projection = renderTodoBoardProjection(terminalItems);
  equal(projection.rowCount, 0);
  equal(projection.content.includes(withdrawalSource.intake.todoId), false);
  equal(projection.content.includes(archiveSource.intake.todoId), false);
});

test("duplicate IDs, identity mismatches, and unreachable lineage fail before projection", () => {
  const first = item("todo_dde8ddaf-de9f-4187-85b1-b3eef3ecce17");
  expectCollectionError(
    () => createTodoCollectionSnapshot([first, first]),
    "duplicate",
  );
  const other = item("todo_2a725bb8-3057-46fa-832e-b4a44f4676db");
  expectCollectionError(
    () => createTodoCollectionSnapshot([{ intake: first.intake, state: other.state }]),
    "item-identity",
  );
  expectCollectionError(
    () => createTodoCollectionSnapshot([{
      intake: first.intake,
      state: { ...first.state, status: "parked" },
    }]),
    "item-lineage",
  );
  const claimed = claimTodoState(first.state, {
    demandId: DEMAND_ID,
    stateRootRef: `.wakeflow-active/current/${DEMAND_ID}`,
    identityDigest: `sha256:${"a".repeat(64)}`,
  }, { clock: () => LATER_TIME });
  expectCollectionError(
    () => createTodoCollectionSnapshot([{
      intake: first.intake,
      state: { ...claimed, revision: 3 },
    }]),
    "item-lineage",
  );
});
