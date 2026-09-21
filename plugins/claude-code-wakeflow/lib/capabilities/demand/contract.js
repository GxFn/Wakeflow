import { WAKEFLOW_DEMAND_CANCELLATION_REQUEST_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-demand-cancellation-request.generated.js";
import { WAKEFLOW_DEMAND_CANCELLATION_RESULT_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-demand-cancellation-result.generated.js";
import { WAKEFLOW_DEMAND_COMPLETION_REQUEST_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-demand-completion-request.generated.js";
import { WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-demand-completion-result.generated.js";
import { WAKEFLOW_DEMAND_CONTINUATION_REQUEST_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-demand-continuation-request.generated.js";
import { WAKEFLOW_DEMAND_CONTINUATION_RESULT_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-demand-continuation-result.generated.js";
import { WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-demand-publication-request.generated.js";
import { WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-demand-publication-result.generated.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator, } from "../../foundation/schema/runtime-json-schema.js";
import { fail } from "../../kernel/error.js";
/**
 * Wakeflow Capabilities / Demand：Demand 生命周期的公共合同（能力卡 4 与 8，ADR-0012）。
 *
 * 四个工具：`wakeflow_create_demand`（认领即创建）、`wakeflow_complete_demand`（完成即归档）、
 * `wakeflow_cancel_demand`（取消即归档并撤回需求包）、`wakeflow_continue_demand`（从归档重开，
 * 或记录用户对一次升级的回答）。路由读取并入观察切片的 `wakeflow_status{demandId}`（§13.94）。
 */
export const WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME = "wakeflow_create_demand";
export const WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME = "wakeflow_complete_demand";
export const WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME = "wakeflow_cancel_demand";
export const WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME = "wakeflow_continue_demand";
export const WAKEFLOW_DEMAND_PUBLIC_SCHEMA_VERSION = 1;
function requestJson(value) {
    try {
        return parseJsonValue(value, "$request");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("invalid-request", "not-json", error.path);
        throw error;
    }
}
function requestParser(validate) {
    return (value) => {
        const result = validate(requestJson(value));
        if (!result.ok)
            fail("invalid-request", "schema", `$request${result.path.slice(1)}`);
        return result.value;
    };
}
function resultAdmitter(validate) {
    return (value) => {
        const result = validate(parseJsonValue(value, "$result"));
        if (!result.ok)
            fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
        return result.value;
    };
}
export const parseDemandCreationRequest = requestParser(createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA));
export const admitDemandCreationResult = resultAdmitter(createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA));
export const parseDemandCompletionRequest = requestParser(createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_COMPLETION_REQUEST_SCHEMA));
export const admitDemandCompletionResult = resultAdmitter(createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA));
export const parseDemandCancellationRequest = requestParser(createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_CANCELLATION_REQUEST_SCHEMA));
export const admitDemandCancellationResult = resultAdmitter(createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_CANCELLATION_RESULT_SCHEMA));
export const parseDemandContinuationRequest = requestParser(createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_CONTINUATION_REQUEST_SCHEMA));
export const admitDemandContinuationResult = resultAdmitter(createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_CONTINUATION_RESULT_SCHEMA));
const EFFECT_ANNOTATIONS = Object.freeze({
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
});
/** 本切片在公共工具登记表里的四个条目；目录只汇总。 */
export const DEMAND_CREATION_TOOL_REGISTRATION = Object.freeze({
    name: WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME,
    slice: "demand",
    shape: "effect",
    executor: "createDemand",
    title: "Create Wakeflow Demand",
    description: "Claim one pending requirement package and create its Demand: preview derives a deterministic plan (demandId from the package and its board claim state, no write), apply publishes the Demand root with revision 1 and moves the package to claimed in one transaction, recover finishes an interrupted apply from the demandId. Only one active Demand per controller; the Demand type, testing decision, and authority members come from the package.",
    requestSchema: WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA,
    annotations: EFFECT_ANNOTATIONS,
});
export const DEMAND_COMPLETION_TOOL_REGISTRATION = Object.freeze({
    name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
    slice: "demand",
    shape: "effect",
    executor: "completeDemand",
    title: "Complete Wakeflow Demand",
    description: "Complete a Demand and archive it in one transaction: preview runs the verify gates (config, ledger layout, root audit, board claim, work claims, append candidates, evidence, payload privacy) and lists blockers without writing; apply appends the completion event, seals the archive package under the ledger with the verify report, marks the requirement package archived, and deletes the active root; recover replays the journaled steps.",
    requestSchema: WAKEFLOW_DEMAND_COMPLETION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA,
    annotations: EFFECT_ANNOTATIONS,
});
export const DEMAND_CANCELLATION_TOOL_REGISTRATION = Object.freeze({
    name: WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
    slice: "demand",
    shape: "effect",
    executor: "cancelDemand",
    title: "Cancel Wakeflow Demand",
    description: "Cancel any non-terminal Demand with a reason: preview lists blockers (a pending review result rejects the cancel) and runs the archive gates; apply appends the cancellation event, seals the archive package with results and evidence kept, releases this Demand's window work claims, withdraws the requirement package, and deletes the active root; recover replays the journaled steps.",
    requestSchema: WAKEFLOW_DEMAND_CANCELLATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_DEMAND_CANCELLATION_RESULT_SCHEMA,
    annotations: EFFECT_ANNOTATIONS,
});
export const DEMAND_CONTINUATION_TOOL_REGISTRATION = Object.freeze({
    name: WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
    slice: "demand",
    shape: "effect",
    executor: "continueDemand",
    title: "Continue Wakeflow Demand",
    description: "Two actions on one Demand. continue re-opens a completed Demand from its archive (optimization, requirement-supplement, or verified-bug lineage): the active root is restored, a continuation event is appended, the requirement package returns to claimed, and the route asks for a new task package first. record-decision answers an escalation so an awaiting-decision Demand can move again. Preview, apply with planDigest, recover with the demandId.",
    requestSchema: WAKEFLOW_DEMAND_CONTINUATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_DEMAND_CONTINUATION_RESULT_SCHEMA,
    annotations: EFFECT_ANNOTATIONS,
});
