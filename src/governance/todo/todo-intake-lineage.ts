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
import { todoIntakeRef } from "./todo-paths.js";

/**
 * Wakeflow Governance / TODO：供跨聚合使用的不可变 Intake 来源引用。
 *
 * 本引用只绑定 TODO ID、接收记录的可移植引用和语义摘要；它不引用 Markdown 看板、行文本
 * 或当前 TODO 状态。Demand 发布流程必须重新解析该引用，并由 TODO 职责所有者验证
 * 当前接收记录、状态和领取操作的精确预期。
 */

const TODO_INTAKE_LINEAGE_ARTIFACT_KIND =
  "wakeflow-todo-intake-lineage" as const;
const TODO_INTAKE_LINEAGE_SCHEMA_VERSION = 1 as const;

export interface TodoIntakeLineageReference {
  readonly artifactKind: typeof TODO_INTAKE_LINEAGE_ARTIFACT_KIND;
  readonly schemaVersion: typeof TODO_INTAKE_LINEAGE_SCHEMA_VERSION;
  readonly todoId: TodoItemId;
  readonly intakeRef: PortableResourcePath;
  readonly intakeDigest: Sha256Digest;
}

type TodoIntakeLineageErrorReason =
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

/** 解析字段关系严格受限，且不含 Markdown 行语义的来源引用。 */
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
  if (intakeRef !== todoIntakeRef(todoId)) fail("path", "$/intakeRef");
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
