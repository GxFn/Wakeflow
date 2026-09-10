import {
  WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA,
  type WakeflowTargetTaskPlanningRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-target-task-planning-request.generated.js";
import {
  WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA,
  type WakeflowTargetTaskPlanningResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-target-task-planning-result.generated.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { fail } from "../../kernel/error.js";
import type { WakeflowToolRegistration } from "../../kernel/tool-registry.js";

/**
 * Wakeflow Capabilities / Tasking：任务规划的公共合同（能力卡 5，ADR-0012 D2 与 D5）。
 *
 * 一个工具：`wakeflow_plan_target_task`，追加型一次调用（幂等键加期望修订，结果带 `next`）。
 * 实现任务包的每个验收锚点引用需求包验收标准的一条；同仓库再来一个包必须声明谱系。
 */

export const WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME = "wakeflow_plan_target_task" as const;
export const WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_SCHEMA_VERSION = 1 as const;

export type TargetTaskPlanningRequest = Readonly<WakeflowTargetTaskPlanningRequestV1>;
export type TargetTaskPlanningResult = Readonly<WakeflowTargetTaskPlanningResultV1>;

const validateRequest = createRuntimeJsonSchemaValidator<WakeflowTargetTaskPlanningRequestV1>(
  WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA,
);
const validateResult = createRuntimeJsonSchemaValidator<WakeflowTargetTaskPlanningResultV1>(
  WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA,
);

function requestJson(value: unknown): JsonValue {
  try {
    return parseJsonValue(value, "$request");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("invalid-request", "not-json", error.path);
    throw error;
  }
}

export function parseTargetTaskPlanningRequest(value: unknown): TargetTaskPlanningRequest {
  const result = validateRequest(requestJson(value));
  if (!result.ok) fail("invalid-request", "schema", `$request${result.path.slice(1)}`);
  return result.value;
}

export function admitTargetTaskPlanningResult(value: unknown): TargetTaskPlanningResult {
  const result = validateResult(parseJsonValue(value, "$result"));
  if (!result.ok) fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
  return result.value;
}

/** 本切片在公共工具登记表里的条目；目录只汇总。 */
export const TARGET_TASK_PLANNING_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
  slice: "tasking",
  shape: "append",
  executor: "planTargetTask",
  title: "Plan Wakeflow Target Task",
  description:
    "Append one immutable task package to a Demand in one call with the observed stream revision and a client idempotency key: the same key and body replays the first result; a stale revision or a reused key with another body is rejected. Implementation packages bind each acceptance anchor to one acceptance-criteria item of the requirement package (requirementRef), declare lineage (replace an open target or continue an accepted one) when the repository already has a target, and echo the user's plan review when required; test packages carry only workType=test. Returns the event, projection receipt, and next frontier; never delivers.",
  requestSchema: WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const) satisfies Readonly<WakeflowToolRegistration>;
