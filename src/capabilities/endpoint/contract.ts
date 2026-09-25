import {
  WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA,
  type WakeflowWindowHostBindingRegistrationRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-window-host-binding-registration-request.generated.js";
import {
  WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA,
  type WakeflowWindowHostBindingRegistrationResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-window-host-binding-registration-result.generated.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { fail } from "../../kernel/error.js";
import type { WakeflowToolRegistration } from "../../kernel/tool-registry.js";

/**
 * Wakeflow Capabilities / Endpoint：`wakeflow_register_window_binding` 的公共合同（能力卡 2）。
 *
 * 一个工具五种操作：inspect、register、replace、decommission、release-claim。请求与
 * 结果都由 wire Schema 准入；原始句柄、tmux 坐标与工作区路径永不出现在结果里。
 */

export const WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME =
  "wakeflow_register_window_binding" as const;
export const WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_SCHEMA_VERSION = 1 as const;

export type WindowBindingRequest = Readonly<WakeflowWindowHostBindingRegistrationRequestV1>;
export type WindowBindingResult = Readonly<WakeflowWindowHostBindingRegistrationResultV1>;
export type WindowBindingOperation = WindowBindingRequest["operation"];

const validateRequest =
  createRuntimeJsonSchemaValidator<WakeflowWindowHostBindingRegistrationRequestV1>(
    WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA,
  );
const validateResult =
  createRuntimeJsonSchemaValidator<WakeflowWindowHostBindingRegistrationResultV1>(
    WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA,
  );

export function parseWindowBindingRequest(value: unknown): WindowBindingRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("invalid-request", "not-json", error.path);
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("invalid-request", "schema", `$request${result.path.slice(1)}`);
  return result.value;
}

export function admitWindowBindingResult(value: unknown): WindowBindingResult {
  const result = validateResult(parseJsonValue(value, "$result"));
  if (!result.ok) fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
  return result.value;
}

/** 本切片在公共工具登记表里的条目；目录只汇总，不重复描述。 */
export const WINDOW_BINDING_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
  slice: "endpoint",
  shape: "append",
  executor: "registerWindowHostBinding",
  title: "Register Wakeflow Window Binding",
  description:
    "Manage one logical window's execution endpoint. inspect returns the recomputed launch intent with binding, claim and locator state; register binds the observed handle (a SessionStart hook record is required; Claude Code also supplies tmux coordinates); replace binds a new handle with CAS on the old binding; relocate keeps the binding and records a resumed session's new tmux pane; decommission retires the window with pre-close, close-result and post-close evidence; release-claim force-releases an expired or orphaned work claim. Wakeflow never creates, inspects, or closes host windows; raw handles never leave the private binding file.",
  requestSchema: WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const) satisfies Readonly<WakeflowToolRegistration>;
