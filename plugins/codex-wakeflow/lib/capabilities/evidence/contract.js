import { WAKEFLOW_RECORD_EVIDENCE_REQUEST_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-record-evidence-request.generated.js";
import { WAKEFLOW_RECORD_EVIDENCE_RESULT_SCHEMA, } from "../../contracts/generated/entrypoints/wakeflow-record-evidence-result.generated.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { fail } from "../../kernel/error.js";
/**
 * Wakeflow Capabilities / Evidence：`wakeflow_record_evidence` 的公共合同（能力卡 8 §8.1，
 * gate-log §13.89）。
 *
 * 一个效果型工具：preview 零写推导计划，apply 用同一选择重算计划并在摘要相符时执行，
 * recover 凭 demandId 完成被中断的发布。请求与结果都由生成的 wire Schema 闭合。
 */
export const WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME = "wakeflow_record_evidence";
export const WAKEFLOW_RECORD_EVIDENCE_PUBLIC_SCHEMA_VERSION = 1;
const validateRequest = createRuntimeJsonSchemaValidator(WAKEFLOW_RECORD_EVIDENCE_REQUEST_SCHEMA);
const validateResult = createRuntimeJsonSchemaValidator(WAKEFLOW_RECORD_EVIDENCE_RESULT_SCHEMA);
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
export function parseRecordEvidenceRequest(value) {
    const result = validateRequest(requestJson(value));
    if (!result.ok)
        fail("invalid-request", "schema", `$request${result.path.slice(1)}`);
    return result.value;
}
export function admitRecordEvidenceResult(value) {
    const result = validateResult(parseJsonValue(value, "$result"));
    if (!result.ok)
        fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
    return result.value;
}
/** 本切片在公共工具登记表里的条目；目录只汇总。 */
export const RECORD_EVIDENCE_TOOL_REGISTRATION = Object.freeze({
    name: WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME,
    slice: "evidence",
    shape: "effect",
    executor: "recordEvidence",
    title: "Record Wakeflow Evidence",
    description: "Record one immutable managed evidence record for an active Demand: preview derives the plan without writing, apply recomputes it from the same selection when the plan digest matches, recover finishes an interrupted publication. Kinds are a closed vocabulary; a source is a file or tree under a configured root, one host hook observation record projected without its session handle, an https link, or a commit reference. Identity derives from content, so the same content replays as already-recorded. Credential findings always block; opaque members and unlisted paths need controller-confirmed.",
    requestSchema: WAKEFLOW_RECORD_EVIDENCE_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_RECORD_EVIDENCE_RESULT_SCHEMA,
    annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    },
});
