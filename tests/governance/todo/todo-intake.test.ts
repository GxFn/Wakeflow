import { deepEqual, equal, notEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  computeTodoIntakeDigest,
  createTodoIntake,
  parseTodoIntake,
  parseTodoIntakeDocument,
  renderTodoIntake,
  TodoIntakeError,
  type TodoIntakeErrorReason,
} from "../../../src/governance/todo/todo-intake.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";

const CREATED_AT = parseUtcInstant("2026-08-26T09:00:00.000Z");

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    todoId: "TODO-RH1-001",
    initialStatus: "pending-claim",
    type: "requirement",
    priority: "P1",
    ownerWindowId: "window_11111111-1111-4111-8111-111111111111",
    goal: "Implement normalized TODO intake",
    affectsRetestOrDispatch: false,
    dependency: null,
    recommendedWindowId: "window_22222222-2222-4222-8222-222222222222",
    autoClaim: true,
    testingDecision: {
      mode: "controller-only",
      summary: "Focused target tests",
    },
    documents: [
      {
        label: "original-plan",
        ref: "ledger/requirements/TODO-RH1-001/requirement.json",
        anchor: null,
      },
    ],
    ...overrides,
  };
}

function expectIntakeError(
  action: () => unknown,
  reason: TodoIntakeErrorReason,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof TodoIntakeError)) {
    throw new Error("Expected TodoIntakeError.");
  }
  equal(caught.code, "wakeflow-todo-intake");
  equal(caught.reason, reason);
}

test("draft creation produces a frozen immutable intake and deterministic document", () => {
  const intake = createTodoIntake(draft(), { clock: () => CREATED_AT });
  equal(intake.artifactKind, "wakeflow-todo-intake");
  equal(intake.schemaVersion, 1);
  equal(intake.createdAt, CREATED_AT);
  equal(intake.todoId, "TODO-RH1-001");
  equal(Object.isFrozen(intake), true);
  equal(Object.isFrozen(intake.testingDecision), true);
  equal(Object.isFrozen(intake.documents), true);
  equal(Object.isFrozen(intake.documents[0]), true);

  const text = renderTodoIntake(intake);
  equal(text.startsWith('{\n  "artifactKind": "wakeflow-todo-intake",'), true);
  deepEqual(parseTodoIntakeDocument(text), intake);
});

test("semantic digest is stable while domain representation order is exact", () => {
  const intake = createTodoIntake(draft(), { clock: () => CREATED_AT });
  const reordered = Object.fromEntries(Object.entries(intake).reverse());
  equal(computeTodoIntakeDigest(reordered), computeTodoIntakeDigest(intake));

  const reorderedText = `${JSON.stringify(reordered, null, 2)}\n`;
  expectIntakeError(
    () => parseTodoIntakeDocument(reorderedText),
    "representation",
  );
  notEqual(reorderedText, renderTodoIntake(intake));
});

test("testing mode is tied to TODO type", () => {
  expectIntakeError(
    () => createTodoIntake(draft({
      type: "research",
      testingDecision: {
        mode: "controller-only",
        summary: "Inspect only",
      },
    }), { clock: () => CREATED_AT }),
    "testing-decision",
  );
  equal(
    createTodoIntake(draft({
      type: "research",
      testingDecision: {
        mode: "not-applicable",
        summary: "Research has no execution target",
      },
    }), { clock: () => CREATED_AT }).type,
    "research",
  );
});

test("document labels and targets are unique portable structured refs", () => {
  const duplicate = {
    label: "original-plan",
    ref: "ledger/requirements/TODO-RH1-001/requirement.json",
    anchor: null,
  };
  expectIntakeError(
    () => createTodoIntake(draft({ documents: [duplicate, duplicate] }), {
      clock: () => CREATED_AT,
    }),
    "documents",
  );
  expectIntakeError(
    () => createTodoIntake(draft({ documents: [{
      label: "plan",
      ref: "../outside.json",
      anchor: null,
    }] }), { clock: () => CREATED_AT }),
    "schema",
  );
});

test("typed IDs, Unicode, schema shape, and draft shape fail distinctly", () => {
  expectIntakeError(
    () => createTodoIntake(draft({ ownerWindowId: "repository_bad" }), {
      clock: () => CREATED_AT,
    }),
    "schema",
  );
  expectIntakeError(
    () => createTodoIntake(draft({ goal: "cafe\u0301" }), {
      clock: () => CREATED_AT,
    }),
    "text",
  );
  expectIntakeError(
    () => parseTodoIntake({
      ...createTodoIntake(draft(), { clock: () => CREATED_AT }),
      unknown: true,
    }),
    "schema",
  );
  expectIntakeError(
    () => createTodoIntake({ ...draft(), unknown: true }, {
      clock: () => CREATED_AT,
    }),
    "input",
  );
});

test("draft admission is passive and never executes accessors", () => {
  const value = draft();
  let getterCalls = 0;
  Object.defineProperty(value, "todoId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "TODO-never";
    },
  });
  expectIntakeError(
    () => createTodoIntake(value, { clock: () => CREATED_AT }),
    "input",
  );
  equal(getterCalls, 0);
});
