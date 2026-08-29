import { equal, notEqual } from "node:assert/strict";
import { test } from "node:test";

import { renderTodoBoardProjection } from "../../../src/governance/todo/todo-board-projection.js";
import {
  createTodoCollectionSnapshot,
  TodoCollectionError,
  type TodoCollectionErrorReason,
} from "../../../src/governance/todo/todo-collection.js";
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
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";

const BASE_TIME = parseUtcInstant("2026-08-26T09:00:00.000Z");
const LATER_TIME = parseUtcInstant("2026-08-26T09:00:01.000Z");
const DEMAND_ID = "demand_33333333-3333-4333-8333-333333333333";

function item(
  todoId: string,
  createdAt = BASE_TIME,
  goal = `Implement ${todoId}`,
) {
  const intake = createTodoIntake({
    todoId,
    initialStatus: "pending-claim",
    type: "requirement",
    priority: "P1",
    ownerWindowId: "window_11111111-1111-4111-8111-111111111111",
    goal,
    affectsRetestOrDispatch: false,
    dependency: null,
    recommendedWindowId: "window_22222222-2222-4222-8222-222222222222",
    autoClaim: true,
    testingDecision: {
      mode: "controller-only",
      summary: "Focused target tests",
    },
    documents: [{
      label: "original-plan",
      ref: `ledger/requirements/${todoId}/record.json`,
      anchor: null,
    }],
  }, { clock: () => createdAt });
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
  const first = item("TODO-B", BASE_TIME);
  const second = item("TODO-A", BASE_TIME);
  const third = item("TODO-C", LATER_TIME);
  const left = createTodoCollectionSnapshot([third, first, second]);
  const right = createTodoCollectionSnapshot([second, third, first]);

  equal(left.items.map((entry) => entry.todoId).join(","), "TODO-A,TODO-B,TODO-C");
  equal(left.collectionDigest, right.collectionDigest);
  equal(left.itemCount, 3);
  equal(left.activeItemCount, 3);
  equal(Object.isFrozen(left.items), true);
});

test("projection exposes current rows and declares itself non-authoritative", () => {
  const pending = item("TODO-PENDING");
  const claimedBase = item("TODO-CLAIMED", LATER_TIME);
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
  equal(projection.content.includes("TODO-PENDING"), true);
  equal(projection.content.includes("TODO-CLAIMED"), true);
  equal(projection.content.includes(`.wakeflow-active/current/${DEMAND_ID}`), true);
  equal(projection.content.endsWith("\n"), true);
  equal(projection.content.endsWith("\n\n"), false);
});

test("projection escapes Markdown cells without defining a reverse input format", () => {
  const source = item(
    "TODO-PROJECTION-ESCAPE",
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

test("projection neutralizes HTML, bidi controls, and unsafe link destinations", () => {
  const source = item(
    "TODO-PROJECTION-SAFE",
    BASE_TIME,
    "<script>`move`\u202e",
  );
  const projected = {
    intake: {
      ...source.intake,
      documents: [{
        label: "original-plan",
        ref: "docs/plan).md",
        anchor: null,
      }],
    },
    state: source.state,
  };
  const content = renderTodoBoardProjection([projected]).content;
  equal(content.includes("<script>"), false);
  equal(content.includes("&lt;script&gt;&#96;move&#96;&#92;u202e"), true);
  equal(content.includes("[original-plan](docs/plan%29.md)"), true);
});

test("archived items remain in authority digest but disappear from projection", () => {
  const source = item("TODO-ARCHIVED");
  const claimed = claimTodoState(source.state, {
    demandId: DEMAND_ID,
    stateRootRef: `.wakeflow-active/current/${DEMAND_ID}`,
    identityDigest: `sha256:${"a".repeat(64)}`,
  }, { clock: () => LATER_TIME });
  const archived = archiveTodoState(claimed, {
    artifactKind: "wakeflow-business-archive-receipt",
    schemaVersion: 1,
    archiveId: "archive_44444444-4444-4444-8444-444444444444",
    demandId: DEMAND_ID,
    todoId: source.intake.todoId,
    intakeDigest: computeTodoIntakeDigest(source.intake),
    claimedStateDigest: computeTodoStateDigest(claimed),
    manifestDigest: `sha256:${"b".repeat(64)}`,
  }, { clock: () => parseUtcInstant("2026-08-26T10:00:00.000Z") });

  const active = createTodoCollectionSnapshot([{ intake: source.intake, state: claimed }]);
  const terminal = createTodoCollectionSnapshot([{ intake: source.intake, state: archived }]);
  equal(terminal.itemCount, 1);
  equal(terminal.activeItemCount, 0);
  notEqual(terminal.collectionDigest, active.collectionDigest);
  equal(renderTodoBoardProjection([{ intake: source.intake, state: archived }]).rowCount, 0);
});

test("duplicate IDs and intake/state mismatches fail before projection", () => {
  const first = item("TODO-DUPLICATE");
  expectCollectionError(
    () => createTodoCollectionSnapshot([first, first]),
    "duplicate",
  );
  const other = item("TODO-OTHER");
  expectCollectionError(
    () => createTodoCollectionSnapshot([{ intake: first.intake, state: other.state }]),
    "item-identity",
  );
});
