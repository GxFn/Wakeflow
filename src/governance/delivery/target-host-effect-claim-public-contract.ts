import {
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_REQUEST_SCHEMA,
  type WakeflowTargetHostEffectClaimRequestV1 as ClaimRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-host-effect-claim-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Delivery：共享Target Host Effect Claim公共请求合同。 */

export const WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME =
  "wakeflow_claim_target_host_effect" as const;
export const WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_SCHEMA_VERSION =
  1 as const;
const TARGET_HOST_EFFECT_CLAIM_PUBLIC_MAXIMUM_REQUEST_BYTES = 128 * 1024;

export type TargetHostEffectClaimPublicImplementationRequest = Readonly<
  Extract<ClaimRequestWire, { readonly workType: "implementation" }>
>;
export type TargetHostEffectClaimPublicTestRequest = Readonly<
  Extract<ClaimRequestWire, { readonly workType: "test" }>
>;
export type TargetHostEffectClaimPublicRequest =
  | TargetHostEffectClaimPublicImplementationRequest
  | TargetHostEffectClaimPublicTestRequest;

export type TargetHostEffectClaimPublicContractErrorReason =
  "json" | "capacity" | "schema";

const ERROR_MESSAGES = {
  json: "Target Host Effect Claim public request is not passive JSON data.",
  capacity: "Target Host Effect Claim public request exceeds its capacity.",
  schema:
    "Target Host Effect Claim public request does not satisfy its Schema.",
} as const satisfies Readonly<
  Record<TargetHostEffectClaimPublicContractErrorReason, string>
>;

/** 公共Claim请求准入失败时返回稳定、脱敏错误。 */
export class TargetHostEffectClaimPublicContractError extends Error {
  override readonly name = "TargetHostEffectClaimPublicContractError";
  readonly code = "wakeflow-target-host-effect-claim-public-contract" as const;
  readonly reason: TargetHostEffectClaimPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: TargetHostEffectClaimPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest = createRuntimeJsonSchemaValidator<ClaimRequestWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_REQUEST_SCHEMA,
);

function fail(
  reason: TargetHostEffectClaimPublicContractErrorReason,
  path: string,
): never {
  throw new TargetHostEffectClaimPublicContractError(reason, path);
}

/** MCP SDK校验后重新建立有容量约束、递归冻结的Claim请求快照。 */
export function parseTargetHostEffectClaimPublicRequest(
  value: unknown,
): TargetHostEffectClaimPublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      TARGET_HOST_EFFECT_CLAIM_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof TargetHostEffectClaimPublicContractError) throw error;
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  return result.value as TargetHostEffectClaimPublicRequest;
}
