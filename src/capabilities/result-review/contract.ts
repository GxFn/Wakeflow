import {
  WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA,
  type WakeflowImplementationReviewDecisionRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-implementation-review-decision-request.generated.js";
import {
  WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA,
  type WakeflowImplementationReviewDecisionResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-implementation-review-decision-result.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA,
  type WakeflowTargetResultImportRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-target-result-import-request.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_IMPORT_RESULT_SCHEMA,
  type WakeflowTargetResultImportResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-target-result-import-result.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA,
  type WakeflowTargetResultReviewInspectionRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-target-result-review-inspection-request.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA,
  type WakeflowTargetResultReviewInspectionResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-target-result-review-inspection-result.generated.js";
import {
  WAKEFLOW_TEST_REVIEW_DECISION_REQUEST_SCHEMA,
  type WakeflowTestReviewDecisionRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-test-review-decision-request.generated.js";
import {
  WAKEFLOW_TEST_REVIEW_DECISION_RESULT_SCHEMA,
  type WakeflowTestReviewDecisionResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-test-review-decision-result.generated.js";
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
 * Wakeflow Capabilities / Result Review：结果导入、回调、评审投影与两类决定的公共合同
 * （能力卡 7 修订，ADR-0012 D1 D4 D5，§13.87）。
 *
 * 四个工具：`wakeflow_import_target_result`（追加，目标侧，随导入签发 wake-controller 回调许可）、
 * `wakeflow_inspect_target_result_review`（读，含回调与完成证据状态、允许的决定与逐步记录）、
 * `wakeflow_record_implementation_review_decision` 与 `wakeflow_record_test_review_decision`
 * （追加，Controller 侧；escalate 同一提交附带升级或缺陷修复授权）。
 */

export const WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME =
  "wakeflow_import_target_result" as const;
export const WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME =
  "wakeflow_inspect_target_result_review" as const;
export const WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME =
  "wakeflow_record_implementation_review_decision" as const;
export const WAKEFLOW_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME =
  "wakeflow_record_test_review_decision" as const;
export const WAKEFLOW_RESULT_REVIEW_PUBLIC_SCHEMA_VERSION = 1 as const;

export type TargetResultImportRequest = Readonly<WakeflowTargetResultImportRequestV1>;
export type TargetResultImportResult = Readonly<WakeflowTargetResultImportResultV1>;
export type TargetResultReviewInspectionRequest =
  Readonly<WakeflowTargetResultReviewInspectionRequestV1>;
export type TargetResultReviewInspectionResult =
  Readonly<WakeflowTargetResultReviewInspectionResultV1>;
export type ImplementationReviewDecisionRequest =
  Readonly<WakeflowImplementationReviewDecisionRequestV1>;
export type ImplementationReviewDecisionResult =
  Readonly<WakeflowImplementationReviewDecisionResultV1>;
export type TestReviewDecisionRequest = Readonly<WakeflowTestReviewDecisionRequestV1>;
export type TestReviewDecisionResult = Readonly<WakeflowTestReviewDecisionResultV1>;

const validateImportRequest = createRuntimeJsonSchemaValidator<WakeflowTargetResultImportRequestV1>(
  WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA,
);
const validateImportResult = createRuntimeJsonSchemaValidator<WakeflowTargetResultImportResultV1>(
  WAKEFLOW_TARGET_RESULT_IMPORT_RESULT_SCHEMA,
);
const validateInspectionRequest =
  createRuntimeJsonSchemaValidator<WakeflowTargetResultReviewInspectionRequestV1>(
    WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA,
  );
const validateInspectionResult =
  createRuntimeJsonSchemaValidator<WakeflowTargetResultReviewInspectionResultV1>(
    WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA,
  );
const validateImplementationDecisionRequest =
  createRuntimeJsonSchemaValidator<WakeflowImplementationReviewDecisionRequestV1>(
    WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA,
  );
const validateImplementationDecisionResult =
  createRuntimeJsonSchemaValidator<WakeflowImplementationReviewDecisionResultV1>(
    WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA,
  );
const validateTestDecisionRequest =
  createRuntimeJsonSchemaValidator<WakeflowTestReviewDecisionRequestV1>(
    WAKEFLOW_TEST_REVIEW_DECISION_REQUEST_SCHEMA,
  );
const validateTestDecisionResult =
  createRuntimeJsonSchemaValidator<WakeflowTestReviewDecisionResultV1>(
    WAKEFLOW_TEST_REVIEW_DECISION_RESULT_SCHEMA,
  );

function requestJson(value: unknown): JsonValue {
  try {
    return parseJsonValue(value, "$request");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("invalid-request", "not-json", error.path);
    throw error;
  }
}

function parseRequest<Request>(
  validate: RuntimeJsonSchemaValidator<Request>,
  value: unknown,
): Request {
  const result = validate(requestJson(value));
  if (!result.ok) fail("invalid-request", "schema", `$request${result.path.slice(1)}`);
  return result.value;
}

function admitResult<Result>(validate: RuntimeJsonSchemaValidator<Result>, value: unknown): Result {
  const result = validate(parseJsonValue(value, "$result"));
  if (!result.ok) fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
  return result.value;
}

export function parseTargetResultImportRequest(value: unknown): TargetResultImportRequest {
  return parseRequest(validateImportRequest, value);
}

export function admitTargetResultImportResult(value: unknown): TargetResultImportResult {
  return admitResult(validateImportResult, value);
}

export function parseTargetResultReviewInspectionRequest(
  value: unknown,
): TargetResultReviewInspectionRequest {
  return parseRequest(validateInspectionRequest, value);
}

export function admitTargetResultReviewInspectionResult(
  value: unknown,
): TargetResultReviewInspectionResult {
  return admitResult(validateInspectionResult, value);
}

export function parseImplementationReviewDecisionRequest(
  value: unknown,
): ImplementationReviewDecisionRequest {
  return parseRequest(validateImplementationDecisionRequest, value);
}

export function admitImplementationReviewDecisionResult(
  value: unknown,
): ImplementationReviewDecisionResult {
  return admitResult(validateImplementationDecisionResult, value);
}

export function parseTestReviewDecisionRequest(value: unknown): TestReviewDecisionRequest {
  return parseRequest(validateTestDecisionRequest, value);
}

export function admitTestReviewDecisionResult(value: unknown): TestReviewDecisionResult {
  return admitResult(validateTestDecisionResult, value);
}

const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});
const APPEND_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** 本切片在公共工具登记表里的四条条目；目录只汇总。 */
export const TARGET_RESULT_IMPORT_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
  slice: "result-review",
  shape: "append",
  executor: "importTargetResult",
  title: "Import Wakeflow Target Result",
  description:
    "Import the target-authored implementation or test report of one accepted or indeterminate delivery (deliveryId plus fence claimDigest) in one call with the observed stream revision and a client idempotency key. Wakeflow resolves every evidence locator inside this Demand's managed evidence records and checks its digest, scans report text for privacy, derives the test verdict from the per-step records, appends the TargetResult event, releases the claim, and returns the wake-controller callback permit whose prompt the Agent sends to the Controller window. Review input only, never acceptance.",
  requestSchema: WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_TARGET_RESULT_IMPORT_RESULT_SCHEMA,
  annotations: APPEND_ANNOTATIONS,
} as const) satisfies Readonly<WakeflowToolRegistration>;

