import type { WakeflowTodoTransaction as TodoTransactionWire } from "../../contracts/generated/governance/todo/todo-transaction.generated.js";
import { WAKEFLOW_TODO_TRANSACTION_SCHEMA } from "../../contracts/generated/governance/todo/todo-transaction.generated.js";
import { WAKEFLOW_TODO_INTAKE_SCHEMA } from "../../contracts/generated/governance/todo/todo-intake.generated.js";
import { WAKEFLOW_TODO_STATE_SCHEMA } from "../../contracts/generated/governance/todo/todo-state.generated.js";
import { WAKEFLOW_TODO_ITEM_ID_SCHEMA } from "../../contracts/generated/governance/todo/todo-item-id.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import {
  computeTodoIntakeDigest,
  parseTodoIntake,
  type TodoIntake,
} from "./todo-intake.js";
import {
  parseTodoItemId,
  TodoItemIdError,
  type TodoItemId,
} from "./todo-item-id.js";
import {
  computeTodoStateDigest,
  parseTodoState,
  type TodoState,
} from "./todo-state.js";

/**
 * Wakeflow Governance / TODO：追加、领取与归档操作的不可变恢复计划编解码器。
 *
 * 恢复意图同时绑定预期集合、目标集合、接收记录和状态语义摘要，并保存完整的目标
 * 状态；追加操作还会保存不可变的目标接收记录。它不保存可变阶段、不执行文件系统
 * 副作用，也不决定恢复意图何时可以退休。
 */

export const TODO_TRANSACTION_ARTIFACT_KIND =
  "wakeflow-todo-transaction" as const;
export const TODO_TRANSACTION_SCHEMA_VERSION = 1 as const;

export type TodoTransactionOperation = "append" | "claim" | "archive";

export interface TodoTransaction {
  readonly artifactKind: typeof TODO_TRANSACTION_ARTIFACT_KIND;
  readonly schemaVersion: typeof TODO_TRANSACTION_SCHEMA_VERSION;
  readonly todoId: TodoItemId;
  readonly operation: TodoTransactionOperation;
  readonly createdAt: UtcInstant;
  readonly expectedCollectionDigest: Sha256Digest;
  readonly expectedIntakeDigest: Sha256Digest | null;
  readonly expectedStateDigest: Sha256Digest | null;
  readonly targetIntake: Readonly<TodoIntake> | null;
  readonly targetState: Readonly<TodoState>;
  readonly targetIntakeDigest: Sha256Digest;
  readonly targetStateDigest: Sha256Digest;
  readonly targetCollectionDigest: Sha256Digest;
}

export type TodoTransactionErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "time"
  | "operation"
  | "target"
  | "representation";

const ERROR_MESSAGES = {
  "json": "TODO transaction is not passive JSON data.",
  "schema": "TODO transaction does not satisfy its portable Schema.",
  "identifier": "TODO transaction contains an invalid item identity.",
  "digest": "TODO transaction contains an invalid digest.",
  "time": "TODO transaction contains an invalid UTC instant.",
  "operation": "TODO transaction operation matrix is inconsistent.",
  "target": "TODO transaction target facts are inconsistent.",
  "representation": "TODO transaction bytes are not its deterministic domain representation.",
} as const satisfies Readonly<Record<TodoTransactionErrorReason, string>>;

/** TODO 事务计划准入或关系验证失败时返回的稳定、脱敏错误。 */
export class TodoTransactionError extends Error {
  override readonly name = "TodoTransactionError";
  readonly code = "wakeflow-todo-transaction" as const;
  readonly reason: TodoTransactionErrorReason;
  readonly path: string;

