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
import {
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
} from "../../workspace/active/wakeflow-active-paths.js";

/**
 * Wakeflow Governance / TODO：TODO 聚合的可移植路径词汇。
 *
 * 公开 TODO ID 允许冒号等不适合作为跨平台文件名的字符，因此条目目录使用完整的
 * SHA-256 存储键。接收记录仍保存真实 ID；资源清单必须反向核对存储键，不能把摘要
 * 目录名升级为业务身份，也不能省略碰撞检查。
 */

export const TODO_COLLECTION_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_ACTIVE_CURRENT_ROOT_REF}/todo`,
);
export const TODO_ITEMS_ROOT_REF = parsePortableResourcePath(
  `${TODO_COLLECTION_ROOT_REF}/items`,
);
export const TODO_TRANSACTIONS_ROOT_REF = parsePortableResourcePath(
  `${TODO_COLLECTION_ROOT_REF}/transactions`,
);
export const TODO_COLLECTION_LOCK_REF = parsePortableResourcePath(
  `${TODO_COLLECTION_ROOT_REF}/collection.lock`,
);
export const TODO_BOARD_PROJECTION_REF = parsePortableResourcePath(
  `${TODO_COLLECTION_ROOT_REF}/global-todo-board.md`,
);

declare const TODO_ITEM_STORAGE_KEY_BRAND: unique symbol;

export type TodoItemStorageKey = `item-${string}` & {
  readonly [TODO_ITEM_STORAGE_KEY_BRAND]: "TodoItemStorageKey";
};

/** 从真实 TODO ID 计算跨平台、固定长度且不泄露原文的存储键。 */
export function todoItemStorageKey(value: unknown): TodoItemStorageKey {
  const todoId = parseTodoItemId(value, "$todoId");
  const digest = computeSha256Hex(encodeUtf8(todoId, "$todoId"), "$todoId");
  return `item-${digest}` as TodoItemStorageKey;
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

/** 每个条目同时最多存在一个未完成的事务恢复意图记录。 */
export function todoTransactionRef(todoId: TodoItemId): PortableResourcePath {
  return parsePortableResourcePath(
    `${TODO_TRANSACTIONS_ROOT_REF}/${todoItemStorageKey(todoId)}.json`,
  );
}

/** Append 事务构建完整条目目录时使用的确定性私有暂存目录。 */
export function todoAppendStageRef(todoId: TodoItemId): PortableResourcePath {
  return parsePortableResourcePath(
    `${TODO_TRANSACTIONS_ROOT_REF}/.${todoItemStorageKey(todoId)}.stage`,
  );
}
