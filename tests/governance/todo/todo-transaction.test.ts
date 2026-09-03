import { equal } from "node:assert/strict";
import { test } from "node:test";

import { createTodoCollectionSnapshot } from "../../../src/governance/todo/todo-collection.js";
import {
  computeTodoIntakeDigest,
  createTodoIntake,
} from "../../../src/governance/todo/todo-intake.js";
import {
  activateTodoState,
  claimTodoState,
  computeTodoStateDigest,
  createInitialTodoState,
  withdrawTodoState,
} from "../../../src/governance/todo/todo-state.js";
import {
  computeTodoTransactionDigest,
  parseTodoTransaction,
  parseTodoTransactionDocument,
  renderTodoTransaction,
  TodoTransactionError,
  type TodoTransactionErrorReason,
  type TodoTransactionOperation,
} from "../../../src/governance/todo/todo-transaction.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { todoIntakeDraft } from "./todo-intake.fixture.js";

const CREATED_AT = parseUtcInstant("2026-08-26T09:00:00.000Z");
const ACTIVATED_AT = parseUtcInstant("2026-08-26T09:00:30.000Z");
const WITHDRAWN_AT = parseUtcInstant("2026-08-26T09:00:45.000Z");
const CLAIMED_AT = parseUtcInstant("2026-08-26T09:01:00.000Z");
const DEMAND_ID = "demand_33333333-3333-4333-8333-333333333333";

function item(overrides: Readonly<Record<string, unknown>> = {}) {
  const intake = createTodoIntake(todoIntakeDraft(
    "todo_5423e75a-d441-4eee-89b3-49c680faa45d",
    { summary: "Implement immutable TODO transaction", ...overrides },
  ), { clock: () => CREATED_AT });
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

function stateTransaction(
  operation: Exclude<TodoTransactionOperation, "append">,
  source: ReturnType<typeof item>,
  targetState: ReturnType<typeof claimTodoState>,
) {
  const before = createTodoCollectionSnapshot([source]);
  const after = createTodoCollectionSnapshot([{
    intake: source.intake,
    state: targetState,
  }]);
  return {
    artifactKind: "wakeflow-todo-transaction",
    schemaVersion: 1,
    todoId: source.intake.todoId,
    operation,
    createdAt: targetState.updatedAt,
    expectedCollectionDigest: before.collectionDigest,
    expectedIntakeDigest: computeTodoIntakeDigest(source.intake),
    expectedStateDigest: computeTodoStateDigest(source.state),
    targetIntake: null,
    targetState,
    targetIntakeDigest: computeTodoIntakeDigest(source.intake),
    targetStateDigest: computeTodoStateDigest(targetState),
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
  const claimed = claimTodoState(source.state, {
    demandId: DEMAND_ID,
    stateRootRef: `.wakeflow-active/current/${DEMAND_ID}`,
    identityDigest: `sha256:${"a".repeat(64)}`,
  }, { clock: () => CLAIMED_AT });
  const transaction = parseTodoTransaction(
    stateTransaction("claim", source, claimed),
  );
  equal(transaction.targetState.previousStateDigest, transaction.expectedStateDigest);
  equal(transaction.targetState.status, "claimed");
});

test("activate and withdraw journals share the exact state mutation envelope", () => {
  const parked = item({
    readiness: {
      status: "parked",
      trigger: "Wait for the confirmed upstream decision.",
    },
    autoClaim: false,
  });
  const activated = activateTodoState(parked.state, {
    clock: () => ACTIVATED_AT,
  });
  const activation = parseTodoTransaction(
    stateTransaction("activate", parked, activated),
  );
  equal(activation.targetState.status, "pending-claim");
  equal(activation.targetState.previousStateDigest, activation.expectedStateDigest);
  equal(activation.targetIntake, null);

  const pending = item();
  const withdrawn = withdrawTodoState(pending.state, {
    reason: "The confirmed work is no longer planned.",
  }, { clock: () => WITHDRAWN_AT });
  const withdrawal = parseTodoTransaction(
    stateTransaction("withdraw", pending, withdrawn),
  );
  equal(withdrawal.targetState.status, "withdrawn");
  equal(withdrawal.targetState.withdrawal?.withdrawnAt, WITHDRAWN_AT);
  equal(withdrawal.targetState.previousStateDigest, withdrawal.expectedStateDigest);
  equal(withdrawal.targetIntake, null);
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
  expectTransactionError(
    () => parseTodoTransaction({
      ...append,
      targetIntake: {
        ...append.targetIntake,
        demandType: "research",
      },
    }),
    "target",
  );
  expectTransactionError(
    () => parseTodoTransaction({
      ...append,
      targetState: {
        ...append.targetState,
        revision: 2,
        previousStateDigest: null,
      },
    }),
    "target",
  );

  const source = item();
  const claimed = claimTodoState(source.state, {
    demandId: DEMAND_ID,
    stateRootRef: `.wakeflow-active/current/${DEMAND_ID}`,
    identityDigest: `sha256:${"a".repeat(64)}`,
  }, { clock: () => CLAIMED_AT });
  expectTransactionError(
    () => parseTodoTransaction({
      ...stateTransaction("claim", source, claimed),
      operation: "activate",
    }),
    "operation",
  );
  const withdrawn = withdrawTodoState(source.state, {
    reason: "The confirmed work is no longer planned.",
  }, { clock: () => WITHDRAWN_AT });
  expectTransactionError(
    () => parseTodoTransaction({
      ...stateTransaction("withdraw", source, withdrawn),
      operation: "archive",
    }),
    "operation",
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
