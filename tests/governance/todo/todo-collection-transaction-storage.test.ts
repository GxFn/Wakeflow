import { equal } from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { withRootedExclusiveFileLock } from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  TODO_PROJECTION_MAXIMUM_BYTES,
  type TodoCollectionAuthoritySnapshot,
} from "../../../src/governance/todo/todo-collection-authority.js";
import { renderTodoBoardProjection } from "../../../src/governance/todo/todo-board-projection.js";
import { createTodoCollectionSnapshot } from "../../../src/governance/todo/todo-collection.js";
import {
  appendTodoItem,
  initializeTodoCollection,
  inspectTodoItems,
  recoverTodoItemTransaction,
  TodoCollectionServiceError,
  type TodoCollectionServiceErrorReason,
} from "../../../src/governance/todo/todo-collection-service.js";
import { commitTodoCollectionTransaction } from "../../../src/governance/todo/todo-collection-transaction-storage.js";
import { createTodoIntake } from "../../../src/governance/todo/todo-intake.js";
import {
  activateTodoState,
  claimTodoState,
  computeTodoStateDigest,
  createInitialTodoState,
  parseTodoState,
  withdrawTodoState,
} from "../../../src/governance/todo/todo-state.js";
import {
  TODO_COLLECTION_LOCK_REF,
  todoItemStorageKey,
} from "../../../src/governance/todo/todo-paths.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { materializeWakeflowActiveLayout } from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";
import { todoIntakeDraft } from "./todo-intake.fixture.js";

const CREATED_AT = parseUtcInstant("2026-08-26T09:00:00.000Z");
const ACTIVATED_AT = parseUtcInstant("2026-08-26T09:00:30.000Z");
const WITHDRAWN_AT = parseUtcInstant("2026-08-26T09:00:45.000Z");
const CLAIMED_AT = parseUtcInstant("2026-08-26T09:01:00.000Z");
const MAXIMUM_SUMMARY = "😀".repeat(8192);
const DEMAND_ID = "demand_33333333-3333-4333-8333-333333333333";

function item(
  todoId: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const intake = createTodoIntake(todoIntakeDraft(todoId, overrides), {
    clock: () => CREATED_AT,
  });
  return { intake, state: createInitialTodoState(intake) };
}

function capacityItem(index: number) {
  const todoId = `todo_00000000-0000-4000-8000-${index
    .toString(16)
    .padStart(12, "0")}`;
  return item(todoId, {
    summary: MAXIMUM_SUMMARY,
    testingDecision: {
      mode: "controller-only",
      summary: "x",
      environmentMemberRef: null,
    },
  });
}

function logicalAuthority(
  items: readonly ReturnType<typeof item>[],
): Readonly<TodoCollectionAuthoritySnapshot> {
  const collection = createTodoCollectionSnapshot(items);
  return {
    collection,
    items: collection.items,
    projection: null,
  } as unknown as Readonly<TodoCollectionAuthoritySnapshot>;
}

async function openedFixture() {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-todo-storage-"));
  const root = await RootedDirectory.open(rootPath);
  await materializeWakeflowActiveLayout(root, {
    recoveringFreshLayout: false,
  });
  await initializeTodoCollection(root, { freshWorkspace: true });
  return { rootPath, root };
}

async function expectServiceError(
  action: () => unknown | Promise<unknown>,
  reason: TodoCollectionServiceErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof TodoCollectionServiceError)) {
    throw new Error("Expected TodoCollectionServiceError.");
  }
  equal(caught.reason, reason);
}

function transactionPath(rootPath: string, todoId: string): string {
  return path.join(
    rootPath,
    ".wakeflow-active/current/todo/transactions",
    `${todoItemStorageKey(todoId)}.json`,
  );
}

