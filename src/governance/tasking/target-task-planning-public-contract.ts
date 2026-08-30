import type {
  WakeflowTargetTaskPlanningRequestV1 as TargetTaskPlanningPublicRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-task-planning-request.generated.js";
import {
  WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA,
} from "../../contracts/generated/entrypoints/wakeflow-target-task-planning-request.generated.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Tasking：公共 Target Task Planning wire request。 */

export const WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME =
  "wakeflow_plan_target_task" as const;
export const WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_SCHEMA_VERSION = 1 as const;

export type TargetTaskPlanningPublicPreviewRequest = Extract<
  TargetTaskPlanningPublicRequestWire,
  { readonly mode: "preview" }
>;
export type TargetTaskPlanningPublicApplyRequest = Extract<
  TargetTaskPlanningPublicRequestWire,
  { readonly mode: "apply" }
>;
export type TargetTaskPlanningPublicRequest =
  | Readonly<TargetTaskPlanningPublicPreviewRequest>
  | Readonly<TargetTaskPlanningPublicApplyRequest>;

export type TargetTaskPlanningPublicContractErrorReason =
  | "json"
  | "schema";

const ERROR_MESSAGES = {
  json: "Target Task Planning public request is not passive JSON data.",
  schema: "Target Task Planning public request does not satisfy its Schema.",
} as const satisfies Readonly<Record<
  TargetTaskPlanningPublicContractErrorReason,
  string
>>;

export class TargetTaskPlanningPublicContractError extends Error {
  override readonly name = "TargetTaskPlanningPublicContractError";
  readonly code = "wakeflow-target-task-planning-public-contract" as const;
  readonly reason: TargetTaskPlanningPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: TargetTaskPlanningPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest =
  createRuntimeJsonSchemaValidator<TargetTaskPlanningPublicRequestWire>(
    WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA,
  );

function fail(
  reason: TargetTaskPlanningPublicContractErrorReason,
  path: string,
): never {
  throw new TargetTaskPlanningPublicContractError(reason, path);
}

/** MCP SDK 校验后仍由领域边界重新创建递归冻结的 request 快照。 */
export function parseTargetTaskPlanningPublicRequest(
  value: unknown,
): TargetTaskPlanningPublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  return result.value as TargetTaskPlanningPublicRequest;
}