export const TARGET_RESULT_REVIEW_INSPECTION_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
  slice: "result-review",
  shape: "read",
  executor: "inspectTargetResultReview",
  title: "Inspect Wakeflow Target Result Review",
  description:
    "Read the current review unit of one reported, review-blocked, or escalated target: the complete task package and authority-enriched TargetResult, prior decisions, the callback landing status derived from the Controller session's hook records, the target session's completion evidence, the decisions the rules allow, and for test results the per-step record with approved baselines and the attempt scope. Read-only: it runs no checks and records nothing.",
  requestSchema: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
} as const) satisfies Readonly<WakeflowToolRegistration>;

export const IMPLEMENTATION_REVIEW_DECISION_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
  slice: "result-review",
  shape: "append",
  executor: "recordImplementationReviewDecision",
  title: "Record Wakeflow Implementation Review Decision",
  description:
    "Record the Controller's independently formed accept, rework, blocked, or escalate decision for one inspected implementation TargetResult against the inspected snapshot and review-unit digests. Accept requires a completed outcome and the target session's completion record; escalate carries the issue, options, and recommendation and appends the Demand escalation in the same commit; a decision after blocked or escalated carries resumption. Same idempotency key and body replays the first result.",
  requestSchema: WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA,
  annotations: APPEND_ANNOTATIONS,
} as const) satisfies Readonly<WakeflowToolRegistration>;

export const TEST_REVIEW_DECISION_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
  slice: "result-review",
  shape: "append",
  executor: "recordTestReviewDecision",
  title: "Record Wakeflow Test Review Decision",
  description:
    "Record the Controller's accept, request-another-attempt (with the step ids to rerun), blocked, or escalate decision for one inspected test TargetResult. The step failure classifications gate the decision: rerun only for harness-defect, flaky, or missing-evidence steps within the attempt budget, blocked for environment failures, escalate with product-defect appends the remediation authorization for the affected implementation targets in the same commit, escalate with needs-decision appends the Demand escalation. Replays by idempotency key.",
  requestSchema: WAKEFLOW_TEST_REVIEW_DECISION_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_TEST_REVIEW_DECISION_RESULT_SCHEMA,
  annotations: APPEND_ANNOTATIONS,
} as const) satisfies Readonly<WakeflowToolRegistration>;
