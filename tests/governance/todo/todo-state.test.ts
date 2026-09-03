import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  computeTodoIntakeDigest,
  createTodoIntake,
  type TodoIntake,
} from "../../../src/governance/todo/todo-intake.js";
import {
  activateTodoState,
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
  withdrawTodoState,
} from "../../../src/governance/todo/todo-state.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { todoIntakeDraft } from "./todo-intake.fixture.js";

const CREATED_AT = parseUtcInstant("2026-08-26T09:00:00.000Z");
const ACTIVATED_AT = parseUtcInstant("2026-08-26T09:00:30.000Z");
const WITHDRAWN_AT = parseUtcInstant("2026-08-26T09:00:45.000Z");
const CLAIMED_AT = parseUtcInstant("2026-08-26T09:01:00.000Z");
const ARCHIVED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const DEMAND_ID = "demand_33333333-3333-4333-8333-333333333333";

function intake(overrides: Readonly<Record<string, unknown>> = {}) {
  return createTodoIntake(todoIntakeDraft(
    "todo_421eb197-9226-4513-8e41-0ff6dbed78ab",
    { summary: "Implement TODO state", ...overrides },
  ), { clock: () => CREATED_AT });
}

function parkedIntake() {
  return intake({
    readiness: {
      status: "parked",
      trigger: "Wait for the confirmed upstream decision.",
    },
    autoClaim: false,
  });
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
  equal(initial.todoId, "todo_421eb197-9226-4513-8e41-0ff6dbed78ab");
  equal(initial.revision, 1);
  equal(initial.previousStateDigest, null);
  equal(initial.status, "pending-claim");
  equal(initial.updatedAt, CREATED_AT);
  equal(initial.mount, null);
  equal(initial.withdrawal, null);
  equal(Object.isFrozen(initial), true);
  deepEqual(parseTodoStateDocument(renderTodoState(initial)), initial);
});

test("parked intake activates through one exact forward revision", () => {
  const parked = createInitialTodoState(parkedIntake());
  equal(parked.status, "parked");
  const activated = activateTodoState(parked, {
    clock: () => ACTIVATED_AT,
  });

  equal(activated.status, "pending-claim");
  equal(activated.revision, 2);
  equal(activated.previousStateDigest, computeTodoStateDigest(parked));
  equal(activated.updatedAt, ACTIVATED_AT);
  equal(activated.mount, null);
  equal(activated.withdrawal, null);
  equal(activated.archive, null);
});

test("pending and parked items withdraw into an auditable terminal state", () => {
  for (const current of [
    createInitialTodoState(intake()),
    createInitialTodoState(parkedIntake()),
  ]) {
    const withdrawn = withdrawTodoState(current, {
      reason: "The confirmed work is no longer planned.",
    }, { clock: () => WITHDRAWN_AT });
    equal(withdrawn.status, "withdrawn");
    equal(withdrawn.revision, 2);
    equal(withdrawn.previousStateDigest, computeTodoStateDigest(current));
    equal(withdrawn.updatedAt, WITHDRAWN_AT);
    equal(
      withdrawn.withdrawal?.reason,
      "The confirmed work is no longer planned.",
    );
    equal(withdrawn.withdrawal?.withdrawnAt, WITHDRAWN_AT);
    equal(Object.isFrozen(withdrawn.withdrawal), true);
    deepEqual(parseTodoStateDocument(renderTodoState(withdrawn)), withdrawn);
  }
});

