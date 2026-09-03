import { equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { durableAtomicFileStageRefForTest } from "../../foundation/filesystem/durable-atomic-file-test-support.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";
import {
  createFileCandidateDurably,
} from "../../../src/foundation/filesystem/durable-file-candidate.js";
import {
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { withRootedExclusiveFileLock } from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  activateTodoItem,
  appendTodoItem,
  archiveTodoItem,
  claimTodoItem,
  initializeTodoCollection,
  inspectTodoItems,
  recoverTodoItemTransaction,
  TodoCollectionServiceError,
  type TodoCollectionServiceErrorReason,
  withdrawTodoItem,
} from "../../../src/governance/todo/todo-collection-service.js";
import {
  TODO_COLLECTION_LOCK_REF,
  todoItemStorageKey,
} from "../../../src/governance/todo/todo-paths.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  materializeWakeflowActiveLayout,
} from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";
import { todoIntakeDraft } from "./todo-intake.fixture.js";

const CREATED_AT = parseUtcInstant("2026-08-26T09:00:00.000Z");
const ACTIVATED_AT = parseUtcInstant("2026-08-26T09:00:30.000Z");
const WITHDRAWN_AT = parseUtcInstant("2026-08-26T09:00:45.000Z");
const CLAIMED_AT = parseUtcInstant("2026-08-26T09:01:00.000Z");
const ARCHIVED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const DEMAND_ID = "demand_33333333-3333-4333-8333-333333333333";

function draft(todoId: string): Record<string, unknown> {
  return todoIntakeDraft(todoId);
}

function mount() {
  return {
    demandId: DEMAND_ID,
    stateRootRef: `.wakeflow-active/current/${DEMAND_ID}`,
    identityDigest: `sha256:${"a".repeat(64)}`,
  };
}

function archiveReceipt(
  todoId: string,
  intakeDigest: string,
  claimedStateDigest: string,
) {
  return {
    artifactKind: "wakeflow-business-archive-receipt",
    schemaVersion: 1,
    archiveId: "archive_44444444-4444-4444-8444-444444444444",
    demandId: DEMAND_ID,
    todoId,
    intakeDigest,
    claimedStateDigest,
    manifestDigest: `sha256:${"b".repeat(64)}`,
  };
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
  equal(caught.code, "wakeflow-todo-collection-service");
  equal(caught.reason, reason);
}

async function openedFixture() {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-todo-service-rh1-"));
  const root = await RootedDirectory.open(rootPath);
  await materializeWakeflowActiveLayout(root, {
    recoveringFreshLayout: false,
  });
  await initializeTodoCollection(root, { freshWorkspace: true });
  return { rootPath, root };
}

