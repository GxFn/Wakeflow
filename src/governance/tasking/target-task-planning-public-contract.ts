import type { WakeflowTargetTaskPlanningRequestV1 } from "../../contracts/generated/entrypoints/wakeflow-target-task-planning-request.generated.js";
import { WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA } from "../../contracts/generated/entrypoints/wakeflow-target-task-planning-request.generated.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { fail } from "../../kernel/error.js";

/**
 * Wakeflow Governance / Tasking：公共 Target Task Planning wire request（ADR-0012 D2 单次追加）。
 *
 * 请求只有一种形状：工作区根、Demand、客户端幂等键、观察到的流修订与任务包草稿。
 * Schema 校验失败以内核错误 `invalid-request` 报出，路径指向 Schema 里的位置。
 */

export const WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME =
  "wakeflow_plan_target_task" as const;
export const WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_SCHEMA_VERSION = 1 as const;

export type TargetTaskPlanningPublicRequest =
  Readonly<WakeflowTargetTaskPlanningRequestV1>;

const validateRequest =
  createRuntimeJsonSchemaValidator<WakeflowTargetTaskPlanningRequestV1>(
    WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA,
  );

/** MCP SDK 校验后仍由领域边界重新创建递归冻结的 request 快照。 */
export function parseTargetTaskPlanningPublicRequest(
  value: unknown,
): TargetTaskPlanningPublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("invalid-request", "not-json", error.path);
    }
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) {
    fail("invalid-request", "schema", `$request${result.path.slice(1)}`);
  }
  return result.value;
}
