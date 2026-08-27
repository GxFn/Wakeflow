/** TODO 集合公共操作使用的稳定失败词汇。 */
export type TodoCollectionServiceErrorReason =
  | "input"
  | "not-initialized"
  | "recovery-required"
  | "duplicate"
  | "not-found"
  | "cas-mismatch"
  | "transition"
  | "authorization"
  | "capacity"
  | "transaction-conflict"
  | "projection-unsafe"
  | "lock-timeout"
  | "lock-unsafe"
  | "write-failure"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  "input": "TODO collection operation input is invalid.",
  "not-initialized": "TODO collection has not been initialized.",
  "recovery-required": "TODO collection requires transaction recovery.",
  "duplicate": "TODO collection already contains this TODO ID.",
  "not-found": "TODO collection item does not exist.",
  "cas-mismatch": "TODO collection expectation no longer matches authority.",
  "transition": "TODO item cannot perform this state transition.",
  "authorization": "TODO item archive authorization does not match authority.",
  "capacity": "TODO collection exceeds a bounded storage capacity.",
  "transaction-conflict": "TODO transaction physical state conflicts with its immutable plan.",
  "projection-unsafe": "TODO board projection target is physically unsafe.",
  "lock-timeout": "TODO collection lock could not be acquired in time.",
  "lock-unsafe": "TODO collection lock path or record is physically unsafe.",
  "write-failure": "TODO collection mutation could not be published safely.",
  "aborted": "TODO collection operation was aborted.",
  "operation-failure": "TODO collection operation failed closed.",
} as const satisfies Readonly<Record<TodoCollectionServiceErrorReason, string>>;

/** TODO 集合变更或恢复失败时返回的稳定、脱敏错误。 */
export class TodoCollectionServiceError extends Error {
  override readonly name = "TodoCollectionServiceError";
  readonly code = "wakeflow-todo-collection-service" as const;
  readonly reason: TodoCollectionServiceErrorReason;
  readonly path: string;

  constructor(reason: TodoCollectionServiceErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}