  constructor(reason: TodoTransactionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWireTransaction =
  createRuntimeJsonSchemaValidator<TodoTransactionWire>(
    WAKEFLOW_TODO_TRANSACTION_SCHEMA,
    [
      WAKEFLOW_TODO_INTAKE_SCHEMA,
      WAKEFLOW_TODO_STATE_SCHEMA,
      WAKEFLOW_TODO_ITEM_ID_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    ],
  );

function fail(reason: TodoTransactionErrorReason, path: string): never {
  throw new TodoTransactionError(reason, path);
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function parseTime(value: unknown): UtcInstant {
  try {
    return parseUtcInstant(value, "$/createdAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/createdAt");
    throw error;
  }
}

function assertTransactionRelations(
  transaction: Readonly<TodoTransaction>,
): void {
  if (
    transaction.targetState.todoId !== transaction.todoId
    || transaction.targetStateDigest
      !== computeTodoStateDigest(transaction.targetState)
    || transaction.targetCollectionDigest === transaction.expectedCollectionDigest
    || transaction.targetState.updatedAt !== transaction.createdAt
  ) {
    fail("target", "$target");
  }

  if (transaction.operation === "append") {
    if (
      transaction.expectedIntakeDigest !== null
      || transaction.expectedStateDigest !== null
      || transaction.targetIntake === null
      || transaction.targetIntake.todoId !== transaction.todoId
      || transaction.targetIntakeDigest
        !== computeTodoIntakeDigest(transaction.targetIntake)
      || transaction.targetState.revision !== 1
      || transaction.targetState.previousStateDigest !== null
      || transaction.targetState.status !== transaction.targetIntake.initialStatus
      || transaction.targetIntake.createdAt !== transaction.createdAt
    ) {
      fail("operation", "$/operation");
    }
    return;
  }

  if (
    transaction.expectedIntakeDigest === null
    || transaction.expectedStateDigest === null
    || transaction.targetIntake !== null
    || transaction.targetIntakeDigest !== transaction.expectedIntakeDigest
    || transaction.targetState.previousStateDigest
      !== transaction.expectedStateDigest
  ) {
    fail("operation", "$/operation");
  }
  if (
    (transaction.operation === "claim"
      && transaction.targetState.status !== "claimed")
    || (transaction.operation === "archive"
      && transaction.targetState.status !== "archived")
  ) {
    fail("operation", "$/targetState/status");
  }
}

function normalizeWire(
  wire: Readonly<TodoTransactionWire>,
): Readonly<TodoTransaction> {
  let todoId: TodoItemId;
  try {
    todoId = parseTodoItemId(wire.todoId, "$/todoId");
  } catch (error: unknown) {
    if (error instanceof TodoItemIdError) fail("identifier", "$/todoId");
    throw error;
  }
  const transaction = Object.freeze({
    artifactKind: TODO_TRANSACTION_ARTIFACT_KIND,
    schemaVersion: TODO_TRANSACTION_SCHEMA_VERSION,
    todoId,
    operation: wire.operation,
    createdAt: parseTime(wire.createdAt),
    expectedCollectionDigest: parseDigest(
      wire.expectedCollectionDigest,
      "$/expectedCollectionDigest",
    ),
    expectedIntakeDigest: wire.expectedIntakeDigest === null
      ? null
      : parseDigest(wire.expectedIntakeDigest, "$/expectedIntakeDigest"),
    expectedStateDigest: wire.expectedStateDigest === null
      ? null
      : parseDigest(wire.expectedStateDigest, "$/expectedStateDigest"),
    targetIntake: wire.targetIntake === null
      ? null
      : parseTodoIntake(wire.targetIntake),
    targetState: parseTodoState(wire.targetState),
    targetIntakeDigest: parseDigest(
      wire.targetIntakeDigest,
      "$/targetIntakeDigest",
    ),
    targetStateDigest: parseDigest(
      wire.targetStateDigest,
      "$/targetStateDigest",
    ),
    targetCollectionDigest: parseDigest(
      wire.targetCollectionDigest,
      "$/targetCollectionDigest",
    ),
  });
  assertTransactionRelations(transaction);
  return transaction;
}

/** 把任意内存值解析为不可变 TODO 事务计划。 */
export function parseTodoTransaction(value: unknown): Readonly<TodoTransaction> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$transaction");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateWireTransaction(json);
  if (!result.ok) fail("schema", result.path);
  return normalizeWire(result.value);
}

export function renderTodoTransaction(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseTodoTransaction(value),
    "$transaction",
  );
}

export function parseTodoTransactionDocument(
  text: unknown,
): Readonly<TodoTransaction> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$transaction");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path);
    }
    throw error;
  }
  const transaction = parseTodoTransaction(json);
  if (renderTodoTransaction(transaction) !== text) {
    fail("representation", "$transaction");
  }
  return transaction;
}

export function computeTodoTransactionDigest(value: unknown): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseTodoTransaction(value) as unknown as JsonValue,
  );
}
