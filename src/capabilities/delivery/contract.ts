import {
  WAKEFLOW_PREPARE_DELIVERY_REQUEST_SCHEMA,
  type WakeflowPrepareDeliveryRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-prepare-delivery-request.generated.js";
import {
  WAKEFLOW_PREPARE_DELIVERY_RESULT_SCHEMA,
  type WakeflowPrepareDeliveryResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-prepare-delivery-result.generated.js";
import {
  WAKEFLOW_REARM_DELIVERY_REQUEST_SCHEMA,
  type WakeflowRearmDeliveryRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-rearm-delivery-request.generated.js";
import {
  WAKEFLOW_REARM_DELIVERY_RESULT_SCHEMA,
  type WakeflowRearmDeliveryResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-rearm-delivery-result.generated.js";
import {
  WAKEFLOW_RECORD_DELIVERY_OUTCOME_REQUEST_SCHEMA,
  type WakeflowRecordDeliveryOutcomeRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-record-delivery-outcome-request.generated.js";
import {
  WAKEFLOW_RECORD_DELIVERY_OUTCOME_RESULT_SCHEMA,
  type WakeflowRecordDeliveryOutcomeResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-record-delivery-outcome-result.generated.js";
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
 * Wakeflow Capabilities / Delivery：投递切片的公共合同（能力卡 6，ADR-0009，ADR-0012 D1 D2）。
 *
 * 三个追加型工具：`wakeflow_prepare_delivery`（取得声明、渲染 prompt、签发一次性许可）、
 * `wakeflow_record_delivery_outcome`（按 hook 记录派生处置）、`wakeflow_rearm_delivery`
 * （同信封新代际，上限三次）。宿主效果由 Agent 执行；Wakeflow 只出内容与准入证据。
 */

export const WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME = "wakeflow_prepare_delivery" as const;
export const WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME =
  "wakeflow_record_delivery_outcome" as const;
export const WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME = "wakeflow_rearm_delivery" as const;
export const WAKEFLOW_DELIVERY_PUBLIC_SCHEMA_VERSION = 1 as const;

export type PrepareDeliveryRequest = Readonly<WakeflowPrepareDeliveryRequestV1>;
export type PrepareDeliveryResult = Readonly<WakeflowPrepareDeliveryResultV1>;
export type RecordDeliveryOutcomeRequest = Readonly<WakeflowRecordDeliveryOutcomeRequestV1>;
export type RecordDeliveryOutcomeResult = Readonly<WakeflowRecordDeliveryOutcomeResultV1>;
export type RearmDeliveryRequest = Readonly<WakeflowRearmDeliveryRequestV1>;
export type RearmDeliveryResult = Readonly<WakeflowRearmDeliveryResultV1>;

const validatePrepareRequest = createRuntimeJsonSchemaValidator<WakeflowPrepareDeliveryRequestV1>(
  WAKEFLOW_PREPARE_DELIVERY_REQUEST_SCHEMA,
);
const validatePrepareResult = createRuntimeJsonSchemaValidator<WakeflowPrepareDeliveryResultV1>(
  WAKEFLOW_PREPARE_DELIVERY_RESULT_SCHEMA,
);
const validateOutcomeRequest =
  createRuntimeJsonSchemaValidator<WakeflowRecordDeliveryOutcomeRequestV1>(
    WAKEFLOW_RECORD_DELIVERY_OUTCOME_REQUEST_SCHEMA,
  );
const validateOutcomeResult =
  createRuntimeJsonSchemaValidator<WakeflowRecordDeliveryOutcomeResultV1>(
    WAKEFLOW_RECORD_DELIVERY_OUTCOME_RESULT_SCHEMA,
  );
const validateRearmRequest = createRuntimeJsonSchemaValidator<WakeflowRearmDeliveryRequestV1>(
  WAKEFLOW_REARM_DELIVERY_REQUEST_SCHEMA,
);
const validateRearmResult = createRuntimeJsonSchemaValidator<WakeflowRearmDeliveryResultV1>(
  WAKEFLOW_REARM_DELIVERY_RESULT_SCHEMA,
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

export function parsePrepareDeliveryRequest(value: unknown): PrepareDeliveryRequest {
  return parseRequest(validatePrepareRequest, value);
}

export function admitPrepareDeliveryResult(value: unknown): PrepareDeliveryResult {
  return admitResult(validatePrepareResult, value);
}

export function parseRecordDeliveryOutcomeRequest(value: unknown): RecordDeliveryOutcomeRequest {
  return parseRequest(validateOutcomeRequest, value);
}

export function admitRecordDeliveryOutcomeResult(value: unknown): RecordDeliveryOutcomeResult {
  return admitResult(validateOutcomeResult, value);
}

export function parseRearmDeliveryRequest(value: unknown): RearmDeliveryRequest {
  return parseRequest(validateRearmRequest, value);
}

export function admitRearmDeliveryResult(value: unknown): RearmDeliveryResult {
  return admitResult(validateRearmResult, value);
}

const APPEND_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** 本切片在公共工具登记表里的三条条目；目录只汇总。 */
export const PREPARE_DELIVERY_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
  slice: "delivery",
  shape: "append",
  executor: "prepareDelivery",
  title: "Prepare Wakeflow Delivery",
  description:
    "Prepare one delivery for a planned, rework-requested, product-defect-rework-requested, or rearm-exhausted target in one call with the observed stream revision and a client idempotency key: Wakeflow takes the window work claim, renders the prompt skeleton around the Controller's goal, focus, and boundary, appends the envelope with its fence token, and returns the one-shot permit (prompt, host action, fence). Implementation and test targets share this tool. Sending is the Agent host effect; record it with wakeflow_record_delivery_outcome.",
  requestSchema: WAKEFLOW_PREPARE_DELIVERY_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_PREPARE_DELIVERY_RESULT_SCHEMA,
  annotations: APPEND_ANNOTATIONS,
} as const) satisfies Readonly<WakeflowToolRegistration>;

export const RECORD_DELIVERY_OUTCOME_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
  slice: "delivery",
  shape: "append",
  executor: "recordDeliveryOutcome",
  title: "Record Wakeflow Delivery Outcome",
  description:
    "Record the outcome of one delivery generation identified by deliveryId and its fence claimDigest. Wakeflow derives the disposition from evidence: accepted only from the target session's user-prompt-submit hook record with the envelope's prompt digest, a Codex host send-call return, or an explicit Controller resolution of an indeterminate delivery; rejected-before-send only when the send call itself failed without touching the session (the claim is released); everything else stays indeterminate with the claim retained. Call again with a new idempotency key when landing evidence arrives later.",
  requestSchema: WAKEFLOW_RECORD_DELIVERY_OUTCOME_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_RECORD_DELIVERY_OUTCOME_RESULT_SCHEMA,
  annotations: Object.freeze({
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  }),
} as const) satisfies Readonly<WakeflowToolRegistration>;

export const REARM_DELIVERY_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME,
  slice: "delivery",
  shape: "append",
  executor: "rearmDelivery",
  title: "Rearm Wakeflow Delivery",
  description:
    "Rearm one delivery whose current generation is rejected-before-send: the same envelope and prompt get a fresh window work claim and fence, the generation increases by one, and the permit is re-issued. At most three rearms per envelope; after that prepare the target again with a new envelope. Never performs the host effect.",
  requestSchema: WAKEFLOW_REARM_DELIVERY_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_REARM_DELIVERY_RESULT_SCHEMA,
  annotations: APPEND_ANNOTATIONS,
} as const) satisfies Readonly<WakeflowToolRegistration>;
