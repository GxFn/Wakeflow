import { TODO_ITEM_ID_PATTERN_SOURCE } from "../../contracts/generated/governance/todo/todo-item-id.generated.js";

/**
 * Wakeflow Governance / TODO：稳定、用户可读的 TODO item ID。
 *
 * TODO ID 保留现有公开入口的 opaque token 语义，不强制迁移成 UUID durable kind；
 * 它只在创建时授予品牌，不从标题、路径、时间或数组位置推导，也不判断 item 是否存在。
 */

declare const TODO_ITEM_ID_BRAND: unique symbol;

export type TodoItemId = string & {
  readonly [TODO_ITEM_ID_BRAND]: "TodoItemId";
};

export type TodoItemIdErrorReason = "format";

/** TODO item ID 词法失败的稳定、脱敏错误。 */
export class TodoItemIdError extends Error {
  override readonly name = "TodoItemIdError";
  readonly code = "wakeflow-todo-item-id" as const;
  readonly reason = "format" as const;
  readonly path: string;

  constructor(path: string) {
    super("TODO item ID does not match its closed portable vocabulary.");
    this.path = path;
  }
}

const TODO_ITEM_ID_PATTERN = new RegExp(TODO_ITEM_ID_PATTERN_SOURCE, "u");

function normalizePath(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "$todoId";
}

/** 严格解析 opaque TODO ID，不执行字符串强制转换。 */
export function parseTodoItemId(
  value: unknown,
  errorPath?: string,
): TodoItemId {
  const path = normalizePath(errorPath);
  if (
    typeof value !== "string"
    || !value.isWellFormed()
    || value.normalize("NFC") !== value
    || !TODO_ITEM_ID_PATTERN.test(value)
  ) {
    throw new TodoItemIdError(path);
  }
  return value as TodoItemId;
}
