import {
  WAKEFLOW_TODO_INSPECTION_RESULT_SCHEMA,
  type WakeflowTodoInspectionResultV1 as TodoInspectionResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-todo-inspection-result.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  inspectTodoItems,
} from "./todo-collection-service.js";
import { TodoCollectionServiceError } from "./todo-collection-service-error.js";
import {
  executeTodoInspectionQuery,
  TodoInspectionQueryError,
} from "./todo-inspection-query.js";
import {
  parseTodoInspectionPublicRequest,
  TodoInspectionPublicContractError,
  WAKEFLOW_TODO_INSPECTION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME,
  type TodoInspectionPublicResult,
} from "./todo-inspection-public-contract.js";

/**
 * Wakeflow Governance / TODO：公共Inspection的根生命周期、Authority组合与脱敏边界。
 *
 * Coordinator只把现有Collection Service的严格JSON Authority快照交给纯Query，再投影
 * 为自包含wire结果。它不读取Markdown Board作为事实、不取得mutation锁、不修复投影，
 * 也不把list/item结果升级为eligible、next、claim或其他写入许可。
 */

export interface TodoInspectionPublicCoordinatorOptions {
  readonly signal?: AbortSignal;
}

export type TodoInspectionPublicCoordinatorErrorReason =
  | "root"
  | "inspection"
  | "output";

const ERROR_MESSAGES = {
  root: "TODO inspection public workspace root is invalid.",
  inspection: "TODO inspection public authority query failed.",
  output: "TODO inspection public result violated its redacted boundary.",
} as const satisfies Readonly<Record<
  TodoInspectionPublicCoordinatorErrorReason,
  string
>>;

/** 公共TODO查询无法证明根、Authority或最小披露结果时的稳定错误。 */
export class TodoInspectionPublicCoordinatorError extends Error {
  override readonly name = "TodoInspectionPublicCoordinatorError";
  readonly code = "wakeflow-todo-inspection-public-coordinator" as const;
  readonly reason: TodoInspectionPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: TodoInspectionPublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

const TODO_INSPECTION_PUBLIC_MAXIMUM_RESULT_BYTES = 8 * 1024 * 1024;
const validateResult =
  createRuntimeJsonSchemaValidator<TodoInspectionResultWire>(
    WAKEFLOW_TODO_INSPECTION_RESULT_SCHEMA,
  );

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined
    && Object.hasOwn(descriptor, "value")
    && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: TodoInspectionPublicCoordinatorErrorReason,
  cause?: unknown,
): never {
  throw new TodoInspectionPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function containsPrivateText(
  value: JsonValue,
  privateValues: ReadonlySet<string>,
): boolean {
  if (typeof value === "string") {
    return [...privateValues].some((privateValue) =>
      value.includes(privateValue));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) =>
    containsPrivateText(entry, privateValues));
}

function publicResult(
  value: unknown,
  privateValues: ReadonlySet<string>,
): TodoInspectionPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("output", error);
    throw error;
  }
  if (
    encodeCanonicalJson(json, "$result").byteLength
      > TODO_INSPECTION_PUBLIC_MAXIMUM_RESULT_BYTES
    || containsPrivateText(json, privateValues)
    || !validateResult(json).ok
  ) {
    fail("output");
  }
  return json as unknown as TodoInspectionPublicResult;
}

/** 执行一次零写、完整Authority读取和有界TODO查询。 */
export async function executeTodoInspectionPublicRequest(
  value: unknown,
  options: TodoInspectionPublicCoordinatorOptions = {},
): Promise<TodoInspectionPublicResult> {
  const request = parseTodoInspectionPublicRequest(value);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
  const privateValues = new Set(
    [request.root, root.absolutePath].filter((entry) => entry.length > 1),
  );
  let result: TodoInspectionPublicResult | undefined;
  let failure: unknown;
  try {
    try {
      const snapshot = await inspectTodoItems(root, options.signal);
      const inspection = executeTodoInspectionQuery(
        snapshot.collection,
        request.query,
      );
      result = publicResult({
        ...inspection,
        tool: WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME,
        status: "current",
        schemaVersion: WAKEFLOW_TODO_INSPECTION_PUBLIC_SCHEMA_VERSION,
      }, privateValues);
    } catch (error: unknown) {
      if (
        error instanceof TodoCollectionServiceError
        || error instanceof TodoInspectionQueryError
      ) {
        fail("inspection", error);
      }
      throw error;
    }
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = error instanceof RootedDirectoryError
        ? new TodoInspectionPublicCoordinatorError(
            "root",
            error.code,
            error.reason,
          )
        : error;
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("output");
  return result;
}

export { TodoInspectionPublicContractError };
