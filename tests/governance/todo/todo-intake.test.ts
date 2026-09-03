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
import {
  TODO_CONTROLLER_WINDOW_ID,
  TODO_ORIGIN_WINDOW_ID,
  TODO_PROGRAM_ID,
  todoAuthorityRefs,
  todoIntakeDraft,
} from "./todo-intake.fixture.js";

const CREATED_AT = parseUtcInstant("2026-08-26T09:00:00.000Z");
const TODO_ID = "todo_ab1be840-8133-4c97-8eaa-6741625cf4ac";

function draft(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return todoIntakeDraft(TODO_ID, overrides);
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

test("draft creation freezes scheduling metadata and immutable Ledger authority", () => {
  const intake = createTodoIntake(draft(), { clock: () => CREATED_AT });
  equal(intake.artifactKind, "wakeflow-todo-intake");
  equal(intake.schemaVersion, 1);
  equal(intake.programId, TODO_PROGRAM_ID);
  equal(intake.todoId, TODO_ID);
  equal(intake.createdAt, CREATED_AT);
  equal(intake.originWindowId, TODO_ORIGIN_WINDOW_ID);
  equal(intake.controllerWindowId, TODO_CONTROLLER_WINDOW_ID);
  equal(intake.demandType, "requirement");
  equal(intake.readiness.status, "ready");
  equal(intake.authorityRefs.length, 6);
  equal(Object.isFrozen(intake), true);
  equal(Object.isFrozen(intake.readiness), true);
  equal(Object.isFrozen(intake.testingDecision), true);
  equal(Object.isFrozen(intake.authorityRefs), true);
  equal(Object.isFrozen(intake.authorityRefs[0]), true);

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

test("Demand type closes required roles and testing environment relation", () => {
  const research = createTodoIntake(draft({
    demandType: "research",
  }), { clock: () => CREATED_AT });
  equal(research.testingDecision.mode, "not-applicable");

  expectIntakeError(
    () => createTodoIntake(draft({
      demandType: "research",
      testingDecision: {
        mode: "controller-only",
        summary: "Invalid research execution decision",
        environmentMemberRef: null,
      },
    }), { clock: () => CREATED_AT }),
    "testing-decision",
  );

  const realEnvironment = createTodoIntake(draft({
    testingDecision: {
      mode: "real-environment",
      summary: "Use the confirmed Test environment",
    },
  }), { clock: () => CREATED_AT });
  equal(realEnvironment.testingDecision.mode, "real-environment");
  equal(
    realEnvironment.authorityRefs.some((reference) =>
      reference.memberRef
        === realEnvironment.testingDecision.environmentMemberRef),
    true,
  );

  expectIntakeError(
    () => createTodoIntake(draft({
      testingDecision: {
        mode: "real-environment",
        summary: "Missing exact environment relation",
        environmentMemberRef: null,
      },
      authorityRefs: todoAuthorityRefs("requirement", "real-environment"),
    }), { clock: () => CREATED_AT }),
    "testing-decision",
  );
});

test("authority references are complete, unique, and canonically ordered", () => {
  const refs = todoAuthorityRefs();
  const normalized = createTodoIntake(draft({
    authorityRefs: [...refs].reverse(),
  }), { clock: () => CREATED_AT });
  deepEqual(normalized.authorityRefs, refs);
  expectIntakeError(
    () => createTodoIntake(draft({ authorityRefs: refs.slice(1) }), {
      clock: () => CREATED_AT,
    }),
    "authority",
  );
  expectIntakeError(
    () => parseTodoIntake({
      ...createTodoIntake(draft(), { clock: () => CREATED_AT }),
      authorityRefs: [...refs].reverse(),
    }),
    "authority",
  );
  expectIntakeError(
    () => createTodoIntake(draft({
      authorityRefs: [refs[0], refs[0], ...refs.slice(1)],
    }), { clock: () => CREATED_AT }),
    "authority",
  );
});

test("parked readiness requires a trigger and disables Auto Claim", () => {
  const parked = createTodoIntake(draft({
    readiness: {
      status: "parked",
      trigger: "Wait for the confirmed upstream decision.",
    },
    autoClaim: false,
  }), { clock: () => CREATED_AT });
  equal(parked.readiness.status, "parked");

  expectIntakeError(
    () => createTodoIntake(draft({
      readiness: {
        status: "parked",
        trigger: "Wait for the confirmed upstream decision.",
      },
      autoClaim: true,
    }), { clock: () => CREATED_AT }),
    "readiness",
  );
  expectIntakeError(
    () => createTodoIntake(draft({
      readiness: { status: "parked" },
      autoClaim: false,
    }), { clock: () => CREATED_AT }),
    "schema",
  );
});

test("typed IDs, canonical text, Schema shape, and draft shape fail distinctly", () => {
  expectIntakeError(
    () => createTodoIntake(draft({ originWindowId: "repository_bad" }), {
      clock: () => CREATED_AT,
    }),
    "schema",
  );
  expectIntakeError(
    () => createTodoIntake(draft({ summary: "cafe\u0301" }), {
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
      return TODO_ID;
    },
  });
  expectIntakeError(
    () => createTodoIntake(value, { clock: () => CREATED_AT }),
    "input",
  );
  equal(getterCalls, 0);
});

test("draft semantics are closed before the wall clock is observed", () => {
  let clockCalls = 0;
  expectIntakeError(
    () => createTodoIntake(draft({ summary: "cafe\u0301" }), {
      clock: () => {
        clockCalls += 1;
        return CREATED_AT;
      },
    }),
    "text",
  );
  equal(clockCalls, 0);
  expectIntakeError(
    () => createTodoIntake(draft(), {
      clock: () => {
        throw new Error("private clock failure");
      },
    }),
    "time",
  );
});
