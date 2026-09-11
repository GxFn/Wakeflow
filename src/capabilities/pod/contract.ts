import {
  WAKEFLOW_POD_REQUEST_SCHEMA,
  type WakeflowPodRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-pod-request.generated.js";
import {
  WAKEFLOW_POD_RESULT_SCHEMA,
  type WakeflowPodResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-pod-result.generated.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { fail } from "../../kernel/error.js";
import type { WakeflowToolRegistration } from "../../kernel/tool-registry.js";

/**
 * Wakeflow Capabilities / Pod：`wakeflow_pod` 的公共合同（ADR-0010 D6，gate-log §13.91）。
 *
 * 一个效果型工具：preview 零写推导创建或关闭计划，apply 用同一意图重算计划并在摘要相符时
 * 执行一次配置事务，recover 凭 podId 对账回执。请求与结果都由生成的 wire Schema 闭合。
 */

export const WAKEFLOW_POD_PUBLIC_TOOL_NAME = "wakeflow_pod" as const;
export const WAKEFLOW_POD_PUBLIC_SCHEMA_VERSION = 1 as const;

export type PodRequest = Readonly<WakeflowPodRequestV1>;
export type PodResult = Readonly<WakeflowPodResultV1>;

const validateRequest = createRuntimeJsonSchemaValidator<WakeflowPodRequestV1>(
  WAKEFLOW_POD_REQUEST_SCHEMA,
);
const validateResult = createRuntimeJsonSchemaValidator<WakeflowPodResultV1>(
  WAKEFLOW_POD_RESULT_SCHEMA,
);

function requestJson(value: unknown): JsonValue {
  try {
    return parseJsonValue(value, "$request");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("invalid-request", "not-json", error.path);
    throw error;
  }
}

export function parsePodRequest(value: unknown): PodRequest {
  const result = validateRequest(requestJson(value));
  if (!result.ok) fail("invalid-request", "schema", `$request${result.path.slice(1)}`);
  return result.value;
}

export function admitPodResult(value: unknown): PodResult {
  const result = validateResult(parseJsonValue(value, "$result"));
  if (!result.ok) fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
  return result.value;
}

/** 本切片在公共工具登记表里的条目；目录只汇总。 */
export const POD_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_POD_PUBLIC_TOOL_NAME,
  slice: "pod",
  shape: "effect",
  executor: "managePod",
  title: "Manage Wakeflow Pod",
  description:
    "Create or close one worktree pod, the only execution-environment abstraction: preview derives the plan without writing, apply recomputes it from the same intent when the plan digest matches and runs one config transaction, recover reconciles receipts by podId. create derives the pod's window set (controller, design, test, one product window per repository) plus a worktree intent per repository; the Agent creates windows and worktrees by host means and registers them. close is two-phase: record branch dispositions once the pod's Demand is archived, then remove the pod after its windows are decommissioned and checkouts are gone.",
  requestSchema: WAKEFLOW_POD_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_POD_RESULT_SCHEMA,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const) satisfies Readonly<WakeflowToolRegistration>;
