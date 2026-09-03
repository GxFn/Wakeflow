import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";

/**
 * Wakeflow Governance / TODO：TODO 持久类型化身份的领域窄边界。
 *
 * TODO ID 使用共享 `todo_<UUIDv4>` durable kind；本模块只把通用词法错误映射为TODO
 * 领域错误，便于路径、Intake与Collection保持稳定错误面。它不分配身份、不判断条目
 * 是否存在，也不维护第二份正则或品牌类型。
 */

export type TodoItemId = WakeflowDurableId<"todo">;

/** TODO item ID 词法失败的稳定、脱敏错误。 */
export class TodoItemIdError extends Error {
  override readonly name = "TodoItemIdError";
  readonly code = "wakeflow-todo-item-id" as const;
  readonly reason = "format" as const;
  readonly path: string;

  constructor(path: string) {
    super("TODO item ID is not a canonical Wakeflow todo durable ID.");
    this.path = path;
  }
}

function normalizePath(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "$todoId";
}

/** 严格解析共享 durable `todo` kind，不执行字符串强制转换。 */
export function parseTodoItemId(
  value: unknown,
  errorPath?: string,
): TodoItemId {
  const path = normalizePath(errorPath);
  try {
    return parseWakeflowDurableIdOfKind(value, "todo", path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      throw new TodoItemIdError(path);
    }
    throw error;
  }
}
