import { equal } from "node:assert/strict";
import { test } from "node:test";

import { createTodoCollectionSnapshot } from "../../../src/governance/todo/todo-collection.js";
import {
  computeTodoIntakeDigest,
  createTodoIntake,
} from "../../../src/governance/todo/todo-intake.js";
import {
  claimTodoState,
  computeTodoStateDigest,
  createInitialTodoState,
} from "../../../src/governance/todo/todo-state.js";
import {
  computeTodoTransactionDigest,
  parseTodoTransaction,
  parseTodoTransactionDocument,
  renderTodoTransaction,
  TodoTransactionError,
  type TodoTransactionErrorReason,
} from "../../../src/governance/todo/todo-transaction.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";

const CREATED_AT = parseUtcInstant("2026-08-26T09:00:00.000Z");
const CLAIMED_AT = parseUtcInstant("2026-08-26T09:01:00.000Z");
const DEMAND_ID = "demand_33333333-3333-4333-8333-333333333333";

function item() {
  const intake = createTodoIntake({
    todoId: "TODO-RH1-TRANSACTION",
    initialStatus: "pending-claim",
    type: "requirement",
    priority: "P1",
    ownerWindowId: "window_11111111-1111-4111-8111-111111111111",
    goal: "Implement immutable TODO transaction",
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
      ref: "ledger/requirements/TODO-RH1-TRANSACTION/record.json",
      anchor: null,
    }],
  }, { clock: () => CREATED_AT });
  return { intake, state: createInitialTodoState(intake) };
}

function appendTransaction() {
  const target = item();
  const before = createTodoCollectionSnapshot([]);
  const after = createTodoCollectionSnapshot([target]);
  return {
    artifactKind: "wakeflow-todo-transaction",
    schemaVersion: 1,
    todoId: target.intake.todoId,
    operation: "append",
    createdAt: CREATED_AT,
    expectedCollectionDigest: before.collectionDigest,
    expectedIntakeDigest: null,
    expectedStateDigest: null,
    targetIntake: target.intake,
    targetState: target.state,
    targetIntakeDigest: computeTodoIntakeDigest(target.intake),
    targetStateDigest: computeTodoStateDigest(target.state),
    targetCollectionDigest: after.collectionDigest,
  };
}

function expectTransactionError(
  action: () => unknown,
  reason: TodoTransactionErrorReason,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof TodoTransactionError)) {
    throw new Error("Expected TodoTransactionError.");
  }
  equal(caught.reason, reason);
}

test("append journal binds empty collection to complete target item", () => {
  const transaction = parseTodoTransaction(appendTransaction());
  equal(transaction.operation, "append");
  equal(transaction.expectedIntakeDigest, null);
  equal(transaction.expectedStateDigest, null);
  equal(transaction.targetState.revision, 1);
  equal(Object.isFrozen(transaction), true);
  equal(
    parseTodoTransactionDocument(renderTodoTransaction(transaction)).todoId,
    transaction.todoId,
  );
  equal(computeTodoTransactionDigest(transaction).startsWith("sha256:"), true);
});

test("claim journal binds exact current state to claimed target state", () => {
  const source = item();
  const before = createTodoCollectionSnapshot([source]);
  const claimed = claimTodoState(source.state, {
    demandId: DEMAND_ID,
    stateRootRef: `.wakeflow-active/current/${DEMAND_ID}`,
    identityDigest: `sha256:${"a".repeat(64)}`,
  }, { clock: () => CLAIMED_AT });
  const after = createTodoCollectionSnapshot([{
    intake: source.intake,
    state: claimed,
  }]);
  const transaction = parseTodoTransaction({
    artifactKind: "wakeflow-todo-transaction",
    schemaVersion: 1,
    todoId: source.intake.todoId,
    operation: "claim",
    createdAt: CLAIMED_AT,
    expectedCollectionDigest: before.collectionDigest,
    expectedIntakeDigest: computeTodoIntakeDigest(source.intake),
    expectedStateDigest: computeTodoStateDigest(source.state),
    targetIntake: null,
    targetState: claimed,
    targetIntakeDigest: computeTodoIntakeDigest(source.intake),
    targetStateDigest: computeTodoStateDigest(claimed),
    targetCollectionDigest: after.collectionDigest,
  });
  equal(transaction.targetState.previousStateDigest, transaction.expectedStateDigest);
  equal(transaction.targetState.status, "claimed");
});

test("operation-specific nullability, status, target digest and time are enforced", () => {
  const append = appendTransaction();
  expectTransactionError(
    () => parseTodoTransaction({
      ...append,
      expectedStateDigest: `sha256:${"a".repeat(64)}`,
    }),
    "operation",
  );
  expectTransactionError(
    () => parseTodoTransaction({
      ...append,
      targetStateDigest: `sha256:${"b".repeat(64)}`,
    }),
    "target",
  );
  expectTransactionError(
    () => parseTodoTransaction({
      ...append,
      createdAt: CLAIMED_AT,
    }),
    "target",
  );
});

test("transaction document field order is exact", () => {
  const transaction = parseTodoTransaction(appendTransaction());
  const reordered = Object.fromEntries(Object.entries(transaction).reverse());
  equal(computeTodoTransactionDigest(reordered), computeTodoTransactionDigest(transaction));
  expectTransactionError(
    () => parseTodoTransactionDocument(`${JSON.stringify(reordered, null, 2)}\n`),
    "representation",
  );
});