test("claim creates revision 2 bound to exact previous state and demand mount", () => {
  const initial = createInitialTodoState(intake());
  const claimed = claimTodoState(initial, mount(), { clock: () => CLAIMED_AT });
  equal(claimed.revision, 2);
  equal(claimed.previousStateDigest, computeTodoStateDigest(initial));
  equal(claimed.status, "claimed");
  equal(claimed.mount?.demandId, DEMAND_ID);
  equal(claimed.updatedAt, CLAIMED_AT);
  equal(claimed.withdrawal, null);
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
  equal(archived.withdrawal, null);
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
  const withdrawn = withdrawTodoState(initial, {
    reason: "The confirmed work is no longer planned.",
  }, { clock: () => WITHDRAWN_AT });
  expectStateError(
    () => claimTodoState(withdrawn, mount(), { clock: () => CLAIMED_AT }),
    "status",
  );
  expectStateError(
    () => activateTodoState(withdrawn, { clock: () => ACTIVATED_AT }),
    "status",
  );
  expectStateError(
    () => archiveTodoState(
      withdrawn,
      archiveReceipt(intake(), computeTodoStateDigest(withdrawn)),
      { clock: () => ARCHIVED_AT },
    ),
    "status",
  );
  expectStateError(
    () => withdrawTodoState(claimed, {
      reason: "Cannot withdraw a claimed item.",
    }, { clock: () => WITHDRAWN_AT }),
    "status",
  );
  expectStateError(
    () => archiveTodoState(claimed, {
      ...archiveReceipt(intake(), computeTodoStateDigest(claimed)),
      demandId: "demand_55555555-5555-4555-8555-555555555555",
    }, { clock: () => ARCHIVED_AT }),
    "archive",
  );
});

test("withdrawal payload and status relationships fail closed", () => {
  const initial = createInitialTodoState(intake());
  const withdrawn = withdrawTodoState(initial, {
    reason: "The confirmed work is no longer planned.",
  }, { clock: () => WITHDRAWN_AT });
  expectStateError(
    () => parseTodoState({ ...withdrawn, status: "pending-claim" }),
    "status",
  );
  expectStateError(
    () => parseTodoState({ ...withdrawn, withdrawal: null }),
    "withdrawal",
  );
  expectStateError(
    () => parseTodoState({ ...withdrawn, updatedAt: CLAIMED_AT }),
    "withdrawal",
  );
  expectStateError(
    () => parseTodoState({
      ...withdrawn,
      withdrawal: {
        ...withdrawn.withdrawal,
        reason: "cafe\u0301",
      },
    }),
    "withdrawal",
  );
  expectStateError(
    () => parseTodoState({
      ...withdrawn,
      revision: 1,
      previousStateDigest: null,
    }),
    "revision",
  );
});

test("state v1 rejects lifecycle statuses owned by Demand or Task", () => {
  const initial = createInitialTodoState(intake());
  for (const status of [
    "blocked",
    "observing",
    "completed",
    "cancelled",
  ] as const) {
    expectStateError(
      () => parseTodoState({ ...initial, status }),
      "schema",
    );
  }
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

test("mount, withdrawal, and archive inputs are passive closed records", () => {
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

  const hostileWithdrawal = { reason: "Never read this getter." };
  Object.defineProperty(hostileWithdrawal, "reason", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "Never read this getter.";
    },
  });
  expectStateError(
    () => withdrawTodoState(
      createInitialTodoState(intake()),
      hostileWithdrawal,
    ),
    "input",
  );
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

test("state transitions close authorization and revision before reading time", () => {
  const source = intake();
  const initial = createInitialTodoState(source);
  const claimed = claimTodoState(initial, mount(), { clock: () => CLAIMED_AT });
  let clockCalls = 0;
  expectStateError(
    () => activateTodoState(initial, {
      clock: () => {
        clockCalls += 1;
        return ACTIVATED_AT;
      },
    }),
    "status",
  );
  equal(clockCalls, 0);
  expectStateError(
    () => archiveTodoState(
      claimed,
      archiveReceipt(source, `sha256:${"c".repeat(64)}`),
      {
        clock: () => {
          clockCalls += 1;
          return ARCHIVED_AT;
        },
      },
    ),
    "archive",
  );
  equal(clockCalls, 0);
  expectStateError(
    () => withdrawTodoState(initial, { reason: "cafe\u0301" }, {
      clock: () => {
        clockCalls += 1;
        return WITHDRAWN_AT;
      },
    }),
    "withdrawal",
  );
  equal(clockCalls, 0);

  const maximumRevision = parseTodoState({
    ...initial,
    revision: Number.MAX_SAFE_INTEGER,
    previousStateDigest: `sha256:${"d".repeat(64)}`,
  });
  expectStateError(
    () => claimTodoState(maximumRevision, mount(), {
      clock: () => {
        clockCalls += 1;
        return CLAIMED_AT;
      },
    }),
    "revision",
  );
  equal(clockCalls, 0);
  expectStateError(
    () => claimTodoState(initial, mount(), {
      clock: () => {
        throw new Error("private clock failure");
      },
    }),
    "time",
  );
});
