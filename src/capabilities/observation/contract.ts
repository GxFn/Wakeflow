import {
  WAKEFLOW_STATUS_REQUEST_SCHEMA,
  type WakeflowStatusRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-status-request.generated.js";
import {
  WAKEFLOW_STATUS_RESULT_SCHEMA,
  type WakeflowStatusResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-status-result.generated.js";
import {
  WAKEFLOW_VERIFY_REQUEST_SCHEMA,
  type WakeflowVerifyRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-verify-request.generated.js";
import {
  WAKEFLOW_VERIFY_RESULT_SCHEMA,
  type WakeflowVerifyResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-verify-result.generated.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  createRuntimeJsonSchemaValidator,
  type RuntimeJsonSchemaValidator,
} from "../../foundation/schema/runtime-json-schema.js";
import { fail } from "../../kernel/error.js";
import type { WakeflowToolRegistration } from "../../kernel/tool-registry.js";

/**
 * Wakeflow Capabilities / Observation：只读面的公共合同（能力卡 9，gate-log §13.94）。
 *
 * 两个读工具：`wakeflow_status`（工作区定向；带 demandId 即附路由或归档回执）与
 * `wakeflow_verify`（严格校验：门集合、汇总与 `ok`；带 demandId 另评估该 Demand 的门）。
 * 观察不写；两个工具各自观察一次，投影由同一份观察派生。
 */

export const WAKEFLOW_STATUS_PUBLIC_TOOL_NAME = "wakeflow_status" as const;
export const WAKEFLOW_VERIFY_PUBLIC_TOOL_NAME = "wakeflow_verify" as const;
export const WAKEFLOW_OBSERVATION_PUBLIC_SCHEMA_VERSION = 1 as const;

export type StatusRequest = Readonly<WakeflowStatusRequestV1>;
export type StatusResult = Readonly<WakeflowStatusResultV1>;
export type VerifyRequest = Readonly<WakeflowVerifyRequestV1>;
export type VerifyResult = Readonly<WakeflowVerifyResultV1>;

function requestJson(value: unknown): JsonValue {
  try {
    return parseJsonValue(value, "$request");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("invalid-request", "not-json", error.path);
    throw error;
  }
}

function requestParser<Request>(
  validate: RuntimeJsonSchemaValidator<Request>,
): (value: unknown) => Readonly<Request> {
  return (value) => {
    const result = validate(requestJson(value));
    if (!result.ok) fail("invalid-request", "schema", `$request${result.path.slice(1)}`);
    return result.value;
  };
}

function resultAdmitter<Result>(
  validate: RuntimeJsonSchemaValidator<Result>,
): (value: unknown) => Readonly<Result> {
  return (value) => {
    const result = validate(parseJsonValue(value, "$result"));
    if (!result.ok) fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
    return result.value;
  };
}

export const parseStatusRequest = requestParser(
  createRuntimeJsonSchemaValidator<WakeflowStatusRequestV1>(WAKEFLOW_STATUS_REQUEST_SCHEMA),
);
export const admitStatusResult = resultAdmitter(
  createRuntimeJsonSchemaValidator<WakeflowStatusResultV1>(WAKEFLOW_STATUS_RESULT_SCHEMA),
);
export const parseVerifyRequest = requestParser(
  createRuntimeJsonSchemaValidator<WakeflowVerifyRequestV1>(WAKEFLOW_VERIFY_REQUEST_SCHEMA),
);
export const admitVerifyResult = resultAdmitter(
  createRuntimeJsonSchemaValidator<WakeflowVerifyResultV1>(WAKEFLOW_VERIFY_RESULT_SCHEMA),
);

const READ_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** 本切片在公共工具登记表里的两个条目；目录只汇总。 */
export const STATUS_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME,
  slice: "observation",
  shape: "read",
  executor: "inspectStatus",
  title: "Wakeflow Status",
  description:
    "Read the workspace orientation from one observation: overall state, config summary, requirement board counts with pending packages, active Demands with their route disposition and frontier, windows with identity and work claims, pods with execution location, repository pointer facts, host hook channels, accepted results whose branch still exists, projection freshness, effective policy thresholds, and the next actions. Pass demandId to attach that Demand's controller route (or its archive receipt). Reads only.",
  requestSchema: WAKEFLOW_STATUS_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_STATUS_RESULT_SCHEMA,
  annotations: READ_ANNOTATIONS,
} as const) satisfies Readonly<WakeflowToolRegistration>;

export const VERIFY_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_VERIFY_PUBLIC_TOOL_NAME,
  slice: "observation",
  shape: "read",
  executor: "verifyWorkspace",
  title: "Verify Wakeflow Workspace",
  description:
    "Strictly verify the workspace without repairing anything: thirteen gates (config authority, local and ledger layout, board consistency, Demand root audit, work claims, append candidates, evidence integrity, host hook channel, window identity, pod execution location, host settings assets, active projection) each pass, fail, or unavailable; ok requires every gate to pass and unavailable counts separately from fail. Pass demandId to also evaluate that Demand's own gates. Reads only; repairsApplied is always false.",
  requestSchema: WAKEFLOW_VERIFY_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_VERIFY_RESULT_SCHEMA,
  annotations: READ_ANNOTATIONS,
} as const) satisfies Readonly<WakeflowToolRegistration>;
