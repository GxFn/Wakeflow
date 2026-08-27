import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  admitWakeflowResourceOperation,
} from "../../../src/foundation/resource/resource-processing-contract.js";
import type {
  WakeflowWorkspaceResourceNodePolicy,
} from "../../../src/workspace/workspace-resource-declaration.js";
import type {
  WakeflowResourceProcessingContract,
} from "../../../src/foundation/resource/resource-processing-contract.js";
import {
  TODO_AUTHORITY_DIRECTORY_MODE,
  TODO_AUTHORITY_FILE_MODE,
} from "../../../src/governance/todo/todo-collection-authority.js";
import {
  parseTodoItemId,
  TodoItemIdError,
} from "../../../src/governance/todo/todo-item-id.js";
import {
  TODO_BOARD_PROJECTION_REF,
  TODO_COLLECTION_LOCK_REF,
  TODO_COLLECTION_ROOT_REF,
  TODO_ITEMS_ROOT_REF,
  TODO_TRANSACTIONS_ROOT_REF,
  todoAppendStageRef,
  todoIntakeRef,
  todoItemRootRef,
  todoItemStorageKey,
  todoStateRef,
  todoTransactionRef,
} from "../../../src/governance/todo/todo-paths.js";
import {
  createTodoItemResourceCatalog,
  WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG,
} from "../../../src/governance/todo/todo-resource-catalog.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function modeOf(nodePolicy: Readonly<WakeflowWorkspaceResourceNodePolicy>): string {
  return nodePolicy.kind === "tree" ? nodePolicy.rootMode : nodePolicy.mode;
}

function processingOf(
  processing: Readonly<WakeflowResourceProcessingContract>,
): string {
  return processing.kind === "directory-container"
    ? `directory-container:${processing.materializationRecipe}`
    : `${processing.role}:${processing.allowedMutationRecipes.join("+")}`;
}

test("TODO static resource catalog closes roots, lock, and projection", () => {
  deepEqual(
    WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG.map((entry) => ({
      declarationId: entry.declarationId,
      ownerId: entry.ownerId,
      relativePath: entry.placement.relativePath,
      mode: modeOf(entry.nodePolicy),
      processing: processingOf(entry.processing),
    })),
    [
      {
        declarationId: "active.todo.board-projection",
        ownerId: "todo-collection",
        relativePath: TODO_BOARD_PROJECTION_REF,
        mode: "0600",
        processing: "derived-projection:deterministic-rewrite",
      },
      {
        declarationId: "active.todo.collection-lock",
        ownerId: "todo-collection",
        relativePath: TODO_COLLECTION_LOCK_REF,
        mode: "0600",
        processing: "transaction-artifact:exclusive-create+exact-retire",
      },
      {
        declarationId: "active.todo.items-root",
        ownerId: "todo-collection",
        relativePath: TODO_ITEMS_ROOT_REF,
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "active.todo.root",
        ownerId: "todo-collection",
        relativePath: TODO_COLLECTION_ROOT_REF,
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "active.todo.transactions-root",
        ownerId: "todo-collection",
        relativePath: TODO_TRANSACTIONS_ROOT_REF,
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
    ],
  );
  assertDeepFrozen(WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG);
  equal(WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG.length, 5);
  equal(
    WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG.every((entry) =>
      entry.family === "active"
      && entry.scope === "host-neutral"
      && entry.tracking.disposition === "ignored"
      && entry.tracking.privacy === "runtime-private"),
    true,
  );
  equal(Number.parseInt("0600", 8), TODO_AUTHORITY_FILE_MODE);
  equal(Number.parseInt("0700", 8), TODO_AUTHORITY_DIRECTORY_MODE);
});

test("TODO item resource catalog binds one concrete aggregate without cataloging stages", () => {
  const todoId = parseTodoItemId("TODO:RH1:CATALOG");
  const storageKey = todoItemStorageKey(todoId);
  const catalog = createTodoItemResourceCatalog(todoId);

  deepEqual(
    catalog.map((entry) => ({
      declarationId: entry.declarationId,
      relativePath: entry.placement.relativePath,
      mode: modeOf(entry.nodePolicy),
      processing: processingOf(entry.processing),
    })),
    [
      {
        declarationId: `active.todo.item.${storageKey}.intake`,
        relativePath: todoIntakeRef(todoId),
        mode: "0600",
        processing: "immutable-fact:exclusive-create",
      },
      {
        declarationId: `active.todo.item.${storageKey}.root`,
        relativePath: todoItemRootRef(todoId),
        mode: "0700",
        processing: "directory-container:exact-directory-publish",
      },
      {
        declarationId: `active.todo.item.${storageKey}.state`,
        relativePath: todoStateRef(todoId),
        mode: "0600",
        processing: "mutable-snapshot:exclusive-create+exact-source-replace",
      },
      {
        declarationId: `active.todo.item.${storageKey}.transaction`,
        relativePath: todoTransactionRef(todoId),
        mode: "0600",
        processing: "transaction-artifact:exclusive-create+exact-retire",
      },
    ],
  );
  assertDeepFrozen(catalog);
  equal(catalog.length, 4);
  equal(
    catalog.some((entry) => entry.placement.relativePath === todoAppendStageRef(todoId)),
    false,
  );
  equal(
    catalog.every((entry) =>
      entry.ownerId === "todo-collection"
      && entry.family === "active"
      && entry.scope === "host-neutral"
      && entry.tracking.disposition === "ignored"
      && entry.tracking.privacy === "runtime-private"),
    true,
  );

  const itemRoot = catalog[1];
  const state = catalog[2];
  if (itemRoot === undefined || state === undefined) {
    throw new Error("TODO item catalog is incomplete.");
  }
  deepEqual(
    admitWakeflowResourceOperation(
      itemRoot.processing,
      "exact-directory-publish",
    ),
    {
      kind: "directory-publication",
      recipe: "exact-directory-publish",
    },
  );
  deepEqual(
    admitWakeflowResourceOperation(state.processing, "exact-source-replace"),
    {
      kind: "resource-mutation",
      role: "mutable-snapshot",
      recipe: "exact-source-replace",
    },
  );

  deepEqual(createTodoItemResourceCatalog(todoId), catalog);
  let caught: unknown;
  try {
    createTodoItemResourceCatalog("invalid id with spaces");
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof TodoItemIdError, true);
});