test("projection capacity rejects the first overflowing append before journal creation", async () => {
  const candidates = Array.from({ length: 249 }, (_, index) => capacityItem(index));
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

test("storage rejects invalid source status and revision before journal creation", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-todo-transition-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const pending = item("todo_c20072ea-7e06-4585-9fd6-16d70d29ecf1");
    const invalidActivation = parseTodoState({
      ...pending.state,
      revision: 2,
      previousStateDigest: computeTodoStateDigest(pending.state),
      updatedAt: ACTIVATED_AT,
    });
    await expectServiceError(
      () => commitTodoCollectionTransaction(
        root,
        "activate",
        logicalAuthority([pending]),
        pending.intake,
        pending.state,
        invalidActivation,
        undefined,
      ),
      "transition",
    );

    const parked = item("todo_902bc4f4-d393-45c4-b40f-0c56bd0373de", {
      readiness: {
        status: "parked",
        trigger: "Wait for the confirmed upstream decision.",
      },
      autoClaim: false,
    });
    const revisionLeap = parseTodoState({
      ...parked.state,
      revision: 3,
      previousStateDigest: computeTodoStateDigest(parked.state),
      status: "pending-claim",
      updatedAt: ACTIVATED_AT,
    });
    await expectServiceError(
      () => commitTodoCollectionTransaction(
        root,
        "activate",
        logicalAuthority([parked]),
        parked.intake,
        parked.state,
        revisionLeap,
        undefined,
      ),
      "transition",
    );

    const claimSource = item("todo_d28c1381-4f83-4fab-8b19-2af799cb3777");
    const claimedState = claimTodoState(claimSource.state, {
      demandId: DEMAND_ID,
      stateRootRef: `.wakeflow-active/current/${DEMAND_ID}`,
      identityDigest: `sha256:${"a".repeat(64)}`,
    }, { clock: () => CLAIMED_AT });
    const claimed = { intake: claimSource.intake, state: claimedState };
    const invalidWithdrawal = parseTodoState({
      ...claimedState,
      revision: claimedState.revision + 1,
      previousStateDigest: computeTodoStateDigest(claimedState),
      status: "withdrawn",
      updatedAt: WITHDRAWN_AT,
      mount: null,
      withdrawal: {
        reason: "A claimed item cannot be withdrawn.",
        withdrawnAt: WITHDRAWN_AT,
      },
      archive: null,
    });
    await expectServiceError(
      () => commitTodoCollectionTransaction(
        root,
        "withdraw",
        logicalAuthority([claimed]),
        claimed.intake,
        claimed.state,
        invalidWithdrawal,
        undefined,
      ),
      "transition",
    );
    equal(readdirSync(rootPath).length, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("storage durably applies activate and withdraw with one state replacement path", async () => {
  const { rootPath, root } = await openedFixture();
  try {
    const parked = await appendTodoItem(
      root,
      todoIntakeDraft("todo_e30e5e9f-9991-4a24-b704-19f52e8dad3a", {
        readiness: {
          status: "parked",
          trigger: "Wait for the confirmed upstream decision.",
        },
        autoClaim: false,
      }),
      { clock: () => CREATED_AT },
    );
    const activatedState = activateTodoState(parked.item.state, {
      clock: () => ACTIVATED_AT,
    });
    const activated = await withRootedExclusiveFileLock(
      root,
      TODO_COLLECTION_LOCK_REF,
      async () => commitTodoCollectionTransaction(
        root,
        "activate",
        await inspectTodoItems(root),
        parked.item.intake,
        parked.item.state,
        activatedState,
        undefined,
      ),
    );
    equal(activated.transaction.operation, "activate");
    equal(activated.snapshot.items[0]?.state.status, "pending-claim");
    equal(existsSync(transactionPath(rootPath, parked.item.todoId)), false);

    const pending = await appendTodoItem(
      root,
      todoIntakeDraft("todo_a89dc4db-aa63-4c78-9fb0-7937e28cd194"),
      { clock: () => CREATED_AT },
    );
    const withdrawnState = withdrawTodoState(pending.item.state, {
      reason: "The confirmed work is no longer planned.",
    }, { clock: () => WITHDRAWN_AT });
    const withdrawn = await withRootedExclusiveFileLock(
      root,
      TODO_COLLECTION_LOCK_REF,
      async () => commitTodoCollectionTransaction(
        root,
        "withdraw",
        await inspectTodoItems(root),
        pending.item.intake,
        pending.item.state,
        withdrawnState,
        undefined,
      ),
    );
    equal(withdrawn.transaction.operation, "withdraw");
    equal(withdrawn.snapshot.collection.itemCount, 2);
    equal(withdrawn.snapshot.collection.activeItemCount, 1);
    equal(
      withdrawn.snapshot.projection.expected.content.includes(
        pending.item.todoId,
      ),
      false,
    );
    equal(existsSync(transactionPath(rootPath, pending.item.todoId)), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("activate and withdraw recovery replay committed state before repairing projection", async () => {
  const { rootPath, root } = await openedFixture();
  const projectionPath = path.join(
    rootPath,
    ".wakeflow-active/current/todo/global-todo-board.md",
  );
  const outsidePath = path.join(rootPath, "outside-projection.md");
  writeFileSync(outsidePath, "outside\n", { mode: 0o600 });
  try {
    const parked = await appendTodoItem(
      root,
      todoIntakeDraft("todo_261d9b9b-3ef0-4133-940e-6427b953ac54", {
        readiness: {
          status: "parked",
          trigger: "Wait for the confirmed upstream decision.",
        },
        autoClaim: false,
      }),
      { clock: () => CREATED_AT },
    );
    const activationSource = await inspectTodoItems(root);
    const activatedState = activateTodoState(parked.item.state, {
      clock: () => ACTIVATED_AT,
    });
    rmSync(projectionPath);
    symlinkSync(outsidePath, projectionPath);
    await expectServiceError(
      () => withRootedExclusiveFileLock(
        root,
        TODO_COLLECTION_LOCK_REF,
        async () => commitTodoCollectionTransaction(
          root,
          "activate",
          activationSource,
          parked.item.intake,
          parked.item.state,
          activatedState,
          undefined,
        ),
      ),
      "projection-unsafe",
    );
    equal(existsSync(transactionPath(rootPath, parked.item.todoId)), true);
    rmSync(projectionPath);
    const activated = await recoverTodoItemTransaction(
      root,
      parked.item.todoId,
    );
    equal(activated.operation, "activate");
    equal(activated.wroteAuthority, false);
    equal(activated.item.state.status, "pending-claim");
    equal(activated.snapshot.projection.status, "current");

    const pending = await appendTodoItem(
      root,
      todoIntakeDraft("todo_8c04fbdf-e56a-48e1-8202-a800f3c98de5"),
      { clock: () => CREATED_AT },
    );
    const withdrawalSource = await inspectTodoItems(root);
    const withdrawnState = withdrawTodoState(pending.item.state, {
      reason: "The confirmed work is no longer planned.",
    }, { clock: () => WITHDRAWN_AT });
    rmSync(projectionPath);
    symlinkSync(outsidePath, projectionPath);
    await expectServiceError(
      () => withRootedExclusiveFileLock(
        root,
        TODO_COLLECTION_LOCK_REF,
        async () => commitTodoCollectionTransaction(
          root,
          "withdraw",
          withdrawalSource,
          pending.item.intake,
          pending.item.state,
          withdrawnState,
          undefined,
        ),
      ),
      "projection-unsafe",
    );
    equal(existsSync(transactionPath(rootPath, pending.item.todoId)), true);
    rmSync(projectionPath);
    const withdrawn = await recoverTodoItemTransaction(
      root,
      pending.item.todoId,
    );
    equal(withdrawn.operation, "withdraw");
    equal(withdrawn.wroteAuthority, false);
    equal(withdrawn.item.state.status, "withdrawn");
    equal(withdrawn.snapshot.collection.activeItemCount, 1);
    equal(withdrawn.snapshot.projection.status, "current");
    equal(
      withdrawn.snapshot.projection.expected.content.includes(
        pending.item.todoId,
      ),
      false,
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
