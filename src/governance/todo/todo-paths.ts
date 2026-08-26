import { computeSha256Hex } from "../../foundation/crypto/sha256.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  parseTodoItemId,
  type TodoItemId,
} from "./todo-item-id.js";

/**
 * Wakeflow Governance / TODO：TODO aggregate 的 portable path vocabulary。
 *
 * 公开 TODO ID 允许冒号等不适合作为跨平台文件名的字符，因此 item directory 使用
 * 完整 SHA-256 storage key。Intake 仍保存真实 ID；inventory 必须反向核对 key，不能
 * 把摘要目录名升级为业务身份或省略碰撞检查。
 */

export const TODO_COLLECTION_ROOT_REF = parsePortableResourcePath(
  ".wakeflow-active/current/todo",
);
export const TODO_ITEMS_ROOT_REF = parsePortableResourcePath(
  ".wakeflow-active/current/todo/items",
);
export const TODO_TRANSACTIONS_ROOT_REF = parsePortableResourcePath(
  ".wakeflow-active/current/todo/transactions",
);
export const TODO_COLLECTION_LOCK_REF = parsePortableResourcePath(
  ".wakeflow-active/current/todo/collection.lock",
);
export const TODO_BOARD_PROJECTION_REF = parsePortableResourcePath(
  ".wakeflow-active/current/todo/global-todo-board.md",
);

export type TodoItemStorageKey = `item-${string}`;

/** 从真实 TODO ID 计算跨平台、固定长度、无泄露原文的 storage key。 */
export function todoItemStorageKey(value: unknown): TodoItemStorageKey {
  const todoId = parseTodoItemId(value, "$todoId");
  const digest = computeSha256Hex(encodeUtf8(todoId, "$todoId"), "$todoId");
  return `item-${digest}`;
}

function itemRef(
  todoId: TodoItemId,
  suffix?: "intake.json" | "state.json",
): PortableResourcePath {
  const key = todoItemStorageKey(todoId);
  return parsePortableResourcePath(
    suffix === undefined
      ? `${TODO_ITEMS_ROOT_REF}/${key}`
      : `${TODO_ITEMS_ROOT_REF}/${key}/${suffix}`,
  );
}

export function todoItemRootRef(todoId: TodoItemId): PortableResourcePath {
  return itemRef(todoId);
}

export function todoIntakeRef(todoId: TodoItemId): PortableResourcePath {
  return itemRef(todoId, "intake.json");
}

export function todoStateRef(todoId: TodoItemId): PortableResourcePath {
  return itemRef(todoId, "state.json");
}

/** 每个 item 同时最多一个未完成 transaction journal。 */
export function todoTransactionRef(todoId: TodoItemId): PortableResourcePath {
  return parsePortableResourcePath(
    `${TODO_TRANSACTIONS_ROOT_REF}/${todoItemStorageKey(todoId)}.json`,
  );
}

/** Append transaction 构建完整 item directory 使用的 deterministic private stage。 */
export function todoAppendStageRef(todoId: TodoItemId): PortableResourcePath {
  return parsePortableResourcePath(
    `${TODO_TRANSACTIONS_ROOT_REF}/.${todoItemStorageKey(todoId)}.stage`,
  );
}
