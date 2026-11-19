import { WAKEFLOW_QUICK_DEMAND_REQUEST_SCHEMA, } from "../contracts/generated/entrypoints/wakeflow-quick-demand-request.generated.js";
import { WAKEFLOW_QUICK_DEMAND_RESULT_SCHEMA, } from "../contracts/generated/entrypoints/wakeflow-quick-demand-result.generated.js";
import { JsonValueError, parseJsonValue } from "../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../foundation/schema/runtime-json-schema.js";
import { fail } from "../kernel/error.js";
/**
 * Wakeflow Entrypoint / MCP：快速 Demand 的工具合同（ADR-0029 决定 9）——名字、登记项、请求的解析与结果的
 * 准入。只有数据与校验，不引用任何切片的执行代码：公共目录引用的是这一份，执行在
 * `wakeflow-public-mcp-quick-demand.ts`。
 */
export const WAKEFLOW_QUICK_DEMAND_PUBLIC_TOOL_NAME = "wakeflow_quick_demand";
export const QUICK_DEMAND_TOOL_REGISTRATION = Object.freeze({
    name: WAKEFLOW_QUICK_DEMAND_PUBLIC_TOOL_NAME,
    slice: "demand",
    shape: "effect",
    executor: "quickDemand",
    title: "Start A Quick Wakeflow Demand",
    description: "For a small change in one repository: turn the user's sentence into a Demand that is ready to deliver, with one confirmation. preview writes nothing and returns the generated two-document requirement package to read to the user; apply, with that planDigest and the time the user confirmed, publishes the package, claims it, plans one implementation target and prepares its delivery, and returns the delivery under `delivery` - send its permit as usual. Limits are structural: one repository, one implementation target, controller-only checking, the primary pod, an idle workspace. A step that refuses stops there (`stoppedAt`) and leaves state the ordinary tools continue from. Finish by accepting the result with `thenComplete`.",
    requestSchema: WAKEFLOW_QUICK_DEMAND_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_QUICK_DEMAND_RESULT_SCHEMA,
    // 与认领、完成这些带预览的效果工具同样的注解：同一份计划重放不产生第二份。
    annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
    },
});
const validateRequest = createRuntimeJsonSchemaValidator(WAKEFLOW_QUICK_DEMAND_REQUEST_SCHEMA);
const validateResult = createRuntimeJsonSchemaValidator(WAKEFLOW_QUICK_DEMAND_RESULT_SCHEMA);
export function parseQuickDemandRequest(value) {
    let json;
    try {
        json = parseJsonValue(value, "$request");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("invalid-request", "not-json", error.path);
        throw error;
    }
    const parsed = validateRequest(json);
    if (!parsed.ok) {
        fail("invalid-request", "schema", `$request${parsed.path.slice(1)}`, {
            details: { schema: parsed.detail },
        });
    }
    return parsed.value;
}
/** 结果按自己的 Schema 准入：组合出来的结果与切片产出的结果过同一道边界。 */
export function admitQuickDemandResult(value) {
    const result = validateResult(parseJsonValue(value, "$result"));
    if (!result.ok)
        fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
    return result.value;
}
