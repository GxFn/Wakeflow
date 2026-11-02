import { WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-window-host-binding-registration-request.generated.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-window-host-binding-registration-result.generated.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { fail } from "../../kernel/error.js";
/**
 * Wakeflow Capabilities / Endpoint：`wakeflow_register_window_binding` 的公共合同（能力卡 2）。
 *
 * 一个工具六种操作：inspect、register、replace、relocate、decommission、release-claim。请求与
 * 结果都由 wire Schema 准入；原始句柄、tmux 坐标、桌面会话 id 与工作区路径永不出现在结果里。
 */
export const WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME = "wakeflow_register_window_binding";
export const WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_SCHEMA_VERSION = 1;
const validateRequest = createRuntimeJsonSchemaValidator(WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA);
/**
 * 每种操作各一个校验器（open-items W39）：顶层 oneOf 不匹配时 Ajv 报的是第一个分支（inspect）的
 * 错误——replace 缺 expectedBindingId 被报成 `additional:observation`。请求点名了一个已知操作时
 * 改用那个分支重校，拒绝码就是该操作自己缺的或多的字段（`required:expectedBindingId`）。
 */
const OPERATION_REQUEST_DEFINITIONS = Object.freeze({
    inspect: "inspectRequest",
    register: "registerRequest",
    replace: "replaceRequest",
    relocate: "relocateRequest",
    decommission: "decommissionRequest",
    "release-claim": "releaseClaimRequest",
});
const validateOperationRequest = new Map(Object.entries(OPERATION_REQUEST_DEFINITIONS).map(([operation, definition]) => {
    const { oneOf: _branches, ...schema } = WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA;
    return [
        operation,
        createRuntimeJsonSchemaValidator({
            ...schema,
            $ref: `#/$defs/${definition}`,
        }),
    ];
}));
const validateResult = createRuntimeJsonSchemaValidator(WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA);
export function parseWindowBindingRequest(value) {
    let json;
    try {
        json = parseJsonValue(value, "$request");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("invalid-request", "not-json", error.path);
        throw error;
    }
    const result = validateRequest(json);
    if (result.ok)
        return result.value;
    const operation = json !== null && typeof json === "object" && !Array.isArray(json)
        ? json.operation
        : undefined;
    const branch = typeof operation === "string" ? validateOperationRequest.get(operation) : undefined;
    const branched = branch?.(json);
    // 分支互斥（operation 是 const），所以分支通过而 oneOf 不通过不会发生；真发生了就报原来的错。
    const refusal = branched === undefined || branched.ok ? result : branched;
    fail("invalid-request", "schema", `$request${refusal.path.slice(1)}`, {
        details: { schema: refusal.detail },
    });
}
export function admitWindowBindingResult(value) {
    const result = validateResult(parseJsonValue(value, "$result"));
    if (!result.ok)
        fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
    return result.value;
}
/** 本切片在公共工具登记表里的条目；目录只汇总，不重复描述。 */
export const WINDOW_BINDING_TOOL_REGISTRATION = Object.freeze({
    name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    slice: "endpoint",
    shape: "append",
    executor: "registerWindowHostBinding",
    title: "Register Wakeflow Window Binding",
    description: "Manage one logical window's execution endpoint. inspect returns the recomputed launch intent with binding, claim and locator state; register binds the observed handle (a SessionStart hook record is required; Claude Code also supplies tmux coordinates or the desktop session id); replace binds a new handle with CAS on the old binding; relocate records a resumed session's new tmux pane; decommission retires the window with pre-close, close-result and post-close evidence; release-claim releases an expired or orphaned work claim. Wakeflow never creates, inspects, or closes host windows; raw handles never leave the private binding file.",
    requestSchema: WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA,
    annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
    },
});
