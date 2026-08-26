import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  computeTodoIntakeDigest,
  createTodoIntake,
  type TodoIntake,
} from "../../../src/governance/todo/todo-intake.js";
import {
  archiveTodoState,
  claimTodoState,
  computeTodoStateDigest,
  createInitialTodoState,
  parseTodoDemandMount,
  parseTodoState,
  parseTodoStateDocument,
  renderTodoState,
  TodoStateError,
  type TodoStateErrorReason,
} from "../../../src/governance/todo/todo-state.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";

const CREATED_AT = parseUtcInstant("2026-08-26T09:00:00.000Z");
const CLAIMED_AT = parseUtcInstant("2026-08-26T09:01:00.000Z");
const ARCHIVED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const DEMAND_ID = "demand_33333333-3333-4333-8333-333333333333";

function intake() {
  return createTodoIntake({
    todoId: "TODO-RH1-STATE",
    initialStatus: "pending-claim",
    type: "requirement",
    priority: "P1",
    ownerWindowId: "window_11111111-1111-4111-8111-111111111111",
    goal: "Implement TODO state",
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
      ref: "ledger/requirements/TODO-RH1-STATE/record.json",
      anchor: null,
    }],
  }, { clock: () => CREATED_AT });
}

function mount() {
  return {
    demandId: DEMAND_ID,
    stateRootRef: `.wakeflow-active/current/${DEMAND_ID}`,
    identityDigest: `sha256:${"a".repeat(64)}`,
  };
}

function archiveReceipt(
  source: Readonly<TodoIntake>,
  claimedStateDigest: string,
) {
  return {
    artifactKind: "wakeflow-business-archive-receipt",
    schemaVersion: 1,
    archiveId: "archive_44444444-4444-4444-8444-444444444444",
    demandId: DEMAND_ID,
    todoId: source.todoId,
    intakeDigest: computeTodoIntakeDigest(source),
    claimedStateDigest,
    manifestDigest: `sha256:${"b".repeat(64)}`,
  };
}

function expectStateError(
  action: () => unknown,
  reason: TodoStateErrorReason,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof TodoStateError)) {
    throw new Error("Expected TodoStateError.");
  }
  equal(caught.code, "wakeflow-todo-state");
  equal(caught.reason, reason);
}

test("initial state derives immutable identity and time from intake", () => {
  const initial = createInitialTodoState(intake());
  equal(initial.todoId, "TODO-RH1-STATE");
  equal(initial.revision, 1);
  equal(initial.previousStateDigest, null);
  equal(initial.status, "pending-claim");
  equal(initial.updatedAt, CREATED_AT);
  equal(initial.mount, null);
  equal(Object.isFrozen(initial), true);
  deepEqual(parseTodoStateDocument(renderTodoState(initial)), initial);
});

test("claim creates revision 2 bound to exact previous state and demand mount", () => {
  const initial = createInitialTodoState(intake());
  const claimed = claimTodoState(initial, mount(), { clock: () => CLAIMED_AT });
  equal(claimed.revision, 2);
  equal(claimed.previousStateDigest, computeTodoStateDigest(initial));
  equal(claimed.status, "claimed");
  equal(claimed.mount?.demandId, DEMAND_ID);
  equal(claimed.updatedAt, CLAIMED_AT);
  equal(claimed.archive, null);
});

test("archive creates an auditable terminal state instead of deleting the item", () => {
  const source = intake();
  const claimed = claimTodoState(
    createInitialTodoState(source),
    mount(),
    { clock: () => CLAIMED_AT },
  );
  const archived = archiveTodoState(
    claimed,
    archiveReceipt(source, computeTodoStateDigest(claimed)),
    { clock: () => ARCHIVED_AT },
  );

  equal(archived.status, "archived");
  equal(archived.revision, 3);
  equal(archived.previousStateDigest, computeTodoStateDigest(claimed));
  equal(archived.archive?.todoId, source.todoId);
  equal(archived.archive?.intakeDigest, computeTodoIntakeDigest(source));
  equal(archived.archive?.claimedStateDigest, computeTodoStateDigest(claimed));
  equal(archived.archive?.archivedAt, ARCHIVED_AT);
  equal(archived.updatedAt, ARCHIVED_AT);
});

test("revision, mount, archive and transition relationships fail closed", () => {
  const initial = createInitialTodoState(intake());
  expectStateError(
    () => parseTodoState({
      ...initial,
      previousStateDigest: `sha256:${"a".repeat(64)}`,
    }),
    "revision",
  );
  expectStateError(
    () => parseTodoDemandMount({
      ...mount(),
      stateRootRef: ".wakeflow-active/current/other",
    }),
    "mount",
  );
  expectStateError(
    () => claimTodoState(
      { ...initial, status: "parked" },
      mount(),
      { clock: () => CLAIMED_AT },
    ),
    "status",
  );
  const claimed = claimTodoState(initial, mount(), { clock: () => CLAIMED_AT });
  expectStateError(
    () => archiveTodoState(claimed, {
      ...archiveReceipt(intake(), computeTodoStateDigest(claimed)),
      demandId: "demand_55555555-5555-4555-8555-555555555555",
    }, { clock: () => ARCHIVED_AT }),
    "archive",
  );
});

test("state field order is part of deterministic disk representation only", () => {
  const state = createInitialTodoState(intake());
  const reordered = Object.fromEntries(Object.entries(state).reverse());
  equal(computeTodoStateDigest(reordered), computeTodoStateDigest(state));
  expectStateError(
    () => parseTodoStateDocument(`${JSON.stringify(reordered, null, 2)}\n`),
    "representation",
  );
});

test("mount and archive inputs are passive closed records", () => {
  const hostile = { ...mount() };
  let getterCalls = 0;
  Object.defineProperty(hostile, "demandId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return DEMAND_ID;
    },
  });
  expectStateError(() => parseTodoDemandMount(hostile), "input");
  equal(getterCalls, 0);

  const source = intake();
  const claimed = claimTodoState(
    createInitialTodoState(source),
    mount(),
    { clock: () => CLAIMED_AT },
  );
  const hostileReceipt = archiveReceipt(
    source,
    computeTodoStateDigest(claimed),
  );
  Object.defineProperty(hostileReceipt, "archiveId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "archive_44444444-4444-4444-8444-444444444444";
    },
  });
  expectStateError(
    () => archiveTodoState(claimed, hostileReceipt),
    "input",
  );
  equal(getterCalls, 0);
});
