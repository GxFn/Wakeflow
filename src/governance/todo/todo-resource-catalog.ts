import type {
  PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../../workspace/workspace-resource-declaration.js";
import {
  TODO_BOARD_PROJECTION_REF,
  TODO_COLLECTION_LOCK_REF,
  TODO_COLLECTION_ROOT_REF,
  TODO_ITEMS_ROOT_REF,
  TODO_TRANSACTIONS_ROOT_REF,
  todoIntakeRef,
  todoItemRootRef,
  todoItemStorageKey,
  todoStateRef,
  todoTransactionRef,
} from "./todo-paths.js";
import {
  parseTodoItemId,
} from "./todo-item-id.js";

/**
 * Wakeflow Governance / TODO：TODO Collection 职责所有者的资源目录。
 *
 * 静态资源目录只登记首次初始化后可以稳定寻址的集合根目录、锁文件和看板投影。
 * 具体工厂根据 `todoId` 生成条目权威资源；任何暂存资源都不会通过字符串模式加入
 * 资源目录。
 *
 * 所有声明只描述资源策略，不读取工作区、不执行事务，也不改变 TODO 权威事实。
 * 真正的职责所有者仍是 `todo-collection-service` 及其事务存储边界。
 */

const TODO_RESOURCE_OWNER_ID = "todo-collection" as const;

function privateDirectoryDeclaration(
  declarationId: string,
  relativePath: PortableResourcePath,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "active",
    ownerId: TODO_RESOURCE_OWNER_ID,
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "directory",
      mode: "0700",
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    },
    processing: {
      kind: "directory-container",
      materializationRecipe: "materialize-directory",
      existingDirectoryPolicy: "observe-without-mode-change",
      collisionPolicy: "reject-non-directory",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "report-only",
    },
  });
}

function privateFileDeclaration(
  declarationId: string,
  relativePath: PortableResourcePath,
  processing: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "active",
    ownerId: TODO_RESOURCE_OWNER_ID,
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing,
  });
}

export const TODO_BOARD_PROJECTION_RESOURCE_DECLARATION =
  parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "active.todo.board-projection",
    family: "active",
    ownerId: TODO_RESOURCE_OWNER_ID,
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: TODO_BOARD_PROJECTION_REF,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing: {
      kind: "resource",
      role: "derived-projection",
      allowedMutationRecipes: ["deterministic-rewrite"],
      recoveryStrategy: "rebuild-from-authority",
    },
  });

export const TODO_COLLECTION_LOCK_RESOURCE_DECLARATION =
  parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "active.todo.collection-lock",
    family: "active",
    ownerId: TODO_RESOURCE_OWNER_ID,
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: TODO_COLLECTION_LOCK_REF,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing: {
      kind: "resource",
      role: "transaction-artifact",
      allowedMutationRecipes: [
        "exclusive-create",
        "exact-retire",
      ],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });

export const TODO_ITEMS_ROOT_RESOURCE_DECLARATION =
  privateDirectoryDeclaration("active.todo.items-root", TODO_ITEMS_ROOT_REF);

export const TODO_COLLECTION_ROOT_RESOURCE_DECLARATION =
  privateDirectoryDeclaration("active.todo.root", TODO_COLLECTION_ROOT_REF);

export const TODO_TRANSACTIONS_ROOT_RESOURCE_DECLARATION =
  privateDirectoryDeclaration(
    "active.todo.transactions-root",
    TODO_TRANSACTIONS_ROOT_REF,
  );

/** TODO Collection Owner 的确定性静态资源目录。 */
export const WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG = Object.freeze([
  TODO_BOARD_PROJECTION_RESOURCE_DECLARATION,
  TODO_COLLECTION_LOCK_RESOURCE_DECLARATION,
  TODO_ITEMS_ROOT_RESOURCE_DECLARATION,
  TODO_COLLECTION_ROOT_RESOURCE_DECLARATION,
  TODO_TRANSACTIONS_ROOT_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];

export type TodoItemResourceCatalog = readonly [
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
];

/**
 * 为一个已验证的 TODO ID 生成具体聚合资源目录。
 *
 * 追加暂存目录只在一次 `exact-directory-publish` 操作中作为源资源存在；Foundation
 * 原子暂存文件则是单文件操作方案的残留。两者都不进入返回的资源目录。
 */
export function createTodoItemResourceCatalog(
  value: unknown,
): TodoItemResourceCatalog {
  const todoId = parseTodoItemId(value, "$todoId");
  const storageKey = todoItemStorageKey(todoId);
  const prefix = `active.todo.item.${storageKey}`;

  const intake = privateFileDeclaration(
    `${prefix}.intake`,
    todoIntakeRef(todoId),
    {
      kind: "resource",
      role: "immutable-fact",
      allowedMutationRecipes: ["exclusive-create"],
      recoveryStrategy: "exact-idempotent-retry",
    },
  );
  const itemRoot = parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: `${prefix}.root`,
    family: "active",
    ownerId: TODO_RESOURCE_OWNER_ID,
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: todoItemRootRef(todoId),
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "directory",
      mode: "0700",
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    },
    processing: {
      kind: "directory-container",
      materializationRecipe: "exact-directory-publish",
      existingDirectoryPolicy: "owner-validate-existing-target",
      collisionPolicy: "reject-unowned-target",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "owner-forward-recovery",
    },
  });
  const state = privateFileDeclaration(
    `${prefix}.state`,
    todoStateRef(todoId),
    {
      kind: "resource",
      role: "mutable-snapshot",
      allowedMutationRecipes: [
        "exclusive-create",
        "exact-source-replace",
      ],
      recoveryStrategy: "owner-forward-recovery",
    },
  );
  const transaction = privateFileDeclaration(
    `${prefix}.transaction`,
    todoTransactionRef(todoId),
    {
      kind: "resource",
      role: "transaction-artifact",
      allowedMutationRecipes: [
        "exclusive-create",
        "exact-retire",
      ],
      recoveryStrategy: "owner-transaction-recovery",
    },
  );

  return Object.freeze([
    intake,
    itemRoot,
    state,
    transaction,
  ]);
}
