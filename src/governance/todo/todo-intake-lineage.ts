import type {
  WakeflowTodoIntakeLineageReference as TodoIntakeLineageWire,
} from "../../contracts/generated/governance/todo/todo-intake-lineage.generated.js";
import {
  WAKEFLOW_TODO_INTAKE_LINEAGE_SCHEMA,
} from "../../contracts/generated/governance/todo/todo-intake-lineage.generated.js";
import { WAKEFLOW_TODO_ITEM_ID_SCHEMA } from "../../contracts/generated/governance/todo/todo-item-id.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../foundation/schema/runtime-json-schema.js";
import {
  parseTodoItemId,
  TodoItemIdError,
  type TodoItemId,
} from "./todo-item-id.js";

/**
 * Wakeflow Governance / TODO：跨 Aggregate 使用的 immutable intake lineage。
 *
 * 本引用只绑定 TODO ID、intake portable ref 和 semantic digest；它不引用 Markdown
 * board、row 文本或当前 TODO state。Demand publication 必须重新解析该引用并由
 * TODO owner 验证当前 exact intake/state claim expectation。
 */

export const TODO_INTAKE_LINEAGE_ARTIFACT_KIND =
  "wakeflow-todo-intake-lineage" as const;
export const TODO_INTAKE_LINEAGE_SCHEMA_VERSION = 1 as const;

export interface TodoIntakeLineageReference {
  readonly artifactKind: typeof TODO_INTAKE_LINEAGE_ARTIFACT_KIND;
  readonly schemaVersion: typeof TODO_INTAKE_LINEAGE_SCHEMA_VERSION;
  readonly todoId: TodoItemId;
  readonly intakeRef: PortableResourcePath;
  readonly intakeDigest: Sha256Digest;
}

export type TodoIntakeLineageErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "path"
  | "digest";

const ERROR_MESSAGES = {
  "json": "TODO intake lineage is not passive JSON data.",
  "schema": "TODO intake lineage does not satisfy its portable Schema.",
  "identifier": "TODO intake lineage contains an invalid TODO identity.",
  "path": "TODO intake lineage contains an invalid intake reference.",
  "digest": "TODO intake lineage contains an invalid digest.",
} as const satisfies Readonly<Record<TodoIntakeLineageErrorReason, string>>;

export class TodoIntakeLineageError extends Error {
  override readonly name = "TodoIntakeLineageError";
  readonly code = "wakeflow-todo-intake-lineage" as const;
  readonly reason: TodoIntakeLineageErrorReason;
  readonly path: string;

  constructor(reason: TodoIntakeLineageErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<TodoIntakeLineageWire>(
  WAKEFLOW_TODO_INTAKE_LINEAGE_SCHEMA,
  [
    WAKEFLOW_TODO_ITEM_ID_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
  ],
);

function fail(reason: TodoIntakeLineageErrorReason, path: string): never {
  throw new TodoIntakeLineageError(reason, path);
}

/** 解析一个不含 Markdown row 语义的关闭 lineage reference。 */
export function parseTodoIntakeLineageReference(
  value: unknown,
): Readonly<TodoIntakeLineageReference> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$lineage");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  let todoId: TodoItemId;
  try {
    todoId = parseTodoItemId(result.value.todoId, "$/todoId");
  } catch (error: unknown) {
    if (error instanceof TodoItemIdError) fail("identifier", "$/todoId");
    throw error;
  }
  let intakeRef: PortableResourcePath;
  try {
    intakeRef = parsePortableResourcePath(
      result.value.intakeRef,
      "$/intakeRef",
    );
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("path", "$/intakeRef");
    throw error;
  }
  let intakeDigest: Sha256Digest;
  try {
    intakeDigest = parseSha256Digest(
      result.value.intakeDigest,
      "$/intakeDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", "$/intakeDigest");
    throw error;
  }
  return Object.freeze({
    artifactKind: TODO_INTAKE_LINEAGE_ARTIFACT_KIND,
    schemaVersion: TODO_INTAKE_LINEAGE_SCHEMA_VERSION,
    todoId,
    intakeRef,
    intakeDigest,
  });
}
