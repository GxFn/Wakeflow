import {
  WAKEFLOW_TODO_INTAKE_PUBLICATION_REQUEST_SCHEMA,
  type WakeflowTodoIntakePublicationRequestV1 as TodoIntakeRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-todo-intake-publication-request.generated.js";
import type {
  WakeflowTodoIntakePublicationResultV1 as TodoIntakeResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-todo-intake-publication-result.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseTodoIntakePublicationInput,
  TodoIntakePublicationInputError,
  type TodoIntakePublicationInput,
} from "./todo-intake-publication-input.js";
import {
  parseTodoIntakePublicationPlan,
  TodoIntakePublicationPlanError,
  type TodoIntakePublicationPlan,
} from "./todo-intake-publication-plan.js";

/** Wakeflow Governance / TODO：Public Intake三模式wire准入。 */

export const WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME =
  "wakeflow_intake_todo" as const;
export const WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_SCHEMA_VERSION = 1 as const;
const TODO_INTAKE_PUBLICATION_PUBLIC_MAXIMUM_REQUEST_BYTES = 2 * 1024 * 1024;

export type TodoIntakePublicationPublicRequest =
  | Readonly<{
      readonly root: string;
      readonly mode: "preview";
      readonly intake: Readonly<TodoIntakePublicationInput>;
    }>
  | Readonly<{
      readonly root: string;
      readonly mode: "apply" | "recover";
      readonly plan: Readonly<TodoIntakePublicationPlan>;
      readonly planDigest: string;
    }>;

export type TodoIntakePublicationPublicResult =
  Readonly<TodoIntakeResultWire>;

export type TodoIntakePublicationPublicContractErrorReason =
  | "json"
  | "capacity"
  | "schema"
  | "input"
  | "plan";

const ERROR_MESSAGES = {
  json: "TODO intake publication public request is not passive JSON data.",
  capacity: "TODO intake publication public request exceeds its capacity.",
  schema: "TODO intake publication public request does not satisfy its Schema.",
  input: "TODO intake publication public preview input is invalid.",
  plan: "TODO intake publication public request does not contain a valid Plan.",
} as const satisfies Readonly<Record<
  TodoIntakePublicationPublicContractErrorReason,
  string
>>;

/** Public Intake request不能形成有界、关闭且领域有效的wire值时的稳定错误。 */
export class TodoIntakePublicationPublicContractError extends Error {
  override readonly name = "TodoIntakePublicationPublicContractError";
  readonly code = "wakeflow-todo-intake-publication-public-contract" as const;
  readonly reason: TodoIntakePublicationPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: TodoIntakePublicationPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest = createRuntimeJsonSchemaValidator<TodoIntakeRequestWire>(
  WAKEFLOW_TODO_INTAKE_PUBLICATION_REQUEST_SCHEMA,
);

function fail(
  reason: TodoIntakePublicationPublicContractErrorReason,
  path: string,
): never {
  throw new TodoIntakePublicationPublicContractError(reason, path);
}

/** SDK校验后重新建立递归冻结的author input或exact Plan。 */
export function parseTodoIntakePublicationPublicRequest(
  value: unknown,
): Readonly<TodoIntakePublicationPublicRequest> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength
        > TODO_INTAKE_PUBLICATION_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof TodoIntakePublicationPublicContractError) throw error;
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  if (result.value.mode === "preview") {
    try {
      return Object.freeze({
        root: result.value.root,
        mode: "preview" as const,
        intake: parseTodoIntakePublicationInput(result.value.intake),
      });
    } catch (error: unknown) {
      if (error instanceof TodoIntakePublicationInputError) {
        fail("input", error.path);
      }
      throw error;
    }
  }
  try {
    return Object.freeze({
      root: result.value.root,
      mode: result.value.mode,
      plan: parseTodoIntakePublicationPlan(result.value.plan),
      planDigest: result.value.planDigest,
    });
  } catch (error: unknown) {
    if (error instanceof TodoIntakePublicationPlanError) {
      fail("plan", error.path);
    }
    throw error;
  }
}
