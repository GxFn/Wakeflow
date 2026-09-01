import {
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA,
  type WakeflowControllerProductDefectRemediationRequestV1 as RemediationRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-controller-product-defect-remediation-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseControllerProductDefectRemediationRequest,
  ControllerProductDefectRemediationInputError,
  type ControllerProductDefectRemediationRequest,
} from "./controller-product-defect-remediation-input.js";

/** Wakeflow Governance / Review：Controller Product Defect Remediation公共请求合同。 */

export const WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME =
  "wakeflow_authorize_product_defect_remediation" as const;
export const WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_SCHEMA_VERSION =
  1 as const;

const CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_MAXIMUM_REQUEST_BYTES =
  16 * 1024 * 1024;

export interface ControllerProductDefectRemediationPublicRequest extends ControllerProductDefectRemediationRequest {
  readonly root: string;
}

export type ControllerProductDefectRemediationPublicContractErrorReason =
  "json" | "capacity" | "schema" | "remediation" | "privacy";

const ERROR_MESSAGES = {
  json: "Controller Product Defect Remediation request is not passive JSON data.",
  capacity:
    "Controller Product Defect Remediation request exceeds its capacity.",
  schema:
    "Controller Product Defect Remediation request does not satisfy its Schema.",
  remediation:
    "Controller Product Defect Remediation request contains an invalid target mapping.",
  privacy:
    "Controller Product Defect Remediation request contains the private workspace root.",
} as const satisfies Readonly<
  Record<ControllerProductDefectRemediationPublicContractErrorReason, string>
>;

export class ControllerProductDefectRemediationPublicContractError extends Error {
  override readonly name =
    "ControllerProductDefectRemediationPublicContractError";
  readonly code =
    "wakeflow-controller-product-defect-remediation-public-contract" as const;
  readonly reason: ControllerProductDefectRemediationPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: ControllerProductDefectRemediationPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest =
  createRuntimeJsonSchemaValidator<RemediationRequestWire>(
    WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA,
  );

function fail(
  reason: ControllerProductDefectRemediationPublicContractErrorReason,
  path: string,
): never {
  throw new ControllerProductDefectRemediationPublicContractError(reason, path);
}

function containsText(value: JsonValue, text: string): boolean {
  if (typeof value === "string") {
    return value.includes(text) || value.includes(JSON.stringify(text));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, text));
}

/** MCP SDK校验后建立typed Decision selector与严格产品修复映射。 */
export function parseControllerProductDefectRemediationPublicRequest(
  value: unknown,
): Readonly<ControllerProductDefectRemediationPublicRequest> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (
      error instanceof ControllerProductDefectRemediationPublicContractError
    ) {
      throw error;
    }
    throw error;
  }
  const validated = validateRequest(json);
  if (!validated.ok) fail("schema", validated.path);
  const request = validated.value;
  const { root, ...remediationInput } = request;
  let parsed: Readonly<ControllerProductDefectRemediationRequest>;
  try {
    parsed = parseControllerProductDefectRemediationRequest(remediationInput);
  } catch (error: unknown) {
    if (error instanceof ControllerProductDefectRemediationInputError) {
      fail("remediation", "$request");
    }
    throw error;
  }
  if (
    root.length > 1 &&
    containsText(remediationInput as unknown as JsonValue, root)
  ) {
    fail("privacy", "$request");
  }
  return Object.freeze({ root, ...parsed });
}
