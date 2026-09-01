import {
  WAKEFLOW_TARGET_DELIVERY_PREPARATION_REQUEST_SCHEMA,
  type WakeflowTargetDeliveryPreparationRequestV1 as PreparationRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-delivery-preparation-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Delivery：公共 Implementation Delivery Preparation 请求合同。 */

export const WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME =
  "wakeflow_prepare_implementation_delivery" as const;
export const WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_SCHEMA_VERSION =
  1 as const;

/** 完整Plan可能同时包含64 KiB prompt与32项返工投影，因此不能沿用小型Query容量。 */
const TARGET_DELIVERY_PREPARATION_PUBLIC_MAXIMUM_REQUEST_BYTES = 512 * 1024;

export type TargetDeliveryPreparationPublicPreviewRequest = Readonly<
  Extract<PreparationRequestWire, { readonly mode: "preview" }>
>;
export type TargetDeliveryPreparationPublicApplyRequest = Readonly<
  Extract<PreparationRequestWire, { readonly mode: "apply" }>
>;
export type TargetDeliveryPreparationPublicRequest =
  | TargetDeliveryPreparationPublicPreviewRequest
  | TargetDeliveryPreparationPublicApplyRequest;

export type TargetDeliveryPreparationPublicContractErrorReason =
  "json" | "capacity" | "schema";

const ERROR_MESSAGES = {
  json: "Target Delivery Preparation public request is not passive JSON data.",
  capacity: "Target Delivery Preparation public request exceeds its capacity.",
  schema:
    "Target Delivery Preparation public request does not satisfy its Schema.",
} as const satisfies Readonly<
  Record<TargetDeliveryPreparationPublicContractErrorReason, string>
>;

/** 公共Preparation请求准入失败时返回稳定、脱敏错误。 */
export class TargetDeliveryPreparationPublicContractError extends Error {
  override readonly name = "TargetDeliveryPreparationPublicContractError";
  readonly code =
    "wakeflow-target-delivery-preparation-public-contract" as const;
  readonly reason: TargetDeliveryPreparationPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: TargetDeliveryPreparationPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest =
  createRuntimeJsonSchemaValidator<PreparationRequestWire>(
    WAKEFLOW_TARGET_DELIVERY_PREPARATION_REQUEST_SCHEMA,
  );

function fail(
  reason: TargetDeliveryPreparationPublicContractErrorReason,
  path: string,
): never {
  throw new TargetDeliveryPreparationPublicContractError(reason, path);
}

/** MCP SDK校验后重新建立有容量约束、递归冻结的请求快照。 */
export function parseTargetDeliveryPreparationPublicRequest(
  value: unknown,
): TargetDeliveryPreparationPublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      TARGET_DELIVERY_PREPARATION_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof TargetDeliveryPreparationPublicContractError) {
      throw error;
    }
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  return result.value as TargetDeliveryPreparationPublicRequest;
}
