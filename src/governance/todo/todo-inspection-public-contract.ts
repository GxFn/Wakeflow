import {
  WAKEFLOW_TODO_INSPECTION_REQUEST_SCHEMA,
  type WakeflowTodoInspectionRequestV1 as TodoInspectionRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-todo-inspection-request.generated.js";
import type {
  WakeflowTodoInspectionResultV1 as TodoInspectionResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-todo-inspection-result.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseTodoInspectionQuery,
  TodoInspectionQueryError,
  type TodoInspectionQuery,
} from "./todo-inspection-query.js";

/** Wakeflow Governance / TODO：公共只读Inspection请求的wire与领域查询准入。 */

export const WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME =
  "wakeflow_inspect_todo" as const;
export const WAKEFLOW_TODO_INSPECTION_PUBLIC_SCHEMA_VERSION = 1 as const;
const TODO_INSPECTION_PUBLIC_MAXIMUM_REQUEST_BYTES = 128 * 1024;

export interface TodoInspectionPublicRequest {
  readonly root: string;
  readonly query: Readonly<TodoInspectionQuery>;
}

export type TodoInspectionPublicResult = Readonly<TodoInspectionResultWire>;

export type TodoInspectionPublicContractErrorReason =
  | "json"
  | "capacity"
  | "schema"
  | "query";

const ERROR_MESSAGES = {
  json: "TODO inspection public request is not passive JSON data.",
  capacity: "TODO inspection public request exceeds its capacity.",
  schema: "TODO inspection public request does not satisfy its Schema.",
  query: "TODO inspection public request does not form a valid domain query.",
} as const satisfies Readonly<Record<
  TodoInspectionPublicContractErrorReason,
  string
>>;

/** 公共TODO查询不能形成有界、关闭且领域有效的wire值时的稳定错误。 */
export class TodoInspectionPublicContractError extends Error {
  override readonly name = "TodoInspectionPublicContractError";
  readonly code = "wakeflow-todo-inspection-public-contract" as const;
  readonly reason: TodoInspectionPublicContractErrorReason;
  readonly path: string;

  constructor(reason: TodoInspectionPublicContractErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest =
  createRuntimeJsonSchemaValidator<TodoInspectionRequestWire>(
    WAKEFLOW_TODO_INSPECTION_REQUEST_SCHEMA,
  );

function fail(
  reason: TodoInspectionPublicContractErrorReason,
  path: string,
): never {
  throw new TodoInspectionPublicContractError(reason, path);
}

function queryValue(
  wire: Readonly<TodoInspectionRequestWire>,
): Readonly<Record<string, unknown>> {
  if (wire.view === "item") {
    return Object.freeze({ view: "item", todoId: wire.todoId });
  }
  return Object.freeze({
    view: "list",
    ...(wire.filter === undefined ? {} : { filter: wire.filter }),
    ...(wire.pageSize === undefined ? {} : { pageSize: wire.pageSize }),
    ...(wire.pageToken === undefined ? {} : { pageToken: wire.pageToken }),
  });
}

/** MCP SDK校验后重新建立递归冻结、typed且规范filter的查询快照。 */
export function parseTodoInspectionPublicRequest(
  value: unknown,
): Readonly<TodoInspectionPublicRequest> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength
        > TODO_INSPECTION_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof TodoInspectionPublicContractError) throw error;
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  let query: Readonly<TodoInspectionQuery>;
  try {
    query = parseTodoInspectionQuery(queryValue(result.value));
  } catch (error: unknown) {
    if (error instanceof TodoInspectionQueryError) {
      fail("query", error.path);
    }
    throw error;
  }
  return Object.freeze({ root: result.value.root, query });
}