test("fresh initialization creates private roots and an empty projection", async () => {
  const { rootPath, root } = await openedFixture();
  try {
    const snapshot = await inspectTodoItems(root);
    equal(snapshot.collection.itemCount, 0);
    equal(snapshot.projection.status, "current");
    for (const relative of [
      ".wakeflow-active/current/todo",
      ".wakeflow-active/current/todo/items",
      ".wakeflow-active/current/todo/transactions",
    ]) {
      equal(lstatSync(path.join(rootPath, relative)).mode & 0o777, 0o700);
    }
    equal(
      lstatSync(path.join(
        rootPath,
        ".wakeflow-active/current/todo/global-todo-board.md",
      )).mode & 0o777,
      0o600,
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("initialization serializes projection repair with collection mutations", async () => {
  const { rootPath, root } = await openedFixture();
  let initialization!: ReturnType<typeof initializeTodoCollection>;
  let settled = false;
  try {
    await withRootedExclusiveFileLock(
      root,
      TODO_COLLECTION_LOCK_REF,
      async () => {
        initialization = initializeTodoCollection(root, { freshWorkspace: true });
        void initialization.then(
          () => { settled = true; },
          () => { settled = true; },
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        equal(settled, false);
      },
    );
    const snapshot = await initialization;
    equal(snapshot.projection.status, "current");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("append atomically publishes intake/state directory and projection", async () => {
  const { rootPath, root } = await openedFixture();
  try {
    const before = await inspectTodoItems(root);
    const result = await appendTodoItem(root, draft("todo_45d783d6-145f-4b10-83ed-08642db07ce0"), {
      expectedCollectionDigest: before.collection.collectionDigest,
      clock: () => CREATED_AT,
    });
    equal(result.operation, "append");
    equal(result.wroteAuthority, true);
    equal(result.wroteProjection, true);
    equal(result.item.state.status, "pending-claim");
    equal(result.snapshot.collection.itemCount, 1);
    equal(result.snapshot.projection.status, "current");
    equal(result.lineageRef.intakeDigest, result.item.intakeDigest);

    const itemRoot = path.join(
      rootPath,
      ".wakeflow-active/current/todo/items",
      todoItemStorageKey("todo_45d783d6-145f-4b10-83ed-08642db07ce0"),
    );
    equal(existsSync(path.join(itemRoot, "intake.json")), true);
    equal(existsSync(path.join(itemRoot, "state.json")), true);
    equal(
      readFileSync(path.join(
        rootPath,
        ".wakeflow-active/current/todo/global-todo-board.md",
      ), "utf8").includes("todo_45d783d6-145f-4b10-83ed-08642db07ce0"),
      true,
    );
    equal(
      existsSync(path.join(
        rootPath,
        ".wakeflow-active/current/todo/transactions",
        `${todoItemStorageKey("todo_45d783d6-145f-4b10-83ed-08642db07ce0")}.json`,
      )),
      false,
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("activate and withdraw enforce exact CAS and terminal scheduling semantics", async () => {
  const { rootPath, root } = await openedFixture();
  try {
    const parked = await appendTodoItem(root, {
      ...draft("todo_e30e5e9f-9991-4a24-b704-19f52e8dad3a"),
      readiness: {
        status: "parked",
        trigger: "Wait for the confirmed upstream decision.",
      },
      autoClaim: false,
    }, { clock: () => CREATED_AT });
    await expectServiceError(
      () => activateTodoItem(root, {
        todoId: parked.item.todoId,
        intakeDigest: parked.item.intakeDigest,
        stateDigest: `sha256:${"c".repeat(64)}`,
      }, { clock: () => ACTIVATED_AT }),
      "cas-mismatch",
    );
    await expectServiceError(
      () => activateTodoItem(root, {
        todoId: parked.item.todoId,
        intakeDigest: parked.item.intakeDigest,
        stateDigest: parked.item.stateDigest,
      }, {
        clock: () => {
          throw new Error("private clock failure");
        },
      }),
      "input",
    );
    const activated = await activateTodoItem(root, {
      todoId: parked.item.todoId,
      intakeDigest: parked.item.intakeDigest,
      stateDigest: parked.item.stateDigest,
    }, {
      expectedCollectionDigest: parked.snapshot.collection.collectionDigest,
      clock: () => ACTIVATED_AT,
    });
    equal(activated.operation, "activate");
    equal(activated.item.state.status, "pending-claim");
    equal(activated.item.state.revision, 2);
    equal(activated.item.state.updatedAt, ACTIVATED_AT);
    await expectServiceError(
      () => activateTodoItem(root, {
        todoId: activated.item.todoId,
        intakeDigest: activated.item.intakeDigest,
        stateDigest: activated.item.stateDigest,
      }, { clock: () => ACTIVATED_AT }),
      "transition",
    );

    const pending = await appendTodoItem(
      root,
      draft("todo_a89dc4db-aa63-4c78-9fb0-7937e28cd194"),
      { clock: () => CREATED_AT },
    );
    await expectServiceError(
      () => withdrawTodoItem(root, {
        todoId: pending.item.todoId,
        intakeDigest: pending.item.intakeDigest,
        stateDigest: pending.item.stateDigest,
        reason: "",
      }, { clock: () => WITHDRAWN_AT }),
      "input",
    );
    await expectServiceError(
      () => withdrawTodoItem(root, {
        todoId: pending.item.todoId,
        intakeDigest: pending.item.intakeDigest,
        stateDigest: pending.item.stateDigest,
        reason: "The confirmed work is no longer planned.",
      }, {
        clock: () => {
          throw new Error("private clock failure");
        },
      }),
      "input",
    );
    const unchanged = await inspectTodoItems(root);
    equal(
      unchanged.collection.collectionDigest,
      pending.snapshot.collection.collectionDigest,
    );
    const withdrawn = await withdrawTodoItem(root, {
      todoId: pending.item.todoId,
      intakeDigest: pending.item.intakeDigest,
      stateDigest: pending.item.stateDigest,
      reason: "The confirmed work is no longer planned.",
    }, {
      expectedCollectionDigest: pending.snapshot.collection.collectionDigest,
      clock: () => WITHDRAWN_AT,
    });
    equal(withdrawn.operation, "withdraw");
    equal(withdrawn.item.state.status, "withdrawn");
    equal(withdrawn.item.state.withdrawal?.withdrawnAt, WITHDRAWN_AT);
    equal(withdrawn.snapshot.collection.itemCount, 2);
    equal(withdrawn.snapshot.collection.activeItemCount, 1);
    equal(
      withdrawn.snapshot.projection.expected.content.includes(
        pending.item.todoId,
      ),
      false,
    );
    await expectServiceError(
      () => claimTodoItem(root, {
        todoId: withdrawn.item.todoId,
        intakeDigest: withdrawn.item.intakeDigest,
        stateDigest: withdrawn.item.stateDigest,
        mount: mount(),
      }, { clock: () => CLAIMED_AT }),
      "transition",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("claim and archive replace an exact source and preserve archived audit state", async () => {
  const { rootPath, root } = await openedFixture();
  try {
    const appended = await appendTodoItem(root, draft("todo_75abd2cd-f835-47d7-871b-80109dfe6819"), {
      clock: () => CREATED_AT,
    });
    const claimed = await claimTodoItem(root, {
      todoId: appended.item.todoId,
      intakeDigest: appended.item.intakeDigest,
      stateDigest: appended.item.stateDigest,
      mount: mount(),
    }, {
      expectedCollectionDigest: appended.snapshot.collection.collectionDigest,
      clock: () => CLAIMED_AT,
    });
    equal(claimed.item.state.status, "claimed");
    equal(claimed.item.state.revision, 2);
    equal(claimed.item.state.mount?.demandId, DEMAND_ID);

    await expectServiceError(
      () => archiveTodoItem(root, {
        todoId: claimed.item.todoId,
        intakeDigest: claimed.item.intakeDigest,
        stateDigest: claimed.item.stateDigest,
        receipt: {
          ...archiveReceipt(
            claimed.item.todoId,
            claimed.item.intakeDigest,
            claimed.item.stateDigest,
          ),
          intakeDigest: `sha256:${"c".repeat(64)}`,
        },
      }, { clock: () => ARCHIVED_AT }),
      "authorization",
    );

    const archived = await archiveTodoItem(root, {
      todoId: claimed.item.todoId,
      intakeDigest: claimed.item.intakeDigest,
      stateDigest: claimed.item.stateDigest,
      receipt: archiveReceipt(
        claimed.item.todoId,
        claimed.item.intakeDigest,
        claimed.item.stateDigest,
      ),
    }, {
      expectedCollectionDigest: claimed.snapshot.collection.collectionDigest,
      clock: () => ARCHIVED_AT,
    });
    equal(archived.item.state.status, "archived");
    equal(archived.item.state.revision, 3);
    equal(archived.snapshot.collection.itemCount, 1);
    equal(archived.snapshot.collection.activeItemCount, 0);
    equal(archived.snapshot.projection.expected.content.includes("todo_75abd2cd-f835-47d7-871b-80109dfe6819"), false);
    equal(existsSync(path.join(
      rootPath,
      ".wakeflow-active/current/todo/items",
      todoItemStorageKey("todo_75abd2cd-f835-47d7-871b-80109dfe6819"),
    )), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("duplicate and stale expectations perform zero authority changes", async () => {
  const { rootPath, root } = await openedFixture();
  try {
    const initial = await inspectTodoItems(root);
    const appended = await appendTodoItem(root, draft("todo_841eb469-9161-4d6a-8ca8-9e24c2e250e5"), {
      clock: () => CREATED_AT,
    });
    await expectServiceError(
      () => appendTodoItem(root, draft("todo_f3b77c01-8113-4c4c-8423-42d3293ac381"), {
        expectedCollectionDigest: initial.collection.collectionDigest,
        clock: () => CREATED_AT,
      }),
      "cas-mismatch",
    );
    await expectServiceError(
      () => appendTodoItem(root, draft("todo_841eb469-9161-4d6a-8ca8-9e24c2e250e5"), {
        clock: () => CREATED_AT,
      }),
      "duplicate",
    );
    equal(
      (await inspectTodoItems(root)).collection.collectionDigest,
      appended.snapshot.collection.collectionDigest,
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("normal append routes any transaction residue to recovery without child writes", async () => {
  const { rootPath, root } = await openedFixture();
  const todoId = "todo_b6f87438-24e9-4858-8bcf-440ddf40a220";
  const stagePath = path.join(
    rootPath,
    ".wakeflow-active/current/todo/transactions",
    `.${todoItemStorageKey(todoId)}.stage`,
  );
  try {
    mkdirSync(stagePath, { mode: 0o755 });
    chmodSync(stagePath, 0o755);

    await expectServiceError(
      () => appendTodoItem(root, draft(todoId), { clock: () => CREATED_AT }),
      "recovery-required",
    );
    equal(existsSync(path.join(stagePath, "intake.json")), false);
    equal(existsSync(path.join(stagePath, "state.json")), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("TODO recovery 回滚 canonical journal 之前的 inactive partial stage", async () => {
  const { rootPath, root } = await openedFixture();
  const todoId = "todo_0a851ee6-5cc3-479e-85eb-209d5b036b6b";
  const targetRef = parsePortableResourcePath(
    `.wakeflow-active/current/todo/transactions/${todoItemStorageKey(todoId)}.json`,
  );
  const intendedBytes = encodeUtf8("intended-journal");
  const address = issueDurableAtomicFileStageAddress(
    "create",
    targetRef,
    computeSha256Digest(intendedBytes),
    0o600,
  );
  const stageRef = durableAtomicFileStageRefForTest(targetRef, address);
  try {
    try {
      await createFileCandidateDurably(root, stageRef, encodeUtf8("partial"), {
        mode: 0o600,
      });
    } finally {
      releaseDurableAtomicFileStageAddress(address);
    }
    await expectServiceError(
      () => recoverTodoItemTransaction(root, todoId),
      "not-found",
    );
    equal(existsSync(path.join(rootPath, ...stageRef.split("/"))), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("concurrent appends serialize without lost items", async () => {
  const { rootPath, root } = await openedFixture();
  try {
    // 三个竞争者足以证明 service 的 collection 级串行；更高并发由锁 primitive 覆盖。
    const todoIds = [
      "todo_00000000-0000-4000-8000-000000000001",
      "todo_00000000-0000-4000-8000-000000000002",
      "todo_00000000-0000-4000-8000-000000000003",
    ] as const;
    await Promise.all(todoIds.map((todoId, index) => (
      appendTodoItem(root, draft(todoId), {
        clock: () => parseUtcInstant(
          `2026-08-26T09:00:0${index}.000Z`,
        ),
      })
    )));
    const snapshot = await inspectTodoItems(root);
    equal(snapshot.collection.itemCount, todoIds.length);
    equal(new Set(snapshot.items.map((item) => item.todoId)).size, todoIds.length);
    equal(snapshot.projection.status, "current");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("append recovery completes authority after projection failure", async () => {
  const { rootPath, root } = await openedFixture();
  const projectionPath = path.join(
    rootPath,
    ".wakeflow-active/current/todo/global-todo-board.md",
  );
  const outside = path.join(rootPath, "outside-projection.md");
  try {
    rmSync(projectionPath);
    writeFileSync(outside, "outside\n", { mode: 0o600 });
    symlinkSync(outside, projectionPath);

    await expectServiceError(
      () => appendTodoItem(root, draft("todo_b1936625-b84f-4a2a-8dcb-81725744866b"), {
        clock: () => CREATED_AT,
      }),
      "projection-unsafe",
    );
    const journalPath = path.join(
      rootPath,
      ".wakeflow-active/current/todo/transactions",
      `${todoItemStorageKey("todo_b1936625-b84f-4a2a-8dcb-81725744866b")}.json`,
    );
    equal(existsSync(journalPath), true);
    equal(existsSync(path.join(
      rootPath,
      ".wakeflow-active/current/todo/items",
      todoItemStorageKey("todo_b1936625-b84f-4a2a-8dcb-81725744866b"),
    )), true);

    rmSync(projectionPath);
    const lockPath = path.join(
      rootPath,
      ".wakeflow-active/current/todo/collection.lock",
    );
    writeFileSync(lockPath, rootedExclusiveFileLockRecordTextForTest({
      tokenUuid: "11111111-1111-4111-8111-111111111111",
    }), { mode: 0o600 });
    const recovered = await recoverTodoItemTransaction(root, "todo_b1936625-b84f-4a2a-8dcb-81725744866b");
    equal(recovered.operation, "append");
    equal(recovered.wroteAuthority, false);
    equal(recovered.wroteProjection, true);
    equal(recovered.snapshot.projection.status, "current");
    equal(existsSync(journalPath), false);
    equal(existsSync(lockPath), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("claim and archive recovery replay an already committed target state", async () => {
  const { rootPath, root } = await openedFixture();
  const projectionPath = path.join(
    rootPath,
    ".wakeflow-active/current/todo/global-todo-board.md",
  );
  const outside = path.join(rootPath, "outside-lifecycle-projection.md");
  try {
    const appended = await appendTodoItem(root, draft("todo_ea937d7e-bc8b-43ea-8341-7523e6c5c4bd"), {
      clock: () => CREATED_AT,
    });
    writeFileSync(outside, "outside\n", { mode: 0o600 });
    rmSync(projectionPath);
    symlinkSync(outside, projectionPath);
    await expectServiceError(
      () => claimTodoItem(root, {
        todoId: appended.item.todoId,
        intakeDigest: appended.item.intakeDigest,
        stateDigest: appended.item.stateDigest,
        mount: mount(),
      }, { clock: () => CLAIMED_AT }),
      "projection-unsafe",
    );
    rmSync(projectionPath);
    const claimed = await recoverTodoItemTransaction(root, appended.item.todoId);
    equal(claimed.operation, "claim");
    equal(claimed.wroteAuthority, false);
    equal(claimed.item.state.status, "claimed");

    rmSync(projectionPath);
    symlinkSync(outside, projectionPath);
    await expectServiceError(
      () => archiveTodoItem(root, {
        todoId: claimed.item.todoId,
        intakeDigest: claimed.item.intakeDigest,
        stateDigest: claimed.item.stateDigest,
        receipt: archiveReceipt(
          claimed.item.todoId,
          claimed.item.intakeDigest,
          claimed.item.stateDigest,
        ),
      }, { clock: () => ARCHIVED_AT }),
      "projection-unsafe",
    );
    rmSync(projectionPath);
    const archived = await recoverTodoItemTransaction(root, claimed.item.todoId);
    equal(archived.operation, "archive");
    equal(archived.wroteAuthority, false);
    equal(archived.item.state.status, "archived");
    equal(archived.snapshot.projection.status, "current");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("activate and withdraw service failures recover from exact committed State", async () => {
  const { rootPath, root } = await openedFixture();
  const projectionPath = path.join(
    rootPath,
    ".wakeflow-active/current/todo/global-todo-board.md",
  );
  const outside = path.join(rootPath, "outside-pre-demand-projection.md");
  writeFileSync(outside, "outside\n", { mode: 0o600 });
  try {
    const parked = await appendTodoItem(root, {
      ...draft("todo_62c9484a-2ed9-4b8d-9b40-d80eaaba784b"),
      readiness: {
        status: "parked",
        trigger: "Wait for the confirmed upstream decision.",
      },
      autoClaim: false,
    }, { clock: () => CREATED_AT });
    rmSync(projectionPath);
    symlinkSync(outside, projectionPath);
    await expectServiceError(
      () => activateTodoItem(root, {
        todoId: parked.item.todoId,
        intakeDigest: parked.item.intakeDigest,
        stateDigest: parked.item.stateDigest,
      }, { clock: () => ACTIVATED_AT }),
      "projection-unsafe",
    );
    const activationJournal = path.join(
      rootPath,
      ".wakeflow-active/current/todo/transactions",
      `${todoItemStorageKey(parked.item.todoId)}.json`,
    );
    equal(existsSync(activationJournal), true);
    rmSync(projectionPath);
    const activated = await recoverTodoItemTransaction(
      root,
      parked.item.todoId,
    );
    equal(activated.operation, "activate");
    equal(activated.wroteAuthority, false);
    equal(activated.item.state.status, "pending-claim");
    equal(existsSync(activationJournal), false);

    const pending = await appendTodoItem(
      root,
      draft("todo_19cd26c8-89d5-4156-b5f6-67426f663c53"),
      { clock: () => CREATED_AT },
    );
    rmSync(projectionPath);
    symlinkSync(outside, projectionPath);
    await expectServiceError(
      () => withdrawTodoItem(root, {
        todoId: pending.item.todoId,
        intakeDigest: pending.item.intakeDigest,
        stateDigest: pending.item.stateDigest,
        reason: "The confirmed work is no longer planned.",
      }, { clock: () => WITHDRAWN_AT }),
      "projection-unsafe",
    );
    const withdrawalJournal = path.join(
      rootPath,
      ".wakeflow-active/current/todo/transactions",
      `${todoItemStorageKey(pending.item.todoId)}.json`,
    );
    equal(existsSync(withdrawalJournal), true);
    rmSync(projectionPath);
    const withdrawn = await recoverTodoItemTransaction(
      root,
      pending.item.todoId,
    );
    equal(withdrawn.operation, "withdraw");
    equal(withdrawn.wroteAuthority, false);
    equal(withdrawn.item.state.status, "withdrawn");
    equal(withdrawn.snapshot.collection.activeItemCount, 1);
    equal(
      withdrawn.snapshot.projection.expected.content.includes(
        pending.item.todoId,
      ),
      false,
    );
    equal(existsSync(withdrawalJournal), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("invalid initialization, operation inputs, and cancellation fail closed", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-todo-invalid-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectServiceError(
      () => initializeTodoCollection(root, { freshWorkspace: false } as never),
      "input",
    );
    await materializeWakeflowActiveLayout(root, {
      recoveringFreshLayout: false,
    });
    await initializeTodoCollection(root, { freshWorkspace: true });
    const controller = new AbortController();
    controller.abort();
    await expectServiceError(
      () => appendTodoItem(root, draft("todo_e48543fe-9a66-4a0f-8d26-1e366a672e25"), {
        signal: controller.signal,
        clock: () => CREATED_AT,
      }),
      "aborted",
    );
    await expectServiceError(
      () => claimTodoItem(root, null),
      "input",
    );
    await expectServiceError(
      () => activateTodoItem(root, null),
      "input",
    );
    await expectServiceError(
      () => withdrawTodoItem(root, {}),
      "input",
    );
    await expectServiceError(
      () => appendTodoItem(root, { ...draft("todo_4d284629-183d-4c79-8f0c-b316eb8e9415"), summary: "" }, {
        clock: () => CREATED_AT,
      }),
      "input",
    );
    const parked = await appendTodoItem(root, {
      ...draft("todo_31a4a678-1d17-4b72-8273-b741802c0f75"),
      readiness: {
        status: "parked",
        trigger: "Wait for an external prerequisite.",
      },
      autoClaim: false,
    }, { clock: () => CREATED_AT });
    await expectServiceError(
      () => claimTodoItem(root, {
        todoId: parked.item.todoId,
        intakeDigest: parked.item.intakeDigest,
        stateDigest: parked.item.stateDigest,
        mount: mount(),
      }, { clock: () => CLAIMED_AT }),
      "transition",
    );
    await expectServiceError(
      () => recoverTodoItemTransaction(root, "todo_27451c05-b1bb-44d7-8845-2619aaa7a5ca", {
        expectedCollectionDigest: `sha256:${"a".repeat(64)}`,
      } as never),
      "input",
    );
    const snapshot = await inspectTodoItems(root);
    equal(snapshot.collection.itemCount, 1);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("authority byte-budget failure remains a capacity error at the service boundary", async () => {
  const { rootPath, root } = await openedFixture();
  try {
    const appended = await appendTodoItem(root, draft("todo_4fc1272c-b27c-49a2-84ff-0b9520818c90"), {
      clock: () => CREATED_AT,
    });
    const statePath = path.join(
      rootPath,
      ".wakeflow-active/current/todo/items",
      todoItemStorageKey(appended.item.todoId),
      "state.json",
    );
    writeFileSync(statePath, "x".repeat(128 * 1024 + 1));
    await expectServiceError(() => inspectTodoItems(root), "capacity");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
