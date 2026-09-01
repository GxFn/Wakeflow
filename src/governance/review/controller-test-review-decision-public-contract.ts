import {
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_REQUEST_SCHEMA,
  type WakeflowControllerTestReviewDecisionRequestV1 as DecisionRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-controller-test-review-decision-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseControllerTestReviewDecisionRequest,
  ControllerTestReviewDecisionInputError,
  type ControllerTestReviewDecisionRequest,
} from "./controller-test-review-decision-input.js";

/** Wakeflow Governance / Review：Controller Test Decision公共请求合同。 */

export const WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME =
  "wakeflow_record_controller_test_review_decision" as const;
export const WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_SCHEMA_VERSION =
  1 as const;

const CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_MAXIMUM_REQUEST_BYTES =
  1024 * 1024;

export interface ControllerTestReviewDecisionPublicRequest extends ControllerTestReviewDecisionRequest {
  readonly root: string;
}

export type ControllerTestReviewDecisionPublicContractErrorReason =
  "json" | "capacity" | "schema" | "decision" | "privacy";

const ERROR_MESSAGES = {
  json: "Controller Test Review Decision request is not passive JSON data.",
  capacity: "Controller Test Review Decision request exceeds its capacity.",
  schema:
    "Controller Test Review Decision request does not satisfy its Schema.",
  decision:
    "Controller Test Review Decision request contains an invalid judgment.",
  privacy:
    "Controller Test Review Decision request contains the private workspace root.",
} as const satisfies Readonly<
  Record<ControllerTestReviewDecisionPublicContractErrorReason, string>
>;

export class ControllerTestReviewDecisionPublicContractError extends Error {
  override readonly name = "ControllerTestReviewDecisionPublicContractError";
  readonly code =
    "wakeflow-controller-test-review-decision-public-contract" as const;
  readonly reason: ControllerTestReviewDecisionPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: ControllerTestReviewDecisionPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest = createRuntimeJsonSchemaValidator<DecisionRequestWire>(
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_REQUEST_SCHEMA,
);

function fail(
  reason: ControllerTestReviewDecisionPublicContractErrorReason,
  path: string,
): never {
  throw new ControllerTestReviewDecisionPublicContractError(reason, path);
}

function containsText(value: JsonValue, text: string): boolean {
  if (typeof value === "string") {
    return value.includes(text) || value.includes(JSON.stringify(text));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, text));
}

/** MCP SDK校验后建立typed selector与严格Controller judgment。 */
export function parseControllerTestReviewDecisionPublicRequest(
  value: unknown,
): Readonly<ControllerTestReviewDecisionPublicRequest> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof ControllerTestReviewDecisionPublicContractError) {
      throw error;
    }
    throw error;
  }
  const validated = validateRequest(json);
  if (!validated.ok) fail("schema", validated.path);
  const request = validated.value;
  const { root, ...decisionInput } = request;
  let parsed: Readonly<ControllerTestReviewDecisionRequest>;
  try {
    parsed = parseControllerTestReviewDecisionRequest(decisionInput);
  } catch (error: unknown) {
    if (error instanceof ControllerTestReviewDecisionInputError) {
      fail("decision", "$request");
    }
    throw error;
  }
  if (root.length > 1 && containsText(decisionInput as JsonValue, root)) {
    fail("privacy", "$request");
  }
  return Object.freeze({ root, ...parsed });
}
