import {
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_REQUEST_SCHEMA,
  type WakeflowTargetHostEffectRearmRequestV1 as RearmRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-host-effect-rearm-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Delivery：Implementation Host Effect Rearm公共请求合同。 */

export const WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME =
  "wakeflow_rearm_target_host_effect" as const;
export const WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_SCHEMA_VERSION =
  1 as const;

const TARGET_HOST_EFFECT_REARM_PUBLIC_MAXIMUM_REQUEST_BYTES = 64 * 1024;

export type TargetHostEffectRearmPublicRequest = Readonly<RearmRequestWire>;

export type TargetHostEffectRearmPublicContractErrorReason =
  "json" | "capacity" | "schema";

const ERROR_MESSAGES = {
  json: "Target Host Effect Rearm public request is not passive JSON data.",
  capacity: "Target Host Effect Rearm public request exceeds its capacity.",
  schema:
    "Target Host Effect Rearm public request does not satisfy its Schema.",
} as const satisfies Readonly<
  Record<TargetHostEffectRearmPublicContractErrorReason, string>
>;

/** 公共Rearm请求准入失败时返回稳定、脱敏错误。 */
export class TargetHostEffectRearmPublicContractError extends Error {
  override readonly name = "TargetHostEffectRearmPublicContractError";
  readonly code = "wakeflow-target-host-effect-rearm-public-contract" as const;
  readonly reason: TargetHostEffectRearmPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: TargetHostEffectRearmPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest = createRuntimeJsonSchemaValidator<RearmRequestWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_REQUEST_SCHEMA,
);

function fail(
  reason: TargetHostEffectRearmPublicContractErrorReason,
  path: string,
): never {
  throw new TargetHostEffectRearmPublicContractError(reason, path);
}

/** MCP SDK校验后重新建立有容量约束、递归冻结的Rearm selector。 */
export function parseTargetHostEffectRearmPublicRequest(
  value: unknown,
): TargetHostEffectRearmPublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      TARGET_HOST_EFFECT_REARM_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof TargetHostEffectRearmPublicContractError) throw error;
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  return result.value;
}
