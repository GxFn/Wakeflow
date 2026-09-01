import {
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA,
  type WakeflowControllerImplementationReviewDecisionRequestV1 as DecisionRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-controller-implementation-review-decision-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseControllerImplementationReviewDecisionRequest,
  ControllerImplementationReviewDecisionInputError,
  type ControllerImplementationReviewDecisionRequest,
} from "./controller-implementation-review-decision-input.js";

/** Wakeflow Governance / Review：Controller Implementation Decision公共请求合同。 */

export const WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME =
  "wakeflow_record_controller_implementation_review_decision" as const;
export const WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_SCHEMA_VERSION =
  1 as const;

const CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_MAXIMUM_REQUEST_BYTES =
  1024 * 1024;

export interface ControllerImplementationReviewDecisionPublicRequest extends ControllerImplementationReviewDecisionRequest {
  readonly root: string;
}

export type ControllerImplementationReviewDecisionPublicContractErrorReason =
  "json" | "capacity" | "schema" | "decision" | "privacy";

const ERROR_MESSAGES = {
  json: "Controller Implementation Review Decision request is not passive JSON data.",
  capacity:
    "Controller Implementation Review Decision request exceeds its capacity.",
  schema:
    "Controller Implementation Review Decision request does not satisfy its Schema.",
  decision:
    "Controller Implementation Review Decision request contains an invalid judgment.",
  privacy:
    "Controller Implementation Review Decision request contains the private workspace root.",
} as const satisfies Readonly<
  Record<
    ControllerImplementationReviewDecisionPublicContractErrorReason,
    string
  >
>;

export class ControllerImplementationReviewDecisionPublicContractError extends Error {
  override readonly name =
    "ControllerImplementationReviewDecisionPublicContractError";
  readonly code =
    "wakeflow-controller-implementation-review-decision-public-contract" as const;
  readonly reason: ControllerImplementationReviewDecisionPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: ControllerImplementationReviewDecisionPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest = createRuntimeJsonSchemaValidator<DecisionRequestWire>(
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA,
);

function fail(
  reason: ControllerImplementationReviewDecisionPublicContractErrorReason,
  path: string,
): never {
  throw new ControllerImplementationReviewDecisionPublicContractError(
    reason,
    path,
  );
}

function containsText(value: JsonValue, text: string): boolean {
  if (typeof value === "string") {
    return value.includes(text) || value.includes(JSON.stringify(text));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, text));
}

/** MCP SDK校验后建立typed selector与严格Controller judgment。 */
export function parseControllerImplementationReviewDecisionPublicRequest(
  value: unknown,
): Readonly<ControllerImplementationReviewDecisionPublicRequest> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (
      error instanceof ControllerImplementationReviewDecisionPublicContractError
    ) {
      throw error;
    }
    throw error;
  }
  const validated = validateRequest(json);
  if (!validated.ok) fail("schema", validated.path);
  const request = validated.value;
  const { root, ...decisionInput } = request;
  let parsed: Readonly<ControllerImplementationReviewDecisionRequest>;
  try {
    parsed = parseControllerImplementationReviewDecisionRequest(decisionInput);
  } catch (error: unknown) {
    if (error instanceof ControllerImplementationReviewDecisionInputError) {
      fail("decision", "$request");
    }
    throw error;
  }
  if (root.length > 1 && containsText(decisionInput as JsonValue, root)) {
    fail("privacy", "$request");
  }
  return Object.freeze({ root, ...parsed });
}
