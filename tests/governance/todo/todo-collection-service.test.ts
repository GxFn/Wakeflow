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
  appendTodoItem,
  archiveTodoItem,
  claimTodoItem,
  initializeTodoCollection,
  inspectTodoItems,
  recoverTodoItemTransaction,
  TodoCollectionServiceError,
  type TodoCollectionServiceErrorReason,
} from "../../../src/governance/todo/todo-collection-service.js";
import {
  TODO_COLLECTION_LOCK_REF,
  todoItemStorageKey,
} from "../../../src/governance/todo/todo-paths.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  materializeWakeflowActiveLayout,
} from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";

const CREATED_AT = parseUtcInstant("2026-08-26T09:00:00.000Z");
const CLAIMED_AT = parseUtcInstant("2026-08-26T09:01:00.000Z");
const ARCHIVED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const DEMAND_ID = "demand_33333333-3333-4333-8333-333333333333";

function draft(todoId: string): Record<string, unknown> {
  return {
    todoId,
    initialStatus: "pending-claim",
    type: "requirement",
    priority: "P1",
    ownerWindowId: "window_11111111-1111-4111-8111-111111111111",
    goal: `Implement ${todoId}`,
    affectsRetestOrDispatch: false,
    dependency: null,
    recommendedWindowId: "window_22222222-2222-4222-8222-222222222222",
    autoClaim: true,
    testingDecision: {
      mode: "controller-only",
      summary: "Focused target tests",
    },
    documents: [{
      label: "plan",
      ref: `ledger/requirements/${todoId}/record.json`,
      anchor: null,
    }],
  };
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
    const result = await appendTodoItem(root, draft("TODO-RH1-APPEND"), {
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
      todoItemStorageKey("TODO-RH1-APPEND"),
    );
    equal(existsSync(path.join(itemRoot, "intake.json")), true);
    equal(existsSync(path.join(itemRoot, "state.json")), true);
    equal(
      readFileSync(path.join(
        rootPath,
        ".wakeflow-active/current/todo/global-todo-board.md",
      ), "utf8").includes("TODO-RH1-APPEND"),
      true,
    );
    equal(
      existsSync(path.join(
        rootPath,
        ".wakeflow-active/current/todo/transactions",
        `${todoItemStorageKey("TODO-RH1-APPEND")}.json`,
      )),
      false,
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("claim and archive replace an exact source and preserve archived audit state", async () => {
  const { rootPath, root } = await openedFixture();
  try {
    const appended = await appendTodoItem(root, draft("TODO-RH1-LIFECYCLE"), {
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
    equal(archived.snapshot.projection.expected.content.includes("TODO-RH1-LIFECYCLE"), false);
    equal(existsSync(path.join(
      rootPath,
      ".wakeflow-active/current/todo/items",
      todoItemStorageKey("TODO-RH1-LIFECYCLE"),
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
    const appended = await appendTodoItem(root, draft("TODO-RH1-CAS"), {
      clock: () => CREATED_AT,
    });
    await expectServiceError(
      () => appendTodoItem(root, draft("TODO-RH1-OTHER"), {
        expectedCollectionDigest: initial.collection.collectionDigest,
        clock: () => CREATED_AT,
      }),
      "cas-mismatch",
    );
    await expectServiceError(
      () => appendTodoItem(root, draft("TODO-RH1-CAS"), {
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
  const todoId = "TODO-RH1-UNSAFE-STAGE";
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
  const todoId = "TODO-RH1-PARTIAL-JOURNAL";
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
    const count = 3;
    await Promise.all(Array.from({ length: count }, (_, index) => (
      appendTodoItem(root, draft(`TODO-RH1-CONCURRENT-${index}`), {
        clock: () => parseUtcInstant(
          `2026-08-26T09:00:0${index}.000Z`,
        ),
      })
    )));
    const snapshot = await inspectTodoItems(root);
    equal(snapshot.collection.itemCount, count);
    equal(new Set(snapshot.items.map((item) => item.todoId)).size, count);
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
      () => appendTodoItem(root, draft("TODO-RH1-RECOVER"), {
        clock: () => CREATED_AT,
      }),
      "projection-unsafe",
    );
    const journalPath = path.join(
      rootPath,
      ".wakeflow-active/current/todo/transactions",
      `${todoItemStorageKey("TODO-RH1-RECOVER")}.json`,
    );
    equal(existsSync(journalPath), true);
    equal(existsSync(path.join(
      rootPath,
      ".wakeflow-active/current/todo/items",
      todoItemStorageKey("TODO-RH1-RECOVER"),
    )), true);

    rmSync(projectionPath);
    const lockPath = path.join(
      rootPath,
      ".wakeflow-active/current/todo/collection.lock",
    );
    writeFileSync(lockPath, rootedExclusiveFileLockRecordTextForTest({
      tokenUuid: "11111111-1111-4111-8111-111111111111",
    }), { mode: 0o600 });
    const recovered = await recoverTodoItemTransaction(root, "TODO-RH1-RECOVER");
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
    const appended = await appendTodoItem(root, draft("TODO-RH1-REPLAY"), {
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
      () => appendTodoItem(root, draft("TODO-ABORT"), {
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
      () => appendTodoItem(root, { ...draft("TODO-INVALID-DRAFT"), goal: "" }, {
        clock: () => CREATED_AT,
      }),
      "input",
    );
    const parked = await appendTodoItem(root, {
      ...draft("TODO-PARKED"),
      initialStatus: "parked",
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
      () => recoverTodoItemTransaction(root, "TODO-UNKNOWN", {
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
    const appended = await appendTodoItem(root, draft("TODO-RH1-CAPACITY"), {
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
