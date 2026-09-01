import {
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_REQUEST_SCHEMA,
  type WakeflowTargetHostEffectOutcomeRequestV1 as OutcomeRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-host-effect-outcome-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Delivery：Target Host Effect Outcome公共请求合同。 */

export const WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME =
  "wakeflow_record_target_host_effect_outcome" as const;
export const WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_SCHEMA_VERSION =
  1 as const;

const TARGET_HOST_EFFECT_OUTCOME_PUBLIC_MAXIMUM_REQUEST_BYTES = 384 * 1024;
const TARGET_HOST_EFFECT_OUTCOME_PUBLIC_MAXIMUM_EVIDENCE_BYTES = 128 * 1024;

export type TargetHostEffectOutcomePublicRequest = Readonly<OutcomeRequestWire>;

export type TargetHostEffectOutcomePublicContractErrorReason =
  "json" | "capacity" | "schema";

const ERROR_MESSAGES = {
  json: "Target Host Effect Outcome public request is not passive JSON data.",
  capacity: "Target Host Effect Outcome public request exceeds its capacity.",
  schema:
    "Target Host Effect Outcome public request does not satisfy its Schema.",
} as const satisfies Readonly<
  Record<TargetHostEffectOutcomePublicContractErrorReason, string>
>;

/** 公共Outcome请求准入失败时返回稳定、脱敏错误。 */
export class TargetHostEffectOutcomePublicContractError extends Error {
  override readonly name = "TargetHostEffectOutcomePublicContractError";
  readonly code =
    "wakeflow-target-host-effect-outcome-public-contract" as const;
  readonly reason: TargetHostEffectOutcomePublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: TargetHostEffectOutcomePublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest = createRuntimeJsonSchemaValidator<OutcomeRequestWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_REQUEST_SCHEMA,
);

function fail(
  reason: TargetHostEffectOutcomePublicContractErrorReason,
  path: string,
): never {
  throw new TargetHostEffectOutcomePublicContractError(reason, path);
}

function assertEvidenceCapacity(value: JsonValue, path: string): void {
  if (
    encodeCanonicalJson(value, path).byteLength >
    TARGET_HOST_EFFECT_OUTCOME_PUBLIC_MAXIMUM_EVIDENCE_BYTES
  ) {
    fail("capacity", path);
  }
}

/** MCP SDK校验后重新建立有总量及逐Evidence容量约束的冻结Outcome请求。 */
export function parseTargetHostEffectOutcomePublicRequest(
  value: unknown,
): TargetHostEffectOutcomePublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      TARGET_HOST_EFFECT_OUTCOME_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof TargetHostEffectOutcomePublicContractError) {
      throw error;
    }
    throw error;
  }
  const validated = validateRequest(json);
  if (!validated.ok) fail("schema", validated.path);
  const request = validated.value;
  assertEvidenceCapacity(request.attempt.evidence, "$/attempt/evidence");
  if (request.readback.status !== "unavailable") {
    assertEvidenceCapacity(request.readback.evidence, "$/readback/evidence");
  }
  return request;
}
